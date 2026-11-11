// api/OutputSources (sản lượng từ giao dịch, docs/COMMISSION.md mục 9) trên Store giả trong bộ nhớ (tests/api/calcFake.js) với
// api/Output và lõi thật: dòng giao dịch giả trả theo tag s4vp_osr_lines, khóa đã sinh theo tag s4vp_osr_done.
// Kiểm: ánh xạ dòng đề xuất, tra đơn giá (RATE_MISSING như phiếu nhập tay), phiếu tổ, không sinh trùng, kiểm id trường,
// giới hạn phiếu / governance và cửa sổ đọc theo con trỏ.
const path = require("path");
const calcFake = require("./calcFake");

const mockState = { store: null, cache: {}, usage: 5000 };

jest.mock("N/query", () => ({}), { virtual: true });
jest.mock("N/record", () => ({ Type: {} }), { virtual: true });
jest.mock("N/format", () => ({ Type: { DATE: "date", DATETIMETZ: "dtz" }, format: () => { throw new Error("no format"); }, parse: () => null }), { virtual: true });
jest.mock("N/log", () => ({ audit: () => undefined, error: () => undefined, debug: () => undefined }), { virtual: true });
jest.mock("N/runtime", () => ({
  getCurrentUser: () => ({ id: 5, roleId: "administrator", getPreference: () => "vi_VN" }),
  getCurrentScript: () => ({ getParameter: () => "7", getRemainingUsage: () => mockState.usage }),
  ContextType: {},
}), { virtual: true });
jest.mock("N/cache", () => ({
  Scope: { PRIVATE: "PRIVATE", PROTECTED: "PROTECTED", PUBLIC: "PUBLIC" },
  getCache: ({ name }) => ({
    get: ({ key }) => (mockState.cache[`${name}|${key}`] === undefined ? null : mockState.cache[`${name}|${key}`]),
    put: ({ key, value }) => (mockState.cache[`${name}|${key}`] = String(value)),
    remove: ({ key }) => delete mockState.cache[`${name}|${key}`],
  }),
}), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const forward = {};
  for (const k of ["find", "findIn", "get", "run", "submit", "update", "create", "remove", "rec", "codeOf", "idOf", "memoize"]) forward[k] = (...a) => mockState.store[k](...a);
  forward.stats = [];
  return forward;
});

const Sources = require(path.join(calcFake.ROOT, "api/OutputSources"));
const Output = require(path.join(calcFake.ROOT, "api/Output"));
const Rules = require(path.join(calcFake.ROOT, "core/OutputRules"));

/** Dòng giao dịch giả (dạng cột thô của câu SuiteQL). */
function tl(t, l, o) {
  return Object.assign({ t_id: t, t_no: `TX${t}`, t_date: "2027-03-10", l_id: l, l_item: 1, i_code: "SP1", l_qty: 1, l_dept: null, d_name: null, w_emp: null, w_team: null, e_code: null, e_first: null, e_last: null, tm_name: null }, o);
}

/** Dữ liệu mẫu calcFake + nguồn, tổ, dòng giao dịch; Store giả ghi được (create / update / remove) và trả dòng giao dịch theo tag. */
function fresh(tweak) {
  const db = calcFake.buildDb(4);
  db.team = [{ id: "5", name: "TO-1", subsidiary: "13", split_method: "E", project: "502", department: "77" }];
  db.team_member = [{ id: "1", team: "5", employee: "101" }, { id: "2", team: "5", employee: "102" }];
  db.out_source = [
    { id: "1", name: "LAP-RAP", subsidiary: "13", tran_type: "Build", employee_field: "custbody_s4_worker", team_field: null, rate_table: "1", qty_sign: null, department_from_line: true },
    { id: "2", name: "XUAT-KHO", subsidiary: "13", tran_type: "ItemShip", employee_field: "custcol_s4_picker", team_field: "custcol_s4_team", rate_table: "1", qty_sign: null, department_from_line: false },
  ];
  db.tran = { Build: [], WOCompl: [], ItemShip: [] };
  if (tweak) tweak(db);
  const f = calcFake.make(db);
  let seq = 900000;
  const check = (name, values) => {
    const def = f.store.rec(name);
    for (const key of Object.keys(values)) if (key !== "isInactive" && key !== "name" && !def.fields[key]) throw new Error(`Unknown field ${name}.${key}`);
  };
  f.store.update = (name, id, values) => {
    check(name, values);
    const row = (db[name] || []).find((r) => String(r.id) === String(id));
    Object.assign(row, values);
    f.log.writes.push({ name, id: String(id), values: JSON.parse(JSON.stringify(values)), kind: "update" });
    return String(id);
  };
  f.store.create = (name, values) => {
    check(name, values);
    const id = String(++seq);
    const row = Object.assign({ id }, values);
    if (name === "output") row.name = `SL${id}`;
    (db[name] = db[name] || []).push(row);
    f.log.writes.push({ name, id, values: JSON.parse(JSON.stringify(values)), kind: "create" });
    return id;
  };
  f.store.remove = (name, id) => {
    db[name] = (db[name] || []).filter((r) => String(r.id) !== String(id));
  };
  const sql = [];
  const baseRun = f.store.run;
  f.store.run = (text, params, tag) => {
    if (tag === "s4vp_osr_lines") {
      sql.push({ text, params });
      const type = /t\.type = '(\w+)'/.exec(text)[1];
      const limit = Number(/ROWNUM <= (\d+)/.exec(text)[1]);
      const [sub, from, to, cursor] = params;
      if (String(sub) !== "13") return [];
      return db.tran[type].filter((r) => Number(r.t_id) > Number(cursor) && r.t_date >= from && r.t_date <= to).slice(0, limit).map((r) => Object.assign({}, r));
    }
    if (tag === "s4vp_osr_done") {
      sql.push({ text, params });
      const type = /LIKE '(\w+):%'/.exec(text)[1];
      const [, from, to] = /BETWEEN TO_DATE\('([\d-]+)', 'YYYY-MM-DD'\) AND TO_DATE\('([\d-]+)'/.exec(text);
      return db.output
        .filter((e) => !e.isInactive && e.subsidiary === "13" && String(e.src_tran || "").indexOf(`${type}:`) === 0 && e.doc_date >= from && e.doc_date <= to)
        .map((e) => ({ id: e.id, c_name: e.name, c_src_tran: e.src_tran }));
    }
    return baseRun(text, params, tag);
  };
  mockState.store = f.store;
  mockState.cache = {};
  mockState.usage = 5000;
  return { db, sql, log: f.log };
}

const generated = (db) => db.output.filter((e) => e.src);
const linesOf = (db, id) => db.output_line.filter((l) => l.entry === id);
const MARCH = { from: "2027-03-01", to: "2027-03-31" };

describe("preview: ánh xạ dòng giao dịch và đơn giá", () => {
  test("mã hạng mục viết hoa, định giá theo bảng, RATE_MISSING như phiếu nhập tay, dòng thiếu người làm bị bỏ qua", () => {
    const { sql } = fresh((db) => {
      db.tran.Build = [
        tl(900, 0, { i_code: "sp1", l_qty: 10, l_dept: 31, d_name: "Xưởng 1", w_emp: 101, e_code: "E0001", e_first: "An", e_last: "Nguyễn" }),
        tl(901, 0, { t_date: "2027-03-12", i_code: "SP9", l_qty: 4, w_emp: 102 }),
        tl(902, 0, { l_qty: 3 }),
        tl(903, 0, { l_qty: 0, w_emp: 101 }),
      ];
    });
    const r = Sources.preview(Object.assign({ source: "1" }, MARCH));
    expect(r.source).toMatchObject({ id: "1", tranType: "Build", rateTableCode: "DG1" });
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0]).toMatchObject({
      key: "Build:900:0", tran: "900", tranNo: "TX900", date: "2027-03-10", kind: "I", employee: "101", who: "E0001 Nguyễn An", item: "SP1", qty: 10,
      rate: 5000, amount: 50000, department: "31", departmentName: "Xưởng 1", status: "N", warning: null,
    });
    const missing = Rules.priceLine({ item: "SP9", qty: 4, rate: "" }, Output.rateTable("1"), "2027-03-12", "");
    expect(r.rows[1]).toMatchObject({ item: "SP9", rate: 0, amount: 0, status: "N", warning: missing.warning.code });
    expect(missing.warning.code).toBe("RATE_MISSING");
    expect(r.rows[2]).toMatchObject({ status: "S", skip: "NO_WORKER" });
    expect(r.rows[3]).toMatchObject({ status: "S", skip: "BAD_QTY" });
    expect(r.counts).toEqual({ lines: 4, generated: 0, skipped: 2, ready: 2, entries: 2, amount: 50000, rateMissing: 1 });
    expect(r.truncated).toBe(false);
    // Một câu lệnh giao dịch: cột trường nhân viên lấy từ body, tham số công ty con, khoảng ngày, con trỏ
    const lines = sql.filter((q) => /s4vp_osr|FROM transaction/.test(q.text) && / FROM transaction /.test(q.text));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain("t.custbody_s4_worker AS w_emp");
    expect(lines[0].text).toContain("LEFT JOIN employee e ON e.id = t.custbody_s4_worker");
    expect(lines[0].text).toContain("t.type = 'Build' AND tl.mainline = 'T'");
    expect(lines[0].text).not.toContain("customrecord_s4vp_team");
    expect(lines[0].params).toEqual([13, "2027-03-01", "2027-03-31", 0]);
  });

  test("item fulfillment: số lượng đổi dấu mặc định -1, dòng có tổ là phiếu tổ, đơn giá theo dự án của tổ", () => {
    fresh((db) => {
      db.rate_line.push({ id: "2", table: "1", item: "SP1", rate: 7000, from_amount: 0, effective: "2026-01-01", expiration: null, project: "502" });
      db.tran.ItemShip = [tl(950, 0, { l_qty: -5, w_team: 5, tm_name: "TO-1" }), tl(950, 3, { l_qty: -2, w_emp: 103, e_code: "E0003" })];
    });
    const r = Sources.preview(Object.assign({ source: "2" }, MARCH));
    expect(r.rows[0]).toMatchObject({ kind: "T", team: "5", who: "TO-1", qty: 5, rate: 7000, amount: 35000, department: null });
    expect(r.rows[1]).toMatchObject({ kind: "I", employee: "103", qty: 2, rate: 5000, amount: 10000 });
  });
});

describe("generate: tạo phiếu tạm giữ qua Output.save", () => {
  test("phiếu cá nhân: ngày chứng từ, phòng ban dòng, khóa nguồn, cùng định giá và cảnh báo như phiếu nhập tay", () => {
    const { db } = fresh((db) => {
      db.tran.Build = [
        tl(900, 0, { i_code: "sp1", l_qty: 10, l_dept: 31, w_emp: 101 }),
        tl(901, 0, { t_date: "2027-03-12", i_code: "SP9", l_qty: 4, w_emp: 102 }),
        tl(902, 0, { l_qty: 3 }),
      ];
    });
    const r = Sources.generate(Object.assign({ source: "1" }, MARCH));
    expect(r.created).toBe(2);
    expect(r.more).toBe(false);
    expect(r.failed).toEqual([]);
    const manual = Rules.priceLine({ item: "SP9", qty: 4, rate: "" }, Output.rateTable("1"), "2027-03-12", "");
    expect(r.warnings).toEqual([manual.warning]);
    const [a, b] = generated(db);
    expect(a).toMatchObject({ subsidiary: "13", doc_date: "2027-03-10", period: "3", type: "I", rate_table: "1", status: "H", department: "31", src: "1", src_tran: "Build:900:0", total: 50000, description: "Build TX900" });
    expect(linesOf(db, a.id)).toEqual([expect.objectContaining({ employee: "101", item: "SP1", qty: 10, rate: 5000, amount: 50000, description: "TX900" })]);
    expect(b).toMatchObject({ doc_date: "2027-03-12", department: null, src_tran: "Build:901:0", total: 0 });
    // Phiếu sinh ra đi tiếp quy trình duyệt như phiếu nhập tay
    expect(Output.act(a.id, "submit").status).toBe("P");
  });

  test("không sinh trùng: lượt sau bỏ qua dòng đã sinh; preview đánh dấu đã sinh; phiếu bị hủy thì sinh lại", () => {
    const { db } = fresh((db) => {
      db.tran.Build = [tl(900, 0, { l_qty: 10, w_emp: 101 }), tl(901, 0, { l_qty: 2, w_emp: 102 })];
    });
    expect(Sources.generate(Object.assign({ source: "1" }, MARCH)).created).toBe(2);
    expect(Sources.generate(Object.assign({ source: "1" }, MARCH)).created).toBe(0);
    expect(generated(db)).toHaveLength(2);
    const first = generated(db)[0];
    const p = Sources.preview(Object.assign({ source: "1" }, MARCH));
    expect(p.rows[0]).toMatchObject({ status: "G", entry: first.id, entryName: first.name });
    expect(p.counts).toMatchObject({ generated: 2, ready: 0, entries: 0 });
    // Dòng giao dịch mới thêm sau: chỉ dòng đó được sinh
    db.tran.Build.push(tl(905, 0, { l_qty: 1, w_emp: 103 }));
    expect(Sources.generate(Object.assign({ source: "1" }, MARCH)).created).toBe(1);
    Output.voidEntry(first.id, "Sai người làm");
    const again = Sources.generate(Object.assign({ source: "1" }, MARCH));
    expect(again.created).toBe(1);
    expect(db.output.filter((e) => e.src_tran === "Build:900:0" && !e.isInactive)).toHaveLength(1);
  });

  test("phiếu tổ: thành viên nạp như loadTeamMembers, nhận dự án / phòng ban của tổ, các dòng cùng tổ gom một phiếu", () => {
    const { db } = fresh((db) => {
      db.tran.ItemShip = [
        tl(950, 0, { l_qty: -5, w_team: 5 }),
        tl(950, 3, { l_qty: -3, w_team: 5 }),
        tl(950, 6, { l_qty: -2, w_emp: 103 }),
      ];
    });
    const r = Sources.generate(Object.assign({ source: "2" }, MARCH));
    expect(r.created).toBe(2);
    expect(r.entries[0]).toMatchObject({ kind: "T", lines: 2, members: 2 });
    const team = generated(db).find((e) => e.type === "T");
    expect(team).toMatchObject({ team: "5", project: "502", department: "77", split_method: "E", src: "2", src_tran: "ItemShip:950:0;ItemShip:950:3", total: 40000 });
    expect(linesOf(db, team.id).map((l) => [l.employee, l.qty])).toEqual([[null, 5], [null, 3]]);
    expect(db.output_member.filter((m) => m.entry === team.id).map((m) => m.employee)).toEqual(["101", "102"]);
    const single = generated(db).find((e) => e.type === "I");
    expect(linesOf(db, single.id)).toEqual([expect.objectContaining({ employee: "103", qty: 2 })]);
  });

  test("khóa nguồn không quá 300 ký tự: nhiều dòng của cùng người làm tách thành nhiều phiếu", () => {
    const { db } = fresh((db) => {
      for (let i = 0; i < 40; i++) db.tran.Build.push(tl(123456, i * 1000, { l_qty: 1, w_emp: 101 }));
    });
    const r = Sources.generate(Object.assign({ source: "1" }, MARCH));
    const made = generated(db);
    expect(made.length).toBeGreaterThan(1);
    expect(r.created).toBe(made.length);
    for (const e of made) expect(e.src_tran.length).toBeLessThanOrEqual(300);
    expect(made.reduce((s, e) => s + e.src_tran.split(";").length, 0)).toBe(40);
  });
});

describe("cấu hình nguồn và id trường", () => {
  test("id trường phải dạng custbody / custcol: sai dạng thì báo lỗi trước khi chạy SuiteQL", () => {
    for (const bad of ["custbody_x; DROP", "employee", "custbody_x OR 1=1", "custrecord_x", "custbody-x", "custcol_x)"]) {
      const { sql } = fresh((db) => (db.out_source[0].employee_field = bad));
      expect(() => Sources.preview(Object.assign({ source: "1" }, MARCH))).toThrow(/custbody \/ custcol/);
      expect(() => Sources.generate(Object.assign({ source: "1" }, MARCH))).toThrow(/custbody \/ custcol/);
      expect(sql).toHaveLength(0);
    }
    expect(Sources.fieldColumn(" CUSTBODY_S4_Worker ")).toBe("t.custbody_s4_worker");
    expect(Sources.fieldColumn("custcol_s4_team")).toBe("tl.custcol_s4_team");
    expect(Sources.fieldColumn("")).toBeNull();
  });

  test("trường tổ sai dạng, thiếu cả hai trường, nguồn không có / ngưng dùng, khoảng ngày sai đều báo lỗi", () => {
    fresh((db) => (db.out_source[1].team_field = "custcol_team'--"));
    expect(() => Sources.preview(Object.assign({ source: "2" }, MARCH))).toThrow(/Team field/);
    fresh((db) => Object.assign(db.out_source[0], { employee_field: null, team_field: null }));
    expect(() => Sources.preview(Object.assign({ source: "1" }, MARCH))).toThrow(/employee field or a team field/);
    fresh((db) => (db.out_source[0].isInactive = true));
    expect(() => Sources.preview(Object.assign({ source: "1" }, MARCH))).toThrow(/not found or inactive/);
    fresh();
    expect(() => Sources.preview(Object.assign({ source: "x" }, MARCH))).toThrow(/Select an output source/);
    expect(() => Sources.preview({ source: "1", from: "2027-03-31", to: "2027-03-01" })).toThrow(/start date/);
    expect(() => Sources.preview({ source: "1", from: "2027-02-30", to: "2027-03-01" })).toThrow(/valid date range/);
    expect(() => Sources.preview({ source: "1", from: "2026-01-01", to: "2027-03-01" })).toThrow(/366/);
  });

  test("chỉ có trường tổ: câu lệnh JOIN bảng tổ, cột nhân viên là NULL", () => {
    const { sql } = fresh((db) => Object.assign(db.out_source[1], { employee_field: null }));
    Sources.preview(Object.assign({ source: "2" }, MARCH));
    const text = sql.find((q) => / FROM transaction /.test(q.text)).text;
    expect(text).toContain("NULL AS w_emp");
    expect(text).toContain("tl.custcol_s4_team AS w_team");
    expect(text).toContain("LEFT JOIN customrecord_s4vp_team tm ON tm.id = tl.custcol_s4_team");
    expect(text).not.toContain("LEFT JOIN employee");
    expect(text).toContain("t.type = 'ItemShip' AND tl.iscogs = 'F'");
  });

  test("outputSources: nguồn đang dùng của công ty con, kèm mã bảng đơn giá; routes khai đủ action", () => {
    fresh((db) => db.out_source.push({ id: "3", name: "KHAC", subsidiary: "99", tran_type: "Build", rate_table: "1" }));
    const r = Sources.sources({ subsidiary: "13" });
    expect(r.recordType).toBe("customrecord_s4vp_out_source");
    expect(r.sources.map((s) => [s.id, s.name, s.tranType, s.rateTableCode])).toEqual([["1", "LAP-RAP", "Build", "DG1"], ["2", "XUAT-KHO", "ItemShip", "DG1"]]);
    expect(Object.keys(Sources.routes.post)).toEqual(["outputSourcePreview", "outputSourceGenerate"]);
    expect(Sources.routes.get.outputSources.roles).toBe("payroll");
    expect(Sources.routes.post.outputSourceGenerate.roles).toBe("hr");
  });
});

describe("governance và con trỏ", () => {
  test("tối đa ENTRY_CAP phiếu mỗi lượt, more = true; gọi lại cùng tham số thì làm tiếp tới hết", () => {
    const { db } = fresh((db) => {
      for (let i = 0; i < Sources.ENTRY_CAP + 5; i++) db.tran.Build.push(tl(1000 + i, 0, { l_qty: 1, w_emp: 101 }));
    });
    const a = Sources.generate(Object.assign({ source: "1" }, MARCH));
    expect(a).toMatchObject({ created: Sources.ENTRY_CAP, more: true });
    expect(typeof a.cursor).toBe("string");
    const b = Sources.generate(Object.assign({ source: "1" }, MARCH));
    expect(b).toMatchObject({ created: 5, more: false, cursor: null });
    expect(generated(db)).toHaveLength(Sources.ENTRY_CAP + 5);
  });

  test("điểm governance còn ít: dừng trước khi ghi, more = true", () => {
    const { db } = fresh((db) => (db.tran.Build = [tl(900, 0, { l_qty: 1, w_emp: 101 })]));
    mockState.usage = 200;
    expect(Sources.generate(Object.assign({ source: "1" }, MARCH))).toMatchObject({ created: 0, more: true });
    expect(generated(db)).toHaveLength(0);
    mockState.usage = 5000;
    expect(Sources.generate(Object.assign({ source: "1" }, MARCH))).toMatchObject({ created: 1, more: false });
  });

  test("cửa sổ đầy: bỏ giao dịch cuối, trả truncated và con trỏ; đọc tiếp từ con trỏ; giao dịch quá cửa sổ thì báo lỗi", () => {
    const W = Sources.WINDOW;
    const { db, sql } = fresh((db) => {
      for (let i = 0; i < 600; i++) db.tran.Build.push(tl(2001, i, { l_qty: 1, w_emp: 101 }));
      for (let i = 0; i < 600; i++) db.tran.Build.push(tl(2002, i, { l_qty: 1, w_emp: 102 }));
    });
    const p = Sources.preview(Object.assign({ source: "1" }, MARCH));
    expect(p.truncated).toBe(true);
    expect(p.cursor).toBe("2001");
    expect(p.rows).toHaveLength(600);
    expect(p).not.toHaveProperty("more");
    const next = Sources.preview(Object.assign({ source: "1", cursor: p.cursor }, MARCH));
    expect(next.truncated).toBe(false);
    expect(next.rows).toHaveLength(600);
    expect(next.rows.every((r) => r.tran === "2002")).toBe(true);
    expect(sql.filter((q) => / FROM transaction /.test(q.text)).every((q) => q.text.indexOf(`ROWNUM <= ${W + 1}`) > 0)).toBe(true);
    // Một giao dịch quá WINDOW dòng: báo lỗi thay vì sinh thiếu dòng
    db.tran.Build = [];
    for (let i = 0; i <= W; i++) db.tran.Build.push(tl(3001, i, { l_qty: 1, w_emp: 101 }));
    expect(() => Sources.preview(Object.assign({ source: "1" }, MARCH))).toThrow(/more than/);
  });
});
