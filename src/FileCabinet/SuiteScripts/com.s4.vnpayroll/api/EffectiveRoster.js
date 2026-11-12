/**
 * Lịch ca hiệu lực của nhân viên = ô phân ca đã lưu (record roster: ô sinh từ mẫu trước đây và ô sửa tay) đè lên lịch suy ra từ
 * chế độ ca (record shift_assign, core/ShiftAssign). Mọi nơi cần "nhân viên làm ca nào ngày nào" đọc qua mô-đun này: xử lý chấm
 * công (api/Shifts.roster), khung chi tiết nhân viên của màn Chấm công, màn Xếp ca.
 *
 * Account chưa khai chế độ ca nào: rows() trả đúng các ô đã lưu như trước (không thêm truy vấn nào ngoài một lượt đọc
 * shift_assign), nên hành vi cũ giữ nguyên.
 *
 *   schemes(subsidiary?)            dòng chế độ ca đang dùng, dạng lõi {id, scope, employee, team, department, paygroup, subsidiary,
 *                                   patternId, anchor, effective, expiration, note}
 *   patternsById()                  {id mẫu: {code, cycle}}
 *   people(employeeIds)             {nhân viên: {employee, subsidiary, department, paygroup, memberships}} - 3 truy vấn cho cả danh sách
 *   forPayroll(employeeIds, from, to)  số liệu cho bảng lương: counts {nhân viên: {D, E, N}} = số ca theo loại ca của các ngày có
 *                                   ca trong lịch hiệu lực, trừ ngày thuộc đơn nghỉ / đơn công tác đã duyệt (quy tắc thu nhập nguồn H);
 *                                   days {nhân viên: [{date, shiftCode, branch, workCenter}]} = ngày có ca (phân bổ chi phí phương pháp R)
 *   rows(employeeIds, from, to)     ô theo dạng record roster: {id | null, employee, work_date, shift (id | null), source, location,
 *                                   work_center, virtual?: true}; ô suy ra từ chế độ ca có source "A", id null
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Lean", "../core/Dates", "../core/RosterPlan", "../core/ShiftAssign"], (Store, Lean, Dates, Plan, Assign) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const DATE = "TO_DATE(?, 'YYYY-MM-DD')";

	const toCore = (a) => ({
		id: String(a.id), scope: a.scope || "", employee: a.employee || null, team: a.team || null, department: a.department || null, paygroup: a.paygroup || null,
		subsidiary: a.subsidiary || null, patternId: a.pattern || null, anchor: a.anchor || null, effective: a.effective || null, expiration: a.expiration || null, note: a.note || "",
	});

	function schemes(subsidiary) {
		let list;
		try {
			list = Store.find("shift_assign");
		} catch (e) {
			// Account chưa deploy record chế độ ca: coi như chưa khai
			return [];
		}
		return list.map(toCore).filter((a) => blank(subsidiary) || blank(a.subsidiary) || String(a.subsidiary) === String(subsidiary));
	}

	function patternsById() {
		const out = {};
		for (const p of Store.find("shift_pattern", { includeInactive: true })) {
			out[String(p.id)] = { code: norm(p.name), cycle: String(p.cycle || "").split(",").map((c) => (c.trim() === "" || c.trim() === "-" ? null : c.trim().toUpperCase())) };
		}
		return out;
	}

	function people(employeeIds) {
		const ids = [...new Set((employeeIds || []).filter((e) => !blank(e)).map(String))];
		const out = {};
		for (const e of ids) out[e] = { employee: e, subsidiary: null, department: null, paygroup: null, memberships: [] };
		if (!ids.length) return out;
		for (const p of Store.findIn("employee", "employee", ids)) {
			const o = out[String(p.employee)];
			if (!o) continue;
			o.subsidiary = p.subsidiary || null;
			o.paygroup = p.paygroup || null;
		}
		for (let i = 0; i < ids.length; i += 900) {
			const list = Lean.idList(ids.slice(i, i + 900));
			for (const r of Store.run(`SELECT e.id AS id, e.department AS department FROM employee e WHERE e.id IN (${list})`, [], "s4vp_er_dept")) {
				if (out[String(r.id)]) out[String(r.id)].department = blank(r.department) ? null : String(r.department);
			}
		}
		for (const m of Store.findIn("team_member", "employee", ids)) {
			const o = out[String(m.employee)];
			if (o) o.memberships.push({ team: String(m.team), effectiveDate: m.effective || null, expirationDate: m.expiration || null });
		}
		return out;
	}

	function stored(employeeIds, from, to) {
		return Store.findIn("roster", "employee", employeeIds, `{work_date} >= ${DATE} AND {work_date} <= ${DATE}`, [from, to]).filter((r) => r.work_date && Dates.within(r.work_date, from, to));
	}

	function rows(employeeIds, from, to) {
		const f = Dates.iso(from);
		const t = Dates.iso(to);
		const ids = [...new Set((employeeIds || []).filter((e) => !blank(e)).map(String))];
		const have = stored(ids, f, t);
		const list = schemes();
		if (!list.length || !ids.length) return have;
		const pats = patternsById();
		const shiftId = {};
		for (const s of Store.find("shift", { includeInactive: true })) shiftId[norm(s.name)] = String(s.id);
		const taken = new Set(have.map((r) => Plan.key(r.employee, r.work_date)));
		const who = people(ids);
		const out = have.slice();
		for (const e of ids) {
			for (const c of Assign.cells(who[e], f, t, list, pats)) {
				if (taken.has(Plan.key(e, c.workDate))) continue;
				// Mã ca của mẫu không còn tồn tại: coi như chưa xếp (không coi là ngày nghỉ)
				if (c.shiftCode && !shiftId[c.shiftCode]) continue;
				out.push({ id: null, employee: e, work_date: c.workDate, shift: c.shiftCode ? shiftId[c.shiftCode] : null, source: "A", location: null, work_center: null, virtual: true });
			}
		}
		return out;
	}

	/** Ngày thuộc đơn nghỉ, đơn công tác đã duyệt trong [from, to]: tập khóa nhân viên|ngày. */
	function excused(ids, from, to) {
		const out = new Set();
		for (const name of ["leave_request", "business_trip"]) {
			for (const d of Store.findIn(name, "employee", ids, `{from} <= ${DATE} AND {to} >= ${DATE}`, [to, from])) {
				if (d.status !== "A" || !d.from) continue;
				const s = Dates.max(d.from, from);
				const e = Dates.min(d.to || d.from, to);
				if (Dates.cmp(e, s) < 0) continue;
				for (const day of Dates.range(s, e)) out.add(Plan.key(d.employee, day));
			}
		}
		return out;
	}

	function forPayroll(employeeIds, from, to) {
		const f = Dates.iso(from);
		const t = Dates.iso(to);
		const ids = [...new Set((employeeIds || []).filter((e) => !blank(e)).map(String))];
		const out = { counts: {}, days: {} };
		if (!ids.length) return out;
		const cells = rows(ids, f, t).filter((c) => !blank(c.shift));
		if (!cells.length) return out;
		const shiftOf = {};
		for (const s of Store.find("shift", { includeInactive: true })) shiftOf[String(s.id)] = { code: norm(s.name), kind: s.kind || "D" };
		const off = excused(ids, f, t);
		for (const c of cells) {
			const s = shiftOf[String(c.shift)];
			if (!s) continue;
			const e = String(c.employee);
			(out.days[e] = out.days[e] || []).push({ date: c.work_date, shiftCode: s.code, branch: c.location || "", workCenter: c.work_center || "" });
			if (off.has(Plan.key(e, c.work_date))) continue;
			const k = out.counts[e] || (out.counts[e] = { D: 0, E: 0, N: 0 });
			k[s.kind] = (k[s.kind] || 0) + 1;
		}
		return out;
	}

	return { schemes, patternsById, people, stored, rows, forPayroll, toCore };
});
