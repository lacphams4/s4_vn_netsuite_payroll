/**
 * Lớp điều phối của API gói lương: nhận action, kiểm tra quyền theo role, gọi nghiệp vụ, ghi nhật ký thao tác.
 * Dùng chung cho hai cửa vào:
 *   - RESTlet scripts/s4vp_rl_api.js (màn hình SPA, tích hợp hệ thống ngoài qua OAuth 2.0)
 *   - Bộ công cụ AI scripts/s4vp_ct_payroll.js (NetSuite AI Connector Service - MCP), qua api/AiTools.js
 * Nhờ đó thao tác qua trợ lý AI chịu đúng ma trận quyền, kiểm tra trạng thái và nhật ký như thao tác trên màn hình.
 *
 * LƯU Ý: action GET của switch cũ (bootstrap, batches, batch...) không tự kiểm tra role - RESTlet dựa vào danh sách role của
 * deployment. Cửa vào không có deployment (bộ công cụ AI) phải tự gọi roleIn("payroll") trước khi gọi get / post.
 *
 * Không nạp N/https, N/http, N/sftp (Custom Tool không cho phép).
 *
 * GET  ?action=bootstrap | batches&subsidiary=&period= | batch&id= | journal&id= | timesheet&id=&employee= | bankfile&id=
 * POST {action: loadDefaults | generatePeriods | createBatch | loadEmployees | syncTime | saveTime | calculate | removeHold | hold | approve |
 *       reject | reopen | release | reverse | agencyBills | closePeriod | reopenPeriod | lockAttendance | unlockAttendance, ...}
 * Lỗi trả {s4vpError, s4vpErrorVi}; số tiền lương không ghi vào log.
 *
 * Giao diện bản 2 (docs/UI_V2.md mục 5): action không có trong hai switch bên dưới được tra trong các mô-đun route đã đăng ký
 * (ROUTE_MODULES); mỗi mô-đun xuất routes: { get: { tên: { roles, run(params) } }, post: { tên: { roles, run(body) } } }.
 * roles: "all" | "payroll" (administrator, HR, kế toán), "hr" (administrator + HR), "acct" (administrator + kế toán), "admin".
 * Vai trò trình diễn customrole_s4vp_demo có trong mọi nhóm trừ "admin"; bootstrap trả isAccountant = true, fullAccess = true.
 * Sau mỗi POST thành công (action cũ lẫn mới) gọi AuditLog.record({action, batch, period, id, lineId, result}); ghi nhật ký lỗi
 * không làm hỏng thao tác.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "N/task", "N/cache", "./Store", "./Settings", "./Defaults", "./Periods", "./Payroll", "./Profiles", "./Advances", "./TestData", "./Reports", "./Attendance", "./Output", "./WorkPermits", "./AllocationPlans", "./Shifts", "./Home", "./PayrollRun", "./Checks", "./AuditLog", "./AttendanceMonth", "./LaborAnalytics", "./HrCore", "./ReportsHub", "./AdvancesV2", "./SetupHub", "./OutputsV2", "./Approvals", "./CommissionV2", "./OutputSources", "./PunchImport", "./RosterView", "./Access"], (runtime, log, task, cache, Store, Settings, Defaults, Periods, Payroll, Profiles, Advances, TestData, Reports, Attendance, Output, WorkPermits, AllocationPlans, Shifts, Home, PayrollRun, Checks, AuditLog, AttendanceMonth, LaborAnalytics, HrCore, ReportsHub, AdvancesV2, SetupHub, OutputsV2, Approvals, CommissionV2, OutputSources, PunchImport, RosterView, Access) => {
	// Bảng lương lớn hơn ngưỡng này tính bằng Map/Reduce
	const SYNC_LIMIT = 120;
	// Ma trận quyền 1.4.1, kiểm tra phía máy chủ (POST mặc định từ chối). Administrator làm mọi thao tác.
	// HR: thiết lập, hồ sơ, chứng từ công, bảng lương (không ghi sổ, không đảo, không lập bill, không ghi sổ tạm ứng).
	// Kế toán: bảng lương và tạm ứng đầy đủ; thiết lập, hồ sơ chỉ xem; không làm chứng từ công.
	const BATCH_ACTIONS = ["createBatch", "loadEmployees", "calculate", "jobStatus", "removeHold", "hold", "approve", "reject", "reopen", "saveInput", "deleteInput", "updateLine", "removeLine", "createAdvance", "removeHoldAdvance", "syncTime", "saveTime"];
	const ACCOUNTANT_ONLY = ["release", "reverse", "agencyBills", "releaseAdvance"];
	const HR_ACTIONS = BATCH_ACTIONS.concat([
		"loadDefaults", "loadIndustryPack", "generatePeriods", "closePeriod", "reopenPeriod", "lockAttendance", "unlockAttendance", "buildAttendance",
		"saveProfile", "revealIds", "saveSetup", "saveCompany", "setInsuranceAccount", "saveDoc", "docAction", "accrueLeave", "expireLeave", "adjustLeave",
		"saveOutput", "outputAction", "voidOutput", "loadTeamMembers", "splitOutput", "saveRateLine", "saveTeam", "saveWorkPermit", "workPermitAction", "updateExpiredPermits",
		"newAllocVersion", "saveAllocLines", "activateAllocVersion", "deleteAllocVersion",
		"saveShift", "savePattern", "generateRoster", "setRosterCell", "importPunches", "processPunches", "loadSheetEmployees", "saveSheet",
	]);
	const ACCOUNTANT_ACTIONS = BATCH_ACTIONS.concat(ACCOUNTANT_ONLY);
	const ADMIN_ONLY = ["generateTestData", "generateTestTime", "generateTestBulk", "clearJob"];

	// Vai trò trình diễn (customrole_s4vp_demo, quay video): mọi thao tác của HR lẫn kế toán như administrator, trừ thao tác bảo
	// trì ADMIN_ONLY (sinh dữ liệu test, gỡ cờ job treo) - các thao tác này không thuộc kịch bản trình diễn
	const ROLE_DEMO = "customrole_s4vp_demo";
	// HR vận hành (công, phép, đơn từ, ca, máy chấm công): KHÔNG thấy số tiền lương. Chỉ được các thao tác và lượt đọc dưới đây;
	// mọi action khác (bảng lương, tạm ứng, sản lượng, hoa hồng, báo cáo, thiết lập) bị từ chối ở máy chủ.
	const ROLE_OPS = Access.ROLES.OPS;
	const OPS_ACTIONS = [
		"lockAttendance", "unlockAttendance", "buildAttendance", "saveDoc", "docAction", "accrueLeave", "expireLeave", "adjustLeave",
		"saveShift", "savePattern", "generateRoster", "setRosterCell", "importPunches", "processPunches", "loadSheetEmployees", "saveSheet",
		"saveWorkPermit", "workPermitAction", "updateExpiredPermits", "jobStatus",
	];
	const OPS_GET = ["bootstrap", "docs", "leaveBalances", "attendance", "workPermits", "shifts", "roster", "attSheet", "profiles"];
	// Route của giao diện bản 2 mà HR vận hành được dùng dù nhóm quyền của route là "payroll" hoặc "hr"
	const OPS_ROUTES = ["punchSourcesView", "punchMappings", "punchPreview", "punchCommit", "punchMapSave", "rosterView", "rosterCells", "rosterReset", "rosterAssignSave", "rosterAssignBatch"];

	// Route nhóm "all" có số tiền lương: HR vận hành không được dùng
	const OPS_DENY_ROUTES = ["homeSummary"];

	function deny() {
		const e = new Error("Your role is not allowed to perform this action");
		e.userMessage = { en: "Your role is not allowed to perform this action", vi: "Vai trò của bạn không được thực hiện thao tác này" };
		return e;
	}

	// ---------------------------------------------------------------- phạm vi và cổng vào chung (api/Access)
	const scopeCache = () => cache.getCache({ name: "s4vp_scope", scope: cache.Scope.PROTECTED });

	/** Vai trò nhân bản khai ở Thiết lập chung -> vai trò chuẩn. Chưa có thiết lập thì bảng rỗng. */
	function loadAliases() {
		const out = {};
		const setup = Store.find("setup")[0];
		if (!setup) return out;
		Access.parseAliases(setup.role_alias_hr, Access.ROLES.HR, out);
		Access.parseAliases(setup.role_alias_acct, Access.ROLES.ACCT, out);
		Access.parseAliases(setup.role_alias_ops, Access.ROLES.OPS, out);
		return out;
	}

	/**
	 * Công ty con mà vai trò NetSuite của người dùng được phép: truy vấn bảng subsidiary bằng chính vai trò đó (NetSuite tự áp
	 * giới hạn công ty con của vai trò). Số công ty con toàn account do lượt gọi của Administrator ghi vào cache; khi người dùng
	 * thấy đủ số đó thì coi như không giới hạn (không ghép điều kiện lọc). Chưa có số đó thì vẫn lọc theo danh sách thấy được.
	 */
	function loadSubsidiaries() {
		const ids = Store.run("SELECT id FROM subsidiary WHERE isinactive = 'F'", [], "s4vp_scope_subs").map((r) => String(r.id));
		let total = null;
		try {
			const raw = scopeCache().get({ key: "total" });
			total = raw === null || raw === undefined || raw === "" ? null : Number(raw);
		} catch (e) {
			total = null;
		}
		return total !== null && ids.length >= total ? null : ids;
	}

	function rememberSubsidiaryTotal() {
		if (Access.realRole() !== "administrator") return;
		try {
			const n = Store.run("SELECT COUNT(*) AS n FROM subsidiary WHERE isinactive = 'F'", [], "s4vp_scope_total")[0];
			scopeCache().put({ key: "total", value: String(Number((n && n.n) || 0)) });
		} catch (e) {
			// không ghi được cache: người dùng bị giới hạn vẫn được lọc đúng, chỉ chậm hơn
		}
	}

	/**
	 * Cổng chung cho mọi yêu cầu GET / POST: cấu hình Access, từ chối vai trò ngoài gói, chặn công ty con ngoài phạm vi (tham số
	 * subsidiary ở params / body / body.values), và giới hạn lượt đọc của HR vận hành. Record đọc qua Store còn được lọc theo
	 * phạm vi ở Store.find.
	 */
	function enter(method, action, input) {
		Access.configure({ aliases: loadAliases, subsidiaries: loadSubsidiaries });
		if (!Access.isMember()) {
			log.audit({ title: "s4vp_rl_api denied", details: `${Access.realRole()} ${action}` });
			throw deny();
		}
		const src = input || {};
		const vals = src.values && typeof src.values === "object" ? src.values : {};
		for (const holder of [src, vals]) {
			if (!Object.prototype.hasOwnProperty.call(holder, "subsidiary")) continue;
			const v = holder.subsidiary;
			if (v === null || v === undefined || v === "") {
				if (Access.restricted() && holder === src && method === "get") throw deny();
				continue;
			}
			Access.assertSubsidiary(v);
		}
		if (role() === ROLE_OPS && method === "get" && !OPS_GET.includes(action) && !OPS_ROUTES.includes(action)) {
			const route = findRoute("get", action);
			if (!route || route.roles !== "all" || OPS_DENY_ROUTES.includes(action)) throw deny();
		}
	}

	function allowed(action) {
		const r = role();
		if (r === "administrator") return true;
		if (ADMIN_ONLY.includes(action)) return false;
		if (r === ROLE_DEMO) return true;
		if (r === "customrole_s4vp_hr") return HR_ACTIONS.includes(action);
		if (r === ROLE_OPS) return OPS_ACTIONS.includes(action);
		if (r === "customrole_s4vp_accountant") return ACCOUNTANT_ACTIONS.includes(action);
		return false;
	}

	/** Vai trò hiệu lực (api/Access): vai trò chuẩn của gói, kể cả khi đăng nhập bằng vai trò nhân bản đã khai tương đương. */
	function role() {
		return Access.role();
	}

	function isHr() {
		return role() === "customrole_s4vp_hr";
	}

	// ---------------------------------------------------------------- mô-đun route của giao diện bản 2
	// Thứ tự đăng ký quyết định mô-đun nào thắng khi trùng tên action (không nên trùng); action cũ luôn được ưu tiên.
	// CommissionV2: hoa hồng (đọc "payroll", ghi "acct"); OutputSources: sản lượng từ giao dịch (outputSources, outputSourcePreview,
	// outputSourceGenerate - quyền khai trong mô-đun)
	// PunchImport: nạp file máy chấm công theo hồ sơ nguồn (punchSourcesView, punchMappings đọc "payroll"; punchPreview, punchCommit,
	// punchMapSave ghi "hr") - docs/PUNCH_IMPORT.md mục 3
	// RosterView: màn Xếp ca (rosterView đọc "payroll"; rosterCells ghi "hr"); sinh từ mẫu vẫn là action cũ generateRoster
	const ROUTE_MODULES = [Home, PayrollRun, Checks, AuditLog, AttendanceMonth, LaborAnalytics, HrCore, ReportsHub, AdvancesV2, SetupHub, OutputsV2, Approvals, CommissionV2, OutputSources, PunchImport, RosterView];
	const ROLE_SETS = {
		all: ["administrator", "customrole_s4vp_hr", "customrole_s4vp_accountant", ROLE_DEMO, ROLE_OPS],
		payroll: ["administrator", "customrole_s4vp_hr", "customrole_s4vp_accountant", ROLE_DEMO],
		hr: ["administrator", "customrole_s4vp_hr", ROLE_DEMO],
		acct: ["administrator", "customrole_s4vp_accountant", ROLE_DEMO],
		// Route "admin" (bảo trì) không mở cho vai trò trình diễn
		admin: ["administrator"],
	};
	// Action POST của switch cũ (đã có ma trận quyền riêng): không tra trong mô-đun route
	const LEGACY_POST = new Set(HR_ACTIONS.concat(ACCOUNTANT_ACTIONS, ADMIN_ONLY));

	/** Tìm route theo phương thức ("get" | "post") và tên action; null nếu không mô-đun nào khai. */
	function findRoute(method, action) {
		const name = String(action || "");
		if (!name) return null;
		for (const m of ROUTE_MODULES) {
			const table = m && m.routes && m.routes[method];
			if (table && Object.prototype.hasOwnProperty.call(table, name) && table[name] && typeof table[name].run === "function") return table[name];
		}
		return null;
	}

	/** Chạy route sau khi kiểm tra vai trò; roles thiếu hoặc lạ thì chỉ administrator được chạy. */
	function runRoute(route, action, input) {
		const roles = ROLE_SETS[route.roles] || ROLE_SETS.admin;
		if (!roles.includes(role()) && !(role() === ROLE_OPS && OPS_ROUTES.includes(String(action)))) {
			log.audit({ title: "s4vp_rl_api denied", details: `${role()} ${action}` });
			const e = new Error("Your role is not allowed to perform this action");
			e.userMessage = { en: "Your role is not allowed to perform this action", vi: "Vai trò của bạn không được thực hiện thao tác này" };
			throw e;
		}
		const out = route.run(input || {});
		return out === undefined || out === null ? { ok: true } : out;
	}

	// Action cũ nhận id bảng lương / id kỳ ở body.id: suy ra batch, period cho nhật ký
	const BATCH_ID_ACTIONS = ["bankFile", "printDoc", "loadEmployees", "syncTime", "calculate", "removeHold", "hold", "approve", "reject", "reopen", "release", "reverse", "agencyBills", "clearJob", "submitRun"];
	const PERIOD_ID_ACTIONS = ["closePeriod", "reopenPeriod", "lockAttendance", "unlockAttendance", "buildAttendance", "processPunches", "loadSheetEmployees"];
	// Thao tác trên phiếu sản lượng: body.id là id phiếu; kỳ của phiếu lấy từ kết quả (Output.act / voidEntry trả period)
	const OUTPUT_ACTIONS = ["outputAction", "voidOutput"];
	// Hoa hồng: body.run là id bảng tính hoa hồng (không phải bảng lương) - ghi vào id của nhật ký
	const COMMISSION_RUN_ACTIONS = ["commissionApprove", "commissionReopen", "commissionVoid"];

	/** Ghi nhật ký sau POST thành công; lỗi ở đây chỉ ghi log, không ảnh hưởng kết quả thao tác. */
	function audit(action, body, result) {
		try {
			if (!AuditLog || typeof AuditLog.record !== "function") return;
			const b = body || {};
			const values = b.values || {};
			let batch = b.batch || values.batch || null;
			let period = b.period || values.period || null;
			if (BATCH_ID_ACTIONS.includes(action)) batch = b.id || batch;
			else if (PERIOD_ID_ACTIONS.includes(action)) period = b.id || period;
			else if (action === "createBatch") batch = (result && result.id) || batch;
			else if (OUTPUT_ACTIONS.includes(action)) period = (result && result.period) || period;
			const employee = b.employee || values.employee || null;
			const id = COMMISSION_RUN_ACTIONS.includes(action) ? b.run || null : b.id || null;
			AuditLog.record({ action, batch: batch || null, period: period || null, id, lineId: b.lineId || null, employee, result });
		} catch (e) {
			log.error({ title: "s4vp_rl_api audit", details: String((e && e.message) || e).slice(0, 300) });
		}
	}

	function wrap(fn) {
		try {
			return fn();
		} catch (e) {
			log.error({ title: "s4vp_rl_api", details: String(e.message || e).slice(0, 500) });
			const m = e.userMessage;
			// Không dùng khóa "error": N/https phía trình duyệt coi đó là lỗi RESTlet, tự từ chối và bỏ mất nội dung
			return { s4vpError: m ? m.en : String(e.message || e), s4vpErrorVi: m ? m.vi : String(e.messageVi || e.message || e) };
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

	// Số chứng từ bút toán (tranid) thay cho id nội bộ trên lưới
	function withJournalNo(rows) {
		const tx = Payroll.transactionsInfo(rows.map((r) => r.journal).filter(Boolean));
		return rows.map((r) => Object.assign(r, { journalNo: r.journal ? (tx[String(r.journal)] || {}).tranid || "" : "" }));
	}

	function advancesView(rows) {
		const info = Payroll.employeesInfo(rows.map((r) => r.employee));
		return withJournalNo(rows).map((r) => Object.assign(r, { employeeCode: (info[r.employee] || {}).code || "", employeeName: (info[r.employee] || {}).name || "" }));
	}

	function bootstrap() {
		rememberSubsidiaryTotal();
		let subsidiaries = [];
		try {
			subsidiaries = Store.run("SELECT id, name, iselimination FROM subsidiary WHERE isinactive = 'F' ORDER BY name", [], "s4vp_subs").filter((s) => s.iselimination !== "T").map((s) => ({ id: String(s.id), name: s.name }));
		} catch (e) {
			subsidiaries = [];
		}
		const setup = Store.find("setup");
		let unverified = [];
		// Tên dễ đọc (diễn giải) trước, mã tham số và ngày hiệu lực dd/mm/yyyy sau
		if (setup.length) unverified = Store.find("param").filter((p) => p.verified === false).map((p) => `${p.description ? `${p.description} - ` : ""}${p.name} (${String(p.effective || "").split("-").reverse().join("/")})`);
		const companies = Store.find("company");
		const enabled = new Set(companies.filter((c) => c.enabled !== false).map((c) => c.subsidiary));
		const u = runtime.getCurrentUser();
		return {
			user: { id: u.id, name: u.name, role: role(), isHr: isHr(), isAccountant: role() === "customrole_s4vp_accountant" || role() === ROLE_DEMO, fullAccess: role() === "administrator" || role() === ROLE_DEMO, canPay: Access.canPay(), canIds: Access.canIds(), opsOnly: role() === ROLE_OPS, restricted: Access.restricted(), canEditSetup: allowed("saveSetup"), canAttendance: allowed("saveDoc"), lang: /^vi/i.test(String(u.getPreference({ name: "LANGUAGE" }) || "")) ? "vi" : "en" },
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

	// Bootstrap (công ty con, kỳ, nhóm lương, danh mục) ít đổi: nhớ theo người dùng trong N/cache. Mọi POST thành công đổi
	// "phiên bản" nên bản nhớ cũ bị bỏ; sửa bản ghi ngoài SPA (form chuẩn NetSuite) thì tối đa BOOT_TTL giây (5 phút) sau mới thấy,
	// hoặc ngay khi giao diện hỏi với fresh=1 (nút tải lại, sau thao tác thiết lập).
	const BOOT_TTL = 300; // N/cache không nhận ttl dưới 300 giây
	const bootCache = () => cache.getCache({ name: "s4vp_boot", scope: cache.Scope.PROTECTED });

	function bustBootstrap() {
		try {
			bootCache().remove({ key: "ver" });
		} catch (e) {
			// không có cache: bỏ qua
		}
	}

	function cachedBootstrap(fresh) {
		try {
			const c = bootCache();
			if (fresh) c.remove({ key: "ver" });
			const u = runtime.getCurrentUser();
			const ver = c.get({ key: "ver", loader: () => String(Date.now()), ttl: 3600 });
			const key = `b_${ver}_${u.id}_${u.role}_${String(u.getPreference({ name: "LANGUAGE" }) || "")}`;
			const hit = c.get({ key });
			if (hit) return JSON.parse(hit);
			const out = bootstrap();
			c.put({ key, value: JSON.stringify(out), ttl: BOOT_TTL });
			return out;
		} catch (e) {
			return bootstrap();
		}
	}

	/** GET: thêm ?timing=1 (chỉ administrator) để nhận kèm thời gian từng truy vấn - dùng khi đo hiệu năng. */
	function get(params) {
		const started = Date.now();
		const out = getAction(params);
		if (params && params.timing === "1" && role() === "administrator" && out && typeof out === "object" && !Array.isArray(out)) {
			out._timing = { ms: Date.now() - started, queries: Store.stats.slice() };
		}
		return out;
	}

	function getAction(params) {
		return wrap(() => {
			// Lượt đọc: gộp các truy vấn trùng (cùng câu lệnh, cùng tham số)
			if (typeof Store.memoize === "function") Store.memoize(true);
			enter("get", params && params.action, params);
			switch (params.action) {
				case "bootstrap":
					return cachedBootstrap(params.fresh === "1");
				case "batches":
					return { batches: withJournalNo(Payroll.list({ subsidiary: params.subsidiary, period: params.period })) };
				case "batch":
					return Payroll.detail(params.id);
				case "journal":
					return Payroll.journalPreview(params.id);
				case "timesheet":
					return Payroll.timesheet(params.id, params.employee);
				case "bankfile": {
					const out = Payroll.bankFile(params.id);
					// Xuất file chứa lương từng người: ghi nhật ký (không ghi số tiền)
					audit("bankFile", { id: params.id }, out);
					return out;
				}
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
					return { advances: advancesView(Advances.list({ subsidiary: params.subsidiary })) };
				case "profiles":
					return { employees: Profiles.list(params.subsidiary) };
				case "lookups":
					return { accounts: Profiles.accounts(), vendors: Profiles.vendors(params.subsidiary), setup: Settings.tenant(), company: Settings.company(params.subsidiary), components: Store.find("ins_comp") };
				default: {
					const route = findRoute("get", params.action);
					if (route) return runRoute(route, params.action, params);
					return { s4vpError: `Unknown action ${params.action}`, s4vpErrorVi: `Thao tác không hợp lệ ${params.action}` };
				}
			}
		});
	}

	function calculate(id, background) {
		// Chỉ cần số dòng: đọc id, không đọc cột detail của cả bảng lương
		const count = typeof Payroll.lineIds === "function" ? Payroll.lineIds(id).length : Payroll.lines(id).length;
		if (!background && count <= SYNC_LIMIT) return Payroll.calculate(id);
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
		const out = postAction(body);
		// Thành công = không có khóa lỗi (s4vpError của wrap, error của các nhánh từ chối cũ)
		if (out && !out.s4vpError && !out.error) {
			if (!body || body.action !== "jobStatus") bustBootstrap();
			audit(body && body.action, body, out);
		}
		return out;
	}

	function postAction(body) {
		return wrap(() => {
			const a = body && body.action;
			enter("post", a, body);
			// Action của giao diện bản 2: quyền theo roles của route, không theo ma trận action cũ
			if (!LEGACY_POST.has(a)) {
				const route = findRoute("post", a);
				if (route) return runRoute(route, a, body);
			}
			if (!allowed(a)) {
				log.audit({ title: "s4vp_rl_api denied", details: `${role()} ${a}` });
				return { s4vpError: "Your role is not allowed to perform this action", s4vpErrorVi: "Vai trò của bạn không được thực hiện thao tác này" };
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
					// Chỉ số dư của nhân viên thuộc công ty con đang chọn (không truyền thì mọi công ty, như trước)
					return Attendance.expire(Number(body.year), body.runDate, body.subsidiary || null);
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
				case "generateTestTime":
					return TestData.timeEntries(body.subsidiary, body.from, body.to);
				case "generateTestBulk":
					return TestData.bulk(body.subsidiary, body.from, body.to);
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
					// op reject bắt buộc lý do (body.reason hoặc body.reject_reason)
					return Output.act(body.id, body.op, { reason: body.reason !== undefined ? body.reason : body.reject_reason });
				case "voidOutput":
					return Output.voidEntry(body.id, body.reason);
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
					return { s4vpError: `Unknown op ${op}`, s4vpErrorVi: `Thao tác không hợp lệ ${op}` };
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
					if (!/^\d{1,2}:\d{2}$/.test(String(v.start_time || "")) || !/^\d{1,2}:\d{2}$/.test(String(v.end_time || ""))) return { s4vpError: "Times must be HH:mm", s4vpErrorVi: "Giờ vào, giờ ra dạng HH:mm" };
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
					// Kỳ vượt ngưỡng (api/Shifts: 200 nhân viên hoặc 3.000 nhân viên x ngày) chạy nền Map/Reduce op punches; mỗi kỳ một tác vụ nền
					return Attendance.runPunches(body.id, !!body.background);
				case "loadSheetEmployees":
					return Shifts.loadSheetEmployees(body.id);
				case "saveSheet":
					return Shifts.saveSheet(body.period, body.employee, body.cells || []);
				case "createBatch":
					return { id: Payroll.create(body) };
				case "revealIds":
					return Profiles.revealIds(body.employee);
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
				case "syncTime":
					return Payroll.syncTime(body.id);
				case "saveTime":
					return Payroll.saveTime(body.lineId, body.values || {});
				case "calculate":
					return calculate(body.id, !!body.background);
				case "jobStatus": {
					// Chấm công: tác vụ nền theo kỳ (lập / khóa / mở khóa / xử lý chấm công máy), kèm kết quả khi xong
					if (body.period) return Attendance.jobState(body.period, body.job || null);
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
					return { s4vpError: `Unknown action ${a}`, s4vpErrorVi: `Thao tác không hợp lệ ${a}` };
			}
		});
	}

	/** Vai trò hiện tại có thuộc nhóm quyền ("all" | "payroll" | "hr" | "acct" | "admin") không. */
	function roleIn(set) {
		return (ROLE_SETS[set] || ROLE_SETS.admin).includes(role());
	}

	return { get, post, role, roleIn };
});
