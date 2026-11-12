/**
 * Hàm thuần cho mục Số dư phép (màn chấm công cũ): năm chọn được, dòng lưới đã ghép mã / tên nhân viên và loại nghỉ (để ô lọc
 * nhanh khớp được), hạn của phép chuyển. Cấp phép năm Y kèm chuyển phép còn lại của năm Y-1 (core/LeaveAccrualCalculator:
 * chuyển = min(còn lại năm trước, số ngày chuyển tối đa của chính sách), giao dịch C có hạn); hết hạn tạo giao dịch X.
 */
import {fmtDate} from './format.js';

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** Năm chọn được: năm hiện tại (mặc định) và năm sau (chạy trước để chuyển phép sang năm mới). */
export function leaveYearOptions(today) {
	const y = Number(str(today).slice(0, 4)) || new Date().getFullYear();
	return [String(y), String(y + 1)].map((v) => ({value: v, label: v}));
}

/**
 * Dòng lưới số dư: thêm code, name (nhân viên), leaveTypeCode, leaveTypeName, carryExpiry. Nhân viên không có trong danh
 * sách của công ty con thì giữ id (không đoán tên).
 * @param {Array} balances kết quả action leaveBalances
 * @param {Array<{employee, code, name}>} employees hồ sơ của công ty con
 * @param {Array<{id, code, name}>} leaveTypes boot.leaveTypes
 */
export function balanceRows(balances, employees, leaveTypes) {
	const emp = {};
	(employees || []).forEach((e) => (emp[str(e.employee)] = e));
	const lt = {};
	(leaveTypes || []).forEach((l) => (lt[str(l.id)] = l));
	return (balances || []).map((b) => {
		const e = emp[str(b.employee)] || {};
		const l = lt[str(b.leave_type)] || {};
		return Object.assign({}, b, {
			code: str(e.code),
			name: str(e.name),
			leaveTypeCode: str(b.leaveTypeCode || l.code),
			leaveTypeName: str(l.name),
			carryExpiry: /^\d{4}-\d{2}-\d{2}$/.test(str(b.carry_expiry)) ? str(b.carry_expiry) : '',
		});
	});
}

/** Tooltip của ô Chuyển: chỉ khi có phép chuyển; t.carryTip(hạn) / t.carryTipNoExpiry. */
export function carryTip(row, t) {
	if (!row || !(Number(row.carried) > 0)) return '';
	return row.carryExpiry ? t.carryTip(fmtDate(row.carryExpiry)) : t.carryTipNoExpiry;
}
