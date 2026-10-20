/**
 * Ca, mẫu xoay ca, phân ca (VP102050, VP102060, VP309000), dữ liệu chấm công và xử lý chấm công (VP310000, VP502000),
 * bảng công ký hiệu (VP311000) - đặc tả 3.2, 3.3. Logic khớp ca nằm ở core/ShiftMatcher, core/RosterPlan; ở đây chỉ
 * đọc ghi record theo lô (findIn) có điều kiện khoảng ngày trong SQL (không đọc toàn bộ lịch sử của nhân viên).
 *
 * Hệ thống chỉ đề xuất (Điều 127 BLLĐ cấm phạt tiền): chứng từ sinh từ chấm công luôn ở trạng thái Tạm giữ, chờ duyệt.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
	"./Store", "./Settings", "./Clock",
	"../core/Dates", "../core/Money", "../core/RosterPlan", "../core/ShiftMatcher", "../core/AttendanceSheetCalculator", "../core/AttendanceSummaryCalculator",
	"../core/AttendanceRuleEvaluator", "../core/WorkingDayCounter", "../core/TimeImport", "../core/EmploymentDays",
], (Store, Settings, Clock, Dates, Money, Plan, Matcher, Sheet, Summary, RuleEval, WorkingDays, TimeImport, EmploymentDays) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	// Xử lý đồng bộ trong RESTlet tối đa số nhân viên x ngày này; lớn hơn thì chạy nền
	const SYNC_CELLS = 3000;

	// Điều kiện ngày trong SQL (QC lượt 2 #11): tham số chuỗi 'YYYY-MM-DD'
	const DATE = "TO_DATE(?, 'YYYY-MM-DD')";
	const between = (field) => `{${field}} >= ${DATE} AND {${field}} <= ${DATE}`;
	const OVERLAP = `{from} <= ${DATE} AND {to} >= ${DATE}`;
	// Một lần nạp lượt chấm tối đa (governance RESTlet); file lớn chia nhiều lần
	const MAX_PUNCH_ROWS = 500;

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	// ------------------------------------------------------------------ danh mục

	/** Ca theo cấu trúc lõi; kèm id record. */
	function shifts() {
		return Store.find("shift", { includeInactive: true }).map((s) => ({
			id: s.id, code: norm(s.name), description: s.description, startTime: String(s.start_time || "").trim(), endTime: String(s.end_time || "").trim(),
			breakMinutes: Number(s.break_minutes) || 0, kind: s.kind || "D", lateGraceMinutes: Number(s.late_grace) || 0, earlyGraceMinutes: Number(s.early_grace) || 0,
			overtimeMinMinutes: blank(s.ot_min) ? 30 : Number(s.ot_min), isActive: !s.isInactive,
		}));
	}

	/** Mẫu xoay ca: cycle là mảng mã ca, ô trống = nghỉ. */
	function patterns() {
		return Store.find("shift_pattern", { includeInactive: true }).map((p) => ({
			id: p.id, code: norm(p.name), description: p.description, cycle: String(p.cycle || "").split(",").map((c) => (c.trim() === "" || c.trim() === "-" ? null : c.trim().toUpperCase())),
			isActive: !p.isInactive,
		}));
	}

	function periodsCore() {
		return Store.find("period", { includeInactive: true }).map((p) => ({ id: p.id, code: p.name, startDate: p.start, endDate: p.end, attendanceStatus: p.att_status || "O", status: p.status, paygroup: p.paygroup, standardWorkDays: p.std_days }));
	}

	function lockedIn(from, to, periods) {
		return Summary.lockedPeriodOverlap(from, to, periods || periodsCore());
	}

	function getPeriod(id) {
		const p = Store.get("period", id);
		if (!p) throw fail("Pay period not found", "Không tìm thấy kỳ lương");
		return p;
	}

	/** Hồ sơ lương thuộc nhóm lương của kỳ (trống = DEFAULT, 3.4 BUG-42/43). */
	function groupProfiles(period) {
		const names = {};
		for (const g of Store.find("paygroup", { includeInactive: true })) names[g.id] = norm(g.name);
		const code = names[period.paygroup] || "DEFAULT";
		return { code, group: Store.get("paygroup", period.paygroup), profiles: Store.find("employee", { includeInactive: true }).filter((p) => (p.paygroup ? names[p.paygroup] : "DEFAULT") === code) };
	}

	// ------------------------------------------------------------------ phân ca

	/**
	 * Sinh phân ca từ mẫu xoay ca cho tổ (VP309000 Generate from Pattern).
	 * @param {{team, pattern, anchor, from, to}} input team, pattern là internal id; anchor = ngày ứng với ngày 1 của chu kỳ
	 */
	function generateRoster(input) {
		const from = Dates.iso(input.from);
		const to = Dates.iso(input.to);
		if (!from || !to || Dates.cmp(to, from) < 0) throw fail("Invalid date range", "Khoảng ngày không hợp lệ");
		if (blank(input.team) || blank(input.pattern)) throw fail("Team and shift pattern are required", "Phải chọn tổ và mẫu xoay ca");
		const locked = lockedIn(from, to);
		if (locked) throw fail(`Attendance of period ${locked.code} is locked`, `Kỳ công ${locked.code} đã khóa`);
		const team = Store.get("team", input.team);
		if (!team) throw fail("Team not found", "Không tìm thấy tổ");
		const pattern = patterns().find((p) => p.id === String(input.pattern));
		if (!pattern) throw fail("Shift pattern not found", "Không tìm thấy mẫu xoay ca");
		const shiftByCode = {};
		for (const s of shifts()) shiftByCode[s.code] = s;
		for (const c of pattern.cycle) if (c && !shiftByCode[c]) throw fail(`Shift ${c} does not exist`, `Ca ${c} không tồn tại`);
		const members = Store.find("team_member", { where: "{team} = ?", params: [team.id] }).map((m) => ({ employee: m.employee, effectiveDate: m.effective, expirationDate: m.expiration }));
		if (!Plan.anyMember(members, from, to)) throw fail("The team has no member in the date range", "Tổ không có thành viên hiệu lực trong khoảng ngày");
		const generated = Plan.generate({ cycle: pattern.cycle, anchor: Dates.iso(input.anchor || from), from, to, members, location: team.location || "", workCenter: team.work_center || "", patternId: pattern.id });
		const shiftCodeById = {};
		for (const s of Object.values(shiftByCode)) shiftCodeById[s.id] = s.code;
		const existing = Store.findIn("roster", "employee", [...new Set(generated.map((g) => g.employee))], between("work_date"), [from, to])
			.filter((r) => Dates.within(r.work_date, from, to))
			.map((r) => ({ id: r.id, employee: r.employee, workDate: r.work_date, shiftCode: r.shift ? shiftCodeById[r.shift] || "" : "", source: r.source || "G", location: r.location || "", workCenter: r.work_center || "", patternId: r.pattern || "" }));
		const p = Plan.plan(existing, generated);
		const values = (g) => ({
			employee: g.employee, work_date: g.workDate, shift: g.shiftCode ? shiftByCode[g.shiftCode].id : null, source: "G", pattern: pattern.id,
			location: g.location || null, work_center: g.workCenter || null, key: Plan.key(g.employee, g.workDate),
		});
		for (const g of p.creates) Store.create("roster", values(g));
		for (const u of p.updates) Store.submit("roster", u.id, values(u.cell));
		return { created: p.creates.length, updated: p.updates.length, keptManual: p.kept, unchanged: p.unchanged };
	}

	/** Sửa tay một ô phân ca: ô chuyển nguồn M (giữ khi sinh lại). */
	function setRosterCell(employee, workDate, shiftId, location, workCenter) {
		const d = Dates.iso(workDate);
		const locked = lockedIn(d, d);
		if (locked) throw fail(`Attendance of period ${locked.code} is locked`, `Kỳ công ${locked.code} đã khóa`);
		const key = Plan.key(employee, d);
		const cur = Store.find("roster", { where: "{key} = ?", params: [key] })[0];
		const v = { employee, work_date: d, shift: shiftId || null, source: "M", location: location || null, work_center: workCenter || null, key };
		const id = cur ? (Store.submit("roster", cur.id, v), cur.id) : Store.create("roster", v);
		return { id };
	}

	function roster(employeeIds, from, to) {
		return Store.findIn("roster", "employee", employeeIds, between("work_date"), [Dates.iso(from), Dates.iso(to)]).filter((r) => Dates.within(r.work_date, from, to));
	}

	// ------------------------------------------------------------------ lượt chấm

	/**
	 * Nạp lượt chấm (VP310000): employee là internal id hoặc mã nhân viên (entityid).
	 * @param {Array<{employee, time, device}>} rows
	 * @param {'I'|'A'|'M'} [source] I tải file (mặc định), A API, M nhập tay
	 * @returns {{created, skipped, errors: string[]}}
	 */
	function importPunches(rows, source) {
		const src = ["I", "A", "M"].includes(source) ? source : "I";
		if ((rows || []).length > MAX_PUNCH_ROWS) {
			throw fail(`At most ${MAX_PUNCH_ROWS} punches per import (${rows.length} given); split the file`, `Mỗi lần nạp tối đa ${MAX_PUNCH_ROWS} lượt chấm (đang có ${rows.length}), hãy chia file`);
		}
		const parsed = (rows || []).map((r, i) => Object.assign({ line: i + 1 }, Plan.parsePunch(r)));
		const codes = [...new Set(parsed.filter((p) => !p.error).map((p) => p.employee))];
		const byCode = {};
		const ids = new Set();
		for (let i = 0; i < codes.length; i += 900) {
			const chunk = codes.slice(i, i + 900);
			const marks = chunk.map(() => "?").join(",");
			for (const e of Store.run(`SELECT id, entityid FROM employee WHERE entityid IN (${marks}) OR TO_CHAR(id) IN (${marks})`, chunk.concat(chunk), "s4vp_punch_emp")) {
				byCode[String(e.entityid).trim().toUpperCase()] = String(e.id);
				ids.add(String(e.id));
			}
		}
		const resolve = (v) => (ids.has(String(v)) ? String(v) : byCode[String(v).trim().toUpperCase()] || null);
		const periods = periodsCore();
		// Chống trùng: lượt chấm đã có của cùng nhân viên, cùng thời điểm
		const empIds = [...new Set(parsed.filter((p) => !p.error).map((p) => resolve(p.employee)).filter(Boolean))];
		const dates = parsed.filter((p) => !p.error && p.date).map((p) => p.date).sort();
		const seen = new Set(
			dates.length ? Store.findIn("punch", "employee", empIds, between("punch_date"), [dates[0], dates[dates.length - 1]]).map((x) => `${x.employee}|${x.punch_time}`) : []
		);
		let created = 0;
		let skipped = 0;
		const errors = [];
		for (const p of parsed) {
			if (p.error) {
				errors.push(`#${p.line}: ${p.error}`);
				continue;
			}
			const emp = resolve(p.employee);
			if (!emp) {
				errors.push(`#${p.line}: Employee ${p.employee} not found / Không tìm thấy nhân viên ${p.employee}`);
				continue;
			}
			const locked = lockedIn(p.date, p.date, periods);
			if (locked) {
				errors.push(`#${p.line}: attendance of period ${locked.code} is locked / Kỳ công ${locked.code} đã khóa`);
				continue;
			}
			const k = `${emp}|${p.time}`;
			if (seen.has(k)) {
				skipped++;
				continue;
			}
			seen.add(k);
			Store.create("punch", { employee: emp, punch_date: p.date, punch_time: p.time, device: p.device || "", source: src });
			created++;
		}
		return { created, skipped, errors };
	}

	// ------------------------------------------------------------------ xử lý chấm công

	/** Mọi ngày của chứng từ đã duyệt (đơn nghỉ mọi loại, công tác) cắt trong [from, to]: ngày "có lý do". */
	function excusedDays(employeeIds, from, to) {
		const out = [];
		for (const name of ["leave_request", "business_trip"]) {
			for (const d of Store.findIn(name, "employee", employeeIds, OVERLAP, [Dates.iso(to), Dates.iso(from)])) {
				if (d.status !== "A" || !d.from) continue;
				const s = Dates.max(d.from, from);
				const e = Dates.min(d.to || d.from, to);
				if (Dates.cmp(e, s) < 0) continue;
				for (const day of Dates.range(s, e)) out.push({ employee: d.employee, date: day });
			}
		}
		return out;
	}

	/**
	 * Process Punches (VP502000): khớp lượt chấm với phân ca của kỳ, sinh phiếu ngoại lệ và đơn OT đề xuất ở Tạm giữ.
	 * Chạy lại chỉ thay chứng từ Tạm giữ do lần trước sinh; chứng từ khác (kể cả nhập tay) không sinh trùng.
	 */
	function processPunches(periodId) {
		const period = getPeriod(periodId);
		if (period.status === "C") throw fail("The pay period is closed", "Kỳ lương đã đóng");
		if (period.att_status === "L") throw fail("Attendance of the period is locked", "Kỳ công đã khóa");
		const from = period.start;
		const to = period.end;
		const { profiles } = groupProfiles(period);
		const prof = {};
		for (const p of profiles) prof[p.employee] = p;
		const empIds = Object.keys(prof);
		const days = Dates.diff(from, to) + 1;
		if (empIds.length * days > SYNC_CELLS) {
			throw fail(`Too many employees x days (${empIds.length} x ${days}); run punch processing in the background`, `Quá nhiều nhân viên x ngày (${empIds.length} x ${days}), cần chạy xử lý chấm công nền`);
		}
		const inPeriod = (d) => d.work_date && Dates.within(d.work_date, from, to);

		// 1. Xóa chứng từ Tạm giữ do lần chạy trước sinh; phần còn lại (khác Từ chối / Hủy) là "đã giữ"
		const kept = [];
		let deleted = 0;
		for (const [name, kind] of [["att_exception", "exception"], ["ot_request", "overtime"]]) {
			for (const d of Store.findIn(name, "employee", empIds, between("work_date"), [from, to]).filter(inPeriod)) {
				if (d.from_punches && (d.status || "H") === "H") {
					Store.remove(name, d.id);
					deleted++;
				} else if (!["R", "C"].includes(d.status)) {
					kept.push({ employee: d.employee, workDate: d.work_date, kind, exceptionType: d.exception_type });
				}
			}
		}

		// 2. Khớp ca
		const shiftList = shifts();
		const shiftCodeById = {};
		for (const s of shiftList) shiftCodeById[s.id] = s.code;
		const rosterCells = roster(empIds, from, to).map((r) => ({ employee: r.employee, workDate: r.work_date, shiftCode: r.shift ? shiftCodeById[r.shift] || null : null }));
		const lo = Dates.addDays(from, -1);
		const hi = Dates.addDays(to, 2);
		const punches = Store.findIn("punch", "employee", empIds, between("punch_date"), [lo, hi]).filter((p) => Dates.within(p.punch_date, lo, hi)).map((p) => ({ employee: p.employee, time: p.punch_time }));
		const results = Matcher.match({ roster: rosterCells, shifts: shiftList, punches, excused: excusedDays(empIds, from, to), from, to });
		const proposal = Matcher.processPunches(results, { startDate: from, endDate: to, shifts: shiftList, kept });

		// 3. Sinh chứng từ Tạm giữ
		const rules = Store.find("att_rule").map((r) => ({ minutesFrom: r.min_from, minutesTo: blank(r.min_to) ? null : r.min_to, deductDays: r.deduct }));
		const holidays = Settings.holidays().map((h) => h.date);
		const ets = Settings.earningTypes();
		const reasonVi = "Từ dữ liệu chấm công (hệ thống đề xuất, chờ duyệt)";
		const weeklyOffOf = {};
		for (const x of proposal.exceptions) {
			const p = prof[x.employee] || {};
			const isAdj = x.exceptionType === "A";
			Store.create("att_exception", {
				employee: x.employee, subsidiary: p.subsidiary || null, work_date: x.workDate, exception_type: x.exceptionType, minutes: isAdj ? 0 : x.minutes,
				deduct_days: isAdj ? 0 : Number(RuleEval.deductDays(x.minutes, rules)), adjust_days: isAdj ? x.adjustDays : 0, reason: reasonVi, from_punches: true,
				status: "H", summary_locked: false, period: period.id,
			});
		}
		for (const o of proposal.overtime) {
			const p = prof[o.employee] || {};
			if (!weeklyOffOf[p.subsidiary || ""]) weeklyOffOf[p.subsidiary || ""] = Settings.resolve(p.subsidiary || null, Store.get("paygroup", period.paygroup)).weeklyOffDays;
			const dayType = WorkingDays.dayType(o.workDate, weeklyOffOf[p.subsidiary || ""], holidays);
			const code = TimeImport.defaultOvertimeEarningType(ets.list, dayType, o.isNight);
			Store.create("ot_request", {
				employee: o.employee, subsidiary: p.subsidiary || null, work_date: o.workDate, day_type: dayType, hours: o.hours, is_night: !!o.isNight,
				earning_type: code && ets.byCode[code] ? ets.byCode[code].id : null, reason: reasonVi, from_punches: true, status: "H", summary_locked: false, period: period.id,
			});
		}
		const counts = {};
		for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
		return { period: period.name, employees: empIds.length, deleted, exceptions: proposal.exceptions.length, overtime: proposal.overtime.length, kept: proposal.kept, results: counts, processedOn: Clock.today() };
	}

	// ------------------------------------------------------------------ bảng công ký hiệu

	function symbols() {
		return Store.find("att_symbol").map((s) => ({ code: String(s.name).trim(), category: s.category, days: s.days }));
	}

	function sheetRows(periodId) {
		return Store.find("att_sheet", { where: "{period} = ?", params: [periodId] });
	}

	/** Load Employees (VP311000): nhân viên hoạt động cùng nhóm lương (nguồn công S), làm việc trong kỳ, chưa có dòng. */
	function loadSheetEmployees(periodId) {
		const period = getPeriod(periodId);
		if (period.att_status === "L") throw fail("Attendance of the period is locked", "Kỳ công đã khóa");
		const { group, profiles } = groupProfiles(period);
		if (!group || group.att_source !== "S") throw fail("The pay group does not use an attendance sheet", "Nhóm lương của kỳ không dùng bảng công ký hiệu");
		const have = new Set(sheetRows(periodId).map((r) => r.employee));
		const added = [];
		for (const p of profiles) {
			if (p.isInactive || have.has(p.employee)) continue;
			if (!EmploymentDays.employedIn(p.hire_date, p.termination_date, period.start, period.end)) continue;
			Store.create("att_sheet", { period: periodId, employee: p.employee });
			added.push(p.employee);
		}
		if (!added.length && !have.size) throw fail("No employee to load", "Không có nhân viên nào để nạp");
		return { added };
	}

	/**
	 * Lưu một dòng bảng công: cells[0..30] là ngày thứ 1..31 tính từ đầu kỳ (không phải ngày dương lịch).
	 * @returns {{id, totals, warnings}}
	 */
	function saveSheet(periodId, employee, cells) {
		const period = getPeriod(periodId);
		if (period.att_status === "L") throw fail("Attendance of the period is locked", "Kỳ công đã khóa");
		if (blank(employee)) throw fail("Employee is required", "Thiếu nhân viên");
		const len = Dates.diff(period.start, period.end) + 1;
		const list = [];
		for (let i = 0; i < 31; i++) list.push(i < len && cells && cells[i] !== undefined && cells[i] !== null ? String(cells[i]).trim() : "");
		const t = Sheet.total(list, symbols());
		const values = { period: periodId, employee };
		list.forEach((c, i) => (values[Plan.cellKey(i + 1)] = c));
		Object.assign(values, {
			worked: Money.num(t.workedDays), paid_leave: Money.num(t.paidLeaveDays), unpaid_leave: Money.num(t.unpaidLeaveDays), si_leave: Money.num(t.socialInsuranceLeaveDays),
			trip: Money.num(t.businessTripDays), paid_days: Money.num(t.paidDays), warnings: Sheet.warnings(t.unknownCodes) || "",
		});
		const cur = sheetRows(periodId).find((r) => r.employee === String(employee));
		const id = cur ? (Store.update("att_sheet", cur.id, values), cur.id) : Store.create("att_sheet", values);
		return { id, totals: values, warnings: values.warnings };
	}

	/**
	 * Số liệu bảng tổng hợp công cho nhóm nguồn S (3.2 "Chuyển vào bảng tổng hợp công"), để Attendance.build ghi.
	 * @param {string} periodId
	 * @param {string[]} [employeeIds] nhân viên do Build xác định; trống = mọi dòng bảng công của kỳ
	 * @returns {Array<{employee, values: {std_days, paid_leave, unpaid_leave, si_leave, trip_days, late_days, adjust_days, work_days, ot_hours}}>}
	 */
	function sheetSummaries(periodId, employeeIds) {
		const period = getPeriod(periodId);
		const rows = {};
		for (const r of sheetRows(periodId)) rows[r.employee] = r;
		const ids = employeeIds && employeeIds.length ? employeeIds.map(String) : Object.keys(rows);
		const prof = {};
		for (const p of Store.findIn("employee", "employee", ids)) prof[p.employee] = p;
		const syms = symbols();
		// Lịch nghỉ tuần của bảng công: thiết lập chung (đặc tả 3.11 #1)
		const weeklyOff = Settings.tenant().weekly_off;
		const holidays = Settings.holidays().map((h) => h.date);
		const ot = {};
		for (const o of Store.findIn("ot_request", "employee", ids, between("work_date"), [period.start, period.end])) {
			if (o.status !== "A" || !Dates.within(o.work_date, period.start, period.end)) continue;
			(ot[o.employee] = ot[o.employee] || []).push({ refNbr: o.name, workDate: o.work_date, hours: o.hours || 0, earningType: o.earning_type || "" });
		}
		return ids.map((e) => {
			const row = rows[e];
			const totals = row ? Sheet.total(Plan.sheetCells(row), syms) : null;
			const p = prof[e] || {};
			const r = Summary.buildSheet({
				period: { startDate: period.start, endDate: period.end, standardWorkDays: period.std_days || 0 },
				employee: { hireDate: p.hire_date || null, terminationDate: p.termination_date || null }, weeklyOff, holidays, sheetTotals: totals, overtime: ot[e] || [],
			});
			return {
				employee: e,
				values: {
					std_days: r.standardDays, paid_leave: r.paidLeaveDays, unpaid_leave: r.unpaidLeaveDays, si_leave: r.socialInsuranceLeaveDays, trip_days: r.businessTripDays,
					late_days: r.lateEarlyDays, adjust_days: r.adjustmentDays, work_days: r.workDays, ot_hours: r.overtimeHours,
				},
				lines: r.lines,
			};
		});
	}

	return { shifts, patterns, generateRoster, setRosterCell, roster, importPunches, processPunches, loadSheetEmployees, saveSheet, sheetSummaries, symbols };
});
