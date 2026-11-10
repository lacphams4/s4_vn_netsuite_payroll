/**
 * So sánh bảng lương kỳ này với kỳ trước (giao diện bản 2, màn Chạy lương - docs/UI_V2.md mục 9).
 *
 * pickPrevious(batch, batches, periods) -> bảng lương kỳ liền trước hoặc null
 *   "Kỳ trước" xác định theo NGÀY KẾT THÚC KỲ (không theo mã kỳ): trong các bảng lương cùng công ty con và cùng nhóm
 *   lương, đã tính, chưa đảo (status khác V), thuộc kỳ có ngày kết thúc nhỏ hơn kỳ này, lấy kỳ kết thúc muộn nhất. Một
 *   kỳ có nhiều bảng lương thì ưu tiên theo trạng thái R > A > P > C > còn lại, rồi id lớn hơn.
 *   batch: { id, subsidiary, paygroup, period }; batches: [{ id, subsidiary, paygroup, period, status, calculated }];
 *   periods: { <id>: { end } } hoặc mảng [{ id, end }].
 *
 * compareLines(current, previous, opt) -> { rows, leavers, summary }
 *   current, previous: dòng nhân viên [{ employee, <key>: số }] của hai bảng lương (previous rỗng / null = không có kỳ trước).
 *   opt: { key = "net" (chỉ tiêu xét ngưỡng), keys = ["gross","ee_ins","pit","net"] (các chỉ tiêu so sánh),
 *          threshold = 0.1 (tỷ lệ chênh tuyệt đối từ đó trở lên là "chênh lớn"; <= 0 hoặc null = không xét),
 *          minDiff = 0 (chênh tuyệt đối nhỏ hơn mức này thì không gắn cờ) }.
 *   rows: mỗi dòng kỳ này, đúng thứ tự current: { employee, kind: "new" | "both", current, previous, diff, pct, over,
 *          values: { <key>: { current, previous, diff, pct } } }.
 *          kind "new": kỳ trước không có nhân viên này (previous = null, diff = null, pct = null, over = false).
 *          pct = diff / |previous|, làm tròn 4 chữ số thập phân; previous = 0 thì pct = null (0 nếu cả hai bằng 0).
 *          over (chênh lớn): kind "both" và |pct| >= threshold, hoặc previous = 0 mà current khác 0; và |diff| >= minDiff.
 *          Không có kỳ trước (previous null): mọi dòng kind "both" với previous = null, diff = null, pct = null, over = false.
 *   leavers: nhân viên có ở kỳ trước mà kỳ này không còn: [{ employee, kind: "left", previous, values }].
 *   summary: { hasPrevious, count, prevCount, joiners, leavers, both, over, unchanged,
 *              totals: { <key>: { current, previous, diff, pct } } } - tổng toàn bảng (previous gồm cả người đã nghỉ).
 *
 * compareItems(current, previous, opt) -> [{ code, name, current, previous, diff, pct, kind: "new" | "gone" | "both" }]
 *   So các khoản (thu nhập, bảo hiểm...) của một nhân viên giữa hai kỳ, gộp theo mã. Mỗi phần tử { code, name, amount };
 *   opt: { codeOf, amountOf, nameOf } để đọc dạng dữ liệu khác. Thứ tự: các mã của kỳ này (theo lần xuất hiện đầu), rồi
 *   các mã chỉ có ở kỳ trước.
 *
 * Số tiền cộng trừ bằng Decimal (core/Money); kết quả là số JavaScript.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money"], (Money) => {
	const DEFAULT_KEYS = ["gross", "ee_ins", "pit", "net"];
	const STATUS_RANK = { R: 5, A: 4, P: 3, C: 2 };

	const blank = (v) => v === null || v === undefined || v === "";
	const D = (v) => {
		try {
			const d = Money.D(blank(v) ? 0 : v);
			return d.isFinite() ? d : Money.D(0);
		} catch (e) {
			return Money.D(0);
		}
	};
	const truthy = (v) => v === true || v === "T" || v === 1 || v === "1" || v === "true";

	/** { current, previous, diff, pct } của một cặp số; previous null = không có số kỳ trước. */
	function delta(current, previous) {
		const c = D(current);
		if (previous === null || previous === undefined) return { current: c.toNumber(), previous: null, diff: null, pct: null };
		const p = D(previous);
		const diff = c.minus(p);
		let pct = null;
		if (!p.isZero()) pct = Money.roundTo(diff.div(p.abs()), 4);
		else if (c.isZero()) pct = 0;
		return { current: c.toNumber(), previous: p.toNumber(), diff: diff.toNumber(), pct };
	}

	function options(opt) {
		const o = opt || {};
		const keys = Array.isArray(o.keys) && o.keys.length ? o.keys.slice() : DEFAULT_KEYS.slice();
		const key = o.key || (keys.indexOf("net") >= 0 ? "net" : keys[0]);
		if (keys.indexOf(key) < 0) keys.push(key);
		const threshold = blank(o.threshold) ? 0.1 : Number(o.threshold);
		const minDiff = Number(o.minDiff) > 0 ? Number(o.minDiff) : 0;
		return { keys, key, threshold: isFinite(threshold) && threshold > 0 ? threshold : null, minDiff };
	}

	function isOver(d, o) {
		if (o.threshold === null || d.previous === null || d.diff === null || d.diff === 0) return false;
		if (Math.abs(d.diff) < o.minDiff) return false;
		if (d.pct === null) return true;
		return Math.abs(d.pct) >= o.threshold;
	}

	function compareLines(current, previous, opt) {
		const o = options(opt);
		const cur = Array.isArray(current) ? current.filter(Boolean) : [];
		const hasPrevious = Array.isArray(previous);
		const prev = hasPrevious ? previous.filter(Boolean) : [];
		// Một nhân viên có thể có nhiều dòng ở kỳ trước (dữ liệu lạ): cộng dồn theo nhân viên
		const prevBy = {};
		const prevOrder = [];
		for (const l of prev) {
			const id = String(l.employee);
			if (!prevBy[id]) {
				prevBy[id] = {};
				for (const k of o.keys) prevBy[id][k] = Money.D(0);
				prevOrder.push(id);
			}
			for (const k of o.keys) prevBy[id][k] = prevBy[id][k].plus(D(l[k]));
		}
		const totalCur = {};
		const totalPrev = {};
		for (const k of o.keys) {
			totalCur[k] = Money.D(0);
			totalPrev[k] = Money.D(0);
		}
		const seen = {};
		let joiners = 0;
		let both = 0;
		let over = 0;
		let unchanged = 0;
		const rows = cur.map((l) => {
			const id = String(l.employee);
			seen[id] = true;
			const p = prevBy[id];
			const kind = hasPrevious && !p ? "new" : "both";
			const values = {};
			for (const k of o.keys) {
				values[k] = delta(l[k], p ? p[k] : null);
				totalCur[k] = totalCur[k].plus(D(l[k]));
			}
			const main = values[o.key];
			const flag = kind === "both" && isOver(main, o);
			if (kind === "new") joiners += 1;
			else if (hasPrevious) {
				both += 1;
				if (flag) over += 1;
				if (main.diff === 0) unchanged += 1;
			}
			return { employee: id, kind, current: main.current, previous: main.previous, diff: main.diff, pct: main.pct, over: flag, values };
		});
		const leavers = [];
		for (const id of prevOrder) {
			for (const k of o.keys) totalPrev[k] = totalPrev[k].plus(prevBy[id][k]);
			if (seen[id]) continue;
			const values = {};
			for (const k of o.keys) values[k] = { current: null, previous: prevBy[id][k].toNumber(), diff: null, pct: null };
			leavers.push({ employee: id, kind: "left", previous: values[o.key].previous, values });
		}
		const totals = {};
		for (const k of o.keys) totals[k] = delta(totalCur[k], hasPrevious ? totalPrev[k] : null);
		return {
			rows,
			leavers,
			summary: { hasPrevious, key: o.key, threshold: o.threshold, count: rows.length, prevCount: prevOrder.length, joiners, leavers: leavers.length, both, over, unchanged, totals },
		};
	}

	function pickPrevious(batch, batches, periods) {
		const b = batch || {};
		const endOf = (id) => {
			if (blank(id)) return "";
			const p = Array.isArray(periods) ? periods.find((x) => x && String(x.id) === String(id)) : (periods || {})[String(id)];
			return p && p.end ? String(p.end) : "";
		};
		const myEnd = endOf(b.period);
		if (!myEnd) return null;
		const same = (x, y) => String(blank(x) ? "" : x) === String(blank(y) ? "" : y);
		const list = (batches || []).filter((x) => {
			if (!x || same(x.id, b.id)) return false;
			if (!same(x.subsidiary, b.subsidiary) || !same(x.paygroup, b.paygroup)) return false;
			if (String(x.status || "").toUpperCase() === "V" || !truthy(x.calculated)) return false;
			const end = endOf(x.period);
			return !!end && end < myEnd;
		});
		if (!list.length) return null;
		const rank = (x) => STATUS_RANK[String(x.status || "").toUpperCase()] || 1;
		list.sort((x, y) => {
			const ex = endOf(x.period);
			const ey = endOf(y.period);
			if (ex !== ey) return ex < ey ? 1 : -1;
			if (rank(x) !== rank(y)) return rank(y) - rank(x);
			return Number(y.id) - Number(x.id);
		});
		return list[0];
	}

	function compareItems(current, previous, opt) {
		const o = opt || {};
		const codeOf = o.codeOf || ((x) => x.code);
		const amountOf = o.amountOf || ((x) => x.amount);
		const nameOf = o.nameOf || ((x) => x.name);
		const hasPrevious = Array.isArray(previous);
		const gather = (items) => {
			const by = {};
			const order = [];
			for (const x of Array.isArray(items) ? items.filter(Boolean) : []) {
				const code = String(blank(codeOf(x)) ? "" : codeOf(x)).trim().toUpperCase();
				if (!by[code]) {
					by[code] = { code, name: nameOf(x) || code, amount: Money.D(0) };
					order.push(code);
				}
				by[code].amount = by[code].amount.plus(D(amountOf(x)));
			}
			return { by, order };
		};
		const c = gather(current);
		const p = gather(previous);
		const out = c.order.map((code) => {
			const prev = p.by[code];
			const d = delta(c.by[code].amount, hasPrevious ? (prev ? prev.amount : 0) : null);
			return Object.assign({ code, name: c.by[code].name, kind: hasPrevious && !prev ? "new" : "both" }, d);
		});
		for (const code of p.order) {
			if (c.by[code]) continue;
			out.push(Object.assign({ code, name: p.by[code].name, kind: "gone" }, delta(0, p.by[code].amount)));
		}
		return out;
	}

	return { DEFAULT_KEYS, delta, compareLines, pickPrevious, compareItems };
});
