// api/Output (phiếu sản lượng) trên Store giả trong bộ nhớ (tests/api/calcFake.js): phòng ban của phiếu (nhận từ tổ, đi tới
// shares[].sub và tới dòng phân bổ của bảng lương), từ chối kèm lý do, hủy phiếu tạm giữ (isinactive, không xóa).
const path = require("path");
const calcFake = require("./calcFake");

const mockState = { store: null, cache: {} };

jest.mock("N/query", () => ({}), { virtual: true });
jest.mock("N/record", () => ({ Type: {} }), { virtual: true });
jest.mock("N/format", () => ({ Type: { DATE: "date", DATETIMETZ: "dtz" }, format: () => { throw new Error("no format"); }, parse: () => null }), { virtual: true });
jest.mock("N/log", () => ({ audit: () => undefined, error: () => undefined, debug: () => undefined }), { virtual: true });
jest.mock("N/runtime", () => ({
  getCurrentUser: () => ({ id: 5, roleId: "administrator", getPreference: () => "vi_VN" }),
  getCurrentScript: () => ({ getParameter: () => "7", getRemainingUsage: () => 5000 }),
  ContextType: {},
}), { virtual: true });
jest.mock("N/cache", () => ({
  Scope: { PRIVATE: "PRIVATE", PROTECTED: "PROTECTED", PUBLIC: "PUBLIC" },
  getCache: ({ name }) => ({
    get: ({ key }) => (mockState.cache[`${name}|${key}`] === undefined ? null : mockState.cache[`${name}|${key}`]),
    put: ({ key, value }) => (mockState.cache[`${name}|${key}`] = String(value)),
    remove: ({ key }) => delete mockState.cache[`${name}|${key}`],
  }),
}), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const forward = {};
  for (const k of ["find", "findIn", "get", "run", "submit", "update", "create", "remove", "rec", "codeOf", "idOf", "memoize"]) forward[k] = (...a) => mockState.store[k](...a);
  forward.stats = [];
  return forward;
});
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Checks", () => ({}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/LaborAnalytics", () => ({}));

const Output = require(path.join(calcFake.ROOT, "api/Output"));
const Payroll = require(path.join(calcFake.ROOT, "api/Payroll"));
const AuditLog = require(path.join(calcFake.ROOT, "api/AuditLog"));

/** Dữ liệu mẫu của calcFake + update / create / remove ghi vào bộ nhớ (calcFake chỉ có submit). */
function fresh(n, tweak) {
  const db = calcFake.buildDb(n);
  db.team = [{ id: "5", name: "TO-1", subsidiary: "13", split_method: "E", project: "502", department: "77" }];
  // Quy tắc lương khoán: số lượng = tiền sản lượng của mọi bảng đơn giá, đơn giá 1
  db.earning_rule.push({
    id: "99", name: "KHOAN", description: "Lương khoán", sequence: 900, earning_type: calcFake.ET.THUONG, qty_source: "O", rate_source: "F", fixed_rate: 1, multiplier: 1, proration: "N", fail_action: "N", reduction: 0,
  });
  if (tweak) tweak(db);
  const f = calcFake.make(db);
  let seq = 900000;
  const check = (name, values) => {
    const def = f.store.rec(name);
    for (const key of Object.keys(values)) if (key !== "isInactive" && key !== "name" && !def.fields[key]) throw new Error(`Unknown field ${name}.${key}`);
  };
  f.store.update = (name, id, values) => {
    check(name, values);
    const row = (db[name] || []).find((r) => String(r.id) === String(id));
    if (!row) throw new Error(`${name} ${id} not found`);
    Object.assign(row, values);
    f.log.writes.push({ name, id: String(id), values: JSON.parse(JSON.stringify(values)), kind: "update" });
    return String(id);
  };
  f.store.create = (name, values) => {
    check(name, values);
    const id = String(++seq);
    (db[name] = db[name] || []).push(Object.assign({ id }, values));
    f.log.writes.push({ name, id, values: JSON.parse(JSON.stringify(values)), kind: "create" });
    return id;
  };
  f.store.remove = (name, id) => {
    f.log.writes.push({ name, id: String(id), kind: "remove" });
    db[name] = (db[name] || []).filter((r) => String(r.id) !== String(id));
  };
  mockState.store = f.store;
  mockState.cache = {};
  return { db, log: f.log };
}

const entryOf = (db, id) => db.output.find((e) => e.id === String(id));
const writtenLine = (log, lineId) => {
  let v = null;
  for (const w of log.writes) if (w.name === "batch_emp" && w.id === lineId) v = w.values;
  return v;
};

describe("phòng ban của phiếu sản lượng", () => {
  test("save nhận phòng ban từ tổ khi phiếu trống; phòng ban chọn trên phiếu được giữ", () => {
    const { db } = fresh(4);
    const a = Output.save({ subsidiary: "13", doc_date: "2027-03-10", period: "3", rate_table: "1", team: "5" });
    expect(entryOf(db, a.id)).toMatchObject({ type: "T", department: "77", project: "502", split_method: "E", status: "H" });
    const b = Output.save({ subsidiary: "13", doc_date: "2027-03-10", period: "3", rate_table: "1", team: "5", department: "31" });
    expect(entryOf(db, b.id).department).toBe("31");
    // Sửa phiếu không gửi department: giữ phòng ban đang có
    Output.save({ id: b.id, description: "Sửa diễn giải" });
    expect(entryOf(db, b.id)).toMatchObject({ department: "31", description: "Sửa diễn giải" });
    const c = Output.save({ subsidiary: "13", doc_date: "2027-03-10", period: "3", rate_table: "1", type: "I" });
    expect(entryOf(db, c.id).department).toBeNull();
  });

  test("forPayroll: phòng ban của phiếu đi vào shares[].sub; phiếu không khai giữ nguyên dạng cũ", () => {
    const { db } = fresh(6, (d) => (d.output.find((e) => e.id === "2").department = "77"));
    const r = Output.forPayroll("3", "7", null, "13");
    expect(r.shares["101"]).toEqual([{ refNbr: "SL000001", rateTable: "DG1", isSales: false, project: "501", branch: "", workCenter: "", amount: 500000 }]);
    expect(r.shares["102"]).toEqual([{ refNbr: "SL000002", rateTable: "DG1", isSales: false, project: "502", branch: "", workCenter: "", sub: "77", amount: 400000 }]);
    expect(db.output).toHaveLength(2);
  });

  test("tính lương: phần lương khoán của phiếu có phòng ban hạch toán về phòng ban đó; tổng phân bổ = gross + BH DN; phiếu không khai cho kết quả như cũ", () => {
    // Không phòng ban: kết quả gốc
    const a = fresh(12);
    expect(Payroll.calculate("7", { skipFinish: true }).errors).toEqual([]);
    const base = writtenLine(a.log, "70001");
    // Thêm trường department rỗng cho mọi phiếu: kết quả y hệt
    const b = fresh(12, (d) => d.output.forEach((e) => (e.department = null)));
    Payroll.calculate("7", { skipFinish: true });
    expect(writtenLine(b.log, "70001")).toEqual(base);
    for (const id of ["70002", "70006", "70011"]) expect(writtenLine(b.log, id)).toEqual(writtenLine(a.log, id));

    // Phiếu cá nhân SL000001 (nhân viên 101: 500.000, dự án 501) khai phòng ban 77
    const c = fresh(12, (d) => (d.output.find((e) => e.id === "1").department = "77"));
    Payroll.calculate("7", { skipFinish: true });
    const v = writtenLine(c.log, "70001");
    const detail = JSON.parse(v.detail);
    const piece = detail.allocations.filter((x) => x.source === "S");
    expect(piece).toEqual([expect.objectContaining({ component: "GROSS", project: "501", sub: "77", amount: 500000 })]);
    // Phần còn lại vẫn theo phòng ban của nhân viên như trước
    const rest = detail.allocations.filter((x) => x.source !== "S");
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((x) => x.sub !== "77")).toBe(true);
    const total = detail.allocations.reduce((s, x) => s + x.amount, 0);
    expect(total).toBe(v.gross + v.er_ins);
    // Số liệu lương không đổi, chỉ cơ cấu phân bổ đổi
    for (const k of ["gross", "er_ins", "pit", "net", "taxable"]) expect(v[k]).toBe(base[k]);
    expect(JSON.parse(base.detail).allocations.some((x) => x.sub === "77")).toBe(false);
  });

  test("quy tắc gắn một bảng đơn giá (lưu internal id) lấy đúng tiền sản lượng của bảng đó theo mã", () => {
    // Quy tắc KHOAN trỏ bảng đơn giá id 1 (mã DG1): trước khi sửa, id "1" không khớp khóa "DG1" nên ra 0
    const free = fresh(12);
    Payroll.calculate("7", { skipFinish: true });
    const want = writtenLine(free.log, "70001");
    const bound = fresh(12, (d) => (d.earning_rule.find((r) => r.id === "99").rate_table = "1"));
    Payroll.calculate("7", { skipFinish: true });
    const got = writtenLine(bound.log, "70001");
    const khoan = (v) => JSON.parse(v.detail).earnings.filter((e) => e.ruleCode === "KHOAN").reduce((s, e) => s + e.amount, 0);
    expect(khoan(want)).toBeGreaterThan(0);
    expect(khoan(got)).toBe(khoan(want));
  });
});

describe("từ chối phiếu chờ duyệt (op reject)", () => {
  const pending = (d) => Object.assign(d.output.find((e) => e.id === "1"), { status: "P" });

  test("P -> H, lưu lý do từ chối gần nhất, trả kỳ và số phiếu cho nhật ký", () => {
    const { db } = fresh(4, pending);
    const r = Output.act("1", "reject", { reason: "  Sai khối lượng tổ 2  " });
    expect(r).toEqual({ id: "1", name: "SL000001", period: "3", op: "reject", status: "H", reason: "Sai khối lượng tổ 2" });
    expect(entryOf(db, 1)).toMatchObject({ status: "H", reject_reason: "Sai khối lượng tổ 2", approved_by: null });
  });

  test("lý do bắt buộc; chỉ phiếu chờ duyệt; hold giữ nghĩa trả về tạm giữ, không cần lý do", () => {
    const { db } = fresh(4, pending);
    expect(() => Output.act("1", "reject", { reason: "   " })).toThrow(/lý do từ chối/);
    expect(() => Output.act("1", "reject")).toThrow(/reason/);
    expect(entryOf(db, 1).status).toBe("P");
    expect(() => Output.act("2", "reject", { reason: "x" })).toThrow(/not allowed/);
    expect(Output.act("1", "hold")).toMatchObject({ status: "H", op: "hold" });
    expect(entryOf(db, 1).reject_reason).toBeUndefined();
  });

  test("nhật ký: nhãn và diễn giải theo op, gắn kỳ của phiếu", () => {
    const row = AuditLog.build({ action: "outputAction", period: "3", id: "1", result: { id: "1", name: "SL000001", period: "3", op: "reject", status: "H", reason: "Sai khối lượng" } });
    expect(row).toMatchObject({ action: "outputAction", period: "3", line: "SL000001", text_vi: "SL000001 - từ chối: Sai khối lượng", text_en: "SL000001 - rejected: Sai khối lượng" });
    expect(AuditLog.labelOf("outputAction", "vi")).toBe("Xử lý phiếu sản lượng");
  });
});

describe("hủy phiếu tạm giữ (voidEntry)", () => {
  const hold = (d) => Object.assign(d.output.find((e) => e.id === "1"), { status: "H" });

  test("đặt isinactive và ghi lý do, không xóa phiếu, dòng, thành viên", () => {
    const { db, log } = fresh(4, hold);
    const lines = db.output_line.length;
    const r = Output.voidEntry("1", "Nhập trùng phiếu SL000002");
    expect(r).toEqual({ id: "1", name: "SL000001", period: "3", status: "H", voided: true, reason: "Nhập trùng phiếu SL000002" });
    expect(entryOf(db, 1)).toMatchObject({ isInactive: true, void_reason: "Nhập trùng phiếu SL000002", status: "H" });
    expect(db.output_line).toHaveLength(lines);
    expect(log.writes.filter((w) => w.kind === "remove")).toEqual([]);
    expect(log.writes.filter((w) => w.name === "output")).toEqual([{ name: "output", id: "1", values: { isInactive: true, void_reason: "Nhập trùng phiếu SL000002" }, kind: "update" }]);
  });

  test("phiếu đã hủy không vào bảng lương, không sửa, không chuyển trạng thái được nữa", () => {
    const { db } = fresh(4, hold);
    Output.voidEntry("1", "Nhập trùng");
    entryOf(db, 1).status = "A"; // kể cả khi trạng thái bị sửa ngoài gói
    expect(Output.forPayroll("3", "7", null, "13").refNbrs).toEqual(["SL000002"]);
    expect(() => Output.act("1", "submit")).toThrow(/voided/);
    expect(() => Output.save({ id: "1", description: "x" })).toThrow(/đã bị hủy/);
    expect(() => Output.voidEntry("1", "lần hai")).toThrow(/voided/);
  });

  test("chỉ phiếu tạm giữ chưa vào bảng lương; lý do bắt buộc", () => {
    const { db } = fresh(4);
    expect(() => Output.voidEntry("1", "x")).toThrow(/Chỉ hủy được phiếu đang tạm giữ/); // phiếu đã duyệt
    entryOf(db, 1).status = "H";
    expect(() => Output.voidEntry("1", "")).toThrow(/lý do hủy/);
    entryOf(db, 1).batch = "7";
    expect(() => Output.voidEntry("1", "x")).toThrow(/bảng lương/);
    expect(() => Output.voidEntry("", "x")).toThrow(/not found/);
    expect(entryOf(db, 1).isInactive).toBeFalsy();
  });

  test("nhật ký: nhãn Hủy phiếu sản lượng kèm số phiếu và lý do", () => {
    const row = AuditLog.build({ action: "voidOutput", period: "3", id: "1", result: { id: "1", name: "SL000001", period: "3", voided: true, reason: "Nhập trùng" } });
    expect(row).toMatchObject({ action: "voidOutput", period: "3", line: "SL000001", text_vi: "SL000001: Nhập trùng" });
    expect(AuditLog.labelOf("voidOutput", "en")).toBe("Voided an output entry");
  });
});
