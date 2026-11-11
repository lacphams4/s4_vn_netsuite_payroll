// Tính lương theo lô (Map/Reduce s4vp_mr_calculate, api/Payroll.calculate với lineIds) cho cùng kết quả với tính cả bảng;
// số truy vấn của một lô không tăng theo cỡ bảng lương và không đọc JSON chi tiết của dòng ngoài lô; ngữ cảnh tĩnh nhớ
// N/cache - cache trúng, trượt hay hỏng đều ra cùng kết quả.
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
    put: ({ key, value, ttl }) => {
      if (Buffer.byteLength(String(value), "utf8") > 500 * 1024) throw new Error("SSS_CACHE_VALUE_TOO_LARGE");
      mockState.cache[`${name}|${key}`] = String(value);
      mockState.cache[`ttl|${name}|${key}`] = ttl;
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
const Mr = require(path.join(calcFake.ROOT, "scripts/s4vp_mr_calculate"));

/** Dữ liệu mới + Store giả; trả {db, log}. */
function fresh(n, opt) {
  const db = calcFake.buildDb(n, opt);
  const f = calcFake.make(db);
  mockState.store = f.store;
  return { db, log: f.log };
}

/** Giá trị đã ghi lên từng dòng lương của bảng 7 (lần ghi cuối). */
function written(log) {
  const out = {};
  for (const w of log.writes) if (w.name === "batch_emp") out[w.id] = w.values;
  return out;
}

const lineIdsOf = (db) => db.batch_emp.filter((l) => l.batch === "7").map((l) => l.id);
const chunks = (ids, size) => {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
};

beforeEach(() => {
  mockState.cache = {};
  mockState.logs = [];
  mockState.usage = 5000;
  mockState.param = "7";
});

describe("calculate theo lô cho cùng kết quả với tính cả bảng", () => {
  for (const semi of [false, true]) {
    test(`${semi ? "kỳ nửa tháng (có kỳ trước cùng tháng thuế)" : "kỳ tháng"}: 60 nhân viên, lô 7 dòng, thứ tự lô đảo`, () => {
      const a = fresh(60, { semi });
      const full = Payroll.calculate("7", { skipFinish: true });
      const expected = written(a.log);
      expect(Object.keys(expected)).toHaveLength(60);
      // Dữ liệu mẫu phủ đủ nhánh: có lỗi thật không (giấy phép không chặn), có tạm ứng, OT, sản lượng, phân bổ, kỳ trước
      expect(full.errors).toEqual([]);
      const details = Object.values(expected).map((v) => JSON.parse(v.detail));
      expect(details.some((d) => (d.advanceOffsets || []).length)).toBe(true);
      expect(details.some((d) => (d.outputRefs || []).includes("SL000002"))).toBe(true);
      expect(details.some((d) => (d.allocations || []).some((x) => x.project === "502"))).toBe(true);
      expect(Object.values(expected).some((v) => /giấy phép|permit/i.test(v.warnings))).toBe(true);

      const b = fresh(60, { semi });
      const parts = chunks(lineIdsOf(b.db), 7).reverse();
      const errors = [];
      for (const ids of parts) errors.push(...Payroll.calculate("7", { lineIds: ids, skipFinish: true, fromJob: true }).errors);
      expect(errors).toEqual([]);
      expect(written(b.log)).toEqual(expected);
    });
  }

  test("dòng ngoài bảng lương trong lineIds bị bỏ qua; lô rỗng không ghi gì", () => {
    const a = fresh(12);
    Payroll.calculate("7", { lineIds: ["70001", "50001", "80002"], skipFinish: true, fromJob: true });
    expect(Object.keys(written(a.log))).toEqual(["70001"]);
    const b = fresh(12);
    expect(Payroll.calculate("7", { lineIds: [], skipFinish: true, fromJob: true }).errors).toEqual([]);
    expect(b.log.writes).toEqual([]);
  });

  test("finishCalculation cộng tổng từ cột gọn: bằng tổng các dòng đã ghi, không đọc JSON chi tiết để cộng", () => {
    const a = fresh(25);
    Payroll.calculate("7", { skipFinish: true });
    const lines = written(a.log);
    a.log.queries.length = 0;
    const r = Payroll.finishCalculation("7", [], false, 0);
    const sum = (k) => Object.values(lines).reduce((s, l) => s + (l[k] || 0), 0);
    expect(r.totals.emp_count).toBe(25);
    for (const k of ["gross", "ee_ins", "er_ins", "pit", "other_ded", "advance", "net", "accrued13"]) expect(r.totals[k]).toBeCloseTo(sum(k), 6);
    expect(r.status).toBe("C");
    const totals = a.log.queries.find((q) => q.tag === "s4vp_calc_totals");
    expect(totals.columns).not.toContain("detail");
  });
});

describe("số truy vấn và dữ liệu đọc của một lô", () => {
  /** Truy vấn của lô 10 dòng đầu, khi bảng lương có n dòng. */
  function chunkQueries(n) {
    const a = fresh(n);
    const ids = lineIdsOf(a.db).slice(0, 10);
    const json = Payroll.staticContext("7");
    a.log.queries.length = 0;
    Payroll.calculate("7", { lineIds: ids, skipFinish: true, fromJob: true, staticContext: json });
    return a.log.queries;
  }

  test("không tăng theo tổng số dòng của bảng lương (30 so với 600 dòng)", () => {
    const small = chunkQueries(30);
    const big = chunkQueries(600);
    expect(big.length).toBe(small.length);
    expect(big.map((q) => q.tag)).toEqual(small.map((q) => q.tag));
    const rows = (qs, name) => qs.filter((q) => q.name === name).reduce((s, q) => s + q.rows, 0);
    for (const name of ["batch_emp", "batch_input", "batch_time", "employee", "compensation", "advance", "ot_request", "alloc_version"]) expect(rows(big, name)).toBe(rows(small, name));
    // Dòng lương đọc: 10 dòng của lô + lũy kế OT của chính 10 người ở 2 bảng đã ghi sổ + phần đang cấn tạm ứng của người có phiếu
    expect(rows(big, "batch_emp")).toBeLessThanOrEqual(10 + 2 * 10 + 10);
    expect(big.length).toBeLessThanOrEqual(32);
  });

  test("không đọc JSON chi tiết của dòng ngoài phạm vi: dòng của lô không lấy cột detail; bảng khác chỉ phần của nhân viên trong lô", () => {
    const qs = chunkQueries(200);
    const lineReads = qs.filter((q) => q.name === "batch_emp");
    expect(lineReads.find((q) => q.tag === "s4vp_calc_lines").columns).not.toContain("detail");
    for (const q of lineReads.filter((x) => x.columns.includes("detail"))) expect(["s4vp_calc_pending", "s4vp_calc_prior"]).toContain(q.tag);
    // Không còn đọc mọi cột (Store.find) của dòng lương hay của bảng lương (clob messages / bills) trong lượt tính lô
    expect(qs.filter((q) => q.kind === "find" && ["batch_emp", "batch"].includes(q.name)).map((q) => q.name)).toEqual(["batch"]);
    // Ngữ cảnh tĩnh đến từ cache: không đọc thiết lập, tham số, quy tắc...
    for (const name of ["setup", "param", "pit_bracket", "ins_comp", "earning_rule", "earning_type", "holiday", "cost_account", "benefit_line"]) expect(qs.some((q) => q.name === name)).toBe(false);
  });
});

describe("ngữ cảnh tĩnh nhớ N/cache: kết quả không phụ thuộc cache", () => {
  test("cache trúng / không có / hỏng / của bảng lương khác / kỳ đã đổi: cùng kết quả", () => {
    const base = fresh(20);
    const json = Payroll.staticContext("7");
    Payroll.calculate("7", { skipFinish: true });
    const expected = written(base.log);
    const other = JSON.stringify(Object.assign(JSON.parse(json), { batch: "8" }));
    const otherPeriod = JSON.parse(json);
    otherPeriod.period.id = "99";
    for (const cached of [json, undefined, null, "{bad json", other, JSON.stringify(otherPeriod), JSON.stringify({ v: 999 })]) {
      const f = fresh(20);
      Payroll.calculate("7", { lineIds: lineIdsOf(f.db).slice(0, 9), skipFinish: true, fromJob: true, staticContext: cached });
      Payroll.calculate("7", { lineIds: lineIdsOf(f.db).slice(9), skipFinish: true, fromJob: true, staticContext: cached });
      expect(written(f.log)).toEqual(expected);
    }
  });

  test("chỉ chứa dữ liệu thiết lập, không có dòng lương hay nhân viên; kích thước nhỏ hơn nhiều so với 500 KB", () => {
    fresh(50);
    const json = Payroll.staticContext("7");
    const d = JSON.parse(json);
    expect(Object.keys(d).sort()).toEqual(["batch", "benefitPackages", "costAccounts", "earningTypes", "group", "holidays", "packageNames", "period", "provider", "rules", "settings", "v"].sort());
    expect(json).not.toMatch(/E00\d\d|Nguyễn|"employee"/);
    expect(Buffer.byteLength(json, "utf8")).toBeLessThan(100 * 1024);
  });
});

describe("Map/Reduce s4vp_mr_calculate", () => {
  /** Chạy đủ các bước; dropCache: xóa cache trước reduce (cache trượt). */
  function runMr(n, dropCache) {
    const a = fresh(n);
    mockState.usage = 5000;
    const input = Mr.getInputData();
    const mapped = [];
    input.forEach((v, i) => Mr.map({ key: String(i), value: JSON.stringify(v), write: (o) => mapped.push(o) }));
    if (dropCache) mockState.cache = {};
    const out = [];
    for (const m of mapped) {
      let used = 0;
      mockState.usage = 5000;
      // mỗi truy vấn của lô "tốn" 20 đơn vị để kiểm số đo governance
      const q0 = a.log.queries.length;
      const realRun = mockState.store.run;
      mockState.store.run = (...args) => {
        used += 20;
        mockState.usage = 5000 - used;
        return realRun(...args);
      };
      Mr.reduce({ key: m.key, values: [m.value], write: (o) => out.push(o) });
      mockState.store.run = realRun;
      expect(a.log.queries.length).toBeGreaterThan(q0);
    }
    const iter = (list) => ({ iterator: () => ({ each: (fn) => list.forEach((o) => fn(o.key, o.value)) }) });
    const noErrors = { errors: { iterator: () => ({ each: () => undefined }) }, seconds: 1, usage: 10, concurrency: 2, yields: 0 };
    Mr.summarize({ output: iter(out), mapSummary: noErrors, reduceSummary: noErrors, inputSummary: { error: null, seconds: 1, usage: 30 }, seconds: 9, usage: 500, concurrency: 2, yields: 0 });
    return { a, input, out };
  }

  test("chia lô 100, ghi đúng như tính đồng bộ cả bảng, nhớ ngữ cảnh tĩnh với ttl >= 900 giây; summarize gỡ khóa và đặt trạng thái", () => {
    const sync = fresh(230);
    Payroll.calculate("7", { skipFinish: true });
    const expected = written(sync.log);
    const { a, input, out } = runMr(230, false);
    expect(input.map((c) => c.lineIds.length)).toEqual([100, 100, 30]);
    expect(new Set(input.map((c) => c.run)).size).toBe(1);
    const head = Object.keys(mockState.cache).filter((k) => /^s4vp_calc\|c7_.*_n$/.test(k));
    expect(head).toHaveLength(1);
    for (const k of Object.keys(mockState.cache).filter((x) => x.startsWith("ttl|"))) expect(mockState.cache[k]).toBeGreaterThanOrEqual(900);
    expect(out.map((o) => JSON.parse(o.value).hit)).toEqual([true, true, true]);
    expect(written(a.log)).toEqual(expected);
    // Các lô không ghi lên bản ghi bảng lương; chỉ summarize ghi (tổng + gỡ khóa)
    const batchWrites = a.log.writes.filter((w) => w.name === "batch");
    expect(batchWrites.map((w) => Object.keys(w.values).includes("job") ? "job" : "totals")).toEqual(["totals", "job"]);
    expect(a.db.batch.find((b) => b.id === "7").status).toBe("C");
  });

  test("cache trượt: lô tự dựng lại ngữ cảnh, kết quả như cũ; log số đo không chứa số tiền / định danh nhân viên", () => {
    const sync = fresh(150);
    Payroll.calculate("7", { skipFinish: true });
    const expected = written(sync.log);
    const { a, out } = runMr(150, true);
    expect(written(a.log)).toEqual(expected);
    const stats = out.map((o) => JSON.parse(o.value));
    // lô đầu trượt rồi nhớ lại, lô sau trúng
    expect(stats.map((s) => s.hit)).toEqual([false, true]);
    expect(stats.every((s) => s.used > 0 && s.lines > 0)).toBe(true);
    const timing = mockState.logs.find((l) => l.title === "s4vp_mr_calculate timing");
    expect(timing.details).toMatch(/chunks 2 \(size 100\), lines 150/);
    expect(timing.details).toMatch(/cache misses 1/);
    expect(timing.details).toMatch(new RegExp(`max ${Math.max(...stats.map((s) => s.used))} of 5000`));
    const amounts = Object.values(expected).flatMap((v) => [v.gross, v.net, v.pit]).filter((x) => x > 1000).map(String);
    for (const l of mockState.logs) {
      for (const amt of amounts) expect(String(l.details)).not.toContain(amt);
      expect(String(l.details)).not.toMatch(/E0\d{3}|Nguyễn/);
    }
  });
});
