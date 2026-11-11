// Nạp chấm công (spa/payroll/views/punchImport.js, docs/PUNCH_IMPORT.md mục 3, 4): kiểm các hàm đọc phản hồi API, nội dung
// POST, vòng ghi theo lượt có cursor, và vẽ thử hộp thoại ở từng trạng thái (cùng nút ở màn Chấm công) với jsx-runtime + hook giả.
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

// Hook giả: useState lấy giá trị từ hàng đợi `queue` (undefined = giá trị mặc định), hết hàng đợi thì dùng giá trị đầu
const queue = [];
const hooks = {
	useState: (v) => [queue.length ? (queue[0] === undefined ? (queue.shift(), v) : queue.shift()) : v, () => {}],
	useRef: (v) => ({ current: v }),
	useEffect: () => {},
};
const calls = [];
const api = {
	RESTLET: { scriptId: "customscript_s4vp_rl_api", deploymentId: "customdeploy_s4vp_rl_api" },
	unwrap: (r) => r,
	call: (p) => (calls.push(["get", p]), new Promise(() => {})),
	post: (b) => (calls.push(["post", b]), new Promise(() => {})),
	openRecord: () => {},
	errorText: (e) => String((e && e.message) || e),
	download: () => {},
};
const nurl = { resolveScript: () => "/app/site/hosting/restlet.nl?script=1&deploy=1", resolveRecord: (o) => `/rec/${o.recordType}${o.recordId ? `/${o.recordId}` : "/new"}` };
const nhttps = { post: { promise: () => new Promise(() => {}) } };

function loadModules() {
	const jsx = (type, props, key) => ({ type, props: props || {}, key });
	const runtime = { getCurrentUser: () => ({ getPreference: () => "vi_VN" }) };
	const doc = { createElement: () => ({ setAttribute() {}, type: "text", value: "" }), getElementById: () => null, activeElement: null };
	const sandbox = { WeakMap, Object, Array, String, Number, Date, Math, JSON, RegExp, isNaN, isFinite, setTimeout, clearTimeout, console, document: doc, encodeURIComponent };
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
			if (name === "N/url") return { __esModule: true, default: nurl };
			if (name === "N/https") return { __esModule: true, default: nhttps };
			if (name === "../lib/api.js") return api;
			if (name === "../lib/format.js") return load("lib/format.js");
			if (name === "../lib/i18n.js") return load("lib/i18n.js");
			if (name === "../ui/kit.js") return load("ui/kit.js");
			if (name === "./punchImport.js") return load("views/punchImport.js");
			throw new Error("unexpected import " + name);
		};
		vm.runInContext(`(function (module, exports, require) {${transpile(file)}\n})`, context)(module, module.exports, req);
		return module.exports;
	}
	return { pi: load("views/punchImport.js"), att: load("views/attendance.js") };
}

const { pi, att } = loadModules();

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
	if (node.props && node.props.title) out.push(`{${node.props.title}}`);
	return walk(node.props && node.props.children, out);
}

const app = (extra) => Object.assign({ boot: { user: { role: "customrole_s4vp_hr", isHr: true }, periods: [], paygroups: [] }, subsidiary: "13", route: { view: "attendance", params: {} }, go: () => {}, run: (l, p) => p, notify: () => {}, confirm: () => {}, busy: "", lang: "vi", reloadBoot: () => Promise.resolve() }, extra || {});

function renderDialog(state, props) {
	queue.length = 0;
	queue.push(Object.assign(pi.initialState(""), state));
	const tree = pi.PunchImportDialog(Object.assign({ app: app(), subsidiary: "13", period: { id: "7", code: "202610", start: "2026-10-01", end: "2026-10-31" }, periods: [{ id: "7", code: "202610", start: "2026-10-01", end: "2026-10-31" }, { id: "8", code: "202611", start: "2026-11-01", end: "2026-11-30" }], employees: [{ id: "101", code: "NV001", name: "Nguyen A" }], onClose: () => {}, onProcess: () => {}, onOpenPeriod: () => {} }, props || {}));
	queue.length = 0;
	return walk(tree, []).join(" | ");
}

const SOURCES_RAW = {
	sources: [
		{ id: 3, code: "ZK-XUONG", description: "May xuong", layout: "Z", idKind: "B", date_format: "YMD", device_default: "XUONG1", minute_offset: -2 },
		{ id: 4, name: "EXCEL", layout: "P", id_kind: "N", has_header: "F", skip_lines: 2 },
		{ id: 5, code: "OLD", layout: "E", isinactive: "T" },
	],
	mapCounts: { 3: 12 },
	recordTypes: { source: "customrecord_s4vp_punch_source", map: "customrecord_s4vp_punch_map" },
};

const PREVIEW_RAW = {
	counts: { total: 1500, new: 3, duplicate: 1, invalid: 1, unmatched: 2, locked: 0 },
	rows: [
		{ line: 2, machineId: "15", device: "XUONG1", time: "2026-10-05 07:58", kind: "in", employee: 101, code: "NV001", name: "Nguyen A", status: "new" },
		{ line: 3, machineId: "15", device: "XUONG1", time: "2026-10-05 17:02", employee: 101, code: "NV001", name: "Nguyen A", status: "duplicate", vi: "Đã có lượt chấm", en: "Already exists" },
		{ line: 4, machineId: "99", device: "XUONG1", time: "", status: "invalid", vi: "Ngày không hợp lệ", en: "Invalid date" },
		{ line: 5, machine_id: "77", device: "XUONG2", time: "2026-10-06 08:00", status: "unmatched" },
	],
	unmatched: [{ machineId: "77", device: "XUONG2", lines: 20, firstTime: "2026-10-06 08:00" }, { machine_id: "77", device: "XUONG1", count: 3, first_time: "2026-10-07 08:00" }],
	range: { from: "2026-10-05 07:58", to: "2026-11-02 17:00" },
	employees: 2,
};

describe("đọc phản hồi API", () => {
	test("punchSourcesView: tên khóa dự phòng, bỏ nguồn ngừng dùng", () => {
		const v = pi.mapSourcesView(SOURCES_RAW);
		expect(v.sources.map((s) => s.id)).toEqual(["3", "4"]);
		expect(v.sources[0]).toMatchObject({ code: "ZK-XUONG", layout: "Z", idKind: "B", dateFormat: "YMD", deviceDefault: "XUONG1", minuteOffset: -2, hasHeader: true });
		expect(v.sources[1]).toMatchObject({ code: "EXCEL", layout: "P", idKind: "N", hasHeader: false, skipLines: 2 });
		expect(v.mapCounts).toEqual({ 3: 12 });
		expect(v.recordTypes).toEqual({ source: "customrecord_s4vp_punch_source", map: "customrecord_s4vp_punch_map" });
		expect(pi.mapSourcesView({}).sources).toEqual([]);
	});

	test("punchPreview: số đếm, dòng, mã chưa đối chiếu, khoảng ngày, cờ chỉ hiện một phần", () => {
		const v = pi.mapPreview(PREVIEW_RAW);
		expect(v.counts).toEqual({ total: 1500, new: 3, duplicate: 1, invalid: 1, unmatched: 2, locked: 0 });
		expect(v.rows[0]).toMatchObject({ line: 2, employee: "101", status: "new", code: "NV001" });
		expect(v.rows[3]).toMatchObject({ machineId: "77", status: "unmatched", employee: "" });
		expect(v.unmatched.map((u) => [u.machineId, u.device, u.lines, u.firstTime])).toEqual([["77", "XUONG2", 20, "2026-10-06 08:00"], ["77", "XUONG1", 3, "2026-10-07 08:00"]]);
		expect(v.unmatched[0].id).not.toBe(v.unmatched[1].id);
		expect(v.range).toEqual({ from: "2026-10-05", to: "2026-11-02" });
		expect(v.employees).toBe(2);
		expect(v.truncated).toBe(true);
		const small = pi.mapPreview({ counts: { new: 1 }, rows: [{ line: 1, status: "NEW" }, { line: 2, status: "weird" }] });
		expect(small.counts.total).toBe(1);
		expect(small.rows.map((r) => r.status)).toEqual(["new", "invalid"]);
	});

	test("punchMappings, dòng gửi punchMapSave", () => {
		const rows = pi.mapMappings({ rows: [{ id: 9, device: "", machine_id: "15", employee: 101, code: "NV001", name: "A", effective: "2026-01-01", expiration: null }] });
		expect(rows[0]).toMatchObject({ key: "m9", id: "9", machineId: "15", employee: "101", effective: "2026-01-01", expiration: "" });
		expect(pi.mapSaveRow(rows[0], true)).toEqual({ id: "9", device: "", machineId: "15", employee: "101", effective: "2026-01-01", expiration: null });
		expect(pi.mapSaveRow({ machineId: " 77 ", device: "X", employee: "5" }, false)).toEqual({ device: "X", machineId: "77", employee: "5" });
		expect(pi.mapSaveRow(Object.assign({}, rows[0], { inactive: true }), true)).toEqual({ id: "9", inactive: true });
	});

	test("mã chưa đối chiếu: chỉ mã đã chọn nhân viên; mọi máy thì bỏ thiết bị và gộp mã trùng", () => {
		const v = pi.mapPreview(PREVIEW_RAW);
		const assign = { [v.unmatched[0].id]: "101", [v.unmatched[1].id]: "102" };
		expect(pi.unmatchedPayload(v.unmatched, assign, false)).toEqual([{ device: "XUONG2", machineId: "77", employee: "101" }, { device: "XUONG1", machineId: "77", employee: "102" }]);
		expect(pi.unmatchedPayload(v.unmatched, assign, true)).toEqual([{ device: "", machineId: "77", employee: "101" }]);
		expect(pi.unmatchedPayload(v.unmatched, {}, false)).toEqual([]);
	});

	test("bảng đối chiếu đang sửa: gộp phần sửa, dòng mới, kiểm lỗi", () => {
		const rows = pi.mapMappings({ rows: [{ id: 1, machineId: "15", employee: 101, effective: "2026-01-01" }, { id: 2, machineId: "16", employee: 102 }] });
		const merged = pi.mergeMappings(rows, { m1: { expiration: "2025-12-31" }, m2: { employee: "102" } }, [{ key: "n1", machineId: "", employee: "" }]);
		expect(merged.map((r) => [r.key, r.changed, r.isNew])).toEqual([["m1", true, false], ["m2", false, false], ["n1", true, true]]);
		expect(pi.mappingError(merged[0])).toBe("dates");
		expect(pi.mappingError(merged[2])).toBe("machineId");
		expect(pi.mappingError({ machineId: "1", employee: "" })).toBe("employee");
		expect(pi.mappingError({ machineId: "1", employee: "5", effective: "2026-01-01", expiration: "2026-01-01" })).toBe("");
		// Thôi dùng: là thay đổi, không kiểm lỗi; hoàn tác thì hết thay đổi
		const off = pi.mergeMappings(rows, { m2: { inactive: true } }, []);
		expect(off[1]).toMatchObject({ changed: true, inactive: true });
		expect(pi.mappingError(Object.assign({}, off[1], { employee: "" }))).toBe("");
		expect(pi.mergeMappings(rows, { m2: { inactive: false } }, [])[1].changed).toBe(false);
	});

	test("hàm phụ: byte UTF-8, số dòng, thời điểm, danh sách nhân viên, form NetSuite, kỳ giao khoảng ngày, quyền", () => {
		expect(pi.utf8Bytes("abc")).toBe(3);
		expect(pi.utf8Bytes("Đạt")).toBe(6); // Đ 2 byte, ạ 3 byte, t 1 byte
		expect(pi.utf8Bytes("😀")).toBe(4);
		expect(pi.lineCount("a\r\n\r\nb\nc\n")).toBe(3);
		expect(pi.lineCount("  ")).toBe(0);
		expect(pi.fmtTime("2026-10-05 07:58:31")).toBe("05/10/2026 07:58");
		expect(pi.fmtTime("2026-10-05")).toBe("05/10/2026");
		expect(pi.employeeOptions([{ id: "2", code: "NV2", name: "B" }], [{ id: 1, code: "NV1", name: "A" }, { id: "2", code: "X", name: "Y" }], [{ employee: "", code: "Z" }])).toEqual([{ value: "1", label: "NV1 A" }, { value: "2", label: "NV2 B" }]);
		expect(pi.recordHref("812", "")).toBe("/app/common/custom/custrecordentry.nl?rectype=812");
		expect(pi.recordHref("812", 5)).toBe("/app/common/custom/custrecordentry.nl?rectype=812&id=5&e=T");
		expect(pi.recordHref("customrecord_s4vp_punch_source", "3", nurl.resolveRecord)).toBe("/rec/customrecord_s4vp_punch_source/3");
		expect(pi.recordHref("customrecord_s4vp_punch_source", "", nurl.resolveRecord)).toBe("/rec/customrecord_s4vp_punch_source/new");
		expect(pi.recordHref("", "3")).toBe("");
		const periods = [{ id: 7, start: "2026-10-01", end: "2026-10-31" }, { id: 8, start: "2026-11-01", end: "2026-11-30" }, { id: 9, start: "2026-12-01", end: "2026-12-31" }];
		expect(pi.periodsInRange(periods, { from: "2026-10-05", to: "2026-11-02" }).map((p) => p.id)).toEqual([7, 8]);
		expect(pi.periodsInRange(periods, {})).toEqual([]);
		expect(pi.canImport({ role: "customrole_s4vp_hr", isHr: true })).toBe(true);
		expect(pi.canImport({ role: "administrator" })).toBe(true);
		expect(pi.canImport({ role: "customrole_s4vp_accountant", isAccountant: true })).toBe(false);
		expect(pi.canImport({ role: "administrator" }, { canEdit: false })).toBe(false);
		expect(pi.canImport({}, { canEdit: true })).toBe(true);
	});
});

describe("ghi theo lượt (punchCommit)", () => {
	const body = { action: "punchCommit", source: "3", text: "x" };

	test("gửi lại cursor máy chủ trả về cho đến khi hết more, cộng dồn số đã ghi", async () => {
		const sent = [];
		const answers = [
			{ created: 400, skipped: 2, invalid: 1, unmatched: 5, locked: 0, failed: 1, failures: [{ line: 7, vi: "Không ghi được", en: "Not saved" }], more: true, cursor: 410 },
			{ created: 380, skipped: 0, invalid: 0, unmatched: 2, locked: 1, failed: 0, failures: [], more: true, cursor: 800 },
			{ created: 20, skipped: 1, invalid: 1, unmatched: 0, locked: 0, failed: 0, failures: [], cursor: 900 },
		];
		const steps = [];
		const res = await pi.runCommit((b) => (sent.push(b), Promise.resolve(answers[sent.length - 1])), body, { onStep: (s) => steps.push(s.created) });
		expect(sent.map((b) => b.cursor)).toEqual([undefined, 410, 800]);
		expect(sent.every((b) => b.text === "x" && b.source === "3" && b.action === "punchCommit")).toBe(true);
		expect(steps).toEqual([400, 780, 800]);
		expect(res).toMatchObject({ created: 800, skipped: 3, invalid: 2, unmatched: 7, locked: 1, failed: 1, rounds: 3, done: true, more: false });
		expect(res.failures).toEqual([{ line: 7, vi: "Không ghi được", en: "Not saved" }]);
		expect(res.stopped).toBeUndefined();
	});

	test("more mà cursor không đổi và không ghi thêm thì dừng; quá số lượt tối đa thì dừng còn more", async () => {
		let n = 0;
		const stuck = await pi.runCommit(() => (n++, Promise.resolve({ created: 0, more: true, cursor: "A" })), body, {});
		expect(n).toBe(2);
		expect(stuck).toMatchObject({ stalled: true, done: true });
		// Máy chủ không dùng cursor nhưng vẫn tiến (ghi thêm mỗi lượt): tiếp tục đến giới hạn lượt
		let m = 0;
		const capped = await pi.runCommit(() => (m++, Promise.resolve({ created: 10, more: true })), body, { maxRounds: 4 });
		expect(m).toBe(4);
		expect(capped).toMatchObject({ created: 40, more: true, done: true });
		expect(capped.stalled).toBeUndefined();
	});

	test("lỗi giữa chừng: giữ số đã ghi, báo lỗi, không ném", async () => {
		let k = 0;
		const res = await pi.runCommit(() => (k++ === 0 ? Promise.resolve({ created: 5, more: true, cursor: 1 }) : Promise.reject({ message: "SSS_USAGE_LIMIT_EXCEEDED" })), body, { errorText: (e) => e.message });
		expect(res).toMatchObject({ created: 5, stopped: "SSS_USAGE_LIMIT_EXCEEDED", done: true, rounds: 1 });
		const first = await pi.runCommit(() => Promise.reject({ message: "boom" }), body, { errorText: (e) => e.message });
		expect(first).toMatchObject({ created: 0, stopped: "boom", done: true });
	});
});

describe("vẽ thử hộp thoại (không ném lỗi)", () => {
	const sv = pi.mapSourcesView(SOURCES_RAW);
	const loaded = { sources: sv.sources, mapCounts: sv.mapCounts, recordTypes: sv.recordTypes };
	const preview = pi.mapPreview(PREVIEW_RAW);

	test("đang tải nguồn, chưa có nguồn, đã chọn nguồn và file", () => {
		expect(renderDialog({})).toContain("Đang tải hồ sơ nguồn");
		expect(renderDialog({ sources: [] })).toContain("Chưa có hồ sơ nguồn nào");
		const text = renderDialog(Object.assign({ source: "3", fileText: "15\t2026-10-05 07:58:00\n", fileName: "attlog.dat", fileBytes: 24, lines: 1 }, loaded));
		expect(text).toContain("ZKTeco attlog");
		expect(text).toContain("12 mã đã đối chiếu");
		expect(text).toContain("attlog.dat: 1 dòng");
		expect(text).toContain("Sửa hồ sơ");
		expect(text).toContain("{Bấm Xem trước trước khi ghi}");
	});

	test("dữ liệu dán quá 5 MB thì cảnh báo và khóa Xem trước", () => {
		const big = "1\t2026-10-05 07:58\n".repeat(320000);
		expect(renderDialog(Object.assign({ source: "3", text: big, lines: 320000 }, loaded))).toContain("vượt giới hạn 5 MB");
	});

	test("xem trước: thẻ đếm, lưới, khung mã chưa đối chiếu, nút ghi", () => {
		const text = renderDialog(Object.assign({ source: "3", text: "x", lines: 1, preview, assign: { [preview.unmatched[0].id]: "101" } }, loaded));
		expect(text).toContain("Tất cả 1.500");
		expect(text).toContain("Chưa đối chiếu 2");
		expect(text).toContain("Chỉ hiện 4 / 1.500 dòng chi tiết đầu");
		expect(text).toContain("Đã có lượt chấm");
		expect(text).toContain("05/10/2026 07:58 (vào)");
		expect(text).toContain("Mã chưa đối chiếu (2)");
		expect(text).toContain("Lưu đối chiếu (1)");
		expect(text).toContain("Ghi 3 lượt chấm mới");
		// lọc trạng thái
		const only = renderDialog(Object.assign({ source: "3", text: "x", preview, filter: "invalid" }, loaded));
		expect(only).toContain("Ngày không hợp lệ");
		expect(only).not.toContain("Đã có lượt chấm");
	});

	test("đang ghi, ghi xong (gợi ý xử lý chấm công máy), lỗi giữa chừng", () => {
		const base = Object.assign({ source: "3", text: "x", preview }, loaded);
		expect(renderDialog(Object.assign({ commit: { created: 1, skipped: 0, invalid: 1, unmatched: 2, locked: 0, rounds: 1, done: false } }, base))).toContain("Đang ghi lượt 2");
		const done = renderDialog(Object.assign({ commit: { created: 3, skipped: 0, invalid: 1, unmatched: 2, locked: 0, rounds: 1, done: true, more: false } }, base));
		expect(done).toContain("Đã ghi xong");
		expect(done).toContain("Xử lý chấm công máy kỳ 202610");
		expect(done).toContain("Mở kỳ 202611");
		expect(done).not.toContain("Ghi 3 lượt chấm mới");
		const noProc = renderDialog(Object.assign({ commit: { created: 3, rounds: 1, done: true } }, base), { onProcess: null });
		expect(noProc).toContain("Thao tác khác > Xử lý chấm công máy");
		expect(renderDialog(Object.assign({ commit: { created: 2, rounds: 1, done: true, stopped: "boom" } }, base))).toContain("Lượt ghi bị dừng vì lỗi: boom");
		const partial = renderDialog(Object.assign({ commit: { created: 2, failed: 1, failures: [{ line: 7, vi: "Không ghi được lượt chấm: x", en: "x" }], rounds: 1, done: true } }, base));
		expect(partial).toContain("1 lượt chấm không ghi được");
		expect(partial).toContain("Dòng 7: Không ghi được lượt chấm: x");
		expect(partial).toContain("Xử lý chấm công máy kỳ 202610");
	});

	test("tab Đối chiếu mã chấm công: chưa chọn nguồn, đang tải, có dòng sửa và dòng mới", () => {
		expect(renderDialog(Object.assign({ tab: "map" }, loaded))).toContain("Chọn hồ sơ nguồn ở tab Nạp dữ liệu");
		expect(renderDialog(Object.assign({ tab: "map", source: "3" }, loaded))).toContain("Đang tải bảng đối chiếu");
		const mappings = pi.mapMappings({ rows: [{ id: 1, machineId: "15", employee: 101, code: "NV001", name: "Nguyen A", effective: "2026-01-01" }, { id: 2, machineId: "16", employee: 101 }] });
		const text = renderDialog(Object.assign({ tab: "map", source: "3", mapFor: "3", mappings, mapEdits: { m1: { expiration: "2025-01-01" }, m2: { inactive: true } }, mapNew: [{ key: "n1", machineId: "", device: "", employee: "" }] }, loaded));
		expect(text).toContain("Bảng đối chiếu của nguồn ZK-XUONG");
		expect(text).toContain("Hết hiệu lực trước ngày hiệu lực");
		expect(text).toContain("Thiếu mã trên máy");
		expect(text).toContain("Lưu thay đổi (3)");
		expect(text).toContain("thôi dùng khi lưu");
		expect(text).toContain("Hoàn tác");
		expect(text).toContain("{Sửa các dòng báo lỗi trước khi lưu}");
	});
});

describe("nút Nạp chấm công ở màn Chấm công", () => {
	// Thứ tự useState trong AttendanceView: data, loaded, query, chip, limit, sel, detail, tab, excQuery, excLimit, edit, job, punchDlg
	const KEYS = ["data", "loaded", "query", "chip", "limit", "sel", "detail", "tab", "excQuery", "excLimit", "edit", "job", "punchDlg"];
	function renderAttendance(state, a) {
		queue.length = 0;
		KEYS.forEach((k) => queue.push(state[k]));
		const tree = att.default({ app: a || app() });
		queue.length = 0;
		return walk(tree, []).join(" | ");
	}
	const data = {
		period: { id: "7", code: "202610", start: "2026-10-01", end: "2026-10-31", paygroupCode: "VP", stdDays: 26, mode: "E" },
		days: [{ date: "2026-10-01", dow: 4, day: 1, type: "N" }],
		rows: [{ employee: "101", code: "NV001", name: "Nguyen A", cells: [{ s: "X", k: "W", v: 1 }], totals: { work_days: 1, std_days: 26 }, open: 0, source: "docs" }],
		exceptions: [], counts: { open: 0, info: 0, byType: {} }, stats: {}, steps: [{ key: "collect", state: "current" }], canEdit: true, legend: { items: [] },
	};

	test("HR thấy nút, mở hộp thoại; kế toán không thấy", () => {
		expect(renderAttendance({ data })).toContain("Nạp chấm công");
		expect(renderAttendance({ data, punchDlg: true })).toContain("Nạp chấm công từ máy chấm công");
		expect(renderAttendance({ data: Object.assign({}, data, { canEdit: false }) })).not.toContain("Nạp chấm công");
		// Chưa tải được bảng công: quyết định theo vai trò trong bootstrap
		expect(renderAttendance({ loaded: true, punchDlg: true })).toContain("Nạp chấm công từ máy chấm công");
		expect(renderAttendance({ loaded: true }, app({ boot: { user: { role: "customrole_s4vp_accountant" }, periods: [], paygroups: [] } }))).not.toContain("Nạp chấm công");
	});
});
