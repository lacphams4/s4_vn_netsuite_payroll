// Lớp quyền api/Access và bộ lọc phạm vi công ty con của api/Store (docs/BAO_MAT_LUONG_SO_SANH.md).
// Kiểm: vai trò hiệu lực qua bảng vai trò tương đương, gói quyền pay / ids, phạm vi công ty con, che số định danh,
// điều kiện SQL ghép vào Store.find theo từng loại record, chặn ghi sang công ty con ngoài phạm vi.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const mockState = { role: "administrator", sql: [] };
jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ id: 5, roleId: mockState.role }) }), { virtual: true });
jest.mock(
  "N/query",
  () => ({
    runSuiteQLPaged: (o) => {
      mockState.sql.push(o.query);
      return { pageRanges: [] };
    },
  }),
  { virtual: true }
);
jest.mock("N/record", () => ({ create: () => ({ setValue: () => {}, save: () => 99 }) }), { virtual: true });
jest.mock("N/format", () => ({}), { virtual: true });
jest.mock("N/cache", () => ({ getCache: () => ({ get: () => null, put: () => {} }), Scope: { PROTECTED: "P" } }), { virtual: true });

const Access = require(path.join(API, "Access"));
const Store = require(path.join(API, "Store"));

const setRole = (role, subs, aliases) => {
  mockState.role = role;
  Access.configure({ aliases: () => aliases || {}, subsidiaries: () => subs });
};
const whereOf = (name) => {
  mockState.sql.length = 0;
  Store.find(name, { where: "{id} = ?", params: [1] });
  return mockState.sql[0].split(" WHERE ").slice(1).join(" WHERE ");
};

describe("vai trò hiệu lực và gói quyền", () => {
  test("vai trò chuẩn giữ nguyên; vai trò lạ không thuộc gói", () => {
    setRole("customrole_s4vp_hr", null);
    expect(Access.role()).toBe("customrole_s4vp_hr");
    expect(Access.isMember()).toBe(true);
    setRole("customrole_ap_clerk", null);
    expect(Access.isMember()).toBe(false);
    expect(Access.canPay()).toBe(false);
  });

  test("vai trò nhân bản khai tương đương được quy về vai trò chuẩn; không quy được về administrator", () => {
    const aliases = Access.parseAliases("customrole_hr_cty_a, CustomRole_HR_Cty_B", Access.ROLES.HR, {});
    setRole("customrole_hr_cty_b", ["14"], aliases);
    expect(Access.role()).toBe("customrole_s4vp_hr");
    expect(Access.canPay()).toBe(true);
    setRole("customrole_fake_admin", null, { customrole_fake_admin: "administrator" });
    expect(Access.isMember()).toBe(false);
    expect(Access.parseAliases("administrator, customrole_s4vp_hr", Access.ROLES.OPS, {})).toEqual({});
  });

  test("HR vận hành không có gói pay, ids; kế toán có pay nhưng không có ids", () => {
    setRole("customrole_s4vp_hr_ops", null);
    expect([Access.isMember(), Access.canPay(), Access.canIds()]).toEqual([true, false, false]);
    setRole("customrole_s4vp_accountant", null);
    expect([Access.canPay(), Access.canIds()]).toEqual([true, false]);
    setRole("customrole_s4vp_hr", null);
    expect([Access.canPay(), Access.canIds()]).toEqual([true, true]);
  });

  test("che số định danh giữ 4 ký tự cuối; nhận ra giá trị đã che", () => {
    expect(Access.mask("079123456789")).toBe("********6789");
    expect(Access.mask("123")).toBe("****");
    expect(Access.mask("")).toBe("");
    expect(Access.isMasked(Access.mask("079123456789"))).toBe(true);
    expect(Access.isMasked("079123456789")).toBe(false);
  });
});

describe("phạm vi công ty con", () => {
  test("administrator và chưa cấu hình: không giới hạn", () => {
    setRole("administrator", ["14"]);
    expect(Access.subsidiaries()).toBeNull();
    Access.configure(null);
    mockState.role = "customrole_s4vp_hr";
    expect(Access.restricted()).toBe(false);
    expect(whereOf("batch")).not.toMatch(/IN \(/);
  });

  test("không xác định được phạm vi thì không cho thấy công ty con nào", () => {
    mockState.role = "customrole_s4vp_hr";
    Access.configure({
      subsidiaries: () => {
        throw new Error("no permission");
      },
    });
    expect(Access.subsidiaries()).toEqual([]);
    expect(Access.allowsSubsidiary("14")).toBe(false);
    expect(whereOf("batch")).toMatch(/subsidiary IN \(-1\)/);
  });

  test("assertSubsidiary chặn công ty con ngoài phạm vi, lỗi hai ngôn ngữ", () => {
    setRole("customrole_s4vp_hr", ["14"]);
    expect(() => Access.assertSubsidiary("14")).not.toThrow();
    let err = null;
    try {
      Access.assertSubsidiary("13");
    } catch (e) {
      err = e;
    }
    expect(err.userMessage.vi).toMatch(/công ty con/);
    expect(Access.allowsSubsidiary("")).toBe(false);
  });

  test("Store.find ghép điều kiện theo loại record", () => {
    setRole("customrole_s4vp_hr", ["14", "13"]);
    expect(whereOf("batch")).toMatch(/custrecord_s4vp_ba_subsidiary IN \(14,13\)/);
    expect(whereOf("batch")).not.toMatch(/IS NULL/);
    // Cấu hình dùng chung: dòng không gắn công ty con vẫn thấy
    expect(whereOf("paygroup")).toMatch(/IS NULL OR t\.custrecord_s4vp_pg_subsidiary IN \(14,13\)/);
    // Con của bảng lương: theo bảng lương
    expect(whereOf("batch_emp")).toMatch(/FROM customrecord_s4vp_batch sb WHERE sb\.custrecord_s4vp_ba_subsidiary IN \(14,13\)/);
    // Theo nhân viên: theo công ty con của hồ sơ lương
    expect(whereOf("attendance")).toMatch(/SELECT sp\.custrecord_s4vp_em_employee FROM customrecord_s4vp_employee sp WHERE sp\.custrecord_s4vp_em_subsidiary IN \(14,13\)/);
    // Lịch sử lương: theo hồ sơ
    expect(whereOf("compensation")).toMatch(/custrecord_s4vp_cp_profile IN \(SELECT sp\.id FROM customrecord_s4vp_employee/);
    // Danh mục pháp lý: không lọc
    expect(whereOf("param")).not.toMatch(/IN \(/);
    // unscoped bỏ qua bộ lọc
    mockState.sql.length = 0;
    Store.find("batch", { unscoped: true });
    expect(mockState.sql[0]).not.toMatch(/IN \(14,13\)/);
  });

  test("Store.create chặn ghi sang công ty con khác; trong phạm vi thì ghi", () => {
    setRole("customrole_s4vp_hr", ["14"]);
    expect(() => Store.create("batch", { subsidiary: "13" })).toThrow(/subsidiary/);
    expect(Store.create("batch", { subsidiary: "14" })).toBe("99");
    // Người bị giới hạn không tạo được dòng cấu hình dùng chung (không gắn công ty con)
    expect(() => Store.create("paygroup", { subsidiary: null })).toThrow(/subsidiary/);
    setRole("administrator", null);
    expect(Store.create("batch", { subsidiary: "13" })).toBe("99");
  });
});
