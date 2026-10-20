/**
 * Làm thêm giờ và làm đêm (OvertimeCalculator, OvertimeLimitChecker, đặc tả mục 2.6).
 *
 * Hệ số tra theo ngày cuối kỳ. Amount = Round(lương giờ x giờ x hệ số), BaseAmount = Round(lương giờ x giờ), phần miễn
 * thuế = hiệu hai số đã làm tròn. Giới hạn giờ OT chỉ cảnh báo, đúng bằng giới hạn là hợp lệ.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./Errors"], (Money, Dates, Errors) => {
	const D = Money.D;

	/**
	 * Hệ số của một đoạn giờ (WorkSegment).
	 * @param {{dayType: 'N'|'W'|'H', isOvertime: boolean, isNight: boolean, hadDaytimeOvertime?: boolean}} seg
	 * @returns {Decimal}
	 */
	function multiplierOf(seg, provider, date) {
		const d = Dates.iso(date);
		const night = provider.getValue("OT.NIGHT_PREMIUM", d);
		if (!seg.isOvertime) return seg.isNight ? D(1).plus(night) : D(1);
		const dayType = String(seg.dayType || "N").toUpperCase();
		const ot = provider.getValue(dayType === "H" ? "OT.HOLIDAY" : dayType === "W" ? "OT.WEEKLY_OFF" : "OT.NORMAL_DAY", d);
		if (!seg.isNight) return ot;
		const dayBase = dayType === "N" ? (seg.hadDaytimeOvertime ? ot : D(1)) : ot;
		return ot.plus(night).plus(provider.getValue("OT.NIGHT_EXTRA", d).times(dayBase));
	}

	function multiplier(seg, provider, date) {
		return multiplierOf(seg, provider, date).toNumber();
	}

	/**
	 * @param {{hourlyRate: number|string|Decimal, hours: number|string, segment: Object}} input
	 * @returns {{multiplier: number, amount: number, baseAmount: number, taxExemptAmount: number}}
	 */
	function calculate(input, provider, date) {
		const rate = D(input.hourlyRate);
		const hours = D(input.hours);
		if (rate.lt(0) || hours.lt(0)) throw Errors.invalid("The hourly rate and hours cannot be negative.", "Đơn giá giờ và số giờ không được âm.");
		const m = multiplierOf(input.segment || {}, provider, date);
		const amount = Money.round(rate.times(hours).times(m));
		const baseAmount = Money.round(rate.times(hours));
		return { multiplier: m.toNumber(), amount, baseAmount, taxExemptAmount: amount - baseAmount };
	}

	/**
	 * Giới hạn giờ OT (2.6.3).
	 * @param {{monthToDate?: number, yearToDate?: number, newHours: number, extendedSector?: boolean}} input
	 * @returns {{monthLimit, yearLimit, monthExceeded: boolean, yearExceeded: boolean}}
	 */
	function checkLimits(input, provider, date) {
		const d = Dates.iso(date);
		const monthLimit = provider.getValue("OT.LIMIT_MONTH", d);
		const yearLimit = provider.getValue(input.extendedSector ? "OT.LIMIT_YEAR_EXTENDED" : "OT.LIMIT_YEAR", d);
		const add = D(input.newHours);
		return {
			monthLimit: monthLimit.toNumber(),
			yearLimit: yearLimit.toNumber(),
			monthExceeded: D(input.monthToDate).plus(add).gt(monthLimit),
			yearExceeded: D(input.yearToDate).plus(add).gt(yearLimit),
		};
	}

	return { multiplier, multiplierOf, calculate, checkLimits };
});
