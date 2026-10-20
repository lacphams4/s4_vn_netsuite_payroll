// Ca kiểm thử vàng mục 3.10 (1-7, 20-22, 28-32) và HD-01..03 mục 2.13.7: quy đổi trễ sớm, công tháng, bảng công
// ký hiệu, loại ngày, đếm ngày nghỉ, ngày ngoài hợp đồng, phạm vi nhân viên.
const { core, Defaults } = require("./helpers");
const Rules = core("AttendanceRuleEvaluator");
const Summary = core("AttendanceSummaryCalculator");
const Sheet = core("AttendanceSheetCalculator");
const WDC = core("WorkingDayCounter");
const Emp = core("EmploymentDays");
const Money = core("Money");

describe("3.10 #1-2 quy đổi trễ sớm", () => {
  test.each([[0, 0], [15, 0], [16, 0.25], [60, 0.25], [61, 0.5], [240, 0.5], [241, 1], [600, 1]])("%s phút -> %s ngày", (m, d) => {
    expect(Rules.deductDays(m, Defaults.attendanceRules)).toBe(d);
  });
  test("không có quy tắc", () => expect(Rules.deductDays(90, [])).toBe(0));
});

describe("3.10 #3-4 công tháng", () => {
  test("#3", () => {
    const r = Summary.computeWorkDays({ standardDays: 26, paidLeaveDays: 3, unpaidLeaveDays: 2, socialInsuranceLeaveDays: 1, businessTripDays: 4, lateEarlyDays: 0.75, adjustmentDays: 0.5 });
    expect(r).toEqual({ workDays: 22.75, absenceDays: 3 });
  });
  test("#4", () => expect(Summary.computeWorkDays({ standardDays: 26, unpaidLeaveDays: 20, socialInsuranceLeaveDays: 10 }).workDays).toBe(0));
});

describe("3.10 #5 loại ngày", () => {
  const hol = ["2026-09-02", "2026-09-06"];
  test.each([["2026-10-14", "N"], ["2026-10-18", "W"], ["2026-09-02", "H"], ["2026-09-06", "H"]])("%s -> %s", (d, t) => {
    expect(WDC.dayType(d, "0", hol)).toBe(t);
  });
  test("roster: ô trống ca = nghỉ tuần, ô có ca = ngày thường, lễ luôn lễ", () => {
    const opt = { rosterDayOffIsWeeklyOff: true, hasRosterCell: true };
    expect(WDC.classifyDay("2026-10-14", "0", hol, Object.assign({ rosterShift: null }, opt))).toBe("W");
    expect(WDC.classifyDay("2026-10-18", "0", hol, Object.assign({ rosterShift: "C1" }, opt))).toBe("N");
    expect(WDC.classifyDay("2026-09-02", "0", hol, Object.assign({ rosterShift: null }, opt))).toBe("H");
    expect(WDC.classifyDay("2026-10-18", "0", hol, { rosterDayOffIsWeeklyOff: true, hasRosterCell: false })).toBe("W");
  });
});

describe("3.10 #6-7 bảng công ký hiệu", () => {
  test("#6", () => {
    const cells = Array(19).fill("X").concat(["/2", "P", "K", "Ô", "CT", "N", "N", "N", "N", "", "P/2", "L"]);
    expect(cells).toHaveLength(31);
    const t = Sheet.total(cells, Defaults.attendanceSymbols);
    expect(t).toMatchObject({ workedDays: 19.5, paidLeaveDays: 1.5, unpaidLeaveDays: 1, socialInsuranceLeaveDays: 1, businessTripDays: 1, paidDays: 22 });
    expect(t.unknownCodes).toEqual([]);
  });
  test("#7", () => {
    const t = Sheet.total([" x ", "p", "XX", "", "ct"], Defaults.attendanceSymbols);
    expect(t).toMatchObject({ workedDays: 1, paidLeaveDays: 1, businessTripDays: 1 });
    expect(t.unknownCodes).toEqual([{ day: 3, code: "XX" }]);
  });
});

describe("3.10 #20-22 đếm ngày nghỉ", () => {
  const hol = ["2026-04-30", "2026-05-01"];
  test("#20", () => {
    expect(WDC.count("2026-04-28", "2026-05-02", "0", hol)).toBe(3);
    expect(WDC.count("2026-04-28", "2026-05-02", "6,0", hol)).toBe(2);
  });
  test("#21", () => {
    expect(WDC.count("2026-10-05", "2026-10-07", "0", [], "P", "A")).toBe(2);
    expect(WDC.count("2026-10-05", "2026-10-05", "0", [], "P", "P")).toBe(0.5);
    expect(() => WDC.count("2026-10-05", "2026-10-05", "0", [], "P", "A")).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
  });
  test("#22 tách theo kỳ tháng", () => {
    const a = WDC.countWithin("2026-10-28", "2026-11-03", "2026-10-01", "2026-10-31", "0", []);
    const b = WDC.countWithin("2026-10-28", "2026-11-03", "2026-11-01", "2026-11-30", "0", []);
    expect([a, b, a + b]).toEqual([4, 2, 6]);
  });
  test("ngày đầu là ngày nghỉ thì nửa ngày không có tác dụng", () => {
    expect(WDC.count("2026-10-04", "2026-10-05", "0", [], "P", "P")).toBe(1);
  });
  test("ParseWeeklyOff: trống = không nghỉ; ngày công chuẩn: trống = Chủ nhật; bỏ giá trị lạ", () => {
    expect(WDC.parseWeeklyOff("")).toEqual([]);
    expect(WDC.parseWeeklyOff("", true)).toEqual([0]);
    expect(WDC.parseWeeklyOff("6; 0 ,9 x")).toEqual([6, 0]);
    expect(WDC.countWorkDays("2026-10-01", "2026-10-31", "6,0", [])).toBe(22);
    expect(WDC.countWorkDays("2026-10-01", "2026-10-31", "", [])).toBe(27);
  });
});

describe("3.10 #28-30, HD-01..03 ngày ngoài hợp đồng", () => {
  const ps = "2026-10-01";
  const pe = "2026-10-31";
  test("#28 / HD-01 vào làm 15/10", () => {
    expect(Emp.outsideContract("2026-10-15", null, ps, pe, "6,0", [])).toBe(10);
    expect(Money.round(Money.D(15000000).times("0.85").times(12).div(22))).toBe(6954545);
  });
  test("#29 / HD-02 làm việc cuối 20/10", () => {
    expect(Emp.outsideContract(null, "2026-10-20", ps, pe, "6,0", [])).toBe(8);
    expect(Money.round(Money.D(25000000).times(14).div(22))).toBe(15909091);
    expect(Money.round(Money.D(3).times(25000000).div(22))).toBe(3409091);
    expect(Emp.terminatesIn("2026-10-20", ps, pe)).toBe(true);
  });
  test("#30 / HD-03", () => {
    expect(Emp.employedIn(null, "2026-09-30", ps, pe)).toBe(false);
    expect(Emp.outsideContract(null, "2026-09-30", ps, pe, "6,0", [])).toBe(22);
    expect(Emp.outsideContract("2026-01-05", "2026-10-31", ps, pe, "6,0", [])).toBe(0);
    expect(Emp.outsideContract(null, null, ps, pe, "6,0", [])).toBe(0);
  });
});

describe("3.10 #31-32 phạm vi", () => {
  test("#31 InAttendanceSummary, AccruesLeave", () => {
    const cases = [[false, false, false], [false, true, false], [true, false, false], [true, true, false], [true, false, true]];
    expect(cases.map((c) => Emp.inAttendanceSummary(...c))).toEqual([true, true, false, true, true]);
    expect(Emp.accruesLeave(true)).toBe(false);
    expect(Emp.accruesLeave(false)).toBe(true);
  });
  test("#32 KeepInPayroll", () => {
    expect([[true, true, 0], [true, true, 7.5], [true, false, 0], [false, true, 0]].map((c) => Emp.keepInPayroll(...c))).toEqual([false, true, true, true]);
  });
});

describe("Build bảng tổng hợp công (3.5)", () => {
  const period = { startDate: "2026-10-01", endDate: "2026-10-31", standardWorkDays: 22 };
  const lt = { PN: { code: "PN" }, KL: { code: "KL", deductsWorkDays: true }, OM: { code: "OM", paidBySocialInsurance: true, deductsWorkDays: true } };
  test("mô hình ngoại lệ", () => {
    const s = Summary.buildExceptions({
      period, employee: { hireDate: "2026-10-05" }, weeklyOff: "6,0", holidays: [],
      leaveRequests: [
        { refNbr: "NP1", fromDate: "2026-10-12", toDate: "2026-10-13", leaveType: lt.PN },
        { refNbr: "NP2", fromDate: "2026-10-14", toDate: "2026-10-14", fromHalf: "P", leaveType: lt.KL },
        { refNbr: "NP3", fromDate: "2026-10-28", toDate: "2026-11-03", leaveType: lt.OM },
      ],
      trips: [{ refNbr: "CT1", fromDate: "2026-10-20", toDate: "2026-10-21" }],
      exceptions: [{ refNbr: "NL1", workDate: "2026-10-06", exceptionType: "L", deductDays: 0.25 }, { refNbr: "NL2", workDate: "2026-10-07", exceptionType: "A", adjustDays: 0.5 }],
      overtime: [{ refNbr: "OT1", workDate: "2026-10-08", hours: 2, earningType: "OT150" }],
    });
    // ngoài HĐ 1/10, 2/10 = 2; KL 0,5; OM 28-30/10 = 3
    expect(s).toMatchObject({ unpaidLeaveDays: 2.5, socialInsuranceLeaveDays: 3, paidLeaveDays: 2, businessTripDays: 2, lateEarlyDays: 0.25, adjustmentDays: 0.5, overtimeHours: 2, workDays: 16.75, absenceDays: 5.5 });
    expect(s.lines.map((l) => l.sourceType)).toEqual(["C", "X", "X", "O", "L", "L", "T", "L"]);
  });
  test("nguồn bảng công ký hiệu", () => {
    const t = Sheet.total(Array(20).fill("X").concat(["K"]), Defaults.attendanceSymbols);
    const s = Summary.buildSheet({ period, employee: {}, weeklyOff: "6,0", holidays: [], sheetTotals: t, overtime: [] });
    expect(s).toMatchObject({ workDays: 20, unpaidLeaveDays: 1, adjustmentDays: -1, absenceDays: 1 });
  });
  test("ApplyLeave dự phòng khi không có bảng tổng hợp", () => {
    const r = Summary.applyLeave({ summary: null, standardWorkDays: 22, period, employee: { terminationDate: "2026-10-29" }, weeklyOff: "6,0", holidays: [],
      leaveRequests: [{ fromDate: "2026-10-05", toDate: "2026-10-06", leaveType: lt.KL }] });
    expect(r).toMatchObject({ unpaidLeaveDays: 3, absenceDays: 3, workDays: 19, attendanceLocked: false });
  });
  test("ApplyLeave chép bảng tổng hợp", () => {
    const r = Summary.applyLeave({ summary: { standardDays: 22, unpaidLeaveDays: 1, socialInsuranceLeaveDays: 2, workDays: 19, status: "L" } });
    expect(r).toMatchObject({ absenceDays: 3, workDays: 19, attendanceLocked: true });
  });
  test("kỳ công khóa giao khoảng ngày", () => {
    const periods = [{ periodId: "202609", startDate: "2026-09-01", endDate: "2026-09-30", attendanceStatus: "L" }, { periodId: "202610", startDate: "2026-10-01", endDate: "2026-10-31", attendanceStatus: "O" }];
    expect(Summary.lockedPeriodOverlap("2026-09-29", "2026-10-02", periods).periodId).toBe("202609");
    expect(Summary.lockedPeriodOverlap("2026-10-01", "2026-10-02", periods)).toBeNull();
  });
});
