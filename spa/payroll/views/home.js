/**
 * Trang chủ (mẫu docs/design/TrangChu.dc.html): lời chào theo vai trò, thẻ số liệu của kỳ, thao tác nhanh, các lượt đang chạy
 * (bảng lương, bảng công) kèm tiến độ theo bước, việc cần làm có nút đi thẳng tới màn xử lý, và các mốc sắp đến hạn.
 * Chỉ đọc: một lần gọi GET homeSummary {subsidiary} (api/Home.js); mọi thao tác là điều hướng bằng app.go.
 * Mốc hạn chỉ gồm mốc nội bộ của kỳ (core/Deadlines); hạn nộp theo luật chỉ hiện khi máy chủ trả về.
 * Bốn thẻ số liệu là nút bấm (tileTargets): Kỳ đang chạy -> Chấm công của kỳ; Bảng lương của kỳ -> bảng lương duy nhất
 * hoặc danh sách lọc theo kỳ; Việc cần xử lý -> cuộn tới bảng việc cần làm; Thực lĩnh -> hộp thoại theo bảng lương, so kỳ trước.
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call} from '../lib/api.js';
import {money, num, pct, fmtDate, localToday, quickFilter} from '../lib/format.js';
import {pick} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Table, Badge, Chips, SearchBox, SidePanel, Dialog, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		title: 'Việc hôm nay',
		weekdays: ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'],
		roleLabel: 'vai trò',
		roles: {admin: 'Quản trị', hr: 'Nhân sự - tiền lương', acct: 'Kế toán lương', other: 'Người dùng'},
		hello: (name) => (name ? `Chào ${name}.` : 'Xin chào.'),
		focus: {
			admin: 'Bạn thấy toàn bộ việc của kỳ: chốt công, tính lương, duyệt và ghi sổ.',
			hr: 'Việc chính của bạn: duyệt chứng từ công, khóa công và chuẩn bị bảng lương.',
			acct: 'Việc chính của bạn: soát bảng lương, duyệt, chi lương và ghi sổ.',
			other: 'Các việc của kỳ lương đang mở được liệt kê bên dưới.',
		},
		refresh: 'Tải lại',
		loading: 'Đang tải trang chủ...',
		failed: 'Chưa tải được dữ liệu trang chủ. Chi tiết lỗi ở dải thông báo phía trên.',
		retry: 'Thử lại',
		noSubsidiary: 'Tài khoản chưa có công ty con nào để chạy lương.',
		notReady: 'Chưa có thiết lập lương. Vào Thiết lập, bấm Nạp mặc định VN rồi sinh kỳ lương.',
		noPeriod: 'Chưa có kỳ lương nào đang mở cho công ty con này. Vào Thiết lập để sinh kỳ lương.',
		openSetup: 'Mở Thiết lập',
		stats: {
			period: 'Kỳ đang chạy',
			noPeriod: 'Chưa có',
			periodNote: (from, to, std) => `${from} - ${to}${std ? ` · công chuẩn ${std} ngày` : ''}`,
			periodAway: 'Hôm nay nằm ngoài kỳ này',
			batches: 'Bảng lương của kỳ',
			noBatches: 'Chưa tạo bảng lương',
			todos: 'Việc cần xử lý',
			todosUrgent: (n) => `${n} việc cần làm ngay`,
			todosCalm: 'Không có việc quá hạn',
			todosNone: 'Đã xong hết',
			net: 'Thực lĩnh kỳ này',
			netNone: 'Chưa có bảng lương đã tính',
			netNoPrev: 'Chưa có số kỳ trước để so sánh',
			netSame: (code) => `Bằng kỳ ${code}`,
			netDiff: (text, code, prev) => `${text} so với kỳ ${code} (${prev})`,
			label: 'Số liệu của kỳ',
			hint: 'Bấm để xem chi tiết',
		},
		netDlg: {
			title: (code) => (code ? `Thực lĩnh kỳ ${code}` : 'Thực lĩnh kỳ này'),
			sub: 'Chỉ cộng bảng lương đã tính, không cộng bảng đã đảo. Bấm một dòng để mở bảng lương.',
			current: (code) => `Kỳ này${code ? ` (${code})` : ''}`,
			previous: (code) => `Kỳ trước${code ? ` (${code})` : ''}`,
			diff: 'Chênh lệch',
			noPrev: 'Chưa có số',
			batches: (n) => `${n} bảng lương`,
			search: 'Tìm bảng lương, kỳ, trạng thái, số tiền',
			empty: 'Chưa có bảng lương đã tính.',
			cols: {name: 'Bảng lương', period: 'Kỳ', status: 'Trạng thái', employees: 'Số người', net: 'Thực lĩnh', share: 'Tỷ trọng trong kỳ'},
			openList: 'Danh sách bảng lương của kỳ',
			close: 'Đóng',
		},
		status: {H: 'Tạm giữ', B: 'Chờ tính', C: 'Đã tính', P: 'Chờ duyệt', A: 'Đã duyệt', J: 'Từ chối', R: 'Đã ghi sổ', V: 'Đã đảo'},
		statusCount: (n, text) => `${n} ${text.toLowerCase()}`,
		quick: 'Thao tác nhanh',
		quickItems: {
			continueBatch: (name) => `Tiếp tục ${name}`,
			newBatch: 'Tạo bảng lương',
			attendance: (code) => (code ? `Chấm công kỳ ${code}` : 'Chấm công'),
			docs: 'Đơn nghỉ, làm thêm, công tác',
			advances: 'Lập phiếu tạm ứng',
			reports: 'Báo cáo, tờ khai, bảng BH',
			profiles: 'Hồ sơ nhân viên',
		},
		runs: 'Kỳ đang chạy',
		runGroups: {running: 'Đang chạy', upcoming: 'Sắp tới', done: 'Đã xong'},
		runSearch: 'Tìm bảng lương, kỳ, trạng thái',
		runEmpty: {running: 'Không có bảng lương hay bảng công nào đang chạy.', upcoming: 'Chưa có kỳ sắp tới. Sinh kỳ lương trong Thiết lập.', done: 'Chưa có lượt nào hoàn tất.'},
		runNoMatch: 'Không có lượt nào khớp từ khóa.',
		runMore: (shown, total) => `Đang hiện ${shown} trên ${total} lượt.`,
		seeAll: 'Xem tất cả bảng lương',
		payrollTitle: (description, name) => (description ? `${description} · ${name}` : `Bảng lương ${name}`),
		payrollSub: (code, n, status) => `Kỳ ${code || '?'} · ${n} nhân viên · ${status}`,
		attendanceTitle: (code) => `Công kỳ ${code}`,
		attendanceSub: (std, n) => [std ? `công chuẩn ${std} ngày` : '', n === null ? '' : `${n} nhân viên có bảng công`].filter((x) => x).join(' · ') || 'Chưa lập bảng công',
		periodTitle: (code) => `Kỳ ${code}`,
		notStarted: 'Chưa bắt đầu',
		stepOf: (n, total, label) => `Bước ${n} / ${total}: ${label}`,
		stepsDone: (total) => `Hoàn tất ${total} / ${total} bước`,
		progressLabel: (n, total) => `Tiến độ ${n} trên ${total} bước`,
		payrollSteps: {prepare: 'Chuẩn bị', attendance: 'Công', calculate: 'Tính lương', review: 'Soát', approve: 'Duyệt', post: 'Chi lương và ghi sổ'},
		attendanceSteps: {collect: 'Thu dữ liệu công', exceptions: 'Xử lý ngoại lệ', lock: 'Khóa công', handoff: 'Chuyển sang chạy lương'},
		badges: {
			openChecks: (n) => `${n} cảnh báo cần xử lý`,
			noChecks: 'Không còn cảnh báo',
			rejected: 'Bị từ chối',
			hold: 'Đang tạm giữ',
			pending: 'Chờ duyệt',
			reversed: 'Đã đảo',
			posted: 'Đã ghi sổ',
			attendanceOpen: 'Công chưa khóa',
			pendingDocs: (n) => `${n} chứng từ công chờ duyệt`,
			locked: 'Công đã khóa',
		},
		resume: 'Làm tiếp',
		open: 'Mở',
		todos: (n) => (n ? `Việc cần làm (${n})` : 'Việc cần làm'),
		todoSub: 'Việc gấp đứng trước. Bấm một dòng để tới màn xử lý.',
		todoSearch: 'Tìm việc, bảng lương, kỳ, người phụ trách',
		todoEmpty: 'Không còn việc nào cần xử lý cho kỳ này.',
		todoCols: {task: 'Việc', target: 'Bảng lương / kỳ', due: 'Hạn', owner: 'Phụ trách', action: ''},
		owners: {hr: 'Nhân sự', acct: 'Kế toán', all: 'Nhân sự, kế toán'},
		periodTarget: (code) => `Kỳ ${code}`,
		todoText: {
			lockAttendance: (t) => (t.note === 'noSummary' ? 'Lập bảng công rồi khóa công' : t.count > 0 ? `Khóa công - còn ${t.count} chứng từ công chờ duyệt` : 'Khóa công của kỳ'),
			docs_leave: (t) => `${t.count} đơn nghỉ phép chờ duyệt`,
			docs_ot: (t) => `${t.count} đơn làm thêm giờ chờ duyệt`,
			docs_trip: (t) => `${t.count} đơn công tác chờ duyệt`,
			docs_exception: (t) => `${t.count} phiếu ngoại lệ công chờ duyệt`,
			batch_prepare: () => 'Nạp nhân viên vào bảng lương',
			batch_attendance: () => 'Khóa công của kỳ để tính lương',
			batch_calculate: (t) => (t.note === 'hold' ? 'Bỏ tạm giữ rồi tính lương' : 'Tính lương'),
			batch_review: (t) => (t.note === 'rejected' ? 'Bảng lương bị từ chối - sửa rồi gửi lại' : t.note === 'openChecks' ? `Xử lý ${t.count} cảnh báo trước khi duyệt` : 'Soát bảng lương trước khi duyệt'),
			batch_approve: (t) => (t.note === 'pending' ? 'Duyệt bảng lương đang chờ' : 'Gửi duyệt bảng lương'),
			batch_post: () => 'Chi lương và ghi sổ',
			createBatch: () => 'Tạo bảng lương cho kỳ',
			permitsExpired: (t) => `${t.count} giấy phép lao động đã hết hạn`,
			permitsExpiring: (t) => `${t.count} giấy phép lao động sắp hết hạn`,
		},
		todoAction: {attendance: 'Mở chấm công', attendanceLegacy: 'Mở chứng từ công', payrollRun: 'Mở bảng lương', payrollList: 'Tạo bảng lương', permits: 'Mở giấy phép', other: 'Xử lý'},
		tones: {error: 'Gấp', warn: 'Cần làm', info: 'Nên làm'},
		deadlines: 'Sắp đến hạn',
		deadlinesSub: (code) => `Mốc việc của kỳ ${code}`,
		deadlineText: {lockAttendance: 'Khóa công', calculate: 'Tính lương', approve: 'Duyệt bảng lương', post: 'Chi lương và ghi sổ'},
		deadlineLink: {lockAttendance: 'Mở chấm công', calculate: 'Mở chạy lương', approve: 'Mở chạy lương', post: 'Mở chạy lương'},
		deadlineEmpty: 'Chưa có mốc nào: chưa có kỳ lương đang mở.',
		due: (date) => `Hạn ${date}`,
		done: 'Đã xong',
		dueToday: 'hôm nay',
		daysLeft: (n) => `còn ${n} ngày`,
		daysOver: (n) => `quá hạn ${n} ngày`,
		permitsExpired: 'Giấy phép lao động đã hết hạn',
		permitsExpiring: 'Giấy phép lao động sắp hết hạn',
		permitCount: (n) => `${n} giấy phép`,
		permitNext: (date) => `gần nhất hết hạn ${date}`,
		openPermits: 'Mở giấy phép lao động',
		noStatutory: 'Hạn nộp tờ khai thuế và bảo hiểm chưa có trong thiết lập của gói nên chưa hiện ở đây; các mốc trên suy ra từ ngày kết thúc kỳ và ngày chứng từ của bảng lương.',
	},
	en: {
		title: 'Today',
		weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
		roleLabel: 'role',
		roles: {admin: 'Administrator', hr: 'HR - payroll', acct: 'Payroll accountant', other: 'User'},
		hello: (name) => (name ? `Hello ${name}.` : 'Hello.'),
		focus: {
			admin: 'You see every task of the period: attendance, calculation, approval and posting.',
			hr: 'Your main tasks: approve attendance documents, lock attendance and prepare the payroll batch.',
			acct: 'Your main tasks: review the payroll batch, approve, pay and post.',
			other: 'The tasks of the open pay period are listed below.',
		},
		refresh: 'Refresh',
		loading: 'Loading the home page...',
		failed: 'The home page data could not be loaded. See the message strip above for details.',
		retry: 'Try again',
		noSubsidiary: 'This account has no subsidiary to run payroll for.',
		notReady: 'Payroll preferences are missing. Open Setup, click Load VN Defaults, then generate pay periods.',
		noPeriod: 'There is no open pay period for this subsidiary. Open Setup to generate pay periods.',
		openSetup: 'Open Setup',
		stats: {
			period: 'Current period',
			noPeriod: 'None',
			periodNote: (from, to, std) => `${from} - ${to}${std ? ` · ${std} standard days` : ''}`,
			periodAway: 'Today is outside this period',
			batches: 'Payroll batches in the period',
			noBatches: 'No batch created yet',
			todos: 'Tasks to handle',
			todosUrgent: (n) => `${n} urgent`,
			todosCalm: 'Nothing overdue',
			todosNone: 'All done',
			net: 'Net pay this period',
			netNone: 'No calculated batch yet',
			netNoPrev: 'No previous period to compare',
			netSame: (code) => `Same as period ${code}`,
			netDiff: (text, code, prev) => `${text} vs period ${code} (${prev})`,
			label: 'Period figures',
			hint: 'Click to see details',
		},
		netDlg: {
			title: (code) => (code ? `Net pay for period ${code}` : 'Net pay this period'),
			sub: 'Only calculated batches are added up; reversed batches are left out. Click a row to open the batch.',
			current: (code) => `This period${code ? ` (${code})` : ''}`,
			previous: (code) => `Previous period${code ? ` (${code})` : ''}`,
			diff: 'Difference',
			noPrev: 'No figure yet',
			batches: (n) => (n === 1 ? '1 batch' : `${n} batches`),
			search: 'Search batch, period, status, amount',
			empty: 'No calculated batch yet.',
			cols: {name: 'Batch', period: 'Period', status: 'Status', employees: 'Employees', net: 'Net pay', share: 'Share of period'},
			openList: 'Batches of the period',
			close: 'Close',
		},
		status: {H: 'On hold', B: 'Pending calculation', C: 'Calculated', P: 'Pending approval', A: 'Approved', J: 'Rejected', R: 'Released', V: 'Reversed'},
		statusCount: (n, text) => `${n} ${text.toLowerCase()}`,
		quick: 'Quick actions',
		quickItems: {
			continueBatch: (name) => `Continue ${name}`,
			newBatch: 'New payroll batch',
			attendance: (code) => (code ? `Attendance for ${code}` : 'Attendance'),
			docs: 'Leave, overtime, business trips',
			advances: 'New salary advance',
			reports: 'Reports, declarations, insurance',
			profiles: 'Employee profiles',
		},
		runs: 'Runs in progress',
		runGroups: {running: 'In progress', upcoming: 'Upcoming', done: 'Completed'},
		runSearch: 'Search batch, period, status',
		runEmpty: {running: 'No payroll batch or attendance sheet is in progress.', upcoming: 'No upcoming period. Generate pay periods in Setup.', done: 'Nothing completed yet.'},
		runNoMatch: 'No run matches the search.',
		runMore: (shown, total) => `Showing ${shown} of ${total} runs.`,
		seeAll: 'See all payroll batches',
		payrollTitle: (description, name) => (description ? `${description} · ${name}` : `Payroll batch ${name}`),
		payrollSub: (code, n, status) => `Period ${code || '?'} · ${n} employees · ${status}`,
		attendanceTitle: (code) => `Attendance for ${code}`,
		attendanceSub: (std, n) => [std ? `${std} standard days` : '', n === null ? '' : `${n} employees with attendance`].filter((x) => x).join(' · ') || 'No attendance sheet yet',
		periodTitle: (code) => `Period ${code}`,
		notStarted: 'Not started',
		stepOf: (n, total, label) => `Step ${n} / ${total}: ${label}`,
		stepsDone: (total) => `All ${total} steps completed`,
		progressLabel: (n, total) => `Progress ${n} of ${total} steps`,
		payrollSteps: {prepare: 'Prepare', attendance: 'Attendance', calculate: 'Calculate', review: 'Review', approve: 'Approve', post: 'Pay and post'},
		attendanceSteps: {collect: 'Collect attendance', exceptions: 'Handle exceptions', lock: 'Lock attendance', handoff: 'Hand off to payroll'},
		badges: {
			openChecks: (n) => `${n} warnings to handle`,
			noChecks: 'No open warnings',
			rejected: 'Rejected',
			hold: 'On hold',
			pending: 'Pending approval',
			reversed: 'Reversed',
			posted: 'Released',
			attendanceOpen: 'Attendance not locked',
			pendingDocs: (n) => `${n} attendance documents pending`,
			locked: 'Attendance locked',
		},
		resume: 'Continue',
		open: 'Open',
		todos: (n) => (n ? `To do (${n})` : 'To do'),
		todoSub: 'Urgent tasks first. Click a row to go to the screen that handles it.',
		todoSearch: 'Search task, batch, period, owner',
		todoEmpty: 'Nothing left to handle for this period.',
		todoCols: {task: 'Task', target: 'Batch / period', due: 'Due', owner: 'Owner', action: ''},
		owners: {hr: 'HR', acct: 'Accounting', all: 'HR, accounting'},
		periodTarget: (code) => `Period ${code}`,
		todoText: {
			lockAttendance: (t) => (t.note === 'noSummary' ? 'Build the attendance summary, then lock attendance' : t.count > 0 ? `Lock attendance - ${t.count} attendance documents still pending` : 'Lock attendance for the period'),
			docs_leave: (t) => `${t.count} leave requests pending approval`,
			docs_ot: (t) => `${t.count} overtime requests pending approval`,
			docs_trip: (t) => `${t.count} business trips pending approval`,
			docs_exception: (t) => `${t.count} attendance exceptions pending approval`,
			batch_prepare: () => 'Load employees into the payroll batch',
			batch_attendance: () => 'Lock attendance for the period to calculate payroll',
			batch_calculate: (t) => (t.note === 'hold' ? 'Remove the hold, then calculate' : 'Calculate payroll'),
			batch_review: (t) => (t.note === 'rejected' ? 'Batch was rejected - fix and resubmit' : t.note === 'openChecks' ? `Handle ${t.count} warnings before approval` : 'Review the batch before approval'),
			batch_approve: (t) => (t.note === 'pending' ? 'Approve the pending batch' : 'Submit the batch for approval'),
			batch_post: () => 'Pay and post',
			createBatch: () => 'Create the payroll batch for the period',
			permitsExpired: (t) => `${t.count} work permits have expired`,
			permitsExpiring: (t) => `${t.count} work permits expire soon`,
		},
		todoAction: {attendance: 'Open attendance', attendanceLegacy: 'Open documents', payrollRun: 'Open batch', payrollList: 'New batch', permits: 'Open permits', other: 'Handle'},
		tones: {error: 'Urgent', warn: 'To do', info: 'Suggested'},
		deadlines: 'Coming due',
		deadlinesSub: (code) => `Milestones of period ${code}`,
		deadlineText: {lockAttendance: 'Lock attendance', calculate: 'Calculate payroll', approve: 'Approve the batch', post: 'Pay and post'},
		deadlineLink: {lockAttendance: 'Open attendance', calculate: 'Open payroll', approve: 'Open payroll', post: 'Open payroll'},
		deadlineEmpty: 'No milestones: there is no open pay period.',
		due: (date) => `Due ${date}`,
		done: 'Done',
		dueToday: 'today',
		daysLeft: (n) => (n === 1 ? '1 day left' : `${n} days left`),
		daysOver: (n) => (n === 1 ? '1 day overdue' : `${n} days overdue`),
		permitsExpired: 'Work permits expired',
		permitsExpiring: 'Work permits expiring soon',
		permitCount: (n) => `${n} permits`,
		permitNext: (date) => `next expiry ${date}`,
		openPermits: 'Open work permits',
		noStatutory: 'Filing and payment deadlines for tax and insurance are not in the package settings yet, so they are not shown; the milestones above come from the period end date and the batch document date.',
	},
};

const STATUS_ORDER = ['H', 'B', 'C', 'J', 'P', 'A', 'R', 'V'];
const TONE_RANK = {error: 0, warn: 1, info: 2};
const STATE_TONE = {done: 'ok', overdue: 'error', due: 'warn', upcoming: 'muted'};
const RUN_LIMIT = 6;
const TODO_ID = 's4vp-home-todos';
const FLASH = 's4vp-home-flash';
const FLASH_MS = 2600;

// Kiểu dáng riêng của trang chủ (theo mẫu), viết bằng đối tượng style vì CSS chung không thuộc phân hệ này
const S = {
	section: {display: 'flex', flexDirection: 'column', gap: '10px'},
	heading: {fontSize: '16px', fontWeight: '700'},
	quickGrid: {display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px'},
	quick: {minHeight: '52px', padding: '10px 16px', borderRadius: '12px', fontWeight: '600', justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal', lineHeight: '1.3', width: '100%'},
	runList: {display: 'flex', flexDirection: 'column', gap: '12px'},
	run: {border: '1px solid #E8EBEE', borderRadius: '10px', padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: '10px 24px', alignItems: 'center', justifyContent: 'space-between'},
	runHead: {display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '220px', flex: '1 1 240px'},
	runTitle: {fontSize: '15px', fontWeight: '700', overflowWrap: 'anywhere'},
	runProgress: {display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '200px', flex: '1 1 200px'},
	runEnd: {display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center', justifyContent: 'flex-end'},
	track: {height: '8px', borderRadius: '999px', background: '#E1E5E8', overflow: 'hidden'},
	bar: (percent) => ({width: `${percent}%`, height: '8px', background: '#24566B'}),
	small: {fontSize: '13px'},
	runBar: {display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', justifyContent: 'flex-end'},
	deadline: (last) => ({display: 'flex', flexDirection: 'column', gap: '2px', paddingBottom: last ? '0' : '10px', borderBottom: last ? '0' : '1px solid #E8EBEE'}),
	deadlineTitle: (tone) => ({fontSize: '14px', fontWeight: '600', color: tone === 'error' ? '#8A1C14' : 'inherit', display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center', justifyContent: 'space-between'}),
	linkRow: {display: 'flex'},
	loading: {display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'center', padding: '28px 16px', color: '#55616B'},
	stack: {display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start'},
	hello: {display: 'flex', flexDirection: 'column', gap: '2px'},
};

const list = (v) => (Array.isArray(v) ? v : []);
const count = (v) => {
	const n = Number(v);
	return isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

// Thứ trong tuần của ngày yyyy-mm-dd (tính theo UTC để không lệch múi giờ)
function weekday(iso, names) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
	if (!m) return '';
	return names[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] || '';
}

function roleKey(user) {
	const u = user || {};
	// fullAccess: administrator hoặc vai trò trình diễn customrole_s4vp_demo (RESTlet bootstrap) - trang chủ đầy đủ như quản trị
	if (u.role === 'administrator' || u.fullAccess === true) return 'admin';
	if (u.isHr || u.role === 'customrole_s4vp_hr') return 'hr';
	if (u.isAccountant || u.role === 'customrole_s4vp_accountant') return 'acct';
	return 'other';
}

// "còn 3 ngày", "hôm nay", "quá hạn 2 ngày"; không rõ số ngày thì chuỗi rỗng
function daysText(t, daysLeft) {
	const n = Number(daysLeft);
	if (daysLeft === null || daysLeft === undefined || daysLeft === '' || !isFinite(n)) return '';
	return n === 0 ? t.dueToday : n > 0 ? t.daysLeft(n) : t.daysOver(-n);
}

function dueText(t, item) {
	if (!item || !item.date) return '';
	return [t.due(fmtDate(item.date)), item.state === 'done' ? t.done : daysText(t, item.daysLeft)].filter((x) => x).join(' · ');
}

// Một lượt (bảng lương, bảng công, kỳ sắp tới) -> chữ hiển thị, nhãn cảnh báo và nơi đi tới
function describeRun(t, run) {
	const progress = run.progress || {done: 0, total: 0, currentKey: null};
	const total = count(progress.total);
	const done = Math.min(count(progress.done), total);
	const out = {key: `${run.kind}:${run.id || run.period}`, kind: run.kind, name: run.name || '', group: run.group, title: '', sub: '', step: '', percent: 0, done, total, badge: null, go: null};
	if (run.kind === 'period') {
		out.title = t.periodTitle(run.periodCode);
		out.sub = `${fmtDate(run.start)} - ${fmtDate(run.end)}`;
		out.badge = {text: t.notStarted, tone: 'muted'};
		out.go = {view: 'attendance', params: {period: run.period}};
		return out;
	}
	const labels = run.kind === 'payroll' ? t.payrollSteps : t.attendanceSteps;
	const current = progress.currentKey;
	out.step = current ? t.stepOf(done + 1, total, labels[current] || current) : t.stepsDone(total);
	// Bước đang làm tính nửa bước để thanh tiến độ không đứng ở 0 khi mới bắt đầu
	out.percent = total ? Math.round(((current ? done + 0.5 : total) / total) * 100) : 0;
	const step = list(run.steps).find((s) => s && s.key === current) || {};
	if (run.kind === 'payroll') {
		const status = t.status[run.status] || run.status || '';
		out.title = t.payrollTitle(run.description, run.name);
		out.sub = t.payrollSub(run.periodCode, num(count(run.empCount)), status);
		out.go = {view: 'payrollRun', params: {id: run.id}};
		const checks = run.checks;
		if (run.status === 'V') out.badge = {text: t.badges.reversed, tone: 'muted'};
		else if (run.status === 'R') out.badge = {text: t.badges.posted, tone: 'ok'};
		else if (run.status === 'J') out.badge = {text: t.badges.rejected, tone: 'error'};
		else if (run.status === 'H') out.badge = {text: t.badges.hold, tone: 'muted'};
		else if (checks && count(checks.open) > 0) out.badge = {text: t.badges.openChecks(count(checks.open)), tone: count(checks.errors) > 0 ? 'error' : 'warn'};
		else if (run.status === 'P') out.badge = {text: t.badges.pending, tone: 'warn'};
		else if (current === 'attendance' || step.note === 'open') out.badge = {text: t.badges.attendanceOpen, tone: 'warn'};
		else if (checks && run.status === 'C') out.badge = {text: t.badges.noChecks, tone: 'ok'};
		return out;
	}
	out.title = t.attendanceTitle(run.periodCode);
	out.sub = t.attendanceSub(run.stdDays ? num(run.stdDays) : '', run.employees === null || run.employees === undefined ? null : count(run.employees));
	out.go = {view: 'attendance', params: {period: run.period}};
	if (count(run.pendingDocs) > 0) out.badge = {text: t.badges.pendingDocs(count(run.pendingDocs)), tone: 'warn'};
	else if (run.locked) out.badge = {text: t.badges.locked, tone: 'ok'};
	return out;
}

function describeTodo(t, todo, mine) {
	const make = t.todoText[todo.kind];
	let title = todo.kind || '';
	try {
		if (make) title = make(todo);
	} catch (e) {
		title = todo.kind || '';
	}
	const go = todo.go || {};
	const target = todo.batch ? todo.batch.name || '' : todo.period ? t.periodTarget(todo.period.code) : '';
	return {
		id: todo.key,
		tone: TONE_RANK[todo.tone] === undefined ? 'info' : todo.tone,
		toneText: t.tones[todo.tone] || t.tones.info,
		title,
		target: todo.batch && todo.period && todo.period.code ? `${target} · ${t.periodTarget(todo.period.code)}` : target,
		due: todo.date ? [fmtDate(todo.date), daysText(t, todo.daysLeft)].filter((x) => x).join(' · ') : '',
		overdue: Number(todo.daysLeft) < 0,
		owner: t.owners[todo.owner] || '',
		mine,
		view: go.view || '',
		params: go.params || {},
		action: t.todoAction[go.view] || t.todoAction.other,
	};
}

/**
 * Nơi đi tới khi bấm từng thẻ số liệu (dữ liệu homeSummary):
 *   period  -> Chấm công của kỳ đang chạy; chưa có kỳ thì Thiết lập, mục kỳ lương
 *   batches -> kỳ có đúng một bảng lương thì mở thẳng bảng đó, ngược lại danh sách bảng lương lọc theo kỳ
 *   todos   -> {todos: true}: cuộn tới bảng việc cần làm ngay bên dưới
 *   net     -> {dialog: 'net'} khi đã có thực lĩnh (hộp thoại theo bảng lương, so kỳ trước), chưa có thì như batches
 */
export function tileTargets(data) {
	const d = data || {};
	const period = d.period || null;
	const pid = period && period.id ? String(period.id) : '';
	const current = list((d.periodBatches || {}).current).filter((b) => b && b.id);
	let batches;
	if (current.length === 1 && count((d.batchCounts || {}).total) <= 1) batches = {view: 'payrollRun', params: {id: String(current[0].id)}};
	else batches = {view: 'payrollList', params: pid ? {period: pid} : {}};
	const net = d.net || {};
	return {
		period: pid ? {view: 'attendance', params: {period: pid}} : {view: 'setupHub', params: {section: 'periods'}},
		batches,
		todos: {todos: true},
		net: net.current === null || net.current === undefined ? batches : {dialog: 'net'},
	};
}

/** Dòng của hộp thoại thực lĩnh: bảng lương đã tính của kỳ này rồi kỳ trước, tỷ trọng trong tổng của kỳ mình. */
export function netRows(t, data) {
	const d = data || {};
	const net = d.net || {};
	const pb = d.periodBatches || {};
	const make = (b, code, total, which) => {
		const value = Number(b.net) || 0;
		return {
			id: `${which}:${b.id}`, batch: String(b.id), which, name: b.name || String(b.id), description: b.description || '', periodCode: code || '',
			statusText: t.status[b.status] || b.status || '', status: b.status || '', empCount: count(b.empCount), net: value, share: total ? value / total : null,
		};
	};
	const cur = list(pb.current).filter((b) => b && b.id && b.counted).map((b) => make(b, (d.period || {}).code, Number(net.current) || 0, 'current'));
	const prev = list(pb.previous).filter((b) => b && b.id && b.counted !== false).map((b) => make(b, (d.previousPeriod || {}).code, Number(net.previous) || 0, 'previous'));
	return cur.concat(prev);
}

/** Cuộn tới bảng việc cần làm, nháy viền để mắt bắt được, đặt con trỏ vào ô tìm. Trả false khi không tìm thấy khung. */
export function revealTodos(doc, timer) {
	try {
		const el = doc && typeof doc.getElementById === 'function' ? doc.getElementById(TODO_ID) : null;
		if (!el) return false;
		if (typeof el.scrollIntoView === 'function') el.scrollIntoView({behavior: 'smooth', block: 'start'});
		const cls = el.classList;
		if (cls) {
			// Bấm lại khi đang nháy: gỡ lớp, ép trình duyệt tính lại bố cục rồi gắn lại để hiệu ứng chạy lại từ đầu
			cls.remove(FLASH);
			void el.offsetWidth;
			cls.add(FLASH);
			(timer || setTimeout)(() => cls.remove(FLASH), FLASH_MS);
		}
		const input = typeof el.querySelector === 'function' ? el.querySelector('input') : null;
		if (input && typeof input.focus === 'function') {
			try {
				input.focus({preventScroll: true});
			} catch (e) {
				input.focus();
			}
		}
		return true;
	} catch (e) {
		return false;
	}
}

/** Hàng thẻ số liệu bấm được: mỗi thẻ là một <button> mang dáng thẻ số liệu (Enter / Space do trình duyệt lo). */
export function StatTiles({cards, label, hint, onOpen}) {
	return (
		<div class="s4vp-stats" role="group" aria-label={label}>
			{list(cards).map((c) => (
				<button key={c.key} type="button" class={c.tone ? `s4vp-stat s4vp-home-tile s4vp-t-${c.tone}` : 's4vp-stat s4vp-home-tile'} title={hint} onClick={() => onOpen && onOpen(c.key)}>
					<span class="s4vp-home-tile-h">
						<span class="s4vp-stat-l">{c.label}</span>
						<span class="s4vp-home-tile-go" aria-hidden="true">
							{'›'}
						</span>
					</span>
					<span class="s4vp-stat-v">{c.value}</span>
					{c.note ? <span class="s4vp-stat-n">{c.note}</span> : null}
				</button>
			))}
		</div>
	);
}

/** Hộp thoại thực lĩnh của kỳ: tổng kỳ này, kỳ trước, chênh lệch; lưới theo bảng lương có ô tìm, bấm dòng mở bảng lương. */
function NetDialog({t, data, onGo, onClose}) {
	const net = data.net || {};
	const period = data.period || {};
	const prevCode = (data.previousPeriod || {}).code || '';
	const rows = netRows(t, data);
	const hasPrev = net.previous !== null && net.previous !== undefined;
	let diff = '-';
	if (hasPrev && net.diff !== null && net.diff !== undefined) {
		const sign = net.diff > 0 ? '+' : net.diff < 0 ? '-' : '';
		diff = `${sign}${money(Math.abs(net.diff))}${net.pct === null || net.pct === undefined ? '' : ` (${sign}${pct(Math.abs(net.pct))})`}`;
	}
	const columns = [
		{key: 'name', label: t.netDlg.cols.name, render: (r) => (
			<span>
				<span class="s4vp-link">{r.name}</span>
				{r.description ? <span class="s4vp-small s4vp-muted">{` · ${r.description}`}</span> : null}
			</span>
		)},
		{key: 'periodCode', label: t.netDlg.cols.period, nowrap: true},
		{key: 'statusText', label: t.netDlg.cols.status, nowrap: true},
		{key: 'empCount', label: t.netDlg.cols.employees, type: 'num', nowrap: true},
		{key: 'net', label: t.netDlg.cols.net, type: 'money', nowrap: true},
		{key: 'share', label: t.netDlg.cols.share, type: 'pct', nowrap: true},
	];
	const listGo = {view: 'payrollList', params: period.id ? {period: String(period.id)} : {}};
	return (
		<Dialog
			title={t.netDlg.title(period.code || '')}
			width={760}
			onClose={onClose}
			actions={[<Button label={t.netDlg.openList} onClick={() => onGo(listGo)} />, <Button kind="primary" label={t.netDlg.close} onClick={onClose} />]}
		>
			<div class="s4vp-small s4vp-muted">{t.netDlg.sub}</div>
			<div class="s4vp-home-net">
				<div>
					<div class="s4vp-small s4vp-muted">{t.netDlg.current(period.code || '')}</div>
					<div class="s4vp-home-net-v">{net.current === null || net.current === undefined ? '-' : money(net.current)}</div>
					<div class="s4vp-small">{t.netDlg.batches(count(net.currentBatches))}</div>
				</div>
				<div>
					<div class="s4vp-small s4vp-muted">{t.netDlg.previous(prevCode)}</div>
					<div class="s4vp-home-net-v">{hasPrev ? money(net.previous) : t.netDlg.noPrev}</div>
					{hasPrev ? <div class="s4vp-small">{t.netDlg.batches(count(net.previousBatches))}</div> : null}
				</div>
				<div>
					<div class="s4vp-small s4vp-muted">{t.netDlg.diff}</div>
					<div class="s4vp-home-net-v">{diff}</div>
				</div>
			</div>
			<Table columns={columns} rows={rows} keyOf={(r) => r.id} onRowClick={(r) => onGo({view: 'payrollRun', params: {id: r.batch}})} empty={t.netDlg.empty} search={true} searchPlaceholder={t.netDlg.search} maxHeight={320} label={t.netDlg.title(period.code || '')} />
		</Dialog>
	);
}

export default function HomeView({app}) {
	const t = pick(TEXT);
	const boot = app.boot || {};
	const subsidiary = app.subsidiary || '';
	const role = roleKey(boot.user);
	const [data, setData] = useState(null);
	const [failed, setFailed] = useState(false);
	const [group, setGroup] = useState('');
	const [query, setQuery] = useState('');
	const [netOpen, setNetOpen] = useState(false);
	const alive = useRef(true);
	const request = useRef(0);

	const load = () => {
		if (!subsidiary) return Promise.resolve();
		request.current += 1;
		const mine = request.current;
		setFailed(false);
		return app.run(t.loading, call({action: 'homeSummary', subsidiary})).then((r) => {
			// Bỏ kết quả về muộn (đã đổi công ty con hoặc đã rời màn)
			if (!alive.current || mine !== request.current) return;
			if (!r || typeof r !== 'object') {
				setFailed(true);
				return;
			}
			setData(r);
		});
	};

	useEffect(() => {
		alive.current = true;
		setData(null);
		setGroup('');
		setQuery('');
		setNetOpen(false);
		load();
		return () => {
			alive.current = false;
		};
	}, [subsidiary]);

	const go = (target) => target && target.view && app.go(target.view, target.params || {});
	const today = (data && data.today) || localToday();
	const subsidiaryName = (list(boot.subsidiaries).find((s) => String(s.id) === String(subsidiary)) || {}).name || '';
	const headerLine = [`${weekday(today, t.weekdays)}, ${fmtDate(today)}`, subsidiaryName, `${t.roleLabel} ${t.roles[role]}`].filter((x) => x).join(' · ');
	const header = (
		<PageHeader
			title={t.title}
			sub={
				<div style={S.hello}>
					<div>{headerLine}</div>
					<div>{`${t.hello((boot.user || {}).name || '')} ${t.focus[role]}`}</div>
				</div>
			}
			actions={[<Button label={t.refresh} disabled={!subsidiary || !!app.busy} onClick={() => load()} />]}
		/>
	);

	// ---------------------------------------------------------------- trạng thái chưa có dữ liệu
	if (!subsidiary || boot.setupReady === false || !data) {
		let body;
		if (!subsidiary) body = <Empty text={t.noSubsidiary} />;
		else if (boot.setupReady === false)
			body = (
				<div style={S.stack}>
					<div>{t.notReady}</div>
					<Button kind="primary" label={t.openSetup} onClick={() => app.go('setup')} />
				</div>
			);
		else if (failed)
			body = (
				<div style={S.stack}>
					<div>{t.failed}</div>
					<Button kind="primary" label={t.retry} disabled={!!app.busy} onClick={() => load()} />
				</div>
			);
		else
			body = (
				<div style={S.loading} role="status">
					<span class="s4vp-spin" />
					<span>{t.loading}</span>
				</div>
			);
		return (
			<Page>
				{header}
				<Card tone={boot.setupReady === false || failed ? 'warn' : ''} label={t.title}>
					{body}
				</Card>
			</Page>
		);
	}

	// ---------------------------------------------------------------- số liệu đã có
	const period = data.period || null;
	const net = data.net || {};
	const runs = list(data.runs).map((r) => {
		try {
			return describeRun(t, r);
		} catch (e) {
			return null;
		}
	}).filter((r) => r && r.key);
	const runCounts = data.runCounts || {};
	const groups = ['running', 'upcoming', 'done'];
	const activeGroup = group || groups.find((g) => runs.some((r) => r.group === g)) || 'running';
	const inGroup = runs.filter((r) => r.group === activeGroup);
	let shownRuns = inGroup;
	try {
		shownRuns = quickFilter(inGroup.map((r) => ({key: r.key, title: r.title, sub: r.sub, step: r.step, badge: r.badge ? r.badge.text : ''})), query).rows.map((x) => inGroup.find((r) => r.key === x.key));
	} catch (e) {
		shownRuns = inGroup;
	}
	// Bảng lương đang dở đi xa nhất trong quy trình là việc "tiếp tục" của thao tác nhanh
	const firstRunning = runs.filter((r) => r.group === 'running' && r.kind === 'payroll').reduce((best, r) => (!best || r.done > best.done ? r : best), null);
	const attendanceRun = runs.find((r) => r.kind === 'attendance');

	const todos = list(data.todos)
		.map((x, i) => {
			const mine = role === 'admin' || role === 'other' || x.owner === 'all' || x.owner === role;
			return Object.assign(describeTodo(t, x || {}, mine), {order: i});
		})
		.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || Number(b.mine) - Number(a.mine) || a.order - b.order);
	const urgent = todos.filter((x) => x.tone === 'error').length;

	// Thẻ số liệu
	const byStatus = (data.batchCounts || {}).byStatus || {};
	const statusNote = STATUS_ORDER.filter((s) => count(byStatus[s]) > 0).map((s) => t.statusCount(count(byStatus[s]), t.status[s])).join(' · ');
	let netNote = t.stats.netNone;
	if (net.current !== null && net.current !== undefined) {
		const prevCode = (data.previousPeriod || {}).code || '';
		if (net.previous === null || net.previous === undefined || net.pct === null || net.pct === undefined) netNote = t.stats.netNoPrev;
		else if (!net.diff) netNote = t.stats.netSame(prevCode);
		else netNote = t.stats.netDiff(`${net.diff > 0 ? '+' : '-'}${pct(Math.abs(net.pct))}`, prevCode, money(net.previous));
	}
	const cards = [
		{
			key: 'period',
			label: t.stats.period,
			value: period ? period.code : t.stats.noPeriod,
			note: period ? `${t.stats.periodNote(fmtDate(period.start), fmtDate(period.end), period.stdDays ? num(period.stdDays) : '')}${period.containsToday ? '' : ` · ${t.stats.periodAway}`}` : '',
		},
		{key: 'batches', label: t.stats.batches, value: num(count((data.batchCounts || {}).total)), note: statusNote || t.stats.noBatches},
		{key: 'todos', label: t.stats.todos, value: num(todos.length), note: !todos.length ? t.stats.todosNone : urgent ? t.stats.todosUrgent(urgent) : t.stats.todosCalm, tone: urgent ? 'error' : todos.length ? 'warn' : 'ok'},
		{key: 'net', label: t.stats.net, value: net.current === null || net.current === undefined ? '-' : money(net.current), note: netNote},
	];
	// Bấm thẻ số liệu: đi tới màn có số chi tiết, hoặc cuộn tới bảng việc cần làm, hoặc mở hộp thoại thực lĩnh
	const targets = tileTargets(data);
	const openTile = (key) => {
		const target = targets[key];
		if (!target) return;
		if (target.todos) revealTodos(typeof document === 'undefined' ? null : document);
		else if (target.dialog === 'net') setNetOpen(true);
		else go(target);
	};

	// Thao tác nhanh: việc chính theo vai trò đứng đầu và được tô đậm
	const payrollQuick = firstRunning ? {key: 'payroll', label: t.quickItems.continueBatch(firstRunning.name || firstRunning.title), go: firstRunning.go} : {key: 'payroll', label: t.quickItems.newBatch, go: {view: 'payrollList'}};
	const attendanceQuick = {key: 'attendance', label: t.quickItems.attendance(period ? period.code : ''), go: {view: 'attendance', params: period ? {period: period.id} : {}}};
	const attendanceFirst = role === 'hr' && (!attendanceRun || attendanceRun.group === 'running') && !!period && period.attStatus !== 'L';
	const quick = (attendanceFirst ? [attendanceQuick, payrollQuick] : [payrollQuick, attendanceQuick]).concat([
		{key: 'docs', label: t.quickItems.docs, go: {view: 'attendanceLegacy'}},
		{key: 'advances', label: t.quickItems.advances, go: {view: 'advances'}},
		{key: 'reports', label: t.quickItems.reports, go: {view: 'reports'}},
		{key: 'profiles', label: t.quickItems.profiles, go: {view: 'profiles'}},
	]);

	const todoColumns = [
		{key: 'title', label: t.todoCols.task, render: (r) => <span class="s4vp-link">{r.title}</span>},
		{key: 'toneText', label: '', nowrap: true, render: (r) => <Badge text={r.toneText} tone={r.tone === 'info' ? 'info' : r.tone} />},
		{key: 'target', label: t.todoCols.target},
		{key: 'due', label: t.todoCols.due, nowrap: true, render: (r) => (r.overdue ? <span style={{color: '#8A1C14', fontWeight: '600'}}>{r.due}</span> : r.due)},
		{key: 'owner', label: t.todoCols.owner, nowrap: true},
		{key: 'action', label: t.todoCols.action, nowrap: true, align: 'right', noRowClick: true, render: (r) => <Button small={true} label={r.action} onClick={() => go(r)} />},
	];

	const deadlines = list(data.deadlines).filter((d) => d && d.key && d.date);
	const permits = data.permits || null;
	const sideItems = deadlines.map((d) => ({
		key: `d:${d.key}`,
		title: t.deadlineText[d.key] || d.key,
		tone: STATE_TONE[d.state] || 'muted',
		badge: d.state === 'done' ? t.done : d.state === 'overdue' ? t.tones.error : '',
		text: d.state === 'done' ? t.due(fmtDate(d.date)) : dueText(t, d),
		link: d.state === 'done' || !t.deadlineLink[d.key] ? null : {label: t.deadlineLink[d.key], go: d.key === 'lockAttendance' ? {view: 'attendance', params: period ? {period: period.id} : {}} : data.deadlineBatch ? {view: 'payrollRun', params: {id: data.deadlineBatch.id}} : {view: 'payrollList'}},
	}));
	if (permits && count(permits.expired) > 0) sideItems.push({key: 'p:expired', title: t.permitsExpired, tone: 'error', badge: '', text: t.permitCount(count(permits.expired)), link: {label: t.openPermits, go: {view: 'permits'}}});
	if (permits && count(permits.expiring) > 0)
		sideItems.push({key: 'p:expiring', title: t.permitsExpiring, tone: 'warn', badge: '', text: [t.permitCount(count(permits.expiring)), permits.nextExpiry ? t.permitNext(fmtDate(permits.nextExpiry)) : ''].filter((x) => x).join(' · '), link: {label: t.openPermits, go: {view: 'permits'}}});

	return (
		<Page>
			{header}
			{period ? null : (
				<Card tone="warn" label={t.stats.period}>
					<div style={S.stack}>
						<div>{t.noPeriod}</div>
						<Button kind="primary" label={t.openSetup} onClick={() => app.go('setup')} />
					</div>
				</Card>
			)}
			<StatTiles cards={cards} label={t.stats.label} hint={t.stats.hint} onOpen={openTile} />

			<section aria-label={t.quick} style={S.section}>
				<div style={S.heading}>{t.quick}</div>
				<div style={S.quickGrid}>
					{quick.map((q, i) => (
						<button key={q.key} type="button" class={i === 0 ? 's4vp-btn s4vp-btn-primary' : 's4vp-btn'} style={S.quick} onClick={() => go(q.go)}>
							{q.label}
						</button>
					))}
				</div>
			</section>

			<div class="s4vp-cols">
				<div class="s4vp-col-main">
					<Card
						title={t.runs}
						actions={[
							<Chips label={t.runs} value={activeGroup} onPick={(v) => setGroup(v)} items={groups.map((g) => ({value: g, label: t.runGroups[g], count: count(runCounts[g])}))} />,
							<SearchBox value={query} onInput={setQuery} placeholder={t.runSearch} width={240} />,
						]}
					>
						{shownRuns.length ? (
							<div style={S.runList}>
								{shownRuns.slice(0, RUN_LIMIT).map((r, i) => (
									<div key={r.key} style={S.run}>
										<div style={S.runHead}>
											<div style={S.runTitle}>{r.title}</div>
											<div class="s4vp-muted" style={S.small}>
												{r.sub}
											</div>
										</div>
										{r.step ? (
											<div style={S.runProgress}>
												<div style={S.small}>{r.step}</div>
												<div role="img" aria-label={t.progressLabel(r.done, r.total)} style={S.track}>
													<div style={S.bar(r.percent)} />
												</div>
											</div>
										) : null}
										<div style={S.runEnd}>
											{r.badge ? <Badge text={r.badge.text} tone={r.badge.tone} /> : null}
											<Button kind={i === 0 && r.group === 'running' ? 'primary' : 'default'} label={r.group === 'running' ? t.resume : t.open} ariaLabel={`${r.group === 'running' ? t.resume : t.open}: ${r.title}`} onClick={() => go(r.go)} />
										</div>
									</div>
								))}
							</div>
						) : (
							<Empty text={inGroup.length ? t.runNoMatch : t.runEmpty[activeGroup]} />
						)}
						{shownRuns.length > RUN_LIMIT || (activeGroup !== 'upcoming' && count(runCounts[activeGroup]) > shownRuns.length && !query) ? (
							<div style={S.runBar}>
								<span class="s4vp-small">{t.runMore(Math.min(shownRuns.length, RUN_LIMIT), Math.max(count(runCounts[activeGroup]), shownRuns.length))}</span>
								<Button kind="link" label={t.seeAll} onClick={() => app.go('payrollList')} />
							</div>
						) : null}
					</Card>

					<div id={TODO_ID} class="s4vp-home-todos">
						<Card title={t.todos(todos.length)} sub={t.todoSub} flush={true}>
							<Table columns={todoColumns} rows={todos} keyOf={(r) => r.id} onRowClick={(r) => go(r)} empty={t.todoEmpty} search={true} searchPlaceholder={t.todoSearch} label={t.todos(todos.length)} />
						</Card>
					</div>
				</div>

				<SidePanel title={t.deadlines} sub={period ? t.deadlinesSub(period.code) : ''}>
					{sideItems.length ? (
						sideItems.map((d, i) => (
							<div key={d.key} style={S.deadline(i === sideItems.length - 1 && data.statutoryDeadlines !== false)}>
								<div style={S.deadlineTitle(d.tone)}>
									<span>{d.title}</span>
									{d.badge ? <Badge text={d.badge} tone={d.tone} /> : null}
								</div>
								<div class="s4vp-muted" style={S.small}>
									{d.text}
								</div>
								{d.link ? (
									<div style={S.linkRow}>
										<Button kind="link" label={d.link.label} ariaLabel={`${d.link.label}: ${d.title}`} onClick={() => go(d.link.go)} />
									</div>
								) : null}
							</div>
						))
					) : (
						<div class="s4vp-muted" style={S.small}>
							{t.deadlineEmpty}
						</div>
					)}
					{data.statutoryDeadlines === false ? <div class="s4vp-small">{t.noStatutory}</div> : null}
				</SidePanel>
			</div>
			{netOpen ? (
				<NetDialog
					t={t}
					data={data}
					onClose={() => setNetOpen(false)}
					onGo={(target) => {
						setNetOpen(false);
						go(target);
					}}
				/>
			) : null}
		</Page>
	);
}
