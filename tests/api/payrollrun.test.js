// Mô-đun route api/PayrollRun (giao diện bản 2): runView, runLine, submitRun với Store / Payroll / Settings / Checks giả.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const db = { batches: [], periods: [], lines: {}, emps: {}, inputs: [], time: [], submitted: [], queries: [] };
const FIELD_TYPES = { employment_type: { type: "select", target: "list:employment_type" }, att_locked: { type: "check" }, warnings: { type: "textarea" }, error: { type: "textarea" }, employee: { type: "select", target: "employee" }, batch: { type: "select", target: "rec:batch" } };
const field = (k) => Object.assign({ id: `f_${k}`, type: "currency" }, FIELD_TYPES[k] || {});

jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => ({
  rec: () => ({ type: "customrecord_s4vp_batch_emp", fields: new Proxy({}, { get: (t, k) => field(String(k)) }) }),
  codeOf: (list, v) => (v === null || v === undefined ? null : { 1: "E", 2: "C" }[v] || null),
  run: (sql, params, tag) => {
    db.queries.push(tag);
    return (db.lines[String(params[0])] || []).map((l) => {
      const row = { id: l.id };
      for (const k of Object.keys(l)) row[`c_${k}`] = k === "employment_type" ? { E: 1, C: 2 }[l[k]] : k === "att_locked" ? (l[k] ? "T" : "F") : l[k];
      return row;
    });
  },
  find: (name, opt = {}) => {
    db.queries.push(`find_${name}`);
    const p = opt.params || [];
    if (name === "period") return db.periods;
    if (name === "batch") return db.batches.filter((b) => b.subsidiary === String(p[0]));
    if (name === "batch_input") return db.inputs.filter((i) => i.batch === String(p[0]) && i.employee === String(p[1]));
    if (name === "batch_time") return db.time.filter((i) => i.batch === String(p[0]) && i.employee === String(p[1]));
    if (name === "batch_emp") return (db.lines[String(p[0])] || []).filter((l) => l.employee === String(p[1])).map((l) => Object.assign({ batch: String(p[0]) }, l));
    return [];
  },
  get: (name, id) => {
    db.queries.push(`get_${name}`);
    if (name === "period") return db.periods.find((x) => x.id === String(id)) || null;
    if (name === "batch") return db.batches.find((x) => x.id === String(id)) || null;
    if (name === "paygroup") return { id: String(id), name: "DEFAULT", description: "Mặc định" };
    if (name === "batch_emp") {
      for (const b of Object.keys(db.lines)) {
        const l = db.lines[b].find((x) => x.id === String(id));
        if (l) return Object.assign({ batch: b }, l);
      }
    }
    return null;
  },
  submit: (name, id, values) => db.submitted.push({ name, id, values }),
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Payroll", () => ({
  getBatch: (id) => {
    const b = db.batches.find((x) => x.id === String(id));
    if (!b) {
      const e = new Error("not found");
      e.userMessage = { en: "Payroll batch not found", vi: "Không tìm thấy bảng lương" };
      throw e;
    }
    return b;
  },
  employeesInfo: (ids) => {
    db.queries.push("employeesInfo");
    const out = {};
    for (const id of ids) if (db.emps[id]) out[String(id)] = db.emps[id];
    return out;
  },
  transactionsInfo: (ids) => {
    const out = {};
    for (const id of ids.filter(Boolean)) out[String(id)] = { tranid: `JE${id}`, posting: true, voided: false };
    return out;
  },
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({
  earningTypes: () => ({ byId: { 1: { code: "BASE", description: "Lương chính" }, 2: { code: "BONUS", description: "Thưởng" } }, byCode: { BASE: { description: "Lương chính" }, BONUS: { description: "Thưởng" }, MEAL: { description: "Ăn ca" } } }),
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Checks", () => ({ routes: { get: {}, post: {} } }));

const Checks = require(path.join(API, "Checks"));
const PayrollRun = require(path.join(API, "PayrollRun"));

const line = (id, employee, net, extra) => Object.assign({ id: String(id), employee: String(employee), employment_type: "E", std_days: 23, work_days: 23, gross: net + 100, exempt: 0, ee_ins: 60, er_ins: 200, pit: 40, other_ded: 0, advance: 0, net, att_locked: true, warnings: null, error: null }, extra || {});

beforeEach(() => {
  delete Checks.summary;
  db.queries = [];
  db.submitted = [];
  // Mã kỳ cố ý không theo thứ tự ngày: kỳ trước xác định theo ngày kết thúc
  db.periods = [
    { id: "5", name: "202703", start: "2027-02-01", end: "2027-02-28", status: "O", att_status: "L", std_days: 20 },
    { id: "9", name: "202701", start: "2027-03-01", end: "2027-03-31", status: "O", att_status: "L", std_days: 23 },
  ];
  db.batches = [
    { id: "7", name: "BL000007", subsidiary: "13", paygroup: "1", period: "9", status: "C", calculated: true, journal: null, reversal: null, bills: null, messages: "", job: "", emp_count: 3 },
    { id: "3", name: "BL000003", subsidiary: "13", paygroup: "1", period: "5", status: "R", calculated: true, journal: "55", bills: "[]", job: "" },
    { id: "4", name: "BL000004", subsidiary: "14", paygroup: "1", period: "5", status: "R", calculated: true },
  ];
  db.lines = {
    7: [line(71, 101, 1000), line(72, 102, 2300, { warnings: "Thiếu tài khoản ngân hàng" }), line(73, 104, 700, { employment_type: "C", pit: 70, ee_ins: 0, er_ins: 0 })],
    3: [line(31, 101, 1000), line(32, 102, 2000), line(33, 103, 500)],
  };
  db.lines[7][0].detail = JSON.stringify({ earnings: [{ earningType: "BASE", amount: 1000, quantity: 23, rate: 43, source: "S" }, { earningType: "BONUS", amount: 100, taxExemptAmount: 10, source: "M" }], insurance: [{ code: "BHXH", wageBase: 1000, employeeRate: 0.08, employeeAmount: 60, employerRate: 0.175, employerAmount: 200 }], allocations: [{ component: "GROSS", amount: 1100 }] });
  db.lines[3][0].detail = JSON.stringify({ earnings: [{ earningType: "BASE", amount: 900, source: "S" }, { earningType: "MEAL", amount: 50, source: "S" }], insurance: [{ code: "BHXH", employeeAmount: 55 }] });
  db.emps = { 101: { code: "E101", name: "NV 101", departmentName: "Kế toán" }, 102: { code: "E102", name: "NV 102" }, 103: { code: "E103", name: "NV 103" }, 104: { code: "E104", name: "CTV 104" } };
  db.inputs = [{ id: "900", batch: "7", employee: "101", kind: "E", earning_type: "2", description: "Thưởng dự án", amount: 100 }, { id: "901", batch: "7", employee: "101", kind: "D", code: "KHAC", description: "Trừ đồng phục", amount: 20 }];
  db.time = [{ id: "1", batch: "7", employee: "101", hours: 8 }];
});

describe("routes", () => {
  test("khai đúng tên action và vai trò", () => {
    expect(Object.keys(PayrollRun.routes.get)).toEqual(["runView", "runLine"]);
    expect(Object.keys(PayrollRun.routes.post)).toEqual(["submitRun"]);
    for (const r of Object.values(PayrollRun.routes.get).concat(Object.values(PayrollRun.routes.post))) {
      expect(r.roles).toBe("payroll");
      expect(typeof r.run).toBe("function");
    }
  });
});

describe("runView", () => {
  test("bảng lương, kỳ, bước, dòng, tổng", () => {
    const v = PayrollRun.routes.get.runView.run({ id: "7" });
    expect(v.batch).toMatchObject({ id: "7", name: "BL000007", periodName: "202701", bills: [], messages: [], journalNo: "" });
    expect(v.period).toMatchObject({ id: "9", start: "2027-03-01", end: "2027-03-31", att_status: "L" });
    expect(v.paygroup).toEqual({ id: "1", code: "DEFAULT", description: "Mặc định" });
    expect(v.steps.map((s) => s.key)).toEqual(["prepare", "attendance", "calculate", "review", "approve", "post"]);
    expect(v.lines.map((l) => l.code)).toEqual(["E101", "E102", "E104"]);
    expect(v.lines[0]).toMatchObject({ id: "71", employee: "101", name: "NV 101", department: "Kế toán", employment_type: "E", att_locked: true, net: 1000 });
    expect(v.lines[0].detail).toBeUndefined();
    expect(v.totals).toMatchObject({ count: 3, errors: 0, warned: 1, net: 4000, ee_ins: 120, er_ins: 400, insurance: 520, pit: 150, pitContractor: 70, pitEmployee: 80, netContractor: 700, netEmployee: 3300 });
    expect(v.totals.cost).toBe(v.totals.gross + 400);
  });

  test("so sánh với kỳ liền trước theo ngày kết thúc kỳ, cùng công ty con", () => {
    const v = PayrollRun.view({ id: "7" });
    expect(v.compare.previous).toEqual({ id: "3", name: "BL000003", status: "R", period: "5", periodName: "202703", periodEnd: "2027-02-28" });
    expect(v.compare.threshold).toBe(0.1);
    expect(v.lines.map((l) => l.cmp.kind)).toEqual(["both", "both", "new"]);
    expect(v.lines[1].cmp).toMatchObject({ previous: 2000, diff: 300, pct: 0.15, over: true });
    expect(v.compare.leavers).toEqual([expect.objectContaining({ employee: "103", code: "E103", name: "NV 103", previous: 500 })]);
    expect(v.compare.summary).toMatchObject({ hasPrevious: true, joiners: 1, leavers: 1, over: 1 });
    expect(v.compare.summary.totals.net).toEqual({ current: 4000, previous: 3500, diff: 500, pct: 0.1429 });
  });

  test("ngưỡng chênh là tham số", () => {
    expect(PayrollRun.view({ id: "7", threshold: "0.2" }).lines[1].cmp.over).toBe(false);
    expect(PayrollRun.view({ id: "7", threshold: "abc" }).compare.threshold).toBe(0.1);
  });

  test("không có kỳ trước: vẫn trả dữ liệu, không có số so sánh", () => {
    db.batches = db.batches.filter((b) => b.id === "7");
    const v = PayrollRun.view({ id: "7" });
    expect(v.compare.previous).toBeNull();
    expect(v.compare.summary.hasPrevious).toBe(false);
    expect(v.lines.every((l) => l.cmp.previous === null && !l.cmp.over)).toBe(true);
  });

  test("chưa có phân hệ Kiểm tra: checks null, bước soát là bước hiện tại", () => {
    const v = PayrollRun.view({ id: "7" });
    expect(v.checks).toBeNull();
    expect(v.progress.currentKey).toBe("review");
  });

  test("có Checks.summary: đưa số cảnh báo vào thanh bước; Checks ném lỗi thì coi như chưa có", () => {
    Checks.summary = () => ({ open: 2, errors: 1, warnings: 1, resolved: 3 });
    let v = PayrollRun.view({ id: "7" });
    expect(v.checks).toEqual({ open: 2, errors: 1, warnings: 1, resolved: 3 });
    expect(v.steps.find((s) => s.key === "review")).toMatchObject({ state: "current", note: "openChecks", count: 2 });
    Checks.summary = () => ({ open: 0, errors: 0, warnings: 0, resolved: 5 });
    expect(PayrollRun.view({ id: "7" }).progress.currentKey).toBe("approve");
    Checks.summary = () => {
      throw new Error("boom");
    };
    v = PayrollRun.view({ id: "7" });
    expect(v.checks).toBeNull();
  });

  test("số truy vấn không phụ thuộc số nhân viên", () => {
    PayrollRun.view({ id: "7" });
    const small = db.queries.length;
    db.queries = [];
    for (let i = 0; i < 500; i++) db.lines[7].push(line(1000 + i, 5000 + i, 100));
    PayrollRun.view({ id: "7" });
    expect(db.queries.length).toBe(small);
    expect(small).toBeLessThanOrEqual(8);
  });

  test("thông báo tính lương thành mảng dòng; bút toán có số chứng từ", () => {
    Object.assign(db.batches[0], { messages: "E101: lỗi A\nE102: lỗi B", journal: "55", status: "R" });
    const v = PayrollRun.view({ id: "7" });
    expect(v.batch.messages).toEqual(["E101: lỗi A", "E102: lỗi B"]);
    expect(v.batch.journalNo).toBe("JE55");
  });

  test("thiếu id hoặc không tìm thấy: lỗi nghiệp vụ song ngữ", () => {
    expect(() => PayrollRun.view({})).toThrow(/Chưa chọn bảng lương/);
    expect(() => PayrollRun.view({ id: "999" })).toThrow();
  });
});

describe("runLine", () => {
  test("các khoản của một nhân viên, gộp dòng nhập tay như màn cũ", () => {
    const d = PayrollRun.routes.get.runLine.run({ id: "7", line: "71", prev: "3" });
    expect(d.line).toMatchObject({ id: "71", code: "E101", name: "NV 101" });
    expect(d.line.detail).toBeUndefined();
    expect(d.earnings).toEqual([
      expect.objectContaining({ code: "BASE", name: "Lương chính", amount: 1000, quantity: 23, source: "S" }),
      expect.objectContaining({ inputId: "900", code: "BONUS", name: "Thưởng dự án", amount: 100, exempt: 10, source: "M" }),
    ]);
    expect(d.deductions).toEqual([{ inputId: "901", code: "KHAC", name: "Trừ đồng phục", amount: 20 }]);
    expect(d.insurance[0]).toMatchObject({ code: "BHXH", employeeAmount: 60 });
    expect(d.time.length).toBe(1);
    expect(d.allocations.length).toBe(1);
  });

  test("so sánh từng khoản với kỳ trước", () => {
    const d = PayrollRun.lineDetail({ id: "7", line: "71", prev: "3" });
    expect(d.compare.previous).toEqual({ id: "3", name: "BL000003" });
    expect(d.compare.inPrevious).toBe(true);
    expect(d.compare.line.net).toEqual({ current: 1000, previous: 1000, diff: 0, pct: 0 });
    expect(d.compare.earnings.map((x) => [x.code, x.kind, x.diff])).toEqual([["BASE", "both", 100], ["BONUS", "new", 100], ["MEAL", "gone", -50]]);
    expect(d.compare.insurance[0]).toMatchObject({ code: "BHXH", current: 60, previous: 55, diff: 5 });
  });

  test("không truyền prev thì tự tìm kỳ trước; prev khác công ty con bị bỏ qua", () => {
    expect(PayrollRun.lineDetail({ id: "7", line: "71" }).compare.previous).toEqual({ id: "3", name: "BL000003" });
    const d = PayrollRun.lineDetail({ id: "7", line: "71", prev: "4" });
    expect(d.compare.previous).toBeNull();
    expect(d.compare.line).toBeNull();
    expect(d.compare.earnings[0]).toMatchObject({ code: "BASE", previous: null, diff: null });
  });

  test("nhân viên mới: kỳ trước không có dòng", () => {
    const d = PayrollRun.lineDetail({ id: "7", line: "73", prev: "3" });
    expect(d.compare.inPrevious).toBe(false);
    expect(d.compare.line.net.previous).toBeNull();
  });

  test("dòng không thuộc bảng lương: từ chối", () => {
    expect(() => PayrollRun.lineDetail({ id: "7", line: "31" })).toThrow(/Không tìm thấy nhân viên/);
    expect(() => PayrollRun.lineDetail({ id: "7" })).toThrow();
  });
});

describe("submitRun - gửi duyệt", () => {
  test("đã tính -> chờ duyệt", () => {
    expect(PayrollRun.routes.post.submitRun.run({ id: "7" })).toEqual({ ok: true, status: "P" });
    expect(db.submitted).toEqual([{ name: "batch", id: "7", values: { status: "P" } }]);
  });

  test("từ chối khi chưa tính, sai trạng thái, đang chạy nền, kỳ đã đóng", () => {
    const b = db.batches[0];
    b.calculated = false;
    expect(() => PayrollRun.submit({ id: "7" })).toThrow(/Chỉ gửi duyệt bảng lương đã tính/);
    Object.assign(b, { calculated: true, status: "A" });
    expect(() => PayrollRun.submit({ id: "7" })).toThrow(/Chỉ gửi duyệt/);
    Object.assign(b, { status: "C", job: "12345" });
    expect(() => PayrollRun.submit({ id: "7" })).toThrow(/xử lý nền/);
    b.job = "";
    db.periods[1].status = "C";
    expect(() => PayrollRun.submit({ id: "7" })).toThrow(/Kỳ lương đã đóng/);
    expect(db.submitted).toEqual([]);
  });
});
