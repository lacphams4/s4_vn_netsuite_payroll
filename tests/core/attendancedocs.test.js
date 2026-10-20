// Quy tắc chứng từ công (đặc tả 3.4): luồng trạng thái, số ngày đơn nghỉ, OT, ngoại lệ, công tác.
const { core, Defaults } = require("./helpers");
const R = core("AttendanceDocRules");

const types = Defaults.earningTypes;

describe("AttendanceDocRules", () => {
	test("luồng trạng thái", () => {
		expect(R.nextStatus("H", "submit")).toBe("P");
		expect(R.nextStatus("P", "approve")).toBe("A");
		expect(R.nextStatus("P", "reject")).toBe("R");
		expect(R.nextStatus("A", "cancel")).toBe("C");
		expect(R.nextStatus("H", "approve")).toBeNull();
		expect(R.nextStatus("R", "cancel")).toBeNull();
		expect(R.nextStatus("A", "reject")).toBeNull();
	});

	test("không tự duyệt", () => {
		expect(R.selfApproval("5", 5)).toBe(true);
		expect(R.selfApproval("6", "5")).toBe(false);
		expect(R.selfApproval(null, "5")).toBe(false);
	});

	test("đơn nghỉ: nửa ngày, ToDate trống, loại không cho nửa ngày (3.10 #21)", () => {
		expect(R.normalizeLeave({ from: "2026-10-05", fromHalf: "P", to: "2026-10-07", toHalf: "A" }, { allowHalfDay: true }, "0", []).days).toBe(2);
		expect(R.normalizeLeave({ from: "2026-10-05", fromHalf: "P" }, { allowHalfDay: true }, "0", [])).toMatchObject({ to: "2026-10-05", days: 0.5 });
		expect(R.normalizeLeave({ from: "2026-10-05", fromHalf: "P", to: "2026-10-05" }, { allowHalfDay: false }, "0", []).days).toBe(1);
		expect(() => R.normalizeLeave({ from: "2026-10-05", fromHalf: "P", to: "2026-10-05", toHalf: "A" }, {}, "0", [])).toThrow();
	});

	test("đơn công tác: ngày làm việc cả ngày, trùng đơn khác", () => {
		const t = R.tripDays({ from: "2026-10-09", to: "2026-10-12" }, "0,6", []);
		expect(t.days).toBe(2);
		expect(R.tripErrors({ from: "2026-10-09", to: "2026-10-12" }, 2, [{ fromDate: "2026-10-12", toDate: "2026-10-13", status: "A" }])[0].code).toBe("OVERLAP");
		expect(R.tripErrors({ from: "2026-10-09", to: "2026-10-12" }, 2, [{ fromDate: "2026-10-12", toDate: "2026-10-13", status: "R" }])).toEqual([]);
	});

	test("đơn OT: loại ngày, loại thu nhập mặc định, giới hạn 4/12 giờ", () => {
		const n = R.prepareOvertime({ workDate: "2026-10-14", hours: 3 }, "0", ["2026-09-02"], types, 2, true);
		expect(n).toMatchObject({ dayType: "N", earningType: "OT150" });
		expect(n.errors.map((e) => e.code)).toEqual(["DAILY_LIMIT"]);
		expect(R.prepareOvertime({ workDate: "2026-10-14", hours: 3 }, "0", [], types, 2, false).warnings).toHaveLength(1);
		expect(R.prepareOvertime({ workDate: "2026-10-18", hours: 8, isNight: true }, "0", [], types, 0, true)).toMatchObject({ dayType: "W", earningType: "OTD200", errors: [] });
		expect(R.prepareOvertime({ workDate: "2026-09-02", hours: 12 }, "0", ["2026-09-02"], types, 0, true)).toMatchObject({ dayType: "H", earningType: "OT300", errors: [] });
		expect(R.prepareOvertime({ workDate: "2026-10-14", hours: 0 }, "0", [], types, 0, true).errors[0].code).toBe("HOURS");
	});

	test("phiếu ngoại lệ: quy đổi phút, điều chỉnh công", () => {
		const rules = Defaults.attendanceRules;
		expect(R.prepareException({ exceptionType: "L", minutes: 20, reason: "Kẹt xe" }, rules, true)).toMatchObject({ deductDays: 0.25, errors: [] });
		expect(R.prepareException({ exceptionType: "E", minutes: 241, reason: "x" }, rules, true).deductDays).toBe(1);
		expect(R.prepareException({ exceptionType: "A", adjustDays: -1, reason: "Vắng" }, rules, true)).toMatchObject({ adjustDays: -1, deductDays: 0, errors: [] });
		expect(R.prepareException({ exceptionType: "A", adjustDays: 1.5, reason: "x" }, rules, true).errors[0].code).toBe("ADJUST");
		expect(R.prepareException({ exceptionType: "L", minutes: 10 }, rules, true).errors[0].code).toBe("REASON");
	});

	test("kỳ chứa ngày", () => {
		const periods = [{ id: "1", startDate: "2026-10-01", endDate: "2026-10-31" }, { id: "2", startDate: "2026-11-01", endDate: "2026-11-30" }];
		expect(R.periodOf("2026-10-31", periods).id).toBe("1");
		expect(R.periodOf("2026-12-01", periods)).toBeNull();
	});
});
