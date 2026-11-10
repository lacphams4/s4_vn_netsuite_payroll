/**
 * Chạy lương cho một bảng lương (mẫu docs/design/Main.dc.html). Tham số: id (bảng lương), tab (bộ lọc nhân viên mở sẵn:
 * review | error | over | new | left), line (dòng nhân viên chọn sẵn).
 *
 * Bố cục cha - con như màn bảng lương bản cũ, hai cột 50% - 50%: trái là lưới nhân viên, phải là khung chi tiết luôn hiện
 * (mặc định chọn dòng đầu). Dải tab: theo nhân viên (Thu nhập, Khấu trừ khác, Bảo hiểm, Thuế TNCN, Công, Giờ công, Phân bổ dự án,
 * Cấn trừ tạm ứng, So kỳ trước) và cấp bảng lương (Cần soát, Bút toán, Bill cơ quan thu).
 *
 * Dữ liệu: GET runView (api/PayrollRun) cho cả màn, kèm danh sách cảnh báo; GET runLine cho các tab của một nhân viên (tải theo
 * yêu cầu, chỉ khi đang ở tab theo nhân viên); GET journal (action cũ) khi mở tab Bút toán.
 * Thao tác dùng action cũ của RESTlet (loadEmployees, syncTime, saveTime, calculate, hold, removeHold, approve, reject, reopen,
 * release, reverse, agencyBills, clearJob, saveInput, deleteInput, jobStatus, journal, bankfile) và POST submitRun (gửi duyệt).
 * Mỗi bước một nút chính cho việc kế tiếp; nút khác nằm trong menu "In" và "Thao tác khác".
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post, openRecord, openJournal, printUrl, download, errorText} from '../lib/api.js';
import {money, num, fmtDate, toNumber, quickFilter} from '../lib/format.js';
import {pick, serverText} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Menu, Stepper, StatCards, Chips, Table, Badge, SearchBox, Dialog, Field, Select, TextInput, NumberInput, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		crumb: 'Chạy lương',
		batchOf: (p) => `Bảng lương kỳ ${p}`,
		loading: 'Đang tải bảng lương...',
		working: 'Đang xử lý...',
		noBatch: 'Chưa chọn bảng lương.',
		loadFailed: 'Không tải được bảng lương.',
		backToList: 'Về danh sách bảng lương',
		retry: 'Tải lại',
		status: {H: 'Tạm giữ', B: 'Chờ tính', C: 'Đã tính, chờ soát', P: 'Chờ duyệt', A: 'Đã duyệt, chờ ghi sổ', J: 'Bị từ chối', R: 'Đã ghi sổ', V: 'Đã đảo'},
		sub: {period: (a, b) => `Kỳ ${a} - ${b}`, group: (g) => `Nhóm lương ${g}`, payDate: (d) => `Ngày chi ${d}`, people: (n) => `${n} nhân viên`, periodClosed: 'Kỳ đã đóng'},
		steps: {prepare: 'Chuẩn bị', attendance: 'Công và giờ', calculate: 'Tính lương', review: 'Soát', approve: 'Duyệt', post: 'Chi lương và ghi sổ'},
		stepsLabel: 'Các bước chạy lương',
		notes: {
			employees: (n) => `${n} người`, locked: 'đã khóa', open: 'chưa khóa công', hold: 'đang tạm giữ', openChecks: (n) => `${n} điểm cần xem`,
			rejected: 'bị từ chối', pending: 'chờ duyệt', reversed: 'đã đảo',
		},
		print: 'In',
		more: 'Thao tác khác',
		log: 'Nhật ký',
		act: {
			loadEmployees: 'Tải nhân viên', syncTime: 'Đồng bộ giờ công', calculate: 'Tính lương', recalculate: 'Tính lại', removeHold: 'Bỏ tạm giữ', hold: 'Tạm giữ',
			submit: 'Gửi duyệt', approve: 'Duyệt', approveNow: 'Duyệt ngay (không qua gửi duyệt)', reject: 'Từ chối', reopen: 'Mở lại', release: 'Ghi sổ', reverse: 'Đảo bảng lương',
			completeRelease: 'Hoàn tất ghi sổ', completeReverse: 'Hoàn tất đảo', agencyBills: 'Lập bill cơ quan thu', clearJob: 'Gỡ khóa tác vụ nền (admin)',
			openAttendance: 'Mở chấm công để khóa công', openRecord: 'Mở bản ghi NetSuite', legacy: 'Màn hình cũ', refresh: 'Tải lại',
			payslips: 'Phiếu lương', paymentSheet: 'Bảng thanh toán lương', contractor: 'Quyết toán cộng tác viên', bankFile: 'File chi lương ngân hàng', journal: 'Xem bút toán',
		},
		hrNoRelease: 'Vai trò nhân sự không ghi sổ; kế toán thực hiện bước này.',
		confirm: {
			submit: 'Gửi bảng lương này đi duyệt? Sau khi gửi không sửa, không tính lại được cho đến khi mở lại.',
			submitOpen: (n) => `Còn ${n} điểm kiểm tra chưa xử lý. Vẫn gửi bảng lương này đi duyệt?`,
			approve: 'Duyệt bảng lương này? Sau khi duyệt, số liệu bị khóa cho đến khi mở lại.',
			approveOpen: (n) => `Còn ${n} điểm kiểm tra chưa xử lý. Vẫn duyệt bảng lương này?`,
			reject: 'Từ chối bảng lương này? Người lập phải mở lại để sửa.',
			reopen: 'Mở lại bảng lương này? Bảng lương về trạng thái tạm giữ, thông tin duyệt bị xóa và phải tính, duyệt lại.',
			release: 'Ghi sổ bảng lương này? Hệ thống tạo bút toán và cấn trừ tạm ứng.',
			reverse: 'Đảo bảng lương này? Hệ thống tạo bút toán đảo và hoàn số dư tạm ứng.',
			agencyBills: 'Lập bill nộp cơ quan BHXH, công đoàn, thuế?',
			clearJob: 'Gỡ khóa tác vụ nền? Chỉ dùng khi chắc chắn không còn tác vụ nào đang chạy cho bảng lương này.',
			deleteInput: (name) => `Xóa khoản nhập tay "${name}"? Bảng lương sẽ cần tính lại.`,
		},
		done: {
			ok: 'Đã thực hiện',
			loaded: (r) => `Đã nạp ${(r.added || []).length} người${(r.skipped || []).length ? `, bỏ qua ${(r.skipped || []).length} người đã ở bảng lương khác cùng kỳ` : ''}`,
			timeSynced: (r) => `Giờ công: nhận ${r.accepted || 0}/${r.entries || 0} dòng timesheet${r.pending ? ` (${r.pending} dòng chưa duyệt hoặc bị từ chối)` : ''}`,
			queued: 'Đã đưa vào hàng đợi tính lương nền. Màn hình tự cập nhật khi tính xong.',
			calcOk: 'Đã tính xong, không có lỗi',
			calcErrors: (n) => `Đã tính, có ${n} nhân viên lỗi - xem tab Cần soát`,
			submitted: 'Đã gửi duyệt',
			approved: 'Đã duyệt bảng lương',
			rejected: 'Đã từ chối bảng lương',
			reopened: 'Đã mở lại bảng lương',
			released: 'Đã ghi sổ bảng lương',
			reversed: 'Đã đảo bảng lương',
			resumed: 'Đã hoàn tất các bước còn thiếu',
			bills: (r) => `Đã lập ${(r.created || []).length} bill${(r.skipped || []).length ? `; khoản chưa có cơ quan thu: ${(r.skipped || []).map((s) => s.code).join(', ')}` : ''}`,
			inputSaved: 'Đã lưu khoản nhập tay. Bấm Tính lương để cập nhật số liệu.',
			inputDeleted: 'Đã xóa khoản nhập tay. Bấm Tính lương để cập nhật số liệu.',
			timeSaved: 'Đã lưu giờ công. Bấm Tính lương để cập nhật số liệu.',
			jobDone: 'Tác vụ nền đã xong, số liệu đã được cập nhật.',
		},
		job: {
			title: 'Đang xử lý nền',
			calc: 'Đang tính lương nền (bảng lương lớn).',
			queued: 'Đang chờ trong hàng đợi tính lương.',
			release: 'Đang ghi sổ.',
			reverse: 'Đang đảo.',
			stage: (s, st) => `Trạng thái: ${st || '...'}${s ? ` - giai đoạn ${s}` : ''}.`,
			auto: 'Màn hình tự nạp lại khi xong; trong lúc này không thao tác được trên bảng lương.',
		},
		cards: {
			net: 'Thực lĩnh phải chi', ins: 'Bảo hiểm phải nộp', pit: 'Thuế TNCN phải nộp', cost: 'Tổng chi phí công ty',
			insNote: (ee, er) => `Người lao động ${ee} · Công ty ${er}`,
			pitNote: (e, c) => `Nhân viên ${e} · Cộng tác viên ${c}`,
			costNote: (g) => `Tổng thu nhập ${g} + BH công ty`,
			up: (p, per) => `Tăng ${p} so với kỳ ${per}`,
			down: (p, per) => `Giảm ${p} so với kỳ ${per}`,
			same: (per) => `Không đổi so với kỳ ${per}`,
			changed: (per) => `Kỳ ${per}: `,
			noPrev: 'Chưa có kỳ trước để so sánh',
			notCalculated: 'Chưa tính lương',
		},
		checks: {
			partial: (n, total) => `Đang hiện ${n} / ${total} điểm (lỗi và điểm chưa xử lý trước)`,
			viewAll: 'Xem tất cả',
			title: 'Kiểm tra trước khi duyệt',
			open: 'Cần xử lý', done: 'Đã xử lý',
			search: 'Tìm quy tắc, nhân viên',
			none: 'Không có điểm nào cần xử lý.',
			noneDone: 'Chưa có điểm nào đã xử lý.',
			cols: {title: 'Nội dung', employee: 'Nhân viên', note: 'Chi tiết', status: 'Trạng thái', assignee: 'Người xử lý', action: 'Xử lý'},
			status: {open: 'Chưa xử lý', accepted: 'Đã chấp nhận', resolved: 'Đã xử lý'},
			unassigned: 'Chưa giao',
			openItem: 'Mở',
			calcError: 'Lỗi tính lương',
			calcMessage: 'Thông báo khi tính lương',
			attOpen: 'Công của kỳ chưa khóa',
			attOpenNote: 'Lương đang tính theo số công hiện có; khóa công ở Chấm công rồi tính lại.',
			allBatch: 'Cả bảng lương',
		},
		emp: {
			title: 'Nhân viên',
			filters: {all: 'Tất cả', review: 'Cần xem', error: 'Lỗi', over: (p) => `Lệch trên ${p}`, isNew: 'Người mới', left: 'Không còn'},
			filterLabel: 'Lọc nhân viên',
			search: 'Tên, mã, số tiền',
			searchLabel: 'Tìm nhân viên',
			matches: (n) => `${n} dòng khớp`,
			empty: 'Bảng lương chưa có nhân viên. Bấm Tải nhân viên.',
			emptyFilter: 'Không có nhân viên nào khớp bộ lọc.',
			more: (n) => `Hiện thêm ${n} dòng`,
			showing: (a, b) => `Đang hiện ${a} / ${b} dòng`,
			total: (n) => `Tổng ${n} nhân viên`,
			cols: {name: 'Nhân viên', days: 'Công', gross: 'Tổng thu nhập', eeIns: 'BH NLĐ', pit: 'Thuế TNCN', net: 'Thực lĩnh', cmp: 'So kỳ trước', note: 'Ghi chú'},
			type: {E: 'Nhân viên', C: 'Cộng tác viên'},
			first: 'Kỳ đầu',
			gone: 'Không còn',
			noCmp: '',
			review: (n) => `${n} cần xem`,
			error: 'Lỗi',
			warning: 'Cảnh báo',
			compareWith: (name, per) => `So với ${name} (kỳ ${per})`,
			compareStats: (j, l, o, p) => `${j} người mới · ${l} người không còn · ${o} người lệch trên ${p}`,
		},
		panel: {
			loading: 'Đang tải chi tiết...',
			failed: 'Không tải được chi tiết nhân viên.',
			tabs: {
				earn: 'Thu nhập', ded: 'Khấu trừ khác', ins: 'Bảo hiểm', tax: 'Thuế TNCN', att: 'Công', time: 'Giờ công', alloc: 'Phân bổ dự án', adv: 'Cấn trừ tạm ứng', cmp: 'So kỳ trước',
				checks: 'Cần soát', journal: 'Bút toán', bills: 'Bill cơ quan thu',
			},
			tabsLabel: 'Chi tiết bảng lương',
			groupBatch: 'Bảng lương',
			batchTitle: 'Cả bảng lương',
			noLine: 'Chưa chọn nhân viên',
			search: 'Tìm khoản, số tiền',
			addEarning: 'Thêm khoản thu nhập',
			addDeduction: 'Thêm khoản khấu trừ',
			delete: 'Xóa',
			cols: {
				item: 'Khoản', amount: 'Số tiền', exempt: 'Miễn thuế', code: 'Mã', memo: 'Diễn giải', base: 'Căn cứ', eeRate: 'Tỷ lệ NLĐ', ee: 'NLĐ đóng', erRate: 'Tỷ lệ DN', er: 'DN đóng',
				project: 'Dự án / khách hàng', projectOnly: 'Dự án', task: 'Công việc', branch: 'Địa điểm', workCenter: 'Class', source: 'Nguồn', allocHours: 'Số giờ',
				entries: 'Số dòng', hours: 'Giờ tính lương', sourceHours: 'Giờ timesheet', reason: 'Lý do sửa', date: 'Ngày', sheetHours: 'Số giờ', approval: 'Trạng thái duyệt', counted: 'Tính lương',
				note: 'Ghi chú', component: 'Khoản trích', ratio: 'Tỷ lệ', current: 'Kỳ này', previous: 'Kỳ trước', diff: 'Chênh', label: 'Chỉ tiêu', value: 'Giá trị',
				advanceNbr: 'Số tạm ứng', offset: 'Đã cấn trừ', balanceAfter: 'Số dư còn lại', document: 'Chứng từ',
			},
			src: {S: 'Hệ thống', T: 'Giờ công', M: 'Nhập tay', O: 'Sản lượng'},
			att: {std_days: 'Công chuẩn', work_days: 'Công hưởng lương', paid_leave: 'Nghỉ có lương', unpaid_leave: 'Nghỉ không lương', si_leave: 'Nghỉ ốm, thai sản (BHXH)', absence_days: 'Ngày nghỉ xét đóng BH', ot_hours: 'Giờ làm thêm', att_locked: 'Công đã khóa'},
			yes: 'Có', no: 'Chưa',
			allocSrc: {P: 'Bảng tỷ lệ', T: 'Giờ công', R: 'Theo tổ', D: 'Mặc định', S: 'Sản lượng'},
			time: {
				title: 'Giờ công tính lương',
				hint: 'Giờ lấy từ Time (timesheet) của NetSuite khi bấm Nạp giờ công hoặc Tải nhân viên, gộp theo dự án và công việc trong kỳ. Sửa giờ phải ghi lý do; nạp lại vẫn giữ giờ đã sửa. Giờ thường dùng cho lương giờ và phân bổ dự án; giờ làm thêm lấy từ đơn làm thêm đã duyệt.',
				none: '(không gắn dự án)', edit: 'Sửa giờ', sync: 'Nạp giờ công', save: 'Lưu giờ',
				editTitle: (n) => `Sửa giờ công: ${n}`,
				editHint: 'Giờ tính lương khác giờ timesheet thì phải ghi lý do. Sau khi lưu cần tính lại lương.',
				sheetTitle: (f, to) => `Timesheet từng ngày (${f} - ${to})`,
				sheetFailed: 'Không đọc được timesheet từ Time của NetSuite:',
				approval: {A: 'Đã duyệt', P: 'Chờ duyệt / mở', R: 'Từ chối', N: 'Không dùng duyệt'},
			},
			tax: {
				gross: 'Tổng thu nhập', exempt: 'Thu nhập miễn thuế', taxable: 'Thu nhập chịu thuế', insurance: 'Bảo hiểm bắt buộc được trừ', self: 'Giảm trừ bản thân',
				dependents: 'Số người phụ thuộc', dependentDeduction: 'Giảm trừ người phụ thuộc', family: 'Giảm trừ gia cảnh (bản thân và người phụ thuộc)', other: 'Giảm trừ khác',
				assessable: 'Thu nhập tính thuế', method: 'Phương pháp tính thuế', commitment: 'Có cam kết thu nhập (không khấu trừ)', pit: 'Thuế TNCN',
				methods: {P: 'Lũy tiến từng phần', F: 'Khấu trừ theo tỷ lệ cố định', N: 'Không cư trú', X: 'Không khấu trừ'},
				note: 'Số liệu là kết quả lần tính lương gần nhất của gói, màn hình không tính lại. Phương pháp tính thuế lấy từ hồ sơ lương hiện tại.',
			},
			sum: {gross: 'Tổng thu nhập', eeIns: 'Bảo hiểm người lao động', pit: 'Thuế TNCN', otherDed: 'Khấu trừ khác', advance: 'Cấn trừ tạm ứng', net: 'Thực lĩnh', erIns: 'Bảo hiểm công ty đóng'},
			cmpKeys: {gross: 'Tổng thu nhập', ee_ins: 'BH người lao động', er_ins: 'BH công ty', pit: 'Thuế TNCN', net: 'Thực lĩnh'},
			cmpNone: 'Chưa có kỳ trước để so sánh.',
			cmpNew: (name) => `Nhân viên không có trong ${name} (người mới ở kỳ này).`,
			cmpWith: (name) => `So với ${name}`,
			cmpItems: 'Các khoản thu nhập',
			kind: {new: 'mới', gone: 'không còn'},
			leftNote: (name) => `Nhân viên có ở ${name} nhưng không có trong bảng lương này.`,
			prevNet: 'Thực lĩnh kỳ trước',
		},
		input: {
			earningType: 'Loại thu nhập', pickType: 'Chọn loại thu nhập', memo: 'Diễn giải', qty: 'Số lượng', rate: 'Đơn giá', mult: 'Hệ số', code: 'Mã khấu trừ', amount: 'Số tiền',
			hintE: 'Số tiền = số lượng × đơn giá × hệ số. Sau khi lưu cần tính lại lương.',
			hintD: 'Khấu trừ sau thuế. Sau khi lưu cần tính lại lương.',
			save: 'Lưu', cancel: 'Hủy',
			forEmp: (n) => `cho ${n}`,
		},
		journal: {
			title: 'Bút toán dự kiến', titleReleased: 'Bút toán đã ghi sổ', close: 'Đóng', search: 'Tìm tài khoản, diễn giải, số tiền',
			cols: {account: 'Tài khoản', memo: 'Diễn giải', debit: 'Nợ', credit: 'Có', dim: 'Phòng ban / địa điểm / dự án'},
			total: 'Tổng',
			notReady: 'Bảng lương chưa tính, chưa có bút toán dự kiến.',
			loading: 'Đang dựng bút toán...',
			failed: 'Không dựng được bút toán:',
		},
		bills: {empty: 'Chưa lập bill cơ quan thu. Bill được lập sau khi ghi sổ bảng lương.'},
		docs: {journal: 'Bút toán ghi sổ', reversal: 'Bút toán đảo', bills: (n) => `${n} bill cơ quan thu`, posted: 'đã ghi sổ', pending: 'chưa ghi sổ, chờ duyệt', voided: 'đã hủy'},
	},
	en: {
		crumb: 'Run payroll',
		batchOf: (p) => `Payroll for period ${p}`,
		loading: 'Loading the payroll batch...',
		working: 'Working...',
		noBatch: 'No payroll batch selected.',
		loadFailed: 'The payroll batch could not be loaded.',
		backToList: 'Back to payroll batches',
		retry: 'Refresh',
		status: {H: 'On hold', B: 'Pending calculation', C: 'Calculated, pending review', P: 'Pending approval', A: 'Approved, pending release', J: 'Rejected', R: 'Released', V: 'Reversed'},
		sub: {period: (a, b) => `Period ${a} - ${b}`, group: (g) => `Pay group ${g}`, payDate: (d) => `Pay date ${d}`, people: (n) => `${n} employees`, periodClosed: 'Period closed'},
		steps: {prepare: 'Prepare', attendance: 'Attendance and hours', calculate: 'Calculate', review: 'Review', approve: 'Approve', post: 'Pay and post'},
		stepsLabel: 'Payroll run steps',
		notes: {
			employees: (n) => `${n} people`, locked: 'locked', open: 'attendance not locked', hold: 'on hold', openChecks: (n) => `${n} items to review`,
			rejected: 'rejected', pending: 'pending approval', reversed: 'reversed',
		},
		print: 'Print',
		more: 'More actions',
		log: 'Activity log',
		act: {
			loadEmployees: 'Load employees', syncTime: 'Sync hours', calculate: 'Calculate', recalculate: 'Recalculate', removeHold: 'Remove hold', hold: 'Put on hold',
			submit: 'Submit for approval', approve: 'Approve', approveNow: 'Approve now (skip submission)', reject: 'Reject', reopen: 'Reopen', release: 'Release', reverse: 'Reverse batch',
			completeRelease: 'Complete release', completeReverse: 'Complete reversal', agencyBills: 'Create agency bills', clearJob: 'Clear background job lock (admin)',
			openAttendance: 'Open attendance to lock it', openRecord: 'Open NetSuite record', legacy: 'Previous screen', refresh: 'Refresh',
			payslips: 'Payslips', paymentSheet: 'Payment sheet', contractor: 'Contractor settlement', bankFile: 'Bank payment file', journal: 'View journal',
		},
		hrNoRelease: 'The HR role cannot release; an accountant performs this step.',
		confirm: {
			submit: 'Submit this batch for approval? It cannot be edited or recalculated until it is reopened.',
			submitOpen: (n) => `${n} review items are still open. Submit this batch for approval anyway?`,
			approve: 'Approve this batch? Figures are locked until it is reopened.',
			approveOpen: (n) => `${n} review items are still open. Approve this batch anyway?`,
			reject: 'Reject this batch? The preparer must reopen it to make changes.',
			reopen: 'Reopen this batch? It returns to on hold, approval details are cleared, and it must be calculated and approved again.',
			release: 'Release this batch? The system creates the journal entry and offsets advances.',
			reverse: 'Reverse this batch? The system creates a reversing journal and restores advance balances.',
			agencyBills: 'Create bills for the social insurance, union and tax agencies?',
			clearJob: 'Clear the background job lock? Use only when you are sure no job is still running for this batch.',
			deleteInput: (name) => `Delete the manual line "${name}"? The batch will need to be recalculated.`,
		},
		done: {
			ok: 'Done',
			loaded: (r) => `Loaded ${(r.added || []).length} employees${(r.skipped || []).length ? `, skipped ${(r.skipped || []).length} already on another batch of the period` : ''}`,
			timeSynced: (r) => `Hours: ${r.accepted || 0}/${r.entries || 0} timesheet entries accepted${r.pending ? ` (${r.pending} pending or rejected)` : ''}`,
			queued: 'Queued for background calculation. This screen updates when it finishes.',
			calcOk: 'Calculated with no errors',
			calcErrors: (n) => `Calculated with ${n} employee errors - see the To review tab`,
			submitted: 'Submitted for approval',
			approved: 'Batch approved',
			rejected: 'Batch rejected',
			reopened: 'Batch reopened',
			released: 'Batch released',
			reversed: 'Batch reversed',
			resumed: 'Remaining steps completed',
			bills: (r) => `Created ${(r.created || []).length} bills${(r.skipped || []).length ? `; no agency vendor for: ${(r.skipped || []).map((s) => s.code).join(', ')}` : ''}`,
			inputSaved: 'Manual line saved. Click Calculate to update the figures.',
			inputDeleted: 'Manual line deleted. Click Calculate to update the figures.',
			timeSaved: 'Hours saved. Click Calculate to update the figures.',
			jobDone: 'The background job finished; figures are up to date.',
		},
		job: {
			title: 'Background processing',
			calc: 'Calculating in the background (large batch).',
			queued: 'Waiting in the calculation queue.',
			release: 'Releasing.',
			reverse: 'Reversing.',
			stage: (s, st) => `Status: ${st || '...'}${s ? ` - stage ${s}` : ''}.`,
			auto: 'This screen reloads when it finishes; the batch cannot be changed meanwhile.',
		},
		cards: {
			net: 'Net pay to disburse', ins: 'Insurance payable', pit: 'PIT payable', cost: 'Total company cost',
			insNote: (ee, er) => `Employees ${ee} · Company ${er}`,
			pitNote: (e, c) => `Employees ${e} · Contractors ${c}`,
			costNote: (g) => `Gross ${g} + employer insurance`,
			up: (p, per) => `Up ${p} from period ${per}`,
			down: (p, per) => `Down ${p} from period ${per}`,
			same: (per) => `Unchanged from period ${per}`,
			changed: (per) => `Period ${per}: `,
			noPrev: 'No previous period to compare',
			notCalculated: 'Not calculated yet',
		},
		checks: {
			partial: (n, total) => `Showing ${n} of ${total} items (errors and open items first)`,
			viewAll: 'View all',
			title: 'Checks before approval',
			open: 'To do', done: 'Handled',
			search: 'Search rule, employee',
			none: 'Nothing needs attention.',
			noneDone: 'Nothing has been handled yet.',
			cols: {title: 'Item', employee: 'Employee', note: 'Details', status: 'Status', assignee: 'Assignee', action: 'Action'},
			status: {open: 'Open', accepted: 'Accepted', resolved: 'Resolved'},
			unassigned: 'Unassigned',
			openItem: 'Open',
			calcError: 'Calculation error',
			calcMessage: 'Calculation message',
			attOpen: 'Attendance for the period is not locked',
			attOpenNote: 'Pay is calculated from the current attendance; lock attendance, then recalculate.',
			allBatch: 'Whole batch',
		},
		emp: {
			title: 'Employees',
			filters: {all: 'All', review: 'To review', error: 'Errors', over: (p) => `Over ${p}`, isNew: 'New', left: 'Left'},
			filterLabel: 'Filter employees',
			search: 'Name, code, amount',
			searchLabel: 'Search employees',
			matches: (n) => `${n} matching rows`,
			empty: 'This batch has no employees yet. Click Load employees.',
			emptyFilter: 'No employees match the filter.',
			more: (n) => `Show ${n} more rows`,
			showing: (a, b) => `Showing ${a} of ${b} rows`,
			total: (n) => `Total of ${n} employees`,
			cols: {name: 'Employee', days: 'Days', gross: 'Gross', eeIns: 'EE insurance', pit: 'PIT', net: 'Net pay', cmp: 'Vs previous', note: 'Notes'},
			type: {E: 'Employee', C: 'Contractor'},
			first: 'First period',
			gone: 'Left',
			noCmp: '',
			review: (n) => `${n} to review`,
			error: 'Error',
			warning: 'Warning',
			compareWith: (name, per) => `Compared with ${name} (period ${per})`,
			compareStats: (j, l, o, p) => `${j} new · ${l} no longer on the batch · ${o} over ${p}`,
		},
		panel: {
			loading: 'Loading details...',
			failed: 'The employee details could not be loaded.',
			tabs: {
				earn: 'Earnings', ded: 'Other deductions', ins: 'Insurance', tax: 'PIT', att: 'Attendance', time: 'Hours', alloc: 'Project allocation', adv: 'Advance offset', cmp: 'Vs previous',
				checks: 'To review', journal: 'Journal', bills: 'Agency bills',
			},
			tabsLabel: 'Payroll batch details',
			groupBatch: 'Batch',
			batchTitle: 'Whole batch',
			noLine: 'No employee selected',
			search: 'Search item, amount',
			addEarning: 'Add earning',
			addDeduction: 'Add deduction',
			delete: 'Delete',
			cols: {
				item: 'Item', amount: 'Amount', exempt: 'Tax exempt', code: 'Code', memo: 'Description', base: 'Wage base', eeRate: 'Employee rate', ee: 'Employee', erRate: 'Employer rate', er: 'Employer',
				project: 'Project / customer', projectOnly: 'Project', task: 'Task', branch: 'Location', workCenter: 'Class', source: 'Source', allocHours: 'Hours',
				entries: 'Entries', hours: 'Payroll hours', sourceHours: 'Timesheet hours', reason: 'Reason for change', date: 'Date', sheetHours: 'Hours', approval: 'Approval status', counted: 'Counted',
				note: 'Memo', component: 'Component', ratio: 'Ratio', current: 'This period', previous: 'Previous', diff: 'Change', label: 'Item', value: 'Value',
				advanceNbr: 'Advance number', offset: 'Offset', balanceAfter: 'Remaining balance', document: 'Document',
			},
			src: {S: 'System', T: 'Time', M: 'Manual', O: 'Output'},
			att: {std_days: 'Standard days', work_days: 'Paid work days', paid_leave: 'Paid leave', unpaid_leave: 'Unpaid leave', si_leave: 'Sick and maternity leave (social insurance)', absence_days: 'Absence days for insurance', ot_hours: 'Overtime hours', att_locked: 'Attendance locked'},
			yes: 'Yes', no: 'No',
			allocSrc: {P: 'Ratio table', T: 'Timesheet', R: 'By team', D: 'Default', S: 'Output'},
			time: {
				title: 'Payroll hours',
				hint: 'Hours come from NetSuite Time (timesheets) when you click Load hours or Load employees, grouped by project and task within the period. Editing hours requires a reason; edited hours are kept when hours are loaded again. Regular hours feed hourly pay and project allocation; overtime hours come from approved overtime requests.',
				none: '(no project)', edit: 'Edit hours', sync: 'Load hours', save: 'Save hours',
				editTitle: (n) => `Edit hours: ${n}`,
				editHint: 'A reason is required when payroll hours differ from the timesheet. Recalculate after saving.',
				sheetTitle: (f, to) => `Daily timesheet (${f} - ${to})`,
				sheetFailed: 'The timesheet could not be read from NetSuite Time:',
				approval: {A: 'Approved', P: 'Pending / open', R: 'Rejected', N: 'Approval not used'},
			},
			tax: {
				gross: 'Gross income', exempt: 'Tax-exempt income', taxable: 'Taxable income', insurance: 'Deductible compulsory insurance', self: 'Personal deduction',
				dependents: 'Number of dependents', dependentDeduction: 'Dependent deduction', family: 'Family deduction (personal and dependents)', other: 'Other deductions',
				assessable: 'Assessable income', method: 'Tax method', commitment: 'Income commitment filed (no withholding)', pit: 'PIT',
				methods: {P: 'Progressive', F: 'Flat-rate withholding', N: 'Non-resident', X: 'No withholding'},
				note: 'Figures are the result of the latest payroll calculation; this screen does not recalculate. The tax method comes from the current payroll profile.',
			},
			sum: {gross: 'Gross', eeIns: 'Employee insurance', pit: 'PIT', otherDed: 'Other deductions', advance: 'Advance offset', net: 'Net pay', erIns: 'Employer insurance'},
			cmpKeys: {gross: 'Gross', ee_ins: 'Employee insurance', er_ins: 'Employer insurance', pit: 'PIT', net: 'Net pay'},
			cmpNone: 'No previous period to compare.',
			cmpNew: (name) => `The employee is not on ${name} (new in this period).`,
			cmpWith: (name) => `Compared with ${name}`,
			cmpItems: 'Earnings',
			kind: {new: 'new', gone: 'gone'},
			leftNote: (name) => `The employee is on ${name} but not on this batch.`,
			prevNet: 'Previous net pay',
		},
		input: {
			earningType: 'Earning type', pickType: 'Select an earning type', memo: 'Description', qty: 'Quantity', rate: 'Rate', mult: 'Multiplier', code: 'Deduction code', amount: 'Amount',
			hintE: 'Amount = quantity × rate × multiplier. Recalculate after saving.',
			hintD: 'After-tax deduction. Recalculate after saving.',
			save: 'Save', cancel: 'Cancel',
			forEmp: (n) => `for ${n}`,
		},
		journal: {
			title: 'Journal preview', titleReleased: 'Released journal', close: 'Close', search: 'Search account, memo, amount',
			cols: {account: 'Account', memo: 'Memo', debit: 'Debit', credit: 'Credit', dim: 'Department / location / project'},
			total: 'Total',
			notReady: 'The batch has not been calculated; there is no journal preview yet.',
			loading: 'Building the journal...',
			failed: 'The journal could not be built:',
		},
		bills: {empty: 'No agency bills yet. Bills are created after the batch is released.'},
		docs: {journal: 'Release journal', reversal: 'Reversal journal', bills: (n) => `${n} agency bills`, posted: 'posted', pending: 'not posted, pending approval', voided: 'voided'},
	},
};

const TONE = {H: 'muted', B: 'info', C: 'ok', P: 'warn', A: 'ok', J: 'error', R: 'ok', V: 'muted'};
const NO_CHECKS = {counts: null, items: []};
const PAGE_SIZE = 200;
const EMPTY_FORM = {earning_type: '', description: '', qty: '', rate: '', multiplier: '', code: '', amount: ''};
const FILTERS = ['all', 'review', 'error', 'over', 'new', 'left'];
// Tab của khung chi tiết: theo nhân viên đang chọn (dữ liệu runLine) và cấp bảng lương
const LINE_TABS = ['earn', 'ded', 'ins', 'tax', 'att', 'time', 'alloc', 'adv', 'cmp'];
const BATCH_TABS = ['checks', 'journal', 'bills'];
const EMPTY_TIME = {id: '', hours: '', reason: '', label: ''};
const blank = (v) => v === null || v === undefined || v === '';
const n0 = (v) => Number(v) || 0;

// Phần trăm có dấu, một chữ số thập phân: +15% / -1,2% / 0%
const signedPct = (p) => {
	if (blank(p)) return '';
	const v = Math.round(Number(p) * 1000) / 10;
	if (!v) return '0%';
	return `${v > 0 ? '+' : '-'}${Math.abs(v).toLocaleString('vi-VN', {maximumFractionDigits: 1})}%`;
};
const absPct = (p) => `${(Math.round(Math.abs(Number(p) || 0) * 1000) / 10).toLocaleString('vi-VN', {maximumFractionDigits: 1})}%`;
// Số tiền chênh có dấu (số 0 hiện "-")
const signedMoney = (v) => {
	if (blank(v)) return '';
	const r = Math.round(Number(v));
	if (!r) return '-';
	return `${r > 0 ? '+' : '-'}${Math.abs(r).toLocaleString('vi-VN')}`;
};
// POST action cũ: lỗi phân quyền trả ở khóa error / errorVi (không ném) - đổi thành lỗi để app.run báo
const send = (body) =>
	post(body).then((r) => {
		if (r && r.error) throw {message: serverText(r.error, r.errorVi)};
		return r;
	});
// Danh sách cảnh báo (mục 9): API chưa có hoặc lỗi thì coi như rỗng
const loadChecks = (batch) =>
	call({action: 'checksList', batch}).then(
		(r) => (r && !r.error && Array.isArray(r.items) ? {counts: r.counts || null, items: r.items} : NO_CHECKS),
		() => NO_CHECKS
	);
// Lỗi mức error chặn duyệt, không đóng tay được: luôn nằm ở nhóm cần xử lý
const isOpenCheck = (c) => (c.status || 'open') === 'open' || c.severity === 'error';
const nameOf = (l) => [l.code, l.name].filter(Boolean).join(' ');

/**
 * Danh sách của tab "Cần soát": lỗi tính lương theo dòng, thông báo khi tính, công chưa khóa (màn hình tự dựng) rồi tới cảnh báo
 * của phân hệ Kiểm tra. Trả {openRows, doneRows}.
 */
function buildAttention(data, checkItems, t) {
	const b = data.batch || {};
	const period = data.period || {};
	const s = String(b.status || '');
	const lines = Array.isArray(data.lines) ? data.lines : [];
	const items = (Array.isArray(checkItems) ? checkItems : []).filter(Boolean);
	const own = [];
	const errorLines = lines.filter((l) => !blank(l.error));
	// Phân hệ Kiểm tra đã báo lỗi tính lương của nhân viên (quy tắc CALC_ERROR) thì không lặp lại dòng tự dựng
	const reported = {};
	items.forEach((c) => {
		if (c.rule === 'CALC_ERROR' && !blank(c.employee)) reported[String(c.employee)] = true;
	});
	errorLines.filter((l) => !reported[String(l.employee)]).forEach((l) => own.push({id: `err:${l.id}`, severity: 'error', title: t.checks.calcError, employeeText: nameOf(l), note: String(l.error), status: 'open', lineId: l.id}));
	if (!errorLines.length) (b.messages || []).forEach((m, i) => own.push({id: `msg:${i}`, severity: 'error', title: t.checks.calcMessage, employeeText: t.checks.allBatch, note: String(m), status: 'open'}));
	if (b.calculated && period.id && period.att_status !== 'L' && ['H', 'B', 'C', 'P'].indexOf(s) >= 0) own.push({id: 'att', severity: 'warn', title: t.checks.attOpen, employeeText: t.checks.allBatch, note: t.checks.attOpenNote, status: 'open', attendance: true});
	const checkRow = (c, i) => ({
		id: `chk:${c.key || `${c.rule}:${c.employee || ''}`}:${i}`, severity: c.severity || 'warn', title: c.title || c.rule || '', employeeText: blank(c.employee) ? t.checks.allBatch : [c.employeeCode, c.employeeName].filter(Boolean).join(' ') || String(c.employee),
		note: [c.headline, c.note, blank(c.amount) || !Number(c.amount) ? '' : money(c.amount)].filter(Boolean).join(' · '), status: isOpenCheck(c) ? 'open' : c.status, statusText: t.checks.status[isOpenCheck(c) ? 'open' : c.status] || '',
		assignee: c.assigneeName || c.assignee || '', rule: c.rule, employee: blank(c.employee) ? '' : String(c.employee),
	});
	return {openRows: own.concat(items.filter(isOpenCheck).map(checkRow)), doneRows: items.filter((c) => !isOpenCheck(c)).map(checkRow)};
}

const jobKind = (job) => (!job ? '' : /^release:/.test(job) ? 'release' : /^reverse:/.test(job) ? 'reverse' : job === 'queued' ? 'queued' : 'calc');

export default function PayrollRunView({app}) {
	const t = pick(TEXT);
	const boot = app.boot || {};
	const user = boot.user || {};
	const params = (app.route && app.route.params) || {};
	const id = String(params.id || '');
	const [data, setData] = useState(null);
	const [checks, setChecks] = useState(NO_CHECKS);
	const [failed, setFailed] = useState(false);
	const [version, setVersion] = useState(0);
	const [filter, setFilter] = useState(FILTERS.indexOf(params.tab) >= 0 ? params.tab : 'all');
	const [query, setQuery] = useState('');
	const [limit, setLimit] = useState(PAGE_SIZE);
	const [checkTab, setCheckTab] = useState('open');
	const [selected, setSelected] = useState(params.line ? String(params.line) : '');
	const [detail, setDetail] = useState(null);
	const [tab, setTab] = useState('earn');
	const [dialog, setDialog] = useState(null);
	const [jobInfo, setJobInfo] = useState(null);
	const [journal, setJournal] = useState(null);
	const formRef = useRef(EMPTY_FORM);
	const [form, setForm] = useState(EMPTY_FORM);
	const timeRef = useRef(EMPTY_TIME);
	const [timeForm, setTimeForm] = useState(EMPTY_TIME);
	const lineTab = useRef('earn');
	const tabInit = useRef('');
	const journalKey = useRef('');
	const alive = useRef(true);
	const request = useRef(0);
	const detailRequest = useRef(0);
	const versionRef = useRef(0);
	const hadJob = useRef(false);
	const lastId = useRef(id);

	// silent: nạp lại sau thao tác hoặc khi tác vụ nền chạy (không hiện "đang tải", lỗi thì giữ số liệu cũ)
	const load = (silent) => {
		if (!id) return Promise.resolve();
		request.current += 1;
		const mine = request.current;
		// runView trả kèm danh sách cảnh báo (một lượt gọi); máy chủ bản cũ không trả thì mới gọi checksList
		const work = call({action: 'runView', id}).then((v) =>
			v && v.checksList && Array.isArray(v.checksList.items) ? [v, {counts: v.checksList.counts || null, items: v.checksList.items, total: v.checksList.total || 0, truncated: !!v.checksList.truncated, byEmployee: v.checksList.byEmployee || null}] : loadChecks(id).then((c) => [v, c])
		);
		const apply = (r) => {
			if (!alive.current || mine !== request.current) return undefined;
			if (!r || !r[0] || !r[0].batch) {
				if (!silent) setFailed(true);
				return undefined;
			}
			versionRef.current += 1;
			// Lần nạp đầu của một bảng lương: đang ở bước Soát mà còn điểm cần soát thì mở sẵn tab Cần soát
			if (tabInit.current !== id) {
				tabInit.current = id;
				let first = 'earn';
				try {
					if (!params.line && r[0].progress && r[0].progress.currentKey === 'review' && buildAttention(r[0], (r[1] || NO_CHECKS).items, t).openRows.length) first = 'checks';
				} catch (e) {
					first = 'earn';
				}
				lineTab.current = 'earn';
				setTab(first);
			}
			setFailed(false);
			setData(r[0]);
			setChecks(r[1] || NO_CHECKS);
			setVersion(versionRef.current);
			return r[0];
		};
		return silent ? work.then(apply, () => undefined) : app.run(t.loading, work).then(apply);
	};

	useEffect(() => {
		alive.current = true;
		// Sang bảng lương khác trong cùng màn: bỏ số liệu, nhân viên đang chọn và trạng thái tác vụ nền của bảng cũ
		if (lastId.current !== id) {
			lastId.current = id;
			setSelected('');
			setQuery('');
			setFilter('all');
		}
		hadJob.current = false;
		setJobInfo(null);
		setData(null);
		setDetail(null);
		journalKey.current = '';
		setJournal(null);
		load(false);
		return () => {
			alive.current = false;
		};
	}, [id]);

	// Nhân viên đang chọn: như màn cũ, chưa chọn (hoặc dòng đã chọn không còn) thì lấy dòng đầu tiên của bảng lương
	const prevId = data && data.compare && data.compare.previous ? data.compare.previous.id : '';
	const isLeaver = selected.indexOf('left:') === 0;
	const loadedLines = data && Array.isArray(data.lines) ? data.lines : [];
	const sel = selected && (isLeaver || loadedLines.some((l) => String(l.id) === selected)) ? selected : loadedLines.length ? String(loadedLines[0].id) : '';
	const onLineTab = BATCH_TABS.indexOf(tab) < 0;
	// Chi tiết nhân viên đang chọn: tải theo yêu cầu cho đúng một nhân viên, chỉ khi đang xem tab theo nhân viên; tải lại sau mỗi
	// lần nạp bảng lương (bảng lương 1.000 nhân viên: runView không kèm chi tiết của dòng nào)
	useEffect(() => {
		if (!id || !sel || isLeaver || !data || !onLineTab) return undefined;
		const key = `${sel}|${version}`;
		if (detail && detail.key === key && !detail.error) return undefined;
		detailRequest.current += 1;
		const mine = detailRequest.current;
		call({action: 'runLine', id, line: sel, prev: prevId}).then(
			(r) => alive.current && mine === detailRequest.current && setDetail(r && r.line ? {key, line: sel, data: r} : {key, line: sel, error: true}),
			() => alive.current && mine === detailRequest.current && setDetail({key, line: sel, error: true})
		);
		return undefined;
	}, [id, sel, version, onLineTab]);

	// Bút toán xem trước: tải khi mở tab Bút toán, tải lại khi số liệu bảng lương đổi
	const loadJournal = (force) => {
		const key = `${id}|${version}`;
		if (!force && journalKey.current === key) return;
		journalKey.current = key;
		call({action: 'journal', id}).then(
			(r) => alive.current && journalKey.current === key && setJournal(r && Array.isArray(r.lines) ? {id, data: r} : {id, error: serverText((r && (r.s4vpError || r.error)) || '', (r && (r.s4vpErrorVi || r.errorVi)) || '') || '-'}),
			(e) => alive.current && journalKey.current === key && setJournal({id, error: errorText(e) || '-'})
		);
	};
	const journalWanted = tab === 'journal' && !!(data && data.batch && data.batch.calculated);
	useEffect(() => {
		if (id && journalWanted) loadJournal(false);
		return undefined;
	}, [id, journalWanted, version]);

	// Tác vụ nền (tính lương bằng Map/Reduce, ghi sổ, đảo): hỏi trạng thái, tự nạp lại khi xong
	const job = data && data.batch ? String(data.batch.job || '') : '';
	useEffect(() => {
		if (!job) {
			if (hadJob.current) {
				hadJob.current = false;
				setJobInfo(null);
				app.notify(t.done.jobDone, 'ok');
			}
			return undefined;
		}
		hadJob.current = true;
		let on = true;
		let timer = null;
		let ticks = 0;
		const isTask = jobKind(job) === 'calc';
		const tick = () => {
			if (!on) return;
			ticks += 1;
			const ask = isTask
				? post({action: 'jobStatus', job}).then(
						(s) => {
							if (on && s && !s.error) setJobInfo({status: String(s.status || ''), stage: String(s.stage || '')});
							return !s || !!s.error || /COMPLETE|FAILED/i.test(String(s.status || ''));
						},
						() => true
				  )
				: Promise.resolve(true);
			ask.then((reload) => (on && reload ? load(true) : undefined)).then(() => {
				// Tối đa khoảng 15 phút; sau đó người dùng bấm Tải lại
				if (on && ticks < 180) timer = setTimeout(tick, 5000);
			});
		};
		timer = setTimeout(tick, 3000);
		return () => {
			on = false;
			if (timer) clearTimeout(timer);
		};
	}, [id, job]);

	if (!id) {
		return (
			<Page>
				<PageHeader title={t.crumb} />
				<Card>
					<Empty text={t.noBatch} />
					<div class="s4vp-actions">
						<Button kind="primary" label={t.backToList} onClick={() => app.go('payrollList')} />
					</div>
				</Card>
			</Page>
		);
	}
	if (!data || !data.batch) {
		return (
			<Page>
				<PageHeader crumbs={[{label: t.crumb, onClick: () => app.go('payrollList')}]} title={t.crumb} sub={failed ? t.loadFailed : t.loading} />
				{failed ? (
					<Card>
						<div class="s4vp-actions">
							<Button kind="primary" label={t.retry} onClick={() => load(false)} />
							<Button label={t.backToList} onClick={() => app.go('payrollList')} />
						</div>
					</Card>
				) : null}
			</Page>
		);
	}

	// ------------------------------------------------------------------ số liệu dẫn xuất
	const b = data.batch;
	const period = data.period || {};
	const s = String(b.status || '');
	const lines = Array.isArray(data.lines) ? data.lines : [];
	const totals = data.totals || {};
	const compare = data.compare || {};
	const summary = compare.summary || {};
	const prev = compare.previous || null;
	const leavers = Array.isArray(compare.leavers) ? compare.leavers : [];
	const threshold = Number(compare.threshold) || 0.1;
	const tx = data.transactions || {};
	const working = !!app.busy || !!job;
	const periodOpen = period.status !== 'C';
	const editable = ['H', 'B', 'C'].indexOf(s) >= 0 && periodOpen;
	const calculated = !!b.calculated;
	// Trạng thái C mà cờ đã tính chưa bật (dữ liệu đổi sau khi tính): hiển thị như chờ tính
	const statusKey = s === 'C' && !calculated ? 'B' : s;
	const isHr = !!user.isHr;
	const checkItems = Array.isArray(checks.items) ? checks.items : [];
	const openChecks = checkItems.filter((c) => c && isOpenCheck(c));
	const openCount = data.checks ? n0(data.checks.open) : openChecks.filter((c) => c.severity !== 'info').length;

	// ------------------------------------------------------------------ thao tác
	const act = (action, extra, message) =>
		app.run(t.working, send(Object.assign({action, id}, extra || {}))).then((r) => {
			if (!r || !alive.current) return undefined;
			const warn = (r.warnings || []).map((w) => serverText(w.message, w.messageVi)).filter(Boolean);
			let text = t.done.ok;
			let kind = 'ok';
			try {
				const m = message ? message(r) : null;
				if (Array.isArray(m)) {
					text = m[0];
					kind = m[1] || 'ok';
				} else if (m) text = m;
			} catch (e) {
				text = t.done.ok;
			}
			return load(true).then(() => {
				if (alive.current) app.notify([text].concat(warn).join(' · '), warn.length && kind === 'ok' ? 'warn' : kind);
				return r;
			});
		});
	const calcMessage = (r) => (r.queued ? t.done.queued : r.ok ? t.done.calcOk : [t.done.calcErrors((r.errors || []).length), 'warn']);
	const doCalculate = () => act('calculate', null, calcMessage);
	const doSubmit = () => app.confirm(openCount > 0 ? t.confirm.submitOpen(openCount) : t.confirm.submit, () => act('submitRun', {batch: id}, () => t.done.submitted));
	const doApprove = () => app.confirm(openCount > 0 ? t.confirm.approveOpen(openCount) : t.confirm.approve, () => act('approve', null, () => t.done.approved));
	const doRelease = () => app.confirm(t.confirm.release, () => act('release', null, (r) => (r.resumed ? t.done.resumed : t.done.released)));
	const doReverse = () => app.confirm(t.confirm.reverse, () => act('reverse', null, (r) => (r.resumed ? t.done.resumed : t.done.reversed)));
	const goAttendance = () => app.go('attendance', {period: period.id});
	const openJournalPreview = () => setTab('journal');
	const bankFile = () =>
		app.run(t.working, call({action: 'bankfile', id})).then((r) => {
			if (r && r.fileName) download(r.fileName, r.content || '');
		});
	const openPrint = (doc) => {
		try {
			window.open(printUrl(id, doc), '_blank');
		} catch (e) {
			app.notify(String((e && e.message) || e), 'error');
		}
	};

	// Nút chính: một việc kế tiếp theo bước hiện tại (docs/UI_V2.md mục 1)
	const currentKey = data.progress ? data.progress.currentKey : null;
	let primary = null;
	let secondary = null;
	if (currentKey === 'prepare' && editable) primary = {label: t.act.loadEmployees, onClick: () => act('loadEmployees', null, t.done.loaded)};
	else if (currentKey === 'attendance' && editable) {
		primary = {label: t.act.openAttendance, onClick: goAttendance};
		secondary = {label: t.act.calculate, onClick: doCalculate};
	} else if (currentKey === 'calculate' && editable) primary = s === 'H' && calculated ? {label: t.act.removeHold, onClick: () => act('removeHold')} : {label: t.act.calculate, onClick: doCalculate};
	else if (s === 'C' && calculated && periodOpen) {
		primary = {label: t.act.submit, onClick: doSubmit};
		secondary = {label: t.act.recalculate, onClick: doCalculate};
	} else if (s === 'P') primary = {label: t.act.approve, onClick: doApprove};
	else if (s === 'J') primary = {label: t.act.reopen, onClick: () => app.confirm(t.confirm.reopen, () => act('reopen', null, () => t.done.reopened))};
	else if (s === 'A') primary = isHr ? {label: t.act.release, disabled: true, title: t.hrNoRelease} : {label: t.act.release, onClick: doRelease};
	else if (editable) primary = {label: t.act.calculate, onClick: doCalculate};

	const item = (cond, label, onClick, disabled) => (cond ? {label, onClick, disabled: !!disabled} : null);
	const printItems = [
		item(calculated, t.act.payslips, () => openPrint('payslip')),
		item(calculated, t.act.paymentSheet, () => openPrint('payment')),
		item(calculated && n0(b.ctr_net) !== 0, t.act.contractor, () => openPrint('contractor')),
		item(s === 'A' || s === 'R', t.act.bankFile, bankFile),
		item(calculated, t.act.journal, openJournalPreview),
	].filter(Boolean);
	const primaryLabel = primary ? primary.label : '';
	const secondaryLabel = secondary ? secondary.label : '';
	const notShown = (label) => label !== primaryLabel && label !== secondaryLabel;
	const moreItems = [
		item(editable && notShown(t.act.loadEmployees), t.act.loadEmployees, () => act('loadEmployees', null, t.done.loaded), working),
		item(editable, t.act.syncTime, () => act('syncTime', null, t.done.timeSynced), working),
		item(editable && notShown(t.act.calculate) && notShown(t.act.recalculate), calculated ? t.act.recalculate : t.act.calculate, doCalculate, working),
		item(s === 'H' && notShown(t.act.removeHold), t.act.removeHold, () => act('removeHold'), working),
		item(s === 'B' || s === 'C', t.act.hold, () => act('hold'), working),
		item(s === 'C' && calculated, t.act.approveNow, doApprove, working),
		item(s === 'C' || s === 'P', t.act.reject, () => app.confirm(t.confirm.reject, () => act('reject', null, () => t.done.rejected)), working),
		item(['A', 'P', 'C', 'B'].indexOf(s) >= 0, t.act.reopen, () => app.confirm(t.confirm.reopen, () => act('reopen', null, () => t.done.reopened)), working),
		item(!isHr && s === 'R', t.act.agencyBills, () => app.confirm(t.confirm.agencyBills, () => act('agencyBills', null, t.done.bills)), working),
		item(!isHr && s === 'R', t.act.completeRelease, () => act('release', null, (r) => (r.resumed ? t.done.resumed : t.done.released)), working),
		item(!isHr && s === 'R', t.act.reverse, doReverse, working),
		item(!isHr && s === 'V', t.act.completeReverse, () => act('reverse', null, (r) => (r.resumed ? t.done.resumed : t.done.reversed)), working),
		item(user.role === 'administrator' && !!job, t.act.clearJob, () => app.confirm(t.confirm.clearJob, () => act('clearJob')), !!app.busy),
		item(true, t.act.refresh, () => load(false)),
		item(!!(boot.recordTypes && boot.recordTypes.batch), t.act.openRecord, () => openRecord(boot.recordTypes.batch, id)),
		item(true, t.act.legacy, () => app.go('batches')),
	].filter(Boolean);

	const headerActions = [
		<Menu label={t.print} items={printItems} disabled={!printItems.length} />,
		<Menu label={t.more} items={moreItems} />,
		<Button label={t.log} onClick={() => app.go('checkDetail', {id, tab: 'log'})} />,
		secondary ? <Button label={secondary.label} onClick={secondary.onClick} disabled={working} /> : null,
		primary ? <Button kind="primary" label={primary.label} onClick={primary.onClick} disabled={working || !!primary.disabled} title={primary.title} /> : null,
	];

	// ------------------------------------------------------------------ tiêu đề, bước, thẻ số
	const subParts = [];
	if (period.start && period.end) subParts.push(t.sub.period(fmtDate(period.start), fmtDate(period.end)));
	else if (b.periodName) subParts.push(b.periodName);
	if (data.paygroup) subParts.push(t.sub.group(data.paygroup.description || data.paygroup.code || ''));
	if (b.doc_date) subParts.push(t.sub.payDate(fmtDate(b.doc_date)));
	subParts.push(t.sub.people(lines.length));
	if (!periodOpen) subParts.push(t.sub.periodClosed);

	const noteOf = (st) => {
		const f = t.notes[st.note];
		if (!f) return {};
		const text = typeof f === 'function' ? f(n0(st.count)) : f;
		if (st.note === 'employees') return {note: text, noteTone: st.state === 'current' ? 'warn' : 'muted'};
		if (st.note === 'locked') return {note: text, noteTone: 'muted'};
		if (st.note === 'rejected') return {note: text, noteTone: 'error'};
		if (st.note === 'reversed') return {note: text, noteTone: 'muted'};
		return {note: text, noteTone: 'warn'};
	};
	const steps = (data.steps || []).map((st) => Object.assign({key: st.key, label: t.steps[st.key] || st.key, state: st.state}, noteOf(st), st.key === 'attendance' && period.id ? {onClick: goAttendance} : {}));

	const net = (summary.totals || {}).net || {};
	const prevName = prev ? prev.periodName || prev.name : '';
	let netNote = t.cards.noPrev;
	if (!calculated && !n0(totals.net)) netNote = t.cards.notCalculated;
	else if (prev && !blank(net.diff)) {
		if (!net.diff) netNote = t.cards.same(prevName);
		else if (blank(net.pct)) netNote = `${t.cards.changed(prevName)}${signedMoney(net.diff)}`;
		else netNote = net.diff > 0 ? t.cards.up(absPct(net.pct), prevName) : t.cards.down(absPct(net.pct), prevName);
	}
	const cards = [
		{key: 'net', label: t.cards.net, value: money(totals.net), note: netNote},
		{key: 'ins', label: t.cards.ins, value: money(totals.insurance), note: t.cards.insNote(money(totals.ee_ins), money(totals.er_ins))},
		{key: 'pit', label: t.cards.pit, value: money(totals.pit), note: t.cards.pitNote(money(totals.pitEmployee), money(totals.pitContractor))},
		{key: 'cost', label: t.cards.cost, value: money(totals.cost), note: t.cards.costNote(money(totals.gross))},
	];

	// ------------------------------------------------------------------ cần soát
	const pickTab = (k) => {
		if (BATCH_TABS.indexOf(k) < 0) lineTab.current = k;
		setTab(k);
	};
	// Chọn nhân viên: đang ở tab cấp bảng lương thì về tab nhân viên xem gần nhất
	const selectLine = (lineId) => {
		setSelected(String(lineId));
		if (BATCH_TABS.indexOf(tab) >= 0) setTab(lineTab.current || 'earn');
	};
	let attention = {openRows: [], doneRows: []};
	try {
		attention = buildAttention(data, checkItems, t);
	} catch (e) {
		attention = {openRows: [], doneRows: []};
	}
	const openRows = attention.openRows;
	const doneRows = attention.doneRows;
	const openCheck = (r) => {
		if (r.lineId) {
			lineTab.current = 'earn';
			setSelected(String(r.lineId));
			setTab('earn');
		} else if (r.attendance) goAttendance();
		else if (r.rule) app.go('checkDetail', {id, rule: r.rule, employee: r.employee});
	};
	const sevTone = {error: 'error', warn: 'warn', info: 'info'};
	const checkColumns = [
		{
			key: 'title', label: t.checks.cols.title,
			render: (r) => (
				<span style={{display: 'block'}}>
					<span style={{fontWeight: '600'}}>{r.title}</span>
					<span class="s4vp-small" style={{display: 'block'}}>{r.employeeText}</span>
				</span>
			),
		},
		{key: 'note', label: t.checks.cols.note, render: (r) => <span style={{display: 'block', maxWidth: '260px', overflowWrap: 'anywhere'}}>{r.note}</span>},
		{
			key: 'statusText', label: t.checks.cols.status, nowrap: true,
			render: (r) => (
				<span style={{display: 'block'}}>
					<Badge text={r.statusText || t.checks.status[r.status] || ''} tone={r.status === 'open' ? sevTone[r.severity] || 'warn' : 'ok'} />
					{r.rule ? <span class="s4vp-small" style={{display: 'block'}}>{r.assignee || t.checks.unassigned}</span> : null}
				</span>
			),
		},
		{key: 'open', label: t.checks.cols.action, nowrap: true, render: (r) => (r.lineId || r.attendance || r.rule ? <span class="s4vp-link">{t.checks.openItem}</span> : '')},
	];
	const hasErrors = openRows.some((r) => r.severity === 'error');
	// Danh sách gửi về bị giới hạn (bảng lương lớn): số đếm lấy theo tổng của máy chủ, không theo số dòng đang có
	const openTotal = checks.truncated && checks.counts ? Math.max(openRows.length, n0(checks.counts.open) + (openRows.length - openChecks.length)) : openRows.length;

	// ------------------------------------------------------------------ lưới nhân viên
	const checksByEmp = {};
	const errorsByEmp = {};
	if (checks.byEmployee) {
		// Máy chủ đếm trên toàn bộ cảnh báo (danh sách gửi về có thể chỉ là 200 mục đầu)
		Object.keys(checks.byEmployee).forEach((k) => {
			checksByEmp[k] = n0(checks.byEmployee[k].open);
			if (n0(checks.byEmployee[k].errors)) errorsByEmp[k] = n0(checks.byEmployee[k].errors);
		});
	} else {
		openChecks.forEach((c) => {
			if (blank(c.employee) || c.severity === 'info') return;
			const k = String(c.employee);
			checksByEmp[k] = (checksByEmp[k] || 0) + 1;
			if (c.severity === 'error') errorsByEmp[k] = (errorsByEmp[k] || 0) + 1;
		});
	}
	const cmpText = (c) => {
		if (!c || !prev) return '';
		if (c.kind === 'new') return t.emp.first;
		if (blank(c.diff)) return '';
		return blank(c.pct) ? signedMoney(c.diff) : signedPct(c.pct);
	};
	const rows = lines.map((l) => {
		const c = l.cmp || {};
		const review = (checksByEmp[String(l.employee)] || 0) + (blank(l.warnings) ? 0 : 1);
		const isError = !blank(l.error) || !!errorsByEmp[String(l.employee)];
		return {
			id: String(l.id), code: l.code || '', name: l.name || '', typeText: t.emp.type[l.employment_type] || '', department: l.department || '',
			days: blank(l.work_days) && blank(l.std_days) ? '' : `${num(n0(l.work_days))} / ${num(n0(l.std_days))}`,
			gross: n0(l.gross), ee_ins: n0(l.ee_ins), pit: n0(l.pit), net: n0(l.net),
			cmpText: cmpText(c), cmpOver: !!c.over, cmpNew: c.kind === 'new', review, isError,
			noteText: [isError ? t.emp.error : '', review ? t.emp.review(review) : '', l.error || '', l.warnings || ''].filter(Boolean).join(' '),
			warnText: [l.error, l.warnings].filter(Boolean).join(' | '),
		};
	});
	const leftRows = leavers.map((l) => ({
		id: `left:${l.employee}`, code: l.code || '', name: l.name || '', typeText: '', department: '', days: '', gross: null, ee_ins: null, pit: null, net: null,
		cmpText: t.emp.gone, left: true, prevNet: n0(l.previous), review: 0, isError: false, noteText: `${t.panel.prevNet} ${money(l.previous)}`, warnText: '',
	}));
	const counts = {all: rows.length, review: rows.filter((r) => r.review || r.isError).length, error: rows.filter((r) => r.isError).length, over: rows.filter((r) => r.cmpOver).length, new: rows.filter((r) => r.cmpNew).length, left: leftRows.length};
	const filtered = filter === 'left' ? leftRows : rows.filter((r) => (filter === 'review' ? r.review || r.isError : filter === 'error' ? r.isError : filter === 'over' ? r.cmpOver : filter === 'new' ? r.cmpNew : true));
	let found = {rows: filtered, count: null};
	try {
		found = quickFilter(filtered, query);
	} catch (e) {
		found = {rows: filtered, count: null};
	}
	const shown = found.rows.slice(0, limit);
	const sumOf = (list, k) => list.reduce((a, r) => a + n0(r[k]), 0);
	const totalRow = filter !== 'left' && found.rows.length > 1 ? {code: t.emp.total(found.rows.length), gross: sumOf(found.rows, 'gross'), ee_ins: sumOf(found.rows, 'ee_ins'), pit: sumOf(found.rows, 'pit'), net: sumOf(found.rows, 'net')} : null;
	const pickFilter = (v) => {
		setFilter(v);
		setLimit(PAGE_SIZE);
	};
	const thresholdText = absPct(threshold);
	const filterItems = [
		{value: 'all', label: t.emp.filters.all, count: counts.all},
		{value: 'review', label: t.emp.filters.review, count: counts.review, tone: 'warn'},
		counts.error || filter === 'error' ? {value: 'error', label: t.emp.filters.error, count: counts.error, tone: 'error'} : null,
		prev ? {value: 'over', label: t.emp.filters.over(thresholdText), count: counts.over, tone: 'warn'} : null,
		prev && counts.new ? {value: 'new', label: t.emp.filters.isNew, count: counts.new} : null,
		prev && counts.left ? {value: 'left', label: t.emp.filters.left, count: counts.left} : null,
	];
	const empColumns = [
		{
			key: 'code', label: t.emp.cols.name, nowrap: true,
			render: (r) => {
				const attrs = {class: 's4vp-ell', title: [r.code, r.name, r.typeText, r.department].filter(Boolean).join(' · ')};
				return (
					<span {...attrs}>
						<span class="s4vp-link">{r.code}</span>
						{` ${r.name}`}
					</span>
				);
			},
		},
		{key: 'days', label: t.emp.cols.days, align: 'right', nowrap: true},
		{key: 'gross', label: t.emp.cols.gross, type: 'money', nowrap: true},
		{key: 'ee_ins', label: t.emp.cols.eeIns, type: 'money', nowrap: true},
		{key: 'pit', label: t.emp.cols.pit, type: 'money', nowrap: true},
		{key: 'net', label: t.emp.cols.net, type: 'money', nowrap: true, render: (r) => <span style={{fontWeight: '600'}}>{r.left ? '' : money(r.net)}</span>},
		{key: 'cmpText', label: t.emp.cols.cmp, align: 'right', nowrap: true, render: (r) => (r.cmpOver ? <Badge text={r.cmpText} tone="warn" /> : <span class="s4vp-muted">{r.cmpText}</span>)},
		{
			key: 'noteText', label: t.emp.cols.note, nowrap: true,
			render: (r) => {
				if (r.left) return <span class="s4vp-small">{r.noteText}</span>;
				if (!r.isError && !r.review) return '';
				const attrs = {style: {display: 'inline-flex', gap: '4px', alignItems: 'center'}, title: [r.review ? t.emp.review(r.review) : '', r.warnText].filter(Boolean).join(' - ') || t.emp.error};
				return (
					<span {...attrs}>
						{r.isError ? <Badge text={t.emp.error} tone="error" /> : null}
						{r.review ? <Badge text={String(r.review)} tone="warn" /> : null}
					</span>
				);
			},
		},
	];
	const empSub = prev ? `${t.emp.compareWith(prev.name, prev.periodName || fmtDate(prev.periodEnd))}: ${t.emp.compareStats(n0(summary.joiners), n0(summary.leavers), n0(summary.over), thresholdText)}` : t.cards.noPrev;

	// ------------------------------------------------------------------ khung chi tiết: thao tác
	const currentLine = isLeaver ? null : lines.find((l) => String(l.id) === sel) || null;
	const currentLeaver = isLeaver ? leavers.find((l) => `left:${l.employee}` === sel) || null : null;
	const detailData = detail && detail.line === sel && detail.data ? detail.data : null;
	const detailError = !!(detail && detail.line === sel && detail.error);
	const setField = (k) => (v) => {
		formRef.current = Object.assign({}, formRef.current, {[k]: v});
		setForm(formRef.current);
	};
	const openInput = (kind) => {
		formRef.current = Object.assign({}, EMPTY_FORM);
		setForm(formRef.current);
		setDialog({kind});
	};
	const saveInput = () => {
		const kind = dialog && dialog.kind;
		if (!currentLine || (kind !== 'E' && kind !== 'D')) return;
		const v = formRef.current;
		const values = {
			batch: id, employee: currentLine.employee, kind, earning_type: kind === 'E' ? v.earning_type : null, code: kind === 'D' ? v.code || 'KHAC' : '', description: v.description,
			qty: kind === 'E' ? toNumber(v.qty) : null, rate: kind === 'E' ? toNumber(v.rate) : null, multiplier: kind === 'E' ? toNumber(v.multiplier) : null, amount: kind === 'D' ? toNumber(v.amount) : null,
		};
		act('saveInput', {values, batch: id}, () => t.done.inputSaved).then((r) => {
			if (r && alive.current) setDialog(null);
		});
	};
	const deleteInput = (r) => app.confirm(t.confirm.deleteInput(r.name || r.code || ''), () => act('deleteInput', {id: r.inputId, batch: id}, () => t.done.inputDeleted));
	const deleteColumn = editable
		? {key: 'del', label: '', nowrap: true, noRowClick: true, render: (r) => (r.inputId ? <Button kind="link" small={true} label={t.panel.delete} disabled={working} onClick={() => deleteInput(r)} /> : '')}
		: null;
	// Sửa giờ công một dòng (action cũ saveTime): giờ khác giờ timesheet thì máy chủ bắt buộc có lý do
	const setTimeField = (k) => (v) => {
		timeRef.current = Object.assign({}, timeRef.current, {[k]: v});
		setTimeForm(timeRef.current);
	};
	const openTimeEdit = (r) => {
		timeRef.current = {id: r.id, hours: blank(r.hours) ? '' : num(r.hours), reason: r.reason || '', label: [r.projectText, r.taskText].filter(Boolean).join(' / ')};
		setTimeForm(timeRef.current);
		setDialog({kind: 'time'});
	};
	const saveTime = () => {
		const v = timeRef.current;
		const hours = toNumber(v.hours);
		if (!v.id || blank(hours)) return;
		act('saveTime', {lineId: v.id, batch: id, values: {hours, reason: v.reason}}, () => t.done.timeSaved).then((r) => {
			if (r && alive.current) setDialog(null);
		});
	};
	const sumLine = (label, value, strong) => (
		<div class="s4vp-line" style={strong ? {fontSize: '16px', fontWeight: '700'} : {}}>
			<span class={strong ? '' : 's4vp-muted'}>{label}</span>
			<span class="s4vp-num">{money(value) || '-'}</span>
		</div>
	);
	const cash = (v) => (blank(v) ? '-' : money(v) || '0');
	const qty = (v) => (blank(v) ? '-' : num(v) || '0');
	const pc = t.panel.cols;
	const search = t.panel.search;
	// Bảng nhãn - giá trị (Công, Thuế TNCN): vẫn là lưới có ô tìm
	const pairTable = (list) => (
		<Table
			columns={[
				{key: 'label', label: pc.label, render: (r) => <span style={r.strong ? {fontWeight: '700'} : {}}>{r.label}</span>},
				{key: 'value', label: pc.value, align: 'right', nowrap: true, render: (r) => <span style={r.strong ? {fontWeight: '700'} : {}}>{r.value}</span>},
			]}
			rows={list}
			search={true}
			searchPlaceholder={search}
		/>
	);

	// ------------------------------------------------------------------ khung chi tiết: tab theo nhân viên
	const renderLineTab = () => {
		const d = detailData;
		if (tab === 'earn') {
			const list = (d.earnings || []).map((x, i) => Object.assign({}, x, {
				id: `e${i}`, srcText: [t.panel.src[x.source] || x.source || '', x.ruleCode].filter(Boolean).join(' · '),
				calcText: blank(x.quantity) && blank(x.rate) ? '' : `${num(n0(x.quantity))} × ${num(n0(x.rate))}${blank(x.multiplier) || Number(x.multiplier) === 1 ? '' : ` × ${num(x.multiplier)}`}`,
			}));
			const total = list.length > 1 ? {name: t.journal.total, amount: sumOf(list, 'amount'), exempt: sumOf(list, 'exempt')} : null;
			return (
				<Table
					columns={[
						{key: 'name', label: pc.item, render: (r) => (
							<span style={{display: 'block'}}>
								<span style={{fontWeight: '600'}}>{r.name || r.code}</span>
								<span class="s4vp-small" style={{display: 'block'}}>{[r.code, r.calcText, r.srcText, r.project].filter(Boolean).join(' · ')}</span>
							</span>
						)},
						{key: 'amount', label: pc.amount, type: 'money', nowrap: true},
						{key: 'exempt', label: pc.exempt, type: 'money', nowrap: true},
						deleteColumn,
					]}
					rows={list}
					total={total}
					search={true}
					searchPlaceholder={search}
					toolbar={editable ? <Button kind="dashed" small={true} label={t.panel.addEarning} disabled={working} onClick={() => openInput('E')} /> : null}
				/>
			);
		}
		if (tab === 'ded') {
			const list = (d.deductions || []).map((x, i) => Object.assign({}, x, {id: `d${i}`}));
			const total = list.length > 1 ? {code: t.journal.total, amount: sumOf(list, 'amount')} : null;
			return (
				<Table
					columns={[{key: 'code', label: pc.code, nowrap: true}, {key: 'name', label: pc.memo}, {key: 'amount', label: pc.amount, type: 'money', nowrap: true}, deleteColumn]}
					rows={list}
					total={total}
					search={true}
					searchPlaceholder={search}
					toolbar={editable ? <Button kind="dashed" small={true} label={t.panel.addDeduction} disabled={working} onClick={() => openInput('D')} /> : null}
				/>
			);
		}
		if (tab === 'ins') {
			const list = (d.insurance || []).map((x, i) => Object.assign({}, x, {id: `i${i}`}));
			const total = list.length > 1 ? {code: t.journal.total, employeeAmount: sumOf(list, 'employeeAmount'), employerAmount: sumOf(list, 'employerAmount')} : null;
			return (
				<Table
					columns={[
						{key: 'code', label: pc.component, nowrap: true, render: (r) => <span style={{fontWeight: '600'}}>{r.code}</span>},
						{key: 'wageBase', label: pc.base, type: 'money', nowrap: true},
						{key: 'employeeRate', label: pc.eeRate, type: 'pct', nowrap: true},
						{key: 'employeeAmount', label: pc.ee, type: 'money', nowrap: true},
						{key: 'employerRate', label: pc.erRate, type: 'pct', nowrap: true},
						{key: 'employerAmount', label: pc.er, type: 'money', nowrap: true},
					]}
					rows={list}
					total={total}
					search={true}
					searchPlaceholder={search}
				/>
			);
		}
		if (tab === 'tax') {
			// Chỉ hiện số gói đã tính và lưu trên dòng; không tính lại
			const x = d.tax || {};
			const tt = t.panel.tax;
			const list = [
				{id: 'gross', label: tt.gross, value: cash(x.gross)},
				{id: 'exempt', label: tt.exempt, value: cash(x.exempt)},
				{id: 'taxable', label: tt.taxable, value: cash(x.taxable), strong: true},
				{id: 'insurance', label: tt.insurance, value: cash(x.insurance)},
				blank(x.selfDeduction) ? null : {id: 'self', label: tt.self, value: cash(x.selfDeduction)},
				{id: 'dependents', label: tt.dependents, value: qty(x.dependents)},
				blank(x.dependentDeduction) ? null : {id: 'dep', label: tt.dependentDeduction, value: cash(x.dependentDeduction)},
				{id: 'family', label: tt.family, value: cash(x.familyDeduction)},
				{id: 'other', label: tt.other, value: cash(x.otherDeductions)},
				{id: 'assessable', label: tt.assessable, value: cash(x.assessable), strong: true},
				{id: 'method', label: tt.method, value: blank(x.method) ? '-' : tt.methods[x.method] || String(x.method)},
				x.flatCommitment ? {id: 'commit', label: tt.commitment, value: t.panel.yes} : null,
				{id: 'pit', label: tt.pit, value: cash(x.pit), strong: true},
			].filter(Boolean);
			return (
				<div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
					{pairTable(list)}
					<div class="s4vp-small">{tt.note}</div>
				</div>
			);
		}
		if (tab === 'att') {
			const a = d.attendance || d.line || {};
			const list = ['std_days', 'work_days', 'paid_leave', 'unpaid_leave', 'si_leave', 'absence_days', 'ot_hours'].map((k) => ({id: k, label: t.panel.att[k], value: qty(a[k])}));
			list.push({id: 'att_locked', label: t.panel.att.att_locked, value: a.att_locked ? t.panel.yes : t.panel.no});
			return pairTable(list);
		}
		if (tab === 'time') {
			const tm = t.panel.time;
			const list = (d.time || []).map((x, i) => Object.assign({}, x, {id: blank(x.id) ? `t${i}` : String(x.id), projectText: x.project_name || x.project || tm.none, taskText: x.task_name || x.task || ''}));
			const total = list.length > 1 ? {projectText: t.journal.total, source_hours: sumOf(list, 'source_hours'), hours: sumOf(list, 'hours')} : null;
			const sheet = d.timesheet || {entries: []};
			const entries = Array.isArray(sheet.entries) ? sheet.entries : [];
			// Dòng timesheet được nhận vào lương: cùng quy tắc với màn cũ (bắt buộc duyệt thì chỉ dòng đã duyệt, không thì trừ dòng bị từ chối)
			const usesApproval = entries.some((e) => e.approval !== 'N');
			const counted = (e) => !usesApproval || (sheet.requireApproval ? e.approval === 'A' : e.approval !== 'R');
			const days = entries.map((e, i) => Object.assign({}, e, {
				id: blank(e.id) ? `s${i}` : `s${e.id}`, dateText: fmtDate(e.date), projectText: e.projectName || tm.none, approvalText: tm.approval[e.approval] || e.statusName || '', countedText: counted(e) ? t.panel.yes : t.panel.no,
			}));
			const dayTotal = days.length > 1 ? {dateText: t.journal.total, hours: sumOf(days, 'hours')} : null;
			return (
				<div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
					<div class="s4vp-small">{tm.hint}</div>
					<Table
						columns={[
							{key: 'projectText', label: pc.project},
							{key: 'taskText', label: pc.task},
							{key: 'entries', label: pc.entries, type: 'num', nowrap: true},
							{key: 'source_hours', label: pc.sourceHours, type: 'num', nowrap: true},
							{key: 'hours', label: pc.hours, type: 'num', nowrap: true},
							{key: 'reason', label: pc.reason},
							editable ? {key: 'edit', label: '', nowrap: true, noRowClick: true, render: (r) => <Button kind="link" small={true} label={tm.edit} disabled={working} onClick={() => openTimeEdit(r)} />} : null,
						]}
						rows={list}
						total={total}
						search={true}
						searchPlaceholder={search}
						label={tm.title}
						toolbar={
							<div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center'}}>
								<span style={{fontWeight: '600', fontSize: '13px'}}>{tm.title}</span>
								{editable ? <Button small={true} label={tm.sync} disabled={working} onClick={() => act('syncTime', null, t.done.timeSynced)} /> : null}
							</div>
						}
					/>
					{sheet.failed ? (
						<div class="s4vp-small" style={{color: 'var(--s4vp-err)'}}>{`${tm.sheetFailed} ${sheet.failed}`}</div>
					) : (
						<Table
							columns={[
								{key: 'dateText', label: pc.date, nowrap: true},
								{key: 'hours', label: pc.sheetHours, type: 'num', nowrap: true},
								{key: 'projectText', label: pc.project},
								{key: 'taskName', label: pc.task},
								{key: 'approvalText', label: pc.approval, nowrap: true},
								{key: 'countedText', label: pc.counted, nowrap: true},
								{key: 'memo', label: pc.note},
							]}
							rows={days}
							total={dayTotal}
							search={true}
							searchPlaceholder={search}
							label={tm.sheetTitle(fmtDate(sheet.from), fmtDate(sheet.to))}
							toolbar={<span style={{fontWeight: '600', fontSize: '13px'}}>{tm.sheetTitle(fmtDate(sheet.from), fmtDate(sheet.to))}</span>}
						/>
					)}
				</div>
			);
		}
		if (tab === 'alloc') {
			const list = (d.allocations || []).map((x, i) => Object.assign({}, x, {id: `a${i}`, sourceText: x.source ? t.panel.allocSrc[x.source] || x.source : ''}));
			const total = list.length > 1 ? {component: t.journal.total, amount: sumOf(list, 'amount')} : null;
			return (
				<Table
					columns={[
						{key: 'component', label: pc.component, nowrap: true},
						{key: 'project', label: pc.projectOnly},
						{key: 'task', label: pc.task},
						{key: 'branch', label: pc.branch},
						{key: 'workCenter', label: pc.workCenter},
						{key: 'sourceText', label: pc.source, nowrap: true},
						{key: 'hours', label: pc.allocHours, type: 'num', nowrap: true},
						{key: 'ratio', label: pc.ratio, type: 'pct', nowrap: true},
						{key: 'amount', label: pc.amount, type: 'money', nowrap: true},
					]}
					rows={list}
					total={total}
					search={true}
					searchPlaceholder={search}
				/>
			);
		}
		if (tab === 'adv') {
			const list = (d.advanceOffsets || []).map((x, i) => Object.assign({}, x, {id: `v${i}`}));
			const total = list.length > 1 ? {refNbr: t.journal.total, amount: sumOf(list, 'amount')} : null;
			return (
				<Table
					columns={[{key: 'refNbr', label: pc.advanceNbr, nowrap: true}, {key: 'amount', label: pc.offset, type: 'money', nowrap: true}, {key: 'remainingBalance', label: pc.balanceAfter, type: 'money', nowrap: true}]}
					rows={list}
					total={total}
					search={true}
					searchPlaceholder={search}
				/>
			);
		}
		// So kỳ trước: chỉ tiêu của dòng, rồi từng khoản thu nhập
		const c = d.compare || {};
		if (!c.previous || !c.line) return <Empty text={t.panel.cmpNone} />;
		const keyRows = ['gross', 'ee_ins', 'pit', 'net'].map((k) => Object.assign({id: `k${k}`, name: t.panel.cmpKeys[k]}, c.line[k] || {}));
		const itemRows = (c.earnings || []).map((x, i) => Object.assign({}, x, {id: `c${i}`, name: `${x.name || x.code}${t.panel.kind[x.kind] ? ` (${t.panel.kind[x.kind]})` : ''}`}));
		const cmpColumns = (first) => [
			{key: 'name', label: first},
			{key: 'current', label: pc.current, type: 'money', nowrap: true},
			{key: 'previous', label: pc.previous, type: 'money', nowrap: true},
			{
				key: 'diff', label: pc.diff, align: 'right', nowrap: true,
				render: (r) => <span style={r.diff ? {color: 'var(--s4vp-warn)', fontWeight: '600'} : {}}>{blank(r.diff) ? '' : r.diff ? `${signedMoney(r.diff)}${blank(r.pct) ? '' : ` (${signedPct(r.pct)})`}` : '0'}</span>,
			},
		];
		return (
			<div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
				<div class="s4vp-small">{c.inPrevious ? t.panel.cmpWith(c.previous.name) : t.panel.cmpNew(c.previous.name)}</div>
				<Table columns={cmpColumns(pc.item)} rows={keyRows} />
				{c.inPrevious || itemRows.length ? <Table columns={cmpColumns(t.panel.cmpItems)} rows={itemRows} search={true} searchPlaceholder={search} /> : null}
			</div>
		);
	};

	// ------------------------------------------------------------------ khung chi tiết: tab cấp bảng lương
	const txState = (docId) => {
		const x = tx[String(docId)] || {};
		return x.voided ? t.docs.voided : x.posting ? t.docs.posted : t.docs.pending;
	};
	const bills = Array.isArray(b.bills) ? b.bills : [];
	const openBill = (billId) => {
		try {
			window.open(`/app/accounting/transactions/vendbill.nl?id=${encodeURIComponent(billId)}`, '_blank');
		} catch (e) {
			app.notify(String((e && e.message) || e), 'error');
		}
	};
	const renderBatchTab = () => {
		if (tab === 'checks') {
			return (
				<div>
					{checks.truncated ? (
						<div class="s4vp-line s4vp-small" style={{padding: '6px 12px'}}>
							<span class="s4vp-muted">{t.checks.partial(checkItems.length, n0(checks.total))}</span>
							<Button kind="link" small={true} label={t.checks.viewAll} onClick={() => app.go('checkDetail', {id})} />
						</div>
					) : null}
				<Table
					columns={checkColumns}
					rows={checkTab === 'done' ? doneRows : openRows}
					onRowClick={openCheck}
					empty={checkTab === 'done' ? t.checks.noneDone : t.checks.none}
					search={true}
					searchPlaceholder={t.checks.search}
					label={t.checks.title}
					toolbar={
						<Chips
							items={[{value: 'open', label: t.checks.open, count: openTotal, tone: hasErrors ? 'error' : 'warn'}, {value: 'done', label: t.checks.done, count: doneRows.length}]}
							value={checkTab}
							onPick={setCheckTab}
							label={t.checks.title}
						/>
					}
				/>
				</div>
			);
		}
		if (tab === 'bills') {
			const list = bills.map((x, i) => ({id: `b${i}`, billId: x.id, doc: `${(tx[String(x.id)] || {}).tranid || x.id} (${txState(x.id)})`, memo: x.memo || '', amount: x.amount}));
			const total = list.length > 1 ? {doc: t.journal.total, amount: sumOf(list, 'amount')} : null;
			const canCreate = !isHr && s === 'R';
			return (
				<Table
					columns={[
						{key: 'doc', label: pc.document, nowrap: true, noRowClick: true, render: (r) => <Button kind="link" small={true} label={r.doc} onClick={() => openBill(r.billId)} />},
						{key: 'memo', label: pc.memo},
						{key: 'amount', label: pc.amount, type: 'money', nowrap: true},
					]}
					rows={list}
					total={total}
					empty={t.bills.empty}
					search={true}
					searchPlaceholder={search}
					label={t.panel.tabs.bills}
					toolbar={canCreate ? <Button small={true} label={t.act.agencyBills} disabled={working} onClick={() => app.confirm(t.confirm.agencyBills, () => act('agencyBills', null, t.done.bills))} /> : null}
				/>
			);
		}
		// Bút toán: bản xem trước dựng từ số đã tính (action cũ journal), tải khi mở tab
		if (!calculated) return <Empty text={t.journal.notReady} />;
		if (!journal || journal.id !== id) return <Empty text={t.journal.loading} />;
		if (journal.error) {
			return (
				<div style={{display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center'}}>
					<Empty text={`${t.journal.failed} ${journal.error}`} />
					<Button small={true} label={t.retry} onClick={() => loadJournal(true)} />
				</div>
			);
		}
		const j = journal.data || {};
		const list = (j.lines || []).map((x, i) => Object.assign({}, x, {id: `j${i}`, accountText: x.accountNumber || x.account || '', dim: [x.sub, x.branch, x.workCenter, x.project].filter(Boolean).join(' / ')}));
		const total = {accountText: t.journal.total, debit: sumOf(list, 'debit'), credit: sumOf(list, 'credit')};
		const heading = `${b.journal ? t.journal.titleReleased : t.journal.title}${j.memo ? `: ${j.memo}` : ''}`;
		return (
			<Table
				columns={[
					{key: 'accountText', label: t.journal.cols.account, nowrap: true},
					{key: 'memo', label: t.journal.cols.memo},
					{key: 'debit', label: t.journal.cols.debit, type: 'money', nowrap: true},
					{key: 'credit', label: t.journal.cols.credit, type: 'money', nowrap: true},
					{key: 'dim', label: t.journal.cols.dim},
				]}
				rows={list}
				total={total}
				search={true}
				searchPlaceholder={t.journal.search}
				label={heading}
				toolbar={
					<div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center'}}>
						<span style={{fontWeight: '600', fontSize: '13px'}}>{heading}</span>
						{b.journal ? <Button kind="link" small={true} label={`${b.journalNo || b.journal} (${txState(b.journal)})`} onClick={() => openJournal(b.journal)} /> : null}
					</div>
				}
			/>
		);
	};

	// ------------------------------------------------------------------ khung chi tiết: khung, dải tab
	const isBatchTab = BATCH_TABS.indexOf(tab) >= 0;
	const tabButton = (k, count, tone) => {
		const on = tab === k;
		return (
			<button key={`t${k}`} type="button" role="tab" class={on ? 's4vp-tab s4vp-on' : 's4vp-tab'} aria-selected={on ? 'true' : 'false'} onClick={() => pickTab(k)}>
				{t.panel.tabs[k]}
				{count ? <span class={tone ? `s4vp-tab-n s4vp-t-${tone}` : 's4vp-tab-n'}>{String(count)}</span> : null}
			</button>
		);
	};
	const renderPanel = () => {
		let title = t.panel.noLine;
		let sub = '';
		let side = null;
		let message = '';
		let messageTone = 'var(--s4vp-warn)';
		let body;
		if (isBatchTab) {
			title = t.panel.batchTitle;
			sub = b.name || '';
			try {
				body = renderBatchTab();
			} catch (e) {
				body = <Empty text={t.panel.failed} />;
			}
		} else if (currentLeaver) {
			title = [currentLeaver.code, currentLeaver.name].filter(Boolean).join(' ');
			sub = t.emp.filters.left;
			body = (
				<div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
					<div class="s4vp-small">{t.panel.leftNote(prev ? prev.name : '')}</div>
					{sumLine(t.panel.prevNet, currentLeaver.previous, true)}
				</div>
			);
		} else if (currentLine) {
			const l = detailData ? Object.assign({}, currentLine, detailData.line, {code: currentLine.code, name: currentLine.name}) : currentLine;
			title = nameOf(currentLine);
			sub = [t.emp.type[currentLine.employment_type], currentLine.department].filter(Boolean).join(' · ');
			side = `${t.panel.sum.net} ${money(l.net) || '-'}`;
			if (!blank(currentLine.error)) {
				message = String(currentLine.error);
				messageTone = 'var(--s4vp-err)';
			} else if (!blank(currentLine.warnings)) message = String(currentLine.warnings);
			if (detailError) body = <Empty text={t.panel.failed} />;
			else if (!detailData) body = <Empty text={t.panel.loading} />;
			else {
				try {
					body = renderLineTab();
				} catch (e) {
					body = <Empty text={t.panel.failed} />;
				}
			}
		} else body = <Empty text={lines.length ? t.panel.noLine : t.emp.empty} />;
		const msgAttrs = {class: 's4vp-pane-msg', style: {color: messageTone}};
		if (message) msgAttrs.title = message;
		return (
			<section class="s4vp-pane" aria-label={t.panel.tabsLabel}>
				<div class="s4vp-pane-h">
					<div class="s4vp-pane-t">
						{title}
						{sub ? <span class="s4vp-pane-s">{` · ${sub}`}</span> : null}
					</div>
					{side ? <div style={{fontSize: '13px', fontWeight: '700', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums'}}>{side}</div> : null}
				</div>
				{message ? <div {...msgAttrs}>{message}</div> : null}
				<div class="s4vp-tabs2" role="tablist" aria-label={t.panel.tabsLabel}>
					<div class="s4vp-tabs2-g">{LINE_TABS.map((k) => tabButton(k))}</div>
					<div class="s4vp-tabs2-g s4vp-tabs2-batch">
						<span class="s4vp-tabs2-cap">{t.panel.groupBatch}</span>
						{tabButton('checks', openTotal, hasErrors ? 'error' : 'warn')}
						{tabButton('journal')}
						{tabButton('bills', bills.length)}
					</div>
				</div>
				<div class="s4vp-pane-b">
					<div class="s4vp-pane-pad">{body}</div>
				</div>
			</section>
		);
	};

	// ------------------------------------------------------------------ hộp thoại
	const renderDialog = () => {
		if (!dialog) return null;
		if (dialog.kind === 'time') {
			const tm = t.panel.time;
			return (
				<Dialog
					title={tm.editTitle(timeForm.label || '')}
					onClose={() => setDialog(null)}
					actions={[<Button label={t.input.cancel} onClick={() => setDialog(null)} />, <Button kind="primary" label={tm.save} disabled={blank(toNumber(timeForm.hours)) || working} onClick={saveTime} />]}
				>
					<div class="s4vp-small">{tm.editHint}</div>
					<div class="s4vp-form">
						<Field label={pc.hours}>
							<NumberInput value={timeForm.hours} onInput={setTimeField('hours')} />
						</Field>
						<Field label={pc.reason}>
							<TextInput value={timeForm.reason} onInput={setTimeField('reason')} onEnter={saveTime} />
						</Field>
					</div>
				</Dialog>
			);
		}
		if (!currentLine) return null;
		const isE = dialog.kind === 'E';
		const types = (boot.earningTypes || []).map((e) => ({value: String(e.id), label: `${e.code} ${e.name || ''}`}));
		const ready = isE ? !!form.earning_type : !blank(toNumber(form.amount));
		return (
			<Dialog
				title={`${isE ? t.panel.addEarning : t.panel.addDeduction} ${t.input.forEmp(nameOf(currentLine))}`}
				onClose={() => setDialog(null)}
				actions={[<Button label={t.input.cancel} onClick={() => setDialog(null)} />, <Button kind="primary" label={t.input.save} disabled={!ready || working} onClick={saveInput} />]}
			>
				<div class="s4vp-small">{isE ? t.input.hintE : t.input.hintD}</div>
				{isE ? (
					<div class="s4vp-form">
						<Field label={t.input.earningType}>
							<Select value={form.earning_type} onInput={setField('earning_type')} options={types} placeholder={t.input.pickType} />
						</Field>
						<Field label={t.input.memo}>
							<TextInput value={form.description} onInput={setField('description')} />
						</Field>
						<Field label={t.input.qty}>
							<NumberInput value={form.qty} onInput={setField('qty')} />
						</Field>
						<Field label={t.input.rate}>
							<NumberInput value={form.rate} onInput={setField('rate')} />
						</Field>
						<Field label={t.input.mult}>
							<NumberInput value={form.multiplier} onInput={setField('multiplier')} placeholder="1" />
						</Field>
					</div>
				) : (
					<div class="s4vp-form">
						<Field label={t.input.code}>
							<TextInput value={form.code} onInput={setField('code')} placeholder="KHAC" />
						</Field>
						<Field label={t.input.memo}>
							<TextInput value={form.description} onInput={setField('description')} />
						</Field>
						<Field label={t.input.amount}>
							<NumberInput value={form.amount} onInput={setField('amount')} onEnter={saveInput} />
						</Field>
					</div>
				)}
			</Dialog>
		);
	};

	// ------------------------------------------------------------------ chứng từ, tác vụ nền
	const docLinks = [];
	if (b.journal) docLinks.push(<Button kind="link" label={`${t.docs.journal} ${b.journalNo || b.journal} (${txState(b.journal)})`} onClick={() => openJournal(b.journal)} />);
	if (b.reversal) docLinks.push(<Button kind="link" label={`${t.docs.reversal} ${b.reversalNo || b.reversal} (${txState(b.reversal)})`} onClick={() => openJournal(b.reversal)} />);
	const kindOfJob = jobKind(job);
	// Tóm tắt so sánh với kỳ trước (số người mới, không còn, lệch đã có trên các chip lọc): hiện khi rê chuột vào thanh lọc
	const headAttrs = {class: 's4vp-pane-h', title: empSub};

	return (
		<Page>
			<PageHeader
				crumbs={[{label: t.crumb, onClick: () => app.go('payrollList')}, {label: b.name || id}]}
				title={b.description || t.batchOf(b.periodName || '')}
				status={{text: t.status[statusKey] || s, tone: TONE[statusKey] || 'muted'}}
				sub={
					docLinks.length || bills.length ? (
						<div style={{display: 'flex', flexWrap: 'wrap', gap: '0 12px', alignItems: 'center'}}>
							<span>{subParts.join(' · ')}</span>
							{docLinks.map((x, i) => (
								<span key={`d${i}`}>{x}</span>
							))}
							{bills.length ? <span>{t.docs.bills(bills.length)}</span> : null}
						</div>
					) : (
						subParts.join(' · ')
					)
				}
				actions={headerActions}
			/>
			{job ? (
				<Card tone="warn" label={t.job.title}>
					<div style={{display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap'}} role="status" aria-live="polite">
						<span class="s4vp-spin" />
						<span style={{fontWeight: '600'}}>{t.job[kindOfJob] || t.job.calc}</span>
						{kindOfJob === 'calc' && jobInfo ? <span>{t.job.stage(jobInfo.stage, jobInfo.status)}</span> : null}
						<span class="s4vp-muted">{t.job.auto}</span>
					</div>
				</Card>
			) : null}
			<Stepper steps={steps} label={t.stepsLabel} />
			<StatCards cards={cards} />
			<div class="s4vp-cols s4vp-cols-half">
				<div class="s4vp-col-half">
					<section class="s4vp-pane" aria-label={t.emp.title}>
						<div {...headAttrs}>
							<Chips items={filterItems} value={filter} onPick={pickFilter} label={t.emp.filterLabel} />
							<div style={{display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto'}}>
								{found.count === null ? null : <span class="s4vp-tbl-count">{t.emp.matches(found.count)}</span>}
								<SearchBox value={query} onInput={(v) => (setQuery(v), setLimit(PAGE_SIZE))} placeholder={t.emp.search} label={t.emp.searchLabel} width={170} />
							</div>
						</div>
						<div class="s4vp-pane-b">
							<Table
								columns={empColumns}
								rows={shown}
								onRowClick={(r) => selectLine(r.id)}
								selectedKey={sel}
								total={totalRow}
								empty={rows.length || filter === 'left' ? t.emp.emptyFilter : t.emp.empty}
								label={t.emp.title}
							/>
						</div>
						{found.rows.length > shown.length ? (
							<div class="s4vp-pane-f">
								<span>{t.emp.showing(shown.length, found.rows.length)}</span>
								<Button small={true} label={t.emp.more(Math.min(PAGE_SIZE, found.rows.length - shown.length))} onClick={() => setLimit(limit + PAGE_SIZE)} />
							</div>
						) : null}
					</section>
				</div>
				<div class="s4vp-col-half">{renderPanel()}</div>
			</div>
			{renderDialog()}
		</Page>
	);
}
