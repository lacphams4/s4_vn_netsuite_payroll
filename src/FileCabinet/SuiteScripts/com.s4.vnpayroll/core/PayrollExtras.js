/**
 * Phép tính phụ trợ của phiếu lương: đơn giá giờ, đơn giá ngày theo loại lương (đặc tả 2.5.3 bước 6), trích trước lương
 * tháng 13 (2.10.1, 4.6.5), tiền phép năm chưa nghỉ khi chấm dứt hợp đồng (2.10.2), lương theo ngày công.
 *
 * Đơn giá giờ, đơn giá ngày không làm tròn (giữ thương số); số tiền làm tròn một lần ở cuối.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Errors"], (Money, Errors) => {
	const D = Money.D;

	function salaryTypeOf(t) {
		const k = String(t || "M").trim().toUpperCase();
		return k === "D" || k === "H" ? k : "M";
	}

	function requireStandardDays(standardDays) {
		if (D(standardDays).lte(0)) {
			throw Errors.invalid(
				"Standard work days are not specified for the pay period or pay group.",
				"Chưa khai ngày công chuẩn cho kỳ lương hoặc nhóm lương."
			);
		}
	}

	/**
	 * Đơn giá giờ (Decimal, không làm tròn): M = lương / (chuẩn x giờ/ngày); D = lương / giờ/ngày; H = lương.
	 * @param {{salaryType: string, baseSalary, standardDays, hoursPerDay}} x
	 */
	function hourlyRate(x) {
		const hpd = D(x.hoursPerDay || 8);
		const base = D(x.baseSalary);
		const t = salaryTypeOf(x.salaryType);
		if (t === "H") return base;
		if (t === "D") return base.div(hpd);
		requireStandardDays(x.standardDays);
		return base.div(D(x.standardDays).times(hpd));
	}

	/** Đơn giá ngày (Decimal): D = lương; H = lương x giờ/ngày; M = lương / ngày công chuẩn. */
	function dailyRate(x) {
		const base = D(x.baseSalary);
		const t = salaryTypeOf(x.salaryType);
		if (t === "D") return base;
		if (t === "H") return base.times(D(x.hoursPerDay || 8));
		requireStandardDays(x.standardDays);
		return base.div(D(x.standardDays));
	}

	/**
	 * Tiền phép còn lại khi nghỉ việc.
	 * @param {{remainingDays, dailyRate}} x
	 * @returns {{quantity: number, rate: number, multiplier: number, amount: number}}
	 */
	function leavePayout(x) {
		const remaining = D(x.remainingDays);
		const rate = D(x.dailyRate);
		const amount = remaining.lte(0) || rate.lte(0) ? 0 : Money.round(remaining.times(rate));
		return { quantity: remaining.toNumber(), rate: rate.toNumber(), multiplier: 1, amount };
	}

	/**
	 * Trích trước lương tháng 13.
	 * @param {{accrue13th: boolean, isContractor: boolean, salaryType: string, baseSalary, packageMonthly, basis: 'P'|'C', months}} x
	 * @returns {number}
	 */
	function accrued13th(x) {
		if (!x.accrue13th || x.isContractor) return 0;
		const base = (salaryTypeOf(x.salaryType) === "M" ? D(x.baseSalary) : D(0))
			.plus(String(x.basis || "P").toUpperCase() === "C" ? D(0) : D(x.packageMonthly));
		const months = Number(x.months) > 0 ? D(x.months) : D(12);
		return Money.round(base.div(months));
	}

	/** Số tiền chia theo ngày công, làm tròn một lần: Round(unit x qty x multiplier / standardDays). */
	function prorate(unit, quantity, standardDays, multiplier) {
		requireStandardDays(standardDays);
		return Money.round(D(unit).times(D(quantity)).times(D(multiplier === undefined ? 1 : multiplier)).div(D(standardDays)));
	}

	return { hourlyRate, dailyRate, leavePayout, accrued13th, prorate, salaryTypeOf };
});
