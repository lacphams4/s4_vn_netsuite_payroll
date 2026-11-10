/**
 * Lưới công theo kỳ của giao diện bản 2 (docs/UI_V2.md, mẫu docs/design/TinhCong.dc.html): mỗi nhân viên một dòng, mỗi ngày
 * của kỳ một ô, kèm tổng công và danh sách ngoại lệ cần xử lý. Chỉ đọc và suy ra, không lưu gì.
 *
 * Gói lưu công theo ba cách, lưới bám đúng từng cách (không giả định dữ liệu theo ngày khi không có):
 *   - Nhóm lương nguồn công E (chứng từ ngoại lệ): không có bản ghi công từng ngày. Ô ngày được SUY RA từ lịch (nghỉ tuần,
 *     ngày lễ, thời hạn hợp đồng) và chứng từ đã duyệt (đơn nghỉ, công tác, phiếu ngoại lệ, đơn làm thêm): ngày làm việc
 *     không có chứng từ là đủ công, đúng mô hình của AttendanceSummaryCalculator.buildExceptions. Tổng của dòng lấy từ bảng
 *     tổng hợp công đã lập (nếu có), nếu chưa có thì là số dự tính từ chính bộ tính đó.
 *   - Nhóm lương nguồn công S (bảng công ký hiệu): ô ngày là ký hiệu người dùng nhập (ô D01..D31 tính từ ngày đầu kỳ), tra
 *     theo danh mục ký hiệu; ô trống ở ngày làm việc là "thiếu dữ liệu", ký hiệu lạ là "không hợp lệ".
 *   - Cộng tác viên ở nhóm nguồn E không có bảng công: ô ngày là số giờ từ bản ghi Time (đã nhận vào lương / còn chờ duyệt).
 *
 * Ô ngày: { s, k, v?, ot?, p?, late?, hp? }
 *   s  chữ hiển thị (ký hiệu của danh mục ký hiệu bảng công: X, /2, P, P/2, K, Ô, CT, L...; số giờ; số công lẻ)
 *   k  nhóm: W làm việc, P nghỉ có lương, U nghỉ không lương, S nghỉ BHXH trả, T công tác (năm nhóm của ký hiệu bảng công),
 *      N không tính công (nghỉ tuần, ngày lễ), A công đã điều chỉnh (trễ sớm, điều chỉnh công), H giờ cộng tác viên,
 *      O ngoài thời hạn hợp đồng, M thiếu dữ liệu, "?" ký hiệu không có trong danh mục
 *   v  số công của ngày (chỉ ô có công), ot giờ làm thêm đã duyệt, p số chứng từ còn chờ xử lý phủ ngày đó,
 *      late = 1 khi có phiếu trễ sớm đã duyệt, hp giờ cộng tác viên còn chờ duyệt
 *
 * Ngoại lệ: { key, type, severity: "warn" | "info", employee, date?, dayIndex?, ... }. severity "warn" là việc cần xử lý trước
 * khi khóa công (đếm vào bước 2 của thanh bước); "info" chỉ để biết. Các loại:
 *   pendingDoc    chứng từ còn Tạm giữ / Chờ duyệt giao kỳ (docType leave | ot | trip | exception, docId, docName, status;
 *                 phiếu ngoại lệ có subtype late | early | missingPunch | absent | adjust)
 *   noSummary     kỳ đã lập bảng tổng hợp nhưng nhân viên chưa có dòng
 *   staleSummary  dòng tổng hợp khác số tính lại từ chứng từ hiện tại (cần tổng hợp lại)
 *   noSheetRow    nhóm nguồn S: nhân viên chưa có dòng bảng công
 *   sheetMissing  nhóm nguồn S: ngày làm việc chưa nhập ký hiệu (count, dayIndex đầu tiên)
 *   unknownSymbol nhóm nguồn S: ký hiệu không có trong danh mục (count, codes)
 *   pendingHours  cộng tác viên: giờ Time còn chờ duyệt (hours)
 *   overStandard  (info) công hưởng lương lớn hơn công chuẩn
 *   noHours       (info) cộng tác viên hưởng theo giờ chưa có giờ Time nào trong kỳ
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./Money", "./WorkingDayCounter", "./EmploymentDays", "./AttendanceSummaryCalculator", "./AttendanceSheetCalculator"], (Dates, Money, WorkingDays, EmploymentDays, Summary, Sheet) => {
	const D = Money.D;
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const n = (v) => (blank(v) || !isFinite(Number(v)) ? 0 : Number(v));
	const PENDING = ["H", "P"];
	const MAX_SHEET_DAYS = 31;
	// Ký hiệu mặc định của gói (core/VietnamDefaults.attendanceSymbols) dùng khi danh mục ký hiệu chưa có nhóm tương ứng
	const FALLBACK = { W: { 1: "X", 0.5: "/2" }, P: { 1: "P", 0.5: "P/2" }, U: { 1: "K", 0.5: "K/2" }, S: { 1: "Ô", 0.5: "Ô/2" }, T: { 1: "CT", 0.5: "CT/2" }, N: { 0: "L" } };
	// Các số so sánh giữa dòng tổng hợp đã lập và số tính lại
	const COMPARE = [["std_days", "standardDays"], ["paid_leave", "paidLeaveDays"], ["unpaid_leave", "unpaidLeaveDays"], ["si_leave", "socialInsuranceLeaveDays"], ["trip_days", "businessTripDays"], ["late_days", "lateEarlyDays"], ["adjust_days", "adjustmentDays"], ["work_days", "workDays"], ["ot_hours", "overtimeHours"]];

	/** Số hiển thị gọn: tối đa 2 số lẻ, dấu phẩy thập phân (0,5; 7,75; 8). */
	function short(v) {
		return String(Money.roundTo(n(v), 2)).replace(".", ",");
	}

	/**
	 * Bảng tra ký hiệu: theo mã (không phân biệt hoa thường) và ký hiệu đại diện của từng nhóm theo số ngày một ô.
	 * @param {Array<{code, category, days, description?}>} symbols danh mục ký hiệu bảng công (att_symbol)
	 */
	function symbolTable(symbols) {
		const byCode = new Map();
		const pickOf = {};
		for (const s of symbols || []) {
			const code = String(blank(s.code) ? "" : s.code).trim();
			if (!code) continue;
			const item = { code, category: s.category, days: n(s.days), description: s.description || "" };
			if (!byCode.has(code.toUpperCase())) byCode.set(code.toUpperCase(), item);
			const key = `${item.category}|${item.days}`;
			// Nhiều ký hiệu cùng nhóm, cùng số ngày: lấy ký hiệu ngắn nhất (X trước XD)
			if (!pickOf[key] || code.length < pickOf[key].length) pickOf[key] = code;
		}
		return {
			get: (code) => byCode.get(norm(code)) || null,
			/** Ký hiệu của nhóm với số ngày một ô (1 hoặc 0,5; nhóm N dùng 0). */
			of: (category, days) => pickOf[`${category}|${days}`] || (FALLBACK[category] || {})[days] || "",
		};
	}

	/**
	 * Các ngày của kỳ theo ngày bắt đầu - kết thúc (kỳ có thể không trùng tháng lịch).
	 * @returns {Array<{date, day, month, dow, type: "N"|"W"|"H", name?}>} dow 0 = Chủ nhật; type N ngày thường, W nghỉ tuần, H lễ
	 */
	function days(period, weeklyOff, holidays) {
		const ps = Dates.iso(period.startDate);
		const pe = Dates.iso(period.endDate);
		if (!ps || !pe || Dates.cmp(pe, ps) < 0) return [];
		const names = {};
		for (const h of holidays || []) {
			const d = typeof h === "object" && h !== null ? h.date || h.holidayDate : h;
			if (d) names[Dates.iso(d)] = (typeof h === "object" && h !== null && h.name) || "";
		}
		const set = WorkingDays.holidaySet(holidays);
		return Dates.range(ps, pe).map((date) => {
			const out = { date, day: Dates.day(date), month: Dates.month(date), dow: Dates.dayOfWeek(date), type: WorkingDays.dayType(date, weeklyOff, set) };
			if (out.type === "H" && names[date]) out.name = names[date];
			return out;
		});
	}

	/** Nhân viên có thuộc lưới công của kỳ: đang hoạt động hoặc nghỉ việc trong kỳ, và có làm ít nhất một ngày trong kỳ. */
	function inPeriod(emp, period) {
		const ps = Dates.iso(period.startDate);
		const pe = Dates.iso(period.endDate);
		if (emp.isInactive && !EmploymentDays.terminatesIn(emp.terminationDate, ps, pe)) return false;
		return EmploymentDays.employedIn(emp.hireDate, emp.terminationDate, ps, pe);
	}

	/**
	 * Nguồn công của một dòng: "sheet" bảng công ký hiệu, "docs" suy từ chứng từ, "time" giờ Time của cộng tác viên.
	 * Cùng quy tắc với EmploymentDays.inAttendanceSummary: cộng tác viên chỉ vào bảng tổng hợp khi nhóm dùng bảng công ký hiệu.
	 */
	function sourceOf(emp, mode) {
		if (mode === "S") return "sheet";
		return emp.employmentType === "C" ? "time" : "docs";
	}

	function employedOn(emp, date) {
		return (!emp.hireDate || Dates.cmp(emp.hireDate, date) <= 0) && (!emp.terminationDate || Dates.cmp(emp.terminationDate, date) >= 0);
	}

	function group(list, keyOf) {
		const out = {};
		for (const x of list || []) {
			const k = String(keyOf(x));
			(out[k] = out[k] || []).push(x);
		}
		return out;
	}

	/** Phần ngày (1 hoặc 0,5) của đơn nghỉ rơi vào một ngày: ngày đầu bắt đầu buổi chiều, ngày cuối kết thúc buổi sáng là nửa ngày. */
	function leavePortion(leave, date) {
		const from = Dates.iso(leave.from);
		const to = Dates.iso(leave.to || leave.from);
		if (Dates.cmp(date, from) < 0 || Dates.cmp(date, to) > 0) return 0;
		let halves = 2;
		if (date === from && leave.from_half === "P") halves -= 1;
		if (date === to && leave.to_half === "A") halves -= 1;
		return Math.max(0, halves) / 2;
	}

	function leaveCategory(type) {
		const t = type || {};
		if (t.paidBySocialInsurance) return "S";
		if (t.deductsWorkDays) return "U";
		return "P";
	}

	function docRange(type, d) {
		if (type === "leave" || type === "trip") return { from: Dates.iso(d.from), to: Dates.iso(d.to || d.from) };
		return { from: Dates.iso(d.work_date), to: Dates.iso(d.work_date) };
	}

	/** Loại con của phiếu ngoại lệ: trễ, sớm, thiếu lượt chấm (sinh từ chấm công, điều chỉnh 0), vắng (sinh từ chấm công, -1), điều chỉnh tay. */
	function exceptionSubtype(x) {
		if (x.exception_type === "L") return "late";
		if (x.exception_type === "E") return "early";
		if (x.from_punches) return n(x.adjust_days) < 0 ? "absent" : "missingPunch";
		return "adjust";
	}

	/** Giờ Time được nhận vào lương, cùng quy tắc với api/TimeLines.accepted (usesApproval tính trên toàn bộ danh sách). */
	function timeState(entries, requireApproval) {
		const usesApproval = (entries || []).some((e) => e.approval !== "N");
		return (e) => {
			if (!usesApproval) return "accepted";
			if (e.approval === "R") return "rejected";
			if (requireApproval) return e.approval === "A" ? "accepted" : "pending";
			return "accepted";
		};
	}

	function workSymbol(v, table) {
		if (v === 1) return table.of("W", 1);
		if (v === 0.5) return table.of("W", 0.5);
		return short(v);
	}

	// ------------------------------------------------------------------ dòng theo từng nguồn công

	/** Ô ngày của nhân viên nhóm nguồn E, suy từ lịch và chứng từ đã duyệt. */
	function docCells(emp, dayList, docs, leaveTypes, table) {
		const approved = (list) => (list || []).filter((d) => d.status === "A");
		const leaves = approved(docs.leaves);
		const trips = approved(docs.trips);
		const exceptions = group(approved(docs.exceptions), (x) => Dates.iso(x.work_date));
		return dayList.map((day) => {
			if (!employedOn(emp, day.date)) return { s: "", k: "O" };
			const working = day.type === "N";
			let kind = working ? "W" : "N";
			let v = D(working ? 1 : 0);
			let portion = 0;
			if (working) {
				for (const l of leaves) {
					const p = leavePortion(l, day.date);
					if (p <= 0) continue;
					const cat = leaveCategory(leaveTypes[l.leave_type]);
					// Hai đơn cùng ngày (sáng một loại, chiều một loại): ô hiện loại trừ công, số công vẫn trừ đủ từng đơn
					if (kind === "W" || (cat !== "P" && kind === "P")) kind = cat;
					portion += p;
					if (cat !== "P") v = v.minus(p);
				}
				if (kind === "W" && trips.some((t) => Dates.within(day.date, Dates.iso(t.from), Dates.iso(t.to || t.from)))) kind = "T";
			}
			let changed = false;
			let late = false;
			for (const x of exceptions[day.date] || []) {
				changed = true;
				if (x.exception_type === "A") v = v.plus(n(x.adjust_days));
				else {
					v = v.minus(n(x.deduct_days));
					late = true;
				}
			}
			const value = Money.max(0, v).toNumber();
			let cell;
			if (kind === "W") cell = { s: workSymbol(value, table), k: changed && value !== 1 ? "A" : "W", v: value };
			else if (kind === "N") cell = changed && value > 0 ? { s: workSymbol(value, table), k: "A", v: value } : { s: day.type === "H" ? table.of("N", 0) : "", k: "N" };
			else if (kind === "T") cell = { s: table.of("T", 1), k: "T", v: value };
			else cell = { s: table.of(kind, portion >= 1 ? 1 : 0.5), k: kind, v: value };
			if (late) cell.late = 1;
			return cell;
		});
	}

	/** Ô ngày của nhân viên nhóm nguồn S: ký hiệu đã nhập; không có dòng thì mọi ô để trống. */
	function sheetCells(emp, dayList, sheet, table) {
		const cells = (sheet && sheet.cells) || [];
		return dayList.map((day, i) => {
			if (!employedOn(emp, day.date)) return { s: "", k: "O" };
			const code = i < MAX_SHEET_DAYS && !blank(cells[i]) ? String(cells[i]).trim() : "";
			if (!code) {
				if (!sheet) return { s: "", k: day.type === "N" ? "W" : "N", none: 1 };
				return day.type === "N" ? { s: "", k: "M" } : { s: "", k: "N" };
			}
			const sym = table.get(code);
			if (!sym) return { s: code, k: "?" };
			const cell = { s: sym.code, k: ["W", "P", "U", "S", "T"].includes(sym.category) ? sym.category : "N" };
			if (cell.k !== "N") cell.v = sym.days;
			return cell;
		});
	}

	/** Ô ngày của cộng tác viên: giờ Time đã nhận và còn chờ duyệt của từng ngày. */
	function timeCells(emp, dayList, entries, stateOf) {
		const byDate = group(entries, (e) => Dates.iso(e.date));
		return dayList.map((day) => {
			if (!employedOn(emp, day.date)) return { s: "", k: "O" };
			let ok = D(0);
			let wait = D(0);
			for (const e of byDate[day.date] || []) {
				const st = stateOf(e);
				if (st === "accepted") ok = ok.plus(n(e.hours));
				else if (st === "pending") wait = wait.plus(n(e.hours));
			}
			const h = ok.toNumber();
			const hp = wait.toNumber();
			if (!h && !hp) return { s: "", k: day.type === "N" ? "H" : "N" };
			const cell = { s: short(h + hp), k: "H", h };
			if (hp) cell.hp = hp;
			return cell;
		});
	}

	/** Gắn giờ làm thêm đã duyệt và số chứng từ còn chờ xử lý vào các ô. */
	function decorate(cells, dayList, docs) {
		const index = {};
		dayList.forEach((d, i) => (index[d.date] = i));
		for (const o of docs.overtime || []) {
			if (o.status !== "A") continue;
			const i = index[Dates.iso(o.work_date)];
			if (i === undefined) continue;
			cells[i].ot = D(cells[i].ot || 0).plus(n(o.hours)).toNumber();
		}
		const mark = (type, list) => {
			for (const d of list || []) {
				if (!PENDING.includes(d.status || "H")) continue;
				const r = docRange(type, d);
				if (!r.from) continue;
				for (let i = 0; i < dayList.length; i++) {
					if (!Dates.within(dayList[i].date, r.from, r.to)) continue;
					// Đơn nghỉ, công tác nhiều ngày: chỉ đánh dấu ngày làm việc
					if ((type === "leave" || type === "trip") && dayList[i].type !== "N") continue;
					cells[i].p = (cells[i].p || 0) + 1;
				}
			}
		};
		mark("leave", docs.leaves);
		mark("trip", docs.trips);
		mark("exception", docs.exceptions);
		mark("ot", docs.overtime);
		return cells;
	}

	/** Số dự tính của dòng (đơn vị và tên trường của bảng tổng hợp công) từ kết quả AttendanceSummaryCalculator. */
	function totalsOf(t) {
		const out = {};
		for (const [field, key] of COMPARE) out[field] = n(t[key]);
		return out;
	}

	function differs(summary, expected) {
		return COMPARE.some(([field]) => Math.abs(n(summary[field]) - n(expected[field])) > 0.0001);
	}

	// ------------------------------------------------------------------ dựng lưới

	/**
	 * Dựng lưới công của kỳ.
	 * @param {Object} input
	 * @param {{startDate, endDate, standardWorkDays}} input.period
	 * @param {"E"|"S"} [input.mode] nguồn công của nhóm lương (mặc định E)
	 * @param {string} input.weeklyOff ngày nghỉ hằng tuần của thiết lập chung
	 * @param {Array} input.holidays chuỗi ngày hoặc {date, name}
	 * @param {Object} input.leaveTypes {id: {code, deductsWorkDays, paidBySocialInsurance}}
	 * @param {Array<{code, category, days}>} input.symbols danh mục ký hiệu bảng công
	 * @param {Array<{employee, code, name, department?, employmentType, salaryType, hireDate, terminationDate, isInactive?}>} input.employees
	 * @param {Array} input.summaries dòng bảng tổng hợp công của kỳ (tên trường như record attendance)
	 * @param {Array<{employee, cells: string[]}>} input.sheets dòng bảng công ký hiệu của kỳ
	 * @param {Array} input.leaves đơn nghỉ giao kỳ (mọi trạng thái; tên trường như record leave_request)
	 * @param {Array} input.trips đơn công tác giao kỳ
	 * @param {Array} input.exceptions phiếu ngoại lệ trong kỳ
	 * @param {Array} input.overtime đơn làm thêm trong kỳ
	 * @param {Array<{employee, date, hours, approval}>} input.time dòng Time của cộng tác viên
	 * @param {boolean} [input.requireTimeApproval] thiết lập bắt buộc duyệt Time (mặc định true)
	 * @returns {{days, rows, exceptions, counts, stats, legend, hasSummary}}
	 */
	function build(input) {
		const period = input.period || {};
		const mode = input.mode === "S" ? "S" : "E";
		const dayList = days(period, input.weeklyOff, input.holidays);
		const ps = Dates.iso(period.startDate);
		const pe = Dates.iso(period.endDate);
		const table = symbolTable(input.symbols);
		const leaveTypes = input.leaveTypes || {};
		const employees = (input.employees || []).filter((e) => dayList.length && inPeriod(e, period));
		const ids = new Set(employees.map((e) => String(e.employee)));
		const mine = (list) => (list || []).filter((d) => ids.has(String(d.employee)));
		const by = (list) => group(mine(list), (d) => d.employee);
		const leaves = by(input.leaves);
		const trips = by(input.trips);
		const exc = by(input.exceptions);
		const ot = by(input.overtime);
		const time = by(input.time);
		const stateOf = timeState(mine(input.time), input.requireTimeApproval !== false);
		const summaries = {};
		for (const s of mine(input.summaries)) summaries[String(s.employee)] = s;
		const sheets = {};
		for (const s of mine(input.sheets)) sheets[String(s.employee)] = s;
		const hasSummary = Object.keys(summaries).length > 0;
		const corePeriod = { startDate: ps, endDate: pe, standardWorkDays: n(period.standardWorkDays) };
		const exceptions = [];
		const push = (e) => exceptions.push(e);

		const rows = employees.map((emp) => {
			const id = String(emp.employee);
			const source = sourceOf(emp, mode);
			const docs = { leaves: leaves[id] || [], trips: trips[id] || [], exceptions: exc[id] || [], overtime: ot[id] || [] };
			const summary = summaries[id] || null;
			const row = {
				employee: id, code: emp.code || "", name: emp.name || "", department: emp.department || "", contractor: emp.employmentType === "C",
				salaryType: emp.salaryType || "M", source, hasSummary: !!summary, locked: !!summary && summary.status === "L",
			};
			const coreEmp = { hireDate: emp.hireDate || null, terminationDate: emp.terminationDate || null };
			const approvedOt = docs.overtime.filter((o) => o.status === "A").map((o) => ({ refNbr: o.name, workDate: o.work_date, hours: n(o.hours), earningType: "" }));
			let cells;
			let expected = null;

			if (source === "time") {
				const list = time[id] || [];
				cells = timeCells(emp, dayList, list, stateOf);
				let hours = D(0);
				let pending = D(0);
				for (const e of list) {
					const st = stateOf(e);
					if (st === "accepted") hours = hours.plus(n(e.hours));
					else if (st === "pending") pending = pending.plus(n(e.hours));
				}
				row.hours = hours.toNumber();
				row.pendingHours = pending.toNumber();
				if (row.pendingHours > 0) {
					const first = list.filter((e) => stateOf(e) === "pending").map((e) => Dates.iso(e.date)).sort()[0];
					push({ key: `pendinghours:${id}`, type: "pendingHours", severity: "warn", employee: id, hours: row.pendingHours, date: first || null });
				} else if (row.hours === 0 && row.salaryType === "H") {
					push({ key: `nohours:${id}`, type: "noHours", severity: "info", employee: id });
				}
			} else if (source === "sheet") {
				const sheet = sheets[id] || null;
				row.hasSheet = !!sheet;
				cells = sheetCells(emp, dayList, sheet, table);
				const totals = sheet ? Sheet.total((sheet.cells || []).slice(0, Math.min(dayList.length, MAX_SHEET_DAYS)), input.symbols || []) : null;
				expected = totalsOf(Summary.buildSheet({ period: corePeriod, employee: coreEmp, weeklyOff: input.weeklyOff, holidays: input.holidays, sheetTotals: totals, overtime: approvedOt }));
				if (!sheet) push({ key: `nosheet:${id}`, type: "noSheetRow", severity: "warn", employee: id });
				else {
					const missing = [];
					const unknown = [];
					cells.forEach((c, i) => {
						if (c.k === "M") missing.push(i);
						else if (c.k === "?") unknown.push(i);
					});
					if (unknown.length) push({ key: `unknown:${id}`, type: "unknownSymbol", severity: "warn", employee: id, count: unknown.length, codes: [...new Set(unknown.map((i) => cells[i].s))], dayIndex: unknown[0], date: dayList[unknown[0]].date });
					if (missing.length) push({ key: `missing:${id}`, type: "sheetMissing", severity: "warn", employee: id, count: missing.length, dayIndex: missing[0], date: dayList[missing[0]].date });
				}
			} else {
				cells = docCells(emp, dayList, docs, leaveTypes, table);
				const approved = (list) => list.filter((d) => d.status === "A");
				expected = totalsOf(Summary.buildExceptions({
					period: corePeriod, employee: coreEmp, weeklyOff: input.weeklyOff, holidays: input.holidays,
					leaveRequests: approved(docs.leaves).map((l) => ({ refNbr: l.name, fromDate: l.from, toDate: l.to || l.from, fromHalf: l.from_half || "A", toHalf: l.to_half || "P", leaveType: leaveTypes[l.leave_type] || {} })),
					trips: approved(docs.trips).map((t) => ({ refNbr: t.name, fromDate: t.from, toDate: t.to || t.from })),
					exceptions: approved(docs.exceptions).map((x) => ({ refNbr: x.name, workDate: x.work_date, exceptionType: x.exception_type, deductDays: n(x.deduct_days), adjustDays: n(x.adjust_days) })),
					overtime: approvedOt,
				}));
			}
			row.cells = decorate(cells, dayList, docs);

			if (source !== "time") {
				if (summary) {
					row.totals = {};
					for (const [field] of COMPARE) row.totals[field] = n(summary[field]);
					row.stale = differs(row.totals, expected);
					if (row.stale && !row.locked) push({ key: `stale:${id}`, type: "staleSummary", severity: "warn", employee: id });
					if (row.totals.work_days > row.totals.std_days + 0.0001) push({ key: `over:${id}`, type: "overStandard", severity: "info", employee: id, workDays: row.totals.work_days, standardDays: row.totals.std_days });
				} else {
					row.totals = expected;
					row.estimated = true;
					// Nhân viên nguồn S chưa có dòng bảng công đã có ngoại lệ noSheetRow, không báo hai lần
					if (hasSummary && !(source === "sheet" && !row.hasSheet)) push({ key: `nosummary:${id}`, type: "noSummary", severity: "warn", employee: id });
				}
			}

			const addDocs = (type, list) => {
				for (const d of list) {
					if (!PENDING.includes(d.status || "H")) continue;
					const r = docRange(type, d);
					if (!r.from) continue;
					const date = Dates.max(r.from, ps);
					const e = { key: `doc:${type}:${d.id}`, type: "pendingDoc", severity: "warn", employee: id, docType: type, docId: String(d.id), docName: d.name || "", status: d.status || "H", date, from: r.from, to: r.to };
					if (type === "leave") Object.assign(e, { days: n(d.days), leaveType: (leaveTypes[d.leave_type] || {}).code || "" });
					else if (type === "trip") e.days = n(d.days);
					else if (type === "ot") e.hours = n(d.hours);
					else Object.assign(e, { subtype: exceptionSubtype(d), minutes: n(d.minutes), days: d.exception_type === "A" ? n(d.adjust_days) : -n(d.deduct_days) });
					if (d.from_punches) e.fromPunches = true;
					push(e);
				}
			};
			addDocs("leave", docs.leaves);
			addDocs("trip", docs.trips);
			addDocs("exception", docs.exceptions);
			addDocs("ot", docs.overtime);
			return row;
		});

		// Gắn chỉ số ngày, số ngoại lệ theo dòng; sắp việc cần xử lý trước, rồi theo ngày, theo mã nhân viên
		const index = {};
		dayList.forEach((d, i) => (index[d.date] = i));
		const rowOf = {};
		for (const r of rows) {
			rowOf[r.employee] = r;
			r.open = 0;
		}
		for (const e of exceptions) {
			if (e.date && e.dayIndex === undefined && index[e.date] !== undefined) e.dayIndex = index[e.date];
			if (e.severity === "warn") rowOf[e.employee].open += 1;
		}
		const rank = (e) => (e.severity === "warn" ? 0 : 1);
		exceptions.sort((a, b) => rank(a) - rank(b) || String(a.date || "9999").localeCompare(String(b.date || "9999")) || String(rowOf[a.employee].code).localeCompare(String(rowOf[b.employee].code)) || a.key.localeCompare(b.key));

		return { days: dayList, rows, exceptions, counts: counts(exceptions), stats: stats(rows, input, ids), legend: legend(rows), hasSummary };
	}

	/** Số ngoại lệ: open (cần xử lý), info, và theo từng loại (pendingDoc tách thêm theo loại chứng từ). */
	function counts(exceptions) {
		const out = { open: 0, info: 0, byType: {} };
		for (const e of exceptions || []) {
			if (e.severity === "warn") out.open += 1;
			else out.info += 1;
			const k = e.type === "pendingDoc" ? `pendingDoc.${e.docType}` : e.type;
			out.byType[k] = (out.byType[k] || 0) + 1;
		}
		return out;
	}

	/** Số liệu cho các thẻ đầu màn hình. */
	function stats(rows, input, ids) {
		const s = { employees: rows.length, summaryEmployees: 0, contractors: 0, workDays: D(0), standardDays: D(0), otHours: D(0), contractorHours: D(0), contractorPending: D(0), estimated: 0 };
		for (const r of rows) {
			if (r.source === "time") {
				s.contractors += 1;
				s.contractorHours = s.contractorHours.plus(n(r.hours));
				s.contractorPending = s.contractorPending.plus(n(r.pendingHours));
				continue;
			}
			s.summaryEmployees += 1;
			if (r.estimated) s.estimated += 1;
			s.workDays = s.workDays.plus(n(r.totals.work_days));
			s.standardDays = s.standardDays.plus(n(r.totals.std_days));
			s.otHours = s.otHours.plus(n(r.totals.ot_hours));
		}
		for (const k of ["workDays", "standardDays", "otHours", "contractorHours", "contractorPending"]) s[k] = s[k].toNumber();
		const docs = { leave: 0, trip: 0, ot: 0, exception: 0, pending: 0 };
		const add = (type, list) => {
			for (const d of list || []) {
				if (!ids.has(String(d.employee)) || d.status === "R" || d.status === "C") continue;
				docs[type] += 1;
				if (PENDING.includes(d.status || "H")) docs.pending += 1;
			}
		};
		add("leave", input.leaves);
		add("trip", input.trips);
		add("ot", input.overtime);
		add("exception", input.exceptions);
		s.docs = docs;
		return s;
	}

	/** Chú giải: các cặp (ký hiệu, nhóm) có mặt trong lưới, mỗi nhóm một lần cho ký hiệu số (giờ, công lẻ). */
	function legend(rows) {
		const ORDER = ["W", "P", "U", "S", "T", "N", "A", "H", "M", "?", "O"];
		const seen = new Map();
		const flags = { pending: false, ot: false, late: false };
		for (const r of rows) {
			for (const c of r.cells) {
				if (c.p || c.hp) flags.pending = true;
				if (c.ot) flags.ot = true;
				if (c.late) flags.late = true;
				if (c.none) continue;
				// Ô số (giờ, công lẻ), ô trống: một mục cho cả nhóm
				const numeric = c.k === "H" || c.k === "A" || c.k === "M" || c.k === "?" || c.k === "O" || c.s === "";
				if (numeric && c.k === "N") continue;
				if (c.k === "H" && c.s === "") continue;
				const key = numeric ? c.k : `${c.k}|${c.s}`;
				if (!seen.has(key)) seen.set(key, { s: numeric ? "" : c.s, k: c.k });
			}
		}
		const items = [...seen.values()].sort((a, b) => ORDER.indexOf(a.k) - ORDER.indexOf(b.k) || a.s.length - b.s.length || a.s.localeCompare(b.s));
		return { items, pending: flags.pending, ot: flags.ot, late: flags.late };
	}

	/**
	 * Nén ô ngày để gửi về trình duyệt: lưới vài trăm nhân viên x 31 ngày lặp lại một số ít dạng ô, nên gửi bảng các ô khác
	 * nhau một lần và mỗi dòng chỉ mang chỉ số vào bảng đó. unpack là phép ngược (giao diện tự làm tương tự).
	 * @returns {{cellTable: Array<Object>, rows: Array}} rows như đầu vào nhưng cells là mảng chỉ số
	 */
	function pack(rows) {
		const index = new Map();
		const cellTable = [];
		const packed = (rows || []).map((r) =>
			Object.assign({}, r, {
				cells: (r.cells || []).map((c) => {
					const key = JSON.stringify(c);
					if (!index.has(key)) {
						index.set(key, cellTable.length);
						cellTable.push(c);
					}
					return index.get(key);
				}),
			})
		);
		return { cellTable, rows: packed };
	}

	function unpack(cellTable, rows) {
		return (rows || []).map((r) => Object.assign({}, r, { cells: (r.cells || []).map((i) => (typeof i === "number" ? cellTable[i] : i)) }));
	}

	/**
	 * Kỳ mặc định của màn chấm công: kỳ còn mở và chưa khóa công gần hôm nay nhất (kỳ chứa hôm nay hoặc kỳ bắt đầu gần nhất
	 * trước hôm nay; chưa có thì kỳ mở sớm nhất sau hôm nay); không còn kỳ mở thì kỳ mới nhất.
	 * @param {Array<{id, start, end, status, attStatus}>} periods
	 * @param {string} today 'YYYY-MM-DD'
	 * @returns {string|null} id kỳ
	 */
	function defaultPeriod(periods, today) {
		const list = (periods || []).filter((p) => p && p.start && p.end).slice().sort((a, b) => Dates.cmp(a.start, b.start));
		if (!list.length) return null;
		const open = list.filter((p) => (p.status || "O") !== "C" && (p.attStatus || "O") !== "L");
		if (open.length) {
			const started = open.filter((p) => Dates.cmp(p.start, today) <= 0);
			return String((started.length ? started[started.length - 1] : open[0]).id);
		}
		return String(list[list.length - 1].id);
	}

	return { build, days, symbolTable, inPeriod, sourceOf, leavePortion, exceptionSubtype, counts, pack, unpack, defaultPeriod, short };
});
