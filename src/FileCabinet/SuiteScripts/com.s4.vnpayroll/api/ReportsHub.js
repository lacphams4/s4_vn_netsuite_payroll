/**
 * Báo cáo - tờ khai (giao diện bản 2). Mô-đun route (docs/UI_V2.md mục 5, 14).
 *
 * Các báo cáo đã có (insurance, pitq, pita, cost) vẫn chạy qua action cũ `report` của RESTlet (api/Reports); mô-đun này chỉ
 * thêm danh mục và các bảng còn thiếu mà dữ liệu gói đã có đủ. Phần tính ở core/ReportExtras.
 *
 * Route (roles "payroll"; không route nào đọc sổ cái - đối chiếu sổ cái nằm ở báo cáo `cost` của api/Reports):
 * - GET reportsCatalog {subsidiary} -> {latest: {calculated, released}, months: [{taxMonth, batches, released, employees, gross}],
 *     items: [{key, cadence, source, period, hasData, batches, released, pending}], printBatch, today}. Hai truy vấn (batch, period).
 * - GET reportsHtkk {subsidiary, form: '05kk' | '05qtt', year, quarter?, releasedOnly?: 'T'} -> phiếu số liệu nhập HTKK:
 *     05kk  {form, basis, year, quarter, taxpayer: {name, taxId}, columns, rows: [{code, vi, en, value, kind, computed}], notComputed, notes}
 *     05qtt {form, basis, year, taxpayer, tables: [{schedule, columns, rows, totals, summary}], summary, notes}
 *     Cột của 05qtt theo cột của gói Acumatica (chưa đối chiếu phụ lục mẫu pháp lý) - xem core/ReportExtras.
 * - GET reportsFund {subsidiary, taxMonth? | year + quarter?, releasedOnly?} -> quỹ lương theo phòng ban x loại lao động
 *     {period, columns, rows, totals, byType, batches, pending, warnings}. Truy vấn gom nhóm trên batch_emp (không đọc detail);
 *     phòng ban = phòng ban của hồ sơ lương, trống thì của hồ sơ nhân viên NetSuite (giá trị HIỆN TẠI, không phải lúc tính lương).
 * - GET reportsPitLedger {subsidiary, year, releasedOnly?} -> sổ theo dõi thuế TNCN đã khấu trừ theo nhân viên, 12 tháng
 *     {year, columns, taxableColumns, rows, totals, months, summary, batches, pending, warnings}.
 *
 * Bảng lương dùng được: đã tính, không đảo, cùng công ty con; releasedOnly = 'T' thì chỉ bảng đã ghi sổ. Kỳ quy về tháng tính
 * thuế (tax_month, trống thì mã kỳ yyyyMM) như api/Reports. Dữ liệu lương nhạy cảm: không ghi số tiền, số định danh vào log.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Clock", "./Reports", "../core/ReportData", "../core/ReportExtras", "../core/PayrollReports"], (Store, Clock, Reports, ReportData, Extras, PayrollReports) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const str = (v) => (blank(v) ? "" : String(v));
	const num = (v) => {
		const n = Number(v);
		return blank(v) || !isFinite(n) ? 0 : n;
	};
	const CHUNK = 900;

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	const tbl = (name) => Store.rec(name).type;
	const fld = (name, field) => Store.rec(name).fields[field].id;
	/** Chỉ id nguyên được ghép thẳng vào câu lệnh (id bản ghi NetSuite luôn là số nguyên). */
	const idList = (ids) => [...new Set((ids || []).map(str).filter((x) => /^\d+$/.test(x)))];
	const chunks = (list) => {
		const out = [];
		for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
		return out;
	};

	// ------------------------------------------------------------------ bảng lương của công ty con

	/** Mọi bảng lương của công ty con kèm tháng tính thuế đã chuẩn hóa (hai truy vấn: batch, period). */
	function batchesOf(subsidiary) {
		const periods = {};
		for (const p of Store.find("period", { includeInactive: true })) periods[p.id] = p.name;
		const rows = blank(subsidiary) ? Store.find("batch") : Store.find("batch", { where: "{subsidiary} = ?", params: [subsidiary] });
		return rows.map((b) => Object.assign({}, b, { periodName: periods[b.period] || "", tax_month: PayrollReports.taxMonthOf({ taxMonth: b.tax_month, periodId: periods[b.period] || "" }) }));
	}

	/** Bảng lương dùng được trong phạm vi tháng. */
	function usable(subsidiary, monthFilter, releasedOnly) {
		return ReportData.usableBatches(batchesOf(subsidiary), { releasedOnly: !!releasedOnly }).filter((b) => monthFilter(b.tax_month));
	}

	const releasedOnlyOf = (p) => p.releasedOnly === "T" || p.releasedOnly === true;

	function yearOf(p) {
		const year = Number(p.year);
		if (!(year >= 2000 && year <= 2100) || Math.floor(year) !== year) throw fail("Year is required", "Thiếu năm");
		return year;
	}

	/** Phạm vi kỳ từ tham số: taxMonth (yyyyMM) | year + quarter | year. */
	function periodOf(p) {
		const tm = str(p.taxMonth).replace("-", "");
		if (tm) {
			if (!/^\d{6}$/.test(tm) || +tm.slice(4, 6) < 1 || +tm.slice(4, 6) > 12) throw fail("Tax month must be yyyyMM", "Tháng tính thuế phải dạng yyyyMM");
			return { kind: "month", taxMonth: tm, test: (m) => m === tm };
		}
		const year = yearOf(p);
		if (!blank(p.quarter)) {
			const quarter = Number(p.quarter);
			if (!(quarter >= 1 && quarter <= 4) || Math.floor(quarter) !== quarter) throw fail("Quarter must be 1 to 4", "Quý phải từ 1 đến 4");
			return { kind: "quarter", year, quarter, test: (m) => Number(m.slice(0, 4)) === year && PayrollReports.quarterOf(m) === quarter };
		}
		return { kind: "year", year, test: (m) => Number(m.slice(0, 4)) === year };
	}

	const periodView = (p) => (p.kind === "month" ? { kind: p.kind, taxMonth: p.taxMonth } : p.kind === "quarter" ? { kind: p.kind, year: p.year, quarter: p.quarter } : { kind: p.kind, year: p.year });

	// ------------------------------------------------------------------ danh mục

	function catalog(p) {
		const today = Clock.today();
		return Object.assign(Extras.catalog(batchesOf(p.subsidiary), today), { today });
	}

	// ------------------------------------------------------------------ người nộp thuế

	/** Tên pháp lý và mã số thuế của công ty con; không đọc được trường nào thì để trống (không ném lỗi). */
	function taxpayer(subsidiary) {
		if (blank(subsidiary)) return { name: "", taxId: "" };
		try {
			const r = Store.run("SELECT s.name, s.legalname, s.federalidnumber FROM subsidiary s WHERE s.id = ?", [subsidiary], "s4vp_rh_taxpayer")[0] || {};
			return { name: str(r.legalname) || str(r.name), taxId: str(r.federalidnumber) };
		} catch (e) {
			try {
				const r = Store.run("SELECT s.name FROM subsidiary s WHERE s.id = ?", [subsidiary], "s4vp_rh_taxpayer_name")[0] || {};
				return { name: str(r.name), taxId: "" };
			} catch (x) {
				return { name: "", taxId: "" };
			}
		}
	}

	// ------------------------------------------------------------------ số liệu nhập HTKK

	function htkk(p) {
		const releasedOnly = releasedOnlyOf(p);
		const form = str(p.form).toLowerCase();
		if (form === "05kk") {
			const report = Reports.pitQuarter({ subsidiary: p.subsidiary, year: p.year, quarter: p.quarter, releasedOnly });
			return Extras.htkkQuarterSheet(report, { taxpayer: taxpayer(p.subsidiary), releasedOnly });
		}
		if (form === "05qtt") {
			const report = Reports.pitAnnual({ subsidiary: p.subsidiary, year: p.year, schedule: "", releasedOnly });
			return Extras.htkkAnnualTables(report, { taxpayer: taxpayer(p.subsidiary), releasedOnly });
		}
		throw fail("Unknown form", "Mẫu tờ khai không hợp lệ");
	}

	// ------------------------------------------------------------------ quỹ lương theo phòng ban x loại lao động

	function departmentNames(ids) {
		const out = {};
		const list = idList(ids);
		if (!list.length) return out;
		try {
			for (const part of chunks(list)) for (const d of Store.run(`SELECT d.id, d.name FROM department d WHERE d.id IN (${part.join(",")})`, [], "s4vp_rh_dept")) out[str(d.id)] = d.name;
		} catch (e) {
			// Account không bật phòng ban hoặc vai trò không đọc được: hiện id
		}
		return out;
	}

	function fundGroups(batchIds) {
		const l = (f) => `l.${fld("batch_emp", f)}`;
		const sums = `COUNT(DISTINCT ${l("employee")}) AS headcount, SUM(${l("gross")}) AS gross, SUM(${l("ee_ins")}) AS ee_ins, SUM(${l("er_ins")}) AS er_ins, SUM(${l("pit")}) AS pit, `
			+ `SUM(${l("other_ded")}) AS other_ded, SUM(${l("advance")}) AS advance, SUM(${l("net")}) AS net, SUM(${l("accrued13")}) AS accrued13`;
		const dept = `p.${fld("employee", "department")}`;
		const where = `l.isinactive = 'F' AND ${l("batch")} IN (${batchIds.join(",")})`;
		const profileJoin = `LEFT JOIN ${tbl("employee")} p ON p.id = ${l("profile")}`;
		let rows;
		try {
			rows = Store.run(
				`SELECT COALESCE(${dept}, e.department) AS department, ${l("employment_type")} AS etype, ${sums} FROM ${tbl("batch_emp")} l ${profileJoin} `
				+ `LEFT JOIN employee e ON e.id = ${l("employee")} WHERE ${where} GROUP BY COALESCE(${dept}, e.department), ${l("employment_type")}`,
				[], "s4vp_rh_fund"
			);
		} catch (e) {
			// Vai trò không nối được bảng employee: chỉ lấy phòng ban của hồ sơ lương
			rows = Store.run(
				`SELECT ${dept} AS department, ${l("employment_type")} AS etype, ${sums} FROM ${tbl("batch_emp")} l ${profileJoin} WHERE ${where} GROUP BY ${dept}, ${l("employment_type")}`,
				[], "s4vp_rh_fund_profile"
			);
		}
		return rows.map((r) => ({
			department: str(r.department), employmentType: Store.codeOf("employment_type", r.etype) || "E", headcount: num(r.headcount), gross: num(r.gross), eeIns: num(r.ee_ins),
			erIns: num(r.er_ins), pit: num(r.pit), otherDed: num(r.other_ded), advance: num(r.advance), net: num(r.net), accrued13: num(r.accrued13),
		}));
	}

	function fund(p) {
		const period = periodOf(p);
		const batches = usable(p.subsidiary, period.test, releasedOnlyOf(p));
		const parts = chunks(idList(batches.map((b) => b.id)));
		let groups = [];
		let headcount;
		for (const part of parts) groups = groups.concat(fundGroups(part));
		if (parts.length === 1) {
			// Số người không trùng của cả kỳ (một người thuộc nhiều bảng lương hoặc hai nhóm chỉ đếm một lần ở dòng tổng)
			const r = Store.run(`SELECT COUNT(DISTINCT l.${fld("batch_emp", "employee")}) AS headcount FROM ${tbl("batch_emp")} l WHERE l.isinactive = 'F' AND l.${fld("batch_emp", "batch")} IN (${parts[0].join(",")})`, [], "s4vp_rh_fund_head")[0] || {};
			headcount = num(r.headcount);
		}
		const out = Extras.fundSummary(groups, { departments: departmentNames(groups.map((g) => g.department)), headcount });
		return Object.assign(out, { period: periodView(period), releasedOnly: releasedOnlyOf(p), batches: batches.length, pending: batches.filter((b) => b.status !== "R").length });
	}

	// ------------------------------------------------------------------ sổ theo dõi thuế TNCN đã khấu trừ

	function employeeInfo(ids) {
		const out = {};
		const p = (f) => `p.${fld("employee", f)}`;
		for (const part of chunks(idList(ids))) {
			for (const r of Store.run(`SELECT e.id, e.entityid, e.firstname, e.lastname FROM employee e WHERE e.id IN (${part.join(",")})`, [], "s4vp_rh_emp")) {
				out[str(r.id)] = { code: r.entityid, name: [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || r.entityid, taxCode: "", employmentType: "" };
			}
			for (const r of Store.run(`SELECT ${p("employee")} AS employee, ${p("tax_code")} AS tax_code, ${p("employment_type")} AS etype FROM ${tbl("employee")} p WHERE p.isinactive = 'F' AND ${p("employee")} IN (${part.join(",")})`, [], "s4vp_rh_profile")) {
				const k = str(r.employee);
				out[k] = Object.assign(out[k] || { code: k, name: "" }, { taxCode: str(r.tax_code), employmentType: Store.codeOf("employment_type", r.etype) || "" });
			}
		}
		return out;
	}

	function pitLedger(p) {
		const year = yearOf(p);
		const batches = usable(p.subsidiary, (m) => Number(m.slice(0, 4)) === year, releasedOnlyOf(p));
		const byId = {};
		for (const b of batches) byId[str(b.id)] = { taxMonth: b.tax_month };
		const l = (f) => `l.${fld("batch_emp", f)}`;
		let lines = [];
		for (const part of chunks(idList(batches.map((b) => b.id)))) {
			lines = lines.concat(Store.run(
				`SELECT ${l("employee")} AS employee, ${l("batch")} AS batch, ${l("employment_type")} AS etype, ${l("taxable")} AS taxable, ${l("pit")} AS pit FROM ${tbl("batch_emp")} l `
				+ `WHERE l.isinactive = 'F' AND ${l("batch")} IN (${part.join(",")})`,
				[], "s4vp_rh_pit_lines"
			).map((r) => ({ employee: str(r.employee), batch: str(r.batch), employment_type: Store.codeOf("employment_type", r.etype) || "", taxable: num(r.taxable), pit: num(r.pit) })));
		}
		const out = Extras.pitLedger(lines, byId, employeeInfo(lines.map((x) => x.employee)), year);
		return Object.assign(out, { releasedOnly: releasedOnlyOf(p), batches: batches.length, pending: batches.filter((b) => b.status !== "R").length });
	}

	const routes = {
		get: {
			reportsCatalog: { roles: "payroll", run: (params) => catalog(params) },
			reportsHtkk: { roles: "payroll", run: (params) => htkk(params) },
			reportsFund: { roles: "payroll", run: (params) => fund(params) },
			reportsPitLedger: { roles: "payroll", run: (params) => pitLedger(params) },
		},
		post: {},
	};

	return { routes, catalog, htkk, fund, pitLedger, taxpayer };
});
