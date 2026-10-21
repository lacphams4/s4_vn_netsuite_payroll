// PayrollEngine: nối quy tắc thu nhập, giờ công, nhập tay, lõi phiếu lương, gộp tháng thuế, tháng 13, phân bổ
// (đặc tả 2.5.3, 4.2.9). Số kỳ vọng lấy từ ca vàng KB-15, FL-05, TM-03, HD-01/02, UAT-1.
const { core, provider, Defaults } = require("./helpers");
const Engine = core("PayrollEngine");

const types = Defaults.earningTypes.concat([
	{ code: "PCCT", taxTreatment: "T", category: "A", isOvertime: false, isActive: true },
	{ code: "PL01", taxTreatment: "C", exemptCapParam: "PIT.MEAL_EXEMPT_CAP", isActive: true },
	{ code: "PL02", taxTreatment: "E", isActive: true }, { code: "PL03", taxTreatment: "E", isActive: true }, { code: "PL04", taxTreatment: "E", isActive: true },
	{ code: "PL05", taxTreatment: "E", isActive: true }, { code: "PL06", taxTreatment: "E", isActive: true }, { code: "PL07", taxTreatment: "E", isActive: true },
]);
const ruleSetup = { baseEarningType: "LUONG", contractorEarningType: "PHIDV", allowanceEarningType: "PHUCAP" };

function ctx(over = {}) {
	return Object.assign({
		period: { start: "2026-10-01", end: "2026-10-31", frequency: "M", taxMonth: "202610", isLastInTaxMonth: true, standardWorkDays: 26 },
		settings: { standardHoursPerDay: 8, unionFundApplicable: true, defaultRegion: "I", accrual13Basis: "P", accrual13Months: 12, allocationMethod: "F", allocationFallback: "D", allocationVersionMode: "E", payGroupCode: "DEFAULT", leavePayoutEarningType: "TRAPHEP", ruleSetup },
		provider: provider(), earningTypes: types, rules: [], benefitPackages: {},
	}, over);
}

function emp(over = {}) {
	return Object.assign({
		employee: "1", code: "E001", employmentType: "E", salaryType: "M", pitMethod: "P", region: "I", isActive: true,
		compensation: { baseSalary: 30000000, insuranceWage: 30000000 }, dependents: [], line: {}, defaults: { project: "", branch: "HCM" },
		accounts: { defaultAccount: "6421" },
	}, over);
}

describe("PayrollEngine", () => {
	test("KB-15: công nhân vùng II, OT ba loại, phụ cấp nhập tay", () => {
		const r = Engine.calculateEmployee(ctx(), emp({
			region: "II", compensation: { baseSalary: 10400000, insuranceWage: 10400000 },
			timeLines: [
				{ date: "2026-10-05", isOvertime: true, dayType: "N", hours: 10, timeType: "OT" },
				{ date: "2026-10-11", isOvertime: true, dayType: "W", hours: 8, timeType: "OT" },
				{ date: "2026-10-20", isOvertime: true, dayType: "H", hours: 2, earningType: "OTD300", isNight: true },
			],
			manualEarnings: [{ earningType: "PCCT", quantity: 1, rate: 1000000 }],
		}));
		expect(r.hourlyRate).toBe(50000);
		const amt = (code) => r.earnings.filter((e) => e.earningType === code).reduce((s, e) => s + e.amount, 0);
		expect([amt("OT150"), amt("OT200"), amt("OTD300")]).toEqual([750000, 800000, 390000]);
		expect(r.grossPay).toBe(13340000);
		expect(r.taxExemptIncome).toBe(940000);
		expect(r.employeeInsurance).toBe(1092000);
		expect(r.employerInsurance).toBe(2444000);
		expect(r.pit).toBe(0);
		expect(r.netPay).toBe(12248000);
		expect(r.employerCost).toBe(15784000);
		// Phân bổ: một đích mặc định, tổng = gross + BH DN
		expect(r.allocations.reduce((s, a) => s + a.amount, 0)).toBe(13340000 + 2444000);
		expect(r.overtimeHours).toBe(20);
	});

	test("FL-05: CTV lương giờ 80 giờ x 196.000, khấu trừ 10%", () => {
		const c = ctx({ period: { start: "2025-03-01", end: "2025-03-31", frequency: "M", standardWorkDays: 26, isLastInTaxMonth: true } });
		const r = Engine.calculateEmployee(c, emp({
			employmentType: "C", salaryType: "H", pitMethod: "F", compensation: { baseSalary: 196000, insuranceWage: 0 },
			timeLines: [{ date: "2025-03-10", isOvertime: false, dayType: "N", hours: 80 }],
		}));
		expect(r.grossPay).toBe(15680000);
		expect(r.employeeInsurance).toBe(0);
		expect(r.pit).toBe(1568000);
		expect(r.netPay).toBe(14112000);
		expect(r.earnings.map((e) => e.earningType)).toEqual(["PHIDV"]);
	});

	test("Ngày công: lương tháng chia công thực tế (TC-ER-03) và lỗi thiếu công chuẩn", () => {
		const r = Engine.calculateEmployee(ctx(), emp({ compensation: { baseSalary: 9645000, insuranceWage: 9645000 }, line: { standardDays: 26, workDays: 18 } }));
		expect(r.earnings[0]).toMatchObject({ earningType: "LUONG", quantity: 18, rate: 370962, amount: 6677308 });
		const c = ctx({ period: { start: "2026-10-01", end: "2026-10-31", frequency: "M" } });
		expect(() => Engine.calculateEmployee(c, emp())).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
	});

	test("HD-02: nghỉ việc 20/10, trả 3 ngày phép, lương 14/22 công", () => {
		const c = ctx({ period: { start: "2026-10-01", end: "2026-10-31", frequency: "M", standardWorkDays: 22, isLastInTaxMonth: true } });
		const r = Engine.calculateEmployee(c, emp({
			compensation: { baseSalary: 25000000, insuranceWage: 25000000 }, terminationDate: "2026-10-20", leaveRemaining: 3,
			line: { standardDays: 22, workDays: 14, absenceDays: 8, unpaidLeaveDays: 8 },
		}));
		const amt = (code) => r.earnings.filter((e) => e.earningType === code).reduce((s, e) => s + e.amount, 0);
		expect(amt("LUONG")).toBe(15909091);
		expect(amt("TRAPHEP")).toBe(3409091);
		// Dòng nhập tay cùng loại được ưu tiên
		const r2 = Engine.calculateEmployee(c, emp({
			compensation: { baseSalary: 25000000, insuranceWage: 25000000 }, terminationDate: "2026-10-20", leaveRemaining: 3,
			line: { standardDays: 22, workDays: 14 }, manualEarnings: [{ earningType: "TRAPHEP", quantity: 1, rate: 1000000 }],
		}));
		expect(r2.earnings.filter((e) => e.earningType === "TRAPHEP").map((e) => e.amount)).toEqual([1000000]);
	});

	test("UAT-1: gói phúc lợi A, kỳ 02/2025, không KPCĐ", () => {
		const pkgA = [["PL01", 730000], ["PL02", 250000], ["PL03", 200000], ["PL04", 400000], ["PL05", 300000], ["PL06", 1000000], ["PL07", 200000]].map(([earningType, amount]) => ({ earningType, amount }));
		const c = ctx({
			period: { start: "2025-02-01", end: "2025-02-28", frequency: "M", standardWorkDays: 24, isLastInTaxMonth: true },
			settings: Object.assign({}, ctx().settings, { unionFundApplicable: false }), benefitPackages: { A: pkgA },
		});
		const r = Engine.calculateEmployee(c, emp({ compensation: { baseSalary: 7920000, insuranceWage: 7920000, package: "A" }, accrue13: true }));
		expect(r.grossPay).toBe(11000000);
		expect(r.employeeInsurance).toBe(831600);
		expect(r.pit).toBe(0);
		expect(r.netPay).toBe(10168400);
		expect(r.employerInsurance).toBe(1702800);
		expect(r.benefit).toBe(3080000);
		// Trích trước tháng 13: (lương HĐ + gói) / 12
		expect(r.accrued13th).toBe(Math.round((7920000 + 3080000) / 12));
	});

	test("TM-03: bốn kỳ tuần, kỳ cuối gộp tháng thuế", () => {
		const weeks = [["2026-10-05", "2026-10-11", 9000000], ["2026-10-12", "2026-10-18", 8500000], ["2026-10-19", "2026-10-25", 9200000], ["2026-10-26", "2026-11-01", 8300000]];
		// Kỳ tuần 26/10 - 01/11 có tháng thuế 202611 theo ngày cuối; ca vàng giả định 4 kỳ cùng tháng thuế 10/2026
		const prior = { earnings: [], absenceWorkingDays: 0, otherTaxDeductions: 0 };
		const nets = [];
		weeks.forEach(([start, end, amount], i) => {
			const last = i === 3;
			const c = ctx({ period: { start, end, frequency: "W", taxMonth: "202610", isLastInTaxMonth: last, standardWorkDays: 26 } });
			const r = Engine.calculateEmployee(c, emp({
				compensation: { baseSalary: 8000000, insuranceWage: 8000000 }, dependents: [{ deductFrom: "2024-01-01" }],
				manualEarnings: [{ earningType: "LUONG", quantity: 1, rate: amount, amountLocked: true, amount }, { earningType: "ANCA", quantity: 1, rate: 200000, amountLocked: true, amount: 200000 }],
				prior: last ? prior : {},
			}));
			// Bỏ dòng lương quy tắc BASE (kỳ tuần đủ lương tháng, 2.12 #10): ca vàng chỉ có dòng nhập
			nets.push(r);
			if (!last) {
				expect(r.employeeInsurance).toBe(0);
				expect(r.pit).toBe(0);
			}
			prior.earnings.push({ code: "LUONG", amount, taxTreatment: "T", taxExemptAmount: 0 }, { code: "ANCA", amount: 200000, taxTreatment: "C", taxExemptAmount: 0, exemptCapParameter: "PIT.MEAL_EXEMPT_CAP" });
		});
		expect(nets[3].employeeInsurance).toBe(840000);
		expect(nets[3].employerInsurance).toBe(1880000);
		expect(nets[3].pit).toBeGreaterThan(0);
	});
});
