// Quy tắc thu nhập (đặc tả mục 4.2, ca kiểm thử 4.8.1, 4.8.2, TC-HH-02, TC-GN-02) và dòng giờ công (4.2.9 bước 3).
const { core, provider } = require("./helpers");
const Money = core("Money");
const Engine = core("EarningRuleEngine");
const RateTable = core("RateTable");
const Packs = core("IndustryPacks");

const PE = "2026-10-31";
const D = Money.D;
const rule = (o) => Object.assign({ isActive: true, multiplier: 1, proration: "N", conditions: [], failAction: "N" }, o);
const byType = (lines) => lines.reduce((m, l) => ((m[l.earningType] = (m[l.earningType] || 0) + l.amount), m), {});

describe("TC-ER-01 bộ mặc định V2 = công thức V2 (432 tổ hợp)", () => {
  const setup = { baseEarningType: "LUONG", contractorEarningType: "PHIDV", allowanceEarningType: "PHUCAP", mealEarningType: "ANCA", mealAllowanceAmount: 730000 };
  const salary = { M: 20000001, D: 385385, H: 196000 };
  const PC = 1234567;
  const pkg = [{ earningType: "PL01", amount: 730000 }, { earningType: "PL02", amount: 750001 }];
  const cases = [];
  for (const st of ["M", "D", "H"]) for (const et of ["E", "C"]) for (const std of [26, 27, 22, 23.5]) for (const wd of [0, 0.5, 13, 18.5, 26, 27]) for (const hours of [0, 7.5, 80]) cases.push([st, et, std, wd, hours]);
  expect(cases).toHaveLength(432);

  function v2(st, et, std, wd, hours) {
    const L = salary[st];
    const exp = {};
    const add = (k, v) => { if (v !== 0) exp[k] = (exp[k] || 0) + v; };
    const r = (x) => Money.round(x);
    const baseType = et === "E" ? "LUONG" : "PHIDV";
    if (st === "M") add(baseType, r(D(L).times(wd).div(std)));
    else if (st === "D") add(baseType, r(D(L).times(wd)));
    else add(baseType, hours > 0 ? r(D(L).times(hours)) : et === "E" ? r(D(L).times(wd).times(8)) : 0);
    add("PHUCAP", st === "M" ? r(D(PC).times(wd).div(std)) : PC);
    for (const p of pkg) add(p.earningType, st === "M" ? r(D(p.amount).times(wd).div(std)) : p.amount);
    if (et === "E") add("ANCA", 730000);
    return exp;
  }

  test.each(cases)("%s/%s chuẩn %s công %s giờ %s", (st, et, std, wd, hours) => {
    const ctx = {
      periodEnd: PE, salaryType: st, employmentType: et, standardDays: std, workDays: wd, hoursPerDay: 8, regularHours: hours,
      compensation: { baseSalary: salary[st], fixedAllowance: PC, benefitLines: pkg },
    };
    const res = Engine.run([], ctx, { setup });
    expect(byType(res.lines)).toEqual(v2(st, et, std, wd, hours));
  });
});

describe("Quy tắc thu nhập 4.8.1", () => {
  test("TC-ER-02 CTV lương giờ, không khai loại phí CTV, loại PC", () => {
    const res = Engine.run([], {
      periodEnd: PE, salaryType: "H", employmentType: "C", standardDays: 26, workDays: 26, regularHours: 80,
      compensation: { baseSalary: 196000, fixedAllowance: 500000 },
    }, { setup: { baseEarningType: "LUONG" } });
    expect(res.lines.map((l) => [l.earningType, l.amount])).toEqual([["LUONG", 15680000], ["LUONG", 500000]]);
  });

  test("TC-ER-03 Qty 18, Rate 370.962, Amount 6.677.308", () => {
    const res = Engine.run([], { periodEnd: PE, salaryType: "M", employmentType: "E", standardDays: 26, workDays: 18, compensation: { baseSalary: 9645000 } }, {});
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]).toMatchObject({ ruleCode: "BASE", quantity: 18, rate: 370962, amount: 6677308 });
    expect(res.baseSalaryTotal).toBe(6677308);
  });

  test("TC-ER-04 phạm vi quy tắc", () => {
    const rules = [
      rule({ code: "A", earningType: "X1", payGroup: "CN01", quantitySource: "K", rateSource: "F", fixedRate: 100000 }),
      rule({ code: "B", earningType: "X2", payGroup: "VP", quantitySource: "K", rateSource: "F", fixedRate: 100000 }),
      rule({ code: "C", earningType: "X3", salaryType: "M", quantitySource: "K", rateSource: "F", fixedRate: 100000 }),
      rule({ code: "D", earningType: "X4", effectiveDate: "2026-11-01", quantitySource: "K", rateSource: "F", fixedRate: 100000 }),
      rule({ code: "E", earningType: "X5", isActive: false, quantitySource: "K", rateSource: "F", fixedRate: 100000 }),
      rule({ code: "F", earningType: "X6", quantitySource: "D", rateSource: "F", fixedRate: 50000, multiplier: 1.5 }),
    ];
    const res = Engine.run(rules, { periodEnd: PE, payGroup: "cn01", salaryType: "D", employmentType: "E", standardDays: 26, workDays: 10, compensation: { baseSalary: 300000 } });
    expect(res.lines.map((l) => l.ruleCode)).toEqual(["A", "F"]);
    expect(res.lines[1].amount).toBe(750000);
  });

  test("TC-ER-05 lương tháng không có ngày công chuẩn -> lỗi", () => {
    expect(() => Engine.run([], { periodEnd: PE, salaryType: "M", employmentType: "E", standardDays: 0, workDays: 20, compensation: { baseSalary: 10000000 } }))
      .toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
  });

  test("TC-QT-01 SiteDays và EarningAmount theo thứ tự", () => {
    const timeLines = [];
    for (let d = 1; d <= 18; d++) timeLines.push({ date: `2026-10-${String(d).padStart(2, "0")}`, project: "P1", hours: 8 });
    timeLines.push({ date: "2026-10-01", project: "P2", hours: 1 }, { date: "2026-10-20", project: "", hours: 8 });
    const rules = [
      rule({ code: "BASE", earningType: "LUONG", sequence: 10, quantitySource: "B", rateSource: "S", proration: "M" }),
      rule({ code: "SITE", earningType: "PCCT", sequence: 20, quantitySource: "J", rateSource: "F", fixedRate: 150000 }),
      rule({ code: "BONUS", earningType: "THUONG", sequence: 30, quantitySource: "E", baseEarningType: "LUONG", rateSource: "C", fixedRate: 10 }),
      rule({ code: "EARLY", earningType: "THUONG2", sequence: 5, quantitySource: "E", baseEarningType: "LUONG", rateSource: "C", fixedRate: 10 }),
    ];
    const res = Engine.run(rules, { periodEnd: PE, salaryType: "M", employmentType: "E", standardDays: 26, workDays: 26, timeLines, compensation: { baseSalary: 13000000 } });
    expect(res.lines.map((l) => [l.ruleCode, l.amount])).toEqual([["BASE", 13000000], ["SITE", 2700000], ["BONUS", 1300000]]);
    expect(res.lines[2].rate).toBe(10);
  });

  test("TC-QT-02 OutputAmount không lọc bảng", () => {
    const rules = [rule({ code: "SP", earningType: "SANPHAM", quantitySource: "O", rateSource: "Q" })];
    const res = Engine.run(rules, { periodEnd: PE, salaryType: "M", standardDays: 26, outputAmounts: { A: 1000000, B: 2500000 } });
    expect(res.lines[0].amount).toBe(3500000);
  });

  const cc = (extra) => rule(Object.assign({
    code: "CC", earningType: "CHUYENCAN", quantitySource: "K", rateSource: "F", fixedRate: 500000,
    conditions: [{ field: "U", comparison: "E", value: 0 }, { field: "L", comparison: "L", value: 2 }],
  }, extra));
  const ccRun = (r, unpaid, late) => Engine.run([r], { periodEnd: PE, salaryType: "M", standardDays: 26, workDays: 26, unpaidLeaveDays: unpaid, lateCount: late }).lines;

  test("TC-DK-01 Not Paid", () => {
    expect(ccRun(cc(), 0, 2)[0].amount).toBe(500000);
    expect(ccRun(cc(), 0, 3)).toHaveLength(0);
    expect(ccRun(cc(), 0.5, 0)).toHaveLength(0);
  });

  test("TC-DK-02 công >= 22, còn làm việc, thâm niên >= 6", () => {
    const r = rule({
      code: "TH", earningType: "THUONG", quantitySource: "K", rateSource: "F", fixedRate: 1000000,
      conditions: [{ field: "D", comparison: "G", value: 22 }, { field: "A", comparison: "E", value: 1 }, { field: "T", comparison: "G", value: 6 }],
    });
    const run = (wd, active, sen) => Engine.run([r], { periodEnd: PE, salaryType: "M", standardDays: 26, workDays: wd, isActive: active, seniorityDate: sen }).lines;
    expect(run(26, true, "2026-04-30")[0].amount).toBe(1000000);
    expect(run(21.5, true, "2026-04-30")).toHaveLength(0);
    expect(run(26, false, "2026-04-30")).toHaveLength(0);
    expect(run(26, true, "2026-05-01")).toHaveLength(0);
    expect(Engine.tenureMonths("2026-04-30", PE)).toBe(6);
    expect(Engine.tenureMonths("2026-05-01", PE)).toBe(5);
  });

  test.each([[0, 2, 500000], [0, 3, 400000], [0.5, 3, 350000], [1, 4, 200000], [0, 7, 0], [2, 9, 0]])("TC-DK-03 giảm 20%% (nghỉ %s, trễ %s) -> %s", (u, l, amt) => {
    const lines = ccRun(cc({ failAction: "R", reductionPercent: 20 }), u, l);
    expect(lines.reduce((s, x) => s + x.amount, 0)).toBe(amt);
    for (const x of lines) expect(x.amount).toBe(Money.round(D(x.quantity).times(x.rate).times(x.multiplier)));
  });

  const hhTable = { HH: { type: "S", lines: [{ fromAmount: 0, rate: 2 }, { fromAmount: 100000000, rate: 3 }, { fromAmount: 300000000, rate: 5 }] } };

  test("TC-DK-04 hoa hồng thang, giảm 5% mỗi điểm", () => {
    const r = rule({ code: "HH", earningType: "HOAHONG", quantitySource: "S", rateSource: "T", rateTable: "HH", tierMethod: "P", conditions: [{ field: "P", comparison: "G", value: 80 }], failAction: "R", reductionPercent: 5 });
    const ok = Engine.run([r], { periodEnd: PE, standardDays: 26, salesAmount: 300000000, salesTarget: 400000000, rateTables: hhTable }).lines;
    expect(ok[0].amount).toBe(6000000);
    expect(Engine.run([r], { periodEnd: PE, standardDays: 26, salesAmount: 300000000, salesTarget: 0, rateTables: hhTable }).lines).toHaveLength(0);
  });

  test("validateRule: EarningAmount phải có quy tắc đứng trước", () => {
    const base = rule({ code: "BASE", earningType: "LUONG", sequence: 10 });
    const bonus = rule({ code: "BONUS", earningType: "THUONG", sequence: 30, quantitySource: "E", baseEarningType: "LUONG", rateSource: "C" });
    const early = rule({ code: "EARLY", earningType: "THUONG", sequence: 5, quantitySource: "E", baseEarningType: "LUONG", rateSource: "C" });
    expect(Engine.validateRule(bonus, [base, bonus])).toEqual([]);
    expect(Engine.validateRule(early, [base, early]).length).toBe(1);
    expect(Engine.validateRule(rule({ code: "T", earningType: "X", rateSource: "T" }), []).length).toBe(1);
    expect(Engine.validateRule(rule({ code: "P", earningType: "", rateSource: "P" }), [])).toEqual([]);
  });
});

describe("4.8.2 thang hoa hồng", () => {
  const tiers = RateTable.tiersAt([{ fromAmount: 0, rate: 2 }, { fromAmount: 100000000, rate: 3 }, { fromAmount: 300000000, rate: 5 }], PE);
  test.each([[0, 0, 0], [90000000, 1800000, 1800000], [100000000, 2000000, 3000000], [350000000, 10500000, 17500000]])("%s -> P %s / W %s", (q, p, w) => {
    expect(RateTable.tieredAmount(q, tiers, "P").toNumber()).toBe(p);
    expect(RateTable.tieredAmount(q, tiers, "W").toNumber()).toBe(w);
  });

  test("TC-HH-02 lũy tiến, đạt >= 80%, Not Paid", () => {
    const r = rule({ code: "HH", earningType: "HOAHONG", quantitySource: "S", rateSource: "T", rateTable: "HH", tierMethod: "P", conditions: [{ field: "P", comparison: "G", value: 80 }] });
    const rt = { HH: { type: "S", lines: [{ fromAmount: 0, rate: 2 }, { fromAmount: 100000000, rate: 3 }, { fromAmount: 300000000, rate: 5 }] } };
    const run = (s, t) => Engine.run([r], { periodEnd: PE, standardDays: 26, salesAmount: s, salesTarget: t, rateTables: rt }).lines;
    const nv1 = run(350000000, 400000000);
    expect(nv1).toHaveLength(1);
    expect(nv1[0]).toMatchObject({ earningType: "HOAHONG", quantity: 350000000, amount: 10500000, rate: 3 });
    expect(run(250000000, 400000000)).toHaveLength(0);
    expect(run(90000000, 100000000)[0].amount).toBe(1800000);
    expect(run(90000000, 0)).toHaveLength(0);
  });

  test("tiersAt lấy dòng hiệu lực mới nhất mỗi ngưỡng; findRate ưu tiên dự án", () => {
    const lines = [
      { itemCode: "BT", rate: 800000, effectiveDate: "2026-01-01" },
      { itemCode: "BT", rate: 850000, effectiveDate: "2026-06-01" },
      { itemCode: "BT", rate: 900000, effectiveDate: "2026-01-01", project: "CT01" },
      { itemCode: "BT", rate: 999999, effectiveDate: "2026-01-01", expirationDate: "2026-03-31", project: "CT02" },
    ];
    expect(RateTable.findRate(lines, "bt", "2026-10-05", "").rate).toBe(850000);
    expect(RateTable.findRate(lines, "BT", "2026-10-05", "CT01").rate).toBe(900000);
    expect(RateTable.findRate(lines, "BT", "2026-10-05", "CT02").rate).toBe(850000);
    expect(RateTable.findRate(lines, "XX", "2026-10-05", "")).toBeNull();
    const t = RateTable.tiersAt([{ fromAmount: 0, rate: 2, effectiveDate: "2026-01-01" }, { fromAmount: 0, rate: 2.5, effectiveDate: "2026-07-01" }], PE);
    expect(t).toHaveLength(1);
    expect(t[0].percent.toNumber()).toBe(2.5);
  });
});

describe("Gói ngành (4.4, TC-GN-02)", () => {
  test("mọi gói hợp lệ (độ dài mã, tham chiếu)", () => {
    for (const k of Object.keys(Packs.PACKS)) expect(Packs.validatePack(Packs.PACKS[k])).toEqual([]);
  });

  test("TRADE: chỉ một dòng TM-COMM 10.500.000", () => {
    const p = Packs.PACKS.TRADE;
    const rateTables = { "HH-TM": { type: "S", lines: [{ fromAmount: 0, rate: 2 }, { fromAmount: 100000000, rate: 3 }, { fromAmount: 300000000, rate: 5 }] }, "DS-CH": { type: "S", lines: [] } };
    const res = Engine.run(p.rules, { periodEnd: PE, salaryType: "M", standardDays: 26, workDays: 26, salesAmount: 350000000, salesTarget: 400000000, outputAmounts: { "HH-TM": 350000000, "DS-CH": 50000000 }, rateTables });
    expect(res.lines.map((l) => [l.ruleCode, l.amount])).toEqual([["TM-COMM", 10500000]]);
  });

  test("CONSTRUCTION: chỉ một dòng XD-KHOAN 6.576.923", () => {
    const timeLines = Array.from({ length: 20 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, project: "CT01", hours: 8 }));
    const res = Engine.run(Packs.PACKS.CONSTRUCTION.rules, { periodEnd: PE, salaryType: "D", standardDays: 26, workDays: 20, timeLines, outputAmounts: { "KHOAN-XD": 6576923, CONGDOAN: 1000000 } });
    expect(res.lines.map((l) => [l.ruleCode, l.amount])).toEqual([["XD-KHOAN", 6576923]]);
  });

  test("planLoad chặn khi chưa nạp VN Defaults, chỉ thêm phần thiếu", () => {
    expect(() => Packs.planLoad("TRADE", { rules: [] })).toThrow();
    const plan = Packs.planLoad("trade", { rules: ["BASE", "TM-COMM"], earningTypes: ["hoahong"] });
    expect(plan.rules.map((r) => r.code)).toEqual(["TM-STORE"]);
    expect(plan.earningTypes.map((r) => r.code)).toEqual(["THUONGCH", "PCGH"]);
  });
});

describe("Giờ công: OT, làm đêm, dòng tay (4.1.1, 4.2.9)", () => {
  const types = [
    { code: "OT150", isOvertime: true, overtimeDayType: "N", taxTreatment: "P", timeTypeCode: "OT" },
    { code: "OT200", isOvertime: true, overtimeDayType: "W", taxTreatment: "P", timeTypeCode: "OT" },
    { code: "OT300", isOvertime: true, overtimeDayType: "H", taxTreatment: "P", timeTypeCode: "OT" },
    { code: "OTD150", isOvertime: true, overtimeDayType: "N", isNight: true, taxTreatment: "P" },
    { code: "OTD200", isOvertime: true, overtimeDayType: "W", isNight: true, taxTreatment: "P" },
    { code: "OTD300", isOvertime: true, overtimeDayType: "H", isNight: true, taxTreatment: "P" },
    { code: "DEM", isNight: true, taxTreatment: "P", timeTypeCode: "NIGHT" },
  ];
  const p = provider();

  test("đơn giá giờ 10.400.000 / 26 / 8 = 50.000", () => {
    expect(Engine.hourlyRate("M", 10400000, 26, 8).toNumber()).toBe(50000);
    expect(() => Engine.hourlyRate("M", 10400000, 0, 8)).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
  });

  test("KB-15: OT 750.000 / 800.000 / 390.000, miễn 940.000", () => {
    const lines = Engine.timeEarnings({
      hourlyRate: 50000, provider: p, date: PE, earningTypes: types,
      timeLines: [
        { timeType: "OT", isOvertime: true, dayType: "N", hours: 6 }, { timeType: "OT", isOvertime: true, dayType: "N", hours: 4 },
        { timeType: "OT", isOvertime: true, dayType: "W", hours: 8 },
        { earningType: "OTD300", isOvertime: true, dayType: "H", hours: 2 },
        { timeType: "REG", isOvertime: false, dayType: "N", hours: 160 },
      ],
    });
    expect(lines.map((l) => [l.earningType, l.amount, l.taxExemptAmount])).toEqual([["OT150", 750000, 250000], ["OT200", 800000, 400000], ["OTD300", 390000, 290000]]);
  });

  test("OT-05 làm đêm trong giờ chuẩn: chỉ dòng 120.000, miễn toàn bộ", () => {
    const lines = Engine.timeEarnings({ hourlyRate: 50000, provider: p, date: PE, earningTypes: types, timeLines: [{ timeType: "NIGHT", isOvertime: false, dayType: "N", hours: 8 }] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ earningType: "DEM", amount: 120000, taxExemptAmount: 120000, multiplier: 0.3 });
  });

  test("không có loại thu nhập cho loại ngày -> lỗi", () => {
    expect(() => Engine.selectEarningType({ isOvertime: true, dayType: "H" }, [types[0]])).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
  });

  test("dòng tay: Amount = Round(Qty x Rate x Mult), miễn phần hệ số vượt 1 (P), E toàn bộ", () => {
    expect(Engine.manualLine({ earningType: "OT150", quantity: 2, rate: 33333.33, multiplier: 1.5 }, { taxTreatment: "P" })).toMatchObject({ amount: 100000, taxExemptAmount: 33333 });
    expect(Engine.manualLine({ earningType: "TROCAP", quantity: 1, rate: 2000000 }, { taxTreatment: "E" })).toMatchObject({ amount: 2000000, taxExemptAmount: 2000000 });
    expect(Engine.manualLine({ earningType: "THUONG", quantity: 1, rate: 1, amount: 777, amountLocked: true }, { taxTreatment: "T" })).toMatchObject({ amount: 777, taxExemptAmount: 0 });
  });
});
