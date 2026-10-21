/**
 * Cấp phép năm theo chính sách (đặc tả mục 3.6; LeaveAccrualCalculator của S4.VP.Core, VP501000 Accrue Leave).
 *
 * Thâm niên: thêm SeniorityExtraDays mỗi SeniorityStepYears năm tròn tính đến 31/12 của năm cấp. Người mới chia theo
 * tháng (tháng vào làm được tính nếu vào trước ngày 16). Cấp theo tháng tính đến tháng của ngày chạy (tháng chạy
 * được tính nếu ngày chạy >= 15 hoặc là 31/12). Làm tròn theo RoundingUnit, nửa ra xa 0.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates"], (Money, Dates) => {
	const D = Money.D;

	/** Số năm tròn từ a đến b. */
	function fullYears(a, b) {
		let y = Dates.year(b) - Dates.year(a);
		if (Dates.month(b) < Dates.month(a) || (Dates.month(b) === Dates.month(a) && Dates.day(b) < Dates.day(a))) y--;
		return Math.max(0, y);
	}

	/**
	 * @param {Object} policy {annualDays, seniorityStepYears, seniorityExtraDays, accrualMethod "Y"|"M", prorateNewHire,
	 *   carryOverMaxDays, carryOverExpiryMonth, roundingUnit}
	 * @param {number} year năm cấp
	 * @param {string|null} seniorityDate ngày tính thâm niên (trống = 1/1 của năm)
	 * @param {string} asOf ngày chạy
	 * @param {number} prevRemaining số dư khả dụng năm trước (>= 0)
	 * @returns {{entitled: number, months: number, fullYearDays: number, carriedOver: number, carryOverExpiryDate: string|null}}
	 */
	function calculate(policy, year, seniorityDate, asOf, prevRemaining) {
		const p = policy || {};
		const jan1 = Dates.ymd(year, 1, 1);
		const dec31 = Dates.ymd(year, 12, 31);
		const sd = seniorityDate ? Dates.iso(seniorityDate) : jan1;
		const res = { entitled: 0, months: 0, fullYearDays: 0, carriedOver: 0, carryOverExpiryDate: null };
		const carryMax = Number(p.carryOverMaxDays) || 0;
		if (carryMax > 0 && Number(prevRemaining) > 0) {
			res.carriedOver = Money.min(prevRemaining, carryMax).toNumber();
			const em = Number(p.carryOverExpiryMonth) || 0;
			if (em >= 1 && em <= 12) res.carryOverExpiryDate = Dates.endOfMonth(Dates.ymd(year, em, 1));
		}
		if (Dates.cmp(sd, dec31) > 0) return res;
		const step = Number(p.seniorityStepYears) || 0;
		const fy = fullYears(sd, dec31);
		const extra = step > 0 && fy >= step ? Math.floor(fy / step) * (Number(p.seniorityExtraDays) || 0) : 0;
		const fullYearDays = D(p.annualDays).plus(extra);
		const monthly = p.accrualMethod === "M";
		const firstMonth = Dates.cmp(sd, jan1) <= 0 ? 1 : Dates.month(sd) + (Dates.day(sd) > 15 ? 1 : 0);
		let lastMonth = 12;
		if (monthly) {
			const upTo = Dates.min(asOf, dec31);
			if (Dates.year(upTo) < year) return Object.assign(res, { fullYearDays: fullYearDays.toNumber() });
			lastMonth = Dates.month(upTo) - (Dates.day(upTo) < 15 && upTo !== dec31 ? 1 : 0);
		}
		const months = Math.max(0, lastMonth - firstMonth + 1);
		let entitled = (Dates.cmp(sd, jan1) > 0 && p.prorateNewHire !== false) || monthly ? fullYearDays.times(months).div(12) : fullYearDays;
		const unit = D(p.roundingUnit === undefined || p.roundingUnit === null || p.roundingUnit === "" ? 0 : p.roundingUnit);
		if (unit.gt(0)) entitled = D(Money.round(entitled.div(unit))).times(unit);
		return Object.assign(res, { entitled: entitled.toNumber(), months, fullYearDays: fullYearDays.toNumber() });
	}

	/**
	 * Số ngày cần cấp thêm: Entitled - đã cấp; cấp theo năm mà đã cấp thì 0 (chạy lại không cấp trùng).
	 * @returns {number} delta (> 0 thì ghi giao dịch nguồn A)
	 */
	function accrualDelta(entitled, alreadyAccrued, accrualMethod) {
		if (accrualMethod !== "M" && Number(alreadyAccrued) > 0) return 0;
		return Math.max(0, D(entitled).minus(D(alreadyAccrued)).toNumber());
	}

	return { fullYears, calculate, accrualDelta };
});
