/**
 * Cấn trừ tạm ứng (AdvanceOffsetCalculator, đặc tả mục 2.9).
 *
 * FIFO theo ngày rồi số phiếu (so sánh ordinal), không vượt thực lĩnh (không âm) và trần mỗi kỳ (nếu có), không vượt
 * số dư từng phiếu. Phiếu số dư 0 bị bỏ; phiếu đến lượt nhưng hết số khả dụng vẫn sinh dòng 0 (lớp ERP chỉ lưu > 0).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates"], (Money, Dates) => {
	const D = Money.D;

	/**
	 * @param {number|string} netBeforeOffset thực lĩnh trước cấn trừ
	 * @param {Array<{refNbr: string, date: string, balance: number|string}>} advances
	 * @param {number|string|null} [maxOffsetPerPeriod] null = không giới hạn
	 * @returns {{lines: Array<{refNbr, amount, remainingBalance}>, totalOffset: number, remainingBalance: number, hasCarryForward: boolean}}
	 */
	function offset(netBeforeOffset, advances, maxOffsetPerPeriod) {
		let available = Money.max(0, netBeforeOffset);
		if (maxOffsetPerPeriod !== null && maxOffsetPerPeriod !== undefined && maxOffsetPerPeriod !== "") {
			available = Money.min(available, Money.max(0, maxOffsetPerPeriod));
		}
		const list = (advances || [])
			.filter((a) => D(a.balance).gt(0))
			.slice()
			.sort((a, b) => Dates.cmp(a.date, b.date) || (String(a.refNbr) < String(b.refNbr) ? -1 : String(a.refNbr) > String(b.refNbr) ? 1 : 0));
		const lines = [];
		let total = D(0);
		let remaining = D(0);
		for (const a of list) {
			const bal = D(a.balance);
			const amount = Money.min(available, bal);
			available = available.minus(amount);
			lines.push({ refNbr: a.refNbr, amount: amount.toNumber(), remainingBalance: bal.minus(amount).toNumber() });
			total = total.plus(amount);
			remaining = remaining.plus(bal.minus(amount));
		}
		return { lines, totalOffset: total.toNumber(), remainingBalance: remaining.toNumber(), hasCarryForward: remaining.gt(0) };
	}

	return { offset };
});
