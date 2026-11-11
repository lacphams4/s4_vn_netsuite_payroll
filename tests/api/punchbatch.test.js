// api/Shifts xử lý chấm công theo lô (Map/Reduce s4vp_mr_attendance, op punches) với Store giả trong bộ nhớ: chạy theo lô
// phải cho cùng kết quả với chạy một lần (processPunches), chạy lại một lô không sinh trùng, kỳ lớn không chạy đồng bộ.
// Phần cuối chạy chính script Map/Reduce (getInputData, map, reduce, summarize) trên cùng dữ liệu giả.
const mockDb = { tables: {}, seq: 1000, removed: [], params: {}, finished: [], logs: [] };

jest.mock("N/runtime", () => ({ getCurrentScript: () => ({ getParameter: ({ name }) => mockDb.params[name] || null }) }), { virtual: true });
jest.mock("N/log", () => ({ audit: (o) => mockDb.logs.push(o), error: (o) => mockDb.logs.push(o), debug: () => undefined }), { virtual: true });
// summarize ghi kết quả vào cờ / kết quả tác vụ nền của kỳ (cache) - ở đây chỉ ghi lại để kiểm
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Attendance", () => ({
  finishJob: (period, result) => mockDb.finished.push({ period, result }),
}));

jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const rows = (name) => mockDb.tables[name] || (mockDb.tables[name] = []);
  const copy = (list) => list.map((x) => Object.assign({}, x));
  return {
    // Điều kiện SQL không được diễn giải: mã gọi tự lọc lại theo khoảng ngày
    find: (name) => copy(rows(name)),
    findIn: (name, field, ids) => {
      const want = new Set((ids || []).map(String));
      return copy(rows(name).filter((x) => want.has(String(x[field]))));
    },
    get: (name, id) => copy(rows(name).filter((x) => String(x.id) === String(id)))[0] || null,
    create: (name, values) => {
      const id = String(++mockDb.seq);
      rows(name).push(Object.assign({ id }, values));
      return id;
    },
    remove: (name, id) => {
      mockDb.removed.push(`${name}:${id}`);
      mockDb.tables[name] = rows(name).filter((x) => String(x.id) !== String(id));
    },
  };
});
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => {
  const list = [
    { id: "501", code: "OT150", isOvertime: true, overtimeDayType: "N", isNight: false },
    { id: "502", code: "OT200", isOvertime: true, overtimeDayType: "W", isNight: false },
    { id: "503", code: "OT210", isOvertime: true, overtimeDayType: "N", isNight: true },
  ];
  const byCode = {};
  for (const e of list) byCode[e.code] = e;
  return {
    holidays: () => [{ date: "2027-03-10", name: "Lễ thử" }],
    earningTypes: () => ({ list, byCode, byId: {} }),
    resolve: (subsidiary) => ({ weeklyOffDays: subsidiary === "14" ? "0" : "0,6" }),
    tenant: () => ({ weekly_off: "0,6" }),
  };
});
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2026-11-10" }));

const Shifts = require("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Shifts");
const Mr = require("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/scripts/s4vp_mr_attendance");

const PERIOD = "5";
const EMPLOYEES = 12;
const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `2027-03-${pad(d)}`;
const WORK_DAYS = [1, 2, 3, 4, 5, 8, 9, 11, 12];

/** 12 nhân viên nhóm DEFAULT (2 công ty con) + 1 nhân viên nhóm khác; đủ loại tình huống và chứng từ có sẵn. */
function seed() {
  const t = {
    period: [{ id: PERIOD, name: "202703", paygroup: "1", start: "2027-03-01", end: "2027-03-31", std_days: 23, status: "O", att_status: "O" }],
    paygroup: [{ id: "1", name: "DEFAULT", att_source: "E" }, { id: "2", name: "X", att_source: "E" }],
    shift: [
      { id: "1", name: "HC", start_time: "08:00", end_time: "17:00", break_minutes: 60, kind: "D", late_grace: 5, early_grace: 5, ot_min: 30 },
      { id: "3", name: "C3", start_time: "22:00", end_time: "06:00", break_minutes: 30, kind: "N", late_grace: 5, early_grace: 5, ot_min: 30 },
    ],
    att_rule: [{ id: "1", min_from: 1, min_to: 30, deduct: 0.25 }, { id: "2", min_from: 31, min_to: null, deduct: 0.5 }],
    employee: [], roster: [], punch: [], leave_request: [], business_trip: [], att_exception: [], ot_request: [],
  };
  let id = 0;
  const add = (name, values) => t[name].push(Object.assign({ id: String(++id) }, values));
  for (let n = 1; n <= EMPLOYEES; n++) {
    const e = String(100 + n);
    add("employee", { name: `p${n}`, employee: e, subsidiary: n % 4 === 0 ? "14" : "13", paygroup: n % 2 ? null : "1" });
    const night = n % 5 === 0;
    for (const d of WORK_DAYS) {
      add("roster", { employee: e, work_date: day(d), shift: night ? "3" : "1" });
      const k = (n + d) % 7;
      // k = 0: vắng (không chấm); 1: đi trễ; 2: về sớm; 3: làm thêm; 4: thiếu lượt ra; còn lại đúng giờ
      if (k === 0) continue;
      if (night) {
        add("punch", { employee: e, punch_date: day(d), punch_time: `${day(d)} ${k === 1 ? "22:40" : "21:55"}` });
        if (k !== 4) add("punch", { employee: e, punch_date: day(d + 1), punch_time: `${day(d + 1)} ${k === 3 ? "08:00" : "06:02"}` });
      } else {
        add("punch", { employee: e, punch_date: day(d), punch_time: `${day(d)} ${k === 1 ? "08:45" : "07:58"}` });
        if (k !== 4) add("punch", { employee: e, punch_date: day(d), punch_time: `${day(d)} ${k === 2 ? "16:10" : k === 3 ? "19:00" : "17:03"}` });
      }
    }
    // Ngày nghỉ tuần có đi làm (không có ca): đề xuất làm thêm
    if (n % 3 === 0) {
      add("roster", { employee: e, work_date: day(6), shift: null });
      add("punch", { employee: e, punch_date: day(6), punch_time: `${day(6)} 08:00` });
      add("punch", { employee: e, punch_date: day(6), punch_time: `${day(6)} 12:00` });
    }
    // Đơn nghỉ đã duyệt: ngày vắng có lý do
    if (n % 4 === 1) add("leave_request", { employee: e, from: day(2), to: day(3), status: "A" });
    // Chứng từ có sẵn: tạm giữ do lần chạy trước sinh (bị thay), nhập tay tạm giữ và đã duyệt (giữ), từ chối (bỏ qua)
    add("att_exception", { employee: e, work_date: day(1), exception_type: "L", minutes: 99, from_punches: true, status: "H", period: PERIOD });
    add("ot_request", { employee: e, work_date: day(4), hours: 9, from_punches: true, status: "H", period: PERIOD });
    if (n % 2) add("att_exception", { employee: e, work_date: day(8), exception_type: "L", minutes: 10, from_punches: false, status: "H", period: PERIOD });
    if (n % 3 === 1) add("ot_request", { employee: e, work_date: day(9), hours: 2, from_punches: true, status: "A", period: PERIOD });
    if (n % 3 === 2) add("att_exception", { employee: e, work_date: day(11), exception_type: "A", adjust_days: -1, from_punches: true, status: "R", period: PERIOD });
  }
  // Nhân viên nhóm lương khác: không thuộc kỳ, chứng từ của họ không bị đụng tới
  add("employee", { name: "px", employee: "900", subsidiary: "13", paygroup: "2" });
  add("roster", { employee: "900", work_date: day(1), shift: "1" });
  add("att_exception", { employee: "900", work_date: day(1), exception_type: "L", minutes: 20, from_punches: true, status: "H", period: PERIOD });
  mockDb.tables = t;
  mockDb.seq = 1000;
  mockDb.removed = [];
}

/** Ảnh chụp chứng từ không phụ thuộc id và thứ tự tạo. */
function snapshot() {
  const strip = (x) => {
    const o = Object.assign({}, x);
    delete o.id;
    return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  };
  return { exceptions: mockDb.tables.att_exception.map(strip).sort(), overtime: mockDb.tables.ot_request.map(strip).sort() };
}

function runChunked(size) {
  const ids = Shifts.punchEmployees(PERIOD);
  const parts = [];
  // Như reduce của Map/Reduce: mỗi lô tự dựng lại ngữ cảnh kỳ
  for (let i = 0; i < ids.length; i += size) parts.push(Shifts.processPunchChunk(PERIOD, ids.slice(i, i + size)));
  return Shifts.mergePunchResults(parts);
}

describe("xử lý chấm công theo lô", () => {
  let whole;
  let wholeDocs;
  let wholeRemoved;

  beforeAll(() => {
    seed();
    whole = Shifts.processPunches(PERIOD);
    wholeDocs = snapshot();
    wholeRemoved = mockDb.removed.slice().sort();
  });

  test("dữ liệu mẫu có đủ loại kết quả", () => {
    expect(whole.employees).toBe(EMPLOYEES);
    expect(whole.deleted).toBe(EMPLOYEES * 2);
    expect(whole.exceptions).toBeGreaterThan(10);
    expect(whole.overtime).toBeGreaterThan(5);
    expect(whole.kept).toBeGreaterThan(0);
    expect(Object.keys(whole.results).length).toBeGreaterThan(2);
    expect(wholeDocs.exceptions.some((x) => x.includes('"exception_type","L"'))).toBe(true);
    expect(wholeDocs.exceptions.some((x) => x.includes('"exception_type","A"'))).toBe(true);
  });

  test.each([1, 5, 10, 25])("lô %i nhân viên cho cùng kết quả với chạy một lần", (size) => {
    seed();
    const r = runChunked(size);
    expect(r).toEqual({ employees: whole.employees, deleted: whole.deleted, exceptions: whole.exceptions, overtime: whole.overtime, kept: whole.kept, results: whole.results });
    expect(snapshot()).toEqual(wholeDocs);
    // Chỉ xóa đúng các chứng từ tạm giữ do lần chạy trước sinh
    expect(mockDb.removed.slice().sort()).toEqual(wholeRemoved);
  });

  test("chỉ xóa chứng từ tạm giữ do chấm công sinh, của nhân viên thuộc kỳ", () => {
    seed();
    const before = {};
    for (const name of ["att_exception", "ot_request"]) for (const d of mockDb.tables[name]) before[`${name}:${d.id}`] = d;
    runChunked(5);
    expect(mockDb.removed.length).toBe(EMPLOYEES * 2);
    for (const key of mockDb.removed) {
      expect(before[key]).toMatchObject({ from_punches: true, status: "H" });
      expect(before[key].employee).not.toBe("900");
    }
    expect(mockDb.tables.att_exception.filter((d) => d.employee === "900")).toHaveLength(1);
  });

  test("chạy lại một lô (Map/Reduce thử lại) không sinh trùng", () => {
    seed();
    const ids = Shifts.punchEmployees(PERIOD);
    for (let i = 0; i < ids.length; i += 5) Shifts.processPunchChunk(PERIOD, ids.slice(i, i + 5));
    const first = snapshot();
    const again = Shifts.processPunchChunk(PERIOD, ids.slice(0, 5));
    expect(snapshot()).toEqual(first);
    expect(again.deleted).toBe(again.exceptions + again.overtime);
    expect(snapshot()).toEqual(wholeDocs);
  });

  test("nhân viên ngoài nhóm lương của kỳ trong lô bị bỏ qua", () => {
    seed();
    expect(Shifts.processPunchChunk(PERIOD, ["900", "999"])).toEqual({ employees: 0, deleted: 0, exceptions: 0, overtime: 0, kept: 0, results: {} });
    expect(mockDb.removed).toHaveLength(0);
  });

  test("cỡ việc và ngưỡng chạy nền", () => {
    seed();
    expect(Shifts.punchSize(PERIOD)).toEqual({ employees: EMPLOYEES, days: 31, cells: EMPLOYEES * 31, background: false });
    expect(Shifts.punchSize(PERIOD).cells).toBeLessThanOrEqual(Shifts.SYNC_CELLS);
    // Kỳ 1.005 nhân viên: không chạy đồng bộ (RESTlet xếp hàng thay vì gọi), danh sách chia lô vẫn lấy được
    for (let n = 1; n <= 1005 - EMPLOYEES; n++) mockDb.tables.employee.push({ id: `b${n}`, name: `b${n}`, employee: String(2000 + n), subsidiary: "13", paygroup: "1" });
    expect(Shifts.punchSize(PERIOD)).toEqual({ employees: 1005, days: 31, cells: 1005 * 31, background: true });
    expect(Shifts.punchSize(PERIOD).cells).toBeGreaterThan(Shifts.SYNC_CELLS);
    expect(() => Shifts.processPunches(PERIOD)).toThrow(/background/);
    expect(mockDb.removed).toHaveLength(0);
    expect(Shifts.punchEmployees(PERIOD)).toHaveLength(1005);
  });

  test("kỳ đã đóng hoặc đã khóa công: từ chối ngay ở bước cả kỳ", () => {
    seed();
    mockDb.tables.period[0].att_status = "L";
    expect(() => Shifts.punchEmployees(PERIOD)).toThrow(/locked/);
    expect(() => Shifts.processPunchChunk(PERIOD, ["101"])).toThrow(/locked/);
    mockDb.tables.period[0].att_status = "O";
    mockDb.tables.period[0].status = "C";
    expect(() => Shifts.punchSize(PERIOD)).toThrow(/closed/);
  });
});

describe("ngưỡng chạy nền xử lý chấm công", () => {
  test("ngưỡng: quá 200 nhân viên hoặc quá 3.000 nhân viên x ngày", () => {
    expect(Shifts.SYNC_EMPLOYEES).toBe(200);
    expect(Shifts.SYNC_CELLS).toBe(3000);
    expect(Shifts.punchBackground({ employees: 200, cells: 3000 })).toBe(false);
    expect(Shifts.punchBackground({ employees: 201, cells: 1407 })).toBe(true);
    expect(Shifts.punchBackground({ employees: 96, cells: 2976 })).toBe(false);
    expect(Shifts.punchBackground({ employees: 97, cells: 3007 })).toBe(true);
    expect(Shifts.punchBackground(null)).toBe(false);
  });

  test("kỳ tuần: 200 người chạy ngay, 201 người chạy nền dù chưa tới 3.000 ô", () => {
    seed();
    mockDb.tables.period[0].end = "2027-03-07";
    const add = (n) => {
      for (let i = 0; i < n; i++) mockDb.tables.employee.push({ id: `w${mockDb.tables.employee.length}`, name: "w", employee: String(5000 + mockDb.tables.employee.length), subsidiary: "13", paygroup: "1" });
    };
    add(200 - EMPLOYEES);
    expect(Shifts.punchSize(PERIOD)).toEqual({ employees: 200, days: 7, cells: 1400, background: false });
    expect(Shifts.processPunches(PERIOD).employees).toBe(200);
    add(1);
    expect(Shifts.punchSize(PERIOD)).toEqual({ employees: 201, days: 7, cells: 1407, background: true });
    expect(() => Shifts.processPunches(PERIOD)).toThrow(/background/);
  });
});

describe("Map/Reduce s4vp_mr_attendance op punches", () => {
  let sync;
  let syncDocs;

  beforeAll(() => {
    seed();
    sync = Shifts.processPunches(PERIOD);
    syncDocs = snapshot();
  });

  /** Chạy đủ bốn giai đoạn như NetSuite; failKey: lô có reduce lỗi (không ghi gì), như hết governance trước khi ghi. */
  function runMr(opt = {}) {
    mockDb.params = { custscript_s4vp_mra_op: "punches", custscript_s4vp_mra_period: PERIOD };
    mockDb.finished = [];
    mockDb.logs = [];
    const it = (list) => ({
      iterator: () => ({
        each: (fn) => {
          for (const [k, v] of list) if (fn(k, v) === false) break;
        },
      }),
    });
    let input = [];
    let inputError = null;
    try {
      input = Mr.getInputData();
    } catch (e) {
      inputError = JSON.stringify({ name: "S4VP", message: e.message });
    }
    const mapped = {};
    input.forEach((v, i) => Mr.map({ key: String(i), value: JSON.stringify(v), write: ({ key, value }) => (mapped[key] = mapped[key] || []).push(value) }));
    const output = [];
    const reduceErrors = [];
    for (const [key, values] of Object.entries(mapped)) {
      if (opt.failKey === key) {
        reduceErrors.push([key, JSON.stringify({ name: "SSS_USAGE_LIMIT_EXCEEDED", message: "Script Execution Usage Limit Exceeded" })]);
        continue;
      }
      Mr.reduce({ key, values, write: ({ key: k, value }) => output.push([k, value]) });
    }
    Mr.summarize({ inputSummary: { error: inputError }, mapSummary: { errors: it([]) }, reduceSummary: { errors: it(reduceErrors) }, output: it(output) });
    return { input, finished: mockDb.finished };
  }

  test("chia lô theo PUNCH_CHUNK nhân viên của nhóm lương của kỳ", () => {
    seed();
    mockDb.params = { custscript_s4vp_mra_op: "punches", custscript_s4vp_mra_period: PERIOD };
    const input = Mr.getInputData();
    expect(input).toHaveLength(Math.ceil(EMPLOYEES / Shifts.PUNCH_CHUNK));
    expect(input.every((c) => c.op === "punches" && c.period === PERIOD && c.ids.length <= Shifts.PUNCH_CHUNK)).toBe(true);
    expect(input.flatMap((c) => c.ids).sort()).toEqual(Shifts.punchEmployees(PERIOD).sort());
    expect(input.flatMap((c) => c.ids)).not.toContain("900");
  });

  test("chạy nền cho cùng chứng từ và cùng tổng với chạy đồng bộ; summarize ghi kết quả cho màn hình", () => {
    seed();
    const { finished } = runMr();
    expect(snapshot()).toEqual(syncDocs);
    expect(finished).toEqual([
      { period: PERIOD, result: { op: "punches", ok: true, employees: EMPLOYEES, errors: 0, deleted: sync.deleted, exceptions: sync.exceptions, overtime: sync.overtime, kept: sync.kept } },
    ]);
    // Màn hình (views/attendance.js t.done.punches) đọc exceptions, overtime của kết quả
    expect(finished[0].result.exceptions).toBeGreaterThan(0);
    expect(finished[0].result.overtime).toBeGreaterThan(0);
    expect(mockDb.logs.some((l) => /exception\(s\)/.test(l.details))).toBe(true);
  });

  test("chạy lại cả tác vụ không sinh trùng", () => {
    seed();
    runMr();
    const first = mockDb.finished[0].result;
    runMr();
    expect(snapshot()).toEqual(syncDocs);
    const again = mockDb.finished[0].result;
    expect(again).toMatchObject({ ok: true, exceptions: first.exceptions, overtime: first.overtime, kept: first.kept });
    // Lần sau thay đúng chứng từ tạm giữ lần trước sinh
    expect(again.deleted).toBe(first.exceptions + first.overtime);
  });

  test("một lô lỗi: kết quả báo lỗi, vẫn gỡ cờ; chạy lại thì đủ chứng từ", () => {
    seed();
    const { finished } = runMr({ failKey: "1" });
    expect(finished).toHaveLength(1);
    expect(finished[0].result).toMatchObject({ op: "punches", ok: false, errors: 1, message: "Script Execution Usage Limit Exceeded" });
    expect(finished[0].result.employees).toBe(Shifts.PUNCH_CHUNK);
    expect(mockDb.logs.some((l) => /s4vp_mr_attendance punches/.test(l.title) && /Usage Limit/.test(l.details))).toBe(true);
    runMr();
    expect(snapshot()).toEqual(syncDocs);
    expect(mockDb.finished[0].result).toMatchObject({ ok: true, employees: EMPLOYEES, exceptions: sync.exceptions, overtime: sync.overtime });
  });

  test("kỳ bị khóa công sau khi xếp hàng: getInputData lỗi, không đụng chứng từ, kết quả báo lỗi", () => {
    seed();
    const before = snapshot();
    mockDb.tables.period[0].att_status = "L";
    const { input, finished } = runMr();
    expect(input).toHaveLength(0);
    expect(snapshot()).toEqual(before);
    expect(mockDb.removed).toHaveLength(0);
    expect(finished[0].result).toMatchObject({ op: "punches", ok: false, errors: 1, employees: 0 });
    expect(finished[0].result.message).toMatch(/locked/);
  });
});
