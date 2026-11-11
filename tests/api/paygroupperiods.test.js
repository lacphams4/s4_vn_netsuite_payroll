// Tài khoản nhiều công ty: kỳ công đã khóa và kỳ của chứng từ chỉ xét kỳ thuộc nhóm lương của nhân viên (api/PayGroupPeriods).
// Hai nhóm lương có kỳ trùng ngày: DEFAULT (công ty 13) khóa 202612, mở 202701; SAOMAI (công ty 14) mở SAOMAI-202612, khóa
// SAOMAI-202701. Kiểm chứng từ (submit / approve / cancel, kỳ gán khi lưu), phân ca (ô, sinh theo mẫu), nạp lượt chấm,
// gỡ khóa chứng từ khi mở khóa công; tài khoản một nhóm lương giữ hành vi cũ; số truy vấn hồ sơ lương cố định.
const API = "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api";
const mockDb = { t: {}, seq: 1000, finds: [] };

jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ id: 1 }) }), { virtual: true });
jest.mock("N/log", () => ({ error: () => undefined, audit: () => undefined, debug: () => undefined }), { virtual: true });
jest.mock("N/cache", () => ({ Scope: { PUBLIC: "PUBLIC" }, getCache: () => ({ get: () => null, put: () => undefined, remove: () => undefined }) }), { virtual: true });
jest.mock("N/task", () => ({ TaskType: {}, TaskStatus: {} }), { virtual: true });

jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const rows = (name) => mockDb.t[name] || (mockDb.t[name] = []);
  const copy = (list) => list.map((x) => Object.assign({}, x));
  // Diễn giải vài điều kiện SQL mã gọi dùng; điều kiện khác trả mọi dòng (mã gọi tự lọc lại theo ngày)
  function find(name, opt = {}) {
    mockDb.finds.push(name);
    let list = rows(name).filter((r) => opt.includeInactive || !r.isInactive);
    const w = opt.where || "";
    const p = opt.params || [];
    if (/^\{id\} = \?/.test(w)) list = list.filter((r) => String(r.id) === String(p[0]));
    else if (/^\{key\} = \?/.test(w)) list = list.filter((r) => r.key === p[0]);
    else if (/^\{team\} = \?/.test(w)) list = list.filter((r) => String(r.team) === String(p[0]));
    else if (/^\{employee\} = \? AND \{id\} <> \?/.test(w)) list = list.filter((r) => String(r.employee) === String(p[0]) && String(r.id) !== String(p[1]));
    else if (/^\{employee\} = \?/.test(w)) list = list.filter((r) => String(r.employee) === String(p[0]));
    else if (/^\{employee\} IN \(/.test(w)) {
      const n = (w.match(/\?/g) || []).length;
      const want = new Set(p.slice(0, n).map(String));
      list = list.filter((r) => want.has(String(r.employee)));
    }
    return copy(list);
  }
  return {
    find,
    findIn: (name, field, ids) => {
      mockDb.finds.push(name);
      const want = new Set((ids || []).map(String));
      return copy(rows(name).filter((x) => want.has(String(x[field]))));
    },
    get: (name, id) => copy(rows(name).filter((x) => String(x.id) === String(id)))[0] || null,
    run: (sql, params, tag) => {
      if (tag !== "s4vp_punch_emp") throw new Error(`Unexpected query ${tag}`);
      const want = new Set(params.map((x) => String(x).toUpperCase()));
      return rows("ns_employee").filter((e) => want.has(String(e.entityid).toUpperCase()) || want.has(String(e.id))).map((e) => ({ id: e.id, entityid: e.entityid }));
    },
    create: (name, values) => {
      const id = String(++mockDb.seq);
      rows(name).push(Object.assign({ id }, values));
      return id;
    },
    submit: (name, id, values) => Object.assign(rows(name).find((r) => String(r.id) === String(id)), values),
    update: (name, id, values) => Object.assign(rows(name).find((r) => String(r.id) === String(id)), values),
    remove: (name, id) => {
      mockDb.t[name] = rows(name).filter((x) => String(x.id) !== String(id));
    },
  };
});
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({
  tenant: () => ({ weekly_off: "0,6" }),
  holidays: () => [],
  earningTypes: () => ({ list: [], byCode: {}, byId: {} }),
  resolve: () => ({ weeklyOffDays: "0,6" }),
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Advances", () => ({}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2026-11-11" }));

const Attendance = require(`${API}/Attendance`);
const Shifts = require(`${API}/Shifts`);
const PG = require(`${API}/PayGroupPeriods`);

// 201: DEFAULT (paygroup trống); 202: DEFAULT (ghi rõ id nhóm 1); 301, 302: SAOMAI
function seed() {
  mockDb.seq = 1000;
  mockDb.finds = [];
  mockDb.t = {
    paygroup: [{ id: "1", name: "DEFAULT", subsidiary: "13" }, { id: "2", name: "SaoMai ", subsidiary: "14" }],
    // Kỳ DEFAULT đứng trước kỳ SAOMAI cùng ngày bắt đầu: bản cũ gán kỳ DEFAULT cho chứng từ Sao Mai
    period: [
      { id: "21", name: "202612", paygroup: "1", start: "2026-12-01", end: "2026-12-31", std_days: 23, status: "O", att_status: "L" },
      { id: "22", name: "202701", paygroup: "1", start: "2027-01-01", end: "2027-01-31", std_days: 21, status: "O", att_status: "O" },
      { id: "31", name: "SAOMAI-202612", paygroup: "2", start: "2026-12-01", end: "2026-12-31", std_days: 23, status: "O", att_status: "O" },
      { id: "32", name: "SAOMAI-202701", paygroup: "2", start: "2027-01-01", end: "2027-01-31", std_days: 21, status: "O", att_status: "L" },
    ],
    employee: [
      { id: "e1", name: "p201", employee: "201", subsidiary: "13", paygroup: null },
      { id: "e2", name: "p202", employee: "202", subsidiary: "13", paygroup: "1" },
      // Hồ sơ cũ đã ngừng của 301 (nhóm DEFAULT) và hồ sơ đang dùng (SAOMAI): hồ sơ đang dùng thắng
      { id: "e3", name: "p301-old", employee: "301", subsidiary: "13", paygroup: "1", isInactive: true },
      { id: "e4", name: "p301", employee: "301", subsidiary: "14", paygroup: "2" },
      { id: "e5", name: "p302", employee: "302", subsidiary: "14", paygroup: "2", isInactive: true },
    ],
    ns_employee: [{ id: "201", entityid: "NV201" }, { id: "202", entityid: "NV202" }, { id: "301", entityid: "SM301" }, { id: "302", entityid: "SM302" }],
    leave_type: [{ id: "1", name: "AL", is_paid: true, deducts_days: true, uses_balance: false, allow_half: true }],
    att_rule: [{ id: "1", min_from: 1, min_to: 30, deduct: 0.25 }],
    leave_request: [], business_trip: [], att_exception: [], ot_request: [], batch: [], roster: [], punch: [], att_sheet: [],
    shift: [{ id: "s1", name: "HC", start_time: "08:00", end_time: "17:00", break_minutes: 60, kind: "D" }],
    shift_pattern: [{ id: "p1", name: "HC5", cycle: "HC" }],
    team: [{ id: "tSM", name: "Tổ Sao Mai" }, { id: "tDF", name: "Tổ DEFAULT" }, { id: "tMix", name: "Tổ ghép" }],
    team_member: [
      { id: "m1", team: "tSM", employee: "301", effective: "2026-01-01" },
      { id: "m2", team: "tSM", employee: "302", effective: "2026-01-01" },
      { id: "m3", team: "tDF", employee: "201", effective: "2026-01-01" },
      { id: "m4", team: "tMix", employee: "301", effective: "2026-01-01" },
      { id: "m5", team: "tMix", employee: "202", effective: "2026-01-01" },
    ],
  };
}

const profileQueries = () => mockDb.finds.filter((n) => n === "employee").length;

function leave(employee, from, to) {
  const id = Attendance.save("leave", { employee, subsidiary: employee[0] === "3" ? "14" : "13", leave_type: "1", from, to }).id;
  return mockDb.t.leave_request.find((r) => r.id === id);
}

beforeEach(seed);

describe("PayGroupPeriods", () => {
  test("mã nhóm của kỳ và của nhân viên: trống = DEFAULT, hồ sơ đang dùng thắng, chưa có hồ sơ = DEFAULT", () => {
    const ctx = PG.load();
    expect(ctx.multi).toBe(true);
    expect(ctx.periods.map((p) => [p.id, p.group])).toEqual([["21", "DEFAULT"], ["22", "DEFAULT"], ["31", "SAOMAI"], ["32", "SAOMAI"]]);
    mockDb.finds = [];
    expect(PG.loadGroups(ctx, ["201", "202", "301", "302", "999", "", null])).toEqual({ 201: "DEFAULT", 202: "DEFAULT", 301: "SAOMAI", 302: "SAOMAI", 999: "DEFAULT" });
    // Một truy vấn hồ sơ cho cả danh sách; tra lại không đọc thêm
    expect(profileQueries()).toBe(1);
    expect(PG.periodsOf(ctx, "301").map((p) => p.id)).toEqual(["31", "32"]);
    expect(PG.lockedFor(ctx, "201", "2026-12-05", "2026-12-05").id).toBe("21");
    expect(PG.lockedFor(ctx, "301", "2026-12-05", "2026-12-05")).toBeNull();
    expect(profileQueries()).toBe(1);
  });
});

describe("chứng từ chấm công", () => {
  test("kỳ gán cho chứng từ là kỳ của nhóm lương của nhân viên (derive)", () => {
    expect(Attendance.derive("leave", { employee: "301", leave_type: "1", from: "2026-12-07", to: "2026-12-08" }).values.period).toBe("31");
    expect(Attendance.derive("leave", { employee: "201", leave_type: "1", from: "2026-12-07", to: "2026-12-08" }).values.period).toBe("21");
    expect(Attendance.derive("exception", { employee: "302", work_date: "2027-01-05", exception_type: "L", minutes: 10 }).values.period).toBe("32");
    expect(Attendance.derive("ot", { employee: "202", work_date: "2027-01-05", hours: 2 }).values.period).toBe("22");
    expect(leave("301", "2026-12-07", "2026-12-08").period).toBe("31");
  });

  test("Sao Mai: submit / approve / cancel không bị chặn bởi kỳ DEFAULT đã khóa cùng ngày", () => {
    const doc = leave("301", "2026-12-07", "2026-12-08");
    expect(Attendance.act("leave", doc.id, "submit").status).toBe("P");
    expect(Attendance.act("leave", doc.id, "approve").status).toBe("A");
    expect(Attendance.act("leave", doc.id, "cancel").status).toBe("C");
    expect(mockDb.t.leave_request[0]).toMatchObject({ status: "C", period: "31" });
  });

  test("DEFAULT: kỳ 202612 khóa vẫn chặn; kỳ SAOMAI-202701 khóa không chặn nhân viên DEFAULT, chặn Sao Mai", () => {
    const d1 = leave("201", "2026-12-07", "2026-12-08");
    expect(() => Attendance.act("leave", d1.id, "submit")).toThrow(/Kỳ công 202612 đã khóa/);
    const d2 = leave("202", "2027-01-05", "2027-01-05");
    expect(Attendance.act("leave", d2.id, "submit").status).toBe("P");
    const d3 = leave("301", "2027-01-05", "2027-01-05");
    expect(() => Attendance.act("leave", d3.id, "submit")).toThrow(/Kỳ công SAOMAI-202701 đã khóa/);
    // Reject không kiểm kỳ khóa (như trước)
    mockDb.t.leave_request.find((r) => r.id === d1.id).status = "P";
    expect(Attendance.act("leave", d1.id, "reject").status).toBe("R");
  });

  test("phiếu ngoại lệ Sao Mai: submit tìm được kỳ của nhóm, kỳ ghi lại là kỳ SAOMAI", () => {
    const id = Attendance.save("exception", { employee: "301", subsidiary: "14", work_date: "2026-12-10", exception_type: "L", minutes: 20, reason: "Kẹt xe" }).id;
    mockDb.t.att_exception.find((r) => r.id === id).period = "21";
    expect(Attendance.act("exception", id, "submit").status).toBe("P");
    expect(mockDb.t.att_exception.find((r) => r.id === id).period).toBe("31");
  });

  test("số truy vấn hồ sơ lương cố định cho một thao tác", () => {
    const doc = leave("301", "2026-12-07", "2026-12-08");
    mockDb.finds = [];
    Attendance.act("leave", doc.id, "submit");
    expect(profileQueries()).toBe(1);
  });

  test("mở khóa kỳ SAOMAI: kỳ DEFAULT khóa không giữ khóa chứng từ Sao Mai; chứng từ DEFAULT không bị gỡ", () => {
    mockDb.t.period.find((p) => p.id === "32").att_status = "O";
    mockDb.t.period.find((p) => p.id === "31").att_status = "L";
    mockDb.t.leave_request.push(
      { id: "L1", employee: "301", from: "2026-12-07", to: "2026-12-08", status: "A", summary_locked: true },
      { id: "L2", employee: "201", from: "2026-12-07", to: "2026-12-08", status: "A", summary_locked: true },
    );
    mockDb.t.att_exception.push(
      { id: "X1", employee: "302", work_date: "2026-12-10", status: "A", summary_locked: true },
      { id: "X2", employee: "202", work_date: "2026-12-10", status: "A", summary_locked: true },
    );
    const c = Attendance.unlockContext("31");
    expect(c.otherLocked.map((p) => p.id)).toEqual([]);
    // Kỳ 21 (DEFAULT) và 31 (SAOMAI) cùng khóa: kỳ khóa khác chỉ tính trong cùng nhóm
    expect(Attendance.unlockContext("21").otherLocked.map((p) => p.id)).toEqual([]);
    mockDb.finds = [];
    Attendance.setSummaryLocked(c.period, false, c.otherLocked, null, c.ref.pg);
    expect(profileQueries()).toBe(1);
    const lockedOf = (name, id) => mockDb.t[name].find((r) => r.id === id).summary_locked;
    expect([lockedOf("leave_request", "L1"), lockedOf("leave_request", "L2"), lockedOf("att_exception", "X1"), lockedOf("att_exception", "X2")]).toEqual([false, true, false, true]);
  });
});

describe("phân ca", () => {
  test("sửa ô: Sao Mai được, DEFAULT bị chặn trong kỳ 202612; ngược lại trong tháng 01/2027", () => {
    expect(Shifts.setRosterCell("301", "2026-12-05", "s1").id).toBeTruthy();
    expect(() => Shifts.setRosterCell("201", "2026-12-05", "s1")).toThrow(/Kỳ công 202612 đã khóa/);
    expect(Shifts.setRosterCell("202", "2027-01-05", "s1").id).toBeTruthy();
    expect(() => Shifts.setRosterCell("302", "2027-01-05", "s1")).toThrow(/SAOMAI-202701/);
  });

  test("sinh theo mẫu: tổ Sao Mai sinh được trong 12/2026; tổ DEFAULT và tổ ghép bị chặn; một truy vấn hồ sơ", () => {
    mockDb.finds = [];
    const r = Shifts.generateRoster({ team: "tSM", pattern: "p1", from: "2026-12-01", to: "2026-12-03" });
    expect(r.created).toBe(6);
    expect(profileQueries()).toBe(1);
    expect(() => Shifts.generateRoster({ team: "tDF", pattern: "p1", from: "2026-12-01", to: "2026-12-03" })).toThrow(/202612/);
    expect(() => Shifts.generateRoster({ team: "tMix", pattern: "p1", from: "2026-12-01", to: "2026-12-03" })).toThrow(/202612/);
    expect(mockDb.t.roster.every((x) => ["301", "302"].includes(x.employee))).toBe(true);
  });
});

describe("nạp lượt chấm (Shifts.importPunches)", () => {
  test("lượt chấm Sao Mai trong 12/2026 ghi được, DEFAULT bị chặn; một truy vấn hồ sơ cho cả file", () => {
    mockDb.finds = [];
    const out = Shifts.importPunches([
      { employee: "SM301", time: "2026-12-03 08:00" },
      { employee: "NV201", time: "2026-12-03 08:01" },
      { employee: "NV202", time: "2027-01-04 08:02" },
      { employee: "SM302", time: "2027-01-04 08:03" },
    ]);
    expect(out.created).toBe(2);
    expect(out.errors).toEqual([
      "#2: attendance of period 202612 is locked / Kỳ công 202612 đã khóa",
      "#4: attendance of period SAOMAI-202701 is locked / Kỳ công SAOMAI-202701 đã khóa",
    ]);
    expect(mockDb.t.punch.map((p) => p.employee)).toEqual(["301", "202"]);
    expect(profileQueries()).toBe(1);
  });
});

describe("tài khoản một nhóm lương: giữ hành vi cũ", () => {
  beforeEach(() => {
    // Chỉ một nhóm (không tên DEFAULT), hồ sơ trống nhóm: vẫn xét mọi kỳ, không đọc hồ sơ lương
    mockDb.t.paygroup = [{ id: "2", name: "SAOMAI" }];
    mockDb.t.period = mockDb.t.period.filter((p) => p.paygroup === "2");
    mockDb.t.employee = [{ id: "e1", name: "p201", employee: "201", paygroup: null }];
  });

  test("kỳ khóa, kỳ của chứng từ, phân ca, lượt chấm như trước; không truy vấn hồ sơ lương", () => {
    expect(PG.load().multi).toBe(false);
    mockDb.finds = [];
    expect(Attendance.derive("leave", { employee: "201", leave_type: "1", from: "2026-12-07", to: "2026-12-07" }).values.period).toBe("31");
    expect(() => Shifts.setRosterCell("201", "2027-01-05", "s1")).toThrow(/SAOMAI-202701/);
    expect(Shifts.importPunches([{ employee: "NV201", time: "2027-01-04 08:00" }]).errors).toHaveLength(1);
    const d = leave("201", "2027-01-05", "2027-01-05");
    expect(() => Attendance.act("leave", d.id, "submit")).toThrow(/SAOMAI-202701/);
    expect(profileQueries()).toBe(0);
  });
});
