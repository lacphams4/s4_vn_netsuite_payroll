// api/AttendanceMonth (GET attendanceMonth, attendanceEmployee) với Store giả: kiểm dạng dữ liệu trả về, phạm vi nhân viên,
// kỳ mặc định, quyền sửa. Mô-đun N/* và lớp đọc ghi record được thay bằng dữ liệu mẫu trong bộ nhớ.
const mockState = { role: "administrator", fx: {}, timeFails: false, queries: [] };

jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ roleId: mockState.role }) }), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const copy = (list) => (list || []).map((x) => Object.assign({}, x));
  return {
    // Điều kiện SQL không được diễn giải: dữ liệu mẫu chỉ cần lọc theo kỳ
    find: (name, opt) => copy(mockState.fx[name]).filter((x) => !opt || !opt.where || !/\{period\}/.test(opt.where) || String(x.period) === String(opt.params[0])),
    findIn: (name, field, ids) => copy(mockState.fx[name]).filter((x) => (ids || []).map(String).includes(String(x[field]))),
    get: (name, id) => copy(mockState.fx[name]).find((x) => String(x.id) === String(id)) || null,
    // Câu SuiteQL gọn (api/Lean): tra theo tag trong tests/api/leanFake.js; tên nhân viên tự sinh E0<id> / NV<id>
    run: (sql, params, tag) => {
      const fake = require("./leanFake");
      mockState.queries.push({ tag, columns: fake.columnsOf(sql), sql });
      const rows = fake.run(Object.assign({ autoEmp: true }, mockState.fx), sql, params, tag);
      if (rows === undefined) throw new Error(`unexpected query ${tag}`);
      return rows;
    },
    codeOf: (list, v) => (v === undefined ? null : v),
    idOf: (list, code) => code,
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
const Grid = require("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/core/AttendanceMonthGrid");
// Lưới về dạng nén (Grid.packRows): bung lại thành dòng đủ trường, ô ngày là đối tượng ô
const full = (r) => Grid.unpackRows(r);

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
  mockState.queries = [];
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
    expect(full(r).map((x) => [x.employee, x.code, x.source])).toEqual([["7", "E07", "docs"], ["8", "E08", "docs"], ["9", "E09", "time"]]);
    expect(r.days).toHaveLength(31);
    expect(r.days[9]).toMatchObject({ type: "H", name: "Lễ thử" });
    // Lưới nén: rows[].cells là chỉ số vào cellRows, mỗi dãy gồm 31 chỉ số vào cellTable; rows[].totals là chỉ số vào totalsTable
    expect(r.rows.every((x) => Number.isInteger(x.cells) && r.cellRows[x.cells].length === 31)).toBe(true);
    expect(r.cellRows.every((list) => list.every((i) => Number.isInteger(i) && r.cellTable[i]))).toBe(true);
    expect(r.totalsKeys).toEqual(["std_days", "paid_leave", "unpaid_leave", "si_leave", "trip_days", "late_days", "adjust_days", "work_days", "ot_hours"]);
    expect(r.totalsTable[r.rows[0].totals]).toEqual([23, 2, 0, 0, 0, 0, 0, 23, 0]);
    expect(r.rows[2].totals).toBeUndefined();
    // Trường bằng mặc định không gửi
    expect(r.rows[1]).toEqual({ employee: "8", code: "E08", name: "NV8", department: "Kế toán", cells: expect.any(Number), totals: expect.any(Number), estimated: true, open: 3 });
    const rows = full(r);
    expect(rows[0]).toMatchObject({ contractor: false, salaryType: "M", source: "docs", hasSummary: true, locked: false, totals: { std_days: 23, paid_leave: 2, work_days: 23 } });
    expect(rows[0].cells[8]).toEqual({ s: "P", k: "P", v: 1 });
    expect(rows[1].cells[0]).toEqual({ s: "", k: "O" });
    expect(rows[2].cells[14]).toEqual({ s: "4", k: "H", h: 0, hp: 4 });
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
    expect(full(r).map((x) => x.employee)).toEqual(["10", "7", "8", "9"]);
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
    expect(full(r).map((x) => x.source)).toEqual(["sheet", "sheet", "sheet"]);
    expect(full(r)[0].cells[2]).toEqual({ s: "ZZ", k: "?" });
    expect(r.exceptions.map((e) => e.type)).toEqual(expect.arrayContaining(["unknownSymbol", "noSheetRow"]));
  });

  test("account không có Time Tracking: lưới vẫn trả về, có cờ báo", () => {
    mockState.timeFails = true;
    const r = Api.month({ period: "5", subsidiary: "13" });
    expect(r.timeUnavailable).toBe(true);
    expect(full(r)[2]).toMatchObject({ source: "time", hours: 0 });
  });

  test("kỳ không có nhân viên nào: lưới rỗng, bước thu thập", () => {
    const r = Api.month({ period: "5", subsidiary: "99" });
    expect(r.rows).toEqual([]);
    expect(r.otherSubsidiaries).toBe(4);
    expect(r.steps[0].state).toBe("current");
  });
});

describe("attendanceMonth - hiệu năng với 1.000 nhân viên", () => {
  const tags = () => mockState.queries.map((q) => q.tag).sort();
  function big(n) {
    const fx = fixtures();
    fx.employee = [];
    fx.attendance = [];
    for (let i = 1; i <= n; i++) {
      const emp = String(1000 + i);
      fx.employee.push({ id: `p${emp}`, name: `hs${emp}`, employee: emp, subsidiary: "13", paygroup: "1", employment_type: "E", salary_type: "M", hire_date: i % 50 === 0 ? "2027-03-15" : "2020-01-01" });
    }
    fx.leave_request = [{ id: "21", name: "NP21", employee: "1001", from: "2027-03-09", to: "2027-03-09", leave_type: "10", days: 1, status: "P" }];
    fx.att_exception = [];
    mockState.fx = fx;
    mockState.queries = [];
  }

  test("9 truy vấn, không phụ thuộc số nhân viên; không truy vấn nào kéo cột thừa hay dùng IN với tham số ràng buộc", () => {
    big(20);
    Api.month({ period: "5", subsidiary: "13" });
    const few = tags();
    expect(few).toEqual(["s4vp_att_docs", "s4vp_att_meta", "s4vp_att_paygroups", "s4vp_att_period", "s4vp_att_profiles", "s4vp_att_summaries", "s4vp_att_symbols"]);
    // + thiết lập và ngày lễ qua api/Settings (giả ở đây): 9 truy vấn trên account
    big(1000);
    const r = Api.month({ period: "5", subsidiary: "13" });
    expect(tags()).toEqual(few);
    expect(r.rows).toHaveLength(1000);
    const cols = {};
    for (const q of mockState.queries) cols[q.tag] = q.columns;
    expect(cols.s4vp_att_profiles).toBeLessThanOrEqual(14);
    expect(cols.s4vp_att_summaries).toBeLessThanOrEqual(12);
    expect(cols.s4vp_att_period).toBeLessThanOrEqual(10);
    for (const q of mockState.queries) {
      expect(q.sql).not.toMatch(/\?\s*,\s*\?\s*,\s*\?/);
      expect(q.sql).not.toMatch(/BUILTIN\.DF/);
    }
  });

  test("không chọn kỳ: thêm đúng một truy vấn kỳ (không đọc lại kỳ đã chọn)", () => {
    big(20);
    Api.month({ subsidiary: "13" });
    expect(tags()).toEqual(["s4vp_att_docs", "s4vp_att_meta", "s4vp_att_paygroups", "s4vp_att_periods", "s4vp_att_profiles", "s4vp_att_summaries", "s4vp_att_symbols"]);
  });

  test("lưới 1.000 nhân viên x 31 ngày: phản hồi dưới 150 KB, số đếm và ngoại lệ tính trên toàn kỳ", () => {
    big(1000);
    const r = Api.month({ period: "5", subsidiary: "13" });
    const size = Buffer.byteLength(JSON.stringify(r), "utf8");
    expect(size).toBeLessThan(150000);
    // 1.000 dòng chỉ có vài dãy ô khác nhau: lịch chung, người vào làm giữa kỳ, người có đơn nghỉ chờ duyệt
    expect(r.cellRows.length).toBeLessThanOrEqual(4);
    expect(r.totalsTable.length).toBeLessThanOrEqual(3);
    expect(r.stats).toMatchObject({ employees: 1000, summaryEmployees: 1000, estimated: 1000, docs: { leave: 1, pending: 1 } });
    expect(r.counts.open).toBe(1);
    expect(r.exceptions.map((e) => e.key)).toEqual(["doc:leave:21"]);
    const rows = full(r);
    expect(rows.filter((x) => x.open > 0).map((x) => x.employee)).toEqual(["1001"]);
    expect(rows[0].cells[8]).toMatchObject({ k: "W", p: 1 });
    expect(rows[1].cells[8]).toEqual({ s: "X", k: "W", v: 1 });
    expect(rows[49].cells[0]).toEqual({ s: "", k: "O" });
    // Chưa lập bảng tổng hợp: số của dòng là số dự tính; người vào làm giữa kỳ có số công chuẩn riêng
    expect(rows.every((x) => x.estimated && !x.hasSummary)).toBe(true);
    expect(rows[49].totals.work_days).toBeLessThan(rows[1].totals.work_days);
    expect(rows[1].totals.work_days).toBe(rows[1].totals.std_days);
    // Bung lại đúng bằng lưới chưa nén
    expect(rows[5].cells).toHaveLength(31);
    expect(r.docs).toEqual([expect.objectContaining({ type: "leave", name: "NP21", employee: "1001", leaveType: "PN" })]);
  });

  test("lọc trong SQL cho cùng kết quả với bộ lọc cũ: nhóm lương khác, nghỉ việc trước kỳ, công ty con khác", () => {
    const r = Api.month({ period: "6", subsidiary: "13" });
    // Kỳ 6 thuộc nhóm X (id 2): chỉ hồ sơ p5 (nhân viên 11)
    expect(full(r).map((x) => x.employee)).toEqual(["11"]);
    expect(mockState.queries.find((q) => q.tag === "s4vp_att_profiles").sql).toMatch(/ IN \(2\)/);
    mockState.queries = [];
    Api.month({ period: "5", subsidiary: "13" });
    expect(mockState.queries.find((q) => q.tag === "s4vp_att_profiles").sql).toMatch(/NOT IN \(2\)/);
  });

  test("account không chạy được UNION ALL hoặc không đọc được bảng department: tự chia câu, kết quả như cũ", () => {
    const base = Api.month({ period: "5", subsidiary: "13" });
    mockState.fx.failUnion = true;
    mockState.fx.failDepartment = true;
    mockState.queries = [];
    const r = Api.month({ period: "5", subsidiary: "13" });
    expect(r).toEqual(base);
    expect(tags()).toEqual(expect.arrayContaining(["s4vp_att_batches", "s4vp_att_other", "s4vp_att_docs_leave", "s4vp_att_docs_trip", "s4vp_att_docs_exception", "s4vp_att_docs_ot", "s4vp_att_profiles_df"]));
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
