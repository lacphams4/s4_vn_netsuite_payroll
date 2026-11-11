/**
 * Thiết lập (giao diện bản 2, docs/UI_V2.md mục 5 và 14). Mô-đun route.
 *
 * GET  setupStatus      {subsidiary} tình trạng từng mục thiết lập (đủ / thiếu gì / cần chú ý) và trình tự thiết lập lần đầu;
 *                       số lượng danh mục lấy bằng MỘT câu đếm UNION ALL (hỏng thì đếm từng bảng), cộng vài lượt đọc bảng nhỏ
 * GET  setupData        {subsidiary} thiết lập chung, thiết lập công ty con, khoản trích, tài khoản, cơ quan thu, chính sách phép
 * GET  setupLegal       tham số pháp lý (mục chưa đối chiếu trước), biểu thuế, khoản trích - chỉ đọc
 * GET  costAccounts     {subsidiary} tài khoản chi phí lương theo đích (record cost_account) kèm tên và tình trạng áp dụng
 * GET  costAccountTest  {subsidiary, workCenter, project, department, laborType, date} tài khoản sẽ được chọn (core/CostAccountRules
 *                       + CostAllocationBuilder.resolveAccount, cùng đường tính lương dùng)
 * POST saveCostAccount, retireCostAccount (đặt inactive, không xóa)       - administrator + kế toán
 * POST saveSetupAccounts, saveInsuranceAccounts (chỉ các trường tài khoản) - administrator + kế toán
 * GET  approvalSteps    {subsidiary} cấp duyệt bảng lương (record approval_step) kèm tình trạng áp dụng cho công ty con đang chọn
 * POST saveApprovalStep, retireApprovalStep (đặt inactive, không xóa)     - administrator + kế toán
 * POST verifyParam      {id} đánh dấu tham số pháp lý đã đối chiếu văn bản gốc (record không có trường người / ngày đối chiếu:
 *                       chỉ đổi cờ; nhật ký do RESTlet ghi)               - administrator + HR
 *
 * Các thao tác đã có (loadDefaults, loadIndustryPack, generatePeriods, closePeriod, reopenPeriod, saveSetup, saveCompany)
 * dùng action cũ của RESTlet. Màn này không sửa giá trị pháp lý. Không xóa dữ liệu.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Settings", "./Profiles", "./CostAccounts", "./Clock", "../core/CostAccountRules", "../core/CostAllocationBuilder", "../core/IndustryPacks", "../core/Dates", "../core/ApprovalFlow"], (Store, Settings, Profiles, CostAccounts, Clock, Rules, Builder, Packs, Dates, Flow) => {
	const blank = (v) => v === null || v === undefined || String(v).trim() === "";
	const norm = (v) => String(blank(v) ? "" : v).trim().toUpperCase();
	const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
	const ISO = /^\d{4}-\d{2}-\d{2}$/;
	// Trường tài khoản của setup / company (tools/schema.mjs accountFields): kế toán khai
	const ACCOUNT_FIELDS = ["acc_payable", "acc_pit", "acc_advance", "acc_expense", "acc_other_ded", "acc_13th", "acc_contractor", "pit_vendor", "location"];
	// Thiếu thì không ghi sổ được bảng lương (334), không có tài khoản chi phí dự phòng, không hạch toán được thuế TNCN
	const REQUIRED_ACCOUNTS = ["acc_payable", "acc_expense", "acc_pit"];
	const OPTIONAL_ACCOUNTS = ["acc_advance", "acc_other_ded", "acc_13th", "acc_contractor", "pit_vendor"];
	const TARGETS = { W: "work_center", P: "project", D: "department" };
	// Danh mục đếm bằng một câu UNION ALL
	const COUNTED = ["pit_bracket", "earning_type", "earning_rule", "benefit_pkg", "leave_type", "leave_policy", "att_symbol", "att_rule", "shift", "shift_pattern", "rate_table", "team", "cost_account"];

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function safe(fn, fallback) {
		try {
			return fn();
		} catch (e) {
			return fallback;
		}
	}

	/** id nội bộ hợp lệ (chuỗi số nguyên dương) hoặc "" khi trống; giá trị lạ ném lỗi. */
	function optId(v, en, vi) {
		if (blank(v)) return "";
		const s = String(v).trim();
		if (!/^\d+$/.test(s) || Number(s) <= 0) throw fail(`${en || "Value"} is not valid`, `${vi || "Giá trị"} không hợp lệ`);
		return s;
	}

	function needId(v, en, vi) {
		const id = optId(v, en, vi);
		if (!id) throw fail(`${en} is required`, `Chưa chọn ${vi}`);
		return id;
	}

	function today() {
		return safe(() => Clock.today(), "") || Dates.iso(new Date());
	}

	// ------------------------------------------------------------------ tình trạng thiết lập

	/** Số bản ghi đang dùng của từng danh mục: {tên: số | null (không đọc được)}; thêm employee (theo công ty con), holiday, holiday_year. */
	function counts(subsidiary, year) {
		const parts = {};
		for (const name of COUNTED) {
			const def = safe(() => Store.rec(name), null);
			if (def) parts[name] = `SELECT '${name}' AS k, COUNT(*) AS n FROM ${def.type} t WHERE t.isinactive = 'F'`;
		}
		const emp = safe(() => Store.rec("employee"), null);
		if (emp && subsidiary) parts.employee = `SELECT 'employee' AS k, COUNT(*) AS n FROM ${emp.type} t WHERE t.isinactive = 'F' AND t.${emp.fields.subsidiary.id} = ${Number(subsidiary)}`;
		const hol = safe(() => Store.rec("holiday"), null);
		if (hol) {
			parts.holiday = `SELECT 'holiday' AS k, COUNT(*) AS n FROM ${hol.type} t WHERE t.isinactive = 'F'`;
			parts.holiday_year = `SELECT 'holiday_year' AS k, COUNT(*) AS n FROM ${hol.type} t WHERE t.isinactive = 'F' AND TO_CHAR(t.${hol.fields.date.id}, 'YYYY') = '${Number(year)}'`;
		}
		const out = {};
		const keys = Object.keys(parts);
		for (const k of COUNTED.concat(["employee", "holiday", "holiday_year"])) out[k] = null;
		try {
			for (const r of Store.run(keys.map((k) => parts[k]).join(" UNION ALL "), [], "s4vp_st_counts") || []) out[String(r.k)] = Number(r.n) || 0;
			for (const k of keys) if (out[k] === null) out[k] = 0;
		} catch (e) {
			// Một bảng chưa deploy hoặc vai trò không đọc được: đếm riêng từng bảng, bảng lỗi để null (giao diện ghi "không đọc được")
			for (const k of keys) {
				const rows = safe(() => Store.run(parts[k], [], "s4vp_st_count_" + k), null);
				if (rows) out[k] = rows.length ? Number(rows[0].n) || 0 : 0;
			}
		}
		return out;
	}

	/** Mã các gói ngành đã nạp đủ (không còn phần nào để thêm); null khi không xác định được. */
	function loadedPacks(paygroups) {
		try {
			const sql = ["earning_type", "earning_rule", "rate_table"].map((name) => `SELECT '${name}' AS k, t.name AS name FROM ${Store.rec(name).type} t`).join(" UNION ALL ");
			const have = { earning_type: [], earning_rule: [], rate_table: [] };
			for (const r of Store.run(sql, [], "s4vp_st_names")) if (have[r.k]) have[r.k].push(r.name);
			if (!have.earning_rule.length) return [];
			const existing = { earningTypes: have.earning_type, rules: have.earning_rule, rateTables: have.rate_table, payGroups: paygroups.map((g) => g.name), shifts: [], patterns: [] };
			return Object.keys(Packs.PACKS).filter((code) => {
				const plan = Packs.planLoad(code, existing);
				return !plan.earningTypes.length && !plan.payGroups.length && !plan.rateTables.length && !plan.rules.length;
			});
		} catch (e) {
			return null;
		}
	}

	function item(key, state, count, issues) {
		return { key, state, count: count === undefined ? null : count, issues: issues || [] };
	}

	/** Mục danh mục chỉ cần "có dữ liệu": required -> thiếu khi rỗng, ngược lại là tùy chọn. */
	function catalog(key, n, required) {
		if (n === null || n === undefined) return item(key, "unknown", null, [{ code: "UNREADABLE" }]);
		if (n > 0) return item(key, "ok", n);
		return item(key, required ? "missing" : "optional", 0, [{ code: required ? "EMPTY" : "NONE" }]);
	}

	function periodStatus(subsidiary, groups, periods, day) {
		const mine = groups.filter((g) => !g.isInactive && (blank(g.subsidiary) || !subsidiary || String(g.subsidiary) === String(subsidiary)));
		const info = mine.map((g) => {
			const own = periods.filter((p) => String(p.paygroup) === String(g.id) && !p.isInactive);
			const current = own.find((p) => p.start <= day && day <= p.end) || null;
			const lastEnd = own.reduce((m, p) => (p.end > m ? p.end : m), "");
			return { id: g.id, code: g.name, count: own.length, current: current ? current.name : "", next: current ? own.some((p) => p.start > current.end) : false, lastEnd, open: own.filter((p) => p.status !== "C").length };
		});
		const used = info.filter((g) => g.count > 0);
		const issues = [];
		const noCurrent = used.filter((g) => !g.current).map((g) => g.code);
		const noNext = used.filter((g) => g.current && !g.next).map((g) => g.code);
		const never = info.filter((g) => !g.count).map((g) => g.code);
		let state = "ok";
		if (!used.some((g) => g.current)) {
			state = "missing";
			issues.push({ code: used.length ? "NO_CURRENT" : "NO_PERIODS", list: used.length ? noCurrent : never });
		} else {
			if (noCurrent.length) issues.push({ code: "NO_CURRENT", list: noCurrent });
			if (noNext.length) issues.push({ code: "NEXT_MISSING", list: noNext });
			if (never.length) issues.push({ code: "GROUP_WITHOUT_PERIODS", list: never });
			if (noCurrent.length || noNext.length) state = "attention";
		}
		const lastEnd = used.reduce((m, g) => (g.lastEnd > m ? g.lastEnd : m), "");
		const count = info.reduce((s, g) => s + g.count, 0);
		return { item: Object.assign(item("periods", state, count, issues), { lastEnd }), groups: info, hasCurrent: used.some((g) => g.current) };
	}

	/**
	 * Mục "Cấp duyệt": chưa khai dòng nào (hoặc không dòng nào áp dụng cho công ty con) = duyệt một cấp như cũ, là trạng thái
	 * bình thường (ok, kèm mã SINGLE_LEVEL), không phải cảnh báo. Dòng đang dùng mà thiếu người duyệt thì cần chú ý.
	 */
	function approvalItem(subsidiary) {
		const rows = safe(() => Store.find("approval_step"), null);
		if (rows === null) return item("approvals", "unknown", null, [{ code: "UNREADABLE" }]);
		const levels = Flow.requiredSteps(rows, { subsidiary, net: Number.MAX_SAFE_INTEGER });
		const invalid = rows.filter((r) => blank(r.approver) && !Flow.ROLE_IDS[norm(r.role)]).length;
		const issues = [];
		if (!levels.length) issues.push({ code: "SINGLE_LEVEL" });
		if (invalid) issues.push({ code: "APPROVER_MISSING", n: invalid });
		return Object.assign(item("approvals", invalid ? "attention" : "ok", rows.length, issues), { levels: levels.length });
	}

	function setupStatus(params) {
		const subsidiary = optId(params && params.subsidiary, "Subsidiary", "Công ty con");
		const day = today();
		const year = Number(day.slice(0, 4));
		const setup = safe(() => Store.find("setup"), [])[0] || null;
		const company = subsidiary ? safe(() => Settings.company(subsidiary), null) : null;
		const groups = safe(() => Store.find("paygroup", { includeInactive: true }), []);
		const periods = safe(() => Store.find("period", { includeInactive: true }), []);
		const paramRows = safe(() => Store.find("param"), null);
		const comps = safe(() => Store.find("ins_comp"), null);
		const n = counts(subsidiary, year);
		const packs = loadedPacks(groups);
		const unreadable = (key) => item(key, "unknown", null, [{ code: "UNREADABLE" }]);

		// Tài khoản mặc định (đã kế thừa công ty con <- chung)
		const pick = (k) => (company && !blank(company[k]) ? company[k] : setup ? setup[k] : null);
		const missingAcc = REQUIRED_ACCOUNTS.filter((k) => blank(pick(k)));
		const optionalAcc = OPTIONAL_ACCOUNTS.filter((k) => blank(pick(k)));
		const accIssues = [];
		if (missingAcc.length) accIssues.push({ code: "ACCOUNTS_MISSING", list: missingAcc });
		if (optionalAcc.length) accIssues.push({ code: "ACCOUNTS_OPTIONAL", list: optionalAcc });
		const filled = REQUIRED_ACCOUNTS.length + OPTIONAL_ACCOUNTS.length - missingAcc.length - optionalAcc.length;
		const accounts = item("accounts", !setup || missingAcc.length ? "missing" : optionalAcc.length ? "attention" : "ok", filled, accIssues);

		// Khoản trích đang hiệu lực, có tỷ lệ, chưa khai tài khoản phải trả / cơ quan thu
		const live = (comps || []).filter((c) => (blank(c.effective) || c.effective <= day) && (blank(c.expiration) || c.expiration >= day) && (Number(c.ee_rate) || Number(c.er_rate)));
		const noAccount = [...new Set(live.filter((c) => blank(c.account)).map((c) => String(c.name)))];
		const noVendor = [...new Set(live.filter((c) => blank(c.vendor)).map((c) => String(c.name)))];
		const insIssues = [];
		if (comps && !live.length) insIssues.push({ code: "EMPTY" });
		if (noAccount.length) insIssues.push({ code: "INS_NO_ACCOUNT", list: noAccount });
		if (noVendor.length) insIssues.push({ code: "INS_NO_VENDOR", list: noVendor });
		const insAccounts = comps === null ? unreadable("insAccounts") : item("insAccounts", !live.length || noAccount.length ? "missing" : noVendor.length ? "attention" : "ok", live.length, insIssues);

		// Tham số pháp lý
		const unverified = (paramRows || []).filter((p) => p.verified === false);
		let legal;
		if (paramRows === null) legal = unreadable("params");
		else if (!paramRows.length) legal = item("params", "missing", 0, [{ code: "EMPTY" }]);
		else if (unverified.length) legal = item("params", "attention", paramRows.length, [{ code: "UNVERIFIED", n: unverified.length, list: unverified.slice(0, 5).map((p) => `${p.name} (${String(p.effective || "").split("-").reverse().join("/")})`) }]);
		else legal = item("params", "ok", paramRows.length);
		const holidays = n.holiday_year === null ? unreadable("holidays") : item("holidays", n.holiday_year > 0 ? "ok" : "attention", n.holiday, n.holiday_year > 0 ? [] : [{ code: "NO_HOLIDAYS_YEAR", n: year }]);

		// Thiết lập chung, công ty con
		const generalIssues = [];
		if (!setup) generalIssues.push({ code: "NO_SETUP" });
		else if (blank(setup.base_et)) generalIssues.push({ code: "NO_BASE_EARNING" });
		const general = item("general", !setup ? "missing" : generalIssues.length ? "attention" : "ok", setup ? 1 : 0, generalIssues);
		let companyItem;
		if (!subsidiary) companyItem = item("company", "optional", 0, [{ code: "NO_SUBSIDIARY" }]);
		else if (!company) companyItem = item("company", "optional", 0, [{ code: "INHERITS" }]);
		else if (company.enabled === false) companyItem = item("company", "attention", 1, [{ code: "COMPANY_DISABLED" }]);
		else if (blank(company.preparer) && blank(company.chief_accountant) && blank(company.director)) companyItem = item("company", "attention", 1, [{ code: "NO_SIGNERS" }]);
		else companyItem = item("company", "ok", 1);

		const per = periodStatus(subsidiary, groups, periods, day);
		const activeGroups = groups.filter((g) => !g.isInactive);
		const defaults = item("defaults", setup ? "ok" : "missing", null, setup ? [] : [{ code: "NOT_LOADED" }]);
		const industry = packs === null ? unreadable("industry") : Object.assign(item("industry", packs.length ? "ok" : "optional", packs.length, packs.length ? [] : [{ code: "NONE" }]), { loaded: packs });
		let employees;
		if (!subsidiary) employees = item("employees", "optional", null, [{ code: "NO_SUBSIDIARY" }]);
		else if (n.employee === null) employees = unreadable("employees");
		else employees = item("employees", n.employee > 0 ? "ok" : "missing", n.employee, n.employee > 0 ? [] : [{ code: "NO_EMPLOYEES" }]);

		const sections = [
			{ key: "start", items: [defaults, industry, employees] },
			{ key: "company", items: [general, companyItem, accounts, insAccounts, catalog("costAccounts", n.cost_account, false), approvalItem(subsidiary)] },
			{ key: "periods", items: [catalog("paygroups", activeGroups.length, true), per.item] },
			{ key: "legal", items: [legal, catalog("pitBrackets", n.pit_bracket, true), catalog("insComps", comps === null ? null : comps.length, true), holidays] },
			{ key: "earnings", items: [catalog("earningTypes", n.earning_type, true), catalog("earningRules", n.earning_rule, true), catalog("benefitPkgs", n.benefit_pkg, false)] },
			{ key: "attendance", items: [catalog("leaveTypes", n.leave_type, true), catalog("leavePolicies", n.leave_policy, true), catalog("attSymbols", n.att_symbol, true), catalog("attRules", n.att_rule, false), catalog("shifts", n.shift, false), catalog("shiftPatterns", n.shift_pattern, false)] },
			{ key: "output", items: [catalog("rateTables", n.rate_table, false), catalog("teams", n.team, false)] },
		];

		// Trình tự thiết lập lần đầu: bước đầu tiên chưa xong (không tính bước tùy chọn) là bước hiện tại
		const done = {
			defaults: !!setup,
			industry: !!(packs && packs.length),
			accounts: !!setup && !missingAcc.length && comps !== null && live.length > 0 && !noAccount.length,
			periods: per.hasCurrent,
			employees: n.employee !== null && n.employee > 0,
		};
		let found = false;
		const steps = ["defaults", "industry", "accounts", "periods", "employees"].map((key) => {
			const optional = key === "industry";
			let state = done[key] ? "done" : "todo";
			if (!done[key] && !optional && !found) {
				state = "current";
				found = true;
			}
			return { key, state, optional };
		});
		const summary = { ok: 0, missing: 0, attention: 0, optional: 0, unknown: 0 };
		for (const s of sections) for (const i of s.items) summary[i.state] = (summary[i.state] || 0) + 1;
		const packList = Object.keys(Packs.PACKS).map((code) => ({ code, name: Packs.PACKS[code].name, nameVi: Packs.PACKS[code].nameVi, loaded: !!(packs && packs.includes(code)) }));
		return { subsidiary, today: day, year, ready: !!setup, firstRun: found, steps, sections, summary, packs: packList, paygroups: per.groups };
	}

	// ------------------------------------------------------------------ dữ liệu cho hộp thoại thiết lập

	function setupData(params) {
		const subsidiary = optId(params && params.subsidiary, "Subsidiary", "Công ty con");
		return {
			subsidiary,
			setup: safe(() => Store.find("setup"), [])[0] || null,
			company: subsidiary ? safe(() => Settings.company(subsidiary), null) : null,
			components: safe(() => Store.find("ins_comp", { order: "{name}, {effective} DESC" }), []),
			accounts: safe(() => Profiles.accounts(), []),
			vendors: safe(() => Profiles.vendors(subsidiary || null), []),
			leavePolicies: safe(() => Store.find("leave_policy"), []).map((p) => ({ id: p.id, code: p.name, name: p.description || "" })),
			today: today(),
		};
	}

	function setupLegal() {
		const day = today();
		const inRange = (r) => (blank(r.effective) || r.effective <= day) && (blank(r.expiration) || r.expiration >= day);
		const params = safe(() => Store.find("param"), []).map((p) => ({
			id: p.id, code: String(p.name || ""), group: String(p.name || "").split(".")[0].toUpperCase(), description: p.description || "", effective: p.effective, expiration: p.expiration,
			value: p.value, legalRef: p.legal_ref || "", verified: p.verified !== false, current: inRange(p),
		}));
		// Chưa đối chiếu lên đầu; sau đó theo mã, ngày hiệu lực mới trước
		params.sort((a, b) => {
			if (a.verified !== b.verified) return a.verified ? 1 : -1;
			if (a.code !== b.code) return a.code < b.code ? -1 : 1;
			return String(b.effective || "").localeCompare(String(a.effective || ""));
		});
		const brackets = safe(() => Store.find("pit_bracket", { order: "{effective} DESC, {level}" }), []).map((b) => ({ id: b.id, effective: b.effective, expiration: b.expiration, level: b.level, upper: b.upper, rate: b.rate, legalRef: b.legal_ref || "", current: inRange(b) }));
		const components = safe(() => Store.find("ins_comp", { order: "{name}, {effective} DESC" }), []).map((c) => ({
			id: c.id, code: String(c.name || ""), description: c.description || "", effective: c.effective, expiration: c.expiration, employeeRate: c.ee_rate, employerRate: c.er_rate,
			wageBase: c.wage_base, unionOnly: !!c.union_only, capFactor: c.cap_factor, legalRef: c.legal_ref || "", current: inRange(c),
		}));
		return { today: day, params, brackets, components, unverified: params.filter((p) => !p.verified).length };
	}

	function verifyParam(body) {
		const id = needId(body && body.id, "Statutory parameter", "tham số pháp lý");
		const p = Store.get("param", id);
		if (!p) throw fail("Statutory parameter not found", "Không tìm thấy tham số pháp lý");
		if (p.verified !== false) return { id, code: p.name, effective: p.effective, verified: true, changed: false };
		Store.submit("param", id, { verified: true });
		return { id, code: p.name, effective: p.effective, verified: true, changed: true };
	}

	// ------------------------------------------------------------------ tài khoản mặc định, tài khoản bảo hiểm

	function accountValues(values) {
		const out = {};
		for (const k of ACCOUNT_FIELDS) if (has(values, k)) out[k] = optId(values[k], "Account", "Tài khoản") || null;
		if (!Object.keys(out).length) throw fail("Nothing to save", "Không có gì để lưu");
		return out;
	}

	/** POST saveSetupAccounts {scope: 'setup' | 'company', subsidiary, values}: chỉ nhận các trường tài khoản. */
	function saveSetupAccounts(body) {
		const b = body || {};
		const values = accountValues(b.values);
		if (b.scope === "company") {
			const subsidiary = needId(b.subsidiary, "Subsidiary", "công ty con");
			return Object.assign({ scope: "company" }, Profiles.saveCompany(subsidiary, values));
		}
		return Object.assign({ scope: "setup" }, Profiles.saveSetup(values));
	}

	/** POST saveInsuranceAccounts {items: [{code, account, vendor}]}: ghi cho mọi dòng đang dùng của cùng mã khoản trích. */
	function saveInsuranceAccounts(body) {
		const items = (body && body.items) || [];
		if (!items.length) throw fail("Nothing to save", "Không có gì để lưu");
		const rows = Store.find("ins_comp");
		const plan = [];
		for (const it of items) {
			const code = norm(it && it.code);
			if (!code) throw fail("Component code is required", "Thiếu mã khoản trích");
			const values = {};
			if (has(it, "account")) values.account = optId(it.account, "Account", "Tài khoản") || null;
			if (has(it, "vendor")) values.vendor = optId(it.vendor, "Vendor", "Cơ quan thu") || null;
			if (!Object.keys(values).length) continue;
			const mine = rows.filter((r) => norm(r.name) === code);
			if (!mine.length) throw fail(`Contribution ${code} not found`, `Không tìm thấy khoản trích ${code}`);
			for (const r of mine) if (!Object.keys(values).every((k) => String(r[k] || "") === String(values[k] || ""))) plan.push([r.id, values]);
		}
		// Kiểm hết rồi mới ghi: một dòng sai không để lại kết quả ghi dở
		for (const [id, values] of plan) Store.submit("ins_comp", id, values);
		return { updated: plan.length };
	}

	// ------------------------------------------------------------------ tài khoản chi phí lương theo đích

	function accountMap() {
		const map = {};
		for (const a of safe(() => Profiles.accounts(), [])) map[String(a.id)] = a;
		return map;
	}

	const accountLabel = (a) => (a ? `${a.number || ""} ${a.name || ""}`.trim() : "");

	function costAccounts(params) {
		const subsidiary = optId(params && params.subsidiary, "Subsidiary", "Công ty con");
		const day = today();
		let rows;
		try {
			rows = Store.find("cost_account", { includeInactive: true, order: "{id} DESC" });
		} catch (e) {
			// Record chưa deploy hoặc vai trò không đọc được: màn hình báo rõ thay vì lỗi chung
			return { subsidiary, today: day, rows: [], accounts: [], unavailable: true };
		}
		const accounts = accountMap();
		const names = {};
		if (rows.length) {
			const def = Store.rec("cost_account");
			const f = (k) => def.fields[k].id;
			const sql = `SELECT t.id AS id, BUILTIN.DF(t.${f("project")}) AS project_name, BUILTIN.DF(t.${f("work_center")}) AS wc_name, BUILTIN.DF(t.${f("department")}) AS dept_name, BUILTIN.DF(t.${f("account")}) AS account_name, BUILTIN.DF(t.${f("subsidiary")}) AS sub_name FROM ${def.type} t`;
			for (const r of safe(() => Store.run(sql, [], "s4vp_st_cost_names"), [])) names[String(r.id)] = r;
		}
		const maps = Rules.buildMaps(rows, { subsidiary, periodEnd: day, activeAccounts: Object.keys(accounts) });
		const out = rows.map((r) => {
			const type = norm(r.target_type);
			const field = TARGETS[type];
			const target = field && !blank(r[field]) ? String(r[field]) : "";
			const labor = norm(r.labor_type);
			const nm = names[String(r.id)] || {};
			const acc = accounts[String(r.account)];
			let state = "inUse";
			if (r.isInactive) state = "inactive";
			else if (blank(r.account) || !acc) state = "accountInactive";
			else if (!target) state = "invalid";
			else if (!blank(r.subsidiary) && String(r.subsidiary) !== subsidiary) state = "otherSubsidiary";
			else if (!blank(r.effective) && r.effective > day) state = "future";
			else {
				const table = type === "W" ? maps.workCenters : type === "P" ? maps.projects : maps.departments;
				const e = table[target];
				const winner = e ? (labor ? e.byLabor[labor] : e.account) : "";
				if (String(winner || "") !== String(r.account)) state = "overridden";
			}
			return {
				id: r.id, inactive: !!r.isInactive, subsidiary: blank(r.subsidiary) ? "" : String(r.subsidiary), subsidiaryName: nm.sub_name || "", targetType: type, target,
				targetName: (type === "W" ? nm.wc_name : type === "P" ? nm.project_name : nm.dept_name) || (target ? `#${target}` : ""), laborType: labor,
				account: blank(r.account) ? "" : String(r.account), accountName: accountLabel(acc) || nm.account_name || (blank(r.account) ? "" : `#${r.account}`), effective: r.effective || "", note: r.note || "", state,
			};
		});
		return { subsidiary, today: day, rows: out, accounts: Object.values(accounts) };
	}

	function sameKey(r, v) {
		const field = TARGETS[norm(v.target_type)];
		return String(r.subsidiary || "") === String(v.subsidiary || "") && norm(r.target_type) === norm(v.target_type) && String(r[field] || "") === String(v[field] || "") &&
			norm(r.labor_type) === norm(v.labor_type) && String(r.effective || "") === String(v.effective || "");
	}

	function assertNoDuplicate(values, selfId) {
		const hit = Store.find("cost_account").find((r) => String(r.id) !== String(selfId || "") && sameKey(r, values));
		if (hit) throw fail("Another active row already covers the same target, subsidiary, labor type and effective date", "Đã có dòng đang dùng cho cùng đích, công ty con, loại lao động và ngày hiệu lực");
	}

	function validDate(s) {
		if (!ISO.test(s)) return false;
		const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
		return d.toISOString().slice(0, 10) === s;
	}

	function saveCostAccount(body) {
		const b = body || {};
		const v = b.values || {};
		const type = norm(v.target_type);
		const field = TARGETS[type];
		if (!field) throw fail("Select the target type", "Chưa chọn loại đích");
		const target = needId(v[field], "Target", "đích (dự án, class hoặc phòng ban)");
		const account = needId(v.account, "Expense account", "tài khoản chi phí");
		const labor = norm(v.labor_type);
		if (labor && labor !== "E" && labor !== "C") throw fail("Labor type is not valid", "Loại lao động không hợp lệ");
		const effective = blank(v.effective) ? "" : String(v.effective).trim();
		if (effective && !validDate(effective)) throw fail("Effective date is not valid", "Ngày hiệu lực không hợp lệ");
		const active = Store.run("SELECT a.id AS id FROM account a WHERE a.id = ? AND a.isinactive = 'F'", [account], "s4vp_st_account");
		if (!active.length) throw fail("The account does not exist or is inactive", "Tài khoản không tồn tại hoặc đã ngừng dùng");
		const values = {
			subsidiary: optId(v.subsidiary, "Subsidiary", "Công ty con") || null, target_type: type, project: null, work_center: null, department: null,
			labor_type: labor || null, account, effective: effective || null, note: String(blank(v.note) ? "" : v.note).slice(0, 3900),
		};
		values[field] = target;
		const id = optId(b.id, "Row", "Dòng");
		if (id) {
			const cur = Store.get("cost_account", id);
			if (!cur) throw fail("Row not found", "Không tìm thấy dòng tài khoản");
			if (!cur.isInactive) assertNoDuplicate(values, id);
			Store.update("cost_account", id, values);
			return { id };
		}
		assertNoDuplicate(values, "");
		return { id: Store.create("cost_account", values) };
	}

	/** POST retireCostAccount {id, restore?}: ngừng dùng (inactive) hoặc dùng lại; không xóa. */
	function retireCostAccount(body) {
		const id = needId(body && body.id, "Row", "dòng tài khoản");
		const cur = Store.get("cost_account", id);
		if (!cur) throw fail("Row not found", "Không tìm thấy dòng tài khoản");
		const restore = !!(body && body.restore);
		if (restore === !cur.isInactive) return { id, inactive: !!cur.isInactive, changed: false };
		if (restore) assertNoDuplicate(cur, id);
		Store.update("cost_account", id, { isInactive: !restore });
		return { id, inactive: !restore, changed: true };
	}

	function costAccountTest(params) {
		const p = params || {};
		const subsidiary = optId(p.subsidiary, "Subsidiary", "Công ty con");
		const date = blank(p.date) ? today() : String(p.date).trim();
		if (!validDate(date)) throw fail("Date is not valid", "Ngày không hợp lệ");
		const line = { workCenter: optId(p.workCenter, "Class", "Class"), project: optId(p.project, "Project", "Dự án"), sub: optId(p.department, "Department", "Phòng ban") };
		const laborType = norm(p.laborType);
		const maps = CostAccounts.forPayroll(subsidiary, date);
		const defaultAccount = safe(() => Settings.resolve(subsidiary, null).accounts.acc_expense, null) || "";
		// Cùng hàm tính lương dùng; từng mức được hỏi riêng để biết mức nào quyết định
		const at = (l, tables) => Builder.resolveAccount(l, Object.assign({ laborType }, tables)).account || "";
		const levels = [
			{ level: "W", given: !!line.workCenter, account: at({ workCenter: line.workCenter }, { workCenters: maps.workCenters }) },
			{ level: "P", given: !!line.project, account: at({ project: line.project }, { projects: maps.projects }) },
			{ level: "D", given: !!line.sub, account: at({ sub: line.sub }, { departments: maps.departments }) },
			{ level: "default", given: true, account: defaultAccount },
		];
		const account = Builder.resolveAccount(line, Object.assign({ laborType, employeeAccount: "", employeeSub: "", defaultAccount, defaultSub: "" }, maps)).account || "";
		const winner = levels.find((l) => l.account) || null;
		const accounts = accountMap();
		const label = (id) => (id ? accountLabel(accounts[String(id)]) || `#${id}` : "");
		const out = {
			subsidiary, date, laborType, account: String(account || ""), accountName: label(account), level: account && winner ? winner.level : "none",
			steps: levels.map((l) => ({ level: l.level, given: l.given, account: String(l.account || ""), accountName: label(l.account) })),
		};
		if (maps.error) out.warning = "COST_ACCOUNT_UNREADABLE";
		return out;
	}

	// ------------------------------------------------------------------ cấp duyệt bảng lương

	/** Người dùng có quyền đăng nhập (giveaccess) làm danh sách chọn người duyệt; tối đa 1.000, không đọc được thì rỗng. */
	function approverUsers() {
		const sql = "SELECT * FROM (SELECT e.id AS id, e.entityid AS code, e.firstname AS first, e.lastname AS last FROM employee e WHERE e.isinactive = 'F' AND e.giveaccess = 'T' ORDER BY e.entityid) WHERE ROWNUM <= 1000";
		return safe(() => Store.run(sql, [], "s4vp_st_approvers"), []).map((e) => ({ id: String(e.id), code: e.code || "", name: [e.last, e.first].filter((x) => !blank(x)).join(" ") }));
	}

	function approvalSteps(params) {
		const subsidiary = optId(params && params.subsidiary, "Subsidiary", "Công ty con");
		let rows;
		try {
			rows = Store.find("approval_step", { includeInactive: true, order: "{level}, {id}" });
		} catch (e) {
			return { subsidiary, rows: [], levels: [], users: [], unavailable: true };
		}
		const names = {};
		if (rows.length) {
			const def = Store.rec("approval_step");
			const sql = `SELECT t.id AS id, BUILTIN.DF(t.${def.fields.approver.id}) AS approver_name, BUILTIN.DF(t.${def.fields.subsidiary.id}) AS sub_name FROM ${def.type} t`;
			for (const r of safe(() => Store.run(sql, [], "s4vp_st_apv_names"), [])) names[String(r.id)] = r;
		}
		const active = rows.filter((r) => !r.isInactive);
		const ownRows = !!subsidiary && active.some((r) => String(r.subsidiary || "") === subsidiary);
		const out = rows.map((r) => {
			const nm = names[String(r.id)] || {};
			const role = norm(r.role);
			const sub = blank(r.subsidiary) ? "" : String(r.subsidiary);
			let state = "inUse";
			if (r.isInactive) state = "inactive";
			else if (blank(r.approver) && !Flow.ROLE_IDS[role]) state = "invalid";
			else if (sub && sub !== subsidiary) state = "otherSubsidiary";
			else if (!sub && ownRows) state = "replaced";
			return {
				id: r.id, inactive: !!r.isInactive, level: Number(r.level) || 0, name: r.name || "", subsidiary: sub, subsidiaryName: nm.sub_name || "",
				approver: blank(r.approver) ? "" : String(r.approver), approverName: nm.approver_name || (blank(r.approver) ? "" : `#${r.approver}`),
				role: blank(r.approver) ? role : "", minNet: blank(r.min_net) ? null : Number(r.min_net), state,
			};
		});
		// Các cấp áp dụng cho công ty con đang chọn (không xét ngưỡng: ngưỡng hiện kèm từng người duyệt)
		const levels = Flow.requiredSteps(active, { subsidiary, net: Number.MAX_SAFE_INTEGER }).map((st) => ({
			level: st.level, name: st.name,
			approvers: out.filter((r) => r.state === "inUse" && r.level === st.level).map((r) => ({ id: r.id, employee: r.approver, employeeName: r.approverName, role: r.role, minNet: r.minNet })),
		}));
		return { subsidiary, rows: out, levels, users: approverUsers() };
	}

	function sameApprover(r, v) {
		return String(r.subsidiary || "") === String(v.subsidiary || "") && Number(r.level) === Number(v.level) && String(r.approver || "") === String(v.approver || "") &&
			(v.approver ? true : norm(r.role) === norm(v.role));
	}

	function assertNoDuplicateStep(values, selfId) {
		const hit = Store.find("approval_step").find((r) => String(r.id) !== String(selfId || "") && sameApprover(r, values));
		if (hit) throw fail("This approver is already on the same level for the same subsidiary", "Người duyệt này đã có ở cùng cấp, cùng công ty con");
	}

	function saveApprovalStep(body) {
		const b = body || {};
		const v = b.values || {};
		const levelText = String(blank(v.level) ? "" : v.level).trim();
		if (!/^\d{1,3}$/.test(levelText) || Number(levelText) < 1) throw fail("The level must be a whole number from 1", "Cấp phải là số nguyên từ 1");
		const approver = optId(v.approver, "Approver", "Người duyệt");
		const role = norm(v.role);
		if (role && !Flow.ROLE_IDS[role]) throw fail("Approver role is not valid", "Vai trò duyệt không hợp lệ");
		if (!approver && !role) throw fail("Select an approver or a role", "Chưa chọn người duyệt hoặc vai trò duyệt");
		let minNet = null;
		if (!blank(v.min_net)) {
			minNet = Number(v.min_net);
			if (!isFinite(minNet) || minNet < 0) throw fail("The net pay threshold is not valid", "Ngưỡng tổng thực lĩnh không hợp lệ");
		}
		const name = String(blank(v.name) ? "" : v.name).trim().slice(0, 300);
		if (!name) throw fail("Level name is required", "Chưa nhập tên cấp");
		// Có nhân viên thì vai trò không dùng (ApprovalFlow lấy nhân viên trước): không lưu vai trò để khỏi hiểu nhầm
		const values = { name, subsidiary: optId(v.subsidiary, "Subsidiary", "Công ty con") || null, level: Number(levelText), approver: approver || null, role: approver ? null : role, min_net: minNet };
		const id = optId(b.id, "Row", "Dòng");
		if (id) {
			const cur = Store.get("approval_step", id);
			if (!cur) throw fail("Row not found", "Không tìm thấy dòng cấp duyệt");
			if (!cur.isInactive) assertNoDuplicateStep(values, id);
			Store.update("approval_step", id, values);
			return { id };
		}
		assertNoDuplicateStep(values, "");
		return { id: Store.create("approval_step", values) };
	}

	/** POST retireApprovalStep {id, restore?}: ngừng dùng (inactive) hoặc dùng lại; không xóa. */
	function retireApprovalStep(body) {
		const id = needId(body && body.id, "Row", "dòng cấp duyệt");
		const cur = Store.get("approval_step", id);
		if (!cur) throw fail("Row not found", "Không tìm thấy dòng cấp duyệt");
		const restore = !!(body && body.restore);
		if (restore === !cur.isInactive) return { id, inactive: !!cur.isInactive, changed: false };
		if (restore) assertNoDuplicateStep(cur, id);
		Store.update("approval_step", id, { isInactive: !restore });
		return { id, inactive: !restore, changed: true };
	}

	const routes = {
		get: {
			setupStatus: { roles: "all", run: setupStatus },
			setupData: { roles: "all", run: setupData },
			setupLegal: { roles: "all", run: setupLegal },
			costAccounts: { roles: "all", run: costAccounts },
			costAccountTest: { roles: "all", run: costAccountTest },
			approvalSteps: { roles: "all", run: approvalSteps },
		},
		post: {
			saveCostAccount: { roles: "acct", run: saveCostAccount },
			retireCostAccount: { roles: "acct", run: retireCostAccount },
			saveSetupAccounts: { roles: "acct", run: saveSetupAccounts },
			saveInsuranceAccounts: { roles: "acct", run: saveInsuranceAccounts },
			saveApprovalStep: { roles: "acct", run: saveApprovalStep },
			retireApprovalStep: { roles: "acct", run: retireApprovalStep },
			verifyParam: { roles: "hr", run: verifyParam },
		},
	};

	return { routes, setupStatus, setupData, setupLegal, verifyParam, saveSetupAccounts, saveInsuranceAccounts, costAccounts, saveCostAccount, retireCostAccount, costAccountTest, approvalSteps, saveApprovalStep, retireApprovalStep };
});
