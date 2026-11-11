// Bảng lương đọc hoa hồng đã duyệt (docs/COMMISSION.md mục 7): chỉ bảng tính đang hoạt động cùng công ty con, trạng thái A (hoặc
// P của chính bảng lương), ngày cuối trong kỳ; chỉ nhân viên trong lô; gom theo nhân viên và loại thu nhập; số truy vấn cố định.
// Ghi sổ đặt bảng tính đã dùng sang P + bảng lương; đảo trả về A.
const path = require("path");
const calcFake = require("./calcFake");

const mockState = { store: null, cache: {}, logs: [], usage: 5000, param: "7", lang: "vi_VN" };

jest.mock("N/query", () => ({}), { virtual: true });
jest.mock("N/record", () => ({ Type: {} }), { virtual: true });
jest.mock("N/format", () => ({ Type: { DATE: "date", DATETIMETZ: "dtz" }, format: () => { throw new Error("no format"); }, parse: () => null }), { virtual: true });
jest.mock("N/log", () => ({ audit: (o) => mockState.logs.push(o), error: (o) => mockState.logs.push(o), debug: () => undefined }), { virtual: true });
jest.mock("N/runtime", () => ({
  getCurrentUser: () => ({ id: 5, roleId: "administrator", getPreference: () => mockState.lang }),
  getCurrentScript: () => ({ getParameter: () => mockState.param, getRemainingUsage: () => mockState.usage }),
  ContextType: {},
}), { virtual: true });
jest.mock("N/cache", () => ({
  Scope: { PRIVATE: "PRIVATE", PROTECTED: "PROTECTED", PUBLIC: "PUBLIC" },
  getCache: ({ name }) => ({
    get: ({ key }) => {
      const v = mockState.cache[`${name}|${key}`];
      return v === undefined ? null : v;
    },
    put: ({ key, value }) => {
      mockState.cache[`${name}|${key}`] = String(value);
    },
    remove: ({ key }) => delete mockState.cache[`${name}|${key}`],
  }),
}), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const forward = {};
  for (const k of ["find", "findIn", "get", "run", "submit", "rec", "codeOf", "idOf", "memoize"]) forward[k] = (...a) => mockState.store[k](...a);
  forward.stats = [];
  return forward;
});
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Checks", () => ({}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/LaborAnalytics", () => ({}));

const Payroll = require(path.join(calcFake.ROOT, "api/Payroll"));

const detail = (shares) => JSON.stringify({ components: [], steps: [], credits: [], shares });
const seg = (amount, o) => Object.assign({ sub: "31", workCenter: "41", branch: "61", project: "501", amount }, o);

/** Bảng lương 7 (kỳ 03/2027, công ty con 13) + bảng tính hoa hồng đủ trường hợp loại trừ. */
function fresh(n) {
  const db = calcFake.buildDb(n);
  db.comm_run = [
    { id: "1", name: "HH202703-13", subsidiary: "13", month: 202703, date_from: "2027-03-01", date_to: "2027-03-31", status: "A" },
    { id: "2", name: "HH202703-13b", subsidiary: "13", month: 202703, date_to: "2027-03-31", status: "D" },
    { id: "3", name: "HH202703-99", subsidiary: "99", month: 202703, date_to: "2027-03-31", status: "A" },
    { id: "4", name: "HH202702-13", subsidiary: "13", month: 202702, date_to: "2027-02-28", status: "A" },
    { id: "5", name: "HH202703-13c", subsidiary: "13", month: 202703, date_to: "2027-03-31", status: "P", batch: "7" },
    { id: "6", name: "HH202703-13d", subsidiary: "13", month: 202703, date_to: "2027-03-31", status: "P", batch: "8" },
    { id: "7", name: "HH202703-13e", subsidiary: "13", month: 202703, date_to: "2027-03-31", status: "A", isInactive: true },
  ];
  db.comm_result = [
    { id: "11", run: "1", employee: "101", plan: "1", earning_type: "THUONG", payable: 2000000, detail: detail([seg(1500000), seg(500000, { sub: "32", workCenter: "", branch: "62", project: "" })]) },
    { id: "12", run: "5", employee: "101", plan: "2", earning_type: "thuong", payable: 500000, detail: detail([seg(500000)]) },
    { id: "13", run: "1", employee: "102", plan: "1", earning_type: "THUONG", payable: 1000000, detail: detail([]) },
    { id: "14", run: "1", employee: "103", plan: "1", earning_type: "THUONG", payable: 0, detail: detail([]) },
    { id: "15", run: "1", employee: "999", plan: "1", earning_type: "THUONG", payable: 7000000, detail: detail([]) },
  ];
  for (const r of ["2", "3", "4", "6", "7"]) db.comm_result.push({ id: `2${r}`, run: r, employee: "101", plan: "1", earning_type: "THUONG", payable: 9999, detail: detail([]) });
  const f = calcFake.make(db);
  mockState.store = f.store;
  return { db, log: f.log };
}

function written(log) {
  const out = {};
  for (const w of log.writes) if (w.name === "batch_emp") out[w.id] = w.values;
  return out;
}

beforeEach(() => {
  mockState.cache = {};
});

describe("Payroll.calculate đọc hoa hồng đã duyệt", () => {
  test("gom theo nhân viên và loại thu nhập, chỉ bảng tính hợp lệ, phân bổ theo shares", () => {
    const a = fresh(6);
    const r = Payroll.calculate("7", { skipFinish: true });
    expect(r.errors).toEqual([]);
    const w = written(a.log);
    const d101 = JSON.parse(w["70001"].detail);
    const c101 = d101.earnings.filter((e) => e.source === "C");
    expect(c101).toEqual([expect.objectContaining({ earningType: "THUONG", quantity: 1, rate: 2500000, amount: 2500000 })]);
    expect(d101.commissionRuns).toEqual(["1", "5"]);
    const own = d101.allocations.filter((x) => x.project === "501" && x.sub === "31");
    expect(own.map((x) => x.amount)).toEqual([2000000]);
    expect(d101.allocations.filter((x) => x.sub === "32" && x.branch === "62").map((x) => x.amount)).toEqual([500000]);
    const d102 = JSON.parse(w["70002"].detail);
    expect(d102.earnings.filter((e) => e.source === "C").map((e) => e.amount)).toEqual([1000000]);
    expect(d102.commissionRuns).toEqual(["1"]);
    const d103 = JSON.parse(w["70003"].detail);
    expect(d103.earnings.some((e) => e.source === "C")).toBe(false);
    expect(d103.commissionRuns).toEqual([]);
    // Hai truy vấn cho cả bảng lương
    expect(a.log.queries.filter((q) => q.name === "comm_run")).toHaveLength(1);
    expect(a.log.queries.filter((q) => q.name === "comm_result")).toHaveLength(1);
  });

  test("tính theo lô: số truy vấn hoa hồng không đổi, chỉ đọc kết quả của nhân viên trong lô", () => {
    const a = fresh(12);
    Payroll.calculate("7", { lineIds: ["70002"], skipFinish: true, fromJob: true });
    const q = a.log.queries.filter((x) => x.name === "comm_result");
    expect(q).toHaveLength(1);
    expect(q[0].rows).toBe(1);
    expect(JSON.parse(written(a.log)["70002"].detail).earnings.filter((e) => e.source === "C").map((e) => e.amount)).toEqual([1000000]);
  });

  test("không có bảng tính hợp lệ trong kỳ: không đọc kết quả", () => {
    const a = fresh(3);
    a.db.comm_run = a.db.comm_run.filter((r) => r.id !== "1" && r.id !== "5");
    Payroll.calculate("7", { skipFinish: true });
    expect(a.log.queries.filter((x) => x.name === "comm_result")).toHaveLength(0);
  });
});

describe("ghi sổ / đảo bảng lương", () => {
  test("ghi sổ đặt bảng tính đã dùng A -> P + bảng lương; đảo trả về A", () => {
    const a = fresh(3);
    Payroll.calculate("7", { skipFinish: true });
    a.log.writes.length = 0;
    Payroll.finishRelease("7");
    const runWrites = a.log.writes.filter((x) => x.name === "comm_run");
    expect(runWrites).toEqual([{ name: "comm_run", id: "1", values: { status: "P", batch: "7" } }]);
    expect(a.db.comm_run.find((r) => r.id === "1")).toMatchObject({ status: "P", batch: "7" });
    // chạy lại không ghi thêm
    a.log.writes.length = 0;
    Payroll.finishRelease("7");
    expect(a.log.writes.filter((x) => x.name === "comm_run")).toEqual([]);
    Payroll.finishReverse("7");
    expect(a.db.comm_run.filter((r) => r.batch === "7" && r.status === "P")).toEqual([]);
    expect(a.db.comm_run.find((r) => r.id === "1")).toMatchObject({ status: "A", batch: null });
    expect(a.db.comm_run.find((r) => r.id === "5")).toMatchObject({ status: "A", batch: null });
    expect(a.db.comm_run.find((r) => r.id === "6")).toMatchObject({ status: "P", batch: "8" });
  });
});
