/**
 * Gộp tháng tính thuế khi trả lương nhiều lần trong tháng (TaxMonthAggregator, đặc tả mục 2.7).
 *
 * Chỉ hiện thực lựa chọn L (khấu trừ BH, thuế ở kỳ cuối tháng), như code Acumatica. Kỳ giữa tháng chỉ trả thu nhập, trừ
 * khấu trừ khác, cấn trừ tạm ứng; kỳ cuối tính BH, thuế cho cả tháng trên thu nhập gộp các kỳ trước cùng tháng.
 * CTV, thu nhập vãng lai, không cư trú (không BH và phương pháp F hoặc N) xét theo từng lần chi.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./PaycheckCalculator", "./PitCalculator", "./AdvanceOffsetCalculator"], (
	Money, Dates, PaycheckCalculator, PitCalculator, AdvanceOffsetCalculator
) => {
	const D = Money.D;

	function isPerPayment(employee) {
		const m = PitCalculator.normalizeMethod(employee.pitMethod);
		return employee.insuranceApplicable === false && (m === "F" || m === "N");
	}

	/**
	 * @param {Object} args
	 * @param {Object} args.current PaycheckInput của kỳ hiện tại
	 * @param {boolean} args.isLastInTaxMonth
	 * @param {string} args.taxMonthStart ngày 1 của tháng tính thuế
	 * @param {string} args.taxMonthEnd ngày cuối tháng tính thuế
	 * @param {{earnings?: Array, absenceWorkingDays?: number, otherTaxDeductions?: number}} [args.prior] gộp các bảng lương trước
	 * @param {Object} provider
	 * @returns kết quả như PaycheckCalculator.calculate, thêm month (kết quả cả tháng, nếu có)
	 */
	function calculate(args, provider) {
		const current = args.current;
		const prior = args.prior || {};
		if (isPerPayment(current.employee)) return PaycheckCalculator.calculate(current, provider);

		const priorEarnings = prior.earnings || [];
		const hasPrior = priorEarnings.length > 0 || !D(prior.absenceWorkingDays).isZero();
		const fullMonth = Dates.cmp(current.periodStart, args.taxMonthStart) === 0 && Dates.cmp(current.periodEnd, args.taxMonthEnd) === 0;
		if (args.isLastInTaxMonth && !hasPrior && fullMonth) return PaycheckCalculator.calculate(current, provider);

		const periodOnly = PaycheckCalculator.calculate(Object.assign({}, current, {
			employee: Object.assign({}, current.employee, { pitMethod: "X", insuranceApplicable: false, unemploymentApplicable: false }),
			unionFundApplicable: false,
			otherTaxDeductions: 0,
		}), provider);
		if (!args.isLastInTaxMonth) return periodOnly;

		const month = PaycheckCalculator.calculate({
			periodStart: args.taxMonthStart,
			periodEnd: args.taxMonthEnd,
			employee: current.employee,
			earnings: priorEarnings.concat(current.earnings || []),
			absenceWorkingDays: D(prior.absenceWorkingDays).plus(D(current.absenceWorkingDays)).toNumber(),
			otherTaxDeductions: D(prior.otherTaxDeductions).plus(D(current.otherTaxDeductions)).toNumber(),
			employerRateOverrides: current.employerRateOverrides,
			unionFundApplicable: current.unionFundApplicable,
			otherDeductions: [],
			offsetAdvances: false,
		}, provider);

		const warnings = [];
		const seen = new Set();
		for (const w of month.warnings.concat(periodOnly.warnings)) {
			if (w.code === "AdvanceCarryForward" || w.code === "NegativeNetPay") continue; // tính lại bên dưới theo kỳ
			const k = w.code + "|" + w.message;
			if (!seen.has(k)) {
				seen.add(k);
				warnings.push(w);
			}
		}
		const netBeforeAdvance = D(periodOnly.grossPay).minus(month.employeeInsurance).minus(month.pit.tax).minus(periodOnly.otherDeductions);
		if (netBeforeAdvance.lt(0)) warnings.push(PaycheckCalculator.negativeNetWarning());
		const advanceOffset = current.offsetAdvances === false
			? { lines: [], totalOffset: 0, remainingBalance: 0, hasCarryForward: false }
			: AdvanceOffsetCalculator.offset(netBeforeAdvance, current.openAdvances, current.maxAdvanceOffset);
		if (advanceOffset.hasCarryForward) warnings.push(PaycheckCalculator.carryForwardWarning(advanceOffset.remainingBalance));
		const netPay = netBeforeAdvance.minus(advanceOffset.totalOffset);
		return {
			periodStart: Dates.iso(current.periodStart), periodEnd: Dates.iso(current.periodEnd),
			grossPay: periodOnly.grossPay,
			taxExemptIncome: periodOnly.taxExemptIncome,
			taxableIncome: periodOnly.taxableIncome,
			insurance: month.insurance,
			employeeInsurance: month.employeeInsurance,
			employeeCompulsoryInsurance: month.employeeCompulsoryInsurance,
			employerInsurance: month.employerInsurance,
			dependentCount: month.dependentCount,
			pit: month.pit,
			otherDeductions: periodOnly.otherDeductions,
			netBeforeAdvance: netBeforeAdvance.toNumber(),
			advanceOffset,
			netPay: netPay.toNumber(),
			employerCost: D(periodOnly.grossPay).plus(month.employerInsurance).toNumber(),
			warnings,
			month,
		};
	}

	return { calculate, isPerPayment };
});
