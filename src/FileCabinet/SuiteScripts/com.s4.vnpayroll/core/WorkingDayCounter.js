/**
 * Đếm ngày làm việc, ngày công chuẩn và loại ngày (đặc tả mục 2.8.3, 3.3, 3.6; WorkingDayCounter của S4.VP.Core).
 *
 * WeeklyOffDays là chuỗi số thứ trong tuần (0 = Chủ nhật ... 6 = thứ Bảy) phân tách bằng dấu phẩy, chấm phẩy hoặc
 * khoảng trắng; giá trị ngoài 0-6 hoặc không phải số bị bỏ qua. Hai biến thể khi chuỗi trống (đặc tả 2.12 #5):
 * đếm ngày công chuẩn của kỳ coi trống là "0" (Chủ nhật), WorkingDayCounter.ParseWeeklyOff coi trống là không nghỉ.
 * Nửa ngày: FromHalf A (sáng = cả ngày đầu) / P (chỉ buổi chiều ngày đầu); ToHalf P (cả ngày cuối) / A (chỉ buổi sáng).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./Errors"], (Dates, Errors) => {
	const MORNING = "A";
	const AFTERNOON = "P";

	/**
	 * Tách chuỗi ngày nghỉ hằng tuần thành mảng số 0-6.
	 * @param {string|number[]} value chuỗi hoặc mảng đã tách
	 * @param {boolean} [emptyMeansSunday=false] true: trống = "0" (đếm ngày công chuẩn kỳ); false: trống = không nghỉ
	 */
	function parseWeeklyOff(value, emptyMeansSunday = false) {
		if (Array.isArray(value)) return [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
		const s = value === null || value === undefined ? "" : String(value).trim();
		if (!s) return emptyMeansSunday ? [0] : [];
		const out = [];
		for (const part of s.split(/[,;\s]+/)) {
			if (!/^\d+$/.test(part)) continue;
			const n = Number(part);
			if (n >= 0 && n <= 6 && !out.includes(n)) out.push(n);
		}
		return out;
	}

	/** Tập ngày lễ (chuỗi ISO) từ mảng chuỗi, mảng {date} / {holidayDate}, hoặc Set có sẵn. */
	function holidaySet(holidays) {
		if (holidays instanceof Set) return holidays;
		const set = new Set();
		for (const h of holidays || []) {
			const d = typeof h === "object" && h !== null && !(h instanceof Date) ? h.date || h.holidayDate : h;
			if (d) set.add(Dates.iso(d));
		}
		return set;
	}

	function offSet(weeklyOff, emptyMeansSunday) {
		return new Set(parseWeeklyOff(weeklyOff, emptyMeansSunday));
	}

	/** Ngày làm việc: không thuộc ngày nghỉ hằng tuần và không phải ngày lễ. */
	function isWorkingDay(d, off, hol) {
		return !off.has(Dates.dayOfWeek(d)) && !hol.has(Dates.iso(d));
	}

	/**
	 * Ngày công chuẩn của kỳ (CountWorkDays, 2.8.3): số ngày trong [start, end] không nghỉ tuần, không lễ.
	 * Chuỗi nghỉ tuần trống coi là "0" (Chủ nhật).
	 */
	function countWorkDays(start, end, weeklyOff, holidays) {
		const off = offSet(weeklyOff, true);
		const hol = holidaySet(holidays);
		let n = 0;
		for (let t = Dates.toDay(start), e = Dates.toDay(end); t <= e; t++) {
			if (isWorkingDay(Dates.fromDay(t), off, hol)) n++;
		}
		return n;
	}

	/**
	 * Số ngày làm việc trong [start, end] (WorkingDays, dùng cho ngày ngoài hợp đồng). Chuỗi nghỉ tuần trống coi là
	 * Chủ nhật như ngày công chuẩn của kỳ.
	 */
	function workingDays(start, end, weeklyOff, holidays) {
		if (Dates.cmp(end, start) < 0) return 0;
		return countWorkDays(start, end, weeklyOff, holidays);
	}

	/**
	 * Đếm ngày nghỉ của đơn (Count, 3.6): bỏ ngày nghỉ tuần và lễ, trừ 0,5 cho ngày đầu bắt đầu chiều và ngày cuối
	 * kết thúc sáng. Chuỗi nghỉ tuần trống = không nghỉ (ParseWeeklyOff).
	 * @returns {number} số ngày (bội của 0,5)
	 */
	function count(from, to, weeklyOff, holidays, fromHalf = MORNING, toHalf = AFTERNOON) {
		if (Dates.cmp(to, from) < 0) {
			throw Errors.invalid("The end date cannot be earlier than the start date.", "Ngày kết thúc không được trước ngày bắt đầu.");
		}
		if (Dates.cmp(to, from) === 0 && fromHalf === AFTERNOON && toHalf === MORNING) {
			throw Errors.invalid("A request on a single day cannot start in the afternoon and end in the morning.", "Đơn trong một ngày không thể bắt đầu buổi chiều và kết thúc buổi sáng.");
		}
		const off = offSet(weeklyOff, false);
		const hol = holidaySet(holidays);
		const f = Dates.iso(from);
		const l = Dates.iso(to);
		let halves = 0; // đếm theo nửa ngày để tránh số thực
		for (let t = Dates.toDay(f), e = Dates.toDay(l); t <= e; t++) {
			const d = Dates.fromDay(t);
			if (!isWorkingDay(d, off, hol)) continue;
			let v = 2;
			if (d === f && fromHalf === AFTERNOON) v -= 1;
			if (d === l && toHalf === MORNING) v -= 1;
			halves += v;
		}
		return halves / 2;
	}

	/** Phần ngày nghỉ của đơn nằm trong kỳ [ps, pe] (CountWithin, đơn qua hai kỳ). */
	function countWithin(from, to, ps, pe, weeklyOff, holidays, fromHalf = MORNING, toHalf = AFTERNOON) {
		const s = Dates.max(from, ps);
		const e = Dates.min(to, pe);
		if (Dates.cmp(e, s) < 0) return 0;
		return count(s, e, weeklyOff, holidays, s === Dates.iso(from) ? fromHalf : MORNING, e === Dates.iso(to) ? toHalf : AFTERNOON);
	}

	/**
	 * Loại ngày (VPDayType): H ngày lễ > W ngày nghỉ hằng tuần > N ngày thường. Chuỗi nghỉ tuần trống coi là Chủ nhật.
	 */
	function dayType(d, weeklyOff, holidays) {
		if (holidaySet(holidays).has(Dates.iso(d))) return "H";
		return offSet(weeklyOff, true).has(Dates.dayOfWeek(d)) ? "W" : "N";
	}

	/**
	 * Phân loại ngày của đơn OT có xét phân ca (3.3, Điều 111 BLLĐ): khi rosterDayOffIsWeeklyOff và ngày không phải lễ
	 * và nhân viên có ô phân ca ngày đó thì ô trống ca = W, ô có ca = N; không có ô phân ca thì theo lịch tuần.
	 * @param {{rosterDayOffIsWeeklyOff?: boolean, hasRosterCell?: boolean, rosterShift?: string|null}} [roster]
	 */
	function classifyDay(d, weeklyOff, holidays, roster) {
		const base = dayType(d, weeklyOff, holidays);
		if (base === "H") return "H";
		if (roster && roster.rosterDayOffIsWeeklyOff && roster.hasRosterCell) {
			return roster.rosterShift ? "N" : "W";
		}
		return base;
	}

	return { MORNING, AFTERNOON, parseWeeklyOff, holidaySet, isWorkingDay, countWorkDays, workingDays, count, countWithin, dayType, classifyDay };
});
