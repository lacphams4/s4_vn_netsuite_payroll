/**
 * Phần thuần của màn Xếp ca (lưới phân ca nhân viên x ngày, api/RosterView): khoảng ngày, cột ngày, chuẩn hóa ô sửa, kỳ công
 * đã khóa theo nhóm lương và số người theo ca từng ngày. Không đọc ghi NetSuite.
 *
 * - range(from, to): kiểm khoảng ngày (tối đa MAX_DAYS ngày), trả {from, to, count}.
 * - days(from, to, weeklyOff, holidays): [{date, dow (0 = CN), type: N | W | H}].
 * - normalizeCells(cells): ô sửa tay [{employee, workDate, shift}] đã chuẩn hóa; cùng nhân viên x ngày thì ô sau cùng thắng;
 *   tối đa MAX_CELLS ô. shift trống = ngày nghỉ.
 * - lockedRanges(periods, from, to): các kỳ công đã khóa giao khoảng ngày [{group, code, from, to}] (from, to đã cắt theo khoảng).
 * - isLocked(ranges, group, date): ngày thuộc kỳ khóa của nhóm lương (group null / trống = không lọc nhóm, tài khoản một nhóm).
 * - packCells(rows): {mã nhân viên: [[chỉ số ngày, id ca hoặc "", nguồn], ...]} cho trình duyệt.
 * - counts(cells, dayCount): số người theo ca từng ngày {id ca: [n ngày 0, n ngày 1...]}.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./Errors", "./WorkingDayCounter"], (Dates, Errors, WorkingDays) => {
	const MAX_DAYS = 62;
	const MAX_CELLS = 200;
	const blank = (v) => v === null || v === undefined || String(v).trim() === "";
	const isId = (v) => /^\d+$/.test(String(blank(v) ? "" : v).trim());

	function range(from, to) {
		const f = Dates.iso(from);
		const t = Dates.iso(to);
		if (!f || !t || Dates.cmp(t, f) < 0) throw Errors.invalid("Invalid date range.", "Khoảng ngày không hợp lệ.");
		const count = Dates.diff(f, t) + 1;
		if (count > MAX_DAYS) throw Errors.invalid(`The date range is limited to ${MAX_DAYS} days.`, `Khoảng ngày tối đa ${MAX_DAYS} ngày.`);
		return { from: f, to: t, count };
	}

	function days(from, to, weeklyOff, holidays) {
		return Dates.range(from, to).map((d) => ({ date: d, dow: Dates.dayOfWeek(d), type: WorkingDays.dayType(d, weeklyOff, holidays) }));
	}

	function normalizeCells(cells) {
		const list = Array.isArray(cells) ? cells : [];
		if (!list.length) throw Errors.invalid("No roster cell to save.", "Không có ô phân ca nào để lưu.");
		const by = new Map();
		list.forEach((c, i) => {
			const employee = String(c && !blank(c.employee) ? c.employee : "").trim();
			const workDate = Dates.iso(c && c.workDate);
			const shift = c && !blank(c.shift) ? String(c.shift).trim() : "";
			if (!isId(employee)) throw Errors.invalid(`Cell ${i + 1}: employee is missing.`, `Ô ${i + 1}: thiếu nhân viên.`);
			if (!workDate) throw Errors.invalid(`Cell ${i + 1}: invalid date.`, `Ô ${i + 1}: ngày không hợp lệ.`);
			if (shift && !isId(shift)) throw Errors.invalid(`Cell ${i + 1}: invalid shift.`, `Ô ${i + 1}: ca không hợp lệ.`);
			by.set(`${employee}|${workDate}`, { employee, workDate, shift });
		});
		if (by.size > MAX_CELLS) throw Errors.invalid(`At most ${MAX_CELLS} cells per save (${by.size} given).`, `Mỗi lần lưu tối đa ${MAX_CELLS} ô (đang có ${by.size}).`);
		return [...by.values()];
	}

	function lockedRanges(periods, from, to) {
		const out = [];
		for (const p of periods || []) {
			if (p.attendanceStatus !== "L" || !p.startDate || !p.endDate) continue;
			if (Dates.cmp(p.startDate, to) > 0 || Dates.cmp(p.endDate, from) < 0) continue;
			out.push({ group: p.group || "", code: p.code || "", from: Dates.max(p.startDate, from), to: Dates.min(p.endDate, to) });
		}
		return out;
	}

	function isLocked(ranges, group, date) {
		return (ranges || []).some((r) => (blank(group) || r.group === group) && Dates.within(date, r.from, r.to));
	}

	function packCells(rows, from) {
		const out = {};
		for (const r of rows || []) {
			const i = Dates.diff(from, r.workDate);
			if (i < 0) continue;
			(out[String(r.employee)] = out[String(r.employee)] || []).push([i, blank(r.shift) ? "" : String(r.shift), r.source || "G"]);
		}
		return out;
	}

	function counts(cells, dayCount) {
		const out = {};
		for (const list of Object.values(cells || {})) {
			for (const c of list) {
				if (!c[1] || c[0] >= dayCount) continue;
				const row = out[c[1]] || (out[c[1]] = new Array(dayCount).fill(0));
				row[c[0]] += 1;
			}
		}
		return out;
	}

	return { MAX_DAYS, MAX_CELLS, range, days, normalizeCells, lockedRanges, isLocked, packCells, counts };
});
