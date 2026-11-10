// Giữ độ phủ đa ngôn ngữ của giao diện: chạy tools/check_i18n.mjs trên spa/payroll và kiểm cơ chế chọn chữ của lib/i18n.js.
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(ROOT, "tools", "check_i18n.mjs");

function runTool(args) {
	const r = spawnSync(process.execPath, [TOOL].concat(args || []), { cwd: ROOT, encoding: "utf8" });
	return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function checkSource(source) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s4vp-i18n-"));
	const file = path.join(dir, "sample.js");
	fs.writeFileSync(file, source);
	try {
		const r = runTool(["--json", file]);
		return { status: r.status, issues: JSON.parse(r.out).issues };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// Nạp lib/i18n.js (ESM, import N/runtime) với tùy chọn LANGUAGE giả
function loadI18n(preference) {
	const source = fs.readFileSync(path.join(ROOT, "spa", "payroll", "lib", "i18n.js"), "utf8");
	const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
	const runtime = {
		getCurrentUser: () => ({
			getPreference: () => {
				if (preference instanceof Error) throw preference;
				return preference;
			},
		}),
	};
	const module = { exports: {} };
	vm.runInNewContext(outputText, { module, exports: module.exports, require: (name) => (name === "N/runtime" ? { __esModule: true, default: runtime } : require(name)), WeakMap, Object, Array, String });
	return module.exports;
}

describe("tools/check_i18n.mjs", () => {
	test("giao diện spa/payroll đủ bản vi và en", () => {
		const r = runTool([]);
		if (r.status !== 0) throw new Error(`Bảng chữ chưa đủ hai ngôn ngữ, chạy: node tools/check_i18n.mjs\n${r.out}`);
		expect(r.out).toMatch(/0 lỗi/);
	});

	test("báo khóa thiếu ở cả hai chiều, kể cả khóa con", () => {
		const r = checkSource("const TEXT = {vi: {a: 'Một', g: {x: 'Hai', y: 'Ba'}}, en: {a: 'One', g: {x: 'Two'}, extra: 'Only en'}};");
		expect(r.status).toBe(1);
		expect(r.issues.map((i) => `${i.type} ${i.key}`).sort()).toEqual(["missing-en TEXT.g.y", "missing-vi TEXT.extra"]);
	});

	test("khóa thừa hưởng qua Object.assign({}, TEXT.vi, ...) tính là chưa dịch", () => {
		const r = checkSource("const TEXT = {vi: {a: 'Một', b: 'Hai'}, en: {}};\nTEXT.en = Object.assign({}, TEXT.vi, {a: 'One'});");
		expect(r.issues.map((i) => `${i.type} ${i.key}`)).toEqual(["missing-en TEXT.b"]);
	});

	test("báo chữ Việt trong bản en và chữ Việt viết cứng ngoài bảng chữ", () => {
		const r = checkSource("const TEXT = {vi: {a: 'Một', f: (n) => `${n} dòng`}, en: {a: 'Một', f: (n) => `${n} dòng`}};\nconst label = 'Tạo hồ sơ lương';\n// Chú thích tiếng Việt không tính\nconst keep = 'Nguyễn Văn A'; // i18n-ok");
		expect(r.issues.map((i) => i.type).sort()).toEqual(["hardcoded", "vi-in-en", "vi-in-en"]);
	});

	test("cặp chữ viết tại chỗ {vi, en} phải đủ hai bản", () => {
		const r = checkSource("const cols = [{key: 'a', vi: 'Mã', en: 'Code'}, {key: 'b', vi: 'Tên'}];");
		expect(r.issues.map((i) => i.type)).toEqual(["missing-en"]);
	});
});

describe("spa/payroll/lib/i18n.js", () => {
	const TEXT = {
		vi: { a: "Một", only: "Chỉ có bản Việt", g: { x: "Hai", y: "Ba", list: ["v"] }, f: () => "vi" },
		en: { a: "One", g: { x: "Two", list: ["e1", "e2"] }, f: () => "en", enOnly: "English only" },
		ja: { a: "ichi", g: { y: "san" } },
	};

	test("language() trả mã 2 chữ thường; không đọc được thì vi, rỗng thì en", () => {
		expect(loadI18n("vi_VN").language()).toBe("vi");
		expect(loadI18n("en_US").language()).toBe("en");
		expect(loadI18n("FR_CA").language()).toBe("fr");
		expect(loadI18n("ja_JP").language()).toBe("ja");
		expect(loadI18n("").language()).toBe("en");
		expect(loadI18n(new Error("no session")).language()).toBe("vi");
	});

	test("pick: vi dùng bản Việt, en bù khóa thiếu theo chiều sâu từ bản Việt", () => {
		const vi = loadI18n("vi_VN").pick(TEXT);
		expect(vi.a).toBe("Một");
		expect(vi.g).toEqual({ x: "Hai", y: "Ba", list: ["v"] });
		expect(vi.enOnly).toBe("English only");
		const en = loadI18n("en_US").pick(TEXT);
		expect(en.a).toBe("One");
		expect(en.only).toBe("Chỉ có bản Việt");
		expect(en.g).toEqual({ x: "Two", y: "Ba", list: ["e1", "e2"] });
		expect(en.f()).toBe("en");
	});

	test("pick: ngôn ngữ thứ ba lùi về en rồi vi; ngôn ngữ chưa có bảng dùng bản en", () => {
		const ja = loadI18n("ja_JP").pick(TEXT);
		expect(ja.a).toBe("ichi");
		expect(ja.g).toEqual({ x: "Two", y: "san", list: ["e1", "e2"] });
		expect(ja.only).toBe("Chỉ có bản Việt");
		const fr = loadI18n("fr_FR");
		expect(fr.pick(TEXT).a).toBe("One");
		expect(fr.pick({ vi: { a: "Một" } }).a).toBe("Một");
		expect(fr.pick(null)).toEqual({});
		expect(TEXT.en.g.y).toBeUndefined();
	});

	test("chữ từ máy chủ: bản Việt chỉ khi người dùng đặt tiếng Việt", () => {
		const fr = loadI18n("fr_FR");
		expect(fr.serverText("Locked", "Đã khóa")).toBe("Locked");
		expect(fr.serverText("", "Đã khóa")).toBe("Đã khóa");
		expect(fr.serverLanguage()).toBe("en");
		expect(fr.localized({ vi: "Mã NV", en: "Employee ID" })).toBe("Employee ID");
		expect(fr.localized({ vi: "Mã NV" })).toBe("Mã NV");
		const vi = loadI18n("vi_VN");
		expect(vi.serverText("Locked", "Đã khóa")).toBe("Đã khóa");
		expect(vi.serverText("Locked", "")).toBe("Locked");
		expect(vi.serverLanguage()).toBe("vi");
		expect(vi.localized({ vi: "Mã NV", en: "Employee ID" })).toBe("Mã NV");
	});
});
