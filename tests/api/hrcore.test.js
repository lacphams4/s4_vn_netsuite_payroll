// Mô-đun route api/HrCore (Nhân sự bản 2) với Store giả: danh sách phân trang phía máy chủ (số truy vấn không tăng theo số
// nhân viên), hồ sơ một người, hợp đồng, quyết định, người phụ thuộc. Không gọi NetSuite.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const mockDb = { role: "customrole_s4vp_hr", today: "2027-03-15", emps: [], data: {}, queries: [], sql: [], writes: [], saved: [], failOn: null, seq: 100 };
const db = mockDb;

jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ id: 5, roleId: mockDb.role }) }), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => mockDb.today }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/WorkPermits", () => ({ params: () => ({ reminderDays: 60 }) }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/AllocationPlans", () => ({ list: () => mockDb.data.versions || [] }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Profiles", () => ({
  save: (input) => {
    mockDb.saved.push(JSON.parse(JSON.stringify(input)));
    return { id: "p1" };
  },
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const Schema = require("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Schema");
  const table = (name) => (mockDb.data[name] = mockDb.data[name] || []);
  // Điều kiện kiểu Store.find: các mệnh đề nối bằng AND; "{f} = ?", "{f} IN (1,2)", "{f} IS NULL"
  const matcher = (where, params) => {
    const p = (params || []).slice();
    const tests = String(where || "").split(/\s+AND\s+/).filter(Boolean).map((c) => {
      let m = /^\{(\w+)\} = \?$/.exec(c);
      if (m) {
        const v = String(p.shift());
        return (r) => String(r[m[1]]) === v;
      }
      m = /^\{(\w+)\} IN \(([\d,]+)\)$/.exec(c);
      if (m) {
        const set = new Set(m[2].split(","));
        return (r) => set.has(String(r[m[1]]));
      }
      m = /^\{(\w+)\} IS NULL$/.exec(c);
      if (m) return (r) => r[m[1]] === null || r[m[1]] === undefined || r[m[1]] === "";
      throw new Error("fake Store: unsupported where " + c);
    });
    return (r) => tests.every((t) => t(r));
  };
  const page = (sql) => {
    const hi = Number((/ROWNUM <= (\d+)/.exec(sql) || [])[1]);
    const lo = Number((/rn > (\d+)/.exec(sql) || [])[1]);
    return mockDb.emps.slice(lo, hi).map((e, i) => Object.assign({ rn: lo + i + 1 }, e));
  };
  return {
    rec: (name) => {
      if (!Schema.records[name]) throw new Error("Unknown record " + name);
      return Schema.records[name];
    },
    idOf: (list, code) => {
      if (!Schema.lists[list] || !(code in Schema.lists[list].values)) throw new Error("no list value");
      return `${Object.keys(Schema.lists).indexOf(list) + 1}${Object.keys(Schema.lists[list].values).indexOf(code)}`;
    },
    codeOf: (list, id) => (id === null || id === undefined || id === "" ? null : String(id)),
    run: (sql, params, tag) => {
      mockDb.queries.push(tag);
      mockDb.sql.push({ tag, sql, params: params || [] });
      if (mockDb.failOn && mockDb.failOn.test(sql)) throw new Error("SuiteQL failed");
      if (tag === "s4vp_hr_counts") return [{ total: mockDb.emps.length, working: mockDb.emps.length - 1, probation: 2, expiring: 3, missing: 4, gone: 1 }];
      if (tag === "s4vp_hr_page") return page(sql);
      if (tag === "s4vp_hr_employee") {
        const id = (/e\.id = (\d+)/.exec(sql) || [])[1];
        return mockDb.emps.filter((e) => String(e.id) === id).map((e) => Object.assign({ subsidiary: 13, department: 2 }, e));
      }
      if (tag === "s4vp_hr_due_contracts") return mockDb.data.dueContracts || [];
      if (tag === "s4vp_hr_due_permits") return mockDb.data.duePermits || [];
      if (tag === "s4vp_hr_payslips") return mockDb.data.payslips || [];
      if (/^s4vp_hr_names_/.test(tag)) return ((/IN \(([\d,]+)\)/.exec(sql) || [])[1] || "").split(",").filter(Boolean).map((id) => ({ id, name: `${tag.slice(14)} ${id}` }));
      if (/^s4vp_hr_lk_/.test(tag)) return [{ id: 1, name: tag.slice(11) }];
      return [];
    },
    find: (name, opt = {}) => {
      mockDb.queries.push(`find_${name}`);
      if (!Schema.records[name]) throw new Error("Unknown record " + name);
      if (mockDb.failOn && mockDb.failOn.test(Schema.records[name].type)) throw new Error("record not deployed");
      return table(name).filter(matcher(opt.where, opt.params)).map((r) => Object.assign({}, r));
    },
    get: (name, id) => {
      mockDb.queries.push(`get_${name}`);
      const r = table(name).find((x) => x.id === String(id));
      return r ? Object.assign({}, r) : null;
    },
    create: (name, values) => {
      const id = String(++mockDb.seq);
      table(name).push(Object.assign({ id }, values));
      mockDb.writes.push({ op: "create", name, id, values });
      return id;
    },
    update: (name, id, values) => {
      Object.assign(table(name).find((x) => x.id === String(id)), values);
      mockDb.writes.push({ op: "update", name, id: String(id), values });
      return String(id);
    },
    submit: (name, id, values) => {
      Object.assign(table(name).find((x) => x.id === String(id)), values);
      mockDb.writes.push({ op: "submit", name, id: String(id), values });
    },
    remove: () => {
      throw new Error("HrCore must never delete");
    },
  };
});

const Hr = require(path.join(API, "HrCore"));

// Dòng nhân viên như truy vấn trang trả về (bí danh chữ thường); tax / bank chỉ là cờ T / F
const empRow = (i) => ({
  id: i, entityid: `E${String(i).padStart(4, "0")}`, firstname: `Tên${i}`, lastname: "Nguyễn", isinactive: "F", jobtitle: "Nhân viên", deptname: "Kế toán",
  pid: 1000 + i, etype: "E", hired: "2026-01-01", term: null, hastax: i % 2 ? "T" : "F", hasbank: "T", lastend: null, probation: i === 3 ? 1 : 0,
});
const seed = (n) => {
  db.emps = Array.from({ length: n }, (_, k) => empRow(k + 1));
  db.data = {
    employee: db.emps.map((e) => ({ id: String(e.pid), employee: String(e.id), subsidiary: "13", department: "2", tax_code: "TAXSECRET", personal_id: "IDSECRET", si_number: "SISECRET", bank_account: "BANKSECRET", bank_name: "VCB", hire_date: "2026-01-01", foreign: false })),
    compensation: db.emps.flatMap((e) => [
      { id: `c${e.id}a`, profile: String(e.pid), effective: "2026-01-01", base_salary: 20000000, insurance_wage: 10000000, allowance: 1000000, package: "5" },
      { id: `c${e.id}b`, profile: String(e.pid), effective: "2027-01-01", base_salary: 22000000 + e.id, insurance_wage: 11000000, allowance: 1000000, package: "5" },
    ]),
    contract: db.emps.map((e) => ({ id: String(5000 + e.id), employee: String(e.id), number: `HD${e.id}`, type: "F", parent: null, effective: "2027-01-01", expiry: "2027-12-31", status: "A", base_salary: 22000000 })),
    decision: [], dependent: [], work_permit: [], leave_balance: [], leave_type: [], benefit_pkg: [{ id: "5", name: "GOI1" }],
  };
  db.queries = [];
  db.sql = [];
  db.writes = [];
  db.saved = [];
  db.failOn = null;
  db.role = "customrole_s4vp_hr";
  db.seq = 100;
};

beforeEach(() => seed(30));

describe("routes", () => {
  test("đọc cho mọi vai trò lương, ghi chỉ HR; không có action xóa", () => {
    expect(Object.keys(Hr.routes.get).sort()).toEqual(["employeeCard", "employeesPage", "hrLookups"]);
    for (const r of Object.values(Hr.routes.get)) expect(r.roles).toBe("all");
    expect(Object.keys(Hr.routes.post).sort()).toEqual(["hrActivateContract", "hrApplyDecision", "hrSaveContract", "hrSaveDecision", "hrSaveDependent", "hrTerminateContract"]);
    for (const r of Object.values(Hr.routes.post)) expect(r.roles).toBe("hr");
    expect(Object.keys(Hr.routes.post).some((k) => /delete|remove/i.test(k))).toBe(false);
  });
});

describe("employeesPage", () => {
  test("trả một trang, số đếm theo bộ lọc, hợp đồng hiện tại và lương của đúng trang đó", () => {
    const r = Hr.employeesPage({ subsidiary: "13", pageSize: "10", page: "2" });
    expect(r.rows.length).toBe(10);
    expect(r.rows[0]).toMatchObject({ employee: "11", code: "E0011", name: "Nguyễn Tên11", department: "Kế toán", hasProfile: true, employmentType: "E", missingTax: false, missingBank: false, left: false });
    expect(r.rows[1].missingTax).toBe(true);
    expect(r.rows[0].contract).toEqual({ id: "5011", number: "HD11", type: "F", expiry: "2027-12-31", state: "A" });
    expect(r.rows[0].baseSalary).toBe(22000011);
    expect(r).toMatchObject({ total: 30, page: 2, pages: 3, pageSize: 10, counts: { all: 30, working: 29, probation: 2, expiring: 3, missing: 4, left: 1 }, canSeePay: true, canEdit: true, today: "2027-03-15", notes: [] });
    expect(r.due).toBeUndefined();
  });

  test("số truy vấn không tăng theo số nhân viên, và không tải hồ sơ cả công ty", () => {
    Hr.employeesPage({ subsidiary: "13", due: "1" });
    const small = db.queries.slice();
    seed(1000);
    const r = Hr.employeesPage({ subsidiary: "13", due: "1" });
    expect(db.queries).toEqual(small);
    expect(db.queries.length).toBeLessThanOrEqual(6);
    expect(r.rows.length).toBe(50);
    expect(r.total).toBe(1000);
    expect(r.pages).toBe(20);
    expect(db.queries).not.toContain("find_employee");
    // hợp đồng và lương chỉ đọc cho 50 người của trang
    const comp = db.sql.length;
    expect(comp).toBeGreaterThan(0);
    expect(JSON.stringify(r).length).toBeLessThan(40000);
  });

  test("câu lệnh: công ty con ghép thẳng dạng số, tên phòng ban bằng JOIN, từ khóa tìm đi bằng tham số, phân trang bằng ROWNUM", () => {
    Hr.employeesPage({ subsidiary: "13", q: "nguyễn  kế%toán", page: "3", pageSize: "10", filter: "working", sort: "name", dir: "desc" });
    const counts = db.sql.find((x) => x.tag === "s4vp_hr_counts");
    const page = db.sql.find((x) => x.tag === "s4vp_hr_page");
    expect(counts.sql).toMatch(/e\.subsidiary = 13/);
    expect(counts.sql).toMatch(/LEFT JOIN department d ON d\.id = e\.department/);
    expect(counts.sql).not.toMatch(/BUILTIN\.DF/);
    expect(counts.sql).toMatch(/LEFT JOIN customrecord_s4vp_employee p ON p\.custrecord_s4vp_em_employee = e\.id/);
    expect(counts.sql).toMatch(/FROM customrecord_s4vp_contract c/);
    // ba từ, mỗi từ bốn cột; đã bỏ dấu và bỏ ký tự đại diện
    expect(counts.params).toEqual(["NGUYEN", "KE", "TOAN"].flatMap((w) => Array(4).fill(`%${w}%`)));
    expect(counts.sql).not.toMatch(/NGUYEN|nguyễn/);
    expect(page.params).toEqual(counts.params);
    expect(page.sql).toMatch(/WHERE ROWNUM <= 30\) WHERE rn > 20$/);
    expect(page.sql).toMatch(/ORDER BY e\.firstname DESC NULLS LAST, e\.lastname, e\.entityid/);
    expect(counts.sql).toMatch(/tax_code IS NULL OR p\.custrecord_s4vp_em_bank_account IS NULL/);
    // không đọc giá trị mã số thuế, tài khoản: chỉ cờ có / không
    expect(page.sql).not.toMatch(/tax_code AS|bank_account AS|personal_id|si_number/);
  });

  test("tham số lạ bị chặn hoặc đưa về mặc định", () => {
    expect(() => Hr.employeesPage({ subsidiary: "13 OR 1=1" })).toThrow(/subsidiary/i);
    const r = Hr.employeesPage({ subsidiary: "13", filter: "x'; DROP", sort: "e.id; --", page: "-4", pageSize: "99999", days: "abc" });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(200);
    expect(r.days).toBe(30);
    expect(db.sql.find((x) => x.tag === "s4vp_hr_page").sql).toMatch(/AND 1 = 1 ORDER BY e\.entityid\) WHERE ROWNUM/);
    expect(Hr.employeesPage({}).rows).toEqual([]);
    expect(Hr.employeesPage({ subsidiary: "13", page: "99" }).page).toBe(1);
  });

  test("không lộ số định danh; vai trò ngoài nhóm lương không nhận số tiền và không đọc bảng lương", () => {
    const r = Hr.employeesPage({ subsidiary: "13", due: "1" });
    expect(JSON.stringify(r)).not.toMatch(/SECRET/);
    db.role = "customrole_other";
    db.queries = [];
    const r2 = Hr.employeesPage({ subsidiary: "13" });
    expect(r2.canSeePay).toBe(false);
    expect(r2.canEdit).toBe(false);
    expect(r2.rows.every((x) => !("baseSalary" in x))).toBe(true);
    expect(db.queries).not.toContain("find_compensation");
  });

  test("khung sắp đến hạn: hợp đồng, thử việc, giấy phép; sắp theo ngày, có số ngày còn lại", () => {
    db.data.dueContracts = [{ id: 1, emp: 7, ref: "HD7", ctype: "F", due: "2027-04-01", entityid: "E0007", firstname: "Tên7", lastname: "Nguyễn" }, { id: 2, emp: 3, ref: "TV3", ctype: "P", due: "2027-03-10", entityid: "E0003", firstname: "Tên3", lastname: "Nguyễn" }];
    db.data.duePermits = [{ id: 9, emp: 4, name: "WP9", permitno: "GP-9", due: "2027-03-20", entityid: "E0004", firstname: "Tên4", lastname: "Trần" }];
    const due = Hr.employeesPage({ subsidiary: "13", due: "1", days: "45" }).due;
    expect(due.items.map((x) => [x.kind, x.employeeCode, x.daysLeft, x.overdue])).toEqual([["probationEnd", "E0003", -5, true], ["permitExpiry", "E0004", 5, false], ["contractExpiry", "E0007", 17, false]]);
    expect(due).toMatchObject({ total: 3, days: 45, permitDays: 60 });
    const c = db.sql.find((x) => x.tag === "s4vp_hr_due_contracts").sql;
    expect(c).toMatch(/e\.subsidiary = 13/);
    expect(c).toMatch(/<= TO_DATE\('2027-04-29', 'YYYY-MM-DD'\)/);
    expect(c).toMatch(/NOT EXISTS/);
    expect(db.sql.find((x) => x.tag === "s4vp_hr_due_permits").sql).toMatch(/<= TO_DATE\('2027-05-14', 'YYYY-MM-DD'\)/);
  });

  test("account không hỗ trợ TRANSLATE: tìm có dấu, vẫn trả kết quả", () => {
    db.failOn = /TRANSLATE/;
    const r = Hr.employeesPage({ subsidiary: "13", q: "nguyễn" });
    expect(r.rows.length).toBe(30);
    expect(r.notes).toEqual(["NO_FOLD"]);
    expect(db.sql.filter((x) => x.tag === "s4vp_hr_counts").pop().params[0]).toBe("%NGUYỄN%");
  });

  test("record hợp đồng chưa deploy: danh sách vẫn chạy, không có cột hợp đồng", () => {
    db.failOn = /TRANSLATE|customrecord_s4vp_contract/;
    const r = Hr.employeesPage({ subsidiary: "13", due: "1" });
    expect(r.rows.length).toBe(30);
    expect(r.notes).toEqual(["NO_CONTRACTS", "NO_FOLD"]);
    expect(r.rows[0].contract).toBeNull();
    expect(db.queries).not.toContain("find_contract");
    expect(db.queries).not.toContain("s4vp_hr_due_contracts");
  });

  test("searchWords: tối đa 5 từ, bỏ dấu khi được yêu cầu", () => {
    expect(Hr.searchWords("  Đặng  thị_Hòa ", true)).toEqual(["DANG", "THI", "HOA"]);
    expect(Hr.searchWords("Đặng", false)).toEqual(["ĐẶNG"]);
    expect(Hr.searchWords("a b c d e f g", true).length).toBe(5);
    expect(Hr.searchWords(null, true)).toEqual([]);
  });
});

describe("employeeCard", () => {
  test("toàn cảnh một người: hồ sơ, lương, hợp đồng, dòng thời gian, việc đến hạn; không có số định danh", () => {
    db.data.contract.find((c) => c.employee === "7").expiry = "2027-04-01";
    db.data.dependent.push({ id: "d1", profile: "1007", name: "Nguyễn An", relationship: "Con", from: "2027-01-01", to: null, tax_code: "DEPSECRET" });
    db.data.decision.push({ id: "q1", employee: "7", number: "QD1", type: "T", status: "A", effective: "2027-02-01", old_department: "2", new_department: "3", new_title: "Trưởng nhóm" });
    db.data.payslips = [{ id: 71, batch: 8, docnumber: "BL000008", status: "R", period: "2027-02", periodend: "2027-02-28", gross: 30000000, eeins: 2000000, pit: 500000, net: 27500000 }];
    db.data.leave_type = [{ id: "1", name: "PN", description: "Phép năm" }];
    db.data.leave_balance = [{ id: "b1", employee: "7", year: 2027, leave_type: "1", entitled: 12, carried: 2, adjusted: 0, used: 3, pending: 1 }];
    const r = Hr.employeeCard({ id: "7" });
    expect(r.employee).toMatchObject({ id: "7", code: "E0007", name: "Nguyễn Tên7", departmentName: "Kế toán" });
    expect(r.profile).toMatchObject({ id: "1007", hasTaxCode: true, hasPersonalId: true, hasSiNumber: true, hasBank: true, departmentName: "department 2" });
    expect(JSON.stringify(r)).not.toMatch(/SECRET/);
    expect(r.title).toBe("Trưởng nhóm");
    expect(r.compensation.current).toMatchObject({ effective: "2027-01-01", base_salary: 22000007, packageName: "GOI1" });
    expect(r.compensation.history.map((h) => h.effective)).toEqual(["2027-01-01", "2026-01-01"]);
    expect(r.contracts[0]).toMatchObject({ number: "HD7", state: "A", current: true, isAppendix: false });
    expect(r.currentContract).toBe("5007");
    expect(r.decisions[0]).toMatchObject({ oldDepartmentName: "department 2", newDepartmentName: "department 3" });
    expect(r.dependents[0]).toMatchObject({ name: "Nguyễn An", hasTaxCode: true, active: true });
    expect(r.due).toEqual([expect.objectContaining({ kind: "contractExpiry", daysLeft: 17 })]);
    expect(r.timeline.some((e) => e.kind === "decision" && e.newDepartmentName === "department 3")).toBe(true);
    expect(r.payslips).toEqual([{ line: "71", batch: "8", number: "BL000008", status: "R", period: "2027-02", periodEnd: "2027-02-28", gross: 30000000, eeIns: 2000000, pit: 500000, net: 27500000 }]);
    expect(r.leave).toEqual({ year: 2027, balances: [expect.objectContaining({ leaveTypeCode: "PN", leaveTypeName: "Phép năm", available: 10 })] });
    // bảng lương đọc bằng một truy vấn có giới hạn 6 dòng, không đọc chi tiết JSON
    const slip = db.sql.find((x) => x.tag === "s4vp_hr_payslips").sql;
    expect(slip).toMatch(/WHERE ROWNUM <= 6$/);
    expect(slip).not.toMatch(/detail/);
  });

  test("vai trò ngoài nhóm lương: không có số tiền ở bất kỳ phần nào", () => {
    db.role = "customrole_other";
    db.data.decision.push({ id: "q1", employee: "7", number: "QD1", type: "S", status: "A", effective: "2027-02-01", old_salary: 20000000, new_salary: 23456789 });
    db.data.payslips = [{ id: 71, batch: 8, docnumber: "BL8", status: "R", period: "2027-02", periodend: "2027-02-28", gross: 30000000, eeins: 1, pit: 1, net: 27500000 }];
    const r = Hr.employeeCard({ id: "7" });
    const text = JSON.stringify(r);
    expect(r.compensation).toEqual({ current: null, history: [], hidden: true });
    expect(text).not.toMatch(/22000007|20000000|23456789|27500000|30000000|base_salary|new_salary/);
    expect(r.contracts.length).toBe(1);
    expect(r.payslips[0]).toEqual({ line: "71", batch: "8", number: "BL8", status: "R", period: "2027-02", periodEnd: "2027-02-28" });
  });

  test("chưa có hồ sơ lương, record hợp đồng chưa deploy: vẫn mở được", () => {
    db.data.employee = [];
    db.failOn = /customrecord_s4vp_contract/;
    const r = Hr.employeeCard({ id: "7" });
    expect(r.profile).toBeNull();
    expect(r.notes).toEqual(["NO_CONTRACTS"]);
    expect(r.contracts).toEqual([]);
    expect(r.timeline).toEqual([]);
    expect(() => Hr.employeeCard({ id: "999" })).toThrow(/Employee not found/);
    expect(() => Hr.employeeCard({ id: "7; DROP" })).toThrow();
  });

  test("hrLookups trả bốn danh mục", () => {
    const r = Hr.hrLookups();
    expect(Object.keys(r)).toEqual(["departments", "locations", "classes", "projects"]);
    expect(r.departments).toEqual([{ id: "1", name: "department" }]);
  });
});

describe("hợp đồng", () => {
  const values = (o) => Object.assign({ employee: "7", number: "HD-NEW", type: "F", sign_date: "2027-12-20", effective: "2028-01-01", expiry: "2028-12-31", base_salary: 25000000 }, o);

  test("lưu nháp rồi kích hoạt; gắn hồ sơ lương; chỉ nhận trường cho phép", () => {
    const r = Hr.saveContract({ values: values({ status: "A", terminated: "2028-01-01", hacker: 1 }) });
    expect(r).toMatchObject({ status: "D", warnings: [] });
    const row = db.data.contract.find((c) => c.id === r.id);
    expect(row).toMatchObject({ employee: "7", number: "HD-NEW", status: "D", profile: "1007", expiry: "2028-12-31" });
    expect(row.terminated).toBeUndefined();
    expect(row.hacker).toBeUndefined();
    expect(Hr.activateContract({ id: r.id })).toEqual({ id: r.id, status: "A" });
    expect(() => Hr.activateContract({ id: r.id })).toThrow(/Only draft/);
  });

  test("chồng lấn: nháp chỉ cảnh báo, kích hoạt thì từ chối và nêu số hợp đồng", () => {
    const r = Hr.saveContract({ values: values({ effective: "2027-06-01", expiry: "2028-05-31" }) });
    expect(r.warnings.map((w) => w.code)).toEqual(["OVERLAP"]);
    expect(r.warnings[0].messageVi).toMatch(/HD7/);
    expect(() => Hr.activateContract({ id: r.id })).toThrow(/overlaps another contract \(HD7\)/);
    expect(() => Hr.saveContract({ values: values({ effective: "2027-06-01", expiry: "2028-05-31" }), activate: true })).toThrow(/overlaps/);
    expect(db.data.contract.filter((c) => c.employee === "7" && c.status === "A").length).toBe(1);
  });

  test("lỗi nhập liệu trả thông báo hai ngôn ngữ, không ghi gì", () => {
    let err = null;
    try {
      Hr.saveContract({ values: values({ type: "P", expiry: "" }) });
    } catch (e) {
      err = e;
    }
    expect(err.userMessage.vi).toMatch(/phải có ngày kết thúc/);
    expect(err.userMessage.en).toMatch(/needs an end date/);
    expect(db.writes).toEqual([]);
    expect(() => Hr.saveContract({ values: values({ employee: "" }) })).toThrow(/Employee is required/);
  });

  test("phụ lục: thuộc hợp đồng gốc của cùng nhân viên, không có loại, không kiểm chồng lấn", () => {
    const r = Hr.saveContract({ values: { employee: "7", parent: "5007", number: "PL01", type: "F", effective: "2027-07-01", base_salary: 24000000 }, activate: true });
    expect(db.data.contract.find((c) => c.id === r.id)).toMatchObject({ parent: "5007", type: null, status: "A" });
    expect(() => Hr.saveContract({ values: { employee: "8", parent: "5007", effective: "2027-07-01" } })).toThrow(/main contract/);
    expect(() => Hr.saveContract({ values: { employee: "7", parent: "5007", effective: "2028-07-01" } })).toThrow(/outside the term/);
  });

  test("hợp đồng đã duyệt chỉ sửa được số, ngày ký, ghi chú", () => {
    const r = Hr.saveContract({ values: { id: "5007", number: "HD7-A", expiry: "2030-01-01", base_salary: 1, note: "scan" } });
    expect(r.status).toBe("A");
    expect(db.data.contract.find((c) => c.id === "5007")).toMatchObject({ number: "HD7-A", expiry: "2027-12-31", base_salary: 22000000, note: "scan" });
  });

  test("chấm dứt: chỉ hợp đồng đang hiệu lực, ngày trong thời hạn; không xóa bản ghi", () => {
    expect(() => Hr.terminateContract({ id: "5007", date: "2028-02-01" })).toThrow(/outside the contract term/);
    expect(Hr.terminateContract({ id: "5007", date: "2027-06-30", reason: "Thỏa thuận" })).toEqual({ id: "5007", status: "T", terminated: "2027-06-30" });
    expect(db.data.contract.find((c) => c.id === "5007")).toMatchObject({ status: "T", terminated: "2027-06-30", term_reason: "Thỏa thuận" });
    expect(() => Hr.terminateContract({ id: "5007", date: "2027-06-30" })).toThrow(/Only active/);
    expect(() => Hr.terminateContract({ id: "424242", date: "2027-06-30" })).toThrow(/not found/);
  });
});

describe("quyết định", () => {
  test("lưu nháp chụp lại phòng ban, chức danh, lương cũ tại ngày hiệu lực; chưa đổi hồ sơ", () => {
    db.data.contract.find((c) => c.id === "5007").title = "Kế toán viên";
    const r = Hr.saveDecision({ values: { employee: "7", number: "QD-01", type: "S", effective: "2027-04-01", new_salary: 25000000, status: "A", old_salary: 1 } });
    expect(r).toEqual({ id: r.id, status: "D", warnings: [] });
    expect(db.data.decision.find((d) => d.id === r.id)).toMatchObject({ status: "D", profile: "1007", old_department: "2", old_title: "Kế toán viên", old_salary: 22000007, old_ins_wage: 11000000, old_allowance: 1000000, new_salary: 25000000 });
    expect(db.saved).toEqual([]);
  });

  test("áp dụng điều chỉnh lương: ghi qua Profiles.save với dòng lương kế thừa phần không đổi; sau đó khóa", () => {
    const r = Hr.saveDecision({ values: { employee: "7", type: "S", effective: "2027-04-01", new_salary: 25000000 }, apply: true });
    expect(r).toMatchObject({ status: "A", applied: { profile: [], compensation: true, contracts: 0 } });
    expect(db.saved).toEqual([{ employee: "7", subsidiary: "13", profile: {}, compensation: { effective: "2027-04-01", base_salary: 25000000, insurance_wage: 11000000, allowance: 1000000, package: "5" } }]);
    expect(db.data.decision.find((d) => d.id === r.id)).toMatchObject({ status: "A", applied_date: "2027-03-15", applied_by: "5" });
    // không tự ghi bảng lịch sử lương, hồ sơ lương
    expect(db.writes.some((w) => w.name === "compensation" || w.name === "employee")).toBe(false);
    expect(() => Hr.applyDecision({ id: r.id })).toThrow(/already applied/);
    expect(() => Hr.saveDecision({ values: { id: r.id, new_salary: 1 } })).toThrow(/cannot be edited/);
    expect(JSON.stringify(r)).not.toMatch(/25000000/);
  });

  test("điều chuyển đổi phòng ban của hồ sơ; khen thưởng không gọi Profiles.save", () => {
    const t = Hr.saveDecision({ values: { employee: "7", type: "T", effective: "2027-04-01", new_department: "9", new_title: "Trưởng nhóm" } });
    expect(Hr.applyDecision({ id: t.id }).applied).toEqual({ profile: ["department"], compensation: false, contracts: 0 });
    expect(db.saved).toEqual([{ employee: "7", subsidiary: "13", profile: { department: "9" } }]);
    db.saved = [];
    const k = Hr.saveDecision({ values: { employee: "7", type: "R", effective: "2027-04-01", note: "Thưởng quý" }, apply: true });
    expect(k.status).toBe("A");
    expect(db.saved).toEqual([]);
  });

  test("chấm dứt: đặt ngày làm việc cuối và chấm dứt hợp đồng đang hiệu lực (không đụng nháp, phụ lục)", () => {
    db.data.contract.push({ id: "6001", employee: "7", parent: "5007", effective: "2027-02-01", status: "A" }, { id: "6002", employee: "7", parent: null, type: "F", effective: "2028-01-01", expiry: "2028-12-31", status: "D" });
    const r = Hr.saveDecision({ values: { employee: "7", number: "QD-X", type: "X", effective: "2027-05-31" }, apply: true });
    expect(r.applied).toEqual({ profile: ["termination_date"], compensation: false, contracts: 1 });
    expect(db.saved[0].profile).toEqual({ termination_date: "2027-05-31" });
    expect(db.data.contract.find((c) => c.id === "5007")).toMatchObject({ status: "T", terminated: "2027-05-31", term_reason: "QD-X" });
    expect(db.data.contract.find((c) => c.id === "6001").status).toBe("A");
    expect(db.data.contract.find((c) => c.id === "6002").status).toBe("D");
  });

  test("chưa có hồ sơ lương thì không áp dụng được thay đổi hồ sơ; quyết định vẫn là nháp", () => {
    db.data.employee = db.data.employee.filter((p) => p.employee !== "7");
    const r = Hr.saveDecision({ values: { employee: "7", type: "T", effective: "2027-04-01", new_department: "9" } });
    expect(() => Hr.applyDecision({ id: r.id })).toThrow(/no payroll profile/);
    expect(db.data.decision.find((d) => d.id === r.id).status).toBe("D");
    expect(() => Hr.saveDecision({ values: { employee: "7", type: "S", effective: "2027-04-01" } })).toThrow(/new salary is required/);
  });
});

describe("người phụ thuộc", () => {
  test("thêm mới đi qua Profiles.save; trùng tên và ngày thì từ chối; thiếu tên, ngày thì báo lỗi", () => {
    const r = Hr.saveDependent({ employee: "7", values: { name: " Nguyễn An ", relationship: "Con", birth_date: "2020-05-01", tax_code: "", from: "2027-01-01", to: "" } });
    expect(r).toEqual({ created: true, updated: false });
    expect(db.saved).toEqual([{ employee: "7", subsidiary: "13", profile: {}, dependents: [{ name: "Nguyễn An", relationship: "Con", birth_date: "2020-05-01", from: "2027-01-01" }] }]);
    db.data.dependent.push({ id: "d1", profile: "1007", name: "Nguyễn An", from: "2027-01-01", tax_code: "DEPSECRET" });
    expect(() => Hr.saveDependent({ employee: "7", values: { name: "nguyễn an", from: "2027-01-01" } })).toThrow(/already registered/);
    expect(() => Hr.saveDependent({ employee: "7", values: { name: "", from: "2027-01-01" } })).toThrow(/name is required/);
    expect(() => Hr.saveDependent({ employee: "7", values: { name: "A" } })).toThrow(/start date is required/);
    expect(() => Hr.saveDependent({ employee: "7", values: { name: "A", from: "2027-02-01", to: "2027-01-01" } })).toThrow(/before the effective date/);
  });

  test("sửa: kết thúc giảm trừ, ô mã số thuế trống thì giữ nguyên; không sửa được người của hồ sơ khác", () => {
    db.data.dependent.push({ id: "d1", profile: "1007", name: "Nguyễn An", from: "2027-01-01", tax_code: "DEPSECRET" }, { id: "d2", profile: "1008", name: "Khác", from: "2027-01-01" });
    expect(Hr.saveDependent({ employee: "7", values: { id: "d1", to: "2027-06-30", tax_code: "" } })).toEqual({ id: "d1", created: false, updated: true });
    expect(db.data.dependent.find((d) => d.id === "d1")).toMatchObject({ to: "2027-06-30", tax_code: "DEPSECRET" });
    expect(() => Hr.saveDependent({ employee: "7", values: { id: "d2", to: "2027-06-30" } })).toThrow(/not found/);
    expect(db.saved).toEqual([]);
  });
});
