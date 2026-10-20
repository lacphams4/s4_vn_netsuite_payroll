// Ca KY-01..04, NL-01 (mục 2.13.7) và ngày công chuẩn của kỳ (2.8.3).
const { core, Defaults } = require("./helpers");
const Gen = core("PayPeriodGenerator");
const WDC = core("WorkingDayCounter");
const Dates = core("Dates");

describe("sinh kỳ lương", () => {
  test("KY-01 tháng 2027", () => {
    const ps = Gen.generate(2027, "M", "");
    expect(ps).toHaveLength(12);
    expect(ps[1]).toMatchObject({ periodId: "202702", endDate: "2027-02-28" });
    expect(ps.every((p) => p.isLastInTaxMonth && p.taxMonth === p.periodId)).toBe(true);
  });
  test("KY-02 nửa tháng 2028, tiền tố pt", () => {
    const ps = Gen.generate(2028, "S", "pt");
    expect(ps).toHaveLength(24);
    expect(ps[2]).toMatchObject({ periodId: "PT-202802S1", isLastInTaxMonth: false, taxMonth: "202802" });
    expect(ps[3]).toMatchObject({ startDate: "2028-02-16", endDate: "2028-02-29", isLastInTaxMonth: true });
  });
  test("KY-03 tuần 2026, tiền tố TD, bắt đầu thứ Hai", () => {
    const ps = Gen.generate(2026, "W", "TD", 1);
    expect(ps[0]).toMatchObject({ periodId: "TD-2026W01", startDate: "2025-12-29", endDate: "2026-01-04", taxMonth: "202601" });
    expect(ps.every((p) => Dates.dayOfWeek(p.startDate) === 1)).toBe(true);
    for (let i = 1; i < ps.length; i++) expect(Dates.diff(ps[i - 1].endDate, ps[i].startDate)).toBe(1);
    expect(ps[ps.length - 1].endDate).toBe("2026-12-27");
    const lasts = ps.filter((p) => p.isLastInTaxMonth);
    expect(lasts).toHaveLength(12);
    expect(new Set(lasts.map((p) => p.taxMonth)).size).toBe(12);
  });
  test("KY-04 mã kỳ quá 15 ký tự", () => {
    expect(() => Gen.generate(2028, "S", "CONGTRUONG1")).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
    expect(Gen.validatePayGroupId("CONGTRUONG1", "S")).not.toBeNull();
    expect(Gen.validatePayGroupId("XDKHOAN", "W")).toBeNull();
    expect(Gen.validatePayGroupId("XDKHOAN1", "W")).not.toBeNull();
  });
  test("năm ngoài 2000-2100", () => expect(() => Gen.generate(1999, "M")).toThrow());
  test("mã kỳ nhập tay nhóm DEFAULT", () => {
    expect(Gen.parseManualPeriodId("202610")).toEqual({ valid: true, startDate: "2026-10-01", endDate: "2026-10-31", taxMonth: "202610" });
    expect(Gen.parseManualPeriodId("202613").valid).toBe(false);
    expect(Gen.parseManualPeriodId("199912").valid).toBe(false);
    expect(Gen.parseManualPeriodId("CTV-202610").valid).toBe(true);
  });
  test("ngày công chuẩn: tháng đếm theo kỳ, tuần lấy chuẩn tháng của nhóm", () => {
    const m = Gen.withStandardDays(Gen.generate(2026, "M"), { weeklyOff: "6,0" });
    expect(m[9].standardWorkDays).toBe(22);
    const w = Gen.withStandardDays(Gen.generate(2026, "W", "TD"), { weeklyOff: "6,0", payGroupStandardDays: 26 });
    expect(w.every((p) => p.standardWorkDays === 26)).toBe(true);
  });
});

describe("NL-01 lịch lễ mặc định", () => {
  const h = Defaults.holidays;
  test("chỉ có năm 2027, 15 ngày không trùng", () => {
    expect(h).toHaveLength(15);
    expect(new Set(h.map((x) => x.date)).size).toBe(15);
    expect(h.every((x) => x.date.startsWith("2027-"))).toBe(true);
  });
  test("Tết 04/02 - 10/02/2027, nghỉ bù duy nhất 03/05/2027", () => {
    expect(Dates.range("2027-02-04", "2027-02-10").every((d) => h.some((x) => x.date === d))).toBe(true);
    expect(h.filter((x) => x.isCompensatory).map((x) => x.date)).toEqual(["2027-05-03"]);
  });
  test("lễ trùng nghỉ tuần chỉ bị loại một lần", () => {
    // tháng 2/2027 nghỉ CN: 28 ngày - 4 CN - 7 ngày Tết + 1 (07/02 là CN đã trừ) = 18
    expect(WDC.countWorkDays("2027-02-01", "2027-02-28", "0", h)).toBe(18);
  });
});
