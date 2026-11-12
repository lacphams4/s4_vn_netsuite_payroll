// Ô nhập của spa/payroll/ui/kit.js (docs/UI_V2.md mục "Control nhập liệu"): nạp kit.js (ESM + JSX) bằng TypeScript với
// jsx-runtime và hook giả, vẽ thành cây đối tượng rồi kiểm thuộc tính của <input> và giá trị đưa ra qua onInput.
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

// Trình duyệt giả: chỉ đủ cho nativeType() (gán type lạ thì về 'text'; ô ngày bỏ giá trị không hợp lệ)
function fakeDocument(supported) {
	return {
		createElement: () => {
			let type = "text";
			let value = "";
			return {
				setAttribute: (k, v) => {
					if (k === "type") type = supported.includes(v) ? v : "text";
				},
				get type() {
					return type;
				},
				set value(v) {
					value = type === "text" ? String(v) : "";
				},
				get value() {
					return value;
				},
			};
		},
		getElementById: () => null,
		activeElement: null,
	};
}

function loadKit(document) {
	const jsx = (type, props, key) => ({ type, props: props || {}, key });
	const hooks = { useState: (v) => [v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {} };
	const runtime = { getCurrentUser: () => ({ getPreference: () => "vi_VN" }) };
	const cache = {};
	const sandbox = { WeakMap, Object, Array, String, Number, Date, Math, JSON, RegExp, isNaN, setTimeout, clearTimeout, console };
	if (document) sandbox.document = document;
	const context = vm.createContext(sandbox);
	function load(file) {
		if (cache[file]) return cache[file].exports;
		const module = { exports: {} };
		cache[file] = module;
		const req = (name) => {
			if (name === "@uif-js/core/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
			if (name === "@uif-js/core") return hooks;
			if (name === "N/runtime") return { __esModule: true, default: runtime };
			if (name === "../lib/format.js") return load("lib/format.js");
			if (name === "../lib/i18n.js") return load("lib/i18n.js");
			throw new Error("unexpected import " + name);
		};
		vm.runInContext(`(function (module, exports, require) {${transpile(file)}\n})`, context)(module, module.exports, req);
		return module.exports;
	}
	return load("ui/kit.js");
}

// Vẽ thành phần hàm cho tới khi gặp thẻ HTML đầu tiên
function render(node) {
	let n = node;
	while (n && typeof n.type === "function") n = n.type(n.props);
	return n;
}
function findTag(node, tag) {
	if (!node || typeof node !== "object") return null;
	const n = render(node);
	if (!n) return null;
	if (n.type === tag) return n;
	const kids = [].concat(n.props && n.props.children !== undefined ? n.props.children : []);
	for (const k of kids) {
		const hit = findTag(k, tag);
		if (hit) return hit;
	}
	return null;
}
const typing = (input, value) => input.props.onInput({ element: { value } });

describe("kit DateInput", () => {
	test("trình duyệt có ô ngày: type=date, giá trị ISO, min / max ghi ra thuộc tính", () => {
		const kit = loadKit(fakeDocument(["date", "month", "time"]));
		const got = [];
		const input = render(kit.DateInput({ value: "2026-01-05", onInput: (v) => got.push(v), min: "2026-01-01", max: "2026-12-31", placeholder: "x" }));
		expect(input.type).toBe("input");
		expect(input.props).toMatchObject({ type: "date", value: "2026-01-05", min: "2026-01-01", max: "2026-12-31", title: "x" });
		expect(input.props.placeholder).toBeUndefined();
		typing(input, "2026-03-04");
		typing(input, "");
		expect(got).toEqual(["2026-03-04", ""]);
		// giá trị không phải ISO thì ô gốc để trống (trình duyệt cũng bỏ)
		expect(render(kit.DateInput({ value: "05/01/2026" })).props.value).toBe("");
	});

	test("trình duyệt không có ô ngày: ô chữ dd/mm/yyyy như cũ, gõ đủ ngày có thật thì nhận ISO", () => {
		const kit = loadKit(fakeDocument([]));
		const got = [];
		const input = render(kit.DateInput({ value: "2026-01-05", onInput: (v) => got.push(v), min: "2026-01-01" }));
		expect(input.props).toMatchObject({ type: "text", value: "05/01/2026", placeholder: "dd/mm/yyyy", inputmode: "numeric" });
		expect(input.props.min).toBeUndefined();
		for (const s of ["5/1/2026", "2026-01-05", "05/01", "31/02/2026", ""]) typing(input, s);
		expect(got).toEqual(["2026-01-05", "2026-01-05", "05/01", "31/02/2026", ""]);
	});

	test("không có document (máy chủ, kiểm thử): lùi về ô chữ", () => {
		const kit = loadKit(null);
		expect(kit.nativeType("date")).toBe(false);
		expect(render(kit.DateInput({ value: "2026-11-30" })).props.value).toBe("30/11/2026");
	});

	test("MonthInput, TimeInput và bộ đọc của ô chữ dự phòng", () => {
		const kit = loadKit(fakeDocument(["date"]));
		expect(render(kit.MonthInput({ value: "2026-11" })).props).toMatchObject({ type: "text", value: "2026-11" });
		expect(kit.readMonth("11/2026")).toBe("2026-11");
		expect(kit.readMonth("2026-3")).toBe("2026-03");
		expect(kit.readMonth("2026-13")).toBe("2026-13");
		expect(kit.readTime("8h30")).toBe("08:30");
		expect(kit.readTime("25:00")).toBe("25:00");
		const kit2 = loadKit(fakeDocument(["month", "time"]));
		expect(render(kit2.MonthInput({ value: "2026-11" })).props).toMatchObject({ type: "month", value: "2026-11" });
		expect(render(kit2.TimeInput({ value: "07:45", step: 900 })).props).toMatchObject({ type: "time", value: "07:45", step: "900" });
	});
});

describe("kit NumberInput, MoneyInput, Field", () => {
	test("có step / min thì là ô số của trình duyệt, không có thì ô chữ căn phải", () => {
		const kit = loadKit(null);
		const hours = render(kit.NumberInput({ value: "7.5", min: 0, step: 0.5 }));
		expect(hours.props).toMatchObject({ type: "number", min: "0", step: "0.5", inputmode: "decimal", value: "7.5" });
		expect(String(hours.props.class)).toContain("s4vp-r");
		const plain = render(kit.NumberInput({ value: "1,5" }));
		expect(plain.props.type).toBe("text");
		expect(plain.props.step).toBeUndefined();
	});

	test("số tiền: phân tách nghìn kiểu Việt, đọc lại được bằng toNumber", () => {
		const kit = loadKit(null);
		expect(kit.formatAmountText("15000000", 0)).toBe("15.000.000");
		expect(kit.formatAmountText("1234567,5")).toBe("1.234.567,5");
		expect(kit.formatAmountText("abc")).toBeNull();
		expect(render(kit.MoneyInput({ value: 2500000, decimals: 0 })).props).toMatchObject({ type: "text", value: "2.500.000", inputmode: "decimal" });
	});

	test("Field required có dấu *", () => {
		const kit = loadKit(null);
		const field = kit.Field({ label: "Ngày", required: true, children: "x" });
		expect(JSON.stringify(field)).toContain(" *");
		expect(JSON.stringify(kit.Field({ label: "Ngày", children: "x" }))).not.toContain(" *");
	});
});

describe("kit SearchSelect", () => {
	const options = [
		{ value: "1", label: "Nguyễn Văn An" },
		{ value: "2", label: "Trần Thị Bình" },
		{ value: "3", label: "Lê Đức Anh" },
		{ value: "40", label: "Phòng Kế toán" },
	];

	test("lọc không phân biệt dấu, mọi từ phải khớp, khớp cả mã", () => {
		const kit = loadKit(null);
		expect(kit.filterOptions(options, "TRAN binh").items.map((o) => o.value)).toEqual(["2"]);
		expect(kit.filterOptions(options, "an").items.map((o) => o.value)).toEqual(["1", "2", "3", "40"]);
		expect(kit.filterOptions(options, "duc anh").items.map((o) => o.value)).toEqual(["3"]);
		expect(kit.filterOptions(options, "ke toan").items.map((o) => o.value)).toEqual(["40"]);
		expect(kit.filterOptions(options, "40").items.map((o) => o.value)).toEqual(["40"]);
		expect(kit.filterOptions(options, "").total).toBe(4);
		expect(kit.filterOptions(options, "zzz")).toEqual({ items: [], total: 0 });
	});

	test("giới hạn số mục hiện nhưng vẫn đếm đủ", () => {
		const kit = loadKit(null);
		const many = Array.from({ length: 500 }, (_, i) => ({ value: String(i), label: `Mục ${i}` }));
		const r = kit.filterOptions(many, "muc", 200);
		expect(r.items.length).toBe(200);
		expect(r.total).toBe(500);
	});

	test("nút hiện nhãn mục đang chọn; AutoSelect chỉ dùng ô tìm khi danh sách dài", () => {
		const kit = loadKit(null);
		const btn = findTag(kit.SearchSelect({ value: "2", options, ariaLabel: "Nhân viên" }), "button");
		expect(btn.props["aria-haspopup"]).toBe("listbox");
		expect(btn.props.title).toBe("Trần Thị Bình");
		expect(render(kit.AutoSelect({ value: "1", options })).type).toBe("select");
		const long = Array.from({ length: 16 }, (_, i) => ({ value: String(i), label: `Mục ${i}` }));
		expect(render(kit.AutoSelect({ value: "1", options: long })).type).toBe("div");
	});
});

describe("kit Select có nhóm và tooltip từng mục (ô chọn kỳ, lib/periods.js)", () => {
	const grouped = [
		{ value: "21", label: "Tháng 10/2027", title: "Mã kỳ SAOMAI-202710", group: "SAOMAI" },
		{ value: "20", label: "Tháng 9/2027", title: "Mã kỳ SAOMAI-202709", group: "SAOMAI" },
		{ value: "30", label: "Tháng 10/2027", title: "Mã kỳ XN-202710", group: "SAOMAI-XN" },
	];

	test("mục cùng nhóm gom vào optgroup, option có title; không có group thì như cũ", () => {
		const kit = loadKit(null);
		const sel = render(kit.Select({ value: "20", options: grouped }));
		const kids = [].concat(sel.props.children);
		expect(kids.map((k) => k.type)).toEqual(["optgroup", "optgroup"]);
		expect(kids.map((k) => k.props.label)).toEqual(["SAOMAI", "SAOMAI-XN"]);
		const first = [].concat(kids[0].props.children);
		expect(first.map((o) => o.props.value)).toEqual(["21", "20"]);
		expect(first[1].props).toMatchObject({ title: "Mã kỳ SAOMAI-202709", selected: "selected" });
		const plain = render(kit.Select({ value: "1", options: [{ value: "1", label: "A" }] }));
		expect([].concat(plain.props.children).map((k) => k.type)).toEqual(["option"]);
	});

	test("ô tìm của SearchSelect khớp cả mã kỳ (title) và tên nhóm", () => {
		const kit = loadKit(null);
		expect(kit.filterOptions(grouped, "xn-202710").items.map((o) => o.value)).toEqual(["30"]);
		expect(kit.filterOptions(grouped, "saomai thang 9").items.map((o) => o.value)).toEqual(["20"]);
	});
});
