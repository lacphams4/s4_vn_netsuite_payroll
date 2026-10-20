/**
 * Nạp giờ công vào bảng lương (Import Time) và quy tắc đơn OT (đặc tả mục 3.4, 3.7).
 *
 * Giờ timesheet lấy trong cửa sổ kết công [timeFrom, timeTo]; đơn OT đã duyệt lấy theo [StartDate, EndDate] của kỳ
 * (3.11 #2). Giờ thường của mọi nhân viên (kể cả lương tháng) đều nạp để phân bổ chi phí (BUG-52); khi nguồn OT là
 * đơn OT (R) thì giờ OT trên timesheet bị bỏ để không trả hai lần.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./WorkingDayCounter"], (Money, Dates, WorkingDayCounter) => {
	const APPROVED = ["Approved", "Released"];

	/**
	 * Giờ timesheet được nhận (IsAccepted): giờ trên time card đã duyệt nhưng chưa release vẫn là giờ đã duyệt (BUG-23).
	 * @param {string} status trạng thái dòng giờ (Approved, Released, Completed, Open, Rejected, Canceled)
	 * @param {string} timeCardStatus trạng thái time card (nếu có)
	 * @param {boolean} requireApproval
	 */
	function isAccepted(status, timeCardStatus, requireApproval) {
		if (APPROVED.includes(status)) return true;
		if (APPROVED.includes(timeCardStatus)) return status !== "Rejected" && status !== "Canceled";
		if (requireApproval) return false;
		return status === "Completed" || status === "Open";
	}

	/**
	 * Dựng dòng giờ của một nhân viên trên bảng lương.
	 * @param {Object} input
	 * @param {{startDate, endDate, timeFromDate?, timeToDate?}} input.period
	 * @param {string} input.weeklyOff thiết lập hiệu lực (chi nhánh + nhóm lương)
	 * @param {Array} input.holidays
	 * @param {boolean} input.fromRequests nguồn OT = đơn OT đã duyệt (R)
	 * @param {Array<{date, timeType, isOvertime, hours, project, task, costCode, sourceId}>} input.entries giờ timesheet đã nhận
	 * @param {Array<{refNbr, workDate, hours, dayType, earningType, project, task, costCode}>} [input.overtimeRequests] đơn OT đã duyệt
	 * @returns {{lines: Array<{workDate, weekStart, dayType, isOvertime, hours, timeType, earningType, sourceId, project, task, costCode}>, overtimeHours: number, regularHours: number}}
	 */
	function buildTimeLines(input) {
		const p = input.period;
		const timeFrom = Dates.iso(p.timeFromDate || p.startDate);
		const timeTo = Dates.iso(p.timeToDate || p.endDate);
		const lines = [];
		const addTime = (date, timeType, isOt, hours, extra) => {
			const h = Money.roundTo(hours, 2);
			if (!(h > 0) || (isOt && input.fromRequests)) return;
			lines.push(Object.assign({
				workDate: Dates.iso(date), weekStart: weekStart(date, input.weekStartDay), dayType: WorkingDayCounter.dayType(date, input.weeklyOff, input.holidays),
				isOvertime: !!isOt, hours: h, timeType: timeType || "", earningType: "",
			}, extra));
		};
		for (const e of input.entries || []) {
			if (!Dates.within(e.date, timeFrom, timeTo)) continue;
			addTime(e.date, e.timeType, e.isOvertime, e.hours, { sourceId: e.sourceId || "", project: e.project || "", task: e.task || "", costCode: e.costCode || "" });
		}
		if (input.fromRequests) {
			for (const r of input.overtimeRequests || []) {
				if (!Dates.within(r.workDate, p.startDate, p.endDate) || !(Number(r.hours) > 0)) continue;
				lines.push({
					workDate: Dates.iso(r.workDate), weekStart: weekStart(r.workDate, input.weekStartDay), dayType: r.dayType || WorkingDayCounter.dayType(r.workDate, input.weeklyOff, input.holidays),
					isOvertime: true, hours: Money.roundTo(r.hours, 2), timeType: "", earningType: r.earningType || "", sourceId: r.refNbr || "",
					project: r.project || "", task: r.task || "", costCode: r.costCode || "",
				});
			}
		}
		const ot = Money.sum(lines.filter((l) => l.isOvertime), (l) => l.hours).toNumber();
		const reg = Money.sum(lines.filter((l) => !l.isOvertime), (l) => l.hours).toNumber();
		return { lines, overtimeHours: ot, regularHours: reg };
	}

	/** Ngày đầu tuần chứa d (lưu để báo cáo nhóm theo tuần, BUG-22); mặc định thứ Hai. */
	function weekStart(d, startDay) {
		const s = startDay === undefined || startDay === null ? 1 : Number(startDay);
		return Dates.addDays(d, -((Dates.dayOfWeek(d) - s + 7) % 7));
	}

	/**
	 * Giới hạn giờ OT một ngày (3.4; Điều 107 BLLĐ 2019, Điều 60 NĐ 145/2020): ngày thường 4 giờ, ngày nghỉ / lễ 12 giờ.
	 * @param {number} otherHours giờ OT Pending / Approved khác của nhân viên trong ngày
	 * @returns {{exceeded: boolean, limit: number}}
	 */
	function checkDailyLimit(otherHours, newHours, dayType) {
		const limit = dayType === "N" ? 4 : 12;
		return { exceeded: Money.D(otherHours || 0).plus(Money.D(newHours || 0)).gt(limit), limit };
	}

	/**
	 * Loại thu nhập mặc định cho đơn OT: loại OT đang hoạt động có OvertimeDayType = loại ngày, sắp theo mã; ưu tiên
	 * IsNight khớp và không phải loại "đêm có OT ban ngày"; không có thì loại đầu tiên có IsNight khớp.
	 * @param {Array<{code, isOvertime, overtimeDayType, isNight, hadDaytimeOvertime, isActive}>} earningTypes
	 */
	function defaultOvertimeEarningType(earningTypes, dayType, isNight) {
		const list = (earningTypes || [])
			.filter((t) => t.isActive !== false && t.isOvertime && t.overtimeDayType === dayType)
			.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
		const night = !!isNight;
		const pick = list.find((t) => !!t.isNight === night && !t.hadDaytimeOvertime) || list.find((t) => !!t.isNight === night);
		return pick ? pick.code : null;
	}

	return { isAccepted, buildTimeLines, weekStart, checkDailyLimit, defaultOvertimeEarningType };
});
