// Mô-đun route api/AdvancesV2 (giao diện bản 2): advancesView, employeeSearch với Store / Advances / Payroll / Clock giả.
// Kiểm: chỉ đọc, số đếm và thẻ số liệu tính trên toàn bộ phiếu, lịch sử cấn trừ gọn, phần đang chờ ở bảng lương chưa ghi sổ,
// kỳ dự kiến, truy vấn không lặp theo phiếu, tìm nhân viên tối đa 20 dòng với id ghép thẳng và JOIN phòng ban.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const mockDb = { advances: [], batches: [], periods: [], paygroups: [], lines: [], emps: {}, employees: [], accounts: [], jobs: [], calls: [], sql: [], writes: [], failJoin: false, failTx: false, today: "2027-03-30" };
const db = mockDb;

jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => mockDb.today }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Advances", () => ({
  list: (filter) => {
    mockDb.calls.push("Advances.list");
    return mockDb.advances.filter((a) => a.subsidiary === String(filter.subsidiary));
  },
  create: () => mockDb.writes.push("create"),
  removeHold: () => mockDb.writes.push("removeHold"),
  release: () => mockDb.writes.push("release"),
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Payroll", () => ({
  employeesInfo: (ids) => {
    mockDb.calls.push("employeesInfo");
    const out = {};
    for (const id of ids) if (mockDb.emps[id]) out[String(id)] = mockDb.emps[id];
    return out;
  },
  transactionsInfo: (ids) => {
    mockDb.calls.push("transactionsInfo");
    if (mockDb.failTx) throw new Error("no permission");
    const out = {};
    for (const id of ids) out[String(id)] = { tranid: `JE${id}` };
    return out;
  },
}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const write = (name) => () => {
    mockDb.writes.push(name);
    throw new Error("AdvancesV2 must not write");
  };
  return {
    rec: (name) => ({ type: `customrecord_s4vp_${name}`, fields: { employee: { id: "custrecord_s4vp_em_employee" }, subsidiary: { id: "custrecord_s4vp_em_subsidiary" } } }),
    find: (name, opt = {}) => {
      mockDb.calls.push(`find:${name}`);
      if (name === "batch") return mockDb.batches.filter((b) => b.subsidiary === String(opt.params[0]));
      if (name === "period") return mockDb.periods;
      if (name === "paygroup") return mockDb.paygroups;
      return [];
    },
    findIn: (name, field, ids, extraWhere) => {
      mockDb.calls.push(`findIn:${name}:${extraWhere || ""}`);
      if (name === "batch_emp") return mockDb.lines.filter((l) => ids.map(String).includes(String(l.batch)) && l.advance > 0);
      return [];
    },
    run: (sql, params, tag) => {
      mockDb.calls.push(`run:${tag}`);
      mockDb.sql.push({ sql, params, tag });
      const account = (a) => ({ id: a.id, acctnumber: a.number, name: a.name });
      if (tag === "s4vp_adv_cash") return mockDb.accounts.filter((a) => a.type === "Bank").map(account);
      if (tag === "s4vp_adv_cash_used") {
        const ids = /IN \(([\d,]+)\)/.exec(sql)[1].split(",");
        return mockDb.accounts.filter((a) => ids.includes(a.id)).map(account);
      }
      if (tag === "s4vp_adv_job") return mockDb.jobs;
      if (tag === "s4vp_adv_emp_search") {
        if (/LEFT JOIN department/.test(sql) && mockDb.failJoin) throw new Error("join not allowed");
        const q = params.length ? String(params[0]).replace(/%/g, "") : "";
        return mockDb.employees.filter((e) => !q || `${e.entityid} ${e.lastname} ${e.firstname}`.toLowerCase().includes(q)).slice(0, 21);
      }
      return [];
    },
    create: write("create"),
    update: write("update"),
    submit: write("submit"),
    remove: write("remove"),
  };
});

const V2 = require(path.join(API, "AdvancesV2"));

const adv = (id, status, extra) => Object.assign({ id: String(id), name: `TU00000${id}`, subsidiary: "13", employee: "7", doc_date: "2027-03-10", amount: 5000000, cash_account: "210", project: null, memo: "", status, offset: 0, balance: 0, journal: null, history: null }, extra);
const batch = (id, period, status, extra) => Object.assign({ id: String(id), name: `BL00000${id}`, subsidiary: "13", period: String(period), status, calculated: status !== "H", doc_date: "2027-03-05" }, extra);

beforeEach(() => {
  Object.assign(db, { calls: [], sql: [], writes: [], failJoin: false, failTx: false, today: "2027-03-30" });
  db.emps = { 7: { id: "7", code: "E012", name: "Nguyễn Văn An", departmentName: "Văn phòng" }, 8: { id: "8", code: "E013", name: "Trần Thị Bình", departmentName: "Kế toán" } };
  db.paygroups = [{ id: "1", name: "DEFAULT", subsidiary: null }, { id: "2", name: "OTHER", subsidiary: "14" }];
  db.periods = [
    { id: "2", name: "2027-02", paygroup: "1", start: "2027-02-01", end: "2027-02-28", status: "C" },
    { id: "3", name: "2027-03", paygroup: "1", start: "2027-03-01", end: "2027-03-31", status: "O" },
    { id: "4", name: "2027-04", paygroup: "1", start: "2027-04-01", end: "2027-04-30", status: "O" },
    { id: "9", name: "OTHER-03", paygroup: "2", start: "2027-03-01", end: "2027-03-31", status: "O" },
  ];
  db.batches = [batch(6, 2, "R"), batch(7, 3, "C"), batch(8, 3, "H"), batch(5, 3, "C", { subsidiary: "14" })];
  db.lines = [
    { id: "71", batch: "7", employee: "7", advance: 1500000, detail: JSON.stringify({ advanceOffsets: [{ refNbr: "TU000004", id: "4", amount: 1500000 }] }) },
    { id: "72", batch: "7", employee: "8", advance: 400000, detail: JSON.stringify({ advanceOffsets: [{ refNbr: "TU000005", amount: 400000 }] }) },
    { id: "73", batch: "7", employee: "9", advance: 0, detail: "{}" },
  ];
  db.accounts = [{ id: "210", number: "1121", name: "Tiền gửi VCB", type: "Bank" }, { id: "300", number: "1388", name: "Phải thu khác", type: "OthCurrAsset" }];
  db.jobs = [{ id: "50", entityid: "DA01", companyname: "Dự án A" }];
  db.advances = [
    adv(1, "H", { cash_account: null }),
    adv(2, "B", { amount: 3000000, employee: "8" }),
    adv(3, "C", { offset: 5000000, balance: 0, journal: "90", history: JSON.stringify([{ batch: "6", batchNbr: "BL000006", amount: 5000000 }]) }),
    adv(4, "O", { amount: 6000000, offset: 2000000, balance: 4000000, journal: "91", project: "50", history: JSON.stringify([{ batch: "6", batchNbr: "BL000006", amount: 2000000 }]) }),
    adv(5, "O", { amount: 400000, balance: 400000, journal: "92", employee: "8", cash_account: "300" }),
    adv(6, "O", { amount: 1000000, balance: 1000000, journal: "93", doc_date: "2027-04-02" }),
    adv(9, "O", { subsidiary: "14", balance: 1 }),
  ];
});

describe("routes", () => {
  test("khai hai route GET cho vai trò payroll, không có POST", () => {
    expect(Object.keys(V2.routes.get).sort()).toEqual(["advancesView", "employeeSearch"]);
    expect(V2.routes.get.advancesView.roles).toBe("payroll");
    expect(V2.routes.get.employeeSearch.roles).toBe("payroll");
    expect(Object.keys(V2.routes.post)).toEqual([]);
  });
});

describe("advancesView", () => {
  test("đếm theo trạng thái, thẻ số liệu và dòng tổng của công ty con", () => {
    const r = V2.routes.get.advancesView.run({ subsidiary: "13" });
    expect(r.counts).toEqual({ all: 6, H: 1, B: 1, O: 3, C: 1 });
    expect(r.cards.onHold).toEqual({ count: 1, amount: 5000000 });
    expect(r.cards.pendingPost).toEqual({ count: 1, amount: 3000000 });
    expect(r.cards.open).toEqual({ count: 3, balance: 5400000, pending: 1900000 });
    expect(r.totals).toEqual({ amount: 20400000, offset: 7000000, balance: 5400000 });
    expect(r.rows.map((x) => x.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(r.today).toBe("2027-03-30");
    expect(db.writes).toEqual([]);
  });

  test("dòng gọn: nhân viên, phòng ban, tài khoản tiền, dự án, số bút toán", () => {
    const r = V2.advancesView({ subsidiary: "13" });
    const a4 = r.rows.find((x) => x.id === "4");
    expect(a4).toMatchObject({ name: "TU000004", date: "2027-03-10", status: "O", employeeCode: "E012", employeeName: "Nguyễn Văn An", department: "Văn phòng", amount: 6000000, offset: 2000000, balance: 4000000, cashAccountName: "1121 Tiền gửi VCB", projectName: "DA01 Dự án A", journal: "91", journalNo: "JE91" });
    // Tài khoản không thuộc loại Bank vẫn có tên (truy vấn bổ sung theo id ghép thẳng)
    expect(r.rows.find((x) => x.id === "5").cashAccountName).toBe("1388 Phải thu khác");
    expect(db.sql.find((q) => q.tag === "s4vp_adv_cash_used").sql).toMatch(/IN \(300\)/);
    expect(r.cashAccounts).toEqual([{ id: "210", number: "1121", name: "Tiền gửi VCB" }]);
    // Phiếu chưa ghi sổ: không có số đã cấn trừ, số dư
    expect(r.rows.find((x) => x.id === "1")).toMatchObject({ offset: 0, balance: 0, cashAccount: null, cashAccountName: "", journal: null, history: [], pending: [], nextPeriod: null });
  });

  test("lịch sử cấn trừ theo bảng lương đã ghi sổ, kèm kỳ và ngày", () => {
    const r = V2.advancesView({ subsidiary: "13" });
    expect(r.rows.find((x) => x.id === "3").history).toEqual([{ batch: "6", batchNbr: "BL000006", period: "2027-02", date: "2027-03-05", amount: 5000000 }]);
  });

  test("phần đang cấn ở bảng lương đã tính chưa ghi sổ (theo id, thiếu id thì theo số phiếu) và kỳ dự kiến", () => {
    const r = V2.advancesView({ subsidiary: "13" });
    const a4 = r.rows.find((x) => x.id === "4");
    expect(a4.pending).toEqual([{ batch: "7", batchNbr: "BL000007", period: "2027-03", amount: 1500000 }]);
    expect(a4.pendingAmount).toBe(1500000);
    // Còn 2.500.000 chưa nằm trong bảng lương nào: kỳ mở sớm nhất kết thúc từ ngày phiếu, chưa có bảng lương đã ghi sổ
    expect(a4.nextPeriod).toEqual({ id: "3", name: "2027-03", end: "2027-03-31" });
    const a5 = r.rows.find((x) => x.id === "5");
    expect(a5.pending).toEqual([{ batch: "7", batchNbr: "BL000007", period: "2027-03", amount: 400000 }]);
    // Đã nằm trọn trong bảng lương đang mở: không còn kỳ dự kiến
    expect(a5.nextPeriod).toBeNull();
    // Phiếu ngày 02/04: kỳ 03 kết thúc trước ngày phiếu nên dự kiến kỳ 04; kỳ của nhóm lương công ty con khác bị loại
    expect(r.rows.find((x) => x.id === "6").nextPeriod).toMatchObject({ id: "4", name: "2027-04" });
    // Chỉ một lượt đọc dòng bảng lương, có điều kiện số cấn trừ > 0
    expect(db.calls.filter((c) => c.startsWith("findIn:batch_emp"))).toEqual(["findIn:batch_emp:{advance} > 0"]);
  });

  test("bảng lương đã ghi sổ, đã đảo hoặc chưa tính không tính là đang chờ", () => {
    db.lines.push({ id: "61", batch: "6", employee: "7", advance: 999, detail: JSON.stringify({ advanceOffsets: [{ id: "4", refNbr: "TU000004", amount: 999 }] }) });
    db.lines.push({ id: "81", batch: "8", employee: "7", advance: 888, detail: JSON.stringify({ advanceOffsets: [{ id: "4", refNbr: "TU000004", amount: 888 }] }) });
    const r = V2.advancesView({ subsidiary: "13" });
    expect(r.rows.find((x) => x.id === "4").pendingAmount).toBe(1500000);
  });

  test("kỳ đã có bảng lương ghi sổ không còn là kỳ dự kiến", () => {
    db.batches.push(batch(10, 3, "R"));
    const r = V2.advancesView({ subsidiary: "13" });
    expect(r.rows.find((x) => x.id === "4").nextPeriod).toMatchObject({ id: "4" });
  });

  test("đã tất toán trong kỳ: phiếu C có lần cấn trừ cuối thuộc kỳ chứa hôm nay", () => {
    let r = V2.advancesView({ subsidiary: "13" });
    expect(r.cards.settled).toEqual({ count: 0, amount: 0, period: "2027-03" });
    db.today = "2027-02-20";
    r = V2.advancesView({ subsidiary: "13" });
    expect(r.cards.settled).toEqual({ count: 1, amount: 5000000, period: "2027-02" });
  });

  test("lọc theo trạng thái: chỉ trả dòng khớp, số đếm và thẻ vẫn là của toàn bộ", () => {
    const r = V2.advancesView({ subsidiary: "13", status: "o" });
    expect(r.status).toBe("O");
    expect(r.rows.map((x) => x.id)).toEqual(["4", "5", "6"]);
    expect(r.counts.all).toBe(6);
    expect(r.cards.pendingPost.count).toBe(1);
    expect(r.totals).toEqual({ amount: 7400000, offset: 2000000, balance: 5400000 });
  });

  test("số truy vấn không tăng theo số phiếu", () => {
    V2.advancesView({ subsidiary: "13" });
    const few = db.calls.length;
    db.calls = [];
    for (let i = 0; i < 300; i++) db.advances.push(adv(100 + i, "O", { balance: 1000, journal: String(500 + i), employee: i % 2 ? "7" : "8" }));
    const r = V2.advancesView({ subsidiary: "13" });
    expect(r.rows).toHaveLength(306);
    expect(db.calls.length).toBe(few);
    expect(db.calls.filter((c) => c === "employeesInfo")).toHaveLength(1);
  });

  test("không có phiếu còn dư thì không đọc dòng bảng lương, không có dự án thì không hỏi tên dự án", () => {
    db.advances = [adv(1, "H"), adv(2, "B")];
    const r = V2.advancesView({ subsidiary: "13" });
    expect(r.counts).toEqual({ all: 2, H: 1, B: 1, O: 0, C: 0 });
    expect(db.calls.some((c) => c.startsWith("findIn:batch_emp"))).toBe(false);
    expect(db.calls.some((c) => c === "run:s4vp_adv_job")).toBe(false);
  });

  test("vai trò không đọc được giao dịch: vẫn mở được, bỏ số bút toán", () => {
    db.failTx = true;
    const r = V2.advancesView({ subsidiary: "13" });
    expect(r.rows.find((x) => x.id === "4")).toMatchObject({ journal: "91", journalNo: "" });
  });

  test("lịch sử hỏng hoặc trống không làm sập", () => {
    db.advances = [adv(4, "O", { balance: 100, history: "{oops" }), adv(5, "O", { balance: 100, history: "null" })];
    const r = V2.advancesView({ subsidiary: "13" });
    expect(r.rows.map((x) => x.history)).toEqual([[], []]);
  });

  test("từ chối khi thiếu công ty con hoặc trạng thái lạ", () => {
    expect(() => V2.advancesView({})).toThrow(/subsidiary/i);
    expect(() => V2.advancesView({ subsidiary: "13 OR 1=1" })).toThrow();
    let err;
    try {
      V2.advancesView({ subsidiary: "13", status: "X" });
    } catch (e) {
      err = e;
    }
    expect(err.userMessage.vi).toMatch(/Trạng thái/);
  });
});

describe("employeeSearch", () => {
  beforeEach(() => {
    db.employees = [];
    for (let i = 1; i <= 30; i++) db.employees.push({ id: i, entityid: `E${String(i).padStart(3, "0")}`, firstname: i % 2 ? "An" : "Bình", lastname: "Nguyễn Văn", deptname: "Văn phòng" });
  });

  test("tối đa 20 kết quả, chỉ mã + tên + phòng ban, báo còn kết quả", () => {
    const r = V2.routes.get.employeeSearch.run({ subsidiary: "13", q: "  NGUYỄN " });
    expect(r.items).toHaveLength(20);
    expect(r.more).toBe(true);
    expect(r.items[0]).toEqual({ id: "1", code: "E001", name: "Nguyễn Văn An", department: "Văn phòng" });
    expect(Object.keys(r.items[0]).sort()).toEqual(["code", "department", "id", "name"]);
  });

  test("câu lệnh: id công ty con ghép thẳng, JOIN hồ sơ lương và phòng ban, từ khóa là tham số, giới hạn 21 dòng", () => {
    V2.employeeSearch({ subsidiary: "13", q: "Bình%_" });
    const q = db.sql[0];
    expect(q.sql).toMatch(/INNER JOIN customrecord_s4vp_employee p ON p\.custrecord_s4vp_em_employee = e\.id/);
    expect(q.sql).toMatch(/LEFT JOIN department d ON d\.id = e\.department/);
    expect(q.sql).toMatch(/p\.custrecord_s4vp_em_subsidiary = 13/);
    expect(q.sql).toMatch(/ROWNUM <= 21/);
    expect(q.sql).not.toMatch(/bình/i);
    expect(q.params).toEqual(["%bình%", "%bình%", "%bình%"]);
    expect(db.sql).toHaveLength(1);
  });

  test("không gõ gì: 20 người đầu theo mã, không có điều kiện LIKE", () => {
    const r = V2.employeeSearch({ subsidiary: "13", q: "" });
    expect(r.items).toHaveLength(20);
    expect(db.sql[0].sql).not.toMatch(/LIKE/);
    expect(db.sql[0].params).toEqual([]);
  });

  test("ít kết quả: more = false", () => {
    const r = V2.employeeSearch({ subsidiary: "13", q: "e003" });
    expect(r).toEqual({ items: [{ id: "3", code: "E003", name: "Nguyễn Văn An", department: "Văn phòng" }], more: false });
  });

  test("vai trò không đọc được bảng department: dùng BUILTIN.DF", () => {
    db.failJoin = true;
    const r = V2.employeeSearch({ subsidiary: "13", q: "e003" });
    expect(r.items).toHaveLength(1);
    expect(db.sql[1].sql).toMatch(/BUILTIN\.DF\(e\.department\)/);
    expect(db.sql[1].sql).not.toMatch(/LEFT JOIN department/);
  });

  test("công ty con không phải số bị từ chối, không chạy truy vấn", () => {
    expect(() => V2.employeeSearch({ subsidiary: "13; DROP", q: "a" })).toThrow();
    expect(db.sql).toHaveLength(0);
  });
});
