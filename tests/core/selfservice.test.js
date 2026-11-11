// Cổng tự phục vụ nhân viên: phần tính thuần (core/SelfService), lớp kiểm quyền và các op (core/SelfServiceOps) với Store,
// Attendance giả, và trang (core/SelfServicePage: đủ chữ hai ngôn ngữ, không lộ dữ liệu ngoài boot). Không gọi NetSuite.
const { core } = require("./helpers");
const SS = core("SelfService");
const Ops = core("SelfServiceOps");
const Page = core("SelfServicePage");

describe("maskTail", () => {
  test("chỉ giữ 4 ký tự cuối", () => {
    expect(SS.maskTail("0312345678")).toBe("****5678");
    expect(SS.maskTail("1903 1234 5678 901")).toBe("****8901");
  });
  test("chuỗi ngắn giữ không quá nửa độ dài, rỗng trả rỗng", () => {
    expect(SS.maskTail("123456")).toBe("****456");
    expect(SS.maskTail("12")).toBe("****2");
    expect(SS.maskTail("1")).toBe("****");
    expect(SS.maskTail("")).toBe("");
    expect(SS.maskTail(null)).toBe("");
    expect(SS.maskTail("0312345678", 3)).toBe("****678");
  });
  test("không bao giờ trả lại giá trị đầy đủ", () => {
    for (const v of ["1", "12", "123", "1234", "12345678", "079123456789"]) expect(SS.maskTail(v).replace("****", "").length).toBeLessThan(v.length);
  });
});

describe("parseDate", () => {
  test("nhận dd/mm/yyyy và yyyy-mm-dd", () => {
    expect(SS.parseDate("05/11/2026")).toBe("2026-11-05");
    expect(SS.parseDate("5/1/2026")).toBe("2026-01-05");
    expect(SS.parseDate("2026-11-05")).toBe("2026-11-05");
  });
  test("ngày không có thật hoặc sai dạng", () => {
    expect(SS.parseDate("31/02/2026")).toBeNull();
    expect(SS.parseDate("29/02/2025")).toBeNull();
    expect(SS.parseDate("29/02/2024")).toBe("2024-02-29");
    expect(SS.parseDate("11-05-2026")).toBeNull();
    expect(SS.parseDate("")).toBeNull();
  });
});

const ins = (code, ee) => ({ code, employeeAmount: ee, employerAmount: ee * 2 });
const lineOf = (o) => Object.assign({ gross: 0, ee_ins: 0, pit: 0, other_ded: 0, advance: 0, net: 0 }, o);
const NAMES = { earning: { LUONG: "Lương cơ bản", OT150: "Làm thêm ngày thường", PC: "Phụ cấp" }, insurance: { BHXH_HT: "BHXH", BHYT: "BHYT", BHTN: "BHTN" } };

describe("slipView và compareSlips", () => {
  const cur = SS.slipView(
    lineOf({ gross: 12150000, ee_ins: 1092000, pit: 50000, other_ded: 0, advance: 1000000, net: 10008000, work_days: 22, std_days: 22, dependents: 1 }),
    { earnings: [{ earningType: "luong", quantity: 22, rate: 1, amount: 10400000 }, { earningType: "OT150", quantity: 10, rate: 75000, amount: 750000 }, { earningType: "PC", amount: 1000000 }, { earningType: "DEM", amount: 0 }], insurance: [ins("BHXH_HT", 832000), ins("BHYT", 156000), ins("BHTN", 104000), ins("KPCD", 0)] },
    NAMES
  );
  const prev = SS.slipView(
    lineOf({ gross: 11400000, ee_ins: 1092000, pit: 0, advance: 0, net: 10308000 }),
    { earnings: [{ earningType: "LUONG", amount: 10400000 }, { earningType: "PC", amount: 800000 }, { earningType: "XANG", name: "Xăng xe", amount: 200000 }], insurance: [ins("BHXH_HT", 832000), ins("BHYT", 156000), ins("BHTN", 104000)] },
    NAMES
  );

  test("bỏ khoản bằng 0, đặt tên theo danh mục, mã viết hoa", () => {
    expect(cur.earnings.map((e) => e.code)).toEqual(["LUONG", "OT150", "PC"]);
    expect(cur.earnings[0].name).toBe("Lương cơ bản");
    expect(cur.insurance.map((i) => i.code)).toEqual(["BHXH_HT", "BHYT", "BHTN"]);
    expect(cur.figures.net).toBe(10008000);
  });

  test("so từng khoản với kỳ trước: mới có, không còn, tăng giảm", () => {
    const c = SS.compareSlips(cur, prev);
    expect(c.hasPrevious).toBe(true);
    const by = Object.fromEntries(c.earnings.map((e) => [e.code, e]));
    expect(by.OT150).toMatchObject({ kind: "new", current: 750000, previous: 0, diff: 750000 });
    expect(by.PC).toMatchObject({ kind: "both", diff: 200000, pct: 0.25 });
    expect(by.XANG).toMatchObject({ kind: "gone", current: 0, previous: 200000, diff: -200000, name: "Xăng xe" });
    expect(c.totals.net).toMatchObject({ current: 10008000, previous: 10308000, diff: -300000 });
    expect(c.insurance.every((i) => i.diff === 0)).toBe(true);
  });

  test("lý do: tác động lên thực lĩnh, lớn nhất trước", () => {
    const c = SS.compareSlips(cur, prev);
    expect(c.reasons[0]).toMatchObject({ group: "advance", effect: -1000000 });
    expect(c.reasons[1]).toMatchObject({ code: "OT150", effect: 750000 });
    const pit = c.reasons.find((r) => r.group === "pit");
    expect(pit.effect).toBe(-50000);
    // Tổng tác động bằng chênh thực lĩnh (không có khoản trừ khác)
    expect(c.reasons.reduce((s, r) => s + r.effect, 0)).toBe(c.totals.net.diff);
  });

  test("không có kỳ trước", () => {
    const c = SS.compareSlips(cur, null);
    expect(c.hasPrevious).toBe(false);
    expect(c.totals.net).toMatchObject({ current: 10008000, previous: null, diff: null });
    expect(c.reasons).toEqual([]);
    expect(c.earnings.every((e) => e.kind === "both" && e.previous === null)).toBe(true);
  });

  test("pickPrevious theo ngày kết thúc kỳ, không theo mã", () => {
    const slips = [{ batch: "9", end: "2026-10-31" }, { batch: "3", end: "2026-08-31" }, { batch: "5", end: "2026-09-30" }, { batch: "6", end: "2026-09-30" }, { batch: "8", end: "2026-11-30" }];
    expect(SS.pickPrevious(slips, slips[0]).batch).toBe("6");
    expect(SS.pickPrevious(slips, slips[1])).toBeNull();
  });
});

describe("leaveView, requestRow, groupRequests", () => {
  const LT = { 1: { code: "PN", name: "Phép năm" } };
  test("số dư còn lại = cấp + chuyển + điều chỉnh - dùng - chờ", () => {
    const v = SS.leaveView([{ leave_type: "1", year: 2026, entitled: 12, carried: 2, adjusted: 1, used: 4.5, pending: 1 }], LT);
    expect(v[0]).toMatchObject({ code: "PN", name: "Phép năm", available: 9.5 });
  });
  test("thao tác của nhân viên theo trạng thái", () => {
    const row = (status, extra) => SS.requestRow("leave", Object.assign({ id: "1", status }, extra), LT);
    expect(row("H")).toMatchObject({ canEdit: true, canSubmit: true, canCancel: false });
    expect(row("P")).toMatchObject({ canEdit: false, canSubmit: false, canCancel: true });
    expect(row("A")).toMatchObject({ canEdit: false, canCancel: false });
    expect(row("P", { summary_locked: true }).canCancel).toBe(false);
    expect(row("R", { reject_reason: "Trùng lịch" }).rejectReason).toBe("Trùng lịch");
    const ot = SS.requestRow("ot", { id: "2", status: "P", work_date: "2026-11-01", hours: 3, reason: "Kiểm kê" });
    expect(ot).toMatchObject({ from: "2026-11-01", to: "2026-11-01", hours: 3, days: null, reason: "Kiểm kê" });
  });
  test("gom theo trạng thái, mới nhất trước", () => {
    const g = SS.groupRequests([
      { id: "1", status: "A", from: "2026-01-02" },
      { id: "2", status: "P", from: "2026-03-01" },
      { id: "3", status: "H", from: "2026-04-01" },
      { id: "4", status: "C", from: "2026-02-01" },
      { id: "5", status: "R", from: "2026-05-01" },
    ]);
    expect(g.open.map((r) => r.id)).toEqual(["3", "2"]);
    expect(g.closed.map((r) => r.id)).toEqual(["5", "4", "1"]);
    expect(g.counts).toEqual({ H: 1, P: 1, A: 1, R: 1, C: 1 });
  });
});

describe("validateRequest", () => {
  const ctx = { leaveTypes: { 1: { code: "PN", allowHalf: true }, 2: { code: "KL", allowHalf: false } } };
  test("bỏ trường không được tự nhập (employee, status, days...)", () => {
    const r = SS.validateRequest("leave", { leave_type: "1", from: "03/11/2026", to: "04/11/2026", employee: "999", subsidiary: "7", status: "A", days: 30, approved_by: "1" }, ctx);
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.values).sort()).toEqual(["from", "from_half", "leave_type", "reason", "to", "to_half"]);
    expect(r.values).toMatchObject({ from: "2026-11-03", to: "2026-11-04", from_half: "A", to_half: "P" });
  });
  test("lỗi tại chỗ theo trường", () => {
    const r = SS.validateRequest("leave", { leave_type: "5", from: "31/02/2026", to: "01/01/2026" }, ctx);
    expect(r.errors.map((e) => e.field).sort()).toEqual(["from", "leave_type"]);
    const r2 = SS.validateRequest("leave", { leave_type: "1", from: "05/11/2026", to: "04/11/2026" }, ctx);
    expect(r2.errors.map((e) => e.code)).toEqual(["RANGE"]);
    const r3 = SS.validateRequest("leave", { leave_type: "1", from: "05/11/2026", from_half: "P", to_half: "A" }, ctx);
    expect(r3.errors.map((e) => e.code)).toEqual(["HALF"]);
  });
  test("loại nghỉ không cho nửa ngày thì ép cả ngày", () => {
    const r = SS.validateRequest("leave", { leave_type: "2", from: "05/11/2026", from_half: "P", to_half: "A" }, ctx);
    expect(r.errors).toEqual([]);
    expect(r.values).toMatchObject({ to: "2026-11-05", from_half: "A", to_half: "P" });
  });
  test("đơn làm thêm và công tác", () => {
    expect(SS.validateRequest("ot", { work_date: "01/11/2026", hours: "2,5", reason: "Chốt sổ", is_night: "true", earning_type: "9" }).values).toEqual({ work_date: "2026-11-01", hours: 2.5, is_night: true, reason: "Chốt sổ" });
    expect(SS.validateRequest("ot", { work_date: "01/11/2026", hours: "13", reason: "" }).errors.map((e) => e.field)).toEqual(["hours", "reason"]);
    const t = SS.validateRequest("trip", { from: "10/11/2026", to: "12/11/2026", destination: "Hà Nội", purpose: "Triển khai", advance_amount: "2.000.000", project: "3" });
    expect(t.errors).toEqual([]);
    expect(t.values).toEqual({ from: "2026-11-10", to: "2026-11-12", destination: "Hà Nội", purpose: "Triển khai", advance_amount: 2000000 });
    expect(SS.validateRequest("trip", { from: "10/11/2026", advance_amount: "-5" }).errors.map((e) => e.field).sort()).toEqual(["advance_amount", "destination", "purpose"]);
    expect(SS.validateRequest("exception", {}).errors[0].code).toBe("TYPE");
  });
});

// ------------------------------------------------------------------ lớp kiểm quyền và các op

function fakeWorld() {
  const db = {
    user: "101",
    emps: { 101: { id: 101, entityid: "E101", firstname: "An", lastname: "Nguyễn Văn", jobtitle: "Kế toán viên", deptname: "Kế toán" }, 202: { id: 202, entityid: "E202", firstname: "Bình", lastname: "Trần" } },
    data: {
      employee: [
        { id: "p1", employee: "101", subsidiary: "3", tax_code: "8012345678", bank_account: "0071001234567", personal_id: "079123456789", si_number: "7912345678", bank_name: "VCB", hire_date: "2024-03-01", employment_type: "E" },
        { id: "p2", employee: "202", subsidiary: "3", tax_code: "8099999999", bank_account: "999" },
      ],
      batch: [
        { id: "11", name: "BL0011", status: "R", period: "9", tax_month: "202609" },
        { id: "12", name: "BL0012", status: "R", period: "10", tax_month: "202610" },
        { id: "13", name: "BL0013", status: "C", period: "11", tax_month: "202611" },
      ],
      period: [
        { id: "9", name: "202609", start: "2026-09-01", end: "2026-09-30" },
        { id: "10", name: "202610", start: "2026-10-01", end: "2026-10-31" },
        { id: "11", name: "202611", start: "2026-11-01", end: "2026-11-30" },
      ],
      batch_emp: [
        { id: "l1", batch: "11", employee: "101", gross: 11000000, net: 9800000, employment_type: "E", detail: JSON.stringify({ earnings: [{ earningType: "LUONG", amount: 11000000 }] }) },
        { id: "l2", batch: "12", employee: "101", gross: 12000000, net: 10600000, employment_type: "E", detail: JSON.stringify({ earnings: [{ earningType: "LUONG", amount: 11000000 }, { earningType: "OT150", amount: 1000000 }] }) },
        { id: "l3", batch: "13", employee: "101", gross: 1, net: 1, detail: "{}" },
        { id: "l4", batch: "12", employee: "202", gross: 50000000, net: 40000000, detail: "{}" },
      ],
      leave_type: [{ id: "1", name: "PN", description: "Phép năm", uses_balance: true, allow_half: true }],
      leave_balance: [
        { id: "b1", employee: "101", leave_type: "1", year: 2026, entitled: 12, used: 2, pending: 1 },
        { id: "b2", employee: "202", leave_type: "1", year: 2026, entitled: 20 },
      ],
      leave_request: [
        { id: "41", name: "NP41", employee: "101", leave_type: "1", from: "2026-10-05", to: "2026-10-05", days: 1, status: "P" },
        { id: "42", name: "NP42", employee: "202", leave_type: "1", from: "2026-10-06", to: "2026-10-06", days: 1, status: "P" },
        { id: "43", name: "NP43", employee: "101", leave_type: "1", from: "2026-09-01", to: "2026-09-01", days: 1, status: "A" },
      ],
      ot_request: [],
      business_trip: [],
      leave_tran: [],
      contract: [
        { id: "c1", employee: "101", number: "HD01", type: "F", status: "A", effective: "2025-03-01", expiry: "2026-12-31" },
        { id: "c2", employee: "202", number: "HD02", type: "U", status: "A", effective: "2025-01-01" },
      ],
      dependent: [
        { id: "d1", profile: "p1", name: "Nguyễn Văn Con", relationship: "Con", tax_code: "8888777766", from: "2025-01-01" },
        { id: "d2", profile: "p2", name: "Người khác", relationship: "Vợ", tax_code: "1111" },
      ],
      ins_comp: [],
      leave_policy: [],
      compensation: [
        { id: "cp1", profile: "p1", effective: "2025-03-01", base_salary: 10000000, insurance_wage: 10000000 },
        { id: "cp2", profile: "p2", effective: "2025-03-01", base_salary: 45000000 },
      ],
      decision: [
        { id: "q1", employee: "101", number: "QD01", type: "T", status: "A", effective: "2026-06-01", old_department: "7", new_department: "8", new_title: "Kế toán trưởng", note: "Ghi chú nội bộ" },
        { id: "q2", employee: "101", number: "QD02", type: "S", status: "D", effective: "2027-01-01", new_salary: 99000000 },
        { id: "q3", employee: "202", number: "QD03", type: "S", status: "A", effective: "2026-06-01", new_salary: 77000000 },
      ],
    },
    departments: { 7: "Phòng A", 8: "Phòng B" },
    queries: [],
    saved: [],
    acted: [],
    logs: [],
    actFail: null,
    seq: 500,
  };
  const match = (where, params) => {
    const p = (params || []).slice();
    const tests = String(where || "").split(/\s+AND\s+/).filter(Boolean).map((c) => {
      const m = /^\{(\w+)\} = \?$/.exec(c);
      if (!m) throw new Error("fake Store: unsupported where " + c);
      const v = String(p.shift());
      return (r) => String(r[m[1]]) === v;
    });
    return (r) => tests.every((t) => t(r));
  };
  const Store = {
    run: (sql, params, tag) => {
      db.queries.push({ tag, params });
      if (tag === "s4vp_my_departments") return params.filter((id) => db.departments[id]).map((id) => ({ id, name: db.departments[id] }));
      const e = db.emps[String(params[0])];
      return e ? [e] : [];
    },
    find: (name, opt = {}) => {
      db.queries.push({ name, where: opt.where, params: opt.params });
      if (db.data[name] === null) throw new Error(`SSS_SEARCH_ERROR on ${name}`);
      const rows = (db.data[name] || []).filter(match(opt.where, opt.params));
      return rows.map((r) => Object.assign({}, r));
    },
    findIn: (name, field, ids) => (db.data[name] || []).filter((r) => ids.map(String).includes(String(r[field]))).map((r) => Object.assign({}, r)),
    get: (name, id) => {
      const r = (db.data[name] || []).find((x) => String(x.id) === String(id));
      return r ? Object.assign({}, r) : null;
    },
  };
  const Attendance = {
    RECORD: { leave: "leave_request", ot: "ot_request", trip: "business_trip", exception: "att_exception" },
    save: (type, values) => {
      db.saved.push({ type, values: JSON.parse(JSON.stringify(values)) });
      const name = Attendance.RECORD[type];
      if (values.id) {
        Object.assign(db.data[name].find((r) => r.id === values.id), values);
        return { id: values.id, warnings: [] };
      }
      const id = String(db.seq++);
      db.data[name].push(Object.assign({ id, name: "NP" + id, status: "H" }, values));
      return { id, warnings: [] };
    },
    act: (type, id, action) => {
      db.acted.push({ type, id, action });
      if (db.actFail) {
        const e = new Error("x");
        e.userMessage = db.actFail;
        throw e;
      }
      const r = db.data[Attendance.RECORD[type]].find((x) => x.id === String(id));
      r.status = action === "submit" ? "P" : "C";
      return { id, status: r.status, warnings: [] };
    },
  };
  const Settings = { earningTypes: () => ({ byCode: { LUONG: { description: "Lương cơ bản" }, OT150: { description: "Làm thêm ngày thường" } } }) };
  const ops = Ops.create({ userId: () => db.user, today: () => "2026-11-10", Store, Attendance, Settings, log: (t) => db.logs.push(t) });
  return { db, ops };
}

describe("SelfServiceOps - kiểm quyền", () => {
  test("người dùng không gắn Employee bị từ chối ở mọi op", () => {
    const { db, ops } = fakeWorld();
    for (const u of [null, "-5", "0", "abc", "999"]) {
      db.user = u;
      const r = ops.handle("GET", { op: "payslips" });
      expect(r).toMatchObject({ ok: false, code: "NO_EMPLOYEE" });
    }
  });

  test("tham số employee của người khác bị từ chối (GET và POST)", () => {
    const { db, ops } = fakeWorld();
    for (const op of ["payslips", "payslip", "leave", "requests", "me"]) {
      expect(ops.handle("GET", { op, employee: "202", batch: "12" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(ops.handle("POST", {}, { op: "saveRequest", type: "leave", employee: "202", values: {} })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(ops.handle("POST", {}, { op: "saveRequest", type: "leave", values: { employee: "202", leave_type: "1", from: "01/12/2026" } })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(db.saved).toEqual([]);
    // employee của chính mình thì vẫn chạy, và không được dùng để lọc
    expect(ops.handle("GET", { op: "payslips", employee: "101" }).ok).toBe(true);
  });

  test("mọi truy vấn có điều kiện nhân viên là người đăng nhập", () => {
    const { db, ops } = fakeWorld();
    for (const op of ["payslips", "leave", "requests", "me"]) ops.handle("GET", { op });
    const scoped = db.queries.filter((q) => ["batch_emp", "leave_balance", "leave_request", "ot_request", "business_trip", "contract", "leave_tran"].includes(q.name));
    expect(scoped.length).toBeGreaterThan(5);
    for (const q of scoped) {
      expect(q.where).toMatch(/^\{employee\} = \?/);
      expect(String(q.params[0])).toBe("101");
    }
  });

  test("sai phương thức hoặc op lạ", () => {
    const { ops } = fakeWorld();
    expect(ops.handle("GET", { op: "saveRequest" })).toMatchObject({ ok: false, code: "INVALID" });
    expect(ops.handle("POST", {}, { op: "payslips" })).toMatchObject({ ok: false, code: "INVALID" });
    expect(ops.handle("GET", { op: "constructor" })).toMatchObject({ ok: false, code: "INVALID" });
    expect(ops.handle("GET", {})).toMatchObject({ ok: false, code: "INVALID" });
  });

  test("lỗi kỹ thuật: thông báo chung, log không có số tiền", () => {
    const { db, ops } = fakeWorld();
    db.data.batch_emp = null;
    const r = ops.handle("GET", { op: "payslips" });
    expect(r).toMatchObject({ ok: false, code: "ERROR" });
    expect(db.logs.length).toBe(1);
    expect(db.logs[0]).toMatch(/^payslips: /);
    expect(db.logs[0].length).toBeLessThanOrEqual(311);
  });

  test("JSON trả về không có khóa tên error ở bất kỳ cấp nào", () => {
    const { db, ops } = fakeWorld();
    const keys = (o, out = []) => {
      if (o && typeof o === "object") for (const k of Object.keys(o)) out.push(k, ...keys(o[k]));
      return out;
    };
    const outs = ["boot", "payslips", "leave", "requests", "me"].map((op) => ops.handle("GET", { op }));
    outs.push(ops.handle("GET", { op: "payslip", batch: "12" }));
    db.actFail = { en: "Overlap", vi: "Trùng" };
    outs.push(ops.handle("POST", {}, { op: "saveRequest", type: "leave", values: { leave_type: "1", from: "01/12/2026" } }));
    outs.push(ops.handle("GET", { op: "nope" }));
    db.data.batch_emp = null;
    outs.push(ops.handle("GET", { op: "payslips" }));
    for (const o of outs) expect(keys(o)).not.toContain("error");
  });
});

describe("SelfServiceOps - phiếu lương", () => {
  test("chỉ bảng lương đã ghi sổ của chính mình, lọc năm theo tháng tính thuế", () => {
    const { ops } = fakeWorld();
    const r = ops.handle("GET", { op: "payslips", year: "2026" });
    expect(r.ok).toBe(true);
    expect(r.data.rows.map((x) => x.batch)).toEqual(["12", "11"]);
    expect(r.data.rows[0]).toMatchObject({ net: 10600000, deductions: 1400000, canPdf: true });
    expect(ops.handle("GET", { op: "payslips", year: "2025" }).data.rows).toEqual([]);
  });

  test("chi tiết một kỳ và so với kỳ trước", () => {
    const { ops } = fakeWorld();
    const r = ops.handle("GET", { op: "payslip", batch: "12" });
    expect(r.ok).toBe(true);
    expect(r.data.previous.batch).toBe("11");
    const ot = r.data.compare.earnings.find((e) => e.code === "OT150");
    expect(ot).toMatchObject({ kind: "new", name: "Làm thêm ngày thường", diff: 1000000 });
    expect(r.data.compare.totals.net.diff).toBe(800000);
  });

  test("bảng lương chưa ghi sổ hoặc không có dòng của mình: NOT_FOUND", () => {
    const { ops } = fakeWorld();
    expect(ops.handle("GET", { op: "payslip", batch: "13" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(ops.handle("GET", { op: "payslip", batch: "1 OR 1=1" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const { db, ops: ops2 } = fakeWorld();
    db.user = "202";
    db.data.batch_emp = db.data.batch_emp.filter((l) => l.employee !== "202");
    expect(ops2.handle("GET", { op: "payslip", batch: "12" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  test("dữ liệu in chỉ có một dòng của người đăng nhập", () => {
    const { ops } = fakeWorld();
    const d = ops.printDetail("12");
    expect(d.lines.length).toBe(1);
    expect(d.lines[0]).toMatchObject({ employee: "101", code: "E101", name: "Nguyễn Văn An" });
    expect(d.employee).toBe("101");
    expect(ops.printDetail("13")).toBeNull();
    expect(ops.printDetail("x")).toBeNull();
  });
});

describe("SelfServiceOps - phép, đơn, thông tin", () => {
  test("phép năm: số dư và đơn của chính mình", () => {
    const { ops } = fakeWorld();
    const r = ops.handle("GET", { op: "leave", year: "2026" });
    expect(r.data.balances).toHaveLength(1);
    expect(r.data.balances[0]).toMatchObject({ code: "PN", available: 9 });
    const ids = r.data.requests.open.concat(r.data.requests.closed).map((x) => x.id);
    expect(ids.sort()).toEqual(["41", "43"]);
  });

  test("danh sách đơn kèm loại nghỉ và số dư còn lại", () => {
    const { ops } = fakeWorld();
    const r = ops.handle("GET", { op: "requests" });
    expect(r.data.requests.counts).toMatchObject({ P: 1, A: 1 });
    expect(r.data.leaveTypes[0]).toMatchObject({ id: "1", code: "PN", available: 9 });
  });

  test("tạo đơn: employee và subsidiary do máy chủ đặt, lưu rồi gửi duyệt", () => {
    const { db, ops } = fakeWorld();
    const r = ops.handle("POST", {}, { op: "saveRequest", type: "leave", values: { leave_type: "1", from: "01/12/2026", to: "02/12/2026", status: "A", days: 99, subsidiary: "1" } });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ submitted: true });
    expect(r.data.request.status).toBe("P");
    expect(db.saved[0].values).toEqual({ leave_type: "1", from: "2026-12-01", to: "2026-12-02", from_half: "A", to_half: "P", reason: "", employee: "101", subsidiary: "3" });
    expect(db.acted).toEqual([{ type: "leave", id: "500", action: "submit" }]);
  });

  test("gửi duyệt không qua: đơn ở lại nháp, trả lý do", () => {
    const { db, ops } = fakeWorld();
    db.actFail = { en: "Insufficient leave balance", vi: "Số dư phép không đủ" };
    const r = ops.handle("POST", {}, { op: "saveRequest", type: "leave", values: { leave_type: "1", from: "01/12/2026" } });
    expect(r.ok).toBe(true);
    expect(r.data.submitted).toBe(false);
    expect(r.data.submitError.vi).toBe("Số dư phép không đủ");
    expect(r.data.request).toMatchObject({ status: "H", canEdit: true });
  });

  test("lỗi nhập trả theo trường, không lưu", () => {
    const { db, ops } = fakeWorld();
    const r = ops.handle("POST", {}, { op: "saveRequest", type: "ot", values: { work_date: "xx", hours: 0 } });
    expect(r).toMatchObject({ ok: false, code: "INVALID" });
    expect(r.fields.map((f) => f.field).sort()).toEqual(["hours", "reason", "work_date"]);
    expect(db.saved).toEqual([]);
  });

  test("chưa có hồ sơ lương: không tạo được đơn, thông báo rõ", () => {
    const { db, ops } = fakeWorld();
    db.data.employee = db.data.employee.filter((p) => p.employee !== "101");
    expect(ops.handle("POST", {}, { op: "saveRequest", type: "leave", values: { leave_type: "1", from: "01/12/2026" } })).toMatchObject({ ok: false, code: "NO_PROFILE" });
    expect(ops.handle("GET", { op: "payslips" }).data.hasProfile).toBe(false);
    expect(ops.handle("GET", { op: "me" }).data.profile).toBeNull();
  });

  test("sửa hoặc hủy đơn của người khác: NOT_FOUND, không ghi", () => {
    const { db, ops } = fakeWorld();
    expect(ops.handle("POST", {}, { op: "requestAction", type: "leave", id: "42", action: "cancel" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(ops.handle("POST", {}, { op: "saveRequest", type: "leave", id: "42", values: { leave_type: "1", from: "01/12/2026" } })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(db.acted).toEqual([]);
    expect(db.saved).toEqual([]);
  });

  test("hủy đơn chờ duyệt của mình; đơn đã duyệt thì không", () => {
    const { db, ops } = fakeWorld();
    expect(ops.handle("POST", {}, { op: "requestAction", type: "leave", id: "43", action: "cancel" })).toMatchObject({ ok: false, code: "STATE" });
    expect(ops.handle("POST", {}, { op: "requestAction", type: "leave", id: "41", action: "approve" })).toMatchObject({ ok: false, code: "INVALID" });
    const r = ops.handle("POST", {}, { op: "requestAction", type: "leave", id: "41", action: "cancel" });
    expect(r.ok).toBe(true);
    expect(r.data.request.status).toBe("C");
    expect(db.acted).toEqual([{ type: "leave", id: "41", action: "cancel" }]);
  });

  test("thông tin của tôi: số định danh che, chỉ người phụ thuộc của mình", () => {
    const { ops } = fakeWorld();
    const r = ops.handle("GET", { op: "me" });
    const p = r.data.profile;
    expect(p).toMatchObject({ taxCode: "****5678", bankAccount: "****4567", personalId: "****6789", siNumber: "****5678", bankName: "VCB" });
    expect(JSON.stringify(r)).not.toMatch(/8012345678|0071001234567|079123456789|8888777766/);
    expect(r.data.dependents.map((d) => d.name)).toEqual(["Nguyễn Văn Con"]);
    expect(r.data.dependents[0]).toMatchObject({ taxCode: "****7766", active: true });
    expect(r.data.contract).toMatchObject({ number: "HD01", expiry: "2026-12-31", state: "A", daysLeft: 51 });
  });
});

describe("SelfServicePage", () => {
  test("bảng chữ có đủ khóa ở hai ngôn ngữ, bản en không có chữ Việt", () => {
    const vi = Object.keys(Page.TEXT.vi).sort();
    expect(Object.keys(Page.TEXT.en).sort()).toEqual(vi);
    const viChars = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
    for (const k of vi) expect(Page.TEXT.en[k]).not.toMatch(viChars);
  });
  test("không dùng gạch dài, mã trình duyệt không lộ chữ cứng tiếng Việt", () => {
    const all = JSON.stringify(Page.TEXT) + Page.client.toString();
    expect(all).not.toMatch(/[–—]/);
    const code = Page.client.toString().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/[ăâêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i);
  });
  test("html: chọn ngôn ngữ, dữ liệu nhúng không đóng được thẻ script", () => {
    const html = Page.html({ lang: "en", url: "/app/site/hosting/scriptlet.nl?script=1&deploy=1", token: "t", employee: { code: "E1", name: "</script><b>x" } });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Employee portal</title>");
    expect(html.split("</script>").length).toBe(2);
    expect(Page.html({}).includes('<html lang="vi">')).toBe(true);
  });
});

describe("validateRequest nhận ngày ISO của ô ngày trình duyệt", () => {
  const ctx = { leaveTypes: { 1: { code: "PN", allowHalf: true } } };
  test("yyyy-mm-dd được nhận nguyên, dd/mm/yyyy vẫn nhận để tương thích", () => {
    expect(SS.validateRequest("leave", { leave_type: "1", from: "2026-12-01", to: "2026-12-03" }, ctx).values).toMatchObject({ from: "2026-12-01", to: "2026-12-03" });
    expect(SS.validateRequest("leave", { leave_type: "1", from: "01/12/2026", to: "2026-12-03" }, ctx).values).toMatchObject({ from: "2026-12-01", to: "2026-12-03" });
    expect(SS.validateRequest("ot", { work_date: "2026-11-09", hours: "1.5", reason: "Kiểm kê" }).values).toMatchObject({ work_date: "2026-11-09", hours: 1.5 });
    expect(SS.validateRequest("trip", { from: "2026-11-10", to: "2026-11-12", destination: "Huế", purpose: "Họp" }).errors).toEqual([]);
  });
  test("ISO sai ngày hoặc đến trước từ vẫn bị chặn", () => {
    expect(SS.validateRequest("leave", { leave_type: "1", from: "2026-02-30" }, ctx).errors.map((e) => e.code)).toEqual(["DATE"]);
    expect(SS.validateRequest("leave", { leave_type: "1", from: "2026-12-05", to: "2026-12-01" }, ctx).errors.map((e) => e.code)).toEqual(["RANGE"]);
  });
  test("thông báo lỗi ngày không còn yêu cầu gõ dd/mm/yyyy", () => {
    const e = SS.validateRequest("ot", { work_date: "x", hours: 1, reason: "a" }).errors[0];
    expect(`${e.en} ${e.vi}`).not.toMatch(/dd\/mm/);
  });
});

describe("loại nghỉ mặc định", () => {
  test("phép năm (gắn chính sách) trước, rồi mã PN, rồi loại còn số dư", () => {
    expect(SS.defaultLeaveType([{ id: "2", code: "KL" }, { id: "5", code: "PN" }, { id: "9", code: "PNX", annual: true }])).toBe("9");
    expect(SS.defaultLeaveType([{ id: "2", code: "KL" }, { id: "5", code: "pn" }])).toBe("5");
    expect(SS.defaultLeaveType([{ id: "2", code: "KL" }, { id: "3", code: "VR", usesBalance: true, available: 0 }, { id: "4", code: "BU", usesBalance: true, available: 2 }])).toBe("4");
    expect(SS.defaultLeaveType([{ id: "2", code: "KL" }])).toBe("");
  });
  test("op requests trả loại nghỉ mặc định, loại phép năm lên đầu danh sách", () => {
    const { db, ops } = fakeWorld();
    db.data.leave_type = [{ id: "2", name: "KL", description: "Nghỉ không lương", allow_half: true }, { id: "1", name: "AN", description: "Phép năm", uses_balance: true }];
    db.data.leave_policy = [{ id: "lp1", leave_type: "1" }];
    const r = ops.handle("GET", { op: "requests" });
    expect(r.data.defaultLeaveType).toBe("1");
    expect(r.data.leaveTypes.map((t) => [t.id, t.annual])).toEqual([["1", true], ["2", false]]);
  });
});

describe("dữ liệu biểu đồ và tab Tổng quan", () => {
  const slip = (batch, end, gross, net, pit, taxMonth) => ({ batch, periodName: end.slice(0, 7).replace("-", ""), end, gross, net, pit, taxMonth });

  test("niceScale: bước 1 / 2 / 2,5 / 5 x 10^n, đỉnh trục không thấp hơn giá trị lớn nhất", () => {
    expect(SS.niceScale(26100000, 4)).toEqual({ max: 30000000, step: 10000000, ticks: [0, 10000000, 20000000, 30000000] });
    expect(SS.niceScale(9000000, 4)).toMatchObject({ max: 10000000, step: 2500000 });
    expect(SS.niceScale(0)).toEqual({ max: 1, step: 1, ticks: [0, 1] });
    for (const v of [1, 7, 123456, 98765432]) expect(SS.niceScale(v).max).toBeGreaterThanOrEqual(v);
  });

  test("payTrend: 12 kỳ gần nhất cũ -> mới, kỳ cao nhất, so kỳ trước, bình quân 6 kỳ, thuế trong năm", () => {
    const slips = [];
    for (let m = 1; m <= 14; m++) {
      const y = m <= 12 ? 2025 : 2026;
      const mm = String(((m - 1) % 12) + 1).padStart(2, "0");
      slips.push(slip(String(m), y + "-" + mm + "-28", 10000000 + m * 100000, 9000000 + m * 100000, 100000, y + mm));
    }
    slips[5].gross = 50000000;
    const t = SS.payTrend(slips.reverse(), "2026-03-15", 12);
    expect(t.points.length).toBe(12);
    expect(t.points[0].end).toBe("2025-03-28");
    expect(t.points[11].end).toBe("2026-02-28");
    expect(t.points[t.highIndex].gross).toBe(50000000);
    expect(t.latest).toMatchObject({ net: 10400000, previous: 10300000, diff: 100000 });
    expect(t.avg6).toBe(Math.round((10400000 + 10300000 + 10200000 + 10100000 + 10000000 + 9900000) / 6));
    expect(t.pitYtd).toBe(200000);
    expect(t.scale.max).toBeGreaterThanOrEqual(50000000);
  });

  test("payTrend: chưa có phiếu", () => {
    expect(SS.payTrend([], "2026-01-01")).toMatchObject({ points: [], latest: null, avg6: null, pitYtd: 0, highIndex: -1 });
  });

  test("dòng thời gian bỏ nháp và trường nội bộ; người phụ thuộc che mã số thuế, báo sắp hết giảm trừ", () => {
    const tl = SS.dashboardTimeline([
      { date: "2026-06-01", kind: "decision", code: "T", ref: "QD01", newTitle: "KTT", note: "x", appliedBy: "9" },
      { date: "2027-01-01", kind: "decision", code: "S", draft: true, amount: 1 },
      { date: "2026-01-01", kind: "dependent", ref: "Con" },
      { date: "2025-01-01", kind: "salary", amount: 10, previous: 8 },
    ]);
    expect(tl.map((e) => e.kind)).toEqual(["decision", "salary"]);
    expect(Object.keys(tl[0])).not.toContain("note");
    const d = SS.dependentsSummary([{ name: "A", tax_code: "8888777766", from: "2025-01-01", to: "2026-12-01" }, { name: "B", from: "2025-01-01" }, { name: "C", from: "2020-01-01", to: "2021-01-01" }], "2026-11-10", 90);
    expect(d).toMatchObject({ active: 2, ending: 1 });
    expect(d.rows[0]).toMatchObject({ name: "A", taxCode: "****7766", ending: true, daysLeft: 21 });
  });

  test("op dashboard: chỉ dữ liệu của người đăng nhập, mọi truy vấn lọc theo người đó hoặc hồ sơ của người đó", () => {
    const { db, ops } = fakeWorld();
    const r = ops.handle("GET", { op: "dashboard" });
    expect(r.ok).toBe(true);
    const d = r.data;
    expect(d.pay.points.map((p) => p.batch)).toEqual(["11", "12"]);
    expect(d.pay.latest).toMatchObject({ net: 10600000, previous: 9800000, diff: 800000 });
    expect(d.timeline.find((e) => e.kind === "decision")).toMatchObject({ ref: "QD01", oldDepartment: "Phòng A", newDepartment: "Phòng B", newTitle: "Kế toán trưởng" });
    expect(d.timeline.some((e) => e.ref === "QD02" || e.ref === "QD03")).toBe(false);
    expect(d.dependents.rows.map((x) => x.name)).toEqual(["Nguyễn Văn Con"]);
    expect(d.tasks.requests.map((x) => x.id)).toEqual(["41"]);
    expect(d.tasks.balances[0]).toMatchObject({ code: "PN", available: 9 });
    expect(d.tasks.contracts).toEqual([{ kind: "contractExpiry", date: "2026-12-31", daysLeft: 51, overdue: false, ref: "HD01", code: "F" }]);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/45000000|77000000|99000000|50000000|8012345678|8888777766|Ghi chú nội bộ|Người khác/);
    for (const q of db.queries.filter((x) => x.name && ["batch_emp", "leave_balance", "leave_request", "ot_request", "business_trip", "contract", "decision"].includes(x.name))) {
      expect(q.where).toMatch(/^\{employee\} = \?/);
      expect(String(q.params[0])).toBe("101");
    }
    for (const q of db.queries.filter((x) => ["compensation", "dependent"].includes(x.name))) {
      expect(q.where).toBe("{profile} = ?");
      expect(q.params).toEqual(["p1"]);
    }
  });

  test("op dashboard: số truy vấn cố định, không tăng theo số phiếu, đơn, quyết định", () => {
    const one = fakeWorld();
    one.ops.handle("GET", { op: "dashboard" });
    const many = fakeWorld();
    for (let i = 0; i < 30; i++) {
      many.db.data.batch.push({ id: String(100 + i), name: "B" + i, status: "R", period: "9", tax_month: "202609" });
      many.db.data.batch_emp.push({ id: "x" + i, batch: String(100 + i), employee: "101", gross: 1, net: 1, detail: "{}" });
      many.db.data.leave_request.push({ id: String(900 + i), employee: "101", leave_type: "1", from: "2026-12-01", status: "P" });
      many.db.data.decision.push({ id: "qq" + i, employee: "101", type: "T", status: "A", effective: "2026-0" + ((i % 9) + 1) + "-01", new_department: "7" });
      many.db.data.dependent.push({ id: "dd" + i, profile: "p1", name: "D" + i, from: "2025-01-01" });
    }
    many.ops.handle("GET", { op: "dashboard" });
    expect(many.db.queries.length).toBe(one.db.queries.length);
    expect(one.db.queries.length).toBeLessThanOrEqual(16);
  });

  test("op dashboard: không có khóa error; người khác gọi thì thấy dữ liệu của chính họ", () => {
    const keys = (o, out = []) => {
      if (o && typeof o === "object") for (const k of Object.keys(o)) out.push(k, ...keys(o[k]));
      return out;
    };
    const { db, ops } = fakeWorld();
    expect(keys(ops.handle("GET", { op: "dashboard" }))).not.toContain("error");
    expect(ops.handle("GET", { op: "dashboard", employee: "202" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    db.user = "202";
    const r = ops.handle("GET", { op: "dashboard" });
    expect(r.data.pay.points.map((p) => p.net)).toEqual([40000000]);
    expect(JSON.stringify(r)).not.toMatch(/10600000|Nguyễn Văn Con|QD01/);
  });
});

describe("SelfServicePage - tab Tổng quan và bản nhúng", () => {
  test("html nhúng view / embed / fullUrl; view lạ về Tổng quan", () => {
    const boot = (h) => JSON.parse(/\}\)\((\{[\s\S]*\})\);<\/script>/.exec(h)[1]);
    expect(boot(Page.html({ view: "req" }))).toMatchObject({ view: "req", embed: false });
    expect(boot(Page.html({ view: "x", embed: true, fullUrl: "/s" }))).toMatchObject({ view: "home", embed: true, fullUrl: "/s" });
  });
  test("form đơn dùng ô ngày của trình duyệt và ô số giờ bước 0,5", () => {
    const code = Page.client.toString();
    expect(code).toMatch(/type: "date"/);
    expect(code).toMatch(/step: "0\.5"/);
    expect(code).toMatch(/defaultLeaveType/);
  });
});
