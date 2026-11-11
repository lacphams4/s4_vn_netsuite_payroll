/**
 * Phần tính thuần của cổng tự phục vụ nhân viên (Suitelet s4vp_sl_my_payroll): không đọc ghi NetSuite.
 *
 * maskTail(value, keep = 4) -> chuỗi che, chỉ giữ `keep` ký tự cuối ("****6789"); chuỗi ngắn giữ ít hơn (không quá nửa
 *   độ dài); rỗng trả "". Dùng cho mã số thuế, số tài khoản, số định danh, số sổ BHXH: giá trị đầy đủ không rời máy chủ.
 * parseDate(text) -> 'YYYY-MM-DD' hoặc null; nhận dd/mm/yyyy và yyyy-mm-dd, kiểm ngày có thật.
 * slipView(line, detail, names) -> phiếu lương một kỳ của một người: { figures, earnings, insurance, deductions }.
 *   line: dòng batch_emp; detail: JSON chi tiết đã parse; names: { earning: {MÃ: tên}, insurance: {MÃ: tên} }.
 * pickPrevious(slips, current) -> phiếu kỳ liền trước theo NGÀY KẾT THÚC KỲ (không theo mã kỳ) hoặc null.
 * compareSlips(current, previous) -> { hasPrevious, totals: {key: delta}, earnings, insurance, deductions, reasons }.
 *   Mỗi khoản: { code, name, current, previous, diff, pct, kind: new | gone | both }. reasons: các khoản làm thực lĩnh
 *   đổi nhiều nhất, `effect` = tác động lên thực lĩnh (thu nhập tăng là dương, khấu trừ tăng là âm).
 * leaveView(balances, leaveTypes) -> số dư phép theo loại (available tính bằng LeaveLedger).
 * requestRow(type, doc, leaveTypes) -> dòng đơn cho màn hình, kèm canEdit / canSubmit / canCancel.
 * groupRequests(rows) -> { open (H, P), closed (A, R, C), counts: {H, P, A, R, C} }.
 * validateRequest(type, values, ctx) -> { values (đã lọc theo danh sách trường cho phép, đã chuẩn hóa), errors }.
 *   KHÔNG nhận employee, subsidiary, status... từ trình duyệt: các trường đó do máy chủ đặt.
 * isOwn(doc, employee) -> chứng từ thuộc đúng nhân viên.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./PayCompare", "./LeaveLedger"], (Money, Dates, PayCompare, Ledger) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const num = (v) => (blank(v) || isNaN(Number(v)) ? 0 : Number(v));
	const TYPES = ["leave", "ot", "trip"];
	// Trường nhân viên được tự nhập trên đơn; mọi trường khác do máy chủ đặt hoặc gói tính
	const FIELDS = {
		leave: ["leave_type", "from", "from_half", "to", "to_half", "reason"],
		ot: ["work_date", "hours", "is_night", "reason"],
		trip: ["from", "to", "destination", "purpose", "advance_amount"],
	};
	const FIGURES = ["gross", "exempt", "taxable", "ee_ins", "family_ded", "other_tax_ded", "assessable", "pit", "other_ded", "advance", "net"];
	const TOTAL_KEYS = ["gross", "ee_ins", "pit", "other_ded", "advance", "net"];
	const MASK = "****";

	function maskTail(value, keep) {
		const s = String(blank(value) ? "" : value).replace(/\s+/g, "");
		if (!s) return "";
		const want = keep === undefined || keep === null ? 4 : Math.max(0, Math.floor(Number(keep) || 0));
		const n = Math.min(want, Math.floor(s.length / 2));
		return MASK + (n > 0 ? s.slice(-n) : "");
	}

	function parseDate(text) {
		const s = String(blank(text) ? "" : text).trim();
		let y;
		let m;
		let d;
		let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
		if (hit) [y, m, d] = [+hit[1], +hit[2], +hit[3]];
		else {
			hit = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
			if (!hit) return null;
			[d, m, y] = [+hit[1], +hit[2], +hit[3]];
		}
		if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
		if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
		return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
	}

	// ------------------------------------------------------------------ phiếu lương

	function slipView(line, detail, names) {
		const l = line || {};
		const d = detail || {};
		const nm = names || {};
		const figures = {};
		for (const k of FIGURES) figures[k] = Money.round(num(l[k]));
		figures.std_days = num(l.std_days);
		figures.work_days = num(l.work_days);
		figures.paid_leave = num(l.paid_leave);
		figures.unpaid_leave = num(l.unpaid_leave);
		figures.ot_hours = num(l.ot_hours);
		figures.dependents = num(l.dependents);
		const earnings = (d.earnings || [])
			.filter((e) => e && num(e.amount) !== 0)
			.map((e) => {
				const code = norm(e.earningType || e.code);
				return { code, name: (nm.earning || {})[code] || e.name || code, quantity: num(e.quantity), rate: num(e.rate), amount: num(e.amount) };
			});
		const insurance = (d.insurance || [])
			.filter((i) => i && num(i.employeeAmount) !== 0)
			.map((i) => {
				const code = norm(i.code);
				return { code, name: (nm.insurance || {})[code] || i.name || code, amount: num(i.employeeAmount) };
			});
		const deductions = (d.deductions || [])
			.filter((x) => x && num(x.amount) !== 0)
			.map((x) => ({ code: norm(x.code || x.name), name: x.name || x.code || "", amount: num(x.amount) }));
		return { figures, earnings, insurance, deductions };
	}

	function pickPrevious(slips, current) {
		const end = current && current.end ? String(current.end) : "";
		if (!end) return null;
		let best = null;
		for (const s of slips || []) {
			if (!s || !s.end || String(s.batch) === String(current.batch)) continue;
			const e = String(s.end);
			if (e >= end) continue;
			if (!best || e > String(best.end) || (e === String(best.end) && Number(s.batch) > Number(best.batch))) best = s;
		}
		return best;
	}

	function compareSlips(current, previous) {
		const cur = current || { figures: {}, earnings: [], insurance: [], deductions: [] };
		const has = !!previous;
		const prev = previous || {};
		const totals = {};
		for (const k of TOTAL_KEYS) totals[k] = PayCompare.delta(cur.figures[k], has ? (prev.figures || {})[k] || 0 : null);
		const items = (key) => PayCompare.compareItems(cur[key] || [], has ? prev[key] || [] : null);
		const out = { hasPrevious: has, totals, earnings: items("earnings"), insurance: items("insurance"), deductions: items("deductions"), reasons: [] };
		if (!has) return out;
		// Tác động lên thực lĩnh: thu nhập cùng chiều, các khoản trừ ngược chiều
		const reasons = [];
		for (const r of out.earnings) if (r.diff) reasons.push({ group: "earning", code: r.code, name: r.name, kind: r.kind, effect: r.diff });
		for (const r of out.insurance) if (r.diff) reasons.push({ group: "insurance", code: r.code, name: r.name, kind: r.kind, effect: -r.diff });
		for (const r of out.deductions) if (r.diff) reasons.push({ group: "deduction", code: r.code, name: r.name, kind: r.kind, effect: -r.diff });
		if (totals.pit.diff) reasons.push({ group: "pit", code: "PIT", name: "", kind: "both", effect: -totals.pit.diff });
		if (totals.advance.diff) reasons.push({ group: "advance", code: "ADVANCE", name: "", kind: "both", effect: -totals.advance.diff });
		reasons.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
		out.reasons = reasons.slice(0, 5);
		return out;
	}

	// ------------------------------------------------------------------ phép

	function leaveView(balances, leaveTypes) {
		const lt = leaveTypes || {};
		return (balances || [])
			.map((b) => {
				const t = lt[b.leave_type] || {};
				const bal = { entitled: b.entitled || 0, carriedOver: b.carried || 0, carryOverExpiryDate: b.carry_expiry || null, adjusted: b.adjusted || 0, used: b.used || 0, pending: b.pending || 0 };
				return {
					leaveType: String(b.leave_type), code: t.code || "", name: t.name || t.code || "", year: num(b.year),
					entitled: num(b.entitled), carried: num(b.carried), carryExpiry: b.carry_expiry || null, adjusted: num(b.adjusted), used: num(b.used), pending: num(b.pending),
					available: Ledger.available(bal),
				};
			})
			.sort((a, b) => a.code.localeCompare(b.code));
	}

	// ------------------------------------------------------------------ đơn

	const isOwn = (doc, employee) => !!doc && !blank(employee) && !blank(doc.employee) && String(doc.employee) === String(employee);

	function requestRow(type, doc, leaveTypes) {
		const d = doc || {};
		const status = d.status || "H";
		const locked = !!d.summary_locked;
		const row = {
			type, id: String(d.id), number: d.name || "", status,
			from: type === "ot" ? d.work_date || null : d.from || null,
			to: type === "ot" ? d.work_date || null : d.to || d.from || null,
			days: type === "ot" ? null : blank(d.days) ? null : num(d.days),
			hours: type === "ot" ? num(d.hours) : null,
			reason: String((type === "trip" ? d.purpose : d.reason) || ""),
			rejectReason: status === "R" ? String(d.reject_reason || "") : "",
			canEdit: status === "H" && !locked,
			canSubmit: status === "H" && !locked,
			// Nhân viên chỉ tự hủy đơn còn chờ duyệt; đơn đã duyệt do bộ phận nhân sự hủy (hoàn phép, tạm ứng)
			canCancel: status === "P" && !locked,
		};
		if (type === "leave") {
			const t = (leaveTypes || {})[d.leave_type] || {};
			Object.assign(row, { leaveType: blank(d.leave_type) ? "" : String(d.leave_type), leaveCode: t.code || "", leaveName: t.name || t.code || "", fromHalf: d.from_half || "", toHalf: d.to_half || "" });
		} else if (type === "ot") {
			Object.assign(row, { isNight: !!d.is_night, dayType: d.day_type || "" });
		} else {
			Object.assign(row, { destination: d.destination || "", advanceAmount: num(d.advance_amount) });
		}
		return row;
	}

	function groupRequests(rows) {
		const counts = { H: 0, P: 0, A: 0, R: 0, C: 0 };
		const open = [];
		const closed = [];
		const key = (r) => `${r.from || ""}|${String(r.id).padStart(12, "0")}`;
		for (const r of (rows || []).slice().sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0))) {
			if (counts[r.status] !== undefined) counts[r.status] += 1;
			(r.status === "H" || r.status === "P" ? open : closed).push(r);
		}
		return { open, closed, counts };
	}

	function validateRequest(type, input, ctx) {
		const c = ctx || {};
		const errors = [];
		const err = (field, code, en, vi) => errors.push({ field, code, en, vi });
		if (!TYPES.includes(type)) {
			err("type", "TYPE", "Unknown request type.", "Loại đơn không hợp lệ.");
			return { values: {}, errors };
		}
		const src = input || {};
		const v = {};
		for (const k of FIELDS[type]) if (Object.prototype.hasOwnProperty.call(src, k)) v[k] = src[k];
		const text = (k, max) => {
			v[k] = String(blank(v[k]) ? "" : v[k]).trim().slice(0, max);
		};
		const date = (k, en, vi) => {
			const iso = parseDate(v[k]);
			if (!iso) err(k, "DATE", en, vi);
			v[k] = iso;
			return iso;
		};
		if (type === "leave") {
			const lt = (c.leaveTypes || {})[v.leave_type];
			if (blank(v.leave_type) || !lt) err("leave_type", "LEAVE_TYPE", "Select a leave type.", "Chưa chọn loại nghỉ.");
			else v.leave_type = String(v.leave_type);
			const from = date("from", "Enter a valid start date (dd/mm/yyyy).", "Nhập ngày bắt đầu hợp lệ (dd/mm/yyyy).");
			if (blank(src.to)) v.to = from;
			const to = blank(src.to) ? from : date("to", "Enter a valid end date (dd/mm/yyyy).", "Nhập ngày kết thúc hợp lệ (dd/mm/yyyy).");
			if (from && to && to < from) err("to", "RANGE", "The end date is before the start date.", "Ngày kết thúc trước ngày bắt đầu.");
			v.from_half = v.from_half === "P" ? "P" : "A";
			v.to_half = v.to_half === "A" ? "A" : "P";
			if (lt && lt.allowHalf === false) Object.assign(v, { from_half: "A", to_half: "P" });
			if (from && to && from === to && v.from_half === "P" && v.to_half === "A") err("to_half", "HALF", "The leave ends before it starts on the same day.", "Trong cùng một ngày, buổi kết thúc đang trước buổi bắt đầu.");
			text("reason", 1000);
		} else if (type === "ot") {
			date("work_date", "Enter a valid overtime date (dd/mm/yyyy).", "Nhập ngày làm thêm hợp lệ (dd/mm/yyyy).");
			const h = Number(String(blank(v.hours) ? "" : v.hours).replace(",", "."));
			if (blank(v.hours) || isNaN(h) || h <= 0 || h > 12) err("hours", "HOURS", "Overtime hours must be greater than 0 and at most 12.", "Số giờ làm thêm phải lớn hơn 0 và không quá 12.");
			v.hours = isNaN(h) ? null : Money.roundTo(h, 2);
			v.is_night = v.is_night === true || v.is_night === "T" || v.is_night === "true" || v.is_night === 1;
			text("reason", 1000);
			if (!v.reason) err("reason", "REASON", "Enter the reason for the overtime.", "Nhập lý do làm thêm.");
		} else {
			const from = date("from", "Enter a valid start date (dd/mm/yyyy).", "Nhập ngày bắt đầu hợp lệ (dd/mm/yyyy).");
			if (blank(src.to)) v.to = from;
			const to = blank(src.to) ? from : date("to", "Enter a valid end date (dd/mm/yyyy).", "Nhập ngày kết thúc hợp lệ (dd/mm/yyyy).");
			if (from && to && to < from) err("to", "RANGE", "The end date is before the start date.", "Ngày kết thúc trước ngày bắt đầu.");
			text("destination", 300);
			text("purpose", 1000);
			if (!v.destination) err("destination", "DESTINATION", "Enter the destination.", "Nhập nơi công tác.");
			if (!v.purpose) err("purpose", "PURPOSE", "Enter the purpose of the trip.", "Nhập mục đích công tác.");
			const a = blank(v.advance_amount) ? 0 : Number(String(v.advance_amount).replace(/[.\s]/g, "").replace(",", "."));
			if (isNaN(a) || a < 0) err("advance_amount", "ADVANCE", "The advance amount must be zero or more.", "Số tiền tạm ứng phải từ 0 trở lên.");
			v.advance_amount = isNaN(a) ? 0 : Money.round(a);
		}
		return { values: v, errors };
	}

	return { TYPES, FIELDS, FIGURES, TOTAL_KEYS, maskTail, parseDate, slipView, pickPrevious, compareSlips, leaveView, isOwn, requestRow, groupRequests, validateRequest };
});
