/**
 * API của màn hình Lương VN (SPA): danh mục, kỳ lương, bảng lương và thao tác. Mọi thao tác ghi đi qua api/Payroll,
 * kiểm tra trạng thái phía máy chủ; quyền theo role (HR không ghi sổ, không đảo, không lập bill - ma trận 1.4.1).
 *
 * GET  ?action=bootstrap | batches&subsidiary=&period= | batch&id= | journal&id= | bankfile&id=
 * POST {action: loadDefaults | generatePeriods | createBatch | loadEmployees | calculate | removeHold | hold | approve |
 *       reject | reopen | release | reverse | agencyBills | closePeriod | reopenPeriod | lockAttendance | unlockAttendance, ...}
 * Lỗi trả {error, errorVi}; số tiền lương không ghi vào log.
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "N/task", "../api/Store", "../api/Settings", "../api/Defaults", "../api/Periods", "../api/Payroll", "../api/Profiles", "../api/Advances", "../api/TestData", "../api/Reports", "../api/Attendance", "../api/Output", "../api/WorkPermits", "../api/AllocationPlans", "../api/Shifts"], (runtime, log, task, Store, Settings, Defaults, Periods, Payroll, Profiles, Advances, TestData, Reports, Attendance, Output, WorkPermits, AllocationPlans, Shifts) => {
	// Bảng lương lớn hơn ngưỡng này tính bằng Map/Reduce
	const SYNC_LIMIT = 120;
	// Ma trận quyền 1.4.1, kiểm tra phía máy chủ (POST mặc định từ chối). Administrator làm mọi thao tác.
	// HR: thiết lập, hồ sơ, chứng từ công, bảng lương (không ghi sổ, không đảo, không lập bill, không ghi sổ tạm ứng).
	// Kế toán: bảng lương và tạm ứng đầy đủ; thiết lập, hồ sơ chỉ xem; không làm chứng từ công.
	const BATCH_ACTIONS = ["createBatch", "loadEmployees", "calculate", "jobStatus", "removeHold", "hold", "approve", "reject", "reopen", "saveInput", "deleteInput", "updateLine", "removeLine", "createAdvance", "removeHoldAdvance"];
	const ACCOUNTANT_ONLY = ["release", "reverse", "agencyBills", "releaseAdvance"];
	const HR_ACTIONS = BATCH_ACTIONS.concat([
		"loadDefaults", "loadIndustryPack", "generatePeriods", "closePeriod", "reopenPeriod", "lockAttendance", "unlockAttendance", "buildAttendance",
		"saveProfile", "saveSetup", "saveCompany", "setInsuranceAccount", "saveDoc", "docAction", "accrueLeave", "expireLeave", "adjustLeave",
		"saveOutput", "outputAction", "loadTeamMembers", "splitOutput", "saveRateLine", "saveTeam", "saveWorkPermit", "workPermitAction", "updateExpiredPermits",
		"newAllocVersion", "saveAllocLines", "activateAllocVersion", "deleteAllocVersion",
		"saveShift", "savePattern", "generateRoster", "setRosterCell", "importPunches", "processPunches", "loadSheetEmployees", "saveSheet",
	]);
	const ACCOUNTANT_ACTIONS = BATCH_ACTIONS.concat(ACCOUNTANT_ONLY);
	const ADMIN_ONLY = ["generateTestData", "clearJob"];

	function allowed(action) {
		const r = role();
		if (r === "administrator") return true;
		if (ADMIN_ONLY.includes(action)) return false;
		if (r === "customrole_s4vp_hr") return HR_ACTIONS.includes(action);
		if (r === "customrole_s4vp_accountant") return ACCOUNTANT_ACTIONS.includes(action);
		return false;
	}

	function role() {
		return String(runtime.getCurrentUser().roleId || "");
	}

	function isHr() {
		return role() === "customrole_s4vp_hr";
	}

	function wrap(fn) {
		try {
			return fn();
		} catch (e) {
			log.error({ title: "s4vp_rl_api", details: String(e.message || e).slice(0, 500) });
			const m = e.userMessage;
			return { error: m ? m.en : String(e.message || e), errorVi: m ? m.vi : String(e.messageVi || e.message || e) };
		}
	}

	/** internal id của custom record của gói (để mở danh sách NetSuite). */
	function recordTypeIds() {
		const out = {};
		try {
			for (const r of Store.run("SELECT internalid, scriptid FROM customrecordtype WHERE UPPER(scriptid) LIKE 'CUSTOMRECORD_S4VP_%'", [], "s4vp_rectypes")) {
				out[String(r.scriptid).toLowerCase().replace("customrecord_s4vp_", "")] = String(r.internalid);
			}
		} catch (e) {
			log.error({ title: "recordTypeIds", details: String(e.message || e) });
		}
		return out;
	}

	function bootstrap() {
		let subsidiaries = [];
		try {
			subsidiaries = Store.run("SELECT id, name, iselimination FROM subsidiary WHERE isinactive = 'F' ORDER BY name", [], "s4vp_subs").filter((s) => s.iselimination !== "T").map((s) => ({ id: String(s.id), name: s.name }));
		} catch (e) {
			subsidiaries = [];
		}
		const setup = Store.find("setup");
		let unverified = [];
		if (setup.length) unverified = Store.find("param").filter((p) => p.verified === false).map((p) => `${p.name} (${p.effective})`);
		const companies = Store.find("company");
		const enabled = new Set(companies.filter((c) => c.enabled !== false).map((c) => c.subsidiary));
		const u = runtime.getCurrentUser();
		return {
			user: { id: u.id, name: u.name, role: role(), isHr: isHr(), isAccountant: role() === "customrole_s4vp_accountant", canEditSetup: allowed("saveSetup"), canAttendance: allowed("saveDoc"), lang: /^vi/i.test(String(u.getPreference({ name: "LANGUAGE" }) || "")) ? "vi" : "en" },
			setupReady: setup.length > 0,
			subsidiaries: subsidiaries.map((s) => Object.assign(s, { enabled: !companies.length || enabled.has(s.id) })),
			paygroups: Store.find("paygroup").map((g) => ({ id: g.id, code: g.name, description: g.description, frequency: g.frequency, subsidiary: g.subsidiary })),
			periods: Periods.list().map((p) => ({ id: p.id, code: p.name, paygroup: p.paygroup, start: p.start, end: p.end, status: p.status, attStatus: p.att_status, taxMonth: p.tax_month, stdDays: p.std_days, last: p.last_in_month })),
			unverified,
			leaveTypes: setup.length ? Store.find("leave_type").map((l) => ({ id: l.id, code: l.name, name: l.description, allowHalf: l.allow_half })) : [],
			earningTypes: setup.length ? Settings.earningTypes().list.filter((e) => e.isActive).map((e) => ({ id: e.id, code: e.code, name: e.description, taxTreatment: e.taxTreatment, isOvertime: e.isOvertime })) : [],
			recordTypeIds: recordTypeIds(),
			recordTypes: { batch: Store.rec("batch").type, period: Store.rec("period").type, employee: Store.rec("employee").type, attendance: Store.rec("attendance").type, setup: Store.rec("setup").type, company: Store.rec("company").type },
		};
	}

	function get(params) {
		return wrap(() => {
			switch (params.action) {
				case "bootstrap":
					return bootstrap();
				case "batches":
					return { batches: Payroll.list({ subsidiary: params.subsidiary, period: params.period }) };
				case "batch":
					return Payroll.detail(params.id);
				case "journal":
					return Payroll.journalPreview(params.id);
				case "bankfile":
					return Payroll.bankFile(params.id);
				case "docs":
					return { docs: Attendance.list(params.type, params.subsidiary, { status: params.status || "", employee: params.employee || "", from: params.from || "", to: params.to || "" }) };
				case "leaveBalances":
					return { balances: Attendance.balances(params.subsidiary, Number(params.year)) };
				case "attendance":
					return { rows: Store.find("attendance", { where: "{period} = ?", params: [params.period] }) };
				case "outputs":
					return { outputs: Output.list(params.subsidiary, params.period) };
				case "rateTables":
					return { tables: Store.find("rate_table").map((t) => Output.rateTable(t.id)), teams: Store.find("team") };
				case "workPermits":
					return { permits: WorkPermits.list(params.subsidiary) };
				case "allocVersions":
					return { versions: AllocationPlans.list(params.employee) };
				case "shifts":
					return { shifts: Shifts.shifts(), patterns: Shifts.patterns() };
				case "roster":
					return { roster: Shifts.roster(String(params.employee || "").split(",").filter(Boolean), params.from, params.to) };
				case "attSheet":
					return { rows: Store.find("att_sheet", { where: "{period} = ?", params: [params.period] }) };
				case "report":
					return Reports.run(params);
				case "txinfo":
					return Payroll.transactionsInfo(String(params.ids || "").split(",").slice(0, 50));
				case "advances":
					return { advances: Advances.list({ subsidiary: params.subsidiary }) };
				case "profiles":
					return { employees: Profiles.list(params.subsidiary) };
				case "lookups":
					return { accounts: Profiles.accounts(), vendors: Profiles.vendors(params.subsidiary), setup: Settings.tenant(), company: Settings.company(params.subsidiary), components: Store.find("ins_comp") };
				default:
					return { error: `Unknown action ${params.action}`, errorVi: `Thao tác không hợp lệ ${params.action}` };
			}
		});
	}

	function calculate(id, background) {
		const lines = Payroll.lines(id);
		if (!background && lines.length <= SYNC_LIMIT) return Payroll.calculate(id);
		// Kiểm tra và giữ khóa trước khi gửi tác vụ (QC2 #1, #2); gửi lỗi thì gỡ khóa
		Payroll.assertQueueable(id);
		Payroll.markQueued(id);
		let jobId;
		try {
			const t = task.create({ taskType: task.TaskType.MAP_REDUCE, scriptId: "customscript_s4vp_mr_calculate", deploymentId: "customdeploy_s4vp_mr_calculate", params: { custscript_s4vp_mr_batch: id } });
			jobId = t.submit();
		} catch (e) {
			Payroll.clearJob(id);
			throw e;
		}
		Payroll.setJobId(id, jobId);
		return { queued: true, job: jobId };
	}

	function post(body) {
		return wrap(() => {
			const a = body && body.action;
			if (!allowed(a)) {
				log.audit({ title: "s4vp_rl_api denied", details: `${role()} ${a}` });
				return { error: "Your role is not allowed to perform this action", errorVi: "Vai trò của bạn không được thực hiện thao tác này" };
			}
			switch (a) {
				case "loadDefaults":
					return Defaults.load({});
				case "generatePeriods":
					return Periods.generate(body.year, body.paygroup);
				case "closePeriod":
					return Periods.close(body.id) || { ok: true };
				case "reopenPeriod":
					return Periods.reopen(body.id) || { ok: true };
				case "lockAttendance":
				case "unlockAttendance":
				case "buildAttendance": {
					// Kỳ lớn chạy nền (Map/Reduce theo lô 50 nhân viên)
					const op = { lockAttendance: "lock", unlockAttendance: "unlock", buildAttendance: "build" }[a];
					const size = op === "unlock" ? Attendance.unlockSize(body.id) : Attendance.sizeOf(body.id);
					if (body.background || size > Attendance.SYNC_LIMIT) return Attendance.queue(body.id, op);
					return Attendance[op](body.id) || { ok: true };
				}
				case "saveDoc":
					return Attendance.save(body.type, body.values || {});
				case "docAction":
					return Attendance.act(body.type, body.id, body.op, { rejectReason: body.rejectReason || "" });
				case "accrueLeave":
					if (body.background) return Attendance.queue(null, "accrue", { year: Number(body.year), policyCode: body.policy || null, runDate: body.runDate, subsidiary: body.subsidiary || null });
					return Attendance.accrue(Number(body.year), body.policy || null, body.runDate, body.subsidiary || null);
				case "expireLeave":
					return Attendance.expire(Number(body.year), body.runDate);
				case "adjustLeave":
					return Attendance.adjust(body.employee, body.leaveType, Number(body.year), Number(body.qty), body.reason || "");
				case "saveProfile":
					return Profiles.save(body);
				case "saveSetup":
					return Profiles.saveSetup(body.values || {});
				case "saveCompany":
					return Profiles.saveCompany(body.subsidiary, body.values || {});
				case "setInsuranceAccount":
					return Profiles.setInsuranceAccount(body.code, body.account, body.vendor);
				case "generateTestData":
					return TestData.generate(body.subsidiary);
				case "createAdvance":
					return { id: Advances.create(body) };
				case "removeHoldAdvance":
					return Advances.removeHold(body.id) || { ok: true };
				case "releaseAdvance":
					return Advances.release(body.id);
				case "loadIndustryPack":
					return Defaults.loadIndustryPack(body.code, body.subsidiary);
				case "saveOutput":
					return Output.save(body.values || {}, body.lines, body.members);
				case "outputAction":
					return Output.act(body.id, body.op);
				case "loadTeamMembers":
					return Output.loadTeamMembers(body.id);
				case "splitOutput":
					return Output.splitAmount(body.id);
				case "saveRateLine":
					return { id: Store.create("rate_line", body.values || {}) };
				case "saveTeam": {
					const id = body.id ? (Store.update("team", body.id, body.values || {}), body.id) : Store.create("team", body.values || {});
					for (const m of body.members || []) Store.create("team_member", Object.assign({ team: id }, m));
					return { id };
				}
				case "saveWorkPermit":
					return WorkPermits.save(body.values || {});
				case "workPermitAction": {
					const op = body.op;
					if (op === "submit") return WorkPermits.submit(body.id);
					if (op === "issue") return WorkPermits.markIssued(body.id, { permitNo: body.permitNo, issued: body.issued });
					if (op === "revoke") return WorkPermits.revoke(body.id);
					if (op === "extend") return WorkPermits.createExtension(body.id);
					return { error: `Unknown op ${op}`, errorVi: `Thao tác không hợp lệ ${op}` };
				}
				case "updateExpiredPermits":
					return WorkPermits.updateExpired();
				case "newAllocVersion":
					return AllocationPlans.newVersion(body.employee, body.reason);
				case "saveAllocLines":
					return AllocationPlans.saveLines(body.id, body.lines || [], body.reason);
				case "activateAllocVersion":
					return AllocationPlans.activate(body.id, body.effective);
				case "deleteAllocVersion":
					return AllocationPlans.removeDraft(body.id);
				case "clearJob":
					return Payroll.clearJob(body.id) || { ok: true };
				case "saveShift": {
					const v = body.values || {};
					if (!/^\d{1,2}:\d{2}$/.test(String(v.start_time || "")) || !/^\d{1,2}:\d{2}$/.test(String(v.end_time || ""))) return { error: "Times must be HH:mm", errorVi: "Giờ vào, giờ ra dạng HH:mm" };
					return { id: body.id ? (Store.update("shift", body.id, v), body.id) : Store.create("shift", v) };
				}
				case "savePattern":
					return { id: body.id ? (Store.update("shift_pattern", body.id, body.values || {}), body.id) : Store.create("shift_pattern", body.values || {}) };
				case "generateRoster":
					return Shifts.generateRoster(body);
				case "setRosterCell":
					return Shifts.setRosterCell(body.employee, body.workDate, body.shift, body.location, body.workCenter);
				case "importPunches":
					return Shifts.importPunches(body.rows || [], body.source || "I");
				case "processPunches":
					return Shifts.processPunches(body.id);
				case "loadSheetEmployees":
					return Shifts.loadSheetEmployees(body.id);
				case "saveSheet":
					return Shifts.saveSheet(body.period, body.employee, body.cells || []);
				case "createBatch":
					return { id: Payroll.create(body) };
				case "saveInput":
					return Payroll.saveInput(body.values || {});
				case "deleteInput":
					return Payroll.deleteInput(body.id);
				case "updateLine":
					return Payroll.updateLine(body.id, body.values || {});
				case "removeLine":
					return Payroll.removeLine(body.id);
				case "loadEmployees":
					return Payroll.loadEmployees(body.id);
				case "calculate":
					return calculate(body.id, !!body.background);
				case "jobStatus": {
					const s = task.checkStatus({ taskId: body.job });
					return { status: s.status, stage: s.stage };
				}
				case "removeHold":
				case "hold":
				case "approve":
				case "reject":
				case "reopen":
					return Payroll[a](body.id) || { ok: true };
				case "release":
					return Payroll.release(body.id);
				case "reverse":
					return Payroll.reverse(body.id);
				case "agencyBills":
					return Payroll.agencyBills(body.id);
				default:
					return { error: `Unknown action ${a}`, errorVi: `Thao tác không hợp lệ ${a}` };
			}
		});
	}

	return { get, post };
});
