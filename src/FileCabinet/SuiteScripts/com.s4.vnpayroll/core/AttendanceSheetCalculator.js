/**
 * Cộng công bảng công ký hiệu (đặc tả mục 3.2; VP311000 Attendance Sheet).
 *
 * Mỗi dòng là một nhân viên trong một kỳ, ô D01..D31 là ngày thứ n kể từ ngày đầu kỳ. Ký hiệu tra không phân biệt
 * hoa thường; ký hiệu lạ ghi vào unknownCodes (ngày, mã gốc đã trim) và bị bỏ qua; ô trống = không công.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money"], (Money) => {
	/**
	 * @param {Array<string|null>} cells ô ngày 1..31 (phần tử 0 là ngày 1)
	 * @param {Array<{code: string, category: "W"|"P"|"U"|"S"|"T"|"N", days: number|string}>} symbols
	 * @returns {{workedDays, paidLeaveDays, unpaidLeaveDays, socialInsuranceLeaveDays, businessTripDays, paidDays, unknownCodes: Array<{day, code}>}}
	 */
	function total(cells, symbols) {
		const map = new Map();
		for (const s of symbols || []) map.set(String(s.code).trim().toUpperCase(), s);
		const sums = { W: Money.D(0), P: Money.D(0), U: Money.D(0), S: Money.D(0), T: Money.D(0) };
		const unknownCodes = [];
		(cells || []).forEach((cell, i) => {
			const code = cell === null || cell === undefined ? "" : String(cell).trim();
			if (!code) return;
			const s = map.get(code.toUpperCase());
			if (!s) {
				unknownCodes.push({ day: i + 1, code });
				return;
			}
			if (sums[s.category] !== undefined) sums[s.category] = sums[s.category].plus(Money.D(s.days));
		});
		const paid = sums.W.plus(sums.P).plus(sums.T);
		return {
			workedDays: sums.W.toNumber(),
			paidLeaveDays: sums.P.toNumber(),
			unpaidLeaveDays: sums.U.toNumber(),
			socialInsuranceLeaveDays: sums.S.toNumber(),
			businessTripDays: sums.T.toNumber(),
			paidDays: paid.toNumber(),
			unknownCodes,
		};
	}

	/** Chuỗi cảnh báo ký hiệu lạ (tối đa 255 ký tự). */
	function warnings(unknownCodes) {
		if (!unknownCodes || !unknownCodes.length) return "";
		return ("Unknown codes: " + unknownCodes.map((u) => `D${String(u.day).padStart(2, "0")}=${u.code}`).join(", ")).slice(0, 255);
	}

	return { total, warnings };
});
