// api/Approvals (approvalState, approveStep, rejectStep) với api/Payroll thật (approve / reject có cổng duyệt nhiều cấp) và
// Store giả trong bộ nhớ; api/AuditLog ghi dòng gắn nhân viên cho thao tác nhân sự.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const mockDb = {};
const mockUser = { id: 50, name: "Kế toán trưởng", roleId: "customrole_s4vp_accountant", lang: "vi_VN" };

jest.mock("N/query", () => ({}), { virtual: true });
jest.mock("N/record", () => ({ Type: {} }), { virtual: true });
jest.mock("N/log", () => ({ error: (o) => mockDb.logs.push(o.details), audit: () => {}, debug: () => {} }), { virtual: true });
jest.mock("N/runtime", () => ({
  getCurrentUser: () => ({ id: mockUser.id, name: mockUser.name, roleId: mockUser.roleId, getPreference: () => mockUser.lang }),
  getCurrentScript: () => ({ getRemainingUsage: () => 5000 }),
}), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2027-03-30" }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Checks", () => ({ assertApprovable: () => mockDb.checksCalls.push("assert") }));
for (const name of ["Settings", "Output", "WorkPermits", "AllocationPlans", "TimeLines", "LaborAnalytics", "CostAccounts", "Lean"]) {
  jest.mock(`../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/${name}`, () => ({}));
}
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const table = (n) => (mockDb[n] = mockDb[n] || []);
  return {
    get: (name, id) => table(name).find((r) => r.id === String(id)) || null,
    find(name, opt = {}) {
      if (mockDb.notDeployed && name === "approval_step") throw new Error("Record type not found");
      const p = (opt.params || []).map(String);
      if (name === "approval_log") return table(name).filter((r) => r.batch === p[0]);
      if (name === "audit_log" && String(opt.where).startsWith("{employee}")) return table(name).filter((r) => r.employee === p[0]).sort((x, y) => Number(y.id) - Number(x.id));
      if (name === "audit_log") return table(name).filter((r) => r.batch === p[0] && p.slice(1).includes(r.action));
      return table(name);
    },
    findIn: () => [],
    run: () => [],
    create(name, values) {
      const id = String(++mockDb.seq);
      table(name).push(Object.assign({ id }, values));
      return id;
    },
    submit(name, id, values) {
      Object.assign(table(name).find((r) => r.id === String(id)), values);
    },
  };
});

let Payroll;
let Approvals;
let AuditLog;

const CONFIG = [
  { id: "1", subsidiary: null, level: 1, name: "Kế toán trưởng", approver: "50", role: null, min_net: null },
  { id: "2", subsidiary: null, level: 2, name: "Giám đốc", approver: "60", role: null, min_net: null },
];

function seed(config) {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  Object.assign(mockDb, {
    seq: 100, logs: [], checksCalls: [], notDeployed: false,
    batch: [{ id: "7", subsidiary: "13", period: "3", status: "P", calculated: true, net: 500000000 }],
    period: [{ id: "3", status: "O" }],
    approval_step: config || [],
    approval_log: [],
    audit_log: [{ id: "1", batch: "7", action: "submitRun", at: "2020-01-01T01:00:00.000Z", user: "9" }],
  });
  Object.assign(mockUser, { id: 50, name: "Kế toán trưởng", roleId: "customrole_s4vp_accountant", lang: "vi_VN" });
  jest.resetModules();
  Payroll = require(path.join(API, "Payroll"));
  Approvals = require(path.join(API, "Approvals"));
  AuditLog = require(path.join(API, "AuditLog"));
  Payroll.employeesInfo = (ids) => Object.fromEntries(ids.map((id) => [id, { name: { 50: "Nguyễn An", 60: "Trần Bình" }[id] || "" }]));
}

const as = (id, name) => Object.assign(mockUser, { id, name });
const batch = () => mockDb.batch[0];

describe("mặc định tắt (chưa khai cấp duyệt)", () => {
  beforeEach(() => seed([]));

  test("approvalState enabled = false; action cũ approve chạy như trước", () => {
    expect(Approvals.routes.get.approvalState.run({ batch: "7" })).toMatchObject({ enabled: false, steps: [] });
    Payroll.approve("7");
    expect(batch()).toMatchObject({ status: "A", approved_by: "50", approved_date: "2027-03-30" });
    expect(mockDb.checksCalls).toEqual(["assert"]);
  });

  test("record cấu hình chưa deploy: vẫn duyệt một cấp", () => {
    mockDb.notDeployed = true;
    Payroll.approve("7");
    expect(batch().status).toBe("A");
  });

  test("approveStep khi tắt = duyệt một cấp; reject không đòi người duyệt", () => {
    expect(Approvals.approveStep({ batch: "7", note: "" })).toMatchObject({ ok: true, final: true, level: null });
    expect(batch().status).toBe("A");
    seed([]);
    as(77, "Ai đó");
    Payroll.reject("7");
    expect(batch().status).toBe("J");
  });
});

describe("hai cấp duyệt", () => {
  beforeEach(() => seed(CONFIG));

  test("approvalState: các cấp, người duyệt, lý do khi không được duyệt", () => {
    const st = Approvals.routes.get.approvalState.run({ batch: "7" });
    expect(Approvals.routes.get.approvalState.roles).toBe("payroll");
    expect(st).toMatchObject({ enabled: true, current: 1, currentName: "Kế toán trưởng", final: false, canApprove: true, canReject: true, reason: "" });
    expect(st.steps.map((s) => [s.level, s.name, s.approverName, s.state])).toEqual([[1, "Kế toán trưởng", "Nguyễn An", "current"], [2, "Giám đốc", "Trần Bình", "todo"]]);
    as(60, "Giám đốc");
    expect(Approvals.state({ batch: "7" })).toMatchObject({ canApprove: false, reason: "Bạn không phải người duyệt của cấp 1 (Kế toán trưởng)" });
    // không có khóa "error" ở bất kỳ cấp nào (N/https phía trình duyệt từ chối cả phản hồi)
    expect(JSON.stringify(st)).not.toMatch(/"error"/);
  });

  test("action cũ approve không vượt cấp", () => {
    as(60, "Giám đốc");
    expect(() => Payroll.approve("7")).toThrow(/Cấp duyệt 1 \(Kế toán trưởng\) chưa duyệt/);
    expect(batch().status).toBe("P");
  });

  test("duyệt lần lượt: cấp 1 ghi nhật ký, cấp cuối chuyển A qua Payroll.approve", () => {
    const r1 = Approvals.routes.post.approveStep.run({ batch: "7", note: "Đã soát" });
    expect(r1).toMatchObject({ ok: true, level: 1, final: false, round: 1 });
    expect(batch().status).toBe("P");
    expect(mockDb.checksCalls).toEqual(["assert"]);
    expect(mockDb.approval_log[0]).toMatchObject({ batch: "7", round: 1, level: 1, step_name: "Kế toán trưởng", approver: "50", decision: "A", note: "Đã soát", waived: false });
    // cùng người không duyệt tiếp cấp 2 (không phải người duyệt cấp 2)
    expect(() => Approvals.approveStep({ batch: "7" })).toThrow(/không phải người duyệt của cấp 2/);
    
    as(60, "Giám đốc");
    const r2 = Approvals.approveStep({ batch: "7", note: "" });
    expect(r2).toMatchObject({ ok: true, level: 2, final: true });
    expect(batch()).toMatchObject({ status: "A", approved_by: "60" });
    expect(mockDb.approval_log).toHaveLength(2);
    expect(Approvals.state({ batch: "7" }).steps.map((s) => s.state)).toEqual(["done", "done"]);
  });

  test("người gửi duyệt không tự duyệt", () => {
    mockDb.audit_log[0].user = "50";
    expect(() => Approvals.approveStep({ batch: "7" })).toThrow(/Người gửi duyệt không được tự duyệt/);
  });

  test("từ chối cần ghi chú; chỉ người của cấp đang chờ; ghi nhật ký và kết thúc lượt", () => {
    expect(() => Approvals.rejectStep({ batch: "7", note: "  " })).toThrow(/cần ghi chú/);
    as(60, "Giám đốc");
    expect(() => Approvals.rejectStep({ batch: "7", note: "Sai" })).toThrow(/không phải người duyệt của cấp 1/);
    expect(batch().status).toBe("P");
    as(50, "Kế toán trưởng");
    expect(Approvals.rejectStep({ batch: "7", note: "Sai phụ cấp" })).toMatchObject({ ok: true, level: 1, round: 1 });
    expect(batch().status).toBe("J");
    expect(mockDb.approval_log[0]).toMatchObject({ decision: "R", level: 1, note: "Sai phụ cấp" });
    expect(Approvals.state({ batch: "7" }).steps.map((s) => s.state)).toEqual(["rejected", "todo"]);
  });

  test("lỗi có userMessage hai ngôn ngữ", () => {
    as(60, "Giám đốc");
    try {
      Payroll.approve("7");
      throw new Error("expected a failure");
    } catch (e) {
      expect(e.userMessage.en).toMatch(/^Approval level 1 \(Kế toán trưởng\) is still pending/);
      expect(e.userMessage.vi).toMatch(/^Cấp duyệt 1/);
    }
  });
});

describe("AuditLog: thao tác nhân sự gắn nhân viên, nhãn mới", () => {
  beforeEach(() => {
    seed([]);
    Object.assign(mockDb, {
      audit_log: [],
      contract: [{ id: "41", employee: "13", profile: "313" }],
      dependent: [{ id: "42", profile: "313" }],
      employee: [{ id: "313", employee: "13" }],
      alloc_version: [{ id: "43", employee: "13" }],
    });
  });

  test("lấy nhân viên từ bản ghi vừa thao tác (result.id) hoặc entry.id; không ghi số tiền", () => {
    AuditLog.record({ action: "hrSaveContract", batch: null, period: null, id: null, lineId: null, result: { id: "41", status: "D", warnings: [] } });
    AuditLog.record({ action: "hrActivateContract", id: "41", result: { id: "41", status: "A" } });
    AuditLog.record({ action: "hrSaveDependent", result: { id: "42", created: false, updated: true } });
    AuditLog.record({ action: "saveProfile", result: { id: "313" } });
    AuditLog.record({ action: "saveAllocLines", id: "43", result: { id: "43", total: 1 } });
    AuditLog.record({ action: "createAdvance", result: { id: "99" }, employee: "13" });
    expect(mockDb.audit_log.map((r) => [r.action, r.employee, r.batch, r.line])).toEqual([
      ["hrSaveContract", "13", null, "41"], ["hrActivateContract", "13", null, "41"], ["hrSaveDependent", "13", null, "42"],
      ["saveProfile", "13", null, ""], ["saveAllocLines", "13", null, "43"], ["createAdvance", "13", null, "99"],
    ]);
    expect(mockDb.audit_log[2].text_vi).toBe("Cập nhật");
    const r = AuditLog.auditLog({ employee: "13" });
    expect(r.items[0]).toMatchObject({ action: "createAdvance", label: "Tạo phiếu tạm ứng", employee: "13" });
    expect(r.items.map((i) => i.label)).toContain("Lưu hợp đồng lao động");
  });

  test("không tìm được nhân viên thì không ghi; thao tác thiết lập ghi không cần gắn", () => {
    expect(AuditLog.record({ action: "hrSaveDecision", result: { id: "999" } })).toBeNull();
    expect(AuditLog.record({ action: "verifyParam", result: { id: "5" } })).not.toBeNull();
    const row = mockDb.audit_log[0];
    expect(row).toMatchObject({ action: "verifyParam", line: "5" });
    expect(row).not.toHaveProperty("employee");
    expect(row).not.toHaveProperty("setup");
  });

  test("nhãn và diễn giải của duyệt cấp; đủ nhãn vi / en cho các action mới", () => {
    const b = AuditLog.build({ action: "approveStep", batch: "7", result: { ok: true, level: 2, name: "Giám đốc", final: true, waived: true } });
    expect(b.text_vi).toBe("Cấp 2 - Giám đốc (cấp cuối, bảng lương đã duyệt); cùng người duyệt cấp liền trước vì cấp này chỉ có một người duyệt");
    expect(b.text_en).toMatch(/^Level 2 - Giám đốc \(final level, batch approved\)/);
    const names = ["hrSaveContract", "hrActivateContract", "hrTerminateContract", "hrSaveDecision", "hrApplyDecision", "hrSaveDependent", "newAllocVersion", "saveAllocLines", "activateAllocVersion", "saveWorkPermit", "workPermitAction", "saveProfile", "createAdvance", "removeHoldAdvance", "releaseAdvance", "saveCostAccount", "retireCostAccount", "verifyParam", "approveStep", "rejectStep", "submitRun"];
    for (const n of names) {
      expect(AuditLog.labelOf(n, "vi")).not.toBe(n);
      expect(AuditLog.labelOf(n, "en")).not.toBe(n);
    }
  });
});
