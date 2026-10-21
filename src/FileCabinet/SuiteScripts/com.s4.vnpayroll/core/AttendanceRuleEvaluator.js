/**
 * Quy đổi phút đi trễ / về sớm ra ngày công bị trừ (đặc tả mục 3.1; AttendanceRuleEvaluator của S4.VP.Core).
 *
 * Mỗi phiếu ngoại lệ quy đổi riêng (không cộng phút rồi mới quy đổi). Đây là trả lương theo thời gian làm việc thực
 * tế, không phải phạt tiền (Điều 127 BLLĐ 2019); mọi phiếu phải được duyệt.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money"], (Money) => {
	/**
	 * @param {number} minutes số phút trễ / sớm
	 * @param {Array<{minutesFrom: number, minutesTo: number|null, deductDays: number|string}>} rules
	 * @returns {number} số ngày bị trừ
	 */
	function deductDays(minutes, rules) {
		const m = Number(minutes) || 0;
		if (m <= 0) return 0;
		let best = null;
		for (const r of rules || []) {
			const from = Number(r.minutesFrom);
			const to = r.minutesTo === null || r.minutesTo === undefined || r.minutesTo === "" ? null : Number(r.minutesTo);
			if (m >= from && (to === null || m <= to) && (!best || from > Number(best.minutesFrom))) best = r;
		}
		return best ? Money.num(best.deductDays) : 0;
	}

	return { deductDays };
});
