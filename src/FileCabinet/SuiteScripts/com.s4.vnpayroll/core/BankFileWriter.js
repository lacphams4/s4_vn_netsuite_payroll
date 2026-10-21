/**
 * File chi lương ngân hàng (Export Bank Payment File, đặc tả mục 4.6.7).
 *
 * CSV UTF-8 có BOM, mọi ô trong ngoặc kép (ngoặc kép bên trong nhân đôi), phân cách dấu phẩy, tên file
 * ChiLuong_{BatchNbr}_{PeriodID}.csv. Chỉ nhân viên có thực lĩnh > 0, sắp theo mã nhân viên.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Errors"], (Money, Errors) => {
	const HEADERS = ["STT", "Ma NV", "Ho ten", "So tai khoan", "Ngan hang", "So tien", "Noi dung"];

	function cell(v) {
		return `"${String(v === null || v === undefined ? "" : v).replace(/"/g, '""')}"`;
	}

	/** 'MM/yyyy' từ tháng tính thuế yyyyMM; trống thì mã kỳ. */
	function monthLabel(taxMonth, periodId) {
		const m = /^(\d{4})(\d{2})$/.exec(String(taxMonth || "").trim());
		return m ? `${m[2]}/${m[1]}` : String(periodId || "");
	}

	/**
	 * @param {{batchNbr, periodId, taxMonth}} batch
	 * @param {Array<{code, name, bankAccount, bankName, netPay}>} employees
	 * @param {{lang?: 'vi'|'en', eol?: string}} [options]
	 * @returns {{fileName: string, content: string, count: number, total: number}}
	 */
	function write(batch, employees, options) {
		const opts = options || {};
		const rows = (employees || []).filter((e) => Money.D(e.netPay).gt(0))
			.sort((a, b) => (String(a.code) < String(b.code) ? -1 : String(a.code) > String(b.code) ? 1 : 0));
		const missing = rows.filter((e) => !String(e.bankAccount || "").trim()).map((e) => e.code);
		if (missing.length) {
			throw Errors.invalid(`Bank account number is missing for employees: ${missing.join(", ")}.`, `Thiếu số tài khoản ngân hàng của nhân viên: ${missing.join(", ")}.`);
		}
		const prefix = (opts.lang || "vi") === "en" ? "Salary" : "Lương";
		const month = monthLabel(batch.taxMonth, batch.periodId);
		const eol = opts.eol || "\r\n";
		const lines = [HEADERS.map(cell).join(",")];
		rows.forEach((e, i) => {
			lines.push([i + 1, e.code, e.name, String(e.bankAccount).trim(), e.bankName || "", Money.round(e.netPay), `${prefix} ${month} ${e.name}`].map(cell).join(","));
		});
		return {
			fileName: `ChiLuong_${batch.batchNbr}_${batch.periodId}.csv`,
			content: "﻿" + lines.join(eol) + eol,
			count: rows.length,
			total: Money.sum(rows, (e) => Money.round(e.netPay)).toNumber(),
		};
	}

	return { write, HEADERS, monthLabel };
});
