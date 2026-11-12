/**
 * Màn Xếp ca (lưới lịch ca nhân viên x ngày) - mô-đun route của giao diện bản 2.
 *
 * Lịch ca của một người = ô phân ca đã lưu (record roster) đè lên lịch suy ra từ CHẾ ĐỘ CA (record shift_assign: một mẫu xoay ca
 * gán cho nhân viên / tổ / phòng ban / nhóm lương / cả công ty con theo hiệu lực - core/ShiftAssign, api/EffectiveRoster). Xếp ca
 * cho hàng nghìn người là khai vài dòng chế độ ca; ô chỉ được lưu khi là ngoại lệ (sửa tay). Nhân viên không có chế độ ca và không
 * có ô phân ca trong khoảng ngày = không thuộc diện xếp ca (rows[].eligible = false).
 *
 *   GET  rosterView {subsidiary, from, to, team?} -> {
 *          from, to, days: [{date, dow, type}], canEdit,
 *          shifts: [{id, code, description, start, end, kind, hours, active}], patterns: [{id, code, description, cycle, active}],
 *          teams: [{id, code, description, members}], departments: [{id, name}], paygroups: [{id, code}],
 *          schemes: [{id, scope, target, targetName, pattern, patternCode, anchor, effective, expiration, note}],
 *          rows: [{employee, code, name, department, departmentId, group?, teams: [mã tổ], eligible, v?, patterns: [mã mẫu]}],
 *          vrows: [[id ca | "" (nghỉ) | null (không có chế độ ca), ... mỗi ngày]]   lịch suy ra từ chế độ ca, rows[].v là chỉ số
 *          cells: {employee: [[chỉ số ngày, id ca | "", nguồn G | M]]}              ô đã lưu (đè lên vrows)
 *          locks: [{group, code, from, to}] }
 *   POST rosterCells {subsidiary, cells: [{employee, workDate, shift}]} -> {created, updated, unchanged}
 *        Ô sửa tay (nguồn M); shift trống = ngày nghỉ. Tối đa RosterGrid.MAX_CELLS ô mỗi lần (màn hình tự chia lô).
 *   POST rosterReset {subsidiary, cells: [{employee, workDate}]} -> {reset, missing}
 *        Bỏ ô đã lưu (Inactive, không xóa): ngày đó trở về lịch của chế độ ca.
 *   POST rosterAssignSave {subsidiary, id?, values?: {scope, employee, team, department, paygroup, pattern, anchor, effective,
 *        expiration, note}, inactive?: true} -> {id}            thêm / sửa / thôi dùng một dòng chế độ ca
 *   POST rosterAssignBatch {subsidiary, employees: [id], pattern, anchor?, effective, expiration?, note?} -> {created, closed}
 *        Gán chế độ ca riêng cho từng nhân viên được chọn (tối đa ASSIGN_BATCH người mỗi lần); dòng riêng cũ của người đó giao
 *        khoảng hiệu lực mới được đóng ở ngày trước ngày hiệu lực mới (hoặc thôi dùng nếu bắt đầu từ ngày đó trở đi).
 *
 * Chặn chung khi ghi ô: nhân viên không có hồ sơ lương ở công ty con; ca không tồn tại hoặc ngừng dùng; ngày thuộc kỳ công đã khóa
 * của nhóm lương của nhân viên. Chế độ ca không bị chặn theo kỳ khóa (kỳ đã khóa không xử lý lại chấm công).
 * Quyền: đọc "payroll"; ghi "hr". Số truy vấn của rosterView không phụ thuộc số nhân viên.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Settings", "./Lean", "./Shifts", "./PayGroupPeriods", "./EffectiveRoster", "../core/Dates", "../core/RosterPlan", "../core/RosterGrid", "../core/ShiftMatcher", "../core/AttendanceSummaryCalculator", "../core/ShiftAssign"], (runtime, Store, Settings, Lean, Shifts, PG, ER, Dates, Plan, Grid, Matcher, Summary, Assign) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const DATE = "TO_DATE(?, 'YYYY-MM-DD')";
	const EDIT_ROLES = ["administrator", "customrole_s4vp_hr", "customrole_s4vp_demo"];
	const PROFILE_KEYS = ["isinactive", "employee", "subsidiary", "paygroup", "hire_date", "termination_date"];
	const CELL_KEYS = ["employee", "work_date", "shift", "source"];
	const ASSIGN_BATCH = 100;

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function canEdit() {
		try {
			return EDIT_ROLES.includes(String(runtime.getCurrentUser().roleId || ""));
		} catch (e) {
			return false;
		}
	}

	function subsidiaryOf(input) {
		const s = String((input && input.subsidiary) || "");
		if (!/^\d+$/.test(s)) throw fail("Subsidiary is required", "Chưa chọn công ty con");
		return s;
	}

	/** Hồ sơ lương của công ty con, làm việc trong [from, to], kèm mã, họ tên, phòng ban (một truy vấn JOIN). */
	function profiles(subsidiary, from, to) {
		const where =
			`{subsidiary} = ? AND (t.isinactive = 'F' OR ({termination_date} >= ${DATE} AND {termination_date} <= ${DATE})) ` +
			`AND ({hire_date} IS NULL OR {hire_date} <= ${DATE}) AND ({termination_date} IS NULL OR {termination_date} >= ${DATE})`;
		const params = [subsidiary, from, to, to, from];
		const emp = `LEFT JOIN employee e ON e.id = ${Lean.col("employee", "employee")}`;
		const names = ["e.entityid AS e_code", "e.firstname AS e_first", "e.lastname AS e_last", "e.department AS e_dept_id"];
		const raw = ["e_code", "e_first", "e_last", "e_dept", "e_dept_id"];
		try {
			return Lean.select("employee", PROFILE_KEYS, { where, params, includeInactive: true, join: `${emp} LEFT JOIN department d ON d.id = e.department`, extra: names.concat(["d.fullname AS e_dept"]), raw, tag: "s4vp_roster_profiles" });
		} catch (e) {
			// Vai trò không đọc được bảng department: lấy tên phòng ban bằng BUILTIN.DF
			return Lean.select("employee", PROFILE_KEYS, { where, params, includeInactive: true, join: emp, extra: names.concat(["BUILTIN.DF(e.department) AS e_dept"]), raw, tag: "s4vp_roster_profiles_df" });
		}
	}

	/** Tổ của công ty con (kèm tổ không gắn công ty con) và thành viên. */
	function teamsOf(subsidiary) {
		const teams = Store.find("team").filter((t) => blank(t.subsidiary) || String(t.subsidiary) === String(subsidiary));
		const members = teams.length ? Store.findIn("team_member", "team", teams.map((t) => t.id)) : [];
		const byTeam = {};
		for (const m of members) (byTeam[m.team] = byTeam[m.team] || []).push({ employee: String(m.employee), team: String(m.team), effectiveDate: m.effective || null, expirationDate: m.expiration || null });
		return { teams, byTeam };
	}

	const overlaps = (m, from, to) => (!m.effectiveDate || Dates.cmp(m.effectiveDate, to) <= 0) && (!m.expirationDate || Dates.cmp(m.expirationDate, from) >= 0);

	function view(params) {
		const subsidiary = subsidiaryOf(params);
		const r = Grid.range(params.from, params.to);
		const teamId = String((params && params.team) || "");

		const shifts = Shifts.shifts().map((s) => {
			let hours = 0;
			try {
				hours = Matcher.standardHours(s);
			} catch (e) {
				hours = 0;
			}
			return { id: String(s.id), code: s.code, description: s.description || "", start: s.startTime, end: s.endTime, kind: s.kind || "D", hours, active: s.isActive };
		});
		const shiftIdByCode = {};
		for (const s of shifts) shiftIdByCode[s.code] = s.id;
		const patternList = Shifts.patterns();
		const patterns = patternList.map((p) => ({ id: String(p.id), code: p.code, description: p.description || "", cycle: p.cycle.map((c) => c || ""), active: p.isActive }));
		const patById = {};
		for (const p of patternList) patById[String(p.id)] = { code: p.code, cycle: p.cycle };
		const { teams, byTeam } = teamsOf(subsidiary);

		let profs = profiles(subsidiary, r.from, r.to);
		if (teamId) {
			const want = new Set((byTeam[teamId] || []).filter((m) => overlaps(m, r.from, r.to)).map((m) => m.employee));
			profs = profs.filter((p) => want.has(String(p.employee)));
		}
		// Một nhân viên nhiều hồ sơ (hồ sơ cũ ngừng dùng): giữ hồ sơ đang dùng
		const byEmp = new Map();
		for (const p of profs) {
			const cur = byEmp.get(String(p.employee));
			if (!cur || (cur.isInactive && !p.isInactive)) byEmp.set(String(p.employee), p);
		}
		const empIds = [...byEmp.keys()];

		const teamCodes = {};
		const memberships = {};
		for (const t of teams) {
			for (const m of byTeam[t.id] || []) {
				if (!byEmp.has(m.employee)) continue;
				(memberships[m.employee] = memberships[m.employee] || []).push(m);
				if (!overlaps(m, r.from, r.to)) continue;
				const list = teamCodes[m.employee] || (teamCodes[m.employee] = []);
				if (!list.includes(norm(t.name))) list.push(norm(t.name));
			}
		}

		const ctx = PG.load();
		const groups = ctx.multi ? PG.loadGroups(ctx, empIds) : {};

		// Ô đã lưu của khoảng ngày: lọc ngày trong SQL, lọc nhân viên của lưới ở đây (không ghép IN 900 nhân viên)
		const mine = new Set(empIds);
		const cellRows = empIds.length
			? Lean.select("roster", CELL_KEYS, { where: `{work_date} >= ${DATE} AND {work_date} <= ${DATE}`, params: [r.from, r.to], tag: "s4vp_roster_cells" })
				.filter((c) => mine.has(String(c.employee)))
				.map((c) => ({ employee: String(c.employee), workDate: c.work_date, shift: c.shift || "", source: c.source || "G" }))
			: [];
		const cells = Grid.packCells(cellRows, r.from);

		// Lịch suy ra từ chế độ ca: nhân viên trùng lịch dùng chung một dãy (vrows)
		const schemes = ER.schemes(subsidiary);
		const vrows = [];
		const vIndex = new Map();
		const departments = new Map();
		const rows = empIds
			.map((e) => {
				const p = byEmp.get(e);
				const deptId = blank(p.e_dept_id) ? "" : String(p.e_dept_id);
				if (deptId && !departments.has(deptId)) departments.set(deptId, p.e_dept || deptId);
				const o = { employee: e, code: p.e_code || "", name: [p.e_last, p.e_first].filter(Boolean).join(" ").trim() || p.e_code || "", department: p.e_dept || "", departmentId: deptId, teams: teamCodes[e] || [], patterns: [] };
				if (ctx.multi) o.group = groups[e] || PG.DEFAULT;
				if (schemes.length) {
					const list = Assign.days({ employee: e, subsidiary, department: deptId || null, paygroup: p.paygroup || null, memberships: memberships[e] || [] }, r.from, r.to, schemes, patById);
					if (list.some(Boolean)) {
						const sig = Assign.signature(list);
						if (!vIndex.has(sig)) {
							vIndex.set(sig, vrows.length);
							// Mã ca của mẫu không còn tồn tại: coi như chưa xếp
							vrows.push(list.map((c) => (!c ? null : !c.shiftCode ? "" : shiftIdByCode[c.shiftCode] || null)));
						}
						o.v = vIndex.get(sig);
						const used = new Set(list.filter(Boolean).map((c) => c.assign));
						for (const a of schemes) if (used.has(a.id) && patById[String(a.patternId)] && !o.patterns.includes(patById[String(a.patternId)].code)) o.patterns.push(patById[String(a.patternId)].code);
					}
				}
				o.eligible = o.v !== undefined || !!cells[e];
				return o;
			})
			.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

		const nameOf = { employee: {}, team: {} };
		for (const row of rows) nameOf.employee[row.employee] = `${row.code} ${row.name}`.trim();
		for (const t of teams) nameOf.team[String(t.id)] = norm(t.name) + (t.description ? ` - ${t.description}` : "");
		const schemeRows = schemes.map((a) => {
			const target = a.scope === "E" ? a.employee : a.scope === "T" ? a.team : a.scope === "D" ? a.department : a.scope === "G" ? a.paygroup : "";
			const targetName = a.scope === "E" ? nameOf.employee[String(target)] || "" : a.scope === "T" ? nameOf.team[String(target)] || "" : a.scope === "D" ? departments.get(String(target)) || "" : a.scope === "G" ? ctx.names[String(target)] || "" : "";
			return { id: a.id, scope: a.scope, target: blank(target) ? "" : String(target), targetName, pattern: blank(a.patternId) ? "" : String(a.patternId), patternCode: (patById[String(a.patternId)] || {}).code || "", anchor: a.anchor || "", effective: a.effective || "", expiration: a.expiration || "", note: a.note || "" };
		});

		const weeklyOff = Settings.resolve(subsidiary, null).weeklyOffDays;
		const holidays = Settings.holidays().map((h) => h.date);
		return {
			from: r.from, to: r.to, days: Grid.days(r.from, r.to, weeklyOff, holidays), canEdit: canEdit(),
			shifts, patterns,
			teams: teams.map((t) => ({ id: String(t.id), code: norm(t.name), description: t.description || "", members: (byTeam[t.id] || []).filter((m) => overlaps(m, r.from, r.to)).length })),
			departments: [...departments.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
			paygroups: Object.keys(ctx.names).map((id) => ({ id, code: ctx.names[id] })),
			schemes: schemeRows, rows, vrows, cells,
			locks: Grid.lockedRanges(ctx.periods, r.from, r.to).map((l) => (ctx.multi ? l : Object.assign(l, { group: "" }))),
		};
	}

	// ------------------------------------------------------------------ ghi ô

	/** Nhân viên phải có hồ sơ lương ở công ty con đang chọn. */
	function assertEmployees(subsidiary, empIds) {
		const ok = new Set(Store.findIn("employee", "employee", empIds).filter((p) => String(p.subsidiary) === subsidiary).map((p) => String(p.employee)));
		const stranger = empIds.find((e) => !ok.has(e));
		if (stranger) throw fail(`Employee ${stranger} has no payroll profile in this subsidiary`, `Nhân viên ${stranger} không có hồ sơ lương ở công ty con này`);
	}

	/** Kỳ công đã khóa theo nhóm lương của từng nhân viên, xét đúng ngày của từng ô. */
	function assertOpen(cells, empIds) {
		const ctx = PG.load();
		const groups = ctx.multi ? PG.loadGroups(ctx, empIds) : {};
		for (const c of cells) {
			const hit = Summary.lockedPeriodOverlap(c.workDate, c.workDate, ctx.periods, ctx.multi ? groups[c.employee] || PG.DEFAULT : undefined);
			if (hit) throw fail(`Attendance of period ${hit.code} is locked`, `Kỳ công ${hit.code} đã khóa`);
		}
	}

	/** Ô đã lưu (kể cả ô đã bỏ - Inactive) theo khóa nhân viên|ngày; có cả hai thì ưu tiên ô đang dùng. */
	function storedByKey(empIds, from, to) {
		const out = new Map();
		const marks = empIds.map(() => "?").join(",");
		const list = Store.find("roster", { where: `{employee} IN (${marks}) AND {work_date} >= ${DATE} AND {work_date} <= ${DATE}`, params: empIds.concat([from, to]), includeInactive: true });
		for (const x of list) {
			if (!x.work_date || !Dates.within(x.work_date, from, to)) continue;
			const key = Plan.key(x.employee, x.work_date);
			const cur = out.get(key);
			if (!cur || (cur.isInactive && !x.isInactive)) out.set(key, x);
		}
		return out;
	}

	function saveCells(body) {
		const subsidiary = subsidiaryOf(body);
		const cells = Grid.normalizeCells(body && body.cells);
		const empIds = [...new Set(cells.map((c) => c.employee))];
		const dates = cells.map((c) => c.workDate).sort();
		const from = dates[0];
		const to = dates[dates.length - 1];
		assertEmployees(subsidiary, empIds);

		const shiftById = {};
		for (const s of Shifts.shifts()) shiftById[String(s.id)] = s;
		for (const c of cells) {
			if (!c.shift) continue;
			const s = shiftById[c.shift];
			if (!s) throw fail(`Shift ${c.shift} does not exist`, `Ca ${c.shift} không tồn tại`);
			if (!s.isActive) throw fail(`Shift ${s.code} is inactive`, `Ca ${s.code} đã ngừng dùng`);
		}
		assertOpen(cells, empIds);
		const existing = storedByKey(empIds, from, to);

		// Chi nhánh, work center của ô mới: theo tổ mà nhân viên là thành viên tại ngày đó (tổ đầu tiên tìm thấy)
		let teamOf = null;
		const defaults = (employee, date) => {
			if (!teamOf) {
				teamOf = { members: {}, teams: {} };
				for (const m of Store.findIn("team_member", "employee", empIds)) (teamOf.members[String(m.employee)] = teamOf.members[String(m.employee)] || []).push(m);
				const ids = [...new Set(Object.values(teamOf.members).reduce((a, l) => a.concat(l.map((m) => String(m.team))), []))];
				if (ids.length) for (const t of Store.find("team")) if (ids.includes(String(t.id))) teamOf.teams[String(t.id)] = t;
			}
			const m = (teamOf.members[employee] || []).find((x) => Dates.within(date, x.effective || null, x.expiration || null) && teamOf.teams[String(x.team)]);
			const t = m ? teamOf.teams[String(m.team)] : null;
			return { location: t ? t.location || null : null, work_center: t ? t.work_center || null : null };
		};

		const out = { created: 0, updated: 0, unchanged: 0 };
		for (const c of cells) {
			const key = Plan.key(c.employee, c.workDate);
			const cur = existing.get(key);
			if (cur && cur.isInactive) {
				Store.update("roster", cur.id, { shift: c.shift || null, source: "M", isInactive: false });
				out.updated++;
			} else if (cur) {
				if (String(cur.shift || "") === c.shift && (cur.source || "G") === "M") {
					out.unchanged++;
					continue;
				}
				Store.submit("roster", cur.id, { shift: c.shift || null, source: "M" });
				out.updated++;
			} else {
				Store.create("roster", Object.assign({ employee: c.employee, work_date: c.workDate, shift: c.shift || null, source: "M", key }, defaults(c.employee, c.workDate)));
				out.created++;
			}
		}
		return out;
	}

	function resetCells(body) {
		const subsidiary = subsidiaryOf(body);
		const cells = Grid.normalizeCells(((body && body.cells) || []).map((c) => ({ employee: c && c.employee, workDate: c && c.workDate, shift: "" })));
		const empIds = [...new Set(cells.map((c) => c.employee))];
		const dates = cells.map((c) => c.workDate).sort();
		assertEmployees(subsidiary, empIds);
		assertOpen(cells, empIds);
		const existing = storedByKey(empIds, dates[0], dates[dates.length - 1]);
		const out = { reset: 0, missing: 0 };
		for (const c of cells) {
			const cur = existing.get(Plan.key(c.employee, c.workDate));
			if (!cur || cur.isInactive) {
				out.missing++;
				continue;
			}
			Store.update("roster", cur.id, { isInactive: true });
			out.reset++;
		}
		return out;
	}

	// ------------------------------------------------------------------ chế độ ca

	function assertPattern(id) {
		const p = Shifts.patterns().find((x) => String(x.id) === String(id));
		if (!p) throw fail("Shift pattern not found", "Không tìm thấy mẫu xoay ca");
		if (!p.isActive) throw fail(`Shift pattern ${p.code} is inactive`, `Mẫu xoay ca ${p.code} đã ngừng dùng`);
		const codes = new Set(Shifts.shifts().map((s) => s.code));
		for (const c of p.cycle) if (c && !codes.has(c)) throw fail(`Shift ${c} of the pattern does not exist`, `Ca ${c} của mẫu không tồn tại`);
	}

	function wrap(fn) {
		try {
			return fn();
		} catch (e) {
			if (e && e.messageVi) throw fail(String(e.message), String(e.messageVi));
			throw e;
		}
	}

	function saveScheme(body) {
		const subsidiary = subsidiaryOf(body);
		const id = body && !blank(body.id) ? String(body.id) : "";
		const cur = id ? Store.get("shift_assign", id) : null;
		if (id && (!cur || String(cur.subsidiary || "") !== subsidiary)) throw fail("Shift scheme not found", "Không tìm thấy dòng chế độ ca");
		if (body && body.inactive) {
			if (!cur) throw fail("Shift scheme not found", "Không tìm thấy dòng chế độ ca");
			Store.update("shift_assign", id, { isInactive: true });
			return { id };
		}
		const v = wrap(() => Assign.validate(Object.assign({}, (body && body.values) || {}, { subsidiary })));
		assertPattern(v.pattern);
		if (v.scope === "E") assertEmployees(subsidiary, [v.employee]);
		if (v.scope === "T") {
			const t = Store.get("team", v.team);
			if (!t || (!blank(t.subsidiary) && String(t.subsidiary) !== subsidiary)) throw fail("Team not found in this subsidiary", "Không tìm thấy tổ ở công ty con này");
		}
		if (v.scope === "G" && !Store.get("paygroup", v.paygroup)) throw fail("Pay group not found", "Không tìm thấy nhóm lương");
		if (cur) {
			Store.update("shift_assign", id, v);
			return { id };
		}
		return { id: String(Store.create("shift_assign", v)) };
	}

	function assignBatch(body) {
		const subsidiary = subsidiaryOf(body);
		const empIds = [...new Set(((body && body.employees) || []).map((e) => String(e)).filter((e) => /^\d+$/.test(e)))];
		if (!empIds.length) throw fail("Select at least one employee", "Chưa chọn nhân viên nào");
		if (empIds.length > ASSIGN_BATCH) throw fail(`At most ${ASSIGN_BATCH} employees per call (${empIds.length} given)`, `Mỗi lần tối đa ${ASSIGN_BATCH} nhân viên (đang có ${empIds.length})`);
		const base = wrap(() => Assign.validate({ subsidiary, scope: "E", employee: empIds[0], pattern: body.pattern, anchor: body.anchor, effective: body.effective, expiration: body.expiration, note: body.note }));
		assertPattern(base.pattern);
		assertEmployees(subsidiary, empIds);
		const old = Store.findIn("shift_assign", "employee", empIds).filter((a) => a.scope === "E");
		const dayBefore = Dates.addDays(base.effective, -1);
		const out = { created: 0, closed: 0 };
		for (const a of old) {
			const giao = (!a.expiration || Dates.cmp(a.expiration, base.effective) >= 0) && (!base.expiration || !a.effective || Dates.cmp(a.effective, base.expiration) <= 0);
			if (!giao) continue;
			if (a.effective && Dates.cmp(a.effective, base.effective) >= 0) Store.update("shift_assign", a.id, { isInactive: true });
			else Store.update("shift_assign", a.id, { expiration: dayBefore });
			out.closed++;
		}
		for (const e of empIds) {
			Store.create("shift_assign", Object.assign({}, base, { employee: e }));
			out.created++;
		}
		return out;
	}

	const routes = {
		get: { rosterView: { roles: "payroll", run: view } },
		post: {
			rosterCells: { roles: "hr", run: saveCells },
			rosterReset: { roles: "hr", run: resetCells },
			rosterAssignSave: { roles: "hr", run: saveScheme },
			rosterAssignBatch: { roles: "hr", run: assignBatch },
		},
	};

	return { ASSIGN_BATCH, routes, view, saveCells, resetCells, saveScheme, assignBatch };
});
