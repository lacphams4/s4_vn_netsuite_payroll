/**
 * Sản lượng, lương khoán (giao diện bản 2). Mô-đun route (docs/UI_V2.md mục 5), chỉ đọc:
 *   GET outputsView   {subsidiary, period?}                    phiếu + số đếm + thẻ số liệu + dòng và thành viên gọn + xem trước
 *                                                              chia tiền + bảng lương đã gộp + việc cần xử lý
 *   GET outputRate    {rateTable, date, project?, item?}       đơn giá hiệu lực của từng hạng mục tại ngày phiếu (gợi ý khi nhập)
 *   GET outputLookups {subsidiary}                             bảng đơn giá, tổ, dự án để lập phiếu
 * Nghiệp vụ (lập, sửa, nạp thành viên, chia tiền, gửi duyệt, duyệt, tạm giữ) giữ ở api/Output.js qua action cũ saveOutput,
 * loadTeamMembers, splitOutput, outputAction theo ma trận quyền cũ (administrator + HR).
 *
 * Số truy vấn của outputsView cố định (không lặp theo phiếu): phiếu (JOIN tổ, bảng đơn giá, kỳ, người duyệt, dự án), dòng
 * sản lượng, thành viên (JOIN nhân viên và hồ sơ lương), bảng lương của công ty con. Id số nguyên ghép thẳng vào câu lệnh.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Lean", "../core/OutputRules", "../core/RateTable"], (Store, Lean, Rules, RateTable) => {
	const STATUSES = ["H", "P", "A", "C"];
	// Thứ tự ưu tiên của việc cần xử lý
	const ISSUES = ["PERIOD_POSTED", "SPLIT_MISMATCH", "NOT_SPLIT", "NO_MEMBERS", "NO_PROFILE", "RATE_MISSING", "NO_LINES", "NO_PERIOD"];
	const PROJECT_LIMIT = 300;

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	const blank = (v) => v === null || v === undefined || v === "";
	const num = (v) => Number(v) || 0;
	const isId = (v) => /^\d+$/.test(String(blank(v) ? "" : v));
	const isIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const person = (code, first, last) => [last, first].filter(Boolean).join(" ").trim() || code || "";
	const type = (name) => Lean.rec(name).type;

	/** Chạy fn, lỗi (vai trò không đọc được bảng) thì trả giá trị dự phòng: màn hình vẫn mở được. */
	function attempt(fn, fallback) {
		try {
			return fn();
		} catch (e) {
			return fallback;
		}
	}

	function scope(params) {
		const subsidiary = String((params && params.subsidiary) || "");
		if (!isId(subsidiary)) throw fail("Select a subsidiary", "Chưa chọn công ty con");
		const period = String((params && params.period) || "");
		if (period && !isId(period)) throw fail("Unknown pay period", "Kỳ lương không hợp lệ");
		return { subsidiary, period };
	}

	// ------------------------------------------------------------------ đọc

	const ENTRY_KEYS = ["name", "doc_date", "period", "type", "rate_table", "team", "split_method", "project", "location", "work_center", "description", "status", "approved_date", "batch"];
	const TEAM_KEYS = ["name", "description"];
	const TABLE_KEYS = ["name", "description", "type", "allow_override"];
	const PERIOD_KEYS = ["name", "start", "end", "status", "att_status"];

	/** Phiếu của công ty con (và kỳ), mới nhất trước, kèm tên tổ, bảng đơn giá, kỳ, người duyệt, dự án trong MỘT truy vấn. */
	function entries(sc) {
		const c = (key) => Lean.col("output", key);
		const where = `{subsidiary} = ${sc.subsidiary}` + (sc.period ? ` AND {period} = ${sc.period}` : "");
		const join =
			`LEFT JOIN ${type("team")} tm ON tm.id = ${c("team")} LEFT JOIN ${type("rate_table")} rt ON rt.id = ${c("rate_table")} ` +
			`LEFT JOIN ${type("period")} p ON p.id = ${c("period")} LEFT JOIN employee ab ON ab.id = ${c("approved_by")}`;
		const extra = Lean.cols("team", TEAM_KEYS, "tm", "tm_")
			.concat(Lean.cols("rate_table", TABLE_KEYS, "rt", "rt_"), Lean.cols("period", PERIOD_KEYS, "p", "p_"))
			.concat(["ab.entityid AS ab_code", "ab.firstname AS ab_first", "ab.lastname AS ab_last"]);
		const raw = TEAM_KEYS.map((k) => `tm_${k}`).concat(TABLE_KEYS.map((k) => `rt_${k}`), PERIOD_KEYS.map((k) => `p_${k}`), ["ab_code", "ab_first", "ab_last", "j_code", "j_name"]);
		const read = (projectJoin, projectCols, tag) => Lean.select("output", ENTRY_KEYS, { where, order: "{id} DESC", join: join + projectJoin, extra: extra.concat(projectCols), raw, tag });
		// Tên dự án lấy bằng JOIN; vai trò không đọc được bảng job thì dùng BUILTIN.DF
		try {
			return read(` LEFT JOIN job j ON j.id = ${c("project")}`, ["j.entityid AS j_code", "j.companyname AS j_name"], "s4vp_out_entries");
		} catch (e) {
			return read("", ["NULL AS j_code", `BUILTIN.DF(${c("project")}) AS j_name`], "s4vp_out_entries_df");
		}
	}

	/**
	 * Dòng con (dòng sản lượng hoặc thành viên) của mọi phiếu trong phạm vi, kèm mã, họ tên nhân viên và dấu hiệu có hồ sơ lương
	 * ở công ty con này. Một truy vấn; nhân viên có nhiều hồ sơ lương thì dòng lặp bị bỏ.
	 */
	function children(name, keys, sc, tag) {
		const prof = Lean.rec("employee");
		const emp = Lean.col(name, "employee");
		const join =
			`INNER JOIN ${type("output")} o ON o.id = ${Lean.col(name, "entry")} LEFT JOIN employee e ON e.id = ${emp} ` +
			`LEFT JOIN ${prof.type} pf ON pf.${prof.fields.employee.id} = ${emp} AND pf.${prof.fields.subsidiary.id} = ${sc.subsidiary} AND pf.isinactive = 'F'`;
		const where = `${Lean.col("output", "subsidiary", "o")} = ${sc.subsidiary} AND o.isinactive = 'F'` + (sc.period ? ` AND ${Lean.col("output", "period", "o")} = ${sc.period}` : "");
		const rows = Lean.select(name, keys, { where, join, extra: ["e.entityid AS e_code", "e.firstname AS e_first", "e.lastname AS e_last", "pf.id AS pf_id"], raw: ["e_code", "e_first", "e_last", "pf_id"], tag });
		const seen = {};
		const by = {};
		for (const r of rows) {
			if (seen[r.id]) continue;
			seen[r.id] = true;
			(by[r.entry] = by[r.entry] || []).push(r);
		}
		return by;
	}

	function batchesOf(sc) {
		const where = `{subsidiary} = ${sc.subsidiary}` + (sc.period ? ` AND {period} = ${sc.period}` : "");
		return attempt(() => Lean.select("batch", ["name", "status", "period"], { where, order: "{id} DESC", tag: "s4vp_out_batches" }), []);
	}

	// ------------------------------------------------------------------ outputsView

	function lineOf(l) {
		const hasEmp = !blank(l.employee);
		return {
			id: l.id, employee: hasEmp ? l.employee : null, code: hasEmp ? l.e_code || "" : "", name: hasEmp ? person(l.e_code, l.e_first, l.e_last) : "",
			item: l.item || "", description: l.description || "", uom: l.uom || "", qty: num(l.qty), rate: num(l.rate), amount: num(l.amount), noProfile: hasEmp && blank(l.pf_id),
		};
	}

	function memberOf(m) {
		return {
			id: m.id, employee: m.employee, code: m.e_code || "", name: person(m.e_code, m.e_first, m.e_last),
			workDays: num(m.work_days), hours: num(m.hours), factor: blank(m.factor) ? 1 : num(m.factor), percent: num(m.percent), amount: num(m.amount), manual: !!m.manual, noProfile: blank(m.pf_id), preview: null,
		};
	}

	/** Xem trước kết quả chia (cùng lõi với splitOutput, không ghi): gán members[].preview, lỗi thì trả {en, vi}. */
	function previewSplit(total, members, method) {
		try {
			const parts = Rules.split(total, members.map((m) => ({ workDays: m.workDays, hours: m.hours, splitFactor: m.factor, fixedPercent: m.percent })), method || "F");
			members.forEach((m, i) => (m.preview = parts[i]));
			return null;
		} catch (e) {
			return { en: String((e && e.message) || e), vi: String((e && (e.messageVi || e.message)) || e) };
		}
	}

	/**
	 * Dữ liệu màn Sản lượng: phiếu của công ty con (và kỳ nếu có). Số đếm, thẻ số liệu, việc cần xử lý tính trên mọi phiếu trả về.
	 * Việc cần xử lý (rows[].issues, issues[]): PERIOD_POSTED kỳ đã có bảng lương ghi sổ mà phiếu chưa vào lương, SPLIT_MISMATCH
	 * tổng chia khác thành tiền, NOT_SPLIT phiếu tổ chưa chia, NO_MEMBERS phiếu tổ chưa có thành viên, NO_PROFILE có người chưa có
	 * hồ sơ lương, RATE_MISSING dòng có số lượng nhưng không có đơn giá, NO_LINES chưa có sản lượng, NO_PERIOD chưa có kỳ.
	 */
	function outputsView(params) {
		const sc = scope(params);
		const all = entries(sc);
		const lines = all.length ? children("output_line", ["entry", "employee", "item", "description", "uom", "qty", "rate", "amount"], sc, "s4vp_out_lines") : {};
		const members = all.length ? children("output_member", ["entry", "employee", "work_days", "hours", "factor", "percent", "amount", "manual"], sc, "s4vp_out_members") : {};
		const batches = batchesOf(sc).map((b) => ({ id: b.id, name: b.name || "", status: b.status || "", period: b.period || null }));
		const batchById = {};
		const postedByPeriod = {};
		for (const b of batches) {
			batchById[b.id] = b;
			if (b.status === "R" && b.period && !postedByPeriod[b.period]) postedByPeriod[b.period] = { id: b.id, name: b.name };
		}

		const counts = { all: all.length, H: 0, P: 0, A: 0, C: 0, attention: 0 };
		const cards = {
			pending: { count: 0, amount: 0 },
			approved: { count: 0, amount: 0 },
			total: { count: all.length, amount: 0, holdCount: 0, holdAmount: 0 },
			included: { count: 0, amount: 0, batches: [] },
		};
		const groups = {};
		const includedBatches = {};
		const rows = [];
		for (const e of all) {
			const st = STATUSES.includes(e.status) ? e.status : "H";
			const table = Lean.row("rate_table", TABLE_KEYS, e, "rt_");
			const period = Lean.row("period", PERIOD_KEYS, e, "p_");
			const ls = (lines[e.id] || []).map(lineOf);
			const isTeam = e.type === "T";
			const ms = isTeam ? (members[e.id] || []).map(memberOf) : [];
			// Tổng tính lại từ dòng con (số trên phiếu có thể cũ nếu dòng được sửa bằng form bản ghi)
			const total = Math.round(ls.reduce((s, l) => s + l.amount, 0));
			const splitTotal = Math.round(ms.reduce((s, m) => s + m.amount, 0));
			const open = st !== "C";
			const posted = open && e.period ? postedByPeriod[e.period] || null : null;
			const splitError = isTeam && st === "H" && ms.length && total > 0 ? previewSplit(total, ms, e.split_method) : null;
			const people = isTeam ? ms : ls.filter((l) => l.employee);

			const issues = [];
			if (posted) issues.push("PERIOD_POSTED");
			if (open && isTeam && total > 0 && ms.length && splitTotal !== total) issues.push(st === "H" && splitTotal === 0 ? "NOT_SPLIT" : "SPLIT_MISMATCH");
			if (open && isTeam && total > 0 && !ms.length) issues.push("NO_MEMBERS");
			if (open && people.some((x) => x.noProfile)) issues.push("NO_PROFILE");
			if (open && ls.some((l) => l.qty > 0 && !(l.amount > 0))) issues.push("RATE_MISSING");
			if (st === "H" && !(total > 0)) issues.push("NO_LINES");
			if (open && blank(e.period)) issues.push("NO_PERIOD");
			for (const code of issues) (groups[code] = groups[code] || []).push(e.id);

			counts[st] += 1;
			if (issues.length) counts.attention += 1;
			cards.total.amount += total;
			if (st === "H") {
				cards.total.holdCount += 1;
				cards.total.holdAmount += total;
			} else if (st === "P") {
				cards.pending.count += 1;
				cards.pending.amount += total;
			} else if (st === "A") {
				cards.approved.count += 1;
				cards.approved.amount += total;
			} else {
				cards.included.count += 1;
				cards.included.amount += total;
				if (e.batch && !includedBatches[e.batch]) {
					includedBatches[e.batch] = true;
					cards.included.batches.push({ id: e.batch, name: (batchById[e.batch] || {}).name || "" });
				}
			}
			const batch = e.batch ? batchById[e.batch] || {} : {};
			rows.push({
				id: e.id, name: e.name || "", date: e.doc_date || null, type: isTeam ? "T" : "I", kind: isTeam ? "T" : table.type === "S" ? "S" : "I", status: st, description: e.description || "",
				period: e.period || null, periodName: period.name || "", periodStatus: period.status || null, periodAtt: period.att_status || null,
				team: e.team || null, teamName: e.tm_name || "", teamDescription: e.tm_description || "", splitMethod: e.split_method || (isTeam ? "F" : null),
				rateTable: e.rate_table || null, rateTableName: table.name || "", rateTableDescription: table.description || "", rateTableType: table.type || "", allowOverride: !!table.allow_override,
				project: e.project || null, projectName: e.project ? [e.j_code, e.j_name].filter((x, i, a) => x && a.indexOf(x) === i).join(" ") : "", location: e.location || null, workCenter: e.work_center || null,
				total, splitTotal, people: new Set(people.map((x) => String(x.employee))).size,
				approvedDate: e.approved_date || null, approvedBy: person(e.ab_code, e.ab_first, e.ab_last),
				batch: e.batch || null, batchName: batch.name || "", batchStatus: batch.status || "", postedBatch: posted,
				lines: ls, members: ms, hasManual: ms.some((m) => m.manual), splitError, issues,
			});
		}
		const issues = ISSUES.filter((code) => groups[code]).map((code) => ({ code, count: groups[code].length, entries: groups[code] }));
		const totals = rows.reduce((t, r) => ({ total: t.total + r.total, splitTotal: t.splitTotal + (r.type === "T" ? r.splitTotal : 0) }), { total: 0, splitTotal: 0 });
		return { subsidiary: sc.subsidiary, period: sc.period, counts, cards, totals, issues, rows, batches };
	}

	// ------------------------------------------------------------------ outputRate

	function tableOf(id) {
		if (!isId(id)) throw fail("Rate table is required", "Chưa chọn bảng đơn giá");
		const t = Lean.select("rate_table", TABLE_KEYS, { where: `{id} = ${id}`, includeInactive: true, tag: "s4vp_out_table" })[0];
		if (!t) throw fail("Rate table not found", "Không tìm thấy bảng đơn giá");
		return { id: t.id, code: norm(t.name), description: t.description || "", type: t.type || "W", allowOverride: !!t.allow_override };
	}

	/**
	 * Đơn giá hiệu lực tại ngày phiếu (và dự án) của từng hạng mục trong bảng đơn giá - cùng quy tắc core/RateTable.findRate mà
	 * saveOutput dùng khi định giá. rate = null: hạng mục chưa có đơn giá hiệu lực (người dùng tự nhập). Bảng loại S (thang
	 * doanh số) không có hạng mục: số lượng chính là doanh số, đơn giá 1.
	 */
	function outputRate(params) {
		const p = params || {};
		const table = tableOf(p.rateTable);
		const date = String(p.date || "");
		if (!isIso(date)) throw fail("Document date is required", "Chưa nhập ngày phiếu");
		const project = isId(p.project) ? String(p.project) : "";
		if (table.type === "S") return { table, date, project, items: [] };
		const lines = Lean.select("rate_line", ["item", "description", "uom", "rate", "effective", "expiration", "project"], { where: `{table} = ${table.id}`, tag: "s4vp_out_rate_lines" }).map((l) => ({
			itemCode: l.item, description: l.description || "", uom: l.uom || "", rate: num(l.rate), effectiveDate: l.effective || null, expirationDate: l.expiration || null, project: l.project || "",
		}));
		const want = norm(p.item);
		const byItem = {};
		for (const l of lines) {
			const key = norm(l.itemCode);
			if (!key || (want && key !== want)) continue;
			const cur = (byItem[key] = byItem[key] || { item: l.itemCode, description: l.description, uom: l.uom, rate: null, effective: null, forProject: false });
			if (!cur.description && l.description) cur.description = l.description;
			if (!cur.uom && l.uom) cur.uom = l.uom;
		}
		const items = Object.keys(byItem).sort().map((key) => {
			const it = byItem[key];
			const hit = RateTable.findRate(lines, it.item, date, project);
			if (hit) Object.assign(it, { rate: num(hit.rate), effective: hit.effectiveDate || null, forProject: !blank(hit.project), description: hit.description || it.description, uom: hit.uom || it.uom });
			return it;
		});
		return { table, date, project, items };
	}

	// ------------------------------------------------------------------ outputLookups

	/** Danh mục để lập phiếu: bảng đơn giá, tổ của công ty con (hoặc tổ dùng chung), dự án (tối đa 300, more = true khi còn). */
	function outputLookups(params) {
		const sc = scope(params);
		const rateTables = Lean.select("rate_table", TABLE_KEYS, { order: "{name}", tag: "s4vp_out_tables" }).map((t) => ({ id: t.id, code: t.name || "", description: t.description || "", type: t.type || "W", allowOverride: !!t.allow_override }));
		const teams = Lean.select("team", ["name", "description", "subsidiary", "split_method", "project", "location", "work_center"], { order: "{name}", tag: "s4vp_out_teams" })
			.filter((t) => blank(t.subsidiary) || String(t.subsidiary) === sc.subsidiary)
			.map((t) => ({ id: t.id, code: t.name || "", description: t.description || "", splitMethod: t.split_method || "F", project: t.project || null, location: t.location || null, workCenter: t.work_center || null }));
		const found = attempt(() => Store.run(`SELECT * FROM (SELECT j.id, j.entityid, j.companyname FROM job j WHERE j.isinactive = 'F' ORDER BY j.entityid) WHERE ROWNUM <= ${PROJECT_LIMIT + 1}`, [], "s4vp_out_projects"), []);
		const projects = found.slice(0, PROJECT_LIMIT).map((j) => ({ id: String(j.id), name: [j.entityid, j.companyname].filter((x, i, a) => x && a.indexOf(x) === i).join(" ") }));
		return { rateTables, teams, projects, projectsMore: found.length > PROJECT_LIMIT };
	}

	const routes = {
		get: {
			outputsView: { roles: "payroll", run: outputsView },
			outputRate: { roles: "payroll", run: outputRate },
			outputLookups: { roles: "payroll", run: outputLookups },
		},
		post: {},
	};

	return { routes, outputsView, outputRate, outputLookups };
});
