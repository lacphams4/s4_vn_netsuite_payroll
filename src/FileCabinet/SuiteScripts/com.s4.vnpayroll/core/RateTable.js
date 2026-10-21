/**
 * Bảng đơn giá (VP102040, đặc tả mục 4.2.8): tìm đơn giá hạng mục theo ngày và dự án, thang % tại ngày, tính tiền thang.
 *
 * Dòng bảng: {itemCode, description, uom, rate, fromAmount, effectiveDate, expirationDate, project}.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates"], (Money, Dates) => {
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();

	function live(line, date) {
		return (!line.effectiveDate || Dates.cmp(line.effectiveDate, date) <= 0) && (!line.expirationDate || Dates.cmp(line.expirationDate, date) >= 0);
	}

	/**
	 * Đơn giá cho một hạng mục tại ngày phiếu: ứng viên cùng ItemCD, hiệu lực, dự án trống hoặc bằng dự án phiếu;
	 * ưu tiên dòng có dự án, rồi ngày hiệu lực mới nhất. Không có thì null (cảnh báo, người dùng tự nhập).
	 */
	function findRate(lines, itemCode, date, project) {
		const item = norm(itemCode);
		const proj = norm(project);
		let best = null;
		for (const l of lines || []) {
			if (norm(l.itemCode) !== item || !live(l, date)) continue;
			const lp = norm(l.project);
			if (lp && lp !== proj) continue;
			if (!best) {
				best = l;
				continue;
			}
			const bp = norm(best.project) ? 1 : 0;
			const cp = lp ? 1 : 0;
			if (cp > bp || (cp === bp && Dates.cmp(l.effectiveDate || "1900-01-01", best.effectiveDate || "1900-01-01") > 0)) best = l;
		}
		return best;
	}

	/** Thang % hiệu lực tại ngày: mỗi ngưỡng lấy dòng hiệu lực mới nhất, sắp tăng theo ngưỡng. */
	function tiersAt(lines, date) {
		const byFrom = new Map();
		for (const l of lines || []) {
			if (!live(l, date)) continue;
			const key = Money.D(l.fromAmount).toString();
			const cur = byFrom.get(key);
			if (!cur || Dates.cmp(l.effectiveDate || "1900-01-01", cur.effectiveDate || "1900-01-01") > 0) byFrom.set(key, l);
		}
		return [...byFrom.values()]
			.map((l) => ({ fromAmount: Money.D(l.fromAmount), percent: Money.D(l.rate) }))
			.sort((a, b) => a.fromAmount.comparedTo(b.fromAmount));
	}

	/**
	 * Tiền theo thang (TieredAmount): method P lũy tiến theo bậc, W toàn bộ theo bậc đạt. Trả về Decimal (chưa làm tròn).
	 * @param {*} q số lượng (doanh số)
	 * @param {Array<{fromAmount, percent}>} tiers sắp tăng
	 * @param {string} method 'P' | 'W'
	 */
	function tieredAmount(q, tiers, method) {
		const qty = Money.D(q);
		const list = (tiers || []).map((t) => ({ fromAmount: Money.D(t.fromAmount), percent: Money.D(t.percent) })).sort((a, b) => a.fromAmount.comparedTo(b.fromAmount));
		if (qty.lte(0) || !list.length) return Money.D(0);
		if (norm(method) === "W") {
			let hit = null;
			for (const t of list) if (t.fromAmount.lte(qty)) hit = t;
			return hit ? qty.times(hit.percent).div(100) : Money.D(0);
		}
		let total = Money.D(0);
		for (let i = 0; i < list.length; i++) {
			const from = list[i].fromAmount;
			if (qty.lte(from)) break;
			const to = i + 1 < list.length ? Money.min(qty, list[i + 1].fromAmount) : qty;
			total = total.plus(to.minus(from).times(list[i].percent).div(100));
		}
		return total;
	}

	return { findRate, tiersAt, tieredAmount };
});
