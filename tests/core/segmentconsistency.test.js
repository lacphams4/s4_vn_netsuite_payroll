// Tính nhất quán phân đoạn sau các thay đổi gần đây (phòng ban theo đích, tài khoản theo class / dự án / phòng ban, class trong
// khóa gộp, trích tháng 13 theo cơ cấu phân bổ): một bảng lương mẫu 2 phòng ban, 2 class, 2 dự án, có cộng tác viên và trích
// tháng 13 đi qua đúng chuỗi lõi mà lớp NetSuite dùng - CostAllocationBuilder -> chi tiết dòng lương -> PayrollJournalBuilder
// (ghi sổ, xem trước, đảo, bill cơ quan thu), LaborCostFacts (số liệu phân tích), ReportData.costReport (báo cáo chi phí).
const { core } = require("./helpers");
const Builder = core("CostAllocationBuilder");
const J = core("PayrollJournalBuilder");
const F = core("LaborCostFacts");
const RD = core("ReportData");

const PERIOD = "202704";
const DEFAULT_LOCATION = "L0";
const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);

// Tài khoản chi phí theo đích (dạng của CostAccountRules.buildMaps): class WC1 -> 622 (nhân viên) / 6278 (cộng tác viên),
// dự án P2 -> 632, phòng ban D2 -> 641; còn lại theo hồ sơ rồi mặc định 642
const costMaps = {
  workCenters: { WC1: { account: "622", byLabor: { C: "6278" } } },
  projects: { P2: { account: "632" } },
  departments: { D2: { account: "641" } },
};

const config = {
  payableAccount: "334", contractorPayableAccount: "3388", pitPayableAccount: "3335", otherDeductionAccount: "1388", advanceAccount: "141", accrued13thAccount: "335",
  defaultExpenseAccount: "642", interBranch: true, pitVendor: "THUE",
  components: { BHXH: { name: "BHXH", liabilityAccount: "3383", vendor: "BHXH" }, KPCD: { name: "KPCĐ", liabilityAccount: "3382", vendor: "" } },
};

/** Một dòng batch_emp như api/Payroll.calculate ghi: trường vô hướng + detail JSON (allocations do CostAllocationBuilder dựng). */
function payLine(id, o) {
  const type = o.type || "E";
  const er = o.er || 0;
  const allocations = Builder.build({
    grossPay: o.gross, employerInsurance: er, earnings: o.earnings || [], targets: o.targets, defaultBranch: o.branch || "", defaultWorkCenter: o.workCenter || "",
    accounts: Object.assign({ laborType: type, employeeAccount: o.expenseAccount || "", employeeSub: o.dept, defaultAccount: "642", defaultSub: o.dept }, costMaps),
  });
  const accrued13 = o.accrued13 || 0;
  const accrual13 = J.splitAccrual(accrued13, allocations);
  const ee = o.ee || 0;
  const pit = o.pit || 0;
  const detail = {
    earnings: o.earnings || [], allocations, employmentType: type, expenseAccount: o.expenseAccount || "", expenseSub: o.dept,
    insurance: er || ee ? [{ code: "BHXH", employeeAmount: ee, employerAmount: er - (o.union || 0) }, { code: "KPCD", employeeAmount: 0, employerAmount: o.union || 0 }] : [],
    deductions: [], advanceOffsets: [],
  };
  if (accrual13.length) detail.accrual13 = accrual13;
  return { id: String(id), batch: "8", employee: String(100 + id), employment_type: type, gross: o.gross, er_ins: er, ee_ins: ee, pit, net: o.gross - ee - pit, accrued13, detail: JSON.stringify(detail) };
}

function sampleLines() {
  return [
    // NV1 phòng D1: bảng tỷ lệ 60% (D1, class WC1, dự án P1) / 40% (D2, class WC2, dự án P2); có trích tháng 13
    payLine(1, {
      dept: "D1", gross: 30000001, er: 6450000, union: 600000, ee: 3150000, pit: 512345, accrued13: 2500000,
      earnings: [{ earningType: "LUONG", amount: 26000001, source: "S" }, { earningType: "PHUCAP", amount: 4000000, source: "S" }],
      targets: [{ project: "P1", sub: "D1", workCenter: "WC1", source: "P", weight: 60 }, { project: "P2", sub: "D2", workCenter: "WC2", source: "P", weight: 40 }],
    }),
    // NV2 phòng D2, có tài khoản chi phí riêng 6421, chi nhánh L1: một dòng thưởng nhập tay gắn phòng D1 class WC2; có trích tháng 13
    payLine(2, {
      dept: "D2", branch: "L1", expenseAccount: "6421", gross: 22000000, er: 4300000, union: 400000, ee: 2100000, pit: 150000, accrued13: 1666667,
      earnings: [{ earningType: "LUONG", amount: 20000000, source: "S" }, { earningType: "THUONG", amount: 2000000, source: "M", sub: "D1", workCenter: "WC2" }],
      targets: [{ project: "", source: "D", weight: 100 }],
    }),
    // NV3 phòng D2 (tài khoản theo phòng ban của nhân viên: 641), không trích tháng 13: làm thêm theo dự án P1 (nguồn timesheet)
    payLine(3, {
      dept: "D2", gross: 15500000, er: 3225000, union: 300000, ee: 1575000, pit: 0,
      earnings: [{ earningType: "LUONG", amount: 15000000, source: "S" }, { earningType: "OT150", amount: 500000, source: "T", project: "P1", hours: 4 }],
      targets: [{ project: "", source: "D", weight: 100 }],
    }),
    // NV4 nghỉ không lương cả kỳ: không có dòng phân bổ nhưng vẫn trích tháng 13 -> ghi theo cách cũ (tài khoản mặc định)
    payLine(4, { dept: "D2", gross: 0, er: 0, accrued13: 1000000, earnings: [], targets: [{ project: "", source: "D", weight: 100 }] }),
    // Cộng tác viên: 70% (class WC1, dự án P2, phòng D2) / 30% phòng D1; không BH, không trích tháng 13
    payLine(5, {
      type: "C", dept: "D2", gross: 15680000, pit: 1568000,
      earnings: [{ earningType: "CTV", amount: 15680000, source: "S" }],
      targets: [{ project: "P2", sub: "D2", workCenter: "WC1", source: "P", weight: 70 }, { project: "", sub: "D1", source: "P", weight: 30 }],
    }),
  ];
}

/** Cùng ánh xạ với api/Payroll.releaseModel (tests/api/payrollaccounting.test.js kiểm hàm thật). */
function releaseModel(lines) {
  return {
    batchNbr: "BL000008", periodId: PERIOD, branch: "", date: "2027-04-30", grossTotal: sum(lines, (l) => l.gross), employerInsTotal: sum(lines, (l) => l.er_ins),
    employees: lines.map((l) => {
      const d = JSON.parse(l.detail);
      return {
        employee: l.employee, employmentType: l.employment_type, netPay: l.net, accrued13th: l.accrued13, expenseAccount: d.expenseAccount, expenseSub: d.expenseSub, pit: l.pit,
        insurance: d.insurance, deductions: d.deductions, advanceOffsets: d.advanceOffsets, allocations: d.allocations, accrualAllocations: Array.isArray(d.accrual13) ? d.accrual13 : [],
      };
    }),
  };
}

// Dòng Nợ chi phí của bút toán: mọi dòng Nợ (các tài khoản phải trả, thuế, BH chỉ có bên Có)
const keyOf = (account, dept, cls, location, project) => [account, dept, cls, location || DEFAULT_LOCATION, project].join("|");
function expenseDebits(lines) {
  const out = {};
  for (const l of lines) if (l.debit > 0) out[keyOf(l.account, l.sub, l.workCenter, l.branch, l.project)] = (out[keyOf(l.account, l.sub, l.workCenter, l.branch, l.project)] || 0) + l.debit;
  return out;
}
function factTotals(facts) {
  const out = {};
  for (const f of facts) out[keyOf(f.account, f.department, f.class, f.location, f.project)] = (out[keyOf(f.account, f.department, f.class, f.location, f.project)] || 0) + f.amount;
  return out;
}

describe("Bảng lương mẫu: 2 phòng ban, 2 class, 2 dự án, cộng tác viên, trích tháng 13", () => {
  const lines = sampleLines();
  const details = lines.map((l) => JSON.parse(l.detail));
  const je = J.buildRelease(releaseModel(lines), config);
  const built = F.build(lines, { earningTypes: { LUONG: "B", PHUCAP: "A", THUONG: "N", OT150: "O", CTV: "B" }, defaultExpenseAccount: "642", defaultLocation: DEFAULT_LOCATION });

  test("mẫu đủ phân đoạn: 2 phòng ban, 2 class, 2 dự án, 2 địa điểm; tài khoản theo class / dự án / phòng ban / hồ sơ / mặc định", () => {
    const all = details.flatMap((d) => d.allocations);
    const uniq = (k) => [...new Set(all.map((a) => a[k] || ""))].sort();
    expect(uniq("sub")).toEqual(["D1", "D2"]);
    expect(uniq("workCenter")).toEqual(["", "WC1", "WC2"]);
    expect(uniq("project")).toEqual(["", "P1", "P2"]);
    expect(uniq("branch")).toEqual(["", "L1"]);
    expect(uniq("account")).toEqual(["622", "6278", "632", "641", "642", "6421"]);
    // NV1: class WC1 -> 622; dự án P2 -> 632 (WC2 không khai tài khoản)
    expect(details[0].allocations.filter((a) => a.component === "GROSS").map((a) => [a.account, a.sub, a.workCenter, a.project, a.amount])).toEqual([["622", "D1", "WC1", "P1", 18000001], ["632", "D2", "WC2", "P2", 12000000]]);
    // Cộng tác viên: class WC1 tra theo loại lao động C -> 6278
    expect(details[4].allocations.map((a) => [a.account, a.sub, a.workCenter, a.project, a.amount])).toEqual([["6278", "D2", "WC1", "P2", 10976000], ["642", "D1", "", "", 4704000]]);
  });

  test("trích tháng 13 đi theo cơ cấu GROSS của chính nhân viên; người không có phân bổ giữ cách cũ; cộng tác viên không trích", () => {
    expect(details[0].accrual13.map((a) => [a.account, a.sub, a.workCenter, a.project, a.amount])).toEqual([["622", "D1", "WC1", "P1", 1500000], ["632", "D2", "WC2", "P2", 1000000]]);
    // NV2: 20 triệu theo tài khoản hồ sơ 6421 phòng D2 chi nhánh L1; 2 triệu thưởng gắn phòng D1 class WC2
    expect(details[1].accrual13.map((a) => [a.account, a.sub, a.workCenter, a.branch, a.amount])).toEqual([["6421", "D1", "WC2", "L1", 151515], ["6421", "D2", "", "L1", 1515152]]);
    expect(details[2].accrual13).toBeUndefined();
    expect(details[3].accrual13).toBeUndefined();
    expect(details[4].accrual13).toBeUndefined();
    const accr = je.lines.filter((l) => l.memo === `13th-month salary accrual ${PERIOD}`);
    expect(accr.filter((l) => l.debit > 0).map((l) => [l.account, l.sub, l.workCenter, l.branch, l.project, l.debit])).toEqual([
      ["622", "D1", "WC1", "", "P1", 1500000], ["632", "D2", "WC2", "", "P2", 1000000], ["6421", "D1", "WC2", "L1", "", 151515], ["6421", "D2", "", "L1", "", 1515152],
      ["642", "", "", "", "", 1000000],
    ]);
    expect(accr.filter((l) => l.credit > 0).map((l) => [l.account, l.credit])).toEqual([["335", 2500000 + 1666667 + 1000000]]);
  });

  test("bút toán ghi sổ: tổng Nợ = tổng Có; Nợ chi phí = thu nhập + BH doanh nghiệp + trích tháng 13; các khoản phải trả đúng số", () => {
    const debit = sum(je.lines, (l) => l.debit);
    expect(debit).toBe(sum(je.lines, (l) => l.credit));
    expect(debit).toBe(sum(lines, (l) => l.gross + l.er_ins) + 5166667);
    const credit = (account) => sum(je.lines.filter((l) => l.account === account), (l) => l.credit);
    expect(credit("334")).toBe(sum(lines.filter((l) => l.employment_type === "E"), (l) => l.net));
    expect(credit("3388")).toBe(15680000 - 1568000);
    expect(credit("3335")).toBe(sum(lines, (l) => l.pit));
    expect(credit("3383") + credit("3382")).toBe(sum(lines, (l) => l.ee_ins + l.er_ins));
    expect(je.lines.every((l) => (l.debit > 0) !== (l.credit > 0))).toBe(true);
  });

  test("xem trước bút toán = bút toán ghi sổ (cùng mô hình, dựng lại ra đúng các dòng đó)", () => {
    expect(J.buildRelease(releaseModel(sampleLines()), config)).toEqual(je);
  });

  test("số liệu phân tích: tổng = tổng Nợ chi phí và khớp từng khóa tài khoản | phòng ban | class | địa điểm | dự án", () => {
    expect(built.check.ok).toBe(true);
    expect(built.total).toBe(sum(je.lines, (l) => l.debit));
    expect(factTotals(built.facts)).toEqual(expenseDebits(je.lines));
    const byComponent = {};
    for (const f of built.facts) byComponent[f.component] = (byComponent[f.component] || 0) + f.amount;
    expect(byComponent).toEqual({ wages: 61000001, allowance: 4000000, bonus: 2000000, overtime: 500000, employerIns: 13975000, accrued13: 5166667, contractor: 15680000 });
    expect(built.facts.filter((f) => f.employmentType === "C").every((f) => f.component === "contractor")).toBe(true);
  });

  test("bút toán đảo: âm bản từng dòng, giữ nguyên tài khoản và mọi phân đoạn; cộng với bút toán gốc ra 0 theo từng khóa", () => {
    const rev = J.buildReversal(je.lines, { batchNbr: "BL000008", periodId: PERIOD }, config);
    expect(rev.lines).toHaveLength(je.lines.length);
    rev.lines.forEach((l, i) => expect(l).toEqual(Object.assign({}, je.lines[i], { debit: je.lines[i].credit, credit: je.lines[i].debit })));
    // Cách lớp NetSuite đảo: đọc lại dòng bút toán gốc theo trường của Journal Entry rồi đổi Nợ / Có
    const reread = je.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, memo: l.memo, sub: l.sub, branch: l.branch, workCenter: l.workCenter, project: l.project }));
    const net = {};
    for (const l of je.lines.concat(reread)) {
      const k = [l.account, l.sub, l.workCenter, l.branch, l.project, l.memo].join("|");
      net[k] = (net[k] || 0) + l.debit - l.credit;
    }
    expect(Object.values(net).every((v) => v === 0)).toBe(true);
    expect(sum(reread, (l) => l.debit)).toBe(sum(reread, (l) => l.credit));
    // Sau khi đảo không còn số liệu phân tích: kế hoạch ghi bỏ hiệu lực mọi dòng
    const stored = built.facts.map((f, i) => Object.assign({ id: String(i + 1) }, F.toRecord(f, { batch: "8", subsidiary: "13", month: PERIOD, postingDate: "2027-04-30" })));
    expect(F.plan(stored, [], { batch: "8" }).deactivate).toHaveLength(stored.length);
  });

  test("bill cơ quan thu: tổng bill = số Có của tài khoản phải nộp trên bút toán (BH có cơ quan thu, thuế TNCN)", () => {
    const totals = {};
    for (const d of details) {
      for (const i of d.insurance) {
        const t = (totals[i.code] = totals[i.code] || { employeeAmount: 0, employerAmount: 0 });
        t.employeeAmount += i.employeeAmount;
        t.employerAmount += i.employerAmount;
      }
    }
    const plan = J.buildAgencyBills({ batchNbr: "BL000008", periodId: PERIOD, pitTotal: sum(lines, (l) => l.pit), insuranceTotals: totals }, config);
    const credit = (account) => sum(je.lines.filter((l) => l.account === account), (l) => l.credit);
    expect(plan.bills.map((b) => [b.vendor, b.lines[0].account, b.total])).toEqual([["BHXH", "3383", credit("3383")], ["THUE", "3335", credit("3335")]]);
    expect(plan.skipped).toEqual([{ code: "KPCD", name: "KPCĐ", amount: credit("3382") }]);
  });

  test("báo cáo chi phí theo tài khoản: khớp bút toán từng tài khoản và khớp số liệu phân tích theo tài khoản x phòng ban", () => {
    const rows = RD.sourceRows([{ id: "8", tax_month: PERIOD }], lines, {}, {});
    const report = RD.costReport(rows, je.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })), { defaultExpenseAccount: "642" });
    expect(report.warnings).toEqual([]);
    expect(report.rows.filter((r) => r.difference !== null).every((r) => r.difference === 0)).toBe(true);
    expect(report.totals.total).toBe(built.total);
    expect(report.totals).toMatchObject({ accrued13th: 5166667, contractor: 15680000, employerIns: 13975000 });
    const fromReport = {};
    for (const r of report.rows) fromReport[`${r.account}|${r.department}`] = r.total;
    const fromFacts = {};
    for (const f of built.facts) fromFacts[`${f.account}|${f.department}`] = (fromFacts[`${f.account}|${f.department}`] || 0) + f.amount;
    expect(fromReport).toEqual(fromFacts);
  });

  test("bảng lương tính trước khi có quy tắc (chi tiết không có accrual13): bút toán, số liệu, báo cáo cùng theo cách cũ và vẫn khớp nhau", () => {
    const old = sampleLines().map((l) => {
      const d = JSON.parse(l.detail);
      delete d.accrual13;
      return Object.assign({}, l, { detail: JSON.stringify(d) });
    });
    const oldJe = J.buildRelease(releaseModel(old), config);
    expect(oldJe.lines.filter((l) => l.memo.startsWith("13th-month") && l.debit > 0).map((l) => [l.account, l.sub, l.workCenter, l.project, l.debit])).toEqual([["642", "", "", "", 3500000], ["6421", "D2", "", "", 1666667]]);
    const oldFacts = F.build(old, { earningTypes: { LUONG: "B", PHUCAP: "A", THUONG: "N", OT150: "O", CTV: "B" }, defaultExpenseAccount: "642", defaultLocation: DEFAULT_LOCATION });
    expect(oldFacts.check.ok).toBe(true);
    expect(factTotals(oldFacts.facts)).toEqual(expenseDebits(oldJe.lines));
    const report = RD.costReport(RD.sourceRows([{ id: "8", tax_month: PERIOD }], old, {}, {}), oldJe.lines, { defaultExpenseAccount: "642" });
    expect(report.warnings).toEqual([]);
    // Tổng chi phí và mọi dòng Có không đổi giữa hai cách; chỉ khác cách đặt dòng Nợ trích tháng 13
    expect(sum(oldJe.lines, (l) => l.debit)).toBe(sum(je.lines, (l) => l.debit));
    expect(oldJe.lines.filter((l) => l.credit > 0)).toEqual(je.lines.filter((l) => l.credit > 0));
  });
});
