// Ca vàng 2.13.6 - gộp tháng tính thuế (TaxMonthAggregator)
const { core, provider } = require("./helpers");
const Agg = core("TaxMonthAggregator");
const Paycheck = core("PaycheckCalculator");

const P = provider();
const MS = "2026-10-01";
const ME = "2026-10-31";
const T = (code, amount) => ({ code, amount, taxTreatment: "T" });
const meal = (amount) => ({ code: "ANCA", amount, taxTreatment: "C", exemptCapParameter: "PIT.MEAL_EXEMPT_CAP" });
const emp = (x = {}) => Object.assign({ employeeCd: "E001", pitMethod: "P", insuranceWage: 8000000, region: "I", dependents: [{ deductFrom: "2024-01-01" }] }, x);
const agg = (current, isLast, prior) => Agg.calculate({ current, isLastInTaxMonth: isLast, taxMonthStart: MS, taxMonthEnd: ME, prior }, P);

describe("2.13.6 Gộp tháng tính thuế", () => {
	test("TM-01 kỳ cả tháng trùng tính trực tiếp", () => {
		const cur = { periodStart: MS, periodEnd: ME, employee: emp(), earnings: [T("LUONG", 30000000)] };
		const r = agg(cur, true, {});
		const direct = Paycheck.calculate(cur, P);
		expect(r).toEqual(direct);
		expect(r.employeeInsurance).toBe(840000);
		expect(r.pit.tax).toBe(373000);
		expect(r.netPay).toBe(28787000);
	});

	test("TM-02 kỳ tuần không phải kỳ cuối", () => {
		const r = agg({ periodStart: "2026-10-05", periodEnd: "2026-10-11", employee: emp(), earnings: [T("LUONG", 9000000)] }, false, {});
		expect([r.grossPay, r.employeeInsurance, r.employerInsurance, r.pit.tax, r.netPay]).toEqual([9000000, 0, 0, 0, 9000000]);
	});

	test("TM-03 bốn kỳ tuần, kỳ cuối gộp cả tháng", () => {
		const weeks = [["2026-10-05", "2026-10-11", 9000000], ["2026-10-12", "2026-10-18", 8500000], ["2026-10-19", "2026-10-25", 9200000], ["2026-10-26", "2026-11-01", 8300000]];
		const prior = { earnings: [], absenceWorkingDays: 0, otherTaxDeductions: 0 };
		const results = [];
		weeks.forEach(([s, e, pay], i) => {
			const earnings = [T("LUONG", pay), meal(200000)];
			const r = agg({ periodStart: s, periodEnd: e, employee: emp(), earnings }, i === 3, { earnings: prior.earnings.slice() });
			results.push(r);
			prior.earnings.push(...earnings);
		});
		for (const r of results.slice(0, 3)) expect([r.employeeInsurance, r.employerInsurance, r.pit.tax]).toEqual([0, 0, 0]);
		const whole = Paycheck.calculate({ periodStart: MS, periodEnd: ME, employee: emp(), earnings: [T("LUONG", 35000000), meal(800000)] }, P);
		const last = results[3];
		expect(last.employeeInsurance).toBe(whole.employeeInsurance);
		expect(last.employerInsurance).toBe(whole.employerInsurance);
		expect(last.pit.tax).toBe(whole.pit.tax);
		expect([whole.employeeInsurance, whole.employerInsurance, whole.pit.tax]).toEqual([840000, 1880000, 746000]);
		expect(results.map((r) => r.netPay)).toEqual([9200000, 8700000, 9400000, 6914000]);
		expect(results.reduce((s, r) => s + r.netPay, 0)).toBe(whole.netPay);
		expect(whole.netPay).toBe(34214000);
	});

	test("TM-04 kỳ cuối có kỳ trước và tạm ứng lớn", () => {
		const r = agg({
			periodStart: "2026-10-26", periodEnd: ME, employee: emp(), earnings: [T("LUONG", 10000000)],
			openAdvances: [{ refNbr: "TU01", date: "2026-10-01", balance: 50000000 }],
		}, true, { earnings: [T("LUONG", 20000000)] });
		expect(r.employeeInsurance).toBe(840000);
		expect(r.pit.tax).toBe(373000);
		expect(r.netBeforeAdvance).toBe(10000000 - 840000 - 373000);
		expect(r.netBeforeAdvance).toBe(8787000);
		expect(r.advanceOffset.totalOffset).toBe(8787000);
		expect(r.netPay).toBe(0);
	});

	const ctv = (x = {}) => emp(Object.assign({ pitMethod: "F", insuranceApplicable: false, unemploymentApplicable: false, dependents: [] }, x));

	test("TM-05 CTV khấu trừ ngay lần chi giữa tháng", () => {
		const r = agg({ periodStart: MS, periodEnd: "2026-10-15", employee: ctv(), earnings: [T("PHIDV", 7640625)] }, false, {});
		expect(r.pit.tax).toBe(764063);
		expect(r.netPay).toBe(6876562);
	});

	test("TM-06 CTV hai lần chi dưới ngưỡng không cộng dồn", () => {
		const a = agg({ periodStart: MS, periodEnd: "2026-10-15", employee: ctv(), earnings: [T("PHIDV", 4000000)] }, false, {});
		const b = agg({ periodStart: "2026-10-16", periodEnd: ME, employee: ctv(), earnings: [T("PHIDV", 3000000)] }, true, { earnings: [T("PHIDV", 4000000)] });
		expect([a.pit.tax, b.pit.tax, b.netPay]).toEqual([0, 0, 3000000]);
	});

	test("TM-07 CTV có cam kết; CTV không cư trú", () => {
		const prior = { earnings: [T("PHIDV", 1000000)] };
		expect(agg({ periodStart: "2026-10-16", periodEnd: ME, employee: ctv({ hasFlatTaxCommitment: true }), earnings: [T("PHIDV", 8000000)] }, true, prior).pit.tax).toBe(0);
		expect(agg({ periodStart: "2026-10-16", periodEnd: ME, employee: ctv({ pitMethod: "N" }), earnings: [T("PHIDV", 10000000)] }, true, prior).pit.tax).toBe(2000000);
	});

	test("TM-08 nhân viên lũy tiến kỳ giữa tháng", () => {
		const r = agg({ periodStart: MS, periodEnd: "2026-10-15", employee: emp({ insuranceWage: 20000000 }), earnings: [T("LUONG", 10000000)] }, false, {});
		expect([r.employeeInsurance, r.pit.tax]).toEqual([0, 0]);
	});

	test("Kỳ giữa tháng không kiểm tra lương tối thiểu vùng", () => {
		expect(() => agg({ periodStart: MS, periodEnd: "2026-10-15", employee: emp({ insuranceWage: 1000000 }), earnings: [T("LUONG", 1000000)] }, false, {})).not.toThrow();
	});
});
