// api/Payroll, phần kế toán thêm vào chi tiết dòng lương: khối `pit` (tách giảm trừ bản thân / người phụ thuộc, chỉ chuyển tiếp
// số bộ tính thuế đã dùng) và `accrual13` (dòng chia trích tháng 13) đi vào mô hình ghi sổ (releaseModel).
const path = require("path");
const ROOT = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll");
const { core, provider } = require("../core/helpers");

const mockDb = { lines: [] };

jest.mock("N/query", () => ({}), { virtual: true });
jest.mock("N/record", () => ({ Type: {} }), { virtual: true });
jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ id: 5, getPreference: () => "en_US" }), getCurrentScript: () => ({ getRemainingUsage: () => 5000 }) }), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => ({
  find: (name) => (name === "batch_emp" ? mockDb.lines.map((l) => Object.assign({}, l)) : []),
}));
for (const name of ["Settings", "Output", "WorkPermits", "AllocationPlans", "Clock", "TimeLines", "Checks", "LaborAnalytics", "CostAccounts"]) {
  jest.mock(`../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/${name}`, () => ({}));
}

const Payroll = require(path.join(ROOT, "api/Payroll"));
const Pit = core("PitCalculator");
const Engine = core("PayrollEngine");
const Journal = core("PayrollJournalBuilder");
const Defaults = core("VietnamDefaults");

const ctx = (prov) => ({
  period: { start: "2026-10-01", end: "2026-10-31", frequency: "M", taxMonth: "202610", isLastInTaxMonth: true, standardWorkDays: 26 },
  settings: {
    standardHoursPerDay: 8, unionFundApplicable: true, defaultRegion: "I", accrual13Basis: "P", accrual13Months: 12, allocationMethod: "F", allocationFallback: "D", allocationVersionMode: "E",
    payGroupCode: "DEFAULT", leavePayoutEarningType: "TRAPHEP", ruleSetup: { baseEarningType: "LUONG", contractorEarningType: "PHIDV", allowanceEarningType: "PHUCAP" },
  },
  provider: prov, earningTypes: Defaults.earningTypes, rules: [], benefitPackages: {},
});
const emp = (over) => Object.assign({
  employee: "1", code: "E001", employmentType: "E", salaryType: "M", pitMethod: "P", region: "I", isActive: true, accrue13: true,
  compensation: { baseSalary: 30000000, insuranceWage: 30000000 }, dependents: [], line: {}, defaults: { project: "", branch: "HCM" }, accounts: { defaultAccount: "6421", defaultSub: "D1" },
}, over);

describe("khối pit của chi tiết dòng lương", () => {
  test("pitTap không đổi giá trị nào của provider, chỉ ghi lại mức giảm trừ bản thân đã đọc", () => {
    const base = provider();
    const tap = Payroll.pitTap(base);
    expect(tap.seen).toEqual({});
    expect(String(tap.provider.getValue("PIT.DEPENDENT_DEDUCTION", "2026-10-31"))).toBe(String(base.getValue("PIT.DEPENDENT_DEDUCTION", "2026-10-31")));
    expect(tap.seen).toEqual({});
    expect(String(tap.provider.getValue("PIT.SELF_DEDUCTION", "2026-10-31"))).toBe(String(base.getValue("PIT.SELF_DEDUCTION", "2026-10-31")));
    expect(tap.seen.self).toBe(base.getValue("PIT.SELF_DEDUCTION", "2026-10-31").toNumber());
    expect(tap.provider.getPitBrackets("2026-10-31")).toEqual(base.getPitBrackets("2026-10-31"));
    expect(tap.provider.getInsuranceComponents("2026-10-31")).toEqual(base.getInsuranceComponents("2026-10-31"));
  });

  test("lũy tiến: hai số tách đúng bằng số của bộ tính thuế (PitCalculator), tổng = giảm trừ gia cảnh trên dòng", () => {
    for (const dependents of [0, 1, 3]) {
      const tap = Payroll.pitTap(provider());
      const res = Pit.calculate({ taxableIncome: 40000000, employeeInsurance: 3150000, dependentCount: dependents, pitMethod: "P", date: "2026-10-31" }, tap.provider);
      const block = Payroll.pitBlock("P", res.familyDeduction, tap.seen);
      expect(block).toEqual({ method: "P", selfDeduction: res.selfDeduction, dependentDeduction: res.dependentDeduction });
      expect(block.selfDeduction + block.dependentDeduction).toBe(res.familyDeduction);
    }
  });

  test("qua PayrollEngine (đường tính lương thật): kết quả tính không đổi khi bọc provider; khối pit khớp giảm trừ gia cảnh", () => {
    const person = () => emp({ dependents: [{ deductFrom: "2026-01-01" }, { deductFrom: "2026-01-01", deductTo: "2026-12-31" }] });
    const plain = Engine.calculateEmployee(ctx(provider()), person());
    const tap = Payroll.pitTap(provider());
    const r = Engine.calculateEmployee(ctx(tap.provider), person());
    expect(r).toEqual(plain);
    expect(r.dependentCount).toBe(2);
    const direct = Pit.calculate({ taxableIncome: r.taxableIncome, employeeInsurance: r.employeeCompulsoryInsurance, dependentCount: 2, pitMethod: "P", date: "2026-10-31" }, provider());
    expect(Payroll.pitBlock("P", r.familyDeduction, tap.seen)).toEqual({ method: "P", selfDeduction: direct.selfDeduction, dependentDeduction: direct.dependentDeduction });
    expect(direct.dependentDeduction).toBeGreaterThan(0);
  });

  test("phương pháp không dùng giảm trừ (F, N, X) hoặc kỳ không tính thuế: hai số bằng 0 như bộ tính thuế; mã lạ / trống là P", () => {
    const tap = Payroll.pitTap(provider());
    const r = Engine.calculateEmployee(ctx(tap.provider), emp({ employmentType: "C", salaryType: "M", pitMethod: "F", accrue13: false }));
    expect(r.familyDeduction).toBe(0);
    expect(Payroll.pitBlock("F", r.familyDeduction, tap.seen)).toEqual({ method: "F", selfDeduction: 0, dependentDeduction: 0 });
    expect(Payroll.pitBlock("n", 0, {})).toEqual({ method: "N", selfDeduction: 0, dependentDeduction: 0 });
    expect(Payroll.pitBlock("X", 0, {})).toEqual({ method: "X", selfDeduction: 0, dependentDeduction: 0 });
    expect(Payroll.pitBlock("", 0, {})).toEqual({ method: "P", selfDeduction: 0, dependentDeduction: 0 });
  });

  test("không xác định chắc chắn thì không lưu khối (màn hình hiện tổng như trước), không bịa mức giảm trừ", () => {
    expect(Payroll.pitBlock("P", 19900000, {})).toBeNull();
    expect(Payroll.pitBlock("P", 19900000, { self: 0 })).toBeNull();
    expect(Payroll.pitBlock("P", 5000000, { self: 15500000 })).toBeNull();
    expect(Payroll.pitBlock("F", 19900000, { self: 15500000 })).toBeNull();
    expect(Payroll.pitBlock("P", 19900000, undefined)).toBeNull();
  });
});

describe("releaseModel: dòng chia trích tháng 13 từ chi tiết dòng lương vào mô hình ghi sổ", () => {
  const config = { payableAccount: "334", accrued13thAccount: "335", defaultExpenseAccount: "642", interBranch: true, components: {} };
  const c = { batch: { id: "8", name: "BL000008", doc_date: "2027-04-30", gross: 30000000, er_ins: 0 }, period: { name: "202704", end: "2027-04-30" } };
  const allocations = [
    { component: "GROSS", amount: 18000000, account: "622", sub: "D1", project: "P1", branch: "", workCenter: "WC1" },
    { component: "GROSS", amount: 12000000, account: "632", sub: "D2", project: "P2", branch: "", workCenter: "WC2" },
  ];
  const line = (detail) => ({ id: "81", batch: "8", employee: "101", employment_type: "E", net: 30000000, pit: 0, accrued13: 2500000, detail: JSON.stringify(Object.assign({ allocations, expenseAccount: "", expenseSub: "D1" }, detail)) });

  test("chi tiết có accrual13: mô hình mang accrualAllocations, bút toán ghi Nợ trích tháng 13 đủ phân đoạn", () => {
    mockDb.lines = [line({ accrual13: Journal.splitAccrual(2500000, allocations) })];
    const model = Payroll.releaseModel(c);
    expect(model.employees[0].accrualAllocations.map((a) => [a.account, a.sub, a.project, a.workCenter, a.amount])).toEqual([["622", "D1", "P1", "WC1", 1500000], ["632", "D2", "P2", "WC2", 1000000]]);
    const je = Journal.buildRelease(model, config);
    expect(je.lines.filter((l) => l.memo.startsWith("13th-month") && l.debit > 0).map((l) => [l.account, l.sub, l.project, l.workCenter, l.debit])).toEqual([["622", "D1", "P1", "WC1", 1500000], ["632", "D2", "P2", "WC2", 1000000]]);
  });

  test("bảng lương tính trước đây (không có accrual13, hoặc giá trị hỏng): mảng rỗng, bút toán ghi như cũ", () => {
    for (const detail of [{}, { accrual13: null }, { accrual13: "x" }]) {
      mockDb.lines = [line(detail)];
      const model = Payroll.releaseModel(c);
      expect(model.employees[0].accrualAllocations).toEqual([]);
      const je = Journal.buildRelease(model, config);
      expect(je.lines.filter((l) => l.memo.startsWith("13th-month") && l.debit > 0).map((l) => [l.account, l.sub, l.project, l.workCenter, l.debit])).toEqual([["642", "", "", "", 2500000]]);
    }
  });
});
