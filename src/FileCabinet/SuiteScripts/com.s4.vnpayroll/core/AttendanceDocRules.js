/**
 * Quy tắc thuần của chứng từ công (đặc tả 3.1, 3.4): đơn nghỉ, đơn OT, đơn công tác, phiếu ngoại lệ chấm công.
 * Luồng chung: H -Submit-> P -Approve-> A / -Reject-> R; P hoặc A -Cancel-> C. Lớp api/Attendance đọc ghi record.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./Errors", "./WorkingDayCounter", "./AttendanceRuleEvaluator", "./TimeImport"], (Money, Dates, Errors, WorkingDayCounter, RuleEvaluator, TimeImport) => {
	const TYPES = ["leave", "ot", "trip", "exception"];

	const TRANSITIONS = {
		submit: { from: ["H"], to: "P" },
		approve: { from: ["P"], to: "A" },
		reject: { from: ["P"], to: "R" },
		cancel: { from: ["P", "A"], to: "C" },
	};

	const err = (code, message, messageVi) => ({ code, message, messageVi });

	/** Trạng thái đích của thao tác; null khi không được phép. */
	function nextStatus(status, action) {
		const t = TRANSITIONS[action];
		if (!t) return null;
		return t.from.includes(status || "H") ? t.to : null;
	}

	/** Khoảng ngày của chứng từ: đơn nghỉ, công tác theo from - to; OT, ngoại lệ theo ngày làm. */
	function range(type, doc) {
		if (type === "leave" || type === "trip") return { from: Dates.iso(doc.from), to: Dates.iso(doc.to || doc.from) };
		return { from: Dates.iso(doc.workDate), to: Dates.iso(doc.workDate) };
	}

	function overlaps(a, b) {
		return Dates.cmp(a.from, b.to) <= 0 && Dates.cmp(a.to, b.from) >= 0;
	}

	/** Người duyệt không được là chính nhân viên trên chứng từ (người dùng không gắn nhân viên thì được duyệt). */
	function selfApproval(approverId, employeeId) {
		return !!approverId && String(approverId) === String(employeeId);
	}

	/**
	 * Chuẩn hóa đơn nghỉ: ToDate trống / nhỏ hơn thì = FromDate; loại không cho nửa ngày thì ép sáng / chiều; tính Days.
	 * @returns {{to, fromHalf, toHalf, days}}
	 */
	function normalizeLeave(doc, leaveType, weeklyOff, holidays) {
		const from = Dates.iso(doc.from);
		let to = doc.to ? Dates.iso(doc.to) : from;
		if (Dates.cmp(to, from) < 0) to = from;
		const allowHalf = !leaveType || leaveType.allowHalfDay !== false;
		const fromHalf = allowHalf ? doc.fromHalf || "A" : "A";
		const toHalf = allowHalf ? doc.toHalf || "P" : "P";
		const days = WorkingDayCounter.count(from, to, weeklyOff, holidays, fromHalf, toHalf);
		return { to, fromHalf, toHalf, days };
	}

	/** Số ngày đơn công tác: ngày làm việc, luôn cả ngày. */
	function tripDays(doc, weeklyOff, holidays) {
		const from = Dates.iso(doc.from);
		const to = doc.to && Dates.cmp(doc.to, from) >= 0 ? Dates.iso(doc.to) : from;
		return { to, days: WorkingDayCounter.count(from, to, weeklyOff, holidays) };
	}

	/**
	 * Đơn OT: loại ngày (H > W > N), loại thu nhập mặc định nếu trống, kiểm tra giờ và giới hạn ngày.
	 * @param {Object} doc {workDate, hours, isNight, earningType}
	 * @param {number} otherHours giờ OT P / A khác của nhân viên trong ngày
	 * @returns {{dayType, earningType, errors: Array, warnings: Array}}
	 */
	function prepareOvertime(doc, weeklyOff, holidays, earningTypes, otherHours, forSubmit) {
		const dayType = WorkingDayCounter.dayType(doc.workDate, weeklyOff, holidays);
		const earningType = doc.earningType || TimeImport.defaultOvertimeEarningType(earningTypes, dayType, doc.isNight);
		const errors = [];
		const warnings = [];
		const hours = Number(doc.hours) || 0;
		if (hours < 0 || hours > 12) errors.push(err("HOURS", "Overtime hours must be between 0 and 12.", "Số giờ làm thêm phải từ 0 đến 12."));
		const lim = TimeImport.checkDailyLimit(otherHours || 0, hours, dayType);
		if (lim.exceeded) {
			const e = err("DAILY_LIMIT", `Overtime exceeds the daily limit of ${lim.limit} hours.`, `Giờ làm thêm vượt giới hạn ${lim.limit} giờ một ngày.`);
			(forSubmit ? errors : warnings).push(e);
		}
		if (forSubmit && !(hours > 0)) errors.push(err("HOURS", "Overtime hours must be greater than zero.", "Số giờ làm thêm phải lớn hơn 0."));
		if (forSubmit && !earningType) errors.push(err("EARNING_TYPE", "Select an overtime earning type.", "Chưa chọn loại thu nhập làm thêm."));
		return { dayType, earningType, errors, warnings };
	}

	/**
	 * Phiếu ngoại lệ: trễ / sớm quy đổi ngày bị trừ theo quy tắc (lưu cứng trên phiếu), điều chỉnh công |x| <= 1, khác 0.
	 * @returns {{minutes, deductDays, adjustDays, errors}}
	 */
	function prepareException(doc, rules, forSubmit) {
		const errors = [];
		if (!["L", "E", "A"].includes(doc.exceptionType)) errors.push(err("TYPE", "Select an exception type.", "Chưa chọn loại ngoại lệ."));
		if (!String(doc.reason || "").trim()) errors.push(err("REASON", "A reason is required.", "Phải nhập lý do."));
		if (doc.exceptionType === "A") {
			const adj = Number(doc.adjustDays) || 0;
			if (Math.abs(adj) > 1 || (forSubmit && adj === 0)) errors.push(err("ADJUST", "Adjustment days must be non-zero and between -1 and 1.", "Điều chỉnh công phải khác 0 và trong khoảng -1 đến 1."));
			return { minutes: 0, deductDays: 0, adjustDays: adj, errors };
		}
		const minutes = Math.round(Number(doc.minutes) || 0);
		if (minutes < 0 || minutes > 1440) errors.push(err("MINUTES", "Minutes must be between 0 and 1440.", "Số phút phải từ 0 đến 1440."));
		if (forSubmit && !(minutes > 0)) errors.push(err("MINUTES", "Minutes must be greater than zero.", "Số phút phải lớn hơn 0."));
		return { minutes, deductDays: RuleEvaluator.deductDays(minutes, rules || []), adjustDays: 0, errors };
	}

	/** Đơn công tác: không trùng đơn công tác khác và đơn nghỉ P / A. */
	function tripErrors(doc, days, others) {
		const errors = [];
		if (!(days > 0)) errors.push(err("DAYS", "The number of days must be greater than zero.", "Số ngày công tác phải lớn hơn 0."));
		const me = { from: Dates.iso(doc.from), to: Dates.iso(doc.to || doc.from) };
		if ((others || []).some((o) => (o.status === "P" || o.status === "A") && overlaps(me, { from: o.fromDate, to: o.toDate }))) {
			errors.push(err("OVERLAP", "The trip overlaps another pending or approved trip or leave request.", "Đơn công tác trùng ngày với đơn khác đang chờ duyệt hoặc đã duyệt."));
		}
		return errors;
	}

	/** Kỳ chứa ngày d (kỳ đầu tiên theo ngày bắt đầu); chỉ để hiển thị. */
	function periodOf(d, periods) {
		const day = Dates.iso(d);
		const hit = (periods || []).filter((p) => Dates.within(day, p.startDate, p.endDate)).sort((a, b) => Dates.cmp(a.startDate, b.startDate))[0];
		return hit || null;
	}

	return { TYPES, nextStatus, range, overlaps, selfApproval, normalizeLeave, tripDays, prepareOvertime, prepareException, tripErrors, periodOf };
});
