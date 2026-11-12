/**
 * Chế độ ca (record shift_assign): lịch ca của nhân viên suy ra từ mẫu xoay ca gán cho một phạm vi, không cần lưu từng ô.
 * Cách làm của các hệ thống lớn (SAP: quy tắc lịch làm việc gán cho nhân viên theo hiệu lực, chỉ lưu thay ca; UKG: mẫu lịch gán
 * cho nhóm): gán một lần cho cả tổ / phòng ban / nhóm, ngoại lệ mới lưu thành ô phân ca.
 *
 * Dòng gán: {id, scope: E | T | D | G | S, employee, team, department, paygroup, subsidiary, patternId, anchor, effective, expiration}.
 * Người: {employee, subsidiary, department, paygroup, memberships: [{team, effectiveDate, expirationDate}]}.
 * Ưu tiên theo ngày: E > T > D > G > S; cùng mức lấy dòng hiệu lực muộn nhất, bằng nhau thì id lớn hơn.
 *
 * - validate(values): chuẩn hóa và kiểm một dòng gán trước khi lưu.
 * - applicable(person, list): các dòng có thể áp cho người (chưa xét ngày), đã xếp theo ưu tiên.
 * - pick(person, date, list): dòng áp cho người tại ngày, hoặc null.
 * - days(person, from, to, list, patterns): mảng theo ngày của {shiftCode: mã | null (nghỉ), assign: id} hoặc null (không có chế độ ca).
 * - cells(person, from, to, list, patterns): [{employee, workDate, shiftCode, assign}] chỉ cho ngày có chế độ ca.
 * - eligible(person, from, to, list): có dòng gán nào giao khoảng ngày.
 * - signature(dayList): chuỗi nhận dạng một dãy ngày (gộp các nhân viên trùng lịch khi gửi về trình duyệt).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./Errors"], (Dates, Errors) => {
	const RANK = { E: 0, T: 1, D: 2, G: 3, S: 4 };
	const TARGET = { E: "employee", T: "team", D: "department", G: "paygroup" };
	const blank = (v) => v === null || v === undefined || String(v).trim() === "";
	const str = (v) => (blank(v) ? "" : String(v).trim());
	const isId = (v) => /^\d+$/.test(str(v));

	function validate(values) {
		const v = values || {};
		const scope = str(v.scope).toUpperCase();
		if (!(scope in RANK)) throw Errors.invalid("Select the scope of the shift scheme.", "Chưa chọn phạm vi của chế độ ca.");
		if (!isId(v.subsidiary)) throw Errors.invalid("Subsidiary is required.", "Chưa chọn công ty con.");
		if (!isId(v.pattern)) throw Errors.invalid("Select a shift pattern.", "Chưa chọn mẫu xoay ca.");
		const key = TARGET[scope];
		if (key && !isId(v[key])) {
			const names = { employee: ["an employee", "nhân viên"], team: ["a team", "tổ"], department: ["a department", "phòng ban"], paygroup: ["a pay group", "nhóm lương"] }[key];
			throw Errors.invalid(`Select ${names[0]} for this scope.`, `Chưa chọn ${names[1]} cho phạm vi này.`);
		}
		const effective = blank(v.effective) ? null : Dates.iso(v.effective);
		if (!effective) throw Errors.invalid("The effective date is required.", "Chưa nhập ngày hiệu lực.");
		const expiration = blank(v.expiration) ? null : Dates.iso(v.expiration);
		if (expiration && Dates.cmp(expiration, effective) < 0) throw Errors.invalid("The end date is earlier than the effective date.", "Ngày hết hiệu lực trước ngày hiệu lực.");
		const out = { subsidiary: str(v.subsidiary), scope, employee: null, team: null, department: null, paygroup: null, pattern: str(v.pattern), anchor: blank(v.anchor) ? null : Dates.iso(v.anchor), effective, expiration, note: str(v.note).slice(0, 300) };
		if (key) out[key] = str(v[key]);
		return out;
	}

	const overlaps = (a, from, to) => (!a.effective || Dates.cmp(a.effective, to) <= 0) && (!a.expiration || Dates.cmp(a.expiration, from) >= 0);

	function matches(person, a) {
		if (str(a.subsidiary) && str(person.subsidiary) && str(a.subsidiary) !== str(person.subsidiary)) return false;
		switch (a.scope) {
			case "E":
				return str(a.employee) === str(person.employee);
			case "T":
				return (person.memberships || []).some((m) => str(m.team) === str(a.team));
			case "D":
				return !blank(person.department) && str(a.department) === str(person.department);
			case "G":
				return !blank(person.paygroup) && str(a.paygroup) === str(person.paygroup);
			case "S":
				return true;
			default:
				return false;
		}
	}

	function applicable(person, list) {
		return (list || [])
			.filter((a) => matches(person, a))
			.sort((x, y) => RANK[x.scope] - RANK[y.scope] || Dates.cmp(y.effective || "1900-01-01", x.effective || "1900-01-01") || Number(y.id || 0) - Number(x.id || 0));
	}

	const memberOn = (person, team, date) => (person.memberships || []).some((m) => str(m.team) === str(team) && Dates.within(date, m.effectiveDate || null, m.expirationDate || null));

	/** Dòng áp tại ngày từ danh sách đã lọc và xếp ưu tiên (applicable). */
	function pickFrom(person, date, sorted) {
		for (const a of sorted) {
			if (!Dates.within(date, a.effective || null, a.expiration || null)) continue;
			if (a.scope === "T" && !memberOn(person, a.team, date)) continue;
			return a;
		}
		return null;
	}

	function pick(person, date, list) {
		return pickFrom(person, Dates.iso(date), applicable(person, list));
	}

	function codeAt(cycle, anchor, date) {
		const n = (cycle || []).length;
		if (!n) return null;
		let i = (Dates.toDay(date) - Dates.toDay(anchor)) % n;
		if (i < 0) i += n;
		const c = cycle[i];
		return blank(c) ? null : String(c).trim().toUpperCase();
	}

	/**
	 * @param {Object<string, {cycle: Array<string|null>}>} patterns theo id mẫu
	 * @returns {Array<{shiftCode: string|null, assign: string}|null>} một phần tử mỗi ngày của [from, to]
	 */
	function days(person, from, to, list, patterns) {
		const sorted = applicable(person, list).filter((a) => overlaps(a, from, to));
		const out = [];
		for (const d of Dates.range(from, to)) {
			const a = sorted.length ? pickFrom(person, d, sorted) : null;
			const p = a ? (patterns || {})[str(a.patternId || a.pattern)] : null;
			out.push(a && p && (p.cycle || []).length ? { shiftCode: codeAt(p.cycle, a.anchor || a.effective, d), assign: str(a.id) } : null);
		}
		return out;
	}

	function cells(person, from, to, list, patterns) {
		const out = [];
		days(person, from, to, list, patterns).forEach((c, i) => {
			if (c) out.push({ employee: str(person.employee), workDate: Dates.addDays(from, i), shiftCode: c.shiftCode, assign: c.assign });
		});
		return out;
	}

	function eligible(person, from, to, list) {
		return applicable(person, list).some((a) => overlaps(a, from, to) && (a.scope !== "T" || (person.memberships || []).some((m) => str(m.team) === str(a.team) && (!m.effectiveDate || Dates.cmp(m.effectiveDate, to) <= 0) && (!m.expirationDate || Dates.cmp(m.expirationDate, from) >= 0))));
	}

	function signature(dayList) {
		return (dayList || []).map((c) => (c ? `${c.shiftCode || "-"}@${c.assign}` : "")).join(",");
	}

	return { RANK, validate, applicable, pick, days, cells, eligible, signature };
});
