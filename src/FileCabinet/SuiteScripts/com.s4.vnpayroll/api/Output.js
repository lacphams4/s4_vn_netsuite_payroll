/**
 * Phiếu sản lượng / nghiệm thu (VP308000), bảng đơn giá, tổ (đặc tả 4.2.8, 4.3): lập phiếu, nạp thành viên tổ, chia tiền,
 * gửi duyệt / duyệt / tạm giữ, dữ liệu cho bảng lương (quy tắc nguồn O, S và phân bổ "nguồn nào đích đó"), khóa phiếu
 * khi bảng lương ghi sổ và mở lại khi đảo.
 *
 * Phiếu thuộc kỳ, không thuộc nhóm lương (4.3.4): ghi sổ bảng lương đầu tiên của kỳ khóa mọi phiếu đã duyệt của kỳ.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Settings", "./Clock", "../core/Dates", "../core/Money", "../core/OutputRules", "../core/OutputEntries"], (runtime, Store, Settings, Clock, Dates, Money, Rules, Entries) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function currentEmployee() {
		const u = runtime.getCurrentUser();
		return u && u.id > 0 ? String(u.id) : null;
	}

	// ------------------------------------------------------------------ dữ liệu tham chiếu

	function rateTable(id) {
		const t = Store.get("rate_table", id);
		if (!t) throw fail("Rate table not found", "Không tìm thấy bảng đơn giá");
		const lines = Store.find("rate_line", { where: "{table} = ?", params: [id] }).map((l) => ({
			itemCode: l.item, description: l.description, uom: l.uom, rate: l.rate || 0, fromAmount: l.from_amount || 0, effectiveDate: l.effective, expirationDate: l.expiration, project: l.project || "",
		}));
		return { id: t.id, code: String(t.name).trim().toUpperCase(), type: t.type || "W", allowOverride: !!t.allow_override, lines };
	}

	/** Kỳ của nhóm DEFAULT chứa ngày phiếu. */
	function defaultPeriod(date) {
		const g = Settings.paygroupByName("DEFAULT");
		if (!g) return null;
		const p = Store.find("period", { where: "{paygroup} = ?", params: [g.id], includeInactive: true }).find((x) => Dates.within(date, x.start, x.end));
		return p ? p.id : null;
	}

	function entryOf(id) {
		const e = Store.get("output", id);
		if (!e) throw fail("Output entry not found", "Không tìm thấy phiếu sản lượng");
		return e;
	}

	function linesOf(id) {
		return Store.find("output_line", { where: "{entry} = ?", params: [id] });
	}

	function membersOf(id) {
		return Store.find("output_member", { where: "{entry} = ?", params: [id] });
	}

	function assertHold(e) {
		if ((e.status || "H") !== "H") throw fail("Only on-hold entries can be changed", "Chỉ sửa được phiếu đang tạm giữ");
	}

	// ------------------------------------------------------------------ lập, sửa phiếu

	/**
	 * Tạo / sửa phiếu ở trạng thái Tạm giữ. lines / members (nếu truyền) thay toàn bộ dòng cũ.
	 * @param {object} values trường phiếu (id để sửa)
	 * @param {Array<{employee, item, description, uom, qty, rate}>} [lines]
	 * @param {Array<{employee, work_days, hours, factor, percent, amount, manual}>} [members]
	 * @returns {{id, warnings}}
	 */
	function save(values, lines, members) {
		const v = Object.assign({}, values);
		const id = v.id;
		delete v.id;
		const cur = id ? entryOf(id) : null;
		if (cur) assertHold(cur);
		const e = Object.assign({}, cur || {}, v);
		if (blank(e.doc_date)) throw fail("Document date is required", "Chưa nhập ngày phiếu");
		if (blank(e.rate_table)) throw fail("Rate table is required", "Chưa chọn bảng đơn giá");
		if (blank(e.type)) e.type = blank(e.team) ? "I" : "T";
		if (blank(e.period)) e.period = defaultPeriod(e.doc_date);
		// Chọn tổ: nhận cách chia, dự án, chi nhánh, work center của tổ khi phiếu đang trống
		if (!blank(e.team)) {
			const t = Store.get("team", e.team);
			if (t) {
				if (blank(e.split_method)) e.split_method = t.split_method || "F";
				for (const [k, tk] of [["project", "project"], ["location", "location"], ["work_center", "work_center"]]) if (blank(e[k]) && !blank(t[tk])) e[k] = t[tk];
			}
		}
		const table = rateTable(e.rate_table);
		const warnings = [];
		const header = {
			subsidiary: e.subsidiary, doc_date: e.doc_date, period: e.period || null, type: e.type, rate_table: e.rate_table, team: e.team || null, split_method: e.split_method || null,
			project: e.project || null, location: e.location || null, work_center: e.work_center || null, description: e.description || "",
		};
		const entryId = cur ? (Store.update("output", id, header), id) : Store.create("output", Object.assign(header, { status: "H", total: 0, split_total: 0 }));

		if (lines) {
			for (const old of linesOf(entryId)) Store.remove("output_line", old.id);
			for (const l of lines) {
				const p = Rules.priceLine({ item: l.item, qty: l.qty, rate: l.rate }, table, e.doc_date, e.project || "");
				if (p.warning) warnings.push(p.warning);
				Store.create("output_line", {
					entry: entryId, employee: e.type === "I" ? l.employee || null : null, item: p.item, description: l.description || "", uom: l.uom || "", qty: Number(l.qty) || 0, rate: p.rate, amount: p.amount,
				});
			}
		}
		if (members) {
			for (const old of membersOf(entryId)) Store.remove("output_member", old.id);
			for (const m of members) {
				Store.create("output_member", {
					entry: entryId, employee: m.employee, work_days: Number(m.work_days) || 0, hours: Number(m.hours) || 0, factor: blank(m.factor) ? 1 : Number(m.factor),
					percent: Number(m.percent) || 0, amount: Number(m.amount) || 0, manual: !!m.manual,
				});
			}
		}
		refreshTotals(entryId);
		return { id: entryId, warnings };
	}

	function refreshTotals(id) {
		const t = Rules.totals(linesOf(id), membersOf(id));
		Store.submit("output", id, { total: t.total, split_total: t.splitTotal });
		return t;
	}

	/** Load Team Members (phiếu tổ, Tạm giữ): thêm thành viên hiệu lực tại ngày cuối kỳ chưa có trên phiếu. */
	function loadTeamMembers(id) {
		const e = entryOf(id);
		assertHold(e);
		if (e.type !== "T" || blank(e.team)) throw fail("Only team entries with a team", "Chỉ áp dụng cho phiếu tổ đã chọn tổ");
		const period = e.period ? Store.get("period", e.period) : null;
		const date = period ? period.end : e.doc_date;
		const team = Store.find("team_member", { where: "{team} = ?", params: [e.team] }).map((m) => ({
			employee: m.employee, splitFactor: m.factor, fixedPercent: m.percent, effectiveDate: m.effective, expirationDate: m.expiration,
		}));
		const live = Rules.membersAt(team, date);
		const have = new Set(membersOf(id).map((m) => m.employee));
		const days = {};
		if (period) for (const a of Store.find("attendance", { where: "{period} = ?", params: [period.id] })) days[a.employee] = a.work_days || 0;
		const added = [];
		for (const m of live) {
			if (have.has(m.employee)) continue;
			// Hệ số mặc định: của tổ, trống thì 1
			Store.create("output_member", { entry: id, employee: m.employee, work_days: days[m.employee] || 0, hours: 0, factor: blank(m.splitFactor) ? 1 : m.splitFactor, percent: m.fixedPercent || 0, amount: 0, manual: false });
			added.push(m.employee);
		}
		return { added };
	}

	/** Split Amount: chia lại toàn bộ thành tiền cho thành viên (ghi đè số sửa tay). */
	function splitAmount(id) {
		const e = entryOf(id);
		assertHold(e);
		if (e.type !== "T") throw fail("Only team entries", "Chỉ áp dụng cho phiếu tổ");
		const ms = membersOf(id);
		if (!ms.length) throw fail("The entry has no members", "Phiếu chưa có thành viên");
		const total = Rules.totals(linesOf(id), []).total;
		let parts;
		try {
			parts = Rules.split(total, ms.map((m) => ({ workDays: m.work_days, hours: m.hours, splitFactor: m.factor, fixedPercent: m.percent })), e.split_method || "F");
		} catch (err) {
			throw fail(String(err.message || err), String(err.messageVi || err.message || err));
		}
		ms.forEach((m, i) => Store.submit("output_member", m.id, { amount: parts[i], manual: false }));
		refreshTotals(id);
		return { amounts: parts };
	}

	// ------------------------------------------------------------------ duyệt

	/** Dòng sản lượng, thành viên của nhiều phiếu: một truy vấn mỗi loại (QC #20). */
	function childrenOf(entryIds) {
		const lines = {};
		const members = {};
		for (const l of Store.findIn("output_line", "entry", entryIds)) (lines[l.entry] = lines[l.entry] || []).push(l);
		for (const m of Store.findIn("output_member", "entry", entryIds)) (members[m.entry] = members[m.entry] || []).push(m);
		return { lines, members };
	}

	function coreEntry(e, table, kids) {
		const ls = kids ? kids.lines[e.id] || [] : linesOf(e.id);
		const ms = kids ? kids.members[e.id] || [] : membersOf(e.id);
		return {
			refNbr: e.name, status: e.status, batchNbr: e.batch || "", entryType: e.type, rateTable: table ? table.code : "", rateTableType: table ? table.type : "",
			project: e.project || "", branch: e.location || "", workCenter: e.work_center || "",
			lines: ls.map((l) => ({ employee: l.employee || "", itemCode: l.item, qty: l.qty, rate: l.rate, amount: l.amount || 0 })),
			members: ms.map((m) => ({ employee: m.employee, amount: m.amount || 0, manual: m.manual })),
		};
	}

	function checkPeriod(e) {
		const p = e.period ? Store.get("period", e.period) : null;
		if (!p) throw fail("The entry has no pay period", "Phiếu chưa có kỳ lương");
		if (p.status === "C") throw fail("The pay period is closed", "Kỳ lương đã đóng");
		if (p.att_status === "L") throw fail("Attendance of the period is locked", "Kỳ công đã khóa");
	}

	function validate(e) {
		const errs = Entries.validate(coreEntry(e, rateTable(e.rate_table)));
		if (errs.length) throw fail(errs.join(" "), errs.join(" "));
	}

	/**
	 * submit | approve | hold (4.3.3).
	 * @returns {{id, status}}
	 */
	function act(id, action) {
		const e = entryOf(id);
		const to = Rules.nextStatus(e.status || "H", action);
		if (!to) throw fail(`Action ${action} is not allowed in status ${e.status}`, `Không thực hiện được ${action} ở trạng thái ${e.status}`);
		const update = { status: to };
		if (action === "submit" || action === "approve") {
			checkPeriod(e);
			// Phiếu tổ chưa có số sửa tay: tự chia trước khi gửi duyệt
			if (action === "submit" && e.type === "T" && !membersOf(id).some((m) => m.manual)) splitAmount(id);
			refreshTotals(id);
			validate(entryOf(id));
		}
		if (action === "approve") Object.assign(update, { approved_by: currentEmployee(), approved_date: Clock.today() });
		if (action === "hold") {
			if (!blank(e.batch)) throw fail("The entry is included in a payroll batch", "Phiếu đã vào bảng lương");
			const p = e.period ? Store.get("period", e.period) : null;
			if (p && p.status === "C") throw fail("The pay period is closed", "Kỳ lương đã đóng");
			Object.assign(update, { approved_by: null, approved_date: null });
		}
		Store.submit("output", id, update);
		return { id, status: to };
	}

	// ------------------------------------------------------------------ bảng lương

	/**
	 * Dữ liệu sản lượng cho bảng lương (4.3.5): phiếu Approved của kỳ, hoặc Included của chính bảng lương.
	 * shares[emp][].refNbr cho biết phiếu nào đã dùng: lưu vào chi tiết dòng lương để khi ghi sổ chỉ khóa đúng các phiếu đó
	 * (markIncludedRefs, QC #9). refNbrs: mọi phiếu có phần của nhân viên trong lô.
	 * @param {string} [subsidiary] chỉ phiếu của công ty con của bảng lương
	 * @returns {{outputAmounts: {emp: {TABLE: number}}, salesAmount: {emp: number}, shares: {emp: Array}, rateTables: {TABLE: {type, lines}}, refNbrs: string[]}}
	 */
	function forPayroll(periodId, batchId, employeeIds, subsidiary) {
		const want = employeeIds ? new Set(employeeIds.map(String)) : null;
		const tables = {};
		const entries = [];
		const usable = Store.find("output", { where: "{period} = ?", params: [periodId] }).filter(
			(e) => (e.status === "A" || (e.status === "C" && !blank(batchId) && String(e.batch) === String(batchId))) && (blank(subsidiary) || e.subsidiary === String(subsidiary))
		);
		const kids = childrenOf(usable.map((e) => e.id));
		for (const e of usable) {
			if (!tables[e.rate_table]) tables[e.rate_table] = rateTable(e.rate_table);
			entries.push(Object.assign(coreEntry(e, tables[e.rate_table], kids), { status: "A" }));
		}
		// Bảng đơn giá cho quy tắc thang % (nguồn T): mọi bảng loại S đang hoạt động
		for (const t of Store.find("rate_table")) if (t.type === "S" && !tables[t.id]) tables[t.id] = rateTable(t.id);
		const c = Entries.collect(entries, {});
		const keep = (emp) => !want || want.has(String(emp));
		const outputAmounts = {};
		const salesAmount = {};
		const shares = {};
		for (const [emp, byTable] of Object.entries(c.outputAmounts)) {
			if (!keep(emp)) continue;
			outputAmounts[emp] = {};
			for (const [tbl, amt] of Object.entries(byTable)) outputAmounts[emp][tbl] = Money.num(amt);
		}
		for (const [emp, amt] of Object.entries(c.salesAmounts)) if (keep(emp)) salesAmount[emp] = Money.num(amt);
		for (const [emp, list] of Object.entries(c.shares)) {
			if (!keep(emp)) continue;
			shares[emp] = list.map((s) => ({ refNbr: s.refNbr, rateTable: s.rateTable, isSales: s.isSales, project: s.project, branch: s.branch, workCenter: s.workCenter, amount: Money.num(s.amount) }));
		}
		const rateTables = {};
		for (const t of Object.values(tables)) {
			rateTables[t.code] = { type: t.type, lines: t.lines.map((l) => ({ item: l.itemCode, itemCode: l.itemCode, rate: l.rate, fromAmount: l.fromAmount, effectiveDate: l.effectiveDate, expirationDate: l.expirationDate, project: l.project })) };
		}
		const refNbrs = [...new Set([].concat(...Object.values(shares).map((list) => list.map((x) => x.refNbr))).filter(Boolean))];
		return { outputAmounts, salesAmount, shares, rateTables, refNbrs };
	}

	/**
	 * Ghi sổ bảng lương: chỉ các phiếu Approved có số trong danh sách (đã dùng khi tính bảng lương này) -> Included in
	 * Payroll, ghi bảng lương (QC #9: không khóa phiếu của nhân viên ở bảng lương khác hoặc duyệt sau khi tính).
	 */
	function markIncludedRefs(batchId, refNbrs) {
		const want = new Set((refNbrs || []).map(String));
		const done = [];
		if (!want.size) return done;
		for (const e of Store.findIn("output", "name", [...want])) {
			if (e.status !== "A") continue;
			Store.submit("output", e.id, { status: "C", batch: batchId });
			done.push(e.name);
		}
		return done;
	}

	/**
	 * Cũ: khóa mọi phiếu Approved của kỳ. Không dùng nữa (khóa nhầm phiếu của bảng lương khác cùng kỳ, QC #9);
	 * giữ để tương thích, dùng markIncludedRefs.
	 */
	function markIncluded(periodId, batchId) {
		const done = [];
		for (const e of Store.find("output", { where: "{period} = ?", params: [periodId] })) {
			if (e.status !== "A") continue;
			Store.submit("output", e.id, { status: "C", batch: batchId });
			done.push(e.name);
		}
		return done;
	}

	/** Đảo bảng lương: phiếu của bảng lương về Approved, xóa liên kết. */
	function unmarkIncluded(batchId) {
		const done = [];
		for (const e of Store.find("output", { where: "{batch} = ?", params: [batchId] })) {
			Store.submit("output", e.id, { status: "A", batch: null });
			done.push(e.name);
		}
		return done;
	}

	/** Danh sách cho màn hình: lọc công ty con, kỳ bằng SQL; dòng và thành viên một truy vấn (QC #20). */
	function list(subsidiary, periodId) {
		const where = [];
		const params = [];
		if (!blank(subsidiary)) {
			where.push("{subsidiary} = ?");
			params.push(String(subsidiary));
		}
		if (!blank(periodId)) {
			where.push("{period} = ?");
			params.push(String(periodId));
		}
		const rows = Store.find("output", { where: where.length ? where.join(" AND ") : undefined, params, order: "{id} DESC" });
		const kids = childrenOf(rows.map((e) => e.id));
		return rows.map((e) => Object.assign({}, e, { lines: kids.lines[e.id] || [], members: kids.members[e.id] || [] }));
	}

	return { save, loadTeamMembers, splitAmount, act, forPayroll, markIncluded, markIncludedRefs, unmarkIncluded, list, rateTable, refreshTotals };
});
