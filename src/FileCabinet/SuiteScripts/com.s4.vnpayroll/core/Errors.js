/**
 * Mã lỗi và cảnh báo của lõi (đặc tả mục 2.11), giữ đúng mã của S4.VP.Core để đối chiếu hai hệ thống.
 *
 * Lỗi dừng tính cho một nhân viên; cảnh báo không dừng. Thông báo gốc tiếng Anh như Acumatica, kèm bản tiếng Việt
 * để giao diện chọn theo ngôn ngữ người dùng.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
	const Codes = {
		PARAM_MISSING: "VP-PARAM-MISSING",
		BELOW_MINWAGE: "VP-INS-BELOW-MINWAGE",
		UNKNOWN_REGION: "VP-INS-UNKNOWN-REGION",
		INVALID_INPUT: "VP-INVALID-INPUT",
	};

	class PayrollError extends Error {
		/**
		 * @param {string} code mã lỗi (Codes)
		 * @param {string} message thông báo tiếng Anh
		 * @param {string} [messageVi] thông báo tiếng Việt
		 */
		constructor(code, message, messageVi) {
			super(message);
			this.name = "PayrollError";
			this.code = code;
			this.messageVi = messageVi || message;
		}
	}

	function invalid(message, messageVi) {
		return new PayrollError(Codes.INVALID_INPUT, message, messageVi);
	}

	/** Mã cảnh báo (không dừng tính). */
	const Warnings = {
		ABSENCE_NO_INSURANCE: "AbsenceNoInsurance",
		NEGATIVE_NET_PAY: "NegativeNetPay",
		ADVANCE_CARRY_FORWARD: "AdvanceCarryForward",
		OVERTIME_LIMIT: "OvertimeLimit",
		WORK_PERMIT: "WorkPermit",
		LEAVE_PAYOUT_TYPE_MISSING: "LeavePayoutTypeMissing",
	};

	return { Codes, PayrollError, invalid, Warnings };
});
