// Chế độ ca (core/ShiftAssign): kiểm đầu vào, ưu tiên phạm vi theo ngày, lịch suy ra từ mẫu, diện xếp ca.
const { core } = require("./helpers");
const Assign = core("ShiftAssign");

const patterns = {
	p3: { code: "XOAY3", cycle: ["C1", "C1", "C2", "C2", null] },
	phc: { code: "HC5", cycle: ["HC", "HC", "HC", "HC", "HC", null, null] },
};
const person = (extra) => Object.assign({ employee: "11", subsidiary: "14", department: "40", paygroup: "2", memberships: [] }, extra);

describe("ShiftAssign", () => {
	test("Kiểm đầu vào: phạm vi, đích, mẫu, ngày", () => {
		const ok = Assign.validate({ subsidiary: "14", scope: "t", team: "7", pattern: "9", effective: "01/12/2026", note: " kíp A " });
		expect(ok).toEqual({ subsidiary: "14", scope: "T", employee: null, team: "7", department: null, paygroup: null, pattern: "9", anchor: null, effective: "2026-12-01", expiration: null, note: "kíp A" });
		// Đích của phạm vi khác bị bỏ
		expect(Assign.validate({ subsidiary: "14", scope: "S", team: "7", pattern: "9", effective: "2026-12-01" }).team).toBeNull();
		expect(() => Assign.validate({ subsidiary: "14", pattern: "9", effective: "2026-12-01" })).toThrow(/scope/);
		expect(() => Assign.validate({ subsidiary: "14", scope: "D", pattern: "9", effective: "2026-12-01" })).toThrow(/department/);
		expect(() => Assign.validate({ subsidiary: "14", scope: "S", effective: "2026-12-01" })).toThrow(/shift pattern/);
		expect(() => Assign.validate({ subsidiary: "14", scope: "S", pattern: "9" })).toThrow(/effective date/);
		expect(() => Assign.validate({ subsidiary: "14", scope: "S", pattern: "9", effective: "2026-12-10", expiration: "2026-12-01" })).toThrow(/end date/);
	});

	test("Ưu tiên: nhân viên > tổ > phòng ban > nhóm lương > công ty; cùng mức lấy hiệu lực muộn nhất", () => {
		const list = [
			{ id: "1", scope: "S", subsidiary: "14", patternId: "phc", effective: "2026-01-01" },
			{ id: "2", scope: "G", subsidiary: "14", paygroup: "2", patternId: "phc", effective: "2026-01-01" },
			{ id: "3", scope: "D", subsidiary: "14", department: "40", patternId: "p3", effective: "2026-01-01" },
			{ id: "4", scope: "D", subsidiary: "14", department: "40", patternId: "p3", effective: "2026-12-05" },
			{ id: "5", scope: "T", subsidiary: "14", team: "7", patternId: "p3", effective: "2026-01-01" },
			{ id: "6", scope: "E", subsidiary: "14", employee: "11", patternId: "phc", effective: "2026-12-10", expiration: "2026-12-12" },
			{ id: "7", scope: "E", subsidiary: "14", employee: "99", patternId: "phc", effective: "2026-01-01" },
			{ id: "8", scope: "S", subsidiary: "13", patternId: "phc", effective: "2026-01-01" },
		];
		const p = person({ memberships: [{ team: "7", effectiveDate: "2026-12-08", expirationDate: "2026-12-20" }] });
		expect(Assign.pick(p, "2026-12-01", list).id).toBe("3");
		expect(Assign.pick(p, "2026-12-06", list).id).toBe("4");
		// Vào tổ ngày 08/12: dòng của tổ thắng phòng ban
		expect(Assign.pick(p, "2026-12-09", list).id).toBe("5");
		expect(Assign.pick(p, "2026-12-11", list).id).toBe("6");
		// Rời tổ sau 20/12: về phòng ban
		expect(Assign.pick(p, "2026-12-21", list).id).toBe("4");
		// Người phòng ban khác, nhóm khác: chỉ còn dòng cả công ty con của đúng công ty
		expect(Assign.pick(person({ employee: "12", department: "41", paygroup: "3" }), "2026-12-01", list).id).toBe("1");
		expect(Assign.pick(person({ employee: "12", subsidiary: "15", department: null, paygroup: null }), "2026-12-01", list)).toBeNull();
	});

	test("Lịch theo ngày: chu kỳ tính từ ngày neo, đổi chế độ giữa khoảng, ngày không có chế độ là null", () => {
		const list = [
			{ id: "1", scope: "E", employee: "11", subsidiary: "14", patternId: "p3", anchor: "2026-11-30", effective: "2026-12-01", expiration: "2026-12-04" },
			{ id: "2", scope: "E", employee: "11", subsidiary: "14", patternId: "phc", effective: "2026-12-07" },
		];
		const d = Assign.days(person(), "2026-12-01", "2026-12-08", list, patterns);
		// Neo 30/11 = ngày 1 chu kỳ (C1): 01/12 C1, 02 C2, 03 C2, 04 nghỉ; 05-06 không có chế độ; 07/12 HC (neo = ngày hiệu lực)
		expect(d.map((c) => (c ? c.shiftCode : undefined))).toEqual(["C1", "C2", "C2", null, undefined, undefined, "HC", "HC"]);
		expect(d[0].assign).toBe("1");
		expect(d[6].assign).toBe("2");
		expect(Assign.cells(person(), "2026-12-04", "2026-12-07", list, patterns)).toEqual([
			{ employee: "11", workDate: "2026-12-04", shiftCode: null, assign: "1" },
			{ employee: "11", workDate: "2026-12-07", shiftCode: "HC", assign: "2" },
		]);
		// Mẫu không còn: coi như không có chế độ
		expect(Assign.days(person(), "2026-12-01", "2026-12-02", [{ id: "9", scope: "S", subsidiary: "14", patternId: "gone", effective: "2026-01-01" }], patterns)).toEqual([null, null]);
	});

	test("Diện xếp ca và chữ ký dãy ngày", () => {
		const list = [{ id: "5", scope: "T", subsidiary: "14", team: "7", patternId: "p3", effective: "2026-01-01" }];
		expect(Assign.eligible(person(), "2026-12-01", "2026-12-31", list)).toBe(false);
		expect(Assign.eligible(person({ memberships: [{ team: "7", effectiveDate: "2026-12-20" }] }), "2026-12-01", "2026-12-31", list)).toBe(true);
		expect(Assign.eligible(person({ memberships: [{ team: "7", effectiveDate: "2027-01-05" }] }), "2026-12-01", "2026-12-31", list)).toBe(false);
		const a = Assign.days(person({ memberships: [{ team: "7" }] }), "2026-12-01", "2026-12-03", list, patterns);
		const b = Assign.days(person({ employee: "12", memberships: [{ team: "7" }] }), "2026-12-01", "2026-12-03", list, patterns);
		expect(Assign.signature(a)).toBe(Assign.signature(b));
		expect(Assign.signature([null, { shiftCode: null, assign: "5" }])).toBe(",-@5");
	});
});
