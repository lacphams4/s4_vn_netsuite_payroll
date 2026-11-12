// Trang chủ (api/Home.homeSummary): dựng kết quả từ dữ liệu giả của Store; kiểm việc chỉ đọc, số truy vấn cố định,
// chạy được khi Checks chưa có summary, và không lặp truy vấn theo nhân viên.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const mockState = { today: "2027-03-30", data: {}, calls: [], sql: [], writes: [], checks: null, reminderDays: 60, failJoin: false };
const state = mockState;

jest.mock("N/log", () => ({ error: jest.fn(), audit: jest.fn(), debug: jest.fn() }), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => mockState.today }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Checks", () => ({
  routes: { get: {}, post: {} },
  get summary() {
    return mockState.checks || undefined;
  },
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/WorkPermits", () => ({
  // Trang chủ không còn gọi WorkPermits.list (đọc mọi hồ sơ lương): chỉ hỏi số ngày nhắc trước
  list: () => {
    throw new Error("homeSummary must not call WorkPermits.list (it reads every payroll profile)");
  },
  params: () => {
    mockState.calls.push("permitParams");
    return { reminderDays: mockState.reminderDays };
  },
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const write = (name) => () => {
    mockState.writes.push(name);
    throw new Error("homeSummary must not write");
  };
  return {
    find(name, opt = {}) {
      mockState.calls.push(`find:${name}`);
      const rows = mockState.data[name] || [];
      if (name === "batch") return rows.filter((b) => b.subsidiary === String(opt.params[0]));
      if (name === "employee") return rows.filter((p) => p.subsidiary === String(opt.params[0]));
      if (["leave_request", "ot_request", "business_trip", "att_exception"].includes(name)) return rows.filter((d) => d.status === "P");
      return rows;
    },
    run(sql, params, tag) {
      mockState.calls.push(tag);
      const fake = require("./leanFake");
      mockState.sql.push({ tag, sql, columns: fake.columnsOf(sql) });
      // Câu SuiteQL gọn của trang chủ (kỳ, bảng lương, đếm chứng từ, giấy phép): tests/api/leanFake.js
      const lean = fake.run(mockState.data, sql, params, tag);
      if (lean !== undefined) return lean;
      if (/INNER JOIN employee/.test(sql) && mockState.failJoin) throw new Error("join not allowed");
      const rows = (mockState.data.attendance || []).filter((a) => a.period === String(params[0]) && (params.length < 2 || a.subsidiary === String(params[1])));
      const by = {};
      for (const a of rows) by[a.status] = (by[a.status] || 0) + 1;
      return Object.entries(by).map(([st, n]) => ({ st: `id${st}`, n }));
    },
    rec: () => ({ type: "customrecord_s4vp_attendance", fields: { status: { id: "f_status" }, employee: { id: "f_emp" }, period: { id: "f_period" } } }),
    codeOf: (list, id) => String(id || "").replace(/^id/, "") || null,
    idOf: (list, code) => code,
    create: write("create"),
    update: write("update"),
    submit: write("submit"),
    remove: write("remove"),
  };
});

const Home = require(path.join(API, "Home"));

const periods = () => [
  { id: "2", name: "2027-02", paygroup: "1", start: "2027-02-01", end: "2027-02-28", status: "C", att_status: "L", std_days: 20, tax_month: "202702" },
  { id: "3", name: "2027-03", paygroup: "1", start: "2027-03-01", end: "2027-03-31", status: "O", att_status: "O", std_days: 23, tax_month: "202703" },
  { id: "4", name: "2027-04", paygroup: "1", start: "2027-04-01", end: "2027-04-30", status: "O", att_status: "O", std_days: 22, tax_month: "202704" },
  { id: "5", name: "2027-05", paygroup: "1", start: "2027-05-01", end: "2027-05-31", status: "O", att_status: "O", std_days: 21, tax_month: "202705" },
  { id: "9", name: "OTHER-03", paygroup: "2", start: "2027-03-01", end: "2027-03-31", status: "O", att_status: "O" },
];
const batch = (id, period, status, extra) => Object.assign({ id, name: `BL00000${id}`, subsidiary: "13", period, status, calculated: ["C", "P", "A", "R", "V", "J"].includes(status), emp_count: 4, net: 100, doc_date: "2027-04-05", description: "", bills: "[]", messages: "x" }, extra);

beforeEach(() => {
  state.today = "2027-03-30";
  state.calls = [];
  state.sql = [];
  state.writes = [];
  state.checks = null;
  state.reminderDays = 60;
  state.failJoin = false;
  state.data = {
    paygroup: [{ id: "1", name: "DEFAULT", subsidiary: null }, { id: "2", name: "OTHER", subsidiary: "14" }],
    period: periods(),
    batch: [batch("8", "3", "H"), batch("7", "3", "C", { net: 100766900 }), batch("6", "2", "R", { net: 90000000 }), batch("5", "2", "V", { net: 1 }), batch("4", "3", "C", { subsidiary: "14" })],
    attendance: [{ period: "3", subsidiary: "13", status: "O" }, { period: "3", subsidiary: "13", status: "L" }, { period: "3", subsidiary: "14", status: "O" }],
    leave_request: [{ status: "P", subsidiary: "13", employee: "7", from: "2027-03-10", to: "2027-03-11" }, { status: "A", subsidiary: "13", employee: "7", from: "2027-03-01", to: "2027-03-01" }],
    ot_request: [{ status: "P", subsidiary: null, employee: "7", work_date: "2027-04-03" }, { status: "P", subsidiary: null, employee: "99", work_date: "2027-03-03" }],
    business_trip: [],
    att_exception: [{ status: "P", subsidiary: "14", employee: "8", work_date: "2027-03-05" }],
    employee: [{ employee: "7", subsidiary: "13" }, { employee: "99", subsidiary: "14" }],
    work_permit: [],
  };
});

const run = (params) => Home.routes.get.homeSummary.run(params || { subsidiary: "13" });
const todo = (r, kind) => r.todos.find((t) => t.kind === kind);

describe("homeSummary", () => {
  test("route chỉ có GET homeSummary, roles all; thiếu công ty con thì báo lỗi nghiệp vụ", () => {
    expect(Object.keys(Home.routes.get)).toEqual(["homeSummary"]);
    expect(Home.routes.get.homeSummary.roles).toBe("all");
    expect(Home.routes.post).toEqual({});
    let err;
    try {
      run({});
    } catch (e) {
      err = e;
    }
    expect(err.userMessage.vi).toMatch(/công ty con/);
  });

  test("kỳ đang chạy theo ngày, bỏ kỳ của nhóm lương thuộc công ty con khác", () => {
    const r = run();
    expect(r.today).toBe("2027-03-30");
    expect(r.period).toMatchObject({ id: "3", code: "2027-03", start: "2027-03-01", end: "2027-03-31", attStatus: "O", stdDays: 23, paygroupCode: "DEFAULT", containsToday: true });
    expect(r.previousPeriod).toMatchObject({ id: "2", code: "2027-02" });
    expect(r.batchCounts).toEqual({ total: 2, byStatus: { H: 1, C: 1 } });
  });

  test("mã kỳ lệch tháng: vẫn chọn theo ngày và trả nguyên mã kỳ", () => {
    state.data.period = periods().map((p) => (p.id === "3" ? Object.assign(p, { name: "202609" }) : p));
    expect(run().period).toMatchObject({ id: "3", code: "202609", start: "2027-03-01" });
  });

  test("runs: công của kỳ, bảng lương dở, kỳ sắp tới, bảng lương đã xong; không mang số tiền hay clob", () => {
    const r = run();
    expect(r.runs.map((x) => `${x.kind}:${x.group}:${x.id || x.period}`)).toEqual(["attendance:running:3", "payroll:running:8", "payroll:running:7", "period:upcoming:4", "period:upcoming:5", "payroll:done:6", "payroll:done:5"]);
    expect(r.runCounts).toEqual({ running: 3, upcoming: 2, done: 2 });
    const p7 = r.runs.find((x) => x.id === "7");
    expect(p7.steps.map((s) => s.key)).toEqual(["prepare", "attendance", "calculate", "review", "approve", "post"]);
    expect(p7.progress).toEqual({ done: 3, total: 6, currentKey: "review" });
    expect(p7.checks).toBeNull();
    expect(JSON.stringify(r.runs)).not.toMatch(/net|gross|bills|messages/);
    const att = r.runs[0];
    expect(att).toMatchObject({ employees: 2, lockedRows: 1, pendingDocs: 1, locked: false });
    expect(att.progress.currentKey).toBe("exceptions");
  });

  test("việc cần làm: khóa công, chứng từ chờ duyệt theo công ty con, từng bảng lương dở", () => {
    const r = run();
    expect(r.pendingDocs).toEqual({ leave: 1, ot: 1, trip: 0, exception: 0, total: 2 });
    expect(todo(r, "lockAttendance")).toMatchObject({ tone: "warn", owner: "hr", count: 1, date: "2027-03-31", daysLeft: 1, go: { view: "attendance", params: { period: "3" } } });
    expect(todo(r, "docs_leave")).toMatchObject({ count: 1, go: { view: "attendanceLegacy" } });
    expect(todo(r, "docs_ot").count).toBe(1);
    expect(todo(r, "docs_exception")).toBeUndefined();
    expect(todo(r, "batch_review")).toMatchObject({ note: "unknownChecks", batch: { id: "7", name: "BL000007" }, go: { view: "payrollRun", params: { id: "7" } } });
    // bảng lương tạm giữ đứng ở bước công của chính kỳ đang chạy: đã có việc khóa công, không nhắc lần hai
    expect(r.todos.filter((t) => t.batch && t.batch.id === "8")).toEqual([]);
    expect(todo(r, "createBatch")).toBeUndefined();
    expect(new Set(r.todos.map((t) => t.key)).size).toBe(r.todos.length);
  });

  test("có Checks.summary: số cảnh báo vào thanh bước và việc cần làm; lỗi của Checks không làm hỏng trang chủ", () => {
    const asked = [];
    state.checks = (id) => {
      asked.push(String(id));
      return { open: 3, errors: 1, warnings: 2, resolved: 0 };
    };
    let r = run();
    expect(asked).toEqual(["7"]);
    expect(r.runs.find((x) => x.id === "7").checks).toEqual({ open: 3, errors: 1, warnings: 2, resolved: 0 });
    expect(todo(r, "batch_review")).toMatchObject({ note: "openChecks", count: 3, tone: "error" });
    state.checks = () => ({ open: 0, errors: 0, warnings: 0, resolved: 2 });
    expect(todo(run(), "batch_approve")).toBeDefined();
    state.checks = () => {
      throw new Error("boom");
    };
    r = run();
    expect(todo(r, "batch_review").note).toBe("unknownChecks");
  });

  test("thực lĩnh kỳ này so với kỳ trước: chỉ bảng đã tính, bỏ bảng đã đảo", () => {
    const r = run();
    expect(r.net).toMatchObject({ current: 100766900, previous: 90000000, diff: 10766900, currentBatches: 1, previousBatches: 1 });
    expect(r.net.pct).toBeCloseTo(0.11963, 4);
    state.data.batch = [batch("8", "3", "H")];
    expect(run().net).toEqual({ current: null, previous: null, diff: null, pct: null, currentBatches: 0, previousBatches: 0 });
  });

  test("periodBatches cho thẻ số liệu: mọi bảng lương của kỳ này, bảng đã tính của kỳ trước; số tiền chỉ khi đã tính", () => {
    const r = run();
    expect(r.periodBatches.current).toEqual([
      { id: "8", name: "BL000008", description: "", status: "H", empCount: 4, counted: false, net: null },
      { id: "7", name: "BL000007", description: "", status: "C", empCount: 4, counted: true, net: 100766900 },
    ]);
    // kỳ trước: bảng đã đảo (5) không vào
    expect(r.periodBatches.previous).toEqual([{ id: "6", name: "BL000006", description: "", status: "R", empCount: 4, counted: true, net: 90000000 }]);
    expect(JSON.stringify(r.periodBatches)).not.toMatch(/bills|messages/);
    state.data.period = [];
    state.data.batch = [];
    expect(run().periodBatches).toEqual({ current: [], previous: [] });
  });

  test("mốc hạn: chỉ mốc nội bộ suy ra từ kỳ và bảng lương, không có hạn theo luật", () => {
    const r = run();
    expect(r.statutoryDeadlines).toBe(false);
    expect(r.deadlineBatch).toEqual({ id: "8", name: "BL000008" });
    expect(r.deadlines.map((d) => `${d.key}:${d.date}:${d.state}:${d.daysLeft}`)).toEqual(["lockAttendance:2027-03-31:due:1", "calculate:2027-03-31:due:1", "approve:2027-04-05:upcoming:6", "post:2027-04-05:upcoming:6"]);
  });

  test("kỳ chưa có bảng lương: nhắc tạo; công đã khóa thì hết việc khóa công; quá hạn đổi tông", () => {
    state.data.batch = [batch("6", "2", "R")];
    state.today = "2027-04-02";
    let r = run();
    expect(r.period.id).toBe("4");
    state.today = "2027-03-30";
    r = run();
    expect(todo(r, "createBatch")).toMatchObject({ tone: "info", period: { id: "3", code: "2027-03" }, go: { view: "payrollList", params: { period: "3" } } });
    state.data.period = periods().map((p) => (p.id === "3" ? Object.assign(p, { att_status: "L" }) : p));
    r = run();
    expect(todo(r, "lockAttendance")).toBeUndefined();
    expect(r.runs[0].progress.currentKey).toBe("handoff");
    state.data.period = periods();
    state.data.batch = [batch("7", "3", "A")];
    state.today = "2027-04-10";
    r = run();
    expect(todo(r, "lockAttendance")).toMatchObject({ tone: "error", daysLeft: -10 });
    expect(todo(r, "batch_post")).toMatchObject({ owner: "acct", tone: "error", daysLeft: -5 });
  });

  test("giấy phép lao động: đã hết hạn và sắp hết hạn theo số ngày nhắc trước; lỗi đọc thì permits = null", () => {
    state.data.work_permit = [
      { id: "1", employee: "7", status: "A", expiry: "2027-02-15" },
      { id: "2", employee: "7", status: "E", expiry: "2026-12-01" },
      { id: "3", employee: "7", status: "A", expiry: "2027-04-20" },
      { id: "4", employee: "7", status: "A", expiry: "2027-04-10" },
      { id: "5", employee: "7", status: "D" },
      { id: "6", employee: "7", status: "A", expiry: "2028-01-01" },
      // nhân viên của công ty con khác, giấy đã vô hiệu: không tính
      { id: "7", employee: "99", status: "E", expiry: "2026-01-01" },
      { id: "8", employee: "7", status: "E", expiry: "2026-01-01", isInactive: true },
    ];
    let r = run();
    expect(r.permits).toEqual({ expired: 2, expiring: 2, nextExpiry: "2027-04-10" });
    expect(todo(r, "permitsExpired")).toMatchObject({ tone: "error", count: 2, go: { view: "permits" } });
    expect(todo(r, "permitsExpiring")).toMatchObject({ count: 2, date: "2027-04-10", daysLeft: 11 });
    // chỉ đọc ba cột (trạng thái, hạn, giấy trước) của giấy đang hiệu lực / đã hết hạn
    expect(state.sql.find((q) => q.tag === "s4vp_home_permits").columns).toBeLessThanOrEqual(4);
    state.reminderDays = 15;
    expect(run().permits).toEqual({ expired: 2, expiring: 1, nextExpiry: "2027-04-10" });
    state.data.failPermits = true;
    r = run();
    expect(r.permits).toBeNull();
    expect(todo(r, "permitsExpired")).toBeUndefined();
  });

  test("chưa có kỳ nào: vẫn trả kết quả rỗng gọn gàng", () => {
    state.data.period = [];
    state.data.batch = [];
    const r = run();
    expect(r.period).toBeNull();
    expect(r.deadlines).toEqual([]);
    expect(r.runs).toEqual([]);
    expect(r.runCounts).toEqual({ running: 0, upcoming: 0, done: 0 });
    expect(r.batchCounts).toEqual({ total: 0, byStatus: {} });
  });

  test("không đọc được bảng employee khi đếm công: đếm theo kỳ", () => {
    state.failJoin = true;
    expect(run().runs[0]).toMatchObject({ employees: 3, lockedRows: 1 });
  });

  test("chỉ đọc và số truy vấn không phụ thuộc số nhân viên, số bảng lương", () => {
    run();
    const few = state.calls.length;
    expect(state.writes).toEqual([]);
    for (let i = 0; i < 300; i++) {
      state.data.attendance.push({ period: "3", subsidiary: "13", status: "O" });
      state.data.employee.push({ employee: `e${i}`, subsidiary: "13" });
      state.data.leave_request.push({ status: "P", subsidiary: null, employee: `e${i}`, from: "2027-03-10", to: "2027-03-10" });
    }
    for (let i = 20; i < 60; i++) state.data.batch.push(batch(String(i), "3", "C"));
    state.calls = [];
    const r = run();
    expect(state.calls.length).toBe(few);
    // nhóm lương, kỳ, bảng lương, đếm chứng từ công (một câu UNION ALL), đếm dòng tổng hợp công, giấy phép: 6 truy vấn
    expect(state.calls.slice().sort()).toEqual(["s4vp_home_att", "s4vp_home_batches", "s4vp_home_docs", "s4vp_home_paygroups", "s4vp_home_periods", "s4vp_home_permits"]);
    // không truy vấn nào đọc theo nhân viên hay kéo cột thừa (bảng lương không đọc hai trường clob)
    for (const q of state.sql) expect(q.columns).toBeLessThanOrEqual(10);
    expect(state.sql.find((q) => q.tag === "s4vp_home_batches").sql).not.toMatch(/bills|messages/);
    expect(r.pendingDocs.leave).toBe(301);
    expect(r.runs.filter((x) => x.kind === "payroll" && x.group === "running").length).toBe(20);
    expect(r.runCounts.running).toBe(43);
  });

  test("account không chạy được UNION ALL: đếm từng loại chứng từ, kết quả như cũ; thiếu một loại record vẫn chạy", () => {
    const base = run();
    state.data.failUnion = true;
    state.calls = [];
    const r = run();
    expect(r.pendingDocs).toEqual(base.pendingDocs);
    expect(r.runs[0].pendingDocs).toBe(base.runs[0].pendingDocs);
    expect(state.calls.filter((t) => /^s4vp_home_docs_/.test(t)).sort()).toEqual(["s4vp_home_docs_exception", "s4vp_home_docs_leave", "s4vp_home_docs_ot", "s4vp_home_docs_trip"]);
  });

  test("chứng từ chờ duyệt: không ghi công ty con thì theo hồ sơ lương; giao kỳ đang chạy tính riêng", () => {
    state.data.business_trip = [
      { status: "P", subsidiary: null, employee: "7", from: "2027-02-25", to: "2027-03-02" },
      { status: "P", subsidiary: null, employee: "99", from: "2027-03-02", to: "2027-03-02" },
      { status: "P", subsidiary: "13", employee: "99", from: "2027-05-02", to: null },
    ];
    const r = run();
    expect(r.pendingDocs).toEqual({ leave: 1, ot: 1, trip: 2, exception: 0, total: 4 });
    expect(r.runs[0].pendingDocs).toBe(2);
    expect(todo(r, "docs_trip").count).toBe(2);
  });
});
