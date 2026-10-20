/**
 * Đọc số tiền bằng chữ tiếng Việt (đặc tả mục 4.7.6), dùng cho thực lĩnh trên phiếu lương và tổng thực lĩnh bảng lương.
 *
 * Quy tắc: "linh" khi hàng chục 0 và có chữ trước; "mốt" (chục >= 2), "lăm" (chục >= 1); "bốn" không dùng "tư";
 * từ 1 tỷ trở lên đọc đệ quy phần tỷ. Viết hoa chữ cái đầu.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money"], (Money) => {
	const DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
	const BILLION = 1000000000;

	function readGroup(g, hasHigher) {
		const t = Math.floor(g / 100);
		const c = Math.floor(g / 10) % 10;
		const d = g % 10;
		const words = [];
		if (t > 0 || hasHigher) words.push(DIGITS[t] + " trăm");
		if (c === 0) {
			if (d > 0 && words.length > 0) words.push("linh");
		} else if (c === 1) {
			words.push("mười");
		} else {
			words.push(DIGITS[c] + " mươi");
		}
		if (d > 0) {
			if (d === 1 && c >= 2) words.push("mốt");
			else if (d === 5 && c >= 1) words.push("lăm");
			else words.push(DIGITS[d]);
		}
		return words.join(" ");
	}

	function readBelowBillion(n, hasHigher) {
		const groups = [[Math.floor(n / 1000000), "triệu"], [Math.floor(n / 1000) % 1000, "nghìn"], [n % 1000, ""]];
		const parts = [];
		let started = hasHigher;
		for (const [g, unit] of groups) {
			if (g === 0) continue;
			parts.push(readGroup(g, started) + (unit ? " " + unit : ""));
			started = true;
		}
		return parts.join(" ");
	}

	/** Đọc số nguyên (bỏ phần lẻ). */
	function read(x) {
		let n = Math.trunc(Number(x));
		if (n === 0) return "không";
		if (n < 0) return "âm " + read(-n);
		if (n >= BILLION) {
			const high = Math.floor(n / BILLION);
			const rest = n % BILLION;
			return read(high) + " tỷ" + (rest === 0 ? "" : " " + readBelowBillion(rest, true));
		}
		return readBelowBillion(n, false);
	}

	/** Số tiền bằng chữ, làm tròn đến đồng, viết hoa chữ cái đầu: "Mười lăm đồng". */
	function readAmount(x, unit) {
		const s = read(Money.round(x)) + " " + (unit === undefined ? "đồng" : unit);
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	return { read, readAmount };
});
