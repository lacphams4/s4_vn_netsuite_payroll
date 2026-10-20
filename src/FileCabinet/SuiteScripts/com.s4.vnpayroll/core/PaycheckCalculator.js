/**
 * Pipeline tính phiếu lương một nhân viên (PaycheckCalculator, đặc tả mục 2.5).
 *
 * Thứ tự cố định theo luật, không cấu hình: thu nhập -> miễn thuế -> BH -> thuế -> khấu trừ khác -> cấn trừ tạm ứng.
 * Tham số tra theo ngày cuối kỳ. Thực lĩnh trước cấn trừ dùng tổng thu nhập (không phải thu nhập chịu thuế) và trừ
 * toàn bộ BH NLĐ (gồm đoàn phí).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./Errors", "./InsuranceCalculator", "./PitCalculator", "./AdvanceOffsetCalculator"], (
	Money, Dates, Errors, InsuranceCalculator, PitCalculator, AdvanceOffsetCalculator
) => {
	const D = Money.D;

	/** Cảnh báo { code, message, messageVi }. */
	function warning(code, message, messageVi) {
		return { code, message, messageVi };
	}

	function absenceWarning(days) {
		const n = D(days).toString();
		return warning(
			Errors.Warnings.ABSENCE_NO_INSURANCE,
			`Absent ${n} working days in the month: no social, health or unemployment insurance; report a decrease.`,
			`Nghỉ ${n.replace(".", ",")} ngày làm việc trong tháng: không đóng BHXH, BHYT, BHTN; lập báo giảm.`
		);
	}

	function negativeNetWarning() {
		return warning(Errors.Warnings.NEGATIVE_NET_PAY, "The net pay is negative.", "Thực lĩnh âm.");
	}

	function carryForwardWarning(amount) {
		return warning(
			Errors.Warnings.ADVANCE_CARRY_FORWARD,
			`${InsuranceCalculator.fmt(amount, "en")} of advances remain unsettled and carry forward to the next period.`,
			`Còn ${InsuranceCalculator.fmt(amount, "vi")} tạm ứng chưa cấn trừ, chuyển sang kỳ sau.`
		);
	}

	/**
	 * @param {Object} input PaycheckInput
	 * @param {string} input.periodStart
	 * @param {string} input.periodEnd ngày tra tham số
	 * @param {Object} input.employee {employeeCd, pitMethod, hasFlatTaxCommitment, dependents: [{deductFrom, deductTo}],
	 *   insuranceApplicable (mặc định true), unemploymentApplicable (mặc định true), insuranceWage, region, isUnionMember}
	 * @param {Array} input.earnings [{code, amount, taxTreatment, taxExemptAmount, exemptCapParameter}]
	 * @param {number} [input.absenceWorkingDays]
	 * @param {Array} [input.otherDeductions] [{code, amount}] khấu trừ sau thuế
	 * @param {number} [input.otherTaxDeductions] giảm trừ khi tính thuế
	 * @param {Array} [input.openAdvances] [{refNbr, date, balance}]
	 * @param {number|null} [input.maxAdvanceOffset]
	 * @param {boolean} [input.offsetAdvances=true]
	 * @param {Object} [input.employerRateOverrides]
	 * @param {boolean} [input.unionFundApplicable=true]
	 * @param {Object} provider StatutoryParameterProvider
	 */
	function calculate(input, provider) {
		const emp = input.employee;
		if (!emp) throw Errors.invalid("The employee payroll profile is missing.", "Thiếu hồ sơ lương của nhân viên.");
		const periodStart = Dates.iso(input.periodStart);
		const periodEnd = Dates.iso(input.periodEnd);
		if (Dates.cmp(periodEnd, periodStart) < 0) {
			throw Errors.invalid("The pay period end date is earlier than the start date.", "Ngày cuối kỳ lương trước ngày đầu kỳ.");
		}
		const date = periodEnd;
		const warnings = [];

		// 1. Thu nhập và miễn thuế
		const earnings = input.earnings || [];
		const gross = Money.sum(earnings, (e) => e.amount);
		const exempt = D(PitCalculator.computeTaxExempt(earnings, provider, date));
		const taxable = Money.max(0, gross.minus(exempt));

		// 2. Bảo hiểm
		let insurance = InsuranceCalculator.empty();
		if (emp.insuranceApplicable !== false) {
			insurance = InsuranceCalculator.calculate({
				periodDate: date,
				insuranceWage: emp.insuranceWage,
				region: emp.region,
				absenceWorkingDays: input.absenceWorkingDays,
				isUnionMember: !!emp.isUnionMember,
				unemploymentApplicable: emp.unemploymentApplicable !== false,
				unionFundApplicable: input.unionFundApplicable !== false,
				employerRateOverrides: input.employerRateOverrides,
			}, provider);
			if (insurance.skippedForAbsence) warnings.push(absenceWarning(input.absenceWorkingDays));
		}

		// 3. Thuế TNCN
		const method = PitCalculator.normalizeMethod(emp.pitMethod);
		const dependentCount = method === "P" ? PitCalculator.activeDependentCount(emp.dependents, periodStart, periodEnd) : 0;
		const pit = PitCalculator.calculate({
			taxableIncome: taxable,
			employeeInsurance: insurance.employeeCompulsoryInsurance,
			dependentCount,
			otherDeductions: input.otherTaxDeductions,
			pitMethod: method,
			hasFlatTaxCommitment: !!emp.hasFlatTaxCommitment,
			date,
		}, provider);

		// 4. Khấu trừ khác, thực lĩnh trước cấn trừ
		const otherDeductions = Money.sum(input.otherDeductions || [], (x) => x.amount);
		const netBeforeAdvance = gross.minus(insurance.employeeTotal).minus(pit.tax).minus(otherDeductions);
		if (netBeforeAdvance.lt(0)) warnings.push(negativeNetWarning());

		// 5. Cấn trừ tạm ứng
		const advanceOffset = input.offsetAdvances === false
			? { lines: [], totalOffset: 0, remainingBalance: 0, hasCarryForward: false }
			: AdvanceOffsetCalculator.offset(netBeforeAdvance, input.openAdvances, input.maxAdvanceOffset);
		if (advanceOffset.hasCarryForward) warnings.push(carryForwardWarning(advanceOffset.remainingBalance));

		// 6. Thực lĩnh
		const netPay = netBeforeAdvance.minus(advanceOffset.totalOffset);
		return {
			periodStart, periodEnd,
			grossPay: gross.toNumber(),
			taxExemptIncome: exempt.toNumber(),
			taxableIncome: taxable.toNumber(),
			insurance,
			employeeInsurance: insurance.employeeTotal,
			employeeCompulsoryInsurance: insurance.employeeCompulsoryInsurance,
			employerInsurance: insurance.employerTotal,
			dependentCount,
			pit,
			otherDeductions: otherDeductions.toNumber(),
			netBeforeAdvance: netBeforeAdvance.toNumber(),
			advanceOffset,
			netPay: netPay.toNumber(),
			employerCost: gross.plus(insurance.employerTotal).toNumber(),
			warnings,
		};
	}

	return { calculate, warning, negativeNetWarning, carryForwardWarning, absenceWarning };
});
