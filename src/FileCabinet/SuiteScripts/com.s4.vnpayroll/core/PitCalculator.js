/**
 * Thuế thu nhập cá nhân (PitCalculator, đặc tả mục 2.4).
 *
 * Phương pháp: P lũy tiến (mặc định, trống hoặc mã lạ cũng là P), F khấu trừ 10% mỗi lần chi, N không cư trú 20%,
 * X không khấu trừ. Thuế từng bậc không làm tròn; cộng các bậc rồi làm tròn một lần.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./Errors"], (Money, Dates, Errors) => {
	const D = Money.D;
	const METHODS = { P: "P", F: "F", N: "N", X: "X" };

	/** Mã phương pháp chuẩn hóa: trống hoặc giá trị lạ là lũy tiến (P). */
	function normalizeMethod(m) {
		const k = String(m === null || m === undefined ? "" : m).trim().toUpperCase();
		return METHODS[k] || "P";
	}

	/** Thuế lũy tiến trên thu nhập tính thuế với hệ số cận trên scale (1 tháng, 12 năm); trả Decimal chưa làm tròn và bảng bậc. */
	function progressive(assessable, brackets, scale) {
		let lower = D(0);
		let tax = D(0);
		const breakdown = [];
		for (const b of brackets) {
			if (assessable.lte(lower)) break;
			const upper = b.upperBound === null ? null : D(b.upperBound).times(scale);
			const top = upper === null ? assessable : Money.min(assessable, upper);
			const inBracket = top.minus(lower);
			const bracketTax = inBracket.times(b.rate);
			tax = tax.plus(bracketTax);
			breakdown.push({ level: b.level, rate: D(b.rate).toNumber(), income: inBracket.toNumber(), tax: bracketTax.toNumber() });
			if (upper === null) break;
			lower = upper;
		}
		return { tax, breakdown };
	}

	/**
	 * @param {Object} input
	 * @param {number|string} input.taxableIncome thu nhập chịu thuế (đã loại miễn thuế)
	 * @param {number|string} [input.employeeInsurance] BH bắt buộc NLĐ (không gồm đoàn phí)
	 * @param {number} [input.dependentCount]
	 * @param {number|string} [input.otherDeductions] giảm trừ khác (từ thiện, hưu trí tự nguyện), không âm
	 * @param {string} [input.pitMethod] P|F|N|X
	 * @param {boolean} [input.hasFlatTaxCommitment] cam kết 08/CK-TNCN
	 * @param {string} input.date ngày tính
	 * @returns {{method, selfDeduction, dependentDeduction, familyDeduction, assessableIncome, tax, breakdown}}
	 */
	function calculate(input, provider) {
		const date = Dates.iso(input.date);
		const method = normalizeMethod(input.pitMethod);
		const dependentCount = Number(input.dependentCount || 0);
		if (dependentCount < 0) throw Errors.invalid("The number of dependents cannot be negative.", "Số người phụ thuộc không được âm.");
		const other = D(input.otherDeductions);
		if (other.lt(0)) throw Errors.invalid("Other tax deductions cannot be negative.", "Giảm trừ khác không được âm.");
		const taxable = Money.max(0, input.taxableIncome);
		const result = { method, selfDeduction: 0, dependentDeduction: 0, familyDeduction: 0, assessableIncome: 0, tax: 0, breakdown: [] };

		if (method === "X") return result;
		if (method === "F") {
			const threshold = provider.getValue("PIT.FLAT_THRESHOLD", date);
			const rate = provider.getValue("PIT.FLAT_RATE", date);
			result.assessableIncome = taxable.toNumber();
			result.tax = input.hasFlatTaxCommitment || taxable.lt(threshold) ? 0 : Money.round(taxable.times(rate));
			return result;
		}
		if (method === "N") {
			result.assessableIncome = taxable.toNumber();
			result.tax = Money.round(taxable.times(provider.getValue("PIT.NONRESIDENT_RATE", date)));
			return result;
		}
		const self = provider.getValue("PIT.SELF_DEDUCTION", date);
		const perDep = provider.getValue("PIT.DEPENDENT_DEDUCTION", date);
		const dependents = perDep.times(dependentCount);
		const assessable = Money.max(0, D(input.taxableIncome).minus(D(input.employeeInsurance)).minus(self).minus(dependents).minus(other));
		const p = progressive(assessable, provider.getPitBrackets(date), 1);
		result.selfDeduction = self.toNumber();
		result.dependentDeduction = dependents.toNumber();
		result.familyDeduction = self.plus(dependents).toNumber();
		result.assessableIncome = assessable.toNumber();
		result.tax = Money.round(p.tax);
		result.breakdown = p.breakdown;
		return result;
	}

	/** Thuế quyết toán năm: biểu hiệu lực tại date, cận trên nhân 12, làm tròn một lần. */
	function calculateAnnualProgressive(annualAssessable, date, provider) {
		const p = progressive(Money.max(0, annualAssessable), provider.getPitBrackets(Dates.iso(date)), 12);
		return Money.round(p.tax);
	}

	/**
	 * Tổng thu nhập miễn thuế (mục 2.4.7) theo thứ tự dòng.
	 * @param {Array<{code, amount, taxTreatment, taxExemptAmount, exemptCapParameter}>} earnings
	 * @returns {number}
	 */
	function computeTaxExempt(earnings, provider, date) {
		const d = Dates.iso(date);
		const capUsed = {};
		let exempt = D(0);
		for (const e of earnings || []) {
			const amount = D(e.amount);
			const t = String(e.taxTreatment || "T").trim().toUpperCase();
			if (t === "E") {
				exempt = exempt.plus(amount);
			} else if (t === "P") {
				exempt = exempt.plus(Money.min(amount, Money.max(0, e.taxExemptAmount)));
			} else if (t === "C") {
				const capCode = String(e.exemptCapParameter || "PIT.MEAL_EXEMPT_CAP").trim().toUpperCase();
				const cap = provider.getValue(capCode, d);
				const used = capUsed[capCode] || D(0);
				const portion = Money.max(0, Money.min(amount, cap.minus(used)));
				capUsed[capCode] = used.plus(portion);
				exempt = exempt.plus(portion);
			}
		}
		return exempt.toNumber();
	}

	/** Số người phụ thuộc được giảm trừ trọn tháng: khoảng giảm trừ giao với [periodStart, periodEnd]. */
	function activeDependentCount(dependents, periodStart, periodEnd) {
		let n = 0;
		for (const dep of dependents || []) {
			if (!dep.deductFrom) continue;
			if (Dates.cmp(dep.deductFrom, periodEnd) <= 0 && (!dep.deductTo || Dates.cmp(dep.deductTo, periodStart) >= 0)) n++;
		}
		return n;
	}

	return { calculate, calculateAnnualProgressive, computeTaxExempt, activeDependentCount, normalizeMethod };
});
