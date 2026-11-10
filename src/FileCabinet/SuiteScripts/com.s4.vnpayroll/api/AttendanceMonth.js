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
 *   cellTable: các dạng ô ngày khác nhau; rows[].cells là mảng chỉ số vào cellTable (Grid.pack, để phản hồi gọn với vài trăm nhân viên)
 *   docs: [{type, id, name, employee, from, to, status, days?, hours?, leaveType?, subtype?, minutes?, reason, fromPunches?}],
 *   symbols: [{code, category, days, description}] }
 * GET attendanceEmployee {period, employee} -> { punches: [{date, time, device, source}], roster: [{date, shift, start, end}],
 *   time: [{date, hours, approval, projectName, taskName}], window: {from, to} }   chi tiết nạp khi mở khung nhân viên
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Settings", "./TimeLines", "./Clock", "../core/Dates", "../core/RunSteps", "../core/RosterPlan", "../core/AttendanceMonthGrid"], (runtime, Store, Settings, TimeLines, Clock, Dates, RunSteps, Plan, Grid) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const DATE = "TO_DATE(?, 'YYYY-MM-DD')";
	const OVERLAP = `{from} <= ${DATE} AND {to} >= ${DATE}`;
	const IN_RANGE = (field) => `{${field}} >= ${DATE} AND {${field}} <= ${DATE}`;
	// Cùng ngưỡng với api/Attendance.SYNC_LIMIT: kỳ nhiều nhân viên hơn thì lập / khóa công chạy nền
	const SYNC_LIMIT = 150;
	const EDIT_ROLES = ["administrator", "customrole_s4vp_hr"];

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

	function getPeriod(id) {
		if (blank(id)) throw fail("Select a pay period", "Hãy chọn kỳ lương");
		const p = Store.get("period", id);
		if (!p) throw fail("Pay period not found", "Không tìm thấy kỳ lương");
		return p;
	}

	/**
	 * Kỳ mặc định khi màn hình chưa chọn kỳ (Grid.defaultPeriod): kỳ còn mở, chưa khóa công, gần hôm nay nhất, trong các kỳ
	 * của nhóm lương dùng cho công ty con đang chọn (nhóm không gắn công ty con dùng chung).
	 */
	function defaultPeriodId(subsidiary) {
		const groups = {};
		for (const g of Store.find("paygroup", { includeInactive: true })) groups[g.id] = g;
		const all = Store.find("period", { includeInactive: true }).map((p) => ({ id: p.id, start: p.start, end: p.end, status: p.status || "O", attStatus: p.att_status || "O", paygroup: p.paygroup }));
		const mine = all.filter((p) => {
			const sub = (groups[p.paygroup] || {}).subsidiary;
			return !subsidiary || blank(sub) || String(sub) === subsidiary;
		});
		const id = Grid.defaultPeriod(mine.length ? mine : all, Clock.today());
		if (!id) throw fail("No pay period yet. Generate pay periods in Setup first.", "Chưa có kỳ lương nào. Hãy sinh kỳ lương ở Thiết lập trước.");
		return id;
	}

	/** Mã, họ tên, phòng ban của nhân viên (một truy vấn mỗi 900 người). */
	function employeesInfo(ids) {
		const out = {};
		const list = [...new Set((ids || []).filter((x) => !blank(x)).map(String))];
		for (let i = 0; i < list.length; i += 900) {
			const chunk = list.slice(i, i + 900);
			const rows = Store.run(
				`SELECT e.id, e.entityid, e.firstname, e.lastname, BUILTIN.DF(e.department) AS deptname FROM employee e WHERE e.id IN (${chunk.map(() => "?").join(",")})`,
				chunk,
				"s4vp_attmonth_emp"
			);
			for (const r of rows) out[String(r.id)] = { code: r.entityid || "", name: [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || r.entityid || "", department: r.deptname || "" };
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
		const p = getPeriod(blank(params.period) ? defaultPeriodId(subsidiary) : params.period);
		let tenant;
		try {
			tenant = Settings.tenant();
		} catch (e) {
			throw fail("VN Payroll preferences are missing. Run Load VN Defaults first.", "Chưa có thiết lập lương VN, hãy vào Thiết lập và chạy Nạp mặc định VN.");
		}
		const groups = {};
		for (const g of Store.find("paygroup", { includeInactive: true })) groups[g.id] = g;
		const group = groups[p.paygroup] || {};
		const groupCode = norm(group.name || "DEFAULT");
		const mode = group.att_source === "S" ? "S" : "E";
		const period = { startDate: p.start, endDate: p.end, standardWorkDays: p.std_days || 0 };

		// Hồ sơ lương cùng nhóm lương của kỳ (trống = DEFAULT), có làm trong kỳ; lọc theo công ty con đang chọn
		let other = 0;
		const profiles = Store.find("employee", { includeInactive: true }).filter((prof) => {
			const code = prof.paygroup && groups[prof.paygroup] ? norm(groups[prof.paygroup].name) : "DEFAULT";
			if ((code || "DEFAULT") !== groupCode) return false;
			if (!Grid.inPeriod({ hireDate: prof.hire_date, terminationDate: prof.termination_date, isInactive: prof.isInactive }, period)) return false;
			if (subsidiary && String(prof.subsidiary || "") !== subsidiary) {
				other++;
				return false;
			}
			return true;
		});
		const ids = profiles.map((x) => x.employee);
		const info = employeesInfo(ids);
		const employees = profiles
			.map((prof) => ({
				employee: prof.employee, code: (info[prof.employee] || {}).code || "", name: (info[prof.employee] || {}).name || prof.name || "", department: (info[prof.employee] || {}).department || "",
				employmentType: prof.employment_type || "E", salaryType: prof.salary_type || "M", hireDate: prof.hire_date || null, terminationDate: prof.termination_date || null, isInactive: !!prof.isInactive,
			}))
			.sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.employee).localeCompare(String(b.employee)));

		const leaveTypes = {};
		for (const l of Store.find("leave_type", { includeInactive: true })) leaveTypes[l.id] = { code: norm(l.name), isPaid: l.is_paid, deductsWorkDays: l.deducts_days, paidBySocialInsurance: l.paid_by_si };
		const symbols = Store.find("att_symbol").map((s) => ({ code: String(s.name || "").trim(), category: s.category, days: Number(s.days) || 0, description: s.description || "" }));
		const holidays = Settings.holidays().map((h) => ({ date: h.date, name: h.name || "" }));

		// Mỗi loại chứng từ một truy vấn cho cả lô nhân viên, có điều kiện ngày trong SQL
		const leaves = Store.findIn("leave_request", "employee", ids, OVERLAP, [p.end, p.start]);
		const trips = Store.findIn("business_trip", "employee", ids, OVERLAP, [p.end, p.start]);
		const exceptions = Store.findIn("att_exception", "employee", ids, IN_RANGE("work_date"), [p.start, p.end]);
		const overtime = Store.findIn("ot_request", "employee", ids, IN_RANGE("work_date"), [p.start, p.end]);
		const summaries = ids.length ? Store.find("attendance", { where: "{period} = ?", params: [p.id] }) : [];
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

		const batches = Store.find("batch", { where: "{period} = ?", params: [p.id] });
		const packed = Grid.pack(grid.rows);
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
			// Ô ngày nén: rows[].cells là chỉ số vào cellTable (Grid.pack)
			cellTable: packed.cellTable,
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
