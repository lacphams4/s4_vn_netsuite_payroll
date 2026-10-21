/**
 * Phiếu sản lượng / nghiệm thu vào bảng lương (đặc tả mục 4.3.3 - 4.3.5).
 *
 * Phiếu: {refNbr, status (H/P/A/C), batchNbr, entryType (I cá nhân / T tổ), rateTable, rateTableType (W/O/P/S),
 *         project, branch, workCenter, lines: [{employee, itemCode, qty, rate, amount}], members: [{employee, amount}]}.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money"], (Money) => {
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();

	/** Phiếu dùng được khi tính bảng lương: Approved, hoặc Included in Payroll của chính bảng lương đang tính. */
	function isUsable(entry, batchNbr) {
		const st = norm(entry.status);
		return st === "A" || (st === "C" && !!batchNbr && norm(entry.batchNbr) === norm(batchNbr));
	}

	/** Thành tiền dòng sản lượng = Round(Qty x Rate). */
	function lineAmount(qty, rate) {
		return Money.round(Money.D(qty).times(Money.D(rate)));
	}

	/** Phần của từng nhân viên trên một phiếu: [{employee, amount}] (Decimal). */
	function sharesOf(entry) {
		const out = new Map();
		if (norm(entry.entryType) === "T") {
			for (const m of entry.members || []) out.set(String(m.employee), (out.get(String(m.employee)) || Money.D(0)).plus(Money.D(m.amount)));
		} else {
			for (const l of entry.lines || []) {
				if (l.employee === null || l.employee === undefined || l.employee === "") continue;
				out.set(String(l.employee), (out.get(String(l.employee)) || Money.D(0)).plus(Money.D(l.amount)));
			}
		}
		return [...out.entries()].map(([employee, amount]) => ({ employee, amount }));
	}

	/**
	 * Gom phiếu của kỳ theo nhân viên.
	 * @returns {{outputAmounts: Object<string, Object<string, Decimal>>, salesAmounts: Object<string, Decimal>,
	 *            shares: Object<string, Array<{refNbr, rateTable, isSales, project, branch, workCenter, amount}>>}}
	 */
	function collect(entries, options) {
		const batchNbr = options && options.batchNbr;
		const outputAmounts = {};
		const salesAmounts = {};
		const shares = {};
		for (const e of entries || []) {
			if (options && options.skipStatusFilter ? false : !isUsable(e, batchNbr)) continue;
			const rt = norm(e.rateTable);
			const isSales = norm(e.entryType) !== "T" && norm(e.rateTableType) === "S";
			for (const s of sharesOf(e)) {
				const byTable = (outputAmounts[s.employee] = outputAmounts[s.employee] || {});
				byTable[rt] = (byTable[rt] || Money.D(0)).plus(s.amount);
				if (isSales) salesAmounts[s.employee] = (salesAmounts[s.employee] || Money.D(0)).plus(s.amount);
				(shares[s.employee] = shares[s.employee] || []).push({
					refNbr: e.refNbr, rateTable: rt, isSales, project: e.project || "", branch: e.branch || "", workCenter: e.workCenter || "", amount: s.amount,
				});
			}
		}
		return { outputAmounts, salesAmounts, shares };
	}

	/** Kiểm tra khi Submit / Approve (4.3.3); trả danh sách lỗi (chuỗi tiếng Việt). */
	function validate(entry) {
		const errors = [];
		const lines = entry.lines || [];
		if (!lines.some((l) => !Money.D(l.amount).isZero())) errors.push("Phiếu phải có ít nhất một dòng có thành tiền khác 0.");
		if (norm(entry.entryType) === "T") {
			const members = entry.members || [];
			if (!members.length) errors.push("Phiếu tổ phải có thành viên.");
			const seen = new Set();
			for (const m of members) {
				if (seen.has(String(m.employee))) errors.push(`Nhân viên ${m.employee} bị trùng trên phiếu.`);
				seen.add(String(m.employee));
			}
			const total = Money.sum(lines, (l) => l.amount);
			const split = Money.sum(members, (m) => m.amount);
			if (!total.eq(split)) errors.push(`Tổng tiền thành viên ${split.toString()} khác thành tiền phiếu ${total.toString()}.`);
		} else if (lines.some((l) => l.employee === null || l.employee === undefined || l.employee === "")) {
			errors.push("Phiếu cá nhân: mọi dòng phải có nhân viên.");
		}
		return errors;
	}

	return { isUsable, lineAmount, sharesOf, collect, validate };
});
