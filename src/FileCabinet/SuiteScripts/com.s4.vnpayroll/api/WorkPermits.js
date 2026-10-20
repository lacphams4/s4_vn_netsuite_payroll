/**
 * Giấy phép lao động người nước ngoài (VP204000, đặc tả 3.9): lập, nộp, cấp, thu hồi, gia hạn, cập nhật hết hạn và kiểm
 * tra cho kỳ lương. Tham số theo NĐ 219/2025/NĐ-CP: thời hạn tối đa 24 tháng, gia hạn 1 lần, nhắc trước 60 ngày.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Settings", "../core/Dates", "../core/WorkPermitEvaluator", "../core/PlanRecords"], (Store, Settings, Dates, Evaluator, Plan) => {
	const blank = (v) => v === null || v === undefined || v === "";

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function failMsg(m) {
		return fail(m.message, m.messageVi);
	}

	/** Tham số: lấy từ thiết lập chung nếu account có trường, không có thì mặc định. */
	function params() {
		let t = {};
		try {
			t = Settings.tenant();
		} catch (e) {
			t = {};
		}
		return {
			maxTermMonths: blank(t.wp_max_months) ? Plan.DEFAULTS.maxTermMonths : Number(t.wp_max_months),
			maxExtensions: blank(t.wp_max_ext) ? Plan.DEFAULTS.maxExtensions : Number(t.wp_max_ext),
			reminderDays: blank(t.wp_reminder) ? Plan.DEFAULTS.reminderDays : Number(t.wp_reminder),
			blocks: !!t.wp_blocks,
		};
	}

	function today() {
		return Dates.iso(new Date());
	}

	function chainOf(employee) {
		const rows = Store.find("work_permit", { where: "{employee} = ?", params: [employee], includeInactive: true });
		const refById = {};
		for (const r of rows) refById[r.id] = r.name || r.id;
		const permits = rows.map((r) => Plan.permitFromRecord(r, refById));
		const byRef = {};
		for (const p of permits) byRef[p.refNbr] = p;
		return { rows, permits, byRef, refById };
	}

	function get(id) {
		const r = Store.get("work_permit", id);
		if (!r) throw fail("Work permit not found", "Không tìm thấy giấy phép lao động");
		return r;
	}

	/** Lưu giấy ở trạng thái Đang chuẩn bị (D); kiểm tra thời hạn và chuỗi gia hạn. Trả {id, warnings}. */
	function save(values) {
		const v = Object.assign({}, values);
		const id = v.id;
		delete v.id;
		if (id) {
			const cur = get(id);
			if (cur.status && cur.status !== "D") throw fail("Only permits in preparation can be edited", "Chỉ sửa được giấy đang chuẩn bị");
		}
		const merged = id ? Object.assign(get(id), v) : v;
		if (blank(merged.employee) || blank(merged.effective) || blank(merged.expiry)) throw fail("Employee, effective and expiry dates are required", "Thiếu nhân viên, ngày hiệu lực hoặc ngày hết hạn");
		const p = params();
		const term = Evaluator.validateTerm(merged.effective, merged.expiry, p.maxTermMonths);
		if (term) throw failMsg(term);
		const chain = chainOf(merged.employee);
		const me = Plan.permitFromRecord(Object.assign({ id: id || "new", name: merged.name || "(new)" }, merged), chain.refById);
		const byRef = Object.assign({}, chain.byRef, { [me.refNbr]: me });
		const ch = Evaluator.validateChain(me, byRef, p.maxExtensions);
		if (ch) throw failMsg(ch);
		const warnings = [];
		// Trùng thời hạn với giấy Active khác, hộ chiếu hết hạn trước giấy phép: chỉ cảnh báo
		for (const o of chain.permits) {
			if (o.id === id || o.status !== "A") continue;
			if (Dates.cmp(o.effectiveDate, merged.expiry) <= 0 && Dates.cmp(o.expiryDate, merged.effective) >= 0) {
				warnings.push({ code: "OVERLAP", message: `The term overlaps active permit ${o.refNbr}.`, messageVi: `Thời hạn trùng với giấy đang hiệu lực ${o.refNbr}.` });
			}
		}
		if (merged.passport_expiry && Dates.cmp(merged.passport_expiry, merged.expiry) < 0) {
			warnings.push({ code: "PASSPORT", message: "The passport expires before the work permit.", messageVi: "Hộ chiếu hết hạn trước giấy phép lao động." });
		}
		let prof = null;
		try {
			prof = Store.find("employee", { where: "{employee} = ?", params: [merged.employee], includeInactive: true })[0];
		} catch (e) {
			prof = null;
		}
		if (prof && !prof.foreign) warnings.push({ code: "NOT_FOREIGN", message: "The payroll profile is not marked as a foreign worker.", messageVi: "Hồ sơ lương chưa đánh dấu người nước ngoài." });
		const out = Object.assign({}, v, id ? {} : { status: "D" });
		const newId = id ? (Store.update("work_permit", id, out), id) : Store.create("work_permit", out);
		return { id: newId, warnings };
	}

	function submit(id) {
		const r = get(id);
		if (r.status !== "D") throw fail("Only permits in preparation can be submitted", "Chỉ nộp được giấy đang chuẩn bị");
		Store.submit("work_permit", id, { status: "S", submitted: r.submitted || today() });
		return { id, status: "S" };
	}

	/** Mark as Issued: bắt buộc ngày cấp (và số giấy với loại P); Active hoặc Expired theo hôm nay; Reissue thu hồi giấy trước. */
	function markIssued(id, input = {}) {
		const r = get(id);
		if (!["D", "S"].includes(r.status || "D")) throw fail("The permit is already issued", "Giấy đã được cấp");
		const issued = input.issued || r.issued;
		const permitNo = input.permitNo || r.permit_no;
		if (blank(issued)) throw fail("The issue date is required", "Phải có ngày cấp");
		if ((r.doc_type || "P") === "P" && blank(permitNo)) throw fail("The permit number is required", "Phải có số giấy phép");
		const status = Evaluator.issuedStatus(r.expiry, today());
		Store.submit("work_permit", id, { status, issued, permit_no: permitNo || "" });
		if (status === "A" && r.issue_type === "R" && r.previous) {
			const prev = Store.get("work_permit", r.previous);
			if (prev && prev.status === "A") Store.submit("work_permit", prev.id, { status: "V" });
		}
		return { id, status };
	}

	function revoke(id) {
		const r = get(id);
		if (r.status === "V") return { id, status: "V" };
		Store.submit("work_permit", id, { status: "V" });
		return { id, status: "V" };
	}

	/** Tạo giấy gia hạn (Extension) nối tiếp giấy này. */
	function createExtension(id) {
		const r = get(id);
		if (!r.expiry) throw fail("The permit has no expiry date", "Giấy chưa có ngày hết hạn");
		const p = params();
		const term = Evaluator.extensionTerm({ expiryDate: r.expiry }, p.maxTermMonths);
		return save({
			employee: r.employee, doc_type: r.doc_type || "P", issue_type: "X", previous: r.id, effective: term.effectiveDate, expiry: term.expiryDate,
			job: r.job || null, title: r.title || "", work_location: r.work_location || "", passport: r.passport || "", passport_expiry: r.passport_expiry || null, authority: r.authority || "",
		});
	}

	/** Update Expired Statuses: giấy Active có hạn trước hôm nay chuyển Expired. */
	function updateExpired() {
		const t = today();
		const changed = [];
		for (const r of Store.find("work_permit")) {
			if (r.status === "A" && r.expiry && Dates.cmp(r.expiry, t) < 0) {
				Store.submit("work_permit", r.id, { status: "E" });
				changed.push(r.name || r.id);
			}
		}
		return { changed };
	}

	/** Danh sách giấy theo subsidiary của hồ sơ lương, kèm đánh giá hạn so với hôm nay. */
	function list(subsidiary) {
		const prof = {};
		for (const p of Store.find("employee", { includeInactive: true })) prof[p.employee] = p;
		const p = params();
		const t = today();
		return Store.find("work_permit", { order: "{id} DESC" })
			.filter((r) => !subsidiary || (prof[r.employee] && prof[r.employee].subsidiary === String(subsidiary)))
			.map((r) => {
				const daysLeft = r.expiry ? Dates.diff(t, r.expiry) : null;
				return Object.assign({}, r, { daysLeft, expiringSoon: r.status === "A" && daysLeft !== null && daysLeft <= p.reminderDays });
			});
	}

	/**
	 * Kiểm tra cho bảng lương: chỉ hồ sơ người nước ngoài.
	 * @returns {Object<string, {coverage, days, refNbr, coveredTo, warning, blocking}>} theo id nhân viên
	 */
	function forPayroll(employeeIds, periodStart, periodEnd, reminderDays) {
		const ids = [...new Set((employeeIds || []).filter((x) => !blank(x)).map(String))];
		const out = {};
		if (!ids.length) return out;
		const foreign = new Set(Store.findIn("employee", "employee", ids).filter((p) => p.foreign).map((p) => p.employee));
		if (!foreign.size) return out;
		const p = params();
		const rows = Store.findIn("work_permit", "employee", [...foreign]);
		const refById = {};
		for (const r of rows) refById[r.id] = r.name || r.id;
		const by = {};
		for (const r of rows) (by[r.employee] = by[r.employee] || []).push(Plan.permitFromRecord(r, refById));
		for (const e of foreign) out[e] = Plan.payrollCheck(by[e] || [], periodStart, periodEnd, blank(reminderDays) ? p.reminderDays : reminderDays, p.blocks);
		return out;
	}

	return { params, save, submit, markIssued, revoke, createExtension, updateExpired, list, forPayroll };
});
