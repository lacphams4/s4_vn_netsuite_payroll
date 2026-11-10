// Phân tích chi phí lương (api/LaborAnalytics): dạng dữ liệu theo docs/UI_V2.md mục 13 trên Store giả, NO_GL_ACCESS, NO_FACTS,
// FACTS_OUTDATED, số truy vấn không tăng theo số nhân viên, laborDrill, rebuildLaborFacts theo lượt, refreshFacts không ném lỗi.
const path = require("path");
const ROOT = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll");

const mockDb = {};
const db = mockDb;

jest.mock("N/log", () => ({ error: (o) => mockDb.logs.push(o.details), audit: () => {}, debug: () => {} }), { virtual: true });
jest.mock("N/runtime", () => ({
  getCurrentScript: () => ({ getRemainingUsage: () => mockDb.usage }),
  getCurrentUser: () => ({ id: 5 }),
}), { virtual: true });
jest.mock("N/cache", () => ({
  Scope: { PROTECTED: "PROTECTED" },
  getCache: () => {
    if (mockDb.noCache) throw new Error("no cache");
    return {
      get: ({ key }) => (key in mockDb.cache ? mockDb.cache[key] : null),
      put: ({ key, value }) => {
        mockDb.cache[key] = value;
      },
      remove: ({ key }) => {
        delete mockDb.cache[key];
      },
    };
  },
}), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2027-04-30" }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({
  resolve: () => ({ accounts: { acc_expense: "642" }, location: "L0" }),
  earningTypes: () => {
    mockDb.calls.push("settings:earningTypes");
    return { byCode: { LUONG: { category: "B" }, OT150: { category: "O", isOvertime: true }, PHUCAP: { category: "A" } } };
  },
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const Schema = jest.requireActual("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Schema");
  const s = (v) => (v === null || v === undefined ? "" : String(v));
  const monthOfBatch = (b) => {
    const p = mockDb.periods.find((x) => x.id === b.period) || {};
    const d = b.doc_date || p.end || "";
    return d.slice(0, 4) + d.slice(5, 7);
  };
  const activeFacts = (sub) => mockDb.facts.filter((f) => f.subsidiary === s(sub) && f.active === true && !f.isInactive);
  const posted = (sub) => mockDb.batches.filter((b) => b.subsidiary === s(sub) && b.status === "R" && b.journal);
  const group = (rows, keyOf, init, add) => {
    const map = new Map();
    for (const r of rows) {
      const k = JSON.stringify(keyOf(r));
      if (!map.has(k)) map.set(k, init(r));
      add(map.get(k), r);
    }
    return [...map.values()];
  };
  const acc = (id) => mockDb.accounts[s(id)] || {};
  const handlers = {
    s4vp_la_latest: (sql, [sub]) => [{ month: activeFacts(sub).map((f) => f.month).sort().pop() || null }],
    s4vp_la_monthly: (sql, [sub, from, to]) => group(activeFacts(sub).filter((f) => f.month >= from && f.month <= to), (f) => [f.month, f.component, acc(f.account).accttype],
      (f) => ({ month: f.month, component: f.component, accttype: acc(f.account).accttype || null, amount: 0, hours: 0 }), (g, f) => {
        g.amount += f.amount;
        g.hours += f.hours;
      }),
    s4vp_la_headcount: (sql, [sub, st, from, to]) => {
      const rows = [];
      for (const b of posted(sub)) {
        const m = monthOfBatch(b);
        if (m < from || m > to) continue;
        for (const l of mockDb.lines.filter((x) => x.batch === b.id)) rows.push({ month: m, etype: l.employment_type || null, employee: l.employee });
      }
      return group(rows, (r) => [r.month, r.etype], (r) => ({ month: r.month, etype: r.etype, set: new Set() }), (g, r) => g.set.add(r.employee)).map((g) => ({ month: g.month, etype: g.etype, headcount: g.set.size }));
    },
    s4vp_la_dept_headcount: (sql, [sub, st, ctr, ...months]) => {
      if (mockDb.failDeptJoin) throw new Error("join not allowed");
      const rows = [];
      for (const b of posted(sub)) {
        const m = monthOfBatch(b);
        if (!months.includes(m)) continue;
        for (const l of mockDb.lines.filter((x) => x.batch === b.id && x.employment_type !== ctr)) rows.push({ month: m, k: mockDb.empDept[l.employee] || null, employee: l.employee });
      }
      return group(rows, (r) => [r.month, r.k], (r) => ({ month: r.month, k: r.k, set: new Set() }), (g, r) => g.set.add(r.employee)).map((g) => ({ month: g.month, k: g.k, headcount: g.set.size }));
    },
    s4vp_la_breakdown: (sql, [sub, ...months]) => {
      if (mockDb.failLabelJoin && / d ON d\.id/.test(sql)) throw new Error("join not allowed");
      const m = /f\.custrecord_s4vp_lcf_(\w+) AS k/.exec(sql);
      const field = m ? m[1] : null;
      const df = /BUILTIN\.DF/.test(sql);
      return group(activeFacts(sub).filter((f) => months.includes(f.month)), (f) => [f.month, field ? f[field] : "", f.component], (f) => {
        const row = { month: f.month, component: f.component, amount: 0 };
        if (field) row.k = f[field] || null;
        if (field === "account") Object.assign(row, { code: acc(f.account).num || null, label: acc(f.account).name || null, accttype: acc(f.account).accttype || null });
        else if (field === "project") Object.assign(row, { code: f.project ? `PRJ-${f.project}` : null, label: (mockDb.labels.project || {})[f.project] || null });
        else if (field && field !== "employment_type") row.label = f[field] ? (df ? `DF ${f[field]}` : (mockDb.labels[field] || {})[f[field]] || null) : null;
        return row;
      }, (g, f) => {
        g.amount += f.amount;
      });
    },
    s4vp_la_gl: (sql, [sub, from, to]) => {
      if (mockDb.failGl || mockDb.failBook) throw new Error("permission");
      return mockDb.gl.filter((r) => `${r.month.slice(0, 4)}-${r.month.slice(4)}-01` >= from && `${r.month.slice(0, 4)}-${r.month.slice(4)}-01` <= to).map((r) => Object.assign({}, r));
    },
    s4vp_la_batches: (sql, [sub, from, to]) => mockDb.batches.filter((b) => b.subsidiary === s(sub) && b.journal && monthOfBatch(b) >= from && monthOfBatch(b) <= to).map((b) => {
      const fs = activeFacts(sub).filter((f) => f.batch === b.id);
      return { id: b.id, status: b.status, journal: b.journal, month: monthOfBatch(b), gross: b.gross, er_ins: b.er_ins, accrued13: b.accrued13, facts: fs.length, amount: fs.length ? fs.reduce((t, f) => t + f.amount, 0) : null };
    }),
    // Trích tháng 13 bút toán thực ghi: dòng nhân viên (không phải cộng tác viên) có số trích dương, gom theo bảng lương
    s4vp_la_batch_accruals: (sql, [sub, ctr, from, to]) => {
      if (mockDb.failAccruals) throw new Error("join not allowed");
      const ids = mockDb.batches.filter((b) => b.subsidiary === s(sub) && b.journal && monthOfBatch(b) >= from && monthOfBatch(b) <= to).map((b) => b.id);
      return group(mockDb.lines.filter((l) => ids.includes(l.batch) && !l.isInactive && l.accrued13 > 0 && l.employment_type !== ctr), (l) => [l.batch], (l) => ({ batch: l.batch, accrued13: 0 }), (g, l) => {
        g.accrued13 += l.accrued13;
      });
    },
    s4vp_la_fact_accounts: (sql, [sub, month]) => group(activeFacts(sub).filter((f) => f.month === month), (f) => [f.account], (f) => ({ account: f.account, num: acc(f.account).num || null, name: acc(f.account).name || null, amount: 0 }), (g, f) => {
      g.amount += f.amount;
    }),
    s4vp_la_journal_accounts: (sql) => {
      if (mockDb.failJournal) throw new Error("permission");
      const ids = /IN \(([\d,]+)\)/.exec(sql)[1].split(",");
      const rows = [];
      for (const id of ids) rows.push(...(mockDb.journals[id] || []));
      return group(rows, (r) => [r.account], (r) => ({ account: r.account, num: acc(r.account).num || r.account, name: acc(r.account).name || null, debit: 0, credit: 0 }), (g, r) => {
        g.debit += r.debit;
        g.credit += r.credit;
      });
    },
    s4vp_la_employees: (sql) => /IN \(([\d,]+)\)/.exec(sql)[1].split(",").filter((id) => mockDb.employees[id]).map((id) => Object.assign({ id }, mockDb.employees[id])),
  };
  handlers.s4vp_la_breakdown_df = handlers.s4vp_la_breakdown;
  // s4vp_la_gl_nobook dùng lại bộ lọc của s4vp_la_gl nhưng không bị chặn bởi failBook
  handlers.s4vp_la_gl_nobook = (sql, [sub, from, to]) => {
    if (mockDb.failGl) throw new Error("permission");
    return mockDb.gl.filter((r) => `${r.month.slice(0, 4)}-${r.month.slice(4)}-01` >= from && `${r.month.slice(0, 4)}-${r.month.slice(4)}-01` <= to).map((r) => Object.assign({}, r));
  };
  const table = (name) => ({ cost_fact: mockDb.facts, batch: mockDb.batches, batch_emp: mockDb.lines, period: mockDb.periods, paygroup: [{ id: "1", name: "DEFAULT" }] })[name] || [];
  return {
    rec: (name) => Schema.records[name],
    codeOf: (list, id) => (id === null || id === undefined || id === "" ? null : String(id)),
    idOf: (list, code) => code,
    run(sql, params, scriptId) {
      mockDb.calls.push(`run:${scriptId}`);
      mockDb.sql[scriptId] = sql;
      if (!handlers[scriptId]) throw new Error(`unexpected query ${scriptId}`);
      return handlers[scriptId](sql, params || []);
    },
    find(name, opt = {}) {
      mockDb.calls.push(`find:${name}`);
      if (mockDb.failFind === name) throw new Error("find failed for 123456789");
      const rows = table(name).filter((r) => !r.isInactive);
      if (name === "cost_fact" || name === "batch_emp") return rows.filter((r) => r.batch === s(opt.params[0])).map((r) => Object.assign({}, r));
      if (name === "batch") return rows.filter((r) => r.subsidiary === s(opt.params[0]) && r.journal).map((r) => Object.assign({}, r));
      return rows.map((r) => Object.assign({}, r));
    },
    findIn(name, field, ids) {
      mockDb.calls.push(`findIn:${name}`);
      const set = new Set((ids || []).map(String));
      return table(name).filter((r) => set.has(s(r[field]))).map((r) => Object.assign({}, r));
    },
    get(name, id) {
      mockDb.calls.push(`get:${name}`);
      const r = table(name).find((x) => x.id === s(id));
      return r ? Object.assign({}, r) : null;
    },
    create(name, values) {
      if (name !== "cost_fact") throw new Error(`unexpected create ${name}`);
      mockDb.usage -= 6;
      const id = String(mockDb.nextId++);
      mockDb.facts.push(Object.assign({ id, isInactive: false }, values));
      mockDb.writes.push(`create:${id}`);
      return id;
    },
    submit(name, id, values) {
      if (name !== "cost_fact") throw new Error(`unexpected submit ${name}`);
      mockDb.usage -= 2;
      Object.assign(mockDb.facts.find((f) => f.id === s(id)), values);
      mockDb.writes.push(`submit:${id}`);
    },
    update: () => {
      throw new Error("unexpected update");
    },
    remove: () => {
      throw new Error("facts must never be deleted");
    },
  };
});

const LA = require(path.join(ROOT, "api/LaborAnalytics"));
const Journal = require(path.join(ROOT, "core/PayrollJournalBuilder"));

const jeConfig = {
  payableAccount: "334", contractorPayableAccount: "3388", pitPayableAccount: "3335", accrued13thAccount: "335", defaultExpenseAccount: "642", interBranch: true,
  components: { ER: { name: "BH DN", liabilityAccount: "3383" } },
};

/** Bảng lương đã ghi sổ với n nhân viên (lẻ: phòng D1 tài khoản 642, chẵn: phòng D2 tài khoản 632 giá vốn) và một cộng tác viên. */
function addBatch(id, month, n, opt = {}) {
  const base = opt.base || 20000000;
  const lines = [];
  for (let i = 1; i <= n; i++) {
    const cogs = i % 2 === 0;
    const ot = i % 3 === 0 ? 2000000 : 0;
    const gross = base + ot;
    const er = Math.round(base * 0.215);
    const dim = { account: cogs ? "632" : "642", sub: cogs ? "D2" : "D1", project: cogs ? "P1" : "", branch: "", workCenter: cogs ? "WC1" : "" };
    const emp = String(100 + i);
    db.empDept[emp] = cogs ? "D2" : "D1";
    db.employees[emp] = { entityid: `NV${emp}`, firstname: "An", lastname: `Nguyễn ${emp}`, deptname: cogs ? "Sản xuất" : "Văn phòng" };
    lines.push({
      id: `${id}-${i}`, isInactive: false, batch: id, employee: emp, employment_type: "E", gross, er_ins: er, accrued13: 1000000,
      detail: JSON.stringify({
        earnings: [{ earningType: "LUONG", amount: base, source: "S" }].concat(ot ? [{ earningType: "OT150", amount: ot, source: "S" }] : []),
        allocations: [Object.assign({ component: "GROSS", amount: gross, hours: 176, source: "D" }, dim), Object.assign({ component: "ERINS", amount: er }, dim)],
        expenseAccount: "", expenseSub: "",
      }),
    });
  }
  db.employees["900"] = { entityid: "CTV900", firstname: "", lastname: "", deptname: "" };
  lines.push({ id: `${id}-c`, isInactive: false, batch: id, employee: "900", employment_type: "C", gross: 5000000, er_ins: 0, accrued13: 0,
    detail: JSON.stringify({ earnings: [{ earningType: "LUONG", amount: 5000000 }], allocations: [{ component: "GROSS", amount: 5000000, account: "642", sub: "D1", project: "", branch: "", workCenter: "" }] }) });
  const sum = (k) => lines.reduce((t, l) => t + l[k], 0);
  const batch = Object.assign({ id, isInactive: false, name: `BL${id}`, subsidiary: "13", period: `p${month}`, status: "R", journal: `90${id}`, doc_date: null, gross: sum("gross"), er_ins: sum("er_ins"), accrued13: sum("accrued13") }, opt.batch);
  if (!db.periods.some((p) => p.id === `p${month}`)) db.periods.push({ id: `p${month}`, isInactive: false, name: month, paygroup: "1", start: `${month.slice(0, 4)}-${month.slice(4)}-01`, end: `${month.slice(0, 4)}-${month.slice(4)}-28` });
  db.batches.push(batch);
  db.lines.push(...lines);
  const je = Journal.buildRelease({
    batchNbr: batch.name, periodId: month, branch: "", date: "", grossTotal: batch.gross, employerInsTotal: batch.er_ins,
    employees: lines.map((l) => {
      const d = JSON.parse(l.detail);
      return { employee: l.employee, employmentType: l.employment_type, netPay: l.gross, pit: 0, accrued13th: l.accrued13, expenseAccount: "", expenseSub: "", insurance: [{ code: "ER", employeeAmount: 0, employerAmount: l.er_ins }], deductions: [], advanceOffsets: [], allocations: d.allocations };
    }),
  }, jeConfig);
  db.journals[batch.journal] = je.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit }));
  return batch;
}

const rebuildAll = (body) => {
  let r;
  let guard = 0;
  const total = { done: 0, total: 0 };
  do {
    r = LA.routes.post.rebuildLaborFacts.run(body || { subsidiary: "13" });
    total.done += r.done;
    total.total += r.total;
  } while (r.more && ++guard < 50);
  return Object.assign(total, { calls: guard + 1 });
};
const analytics = (params) => LA.routes.get.laborAnalytics.run(Object.assign({ subsidiary: "13" }, params));
const queries = () => db.calls.filter((c) => c.startsWith("run:"));

beforeEach(() => {
  Object.assign(db, {
    facts: [], nextId: 1, batches: [], lines: [], periods: [], empDept: {}, employees: {}, journals: {}, cache: {}, calls: [], writes: [], logs: [], sql: {}, usage: 5000,
    failGl: false, failBook: false, failJournal: false, failLabelJoin: false, failDeptJoin: false, failAccruals: false, failFind: null, noCache: false,
    accounts: { 642: { num: "642", name: "Chi phí quản lý", accttype: "Expense" }, 632: { num: "632", name: "Giá vốn", accttype: "COGS" } },
    labels: { department: { D1: "Văn phòng", D2: "Sản xuất" }, class: { WC1: "Chuyền 1" }, location: { L0: "Trụ sở" }, project: { P1: "Dự án Một" } },
    gl: [
      { month: "202703", accttype: "Income", debit: 0, credit: 900000000 }, { month: "202703", accttype: "COGS", debit: 400000000, credit: 0 }, { month: "202703", accttype: "Expense", debit: 250000000, credit: 0 },
      { month: "202704", accttype: "Income", debit: 10000000, credit: 1000000000 }, { month: "202704", accttype: "OthIncome", debit: 0, credit: 10000000 },
      { month: "202704", accttype: "COGS", debit: 450000000, credit: 0 }, { month: "202704", accttype: "Expense", debit: 280000000, credit: 0 }, { month: "202704", accttype: "OthExpense", debit: 20000000, credit: 0 },
      { month: "202704", accttype: "Bank", debit: 999, credit: 0 },
    ],
  });
});

describe("route", () => {
  test("ba route, roles acct; thiếu công ty con hoặc tham số sai -> lỗi nghiệp vụ", () => {
    expect(Object.keys(LA.routes.get)).toEqual(["laborAnalytics", "laborDrill"]);
    expect(Object.keys(LA.routes.post)).toEqual(["rebuildLaborFacts"]);
    for (const r of [LA.routes.get.laborAnalytics, LA.routes.get.laborDrill, LA.routes.post.rebuildLaborFacts]) expect(r.roles).toBe("acct");
    const vi = (fn) => {
      try {
        fn();
      } catch (e) {
        return e.userMessage.vi;
      }
      return null;
    };
    expect(vi(() => LA.routes.get.laborAnalytics.run({}))).toMatch(/công ty con/);
    expect(vi(() => analytics({ month: "2027-13" }))).toMatch(/YYYY-MM/);
    expect(vi(() => analytics({ month: "2027-04", compare: "last" }))).toMatch(/so sánh/);
    expect(vi(() => analytics({ month: "2027-04", dim: "employee" }))).toMatch(/Chiều/);
    expect(vi(() => LA.routes.post.rebuildLaborFacts.run({}))).toMatch(/công ty con/);
  });
});

describe("laborAnalytics", () => {
  beforeEach(() => {
    addBatch("3", "202703", 4);
    addBatch("4", "202704", 6, { base: 21000000 });
    rebuildAll();
    db.calls = [];
  });

  test("dạng dữ liệu đúng hợp đồng mục 13", () => {
    const r = analytics({ month: "2027-04" });
    expect(Object.keys(r)).toEqual(["subsidiary", "month", "compare", "compareMode", "months", "kpis", "bridge", "breakdown", "pnl", "reconcile", "notes"]);
    expect(r).toMatchObject({ subsidiary: "13", month: "2027-04", compare: "2027-03", compareMode: "prev", notes: [] });
    expect(r.months).toHaveLength(12);
    expect(r.months[0].month).toBe("2026-05");
    expect(Object.keys(r.months[11])).toEqual(["month", "labor", "laborCogs", "laborOpex", "wages", "overtime", "allowance", "bonus", "piecework", "other", "employerIns", "accrued13", "contractor", "headcount", "hours", "revenue", "cogs", "opex", "netIncome", "hasGl"]);
    expect(Object.keys(r.kpis)).toEqual(["labor", "laborToRevenue", "laborInCogs", "laborInOpex", "headcount", "costPerHead", "overtimeShare", "costPerHour"]);
    for (const k of Object.values(r.kpis)) expect(Object.keys(k)).toEqual(["cur", "prev", "yoy"]);
    expect(r.bridge.map((s) => s.key)).toEqual(["start", "headcount", "wages", "overtime", "allowance", "bonus", "piecework", "other", "employerIns", "accrued13", "contractor", "end"]);
    expect(r.breakdown.dim).toBe("department");
    expect(r.breakdown.dims).toEqual(["department", "project", "class", "location", "account", "component", "employmentType"]);
    expect(Object.keys(r.breakdown.rows[0])).toEqual(["key", "label", "cur", "prev", "components", "diff", "pct", "share", "headcount", "prevHeadcount", "perHead"]);
    expect(r.pnl.map((x) => x.key)).toEqual(["revenue", "cogs", "laborCogs", "grossProfit", "opex", "laborOpex", "operatingProfit"]);
    for (const x of r.pnl) expect(Object.keys(x)).toEqual(["key", "cur", "prev", "diff", "pct", "ofRevenue"]);
    expect(Object.keys(r.reconcile)).toEqual(["rows", "ok"]);
    expect(Object.keys(r.reconcile.rows[0])).toEqual(["account", "accountNumber", "accountName", "payroll", "gl", "difference"]);
  });

  test("số liệu tháng: tổng = thu nhập + BH doanh nghiệp + trích tháng 13, tách giá vốn theo loại tài khoản, sổ cái đúng dấu", () => {
    const r = analytics({ month: "2027-04" });
    const apr = r.months[11];
    const b = db.batches.find((x) => x.id === "4");
    expect(apr.labor).toBe(b.gross + b.er_ins + b.accrued13);
    expect(apr.wages).toBe(6 * 21000000);
    expect(apr.overtime).toBe(2 * 2000000);
    expect(apr.employerIns).toBe(b.er_ins);
    expect(apr.accrued13).toBe(6000000);
    expect(apr.contractor).toBe(5000000);
    // Nhân viên chẵn (3 người) hạch toán 632 (COGS): lương + OT của người thứ 6 + BH
    expect(apr.laborCogs).toBe(3 * 21000000 + 2000000 + 3 * Math.round(21000000 * 0.215));
    expect(apr.laborOpex).toBe(apr.labor - apr.laborCogs);
    expect(apr.headcount).toBe(6);
    expect(apr.hours).toBe(6 * 176);
    expect(apr).toMatchObject({ revenue: 1000000000, cogs: 450000000, opex: 300000000, netIncome: 250000000, hasGl: true });
    expect(r.months[10]).toMatchObject({ month: "2027-03", headcount: 4, revenue: 900000000, hasGl: true });
    expect(r.months[9]).toMatchObject({ month: "2027-02", labor: 0, headcount: 0, revenue: 0, hasGl: false });
  });

  test("chỉ số, cầu biến động, lãi lỗ", () => {
    const r = analytics({ month: "2027-04" });
    const cur = r.months[11];
    const prev = r.months[10];
    expect(r.kpis.labor).toEqual({ cur: cur.labor, prev: prev.labor, yoy: null });
    expect(r.kpis.headcount).toEqual({ cur: 6, prev: 4, yoy: null });
    expect(r.kpis.laborToRevenue.cur).toBeCloseTo(cur.labor / 1000000000, 6);
    expect(r.kpis.laborInCogs.cur).toBeCloseTo(cur.laborCogs / 450000000, 6);
    expect(r.kpis.laborInOpex.cur).toBeCloseTo(cur.laborOpex / 300000000, 6);
    expect(r.kpis.costPerHead.cur).toBeCloseTo((cur.labor - 5000000) / 6, 4);
    expect(r.kpis.overtimeShare.cur).toBeCloseTo(4000000 / cur.labor, 6);
    expect(r.kpis.costPerHour.cur).toBeCloseTo(cur.labor / (6 * 176), 4);
    const step = (k) => r.bridge.find((s) => s.key === k).amount;
    expect(step("start")).toBe(prev.labor);
    expect(step("end")).toBe(cur.labor);
    expect(step("headcount")).toBe(Math.round((2 * (prev.labor - 5000000)) / 4));
    expect(r.bridge.filter((s) => s.key !== "start" && s.key !== "end").reduce((t, s) => t + s.amount, 0)).toBe(cur.labor - prev.labor);
    const pnl = (k) => r.pnl.find((x) => x.key === k);
    expect(pnl("revenue")).toMatchObject({ cur: 1000000000, prev: 900000000, diff: 100000000, ofRevenue: 1 });
    expect(pnl("revenue").pct).toBeCloseTo(0.111111, 6);
    expect(pnl("grossProfit")).toMatchObject({ cur: 550000000, prev: 500000000 });
    expect(pnl("laborCogs")).toMatchObject({ cur: cur.laborCogs, prev: prev.laborCogs });
    expect(pnl("laborOpex").ofRevenue).toBeCloseTo(cur.laborOpex / 1000000000, 6);
    expect(pnl("operatingProfit")).toMatchObject({ cur: 250000000, prev: 250000000, diff: 0, pct: 0 });
  });

  test("phân rã theo phòng ban: nhãn bằng JOIN, số người theo phòng, tổng các dòng = chi phí tháng", () => {
    const r = analytics({ month: "2027-04", dim: "department" });
    const rows = r.breakdown.rows;
    expect(rows.reduce((t, x) => t + x.cur, 0)).toBe(r.months[11].labor);
    expect(rows.reduce((t, x) => t + x.prev, 0)).toBe(r.months[10].labor);
    const d2 = rows.find((x) => x.key === "D2");
    expect(d2).toMatchObject({ label: "Sản xuất", headcount: 3, prevHeadcount: 2, cur: r.months[11].laborCogs });
    expect(d2.components).toMatchObject({ wages: 63000000, overtime: 2000000, employerIns: 3 * Math.round(21000000 * 0.215), contractor: 0 });
    expect(d2.perHead).toBeCloseTo(d2.cur / 3, 4);
    expect(d2.share).toBeCloseTo(d2.cur / r.months[11].labor, 6);
    expect(d2.diff).toBe(d2.cur - d2.prev);
    // Trích tháng 13 không có phòng ban: nhóm khóa rỗng
    expect(rows.find((x) => x.key === "")).toMatchObject({ label: "", cur: 6000000, headcount: 0 });
    expect(rows.map((x) => x.cur)).toEqual(rows.map((x) => x.cur).slice().sort((a, b) => b - a));
    expect(db.sql.s4vp_la_breakdown).toMatch(/LEFT JOIN department d ON d\.id = f\.custrecord_s4vp_lcf_department/);
    expect(db.sql.s4vp_la_breakdown).not.toMatch(/BUILTIN\.DF/);
  });

  test("các chiều khác: tài khoản (số hiệu, cờ giá vốn), dự án, class, địa điểm, thành phần, loại lao động", () => {
    const acc = analytics({ month: "2027-04", dim: "account" }).breakdown.rows;
    expect(acc.find((x) => x.key === "632")).toMatchObject({ label: "632 Giá vốn", accountNumber: "632", inCogs: true, headcount: null, perHead: null });
    expect(acc.find((x) => x.key === "642")).toMatchObject({ inCogs: false });
    expect(analytics({ month: "2027-04", dim: "project" }).breakdown.rows.find((x) => x.key === "P1").label).toBe("Dự án Một");
    expect(analytics({ month: "2027-04", dim: "class" }).breakdown.rows.find((x) => x.key === "WC1").label).toBe("Chuyền 1");
    expect(analytics({ month: "2027-04", dim: "location" }).breakdown.rows.map((x) => [x.key, x.label])).toEqual([["L0", "Trụ sở"]]);
    const comp = analytics({ month: "2027-04", dim: "component" }).breakdown.rows;
    expect(comp.map((x) => x.key).sort()).toEqual(["accrued13", "contractor", "employerIns", "overtime", "wages"]);
    expect(comp.find((x) => x.key === "wages")).toMatchObject({ label: "wages", cur: 126000000, prev: 80000000 });
    const et = analytics({ month: "2027-04", dim: "employmentType" }).breakdown.rows;
    expect(et.find((x) => x.key === "C")).toMatchObject({ cur: 5000000, headcount: 1, prevHeadcount: 1, perHead: 5000000 });
    expect(et.find((x) => x.key === "E")).toMatchObject({ headcount: 6, prevHeadcount: 4 });
  });

  test("JOIN nhãn bị từ chối -> dùng BUILTIN.DF trên dòng đã gom; JOIN nhân viên bị từ chối -> số người theo phòng để trống", () => {
    db.failLabelJoin = true;
    db.failDeptJoin = true;
    const rows = analytics({ month: "2027-04", dim: "department" }).breakdown.rows;
    expect(rows.find((x) => x.key === "D1")).toMatchObject({ label: "DF D1", headcount: null, prevHeadcount: null, perHead: null });
  });

  test("đối chiếu sổ cái: số liệu theo tài khoản = Nợ - Có của bút toán lương trong tháng", () => {
    const r = analytics({ month: "2027-04" });
    expect(r.reconcile.ok).toBe(true);
    expect(r.reconcile.rows.map((x) => x.accountNumber)).toEqual(["632", "642"]);
    for (const row of r.reconcile.rows) {
      expect(row.gl).toBe(row.payroll);
      expect(row.difference).toBe(0);
    }
    expect(r.reconcile.rows.reduce((t, x) => t + x.payroll, 0)).toBe(r.months[11].labor);
    expect(db.sql.s4vp_la_journal_accounts).toMatch(/IN \(904\)/);
    // Bút toán có thêm Nợ chi phí chưa vào số liệu -> lệch, kể cả tài khoản lạ
    db.journals["904"].push({ account: "642", debit: 700, credit: 0 }, { account: "641", debit: 300, credit: 0 });
    const bad = analytics({ month: "2027-04" }).reconcile;
    expect(bad.ok).toBe(false);
    expect(bad.rows.find((x) => x.account === "642").difference).toBe(-700);
    expect(bad.rows.find((x) => x.account === "641")).toMatchObject({ payroll: 0, gl: 300, difference: -300 });
  });

  test("NO_GL_ACCESS: sổ cái không đọc được thì các trường sổ cái = null, phần lương vẫn đủ", () => {
    db.failGl = true;
    db.failJournal = true;
    const r = analytics({ month: "2027-04" });
    expect(r.notes).toEqual(["NO_GL_ACCESS"]);
    const apr = r.months[11];
    expect(apr).toMatchObject({ revenue: null, cogs: null, opex: null, netIncome: null, hasGl: false, headcount: 6 });
    expect(apr.labor).toBeGreaterThan(0);
    expect(r.kpis.laborToRevenue).toEqual({ cur: null, prev: null, yoy: null });
    expect(r.kpis.laborInCogs.cur).toBeNull();
    expect(r.kpis.costPerHead.cur).toBeGreaterThan(0);
    expect(r.pnl.find((x) => x.key === "revenue")).toEqual({ key: "revenue", cur: null, prev: null, diff: null, pct: null, ofRevenue: null });
    expect(r.pnl.find((x) => x.key === "laborCogs")).toMatchObject({ cur: apr.laborCogs, ofRevenue: null });
    expect(r.reconcile.ok).toBeNull();
    expect(r.reconcile.rows.every((x) => x.gl === null && x.difference === null && x.payroll > 0)).toBe(true);
    expect(r.bridge.find((s) => s.key === "end").amount).toBe(apr.labor);
  });

  test("sổ cái: không lọc được theo sổ chính thì thử lại không có điều kiện sổ; đọc được mà không có dòng lãi lỗ nào -> NO_GL_ACCESS", () => {
    db.failBook = true;
    expect(analytics({ month: "2027-04" }).months[11].revenue).toBe(1000000000);
    expect(queries()).toContain("run:s4vp_la_gl_nobook");
    db.failBook = false;
    db.gl = [{ month: "202704", accttype: "Bank", debit: 5, credit: 0 }];
    expect(analytics({ month: "2027-04", fresh: "1" }).notes).toEqual(["NO_GL_ACCESS"]);
  });

  test("sổ cái các tháng đã qua được nhớ (N/cache theo người dùng); tháng hiện tại luôn đọc trực tiếp; fresh bỏ qua bản nhớ", () => {
    const glQueries = () => queries().filter((c) => c === "run:s4vp_la_gl").length;
    expect(analytics({ month: "2027-04" }).months[10].revenue).toBe(900000000);
    expect(glQueries()).toBe(2); // tháng đã qua + tháng hiện tại (hôm nay 2027-04-30)
    expect(Object.keys(db.cache)).toEqual(["gl_5__13_202604_202703"]);
    db.gl.find((r) => r.month === "202703" && r.accttype === "Income").credit = 1;
    db.gl.find((r) => r.month === "202704" && r.accttype === "COGS").debit = 460000000;
    db.calls = [];
    const again = analytics({ month: "2027-04" });
    expect(glQueries()).toBe(1);
    expect(again.months[10].revenue).toBe(900000000);
    expect(again.months[11].cogs).toBe(460000000);
    expect(analytics({ month: "2027-04", fresh: "1" }).months[10].revenue).toBe(1);
    expect(analytics({ month: "2027-04" }).months[10].revenue).toBe(1);
    // Xem một tháng đã qua: cả khoảng nằm trong bản nhớ riêng, không có truy vấn tháng hiện tại
    db.calls = [];
    analytics({ month: "2027-03" });
    analytics({ month: "2027-03" });
    expect(glQueries()).toBe(1);
    // Không đọc được sổ cái thì không nhớ; không có N/cache vẫn chạy
    db.cache = {};
    db.failGl = true;
    expect(analytics({ month: "2027-04" }).notes).toEqual(["NO_GL_ACCESS"]);
    expect(db.cache).toEqual({});
    db.failGl = false;
    db.noCache = true;
    expect(analytics({ month: "2027-04" }).months[11].revenue).toBe(1000000000);
  });

  test("loại tài khoản dạng tên đầy đủ ('Cost of Goods Sold', 'Other Income') vẫn phân loại đúng", () => {
    db.accounts["632"].accttype = "Cost of Goods Sold";
    db.gl = [
      { month: "202704", accttype: "Income", debit: 0, credit: 100 }, { month: "202704", accttype: "Other Income", debit: 0, credit: 10 },
      { month: "202704", accttype: "Cost of Goods Sold", debit: 40, credit: 0 }, { month: "202704", accttype: "Other Expense", debit: 5, credit: 0 },
    ];
    const apr = analytics({ month: "2027-04" }).months[11];
    expect(apr).toMatchObject({ revenue: 110, cogs: 40, opex: 5, netIncome: 65 });
    expect(apr.laborCogs).toBe(3 * 21000000 + 2000000 + 3 * Math.round(21000000 * 0.215));
  });

  test("tháng mặc định = tháng mới nhất có số liệu; so sánh yoy, tháng chỉ định; NO_COMPARE", () => {
    const r = analytics({});
    expect(r).toMatchObject({ month: "2027-04", compare: "2027-03", notes: [] });
    const yoy = analytics({ month: "2027-04", compare: "yoy" });
    expect(yoy).toMatchObject({ compare: "2026-04", compareMode: "yoy" });
    expect(yoy.notes).toEqual(["NO_COMPARE"]);
    expect(yoy.kpis.labor.prev).toBeNull();
    expect(yoy.bridge.find((s) => s.key === "start").amount).toBe(0);
    expect(yoy.breakdown.rows.every((x) => x.prev === 0 && x.pct === null)).toBe(true);
    const fixed = analytics({ month: "2027-03", compare: "2027-04" });
    expect(fixed).toMatchObject({ month: "2027-03", compare: "2027-04" });
    expect(fixed.kpis.headcount).toMatchObject({ cur: 4, prev: 6 });
  });

  test("FACTS_OUTDATED: bảng lương đã ghi sổ thiếu số liệu, số liệu lệch tổng, hoặc bảng đã đảo còn số liệu", () => {
    addBatch("5", "202704", 2);
    expect(analytics({ month: "2027-04" }).notes).toEqual(["FACTS_OUTDATED"]);
    rebuildAll();
    expect(analytics({ month: "2027-04" }).notes).toEqual([]);
    db.facts.find((f) => f.batch === "5" && f.active).amount += 1;
    expect(analytics({ month: "2027-04" }).notes).toEqual(["FACTS_OUTDATED"]);
    rebuildAll();
    db.batches.find((b) => b.id === "5").status = "V";
    expect(analytics({ month: "2027-04" }).notes).toEqual(["FACTS_OUTDATED"]);
    rebuildAll();
    expect(analytics({ month: "2027-04" }).notes).toEqual([]);
    expect(analytics({ month: "2027-04" }).months[11].headcount).toBe(6);
  });

  test("FACTS_OUTDATED không báo sai khi cộng tác viên hoặc dòng âm mang số trích tháng 13 (bút toán chỉ trích nhân viên, số dương)", () => {
    // Dòng cộng tác viên có accrued13 khác 0 và một dòng nhân viên âm: tổng trên bảng lương cộng cả hai, bút toán và số liệu thì không
    const ctv = db.lines.find((l) => l.batch === "4" && l.employment_type === "C");
    ctv.accrued13 = 700000;
    db.lines.find((l) => l.id === "4-1").accrued13 = -250000;
    const b = db.batches.find((x) => x.id === "4");
    b.accrued13 = db.lines.filter((l) => l.batch === "4").reduce((t, l) => t + l.accrued13, 0);
    rebuildAll();
    const posted = 5000000;
    expect(b.accrued13).toBe(posted + 700000 - 250000);
    expect(db.facts.filter((f) => f.batch === "4" && f.active && f.component === "accrued13").reduce((t, f) => t + f.amount, 0)).toBe(posted);
    expect(analytics({ month: "2027-04" }).notes).toEqual([]);
    expect(db.sql.s4vp_la_batch_accruals).toMatch(/custrecord_s4vp_be_accrued13 > 0/);
    expect(db.sql.s4vp_la_batch_accruals).toMatch(/GROUP BY/);
    // Số liệu lệch thật vẫn bị báo
    db.facts.find((f) => f.batch === "4" && f.active).amount += 1;
    expect(analytics({ month: "2027-04" }).notes).toEqual(["FACTS_OUTDATED"]);
    rebuildAll();
    // Không đọc được dòng nhân viên theo cách gom này: dùng tổng trên bảng lương như trước (không lỗi)
    db.failAccruals = true;
    expect(analytics({ month: "2027-04" }).notes).toEqual(["FACTS_OUTDATED"]);
    ctv.accrued13 = 0;
    db.lines.find((l) => l.id === "4-1").accrued13 = 1000000;
    b.accrued13 = 6000000;
    rebuildAll();
    expect(analytics({ month: "2027-04" }).notes).toEqual([]);
  });

  test("chỉ truy vấn gom nhóm: không đọc dòng nhân viên, dưới 12 truy vấn, số truy vấn không tăng theo số nhân viên", () => {
    analytics({ month: "2027-04" });
    const small = db.calls.slice();
    expect(small.every((c) => c.startsWith("run:"))).toBe(true);
    expect(small.length).toBeLessThan(12);
    for (const sql of Object.values(db.sql)) if (/SUM\(/.test(sql)) expect(sql).toMatch(/GROUP BY|MAX\(/);
    addBatch("6", "202704", 1200);
    rebuildAll();
    db.calls = [];
    db.cache = {}; // so sánh hai lượt gọi lạnh (lượt nóng bớt một truy vấn sổ cái nhờ bản nhớ)
    const big = analytics({ month: "2027-04" });
    expect(db.calls).toEqual(small);
    expect(big.months[11].headcount).toBe(1200);
    expect(big.reconcile.ok).toBe(true);
    expect(big.notes).toEqual([]);
  });
});

describe("NO_FACTS", () => {
  test("chưa có số liệu: notes NO_FACTS, 12 tháng bằng 0, không lỗi", () => {
    const r = analytics({});
    expect(r.month).toBe("2027-04");
    expect(r.notes).toEqual(["NO_FACTS", "NO_COMPARE"]);
    expect(r.months).toHaveLength(12);
    expect(r.months.every((m) => m.labor === 0 && m.headcount === 0)).toBe(true);
    expect(r.months[11]).toMatchObject({ revenue: 1000000000, hasGl: true });
    expect(r.kpis.labor).toEqual({ cur: null, prev: null, yoy: null });
    expect(r.breakdown.rows).toEqual([]);
    expect(r.reconcile).toEqual({ rows: [], ok: true });
    expect(r.bridge.every((s) => s.amount === 0)).toBe(true);
  });

  test("bảng lương đã ghi sổ nhưng chưa lập số liệu: NO_FACTS và FACTS_OUTDATED", () => {
    addBatch("3", "202703", 2);
    expect(analytics({ month: "2027-03" }).notes).toEqual(["NO_FACTS", "NO_COMPARE", "FACTS_OUTDATED"]);
  });
});

describe("laborDrill", () => {
  beforeEach(() => {
    addBatch("3", "202703", 4);
    addBatch("4", "202704", 6, { base: 21000000 });
    rebuildAll();
    db.calls = [];
  });

  test("chi tiết tới nhân viên của một phòng ban, tổng = dòng phân rã", () => {
    const row = analytics({ month: "2027-04" }).breakdown.rows.find((x) => x.key === "D2");
    const r = LA.routes.get.laborDrill.run({ subsidiary: "13", month: "2027-04", compare: "prev", dim: "department", key: "D2" });
    expect(r).toMatchObject({ month: "2027-04", compare: "2027-03", dim: "department", key: "D2" });
    expect(Object.keys(r.rows[0])).toEqual(["employee", "code", "name", "department", "cur", "prev", "components", "diff", "pct", "batch", "line"]);
    // Bảng lương và dòng lương của tháng đang xem, để mở thẳng màn Chạy lương
    expect(r.rows.map((x) => [x.employee, x.batch, x.line]).sort()).toEqual([["102", "4", "4-2"], ["104", "4", "4-4"], ["106", "4", "4-6"]]);
    expect(r.rows.map((x) => x.employee).sort()).toEqual(["102", "104", "106"]);
    expect(r.rows.reduce((t, x) => t + x.cur, 0)).toBe(row.cur);
    expect(r.rows.reduce((t, x) => t + x.prev, 0)).toBe(row.prev);
    const e106 = r.rows.find((x) => x.employee === "106");
    expect(e106).toMatchObject({ code: "NV106", name: "Nguyễn 106 An", department: "Sản xuất", prev: 0, pct: null });
    expect(e106.components).toMatchObject({ wages: 21000000, overtime: 2000000, employerIns: Math.round(21000000 * 0.215) });
    expect(r.rows[0].employee).toBe("106");
  });

  test("theo thành phần, loại lao động và khóa rỗng (trích tháng 13 không phòng ban)", () => {
    const ot = LA.laborDrill({ subsidiary: "13", month: "2027-04", dim: "component", key: "overtime" });
    expect(ot.rows.map((x) => [x.employee, x.cur, x.prev])).toEqual([["103", 2000000, 2000000], ["106", 2000000, 0]]);
    const ctv = LA.laborDrill({ subsidiary: "13", month: "2027-04", dim: "employmentType", key: "C" });
    expect(ctv.rows).toHaveLength(1);
    expect(ctv.rows[0]).toMatchObject({ employee: "900", code: "CTV900", cur: 5000000, prev: 5000000, diff: 0 });
    const none = LA.laborDrill({ subsidiary: "13", month: "2027-04", dim: "department", key: "" });
    expect(none.rows).toHaveLength(6);
    expect(none.rows.every((x) => x.cur === 1000000 && x.components.accrued13 === 1000000)).toBe(true);
    expect(LA.laborDrill({ subsidiary: "13", month: "2027-04", dim: "project", key: "KHONG-CO" }).rows).toEqual([]);
    expect(() => LA.laborDrill({ subsidiary: "13", month: "2027-04", dim: "employee", key: "1" })).toThrow(/dimension/);
  });

  test("batch / line: nhiều bảng lương trong tháng thì lấy bảng có số tiền của nhóm lớn nhất; chỉ có ở kỳ so sánh thì null", () => {
    // Bảng 7 cùng tháng 04: nhân viên 101, 102 có thêm một dòng lương nhỏ hơn (lương cơ sở 5 triệu)
    addBatch("7", "202704", 2, { base: 5000000 });
    // Bảng 9 cùng tháng: lớn hơn bảng 4 cho nhân viên 101
    addBatch("9", "202704", 1, { base: 40000000 });
    rebuildAll();
    const d1 = LA.laborDrill({ subsidiary: "13", month: "2027-04", dim: "department", key: "D1" });
    const of = (rows, emp) => rows.find((x) => x.employee === emp);
    expect(of(d1.rows, "101")).toMatchObject({ batch: "9", line: "9-1", cur: (21000000 + 5000000 + 40000000) + Math.round(21000000 * 0.215) + Math.round(5000000 * 0.215) + Math.round(40000000 * 0.215) });
    expect(of(d1.rows, "103")).toMatchObject({ batch: "4", line: "4-3" });
    // Cộng tác viên 900 có mặt ở cả ba bảng với cùng số tiền: lấy bảng có id nhỏ nhất
    expect(of(d1.rows, "900")).toMatchObject({ batch: "4", line: "4-c" });
    // Xem tháng 03 so với tháng 04: nhân viên 105 chỉ có ở kỳ so sánh -> không có bảng lương của tháng đang xem
    const mar = LA.laborDrill({ subsidiary: "13", month: "2027-03", compare: "2027-04", dim: "department", key: "D1" });
    expect(of(mar.rows, "105")).toMatchObject({ cur: 0, batch: null, line: null });
    expect(of(mar.rows, "101")).toMatchObject({ batch: "3", line: "3-1" });
  });

  test("chỉ đọc dòng của các bảng lương trong hai tháng, một lần cho mọi bảng", () => {
    addBatch("2", "202701", 3);
    rebuildAll();
    db.calls = [];
    LA.laborDrill({ subsidiary: "13", month: "2027-04", dim: "department", key: "D1" });
    expect(db.calls.filter((c) => c === "findIn:batch_emp")).toHaveLength(1);
    expect(db.calls.filter((c) => c === "settings:earningTypes")).toHaveLength(1);
    expect(db.calls.filter((c) => c === "run:s4vp_la_employees")).toHaveLength(1);
  });
});

describe("rebuildLaborFacts và refreshFacts", () => {
  test("lập số liệu: tổng mỗi bảng = thu nhập + BH doanh nghiệp + trích tháng 13; chạy lại không ghi gì", () => {
    const b3 = addBatch("3", "202703", 4);
    const b4 = addBatch("4", "202704", 6, { batch: { doc_date: "2027-05-02" } });
    const r = rebuildAll();
    expect(r).toMatchObject({ done: 2, total: 2, calls: 1 });
    const total = (id) => db.facts.filter((f) => f.batch === id && f.active).reduce((t, f) => t + f.amount, 0);
    expect(total("3")).toBe(b3.gross + b3.er_ins + b3.accrued13);
    expect(total("4")).toBe(b4.gross + b4.er_ins + b4.accrued13);
    // Tháng theo ngày bút toán (ngày chứng từ, trống thì ngày cuối kỳ)
    expect([...new Set(db.facts.filter((f) => f.batch === "3").map((f) => `${f.month}|${f.posting_date}`))]).toEqual(["202703|2027-03-28"]);
    expect([...new Set(db.facts.filter((f) => f.batch === "4").map((f) => `${f.month}|${f.posting_date}`))]).toEqual(["202705|2027-05-02"]);
    expect(db.facts.every((f) => f.subsidiary === "13" && f.active === true)).toBe(true);
    const count = db.facts.length;
    db.writes = [];
    expect(rebuildAll()).toMatchObject({ done: 2, total: 2 });
    expect(db.writes).toEqual([]);
    expect(db.facts).toHaveLength(count);
  });

  test("lọc theo tháng; bảng lương đã đảo thì bỏ hiệu lực, không xóa; ghi sổ lại thì dùng lại dòng cũ", () => {
    addBatch("3", "202703", 4);
    addBatch("4", "202704", 4);
    expect(rebuildAll({ subsidiary: "13", month: "2027-04" })).toMatchObject({ done: 1, total: 1 });
    expect([...new Set(db.facts.map((f) => f.batch))]).toEqual(["4"]);
    const count = db.facts.length;
    db.batches.find((b) => b.id === "4").status = "V";
    rebuildAll();
    expect(db.facts.filter((f) => f.batch === "4")).toHaveLength(count);
    expect(db.facts.filter((f) => f.batch === "4").every((f) => f.active === false)).toBe(true);
    db.batches.find((b) => b.id === "4").status = "R";
    db.writes = [];
    rebuildAll();
    expect(db.facts.filter((f) => f.batch === "4")).toHaveLength(count);
    expect(db.facts.filter((f) => f.batch === "4").every((f) => f.active === true)).toBe(true);
    expect(db.writes.every((w) => w.startsWith("submit:"))).toBe(true);
  });

  test("hết hạn mức giữa chừng: trả more, lượt sau làm tiếp từ vị trí đã nhớ; total chỉ báo ở lượt đầu", () => {
    for (let i = 1; i <= 5; i++) addBatch(String(i), "202704", 3);
    db.usage = 400 + 6 + 3; // đủ cho đúng hai dòng số liệu của bảng đầu tiên (kiểm hạn mức trước mỗi lần ghi)
    const first = LA.rebuildLaborFacts({ subsidiary: "13" });
    expect(first).toEqual({ more: true, done: 0, total: 5 });
    expect(db.facts).toHaveLength(2);
    db.usage = 400 + 6 * 20; // xong bảng 1 và 2, dở bảng 3
    const second = LA.rebuildLaborFacts({ subsidiary: "13" });
    expect(second.more).toBe(true);
    expect(second.total).toBe(0);
    expect(second.done).toBeGreaterThanOrEqual(1);
    db.usage = 5000;
    db.calls = [];
    const third = LA.rebuildLaborFacts({ subsidiary: "13" });
    expect(third.more).toBeUndefined();
    expect(third.total).toBe(0);
    expect(first.done + second.done + third.done).toBe(5);
    // Lượt cuối không đọc lại bảng đã xong
    expect(db.calls.filter((c) => c === "find:batch_emp").length).toBe(5 - second.done);
    expect(db.cache).toEqual({});
    for (const b of db.batches) expect(db.facts.filter((f) => f.batch === b.id && f.active).reduce((t, f) => t + f.amount, 0)).toBe(b.gross + b.er_ins + b.accrued13);
    expect(new Set(db.facts.map((f) => [f.batch, f.account, f.department, f.class, f.location, f.project, f.employment_type, f.component].join("|"))).size).toBe(db.facts.length);
  });

  test("không có N/cache vẫn hội tụ: lượt sau làm lại từ đầu nhưng không ghi trùng", () => {
    db.noCache = true;
    addBatch("1", "202704", 3);
    addBatch("2", "202704", 3);
    db.usage = 400 + 6 * 8;
    expect(LA.rebuildLaborFacts({ subsidiary: "13" }).more).toBe(true);
    db.usage = 5000;
    const r = LA.rebuildLaborFacts({ subsidiary: "13" });
    expect(r).toEqual({ done: 2, total: 2 });
    expect(new Set(db.facts.map((f) => [f.batch, f.account, f.department, f.class, f.project, f.employment_type, f.component].join("|"))).size).toBe(db.facts.length);
  });

  test("refreshFacts sau ghi sổ / đảo: ok khi ghi đủ; lỗi không ném ra, log không chứa chữ số", () => {
    const b = addBatch("3", "202703", 4);
    expect(LA.refreshFacts("3")).toMatchObject({ ok: true });
    expect(db.facts.filter((f) => f.active).reduce((t, f) => t + f.amount, 0)).toBe(b.gross + b.er_ins + b.accrued13);
    db.batches[0].status = "V";
    expect(LA.refreshFacts("3")).toMatchObject({ ok: true, rows: 0 });
    expect(db.facts.some((f) => f.active)).toBe(false);
    expect(LA.refreshFacts("404")).toEqual({ ok: false });
    db.failFind = "cost_fact";
    expect(LA.refreshFacts("3")).toEqual({ ok: false });
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0].replace("batch 3", "")).not.toMatch(/\d/);
    // Hết hạn mức: không ghi đủ -> ok = false (nơi gọi gắn FACTS_OUTDATED)
    db.failFind = null;
    db.batches[0].status = "R";
    db.usage = 401;
    expect(LA.refreshFacts("3").ok).toBe(false);
  });
});
