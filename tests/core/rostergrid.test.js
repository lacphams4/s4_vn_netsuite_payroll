// Phần thuần của màn Xếp ca (core/RosterGrid): khoảng ngày, cột ngày, chuẩn hóa ô, kỳ khóa theo nhóm lương, đếm theo ca.
const { core } = require("./helpers");
const Grid = core("RosterGrid");

describe("RosterGrid", () => {
	test("Khoảng ngày: hợp lệ, ngược, quá dài", () => {
		expect(Grid.range("2026-12-01", "2026-12-14")).toEqual({ from: "2026-12-01", to: "2026-12-14", count: 14 });
		expect(() => Grid.range("2026-12-14", "2026-12-01")).toThrow(/Invalid date range/);
		expect(() => Grid.range("", "2026-12-01")).toThrow(/Invalid date range/);
		expect(() => Grid.range("2026-12-01", "2027-03-01")).toThrow(/62 days/);
	});

	test("Cột ngày: thứ và loại ngày (lễ > nghỉ tuần > thường)", () => {
		const days = Grid.days("2026-12-04", "2026-12-07", "0,6", ["2026-12-07"]);
		expect(days.map((d) => d.date)).toEqual(["2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07"]);
		expect(days.map((d) => d.dow)).toEqual([5, 6, 0, 1]);
		expect(days.map((d) => d.type)).toEqual(["N", "W", "W", "H"]);
	});

	test("Chuẩn hóa ô: ô sau cùng thắng, ca trống là nghỉ, kiểm đầu vào", () => {
		const cells = Grid.normalizeCells([
			{ employee: "11", workDate: "2026-12-01", shift: "5" },
			{ employee: 11, workDate: "2026-12-01", shift: "" },
			{ employee: "12", workDate: "2026-12-02", shift: 6 },
		]);
		expect(cells).toEqual([
			{ employee: "11", workDate: "2026-12-01", shift: "" },
			{ employee: "12", workDate: "2026-12-02", shift: "6" },
		]);
		expect(() => Grid.normalizeCells([])).toThrow(/No roster cell/);
		expect(() => Grid.normalizeCells([{ employee: "", workDate: "2026-12-01" }])).toThrow(/employee is missing/);
		expect(() => Grid.normalizeCells([{ employee: "1", workDate: "x" }])).toThrow(/Invalid date/);
		expect(() => Grid.normalizeCells([{ employee: "1", workDate: "2026-12-01", shift: "C1" }])).toThrow(/invalid shift/);
	});

	test("Giới hạn số ô mỗi lần lưu", () => {
		const many = [];
		for (let i = 0; i < Grid.MAX_CELLS + 1; i++) many.push({ employee: String(1000 + i), workDate: "2026-12-01", shift: "5" });
		expect(() => Grid.normalizeCells(many)).toThrow(/At most 200 cells/);
	});

	test("Kỳ công khóa: cắt theo khoảng, lọc theo nhóm lương", () => {
		const periods = [
			{ code: "202611", group: "DEFAULT", startDate: "2026-11-01", endDate: "2026-11-30", attendanceStatus: "L" },
			{ code: "202612", group: "DEFAULT", startDate: "2026-12-01", endDate: "2026-12-31", attendanceStatus: "O" },
			{ code: "SM-202612", group: "SAOMAI", startDate: "2026-12-01", endDate: "2026-12-31", attendanceStatus: "L" },
		];
		const locks = Grid.lockedRanges(periods, "2026-11-25", "2026-12-05");
		expect(locks).toEqual([
			{ group: "DEFAULT", code: "202611", from: "2026-11-25", to: "2026-11-30" },
			{ group: "SAOMAI", code: "SM-202612", from: "2026-12-01", to: "2026-12-05" },
		]);
		expect(Grid.isLocked(locks, "DEFAULT", "2026-11-26")).toBe(true);
		expect(Grid.isLocked(locks, "DEFAULT", "2026-12-02")).toBe(false);
		expect(Grid.isLocked(locks, "SAOMAI", "2026-12-02")).toBe(true);
		// Tài khoản một nhóm lương: không lọc nhóm
		expect(Grid.isLocked(locks, "", "2026-12-02")).toBe(true);
	});

	test("Nén ô và đếm người theo ca từng ngày", () => {
		const cells = Grid.packCells(
			[
				{ employee: "11", workDate: "2026-12-01", shift: "5", source: "G" },
				{ employee: "11", workDate: "2026-12-02", shift: "", source: "M" },
				{ employee: "12", workDate: "2026-12-01", shift: "5", source: "M" },
				{ employee: "12", workDate: "2026-12-03", shift: "6", source: "G" },
			],
			"2026-12-01"
		);
		expect(cells).toEqual({ 11: [[0, "5", "G"], [1, "", "M"]], 12: [[0, "5", "M"], [2, "6", "G"]] });
		expect(Grid.counts(cells, 3)).toEqual({ 5: [2, 0, 0], 6: [0, 0, 1] });
	});
});
