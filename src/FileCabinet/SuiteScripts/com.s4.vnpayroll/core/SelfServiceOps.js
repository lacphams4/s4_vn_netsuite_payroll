/**
 * Lớp kiểm quyền và các lượt gọi dữ liệu (`op`) của cổng tự phục vụ nhân viên. Không gọi N/*: lớp đọc ghi được truyền vào
 * (Suitelet s4vp_sl_my_payroll truyền api/Store, api/Attendance, api/Settings, api/Clock) nên test được bằng Jest.
 *
 * NGUYÊN TẮC AN TOÀN
 * - Nhân viên luôn lấy từ người dùng đang đăng nhập (deps.userId()), xác định lại ở MỖI lượt gọi. Tham số `employee` của
 *   trình duyệt không bao giờ được dùng; nếu có và khác người đăng nhập thì cả lượt gọi bị từ chối (FORBIDDEN).
 * - Mọi truy vấn có điều kiện nhân viên = người đăng nhập; chứng từ theo id phải đọc lại và so chủ sở hữu trước khi ghi.
 *   Chứng từ của người khác trả NOT_FOUND (không tiết lộ là có tồn tại).
 * - Mã số thuế, số tài khoản, số định danh, số sổ BHXH chỉ trả dạng che (SelfService.maskTail).
 * - Không ghi số tiền, số định danh vào log: chỉ ghi mã op và thông báo lỗi kỹ thuật đã cắt ngắn.
 * - Đơn chỉ gồm các trường nhân viên được tự nhập (SelfService.FIELDS); employee, subsidiary do máy chủ đặt.
 *
 * create(deps) -> { handle(method, params, body), printDetail(batchId), identify() }
 *   deps: { userId(): string|null, today(): 'YYYY-MM-DD', Store, Attendance, Settings, log?(text) }
 *   handle trả { ok: true, data } hoặc { ok: false, code, message: {en, vi}, fields? }.
 *
 * op (GET): boot, payslips {year}, payslip {batch}, leave {year}, requests, me
 * op (POST): saveRequest {type, id?, values}, requestAction {type, id, action: submit | cancel}
 *
 * Luồng đơn như khi HR tạo hộ rồi gửi duyệt: Attendance.save (Tạm giữ H) -> Attendance.act(submit) (Chờ duyệt P). Gửi duyệt
 * không qua (trùng ngày, thiếu số dư...) thì đơn ở lại trạng thái Tạm giữ để nhân viên sửa và gửi lại. Nhân viên chỉ tự hủy
 * đơn đang chờ duyệt; đơn đã duyệt do bộ phận nhân sự hủy.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./SelfService", "./HrTimeline", "./Dates"], (SS, Timeline, Dates) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const isId = (v) => /^\d+$/.test(String(blank(v) ? "" : v));
	const POST_OPS = ["saveRequest", "requestAction"];

	function fail(code, en, vi, extra) {
		const e = new Error(en);
		e.code = code;
		e.userMessage = { en, vi };
		if (extra) e.extra = extra;
		return e;
	}

	function create(deps) {
		const Store = deps.Store;
		const Attendance = deps.Attendance;
		const safe = (fn, fallback) => {
			try {
				return fn();
			} catch (e) {
				return fallback;
			}
		};

		/** Nhân viên của người đăng nhập; không gắn Employee thì từ chối. */
		function identify() {
			const raw = deps.userId();
			if (!isId(raw) || Number(raw) <= 0) throw fail("NO_EMPLOYEE", "Your user account is not linked to an employee.", "Tài khoản đăng nhập chưa gắn với nhân viên.");
			const id = String(raw);
			const rows = Store.run("SELECT e.id AS id, e.entityid AS entityid, e.firstname AS firstname, e.lastname AS lastname, e.title AS jobtitle, BUILTIN.DF(e.department) AS deptname FROM employee e WHERE e.id = ?", [id], "s4vp_my_employee");
			if (!rows.length) throw fail("NO_EMPLOYEE", "Your user account is not linked to an employee.", "Tài khoản đăng nhập chưa gắn với nhân viên.");
			const r = rows[0];
			return { id, code: r.entityid || "", name: [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || r.entityid || "", jobTitle: r.jobtitle || "", department: r.deptname || "" };
		}

		/** Yêu cầu nêu nhân viên khác người đăng nhập: từ chối cả lượt gọi. */
		function assertNoForeignEmployee(me, params, body) {
			const b = body || {};
			const given = [(params || {}).employee, b.employee, (b.values || {}).employee];
			for (const g of given) {
				if (blank(g)) continue;
				if (String(g) !== String(me)) throw fail("FORBIDDEN", "You can only access your own data.", "Bạn chỉ được xem và gửi dữ liệu của chính mình.");
			}
		}

		const profileOf = (me) => Store.find("employee", { where: "{employee} = ?", params: [me], includeInactive: true })[0] || null;

		function needProfile(me) {
			const p = profileOf(me);
			if (!p) throw fail("NO_PROFILE", "You do not have a payroll profile yet. Please contact the HR department.", "Bạn chưa có hồ sơ lương. Vui lòng liên hệ bộ phận nhân sự.");
			return p;
		}

		function leaveTypes() {
			const out = {};
			for (const l of Store.find("leave_type", { includeInactive: true })) {
				out[l.id] = { id: l.id, code: norm(l.name), name: l.description || l.name || "", allowHalf: l.allow_half !== false, usesBalance: !!l.uses_balance, maxDays: l.max_days || 0, inactive: !!l.isInactive };
			}
			return out;
		}

		// ------------------------------------------------------------------ phiếu lương

		/** Các dòng của tôi trên bảng lương đã ghi sổ (R), kỳ mới nhất trước. */
		function mySlips(me) {
			const lines = Store.find("batch_emp", { where: "{employee} = ?", params: [me] }).filter((l) => SS.isOwn(l, me));
			const batches = {};
			for (const b of Store.findIn("batch", "id", lines.map((l) => l.batch))) batches[b.id] = b;
			const periods = {};
			if (lines.length) for (const p of Store.find("period", { includeInactive: true })) periods[p.id] = p;
			return lines
				.filter((l) => batches[l.batch] && batches[l.batch].status === "R")
				.map((l) => {
					const b = batches[l.batch];
					const p = periods[b.period] || {};
					return { batch: String(b.id), batchName: b.name || "", period: blank(b.period) ? "" : String(b.period), periodName: p.name || "", start: p.start || null, end: p.end || null, taxMonth: String(b.tax_month || p.tax_month || ""), line: l, batchRow: b };
				})
				.sort((a, b) => String(b.end || "").localeCompare(String(a.end || "")) || Number(b.batch) - Number(a.batch));
		}

		const slipMeta = (s) => ({ batch: s.batch, batchName: s.batchName, periodName: s.periodName, start: s.start, end: s.end, taxMonth: s.taxMonth, canPdf: norm(s.line.employment_type || "E") === "E" });

		function names() {
			const earning = {};
			const insurance = {};
			safe(() => {
				const byCode = deps.Settings.earningTypes().byCode;
				for (const k of Object.keys(byCode)) earning[k] = byCode[k].description || k;
			});
			safe(() => {
				for (const c of Store.find("ins_comp", { includeInactive: true })) insurance[norm(c.name)] = c.description || c.name;
			});
			return { earning, insurance };
		}

		const parseDetail = (line) => safe(() => (line.detail ? JSON.parse(line.detail) : {}), {});

		function opPayslips(ctx, p) {
			const mine = mySlips(ctx.me.id);
			const yearOf = (s) => String(s.taxMonth || s.end || "").slice(0, 4);
			const years = [...new Set(mine.map(yearOf).filter(Boolean))].sort().reverse();
			const year = /^\d{4}$/.test(String(p.year || "")) ? String(p.year) : years[0] || String(deps.today()).slice(0, 4);
			if (!years.includes(year)) years.unshift(year);
			return {
				year, years,
				hasProfile: !!profileOf(ctx.me.id),
				rows: mine.filter((s) => yearOf(s) === year).map((s) => Object.assign(slipMeta(s), { gross: s.line.gross || 0, deductions: (s.line.gross || 0) - (s.line.net || 0), net: s.line.net || 0 })),
			};
		}

		function opPayslip(ctx, p) {
			if (!isId(p.batch)) throw fail("NOT_FOUND", "No released payslip of yours in this batch.", "Không tìm thấy phiếu lương đã ghi sổ của bạn trong bảng lương này.");
			const mine = mySlips(ctx.me.id);
			const hit = mine.find((s) => s.batch === String(p.batch));
			if (!hit) throw fail("NOT_FOUND", "No released payslip of yours in this batch.", "Không tìm thấy phiếu lương đã ghi sổ của bạn trong bảng lương này.");
			const nm = names();
			const view = SS.slipView(hit.line, parseDetail(hit.line), nm);
			const prev = SS.pickPrevious(mine, hit);
			const prevView = prev ? SS.slipView(prev.line, parseDetail(prev.line), nm) : null;
			return { slip: slipMeta(hit), view, previous: prev ? slipMeta(prev) : null, compare: SS.compareSlips(view, prevView) };
		}

		/**
		 * Dữ liệu in phiếu lương của chính mình cho PrintModel.payslips: chỉ có một dòng, không đọc dòng của người khác.
		 * @returns {{batch, lines}|null} null khi bảng lương không có phiếu đã ghi sổ của người đăng nhập
		 */
		function printDetail(batchId) {
			const me = identify();
			if (!isId(batchId)) return null;
			const hit = mySlips(me.id).find((s) => s.batch === String(batchId));
			if (!hit) return null;
			const nm = names();
			const d = parseDetail(hit.line);
			const line = Object.assign({}, hit.line, {
				code: me.code, name: me.name, department: me.department, detail: undefined,
				earnings: (d.earnings || []).map((x) => Object.assign({}, x, { name: nm.earning[norm(x.earningType)] || x.earningType })),
				insurance: d.insurance || [], deductions: d.deductions || [], advanceOffsets: d.advanceOffsets || [], allocations: [],
			});
			return { employee: me.id, batch: Object.assign({}, hit.batchRow, { bills: [], periodName: hit.periodName, periodStart: hit.start, periodEnd: hit.end }), lines: [line] };
		}

		// ------------------------------------------------------------------ phép năm

		function opLeave(ctx, p) {
			const me = ctx.me.id;
			const today = deps.today();
			const lt = leaveTypes();
			const all = Store.find("leave_balance", { where: "{employee} = ?", params: [me] }).filter((b) => SS.isOwn(b, me));
			const years = [...new Set(all.map((b) => String(b.year)).concat(String(today).slice(0, 4)))].sort().reverse();
			const year = /^\d{4}$/.test(String(p.year || "")) ? String(p.year) : String(today).slice(0, 4);
			if (!years.includes(year)) years.push(year);
			const requests = Store.find("leave_request", { where: "{employee} = ?", params: [me], order: "{id} DESC" })
				.filter((d) => SS.isOwn(d, me) && String(d.from || "").slice(0, 4) === year)
				.map((d) => SS.requestRow("leave", d, lt));
			const transactions = safe(
				() =>
					Store.find("leave_tran", { where: "{employee} = ? AND {year} = ?", params: [me, Number(year)] })
						.filter((t) => SS.isOwn(t, me))
						.map((t) => ({ id: t.id, date: t.tran_date, leaveCode: (lt[t.leave_type] || {}).code || "", leaveName: (lt[t.leave_type] || {}).name || "", qty: t.qty || 0, source: t.source || "", ref: t.ref || "" }))
						.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || Number(b.id) - Number(a.id)),
				[]
			);
			return { year, years: years.sort().reverse(), today, hasProfile: !!profileOf(me), balances: SS.leaveView(all.filter((b) => String(b.year) === year), lt), requests: SS.groupRequests(requests), transactions };
		}

		// ------------------------------------------------------------------ đơn của tôi

		function recordOf(type) {
			if (!SS.TYPES.includes(type)) throw fail("INVALID", "Unknown request type.", "Loại đơn không hợp lệ.");
			return Attendance.RECORD[type];
		}

		/** Chứng từ theo id, chỉ khi thuộc người đăng nhập. */
		function ownDoc(type, id, me) {
			const name = recordOf(type);
			const doc = isId(id) ? Store.get(name, String(id)) : null;
			if (!SS.isOwn(doc, me)) throw fail("NOT_FOUND", "Request not found.", "Không tìm thấy đơn.");
			return doc;
		}

		function opRequests(ctx) {
			const me = ctx.me.id;
			const today = deps.today();
			const lt = leaveTypes();
			const rows = [];
			for (const type of SS.TYPES) {
				for (const d of Store.find(recordOf(type), { where: "{employee} = ?", params: [me], order: "{id} DESC" })) {
					if (SS.isOwn(d, me)) rows.push(SS.requestRow(type, d, lt));
				}
			}
			const year = String(today).slice(0, 4);
			const bal = {};
			for (const b of SS.leaveView(Store.find("leave_balance", { where: "{employee} = ?", params: [me] }).filter((x) => SS.isOwn(x, me) && String(x.year) === year), lt)) bal[b.leaveType] = b.available;
			return {
				today, hasProfile: !!profileOf(me),
				requests: SS.groupRequests(rows),
				leaveTypes: Object.values(lt).filter((t) => !t.inactive).sort((a, b) => a.code.localeCompare(b.code)).map((t) => ({ id: t.id, code: t.code, name: t.name, allowHalf: t.allowHalf, usesBalance: t.usesBalance, maxDays: t.maxDays, available: t.usesBalance ? bal[t.id] || 0 : null })),
			};
		}

		const userError = (e) => (e && e.userMessage ? e.userMessage : { en: "The request could not be submitted.", vi: "Không gửi duyệt được đơn." });

		function opSaveRequest(ctx, p, body) {
			const me = ctx.me.id;
			const type = String(body.type || "");
			const name = recordOf(type);
			const profile = needProfile(me);
			const lt = leaveTypes();
			const active = {};
			for (const k of Object.keys(lt)) if (!lt[k].inactive) active[k] = lt[k];
			const checked = SS.validateRequest(type, body.values, { leaveTypes: active });
			if (checked.errors.length) throw fail("INVALID", checked.errors.map((x) => x.en).join(" "), checked.errors.map((x) => x.vi).join(" "), { fields: checked.errors });
			let id = null;
			if (!blank(body.id)) {
				const cur = ownDoc(type, body.id, me);
				if ((cur.status || "H") !== "H" || cur.summary_locked) throw fail("STATE", "Only draft requests can be edited.", "Chỉ sửa được đơn còn nháp.");
				id = String(cur.id);
			}
			// employee và subsidiary luôn do máy chủ đặt; values chỉ còn các trường trong SelfService.FIELDS
			const values = Object.assign({}, checked.values, { employee: me, subsidiary: profile.subsidiary || null });
			if (id) values.id = id;
			const saved = Attendance.save(type, values);
			id = String(saved.id);
			let warnings = saved.warnings || [];
			let submitError = null;
			try {
				const done = Attendance.act(type, id, "submit");
				warnings = done.warnings || [];
			} catch (e) {
				if (!e || !e.userMessage) throw e;
				submitError = userError(e);
			}
			const doc = Store.get(name, id);
			return { request: SS.requestRow(type, doc || { id, status: submitError ? "H" : "P" }, lt), submitted: !submitError, submitError, warnings: warnings.map((w) => ({ code: w.code, en: w.message, vi: w.messageVi || w.message })) };
		}

		function opRequestAction(ctx, p, body) {
			const me = ctx.me.id;
			const type = String(body.type || "");
			const action = String(body.action || "");
			if (action !== "submit" && action !== "cancel") throw fail("INVALID", "This action is not available.", "Thao tác không được hỗ trợ.");
			const doc = ownDoc(type, body.id, me);
			const row = SS.requestRow(type, doc, {});
			if (action === "cancel" && !row.canCancel) throw fail("STATE", "Only requests waiting for approval can be cancelled here. Contact HR for approved requests.", "Chỉ tự hủy được đơn đang chờ duyệt. Đơn đã duyệt vui lòng liên hệ bộ phận nhân sự.");
			if (action === "submit" && !row.canSubmit) throw fail("STATE", "Only draft requests can be submitted.", "Chỉ gửi duyệt được đơn còn nháp.");
			if (action === "submit") needProfile(me);
			const done = Attendance.act(type, String(doc.id), action);
			return { request: SS.requestRow(type, Store.get(recordOf(type), String(doc.id)) || Object.assign({}, doc, { status: done.status }), leaveTypes()), warnings: (done.warnings || []).map((w) => ({ code: w.code, en: w.message, vi: w.messageVi || w.message })) };
		}

		// ------------------------------------------------------------------ thông tin của tôi

		function opMe(ctx) {
			const me = ctx.me;
			const today = deps.today();
			const prof = profileOf(me.id);
			const contracts = safe(() => Store.find("contract", { where: "{employee} = ?", params: [me.id] }).filter((c) => SS.isOwn(c, me.id)), []);
			const cur = Timeline.currentContract(contracts, today) || Timeline.latestContract(contracts);
			const deps2 = prof ? Store.find("dependent", { where: "{profile} = ?", params: [prof.id] }).filter((d) => String(d.profile) === String(prof.id)) : [];
			return {
				today,
				employee: { code: me.code, name: me.name, department: me.department, jobTitle: me.jobTitle },
				profile: prof
					? {
							hireDate: prof.hire_date || null, employmentType: prof.employment_type || "", bankName: prof.bank_name || "",
							bankAccount: SS.maskTail(prof.bank_account), taxCode: SS.maskTail(prof.tax_code), personalId: SS.maskTail(prof.personal_id), siNumber: SS.maskTail(prof.si_number),
						}
					: null,
				contract: cur
					? {
							number: cur.number || "", type: cur.type || "", title: cur.title || "", signDate: cur.sign_date || null, effective: cur.effective || null, expiry: cur.expiry || null,
							state: Timeline.contractState(cur, today).state, daysLeft: cur.expiry ? Dates.diff(today, cur.expiry) : null,
						}
					: null,
				dependents: deps2
					.map((d) => ({
						name: d.name || "", relationship: d.relationship || "", birthDate: d.birth_date || null, taxCode: SS.maskTail(d.tax_code), from: d.from || null, to: d.to || null,
						active: (!d.from || Dates.cmp(d.from, today) <= 0) && (!d.to || Dates.cmp(d.to, today) >= 0),
					}))
					.sort((a, b) => String(a.from || "").localeCompare(String(b.from || ""))),
			};
		}

		function opBoot(ctx) {
			return { today: deps.today(), employee: { code: ctx.me.code, name: ctx.me.name }, hasProfile: !!profileOf(ctx.me.id) };
		}

		const OPS = { boot: opBoot, payslips: opPayslips, payslip: opPayslip, leave: opLeave, requests: opRequests, me: opMe, saveRequest: opSaveRequest, requestAction: opRequestAction };

		/**
		 * Một lượt gọi của trang. Luôn xác định lại người đăng nhập và kiểm tham số nhân viên trước khi chạy op.
		 * @param {string} method GET | POST
		 * @param {Object} params tham số URL
		 * @param {Object} [body] thân JSON của POST
		 */
		function handle(method, params, body) {
			const p = params || {};
			const b = body && typeof body === "object" ? body : {};
			const op = String(p.op || b.op || "");
			try {
				if (!Object.prototype.hasOwnProperty.call(OPS, op)) throw fail("INVALID", "Unknown operation.", "Lượt gọi không hợp lệ.");
				const write = POST_OPS.includes(op);
				if (write !== (String(method).toUpperCase() === "POST")) throw fail("INVALID", "Wrong request method.", "Sai phương thức gọi.");
				const me = identify();
				assertNoForeignEmployee(me.id, p, b);
				return { ok: true, data: OPS[op]({ me }, p, b) };
			} catch (e) {
				if (e && e.userMessage) {
					const out = { ok: false, code: e.code || "RULE", message: { en: e.userMessage.en, vi: e.userMessage.vi } };
					if (e.extra && e.extra.fields) out.fields = e.extra.fields;
					return out;
				}
				// Lỗi kỹ thuật: ghi mã op và thông báo cắt ngắn (không có số tiền), người dùng nhận thông báo chung
				if (deps.log) deps.log(`${op || "?"}: ${String((e && e.message) || e).slice(0, 300)}`);
				return { ok: false, code: "ERROR", message: { en: "Something went wrong. Please try again or contact HR.", vi: "Có lỗi xảy ra. Vui lòng thử lại hoặc liên hệ bộ phận nhân sự." } };
			}
		}

		return { handle, printDetail, identify };
	}

	return { create, POST_OPS };
});
