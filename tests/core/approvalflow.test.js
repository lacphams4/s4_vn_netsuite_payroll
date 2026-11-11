// core/ApprovalFlow: duyệt bảng lương nhiều cấp (docs/UI_V2.md mục 14) - mặc định tắt, lọc công ty con / ngưỡng, lượt gửi
// duyệt, người gửi không tự duyệt, tách nhiệm vụ giữa hai cấp liên tiếp, từ chối kết thúc lượt.
const { core } = require("./helpers");
const Flow = core("ApprovalFlow");

const HR = "customrole_s4vp_hr";
const ACCT = "customrole_s4vp_accountant";

// Cấu hình mẫu: mọi công ty hai cấp (kế toán trưởng là nhân viên 50, giám đốc là nhân viên 60); cấp 3 chỉ khi thực lĩnh từ 1 tỷ
const CONFIG = [
  { id: "1", subsidiary: null, level: 1, name: "Kế toán trưởng", approver: "50", role: null, min_net: null },
  { id: "2", subsidiary: null, level: 2, name: "Giám đốc", approver: "60", role: null, min_net: 0 },
  { id: "3", subsidiary: null, level: 3, name: "Hội đồng", approver: "70", role: null, min_net: 1000000000 },
];
const batch = (over = {}) => Object.assign({ id: "7", subsidiary: "13", net: 500000000, status: "P" }, over);
const submitted = (user = "9", at = "2027-03-30T01:00:00.000Z") => ({ action: "submitRun", at, user });
const approval = (level, approver, at, over = {}) => Object.assign({ id: String(level * 10), round: 1, level, step_name: "", approver, approver_name: `NV ${approver}`, decision: "A", at, note: "" }, over);
const run = (over = {}) => Flow.evaluate(Object.assign({ config: CONFIG, batch: batch(), logs: [], markers: [submitted()], user: { id: "50", role: ACCT } }, over));

describe("ApprovalFlow.requiredSteps", () => {
  test("mặc định tắt: không có dòng cấu hình", () => {
    expect(Flow.requiredSteps([], batch())).toEqual([]);
    const st = Flow.evaluate({ config: [], batch: batch(), logs: [], markers: [], user: { id: "1" } });
    expect(st).toMatchObject({ enabled: false, levels: [], can: { ok: true } });
    expect(Flow.finalGate({ config: [], batch: batch({ status: "C" }) })).toMatchObject({ ok: true });
    expect(Flow.rejectGate({ config: undefined, batch: batch() })).toMatchObject({ ok: true });
  });

  test("ngưỡng tổng thực lĩnh: cấp 3 chỉ khi thực lĩnh từ ngưỡng", () => {
    expect(Flow.requiredSteps(CONFIG, batch()).map((s) => s.level)).toEqual([1, 2]);
    expect(Flow.requiredSteps(CONFIG, batch({ net: 1000000000 })).map((s) => s.level)).toEqual([1, 2, 3]);
  });

  test("công ty con có dòng riêng thì chỉ dùng dòng riêng; bỏ dòng thôi dùng, dòng thiếu người duyệt", () => {
    const cfg = CONFIG.concat([
      { id: "9", subsidiary: "14", level: 1, name: "Trưởng phòng", approver: null, role: "H" },
      { id: "10", subsidiary: "14", level: 2, name: "Cũ", approver: "61", isInactive: true },
      { id: "11", subsidiary: "14", level: 3, name: "Trống", approver: null, role: null },
      { id: "12", subsidiary: "14", level: 2, name: "Kế toán", approver: null, role: "A" },
      { id: "13", subsidiary: "14", level: 2, approver: "62" },
    ]);
    const steps = Flow.requiredSteps(cfg, batch({ subsidiary: "14" }));
    expect(steps).toEqual([
      { level: 1, name: "Trưởng phòng", approvers: [{ employee: "", role: "H" }] },
      { level: 2, name: "Kế toán", approvers: [{ employee: "", role: "A" }, { employee: "62", role: "" }] },
    ]);
    // công ty 13 không có dòng riêng: dùng dòng chung
    expect(Flow.requiredSteps(cfg, batch()).map((s) => s.name)).toEqual(["Kế toán trưởng", "Giám đốc"]);
  });
});

describe("ApprovalFlow.evaluate", () => {
  test("vừa gửi duyệt: cấp 1 đang chờ, chỉ người của cấp 1 được duyệt", () => {
    const st = run();
    expect(st).toMatchObject({ enabled: true, status: "P", round: 1, submitter: "9", complete: false, last: false });
    expect(st.levels.map((l) => [l.level, l.state])).toEqual([[1, "current"], [2, "todo"]]);
    expect(st.can).toEqual({ ok: true });
    const other = run({ user: { id: "60", role: ACCT } });
    expect(other.can).toMatchObject({ ok: false, code: "notApprover" });
    expect(other.can.vi).toBe("Bạn không phải người duyệt của cấp 1 (Kế toán trưởng)");
    expect(other.canReject.ok).toBe(false);
  });

  test("duyệt lần lượt: cấp 1 xong thì cấp 2 là cấp cuối", () => {
    const logs = [approval(1, "50", "2027-03-30T02:00:00.000Z", { note: "OK" })];
    const st = run({ logs, user: { id: "60", role: ACCT } });
    expect(st.levels.map((l) => [l.level, l.state, l.by, l.note])).toEqual([[1, "done", "50", "OK"], [2, "current", "", ""]]);
    expect(st).toMatchObject({ last: true, can: { ok: true } });
    const done = run({ logs: logs.concat([approval(2, "60", "2027-03-30T03:00:00.000Z")]) });
    expect(done).toMatchObject({ complete: true, current: null, can: { ok: false, code: "complete" } });
  });

  test("người gửi duyệt không tự duyệt", () => {
    const st = run({ markers: [submitted("50")] });
    expect(st.can).toMatchObject({ ok: false, code: "submitter" });
    // nhưng vẫn được từ chối nếu là người duyệt của cấp
    expect(st.canReject.ok).toBe(true);
  });

  test("tách nhiệm vụ: người vừa duyệt cấp trước không duyệt cấp kế khi cấp đó còn người khác", () => {
    const cfg = [
      { level: 1, approver: null, role: "A", name: "Kế toán" },
      { level: 2, approver: null, role: "A", name: "Kế toán 2" },
      { level: 2, approver: "60", name: "Kế toán 2" },
    ];
    const logs = [approval(1, "50", "2027-03-30T02:00:00.000Z")];
    const st = run({ config: cfg, logs, user: { id: "50", role: ACCT } });
    expect(st.can).toMatchObject({ ok: false, code: "sameApprover" });
    expect(st.can.en).toBe("You approved the previous level; level 2 needs another approver");
  });

  test("tách nhiệm vụ: cấp chỉ có một người đủ quyền là chính người đó thì cho phép và đánh dấu waived", () => {
    const cfg = [
      { level: 1, approver: "50", name: "Cấp 1" },
      { level: 2, approver: "50", name: "Cấp 2" },
    ];
    const logs = [approval(1, "50", "2027-03-30T02:00:00.000Z")];
    expect(run({ config: cfg, logs }).can).toEqual({ ok: true, waived: true });
    // vai trò: chỉ miễn khi biết chắc vai trò có không quá một người
    const byRole = [{ level: 1, role: "A" }, { level: 2, role: "A" }];
    expect(run({ config: byRole, logs }).can).toMatchObject({ ok: false, code: "sameApprover" });
    expect(run({ config: byRole, logs, roleMembers: { A: 1 } }).can).toEqual({ ok: true, waived: true });
  });

  test("vai trò: người đăng nhập bằng vai trò được khai thì được duyệt", () => {
    const cfg = [{ level: 1, role: "H", name: "Nhân sự" }];
    expect(run({ config: cfg, user: { id: "20", role: HR } }).can.ok).toBe(true);
    expect(run({ config: cfg, user: { id: "20", role: ACCT } }).can.ok).toBe(false);
    expect(run({ config: [{ level: 1, role: "D" }], user: { id: "3", role: "administrator" } }).can.ok).toBe(true);
  });

  test("từ chối kết thúc lượt; gửi lại bắt đầu lượt mới từ cấp 1", () => {
    const logs = [
      approval(1, "50", "2027-03-30T02:00:00.000Z"),
      approval(2, "60", "2027-03-30T03:00:00.000Z", { decision: "R", note: "Sai phụ cấp" }),
    ];
    const rejected = run({ batch: batch({ status: "J" }), logs, markers: [submitted()] });
    expect(rejected.levels.map((l) => [l.level, l.state])).toEqual([[1, "done"], [2, "rejected"]]);
    expect(rejected.can).toMatchObject({ ok: false, code: "notSubmitted" });
    const again = run({ logs, markers: [submitted("9", "2027-03-30T01:00:00.000Z"), { action: "reopen", at: "2027-03-30T04:00:00.000Z" }, submitted("9", "2027-03-30T05:00:00.000Z")] });
    expect(again.round).toBe(2);
    expect(again.levels.map((l) => [l.level, l.state])).toEqual([[1, "current"], [2, "todo"]]);
  });

  test("mở lại giữa chừng xóa các cấp đã duyệt của lượt cũ", () => {
    const logs = [approval(1, "50", "2027-03-30T02:00:00.000Z")];
    const markers = [submitted("9", "2027-03-30T01:00:00.000Z"), { action: "reopen", at: "2027-03-30T02:30:00.000Z" }, submitted("9", "2027-03-30T02:40:00.000Z")];
    const st = run({ logs, markers });
    expect(st.levels[0].state).toBe("current");
    expect(st.round).toBe(2);
  });

  test("chưa gửi duyệt (C): mọi cấp todo, không duyệt được", () => {
    const st = run({ batch: batch({ status: "C" }), markers: [] });
    expect(st.levels.map((l) => l.state)).toEqual(["todo", "todo"]);
    expect(st.can.code).toBe("notSubmitted");
    expect(st.round).toBe(1);
  });

  test("đã duyệt (A): hiện lại các cấp của lượt cuối; không có nhật ký thì tắt", () => {
    const logs = [approval(1, "50", "2027-03-30T02:00:00.000Z"), approval(2, "60", "2027-03-30T03:00:00.000Z")];
    const st = run({ batch: batch({ status: "A" }), logs });
    expect(st.enabled).toBe(true);
    expect(st.levels.map((l) => [l.level, l.state, l.name])).toEqual([[1, "done", "Kế toán trưởng"], [2, "done", "Giám đốc"]]);
    expect(run({ batch: batch({ status: "R" }), logs: [] }).enabled).toBe(false);
  });
});

describe("ApprovalFlow.finalGate / rejectGate", () => {
  test("action cũ approve không vượt cấp", () => {
    const g = Flow.finalGate({ config: CONFIG, batch: batch(), logs: [], markers: [submitted()], user: { id: "60" } });
    expect(g).toMatchObject({ ok: false, code: "pendingLevel" });
    expect(g.vi).toMatch(/Cấp duyệt 1 \(Kế toán trưởng\) chưa duyệt/);
    // duyệt ngay từ trạng thái C (bỏ qua gửi duyệt) cũng bị chặn khi có cấp duyệt
    expect(Flow.finalGate({ config: CONFIG, batch: batch({ status: "C" }), logs: [], markers: [], user: { id: "50" } })).toMatchObject({ ok: false, code: "notSubmitted" });
  });

  test("approveStep cấp cuối: cho qua khi đúng cấp cuối và đúng người", () => {
    const input = { config: CONFIG, batch: batch(), logs: [approval(1, "50", "2027-03-30T02:00:00.000Z")], markers: [submitted()], user: { id: "60" } };
    expect(Flow.finalGate(input, { step: 2 })).toMatchObject({ ok: true });
    expect(Flow.finalGate(input, { step: 1 })).toMatchObject({ ok: false, code: "pendingLevel" });
    expect(Flow.finalGate(Object.assign({}, input, { user: { id: "50" } }), { step: 2 })).toMatchObject({ ok: false, code: "notApprover" });
    // không có opt.step (action cũ) khi chưa đủ cấp: chặn
    expect(Flow.finalGate(input)).toMatchObject({ ok: false, code: "pendingLevel" });
    // đủ mọi cấp: action cũ chạy được
    expect(Flow.finalGate(Object.assign({}, input, { logs: input.logs.concat([approval(2, "60", "2027-03-30T03:00:00.000Z")]) }))).toMatchObject({ ok: true });
  });

  test("từ chối: chỉ người duyệt của cấp đang chờ khi đang qua các cấp", () => {
    const input = { config: CONFIG, batch: batch(), logs: [], markers: [submitted()] };
    expect(Flow.rejectGate(Object.assign({ user: { id: "50" } }, input)).ok).toBe(true);
    expect(Flow.rejectGate(Object.assign({ user: { id: "60" } }, input))).toMatchObject({ ok: false, code: "notApprover" });
    // trạng thái C (chưa gửi duyệt): theo quy tắc cũ
    expect(Flow.rejectGate(Object.assign({ user: { id: "60" } }, input, { batch: batch({ status: "C" }) })).ok).toBe(true);
  });
});

describe("ApprovalFlow.load và approverNames", () => {
  test("không có cấu hình (hoặc record chưa deploy): không đọc thêm", () => {
    const calls = [];
    const Store = { find: (name) => (calls.push(name), []) };
    expect(Flow.load(Store, { id: "7" })).toEqual({ config: [], logs: [], markers: [] });
    expect(calls).toEqual(["approval_step"]);
    const broken = { find: () => { throw new Error("Record type not found"); } };
    expect(Flow.load(broken, { id: "7" })).toEqual({ config: [], logs: [], markers: [] });
  });

  test("có cấu hình: đọc nhật ký duyệt và mốc nhật ký thao tác của bảng lương", () => {
    const seen = [];
    const Store = {
      find(name, opt = {}) {
        seen.push([name, opt.params]);
        if (name === "approval_step") return CONFIG;
        if (name === "approval_log") return [approval(1, "50", "x")];
        return [{ id: "1", action: "submitRun", at: "2027", user: "9", text_vi: "bỏ" }];
      },
    };
    const r = Flow.load(Store, { id: "7" });
    expect(r.logs).toHaveLength(1);
    expect(r.markers).toEqual([{ id: "1", action: "submitRun", at: "2027", user: "9" }]);
    expect(seen[2]).toEqual(["audit_log", ["7", "submitRun", "reopen", "reject"]]);
  });

  test("tên người duyệt theo ngôn ngữ", () => {
    const step = { approvers: [{ employee: "50", role: "" }, { employee: "", role: "A" }, { employee: "77", role: "" }] };
    expect(Flow.approverNames(step, { 50: "Nguyễn An" }, "vi")).toEqual(["Nguyễn An", "Vai trò Kế toán", "#77"]);
    expect(Flow.approverNames(step, {}, "en")[1]).toBe("Accountant role");
  });
});
