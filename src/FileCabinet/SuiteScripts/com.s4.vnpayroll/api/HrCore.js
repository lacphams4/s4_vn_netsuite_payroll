/**
 * Nhân sự: danh sách, hồ sơ, hợp đồng lao động, quyết định nhân sự (giao diện bản 2). Mô-đun route (docs/UI_V2.md mục 5).
 *
 * GET  employeesPage  tìm và phân trang PHÍA MÁY CHỦ (không tải cả công ty về trình duyệt); số truy vấn không phụ thuộc số nhân viên
 * GET  employeeCard   toàn cảnh một người
 * GET  hrLookups      danh mục cho hộp thoại (phòng ban, địa điểm, lớp, dự án)
 * POST hrSaveContract, hrActivateContract, hrTerminateContract, hrSaveDecision, hrApplyDecision, hrSaveDependent
 *
 * Số tiền lương chỉ trả cho vai trò lương (canSeePay). Số định danh (mã số thuế, CCCD, sổ BHXH, tài khoản ngân hàng) KHÔNG
 * rời máy chủ: chỉ trả cờ có / không. Không ghi lương, số định danh vào log. Không xóa dữ liệu.
 * Áp dụng quyết định ghi hồ sơ lương và lịch sử lương qua Profiles.save (không viết lại nghiệp vụ lưu hồ sơ).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Profiles", "./WorkPermits", "./AllocationPlans", "./Clock", "../core/Dates", "../core/HrTimeline", "../core/LeaveLedger"], (runtime, Store, Profiles, WorkPermits, AllocationPlans, Clock, Dates, Timeline, Ledger) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const num = (v) => (blank(v) || isNaN(Number(v)) ? null : Number(v));
	// customrole_s4vp_demo: vai trò trình diễn, quyền như administrator với dữ liệu của gói
	const PAY_ROLES = ["administrator", "customrole_s4vp_hr", "customrole_s4vp_accountant", "customrole_s4vp_demo"];
	const EDIT_ROLES = ["administrator", "customrole_s4vp_hr", "customrole_s4vp_demo"];
	const FILTERS = ["all", "working", "probation", "expiring", "missing", "left"];
	const FAR = "9999-12-31";
	const DUE_LIMIT = 200;

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function failList(errors) {
		return fail(errors.map((m) => m.message).join(". "), errors.map((m) => m.messageVi).join(". "));
	}

	function role() {
		try {
			return String(runtime.getCurrentUser().roleId || "");
		} catch (e) {
			return "";
		}
	}

	const canSeePay = () => PAY_ROLES.includes(role());
	const canEdit = () => EDIT_ROLES.includes(role());

	function userId() {
		try {
			const u = runtime.getCurrentUser();
			return Number(u.id) > 0 ? String(u.id) : null;
		} catch (e) {
			return null;
		}
	}

	/** Id nội bộ là số nguyên: ghép thẳng vào câu lệnh (mục 12). Giá trị khác bị từ chối. */
	function intId(v, en, vi) {
		const s = String(blank(v) ? "" : v).trim();
		if (!/^\d+$/.test(s)) throw fail(en || "A record id is required", vi || "Thiếu mã bản ghi");
		return s;
	}

	const clampInt = (v, def, lo, hi) => {
		const n = Math.floor(Number(v));
		return isNaN(n) || blank(v) ? def : Math.min(hi, Math.max(lo, n));
	};

	/** Ngày ISO do máy chủ sinh -> biểu thức ngày của SuiteQL. */
	function sqlDate(iso) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw new Error("Invalid date");
		return `TO_DATE('${iso}', 'YYYY-MM-DD')`;
	}

	const rec = (name) => Store.rec(name);
	const nameOf = (r) => [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || r.entityid || "";
	const safe = (fn, fallback) => {
		try {
			return fn();
		} catch (e) {
			return fallback;
		}
	};

	// ------------------------------------------------------------------ tìm không dấu

	const VI_GROUPS = [["A", "ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ"], ["E", "ÈÉẸẺẼÊỀẾỆỂỄ"], ["I", "ÌÍỊỈĨ"], ["O", "ÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ"], ["U", "ÙÚỤỦŨƯỪỨỰỬỮ"], ["Y", "ỲÝỴỶỸ"], ["D", "Đ"]];
	const VI_FROM = VI_GROUPS.map((g) => g[1]).join("");
	const VI_TO = VI_GROUPS.map((g) => g[0].repeat(g[1].length)).join("");

	/** Chuẩn hóa chữ người dùng gõ: chữ hoa, bỏ dấu khi `fold`; bỏ ký tự đại diện của LIKE. Tối đa 5 từ. */
	function searchWords(q, fold) {
		let s = String(blank(q) ? "" : q).toUpperCase().replace(/[%_\\]/g, " ");
		if (fold) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/Đ/g, "D");
		else s = s.normalize("NFC");
		return s.split(/\s+/).filter(Boolean).slice(0, 5);
	}

	const foldSql = (expr, fold) => (fold ? `TRANSLATE(UPPER(${expr}), '${VI_FROM}', '${VI_TO}')` : `UPPER(${expr})`);

	// ------------------------------------------------------------------ danh sách nhân viên

	/**
	 * Các phần dùng chung của câu lệnh danh sách. `caps`: fold (tìm không dấu bằng TRANSLATE), contracts (record hợp đồng đã
	 * deploy), deptJoin (vai trò đọc được bảng department). Mỗi khả năng tắt được riêng khi account không hỗ trợ.
	 */
	function listParts(sub, q, today, days, caps) {
		const P = rec("employee");
		const pf = (k) => `p.${P.fields[k].id}`;
		const deptName = caps.deptJoin ? "COALESCE(pd.fullname, d.fullname)" : `COALESCE(BUILTIN.DF(${pf("department")}), BUILTIN.DF(e.department))`;
		let from = `employee e LEFT JOIN ${P.type} p ON p.${P.fields.employee.id} = e.id AND p.isinactive = 'F'`;
		if (caps.deptJoin) from += ` LEFT JOIN department d ON d.id = e.department LEFT JOIN department pd ON pd.id = ${pf("department")}`;
		let probation = "0 = 1";
		let expiring = "0 = 1";
		let kCols = "NULL AS lastend, 0 AS probation";
		if (caps.contracts) {
			const C = rec("contract");
			const cf = (k) => `c.${C.fields[k].id}`;
			const active = Store.idOf("hrc_status", "A");
			const prob = Store.idOf("hrc_type", "P");
			const t = sqlDate(today);
			from += ` LEFT JOIN (SELECT ${cf("employee")} AS emp, MAX(CASE WHEN ${cf("expiry")} IS NULL THEN ${sqlDate(FAR)} ELSE ${cf("expiry")} END) AS lastend,` +
				` MAX(CASE WHEN ${cf("type")} = ${prob} AND ${cf("effective")} <= ${t} AND (${cf("expiry")} IS NULL OR ${cf("expiry")} >= ${t}) THEN 1 ELSE 0 END) AS probation` +
				` FROM ${C.type} c WHERE c.isinactive = 'F' AND ${cf("status")} = ${active} AND ${cf("parent")} IS NULL GROUP BY ${cf("employee")}) k ON k.emp = e.id`;
			probation = "k.probation = 1";
			expiring = `k.lastend <= ${sqlDate(Dates.addDays(today, days))}`;
			kCols = "TO_CHAR(k.lastend, 'YYYY-MM-DD') AS lastend, k.probation AS probation";
		}
		const left = `(e.isinactive = 'T' OR (${pf("termination_date")} IS NOT NULL AND ${pf("termination_date")} < ${sqlDate(today)}))`;
		const missing = `(p.id IS NULL OR ${pf("tax_code")} IS NULL OR ${pf("bank_account")} IS NULL)`;
		const conds = {
			all: "1 = 1", left, working: `NOT ${left}`, probation: `NOT ${left} AND ${probation}`, expiring: `NOT ${left} AND ${expiring}`, missing: `NOT ${left} AND ${missing}`,
		};
		const words = searchWords(q, caps.fold);
		const params = [];
		const fields = ["e.entityid", "e.firstname", "e.lastname", deptName];
		const search = words.map((w) => {
			for (let i = 0; i < fields.length; i++) params.push(`%${w}%`);
			return `(${fields.map((f) => `${foldSql(f, caps.fold)} LIKE ?`).join(" OR ")})`;
		});
		const where = [`e.subsidiary = ${sub}`].concat(search).join(" AND ");
		const cols = `e.id AS id, e.entityid AS entityid, e.firstname AS firstname, e.lastname AS lastname, e.isinactive AS isinactive, e.title AS jobtitle, ${deptName} AS deptname,` +
			` p.id AS pid, ${pf("employment_type")} AS etype, TO_CHAR(${pf("hire_date")}, 'YYYY-MM-DD') AS hired, TO_CHAR(${pf("termination_date")}, 'YYYY-MM-DD') AS term,` +
			` CASE WHEN ${pf("tax_code")} IS NULL THEN 'F' ELSE 'T' END AS hastax, CASE WHEN ${pf("bank_account")} IS NULL THEN 'F' ELSE 'T' END AS hasbank, ${kCols}`;
		const sorts = { code: "e.entityid", name: "e.firstname, e.lastname, e.entityid", department: `${deptName}, e.entityid`, expiry: caps.contracts ? "k.lastend, e.entityid" : "e.entityid" };
		return { from, where, params, conds, cols, sorts };
	}

	function countsSql(parts) {
		const sum = (c) => `SUM(CASE WHEN ${c} THEN 1 ELSE 0 END)`;
		const c = parts.conds;
		return `SELECT COUNT(*) AS total, ${sum(c.working)} AS working, ${sum(c.probation)} AS probation, ${sum(c.expiring)} AS expiring, ${sum(c.missing)} AS missing, ${sum(c.left)} AS gone` +
			` FROM ${parts.from} WHERE ${parts.where}`;
	}

	function pageSql(parts, filter, sort, desc, lo, hi) {
		const order = parts.sorts[sort] || parts.sorts.code;
		const dir = desc ? order.split(", ").map((x, i) => (i === 0 ? `${x} DESC NULLS LAST` : x)).join(", ") : order;
		const inner = `SELECT ${parts.cols} FROM ${parts.from} WHERE ${parts.where} AND ${parts.conds[filter]} ORDER BY ${dir}`;
		// Phân trang trong SuiteQL: ROWNUM đánh sau khi sắp xếp ở truy vấn trong cùng
		return `SELECT * FROM (SELECT ROWNUM AS rn, * FROM (${inner}) WHERE ROWNUM <= ${hi}) WHERE rn > ${lo}`;
	}

	/** Chạy với khả năng đầy đủ; câu lệnh lỗi thì tắt dần từng khả năng (tìm không dấu, hợp đồng, JOIN phòng ban) rồi thử lại. */
	function withCaps(run) {
		const caps = { fold: true, contracts: true, deptJoin: true };
		const order = ["fold", "contracts", "deptJoin"];
		let last = null;
		for (let i = 0; i <= order.length; i++) {
			try {
				return { caps, out: run(caps) };
			} catch (e) {
				last = e;
				if (i === order.length) break;
				caps[order[i]] = false;
			}
		}
		throw last;
	}

	/** Việc sắp đến hạn của cả công ty con: hợp đồng (kể cả thử việc) và giấy phép lao động. */
	function dueList(sub, today, days, caps) {
		const out = [];
		const P = rec("employee");
		const notLeft = `e.isinactive = 'F' AND (p.${P.fields.termination_date.id} IS NULL OR p.${P.fields.termination_date.id} >= ${sqlDate(today)})`;
		const empJoin = (key) => `JOIN employee e ON e.id = ${key} LEFT JOIN ${P.type} p ON p.${P.fields.employee.id} = e.id AND p.isinactive = 'F'`;
		const person = "e.entityid AS entityid, e.firstname AS firstname, e.lastname AS lastname";
		if (caps.contracts) {
			const C = rec("contract");
			const cf = (a, k) => `${a}.${C.fields[k].id}`;
			const active = Store.idOf("hrc_status", "A");
			const sql = `SELECT c.id AS id, ${cf("c", "employee")} AS emp, ${cf("c", "number")} AS ref, ${cf("c", "type")} AS ctype, TO_CHAR(${cf("c", "expiry")}, 'YYYY-MM-DD') AS due, ${person}` +
				` FROM ${C.type} c ${empJoin(cf("c", "employee"))}` +
				` WHERE e.subsidiary = ${sub} AND ${notLeft} AND c.isinactive = 'F' AND ${cf("c", "status")} = ${active} AND ${cf("c", "parent")} IS NULL` +
				` AND ${cf("c", "expiry")} IS NOT NULL AND ${cf("c", "expiry")} <= ${sqlDate(Dates.addDays(today, days))}` +
				` AND NOT EXISTS (SELECT 1 FROM ${C.type} n WHERE ${cf("n", "employee")} = ${cf("c", "employee")} AND n.isinactive = 'F' AND ${cf("n", "status")} = ${active} AND ${cf("n", "parent")} IS NULL` +
				` AND n.id <> c.id AND (${cf("n", "expiry")} IS NULL OR ${cf("n", "expiry")} > ${cf("c", "expiry")}))` +
				` ORDER BY ${cf("c", "expiry")}`;
			for (const r of Store.run(sql, [], "s4vp_hr_due_contracts")) {
				const code = Store.codeOf("hrc_type", r.ctype) || "";
				out.push({ kind: code === "P" ? "probationEnd" : "contractExpiry", code, id: String(r.id), ref: r.ref || "", employee: String(r.emp), employeeCode: r.entityid || "", employeeName: nameOf(r), date: r.due });
			}
		}
		let permitDays = safe(() => Number(WorkPermits.params().reminderDays), days);
		if (isNaN(permitDays)) permitDays = days;
		const W = rec("work_permit");
		const wf = (k) => `w.${W.fields[k].id}`;
		const rows = safe(() => Store.run(
			`SELECT w.id AS id, ${wf("employee")} AS emp, w.name AS name, ${wf("permit_no")} AS permitno, TO_CHAR(${wf("expiry")}, 'YYYY-MM-DD') AS due, ${person}` +
				` FROM ${W.type} w ${empJoin(wf("employee"))}` +
				` WHERE e.subsidiary = ${sub} AND ${notLeft} AND w.isinactive = 'F' AND ${wf("status")} = ${Store.idOf("wp_status", "A")} AND ${wf("expiry")} <= ${sqlDate(Dates.addDays(today, permitDays))}` +
				` ORDER BY ${wf("expiry")}`,
			[], "s4vp_hr_due_permits"
		), []);
		for (const r of rows) out.push({ kind: "permitExpiry", code: "A", id: String(r.id), ref: r.permitno || r.name || "", employee: String(r.emp), employeeCode: r.entityid || "", employeeName: nameOf(r), date: r.due });
		for (const x of out) {
			x.daysLeft = Dates.diff(today, x.date);
			x.overdue = x.daysLeft < 0;
		}
		out.sort((a, b) => Dates.cmp(a.date, b.date));
		return { items: out.slice(0, DUE_LIMIT), total: out.length, days, permitDays };
	}

	/**
	 * GET employeesPage {subsidiary, q, filter, page, pageSize, sort, dir, days, due}
	 * -> {rows, total, page, pageSize, pages, counts: {all, working, probation, expiring, missing, left}, canSeePay, canEdit, today, days, notes, due?}
	 * Mỗi dòng: {employee, code, name, department, jobTitle, inactive, left, hasProfile, employmentType, hireDate, missingTax, missingBank,
	 *   contract: {id, number, type, expiry, state} | null, probation, baseSalary (chỉ khi canSeePay)}.
	 * Truy vấn: 1 đếm + 1 trang + 1 hợp đồng của trang + 1 lương của trang (+ khung sắp đến hạn khi due = 1).
	 */
	function employeesPage(params) {
		const p = params || {};
		const today = Clock.today();
		const days = clampInt(p.days, 30, 1, 366);
		const pageSize = clampInt(p.pageSize, 50, 10, 200);
		const wantPage = clampInt(p.page, 1, 1, 100000);
		const filter = FILTERS.includes(p.filter) ? p.filter : "all";
		const pay = canSeePay();
		const base = { rows: [], total: 0, page: 1, pageSize, pages: 1, counts: { all: 0, working: 0, probation: 0, expiring: 0, missing: 0, left: 0 }, canSeePay: pay, canEdit: canEdit(), today, days, notes: [] };
		if (blank(p.subsidiary)) return base;
		const sub = intId(p.subsidiary, "A subsidiary is required", "Chưa chọn công ty con");

		const res = withCaps((caps) => {
			const parts = listParts(sub, p.q, today, days, caps);
			const c = Store.run(countsSql(parts), parts.params, "s4vp_hr_counts")[0] || {};
			const counts = { all: Number(c.total) || 0, working: Number(c.working) || 0, probation: Number(c.probation) || 0, expiring: Number(c.expiring) || 0, missing: Number(c.missing) || 0, left: Number(c.gone) || 0 };
			const total = counts[filter];
			const pages = Math.max(1, Math.ceil(total / pageSize));
			const page = Math.min(wantPage, pages);
			const rows = total ? Store.run(pageSql(parts, filter, p.sort, String(p.dir || "").toLowerCase() === "desc", (page - 1) * pageSize, page * pageSize), parts.params, "s4vp_hr_page") : [];
			return { counts, total, pages, page, rows };
		});
		const caps = res.caps;
		const r = res.out;

		const empIds = r.rows.map((x) => String(x.id)).filter((x) => /^\d+$/.test(x));
		const profIds = r.rows.map((x) => (blank(x.pid) ? "" : String(x.pid))).filter((x) => /^\d+$/.test(x));
		const contracts = {};
		if (caps.contracts && empIds.length) {
			for (const c of Store.find("contract", { where: `{employee} IN (${empIds.join(",")}) AND {parent} IS NULL` })) (contracts[c.employee] = contracts[c.employee] || []).push(c);
		}
		const comps = {};
		if (pay && profIds.length) {
			for (const c of Store.find("compensation", { where: `{profile} IN (${profIds.join(",")})` })) (comps[c.profile] = comps[c.profile] || []).push(c);
		}
		const rows = r.rows.map((x) => {
			const list = contracts[String(x.id)] || [];
			const cur = Timeline.currentContract(list, today) || Timeline.latestContract(list);
			const comp = pay && !blank(x.pid) ? Timeline.compensationAt(comps[String(x.pid)], today) || Timeline.compensationAt(comps[String(x.pid)], null) : null;
			const left = x.isinactive === "T" || (!blank(x.term) && Dates.cmp(x.term, today) < 0);
			const row = {
				employee: String(x.id), code: x.entityid || "", name: nameOf(x), department: x.deptname || "", jobTitle: x.jobtitle || "", inactive: x.isinactive === "T", left,
				hasProfile: !blank(x.pid), profile: blank(x.pid) ? null : String(x.pid), employmentType: blank(x.etype) ? "" : Store.codeOf("employment_type", x.etype) || "",
				hireDate: x.hired || null, terminationDate: x.term || null, missingTax: !blank(x.pid) && x.hastax !== "T", missingBank: !blank(x.pid) && x.hasbank !== "T",
				probation: Number(x.probation) === 1,
				contract: cur ? { id: cur.id, number: cur.number || "", type: cur.type || "", expiry: cur.expiry || null, state: Timeline.contractState(cur, today).state } : null,
			};
			if (pay) row.baseSalary = comp ? comp.base_salary : null;
			return row;
		});
		const notes = [];
		if (!caps.contracts) notes.push("NO_CONTRACTS");
		if (!caps.fold) notes.push("NO_FOLD");
		const out = Object.assign(base, { rows, total: r.total, page: r.page, pages: r.pages, counts: r.counts, notes });
		if (p.due === "1" || p.due === true) out.due = safe(() => dueList(sub, today, days, caps), { items: [], total: 0, days, permitDays: days, failed: true });
		return out;
	}

	// ------------------------------------------------------------------ hồ sơ một người

	function employeeRow(id) {
		const cols = "e.id AS id, e.entityid AS entityid, e.firstname AS firstname, e.lastname AS lastname, e.isinactive AS isinactive, e.title AS jobtitle, e.subsidiary AS subsidiary, e.department AS department";
		let rows;
		try {
			rows = Store.run(`SELECT ${cols}, d.fullname AS deptname FROM employee e LEFT JOIN department d ON d.id = e.department WHERE e.id = ${id}`, [], "s4vp_hr_employee");
		} catch (e) {
			rows = Store.run(`SELECT ${cols}, BUILTIN.DF(e.department) AS deptname FROM employee e WHERE e.id = ${id}`, [], "s4vp_hr_employee");
		}
		if (!rows.length) throw fail("Employee not found", "Không tìm thấy nhân viên");
		return rows[0];
	}

	function profileOf(employeeId) {
		return Store.find("employee", { where: "{employee} = ?", params: [employeeId], includeInactive: true })[0] || null;
	}

	/** Tên theo id của một bảng danh mục chuẩn (department, location, classification, job). */
	function namesOf(table, ids, nameExpr) {
		const list = [...new Set((ids || []).filter((x) => !blank(x)).map(String))].filter((x) => /^\d+$/.test(x));
		const out = {};
		if (!list.length) return out;
		for (const r of safe(() => Store.run(`SELECT t.id AS id, ${nameExpr} AS name FROM ${table} t WHERE t.id IN (${list.join(",")})`, [], `s4vp_hr_names_${table}`), [])) out[String(r.id)] = r.name || "";
		return out;
	}

	/** 6 kỳ lương gần nhất của một nhân viên: chỉ số tổng, không đọc chi tiết JSON của dòng. */
	function payslips(employeeId, pay) {
		const L = rec("batch_emp");
		const B = rec("batch");
		const PP = rec("period");
		const lf = (k) => `l.${L.fields[k].id}`;
		const sql = `SELECT * FROM (SELECT l.id AS id, ${lf("batch")} AS batch, b.name AS docnumber, b.${B.fields.status.id} AS status, pp.name AS period, TO_CHAR(pp.${PP.fields.end.id}, 'YYYY-MM-DD') AS periodend,` +
			` ${lf("gross")} AS gross, ${lf("ee_ins")} AS eeins, ${lf("pit")} AS pit, ${lf("net")} AS net` +
			` FROM ${L.type} l JOIN ${B.type} b ON b.id = ${lf("batch")} JOIN ${PP.type} pp ON pp.id = b.${B.fields.period.id}` +
			` WHERE ${lf("employee")} = ${employeeId} AND l.isinactive = 'F' ORDER BY pp.${PP.fields.end.id} DESC, b.id DESC) WHERE ROWNUM <= 6`;
		return safe(() => Store.run(sql, [], "s4vp_hr_payslips"), []).map((r) => {
			const row = { line: String(r.id), batch: String(r.batch), number: r.docnumber || "", status: Store.codeOf("batch_status", r.status) || "", period: r.period || "", periodEnd: r.periodend || null };
			if (pay) Object.assign(row, { gross: num(r.gross), eeIns: num(r.eeins), pit: num(r.pit), net: num(r.net) });
			return row;
		});
	}

	function leaveOf(employeeId, year) {
		const types = {};
		for (const t of safe(() => Store.find("leave_type", { includeInactive: true }), [])) types[t.id] = t;
		return safe(() => Store.find("leave_balance", { where: "{employee} = ? AND {year} = ?", params: [employeeId, year] }), []).map((b) => {
			const bal = { entitled: b.entitled || 0, carriedOver: b.carried || 0, carryOverExpiryDate: b.carry_expiry || null, adjusted: b.adjusted || 0, used: b.used || 0, pending: b.pending || 0 };
			return {
				id: b.id, leaveType: b.leave_type, leaveTypeCode: (types[b.leave_type] || {}).name || "", leaveTypeName: (types[b.leave_type] || {}).description || "",
				entitled: bal.entitled, carried: bal.carriedOver, carryExpiry: bal.carryOverExpiryDate, adjusted: bal.adjusted, used: bal.used, pending: bal.pending, available: Ledger.available(bal),
			};
		});
	}

	/** Bỏ số tiền lương khỏi một đối tượng khi vai trò không được xem. */
	function stripPay(o, keys) {
		const out = Object.assign({}, o);
		for (const k of keys) delete out[k];
		return out;
	}

	const CONTRACT_PAY = ["base_salary", "insurance_wage"];
	const DECISION_PAY = ["old_salary", "new_salary", "old_ins_wage", "new_ins_wage", "old_allowance", "new_allowance"];
	const EVENT_PAY = ["amount", "insuranceWage", "allowance", "previous"];

	/**
	 * GET employeeCard {id, days}: toàn cảnh một nhân viên (id = internal id của Employee).
	 * -> {today, days, permitDays, canSeePay, canEdit, notes, employee, profile, title, compensation: {current, history}, dependents, contracts,
	 *     currentContract, decisions, allocations, permits, leave: {year, balances}, payslips, timeline, due}
	 */
	function employeeCard(params) {
		const p = params || {};
		const id = intId(p.id, "An employee is required", "Chưa chọn nhân viên");
		const today = Clock.today();
		const days = clampInt(p.days, 30, 1, 366);
		const pay = canSeePay();
		const e = employeeRow(id);
		const prof = profileOf(id);
		const comps = prof ? Store.find("compensation", { where: "{profile} = ?", params: [prof.id] }) : [];
		const deps = prof ? Store.find("dependent", { where: "{profile} = ?", params: [prof.id] }) : [];
		const notes = [];
		let contracts = [];
		let decisions = [];
		try {
			contracts = Store.find("contract", { where: "{employee} = ?", params: [id] });
			decisions = Store.find("decision", { where: "{employee} = ?", params: [id] });
		} catch (x) {
			notes.push("NO_CONTRACTS");
		}
		const permits = safe(() => Store.find("work_permit", { where: "{employee} = ?", params: [id] }), []);
		let permitDays = safe(() => Number(WorkPermits.params().reminderDays), days);
		if (isNaN(permitDays)) permitDays = days;
		const versions = safe(() => AllocationPlans.list(id), []);

		// Tên danh mục cho phòng ban của hồ sơ, quyết định và các dòng phân bổ: mỗi bảng một truy vấn
		const lines = versions.flatMap((v) => v.lines || []);
		const deptNames = namesOf("department", [prof && prof.department].concat(decisions.flatMap((d) => [d.old_department, d.new_department]), lines.map((l) => l.sub)), "t.fullname");
		const locNames = namesOf("location", lines.map((l) => l.branch), "t.fullname");
		const classNames = namesOf("classification", lines.map((l) => l.workCenter), "t.fullname");
		const projNames = namesOf("job", lines.map((l) => l.project), "COALESCE(t.companyname, t.entityid)");
		const packages = {};
		if (comps.some((c) => !blank(c.package))) for (const b of safe(() => Store.find("benefit_pkg", { includeInactive: true }), [])) packages[b.id] = b.name || "";

		const byId = {};
		for (const c of contracts) byId[c.id] = c;
		const current = Timeline.currentContract(contracts, today);
		const contractView = contracts
			.map((c) => {
				const st = Timeline.contractState(c, today);
				const parent = c.parent ? byId[c.parent] : null;
				const row = Object.assign({}, c, { state: st.state, future: st.future, isAppendix: !!c.parent, parentNumber: parent ? parent.number || "" : "", current: !!current && current.id === c.id });
				return pay ? row : stripPay(row, CONTRACT_PAY);
			})
			.sort((a, b) => Dates.cmp(b.effective || FAR, a.effective || FAR) || Number(b.id) - Number(a.id));
		const decisionView = decisions
			.map((d) => {
				const row = Object.assign({}, d, { oldDepartmentName: deptNames[d.old_department] || "", newDepartmentName: deptNames[d.new_department] || "" });
				return pay ? row : stripPay(row, DECISION_PAY);
			})
			.sort((a, b) => Dates.cmp(b.effective || FAR, a.effective || FAR) || Number(b.id) - Number(a.id));

		const history = comps.slice().sort((a, b) => Dates.cmp(b.effective || FAR, a.effective || FAR)).map((c) => ({
			id: c.id, effective: c.effective, base_salary: c.base_salary, insurance_wage: c.insurance_wage, allowance: c.allowance, package: c.package || null, packageName: packages[c.package] || "",
		}));
		const curComp = Timeline.compensationAt(comps, today);

		let timeline = Timeline.timeline({ profile: prof || {}, contracts, decisions: decisionView, compensations: comps, dependents: deps, permits }, today);
		if (!pay) timeline = timeline.filter((ev) => ev.kind !== "salary").map((ev) => stripPay(ev, EVENT_PAY));

		const year = Number(String(today).slice(0, 4));
		return {
			today, days, permitDays, canSeePay: pay, canEdit: canEdit(), notes,
			employee: {
				id: String(e.id), code: e.entityid || "", name: nameOf(e), inactive: e.isinactive === "T", subsidiary: blank(e.subsidiary) ? "" : String(e.subsidiary),
				department: blank(e.department) ? "" : String(e.department), departmentName: e.deptname || "", jobTitle: e.jobtitle || "",
			},
			profile: prof ? {
				id: prof.id, subsidiary: prof.subsidiary, employment_type: prof.employment_type, salary_type: prof.salary_type, pit_method: prof.pit_method, paygroup: prof.paygroup,
				hire_date: prof.hire_date, seniority_date: prof.seniority_date, termination_date: prof.termination_date, foreign: !!prof.foreign, nationality: prof.nationality || "",
				ins_applicable: !!prof.ins_applicable, ui_applicable: !!prof.ui_applicable, union_member: !!prof.union_member, region: prof.region || "",
				department: prof.department || "", departmentName: deptNames[prof.department] || "", bank_name: prof.bank_name || "",
				hasTaxCode: !blank(prof.tax_code), hasPersonalId: !blank(prof.personal_id), hasSiNumber: !blank(prof.si_number), hasBank: !blank(prof.bank_account),
			} : null,
			title: Timeline.currentTitle(contracts, decisions, today) || e.jobtitle || "",
			compensation: pay ? { current: curComp ? history.find((h) => h.id === curComp.id) || null : null, history } : { current: null, history: [], hidden: true },
			dependents: deps.map((d) => ({
				id: d.id, name: d.name || "", relationship: d.relationship || "", birth_date: d.birth_date, hasTaxCode: !blank(d.tax_code), from: d.from, to: d.to,
				active: (blank(d.from) || Dates.cmp(d.from, today) <= 0) && (blank(d.to) || Dates.cmp(d.to, today) >= 0),
			})),
			contracts: contractView, currentContract: current ? current.id : null,
			decisions: decisionView,
			allocations: versions.map((v) => Object.assign({}, v, {
				lines: (v.lines || []).map((l) => Object.assign({}, l, { projectName: projNames[l.project] || "", departmentName: deptNames[l.sub] || "", locationName: locNames[l.branch] || "", className: classNames[l.workCenter] || "" })),
			})),
			permits: permits.map((w) => Object.assign(stripPay(w, ["passport"]), { hasPassport: !blank(w.passport), daysLeft: w.expiry ? Dates.diff(today, w.expiry) : null })).sort((a, b) => Number(b.id) - Number(a.id)),
			leave: { year, balances: leaveOf(id, year) },
			payslips: payslips(id, pay),
			timeline,
			due: Timeline.due({ contracts, permits }, today, { days, permitDays }),
		};
	}

	/** GET hrLookups: danh mục cho hộp thoại quyết định và phân bổ. Bảng nào vai trò không đọc được thì rỗng. */
	function hrLookups() {
		const list = (sql, tag) => safe(() => Store.run(sql, [], tag), []).map((r) => ({ id: String(r.id), name: r.name || "" }));
		return {
			departments: list("SELECT t.id AS id, t.fullname AS name FROM department t WHERE t.isinactive = 'F' ORDER BY t.fullname", "s4vp_hr_lk_department"),
			locations: list("SELECT t.id AS id, t.fullname AS name FROM location t WHERE t.isinactive = 'F' ORDER BY t.fullname", "s4vp_hr_lk_location"),
			classes: list("SELECT t.id AS id, t.fullname AS name FROM classification t WHERE t.isinactive = 'F' ORDER BY t.fullname", "s4vp_hr_lk_class"),
			projects: list("SELECT * FROM (SELECT t.id AS id, COALESCE(t.companyname, t.entityid) AS name FROM job t WHERE t.isinactive = 'F' ORDER BY t.entityid) WHERE ROWNUM <= 1000", "s4vp_hr_lk_project"),
		};
	}

	// ------------------------------------------------------------------ hợp đồng

	const CONTRACT_INPUT = ["employee", "number", "type", "parent", "sign_date", "effective", "expiry", "title", "base_salary", "insurance_wage", "note"];
	// Hợp đồng đã duyệt: chỉ sửa được thông tin không làm đổi điều khoản
	const CONTRACT_INPUT_APPROVED = ["number", "sign_date", "note"];

	function pickInput(values, keys) {
		const out = {};
		for (const k of keys) if (values && Object.prototype.hasOwnProperty.call(values, k)) out[k] = values[k] === "" ? null : values[k];
		return out;
	}

	function getContract(id) {
		const r = Store.get("contract", intId(id));
		if (!r) throw fail("Contract not found", "Không tìm thấy hợp đồng");
		return r;
	}

	/** Kiểm điều kiện của hợp đồng / phụ lục; chồng lấn là lỗi khi kích hoạt, là cảnh báo khi còn nháp. */
	function checkContract(merged, activate) {
		const parent = merged.parent ? Store.get("contract", merged.parent) : null;
		if (merged.parent && (!parent || String(parent.employee) !== String(merged.employee))) throw failList([Timeline.message("APPENDIX_OF_APPENDIX")]);
		const errs = Timeline.validateContract(merged, parent);
		if (errs.length) throw failList(errs);
		const warnings = [];
		if (parent) {
			if (activate && (parent.status || "D") === "D") throw failList([Timeline.message("APPENDIX_PARENT_DRAFT")]);
			return warnings;
		}
		const others = Store.find("contract", { where: "{employee} = ?", params: [merged.employee] });
		const hits = Timeline.overlaps(others, merged);
		if (hits.length) {
			const m = Timeline.message("OVERLAP", hits.map((h) => h.number || `#${h.id}`).join(", "));
			if (activate) throw failList([m]);
			warnings.push(m);
		}
		return warnings;
	}

	/**
	 * POST hrSaveContract {values: {id?, employee, number, type, parent?, sign_date, effective, expiry, title, base_salary, insurance_wage, note}, activate?}
	 * -> {id, status, warnings}. Bản mới ở trạng thái Nháp (D), hoặc Hiệu lực (A) khi activate = true. Phụ lục: có `parent`.
	 */
	function saveContract(body) {
		const values = (body && body.values) || {};
		const activate = !!(body && body.activate);
		const cur = values.id ? getContract(values.id) : null;
		const approved = !!cur && (cur.status || "D") !== "D";
		const v = pickInput(values, approved ? CONTRACT_INPUT_APPROVED : CONTRACT_INPUT);
		if (cur) {
			delete v.employee;
			delete v.parent;
		}
		if (approved) {
			if (Object.keys(v).length) Store.update("contract", cur.id, v);
			return { id: cur.id, status: cur.status, warnings: [] };
		}
		const merged = Object.assign({}, cur || {}, v);
		if (merged.parent) merged.type = null;
		if (!blank(merged.employee)) intId(merged.employee);
		const warnings = checkContract(merged, activate);
		const prof = profileOf(merged.employee);
		const out = Object.assign({}, v, { status: activate ? "A" : "D" }, merged.parent ? { type: null } : {}, prof ? { profile: prof.id } : {});
		const id = cur ? (Store.update("contract", cur.id, out), cur.id) : Store.create("contract", out);
		return { id, status: out.status, warnings };
	}

	/** POST hrActivateContract {id}: Nháp -> Hiệu lực (kiểm lại toàn bộ, chồng lấn thì từ chối). */
	function activateContract(body) {
		const c = getContract(body && body.id);
		if ((c.status || "D") !== "D") throw fail("Only draft contracts can be activated", "Chỉ kích hoạt được hợp đồng nháp");
		checkContract(c, true);
		Store.submit("contract", c.id, { status: "A" });
		return { id: c.id, status: "A" };
	}

	/** POST hrTerminateContract {id, date, reason}: hợp đồng hiệu lực -> Chấm dứt, `date` là ngày cuối hợp đồng còn giá trị. */
	function terminateContract(body) {
		const b = body || {};
		const c = getContract(b.id);
		if (c.parent) throw fail("An appendix cannot be terminated on its own", "Không chấm dứt riêng phụ lục");
		if (c.status !== "A") throw fail("Only active contracts can be terminated", "Chỉ chấm dứt được hợp đồng đang hiệu lực");
		const errs = Timeline.validateTermination(c, b.date);
		if (errs.length) throw failList(errs);
		Store.submit("contract", c.id, { status: "T", terminated: b.date, term_reason: String(b.reason || "").slice(0, 290) });
		return { id: c.id, status: "T", terminated: b.date };
	}

	// ------------------------------------------------------------------ quyết định

	const DECISION_INPUT = ["employee", "number", "type", "sign_date", "effective", "new_department", "new_title", "new_salary", "new_ins_wage", "new_allowance", "note"];

	function getDecision(id) {
		const r = Store.get("decision", intId(id));
		if (!r) throw fail("Decision not found", "Không tìm thấy quyết định");
		return r;
	}

	/**
	 * POST hrSaveDecision {values: {id?, employee, number, type, sign_date, effective, new_department, new_title, new_salary, new_ins_wage, new_allowance, note}, apply?}
	 * -> {id, status, warnings, applied?}. Lưu ở trạng thái Nháp và chụp lại giá trị cũ (phòng ban, chức danh, lương) tại ngày
	 * hiệu lực; apply = true thì áp dụng luôn.
	 */
	function saveDecision(body) {
		const values = (body && body.values) || {};
		const cur = values.id ? getDecision(values.id) : null;
		if (cur && cur.status === "A") throw fail("An applied decision cannot be edited", "Quyết định đã áp dụng không sửa được");
		const v = pickInput(values, DECISION_INPUT);
		if (cur) delete v.employee;
		const merged = Object.assign({}, cur || {}, v);
		const errs = Timeline.validateDecision(merged);
		if (errs.length) throw failList(errs);
		const emp = employeeRow(intId(merged.employee));
		const prof = profileOf(merged.employee);
		const comps = prof ? Store.find("compensation", { where: "{profile} = ?", params: [prof.id] }) : [];
		const before = Timeline.compensationAt(comps, merged.effective) || {};
		const contracts = safe(() => Store.find("contract", { where: "{employee} = ?", params: [merged.employee] }), []);
		const decisions = safe(() => Store.find("decision", { where: "{employee} = ?", params: [merged.employee] }), []).filter((d) => !cur || d.id !== cur.id);
		const out = Object.assign({}, v, {
			status: "D", profile: prof ? prof.id : null,
			old_department: (prof && prof.department) || (blank(emp.department) ? null : String(emp.department)),
			old_title: Timeline.currentTitle(contracts, decisions, merged.effective) || emp.jobtitle || "",
			old_salary: blank(before.base_salary) ? null : before.base_salary, old_ins_wage: blank(before.insurance_wage) ? null : before.insurance_wage,
			old_allowance: blank(before.allowance) ? null : before.allowance,
		});
		const id = cur ? (Store.update("decision", cur.id, out), cur.id) : Store.create("decision", out);
		if (body && body.apply) return applyDecision({ id });
		return { id, status: "D", warnings: [] };
	}

	/**
	 * POST hrApplyDecision {id}: cập nhật hồ sơ lương / lịch sử lương theo ngày hiệu lực (qua Profiles.save); quyết định chấm dứt
	 * thì chấm dứt các hợp đồng đang hiệu lực; rồi khóa quyết định ở trạng thái Đã áp dụng.
	 * -> {id, status: 'A', warnings, applied: {profile: [tên trường], compensation: boolean, contracts: số hợp đồng chấm dứt}}
	 */
	function applyDecision(body) {
		const d = getDecision(body && body.id);
		if (d.status === "A") throw fail("The decision is already applied", "Quyết định đã được áp dụng");
		const prof = profileOf(d.employee);
		const comps = prof ? Store.find("compensation", { where: "{profile} = ?", params: [prof.id] }) : [];
		const eff = Timeline.decisionEffects(d, { compensations: comps, profile: prof });
		if (eff.errors.length) throw failList(eff.errors);
		const profileKeys = Object.keys(eff.profile);
		if (profileKeys.length || eff.compensation) {
			if (!prof) throw fail("The employee has no payroll profile yet; create it first", "Nhân viên chưa có hồ sơ lương; hãy tạo hồ sơ lương trước");
			const input = { employee: d.employee, subsidiary: prof.subsidiary, profile: eff.profile };
			if (eff.compensation) input.compensation = eff.compensation;
			Profiles.save(input);
		}
		let ended = 0;
		if (eff.terminate) {
			for (const c of safe(() => Store.find("contract", { where: "{employee} = ?", params: [d.employee] }), [])) {
				if (c.parent || c.status !== "A" || Dates.cmp(c.effective, eff.terminate) > 0 || (c.expiry && Dates.cmp(c.expiry, eff.terminate) < 0)) continue;
				Store.submit("contract", c.id, { status: "T", terminated: eff.terminate, term_reason: String(d.number || "").slice(0, 290) });
				ended++;
			}
		}
		Store.submit("decision", d.id, { status: "A", applied_date: Clock.today(), applied_by: userId() });
		return { id: d.id, status: "A", warnings: eff.warnings, applied: { profile: profileKeys, compensation: !!eff.compensation, contracts: ended } };
	}

	// ------------------------------------------------------------------ người phụ thuộc

	/**
	 * POST hrSaveDependent {employee, values: {id?, name, relationship, birth_date, tax_code, from, to}} -> {id?, created, updated}
	 * Thêm mới đi qua Profiles.save (quy tắc không nhân đôi người phụ thuộc nằm ở đó); sửa chỉ đổi các trường gửi lên.
	 */
	function saveDependent(body) {
		const b = body || {};
		const v = b.values || {};
		const employee = intId(b.employee, "An employee is required", "Chưa chọn nhân viên");
		const prof = profileOf(employee);
		if (!prof) throw fail("The employee has no payroll profile yet; create it first", "Nhân viên chưa có hồ sơ lương; hãy tạo hồ sơ lương trước");
		const d = pickInput(v, ["name", "relationship", "birth_date", "tax_code", "from", "to"]);
		const existing = Store.find("dependent", { where: "{profile} = ?", params: [prof.id], includeInactive: true });
		const cur = v.id ? existing.find((x) => x.id === String(v.id)) : null;
		if (v.id && !cur) throw fail("Dependent not found", "Không tìm thấy người phụ thuộc");
		const merged = Object.assign({}, cur || {}, d);
		if (blank(merged.name) || !String(merged.name).trim()) throw fail("The dependent name is required", "Chưa nhập họ tên người phụ thuộc");
		if (blank(merged.from)) throw fail("The deduction start date is required", "Chưa nhập ngày bắt đầu giảm trừ");
		for (const k of ["birth_date", "from", "to"]) if (!blank(merged[k]) && !/^\d{4}-\d{2}-\d{2}$/.test(String(merged[k]))) throw failList([Timeline.message("BAD_DATE")]);
		if (!blank(merged.to) && Dates.cmp(merged.to, merged.from) < 0) throw failList([Timeline.message("END_BEFORE_START")]);
		if (cur) {
			// Ô mã số thuế để trống khi sửa nghĩa là giữ nguyên (giá trị hiện có không được gửi xuống trình duyệt)
			if (blank(d.tax_code)) delete d.tax_code;
			Store.update("dependent", cur.id, d);
			return { id: cur.id, created: false, updated: true };
		}
		const norm = (x) => String(x || "").trim().toUpperCase();
		if (existing.some((x) => norm(x.name) === norm(merged.name) && (x.from || "") === (merged.from || ""))) {
			throw fail("This dependent is already registered from the same date", "Người phụ thuộc này đã được đăng ký từ cùng ngày");
		}
		const row = {};
		for (const k of Object.keys(d)) if (!blank(d[k])) row[k] = d[k];
		row.name = String(row.name).trim();
		Profiles.save({ employee, subsidiary: prof.subsidiary, profile: {}, dependents: [row] });
		return { created: true, updated: false };
	}

	const routes = {
		get: {
			employeesPage: { roles: "all", run: employeesPage },
			employeeCard: { roles: "all", run: employeeCard },
			hrLookups: { roles: "all", run: hrLookups },
		},
		post: {
			hrSaveContract: { roles: "hr", run: saveContract },
			hrActivateContract: { roles: "hr", run: activateContract },
			hrTerminateContract: { roles: "hr", run: terminateContract },
			hrSaveDecision: { roles: "hr", run: saveDecision },
			hrApplyDecision: { roles: "hr", run: applyDecision },
			hrSaveDependent: { roles: "hr", run: saveDependent },
		},
	};

	return { routes, employeesPage, employeeCard, hrLookups, saveContract, activateContract, terminateContract, saveDecision, applyDecision, saveDependent, searchWords };
});
