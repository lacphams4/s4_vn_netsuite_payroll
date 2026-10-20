// Ca vàng 2.13.4 - làm thêm giờ, làm đêm (lương giờ 50.000, 10/2026)
const { core, provider } = require("./helpers");
const Ot = core("OvertimeCalculator");
const Extras = core("PayrollExtras");

const P = provider();
const OCT = "2026-10-31";

describe("2.13.4 OT và làm đêm", () => {
	test.each([
		["N", false, false, false, 1.0],
		["N", false, true, false, 1.3],
		["N", true, false, false, 1.5],
		["W", true, false, false, 2.0],
		["H", true, false, false, 3.0],
		["N", true, true, false, 2.0],
		["N", true, true, true, 2.1],
		["W", true, true, false, 2.7],
		["H", true, true, false, 3.9],
	])("OT-01 hệ số %s OT=%s đêm=%s đã OT ngày=%s -> %s", (dayType, isOvertime, isNight, hadDaytimeOvertime, m) => {
		expect(Ot.multiplier({ dayType, isOvertime, isNight, hadDaytimeOvertime }, P, OCT)).toBe(m);
	});

	const run = (hours, segment, rate = 50000) => Ot.calculate({ hourlyRate: rate, hours, segment }, P, OCT);

	test("OT-02 OT ngày thường 2 giờ", () => {
		const r = run(2, { dayType: "N", isOvertime: true });
		expect([r.amount, r.baseAmount, r.taxExemptAmount]).toEqual([150000, 100000, 50000]);
	});

	test("OT-03 OT đêm ngày lễ 2 giờ", () => {
		const r = run(2, { dayType: "H", isOvertime: true, isNight: true });
		expect([r.amount, r.taxExemptAmount]).toEqual([390000, 290000]);
	});

	test("OT-04 OT nghỉ tuần 8 giờ", () => {
		const r = run(8, { dayType: "W", isOvertime: true });
		expect([r.amount, r.taxExemptAmount]).toEqual([800000, 400000]);
	});

	test("OT-05 ca đêm trong giờ chuẩn 8 giờ", () => {
		const r = run(8, { dayType: "N", isOvertime: false, isNight: true });
		expect([r.amount, r.taxExemptAmount]).toEqual([520000, 120000]);
	});

	test("OT-06 đơn giá giờ 10.400.000 / 26 / 8", () => {
		expect(Extras.hourlyRate({ salaryType: "M", baseSalary: 10400000, standardDays: 26, hoursPerDay: 8 }).toNumber()).toBe(50000);
	});

	test("OT-07 lương giờ 33.333,33", () => {
		const r = run(1, { dayType: "N", isOvertime: true }, "33333.33");
		expect([r.amount, r.baseAmount]).toEqual([50000, 33333]);
	});

	test("OT-08 giờ âm; ngày công chuẩn 0", () => {
		expect(() => run(-1, { dayType: "N", isOvertime: true })).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
		expect(() => Extras.hourlyRate({ salaryType: "M", baseSalary: 10400000, standardDays: 0, hoursPerDay: 8 }))
			.toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
	});

	test.each([[38, 100, 4, true], [30, 100, 4, false], [36, 100, 4, false]])("OT-09 tháng (%d, %d, %d) vi phạm=%s", (m, y, n, exceeded) => {
		expect(Ot.checkLimits({ monthToDate: m, yearToDate: y, newHours: n }, P, OCT).monthExceeded).toBe(exceeded);
	});

	test.each([[10, 198, 4, false, true], [10, 198, 4, true, false], [10, 298, 4, true, true]])("OT-10 năm (%d, %d, %d) ngành300=%s vi phạm=%s", (m, y, n, ext, exceeded) => {
		expect(Ot.checkLimits({ monthToDate: m, yearToDate: y, newHours: n, extendedSector: ext }, P, OCT).yearExceeded).toBe(exceeded);
	});
});
