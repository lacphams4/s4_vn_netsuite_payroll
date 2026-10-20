// ReportData: gom dòng bảng lương thành báo cáo BH / D02-LT, 05/KK-TNCN, quyết toán năm, chi phí theo tài khoản
// (đặc tả 4.7.2 - 4.7.5, ca TC34 và S4-TC47 mục 4.8.5).
const { core } = require("./helpers");
const RD = core("ReportData");

const ins = (wage, contributed = true) => (contributed ? [{ code: "BHXH_HT", wageBase: wage, employeeAmount: Math.round(wage * 0.08), employerAmount: Math.round(wage * 0.14) }] : []);

function line(batch, employee, v) {
	return Object.assign({ batch, employee, employment_type: "E", taxable: 0, pit: 0, family_ded: 0, dependents: 0, ee_ins: 0, other_tax_ded: 0, assessable: 0, insurance_wage: 0, gross: 0 }, v, {
		detail: JSON.stringify({ insurance: v.insurance || [], allocations: v.allocations || [], employmentType: v.employment_type || "E", expenseAccount: v.expenseAccount || "" }),
	});
}

describe("usableBatches", () => {
	test("bỏ bảng đảo, chưa tính; releasedOnly chỉ lấy R", () => {
		const b = [{ id: 1, status: "R", calculated: true }, { id: 2, status: "V", calculated: true }, { id: 3, status: "C", calculated: true }, { id: 4, status: "B", calculated: false }];
		expect(RD.usableBatches(b).map((x) => x.id)).toEqual([1, 3]);
		expect(RD.usableBatches(b, { releasedOnly: true }).map((x) => x.id)).toEqual([1]);
	});
});

describe("TC34: 05/KK-TNCN quý 1/2025", () => {
	const batches = [{ id: "b2", tax_month: "202502", periodName: "202502" }, { id: "b3", tax_month: "202503", periodName: "202503" }];
	const lines = [];
	for (const b of ["b2", "b3"]) {
		lines.push(line(b, "1", { taxable: 7920000, pit: 0 }), line(b, "2", { taxable: 22420000, pit: 39545 }), line(b, "3", { taxable: 22420000, pit: 0 }));
	}
	lines.push(line("b2", "7", { employment_type: "C", taxable: 0, pit: 0 }), line("b3", "7", { employment_type: "C", taxable: 15680000, pit: 1568000 }));
	const profiles = { 1: { pit_method: "P", tax_code: "0100000001", personal_id: "001090000001" }, 2: { pit_method: "P" }, 3: { pit_method: "P" }, 7: { pit_method: "F", employment_type: "C" } };
	const info = { 1: { code: "E001", name: "A" }, 2: { code: "E002", name: "B" }, 3: { code: "E003", name: "C" }, 7: { code: "E007", name: "D" } };
	const rows = RD.sourceRows(batches, lines, profiles, info);

	test("chỉ tiêu", () => {
		const r = RD.pitQuarterReport(rows, 2025, 1);
		const v = r.indicatorValues;
		expect([v[16], v[17], v[18], v[21], v[26], v[29]]).toEqual([4, 3, 2, 121200000, 60520000, 1647090]);
		expect(r.indicators).toHaveLength(17);
		expect(r.rows.find((x) => x.employeeCode === "E001")).toMatchObject({ taxCode: "0100000001", idNumber: "001090000001", schedule: "05-1/BK" });
		expect(r.totals.pit).toBe(1647090);
	});

	test("quyết toán năm, lọc bảng kê", () => {
		const all = RD.pitAnnualReport(rows, 2025, "");
		expect(all.rows.map((x) => x.employeeCode)).toEqual(["E001", "E002", "E003", "E007"]);
		expect(RD.pitAnnualReport(rows, 2025, "05-2").rows.map((x) => [x.employeeCode, x.pit])).toEqual([["E007", 1568000]]);
		expect(RD.pitAnnualReport(rows, 2025, "05-1").rows).toHaveLength(3);
	});

	test("CSV có BOM, tiêu đề theo ngôn ngữ", () => {
		const csv = RD.toCsv(RD.pitAnnualReport(rows, 2025, ""), "vi");
		expect(csv.charCodeAt(0)).toBe(0xfeff);
		expect(csv.split("\r\n")[0]).toContain('"Mã NV"');
		expect(csv.split("\r\n")).toHaveLength(5);
	});
});

describe("S4-TC47: BH tháng 10/2026 và D02-LT", () => {
	const sep = [line("s", "E003", { insurance_wage: 20000000, insurance: ins(20000000) }), line("s", "T104", { insurance_wage: 12000000, insurance: ins(12000000) }),
		line("s", "T105", { insurance_wage: 25000000, insurance: ins(25000000) }), line("s", "T106", { insurance_wage: 12000000, insurance: ins(12000000) }),
		line("s", "T101", { insurance_wage: 10000000, insurance: ins(10000000) })];
	const oct = [line("o", "E003", { insurance_wage: 20000000, insurance: ins(20000000) }), line("o", "T101", { insurance_wage: 10000000, insurance: ins(10000000) }),
		line("o", "T103", { insurance_wage: 15000000, insurance: [] }), line("o", "T104", { insurance_wage: 12000000, insurance: [] }),
		line("o", "T105", { insurance_wage: 25000000, insurance: ins(25000000) }), line("o", "T106", { insurance_wage: 14000000, insurance: ins(14000000) }),
		line("o", "T107", { insurance_wage: 6000000, insurance: ins(6000000) })];
	const info = Object.fromEntries(["E003", "T101", "T103", "T104", "T105", "T106", "T107"].map((k) => [k, { code: k, name: k }]));
	const cur = RD.sourceRows([{ id: "o", tax_month: "202610" }], oct, {}, info);
	const prev = RD.sourceRows([{ id: "s", tax_month: "202609" }], sep, {}, info);
	const prof = {
		E003: { insuranceApplicable: true, hireDate: "2020-01-01" }, T101: { insuranceApplicable: true }, T103: { insuranceApplicable: false, hireDate: "2026-10-15" },
		T104: { insuranceApplicable: true }, T105: { insuranceApplicable: true, terminationDate: "2026-10-20" }, T106: { insuranceApplicable: true, wageEffectiveDate: "2026-09-01" },
		T107: { insuranceApplicable: true, hireDate: "2026-10-01" },
	};

	test("đúng 4 dòng biến động", () => {
		const r = RD.insuranceReport(cur, prev, prof, prof, "202610", null);
		expect(r.d02.rows.map((x) => [x.employeeCode, x.code, x.fromMonth, x.oldWage, x.newWage])).toEqual([
			["T104", "KL", "10/2026", 12000000, null],
			["T105", "GH", "11/2026", 25000000, null],
			["T106", "DC", "09/2026", 12000000, 14000000],
			["T107", "TM", "10/2026", null, 6000000],
		]);
		expect(r.c12Difference).toBeNull();
	});

	test("bảng BH, tổng và chênh lệch C12", () => {
		const r = RD.insuranceReport(cur, prev, prof, prof, "202610", 1);
		const expectedEe = [20, 10, 25, 14, 6].reduce((s, m) => s + Math.round(m * 1e6 * 0.08), 0);
		expect(r.totals.eeSocial).toBe(expectedEe);
		expect(r.rows.map((x) => x.employeeCode)).toEqual(["E003", "T101", "T105", "T106", "T107"]);
		expect(r.c12Difference).toBe(r.totals.total - 1);
		expect(r.warnings.map((w) => w.code)).toContain("C12_DIFF");
	});

	test("tháng trước không có bảng lương: chỉ báo tăng người vào làm trong tháng", () => {
		const r = RD.insuranceReport(cur, null, prof, prof, "202610", null);
		expect(r.d02.rows.filter((x) => x.code === "TM").map((x) => x.employeeCode)).toEqual(["T107"]);
		expect(r.warnings.map((w) => w.code)).toContain("NO_PREV");
	});
});

describe("Chi phí theo tài khoản (VP405000)", () => {
	const lines = [
		line("b", "1", { accrued13: 2500000, expenseAccount: "6421", allocations: [{ component: "GROSS", amount: 30000000, account: "6421", sub: "D1" }, { component: "ERINS", amount: 7050000, account: "6421", sub: "D1" }] }),
		line("b", "2", { employment_type: "C", allocations: [{ component: "GROSS", amount: 4116000, account: "6421", sub: "D1" }] }),
		line("b", "3", { allocations: [{ component: "GROSS", amount: 10400000, account: "622", sub: "" }, { component: "ERINS", amount: 2444000, account: "622", sub: "" }] }),
	];
	const rows = RD.sourceRows([{ id: "b", tax_month: "202611" }], lines, {}, {});

	test("tổng theo tài khoản, so với bút toán", () => {
		const gl = [{ account: "6421", debit: 30000000 + 7050000 + 2500000 + 4116000, credit: 0 }, { account: "622", debit: 12844000, credit: 1000 }];
		const r = RD.costReport(rows, gl, { accounts: { 6421: { number: "6421", name: "Chi phí nhân viên quản lý" } }, departments: { D1: "Văn phòng" } });
		// 6421 tách hai dòng: phòng ban của dòng phân bổ và dòng trích trước tháng 13 (không phòng ban);
		// số bút toán và chênh lệch ghi trên dòng đầu của tài khoản
		expect(r.rows.map((x) => [x.accountNumber, x.department, x.total, x.gl, x.difference])).toEqual([
			["622", "", 12844000, 12843000, 1000],
			["6421", "", 2500000, 43666000, 0],
			["6421", "Văn phòng", 41166000, null, null],
		]);
		expect(r.rows[2]).toMatchObject({ wages: 30000000, employerIns: 7050000, contractor: 4116000, accountName: "Chi phí nhân viên quản lý" });
		expect(r.totals.difference).toBe(1000);
		expect(r.warnings.map((w) => w.code)).toEqual(["GL_DIFF"]);
	});

	test("không đọc được bút toán: không so sánh", () => {
		const r = RD.costReport(rows, null, {});
		expect(r.glCompared).toBe(false);
		expect(r.rows.every((x) => x.gl === null)).toBe(true);
		expect(r.totals.total).toBe(43666000 + 12844000);
	});
});
