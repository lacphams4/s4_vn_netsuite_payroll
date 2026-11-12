// Trang chủ (spa/payroll/views/home.js): bốn thẻ số liệu bấm được - nơi đi tới của từng thẻ (tileTargets), dòng hộp thoại
// thực lĩnh (netRows), cuộn tới bảng việc cần làm (revealTodos), và vẽ thử màn với jsx-runtime + hook giả.
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

// Hook giả: useState lấy giá trị từ hàng đợi `queue` (undefined = giá trị mặc định)
const queue = [];
const setters = [];
const hooks = {
	useState: (v) => {
		const value = queue.length ? (queue[0] === undefined ? (queue.shift(), v) : queue.shift()) : v;
		const set = jest.fn();
		setters.push(set);
		return [value, set];
	},
	useRef: (v) => ({ current: v }),
	useEffect: () => {},
};
const api = { call: () => new Promise(() => {}), post: () => new Promise(() => {}), openRecord: () => {}, openJournal: () => {}, errorText: (e) => String((e && e.message) || e) };

function loadModules() {
	const jsx = (type, props, key) => ({ type, props: props || {}, key });
	const runtime = { getCurrentUser: () => ({ getPreference: () => "vi_VN" }) };
	const doc = { createElement: () => ({ setAttribute() {}, type: "text", value: "" }), getElementById: () => null, activeElement: null };
	const sandbox = { WeakMap, Set, Object, Array, String, Number, Date, Math, JSON, RegExp, isNaN, isFinite, setTimeout, clearTimeout, console, document: doc, encodeURIComponent };
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
	return { home: load("views/home.js"), i18n: load("lib/i18n.js") };
}

const { home } = loadModules();

// Duyệt cây: gom chữ và các nút thẻ số liệu
function walk(node, out) {
	if (node === null || node === undefined || node === false || node === true) return out;
	if (Array.isArray(node)) {
		node.forEach((n) => walk(n, out));
		return out;
	}
	if (typeof node === "string" || typeof node === "number") {
		out.text.push(String(node));
		return out;
	}
	if (typeof node.type === "function") return walk(node.type(node.props), out);
	const p = node.props || {};
	if (node.type === "button" && /s4vp-home-tile/.test(String(p.class || ""))) out.tiles.push(node);
	if (p.id) out.ids.push(p.id);
	if (p.title && typeof p.title === "string") out.text.push(`{${p.title}}`);
	return walk(p.children, out);
}
const textOf = (node) => walk(node, { text: [], tiles: [], ids: [] }).text.join(" | ");

const DATA = {
	today: "2027-03-30",
	period: { id: "3", code: "2027-03", start: "2027-03-01", end: "2027-03-31", stdDays: 23, attStatus: "O", containsToday: true },
	previousPeriod: { id: "2", code: "2027-02" },
	batchCounts: { total: 2, byStatus: { H: 1, C: 1 } },
	runs: [],
	runCounts: { running: 0, upcoming: 0, done: 0 },
	todos: [
		{ key: "lock:3", kind: "lockAttendance", tone: "error", owner: "hr", count: 1, date: "2027-03-29", daysLeft: -1, period: { id: "3", code: "2027-03" }, go: { view: "attendance", params: { period: "3" } } },
		{ key: "batch:7", kind: "batch_review", tone: "warn", owner: "all", note: "openChecks", count: 2, batch: { id: "7", name: "BL000007" }, period: { id: "3", code: "2027-03" }, go: { view: "payrollRun", params: { id: "7" } } },
	],
	net: { current: 100000000, previous: 80000000, diff: 20000000, pct: 0.25, currentBatches: 2, previousBatches: 1 },
	periodBatches: {
		current: [
			{ id: "8", name: "BL000008", description: "Thưởng", status: "C", empCount: 2, counted: true, net: 25000000 },
			{ id: "7", name: "BL000007", description: "", status: "C", empCount: 4, counted: true, net: 75000000 },
			{ id: "9", name: "BL000009", description: "", status: "B", empCount: 0, counted: false, net: null },
		],
		previous: [{ id: "6", name: "BL000006", description: "", status: "R", empCount: 4, counted: true, net: 80000000 }],
	},
	deadlines: [],
	statutoryDeadlines: false,
	permits: null,
};

const T = { status: { C: "Đã tính", R: "Đã ghi sổ", B: "Chờ tính" } };

describe("tileTargets: nơi đi tới của từng thẻ", () => {
	test("kỳ đang chạy -> Chấm công của kỳ; chưa có kỳ -> Thiết lập mục kỳ lương", () => {
		expect(home.tileTargets(DATA).period).toEqual({ view: "attendance", params: { period: "3" } });
		expect(home.tileTargets({}).period).toEqual({ view: "setupHub", params: { section: "periods" } });
	});

	test("bảng lương của kỳ: nhiều bảng -> danh sách lọc theo kỳ; đúng một bảng -> mở thẳng; chưa có kỳ -> danh sách", () => {
		expect(home.tileTargets(DATA).batches).toEqual({ view: "payrollList", params: { period: "3" } });
		const one = Object.assign({}, DATA, { batchCounts: { total: 1 }, periodBatches: { current: [{ id: "7", status: "C" }], previous: [] } });
		expect(home.tileTargets(one).batches).toEqual({ view: "payrollRun", params: { id: "7" } });
		const none = Object.assign({}, DATA, { batchCounts: { total: 0 }, periodBatches: { current: [], previous: [] } });
		expect(home.tileTargets(none).batches).toEqual({ view: "payrollList", params: { period: "3" } });
		expect(home.tileTargets({ batchCounts: { total: 0 } }).batches).toEqual({ view: "payrollList", params: {} });
	});

	test("việc cần xử lý -> cuộn tới bảng việc; thực lĩnh -> hộp thoại, chưa có số thì như thẻ bảng lương", () => {
		expect(home.tileTargets(DATA).todos).toEqual({ todos: true });
		expect(home.tileTargets(DATA).net).toEqual({ dialog: "net" });
		const noNet = Object.assign({}, DATA, { net: { current: null } });
		expect(home.tileTargets(noNet).net).toEqual({ view: "payrollList", params: { period: "3" } });
	});
});

describe("netRows: dòng hộp thoại thực lĩnh", () => {
	test("chỉ bảng đã tính, kỳ này trước kỳ trước, tỷ trọng theo tổng của kỳ mình, chữ trạng thái để ô tìm khớp", () => {
		const rows = home.netRows(T, DATA);
		expect(rows.map((r) => [r.id, r.batch, r.periodCode, r.net, r.share])).toEqual([
			["current:8", "8", "2027-03", 25000000, 0.25],
			["current:7", "7", "2027-03", 75000000, 0.75],
			["previous:6", "6", "2027-02", 80000000, 1],
		]);
		expect(rows[0]).toMatchObject({ statusText: "Đã tính", description: "Thưởng", empCount: 2 });
		expect(home.netRows(T, {})).toEqual([]);
	});
});

describe("revealTodos: cuộn tới bảng việc cần làm", () => {
	test("cuộn, nháy viền rồi gỡ, đặt con trỏ vào ô tìm", () => {
		const classes = new Set();
		const calls = [];
		const input = { focus: jest.fn() };
		const el = {
			scrollIntoView: (o) => calls.push(["scroll", o]),
			classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
			offsetWidth: 100,
			querySelector: (s) => (s === "input" ? input : null),
		};
		const timers = [];
		const doc = { getElementById: (id) => (id === "s4vp-home-todos" ? el : null) };
		expect(home.revealTodos(doc, (fn, ms) => timers.push([fn, ms]))).toBe(true);
		expect(calls[0]).toEqual(["scroll", { behavior: "smooth", block: "start" }]);
		expect(classes.has("s4vp-home-flash")).toBe(true);
		expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
		timers[0][0]();
		expect(classes.has("s4vp-home-flash")).toBe(false);
	});

	test("không có khung hoặc không có document: trả false, không ném", () => {
		expect(home.revealTodos({ getElementById: () => null })).toBe(false);
		expect(home.revealTodos(null)).toBe(false);
	});
});

describe("vẽ thử Trang chủ", () => {
	// Thứ tự useState trong HomeView: data, failed, group, query, netOpen
	function render(state, go) {
		queue.length = 0;
		setters.length = 0;
		["data", "failed", "group", "query", "netOpen"].forEach((k) => queue.push(state[k]));
		const app = { boot: { user: { role: "administrator", name: "A" }, subsidiaries: [{ id: "13", name: "S4" }], setupReady: true }, subsidiary: "13", route: { view: "home", params: {} }, go: go || (() => {}), run: (l, p) => p, notify: () => {}, busy: "", lang: "vi" };
		const tree = home.default({ app });
		queue.length = 0;
		return tree;
	}

	test("bốn thẻ là nút có tooltip, bấm thì đi đúng màn, có khung việc cần làm để cuộn tới", () => {
		const went = [];
		const tree = render({ data: DATA }, (view, params) => went.push([view, params]));
		const out = walk(tree, { text: [], tiles: [], ids: [] });
		expect(out.tiles.length).toBe(4);
		for (const b of out.tiles) {
			expect(b.props.type).toBe("button");
			expect(b.props.title).toBe("Bấm để xem chi tiết");
			expect(typeof b.props.onClick).toBe("function");
		}
		expect(out.tiles[2].props.class).toContain("s4vp-t-error");
		expect(out.ids).toContain("s4vp-home-todos");
		out.tiles[0].props.onClick();
		out.tiles[1].props.onClick();
		expect(went).toEqual([["attendance", { period: "3" }], ["payrollList", { period: "3" }]]);
		// thẻ thực lĩnh mở hộp thoại (setNetOpen là useState thứ năm)
		out.tiles[3].props.onClick();
		expect(setters[4]).toHaveBeenCalledWith(true);
		// thẻ việc cần xử lý: không đi màn khác
		out.tiles[2].props.onClick();
		expect(went.length).toBe(2);
	});

	test("hộp thoại thực lĩnh: tổng kỳ này, kỳ trước, chênh lệch, lưới có ô tìm; bấm dòng mở bảng lương", () => {
		const went = [];
		const tree = render({ data: DATA, netOpen: true }, (view, params) => went.push([view, params]));
		const text = textOf(tree);
		expect(text).toContain("Thực lĩnh kỳ 2027-03");
		expect(text).toContain("Kỳ này (2027-03)");
		expect(text).toContain("Kỳ trước (2027-02)");
		expect(text).toContain("BL000008");
		expect(text).toContain("BL000006");
		expect(text).not.toContain("BL000009");
		expect(text).toContain("Danh sách bảng lương của kỳ");
	});

	test("chưa có thực lĩnh, chưa có kỳ: vẫn vẽ được, thẻ kỳ trỏ về Thiết lập", () => {
		const went = [];
		const data = Object.assign({}, DATA, { period: null, previousPeriod: null, net: { current: null, previous: null }, periodBatches: { current: [], previous: [] }, todos: [], batchCounts: { total: 0, byStatus: {} } });
		const out = walk(render({ data }, (v, p) => went.push([v, p])), { text: [], tiles: [], ids: [] });
		expect(out.tiles.length).toBe(4);
		out.tiles[0].props.onClick();
		out.tiles[3].props.onClick();
		expect(went).toEqual([["setupHub", { section: "periods" }], ["payrollList", {}]]);
	});
});
