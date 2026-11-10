/**
 * Nhân sự (giao diện bản 2): hợp nhất các mốc của một nhân viên thành dòng thời gian, tính việc sắp đến hạn, kiểm hợp đồng
 * và quyết định. AMD thuần, không gọi N/*; ngày là chuỗi ISO 'YYYY-MM-DD'.
 *
 * Dữ liệu vào là object thuần đúng dạng Store trả về:
 *   contract    {id, number, type: P|F|U|S|C, parent, sign_date, effective, expiry, status: D|A|X|T, terminated, title, base_salary}
 *   decision    {id, number, type: H|T|P|S|R|D|X, effective, status: D|A, new_department, new_title, new_salary, new_ins_wage, new_allowance}
 *   compensation{id, effective, base_salary, insurance_wage, allowance, package}
 *   dependent   {id, name, relationship, from, to}
 *   permit      {id, name, permit_no, status: D|S|A|E|V, effective, expiry}
 *
 * Không có giới hạn pháp lý nào được viết cứng ở đây (thời hạn thử việc, số lần ký hợp đồng xác định thời hạn...):
 * số ngày nhắc trước là tham số của nơi gọi.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates"], (Dates) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const num = (v) => (blank(v) || isNaN(Number(v)) ? null : Number(v));

	const MESSAGES = {
		NO_EMPLOYEE: ["Employee is required", "Chưa chọn nhân viên"],
		NO_TYPE: ["The type is required", "Chưa chọn loại"],
		NO_EFFECTIVE: ["The effective date is required", "Chưa nhập ngày hiệu lực"],
		BAD_DATE: ["A date is not valid (use dd/mm/yyyy)", "Ngày không hợp lệ (nhập dd/mm/yyyy)"],
		END_BEFORE_START: ["The end date is before the effective date", "Ngày kết thúc trước ngày hiệu lực"],
		NEED_EXPIRY: ["This contract type needs an end date", "Loại hợp đồng này phải có ngày kết thúc"],
		NO_EXPIRY_ALLOWED: ["An indefinite-term contract has no end date", "Hợp đồng không xác định thời hạn không có ngày kết thúc"],
		APPENDIX_OF_APPENDIX: ["An appendix must belong to a main contract", "Phụ lục phải thuộc một hợp đồng gốc"],
		APPENDIX_OUTSIDE: ["The appendix takes effect outside the term of its contract", "Ngày hiệu lực của phụ lục nằm ngoài thời hạn hợp đồng"],
		APPENDIX_PARENT_DRAFT: ["The main contract is still a draft", "Hợp đồng gốc còn là bản nháp"],
		NEGATIVE: ["Amounts cannot be negative", "Số tiền không được âm"],
		OVERLAP: ["The term overlaps another contract", "Thời hạn chồng lấn với hợp đồng khác"],
		NO_CHANGE: ["The decision has no change to apply", "Quyết định chưa có nội dung thay đổi"],
		NO_SALARY: ["The new salary is required", "Chưa nhập mức lương mới"],
		NO_BASE: ["There is no current salary to carry over; enter the new salary", "Chưa có lương hiện tại để kế thừa; hãy nhập mức lương mới"],
		TERMINATE_OUTSIDE: ["The termination date is outside the contract term", "Ngày chấm dứt nằm ngoài thời hạn hợp đồng"],
	};

	function message(code, extra) {
		const m = MESSAGES[code] || [code, code];
		return { code, message: extra ? `${m[0]} (${extra})` : m[0], messageVi: extra ? `${m[1]} (${extra})` : m[1] };
	}

	const validDate = (d) => {
		if (blank(d)) return true;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return false;
		try {
			return Dates.fromDay(Dates.toDay(d)) === String(d);
		} catch (e) {
			return false;
		}
	};

	const isAppendix = (c) => !blank(c && c.parent);
	/** Ngày cuối cùng hợp đồng còn giá trị: ngày chấm dứt, không có thì ngày kết thúc; null = không thời hạn. */
	const endOf = (c) => (c.status === "T" && c.terminated ? c.terminated : c.expiry || null);

	/**
	 * Trạng thái hiển thị của hợp đồng tại ngày `today`: D nháp, T chấm dứt, X hết hạn (kể cả hợp đồng hiệu lực đã qua ngày
	 * kết thúc), A hiệu lực; `future` = đã duyệt nhưng chưa tới ngày hiệu lực.
	 */
	function contractState(c, today) {
		const s = c.status || "D";
		if (s === "D" || s === "T" || s === "X") return { state: s, future: false };
		if (c.expiry && Dates.cmp(c.expiry, today) < 0) return { state: "X", future: false };
		return { state: "A", future: !blank(c.effective) && Dates.cmp(c.effective, today) > 0 };
	}

	/** Hợp đồng gốc đang hiệu lực tại `today` (mới nhất theo ngày hiệu lực); không có thì null. */
	function currentContract(contracts, today) {
		let best = null;
		for (const c of contracts || []) {
			if (isAppendix(c) || blank(c.effective)) continue;
			const st = contractState(c, today);
			if (st.state !== "A" || st.future) continue;
			if (!best || Dates.cmp(c.effective, best.effective) > 0) best = c;
		}
		return best;
	}

	/** Hợp đồng gốc mới nhất không phải bản nháp (để hiện khi không còn hợp đồng hiệu lực). */
	function latestContract(contracts) {
		let best = null;
		for (const c of contracts || []) {
			if (isAppendix(c) || blank(c.effective) || (c.status || "D") === "D") continue;
			if (!best || Dates.cmp(c.effective, best.effective) > 0) best = c;
		}
		return best;
	}

	/**
	 * Hợp đồng gốc khác (không phải nháp) có thời hạn chồng lấn với `candidate`. Khoảng ngày gồm hai đầu; hợp đồng đã chấm
	 * dứt chỉ tính đến ngày chấm dứt; không có ngày kết thúc = vô thời hạn. Phụ lục không tham gia.
	 */
	function overlaps(contracts, candidate) {
		if (!candidate || isAppendix(candidate) || blank(candidate.effective)) return [];
		const cEnd = endOf(candidate);
		return (contracts || []).filter((o) => {
			if (isAppendix(o) || blank(o.effective) || (o.status || "D") === "D") return false;
			if (!blank(candidate.id) && String(o.id) === String(candidate.id)) return false;
			const oEnd = endOf(o);
			const startsBeforeOtherEnds = !oEnd || Dates.cmp(candidate.effective, oEnd) <= 0;
			const otherStartsBeforeEnd = !cEnd || Dates.cmp(o.effective, cEnd) <= 0;
			return startsBeforeOtherEnds && otherStartsBeforeEnd;
		});
	}

	/** Kiểm hợp đồng / phụ lục trước khi lưu; `parent` là hợp đồng gốc khi là phụ lục. Trả danh sách lỗi {code, message, messageVi}. */
	function validateContract(c, parent) {
		const errs = [];
		const v = c || {};
		if (blank(v.employee)) errs.push(message("NO_EMPLOYEE"));
		if (blank(v.effective)) errs.push(message("NO_EFFECTIVE"));
		if (![v.sign_date, v.effective, v.expiry].every(validDate)) {
			errs.push(message("BAD_DATE"));
			return errs;
		}
		if ((num(v.base_salary) || 0) < 0 || (num(v.insurance_wage) || 0) < 0) errs.push(message("NEGATIVE"));
		if (isAppendix(v)) {
			if (!parent || isAppendix(parent)) errs.push(message("APPENDIX_OF_APPENDIX"));
			else if (!blank(v.effective)) {
				const end = endOf(parent);
				if (Dates.cmp(v.effective, parent.effective) < 0 || (end && Dates.cmp(v.effective, end) > 0)) errs.push(message("APPENDIX_OUTSIDE"));
			}
			return errs;
		}
		if (blank(v.type)) errs.push(message("NO_TYPE"));
		if (!blank(v.effective) && !blank(v.expiry) && Dates.cmp(v.expiry, v.effective) < 0) errs.push(message("END_BEFORE_START"));
		// Thử việc và xác định thời hạn là hợp đồng có kỳ hạn theo đúng tên gọi: thiếu ngày kết thúc thì không theo dõi được hạn
		if ((v.type === "P" || v.type === "F") && blank(v.expiry)) errs.push(message("NEED_EXPIRY"));
		if (v.type === "U" && !blank(v.expiry)) errs.push(message("NO_EXPIRY_ALLOWED"));
		return errs;
	}

	/** Kiểm ngày chấm dứt hợp đồng: trong thời hạn hợp đồng. */
	function validateTermination(c, date) {
		if (blank(date) || !validDate(date)) return [message("BAD_DATE")];
		if (Dates.cmp(date, c.effective) < 0 || (c.expiry && Dates.cmp(date, c.expiry) > 0)) return [message("TERMINATE_OUTSIDE")];
		return [];
	}

	/** Dòng lịch sử lương có hiệu lực tại `date` (mới nhất có effective <= date); không có thì null. */
	function compensationAt(comps, date) {
		let best = null;
		for (const c of comps || []) {
			if (blank(c.effective) || (date && Dates.cmp(c.effective, date) > 0)) continue;
			if (!best || Dates.cmp(c.effective, best.effective) > 0) best = c;
		}
		return best;
	}

	const hasPay = (d) => !blank(d.new_salary) || !blank(d.new_ins_wage) || !blank(d.new_allowance);
	// Loại quyết định được mang thay đổi tổ chức (phòng ban, chức danh) và thay đổi lương
	const ORG_TYPES = ["H", "T", "P"];
	const PAY_TYPES = ["H", "T", "P", "S"];

	/** Kiểm quyết định trước khi lưu. */
	function validateDecision(d) {
		const errs = [];
		const v = d || {};
		if (blank(v.employee)) errs.push(message("NO_EMPLOYEE"));
		if (blank(v.type)) errs.push(message("NO_TYPE"));
		if (blank(v.effective)) errs.push(message("NO_EFFECTIVE"));
		if (![v.sign_date, v.effective].every(validDate)) errs.push(message("BAD_DATE"));
		if ([v.new_salary, v.new_ins_wage, v.new_allowance].some((x) => !blank(x) && (num(x) === null || num(x) < 0))) errs.push(message("NEGATIVE"));
		if (v.type === "S" && !(num(v.new_salary) > 0) && blank(v.new_ins_wage) && blank(v.new_allowance)) errs.push(message("NO_SALARY"));
		if ((v.type === "T" || v.type === "P") && blank(v.new_department) && blank(v.new_title) && !hasPay(v)) errs.push(message("NO_CHANGE"));
		return errs;
	}

	/**
	 * Việc phải làm khi áp dụng quyết định, để lớp api ghi qua Profiles.save.
	 * @param {object} d quyết định
	 * @param {{compensations?: Array, profile?: object}} current
	 * @returns {{profile: object, compensation: object|null, terminate: string|null, errors: Array, warnings: Array}}
	 *   profile: trường hồ sơ lương cần đổi; compensation: dòng lịch sử lương mới theo ngày hiệu lực (kế thừa phần không đổi
	 *   từ dòng đang hiệu lực); terminate: ngày làm việc cuối (quyết định chấm dứt).
	 */
	function decisionEffects(d, current) {
		const cur = current || {};
		const out = { profile: {}, compensation: null, terminate: null, errors: validateDecision(d), warnings: [] };
		if (out.errors.length) return out;
		if (ORG_TYPES.includes(d.type) && !blank(d.new_department)) out.profile.department = String(d.new_department);
		if (d.type === "H" && cur.profile && blank(cur.profile.hire_date)) out.profile.hire_date = d.effective;
		if (d.type === "X") {
			out.terminate = d.effective;
			out.profile.termination_date = d.effective;
		}
		if (PAY_TYPES.includes(d.type) && hasPay(d)) {
			const base = compensationAt(cur.compensations, d.effective) || {};
			const pick = (next, prev) => (blank(next) ? (blank(prev) ? null : Number(prev)) : Number(next));
			const comp = {
				effective: d.effective, base_salary: pick(d.new_salary, base.base_salary), insurance_wage: pick(d.new_ins_wage, base.insurance_wage),
				allowance: pick(d.new_allowance, base.allowance), package: blank(base.package) ? null : base.package,
			};
			if (comp.base_salary === null) out.errors.push(message("NO_BASE"));
			else out.compensation = comp;
			if ((cur.compensations || []).some((c) => !blank(c.effective) && Dates.cmp(c.effective, d.effective) > 0)) {
				out.warnings.push({ code: "LATER_COMP", message: "A later salary row already exists; it still applies from its own date.", messageVi: "Đã có dòng lương hiệu lực sau ngày này; dòng đó vẫn áp dụng từ ngày của nó." });
			}
		}
		return out;
	}

	/** Chức danh hiện tại: quyết định đã áp dụng mới nhất có chức danh mới, không có thì chức danh trên hợp đồng hiện tại. */
	function currentTitle(contracts, decisions, today) {
		let best = null;
		for (const d of decisions || []) {
			if (d.status !== "A" || blank(d.new_title) || blank(d.effective) || Dates.cmp(d.effective, today) > 0) continue;
			if (!best || Dates.cmp(d.effective, best.effective) > 0) best = d;
		}
		const c = currentContract(contracts, today) || latestContract(contracts);
		// Phụ lục mới nhất của hợp đồng hiện tại có ghi chức danh thì thay chức danh trên hợp đồng
		let fromContract = c ? { effective: c.effective, title: c.title } : null;
		if (c) {
			for (const a of contracts || []) {
				if (String(a.parent || "") !== String(c.id) || (a.status || "D") === "D" || blank(a.title) || blank(a.effective) || Dates.cmp(a.effective, today) > 0) continue;
				if (!fromContract || blank(fromContract.title) || Dates.cmp(a.effective, fromContract.effective) > 0) fromContract = { effective: a.effective, title: a.title };
			}
		}
		if (best && (!fromContract || blank(fromContract.title) || Dates.cmp(best.effective, fromContract.effective) >= 0)) return best.new_title;
		return fromContract && !blank(fromContract.title) ? fromContract.title : best ? best.new_title : "";
	}

	/**
	 * Dòng thời gian của một nhân viên, mới nhất trước.
	 * Mỗi mốc: {date, kind, code, id, ref, draft, future, ...} với kind:
	 *   hire | leave (ngày vào làm, ngày làm việc cuối của hồ sơ) | contract | appendix | contractEnd | contractTerminated |
	 *   decision | salary | dependent | dependentEnd | permit | permitExpiry.
	 * Mốc lương kèm {amount, insuranceWage, allowance, previous}; lớp api bỏ các số này khi vai trò không được xem lương.
	 * Dòng lịch sử lương trùng ngày với quyết định đã áp dụng có đổi lương thì không lặp lại.
	 */
	function timeline(input, today) {
		const src = input || {};
		const out = [];
		const push = (e) => {
			if (!blank(e.date)) out.push(Object.assign({ future: !!today && Dates.cmp(e.date, today) > 0 }, e));
		};
		const profile = src.profile || {};
		if (!blank(profile.hire_date)) push({ date: profile.hire_date, kind: "hire" });
		if (!blank(profile.termination_date)) push({ date: profile.termination_date, kind: "leave" });
		const contracts = src.contracts || [];
		const byId = {};
		for (const c of contracts) byId[String(c.id)] = c;
		for (const c of contracts) {
			const draft = (c.status || "D") === "D";
			const parent = isAppendix(c) ? byId[String(c.parent)] : null;
			push({
				date: c.effective, kind: isAppendix(c) ? "appendix" : "contract", code: isAppendix(c) ? (parent && parent.type) || "" : c.type || "", id: c.id, ref: c.number || "",
				parentRef: parent ? parent.number || "" : "", draft, to: c.expiry || null, amount: num(c.base_salary), title: c.title || "",
			});
			if (isAppendix(c) || draft) continue;
			if (c.status === "T" && c.terminated) push({ date: c.terminated, kind: "contractTerminated", code: c.type || "", id: c.id, ref: c.number || "", reason: c.term_reason || "" });
			else if (c.expiry) push({ date: c.expiry, kind: "contractEnd", code: c.type || "", id: c.id, ref: c.number || "" });
		}
		const decided = new Set();
		for (const d of src.decisions || []) {
			const draft = d.status !== "A";
			if (!draft && hasPay(d) && !blank(d.effective)) decided.add(String(d.effective));
			push({
				date: d.effective, kind: "decision", code: d.type || "", id: d.id, ref: d.number || "", draft,
				oldTitle: d.old_title || "", newTitle: d.new_title || "", oldDepartment: d.old_department || "", newDepartment: d.new_department || "",
				oldDepartmentName: d.oldDepartmentName || "", newDepartmentName: d.newDepartmentName || "",
				previous: num(d.old_salary), amount: num(d.new_salary), insuranceWage: num(d.new_ins_wage), allowance: num(d.new_allowance),
			});
		}
		const comps = (src.compensations || []).filter((c) => !blank(c.effective)).slice().sort((a, b) => Dates.cmp(a.effective, b.effective));
		comps.forEach((c, i) => {
			if (decided.has(String(c.effective))) return;
			push({ date: c.effective, kind: "salary", id: c.id, amount: num(c.base_salary), insuranceWage: num(c.insurance_wage), allowance: num(c.allowance), previous: i > 0 ? num(comps[i - 1].base_salary) : null });
		});
		for (const p of src.dependents || []) {
			push({ date: p.from, kind: "dependent", id: p.id, ref: p.name || "", relationship: p.relationship || "" });
			if (!blank(p.to)) push({ date: p.to, kind: "dependentEnd", id: p.id, ref: p.name || "", relationship: p.relationship || "" });
		}
		for (const w of src.permits || []) {
			const ref = w.permit_no || w.name || "";
			if (!blank(w.effective)) push({ date: w.effective, kind: "permit", code: w.status || "D", id: w.id, ref, draft: ["D", "S"].includes(w.status || "D") });
			if (!blank(w.expiry) && ["A", "E"].includes(w.status)) push({ date: w.expiry, kind: "permitExpiry", code: w.status, id: w.id, ref });
		}
		const ORDER = { leave: 0, contractTerminated: 1, contractEnd: 2, permitExpiry: 3, dependentEnd: 4, decision: 5, salary: 6, appendix: 7, contract: 8, permit: 9, dependent: 10, hire: 11 };
		return out.sort((a, b) => Dates.cmp(b.date, a.date) || (ORDER[a.kind] || 0) - (ORDER[b.kind] || 0) || String(b.id || "").localeCompare(String(a.id || "")));
	}

	/**
	 * Việc sắp đến hạn của MỘT nhân viên.
	 * @param {{contracts?: Array, permits?: Array}} input
	 * @param {string} today
	 * @param {{days?: number, permitDays?: number}} [opt] số ngày nhắc trước (tham số của nơi gọi; mặc định 30 và bằng `days`)
	 * @returns {Array<{kind: 'contractExpiry'|'probationEnd'|'permitExpiry', date, daysLeft, overdue, id, ref, code}>} gần nhất trước
	 *
	 * Hợp đồng: hợp đồng gốc đã duyệt, chưa chấm dứt, có ngày kết thúc trong `days` ngày tới, và CHƯA có hợp đồng gốc đã duyệt
	 * nào nối tiếp (hiệu lực sau ngày kết thúc đó). Hợp đồng đã quá hạn mà chưa có hợp đồng nối tiếp vẫn được báo (overdue).
	 * Giấy phép lao động: giấy còn hiệu lực (A) hết hạn trong `permitDays` ngày tới, hoặc đã quá hạn mà chưa có giấy mới.
	 */
	function due(input, today, opt) {
		const o = opt || {};
		const days = blank(o.days) ? 30 : Number(o.days);
		const permitDays = blank(o.permitDays) ? days : Number(o.permitDays);
		const src = input || {};
		const out = [];
		const mains = (src.contracts || []).filter((c) => !isAppendix(c) && !blank(c.effective) && (c.status || "D") !== "D");
		for (const c of mains) {
			if (c.status === "T" || blank(c.expiry)) continue;
			const daysLeft = Dates.diff(today, c.expiry);
			if (daysLeft > days) continue;
			if (mains.some((x) => x !== c && Dates.cmp(x.effective, c.expiry) > 0)) continue;
			// Hợp đồng quá hạn chỉ báo khi là hợp đồng cuối cùng của người đó
			if (daysLeft < 0 && mains.some((x) => x !== c && Dates.cmp(x.effective, c.effective) > 0)) continue;
			out.push({ kind: c.type === "P" ? "probationEnd" : "contractExpiry", date: c.expiry, daysLeft, overdue: daysLeft < 0, id: c.id, ref: c.number || "", code: c.type || "" });
		}
		const permits = (src.permits || []).filter((w) => !blank(w.expiry));
		for (const w of permits) {
			if (!["A", "E"].includes(w.status)) continue;
			const daysLeft = Dates.diff(today, w.expiry);
			if (daysLeft > permitDays) continue;
			if (permits.some((x) => x !== w && x.status === "A" && Dates.cmp(x.expiry, w.expiry) > 0)) continue;
			out.push({ kind: "permitExpiry", date: w.expiry, daysLeft, overdue: daysLeft < 0, id: w.id, ref: w.permit_no || w.name || "", code: w.status });
		}
		return out.sort((a, b) => Dates.cmp(a.date, b.date));
	}

	return {
		MESSAGES, message, isAppendix, endOf, contractState, currentContract, latestContract, overlaps, validateContract, validateTermination,
		compensationAt, validateDecision, decisionEffects, currentTitle, timeline, due,
	};
});
