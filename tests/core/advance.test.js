// Ca vàng 2.13.7 TU-01..06 - cấn trừ tạm ứng (AdvanceOffsetCalculator)
const { core } = require("./helpers");
const Adv = core("AdvanceOffsetCalculator");

describe("2.13.7 Cấn trừ tạm ứng", () => {
	test("TU-01", () => {
		const r = Adv.offset(12000000, [{ refNbr: "TU001", date: "2026-10-05", balance: 5000000 }]);
		expect([r.totalOffset, r.remainingBalance, r.hasCarryForward]).toEqual([5000000, 0, false]);
	});

	test("TU-02", () => {
		const r = Adv.offset(12000000, [{ refNbr: "TU001", date: "2026-10-05", balance: 15000000 }]);
		expect([r.totalOffset, r.remainingBalance, r.hasCarryForward]).toEqual([12000000, 3000000, true]);
	});

	test("TU-03 FIFO theo ngày", () => {
		const r = Adv.offset(5000000, [{ refNbr: "TU002", date: "2026-10-10", balance: 4000000 }, { refNbr: "TU001", date: "2026-10-05", balance: 3000000 }]);
		expect(r.lines).toEqual([
			{ refNbr: "TU001", amount: 3000000, remainingBalance: 0 },
			{ refNbr: "TU002", amount: 2000000, remainingBalance: 2000000 },
		]);
	});

	test("TU-04 trần mỗi kỳ", () => {
		const r = Adv.offset(12000000, [{ refNbr: "TU001", date: "2026-10-05", balance: 10000000 }], 4000000);
		expect([r.totalOffset, r.remainingBalance]).toEqual([4000000, 6000000]);
	});

	test("TU-05 thực lĩnh âm", () => {
		const r = Adv.offset(-1000, [{ refNbr: "TU001", date: "2026-10-05", balance: 1000000 }]);
		expect([r.totalOffset, r.remainingBalance, r.hasCarryForward]).toEqual([0, 1000000, true]);
	});

	test("TU-06 phiếu số dư 0 bị bỏ", () => {
		const r = Adv.offset(1000000, [{ refNbr: "TU001", date: "2026-10-01", balance: 0 }, { refNbr: "TU002", date: "2026-10-02", balance: 500000 }]);
		expect(r.lines).toHaveLength(1);
		expect(r.totalOffset).toBe(500000);
	});

	test("Cùng ngày sắp theo số phiếu (ordinal); hết số khả dụng vẫn sinh dòng 0", () => {
		const r = Adv.offset(100, [{ refNbr: "b", date: "2026-10-01", balance: 50 }, { refNbr: "B", date: "2026-10-01", balance: 80 }, { refNbr: "C", date: "2026-10-02", balance: 10 }]);
		expect(r.lines.map((l) => [l.refNbr, l.amount])).toEqual([["B", 80], ["b", 20], ["C", 0]]);
	});
});
