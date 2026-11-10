// Lưới công theo kỳ của giao diện bản 2 (core/AttendanceMonthGrid): ô ngày, tổng, ngoại lệ theo ba nguồn công.
const { core, Defaults } = require("./helpers");
const Grid = core("AttendanceMonthGrid");
const Summary = core("AttendanceSummaryCalculator");

// 03/2027: ngày 1 là Thứ 2; Chủ nhật là 7, 14, 21, 28; Thứ 7 là 6, 13, 20, 27
const PERIOD = { startDate: "2027-03-01", endDate: "2027-03-31", standardWorkDays: 23 };
const OFF = "0,6";
const SYMBOLS = Defaults.attendanceSymbols.map((s) => ({ code: s.code, category: s.category, days: Number(s.days) }));
const LEAVE_TYPES = {
  10: { code: "PN", isPaid: true, deductsWorkDays: false, paidBySocialInsurance: false },
  11: { code: "KL", isPaid: false, deductsWorkDays: true, paidBySocialInsurance: false },
  12: { code: "OM", isPaid: false, deductsWorkDays: true, paidBySocialInsurance: true },
};
const emp = (id, extra = {}) => Object.assign({ employee: String(id), code: `E${id}`, name: `NV ${id}`, employmentType: "E", salaryType: "M", hireDate: null, terminationDate: null }, extra);
const base = (extra = {}) => Object.assign({ period: PERIOD, mode: "E", weeklyOff: OFF, holidays: [], leaveTypes: LEAVE_TYPES, symbols: SYMBOLS, employees: [emp(1)], summaries: [], sheets: [], leaves: [], trips: [], exceptions: [], overtime: [], time: [] }, extra);
const cell = (grid, row, day) => grid.rows[row].cells[day - 1];
const sym = (grid, row = 0) => grid.rows[row].cells.map((c) => c.s);
const types = (grid) => grid.exceptions.map((e) => e.type);

describe("days - ngày của kỳ", () => {
  test("theo ngày bắt đầu - kết thúc kỳ, không theo tháng lịch", () => {
    const d = Grid.days({ startDate: "2027-02-26", endDate: "2027-03-25" }, OFF, []);
    expect(d).toHaveLength(28);
    expect(d[0]).toMatchObject({ date: "2027-02-26", day: 26, month: 2, dow: 5, type: "N" });
    expect(d[1].type).toBe("W");
    expect(d[3]).toMatchObject({ date: "2027-03-01", day: 1, month: 3 });
    expect(d[27].date).toBe("2027-03-25");
  });

  test("ngày lễ thắng ngày nghỉ tuần, kèm tên; chuỗi nghỉ tuần trống là Chủ nhật", () => {
    const d = Grid.days(PERIOD, "", [{ date: "2027-03-07", name: "Lễ thử" }, "2027-03-10"]);
    expect(d[6]).toMatchObject({ type: "H", name: "Lễ thử" });
    expect(d[9].type).toBe("H");
    expect(d[9].name).toBeUndefined();
    expect(d[13].type).toBe("W");
    expect(d[5].type).toBe("N");
  });

  test("kỳ thiếu ngày hoặc ngược ngày: không có ngày nào", () => {
    expect(Grid.days({ startDate: "2027-03-10", endDate: "2027-03-01" }, OFF, [])).toEqual([]);
    expect(Grid.days({}, OFF, [])).toEqual([]);
  });
});

describe("nguồn E - ô suy từ chứng từ", () => {
  test("không có chứng từ: ngày thường đủ công, nghỉ tuần trống, lễ ký hiệu L", () => {
    const g = Grid.build(base({ holidays: ["2027-03-10"] }));
    expect(g.days).toHaveLength(31);
    expect(cell(g, 0, 1)).toEqual({ s: "X", k: "W", v: 1 });
    expect(cell(g, 0, 6)).toEqual({ s: "", k: "N" });
    expect(cell(g, 0, 10)).toEqual({ s: "L", k: "N" });
    expect(g.rows[0]).toMatchObject({ source: "docs", estimated: true, hasSummary: false, open: 0 });
    // 23 công chuẩn, không trừ gì
    expect(g.rows[0].totals).toMatchObject({ std_days: 23, work_days: 23, paid_leave: 0, ot_hours: 0 });
    expect(g.exceptions).toEqual([]);
    expect(g.hasSummary).toBe(false);
  });

  test("đơn nghỉ đã duyệt: có lương P, không lương K, BHXH Ô; bỏ qua ngày nghỉ tuần", () => {
    const g = Grid.build(base({
      leaves: [
        { id: 1, employee: "1", from: "2027-03-05", to: "2027-03-08", leave_type: "10", status: "A" },
        { id: 2, employee: "1", from: "2027-03-16", to: "2027-03-16", leave_type: "11", status: "A" },
        { id: 3, employee: "1", from: "2027-03-17", to: "2027-03-18", leave_type: "12", status: "A" },
      ],
    }));
    expect(sym(g).slice(4, 8)).toEqual(["P", "", "", "P"]);
    expect(cell(g, 0, 5)).toEqual({ s: "P", k: "P", v: 1 });
    expect(cell(g, 0, 16)).toEqual({ s: "K", k: "U", v: 0 });
    expect(cell(g, 0, 17)).toEqual({ s: "Ô", k: "S", v: 0 });
    expect(g.rows[0].totals).toMatchObject({ paid_leave: 2, unpaid_leave: 1, si_leave: 2, work_days: 20 });
  });

  test("nửa ngày: ngày đầu bắt đầu chiều, ngày cuối kết thúc sáng", () => {
    const g = Grid.build(base({ leaves: [{ id: 1, employee: "1", from: "2027-03-02", to: "2027-03-04", from_half: "P", to_half: "A", leave_type: "11", status: "A" }] }));
    expect(cell(g, 0, 2)).toEqual({ s: "K/2", k: "U", v: 0.5 });
    expect(cell(g, 0, 3)).toEqual({ s: "K", k: "U", v: 0 });
    expect(cell(g, 0, 4)).toEqual({ s: "K/2", k: "U", v: 0.5 });
    expect(g.rows[0].totals.unpaid_leave).toBe(2);
    expect(Grid.leavePortion({ from: "2027-03-02", to: "2027-03-02", from_half: "A", to_half: "A" }, "2027-03-02")).toBe(0.5);
    expect(Grid.leavePortion({ from: "2027-03-02", to: null }, "2027-03-03")).toBe(0);
  });

  test("công tác đã duyệt: CT, vẫn đủ công; đơn nghỉ cùng ngày thắng công tác", () => {
    const g = Grid.build(base({
      trips: [{ id: 1, employee: "1", from: "2027-03-22", to: "2027-03-23", status: "A" }],
      leaves: [{ id: 2, employee: "1", from: "2027-03-23", to: "2027-03-23", leave_type: "10", status: "A" }],
    }));
    expect(cell(g, 0, 22)).toEqual({ s: "CT", k: "T", v: 1 });
    expect(cell(g, 0, 23).k).toBe("P");
    expect(g.rows[0].totals.trip_days).toBe(2);
  });

  test("phiếu ngoại lệ đã duyệt: trễ trừ công lẻ, điều chỉnh -1 thành 0 công, +1 ở ngày nghỉ tuần", () => {
    const g = Grid.build(base({
      exceptions: [
        { id: 1, employee: "1", work_date: "2027-03-02", exception_type: "L", minutes: 20, deduct_days: 0.25, status: "A" },
        { id: 2, employee: "1", work_date: "2027-03-03", exception_type: "A", adjust_days: -1, status: "A", from_punches: true },
        { id: 3, employee: "1", work_date: "2027-03-06", exception_type: "A", adjust_days: 1, status: "A" },
        { id: 4, employee: "1", work_date: "2027-03-04", exception_type: "A", adjust_days: -0.5, status: "A" },
        { id: 5, employee: "1", work_date: "2027-03-05", exception_type: "L", minutes: 3, deduct_days: 0, status: "A" },
      ],
    }));
    expect(cell(g, 0, 2)).toEqual({ s: "0,75", k: "A", v: 0.75, late: 1 });
    expect(cell(g, 0, 3)).toEqual({ s: "0", k: "A", v: 0 });
    expect(cell(g, 0, 6)).toEqual({ s: "X", k: "A", v: 1 });
    expect(cell(g, 0, 4)).toEqual({ s: "/2", k: "A", v: 0.5 });
    // Trễ trong ân hạn (không trừ): vẫn là ngày công bình thường, có dấu trễ
    expect(cell(g, 0, 5)).toEqual({ s: "X", k: "W", v: 1, late: 1 });
    expect(g.rows[0].totals).toMatchObject({ late_days: 0.25, adjust_days: -0.5, work_days: 22.25 });
  });

  test("chứng từ chưa duyệt không đổi ô, nhưng đánh dấu chờ xử lý và sinh ngoại lệ", () => {
    const g = Grid.build(base({
      leaves: [{ id: 7, name: "NP7", employee: "1", from: "2027-03-12", to: "2027-03-15", leave_type: "10", days: 2, status: "P" }],
      exceptions: [
        { id: 8, name: "NL8", employee: "1", work_date: "2027-03-02", exception_type: "A", adjust_days: 0, status: "H", from_punches: true },
        { id: 9, name: "NL9", employee: "1", work_date: "2027-03-02", exception_type: "L", minutes: 20, deduct_days: 0.25, status: "H", from_punches: true },
        { id: 10, employee: "1", work_date: "2027-03-03", exception_type: "A", adjust_days: -1, status: "R" },
      ],
      overtime: [{ id: 11, name: "OT11", employee: "1", work_date: "2027-03-07", hours: 3, status: "P" }],
    }));
    expect(cell(g, 0, 12)).toEqual({ s: "X", k: "W", v: 1, p: 1 });
    // Thứ 7, Chủ nhật trong đơn nghỉ không đánh dấu; đơn làm thêm ngày Chủ nhật có đánh dấu
    expect(cell(g, 0, 13)).toEqual({ s: "", k: "N" });
    expect(cell(g, 0, 15).p).toBe(1);
    expect(cell(g, 0, 2)).toEqual({ s: "X", k: "W", v: 1, p: 2 });
    expect(cell(g, 0, 3)).toEqual({ s: "X", k: "W", v: 1 });
    expect(cell(g, 0, 7)).toEqual({ s: "", k: "N", p: 1 });
    expect(g.exceptions.map((e) => e.key)).toEqual(["doc:exception:8", "doc:exception:9", "doc:ot:11", "doc:leave:7"]);
    expect(g.exceptions[0]).toMatchObject({ type: "pendingDoc", severity: "warn", subtype: "missingPunch", docName: "NL8", status: "H", date: "2027-03-02", dayIndex: 1, fromPunches: true });
    expect(g.exceptions[1]).toMatchObject({ subtype: "late", minutes: 20, days: -0.25 });
    expect(g.exceptions[2]).toMatchObject({ docType: "ot", hours: 3, dayIndex: 6 });
    expect(g.exceptions[3]).toMatchObject({ docType: "leave", days: 2, leaveType: "PN", from: "2027-03-12", to: "2027-03-15", dayIndex: 11 });
    expect(g.counts).toEqual({ open: 4, info: 0, byType: { "pendingDoc.exception": 2, "pendingDoc.ot": 1, "pendingDoc.leave": 1 } });
    expect(g.rows[0].open).toBe(4);
    expect(g.stats.docs).toEqual({ leave: 1, trip: 0, ot: 1, exception: 2, pending: 4 });
    expect(g.legend.pending).toBe(true);
  });

  test("đơn chờ duyệt bắt đầu trước kỳ: ngày của ngoại lệ là ngày đầu kỳ", () => {
    const g = Grid.build(base({ leaves: [{ id: 1, employee: "1", from: "2027-02-25", to: "2027-03-02", leave_type: "10", status: "H" }] }));
    expect(g.exceptions[0]).toMatchObject({ date: "2027-03-01", dayIndex: 0, from: "2027-02-25" });
    expect(cell(g, 0, 1).p).toBe(1);
    expect(cell(g, 0, 3).p).toBeUndefined();
  });

  test("giờ làm thêm đã duyệt cộng vào ô và tổng", () => {
    const g = Grid.build(base({
      overtime: [
        { id: 1, employee: "1", work_date: "2027-03-02", hours: 2, status: "A" },
        { id: 2, employee: "1", work_date: "2027-03-02", hours: 1.5, status: "A" },
        { id: 3, employee: "1", work_date: "2027-03-07", hours: 4, status: "A" },
        { id: 4, employee: "1", work_date: "2027-03-08", hours: 4, status: "C" },
      ],
    }));
    expect(cell(g, 0, 2)).toEqual({ s: "X", k: "W", v: 1, ot: 3.5 });
    expect(cell(g, 0, 7)).toEqual({ s: "", k: "N", ot: 4 });
    expect(cell(g, 0, 8).ot).toBeUndefined();
    expect(g.rows[0].totals.ot_hours).toBe(7.5);
    expect(g.stats.otHours).toBe(7.5);
    expect(g.legend.ot).toBe(true);
  });

  test("ngoài thời hạn hợp đồng: ô nhóm O, tính vào nghỉ không lương như bộ tính tổng hợp", () => {
    const g = Grid.build(base({ employees: [emp(1, { hireDate: "2027-03-10", terminationDate: "2027-03-19" })] }));
    expect(cell(g, 0, 9)).toEqual({ s: "", k: "O" });
    expect(cell(g, 0, 10).k).toBe("W");
    expect(cell(g, 0, 19).k).toBe("W");
    expect(cell(g, 0, 22)).toEqual({ s: "", k: "O" });
    // Làm 8 ngày công (10-12, 15-19), 15 ngày ngoài hợp đồng
    expect(g.rows[0].totals).toMatchObject({ unpaid_leave: 15, work_days: 8 });
  });

  test("số dự tính khớp AttendanceSummaryCalculator.buildExceptions", () => {
    const input = base({
      holidays: ["2027-03-10"],
      leaves: [{ id: 1, name: "NP1", employee: "1", from: "2027-03-09", to: "2027-03-11", from_half: "P", leave_type: "11", status: "A" }],
      trips: [{ id: 2, name: "CT2", employee: "1", from: "2027-03-27", to: "2027-04-02", status: "A" }],
      exceptions: [{ id: 3, name: "NL3", employee: "1", work_date: "2027-03-02", exception_type: "E", deduct_days: 0.5, status: "A" }],
      overtime: [{ id: 4, name: "OT4", employee: "1", work_date: "2027-03-02", hours: 2, status: "A" }],
    });
    const g = Grid.build(input);
    const t = Summary.buildExceptions({
      period: PERIOD, employee: {}, weeklyOff: OFF, holidays: ["2027-03-10"],
      leaveRequests: [{ fromDate: "2027-03-09", toDate: "2027-03-11", fromHalf: "P", toHalf: "P", leaveType: LEAVE_TYPES[11] }],
      trips: [{ fromDate: "2027-03-27", toDate: "2027-04-02" }],
      exceptions: [{ workDate: "2027-03-02", exceptionType: "E", deductDays: 0.5, adjustDays: 0 }],
      overtime: [{ workDate: "2027-03-02", hours: 2 }],
    });
    expect(g.rows[0].totals).toEqual({
      std_days: t.standardDays, paid_leave: t.paidLeaveDays, unpaid_leave: t.unpaidLeaveDays, si_leave: t.socialInsuranceLeaveDays, trip_days: t.businessTripDays,
      late_days: t.lateEarlyDays, adjust_days: t.adjustmentDays, work_days: t.workDays, ot_hours: t.overtimeHours,
    });
    // Tổng số công của các ô ngày thường khớp công hưởng lương khi công chuẩn bằng số ngày làm việc của kỳ (22 vì có 1 ngày lễ)
    const g22 = Grid.build(Object.assign({}, input, { period: Object.assign({}, PERIOD, { standardWorkDays: 22 }) }));
    const sum = g22.rows[0].cells.reduce((a, c) => a + (c.v || 0), 0);
    expect(sum).toBe(g22.rows[0].totals.work_days);
  });
});

describe("bảng tổng hợp đã lập", () => {
  const summary = (extra = {}) => Object.assign({ employee: "1", std_days: 23, paid_leave: 0, unpaid_leave: 0, si_leave: 0, trip_days: 0, late_days: 0, adjust_days: 0, work_days: 23, ot_hours: 0, status: "O" }, extra);

  test("có dòng tổng hợp khớp chứng từ: lấy số đã lập, không có ngoại lệ", () => {
    const g = Grid.build(base({ summaries: [summary()] }));
    expect(g.hasSummary).toBe(true);
    expect(g.rows[0]).toMatchObject({ hasSummary: true, locked: false, stale: false });
    expect(g.rows[0].estimated).toBeUndefined();
    expect(g.exceptions).toEqual([]);
  });

  test("chứng từ duyệt sau khi lập: dòng cũ, cần tổng hợp lại; đã khóa thì không báo", () => {
    const leaves = [{ id: 1, employee: "1", from: "2027-03-02", to: "2027-03-02", leave_type: "11", status: "A" }];
    const g = Grid.build(base({ summaries: [summary()], leaves }));
    expect(g.rows[0].stale).toBe(true);
    // Số hiển thị vẫn là số đã lập (đang dùng để tính lương), không phải số tính lại
    expect(g.rows[0].totals.work_days).toBe(23);
    expect(types(g)).toEqual(["staleSummary"]);
    expect(g.counts.open).toBe(1);
    const locked = Grid.build(base({ summaries: [summary({ status: "L" })], leaves }));
    expect(locked.rows[0]).toMatchObject({ locked: true, stale: true });
    expect(locked.exceptions).toEqual([]);
  });

  test("nhân viên chưa có dòng khi kỳ đã lập bảng tổng hợp", () => {
    const g = Grid.build(base({ employees: [emp(1), emp(2)], summaries: [summary()] }));
    expect(g.exceptions).toEqual([{ key: "nosummary:2", type: "noSummary", severity: "warn", employee: "2" }]);
    expect(g.rows[1]).toMatchObject({ estimated: true, open: 1 });
    expect(g.stats).toMatchObject({ employees: 2, summaryEmployees: 2, estimated: 1, workDays: 46, standardDays: 46 });
  });

  test("công hưởng lương vượt công chuẩn: ngoại lệ chỉ để biết, không tính vào số cần xử lý", () => {
    const g = Grid.build(base({
      summaries: [summary({ adjust_days: 1, work_days: 24 })],
      exceptions: [{ id: 1, employee: "1", work_date: "2027-03-06", exception_type: "A", adjust_days: 1, status: "A" }],
    }));
    expect(g.exceptions).toEqual([{ key: "over:1", type: "overStandard", severity: "info", employee: "1", workDays: 24, standardDays: 23 }]);
    expect(g.counts).toEqual({ open: 0, info: 1, byType: { overStandard: 1 } });
    expect(g.rows[0].open).toBe(0);
  });

  test("dòng tổng hợp của nhân viên ngoài danh sách bị bỏ qua", () => {
    const g = Grid.build(base({ summaries: [summary({ employee: "99" })] }));
    expect(g.hasSummary).toBe(false);
    expect(g.exceptions).toEqual([]);
  });
});

describe("nguồn S - bảng công ký hiệu", () => {
  const row = (cells) => ({ employee: "1", cells });
  const full = () => {
    const out = [];
    for (let d = 1; d <= 31; d++) out.push([6, 7, 13, 14, 20, 21, 27, 28].includes(d) ? "" : "X");
    return out;
  };

  test("ký hiệu tra theo danh mục, không phân biệt hoa thường; ô trống ngày nghỉ không báo thiếu", () => {
    const cells = full();
    cells[1] = "p";
    cells[2] = "/2";
    cells[3] = "ct";
    cells[4] = "Ô";
    cells[5] = "N";
    const g = Grid.build(base({ mode: "S", sheets: [row(cells)] }));
    expect(g.rows[0]).toMatchObject({ source: "sheet", hasSheet: true });
    expect(cell(g, 0, 1)).toEqual({ s: "X", k: "W", v: 1 });
    expect(cell(g, 0, 2)).toEqual({ s: "P", k: "P", v: 1 });
    expect(cell(g, 0, 3)).toEqual({ s: "/2", k: "W", v: 0.5 });
    expect(cell(g, 0, 4)).toEqual({ s: "CT", k: "T", v: 1 });
    expect(cell(g, 0, 5)).toEqual({ s: "Ô", k: "S", v: 1 });
    expect(cell(g, 0, 6)).toEqual({ s: "N", k: "N" });
    expect(cell(g, 0, 7)).toEqual({ s: "", k: "N" });
    expect(g.exceptions).toEqual([]);
    // 19 X + 0,5 + phép 1 + công tác 1 = 21,5 công hưởng lương; Ô trừ 1
    expect(g.rows[0].totals).toMatchObject({ paid_leave: 1, si_leave: 1, trip_days: 1, work_days: 21.5 });
  });

  test("ô trống ngày làm việc là thiếu dữ liệu, ký hiệu lạ là không hợp lệ", () => {
    const cells = full();
    cells[1] = "";
    cells[8] = "";
    cells[2] = "ZZ";
    cells[3] = "zz";
    cells[4] = "QQ";
    const g = Grid.build(base({ mode: "S", sheets: [row(cells)] }));
    expect(cell(g, 0, 2)).toEqual({ s: "", k: "M" });
    expect(cell(g, 0, 3)).toEqual({ s: "ZZ", k: "?" });
    expect(g.exceptions).toEqual([
      { key: "missing:1", type: "sheetMissing", severity: "warn", employee: "1", count: 2, dayIndex: 1, date: "2027-03-02" },
      { key: "unknown:1", type: "unknownSymbol", severity: "warn", employee: "1", count: 3, codes: ["ZZ", "zz", "QQ"], dayIndex: 2, date: "2027-03-03" },
    ]);
    expect(g.rows[0].open).toBe(2);
  });

  test("nhân viên chưa có dòng bảng công: ô để trống, một ngoại lệ (không báo thêm thiếu dòng tổng hợp)", () => {
    const g = Grid.build(base({ mode: "S", employees: [emp(1), emp(2)], sheets: [row(full())], summaries: [{ employee: "1", std_days: 23, work_days: 23, status: "O" }] }));
    expect(g.rows[1]).toMatchObject({ hasSheet: false, estimated: true });
    expect(g.rows[1].cells.every((c) => c.s === "")).toBe(true);
    expect(g.rows[1].cells[0]).toEqual({ s: "", k: "W", none: 1 });
    expect(g.exceptions.filter((e) => e.employee === "2")).toEqual([{ key: "nosheet:2", type: "noSheetRow", severity: "warn", employee: "2" }]);
    // Ô chưa có dữ liệu không vào chú giải
    expect(g.legend.items).toEqual([{ s: "X", k: "W" }]);
  });

  test("cộng tác viên ở nhóm bảng công ký hiệu dùng bảng công, không dùng giờ Time", () => {
    const g = Grid.build(base({ mode: "S", employees: [emp(1, { employmentType: "C", salaryType: "H" })], sheets: [row(full())], time: [{ employee: "1", date: "2027-03-02", hours: 8, approval: "A" }] }));
    expect(g.rows[0].source).toBe("sheet");
    expect(cell(g, 0, 2).s).toBe("X");
    expect(g.stats.contractors).toBe(0);
  });

  test("kỳ ngắn hơn 31 ngày: chỉ lấy ô của các ngày trong kỳ; đơn làm thêm vẫn cộng", () => {
    const cells = ["X", "X", "X", "X", "X", "", "", "X", "X", "X"];
    const g = Grid.build(base({
      mode: "S", period: { startDate: "2027-03-01", endDate: "2027-03-07", standardWorkDays: 5 }, sheets: [row(cells)],
      overtime: [{ id: 1, employee: "1", work_date: "2027-03-03", hours: 2, status: "A" }],
    }));
    expect(g.days).toHaveLength(7);
    expect(g.rows[0].cells).toHaveLength(7);
    expect(g.rows[0].totals).toMatchObject({ work_days: 5, ot_hours: 2 });
    expect(cell(g, 0, 3).ot).toBe(2);
  });

  test("danh mục ký hiệu riêng của khách: ký hiệu đại diện lấy mã ngắn nhất cùng nhóm, cùng số ngày", () => {
    const t = Grid.symbolTable([{ code: "XD", category: "W", days: 1 }, { code: "+", category: "W", days: 1 }, { code: "NB", category: "N", days: 0 }]);
    expect(t.of("W", 1)).toBe("+");
    expect(t.of("N", 0)).toBe("NB");
    // Nhóm chưa có trong danh mục: dùng ký hiệu mặc định của gói
    expect(t.of("P", 1)).toBe("P");
    expect(t.of("U", 0.5)).toBe("K/2");
    expect(t.get(" xd ")).toMatchObject({ code: "XD", category: "W" });
    expect(t.get("??")).toBeNull();
    expect(Grid.symbolTable(null).of("W", 1)).toBe("X");
  });
});

describe("cộng tác viên - giờ từ Time", () => {
  const ctv = emp(3, { employmentType: "C", salaryType: "H" });

  test("giờ đã duyệt vào ô và tổng; giờ chờ duyệt đánh dấu và sinh ngoại lệ", () => {
    const g = Grid.build(base({
      employees: [ctv],
      time: [
        { employee: "3", date: "2027-03-01", hours: 8, approval: "A" },
        { employee: "3", date: "2027-03-02", hours: 4, approval: "A" },
        { employee: "3", date: "2027-03-02", hours: 3.5, approval: "A" },
        { employee: "3", date: "2027-03-15", hours: 4, approval: "P" },
        { employee: "3", date: "2027-03-16", hours: 6, approval: "R" },
        { employee: "3", date: "2027-03-07", hours: 2, approval: "A" },
      ],
    }));
    expect(g.rows[0]).toMatchObject({ source: "time", contractor: true, hours: 17.5, pendingHours: 4 });
    expect(g.rows[0].totals).toBeUndefined();
    expect(cell(g, 0, 1)).toEqual({ s: "8", k: "H", h: 8 });
    expect(cell(g, 0, 2)).toEqual({ s: "7,5", k: "H", h: 7.5 });
    expect(cell(g, 0, 15)).toEqual({ s: "4", k: "H", h: 0, hp: 4 });
    expect(cell(g, 0, 16)).toEqual({ s: "", k: "H" });
    expect(cell(g, 0, 7)).toEqual({ s: "2", k: "H", h: 2 });
    expect(cell(g, 0, 6)).toEqual({ s: "", k: "N" });
    expect(g.exceptions).toEqual([{ key: "pendinghours:3", type: "pendingHours", severity: "warn", employee: "3", hours: 4, date: "2027-03-15", dayIndex: 14 }]);
    expect(g.stats).toMatchObject({ contractors: 1, contractorHours: 17.5, contractorPending: 4, summaryEmployees: 0 });
    expect(g.legend.pending).toBe(true);
  });

  test("thiết lập không bắt buộc duyệt: giờ chờ duyệt vẫn được nhận, giờ bị từ chối thì không", () => {
    const g = Grid.build(base({
      employees: [ctv], requireTimeApproval: false,
      time: [{ employee: "3", date: "2027-03-01", hours: 8, approval: "P" }, { employee: "3", date: "2027-03-02", hours: 8, approval: "R" }],
    }));
    expect(g.rows[0]).toMatchObject({ hours: 8, pendingHours: 0 });
    expect(g.exceptions).toEqual([]);
  });

  test("account không dùng duyệt Time: nhận mọi dòng", () => {
    const g = Grid.build(base({ employees: [ctv], time: [{ employee: "3", date: "2027-03-01", hours: 8, approval: "N" }] }));
    expect(g.rows[0].hours).toBe(8);
  });

  test("cộng tác viên hưởng theo giờ chưa có giờ: ngoại lệ để biết; không theo giờ thì không báo", () => {
    const g = Grid.build(base({ employees: [ctv, emp(4, { employmentType: "C", salaryType: "M" })] }));
    expect(g.exceptions).toEqual([{ key: "nohours:3", type: "noHours", severity: "info", employee: "3" }]);
    expect(g.counts.open).toBe(0);
  });

  test("giờ ngoài các ngày của kỳ (cửa sổ kết công lệch kỳ) vẫn tính vào tổng, không có ô", () => {
    const g = Grid.build(base({ employees: [ctv], time: [{ employee: "3", date: "2027-02-27", hours: 5, approval: "A" }] }));
    expect(g.rows[0].hours).toBe(5);
    expect(g.rows[0].cells.every((c) => c.s === "")).toBe(true);
  });
});

describe("phạm vi nhân viên, sắp xếp, chú giải", () => {
  test("nhân viên nghỉ việc trước kỳ, vào làm sau kỳ, ngừng hoạt động không nghỉ trong kỳ bị loại", () => {
    const g = Grid.build(base({
      employees: [
        emp(1, { terminationDate: "2027-02-28" }),
        emp(2, { hireDate: "2027-04-01" }),
        emp(3, { isInactive: true }),
        emp(4, { isInactive: true, terminationDate: "2027-03-15" }),
        emp(5),
      ],
    }));
    expect(g.rows.map((r) => r.employee)).toEqual(["4", "5"]);
    expect(Grid.inPeriod(emp(1, { hireDate: "2027-03-31" }), PERIOD)).toBe(true);
  });

  test("chứng từ của nhân viên ngoài lưới không sinh ngoại lệ, không vào thống kê", () => {
    const g = Grid.build(base({ leaves: [{ id: 1, employee: "99", from: "2027-03-02", to: "2027-03-02", leave_type: "10", status: "P" }] }));
    expect(g.exceptions).toEqual([]);
    expect(g.stats.docs.leave).toBe(0);
  });

  test("ngoại lệ: việc cần xử lý trước, rồi theo ngày, theo mã nhân viên", () => {
    const g = Grid.build(base({
      employees: [emp(2), emp(1), emp(3, { employmentType: "C", salaryType: "H" })],
      exceptions: [
        { id: 1, employee: "2", work_date: "2027-03-05", exception_type: "L", status: "P" },
        { id: 2, employee: "1", work_date: "2027-03-05", exception_type: "L", status: "P" },
        { id: 3, employee: "2", work_date: "2027-03-02", exception_type: "E", status: "H" },
      ],
    }));
    expect(g.exceptions.map((e) => e.key)).toEqual(["doc:exception:3", "doc:exception:2", "doc:exception:1", "nohours:3"]);
    expect(g.exceptions[0].subtype).toBe("early");
  });

  test("chú giải chỉ gồm ký hiệu có trong lưới, theo thứ tự nhóm", () => {
    const g = Grid.build(base({
      employees: [emp(1), emp(3, { employmentType: "C", salaryType: "H" })],
      holidays: ["2027-03-10"],
      leaves: [{ id: 1, employee: "1", from: "2027-03-02", to: "2027-03-02", to_half: "A", leave_type: "10", status: "A" }, { id: 2, employee: "1", from: "2027-03-03", to: "2027-03-03", leave_type: "10", status: "A" }],
      exceptions: [{ id: 3, employee: "1", work_date: "2027-03-04", exception_type: "L", deduct_days: 0.25, status: "A" }],
      time: [{ employee: "3", date: "2027-03-01", hours: 8, approval: "A" }],
    }));
    expect(g.legend).toEqual({ items: [{ s: "X", k: "W" }, { s: "P", k: "P" }, { s: "P/2", k: "P" }, { s: "L", k: "N" }, { s: "", k: "A" }, { s: "", k: "H" }], pending: false, ot: false, late: true });
  });

  test("không có nhân viên hoặc kỳ lỗi ngày: lưới rỗng, không ném lỗi", () => {
    expect(Grid.build(base({ employees: [] }))).toMatchObject({ rows: [], exceptions: [], counts: { open: 0, info: 0 } });
    const bad = Grid.build(base({ period: { startDate: null, endDate: null } }));
    expect(bad.days).toEqual([]);
    expect(bad.rows).toEqual([]);
    expect(Grid.build({}).rows).toEqual([]);
  });

  test("exceptionSubtype và short", () => {
    expect(Grid.exceptionSubtype({ exception_type: "A", adjust_days: -1, from_punches: true })).toBe("absent");
    expect(Grid.exceptionSubtype({ exception_type: "A", adjust_days: 0, from_punches: true })).toBe("missingPunch");
    expect(Grid.exceptionSubtype({ exception_type: "A", adjust_days: -1 })).toBe("adjust");
    expect(Grid.short(7.756)).toBe("7,76");
    expect(Grid.short(8)).toBe("8");
    expect(Grid.short(null)).toBe("0");
  });
});

describe("pack / unpack - nén ô ngày", () => {
  test("bảng ô khác nhau gửi một lần, dòng chỉ mang chỉ số; bung ra đúng như cũ", () => {
    const g = Grid.build(base({ employees: [emp(1), emp(2), emp(3, { employmentType: "C", salaryType: "H" })], leaves: [{ id: 1, employee: "1", from: "2027-03-02", to: "2027-03-02", leave_type: "10", status: "A" }] }));
    const p = Grid.pack(g.rows);
    // X, P, ô trống ngày nghỉ, và ô trống ngày thường của cộng tác viên
    expect(p.cellTable).toEqual([{ s: "X", k: "W", v: 1 }, { s: "P", k: "P", v: 1 }, { s: "", k: "N" }, { s: "", k: "H" }]);
    expect(p.rows[0].cells.slice(0, 7)).toEqual([0, 1, 0, 0, 0, 2, 2]);
    expect(p.rows[1].cells.every((i) => i === 0 || i === 2)).toBe(true);
    expect(p.rows[0].employee).toBe("1");
    // Không sửa dữ liệu gốc
    expect(g.rows[0].cells[0]).toEqual({ s: "X", k: "W", v: 1 });
    expect(Grid.unpack(p.cellTable, p.rows)).toEqual(g.rows);
    expect(Grid.pack(null)).toEqual({ cellTable: [], rows: [] });
  });
});

describe("packRows / unpackRows - nén cả lưới cho 1.000 nhân viên", () => {
  test("dãy ô và bộ số tổng giống nhau gửi một lần; trường mặc định không gửi; bung ra đúng như lưới gốc", () => {
    const employees = [];
    for (let i = 1; i <= 400; i++) employees.push(emp(i, i === 7 ? { hireDate: "2027-03-15" } : {}));
    employees.push(emp(900, { employmentType: "C", salaryType: "H" }));
    const g = Grid.build(base({ employees, leaves: [{ id: 1, employee: "1", from: "2027-03-02", to: "2027-03-02", leave_type: "10", status: "A" }] }));
    const p = Grid.packRows(g.rows);
    // Lịch chung, người có đơn nghỉ, người vào làm giữa kỳ, cộng tác viên: 4 dãy ô cho 401 dòng
    expect(p.cellRows).toHaveLength(4);
    expect(p.rows).toHaveLength(401);
    expect(p.rows[1]).toEqual({ employee: "2", code: g.rows[1].code, name: g.rows[1].name, cells: p.rows[2].cells, totals: p.rows[2].totals, estimated: true });
    expect(p.totalsKeys).toEqual(["std_days", "paid_leave", "unpaid_leave", "si_leave", "trip_days", "late_days", "adjust_days", "work_days", "ot_hours"]);
    expect(p.totalsTable.length).toBeLessThanOrEqual(3);
    expect(p.rows[400]).toMatchObject({ contractor: true, salaryType: "H", source: "time" });
    expect(p.rows[400].totals).toBeUndefined();
    expect(JSON.stringify(p).length).toBeLessThan(JSON.stringify(Grid.pack(g.rows)).length / 3);
    // Bung lại: cùng ô, cùng số tổng, cùng cờ (cờ false của lưới gốc có thể vắng mặt)
    const back = Grid.unpackRows(p);
    expect(back).toHaveLength(401);
    back.forEach((r, i) => {
      expect(r.cells).toEqual(g.rows[i].cells);
      expect(r.totals).toEqual(g.rows[i].totals);
      for (const k of ["employee", "code", "name", "department", "contractor", "salaryType", "source", "hasSummary", "locked", "open"]) expect(r[k]).toEqual(g.rows[i][k]);
      expect(!!r.estimated).toBe(!!g.rows[i].estimated);
      expect(!!r.stale).toBe(!!g.rows[i].stale);
    });
    expect(Grid.packRows(null)).toEqual({ cellTable: [], cellRows: [], totalsKeys: p.totalsKeys, totalsTable: [], rows: [] });
    expect(Grid.unpackRows(null)).toEqual([]);
  });

  test("nhân viên không có chứng từ dùng chung kết quả tính: số liệu giống hệt khi tính riêng từng người", () => {
    const many = Grid.build(base({ employees: [emp(1), emp(2), emp(3, { hireDate: "2027-03-15" }), emp(4, { hireDate: "2027-03-15" })] }));
    for (const r of many.rows) {
      const alone = Grid.build(base({ employees: [emp(Number(r.employee), r.employee === "3" || r.employee === "4" ? { hireDate: "2027-03-15" } : {})] })).rows[0];
      expect(r.cells).toEqual(alone.cells);
      expect(r.totals).toEqual(alone.totals);
    }
    // Đơn làm thêm của một người không lẫn sang người khác cùng lịch
    const g = Grid.build(base({ employees: [emp(1), emp(2), emp(5)], overtime: [{ id: 9, employee: "2", work_date: "2027-03-03", hours: 2, status: "A" }] }));
    expect(g.rows[1].cells[2].ot).toBe(2);
    expect(g.rows[0].cells[2].ot).toBeUndefined();
    expect(g.rows[2].cells[2].ot).toBeUndefined();
  });
});

describe("defaultPeriod - kỳ mặc định", () => {
  const P = (id, start, end, status = "O", attStatus = "O") => ({ id, start, end, status, attStatus });
  const list = [P(3, "2027-03-01", "2027-03-31"), P(1, "2027-01-01", "2027-01-31", "C", "L"), P(2, "2027-02-01", "2027-02-28", "O", "L"), P(4, "2027-04-01", "2027-04-30")];

  test("kỳ mở chứa hôm nay", () => {
    expect(Grid.defaultPeriod(list, "2027-03-15")).toBe("3");
    expect(Grid.defaultPeriod(list, "2027-04-01")).toBe("4");
  });

  test("hôm nay sau mọi kỳ: kỳ mở bắt đầu gần nhất; trước mọi kỳ mở (account bị dời ngày): kỳ mở sớm nhất", () => {
    expect(Grid.defaultPeriod(list, "2027-09-01")).toBe("4");
    expect(Grid.defaultPeriod(list, "2026-11-10")).toBe("3");
  });

  test("kỳ đã khóa công hoặc đã đóng bị bỏ qua; không còn kỳ mở thì lấy kỳ mới nhất", () => {
    expect(Grid.defaultPeriod(list, "2027-02-10")).toBe("3");
    expect(Grid.defaultPeriod([list[1], list[2]], "2027-02-10")).toBe("2");
    expect(Grid.defaultPeriod([], "2027-02-10")).toBeNull();
    expect(Grid.defaultPeriod(null, "2027-02-10")).toBeNull();
  });
});
