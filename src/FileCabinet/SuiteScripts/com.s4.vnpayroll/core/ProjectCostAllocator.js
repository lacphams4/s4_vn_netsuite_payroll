/**
 * Chia số tiền theo trọng số và phân bổ cấu phần chi phí vào đích (ProjectCostAllocator, đặc tả mục 4.5.5).
 *
 * a_i = Round(total x w_i / S); chênh lệch dồn vào dòng trọng số lớn nhất (bằng nhau thì dòng đứng trước).
 * Đích: {project, task, costCode, branch, workCenter, sub, source (T/P/D/R/S), version, weight, hours}.
 * sub = phòng ban riêng của đích (tùy chọn): có thì dòng kết quả mang theo, không có thì dòng kết quả không có trường sub
 * (CostAllocationBuilder.resolveAccount điền phòng ban của nhân viên / mặc định).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Errors"], (Money, Errors) => {
	const D = Money.D;
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();

	/** @returns {number[]} */
	function split(total, weights) {
		const ws = (weights || []).map((w) => D(w));
		if (!ws.length) return [];
		if (ws.some((w) => w.lt(0))) throw Errors.invalid("Allocation weights cannot be negative.", "Trọng số phân bổ không được âm.");
		const T = D(total);
		const S = Money.sum(ws);
		if (S.isZero()) return ws.map((_, i) => (i === 0 ? T.toNumber() : 0));
		const a = ws.map((w) => Money.round(T.times(w).div(S)));
		const diff = T.minus(Money.sum(a));
		if (!diff.isZero()) {
			let k = 0;
			for (let i = 1; i < ws.length; i++) if (ws[i].gt(ws[k])) k = i;
			a[k] = D(a[k]).plus(diff).toNumber();
		}
		return a;
	}

	function targetKey(t) {
		return [t.project, t.task, t.costCode, t.branch, t.workCenter, t.source, t.version, t.sub].map(norm).join("|");
	}

	/** Gộp đích trùng khóa (dự án, task, cost code, chi nhánh, work center, nguồn, phiên bản, phòng ban riêng), cộng trọng số và giờ. */
	function merge(targets) {
		const map = new Map();
		for (const t of targets || []) {
			const k = targetKey(t);
			const cur = map.get(k);
			if (cur) {
				cur.weight = cur.weight.plus(D(t.weight));
				cur.hours = cur.hours.plus(D(t.hours));
			} else {
				map.set(k, Object.assign({}, t, { weight: D(t.weight), hours: D(t.hours) }));
			}
		}
		return [...map.values()];
	}

	function lines(targets, component, amount) {
		const S = Money.sum(targets, (t) => t.weight);
		const amounts = split(amount, targets.map((t) => t.weight));
		return targets.map((t, i) => {
			const line = {
				project: t.project || "", task: t.task || "", costCode: t.costCode || "", branch: t.branch || "", workCenter: t.workCenter || "",
				source: t.source || "", version: t.version === undefined ? null : t.version, component,
				hours: t.hours.toNumber(), weight: Money.roundTo(t.weight, 6), ratio: S.isZero() ? (i === 0 ? 1 : 0) : Money.roundTo(t.weight.div(S), 6), amount: amounts[i],
			};
			// Phòng ban riêng của đích: chỉ ghi khi có (đích không khai phòng ban giữ nguyên dạng dòng cũ)
			if (norm(t.sub) !== "") line.sub = t.sub;
			return line;
		});
	}

	/**
	 * Phân bổ từng cấu phần theo đích.
	 * @param {Array} targets đích
	 * @param {Array<{component: string, amount}>} components ví dụ [{component: 'GROSS', amount}, {component: 'ERINS', amount}]
	 */
	function allocate(targets, components) {
		const merged = merge(targets);
		if (!merged.length) throw Errors.invalid("There is no allocation target.", "Không có đích phân bổ.");
		const out = [];
		for (const c of components || []) out.push(...lines(merged, c.component, c.amount));
		return out;
	}

	/** Như allocate nhưng một cấu phần; số tiền 0 hoặc không có đích thì rỗng. */
	function allocateDirect(component, amount, targets) {
		const merged = merge(targets);
		if (D(amount).isZero() || !merged.length) return [];
		return lines(merged, component, amount);
	}

	return { split, merge, allocate, allocateDirect, targetKey };
});
