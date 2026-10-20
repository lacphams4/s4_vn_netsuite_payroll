// 2.10, 2.13.7 HD-01/HD-02 (phần tiền) - trích trước tháng 13, tiền phép khi nghỉ việc, lương theo ngày công
const { core } = require("./helpers");
const X = core("PayrollExtras");

describe("Lương theo ngày công (HD-01, HD-02)", () => {
	test("HD-01 thử việc 85%, vào làm 15/10, 12/22 ngày", () => {
		// 10 ngày ngoài hợp đồng do bộ đếm ngày làm việc tính (agent khác); ngày công = 22 - 10
		expect(X.prorate(15000000, 22 - 10, 22, "0.85")).toBe(6954545);
	});

	test("HD-02 nghỉ việc 20/10: lương 14/22 và trả 3 ngày phép", () => {
		expect(X.prorate(25000000, 22 - 8, 22)).toBe(15909091);
		const daily = X.dailyRate({ salaryType: "M", baseSalary: 25000000, standardDays: 22 });
		expect(X.leavePayout({ remainingDays: 3, dailyRate: daily }).amount).toBe(3409091);
		expect(X.leavePayout({ remainingDays: -1, dailyRate: daily }).amount).toBe(0);
	});

	test("Đơn giá ngày theo loại lương", () => {
		expect(X.dailyRate({ salaryType: "D", baseSalary: 385385 }).toNumber()).toBe(385385);
		expect(X.dailyRate({ salaryType: "H", baseSalary: 196000, hoursPerDay: 8 }).toNumber()).toBe(1568000);
		expect(() => X.dailyRate({ salaryType: "M", baseSalary: 1, standardDays: 0 })).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
	});

	test("Đơn giá giờ theo loại lương", () => {
		expect(X.hourlyRate({ salaryType: "D", baseSalary: 400000, hoursPerDay: 8 }).toNumber()).toBe(50000);
		expect(X.hourlyRate({ salaryType: "H", baseSalary: 196000 }).toNumber()).toBe(196000);
	});
});

describe("2.10.1 Trích trước lương tháng 13", () => {
	const base = { accrue13th: true, isContractor: false, salaryType: "M", baseSalary: 24000000, packageMonthly: 1200000, basis: "P", months: 0 };
	test("lương HĐ + gói, chia 12", () => expect(X.accrued13th(base)).toBe(2100000));
	test("chỉ lương HĐ", () => expect(X.accrued13th(Object.assign({}, base, { basis: "C" }))).toBe(2000000));
	test("số tháng công ty", () => expect(X.accrued13th(Object.assign({}, base, { months: 13 }))).toBe(1938462));
	test("lương ngày chỉ trích trên gói", () => expect(X.accrued13th(Object.assign({}, base, { salaryType: "D" }))).toBe(100000));
	test("CTV hoặc không đánh dấu: 0", () => {
		expect(X.accrued13th(Object.assign({}, base, { isContractor: true }))).toBe(0);
		expect(X.accrued13th(Object.assign({}, base, { accrue13th: false }))).toBe(0);
	});
});
