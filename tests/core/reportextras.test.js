// ReportExtras: danh mục hồ sơ và kỳ gợi ý, phiếu số liệu nhập HTKK (05/KK-TNCN, quyết toán năm), quỹ lương theo phòng ban x
// loại lao động, sổ theo dõi thuế TNCN đã khấu trừ (docs/UI_V2.md mục 14 - Báo cáo - tờ khai).
const { core } = require("./helpers");
const RX = core("ReportExtras");
const RD = core("ReportData");

const batch = (id, taxMonth, status, v) => Object.assign({ id: String(id), name: `BL${String(id).padStart(6, "0")}`, tax_month: taxMonth, status, calculated: status !== "B" && status !== "H", emp_count: 4, gross: 100000000 }, v);

describe("catalog", () => {
	const batches = [
		batch(1, "202701", "R"), batch(2, "202702", "R"), batch(3, "202703", "R"), batch(4, "202704", "C"), batch(5, "202704", "A", { emp_count: 2, gross: 30000000 }),
		batch(6, "202705", "B"), batch(7, "202704", "V"), batch(8, "", "C"),
	];
	const c = RX.catalog(batches, "2027-06-15");

	test("tháng gần nhất đã tính và đã ghi sổ; bỏ bảng đảo, chưa tính, thiếu tháng", () => {
		expect(c.latest).toEqual({ calculated: "202704", released: "202703" });
		expect(c.months.map((m) => m.taxMonth)).toEqual(["202704", "202703", "202702", "202701"]);
		expect(c.months[0]).toEqual({ taxMonth: "202704", batches: 2, released: 0, employees: 6, gross: 130000000 });
	});

	test("kỳ gợi ý theo nhịp: tháng, quý, năm; báo cáo chi phí lấy tháng đã ghi sổ", () => {
		const by = Object.fromEntries(c.items.map((i) => [i.key, i]));
		expect(Object.keys(by)).toEqual(["insurance", "cost", "fund", "pitq", "pitLedger", "pita", "print"]);
		expect(by.insurance).toMatchObject({ cadence: "monthly", period: { taxMonth: "202704" }, hasData: true, batches: 2, released: 0, pending: 2 });
		expect(by.cost).toMatchObject({ cadence: "monthly", period: { taxMonth: "202703" }, batches: 1, released: 1, pending: 0 });
		expect(by.pitq).toMatchObject({ cadence: "quarterly", period: { year: 2027, quarter: 2 }, batches: 2, pending: 2 });
		expect(by.pita).toMatchObject({ cadence: "yearly", period: { year: 2027 }, batches: 5, released: 3, months: 4 });
		expect(c.printBatch).toEqual({ id: "5", name: "BL000005", taxMonth: "202704", status: "A" });
	});

	test("chưa có bảng lương nào: gợi ý tháng hiện tại, hasData = false", () => {
		const e = RX.catalog([], "2027-06-15");
		expect(e.latest).toEqual({ calculated: "", released: "" });
		expect(e.items.find((i) => i.key === "insurance")).toMatchObject({ period: { taxMonth: "202706" }, hasData: false, batches: 0 });
		expect(e.items.find((i) => i.key === "pitq").period).toEqual({ year: 2027, quarter: 2 });
		expect(e.printBatch).toBeNull();
		expect(RX.catalog(null, "").items.find((i) => i.key === "pita").period).toEqual({ year: null });
	});
});

// Dòng nguồn như tests/core/reportdata.test.js (ca TC34)
function line(b, employee, v) {
	return Object.assign({ batch: b, employee, employment_type: "E", taxable: 0, pit: 0, family_ded: 0, dependents: 0, ee_ins: 0, other_tax_ded: 0, assessable: 0, insurance_wage: 0, gross: 0 }, v, {
		detail: JSON.stringify({ insurance: [], allocations: [], employmentType: v.employment_type || "E" }),
	});
}
const srcBatches = [{ id: "b2", tax_month: "202502", periodName: "202502" }, { id: "b3", tax_month: "202503", periodName: "202503" }];
const srcLines = [];
for (const b of ["b2", "b3"]) srcLines.push(line(b, "1", { taxable: 7920000, pit: 0 }), line(b, "2", { taxable: 22420000, pit: 39545, family_ded: 11000000, dependents: 1 }), line(b, "3", { taxable: 22420000, pit: 0 }));
srcLines.push(line("b3", "7", { employment_type: "C", taxable: 15680000, pit: 1568000 }), line("b3", "8", { employment_type: "E", taxable: 50000000, pit: 10000000 }));
const profiles = { 1: { pit_method: "P", tax_code: "0100000001", personal_id: "001090000001" }, 2: { pit_method: "P", tax_code: "0100000002" }, 3: { pit_method: "P" }, 7: { pit_method: "F", employment_type: "C" }, 8: { pit_method: "N", tax_code: "0100000008" } };
const info = { 1: { code: "E001", name: "A" }, 2: { code: "E002", name: "B" }, 3: { code: "E003", name: "C" }, 7: { code: "E007", name: "D" }, 8: { code: "E008", name: "F" } };
const rows = RD.sourceRows(srcBatches, srcLines, profiles, info);

describe("htkkQuarterSheet", () => {
	const report = RD.pitQuarterReport(rows, 2025, 1);

	test("giữ nguyên mã, thứ tự và số của tờ khai; phân loại số người / số tiền", () => {
		const s = RX.htkkQuarterSheet(report, { taxpayer: { name: " Công ty A ", taxId: "0312345678" }, releasedOnly: true });
		expect(s).toMatchObject({ form: "05/KK-TNCN", basis: "ACUMATICA", year: 2025, quarter: 1, taxpayer: { name: "Công ty A", taxId: "0312345678" }, releasedOnly: true });
		expect(s.rows.map((r) => r.code)).toEqual(report.indicators.map((i) => i.code));
		expect(s.rows.map((r) => r.value)).toEqual(report.indicators.map((i) => i.value));
		expect(s.rows.filter((r) => r.kind === "count").map((r) => r.code)).toEqual(["[16]", "[17]", "[18]", "[19]", "[20]"]);
		expect(s.rows.find((r) => r.code === "[29]")).toMatchObject({ kind: "money", value: 11647090, computed: true });
		expect(s.columns.map((c) => c.key)).toEqual(["code", "name", "value"]);
	});

	test("ghi chú: chỉ tiêu gói chưa tính, thiếu mã số thuế, gồm bảng chưa ghi sổ, không có số liệu", () => {
		const s = RX.htkkQuarterSheet(report, {});
		expect(s.rows.filter((r) => !r.computed).map((r) => r.code)).toEqual(["[24]", "[25]", "[32]"]);
		expect(s.notes).toEqual(["UNRELEASED_INCLUDED", "NO_TAX_ID", "NOT_COMPUTED"]);
		expect(RX.htkkQuarterSheet(report, { taxpayer: { taxId: "1" }, releasedOnly: true }).notes).toEqual(["NOT_COMPUTED"]);
		expect(RX.htkkQuarterSheet(RD.pitQuarterReport([], 2025, 4), { taxpayer: { taxId: "1" }, releasedOnly: true }).notes).toEqual(["NOT_COMPUTED", "NO_DATA"]);
		expect(RX.htkkQuarterSheet(null).rows).toEqual([]);
	});
});

describe("htkkAnnualTables", () => {
	const t = RX.htkkAnnualTables(RD.pitAnnualReport(rows, 2025, ""), { taxpayer: { name: "A", taxId: "" }, releasedOnly: false });

	test("tách hai bảng kê, đánh số thứ tự lại, tổng từng bảng", () => {
		expect(t).toMatchObject({ form: "05/QTT-TNCN", basis: "ACUMATICA", year: 2025 });
		expect(t.tables.map((x) => x.schedule)).toEqual(["05-1/BK", "05-2/BK"]);
		expect(t.tables[0].rows.map((r) => [r.stt, r.employeeCode])).toEqual([[1, "E001"], [2, "E002"], [3, "E003"]]);
		expect(t.tables[1].rows.map((r) => [r.stt, r.employeeCode, r.residentText])).toEqual([[1, "E007", "x"], [2, "E008", ""]]);
		expect(t.tables[0].totals).toMatchObject({ taxableIncome: 105520000, pit: 79090, familyDeduction: 22000000 });
		expect(t.tables[1].totals).toMatchObject({ taxableIncome: 65680000, pit: 11568000 });
		expect(t.summary).toEqual({ people: 5, taxableIncome: 171200000, pit: 11647090 });
	});

	test("tóm tắt từng bảng và ghi chú thiếu mã số thuế", () => {
		expect(t.tables[0].summary).toMatchObject({ people: 3, withheld: 1, nonResident: 0, noTaxCode: 1, noId: 2 });
		expect(t.tables[1].summary).toMatchObject({ people: 2, withheld: 2, nonResident: 1, noTaxCode: 1 });
		expect(t.notes).toEqual(["UNRELEASED_INCLUDED", "NO_TAX_ID", "NO_TAX_CODE"]);
	});

	test("cột theo gói Acumatica: không mang mã chỉ tiêu pháp lý", () => {
		const cols = t.tables[0].columns;
		expect(cols.map((c) => c.key)).toEqual(["stt", "employeeCode", "employeeName", "taxCode", "idNumber", "residentText", "periods", "taxableIncome", "withholdingIncome", "dependentCount", "familyDeduction", "insurance", "otherDeductions", "assessableIncome", "pit"]);
		for (const c of cols) expect(`${c.vi} ${c.en}`).not.toMatch(/\[\d+\]/);
	});

	test("không có dòng nào", () => {
		const e = RX.htkkAnnualTables(RD.pitAnnualReport([], 2030, ""), { taxpayer: { taxId: "1" }, releasedOnly: true });
		expect(e.tables.map((x) => x.rows.length)).toEqual([0, 0]);
		expect(e.notes).toEqual(["NO_DATA"]);
	});
});

describe("fundSummary", () => {
	const groups = [
		{ department: "20", employmentType: "E", headcount: 3, gross: 90000000, eeIns: 9450000, erIns: 19350000, pit: 3000000, otherDed: 500000, advance: 1000000, net: 76050000, accrued13: 7500000 },
		{ department: "10", employmentType: "E", headcount: 2, gross: 40000000, eeIns: 4200000, erIns: 8600000, pit: 0, otherDed: 0, advance: 0, net: 35800000, accrued13: 0 },
		{ department: "10", employmentType: "C", headcount: 1, gross: 15000000, eeIns: 0, erIns: 0, pit: 1500000, otherDed: 0, advance: 0, net: 13500000, accrued13: 0 },
		{ department: "", employmentType: "e", headcount: 1, gross: 5000000, eeIns: 0, erIns: 0, pit: 0, otherDed: 0, advance: 0, net: 5000000, accrued13: 0 },
		// cùng nhóm ở lô truy vấn khác: cộng dồn
		{ department: "20", employmentType: "E", headcount: 1, gross: 10000000, eeIns: 0, erIns: 0, pit: 0, otherDed: 0, advance: 0, net: 10000000, accrued13: 0 },
	];
	const f = RX.fundSummary(groups, { departments: { 10: "Kế toán", 20: "Sản xuất" }, headcount: 7 });

	test("gom nhóm, sắp theo tên phòng ban, nhân viên trước cộng tác viên, phòng ban trống xếp cuối", () => {
		expect(f.rows.map((r) => [r.departmentName, r.employmentType, r.headcount])).toEqual([["Kế toán", "E", 2], ["Kế toán", "C", 1], ["Sản xuất", "E", 4], ["", "E", 1]]);
	});

	test("tổng quỹ lương = thu nhập + phần doanh nghiệp đóng + trích tháng 13; bình quân, tỷ trọng", () => {
		const sx = f.rows.find((r) => r.departmentName === "Sản xuất");
		expect(sx).toMatchObject({ gross: 100000000, erIns: 19350000, accrued13: 7500000, cost: 126850000, avgGross: 25000000, net: 86050000 });
		expect(f.totals).toMatchObject({ headcount: 7, gross: 160000000, erIns: 27950000, accrued13: 7500000, cost: 195450000, net: 140350000, pit: 4500000, share: 1 });
		expect(f.totals.avgGross).toBe(22857143);
		expect(sx.share).toBeCloseTo(0.649, 4);
		expect(f.rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 3);
	});

	test("theo loại lao động và cảnh báo thiếu phòng ban", () => {
		expect(f.byType).toEqual([{ employmentType: "E", headcount: 7, gross: 145000000, net: 126850000, cost: 180450000 }, { employmentType: "C", headcount: 1, gross: 15000000, net: 13500000, cost: 15000000 }]);
		expect(f.warnings).toEqual([expect.objectContaining({ code: "NO_DEPARTMENT", count: 1 })]);
	});

	test("thiếu số người không trùng thì cộng các dòng; không có dữ liệu thì bảng rỗng", () => {
		expect(RX.fundSummary(groups, {}).totals.headcount).toBe(8);
		const e = RX.fundSummary([], {});
		expect(e.rows).toEqual([]);
		expect(e.totals).toMatchObject({ headcount: 0, gross: 0, cost: 0, avgGross: null, share: null });
		expect(e.warnings).toEqual([]);
	});

	test("cột số căn theo kiểu", () => {
		expect(f.columns.filter((c) => c.type === "text").map((c) => c.key)).toEqual(["departmentName", "employmentType"]);
		expect(f.columns.find((c) => c.key === "share").type).toBe("pct");
	});
});

describe("pitLedger", () => {
	const batches = { 1: { taxMonth: "202701" }, 2: { taxMonth: "202702" }, 3: { taxMonth: "202702" }, 9: { taxMonth: "202612" }, 10: { taxMonth: "" } };
	const lines = [
		{ employee: "101", batch: "1", taxable: 20000000, pit: 500000 }, { employee: "101", batch: "2", taxable: 12000000, pit: 300000 }, { employee: "101", batch: "3", taxable: 8000000, pit: 250000 },
		{ employee: "102", batch: "1", taxable: 9000000, pit: 0 }, { employee: "102", batch: "2", taxable: 9000000, pit: 0 },
		{ employee: "103", batch: "2", taxable: 15000000, pit: 1500000, employment_type: "C" },
		{ employee: "104", batch: "1", taxable: 0, pit: 0 },
		{ employee: "101", batch: "9", taxable: 99, pit: 99 }, { employee: "101", batch: "10", taxable: 77, pit: 77 }, { employee: "101", batch: "404", taxable: 55, pit: 55 },
	];
	const people = { 101: { code: "E101", name: "An", taxCode: "0101" }, 102: { code: "E102", name: "Bình", taxCode: "" }, 103: { code: "E103", name: "Chi", taxCode: " " } };
	const g = RX.pitLedger(lines, batches, people, 2027);

	test("mỗi người một dòng, cộng các kỳ cùng tháng, bỏ tháng ngoài năm và bảng lương lạ", () => {
		expect(g.rows.map((r) => r.employeeCode)).toEqual(["E101", "E102", "E103"]);
		expect(g.rows[0]).toMatchObject({ pit01: 500000, pit02: 550000, pit03: null, pitTotal: 1050000, taxable01: 20000000, taxable02: 20000000, taxableTotal: 40000000, periods: 3, employmentType: "E" });
		expect(g.rows[1]).toMatchObject({ pit01: 0, pit02: 0, pit12: null, pitTotal: 0, taxableTotal: 18000000 });
		expect(g.rows[2]).toMatchObject({ employmentType: "C", pit02: 1500000 });
	});

	test("dòng tổng, tháng có số liệu, tóm tắt", () => {
		expect(g.totals).toMatchObject({ pit01: 500000, pit02: 2050000, pit03: 0, pitTotal: 2550000, taxable02: 44000000, taxableTotal: 73000000 });
		expect(g.months).toEqual([1, 2]);
		expect(g.summary).toEqual({ people: 3, withheld: 2, pit: 2550000, taxableIncome: 73000000 });
		expect(g.year).toBe(2027);
	});

	test("cột: 4 cột đầu, 12 tháng, tổng năm", () => {
		expect(g.columns).toHaveLength(18);
		expect(g.columns.slice(4, 16).map((c) => c.key)).toEqual(["pit01", "pit02", "pit03", "pit04", "pit05", "pit06", "pit07", "pit08", "pit09", "pit10", "pit11", "pit12"]);
		expect(g.taxableColumns.slice(4, 16).map((c) => c.key)[11]).toBe("taxable12");
		expect(g.columns.slice(16).map((c) => c.key)).toEqual(["pitTotal", "taxableTotal"]);
	});

	test("cảnh báo: đã khấu trừ nhưng thiếu mã số thuế, tháng âm", () => {
		expect(g.warnings).toEqual([expect.objectContaining({ code: "NO_TAX_CODE", count: 1 })]);
		const n = RX.pitLedger([{ employee: "101", batch: "1", taxable: 1000, pit: -200 }, { employee: "101", batch: "2", taxable: 1000, pit: 500 }], batches, people, 2027);
		expect(n.warnings.map((w) => w.code)).toEqual(["NEGATIVE_PIT"]);
		expect(RX.pitLedger([], {}, {}, 2027)).toMatchObject({ rows: [], months: [], warnings: [], totals: { pitTotal: 0 } });
	});
});
