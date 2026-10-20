/**
 * Số thập phân chính xác và làm tròn tiền (tương đương Money.Round của S4.VP.Core).
 *
 * Mọi phép tính tiền, tỷ lệ, ngày công trong lõi đi qua Decimal (decimal.js), không dùng số thực của JavaScript.
 * Money.round: làm tròn đến đồng, nửa đơn vị ra xa số 0 (MidpointRounding.AwayFromZero): 0,5 -> 1; -0,5 -> -1.
 * Kết quả tiền trả ra ngoài lõi là số nguyên JavaScript (an toàn đến 9e15 đồng).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["../lib/decimal"], (DecimalBase) => {
	const Decimal = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_UP });

	/** Chuyển giá trị (số, chuỗi, Decimal, null) sang Decimal; null, rỗng thành 0. */
	function D(x) {
		if (x instanceof Decimal) return x;
		if (x === null || x === undefined || x === "") return new Decimal(0);
		if (typeof x === "number") return new Decimal(String(x));
		return new Decimal(x);
	}

	/** Làm tròn đến đồng, nửa ra xa số 0; trả về số nguyên JavaScript. */
	function round(x) {
		return D(x).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
	}

	/** Làm tròn đến n chữ số thập phân, nửa ra xa số 0; trả về số. */
	function roundTo(x, n) {
		return D(x).toDecimalPlaces(n, Decimal.ROUND_HALF_UP).toNumber();
	}

	/** Tổng các phần tử (hoặc giá trị lấy bởi fn) dưới dạng Decimal. */
	function sum(items, fn) {
		let s = new Decimal(0);
		for (const it of items || []) s = s.plus(D(fn ? fn(it) : it));
		return s;
	}

	function num(x) {
		return D(x).toNumber();
	}

	function max(a, b) {
		return Decimal.max(D(a), D(b));
	}

	function min(a, b) {
		return Decimal.min(D(a), D(b));
	}

	return { Decimal, D, round, roundTo, sum, num, max, min };
});
