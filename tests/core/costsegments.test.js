// Phân đoạn khi ghi lương vào sổ cái: phòng ban theo đích phân bổ (dòng bảng tỷ lệ, dòng nhập tay, phần sản lượng) và
// tài khoản chi phí theo đích (VP102080, core/CostAccountRules + CostAllocationBuilder.resolveAccount).
const { core, provider, Defaults } = require("./helpers");
const Resolver = core("AllocationSourceResolver");
const Alloc = core("ProjectCostAllocator");
const Builder = core("CostAllocationBuilder");
const Rules = core("CostAccountRules");
const Engine = core("PayrollEngine");

const PS = "2026-10-01";
const PE = "2026-10-31";
const total = (lines) => lines.reduce((s, l) => s + l.amount, 0);
const base = { employeeAccount: "", employeeSub: "D1", defaultAccount: "642", defaultSub: "D1" };

describe("Phòng ban của dòng phân bổ", () => {
	const versions = [{ versionNbr: 1, status: "A", effectiveDate: "2026-01-01", lines: [{ sub: "D1", percent: 60 }, { sub: "D2", percent: 40 }] }];

	test("dòng bảng tỷ lệ có phòng ban riêng: 60% D1, 40% D2 cho cả lương và BH doanh nghiệp", () => {
		const targets = Resolver.resolve({ method: "F", periodStart: PS, periodEnd: PE, versions, defaultBranch: "HCM" });
		expect(targets.map((t) => [t.sub, t.branch, t.weight])).toEqual([["D1", "HCM", 60], ["D2", "HCM", 40]]);
		const res = Builder.build({ grossPay: 10000001, employerInsurance: 2150000, earnings: [], targets, accounts: base });
		expect(res.map((r) => [r.component, r.sub, r.amount, r.account])).toEqual([
			["GROSS", "D1", 6000001, "642"], ["GROSS", "D2", 4000000, "642"], ["ERINS", "D1", 1290000, "642"], ["ERINS", "D2", 860000, "642"],
		]);
		expect(total(res)).toBe(10000001 + 2150000);
	});

	test("dòng bảng tỷ lệ không khai phòng ban: về phòng ban nhân viên, dòng đích không có trường sub", () => {
		const v = [{ versionNbr: 1, status: "A", effectiveDate: "2026-01-01", lines: [{ project: "A", sub: "", percent: 50 }, { project: "B", percent: 50 }] }];
		const targets = Resolver.resolve({ method: "F", periodStart: PS, periodEnd: PE, versions: v });
		expect(targets.every((t) => !("sub" in t))).toBe(true);
		expect(Alloc.allocate(targets, [{ component: "GROSS", amount: 100 }]).every((l) => !("sub" in l))).toBe(true);
		const res = Builder.build({ grossPay: 100, employerInsurance: 20, earnings: [], targets, accounts: base });
		expect(res.map((r) => r.sub)).toEqual(["D1", "D1", "D1", "D1"]);
	});

	test("cùng dự án, khác phòng ban: không gộp; chế độ D chia theo ngày vẫn giữ phòng ban", () => {
		const v = [
			{ versionNbr: 1, status: "S", effectiveDate: "2026-09-01", expirationDate: "2026-10-15", lines: [{ project: "A", sub: "D1", percent: 100 }] },
			{ versionNbr: 2, status: "A", effectiveDate: "2026-10-16", lines: [{ project: "A", sub: "D1", percent: 50 }, { project: "A", sub: "D2", percent: 50 }] },
		];
		expect(Resolver.validateLines(v[1].lines, true)).toEqual([]);
		const targets = Resolver.resolve({ method: "F", versionMode: "D", periodStart: PS, periodEnd: PE, versions: v });
		const res = Builder.build({ grossPay: 31000000, employerInsurance: 0, earnings: [], targets, accounts: base });
		expect(res.map((r) => [r.version, r.sub, r.amount])).toEqual([[1, "D1", 15000000], [2, "D1", 8000000], [2, "D2", 8000000]]);
	});

	test("validateLines: dòng chỉ có phòng ban hợp lệ; trùng cả phòng ban mới là trùng", () => {
		expect(Resolver.validateLines([{ sub: "D2", percent: 100 }], true)).toEqual([]);
		expect(Resolver.validateLines([{ project: "A", sub: "D1", percent: 50 }, { project: "A", sub: "d1", percent: 50 }], true).length).toBe(1);
		expect(Resolver.validateLines([{ percent: 100 }], true).length).toBe(1);
	});

	test("dòng nhập tay có phòng ban: đi thẳng vào phòng ban đó, phần còn lại và BH về phòng ban nhân viên", () => {
		const res = Builder.build({
			grossPay: 10000000, employerInsurance: 2000000, defaultBranch: "HCM", accounts: base,
			earnings: [
				{ earningType: "LUONG", amount: 9000000, source: "S", quantitySource: "B" },
				{ earningType: "THUONG", amount: 700000, source: "M", sub: "D2" },
				{ earningType: "THUONG", amount: 300000, source: "M", branch: "HN", sub: "D3" },
			],
			targets: [{ project: "", source: "D", weight: 100 }],
		});
		expect(res.map((r) => [r.component, r.source, r.branch, r.sub, r.amount])).toEqual([
			["GROSS", "S", "HCM", "D2", 700000], ["GROSS", "S", "HN", "D3", 300000], ["GROSS", "D", "HCM", "D1", 9000000], ["ERINS", "D", "HCM", "D1", 2000000],
		]);
		expect(total(res)).toBe(12000000);
	});

	test("dòng nhập tay không khai phòng ban: như trước, không tách đích riêng", () => {
		const res = Builder.build({
			grossPay: 1000, employerInsurance: 0, accounts: base,
			earnings: [{ earningType: "THUONG", amount: 1000, source: "M", sub: "", project: "P9" }], targets: [{ project: "", source: "D", weight: 100 }],
		});
		expect(res).toEqual([expect.objectContaining({ source: "D", project: "", sub: "D1", amount: 1000 })]);
	});

	test("phần sản lượng có phòng ban riêng (nếu nguồn cấp) đi theo phòng ban đó", () => {
		const res = Builder.build({
			grossPay: 900000, employerInsurance: 0, accounts: base,
			earnings: [{ earningType: "SANPHAM", amount: 900000, source: "S", quantitySource: "O", rateTable: "T1" }],
			outputShares: [{ rateTable: "T1", workCenter: "W1", sub: "D5", amount: 1 }, { rateTable: "T1", workCenter: "W1", amount: 2 }],
			targets: [{ project: "", source: "D", weight: 100 }],
		});
		expect(res.map((r) => [r.workCenter, r.sub, r.amount])).toEqual([["W1", "D5", 300000], ["W1", "D1", 600000]]);
	});

	test("nhân viên có tài khoản riêng: mặc định là phòng ban của hồ sơ; phòng ban riêng của dòng vẫn thắng", () => {
		const acc = { employeeAccount: "6411", employeeSub: "KD", defaultAccount: "642", defaultSub: "QL" };
		expect(Builder.resolveAccount({}, acc)).toEqual({ account: "6411", sub: "KD" });
		expect(Builder.resolveAccount({ sub: "D2" }, acc)).toEqual({ account: "6411", sub: "D2" });
		// sub khai kèm bảng work center (dạng cũ) chỉ dùng khi dòng không có phòng ban riêng
		const wc = Object.assign({ workCenters: { W1: { account: "622", sub: "SX" } } }, acc);
		expect(Builder.resolveAccount({ workCenter: "W1" }, wc)).toEqual({ account: "622", sub: "SX" });
		expect(Builder.resolveAccount({ workCenter: "W1", sub: "D2" }, wc)).toEqual({ account: "622", sub: "D2" });
	});
});

describe("Tài khoản chi phí theo đích (VP102080)", () => {
	const rec = (id, target_type, target, account, extra) => Object.assign(
		{ id: String(id), isInactive: false, subsidiary: null, target_type, project: null, work_center: null, department: null, labor_type: null, account, effective: null },
		{ [{ P: "project", W: "work_center", D: "department" }[target_type]]: target }, extra
	);

	test("buildMaps: ba bảng theo loại đích; bỏ bản ghi inactive, thiếu đích, thiếu tài khoản, loại lạ", () => {
		const maps = Rules.buildMaps([
			rec(1, "W", "10", "6221"), rec(2, "P", "20", "6321"), rec(3, "D", "30", "6411"),
			rec(4, "W", "11", "9999", { isInactive: true }), rec(5, "P", null, "9999"), rec(6, "D", "31", ""), rec(7, "X", "1", "9999"),
		], { subsidiary: "1", periodEnd: PE });
		expect(maps).toEqual({
			workCenters: { 10: { account: "6221", byLabor: {} } }, projects: { 20: { account: "6321", byLabor: {} } }, departments: { 30: { account: "6411", byLabor: {} } },
		});
		expect(Rules.buildMaps(null)).toEqual({ workCenters: {}, projects: {}, departments: {} });
	});

	test("thứ tự ưu tiên: class -> dự án -> phòng ban của dòng -> hồ sơ -> phòng ban nhân viên -> mặc định", () => {
		const maps = Rules.buildMaps([rec(1, "W", "10", "6221"), rec(2, "P", "20", "6321"), rec(3, "D", "30", "6411"), rec(4, "D", "D1", "6271")], {});
		const acc = Object.assign({}, base, maps);
		const account = (line, a) => Builder.resolveAccount(line, a || acc).account;
		expect(account({ workCenter: "10", project: "20", sub: "30" })).toBe("6221");
		expect(account({ project: "20", sub: "30" })).toBe("6321");
		expect(account({ sub: "30" })).toBe("6411");
		const withProfile = Object.assign({}, acc, { employeeAccount: "6422" });
		expect(account({ sub: "30" }, withProfile)).toBe("6411");
		expect(account({ sub: "99" }, withProfile)).toBe("6422");
		expect(account({}, withProfile)).toBe("6422");
		// không có tài khoản hồ sơ: phòng ban của nhân viên (D1) có bản ghi thì dùng, không thì mặc định
		expect(Builder.resolveAccount({}, acc)).toEqual({ account: "6271", sub: "D1" });
		expect(Builder.resolveAccount({}, Object.assign({}, acc, { defaultSub: "D9" }))).toEqual({ account: "642", sub: "D9" });
		// dòng có phòng ban riêng không có bản ghi: không mượn bản ghi của phòng ban nhân viên
		expect(Builder.resolveAccount({ sub: "99" }, acc)).toEqual({ account: "642", sub: "99" });
	});

	test("loại lao động: bản ghi đúng loại trước, rồi bản ghi mọi loại; chỉ có bản ghi loại khác thì bỏ qua", () => {
		const maps = Rules.buildMaps([rec(1, "P", "20", "6321"), rec(2, "P", "20", "6322", { labor_type: "C" }), rec(3, "P", "21", "6323", { labor_type: "E" })], {});
		const account = (line, laborType) => Builder.resolveAccount(line, Object.assign({ laborType }, base, maps)).account;
		expect(account({ project: "20" }, "C")).toBe("6322");
		expect(account({ project: "20" }, "E")).toBe("6321");
		expect(account({ project: "20" })).toBe("6321");
		expect(account({ project: "21" }, "E")).toBe("6323");
		expect(account({ project: "21" }, "C")).toBe("642");
	});

	test("công ty con cụ thể thắng dùng chung; bản ghi của công ty con khác bị bỏ", () => {
		const records = [rec(9, "W", "10", "6221"), rec(2, "W", "10", "6222", { subsidiary: "5" }), rec(3, "W", "10", "6223", { subsidiary: "6" })];
		expect(Rules.buildMaps(records, { subsidiary: "5" }).workCenters["10"].account).toBe("6222");
		expect(Rules.buildMaps(records, { subsidiary: 6 }).workCenters["10"].account).toBe("6223");
		expect(Rules.buildMaps(records, { subsidiary: "7" }).workCenters["10"].account).toBe("6221");
		expect(Rules.buildMaps(records, {}).workCenters["10"].account).toBe("6221");
		// công ty con cụ thể thắng cả khi bản ghi dùng chung hiệu lực muộn hơn
		const dated = [rec(1, "W", "10", "6221", { effective: "2026-10-01" }), rec(2, "W", "10", "6222", { subsidiary: "5", effective: "2026-01-01" })];
		expect(Rules.buildMaps(dated, { subsidiary: "5", periodEnd: PE }).workCenters["10"].account).toBe("6222");
	});

	test("ngày hiệu lực: bản ghi muộn nhất không sau ngày cuối kỳ; không ngày xếp trước; bằng nhau lấy id lớn", () => {
		const records = [
			rec(1, "D", "30", "6411"), rec(2, "D", "30", "6412", { effective: "2026-07-01" }), rec(3, "D", "30", "6413", { effective: "2026-10-31" }),
			rec(4, "D", "30", "6414", { effective: "2026-11-01" }),
		];
		const at = (periodEnd) => Rules.buildMaps(records, { periodEnd }).departments["30"].account;
		expect(at("2026-06-30")).toBe("6411");
		expect(at("2026-09-30")).toBe("6412");
		expect(at(PE)).toBe("6413");
		expect(at("2026-11-30")).toBe("6414");
		expect(Rules.buildMaps([rec(1, "D", "30", "A"), rec(2, "D", "30", "B")], {}).departments["30"].account).toBe("B");
	});

	test("activeAccounts: bản ghi trỏ tới tài khoản không còn dùng được bị bỏ qua, rơi về mức kế tiếp", () => {
		const records = [rec(1, "P", "20", "6321"), rec(2, "D", "30", "6411")];
		const maps = Rules.buildMaps(records, { activeAccounts: ["6411"] });
		expect(maps.projects).toEqual({});
		expect(Builder.resolveAccount({ project: "20", sub: "30" }, Object.assign({}, base, maps))).toEqual({ account: "6411", sub: "30" });
	});

	test("bất biến: tổng phân bổ = gross + BH doanh nghiệp khi có đủ phòng ban riêng và tài khoản theo đích", () => {
		const maps = Rules.buildMaps([rec(1, "W", "W1", "6221"), rec(2, "P", "A", "6321"), rec(3, "D", "D2", "6411")], {});
		const versions = [{ versionNbr: 1, status: "A", effectiveDate: "2026-01-01", lines: [{ project: "A", sub: "D1", percent: 33.33 }, { project: "B", sub: "D2", percent: 33.33 }, { workCenter: "W1", percent: 33.34 }] }];
		const targets = Resolver.resolve({ method: "F", periodStart: PS, periodEnd: PE, versions });
		const res = Builder.build({
			grossPay: 23456789, employerInsurance: 4321987, accounts: Object.assign({}, base, maps), targets,
			earnings: [{ earningType: "LUONG", amount: 22222222, source: "S" }, { earningType: "THUONG", amount: 1234567, source: "M", sub: "D2" }],
		});
		expect(total(res)).toBe(23456789 + 4321987);
		expect(total(res.filter((r) => r.component === "ERINS"))).toBe(4321987);
		expect(res.map((r) => [r.component, r.project, r.workCenter, r.sub, r.account])).toEqual([
			["GROSS", "", "", "D2", "6411"],
			["GROSS", "A", "", "D1", "6321"], ["GROSS", "B", "", "D2", "6411"], ["GROSS", "", "W1", "D1", "6221"],
			["ERINS", "A", "", "D1", "6321"], ["ERINS", "B", "", "D2", "6411"], ["ERINS", "", "W1", "D1", "6221"],
		]);
	});
});

describe("PayrollEngine: phòng ban và tài khoản theo đích đi tới allocations", () => {
	const types = Defaults.earningTypes.concat([{ code: "PCCT", taxTreatment: "T", category: "A", isOvertime: false, isActive: true }]);
	const ctx = {
		period: { start: PS, end: PE, frequency: "M", taxMonth: "202610", isLastInTaxMonth: true, standardWorkDays: 26 },
		settings: {
			standardHoursPerDay: 8, unionFundApplicable: true, defaultRegion: "I", accrual13Basis: "P", accrual13Months: 12, allocationMethod: "F", allocationFallback: "D",
			allocationVersionMode: "E", payGroupCode: "DEFAULT", leavePayoutEarningType: "TRAPHEP", ruleSetup: { baseEarningType: "LUONG", contractorEarningType: "PHIDV", allowanceEarningType: "PHUCAP" },
		},
		provider: provider(), earningTypes: types, rules: [], benefitPackages: {},
	};
	const emp = (over) => Object.assign({
		employee: "1", code: "E001", employmentType: "E", salaryType: "M", pitMethod: "P", region: "I", isActive: true,
		compensation: { baseSalary: 30000000, insuranceWage: 30000000 }, dependents: [], line: {}, defaults: { project: "", branch: "HCM" },
		accounts: { employeeAccount: "", employeeSub: "D1", defaultAccount: "6421", defaultSub: "D1", workCenters: {}, projects: {} },
	}, over);

	test("không khai đích riêng, không có cost_account: mọi dòng về phòng ban nhân viên và tài khoản mặc định", () => {
		const r = Engine.calculateEmployee(ctx, emp());
		expect(r.allocations.map((a) => [a.component, a.account, a.sub])).toEqual([["GROSS", "6421", "D1"], ["ERINS", "6421", "D1"]]);
		expect(total(r.allocations)).toBe(r.grossPay + r.employerInsurance);
	});

	test("người làm cho hai phòng ban: bảng tỷ lệ 70 / 30 và phụ cấp nhập tay cho phòng ban thứ ba", () => {
		const departments = { D2: { account: "6411", byLabor: { C: "6412" } } };
		const input = {
			allocationVersions: [{ versionNbr: 1, status: "A", effectiveDate: "2026-01-01", lines: [{ sub: "D1", percent: 70 }, { sub: "D2", percent: 30 }] }],
			manualEarnings: [{ earningType: "PCCT", quantity: 1, rate: 1000000, sub: "D3" }],
			accounts: { employeeAccount: "", employeeSub: "D1", defaultAccount: "6421", defaultSub: "D1", workCenters: {}, projects: {}, departments },
		};
		const r = Engine.calculateEmployee(ctx, emp(input));
		expect(r.grossPay).toBe(31000000);
		expect(r.allocations.filter((a) => a.component === "GROSS").map((a) => [a.source, a.sub, a.amount, a.account])).toEqual([
			["S", "D3", 1000000, "6421"], ["P", "D1", 21000000, "6421"], ["P", "D2", 9000000, "6411"],
		]);
		expect(r.allocations.filter((a) => a.component === "ERINS").map((a) => [a.sub, a.account])).toEqual([["D1", "6421"], ["D2", "6411"]]);
		expect(total(r.allocations)).toBe(r.grossPay + r.employerInsurance);
		// Cộng tác viên: engine tự truyền loại lao động để tra bản ghi riêng theo loại
		const c = Engine.calculateEmployee(ctx, emp(Object.assign({}, input, { employmentType: "C", pitMethod: "F", manualEarnings: [] })));
		expect(c.allocations.map((a) => [a.sub, a.account])).toEqual([["D1", "6421"], ["D2", "6412"]]);
		expect(total(c.allocations)).toBe(c.grossPay + c.employerInsurance);
	});
});
