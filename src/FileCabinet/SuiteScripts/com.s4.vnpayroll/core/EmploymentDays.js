/**
 * Thời hạn hợp đồng trong kỳ và phạm vi nhân viên (đặc tả mục 3.1, 1.6.1; EmploymentDays của S4.VP.Core).
 *
 * HireDate: ngày vào làm; TerminationDate: ngày làm việc cuối cùng. Ngày ngoài thời hạn hợp đồng được cộng vào
 * nghỉ không lương (nguồn C) và tính vào ngưỡng 14 ngày không đóng BHXH.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./WorkingDayCounter"], (Dates, WorkingDayCounter) => {
	/** Có làm việc ít nhất một ngày trong kỳ [ps, pe]. */
	function employedIn(hire, term, ps, pe) {
		return (!hire || Dates.cmp(hire, pe) <= 0) && (!term || Dates.cmp(term, ps) >= 0);
	}

	/** Ngày làm việc cuối nằm trong kỳ. */
	function terminatesIn(term, ps, pe) {
		return !!term && Dates.cmp(ps, term) <= 0 && Dates.cmp(term, pe) <= 0;
	}

	/** Số ngày làm việc của kỳ nằm ngoài thời hạn hợp đồng (OutsideContract). */
	function outsideContract(hire, term, ps, pe, weeklyOff, holidays) {
		if (!hire && !term) return 0;
		if (!employedIn(hire, term, ps, pe)) return WorkingDayCounter.workingDays(ps, pe, weeklyOff, holidays);
		let days = 0;
		if (hire && Dates.cmp(hire, ps) > 0) days += WorkingDayCounter.workingDays(ps, Dates.addDays(hire, -1), weeklyOff, holidays);
		if (term && Dates.cmp(term, pe) < 0) days += WorkingDayCounter.workingDays(Dates.addDays(term, 1), pe, weeklyOff, holidays);
		return days;
	}

	/** Nhân viên vào bảng tổng hợp công (BUG-51, BUG-54): không phải CTV, hoặc nhóm dùng bảng công ký hiệu, hoặc là thành viên tổ. */
	function inAttendanceSummary(contractor, usesSheet, teamMember) {
		return !contractor || !!usesSheet || !!teamMember;
	}

	/** Giữ trong bảng lương sau khi nạp giờ: CTV hưởng theo giờ không có giờ nào thì bị loại. */
	function keepInPayroll(contractor, hourly, hours) {
		return !(contractor && hourly && !(Number(hours) > 0));
	}

	/** CTV không có phép năm (BUG-50). */
	function accruesLeave(contractor) {
		return !contractor;
	}

	return { employedIn, terminatesIn, outsideContract, inAttendanceSummary, keepInPayroll, accruesLeave };
});
