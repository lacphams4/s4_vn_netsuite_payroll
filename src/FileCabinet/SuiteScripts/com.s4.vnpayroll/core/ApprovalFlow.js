/**
 * Duyệt bảng lương nhiều cấp (docs/UI_V2.md mục 14): từ cấu hình cấp duyệt + bảng lương + nhật ký duyệt suy ra các cấp phải
 * qua, cấp đang chờ, ai được duyệt và đã xong chưa. Hàm thuần, không gọi N/*; load() nhận bộ đọc (api/Store) từ bên gọi.
 *
 * MẶC ĐỊNH TẮT: không có dòng cấu hình nào áp dụng cho bảng lương thì enabled = false và gói duyệt một cấp như cũ.
 *
 * Đầu vào evaluate(input):
 *   config   dòng record approval_step: { subsidiary, level, name, approver, role, min_net, isInactive }
 *            (mỗi dòng là MỘT người duyệt của một cấp; nhiều dòng cùng cấp = người duyệt thay thế nhau)
 *   batch    { id, subsidiary, net, status }
 *   logs     dòng record approval_log của bảng lương: { id, round, level, step_name, approver, approver_name, decision, at, note, waived }
 *   markers  mốc từ nhật ký thao tác (audit_log) của bảng lương: [{ action: "submitRun" | "reopen" | "reject", at, user }]
 *   user     { id, role } người đang thao tác (role là script id: administrator, customrole_s4vp_hr, customrole_s4vp_accountant;
 *            customrole_s4vp_demo khớp mọi vai trò duyệt)
 *   roleMembers  tùy chọn { H: n, A: n, D: n } số người có vai trò; thiếu = coi như vai trò có nhiều người
 *
 * Quy tắc:
 * 1. Cấp phải qua: công ty con của bảng lương có dòng riêng thì chỉ dùng dòng riêng, nếu không dùng dòng không ghi công ty;
 *    bỏ dòng thôi dùng, dòng thiếu người duyệt, dòng có ngưỡng lớn hơn tổng thực lĩnh của bảng lương. Sắp theo số cấp.
 * 2. Lượt gửi duyệt: chỉ tính khi bảng lương đang chờ duyệt (P). Quyết định duyệt còn hiệu lực là dòng A ghi SAU mốc gần
 *    nhất trong: gửi duyệt, mở lại, từ chối (mốc nhật ký thao tác) và dòng R của nhật ký duyệt. Vậy từ chối ở bất kỳ cấp nào
 *    hoặc mở lại đều kết thúc lượt; gửi lại thì bắt đầu lượt mới từ cấp 1.
 * 3. Cấp đang chờ = cấp nhỏ nhất chưa có dòng A còn hiệu lực. Đủ mọi cấp = complete.
 * 4. Được duyệt cấp đang chờ khi: là nhân viên được khai của cấp, hoặc đang đăng nhập bằng vai trò được khai của cấp;
 *    KHÔNG phải người gửi duyệt của lượt này; KHÔNG phải người vừa duyệt cấp liền trước của lượt này - trừ khi cấp đang chờ
 *    chỉ có đúng một người đủ quyền là chính người đó (khi đó cho phép, waived = true để ghi chú vào nhật ký).
 * 5. Từ chối: người duyệt của cấp đang chờ (không xét quy tắc người gửi / tách nhiệm vụ).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
	const ROLE_IDS = { H: "customrole_s4vp_hr", A: "customrole_s4vp_accountant", D: "administrator" };
	const ROLE_NAMES = {
		H: { en: "HR role", vi: "Vai trò Nhân sự" },
		A: { en: "Accountant role", vi: "Vai trò Kế toán" },
		D: { en: "Administrator", vi: "Administrator" },
	};
	// Vai trò trình diễn (quay video): được coi là thành viên của mọi vai trò duyệt (H, A, D); quy tắc người gửi duyệt và tách
	// nhiệm vụ giữa hai cấp liền nhau vẫn áp dụng như mọi người duyệt
	const DEMO_ROLE = "customrole_s4vp_demo";
	const roleMatch = (code, userRole) => !!ROLE_IDS[code] && (ROLE_IDS[code] === str(userRole) || str(userRole) === DEMO_ROLE);
	const MARKER_ACTIONS = ["submitRun", "reopen", "reject"];
	const APPROVED = ["A", "R", "V"];

	const blank = (v) => v === null || v === undefined || v === "";
	const str = (v) => (blank(v) ? "" : String(v));
	const int = (v) => {
		const n = Number(v);
		return isFinite(n) ? Math.floor(n) : 0;
	};
	const num = (v) => {
		const n = Number(v);
		return isFinite(n) ? n : 0;
	};

	/** Các cấp phải qua của một bảng lương: [{ level, name, approvers: [{ employee, role }] }] theo thứ tự cấp. */
	function requiredSteps(config, batch) {
		const b = batch || {};
		const rows = (Array.isArray(config) ? config : []).filter((r) => r && !r.isInactive && int(r.level) > 0 && (!blank(r.approver) || !blank(ROLE_IDS[str(r.role)])));
		const own = rows.filter((r) => !blank(r.subsidiary) && str(r.subsidiary) === str(b.subsidiary));
		const pool = own.length ? own : rows.filter((r) => blank(r.subsidiary));
		const net = num(b.net);
		const byLevel = {};
		for (const r of pool) {
			if (num(r.min_net) > 0 && net < num(r.min_net)) continue;
			const level = int(r.level);
			const step = (byLevel[level] = byLevel[level] || { level, name: "", approvers: [] });
			if (!step.name && !blank(r.name)) step.name = String(r.name).trim();
			const who = { employee: blank(r.approver) ? "" : String(r.approver), role: blank(r.approver) ? str(r.role) : "" };
			if (!step.approvers.some((a) => a.employee === who.employee && a.role === who.role)) step.approvers.push(who);
		}
		return Object.keys(byLevel).map(Number).sort((a, b2) => a - b2).map((k) => byLevel[k]);
	}

	const byTime = (a, b) => (str(a.at) < str(b.at) ? -1 : str(a.at) > str(b.at) ? 1 : num(a.id) - num(b.id));

	function isApprover(step, user) {
		const u = user || {};
		return !!step && step.approvers.some((a) => (a.employee && a.employee === str(u.id)) || (a.role && roleMatch(a.role, u.role)));
	}

	/** Cấp chỉ có đúng một người đủ quyền và đó là người đang thao tác (vai trò: chỉ khi biết chắc vai trò có không quá một người). */
	function soleApprover(step, user, roleMembers) {
		const u = user || {};
		const members = roleMembers || {};
		if (!step || !step.approvers.length || !isApprover(step, u)) return false;
		return step.approvers.every((a) => {
			if (a.employee) return a.employee === str(u.id);
			return roleMatch(a.role, u.role) && !blank(members[a.role]) && int(members[a.role]) <= 1;
		});
	}

	const REASONS = {
		notSubmitted: { en: "The batch has not been submitted for approval", vi: "Bảng lương chưa được gửi duyệt" },
		complete: { en: "Every approval level is done", vi: "Mọi cấp duyệt đã xong" },
		notApprover: (s) => ({ en: `You are not an approver of level ${s.level}${s.name ? ` (${s.name})` : ""}`, vi: `Bạn không phải người duyệt của cấp ${s.level}${s.name ? ` (${s.name})` : ""}` }),
		submitter: { en: "The person who submitted the batch cannot approve it", vi: "Người gửi duyệt không được tự duyệt bảng lương" },
		sameApprover: (s) => ({ en: `You approved the previous level; level ${s.level} needs another approver`, vi: `Bạn đã duyệt cấp liền trước, cấp ${s.level} cần người duyệt khác` }),
		pendingLevel: (s) => ({ en: `Approval level ${s.level}${s.name ? ` (${s.name})` : ""} is still pending; approve level by level`, vi: `Cấp duyệt ${s.level}${s.name ? ` (${s.name})` : ""} chưa duyệt, phải duyệt lần lượt từng cấp` }),
	};

	function reason(code, step) {
		const r = REASONS[code];
		const text = typeof r === "function" ? r(step || { level: "", name: "" }) : r || { en: code, vi: code };
		return { ok: false, code, en: text.en, vi: text.vi };
	}

	/**
	 * Trạng thái duyệt của một bảng lương.
	 * @returns {{enabled, status, round, submitter, levels: [{level, name, approvers, state, by, byName, at, note, waived}], current, complete, last,
	 *   can: {ok, code?, en?, vi?, waived?}, canReject: {ok, code?, en?, vi?}}}
	 *   state: "done" | "current" | "todo" | "rejected"; current = cấp đang chờ (null nếu không có); last = current là cấp cuối.
	 */
	function evaluate(input) {
		const i = input || {};
		const batch = i.batch || {};
		const status = str(batch.status).toUpperCase();
		const required = requiredSteps(i.config, batch);
		const logs = (Array.isArray(i.logs) ? i.logs : []).filter(Boolean).slice().sort(byTime);
		const markers = (Array.isArray(i.markers) ? i.markers : []).filter((m) => m && MARKER_ACTIONS.indexOf(m.action) >= 0 && !blank(m.at)).slice().sort(byTime);
		const user = i.user || {};
		const off = { enabled: false, status, round: 0, submitter: "", levels: [], current: null, complete: true, last: false, can: { ok: true }, canReject: { ok: true } };

		const maxRound = logs.reduce((m, l) => Math.max(m, int(l.round)), 0);
		const lastRound = logs.filter((l) => int(l.round) === maxRound);

		// Bảng lương đã duyệt / ghi sổ / đảo: chỉ hiện lại các cấp đã ghi trong nhật ký của lượt cuối (không còn gì để duyệt)
		if (APPROVED.indexOf(status) >= 0) {
			if (!lastRound.length || lastRound.some((l) => l.decision === "R")) return off;
			const seen = {};
			for (const l of lastRound) seen[int(l.level)] = l;
			const cfg = {};
			for (const s of required) cfg[s.level] = s;
			const levels = Object.keys(seen).map(Number).sort((a, b) => a - b).map((k) => levelView(cfg[k] || { level: k, name: "", approvers: [] }, seen[k], "done"));
			return Object.assign({}, off, { enabled: true, round: maxRound, levels });
		}
		if (!required.length) return off;

		// Mốc kết thúc lượt trước: gửi duyệt, mở lại, từ chối (nhật ký thao tác) và dòng từ chối của nhật ký duyệt
		let boundary = "";
		for (const m of markers) if (str(m.at) > boundary) boundary = str(m.at);
		for (const l of logs) if (l.decision === "R" && str(l.at) > boundary) boundary = str(l.at);
		const submits = markers.filter((m) => m.action === "submitRun");
		const lastMarker = markers.length ? markers[markers.length - 1] : null;
		const submitter = status === "P" && lastMarker && lastMarker.action === "submitRun" ? str(lastMarker.user) : "";

		let shown = [];
		let round;
		if (status === "P") {
			shown = logs.filter((l) => l.decision === "A" && str(l.at) > boundary);
			round = shown.length ? shown.reduce((m, l) => Math.max(m, int(l.round)), 0) : Math.max(submits.length, maxRound + 1, 1);
		} else if (status === "J") {
			shown = lastRound;
			round = maxRound;
		} else {
			round = Math.max(submits.length, maxRound) + 1;
		}
		const byLevel = {};
		for (const l of shown) byLevel[int(l.level)] = l;

		const levels = [];
		let current = null;
		for (const s of required) {
			const log = byLevel[s.level];
			let state = "todo";
			if (log && log.decision === "A") state = "done";
			else if (log && log.decision === "R") state = "rejected";
			else if (status === "P" && !current) state = "current";
			const v = levelView(s, log, state);
			if (state === "current") current = v;
			levels.push(v);
		}
		// Cấp có trong nhật ký của lượt đang hiện nhưng không còn trong cấu hình (cấu hình đổi giữa chừng): vẫn hiện
		for (const k of Object.keys(byLevel).map(Number)) {
			if (k > 0 && !required.some((s) => s.level === k)) levels.push(levelView({ level: k, name: "", approvers: [] }, byLevel[k], byLevel[k].decision === "R" ? "rejected" : "done"));
		}
		levels.sort((a, b) => a.level - b.level);

		const complete = status === "P" && !current;
		const last = !!current && required[required.length - 1].level === current.level;
		let can;
		let canReject;
		if (status !== "P") {
			can = reason("notSubmitted");
			// Chưa gửi duyệt: từ chối theo quy tắc cũ của gói (api/Payroll.reject tự kiểm trạng thái)
			canReject = { ok: true };
		} else if (!current) {
			can = reason("complete");
			canReject = { ok: true };
		} else {
			const step = required.find((s) => s.level === current.level);
			const idx = required.indexOf(step);
			const prevLog = idx > 0 ? byLevel[required[idx - 1].level] : null;
			canReject = isApprover(step, user) ? { ok: true } : reason("notApprover", step);
			if (!isApprover(step, user)) can = reason("notApprover", step);
			else if (submitter && submitter === str(user.id)) can = reason("submitter");
			else if (prevLog && !blank(prevLog.approver) && str(prevLog.approver) === str(user.id)) {
				can = soleApprover(step, user, i.roleMembers) ? { ok: true, waived: true } : reason("sameApprover", step);
			} else can = { ok: true };
		}
		return { enabled: true, status, round, submitter, levels, current, complete, last, can, canReject };
	}

	function levelView(step, log, state) {
		const l = log || {};
		return {
			level: step.level, name: step.name || str(l.step_name), approvers: step.approvers, state,
			by: str(l.approver), byName: str(l.approver_name), at: str(l.at), note: str(l.note), waived: l.waived === true,
		};
	}

	/**
	 * Cổng của thao tác duyệt cuối (api/Payroll.approve): khi có cấp duyệt thì chỉ cho chuyển sang "đã duyệt" khi mọi cấp đã
	 * có quyết định duyệt, hoặc khi bên gọi (api/Approvals.approveStep) đang duyệt đúng cấp cuối còn chờ (opt.step) và người
	 * thao tác được duyệt cấp đó.
	 * @returns {{ok: true, waived?: boolean, state?: Object} | {ok: false, code, en, vi}}
	 */
	function finalGate(input, opt) {
		const st = evaluate(input);
		if (!st.enabled) return { ok: true, state: st };
		if (st.status !== "P") return reason("notSubmitted");
		if (st.complete) return { ok: true, state: st };
		const step = opt && !blank(opt.step) ? int(opt.step) : null;
		if (step !== null && st.current && st.current.level === step && st.last) return st.can.ok ? { ok: true, waived: !!st.can.waived, state: st } : st.can;
		return reason("pendingLevel", st.current);
	}

	/** Cổng của thao tác từ chối (api/Payroll.reject): khi bảng lương đang qua các cấp duyệt thì chỉ người duyệt của cấp đang chờ được từ chối. */
	function rejectGate(input) {
		const st = evaluate(input);
		if (!st.enabled) return { ok: true, state: st };
		return st.canReject.ok ? { ok: true, state: st } : st.canReject;
	}

	/**
	 * Đọc cấu hình, nhật ký duyệt và mốc nhật ký thao tác của một bảng lương bằng bộ đọc của gói (api/Store). Record chưa
	 * deploy hoặc chưa khai cấp duyệt nào: trả cấu hình rỗng (không đọc thêm gì) nên gói chạy như cũ.
	 * @returns {{config: Array, logs: Array, markers: Array}}
	 */
	function load(Store, batch) {
		const out = { config: [], logs: [], markers: [] };
		const id = batch && batch.id;
		try {
			out.config = Store.find("approval_step") || [];
		} catch (e) {
			return out;
		}
		if (!out.config.length || blank(id)) return out;
		try {
			out.logs = Store.find("approval_log", { where: "{batch} = ?", params: [id], order: "{id}" }) || [];
		} catch (e) {
			out.logs = [];
		}
		try {
			const rows = Store.find("audit_log", { where: `{batch} = ? AND {action} IN (${MARKER_ACTIONS.map(() => "?").join(",")})`, params: [id].concat(MARKER_ACTIONS), order: "{id}" }) || [];
			out.markers = rows.map((r) => ({ id: r.id, action: r.action, at: r.at, user: r.user }));
		} catch (e) {
			out.markers = [];
		}
		return out;
	}

	/** Tên người duyệt của một cấp để hiển thị: tên nhân viên (names: { id: tên }) hoặc tên vai trò theo ngôn ngữ. */
	function approverNames(step, names, lang) {
		const l = lang === "en" ? "en" : "vi";
		return ((step && step.approvers) || []).map((a) => (a.employee ? (names && names[a.employee]) || `#${a.employee}` : (ROLE_NAMES[a.role] || {})[l] || a.role));
	}

	return { ROLE_IDS, ROLE_NAMES, MARKER_ACTIONS, requiredSteps, evaluate, finalGate, rejectGate, load, isApprover, soleApprover, approverNames, reason };
});
