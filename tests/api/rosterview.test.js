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
              c_hire_date: p.hire_date || null, c_termination_date: p.termination_date || null, e_code: e.entityid, e_first: e.firstname, e_last: e.lastname, e_dept: e.dept,
            };
          });
      }
      if (tag === "s4vp_roster_cells") {
        return rows("roster")
          .filter((r) => !r.isInactive && r.work_date >= params[0] && r.work_date <= params[1])
          .map((r) => ({ id: r.id, c_employee: r.employee, c_work_date: r.work_date, c_shift: r.shift || null, c_source: r.source || null }));
      }
      throw new Error(`Unexpected query ${tag}`);
    },
    create: (name, values) => {
      const id = String(++mockDb.seq);
      rows(name).push(Object.assign({ id }, values));
      return id;
    },
    submit: (name, id, values) => Object.assign(rows(name).find((r) => String(r.id) === String(id)), values),
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
      { id: "101", entityid: "E1017", firstname: "An", lastname: "Trần", dept: "Xưởng" },
      { id: "102", entityid: "E1018", firstname: "Bình", lastname: "Lê", dept: "Xưởng" },
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
    expect(r.rows[0]).toMatchObject({ employee: "101", name: "Trần An", department: "Xưởng", group: "SAOMAI", teams: ["TO-CAT"] });
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
