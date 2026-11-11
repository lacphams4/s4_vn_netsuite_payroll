// core/PayrollEngine chuyển tiếp khối pitDetail {method, selfDeduction, dependentDeduction} của bộ tính thuế (không tính lại),
// để api/Payroll thôi bọc provider (pitTap / pitBlock) khi lưu detail.pit.
const { core, provider, Defaults } = require("./helpers");
const Engine = core("PayrollEngine");

const ctx = () => ({
  period: { start: "2026-10-01", end: "2026-10-31", frequency: "M", taxMonth: "202610", isLastInTaxMonth: true, standardWorkDays: 26 },
  settings: {
    standardHoursPerDay: 8, unionFundApplicable: true, defaultRegion: "I", accrual13Basis: "P", accrual13Months: 12, allocationMethod: "F", allocationFallback: "D", allocationVersionMode: "E",
    payGroupCode: "DEFAULT", leavePayoutEarningType: "TRAPHEP", ruleSetup: { baseEarningType: "LUONG", contractorEarningType: "PHIDV", allowanceEarningType: "PHUCAP" },
  },
  provider: provider(), earningTypes: Defaults.earningTypes, rules: [], benefitPackages: {},
});
const emp = (over) => Object.assign({
  employee: "1", code: "E001", employmentType: "E", salaryType: "M", pitMethod: "P", region: "I", isActive: true,
  compensation: { baseSalary: 30000000, insuranceWage: 30000000 }, dependents: [], line: {}, defaults: { project: "", branch: "HCM" }, accounts: { defaultAccount: "6421" },
}, over);

describe("PayrollEngine.pitDetail", () => {
  test("lũy tiến có người phụ thuộc: tách đúng tổng giảm trừ gia cảnh", () => {
    const r = Engine.calculateEmployee(ctx(), emp({ dependents: [{ deductFrom: "2024-01-01" }] }));
    expect(r.pitDetail.method).toBe("P");
    expect(r.pitDetail.selfDeduction).toBeGreaterThan(0);
    expect(r.pitDetail.dependentDeduction).toBeGreaterThan(0);
    expect(r.pitDetail.selfDeduction + r.pitDetail.dependentDeduction).toBe(r.familyDeduction);
    // khóa pit cũ vẫn là số thuế
    expect(typeof r.pit).toBe("number");
  });

  test("không giảm trừ (thuế suất cố định): hai số bằng 0", () => {
    const r = Engine.calculateEmployee(ctx(), emp({ pitMethod: "F" }));
    expect(r.pitDetail).toEqual({ method: "F", selfDeduction: 0, dependentDeduction: 0 });
    expect(r.familyDeduction).toBe(0);
  });
});
