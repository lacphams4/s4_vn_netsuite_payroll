// Mô hình in phiếu lương, bảng thanh toán, quyết toán CTV (đặc tả 4.7.1). Số liệu theo bảng lương thử 10/2026 (KB-15, TN-01, FL-05).
const { core } = require("./helpers");
const Print = core("PrintModel");

const ins = (code, ee, er) => ({ code, employeeAmount: ee, employerAmount: er });
const detail = {
	batch: { name: "BL000003", periodName: "202610", tax_month: "202610", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
	lines: [
		{
			employee: "2683", code: "E013", name: "Công nhân B", department: "Xưởng", employment_type: "E", std_days: 22, work_days: 22, base_salary: 10400000, benefit: 0,
			insurance_wage: 10400000, gross: 13340000, exempt: 940000, taxable: 12400000, ee_ins: 1092000, er_ins: 2444000, dependents: 0, family_ded: 15500000,
			assessable: 0, pit: 0, other_ded: 0, advance: 0, net: 12248000, other_tax_ded: 0,
			earnings: [{ earningType: "LUONG", name: "Lương cơ bản", quantity: 22, rate: 472727, amount: 10400000 }, { earningType: "OT150", name: "Làm thêm ngày thường", quantity: 10, rate: 50000, amount: 750000 }, { earningType: "DEM", name: "Đêm", quantity: 0, rate: 0, amount: 0 }],
			insurance: [ins("BHXH_HT", 832000, 1456000), ins("BHXH_OD", 0, 312000), ins("BHTNLD", 0, 52000), ins("BHYT", 156000, 312000), ins("BHTN", 104000, 104000), ins("KPCD", 0, 208000)],
			deductions: [],
		},
		{
			employee: "2682", code: "E012", name: "Văn phòng A", department: "Kế toán", employment_type: "E", std_days: 22, work_days: 20, base_salary: 27272727, benefit: 0,
			insurance_wage: 30000000, gross: 27272727, exempt: 0, taxable: 27272727, ee_ins: 3450000, er_ins: 7050000, dependents: 1, family_ded: 21700000,
			assessable: 2422727, pit: 121136, other_ded: 200000, advance: 5000000, net: 18501591, other_tax_ded: 0,
			earnings: [{ earningType: "LUONG", name: "Lương cơ bản", quantity: 20, rate: 1363636, amount: 27272727 }],
			insurance: [ins("BHXH_HT", 2400000, 4200000), ins("BHXH_OD", 0, 900000), ins("BHTNLD", 0, 150000), ins("BHYT", 450000, 900000), ins("BHTN", 300000, 300000), ins("KPCD", 0, 600000), ins("DOANPHI", 300000, 0)],
			deductions: [{ code: "BOITHUONG", name: "Bồi thường", amount: 200000 }],
		},
		{
			employee: "2684", code: "E014", name: "CTV C", department: "", employment_type: "C", std_days: 22, work_days: 22, base_salary: 15680000, gross: 15680000, pit: 1568000, net: 14112000,
			earnings: [{ earningType: "PHIDV", name: "Thù lao", quantity: 80, rate: 196000, amount: 15680000 }], insurance: [], deductions: [],
		},
	],
};
const opts = { lang: "vi", company: { name: "Công ty Test", address: "Hà Nội", taxId: "0100000000" }, signers: { preparer: "A", chiefAccountant: "B", director: "C" }, profiles: { 2682: { contractSalary: 30000000 }, 2684: { taxCode: "8000000001", personalId: "001200000001", contractSalary: 196000 } } };

describe("PrintModel", () => {
	test("định dạng số", () => {
		expect(Print.money(1234567)).toBe("1.234.567");
		expect(Print.money(0)).toBe("-");
		expect(Print.money(-5000)).toBe("(5.000)");
		expect(Print.qty(22.5)).toBe("22,5");
		expect(Print.vnDate("2026-10-31")).toBe("31/10/2026");
	});

	test("phiếu lương: chỉ nhân viên E, sắp theo mã, thu nhập khác 0, khấu trừ theo khoản", () => {
		const m = Print.payslips(detail, opts);
		expect(m.title).toBe("PHIẾU LƯƠNG");
		expect(m.periodLine).toBe("Tháng 10 năm 2026");
		expect(m.pages.map((p) => p.info[0].value)).toEqual(["E012", "E013"]);
		const a = m.pages[0];
		expect(a.info[3].value).toBe("30.000.000");
		expect(a.deductions.map((d) => [d.label, d.amount])).toEqual([
			["BHXH (8%)", "2.400.000"], ["BHYT (1,5%)", "450.000"], ["BHTN (1%)", "300.000"], ["Đoàn phí công đoàn", "300.000"], ["Thuế TNCN", "121.136"], ["Bồi thường", "200.000"], ["Cấn trừ tạm ứng", "5.000.000"],
		]);
		expect(a.totalDeduction).toBe("8.771.136");
		// BH được trừ không gồm đoàn phí
		expect(a.tax[2].value).toBe("3.150.000");
		const b = m.pages[1];
		expect(b.earnings.map((e) => e.amount)).toEqual(["10.400.000", "750.000"]);
		expect(b.netWords).toBe("Mười hai triệu hai trăm bốn mươi tám nghìn đồng");
		expect(Print.payslips(detail, Object.assign({}, opts, { employee: "2683" })).pages).toHaveLength(1);
	});

	test("bảng thanh toán: cột BH theo nhóm NLĐ + DN, giảm trừ, điều chỉnh, dòng tổng", () => {
		const m = Print.paymentSheet(detail, opts);
		expect(m.rows).toHaveLength(2);
		const a = m.rows[0];
		expect(a.si).toBe("7.650.000");
		expect(a.hi).toBe("1.350.000");
		expect(a.ui).toBe("600.000");
		expect(a.insTotal).toBe("9.600.000");
		expect(a.deduct).toBe("24.850.000");
		expect(a.adjust).toBe("(5.200.000)");
		expect(a.leave).toBe("2");
		expect(m.rows[1].leave).toBe("-");
		expect(m.total.net).toBe("30.749.591");
		expect(m.netWords).toBe("Tổng thực lĩnh bằng chữ: Ba mươi triệu bảy trăm bốn mươi chín nghìn năm trăm chín mươi mốt đồng");
		expect(m.signers.map((s) => s.title)).toEqual(["Người lập biểu", "Kế toán trưởng", "Giám đốc"]);
	});

	test("quyết toán CTV: chỉ C, giờ, đơn giá = lương HĐ, MST, CCCD", () => {
		const m = Print.contractorSettlement(detail, opts);
		expect(m.rows).toEqual([{ stt: "1", name: "CTV C", taxCode: "8000000001", personalId: "001200000001", hours: "80", rate: "196.000", gross: "15.680.000", pit: "1.568.000", net: "14.112.000" }]);
		expect(m.total.net).toBe("14.112.000");
		expect(m.windowLine).toBe("Kỳ thanh toán: 202610 (01/10/2026 - 31/10/2026)");
	});

	test("song ngữ và tiếng Anh", () => {
		expect(Print.payslips(detail, Object.assign({}, opts, { lang: "en" })).title).toBe("PAYSLIP");
		expect(Print.paymentSheet(detail, Object.assign({}, opts, { lang: "bi" })).periodLine).toBe("Tháng 10 năm 2026 / October 2026");
	});
});
