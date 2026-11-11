/**
 * Hoa hồng nhân viên kinh doanh (giao diện bản 2). Mô-đun route (docs/UI_V2.md mục 5, docs/COMMISSION.md mục 6):
 *   GET  commissionView     {subsidiary, month?}               bảng tính của tháng + lưới kết quả + thẻ số liệu + các tháng đã tính
 *   GET  commissionResult   {id}                               một kết quả đầy đủ + diễn giải, credit, phân đoạn, điều chỉnh của tháng
 *   GET  commissionSetup    {subsidiary}                       kế hoạch (thành phần, bậc, phân công, chỉ tiêu) + danh mục
 *   GET  commissionSimulate {plan, base, qty, quota}           mô phỏng
 *   GET  commissionExternal {subsidiary, month?}               doanh số ngoài (comm_txn) của tháng
 *   POST commissionCalculate {subsidiary, month, from?, to?} | commissionApprove {run} | commissionReopen {run} |
 *        commissionVoid {run, reason} | commissionPlanSave {plan, rules, tiers, assignments, quotas} |
 *        commissionAdjust {employee, plan?, month, amount, reason} | commissionImport {subsidiary, sourceSystem, rows, dryRun}
 * Đọc: administrator, HR, kế toán ("payroll"); ghi: administrator + kế toán ("acct"). Nghiệp vụ ở api/Commission.js.
 *
 * Số truy vấn của commissionView cố định: bảng tính của công ty con (gồm danh sách tháng), kết quả của bảng tính (JOIN nhân
 * viên, phòng ban, kế hoạch; detail chỉ đọc 40 ký tự đầu để lấy số cảnh báo). Mọi kết quả trả về đi qua safe(): không có khóa
 * tên "error" ở bất kỳ cấp nào (N/https phía trình duyệt từ chối cả phản hồi).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Lean", "./Settings", "./Clock", "./Commission", "../core/Dates"], (Store, Lean, Settings, Clock, Commission, Dates) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const num = (v) => (blank(v) ? 0 : Number(v) || 0);
	const isId = (v) => /^\d+$/.test(String(blank(v) ? "" : v));
	const person = (code, first, last) => [last, first].filter(Boolean).join(" ").trim() || code || "";

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	/** Chạy fn, lỗi (vai trò không đọc được bảng) thì trả giá trị dự phòng: màn hình vẫn mở được. */
	function attempt(fn, fallback) {
		try {
			return fn();
		} catch (e) {
			return fallback;
		}
	}

	/** Bản sao sâu không còn khóa tên "error" (đổi thành "issue"). */
	function safe(x) {
		if (Array.isArray(x)) return x.map(safe);
		if (!x || typeof x !== "object") return x;
		const o = {};
		for (const k of Object.keys(x)) o[k === "error" ? "issue" : k] = safe(x[k]);
		return o;
	}

	function subOf(params) {
		const s = String((params && params.subsidiary) || "");
		if (!isId(s)) throw fail("Select a subsidiary", "Chưa chọn công ty con");
		return s;
	}

	const runView = (r) =>
		r
			? {
				id: String(r.id), name: r.name || "", status: r.status || "D", month: num(r.month), from: r.date_from || null, to: r.date_to || null,
				totalBase: num(r.total_base), totalAmount: num(r.total_amount), employees: num(r.employees), batch: r.batch || null,
				calcAt: r.calc_at || "", calculated: !blank(r.calc_at), approvedBy: r.approved_by || null, note: r.note || "",
			}
			: null;

	// ------------------------------------------------------------------ commissionView

	const RESULT_KEYS = ["employee", "plan", "earning_type", "quota", "base", "window_base", "attainment", "gross", "prior_paid", "earned", "override_amount", "adjustments", "capped", "draw_paid", "draw_recovered", "draw_balance", "payable"];

	/** Kết quả đang hoạt động của bảng tính, kèm mã, tên, phòng ban nhân viên và mã kế hoạch (một truy vấn). */
	function resultRows(runId) {
		const plan = Lean.rec("comm_plan").type;
		const emp = Lean.col("comm_result", "employee");
		const head = `SUBSTR(${Lean.col("comm_result", "detail")}, 1, 40) AS d_head`;
		const base = { where: `{run} = ${runId}`, raw: ["e_code", "e_first", "e_last", "e_dept", "d_name", "p_name", "d_head"] };
		const extra = ["e.entityid AS e_code", "e.firstname AS e_first", "e.lastname AS e_last", "e.department AS e_dept", "p.name AS p_name", head];
		const join = `LEFT JOIN employee e ON e.id = ${emp} LEFT JOIN ${plan} p ON p.id = ${Lean.col("comm_result", "plan")}`;
		try {
			return Lean.select("comm_result", RESULT_KEYS, Object.assign({}, base, { join: `${join} LEFT JOIN department d ON d.id = e.department`, extra: extra.concat(["d.fullname AS d_name"]), tag: "s4vp_cm_view_rows" }));
		} catch (e) {
			return Lean.select("comm_result", RESULT_KEYS, Object.assign({}, base, { join, extra: extra.concat(["BUILTIN.DF(e.department) AS d_name"]), tag: "s4vp_cm_view_rows_df" }));
		}
	}

	/**
	 * Màn Bảng tính: bảng tính đang hoạt động của tháng (null nếu chưa tính), lưới kết quả, thẻ số liệu, các tháng đã có bảng
	 * tính (mới nhất trước). Không truyền month: tháng mới nhất đã có bảng tính, chưa có thì tháng hiện tại.
	 */
	function commissionView(params) {
		const sub = subOf(params);
		const runs = Store.find("comm_run", { where: "{subsidiary} = ?", params: [sub], order: "{month} DESC" });
		const months = [...new Set(runs.map((r) => num(r.month)).filter(Boolean))].sort((a, b) => b - a);
		const month = !blank(params && params.month) ? Commission.periodOf(params.month).month : months[0] || Number(Dates.yyyymm(Clock.today()));
		const period = Commission.periodOf(month);
		const run = runs.filter((r) => num(r.month) === month).sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
		const rows = run
			? resultRows(run.id).map((r) => {
				const m = /"warningCount":(\d+)/.exec(String(r.d_head || ""));
				return {
					resultId: r.id, employee: r.employee || null, code: r.e_code || "", name: person(r.e_code, r.e_first, r.e_last), department: r.d_name || "", departmentId: blank(r.e_dept) ? null : String(r.e_dept),
					plan: r.plan || null, planName: r.p_name || "", earningType: r.earning_type || "", quota: num(r.quota), base: num(r.base), windowBase: num(r.window_base),
					attainment: blank(r.attainment) ? null : num(r.attainment), gross: num(r.gross), priorPaid: num(r.prior_paid), earned: num(r.earned), override: num(r.override_amount),
					adjustments: num(r.adjustments), capped: num(r.capped), drawPaid: num(r.draw_paid), drawRecovered: num(r.draw_recovered), drawBalance: num(r.draw_balance), payable: num(r.payable),
					warnings: m ? Number(m[1]) : 0,
				};
			})
			: [];
		rows.sort((a, b) => a.code.localeCompare(b.code) || a.planName.localeCompare(b.planName));
		const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
		const kpis = {
			status: run ? run.status || "D" : null, results: rows.length, employees: new Set(rows.map((r) => r.employee)).size, plans: new Set(rows.map((r) => r.plan)).size,
			base: sum("base"), earned: sum("earned"), override: sum("override"), adjustments: sum("adjustments"), capped: sum("capped"), drawPaid: sum("drawPaid"), payable: sum("payable"),
			warnings: rows.filter((r) => r.warnings > 0).length,
		};
		return safe({ subsidiary: sub, month, from: run ? run.date_from || period.from : period.from, to: run ? run.date_to || period.to : period.to, run: runView(run), rows, kpis, months });
	}

	// ------------------------------------------------------------------ commissionResult

	function parse(text) {
		if (blank(text)) return {};
		try {
			return JSON.parse(text) || {};
		} catch (e) {
			return {};
		}
	}

	/** Một kết quả đầy đủ: số liệu, diễn giải, credit (có số chứng từ, ngày, khách, mặt hàng, nguồn), phân đoạn, điều chỉnh tháng. */
	function commissionResult(params) {
		const id = String((params && params.id) || "");
		if (!isId(id)) throw fail("Commission result not found", "Không tìm thấy kết quả hoa hồng");
		const r = Store.get("comm_result", id);
		if (!r) throw fail("Commission result not found", "Không tìm thấy kết quả hoa hồng");
		const run = blank(r.run) ? null : Store.get("comm_run", r.run);
		const plan = blank(r.plan) ? null : Store.get("comm_plan", r.plan);
		const who = Commission.employeeNames([r.employee])[String(r.employee)] || { code: "", name: "", department: null };
		const d = parse(r.detail);
		const adjustments = run
			? Store.find("comm_adjust", { where: "{employee} = ? AND {month} = ?", params: [r.employee, run.month] })
				.filter((a) => blank(a.plan) || String(a.plan) === String(r.plan))
				.map((a) => ({ id: a.id, plan: a.plan || null, planName: blank(a.plan) ? "" : plan ? plan.name || "" : "", month: num(a.month), amount: num(a.amount), reason: a.reason || "" }))
			: [];
		return safe({
			id: r.id, isInactive: !!r.isInactive, run: runView(run), employee: r.employee || null, code: who.code, name: who.name, departmentId: who.department,
			plan: r.plan || null, planName: plan ? plan.name || "" : "", planDescription: plan ? plan.description || "" : "", basis: plan ? plan.basis || "R" : "R", window: plan ? plan.window || "M" : "M", trigger: plan ? plan.trigger || "I" : "I",
			earningType: r.earning_type || "", quota: num(r.quota), base: num(r.base), windowBase: num(r.window_base), attainment: blank(r.attainment) ? null : num(r.attainment),
			gross: num(r.gross), priorPaid: num(r.prior_paid), earned: num(r.earned), override: num(r.override_amount), adjustments: num(r.adjustments), capped: num(r.capped),
			drawPaid: num(r.draw_paid), drawRecovered: num(r.draw_recovered), drawBalance: num(r.draw_balance), payable: num(r.payable),
			detail: {
				components: d.components || [], steps: d.steps || [], credits: d.credits || [], creditsTotal: num(d.creditsTotal), shares: d.shares || [], overrides: d.overrides || [],
				warnings: d.warnings || [], qty: d.qty === undefined ? null : d.qty, windowQty: d.windowQty === undefined ? null : d.windowQty, window: d.window || null,
			},
			adjustmentList: adjustments,
		});
	}

	// ------------------------------------------------------------------ commissionSetup

	/** Class, phòng ban, địa điểm, nhóm khách đang dùng: một truy vấn UNION; lỗi thì từng bảng riêng (bảng không đọc được = rỗng). */
	function segments() {
		const parts = {
			C: "SELECT 'C' AS k, x.id AS id, x.fullname AS name FROM classification x WHERE x.isinactive = 'F'",
			D: "SELECT 'D' AS k, x.id AS id, x.fullname AS name FROM department x WHERE x.isinactive = 'F'",
			L: "SELECT 'L' AS k, x.id AS id, x.fullname AS name FROM location x WHERE x.isinactive = 'F'",
			G: "SELECT 'G' AS k, x.id AS id, x.name AS name FROM customercategory x WHERE x.isinactive = 'F'",
		};
		let rows;
		try {
			rows = Store.run(Object.values(parts).join(" UNION ALL "), [], "s4vp_cm_segments");
		} catch (e) {
			rows = [].concat(...Object.keys(parts).map((k) => attempt(() => Store.run(parts[k], [], `s4vp_cm_segments_${k}`), [])));
		}
		const out = { C: [], D: [], L: [], G: [] };
		for (const r of rows) if (out[r.k]) out[r.k].push({ id: String(r.id), name: r.name || "" });
		for (const k of Object.keys(out)) out[k].sort((a, b) => a.name.localeCompare(b.name));
		return { classes: out.C, departments: out.D, locations: out.L, customerCategories: out.G };
	}

	/** Nhân viên kinh doanh (issalesrep) của công ty con + mọi người đang có trong phân công / làm quản lý của kế hoạch. */
	function salesPeople(sub, ids) {
		const list = Commission.idList(ids);
		const rows = attempt(
			() => Store.run(
				`SELECT e.id AS id, e.entityid AS code, e.firstname AS first, e.lastname AS last, e.department AS department, e.issalesrep AS rep, e.isinactive AS inactive FROM employee e ` +
				`WHERE (e.isinactive = 'F' AND e.issalesrep = 'T' AND e.subsidiary = ${sub})` + (list.length ? ` OR e.id IN (${list.slice(0, 900).join(",")})` : "") + " ORDER BY e.entityid",
				[], "s4vp_cm_setup_emps"
			),
			[]
		);
		return rows.map((e) => ({ id: String(e.id), code: e.code || "", name: person(e.code, e.first, e.last), department: blank(e.department) ? null : String(e.department), salesRep: e.rep === "T" || e.rep === true, inactive: e.inactive === "T" || e.inactive === true }));
	}

	const planOut = (p) => {
		const o = Object.assign({}, p);
		delete o.window_from;
		return o;
	};

	/** Màn Kế hoạch: kế hoạch dùng được cho công ty con (kèm thành phần + bậc, phân công, chỉ tiêu tháng) và danh mục chọn. */
	function commissionSetup(params) {
		const sub = subOf(params);
		const plans = Commission.plansFor(sub, { includeInactive: params && (params.includeInactive === "1" || params.includeInactive === true) }).map(planOut);
		const ids = [];
		for (const p of plans) for (const a of p.assignments) ids.push(a.employee, a.manager);
		for (const p of plans) for (const q of p.quotas) ids.push(q.employee);
		const earningTypes = attempt(() => Settings.earningTypes().list.filter((e) => e.isActive).map((e) => ({ id: e.id, code: e.code, name: e.description || "" })), []);
		return safe({ subsidiary: sub, plans, earningTypes, lookups: Object.assign(segments(), { employees: salesPeople(sub, ids) }) });
	}

	// ------------------------------------------------------------------ còn lại

	const routes = {
		get: {
			commissionView: { roles: "payroll", run: commissionView },
			commissionResult: { roles: "payroll", run: commissionResult },
			commissionSetup: { roles: "payroll", run: commissionSetup },
			commissionSimulate: { roles: "payroll", run: (p) => safe(Commission.simulate(p)) },
			commissionExternal: { roles: "payroll", run: (p) => safe(Commission.externalList(p)) },
		},
		post: {
			commissionCalculate: { roles: "acct", run: (b) => safe(Commission.calculate(b.subsidiary, b.month, b.from, b.to)) },
			commissionApprove: { roles: "acct", run: (b) => safe(Commission.approve(b.run)) },
			commissionReopen: { roles: "acct", run: (b) => safe(Commission.reopen(b.run)) },
			commissionVoid: { roles: "acct", run: (b) => safe(Commission.voidRun(b.run, b.reason)) },
			commissionPlanSave: { roles: "acct", run: (b) => safe(Commission.planSave(b)) },
			commissionAdjust: { roles: "acct", run: (b) => safe(Commission.adjust(b)) },
			commissionImport: { roles: "acct", run: (b) => safe(Commission.importExternal(b)) },
		},
	};

	return { routes, commissionView, commissionResult, commissionSetup, safe };
});
