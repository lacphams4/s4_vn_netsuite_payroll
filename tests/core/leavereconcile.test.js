// Đối soát số dư phép với giao dịch (QC lượt 2 #9): chạy lại cấp phép sau lỗi giữa chừng không mất ngày phép
const { core } = require("./helpers");
const R = core("LeaveReconcile");

describe("LeaveReconcile", () => {
	test("giao dịch cấp đã ghi nhưng số dư chưa cập nhật -> đưa Entitled về tổng giao dịch", () => {
		const r = R.reconcile({ entitled: 0, carriedOver: 0 }, [{ source: "A", qty: 12 }]);
		expect(r).toEqual({ entitled: 12, carriedOver: 0, changed: true });
	});

	test("chuyển phép và hết hạn cộng vào CarriedOver; giao dịch R, J không ảnh hưởng", () => {
		const r = R.reconcile({ entitled: 12, carriedOver: 5 }, [
			{ source: "A", qty: 12 }, { source: "C", qty: 5 }, { source: "X", qty: -2 }, { source: "R", qty: -3 }, { source: "J", qty: 1 },
		]);
		expect(r).toEqual({ entitled: 12, carriedOver: 3, changed: true });
	});

	test("khớp thì không đổi; số lẻ nửa ngày", () => {
		expect(R.reconcile({ entitled: 6.5, carriedOver: 0 }, [{ source: "A", qty: 5.5 }, { source: "A", qty: 1 }]).changed).toBe(false);
		expect(R.reconcile({ entitled: 0, carriedOver: 0 }, []).changed).toBe(false);
	});
});
