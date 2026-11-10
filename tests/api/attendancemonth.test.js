// api/AttendanceMonth (GET attendanceMonth, attendanceEmployee) với Store giả: kiểm dạng dữ liệu trả về, phạm vi nhân viên,
// kỳ mặc định, quyền sửa. Mô-đun N/* và lớp đọc ghi record được thay bằng dữ liệu mẫu trong bộ nhớ.
const mockState = { role: "administrator", fx: {}, timeFails: false };

jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ roleId: mockState.role }) }), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const copy = (list) => (list || []).map((x) => Object.assign({}, x));
  return {
    // Điều kiện SQL không được diễn giải: dữ liệu mẫu chỉ cần lọc theo kỳ
    find: (name, opt) => copy(mockState.fx[name]).filter((x) => !opt || !opt.where || !/\{period\}/.test(opt.where) || String(x.period) === String(opt.params[0])),
    findIn: (name, field, ids) => copy(mockState.fx[name]).filter((x) => (ids || []).map(String).includes(String(x[field]))),
    get: (name, id) => copy(mockState.fx[name]).find((x) => String(x.id) === String(id)) || null,
    run: (sql, params) => params.map((id) => ({ id, entityid: `E0${id}`, firstname: `NV${id}`, lastname: "", deptname: "Kế toán" })),
  };
});
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({
  tenant: () => {
    if (!mockState.fx.setup.length) throw new Error("missing");
    return mockState.fx.setup[0];
  },
  holidays: () => mockState.fx.holiday,
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/TimeLines", () => ({
  windowOf: (p) => ({ from: p.time_from || p.start, to: p.time_to || p.end }),
  entries: (ids) => {
    if (mockState.timeFails) throw new Error("no timebill");
    return ids.includes("9")
      ? [{ employee: "9", date: "2027-03-01", hours: 8, approval: "A", projectName: "Dự án A", taskName: "" }, { employee: "9", date: "2027-03-15", hours: 4, approval: "P", projectName: "Dự án A", taskName: "" }]
      : [];
  },
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2026-11-10" }));

const Api = require("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/AttendanceMonth");

function fixtures(mode = "E") {
  const sheet = { id: "1", period: "5", employee: "7" };
  for (let d = 1; d <= 31; d++) sheet[`d${String(d).padStart(2, "0")}`] = [6, 7, 13, 14, 20, 21, 27, 28].includes(d) ? "" : d === 3 ? "ZZ" : "X";
  return {
    period: [
      { id: "5", name: "202703", paygroup: "1", start: "2027-03-01", end: "2027-03-31", std_days: 23, status: "O", att_status: "O" },
      { id: "4", name: "202702", paygroup: "1", start: "2027-02-01", end: "2027-02-28", std_days: 20, status: "O", att_status: "L" },
      { id: "6", name: "X-202703", paygroup: "2", start: "2027-01-01", end: "2027-01-31", std_days: 21, status: "O", att_status: "O" },
    ],
    paygroup: [{ id: "1", name: "DEFAULT", description: "Mặc định", att_source: mode, subsidiary: null }, { id: "2", name: "X", att_source: "E", subsidiary: "14" }],
    setup: [{ id: "1", weekly_off: "0,6", time_approval: true }],
    holiday: [{ date: "2027-03-10", name: "Lễ thử" }],
    leave_type: [{ id: "10", name: "pn", is_paid: true }, { id: "11", name: "KL", deducts_days: true }],
    att_symbol: [{ name: "X", category: "W", days: 1, description: "Ngày công" }, { name: "P", category: "P", days: 1 }, { name: "L", category: "N", days: 0 }],
    employee: [
      { id: "1", name: "p1", employee: "7", subsidiary: "13", paygroup: null, employment_type: "E", salary_type: "M" },
      { id: "2", name: "p2", employee: "8", subsidiary: "13", paygroup: "1", employment_type: "E", salary_type: "M", hire_date: "2027-03-08" },
      { id: "3", name: "p3", employee: "9", subsidiary: "13", paygroup: "1", employment_type: "C", salary_type: "H" },
      { id: "4", name: "p4", employee: "10", subsidiary: "14", paygroup: "1", employment_type: "E", salary_type: "M" },
      { id: "5", name: "p5", employee: "11", subsidiary: "13", paygroup: "2", employment_type: "E", salary_type: "M" },
      { id: "6", name: "p6", employee: "12", subsidiary: "13", paygroup: "1", employment_type: "E", salary_type: "M", termination_date: "2027-02-20", isInactive: true },
    ],
    attendance: [{ id: "1", period: "5", employee: "7", std_days: 23, paid_leave: 2, unpaid_leave: 0, si_leave: 0, trip_days: 0, late_days: 0, adjust_days: 0, work_days: 23, ot_hours: 0, status: "O" }],
    att_sheet: mode === "S" ? [sheet] : [],
    leave_request: [
      { id: "21", name: "NP21", employee: "7", from: "2027-03-09", to: "2027-03-11", leave_type: "10", days: 2, status: "A", reason: "Việc riêng" },
      { id: "22", name: "NP22", employee: "8", from: "2027-03-16", to: "2027-03-16", leave_type: "11", days: 1, status: "P" },
      { id: "23", name: "NP23", employee: "8", from: "2027-03-18", to: "2027-03-18", leave_type: "11", days: 1, status: "R" },
    ],
    business_trip: [],
    att_exception: [{ id: "41", name: "NL41", employee: "8", work_date: "2027-03-17", exception_type: "A", adjust_days: 0, status: "H", from_punches: true, reason: "x" }],
    ot_request: [],
    batch: [],
    punch: [
      { employee: "7", punch_date: "2027-03-02", punch_time: "2027-03-02 17:00", device: "Cổng 1", source: "I" },
      { employee: "7", punch_date: "2027-03-02", punch_time: "2027-03-02 08:20", device: "Cổng 1", source: "I" },
    ],
    roster: [{ employee: "7", work_date: "2027-03-02", shift: "1" }, { employee: "7", work_date: "2027-03-01", shift: null }],
    shift: [{ id: "1", name: "hc", start_time: "08:00", end_time: "17:00" }],
  };
}

beforeEach(() => {
  mockState.role = "administrator";
  mockState.timeFails = false;
  mockState.fx = fixtures();
});

describe("routes", () => {
  test("hai action GET cho mọi vai trò của gói, không có action POST (ghi dùng action cũ)", () => {
    expect(Object.keys(Api.routes.get)).toEqual(["attendanceMonth", "attendanceEmployee"]);
    expect(Api.routes.get.attendanceMonth.roles).toBe("all");
    expect(Api.routes.get.attendanceEmployee.roles).toBe("all");
    expect(Api.routes.post).toEqual({});
  });
});

describe("attendanceMonth", () => {
  test("kỳ, bước, lưới, ngoại lệ của công ty con đang chọn", () => {
    const r = Api.routes.get.attendanceMonth.run({ period: "5", subsidiary: "13" });
    expect(r.period).toEqual({
      id: "5", code: "202703", start: "2027-03-01", end: "2027-03-31", status: "O", attStatus: "O", stdDays: 23, paygroup: "1", paygroupCode: "DEFAULT", paygroupName: "Mặc định",
      mode: "E", timeFrom: "2027-03-01", timeTo: "2027-03-31",
    });
    expect(r).toMatchObject({ locked: false, closed: false, canEdit: true, canUnlock: true, hasBatch: false, hasSummary: true, otherSubsidiaries: 1, timeUnavailable: false, syncLimit: 150 });
    // Nhân viên 7 (nhóm trống = DEFAULT), 8, 9; 10 thuộc công ty con khác, 11 thuộc nhóm khác, 12 đã nghỉ trước kỳ
    expect(r.rows.map((x) => [x.employee, x.code, x.source])).toEqual([["7", "E07", "docs"], ["8", "E08", "docs"], ["9", "E09", "time"]]);
    expect(r.days).toHaveLength(31);
    expect(r.days[9]).toMatchObject({ type: "H", name: "Lễ thử" });
    // Ô ngày đã nén: chỉ số vào cellTable
    expect(r.rows[0].cells).toHaveLength(31);
    expect(r.rows[0].cells.every((i) => Number.isInteger(i) && r.cellTable[i])).toBe(true);
    expect(r.cellTable[r.rows[0].cells[8]]).toEqual({ s: "P", k: "P", v: 1 });
    expect(r.cellTable[r.rows[1].cells[0]]).toEqual({ s: "", k: "O" });
    expect(r.cellTable[r.rows[2].cells[14]]).toEqual({ s: "4", k: "H", h: 0, hp: 4 });
    expect(r.steps.map((s) => `${s.key}:${s.state}`)).toEqual(["collect:done", "exceptions:current", "lock:todo", "handoff:todo"]);
    expect(r.exceptions.map((e) => e.key)).toEqual(["pendinghours:9", "doc:leave:22", "doc:exception:41", "nosummary:8"]);
    expect(r.counts.open).toBe(4);
    expect(r.steps[1]).toMatchObject({ note: "openExceptions", count: 4 });
    expect(r.stats).toMatchObject({ employees: 3, contractors: 1, contractorHours: 8, contractorPending: 4 });
    expect(r.symbols[0]).toEqual({ code: "X", category: "W", days: 1, description: "Ngày công" });
  });

  test("chứng từ gọn cho khung chi tiết: bỏ đơn từ chối, mã loại nghỉ viết hoa", () => {
    const r = Api.month({ period: "5", subsidiary: "13" });
    expect(r.docs.map((d) => d.name)).toEqual(["NP21", "NP22", "NL41"]);
    expect(r.docs[0]).toEqual({ type: "leave", id: "21", name: "NP21", employee: "7", status: "A", reason: "Việc riêng", from: "2027-03-09", to: "2027-03-11", days: 2, leaveType: "PN", fromHalf: "A", toHalf: "P" });
    expect(r.docs[2]).toMatchObject({ type: "exception", subtype: "missingPunch", fromPunches: true, from: "2027-03-17", to: "2027-03-17", days: 0 });
  });

  test("không lọc công ty con: gồm mọi nhân viên của nhóm lương của kỳ", () => {
    const r = Api.month({ period: "5" });
    expect(r.rows.map((x) => x.employee)).toEqual(["10", "7", "8", "9"]);
    expect(r.otherSubsidiaries).toBe(0);
  });

  test("không truyền kỳ: kỳ mở chưa khóa gần hôm nay nhất trong các kỳ dùng được cho công ty con", () => {
    // Kỳ 6 thuộc nhóm lương của công ty con 14; kỳ 4 đã khóa công; hôm nay 2026-11-10 trước mọi kỳ (account bị dời ngày)
    expect(Api.month({ subsidiary: "13" }).period.id).toBe("5");
    expect(Api.month({ subsidiary: "14" }).period.id).toBe("6");
    mockState.fx.period = [];
    expect(() => Api.month({ subsidiary: "13" })).toThrow(/Chưa có kỳ lương/);
  });

  test("kỳ không tồn tại, chưa có thiết lập: lỗi nghiệp vụ hai ngôn ngữ", () => {
    let err;
    try {
      Api.month({ period: "999" });
    } catch (e) {
      err = e;
    }
    expect(err.userMessage).toEqual({ en: "Pay period not found", vi: "Không tìm thấy kỳ lương" });
    mockState.fx.setup = [];
    expect(() => Api.month({ period: "5" })).toThrow(/Nạp mặc định VN/);
  });

  test("công đã khóa, có bảng lương: bước và quyền mở khóa", () => {
    mockState.fx.period[0].att_status = "L";
    mockState.fx.batch = [{ id: "1", period: "5", status: "C" }];
    let r = Api.month({ period: "5", subsidiary: "13" });
    expect(r).toMatchObject({ locked: true, hasBatch: true, canUnlock: true });
    expect(r.steps.map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
    mockState.fx.batch = [{ id: "1", period: "5", status: "V" }];
    r = Api.month({ period: "5", subsidiary: "13" });
    // Bảng lương đã đảo: chưa coi là đã chuyển sang chạy lương, và không mở khóa công được
    expect(r).toMatchObject({ hasBatch: false, canUnlock: false });
    expect(r.steps[3].state).toBe("current");
  });

  test("vai trò kế toán chỉ xem", () => {
    mockState.role = "customrole_s4vp_accountant";
    expect(Api.month({ period: "5" }).canEdit).toBe(false);
    mockState.role = "customrole_s4vp_hr";
    expect(Api.month({ period: "5" }).canEdit).toBe(true);
  });

  test("nhóm bảng công ký hiệu: ô lấy từ bảng công, cộng tác viên không đọc Time", () => {
    mockState.fx = fixtures("S");
    mockState.timeFails = true;
    const r = Api.month({ period: "5", subsidiary: "13" });
    expect(r.period.mode).toBe("S");
    expect(r.timeUnavailable).toBe(false);
    expect(r.rows.map((x) => x.source)).toEqual(["sheet", "sheet", "sheet"]);
    expect(r.cellTable[r.rows[0].cells[2]]).toEqual({ s: "ZZ", k: "?" });
    expect(r.exceptions.map((e) => e.type)).toEqual(expect.arrayContaining(["unknownSymbol", "noSheetRow"]));
  });

  test("account không có Time Tracking: lưới vẫn trả về, có cờ báo", () => {
    mockState.timeFails = true;
    const r = Api.month({ period: "5", subsidiary: "13" });
    expect(r.timeUnavailable).toBe(true);
    expect(r.rows[2]).toMatchObject({ source: "time", hours: 0 });
  });

  test("kỳ không có nhân viên nào: lưới rỗng, bước thu thập", () => {
    const r = Api.month({ period: "5", subsidiary: "99" });
    expect(r.rows).toEqual([]);
    expect(r.otherSubsidiaries).toBe(4);
    expect(r.steps[0].state).toBe("current");
  });
});

describe("attendanceEmployee", () => {
  test("lượt chấm sắp theo thời gian, phân ca kèm giờ ca, giờ Time", () => {
    const r = Api.routes.get.attendanceEmployee.run({ period: "5", employee: "7" });
    expect(r.punches).toEqual([{ date: "2027-03-02", time: "08:20", device: "Cổng 1", source: "I" }, { date: "2027-03-02", time: "17:00", device: "Cổng 1", source: "I" }]);
    expect(r.roster).toEqual([{ date: "2027-03-01", shift: "", start: "", end: "" }, { date: "2027-03-02", shift: "HC", start: "08:00", end: "17:00" }]);
    expect(r.time).toEqual([]);
    expect(r.window).toEqual({ from: "2027-03-01", to: "2027-03-31" });
    expect(Api.employee({ period: "5", employee: "9" }).time).toHaveLength(2);
  });

  test("thiếu nhân viên hoặc kỳ: lỗi nghiệp vụ", () => {
    expect(() => Api.employee({ period: "5" })).toThrow(/Thiếu nhân viên/);
    expect(() => Api.employee({ employee: "7" })).toThrow(/Hãy chọn kỳ lương/);
  });
});
