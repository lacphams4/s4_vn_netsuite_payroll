// Bộ quy tắc kiểm tra bảng lương (core/PayrollChecks): từng quy tắc, ngưỡng, ghép trạng thái đã lưu, số liệu tổng, chặn duyệt.
const { core } = require("./helpers");
const Checks = core("PayrollChecks");

const PERIOD = { start: "2027-03-01", end: "2027-03-31", attLocked: true };
const PREV_PERIOD = { start: "2027-02-01", end: "2027-02-28" };
const profile = (extra = {}) => Object.assign({ salary_type: "M", employment_type: "E", hire_date: "2025-01-01", termination_date: null, ins_applicable: true, region: "I", hasTaxCode: true, hasBank: true }, extra);
const line = (employee, extra = {}) => Object.assign({ id: `L${employee}`, employee: String(employee), employment_type: "E", std_days: 23, work_days: 23, net: 10000000, insurance_wage: 10000000, error: "" }, extra);
const run = (over = {}) =>
  Checks.evaluate(
    Object.assign(
      {
        lines: [line(1)],
        prevLines: [line(1)],
        profiles: { 1: profile() },
        hours: {},
        manualEarnings: {},
        period: PERIOD,
        prevPeriod: PREV_PERIOD,
        options: {},
      },
      over
    )
  );
const rules = (items) => items.map((i) => i.rule).sort();
const one = (items, rule) => items.find((i) => i.rule === rule);

describe("evaluate - dữ liệu sạch và đầu vào thiếu", () => {
  test("bảng lương bình thường không có cảnh báo", () => {
    expect(run()).toEqual([]);
  });

  test("bảng lương chưa có nhân viên: một lỗi cấp bảng lương, không kiểm gì thêm", () => {
    for (const lines of [[], null, undefined]) {
      const items = run({ lines, period: { start: "2027-03-01", end: "2027-03-31", attLocked: false } });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ key: "NO_EMPLOYEES", rule: "NO_EMPLOYEES", severity: "error", employee: null, lineId: null });
    }
  });

  test("không có đầu vào vẫn không ném lỗi", () => {
    expect(rules(Checks.evaluate())).toEqual(["NO_EMPLOYEES"]);
    expect(rules(Checks.evaluate({ lines: [{ id: 1, employee: 9 }] }))).toEqual(["MISSING_PROFILE", "NET_ZERO"]);
  });

  test("khóa = quy tắc:nhân viên, lineId và employee là chuỗi", () => {
    const it = one(run({ lines: [line(7, { id: 55, employee: 7, net: -1 })], prevLines: null, profiles: { 7: profile() } }), "NET_NEGATIVE");
    expect(it).toMatchObject({ key: "NET_NEGATIVE:7", employee: "7", lineId: "55", severity: "error", amount: -1 });
  });

  test("một nhân viên có hai dòng chỉ được kiểm một lần", () => {
    const items = run({ lines: [line(1, { net: 0 }), line(1, { id: "L1b", net: 0 })], prevLines: null });
    expect(rules(items)).toEqual(["NET_ZERO"]);
  });
});

describe("evaluate - thực lĩnh", () => {
  test("thực lĩnh âm là lỗi, bằng 0 là cảnh báo", () => {
    expect(one(run({ lines: [line(1, { net: -500 })], prevLines: null }), "NET_NEGATIVE").severity).toBe("error");
    const zero = run({ lines: [line(1, { net: 0 })], prevLines: null });
    expect(rules(zero)).toEqual(["NET_ZERO"]);
    expect(zero[0].severity).toBe("warn");
    expect(rules(run({ lines: [line(1, { net: null })], prevLines: null }))).toEqual(["NET_ZERO"]);
  });

  test("bảng chưa tính: bỏ các quy tắc dựa trên số tiền", () => {
    const items = run({ lines: [line(1, { net: 0, insurance_wage: 1 })], options: { calculated: false, minInsuranceWage: 5000000 } });
    expect(items).toEqual([]);
  });

  test("dòng lỗi tính lương: báo CALC_ERROR, không báo thực lĩnh bằng 0 hay chênh lệch", () => {
    const items = run({ lines: [line(1, { net: 0, error: "Thiếu lịch sử lương" })] });
    expect(rules(items)).toEqual(["CALC_ERROR"]);
    expect(items[0]).toMatchObject({ severity: "error", data: { message: "Thiếu lịch sử lương" } });
  });

  test("dòng lỗi và không có hồ sơ: chỉ báo lỗi tính lương (không báo hai lần)", () => {
    expect(rules(run({ lines: [line(1, { error: "Nhân viên chưa có hồ sơ lương" })], profiles: {} }))).toEqual(["CALC_ERROR"]);
    expect(rules(run({ lines: [line(1)], profiles: {}, prevLines: null }))).toEqual(["MISSING_PROFILE"]);
  });
});

describe("evaluate - chênh thực lĩnh so với kỳ trước", () => {
  const change = (net, prevNet, options = {}) => run({ lines: [line(1, { net })], prevLines: [line(1, { net: prevNet })], options });

  test("vượt ngưỡng mặc định 20% thì cảnh báo, kèm số liệu", () => {
    const it = one(change(12260174, 9308000), "NET_CHANGE");
    expect(it.severity).toBe("warn");
    expect(it.amount).toBe(2952174);
    expect(it.data).toMatchObject({ net: 12260174, prevNet: 9308000, diff: 2952174, threshold: 0.2 });
    expect(it.data.ratio).toBeCloseTo(0.3172, 4);
  });

  test("đúng bằng ngưỡng không cảnh báo, giảm quá ngưỡng có cảnh báo", () => {
    expect(change(12000000, 10000000)).toEqual([]);
    expect(change(12000001, 10000000)).toHaveLength(1);
    const down = one(change(7000000, 10000000), "NET_CHANGE");
    expect(down.data.diff).toBe(-3000000);
    expect(down.data.ratio).toBeCloseTo(-0.3, 6);
  });

  test("ngưỡng là tham số", () => {
    expect(change(10600000, 10000000, { netChangeThreshold: 0.05 })).toHaveLength(1);
    expect(change(14000000, 10000000, { netChangeThreshold: 0.5 })).toEqual([]);
    // ngưỡng không hợp lệ -> mặc định
    expect(one(change(13000000, 10000000, { netChangeThreshold: 0 }), "NET_CHANGE").data.threshold).toBe(Checks.DEFAULT_NET_CHANGE);
  });

  test("không so khi không có kỳ trước, kỳ trước bằng 0 hoặc dòng kỳ trước lỗi", () => {
    expect(run({ lines: [line(1, { net: 99 })], prevLines: null })).toEqual([]);
    expect(change(5000000, 0)).toEqual([]);
    expect(run({ lines: [line(1, { net: 5 })], prevLines: [line(1, { net: 10000000, error: "x" })] })).toEqual([]);
  });

  test("nhân viên mới / nghỉ trong kỳ, hoặc mới vào ở kỳ trước: không báo chênh lệch (lương chia ngày công)", () => {
    const hired = run({ lines: [line(1, { net: 3000000 })], prevLines: [line(1)], profiles: { 1: profile({ hire_date: "2027-03-20" }) } });
    expect(rules(hired)).toEqual(["NEW_EMPLOYEE"]);
    const leaving = run({ lines: [line(1, { net: 3000000 })], prevLines: [line(1)], profiles: { 1: profile({ termination_date: "2027-03-10" }) } });
    expect(rules(leaving)).toEqual(["LEAVER"]);
    const hiredPrev = run({ lines: [line(1, { net: 10000000 })], prevLines: [line(1, { net: 3000000 })], profiles: { 1: profile({ hire_date: "2027-02-20" }) } });
    expect(hiredPrev).toEqual([]);
  });
});

describe("evaluate - công và giờ", () => {
  test("nhân viên lương giờ chưa có giờ và không có khoản nhập tay: NO_HOURS", () => {
    const base = { lines: [line(1, { work_days: 0 })], prevLines: null, profiles: { 1: profile({ salary_type: "H" }) } };
    expect(rules(run(base))).toEqual(["NO_HOURS"]);
    expect(run(Object.assign({}, base, { hours: { 1: 40 } }))).toEqual([]);
    expect(run(Object.assign({}, base, { manualEarnings: { 1: 1 } }))).toEqual([]);
  });

  test("nhân viên lương tháng không có ngày công: NO_ATTENDANCE; cộng tác viên và công chuẩn 0 thì không", () => {
    const it = one(run({ lines: [line(1, { work_days: 0 })], prevLines: null }), "NO_ATTENDANCE");
    expect(it).toMatchObject({ severity: "warn", data: { stdDays: 23, workDays: 0 } });
    expect(run({ lines: [line(1, { work_days: null, std_days: 0 })], prevLines: null })).toEqual([]);
    expect(run({ lines: [line(1, { work_days: 0, employment_type: "C" })], prevLines: null, profiles: { 1: profile({ employment_type: "C" }) } })).toEqual([]);
  });

  test("công của kỳ chưa khóa: thông tin cấp bảng lương; không rõ thì không báo", () => {
    const it = one(run({ period: { start: "2027-03-01", end: "2027-03-31", attLocked: false } }), "ATT_NOT_LOCKED");
    expect(it).toMatchObject({ key: "ATT_NOT_LOCKED", severity: "info", employee: null });
    expect(run({ period: { start: "2027-03-01", end: "2027-03-31" } })).toEqual([]);
  });
});

describe("evaluate - hồ sơ", () => {
  test("thiếu mã số thuế, thiếu thông tin nhận lương: chỉ dựa trên cờ có / không", () => {
    const items = run({ profiles: { 1: profile({ hasTaxCode: false, hasBank: false }) } });
    expect(rules(items)).toEqual(["MISSING_BANK", "MISSING_TAX_CODE"]);
    for (const it of items) {
      expect(it.severity).toBe("warn");
      expect(it.data).toEqual({});
    }
  });

  test("giá trị thô của mã số thuế, tài khoản không bao giờ xuất hiện trong kết quả", () => {
    const items = run({ profiles: { 1: profile({ hasTaxCode: false, hasBank: false, tax_code: "8123456789", bank_account: "0011223344" }) } });
    const dump = JSON.stringify(items) + JSON.stringify(items.map((i) => Checks.describe(i, "vi")));
    expect(dump).not.toContain("8123456789");
    expect(dump).not.toContain("0011223344");
  });

  test("thiếu thông tin nhận lương không báo khi đã tính mà thực lĩnh bằng 0", () => {
    expect(rules(run({ lines: [line(1, { net: 0 })], prevLines: null, profiles: { 1: profile({ hasBank: false }) } }))).toEqual(["NET_ZERO"]);
    expect(rules(run({ lines: [line(1, { net: 0 })], prevLines: null, profiles: { 1: profile({ hasBank: false }) }, options: { calculated: false } }))).toEqual(["MISSING_BANK"]);
  });

  test("nhân viên mới: vào làm trong kỳ, hoặc không có ở bảng lương kỳ trước", () => {
    const hired = one(run({ profiles: { 1: profile({ hire_date: "2027-03-01" }) } }), "NEW_EMPLOYEE");
    expect(hired).toMatchObject({ severity: "info", data: { reason: "hired", date: "2027-03-01" } });
    const absent = one(run({ prevLines: [] }), "NEW_EMPLOYEE");
    expect(absent.data).toEqual({ reason: "notInPrev" });
    // không có kỳ trước để so thì không coi là mới
    expect(run({ prevLines: null })).toEqual([]);
  });

  test("nghỉ việc trong kỳ là thông tin; nghỉ trước kỳ mà còn trong bảng là cảnh báo", () => {
    expect(one(run({ profiles: { 1: profile({ termination_date: "2027-03-31" }) } }), "LEAVER")).toMatchObject({ severity: "info", data: { date: "2027-03-31" } });
    expect(one(run({ profiles: { 1: profile({ termination_date: "2027-02-28" }) } }), "LEFT_BEFORE_PERIOD")).toMatchObject({ severity: "warn", data: { date: "2027-02-28" } });
    expect(run({ profiles: { 1: profile({ termination_date: "2027-04-01" }) } })).toEqual([]);
  });

  test("có ở kỳ trước nhưng không có ở kỳ này: thông tin, trừ người đã nghỉ trước kỳ", () => {
    const items = run({ prevLines: [line(1), line(2), line(3)], profiles: { 1: profile(), 2: profile(), 3: profile({ termination_date: "2027-02-15" }) } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "NOT_IN_BATCH:2", severity: "info", employee: "2", lineId: null });
  });
});

describe("evaluate - lương đóng bảo hiểm dưới mức tối thiểu", () => {
  const low = (options, prof = {}, ln = {}) => run({ lines: [line(1, Object.assign({ insurance_wage: 4000000 }, ln))], profiles: { 1: profile(prof) }, options });

  test("không có tham số mức tối thiểu thì bỏ qua quy tắc", () => {
    expect(low({})).toEqual([]);
    expect(low({ minInsuranceWage: null })).toEqual([]);
    expect(low({ minInsuranceWage: 0 })).toEqual([]);
    expect(low({ minInsuranceWage: {} })).toEqual([]);
  });

  test("mức là một số: thấp hơn thì cảnh báo, bằng thì không", () => {
    const it = one(low({ minInsuranceWage: 5000000, minInsuranceParam: "CHECK.INS_WAGE_MIN" }), "INS_BELOW_MIN");
    expect(it).toMatchObject({ severity: "warn", amount: 4000000, data: { wage: 4000000, min: 5000000, region: "", param: "CHECK.INS_WAGE_MIN" } });
    expect(low({ minInsuranceWage: 4000000 })).toEqual([]);
  });

  test("mức theo vùng: lấy vùng của hồ sơ, rồi vùng mặc định; vùng không có mức thì bỏ qua", () => {
    const table = { I: 5000000, II: 3500000 };
    expect(one(low({ minInsuranceWage: table }), "INS_BELOW_MIN").data).toMatchObject({ min: 5000000, region: "I" });
    expect(low({ minInsuranceWage: table }, { region: "II" })).toEqual([]);
    expect(one(low({ minInsuranceWage: table, defaultRegion: "I" }, { region: "" }), "INS_BELOW_MIN").data.region).toBe("I");
    expect(low({ minInsuranceWage: table }, { region: "IV" })).toEqual([]);
    expect(low({ minInsuranceWage: table }, { region: "" })).toEqual([]);
  });

  test("không áp cho cộng tác viên, người không tham gia bảo hiểm, lương đóng bằng 0", () => {
    const opt = { minInsuranceWage: 5000000 };
    expect(low(opt, { employment_type: "C" })).toEqual([]);
    expect(low(opt, { ins_applicable: false })).toEqual([]);
    expect(low(opt, {}, { insurance_wage: 0 })).toEqual([]);
  });
});

describe("describe - chữ hiển thị", () => {
  test("mọi quy tắc có mức độ hợp lệ và đủ tiêu đề, mô tả, gợi ý ở cả hai ngôn ngữ", () => {
    for (const [code, def] of Object.entries(Checks.RULES)) {
      expect(["error", "warn", "info"]).toContain(def.severity);
      for (const lang of ["vi", "en"]) {
        const t = Checks.describe({ rule: code, data: { threshold: 0.2, ratio: 0.3, diff: 1, date: "2027-03-05", reason: "hired", message: "m", region: "I", param: "P" } }, lang);
        expect(t.title).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.hint).toBeTruthy();
        // không dùng gạch dài
        expect(t.title + t.description + t.hint + t.headline).not.toMatch(/[–—]/);
      }
    }
  });

  test("chênh thực lĩnh: tiêu đề theo ngưỡng, câu ngắn theo chiều và tỷ lệ", () => {
    const up = { rule: "NET_CHANGE", data: { threshold: 0.2, ratio: 0.3172, diff: 2952174 } };
    expect(Checks.describe(up, "vi")).toMatchObject({ title: "Thực lĩnh lệch trên 20% so với kỳ trước", headline: "thực lĩnh tăng 31,7%" });
    expect(Checks.describe(up, "en").headline).toBe("net pay up 31.7%");
    const down = { rule: "NET_CHANGE", data: { threshold: 0.25, ratio: -0.5, diff: -5 } };
    expect(Checks.describe(down, "vi").headline).toBe("thực lĩnh giảm 50%");
    expect(Checks.describe(down, "vi").description).toContain("vượt ngưỡng 25%");
  });

  test("ngày trong mô tả hiện dd/mm/yyyy; quy tắc lạ trả mã", () => {
    expect(Checks.describe({ rule: "LEAVER", data: { date: "2027-03-10" } }, "vi").description).toContain("10/03/2027");
    expect(Checks.describe({ rule: "NEW_EMPLOYEE", data: { reason: "notInPrev" } }, "vi").description).toContain("kỳ trước");
    expect(Checks.describe({ rule: "XYZ" }, "vi")).toEqual({ title: "XYZ", headline: "", description: "", hint: "" });
    expect(Checks.describe(null, "vi").title).toBe("");
  });
});

describe("merge, counts, blocking, sort", () => {
  const items = () =>
    run({
      lines: [line(1, { net: -5 }), line(2, { net: 15000000 }), line(3)],
      prevLines: [line(1), line(2), line(3)],
      profiles: { 1: profile(), 2: profile({ hasTaxCode: false }), 3: profile({ termination_date: "2027-03-15" }) },
    });

  test("dữ liệu thử có đủ ba mức độ", () => {
    expect(rules(items())).toEqual(["LEAVER", "MISSING_TAX_CODE", "NET_CHANGE", "NET_NEGATIVE"]);
  });

  test("chưa lưu gì: mọi mục đều mở", () => {
    const merged = Checks.merge(items(), {});
    expect(merged.every((i) => i.status === "open" && i.note === "" && i.assignee === null && i.reopened === false)).toBe(true);
    expect(Checks.counts(merged)).toEqual({ open: 3, errors: 1, warnings: 2, resolved: 0 });
  });

  test("ghép trạng thái, ghi chú, người phụ trách theo khóa", () => {
    const list = items();
    const change = one(list, "NET_CHANGE");
    const merged = Checks.merge(list, {
      "NET_CHANGE:2": { status: "accepted", note: "Thưởng theo quyết định", assignee: 44, stamp: Checks.fingerprint(change) },
      "MISSING_TAX_CODE:2": { status: "open", note: "Đang hỏi nhân sự", assignee: "45" },
      "LEAVER:3": { status: "resolved", note: "ok" },
    });
    expect(one(merged, "NET_CHANGE")).toMatchObject({ status: "accepted", note: "Thưởng theo quyết định", assignee: "44", reopened: false });
    expect(one(merged, "MISSING_TAX_CODE")).toMatchObject({ status: "open", note: "Đang hỏi nhân sự", assignee: "45" });
    expect(one(merged, "LEAVER").status).toBe("resolved");
    expect(Checks.counts(merged)).toEqual({ open: 2, errors: 1, warnings: 1, resolved: 2 });
  });

  test("số liệu đổi sau khi đã đóng thì cảnh báo mở lại, giữ ghi chú", () => {
    const before = one(items(), "NET_CHANGE");
    const stored = { "NET_CHANGE:2": { status: "accepted", note: "đã xem", stamp: Checks.fingerprint(before) } };
    const changed = run({ lines: [line(2, { net: 16000000 })], prevLines: [line(2)], profiles: { 2: profile() } });
    expect(Checks.merge(changed, stored)[0]).toMatchObject({ status: "open", reopened: true, note: "đã xem" });
    const same = run({ lines: [line(2, { net: 15000000 })], prevLines: [line(2)], profiles: { 2: profile() } });
    expect(Checks.merge(same, stored)[0]).toMatchObject({ status: "accepted", reopened: false });
    // bản ghi cũ không có dấu: giữ trạng thái đã đóng
    expect(Checks.merge(changed, { "NET_CHANGE:2": { status: "resolved", note: "x" } })[0].status).toBe("resolved");
  });

  test("lỗi không đóng tay được: trạng thái đã lưu bị bỏ qua và lỗi luôn chặn duyệt", () => {
    const merged = Checks.merge(items(), { "NET_NEGATIVE:1": { status: "accepted", note: "cứ duyệt" } });
    const err = one(merged, "NET_NEGATIVE");
    expect(err).toMatchObject({ status: "open", reopened: true });
    expect(Checks.canClose(err)).toBe(false);
    expect(Checks.canClose(one(merged, "NET_CHANGE"))).toBe(true);
    expect(Checks.blocking(merged).map((i) => i.key)).toEqual(["NET_NEGATIVE:1"]);
    expect(Checks.counts(merged).errors).toBe(1);
  });

  test("blocking: chỉ mức error; không lỗi thì rỗng", () => {
    expect(Checks.blocking(run({ profiles: { 1: profile({ hasTaxCode: false }) } }))).toEqual([]);
    expect(Checks.blocking(null)).toEqual([]);
    expect(Checks.blocking(run({ lines: [] })).map((i) => i.rule)).toEqual(["NO_EMPLOYEES"]);
  });

  test("thông tin (info) không tính vào số việc còn mở", () => {
    const merged = Checks.merge(run({ profiles: { 1: profile({ termination_date: "2027-03-15" }) } }), {});
    expect(Checks.counts(merged)).toEqual({ open: 0, errors: 0, warnings: 0, resolved: 0 });
    expect(Checks.counts(null)).toEqual({ open: 0, errors: 0, warnings: 0, resolved: 0 });
  });

  test("sort: còn mở trước, rồi lỗi, cảnh báo, thông tin; không đổi mảng gốc", () => {
    const list = items();
    const merged = Checks.merge(list, { "MISSING_TAX_CODE:2": { status: "accepted", note: "x" } });
    const copy = merged.slice();
    const sorted = Checks.sort(merged);
    expect(sorted.map((i) => i.rule)).toEqual(["NET_NEGATIVE", "NET_CHANGE", "LEAVER", "MISSING_TAX_CODE"]);
    expect(merged).toEqual(copy);
    const named = Checks.sort(
      [
        { rule: "NET_ZERO", severity: "warn", employee: "1", employeeName: "Trần B" },
        { rule: "NET_ZERO", severity: "warn", employee: "2", employeeName: "Lê A" },
      ]
    );
    expect(named.map((i) => i.employee)).toEqual(["2", "1"]);
  });

  test("fingerprint: ổn định, khác nhau theo khóa và số liệu, không chứa số tiền", () => {
    const a = { key: "NET_CHANGE:2", rule: "NET_CHANGE", data: { net: 15000000, prevNet: 10000000 } };
    expect(Checks.fingerprint(a)).toBe(Checks.fingerprint(JSON.parse(JSON.stringify(a))));
    expect(Checks.fingerprint(a)).not.toBe(Checks.fingerprint(Object.assign({}, a, { data: { net: 15000001, prevNet: 10000000 } })));
    expect(Checks.fingerprint(a)).not.toBe(Checks.fingerprint(Object.assign({}, a, { key: "NET_CHANGE:3" })));
    expect(Checks.fingerprint(a)).not.toContain("15000000");
    expect(Checks.fingerprint(a)).toMatch(/^[0-9a-z]+$/);
  });
});
