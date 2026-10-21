/**
 * Đối soát số dư phép với sổ giao dịch phép (QC lượt 2 #9): cấp phép năm ghi giao dịch rồi mới cập nhật số dư; nếu lần
 * chạy trước dừng giữa hai bước, lần chạy lại tính "đã cấp" từ giao dịch nên không cấp thêm và số dư bị thiếu mãi.
 * Đối soát đưa Entitled về tổng giao dịch cấp (A) và CarriedOver về tổng chuyển phép (C) + hết hạn (X) của năm,
 * trước khi tính phần cấp thêm. Các cột khác (Adjusted, Used, Pending) không đụng.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money"], (Money) => {
	/**
	 * @param {{entitled, carriedOver}} balance số dư năm (đã chuyển sang cấu trúc lõi)
	 * @param {Array<{source, qty}>} trans giao dịch của đúng nhân viên, loại nghỉ, năm đó
	 * @returns {{entitled: number, carriedOver: number, changed: boolean}}
	 */
	function reconcile(balance, trans) {
		const sum = (sources) => Money.sum((trans || []).filter((t) => sources.includes(t.source)), (t) => t.qty).toNumber();
		const entitled = sum(["A"]);
		const carriedOver = sum(["C", "X"]);
		const changed = !Money.D(balance.entitled || 0).eq(entitled) || !Money.D(balance.carriedOver || 0).eq(carriedOver);
		return { entitled, carriedOver, changed };
	}

	return { reconcile };
});
