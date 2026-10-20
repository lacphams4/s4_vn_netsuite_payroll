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
define(["N/runtime", "N/log", "N/task", "../api/Store", "../api/Settings", "../api/Defaults", "../api/Periods", "../api/Payroll", "../api/Profiles", "../api/Advances", "../api/TestData", "../api/Reports"], (runtime, log, task, Store, Settings, Defaults, Periods, Payroll, Profiles, Advances, TestData, Reports) => {
	// Bảng lương lớn hơn ngưỡng này tính bằng Map/Reduce
	const SYNC_LIMIT = 120;
	const ACCOUNTANT_ONLY = ["release", "reverse", "agencyBills"];

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
			user: { id: u.id, name: u.name, role: role(), isHr: isHr(), lang: /^vi/i.test(String(u.getPreference({ name: "LANGUAGE" }) || "")) ? "vi" : "en" },
			setupReady: setup.length > 0,
			subsidiaries: subsidiaries.map((s) => Object.assign(s, { enabled: !companies.length || enabled.has(s.id) })),
			paygroups: Store.find("paygroup").map((g) => ({ id: g.id, code: g.name, description: g.description, frequency: g.frequency, subsidiary: g.subsidiary })),
			periods: Periods.list().map((p) => ({ id: p.id, code: p.name, paygroup: p.paygroup, start: p.start, end: p.end, status: p.status, attStatus: p.att_status, taxMonth: p.tax_month, stdDays: p.std_days, last: p.last_in_month })),
			unverified,
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

	function calculate(id) {
		const lines = Payroll.lines(id);
		if (lines.length <= SYNC_LIMIT) return Payroll.calculate(id);
		const t = task.create({ taskType: task.TaskType.MAP_REDUCE, scriptId: "customscript_s4vp_mr_calculate", deploymentId: "customdeploy_s4vp_mr_calculate", params: { custscript_s4vp_mr_batch: id } });
		const jobId = t.submit();
		Store.submit("batch", id, { job: jobId });
		return { queued: true, job: jobId };
	}

	function post(body) {
		return wrap(() => {
			const a = body && body.action;
			if (ACCOUNTANT_ONLY.includes(a) && isHr()) return { error: "Payroll HR cannot perform this action", errorVi: "HR không có quyền thực hiện thao tác này (chỉ kế toán)" };
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
					return Periods.lockAttendance(body.id) || { ok: true };
				case "unlockAttendance":
					return Periods.unlockAttendance(body.id) || { ok: true };
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
					if (isHr()) return { error: "Payroll HR cannot release advances", errorVi: "HR không có quyền ghi sổ tạm ứng" };
					return Advances.release(body.id);
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
					return calculate(body.id);
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
