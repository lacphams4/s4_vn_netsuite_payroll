// Chia tiền tổ (đặc tả 4.3.2, ca 4.8.3) và phiếu sản lượng vào bảng lương (4.3.5).
const { core } = require("./helpers");
const Money = core("Money");
const Split = core("TeamSplitCalculator");
const Output = core("OutputEntries");
const Engine = core("EarningRuleEngine");

describe("TeamSplitCalculator 4.8.3", () => {
  test("TC-TS-01 / TC-KH-01 tổ nề, ngày công x hệ số", () => {
    const total = Output.lineAmount(12.5, 850000) + Output.lineAmount(48, 125000);
    expect(total).toBe(16625000);
    const res = Split.split(total, [{ workDays: 6, splitFactor: 1.2 }, { workDays: 6, splitFactor: 1 }, { workDays: 5, splitFactor: 1 }], "F");
    expect(res).toEqual([6576923, 5480769, 4567308]);
    expect(res.reduce((a, b) => a + b, 0)).toBe(16625000);
  });

  const members = [
    { workDays: 6, splitFactor: 2, hours: 40, fixedPercent: 62.5 },
    { workDays: 6, splitFactor: 1, hours: 20, fixedPercent: 30 },
    { workDays: 4, splitFactor: 1, hours: 20, fixedPercent: 7.5 },
  ];
  test.each([
    ["D", [3000000, 3000000, 2000000]],
    ["H", [4000000, 2000000, 2000000]],
    ["P", [5000000, 2400000, 600000]],
    ["E", [2666667, 2666667, 2666666]],
  ])("TC-TS-02 cách chia %s", (m, exp) => {
    expect(Split.split(8000000, members, m)).toEqual(exp);
  });

  test("TC-TS-03 lỗi: tỷ lệ 60 + 30, không có ngày công, trọng số âm", () => {
    expect(() => Split.split(1000, [{ fixedPercent: 60 }, { fixedPercent: 30 }], "P")).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
    expect(() => Split.split(1000, [{ workDays: 0 }, { workDays: 0 }], "D")).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
    expect(() => Split.split(1000, [{ workDays: 2 }, { workDays: -1 }], "D")).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
  });

  test("TC-TS-04 số âm chia đều", () => {
    const res = Split.split(-1000000, [{}, {}, {}], "E");
    expect(res.reduce((a, b) => a + b, 0)).toBe(-1000000);
    for (const x of res) expect(x === -333334 || x === -333333).toBe(true);
  });
});

describe("Phiếu sản lượng 4.3.5", () => {
  const entries = [
    { refNbr: "SL000001", status: "A", entryType: "T", rateTable: "KHOAN-XD", rateTableType: "W", project: "CT01", members: [{ employee: "A", amount: 6576923 }, { employee: "B", amount: 5480769 }, { employee: "C", amount: 4567308 }], lines: [{ amount: 16625000 }] },
    { refNbr: "SL000002", status: "A", entryType: "I", rateTable: "CONGDOAN", rateTableType: "O", workCenter: "WC-LAP", lines: [{ employee: "A", amount: 300000 }, { employee: "A", amount: 200000 }] },
    { refNbr: "SL000003", status: "P", entryType: "I", rateTable: "CONGDOAN", lines: [{ employee: "A", amount: 999 }] },
    { refNbr: "SL000004", status: "C", batchNbr: "BL000001", entryType: "I", rateTable: "HH", rateTableType: "S", lines: [{ employee: "A", amount: 50000000 }] },
    { refNbr: "SL000005", status: "C", batchNbr: "BL000009", entryType: "I", rateTable: "HH", rateTableType: "S", lines: [{ employee: "A", amount: 1 }] },
  ];

  test("chỉ phiếu Approved hoặc Included của chính bảng lương", () => {
    const c = Output.collect(entries, { batchNbr: "BL000001" });
    expect(c.outputAmounts.A["KHOAN-XD"].toNumber()).toBe(6576923);
    expect(c.outputAmounts.A.CONGDOAN.toNumber()).toBe(500000);
    expect(c.outputAmounts.A.HH.toNumber()).toBe(50000000);
    expect(c.salesAmounts.A.toNumber()).toBe(50000000);
    expect(c.salesAmounts.B).toBeUndefined();
    expect(c.shares.A).toHaveLength(3);
  });

  test("TC-KH-01: quy tắc OutputAmount lọc KHOAN-XD cho đúng phần mỗi người", () => {
    const c = Output.collect(entries, {});
    const rule = { code: "XD-KHOAN", earningType: "KHOAN", quantitySource: "O", rateSource: "Q", rateTable: "KHOAN-XD", isActive: true };
    const amt = (emp) => Engine.run([rule], { periodEnd: "2026-10-31", standardDays: 26, outputAmounts: c.outputAmounts[emp] }).lines[0].amount;
    expect([amt("A"), amt("B"), amt("C")]).toEqual([6576923, 5480769, 4567308]);
  });

  test("kiểm tra Submit: phiếu tổ tổng thành viên phải bằng thành tiền", () => {
    expect(Output.validate(entries[0])).toEqual([]);
    expect(Output.validate({ entryType: "T", lines: [{ amount: 100 }], members: [{ employee: "A", amount: 60 }, { employee: "A", amount: 30 }] }).length).toBe(2);
    expect(Output.validate({ entryType: "I", lines: [{ amount: 100 }] }).length).toBe(1);
    expect(Money.round(Money.D(Output.lineAmount(1.5, 3333)))).toBe(5000);
  });
});
