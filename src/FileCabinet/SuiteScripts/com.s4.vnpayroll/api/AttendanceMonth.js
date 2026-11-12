/**
 * Chấm công theo kỳ (docs/design/TinhCong.dc.html): các bước tính công, ngoại lệ cần xử lý, bảng công tháng.
 *
 * Mô-đun route của giao diện bản 2 (docs/UI_V2.md mục 5): RESTlet s4vp_rl_api tra action trong routes.get / routes.post,
 * kiểm tra vai trò theo roles ("all" | "hr" | "acct" | "payroll" | "admin") rồi gọi run(params | body). Tên action không
 * trùng action cũ của RESTlet. Lỗi nghiệp vụ: throw fail(en, vi).
 *
 * Mô-đun này CHỈ ĐỌC. Mọi thao tác ghi của màn Chấm công dùng lại action cũ của RESTlet (đã kiểm kỳ khóa, quyền HR):
 *   buildAttendance, lockAttendance, unlockAttendance, processPunches, loadSheetEmployees   {id: kỳ}
 *   saveSheet {period, employee, cells}            sửa ô ngày của bảng công ký hiệu (nhóm nguồn S)
 *   saveDoc {type, values}, docAction {type, id, op}   chứng từ công (nhóm nguồn E): sửa công một ngày = phiếu ngoại lệ
 *
 * Thực tế dữ liệu của gói (xem api/Attendance.js, api/Shifts.js): bảng tổng hợp công chỉ lưu SỐ TỔNG theo kỳ cho mỗi nhân
 * viên; dữ liệu theo ngày chỉ có ở bảng công ký hiệu (nhóm nguồn S), ở chứng từ công (đơn nghỉ, công tác, làm thêm, phiếu
 * ngoại lệ) và ở bản ghi Time của cộng tác viên. core/AttendanceMonthGrid dựng ô ngày từ đúng các nguồn đó.
 *
 * GET attendanceMonth {period?, subsidiary?} -> {   (không có period: kỳ mặc định theo Grid.defaultPeriod)
 *   period: {id, code, start, end, status, attStatus, stdDays, paygroup, paygroupCode, paygroupName, mode: "E"|"S", timeFrom, timeTo},
 *   locked, closed, canEdit, canUnlock, hasBatch, hasSummary, otherSubsidiaries, timeUnavailable, syncLimit,
 *   steps: RunSteps.attendanceSteps, counts: {open, info, byType}, stats, days, rows, exceptions, legend   (core/AttendanceMonthGrid.build)
 *   cellTable, cellRows, totalsKeys, totalsTable: lưới nén cho 1.000 nhân viên (Grid.packRows) - cellTable là các dạng ô ngày
 *     khác nhau, cellRows là các DÃY ô khác nhau (mỗi dãy là mảng chỉ số vào cellTable), rows[].cells là chỉ số vào cellRows,
 *     rows[].totals là chỉ số vào totalsTable (dãy số theo thứ tự totalsKeys); trường của dòng bằng mặc định thì không gửi
 *     (department "", contractor false, salaryType "M", source "docs", hasSummary false, locked false, open 0, cờ false)
 *   docs: [{type, id, name, employee, from, to, status, days?, hours?, leaveType?, subtype?, minutes?, reason, fromPunches?}],
 *   symbols: [{code, category, days, description}] }
 * GET attendanceEmployee {period, employee} -> { punches: [{date, time, device, source}], roster: [{date, shift, start, end}],
 *   time: [{date, hours, approval, projectName, taskName}], window: {from, to} }   chi tiết nạp khi mở khung nhân viên
 *
 * Hiệu năng (1.000 nhân viên): attendanceMonth chạy 9 truy vấn không phụ thuộc số nhân viên, mỗi truy vấn chỉ SELECT cột cần
 * (api/Lean): kỳ, thiết lập, nhóm lương, hồ sơ lương + mã / tên / phòng ban (một JOIN, lọc nhóm lương - thời gian làm việc -
 * công ty con ngay trong SQL), bảng lương của kỳ + số hồ sơ của công ty con khác (một UNION ALL), ký hiệu, ngày lễ, chứng từ
 * công của kỳ (bốn loại trong một UNION ALL, lọc theo ngày thay cho IN 900 nhân viên), dòng tổng hợp công. Thêm bảng công ký
 * hiệu (nhóm nguồn S) và giờ Time (khi có cộng tác viên). Câu UNION ALL nào account không chạy được thì tự chia thành các câu
 * đơn. Lưới trả đủ mọi nhân viên (tìm kiếm, lọc "có ngoại lệ", "Hiện thêm" làm ở trình duyệt, không gọi lại máy chủ) ở dạng
 * nén Grid.packRows.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Settings", "./TimeLines", "./Clock", "./Lean", "../core/Dates", "../core/RunSteps", "../core/RosterPlan", "../core/AttendanceMonthGrid"], (runtime, Store, Settings, TimeLines, Clock, Lean, Dates, RunSteps, Plan, Grid) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const DATE = "TO_DATE(?, 'YYYY-MM-DD')";
	const PERIOD_KEYS = ["name", "paygroup", "start", "end", "std_days", "status", "att_status", "time_from", "time_to"];
	const GROUP_KEYS = ["name", "description", "att_source", "subsidiary"];
	const PROFILE_KEYS = ["name", "isinactive", "employee", "subsidiary", "paygroup", "employment_type", "salary_type", "hire_date", "termination_date"];
	const SUMMARY_KEYS = ["employee", "status", "std_days", "paid_leave", "unpaid_leave", "si_leave", "trip_days", "late_days", "adjust_days", "work_days", "ot_hours"];
	const LEAVE_TYPE_KEYS = ["name", "is_paid", "deducts_days", "paid_by_si"];
	// Chứng từ công: record, trường ngày đầu / cuối, và các trường riêng của từng loại (cột chung: id, name, employee, status,
	// summary_locked, lý do). Thứ tự cột của bốn loại phải như nhau để gộp bằng UNION ALL.
	const DOCS = {
		leave: { name: "leave_request", from: "from", to: "to", reason: "reason", keys: ["days", "leave_type", "from_half", "to_half"] },
		trip: { name: "business_trip", from: "from", to: "to", reason: "purpose", keys: ["days"] },
		exception: { name: "att_exception", from: "work_date", to: "work_date", reason: "reason", keys: ["exception_type", "minutes", "deduct_days", "adjust_days", "from_punches"] },
		ot: { name: "ot_request", from: "work_date", to: "work_date", reason: "reason", keys: ["hours", "from_punches"] },
	};
	const DOC_COMMON = ["name", "employee", "status", "summary_locked"];
	const DOC_SLOTS = ["days", "hours", "minutes", "leave_type", "from_half", "to_half", "exception_type", "deduct_days", "adjust_days", "from_punches"];
	const IN_RANGE = (field) => `{${field}} >= ${DATE} AND {${field}} <= ${DATE}`;
	// Cùng ngưỡng với api/Attendance.SYNC_LIMIT: kỳ nhiều nhân viên hơn thì lập / khóa công chạy nền
	const SYNC_LIMIT = 150;
	// customrole_s4vp_demo: vai trò trình diễn, quyền như administrator với dữ liệu của gói
	const EDIT_ROLES = ["administrator", "customrole_s4vp_hr", "customrole_s4vp_demo"];

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

	/** Nhóm lương (mọi nhóm, kể cả đã vô hiệu) theo id, chỉ các cột màn chấm công dùng. */
	function paygroups() {
		const groups = {};
		for (const g of Lean.select("paygroup", GROUP_KEYS, { includeInactive: true, tag: "s4vp_att_paygroups" })) groups[g.id] = g;
		return groups;
	}

	function getPeriod(id) {
		if (blank(id)) throw fail("Select a pay period", "Hãy chọn kỳ lương");
		const p = Lean.select("period", PERIOD_KEYS, { where: "{id} = ?", params: [id], includeInactive: true, tag: "s4vp_att_period" })[0];
		if (!p) throw fail("Pay period not found", "Không tìm thấy kỳ lương");
		return p;
	}

	/**
	 * Kỳ mặc định khi màn hình chưa chọn kỳ (Grid.defaultPeriod): kỳ còn mở, chưa khóa công, gần hôm nay nhất, trong các kỳ
	 * của nhóm lương dùng cho công ty con đang chọn (nhóm không gắn công ty con dùng chung). Trả luôn dòng kỳ (khỏi đọc lại).
	 */
	function defaultPeriod(subsidiary, groups) {
		const all = Lean.select("period", PERIOD_KEYS, { includeInactive: true, tag: "s4vp_att_periods" });
		const view = (p) => ({ id: p.id, start: p.start, end: p.end, status: p.status || "O", attStatus: p.att_status || "O", paygroup: p.paygroup });
		const mine = all.filter((p) => {
			const sub = (groups[p.paygroup] || {}).subsidiary;
			return !subsidiary || blank(sub) || String(sub) === subsidiary;
		});
		const id = Grid.defaultPeriod((mine.length ? mine : all).map(view), Clock.today());
		if (!id) throw fail("No pay period yet. Generate pay periods in Setup first.", "Chưa có kỳ lương nào. Hãy sinh kỳ lương ở Thiết lập trước.");
		return all.find((p) => String(p.id) === String(id));
	}

	/**
	 * Điều kiện SQL chọn hồ sơ lương thuộc lưới công của kỳ (cùng quy tắc với bộ lọc cũ làm trong JavaScript):
	 *   - nhóm lương của hồ sơ có cùng mã với nhóm của kỳ (hồ sơ không ghi nhóm = DEFAULT; mã so không phân biệt hoa thường);
	 *   - Grid.inPeriod: đang hoạt động hoặc nghỉ việc trong kỳ, và có làm ít nhất một ngày trong kỳ.
	 * @returns {{where: string, params: Array}}
	 */
	function profileScope(p, groups, groupCode) {
		const codeOf = (g) => norm(g.name) || "DEFAULT";
		const same = Object.keys(groups).filter((id) => codeOf(groups[id]) === groupCode);
		const others = Object.keys(groups).filter((id) => codeOf(groups[id]) !== groupCode);
		let group;
		if (groupCode === "DEFAULT") group = others.length ? `({paygroup} IS NULL OR {paygroup} NOT IN (${Lean.idList(others)}))` : "1 = 1";
		else group = `{paygroup} IN (${Lean.idList(same)})`;
		const where =
			`${group} AND (t.isinactive = 'F' OR ({termination_date} >= ${DATE} AND {termination_date} <= ${DATE})) ` +
			`AND ({hire_date} IS NULL OR {hire_date} <= ${DATE}) AND ({termination_date} IS NULL OR {termination_date} >= ${DATE})`;
		return { where, params: [p.start, p.end, p.end, p.start] };
	}

	/** Hồ sơ lương của lưới kèm mã, họ tên, phòng ban của nhân viên trong MỘT truy vấn (JOIN; không BUILTIN.DF từng dòng). */
	function profilesOf(scope, subsidiary) {
		const where = scope.where + (subsidiary ? " AND {subsidiary} = ?" : "");
		const params = scope.params.concat(subsidiary ? [subsidiary] : []);
		const emp = `LEFT JOIN employee e ON e.id = ${Lean.col("employee", "employee")}`;
		const names = ["e.entityid AS e_code", "e.firstname AS e_first", "e.lastname AS e_last"];
		const raw = ["e_code", "e_first", "e_last", "e_dept"];
		try {
			return Lean.select("employee", PROFILE_KEYS, { where, params, includeInactive: true, join: `${emp} LEFT JOIN department d ON d.id = e.department`, extra: names.concat(["d.fullname AS e_dept"]), raw, tag: "s4vp_att_profiles" });
		} catch (e) {
			// Vai trò không đọc được bảng department: lấy tên phòng ban bằng BUILTIN.DF
			return Lean.select("employee", PROFILE_KEYS, { where, params, includeInactive: true, join: emp, extra: names.concat(["BUILTIN.DF(e.department) AS e_dept"]), raw, tag: "s4vp_att_profiles_df" });
		}
	}

	/**
	 * Trạng thái các bảng lương của kỳ và số hồ sơ thuộc lưới nhưng ở công ty con khác - hai câu đếm gộp bằng UNION ALL.
	 * @returns {{statuses: string[], other: number}}
	 */
	function periodMeta(p, scope, subsidiary) {
		const b = Lean.rec("batch");
		const st = Lean.col("batch", "status");
		const batchSql = `SELECT 'B' AS k, ${st} AS v, COUNT(*) AS n FROM ${b.type} t WHERE ${Lean.col("batch", "period")} = ? AND t.isinactive = 'F' GROUP BY ${st}`;
		const otherSql = `SELECT 'O' AS k, 0 AS v, COUNT(*) AS n FROM ${Lean.rec("employee").type} t WHERE ${Lean.where("employee", scope.where)} AND (${Lean.col("employee", "subsidiary")} IS NULL OR ${Lean.col("employee", "subsidiary")} <> ?)`;
		const otherParams = scope.params.concat([subsidiary]);
		let rows;
		if (!subsidiary) rows = Store.run(batchSql, [p.id], "s4vp_att_batches");
		else {
			try {
				rows = Store.run(`${batchSql} UNION ALL ${otherSql}`, [p.id].concat(otherParams), "s4vp_att_meta");
			} catch (e) {
				rows = Store.run(batchSql, [p.id], "s4vp_att_batches").concat(Store.run(otherSql, otherParams, "s4vp_att_other"));
			}
		}
		const out = { statuses: [], other: 0 };
		for (const r of rows) {
			if (r.k === "O") out.other += Number(r.n) || 0;
			else if (Number(r.n) > 0) out.statuses.push(Store.codeOf("batch_status", r.v));
		}
		return out;
	}

	/** Câu đọc một loại chứng từ công của kỳ: cùng danh sách cột cho cả bốn loại (cột loại khác là NULL). */
	function docSql(type) {
		const d = DOCS[type];
		const def = Lean.rec(d.name);
		const from = Lean.col(d.name, d.from);
		const to = Lean.col(d.name, d.to);
		const cols = [`'${type}' AS kind`, "t.id AS id"].concat(Lean.cols(d.name, DOC_COMMON));
		cols.push(`TO_CHAR(${from}, 'YYYY-MM-DD') AS c_from`, `TO_CHAR(${to}, 'YYYY-MM-DD') AS c_to`, `SUBSTR(${Lean.col(d.name, d.reason)}, 1, 200) AS c_reason`);
		for (const k of DOC_SLOTS) cols.push(d.keys.indexOf(k) >= 0 ? `${Lean.col(d.name, k)} AS c_${k}` : `NULL AS c_${k}`);
		// Loại nghỉ của đơn nghỉ lấy ngay bằng JOIN (khỏi đọc cả danh mục loại nghỉ)
		const lt = type === "leave";
		cols.push(...(lt ? Lean.cols("leave_type", LEAVE_TYPE_KEYS, "lt", "lt_") : LEAVE_TYPE_KEYS.map((k) => `NULL AS lt_${k}`)));
		const join = lt ? ` LEFT JOIN ${Lean.rec("leave_type").type} lt ON lt.id = ${Lean.col(d.name, "leave_type")}` : "";
		return `SELECT ${cols.join(", ")} FROM ${def.type} t${join} WHERE t.isinactive = 'F' AND ${from} <= ${DATE} AND COALESCE(${to}, ${from}) >= ${DATE}`;
	}

	/**
	 * Chứng từ công giao kỳ của mọi nhân viên, cả bốn loại trong một truy vấn UNION ALL (lọc theo ngày; lưới tự bỏ chứng từ
	 * của nhân viên ngoài lưới). Trả các danh sách cùng tên trường với Store.find để core/AttendanceMonthGrid dùng nguyên, kèm
	 * bảng loại nghỉ của các đơn nghỉ.
	 */
	function periodDocs(p) {
		const types = Object.keys(DOCS);
		const one = [p.end, p.start];
		let rows;
		try {
			rows = Store.run(types.map(docSql).join(" UNION ALL "), types.reduce((all) => all.concat(one), []), "s4vp_att_docs");
		} catch (e) {
			rows = [];
			for (const type of types) rows = rows.concat(Store.run(docSql(type), one, `s4vp_att_docs_${type}`));
		}
		const out = { leave: [], trip: [], exception: [], ot: [], leaveTypes: {} };
		for (const r of rows) {
			const d = DOCS[r.kind];
			if (!d) continue;
			const o = Lean.row(d.name, DOC_COMMON, r, "c_", { id: String(r.id) });
			o.reason = r.c_reason || "";
			if (d.from === "work_date") o.work_date = r.c_from || null;
			else {
				o.from = r.c_from || null;
				o.to = r.c_to || null;
			}
			Lean.row(d.name, d.keys, r, "c_", o);
			if (r.kind === "leave" && !blank(o.leave_type) && !out.leaveTypes[o.leave_type]) {
				const t = Lean.row("leave_type", LEAVE_TYPE_KEYS, r, "lt_");
				out.leaveTypes[o.leave_type] = { code: norm(t.name), isPaid: t.is_paid, deductsWorkDays: t.deducts_days, paidBySocialInsurance: t.paid_by_si };
			}
			out[r.kind].push(o);
		}
		return out;
	}

	/** Chứng từ công gọn cho màn hình (không gửi trường thừa); bỏ chứng từ đã từ chối / đã hủy. */
	function docView(type, d, leaveTypes) {
		const out = { type, id: String(d.id), name: d.name || "", employee: d.employee, status: d.status || "H", reason: String(d.reason || d.purpose || "").slice(0, 200) };
		if (type === "leave") Object.assign(out, { from: d.from, to: d.to || d.from, days: d.days || 0, leaveType: (leaveTypes[d.leave_type] || {}).code || "", fromHalf: d.from_half || "A", toHalf: d.to_half || "P" });
		else if (type === "trip") Object.assign(out, { from: d.from, to: d.to || d.from, days: d.days || 0 });
		else if (type === "ot") Object.assign(out, { from: d.work_date, to: d.work_date, hours: d.hours || 0 });
		else Object.assign(out, { from: d.work_date, to: d.work_date, subtype: Grid.exceptionSubtype(d), minutes: d.minutes || 0, days: d.exception_type === "A" ? d.adjust_days || 0 : -(d.deduct_days || 0) });
		if (d.from_punches) out.fromPunches = true;
		if (d.summary_locked) out.locked = true;
		return out;
	}

	/** Toàn bộ dữ liệu màn Chấm công của một kỳ. */
	function month(params) {
		const subsidiary = blank(params.subsidiary) ? "" : String(params.subsidiary);
		const groups = paygroups();
		const p = blank(params.period) ? defaultPeriod(subsidiary, groups) : getPeriod(params.period);
		let tenant;
		try {
			tenant = Settings.tenant();
		} catch (e) {
			throw fail("VN Payroll preferences are missing. Run Load VN Defaults first.", "Chưa có thiết lập lương VN, hãy vào Thiết lập và chạy Nạp mặc định VN.");
		}
		const group = groups[p.paygroup] || {};
		const groupCode = norm(group.name || "DEFAULT");
		const mode = group.att_source === "S" ? "S" : "E";
		const period = { startDate: p.start, endDate: p.end, standardWorkDays: p.std_days || 0 };

		// Hồ sơ lương cùng nhóm lương của kỳ (trống = DEFAULT), có làm trong kỳ, của công ty con đang chọn: lọc trong SQL
		const scope = profileScope(p, groups, groupCode);
		const profiles = profilesOf(scope, subsidiary).filter((prof) => Grid.inPeriod({ hireDate: prof.hire_date, terminationDate: prof.termination_date, isInactive: prof.isInactive }, period));
		const meta = periodMeta(p, scope, subsidiary);
		const ids = profiles.map((x) => x.employee);
		const employees = profiles
			.map((prof) => ({
				employee: prof.employee, code: prof.e_code || "", name: [prof.e_last, prof.e_first].filter(Boolean).join(" ").trim() || prof.e_code || prof.name || "", department: prof.e_dept || "",
				employmentType: prof.employment_type || "E", salaryType: prof.salary_type || "M", hireDate: prof.hire_date || null, terminationDate: prof.termination_date || null, isInactive: !!prof.isInactive,
			}))
			.sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.employee).localeCompare(String(b.employee)));

		const symbols = Lean.select("att_symbol", ["name", "category", "days", "description"], { tag: "s4vp_att_symbols" }).map((s) => ({ code: String(s.name || "").trim(), category: s.category, days: Number(s.days) || 0, description: s.description || "" }));
		const holidays = Settings.holidays().map((h) => ({ date: h.date, name: h.name || "" }));

		// Chứng từ công giao kỳ: một truy vấn cho cả bốn loại, lọc theo ngày; chỉ giữ chứng từ của nhân viên trong lưới
		const inGrid = new Set(ids.map(String));
		const mine = (list) => list.filter((d) => inGrid.has(String(d.employee)));
		const docsOfPeriod = ids.length ? periodDocs(p) : { leave: [], trip: [], exception: [], ot: [], leaveTypes: {} };
		const leaveTypes = docsOfPeriod.leaveTypes;
		const leaves = mine(docsOfPeriod.leave);
		const trips = mine(docsOfPeriod.trip);
		const exceptions = mine(docsOfPeriod.exception);
		const overtime = mine(docsOfPeriod.ot);
		const summaries = ids.length ? Lean.select("attendance", SUMMARY_KEYS, { where: "{period} = ?", params: [p.id], tag: "s4vp_att_summaries" }) : [];
		const sheets = mode === "S" && ids.length ? Store.find("att_sheet", { where: "{period} = ?", params: [p.id] }).map((r) => ({ employee: r.employee, cells: Plan.sheetCells(r) })) : [];
		// Cộng tác viên ở nhóm nguồn E: giờ từ Time trong cửa sổ kết công của kỳ
		const window = TimeLines.windowOf(p);
		const contractors = mode === "E" ? employees.filter((e) => e.employmentType === "C").map((e) => e.employee) : [];
		let time = [];
		let timeUnavailable = false;
		if (contractors.length) {
			try {
				time = TimeLines.entries(contractors, window.from, window.to).map((t) => ({ employee: t.employee, date: t.date, hours: t.hours, approval: t.approval }));
			} catch (e) {
				// Account không bật Time Tracking (không có bảng timebill): lưới vẫn hiện, cộng tác viên không có giờ
				timeUnavailable = true;
			}
		}

		const grid = Grid.build({
			period, mode, weeklyOff: tenant.weekly_off, holidays, leaveTypes, symbols, employees, summaries, sheets, leaves, trips, exceptions, overtime, time,
			requireTimeApproval: tenant.time_approval !== false,
		});

		const batches = meta.statuses.map((status) => ({ status }));
		const other = meta.other;
		const packed = Grid.packRows(grid.rows);
		const hasBatch = batches.some((b) => b.status !== "V");
		const locked = (p.att_status || "O") === "L";
		const steps = RunSteps.attendanceSteps({ att_status: p.att_status || "O" }, { openExceptions: grid.counts.open, hasSummary: grid.hasSummary, hasBatch });

		const live = (d) => d.status !== "R" && d.status !== "C";
		const docs = []
			.concat(leaves.filter(live).map((d) => docView("leave", d, leaveTypes)))
			.concat(trips.filter(live).map((d) => docView("trip", d, leaveTypes)))
			.concat(exceptions.filter(live).map((d) => docView("exception", d, leaveTypes)))
			.concat(overtime.filter(live).map((d) => docView("ot", d, leaveTypes)));

		return {
			period: {
				id: p.id, code: p.name, start: p.start, end: p.end, status: p.status || "O", attStatus: p.att_status || "O", stdDays: p.std_days || 0, paygroup: p.paygroup || "",
				paygroupCode: groupCode, paygroupName: group.description || "", mode, timeFrom: window.from, timeTo: window.to,
			},
			locked,
			closed: p.status === "C",
			canEdit: canEdit(),
			// Mở khóa công bị chặn khi kỳ đã có bảng lương ghi sổ (kể cả đã đảo), như api/Attendance.unlockContext
			canUnlock: !batches.some((b) => b.status === "R" || b.status === "V"),
			hasBatch,
			hasSummary: grid.hasSummary,
			otherSubsidiaries: other,
			timeUnavailable,
			syncLimit: SYNC_LIMIT,
			steps,
			counts: grid.counts,
			stats: grid.stats,
			days: grid.days,
			// Lưới nén (Grid.packRows): rows[].cells là chỉ số vào cellRows, mỗi dãy là chỉ số vào cellTable; rows[].totals vào totalsTable
			cellTable: packed.cellTable,
			cellRows: packed.cellRows,
			totalsKeys: packed.totalsKeys,
			totalsTable: packed.totalsTable,
			rows: packed.rows,
			exceptions: grid.exceptions,
			legend: grid.legend,
			docs,
			symbols,
		};
	}

	/** Chi tiết của một nhân viên trong kỳ (nạp khi mở khung bên phải): lượt chấm, phân ca, giờ Time. */
	function employee(params) {
		const p = getPeriod(params.period);
		if (blank(params.employee)) throw fail("Employee is required", "Thiếu nhân viên");
		const id = [String(params.employee)];
		// Lượt chấm của ca đêm có thể rơi sang ngày kế: lấy rộng thêm một ngày mỗi đầu
		const lo = Dates.addDays(p.start, -1);
		const hi = Dates.addDays(p.end, 1);
		const punches = Store.findIn("punch", "employee", id, IN_RANGE("punch_date"), [lo, hi])
			.map((x) => ({ date: x.punch_date, time: String(x.punch_time || "").slice(11, 16), device: x.device || "", source: x.source || "" }))
			.sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)));
		const cells = Store.findIn("roster", "employee", id, IN_RANGE("work_date"), [p.start, p.end]);
		const shifts = {};
		if (cells.length) for (const s of Store.find("shift", { includeInactive: true })) shifts[s.id] = s;
		const roster = cells
			.map((c) => {
				const s = c.shift ? shifts[c.shift] || {} : {};
				return { date: c.work_date, shift: c.shift ? norm(s.name) : "", start: String(s.start_time || "").trim(), end: String(s.end_time || "").trim() };
			})
			.sort((a, b) => String(a.date).localeCompare(String(b.date)));
		const window = TimeLines.windowOf(p);
		let time = [];
		try {
			time = TimeLines.entries(id, window.from, window.to).map((t) => ({ date: t.date, hours: t.hours, approval: t.approval, projectName: t.projectName || "", taskName: t.taskName || "" }));
		} catch (e) {
			time = [];
		}
		return { punches, roster, time, window };
	}

	const routes = {
		get: {
			attendanceMonth: { roles: "all", run: month },
			attendanceEmployee: { roles: "all", run: employee },
		},
		post: {},
	};

	return { routes, month, employee };
});
