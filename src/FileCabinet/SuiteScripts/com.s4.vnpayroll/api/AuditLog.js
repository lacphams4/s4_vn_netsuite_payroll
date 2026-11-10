/**
 * Nhật ký kỳ lương (docs/design/CanhBao.dc.html, docs/UI_V2.md mục 5 và 9): ai làm gì, lúc nào trên bảng lương và kỳ công.
 *
 * record(entry) được RESTlet s4vp_rl_api gọi sau mỗi POST thành công với entry = { action, batch, period, id, lineId, result }.
 * Chỉ ghi các thao tác có ý nghĩa nghiệp vụ (bảng ACTIONS bên dưới, và action mới của giao diện bản 2 có gắn bảng lương
 * hoặc kỳ); bỏ qua jobStatus và thao tác chỉ đọc / thiết lập. Mỗi dòng nhật ký là một record audit_log (tiền tố blg):
 * thời điểm (UTC, ISO), người dùng, action, bảng lương, kỳ, dòng, diễn giải ngắn vi / en.
 *
 * KHÔNG ghi số tiền lương hay số định danh (mã số thuế, CCCD, tài khoản): diễn giải chỉ gồm số lượng (số nhân viên, số dòng,
 * số lỗi), mã quy tắc kiểm tra và mã nhân viên. Mọi lỗi trong record đều bị nuốt (trả null) nên không làm hỏng thao tác chính.
 *
 * Route: GET auditLog { batch } hoặc { period } (vai trò "payroll") -> { items: [{ at, user, action, label, detail, text, lineId, batch, period }] },
 * mới nhất trước. `at` là chuỗi ISO UTC (ví dụ 2027-03-30T02:42:11.000Z), giao diện đổi sang giờ máy người dùng; `label` là
 * tên thao tác, `detail` là diễn giải, `text` = label + " - " + detail theo ngôn ngữ người đọc.
 * Nhật ký của một bảng lương gồm cả thao tác trên kỳ của bảng đó (khóa công, lập bảng công...); nhật ký của một kỳ gồm cả
 * thao tác trên các bảng lương thuộc kỳ.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "./Store", "./Clock"], (runtime, log, Store, Clock) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const MAX_ROWS = 500;
	const TEXT_MAX = 290;

	// Thao tác không ghi nhật ký: hỏi trạng thái tác vụ nền, và mọi thứ chỉ đọc
	const SKIP = { jobStatus: true };

	const count = (v) => {
		const n = Number(v);
		return isFinite(n) && n > 0 ? Math.floor(n) : 0;
	};
	const CHECK_STATUS = { vi: { open: "mở lại", accepted: "chấp nhận", resolved: "đã xử lý" }, en: { open: "reopened", accepted: "accepted", resolved: "resolved" } };

	/**
	 * Thao tác được ghi: nhãn vi / en và hàm dựng diễn giải từ kết quả (chỉ số lượng, không số tiền).
	 * scope: "batch" | "period" cho biết khóa thô body.id là gì khi RESTlet chưa suy ra.
	 */
	const ACTIONS = {
		createBatch: { vi: "Tạo bảng lương", en: "Created the payroll batch" },
		loadEmployees: {
			vi: "Nạp nhân viên", en: "Loaded employees",
			detail: (r) => ({ vi: `Thêm ${count(r.added)}, cập nhật ${count(r.updated)}, bỏ qua ${count(r.skipped)} nhân viên`, en: `${count(r.added)} added, ${count(r.updated)} updated, ${count(r.skipped)} skipped` }),
		},
		syncTime: {
			vi: "Nạp giờ công", en: "Loaded time",
			detail: (r) => ({
				vi: `Nhận ${count(r.accepted)}/${count(r.entries)} dòng timesheet${count(r.pending) ? `; ${count(r.pending)} dòng chưa duyệt` : ""}`,
				en: `${count(r.accepted)}/${count(r.entries)} time entries accepted${count(r.pending) ? `; ${count(r.pending)} not approved` : ""}`,
			}),
		},
		saveTime: { vi: "Sửa giờ công tính lương", en: "Edited payroll hours", line: true },
		calculate: {
			vi: "Tính lương", en: "Calculated payroll",
			detail: (r) => {
				if (r.queued) return { vi: "Chạy nền", en: "Queued in the background" };
				const errors = Array.isArray(r.errors) ? r.errors.length : 0;
				const n = r.totals ? count(r.totals.emp_count) : 0;
				return { vi: `${n} nhân viên, ${errors ? `${errors} lỗi` : "không lỗi"}`, en: `${n} employees, ${errors ? `${errors} error(s)` : "no errors"}` };
			},
		},
		hold: { vi: "Tạm giữ bảng lương", en: "Put the batch on hold" },
		removeHold: { vi: "Bỏ tạm giữ", en: "Removed the hold" },
		approve: { vi: "Duyệt bảng lương", en: "Approved the batch" },
		reject: { vi: "Từ chối bảng lương", en: "Rejected the batch" },
		reopen: { vi: "Mở lại bảng lương", en: "Reopened the batch" },
		release: { vi: "Ghi sổ bảng lương", en: "Released the batch" },
		reverse: { vi: "Đảo bảng lương", en: "Reversed the batch" },
		agencyBills: {
			vi: "Lập bill cơ quan thu", en: "Created agency bills",
			detail: (r) => ({ vi: `${count(r.created && r.created.length !== undefined ? r.created.length : r.created)} bill`, en: `${count(r.created && r.created.length !== undefined ? r.created.length : r.created)} bill(s)` }),
		},
		clearJob: { vi: "Gỡ khóa tác vụ nền", en: "Cleared the background job lock" },
		saveInput: { vi: "Thêm / sửa khoản nhập tay", en: "Saved a manual line", line: true },
		deleteInput: { vi: "Xóa khoản nhập tay", en: "Deleted a manual line", line: true },
		updateLine: { vi: "Sửa dòng nhân viên", en: "Edited an employee line", line: true },
		removeLine: { vi: "Gỡ nhân viên khỏi bảng lương", en: "Removed an employee from the batch", line: true },
		closePeriod: { vi: "Đóng kỳ lương", en: "Closed the pay period" },
		reopenPeriod: { vi: "Mở lại kỳ lương", en: "Reopened the pay period" },
		lockAttendance: { vi: "Khóa công", en: "Locked attendance" },
		unlockAttendance: { vi: "Mở khóa công", en: "Unlocked attendance" },
		buildAttendance: { vi: "Lập bảng tổng hợp công", en: "Built the attendance summary" },
		processPunches: { vi: "Xử lý lượt chấm công", en: "Processed clock punches" },
		loadSheetEmployees: { vi: "Nạp nhân viên vào bảng công", en: "Loaded employees into the attendance sheet" },
		saveSheet: { vi: "Sửa bảng công ký hiệu", en: "Edited the attendance sheet" },
		resolveCheckGroup: {
			vi: "Xử lý cả nhóm cảnh báo", en: "Handled a group of checks",
			detail: (r) => ({ vi: `${r.rule || ""}: ${r.closed || 0} mục - ${CHECK_STATUS.vi[r.status] || r.status || ""}`, en: `${r.rule || ""}: ${r.closed || 0} item(s) - ${CHECK_STATUS.en[r.status] || r.status || ""}` }),
		},
		resolveCheck: {
			vi: "Xử lý cảnh báo", en: "Handled a check",
			detail: (r) => {
				const who = [r.rule, r.employeeCode].filter((x) => !blank(x)).join(" - ");
				return { vi: `${who}: ${CHECK_STATUS.vi[r.status] || r.status || ""}`, en: `${who}: ${CHECK_STATUS.en[r.status] || r.status || ""}` };
			},
			ref: (r) => r.key,
		},
	};

	function lang() {
		try {
			return /^vi/i.test(String(runtime.getCurrentUser().getPreference({ name: "LANGUAGE" }) || "")) ? "vi" : "en";
		} catch (e) {
			return "vi";
		}
	}

	const isId = (v) => !blank(v) && /^\d+$/.test(String(v));

	/** Thao tác trên một dòng (id dòng nhân viên, dòng giờ, dòng nhập tay): tìm bảng lương của dòng nếu còn đọc được. */
	function batchOfLine(action, entry) {
		try {
			if (action === "updateLine" && isId(entry.id)) return (Store.get("batch_emp", entry.id) || {}).batch || null;
			if (action === "saveTime" && isId(entry.lineId)) return (Store.get("batch_time", entry.lineId) || {}).batch || null;
			if (action === "saveInput" && entry.result && isId(entry.result.id)) return (Store.get("batch_input", entry.result.id) || {}).batch || null;
		} catch (e) {
			// không đọc được: ghi nhật ký không gắn bảng lương
		}
		return null;
	}

	/**
	 * Dựng dòng nhật ký từ entry của RESTlet; null = không ghi. Hàm thuần (không đọc ghi gì) để kiểm thử.
	 * @returns {{action, batch, period, line, text_vi, text_en}|null}
	 */
	function build(entry) {
		const e = entry || {};
		const action = String(e.action || "");
		if (!action || SKIP[action]) return null;
		const def = ACTIONS[action];
		const batch = isId(e.batch) ? String(e.batch) : null;
		const period = isId(e.period) ? String(e.period) : null;
		// Action không có trong danh mục (route mới của phân hệ khác): chỉ ghi khi gắn với bảng lương hoặc kỳ
		if (!def && !batch && !period) return null;
		const result = e.result && typeof e.result === "object" ? e.result : {};
		let detail = { vi: "", en: "" };
		let ref = null;
		if (def) {
			try {
				if (def.detail) detail = def.detail(result) || detail;
				if (def.ref) ref = def.ref(result);
			} catch (x) {
				detail = { vi: "", en: "" };
			}
		}
		if (blank(ref)) ref = !blank(e.lineId) ? e.lineId : def && def.line && !blank(e.id) ? e.id : null;
		return {
			action, batch, period, line: blank(ref) ? "" : String(ref).slice(0, 100),
			text_vi: String(detail.vi || "").slice(0, TEXT_MAX), text_en: String(detail.en || "").slice(0, TEXT_MAX),
		};
	}

	/**
	 * RESTlet gọi sau mỗi POST thành công: entry = { action, batch, period, id, lineId, result }.
	 * Trả id dòng nhật ký, hoặc null khi không ghi. Không bao giờ ném lỗi.
	 */
	function record(entry) {
		try {
			const row = build(entry);
			if (!row) return null;
			if (!row.batch && !row.period) row.batch = batchOfLine(row.action, entry || {});
			// Không gắn được với bảng lương hay kỳ nào (dòng đã bị xóa mà body không kèm batch): dòng nhật ký sẽ không hiện ở
			// đâu cả nên không ghi
			if (!row.batch && !row.period) return null;
			let user = null;
			let userName = "";
			try {
				const u = runtime.getCurrentUser();
				user = Number(u.id) > 0 ? String(u.id) : null;
				userName = String(u.name || "");
			} catch (x) {
				// không có người dùng (tác vụ nền)
			}
			return Store.create("audit_log", Object.assign(row, { at: new Date().toISOString(), date: Clock.today(), user, user_name: userName.slice(0, 200) }));
		} catch (e) {
			try {
				log.error({ title: "s4vp AuditLog.record", details: String((e && e.message) || e).slice(0, 300) });
			} catch (x) {
				// bỏ qua
			}
			return null;
		}
	}

	/** Tên thao tác theo ngôn ngữ; action lạ hiện đúng mã. */
	function labelOf(action, l) {
		const def = ACTIONS[action];
		return def ? def[l === "en" ? "en" : "vi"] : String(action || "");
	}

	function view(row, l) {
		const label = labelOf(row.action, l);
		const detail = (l === "en" ? row.text_en : row.text_vi) || "";
		return {
			at: row.at || "", user: row.user_name || "", userId: row.user || null, action: row.action, label, detail, text: detail ? `${label} - ${detail}` : label,
			lineId: row.line || null, batch: row.batch || null, period: row.period || null,
		};
	}

	/** GET auditLog { batch } hoặc { period }: mới nhất trước, tối đa MAX_ROWS dòng. */
	function auditLog(params) {
		const p = params || {};
		const batch = isId(p.batch) ? String(p.batch) : "";
		const period = isId(p.period) ? String(p.period) : "";
		if (!batch && !period) {
			const e = new Error("A payroll batch or a pay period is required / Cần chọn bảng lương hoặc kỳ lương");
			e.userMessage = { en: "A payroll batch or a pay period is required", vi: "Cần chọn bảng lương hoặc kỳ lương" };
			throw e;
		}
		let where;
		let args;
		if (batch) {
			// Kèm thao tác cấp kỳ (không gắn bảng lương) của kỳ mà bảng lương thuộc về
			const b = Store.get("batch", batch);
			if (b && b.period) {
				where = "{batch} = ? OR ({period} = ? AND {batch} IS NULL)";
				args = [batch, b.period];
			} else {
				where = "{batch} = ?";
				args = [batch];
			}
		} else {
			const ids = Store.find("batch", { where: "{period} = ?", params: [period] }).map((b) => b.id).slice(0, 900);
			where = ids.length ? `{period} = ? OR {batch} IN (${ids.map(() => "?").join(",")})` : "{period} = ?";
			args = [period].concat(ids);
		}
		let rows = [];
		try {
			rows = Store.find("audit_log", { where, params: args, order: "{id} DESC" });
		} catch (e) {
			// record nhật ký chưa được deploy: trả danh sách rỗng thay vì làm hỏng màn hình
			log.error({ title: "s4vp AuditLog.auditLog", details: String((e && e.message) || e).slice(0, 300) });
			return { items: [], unavailable: true };
		}
		const l = lang();
		return { items: rows.slice(0, MAX_ROWS).map((r) => view(r, l)), truncated: rows.length > MAX_ROWS };
	}

	const routes = {
		get: { auditLog: { roles: "payroll", run: auditLog } },
		post: {},
	};

	return { routes, record, build, labelOf, auditLog, ACTIONS };
});
