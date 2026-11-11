/**
 * Phần tính của phân hệ Báo cáo - tờ khai bản 2 (docs/UI_V2.md mục 14), bổ sung cho core/ReportData:
 *
 * - catalog: danh mục hồ sơ theo nhịp (tháng, quý, năm, bản in) kèm kỳ gợi ý = kỳ gần nhất có bảng lương đã tính / đã ghi sổ.
 * - htkkQuarterSheet: phiếu số liệu để nhập HTKK cho tờ khai 05/KK-TNCN (mã chỉ tiêu, tên, số) từ pitQuarterReport.
 * - htkkAnnualTables: bảng dữ liệu quyết toán năm tách 05-1/BK và 05-2/BK từ pitAnnualReport.
 * - fundSummary: tổng hợp quỹ lương theo phòng ban x loại lao động từ các dòng đã gom nhóm của batch_emp.
 * - pitLedger: sổ theo dõi thuế TNCN đã khấu trừ theo nhân viên, 12 tháng của năm.
 *
 * MẪU PHÁP LÝ: module này KHÔNG tự đặt mã chỉ tiêu. Mã [16] - [32] của 05/KK-TNCN lấy nguyên từ core/ReportData (đã có
 * trong gói). Thứ tự cột của hai bảng quyết toán năm theo cột của gói Acumatica (màn VP404000), CHƯA đối chiếu với phụ lục
 * 05-1/BK-QTT-TNCN, 05-2/BK-QTT-TNCN của mẫu pháp lý; vì vậy cột không mang mã chỉ tiêu và kết quả có basis = "ACUMATICA".
 *
 * Không đọc NetSuite: lớp api/ReportsHub đọc record rồi gọi các hàm ở đây. Tháng tính thuế dạng yyyyMM.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./PayrollReports"], (Money, Reports) => {
	const D = Money.D;
	const blank = (v) => v === null || v === undefined || v === "";
	const str = (v) => (blank(v) ? "" : String(v));
	const num = (v) => {
		const n = Number(v);
		return blank(v) || !isFinite(n) ? 0 : n;
	};
	const norm = (s) => str(s).trim().toUpperCase();
	const col = (key, vi, en, type) => ({ key, vi, en, type: type || "text" });
	const isMonth = (m) => /^\d{6}$/.test(str(m)) && +str(m).slice(4, 6) >= 1 && +str(m).slice(4, 6) <= 12;
	const pad2 = (n) => String(n).padStart(2, "0");
	const sumOf = (rows, key) => Money.sum(rows, (r) => num(r[key])).toNumber();
	const BASIS = "ACUMATICA";

	// ------------------------------------------------------------------ danh mục

	/** Các báo cáo của màn mới; cadence: monthly | quarterly | yearly | print; source: bảng lương đã tính (calculated) hay đã ghi sổ (released). */
	const CATALOG = [
		{ key: "insurance", cadence: "monthly", source: "calculated" },
		{ key: "cost", cadence: "monthly", source: "released" },
		{ key: "fund", cadence: "monthly", source: "calculated" },
		{ key: "pitq", cadence: "quarterly", source: "calculated" },
		{ key: "pitLedger", cadence: "yearly", source: "calculated" },
		{ key: "pita", cadence: "yearly", source: "calculated" },
		{ key: "print", cadence: "print", source: "calculated" },
	];

	/**
	 * Số liệu theo tháng tính thuế của các bảng lương dùng được (đã tính, không đảo).
	 * @param {Array} batches [{id, name, status, calculated, tax_month (yyyyMM đã chuẩn hóa), emp_count, gross, net}]
	 * @returns {Array<{taxMonth, batches, released, employees, gross}>} tháng mới nhất trước
	 */
	function monthsOf(batches) {
		const map = new Map();
		for (const b of batches || []) {
			if (!b || b.status === "V" || !b.calculated || !isMonth(b.tax_month)) continue;
			const m = map.get(b.tax_month) || { taxMonth: b.tax_month, batches: 0, released: 0, employees: 0, gross: D(0) };
			m.batches += 1;
			if (b.status === "R") m.released += 1;
			m.employees += num(b.emp_count);
			m.gross = m.gross.plus(D(num(b.gross)));
			map.set(b.tax_month, m);
		}
		return [...map.values()].map((m) => Object.assign(m, { gross: m.gross.toNumber() })).sort((a, b) => (a.taxMonth < b.taxMonth ? 1 : -1));
	}

	function rangeStats(months, pred) {
		const list = months.filter((m) => pred(m.taxMonth));
		return { batches: list.reduce((s, m) => s + m.batches, 0), released: list.reduce((s, m) => s + m.released, 0), months: list.length };
	}

	/**
	 * Danh mục hồ sơ kèm kỳ gợi ý.
	 * @param {Array} batches như monthsOf
	 * @param {string} today ISO yyyy-mm-dd, dùng khi chưa có bảng lương nào
	 * @returns {{latest: {calculated, released}, months, items: Array<{key, cadence, source, period, hasData, batches, released, pending}>, printBatch}}
	 */
	function catalog(batches, today) {
		const months = monthsOf(batches);
		const calculated = months.length ? months[0].taxMonth : "";
		const releasedMonth = (months.find((m) => m.released > 0) || {}).taxMonth || "";
		const fallback = /^\d{4}-\d{2}/.test(str(today)) ? str(today).slice(0, 4) + str(today).slice(5, 7) : "";
		const items = CATALOG.map((def) => {
			const base = def.source === "released" ? releasedMonth || calculated : calculated;
			const tm = base || fallback;
			const year = tm ? Number(tm.slice(0, 4)) : null;
			let period = {};
			let stats = { batches: 0, released: 0, months: 0 };
			if (def.cadence === "monthly") {
				period = { taxMonth: tm };
				stats = rangeStats(months, (m) => m === tm);
			} else if (def.cadence === "quarterly") {
				const quarter = tm ? Reports.quarterOf(tm) : null;
				period = { year, quarter };
				stats = rangeStats(months, (m) => Number(m.slice(0, 4)) === year && Reports.quarterOf(m) === quarter);
			} else if (def.cadence === "yearly") {
				period = { year };
				stats = rangeStats(months, (m) => Number(m.slice(0, 4)) === year);
			} else {
				period = { taxMonth: tm };
				stats = rangeStats(months, (m) => m === tm);
			}
			return { key: def.key, cadence: def.cadence, source: def.source, period, hasData: stats.batches > 0, batches: stats.batches, released: stats.released, pending: stats.batches - stats.released, months: stats.months };
		});
		// Bảng lương mới nhất in được (đã tính, không đảo): id lớn nhất trong tháng mới nhất
		let printBatch = null;
		for (const b of batches || []) {
			if (!b || b.status === "V" || !b.calculated) continue;
			if (!printBatch || str(b.tax_month) > str(printBatch.tax_month) || (str(b.tax_month) === str(printBatch.tax_month) && num(b.id) > num(printBatch.id))) printBatch = b;
		}
		return {
			latest: { calculated, released: releasedMonth }, months, items,
			printBatch: printBatch ? { id: str(printBatch.id), name: str(printBatch.name), taxMonth: str(printBatch.tax_month), status: str(printBatch.status) } : null,
		};
	}

	// ------------------------------------------------------------------ số liệu nhập HTKK

	const SHEET_COLS = [col("code", "Mã chỉ tiêu", "Indicator code"), col("name", "Chỉ tiêu", "Indicator"), col("value", "Số liệu", "Figure", "money")];
	/** Chỉ tiêu là số người (đếm), còn lại là số tiền. */
	const COUNT_CODES = ["[16]", "[17]", "[18]", "[19]", "[20]"];
	/** Chỉ tiêu gói chưa tính (core/PayrollReports luôn đặt 0): người khai tự nhập nếu có phát sinh. */
	const NOT_COMPUTED = ["[24]", "[25]", "[32]"];

	function taxpayerOf(t) {
		return { name: str(t && t.name).trim(), taxId: str(t && t.taxId).trim() };
	}

	/**
	 * Phiếu số liệu nhập HTKK cho tờ khai 05/KK-TNCN quý (tương đương "HTKK Data Sheet" của gói Acumatica: mã, tên, số).
	 * @param {Object} report kết quả ReportData.pitQuarterReport
	 * @param {{taxpayer?: {name, taxId}, releasedOnly?: boolean}} opt
	 */
	function htkkQuarterSheet(report, opt = {}) {
		const r = report || {};
		const taxpayer = taxpayerOf(opt.taxpayer);
		const rows = (r.indicators || []).map((i) => ({
			code: i.code, vi: i.vi, en: i.en, value: num(i.value), kind: COUNT_CODES.includes(i.code) ? "count" : "money", computed: !NOT_COMPUTED.includes(i.code),
		}));
		const notes = [];
		if (!opt.releasedOnly) notes.push("UNRELEASED_INCLUDED");
		if (!taxpayer.taxId) notes.push("NO_TAX_ID");
		if (rows.some((x) => !x.computed)) notes.push("NOT_COMPUTED");
		if (!(r.rows || []).length) notes.push("NO_DATA");
		return {
			form: "05/KK-TNCN", basis: BASIS, year: num(r.year), quarter: num(r.quarter), taxpayer, releasedOnly: !!opt.releasedOnly,
			columns: SHEET_COLS, rows, notComputed: NOT_COMPUTED.slice(), notes,
		};
	}

	// Thứ tự cột theo màn VP404000 của gói Acumatica (Employee, Personal Tax Code, Citizen ID, Residency, Pay Periods, Taxable Income,
	// Taxable Income Subject to Withholding, Dependents, Family Deductions, Deductible Insurance, Charity and Voluntary Pension,
	// Assessable Income, PIT Withheld), thêm số thứ tự ở đầu. Không gắn mã chỉ tiêu của mẫu pháp lý.
	const ANNUAL_COLS = [
		col("stt", "STT", "No.", "number"), col("employeeCode", "Mã NV", "Employee ID"), col("employeeName", "Họ và tên", "Full name"),
		col("taxCode", "Mã số thuế", "Tax code"), col("idNumber", "Số CCCD / hộ chiếu", "ID / passport number"), col("residentText", "Cư trú", "Resident"),
		col("periods", "Số kỳ lương", "Pay periods", "number"), col("taxableIncome", "Tổng thu nhập chịu thuế", "Total taxable income", "money"),
		col("withholdingIncome", "TNCT thuộc diện khấu trừ", "Taxable income subject to withholding", "money"),
		col("dependentCount", "Số người phụ thuộc", "Dependents", "number"), col("familyDeduction", "Giảm trừ gia cảnh", "Family deductions", "money"),
		col("insurance", "Bảo hiểm được trừ", "Deductible insurance", "money"), col("otherDeductions", "Từ thiện, hưu trí tự nguyện", "Charity and voluntary pension", "money"),
		col("assessableIncome", "Thu nhập tính thuế", "Assessable income", "money"), col("pit", "Thuế TNCN đã khấu trừ", "PIT withheld", "money"),
	];
	const ANNUAL_MONEY = ANNUAL_COLS.filter((c) => c.type === "money").map((c) => c.key);
	const SCHEDULES = ["05-1/BK", "05-2/BK"];

	/**
	 * Bảng dữ liệu quyết toán năm (để nhập HTKK tờ 05/QTT-TNCN), tách theo bảng kê; cột theo gói Acumatica.
	 * @param {Object} report kết quả ReportData.pitAnnualReport với schedule trống (cả hai bảng kê)
	 * @param {{taxpayer?: {name, taxId}, releasedOnly?: boolean}} opt
	 */
	function htkkAnnualTables(report, opt = {}) {
		const r = report || {};
		const all = r.rows || [];
		const taxpayer = taxpayerOf(opt.taxpayer);
		const tables = SCHEDULES.map((s) => {
			const rows = all.filter((x) => x.schedule === s).map((x, i) => Object.assign({}, x, { stt: i + 1, residentText: x.resident === false ? "" : "x" }));
			const totals = {};
			for (const k of ANNUAL_MONEY) totals[k] = sumOf(rows, k);
			return {
				schedule: s, columns: ANNUAL_COLS, rows, totals,
				summary: {
					people: rows.length, withheld: rows.filter((x) => num(x.pit) > 0).length, nonResident: rows.filter((x) => x.resident === false).length,
					noTaxCode: rows.filter((x) => !str(x.taxCode).trim()).length, noId: rows.filter((x) => !str(x.idNumber).trim()).length,
					taxableIncome: totals.taxableIncome, pit: totals.pit,
				},
			};
		});
		const notes = [];
		if (!opt.releasedOnly) notes.push("UNRELEASED_INCLUDED");
		if (!taxpayer.taxId) notes.push("NO_TAX_ID");
		if (tables.some((t) => t.summary.noTaxCode > 0)) notes.push("NO_TAX_CODE");
		if (!all.length) notes.push("NO_DATA");
		return {
			form: "05/QTT-TNCN", basis: BASIS, year: num(r.year), taxpayer, releasedOnly: !!opt.releasedOnly, tables, notes,
			summary: { people: all.length, taxableIncome: sumOf(all, "taxableIncome"), pit: sumOf(all, "pit") },
		};
	}

	// ------------------------------------------------------------------ quỹ lương theo phòng ban x loại lao động

	const FUND_COLS = [
		col("departmentName", "Phòng ban", "Department"), col("employmentType", "Loại lao động", "Employment type"), col("headcount", "Số người", "Headcount", "number"),
		col("gross", "Tổng thu nhập", "Gross pay", "money"), col("eeIns", "BH NLĐ đóng", "Employee insurance", "money"), col("pit", "Thuế TNCN", "PIT", "money"),
		col("otherDed", "Khấu trừ khác", "Other deductions", "money"), col("advance", "Cấn trừ tạm ứng", "Advance offset", "money"), col("net", "Thực lĩnh", "Net pay", "money"),
		col("erIns", "BH, KPCĐ DN đóng", "Employer contributions", "money"), col("accrued13", "Trích lương tháng 13", "13th-month accrual", "money"),
		col("cost", "Tổng quỹ lương", "Total payroll cost", "money"), col("avgGross", "Thu nhập bình quân", "Average gross", "money"), col("share", "Tỷ trọng", "Share", "pct"),
	];
	const FUND_SUMS = ["gross", "eeIns", "pit", "otherDed", "advance", "net", "erIns", "accrued13"];

	/**
	 * Tổng hợp quỹ lương. Tổng quỹ lương của một dòng = tổng thu nhập + phần doanh nghiệp đóng + trích lương tháng 13.
	 * @param {Array} groups dòng đã gom nhóm: [{department, employmentType ('E' | 'C'), headcount, gross, eeIns, erIns, pit, otherDed, advance, net, accrued13}]
	 * @param {{departments?: Object<string, string>, headcount?: number}} ref tên phòng ban theo id; headcount = số người không trùng của cả kỳ
	 *   (thiếu thì cộng số người các dòng - một người đổi phòng ban trong kỳ sẽ bị đếm hai lần)
	 * @returns {{columns, rows, totals, byType, warnings}}
	 */
	function fundSummary(groups, ref = {}) {
		const depts = ref.departments || {};
		const map = new Map();
		for (const g of groups || []) {
			const dept = str(g.department);
			const type = norm(g.employmentType) === "C" ? "C" : "E";
			const k = `${dept}|${type}`;
			const e = map.get(k) || { department: dept, employmentType: type, headcount: 0 };
			e.headcount += num(g.headcount);
			for (const f of FUND_SUMS) e[f] = D(e[f] || 0).plus(D(num(g[f])));
			map.set(k, e);
		}
		const rows = [...map.values()].map((e) => {
			const out = { department: e.department, departmentName: depts[e.department] || e.department, employmentType: e.employmentType, headcount: e.headcount };
			for (const f of FUND_SUMS) out[f] = e[f].toNumber();
			out.cost = D(out.gross).plus(D(out.erIns)).plus(D(out.accrued13)).toNumber();
			out.avgGross = out.headcount > 0 ? Money.round(D(out.gross).div(out.headcount)) : null;
			return out;
		}).filter((r) => r.headcount > 0 || FUND_SUMS.some((f) => r[f] !== 0))
			// Phòng ban trống xếp cuối; trong một phòng ban: nhân viên trước, cộng tác viên sau
			.sort((a, b) => {
				if (!a.department !== !b.department) return a.department ? -1 : 1;
				return String(a.departmentName).localeCompare(String(b.departmentName)) || (a.employmentType === b.employmentType ? 0 : a.employmentType === "E" ? -1 : 1);
			});
		const totals = { headcount: blank(ref.headcount) ? rows.reduce((s, r) => s + r.headcount, 0) : num(ref.headcount) };
		for (const f of FUND_SUMS.concat(["cost"])) totals[f] = sumOf(rows, f);
		totals.avgGross = totals.headcount > 0 ? Money.round(D(totals.gross).div(totals.headcount)) : null;
		totals.share = totals.cost ? 1 : null;
		for (const r of rows) r.share = totals.cost ? D(r.cost).div(totals.cost).toDecimalPlaces(4).toNumber() : null;
		const byType = ["E", "C"].map((t) => {
			const list = rows.filter((r) => r.employmentType === t);
			return { employmentType: t, headcount: list.reduce((s, r) => s + r.headcount, 0), gross: sumOf(list, "gross"), net: sumOf(list, "net"), cost: sumOf(list, "cost") };
		});
		const warnings = [];
		const noDept = rows.filter((r) => !r.department);
		if (noDept.length) {
			const n = noDept.reduce((s, r) => s + r.headcount, 0);
			warnings.push({ code: "NO_DEPARTMENT", count: n, vi: `${n} người chưa có phòng ban trên hồ sơ lương hoặc hồ sơ nhân viên`, en: `${n} employee(s) have no department on the payroll profile or the employee record` });
		}
		return { columns: FUND_COLS, rows, totals, byType, warnings };
	}

	// ------------------------------------------------------------------ sổ theo dõi thuế TNCN đã khấu trừ

	const monthKeys = (prefix) => Array.from({ length: 12 }, (x, i) => `${prefix}${pad2(i + 1)}`);
	const PIT_KEYS = monthKeys("pit");
	const TAXABLE_KEYS = monthKeys("taxable");
	const LEDGER_HEAD = [
		col("employeeCode", "Mã NV", "Employee ID"), col("employeeName", "Họ và tên", "Full name"), col("taxCode", "Mã số thuế", "Tax code"),
		col("employmentType", "Loại lao động", "Employment type"),
	];
	const monthCols = (keys) => keys.map((k, i) => col(k, `T${pad2(i + 1)}`, `M${pad2(i + 1)}`, "money"));
	const LEDGER_PIT_COLS = LEDGER_HEAD.concat(monthCols(PIT_KEYS), [col("pitTotal", "Thuế đã khấu trừ cả năm", "PIT withheld for the year", "money"), col("taxableTotal", "TNCT cả năm", "Taxable income for the year", "money")]);
	const LEDGER_TAXABLE_COLS = LEDGER_HEAD.concat(monthCols(TAXABLE_KEYS), [col("taxableTotal", "TNCT cả năm", "Taxable income for the year", "money"), col("pitTotal", "Thuế đã khấu trừ cả năm", "PIT withheld for the year", "money")]);

	/**
	 * Sổ theo dõi thuế TNCN đã khấu trừ: mỗi người một dòng, 12 cột tháng (thuế đã khấu trừ và thu nhập chịu thuế), tổng năm.
	 * @param {Array} lines dòng nhân viên của bảng lương dùng được trong năm: [{employee, batch, taxable, pit, employment_type?, count?}]
	 *   count: số dòng lương đã gộp sẵn vào một phần tử (truy vấn gom nhóm của api/ReportsHub); không có thì là 1 dòng
	 * @param {Object<string, {taxMonth: string}>} batches theo id bảng lương (tháng tính thuế yyyyMM đã chuẩn hóa)
	 * @param {Object<string, {code, name, taxCode, employmentType}>} info theo id nhân viên
	 * @param {number} year
	 * @returns {{year, columns, taxableColumns, rows, totals, months, warnings}} months: tháng (1 - 12) có số liệu
	 */
	function pitLedger(lines, batches, info, year) {
		const y = Number(year);
		const map = new Map();
		const used = new Set();
		for (const l of lines || []) {
			const b = (batches || {})[str(l.batch)];
			const tm = b ? str(b.taxMonth) : "";
			if (!isMonth(tm) || Number(tm.slice(0, 4)) !== y) continue;
			const mm = tm.slice(4, 6);
			const k = str(l.employee);
			const p = (info || {})[k] || {};
			const e = map.get(k) || {
				employee: k, employeeCode: p.code || k, employeeName: p.name || "", taxCode: str(p.taxCode), employmentType: norm(p.employmentType || l.employment_type) === "C" ? "C" : "E",
				pit: {}, taxable: {}, periods: 0,
			};
			e.pit[mm] = D(e.pit[mm] || 0).plus(D(num(l.pit)));
			e.taxable[mm] = D(e.taxable[mm] || 0).plus(D(num(l.taxable)));
			e.periods += l.count === undefined || l.count === null ? 1 : num(l.count);
			if (num(l.pit) !== 0 || num(l.taxable) !== 0) used.add(Number(mm));
			map.set(k, e);
		}
		const rows = [...map.values()].map((e) => {
			const out = { employee: e.employee, employeeCode: e.employeeCode, employeeName: e.employeeName, taxCode: e.taxCode, employmentType: e.employmentType, periods: e.periods };
			let pit = D(0);
			let taxable = D(0);
			for (let i = 1; i <= 12; i++) {
				const mm = pad2(i);
				const p = e.pit[mm] || null;
				const t = e.taxable[mm] || null;
				// Tháng không có bảng lương để trống (null), khác với tháng có bảng lương nhưng thuế bằng 0
				out[`pit${mm}`] = p ? p.toNumber() : null;
				out[`taxable${mm}`] = t ? t.toNumber() : null;
				if (p) pit = pit.plus(p);
				if (t) taxable = taxable.plus(t);
			}
			out.pitTotal = pit.toNumber();
			out.taxableTotal = taxable.toNumber();
			return out;
		}).filter((r) => r.pitTotal !== 0 || r.taxableTotal !== 0)
			.sort((a, b) => (String(a.employeeCode) < String(b.employeeCode) ? -1 : String(a.employeeCode) > String(b.employeeCode) ? 1 : 0));
		const totals = { pitTotal: sumOf(rows, "pitTotal"), taxableTotal: sumOf(rows, "taxableTotal") };
		for (const k of PIT_KEYS.concat(TAXABLE_KEYS)) totals[k] = sumOf(rows, k);
		const warnings = [];
		const noCode = rows.filter((r) => r.pitTotal > 0 && !r.taxCode.trim()).length;
		if (noCode) warnings.push({ code: "NO_TAX_CODE", count: noCode, vi: `${noCode} người đã bị khấu trừ thuế nhưng chưa có mã số thuế trên hồ sơ lương`, en: `${noCode} employee(s) with PIT withheld have no tax code on the payroll profile` });
		const negative = rows.filter((r) => PIT_KEYS.some((k) => num(r[k]) < 0)).length;
		if (negative) warnings.push({ code: "NEGATIVE_PIT", count: negative, vi: `${negative} người có tháng thuế khấu trừ âm`, en: `${negative} employee(s) have a month with negative PIT withheld` });
		return {
			year: y, columns: LEDGER_PIT_COLS, taxableColumns: LEDGER_TAXABLE_COLS, rows, totals, months: [...used].sort((a, b) => a - b),
			summary: { people: rows.length, withheld: rows.filter((r) => r.pitTotal > 0).length, pit: totals.pitTotal, taxableIncome: totals.taxableTotal },
			warnings,
		};
	}

	return { CATALOG, BASIS, monthsOf, catalog, htkkQuarterSheet, htkkAnnualTables, fundSummary, pitLedger };
});
