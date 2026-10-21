// Ca vàng 2.13.2, 2.13.3 - thuế TNCN (PitCalculator)
const { core, provider } = require("./helpers");
const Pit = core("PitCalculator");

const P = provider();
const OCT = "2026-10-31";
const MAY = "2026-05-31";
const pit = (x, p = P) => Pit.calculate(Object.assign({ date: OCT, pitMethod: "P" }, x), p);

describe("2.13.2 Lũy tiến", () => {
	test("TN-01", () => {
		const r = pit({ taxableIncome: 30000000, employeeInsurance: 3150000, dependentCount: 1 });
		expect(r.selfDeduction).toBe(15500000);
		expect(r.dependentDeduction).toBe(6200000);
		expect(r.assessableIncome).toBe(5150000);
		expect(r.tax).toBe(257500);
	});

	test("TN-02", () => {
		const r = pit({ taxableIncome: 60500000 });
		expect(r.assessableIncome).toBe(45000000);
		expect(r.tax).toBe(5500000);
	});

	test.each([
		[0, 0], [1, 0], [15, 1], [10000000, 500000], [10000001, 500000], [30000000, 2500000], [60000000, 8500000],
		[100000000, 20500000], [150000000, 38000000],
	])("TN-03 biểu 2026: %d -> %d", (assessable, tax) => {
		expect(pit({ taxableIncome: assessable + 15500000 }).tax).toBe(tax);
	});

	test.each([
		[5000000, 250000], [10000000, 750000], [18000000, 1950000], [32000000, 4750000], [52000000, 9750000],
		[80000000, 18150000], [100000000, 25150000],
	])("TN-04 biểu 2025: %d -> %d", (assessable, tax) => {
		expect(pit({ taxableIncome: assessable + 11000000, date: "2025-12-31" }).tax).toBe(tax);
	});

	test("TN-05", () => {
		const r = pit({ taxableIncome: 30000000, employeeInsurance: 3150000, dependentCount: 1, date: "2025-12-31" });
		expect(r.selfDeduction).toBe(11000000);
		expect(r.dependentDeduction).toBe(4400000);
		expect(r.assessableIncome).toBe(11450000);
		expect(r.tax).toBe(967500);
		expect(r.breakdown).toHaveLength(3);
	});

	test("TN-06", () => expect(pit({ taxableIncome: 17000000, employeeInsurance: 1785000 }).tax).toBe(0));

	test("TN-07", () => {
		const r = pit({ taxableIncome: 10000000, dependentCount: 3 });
		expect(r.assessableIncome).toBe(0);
		expect(r.tax).toBe(0);
	});

	test("TN-08", () => {
		const r = pit({ taxableIncome: 35500000, otherDeductions: 1000000 });
		expect(r.assessableIncome).toBe(19000000);
		expect(r.tax).toBe(1400000);
	});

	test("TN-09 quyết toán năm", () => {
		expect(Pit.calculateAnnualProgressive(360000000, "2026-12-31", P)).toBe(30000000);
	});

	test("TN-10 chưa có tham số", () => {
		expect(() => pit({ taxableIncome: 30000000, date: "2019-01-31" })).toThrow(expect.objectContaining({ code: "VP-PARAM-MISSING" }));
	});

	test("TN-11 tham số mới chồng khoảng", () => {
		const p = provider({ params: [{ code: "PIT.SELF_DEDUCTION", value: 20000000, effectiveDate: "2027-01-01", expirationDate: null }] });
		expect(pit({ taxableIncome: 30000000, date: "2027-01-31" }, p).tax).toBe(500000);
	});

	test("TN-12 NPT âm", () => {
		expect(() => pit({ taxableIncome: 30000000, dependentCount: -1 })).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
	});

	test("TN-13", () => {
		const r = pit({ taxableIncome: 115500000 });
		expect(r.assessableIncome).toBe(100000000);
		expect(r.tax).toBe(20500000);
	});
});

describe("2.13.3 Khấu trừ 10%, không cư trú", () => {
	test.each([
		[2000000, false, 200000], [1999999, false, 0], [2000000, true, 0], [10000000, false, 1000000], [10000000, true, 0],
	])("FL-01 5/2026: %d cam kết %s -> %d", (income, commit, tax) => {
		expect(pit({ taxableIncome: income, pitMethod: "F", hasFlatTaxCommitment: commit, date: MAY }).tax).toBe(tax);
	});

	test.each([[4999999, 0], [5000000, 500000], [6954545, 695455]])("FL-02 10/2026: %d -> %d", (income, tax) => {
		expect(pit({ taxableIncome: income, pitMethod: "F" }).tax).toBe(tax);
	});

	test("FL-03 không cư trú bỏ giảm trừ", () => {
		expect(pit({ taxableIncome: 50000000, pitMethod: "N", dependentCount: 2, employeeInsurance: 5000000 }).tax).toBe(10000000);
	});

	test("FL-04 None", () => expect(pit({ taxableIncome: 99000000, pitMethod: "X" }).tax).toBe(0));

	test("Phương pháp trống hoặc lạ là lũy tiến", () => {
		expect(Pit.normalizeMethod("")).toBe("P");
		expect(Pit.normalizeMethod("Z")).toBe("P");
		expect(Pit.normalizeMethod(" f ")).toBe("F");
	});
});

describe("2.4.7 Miễn thuế theo loại thu nhập", () => {
	test("hạn mức C áp cho tổng các dòng cùng tham số", () => {
		const e = [
			{ code: "ANCA", amount: 500000, taxTreatment: "C", exemptCapParameter: "PIT.MEAL_EXEMPT_CAP" },
			{ code: "ANCA2", amount: 500000, taxTreatment: "C", exemptCapParameter: "pit.meal_exempt_cap" },
		];
		expect(Pit.computeTaxExempt(e, P, MAY)).toBe(730000);
	});
	test("E toàn bộ, P phần khai không vượt số tiền, T 0", () => {
		const e = [
			{ amount: 2000000, taxTreatment: "E" },
			{ amount: 100000, taxTreatment: "P", taxExemptAmount: 500000 },
			{ amount: 100000, taxTreatment: "P", taxExemptAmount: -5 },
			{ amount: 9000000, taxTreatment: "T" },
		];
		expect(Pit.computeTaxExempt(e, P, OCT)).toBe(2100000);
	});
});
