/**
 * Duyệt bảng lương nhiều cấp (giao diện bản 2, docs/UI_V2.md mục 5 và 14). Quy tắc nằm ở core/ApprovalFlow.
 *
 * MẶC ĐỊNH TẮT: công ty chưa khai dòng nào ở record approval_step thì enabled = false, giao diện và action cũ (approve,
 * reject) chạy như trước. Khi có cấp duyệt, bảng lương phải được gửi duyệt (submitRun: C -> P) rồi qua lần lượt từng cấp;
 * action cũ `approve` bị api/Payroll.approve chặn cho tới khi đủ cấp (Payroll.canFinalApprove).
 *
 * GET  approvalState {batch} -> { enabled, status, round, steps: [{ level, name, approverName, state: done | current | todo | rejected,
 *                                by, at, note, waived }], current, currentName, final, canApprove, canReject, reason, rejectReason }
 *      `at` là chuỗi ISO UTC; `reason` là lý do (theo ngôn ngữ người đọc) khi canApprove = false.
 * POST approveStep {batch, note}  duyệt cấp đang chờ; cấp cuối thì gọi Payroll.approve (mọi kiểm tra của Payroll.approve vẫn
 *                                chạy; cấp chưa phải cuối chạy cùng bộ kiểm tra qua Payroll.assertCanApprove) rồi ghi nhật ký duyệt.
 * POST rejectStep  {batch, note}  từ chối (bắt buộc ghi chú): gọi Payroll.reject rồi ghi nhật ký duyệt; lượt gửi duyệt kết thúc.
 * Kết quả POST: { ok, level, name, final, round, waived } - RESTlet chuyển cho AuditLog (không có số tiền).
 *
 * Nhật ký duyệt (record approval_log) chỉ thêm. Cấp cuối: đổi trạng thái trước, ghi nhật ký sau; ghi nhật ký lỗi thì trả
 * logFailed = true thay vì báo lỗi (bảng lương đã duyệt xong).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "./Store", "./Payroll", "./Clock", "../core/ApprovalFlow"], (runtime, log, Store, Payroll, Clock, ApprovalFlow) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const NOTE_MAX = 1000;

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function lang() {
		try {
			return /^vi/i.test(String(runtime.getCurrentUser().getPreference({ name: "LANGUAGE" }) || "")) ? "vi" : "en";
		} catch (e) {
			return "vi";
		}
	}

	function batchOf(input) {
		const id = input && (input.batch || input.id);
		if (blank(id) || !/^\d+$/.test(String(id))) throw fail("A payroll batch is required", "Cần chọn bảng lương");
		return Payroll.getBatch(String(id));
	}

	/** Trạng thái duyệt đã tính của core/ApprovalFlow cho người đang thao tác. */
	function evaluate(b) {
		return ApprovalFlow.evaluate(Payroll.approvalInput(b));
	}

	function state(params) {
		const b = batchOf(params);
		const st = evaluate(b);
		if (!st.enabled) return { enabled: false, status: st.status, steps: [], canApprove: false, canReject: false, reason: "" };
		const l = lang();
		const ids = [];
		for (const s of st.levels) for (const a of s.approvers) if (a.employee) ids.push(a.employee);
		let names = {};
		try {
			const info = ids.length ? Payroll.employeesInfo(ids) : {};
			for (const k of Object.keys(info)) names[k] = info[k].name || info[k].code || "";
		} catch (e) {
			names = {};
		}
		const text = (g) => (g && !g.ok ? (l === "vi" ? g.vi : g.en) || "" : "");
		return {
			enabled: true, status: st.status, round: st.round,
			steps: st.levels.map((s) => ({
				level: s.level, name: s.name, approverName: ApprovalFlow.approverNames(s, names, l).join(", "), state: s.state,
				by: s.byName || (s.by ? names[s.by] || "" : ""), at: s.at, note: s.note, waived: s.waived,
			})),
			current: st.current ? st.current.level : null, currentName: st.current ? st.current.name : "", final: st.last,
			canApprove: !!st.can.ok, canReject: st.status === "P" && !!st.canReject.ok, reason: text(st.can), rejectReason: st.status === "P" ? text(st.canReject) : "",
		};
	}

	function writeLog(b, st, level, decision, note, waived) {
		let user = null;
		let userName = "";
		try {
			const u = runtime.getCurrentUser();
			user = Number(u.id) > 0 ? String(u.id) : null;
			userName = String(u.name || "");
		} catch (e) {
			// không có người dùng
		}
		return Store.create("approval_log", {
			batch: b.id, round: st.round || 1, level: level ? level.level : null, step_name: String((level && level.name) || "").slice(0, 200), approver: user,
			approver_name: userName.slice(0, 200), decision, at: new Date().toISOString(), date: Clock.today(), note: String(note || "").slice(0, NOTE_MAX), waived: !!waived,
		});
	}

	function approveStep(body) {
		const b = batchOf(body);
		const st = evaluate(b);
		// Chưa khai cấp duyệt: duyệt một cấp như action cũ
		if (!st.enabled) {
			Payroll.approve(b.id);
			return { ok: true, final: true, level: null, name: "" };
		}
		if (!st.can.ok) throw fail(st.can.en, st.can.vi);
		const level = st.current;
		const out = { ok: true, level: level.level, name: level.name, final: st.last, round: st.round, waived: !!st.can.waived };
		if (!st.last) {
			Payroll.assertCanApprove(b.id);
			writeLog(b, st, level, "A", body.note, st.can.waived);
			return out;
		}
		Payroll.approve(b.id, { step: level.level });
		try {
			writeLog(b, st, level, "A", body.note, st.can.waived);
		} catch (e) {
			log.error({ title: "s4vp Approvals.approveStep log", details: String((e && e.message) || e).slice(0, 300) });
			out.logFailed = true;
		}
		return out;
	}

	function rejectStep(body) {
		const b = batchOf(body);
		if (blank(body.note) || !String(body.note).trim()) throw fail("A note is required when rejecting", "Từ chối cần ghi chú lý do");
		const st = evaluate(b);
		// Payroll.reject tự kiểm trạng thái và quyền của người từ chối với cấp đang chờ
		Payroll.reject(b.id);
		const level = st.enabled ? st.current : null;
		const out = { ok: true, level: level ? level.level : null, name: level ? level.name : "", round: st.enabled ? st.round : null };
		if (!st.enabled) return out;
		try {
			writeLog(b, st, level, "R", body.note, false);
		} catch (e) {
			log.error({ title: "s4vp Approvals.rejectStep log", details: String((e && e.message) || e).slice(0, 300) });
			out.logFailed = true;
		}
		return out;
	}

	const routes = {
		get: { approvalState: { roles: "payroll", run: state } },
		post: {
			approveStep: { roles: "payroll", run: approveStep },
			rejectStep: { roles: "payroll", run: rejectStep },
		},
	};

	return { routes, state, approveStep, rejectStep };
});
