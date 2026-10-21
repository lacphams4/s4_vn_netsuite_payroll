// Phiếu sản lượng: định giá dòng, thành viên tổ hiệu lực, chia tổ (TC-TS-01 / TC-KH-01, đặc tả 4.8.3).
const { core } = require("./helpers");
const Rules = core("OutputRules");
const Entries = core("OutputEntries");

const table = {
	type: "W", allowOverride: false,
	lines: [
		{ itemCode: "BETONG", rate: 800000, effectiveDate: "2026-01-01" },
		{ itemCode: "BETONG", rate: 850000, effectiveDate: "2026-07-01" },
		{ itemCode: "TUONG", rate: 125000, effectiveDate: "2026-01-01" },
		{ itemCode: "TUONG", rate: 140000, effectiveDate: "2026-01-01", project: "P9" },
	],
};

describe("OutputRules", () => {
	test("TC-TS-01: nghiệm thu tổ nề, chia ngày công x hệ số", () => {
		const lines = [{ item: "BETONG", qty: 12.5 }, { item: "TUONG", qty: 48 }].map((l) => Object.assign(l, Rules.priceLine(l, table, "2026-10-20", "")));
		expect(lines.map((l) => l.amount)).toEqual([10625000, 6000000]);
		const total = Rules.totals(lines, []).total;
		expect(total).toBe(16625000);
		const members = [{ employee: "A", workDays: 6, splitFactor: 1.2 }, { employee: "B", workDays: 6, splitFactor: 1 }, { employee: "C", workDays: 5, splitFactor: 1 }];
		const parts = Rules.split(total, members, "F");
		expect(parts).toEqual([6576923, 5480769, 4567308]);
		members.forEach((m, i) => (m.amount = parts[i]));
		expect(Rules.totals(lines, members).splitTotal).toBe(16625000);
		const entry = { entryType: "T", status: "A", rateTable: "KHOAN-XD", rateTableType: "W", lines, members };
		expect(Entries.validate(entry)).toEqual([]);
		const c = Entries.collect([entry]);
		expect(c.outputAmounts.A["KHOAN-XD"].toNumber()).toBe(6576923);
	});

	test("Đơn giá theo ngày, dự án, sửa tay chỉ khi bảng cho phép", () => {
		expect(Rules.priceLine({ item: "BETONG", qty: 1 }, table, "2026-06-30", "").rate).toBe(800000);
		expect(Rules.priceLine({ item: "TUONG", qty: 1 }, table, "2026-10-01", "P9").rate).toBe(140000);
		expect(Rules.priceLine({ item: "TUONG", qty: 1, rate: 1 }, table, "2026-10-01", "").rate).toBe(125000);
		expect(Rules.priceLine({ item: "TUONG", qty: 1, rate: 1 }, Object.assign({}, table, { allowOverride: true }), "2026-10-01", "").rate).toBe(1);
		const miss = Rules.priceLine({ item: "XYZ", qty: 2 }, table, "2026-10-01", "");
		expect(miss.amount).toBe(0);
		expect(miss.warning.code).toBe("RATE_MISSING");
		expect(Rules.priceLine({ qty: 350000000 }, { type: "S", lines: [] }, "2026-10-01", "")).toMatchObject({ item: "TIER", rate: 1, amount: 350000000 });
	});

	test("Thành viên tổ hiệu lực tại ngày", () => {
		const m = Rules.membersAt([
			{ employee: "A", effectiveDate: "2026-01-01", splitFactor: 1 },
			{ employee: "B", effectiveDate: "2026-01-01", expirationDate: "2026-09-30" },
			{ employee: "A", effectiveDate: "2026-10-01", splitFactor: 1.2 },
			{ employee: "C", effectiveDate: "2026-11-01" },
		], "2026-10-31");
		expect(m.map((x) => [x.employee, x.splitFactor])).toEqual([["A", 1.2]]);
	});

	test("Trạng thái phiếu", () => {
		expect(Rules.nextStatus("H", "submit")).toBe("P");
		expect(Rules.nextStatus("P", "approve")).toBe("A");
		expect(Rules.nextStatus("A", "hold")).toBe("H");
		expect(Rules.nextStatus("C", "hold")).toBeNull();
		expect(Rules.nextStatus("H", "approve")).toBeNull();
	});
});
