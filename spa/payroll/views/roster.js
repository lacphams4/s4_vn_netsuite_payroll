/**
 * Xếp ca (lưới lịch ca nhân viên x ngày) của công ty con đang chọn. Dữ liệu: GET rosterView (api/RosterView.js).
 * Tham số route: from (yyyy-mm-dd), days (7 | 14 | 31), team.
 *
 * Mô hình (học cách của SAP, UKG): lịch ca = CHẾ ĐỘ CA (một mẫu xoay ca gán cho nhân viên / tổ / phòng ban / nhóm lương / cả công
 * ty con theo hiệu lực) + ô ngoại lệ sửa tay. Xếp ca cho hàng nghìn người là khai vài dòng chế độ ca (nút Chế độ ca); lưới chỉ để
 * xem và sửa ngoại lệ. Nhân viên không có chế độ ca và không có ô nào = không thuộc diện xếp ca, mặc định ẩn.
 *
 * Thao tác:
 * - Chọn một ca (hoặc "Nghỉ", "Theo chế độ ca") ở dải ca như chọn cây bút rồi bấm ô; giữ Shift bấm ô thứ hai cùng dòng để tô đoạn;
 *   bấm tiêu đề ngày để tô cả ngày cho những người đang chọn. Ô đã đổi viền cam, chỉ ghi khi bấm Lưu (POST rosterCells / rosterReset).
 * - Tích chọn nhiều người (hoặc "Chọn tất cả đang lọc") rồi: xếp một ca cho cả khoảng ngày, gán chế độ ca riêng, trả về chế độ ca.
 * - Ngày thuộc kỳ công đã khóa của nhóm lương của nhân viên không sửa được (máy chủ cũng chặn).
 *
 * Hiệu năng: chỉ vẽ ROW_STEP dòng mỗi lần, một listener DOM trên khung lưới; thao tác hàng loạt gửi theo lô.
 * CSS riêng chèn bằng thẻ <style id="s4vp-css-ros"> (không sửa ui/css.js).
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post} from '../lib/api.js';
import {fmtDate, fold, localToday} from '../lib/format.js';
import {pick} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Chips, SearchBox, Field, DateInput, TextInput, Select, AutoSelect, Dialog, Table, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		crumb: 'Chấm công',
		title: 'Xếp ca',
		sub: 'Lịch ca = chế độ ca (mẫu xoay ca gán cho tổ, phòng ban, nhóm...) cộng các ô sửa tay. Khai chế độ ca một lần cho cả nhóm; lưới này để xem và sửa ngoại lệ.',
		loading: 'Đang tải lịch ca...',
		saving: 'Đang lưu...',
		noSubsidiary: 'Chọn công ty con ở góc trên để xem lịch ca.',
		noData: 'Chưa tải được lịch ca. Kiểm tra thông báo phía trên rồi bấm Tải lại.',
		reload: 'Tải lại',
		schemes: 'Chế độ ca',
		save: (n) => `Lưu ${n} ô`,
		discard: 'Bỏ thay đổi',
		prev: 'Trước',
		next: 'Sau',
		today: 'Tuần này',
		from: 'Từ ngày',
		span: 'Số ngày',
		spans: {7: '1 tuần', 14: '2 tuần', 31: '31 ngày'},
		team: 'Tổ',
		allTeams: 'Mọi tổ',
		dept: 'Phòng ban',
		allDepts: 'Mọi phòng ban',
		search: 'Tìm mã, tên, phòng ban, tổ, mẫu',
		scopeEligible: 'Diện xếp ca',
		scopeAll: 'Tất cả',
		scopeLabel: 'Phạm vi nhân viên',
		brush: 'Ca để xếp',
		brushNone: 'Chọn ca rồi bấm ô (giữ Shift để tô đoạn; bấm tiêu đề ngày để tô cho người đang chọn). Ô viền cam là thay đổi chưa lưu.',
		brushOn: (name) => `Đang xếp: ${name}.`,
		off: 'Nghỉ',
		offLong: 'Ngày nghỉ (không ca)',
		byScheme: 'Theo chế độ ca',
		bySchemeLong: 'Bỏ ô sửa tay, trở về lịch của chế độ ca',
		employee: 'Nhân viên',
		showMore: (n) => `Hiện thêm ${n} người`,
		shown: (a, b) => `Đang hiện ${a} / ${b} người`,
		empty: 'Không có nhân viên nào đang làm việc trong khoảng ngày này.',
		emptyEligible: 'Chưa có nhân viên nào thuộc diện xếp ca. Bấm Chế độ ca để gán mẫu xoay ca cho tổ, phòng ban hoặc nhóm; hoặc chọn Tất cả để xếp tay.',
		noMatch: 'Không có nhân viên nào khớp bộ lọc.',
		noShifts: 'Chưa khai ca làm việc. Vào Thiết lập, mục Ca làm việc để khai ca trước.',
		headcount: 'Số người theo ca',
		readOnly: 'Vai trò của bạn chỉ được xem lịch ca.',
		locked: (code) => `Kỳ công ${code} đã khóa, không sửa được lịch ca của ngày này.`,
		pickBrush: 'Chọn một ca (hoặc Nghỉ) ở dải ca phía trên trước khi bấm ô.',
		pickPeople: 'Tích chọn nhân viên trước khi bấm tiêu đề ngày.',
		saved: (r) => `Đã lưu: ${r.created} ô mới, ${r.updated} ô sửa${r.reset ? `, ${r.reset} ô trở về chế độ ca` : ''}.`,
		confirmDiscard: (n) => `Có ${n} ô đã đổi nhưng chưa lưu. Bỏ các thay đổi này?`,
		cellTitle: (name, day, shift) => `${name} - ${day}: ${shift}`,
		manual: 'sửa tay',
		pending: 'chưa lưu',
		fromScheme: 'theo chế độ ca',
		noCell: 'chưa xếp',
		dayTypes: {W: 'nghỉ hằng tuần', H: 'ngày lễ'},
		dow: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
		summary: (people, eligible) => `${eligible} / ${people} người thuộc diện xếp ca`,
		sel: {
			count: (n) => `Đã chọn ${n} người`,
			all: (n) => `Chọn tất cả ${n} người đang lọc`,
			none: 'Bỏ chọn',
			range: 'Xếp ca theo khoảng ngày',
			assign: 'Gán chế độ ca riêng',
			reset: 'Trả về chế độ ca',
		},
		rng: {
			title: (n) => `Xếp ca theo khoảng ngày cho ${n} người`,
			shift: 'Ca',
			pickShift: 'Chọn ca hoặc Nghỉ',
			from: 'Từ ngày',
			to: 'Đến ngày',
			weekdays: 'Chỉ các thứ',
			note: (cells) => `Sẽ ghi ${cells} ô sửa tay. Ngày thuộc kỳ công đã khóa được bỏ qua. Với thay đổi lâu dài, nên dùng Gán chế độ ca.`,
			tooMany: (max) => `Quá ${max} ô mỗi lần. Thu hẹp khoảng ngày hoặc số người, hoặc dùng Gán chế độ ca.`,
			run: 'Xếp ca',
			done: (r, skipped) => `Đã xếp ca: ${r.created} ô mới, ${r.updated} ô sửa${r.unchanged ? `, ${r.unchanged} ô không đổi` : ''}${skipped ? `, bỏ qua ${skipped} ô thuộc kỳ đã khóa` : ''}.`,
		},
		asg: {
			title: (n) => `Gán chế độ ca riêng cho ${n} người`,
			note: 'Mỗi người nhận một dòng chế độ ca riêng, ưu tiên hơn chế độ ca của tổ, phòng ban. Dòng riêng cũ được đóng ở ngày trước ngày hiệu lực mới.',
			run: 'Gán',
			done: (r) => `Đã gán chế độ ca cho ${r.created} người${r.closed ? `, đóng ${r.closed} dòng cũ` : ''}.`,
		},
		rst: {
			confirm: (n) => `Bỏ ${n} ô sửa tay của những người đang chọn trong khoảng ngày đang xem để trở về lịch của chế độ ca?`,
			none: 'Những người đang chọn không có ô sửa tay nào trong khoảng ngày đang xem.',
			done: (r) => `Đã trả ${r.reset} ô về chế độ ca.`,
		},
		sch: {
			title: 'Chế độ ca',
			intro: 'Mỗi dòng gán một mẫu xoay ca cho một phạm vi. Khi nhiều dòng cùng áp cho một người: nhân viên > tổ > phòng ban > nhóm lương > cả công ty con; cùng mức lấy dòng hiệu lực muộn nhất.',
			add: 'Thêm chế độ ca',
			edit: 'Sửa',
			stop: 'Thôi dùng',
			confirmStop: (name) => `Thôi dùng chế độ ca của ${name}? Lịch ca suy ra từ dòng này sẽ không còn.`,
			empty: 'Chưa có chế độ ca nào. Bấm Thêm chế độ ca.',
			search: 'Tìm phạm vi, mẫu, ghi chú',
			scope: 'Phạm vi',
			scopes: {E: 'Nhân viên', T: 'Tổ', D: 'Phòng ban', G: 'Nhóm lương', S: 'Cả công ty con'},
			target: 'Áp cho',
			pickTarget: 'Chọn...',
			whole: 'Mọi nhân viên của công ty con',
			pattern: 'Mẫu xoay ca',
			pickPattern: 'Chọn mẫu xoay ca',
			cycle: (text, n) => `Chu kỳ ${n} ngày: ${text}`,
			effective: 'Hiệu lực từ',
			expiration: 'Hiệu lực đến',
			expirationHint: 'Để trống = không thời hạn.',
			anchor: 'Ngày ứng với ngày 1 của chu kỳ',
			anchorHint: 'Để trống = ngày hiệu lực. Các kíp lệch nhau bằng cách dời ngày này.',
			note: 'Ghi chú',
			save: 'Lưu',
			cancel: 'Hủy',
			close: 'Đóng',
			newTitle: 'Thêm chế độ ca',
			editTitle: 'Sửa chế độ ca',
			saved: 'Đã lưu chế độ ca.',
			stopped: 'Đã thôi dùng chế độ ca.',
			noPatterns: 'Chưa có mẫu xoay ca. Vào Thiết lập, mục Mẫu xoay ca.',
			cols: {scope: 'Phạm vi', target: 'Áp cho', pattern: 'Mẫu', effective: 'Từ', expiration: 'Đến', anchor: 'Ngày neo', note: 'Ghi chú', act: ''},
		},
	},
	en: {
		crumb: 'Attendance',
		title: 'Shift roster',
		sub: 'The roster = shift schemes (a shift pattern assigned to a team, department, group...) plus manual cells. Define a scheme once for a whole group; this grid is for review and exceptions.',
		loading: 'Loading the roster...',
		saving: 'Saving...',
		noSubsidiary: 'Select a subsidiary at the top to see the roster.',
		noData: 'The roster could not be loaded. Check the message above and click Reload.',
		reload: 'Reload',
		schemes: 'Shift schemes',
		save: (n) => `Save ${n} cells`,
		discard: 'Discard changes',
		prev: 'Previous',
		next: 'Next',
		today: 'This week',
		from: 'From',
		span: 'Days',
		spans: {7: '1 week', 14: '2 weeks', 31: '31 days'},
		team: 'Team',
		allTeams: 'All teams',
		dept: 'Department',
		allDepts: 'All departments',
		search: 'Search code, name, department, team, pattern',
		scopeEligible: 'Rostered',
		scopeAll: 'All',
		scopeLabel: 'Employees shown',
		brush: 'Shift to assign',
		brushNone: 'Pick a shift, then click cells (hold Shift to fill a range; click a day header to fill the selected employees). Orange outlined cells are unsaved.',
		brushOn: (name) => `Assigning: ${name}.`,
		off: 'Off',
		offLong: 'Day off (no shift)',
		byScheme: 'Per scheme',
		bySchemeLong: 'Drop the manual cell and follow the shift scheme',
		employee: 'Employee',
		showMore: (n) => `Show ${n} more`,
		shown: (a, b) => `Showing ${a} of ${b} employees`,
		empty: 'No employee is working in this date range.',
		emptyEligible: 'No employee is rostered yet. Click Shift schemes to assign a pattern to a team, department or group; or choose All to roster manually.',
		noMatch: 'No employee matches the filters.',
		noShifts: 'No work shift is defined. Open Setup, Work shifts first.',
		headcount: 'Headcount per shift',
		readOnly: 'Your role can only view the roster.',
		locked: (code) => `Attendance of period ${code} is locked; the roster of this day cannot be changed.`,
		pickBrush: 'Pick a shift (or Off) in the shift bar before clicking a cell.',
		pickPeople: 'Tick employees before clicking a day header.',
		saved: (r) => `Saved: ${r.created} new cells, ${r.updated} changed${r.reset ? `, ${r.reset} back to the scheme` : ''}.`,
		confirmDiscard: (n) => `${n} changed cells are not saved. Discard these changes?`,
		cellTitle: (name, day, shift) => `${name} - ${day}: ${shift}`,
		manual: 'manual',
		pending: 'unsaved',
		fromScheme: 'per scheme',
		noCell: 'not assigned',
		dayTypes: {W: 'weekly day off', H: 'public holiday'},
		dow: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
		summary: (people, eligible) => `${eligible} of ${people} employees are rostered`,
		sel: {
			count: (n) => `${n} selected`,
			all: (n) => `Select all ${n} filtered`,
			none: 'Clear selection',
			range: 'Assign a shift for a date range',
			assign: 'Assign an individual scheme',
			reset: 'Back to the scheme',
		},
		rng: {
			title: (n) => `Assign a shift for a date range to ${n} employees`,
			shift: 'Shift',
			pickShift: 'Select a shift or Off',
			from: 'From',
			to: 'To',
			weekdays: 'Only on',
			note: (cells) => `${cells} manual cells will be written. Days in a locked attendance period are skipped. For a lasting change, use Assign an individual scheme.`,
			tooMany: (max) => `More than ${max} cells at once. Narrow the dates or the selection, or assign a scheme.`,
			run: 'Assign',
			done: (r, skipped) => `Shifts assigned: ${r.created} new cells, ${r.updated} changed${r.unchanged ? `, ${r.unchanged} unchanged` : ''}${skipped ? `, ${skipped} locked cells skipped` : ''}.`,
		},
		asg: {
			title: (n) => `Assign an individual scheme to ${n} employees`,
			note: 'Each employee gets an individual scheme that wins over the team or department scheme. A previous individual scheme is closed the day before the new effective date.',
			run: 'Assign',
			done: (r) => `Scheme assigned to ${r.created} employees${r.closed ? `, ${r.closed} previous rows closed` : ''}.`,
		},
		rst: {
			confirm: (n) => `Drop ${n} manual cells of the selected employees in the range on screen and follow the shift scheme again?`,
			none: 'The selected employees have no manual cell in the range on screen.',
			done: (r) => `${r.reset} cells are back to the scheme.`,
		},
		sch: {
			title: 'Shift schemes',
			intro: 'Each row assigns a shift pattern to a scope. When several rows apply to one employee: employee > team > department > pay group > whole subsidiary; at the same level the latest effective row wins.',
			add: 'Add a scheme',
			edit: 'Edit',
			stop: 'Deactivate',
			confirmStop: (name) => `Deactivate the scheme of ${name}? The roster derived from this row will be gone.`,
			empty: 'No shift scheme yet. Click Add a scheme.',
			search: 'Search scope, pattern, note',
			scope: 'Scope',
			scopes: {E: 'Employee', T: 'Team', D: 'Department', G: 'Pay group', S: 'Whole subsidiary'},
			target: 'Applies to',
			pickTarget: 'Select...',
			whole: 'Every employee of the subsidiary',
			pattern: 'Shift pattern',
			pickPattern: 'Select a shift pattern',
			cycle: (text, n) => `${n}-day cycle: ${text}`,
			effective: 'Effective from',
			expiration: 'Effective to',
			expirationHint: 'Empty = no end.',
			anchor: 'Date matching day 1 of the cycle',
			anchorHint: 'Empty = the effective date. Crews offset each other by moving this date.',
			note: 'Note',
			save: 'Save',
			cancel: 'Cancel',
			close: 'Close',
			newTitle: 'Add a shift scheme',
			editTitle: 'Edit the shift scheme',
			saved: 'Shift scheme saved.',
			stopped: 'Shift scheme deactivated.',
			noPatterns: 'No shift pattern is defined. Open Setup, Shift patterns.',
			cols: {scope: 'Scope', target: 'Applies to', pattern: 'Pattern', effective: 'From', expiration: 'To', anchor: 'Anchor', note: 'Note', act: ''},
		},
	},
};

const ROW_STEP = 60;
const GRID_ID = 's4vp-ros-grid';
const DAY_W = 46;
const NAME_W = 250;
const SPANS = [7, 14, 31];
const OFF = 'OFF';
const RESET = 'RESET';
const SAVE_CHUNK = 200;
const ASSIGN_CHUNK = 100;
const RANGE_MAX = 6000;

const CSS = `
.s4vp-ros-bar{padding:8px 12px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.s4vp-ros-bar .s4vp-ros-grow{flex:1 1 auto}
.s4vp-ros-brush{padding:0 12px 8px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;color:var(--s4vp-sub)}
.s4vp-ros-selbar{padding:6px 12px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:13px;background:var(--s4vp-accent-soft);border-top:1px solid var(--s4vp-line)}
.s4vp-ros-selbar b{font-weight:700}
.s4vp-ros-wrap{overflow:auto;max-height:560px;max-height:max(300px,calc(100vh - 270px));max-width:100%;border-top:1px solid var(--s4vp-line);border-bottom:1px solid var(--s4vp-line)}
.s4vp-ros{border-collapse:separate;border-spacing:0;table-layout:fixed;user-select:none;-webkit-user-select:none}
.s4vp-ros th{position:sticky;top:0;z-index:2;background:#F7F8F9;font-size:11px;font-weight:600;color:var(--s4vp-sub);text-align:center;padding:5px 0;border-bottom:1px solid #D9DEE2;line-height:1.25;overflow:hidden;white-space:nowrap;cursor:pointer}
.s4vp-ros td{font-size:12px;text-align:center;padding:0;height:34px;border-bottom:1px solid var(--s4vp-line-soft);border-right:1px solid #F0F2F4;overflow:hidden;white-space:nowrap;color:var(--s4vp-text);cursor:pointer;font-weight:600}
.s4vp-ros .s4vp-ros-l{position:sticky;left:0;z-index:1;background:var(--s4vp-surface);text-align:left;padding:3px 10px 3px 32px;border-right:1px solid #D9DEE2;text-overflow:ellipsis;font-weight:400}
.s4vp-ros th.s4vp-ros-l{z-index:3;background:#F7F8F9;font-size:12px;cursor:default}
.s4vp-ros td.s4vp-ros-l:before{content:'';position:absolute;left:10px;top:10px;width:13px;height:13px;border:1px solid var(--s4vp-ctl);border-radius:3px;background:#fff}
.s4vp-ros tr.s4vp-ros-on td.s4vp-ros-l{background:var(--s4vp-accent-soft)}
.s4vp-ros tr.s4vp-ros-on td.s4vp-ros-l:before{background:var(--s4vp-accent);border-color:var(--s4vp-accent);box-shadow:inset 0 0 0 2px #fff}
.s4vp-ros tr.s4vp-ros-out td.s4vp-ros-l .s4vp-ros-name{color:var(--s4vp-sub)}
.s4vp-ros-name{display:block;overflow:hidden;text-overflow:ellipsis;font-size:13px;line-height:1.3}
.s4vp-ros-kind{display:block;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--s4vp-sub);line-height:1.3}
.s4vp-ros .s4vp-ros-off{background:#ECEEF0}
.s4vp-ros .s4vp-ros-hol{background:#FBE9E7}
.s4vp-ros td.s4vp-ros-kD{background:#DCEBFA;color:#0B4A8F}
.s4vp-ros td.s4vp-ros-kE{background:#FFE9C7;color:#6B3A00}
.s4vp-ros td.s4vp-ros-kN{background:#E7E1F5;color:#4A2C8F}
.s4vp-ros td.s4vp-ros-rest{color:var(--s4vp-sub);font-weight:400}
.s4vp-ros td.s4vp-ros-m{box-shadow:inset -6px 6px 0 -3px #55616B}
.s4vp-ros td.s4vp-ros-p{outline:2px solid #C97A12;outline-offset:-2px}
.s4vp-ros td.s4vp-ros-lock{cursor:not-allowed;opacity:.55}
.s4vp-ros tr.s4vp-ros-sum td{cursor:default;background:#F7F8F9;font-weight:700;border-top:1px solid #D9DEE2;height:28px}
.s4vp-ros tr.s4vp-ros-sum td.s4vp-ros-l{background:#F7F8F9;font-weight:600;padding-left:10px}
.s4vp-ros tr.s4vp-ros-sum td.s4vp-ros-l:before{display:none}
.s4vp-ros-foot{padding:8px 12px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;font-size:12px;color:var(--s4vp-sub)}
.s4vp-ros-note{font-size:12px;color:var(--s4vp-sub);margin:0 0 10px}
.s4vp-ros-two{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
`;

let cssDone = false;
function ensureCss() {
	try {
		if (cssDone) return;
		let st = document.getElementById('s4vp-css-ros');
		if (!st) {
			st = document.createElement('style');
			st.id = 's4vp-css-ros';
			document.head.appendChild(st);
		}
		st.textContent = CSS;
		cssDone = true;
	} catch (e) {
		// không có document (kiểm thử): bỏ qua
	}
}

const cx = (...names) => names.filter(Boolean).join(' ');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Cộng ngày cho chuỗi yyyy-mm-dd (tính bằng UTC để không lệch múi giờ). */
export function addDays(iso, n) {
	if (!ISO.test(String(iso || ''))) return '';
	const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const dowOf = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();

/** Thứ hai của tuần chứa ngày iso. */
export function mondayOf(iso) {
	if (!ISO.test(String(iso || ''))) return '';
	const dow = dowOf(iso);
	return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/** Các ngày yyyy-mm-dd của [from, to] (tối đa 400 ngày), lọc theo thứ nếu có. */
export function dateList(from, to, weekdays) {
	const out = [];
	if (!ISO.test(String(from || '')) || !ISO.test(String(to || '')) || to < from) return out;
	for (let d = from, n = 0; d <= to && n < 400; d = addDays(d, 1), n += 1) {
		if (!weekdays || !weekdays.length || weekdays.indexOf(dowOf(d)) >= 0) out.push(d);
	}
	return out;
}

/** Ô nén của máy chủ {nhân viên: [[chỉ số ngày, ca, nguồn]]} -> {nhân viên: mảng theo ngày của {s, m} hoặc undefined}. */
export function expandCells(cells, dayCount) {
	const out = {};
	Object.keys(cells || {}).forEach((e) => {
		const row = new Array(dayCount);
		(cells[e] || []).forEach((c) => {
			if (c[0] >= 0 && c[0] < dayCount) row[c[0]] = {s: String(c[1] || ''), m: c[2] === 'M'};
		});
		out[e] = row;
	});
	return out;
}

/** Kỳ công khóa của ngày với nhân viên (group trống = tài khoản một nhóm lương, không lọc nhóm). */
export function lockOf(locks, group, date) {
	return (locks || []).find((l) => (!l.group || !group || l.group === group) && date >= l.from && date <= l.to) || null;
}

const shortDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const chunksOf = (list, size) => {
	const out = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
};

export default function RosterView({app}) {
	ensureCss();
	const t = pick(TEXT);
	const subsidiary = app.subsidiary || '';
	const params = (app.route || {}).params || {};
	const from = ISO.test(String(params.from || '')) ? String(params.from) : mondayOf(localToday());
	const span = SPANS.indexOf(Number(params.days)) >= 0 ? Number(params.days) : 14;
	const team = String(params.team || '');
	const to = addDays(from, span - 1);

	const [data, setData] = useState(null);
	const [loaded, setLoaded] = useState(false);
	const [q, setQ] = useState('');
	const [dept, setDept] = useState('');
	const [scope, setScope] = useState('E');
	const [brush, setBrush] = useState('');
	const [limit, setLimit] = useState(ROW_STEP);
	// Thay đổi chưa lưu: khóa "nhân viên|chỉ số ngày" -> id ca ('' = nghỉ) hoặc RESET. Giữ trong ref + bộ đếm để vẽ lại
	const pendingRef = useRef({});
	const selRef = useRef({});
	const tickRef = useRef(0);
	const [, setTick] = useState(0);
	const bump = () => {
		tickRef.current += 1;
		setTick(tickRef.current);
	};
	// Hộp thoại: null | {kind: 'schemes'} | {kind: 'scheme', id} | {kind: 'range'} | {kind: 'assign'}
	const [dialog, setDialog] = useState(null);
	const formRef = useRef({});
	const [form, setForm] = useState({});
	const alive = useRef(true);
	const request = useRef(0);
	const shownRef = useRef([]);
	const pickRef = useRef(() => undefined);
	const headRef = useRef(() => undefined);
	const lastRef = useRef(null);

	const pendingCount = () => Object.keys(pendingRef.current).length;
	const selected = () => Object.keys(selRef.current);
	const clearPending = () => {
		pendingRef.current = {};
		lastRef.current = null;
		bump();
	};

	const load = (keepSelection) => {
		if (!subsidiary) return Promise.resolve();
		request.current += 1;
		const mine = request.current;
		const args = {action: 'rosterView', subsidiary, from, to};
		if (team) args.team = team;
		return app.run(t.loading, call(args)).then((r) => {
			if (!alive.current || mine !== request.current) return;
			setLoaded(true);
			if (!r) return;
			pendingRef.current = {};
			lastRef.current = null;
			if (!keepSelection) selRef.current = {};
			else {
				const live = {};
				(r.rows || []).forEach((x) => {
					if (selRef.current[x.employee]) live[x.employee] = true;
				});
				selRef.current = live;
			}
			setData(r);
		});
	};

	useEffect(() => {
		alive.current = true;
		setLimit(ROW_STEP);
		load(false);
		return () => {
			alive.current = false;
		};
	}, [subsidiary, from, span, team]);

	// Đổi khoảng ngày / tổ: có thay đổi chưa lưu thì hỏi trước
	const guard = (action) => {
		if (pendingCount()) app.confirm(t.confirmDiscard(pendingCount()), () => {
			pendingRef.current = {};
			action();
		});
		else action();
	};
	const goWith = (next) => guard(() => app.go('roster', Object.assign({from, days: String(span), team}, next)));

	const days = data ? data.days || [] : [];
	const shifts = data ? data.shifts || [] : [];
	const shiftById = {};
	shifts.forEach((s) => (shiftById[s.id] = s));
	const rows = data ? data.rows || [] : [];
	const vrows = data ? data.vrows || [] : [];
	const cellMap = data ? expandCells(data.cells, days.length) : {};
	const canEdit = !!(data && data.canEdit);
	const nEligible = rows.filter((r) => r.eligible).length;
	// Chưa ai thuộc diện xếp ca: vẫn mặc định "Diện xếp ca" để thấy hướng dẫn khai chế độ ca
	const scoped = scope === 'E' ? rows.filter((r) => r.eligible || selRef.current[r.employee]) : rows;

	const needle = fold(q).split(/\s+/).filter((w) => w);
	const filtered = scoped.filter((r) => {
		if (dept && r.departmentId !== dept) return false;
		if (!needle.length) return true;
		const hay = fold([r.code, r.name, r.department, (r.teams || []).join(' '), (r.patterns || []).join(' ')].join(' '));
		return needle.every((w) => hay.indexOf(w) >= 0);
	});
	const shown = filtered.slice(0, limit);
	shownRef.current = shown;

	// Lịch suy ra từ chế độ ca của một ngày: id ca, '' (nghỉ) hoặc undefined (không có chế độ ca)
	const schemeOf = (row, i) => {
		const v = row.v === undefined || row.v === null ? null : vrows[row.v];
		const s = v ? v[i] : null;
		return s === null || s === undefined ? undefined : String(s);
	};
	// Giá trị hiện tại của ô: {s, m (sửa tay), p (chưa lưu), v (theo chế độ ca)} hoặc null khi chưa xếp
	const cellOf = (row, i) => {
		const key = `${row.employee}|${i}`;
		if (has(pendingRef.current, key)) {
			const pv = pendingRef.current[key];
			if (pv !== RESET) return {s: pv, m: true, p: true};
			const sv = schemeOf(row, i);
			return sv === undefined ? {s: '', none: true, p: true} : {s: sv, v: true, p: true};
		}
		const c = (cellMap[row.employee] || [])[i];
		if (c) return {s: c.s, m: c.m, p: false};
		const sv = schemeOf(row, i);
		return sv === undefined ? null : {s: sv, v: true, p: false};
	};

	// Đặt thay đổi cho một ô theo cây bút; trả false khi ô bị khóa
	const paint = (row, i, value, toggle) => {
		const lock = lockOf(data.locks, row.group, days[i].date);
		if (lock) return lock;
		const key = `${row.employee}|${i}`;
		const stored = (cellMap[row.employee] || [])[i];
		if (toggle && has(pendingRef.current, key) && pendingRef.current[key] === value) {
			delete pendingRef.current[key];
			return null;
		}
		if (value === RESET) {
			// Chỉ có nghĩa khi ô đang có bản ghi đã lưu
			if (stored) pendingRef.current[key] = RESET;
			else delete pendingRef.current[key];
			return null;
		}
		const sv = schemeOf(row, i);
		// Trùng giá trị đang có (ô đã lưu, hoặc lịch của chế độ ca khi chưa có ô): không coi là thay đổi
		if ((stored && stored.s === value) || (!stored && sv !== undefined && sv === value)) delete pendingRef.current[key];
		else pendingRef.current[key] = value;
		return null;
	};
	const brushValue = () => (brush === OFF ? '' : brush);

	pickRef.current = (rowIndex, cellIndex, shiftKey) => {
		const row = shownRef.current[rowIndex];
		if (!row || !data) return;
		if (cellIndex === 0) {
			// Cột nhân viên: tích chọn
			if (selRef.current[row.employee]) delete selRef.current[row.employee];
			else selRef.current[row.employee] = true;
			bump();
			return;
		}
		const dayIndex = cellIndex - 1;
		if (dayIndex < 0 || dayIndex >= days.length) return;
		if (!canEdit) {
			app.notify(t.readOnly, 'warn');
			return;
		}
		if (!brush) {
			app.notify(t.pickBrush, 'warn');
			return;
		}
		const last = lastRef.current;
		const list = [];
		if (shiftKey && last && last.employee === row.employee) for (let i = Math.min(last.day, dayIndex); i <= Math.max(last.day, dayIndex); i++) list.push(i);
		else list.push(dayIndex);
		let blocked = null;
		list.forEach((i) => {
			const lock = paint(row, i, brushValue(), list.length === 1);
			if (lock) blocked = lock;
		});
		lastRef.current = {employee: row.employee, day: dayIndex};
		if (blocked) app.notify(t.locked(blocked.code), 'warn');
		bump();
	};

	// Bấm tiêu đề ngày: tô cây bút cho cả ngày đó của những người đang chọn
	headRef.current = (cellIndex) => {
		const dayIndex = cellIndex - 1;
		if (!data || dayIndex < 0 || dayIndex >= days.length) return;
		if (!canEdit) {
			app.notify(t.readOnly, 'warn');
			return;
		}
		if (!brush) {
			app.notify(t.pickBrush, 'warn');
			return;
		}
		const people = rows.filter((r) => selRef.current[r.employee]);
		if (!people.length) {
			app.notify(t.pickPeople, 'warn');
			return;
		}
		let blocked = null;
		people.forEach((r) => {
			const lock = paint(r, dayIndex, brushValue(), false);
			if (lock) blocked = lock;
		});
		if (blocked) app.notify(t.locked(blocked.code), 'warn');
		bump();
	};

	// Một listener DOM trên khung lưới; gắn lại sau mỗi lần vẽ (gán thuộc tính nên không cộng dồn)
	useEffect(() => {
		try {
			const el = document.getElementById(GRID_ID);
			if (!el) return undefined;
			el.onclick = (ev) => {
				try {
					const cell = ev && ev.target && ev.target.closest ? ev.target.closest('td,th') : null;
					const tr = cell ? cell.parentNode : null;
					if (!cell || !tr || !el.contains(cell)) return;
					if (cell.tagName === 'TH') headRef.current(cell.cellIndex);
					else pickRef.current(tr.rowIndex - 1, cell.cellIndex, !!ev.shiftKey);
				} catch (e) {
					// bỏ qua lượt bấm lỗi
				}
			};
		} catch (e) {
			// không có document
		}
		return undefined;
	});

	// Gửi nhiều lô nối tiếp, cộng dồn số đếm
	const sendChunks = (list, size, build) => {
		const total = {};
		return chunksOf(list, size)
			.reduce((p, chunk) => p.then(() => post(build(chunk))).then((r) => {
				Object.keys(r || {}).forEach((k) => {
					if (typeof r[k] === 'number') total[k] = (total[k] || 0) + r[k];
				});
			}), Promise.resolve())
			.then(() => total);
	};

	const save = () => {
		const set = [];
		const reset = [];
		Object.keys(pendingRef.current).forEach((key) => {
			const cut = key.indexOf('|');
			const c = {employee: key.slice(0, cut), workDate: days[Number(key.slice(cut + 1))].date};
			if (pendingRef.current[key] === RESET) reset.push(c);
			else set.push(Object.assign(c, {shift: pendingRef.current[key]}));
		});
		if (!set.length && !reset.length) return;
		const work = sendChunks(set, SAVE_CHUNK, (cells) => ({action: 'rosterCells', subsidiary, cells})).then((a) =>
			sendChunks(reset, SAVE_CHUNK, (cells) => ({action: 'rosterReset', subsidiary, cells})).then((b) => ({created: a.created || 0, updated: a.updated || 0, reset: b.reset || 0}))
		);
		app.run(t.saving, work).then((r) => {
			if (!alive.current) return;
			// Lỗi giữa chừng: các lô trước đã ghi, tải lại để thấy đúng hiện trạng
			load(true).then(() => {
				if (r) app.notify(t.saved(r));
			});
		});
	};

	// ------------------------------------------------------------------ hộp thoại

	const setField = (k) => (v) => {
		formRef.current = Object.assign({}, formRef.current, {[k]: v});
		setForm(formRef.current);
	};
	const open = (kind, values) => {
		formRef.current = values || {};
		setForm(formRef.current);
		setDialog({kind});
	};
	const close = () => setDialog(null);

	const openRange = () => guard(() => open('range', {shift: '', from, to, weekdays: []}));
	const openAssign = () => guard(() => open('assign', {pattern: '', effective: from, expiration: '', anchor: '', note: ''}));
	const openSchemes = () => guard(() => open('schemes', {}));
	const openScheme = (row) =>
		open('scheme', row
			? {id: row.id, scope: row.scope, target: row.target, pattern: row.pattern, effective: row.effective, expiration: row.expiration, anchor: row.anchor, note: row.note}
			: {id: '', scope: 'T', target: team || '', pattern: '', effective: from, expiration: '', anchor: '', note: ''});

	const runRange = () => {
		const v = formRef.current;
		const people = rows.filter((r) => selRef.current[r.employee]);
		const dates = dateList(v.from, v.to, v.weekdays);
		if (!v.shift || !people.length || !dates.length) return;
		const value = v.shift === OFF ? '' : v.shift;
		const cells = [];
		let skipped = 0;
		people.forEach((r) => dates.forEach((d) => {
			if (lockOf(data.locks, r.group, d)) skipped += 1;
			else cells.push({employee: r.employee, workDate: d, shift: value});
		}));
		if (cells.length > RANGE_MAX) {
			app.notify(t.rng.tooMany(RANGE_MAX), 'warn');
			return;
		}
		const work = sendChunks(cells, SAVE_CHUNK, (chunk) => ({action: 'rosterCells', subsidiary, cells: chunk}));
		app.run(t.saving, work).then((r) => {
			if (!alive.current) return;
			close();
			load(true).then(() => {
				if (r) app.notify(t.rng.done({created: r.created || 0, updated: r.updated || 0, unchanged: r.unchanged || 0}, skipped));
			});
		});
	};

	const runAssign = () => {
		const v = formRef.current;
		const people = selected();
		if (!v.pattern || !ISO.test(String(v.effective || '')) || !people.length) return;
		const base = {action: 'rosterAssignBatch', subsidiary, pattern: v.pattern, effective: v.effective, note: v.note || ''};
		if (ISO.test(String(v.expiration || ''))) base.expiration = v.expiration;
		if (ISO.test(String(v.anchor || ''))) base.anchor = v.anchor;
		const work = sendChunks(people, ASSIGN_CHUNK, (chunk) => Object.assign({}, base, {employees: chunk}));
		app.run(t.saving, work).then((r) => {
			if (!alive.current) return;
			close();
			load(true).then(() => {
				if (r) app.notify(t.asg.done({created: r.created || 0, closed: r.closed || 0}));
			});
		});
	};

	const runReset = () => {
		const cells = [];
		rows.filter((r) => selRef.current[r.employee]).forEach((r) => {
			(cellMap[r.employee] || []).forEach((c, i) => {
				if (c && !lockOf(data.locks, r.group, days[i].date)) cells.push({employee: r.employee, workDate: days[i].date});
			});
		});
		if (!cells.length) {
			app.notify(t.rst.none, 'warn');
			return;
		}
		guard(() => app.confirm(t.rst.confirm(cells.length), () => {
			app.run(t.saving, sendChunks(cells, SAVE_CHUNK, (chunk) => ({action: 'rosterReset', subsidiary, cells: chunk}))).then((r) => {
				if (!alive.current) return;
				load(true).then(() => {
					if (r) app.notify(t.rst.done({reset: r.reset || 0}));
				});
			});
		}));
	};

	const saveScheme = () => {
		const v = formRef.current;
		if (!v.scope || !v.pattern || !ISO.test(String(v.effective || '')) || (v.scope !== 'S' && !v.target)) return;
		const values = {scope: v.scope, pattern: v.pattern, effective: v.effective, expiration: ISO.test(String(v.expiration || '')) ? v.expiration : '', anchor: ISO.test(String(v.anchor || '')) ? v.anchor : '', note: v.note || ''};
		const key = {E: 'employee', T: 'team', D: 'department', G: 'paygroup'}[v.scope];
		if (key) values[key] = v.target;
		const body = {action: 'rosterAssignSave', subsidiary, values};
		if (v.id) body.id = v.id;
		app.run(t.saving, post(body)).then((r) => {
			if (!r || !alive.current) return;
			load(true).then(() => {
				app.notify(t.sch.saved);
				open('schemes', {});
			});
		});
	};
	const stopScheme = (row) =>
		app.confirm(t.sch.confirmStop(row.targetName || t.sch.scopes[row.scope]), () => {
			app.run(t.saving, post({action: 'rosterAssignSave', subsidiary, id: row.id, inactive: true})).then((r) => {
				if (!r || !alive.current) return;
				load(true).then(() => app.notify(t.sch.stopped));
			});
		});

	const header = (extra) => (
		<PageHeader
			crumbs={[{label: t.crumb, onClick: () => app.go('attendance')}]}
			title={t.title}
			sub={t.sub}
			actions={[<Button label={t.reload} disabled={!subsidiary || !!app.busy} onClick={() => guard(() => load(true))} />].concat(extra || [])}
		/>
	);

	if (!data) {
		return (
			<Page>
				{header()}
				<Card>
					<Empty text={!subsidiary ? t.noSubsidiary : loaded ? t.noData : t.loading} />
				</Card>
			</Page>
		);
	}

	// ------------------------------------------------------------------ dữ liệu suy ra

	const teams = data.teams || [];
	const patterns = (data.patterns || []).filter((p) => p.active);
	const schemes = data.schemes || [];
	const activeShifts = shifts.filter((s) => s.active);
	const shiftLabel = (s) => `${s.code} ${s.start}-${s.end}`;
	const brushItems = activeShifts.map((s) => ({value: s.id, label: shiftLabel(s)})).concat([{value: OFF, label: t.off}, {value: RESET, label: t.byScheme}]);
	const brushName = brush === OFF ? t.offLong : brush === RESET ? t.bySchemeLong : shiftById[brush] ? `${shiftById[brush].code}${shiftById[brush].description ? ` - ${shiftById[brush].description}` : ''}` : '';
	const nPending = pendingCount();
	const nSelected = selected().length;

	// Số người theo ca từng ngày trên các nhân viên đang lọc (kể cả dòng chưa hiện), gồm thay đổi chưa lưu
	const counts = {};
	filtered.forEach((r) => {
		for (let i = 0; i < days.length; i++) {
			const c = cellOf(r, i);
			if (!c || !c.s) continue;
			(counts[c.s] = counts[c.s] || new Array(days.length).fill(0))[i] += 1;
		}
	});
	const countShifts = shifts.filter((s) => counts[s.id]);

	const tableWidth = NAME_W + days.length * DAY_W;
	const dayClass = (d) => (d.type === 'H' ? 's4vp-ros-hol' : d.type === 'W' ? 's4vp-ros-off' : '');

	const grid = (
		<div id={GRID_ID} class="s4vp-ros-wrap">
			<table class="s4vp-ros" aria-label={t.title} style={{width: `${tableWidth}px`}}>
				<thead>
					<tr>
						<th class="s4vp-ros-l" style={{width: `${NAME_W}px`}}>{t.employee}</th>
						{days.map((d, i) => {
							const a = {style: {width: `${DAY_W}px`}, title: `${t.dow[d.dow]}, ${fmtDate(d.date)}${d.type !== 'N' ? ` - ${t.dayTypes[d.type]}` : ''}`};
							const cls = dayClass(d);
							if (cls) a.class = cls;
							return (
								<th key={`h${i}`} {...a}>
									<div>{t.dow[d.dow]}</div>
									<div>{shortDay(d.date)}</div>
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody>
					{shown.length ? null : (
						<tr key="s4vp-none" class="s4vp-ros-sum">
							<td colSpan={String(days.length + 1)} style={{height: 'auto', textAlign: 'left', fontWeight: '400', background: '#fff'}}>
								<Empty text={!rows.length ? t.empty : scope === 'E' && !nEligible && !needle.length && !dept ? t.emptyEligible : t.noMatch} />
							</td>
						</tr>
					)}
					{shown.map((r) => {
						const tr = {};
						const cls = cx(selRef.current[r.employee] ? 's4vp-ros-on' : '', r.eligible ? '' : 's4vp-ros-out');
						if (cls) tr.class = cls;
						return (
							<tr key={`e${r.employee}`} {...tr}>
								<td class="s4vp-ros-l" title={`${r.code} ${r.name}${r.department ? ` - ${r.department}` : ''}`}>
									<span class="s4vp-ros-name">
										<span class="s4vp-link">{r.code}</span>
										{` ${r.name}`}
									</span>
									<span class="s4vp-ros-kind">{[(r.patterns || []).join(', '), (r.teams || []).join(', '), r.department].filter(Boolean).join(' · ')}</span>
								</td>
								{days.map((d, i) => {
									const c = cellOf(r, i);
									const s = c && c.s ? shiftById[c.s] : null;
									const lock = lockOf(data.locks, r.group, d.date);
									const blankCell = !c || c.none;
									const kcls = cx(
										s ? `s4vp-ros-k${s.kind || 'D'}` : blankCell ? dayClass(d) : cx('s4vp-ros-rest', dayClass(d)),
										c && c.m && !c.p ? 's4vp-ros-m' : '',
										c && c.p ? 's4vp-ros-p' : '',
										lock ? 's4vp-ros-lock' : ''
									);
									const label = s ? `${s.code} ${s.start}-${s.end}` : blankCell ? t.noCell : t.offLong;
									const notes = [c && c.p ? t.pending : c && c.m ? t.manual : c && c.v ? t.fromScheme : '', lock ? t.locked(lock.code) : ''].filter(Boolean).join('; ');
									const a = {title: `${t.cellTitle(r.name || r.code, fmtDate(d.date), label)}${notes ? ` (${notes})` : ''}`};
									if (kcls) a.class = kcls;
									return (
										<td key={`d${i}`} {...a}>
											{s ? s.code : blankCell ? '' : '-'}
										</td>
									);
								})}
							</tr>
						);
					})}
					{countShifts.map((s) => (
						<tr key={`c${s.id}`} class="s4vp-ros-sum">
							<td class="s4vp-ros-l" title={t.headcount}>{`${t.headcount}: ${s.code}`}</td>
							{days.map((d, i) => (
								<td key={`n${i}`}>{counts[s.id][i] ? String(counts[s.id][i]) : ''}</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);

	const teamOptions = teams.map((x) => ({value: x.id, label: `${x.code}${x.description ? ` - ${x.description}` : ''} (${x.members})`}));
	const deptOptions = (data.departments || []).map((x) => ({value: x.id, label: x.name}));
	const patternOptions = patterns.map((p) => ({value: p.id, label: `${p.code}${p.description ? ` - ${p.description}` : ''}`}));
	const patternHint = (id) => {
		const p = patterns.find((x) => x.id === id);
		return p ? t.sch.cycle(p.cycle.map((c) => c || t.off).join(', '), p.cycle.length) : null;
	};
	const targetOptions = (sc) => {
		if (sc === 'E') return rows.map((r) => ({value: r.employee, label: `${r.code} ${r.name}`}));
		if (sc === 'T') return teamOptions;
		if (sc === 'D') return deptOptions;
		if (sc === 'G') return (data.paygroups || []).map((g) => ({value: g.id, label: g.code}));
		return [];
	};

	const selectAll = () => {
		filtered.forEach((r) => (selRef.current[r.employee] = true));
		bump();
	};
	const selectNone = () => {
		selRef.current = {};
		bump();
	};

	let dialogNode = null;
	if (dialog && dialog.kind === 'schemes') {
		const sRows = schemes.map((x) => Object.assign({}, x, {scopeText: t.sch.scopes[x.scope] || x.scope, targetText: x.scope === 'S' ? t.sch.whole : x.targetName || x.target}));
		const cols = [
			{key: 'scopeText', label: t.sch.cols.scope, nowrap: true},
			{key: 'targetText', label: t.sch.cols.target},
			{key: 'patternCode', label: t.sch.cols.pattern, nowrap: true},
			{key: 'effective', label: t.sch.cols.effective, nowrap: true, render: (r) => fmtDate(r.effective)},
			{key: 'expiration', label: t.sch.cols.expiration, nowrap: true, render: (r) => fmtDate(r.expiration)},
			{key: 'anchor', label: t.sch.cols.anchor, nowrap: true, render: (r) => fmtDate(r.anchor)},
			{key: 'note', label: t.sch.cols.note},
		];
		if (canEdit) {
			cols.push({key: 'act', label: t.sch.cols.act, nowrap: true, noRowClick: true, render: (r) => (
				<span class="s4vp-actions">
					<Button small={true} kind="link" label={t.sch.edit} onClick={() => openScheme(r)} />
					<Button small={true} kind="link" label={t.sch.stop} onClick={() => stopScheme(r)} />
				</span>
			)});
		}
		dialogNode = (
			<Dialog title={t.sch.title} onClose={close} width={920} actions={[<Button label={t.sch.close} onClick={close} />, canEdit ? <Button label={t.sch.add} kind="primary" disabled={!!app.busy} onClick={() => openScheme(null)} /> : null]}>
				<div class="s4vp-ros-note">{t.sch.intro}</div>
				<Table columns={cols} rows={sRows} keyOf={(r) => r.id} empty={t.sch.empty} search={true} searchPlaceholder={t.sch.search} maxHeight={360} />
			</Dialog>
		);
	} else if (dialog && dialog.kind === 'scheme') {
		const sc = form.scope || 'T';
		const ok = !!form.pattern && ISO.test(String(form.effective || '')) && (sc === 'S' || !!form.target);
		dialogNode = (
			<Dialog title={form.id ? t.sch.editTitle : t.sch.newTitle} onClose={() => open('schemes', {})} width={560} actions={[<Button label={t.sch.cancel} onClick={() => open('schemes', {})} />, <Button label={t.sch.save} kind="primary" disabled={!ok || !!app.busy} onClick={saveScheme} />]}>
				{patterns.length ? null : <div class="s4vp-ros-note">{t.sch.noPatterns}</div>}
				<div class="s4vp-ros-two">
					<Field label={t.sch.scope} required={true}>
						<Select value={sc} onInput={(v) => {
							formRef.current = Object.assign({}, formRef.current, {scope: v, target: ''});
							setForm(formRef.current);
						}} options={['T', 'D', 'G', 'S', 'E'].map((k) => ({value: k, label: t.sch.scopes[k]}))} />
					</Field>
					<Field label={t.sch.target} required={sc !== 'S'}>
						{sc === 'S' ? <TextInput value={t.sch.whole} disabled={true} /> : <AutoSelect value={form.target || ''} onInput={setField('target')} options={targetOptions(sc)} placeholder={t.sch.pickTarget} />}
					</Field>
				</div>
				<Field label={t.sch.pattern} required={true} hint={patternHint(form.pattern)}>
					<AutoSelect value={form.pattern || ''} onInput={setField('pattern')} options={patternOptions} placeholder={t.sch.pickPattern} />
				</Field>
				<div class="s4vp-ros-two">
					<Field label={t.sch.effective} required={true}>
						<DateInput value={form.effective || ''} onInput={setField('effective')} />
					</Field>
					<Field label={t.sch.expiration} hint={t.sch.expirationHint}>
						<DateInput value={form.expiration || ''} onInput={setField('expiration')} min={form.effective || ''} />
					</Field>
				</div>
				<Field label={t.sch.anchor} hint={t.sch.anchorHint}>
					<DateInput value={form.anchor || ''} onInput={setField('anchor')} />
				</Field>
				<Field label={t.sch.note}>
					<TextInput value={form.note || ''} onInput={setField('note')} />
				</Field>
			</Dialog>
		);
	} else if (dialog && dialog.kind === 'range') {
		const dates = dateList(form.from, form.to, form.weekdays);
		const nCells = dates.length * nSelected;
		const wd = form.weekdays || [];
		dialogNode = (
			<Dialog title={t.rng.title(nSelected)} onClose={close} width={560} actions={[<Button label={t.sch.cancel} onClick={close} />, <Button label={t.rng.run} kind="primary" disabled={!form.shift || !nCells || nCells > RANGE_MAX || !!app.busy} onClick={runRange} />]}>
				<Field label={t.rng.shift} required={true}>
					<Select value={form.shift || ''} onInput={setField('shift')} options={activeShifts.map((s) => ({value: s.id, label: shiftLabel(s)})).concat([{value: OFF, label: t.offLong}])} placeholder={t.rng.pickShift} />
				</Field>
				<div class="s4vp-ros-two">
					<Field label={t.rng.from} required={true}>
						<DateInput value={form.from || ''} onInput={setField('from')} />
					</Field>
					<Field label={t.rng.to} required={true}>
						<DateInput value={form.to || ''} onInput={setField('to')} min={form.from || ''} />
					</Field>
				</div>
				<Field label={t.rng.weekdays}>
					<span class="s4vp-actions">
						{[1, 2, 3, 4, 5, 6, 0].map((n) => (
							<Button key={`w${n}`} small={true} label={t.dow[n]} kind={wd.indexOf(n) >= 0 ? 'primary' : 'default'} pressed={wd.indexOf(n) >= 0} onClick={() => setField('weekdays')(wd.indexOf(n) >= 0 ? wd.filter((x) => x !== n) : wd.concat([n]))} />
						))}
					</span>
				</Field>
				<div class="s4vp-ros-note">{nCells > RANGE_MAX ? t.rng.tooMany(RANGE_MAX) : t.rng.note(nCells)}</div>
			</Dialog>
		);
	} else if (dialog && dialog.kind === 'assign') {
		dialogNode = (
			<Dialog title={t.asg.title(nSelected)} onClose={close} width={560} actions={[<Button label={t.sch.cancel} onClick={close} />, <Button label={t.asg.run} kind="primary" disabled={!form.pattern || !ISO.test(String(form.effective || '')) || !nSelected || !!app.busy} onClick={runAssign} />]}>
				<div class="s4vp-ros-note">{t.asg.note}</div>
				<Field label={t.sch.pattern} required={true} hint={patternHint(form.pattern)}>
					<AutoSelect value={form.pattern || ''} onInput={setField('pattern')} options={patternOptions} placeholder={t.sch.pickPattern} />
				</Field>
				<div class="s4vp-ros-two">
					<Field label={t.sch.effective} required={true}>
						<DateInput value={form.effective || ''} onInput={setField('effective')} />
					</Field>
					<Field label={t.sch.expiration} hint={t.sch.expirationHint}>
						<DateInput value={form.expiration || ''} onInput={setField('expiration')} min={form.effective || ''} />
					</Field>
				</div>
				<Field label={t.sch.anchor} hint={t.sch.anchorHint}>
					<DateInput value={form.anchor || ''} onInput={setField('anchor')} />
				</Field>
				<Field label={t.sch.note}>
					<TextInput value={form.note || ''} onInput={setField('note')} />
				</Field>
			</Dialog>
		);
	}

	return (
		<Page>
			{header([<Button label={`${t.schemes}${schemes.length ? ` (${schemes.length})` : ''}`} kind={nPending ? 'default' : 'primary'} disabled={!!app.busy} onClick={openSchemes} />])}
			<Card flush={true} label={t.title}>
				<div class="s4vp-ros-bar">
					<Button small={true} label={`‹ ${t.prev}`} onClick={() => goWith({from: addDays(from, -span)})} />
					<DateInput value={from} onInput={(v) => ISO.test(v) && v !== from && goWith({from: v})} ariaLabel={t.from} width={150} />
					<Button small={true} label={`${t.next} ›`} onClick={() => goWith({from: addDays(from, span)})} />
					<Button small={true} kind="ghost" label={t.today} onClick={() => goWith({from: mondayOf(localToday())})} />
					<Select value={String(span)} onInput={(v) => Number(v) !== span && goWith({days: v})} options={SPANS.map((n) => ({value: String(n), label: t.spans[n]}))} ariaLabel={t.span} width={110} />
					<Chips items={[{value: 'E', label: t.scopeEligible, count: nEligible}, {value: 'A', label: t.scopeAll, count: rows.length}]} value={scope} onPick={(v) => {
						setScope(v);
						setLimit(ROW_STEP);
					}} label={t.scopeLabel} />
					<AutoSelect value={team} onInput={(v) => v !== team && goWith({team: v})} options={teamOptions} placeholder={t.allTeams} ariaLabel={t.team} width={200} />
					<AutoSelect value={dept} onInput={(v) => {
						setDept(v);
						setLimit(ROW_STEP);
					}} options={deptOptions} placeholder={t.allDepts} ariaLabel={t.dept} width={200} />
					<span class="s4vp-ros-grow" />
					<SearchBox value={q} onInput={(v) => {
						setQ(v);
						setLimit(ROW_STEP);
					}} placeholder={t.search} width={240} />
				</div>
				{canEdit ? (
					<div class="s4vp-ros-brush">
						{activeShifts.length ? <Chips items={brushItems} value={brush} onPick={(v) => setBrush(v === brush ? '' : v)} label={t.brush} /> : <span>{t.noShifts}</span>}
						<span>{brush ? t.brushOn(brushName) : t.brushNone}</span>
					</div>
				) : (
					<div class="s4vp-ros-brush">
						<span>{t.readOnly}</span>
					</div>
				)}
				{canEdit ? (
					<div class="s4vp-ros-selbar">
						<b>{t.sel.count(nSelected)}</b>
						<Button small={true} kind="link" label={t.sel.all(filtered.length)} disabled={!filtered.length} onClick={selectAll} />
						{nSelected ? <Button small={true} kind="link" label={t.sel.none} onClick={selectNone} /> : null}
						<span class="s4vp-ros-grow" />
						<Button small={true} label={t.sel.range} disabled={!nSelected || !!app.busy} onClick={openRange} />
						<Button small={true} label={t.sel.assign} disabled={!nSelected || !!app.busy} onClick={openAssign} />
						<Button small={true} label={t.sel.reset} disabled={!nSelected || !!app.busy} onClick={runReset} />
					</div>
				) : null}
				{grid}
				<div class="s4vp-ros-foot">
					<span>
						{t.summary(rows.length, nEligible)}
						{` · ${t.shown(shown.length, filtered.length)}`}
					</span>
					<span class="s4vp-actions">
						{filtered.length > shown.length ? <Button small={true} label={t.showMore(Math.min(ROW_STEP, filtered.length - shown.length))} onClick={() => setLimit(limit + ROW_STEP)} /> : null}
						{nPending ? <Button small={true} label={t.discard} disabled={!!app.busy} onClick={clearPending} /> : null}
						{nPending ? <Button small={true} kind="primary" label={t.save(nPending)} disabled={!!app.busy} onClick={save} /> : null}
					</span>
				</div>
			</Card>
			{dialogNode}
		</Page>
	);
}
