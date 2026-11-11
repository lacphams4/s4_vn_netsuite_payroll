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
 *   GET  checksList  { batch, rule?, severity?, status?, q?, offset?, limit?, brief? }
 *                    -> { batch, counts, blocking, items, total, offset, truncated, groups, bySeverity, byEmployee?, assignees? }
 *                    Lọc và phân trang phía máy chủ (bảng lương 1.000 nhân viên có vài nghìn cảnh báo): `items` là trang
 *                    [offset, offset + limit) của danh sách đã lọc (limit trống = tất cả), `total` là số mục khớp bộ lọc;
 *                    counts / blocking / groups luôn tính trên TOÀN BỘ cảnh báo; groups = [{rule, title, severity, total, open,
 *                    closable}] để xử lý theo nhóm quy tắc; bySeverity đếm theo mức độ trong phạm vi các bộ lọc còn lại.
 *                    `brief`: không kèm assignees, mục gọn (bỏ trường rỗng); có `offset`: không kèm byEmployee.
 *   GET  checkDetail { batch, rule, employee } -> { item, facts, compare, inputs, history, profileId }
 *   POST resolveCheck { batch, rule, employee, status, note, assignee } -> { ok, key, status, counts, ... }
 *   POST resolveCheckGroup { batch, rule, status: 'accepted' | 'resolved', note, assignee? } -> { ok, rule, status, closed, more, counts, left }
 *                    Đóng mọi cảnh báo còn mở của một quy tắc (không áp dụng cho mức error), cùng điều kiện với resolveCheck (ghi
 *                    chú bắt buộc, lưu dấu số liệu và lịch sử từng mục). Làm theo lượt: mỗi lượt gọi tối đa GROUP_STEP mục, còn
 *                    thì trả more = true (lib/api.js tự gọi lại, cộng dồn `closed`).
 *
 * Governance: mỗi lần tính đọc theo lô, số truy vấn KHÔNG phụ thuộc số nhân viên: bảng lương + kỳ + các bảng lương cùng công
 * ty con để tìm kỳ trước (1, api/Lean.batchesNear), dòng kỳ này + kỳ trước kèm tên nhân viên (1, api/Lean.batchLines), hồ sơ lương chỉ các cột quy tắc
 * cần (1, lọc bằng truy vấn con thay cho IN 900 id), tham số (1), kết quả đã lưu (1, không đọc lịch sử); giờ công và dòng nhập
 * tay chỉ đọc (dạng gom nhóm) khi bảng lương có hồ sơ lương giờ. Kết quả tính được nhớ trong một lần chạy script.
 * Không đọc mã số thuế, số tài khoản: SQL chỉ trả cờ có / không.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Clock", "./Lean", "../core/PayrollChecks"], (runtime, Store, Clock, Lean, Rules) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const num = (v) => {
		const n = Number(v);
		return blank(v) || !isFinite(n) ? 0 : n;
	};
	const STATUS_CODE = { open: "O", accepted: "A", resolved: "R" };
	const STATUS_NAME = { O: "open", A: "accepted", R: "resolved" };
	const PROFILE_KEYS = ["employee", "salary_type", "employment_type", "hire_date", "termination_date", "ins_applicable", "region"];
	const RESULT_KEYS = ["rule", "employee", "status", "assignee", "note", "stamp"];
	// Đóng cả nhóm: số mục mỗi lượt gọi, thời gian tối đa một lượt, governance tối thiểu phải còn (mỗi mục ghi một record)
	const GROUP_STEP = 60;
	const GROUP_MS = 20000;
	const GROUP_MIN_USAGE = 200;
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

	/** Tên và mã nhân viên của nhiều id trong một truy vấn (mỗi 900 id); chỉ dùng cho người phụ trách không có dòng trong bảng lương. */
	function employeesInfo(ids) {
		const out = {};
		const list = [...new Set((ids || []).filter((x) => !blank(x)).map(String))];
		for (let i = 0; i < list.length; i += 900) {
			const rows = Store.run(`SELECT e.id, e.entityid, e.firstname, e.lastname FROM employee e WHERE e.id IN (${Lean.idList(list.slice(i, i + 900))})`, [], "s4vp_checks_employees");
			for (const r of rows) out[String(r.id)] = { id: String(r.id), code: r.entityid || "", name: [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || r.entityid || "" };
		}
		return out;
	}

	/** Bảng lương và kỳ của nó (dự phòng khi Lean.batchesNear không trả chính bảng lương: đã vô hiệu, không có công ty con). */
	function header(id) {
		const keys = ["name", "status", "calculated", "subsidiary", "paygroup", "period"];
		const pKeys = ["name", "start", "end", "att_status"];
		const r = Lean.select("batch", keys, {
			where: "{id} = ?", params: [id], includeInactive: true, tag: "s4vp_checks_batch",
			join: `LEFT JOIN ${Lean.rec("period").type} p ON p.id = ${Lean.col("batch", "period")}`,
			extra: Lean.cols("period", pKeys, "p", "p_"), raw: pKeys.map((k) => `p_${k}`),
		})[0];
		if (!r) return null;
		const period = !blank(r.period) && (!blank(r.p_start) || !blank(r.p_name)) ? Lean.row("period", pKeys, r, "p_", { id: r.period }) : null;
		const batch = {};
		for (const k of ["id"].concat(keys)) batch[k] = r[k];
		return { batch, period };
	}

	/**
	 * Bảng lương kỳ trước để so sánh: cùng công ty con, cùng nhóm lương, chưa bị đảo, kỳ kết thúc trước ngày bắt đầu kỳ này
	 * và gần nhất. Xác định theo NGÀY kết thúc kỳ, không theo mã kỳ (mã kỳ có thể lệch tháng so với ngày).
	 */
	function previousBatch(batch, period, near) {
		if (!period || blank(period.start)) return null;
		let best = null;
		for (const b of near || []) {
			if (String(b.id) === String(batch.id) || b.status === "V" || String(b.paygroup || "") !== String(batch.paygroup || "")) continue;
			if (blank(b.periodEnd) || !(String(b.periodEnd) < String(period.start))) continue;
			if (!best || String(b.periodEnd) > String(best.periodEnd) || (String(b.periodEnd) === String(best.periodEnd) && Number(b.id) > Number(best.id))) best = b;
		}
		return best ? { batch: { id: best.id, name: best.name }, period: { name: best.periodName, start: best.periodStart, end: best.periodEnd } } : null;
	}

	/** Ngưỡng và mức tối thiểu lấy từ bảng tham số của thiết lập, hiệu lực tại ngày cuối kỳ. Không có thì để trống. */
	function checkOptions(period) {
		const out = { netChangeThreshold: null, minInsuranceWage: null, minInsuranceParam: "" };
		const end = period && period.end ? String(period.end) : "";
		let rows = [];
		try {
			rows = Lean.select("param", ["name", "value", "effective", "expiration"], { where: "UPPER({name}) LIKE ? OR UPPER({name}) LIKE ?", params: [`${PARAM_MINWAGE}%`, "CHECK.%"], tag: "s4vp_checks_params" });
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

	/** Kết quả xử lý đã lưu của bảng lương: { <key>: record } (không đọc lịch sử). Record chưa được deploy thì coi như chưa có gì. */
	function storedResults(batchId) {
		const out = {};
		let rows = [];
		try {
			rows = Lean.select("check_result", RESULT_KEYS, { where: "{batch} = ?", params: [batchId], tag: "s4vp_checks_results" });
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

	/** Lịch sử xử lý của các kết quả đã lưu: { <id record>: [..] } (một truy vấn cho cả lô). */
	function historiesOf(ids) {
		const out = {};
		const list = Lean.idList(ids);
		if (list === "0") return out;
		for (const r of Lean.select("check_result", ["history"], { where: `{id} IN (${list})`, tag: "s4vp_checks_history" })) out[r.id] = parseJson(r.history, []);
		return out;
	}

	/**
	 * Hồ sơ lương của nhân viên có dòng trong các bảng lương: chỉ các cột quy tắc cần; mã số thuế và tài khoản ngân hàng chỉ
	 * lấy cờ có / không. Lọc bằng truy vấn con trên dòng bảng lương nên chỉ một truy vấn dù bao nhiêu nhân viên.
	 */
	function profilesOf(batchIds) {
		const sub = `SELECT ${Lean.col("batch_emp", "employee", "l")} FROM ${Lean.rec("batch_emp").type} l WHERE ${Lean.col("batch_emp", "batch", "l")} IN (${Lean.idList(batchIds)}) AND l.isinactive = 'F'`;
		const has = (key) => `TRIM(${Lean.col("employee", key)}) IS NULL`;
		return Lean.select("employee", PROFILE_KEYS, {
			where: `{employee} IN (${sub})`, tag: "s4vp_checks_profiles",
			extra: [`CASE WHEN ${has("tax_code")} THEN 'F' ELSE 'T' END AS has_tax`, `CASE WHEN ${has("bank_account")} OR ${has("bank_name")} THEN 'F' ELSE 'T' END AS has_bank`],
			raw: ["has_tax", "has_bank"],
		});
	}

	/** Tổng theo nhân viên của một bảng con của bảng lương (gom nhóm trong SQL, không kéo từng dòng). */
	function sumByEmployee(name, expr, batchId, extraWhere, extraParams, tag) {
		const emp = Lean.col(name, "employee");
		const sql = `SELECT ${emp} AS emp, ${expr} AS n FROM ${Lean.rec(name).type} t WHERE ${Lean.col(name, "batch")} = ? AND t.isinactive = 'F'${extraWhere ? ` AND ${extraWhere}` : ""} GROUP BY ${emp}`;
		const out = {};
		for (const r of Store.run(sql, [batchId].concat(extraParams || []), tag)) if (!blank(r.emp)) out[String(r.emp)] = num(r.n);
		return out;
	}

	// ------------------------------------------------------------------ tính cảnh báo

	/**
	 * Đọc dữ liệu và tính cảnh báo của một bảng lương, ghép trạng thái đã lưu. Chưa có chữ hiển thị (xem compute): đủ cho số
	 * đếm (summary, assertApprovable). Nhớ kết quả trong một lần chạy script.
	 */
	function load(batchId) {
		const id = String(batchId || "");
		if (!id) throw fail("The payroll batch is required", "Thiếu bảng lương");
		if (memo[id]) return memo[id];
		// Một truy vấn: bảng lương này, kỳ của nó và các bảng lương cùng công ty con (để tìm kỳ trước)
		const near = Lean.batchesNear(id);
		const me = near.find((b) => String(b.id) === id) || null;
		let batch;
		let period;
		if (me) {
			batch = { id: me.id, name: me.name, status: me.status, calculated: me.calculated, subsidiary: me.subsidiary, paygroup: me.paygroup, period: me.period };
			period = !blank(me.period) && (!blank(me.periodStart) || !blank(me.periodName)) ? { id: me.period, name: me.periodName, start: me.periodStart, end: me.periodEnd, att_status: me.periodAtt } : null;
		} else {
			const h = header(id);
			if (!h) throw fail("Payroll batch not found", "Không tìm thấy bảng lương");
			batch = h.batch;
			period = h.period;
		}
		const prev = previousBatch(batch, period, near);
		const all = Lean.batchLines([id, prev ? prev.batch.id : null]);
		const lines = all.filter((l) => l.batch === id);
		const prevLines = prev ? all.filter((l) => l.batch === String(prev.batch.id)) : null;
		const info = {};
		for (const l of all) if (!blank(l.employee) && !info[l.employee]) info[l.employee] = { id: l.employee, code: l.code || "", name: l.name || "" };

		const profiles = {};
		const profileIds = {};
		const wanted = {};
		for (const l of lines) if (l.profile) wanted[l.employee] = l.profile;
		let needRegion = false;
		let hourly = false;
		for (const p of all.length ? profilesOf([id, prev ? prev.batch.id : null]) : []) {
			// Một nhân viên một hồ sơ; nếu có nhiều thì ưu tiên hồ sơ gắn trên dòng bảng lương
			if (profiles[p.employee] && wanted[p.employee] !== p.id) continue;
			profileIds[p.employee] = p.id;
			profiles[p.employee] = {
				salary_type: p.salary_type || "M", employment_type: p.employment_type || "E", hire_date: p.hire_date, termination_date: p.termination_date,
				ins_applicable: p.ins_applicable, region: p.region || "", hasTaxCode: p.has_tax === "T" || p.has_tax === true, hasBank: p.has_bank === "T" || p.has_bank === true,
			};
			if (!p.region) needRegion = true;
		}
		for (const l of lines) if (profiles[l.employee] && profiles[l.employee].salary_type === "H") hourly = true;

		// Giờ công và dòng nhập tay chỉ ảnh hưởng quy tắc của hồ sơ lương giờ: bảng lương không có ai lương giờ thì không đọc
		let hours = {};
		let manualEarnings = {};
		if (hourly) {
			hours = sumByEmployee("batch_time", `SUM(${Lean.col("batch_time", "hours")})`, id, "", [], "s4vp_checks_hours");
			manualEarnings = sumByEmployee("batch_input", "COUNT(*)", id, `${Lean.col("batch_input", "kind")} = ?`, [Store.idOf("input_kind", "E")], "s4vp_checks_inputs");
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
		memo[id] = { batch, period, prev, merged: Rules.merge(raw, stored), lines, prevLines, profiles, profileIds, hours, stored, info, full: false };
		return memo[id];
	}

	/**
	 * Cảnh báo đã sắp thứ tự và có tên nhân viên, người phụ trách (c.items). Chữ hiển thị (title, headline, description, hint) chỉ
	 * dựng cho mục được trả về (withText) - bảng lương lớn có vài nghìn mục.
	 */
	function compute(batchId) {
		const c = load(batchId);
		if (c.full) return c;
		const missing = [...new Set(c.merged.map((it) => it.assignee).filter((x) => !blank(x) && !c.info[x]))];
		if (missing.length) Object.assign(c.info, employeesInfo(missing));
		for (const it of c.merged) {
			const e = it.employee ? c.info[it.employee] || {} : {};
			it.employeeCode = e.code || "";
			it.employeeName = e.name || "";
			it.assigneeName = it.assignee ? (c.info[it.assignee] || {}).name || "" : "";
			it.canClose = Rules.canClose(it);
		}
		c.lang = lang();
		c.items = Rules.sort(c.merged);
		c.full = true;
		return c;
	}

	function withText(c, it) {
		if (it.title === undefined) {
			const text = Rules.describe(it, c.lang);
			it.title = text.title;
			it.headline = text.headline;
			it.description = text.description;
			it.hint = text.hint;
		}
		return it;
	}

	const publicItem = (it) => ({
		key: it.key, rule: it.rule, severity: it.severity, title: it.title, headline: it.headline, employee: it.employee, employeeCode: it.employeeCode, employeeName: it.employeeName,
		lineId: it.lineId, amount: it.amount, status: it.status, assignee: it.assignee, assigneeName: it.assigneeName, note: it.note, reopened: it.reopened, canClose: it.canClose,
	});

	/** Mục gọn cho danh sách dài: bỏ trường rỗng (null, chuỗi rỗng, false). */
	const briefItem = (it) => {
		const out = publicItem(it);
		for (const k of Object.keys(out)) if (out[k] === null || out[k] === undefined || out[k] === "" || out[k] === false) delete out[k];
		return out;
	};

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
		return Rules.counts(load(batchId).merged);
	}

	/** Các cảnh báo mức error đang chặn duyệt. */
	function blockers(batchId) {
		const c = compute(batchId);
		return Rules.blocking(c.items).map((it) => publicItem(withText(c, it)));
	}

	/** Ném lỗi nghiệp vụ khi bảng lương còn cảnh báo mức error. */
	function assertApprovable(batchId) {
		const n = Rules.blocking(load(batchId).merged).length;
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

	/** Chữ để so khớp ô tìm: chữ thường, bỏ dấu tiếng Việt. */
	function fold(s) {
		const t = String(blank(s) ? "" : s).toLowerCase();
		try {
			return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
		} catch (e) {
			return t;
		}
	}

	/** Số lượng theo quy tắc trên toàn bộ cảnh báo: [{rule, title, severity, total, open, closable}] (closable = còn mở và đóng tay được). */
	function groupsOf(c) {
		const by = {};
		const order = [];
		for (const it of c.items) {
			let g = by[it.rule];
			if (!g) {
				g = by[it.rule] = { rule: it.rule, title: withText(c, it).title, severity: it.severity, total: 0, open: 0, closable: 0 };
				order.push(g);
			}
			g.total++;
			if (it.status === "open") {
				g.open++;
				if (it.canClose) g.closable++;
			}
		}
		return order;
	}

	/**
	 * Danh sách cảnh báo, lọc và phân trang phía máy chủ. Tham số (đều tùy chọn trừ batch):
	 *   rule, severity ('error' | 'warn' | 'info'), status ('open' | 'accepted' | 'resolved'), q (ô tìm: mã / tên nhân viên, tên
	 *   cảnh báo, dòng tóm tắt, ghi chú, người phụ trách; không phân biệt hoa thường và dấu), offset, limit (trống = tất cả).
	 * Thứ tự cố định (core/PayrollChecks.sort): còn mở trước, lỗi rồi cảnh báo rồi thông tin, theo quy tắc, theo tên nhân viên -
	 * nên `limit` không kèm offset vẫn là "N mục cần xử lý trước" như trước đây.
	 * counts, blocking, groups tính trên toàn bộ cảnh báo; total là số mục khớp bộ lọc; bySeverity đếm theo mức độ với các bộ lọc
	 * khác (rule, status, q). `brief`: mục gọn, không kèm assignees (màn Chạy lương). Có `offset`: không kèm byEmployee.
	 */
	function checksList(params) {
		const q = params || {};
		const c = compute(q.batch);
		const paged = !blank(q.offset);
		const out = { batch: batchView(c), counts: Rules.counts(c.items), blocking: Rules.blocking(c.items).length };

		const words = fold(q.q).split(/\s+/).filter((w) => w);
		const matches = (it) => {
			if (!words.length) return true;
			withText(c, it);
			const text = fold([it.employeeCode, it.employeeName, it.title, it.headline, it.note, it.assigneeName].join(" "));
			return words.every((w) => text.indexOf(w) >= 0);
		};
		// Khóa "error" trong JSON trả về làm N/https phía trình duyệt từ chối phản hồi: mức lỗi gửi dưới khóa "err"
		const bySeverity = { err: 0, warn: 0, info: 0 };
		const filtered = [];
		for (const it of c.items) {
			if (!blank(q.rule) && it.rule !== String(q.rule)) continue;
			if (!blank(q.status) && it.status !== String(q.status)) continue;
			if (!matches(it)) continue;
			const sk = it.severity === "error" ? "err" : it.severity;
			bySeverity[sk] = (bySeverity[sk] || 0) + 1;
			if (!blank(q.severity) && it.severity !== String(q.severity)) continue;
			filtered.push(it);
		}
		const total = filtered.length;
		const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
		const limit = Math.floor(Number(q.limit) || 0);
		const page = limit > 0 ? filtered.slice(offset, offset + limit) : filtered.slice(offset);
		out.items = page.map((it) => (q.brief ? briefItem(withText(c, it)) : publicItem(withText(c, it))));
		out.total = total;
		out.offset = offset;
		out.truncated = offset + page.length < total;
		out.groups = groupsOf(c);
		out.bySeverity = bySeverity;
		if (!paged) {
			// Số điểm mở (không tính mức info) theo nhân viên: lưới nhân viên của màn Chạy lương dùng khi danh sách bị giới hạn
			const byEmployee = {};
			for (const it of c.items) {
				if (it.status !== "open" || it.severity === "info" || blank(it.employee)) continue;
				const e = byEmployee[String(it.employee)] || (byEmployee[String(it.employee)] = { open: 0 });
				e.open++;
				if (it.severity === "error") e.errors = (e.errors || 0) + 1;
			}
			out.byEmployee = byEmployee;
		}
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
		const history = saved ? (historiesOf([saved.id])[saved.id] || []).slice().reverse() : [];
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
			item: Object.assign(publicItem(withText(c, item)), { description: item.description, hint: item.hint, data: item.data }),
			facts: factsOf(c, item),
			compare: item.employee ? compareOf(c, item.employee) : null,
			inputs,
			history,
			profileId: item.employee ? c.profileIds[item.employee] || null : null,
		};
	}

	// ------------------------------------------------------------------ lưu kết quả xử lý

	/** Kiểm tra yêu cầu đóng / mở / ghi chú cho một mục; trả giá trị đã chuẩn hóa. */
	function resolveInput(item, b) {
		const status = blank(b.status) ? item.status : String(b.status);
		if (!STATUS_CODE[status]) throw fail(`Unknown status ${status}`, `Trạng thái không hợp lệ ${status}`);
		const note = String(b.note === undefined || b.note === null ? item.note : b.note).trim().slice(0, 3900);
		const assignee = b.assignee === undefined ? item.assignee : blank(b.assignee) ? null : String(b.assignee);
		if (assignee && !/^\d+$/.test(assignee)) throw fail("Invalid assignee", "Người phụ trách không hợp lệ");
		const closing = status !== "open";
		if (closing && !Rules.canClose(item)) throw fail("Errors cannot be closed by hand: fix the data and recalculate, the check then disappears", "Lỗi không đóng tay được: hãy sửa dữ liệu và tính lại, cảnh báo sẽ tự mất");
		if (closing && !note) throw fail("A note is required to close a check", "Cần ghi chú khi đóng cảnh báo");
		return { status, note, assignee, closing };
	}

	/** Ghi kết quả xử lý của một mục (tạo hoặc cập nhật record check_result) và cập nhật bản đang nhớ; trả id record. */
	function writeResult(c, item, v, me, history, assigneeName) {
		const saved = c.stored[item.key] || null;
		const list = (history || []).concat([{ at: new Date().toISOString(), user: me.name, userId: me.id, status: v.status, note: v.note, assignee: v.assignee, assigneeName }]);
		const stamp = v.closing ? Rules.fingerprint(item) : "";
		const values = {
			batch: c.batch.id, rule: item.rule, employee: item.employee, status: STATUS_CODE[v.status], assignee: v.assignee, note: v.note, updated_by: me.id, updated_date: Clock.today(), key: item.key,
			stamp, history: JSON.stringify(list.slice(-HISTORY_MAX)),
		};
		const id = saved ? Store.update("check_result", saved.id, values) : Store.create("check_result", values);
		c.stored[item.key] = { id: String(id), rule: item.rule, employee: item.employee, status: v.status, assignee: v.assignee, note: v.note, stamp };
		item.status = v.status;
		item.note = v.note;
		item.assignee = v.assignee;
		item.assigneeName = assigneeName;
		item.reopened = false;
		return id;
	}

	function resolveCheck(body) {
		const b = body || {};
		const c = compute(b.batch);
		const key = keyOf(b.rule, b.employee);
		const item = c.items.find((it) => it.key === key);
		if (!item) throw fail("This check no longer exists; refresh the list", "Cảnh báo này không còn (dữ liệu đã thay đổi), hãy tải lại danh sách");
		const saved = c.stored[key] || null;
		const previous = item.status;
		const v = resolveInput(item, b);
		const me = currentUser();
		let assigneeName = "";
		if (v.assignee) assigneeName = (c.info[v.assignee] || employeesInfo([v.assignee])[v.assignee] || {}).name || "";
		const id = writeResult(c, item, v, me, saved ? historiesOf([saved.id])[saved.id] || [] : [], assigneeName);
		return { ok: true, id, key, rule: item.rule, employee: item.employee, employeeCode: item.employeeCode, status: v.status, previous, counts: Rules.counts(c.items) };
	}

	function remainingUsage() {
		try {
			return Number(runtime.getCurrentScript().getRemainingUsage());
		} catch (e) {
			return Infinity;
		}
	}

	/**
	 * Đóng mọi cảnh báo còn mở của một quy tắc (xử lý theo nhóm). Cùng điều kiện với resolveCheck: mức error không đóng tay
	 * được, ghi chú bắt buộc, mỗi mục lưu dấu số liệu và một dòng lịch sử. Làm theo lượt (GROUP_STEP mục, GROUP_MS, governance):
	 * còn mục thì trả more = true để giao diện gọi lại cùng nội dung.
	 */
	function resolveCheckGroup(body) {
		const b = body || {};
		if (blank(b.rule)) throw fail("The check rule is required", "Thiếu quy tắc kiểm tra");
		const status = String(b.status || "");
		if (status !== "accepted" && status !== "resolved") throw fail(`Unknown status ${status}`, `Trạng thái không hợp lệ ${status}`);
		const c = compute(b.batch);
		const rule = String(b.rule);
		const group = c.items.filter((it) => it.rule === rule);
		if (!group.length) throw fail("This check no longer exists; refresh the list", "Cảnh báo này không còn (dữ liệu đã thay đổi), hãy tải lại danh sách");
		const todo = group.filter((it) => it.status === "open");
		const started = Date.now();
		const me = currentUser();
		let assigneeName = "";
		let closed = 0;
		if (todo.length) {
			// Kiểm một lần cho cả nhóm (cùng quy tắc nên cùng mức độ): lỗi nghiệp vụ ném trước khi ghi bất cứ mục nào
			const first = resolveInput(todo[0], { status, note: b.note, assignee: b.assignee });
			if (first.assignee) assigneeName = (c.info[first.assignee] || employeesInfo([first.assignee])[first.assignee] || {}).name || "";
			const step = todo.slice(0, GROUP_STEP);
			const histories = historiesOf(step.map((it) => (c.stored[it.key] || {}).id));
			for (const it of step) {
				if (closed && (Date.now() - started > GROUP_MS || remainingUsage() < GROUP_MIN_USAGE)) break;
				const v = resolveInput(it, { status, note: b.note, assignee: b.assignee });
				const saved = c.stored[it.key] || null;
				writeResult(c, it, v, me, saved ? histories[saved.id] || [] : [], assigneeName);
				closed++;
			}
		}
		const left = group.filter((it) => it.status === "open").length;
		return { ok: true, rule, status, closed, more: closed > 0 && left > 0, counts: Rules.counts(c.items), left: { open: left } };
	}

	const routes = {
		get: {
			checksList: { roles: "payroll", run: checksList },
			checkDetail: { roles: "payroll", run: checkDetail },
		},
		post: {
			resolveCheck: { roles: "payroll", run: resolveCheck },
			resolveCheckGroup: { roles: "payroll", run: resolveCheckGroup },
		},
	};

	return { routes, summary, blockers, assertApprovable, checksList, checkDetail, resolveCheck, resolveCheckGroup };
});
