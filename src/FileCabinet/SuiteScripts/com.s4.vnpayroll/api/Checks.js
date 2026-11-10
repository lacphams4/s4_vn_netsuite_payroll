/**
 * Kiểm tra trước khi duyệt bảng lương và kết quả xử lý cảnh báo (docs/design/CanhBao.dc.html, docs/UI_V2.md mục 9).
 *
 * Cảnh báo được TÍNH mỗi lần đọc từ dữ liệu bảng lương bằng core/PayrollChecks (không lưu danh sách); record check_result
 * (tiền tố bck) chỉ giữ trạng thái xử lý, ghi chú, người phụ trách và được ghép lại theo khóa `rule:employee`.
 *
 * Hàm máy chủ cho phân hệ khác:
 *   summary(batchId)         -> { open, errors, warnings, resolved } (open = errors + warnings chưa đóng; info không tính)
 *   blockers(batchId)        -> các cảnh báo mức error (chặn duyệt), cùng dạng với items của checksList
 *   assertApprovable(batchId) ném lỗi nghiệp vụ khi còn cảnh báo mức error (để api/Payroll.approve gọi trước khi duyệt)
 *
 * Route (vai trò "payroll"):
 *   GET  checksList  { batch }                 -> { batch, counts, blocking, items, assignees }
 *   GET  checkDetail { batch, rule, employee } -> { item, facts, compare, inputs, history, profileId }
 *   POST resolveCheck { batch, rule, employee, status, note, assignee } -> { ok, key, status, counts, ... }
 *
 * Governance: mỗi lần tính đọc theo lô (bảng lương, kỳ, dòng của kỳ này và kỳ trước trong một truy vấn, hồ sơ, giờ công,
 * dòng nhập tay, tham số, kết quả đã lưu), không lặp truy vấn theo nhân viên. Kết quả tính được nhớ trong một lần chạy script.
 * Không trả mã số thuế, số tài khoản: chỉ dùng để biết có hay không.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Clock", "../core/PayrollChecks"], (runtime, Store, Clock, Rules) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const num = (v) => {
		const n = Number(v);
		return blank(v) || !isFinite(n) ? 0 : n;
	};
	const STATUS_CODE = { open: "O", accepted: "A", resolved: "R" };
	const STATUS_NAME = { O: "open", A: "accepted", R: "resolved" };
	const LINE_KEYS = ["batch", "employee", "profile", "employment_type", "std_days", "work_days", "insurance_wage", "gross", "ee_ins", "pit", "other_ded", "advance", "net", "error"];
	const HISTORY_MAX = 50;
	const ASSIGNEE_MAX = 300;
	// Tham số tùy chọn trong bảng tham số pháp lý (record param), tra theo ngày cuối kỳ:
	//   CHECK.NET_CHANGE_PCT  ngưỡng chênh thực lĩnh so với kỳ trước, số thập phân (0.2 = 20%); thiếu thì dùng mặc định của lõi
	//   CHECK.INS_WAGE_MIN    mức lương đóng bảo hiểm tối thiểu dùng cho mọi vùng; thiếu thì dùng MINWAGE.<vùng> của thiết lập;
	//                         không có cả hai thì bỏ qua quy tắc INS_BELOW_MIN
	const PARAM_NET_CHANGE = "CHECK.NET_CHANGE_PCT";
	const PARAM_INS_MIN = "CHECK.INS_WAGE_MIN";
	const PARAM_MINWAGE = "MINWAGE.";

	const memo = {};

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function lang() {
		try {
			return /^vi/i.test(String(runtime.getCurrentUser().getPreference({ name: "LANGUAGE" }) || "")) ? "vi" : "en";
		} catch (e) {
			return "vi";
		}
	}

	function currentUser() {
		try {
			const u = runtime.getCurrentUser();
			return { id: Number(u.id) > 0 ? String(u.id) : null, name: String(u.name || "") };
		} catch (e) {
			return { id: null, name: "" };
		}
	}

	// ------------------------------------------------------------------ đọc dữ liệu theo lô

	/** Tên và mã nhân viên của nhiều id trong một truy vấn (mỗi 900 id). */
	function employeesInfo(ids) {
		const out = {};
		const list = [...new Set((ids || []).filter((x) => !blank(x)).map(String))];
		for (let i = 0; i < list.length; i += 900) {
			const chunk = list.slice(i, i + 900);
			const inList = chunk.filter((x) => /^\d+$/.test(x)).join(",") || "0";
			const rows = Store.run(`SELECT e.id, e.entityid, e.firstname, e.lastname FROM employee e WHERE e.id IN (${inList})`, [], "s4vp_checks_employees");
			for (const r of rows) out[String(r.id)] = { id: String(r.id), code: r.entityid || "", name: [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || r.entityid || "" };
		}
		return out;
	}

	/** Dòng nhân viên của một hoặc hai bảng lương, không đọc trường chi tiết JSON (nhẹ hơn Store.find). */
	function linesOf(batchIds) {
		const ids = [...new Set(batchIds.filter((x) => !blank(x)).map(String))];
		if (!ids.length) return [];
		const def = Store.rec("batch_emp");
		const cols = ["t.id AS id"].concat(LINE_KEYS.map((k) => `t.${def.fields[k].id} AS c_${k}`));
		const sql = `SELECT ${cols.join(", ")} FROM ${def.type} t WHERE t.${def.fields.batch.id} IN (${ids.map(() => "?").join(",")}) AND t.isinactive = 'F' ORDER BY t.id`;
		return Store.run(sql, ids, "s4vp_checks_lines").map((r) => {
			const o = { id: String(r.id) };
			for (const k of LINE_KEYS) {
				const f = def.fields[k];
				let v = r[`c_${k}`];
				if (v === undefined) v = null;
				if (f.type === "select" && f.target && f.target.startsWith("list:")) v = Store.codeOf(f.target.slice(5), v);
				else if (f.type === "select") v = v === null ? null : String(v);
				else if (f.type === "float" || f.type === "currency" || f.type === "int") v = blank(v) ? null : Number(v);
				o[k] = v;
			}
			return o;
		});
	}

	/**
	 * Bảng lương kỳ trước để so sánh: cùng công ty con, cùng nhóm lương, chưa bị đảo, kỳ kết thúc trước ngày bắt đầu kỳ này
	 * và gần nhất. Xác định theo NGÀY kết thúc kỳ, không theo mã kỳ (mã kỳ có thể lệch tháng so với ngày).
	 */
	function previousBatch(batch, period) {
		if (!period || blank(period.start)) return null;
		const others = Store.find("batch", { where: "{subsidiary} = ? AND {id} <> ?", params: [batch.subsidiary, batch.id] }).filter((b) => b.status !== "V" && String(b.paygroup || "") === String(batch.paygroup || ""));
		if (!others.length) return null;
		const periods = {};
		for (const p of Store.findIn("period", "id", others.map((b) => b.period))) periods[p.id] = p;
		let best = null;
		for (const b of others) {
			const p = periods[b.period];
			if (!p || blank(p.end) || !(String(p.end) < String(period.start))) continue;
			if (!best || String(p.end) > String(best.period.end) || (String(p.end) === String(best.period.end) && Number(b.id) > Number(best.batch.id))) best = { batch: b, period: p };
		}
		return best;
	}

	/** Ngưỡng và mức tối thiểu lấy từ bảng tham số của thiết lập, hiệu lực tại ngày cuối kỳ. Không có thì để trống. */
	function checkOptions(period) {
		const out = { netChangeThreshold: null, minInsuranceWage: null, minInsuranceParam: "" };
		const end = period && period.end ? String(period.end) : "";
		let rows = [];
		try {
			rows = Store.find("param", { where: "UPPER({name}) LIKE ? OR UPPER({name}) LIKE ?", params: [`${PARAM_MINWAGE}%`, "CHECK.%"] });
		} catch (e) {
			rows = [];
		}
		const latest = {};
		for (const p of rows) {
			const code = String(p.name || "").trim().toUpperCase();
			if (blank(p.value) || blank(p.effective)) continue;
			if (end && (String(p.effective) > end || (!blank(p.expiration) && String(p.expiration) < end))) continue;
			if (!latest[code] || String(p.effective) > String(latest[code].effective)) latest[code] = p;
		}
		if (latest[PARAM_NET_CHANGE] && num(latest[PARAM_NET_CHANGE].value) > 0) out.netChangeThreshold = num(latest[PARAM_NET_CHANGE].value);
		if (latest[PARAM_INS_MIN] && num(latest[PARAM_INS_MIN].value) > 0) {
			out.minInsuranceWage = num(latest[PARAM_INS_MIN].value);
			out.minInsuranceParam = PARAM_INS_MIN;
		} else {
			const byRegion = {};
			for (const code of Object.keys(latest)) if (code.startsWith(PARAM_MINWAGE) && num(latest[code].value) > 0) byRegion[code.slice(PARAM_MINWAGE.length)] = num(latest[code].value);
			if (Object.keys(byRegion).length) {
				out.minInsuranceWage = byRegion;
				out.minInsuranceParam = `${PARAM_MINWAGE}*`;
			}
		}
		return out;
	}

	/** Vùng lương mặc định (công ty, rồi thiết lập chung) cho hồ sơ không khai vùng. */
	function defaultRegion(subsidiary) {
		try {
			const c = subsidiary ? Store.find("company", { where: "{subsidiary} = ?", params: [subsidiary] })[0] : null;
			if (c && c.region) return c.region;
			const t = Store.find("setup")[0];
			return (t && t.region) || "";
		} catch (e) {
			return "";
		}
	}

	/** Kết quả xử lý đã lưu của bảng lương: { <key>: record }. Record chưa được deploy thì coi như chưa có gì. */
	function storedResults(batchId) {
		const out = {};
		let rows = [];
		try {
			rows = Store.find("check_result", { where: "{batch} = ?", params: [batchId] });
		} catch (e) {
			rows = [];
		}
		for (const r of rows) {
			const key = r.employee ? `${r.rule}:${r.employee}` : String(r.rule || "");
			// Trùng khóa (hai người lưu cùng lúc): bản ghi mới nhất thắng
			out[key] = Object.assign({}, r, { status: STATUS_NAME[r.status] || "open" });
		}
		return out;
	}

	// ------------------------------------------------------------------ tính cảnh báo

	/** Tính toàn bộ cảnh báo của một bảng lương và ghép trạng thái đã lưu. Nhớ kết quả trong một lần chạy script. */
	function compute(batchId) {
		const id = String(batchId || "");
		if (!id) throw fail("The payroll batch is required", "Thiếu bảng lương");
		if (memo[id]) return memo[id];
		const batch = Store.get("batch", id);
		if (!batch) throw fail("Payroll batch not found", "Không tìm thấy bảng lương");
		const period = batch.period ? Store.get("period", batch.period) : null;
		const prev = previousBatch(batch, period);
		const all = linesOf([id, prev ? prev.batch.id : null]);
		const lines = all.filter((l) => l.batch === id);
		const prevLines = prev ? all.filter((l) => l.batch === String(prev.batch.id)) : null;
		const empIds = [...new Set(all.map((l) => l.employee).filter((x) => !blank(x)))];

		const profiles = {};
		const profileIds = {};
		const wanted = {};
		for (const l of lines) if (l.profile) wanted[l.employee] = l.profile;
		let needRegion = false;
		for (const p of empIds.length ? Store.findIn("employee", "employee", empIds) : []) {
			// Một nhân viên một hồ sơ; nếu có nhiều thì ưu tiên hồ sơ gắn trên dòng bảng lương
			if (profiles[p.employee] && wanted[p.employee] !== p.id) continue;
			profileIds[p.employee] = p.id;
			profiles[p.employee] = {
				salary_type: p.salary_type || "M", employment_type: p.employment_type || "E", hire_date: p.hire_date, termination_date: p.termination_date,
				ins_applicable: p.ins_applicable, region: p.region || "", hasTaxCode: !blank(String(p.tax_code || "").trim()),
				hasBank: !blank(String(p.bank_account || "").trim()) && !blank(String(p.bank_name || "").trim()),
			};
			if (!p.region) needRegion = true;
		}

		const hours = {};
		const manualEarnings = {};
		if (lines.length) {
			for (const t of Store.find("batch_time", { where: "{batch} = ?", params: [id] })) hours[t.employee] = (hours[t.employee] || 0) + num(t.hours);
			for (const i of Store.find("batch_input", { where: "{batch} = ?", params: [id] })) if (i.kind === "E") manualEarnings[i.employee] = (manualEarnings[i.employee] || 0) + 1;
		}

		const options = checkOptions(period);
		// Bảng có lỗi tính thì cờ calculated tắt nhưng các dòng khác đã có số: vẫn kiểm số của các dòng đó
		options.calculated = batch.calculated === true || lines.some((l) => num(l.gross) !== 0 || !blank(l.error));
		if (needRegion && options.minInsuranceWage && typeof options.minInsuranceWage === "object") options.defaultRegion = defaultRegion(batch.subsidiary);

		const raw = Rules.evaluate({
			lines, prevLines, profiles, hours, manualEarnings,
			period: period ? { start: period.start, end: period.end, attLocked: period.att_status === "L" } : {},
			prevPeriod: prev ? { start: prev.period.start, end: prev.period.end } : {},
			options,
		});
		const stored = storedResults(id);
		const merged = Rules.merge(raw, stored);
		const info = employeesInfo(empIds.concat(merged.map((it) => it.assignee)));
		const l = lang();
		const items = Rules.sort(
			merged.map((it) => {
				const text = Rules.describe(it, l);
				const e = it.employee ? info[it.employee] || {} : {};
				return Object.assign({}, it, {
					title: text.title, headline: text.headline, description: text.description, hint: text.hint,
					employeeCode: e.code || "", employeeName: e.name || "", assigneeName: it.assignee ? (info[it.assignee] || {}).name || "" : "", canClose: Rules.canClose(it),
				});
			})
		);
		memo[id] = { batch, period, prev, items, lines, prevLines, profiles, profileIds, hours, stored, info };
		return memo[id];
	}

	const publicItem = (it) => ({
		key: it.key, rule: it.rule, severity: it.severity, title: it.title, headline: it.headline, employee: it.employee, employeeCode: it.employeeCode, employeeName: it.employeeName,
		lineId: it.lineId, amount: it.amount, status: it.status, assignee: it.assignee, assigneeName: it.assigneeName, note: it.note, reopened: it.reopened, canClose: it.canClose,
	});

	function batchView(c) {
		const b = c.batch;
		const p = c.period || {};
		return {
			id: b.id, name: b.name || "", status: b.status, calculated: b.calculated === true, period: b.period || null, periodName: p.name || "", periodStart: p.start || null, periodEnd: p.end || null,
			prevBatch: c.prev ? { id: c.prev.batch.id, name: c.prev.batch.name || "", periodName: c.prev.period.name || "", periodStart: c.prev.period.start, periodEnd: c.prev.period.end } : null,
		};
	}

	/** Số cảnh báo của bảng lương cho thanh bước và thẻ số liệu. */
	function summary(batchId) {
		return Rules.counts(compute(batchId).items);
	}

	/** Các cảnh báo mức error đang chặn duyệt. */
	function blockers(batchId) {
		return Rules.blocking(compute(batchId).items).map(publicItem);
	}

	/** Ném lỗi nghiệp vụ khi bảng lương còn cảnh báo mức error. */
	function assertApprovable(batchId) {
		const n = Rules.blocking(compute(batchId).items).length;
		if (n) throw fail(`The batch still has ${n} blocking check(s); fix the data and recalculate before approving`, `Bảng lương còn ${n} lỗi kiểm tra chặn duyệt; hãy sửa dữ liệu và tính lại trước khi duyệt`);
	}

	/** Người có thể được giao xử lý: nhân viên có quyền đăng nhập; không đọc được thì chỉ gồm người đang dùng và người đã được giao. */
	function assignees(c) {
		const out = {};
		try {
			const rows = Store.run("SELECT e.id, e.entityid, e.firstname, e.lastname FROM employee e WHERE e.isinactive = 'F' AND e.giveaccess = 'T' ORDER BY e.lastname, e.firstname", [], "s4vp_checks_assignees");
			for (const r of rows.slice(0, ASSIGNEE_MAX)) out[String(r.id)] = { id: String(r.id), name: [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || r.entityid || "" };
		} catch (e) {
			// vai trò không đọc được trường giveaccess: dùng danh sách tối thiểu bên dưới
		}
		const me = currentUser();
		if (me.id && !out[me.id]) out[me.id] = { id: me.id, name: me.name };
		for (const it of c.items) if (it.assignee && !out[it.assignee]) out[it.assignee] = { id: it.assignee, name: it.assigneeName || it.assignee };
		return Object.values(out).sort((a, b) => String(a.name).localeCompare(String(b.name)));
	}

	/**
	 * Danh sách cảnh báo. Bảng lương lớn có thể có vài nghìn cảnh báo: truyền `limit` để chỉ nhận N mục đầu (lỗi trước, cảnh báo
	 * chưa đóng, rồi phần còn lại) kèm `groups` (số lượng theo quy tắc) và `truncated`; `rule` lọc một quy tắc; `brief` bỏ danh
	 * sách người phụ trách (màn Chạy lương không cần).
	 */
	function checksList(params) {
		const q = params || {};
		const c = compute(q.batch);
		let items = c.items;
		const groupsBy = {};
		// Số điểm mở (không tính mức info) theo nhân viên: lưới nhân viên dùng khi danh sách bị giới hạn
		const byEmployee = {};
		for (const it of items) {
			if (it.status === "open" && it.severity !== "info" && !blank(it.employee)) {
				const e = byEmployee[String(it.employee)] || (byEmployee[String(it.employee)] = { open: 0, errors: 0 });
				e.open++;
				if (it.severity === "error") e.errors++;
			}
			const g = groupsBy[it.rule] || (groupsBy[it.rule] = { rule: it.rule, title: it.title, severity: it.severity, total: 0, open: 0 });
			g.total++;
			if (it.status === "open") g.open++;
		}
		if (q.rule) items = items.filter((it) => it.rule === q.rule);
		const total = items.length;
		const limit = Math.floor(Number(q.limit) || 0);
		if (limit > 0 && items.length > limit) {
			const rank = (it) => (it.status === "open" ? 0 : 3) + (it.severity === "error" ? 0 : it.severity === "warn" ? 1 : 2);
			items = items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).slice(0, limit).map((x) => x.it);
		}
		const out = { batch: batchView(c), counts: Rules.counts(c.items), blocking: Rules.blocking(c.items).length, items: items.map(publicItem), total, truncated: items.length < total, groups: Object.keys(groupsBy).map((k) => groupsBy[k]), byEmployee };
		if (!q.brief) out.assignees = assignees(c);
		return out;
	}

	// ------------------------------------------------------------------ chi tiết một cảnh báo

	function parseJson(s, def) {
		try {
			return s ? JSON.parse(s) : def;
		} catch (e) {
			return def;
		}
	}

	const keyOf = (rule, employee) => (blank(employee) ? String(rule || "") : `${rule}:${employee}`);

	/** So sánh từng khoản của nhân viên giữa kỳ này và kỳ trước (thu nhập theo loại, bảo hiểm, thuế, khấu trừ, thực lĩnh). */
	function compareOf(c, employee) {
		const ids = [c.batch.id].concat(c.prev ? [c.prev.batch.id] : []);
		const rows = Store.find("batch_emp", { where: `{batch} IN (${ids.map(() => "?").join(",")}) AND {employee} = ?`, params: ids.concat([employee]) });
		const cur = rows.find((r) => r.batch === String(c.batch.id)) || null;
		const prev = c.prev ? rows.find((r) => r.batch === String(c.prev.batch.id)) || null : null;
		if (!cur && !prev) return null;
		const names = {};
		try {
			for (const e of Store.find("earning_type", { includeInactive: true })) names[String(e.name).trim().toUpperCase()] = e.description || e.name;
		} catch (e) {
			// không đọc được danh mục: hiện mã loại thu nhập
		}
		const sumEarnings = (line) => {
			const out = {};
			const order = [];
			for (const x of (line ? parseJson(line.detail, {}).earnings : null) || []) {
				const code = String(x.earningType || "").trim().toUpperCase() || "?";
				if (!(code in out)) order.push(code);
				out[code] = (out[code] || 0) + num(x.amount);
			}
			return { out, order };
		};
		const a = sumEarnings(cur);
		const b = sumEarnings(prev);
		const table = [];
		const push = (key, label, pv, cv, strong) => {
			const diff = num(cv) - num(pv);
			table.push({ key, label, prev: prev ? num(pv) : null, cur: cur ? num(cv) : null, diff: prev && cur ? diff : null, ratio: prev && cur && num(pv) !== 0 ? diff / Math.abs(num(pv)) : null, strong: !!strong, changed: !!(prev && cur) && Math.round(diff) !== 0 });
		};
		for (const code of a.order.concat(b.order.filter((x) => !(x in a.out)))) push(`earning:${code}`, names[code] || code, b.out[code], a.out[code], false);
		const f = (line, k) => (line ? num(line[k]) : 0);
		push("gross", "", f(prev, "gross"), f(cur, "gross"), true);
		push("ee_ins", "", f(prev, "ee_ins"), f(cur, "ee_ins"), false);
		push("pit", "", f(prev, "pit"), f(cur, "pit"), false);
		if (f(prev, "other_ded") || f(cur, "other_ded")) push("other_ded", "", f(prev, "other_ded"), f(cur, "other_ded"), false);
		if (f(prev, "advance") || f(cur, "advance")) push("advance", "", f(prev, "advance"), f(cur, "advance"), false);
		push("net", "", f(prev, "net"), f(cur, "net"), true);
		return {
			hasPrev: !!prev, hasCur: !!cur, periodName: (c.period || {}).name || "", periodEnd: (c.period || {}).end || null,
			prevPeriodName: c.prev ? c.prev.period.name || "" : "", prevPeriodEnd: c.prev ? c.prev.period.end : null, prevBatch: c.prev ? c.prev.batch.id : null, rows: table,
		};
	}

	/** Số liệu nền giúp hiểu vì sao có cảnh báo: công, giờ, ngày vào làm / nghỉ việc, lương đóng bảo hiểm và mức tối thiểu. */
	function factsOf(c, item) {
		const out = [];
		const add = (key, value, kind) => {
			if (!blank(value)) out.push({ key, value, kind });
		};
		if (!item.employee) {
			add("employees", c.lines.length, "num");
			return out;
		}
		const line = c.lines.find((l) => l.employee === item.employee) || null;
		const prof = c.profiles[item.employee] || null;
		if (prof) {
			add("salaryType", prof.salary_type, "salaryType");
			add("hireDate", prof.hire_date, "date");
			add("terminationDate", prof.termination_date, "date");
		}
		if (line) {
			add("stdDays", line.std_days, "num");
			add("workDays", blank(line.work_days) ? 0 : line.work_days, "num");
			if (prof && prof.salary_type === "H") add("hours", num(c.hours[item.employee]), "num");
		}
		if (item.rule === "INS_BELOW_MIN") {
			add("insuranceWage", item.data.wage, "money");
			add("minWage", item.data.min, "money");
			add("region", item.data.region, "text");
		}
		if (item.rule === "NET_CHANGE") add("threshold", item.data.threshold, "pct");
		return out;
	}

	function checkDetail(params) {
		const p = params || {};
		const c = compute(p.batch);
		const key = keyOf(p.rule, p.employee);
		const item = c.items.find((it) => it.key === key) || null;
		const saved = c.stored[key] || null;
		const history = saved ? parseJson(saved.history, []).slice().reverse() : [];
		if (!item) {
			// Cảnh báo không còn (dữ liệu đã sửa, đã tính lại): trả lịch sử để người dùng vẫn xem được việc đã làm
			return { batch: batchView(c), item: null, facts: [], compare: null, inputs: [], history, profileId: null };
		}
		let inputs = [];
		if (item.employee) {
			inputs = Store.find("batch_input", { where: "{batch} = ? AND {employee} = ?", params: [c.batch.id, item.employee] }).map((i) => ({ id: i.id, kind: i.kind, description: i.description || i.code || "", amount: num(i.amount) }));
		}
		return {
			batch: batchView(c),
			item: Object.assign(publicItem(item), { description: item.description, hint: item.hint, data: item.data }),
			facts: factsOf(c, item),
			compare: item.employee ? compareOf(c, item.employee) : null,
			inputs,
			history,
			profileId: item.employee ? c.profileIds[item.employee] || null : null,
		};
	}

	// ------------------------------------------------------------------ lưu kết quả xử lý

	function resolveCheck(body) {
		const b = body || {};
		const c = compute(b.batch);
		const key = keyOf(b.rule, b.employee);
		const item = c.items.find((it) => it.key === key);
		if (!item) throw fail("This check no longer exists; refresh the list", "Cảnh báo này không còn (dữ liệu đã thay đổi), hãy tải lại danh sách");
		const saved = c.stored[key] || null;
		const status = blank(b.status) ? item.status : String(b.status);
		if (!STATUS_CODE[status]) throw fail(`Unknown status ${status}`, `Trạng thái không hợp lệ ${status}`);
		const note = String(b.note === undefined || b.note === null ? item.note : b.note).trim().slice(0, 3900);
		const assignee = b.assignee === undefined ? item.assignee : blank(b.assignee) ? null : String(b.assignee);
		if (assignee && !/^\d+$/.test(assignee)) throw fail("Invalid assignee", "Người phụ trách không hợp lệ");
		const closing = status !== "open";
		if (closing && !Rules.canClose(item)) throw fail("Errors cannot be closed by hand: fix the data and recalculate, the check then disappears", "Lỗi không đóng tay được: hãy sửa dữ liệu và tính lại, cảnh báo sẽ tự mất");
		if (closing && !note) throw fail("A note is required to close a check", "Cần ghi chú khi đóng cảnh báo");

		const me = currentUser();
		const history = saved ? parseJson(saved.history, []) : [];
		let assigneeName = "";
		if (assignee) assigneeName = (c.info[assignee] || employeesInfo([assignee])[assignee] || {}).name || "";
		history.push({ at: new Date().toISOString(), user: me.name, userId: me.id, status, note, assignee, assigneeName });
		const values = {
			batch: c.batch.id, rule: item.rule, employee: item.employee, status: STATUS_CODE[status], assignee, note, updated_by: me.id, updated_date: Clock.today(), key,
			stamp: closing ? Rules.fingerprint(item) : "", history: JSON.stringify(history.slice(-HISTORY_MAX)),
		};
		const id = saved ? Store.update("check_result", saved.id, values) : Store.create("check_result", values);
		delete memo[String(c.batch.id)];
		const after = compute(c.batch.id);
		return { ok: true, id, key, rule: item.rule, employee: item.employee, employeeCode: item.employeeCode, status, previous: item.status, counts: Rules.counts(after.items) };
	}

	const routes = {
		get: {
			checksList: { roles: "payroll", run: checksList },
			checkDetail: { roles: "payroll", run: checkDetail },
		},
		post: {
			resolveCheck: { roles: "payroll", run: resolveCheck },
		},
	};

	return { routes, summary, blockers, assertApprovable, checksList, checkDetail, resolveCheck };
});
