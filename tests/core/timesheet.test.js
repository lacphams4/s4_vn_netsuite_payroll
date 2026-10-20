// Ca kiểm thử vàng mục 3.10 (33-35) đồng bộ VP312000 và nạp giờ công mục 3.7, quy tắc đơn OT 3.4.
const { core, Defaults } = require("./helpers");
const Sync = core("TimesheetSync");
const TI = core("TimeImport");

describe("3.10 #33-35 đồng bộ giờ công tính lương", () => {
  const line = (lineId, sourceId, sourceHours, hours, source = "A") => ({ lineId, sourceId, sourceHours, hours, source });
  test("#33", () => {
    const p = Sync.plan([line(1, "A", 8, 8), line(2, "B", 8, 5)], { A: 6, B: 7 });
    expect(p.updates).toEqual([{ lineId: 1, sourceHours: 6, hours: 6 }, { lineId: 2, sourceHours: 7, hours: 5 }]);
    expect(p.deletes).toEqual([]);
    expect(p.inserts).toEqual([]);
  });
  test("#34", () => {
    const p = Sync.plan([line(1, "A", 8, 8), line(2, "B", 8, 3)], {});
    expect(p.deletes).toEqual([1]);
    expect(p.updates).toEqual([{ lineId: 2, sourceHours: 0, hours: 3 }]);
  });
  test("#35", () => {
    const p = Sync.plan([line(0, null, 0, 4, "M"), line(1, "A", 8, 8), line(2, "B", 8, 0)], { A: 8, B: 8, C: 2 });
    expect(p).toEqual({ updates: [], deletes: [], inserts: [{ sourceId: "C", hours: 2 }] });
  });
  test("dòng trùng activity", () => {
    const p = Sync.plan([line(1, "A", 8, 8), line(2, "A", 8, 8)], { A: 8 });
    expect(p.deletes).toEqual([2]);
  });
  test("bắt buộc lý do khi giờ khác giờ nguồn", () => {
    expect(Sync.requiresReason({ hours: 5, sourceHours: 8 })).toBe(true);
    expect(Sync.requiresReason({ hours: 8, sourceHours: 8 })).toBe(false);
  });
});

describe("nạp giờ công (3.7)", () => {
  test("IsAccepted", () => {
    expect(TI.isAccepted("Approved", null, true)).toBe(true);
    expect(TI.isAccepted("Completed", "Approved", true)).toBe(true);
    expect(TI.isAccepted("Rejected", "Approved", true)).toBe(false);
    expect(TI.isAccepted("Completed", null, true)).toBe(false);
    expect(TI.isAccepted("Completed", null, false)).toBe(true);
    expect(TI.isAccepted("Open", null, false)).toBe(true);
    expect(TI.isAccepted("Rejected", null, false)).toBe(false);
  });
  const period = { startDate: "2026-10-01", endDate: "2026-10-31", timeFromDate: "2026-09-26", timeToDate: "2026-10-25" };
  const entries = [
    { date: "2026-09-26", timeType: "RG", isOvertime: false, hours: 8, project: "P1", sourceId: "a1" },
    { date: "2026-10-04", timeType: "OT", isOvertime: true, hours: 2, sourceId: "a2" },
    { date: "2026-10-26", timeType: "RG", isOvertime: false, hours: 8, sourceId: "a3" },
    { date: "2026-10-05", timeType: "RG", isOvertime: false, hours: 0, sourceId: "a4" },
  ];
  test("nguồn OT timesheet: lấy cả OT, theo cửa sổ kết công", () => {
    const r = TI.buildTimeLines({ period, weeklyOff: "0", holidays: [], fromRequests: false, entries });
    expect(r.lines.map((l) => l.sourceId)).toEqual(["a1", "a2"]);
    expect(r.lines[1]).toMatchObject({ dayType: "W", isOvertime: true, weekStart: "2026-09-28" });
    expect(r).toMatchObject({ overtimeHours: 2, regularHours: 8 });
  });
  test("nguồn OT đơn: bỏ OT timesheet, thêm đơn OT theo ngày kỳ", () => {
    const r = TI.buildTimeLines({ period, weeklyOff: "0", holidays: [], fromRequests: true, entries,
      overtimeRequests: [{ refNbr: "OT1", workDate: "2026-10-28", hours: 3, dayType: "N", earningType: "OT150" }, { refNbr: "OT2", workDate: "2026-09-28", hours: 3 }] });
    expect(r.lines.map((l) => l.sourceId)).toEqual(["a1", "OT1"]);
    expect(r.overtimeHours).toBe(3);
  });
  test("giới hạn OT một ngày", () => {
    expect(TI.checkDailyLimit(2, 2, "N").exceeded).toBe(false);
    expect(TI.checkDailyLimit(2, 2.5, "N").exceeded).toBe(true);
    expect(TI.checkDailyLimit(8, 4, "W").exceeded).toBe(false);
  });
  test("loại thu nhập OT mặc định", () => {
    expect(TI.defaultOvertimeEarningType(Defaults.earningTypes, "N", false)).toBe("OT150");
    expect(TI.defaultOvertimeEarningType(Defaults.earningTypes, "H", true)).toBe("OTD300");
    const withHad = Defaults.earningTypes.concat([{ code: "OTD150A", isOvertime: true, overtimeDayType: "N", isNight: true, hadDaytimeOvertime: true }]);
    expect(TI.defaultOvertimeEarningType(withHad, "N", true)).toBe("OTD150");
  });
});
