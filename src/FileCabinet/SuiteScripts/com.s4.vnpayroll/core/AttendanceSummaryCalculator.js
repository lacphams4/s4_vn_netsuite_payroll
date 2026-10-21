/**
 * Bảng tổng hợp công của một nhân viên trong kỳ (đặc tả mục 3.1, 3.2, 3.5; VP307000 Attendance Summary).
 *
 * Mô hình ngoại lệ: mặc định đủ công chuẩn, trừ nghỉ không lương, nghỉ BHXH, quy đổi trễ sớm, cộng / trừ điều chỉnh.
 * Nghỉ có lương, công tác chỉ thống kê; giờ OT từ đơn OT đã duyệt. Nhóm nguồn bảng công ký hiệu (Sheet) lấy công
 * từ AttendanceSheetCalculator. Đầu vào là chứng từ ĐÃ DUYỆT, lọc sẵn theo kỳ ở lớp NetSuite.
 *
 * Mã nguồn dòng chi tiết (VPAttendanceSource): L đơn nghỉ, O đơn OT, T công tác, X ngoại lệ, S bảng công ký hiệu,
 * C ngoài thời hạn hợp đồng.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./WorkingDayCounter", "./EmploymentDays"], (Money, Dates, WorkingDayCounter, EmploymentDays) => {
	const D = Money.D;

	/** WorkDays = max(0, chuẩn - không lương - BHXH - trễ sớm + điều chỉnh); AbsenceDays = không lương + BHXH. */
	function computeWorkDays(t) {
		const w = D(t.standardDays).minus(D(t.unpaidLeaveDays)).minus(D(t.socialInsuranceLeaveDays)).minus(D(t.lateEarlyDays)).plus(D(t.adjustmentDays));
		return {
			workDays: Money.max(0, w).toNumber(),
			absenceDays: D(t.unpaidLeaveDays).plus(D(t.socialInsuranceLeaveDays)).toNumber(),
		};
	}

	function emptyTotals(standardDays) {
		return {
			standardDays: Money.num(standardDays || 0), paidLeaveDays: 0, unpaidLeaveDays: 0, socialInsuranceLeaveDays: 0,
			businessTripDays: 0, lateEarlyDays: 0, adjustmentDays: 0, overtimeHours: 0, workDays: 0, absenceDays: 0, lines: [],
		};
	}

	function add(a, b) {
		return D(a).plus(D(b)).toNumber();
	}

	/** Cộng đơn nghỉ đã duyệt vào tổng (dùng chung Build và ApplyLeave dự phòng). */
	function addLeaves(t, leaveRequests, ps, pe, weeklyOff, holidays) {
		for (const r of leaveRequests || []) {
			const days = WorkingDayCounter.countWithin(r.fromDate, r.toDate, ps, pe, weeklyOff, holidays, r.fromHalf || "A", r.toHalf || "P");
			if (days <= 0) continue;
			const lt = r.leaveType || {};
			if (lt.paidBySocialInsurance) t.socialInsuranceLeaveDays = add(t.socialInsuranceLeaveDays, days);
			else if (lt.deductsWorkDays) t.unpaidLeaveDays = add(t.unpaidLeaveDays, days);
			else t.paidLeaveDays = add(t.paidLeaveDays, days);
			t.lines.push({ sourceType: "L", sourceRefNbr: r.refNbr || "", category: lt.code || r.leaveTypeCode || "", fromDate: Dates.max(r.fromDate, ps), toDate: Dates.min(r.toDate, pe), days, hours: 0 });
		}
	}

	function addOutside(t, employee, ps, pe, weeklyOff, holidays) {
		const e = employee || {};
		const outside = EmploymentDays.outsideContract(e.hireDate, e.terminationDate, ps, pe, weeklyOff, holidays);
		if (outside > 0) {
			t.unpaidLeaveDays = add(t.unpaidLeaveDays, outside);
			t.lines.push({ sourceType: "C", sourceRefNbr: "", category: "OUTSIDE", fromDate: ps, toDate: pe, days: outside, hours: 0 });
		}
		return outside;
	}

	function addOvertime(t, overtime) {
		for (const o of overtime || []) {
			t.overtimeHours = add(t.overtimeHours, o.hours);
			t.lines.push({ sourceType: "O", sourceRefNbr: o.refNbr || "", category: o.earningType || "", fromDate: Dates.iso(o.workDate), toDate: Dates.iso(o.workDate), days: 0, hours: Money.num(o.hours) });
		}
	}

	function sortLines(t) {
		t.lines = t.lines.map((l, i) => [l, i]).sort((a, b) => Dates.cmp(a[0].fromDate, b[0].fromDate) || a[1] - b[1]).map((x) => x[0]);
		return t;
	}

	/**
	 * Build theo mô hình ngoại lệ (nhóm nguồn E).
	 * @param {Object} input
	 * @param {{startDate, endDate, standardWorkDays}} input.period
	 * @param {{hireDate?, terminationDate?}} input.employee
	 * @param {string} input.weeklyOff ngày nghỉ tuần của thiết lập chung (3.11 #1)
	 * @param {Array} input.holidays
	 * @param {Array<{refNbr, fromDate, toDate, fromHalf, toHalf, leaveType: {code, paidBySocialInsurance, deductsWorkDays}}>} input.leaveRequests
	 * @param {Array<{refNbr, fromDate, toDate}>} input.trips
	 * @param {Array<{refNbr, workDate, exceptionType: "L"|"E"|"A", deductDays, adjustDays}>} input.exceptions
	 * @param {Array<{refNbr, workDate, hours, earningType}>} input.overtime
	 */
	function buildExceptions(input) {
		const p = input.period;
		const ps = Dates.iso(p.startDate);
		const pe = Dates.iso(p.endDate);
		const t = emptyTotals(p.standardWorkDays);
		addOutside(t, input.employee, ps, pe, input.weeklyOff, input.holidays);
		addLeaves(t, input.leaveRequests, ps, pe, input.weeklyOff, input.holidays);
		for (const r of input.trips || []) {
			const days = WorkingDayCounter.countWithin(r.fromDate, r.toDate, ps, pe, input.weeklyOff, input.holidays);
			if (days <= 0) continue;
			t.businessTripDays = add(t.businessTripDays, days);
			t.lines.push({ sourceType: "T", sourceRefNbr: r.refNbr || "", category: "TRIP", fromDate: Dates.max(r.fromDate, ps), toDate: Dates.min(r.toDate, pe), days, hours: 0 });
		}
		for (const x of input.exceptions || []) {
			const wd = Dates.iso(x.workDate);
			if (x.exceptionType === "A") {
				t.adjustmentDays = add(t.adjustmentDays, x.adjustDays);
				t.lines.push({ sourceType: "X", sourceRefNbr: x.refNbr || "", category: "A", fromDate: wd, toDate: wd, days: Money.num(x.adjustDays), hours: 0 });
			} else {
				t.lateEarlyDays = add(t.lateEarlyDays, x.deductDays);
				t.lines.push({ sourceType: "X", sourceRefNbr: x.refNbr || "", category: x.exceptionType, fromDate: wd, toDate: wd, days: -Money.num(x.deductDays), hours: 0 });
			}
		}
		addOvertime(t, input.overtime);
		Object.assign(t, computeWorkDays(t));
		return sortLines(t);
	}

	/**
	 * Build cho nhóm lương nguồn bảng công ký hiệu (S).
	 * @param {Object} input period, employee, weeklyOff, holidays, overtime như buildExceptions
	 * @param {Object|null} input.sheetTotals kết quả AttendanceSheetCalculator.total (null = không có dòng)
	 */
	function buildSheet(input) {
		const p = input.period;
		const ps = Dates.iso(p.startDate);
		const pe = Dates.iso(p.endDate);
		const s = input.sheetTotals || { workedDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, socialInsuranceLeaveDays: 0, businessTripDays: 0, paidDays: 0 };
		const t = emptyTotals(p.standardWorkDays);
		const outside = EmploymentDays.outsideContract((input.employee || {}).hireDate, (input.employee || {}).terminationDate, ps, pe, input.weeklyOff, input.holidays);
		const unpaid = D(s.unpaidLeaveDays).plus(outside);
		t.paidLeaveDays = Money.num(s.paidLeaveDays);
		t.unpaidLeaveDays = unpaid.toNumber();
		t.socialInsuranceLeaveDays = Money.num(s.socialInsuranceLeaveDays);
		t.businessTripDays = Money.num(s.businessTripDays);
		t.lateEarlyDays = 0;
		t.adjustmentDays = D(s.paidDays).minus(D(t.standardDays).minus(unpaid).minus(D(s.socialInsuranceLeaveDays))).toNumber();
		t.workDays = Money.max(0, s.paidDays).toNumber();
		t.absenceDays = unpaid.plus(D(s.socialInsuranceLeaveDays)).toNumber();
		t.lines.push({ sourceType: "S", sourceRefNbr: "", category: "SHEET", fromDate: ps, toDate: pe, days: Money.num(s.paidDays), hours: 0 });
		if (outside > 0) t.lines.push({ sourceType: "C", sourceRefNbr: "", category: "OUTSIDE", fromDate: ps, toDate: pe, days: outside, hours: 0 });
		addOvertime(t, input.overtime);
		return sortLines(t);
	}

	/**
	 * Áp công lên dòng bảng lương (ApplyLeave, 3.5). Có bảng tổng hợp (Open hoặc Locked) thì chép; không có thì dự
	 * phòng: chỉ đơn nghỉ đã duyệt + ngày ngoài hợp đồng, weeklyOff là thiết lập hiệu lực của bảng lương.
	 * @param {Object} input
	 * @param {Object|null} input.summary bảng tổng hợp {standardDays, paidLeaveDays, ..., workDays, status}
	 * @param {number} input.standardWorkDays ngày công chuẩn của dòng bảng lương
	 * @returns {{standardWorkDays, paidLeaveDays, unpaidLeaveDays, socialInsuranceLeaveDays, businessTripDays, lateEarlyDays, adjustmentDays, workDays, absenceDays, attendanceLocked}}
	 */
	function applyLeave(input) {
		const s = input.summary;
		if (s) {
			return {
				standardWorkDays: Money.num(s.standardDays), paidLeaveDays: Money.num(s.paidLeaveDays), unpaidLeaveDays: Money.num(s.unpaidLeaveDays),
				socialInsuranceLeaveDays: Money.num(s.socialInsuranceLeaveDays), businessTripDays: Money.num(s.businessTripDays),
				lateEarlyDays: Money.num(s.lateEarlyDays), adjustmentDays: Money.num(s.adjustmentDays), workDays: Money.num(s.workDays),
				absenceDays: D(s.unpaidLeaveDays).plus(D(s.socialInsuranceLeaveDays)).toNumber(), attendanceLocked: s.status === "L",
			};
		}
		const p = input.period;
		const ps = Dates.iso(p.startDate);
		const pe = Dates.iso(p.endDate);
		const t = emptyTotals(input.standardWorkDays);
		addLeaves(t, input.leaveRequests, ps, pe, input.weeklyOff, input.holidays);
		addOutside(t, input.employee, ps, pe, input.weeklyOff, input.holidays);
		const absence = D(t.unpaidLeaveDays).plus(D(t.socialInsuranceLeaveDays));
		return {
			standardWorkDays: Money.num(input.standardWorkDays), paidLeaveDays: t.paidLeaveDays, unpaidLeaveDays: t.unpaidLeaveDays,
			socialInsuranceLeaveDays: t.socialInsuranceLeaveDays, businessTripDays: 0, lateEarlyDays: 0, adjustmentDays: 0,
			workDays: Money.max(0, D(input.standardWorkDays).minus(absence)).toNumber(), absenceDays: absence.toNumber(), attendanceLocked: false,
		};
	}

	/** Khoảng [from, to] giao kỳ công đã khóa nào (LockedPeriod: start <= to và end >= from). Trả kỳ đầu tiên hoặc null. */
	function lockedPeriodOverlap(from, to, periods) {
		for (const p of periods || []) {
			if (p.attendanceStatus === "L" && Dates.cmp(p.startDate, to) <= 0 && Dates.cmp(p.endDate, from) >= 0) return p;
		}
		return null;
	}

	return { computeWorkDays, buildExceptions, buildSheet, applyLeave, lockedPeriodOverlap };
});
