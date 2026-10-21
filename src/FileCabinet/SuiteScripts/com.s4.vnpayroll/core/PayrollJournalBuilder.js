/**
 * Dựng bút toán của phân hệ lương (đặc tả mục 4.6.2 - 4.6.6), đầu ra trung lập để lớp NetSuite tạo Journal Entry,
 * Vendor Bill.
 *
 * Dòng: {account, sub, debit, credit, memo, branch, project, task, costCode, workCenter}. sub là tiểu khoản (trên
 * NetSuite ánh xạ sang Department hoặc phân đoạn khác theo cấu hình của lớp ghi).
 * Quy tắc chung: gộp dòng cùng (tài khoản, tiểu khoản, dự án, task, cost code, diễn giải, chi nhánh); bỏ dòng tổng 0;
 * thiếu tài khoản -> lỗi nêu diễn giải; tổng khác 0 -> lỗi không cân; khác chi nhánh khi chưa bật liên chi nhánh -> lỗi.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Errors"], (Money, Errors) => {
	const D = Money.D;
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const blank = (s) => norm(s) === "";

	const LABELS = {
		en: {
			expense: "Payroll expense {p}", contractor: "Contractor service fees {p}", employer: "Employer contributions {p}", wages: "Wages payable {p}",
			contractorPayable: "Contractor fees payable {p}", pit: "Personal income tax withheld", deduction: "Other deduction {n}", advance: "Advance offset {n}",
			accrual: "13th-month salary accrual {p}", header: "Payroll batch {b} period {p}", reversal: "Reversal of payroll batch {b} (period {p})",
			payrollAdvance: "Payroll advance {n}", pitBill: "Personal income tax", billMemo: "{n} payroll period {p}",
		},
		vi: {
			expense: "Chi phí lương {p}", contractor: "Thù lao cộng tác viên {p}", employer: "BH, KPCĐ doanh nghiệp đóng {p}", wages: "Phải trả người lao động {p}",
			contractorPayable: "Phải trả cộng tác viên {p}", pit: "Thuế TNCN đã khấu trừ", deduction: "Khấu trừ khác {n}", advance: "Cấn trừ tạm ứng {n}",
			accrual: "Trích trước lương tháng 13 {p}", header: "Bảng lương {b} kỳ {p}", reversal: "Đảo bảng lương {b} (kỳ {p})",
			payrollAdvance: "Tạm ứng lương {n}", pitBill: "Thuế thu nhập cá nhân", billMemo: "{n} kỳ lương {p}",
		},
	};

	function label(lang, key, vars) {
		const t = (LABELS[lang] || LABELS.en)[key];
		return t.replace("{p}", vars.p || "").replace("{b}", vars.b || "").replace("{n}", vars.n || "").trim();
	}

	function lineKey(l) {
		return [l.account, l.sub, l.project, l.task, l.costCode, l.memo, l.branch].map(norm).join("|");
	}

	/**
	 * Gộp, kiểm tra và chuyển dòng có dấu (dương Nợ, âm Có) thành debit / credit.
	 * @param {Array<{account, sub, amount, memo, branch, project, task, costCode}>} signed
	 * @param {{branch?, interBranch?: boolean, defaultSub?, requireSub?: boolean}} [options]
	 */
	function finalize(signed, options) {
		const opts = options || {};
		const map = new Map();
		for (const l of signed) {
			if (D(l.amount).isZero()) continue;
			if (blank(l.account)) throw Errors.invalid(`The account is not specified for the line "${l.memo}".`, `Thiếu tài khoản cho dòng "${l.memo}".`);
			const sub = blank(l.sub) ? opts.defaultSub || "" : l.sub;
			if (opts.requireSub && blank(sub)) throw Errors.invalid(`The subaccount is not specified for the line "${l.memo}".`, `Thiếu tiểu khoản cho dòng "${l.memo}".`);
			const branch = blank(l.branch) ? opts.branch || "" : l.branch;
			if (!opts.interBranch && !blank(opts.branch) && norm(branch) !== norm(opts.branch)) {
				throw Errors.invalid(`The line "${l.memo}" belongs to branch ${branch}; inter-branch entries are not enabled.`, `Dòng "${l.memo}" thuộc chi nhánh ${branch} khác chi nhánh bút toán; chưa bật bút toán liên chi nhánh.`);
			}
			const row = { account: l.account, sub, project: l.project || "", task: l.task || "", costCode: l.costCode || "", memo: l.memo, branch, workCenter: l.workCenter || "" };
			const k = lineKey(row);
			const cur = map.get(k);
			if (cur) cur.amount = cur.amount.plus(D(l.amount));
			else map.set(k, Object.assign(row, { amount: D(l.amount) }));
		}
		const rows = [...map.values()].filter((r) => !r.amount.isZero());
		if (!rows.length) throw Errors.invalid("The journal entry has no lines.", "Bút toán không có dòng nào.");
		const total = Money.sum(rows, (r) => r.amount);
		if (!total.isZero()) throw Errors.invalid(`The journal entry is not balanced (difference ${total.toString()}).`, `Bút toán không cân (chênh lệch ${total.toString()}).`);
		return rows.map((r) => {
			const amt = r.amount;
			delete r.amount;
			return Object.assign(r, { debit: amt.gt(0) ? amt.toNumber() : 0, credit: amt.lt(0) ? amt.neg().toNumber() : 0 });
		});
	}

	/**
	 * Bút toán ghi sổ bảng lương (4.6.2).
	 * @param {{batchNbr, periodId, branch, date, grossTotal, employerInsTotal,
	 *   employees: Array<{employee, employmentType, netPay, accrued13th, expenseAccount, expenseSub, pit,
	 *     insurance: Array<{code, employeeAmount, employerAmount}>, deductions: Array<{code, name, amount, account}>,
	 *     advanceOffsets: Array<{refNbr, amount}>, allocations: Array<{component, amount, account, sub, project, task, costCode, branch, workCenter}>}>}} batch
	 * @param {{payableAccount, payableSub, contractorPayableAccount, pitPayableAccount, otherDeductionAccount, advanceAccount,
	 *   accrued13thAccount, defaultExpenseAccount, defaultExpenseSub, components: Object<string, {name, liabilityAccount}>,
	 *   interBranch?: boolean, requireSub?: boolean, lang?: 'en'|'vi'}} config
	 * @returns {{memo: string, date, branch, lines: Array}}
	 */
	function buildRelease(batch, config) {
		const cfg = config || {};
		const lang = cfg.lang || "en";
		const p = batch.periodId;
		const employees = batch.employees || [];
		if (!employees.length) throw Errors.invalid("The payroll batch has no employees.", "Bảng lương không có nhân viên.");
		if (blank(cfg.payableAccount)) throw Errors.invalid("The wages payable account (334) is not specified.", "Chưa khai tài khoản phải trả người lao động (334).");

		const allocTotal = Money.sum(employees, (e) => Money.sum(e.allocations || [], (a) => a.amount));
		const expected = D(batch.grossTotal).plus(D(batch.employerInsTotal));
		if (!allocTotal.eq(expected)) {
			throw Errors.invalid(`The allocated amount ${allocTotal.toString()} differs from gross pay plus employer contributions ${expected.toString()}.`,
				`Tổng phân bổ ${allocTotal.toString()} khác tổng thu nhập cộng BH doanh nghiệp đóng ${expected.toString()}; tính lại bảng lương.`);
		}

		const signed = [];
		const add = (account, sub, amount, memo, extra) => signed.push(Object.assign({ account, sub: sub || "", amount: D(amount), memo, branch: batch.branch || "" }, extra || {}));
		let netE = D(0);
		let netC = D(0);
		let pit = D(0);
		const comp = new Map();
		const deductions = [];
		const offsets = [];
		let accrual = D(0);
		for (const e of employees) {
			const contractor = norm(e.employmentType) === "C";
			for (const a of e.allocations || []) {
				const memo = norm(a.component) === "ERINS" ? label(lang, "employer", { p }) : label(lang, contractor ? "contractor" : "expense", { p });
				add(a.account, a.sub, a.amount, memo, { project: a.project || "", task: a.task || "", costCode: a.costCode || "", branch: a.branch || batch.branch || "", workCenter: a.workCenter || "" });
			}
			if (contractor) netC = netC.plus(D(e.netPay));
			else netE = netE.plus(D(e.netPay));
			pit = pit.plus(D(e.pit));
			for (const i of e.insurance || []) comp.set(norm(i.code), (comp.get(norm(i.code)) || D(0)).plus(D(i.employeeAmount)).plus(D(i.employerAmount)));
			for (const d of e.deductions || []) deductions.push(d);
			for (const o of e.advanceOffsets || []) offsets.push(o);
			if (!contractor && D(e.accrued13th).gt(0)) {
				accrual = accrual.plus(D(e.accrued13th));
				add(e.expenseAccount || cfg.defaultExpenseAccount, e.expenseAccount ? e.expenseSub : cfg.defaultExpenseSub, e.accrued13th, label(lang, "accrual", { p }));
			}
		}
		add(cfg.payableAccount, cfg.payableSub, netE.neg(), label(lang, "wages", { p }));
		if (!netC.isZero()) {
			if (blank(cfg.contractorPayableAccount)) throw Errors.invalid("The contractor payable account is not specified.", "Chưa khai tài khoản phải trả cộng tác viên.");
			add(cfg.contractorPayableAccount, "", netC.neg(), label(lang, "contractorPayable", { p }));
		}
		for (const [code, amt] of comp.entries()) {
			if (amt.isZero()) continue;
			const c = (cfg.components || {})[code] || {};
			const memo = `${c.name || code} ${p}`.trim();
			if (blank(c.liabilityAccount)) throw Errors.invalid(`The liability account is not specified for "${memo}".`, `Thiếu tài khoản phải trả cho khoản "${memo}".`);
			add(c.liabilityAccount, "", amt.neg(), memo);
		}
		if (!pit.isZero()) add(cfg.pitPayableAccount, "", pit.neg(), label(lang, "pit", { p }));
		for (const d of deductions) if (!D(d.amount).isZero()) add(d.account || cfg.otherDeductionAccount, "", D(d.amount).neg(), label(lang, "deduction", { n: d.name || d.code }));
		const byAdvance = new Map();
		for (const o of offsets) byAdvance.set(o.refNbr, (byAdvance.get(o.refNbr) || D(0)).plus(D(o.amount)));
		for (const [ref, amt] of byAdvance.entries()) if (!amt.isZero()) add(cfg.advanceAccount, "", amt.neg(), label(lang, "advance", { n: ref }));
		if (!accrual.isZero()) {
			if (blank(cfg.accrued13thAccount)) throw Errors.invalid("The 13th-month accrual account (335) is not specified.", "Chưa khai tài khoản trích trước lương tháng 13 (335).");
			add(cfg.accrued13thAccount, "", accrual.neg(), label(lang, "accrual", { p }));
		}
		const lines = finalize(signed, { branch: batch.branch, interBranch: cfg.interBranch, defaultSub: cfg.payableSub, requireSub: cfg.requireSub });
		return { memo: label(lang, "header", { b: batch.batchNbr, p }), date: batch.date, branch: batch.branch, lines };
	}

	/** Bút toán đảo (4.6.3): mỗi dòng gốc đảo chiều, giữ tài khoản, tiểu khoản, chi nhánh, dự án, diễn giải. */
	function buildReversal(originalLines, batch, config) {
		const lang = (config && config.lang) || "en";
		if (!(originalLines || []).length) throw Errors.invalid("The original journal entry lines were not found.", "Không tìm thấy dòng bút toán gốc.");
		return {
			memo: label(lang, "reversal", { b: batch.batchNbr, p: batch.periodId }),
			lines: originalLines.map((l) => Object.assign({}, l, { debit: Money.num(l.credit), credit: Money.num(l.debit) })),
		};
	}

	/**
	 * Bút toán ghi sổ phiếu tạm ứng (4.6.4): Nợ 141 (gắn dự án) / Có tài khoản tiền.
	 * @param {{refNbr, employeeCode, amount, project, branch, date}} advance
	 * @param {{advanceAccount, advanceSub, cashAccount, lang}} config
	 */
	function buildAdvance(advance, config) {
		const cfg = config || {};
		if (D(advance.amount).lte(0)) throw Errors.invalid("The advance amount must be greater than zero.", "Số tiền tạm ứng phải lớn hơn 0.");
		if (blank(cfg.advanceAccount)) throw Errors.invalid("The advance account (141) is not specified.", "Chưa khai tài khoản tạm ứng (141).");
		if (blank(cfg.cashAccount)) throw Errors.invalid("The cash account is required.", "Phải chọn tài khoản tiền.");
		const memo = label(cfg.lang || "en", "payrollAdvance", { n: advance.employeeCode });
		const lines = finalize([
			{ account: cfg.advanceAccount, sub: cfg.advanceSub, amount: D(advance.amount), memo, project: advance.project || "", branch: advance.branch },
			{ account: cfg.cashAccount, sub: "", amount: D(advance.amount).neg(), memo, branch: advance.branch },
		], { branch: advance.branch, interBranch: true });
		return { memo, date: advance.date, branch: advance.branch, lines };
	}

	/**
	 * Bill nộp cơ quan thu (4.6.6): gom theo nhà cung cấp.
	 * @param {{batchNbr, periodId, pitTotal, insuranceTotals: Object<string, {employeeAmount, employerAmount}>}} batch
	 * @param {{components: Object<string, {name, liabilityAccount, vendor}>, pitVendor, pitPayableAccount, lang}} config
	 * @returns {{bills: Array<{vendor, refNo, memo, lines: Array<{account, amount, memo}>, total}>, skipped: Array<{code, name, amount}>}}
	 */
	function buildAgencyBills(batch, config) {
		const cfg = config || {};
		const lang = cfg.lang || "en";
		const byVendor = new Map();
		const skipped = [];
		const push = (vendor, line) => {
			const b = byVendor.get(String(vendor)) || { vendor, lines: [] };
			b.lines.push(line);
			byVendor.set(String(vendor), b);
		};
		for (const code of Object.keys(batch.insuranceTotals || {})) {
			const t = batch.insuranceTotals[code];
			const amount = D(t.employeeAmount).plus(D(t.employerAmount));
			if (amount.isZero()) continue;
			const c = (cfg.components || {})[norm(code)] || {};
			const name = c.name || code;
			if (blank(c.vendor)) {
				skipped.push({ code, name, amount: amount.toNumber() });
				continue;
			}
			push(c.vendor, { account: c.liabilityAccount, amount: amount.toNumber(), memo: name });
		}
		if (!D(batch.pitTotal).isZero()) {
			const name = label(lang, "pitBill", {});
			if (blank(cfg.pitVendor)) skipped.push({ code: "PIT", name, amount: D(batch.pitTotal).toNumber() });
			else push(cfg.pitVendor, { account: cfg.pitPayableAccount, amount: D(batch.pitTotal).toNumber(), memo: name });
		}
		const bills = [...byVendor.values()].map((b) => ({
			vendor: b.vendor, refNo: batch.batchNbr,
			memo: label(lang, "billMemo", { n: b.lines.map((l) => l.memo).join(", "), p: batch.periodId }).slice(0, 255),
			lines: b.lines, total: Money.sum(b.lines, (l) => l.amount).toNumber(),
		}));
		if (!bills.length) {
			throw Errors.invalid("There is nothing to bill: no contribution or tax has an agency vendor.", "Không có bill nào được tạo: các khoản trích và thuế chưa khai nhà cung cấp cơ quan thu.");
		}
		return { bills, skipped };
	}

	return { buildRelease, buildReversal, buildAdvance, buildAgencyBills, finalize, LABELS };
});
