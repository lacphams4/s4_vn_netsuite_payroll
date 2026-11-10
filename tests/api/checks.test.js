// Phân hệ Kiểm tra và nhật ký: api/Checks (summary, checksList, checkDetail, resolveCheck) và api/AuditLog (record, auditLog)
// với Store giả trong bộ nhớ. Kiểm dạng dữ liệu theo docs/UI_V2.md mục 9, kỳ trước theo ngày kết thúc kỳ, số truy vấn cố định,
// không lộ số định danh, nhật ký không chứa số tiền và không làm hỏng thao tác chính.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const mockDb = {};
const db = mockDb;
const mockUser = { id: 9, name: "Kế toán lương", lang: "vi_VN" };

jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ id: mockUser.id, name: mockUser.name, getPreference: () => mockUser.lang }) }), { virtual: true });
jest.mock("N/log", () => ({ error: (o) => mockDb.logs.push(o.details), audit: () => {}, debug: () => {} }), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2027-03-30" }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const LISTS = { employment_type: { 1: "E", 2: "C" } };
  const types = { batch: "select", employee: "select", profile: "select", employment_type: "select", error: "textarea" };
  const targets = { employment_type: "list:employment_type", batch: "rec:batch", employee: "employee", profile: "rec:employee" };
  const field = (k) => ({ id: `f_${k}`, type: types[k] || "currency", target: targets[k] || null });
  const table = (name) => mockDb[name] || [];
  return {
    rec: () => ({ type: "customrecord_x", fields: new Proxy({}, { get: (t, k) => field(String(k)) }) }),
    codeOf: (list, v) => (v === null || v === undefined ? null : LISTS[list][v] || null),
    run(sql, params, tag) {
      mockDb.queries.push(tag);
      if (tag === "s4vp_checks_lines") {
        return table("batch_emp").filter((l) => params.includes(l.batch)).map((l) => {
          const row = { id: l.id };
          for (const k of Object.keys(l)) if (k !== "id" && k !== "detail") row[`c_${k}`] = k === "employment_type" ? { E: 1, C: 2 }[l[k]] : l[k];
          return row;
        });
      }
      if (tag === "s4vp_checks_employees") return table("emp").filter((e) => params.includes(e.id));
      if (tag === "s4vp_checks_assignees") {
        if (mockDb.noAccessColumn) throw new Error("Field giveaccess not found");
        return table("emp").filter((e) => e.access);
      }
      throw new Error("unexpected query " + tag);
    },
    get(name, id) {
      mockDb.queries.push(`get_${name}`);
      return table(name).find((r) => r.id === String(id)) || null;
    },
    find(name, opt = {}) {
      mockDb.queries.push(`find_${name}`);
      const p = (opt.params || []).map(String);
      const w = opt.where || "";
      if ((name === "check_result" || name === "audit_log") && mockDb.notDeployed) throw new Error("Record type not found");
      if (name === "batch" && w.startsWith("{period}")) return table(name).filter((b) => b.period === p[0]);
      if (name === "batch") return table(name).filter((b) => b.subsidiary === p[0] && b.id !== p[1]);
      if (name === "batch_emp") return table(name).filter((l) => p.slice(0, -1).includes(l.batch) && l.employee === p[p.length - 1]);
      if (name === "batch_time" || name === "batch_input") return table(name).filter((r) => r.batch === p[0] && (p.length < 2 || r.employee === p[1]));
      if (name === "check_result") return table(name).filter((r) => r.batch === p[0]);
      if (name === "company") return table(name).filter((r) => r.subsidiary === p[0]);
      if (name === "audit_log") {
        let rows;
        if (w.startsWith("{batch} = ? OR")) rows = table(name).filter((r) => r.batch === p[0] || (r.period === p[1] && !r.batch));
        else if (w.startsWith("{batch}")) rows = table(name).filter((r) => r.batch === p[0]);
        else rows = table(name).filter((r) => r.period === p[0] || p.slice(1).includes(r.batch));
        return rows.slice().sort((a, b) => Number(b.id) - Number(a.id));
      }
      return table(name);
    },
    findIn(name, fieldName, ids) {
      mockDb.queries.push(`findIn_${name}`);
      const set = ids.map(String);
      return table(name).filter((r) => set.includes(String(r[fieldName])));
    },
    create(name, values) {
      if (mockDb.failWrite) throw new Error("no permission");
      const id = String(++mockDb.seq);
      (mockDb[name] = mockDb[name] || []).push(Object.assign({ id }, values));
      mockDb.writes.push(`create:${name}`);
      return id;
    },
    update(name, id, values) {
      Object.assign(table(name).find((r) => r.id === String(id)), values);
      mockDb.writes.push(`update:${name}`);
      return String(id);
    },
  };
});

let Checks;
let AuditLog;

const line = (id, batch, employee, extra = {}) =>
  Object.assign({ id: String(id), batch: String(batch), employee: String(employee), profile: `p${employee}`, employment_type: "E", std_days: 23, work_days: 23, insurance_wage: 10000000, gross: 11000000, ee_ins: 1050000, pit: 0, other_ded: 0, advance: 0, net: 9950000, error: null, detail: "" }, extra);
const prof = (employee, extra = {}) =>
  Object.assign({ id: `p${employee}`, employee: String(employee), salary_type: "M", employment_type: "E", hire_date: "2025-01-01", termination_date: null, ins_applicable: true, region: "I", tax_code: "8123456789", bank_account: "0011223344", bank_name: "VCB" }, extra);

function seed() {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    queries: [], writes: [], logs: [], seq: 100, notDeployed: false, failWrite: false, noAccessColumn: false,
    // Mã kỳ cố ý lệch so với ngày: kỳ trước phải được xác định theo ngày kết thúc
    period: [
      { id: "2", name: "202705", start: "2027-02-01", end: "2027-02-28", att_status: "L" },
      { id: "3", name: "202703", start: "2027-03-01", end: "2027-03-31", att_status: "L" },
      { id: "1", name: "202709", start: "2027-01-01", end: "2027-01-31", att_status: "L" },
      { id: "4", name: "202701", start: "2027-04-01", end: "2027-04-30", att_status: "O" },
    ],
    batch: [
      { id: "7", name: "BL000007", subsidiary: "13", period: "3", paygroup: "1", status: "C", calculated: true },
      { id: "6", name: "BL000006", subsidiary: "13", period: "2", paygroup: "1", status: "R", calculated: true },
      { id: "5", name: "BL000005", subsidiary: "13", period: "1", paygroup: "1", status: "R", calculated: true },
      { id: "8", name: "BL000008", subsidiary: "13", period: "4", paygroup: "1", status: "B", calculated: false },
      { id: "9", name: "BL000009", subsidiary: "13", period: "2", paygroup: "2", status: "R", calculated: true },
      { id: "10", name: "BL000010", subsidiary: "13", period: "2", paygroup: "1", status: "V", calculated: true },
    ],
    batch_emp: [
      line(71, 7, 1),
      line(72, 7, 2, { net: 12260174, gross: 13352174, detail: JSON.stringify({ earnings: [{ earningType: "BASE", amount: 10400000 }, { earningType: "BONUS", amount: 2500000 }, { earningType: "OT", amount: 452174 }] }) }),
      line(73, 7, 3, { net: -200000 }),
      line(74, 7, 4, { insurance_wage: 4000000 }),
      line(61, 6, 1),
      line(62, 6, 2, { net: 9308000, gross: 10400000, detail: JSON.stringify({ earnings: [{ earningType: "BASE", amount: 10400000 }] }) }),
      line(63, 6, 3),
      line(64, 6, 4, { insurance_wage: 4000000 }),
      line(51, 5, 1, { net: 1 }),
      line(101, 10, 2, { net: 1 }),
    ],
    employee: [prof(1), prof(2), prof(3, { tax_code: "", bank_account: "" }), prof(4)],
    emp: [
      { id: "1", entityid: "E011", firstname: "An", lastname: "Nguyễn", access: false },
      { id: "2", entityid: "E013", firstname: "Bình", lastname: "Trần", access: false },
      { id: "3", entityid: "E014", firstname: "Chi", lastname: "Lê", access: false },
      { id: "4", entityid: "E015", firstname: "Dũng", lastname: "Phạm", access: false },
      { id: "9", entityid: "KT01", firstname: "Lương", lastname: "Kế toán", access: true },
      { id: "20", entityid: "HR01", firstname: "Sự", lastname: "Nhân", access: true },
    ],
    param: [
      { id: "1", name: "MINWAGE.I", effective: "2026-01-01", expiration: null, value: 5310000 },
      { id: "2", name: "MINWAGE.I", effective: "2024-07-01", expiration: "2025-12-31", value: 4960000 },
      { id: "3", name: "MINWAGE.II", effective: "2026-01-01", expiration: null, value: 4730000 },
    ],
    earning_type: [{ id: "1", name: "BASE", description: "Lương cơ bản" }, { id: "2", name: "BONUS", description: "Thưởng đột xuất" }],
    batch_time: [],
    batch_input: [{ id: "31", batch: "7", employee: "2", kind: "E", description: "Thưởng đột xuất", amount: 2500000 }],
    check_result: [],
    audit_log: [],
    setup: [{ id: "1", region: "I" }],
    company: [],
  });
  jest.resetModules();
  Checks = require(path.join(API, "Checks"));
  AuditLog = require(path.join(API, "AuditLog"));
}

beforeEach(seed);

describe("Checks.summary và checksList", () => {
  test("summary trả bốn số nguyên theo hợp đồng", () => {
    expect(Checks.summary("7")).toEqual({ open: 4, errors: 1, warnings: 3, resolved: 0 });
  });

  test("checksList: dạng dữ liệu, khóa, thứ tự và tên nhân viên", () => {
    const r = Checks.routes.get.checksList.run({ batch: "7" });
    expect(Checks.routes.get.checksList.roles).toBe("payroll");
    expect(r.counts).toEqual({ open: 4, errors: 1, warnings: 3, resolved: 0 });
    expect(r.blocking).toBe(1);
    expect(r.items.map((i) => i.key)).toEqual(["NET_NEGATIVE:3", "INS_BELOW_MIN:4", "MISSING_TAX_CODE:3", "NET_CHANGE:2"]);
    const change = r.items.find((i) => i.rule === "NET_CHANGE");
    expect(change).toMatchObject({
      key: "NET_CHANGE:2", rule: "NET_CHANGE", severity: "warn", title: "Thực lĩnh lệch trên 20% so với kỳ trước", headline: "thực lĩnh tăng 31,7%", employee: "2", employeeCode: "E013",
      employeeName: "Trần Bình", lineId: "72", amount: 2952174, status: "open", assignee: null, note: "", canClose: true,
    });
    for (const k of ["key", "rule", "severity", "title", "employee", "employeeName", "lineId", "amount", "status", "assignee", "note"]) expect(change).toHaveProperty(k);
    expect(r.batch).toMatchObject({ id: "7", name: "BL000007", status: "C", periodName: "202703", periodEnd: "2027-03-31", prevBatch: { id: "6", periodName: "202705" } });
  });

  test("kỳ trước chọn theo ngày kết thúc kỳ, cùng nhóm lương, bỏ bảng đã đảo", () => {
    // BL6 (kết thúc 28/02) thắng BL5 (31/01); BL9 khác nhóm lương, BL10 đã đảo đều bị bỏ dù cùng kỳ
    expect(Checks.checksList({ batch: "7" }).batch.prevBatch.id).toBe("6");
    db.batch.find((b) => b.id === "6").status = "V";
    jest.resetModules();
    Checks = require(path.join(API, "Checks"));
    expect(Checks.checksList({ batch: "7" }).batch.prevBatch.id).toBe("5");
  });

  test("không lộ mã số thuế, số tài khoản", () => {
    const dump = JSON.stringify(Checks.checksList({ batch: "7" })) + JSON.stringify(Checks.checkDetail({ batch: "7", rule: "MISSING_TAX_CODE", employee: "3" }));
    expect(dump).not.toContain("8123456789");
    expect(dump).not.toContain("0011223344");
  });

  test("số truy vấn cố định, không lặp theo nhân viên; kết quả được nhớ trong một lần chạy", () => {
    Checks.summary("7");
    const first = db.queries.length;
    expect(first).toBeLessThanOrEqual(12);
    expect(db.queries.filter((q) => q === "s4vp_checks_lines")).toHaveLength(1);
    Checks.summary("7");
    Checks.blockers("7");
    expect(db.queries.length).toBe(first);
    // thêm 40 nhân viên: số truy vấn không đổi
    for (let i = 0; i < 40; i++) {
      db.batch_emp.push(line(200 + i, 7, 50 + i));
      db.employee.push(prof(50 + i));
    }
    jest.resetModules();
    Checks = require(path.join(API, "Checks"));
    db.queries.length = 0;
    Checks.summary("7");
    expect(db.queries.length).toBe(first);
  });

  test("mức tối thiểu lấy từ tham số hiệu lực cuối kỳ; không có tham số thì bỏ quy tắc; tham số riêng thắng", () => {
    const ins = () => Checks.checksList({ batch: "7" }).items.find((i) => i.rule === "INS_BELOW_MIN");
    expect(Checks.checkDetail({ batch: "7", rule: "INS_BELOW_MIN", employee: "4" }).item.data).toMatchObject({ wage: 4000000, min: 5310000, region: "I", param: "MINWAGE.*" });
    db.param = [];
    seedModules();
    expect(ins()).toBeUndefined();
    db.param = [{ id: "9", name: "CHECK.INS_WAGE_MIN", effective: "2027-01-01", value: 4500000 }, { id: "1", name: "MINWAGE.I", effective: "2026-01-01", value: 3000000 }];
    seedModules();
    expect(Checks.checkDetail({ batch: "7", rule: "INS_BELOW_MIN", employee: "4" }).item.data).toMatchObject({ min: 4500000, param: "CHECK.INS_WAGE_MIN" });
    // tham số chưa hiệu lực ở ngày cuối kỳ thì không dùng
    db.param = [{ id: "9", name: "MINWAGE.I", effective: "2027-04-01", value: 9000000 }];
    seedModules();
    expect(ins()).toBeUndefined();
  });

  test("ngưỡng chênh lệch lấy từ tham số CHECK.NET_CHANGE_PCT nếu có", () => {
    db.param.push({ id: "8", name: "CHECK.NET_CHANGE_PCT", effective: "2027-01-01", value: 0.5 });
    seedModules();
    expect(Checks.checksList({ batch: "7" }).items.find((i) => i.rule === "NET_CHANGE")).toBeUndefined();
  });

  test("bảng lương chưa có nhân viên: một lỗi cấp bảng lương; bảng không tồn tại: lỗi nghiệp vụ", () => {
    const r = Checks.checksList({ batch: "8" });
    expect(r.items.map((i) => i.key)).toEqual(["NO_EMPLOYEES"]);
    expect(r.items[0]).toMatchObject({ employee: null, employeeName: "", lineId: null, severity: "error" });
    expect(r.counts).toEqual({ open: 1, errors: 1, warnings: 0, resolved: 0 });
    expect(() => Checks.summary("999")).toThrow(/Không tìm thấy bảng lương/);
    expect(() => Checks.summary("")).toThrow(/Thiếu bảng lương/);
  });

  test("record kết quả chưa deploy: vẫn tính được cảnh báo", () => {
    db.notDeployed = true;
    expect(Checks.summary("7").open).toBe(4);
  });

  test("danh sách người phụ trách: người có quyền đăng nhập; không đọc được thì còn người đang dùng", () => {
    expect(Checks.checksList({ batch: "7" }).assignees.map((a) => a.id).sort()).toEqual(["20", "9"]);
    db.noAccessColumn = true;
    expect(Checks.checksList({ batch: "7" }).assignees).toEqual([{ id: "9", name: "Kế toán lương" }]);
  });

  test("tiếng Anh theo tùy chọn người dùng", () => {
    mockUser.lang = "en_US";
    try {
      expect(Checks.checksList({ batch: "7" }).items.find((i) => i.rule === "NET_NEGATIVE").title).toBe("Negative net pay");
    } finally {
      mockUser.lang = "vi_VN";
    }
  });

  test("assertApprovable ném lỗi khi còn lỗi chặn duyệt, qua khi hết", () => {
    expect(() => Checks.assertApprovable("7")).toThrow(/1 lỗi kiểm tra chặn duyệt/);
    expect(Checks.blockers("7").map((i) => i.key)).toEqual(["NET_NEGATIVE:3"]);
    db.batch_emp.find((l) => l.id === "73").net = 9950000;
    seedModules();
    expect(() => Checks.assertApprovable("7")).not.toThrow();
  });
});

function seedModules() {
  jest.resetModules();
  Checks = require(path.join(API, "Checks"));
  AuditLog = require(path.join(API, "AuditLog"));
}

describe("Checks.checkDetail", () => {
  test("chênh thực lĩnh: so sánh từng khoản kỳ này, kỳ trước, chênh; kèm khoản nhập tay và số liệu nền", () => {
    const d = Checks.routes.get.checkDetail.run({ batch: "7", rule: "NET_CHANGE", employee: "2" });
    expect(d.item).toMatchObject({ key: "NET_CHANGE:2", status: "open" });
    expect(d.item.description).toContain("tăng 31,7%");
    expect(d.item.hint).toBeTruthy();
    expect(d.compare).toMatchObject({ hasPrev: true, hasCur: true, periodName: "202703", prevPeriodName: "202705", prevBatch: "6" });
    const row = (k) => d.compare.rows.find((r) => r.key === k);
    expect(d.compare.rows.map((r) => r.key)).toEqual(["earning:BASE", "earning:BONUS", "earning:OT", "gross", "ee_ins", "pit", "net"]);
    expect(row("earning:BASE")).toMatchObject({ label: "Lương cơ bản", prev: 10400000, cur: 10400000, diff: 0, changed: false });
    expect(row("earning:BONUS")).toMatchObject({ label: "Thưởng đột xuất", prev: 0, cur: 2500000, diff: 2500000, changed: true });
    expect(row("earning:OT").label).toBe("OT");
    expect(row("net")).toMatchObject({ prev: 9308000, cur: 12260174, diff: 2952174, strong: true });
    expect(row("net").ratio).toBeCloseTo(0.3172, 4);
    expect(d.inputs).toEqual([{ id: "31", kind: "E", description: "Thưởng đột xuất", amount: 2500000 }]);
    expect(d.facts.find((f) => f.key === "threshold")).toEqual({ key: "threshold", value: 0.2, kind: "pct" });
    expect(d.facts.find((f) => f.key === "workDays").value).toBe(23);
    expect(d.profileId).toBe("p2");
    expect(d.history).toEqual([]);
  });

  test("cảnh báo cấp bảng lương và cảnh báo không còn", () => {
    const top = Checks.checkDetail({ batch: "8", rule: "NO_EMPLOYEES" });
    expect(top.item.key).toBe("NO_EMPLOYEES");
    expect(top.compare).toBeNull();
    const gone = Checks.checkDetail({ batch: "7", rule: "NET_ZERO", employee: "1" });
    expect(gone).toMatchObject({ item: null, compare: null, history: [] });
  });
});

describe("Checks.resolveCheck", () => {
  const post = (body) => Checks.routes.post.resolveCheck.run(Object.assign({ batch: "7" }, body));

  test("chấp nhận cảnh báo: lưu record, đổi số liệu tổng, có lịch sử", () => {
    expect(Checks.routes.post.resolveCheck.roles).toBe("payroll");
    const r = post({ rule: "NET_CHANGE", employee: "2", status: "accepted", note: " Thưởng theo quyết định ", assignee: "20" });
    expect(r).toMatchObject({ ok: true, key: "NET_CHANGE:2", rule: "NET_CHANGE", employee: "2", employeeCode: "E013", status: "accepted", previous: "open", counts: { open: 3, errors: 1, warnings: 2, resolved: 1 } });
    expect(db.check_result).toHaveLength(1);
    expect(db.check_result[0]).toMatchObject({ batch: "7", rule: "NET_CHANGE", employee: "2", status: "A", assignee: "20", note: "Thưởng theo quyết định", updated_by: "9", updated_date: "2027-03-30", key: "NET_CHANGE:2" });
    expect(db.check_result[0].stamp).toMatch(/^[0-9a-z]+$/);
    const item = Checks.checksList({ batch: "7" }).items.find((i) => i.key === "NET_CHANGE:2");
    expect(item).toMatchObject({ status: "accepted", note: "Thưởng theo quyết định", assignee: "20", assigneeName: "Nhân Sự" });
    const d = Checks.checkDetail({ batch: "7", rule: "NET_CHANGE", employee: "2" });
    expect(d.history).toHaveLength(1);
    expect(d.history[0]).toMatchObject({ user: "Kế toán lương", status: "accepted", note: "Thưởng theo quyết định", assigneeName: "Nhân Sự" });
    expect(d.history[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("lưu lần hai cập nhật cùng record; mở lại không cần ghi chú; lịch sử mới nhất trước", () => {
    post({ rule: "NET_CHANGE", employee: "2", status: "resolved", note: "đã sửa" });
    const r = post({ rule: "NET_CHANGE", employee: "2", status: "open", note: "" });
    expect(r).toMatchObject({ status: "open", previous: "resolved" });
    expect(db.check_result).toHaveLength(1);
    expect(db.check_result[0]).toMatchObject({ status: "O", stamp: "", note: "" });
    expect(db.writes).toEqual(["create:check_result", "update:check_result"]);
    expect(Checks.checkDetail({ batch: "7", rule: "NET_CHANGE", employee: "2" }).history.map((h) => h.status)).toEqual(["open", "resolved"]);
  });

  test("chỉ lưu ghi chú / người phụ trách thì giữ trạng thái", () => {
    const r = post({ rule: "MISSING_TAX_CODE", employee: "3", note: "Đang hỏi nhân sự", assignee: "20" });
    expect(r.status).toBe("open");
    expect(db.check_result[0]).toMatchObject({ status: "O", note: "Đang hỏi nhân sự", assignee: "20" });
  });

  test("từ chối: đóng không ghi chú, đóng lỗi mức error, trạng thái lạ, người phụ trách sai, cảnh báo không còn", () => {
    expect(() => post({ rule: "NET_CHANGE", employee: "2", status: "accepted", note: "  " })).toThrow(/Cần ghi chú khi đóng cảnh báo/);
    expect(() => post({ rule: "NET_NEGATIVE", employee: "3", status: "accepted", note: "cứ duyệt" })).toThrow(/Lỗi không đóng tay được/);
    expect(() => post({ rule: "NET_CHANGE", employee: "2", status: "done", note: "x" })).toThrow(/Trạng thái không hợp lệ/);
    expect(() => post({ rule: "NET_CHANGE", employee: "2", status: "accepted", note: "x", assignee: "1 OR 1=1" })).toThrow(/Người phụ trách không hợp lệ/);
    expect(() => post({ rule: "NET_ZERO", employee: "1", status: "accepted", note: "x" })).toThrow(/không còn/);
    expect(db.check_result).toHaveLength(0);
    try {
      post({ rule: "NET_NEGATIVE", employee: "3", status: "accepted", note: "x" });
    } catch (e) {
      expect(e.userMessage.en).toBeTruthy();
      expect(e.userMessage.vi).toBeTruthy();
    }
  });

  test("lỗi mức error vẫn ghi chú và giao người phụ trách được", () => {
    const r = post({ rule: "NET_NEGATIVE", employee: "3", note: "Chờ nhân sự sửa khấu trừ", assignee: "20" });
    expect(r.status).toBe("open");
    expect(Checks.summary("7").errors).toBe(1);
  });

  test("số liệu đổi sau khi chấp nhận: cảnh báo mở lại", () => {
    post({ rule: "NET_CHANGE", employee: "2", status: "accepted", note: "ok" });
    db.batch_emp.find((l) => l.id === "72").net = 13000000;
    seedModules();
    const item = Checks.checksList({ batch: "7" }).items.find((i) => i.key === "NET_CHANGE:2");
    expect(item).toMatchObject({ status: "open", reopened: true, note: "ok" });
  });
});

describe("AuditLog.record", () => {
  test("ghi thao tác trên bảng lương với diễn giải chỉ gồm số lượng", () => {
    const id = AuditLog.record({ action: "calculate", batch: 7, period: null, id: 7, lineId: null, result: { ok: true, errors: [], totals: { emp_count: 4, gross: 116080000, net: 100766900 }, status: "C" } });
    expect(id).toBeTruthy();
    expect(db.audit_log).toHaveLength(1);
    const row = db.audit_log[0];
    expect(row).toMatchObject({ action: "calculate", batch: "7", period: null, user: "9", user_name: "Kế toán lương", date: "2027-03-30", text_vi: "4 nhân viên, không lỗi", text_en: "4 employees, no errors", line: "" });
    expect(row.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(JSON.stringify(row)).not.toMatch(/116080000|100766900/);
  });

  test("bỏ qua jobStatus, thao tác thiết lập, action lạ không gắn bảng lương hay kỳ, và entry rỗng", () => {
    expect(AuditLog.record({ action: "jobStatus", batch: 7 })).toBeNull();
    expect(AuditLog.record({ action: "saveSetup", batch: null, period: null, result: {} })).toBeNull();
    expect(AuditLog.record({ action: "saveProfile", id: 3 })).toBeNull();
    expect(AuditLog.record(null)).toBeNull();
    expect(AuditLog.record({})).toBeNull();
    expect(db.audit_log).toHaveLength(0);
  });

  test("diễn giải theo thao tác: nạp nhân viên, nạp giờ, tính lỗi, chạy nền, xử lý cảnh báo", () => {
    expect(AuditLog.build({ action: "loadEmployees", batch: 7, result: { added: 3, skipped: 1, updated: 2 } })).toMatchObject({ text_vi: "Thêm 3, cập nhật 2, bỏ qua 1 nhân viên" });
    expect(AuditLog.build({ action: "syncTime", batch: 7, result: { entries: 11, accepted: 10, pending: 1 } }).text_vi).toBe("Nhận 10/11 dòng timesheet; 1 dòng chưa duyệt");
    expect(AuditLog.build({ action: "calculate", batch: 7, result: { ok: false, errors: ["E013: lỗi"], totals: { emp_count: 4 } } }).text_vi).toBe("4 nhân viên, 1 lỗi");
    expect(AuditLog.build({ action: "calculate", batch: 7, result: { queued: true, job: "x" } }).text_en).toBe("Queued in the background");
    expect(AuditLog.build({ action: "approve", batch: 7, result: { ok: true } })).toMatchObject({ action: "approve", batch: "7", text_vi: "", text_en: "" });
    const check = AuditLog.build({ action: "resolveCheck", batch: "7", result: { key: "NET_CHANGE:2", rule: "NET_CHANGE", employeeCode: "E013", status: "accepted" } });
    expect(check).toMatchObject({ line: "NET_CHANGE:2", text_vi: "NET_CHANGE - E013: chấp nhận", text_en: "NET_CHANGE - E013: accepted" });
  });

  test("thao tác trên kỳ và action mới của phân hệ khác có gắn bảng lương", () => {
    AuditLog.record({ action: "lockAttendance", batch: null, period: 3, id: 3, result: { ok: true } });
    AuditLog.record({ action: "submitRun", batch: "7", period: null, id: null, result: { ok: true, net: 5 } });
    expect(db.audit_log.map((r) => [r.action, r.batch, r.period])).toEqual([["lockAttendance", null, "3"], ["submitRun", "7", null]]);
    expect(db.audit_log[1].text_vi).toBe("");
  });

  test("thao tác trên dòng: tìm bảng lương của dòng; không tìm được thì không ghi", () => {
    AuditLog.record({ action: "updateLine", batch: null, period: null, id: 72, lineId: null, result: { ok: true } });
    expect(db.audit_log[0]).toMatchObject({ action: "updateLine", batch: "7", line: "72" });
    expect(AuditLog.record({ action: "removeLine", batch: null, period: null, id: 999, result: { ok: true } })).toBeNull();
    AuditLog.record({ action: "removeLine", batch: 7, period: null, id: 73, result: { ok: true } });
    expect(db.audit_log[1]).toMatchObject({ action: "removeLine", batch: "7", line: "73" });
  });

  test("lỗi khi ghi không ném ra ngoài", () => {
    db.failWrite = true;
    expect(() => AuditLog.record({ action: "approve", batch: 7, result: {} })).not.toThrow();
    expect(AuditLog.record({ action: "approve", batch: 7, result: {} })).toBeNull();
    expect(db.logs.some((l) => /no permission/.test(l))).toBe(true);
    const cyclic = {};
    cyclic.self = cyclic;
    db.failWrite = false;
    expect(() => AuditLog.record({ action: "calculate", batch: 7, result: cyclic })).not.toThrow();
  });
});

describe("AuditLog.auditLog", () => {
  const fill = () => {
    AuditLog.record({ action: "createBatch", batch: 7, period: 3, result: { id: 7 } });
    AuditLog.record({ action: "lockAttendance", period: 3, id: 3, result: {} });
    AuditLog.record({ action: "loadEmployees", batch: 7, id: 7, result: { added: 4 } });
    AuditLog.record({ action: "approve", batch: 6, id: 6, result: {} });
    AuditLog.record({ action: "lockAttendance", period: 2, id: 2, result: {} });
  };

  test("theo bảng lương: mới nhất trước, gồm thao tác cấp kỳ của kỳ đó, đúng dạng hợp đồng", () => {
    fill();
    const r = AuditLog.routes.get.auditLog.run({ batch: "7" });
    expect(AuditLog.routes.get.auditLog.roles).toBe("payroll");
    expect(r.items.map((i) => i.action)).toEqual(["loadEmployees", "lockAttendance", "createBatch"]);
    expect(r.items[0]).toMatchObject({ user: "Kế toán lương", action: "loadEmployees", label: "Nạp nhân viên", detail: "Thêm 4, cập nhật 0, bỏ qua 0 nhân viên", text: "Nạp nhân viên - Thêm 4, cập nhật 0, bỏ qua 0 nhân viên", lineId: null });
    expect(r.items[1].text).toBe("Khóa công");
    for (const k of ["at", "user", "action", "text", "lineId"]) expect(r.items[0]).toHaveProperty(k);
  });

  test("theo kỳ: gồm thao tác của các bảng lương thuộc kỳ", () => {
    fill();
    expect(AuditLog.auditLog({ period: "2" }).items.map((i) => i.action)).toEqual(["lockAttendance", "approve"]);
    expect(AuditLog.auditLog({ period: "4" }).items).toEqual([]);
  });

  test("tiếng Anh, thiếu tham số, record chưa deploy", () => {
    fill();
    mockUser.lang = "en_US";
    try {
      expect(AuditLog.auditLog({ batch: "7" }).items[0].text).toBe("Loaded employees - 4 added, 0 updated, 0 skipped");
    } finally {
      mockUser.lang = "vi_VN";
    }
    expect(() => AuditLog.auditLog({})).toThrow(/Cần chọn bảng lương hoặc kỳ lương/);
    expect(() => AuditLog.auditLog({ batch: "7; DROP" })).toThrow();
    db.notDeployed = true;
    expect(AuditLog.auditLog({ batch: "7" })).toEqual({ items: [], unavailable: true });
  });

  test("resolveCheck qua RESTlet được ghi nhật ký với khóa cảnh báo", () => {
    const result = Checks.resolveCheck({ batch: "7", rule: "NET_CHANGE", employee: "2", status: "accepted", note: "Thưởng 2.500.000 theo quyết định" });
    AuditLog.record({ action: "resolveCheck", batch: "7", period: null, id: null, lineId: null, result });
    const item = AuditLog.auditLog({ batch: "7" }).items[0];
    expect(item).toMatchObject({ action: "resolveCheck", lineId: "NET_CHANGE:2", text: "Xử lý cảnh báo - NET_CHANGE - E013: chấp nhận" });
    // ghi chú của người dùng không vào nhật ký
    expect(JSON.stringify(db.audit_log)).not.toContain("2.500.000");
  });
});
