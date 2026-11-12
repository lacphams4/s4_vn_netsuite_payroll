// Hàm thuần dùng chung của SPA: spa/payroll/lib/periods.js (ô chọn kỳ theo công ty con) và spa/payroll/lib/leave.js (mục Số dư
// phép của màn chấm công cũ). Nạp ESM bằng TypeScript sang CommonJS; N/runtime giả trả ngôn ngữ vi.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const LIB = path.resolve(__dirname, "..", "..", "spa", "payroll", "lib");
const cache = {};

function load(file) {
	if (cache[file]) return cache[file];
	const source = fs.readFileSync(path.join(LIB, file), "utf8");
	const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
	const module = { exports: {} };
	cache[file] = module.exports;
	const req = (name) => {
		if (name === "N/runtime") return { __esModule: true, default: { getCurrentUser: () => ({ getPreference: () => "vi_VN" }) } };
		if (name.startsWith("./")) return load(name.slice(2));
		throw new Error(`unexpected import ${name}`);
	};
	vm.runInNewContext(out, { module, exports: module.exports, require: req, WeakMap, Date, Number, String, Math, Object, Array, Set, JSON }, { filename: file });
	cache[file] = module.exports;
	return module.exports;
}

const P = load("periods.js");
const L = load("leave.js");

// Hai công ty: 13 dùng nhóm DEFAULT (không gắn công ty), 14 có hai nhóm riêng; 15 không có nhóm riêng
const boot = {
	paygroups: [
		{ id: "1", code: "DEFAULT", description: "Nhóm lương mặc định (tháng)", subsidiary: "" },
		{ id: "2", code: "SAOMAI", description: "Sao Mai văn phòng", subsidiary: "14" },
		{ id: "3", code: "SAOMAI-XN", description: "Sao Mai xưởng", subsidiary: "14" },
	],
	periods: [
		{ id: "10", code: "202709", paygroup: "1", start: "2027-09-01", end: "2027-09-30", taxMonth: "202709", status: "O" },
		{ id: "11", code: "202710", paygroup: "1", start: "2027-10-01", end: "2027-10-31", taxMonth: "202710", status: "O", attStatus: "L" },
		{ id: "20", code: "SAOMAI-202709", paygroup: "2", start: "2027-09-01", end: "2027-09-30", taxMonth: "202709", status: "C" },
		{ id: "21", code: "SAOMAI-202710", paygroup: "2", start: "2027-10-01", end: "2027-10-31", taxMonth: "202710", status: "O" },
		{ id: "30", code: "XN-202710", paygroup: "3", start: "2027-10-01", end: "2027-10-31", taxMonth: "202710", status: "O" },
		{ id: "9", code: "OLD", paygroup: "", start: "2027-08-01", end: "2027-08-31", status: "O" },
	],
};

describe("lib/periods: kỳ theo công ty con", () => {
	test("nhóm lương: nhóm của công ty; không có nhóm riêng thì nhóm dùng chung; chưa chọn công ty thì mọi nhóm", () => {
		expect(P.groupsForSubsidiary(boot, "14").map((g) => g.code)).toEqual(["SAOMAI", "SAOMAI-XN"]);
		expect(P.groupsForSubsidiary(boot, "13").map((g) => g.code)).toEqual(["DEFAULT"]);
		expect(P.groupsForSubsidiary(boot, "15").map((g) => g.code)).toEqual(["DEFAULT"]);
		expect(P.groupsForSubsidiary(boot, "")).toHaveLength(3);
	});

	test("kỳ của công ty, giảm dần; kỳ không gắn nhóm đi cùng nhóm dùng chung; chưa có nhóm thì mọi kỳ", () => {
		expect(P.periodsForSubsidiary(boot, "13").map((p) => p.id)).toEqual(["11", "10", "9"]);
		expect(P.periodsForSubsidiary(boot, "14").map((p) => p.code)).toEqual(["SAOMAI-202710", "XN-202710", "SAOMAI-202709"]);
		expect(P.periodsForSubsidiary({ periods: boot.periods }, "14")).toHaveLength(6);
	});

	test("nhãn dễ đọc, khóa công / kỳ đóng có 🔒, mã kỳ ở tooltip", () => {
		const p = boot.periods[1];
		expect(P.periodLabel(p, { lang: "vi" })).toBe("Tháng 10/2027 (01/10 - 31/10)");
		expect(P.periodLabel(p, { lang: "vi", lock: "att" })).toBe("Tháng 10/2027 (01/10 - 31/10) 🔒");
		expect(P.periodLabel(p, { lang: "en" })).toBe("October 2027 (01/10 - 31/10)");
		expect(P.periodLabel(boot.periods[2], { lang: "vi", lock: "status" })).toMatch(/🔒$/);
		expect(P.periodTitle(p, { lang: "vi", lock: "att" })).toBe("Mã kỳ 202710 - công đã khóa");
		// Không có tháng thuế: theo ngày bắt đầu; khác năm thì đủ ngày
		expect(P.periodLabel({ code: "X", start: "2027-12-26", end: "2028-01-25" }, { lang: "vi" })).toBe("Tháng 12/2027 (26/12/2027 - 25/01/2028)");
		expect(P.periodLabel({ code: "X" }, { lang: "vi" })).toBe("X");
	});

	test("một nhóm: không có group; nhiều nhóm: gom theo nhóm (thứ tự nhóm, trong nhóm giảm dần) hoặc tiền tố mã nhóm", () => {
		const one = P.periodOptions(boot, "13", { lang: "vi" });
		expect(one.map((o) => o.value)).toEqual(["11", "10", "9"]);
		expect(one.every((o) => o.group === undefined)).toBe(true);
		expect(one[0]).toMatchObject({ label: "Tháng 10/2027 (01/10 - 31/10)", title: "Mã kỳ 202710" });
		const many = P.periodOptions(boot, "14", { lang: "vi" });
		expect(many.map((o) => o.value)).toEqual(["21", "20", "30"]);
		expect(many.map((o) => o.group)).toEqual(["SAOMAI - Sao Mai văn phòng", "SAOMAI - Sao Mai văn phòng", "SAOMAI-XN - Sao Mai xưởng"]);
		const prefixed = P.periodOptions(boot, "14", { lang: "vi", prefixGroup: true });
		expect(prefixed[2].label).toBe("SAOMAI-XN · Tháng 10/2027 (01/10 - 31/10)");
		expect(prefixed[2].group).toBeUndefined();
		// Lọc còn một nhóm thì không gom
		const open = P.periodOptions(boot, "14", { lang: "vi", filter: (p) => p.paygroup === "2" });
		expect(open.every((o) => o.group === undefined)).toBe(true);
	});

	test("kỳ mặc định: chứa hôm nay (ưu tiên kỳ chưa đóng), rồi kỳ mở gần nhất đã bắt đầu, rồi kỳ mở sắp tới", () => {
		const mine = P.periodsForSubsidiary(boot, "14");
		expect(P.defaultPeriodId(mine, "2027-10-15")).toBe("21");
		expect(P.currentPeriodId(mine, "2027-09-15")).toBe("");
		expect(P.defaultPeriodId(mine, "2027-09-15")).toBe("20");
		expect(P.defaultPeriodId(mine, "2027-12-01")).toBe("21");
		expect(P.defaultPeriodId(mine, "2027-01-01")).toBe("21");
		expect(P.defaultPeriodId([], "2027-01-01")).toBe("");
	});
});

describe("lib/leave: mục Số dư phép", () => {
	test("năm chọn được: năm nay và năm sau", () => {
		expect(L.leaveYearOptions("2026-11-12").map((o) => o.value)).toEqual(["2026", "2027"]);
	});

	test("dòng lưới có mã, tên nhân viên và loại nghỉ để lọc nhanh; hạn phép chuyển", () => {
		const rows = L.balanceRows(
			[{ employee: "201", leave_type: "LT1", leaveTypeCode: "AL", carried: 3, carry_expiry: "2027-03-31" }, { employee: "999", leave_type: "LT1", carried: 0 }],
			[{ employee: "201", code: "E1035", name: "Nguyễn Văn A" }],
			[{ id: "LT1", code: "AL", name: "Phép năm" }]
		);
		expect(rows[0]).toMatchObject({ code: "E1035", name: "Nguyễn Văn A", leaveTypeCode: "AL", leaveTypeName: "Phép năm", carryExpiry: "2027-03-31" });
		expect(rows[1]).toMatchObject({ code: "", leaveTypeCode: "AL", carryExpiry: "" });
	});

	test("tooltip ô Chuyển: có hạn / không hạn / không có phép chuyển", () => {
		const t = { carryTip: (d) => `hạn ${d}`, carryTipNoExpiry: "không hạn" };
		expect(L.carryTip({ carried: 2, carryExpiry: "2027-03-31" }, t)).toBe("hạn 31/03/2027");
		expect(L.carryTip({ carried: 2, carryExpiry: "" }, t)).toBe("không hạn");
		expect(L.carryTip({ carried: 0 }, t)).toBe("");
	});
});
