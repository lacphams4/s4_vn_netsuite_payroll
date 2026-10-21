/**
 * Gom dữ liệu báo cáo, tờ khai từ bảng lương đã tính (đặc tả 4.7.2 - 4.7.5, VP402000 - VP405000) thành bảng thuần
 * {columns, rows, totals, warnings} cho SPA hiển thị và xuất CSV. Phần tính chỉ tiêu nằm ở PayrollReports; module này
 * chỉ chuyển record (batch, batch_emp, hồ sơ) sang dòng nguồn, lọc bảng lương dùng được và dựng cột song ngữ.
 *
 * Bảng lương dùng được: đã tính (calculated), không đảo (status khác V); releasedOnly thì chỉ bảng đã ghi sổ (R).
 * Không đọc NetSuite: lớp api/Reports đọc record rồi gọi các hàm ở đây.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./PayrollReports"], (Money, Dates, Reports) => {
	const D = Money.D;
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const col = (key, vi, en, type) => ({ key, vi, en, type: type || "text" });

	function usableBatches(batches, opt = {}) {
		return (batches || []).filter((b) => b.status !== "V" && b.calculated && (!opt.releasedOnly || b.status === "R"));
	}

	function parseDetail(line) {
		if (!line || !line.detail) return {};
		if (typeof line.detail === "object") return line.detail;
		try {
			return JSON.parse(line.detail);
		} catch (e) {
			return {};
		}
	}

	/**
	 * Dòng nguồn theo cấu trúc PayrollReports từ dòng nhân viên bảng lương.
	 * @param {Array} batches bảng lương dùng được {id, tax_month, periodName}
	 * @param {Array} lines dòng batch_emp {batch, employee, employment_type, taxable, pit, family_ded, dependents, ee_ins,
	 *   other_tax_ded, assessable, insurance_wage, gross, detail}
	 * @param {Object<string, object>} profiles theo id nhân viên {pit_method, tax_code, personal_id, si_number, employment_type}
	 * @param {Object<string, {code, name}>} info theo id nhân viên
	 */
	function sourceRows(batches, lines, profiles, info) {
		const byId = {};
		for (const b of batches || []) byId[String(b.id)] = b;
		const out = [];
		for (const l of lines || []) {
			const b = byId[String(l.batch)];
			if (!b) continue;
			const d = parseDetail(l);
			const p = (profiles || {})[String(l.employee)] || {};
			const e = (info || {})[String(l.employee)] || {};
			const insurance = d.insurance || [];
			const unionFee = insurance.filter((i) => norm(i.code) === "DOANPHI").reduce((s, i) => s + (Number(i.employeeAmount) || 0), 0);
			out.push({
				batch: String(l.batch), employee: String(l.employee), employeeCode: e.code || String(l.employee), employeeName: e.name || "",
				taxMonth: b.tax_month || "", periodId: b.periodName || "", pitMethod: p.pit_method || "P", employmentType: l.employment_type || p.employment_type || d.employmentType || "E",
				grossPay: l.gross || 0, taxableIncome: l.taxable || 0, pit: l.pit || 0, familyDeduction: l.family_ded || 0, dependentCount: l.dependents || 0,
				employeeCompulsoryInsurance: d.employeeCompulsoryInsurance !== undefined ? d.employeeCompulsoryInsurance : (l.ee_ins || 0) - unionFee,
				otherTaxDeductions: l.other_tax_ded || 0, assessableIncome: l.assessable || 0, insuranceWage: l.insurance_wage || 0,
				taxCode: p.tax_code || "", idNumber: p.personal_id || "", socialInsuranceNbr: p.si_number || "",
				insurance: insurance.map((i) => ({ code: i.code, wageBase: i.wageBase || 0, employeeAmount: i.employeeAmount || 0, employerAmount: i.employerAmount || 0 })),
				accrued13th: l.accrued13 || 0, allocations: d.allocations || [], expenseAccount: d.expenseAccount || "",
			});
		}
		return out;
	}

	/** Ngày hiệu lực của lịch sử lương mới nhất đến ngày d. */
	function wageEffective(compensations, d) {
		let best = null;
		for (const c of compensations || []) if (c.effective && Dates.cmp(c.effective, d) <= 0 && (!best || Dates.cmp(c.effective, best) > 0)) best = c.effective;
		return best;
	}

	function monthEnd(taxMonth) {
		return Dates.endOfMonth(`${String(taxMonth).slice(0, 4)}-${String(taxMonth).slice(4, 6)}-01`);
	}

	function prevMonth(taxMonth) {
		return Dates.yyyymm(Dates.addMonths(`${String(taxMonth).slice(0, 4)}-${String(taxMonth).slice(4, 6)}-01`, -1));
	}

	function sumCols(rows, keys) {
		const t = {};
		for (const k of keys) t[k] = Money.sum(rows, (r) => r[k] || 0).toNumber();
		return t;
	}

	const INS_COLS = [
		col("employeeCode", "Mã NV", "Employee ID"), col("employeeName", "Họ tên", "Name"), col("socialInsuranceNbr", "Số sổ BHXH", "SI book no."),
		col("insuranceWage", "Lương đóng BH", "Insurance wage", "money"),
		col("eeSocial", "NLĐ BHXH", "EE social", "money"), col("eeHealth", "NLĐ BHYT", "EE health", "money"), col("eeUnemployment", "NLĐ BHTN", "EE unemployment", "money"),
		col("eeTotal", "Tổng NLĐ", "EE total", "money"), col("erSocial", "DN BHXH", "ER social", "money"), col("erAccident", "DN BHTNLĐ", "ER accident", "money"),
		col("erHealth", "DN BHYT", "ER health", "money"), col("erUnemployment", "DN BHTN", "ER unemployment", "money"), col("erTotal", "Tổng DN", "ER total", "money"),
		col("total", "Tổng cộng", "Total", "money"), col("erUnionFund", "KPCĐ (DN)", "Trade union fund", "money"), col("eeUnionFee", "Đoàn phí", "Union fee", "money"),
	];
	const D02_COLS = [
		col("employeeCode", "Mã NV", "Employee ID"), col("employeeName", "Họ tên", "Name"), col("code", "Mã biến động", "Change code"),
		col("fromMonth", "Từ tháng", "From"), col("toMonth", "Đến tháng", "To"), col("oldWage", "Mức đóng cũ", "Old wage", "money"), col("newWage", "Mức đóng mới", "New wage", "money"),
	];

	/**
	 * VP402000 Bảng BH phải nộp tháng + D02-LT.
	 * @param {Array} rows dòng nguồn tháng báo cáo
	 * @param {Array|null} prevRows dòng nguồn tháng trước; null = tháng trước không có bảng lương nào
	 * @param {Object} profiles theo id nhân viên {insuranceApplicable, employmentType, hireDate, terminationDate, wageEffectiveDate}
	 * @param {Object} prevProfiles như trên, wageEffectiveDate tính đến cuối tháng trước
	 */
	function insuranceReport(rows, prevRows, profiles, prevProfiles, taxMonth, c12Amount) {
		const lines = Reports.insuranceByEmployee(rows).sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode)));
		const keys = INS_COLS.filter((c) => c.type === "money").map((c) => c.key);
		const totals = sumCols(lines, keys);
		const warnings = [];
		const hasC12 = c12Amount !== null && c12Amount !== undefined && c12Amount !== "";
		const c12Difference = hasC12 ? Reports.c12Difference(lines, c12Amount) : null;
		if (hasC12 && c12Difference !== 0) warnings.push({ code: "C12_DIFF", vi: `Chênh lệch so với thông báo C12-TS: ${c12Difference}`, en: `Difference against C12-TS: ${c12Difference}` });
		const current = Reports.monthRecords(rows, profiles);
		const previous = prevRows === null ? null : Reports.monthRecords(prevRows, prevProfiles);
		// Tháng dạng MM/yyyy do PayrollReports.d02 trả về
		const changes = Reports.d02(current, previous, taxMonth).map((c) => Object.assign({}, c, { employeeCode: c.employeeCode || c.employee, employeeName: c.employeeName || "" }));
		if (previous === null) warnings.push({ code: "NO_PREV", vi: "Tháng trước chưa có bảng lương: chỉ báo tăng người vào làm trong tháng", en: "No payroll in the previous month: only new hires are reported as increases" });
		return { taxMonth, columns: INS_COLS, rows: lines, totals, c12Amount: hasC12 ? Number(c12Amount) : null, c12Difference, d02: { columns: D02_COLS, rows: changes }, warnings };
	}

	const PEOPLE_COLS = [
		col("employeeCode", "Mã NV", "Employee ID"), col("employeeName", "Họ tên", "Name"), col("taxCode", "MST", "Tax code"), col("idNumber", "Số CCCD", "ID number"),
		col("schedule", "Bảng kê", "Schedule"), col("residentText", "Cư trú", "Resident"), col("periods", "Số kỳ", "Periods", "number"),
		col("taxableIncome", "TN chịu thuế", "Taxable income", "money"), col("withholdingIncome", "TN thuộc diện khấu trừ", "Income subject to withholding", "money"),
		col("dependentCount", "Số NPT", "Dependents", "number"), col("familyDeduction", "Giảm trừ gia cảnh", "Family deduction", "money"),
		col("insurance", "BH bắt buộc", "Compulsory insurance", "money"), col("otherDeductions", "Giảm trừ khác", "Other deductions", "money"),
		col("assessableIncome", "TN tính thuế", "Assessable income", "money"), col("pit", "Thuế đã khấu trừ", "PIT withheld", "money"),
	];
	const MONEY_PEOPLE = PEOPLE_COLS.filter((c) => c.type === "money").map((c) => c.key);

	function peopleRows(list) {
		return list.map((r) => Object.assign({}, r, { residentText: r.resident ? "x" : "" }));
	}

	const INDICATORS = {
		16: ["Tổng số người lao động", "Total employees"], 17: ["Cá nhân cư trú có HĐLĐ", "Residents with labor contracts"],
		18: ["Tổng số cá nhân đã khấu trừ thuế", "Individuals with tax withheld"], 19: ["Cá nhân cư trú", "Residents"], 20: ["Cá nhân không cư trú", "Non-residents"],
		21: ["Tổng TNCT trả cho cá nhân", "Total taxable income paid"], 22: ["Cá nhân cư trú", "Residents"], 23: ["Cá nhân không cư trú", "Non-residents"],
		24: ["TNCT từ tiền phí mua bảo hiểm nhân thọ...", "Taxable life insurance premiums"], 25: ["TNCT làm căn cứ tính giảm thuế", "Income for tax reduction"],
		26: ["Tổng TNCT trả cho cá nhân thuộc diện khấu trừ", "Taxable income subject to withholding"], 27: ["Cá nhân cư trú", "Residents"], 28: ["Cá nhân không cư trú", "Non-residents"],
		29: ["Tổng số thuế TNCN đã khấu trừ", "Total PIT withheld"], 30: ["Cá nhân cư trú", "Residents"], 31: ["Cá nhân không cư trú", "Non-residents"],
		32: ["Số thuế được giảm", "Tax reduction"],
	};

	/** VP403000 tờ khai 05/KK-TNCN quý. */
	function pitQuarterReport(rows, year, quarter) {
		const q = Reports.pitQuarterly(rows, year, quarter);
		const indicators = Object.keys(INDICATORS).map((k) => ({ code: `[${k}]`, vi: INDICATORS[k][0], en: INDICATORS[k][1], value: q.indicators[k] || 0 }));
		const people = peopleRows(q.people);
		return {
			year: Number(year), quarter: Number(quarter), indicators, indicatorValues: q.indicators,
			columns: PEOPLE_COLS, rows: people, totals: sumCols(people, MONEY_PEOPLE), warnings: [],
		};
	}

	/** VP404000 dữ liệu quyết toán năm; schedule '05-1' | '05-2' | '' (cả hai). */
	function pitAnnualReport(rows, year, schedule) {
		const s = !schedule ? "" : /^05-1/.test(schedule) ? "05-1/BK" : /^05-2/.test(schedule) ? "05-2/BK" : schedule;
		const list = peopleRows(Reports.pitAnnual(rows, year, s));
		return { year: Number(year), schedule: s, columns: PEOPLE_COLS, rows: list, totals: sumCols(list, MONEY_PEOPLE), warnings: [] };
	}

	const COST_COLS = [
		col("accountNumber", "Tài khoản", "Account"), col("accountName", "Tên tài khoản", "Account name"), col("department", "Phòng ban", "Department"),
		col("wages", "Lương", "Wages", "money"), col("employerIns", "BH DN đóng", "Employer contributions", "money"),
		col("accrued13th", "Trích trước tháng 13", "13th-month accrual", "money"), col("contractor", "Phí CTV", "Contractor fees", "money"),
		col("total", "Tổng chi phí", "Total cost", "money"), col("gl", "Phát sinh trên bút toán (Nợ - Có)", "Journal net (Dr - Cr)", "money"), col("difference", "Chênh lệch", "Difference", "money"),
	];

	/**
	 * VP405000 tối giản: chi phí nhân sự theo tài khoản (và phòng ban), so với phát sinh Nợ - Có cùng tài khoản trên
	 * bút toán ghi sổ của các bảng lương. glLines null = không đọc được bút toán (không so sánh).
	 * @param {Array} rows dòng nguồn (có allocations, accrued13th, expenseAccount, employmentType)
	 * @param {Array|null} glLines [{account, debit, credit}]
	 * @param {{defaultExpenseAccount, accounts: Object<string, {number, name}>, departments: Object<string, string>}} ref
	 */
	function costReport(rows, glLines, ref = {}) {
		const map = new Map();
		const get = (account, dept) => {
			const k = `${account || ""}|${dept || ""}`;
			if (!map.has(k)) map.set(k, { account: String(account || ""), department: String(dept || ""), wages: D(0), employerIns: D(0), accrued13th: D(0), contractor: D(0) });
			return map.get(k);
		};
		for (const r of rows || []) {
			const ctr = norm(r.employmentType) === "C";
			for (const a of r.allocations || []) {
				const e = get(a.account, a.sub);
				if (norm(a.component) === "ERINS") e.employerIns = e.employerIns.plus(D(a.amount));
				else if (ctr) e.contractor = e.contractor.plus(D(a.amount));
				else e.wages = e.wages.plus(D(a.amount));
			}
			if (!ctr && D(r.accrued13th).gt(0)) {
				const e = get(r.expenseAccount || ref.defaultExpenseAccount || "", "");
				e.accrued13th = e.accrued13th.plus(D(r.accrued13th));
			}
		}
		// Bút toán: Nợ - Có theo tài khoản (gộp mọi phòng ban); so với tổng chi phí cùng tài khoản
		const gl = {};
		if (glLines) for (const l of glLines) gl[String(l.account)] = (gl[String(l.account)] || D(0)).plus(D(l.debit)).minus(D(l.credit));
		const accounts = ref.accounts || {};
		const depts = ref.departments || {};
		const out = [...map.values()].map((e) => {
			const total = e.wages.plus(e.employerIns).plus(e.accrued13th).plus(e.contractor);
			const acc = accounts[e.account] || {};
			return {
				account: e.account, accountNumber: acc.number || e.account, accountName: acc.name || "", department: depts[e.department] || e.department,
				wages: e.wages.toNumber(), employerIns: e.employerIns.toNumber(), accrued13th: e.accrued13th.toNumber(), contractor: e.contractor.toNumber(), total: total.toNumber(),
			};
		}).sort((a, b) => String(a.accountNumber).localeCompare(String(b.accountNumber)) || String(a.department).localeCompare(String(b.department)));
		// Gán số bút toán và chênh lệch trên dòng đầu của mỗi tài khoản (bút toán không tách phòng ban khi so)
		const seen = new Set();
		const accTotal = {};
		for (const r of out) accTotal[r.account] = (accTotal[r.account] || 0) + r.total;
		for (const r of out) {
			if (glLines && !seen.has(r.account)) {
				seen.add(r.account);
				const g = (gl[r.account] || D(0)).toNumber();
				r.gl = g;
				r.difference = accTotal[r.account] - g;
			} else {
				r.gl = null;
				r.difference = null;
			}
		}
		const warnings = [];
		const diff = out.filter((r) => r.difference);
		if (glLines && diff.length) warnings.push({ code: "GL_DIFF", vi: `${diff.length} tài khoản lệch giữa bảng lương và bút toán`, en: `${diff.length} account(s) differ between payroll and journal entries` });
		const totals = sumCols(out, ["wages", "employerIns", "accrued13th", "contractor", "total"]);
		if (glLines) {
			totals.gl = Money.sum(out.filter((r) => r.gl !== null), (r) => r.gl).toNumber();
			totals.difference = totals.total - totals.gl;
		}
		return { columns: COST_COLS, rows: out, totals, glCompared: !!glLines, warnings };
	}

	/** Bảng (columns + rows) thành CSV theo ngôn ngữ: UTF-8 có BOM, ô trong ngoặc kép. */
	function toCsv(table, lang) {
		const l = lang === "en" ? "en" : "vi";
		const esc = (v) => `"${String(v === null || v === undefined ? "" : v).replace(/"/g, '""')}"`;
		const head = table.columns.map((c) => esc(c[l])).join(",");
		const body = table.rows.map((r) => table.columns.map((c) => esc(r[c.key])).join(","));
		return "﻿" + [head].concat(body).join("\r\n");
	}

	return { usableBatches, parseDetail, sourceRows, wageEffective, monthEnd, prevMonth, insuranceReport, pitQuarterReport, pitAnnualReport, costReport, toCsv };
});
