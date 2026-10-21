/**
 * Quy tắc phiếu sản lượng / nghiệm thu (đặc tả 4.2.8, 4.3.1 - 4.3.4), phần thuần dùng chung cho api/Output và test:
 * định giá dòng theo bảng đơn giá, thành viên tổ hiệu lực tại ngày, chia tiền tổ, tổng phiếu.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./RateTable", "./TeamSplitCalculator"], (Money, Dates, RateTable, TeamSplit) => {
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const blank = (v) => v === null || v === undefined || v === "";

	/**
	 * Định giá một dòng sản lượng.
	 * Bảng loại S (doanh số): Rate = 1 (số lượng chính là doanh số), ItemCD "TIER" nếu trống.
	 * Đơn giá trống thì tra bảng theo ngày phiếu và dự án; đơn giá nhập tay chỉ giữ khi bảng cho sửa (hoặc bảng S).
	 * @param {{item, qty, rate}} line
	 * @param {{type, allowOverride, lines: Array<{itemCode, rate, effectiveDate, expirationDate, project}>}} table
	 * @returns {{item, rate, amount, warning: (null|{code, message, messageVi})}}
	 */
	function priceLine(line, table, date, project) {
		const t = table || { type: "", allowOverride: false, lines: [] };
		const type = norm(t.type);
		const item = type === "S" && blank(line.item) ? "TIER" : line.item || "";
		let rate;
		let warning = null;
		if (type === "S") rate = Money.D(1);
		else {
			const hit = RateTable.findRate(t.lines || [], item, date, project);
			if (!blank(line.rate) && (t.allowOverride || !hit)) rate = Money.D(line.rate);
			else if (hit) rate = Money.D(hit.rate);
			else {
				rate = Money.D(0);
				warning = { code: "RATE_MISSING", message: `No rate for item ${item} on ${Dates.vn(date)}; enter the rate.`, messageVi: `Chưa có đơn giá cho hạng mục ${item} ngày ${Dates.vn(date)}; nhập đơn giá.` };
			}
		}
		if (Money.D(line.qty || 0).lt(0) || rate.lt(0)) throw new Error("Quantity and rate cannot be negative / Số lượng, đơn giá không được âm");
		return { item, rate: rate.toNumber(), amount: Money.round(Money.D(line.qty || 0).times(rate)), warning };
	}

	/** Thành viên tổ tại ngày D: dòng hiệu lực; một nhân viên nhiều dòng thì lấy dòng hiệu lực mới nhất; giữ thứ tự dòng. */
	function membersAt(members, date) {
		const best = new Map();
		(members || []).forEach((m, i) => {
			if (!Dates.within(date, m.effectiveDate || null, m.expirationDate || null)) return;
			const cur = best.get(String(m.employee));
			if (!cur || Dates.cmp(m.effectiveDate || "1900-01-01", cur.m.effectiveDate || "1900-01-01") > 0) best.set(String(m.employee), { m, i });
		});
		return [...best.values()].sort((a, b) => a.i - b.i).map((x) => x.m);
	}

	/** Chia tiền tổ (TeamSplitCalculator), trả số tiền theo thứ tự thành viên. */
	function split(total, members, method) {
		return TeamSplit.split(total, members.map((m) => ({ workDays: m.workDays || 0, hours: m.hours || 0, splitFactor: blank(m.splitFactor) ? 1 : m.splitFactor, fixedPercent: m.fixedPercent || 0 })), method || "F");
	}

	/** Tổng phiếu: total = tổng thành tiền dòng, splitTotal = tổng tiền thành viên. */
	function totals(lines, members) {
		return { total: Money.sum(lines, (l) => l.amount).toNumber(), splitTotal: Money.sum(members, (m) => m.amount).toNumber() };
	}

	/** Chuyển trạng thái phiếu (4.3.3): submit H->P, approve P->A, hold P/A->H. */
	function nextStatus(status, action) {
		const st = norm(status || "H");
		if (action === "submit") return st === "H" ? "P" : null;
		if (action === "approve") return st === "P" ? "A" : null;
		if (action === "hold") return st === "P" || st === "A" ? "H" : null;
		return null;
	}

	return { priceLine, membersAt, split, totals, nextStatus };
});
