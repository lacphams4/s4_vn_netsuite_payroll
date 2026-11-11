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
 * Thao tác nhân sự (hợp đồng, quyết định, người phụ thuộc, hồ sơ lương, phân bổ, giấy phép lao động, tạm ứng) không gắn bảng
 * lương hay kỳ: dòng nhật ký gắn NHÂN VIÊN (trường employee). RESTlet hiện chỉ truyền { action, batch, period, id, lineId,
 * result } nên nhân viên lấy theo thứ tự: entry.employee, result.employee, rồi tra bản ghi vừa thao tác (ACTIONS[...].emp:
 * id lấy từ result.id hoặc entry.id). Thao tác thiết lập (cờ setup) được ghi mà không cần gắn gì.
 *
 * Route: GET auditLog { batch } | { period } | { employee } | { scope: "setup" } (vai trò "payroll")
 * -> { items: [{ at, user, action, label, detail, text, lineId, batch, period, employee }] },
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

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}
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
		// Duyệt bảng lương (api/PayrollRun.submitRun, api/Approvals)
		submitRun: { vi: "Gửi duyệt bảng lương", en: "Submitted the batch for approval" },
		approveStep: { vi: "Duyệt cấp", en: "Approved a level", detail: (r) => levelDetail(r, true) },
		rejectStep: { vi: "Từ chối bảng lương", en: "Rejected the batch", detail: (r) => levelDetail(r, false) },
		// Thao tác nhân sự: gắn nhân viên (emp = bản ghi để tra nhân viên khi RESTlet không truyền)
		hrSaveContract: { vi: "Lưu hợp đồng lao động", en: "Saved an employment contract", emp: "contract", ref: (r) => r.id },
		hrActivateContract: { vi: "Kích hoạt hợp đồng lao động", en: "Activated an employment contract", emp: "contract", ref: (r) => r.id },
		hrTerminateContract: { vi: "Chấm dứt hợp đồng lao động", en: "Terminated an employment contract", emp: "contract", ref: (r) => r.id },
		hrSaveDecision: { vi: "Lưu quyết định nhân sự", en: "Saved an HR decision", emp: "decision", ref: (r) => r.id },
		hrApplyDecision: { vi: "Áp dụng quyết định nhân sự", en: "Applied an HR decision", emp: "decision", ref: (r) => r.id },
		hrSaveDependent: {
			vi: "Lưu người phụ thuộc", en: "Saved a dependent", emp: "dependent", ref: (r) => r.id,
			detail: (r) => (r.created ? { vi: "Thêm mới", en: "Added" } : r.updated ? { vi: "Cập nhật", en: "Updated" } : { vi: "", en: "" }),
		},
		newAllocVersion: { vi: "Tạo phiên bản phân bổ chi phí", en: "Created a cost allocation version", emp: "alloc_version", ref: (r) => r.id },
		saveAllocLines: { vi: "Sửa dòng phân bổ chi phí", en: "Edited cost allocation lines", emp: "alloc_version", ref: (r) => r.id },
		activateAllocVersion: { vi: "Kích hoạt phiên bản phân bổ chi phí", en: "Activated a cost allocation version", emp: "alloc_version", ref: (r) => r.id },
		saveWorkPermit: { vi: "Lưu giấy phép lao động", en: "Saved a work permit", emp: "work_permit", ref: (r) => r.id },
		workPermitAction: { vi: "Xử lý giấy phép lao động", en: "Processed a work permit", emp: "work_permit", ref: (r) => r.id },
		saveProfile: { vi: "Lưu hồ sơ lương", en: "Saved the payroll profile", emp: "employee" },
		createAdvance: { vi: "Tạo phiếu tạm ứng", en: "Created a salary advance", emp: "advance", ref: (r) => r.id },
		removeHoldAdvance: { vi: "Bỏ tạm giữ phiếu tạm ứng", en: "Removed the hold on a salary advance", emp: "advance" },
		releaseAdvance: { vi: "Ghi sổ phiếu tạm ứng", en: "Released a salary advance", emp: "advance" },
		// Thao tác thiết lập: không gắn bảng lương, kỳ hay nhân viên
		saveCostAccount: { vi: "Lưu tài khoản chi phí lương", en: "Saved a payroll cost account", setup: true, ref: (r) => r.id },
		retireCostAccount: { vi: "Thôi dùng tài khoản chi phí lương", en: "Retired a payroll cost account", setup: true, ref: (r) => r.id },
		verifyParam: { vi: "Xác nhận tham số pháp lý", en: "Verified a statutory parameter", setup: true, ref: (r) => r.id },
	};

	/** Diễn giải của một quyết định duyệt: số cấp, tên cấp (không có số tiền). */
	function levelDetail(r, approved) {
		if (blank(r.level)) return { vi: "", en: "" };
		const name = blank(r.name) ? "" : ` - ${r.name}`;
		const tailVi = approved && r.final ? " (cấp cuối, bảng lương đã duyệt)" : "";
		const tailEn = approved && r.final ? " (final level, batch approved)" : "";
		const waivedVi = r.waived ? "; cùng người duyệt cấp liền trước vì cấp này chỉ có một người duyệt" : "";
		const waivedEn = r.waived ? "; same approver as the previous level because this level has a single approver" : "";
		return { vi: `Cấp ${r.level}${name}${tailVi}${waivedVi}`, en: `Level ${r.level}${name}${tailEn}${waivedEn}` };
	}

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
	 * @returns {{action, batch, period, employee, setup, line, text_vi, text_en}|null}
	 */
	function build(entry) {
		const e = entry || {};
		const action = String(e.action || "");
		if (!action || SKIP[action]) return null;
		const def = ACTIONS[action];
		const batch = isId(e.batch) ? String(e.batch) : null;
		const period = isId(e.period) ? String(e.period) : null;
		const result = e.result && typeof e.result === "object" ? e.result : {};
		const employee = isId(e.employee) ? String(e.employee) : isId(result.employee) ? String(result.employee) : null;
		// Action không có trong danh mục (route mới của phân hệ khác): chỉ ghi khi gắn với bảng lương, kỳ hoặc nhân viên
		if (!def && !batch && !period && !employee) return null;
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
			action, batch, period, employee, setup: !!(def && def.setup), line: blank(ref) ? "" : String(ref).slice(0, 100),
			text_vi: String(detail.vi || "").slice(0, TEXT_MAX), text_en: String(detail.en || "").slice(0, TEXT_MAX),
		};
	}

	/**
	 * Nhân viên của một thao tác nhân sự khi RESTlet không truyền: tra bản ghi vừa thao tác (id ở result.id, không có thì
	 * entry.id). Người phụ thuộc trỏ về hồ sơ lương (profile) rồi mới tới nhân viên. Không tra được thì null.
	 */
	function employeeOf(action, entry) {
		const def = ACTIONS[action];
		if (!def || !def.emp) return null;
		const result = entry.result && typeof entry.result === "object" ? entry.result : {};
		const id = isId(result.id) ? result.id : isId(entry.id) ? entry.id : null;
		if (!id) return null;
		try {
			const row = Store.get(def.emp, id) || {};
			if (isId(row.employee)) return String(row.employee);
			if (isId(row.profile)) {
				const p = Store.get("employee", row.profile) || {};
				return isId(p.employee) ? String(p.employee) : null;
			}
		} catch (e) {
			// không đọc được: không gắn nhân viên
		}
		return null;
	}

	/**
	 * RESTlet gọi sau mỗi POST thành công: entry = { action, batch, period, id, lineId, result } (employee nếu có).
	 * Trả id dòng nhật ký, hoặc null khi không ghi. Không bao giờ ném lỗi.
	 */
	function record(entry) {
		try {
			const row = build(entry);
			if (!row) return null;
			if (!row.employee) row.employee = employeeOf(row.action, entry || {});
			if (!row.batch && !row.period && !row.employee) row.batch = batchOfLine(row.action, entry || {});
			// Không gắn được với bảng lương, kỳ hay nhân viên nào (dòng đã bị xóa mà body không kèm batch): dòng nhật ký sẽ không
			// hiện ở đâu cả nên không ghi - trừ thao tác thiết lập
			const setup = row.setup;
			delete row.setup;
			if (!row.batch && !row.period && !row.employee && !setup) return null;
			// Trường employee chỉ ghi khi có giá trị (record nhật ký bản cũ chưa có trường này vẫn ghi được dòng bảng lương / kỳ)
			if (!row.employee) delete row.employee;
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
			lineId: row.line || null, batch: row.batch || null, period: row.period || null, employee: row.employee || null,
		};
	}

	/** GET auditLog { batch } | { period } | { employee } | { scope: "setup" }: mới nhất trước, tối đa MAX_ROWS dòng. */
	function auditLog(params) {
		const p = params || {};
		const batch = isId(p.batch) ? String(p.batch) : "";
		const period = isId(p.period) ? String(p.period) : "";
		const employee = isId(p.employee) ? String(p.employee) : "";
		const setup = String(p.scope || "") === "setup";
		if (!batch && !period && !employee && !setup) throw fail("A payroll batch, a pay period or an employee is required", "Cần chọn bảng lương, kỳ lương hoặc nhân viên");
		let where;
		let args;
		if (employee && !batch && !period) {
			where = "{employee} = ?";
			args = [employee];
		} else if (setup && !batch && !period) {
			where = "{batch} IS NULL AND {period} IS NULL AND {employee} IS NULL";
			args = [];
		} else if (batch) {
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
