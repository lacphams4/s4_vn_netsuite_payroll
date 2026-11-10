// Mô-đun route api/PayrollRun (giao diện bản 2): runView, runLine, submitRun với Store / Payroll / Settings / Checks giả.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const db = { batches: [], periods: [], lines: {}, emps: {}, inputs: [], time: [], submitted: [], queries: [], profiles: {}, timebill: [], timebillFails: false, requireTimeApproval: true };
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
    if (name === "employee") return db.profiles[String(id)] || null;
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
  detail: () => {
    throw new Error("runLine must not load the whole batch (Payroll.detail)");
  },
  lines: () => {
    throw new Error("runLine must not load every line of the batch (Payroll.lines)");
  },
  timesheet: () => {
    throw new Error("runLine must not call Payroll.timesheet (it loads every line)");
  },
  transactionsInfo: (ids) => {
    const out = {};
    for (const id of ids.filter(Boolean)) out[String(id)] = { tranid: `JE${id}`, posting: true, voided: false };
    return out;
  },
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/TimeLines", () => ({
  windowOf: (period) => ({ from: period.time_from || period.start, to: period.time_to || period.end }),
  entries: (ids, from, to) => {
    db.queries.push("timebill");
    if (db.timebillFails) throw new Error("no permission");
    return db.timebill.filter((e) => ids.map(String).includes(e.employee) && e.date >= from && e.date <= to);
  },
  forBatch: () => {
    throw new Error("runLine must not load the time lines of the whole batch");
  },
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({
  resolve: () => ({ requireTimeApproval: db.requireTimeApproval }),
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
  db.profiles = { 501: { id: "501", pit_method: "P", flat_commit: false }, 503: { id: "503", pit_method: "F", flat_commit: true } };
  db.timebill = [
    { id: "t1", employee: "101", date: "2027-03-02", hours: 8, projectName: "Dự án A", taskName: "Thiết kế", approval: "A", statusName: "Approved", memo: "" },
    { id: "t2", employee: "101", date: "2027-02-27", hours: 8, projectName: "Dự án A", taskName: "", approval: "A", statusName: "Approved", memo: "ngoài kỳ" },
    { id: "t3", employee: "102", date: "2027-03-03", hours: 4, projectName: "", taskName: "", approval: "P", statusName: "Pending", memo: "" },
  ];
  db.timebillFails = false;
  db.requireTimeApproval = true;
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

describe("runLine - dữ liệu cho các tab theo nhân viên", () => {
  beforeEach(() => {
    Object.assign(db.lines[7][0], { profile: "501", paid_leave: 1, unpaid_leave: 0, si_leave: 0.5, absence_days: 2, ot_hours: 6, taxable: 1090, exempt: 10, dependents: 2, family_ded: 300, assessable: 730, other_tax_ded: 0, gross: 1100 });
    const d = JSON.parse(db.lines[7][0].detail);
    d.employeeCompulsoryInsurance = 60;
    d.advanceOffsets = [{ refNbr: "TU0001", amount: 50, remainingBalance: 150, id: "9" }];
    d.allocations = [{ component: "GROSS", project: "P1", task: "T1", branch: "HN", workCenter: "KT", source: "T", hours: 8, ratio: 1, amount: 1100 }];
    db.lines[7][0].detail = JSON.stringify(d);
  });

  test("công: số công của dòng, cờ khóa công", () => {
    const d = PayrollRun.lineDetail({ id: "7", line: "71", prev: "3" });
    expect(d.attendance).toEqual({ att_locked: true, std_days: 23, work_days: 23, paid_leave: 1, unpaid_leave: 0, si_leave: 0.5, absence_days: 2, ot_hours: 6 });
    expect(PayrollRun.lineDetail({ id: "7", line: "72", prev: "3" }).attendance).toMatchObject({ std_days: 23, paid_leave: null, ot_hours: null });
  });

  test("thuế TNCN: lấy số gói đã tính trên dòng, phương pháp từ hồ sơ lương, không tự tính lại", () => {
    const d = PayrollRun.lineDetail({ id: "7", line: "71", prev: "3" });
    expect(d.tax).toEqual({
      method: "P", flatCommitment: false, gross: 1100, exempt: 10, taxable: 1090, insurance: 60, dependents: 2, selfDeduction: null, dependentDeduction: null,
      familyDeduction: 300, otherDeductions: 0, assessable: 730, pit: 40,
    });
  });

  test("thuế TNCN: tách giảm trừ bản thân / người phụ thuộc khi JSON chi tiết có lưu; dòng không có hồ sơ thì method null", () => {
    const d0 = JSON.parse(db.lines[7][0].detail);
    d0.pit = { selfDeduction: 200, dependentDeduction: 100 };
    db.lines[7][0].detail = JSON.stringify(d0);
    expect(PayrollRun.lineDetail({ id: "7", line: "71", prev: "3" }).tax).toMatchObject({ selfDeduction: 200, dependentDeduction: 100, familyDeduction: 300 });
    const c = PayrollRun.lineDetail({ id: "7", line: "73", prev: "3" }).tax;
    expect(c).toMatchObject({ method: null, flatCommitment: null, insurance: null, taxable: null, pit: 70 });
    db.lines[7][2].profile = "503";
    expect(PayrollRun.lineDetail({ id: "7", line: "73", prev: "3" }).tax).toMatchObject({ method: "F", flatCommitment: true });
  });

  test("giờ công: dòng giờ tính lương và timesheet từng ngày trong cửa sổ kết công, chỉ của nhân viên đó", () => {
    const d = PayrollRun.lineDetail({ id: "7", line: "71", prev: "3" });
    expect(d.time).toEqual([expect.objectContaining({ id: "1", hours: 8 })]);
    expect(d.timesheet).toMatchObject({ from: "2027-03-01", to: "2027-03-31", requireApproval: true });
    expect(d.timesheet.entries.map((e) => e.id)).toEqual(["t1"]);
    expect(d.timesheet.failed).toBeUndefined();
    db.requireTimeApproval = false;
    db.periods[1].time_from = "2027-02-26";
    db.periods[1].time_to = "2027-03-25";
    const w = PayrollRun.lineDetail({ id: "7", line: "71", prev: "3" }).timesheet;
    expect(w).toMatchObject({ from: "2027-02-26", to: "2027-03-25", requireApproval: false });
    expect(w.entries.map((e) => e.id)).toEqual(["t1", "t2"]);
  });

  test("không đọc được Time (vai trò thiếu quyền): vẫn trả các tab khác, timesheet có failed", () => {
    db.timebillFails = true;
    const d = PayrollRun.lineDetail({ id: "7", line: "71", prev: "3" });
    expect(d.timesheet).toMatchObject({ entries: [], failed: "no permission" });
    expect(d.earnings.length).toBe(2);
    expect(d.tax.pit).toBe(40);
  });

  test("phân bổ dự án và cấn trừ tạm ứng lấy từ chi tiết đã tính của dòng", () => {
    const d = PayrollRun.lineDetail({ id: "7", line: "71", prev: "3" });
    expect(d.allocations).toEqual([{ component: "GROSS", project: "P1", task: "T1", branch: "HN", workCenter: "KT", source: "T", hours: 8, ratio: 1, amount: 1100 }]);
    expect(d.advanceOffsets).toEqual([{ refNbr: "TU0001", amount: 50, remainingBalance: 150, id: "9" }]);
    const none = PayrollRun.lineDetail({ id: "7", line: "72", prev: "3" });
    expect(none.allocations).toEqual([]);
    expect(none.advanceOffsets).toEqual([]);
    expect(none.tax.insurance).toBeNull();
  });

  test("tải theo một nhân viên: số truy vấn không phụ thuộc số dòng của bảng lương, không nạp cả bảng lương", () => {
    PayrollRun.lineDetail({ id: "7", line: "71", prev: "3" });
    const small = db.queries.slice();
    db.queries = [];
    for (let i = 0; i < 1000; i++) db.lines[7].push(line(1000 + i, 5000 + i, 100));
    PayrollRun.lineDetail({ id: "7", line: "71", prev: "3" });
    expect(db.queries).toEqual(small);
    expect(small).not.toContain("s4vp_run_lines");
    expect(small.length).toBeLessThanOrEqual(12);
  });

  test("runView không trả chi tiết từng dòng (bảng lương 1.000 nhân viên vẫn gọn)", () => {
    for (let i = 0; i < 1000; i++) db.lines[7].push(line(1000 + i, 5000 + i, 100, { detail: JSON.stringify({ earnings: [{ earningType: "BASE", amount: 100 }] }) }));
    const v = PayrollRun.view({ id: "7" });
    expect(v.lines.length).toBe(1003);
    for (const k of ["detail", "earnings", "insurance", "allocations", "advanceOffsets", "time", "timesheet", "tax"]) expect(v.lines.every((l) => l[k] === undefined)).toBe(true);
    expect(JSON.stringify(v.lines[500]).length).toBeLessThan(900);
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
