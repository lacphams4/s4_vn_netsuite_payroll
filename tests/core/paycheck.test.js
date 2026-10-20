// Ca vàng 2.13.5 - phiếu lương đầy đủ, UAT S4 2025, 2.13.3 FL-05/06 và bất biến 2.5.2 (PaycheckCalculator)
const { core, provider } = require("./helpers");
const Paycheck = core("PaycheckCalculator");

const P = provider();
const month = (ym) => {
	const [y, m] = ym.split("-").map(Number);
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return { periodStart: `${ym}-01`, periodEnd: `${ym}-${String(last).padStart(2, "0")}` };
};
const emp = (x = {}) => Object.assign({ employeeCd: "E001", pitMethod: "P", insuranceWage: 30000000, region: "I", dependents: [] }, x);
const dep1 = [{ deductFrom: "2024-01-01" }];
const T = (code, amount) => ({ code, amount, taxTreatment: "T" });
const run = (ym, x, p = P) => Paycheck.calculate(Object.assign(month(ym), x), p);
const codes = (r) => r.warnings.map((w) => w.code);

describe("2.13.5 Phiếu lương", () => {
	test("KB-01", () => {
		const r = run("2026-10", {
			employee: emp({ dependents: dep1 }),
			earnings: [T("LUONG", 30000000), { code: "ANCA", amount: 730000, taxTreatment: "C", exemptCapParameter: "PIT.MEAL_EXEMPT_CAP" },
				{ code: "OT150", amount: 150000, taxTreatment: "P", taxExemptAmount: 50000 }],
		});
		expect(r.grossPay).toBe(30880000);
		expect(r.taxExemptIncome).toBe(780000);
		expect(r.taxableIncome).toBe(30100000);
		expect(r.employeeInsurance).toBe(3150000);
		expect(r.pit.assessableIncome).toBe(5250000);
		expect(r.pit.tax).toBe(262500);
		expect(r.netPay).toBe(27467500);
		expect(r.employerCost).toBe(37930000);
		expect(r.warnings).toEqual([]);
	});

	test("KB-02 ăn ca một dòng hoặc hai dòng cùng tham số trần", () => {
		const one = run("2026-05", { employee: emp(), earnings: [T("LUONG", 30000000), { code: "ANCA", amount: 1000000, taxTreatment: "C" }] });
		const two = run("2026-05", {
			employee: emp(),
			earnings: [T("LUONG", 30000000), { code: "ANCA", amount: 500000, taxTreatment: "C", exemptCapParameter: "PIT.MEAL_EXEMPT_CAP" },
				{ code: "ANCA2", amount: 500000, taxTreatment: "C", exemptCapParameter: "PIT.MEAL_EXEMPT_CAP" }],
		});
		expect(one.taxExemptIncome).toBe(730000);
		expect(two.taxExemptIncome).toBe(730000);
		expect(one.pit.tax).toBe(two.pit.tax);
	});

	test("KB-03 thời vụ khấu trừ 10%", () => {
		const e = emp({ pitMethod: "F", insuranceApplicable: false });
		const r = run("2026-05", { employee: e, earnings: [T("KHOAN", 3000000)] });
		expect(r.employeeInsurance).toBe(0);
		expect(r.pit.tax).toBe(300000);
		expect(r.netPay).toBe(2700000);
		expect(run("2026-05", { employee: Object.assign({}, e, { hasFlatTaxCommitment: true }), earnings: [T("KHOAN", 3000000)] }).netPay).toBe(3000000);
	});

	test("KB-04 nghỉ 14 ngày", () => {
		const r = run("2026-10", { employee: emp(), earnings: [T("LUONG", 15000000)], absenceWorkingDays: 14 });
		expect(r.employeeInsurance).toBe(0);
		expect(r.employerInsurance).toBe(0);
		expect(r.pit.tax).toBe(0);
		expect(r.netPay).toBe(15000000);
		expect(codes(r)).toContain("AbsenceNoInsurance");
		expect(r.warnings[0].message).toMatch(/report a decrease/);
	});

	test("KB-05 lương cao, đoàn viên, 2 NPT", () => {
		const r = run("2026-05", {
			employee: emp({ insuranceWage: 150000000, isUnionMember: true, dependents: [{ deductFrom: "2024-01-01" }, { deductFrom: "2025-01-01" }] }),
			earnings: [T("LUONG", 150000000)],
		});
		expect(r.employeeCompulsoryInsurance).toBe(5508000);
		expect(r.insurance.lines.find((l) => l.code === "DOANPHI").employeeAmount).toBe(234000);
		expect(r.employeeInsurance).toBe(5742000);
		expect(r.pit.assessableIncome).toBe(116592000);
		expect(r.pit.tax).toBe(26307200);
		expect(r.netPay).toBe(117950800);
	});

	test("KB-06 NPT đăng ký từ 15/03/2026", () => {
		const e = emp({ dependents: [{ deductFrom: "2026-03-15" }] });
		const feb = run("2026-02", { employee: e, earnings: [T("LUONG", 30000000)] });
		const mar = run("2026-03", { employee: e, earnings: [T("LUONG", 30000000)] });
		expect([feb.dependentCount, feb.pit.tax]).toEqual([0, 635000]);
		expect([mar.dependentCount, mar.pit.tax]).toEqual([1, 257500]);
	});

	test("KB-07 NPT hết giảm trừ 10/02/2026", () => {
		const e = emp({ dependents: [{ deductFrom: "2024-01-01", deductTo: "2026-02-10" }] });
		expect(run("2026-02", { employee: e, earnings: [T("LUONG", 30000000)] }).dependentCount).toBe(1);
		expect(run("2026-03", { employee: e, earnings: [T("LUONG", 30000000)] }).dependentCount).toBe(0);
	});

	test("KB-08 không cư trú", () => {
		const r = run("2026-10", { employee: emp({ pitMethod: "N", insuranceApplicable: false }), earnings: [T("LUONG", 100000000)] });
		expect(r.pit.tax).toBe(20000000);
		expect(r.netPay).toBe(80000000);
	});

	test("KB-09 12/2025", () => {
		const r = run("2025-12", { employee: emp({ dependents: dep1 }), earnings: [T("LUONG", 30000000)] });
		expect(r.pit.tax).toBe(967500);
		expect(r.netPay).toBe(25882500);
	});

	test("KB-10 cấn trừ tạm ứng 5tr", () => {
		const r = run("2026-10", { employee: emp({ dependents: dep1 }), earnings: [T("LUONG", 30000000)], openAdvances: [{ refNbr: "TU001", date: "2026-10-05", balance: 5000000 }] });
		expect(r.netBeforeAdvance).toBe(30000000 - 3150000 - 257500);
		expect(r.netBeforeAdvance).toBe(26592500);
		expect(r.advanceOffset.totalOffset).toBe(5000000);
		expect(r.netPay).toBe(21592500);
	});

	test("KB-11 tạm ứng lớn hơn thực lĩnh", () => {
		const r = run("2026-10", { employee: emp({ insuranceWage: 10000000 }), earnings: [T("LUONG", 10000000)], openAdvances: [{ refNbr: "TU001", date: "2026-10-05", balance: 15000000 }] });
		expect(r.netBeforeAdvance).toBe(8950000);
		expect(r.netPay).toBe(0);
		expect(r.advanceOffset.remainingBalance).toBe(15000000 - r.netBeforeAdvance);
		expect(r.advanceOffset.remainingBalance).toBe(6050000);
		expect(codes(r)).toContain("AdvanceCarryForward");
		expect(r.warnings.find((w) => w.code === "AdvanceCarryForward").message).toMatch(/^6,050,000 of advances remain unsettled/);
	});

	test("KB-12 thực lĩnh âm", () => {
		const r = run("2026-10", { employee: emp({ insuranceWage: 10000000 }), earnings: [T("LUONG", 10000000)], otherDeductions: [{ code: "BOITHUONG", amount: 20000000 }] });
		expect(r.netPay).toBeLessThan(0);
		expect(codes(r)).toContain("NegativeNetPay");
	});

	test("KB-13 trợ cấp miễn thuế toàn bộ", () => {
		const r = run("2026-10", { employee: emp(), earnings: [T("LUONG", 30000000), { code: "TROCAP", amount: 2000000, taxTreatment: "E" }] });
		expect(r.taxableIncome).toBe(30000000);
	});

	test("KB-14 OT khai miễn vượt số tiền", () => {
		const r = run("2026-10", { employee: emp(), earnings: [T("LUONG", 30000000), { code: "OT", amount: 100000, taxTreatment: "P", taxExemptAmount: 500000 }] });
		expect(r.taxExemptIncome).toBe(100000);
	});

	test("KB-15 công nhân vùng II có OT", () => {
		const r = run("2026-10", {
			employee: emp({ region: "II", insuranceWage: 10400000 }),
			earnings: [T("LUONG", 10400000), { code: "OT150", amount: 750000, taxTreatment: "P", taxExemptAmount: 250000 },
				{ code: "OT200", amount: 800000, taxTreatment: "P", taxExemptAmount: 400000 },
				{ code: "OTD300", amount: 390000, taxTreatment: "P", taxExemptAmount: 290000 }, T("PCCT", 1000000)],
		});
		expect(r.grossPay).toBe(13340000);
		expect(r.taxExemptIncome).toBe(940000);
		expect(r.employeeInsurance).toBe(1092000);
		expect(r.employerInsurance).toBe(2444000);
		expect(r.pit.tax).toBe(0);
		expect(r.netPay).toBe(12248000);
		expect(r.employerCost).toBe(15784000);
	});

	test("KB-16 ăn ca vượt trần 1.200.000", () => {
		const r = run("2026-10", { employee: emp({ insuranceWage: 20000000 }), earnings: [T("LUONG", 20000000), { code: "ANCA", amount: 1300000, taxTreatment: "C", exemptCapParameter: "PIT.MEAL_EXEMPT_CAP" }] });
		expect(r.taxExemptIncome).toBe(1200000);
	});

	test("Lỗi đầu vào: thiếu hồ sơ, kỳ ngược", () => {
		expect(() => Paycheck.calculate({ periodStart: "2026-10-01", periodEnd: "2026-10-31", earnings: [] }, P)).toThrow(/profile is missing/);
		expect(() => Paycheck.calculate({ periodStart: "2026-10-31", periodEnd: "2026-10-01", employee: emp(), earnings: [] }, P)).toThrow(/earlier than the start/);
	});
});

describe("2.13.3 FL-05/06 UAT CTV (thù lao giờ x 196.000)", () => {
	const ctv = emp({ pitMethod: "F", insuranceApplicable: false, unemploymentApplicable: false });
	test("FL-05 3/2025 80 giờ", () => {
		const r = run("2025-03", { employee: ctv, earnings: [T("PHIDV", 80 * 196000)] });
		expect([r.grossPay, r.pit.tax, r.netPay, r.employeeInsurance]).toEqual([15680000, 1568000, 14112000, 0]);
	});
	test("FL-06 4/2025 21 giờ", () => {
		const r = run("2025-04", { employee: ctv, earnings: [T("PHIDV", 21 * 196000)] });
		expect([r.grossPay, r.pit.tax, r.netPay]).toEqual([4116000, 411600, 3704400]);
	});
});

describe("UAT S4 kỳ 2025 (gói phúc lợi A, B, C; không KPCĐ)", () => {
	const E = (code, amount) => ({ code, amount, taxTreatment: "E" });
	const meal = { code: "PL01", amount: 730000, taxTreatment: "C", exemptCapParameter: "PIT.MEAL_EXEMPT_CAP" };
	// Gói theo đặc tả; PL02-PL06 suy ra miễn thuế (E) từ số tính thuế UAT-2 (790.900).
	const pkgA = [meal, E("PL02", 250000), E("PL03", 200000), E("PL04", 400000), E("PL05", 300000), E("PL06", 1000000), E("PL07", 200000)];
	const pkgB = [meal, E("PL02", 750000), E("PL03", 600000), E("PL04", 1200000), E("PL05", 900000), E("PL06", 3000000), E("PL07", 400000), T("PL08", 3000000), T("PL10", 2000000)];
	const pkgC = pkgB.filter((x) => x.code !== "PL10").concat([T("PL09", 3000000)]);
	const deps = (n) => Array.from({ length: n }, () => ({ deductFrom: "2024-01-01" }));
	const uat = (ym, wage, pkg, n) => run(ym, {
		employee: emp({ insuranceWage: wage, dependents: deps(n) }),
		earnings: [T("LUONG", wage)].concat(pkg),
		unionFundApplicable: false,
	});

	test.each([
		["UAT-1", "2025-02", 7920000, pkgA, 0, 11000000, 831600, 0, 0, 10168400, 1702800],
		["UAT-2", "2025-02", 17420000, pkgB, 2, 30000000, 1829100, 790900, 39545, 28131355, 3745300],
		["UAT-3", "2025-02", 16420000, pkgC, 3, 30000000, 1724100, 0, 0, 28275900, 3530300],
		["UAT-4", "2025-04", 7420000, pkgB, 2, 20000000, 779100, 0, 0, 19220900, 1595300],
		["UAT-5", "2025-04", 6420000, pkgC, 3, 20000000, 674100, 0, 0, 19325900, 1380300],
	])("%s", (_, ym, wage, pkg, n, gross, ee, assessable, tax, net, er) => {
		const r = uat(ym, wage, pkg, n);
		expect([r.grossPay, r.employeeInsurance, r.pit.assessableIncome, r.pit.tax, r.netPay, r.employerInsurance]).toEqual([gross, ee, assessable, tax, net, er]);
	});

	test("Tổng BH ba nhân viên", () => {
		const total = (ym, wages) => wages.map((w, i) => uat(ym, w, [pkgA, pkgB, pkgC][i], [0, 2, 3][i])).reduce((s, r) => s + r.employeeInsurance + r.employerInsurance, 0);
		expect(total("2025-02", [7920000, 17420000, 16420000])).toBe(13363200);
		expect(total("2025-04", [7920000, 7420000, 6420000])).toBe(6963200);
	});
});

describe("2.5.2 Bất biến (200 nhân viên ngẫu nhiên, seed cố định)", () => {
	// LCG có seed để chạy lại được
	let seed = 20261020;
	const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	const pick = (a) => a[Math.floor(rnd() * a.length)];
	test("NetPay = Gross - BH NLĐ - thuế - khấu trừ - cấn trừ; thuế trong [0; 35% chịu thuế]; số nguyên; trần BHXH", () => {
		for (let i = 0; i < 200; i++) {
			const ym = pick(["2025-06", "2026-02", "2026-05", "2026-10"]);
			const region = pick(["I", "II", "III", "IV"]);
			const wage = 5400000 + Math.floor(rnd() * 120000000);
			const method = pick(["P", "P", "P", "F", "N", "X"]);
			const insured = method === "P" ? rnd() > 0.1 : false;
			const earnings = [T("LUONG", Math.floor(rnd() * 150000000))];
			if (rnd() > 0.5) earnings.push({ code: "ANCA", amount: Math.floor(rnd() * 2000000), taxTreatment: "C" });
			if (rnd() > 0.5) earnings.push({ code: "OT", amount: Math.floor(rnd() * 3000000), taxTreatment: "P", taxExemptAmount: Math.floor(rnd() * 1500000) });
			if (rnd() > 0.7) earnings.push({ code: "TROCAP", amount: Math.floor(rnd() * 1000000), taxTreatment: "E" });
			const r = run(ym, {
				employee: emp({ pitMethod: method, insuranceApplicable: insured, region, insuranceWage: wage, isUnionMember: rnd() > 0.5, dependents: rnd() > 0.5 ? dep1 : [] }),
				earnings,
				absenceWorkingDays: rnd() > 0.9 ? 14 : 0,
				otherDeductions: rnd() > 0.7 ? [{ code: "X", amount: Math.floor(rnd() * 5000000) }] : [],
				openAdvances: rnd() > 0.6 ? [{ refNbr: "TU" + i, date: `${ym}-01`, balance: Math.floor(rnd() * 20000000) }] : [],
			});
			expect(r.netPay).toBe(r.grossPay - r.employeeInsurance - r.pit.tax - r.otherDeductions - r.advanceOffset.totalOffset);
			expect(r.pit.tax).toBeGreaterThanOrEqual(0);
			expect(r.pit.tax).toBeLessThanOrEqual(r.taxableIncome * 0.35 + 0.5);
			expect(Number.isInteger(r.netPay)).toBe(true);
			const ref = ym >= "2026-07" ? 2530000 : ym >= "2024-07" ? 2340000 : 1800000;
			expect(r.insurance.siBase).toBeLessThanOrEqual(20 * ref);
		}
	});
});
