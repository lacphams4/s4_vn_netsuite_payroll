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

describe("Gộp giờ Time NetSuite thành giờ công tính lương", () => {
  test("đọc số giờ dạng thập phân và h:mm", () => {
    expect(Sync.parseHours(8)).toBe(8);
    expect(Sync.parseHours("7.5")).toBe(7.5);
    expect(Sync.parseHours("7:30")).toBe(7.5);
    expect(Sync.parseHours("0:20")).toBe(0.33);
    expect(Sync.parseHours("")).toBe(0);
    expect(Sync.parseHours("abc")).toBe(0);
  });
  test("gộp theo nhân viên, dự án, công việc; bỏ dòng 0 giờ", () => {
    const g = Sync.aggregate([
      { employee: "2684", project: "11", projectName: "DA A", task: "", hours: 8 },
      { employee: "2684", project: "11", projectName: "DA A", task: "", hours: "4:30" },
      { employee: "2684", project: "", task: "", hours: 6 },
      { employee: "2684", project: "12", task: "5", taskName: "Lắp đặt", hours: 0 },
      { employee: "2683", project: "", task: "", hours: 2 },
    ]);
    expect(g.map((x) => [x.key, x.hours, x.entries])).toEqual([["2683||", 2, 1], ["2684|11|", 12.5, 2], ["2684||", 6, 1]]);
    expect(g[1].projectName).toBe("DA A");
  });
  test("kết hợp plan: giờ HR đã sửa được giữ khi đồng bộ lại", () => {
    const src = {};
    for (const x of Sync.aggregate([{ employee: "2684", hours: 80 }])) src[x.key] = x.hours;
    const p = Sync.plan([{ lineId: 9, sourceId: "2684||", sourceHours: 76, hours: 78, source: "A" }], src);
    expect(p.updates).toEqual([{ lineId: 9, sourceHours: 80, hours: 78 }]);
    expect(p.inserts).toEqual([]);
  });
});
