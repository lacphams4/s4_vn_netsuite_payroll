/**
 * Phần thuần của phân ca, lượt chấm và bảng công ký hiệu (đặc tả 3.2, 3.3) cho lớp api/Shifts.
 *
 * - membersOn: thành viên tổ hiệu lực tại một ngày (mỗi nhân viên lấy dòng có ngày hiệu lực muộn nhất).
 * - generate: sinh ô phân ca từ mẫu xoay ca cho thành viên tổ, mỗi ngày chỉ khi nhân viên còn hiệu lực (BUG-35).
 * - plan: so với ô đã có: ô nguồn M (sửa tay) giữ nguyên, ô nguồn G cập nhật khi khác, ô mới tạo với nguồn G.
 * - parsePunch: chuẩn hóa một dòng lượt chấm 'YYYY-MM-DD HH:mm[:ss]'.
 * - sheetCells / cellKey: ô D01..D31 của bảng công ký hiệu.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./ShiftPattern"], (Dates, ShiftPattern) => {
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim();

	function key(employee, workDate) {
		return `${norm(employee)}|${Dates.iso(workDate)}`;
	}

	/** Thành viên hiệu lực tại ngày d: effective <= d và (expiration trống hoặc >= d); nhiều dòng thì lấy dòng mới nhất. */
	function membersOn(members, d) {
		const by = new Map();
		for (const m of members || []) {
			if (m.effectiveDate && Dates.cmp(m.effectiveDate, d) > 0) continue;
			if (m.expirationDate && Dates.cmp(m.expirationDate, d) < 0) continue;
			const k = norm(m.employee);
			const cur = by.get(k);
			if (!cur || Dates.cmp(m.effectiveDate || "1900-01-01", cur.effectiveDate || "1900-01-01") > 0) by.set(k, m);
		}
		return [...by.values()];
	}

	/** Có thành viên nào hiệu lực giao [from, to] (để báo lỗi tổ trống). */
	function anyMember(members, from, to) {
		return (members || []).some((m) => (!m.effectiveDate || Dates.cmp(m.effectiveDate, to) <= 0) && (!m.expirationDate || Dates.cmp(m.expirationDate, from) >= 0));
	}

	/**
	 * Sinh ô phân ca.
	 * @param {{cycle: Array<string|null>, anchor, from, to, members: Array<{employee, effectiveDate, expirationDate}>, location, workCenter, patternId}} input
	 * @returns {Array<{employee, workDate, shiftCode: string|null, location, workCenter, patternId}>}
	 */
	function generate(input) {
		const days = ShiftPattern.expand(input.cycle, input.anchor, input.from, input.to);
		const out = [];
		for (const d of days) {
			for (const m of membersOn(input.members, d.date)) {
				out.push({ employee: norm(m.employee), workDate: d.date, shiftCode: d.shiftCode, location: input.location || "", workCenter: input.workCenter || "", patternId: input.patternId || "" });
			}
		}
		return out;
	}

	/**
	 * Kế hoạch ghi: ô M giữ nguyên; ô G cập nhật nếu ca / địa điểm / work center / mẫu khác; ô chưa có thì tạo.
	 * @param {Array<{id, employee, workDate, shiftCode, source, location, workCenter, patternId}>} existing
	 * @param {Array} generated kết quả generate
	 * @returns {{creates: Array, updates: Array<{id, cell}>, kept: number, unchanged: number}}
	 */
	function plan(existing, generated) {
		const have = new Map();
		for (const c of existing || []) have.set(key(c.employee, c.workDate), c);
		const creates = [];
		const updates = [];
		let kept = 0;
		let unchanged = 0;
		for (const g of generated || []) {
			const cur = have.get(key(g.employee, g.workDate));
			if (!cur) {
				creates.push(g);
				continue;
			}
			if (norm(cur.source).toUpperCase() === "M") {
				kept++;
				continue;
			}
			const same = norm(cur.shiftCode).toUpperCase() === norm(g.shiftCode).toUpperCase() && norm(cur.location) === norm(g.location)
				&& norm(cur.workCenter) === norm(g.workCenter) && norm(cur.patternId) === norm(g.patternId);
			if (same) unchanged++;
			else updates.push({ id: cur.id, cell: g });
		}
		return { creates, updates, kept, unchanged };
	}

	/**
	 * Chuẩn hóa dòng lượt chấm. Trả {employee, time 'YYYY-MM-DD HH:mm', date, device} hoặc {error}.
	 * Chấp nhận 'YYYY-MM-DD HH:mm', 'YYYY-MM-DDTHH:mm', có hoặc không giây; 'dd/MM/yyyy HH:mm'.
	 */
	function parsePunch(row) {
		const raw = norm(row && row.time);
		let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
		let y;
		let mo;
		let d;
		if (m) [y, mo, d] = [m[1], m[2], m[3]];
		else {
			m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
			if (m) [d, mo, y] = [m[1], m[2], m[3]];
		}
		if (!m) return { error: `Invalid punch time "${raw}" / Thời điểm chấm "${raw}" không hợp lệ` };
		const hh = +m[4];
		const mm = +m[5];
		if (hh > 23 || mm > 59 || +mo < 1 || +mo > 12 || +d < 1 || +d > Dates.daysInMonth(+y, +mo)) return { error: `Invalid punch time "${raw}" / Thời điểm chấm "${raw}" không hợp lệ` };
		if (!norm(row.employee)) return { error: "Missing employee / Thiếu nhân viên" };
		const date = Dates.ymd(+y, +mo, +d);
		return { employee: norm(row.employee), date, time: `${date} ${Dates.pad(hh)}:${Dates.pad(mm)}`, device: norm(row.device) };
	}

	/** Tên trường ô thứ n (1..31) của bảng công ký hiệu. */
	function cellKey(n) {
		return `d${Dates.pad(n)}`;
	}

	/** Mảng 31 ô từ record bảng công (trường d01..d31). */
	function sheetCells(rec) {
		const out = [];
		for (let n = 1; n <= 31; n++) out.push(rec ? norm(rec[cellKey(n)]) : "");
		return out;
	}

	return { key, membersOn, anyMember, generate, plan, parsePunch, cellKey, sheetCells };
});
