// Bút toán ghi sổ, đảo, tạm ứng, bill cơ quan thu (đặc tả 4.6, ca GL-01, GL-02, GL-03, GL-04, GL-05 ở mức lõi).
const { core } = require("./helpers");
const J = core("PayrollJournalBuilder");

const components = {
  BHXH_HT: { name: "BHXH hưu trí", liabilityAccount: "3383", vendor: "BHXH" },
  BHXH_OD: { name: "BHXH ốm đau", liabilityAccount: "3383", vendor: "BHXH" },
  BHTNLD: { name: "BHTNLĐ", liabilityAccount: "3383", vendor: "BHXH" },
  BHYT: { name: "BHYT", liabilityAccount: "3384", vendor: "BHXH" },
  BHTN: { name: "BHTN", liabilityAccount: "3386", vendor: "BHXH" },
  KPCD: { name: "KPCĐ", liabilityAccount: "3382", vendor: "" },
};
const config = {
  payableAccount: "334", contractorPayableAccount: "3388", pitPayableAccount: "3335", otherDeductionAccount: "1388", advanceAccount: "141",
  accrued13thAccount: "335", defaultExpenseAccount: "642", components, pitVendor: "CUCTHUE",
};

// KB-01 (10/2026): gross 30.880.000, BH NLĐ 3.150.000, DN 7.050.000, thuế 262.500, net 27.467.500; CTV gross 15.680.000 thuế 1.568.000
function batch() {
  return {
    batchNbr: "BL000001", periodId: "202610", branch: "S4VN", date: "2026-10-31", grossTotal: 30880000 + 15680000, employerInsTotal: 7050000,
    employees: [
      {
        employee: "E001", employmentType: "E", netPay: 27467500 - 5000000 - 200000, pit: 262500, accrued13th: 2500000,
        insurance: [
          { code: "BHXH_HT", employeeAmount: 2400000, employerAmount: 4200000 }, { code: "BHXH_OD", employeeAmount: 0, employerAmount: 900000 },
          { code: "BHTNLD", employeeAmount: 0, employerAmount: 150000 }, { code: "BHYT", employeeAmount: 450000, employerAmount: 900000 },
          { code: "BHTN", employeeAmount: 300000, employerAmount: 300000 }, { code: "KPCD", employeeAmount: 0, employerAmount: 600000 },
        ],
        deductions: [{ code: "BOITHUONG", name: "Bồi thường", amount: 200000 }],
        advanceOffsets: [{ refNbr: "TU000001", amount: 5000000 }],
        allocations: [
          { component: "GROSS", amount: 20000000, account: "642", project: "" },
          { component: "GROSS", amount: 10880000, account: "632", project: "P1" },
          { component: "ERINS", amount: 7050000, account: "642", project: "" },
        ],
      },
      { employee: "C001", employmentType: "C", netPay: 14112000, pit: 1568000, allocations: [{ component: "GROSS", amount: 15680000, account: "642" }] },
    ],
  };
}

describe("Bút toán ghi sổ bảng lương 4.6.2", () => {
  test("GL-01 cân đối, Có 334 = Σ thực lĩnh E, Có phải trả CTV = Σ thực lĩnh C", () => {
    const je = J.buildRelease(batch(), config);
    const sum = (f) => je.lines.reduce((s, l) => s + f(l), 0);
    expect(sum((l) => l.debit)).toBe(sum((l) => l.credit));
    const find = (acc, memoStart) => je.lines.filter((l) => l.account === acc && (!memoStart || l.memo.startsWith(memoStart)));
    expect(find("334")[0].credit).toBe(22267500);
    expect(find("3388")[0].credit).toBe(14112000);
    expect(find("3335")[0].credit).toBe(1830500);
    expect(find("3383")).toHaveLength(3); // ba khoản khác diễn giải không gộp
    expect(find("3383").reduce((s, l) => s + l.credit, 0)).toBe(2400000 + 4200000 + 900000 + 150000);
    expect(find("141")[0]).toMatchObject({ credit: 5000000, memo: "Advance offset TU000001" });
    expect(find("1388")[0]).toMatchObject({ credit: 200000, memo: "Other deduction Bồi thường" });
    expect(find("642", "Contractor service fees")[0].debit).toBe(15680000);
    expect(find("632")[0]).toMatchObject({ debit: 10880000, project: "P1", memo: "Payroll expense 202610" });
    expect(find("335")[0].credit).toBe(2500000);
    expect(je.memo).toBe("Payroll batch BL000001 period 202610");
    const expenseDebits = sum((l) => (l.memo.startsWith("Payroll expense") || l.memo.startsWith("Employer") || l.memo.startsWith("Contractor service") ? l.debit : 0));
    expect(expenseDebits).toBe(30880000 + 15680000 + 7050000);
  });

  test("diễn giải tiếng Việt", () => {
    const je = J.buildRelease(batch(), Object.assign({ lang: "vi" }, config));
    expect(je.lines.some((l) => l.memo === "Phải trả người lao động 202610")).toBe(true);
  });

  test("GL-02 lệch tổng phân bổ -> chặn", () => {
    const b = batch();
    b.employees[0].allocations[0].amount -= 1;
    expect(() => J.buildRelease(b, config)).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
  });

  test("GL-03 dòng khác chi nhánh: đúng chi nhánh khi bật liên chi nhánh, lỗi khi tắt", () => {
    const b = batch();
    b.employees[0].allocations[1].branch = "S4HN";
    expect(() => J.buildRelease(b, config)).toThrow(/inter-branch/);
    const je = J.buildRelease(b, Object.assign({ interBranch: true }, config));
    expect(je.lines.find((l) => l.account === "632").branch).toBe("S4HN");
  });

  test("thiếu tài khoản khoản trích -> lỗi nêu diễn giải; thiếu tài khoản phải trả CTV -> lỗi", () => {
    const c = Object.assign({}, config, { components: Object.assign({}, components, { BHYT: { name: "BHYT" } }) });
    expect(() => J.buildRelease(batch(), c)).toThrow(/BHYT 202610/);
    expect(() => J.buildRelease(batch(), Object.assign({}, config, { contractorPayableAccount: "" }))).toThrow(/contractor payable/);
  });

  test("GL-04 bút toán đảo đảo chiều mọi dòng", () => {
    const je = J.buildRelease(batch(), config);
    const rev = J.buildReversal(je.lines, { batchNbr: "BL000001", periodId: "202610" });
    expect(rev.memo).toBe("Reversal of payroll batch BL000001 (period 202610)");
    rev.lines.forEach((l, i) => {
      expect(l.debit).toBe(je.lines[i].credit);
      expect(l.credit).toBe(je.lines[i].debit);
      expect(l.account).toBe(je.lines[i].account);
    });
    expect(() => J.buildReversal([], { batchNbr: "X" })).toThrow();
  });

  test("finalize gộp dòng và bỏ dòng 0", () => {
    const lines = J.finalize([
      { account: "642", amount: 100, memo: "a" }, { account: "642", amount: 50, memo: "a" }, { account: "334", amount: -150, memo: "b" }, { account: "111", amount: 0, memo: "c" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].debit).toBe(150);
    expect(() => J.finalize([{ account: "642", amount: 100, memo: "a" }])).toThrow(/not balanced/);
    expect(() => J.finalize([{ account: "", amount: 100, memo: "x" }, { account: "1", amount: -100, memo: "y" }])).toThrow(/"x"/);
  });
});

describe("Tạm ứng và bill cơ quan thu", () => {
  test("JE tạm ứng Nợ 141 (dự án) / Có tiền", () => {
    const je = J.buildAdvance({ refNbr: "TU000001", employeeCode: "E001", amount: 5000000, project: "P1", branch: "S4VN", date: "2026-10-05" }, { advanceAccount: "141", cashAccount: "1121" });
    expect(je.lines.map((l) => [l.account, l.debit, l.credit, l.project])).toEqual([["141", 5000000, 0, "P1"], ["1121", 0, 5000000, ""]]);
    expect(je.memo).toBe("Payroll advance E001");
    expect(() => J.buildAdvance({ amount: 0 }, { advanceAccount: "141", cashAccount: "1121" })).toThrow();
  });

  test("GL-05 một bill mỗi nhà cung cấp, Σ dòng = NLĐ + DN và thuế; khoản không có nhà cung cấp được liệt kê", () => {
    const res = J.buildAgencyBills({
      batchNbr: "BL000001", periodId: "202610", pitTotal: 1830500,
      insuranceTotals: { BHXH_HT: { employeeAmount: 2400000, employerAmount: 4200000 }, BHYT: { employeeAmount: 450000, employerAmount: 900000 }, KPCD: { employeeAmount: 0, employerAmount: 600000 }, BHTN: { employeeAmount: 0, employerAmount: 0 } },
    }, { components, pitVendor: "CUCTHUE", pitPayableAccount: "3335" });
    expect(res.bills.map((b) => [b.vendor, b.total, b.refNo])).toEqual([["BHXH", 7950000, "BL000001"], ["CUCTHUE", 1830500, "BL000001"]]);
    expect(res.bills[0].memo).toBe("BHXH hưu trí, BHYT payroll period 202610");
    expect(res.bills[1].lines[0]).toEqual({ account: "3335", amount: 1830500, memo: "Personal income tax" });
    expect(res.skipped).toEqual([{ code: "KPCD", name: "KPCĐ", amount: 600000 }]);
    expect(() => J.buildAgencyBills({ batchNbr: "X", pitTotal: 0, insuranceTotals: {} }, { components })).toThrow();
  });
});
