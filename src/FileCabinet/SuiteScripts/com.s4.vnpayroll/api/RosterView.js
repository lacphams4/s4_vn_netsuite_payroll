/**
 * Màn Xếp ca (lưới phân ca nhân viên x ngày) - mô-đun route của giao diện bản 2. Dữ liệu là record `roster` hiện có (mỗi nhân
 * viên một ô mỗi ngày); sinh từ mẫu xoay ca theo tổ vẫn dùng action cũ generateRoster (api/Shifts.generateRoster).
 *
 *   GET  rosterView  {subsidiary, from, to, team?} -> {
 *          from, to, days: [{date, dow, type}], canEdit,
 *          shifts: [{id, code, description, start, end, kind, hours, active}], patterns: [{id, code, description, cycle, active}],
 *          teams: [{id, code, description, members}],
 *          rows: [{employee, code, name, department, group?, teams: [mã tổ]}],
 *          cells: {employee: [[chỉ số ngày, id ca | "", nguồn G | M]]}, locks: [{group, code, from, to}] }
 *        Nhân viên: hồ sơ lương của công ty con, đang làm việc trong khoảng ngày; có `team` thì chỉ thành viên hiệu lực của tổ.
 *   POST rosterCells {subsidiary, cells: [{employee, workDate, shift}]} -> {created, updated, unchanged}
 *        Ô sửa tay (nguồn M, giữ khi sinh lại từ mẫu); shift trống = ngày nghỉ. Tối đa RosterGrid.MAX_CELLS ô mỗi lần.
 *        Ô mới nhận chi nhánh, work center của tổ mà nhân viên là thành viên tại ngày đó; ô đã có giữ nguyên hai trường này.
 *        Chặn: nhân viên không có hồ sơ lương ở công ty con; ca không tồn tại hoặc ngừng dùng; ngày thuộc kỳ công đã khóa của
 *        nhóm lương của nhân viên (api/PayGroupPeriods).
 *
 * Quyền: đọc "payroll"; ghi "hr". Số truy vấn của rosterView không phụ thuộc số nhân viên (ca, mẫu, tổ, thành viên, hồ sơ +
 * tên, ô phân ca theo khoảng ngày, nhóm lương + kỳ, ngày lễ).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Settings", "./Lean", "./Shifts", "./PayGroupPeriods", "../core/Dates", "../core/RosterPlan", "../core/RosterGrid", "../core/ShiftMatcher", "../core/AttendanceSummaryCalculator"], (runtime, Store, Settings, Lean, Shifts, PG, Dates, Plan, Grid, Matcher, Summary) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const DATE = "TO_DATE(?, 'YYYY-MM-DD')";
	const EDIT_ROLES = ["administrator", "customrole_s4vp_hr", "customrole_s4vp_demo"];
	const PROFILE_KEYS = ["isinactive", "employee", "subsidiary", "paygroup", "hire_date", "termination_date"];
	const CELL_KEYS = ["employee", "work_date", "shift", "source"];

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

	/** Hồ sơ lương của công ty con, làm việc trong [from, to], kèm mã, họ tên, phòng ban (một truy vấn JOIN). */
	function profiles(subsidiary, from, to) {
		const where =
			`{subsidiary} = ? AND (t.isinactive = 'F' OR ({termination_date} >= ${DATE} AND {termination_date} <= ${DATE})) ` +
			`AND ({hire_date} IS NULL OR {hire_date} <= ${DATE}) AND ({termination_date} IS NULL OR {termination_date} >= ${DATE})`;
		const params = [subsidiary, from, to, to, from];
		const emp = `LEFT JOIN employee e ON e.id = ${Lean.col("employee", "employee")}`;
		const names = ["e.entityid AS e_code", "e.firstname AS e_first", "e.lastname AS e_last"];
		const raw = ["e_code", "e_first", "e_last", "e_dept"];
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
		for (const m of members) (byTeam[m.team] = byTeam[m.team] || []).push({ employee: String(m.employee), effectiveDate: m.effective || null, expirationDate: m.expiration || null });
		return { teams, byTeam };
	}

	const overlaps = (m, from, to) => (!m.effectiveDate || Dates.cmp(m.effectiveDate, to) <= 0) && (!m.expirationDate || Dates.cmp(m.expirationDate, from) >= 0);

	function view(params) {
		const subsidiary = String((params && params.subsidiary) || "");
		if (!/^\d+$/.test(subsidiary)) throw fail("Subsidiary is required", "Chưa chọn công ty con");
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
		const patterns = Shifts.patterns().map((p) => ({ id: String(p.id), code: p.code, description: p.description || "", cycle: p.cycle.map((c) => c || ""), active: p.isActive }));
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
		for (const t of teams) {
			for (const m of byTeam[t.id] || []) {
				if (!byEmp.has(m.employee) || !overlaps(m, r.from, r.to)) continue;
				const list = teamCodes[m.employee] || (teamCodes[m.employee] = []);
				if (!list.includes(norm(t.name))) list.push(norm(t.name));
			}
		}

		const ctx = PG.load();
		const groups = ctx.multi ? PG.loadGroups(ctx, empIds) : {};
		const rows = empIds
			.map((e) => {
				const p = byEmp.get(e);
				const o = { employee: e, code: p.e_code || "", name: [p.e_last, p.e_first].filter(Boolean).join(" ").trim() || p.e_code || "", department: p.e_dept || "", teams: teamCodes[e] || [] };
				if (ctx.multi) o.group = groups[e] || PG.DEFAULT;
				return o;
			})
			.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

		// Ô phân ca của khoảng ngày: lọc ngày trong SQL, lọc nhân viên của lưới ở đây (không ghép IN 900 nhân viên)
		const mine = new Set(empIds);
		const cellRows = empIds.length
			? Lean.select("roster", CELL_KEYS, { where: `{work_date} >= ${DATE} AND {work_date} <= ${DATE}`, params: [r.from, r.to], tag: "s4vp_roster_cells" })
				.filter((c) => mine.has(String(c.employee)))
				.map((c) => ({ employee: String(c.employee), workDate: c.work_date, shift: c.shift || "", source: c.source || "G" }))
			: [];

		const weeklyOff = Settings.resolve(subsidiary, null).weeklyOffDays;
		const holidays = Settings.holidays().map((h) => h.date);
		return {
			from: r.from, to: r.to, days: Grid.days(r.from, r.to, weeklyOff, holidays), canEdit: canEdit(),
			shifts, patterns,
			teams: teams.map((t) => ({ id: String(t.id), code: norm(t.name), description: t.description || "", members: (byTeam[t.id] || []).filter((m) => overlaps(m, r.from, r.to)).length })),
			rows, cells: Grid.packCells(cellRows, r.from), locks: Grid.lockedRanges(ctx.periods, r.from, r.to).map((l) => (ctx.multi ? l : Object.assign(l, { group: "" }))),
		};
	}

	function saveCells(body) {
		const subsidiary = String((body && body.subsidiary) || "");
		if (!/^\d+$/.test(subsidiary)) throw fail("Subsidiary is required", "Chưa chọn công ty con");
		const cells = Grid.normalizeCells(body && body.cells);
		const empIds = [...new Set(cells.map((c) => c.employee))];
		const dates = cells.map((c) => c.workDate).sort();
		const from = dates[0];
		const to = dates[dates.length - 1];

		// Nhân viên phải có hồ sơ lương ở công ty con đang chọn
		const ok = new Set(Store.findIn("employee", "employee", empIds).filter((p) => String(p.subsidiary) === subsidiary).map((p) => String(p.employee)));
		const stranger = empIds.find((e) => !ok.has(e));
		if (stranger) throw fail(`Employee ${stranger} has no payroll profile in this subsidiary`, `Nhân viên ${stranger} không có hồ sơ lương ở công ty con này`);

		const shiftById = {};
		for (const s of Shifts.shifts()) shiftById[String(s.id)] = s;
		for (const c of cells) {
			if (!c.shift) continue;
			const s = shiftById[c.shift];
			if (!s) throw fail(`Shift ${c.shift} does not exist`, `Ca ${c.shift} không tồn tại`);
			if (!s.isActive) throw fail(`Shift ${s.code} is inactive`, `Ca ${s.code} đã ngừng dùng`);
		}

		// Kỳ công đã khóa theo nhóm lương của từng nhân viên, xét đúng ngày của từng ô
		const ctx = PG.load();
		const groups = ctx.multi ? PG.loadGroups(ctx, empIds) : {};
		for (const c of cells) {
			const hit = Summary.lockedPeriodOverlap(c.workDate, c.workDate, ctx.periods, ctx.multi ? groups[c.employee] || PG.DEFAULT : undefined);
			if (hit) throw fail(`Attendance of period ${hit.code} is locked`, `Kỳ công ${hit.code} đã khóa`);
		}

		const existing = new Map();
		for (const x of Store.findIn("roster", "employee", empIds, `{work_date} >= ${DATE} AND {work_date} <= ${DATE}`, [from, to])) {
			if (x.work_date && Dates.within(x.work_date, from, to)) existing.set(Plan.key(x.employee, x.work_date), x);
		}

		// Chi nhánh, work center của ô mới: theo tổ mà nhân viên là thành viên tại ngày đó (tổ đầu tiên tìm thấy)
		let teamOf = null;
		const defaults = (employee, date) => {
			if (!teamOf) {
				teamOf = { members: {}, teams: {} };
				for (const m of Store.findIn("team_member", "employee", empIds)) (teamOf.members[String(m.employee)] = teamOf.members[String(m.employee)] || []).push(m);
				const ids = [...new Set(Object.values(teamOf.members).reduce((a, l) => a.concat(l.map((m) => m.team)), []))];
				if (ids.length) for (const t of Store.find("team")) if (ids.map(String).includes(String(t.id))) teamOf.teams[String(t.id)] = t;
			}
			const m = (teamOf.members[employee] || []).find((x) => Dates.within(date, x.effective || null, x.expiration || null) && teamOf.teams[String(x.team)]);
			const t = m ? teamOf.teams[String(m.team)] : null;
			return { location: t ? t.location || null : null, work_center: t ? t.work_center || null : null };
		};

		const out = { created: 0, updated: 0, unchanged: 0 };
		for (const c of cells) {
			const key = Plan.key(c.employee, c.workDate);
			const cur = existing.get(key);
			if (cur) {
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

	const routes = {
		get: { rosterView: { roles: "payroll", run: view } },
		post: { rosterCells: { roles: "hr", run: saveCells } },
	};

	return { routes, view, saveCells };
});
