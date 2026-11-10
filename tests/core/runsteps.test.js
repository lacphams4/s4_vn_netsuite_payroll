// Thanh các bước của giao diện bản 2 (core/RunSteps): chạy lương 6 bước, tính công 4 bước, tiến độ.
const { core } = require("./helpers");
const RunSteps = core("RunSteps");

const states = (steps) => steps.map((s) => s.state);
const step = (steps, key) => steps.find((s) => s.key === key);
const D = "done";
const C = "current";
const T = "todo";

describe("payrollSteps - chạy lương", () => {
  const open = { att_status: "O" };
  const locked = { att_status: "L" };

  test("luôn trả 6 bước đúng thứ tự, tuyến tính, nhiều nhất một bước hiện tại", () => {
    for (const status of ["H", "B", "C", "P", "A", "J", "R", "V", "", "?"]) {
      for (const calculated of [true, false]) {
        for (const period of [open, locked, null]) {
          const steps = RunSteps.payrollSteps({ status, calculated, emp_count: 3 }, period, { openChecks: 1 });
          expect(steps.map((s) => s.key)).toEqual(["prepare", "attendance", "calculate", "review", "approve", "post"]);
          expect(steps.filter((s) => s.state === C).length).toBeLessThanOrEqual(1);
          // không có bước done nào đứng sau bước chưa xong
          const firstOpen = steps.findIndex((s) => s.state !== D);
          if (firstOpen >= 0) expect(steps.slice(firstOpen).every((s) => s.state !== D)).toBe(true);
        }
      }
    }
  });

  test("chưa có bảng lương hoặc chưa có nhân viên: bước chuẩn bị", () => {
    expect(states(RunSteps.payrollSteps(null, null, null))).toEqual([C, T, T, T, T, T]);
    const steps = RunSteps.payrollSteps({ status: "B", emp_count: 0 }, locked, {});
    expect(states(steps)).toEqual([C, T, T, T, T, T]);
    expect(step(steps, "prepare")).toEqual({ key: "prepare", state: C, note: "employees", count: 0 });
  });

  test("counts.employees ưu tiên hơn batch.emp_count", () => {
    expect(states(RunSteps.payrollSteps({ status: "B", emp_count: 0 }, locked, { employees: 4 }))).toEqual([D, D, C, T, T, T]);
    expect(states(RunSteps.payrollSteps({ status: "B", emp_count: 4 }, locked, { employees: 0 }))).toEqual([C, T, T, T, T, T]);
  });

  test("có nhân viên, công chưa khóa: bước công và giờ", () => {
    const steps = RunSteps.payrollSteps({ status: "B", emp_count: 4 }, open, {});
    expect(states(steps)).toEqual([D, C, T, T, T, T]);
    expect(step(steps, "prepare").count).toBe(4);
    expect(step(steps, "attendance").note).toBe("open");
  });

  test("công đã khóa, chờ tính: bước tính lương", () => {
    const steps = RunSteps.payrollSteps({ status: "B", emp_count: 4 }, locked, {});
    expect(states(steps)).toEqual([D, D, C, T, T, T]);
    expect(step(steps, "attendance").note).toBe("locked");
    expect(step(steps, "calculate").note).toBeUndefined();
  });

  test("tạm giữ: bước tính lương mang note hold", () => {
    const steps = RunSteps.payrollSteps({ status: "H", emp_count: 4 }, locked, {});
    expect(states(steps)).toEqual([D, D, C, T, T, T]);
    expect(step(steps, "calculate").note).toBe("hold");
    expect(step(RunSteps.payrollSteps({ status: "H", emp_count: 0 }, open, {}), "calculate")).toEqual({ key: "calculate", state: T, note: "hold" });
  });

  test("đã tính, còn cảnh báo: bước soát kèm số cảnh báo", () => {
    const steps = RunSteps.payrollSteps({ status: "C", calculated: true, emp_count: 4 }, locked, { openChecks: 3 });
    expect(states(steps)).toEqual([D, D, D, C, T, T]);
    expect(step(steps, "review")).toEqual({ key: "review", state: C, note: "openChecks", count: 3 });
  });

  test("đã tính, chưa biết số cảnh báo: vẫn dừng ở bước soát", () => {
    const steps = RunSteps.payrollSteps({ status: "C", calculated: true, emp_count: 4 }, locked, {});
    expect(states(steps)).toEqual([D, D, D, C, T, T]);
    expect(step(steps, "review").note).toBeUndefined();
  });

  test("đã tính, hết cảnh báo: sang bước duyệt", () => {
    expect(states(RunSteps.payrollSteps({ status: "C", calculated: true, emp_count: 4 }, locked, { openChecks: 0 }))).toEqual([D, D, D, D, C, T]);
  });

  test("đã tính khi công chưa khóa: bước công coi như đã qua nhưng giữ note open", () => {
    const steps = RunSteps.payrollSteps({ status: "C", calculated: "T", emp_count: 4 }, open, { openChecks: 0 });
    expect(states(steps)).toEqual([D, D, D, D, C, T]);
    expect(step(steps, "attendance")).toEqual({ key: "attendance", state: D, note: "open" });
  });

  test("trạng thái C nhưng cờ calculated chưa bật: quay về bước tính", () => {
    expect(states(RunSteps.payrollSteps({ status: "C", calculated: false, emp_count: 4 }, locked, { openChecks: 0 }))).toEqual([D, D, C, T, T, T]);
  });

  test("chờ duyệt, đã duyệt, đã ghi sổ", () => {
    const pending = RunSteps.payrollSteps({ status: "P", calculated: true, emp_count: 4 }, locked, { openChecks: 2 });
    expect(states(pending)).toEqual([D, D, D, D, C, T]);
    expect(step(pending, "approve").note).toBe("pending");
    expect(step(pending, "review")).toEqual({ key: "review", state: D, note: "openChecks", count: 2 });
    expect(states(RunSteps.payrollSteps({ status: "A", calculated: true, emp_count: 4 }, locked, {}))).toEqual([D, D, D, D, D, C]);
    expect(states(RunSteps.payrollSteps({ status: "R", calculated: true, emp_count: 4 }, locked, {}))).toEqual([D, D, D, D, D, D]);
  });

  test("từ chối: quay về bước soát với note rejected", () => {
    const steps = RunSteps.payrollSteps({ status: "J", calculated: true, emp_count: 4 }, locked, { openChecks: 1 });
    expect(states(steps)).toEqual([D, D, D, C, T, T]);
    expect(step(steps, "review")).toEqual({ key: "review", state: C, note: "rejected", count: 1 });
  });

  test("đã đảo: cả 6 bước xong, bước ghi sổ mang note reversed", () => {
    const steps = RunSteps.payrollSteps({ status: "V", calculated: true, emp_count: 4 }, locked, {});
    expect(states(steps)).toEqual([D, D, D, D, D, D]);
    expect(step(steps, "post").note).toBe("reversed");
  });

  test("chữ thường và số dạng chuỗi vẫn hiểu", () => {
    expect(states(RunSteps.payrollSteps({ status: "c", calculated: true, emp_count: "4" }, { att_status: "l" }, { openChecks: "0" }))).toEqual([D, D, D, D, C, T]);
  });
});

describe("attendanceSteps - tính công", () => {
  test("luôn trả 4 bước đúng thứ tự", () => {
    expect(RunSteps.attendanceSteps(null, null).map((s) => s.key)).toEqual(["collect", "exceptions", "lock", "handoff"]);
  });

  test("chưa lập bảng công: bước thu dữ liệu", () => {
    expect(states(RunSteps.attendanceSteps({ att_status: "O" }, {}))).toEqual([C, T, T, T]);
    // ngoại lệ có trước khi lập bảng công vẫn được báo số
    const steps = RunSteps.attendanceSteps({ att_status: "O" }, { openExceptions: 2 });
    expect(states(steps)).toEqual([C, T, T, T]);
    expect(step(steps, "exceptions")).toEqual({ key: "exceptions", state: T, note: "openExceptions", count: 2 });
  });

  test("đã lập bảng công, còn ngoại lệ: bước xử lý ngoại lệ", () => {
    const steps = RunSteps.attendanceSteps({ att_status: "O" }, { hasSummary: true, openExceptions: 5 });
    expect(states(steps)).toEqual([D, C, T, T]);
    expect(step(steps, "exceptions").count).toBe(5);
  });

  test("hết ngoại lệ, chưa khóa: bước khóa công", () => {
    const steps = RunSteps.attendanceSteps({ att_status: "O" }, { hasSummary: true, openExceptions: 0 });
    expect(states(steps)).toEqual([D, D, C, T]);
    expect(step(steps, "exceptions").note).toBeUndefined();
    expect(step(steps, "lock").note).toBeUndefined();
  });

  test("đã khóa, chưa có bảng lương: bước chuyển sang chạy lương", () => {
    const steps = RunSteps.attendanceSteps({ att_status: "L" }, { hasSummary: true, hasBatch: false });
    expect(states(steps)).toEqual([D, D, D, C]);
    expect(step(steps, "lock").note).toBe("locked");
  });

  test("đã khóa và đã có bảng lương: xong hết", () => {
    expect(states(RunSteps.attendanceSteps({ att_status: "L" }, { hasSummary: true, hasBatch: true }))).toEqual([D, D, D, D]);
    expect(states(RunSteps.attendanceSteps({ att_status: "L" }, { hasBatch: 2 }))).toEqual([D, D, D, D]);
  });

  test("đã khóa mà còn ngoại lệ: bước ngoại lệ đã qua nhưng giữ số để nhắc", () => {
    const steps = RunSteps.attendanceSteps({ att_status: "L" }, { openExceptions: 1 });
    expect(states(steps)).toEqual([D, D, D, C]);
    expect(step(steps, "exceptions")).toEqual({ key: "exceptions", state: D, note: "openExceptions", count: 1 });
  });

  test("đã có bảng lương nhưng công chưa khóa: vẫn theo trạng thái công", () => {
    expect(states(RunSteps.attendanceSteps({ att_status: "O" }, { hasSummary: true, hasBatch: true }))).toEqual([D, D, C, T]);
  });
});

describe("progress", () => {
  test("đếm bước đã xong và bước hiện tại", () => {
    const steps = RunSteps.payrollSteps({ status: "C", calculated: true, emp_count: 4 }, { att_status: "L" }, { openChecks: 3 });
    expect(RunSteps.progress(steps)).toEqual({ done: 3, total: 6, currentKey: "review" });
    expect(RunSteps.progress(RunSteps.attendanceSteps({ att_status: "O" }, { hasSummary: true, openExceptions: 1 }))).toEqual({ done: 1, total: 4, currentKey: "exceptions" });
  });

  test("xong hết thì không còn bước hiện tại", () => {
    expect(RunSteps.progress(RunSteps.payrollSteps({ status: "R", emp_count: 1 }, null, null))).toEqual({ done: 6, total: 6, currentKey: null });
  });

  test("đầu vào rỗng", () => {
    expect(RunSteps.progress(null)).toEqual({ done: 0, total: 0, currentKey: null });
    expect(RunSteps.progress([])).toEqual({ done: 0, total: 0, currentKey: null });
  });
});
