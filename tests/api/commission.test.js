// api/Commission + route module api/CommissionV2 (docs/COMMISSION.md mục 4 - 6) với Store giả trong bộ nhớ, lõi
// CommissionEngine thật, Schema thật. Kiểm: tính tạo mới / tính lại cập nhật / vô hiệu dòng không còn / bỏ qua dòng không đổi /
// chia lượt more, đã trả kỳ trước và số dư ứng trước, trigger P, truy thu, nguồn ngoài, điều chỉnh, duyệt / mở lại / hủy, lưu
// kế hoạch (dòng bỏ đi -> isinactive), dạng phản hồi của các GET, nạp doanh số ngoài, không có khóa "error" ở mọi cấp.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const mockDb = {};
const db = mockDb;

jest.mock("N/runtime", () => ({
  getCurrentUser: () => ({ id: 5, roleId: "administrator" }),
  getCurrentScript: () => ({ getRemainingUsage: () => mockDb.usage() }),
}), { virtual: true });
jest.mock("N/query", () => ({}), { virtual: true });
jest.mock("N/record", () => ({}), { virtual: true });
jest.mock("N/format", () => ({}), { virtual: true });
jest.mock("N/cache", () => ({}), { virtual: true });

jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2026-03-20" }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({
  earningTypes: () => ({ list: [{ id: "1", code: "HOAHONG", description: "Hoa hồng", isActive: true }, { id: "2", code: "CU", description: "Cũ", isActive: false }] }),
}));

jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const Schema = jest.requireActual("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Schema");
  const blank = (v) => v === null || v === undefined || v === "";
  const rec = (name) => {
    if (!Schema.records[name]) throw new Error(`Unknown record ${name}`);
    return Schema.records[name];
  };
  const copy = (r) => JSON.parse(JSON.stringify(r));

  /** Điều kiện SQL của Store.find ({field} op ?, TO_DATE(?), IN, AND / OR / ngoặc) -> hàm JS. */
  function matcher(text, params) {
    const q = (params || []).slice();
    // Một lượt quét theo thứ tự xuất hiện để tham số ? được lấy đúng thứ tự
    let js = String(text || "1 = 1")
      .replace(/\{(\w+)\} (?:IN \(([^)]*)\)|(=|<>|<=|>=|<|>) (TO_DATE\(\?, 'YYYY-MM-DD'\)|\?|\d+))/g, (m, f, list, op, v) =>
        list !== undefined
          ? `I(r[${JSON.stringify(f)}], ${JSON.stringify(list.split(",").map((x) => (x.trim() === "?" ? String(q.shift()) : x.trim())))})`
          : `C(r[${JSON.stringify(f)}], ${JSON.stringify(op)}, ${JSON.stringify(/^\d+$/.test(v) ? v : q.shift())})`)
      .replace(/ AND /g, " && ").replace(/ OR /g, " || ").replace(/1 = 1/g, "true");
    const C = (a, op, b) => {
      if (blank(a) || blank(b)) return false;
      const num = /^-?\d+(\.\d+)?$/.test(String(a)) && /^-?\d+(\.\d+)?$/.test(String(b));
      const x = num ? Number(a) : String(a);
      const y = num ? Number(b) : String(b);
      return { "=": x === y, "<>": x !== y, "<": x < y, ">": x > y, "<=": x <= y, ">=": x >= y }[op];
    };
    const I = (a, list) => !blank(a) && list.includes(String(a));
    // eslint-disable-next-line no-new-func
    const fn = new Function("r", "C", "I", `return (${js});`);
    return (r) => fn(Object.assign({}, r, { id: r.id, name: r.name }), C, I);
  }

  function find(name, opt = {}) {
    rec(name);
    mockDb.calls.push(`find:${name}`);
    const keep = matcher(opt.where, opt.params);
    return (mockDb[name] || []).filter((r) => (opt.includeInactive || !r.isInactive) && keep(r)).sort((a, b) => Number(a.id) - Number(b.id)).map(copy);
  }
  function findIn(name, field, ids) {
    const list = [...new Set((ids || []).filter((x) => !blank(x)).map(String))];
    if (!list.length) return [];
    return find(name, { where: `{${field}} IN (${list.map(() => "?").join(",")})`, params: list });
  }
  function write(kind, name, id, values) {
    for (const k of Object.keys(values)) if (k !== "name" && k !== "isInactive" && !rec(name).fields[k]) throw new Error(`Unknown field ${name}.${k}`);
    mockDb.writes.push({ kind, name, id: id === null ? null : String(id), values: copy(values) });
  }
  function create(name, values) {
    const id = String(++mockDb.seq);
    write("create", name, null, values);
    (mockDb[name] = mockDb[name] || []).push(Object.assign({ id, isInactive: false }, copy(values)));
    return id;
  }
  function update(name, id, values, kind) {
    if (kind === "submit" && "isInactive" in values) throw new Error("submit cannot set isinactive");
    write(kind || "update", name, id, values);
    const row = (mockDb[name] || []).find((r) => String(r.id) === String(id));
    if (!row) throw new Error(`${name} ${id} not found`);
    Object.assign(row, copy(values));
    return String(id);
  }

  // Dòng SuiteQL giả của các truy vấn cố định
  const between = (d, a, b) => d >= a && d <= b;
  const raw = (sql, row, prefix, into) => {
    const out = into || { id: row.id };
    const re = new RegExp(` AS ${prefix}(\\w+)`, "g");
    let m;
    while ((m = re.exec(sql))) out[`${prefix}${m[1]}`] = row[m[1]] === undefined ? null : typeof row[m[1]] === "boolean" ? (row[m[1]] ? "T" : "F") : row[m[1]];
    return out;
  };
  const HANDLERS = {
    s4vp_cm_lines: (sql, p) => {
      // SuiteQL thật chỉ báo lỗi chung khi trường không tồn tại (đã thử trên td2937310)
      if (/custitem_khong_co/.test(sql)) throw new Error("An unexpected SuiteScript error has occurred");
      return HANDLERS.lines(sql, p);
    },
    lines: (sql, p) => mockDb.ns.lines.filter((l) => between(l.tdate, p[0], p[1]) && new RegExp(`tl\\.subsidiary = ${l.sub || 13} `).test(sql)),
    s4vp_cm_paid: (sql, p) => {
      const starts = [...sql.matchAll(/k\.nextdate >= TO_DATE\('(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1]);
      return mockDb.ns.paid.map((l) => {
        const o = Object.assign({}, l);
        starts.forEach((d, i) => (o[`paid_${i}`] = l.payments.filter((x) => x.date >= d && x.date <= p[1]).reduce((s, x) => s + x.amount, 0)));
        delete o.payments;
        return o;
      }).filter((o) => o.paid_0 > 0);
    },
    s4vp_cm_claw: (sql, p) => mockDb.ns.claws.filter((l) => between(l.tdate, p[1], p[2])),
    s4vp_cm_team: (sql) => {
      const ids = /IN \(([\d,]+)\)/.exec(sql)[1].split(",");
      return mockDb.ns.teams.filter((t) => ids.includes(String(t.tran_id)));
    },
    s4vp_cm_first: (sql) => {
      const ids = /f\.entity IN \(([\d,]+)\)/.exec(sql)[1].split(",");
      return Object.keys(mockDb.ns.first).filter((c) => ids.includes(c)).map((c) => ({ customer: Number(c), first_date: mockDb.ns.first[c] }));
    },
    s4vp_cm_emp_names: (sql) => {
      const ids = /e\.id IN \(([\d,]+)\)/.exec(sql)[1].split(",");
      return mockDb.emps.filter((e) => ids.includes(String(e.id))).map((e) => ({ id: Number(e.id), code: e.code, first: e.first, last: e.last, department: e.department || null }));
    },
    s4vp_cm_emp_lookup: (sql, p) => mockDb.emps.filter((e) => p.includes(String(e.code).toUpperCase()) || (e.email && p.includes(String(e.email).toLowerCase()))).map((e) => ({ id: Number(e.id), code: e.code, email: e.email || null })),
    s4vp_cm_view_rows: (sql) => {
      if (mockDb.failDepartment) throw new Error("department not readable");
      return HANDLERS.s4vp_cm_view_rows_df(sql);
    },
    s4vp_cm_view_rows_df: (sql) => {
      const run = /custrecord_s4vp_crs_run = (\d+)/.exec(sql)[1];
      return (mockDb.comm_result || []).filter((r) => !r.isInactive && String(r.run) === run).map((r) => {
        const o = raw(sql, r, "c_");
        const e = mockDb.emps.find((x) => String(x.id) === String(r.employee)) || {};
        const p = (mockDb.comm_plan || []).find((x) => String(x.id) === String(r.plan)) || {};
        return Object.assign(o, { e_code: e.code || null, e_first: e.first || null, e_last: e.last || null, e_dept: e.department || null, d_name: e.department ? `Phòng ${e.department}` : null, p_name: p.name || null, d_head: String(r.detail || "").slice(0, 40) });
      });
    },
    s4vp_cm_seg_class: (sql, p) => HANDLERS.seg("class", sql, p),
    s4vp_cm_seg_department: (sql, p) => HANDLERS.seg("department", sql, p),
    s4vp_cm_seg_location: (sql, p) => HANDLERS.seg("location", sql, p),
    seg: (kind, sql, p) => {
      const ids = (/x\.id IN \(([\d,]+)\)/.exec(sql) || ["", ""])[1].split(",");
      return mockDb.segs[kind].filter((x) => ids.includes(String(x.id)) || p.includes(x.name.toUpperCase()) || p.includes(x.fullname.toUpperCase()));
    },
    s4vp_cm_segments: () => [{ k: "C", id: 1, name: "Bán lẻ" }, { k: "D", id: 7, name: "Kinh doanh" }, { k: "L", id: 3, name: "HN" }, { k: "G", id: 2, name: "Đại lý" }],
    s4vp_cm_setup_emps: (sql) => {
      const ids = (/OR e\.id IN \(([\d,]+)\)/.exec(sql) || ["", ""])[1].split(",");
      return mockDb.emps.filter((e) => e.rep || ids.includes(String(e.id))).map((e) => ({ id: Number(e.id), code: e.code, first: e.first, last: e.last, department: e.department || null, rep: e.rep ? "T" : "F", inactive: "F" }));
    },
  };
  return {
    rec, find, findIn,
    get: (name, id) => find(name, { where: "{id} = ?", params: [id], includeInactive: true })[0] || null,
    create,
    update: (name, id, values) => update(name, id, values, "update"),
    submit: (name, id, values) => {
      update(name, id, values, "submit");
    },
    remove: () => {
      throw new Error("Commission must never delete");
    },
    run: (sql, params, tag) => {
      mockDb.calls.push(tag);
      mockDb.sql.push({ sql: String(sql), params, tag });
      if (/SELECT \*/i.test(sql)) throw new Error(`SELECT * in ${tag}`);
      if (!HANDLERS[tag]) throw new Error(`unexpected query ${tag}`);
      return HANDLERS[tag](String(sql), params || []);
    },
    codeOf: (list, v) => (blank(v) ? null : v),
    idOf: (list, v) => v,
    memoize: () => undefined,
    stats: [],
  };
});

const Commission = require(path.join(API, "Commission"));
const V2 = require(path.join(API, "CommissionV2"));

const M = 1000000;
let lineSeq = 0;
/** Dòng SuiteQL giả của s4vp_cm_lines (đã đổi dấu như câu lệnh thật). */
const nsLine = (o) => Object.assign({ tran_id: 900 + ++lineSeq, tran_no: `INV${lineSeq}`, ttype: "CustInvc", tdate: "2026-03-10", customer: 501, cust_code: "KH01", cust_name: "Công ty A", cust_cat: null, project: null, sales_rep: 101, ftotal: 0, line_id: 1, item: 77, item_code: "SP01", item_type: "InvtPart", class_id: 1, department: 7, location: 3, revenue: 0, cost: 0, qty: 1 }, o);

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    seq: 1000, calls: [], sql: [], writes: [], usage: () => 10000, failDepartment: false,
    ns: { lines: [], paid: [], claws: [], teams: [], first: { 501: "2025-06-01", 502: "2026-03-01" } },
    segs: {
      class: [{ id: 1, name: "Bán lẻ", fullname: "Bán lẻ" }],
      department: [{ id: 7, name: "Kinh doanh", fullname: "Khối KD : Kinh doanh" }, { id: 8, name: "Kho", fullname: "Miền Bắc : Kho" }, { id: 9, name: "Kho", fullname: "Miền Nam : Kho" }],
      location: [{ id: 3, name: "HN", fullname: "Hà Nội" }],
    },
    emps: [
      { id: "101", code: "NV101", first: "An", last: "Nguyễn", department: "7", rep: true, email: "an@example.com" },
      { id: "102", code: "NV102", first: "Bình", last: "Trần", department: "7", rep: true, email: "binh@example.com" },
      { id: "103", code: "NV103", first: "Cường", last: "Lê", department: "8", rep: false },
      { id: "104", code: "NV104", first: "Dung", last: "Phạm", department: "8", rep: false },
      { id: "105", code: "NV104", first: "Trùng", last: "Mã", department: "8", rep: false },
    ],
    comm_plan: [{ id: "1", name: "KH-DS", isInactive: false, subsidiary: "13", basis: "R", trigger: "I", credit_source: "R", credit_field: "", window: "M", include_returns: true, clawback_days: 0, exclude_item_types: null, earning_type: "HOAHONG", min_attainment: null, cap_amount: null, draw_type: "N", draw_amount: null, override_pct: null, override_basis: null, source: "N", effective: "2026-01-01", expiration: null }],
    comm_rule: [{ id: "11", name: "Doanh số", isInactive: false, plan: "1", sequence: 10, method: "P", rate: 2, f_items: "", f_new_customer: false, new_days: null }],
    comm_tier: [],
    comm_assign: [
      { id: "21", isInactive: false, plan: "1", employee: "101", effective: "2026-01-01", expiration: null, quota: 100 * M, manager: null },
      { id: "22", isInactive: false, plan: "1", employee: "102", effective: "2026-01-01", expiration: null, quota: 50 * M, manager: null },
    ],
    comm_quota: [], comm_run: [], comm_result: [], comm_adjust: [], comm_txn: [],
  });
  db.ns.lines = [
    nsLine({ tran_id: 1, tran_no: "INV1", revenue: 60 * M, ftotal: 66 * M }),
    nsLine({ tran_id: 1, tran_no: "INV1", line_id: 2, revenue: 40 * M, ftotal: 66 * M }),
    nsLine({ tran_id: 1, tran_no: "INV1", line_id: 3, item_type: "TaxItem", revenue: 10 * M }),
    nsLine({ tran_id: 2, tran_no: "CM1", ttype: "CustCred", revenue: -10 * M }),
    nsLine({ tran_id: 3, tran_no: "INV3", sales_rep: 102, customer: 502, revenue: 20 * M }),
  ];
}

beforeEach(reset);

const results = (runId) => db.comm_result.filter((r) => String(r.run) === String(runId));
const active = (runId) => results(runId).filter((r) => !r.isInactive);
const resultOf = (runId, emp, plan = "1") => active(runId).find((r) => r.employee === emp && r.plan === plan);
const calc = (month = 202603) => Commission.calculate("13", month);

/** Mọi khóa của object ở mọi cấp. */
function keysDeep(x, out = []) {
  if (Array.isArray(x)) x.forEach((v) => keysDeep(v, out));
  else if (x && typeof x === "object") for (const k of Object.keys(x)) out.push(k), keysDeep(x[k], out);
  return out;
}

describe("calculate", () => {
  test("tạo bảng tính nháp và kết quả theo nhân viên + kế hoạch; credit memo trừ, dòng thuế bỏ", () => {
    const out = calc();
    expect(out).toMatchObject({ status: "D", month: 202603, from: "2026-03-01", to: "2026-03-31", employees: 2, created: 2, updated: 0, inactivated: 0 });
    expect(out.more).toBeUndefined();
    const run = db.comm_run.find((r) => r.id === out.run);
    expect(run).toMatchObject({ name: "HH202603-13", subsidiary: "13", month: 202603, status: "D", date_from: "2026-03-01", date_to: "2026-03-31", employees: 2 });
    expect(run.calc_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const a = resultOf(out.run, "101");
    expect(a).toMatchObject({ base: 90 * M, earned: 1.8 * M, payable: 1.8 * M, earning_type: "HOAHONG", attainment: 90 });
    expect(resultOf(out.run, "102")).toMatchObject({ base: 20 * M, payable: 400000 });
    expect(run.total_amount).toBe(2.2 * M);
    const detail = JSON.parse(a.detail);
    expect(a.detail.startsWith('{"warningCount":')).toBe(true);
    expect(detail.credits.map((c) => c.tranNo).sort()).toEqual(["CM1", "INV1", "INV1"]);
    expect(detail.credits[0]).toMatchObject({ source: "NetSuite", kind: "N", customerName: "KH01 Công ty A", itemName: "SP01" });
    expect(detail.steps.length).toBeGreaterThan(0);
    expect(detail.shares.reduce((s, x) => s + x.amount, 0)).toBe(1.8 * M);
    // Truy vấn cố định: id công ty con ghép thẳng, ngày là tham số
    const lines = db.sql.find((q) => q.tag === "s4vp_cm_lines");
    expect(lines.sql).toMatch(/tl\.subsidiary = 13 AND t\.trandate >= TO_DATE\(\?, 'YYYY-MM-DD'\)/);
    expect(lines.params).toEqual(["2026-03-01", "2026-03-31"]);
    expect(db.calls).not.toContain("s4vp_cm_paid");
    expect(db.calls).not.toContain("s4vp_cm_claw");
  });

  test("tính lại: cập nhật đúng dòng theo khóa, bỏ qua dòng không đổi, không tạo trùng", () => {
    const first = calc();
    const id101 = resultOf(first.run, "101").id;
    db.ns.lines[0].revenue = 80 * M;
    db.writes = [];
    const again = calc();
    expect(again.run).toBe(first.run);
    expect(again).toMatchObject({ created: 0, updated: 1, unchanged: 1, inactivated: 0 });
    expect(resultOf(first.run, "101")).toMatchObject({ id: id101, base: 110 * M, payable: 2.2 * M });
    expect(results(first.run)).toHaveLength(2);
    // Chỉ ghi trường đổi bằng submit (không tải record)
    const w = db.writes.find((x) => x.name === "comm_result");
    expect(w.kind).toBe("submit");
    expect(Object.keys(w.values)).toEqual(expect.arrayContaining(["base", "payable", "detail"]));
    expect(Object.keys(w.values)).not.toContain("employee");
    db.writes = [];
    expect(calc()).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(db.writes.filter((x) => x.name === "comm_result")).toHaveLength(0);
  });

  test("dòng không còn sinh ra -> isinactive (không xóa); sinh lại thì kích hoạt lại cùng dòng", () => {
    const first = calc();
    const id102 = resultOf(first.run, "102").id;
    db.comm_assign = db.comm_assign.filter((a) => a.employee !== "102");
    const out = calc();
    expect(out).toMatchObject({ inactivated: 1, employees: 1 });
    expect(db.comm_result.find((r) => r.id === id102).isInactive).toBe(true);
    expect(db.comm_run.find((r) => r.id === first.run).employees).toBe(1);
    db.comm_assign.push({ id: "23", isInactive: false, plan: "1", employee: "102", effective: "2026-01-01", quota: 50 * M });
    expect(calc()).toMatchObject({ created: 0, updated: 1 });
    expect(db.comm_result.find((r) => r.id === id102).isInactive).toBe(false);
  });

  test("hết governance: trả more = true, bảng chưa tính xong không duyệt được; gọi lại thì hoàn tất", () => {
    let left = 1;
    db.usage = () => (left-- > 0 ? 10000 : 100);
    const out = calc();
    expect(out.more).toBe(true);
    expect(out.created).toBe(1);
    expect(db.comm_run[0].calc_at).toBe("");
    expect(() => Commission.approve(out.run)).toThrow(/chưa tính xong/);
    db.usage = () => 10000;
    const done = calc();
    expect(done.more).toBeUndefined();
    expect(done).toMatchObject({ created: 1, unchanged: 1 });
    expect(active(out.run)).toHaveLength(2);
  });

  test("bảng tính đã duyệt / đã vào lương thì không tính lại", () => {
    const out = calc();
    Commission.approve(out.run);
    expect(() => calc()).toThrow(/mở lại/);
    db.comm_run[0].status = "P";
    expect(() => calc()).toThrow(/đã vào bảng lương/);
  });

  test("tháng, công ty con không hợp lệ", () => {
    expect(() => Commission.calculate("", 202603)).toThrow(/công ty con/);
    expect(() => Commission.calculate("13", "2026-13")).toThrow(/YYYYMM/);
    expect(() => Commission.calculate("13", 202603, "2026-03-20", "2026-03-01")).toThrow(/Từ ngày sau đến ngày/);
  });
});

describe("đã trả kỳ trước, số dư ứng trước, điều chỉnh", () => {
  test("cửa sổ quý: prior_paid = tổng earned của bảng đã duyệt / đã vào lương trong quý; draw_balance từ kết quả gần nhất", () => {
    Object.assign(db.comm_plan[0], { window: "Q", draw_type: "R", draw_amount: 3 * M });
    db.comm_run.push(
      { id: "301", name: "HH202601-13", isInactive: false, subsidiary: "13", month: 202601, status: "P", date_from: "2026-01-01", date_to: "2026-01-31" },
      { id: "302", name: "HH202602-13", isInactive: false, subsidiary: "13", month: 202602, status: "A", date_from: "2026-02-01", date_to: "2026-02-28" },
      { id: "303", name: "HH202602-13", isInactive: true, subsidiary: "13", month: 202602, status: "A", date_from: "2026-02-01", date_to: "2026-02-28" },
      { id: "304", name: "HH202512-13", isInactive: false, subsidiary: "13", month: 202512, status: "P", date_from: "2025-12-01", date_to: "2025-12-31" },
      { id: "305", name: "HH202602-14", isInactive: false, subsidiary: "14", month: 202602, status: "A", date_from: "2026-02-01", date_to: "2026-02-28" },
    );
    db.comm_result.push(
      { id: "401", isInactive: false, run: "301", employee: "101", plan: "1", earned: 500000, draw_balance: 900000 },
      { id: "402", isInactive: false, run: "302", employee: "101", plan: "1", earned: 300000, draw_balance: 700000 },
      { id: "403", isInactive: false, run: "303", employee: "101", plan: "1", earned: 9 * M, draw_balance: 9 * M },
      { id: "404", isInactive: false, run: "304", employee: "101", plan: "1", earned: 7 * M, draw_balance: 1 },
      { id: "405", isInactive: false, run: "305", employee: "101", plan: "1", earned: 8 * M, draw_balance: 8 * M },
      { id: "406", isInactive: false, run: "302", employee: "101", plan: "99", earned: 6 * M, draw_balance: 6 * M },
    );
    // Dòng tháng 1 của quý vào cửa sổ (cơ sở cửa sổ), không vào cơ sở kỳ
    db.ns.lines.push(nsLine({ tran_id: 8, tdate: "2026-01-15", revenue: 50 * M }));
    const out = calc();
    const r = resultOf(out.run, "101");
    expect(r).toMatchObject({ base: 90 * M, window_base: 140 * M, gross: 2.8 * M, prior_paid: 800000, earned: 2 * M });
    // Draw R 3.000.000: trả bù 1.000.000, số dư 700.000 (Feb mới nhất) + 1.000.000
    expect(r).toMatchObject({ draw_paid: 1 * M, payable: 3 * M, draw_balance: 1.7 * M });
    // Đọc dòng từ đầu quý
    expect(db.sql.find((q) => q.tag === "s4vp_cm_lines").params).toEqual(["2026-01-01", "2026-03-31"]);
  });

  test("điều chỉnh tay của tháng vào kế hoạch (khai hoặc kế hoạch đầu tiên của nhân viên); lý do bắt buộc", () => {
    expect(() => Commission.adjust({ employee: "101", month: 202603, amount: 100000, reason: " " })).toThrow(/lý do/);
    expect(() => Commission.adjust({ employee: "101", month: 202603, amount: 0, reason: "x" })).toThrow(/khác 0/);
    const a = Commission.adjust({ employee: "101", plan: "1", month: "2026-03", amount: 150000, reason: "Bù đơn tháng trước" });
    expect(a).toMatchObject({ employee: "101", plan: "1", month: 202603, amount: 150000 });
    Commission.adjust({ employee: "102", month: 202603, amount: -50000, reason: "Trừ sai sót" });
    Commission.adjust({ employee: "104", month: 202603, amount: 70000, reason: "Không có kế hoạch" });
    const out = calc();
    expect(resultOf(out.run, "101")).toMatchObject({ adjustments: 150000, payable: 1.95 * M });
    expect(resultOf(out.run, "102")).toMatchObject({ adjustments: -50000, payable: 350000 });
    expect(out.warnings.some((w) => w.code === "ADJ_NO_PLAN")).toBe(true);
    Commission.approve(out.run);
    expect(() => Commission.adjust({ employee: "101", plan: "1", month: 202603, amount: 1, reason: "x" })).toThrow(/mở lại/);
  });
});

describe("nguồn giao dịch", () => {
  test("trigger P: hóa đơn x tỷ lệ thu trong kỳ, cash sale / credit memo theo ngày", () => {
    db.comm_plan[0].trigger = "P";
    db.ns.lines.push(nsLine({ tran_id: 4, tran_no: "CS1", ttype: "CashSale", revenue: 5 * M }));
    db.ns.paid = [
      Object.assign(nsLine({ tran_id: 50, tran_no: "INV50", tdate: "2026-02-10", revenue: 30 * M, ftotal: 33 * M }), { payments: [{ date: "2026-03-05", amount: 16.5 * M }] }),
      Object.assign(nsLine({ tran_id: 51, tran_no: "INV51", tdate: "2026-01-10", revenue: 10 * M, ftotal: 11 * M }), { payments: [{ date: "2026-02-05", amount: 11 * M }] }),
    ];
    const out = calc();
    // INV1 (hóa đơn tháng 3 chưa thu) không tính; CM1 -10, CS1 +5, INV50 30 x 50% = 15
    expect(resultOf(out.run, "101")).toMatchObject({ base: 10 * M });
    const paid = db.sql.find((q) => q.tag === "s4vp_cm_paid");
    expect(paid.sql).toMatch(/k\.nexttype IN \('CustPymt','DepAppl'\)/);
    expect(paid.params).toEqual(["2026-03-01", "2026-03-31"]);
    const credits = JSON.parse(resultOf(out.run, "101").detail).credits;
    expect(credits.find((c) => c.tranNo === "INV50")).toMatchObject({ kind: "P", factor: 0.5, base: 15 * M });
  });

  test("truy thu: phần chưa thu của hóa đơn đến hạn trong kỳ trừ vào cơ sở", () => {
    db.comm_plan[0].clawback_days = 30;
    db.ns.claws = [Object.assign(nsLine({ tran_id: 60, tran_no: "INV60", tdate: "2026-02-05", revenue: 10 * M, ftotal: 10 * M }), { paid: 4 * M })];
    const out = calc();
    expect(resultOf(out.run, "101")).toMatchObject({ base: 84 * M });
    const claw = db.sql.find((q) => q.tag === "s4vp_cm_claw");
    // Hóa đơn có ngày + 30 trong kỳ: ngày chứng từ 30/01 - 01/03, tình trạng thu tính đến cuối kỳ
    expect(claw.params).toEqual(["2026-03-31", "2026-01-30", "2026-03-01"]);
    const k = JSON.parse(resultOf(out.run, "101").detail).credits.find((c) => c.kind === "K");
    expect(k).toMatchObject({ tranNo: "INV60", creditDate: "2026-03-07", base: -6 * M });
  });

  test("đội bán (contribution 1 = 100%) và trường tùy chỉnh (nguồn F)", () => {
    db.comm_plan[0].credit_source = "T";
    db.ns.teams = [{ tran_id: 1, employee: 101, pct: 0.6 }, { tran_id: 1, employee: 102, pct: 0.4 }];
    let out = calc();
    expect(resultOf(out.run, "101").base).toBe(60 * M - 10 * M); // 60% x 100 + CM1 (salesrep, không có đội)
    expect(resultOf(out.run, "102").base).toBe(40 * M + 20 * M);
    reset();
    Object.assign(db.comm_plan[0], { credit_source: "F", credit_field: "custbody_s4_seller" });
    for (const l of db.ns.lines) l.cf_0 = 102;
    out = calc();
    expect(db.sql.find((q) => q.tag === "s4vp_cm_lines").sql).toMatch(/t\.custbody_s4_seller AS cf_0/);
    expect(resultOf(out.run, "102").base).toBe(110 * M);
    expect(resultOf(out.run, "101").base).toBe(0);
    reset();
    Object.assign(db.comm_plan[0], { credit_source: "F", credit_field: "custbody_x; DROP" });
    expect(() => calc()).toThrow(/custbody/);
    expect(db.calls).not.toContain("s4vp_cm_lines");
  });

  test("nguồn ngoài X: chỉ đọc comm_txn, ghi nguồn của credit; B: cả hai", () => {
    db.comm_plan[0].source = "X";
    db.comm_txn = [
      { id: "71", isInactive: false, subsidiary: "13", source_system: "DMS", doc_no: "D1", line_no: 1, tran_type: "I", date: "2026-03-12", customer_code: "K9", customer_name: "Khách DMS", item_code: "X1", revenue: 25 * M, cost: 0, qty: 5, employee: "101", team: "" },
      { id: "72", isInactive: false, subsidiary: "13", source_system: "DMS", doc_no: "D2", line_no: 1, tran_type: "I", date: "2026-02-12", revenue: 99 * M, employee: "101" },
      { id: "73", isInactive: false, subsidiary: "14", source_system: "DMS", doc_no: "D3", line_no: 1, tran_type: "I", date: "2026-03-12", revenue: 99 * M, employee: "101" },
    ];
    let out = calc();
    expect(db.calls).not.toContain("s4vp_cm_lines");
    const r = resultOf(out.run, "101");
    expect(r.base).toBe(25 * M);
    expect(JSON.parse(r.detail).credits[0]).toMatchObject({ source: "DMS", tranNo: "D1", customerName: "K9 Khách DMS" });
    db.comm_plan[0].source = "B";
    out = calc();
    expect(resultOf(out.run, "101").base).toBe(115 * M);
  });
});

describe("bộ lọc loại mặt hàng, mã hàng, nhóm hàng, phạm vi khách", () => {
  test("truy vấn dòng có mã hàng; trường nhóm hàng qua BUILTIN.DF (ig_<i>); thành phần lọc loại / mã / nhóm", () => {
    db.comm_plan[0].item_group_field = "custitem_s4_nhom";
    db.ns.lines = [
      nsLine({ tran_id: 1, line_id: 1, item_type: "InvtPart", item_code: "SP-01", ig_0: "Điện máy", revenue: 60 * M }),
      nsLine({ tran_id: 1, line_id: 2, item_type: "Service", item_code: "DV-01", ig_0: "Dịch vụ", revenue: 40 * M }),
    ];
    db.comm_rule = [
      { id: "11", name: "Hàng tồn kho", isInactive: false, plan: "1", sequence: 10, method: "P", rate: 2, f_item_types: "InvtPart" },
      { id: "12", name: "Mã DV", isInactive: false, plan: "1", sequence: 20, method: "P", rate: 1, f_item_codes: "dv-01" },
      { id: "13", name: "Nhóm điện máy", isInactive: false, plan: "1", sequence: 30, method: "P", rate: 1, f_item_groups: "ĐIỆN MÁY" },
    ];
    const out = calc();
    const lines = db.sql.find((q) => q.tag === "s4vp_cm_lines");
    expect(lines.sql).toMatch(/i\.itemid AS item_code/);
    expect(lines.sql).toMatch(/BUILTIN\.DF\(i\.custitem_s4_nhom\) AS ig_0/);
    expect(lines.sql).toMatch(/LEFT JOIN item i ON i\.id = tl\.item/);
    const r = resultOf(out.run, "101");
    const detail = JSON.parse(r.detail);
    expect(detail.components.map((c) => [c.name, c.base, c.amount])).toEqual([["Hàng tồn kho", 60 * M, 1.2 * M], ["Mã DV", 40 * M, 400000], ["Nhóm điện máy", 60 * M, 600000]]);
    expect(detail.credits.find((c) => c.itemName === "SP-01")).toMatchObject({ itemType: "InvtPart", itemGroup: "Điện máy" });
    // Không khai trường nhóm hàng: không có cột ig, lọc nhóm không khớp dòng NetSuite
    reset();
    db.comm_rule[0].f_item_groups = "Điện máy";
    const out2 = calc();
    expect(db.sql.find((q) => q.tag === "s4vp_cm_lines").sql).not.toMatch(/BUILTIN\.DF|ig_0/);
    expect(resultOf(out2.run, "101").base).toBe(90 * M);
    expect(JSON.parse(resultOf(out2.run, "101").detail).components[0].base).toBe(0);
  });

  test("trường nhóm hàng không tồn tại: lỗi SuiteQL chung đổi thành thông báo song ngữ nêu tên trường; id sai thì không truy vấn", () => {
    db.comm_plan[0].item_group_field = "custitem_khong_co";
    expect(() => calc()).toThrow(/Không đọc được trường nhóm hàng custitem_khong_co trên mặt hàng/);
    let err = null;
    try {
      calc();
    } catch (e) {
      err = e;
    }
    expect(err.userMessage.en).toMatch(/item group field\(s\) custitem_khong_co on items/);
    // Có cả trường ghi nhận (nguồn F): thông báo nêu cả hai
    Object.assign(db.comm_plan[0], { credit_source: "F", credit_field: "custbody_s4_seller" });
    expect(() => calc()).toThrow(/custbody_s4_seller.*custitem_khong_co/);
    reset();
    db.comm_plan[0].item_group_field = "custitem_x) OR (1=1";
    db.calls = [];
    expect(() => calc()).toThrow(/custitem/);
    expect(db.calls).not.toContain("s4vp_cm_lines");
  });

  test("dòng ngoài: lọc theo mã hàng (f_items id nội bộ không khớp), nhóm hàng, loại mặt hàng, customer_type", () => {
    db.comm_plan[0].source = "X";
    db.comm_txn = [
      { id: "71", isInactive: false, subsidiary: "13", source_system: "DMS", doc_no: "D1", line_no: 1, tran_type: "I", date: "2026-03-12", item_code: "77", item_type: "InvtPart", item_group: "Điện máy", customer_type: "N", revenue: 25 * M, employee: "101" },
      { id: "72", isInactive: false, subsidiary: "13", source_system: "DMS", doc_no: "D2", line_no: 1, tran_type: "I", date: "2026-03-13", item_code: "SP-02", item_type: "Service", item_group: "", customer_type: "E", first_sale_date: "2026-03-13", revenue: 15 * M, employee: "101" },
    ];
    const base = (rule) => {
      db.comm_rule = [Object.assign({ id: "11", name: "TP", isInactive: false, plan: "1", sequence: 10, method: "P", rate: 1 }, rule)];
      const out = calc();
      return JSON.parse(resultOf(out.run, "101").detail).components[0].base;
    };
    expect(base({ f_items: "77" })).toBe(0);
    expect(base({ f_item_codes: "sp-02,77" })).toBe(40 * M);
    expect(base({ f_item_groups: "điện máy" })).toBe(25 * M);
    expect(base({ f_item_types: "Service" })).toBe(15 * M);
    expect(base({ f_customer_scope: "N" })).toBe(25 * M);
    // customer_type E thắng ngày mua đầu tiên (cùng ngày chứng từ)
    expect(base({ f_customer_scope: "E" })).toBe(15 * M);
  });

  test("phạm vi khách NetSuite: khách mới / cũ theo ngày mua đầu tiên; f_new_customer cũ vẫn chạy", () => {
    // Khách 501 mua đầu 2025-06-01 (cũ), 502 mua đầu 2026-03-01 (mới, INV3 ngày 10/03)
    const comp = (rule) => {
      Object.assign(db.comm_rule[0], { f_customer_scope: null, f_new_customer: false }, rule);
      const out = calc();
      return [resultOf(out.run, "101"), resultOf(out.run, "102")].map((r) => JSON.parse(r.detail).components[0].base);
    };
    expect(comp({ f_customer_scope: "N" })).toEqual([0, 20 * M]);
    expect(comp({ f_customer_scope: "E" })).toEqual([90 * M, 0]);
    expect(comp({ f_new_customer: true })).toEqual([0, 20 * M]);
    expect(comp({ f_customer_scope: "A", f_new_customer: true })).toEqual([90 * M, 20 * M]);
  });
});

describe("duyệt, mở lại, hủy", () => {
  test("D -> A ghi người duyệt; A -> D; cấm khi P; hủy cần lý do, isinactive, không xóa", () => {
    const out = calc();
    expect(Commission.approve(out.run)).toMatchObject({ status: "A", approvedBy: "5" });
    expect(db.comm_run[0]).toMatchObject({ status: "A", approved_by: "5" });
    expect(() => Commission.approve(out.run)).toThrow(/nháp/);
    expect(Commission.reopen(out.run)).toMatchObject({ status: "D" });
    expect(db.comm_run[0].approved_by).toBeNull();
    expect(() => Commission.reopen(out.run)).toThrow(/đã duyệt/);
    db.comm_run[0].status = "P";
    expect(() => Commission.reopen(out.run)).toThrow(/đảo bảng lương/);
    expect(() => Commission.voidRun(out.run, "x")).toThrow(/đảo bảng lương/);
    db.comm_run[0].status = "A";
    expect(() => Commission.voidRun(out.run, "  ")).toThrow(/lý do/);
    expect(Commission.voidRun(out.run, "Tính nhầm kỳ")).toMatchObject({ voided: true, reason: "Tính nhầm kỳ" });
    expect(db.comm_run[0].isInactive).toBe(true);
    expect(db.comm_run[0].note).toMatch(/Void: Tính nhầm kỳ/);
    expect(() => Commission.approve(out.run)).toThrow(/đã bị hủy/);
    // Tháng đã hủy tính lại thành bảng mới
    const again = calc();
    expect(again.run).not.toBe(out.run);
    expect(db.writes.some((w) => w.kind === "delete")).toBe(false);
  });
});

describe("planSave", () => {
  const body = () => ({
    plan: { name: "KH-MOI", subsidiary: "13", basis: "R", trigger: "I", credit_source: "R", window: "Q", earning_type: "hoahong", min_attainment: "80", include_returns: true },
    rules: [
      { key: "a", name: "Doanh số", method: "P", rate: 2, f_items: "1, 2" },
      { key: "b", name: "Tăng tốc", method: "A", tiers: [{ from_value: 100, rate: 1 }, { from_value: 120, rate: 2 }] },
    ],
    tiers: [],
    assignments: [{ employee: "101", effective: "2026-01-01", quota: 100 * M, manager: "103" }, { employee: "102", quota: 50 * M }],
    quotas: [{ employee: "101", month: "2026-03", quota: 120 * M }],
  });

  test("tạo mới cùng dòng con; lưu lại bỏ dòng -> isinactive; bậc thang theo ruleKey", () => {
    const out = Commission.planSave(body());
    expect(out.name).toBe("KH-MOI");
    expect(out.counts).toMatchObject({ rules: 2, tiers: 2, assignments: 2, quotas: 1, inactivated: 0 });
    const plan = db.comm_plan.find((p) => p.id === out.id);
    expect(plan).toMatchObject({ earning_type: "HOAHONG", min_attainment: 80, window: "Q" });
    const [ra, rb] = out.rules;
    expect(db.comm_rule.find((r) => r.id === ra.id)).toMatchObject({ plan: out.id, f_items: "1,2", sequence: 10 });
    expect(db.comm_tier.filter((t) => t.rule === rb.id)).toHaveLength(2);
    expect(db.comm_quota[0]).toMatchObject({ month: 202603, quota: 120 * M });

    const b2 = body();
    b2.plan.id = out.id;
    b2.rules = [{ id: ra.id, name: "Doanh số", method: "P", rate: 3 }];
    b2.tiers = [{ ruleKey: "zzz", from_value: 1 }];
    expect(() => Commission.planSave(b2)).toThrow(/thành phần không hợp lệ/);
    b2.tiers = [{ rule: rb.id, from_value: 0, rate: 1 }];
    expect(() => Commission.planSave(b2)).toThrow(/thành phần không hợp lệ/); // rb sẽ bị bỏ trong lượt này
    b2.tiers = [];
    const asgIds = db.comm_assign.filter((a) => a.plan === out.id).map((a) => a.id);
    b2.assignments = [{ id: asgIds[0], employee: "101", quota: 90 * M }];
    delete b2.quotas; // không truyền: giữ nguyên
    const out2 = Commission.planSave(b2);
    expect(out2.counts.inactivated).toBe(2);
    expect(db.comm_rule.find((r) => r.id === rb.id).isInactive).toBe(true);
    expect(db.comm_rule.find((r) => r.id === ra.id)).toMatchObject({ rate: 3, isInactive: false });
    expect(db.comm_assign.find((a) => a.id === asgIds[1]).isInactive).toBe(true);
    expect(db.comm_assign.find((a) => a.id === asgIds[0]).quota).toBe(90 * M);
    expect(db.comm_quota.filter((q) => !q.isInactive)).toHaveLength(1);
    expect(db.writes.some((w) => w.kind === "delete")).toBe(false);
  });

  test("kiểm dữ liệu: mã trùng, loại thu nhập, trường ghi nhận, danh sách id, chỉ tiêu trùng, id con lạ", () => {
    const b = body();
    b.plan.name = "KH-DS";
    expect(() => Commission.planSave(b)).toThrow(/đã có/);
    const c = body();
    c.plan.earning_type = "";
    expect(() => Commission.planSave(c)).toThrow(/loại thu nhập/);
    const d = body();
    Object.assign(d.plan, { credit_source: "F", credit_field: "custbody_a' OR 1=1" });
    expect(() => Commission.planSave(d)).toThrow(/custbody/);
    const e = body();
    e.rules[0].f_items = "1;2";
    expect(() => Commission.planSave(e)).toThrow(/id nội bộ/);
    const f = body();
    f.quotas.push({ employee: "101", month: 202603, quota: 1 });
    expect(() => Commission.planSave(f)).toThrow(/Trùng chỉ tiêu/);
    const g = body();
    g.plan.id = "1";
    g.plan.name = "KH-DS";
    g.assignments = [{ id: "999", employee: "101" }];
    expect(() => Commission.planSave(g)).toThrow(/không thuộc kế hoạch/);
    const h = body();
    h.plan.basis = "Z";
    expect(() => Commission.planSave(h)).toThrow(/không hợp lệ/);
  });

  test("bộ lọc loại mặt hàng / mã hàng / nhóm hàng, trường nhóm hàng, phạm vi khách: chuẩn hóa và kiểm", () => {
    const b = body();
    b.plan.item_group_field = " CustItem_S4_Nhom ";
    Object.assign(b.rules[0], { f_item_types: "invtpart, Service ,INVTPART", f_item_codes: "SP-01, sp-01; DV-02\nKM", f_item_groups: ["Điện máy", " điện máy ", "Gia dụng"], f_customer_scope: "e", new_days: 60 });
    const out = Commission.planSave(b);
    expect(db.comm_plan.find((p) => p.id === out.id).item_group_field).toBe("custitem_s4_nhom");
    const saved = db.comm_rule.find((r) => r.id === out.rules[0].id);
    expect(saved).toMatchObject({ f_item_types: "InvtPart,Service", f_item_codes: "SP-01,DV-02,KM", f_item_groups: "Điện máy,Gia dụng", f_customer_scope: "E", f_new_customer: false, new_days: 60 });
    // f_new_customer cũ (không gửi phạm vi) vẫn lưu được; gửi phạm vi trống thì suy ra từ f_new_customer
    const legacy = body();
    legacy.plan.name = "KH-CU";
    Object.assign(legacy.rules[0], { f_new_customer: true, f_customer_scope: "" });
    const out2 = Commission.planSave(legacy);
    expect(db.comm_rule.find((r) => r.id === out2.rules[0].id)).toMatchObject({ f_customer_scope: "N", f_new_customer: true });

    const bad = (mut) => {
      const x = body();
      x.plan.name = `KH-${Math.random()}`;
      mut(x);
      return () => Commission.planSave(x);
    };
    expect(bad((x) => (x.rules[0].f_item_types = "InvtPart,Hàng hóa"))).toThrow(/loại mặt hàng không hợp lệ Hàng hóa/);
    expect(bad((x) => (x.plan.item_group_field = "custbody_nhom"))).toThrow(/custitem/);
    expect(bad((x) => (x.plan.item_group_field = "custitem_a' OR 1=1"))).toThrow(/custitem/);
    expect(bad((x) => (x.rules[0].f_customer_scope = "X"))).toThrow(/phạm vi khách hàng/);
    expect(bad((x) => Object.assign(x.rules[0], { f_customer_scope: "N", new_days: 0 }))).toThrow(/số ngày tính là khách mới/);
    expect(bad((x) => (x.rules[0].f_item_codes = "A".repeat(4001)))).toThrow(/quá dài/);
    // Trường nhóm hàng trống là hợp lệ (lọc nhóm chỉ khớp dòng ngoài)
    expect(bad((x) => (x.plan.item_group_field = ""))).not.toThrow();
  });
});

describe("route module CommissionV2", () => {
  test("đăng ký route và vai trò", () => {
    expect(Object.keys(V2.routes.get).sort()).toEqual(["commissionExternal", "commissionResult", "commissionSetup", "commissionSimulate", "commissionView"]);
    for (const r of Object.values(V2.routes.get)) expect(r.roles).toBe("payroll");
    expect(Object.keys(V2.routes.post).sort()).toEqual(["commissionAdjust", "commissionApprove", "commissionCalculate", "commissionImport", "commissionPlanSave", "commissionReopen", "commissionVoid"]);
    for (const r of Object.values(V2.routes.post)) expect(r.roles).toBe("acct");
  });

  test("commissionView: bảng tính, lưới, thẻ số liệu, tháng; số truy vấn cố định; chưa tính thì run null", () => {
    let v = V2.routes.get.commissionView.run({ subsidiary: "13", month: "202603" });
    expect(v).toMatchObject({ run: null, rows: [], months: [], month: 202603, from: "2026-03-01", to: "2026-03-31" });
    const out = V2.routes.post.commissionCalculate.run({ subsidiary: "13", month: 202603 });
    db.calls = [];
    v = V2.routes.get.commissionView.run({ subsidiary: "13" });
    expect(v.month).toBe(202603);
    expect(v.run).toMatchObject({ id: out.run, name: "HH202603-13", status: "D", from: "2026-03-01", to: "2026-03-31", totalAmount: 2.2 * M, employees: 2, batch: null, calculated: true });
    expect(v.rows).toHaveLength(2);
    expect(v.rows[0]).toEqual(expect.objectContaining({ resultId: expect.any(String), employee: "101", code: "NV101", name: "Nguyễn An", department: "Phòng 7", plan: "1", planName: "KH-DS", quota: 100 * M, base: 90 * M, attainment: 90, earned: 1.8 * M, override: 0, adjustments: 0, capped: 0, drawPaid: 0, payable: 1.8 * M, warnings: 0 }));
    expect(v.kpis).toMatchObject({ status: "D", results: 2, employees: 2, payable: 2.2 * M, base: 110 * M });
    expect(v.months).toEqual([202603]);
    expect(db.calls.filter((c) => !c.startsWith("find:") || c === "find:comm_run")).toEqual(["find:comm_run", "s4vp_cm_view_rows"]);
    db.failDepartment = true;
    expect(V2.commissionView({ subsidiary: "13", month: 202603 }).rows).toHaveLength(2);
    expect(db.calls).toContain("s4vp_cm_view_rows_df");
  });

  test("commissionResult: chi tiết, credit có số chứng từ / ngày / khách / mặt hàng, điều chỉnh của tháng", () => {
    Commission.adjust({ employee: "101", plan: "1", month: 202603, amount: 100000, reason: "Thưởng thêm" });
    const out = calc();
    const id = resultOf(out.run, "101").id;
    const r = V2.routes.get.commissionResult.run({ id });
    expect(r).toMatchObject({ id, code: "NV101", name: "Nguyễn An", planName: "KH-DS", earningType: "HOAHONG", base: 90 * M, adjustments: 100000, payable: 1.9 * M, run: { id: out.run, status: "D" } });
    expect(r.detail.credits[0]).toEqual(expect.objectContaining({ tranNo: expect.any(String), date: "2026-03-10", customerName: "KH01 Công ty A", itemName: "SP01", source: "NetSuite" }));
    expect(r.detail.components[0]).toMatchObject({ name: "Doanh số", method: "P", amount: 1.8 * M });
    expect(r.adjustmentList).toEqual([{ id: expect.any(String), plan: "1", planName: "KH-DS", month: 202603, amount: 100000, reason: "Thưởng thêm" }]);
    expect(() => V2.commissionResult({ id: "abc" })).toThrow(/Không tìm thấy/);
  });

  test("commissionSetup: kế hoạch lồng thành phần + bậc, phân công, chỉ tiêu; danh mục; loại thu nhập đang dùng", () => {
    db.comm_tier.push({ id: "31", isInactive: false, rule: "11", from_value: 0, rate: 1 });
    db.comm_assign[0].manager = "104";
    const s = V2.routes.get.commissionSetup.run({ subsidiary: "13" });
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]).toMatchObject({ id: "1", name: "KH-DS", basis: "R", rules: [{ id: "11", name: "Doanh số", tiers: [{ id: "31" }] }] });
    expect(s.plans[0].assignments).toHaveLength(2);
    expect(s.earningTypes).toEqual([{ id: "1", code: "HOAHONG", name: "Hoa hồng" }]);
    expect(s.lookups).toMatchObject({ classes: [{ id: "1" }], departments: [{ id: "7" }], locations: [{ id: "3" }], customerCategories: [{ id: "2" }] });
    expect(s.lookups.employees.map((e) => e.id).sort()).toEqual(["101", "102", "104"]);
  });

  test("commissionSimulate", () => {
    const s = V2.routes.get.commissionSimulate.run({ plan: "1", base: "50000000", qty: "0", quota: "" });
    expect(s).toMatchObject({ plan: "1", planName: "KH-DS", amount: 1 * M });
    expect(s.steps.length).toBeGreaterThan(0);
    expect(() => Commission.simulate({ plan: "1", base: "x" })).toThrow(/phải là số/);
  });

  test("không phản hồi nào có khóa tên error ở bất kỳ cấp nào", () => {
    db.comm_rule[0].method = "A"; // không có bậc + không chỉ tiêu -> cảnh báo
    db.comm_assign[1].quota = 0;
    const outs = [];
    outs.push(V2.routes.post.commissionCalculate.run({ subsidiary: "13", month: 202603 }));
    const runId = outs[0].run;
    outs.push(V2.routes.get.commissionView.run({ subsidiary: "13", month: 202603 }));
    outs.push(V2.routes.get.commissionResult.run({ id: resultOf(runId, "102").id }));
    outs.push(V2.routes.get.commissionSetup.run({ subsidiary: "13" }));
    outs.push(V2.routes.get.commissionSimulate.run({ plan: "1", base: 1 }));
    outs.push(V2.routes.get.commissionExternal.run({ subsidiary: "13", month: 202603 }));
    outs.push(V2.routes.post.commissionImport.run({ subsidiary: "13", sourceSystem: "dms", dryRun: true, rows: [{ doc_no: "", date: "x" }] }));
    outs.push(V2.routes.post.commissionApprove.run({ run: runId }));
    outs.push(V2.routes.post.commissionReopen.run({ run: runId }));
    outs.push(V2.routes.post.commissionVoid.run({ run: runId, reason: "x" }));
    expect(outs[0].warnings.length).toBeGreaterThan(0);
    for (const o of outs) expect(keysDeep(o)).not.toContain("error");
    expect(V2.safe({ a: [{ error: 1, b: { error: 2 } }] })).toEqual({ a: [{ issue: 1, b: { issue: 2 } }] });
  });
});

describe("doanh số ngoài (comm_txn)", () => {
  const row = (o) => Object.assign({ doc_no: "D1", line_no: 1, tran_type: "I", date: "2026-03-05", employee: "NV101", revenue: "1,500,000", qty: "2" }, o);

  test("dryRun: kiểm từng dòng, dò nhân viên theo mã / email một truy vấn, trùng khóa, new / update / ok", () => {
    db.comm_txn.push({ id: "81", isInactive: false, subsidiary: "13", source_system: "DMS", doc_no: "D9", line_no: 1, tran_type: "I", date: "2026-03-01", employee: "101", revenue: 100, cost: null, qty: null, collected_amount: null, team: "", customer_code: "", customer_name: "", customer_category: "", item_code: "", item_type: "", import_batch: "", note: "", class: null, department: null, location: null, project: null, first_sale_date: null, collected_date: null });
    const out = Commission.importExternal({
      subsidiary: "13", sourceSystem: "dms", dryRun: true,
      rows: [
        row(),
        row({ line_no: 2, employee: "binh@example.com", date: "05/03/2026" }),
        row(), // trùng khóa D1 / 1
        row({ doc_no: "", employee: "", date: "2026-02-30", revenue: "abc" }),
        row({ doc_no: "D5", employee: "NV999" }),
        row({ doc_no: "D6", employee: "NV104" }), // trùng mã ở hai nhân viên
        row({ doc_no: "D9", employee: "an@example.com", date: "2026-03-01", revenue: 100, qty: "" }),
        row({ doc_no: "D9", line_no: 2, team: JSON.stringify([{ employee: "NV101", pct: 60 }, { employee: "NV102", pct: 40 }]) }),
        row({ doc_no: "D10", tran_type: "Z" }),
        row({ doc_no: "D11", department: "kinh doanh", class: "1", location: "hà nội" }),
        row({ doc_no: "D12", department: "Kho", class: "Sỉ", location: "3" }),
      ],
    });
    expect(out.dryRun).toBe(true);
    expect(out.ok).toBe(false);
    expect(out.sourceSystem).toBe("DMS");
    expect(out.rows.map((r) => r.status)).toEqual(["new", "new", "invalid", "invalid", "invalid", "invalid", "ok", "new", "invalid", "new", "invalid"]);
    // Phân đoạn theo id hoặc tên / tên đầy đủ, không phân biệt hoa thường; một truy vấn mỗi loại cho cả lô
    expect(out.rows[10].messages.map((m) => m.vi)).toEqual(["Không tìm thấy class Sỉ", "Phòng ban Kho trùng nhiều bản ghi"]);
    for (const k of ["class", "department", "location"]) expect(db.calls.filter((c) => c === `s4vp_cm_seg_${k}`)).toHaveLength(1);
    expect(out.rows[1].employee).toBe("102");
    expect(out.rows[2].messages[0].vi).toMatch(/Trùng khóa/);
    expect(out.rows[3].messages.map((m) => m.vi).join(" | ")).toMatch(/Thiếu số chứng từ.*Ngày không hợp lệ.*Thiếu mã nhân viên.*Số không hợp lệ/);
    expect(out.rows[4].messages[0].vi).toMatch(/Không tìm thấy nhân viên NV999/);
    expect(out.rows[5].messages[0].vi).toMatch(/trùng nhiều người/);
    expect(out.counts).toEqual({ total: 11, new: 4, update: 0, ok: 1, invalid: 6 });
    const write = Commission.importExternal({ subsidiary: "13", sourceSystem: "DMS", dryRun: false, rows: [row({ doc_no: "D11", department: "kinh doanh", class: "1", location: "hà nội" })] });
    expect(write.written).toBe(1);
    expect(db.comm_txn.find((x) => x.doc_no === "D11")).toMatchObject({ department: "7", class: "1", location: "3", project: null });
    // Một truy vấn dò nhân viên cho mỗi lượt nạp (hai lượt: kiểm thử và ghi)
    expect(db.calls.filter((c) => c === "s4vp_cm_emp_lookup")).toHaveLength(2);
    expect(() => Commission.importExternal({ subsidiary: "13", sourceSystem: "DMS", dryRun: false, rows: [row(), row()] })).toThrow(/dòng lỗi/);
  });

  test("ghi thật: tạo / cập nhật theo khóa, chia lượt more, khóa dòng thuộc bảng tính đã duyệt; commissionExternal", () => {
    let out = Commission.importExternal({ subsidiary: "13", sourceSystem: "DMS", dryRun: false, rows: [row(), row({ line_no: 2, revenue: 2000000 })] });
    expect(out).toMatchObject({ ok: true, written: 2, counts: { new: 2 } });
    expect(db.comm_txn[0]).toMatchObject({ subsidiary: "13", source_system: "DMS", doc_no: "D1", line_no: 1, tran_type: "I", date: "2026-03-05", employee: "101", revenue: 1500000, qty: 2 });
    // Lượt sau cùng dữ liệu: không ghi gì; đổi số thì cập nhật đúng dòng
    out = Commission.importExternal({ subsidiary: "13", sourceSystem: "DMS", dryRun: false, rows: [row(), row({ line_no: 2, revenue: 2500000 })] });
    expect(out).toMatchObject({ written: 1, counts: { ok: 1, update: 1 } });
    expect(db.comm_txn).toHaveLength(2);
    expect(db.comm_txn[1].revenue).toBe(2500000);
    // Chia lượt
    let left = 1;
    db.usage = () => (left-- > 0 ? 10000 : 100);
    out = Commission.importExternal({ subsidiary: "13", sourceSystem: "DMS", dryRun: false, rows: [row({ doc_no: "E1" }), row({ doc_no: "E2" })] });
    expect(out).toMatchObject({ written: 1, more: true });
    db.usage = () => 10000;
    out = Commission.importExternal({ subsidiary: "13", sourceSystem: "DMS", dryRun: false, rows: [row({ doc_no: "E1" }), row({ doc_no: "E2" })] });
    expect(out).toMatchObject({ written: 1, counts: { ok: 1, new: 1 } });
    expect(out.more).toBeUndefined();
    // Bảng tính tháng 3 đã duyệt: sửa dòng tháng 3 bị từ chối, dòng không đổi vẫn ok
    db.comm_run.push({ id: "601", name: "HH202603-13", isInactive: false, subsidiary: "13", month: 202603, status: "A", date_from: "2026-03-01", date_to: "2026-03-31" });
    const dry = Commission.importExternal({ subsidiary: "13", sourceSystem: "DMS", rows: [row(), row({ line_no: 2, revenue: 1 }), row({ doc_no: "F1", date: "2026-04-02" })] });
    expect(dry.rows.map((r) => r.status)).toEqual(["ok", "invalid", "new"]);
    expect(dry.rows[1].messages[0].vi).toMatch(/đã duyệt HH202603-13/);

    const list = V2.routes.get.commissionExternal.run({ subsidiary: "13", month: 202603 });
    expect(list).toMatchObject({ month: 202603, from: "2026-03-01", to: "2026-03-31", counts: { rows: 4, systems: [{ sourceSystem: "DMS", rows: 4 }] } });
    expect(list.rows[0]).toEqual(expect.objectContaining({ sourceSystem: "DMS", docNo: "D1", lineNo: 1, tranType: "I", date: "2026-03-05", employee: "101", code: "NV101", name: "Nguyễn An", revenue: 1500000, locked: true }));
    expect(() => Commission.importExternal({ subsidiary: "13", sourceSystem: "", rows: [row()] })).toThrow(/hệ thống nguồn/);
  });

  test("nạp nhóm hàng, loại mặt hàng (chuẩn mã NetSuite), loại khách hàng (N / E, mới / cũ, new / existing)", () => {
    const rows = [
      row({ doc_no: "G1", item_code: "SP-01", item_type: "invtpart", item_group: " Điện máy ", customer_type: "mới" }),
      row({ doc_no: "G2", item_type: "Hàng lạ", customer_type: "Existing" }),
      row({ doc_no: "G3", customer_type: "E" }),
      row({ doc_no: "G4", customer_type: "khách cũ" }),
      row({ doc_no: "G5", customer_type: "" }),
      row({ doc_no: "G6", customer_type: "vip" }),
    ];
    const dry = Commission.importExternal({ subsidiary: "13", sourceSystem: "DMS", dryRun: true, rows });
    expect(dry.rows.map((r) => r.status)).toEqual(["new", "new", "new", "new", "new", "invalid"]);
    expect(dry.rows[5].messages[0].vi).toBe("Loại khách hàng phải là N (mới) hoặc E (cũ): vip");
    const out = Commission.importExternal({ subsidiary: "13", sourceSystem: "DMS", dryRun: false, rows: rows.slice(0, 5) });
    expect(out.written).toBe(5);
    const by = (d) => db.comm_txn.find((x) => x.doc_no === d);
    expect(by("G1")).toMatchObject({ item_code: "SP-01", item_type: "InvtPart", item_group: "Điện máy", customer_type: "N" });
    expect(by("G2")).toMatchObject({ item_type: "Hàng lạ", customer_type: "E" });
    expect([by("G3").customer_type, by("G4").customer_type, by("G5").customer_type]).toEqual(["E", "E", null]);
    // Nạp lại cùng dữ liệu: không đổi
    expect(Commission.importExternal({ subsidiary: "13", sourceSystem: "DMS", dryRun: true, rows: rows.slice(0, 5) }).counts.ok).toBe(5);
    const list = V2.routes.get.commissionExternal.run({ subsidiary: "13", month: 202603 });
    expect(list.rows.find((x) => x.docNo === "G1")).toMatchObject({ itemCode: "SP-01", itemType: "InvtPart", itemGroup: "Điện máy", customerType: "N" });
    expect(Commission.parseCustomerType("New")).toBe("N");
    expect(Commission.parseCustomerType("cũ")).toBe("E");
  });
});
