/**
 * Đối chiếu phân ca với lượt chấm công và sinh chứng từ đề xuất (đặc tả mục 3.3; ShiftMatcher của S4.VP.Core,
 * VP502000 Process Punches).
 *
 * Thời điểm chấm dạng 'YYYY-MM-DD HH:mm[:ss]' (hoặc có 'T'), giờ địa phương của nơi chấm công. Nội bộ quy về số
 * phút kể từ 1970-01-01. Ca có EndTime <= StartTime là ca qua đêm. Giờ đêm 22:00 - 06:00.
 * Trạng thái kết quả: OnTime, LateOrEarly, MissingPunch, Absent, Excused, WorkedWithoutShift.
 * Hệ thống chỉ đề xuất (Điều 127 BLLĐ cấm phạt tiền): mọi chứng từ sinh ra ở trạng thái Hold, chờ duyệt.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./Errors", "./Money"], (Dates, Errors, Money) => {
	const DEFAULTS = { inWindowBefore: 240, outWindowAfter: 480, outGap: 15, nightStart: 22 * 60, nightEnd: 6 * 60 };
	const STATUS = { ON_TIME: "OnTime", LATE_OR_EARLY: "LateOrEarly", MISSING: "MissingPunch", ABSENT: "Absent", EXCUSED: "Excused", WITHOUT_SHIFT: "WorkedWithoutShift" };

	/** 'HH:mm' / 'H:mm' -> phút trong ngày, phải < 24:00. */
	function parseTime(s) {
		const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
		if (!m || +m[1] > 23 || +m[2] > 59) throw Errors.invalid(`Invalid time ${s}. Use HH:mm before 24:00.`, `Giờ ${s} không hợp lệ. Nhập HH:mm nhỏ hơn 24:00.`);
		return +m[1] * 60 + +m[2];
	}

	/** Thời điểm chấm -> phút kể từ 1970-01-01 (có thể lẻ giây). */
	function toMinutes(ts) {
		const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(ts).trim());
		if (!m) throw Errors.invalid(`Invalid punch time ${ts}.`, `Thời điểm chấm công ${ts} không hợp lệ.`);
		return Dates.toDay(m[1]) * 1440 + +m[2] * 60 + +m[3] + (m[4] ? +m[4] / 60 : 0);
	}

	/** Phút -> 'YYYY-MM-DD HH:mm'. */
	function fromMinutes(min) {
		const whole = Math.floor(min);
		const day = Math.floor(whole / 1440);
		const r = whole - day * 1440;
		return `${Dates.fromDay(day)} ${Dates.pad(Math.floor(r / 60))}:${Dates.pad(r % 60)}`;
	}

	function startOn(date, shift) {
		return Dates.toDay(date) * 1440 + parseTime(shift.startTime);
	}

	function endOn(date, shift) {
		const s = parseTime(shift.startTime);
		const e = parseTime(shift.endTime);
		return Dates.toDay(date) * 1440 + e + (e <= s ? 1440 : 0);
	}

	/** Độ dài ca (phút) và giờ chuẩn = max(0, Span - Break) / 60; nghỉ giữa ca phải >= 0 và nhỏ hơn độ dài ca. */
	function standardHours(shift) {
		const span = endOn("2000-01-01", shift) - startOn("2000-01-01", shift);
		const brk = Number(shift.breakMinutes) || 0;
		if (brk < 0 || brk >= span) throw Errors.invalid("The break must be zero or more and shorter than the shift.", "Thời gian nghỉ giữa ca phải >= 0 và ngắn hơn độ dài ca.");
		return Money.D(Math.max(0, span - brk)).div(60).toNumber();
	}

	/** Số phút giao của [from, to] với các khung 22:00 - 06:00, làm tròn số phút. */
	function nightOverlap(from, to, opts) {
		const o = Object.assign({}, DEFAULTS, opts);
		if (to <= from) return 0;
		let sum = 0;
		for (let d = Math.floor(from / 1440) - 1; d <= Math.floor(to / 1440); d++) {
			const ws = d * 1440 + o.nightStart;
			const we = (d + 1) * 1440 + o.nightEnd;
			const a = Math.max(from, ws);
			const b = Math.min(to, we);
			if (b > a) sum += b - a;
		}
		return Math.round(sum);
	}

	/**
	 * Khớp một ca với lượt chấm của một nhân viên (MatchShift).
	 * @param {string} date ngày ca
	 * @param {Object} shift {code, startTime, endTime, breakMinutes, kind, lateGraceMinutes, earlyGraceMinutes, overtimeMinMinutes}
	 * @param {number[]} punches phút, đã sắp tăng
	 * @param {boolean[]} used đánh dấu lượt đã dùng (bị sửa)
	 * @param {boolean} excused ngày có đơn nghỉ / công tác đã duyệt
	 */
	function matchShift(date, shift, punches, used, excused, opts) {
		const o = Object.assign({}, DEFAULTS, opts);
		const start = startOn(date, shift);
		const end = endOn(date, shift);
		const middle = start + (end - start) / 2;
		const inFrom = start - o.inWindowBefore;
		const outTo = end + o.outWindowAfter;
		let inIdx = null;
		let outIdx = null;
		for (let i = 0; i < punches.length; i++) {
			if (used[i]) continue;
			const t = punches[i];
			if (inIdx === null && inFrom <= t && t <= middle) inIdx = i;
			if (t <= middle || t > outTo) continue;
			if (outIdx === null || t <= end || t - punches[outIdx] <= o.outGap) outIdx = i;
			else break;
		}
		const lo = inIdx !== null ? inIdx : outIdx;
		const hi = outIdx !== null ? outIdx : inIdx;
		if (lo !== null) for (let i = lo; i <= hi; i++) used[i] = true;
		const res = {
			workDate: Dates.iso(date), shiftCode: shift.code, shiftKind: shift.kind || "D", in: inIdx !== null ? fromMinutes(punches[inIdx]) : null,
			out: outIdx !== null ? fromMinutes(punches[outIdx]) : null, late: 0, early: 0, overtime: 0, worked: 0, night: 0,
			shiftEnd: fromMinutes(end), outMinutes: outIdx !== null ? punches[outIdx] : null, shiftEndMinutes: end,
		};
		if (inIdx === null && outIdx === null) {
			res.status = excused ? STATUS.EXCUSED : STATUS.ABSENT;
			return res;
		}
		if (inIdx === null || outIdx === null) {
			res.status = STATUS.MISSING;
			return res;
		}
		const tin = punches[inIdx];
		const tout = punches[outIdx];
		res.late = Math.max(0, Math.ceil(tin - start));
		res.early = Math.max(0, Math.ceil(end - tout));
		const after = Math.floor(tout - end);
		res.overtime = after >= Math.max(1, Number(shift.overtimeMinMinutes === undefined || shift.overtimeMinMinutes === null ? 30 : shift.overtimeMinMinutes)) ? after : 0;
		const effIn = Math.max(tin, start);
		const effOut = Math.min(tout, end);
		res.worked = Math.max(0, Math.round(effOut - effIn) - (Number(shift.breakMinutes) || 0));
		res.night = nightOverlap(effIn, effOut, o);
		res.status = res.late > (Number(shift.lateGraceMinutes) || 0) || res.early > (Number(shift.earlyGraceMinutes) || 0) ? STATUS.LATE_OR_EARLY : STATUS.ON_TIME;
		return res;
	}

	/**
	 * Khớp phân ca với lượt chấm cho khoảng [from, to].
	 * @param {Object} input
	 * @param {Array<{employee, workDate, shiftCode: string|null}>} input.roster ô phân ca (trống ca = nghỉ)
	 * @param {Array|Object} input.shifts danh sách ca hoặc map mã -> ca
	 * @param {Array<{employee, time}>} input.punches
	 * @param {Array<{employee, date}>} [input.excused] ngày có đơn nghỉ (mọi loại) / công tác đã duyệt
	 * @param {string} input.from
	 * @param {string} input.to
	 * @returns {Array<{employee, workDate, shiftCode, shiftKind, status, in, out, late, early, overtime, worked, night}>}
	 */
	function match(input, opts) {
		const from = Dates.iso(input.from);
		const to = Dates.iso(input.to);
		const shiftMap = new Map();
		const list = Array.isArray(input.shifts) ? input.shifts : Object.values(input.shifts || {});
		for (const s of list) shiftMap.set(String(s.code).trim().toUpperCase(), s);
		const cells = (input.roster || []).filter((c) => Dates.within(c.workDate, from, to));
		if (!cells.length) return [];
		const byEmp = new Map();
		for (const c of cells) {
			const k = String(c.employee);
			if (!byEmp.has(k)) byEmp.set(k, { cells: [], punches: [] });
			byEmp.get(k).cells.push(c);
		}
		const lo = Dates.toDay(from) * 1440 - 360;
		const hi = (Dates.toDay(to) + 2) * 1440;
		for (const p of input.punches || []) {
			const e = byEmp.get(String(p.employee));
			if (!e) continue;
			const t = toMinutes(p.time);
			if (t >= lo && t < hi) e.punches.push(t);
		}
		const excused = new Set((input.excused || []).map((x) => `${x.employee}|${Dates.iso(x.date)}`));
		const out = [];
		for (const [emp, e] of byEmp) {
			e.punches.sort((a, b) => a - b);
			const used = e.punches.map(() => false);
			e.cells.sort((a, b) => Dates.cmp(a.workDate, b.workDate));
			for (const c of e.cells) {
				if (!c.shiftCode) continue;
				const shift = shiftMap.get(String(c.shiftCode).trim().toUpperCase());
				if (!shift) throw Errors.invalid(`Shift ${c.shiftCode} does not exist.`, `Ca ${c.shiftCode} không tồn tại.`);
				const r = matchShift(c.workDate, shift, e.punches, used, excused.has(`${emp}|${Dates.iso(c.workDate)}`), opts);
				r.employee = c.employee;
				out.push(r);
			}
			const groups = new Map();
			e.punches.forEach((t, i) => {
				if (used[i]) return;
				const d = Dates.fromDay(Math.floor(t / 1440));
				if (!groups.has(d)) groups.set(d, []);
				groups.get(d).push(t);
			});
			for (const [d, ts] of groups) {
				if (ts.length < 2) continue;
				const tin = ts[0];
				const tout = ts[ts.length - 1];
				out.push({
					employee: e.cells[0].employee, workDate: d, shiftCode: null, shiftKind: null, status: STATUS.WITHOUT_SHIFT, in: fromMinutes(tin), out: fromMinutes(tout),
					late: 0, early: 0, overtime: 0, worked: Math.round(tout - tin), night: nightOverlap(tin, tout, opts), outMinutes: tout,
				});
			}
		}
		return out;
	}

	/** Có mặt ca (dùng đếm số ca cho phụ cấp ca / ăn ca). */
	function isWorkedShift(r) {
		return !!r.shiftCode && [STATUS.ON_TIME, STATUS.LATE_OR_EARLY, STATUS.MISSING].includes(r.status);
	}

	/** Đếm số ca có mặt, lọc theo loại ca (D / E / N), trống = mọi ca. */
	function countShifts(results, kind) {
		return (results || []).filter((r) => isWorkedShift(r) && (!kind || r.shiftKind === kind)).length;
	}

	/**
	 * Sinh chứng từ đề xuất từ kết quả khớp (Process Punches). Lớp NetSuite xóa trước các chứng từ FromPunches ở Hold
	 * của kỳ; chứng từ còn lại khác Rejected / Cancelled truyền vào kept để không sinh trùng.
	 * @param {Array} results kết quả match
	 * @param {Object} input
	 * @param {string} input.startDate
	 * @param {string} input.endDate
	 * @param {Object} input.shifts map / mảng ca (để lấy ân hạn)
	 * @param {Array<{employee, workDate, kind: "exception"|"overtime", exceptionType?}>} [input.kept]
	 * @returns {{exceptions: Array<{employee, workDate, exceptionType, minutes, adjustDays}>, overtime: Array<{employee, workDate, hours, isNight}>, kept: number}}
	 */
	function processPunches(results, input) {
		const shiftMap = new Map();
		const list = Array.isArray(input.shifts) ? input.shifts : Object.values(input.shifts || {});
		for (const s of list) shiftMap.set(String(s.code).trim().toUpperCase(), s);
		const keptExc = new Set();
		const keptOt = new Set();
		for (const k of input.kept || []) {
			if (k.kind === "overtime") keptOt.add(`${k.employee}|${Dates.iso(k.workDate)}`);
			else keptExc.add(`${k.employee}|${Dates.iso(k.workDate)}|${k.exceptionType}`);
		}
		const exceptions = [];
		const overtime = [];
		let kept = 0;
		const addExc = (r, type, minutes, adjustDays) => {
			if (keptExc.has(`${r.employee}|${r.workDate}|${type}`)) {
				kept++;
				return;
			}
			exceptions.push({ employee: r.employee, workDate: r.workDate, exceptionType: type, minutes, adjustDays });
		};
		const addOt = (r, hours, isNight) => {
			if (keptOt.has(`${r.employee}|${r.workDate}`)) {
				kept++;
				return;
			}
			overtime.push({ employee: r.employee, workDate: r.workDate, hours: Math.min(12, Money.roundTo(hours, 2)), isNight });
		};
		for (const r of results || []) {
			if (!Dates.within(r.workDate, input.startDate, input.endDate)) continue;
			const shift = r.shiftCode ? shiftMap.get(String(r.shiftCode).trim().toUpperCase()) || {} : {};
			if (r.status === STATUS.LATE_OR_EARLY) {
				if (r.late > (Number(shift.lateGraceMinutes) || 0)) addExc(r, "L", r.late, 0);
				if (r.early > (Number(shift.earlyGraceMinutes) || 0)) addExc(r, "E", r.early, 0);
			} else if (r.status === STATUS.ABSENT) {
				addExc(r, "A", 0, -1);
			} else if (r.status === STATUS.MISSING) {
				addExc(r, "A", 0, 0);
			} else if (r.status === STATUS.WITHOUT_SHIFT) {
				addOt(r, Money.D(r.worked).div(60), r.night * 2 > r.worked);
			}
			if (r.shiftCode && r.overtime > 0) {
				addOt(r, Money.D(r.overtime).div(60), nightOverlap(r.shiftEndMinutes, r.outMinutes) * 2 > r.overtime);
			}
		}
		return { exceptions, overtime, kept };
	}

	return { DEFAULTS, STATUS, parseTime, toMinutes, fromMinutes, startOn, endOn, standardHours, nightOverlap, matchShift, match, isWorkedShift, countShifts, processPunches };
});
