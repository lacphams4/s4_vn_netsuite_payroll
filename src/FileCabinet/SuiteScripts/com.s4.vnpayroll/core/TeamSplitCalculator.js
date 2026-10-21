/**
 * Chia tiền tổ cho thành viên (TeamSplitCalculator, đặc tả mục 4.3.2).
 *
 * Phần mỗi người làm tròn XUỐNG (floor, kể cả số âm), phần dư chia từng đồng theo phần lẻ giảm dần, bằng nhau thì
 * theo thứ tự danh sách, để tổng đúng bằng số tiền tổ. Khác cách dồn chênh lệch của phân bổ chi phí (4.5.5).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Errors"], (Money, Errors) => {
	const Methods = { WORK_DAYS: "D", WORK_DAYS_FACTOR: "F", HOURS: "H", FIXED_PERCENT: "P", EQUAL: "E" };

	function weightOf(m, method) {
		switch (method) {
			case "D":
				return Money.D(m.workDays);
			case "H":
				return Money.D(m.hours);
			case "P":
				return Money.D(m.fixedPercent);
			case "E":
				return Money.D(1);
			default: // F và mã lạ
				return Money.D(m.workDays).times(Money.D(m.splitFactor === null || m.splitFactor === undefined || m.splitFactor === "" ? 1 : m.splitFactor));
		}
	}

	/**
	 * @param {*} total số tiền tổ (đồng)
	 * @param {Array<{workDays, hours, splitFactor, fixedPercent}>} members
	 * @param {string} method D | F | H | P | E
	 * @returns {number[]} số tiền từng thành viên, cùng thứ tự
	 */
	function split(total, members, method) {
		const m = String(method || "F").trim().toUpperCase();
		const list = members || [];
		const weights = list.map((x) => weightOf(x, m));
		if (weights.some((w) => w.lt(0))) {
			throw Errors.invalid("Split weights cannot be negative.", "Trọng số chia không được âm.");
		}
		const S = Money.sum(weights);
		if (S.lte(0)) {
			throw Errors.invalid("The team has no work days, hours or percentages to split by.", "Tổ không có ngày công, giờ hoặc tỷ lệ để chia.");
		}
		if (m === "P" && !S.eq(100)) {
			throw Errors.invalid(`The fixed percentages must total 100% (now ${S.toString()}%).`, `Tổng tỷ lệ cố định phải bằng 100% (hiện ${S.toString()}%).`);
		}
		const T = Money.D(total);
		const raw = weights.map((w) => T.times(w).div(S));
		const amounts = raw.map((r) => r.floor());
		let remainder = T.minus(Money.sum(amounts));
		const order = raw.map((r, i) => ({ i, frac: r.minus(r.floor()) })).sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
		for (let k = 0; remainder.gte(1) && order.length; k = (k + 1) % order.length) {
			amounts[order[k].i] = amounts[order[k].i].plus(1);
			remainder = remainder.minus(1);
		}
		return amounts.map((a) => a.toNumber());
	}

	return { split, Methods };
});
