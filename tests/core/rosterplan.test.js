// Phân ca từ mẫu xoay ca, giữ ô sửa tay, lượt chấm (đặc tả 3.3), ô bảng công ký hiệu (3.2).
const { core } = require("./helpers");
const Plan = core("RosterPlan");

describe("RosterPlan", () => {
	const members = [
		{ employee: "1", effectiveDate: "2026-01-01" },
		{ employee: "2", effectiveDate: "2026-10-05" },
		{ employee: "3", effectiveDate: "2026-01-01", expirationDate: "2026-10-02" },
	];

	test("Thành viên hiệu lực theo ngày (BUG-35)", () => {
		expect(Plan.membersOn(members, "2026-10-01").map((m) => m.employee).sort()).toEqual(["1", "3"]);
		expect(Plan.membersOn(members, "2026-10-05").map((m) => m.employee).sort()).toEqual(["1", "2"]);
		expect(Plan.anyMember([], "2026-10-01", "2026-10-31")).toBe(false);
	});

	test("Sinh ô từ mẫu 3 ca 4 kíp, chỉ ngày còn hiệu lực", () => {
		const cells = Plan.generate({ cycle: ["C1", "C1", "C2", "C2", "C3", "C3", "", ""], anchor: "2026-10-01", from: "2026-10-01", to: "2026-10-06", members, location: "23" });
		const e1 = cells.filter((c) => c.employee === "1").map((c) => c.shiftCode);
		expect(e1).toEqual(["C1", "C1", "C2", "C2", "C3", "C3"]);
		expect(cells.filter((c) => c.employee === "2").map((c) => c.workDate)).toEqual(["2026-10-05", "2026-10-06"]);
		expect(cells.filter((c) => c.employee === "3").map((c) => c.workDate)).toEqual(["2026-10-01", "2026-10-02"]);
		expect(cells[0].location).toBe("23");
	});

	test("Giữ ô sửa tay, ghi đè ô từ mẫu, tạo ô mới", () => {
		const existing = [
			{ id: "a", employee: "1", workDate: "2026-10-01", shiftCode: "HC", source: "M" },
			{ id: "b", employee: "1", workDate: "2026-10-02", shiftCode: "C2", source: "G" },
			{ id: "c", employee: "1", workDate: "2026-10-03", shiftCode: "C2", source: "G" },
		];
		const gen = [
			{ employee: "1", workDate: "2026-10-01", shiftCode: "C1" },
			{ employee: "1", workDate: "2026-10-02", shiftCode: "C1" },
			{ employee: "1", workDate: "2026-10-03", shiftCode: "C2" },
			{ employee: "1", workDate: "2026-10-04", shiftCode: null },
		];
		const p = Plan.plan(existing, gen);
		expect(p.kept).toBe(1);
		expect(p.updates.map((u) => u.id)).toEqual(["b"]);
		expect(p.unchanged).toBe(1);
		expect(p.creates.map((c) => c.workDate)).toEqual(["2026-10-04"]);
	});

	test("Chuẩn hóa lượt chấm", () => {
		expect(Plan.parsePunch({ employee: "E1", time: "2026-10-05 7:55" })).toMatchObject({ date: "2026-10-05", time: "2026-10-05 07:55" });
		expect(Plan.parsePunch({ employee: "E1", time: "05/10/2026 17:05:30" })).toMatchObject({ date: "2026-10-05", time: "2026-10-05 17:05" });
		expect(Plan.parsePunch({ employee: "E1", time: "2026-02-30 08:00" }).error).toBeTruthy();
		expect(Plan.parsePunch({ employee: "", time: "2026-10-05 08:00" }).error).toBeTruthy();
	});

	test("Ô bảng công D01..D31", () => {
		expect(Plan.cellKey(1)).toBe("d01");
		const cells = Plan.sheetCells({ d01: " X ", d31: "P" });
		expect(cells).toHaveLength(31);
		expect(cells[0]).toBe("X");
		expect(cells[30]).toBe("P");
	});
});
