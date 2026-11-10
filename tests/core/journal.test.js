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

  test("hai phân bổ chỉ khác work center (class) ra hai dòng đúng class; cùng class thì gộp", () => {
    const b = batch();
    b.employees[0].allocations = [
      { component: "GROSS", amount: 12000000, account: "642", sub: "D1", workCenter: "WC1" },
      { component: "GROSS", amount: 8000000, account: "642", sub: "D1", workCenter: "WC2" },
      { component: "GROSS", amount: 10880000, account: "642", sub: "D1", workCenter: "WC1" },
      { component: "ERINS", amount: 7050000, account: "642", sub: "D1", workCenter: "WC2" },
    ];
    const je = J.buildRelease(b, config);
    const exp = je.lines.filter((l) => l.memo === "Payroll expense 202610");
    expect(exp).toHaveLength(2);
    expect(exp.find((l) => l.workCenter === "WC1").debit).toBe(22880000);
    expect(exp.find((l) => l.workCenter === "WC2").debit).toBe(8000000);
    expect(je.lines.find((l) => l.memo.startsWith("Employer"))).toMatchObject({ workCenter: "WC2", debit: 7050000 });
    // Tổng theo tài khoản x tiểu khoản không đổi so với trước khi tách theo class (báo cáo chi phí theo tài khoản không lệch)
    const d1 = je.lines.filter((l) => l.account === "642" && l.sub === "D1").reduce((s, l) => s + l.debit - l.credit, 0);
    expect(d1).toBe(12000000 + 8000000 + 10880000 + 7050000);
    expect(je.lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
    // Bút toán đảo giữ class của từng dòng
    const rev = J.buildReversal(je.lines, { batchNbr: "BL000001", periodId: "202610" });
    expect(rev.lines.filter((l) => l.memo === "Payroll expense 202610").map((l) => [l.workCenter, l.credit]).sort()).toEqual([["WC1", 22880000], ["WC2", 8000000]]);
  });

  test("finalize: khác work center không gộp, không phân biệt hoa thường và khoảng trắng", () => {
    const lines = J.finalize([
      { account: "642", amount: 100, memo: "a", workCenter: "wc1" }, { account: "642", amount: 50, memo: "a", workCenter: " WC1 " },
      { account: "642", amount: 25, memo: "a", workCenter: "WC2" }, { account: "642", amount: 5, memo: "a" }, { account: "334", amount: -180, memo: "b" },
    ]);
    expect(lines.filter((l) => l.account === "642").map((l) => [l.workCenter, l.debit])).toEqual([["wc1", 150], ["WC2", 25], ["", 5]]);
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

describe("Trích trước tháng 13 theo cơ cấu phân bổ GROSS", () => {
  const sumOf = (rows) => rows.reduce((s, r) => s + r.amount, 0);

  test("splitAccrual: tỷ lệ theo số tiền dòng GROSS, mang đủ phân đoạn, chênh lệch làm tròn dồn vào dòng lớn nhất", () => {
    const allocations = [
      { component: "GROSS", amount: 20000000, account: "642", sub: "D1", project: "", branch: "", workCenter: "WC1", source: "P", hours: 100 },
      { component: "GROSS", amount: 10880000, account: "632", sub: "D2", project: "P1", branch: "L1", workCenter: "WC2", task: "T1", costCode: "C1" },
      { component: "ERINS", amount: 7050000, account: "642", sub: "D1" },
    ];
    const rows = J.splitAccrual(2500000, allocations);
    // 2.500.000 x 10.880.000 / 30.880.000 = 880.829,02 -> 880.829; dòng lớn nhất nhận phần còn lại
    expect(rows).toEqual([
      { account: "642", sub: "D1", project: "", task: "", costCode: "", branch: "", workCenter: "WC1", amount: 1619171 },
      { account: "632", sub: "D2", project: "P1", task: "T1", costCode: "C1", branch: "L1", workCenter: "WC2", amount: 880829 },
    ]);
    expect(sumOf(rows)).toBe(2500000);
  });

  test("splitAccrual: gộp dòng cùng phân đoạn, bỏ nhóm không dương, BH doanh nghiệp không tham gia", () => {
    const rows = J.splitAccrual(1000000, [
      { component: "GROSS", amount: 6000000, account: "642", sub: "D1" }, { component: "GROSS", amount: 2000000, account: "642", sub: " d1 " },
      { component: "GROSS", amount: -500000, account: "642", sub: "D2" }, { component: "GROSS", amount: 2000000, account: "641", sub: "D3" },
      { component: "ERINS", amount: 9000000, account: "627", sub: "D9" },
    ]);
    expect(rows.map((r) => [r.account, r.sub, r.amount])).toEqual([["642", "D1", 800000], ["641", "D3", 200000]]);
  });

  test("splitAccrual: không có dòng phân bổ dương, số trích không dương -> rỗng (giữ cách cũ)", () => {
    expect(J.splitAccrual(2500000, [])).toEqual([]);
    expect(J.splitAccrual(2500000, undefined)).toEqual([]);
    expect(J.splitAccrual(2500000, [{ component: "ERINS", amount: 100, account: "642" }])).toEqual([]);
    expect(J.splitAccrual(2500000, [{ component: "GROSS", amount: -100, account: "642" }, { component: "GROSS", amount: 0, account: "641" }])).toEqual([]);
    expect(J.splitAccrual(0, [{ component: "GROSS", amount: 100, account: "642" }])).toEqual([]);
    expect(J.splitAccrual(-5, [{ component: "GROSS", amount: 100, account: "642" }])).toEqual([]);
  });

  test("splitAccrual: tổng luôn khớp tuyệt đối, không dòng âm - kể cả số trích rất nhỏ và tỷ lệ lẻ", () => {
    const four = [1, 2, 3, 4].map((i) => ({ component: "GROSS", amount: 250, account: "642", sub: `D${i}` }));
    // 2 đồng chia bốn phần bằng nhau: làm tròn thường cho 1 + 1 + 1 và dòng lớn nhất -1 -> chuyển sang làm tròn xuống
    expect(J.splitAccrual(2, four).map((r) => [r.sub, r.amount])).toEqual([["D1", 2]]);
    let seed = 13;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 500; i++) {
      const n = 1 + rnd(6);
      const allocations = [];
      for (let k = 0; k < n; k++) allocations.push({ component: "GROSS", amount: 1 + rnd(40000000), account: ["642", "632"][rnd(2)], sub: `D${rnd(4)}`, project: rnd(2) ? "" : `P${rnd(3)}`, workCenter: rnd(2) ? "" : `WC${rnd(2)}`, branch: rnd(3) ? "" : "L1" });
      const accrued = 1 + rnd(i % 5 === 0 ? 10 : 5000000);
      const rows = J.splitAccrual(accrued, allocations);
      expect(sumOf(rows)).toBe(accrued);
      expect(rows.every((r) => Number.isInteger(r.amount) && r.amount > 0)).toBe(true);
    }
  });

  test("bút toán: dòng Nợ trích tháng 13 mang phòng ban, dự án, địa điểm, class của chi phí lương; Có 335 không đổi", () => {
    const b = batch();
    b.employees[0].allocations = [
      { component: "GROSS", amount: 20000000, account: "642", sub: "D1", project: "", branch: "", workCenter: "WC1" },
      { component: "GROSS", amount: 10880000, account: "632", sub: "D2", project: "P1", branch: "S4VN", workCenter: "WC2" },
      { component: "ERINS", amount: 7050000, account: "642", sub: "D1", workCenter: "WC1" },
    ];
    const before = J.buildRelease(b, config);
    // Trước: một dòng Nợ ở tài khoản mặc định, không phân đoạn
    expect(before.lines.filter((l) => l.memo.startsWith("13th-month") && l.debit > 0).map((l) => [l.account, l.sub, l.project, l.workCenter, l.debit])).toEqual([["642", "", "", "", 2500000]]);
    b.employees[0].accrualAllocations = J.splitAccrual(2500000, b.employees[0].allocations);
    const je = J.buildRelease(b, config);
    const accr = je.lines.filter((l) => l.memo === "13th-month salary accrual 202610");
    expect(accr.filter((l) => l.debit > 0).map((l) => [l.account, l.sub, l.project, l.branch, l.workCenter, l.debit])).toEqual([
      ["642", "D1", "", "S4VN", "WC1", 1619171], ["632", "D2", "P1", "S4VN", "WC2", 880829],
    ]);
    expect(accr.filter((l) => l.credit > 0).map((l) => [l.account, l.credit])).toEqual([["335", 2500000]]);
    expect(je.lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
    // Mọi dòng khác giống hệt bút toán cũ
    const rest = (x) => x.lines.filter((l) => !(l.memo.startsWith("13th-month") && l.debit > 0));
    expect(rest(je)).toEqual(rest(before));
    // Đảo: âm bản từng dòng, giữ phân đoạn
    const rev = J.buildReversal(je.lines, { batchNbr: "BL000001", periodId: "202610" });
    rev.lines.forEach((l, i) => expect(l).toEqual(Object.assign({}, je.lines[i], { debit: je.lines[i].credit, credit: je.lines[i].debit })));
  });

  test("bút toán: không có dòng chia (bảng lương cũ, nhân viên không có phân bổ) -> ghi như cũ theo hồ sơ / mặc định", () => {
    const b = batch();
    b.employees[0].expenseAccount = "6421";
    b.employees[0].expenseSub = "D9";
    b.employees[0].accrualAllocations = [];
    const je = J.buildRelease(b, config);
    expect(je.lines.filter((l) => l.memo.startsWith("13th-month") && l.debit > 0).map((l) => [l.account, l.sub, l.debit])).toEqual([["6421", "D9", 2500000]]);
    expect(je).toEqual(J.buildRelease(batch_with((e) => Object.assign(e, { expenseAccount: "6421", expenseSub: "D9" })), config));
  });

  test("bút toán: tổng dòng chia lệch số trích -> chặn, yêu cầu tính lại; cộng tác viên không trích dù có dòng chia", () => {
    const b = batch();
    b.employees[0].accrualAllocations = [{ account: "642", sub: "D1", amount: 2499999 }];
    expect(() => J.buildRelease(b, config)).toThrow(/accrual split/);
    const c = batch();
    c.employees[1].accrued13th = 500000;
    c.employees[1].accrualAllocations = [{ account: "642", amount: 500000 }];
    expect(J.buildRelease(c, config)).toEqual(J.buildRelease(batch(), config));
  });

  function batch_with(fn) {
    const b = batch();
    fn(b.employees[0]);
    return b;
  }
});
