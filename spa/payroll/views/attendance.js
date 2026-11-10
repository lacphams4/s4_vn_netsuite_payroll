/**
 * Chấm công (tính công theo kỳ) - mẫu docs/design/TinhCong.dc.html. Tham số route: period (trống = kỳ đang mở gần nhất,
 * do máy chủ chọn). Dữ liệu: GET attendanceMonth (api/AttendanceMonth.js, dựng bằng core/AttendanceMonthGrid); chi tiết lượt
 * chấm / phân ca / giờ Time của một nhân viên: GET attendanceEmployee, nạp khi mở khung bên phải.
 *
 * Bố cục: tiêu đề + chọn kỳ + một nút chính cho việc kế tiếp, thanh 4 bước, thẻ số liệu, lưới công nhân viên x ngày (cột
 * nhân viên dính trái, tiêu đề ngày dính trên, cuộn trong khung riêng) và cột phải gồm khung chi tiết của ô / nhân viên
 * đang chọn cùng danh sách ngoại lệ có nút xử lý tại chỗ.
 *
 * Mọi thao tác ghi dùng action cũ của RESTlet: buildAttendance, lockAttendance, unlockAttendance, processPunches,
 * loadSheetEmployees ({id: kỳ}); saveSheet (sửa ô ngày của bảng công ký hiệu); saveDoc + docAction (phiếu ngoại lệ điều
 * chỉnh công một ngày ở nhóm lương theo chứng từ, và duyệt / từ chối chứng từ còn chờ).
 *
 * Hiệu năng: lưới chỉ vẽ một phần số dòng (ROW_STEP, có nút hiện thêm và ô tìm); ô ngày không có handler riêng - một
 * listener DOM trên khung lưới đọc chỉ số dòng / cột của ô được bấm, dự phòng là onClick của dòng (chọn nhân viên).
 * CSS riêng của lưới chèn bằng thẻ <style id="s4vp-css-atd"> (không sửa ui/css.js).
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post, openRecord} from '../lib/api.js';
import {num, fmtDate, toNumber, fold} from '../lib/format.js';
import {pick} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Menu, Stepper, StatCards, Chips, SearchBox, Tabs, Badge, Table, Field, TextInput, NumberInput, Select, Dialog, SidePanel, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		crumb: 'Chấm công',
		title: (code) => `Công kỳ ${code}`,
		titleNone: 'Chấm công',
		periodCrumb: (code) => `Kỳ ${code}`,
		period: 'Kỳ lương',
		loading: 'Đang tải bảng công...',
		working: 'Đang xử lý...',
		noData: 'Chưa tải được bảng công của kỳ. Kiểm tra thông báo phía trên rồi bấm Tải lại.',
		noSubsidiary: 'Hãy chọn công ty con ở góc phải thanh tab.',
		reload: 'Tải lại',
		legacy: 'Đơn từ, lượt chấm, phép (màn hình cũ)',
		more: 'Thao tác khác',
		sub: (p, n) => `Kỳ ${fmtDate(p.start)} - ${fmtDate(p.end)} · Nhóm lương ${p.paygroupName || p.paygroupCode} · Công chuẩn ${num(p.stdDays)} ngày · ${n} nhân viên`,
		modeE: 'Công theo chứng từ',
		modeS: 'Bảng công ký hiệu',
		otherSubs: (n) => `${n} nhân viên của kỳ thuộc công ty con khác (không hiện ở đây, vẫn được khóa cùng kỳ)`,
		status: {locked: 'Đã khóa công', closed: 'Kỳ đã đóng', open: 'Đang mở', openIssues: (n) => `Đang mở, còn ${n} ngoại lệ`},
		steps: {collect: 'Thu thập', exceptions: 'Xử lý ngoại lệ', lock: 'Khóa công', handoff: 'Chuyển sang tính lương'},
		stepsLabel: 'Các bước tính công',
		stepNotes: {collect: 'chấm công, đơn từ, bảng công', left: (n) => `còn ${n}`, locked: 'đã khóa'},
		act: {
			build: 'Tổng hợp công', rebuild: 'Tổng hợp lại', lock: 'Khóa công', unlock: 'Mở khóa công', toPayroll: 'Sang chạy lương', punches: 'Xử lý chấm công máy',
			loadSheet: 'Nạp nhân viên vào bảng công', readOnly: 'Vai trò của bạn chỉ được xem', lockedHint: 'Kỳ công đã khóa', noUnlock: 'Kỳ đã có bảng lương ghi sổ, không mở khóa được',
		},
		confirmLock: (n) => (n ? `Còn ${n} ngoại lệ chưa xử lý: chứng từ chưa duyệt sẽ không được tính vào công.\n` : '') + 'Khóa công sẽ tổng hợp lại lần cuối, chốt số công của kỳ và khóa các chứng từ công đã duyệt. Tiếp tục?',
		confirmUnlock: 'Mở khóa công của kỳ này? Số công có thể thay đổi; bảng lương đã tính của kỳ cần tính lại.',
		done: {
			build: (r) => `Đã tổng hợp công${r && r.employees !== undefined ? ` cho ${r.employees} nhân viên` : ''}.`,
			lock: 'Đã khóa công của kỳ.', unlock: 'Đã mở khóa công của kỳ.',
			punches: (r) => `Đã xử lý chấm công: ${r.exceptions || 0} phiếu ngoại lệ, ${r.overtime || 0} đơn làm thêm đề xuất (tạm giữ, chờ duyệt).`,
			loadSheet: (r) => `Đã nạp ${(r.added || []).length} nhân viên vào bảng công.`,
			doc: {submit: 'Đã gửi duyệt.', approve: 'Đã duyệt.', reject: 'Đã từ chối.'},
			saved: 'Đã lưu công.', docCreated: 'Đã lập phiếu điều chỉnh công và gửi duyệt.',
			docHeld: 'Đã lập phiếu điều chỉnh công (tạm giữ). Gửi duyệt ở danh sách ngoại lệ.',
		},
		queued: 'Kỳ có nhiều nhân viên nên đang chạy nền. Bấm Tải lại sau ít phút.',
		cards: {
			issues: 'Ngoại lệ chờ xử lý', none: 'Không còn ngoại lệ', docs: 'Đơn từ trong kỳ', paid: 'Công hưởng lương', ctv: 'Giờ cộng tác viên', ot: 'Giờ làm thêm',
			pendingDocs: (n) => `${n} chứng từ chờ`, rebuild: (n) => `${n} cần tổng hợp lại`, sheet: (n) => `${n} dòng bảng công`, hours: (n) => `${n} giờ chờ duyệt`, info: (n) => `${n} để biết`,
			leave: (n) => `${n} nghỉ`, trip: (n) => `${n} công tác`, otDocs: (n) => `${n} làm thêm`, exc: (n) => `${n} ngoại lệ`, waiting: (n) => `${n} chờ xử lý`, noDocs: 'chưa có đơn từ',
			employees: (n) => `${n} nhân viên`, estimated: 'số dự tính, chưa tổng hợp', accepted: 'đã nhận vào lương', pending: (h) => `${h} giờ còn chờ duyệt`, otNote: (n) => `${n} đơn làm thêm`,
		},
		grid: {
			label: 'Bảng công tháng', search: 'Tìm tên, mã, phòng ban, ký hiệu công', all: 'Tất cả', issues: 'Có ngoại lệ', employee: 'Nhân viên',
			cols: {leave: 'Phép', unpaid: 'K.lương', trip: 'C.tác', ot: 'L.thêm', paid: 'Công'},
			colTitles: {leave: 'Nghỉ có lương (ngày)', unpaid: 'Nghỉ không lương và nghỉ BHXH trả (ngày)', trip: 'Công tác (ngày)', ot: 'Giờ làm thêm đã duyệt', paid: 'Công hưởng lương (cộng tác viên: giờ)'},
			hours: (h) => `${h} giờ`, estimated: 'Số dự tính từ chứng từ, chưa lập bảng tổng hợp', stale: 'Bảng tổng hợp cũ hơn chứng từ, cần tổng hợp lại',
			empty: 'Kỳ này chưa có nhân viên nào thuộc nhóm lương của kỳ.', noMatch: 'Không có nhân viên nào khớp.',
			shown: (a, b) => `Hiện ${a} / ${b} nhân viên`, showMore: (n) => `Hiện thêm ${n}`, matches: (n) => `${n} dòng khớp`,
			hintE: 'Bấm một ô để xem chi tiết ngày và sửa công. Ô ngày được suy từ lịch làm việc và chứng từ đã duyệt; số tổng lấy từ bảng tổng hợp công.',
			hintS: 'Bấm một ô để xem chi tiết ngày và sửa ký hiệu. Ô ngày là ký hiệu của bảng công ký hiệu.',
			timeOff: 'Account chưa bật Time Tracking nên không đọc được giờ của cộng tác viên.',
		},
		dow: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
		dowLong: ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'],
		salary: {M: 'Lương tháng', D: 'Lương ngày', H: 'Lương giờ'},
		contractor: 'Cộng tác viên',
		kinds: {W: 'đi làm', P: 'nghỉ có lương', U: 'nghỉ không lương', S: 'nghỉ BHXH trả', T: 'công tác', N: 'không tính công', holiday: 'nghỉ lễ', A: 'công đã điều chỉnh (số công)', H: 'giờ cộng tác viên', M: 'thiếu dữ liệu', '?': 'ký hiệu không hợp lệ', O: 'ngoài hợp đồng'},
		half: 'nửa ngày',
		legend: {label: 'Chú giải', pending: 'cần xử lý', ot: 'có làm thêm', late: 'trễ / sớm', off: 'nghỉ tuần, lễ'},
		dayTypes: {N: 'Ngày thường', W: 'Nghỉ hằng tuần', H: 'Ngày lễ'},
		exc: {
			title: (n) => `Ngoại lệ cần xử lý (${n})`, search: 'Tìm nhân viên, ngày, loại ngoại lệ', none: 'Không có ngoại lệ nào.', noMatch: 'Không có ngoại lệ nào khớp.',
			infoBadge: 'Để biết', showMore: (n) => `Hiện thêm ${n}`, view: 'Xem', fix: 'Sửa công', openDoc: 'Mở chứng từ', submit: 'Gửi duyệt', approve: 'Duyệt', reject: 'Từ chối',
			footer: 'Xử lý hết ngoại lệ rồi khóa công để chốt số liệu và chuyển sang bước tính lương.',
			docTypes: {leave: 'Đơn nghỉ', trip: 'Đơn công tác', ot: 'Đơn làm thêm', exception: 'Phiếu ngoại lệ'},
			status: {H: 'tạm giữ', P: 'chờ duyệt', A: 'đã duyệt'},
			sub: {late: (m) => `Đi trễ ${m} phút`, early: (m) => `Về sớm ${m} phút`, missingPunch: 'Thiếu lượt chấm vào hoặc ra', absent: 'Không có lượt chấm (vắng)', adjust: 'Điều chỉnh công'},
			days: (d) => `${num(d)} công`, fromPunches: 'hệ thống đề xuất từ chấm công',
			leave: (e) => `${e.leaveType ? `${e.leaveType} ` : ''}${fmtDate(e.from)}${e.to !== e.from ? ` - ${fmtDate(e.to)}` : ''}, ${num(e.days)} ngày`,
			trip: (e) => `${fmtDate(e.from)}${e.to !== e.from ? ` - ${fmtDate(e.to)}` : ''}, ${num(e.days)} ngày`,
			ot: (e) => `${num(e.hours)} giờ`,
			noSummary: 'Chưa có dòng trong bảng tổng hợp công của kỳ.',
			staleSummary: 'Bảng tổng hợp công cũ hơn chứng từ đã duyệt, cần tổng hợp lại.',
			noSheetRow: 'Chưa có dòng trong bảng công ký hiệu.',
			sheetMissing: (e) => `${e.count} ngày làm việc chưa nhập ký hiệu công.`,
			unknownSymbol: (e) => `${e.count} ô có ký hiệu không có trong danh mục: ${(e.codes || []).join(', ')}.`,
			pendingHours: (e) => `${num(e.hours)} giờ Time chưa được duyệt, chưa tính vào lương. Duyệt giờ ở màn Time của NetSuite.`,
			overStandard: (e) => `Công hưởng lương ${num(e.workDays)} lớn hơn công chuẩn ${num(e.standardDays)}.`,
			noHours: 'Cộng tác viên hưởng theo giờ chưa có giờ Time nào trong kỳ.',
		},
		panel: {
			day: 'Ngày đang chọn', noDay: 'Bấm một ô ngày trên lưới hoặc một dòng ở bảng dưới để xem chi tiết ngày.', symbol: 'Ký hiệu', value: 'Công tính', otHours: 'Làm thêm', hoursUnit: 'giờ',
			blank: '(trống)', docs: 'Chứng từ', noDocs: 'Không có chứng từ.', punches: 'Lượt chấm', noPunches: 'Không có lượt chấm.', shift: 'Ca', time: 'Giờ Time',
			edit: 'Sửa công ngày này', editSymbol: 'Sửa ký hiệu ngày này', timeSource: 'Giờ lấy từ bản ghi Time của NetSuite, không sửa ở đây.',
			totals: 'Tổng của kỳ', std: 'Công chuẩn', paidLeave: 'Nghỉ có lương', unpaid: 'Nghỉ không lương', si: 'Nghỉ BHXH trả', trip: 'Công tác', late: 'Trừ trễ sớm', adjust: 'Điều chỉnh', work: 'Công hưởng lương', ot: 'Giờ làm thêm',
			hours: 'Giờ đã nhận vào lương', pendingHours: 'Giờ chờ duyệt',
			tabs: {days: 'Theo ngày', docs: 'Chứng từ', punches: 'Lượt chấm', time: 'Giờ Time'},
			searchDays: 'Tìm ngày, thứ, ký hiệu', searchDocs: 'Tìm số, loại, trạng thái', searchPunches: 'Tìm ngày, giờ, thiết bị', searchTime: 'Tìm ngày, dự án, trạng thái',
			cols: {date: 'Ngày', dow: 'Thứ', symbol: 'Ký hiệu', value: 'Công', note: 'Ghi chú', doc: 'Số', type: 'Loại', range: 'Thời gian', qty: 'Số lượng', status: 'Trạng thái', time: 'Giờ', device: 'Thiết bị', hours: 'Số giờ', project: 'Dự án'},
			approval: {A: 'đã duyệt', P: 'chờ duyệt', R: 'từ chối', N: 'không dùng duyệt'},
			pendingNote: (n) => `${n} chứng từ chờ xử lý`, otNote: (h) => `làm thêm ${h} giờ`, lateNote: 'trễ / sớm', pendingHoursNote: (h) => `${h} giờ chờ duyệt`,
			legacyDocs: 'Lập đơn nghỉ, làm thêm, công tác',
		},
		edit: {
			titleE: (d) => `Điều chỉnh công ngày ${d}`, titleS: (d) => `Ký hiệu công ngày ${d}`, adjust: 'Điều chỉnh công (ngày)', adjustHint: 'Từ -1 đến 1. Ví dụ -0,5 là trừ nửa công, 1 là cộng một công.',
			reason: 'Lý do', symbol: 'Ký hiệu', empty: '(để trống)', save: 'Lưu', saveSubmit: 'Lưu và gửi duyệt', cancel: 'Hủy',
			noteE: 'Hệ thống lập phiếu ngoại lệ điều chỉnh công và gửi duyệt. Công của ngày đổi sau khi phiếu được duyệt và tổng hợp lại.',
			noteS: 'Ký hiệu lưu thẳng vào bảng công ký hiệu. Bấm Tổng hợp lại để cập nhật bảng tổng hợp công.',
		},
	},
	en: {
		crumb: 'Attendance',
		title: (code) => `Attendance for period ${code}`,
		titleNone: 'Attendance',
		periodCrumb: (code) => `Period ${code}`,
		period: 'Pay period',
		loading: 'Loading attendance...',
		working: 'Working...',
		noData: 'The attendance of the period could not be loaded. Check the message above, then click Refresh.',
		noSubsidiary: 'Select a subsidiary at the right of the tab bar.',
		reload: 'Refresh',
		legacy: 'Requests, punches, leave (previous screen)',
		more: 'More actions',
		sub: (p, n) => `Period ${fmtDate(p.start)} - ${fmtDate(p.end)} · Pay group ${p.paygroupName || p.paygroupCode} · Standard days: ${num(p.stdDays)} · Employees: ${n}`,
		modeE: 'Attendance from documents',
		modeS: 'Symbol attendance sheet',
		otherSubs: (n) => `Employees of other subsidiaries in this period: ${n} (not shown here, locked with the same period)`,
		status: {locked: 'Attendance locked', closed: 'Period closed', open: 'Open', openIssues: (n) => `Open, exceptions left: ${n}`},
		steps: {collect: 'Collect', exceptions: 'Resolve exceptions', lock: 'Lock attendance', handoff: 'Hand off to payroll'},
		stepsLabel: 'Attendance steps',
		stepNotes: {collect: 'punches, requests, attendance sheet', left: (n) => `${n} left`, locked: 'locked'},
		act: {
			build: 'Build attendance', rebuild: 'Rebuild', lock: 'Lock attendance', unlock: 'Unlock attendance', toPayroll: 'Go to payroll', punches: 'Process punches',
			loadSheet: 'Load employees into the sheet', readOnly: 'Your role can only view', lockedHint: 'Attendance of the period is locked', noUnlock: 'The period has a released payroll batch; it cannot be unlocked',
		},
		confirmLock: (n) => (n ? `${n} exceptions are still open: unapproved documents will not be counted.\n` : '') + 'Locking rebuilds the summary one last time, freezes the attendance of the period and locks approved attendance documents. Continue?',
		confirmUnlock: 'Unlock the attendance of this period? Work days may change; calculated payroll batches of the period must be recalculated.',
		done: {
			build: (r) => `Attendance built${r && r.employees !== undefined ? ` (employees: ${r.employees})` : ''}.`,
			lock: 'Attendance of the period is locked.', unlock: 'Attendance of the period is unlocked.',
			punches: (r) => `Punches processed. Proposed on hold, pending approval - exceptions: ${r.exceptions || 0}, overtime requests: ${r.overtime || 0}.`,
			loadSheet: (r) => `Employees loaded into the sheet: ${(r.added || []).length}.`,
			doc: {submit: 'Submitted.', approve: 'Approved.', reject: 'Rejected.'},
			saved: 'Attendance saved.', docCreated: 'The adjustment was created and submitted for approval.',
			docHeld: 'The adjustment was created (on hold). Submit it from the exception list.',
		},
		queued: 'The period has many employees, so the job runs in the background. Click Refresh in a few minutes.',
		cards: {
			issues: 'Open exceptions', none: 'No exceptions left', docs: 'Requests in the period', paid: 'Paid work days', ctv: 'Contractor hours', ot: 'Overtime hours',
			pendingDocs: (n) => `pending documents: ${n}`, rebuild: (n) => `to rebuild: ${n}`, sheet: (n) => `sheet rows: ${n}`, hours: (n) => `hours pending: ${n}`, info: (n) => `for information: ${n}`,
			leave: (n) => `leave: ${n}`, trip: (n) => `trips: ${n}`, otDocs: (n) => `overtime: ${n}`, exc: (n) => `exceptions: ${n}`, waiting: (n) => `pending: ${n}`, noDocs: 'no requests yet',
			employees: (n) => `employees: ${n}`, estimated: 'estimate, not built yet', accepted: 'accepted for payroll', pending: (h) => `hours pending approval: ${h}`, otNote: (n) => `overtime requests: ${n}`,
		},
		grid: {
			label: 'Monthly attendance', search: 'Search name, code, department, symbol', all: 'All', issues: 'With exceptions', employee: 'Employee',
			cols: {leave: 'Leave', unpaid: 'Unpaid', trip: 'Trip', ot: 'OT', paid: 'Days'},
			colTitles: {leave: 'Paid leave (days)', unpaid: 'Unpaid leave and social insurance leave (days)', trip: 'Business trip (days)', ot: 'Approved overtime hours', paid: 'Paid work days (contractors: hours)'},
			hours: (h) => `${h} h`, estimated: 'Estimate from documents, the summary is not built yet', stale: 'The summary is older than the documents; rebuild it',
			empty: 'No employee belongs to the pay group of this period.', noMatch: 'No matching employee.',
			shown: (a, b) => `Showing ${a} / ${b} employees`, showMore: (n) => `Show ${n} more`, matches: (n) => `Matching rows: ${n}`,
			hintE: 'Click a cell to see the day and edit attendance. Day cells are derived from the work calendar and approved documents; totals come from the attendance summary.',
			hintS: 'Click a cell to see the day and edit its symbol. Day cells are the symbols of the attendance sheet.',
			timeOff: 'Time Tracking is not enabled in this account, so contractor hours cannot be read.',
		},
		dow: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
		dowLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
		salary: {M: 'Monthly salary', D: 'Daily wage', H: 'Hourly wage'},
		contractor: 'Contractor',
		kinds: {W: 'worked', P: 'paid leave', U: 'unpaid leave', S: 'social insurance leave', T: 'business trip', N: 'not counted', holiday: 'public holiday', A: 'adjusted work day (days)', H: 'contractor hours', M: 'missing data', '?': 'invalid symbol', O: 'outside contract'},
		half: 'half day',
		legend: {label: 'Legend', pending: 'needs action', ot: 'overtime', late: 'late / early', off: 'weekly day off, holiday'},
		dayTypes: {N: 'Working day', W: 'Weekly day off', H: 'Public holiday'},
		exc: {
			title: (n) => `Exceptions to resolve (${n})`, search: 'Search employee, date, exception type', none: 'No exceptions.', noMatch: 'No matching exception.',
			infoBadge: 'For information', showMore: (n) => `Show ${n} more`, view: 'View', fix: 'Edit attendance', openDoc: 'Open document', submit: 'Submit', approve: 'Approve', reject: 'Reject',
			footer: 'Resolve all exceptions, then lock attendance to freeze the figures and move on to payroll.',
			docTypes: {leave: 'Leave request', trip: 'Business trip', ot: 'Overtime request', exception: 'Attendance exception'},
			status: {H: 'on hold', P: 'pending approval', A: 'approved'},
			sub: {late: (m) => `Late by ${m} min`, early: (m) => `Left ${m} min early`, missingPunch: 'Missing in or out punch', absent: 'No punches (absent)', adjust: 'Attendance adjustment'},
			days: (d) => `days: ${num(d)}`, fromPunches: 'proposed by the system from punches',
			leave: (e) => `${e.leaveType ? `${e.leaveType} ` : ''}${fmtDate(e.from)}${e.to !== e.from ? ` - ${fmtDate(e.to)}` : ''}, days: ${num(e.days)}`,
			trip: (e) => `${fmtDate(e.from)}${e.to !== e.from ? ` - ${fmtDate(e.to)}` : ''}, days: ${num(e.days)}`,
			ot: (e) => `${num(e.hours)} h`,
			noSummary: 'No row in the attendance summary of the period yet.',
			staleSummary: 'The attendance summary is older than the approved documents; rebuild it.',
			noSheetRow: 'No row in the symbol attendance sheet yet.',
			sheetMissing: (e) => `Working days without an attendance symbol: ${e.count}.`,
			unknownSymbol: (e) => `Cells with symbols missing from the catalog: ${e.count} (${(e.codes || []).join(', ')}).`,
			pendingHours: (e) => `Time hours not approved and not counted for payroll: ${num(e.hours)}. Approve them in NetSuite Time.`,
			overStandard: (e) => `Paid work days ${num(e.workDays)} exceed the standard ${num(e.standardDays)}.`,
			noHours: 'The hourly contractor has no Time hours in the period.',
		},
		panel: {
			day: 'Selected day', noDay: 'Click a day cell in the grid or a row in the table below to see the day.', symbol: 'Symbol', value: 'Work days', otHours: 'Overtime', hoursUnit: 'hours',
			blank: '(blank)', docs: 'Documents', noDocs: 'No documents.', punches: 'Punches', noPunches: 'No punches.', shift: 'Shift', time: 'Time hours',
			edit: 'Edit attendance of this day', editSymbol: 'Edit symbol of this day', timeSource: 'Hours come from NetSuite Time records and are not edited here.',
			totals: 'Period totals', std: 'Standard days', paidLeave: 'Paid leave', unpaid: 'Unpaid leave', si: 'Social insurance leave', trip: 'Business trip', late: 'Late / early deduction', adjust: 'Adjustment', work: 'Paid work days', ot: 'Overtime hours',
			hours: 'Hours accepted for payroll', pendingHours: 'Hours pending approval',
			tabs: {days: 'By day', docs: 'Documents', punches: 'Punches', time: 'Time hours'},
			searchDays: 'Search date, weekday, symbol', searchDocs: 'Search number, type, status', searchPunches: 'Search date, time, device', searchTime: 'Search date, project, status',
			cols: {date: 'Date', dow: 'Weekday', symbol: 'Symbol', value: 'Days', note: 'Note', doc: 'Number', type: 'Type', range: 'Dates', qty: 'Quantity', status: 'Status', time: 'Time', device: 'Device', hours: 'Hours', project: 'Project'},
			approval: {A: 'approved', P: 'pending', R: 'rejected', N: 'no approval'},
			pendingNote: (n) => `pending documents: ${n}`, otNote: (h) => `overtime ${h} h`, lateNote: 'late / early', pendingHoursNote: (h) => `hours pending approval: ${h}`,
			legacyDocs: 'Create leave, overtime, trip requests',
		},
		edit: {
			titleE: (d) => `Adjust attendance on ${d}`, titleS: (d) => `Attendance symbol on ${d}`, adjust: 'Adjustment (days)', adjustHint: 'From -1 to 1. For example -0.5 deducts half a day, 1 adds one day.',
			reason: 'Reason', symbol: 'Symbol', empty: '(blank)', save: 'Save', saveSubmit: 'Save and submit', cancel: 'Cancel',
			noteE: 'The system creates an attendance adjustment and submits it for approval. The day changes after approval and a rebuild.',
			noteS: 'The symbol is saved to the attendance sheet. Click Rebuild to update the attendance summary.',
		},
	},
};

// Số dòng nhân viên vẽ mỗi lần (lưới 31 cột: 60 dòng khoảng 2.200 ô); còn lại bấm "Hiện thêm" hoặc tìm
const ROW_STEP = 60;
const EXC_STEP = 20;
const GRID_ID = 's4vp-atd-grid';
const DAY_W = 30;
const NAME_W = 210;
const SUM_W = 56;
const RECORD_OF = {leave: 'leave_request', ot: 'ot_request', trip: 'business_trip', exception: 'att_exception'};

const CSS = `
.s4vp-atd-aside{flex:1 1 340px;max-width:420px;min-width:0;display:flex;flex-direction:column;gap:12px}
.s4vp-atd-aside .s4vp-side{flex:0 0 auto;max-width:none}
.s4vp-atd-bar{padding:12px 16px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between}
.s4vp-atd-bar-l{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0}
.s4vp-atd-legend{padding:0 16px 10px;display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--s4vp-sub);align-items:center}
.s4vp-atd-legend b{display:inline-block;min-width:20px;text-align:center;padding:1px 5px;border-radius:4px;color:var(--s4vp-text);font-weight:600;margin-right:4px}
.s4vp-atd-wrap{overflow:auto;max-height:520px;max-height:max(300px,calc(100vh - 190px));max-width:100%;border-top:1px solid var(--s4vp-line);border-bottom:1px solid var(--s4vp-line)}
.s4vp-atd{border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:100%}
.s4vp-atd th{position:sticky;top:0;z-index:2;background:#F7F8F9;font-size:11px;font-weight:600;color:var(--s4vp-sub);text-align:center;padding:5px 0;border-bottom:1px solid #D9DEE2;line-height:1.25;overflow:hidden;white-space:nowrap}
.s4vp-atd td{font-size:12px;text-align:center;padding:0;height:40px;border-bottom:1px solid var(--s4vp-line-soft);border-right:1px solid #F0F2F4;font-variant-numeric:tabular-nums;overflow:hidden;white-space:nowrap;color:var(--s4vp-text);cursor:pointer}
.s4vp-atd .s4vp-atd-l{position:sticky;left:0;z-index:1;background:var(--s4vp-surface);text-align:left;padding:3px 10px;border-right:1px solid #D9DEE2;text-overflow:ellipsis}
.s4vp-atd th.s4vp-atd-l{z-index:3;background:#F7F8F9;font-size:12px}
.s4vp-atd .s4vp-atd-s{text-align:right;padding:0 8px;border-left:1px solid #D9DEE2;border-right:0;font-size:13px}
.s4vp-atd th.s4vp-atd-s{font-size:11px;padding:5px 8px}
.s4vp-atd .s4vp-atd-b{font-weight:700}
.s4vp-atd .s4vp-atd-e{color:var(--s4vp-sub);font-style:italic}
.s4vp-atd .s4vp-atd-off{background:#ECEEF0;color:var(--s4vp-sub)}
.s4vp-atd tr:hover td.s4vp-atd-l{background:#F4F7F9}
.s4vp-atd tr.s4vp-sel td.s4vp-atd-l{background:#EAF2F5;box-shadow:inset 3px 0 0 var(--s4vp-accent)}
.s4vp-atd-name{display:block;overflow:hidden;text-overflow:ellipsis;font-size:13px;line-height:1.3}
.s4vp-atd-kind{display:block;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--s4vp-sub);line-height:1.3}
.s4vp-atd-n{display:inline-block;min-width:16px;padding:0 4px;margin-left:4px;border-radius:999px;font-size:11px;font-weight:700;color:var(--s4vp-warn);background:var(--s4vp-warn-bg)}
.s4vp-atd-kP{background:#DCEBFA;color:#0B4A8F;font-weight:600}
.s4vp-atd-kT{background:#E7E1F5;color:#4A2C8F;font-weight:600}
.s4vp-atd-kU{background:var(--s4vp-err-bg);color:var(--s4vp-err);font-weight:600}
.s4vp-atd-kS{background:#DDF0EC;color:#0E5A4E;font-weight:600}
.s4vp-atd-kA{background:var(--s4vp-accent-soft);color:var(--s4vp-accent-dark);font-weight:600}
.s4vp-atd-kM{background:#FFF6E5;color:var(--s4vp-warn)}
.s4vp-atd-kQ{background:var(--s4vp-err-bg);color:var(--s4vp-err);font-weight:700}
.s4vp-atd-kO{background:repeating-linear-gradient(135deg,#F3F4F2,#F3F4F2 4px,#E6E8EA 4px,#E6E8EA 8px)}
.s4vp-atd-p{background:var(--s4vp-warn-bg);color:var(--s4vp-warn);font-weight:700;outline:1px solid var(--s4vp-warn-line);outline-offset:-1px}
.s4vp-atd td.s4vp-atd-ot{border-bottom:3px solid var(--s4vp-accent)}
.s4vp-atd-late{box-shadow:inset 0 3px 0 var(--s4vp-warn-line)}
.s4vp-atd td.s4vp-atd-on{outline:2px solid var(--s4vp-accent);outline-offset:-2px}
.s4vp-atd-foot{padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;font-size:12px;color:var(--s4vp-sub)}
.s4vp-atd-excs{display:flex;flex-direction:column;gap:10px;max-height:560px;max-height:max(320px,calc(100vh - 240px));overflow-y:auto;min-width:0}
.s4vp-atd-exc{border:1px solid #F0D3A6;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;min-width:0}
.s4vp-atd-exc.s4vp-atd-info{border-color:var(--s4vp-line)}
.s4vp-atd-exc-t{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.s4vp-atd-exc-d{font-size:13px;color:var(--s4vp-sub);overflow-wrap:anywhere}
.s4vp-atd-day{border:1px solid var(--s4vp-accent);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.s4vp-atd-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:13px}
.s4vp-atd-facts span{display:block;color:var(--s4vp-sub)}
.s4vp-atd-facts b{font-size:16px}
`;

let cssDone = false;
function ensureGridCss() {
	try {
		if (cssDone) return;
		let st = document.getElementById('s4vp-css-atd');
		if (!st) {
			st = document.createElement('style');
			st.id = 's4vp-css-atd';
			document.head.appendChild(st);
		}
		st.textContent = CSS;
		cssDone = true;
	} catch (e) {
		// không có document (kiểm thử): bỏ qua
	}
}

const cx = (...names) => names.filter(Boolean).join(' ');
const shortDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : '');
const KIND_CLASS = {P: 's4vp-atd-kP', T: 's4vp-atd-kT', U: 's4vp-atd-kU', S: 's4vp-atd-kS', A: 's4vp-atd-kA', M: 's4vp-atd-kM', '?': 's4vp-atd-kQ', O: 's4vp-atd-kO'};
const TONE = {H: 'muted', P: 'warn', A: 'ok'};

/** Lớp CSS của một ô ngày: nhóm ký hiệu, cột ngày nghỉ, dấu chờ xử lý / làm thêm / trễ sớm, ô đang chọn. */
function cellClass(c, day, on) {
	const pending = c.p || c.hp;
	return cx(pending ? 's4vp-atd-p' : KIND_CLASS[c.k] || (day.type !== 'N' && !c.v && !c.h ? 's4vp-atd-off' : ''), c.ot ? 's4vp-atd-ot' : '', c.late ? 's4vp-atd-late' : '', on ? 's4vp-atd-on' : '');
}

/** Chữ trong ô: ký hiệu; ô chờ xử lý mà chưa có ký hiệu hiện "!". */
const cellText = (c) => (c.s === '' && (c.p || c.hp) ? '!' : c.k === 'M' ? '·' : c.s);

export default function AttendanceView({app}) {
	const t = pick(TEXT);
	ensureGridCss();
	const boot = app.boot || {};
	const subsidiary = app.subsidiary || '';
	const picked = String((app.route && app.route.params && app.route.params.period) || '');
	const [data, setData] = useState(null);
	const [loaded, setLoaded] = useState(false);
	const [query, setQuery] = useState('');
	const [chip, setChip] = useState('all');
	const [limit, setLimit] = useState(ROW_STEP);
	const [sel, setSel] = useState(null);
	const [detail, setDetail] = useState(null);
	const [tab, setTab] = useState('days');
	const [excQuery, setExcQuery] = useState('');
	const [excLimit, setExcLimit] = useState(EXC_STEP);
	const [edit, setEdit] = useState(null);
	const editRef = useRef({});
	const alive = useRef(true);
	const request = useRef(0);
	const detailRequest = useRef(0);
	const shownRef = useRef([]);
	const nativeAt = useRef(0);
	const pickRef = useRef(null);
	const renders = useRef(0);
	renders.current += 1;

	const load = () => {
		if (!subsidiary) return Promise.resolve();
		request.current += 1;
		const mine = request.current;
		return app.run(t.loading, call({action: 'attendanceMonth', period: picked, subsidiary})).then((r) => {
			// Bỏ kết quả về muộn (đã đổi kỳ, đổi công ty con hoặc đã rời màn)
			if (!alive.current || mine !== request.current) return;
			setLoaded(true);
			if (r && r.period && Array.isArray(r.rows)) {
				// Ô ngày về dạng nén (chỉ số vào cellTable): bung một lần khi nhận, các dòng dùng chung đối tượng ô
				const table = Array.isArray(r.cellTable) ? r.cellTable : [];
				r.rows.forEach((row) => (row.cells = (row.cells || []).map((c) => (typeof c === 'number' ? table[c] || {s: '', k: 'N'} : c))));
				setData(r);
			}
			else if (!r) setData(null);
		});
	};

	useEffect(() => {
		alive.current = true;
		setSel(null);
		setDetail(null);
		setLimit(ROW_STEP);
		setExcLimit(EXC_STEP);
		load();
		return () => {
			alive.current = false;
		};
	}, [subsidiary, picked]);

	// Lượt chấm, phân ca, giờ Time của nhân viên đang chọn: nạp một lần cho mỗi nhân viên
	const selEmployee = sel ? sel.employee : '';
	const periodId = data ? String(data.period.id) : '';
	useEffect(() => {
		if (!selEmployee || !periodId) return undefined;
		detailRequest.current += 1;
		const mine = detailRequest.current;
		call({action: 'attendanceEmployee', period: periodId, employee: selEmployee})
			.then((r) => {
				if (alive.current && mine === detailRequest.current) setDetail(Object.assign({employee: selEmployee}, r || {}));
			})
			.catch(() => {
				if (alive.current && mine === detailRequest.current) setDetail({employee: selEmployee, punches: [], roster: [], time: [], failed: true});
			});
		return undefined;
	}, [selEmployee, periodId]);

	// Bấm ô: một listener DOM trên khung lưới (không tạo handler cho từng ô). rowIndex / cellIndex là thuộc tính DOM chuẩn.
	pickRef.current = (rowIndex, cellIndex) => {
		const row = shownRef.current[rowIndex];
		if (!row || !data) return;
		const day = cellIndex >= 0 && cellIndex < data.days.length ? cellIndex : null;
		nativeAt.current = Date.now();
		setTab('days');
		setSel({employee: row.employee, day});
	};
	// Gắn lại sau mỗi lần vẽ (gán thuộc tính onclick nên không cộng dồn): khung lưới có thể vừa được tạo lại
	useEffect(() => {
		try {
			const el = document.getElementById(GRID_ID);
			if (!el) return undefined;
			el.onclick = (ev) => {
				try {
					const td = ev && ev.target && ev.target.closest ? ev.target.closest('td') : null;
					const tr = td ? td.parentNode : null;
					if (!td || !tr || !el.contains(td)) return;
					pickRef.current(tr.rowIndex - 1, td.cellIndex - 1);
				} catch (e) {
					// bỏ qua: onClick của dòng vẫn chọn được nhân viên
				}
			};
		} catch (e) {
			// không có DOM (kiểm thử)
		}
		return undefined;
	}, [renders.current]);

	// ------------------------------------------------------------------ chưa có dữ liệu

	const periods = Array.isArray(boot.periods) ? boot.periods : [];
	const groupSub = {};
	(boot.paygroups || []).forEach((g) => (groupSub[String(g.id)] = g.subsidiary ? String(g.subsidiary) : ''));
	const myPeriods = periods.filter((p) => !groupSub[String(p.paygroup)] || groupSub[String(p.paygroup)] === subsidiary);
	const periodOptions = (myPeriods.length ? myPeriods : periods).map((p) => ({value: String(p.id), label: `${p.code} (${fmtDate(p.start)} - ${fmtDate(p.end)})`}));
	const current = picked || periodId;
	const periodSelect = <Select value={current} onInput={(v) => v && v !== current && app.go('attendance', {period: v})} options={periodOptions} placeholder={current ? null : t.period} ariaLabel={t.period} width={250} />;
	const legacyItem = {label: t.legacy, onClick: () => app.go('attendanceLegacy')};

	if (!data) {
		return (
			<Page>
				<PageHeader title={t.titleNone} actions={[periodSelect, <Menu label={t.more} align="right" items={[legacyItem]} />, <Button label={t.reload} kind="primary" disabled={!subsidiary || !!app.busy} onClick={() => load()} />]} />
				<Card>
					<Empty text={!subsidiary ? t.noSubsidiary : loaded ? t.noData : t.loading} />
				</Card>
			</Page>
		);
	}

	// ------------------------------------------------------------------ dữ liệu suy ra

	const period = data.period;
	const days = data.days || [];
	const rows = data.rows || [];
	const exceptions = data.exceptions || [];
	const counts = data.counts || {open: 0, info: 0, byType: {}};
	const stats = data.stats || {};
	const locked = !!data.locked;
	const sheetMode = period.mode === 'S';
	const canEdit = !!data.canEdit && !locked && !data.closed;
	const busy = !!app.busy;
	const rowOf = {};
	rows.forEach((r) => (rowOf[r.employee] = r));
	const symbolOf = {};
	(data.symbols || []).forEach((s) => (symbolOf[String(s.code).toUpperCase()] = s));
	const empLabel = (id) => (rowOf[id] ? `${rowOf[id].code} ${rowOf[id].name}`.trim() : String(id));
	const dayLabel = (i) => (days[i] ? `${t.dowLong[days[i].dow]}, ${shortDate(days[i].date)}` : '');
	const kindOf = (r) => (r.contractor ? `${t.contractor}${r.salaryType === 'H' ? ` · ${t.salary.H}` : ''}` : t.salary[r.salaryType] || '');
	const kindLabel = (c) => {
		if (c.k === 'N') return c.s ? t.kinds.holiday : t.kinds.N;
		const sym = symbolOf[String(c.s).toUpperCase()];
		const half = sym ? Number(sym.days) === 0.5 : /\/2$/.test(c.s);
		return `${t.kinds[c.k] || ''}${half && 'WPUST'.indexOf(c.k) >= 0 ? ` (${t.half})` : ''}`;
	};

	// ------------------------------------------------------------------ thao tác

	const after = (r, text) => {
		if (!r) return r;
		if (r.queued) app.notify(t.queued, 'warn');
		else if (text) app.notify(text, 'ok');
		if (alive.current) load();
		return r;
	};
	const periodAction = (action, done, reboot) => () =>
		app.run(t.working, post({action, id: period.id})).then((r) => {
			if (r && reboot) app.reloadBoot();
			return after(r, r ? (typeof done === 'function' ? done(r) : done) : '');
		});
	const build = periodAction('buildAttendance', t.done.build);
	const lock = () => app.confirm(t.confirmLock(counts.open), periodAction('lockAttendance', t.done.lock, true));
	const unlock = () => app.confirm(t.confirmUnlock, periodAction('unlockAttendance', t.done.unlock, true));
	const processPunches = periodAction('processPunches', t.done.punches);
	const loadSheet = periodAction('loadSheetEmployees', t.done.loadSheet);
	const warnText = (r) => (r && Array.isArray(r.warnings) && r.warnings.length ? r.warnings.map((w) => (app.lang === 'en' ? w.message : w.messageVi || w.message)).join('; ') : '');
	const docAct = (e, op) =>
		app.run(t.working, post({action: 'docAction', type: e.docType || e.type, id: e.docId || e.id, op})).then((r) => {
			if (!r) return;
			const w = warnText(r);
			if (w) app.notify(w, 'warn');
			else app.notify(t.done.doc[op] || '', 'ok');
			if (alive.current) load();
		});
	const select = (employee, day) => {
		if (!rowOf[employee]) return;
		setTab('days');
		setSel({employee, day: day === undefined || day === null ? null : day});
	};

	// Sửa công một ngày: nhóm bảng công ký hiệu lưu ô (saveSheet); nhóm theo chứng từ lập phiếu ngoại lệ điều chỉnh rồi gửi duyệt
	const openEdit = (employee, day) => {
		const row = rowOf[employee];
		if (!row || day === null || day === undefined || !days[day]) return;
		editRef.current = sheetMode ? {symbol: row.cells[day].k === 'O' ? '' : row.cells[day].s} : {adjust: '', reason: ''};
		setEdit({employee, day, values: editRef.current});
	};
	const setEditField = (k) => (v) => {
		editRef.current = Object.assign({}, editRef.current, {[k]: v});
		setEdit(Object.assign({}, edit, {values: editRef.current}));
	};
	const saveEdit = () => {
		const row = rowOf[edit.employee];
		const v = editRef.current;
		if (!row) return;
		if (sheetMode) {
			const cells = row.cells.map((c, i) => (i === edit.day ? String(v.symbol || '') : c.s));
			app.run(t.working, post({action: 'saveSheet', period: period.id, employee: row.employee, cells})).then((r) => {
				if (!r || !alive.current) return;
				setEdit(null);
				after(r, t.done.saved);
			});
			return;
		}
		const adjust = toNumber(v.adjust);
		if (adjust === null || !String(v.reason || '').trim()) return;
		const values = {employee: row.employee, subsidiary, work_date: days[edit.day].date, exception_type: 'A', adjust_days: adjust, reason: String(v.reason).trim()};
		app.run(t.working, post({action: 'saveDoc', type: 'exception', values})).then((r) => {
			if (!r || !r.id) return;
			if (alive.current) setEdit(null);
			// Gửi duyệt ngay; nếu lỗi thì phiếu còn tạm giữ và hiện ở danh sách ngoại lệ để gửi lại
			return app.run(t.working, post({action: 'docAction', type: 'exception', id: r.id, op: 'submit'})).then((s) => {
				app.notify(s ? t.done.docCreated : t.done.docHeld, s ? 'ok' : 'warn');
				if (alive.current) load();
			});
		});
	};

	// ------------------------------------------------------------------ tiêu đề, bước, thẻ số liệu

	const steps = (data.steps || []).map((s) => {
		const out = {key: s.key, label: t.steps[s.key] || s.key, state: s.state};
		if (s.key === 'collect' && s.state !== 'done') out.note = t.stepNotes.collect;
		if (s.note === 'openExceptions' && s.count) {
			out.note = t.stepNotes.left(s.count);
			out.noteTone = 'warn';
		}
		if (s.note === 'locked') {
			out.note = t.stepNotes.locked;
			out.noteTone = 'ok';
		}
		return out;
	});
	const cur = (data.steps || []).find((s) => s.state === 'current');
	const curKey = cur ? cur.key : 'done';
	const noSheet = sheetMode && rows.length > 0 && rows.every((r) => r.source !== 'sheet' || !r.hasSheet);
	const editTitle = !data.canEdit ? t.act.readOnly : locked ? t.act.lockedHint : '';
	let primary;
	if (locked || curKey === 'handoff' || curKey === 'done') primary = <Button label={t.act.toPayroll} kind="primary" onClick={() => app.go('payrollList')} />;
	else if (curKey === 'collect' && noSheet) primary = <Button label={t.act.loadSheet} kind="primary" disabled={!canEdit || busy} title={editTitle} onClick={loadSheet} />;
	else if (curKey === 'collect') primary = <Button label={t.act.build} kind="primary" disabled={!canEdit || busy || !rows.length} title={editTitle} onClick={build} />;
	else primary = <Button label={t.act.lock} kind="primary" disabled={!canEdit || busy} title={editTitle} onClick={lock} />;
	const showRebuild = !locked && curKey !== 'collect';
	const menuItems = [
		{label: t.act.punches, onClick: processPunches, disabled: !canEdit || busy, title: editTitle},
		sheetMode ? {label: t.act.loadSheet, onClick: loadSheet, disabled: !canEdit || busy, title: editTitle} : null,
		locked ? {label: t.act.unlock, onClick: unlock, disabled: !data.canEdit || !data.canUnlock || data.closed || busy, title: !data.canEdit ? t.act.readOnly : !data.canUnlock ? t.act.noUnlock : ''} : null,
		legacyItem,
		{label: t.reload, onClick: () => load(), disabled: busy},
	];
	const status = locked ? {text: t.status.locked, tone: 'ok'} : data.closed ? {text: t.status.closed, tone: 'muted'} : counts.open ? {text: t.status.openIssues(counts.open), tone: 'warn'} : {text: t.status.open, tone: 'info'};
	const subLine = [t.sub(period, rows.length), sheetMode ? t.modeS : t.modeE].join(' · ');

	const by = counts.byType || {};
	const sumOf = (keys) => keys.reduce((a, k) => a + (by[k] || 0), 0);
	const pendingDocs = sumOf(['pendingDoc.leave', 'pendingDoc.trip', 'pendingDoc.ot', 'pendingDoc.exception']);
	const issueNote = [
		pendingDocs ? t.cards.pendingDocs(pendingDocs) : '',
		sumOf(['staleSummary', 'noSummary']) ? t.cards.rebuild(sumOf(['staleSummary', 'noSummary'])) : '',
		sumOf(['noSheetRow', 'sheetMissing', 'unknownSymbol']) ? t.cards.sheet(sumOf(['noSheetRow', 'sheetMissing', 'unknownSymbol'])) : '',
		stats.contractorPending ? t.cards.hours(num(stats.contractorPending)) : '',
		counts.info ? t.cards.info(counts.info) : '',
	].filter(Boolean).join(' · ');
	const sd = stats.docs || {};
	const docTotal = (sd.leave || 0) + (sd.trip || 0) + (sd.ot || 0) + (sd.exception || 0);
	const docNote = [sd.leave ? t.cards.leave(sd.leave) : '', sd.trip ? t.cards.trip(sd.trip) : '', sd.ot ? t.cards.otDocs(sd.ot) : '', sd.exception ? t.cards.exc(sd.exception) : '', sd.pending ? t.cards.waiting(sd.pending) : ''].filter(Boolean).join(' · ');
	const cards = [
		{key: 'issues', label: t.cards.issues, value: String(counts.open || 0), note: issueNote || t.cards.none, tone: counts.open ? 'warn' : 'ok'},
		{key: 'docs', label: t.cards.docs, value: String(docTotal), note: docNote || t.cards.noDocs},
		{key: 'paid', label: t.cards.paid, value: `${num(stats.workDays || 0)} / ${num(stats.standardDays || 0)}`, note: [t.cards.employees(stats.summaryEmployees || 0), stats.estimated ? t.cards.estimated : ''].filter(Boolean).join(' · ')},
		stats.contractors ? {key: 'ctv', label: t.cards.ctv, value: num(stats.contractorHours || 0), note: [t.cards.accepted, stats.contractorPending ? t.cards.pending(num(stats.contractorPending)) : ''].filter(Boolean).join(' · ')} : null,
		{key: 'ot', label: t.cards.ot, value: num(stats.otHours || 0), note: t.cards.otNote(sd.ot || 0)},
	];

	// ------------------------------------------------------------------ lưới tháng

	const words = fold(query).split(/\s+/).filter(Boolean);
	const rowText = (r) => fold(`${r.code} ${r.name} ${r.department} ${kindOf(r)} ${[...new Set(r.cells.map((c) => c.s).filter((s) => s && isNaN(Number(String(s).replace(',', '.')))))].join(' ')}`);
	const withIssues = rows.filter((r) => r.open > 0).length;
	let filtered = chip === 'issues' ? rows.filter((r) => r.open > 0) : rows;
	if (words.length) {
		try {
			filtered = filtered.filter((r) => {
				const text = rowText(r);
				return words.every((w) => text.indexOf(w) >= 0);
			});
		} catch (e) {
			// lỗi khi lọc: giữ nguyên danh sách
		}
	}
	const shown = filtered.slice(0, limit);
	shownRef.current = shown;
	const tableWidth = NAME_W + days.length * DAY_W + 5 * SUM_W;
	const sumCell = (key, v, cls, title) => {
		const a = {class: cx('s4vp-atd-s', cls)};
		if (title) a.title = title;
		return (
			<td key={key} {...a}>
				{v}
			</td>
		);
	};
	const dash = (v) => (v ? num(v) : '-');
	const cellTitle = (c, i) => {
		const parts = [];
		if (c.k !== 'W' && c.k !== 'N' && c.k !== 'H') parts.push(kindLabel(c));
		if (c.ot) parts.push(t.panel.otNote(num(c.ot)));
		if (c.late) parts.push(t.panel.lateNote);
		if (c.p) parts.push(t.panel.pendingNote(c.p));
		if (c.hp) parts.push(t.panel.pendingHoursNote(num(c.hp)));
		return parts.length ? `${dayLabel(i)}: ${parts.join('; ')}` : '';
	};
	const rowClick = (r) => () => {
		// Listener DOM của khung lưới vừa nhận lượt bấm này (biết cả ô ngày): không ghi đè
		if (Date.now() - nativeAt.current < 300) return;
		select(r.employee, null);
	};

	const grid = (
		<div id={GRID_ID} class="s4vp-atd-wrap">
			<table class="s4vp-atd" aria-label={t.grid.label} style={{width: `${tableWidth}px`}}>
				<thead>
					<tr>
						<th class="s4vp-atd-l" style={{width: `${NAME_W}px`}}>{t.grid.employee}</th>
						{days.map((d, i) => {
							const a = {class: d.type !== 'N' ? 's4vp-atd-off' : '', style: {width: `${DAY_W}px`}, title: `${t.dowLong[d.dow]}, ${fmtDate(d.date)}${d.type === 'H' ? ` - ${d.name || t.dayTypes.H}` : ''}`};
							if (!a.class) delete a.class;
							return (
								<th key={`h${i}`} {...a}>
									<div>{t.dow[d.dow]}</div>
									<div>{String(d.day)}</div>
								</th>
							);
						})}
						{['leave', 'unpaid', 'trip', 'ot', 'paid'].map((k) => (
							<th key={`s${k}`} class="s4vp-atd-s" style={{width: `${SUM_W}px`}} title={t.grid.colTitles[k]}>
								{t.grid.cols[k]}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{shown.length ? null : (
						<tr key="s4vp-none">
							<td colSpan={String(days.length + 6)} style={{cursor: 'default', height: 'auto', textAlign: 'left'}}>
								<Empty text={rows.length ? t.grid.noMatch : t.grid.empty} />
							</td>
						</tr>
					)}
					{shown.map((r) => {
						const on = sel && sel.employee === r.employee;
						const tr = {onClick: rowClick(r)};
						if (on) tr.class = 's4vp-sel';
						const tt = r.totals || null;
						const note = r.estimated ? t.grid.estimated : r.stale && !r.locked ? t.grid.stale : '';
						return (
							<tr key={`e${r.employee}`} {...tr}>
								<td class="s4vp-atd-l" title={`${r.code} ${r.name}${r.department ? ` - ${r.department}` : ''}`}>
									<button type="button" class="s4vp-rowbtn">
										<span class="s4vp-atd-name">
											<span class="s4vp-link">{r.code}</span>
											{` ${r.name}`}
											{r.open ? <span class="s4vp-atd-n">{String(r.open)}</span> : null}
										</span>
										<span class="s4vp-atd-kind">{[kindOf(r), r.department].filter(Boolean).join(' · ')}</span>
									</button>
								</td>
								{r.cells.map((c, i) => {
									const a = {};
									const cls = cellClass(c, days[i] || {type: 'N'}, on && sel.day === i);
									if (cls) a.class = cls;
									const title = cellTitle(c, i);
									if (title) a.title = title;
									return (
										<td key={`d${i}`} {...a}>
											{cellText(c)}
										</td>
									);
								})}
								{tt
									? [
											sumCell('s1', dash(tt.paid_leave)),
											sumCell('s2', dash((tt.unpaid_leave || 0) + (tt.si_leave || 0))),
											sumCell('s3', dash(tt.trip_days)),
											sumCell('s4', dash(tt.ot_hours)),
											sumCell('s5', num(tt.work_days || 0), r.estimated || (r.stale && !r.locked) ? 's4vp-atd-e' : 's4vp-atd-b', note),
										]
									: [sumCell('s1', '-'), sumCell('s2', '-'), sumCell('s3', '-'), sumCell('s4', '-'), sumCell('s5', t.grid.hours(num(r.hours || 0)), 's4vp-atd-b', r.pendingHours ? t.panel.pendingHoursNote(num(r.pendingHours)) : '')]}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);

	const legendItems = (data.legend && data.legend.items) || [];
	const legend = (
		<div class="s4vp-atd-legend" aria-label={t.legend.label}>
			{legendItems.map((it, i) => (
				<span key={`l${i}`}>
					<b class={KIND_CLASS[it.k] || ''}>{it.s || (it.k === 'A' ? '0,5' : it.k === 'H' ? '8' : it.k === 'M' ? '·' : it.k === '?' ? '?' : '')}</b>
					{kindLabel(it)}
				</span>
			))}
			{data.legend && data.legend.pending ? (
				<span key="lp">
					<b class="s4vp-atd-p">!</b>
					{t.legend.pending}
				</span>
			) : null}
			{data.legend && data.legend.ot ? (
				<span key="lo">
					<b style={{borderBottom: '3px solid #24566B', borderRadius: '0'}}>X</b>
					{t.legend.ot}
				</span>
			) : null}
			{data.legend && data.legend.late ? (
				<span key="ll">
					<b class="s4vp-atd-late" style={{borderRadius: '0'}}>X</b>
					{t.legend.late}
				</span>
			) : null}
			<span key="lw">
				<b class="s4vp-atd-off">{' '}</b>
				{t.legend.off}
			</span>
		</div>
	);

	const gridCard = (
		<Card flush={true} label={t.grid.label}>
			<div class="s4vp-atd-bar">
				<div class="s4vp-atd-bar-l">
					<SearchBox
						value={query}
						onInput={(v) => {
							setQuery(v);
							setLimit(ROW_STEP);
						}}
						placeholder={t.grid.search}
						width={300}
					/>
					<Chips
						items={[{value: 'all', label: t.grid.all, count: rows.length}, {value: 'issues', label: t.grid.issues, count: withIssues, tone: 'warn'}]}
						value={chip}
						onPick={(v) => {
							setChip(v);
							setLimit(ROW_STEP);
						}}
						label={t.grid.label}
					/>
					{words.length ? <span class="s4vp-small">{t.grid.matches(filtered.length)}</span> : null}
				</div>
			</div>
			{legend}
			{grid}
			<div class="s4vp-atd-foot">
				<span>{[sheetMode ? t.grid.hintS : t.grid.hintE, data.timeUnavailable ? t.grid.timeOff : '', data.otherSubsidiaries ? `${t.otherSubs(data.otherSubsidiaries)}.` : ''].filter(Boolean).join(' ')}</span>
				{filtered.length > shown.length ? (
					<span class="s4vp-actions">
						<span>{t.grid.shown(shown.length, filtered.length)}</span>
						<Button small={true} label={t.grid.showMore(Math.min(ROW_STEP, filtered.length - shown.length))} onClick={() => setLimit(limit + ROW_STEP)} />
					</span>
				) : null}
			</div>
		</Card>
	);

	// ------------------------------------------------------------------ ngoại lệ

	const docLine = (e) => {
		const type = e.docType || e.type;
		const head = `${t.exc.docTypes[type] || type}${e.docName || e.name ? ` ${e.docName || e.name}` : ''} (${t.exc.status[e.status] || e.status})`;
		let body;
		if (type === 'leave') body = t.exc.leave(e);
		else if (type === 'trip') body = t.exc.trip(e);
		else if (type === 'ot') body = t.exc.ot(e);
		else {
			const s = t.exc.sub[e.subtype];
			body = [typeof s === 'function' ? s(e.minutes || 0) : s || '', e.days ? t.exc.days(e.days) : ''].filter(Boolean).join(', ');
		}
		return `${head}: ${body}${e.fromPunches ? ` - ${t.exc.fromPunches}` : ''}.`;
	};
	const excText = (e) => {
		if (e.type === 'pendingDoc') return docLine(e);
		const f = t.exc[e.type];
		return typeof f === 'function' ? f(e) : f || e.type;
	};
	const excTitle = (e) => `${empLabel(e.employee)}${e.dayIndex !== undefined && e.dayIndex !== null ? ` · ${dayLabel(e.dayIndex)}` : ''}`;
	const docButtons = (e) => {
		const type = e.docType || e.type;
		const id = e.docId || e.id;
		const out = [];
		if (e.status === 'H') out.push(<Button small={true} kind="primary" label={t.exc.submit} disabled={!canEdit || busy} title={editTitle} onClick={() => docAct(e, 'submit')} />);
		if (e.status === 'P') {
			out.push(<Button small={true} kind="primary" label={t.exc.approve} disabled={!canEdit || busy} title={editTitle} onClick={() => docAct(e, 'approve')} />);
			out.push(<Button small={true} label={t.exc.reject} disabled={!data.canEdit || busy} onClick={() => docAct(e, 'reject')} />);
		}
		out.push(<Button small={true} kind="ghost" label={t.exc.openDoc} onClick={() => openRecord(`customrecord_s4vp_${RECORD_OF[type]}`, id)} />);
		return out;
	};
	const excButtons = (e) => {
		const view = <Button small={true} kind={e.type === 'pendingDoc' ? 'ghost' : 'default'} label={t.exc.view} onClick={() => select(e.employee, e.dayIndex)} />;
		if (e.type === 'pendingDoc') return docButtons(e).concat([view]);
		if (e.type === 'noSummary' || e.type === 'staleSummary') return [<Button small={true} kind="primary" label={t.act.rebuild} disabled={!canEdit || busy} title={editTitle} onClick={build} />, view];
		if (e.type === 'noSheetRow') return [<Button small={true} kind="primary" label={t.act.loadSheet} disabled={!canEdit || busy} title={editTitle} onClick={loadSheet} />, view];
		if (e.type === 'sheetMissing' || e.type === 'unknownSymbol')
			return [
				<Button
					small={true}
					kind="primary"
					label={t.exc.fix}
					disabled={!canEdit || busy}
					title={editTitle}
					onClick={() => {
						select(e.employee, e.dayIndex);
						openEdit(e.employee, e.dayIndex);
					}}
				/>,
				view,
			];
		return [view];
	};
	const excWords = fold(excQuery).split(/\s+/).filter(Boolean);
	const excAll = exceptions.map((e) => ({e, title: excTitle(e), text: excText(e)}));
	const excFiltered = excWords.length ? excAll.filter((x) => excWords.every((w) => fold(`${x.title} ${x.text} ${x.e.date ? fmtDate(x.e.date) : ''}`).indexOf(w) >= 0)) : excAll;
	const excShown = excFiltered.slice(0, excLimit);
	const excCard = exceptions.length ? (
		<Card title={t.exc.title(counts.open || 0)} tone={counts.open ? 'warn' : ''}>
			<SearchBox value={excQuery} onInput={(v) => (setExcQuery(v), setExcLimit(EXC_STEP))} placeholder={t.exc.search} width="100%" />
			<div class="s4vp-atd-excs">
				{excShown.map((x) => (
					<div key={x.e.key} class={cx('s4vp-atd-exc', x.e.severity === 'info' ? 's4vp-atd-info' : '')}>
						<div class="s4vp-atd-exc-t">
							{x.title}
							{x.e.severity === 'info' ? <span style={{marginLeft: '8px'}}>{Badge({text: t.exc.infoBadge, tone: 'muted'})}</span> : null}
						</div>
						<div class="s4vp-atd-exc-d">{x.text}</div>
						<div class="s4vp-actions">{excButtons(x.e).map((b, i) => <span key={`b${i}`} style={{display: 'contents'}}>{b}</span>)}</div>
					</div>
				))}
				{excShown.length ? null : <Empty text={t.exc.noMatch} />}
				{excFiltered.length > excShown.length ? <Button block={true} label={t.exc.showMore(Math.min(EXC_STEP, excFiltered.length - excShown.length))} onClick={() => setExcLimit(excLimit + EXC_STEP)} /> : null}
			</div>
			{locked ? null : <div class="s4vp-small">{t.exc.footer}</div>}
		</Card>
	) : null;

	// ------------------------------------------------------------------ khung chi tiết nhân viên / ô đang chọn

	const selRow = sel ? rowOf[sel.employee] : null;
	let panel = null;
	if (selRow) {
		const myDetail = detail && detail.employee === selRow.employee ? detail : null;
		const myDocs = (data.docs || []).filter((d) => d.employee === selRow.employee);
		const docsOn = (date) => myDocs.filter((d) => d.from <= date && (d.to || d.from) >= date);
		const docQty = (d) => (d.type === 'ot' ? t.exc.ot(d) : d.type === 'exception' ? (d.subtype === 'late' || d.subtype === 'early' ? `${d.minutes || 0}' (${num(d.days)})` : num(d.days)) : num(d.days));
		const noteOf = (c) => [c.k !== 'W' && c.k !== 'N' && c.k !== 'H' ? kindLabel(c) : c.k === 'N' && c.s ? t.kinds.holiday : '', c.ot ? t.panel.otNote(num(c.ot)) : '', c.late ? t.panel.lateNote : '', c.p ? t.panel.pendingNote(c.p) : '', c.hp ? t.panel.pendingHoursNote(num(c.hp)) : ''].filter(Boolean).join('; ');
		const dayRows = selRow.cells.map((c, i) => ({id: String(i), day: `${t.dow[days[i].dow]} ${shortDate(days[i].date)}`, date: fmtDate(days[i].date), dow: t.dowLong[days[i].dow], symbol: cellText(c), value: c.v === undefined ? (c.h !== undefined ? num(c.h + (c.hp || 0)) : '') : num(c.v), note: noteOf(c)}));
		const tt = selRow.totals;
		const line = (label, v, bold) => (
			<div class="s4vp-line">
				<span>{label}</span>
				<span class="s4vp-num" style={bold ? {fontWeight: '700'} : {}}>{v}</span>
			</div>
		);
		let dayBlock = <div class="s4vp-small">{t.panel.noDay}</div>;
		if (sel.day !== null && sel.day !== undefined && days[sel.day] && selRow.cells[sel.day]) {
			const d = days[sel.day];
			const c = selRow.cells[sel.day];
			const dayDocs = docsOn(d.date);
			const punches = myDetail ? (myDetail.punches || []).filter((p) => p.date === d.date) : [];
			const shift = myDetail ? (myDetail.roster || []).find((x) => x.date === d.date) : null;
			const entries = myDetail ? (myDetail.time || []).filter((x) => x.date === d.date) : [];
			const editable = canEdit && selRow.source !== 'time' && c.k !== 'O';
			dayBlock = (
				<div class="s4vp-atd-day">
					<div class="s4vp-line">
						<b>{`${t.panel.day}: ${dayLabel(sel.day)}`}</b>
						<span class="s4vp-small">{d.type === 'H' ? d.name || t.dayTypes.H : t.dayTypes[d.type] || ''}</span>
					</div>
					<div class="s4vp-atd-facts">
						<div>
							<span>{t.panel.symbol}</span>
							<b>{cellText(c) || t.panel.blank}</b>
						</div>
						<div>
							<span>{selRow.source === 'time' ? t.panel.time : t.panel.value}</span>
							<b>{selRow.source === 'time' ? num((c.h || 0) + (c.hp || 0)) : c.v === undefined ? '-' : num(c.v)}</b>
						</div>
						<div>
							<span>{t.panel.otHours}</span>
							<b>{c.ot ? `${num(c.ot)} ${t.panel.hoursUnit}` : '-'}</b>
						</div>
					</div>
					{noteOf(c) ? <div class="s4vp-small">{noteOf(c)}</div> : null}
					{shift && shift.shift ? <div class="s4vp-small">{`${t.panel.shift}: ${shift.shift}${shift.start ? ` ${shift.start} - ${shift.end}` : ''}`}</div> : null}
					{myDetail && selRow.source !== 'time' ? <div class="s4vp-small">{`${t.panel.punches}: ${punches.length ? punches.map((p) => p.time).join(', ') : t.panel.noPunches}`}</div> : null}
					{entries.length ? <div class="s4vp-small">{`${t.panel.time}: ${entries.map((x) => `${num(x.hours)} (${t.panel.approval[x.approval] || x.approval}${x.projectName ? `, ${x.projectName}` : ''})`).join('; ')}`}</div> : null}
					{dayDocs.map((doc) => (
						<div key={`${doc.type}${doc.id}`} class="s4vp-atd-exc s4vp-atd-info">
							<div class="s4vp-atd-exc-d">{docLine(doc)}</div>
							<div class="s4vp-actions">{docButtons(doc).map((b, i) => <span key={`b${i}`} style={{display: 'contents'}}>{b}</span>)}</div>
						</div>
					))}
					{selRow.source === 'time' ? <div class="s4vp-small">{t.panel.timeSource}</div> : null}
					{selRow.source !== 'time' ? (
						<div class="s4vp-actions">
							<Button small={true} label={sheetMode ? t.panel.editSymbol : t.panel.edit} disabled={!editable || busy} title={editTitle} onClick={() => openEdit(selRow.employee, sel.day)} />
							{sheetMode ? null : <Button small={true} kind="ghost" label={t.panel.legacyDocs} onClick={() => app.go('attendanceLegacy')} />}
						</div>
					) : null}
				</div>
			);
		}
		const tabs = [{value: 'days', label: t.panel.tabs.days}, {value: 'docs', label: t.panel.tabs.docs, count: myDocs.length}].concat(
			selRow.source === 'time' ? [{value: 'time', label: t.panel.tabs.time, count: myDetail ? (myDetail.time || []).length : null}] : [{value: 'punches', label: t.panel.tabs.punches, count: myDetail ? (myDetail.punches || []).length : null}]
		);
		const activeTab = tabs.some((x) => x.value === tab) ? tab : 'days';
		let tabBody;
		if (activeTab === 'docs') {
			tabBody = (
				<Table
					columns={[
						{key: 'name', label: t.panel.cols.doc, nowrap: true, noRowClick: true, render: (r) => <Button kind="link" label={r.name || r.id} onClick={() => openRecord(`customrecord_s4vp_${RECORD_OF[r.type]}`, r.id)} />},
						{key: 'typeText', label: t.panel.cols.type},
						{key: 'range', label: t.panel.cols.range, nowrap: true},
						{key: 'qty', label: t.panel.cols.qty, align: 'right', nowrap: true},
						{key: 'statusText', label: t.panel.cols.status, nowrap: true, render: (r) => <Badge text={r.statusText} tone={TONE[r.status] || 'muted'} />},
					]}
					rows={myDocs.map((d) => Object.assign({}, d, {key: `${d.type}${d.id}`, typeText: t.exc.docTypes[d.type] || d.type, range: `${shortDate(d.from)}${d.to && d.to !== d.from ? ` - ${shortDate(d.to)}` : ''}`, qty: docQty(d), statusText: t.exc.status[d.status] || d.status}))}
					keyOf={(r) => r.key}
					search={true}
					searchPlaceholder={t.panel.searchDocs}
					empty={t.panel.noDocs}
					maxHeight={300}
				/>
			);
		} else if (activeTab === 'punches') {
			tabBody = (
				<Table
					columns={[{key: 'dateText', label: t.panel.cols.date, nowrap: true}, {key: 'time', label: t.panel.cols.time, nowrap: true}, {key: 'device', label: t.panel.cols.device}]}
					rows={((myDetail && myDetail.punches) || []).map((p, i) => Object.assign({}, p, {id: `p${i}`, dateText: fmtDate(p.date)}))}
					search={true}
					searchPlaceholder={t.panel.searchPunches}
					empty={myDetail ? t.panel.noPunches : t.loading}
					maxHeight={300}
				/>
			);
		} else if (activeTab === 'time') {
			tabBody = (
				<Table
					columns={[{key: 'dateText', label: t.panel.cols.date, nowrap: true}, {key: 'hours', label: t.panel.cols.hours, type: 'num'}, {key: 'statusText', label: t.panel.cols.status, nowrap: true}, {key: 'projectName', label: t.panel.cols.project}]}
					rows={((myDetail && myDetail.time) || []).map((x, i) => Object.assign({}, x, {id: `t${i}`, dateText: fmtDate(x.date), statusText: t.panel.approval[x.approval] || x.approval}))}
					search={true}
					searchPlaceholder={t.panel.searchTime}
					empty={myDetail ? t.panel.noDocs : t.loading}
					maxHeight={300}
				/>
			);
		} else {
			tabBody = (
				<Table
					columns={[{key: 'day', label: t.panel.cols.date, nowrap: true}, {key: 'symbol', label: t.panel.cols.symbol, align: 'center'}, {key: 'value', label: t.panel.cols.value, align: 'right'}, {key: 'note', label: t.panel.cols.note}]}
					rows={dayRows}
					keyOf={(r) => r.id}
					selectedKey={sel.day === null || sel.day === undefined ? '' : String(sel.day)}
					onRowClick={(r) => setSel({employee: selRow.employee, day: Number(r.id)})}
					search={true}
					searchPlaceholder={t.panel.searchDays}
					maxHeight={300}
				/>
			);
		}
		panel = (
			<SidePanel title={`${selRow.code} ${selRow.name}`.trim()} sub={[kindOf(selRow), selRow.department].filter(Boolean).join(' · ')} onClose={() => setSel(null)}>
				{dayBlock}
				<div>
					<div class="s4vp-small" style={{fontWeight: '600', marginBottom: '4px'}}>{t.panel.totals}</div>
					{tt ? (
						<div>
							{line(t.panel.std, num(tt.std_days || 0))}
							{line(t.panel.paidLeave, dash(tt.paid_leave))}
							{line(t.panel.unpaid, dash(tt.unpaid_leave))}
							{line(t.panel.si, dash(tt.si_leave))}
							{line(t.panel.trip, dash(tt.trip_days))}
							{line(t.panel.late, dash(tt.late_days))}
							{line(t.panel.adjust, dash(tt.adjust_days))}
							{line(t.panel.ot, dash(tt.ot_hours))}
							{line(t.panel.work, num(tt.work_days || 0), true)}
							{selRow.estimated ? <div class="s4vp-small">{t.grid.estimated}</div> : selRow.stale && !selRow.locked ? <div class="s4vp-small">{t.grid.stale}</div> : null}
						</div>
					) : (
						<div>
							{line(t.panel.hours, num(selRow.hours || 0), true)}
							{line(t.panel.pendingHours, dash(selRow.pendingHours))}
						</div>
					)}
				</div>
				<Tabs items={tabs} value={activeTab} onPick={setTab} label={t.panel.tabs.days} />
				{tabBody}
			</SidePanel>
		);
	}

	// ------------------------------------------------------------------ hộp thoại sửa công một ngày

	let dialog = null;
	if (edit && rowOf[edit.employee] && days[edit.day]) {
		const v = edit.values || {};
		const when = `${shortDate(days[edit.day].date)} - ${empLabel(edit.employee)}`;
		const valid = sheetMode ? true : toNumber(v.adjust) !== null && toNumber(v.adjust) >= -1 && toNumber(v.adjust) <= 1 && toNumber(v.adjust) !== 0 && !!String(v.reason || '').trim();
		const symbolOptions = (data.symbols || []).map((s) => ({value: s.code, label: s.description ? `${s.code} - ${s.description}` : s.code}));
		// Ký hiệu đang có mà không thuộc danh mục vẫn hiện trong danh sách để người dùng thấy giá trị cũ
		if (sheetMode && v.symbol && !symbolOptions.some((o) => o.value === v.symbol)) symbolOptions.unshift({value: v.symbol, label: `${v.symbol} - ${t.kinds['?']}`});
		dialog = (
			<Dialog
				title={sheetMode ? t.edit.titleS(when) : t.edit.titleE(when)}
				onClose={() => setEdit(null)}
				actions={[<Button label={t.edit.cancel} onClick={() => setEdit(null)} />, <Button label={sheetMode ? t.edit.save : t.edit.saveSubmit} kind="primary" disabled={!valid || busy} onClick={saveEdit} />]}
			>
				{sheetMode ? (
					<Field label={t.edit.symbol}>
						<Select value={v.symbol || ''} onInput={setEditField('symbol')} options={symbolOptions} placeholder={t.edit.empty} ariaLabel={t.edit.symbol} />
					</Field>
				) : (
					<Field label={t.edit.adjust} hint={t.edit.adjustHint}>
						<NumberInput value={v.adjust || ''} onInput={setEditField('adjust')} ariaLabel={t.edit.adjust} />
					</Field>
				)}
				{sheetMode ? null : (
					<Field label={t.edit.reason}>
						<TextInput value={v.reason || ''} onInput={setEditField('reason')} onEnter={() => valid && !busy && saveEdit()} ariaLabel={t.edit.reason} />
					</Field>
				)}
				<div class="s4vp-small">{sheetMode ? t.edit.noteS : t.edit.noteE}</div>
			</Dialog>
		);
	}

	return (
		<Page>
			<PageHeader
				crumbs={[{label: t.crumb}, {label: t.periodCrumb(period.code)}]}
				title={t.title(period.code)}
				status={status}
				sub={subLine}
				actions={[periodSelect, <Menu label={t.more} align="right" items={menuItems} />, showRebuild ? <Button label={t.act.rebuild} disabled={!canEdit || busy} title={editTitle} onClick={build} /> : null, primary]}
			/>
			<Stepper steps={steps} label={t.stepsLabel} />
			<StatCards cards={cards} />
			<div class="s4vp-cols">
				<div class="s4vp-col-main">{gridCard}</div>
				{panel || excCard ? (
					<div class="s4vp-atd-aside">
						{panel}
						{excCard}
					</div>
				) : null}
			</div>
			{dialog}
		</Page>
	);
}
