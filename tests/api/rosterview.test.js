// api/RosterView (màn Xếp ca) với Store giả trong bộ nhớ, Lean / PayGroupPeriods / lõi thật. Kiểm: dạng phản hồi rosterView
// (nhân viên của công ty con đang làm việc, lọc theo tổ, ô nén, kỳ khóa theo nhóm lương), rosterCells (tạo / sửa / không đổi,
// ô mới nhận chi nhánh của tổ, giữ chi nhánh ô cũ), chặn kỳ khóa đúng nhóm lương, chặn nhân viên công ty khác, ca ngừng dùng,
// quyền khai trên route, không có khóa "error".
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const mockDb = { t: {}, seq: 5000 };

jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ id: 5, roleId: "customrole_s4vp_hr" }) }), { virtual: true });
jest.mock("N/query", () => ({}), { virtual: true });
jest.mock("N/record", () => ({}), { virtual: true });
jest.mock("N/format", () => ({}), { virtual: true });
jest.mock("N/cache", () => ({}), { virtual: true });

jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const rows = (name) => mockDb.t[name] || (mockDb.t[name] = []);
  const copy = (r) => JSON.parse(JSON.stringify(r));
  const emp = (id) => (mockDb.t.emp || []).find((e) => String(e.id) === String(id)) || {};
  function find(name, opt = {}) {
    let list = rows(name).filter((r) => opt.includeInactive || !r.isInactive);
    const w = opt.where || "";
    const p = opt.params || [];
    if (/^\{employee\} IN \(/.test(w)) {
      const want = new Set(p.map(String));
      list = list.filter((r) => want.has(String(r.employee)));
    }
    return copy(list);
  }
  return {
    find,
    findIn: (name, field, ids) => {
      const want = new Set((ids || []).map(String));
      return copy(rows(name).filter((x) => !x.isInactive && want.has(String(x[field]))));
    },
    get: (name, id) => copy(rows(name).filter((x) => String(x.id) === String(id)))[0] || null,
    codeOf: (list, v) => v,
    run: (sql, params, tag) => {
      if (tag === "s4vp_roster_profiles") {
        const [sub, from, to] = [String(params[0]), params[1], params[2]];
        return rows("employee")
          .filter((p) => String(p.subsidiary) === sub && (!p.hire_date || p.hire_date <= to) && (!p.termination_date || p.termination_date >= from))
          .filter((p) => !p.isInactive || (p.termination_date && p.termination_date >= from && p.termination_date <= to))
          .map((p) => {
            const e = emp(p.employee);
            return {
              id: p.id, c_isinactive: p.isInactive ? "T" : "F", c_employee: p.employee, c_subsidiary: p.subsidiary, c_paygroup: p.paygroup || null,
              c_hire_date: p.hire_date || null, c_termination_date: p.termination_date || null, e_code: e.entityid, e_first: e.firstname, e_last: e.lastname, e_dept: e.dept, e_dept_id: e.deptId || null,
            };
          });
      }
      if (tag === "s4vp_roster_cells") {
        return rows("roster")
          .filter((r) => !r.isInactive && r.work_date >= params[0] && r.work_date <= params[1])
          .map((r) => ({ id: r.id, c_employee: r.employee, c_work_date: r.work_date, c_shift: r.shift || null, c_source: r.source || null }));
      }
      if (tag === "s4vp_er_dept") return (mockDb.t.emp || []).map((e) => ({ id: e.id, department: e.deptId || null }));
      throw new Error(`Unexpected query ${tag}`);
    },
    create: (name, values) => {
      const id = String(++mockDb.seq);
      rows(name).push(Object.assign({ id }, values));
      return id;
    },
    submit: (name, id, values) => Object.assign(rows(name).find((r) => String(r.id) === String(id)), values),
    update: (name, id, values) => Object.assign(rows(name).find((r) => String(r.id) === String(id)), values),
  };
});
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({
  resolve: () => ({ weeklyOffDays: "0" }),
  holidays: () => [{ date: "2026-12-03" }],
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Shifts", () => ({
  shifts: () => [
    { id: "5", code: "C1", description: "Ca 1", startTime: "06:00", endTime: "14:00", breakMinutes: 30, kind: "D", isActive: true },
    { id: "6", code: "C3", description: "Ca 3", startTime: "22:00", endTime: "06:00", breakMinutes: 30, kind: "N", isActive: true },
    { id: "7", code: "CU", description: "Ca cũ", startTime: "08:00", endTime: "17:00", breakMinutes: 60, kind: "D", isActive: false },
  ],
  patterns: () => [{ id: "9", code: "XOAY3", description: "3 ca", cycle: ["C1", "C1", null], isActive: true }],
}));

const RosterView = require(path.join(API, "RosterView"));
const ER = require(path.join(API, "EffectiveRoster"));

function seed() {
  mockDb.seq = 5000;
  mockDb.t = {
    paygroup: [{ id: "1", name: "DEFAULT" }, { id: "2", name: "SAOMAI", subsidiary: "14" }],
    period: [
      { id: "p1", name: "202612", paygroup: "1", start: "2026-12-01", end: "2026-12-31", att_status: "L", status: "O" },
      { id: "p2", name: "SAOMAI-202612", paygroup: "2", start: "2026-12-01", end: "2026-12-31", att_status: "O", status: "O" },
      { id: "p3", name: "SAOMAI-202611", paygroup: "2", start: "2026-11-01", end: "2026-11-30", att_status: "L", status: "O" },
    ],
    emp: [
      { id: "101", entityid: "E1017", firstname: "An", lastname: "Trần", dept: "Xưởng", deptId: "40" },
      { id: "102", entityid: "E1018", firstname: "Bình", lastname: "Lê", dept: "Xưởng", deptId: "40" },
      { id: "103", entityid: "E1019", firstname: "Chi", lastname: "Phạm", dept: "Kho" },
      { id: "201", entityid: "E0500", firstname: "Dũng", lastname: "Vũ", dept: "Kế toán" },
    ],
    employee: [
      { id: "a1", employee: "101", subsidiary: "14", paygroup: "2", hire_date: "2026-01-01" },
      { id: "a2", employee: "102", subsidiary: "14", paygroup: "2", hire_date: "2026-01-01" },
      { id: "a3", employee: "103", subsidiary: "14", paygroup: "2", hire_date: "2026-12-10" },
      { id: "a4", employee: "201", subsidiary: "13", paygroup: "1", hire_date: "2026-01-01" },
    ],
    team: [{ id: "t1", name: "to-cat", description: "Tổ Cắt", subsidiary: "14", location: "L7", work_center: "W3" }, { id: "t2", name: "TO-KHAC", subsidiary: "13" }],
    team_member: [
      { id: "m1", team: "t1", employee: "101", effective: "2026-01-01" },
      { id: "m2", team: "t1", employee: "102", effective: "2026-01-01", expiration: "2026-11-30" },
    ],
    roster: [
      { id: "r1", employee: "101", work_date: "2026-12-01", shift: "5", source: "G", location: "L1", work_center: "W1", key: "101|2026-12-01" },
      { id: "r2", employee: "101", work_date: "2026-12-02", shift: null, source: "G", key: "101|2026-12-02" },
      { id: "r3", employee: "201", work_date: "2026-12-01", shift: "5", source: "G", key: "201|2026-12-01" },
    ],
  };
}

const noErrorKey = (o) => {
  if (o && typeof o === "object") {
    expect(Object.keys(o)).not.toContain("error");
    Object.values(o).forEach(noErrorKey);
  }
};

describe("RosterView", () => {
  beforeEach(seed);

  test("Quyền khai trên route", () => {
    expect(RosterView.routes.get.rosterView.roles).toBe("payroll");
    expect(RosterView.routes.post.rosterCells.roles).toBe("hr");
  });

  test("rosterView: nhân viên của công ty con, ô nén, cột ngày, tổ, ca", () => {
    const r = RosterView.view({ subsidiary: "14", from: "2026-12-01", to: "2026-12-07" });
    noErrorKey(r);
    expect(r.canEdit).toBe(true);
    // 103 vào làm ngày 10/12: ngoài khoảng
    expect(r.rows.map((x) => x.code)).toEqual(["E1017", "E1018"]);
    expect(r.rows[0]).toMatchObject({ employee: "101", name: "Trần An", department: "Xưởng", departmentId: "40", group: "SAOMAI", teams: ["TO-CAT"], eligible: true, patterns: [] });
    // Chưa khai chế độ ca: người không có ô phân ca nào không thuộc diện xếp ca
    expect(r.rows[1].eligible).toBe(false);
    expect(r.vrows).toEqual([]);
    expect(r.schemes).toEqual([]);
    expect(r.departments).toEqual([{ id: "40", name: "Xưởng" }]);
    // 102 hết hiệu lực tổ 30/11: không còn thuộc tổ trong khoảng
    expect(r.rows[1].teams).toEqual([]);
    expect(r.cells).toEqual({ 101: [[0, "5", "G"], [1, "", "G"]] });
    expect(r.days).toHaveLength(7);
    expect(r.days[2]).toMatchObject({ date: "2026-12-03", type: "H" });
    expect(r.days[5]).toMatchObject({ date: "2026-12-06", type: "W" });
    expect(r.teams).toEqual([{ id: "t1", code: "TO-CAT", description: "Tổ Cắt", members: 1 }]);
    expect(r.shifts.find((s) => s.code === "C3")).toMatchObject({ id: "6", kind: "N", hours: 7.5, active: true });
    expect(r.patterns[0].cycle).toEqual(["C1", "C1", ""]);
    // Nhóm SAOMAI kỳ 12 đang mở; kỳ khóa của nhóm DEFAULT vẫn trả về kèm mã nhóm để trình duyệt lọc theo nhân viên
    expect(r.locks).toEqual([{ group: "DEFAULT", code: "202612", from: "2026-12-01", to: "2026-12-07" }]);
  });

  test("rosterView: lọc theo tổ; thiếu công ty con, khoảng ngày sai thì báo lỗi", () => {
    const r = RosterView.view({ subsidiary: "14", from: "2026-12-01", to: "2026-12-07", team: "t1" });
    expect(r.rows.map((x) => x.employee)).toEqual(["101"]);
    expect(() => RosterView.view({ from: "2026-12-01", to: "2026-12-07" })).toThrow(/Subsidiary is required/);
    expect(() => RosterView.view({ subsidiary: "14", from: "2026-12-07", to: "2026-12-01" })).toThrow(/Invalid date range/);
  });

  test("rosterCells: sửa ô có sẵn giữ chi nhánh, ô mới nhận chi nhánh của tổ, ô không đổi bỏ qua", () => {
    const r = RosterView.saveCells({
      subsidiary: "14",
      cells: [
        { employee: "101", workDate: "2026-12-01", shift: "6" },
        { employee: "101", workDate: "2026-12-04", shift: "5" },
        { employee: "102", workDate: "2026-12-04", shift: "" },
      ],
    });
    noErrorKey(r);
    expect(r).toEqual({ created: 2, updated: 1, unchanged: 0 });
    const rows = mockDb.t.roster;
    expect(rows.find((x) => x.id === "r1")).toMatchObject({ shift: "6", source: "M", location: "L1", work_center: "W1" });
    expect(rows.find((x) => x.key === "101|2026-12-04")).toMatchObject({ shift: "5", source: "M", location: "L7", work_center: "W3" });
    // 102 không còn thuộc tổ ngày 04/12: không có chi nhánh mặc định; ca trống = ngày nghỉ sửa tay
    expect(rows.find((x) => x.key === "102|2026-12-04")).toMatchObject({ shift: null, source: "M", location: null, work_center: null });
    // Lưu lại đúng giá trị: không ghi gì
    expect(RosterView.saveCells({ subsidiary: "14", cells: [{ employee: "101", workDate: "2026-12-01", shift: "6" }] })).toEqual({ created: 0, updated: 0, unchanged: 1 });
  });

  test("rosterCells: kỳ công khóa xét theo nhóm lương của nhân viên", () => {
    // Kỳ 11 của SAOMAI đã khóa
    expect(() => RosterView.saveCells({ subsidiary: "14", cells: [{ employee: "101", workDate: "2026-11-20", shift: "5" }] })).toThrow(/SAOMAI-202611/);
    // Kỳ 12 của DEFAULT khóa không chặn nhân viên SAOMAI
    expect(RosterView.saveCells({ subsidiary: "14", cells: [{ employee: "101", workDate: "2026-12-20", shift: "5" }] }).created).toBe(1);
    // Nhân viên nhóm DEFAULT bị chặn bởi kỳ 12 của DEFAULT
    expect(() => RosterView.saveCells({ subsidiary: "13", cells: [{ employee: "201", workDate: "2026-12-20", shift: "5" }] })).toThrow(/202612/);
  });

  test("rosterCells: chặn nhân viên công ty khác, ca không tồn tại, ca ngừng dùng", () => {
    expect(() => RosterView.saveCells({ subsidiary: "14", cells: [{ employee: "201", workDate: "2026-12-20", shift: "5" }] })).toThrow(/no payroll profile/);
    expect(() => RosterView.saveCells({ subsidiary: "14", cells: [{ employee: "101", workDate: "2026-12-20", shift: "99" }] })).toThrow(/does not exist/);
    expect(() => RosterView.saveCells({ subsidiary: "14", cells: [{ employee: "101", workDate: "2026-12-20", shift: "7" }] })).toThrow(/inactive/);
    expect(mockDb.t.roster).toHaveLength(3);
  });
});

describe("Chế độ ca", () => {
  beforeEach(() => {
    seed();
    mockDb.t.shift = [{ id: "5", name: "C1" }, { id: "6", name: "C3" }];
    mockDb.t.shift_pattern = [{ id: "9", name: "XOAY3", cycle: "C1,C1," }];
    mockDb.t.team.push({ id: "701", name: "TO-B", subsidiary: "14" }, { id: "702", name: "TO-C", subsidiary: "13" });
    mockDb.t.shift_assign = [
      { id: "s1", subsidiary: "14", scope: "D", department: "40", pattern: "9", effective: "2026-12-01" },
      { id: "s2", subsidiary: "13", scope: "S", pattern: "9", effective: "2026-01-01" },
    ];
  });

  test("rosterView: lịch suy ra từ chế độ ca, nhân viên trùng lịch dùng chung một dãy, diện xếp ca", () => {
    const r = RosterView.view({ subsidiary: "14", from: "2026-12-01", to: "2026-12-04" });
    noErrorKey(r);
    // Chu kỳ C1, C1, nghỉ neo tại 01/12
    expect(r.vrows).toEqual([["5", "5", "", "5"]]);
    expect(r.rows.map((x) => [x.code, x.eligible, x.v, x.patterns.join()])).toEqual([["E1017", true, 0, "XOAY3"], ["E1018", true, 0, "XOAY3"]]);
    // Ô đã lưu vẫn gửi riêng để đè lên lịch suy ra
    expect(r.cells).toEqual({ 101: [[0, "5", "G"], [1, "", "G"]] });
    expect(r.schemes).toEqual([{ id: "s1", scope: "D", target: "40", targetName: "Xưởng", pattern: "9", patternCode: "XOAY3", anchor: "", effective: "2026-12-01", expiration: "", note: "" }]);
  });

  test("EffectiveRoster.rows: ô đã lưu đè lên lịch của chế độ ca; chưa có chế độ ca thì chỉ trả ô đã lưu", () => {
    const rows = ER.rows(["101", "102"], "2026-12-01", "2026-12-03");
    const of = (e) => rows.filter((x) => String(x.employee) === e).sort((a, b) => a.work_date.localeCompare(b.work_date)).map((x) => [x.work_date, x.shift || null, x.source]);
    expect(of("101")).toEqual([["2026-12-01", "5", "G"], ["2026-12-02", null, "G"], ["2026-12-03", null, "A"]]);
    expect(of("102")).toEqual([["2026-12-01", "5", "A"], ["2026-12-02", "5", "A"], ["2026-12-03", null, "A"]]);
    mockDb.t.shift_assign = [];
    expect(ER.rows(["101", "102"], "2026-12-01", "2026-12-03").map((x) => x.id)).toEqual(["r1", "r2"]);
  });

  test("EffectiveRoster.forPayroll: số ca theo loại ca trừ ngày nghỉ đã duyệt, ngày có ca cho phân bổ", () => {
    mockDb.t.shift = [{ id: "5", name: "C1", kind: "D" }, { id: "6", name: "C3", kind: "N" }];
    mockDb.t.roster.push({ id: "r9", employee: "102", work_date: "2026-12-02", shift: "6", source: "M", location: "L7", work_center: "W3", key: "102|2026-12-02" });
    mockDb.t.leave_request = [
      { id: "l1", employee: "102", from: "2026-12-01", to: "2026-12-01", status: "A" },
      { id: "l2", employee: "101", from: "2026-12-01", to: "2026-12-01", status: "P" },
    ];
    const r = ER.forPayroll(["101", "102"], "2026-12-01", "2026-12-04");
    // 101: 01/12 C1 (ô đã lưu), 02/12 nghỉ (ô đã lưu), 03/12 nghỉ theo chu kỳ, 04/12 C1 theo chế độ ca; đơn nghỉ chờ duyệt không trừ
    expect(r.counts["101"]).toEqual({ D: 2, E: 0, N: 0 });
    // 102: 01/12 C1 nhưng nghỉ phép đã duyệt (không đếm), 02/12 ca đêm sửa tay, 04/12 C1
    expect(r.counts["102"]).toEqual({ D: 1, E: 0, N: 1 });
    expect(r.days["102"].map((d) => [d.date, d.shiftCode, d.branch])).toEqual(expect.arrayContaining([["2026-12-01", "C1", ""], ["2026-12-02", "C3", "L7"], ["2026-12-04", "C1", ""]]));
    expect(ER.forPayroll([], "2026-12-01", "2026-12-04")).toEqual({ counts: {}, days: {} });
  });

  test("rosterReset: bỏ ô đã lưu (không xóa), lưu lại thì dùng lại bản ghi cũ; kỳ khóa chặn", () => {
    expect(RosterView.resetCells({ subsidiary: "14", cells: [{ employee: "101", workDate: "2026-12-01" }, { employee: "101", workDate: "2026-12-09" }] })).toEqual({ reset: 1, missing: 1 });
    expect(mockDb.t.roster.find((x) => x.id === "r1").isInactive).toBe(true);
    expect(mockDb.t.roster).toHaveLength(3);
    expect(RosterView.view({ subsidiary: "14", from: "2026-12-01", to: "2026-12-04" }).cells).toEqual({ 101: [[1, "", "G"]] });
    expect(RosterView.saveCells({ subsidiary: "14", cells: [{ employee: "101", workDate: "2026-12-01", shift: "6" }] })).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(mockDb.t.roster.find((x) => x.id === "r1")).toMatchObject({ isInactive: false, shift: "6", source: "M" });
    expect(mockDb.t.roster).toHaveLength(3);
    expect(() => RosterView.resetCells({ subsidiary: "14", cells: [{ employee: "101", workDate: "2026-11-20" }] })).toThrow(/SAOMAI-202611/);
  });

  test("rosterAssignSave: thêm, sửa, thôi dùng; kiểm đích và mẫu", () => {
    const made = RosterView.saveScheme({ subsidiary: "14", values: { scope: "T", team: "701", pattern: "9", effective: "2026-12-15", anchor: "2026-12-14" } });
    const rec = mockDb.t.shift_assign.find((x) => x.id === made.id);
    expect(rec).toMatchObject({ subsidiary: "14", scope: "T", team: "701", employee: null, pattern: "9", anchor: "2026-12-14", effective: "2026-12-15", expiration: null });
    RosterView.saveScheme({ subsidiary: "14", id: made.id, values: { scope: "T", team: "701", pattern: "9", effective: "2026-12-15", expiration: "2026-12-31" } });
    expect(rec.expiration).toBe("2026-12-31");
    RosterView.saveScheme({ subsidiary: "14", id: made.id, inactive: true });
    expect(rec.isInactive).toBe(true);
    expect(() => RosterView.saveScheme({ subsidiary: "14", values: { scope: "T", team: "702", pattern: "9", effective: "2026-12-15" } })).toThrow(/Team not found/);
    expect(() => RosterView.saveScheme({ subsidiary: "14", values: { scope: "E", employee: "201", pattern: "9", effective: "2026-12-15" } })).toThrow(/no payroll profile/);
    expect(() => RosterView.saveScheme({ subsidiary: "14", values: { scope: "S", pattern: "77", effective: "2026-12-15" } })).toThrow(/pattern not found/);
    expect(() => RosterView.saveScheme({ subsidiary: "14", values: { scope: "D", pattern: "9", effective: "2026-12-15" } })).toThrow(/department/);
    // Dòng của công ty con khác không sửa được
    expect(() => RosterView.saveScheme({ subsidiary: "14", id: "s2", inactive: true })).toThrow(/not found/);
  });

  test("rosterAssignBatch: gán riêng từng người, đóng dòng riêng cũ giao khoảng hiệu lực", () => {
    mockDb.t.shift_assign.push({ id: "e1", subsidiary: "14", scope: "E", employee: "101", pattern: "9", effective: "2026-11-01" });
    mockDb.t.shift_assign.push({ id: "e2", subsidiary: "14", scope: "E", employee: "102", pattern: "9", effective: "2026-12-20" });
    const r = RosterView.assignBatch({ subsidiary: "14", employees: ["101", "102"], pattern: "9", effective: "2026-12-10" });
    expect(r).toEqual({ created: 2, closed: 2 });
    expect(mockDb.t.shift_assign.find((x) => x.id === "e1").expiration).toBe("2026-12-09");
    expect(mockDb.t.shift_assign.find((x) => x.id === "e2").isInactive).toBe(true);
    expect(mockDb.t.shift_assign.filter((x) => x.scope === "E" && x.effective === "2026-12-10").map((x) => x.employee)).toEqual(["101", "102"]);
    expect(() => RosterView.assignBatch({ subsidiary: "14", employees: [], pattern: "9", effective: "2026-12-10" })).toThrow(/at least one/);
    expect(() => RosterView.assignBatch({ subsidiary: "14", employees: ["201"], pattern: "9", effective: "2026-12-10" })).toThrow(/no payroll profile/);
  });
});
