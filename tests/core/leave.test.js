// Ca kiểm thử vàng mục 3.10 (23-27) và sổ phép mục 3.6.
const { core, Defaults } = require("./helpers");
const Acc = core("LeaveAccrualCalculator");
const Ledger = core("LeaveLedger");

const STD = Defaults.leavePolicies[0];

describe("3.10 #23-27 cấp phép năm", () => {
  test.each([["2022-03-01", 12], ["2021-03-01", 13], ["2016-01-01", 14]])("#23 thâm niên %s -> %s", (sd, d) => {
    expect(Acc.calculate(STD, 2026, sd, "2026-01-02", 0).entitled).toBe(d);
  });
  test.each([["2026-07-01", 6], ["2026-07-20", 5], ["2027-01-05", 0]])("#24 vào làm %s -> %s", (sd, d) => {
    expect(Acc.calculate(STD, 2026, sd, "2026-01-02", 0).entitled).toBe(d);
  });
  test("#25 cấp theo tháng", () => {
    const m = Object.assign({}, STD, { accrualMethod: "M" });
    const a = Acc.calculate(m, 2026, "2020-01-01", "2026-06-30", 0);
    expect(a).toMatchObject({ months: 6, entitled: 6.5 });
    expect(Acc.calculate(m, 2026, "2020-01-01", "2026-05-31", 0).entitled).toBe(5.5);
  });
  test("#26 vào 10/2/2026, làm tròn 0,5", () => {
    expect(Acc.calculate(STD, 2026, "2026-02-10", "2026-12-31", 0).entitled).toBe(11);
  });
  test("#27 chuyển phép", () => {
    const p = Object.assign({}, STD, { carryOverMaxDays: 5, carryOverExpiryMonth: 3 });
    expect(Acc.calculate(p, 2026, "2020-01-01", "2026-01-02", 8)).toMatchObject({ carriedOver: 5, carryOverExpiryDate: "2026-03-31" });
    expect(Acc.calculate(STD, 2026, "2020-01-01", "2026-01-02", 8).carriedOver).toBe(0);
  });
  test("chạy lại không cấp trùng", () => {
    expect(Acc.accrualDelta(12, 12, "Y")).toBe(0);
    expect(Acc.accrualDelta(12, 0, "Y")).toBe(12);
    expect(Acc.accrualDelta(6.5, 5.5, "M")).toBe(1);
  });
});

describe("sổ phép", () => {
  test("giao dịch theo nguồn và số dư khả dụng", () => {
    const b = Ledger.fromTransactions([
      { source: "A", qty: 12 }, { source: "C", qty: 5 }, { source: "R", qty: -3 }, { source: "J", qty: 1 }, { source: "X", qty: -2 },
    ], { pending: 1 });
    expect(b).toMatchObject({ entitled: 12, carriedOver: 3, used: 3, adjusted: 1, pending: 1 });
    expect(Ledger.available(b)).toBe(12);
  });
  test("submit, approve, reject, cancel", () => {
    let b = Ledger.fromTransactions([{ source: "A", qty: 12 }]);
    b = Ledger.submit(b, 2);
    expect(Ledger.available(b)).toBe(10);
    const ap = Ledger.approve(b, 2);
    expect(ap.transaction).toEqual({ source: "R", qty: -2 });
    expect(ap.balance).toMatchObject({ pending: 0, used: 2 });
    const c = Ledger.cancel(ap.balance, 2, "A");
    expect(c.balance.used).toBe(0);
    expect(Ledger.reject(Ledger.submit(b, 1), 5).pending).toBe(0);
    expect(Ledger.cancel(Ledger.submit(Ledger.empty(), 1), 1, "P").balance.pending).toBe(0);
  });
  test("hết hạn phép chuyển dùng phép chuyển trước", () => {
    const b = { entitled: 12, carriedOver: 5, carryOverExpiryDate: "2026-03-31", used: 2, adjusted: 0, pending: 0 };
    expect(Ledger.expiryPlan(b, "2026-04-01")).toEqual({ transaction: { source: "X", qty: -3 }, clearExpiry: true });
    expect(Ledger.expiryPlan(b, "2026-03-30").transaction).toBeNull();
    expect(Ledger.carryOverPlan(5, false, true)).toEqual([{ yearOffset: 0, source: "C", qty: 5 }, { yearOffset: -1, source: "J", qty: -5 }]);
    expect(Ledger.carryOverPlan(5, true, true)).toEqual([]);
  });
  test("kiểm tra khi gửi đơn", () => {
    const pn = Defaults.leaveTypes.find((t) => t.code === "PN");
    const om = Defaults.leaveTypes.find((t) => t.code === "OM");
    const vr = Defaults.leaveTypes.find((t) => t.code === "VR");
    expect(Ledger.validateSubmit({ fromDate: "2026-10-05", toDate: "2026-10-06", days: 2 }, pn, 1, []).map((e) => e.code)).toEqual(["BALANCE"]);
    expect(Ledger.validateSubmit({ fromDate: "2026-10-05", toDate: "2026-10-05", days: 1 }, om, null, []).map((e) => e.code)).toEqual(["ATTACHMENT"]);
    expect(Ledger.validateSubmit({ fromDate: "2026-10-05", toDate: "2026-10-08", days: 4 }, vr, null, []).map((e) => e.code)).toEqual(["MAX"]);
    expect(Ledger.validateSubmit({ fromDate: "2026-10-05", toDate: "2026-10-06", days: 2 }, vr, null, [{ fromDate: "2026-10-06", toDate: "2026-10-06", status: "A" }]).map((e) => e.code)).toEqual(["OVERLAP"]);
    expect(Ledger.requestDays({ fromDate: "2026-10-05", toDate: "2026-10-07", fromHalf: "P", toHalf: "A" }, "0", [])).toBe(2);
  });
});
