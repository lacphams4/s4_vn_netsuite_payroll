// api/Attendance: hàng đợi tác vụ nền của kỳ (queue, assertNotQueued, jobState, finishJob) với N/task, N/cache giả.
// Kiểm: op punches xếp hàng được, hai tác vụ nền cùng kỳ không chạy chồng, màn hình đọc được tiến độ và kết quả khi xong.
const mockEnv = { cache: {}, tasks: {}, submitted: [], seq: 0, punchError: null, size: { employees: 12, cells: 372, background: false }, synced: [], submitError: null };

jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ id: 1 }) }), { virtual: true });
jest.mock("N/log", () => ({ error: () => undefined, audit: () => undefined }), { virtual: true });
jest.mock("N/cache", () => ({
  Scope: { PUBLIC: "PUBLIC" },
  getCache: () => ({
    get: ({ key }) => (Object.prototype.hasOwnProperty.call(mockEnv.cache, key) ? mockEnv.cache[key] : null),
    put: ({ key, value }) => {
      mockEnv.cache[key] = String(value);
    },
    remove: ({ key }) => {
      delete mockEnv.cache[key];
    },
  }),
}), { virtual: true });
jest.mock("N/task", () => ({
  TaskType: { MAP_REDUCE: "MAP_REDUCE" },
  TaskStatus: { PENDING: "PENDING", PROCESSING: "PROCESSING", COMPLETE: "COMPLETE", FAILED: "FAILED" },
  create: (opt) => ({
    submit: () => {
      if (mockEnv.submitError) {
        const e = new Error(mockEnv.submitError.message);
        e.name = mockEnv.submitError.name;
        throw e;
      }
      const id = `MR${++mockEnv.seq}`;
      mockEnv.tasks[id] = { status: "PENDING", stage: "" };
      mockEnv.submitted.push(Object.assign({ id }, opt));
      return id;
    },
  }),
  checkStatus: ({ taskId }) => {
    const t = mockEnv.tasks[taskId];
    if (!t) throw new Error("unknown task");
    return { status: t.status, stage: t.stage, getPercentageCompleted: () => t.percent };
  },
}), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => ({ find: () => [], findIn: () => [], get: () => null }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({ tenant: () => ({ weekly_off: "0,6" }), holidays: () => [], earningTypes: () => ({ list: [], byCode: {}, byId: {} }) }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Advances", () => ({}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2026-11-10" }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Shifts", () => ({
  punchContext: () => {
    if (mockEnv.punchError) throw new Error(mockEnv.punchError);
    return { empIds: [] };
  },
  punchSize: () => {
    if (mockEnv.punchError) throw new Error(mockEnv.punchError);
    return mockEnv.size;
  },
  processPunches: (id) => {
    mockEnv.synced.push(id);
    return { period: "202703", employees: mockEnv.size.employees, exceptions: 4, overtime: 2 };
  },
}));

const Attendance = require("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Attendance");

beforeEach(() => {
  Object.assign(mockEnv, { cache: {}, tasks: {}, submitted: [], seq: 0, punchError: null, size: { employees: 12, cells: 372, background: false }, synced: [], submitError: null });
});

describe("tác vụ nền chấm công của kỳ", () => {
  test("xếp hàng xử lý chấm công: đúng tham số Map/Reduce, trả op", () => {
    const r = Attendance.queue("5", "punches");
    expect(r).toEqual({ queued: true, job: "MR1", op: "punches" });
    expect(mockEnv.submitted[0]).toMatchObject({
      taskType: "MAP_REDUCE", scriptId: "customscript_s4vp_mr_attendance", deploymentId: "customdeploy_s4vp_mr_attendance",
      params: { custscript_s4vp_mra_op: "punches", custscript_s4vp_mra_period: "5" },
    });
  });

  test("kỳ không hợp lệ (đã khóa, đã đóng) thì không xếp hàng", () => {
    mockEnv.punchError = "Attendance of the period is locked";
    expect(() => Attendance.queue("5", "punches")).toThrow(/locked/);
    expect(mockEnv.submitted).toHaveLength(0);
    expect(() => Attendance.queue("5", "nope")).toThrow(/Unknown operation/);
  });

  test("hai tác vụ nền cùng kỳ không chạy chồng; kỳ khác không bị chặn", () => {
    Attendance.queue("5", "punches");
    expect(() => Attendance.queue("5", "punches")).toThrow(/background/);
    expect(() => Attendance.assertNotQueued("5")).toThrow(/background/);
    mockEnv.tasks.MR1.status = "PROCESSING";
    expect(() => Attendance.assertNotQueued("5")).toThrow(/background/);
    expect(() => Attendance.assertNotQueued("6")).not.toThrow();
    expect(Attendance.queue("6", "punches").job).toBe("MR2");
    expect(mockEnv.submitted).toHaveLength(2);
    // Tác vụ xong: cờ tự gỡ, xếp hàng lại được
    mockEnv.tasks.MR1.status = "COMPLETE";
    expect(() => Attendance.assertNotQueued("5")).not.toThrow();
    expect(Attendance.queue("5", "punches").job).toBe("MR3");
  });

  test("màn hình đọc tiến độ khi đang chạy và kết quả khi xong", () => {
    expect(Attendance.jobState("5")).toEqual({ running: false, op: "", status: "", result: null });
    const { job } = Attendance.queue("5", "punches");
    expect(Attendance.jobState("5")).toEqual({ running: true, job, op: "punches", status: "PENDING", stage: "", percent: null });
    Object.assign(mockEnv.tasks[job], { status: "PROCESSING", stage: "REDUCE", percent: 40 });
    expect(Attendance.jobState("5")).toMatchObject({ running: true, op: "punches", stage: "REDUCE", percent: 40 });
    // summarize của Map/Reduce: lưu kết quả rồi gỡ cờ
    Attendance.finishJob("5", { op: "punches", ok: true, employees: 1005, errors: 0, exceptions: 12, overtime: 3 });
    mockEnv.tasks[job].status = "COMPLETE";
    expect(Attendance.jobState("5", job)).toEqual({ running: false, op: "punches", status: "COMPLETE", result: { op: "punches", ok: true, employees: 1005, errors: 0, exceptions: 12, overtime: 3 } });
    expect(() => Attendance.assertNotQueued("5")).not.toThrow();
    // Tác vụ mới xóa kết quả cũ
    Attendance.queue("5", "punches");
    mockEnv.tasks.MR2.status = "FAILED";
    expect(Attendance.jobState("5")).toEqual({ running: false, op: "punches", status: "FAILED", result: null });
  });

  test("cờ không ghi được vào cache: vẫn theo dõi được bằng id tác vụ; cờ kiểu cũ (chuỗi id) vẫn đọc được", () => {
    mockEnv.tasks.MR9 = { status: "PROCESSING", stage: "MAP" };
    expect(Attendance.jobState("7", "MR9")).toMatchObject({ running: true, job: "MR9", stage: "MAP" });
    mockEnv.cache.period_8 = "MR9";
    expect(() => Attendance.assertNotQueued("8")).toThrow(/background/);
    expect(Attendance.jobState("8")).toMatchObject({ running: true, job: "MR9", op: "" });
  });

  test("xử lý chấm công: kỳ nhỏ chạy ngay, kỳ vượt ngưỡng hoặc chọn chạy nền thì xếp hàng op punches", () => {
    expect(Attendance.runPunches("5")).toMatchObject({ employees: 12, exceptions: 4, overtime: 2 });
    expect(mockEnv.synced).toEqual(["5"]);
    expect(mockEnv.submitted).toHaveLength(0);
    // Chọn chạy nền dù kỳ nhỏ
    expect(Attendance.runPunches("6", true)).toEqual({ queued: true, job: "MR1", op: "punches" });
    // Kỳ vượt ngưỡng (Shifts.punchSize quyết định)
    mockEnv.size = { employees: 201, cells: 1407, background: true };
    expect(Attendance.runPunches("7")).toEqual({ queued: true, job: "MR2", op: "punches" });
    expect(mockEnv.synced).toEqual(["5"]);
    expect(mockEnv.submitted.map((t) => t.params.custscript_s4vp_mra_period)).toEqual(["6", "7"]);
    // Kỳ không hợp lệ: báo lỗi, không chạy gì
    mockEnv.punchError = "The pay period is closed";
    expect(() => Attendance.runPunches("8")).toThrow(/closed/);
    expect(mockEnv.submitted).toHaveLength(2);
  });

  test("kỳ đang chạy nền: không chạy đồng bộ chồng lên, không xếp hàng lần hai", () => {
    mockEnv.size = { employees: 1005, cells: 31155, background: true };
    Attendance.runPunches("5");
    mockEnv.size = { employees: 12, cells: 372, background: false };
    expect(() => Attendance.runPunches("5")).toThrow(/background/);
    expect(() => Attendance.runPunches("5", true)).toThrow(/background/);
    expect(mockEnv.synced).toHaveLength(0);
    expect(mockEnv.submitted).toHaveLength(1);
    // Xong (summarize gỡ cờ): chạy lại được, kể cả đồng bộ
    Attendance.finishJob("5", { op: "punches", ok: true, employees: 1005, errors: 0, exceptions: 1, overtime: 0 });
    mockEnv.tasks.MR1.status = "COMPLETE";
    expect(Attendance.runPunches("5")).toMatchObject({ exceptions: 4 });
  });

  test("deployment đang bận với kỳ khác: báo thử lại, không ghi cờ cho kỳ", () => {
    mockEnv.submitError = { name: "MAP_REDUCE_ALREADY_RUNNING", message: "Map/Reduce script is already running" };
    expect(() => Attendance.runPunches("5", true)).toThrow(/Another attendance background job is running/);
    expect(mockEnv.cache.period_5).toBeUndefined();
    mockEnv.submitError = { name: "SSS_OTHER", message: "boom" };
    expect(() => Attendance.queue("5", "punches")).toThrow(/boom/);
  });
});
