// Màn Hoa hồng (spa/payroll/views/commission.js, docs/COMMISSION.md mục 4.1, 6, 8): kiểm các hàm ánh xạ API, nội dung POST,
// đọc dữ liệu dán từ Excel / CSV, và vẽ thử từng tab với jsx-runtime + hook giả (bắt lỗi ném trong lúc vẽ, vốn làm sập cả màn).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const SPA = path.resolve(__dirname, "..", "..", "spa", "payroll");

function transpile(file) {
	const source = fs.readFileSync(path.join(SPA, file), "utf8");
	return ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "@uif-js/core", esModuleInterop: true },
		fileName: file.replace(/\.js$/, ".jsx"),
	}).outputText;
}

// Hook giả: useState lấy giá trị từ hàng đợi `queue` (để dựng trạng thái của view), hết hàng đợi thì dùng giá trị đầu
const queue = [];
const hooks = {
	useState: (v) => [queue.length ? (queue[0] === undefined ? (queue.shift(), v) : queue.shift()) : v, () => {}],
	useRef: (v) => ({ current: v }),
	useEffect: () => {},
};
const calls = [];
const api = {
	call: (p) => (calls.push(["get", p]), new Promise(() => {})),
	post: (b) => (calls.push(["post", b]), new Promise(() => {})),
	openRecord: () => {},
	errorText: (e) => String((e && e.message) || e),
	download: (name, content) => calls.push(["download", name, content]),
};

function loadView() {
	const jsx = (type, props, key) => ({ type, props: props || {}, key });
	const runtime = { getCurrentUser: () => ({ getPreference: () => "vi_VN" }) };
	const doc = { createElement: () => ({ setAttribute() {}, type: "text", value: "" }), getElementById: () => null, activeElement: null };
	const sandbox = { WeakMap, Object, Array, String, Number, Date, Math, JSON, RegExp, isNaN, isFinite, setTimeout, clearTimeout, console, document: doc };
	const context = vm.createContext(sandbox);
	const cache = {};
	function load(file) {
		if (cache[file]) return cache[file].exports;
		const module = { exports: {} };
		cache[file] = module;
		const req = (name) => {
			if (name === "@uif-js/core/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
			if (name === "@uif-js/core") return hooks;
			if (name === "N/runtime") return { __esModule: true, default: runtime };
			if (name === "../lib/api.js") return api;
			if (name === "../lib/format.js") return load("lib/format.js");
			if (name === "../lib/i18n.js") return load("lib/i18n.js");
			if (name === "../ui/kit.js") return load("ui/kit.js");
			throw new Error("unexpected import " + name);
		};
		vm.runInContext(`(function (module, exports, require) {${transpile(file)}\n})`, context)(module, module.exports, req);
		return module.exports;
	}
	return load("views/commission.js");
}

const cm = loadView();

// Vẽ cả cây (thành phần hàm gọi tới hết), trả mọi chuỗi chữ để kiểm nội dung
function walk(node, out) {
	if (node === null || node === undefined || node === false || node === true) return out;
	if (Array.isArray(node)) {
		node.forEach((n) => walk(n, out));
		return out;
	}
	if (typeof node === "string" || typeof node === "number") {
		out.push(String(node));
		return out;
	}
	if (typeof node.type === "function") return walk(node.type(node.props), out);
	if (node.props && node.props.value !== undefined && typeof node.props.value !== "object") out.push(`[${node.props.value}]`);
	return walk(node.props && node.props.children, out);
}

// Thứ tự useState trong CommissionView: tab, month, view, stamp, selected, details, sideTab, adj, voidDlg, setup, draft,
// ruleKey, errs, sim, simOut, ext, imp
const STATE_KEYS = ["tab", "month", "view", "stamp", "selected", "details", "sideTab", "adj", "voidDlg", "setup", "draft", "ruleKey", "errs", "sim", "simOut", "ext", "imp"];
function renderView(state, user) {
	queue.length = 0;
	STATE_KEYS.forEach((k) => queue.push(state[k]));
	const app = {
		boot: { user: user || { role: "customrole_s4vp_accountant", isAccountant: true }, subsidiaries: [{ id: 13, name: "S4 VN" }], earningTypes: [{ id: 7, code: "HH", name: "Hoa hong" }] },
		subsidiary: "13",
		route: { view: "commission", params: {} },
		go: () => {},
		run: (l, p) => p,
		notify: () => {},
		confirm: () => {},
		busy: "",
		lang: "vi",
	};
	const tree = cm.default({ app });
	queue.length = 0;
	return walk(tree, []).join(" | ");
}

const SETUP_RAW = {
	plans: [
		{
			id: 5, name: "KH-DT", description: "Doanh thu", subsidiary: 13, effective: "2026-01-01", basis: "R", trigger: "I", credit_source: "T", window: "Q", include_returns: "T", clawback_days: 60, earning_type: "HH", min_attainment: 50, cap_amount: 50000000, draw_type: "R", draw_amount: 3000000, override_pct: 2, override_basis: "C", source: "B",
			rules: [
				{ id: 11, plan: 5, sequence: 10, name: "Co ban", method: "P", rate: 2, f_classes: "3,4", f_new_customer: "F" },
				{ id: 12, plan: 5, sequence: 20, name: "Tang toc", method: "A", tiers: [{ id: 21, rule: 12, from_value: 100, rate: 1 }, { id: 22, rule: 12, from_value: 120, rate: 2 }] },
			],
			assignments: [{ id: 31, plan: 5, employee: 101, effective: "2026-01-01", quota: 100000000, manager: 102 }],
			quotas: [{ id: 41, plan: 5, employee: 101, month: 202610, quota: 120000000 }],
		},
	],
	earningTypes: [{ id: 7, code: "HH", name: "Hoa hong" }],
	lookups: { classes: [{ id: 3, name: "Retail" }, { id: 4, name: "Online" }], departments: [{ id: 1, name: "Sales" }], locations: [], customerCategories: [], employees: [{ id: 101, entityId: "NV001", name: "Nguyen A" }, { id: 102, entityId: "NV002", name: "Tran B" }] },
};

describe("ánh xạ API", () => {
	test("tháng mặc định là tháng trước, đổi qua lại YYYY-MM / YYYYMM", () => {
		expect(cm.previousMonth("2026-11-11")).toBe("2026-10");
		expect(cm.previousMonth("2026-01-05")).toBe("2025-12");
		expect(cm.monthInt("2026-10")).toBe(202610);
		expect(cm.monthIso(202610)).toBe("2026-10");
		expect(cm.monthText("2026-10")).toBe("10/2026");
	});

	test("nút theo trạng thái bảng tính và vai trò", () => {
		expect(cm.runActions(null, true)).toMatchObject({ calc: { enabled: true }, approve: { enabled: false, reason: "noRun" } });
		expect(cm.runActions({ id: "1", status: "D" }, true)).toMatchObject({ calc: { enabled: true }, approve: { enabled: true }, reopen: { enabled: false }, void: { enabled: true } });
		expect(cm.runActions({ id: "1", status: "A" }, true)).toMatchObject({ calc: { enabled: false, reason: "approved" }, reopen: { enabled: true }, void: { enabled: false } });
		expect(cm.runActions({ id: "1", status: "P" }, true).reopen).toEqual({ enabled: false, reason: "posted" });
		expect(cm.runActions({ id: "1", status: "D" }, false).calc.reason).toBe("readOnly");
		expect(cm.rolesOf({ role: "customrole_s4vp_hr", isHr: true })).toEqual({ canRead: true, canWrite: false });
		expect(cm.rolesOf({ role: "customrole_s4vp_accountant" })).toEqual({ canRead: true, canWrite: true });
		expect(cm.canSeeCommission({ user: { role: "customrole_other" } })).toBe(false);
	});

	test("commissionView: dòng, thẻ số liệu tự tính khi API không trả kpis", () => {
		const v = cm.mapView({
			run: { id: 9, name: "HH202610-13", status: "d", from: "2026-10-01", to: "2026-10-31" },
			rows: [
				{ resultId: 1, employee: 101, code: "NV001", name: "A", plan: 5, planName: "KH-DT", base: 100, attainment: 80, payable: 10, warnings: [{}, {}] },
				{ resultId: 2, employee: 102, code: "NV002", name: "B", plan: 5, base: 50, attainment: 120, payable: 5, override_amount: 3 },
			],
			months: [202609, "2026-10"],
		});
		expect(v.run).toMatchObject({ id: "9", status: "D" });
		expect(v.rows[0]).toMatchObject({ id: "1", employee: "101", warnings: 2 });
		expect(v.rows[1].override).toBe(3);
		expect(v.kpis).toMatchObject({ totalBase: 150, totalAmount: 15, employees: 2, avgAttainment: 100, warnings: 2 });
		expect(v.months).toEqual(["2026-09", "2026-10"]);
	});

	test("commissionResult: detail là chuỗi JSON, credit có nguồn", () => {
		const d = cm.mapResult({
			id: 1, base: 100, window_base: 300, attainment: 105.5, payable: 7,
			detail: JSON.stringify({ components: [{ rule: 11, name: "Co ban", method: "P", base: 100, amount: 2, steps: [{ vi: "a", en: "b" }] }], steps: [{ vi: "x", en: "y" }], credits: [{ tranId: 7, tranNo: "INV1", tranType: "I", customerName: "KH1", itemCode: "SP1", pct: 100, base: 100, source: "DMS" }], shares: [{ department: "Sales", amount: 7 }], warnings: [{ code: "NO_QUOTA", vi: "v", en: "e" }] }),
		});
		expect(d).toMatchObject({ windowBase: 300, attainment: 105.5 });
		expect(d.components[0]).toMatchObject({ method: "P", amount: 2 });
		expect(d.credits[0]).toMatchObject({ customer: "KH1", item: "SP1", pct: 100, source: "DMS" });
		expect(d.shares[0]).toMatchObject({ department: "Sales", amount: 7 });
		expect(d.warnings[0].code).toBe("NO_QUOTA");
	});

	test("kế hoạch: đọc snake_case của commissionSetup, gửi lại snake_case cho commissionPlanSave", () => {
		const setup = cm.mapSetup(SETUP_RAW);
		const p = setup.plans[0];
		expect(p).toMatchObject({ id: "5", creditSource: "T", window: "Q", includeReturns: true, earningType: "HH", source: "B", drawType: "R" });
		expect(p.rules[0].fClasses).toEqual(["3", "4"]);
		expect(p.rules[1].tiers.map((t) => t.fromValue)).toEqual(["100", "120"]);
		expect(p.quotas[0].month).toBe("2026-10");
		expect(setup.lookups.employees[0]).toEqual({ value: "101", label: "NV001 Nguyen A" });
		expect(setup.earningTypes[0].value).toBe("HH");

		expect(cm.validatePlan(p).count).toBe(0);
		const body = cm.planPayload(p);
		expect(body.tiers).toBeUndefined();
		expect(body.plan).toMatchObject({ id: "5", name: "KH-DT", credit_source: "T", earning_type: "HH", clawback_days: 60, cap_amount: 50000000, draw_amount: 3000000, override_basis: "C", source: "B", include_returns: true });
		expect(body.rules[0]).toMatchObject({ id: "11", method: "P", rate: 2, f_classes: "3,4", f_items: "", f_new_customer: false, new_days: null, tiers: [] });
		expect(body.rules[1]).toMatchObject({ id: "12", method: "A", rate: null, tiers: [{ id: "21", from_value: 100, rate: 1, amount: null }, { id: "22", from_value: 120, rate: 2, amount: null }] });
		expect(body.assignments[0]).toEqual({ id: "31", employee: "101", effective: "2026-01-01", expiration: null, quota: 100000000, manager: "102" });
		expect(body.quotas[0]).toEqual({ id: "41", employee: "101", month: 202610, quota: 120000000 });
	});

	test("kiểm biểu mẫu kế hoạch mới", () => {
		const d = cm.newPlanDraft("13", "2026-11-11");
		expect(d).toMatchObject({ subsidiary: "13", effective: "2026-11-01", basis: "R", trigger: "I", source: "N", drawType: "N" });
		const e = cm.validatePlan(Object.assign({}, d, { expiration: "2026-10-01", drawType: "R", assignments: [{ key: "a", employee: "" }] }));
		expect(e.plan).toMatchObject({ name: "required", earningType: "required", expiration: "dateOrder", drawAmount: "positive" });
		expect(e.rules[d.rules[0].key]).toBe("ruleName");
		expect(e.assignments.a).toBe("employee");
	});
});

describe("nạp doanh số ngoài", () => {
	test("đọc TSV dán từ Excel và CSV chấm phẩy có ngoặc kép", () => {
		const tsv = cm.parseDelimited("Số chứng từ\tNgày\tMã NV\tDoanh thu\r\nHD1\t15/10/2026\tNV001\t1.500.000\r\n\r\n");
		expect(tsv).toMatchObject({ delimiter: "\t", headers: ["Số chứng từ", "Ngày", "Mã NV", "Doanh thu"], rows: [["HD1", "15/10/2026", "NV001", "1.500.000"]] });
		const csv = cm.parseDelimited('﻿doc_no;customer_name;revenue\nHD2;"Cong ty ""A""; chi nhanh";1000\n');
		expect(csv.delimiter).toBe(";");
		expect(csv.rows[0]).toEqual(["HD2", 'Cong ty "A"; chi nhanh', "1000"]);
	});

	test("tự nhận cột theo tiêu đề tiếng Việt và tiếng Anh", () => {
		expect(cm.guessMapping(["Số chứng từ", "Dòng", "Ngày", "Ngày thu", "Mã KH", "Tên KH", "Mã hàng", "Doanh thu", "Số lượng", "Mã NV", "Số đã thu"])).toEqual({ docNo: "0", lineNo: "1", date: "2", collectedDate: "3", customerCode: "4", customerName: "5", itemCode: "6", revenue: "7", qty: "8", employee: "9", collectedAmount: "10" });
		const en = cm.guessMapping(cm.TEMPLATE_HEADERS);
		expect(Object.keys(en).length).toBe(cm.TEMPLATE_HEADERS.length);
		expect(en).toMatchObject({ docNo: "0", lineNo: "1", tranType: "2", date: "3", cls: "13", collectedDate: "15", collectedAmount: "16" });
		expect(cm.templateCsv().startsWith("﻿doc_no,line_no,")).toBe(true);
	});

	test("số, ngày, loại chứng từ", () => {
		expect(cm.parseAmount("1.500.000")).toBe(1500000);
		expect(cm.parseAmount("1,500,000.50")).toBe(1500000.5);
		expect(cm.parseAmount("1.234,5")).toBe(1234.5);
		expect(cm.parseAmount("(2.000)")).toBe(-2000);
		expect(cm.parseAmount("12,5")).toBe(12.5);
		expect(cm.parseAmount("")).toBeNull();
		expect(cm.parseAmount("abc")).toBeNaN();
		expect(cm.parseDay("5/10/2026")).toBe("2026-10-05");
		expect(cm.parseDay("2026-10-05 08:00")).toBe("2026-10-05");
		expect(cm.parseDay("31/02/2026")).toBe("");
		expect(cm.parseDay("46310")).toBe("2026-10-15");
		expect(cm.parseTranType("Trả hàng")).toBe("C");
		expect(cm.parseTranType("")).toBe("I");
		expect(cm.parseTranType("x")).toBeNull();
	});

	test("dòng chuẩn: lỗi từng dòng, đánh số dòng trong chứng từ, trùng khóa; nội dung POST và kết quả theo index của từng lượt", () => {
		const table = cm.parseDelimited("doc_no\tdate\temployee\trevenue\ttran_type\nHD1\t15/10/2026\tNV001\t100\t\nHD1\t15/10/2026\tNV001\t200\tI\n\t32/10/2026\t\tabc\tZ\n");
		const rows = cm.buildImportRows(table, cm.guessMapping(table.headers));
		expect(rows.map((r) => r.lineNo)).toEqual(["1", "2", "1"]);
		expect(rows[0]).toMatchObject({ row: 1, docNo: "HD1", date: "2026-10-15", tranType: "I", revenue: 100, errors: [] });
		expect(rows[2].errors.sort()).toEqual(["badDate", "badNumber", "badType", "noAmount", "noDoc", "noEmployee"].sort());
		const dup = cm.buildImportRows(cm.parseDelimited("doc_no\tline_no\tdate\temployee\trevenue\nA\t1\t2026-10-01\tNV1\t1\nA\t1\t2026-10-01\tNV1\t2\n"), { docNo: "0", lineNo: "1", date: "2", employee: "3", revenue: "4" });
		expect(dup[1].errors).toEqual(["duplicate"]);

		expect(cm.importPayloadRow(rows[0], "DMS-1")).toMatchObject({ doc_no: "HD1", line_no: "1", tran_type: "I", date: "2026-10-15", employee: "NV001", revenue: 100, import_batch: "DMS-1" });
		const res = cm.mapImportResults([
			{ rows: rows.slice(0, 1), response: { rows: [{ index: 0, status: "new", messages: [] }] } },
			{ rows: rows.slice(1, 2), response: { rows: [{ index: 0, status: "invalid", messages: [{ en: "Employee NV001 not found", vi: "Không tìm thấy" }] }] } },
		]);
		expect(res[1]).toMatchObject({ status: "ok", action: "create" });
		expect(res[2]).toMatchObject({ status: "error", errors: [{ en: "Employee NV001 not found" }] });
		expect(cm.mapExternal({ id: 3, sourceSystem: "DMS", docNo: "HD1", code: "NV001", name: "Nguyen A", revenue: 5, locked: true }, 0)).toMatchObject({ employee: "NV001 Nguyen A", locked: true, revenue: 5 });
	});
});

describe("vẽ thử từng tab (không ném lỗi)", () => {
	const setup = Object.assign(cm.mapSetup(SETUP_RAW), { sub: "13" });
	const view = cm.mapView({
		run: { id: 9, name: "HH202610-13", status: "D", from: "2026-10-01", to: "2026-10-31", calcAt: "2026-11-01T08:00:00Z" },
		rows: [{ resultId: 1, employee: 101, code: "NV001", name: "Nguyen A", plan: 5, planName: "KH-DT", quota: 100, base: 120, attainment: 120, earned: 3, payable: 3, warnings: 1 }],
	});
	const detail = { 1: { state: "ok", data: cm.mapResult({ id: 1, base: 120, payable: 3, detail: { components: [{ name: "Co ban", method: "P", base: 120, amount: 3 }], steps: [{ vi: "Buoc 1", en: "Step 1" }], credits: [{ tranId: 7, tranNo: "INV1", tranType: "I", pct: 100, base: 120, source: "DMS" }], shares: [{ department: "Sales", amount: 3 }] } }) } };

	test("Bảng tính: chưa có dữ liệu, rồi có bảng nháp với các tab chi tiết", () => {
		expect(renderView({})).toContain("Hoa hồng");
		for (const sideTab of ["explain", "credits", "shares", "adjust"]) {
			const text = renderView({ view, details: detail, sideTab, setup });
			expect(text).toContain("NV001");
			if (sideTab === "credits") expect(text).toContain("DMS");
		}
		expect(renderView({ view, voidDlg: { id: "9", name: "HH202610-13", reason: "", error: "" } })).toContain("Lý do hủy");
		expect(renderView({}, { role: "customrole_other" })).toContain("không được xem");
	});

	test("Kế hoạch: danh sách và biểu mẫu sửa", () => {
		expect(renderView({ tab: "plans", setup })).toContain("KH-DT");
		const draft = Object.assign({}, setup.plans[0], { dirty: true });
		const text = renderView({ tab: "plans", setup, draft, ruleKey: draft.rules[1].key });
		expect(text).toContain("Bậc thang");
		expect(text).toContain("Nguồn doanh số");
		renderView({ tab: "plans", setup, draft, ruleKey: draft.rules[0].key, errs: cm.validatePlan(Object.assign({}, draft, { name: "" })) });
	});

	test("Mô phỏng, Doanh số ngoài, hộp thoại nạp", () => {
		expect(renderView({ tab: "sim", setup, sim: { plan: "5", base: "120000000", qty: "", quota: "100000000" }, simOut: { state: "ok", data: { amount: 2400000, attainment: null, components: [], steps: [{ vi: "a", en: "b" }], warnings: [] }, error: "" } })).toContain("2.400.000");
		expect(renderView({ tab: "ext", month: "2026-10", ext: { month: "2026-10", sub: "13", rows: [cm.mapExternal({ id: 1, sourceSystem: "DMS", docNo: "HD9", revenue: 10 }, 0)] } })).toContain("HD9");
		const table = cm.parseDelimited("doc_no\tdate\temployee\trevenue\nHD1\t15/10/2026\tNV001\t100\n");
		const mapping = cm.guessMapping(table.headers);
		const imp = { system: "DMS", stamp: "x", text: "", fileName: "", table, mapping, rows: cm.buildImportRows(table, mapping), results: { 1: { row: 1, status: "ok", action: "create", errors: [] } }, skip: false, error: "", systemError: "", message: "" };
		const text = renderView({ tab: "ext", imp });
		expect(text).toContain("Ánh xạ cột");
		expect(text).toContain("Tạo mới");
	});
});
