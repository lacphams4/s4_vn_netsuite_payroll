/**
 * Chấm công và nghỉ phép trên NetSuite (đặc tả 3.1, 3.4, 3.5, 3.6): chứng từ đơn nghỉ, đơn OT, đơn công tác, phiếu
 * ngoại lệ (submit / approve / reject / cancel), lập và khóa bảng tổng hợp công theo kỳ, sổ phép (cấp phép năm,
 * chuyển phép, hết hạn, điều chỉnh, số dư).
 *
 * Lịch nghỉ tuần dùng thiết lập chung (VP101000) như bản Acumatica (3.11 #1). Kỳ công khóa chặn Submit / Approve /
 * Cancel chứng từ giao kỳ; Reject không kiểm tra. Đính kèm của đơn nghỉ (RequiresAttachment) chưa kiểm được trên
 * custom record: chỉ cảnh báo (ghi trong danh sách khác biệt đã chấp nhận).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
	"N/runtime", "./Store", "./Settings", "./Advances",
	"../core/Dates", "../core/Money", "../core/AttendanceDocRules", "../core/AttendanceSummaryCalculator", "../core/EmploymentDays",
	"../core/LeaveLedger", "../core/LeaveAccrualCalculator",
], (runtime, Store, Settings, Advances, Dates, Money, Rules, Summary, EmploymentDays, Ledger, Accrual) => {
	const RECORD = { leave: "leave_request", ot: "ot_request", trip: "business_trip", exception: "att_exception" };
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function failList(errors) {
		return fail(errors.map((e) => e.message).join(" "), errors.map((e) => e.messageVi).join(" "));
	}

	function recName(type) {
		const r = RECORD[type];
		if (!r) throw fail(`Unknown document type ${type}`, `Loại chứng từ ${type} không hợp lệ`);
		return r;
	}

	// ------------------------------------------------------------------ dữ liệu tham chiếu

	function reference() {
		const tenant = Settings.tenant();
		const leaveTypes = {};
		for (const l of Store.find("leave_type", { includeInactive: true })) {
			leaveTypes[l.id] = {
				id: l.id, code: norm(l.name), isPaid: l.is_paid, deductsWorkDays: l.deducts_days, paidBySocialInsurance: l.paid_by_si, usesBalance: l.uses_balance,
				requiresAttachment: l.requires_attachment, allowHalfDay: l.allow_half !== false, maxDaysPerRequest: l.max_days || 0,
			};
		}
		const periods = Store.find("period", { includeInactive: true }).map((p) => ({ id: p.id, code: p.name, paygroup: p.paygroup, startDate: p.start, endDate: p.end, standardWorkDays: p.std_days, attendanceStatus: p.att_status || "O" }));
		return {
			tenant,
			weeklyOff: tenant.weekly_off,
			holidays: Settings.holidays().map((h) => h.date),
			leaveTypes,
			earningTypes: Settings.earningTypes(),
			periods,
			rules: Store.find("att_rule").map((r) => ({ minutesFrom: r.min_from, minutesTo: r.min_to, deductDays: r.deduct })),
		};
	}

	function docToCore(type, d) {
		if (type === "leave") return { from: d.from, to: d.to, fromHalf: d.from_half, toHalf: d.to_half };
		if (type === "trip") return { from: d.from, to: d.to };
		return { workDate: d.work_date };
	}

	function lockedOverlap(ref, range) {
		return Summary.lockedPeriodOverlap(range.from, range.to, ref.periods);
	}

	function currentEmployee() {
		const u = runtime.getCurrentUser();
		return u && Number(u.id) > 0 ? String(u.id) : null;
	}

	// ------------------------------------------------------------------ trường tính sẵn (dùng chung cho User Event)

	/**
	 * Tính trường suy ra khi lưu ở trạng thái Tạm giữ: số ngày, loại ngày, loại thu nhập OT, ngày bị trừ, kỳ.
	 * @param {string} type leave | ot | trip | exception
	 * @param {Object} values giá trị record (tên logic)
	 * @returns {{values: Object, warnings: Array}} giá trị cần ghi thêm
	 */
	function derive(type, values, ref) {
		const r = ref || reference();
		const out = {};
		let warnings = [];
		if (type === "leave") {
			const lt = r.leaveTypes[values.leave_type];
			const n = Rules.normalizeLeave({ from: values.from, to: values.to, fromHalf: values.from_half, toHalf: values.to_half }, lt, r.weeklyOff, r.holidays);
			Object.assign(out, { to: n.to, from_half: n.fromHalf, to_half: n.toHalf, days: n.days });
			if (lt && lt.usesBalance) {
				const avail = available(values.employee, lt.id, Dates.year(values.from));
				if (n.days > avail) warnings.push({ code: "BALANCE", message: `The request exceeds the available balance (${avail}).`, messageVi: `Số ngày vượt số dư phép (còn ${avail}).` });
			}
		} else if (type === "trip") {
			const t = Rules.tripDays({ from: values.from, to: values.to }, r.weeklyOff, r.holidays);
			Object.assign(out, { to: t.to, days: t.days });
		} else if (type === "ot") {
			const others = otherOvertimeHours(values.employee, values.work_date, values.id);
			const prep = Rules.prepareOvertime({ workDate: values.work_date, hours: values.hours, isNight: values.is_night, earningType: etCode(r, values.earning_type) }, r.weeklyOff, r.holidays, r.earningTypes.list, others, false);
			out.day_type = prep.dayType;
			if (blank(values.earning_type) && prep.earningType && r.earningTypes.byCode[prep.earningType]) out.earning_type = r.earningTypes.byCode[prep.earningType].id;
			warnings = warnings.concat(prep.errors, prep.warnings);
		} else if (type === "exception") {
			const prep = Rules.prepareException({ exceptionType: values.exception_type, minutes: values.minutes, adjustDays: values.adjust_days, reason: values.reason }, r.rules, false);
			Object.assign(out, { minutes: prep.minutes, deduct_days: prep.deductDays, adjust_days: prep.adjustDays });
		}
		const range = Rules.range(type, Object.assign(docToCore(type, values), out.to ? { to: out.to } : {}));
		const p = Rules.periodOf(range.from, r.periods);
		out.period = p ? p.id : null;
		if (!p) warnings.push({ code: "PERIOD", message: "No pay period contains the document date.", messageVi: "Chưa có kỳ lương chứa ngày của chứng từ." });
		return { values: out, warnings };
	}

	function etCode(ref, id) {
		return id && ref.earningTypes.byId[id] ? ref.earningTypes.byId[id].code : "";
	}

	function otherOvertimeHours(employee, workDate, selfId) {
		if (!employee || !workDate) return 0;
		return Store.find("ot_request", { where: "{employee} = ? AND {work_date} = TO_DATE(?, 'YYYY-MM-DD')", params: [employee, Dates.iso(workDate)] })
			.filter((o) => o.id !== String(selfId || "") && (o.status === "P" || o.status === "A"))
			.reduce((s, o) => s + (o.hours || 0), 0);
	}

	/** Tạo / sửa chứng từ ở trạng thái Tạm giữ (SPA). */
	function save(type, values) {
		const name = recName(type);
		const v = Object.assign({}, values);
		const id = v.id;
		delete v.id;
		if (id) {
			const cur = Store.get(name, id);
			if (!cur) throw fail("Document not found", "Không tìm thấy chứng từ");
			if (cur.status !== "H" || cur.summary_locked) throw fail("Only on-hold documents can be edited", "Chỉ sửa được chứng từ đang tạm giữ");
		}
		if (blank(v.employee)) v.employee = currentEmployee();
		const base = id ? Object.assign(Store.get(name, id), v) : v;
		const d = derive(type, base);
		const all = Object.assign(v, d.values, id ? {} : { status: "H", summary_locked: false });
		const newId = id ? (Store.update(name, id, all), id) : Store.create(name, all);
		return { id: newId, warnings: d.warnings };
	}

	// ------------------------------------------------------------------ duyệt

	/**
	 * Submit / approve / reject / cancel (3.4).
	 * @param {string} type leave | ot | trip | exception
	 * @param {string} id
	 * @param {string} action submit | approve | reject | cancel
	 * @param {{rejectReason?: string}} [extra]
	 */
	function act(type, id, action, extra = {}) {
		const name = recName(type);
		const doc = Store.get(name, id);
		if (!doc) throw fail("Document not found", "Không tìm thấy chứng từ");
		const to = Rules.nextStatus(doc.status || "H", action);
		if (!to) throw fail(`Action ${action} is not allowed in status ${doc.status}`, `Không thực hiện được ${action} ở trạng thái ${doc.status}`);
		const ref = reference();
		const range = Rules.range(type, docToCore(type, doc));
		if (action !== "reject") {
			const locked = lockedOverlap(ref, range);
			if (locked) throw fail(`Attendance of period ${locked.code || locked.id} is locked`, `Kỳ công ${locked.code || locked.id} đã khóa`);
		}
		if (action === "cancel" && doc.summary_locked) throw fail("The document is locked by an attendance summary", "Chứng từ đã khóa theo kỳ công");
		const me = currentEmployee();
		if ((action === "approve" || action === "reject") && Rules.selfApproval(me, doc.employee)) throw fail("You cannot approve or reject your own request", "Không được tự duyệt đơn của chính mình");
		const warnings = [];
		const update = { status: to };

		if (action === "submit") Object.assign(update, validateSubmit(type, doc, ref, warnings));
		if (type === "leave") applyLeaveBalance(doc, action, ref, update);
		if (type === "trip") applyTripAdvance(doc, action, update);
		if (action === "approve") Object.assign(update, { approved_by: me, approved_date: Dates.iso(new Date()) });
		if (action === "reject") update.reject_reason = String(extra.rejectReason || doc.reject_reason || "").slice(0, 300);
		Store.submit(name, id, update);
		return { id, status: to, warnings };
	}

	function validateSubmit(type, doc, ref, warnings) {
		const d = derive(type, doc, ref);
		const v = d.values;
		if (type === "leave") {
			const lt = ref.leaveTypes[doc.leave_type];
			const days = v.days;
			const avail = lt && lt.usesBalance ? available(doc.employee, lt.id, Dates.year(doc.from)) : null;
			const others = Store.find("leave_request", { where: "{employee} = ? AND {id} <> ?", params: [doc.employee, doc.id] }).map((o) => ({ fromDate: o.from, toDate: o.to, status: o.status }));
			// Đính kèm chưa kiểm được trên custom record: coi như có, cảnh báo cho người duyệt
			const errs = Ledger.validateSubmit({ fromDate: doc.from, toDate: v.to, days, hasAttachment: true }, lt, avail, others);
			if (errs.length) throw failList(errs);
			if (lt && lt.requiresAttachment) warnings.push({ code: "ATTACHMENT", message: "This leave type requires a supporting document; check the attachment.", messageVi: "Loại nghỉ này cần chứng từ đính kèm, người duyệt kiểm tra file đính kèm." });
		} else if (type === "ot") {
			const prep = Rules.prepareOvertime({ workDate: doc.work_date, hours: doc.hours, isNight: doc.is_night, earningType: etCode(ref, doc.earning_type) }, ref.weeklyOff, ref.holidays, ref.earningTypes.list, otherOvertimeHours(doc.employee, doc.work_date, doc.id), true);
			if (prep.errors.length) throw failList(prep.errors);
		} else if (type === "trip") {
			const others = Store.find("business_trip", { where: "{employee} = ? AND {id} <> ?", params: [doc.employee, doc.id] }).map((o) => ({ fromDate: o.from, toDate: o.to, status: o.status }))
				.concat(Store.find("leave_request", { where: "{employee} = ?", params: [doc.employee] }).map((o) => ({ fromDate: o.from, toDate: o.to, status: o.status })));
			const errs = Rules.tripErrors({ from: doc.from, to: v.to }, v.days, others);
			if (errs.length) throw failList(errs);
		} else if (type === "exception") {
			const prep = Rules.prepareException({ exceptionType: doc.exception_type, minutes: doc.minutes, adjustDays: doc.adjust_days, reason: doc.reason }, ref.rules, true);
			if (prep.errors.length) throw failList(prep.errors);
			if (!Rules.periodOf(doc.work_date, ref.periods)) throw fail("No pay period contains the work date", "Chưa có kỳ lương chứa ngày của phiếu");
		}
		warnings.push(...d.warnings.filter((w) => w.code !== "BALANCE"));
		return v;
	}

	/** Giữ chỗ / dùng / hoàn số dư phép (3.4, 3.6); năm của số dư là năm FromDate. */
	function applyLeaveBalance(doc, action, ref, update) {
		const lt = ref.leaveTypes[doc.leave_type];
		if (!lt || !lt.usesBalance) return;
		const days = update.days !== undefined ? update.days : doc.days || 0;
		const year = Dates.year(doc.from);
		const rec = balanceRecord(doc.employee, lt.id, year);
		let b = toBalance(rec);
		let tran = null;
		if (action === "submit") b = Ledger.submit(b, days);
		else if (action === "approve") ({ balance: b, transaction: tran } = Ledger.approve(b, days));
		else if (action === "reject") b = Ledger.reject(b, days);
		else if (action === "cancel") ({ balance: b, transaction: tran } = Ledger.cancel(b, days, doc.status));
		saveBalance(rec, b);
		if (tran) writeTran(doc.employee, lt.id, year, action === "cancel" ? Dates.iso(new Date()) : doc.from, tran, doc.name || doc.id, action);
	}

	/** Duyệt đơn công tác có tạm ứng: tạo phiếu tạm ứng Tạm giữ; hủy: phiếu đã ghi sổ thì chặn, chưa thì xóa. */
	function applyTripAdvance(doc, action, update) {
		if (action === "approve" && (doc.advance_amount || 0) > 0 && !doc.advance) {
			update.advance = Advances.create({ subsidiary: doc.subsidiary, employee: doc.employee, docDate: doc.from, amount: doc.advance_amount, project: doc.project, memo: `Business trip / Công tác ${doc.name || doc.id}` });
		}
		if (action === "cancel" && doc.advance) {
			const a = Store.get("advance", doc.advance);
			if (a && !["H", "B"].includes(a.status)) throw fail("The trip advance is already released", "Phiếu tạm ứng của đơn công tác đã ghi sổ");
			if (a) Store.remove("advance", a.id);
			update.advance = null;
		}
	}

	// ------------------------------------------------------------------ bảng tổng hợp công

	const approvedIn = (name, where, params) => Store.find(name, { where, params }).filter((d) => d.status === "A");

	/** Lập lại bảng tổng hợp công của kỳ (3.5 Build, nhóm nguồn chứng từ ngoại lệ). */
	function build(periodId) {
		const ref = reference();
		const period = ref.periods.find((p) => p.id === String(periodId));
		if (!period) throw fail("Pay period not found", "Không tìm thấy kỳ lương");
		if (period.attendanceStatus === "L") throw fail("Attendance of the period is locked", "Kỳ công đã khóa");
		const group = Store.get("paygroup", period.paygroup) || {};
		if (group.att_source === "S") throw fail("Attendance sheets are not supported yet; enter the summary directly", "Chưa hỗ trợ bảng công ký hiệu, hãy nhập bảng tổng hợp công trực tiếp");
		const groupCode = norm(group.name || "DEFAULT");
		const groups = {};
		for (const g of Store.find("paygroup", { includeInactive: true })) groups[g.id] = norm(g.name);
		const ps = period.startDate;
		const pe = period.endDate;
		const overlap = "{from} <= TO_DATE(?, 'YYYY-MM-DD') AND {to} >= TO_DATE(?, 'YYYY-MM-DD')";
		const inPeriod = "{work_date} >= TO_DATE(?, 'YYYY-MM-DD') AND {work_date} <= TO_DATE(?, 'YYYY-MM-DD')";
		const by = (rows) => rows.reduce((m, r) => ((m[r.employee] = m[r.employee] || []).push(r), m), {});
		const leaves = by(approvedIn("leave_request", overlap, [pe, ps]));
		const trips = by(approvedIn("business_trip", overlap, [pe, ps]));
		const exceptions = by(approvedIn("att_exception", inPeriod, [ps, pe]));
		const overtime = by(approvedIn("ot_request", inPeriod, [ps, pe]));
		for (const old of Store.find("attendance", { where: "{period} = ?", params: [period.id], includeInactive: true })) Store.remove("attendance", old.id);
		const created = [];
		for (const prof of Store.find("employee", { includeInactive: true })) {
			const g = prof.paygroup ? groups[prof.paygroup] : "DEFAULT";
			if ((g || "DEFAULT") !== groupCode) continue;
			if (!(!prof.isInactive || EmploymentDays.terminatesIn(prof.termination_date, ps, pe))) continue;
			if (!EmploymentDays.employedIn(prof.hire_date, prof.termination_date, ps, pe)) continue;
			// CTV chỉ vào bảng công khi thuộc tổ (chưa có tổ trên NetSuite) hoặc nhóm dùng bảng công ký hiệu (BUG-51, BUG-54)
			if (!EmploymentDays.inAttendanceSummary(prof.employment_type === "C", false, false)) continue;
			const e = prof.employee;
			const t = Summary.buildExceptions({
				period: { startDate: ps, endDate: pe, standardWorkDays: period.standardWorkDays || 0 },
				employee: { hireDate: prof.hire_date, terminationDate: prof.termination_date },
				weeklyOff: ref.weeklyOff,
				holidays: ref.holidays,
				leaveRequests: (leaves[e] || []).map((l) => ({ refNbr: l.name, fromDate: l.from, toDate: l.to, fromHalf: l.from_half || "A", toHalf: l.to_half || "P", leaveType: ref.leaveTypes[l.leave_type] || {} })),
				trips: (trips[e] || []).map((x) => ({ refNbr: x.name, fromDate: x.from, toDate: x.to })),
				exceptions: (exceptions[e] || []).map((x) => ({ refNbr: x.name, workDate: x.work_date, exceptionType: x.exception_type, deductDays: x.deduct_days || 0, adjustDays: x.adjust_days || 0 })),
				overtime: (overtime[e] || []).map((o) => ({ refNbr: o.name, workDate: o.work_date, hours: o.hours || 0, earningType: etCode(ref, o.earning_type) })),
			});
			Store.create("attendance", {
				period: period.id, employee: e, std_days: t.standardDays, paid_leave: t.paidLeaveDays, unpaid_leave: t.unpaidLeaveDays, si_leave: t.socialInsuranceLeaveDays,
				trip_days: t.businessTripDays, late_days: t.lateEarlyDays, adjust_days: t.adjustmentDays, work_days: t.workDays, ot_hours: t.overtimeHours,
				late_count: (exceptions[e] || []).filter((x) => x.exception_type === "L" || x.exception_type === "E").length, status: "O", key: `${period.id}|${e}`,
			});
			created.push(e);
		}
		return { period: period.code, employees: created.length };
	}

	function setSummaryLocked(period, value, otherLocked) {
		const ps = period.startDate;
		const pe = period.endDate;
		const overlap = "{from} <= TO_DATE(?, 'YYYY-MM-DD') AND {to} >= TO_DATE(?, 'YYYY-MM-DD')";
		const inPeriod = "{work_date} >= TO_DATE(?, 'YYYY-MM-DD') AND {work_date} <= TO_DATE(?, 'YYYY-MM-DD')";
		for (const [name, where, params, ranged] of [["leave_request", overlap, [pe, ps], true], ["business_trip", overlap, [pe, ps], true], ["att_exception", inPeriod, [ps, pe], false], ["ot_request", inPeriod, [ps, pe], false]]) {
			for (const d of Store.find(name, { where, params })) {
				if (value && d.status !== "A") continue;
				if (!!d.summary_locked === value) continue;
				// Mở khóa: đơn nghỉ, công tác chỉ gỡ khi không còn giao kỳ công khóa khác
				if (!value && ranged && Summary.lockedPeriodOverlap(d.from, d.to, otherLocked)) continue;
				Store.submit(name, d.id, { summary_locked: value });
			}
		}
	}

	/** Khóa công: lập lại ngay trước khi khóa, khóa dòng tổng hợp, kỳ, chứng từ nguồn. */
	function lock(periodId) {
		const ref = reference();
		const period = ref.periods.find((p) => p.id === String(periodId));
		if (!period) throw fail("Pay period not found", "Không tìm thấy kỳ lương");
		if (period.attendanceStatus === "L") return { locked: true, rebuilt: false };
		const r = build(periodId);
		for (const a of Store.find("attendance", { where: "{period} = ?", params: [period.id] })) Store.submit("attendance", a.id, { status: "L" });
		Store.submit("period", period.id, { att_status: "L" });
		setSummaryLocked(period, true, []);
		return { locked: true, rebuilt: true, employees: r.employees };
	}

	/** Mở khóa công: chặn khi kỳ có bảng lương đã ghi sổ (kể cả đã đảo, 3.11 #5). */
	function unlock(periodId) {
		const ref = reference();
		const period = ref.periods.find((p) => p.id === String(periodId));
		if (!period) throw fail("Pay period not found", "Không tìm thấy kỳ lương");
		const released = Store.find("batch", { where: "{period} = ?", params: [period.id] }).filter((b) => b.status === "R" || b.status === "V");
		if (released.length) throw fail("The period has a released payroll batch; attendance cannot be unlocked", "Kỳ đã có bảng lương ghi sổ, không mở khóa công được");
		for (const a of Store.find("attendance", { where: "{period} = ?", params: [period.id] })) Store.submit("attendance", a.id, { status: "O" });
		Store.submit("period", period.id, { att_status: "O" });
		const otherLocked = ref.periods.filter((p) => p.id !== period.id && p.attendanceStatus === "L");
		setSummaryLocked(period, false, otherLocked);
		return { locked: false };
	}

	// ------------------------------------------------------------------ sổ phép

	function balanceRecord(employee, leaveType, year) {
		const key = `${employee}|${leaveType}|${year}`;
		const hit = Store.find("leave_balance", { where: "{key} = ?", params: [key] })[0];
		if (hit) return hit;
		const id = Store.create("leave_balance", { employee, leave_type: leaveType, year, entitled: 0, carried: 0, adjusted: 0, used: 0, pending: 0, key });
		return Store.get("leave_balance", id);
	}

	function toBalance(rec) {
		return { entitled: rec.entitled || 0, carriedOver: rec.carried || 0, carryOverExpiryDate: rec.carry_expiry || null, adjusted: rec.adjusted || 0, used: rec.used || 0, pending: rec.pending || 0 };
	}

	function saveBalance(rec, b) {
		Store.submit("leave_balance", rec.id, { entitled: b.entitled, carried: b.carriedOver, carry_expiry: b.carryOverExpiryDate || null, adjusted: b.adjusted, used: b.used, pending: b.pending });
		Object.assign(rec, { entitled: b.entitled, carried: b.carriedOver, carry_expiry: b.carryOverExpiryDate || null, adjusted: b.adjusted, used: b.used, pending: b.pending });
	}

	function writeTran(employee, leaveType, year, date, tran, ref, note) {
		Store.create("leave_tran", { employee, leave_type: leaveType, year, tran_date: Dates.iso(date), qty: tran.qty, source: tran.source, ref: String(ref || ""), note: String(note || "").slice(0, 300) });
	}

	/** Ghi giao dịch và cập nhật số dư cùng lúc. */
	function post(employee, leaveType, year, date, tran, ref, note) {
		const rec = balanceRecord(employee, leaveType, year);
		saveBalance(rec, Ledger.apply(toBalance(rec), tran));
		writeTran(employee, leaveType, year, date, tran, ref, note);
		return rec;
	}

	function available(employee, leaveType, year) {
		const key = `${employee}|${leaveType}|${year}`;
		const hit = Store.find("leave_balance", { where: "{key} = ?", params: [key] })[0];
		return hit ? Ledger.available(toBalance(hit)) : 0;
	}

	function policyObject(p) {
		return {
			id: p.id, code: norm(p.name), leaveType: p.leave_type, annualDays: p.annual_days || 0, seniorityStepYears: p.step_years || 0, seniorityExtraDays: p.extra_days || 0,
			accrualMethod: p.method || "Y", prorateNewHire: p.prorate !== false, carryOverMaxDays: p.carry_max || 0, carryOverExpiryMonth: p.carry_expiry_month || 0,
			roundingUnit: blank(p.rounding) ? 0.5 : p.rounding,
		};
	}

	/**
	 * Cấp phép năm và chuyển phép năm trước (VP501000 tác vụ A).
	 * @param {number} year
	 * @param {string|null} policyCode chỉ chính sách này (null = tất cả)
	 * @param {string} runDate 'YYYY-MM-DD'
	 * @param {string|null} subsidiary chỉ hồ sơ của công ty con này
	 * @returns {{rows: Array<{employee, policy, accrued, carriedOver, message}>}}
	 */
	function accrue(year, policyCode, runDate, subsidiary) {
		const y = Number(year);
		const run = Dates.iso(runDate || new Date());
		const tenant = Settings.tenant();
		const policies = {};
		for (const p of Store.find("leave_policy")) policies[p.id] = policyObject(p);
		const rows = [];
		for (const prof of Store.find("employee")) {
			if (subsidiary && prof.subsidiary !== String(subsidiary)) continue;
			if (!EmploymentDays.accruesLeave(prof.employment_type === "C")) {
				rows.push({ employee: prof.employee, policy: "", accrued: 0, carriedOver: 0, message: "Contractor (service contract): no annual leave / Cộng tác viên (hợp đồng dịch vụ): không có phép năm" });
				continue;
			}
			const pol = policies[prof.leave_policy || tenant.leave_policy];
			if (!pol) {
				rows.push({ employee: prof.employee, policy: "", accrued: 0, carriedOver: 0, message: "No leave policy / Chưa có chính sách phép" });
				continue;
			}
			if (policyCode && pol.code !== norm(policyCode)) continue;
			const lt = pol.leaveType;
			const prevKey = `${prof.employee}|${lt}|${y - 1}`;
			const prev = Store.find("leave_balance", { where: "{key} = ?", params: [prevKey] })[0];
			const prevRemaining = prev ? Math.max(0, Ledger.available(toBalance(prev))) : 0;
			const calc = Accrual.calculate(pol, y, prof.seniority_date || null, run, prevRemaining);
			const trans = Store.find("leave_tran", { where: "{employee} = ? AND {leave_type} = ? AND {year} = ?", params: [prof.employee, lt, y] });
			const already = trans.filter((t) => t.source === "A").reduce((s, t) => s + (t.qty || 0), 0);
			const delta = Accrual.accrualDelta(calc.entitled, already, pol.accrualMethod);
			if (delta > 0) post(prof.employee, lt, y, run, { source: "A", qty: delta }, `ACCRUE-${y}`, `Policy ${pol.code}`);
			const plan = Ledger.carryOverPlan(calc.carriedOver, trans.some((t) => t.source === "C"), !!prev);
			for (const step of plan) {
				const rec = post(prof.employee, lt, y + step.yearOffset, run, { source: step.source, qty: step.qty }, `CARRY-${y}`, "Carry over / Chuyển phép");
				if (step.source === "C" && calc.carryOverExpiryDate) {
					Store.submit("leave_balance", rec.id, { carry_expiry: calc.carryOverExpiryDate });
				}
			}
			rows.push({ employee: prof.employee, policy: pol.code, accrued: delta, carriedOver: plan.length ? calc.carriedOver : 0, message: delta > 0 || plan.length ? "" : "Already accrued / Đã cấp trong năm" });
		}
		return { rows };
	}

	/** Hết hạn phép chuyển (VP501000 tác vụ X). */
	function expire(year, runDate) {
		const run = Dates.iso(runDate || new Date());
		const out = [];
		for (const rec of Store.find("leave_balance", { where: "{year} = ?", params: [Number(year)] })) {
			const plan = Ledger.expiryPlan(toBalance(rec), run);
			if (plan.transaction) post(rec.employee, rec.leave_type, rec.year, run, plan.transaction, `EXPIRY-${year}`, "Carry-over expiry / Hết hạn phép chuyển");
			if (plan.clearExpiry) Store.submit("leave_balance", rec.id, { carry_expiry: null });
			if (plan.transaction || plan.clearExpiry) out.push({ employee: rec.employee, leaveType: rec.leave_type, expired: plan.transaction ? -plan.transaction.qty : 0 });
		}
		return { rows: out };
	}

	/** Điều chỉnh tay (VP206000 Adjust, nguồn J). */
	function adjust(employee, leaveType, year, qty, reason) {
		if (blank(employee) || blank(leaveType) || !Number(year) || !Number(qty)) throw fail("Employee, leave type, year and a non-zero quantity are required", "Bắt buộc nhân viên, loại nghỉ, năm và số ngày khác 0");
		const rec = post(employee, leaveType, Number(year), Dates.iso(new Date()), { source: "J", qty: Number(qty) }, "ADJUST", reason);
		return { balance: Object.assign(toBalance(rec), { available: Ledger.available(toBalance(rec)) }) };
	}

	/** Số dư phép theo nhân viên của công ty con và năm. */
	function balances(subsidiary, year) {
		const emps = new Set(Store.find("employee", { includeInactive: true }).filter((p) => !subsidiary || p.subsidiary === String(subsidiary)).map((p) => p.employee));
		const lt = reference().leaveTypes;
		return Store.find("leave_balance", { where: "{year} = ?", params: [Number(year)] })
			.filter((b) => emps.has(b.employee))
			.map((b) => Object.assign({}, b, { leaveTypeCode: (lt[b.leave_type] || {}).code || "", available: Ledger.available(toBalance(b)) }));
	}

	/** Tổng số dư khả dụng các loại nghỉ dùng số dư và có lương (trả phép khi nghỉ việc, 2.10.2). */
	function remainingPaidLeave(employee, year) {
		const lt = reference().leaveTypes;
		return Store.find("leave_balance", { where: "{employee} = ? AND {year} = ?", params: [employee, Number(year)] })
			.filter((b) => lt[b.leave_type] && lt[b.leave_type].usesBalance && lt[b.leave_type].isPaid)
			.reduce((s, b) => Money.D(s).plus(Ledger.available(toBalance(b))).toNumber(), 0);
	}

	// ------------------------------------------------------------------ danh sách

	/**
	 * Chứng từ cho màn hình: lọc công ty con (qua hồ sơ lương hoặc trường subsidiary), trạng thái, nhân viên, khoảng ngày.
	 * @param {string} type
	 * @param {string|null} subsidiary
	 * @param {{status?: string, employee?: string, from?: string, to?: string}} [filter]
	 */
	function list(type, subsidiary, filter = {}) {
		const name = recName(type);
		const profSub = {};
		for (const p of Store.find("employee", { includeInactive: true })) profSub[p.employee] = p.subsidiary;
		return Store.find(name, { order: "{id} DESC" }).filter((d) => {
			const sub = d.subsidiary || profSub[d.employee];
			if (subsidiary && sub !== String(subsidiary)) return false;
			if (filter.status && d.status !== filter.status) return false;
			if (filter.employee && d.employee !== String(filter.employee)) return false;
			const r = Rules.range(type, docToCore(type, d));
			if (filter.from && Dates.cmp(r.to, filter.from) < 0) return false;
			if (filter.to && Dates.cmp(r.from, filter.to) > 0) return false;
			return true;
		});
	}

	return { RECORD, reference, derive, save, act, build, lock, unlock, accrue, expire, adjust, balances, remainingPaidLeave, available, list };
});
