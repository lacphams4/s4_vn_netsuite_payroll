// Ca kiểm thử vàng mục 3.10 (36-40): giấy phép lao động người nước ngoài.
const { core } = require("./helpers");
const WP = core("WorkPermitEvaluator");

const P = (refNbr, effectiveDate, expiryDate, extra) => Object.assign({ refNbr, status: "A", effectiveDate, expiryDate, issueType: "N" }, extra);

describe("3.10 #36 thời hạn", () => {
  test("tối đa 24 tháng", () => {
    expect(WP.validateTerm("2026-01-01", "2027-12-31", 24)).toBeNull();
    expect(WP.validateTerm("2026-01-01", "2028-01-01", 24).messageVi).toContain("31/12/2027");
    expect(WP.validateTerm("2026-01-01", "2025-12-31", 24)).not.toBeNull();
  });
});

describe("3.10 #37-39 đánh giá cho kỳ", () => {
  test("#37", () => {
    expect(WP.evaluate([P("WP1", "2026-01-01", "2027-12-31")], "2026-10-01", "2026-10-31", 60)).toMatchObject({ coverage: "Valid", days: 426 });
    expect(WP.evaluate([P("WP1", "2026-01-01", "2026-12-15")], "2026-10-01", "2026-10-31", 60)).toMatchObject({ coverage: "ExpiringSoon", days: 45 });
    expect(WP.evaluate([P("WP1", "2026-01-01", "2026-10-15")], "2026-10-01", "2026-10-31", 60).coverage).toBe("PartiallyCovered");
    expect(WP.evaluate([], "2026-10-01", "2026-10-31", 60).coverage).toBe("NotCovered");
    expect(WP.evaluate([P("WP1", "2026-01-01", "2027-12-31", { status: "V" })], "2026-10-01", "2026-10-31", 60).coverage).toBe("NotCovered");
  });
  test("#38 gia hạn trong kỳ", () => {
    const r = WP.evaluate([P("WP1", "2024-10-16", "2026-10-15"), P("WP2", "2026-10-16", "2028-10-15", { issueType: "X", previousRefNbr: "WP1" })], "2026-10-01", "2026-10-31", 60);
    expect(r).toMatchObject({ coverage: "Valid", refNbr: "WP2" });
  });
  test("#39 gia hạn liền kề sau kỳ / không liền kề", () => {
    expect(WP.evaluate([P("WP1", "2025-01-01", "2026-12-31"), P("WP2", "2027-01-01", "2028-12-31")], "2026-11-01", "2026-11-30", 60)).toMatchObject({ coverage: "Valid", refNbr: "WP2", days: 762 });
    expect(WP.evaluate([P("WP1", "2025-01-01", "2026-12-31"), P("WP2", "2027-01-10", "2028-12-31")], "2026-11-01", "2026-11-30", 60)).toMatchObject({ coverage: "ExpiringSoon", refNbr: "WP1", days: 31 });
  });
});

describe("3.10 #40 chuỗi gia hạn", () => {
  test("New -> Extension -> Extension", () => {
    const by = { A: { refNbr: "A", issueType: "N" }, B: { refNbr: "B", issueType: "X", previousRefNbr: "A" }, C: { refNbr: "C", issueType: "X", previousRefNbr: "B" } };
    expect(WP.validateChain(by.B, by, 1)).toBeNull();
    expect(WP.validateChain(by.C, by, 1)).not.toBeNull();
  });
  test("New -> Reissue -> Extension đếm 1", () => {
    const by = { A: { refNbr: "A", issueType: "N" }, B: { refNbr: "B", issueType: "R", previousRefNbr: "A" }, C: { refNbr: "C", issueType: "X", previousRefNbr: "B" } };
    expect(WP.countExtensions(by.C, by)).toBe(1);
    expect(WP.validateChain(by.C, by, 1)).toBeNull();
  });
  test("vòng lặp dừng; thiếu giấy trước là lỗi", () => {
    const by = { A: { refNbr: "A", issueType: "X", previousRefNbr: "B" }, B: { refNbr: "B", issueType: "X", previousRefNbr: "A" } };
    expect(WP.countExtensions(by.A, by)).toBe(2);
    expect(WP.validateChain({ refNbr: "Z", issueType: "X" }, by, 1)).not.toBeNull();
  });
  test("giấy gia hạn mới và trạng thái khi cấp", () => {
    expect(WP.extensionTerm({ expiryDate: "2026-10-15" }, 24)).toEqual({ effectiveDate: "2026-10-16", expiryDate: "2028-10-15" });
    expect(WP.issuedStatus("2026-10-15", "2026-10-20")).toBe("E");
    expect(WP.issuedStatus("2026-10-25", "2026-10-20")).toBe("A");
  });
});
