// api/Attendance: số dư phép, hết hạn phép chuyển và cấp phép năm chỉ áp cho nhân viên có hồ sơ lương thuộc công ty con đang
// chọn (custrecord_s4vp_em_subsidiary); không truyền công ty thì như trước (mọi công ty). Số truy vấn không tăng theo số dòng.
const mockDb = { employee: [], leave_balance: [], leave_type: [], leave_tran: [], leave_policy: [] };
const mockLog = { finds: [], submits: [], creates: [] };

jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ id: 1 }) }), { virtual: true });
jest.mock("N/log", () => ({ error: () => undefined, audit: () => undefined }), { virtual: true });
jest.mock("N/cache", () => ({ Scope: { PUBLIC: "PUBLIC" }, getCache: () => ({ get: () => null, put: () => undefined, remove: () => undefined }) }), { virtual: true });
jest.mock("N/task", () => ({ TaskType: {}, TaskStatus: {} }), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => ({
  find: (name, opt) => {
    mockLog.finds.push(name);
    const rows = mockDb[name] || [];
    const o = opt || {};
    if (name === "leave_balance" && o.where === "{year} = ?") return rows.filter((r) => r.year === o.params[0]).map((r) => Object.assign({}, r));
    if (name === "employee" && !o.includeInactive) return rows.filter((r) => !r.inactive).map((r) => Object.assign({}, r));
    return rows.map((r) => Object.assign({}, r));
  },
  findIn: (name, field, ids, where, params) => {
    mockLog.finds.push(name);
    const set = new Set(ids.map(String));
    return (mockDb[name] || []).filter((r) => set.has(String(r[field])) && (name !== "leave_balance" || (r.year >= params[0] && r.year <= params[1]))).map((r) => Object.assign({}, r));
  },
  get: () => null,
  submit: (name, id, values) => {
    mockLog.submits.push({ name, id, values });
    const r = (mockDb[name] || []).find((x) => x.id === id);
    if (r) Object.assign(r, values);
  },
  create: (name, values) => {
    const id = `${name}-${(mockDb[name] || []).length + 1}`;
    mockLog.creates.push({ name, values });
    (mockDb[name] = mockDb[name] || []).push(Object.assign({ id }, values));
    return id;
  },
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({ tenant: () => ({ weekly_off: "0,6", leave_policy: "P1" }), holidays: () => [], earningTypes: () => ({ list: [], byCode: {}, byId: {} }) }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Advances", () => ({}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Shifts", () => ({}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2027-04-01" }));

const Attendance = require("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Attendance");

const bal = (id, employee, year, extra) => Object.assign({ id, employee, leave_type: "LT1", year, entitled: 12, carried: 0, carry_expiry: null, adjusted: 0, used: 0, pending: 0, key: `${employee}|LT1|${year}` }, extra || {});

beforeEach(() => {
  mockDb.employee = [
    { id: "P1", employee: "101", subsidiary: "13" },
    { id: "P2", employee: "102", subsidiary: "13" },
    { id: "P3", employee: "201", subsidiary: "14" },
    { id: "P4", employee: "202", subsidiary: "14", inactive: true },
  ];
  mockDb.leave_type = [{ id: "LT1", name: "al" }];
  mockDb.leave_balance = [
    bal("B1", "101", 2027, { carried: 5, carry_expiry: "2027-03-31", used: 2 }),
    bal("B2", "102", 2027),
    bal("B3", "201", 2027, { carried: 4, carry_expiry: "2027-03-31", used: 1 }),
    bal("B4", "202", 2027),
    bal("B5", "999", 2027),
    bal("B6", "201", 2026),
  ];
  mockDb.leave_tran = [];
  mockDb.leave_policy = [{ id: "P1", name: "STD", leave_type: "LT1", annual_days: 12, carry_max: 5, carry_expiry_month: 3, method: "Y" }];
  mockLog.finds = [];
  mockLog.submits = [];
  mockLog.creates = [];
});

describe("số dư phép theo công ty con", () => {
  test("chỉ nhân viên có hồ sơ thuộc công ty con (kể cả hồ sơ ngừng), đúng năm; có mã loại nghỉ và còn lại", () => {
    const rows = Attendance.balances("14", 2027);
    expect(rows.map((r) => r.employee).sort()).toEqual(["201", "202"]);
    const r = rows.find((x) => x.employee === "201");
    expect(r).toMatchObject({ leaveTypeCode: "AL", carry_expiry: "2027-03-31", available: 15 });
  });

  test("không truyền công ty con: như trước - mọi nhân viên có hồ sơ, bỏ số dư không có hồ sơ", () => {
    expect(Attendance.balances("", 2027).map((r) => r.employee).sort()).toEqual(["101", "102", "201", "202"]);
  });

  test("số truy vấn cố định (hồ sơ, loại nghỉ, số dư) dù nhiều dòng", () => {
    for (let i = 0; i < 50; i += 1) mockDb.leave_balance.push(bal(`X${i}`, "201", 2027));
    Attendance.balances("14", 2027);
    expect(mockLog.finds).toEqual(["employee", "leave_type", "leave_balance"]);
  });
});

describe("hết hạn phép chuyển theo công ty con", () => {
  test("chỉ trừ phép chuyển quá hạn của công ty con được chọn, một lần ghi số dư, giao dịch X", () => {
    const r = Attendance.expire(2027, "2027-04-01", "14");
    expect(r.rows).toEqual([{ employee: "201", leaveType: "LT1", expired: 3 }]);
    expect(mockDb.leave_balance.find((b) => b.id === "B3")).toMatchObject({ carried: 1, carry_expiry: null });
    // Số dư công ty 13 không đổi
    expect(mockDb.leave_balance.find((b) => b.id === "B1")).toMatchObject({ carried: 5, carry_expiry: "2027-03-31" });
    expect(mockLog.submits.filter((s) => s.name === "leave_balance")).toHaveLength(1);
    expect(mockLog.creates.filter((c) => c.name === "leave_tran").map((c) => c.values)).toEqual([expect.objectContaining({ employee: "201", source: "X", qty: -3, ref: "EXPIRY-2027" })]);
  });

  test("không truyền công ty con: mọi số dư quá hạn như trước; truy vấn không tăng theo số dòng", () => {
    const r = Attendance.expire(2027, "2027-04-01");
    expect(r.rows.map((x) => x.employee).sort()).toEqual(["101", "201"]);
    expect(mockLog.finds).toEqual(["leave_balance"]);
  });

  test("lọc công ty con thêm đúng một truy vấn hồ sơ", () => {
    Attendance.expire(2027, "2027-04-01", "13");
    expect(mockLog.finds).toEqual(["employee", "leave_balance"]);
  });

  test("chưa tới hạn thì không trừ", () => {
    expect(Attendance.expire(2027, "2027-03-30", "14").rows).toEqual([]);
    expect(mockLog.submits).toHaveLength(0);
  });
});

describe("cấp phép năm theo công ty con", () => {
  test("accrualProfiles chỉ hồ sơ đang dùng của công ty con; không truyền thì mọi hồ sơ đang dùng", () => {
    expect(Attendance.accrualProfiles("14").map((p) => p.employee)).toEqual(["201"]);
    expect(Attendance.accrualProfiles(null).map((p) => p.employee)).toEqual(["101", "102", "201"]);
  });

  test("cấp phép năm 2027 cho công ty 14: chỉ ghi số dư / giao dịch của nhân viên công ty 14, chuyển phép 2026", () => {
    const r = Attendance.accrue(2027, null, "2027-01-02", "14");
    expect(r.rows.map((x) => x.employee)).toEqual(["201"]);
    const emps = new Set(mockLog.creates.filter((c) => c.name === "leave_tran").map((c) => c.values.employee));
    expect([...emps]).toEqual(["201"]);
    // Năm 2026 còn 12 ngày, chuyển tối đa 5 (giao dịch C năm 2027, J trừ năm 2026)
    expect(r.rows[0].carriedOver).toBe(5);
  });
});
