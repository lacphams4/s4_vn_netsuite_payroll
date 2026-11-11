// api/PunchImport (docs/PUNCH_IMPORT.md mục 3) với Store giả trong bộ nhớ (trả dòng thô theo tag câu SuiteQL), Lean, Schema và lõi
// thật. Kiểm: dạng phản hồi GET, trạng thái từng dòng khi xem trước (new / duplicate / invalid / unmatched / locked), danh sách
// mã chưa đối chiếu, trùng với lượt chấm đã có, ghi theo lượt với cursor khi gần hết governance, lưu đối chiếu (thêm / sửa / thôi
// dùng chỉ dòng gửi lên), kiểm đầu vào, quyền khai trên route, không có khóa "error" ở mọi cấp.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const mockDb = {};

jest.mock("N/runtime", () => ({
  getCurrentUser: () => ({ id: 5, roleId: "administrator" }),
  getCurrentScript: () => ({ getRemainingUsage: () => mockDb.usage }),
}), { virtual: true });
jest.mock("N/query", () => ({}), { virtual: true });
jest.mock("N/record", () => ({}), { virtual: true });
jest.mock("N/format", () => ({}), { virtual: true });
jest.mock("N/cache", () => ({}), { virtual: true });

jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const Schema = jest.requireActual("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Schema");
  const rows = (name) => mockDb.t[name] || (mockDb.t[name] = []);
  const copy = (r) => JSON.parse(JSON.stringify(r));
  const check = (name, values) => {
    const def = Schema.records[name];
    for (const k of Object.keys(values)) if (k !== "isInactive" && k !== "name" && !def.fields[k]) throw new Error(`Unknown field ${name}.${k}`);
  };
  const inList = (sql, re) => ((re.exec(sql) || ["", ""])[1] || "").split(",").map((x) => x.trim()).filter(Boolean);
  const emp = (id) => mockDb.t.emp.find((e) => String(e.id) === String(id));

  function find(name, opt = {}) {
    mockDb.sql.push(`find:${name}`);
    let list = rows(name).filter((r) => opt.includeInactive || !r.isInactive);
    const w = opt.where || "";
    if (w.startsWith("{source} = ?")) list = list.filter((r) => String(r.source) === String(opt.params[0]));
    if (w.startsWith("{subsidiary} = ? OR")) list = list.filter((r) => !r.subsidiary || String(r.subsidiary) === String(opt.params[0]));
    if (w.startsWith("{id} = ?")) list = list.filter((r) => String(r.id) === String(opt.params[0]));
    return list.map(copy);
  }

  function run(sql, params, tag) {
    mockDb.sql.push(tag);
    if (tag === "s4vp_pi_map_counts") {
      const n = {};
      for (const m of rows("punch_map").filter((r) => !r.isInactive)) n[m.source] = (n[m.source] || 0) + 1;
      return Object.keys(n).map((src) => ({ src, n: n[src] }));
    }
    if (tag === "s4vp_pi_maps") {
      return rows("punch_map").filter((r) => !r.isInactive && String(r.source) === String(params[0])).map((m) => {
        const e = emp(m.employee) || {};
        return { id: m.id, c_device: m.device || null, c_machine_id: m.machine_id, c_employee: m.employee, c_effective: m.effective || null, c_expiration: m.expiration || null, e_code: e.entityid || null, e_first: e.firstname || null, e_last: e.lastname || null };
      });
    }
    if (tag === "s4vp_pi_emp") {
      mockDb.empParams.push(params.slice());
      const ids = inList(sql, /e\.id IN \(([^)]*)\)/);
      return mockDb.t.emp.filter((e) => params.includes(String(e.entityid).toUpperCase()) || ids.includes(String(e.id))).map((e) => ({ id: e.id, code: e.entityid, first: e.firstname, last: e.lastname }));
    }
    if (tag === "s4vp_pi_existing") {
      const ids = inList(sql, /_employee IN \(([^)]*)\)/);
      mockDb.existingRange.push(params.slice());
      return rows("punch").filter((p) => !p.isInactive && ids.includes(String(p.employee)) && p.punch_date >= params[0] && p.punch_date <= params[1])
        .map((p) => ({ id: p.id, c_employee: p.employee, c_punch_time: p.punch_time }));
    }
    if (tag === "s4vp_pi_map_emp") {
      const ids = inList(sql, /e\.id IN \(([^)]*)\)/);
      return mockDb.t.emp.filter((e) => ids.includes(String(e.id))).map((e) => ({ id: e.id }));
    }
    throw new Error(`Unexpected query ${tag}`);
  }

  return {
    find, run,
    get: (name, id) => find(name, { where: "{id} = ?", params: [id], includeInactive: true })[0] || null,
    create: (name, values) => {
      check(name, values);
      if (mockDb.failOn && mockDb.failOn(name, values)) throw new Error("Record save failed");
      const id = String(++mockDb.seq);
      rows(name).push(Object.assign({ id }, copy(values)));
      mockDb.writes.push({ kind: "create", name, id, values: copy(values) });
      mockDb.usage -= mockDb.costPerCreate;
      return id;
    },
    submit: (name, id, values) => {
      check(name, values);
      Object.assign(rows(name).find((r) => r.id === String(id)), copy(values));
      mockDb.writes.push({ kind: "submit", name, id: String(id), values: copy(values) });
    },
    update: (name, id, values) => {
      check(name, values);
      Object.assign(rows(name).find((r) => r.id === String(id)), copy(values));
      mockDb.writes.push({ kind: "update", name, id: String(id), values: copy(values) });
      return String(id);
    },
    codeOf: (list, v) => v,
    rec: (name) => Schema.records[name],
    stats: [],
  };
});

const PI = require(path.join(API, "PunchImport"));

/** Không có khóa tên "error" ở bất kỳ cấp nào. */
function noErrorKey(x, where = "$") {
  if (Array.isArray(x)) return x.forEach((v, i) => noErrorKey(v, `${where}[${i}]`));
  if (!x || typeof x !== "object") return;
  for (const k of Object.keys(x)) {
    if (k === "error") throw new Error(`key "error" at ${where}`);
    noErrorKey(x[k], `${where}.${k}`);
  }
}

function seed() {
  Object.assign(mockDb, { seq: 5000, usage: 5000, costPerCreate: 0, writes: [], sql: [], empParams: [], existingRange: [], failOn: null });
  mockDb.t = {
    emp: [
      { id: "101", entityid: "NV001", firstname: "An", lastname: "Nguyễn" },
      { id: "102", entityid: "NV002", firstname: "Bình", lastname: "Trần" },
      { id: "103", entityid: "NV003", firstname: "Chi", lastname: "Lê" },
      { id: "104", entityid: "NV004", firstname: "Dũng", lastname: "Phạm" },
    ],
    punch_source: [
      { id: "1", name: "ZK-XUONG", subsidiary: "13", description: "Máy xưởng", layout: "Z", id_kind: "M", device_default: "ZK-01", minute_offset: 0, has_header: true },
      { id: "2", name: "EXCEL-VP", subsidiary: null, description: "", layout: "E", has_header: true, delimiter: "A", col_emp: "Mã NV", col_datetime: "Thời điểm", col_device: "Máy", date_format: "DMY", id_kind: "B" },
      { id: "3", name: "KHAC", subsidiary: "14", layout: "P", id_kind: "N" },
      { id: "4", name: "CU", subsidiary: null, layout: "E", isInactive: true },
    ],
    punch_map: [
      { id: "11", source: "1", device: "", machine_id: "1", employee: "101", effective: null, expiration: null },
      { id: "12", source: "1", device: "", machine_id: "2", employee: "102", effective: "2026-01-01", expiration: "2026-10-31" },
      { id: "13", source: "1", device: "", machine_id: "2", employee: "103", effective: "2026-11-01", expiration: null },
      { id: "14", source: "1", device: "", machine_id: "9", employee: "104", isInactive: true },
      { id: "15", source: "2", device: "", machine_id: "X", employee: "104" },
    ],
    period: [
      { id: "7", name: "202610", start: "2026-10-01", end: "2026-10-31", att_status: "L" },
      { id: "8", name: "202611", start: "2026-11-01", end: "2026-11-30", att_status: "O" },
    ],
    punch: [{ id: "900", employee: "101", punch_date: "2026-11-03", punch_time: "2026-11-03 17:01", source: "I" }],
  };
}

beforeEach(seed);

const ZK = [
  "     1\t2026-11-03 07:58:12\t1\t0\t1\t0", // 101 mới
  "     1\t2026-11-03 17:01:40\t1\t1\t1\t0", // 101 trùng lượt đã có
  "     2\t2026-11-03 08:02:00\t1\t0\t1\t0", // 103 (dòng đối chiếu hiệu lực từ 01/11)
  "     2\t2026-10-30 08:00:00\t1\t0\t1\t0", // 102, kỳ công 10 đã khóa
  "    55\t2026-11-03 08:00:00\t1\t0\t1\t0", // chưa đối chiếu
  "    55\t2026-11-02 08:00:00\t1\t0\t1\t0", // chưa đối chiếu
  "     9\t2026-11-03 08:00:00\t1\t0\t1\t0", // dòng đối chiếu đã thôi dùng
  "     1\t2026-02-30 08:00:00\t1\t0\t1\t0", // ngày không tồn tại
  "     1\t2026-11-03 07:58:59\t1\t0\t1\t0", // trùng dòng 1 trong file (cùng phút)
].join("\r\n");

describe("GET", () => {
  test("punchSourcesView: nguồn của công ty con + nguồn chung, không lấy nguồn thôi dùng; số dòng đối chiếu; record type", () => {
    const out = PI.punchSourcesView({ subsidiary: "13" });
    noErrorKey(out);
    expect(out.sources.map((s) => s.code)).toEqual(["ZK-XUONG", "EXCEL-VP"]);
    expect(out.sources[1]).toEqual({
      id: "2", code: "EXCEL-VP", description: "", subsidiary: null, layout: "E", hasHeader: true, skipLines: 0, delimiter: "A",
      colEmp: "Mã NV", colDatetime: "Thời điểm", colDate: "", colTime: "", colIn: "", colOut: "", colDevice: "Máy",
      dateFormat: "DMY", idKind: "B", deviceDefault: "", minuteOffset: 0,
    });
    expect(out.mapCounts).toEqual({ 1: 3, 2: 1 });
    expect(out.recordTypes).toEqual({ source: "customrecord_s4vp_punch_source", map: "customrecord_s4vp_punch_map" });
    expect(PI.punchSourcesView({}).sources.map((s) => s.code)).toEqual(["ZK-XUONG", "EXCEL-VP", "KHAC"]);
  });

  test("punchMappings: dòng đang dùng kèm mã, họ tên; nguồn sai / thôi dùng báo lỗi", () => {
    const out = PI.punchMappings({ source: "1" });
    noErrorKey(out);
    expect(out.rows).toEqual([
      { id: "11", device: "", machineId: "1", employee: "101", code: "NV001", name: "Nguyễn An", effective: null, expiration: null },
      { id: "12", device: "", machineId: "2", employee: "102", code: "NV002", name: "Trần Bình", effective: "2026-01-01", expiration: "2026-10-31" },
      { id: "13", device: "", machineId: "2", employee: "103", code: "NV003", name: "Lê Chi", effective: "2026-11-01", expiration: null },
    ]);
    expect(() => PI.punchMappings({ source: "4" })).toThrow(/Không tìm thấy hồ sơ nguồn/);
    expect(() => PI.punchMappings({ source: "abc" })).toThrow(/Chưa chọn hồ sơ nguồn/);
  });

  test("quyền: đọc payroll (HR, kế toán, admin), ghi hr (HR, admin)", () => {
    expect(Object.fromEntries(Object.entries(PI.routes.get).map(([k, v]) => [k, v.roles]))).toEqual({ punchSourcesView: "payroll", punchMappings: "payroll" });
    expect(Object.fromEntries(Object.entries(PI.routes.post).map(([k, v]) => [k, v.roles]))).toEqual({ punchPreview: "hr", punchCommit: "hr", punchMapSave: "hr" });
  });
});

describe("punchPreview", () => {
  test("trạng thái từng dòng, số đếm, mã chưa đối chiếu, khoảng ngày, không ghi gì", () => {
    const out = PI.punchPreview({ source: "1", text: ZK });
    noErrorKey(out);
    expect(out.counts).toEqual({ total: 9, new: 2, duplicate: 2, invalid: 1, unmatched: 3, locked: 1 });
    expect(out.rows.map((r) => [r.line, r.machineId, r.time, r.employee, r.status])).toEqual([
      [1, "1", "2026-11-03 07:58", "101", "new"],
      [2, "1", "2026-11-03 17:01", "101", "duplicate"],
      [3, "2", "2026-11-03 08:02", "103", "new"],
      [4, "2", "2026-10-30 08:00", "102", "locked"],
      [5, "55", "2026-11-03 08:00", null, "unmatched"],
      [6, "55", "2026-11-02 08:00", null, "unmatched"],
      [7, "9", "2026-11-03 08:00", null, "unmatched"],
      [8, "", "", null, "invalid"],
      [9, "1", "2026-11-03 07:58", "101", "duplicate"],
    ]);
    expect(out.rows[0]).toEqual({ line: 1, machineId: "1", device: "ZK-01", time: "2026-11-03 07:58", kind: "", employee: "101", code: "NV001", name: "Nguyễn An", how: "map", status: "new", vi: "", en: "" });
    expect(out.rows[1]).toMatchObject({ vi: "Đã có lượt chấm này", en: "This punch already exists" });
    expect(out.rows[3]).toMatchObject({ vi: "Kỳ công 202610 đã khóa", en: "Attendance of period 202610 is locked" });
    expect(out.rows[7]).toMatchObject({ vi: 'Ngày giờ "2026-02-30 08:00:00" không hợp lệ' });
    expect(out.rows[8]).toMatchObject({ vi: "Trùng lượt chấm ở dòng 1", en: "Same punch as line 1" });
    expect(out.unmatched).toEqual([
      { machineId: "9", device: "ZK-01", lines: 1, firstTime: "2026-11-03 08:00" },
      { machineId: "55", device: "ZK-01", lines: 2, firstTime: "2026-11-02 08:00" },
    ]);
    expect(out.range).toEqual({ from: "2026-10-30", to: "2026-11-03" });
    expect(out.employees).toBe(3);
    expect(out.truncated).toBe(false);
    expect(mockDb.writes).toEqual([]);
    // id_kind M: không tra nhân viên theo mã; lượt chấm đã có đọc một lần trong khoảng ngày của các dòng đã nhận
    expect(mockDb.sql.filter((t) => t === "s4vp_pi_emp")).toEqual([]);
    expect(mockDb.existingRange).toEqual([["2026-10-30", "2026-11-03"]]);
  });

  test("id_kind B: bảng đối chiếu trước rồi mã nhân viên; header theo tên có dấu; một truy vấn nhân viên, mã đi bằng tham số", () => {
    const text = "Mã NV,Thời điểm,Máy\nNV001,03/11/2026 08:00,M1\nnv002,03/11/2026 08:05,\nX,03/11/2026 08:10,\n104,03/11/2026 08:15,\nZZ,03/11/2026 08:20,\n";
    const out = PI.punchPreview({ source: "2", text });
    expect(out.rows.map((r) => [r.machineId, r.employee, r.how, r.status, r.device])).toEqual([
      ["NV001", "101", "code", "new", "M1"],
      ["nv002", "102", "code", "new", ""],
      ["X", "104", "map", "new", ""],
      ["104", null, null, "unmatched", ""], // B không hiểu mã số thành id nội bộ
      ["ZZ", null, null, "unmatched", ""],
    ]);
    expect(out.header).toEqual(["Mã NV", "Thời điểm", "Máy"]);
    expect(mockDb.empParams).toEqual([["NV001", "NV002", "X", "104", "ZZ"]]);
  });

  test("id_kind N: mã nhân viên hoặc id nội bộ; layout P ca đêm", () => {
    mockDb.t.punch_source[2] = Object.assign(mockDb.t.punch_source[2], { has_header: false, col_emp: "1", col_date: "2", col_in: "3", col_out: "4" });
    const out = PI.punchPreview({ source: "3", text: "104;03/11/2026;22:00;06:00\nNV001;03/11/2026;08:00;\n" });
    expect(out.rows.map((r) => [r.employee, r.time, r.kind, r.status])).toEqual([
      ["104", "2026-11-03 22:00", "in", "new"],
      ["104", "2026-11-04 06:00", "out", "new"],
      ["101", "2026-11-03 08:00", "in", "new"],
    ]);
  });

  test("lỗi cấp file và đầu vào: không thấy cột, text trống, quá 5 MB", () => {
    expect(() => PI.punchPreview({ source: "2", text: "Ma,Gio\nA,1\n" })).toThrow(/Không thấy cột mã chấm công "Mã NV"/);
    expect(() => PI.punchPreview({ source: "2", text: "   " })).toThrow(/Chưa chọn file hoặc dán dữ liệu/);
    expect(() => PI.punchPreview({ source: "2" })).toThrow(/Chưa chọn file/);
    expect(() => PI.punchPreview({ source: "2", text: "x".repeat(5 * 1024 * 1024 + 1) })).toThrow(/5 MB/);
    expect(() => PI.punchPreview({ source: "2", text: "Ma\n" })).toThrow(/not on the header line/);
  });

  test("tối đa 1.000 dòng chi tiết, ưu tiên dòng lỗi / chưa đối chiếu; counts và unmatched đầy đủ", () => {
    const lines = [];
    for (let i = 0; i < 1200; i++) lines.push(`1\t2026-11-0${1 + (i % 9)} ${String(6 + Math.floor(i / 60) % 12).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`);
    lines.push("77\t2026-11-05 08:00:00", "1\tsai", "78\t2026-11-06 08:00:00");
    const out = PI.punchPreview({ source: "1", text: lines.join("\n") });
    expect(out.counts.total).toBe(1203);
    expect(out.rows).toHaveLength(1000);
    expect(out.truncated).toBe(true);
    expect(out.rows.filter((r) => r.status !== "new").map((r) => r.status)).toEqual(expect.arrayContaining(["unmatched", "invalid", "unmatched"]));
    expect(out.rows.map((r) => r.line)).toEqual([...out.rows.map((r) => r.line)].sort((a, b) => a - b));
    expect(out.unmatched.map((u) => u.machineId)).toEqual(["77", "78"]);
  });
});

describe("punchCommit", () => {
  test("ghi dòng mới với nguồn I, đếm bỏ qua / lỗi / chưa đối chiếu / kỳ khóa; chạy lại không ghi trùng", () => {
    const out = PI.punchCommit({ source: "1", text: ZK });
    noErrorKey(out);
    expect(out).toEqual({ created: 2, skipped: 2, invalid: 1, unmatched: 3, locked: 1, failed: 0, failures: [], cursor: 10 });
    expect(mockDb.writes.map((w) => w.values)).toEqual([
      { employee: "101", punch_date: "2026-11-03", punch_time: "2026-11-03 07:58", device: "ZK-01", source: "I" },
      { employee: "103", punch_date: "2026-11-03", punch_time: "2026-11-03 08:02", device: "ZK-01", source: "I" },
    ]);
    const again = PI.punchCommit({ source: "1", text: ZK });
    expect(again).toMatchObject({ created: 0, skipped: 4 });
  });

  test("chia lượt theo governance: more + cursor ở ranh giới dòng, cộng dồn các lượt = một lượt", () => {
    const lines = [];
    for (let i = 0; i < 30; i++) lines.push(`NV00${1 + (i % 3)},${String(1 + (i % 28)).padStart(2, "0")}/11/2026 ${String(6 + (i % 10)).padStart(2, "0")}:${String(i).padStart(2, "0")},`);
    const text = ["Mã NV,Thời điểm,Máy"].concat(lines, ["NV001,xx,", "ZZ,03/11/2026 09:00,"]).join("\n");
    mockDb.costPerCreate = 470; // sau ~10 lượt ghi thì governance còn dưới 300
    const total = { created: 0, skipped: 0, invalid: 0, unmatched: 0, locked: 0, failed: 0 };
    let cursor;
    let passes = 0;
    for (;;) {
      mockDb.usage = 5000;
      const r = PI.punchCommit({ source: "2", text, cursor });
      noErrorKey(r);
      passes++;
      for (const k of Object.keys(total)) total[k] += r[k];
      if (!r.more) break;
      expect(r.cursor).toBeGreaterThan(cursor || 0);
      cursor = r.cursor;
      expect(passes).toBeLessThan(10);
    }
    expect(passes).toBe(3);
    expect(total).toEqual({ created: 30, skipped: 0, invalid: 1, unmatched: 1, locked: 0, failed: 0 });
    expect(new Set(mockDb.t.punch.map((p) => `${p.employee}|${p.punch_time}`)).size).toBe(31);
  });

  test("layout P: hai lượt của một dòng luôn ghi trong cùng một lượt gọi", () => {
    Object.assign(mockDb.t.punch_source[2], { has_header: false, col_emp: "1", col_date: "2", col_in: "3", col_out: "4" });
    const text = ["NV001;03/11/2026;08:00;17:00", "NV002;03/11/2026;08:00;17:00", "NV003;03/11/2026;22:00;06:00"].join("\n");
    mockDb.costPerCreate = 2400; // sau 2 lượt ghi thì thấp
    const first = PI.punchCommit({ source: "3", text });
    expect(first).toMatchObject({ created: 2, more: true, cursor: 2 });
    mockDb.usage = 5000;
    const second = PI.punchCommit({ source: "3", text, cursor: first.cursor });
    expect(second).toMatchObject({ created: 2, more: true, cursor: 3 });
    mockDb.usage = 5000;
    const third = PI.punchCommit({ source: "3", text, cursor: second.cursor });
    expect(third).toMatchObject({ created: 2, cursor: 4 });
    expect(third.more).toBeUndefined();
  });

  test("lượt nào cũng xử lý ít nhất một dòng khi governance đã thấp", () => {
    mockDb.usage = 100;
    const r = PI.punchCommit({ source: "1", text: ZK });
    expect(r).toMatchObject({ created: 1, more: true, cursor: 2 });
  });

  test("dòng ghi lỗi không chặn dòng khác", () => {
    mockDb.failOn = (name, v) => v.employee === "101";
    const r = PI.punchCommit({ source: "1", text: ZK });
    noErrorKey(r);
    expect(r).toMatchObject({ created: 1, failed: 1 });
    expect(r.failures).toEqual([{ line: 1, vi: "Không ghi được lượt chấm: Record save failed", en: "The punch could not be saved: Record save failed" }]);
  });
});

describe("punchMapSave", () => {
  test("thêm mới, sửa theo id, sửa theo khóa trùng, thôi dùng chỉ dòng gửi lên; trả bảng đối chiếu mới", () => {
    const out = PI.punchMapSave({
      source: "1",
      rows: [
        { machineId: "55", device: "", employee: "104", effective: "2026-11-01" },
        { id: "11", machineId: "1", device: "", employee: "102" },
        { machineId: "2", device: "", employee: "104", effective: "01/11/2026", expiration: "2026-12-31" },
        { id: "12", inactive: true },
      ],
    });
    noErrorKey(out);
    expect(out.saved).toBe(4);
    expect(mockDb.writes).toEqual([
      { kind: "create", name: "punch_map", id: "5001", values: { source: "1", device: "", machine_id: "55", employee: "104", effective: "2026-11-01", expiration: null } },
      { kind: "submit", name: "punch_map", id: "11", values: { device: "", machine_id: "1", employee: "102", effective: null, expiration: null } },
      { kind: "submit", name: "punch_map", id: "13", values: { device: "", machine_id: "2", employee: "104", effective: "2026-11-01", expiration: "2026-12-31" } },
      { kind: "update", name: "punch_map", id: "12", values: { isInactive: true } },
    ]);
    // Dòng 14 (đã thôi dùng) và dòng của nguồn khác không bị đụng tới
    expect(out.rows.map((r) => [r.id, r.machineId, r.employee])).toEqual([["11", "1", "102"], ["13", "2", "104"], ["5001", "55", "104"]].sort((a, b) => Number(a[0]) - Number(b[0])));
  });

  test("dòng có id đang thôi dùng thì dùng lại", () => {
    PI.punchMapSave({ source: "1", rows: [{ id: "14", machineId: "9", employee: "104" }] });
    expect(mockDb.writes[0]).toMatchObject({ kind: "update", id: "14", values: { isInactive: false, machine_id: "9" } });
  });

  test("kiểm đầu vào trước khi ghi: không ghi gì khi một dòng sai", () => {
    const bad = (rows, re) => {
      expect(() => PI.punchMapSave({ source: "1", rows })).toThrow(re);
      expect(mockDb.writes).toEqual([]);
    };
    bad([], /Không có dòng đối chiếu/);
    bad([{ machineId: "5", employee: "101" }, { machineId: "", employee: "101" }], /Dòng 2: thiếu mã chấm công/);
    bad([{ machineId: "5", employee: "999" }], /chưa chọn nhân viên/);
    bad([{ machineId: "5", employee: "101", effective: "2026-02-30" }], /ngày hiệu lực 2026-02-30 không hợp lệ/);
    bad([{ machineId: "5", employee: "101", effective: "2026-11-10", expiration: "2026-11-01" }], /hết hiệu lực trước ngày hiệu lực/);
    bad([{ machineId: "5", employee: "101" }, { machineId: "005", employee: "102" }], /lặp lại \(dòng 1\)/);
    bad([{ id: "15", machineId: "5", employee: "101" }], /không thuộc nguồn này/);
    bad([{ id: "12", machineId: "1", employee: "101" }], /đã có dòng đối chiếu cùng ngày hiệu lực/);
    bad([{ machineId: "5", employee: "101", inactive: true }], /chỉ thôi dùng được dòng đối chiếu đã lưu/);
    bad(new Array(501).fill({ machineId: "5", employee: "101" }), /tối đa 500/);
  });
});
