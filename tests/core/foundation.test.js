const { core, provider } = require("./helpers");
const Money = core("Money");
const Dates = core("Dates");

describe("Money.round (2.1)", () => {
  test.each([[0.5, 1], [1.5, 2], [2.5, 3], [-0.5, -1], [0.05, 0], [0.75, 1], ["764062.5", 764063]])("%s -> %s", (x, y) => {
    expect(Money.round(x)).toBe(y);
  });
});

describe("Dates", () => {
  test("weekday and month end", () => {
    expect(Dates.dayOfWeek("2026-10-18")).toBe(0);
    expect(Dates.endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(Dates.addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(Dates.iso("05/10/2026")).toBe("2026-10-05");
  });
});

describe("StatutoryParameterProvider (2.2.1)", () => {
  const p = provider();
  test("value by date", () => {
    expect(p.getValue("pit.self_deduction", "2025-12-31").toNumber()).toBe(11000000);
    expect(p.getValue("PIT.SELF_DEDUCTION", "2026-01-01").toNumber()).toBe(15500000);
  });
  test("missing -> VP-PARAM-MISSING", () => {
    expect(() => p.getValue("PIT.SELF_DEDUCTION", "2019-01-31")).toThrow(expect.objectContaining({ code: "VP-PARAM-MISSING" }));
  });
  test("brackets do not mix sets", () => {
    expect(p.getPitBrackets("2025-12-31")).toHaveLength(7);
    expect(p.getPitBrackets("2026-10-31")).toHaveLength(5);
  });
  test("components", () => {
    expect(p.getInsuranceComponents("2026-10-31").map((c) => c.code)).toEqual(["BHXH_HT", "BHXH_OD", "BHTNLD", "BHYT", "BHTN", "KPCD", "DOANPHI"]);
  });
});
