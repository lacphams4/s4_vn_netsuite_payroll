/**
 * Cầu biến động chi phí lương giữa hai kỳ và các phép tỷ lệ an toàn (docs/UI_V2.md mục 13).
 *
 * Cầu (bridge) từ kỳ so sánh (start) đến kỳ này (end):
 *   headcount = (số người kỳ này - số người kỳ trước) x chi phí bình quân một người kỳ trước. Số người và chi phí bình quân
 *               tính trên nhân viên (không tính cộng tác viên): bình quân = (tổng chi phí kỳ trước - contractor kỳ trước) / số
 *               người kỳ trước. Kỳ trước không có người thì bước này = 0.
 *   Phần còn lại chia theo thành phần. Với thành phần của nhân viên (wages, overtime, allowance, bonus, piecework, other,
 *   employerIns, accrued13): bước = (kỳ này - kỳ trước) - phần do thay đổi số người của thành phần đó
 *               = số người kỳ này x (bình quân một người kỳ này - bình quân một người kỳ trước), tức thay đổi MỨC bình quân.
 *   contractor = kỳ này - kỳ trước (không thuộc số người).
 * Làm tròn đến đồng; phần do thay đổi số người chia cho các thành phần theo tỷ trọng kỳ trước và dồn chênh lệch làm tròn vào
 * thành phần lớn nhất, nên tổng các bước = end - start tuyệt đối.
 *
 * Tỷ lệ trả về là phân số (0,153 = 15,3%), làm tròn 6 chữ số; mẫu số bằng 0 hoặc thiếu số liệu thì null.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money"], (Money) => {
	const D = Money.D;
	const EMPLOYEE_COMPONENTS = ["wages", "overtime", "allowance", "bonus", "piecework", "other", "employerIns", "accrued13"];
	const COMPONENTS = EMPLOYEE_COMPONENTS.concat(["contractor"]);

	const missing = (v) => v === null || v === undefined || v === "" || (typeof v === "number" && !isFinite(v));

	/** a / b; thiếu số hoặc b = 0 thì null. */
	function ratio(a, b) {
		if (missing(a) || missing(b)) return null;
		const d = D(b);
		if (d.isZero()) return null;
		return Money.roundTo(D(a).div(d), 6);
	}

	/** Thay đổi tương đối (cur - prev) / |prev|; prev = 0 hoặc thiếu số thì null. */
	function pct(cur, prev) {
		if (missing(cur) || missing(prev)) return null;
		const p = D(prev);
		if (p.isZero()) return null;
		return Money.roundTo(D(cur).minus(p).div(p.abs()), 6);
	}

	/** Tỷ trọng của một phần trong tổng; tổng = 0 thì null. */
	function share(part, total) {
		return ratio(part, total);
	}

	/** cur - prev; thiếu một trong hai thì null. */
	function diff(cur, prev) {
		if (missing(cur) || missing(prev)) return null;
		return D(cur).minus(D(prev)).toNumber();
	}

	/** Tổng các thành phần chi phí. */
	function total(components) {
		return Money.sum(COMPONENTS, (c) => (components || {})[c]).toNumber();
	}

	/**
	 * Cầu biến động.
	 * @param {{headcount: number, components: Object<string, number>}} prev kỳ so sánh
	 * @param {{headcount: number, components: Object<string, number>}} cur kỳ này
	 * @returns {Array<{key: string, amount: number}>} start, headcount, wages, overtime, allowance, bonus, piecework, other,
	 *   employerIns, accrued13, contractor, end; tổng các bước giữa = end - start
	 */
	function bridge(prev, cur) {
		const p = (prev && prev.components) || {};
		const c = (cur && cur.components) || {};
		const start = D(total(p));
		const end = D(total(c));
		const hcPrev = D((prev && prev.headcount) || 0);
		const hcCur = D((cur && cur.headcount) || 0);
		const dHc = hcCur.minus(hcPrev);

		// Phần do thay đổi số người của từng thành phần nhân viên: dHc x (thành phần kỳ trước / số người kỳ trước)
		const effect = {};
		let headcount = D(0);
		if (!hcPrev.isZero() && !dHc.isZero()) {
			const prevEmployee = Money.sum(EMPLOYEE_COMPONENTS, (k) => p[k]);
			headcount = D(Money.round(dHc.times(prevEmployee).div(hcPrev)));
			let sum = D(0);
			let top = null;
			for (const k of EMPLOYEE_COMPONENTS) {
				effect[k] = D(Money.round(dHc.times(D(p[k])).div(hcPrev)));
				sum = sum.plus(effect[k]);
				if (top === null || D(p[k]).abs().gt(D(p[top]).abs())) top = k;
			}
			effect[top] = effect[top].plus(headcount.minus(sum));
		}

		const out = [{ key: "start", amount: start.toNumber() }, { key: "headcount", amount: headcount.toNumber() }];
		for (const k of EMPLOYEE_COMPONENTS) out.push({ key: k, amount: D(c[k]).minus(D(p[k])).minus(effect[k] || D(0)).toNumber() });
		out.push({ key: "contractor", amount: D(c.contractor).minus(D(p.contractor)).toNumber() });
		out.push({ key: "end", amount: end.toNumber() });
		return out;
	}

	/** Kiểm cầu: tổng các bước (trừ start, end) = end - start. */
	function bridgeBalanced(steps) {
		const get = (k) => D(((steps || []).find((s) => s.key === k) || {}).amount);
		const mid = Money.sum((steps || []).filter((s) => s.key !== "start" && s.key !== "end"), (s) => s.amount);
		return mid.eq(get("end").minus(get("start")));
	}

	return { COMPONENTS, EMPLOYEE_COMPONENTS, ratio, pct, share, diff, total, bridge, bridgeBalanced };
});
