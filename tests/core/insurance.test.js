// Ca vàng 2.13.1 - bảo hiểm bắt buộc (InsuranceCalculator)
const { core, provider } = require("./helpers");
const Ins = core("InsuranceCalculator");

const P = provider();
const calc = (wage, date, extra = {}) => Ins.calculate(Object.assign({ periodDate: date, insuranceWage: wage, region: "I" }, extra), P);
const line = (r, code) => r.lines.find((l) => l.code === code);
const OCT = "2026-10-31";
const MAY = "2026-05-31";

describe("2.13.1 Bảo hiểm", () => {
	test("BH-01 lương đóng 30tr, 10/2026", () => {
		const r = calc(30000000, OCT);
		expect(r.employeeTotal).toBe(3150000);
		expect(line(r, "BHXH_HT").employeeAmount).toBe(2400000);
		expect(line(r, "BHYT").employeeAmount).toBe(450000);
		expect(line(r, "BHTN").employeeAmount).toBe(300000);
		expect(r.employerTotal).toBe(7050000);
		expect(line(r, "BHXH_HT").employerAmount).toBe(4200000);
		expect(line(r, "BHXH_OD").employerAmount).toBe(900000);
		expect(line(r, "BHTNLD").employerAmount).toBe(150000);
		expect(line(r, "BHYT").employerAmount).toBe(900000);
		expect(line(r, "BHTN").employerAmount).toBe(300000);
		expect(line(r, "KPCD").employerAmount).toBe(600000);
		expect(line(r, "DOANPHI")).toBeUndefined();
	});

	test("BH-02 60tr, 5/2026", () => {
		const r = calc(60000000, MAY);
		expect(r.siBase).toBe(46800000);
		expect(r.uiBase).toBe(60000000);
		expect(line(r, "BHXH_HT").employeeAmount).toBe(3744000);
		expect(line(r, "BHYT").employeeAmount).toBe(702000);
		expect(line(r, "BHTN").employeeAmount).toBe(600000);
		expect(r.employeeTotal).toBe(5046000);
		expect(r.employerTotal).toBe(11130000);
		expect(line(r, "KPCD").employerAmount).toBe(936000);
	});

	test.each([
		["I", 120000000, 106200000],
		["II", 120000000, 94600000],
		["III", 120000000, 82800000],
		["IV", 80000000, 74000000],
		["IV", 50000000, 50000000],
	])("BH-03 trần BHTN vùng %s lương %d -> %d", (region, wage, ui) => {
		const r = calc(wage, OCT, { region });
		expect(r.uiBase).toBe(ui);
		expect(line(r, "BHTN").employeeAmount).toBe(ui / 100);
	});

	test("BH-04 dưới tối thiểu vùng", () => {
		expect(() => calc(4000000, OCT)).toThrow(expect.objectContaining({ code: "VP-INS-BELOW-MINWAGE" }));
	});

	test("BH-05 đúng bằng tối thiểu vùng I", () => {
		expect(calc(5310000, OCT).employeeTotal).toBe(557550);
	});

	test("BH-06 4,8tr vùng II hợp lệ, vùng I lỗi", () => {
		expect(calc(4800000, OCT, { region: "II" }).employeeTotal).toBe(504000);
		expect(() => calc(4800000, OCT)).toThrow(expect.objectContaining({ code: "VP-INS-BELOW-MINWAGE" }));
	});

	test("BH-07 5tr vùng I theo NĐ 293/2025", () => {
		expect(() => calc(5000000, "2025-12-31")).not.toThrow();
		expect(() => calc(5000000, "2026-01-31")).toThrow(expect.objectContaining({ code: "VP-INS-BELOW-MINWAGE" }));
	});

	test("BH-08 vùng lạ và chuẩn hóa vùng", () => {
		expect(() => calc(30000000, OCT, { region: "V" })).toThrow(expect.objectContaining({ code: "VP-INS-UNKNOWN-REGION" }));
		expect(() => calc(30000000, OCT, { region: "" })).toThrow(expect.objectContaining({ code: "VP-INS-UNKNOWN-REGION" }));
		expect(calc(30000000, OCT, { region: " ii " }).employeeTotal).toBe(3150000);
	});

	test.each([[14, 0, 0], [20, 0, 0], [13.5, 3150000, 7050000], [0, 3150000, 7050000]])("BH-09 nghỉ %s ngày", (days, ee, er) => {
		const r = calc(30000000, OCT, { absenceWorkingDays: days });
		expect(r.employeeTotal).toBe(ee);
		expect(r.employerTotal).toBe(er);
		expect(r.skippedForAbsence).toBe(ee === 0);
	});

	test.each([[10000000, 100000], [23400000, 234000], [30000000, 234000], [100000000, 234000]])("BH-10 đoàn phí lương %d", (wage, fee) => {
		const r = calc(wage, MAY, { isUnionMember: true });
		expect(line(r, "DOANPHI").employeeAmount).toBe(fee);
		expect(r.employeeCompulsoryInsurance).toBe(r.employeeTotal - fee);
	});

	test("BH-11 ghi đè BHTNLĐ 0,3%", () => {
		const r = calc(30000000, OCT, { employerRateOverrides: { BHTNLD: "0.003" } });
		expect(line(r, "BHTNLD").employerAmount).toBe(90000);
		expect(r.employerTotal).toBe(6990000);
	});

	test("BH-12 không BHTN", () => {
		expect(calc(30000000, OCT, { unemploymentApplicable: false }).employeeTotal).toBe(2850000);
	});

	test("BH-13 mức tham chiếu đổi 01/07/2026", () => {
		expect(calc(60000000, "2026-06-30").siBase).toBe(46800000);
		const r = calc(60000000, "2026-07-31");
		expect(r.siBase).toBe(50600000);
		expect(line(r, "BHXH_HT").employeeAmount).toBe(4048000);
	});

	test("BH-14 kỳ 12/2023 (thêm MINWAGE.I 2023)", () => {
		const p = provider({ params: [{ code: "MINWAGE.I", value: 4680000, effectiveDate: "2023-01-01", expirationDate: "2024-06-30" }] });
		expect(Ins.calculate({ periodDate: "2023-12-31", insuranceWage: 50000000, region: "I" }, p).siBase).toBe(36000000);
	});

	test("BH-15 người nước ngoài không BHTN", () => {
		const r = calc(60000000, OCT, { unemploymentApplicable: false });
		expect(r.siBase).toBe(50600000);
		expect(r.employeeCompulsoryInsurance).toBe(4807000);
	});

	test("KPCĐ bỏ khi DN không đóng", () => {
		const r = calc(30000000, OCT, { unionFundApplicable: false });
		expect(line(r, "KPCD")).toBeUndefined();
		expect(r.employerTotal).toBe(6450000);
	});
});
