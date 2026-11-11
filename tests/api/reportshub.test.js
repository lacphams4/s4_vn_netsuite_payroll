// Báo cáo - tờ khai bản 2 (api/ReportsHub): danh mục và kỳ gợi ý, phiếu số liệu nhập HTKK, quỹ lương theo phòng ban x loại lao
// động (truy vấn gom nhóm), sổ theo dõi thuế TNCN - trên Store giả; vai trò của route, số truy vấn không tăng theo số nhân viên.
const path = require("path");
const ROOT = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll");

const mockDb = {};
const db = mockDb;

jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2027-05-10" }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({ resolve: () => ({ accounts: { acc_expense: "642" } }) }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const Schema = jest.requireActual("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Schema");
  const s = (v) => (v === null || v === undefined ? "" : String(v));
  const inIds = (sql) => {
    const m = /IN \(([\d,]+)\)/.exec(sql);
    if (!m) throw new Error("IN list must be inline integers: " + sql.slice(0, 80));
    return m[1].split(",");
  };
  const linesOf = (sql) => {
    if (!/l\.isinactive = 'F'/.test(sql)) throw new Error("inactive lines must be excluded");
    const ids = inIds(sql);
    return mockDb.lines.filter((l) => ids.includes(l.batch) && !l.isInactive);
  };
  const profileOf = (l) => mockDb.profiles.find((p) => p.id === l.profile) || {};
  const sumGroups = (lines, deptOf) => {
    const map = new Map();
    for (const l of lines) {
      const dept = deptOf(l);
      const k = `${dept}|${l.employment_type}`;
      const g = map.get(k) || { department: dept || null, etype: l.employment_type, set: new Set(), gross: 0, ee_ins: 0, er_ins: 0, pit: 0, other_ded: 0, advance: 0, net: 0, accrued13: 0 };
      g.set.add(l.employee);
      for (const f of ["gross", "ee_ins", "er_ins", "pit", "other_ded", "advance", "net", "accrued13"]) g[f] += l[f] || 0;
      map.set(k, g);
    }
    return [...map.values()].map((g) => Object.assign({}, g, { headcount: g.set.size, set: undefined }));
  };
  // Sổ thuế: một truy vấn gom nhóm theo nhân viên; tháng xoay thành cột SUM(CASE WHEN <batch> IN (...) THEN <cột> ELSE 0 END)
  const BE = Schema.records.batch_emp.fields;
  const keyOfCol = Object.fromEntries(Object.entries(BE).map(([k, f]) => [f.id, k]));
  const ledger = (sql, withNames) => {
    if (/detail/.test(sql)) throw new Error("ledger must not read the detail clob");
    if (!/GROUP BY l\.custrecord_s4vp_be_employee$/.test(sql)) throw new Error("ledger must group by employee in the database");
    if (!/LEFT JOIN customrecord_s4vp_employee p ON p\.id = l\.custrecord_s4vp_be_profile/.test(sql)) throw new Error("profile must be joined by its primary key");
    const where = /WHERE (.*) GROUP BY/.exec(sql)[1];
    const lines = linesOf(where);
    const cases = [];
    const re = /SUM\(CASE WHEN l\.custrecord_s4vp_be_batch IN \(([\d,]+)\) THEN (1|l\.(\w+)) ELSE 0 END\) AS (\w+)/g;
    let m;
    while ((m = re.exec(sql))) cases.push({ ids: m[1].split(","), key: m[3] ? keyOfCol[m[3]] : null, alias: m[4] });
    const by = new Map();
    for (const l of lines) (by.get(l.employee) || by.set(l.employee, []).get(l.employee)).push(l);
    return [...by.entries()].map(([emp, ls]) => {
      const prof = mockDb.profiles.find((p) => p.id === ls[0].profile) || {};
      const e = mockDb.employees[emp] || {};
      const row = { employee: emp, etype: ls[0].employment_type, tax_code: prof.tax_code || null, p_etype: prof.employment_type || null };
      if (withNames) Object.assign(row, { e_code: e.entityid || null, e_first: e.firstname || null, e_last: e.lastname || null });
      for (const c of cases) row[c.alias] = ls.filter((l) => c.ids.includes(l.batch)).reduce((s, l) => s + (c.key ? l[c.key] || 0 : 1), 0);
      return row;
    });
  };
  const handlers = {
    s4vp_rh_taxpayer:(sql, [sub]) => {
      if (mockDb.failTaxpayer) throw new Error("no such column");
      return mockDb.subsidiaries.filter((x) => x.id === s(sub));
    },
    s4vp_rh_taxpayer_name: (sql, [sub]) => {
      if (mockDb.failTaxpayer === "all") throw new Error("no access");
      return mockDb.subsidiaries.filter((x) => x.id === s(sub)).map((x) => ({ name: x.name }));
    },
    s4vp_rh_fund: (sql) => {
      if (mockDb.failEmployeeJoin) throw new Error("join not allowed");
      if (!/GROUP BY COALESCE\(p\.custrecord_s4vp_emp_department, e\.department\)/.test(sql) && !/GROUP BY COALESCE/.test(sql)) throw new Error("must group in the database");
      return sumGroups(linesOf(sql), (l) => profileOf(l).department || (mockDb.employees[l.employee] || {}).department || "");
    },
    s4vp_rh_fund_profile: (sql) => sumGroups(linesOf(sql), (l) => profileOf(l).department || ""),
    s4vp_rh_fund_head: (sql) => [{ headcount: new Set(linesOf(sql).map((l) => l.employee)).size }],
    s4vp_rh_dept: (sql) => {
      if (mockDb.failDept) throw new Error("departments disabled");
      return inIds(sql).filter((id) => mockDb.departments[id]).map((id) => ({ id, name: mockDb.departments[id] }));
    },
    s4vp_rh_emp: (sql) => inIds(sql).filter((id) => mockDb.employees[id]).map((id) => Object.assign({ id }, mockDb.employees[id])),
    s4vp_rh_pit_ledger: (sql) => {
      if (mockDb.failEmployeeJoin) throw new Error("join not allowed");
      return ledger(sql, true);
    },
    s4vp_rh_pit_ledger_noemp: (sql) => ledger(sql, false),
    // api/Reports (action cũ) dùng khi dựng phiếu HTKK
    s4vp_rpt_emp: (sql, ids) => ids.filter((id) => mockDb.employees[id]).map((id) => Object.assign({ id }, mockDb.employees[id])),
  };
  const table = (name) => ({ batch: mockDb.batches, period: mockDb.periods, batch_emp: mockDb.lines, employee: mockDb.profiles, compensation: [] })[name] || [];
  return {
    rec: (name) => Schema.records[name],
    codeOf: (list, id) => (id === null || id === undefined || id === "" ? null : String(id)),
    run(sql, params, scriptId) {
      mockDb.calls.push(`run:${scriptId}`);
      mockDb.sql[scriptId] = sql;
      if (!handlers[scriptId]) throw new Error(`unexpected query ${scriptId}`);
      return handlers[scriptId](sql, params || []);
    },
    find(name, opt = {}) {
      mockDb.calls.push(`find:${name}`);
      let rows = table(name).filter((r) => opt.includeInactive || !r.isInactive);
      if (name === "batch" && opt.where) {
        if (opt.where !== "{subsidiary} = ?") throw new Error("unexpected where " + opt.where);
        rows = rows.filter((r) => r.subsidiary === s(opt.params[0]));
      }
      return rows.map((r) => Object.assign({}, r));
    },
    findIn(name, field, ids) {
      mockDb.calls.push(`findIn:${name}`);
      const set = new Set((ids || []).map(String));
      return table(name).filter((r) => set.has(s(r[field]))).map((r) => Object.assign({}, r));
    },
  };
});

const Hub = require(path.join(ROOT, "api/ReportsHub"));

const detail = (v) => JSON.stringify({ insurance: v.insurance || [], allocations: [], employmentType: v.employment_type || "E" });

function addBatch(id, periodId, status, lines, v) {
  db.batches.push(Object.assign({ id: String(id), name: `BL${String(id).padStart(6, "0")}`, subsidiary: "13", period: String(periodId), tax_month: "", status, calculated: !["B", "H"].includes(status), emp_count: lines.length, gross: lines.reduce((t, l) => t + (l.gross || 0), 0) }, v));
  lines.forEach((l, i) => {
    const profile = db.profiles.find((p) => p.employee === String(l.employee)) || {};
    db.lines.push(Object.assign({ id: `${id}-${i}`, batch: String(id), profile: profile.id || null, employment_type: profile.employment_type || "E", gross: 0, ee_ins: 0, er_ins: 0, pit: 0, other_ded: 0, advance: 0, net: 0, accrued13: 0, taxable: 0, family_ded: 0, dependents: 0, other_tax_ded: 0, assessable: 0, insurance_wage: 0 }, l, { employee: String(l.employee), detail: detail(l) }));
  });
}

beforeEach(() => {
  Object.keys(db).forEach((k) => delete db[k]);
  Object.assign(db, {
    calls: [], sql: {}, lines: [], batches: [],
    periods: [{ id: "1", name: "202701" }, { id: "2", name: "202702" }, { id: "3", name: "202703" }, { id: "4", name: "202704" }, { id: "9", name: "202612", isInactive: true }],
    subsidiaries: [{ id: "13", name: "S4VN Test", legalname: "Công ty TNHH S4VN Test", federalidnumber: "0312345678" }, { id: "14", name: "Sao Mai", legalname: null, federalidnumber: null }],
    departments: { 10: "Kế toán", 20: "Sản xuất" },
    employees: {
      101: { entityid: "E101", firstname: "An", lastname: "Nguyễn", department: "10" }, 102: { entityid: "E102", firstname: "Bình", lastname: "Trần", department: "20" },
      103: { entityid: "E103", firstname: "Chi", lastname: "Lê", department: "20" }, 104: { entityid: "E104", firstname: "Dũng", lastname: "Phạm", department: null },
    },
    profiles: [
      { id: "p1", employee: "101", employment_type: "E", pit_method: "P", tax_code: "0101", personal_id: "001090000001", department: "10" },
      { id: "p2", employee: "102", employment_type: "E", pit_method: "P", tax_code: "", department: null },
      { id: "p3", employee: "103", employment_type: "C", pit_method: "F", tax_code: "0103", department: "20" },
      { id: "p4", employee: "104", employment_type: "E", pit_method: "P", tax_code: "0104", department: null },
    ],
  });
  const month = (k) => [
    { employee: 101, gross: 30000000 + k, ee_ins: 3150000, er_ins: 6450000, pit: 1200000, net: 25650000 + k, taxable: 30000000, assessable: 15850000, accrued13: 2500000 },
    { employee: 102, gross: 12000000, ee_ins: 1260000, er_ins: 2580000, pit: 0, net: 10740000, taxable: 12000000, advance: 500000 },
    { employee: 103, gross: 15000000, pit: 1500000, net: 13500000, taxable: 15000000 },
  ];
  addBatch(1, 1, "R", month(0), { journal: "501" });
  addBatch(2, 2, "R", month(0), { journal: "502" });
  addBatch(3, 3, "R", month(0).concat([{ employee: 104, gross: 8000000, net: 8000000, taxable: 8000000, pit: 0 }]), { journal: "503" });
  addBatch(4, 4, "C", month(1000000));
  addBatch(5, 4, "V", month(0));
  addBatch(6, 4, "B", []);
  addBatch(7, 9, "R", month(0), { journal: "499" });
  addBatch(8, 4, "R", month(0), { subsidiary: "14" });
});

describe("routes", () => {
  test("bốn route GET, vai trò payroll, không có POST", () => {
    expect(Object.keys(Hub.routes.get)).toEqual(["reportsCatalog", "reportsHtkk", "reportsFund", "reportsPitLedger"]);
    for (const r of Object.values(Hub.routes.get)) expect(r.roles).toBe("payroll");
    expect(Hub.routes.post).toEqual({});
  });
});

describe("reportsCatalog", () => {
  test("kỳ gần nhất đã tính / đã ghi sổ của công ty con, hai truy vấn", () => {
    const c = Hub.routes.get.reportsCatalog.run({ subsidiary: "13" });
    expect(c.latest).toEqual({ calculated: "202704", released: "202703" });
    expect(c.today).toBe("2027-05-10");
    expect(c.months.map((m) => [m.taxMonth, m.batches, m.released])).toEqual([["202704", 1, 0], ["202703", 1, 1], ["202702", 1, 1], ["202701", 1, 1], ["202612", 1, 1]]);
    const by = Object.fromEntries(c.items.map((i) => [i.key, i]));
    expect(by.insurance.period).toEqual({ taxMonth: "202704" });
    expect(by.cost.period).toEqual({ taxMonth: "202703" });
    expect(by.pitq).toMatchObject({ period: { year: 2027, quarter: 2 }, batches: 1, pending: 1 });
    expect(by.pita).toMatchObject({ period: { year: 2027 }, batches: 4, released: 3 });
    expect(c.printBatch).toMatchObject({ id: "4", name: "BL000004" });
    expect(db.calls).toEqual(["find:period", "find:batch"]);
  });

  test("công ty con khác và công ty con chưa có bảng lương", () => {
    expect(Hub.catalog({ subsidiary: "14" }).latest).toEqual({ calculated: "202704", released: "202704" });
    const e = Hub.catalog({ subsidiary: "99" });
    expect(e.items.every((i) => !i.hasData)).toBe(true);
    expect(e.items.find((i) => i.key === "fund").period).toEqual({ taxMonth: "202705" });
  });
});

describe("reportsHtkk", () => {
  test("05/KK-TNCN: chỉ tiêu của tờ khai quý kèm người nộp thuế", () => {
    const s = Hub.routes.get.reportsHtkk.run({ subsidiary: "13", form: "05kk", year: "2027", quarter: "1" });
    expect(s).toMatchObject({ form: "05/KK-TNCN", year: 2027, quarter: 1, taxpayer: { name: "Công ty TNHH S4VN Test", taxId: "0312345678" }, releasedOnly: false });
    const v = Object.fromEntries(s.rows.map((r) => [r.code, r.value]));
    // quý 1: 3 tháng x (101, 102, 103) + 104 tháng 3
    expect([v["[16]"], v["[17]"], v["[18]"], v["[21]"], v["[29]"]]).toEqual([4, 3, 2, 179000000, 8100000]);
    expect(s.notes).toEqual(["UNRELEASED_INCLUDED", "NOT_COMPUTED"]);
  });

  test("releasedOnly bỏ bảng chưa ghi sổ; quý không có số liệu", () => {
    const all = Hub.htkk({ subsidiary: "13", form: "05kk", year: "2027", quarter: "2" });
    expect(all.rows.find((r) => r.code === "[29]").value).toBe(2700000);
    const rel = Hub.htkk({ subsidiary: "13", form: "05kk", year: "2027", quarter: "2", releasedOnly: "T" });
    expect(rel.rows.find((r) => r.code === "[29]").value).toBe(0);
    expect(rel.notes).toEqual(["NOT_COMPUTED", "NO_DATA"]);
  });

  test("05/QTT-TNCN: hai bảng kê của cả năm", () => {
    const t = Hub.htkk({ subsidiary: "13", form: "05QTT", year: "2027", releasedOnly: "T" });
    expect(t.form).toBe("05/QTT-TNCN");
    expect(t.tables.map((x) => [x.schedule, x.rows.map((r) => r.employeeCode)])).toEqual([["05-1/BK", ["E101", "E102", "E104"]], ["05-2/BK", ["E103"]]]);
    expect(t.tables[0].rows[0]).toMatchObject({ stt: 1, employeeName: "Nguyễn An", taxCode: "0101", periods: 3, taxableIncome: 90000000, pit: 3600000 });
    expect(t.tables[0].summary).toMatchObject({ people: 3, withheld: 1, noTaxCode: 1 });
    expect(t.notes).toEqual(["NO_TAX_CODE"]);
  });

  test("không đọc được mã số thuế thì vẫn có tên; không đọc được gì thì để trống", () => {
    db.failTaxpayer = true;
    expect(Hub.taxpayer("13")).toEqual({ name: "S4VN Test", taxId: "" });
    expect(Hub.htkk({ subsidiary: "13", form: "05kk", year: "2027", quarter: "1" }).notes).toContain("NO_TAX_ID");
    db.failTaxpayer = "all";
    expect(Hub.taxpayer("13")).toEqual({ name: "", taxId: "" });
    expect(Hub.taxpayer("")).toEqual({ name: "", taxId: "" });
    db.failTaxpayer = false;
    expect(Hub.taxpayer("14")).toEqual({ name: "Sao Mai", taxId: "" });
  });

  test("mẫu lạ, thiếu năm", () => {
    expect(() => Hub.htkk({ subsidiary: "13", form: "01gtgt", year: "2027" })).toThrow(/Mẫu tờ khai không hợp lệ/);
    expect(() => Hub.htkk({ subsidiary: "13", form: "05kk", year: "", quarter: "1" })).toThrow();
  });
});

describe("reportsFund", () => {
  test("tháng: gom theo phòng ban (hồ sơ lương, trống thì hồ sơ nhân viên) x loại lao động", () => {
    const f = Hub.routes.get.reportsFund.run({ subsidiary: "13", taxMonth: "202703" });
    expect(f.period).toEqual({ kind: "month", taxMonth: "202703" });
    expect(f.rows.map((r) => [r.departmentName, r.employmentType, r.headcount, r.gross])).toEqual([["Kế toán", "E", 1, 30000000], ["Sản xuất", "E", 1, 12000000], ["Sản xuất", "C", 1, 15000000], ["", "E", 1, 8000000]]);
    expect(f.rows[0]).toMatchObject({ erIns: 6450000, accrued13: 2500000, cost: 38950000, net: 25650000 });
    expect(f.totals).toMatchObject({ headcount: 4, gross: 65000000, net: 57890000, advance: 500000, cost: 76530000 });
    expect(f.warnings.map((w) => w.code)).toEqual(["NO_DEPARTMENT"]);
    expect(f).toMatchObject({ batches: 1, pending: 0, releasedOnly: false });
  });

  test("số truy vấn cố định, không đọc chi tiết dòng", () => {
    Hub.fund({ subsidiary: "13", taxMonth: "202703" });
    expect(db.calls).toEqual(["find:period", "find:batch", "run:s4vp_rh_fund", "run:s4vp_rh_fund_head", "run:s4vp_rh_dept"]);
    expect(db.sql.s4vp_rh_fund).toMatch(/GROUP BY/);
    expect(db.sql.s4vp_rh_fund).not.toMatch(/detail/);
    expect(db.sql.s4vp_rh_fund).toMatch(/IN \(3\)/);
  });

  test("quý và năm: số người không trùng ở dòng tổng; releasedOnly; bảng đảo và công ty con khác không tính", () => {
    const q = Hub.fund({ subsidiary: "13", year: "2027", quarter: "1" });
    expect(q.period).toEqual({ kind: "quarter", year: 2027, quarter: 1 });
    expect(q.totals).toMatchObject({ headcount: 4, gross: 179000000 });
    expect(q.rows.find((r) => r.departmentName === "Kế toán")).toMatchObject({ headcount: 1, gross: 90000000, avgGross: 90000000 });
    const y = Hub.fund({ subsidiary: "13", year: "2027" });
    expect(y).toMatchObject({ batches: 4, pending: 1 });
    expect(y.totals.gross).toBe(237000000);
    expect(Hub.fund({ subsidiary: "13", year: "2027", releasedOnly: "T" }).totals.gross).toBe(179000000);
    expect(db.sql.s4vp_rh_fund).toMatch(/IN \(1,2,3\)/);
  });

  test("vai trò không nối được bảng employee: chỉ phòng ban của hồ sơ lương; không đọc được tên phòng ban thì hiện id", () => {
    db.failEmployeeJoin = true;
    db.failDept = true;
    const f = Hub.fund({ subsidiary: "13", taxMonth: "202703" });
    expect(f.rows.map((r) => [r.departmentName, r.employmentType, r.headcount])).toEqual([["10", "E", 1], ["20", "C", 1], ["", "E", 2]]);
    expect(f.totals.gross).toBe(65000000);
  });

  test("kỳ không có bảng lương: bảng rỗng, không truy vấn dòng; tham số sai", () => {
    const e = Hub.fund({ subsidiary: "13", taxMonth: "2028-01" });
    expect(e).toMatchObject({ rows: [], batches: 0, period: { taxMonth: "202801" } });
    expect(db.calls).toEqual(["find:period", "find:batch"]);
    expect(() => Hub.fund({ subsidiary: "13", taxMonth: "202713" })).toThrow(/yyyyMM/);
    expect(() => Hub.fund({ subsidiary: "13", year: "2027", quarter: "5" })).toThrow(/Quý/);
    expect(() => Hub.fund({ subsidiary: "13" })).toThrow(/Thiếu năm/);
  });
});

describe("reportsPitLedger", () => {
  test("mỗi người một dòng theo tháng tính thuế; kèm mã số thuế của hồ sơ lương", () => {
    const g = Hub.routes.get.reportsPitLedger.run({ subsidiary: "13", year: "2027" });
    expect(g.rows.map((r) => r.employeeCode)).toEqual(["E101", "E102", "E103", "E104"]);
    expect(g.rows[0]).toMatchObject({ employeeName: "Nguyễn An", taxCode: "0101", pit01: 1200000, pit04: 1200000, pit05: null, pitTotal: 4800000, taxableTotal: 120000000 });
    expect(g.rows[2]).toMatchObject({ employmentType: "C", pitTotal: 6000000 });
    expect(g.rows[3]).toMatchObject({ pit03: 0, pit01: null, taxableTotal: 8000000 });
    expect(g.totals.pitTotal).toBe(10800000);
    expect(g.months).toEqual([1, 2, 3, 4]);
    expect(g).toMatchObject({ year: 2027, batches: 4, pending: 1, warnings: [] });
  });

  test("releasedOnly; năm khác; số truy vấn cố định", () => {
    expect(Hub.pitLedger({ subsidiary: "13", year: "2027", releasedOnly: "T" }).totals.pitTotal).toBe(8100000);
    db.calls.length = 0;
    const old = Hub.pitLedger({ subsidiary: "13", year: "2026" });
    expect(old.rows.map((r) => [r.employeeCode, r.pit12])).toEqual([["E101", 1200000], ["E102", 0], ["E103", 1500000]]);
    expect(db.calls).toEqual(["find:period", "find:batch", "run:s4vp_rh_pit_ledger"]);
    db.calls.length = 0;
    expect(Hub.pitLedger({ subsidiary: "13", year: "2030" }).rows).toEqual([]);
    expect(db.calls).toEqual(["find:period", "find:batch"]);
    expect(() => Hub.pitLedger({ subsidiary: "13", year: "abc" })).toThrow(/Thiếu năm/);
  });

  test("cảnh báo người đã khấu trừ nhưng thiếu mã số thuế", () => {
    db.profiles.find((p) => p.employee === "103").tax_code = "";
    const g = Hub.pitLedger({ subsidiary: "13", year: "2027" });
    expect(g.warnings).toEqual([expect.objectContaining({ code: "NO_TAX_CODE", count: 1 })]);
  });

  test("một truy vấn gom nhóm: tháng xoay thành cột, JOIN hồ sơ lương theo khóa chính, chỉ cột cần, không tham số ràng buộc", () => {
    Hub.pitLedger({ subsidiary: "13", year: "2027" });
    const sql = db.sql.s4vp_rh_pit_ledger;
    // Bốn tháng có bảng lương dùng được (1, 2, 3, 4): mỗi tháng ba cột (số dòng, TNCT, thuế)
    expect(sql.match(/SUM\(CASE WHEN/g)).toHaveLength(12);
    expect(sql).toMatch(/IN \(4\) THEN l\.custrecord_s4vp_be_pit ELSE 0 END\) AS pit04/);
    expect(sql).toMatch(/WHERE l\.isinactive = 'F' AND l\.custrecord_s4vp_be_batch IN \(1,2,3,4\) GROUP BY/);
    // Hồ sơ lương: chỉ mã số thuế và loại lao động, nối theo p.id = l.profile (không lọc theo danh sách id nhân viên)
    expect(sql).toMatch(/MAX\(p\.custrecord_s4vp_em_tax_code\) AS tax_code/);
    expect(sql).not.toMatch(/p\.custrecord_s4vp_em_employee IN/);
    expect(sql).not.toMatch(/SELECT \*|personal_id|bank|detail/);
  });

  test("900 nhân viên: vẫn một truy vấn, câu lệnh không dài theo số người, kết quả như tính từng dòng", () => {
    for (let i = 0; i < 900; i++) {
      const emp = String(5000 + i);
      db.employees[emp] = { entityid: `T${5000 + i}`, firstname: "Thử", lastname: `Nhân viên ${i}`, department: "20" };
      db.profiles.push({ id: `px${i}`, employee: emp, employment_type: i % 10 ? "E" : "C", tax_code: i % 7 ? `08${i}` : "" });
      for (const b of ["1", "2", "3"]) db.lines.push({ id: `x${b}-${i}`, batch: b, employee: emp, profile: `px${i}`, employment_type: i % 10 ? "E" : "C", taxable: 10000000 + i, pit: i % 3 ? 100000 + i : 0, gross: 0 });
    }
    db.calls.length = 0;
    const g = Hub.pitLedger({ subsidiary: "13", year: "2027" });
    expect(db.calls).toEqual(["find:period", "find:batch", "run:s4vp_rh_pit_ledger"]);
    expect(db.sql.s4vp_rh_pit_ledger.length).toBeLessThan(2500);
    expect(g.rows).toHaveLength(904);
    const one = g.rows.find((r) => r.employeeCode === "T5001");
    expect(one).toMatchObject({ employeeName: "Nhân viên 1 Thử", taxCode: "081", employmentType: "E", periods: 3, pit01: 100001, pit04: null, pitTotal: 300003, taxableTotal: 30000003 });
    expect(g.rows.find((r) => r.employeeCode === "T5000")).toMatchObject({ employmentType: "C", taxCode: "", pitTotal: 0, pit02: 0 });
    // Người đã khấu trừ thuế nhưng thiếu mã số thuế (i chia hết cho 7, không chia hết cho 3)
    const noCode = Array.from({ length: 900 }, (x, i) => i).filter((i) => i % 7 === 0 && i % 3 !== 0).length;
    expect(g.warnings).toEqual([expect.objectContaining({ code: "NO_TAX_CODE", count: noCode })]);
  });

  test("vai trò không nối được bảng employee: cùng truy vấn bỏ JOIN, họ tên đọc riêng; kết quả không đổi", () => {
    const before = Hub.pitLedger({ subsidiary: "13", year: "2027" });
    db.failEmployeeJoin = true;
    db.calls.length = 0;
    const after = Hub.pitLedger({ subsidiary: "13", year: "2027" });
    expect(db.calls).toEqual(["find:period", "find:batch", "run:s4vp_rh_pit_ledger", "run:s4vp_rh_pit_ledger_noemp", "run:s4vp_rh_emp"]);
    expect(after).toEqual(before);
  });
});
