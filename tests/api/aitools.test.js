// api/AiTools: mặt tiền có kiểu của Dispatch cho trợ lý AI (MCP). Dispatch giả ghi lại lời gọi.
const fs = require("fs");
const path = require("path");
const BASE = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll");

const mockState = { calls: [], allowed: true, out: {} };
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Dispatch", () => ({
  roleIn: (set) => set === "payroll" && mockState.allowed,
  get: (input) => (mockState.calls.push(["get", input]), mockState.out),
  post: (input) => (mockState.calls.push(["post", input]), mockState.out),
}));
jest.mock("N/log", () => ({ audit: (o) => mockState.logs.push(o.details), error: () => {} }), { virtual: true });

const AiTools = require(path.join(BASE, "api/AiTools"));

beforeEach(() => Object.assign(mockState, { calls: [], allowed: true, out: {}, logs: [] }));

describe("AiTools", () => {
  test("schema đã sinh khớp TOOLS; tên hàm xuất của Custom Tool khớp schema", async () => {
    const file = JSON.parse(fs.readFileSync(path.join(BASE, "scripts/s4vp_ct_payroll_schema.json"), "utf8"));
    expect(file).toEqual(JSON.parse(JSON.stringify(AiTools.schema())));
    const ct = require(path.join(BASE, "scripts/s4vp_ct_payroll"));
    expect(Object.keys(ct).sort()).toEqual(file.tools.map((t) => t.name).sort());
    for (const t of file.tools) {
      expect(t.name).toMatch(/^s4vp_[a-z_]+$/);
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
      // không công cụ nào nhận câu lệnh, tên bảng, tên action tự do
      expect(Object.keys(t.inputSchema.properties).some((k) => /sql|query|table|action|field/i.test(k))).toBe(false);
    }
    const out = await ct.s4vp_home({ subsidiary: "14" });
    expect(out.ok).toBe(true);
    expect(mockState.logs[0]).toMatch(/^tool=s4vp_home outcome=ok ms=\d+$/);
  });

  test("chỉ gọi action cố định; action nhạy cảm không có công cụ nào chạm tới", () => {
    const forbidden = ["release", "reverse", "agencyBills", "closePeriod", "reopenPeriod", "lockAttendance", "unlockAttendance", "saveSetup", "saveCompany", "saveProfile", "generateTestData"];
    const src = fs.readFileSync(path.join(BASE, "api/AiTools.js"), "utf8");
    for (const a of forbidden) expect(src).not.toMatch(new RegExp(`(get|post)\\("${a}"`));
  });

  test("role không thuộc gói: từ chối trước khi gọi Dispatch", () => {
    mockState.allowed = false;
    const out = AiTools.run("s4vp_context", {});
    expect(out.ok).toBe(false);
    expect(out.error.type).toBe("ACCESS_DENIED");
    expect(mockState.calls).toEqual([]);
  });

  test("kiểm tra tham số: thiếu, sai kiểu, sai enum", () => {
    expect(AiTools.run("s4vp_home", {}).error.type).toBe("VALIDATION_ERROR");
    expect(AiTools.run("s4vp_home", { subsidiary: "14 OR 1=1" }).error.message).toMatch(/numeric/);
    expect(AiTools.run("s4vp_roster", { subsidiary: "14", from: "01/01/2027", to: "2027-01-31" }).error.message).toMatch(/YYYY-MM-DD/);
    expect(AiTools.run("s4vp_attendance_docs", { subsidiary: "14", type: "payslip" }).error.message).toMatch(/one of/);
    expect(AiTools.run("s4vp_payroll_run", { id: "9", limit: 5000 }).error.type).toBe("VALIDATION_ERROR");
    expect(AiTools.run("nope", {}).error.type).toBe("UNKNOWN_TOOL");
    expect(mockState.calls).toEqual([]);
  });

  test("đọc: tham số GET là chuỗi, bỏ tham số trống", () => {
    AiTools.run("s4vp_leave_balances", { subsidiary: 14, year: 2027 });
    expect(mockState.calls).toEqual([["get", { action: "leaveBalances", subsidiary: "14", year: "2027" }]]);
  });

  test("bảng lương: lọc dòng theo mã / tên không dấu, phân trang, kèm tổng", () => {
    mockState.out = { totals: { net: 1 }, lines: [{ id: "1", code: "E1001", name: "Nguyễn Văn Đức" }, { id: "2", code: "E1002", name: "Trần Thị Hoa" }, { id: "3", code: "E1003", name: "Lê Đức Anh" }] };
    const out = AiTools.run("s4vp_payroll_run", { id: "9", q: "duc", limit: 1 });
    expect(out.data.lines.map((l) => l.id)).toEqual(["1"]);
    expect(out.data.linesPaging).toEqual({ total: 2, offset: 0, returned: 1, more: true });
    expect(out.data.totals).toEqual({ net: 1 });
  });

  test("ngữ cảnh: chỉ công ty đang dùng, kỳ theo công ty con và năm", () => {
    mockState.out = {
      user: { id: 5, name: "A", role: "customrole_s4vp_hr", isHr: true, lang: "vi" },
      setupReady: true,
      subsidiaries: [{ id: "13", name: "X", enabled: false }, { id: "14", name: "Sao Mai", enabled: true }],
      paygroups: [{ id: "1", code: "DEFAULT", subsidiary: "13" }, { id: "2", code: "SAOMAI", subsidiary: "14" }],
      periods: [{ id: "10", code: "202612", paygroup: "1", start: "2026-12-01" }, { id: "11", code: "SAOMAI-202612", paygroup: "2", start: "2026-12-01" }, { id: "12", code: "SAOMAI-202701", paygroup: "2", start: "2027-01-01" }],
      unverified: ["a", "b"],
      recordTypeIds: { batch: "1" },
    };
    const d = AiTools.run("s4vp_context", { subsidiary: "14", year: 2027 }).data;
    expect(d.subsidiaries).toEqual([{ id: "14", name: "Sao Mai" }]);
    expect(d.periods.map((p) => p.id)).toEqual(["12"]);
    expect(d.user).toEqual({ name: "A", role: "customrole_s4vp_hr", isHr: true, isAccountant: false, fullAccess: false, language: "vi" });
    expect(d.unverifiedLegalParameters).toBe(2);
    expect(d.recordTypeIds).toBeUndefined();
  });

  test("ghi: thiếu confirm thì không gọi Dispatch, có confirm mới gọi", () => {
    const ask = AiTools.run("s4vp_payroll_action", { id: "9", op: "approve", note: "ok" });
    expect(ask).toMatchObject({ ok: true, needsConfirmation: true, willDo: "approve payroll run 9" });
    expect(mockState.calls).toEqual([]);
    AiTools.run("s4vp_payroll_action", { id: "9", op: "approve", note: "ok", confirm: true });
    AiTools.run("s4vp_payroll_action", { id: "9", op: "calculate", confirm: true });
    expect(mockState.calls).toEqual([
      ["post", { action: "approveStep", batch: "9", note: "ok" }],
      ["post", { action: "calculate", id: "9", background: true }],
    ]);
    expect(AiTools.run("s4vp_payroll_action", { id: "9", op: "release", confirm: true }).error.type).toBe("VALIDATION_ERROR");
  });

  test("chứng từ công: chỉ nhận trường của đúng loại", () => {
    AiTools.run("s4vp_attendance_doc_save", { type: "leave", employee: "70", subsidiary: "14", leave_type: "1", from: "2027-01-05", to: "2027-01-06", hours: 4, reason: "Việc riêng", confirm: true });
    expect(mockState.calls[0]).toEqual(["post", { action: "saveDoc", type: "leave", values: { employee: "70", subsidiary: "14", leave_type: "1", from: "2027-01-05", to: "2027-01-06", reason: "Việc riêng" } }]);
  });

  test("lỗi nghiệp vụ của Dispatch (khóa mới lẫn cũ) thành BUSINESS_ERROR song ngữ; lỗi bất ngờ không lộ chi tiết", () => {
    mockState.out = { s4vpError: "Locked", s4vpErrorVi: "Đã khóa" };
    expect(AiTools.run("s4vp_home", { subsidiary: "14" })).toEqual({ ok: false, error: { type: "BUSINESS_ERROR", message: "Locked", messageVi: "Đã khóa" } });
    mockState.out = { error: "Old", errorVi: "Cũ" };
    expect(AiTools.run("s4vp_home", { subsidiary: "14" }).error.messageVi).toBe("Cũ");
    mockState.out = null;
    const boom = AiTools.run("s4vp_payroll_run", { id: "9" });
    expect(boom.ok).toBe(true);
  });

  test("kết quả quá lớn: cắt mọi mảng dài và ghi chú", () => {
    mockState.out = { grid: Array.from({ length: 3000 }, (_, i) => ({ i, text: "x".repeat(80) })) };
    const out = AiTools.run("s4vp_commission", { subsidiary: "14" });
    expect(out.data.grid).toHaveLength(40);
    expect(out.note).toMatch(/too large/);
  });
});
