// Nối hoa hồng vào bảng lương (docs/COMMISSION.md mục 7): PayrollEngine thêm dòng thu nhập source "C" từ emp.commissionLines,
// CostAllocationBuilder đưa chi phí hoa hồng về đúng phân đoạn (shares) của doanh thu được ghi nhận.
const { core, provider, Defaults } = require("./helpers");
const Engine = core("PayrollEngine");
const Alloc = core("CostAllocationBuilder");
const CE = core("CommissionEngine");

const types = Defaults.earningTypes.concat([
	{ code: "HOAHONG", taxTreatment: "T", category: "N", isActive: true },
	{ code: "HHMIEN", taxTreatment: "E", category: "N", isActive: true },
]);

function ctx() {
	return {
		period: { start: "2026-11-01", end: "2026-11-30", frequency: "M", taxMonth: "202611", isLastInTaxMonth: true, standardWorkDays: 26 },
		settings: { standardHoursPerDay: 8, unionFundApplicable: true, defaultRegion: "I", accrual13Basis: "P", accrual13Months: 12, allocationMethod: "F", allocationFallback: "D", allocationVersionMode: "E", payGroupCode: "DEFAULT", ruleSetup: { baseEarningType: "LUONG" } },
		provider: provider(), earningTypes: types, rules: [], benefitPackages: {},
	};
}

function emp(over = {}) {
	return Object.assign({
		employee: "101", code: "E101", employmentType: "E", salaryType: "M", pitMethod: "P", region: "I", isActive: true,
		compensation: { baseSalary: 20000000, insuranceWage: 20000000 }, dependents: [], line: {}, defaults: { project: "", branch: "HCM", workCenter: "" },
		accounts: { defaultAccount: "6421", defaultSub: "30" },
	}, over);
}

const shares = [{ sub: "31", workCenter: "41", branch: "61", project: "501", amount: 1200000 }, { sub: "32", workCenter: "", branch: "62", project: "", amount: 800000 }];

describe("PayrollEngine: dòng hoa hồng", () => {
	test("thêm dòng source C (số lượng 1, đơn giá = số tiền), tính vào gross và thuế như thu nhập chịu thuế", () => {
		const base = Engine.calculateEmployee(ctx(), emp());
		const r = Engine.calculateEmployee(ctx(), emp({ commissionLines: [{ earningType: "hoahong", amount: 2000000, shares, runId: "5" }] }));
		const c = r.earnings.find((e) => e.source === "C");
		expect(c).toMatchObject({ earningType: "HOAHONG", quantity: 1, rate: 2000000, multiplier: 1, amount: 2000000, taxExemptAmount: 0, runId: "5", runIds: ["5"] });
		expect(c.shares).toEqual(shares);
		expect(r.grossPay).toBe(base.grossPay + 2000000);
		expect(r.taxableIncome).toBe(base.taxableIncome + 2000000);
	});
	test("loại thu nhập miễn thuế: taxExemptAmount = số tiền (cùng bộ tính với dòng nhập tay)", () => {
		const base = Engine.calculateEmployee(ctx(), emp());
		const r = Engine.calculateEmployee(ctx(), emp({ commissionLines: [{ earningType: "HHMIEN", amount: 1500000, shares: [] }] }));
		expect(r.earnings.find((e) => e.source === "C").taxExemptAmount).toBe(1500000);
		expect(r.taxExemptIncome).toBe(base.taxExemptIncome + 1500000);
	});
	test("loại thu nhập không tồn tại: lỗi song ngữ như dòng nhập tay; số tiền 0 bỏ qua", () => {
		expect(() => Engine.calculateEmployee(ctx(), emp({ commissionLines: [{ earningType: "KHONGCO", amount: 1 }] }))).toThrow(expect.objectContaining({ messageVi: "Loại thu nhập KHONGCO không tồn tại." }));
		const r = Engine.calculateEmployee(ctx(), emp({ commissionLines: [{ earningType: "HOAHONG", amount: 0 }] }));
		expect(r.earnings.some((e) => e.source === "C")).toBe(false);
	});
	test("phân bổ: chi phí hoa hồng theo shares (sub, class, location, dự án), phần còn lại theo đích mặc định; tổng = gross + BH DN", () => {
		const r = Engine.calculateEmployee(ctx(), emp({ commissionLines: [{ earningType: "HOAHONG", amount: 2000000, shares }] }));
		const own = r.allocations.filter((a) => a.component === "GROSS" && (a.sub === "31" || a.sub === "32"));
		expect(own.map((a) => [a.sub, a.workCenter, a.branch, a.project, a.amount])).toEqual([["31", "41", "61", "501", 1200000], ["32", "", "62", "", 800000]]);
		expect(r.allocations.reduce((s, a) => s + a.amount, 0)).toBe(r.grossPay + r.employerInsurance);
	});
});

describe("CostAllocationBuilder: earnings source C", () => {
	const input = (earnings) => ({ grossPay: 12000000, employerInsurance: 0, earnings, targets: [{ project: "", branch: "HCM", workCenter: "", source: "D", weight: 1 }], defaultBranch: "HCM", accounts: { defaultAccount: "642" } });
	test("shares không có phân đoạn nào thì hoa hồng đi theo đích chung", () => {
		const out = Alloc.build(input([{ earningType: "LUONG", amount: 10000000, source: "S" }, { earningType: "HOAHONG", amount: 2000000, source: "C", shares: [{ sub: "", workCenter: "", branch: "", project: "", amount: 2000000 }] }]));
		expect(out.map((l) => [l.branch, l.amount])).toEqual([["HCM", 12000000]]);
	});
	test("trọng số = số tiền phần, phần lẻ đúng tổng; phần không dương bị bỏ", () => {
		const out = Alloc.build(input([{ earningType: "HOAHONG", amount: 1000001, source: "C", shares: [{ sub: "31", amount: 1 }, { sub: "32", amount: 1 }, { sub: "33", amount: 1 }, { sub: "34", amount: 0 }] }, { earningType: "LUONG", amount: 10999999, source: "S" }]));
		const own = out.filter((l) => /^3\d$/.test(l.sub || ""));
		expect(own.map((l) => l.sub)).toEqual(["31", "32", "33"]);
		expect(own.reduce((s, l) => s + l.amount, 0)).toBe(1000001);
		expect(out.reduce((s, l) => s + l.amount, 0)).toBe(12000000);
	});
});

describe("từ CommissionEngine tới bảng lương", () => {
	test("shares của kết quả hoa hồng đi thẳng vào phân bổ, tổng phần riêng = payable", () => {
		const plan = { id: "1", basis: "R", trigger: "I", creditSource: "R", window: "M", earningType: "HOAHONG", drawType: "R", drawAmount: 3000000 };
		const assignments = [{ plan: "1", employee: "101", quota: 100000000 }];
		const rows = [
			{ tranId: "1", tranType: "I", date: "2026-11-05", revenue: 70000000, salesRep: "101", department: "31", classId: "41", location: "61" },
			{ tranId: "2", tranType: "I", date: "2026-11-06", revenue: 30000000, salesRep: "101", department: "32" },
		];
		const credits = CE.credit(CE.normalizeLines(rows, plan, { from: "2026-11-01", to: "2026-11-30" }), plan, assignments);
		const res = CE.calculate({ plan, rules: [{ id: "r", method: "P", rate: 2 }], assignments, credits, from: "2026-11-01", to: "2026-11-30" }).results[0];
		expect([res.earned, res.payable, res.shares.map((s) => s.amount)]).toEqual([2000000, 3000000, [2100000, 900000]]);
		const r = Engine.calculateEmployee(ctx(), emp({ commissionLines: [{ earningType: res.earningType, amount: res.payable, shares: res.shares, runId: "9" }] }));
		const own = r.allocations.filter((a) => a.sub === "31" || a.sub === "32");
		expect(own.reduce((s, a) => s + a.amount, 0)).toBe(res.payable);
	});
});
