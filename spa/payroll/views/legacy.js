/**
 * Các màn cũ chưa làm lại theo giao diện bản 2, giữ nguyên bằng thành phần UIF (StackPanel, DataGrid): bảng lương bản cũ
 * (batches: danh sách và chi tiết VP302000), chấm công và phép bản cũ (attendanceLegacy), sản lượng - khoán tổ (outputs),
 * giấy phép lao động (permits), báo cáo - tờ khai (reports), hồ sơ lương (profiles), tạm ứng (advances), thiết lập (setup).
 * Khung (PayrollApp.js) lo tiêu đề, tab điều hướng và ô chọn công ty con; view này đọc app.boot, app.subsidiary và tự giữ
 * dòng thông báo / đang xử lý / xác nhận của mình như trước. Lưới có ô lọc nhanh (không phân biệt dấu, khớp số tiền).
 */
import {useState, useRef, useEffect, ArrayDataSource} from '@uif-js/core';
import {StackPanel, GridPanel, Dropdown, TextBox, TextArea, Button, DataGrid, Text, Heading} from '@uif-js/component';
import url from 'N/url';
import {PRINT, call, post, errorText, openRecord, openJournal, download} from '../lib/api.js';
import {money, num, pct, fmtDate, toIso, localToday, quickFilter} from '../lib/format.js';
import {pick, localized, serverText, serverLanguage} from '../lib/i18n.js';
import {periodOptions, periodsForSubsidiary, defaultPeriodId} from '../lib/periods.js';
import {leaveYearOptions, balanceRows, carryTip} from '../lib/leave.js';

const TEXT = {
	vi: {
		title: 'Lương VN',
		subtitle: 'S4 VN Payroll',
		views: {batches: 'Bảng lương', attendance: 'Chấm công và phép', outputs: 'Sản lượng, khoán tổ', permits: 'Giấy phép lao động', reports: 'Báo cáo, tờ khai', profiles: 'Hồ sơ lương', advances: 'Tạm ứng lương', setup: 'Thiết lập'},
		view: 'Màn hình',
		subsidiary: 'Công ty con',
		period: 'Kỳ lương',
		allPeriods: '(Tất cả kỳ)',
		load: 'Xem',
		newBatch: 'Tạo bảng lương',
		newBatchDesc: 'Diễn giải bảng lương mới',
		pickPeriod: 'Chọn kỳ lương để tạo bảng lương mới',
		description: 'Diễn giải',
		quick: 'Lọc nhanh (tên, mã, số tiền...)',
		quickCount: (n) => `${n} dòng khớp`,
		empty: 'Không có dữ liệu',
		loading: 'Đang tải...',
		working: 'Đang xử lý...',
		done: 'Xong',
		failed: 'Lỗi',
		back: 'Quay lại danh sách',
		openRecord: 'Mở bản ghi',
		status: {H: 'Tạm giữ', B: 'Chờ tính', C: 'Đã tính', P: 'Chờ duyệt', A: 'Đã duyệt', J: 'Từ chối', R: 'Đã ghi sổ', V: 'Đã đảo'},
		advStatus: {H: 'Tạm giữ', B: 'Chờ ghi sổ', O: 'Đang cấn trừ', C: 'Đã tất toán'},
		cols: {
			number: 'Số', period: 'Kỳ', status: 'Trạng thái', count: 'Số người', gross: 'Tổng thu nhập', eeIns: 'BH NLĐ', erIns: 'BH DN', pit: 'Thuế TNCN',
			otherDed: 'Khấu trừ khác', advance: 'Cấn trừ tạm ứng', net: 'Thực lĩnh', journal: 'Bút toán', code: 'Mã NV', name: 'Họ tên', dept: 'Bộ phận',
			std: 'Công chuẩn', work: 'Công TT', exempt: 'Miễn thuế', taxable: 'Chịu thuế', deps: 'NPT', family: 'Giảm trừ gia cảnh', assessable: 'Tính thuế',
			warn: 'Cảnh báo / lỗi', type: 'Loại', earning: 'Khoản', qty: 'Số lượng', rate: 'Đơn giá', mult: 'Hệ số', amount: 'Số tiền', exemptAmt: 'Miễn thuế',
			source: 'Nguồn', component: 'Khoản trích', base: 'Căn cứ', eeRate: 'Tỷ lệ NLĐ', erRate: 'Tỷ lệ DN', account: 'Tài khoản', debit: 'Nợ', credit: 'Có',
			memo: 'Diễn giải', dimension: 'Phòng ban / địa điểm', employment: 'Loại LĐ', salary: 'Lương HĐ', insWage: 'Lương đóng BH', effective: 'Hiệu lực',
			pitMethod: 'Thuế', profile: 'Hồ sơ', docDate: 'Ngày', balance: 'Số dư', offset: 'Đã cấn trừ', del: '',
			erInsShort: 'Trích theo lương DN', netBefore: 'Thực lĩnh trước tạm ứng', earningType: 'Loại thu nhập', project: 'Dự án', task: 'Công việc', branch: 'Địa điểm',
			workCenter: 'Phòng ban', hours: 'Số giờ', ratio: 'Tỷ lệ', advanceNbr: 'Số tạm ứng', balanceAfter: 'Số dư còn lại', document: 'Chứng từ',
		},
		actions: {
			loadEmployees: 'Nạp nhân viên', calculate: 'Tính lương', removeHold: 'Bỏ tạm giữ', hold: 'Tạm giữ', approve: 'Duyệt', reject: 'Từ chối', reopen: 'Mở lại',
			release: 'Ghi sổ', reverse: 'Đảo', agencyBills: 'Lập bill cơ quan thu', bankFile: 'File chi lương', payslips: 'In phiếu lương', paymentSheet: 'In bảng thanh toán',
			contractor: 'In quyết toán CTV', journal: 'Xem bút toán', refresh: 'Tải lại',
			completeRelease: 'Hoàn tất ghi sổ', completeReverse: 'Hoàn tất đảo', clearJob: 'Gỡ khóa tác vụ (admin)',
		},
		resumed: 'Đã hoàn tất các bước còn thiếu',
		confirm: {release: 'Ghi sổ bảng lương này? Hệ thống tạo bút toán và cấn trừ tạm ứng.', reverse: 'Đảo bảng lương này? Hệ thống tạo bút toán đảo và hoàn số dư tạm ứng.', agencyBills: 'Lập bill nộp cơ quan BHXH, công đoàn, thuế?'},
		detailOf: (c, n) => `Chi tiết ${c} ${n}`,
		employeesTitle: (n) => `Nhân viên (${n})`,
		tabs: {earn: 'Thu nhập', ded: 'Khấu trừ khác', ins: 'Bảo hiểm', att: 'Công', time: 'Giờ công', alloc: 'Phân bổ dự án', adv: 'Cấn trừ tạm ứng', journal: 'Bút toán', bills: 'Bill cơ quan thu'},
		batchTabs: 'Cả bảng lương:',
		batchDetail: 'Cả bảng lương',
		noLine: 'Chưa có nhân viên, bấm Nạp nhân viên',
		src: {S: 'Hệ thống', T: 'Giờ công', M: 'Nhập tay', O: 'Sản lượng'},
		allocSrc: {P: 'Bảng tỷ lệ', T: 'Giờ công', R: 'Theo tổ', D: 'Mặc định', S: 'Sản lượng'},
		inputHint: {E: 'Thêm thu nhập nhập tay cho nhân viên đang chọn (số tiền = số lượng × đơn giá × hệ số), sau đó bấm Tính lương.', D: 'Thêm khoản khấu trừ sau thuế cho nhân viên đang chọn, sau đó bấm Tính lương.'},
		attCols: {std_days: 'Công chuẩn', work_days: 'Công hưởng lương', paid_leave: 'Nghỉ có lương', unpaid_leave: 'Nghỉ không lương', si_leave: 'Nghỉ ốm, thai sản (BHXH)', absence_days: 'Ngày nghỉ xét đóng BH', ot_hours: 'Giờ làm thêm', att_locked: 'Công đã khóa'},
		journalNotReady: 'Bảng lương chưa tính, chưa có bút toán dự kiến',
		addInput: 'Thêm dòng',
		kind: {E: 'Thu nhập', D: 'Khấu trừ sau thuế'},
		employee: 'Nhân viên',
		earningType: 'Loại thu nhập',
		deductionCode: 'Mã khấu trừ',
		delete: 'Xóa',
		journalTitle: 'Bút toán dự kiến (chưa ghi sổ)',
		journalTitleReleased: 'Bút toán theo bảng lương (đối chiếu với JE đã ghi sổ)',
		totals: (b) => `Tổng thu nhập ${money(b.gross || 0)} · BH NLĐ ${money(b.ee_ins || 0)} · BH DN ${money(b.er_ins || 0)} · Thuế ${money(b.pit || 0)} · Thực lĩnh ${money(b.net || 0)}`,
		netWords: (w) => `Thực lĩnh nhân viên bằng chữ: ${w}`,
		unverified: (list) => `Tham số chưa đối chiếu văn bản gốc, cần kế toán trưởng duyệt: ${list}`,
		unverifiedShort: (n) => `${n} tham số pháp lý chưa đối chiếu văn bản gốc, cần kế toán trưởng duyệt (xem Thiết lập)`,
		notReady: 'Chưa có thiết lập lương. Vào Thiết lập, bấm Nạp mặc định VN.',
		loadDefaults: 'Nạp mặc định VN',
		generate: 'Sinh kỳ lương',
		year: 'Năm',
		paygroup: 'Nhóm lương',
		setupLinks: 'Danh mục (mở màn hình NetSuite)',
		openSetup: 'Thiết lập chung',
		openCompany: 'Thiết lập theo công ty',
		openList: (n) => n,
		lists: {param: 'Tham số pháp lý', pit_bracket: 'Biểu thuế TNCN', ins_comp: 'Khoản trích theo lương', holiday: 'Ngày lễ', earning_type: 'Loại thu nhập', earning_rule: 'Quy tắc thu nhập', benefit_pkg: 'Gói phúc lợi', leave_type: 'Loại nghỉ', paygroup: 'Nhóm lương', period: 'Kỳ lương', attendance: 'Bảng tổng hợp công'},
		newProfile: 'Tạo hồ sơ lương',
		noProfile: 'Chưa có hồ sơ',
		created: (n) => `Đã tạo ${n}`,
		loaded: (r) => `Đã nạp ${r.added.length} người${r.skipped.length ? `, bỏ qua ${r.skipped.length} người đã ở bảng lương khác cùng kỳ: ${r.skipped.join(', ')}` : ''}${r.time ? `. ${TEXT.vi.timeSynced(r.time)}` : ''}`,
		timeSynced: (r) => `Giờ công: ${r.accepted}/${r.entries} dòng timesheet được nhận${r.pending ? ` (${r.pending} dòng chưa duyệt hoặc bị từ chối)` : ''}; thêm ${r.inserted}, cập nhật ${r.updated}, bỏ ${r.deleted} dòng giờ công`,
		time: {
			title: 'Giờ công tính lương (gộp theo dự án, công việc trong kỳ)',
			hint: 'Giờ lấy từ Time (timesheet) của NetSuite khi bấm Nạp giờ công hoặc Nạp nhân viên. Sửa giờ phải ghi lý do; nạp lại vẫn giữ giờ đã sửa. Giờ thường dùng cho lương giờ và phân bổ dự án; giờ OT lấy từ đơn OT đã duyệt.',
			project: 'Dự án / khách hàng', task: 'Công việc', entries: 'Số dòng', sourceHours: 'Giờ timesheet', hours: 'Giờ tính lương', reason: 'Lý do sửa', edit: 'Sửa giờ',
			none: '(không gắn dự án)', save: 'Lưu giờ', cancel: 'Hủy', editTitle: (n) => `Sửa giờ công: ${n}`,
			detail: (f, to) => `Chi tiết timesheet trong kỳ (${f} - ${to}), đọc trực tiếp từ Time của NetSuite`,
			date: 'Ngày', status: 'Trạng thái duyệt', memo: 'Ghi chú', counted: 'Tính lương',
			approval: {A: 'Đã duyệt', P: 'Chờ duyệt / mở', R: 'Từ chối', N: 'Không dùng duyệt'},
			load: 'Nạp giờ công', loadingSheet: 'Đang đọc timesheet...',
		},
		calcDone: (r) => (r.queued ? 'Đã đưa vào hàng đợi tính lương (bảng lớn), bấm Tải lại sau ít phút' : r.ok ? 'Đã tính xong, không có lỗi' : `Có ${r.errors.length} nhân viên lỗi: ${r.errors.slice(0, 3).join('; ')}`),
		jeCreated: (id) => `Đã tạo bút toán ${id}`,
		billsCreated: (r) => `Đã lập ${r.created.length} bill${r.skipped.length ? `; khoản chưa có cơ quan thu: ${r.skipped.map((s) => s.code).join(', ')}` : ''}`,
		txPosted: 'đã ghi sổ',
		txPending: 'chưa ghi sổ, chờ duyệt',
		txVoided: 'đã hủy',
		reversalLabel: 'đảo',
		billsLabel: 'Bill cơ quan thu',
		billsSummary: (n, posted) => `Bill cơ quan thu: ${n} bill (${posted ? 'đã ghi sổ' : 'có bill chưa ghi sổ'}, xem tab Bill cơ quan thu)`,
		att: {
			build: 'Lập bảng công', lock: 'Khóa công', unlock: 'Mở khóa công', summary: 'Bảng tổng hợp công', docs: 'Chứng từ', docType: 'Loại chứng từ',
			types: {leave: 'Đơn nghỉ', ot: 'Đơn làm thêm giờ', trip: 'Đơn công tác', exception: 'Phiếu ngoại lệ chấm công'},
			reqStatus: {H: 'Tạm giữ', P: 'Chờ duyệt', A: 'Đã duyệt', R: 'Từ chối', C: 'Đã hủy'},
			ops: {submit: 'Gửi duyệt', approve: 'Duyệt', reject: 'Từ chối', cancel: 'Hủy'},
			newDoc: 'Lập chứng từ', save: 'Lưu (tạm giữ)', from: 'Từ ngày (dd/mm/yyyy)', to: 'Đến ngày (dd/mm/yyyy)', workDate: 'Ngày (dd/mm/yyyy)',
			hours: 'Số giờ', minutes: 'Số phút', adjust: 'Điều chỉnh công (-1..1)', reason: 'Lý do', leaveType: 'Loại nghỉ', destination: 'Nơi công tác',
			advanceAmount: 'Số tiền tạm ứng', exceptionType: 'Loại ngoại lệ', exTypes: {L: 'Đi trễ', E: 'Về sớm', A: 'Điều chỉnh công'},
			half: {A: 'Buổi sáng', P: 'Buổi chiều'}, fromHalf: 'Bắt đầu', toHalf: 'Kết thúc', days: 'Số ngày', dayUnit: 'ngày', dayType: 'Loại ngày',
			accrue: 'Cấp phép năm', expire: 'Hết hạn phép chuyển', balances: 'Số dư phép', year: 'Năm',
			accrueYear: (y) => `Cấp phép năm ${y} (kèm chuyển phép năm ${Number(y) - 1})`,
			expireYear: (y) => `Hết hạn phép chuyển năm ${y}`,
			reloadYear: (y) => `Tải lại Số dư phép ${y}`,
			leaveYear: 'Năm phép',
			leaveHint: (y) => `Cấp phép năm ${y} đồng thời chuyển phép còn lại của năm ${Number(y) - 1} sang (tối đa theo chính sách phép, có hạn dùng). Cuối năm chọn năm sau để chuyển phép trước; hết hạn thì bấm Hết hạn phép chuyển để trừ phần chuyển chưa dùng.`,
			confirmExpire: (y, d) => `Hết hạn phép chuyển năm ${y} tính đến ngày ${d}? Phần phép chuyển chưa dùng của số dư đã quá hạn sẽ bị trừ (giao dịch X), chỉ áp cho nhân viên của công ty con đang chọn.`,
			expired: (rows) => `Đã xử lý hết hạn: ${rows.length} số dư, trừ ${rows.reduce((s, r) => s + (Number(r.expired) || 0), 0)} ngày`,
			carryTip: (d) => `Chuyển từ năm trước, hạn đến ${d}`,
			carryTipNoExpiry: 'Chuyển từ năm trước, không có hạn hoặc đã xử lý hết hạn',
			leaveQuick: 'Lọc nhanh (mã, tên nhân viên, loại nghỉ...)',
			cols: {std: 'Công chuẩn', paid: 'Nghỉ có lương', unpaid: 'Không lương', si: 'BHXH', trip: 'Công tác', late: 'Trừ trễ sớm', adj: 'Điều chỉnh', work: 'Công hưởng lương', ot: 'Giờ OT', status: 'Trạng thái',
				entitled: 'Được cấp', carried: 'Chuyển', adjusted: 'Điều chỉnh', used: 'Đã dùng', pending: 'Chờ duyệt', available: 'Còn lại'},
			punches: 'Chấm công máy',
			noSummary: 'Kỳ này chưa có bảng tổng hợp công: bấm Lập bảng công (nếu không, bảng lương dùng công chuẩn trừ ngày ngoài hợp đồng)',
			confirmAccrue: (y) => `Cấp phép năm ${y} và chuyển phép còn lại của năm ${Number(y) - 1} cho nhân viên đang có hồ sơ của công ty con đang chọn? Chạy lại không cấp trùng, không chuyển trùng.`,
			tabs: {summary: 'Bảng tổng hợp công', docs: 'Chứng từ', punches: 'Chấm công máy', leave: 'Số dư phép'},
			confirmUnlock: 'Mở khóa công của kỳ này? Bảng lương đã tính theo công cũ cần tính lại.', punchHint: 'Mỗi dòng: mã nhân viên, thời điểm YYYY-MM-DD HH:mm, thiết bị (cách nhau dấu phẩy). Xử lý chấm công sinh phiếu trễ / sớm / vắng và đơn OT gợi ý ở trạng thái Tạm giữ, không tự trừ lương.',
			importPunches: 'Nạp lượt chấm', processPunches: 'Xử lý chấm công kỳ đang chọn',
			punchResult: (r) => `Nạp ${r.created} lượt, bỏ qua ${r.skipped}${r.errors && r.errors.length ? `, lỗi: ${r.errors.slice(0, 3).map((e) => e.message || e).join('; ')}` : ''}`,
			processResult: (r) => `Đã xử lý ${r.employees} người: ${r.exceptions} phiếu ngoại lệ, ${r.overtime} đơn OT gợi ý (thay ${r.deleted} chứng từ của lần trước, giữ ${r.kept})`,
			accrued: (rows) => `Đã cấp phép: ${rows.filter((r) => r.accrued).length} người${rows.some((r) => r.message) ? ` · ${rows.filter((r) => r.message).map((r) => r.message).join('; ')}` : ''}`,
		},
		out: {
			entries: 'Phiếu sản lượng', type: {I: 'Cá nhân', T: 'Tổ'}, status: {H: 'Tạm giữ', P: 'Chờ duyệt', A: 'Đã duyệt', C: 'Đã vào bảng lương'},
			ops: {submit: 'Gửi duyệt', approve: 'Duyệt', hold: 'Tạm giữ', split: 'Chia tiền tổ', members: 'Nạp thành viên tổ'},
			cols: {date: 'Ngày', type: 'Loại', table: 'Bảng đơn giá', team: 'Tổ', total: 'Thành tiền', split: 'Đã chia', lines: 'Dòng sản lượng', members: 'Thành viên'},
			hint: 'Lập phiếu và nhập dòng sản lượng trên màn hình NetSuite (nút Tạo phiếu sản lượng). Ở đây: nạp thành viên tổ, chia tiền tổ, gửi duyệt, duyệt. Bấm một dòng để xem chi tiết.',
			create: 'Tạo phiếu sản lượng',
			detail: (n) => `Chi tiết phiếu ${n}`,
			people: (n) => `${n} người`,
			lineCount: (n) => `${n} dòng`,
			item: 'Sản phẩm / công đoạn',
		},
		wp: {
			status: {D: 'Đang chuẩn bị', S: 'Đã nộp', A: 'Còn hiệu lực', E: 'Hết hạn', V: 'Thu hồi'},
			ops: {submit: 'Nộp', issue: 'Đã cấp', revoke: 'Thu hồi', extend: 'Tạo gia hạn'},
			cols: {no: 'Số giấy', effective: 'Hiệu lực', expiry: 'Hết hạn', left: 'Còn (ngày)', issue: 'Loại cấp'},
			issueType: {N: 'Cấp mới', X: 'Gia hạn', R: 'Cấp lại'},
			updateExpired: 'Cập nhật giấy hết hạn',
			permitNo: 'Số giấy phép', issued: 'Ngày cấp (dd/mm/yyyy)',
			create: 'Tạo giấy phép',
			issueForm: 'Thông tin cấp giấy (điền trước khi bấm Đã cấp trên dòng)',
			confirmRevoke: 'Thu hồi giấy phép này? Nhân viên sẽ bị cảnh báo / chặn khi tính lương.',
		},
		rep: {
			type: 'Báo cáo', types: {insurance: 'Bảng BH phải nộp và D02-LT (VP402000)', pitq: 'Tờ khai 05/KK-TNCN theo quý (VP403000)', pita: 'Dữ liệu quyết toán TNCN năm 05-1/BK, 05-2/BK (VP404000)', cost: 'Chi phí nhân sự theo tài khoản, đối chiếu GL (VP405000)'},
			taxMonth: 'Tháng tính thuế', year: 'Năm', quarter: 'Quý', schedule: 'Bảng kê', c12: 'Số trên thông báo C12-TS', releasedOnly: 'Chỉ bảng lương đã ghi sổ',
			yesNo: {T: 'Có', F: 'Không'}, run: 'Xem', csv: 'Xuất CSV', d02: 'Danh sách biến động D02-LT', indicators: 'Chỉ tiêu tờ khai', c12Diff: (a, d) => `Thông báo C12-TS ${money(a)} · Chênh lệch ${money(d)}`,
			code: 'Chỉ tiêu', item: 'Nội dung', value: 'Giá trị',
		},
		yes: 'Đồng ý',
		empType: {E: 'Nhân viên (HĐLĐ)', C: 'Cộng tác viên'},
		pitMethods: {P: 'Lũy tiến', F: 'Khấu trừ 10%', N: 'Không cư trú 20%', X: 'Không khấu trừ'},
		adv: {
			newTitle: 'Lập phiếu tạm ứng (tạm giữ; chọn tài khoản tiền trên bản ghi trước khi bỏ tạm giữ)',
			date: 'Ngày (dd/mm/yyyy)', save: 'Lập phiếu', removeHold: 'Bỏ tạm giữ', release: 'Ghi sổ',
			confirmRelease: 'Ghi sổ phiếu tạm ứng này? Hệ thống tạo bút toán chi tạm ứng.',
		},
		cancel: 'Hủy',
	},
	// Bản tiếng Anh: nhãn gốc theo Acumatica; đủ mọi khóa của bản vi (kiểm bằng node tools/check_i18n.mjs)
	en: {
		title: 'VN Payroll',
		subtitle: 'S4 VN Payroll',
		views: {batches: 'Payroll Batches', attendance: 'Attendance and Leave', outputs: 'Output Entries', permits: 'Work Permits', reports: 'Reports and Declarations', profiles: 'Employee Payroll Profiles', advances: 'Payroll Advances', setup: 'Setup'},
		view: 'Screen',
		subsidiary: 'Subsidiary',
		period: 'Pay period',
		allPeriods: '(All periods)',
		load: 'View',
		newBatch: 'New batch',
		newBatchDesc: 'Description of the new payroll batch',
		pickPeriod: 'Select a pay period to create a payroll batch',
		description: 'Description',
		quick: 'Quick filter (name, code, amount...)',
		quickCount: (n) => `${n} matching rows`,
		empty: 'No data',
		loading: 'Loading...',
		working: 'Working...',
		done: 'Done',
		failed: 'Error',
		back: 'Back to list',
		openRecord: 'Open record',
		status: {H: 'On Hold', B: 'Pending Calculation', C: 'Calculated', P: 'Pending Approval', A: 'Approved', J: 'Rejected', R: 'Released', V: 'Reversed'},
		advStatus: {H: 'On Hold', B: 'Pending Release', O: 'Open for Offset', C: 'Settled'},
		cols: {
			number: 'Number', period: 'Period', status: 'Status', count: 'Employees', gross: 'Gross pay', eeIns: 'Employee insurance', erIns: 'Employer insurance', pit: 'PIT',
			otherDed: 'Other deductions', advance: 'Advance offset', net: 'Net pay', journal: 'Journal', code: 'Employee ID', name: 'Full name', dept: 'Department',
			std: 'Standard days', work: 'Days worked', exempt: 'Tax exempt', taxable: 'Taxable', deps: 'Dependants', family: 'Family deductions', assessable: 'Assessable income',
			warn: 'Warnings / errors', type: 'Type', earning: 'Item', qty: 'Quantity', rate: 'Rate', mult: 'Multiplier', amount: 'Amount', exemptAmt: 'Tax exempt',
			source: 'Source', component: 'Contribution', base: 'Base', eeRate: 'Employee rate', erRate: 'Employer rate', account: 'Account', debit: 'Debit', credit: 'Credit',
			memo: 'Description', dimension: 'Department / location', employment: 'Employment type', salary: 'Contract salary', insWage: 'Insurance salary', effective: 'Effective',
			pitMethod: 'PIT', profile: 'Profile', docDate: 'Date', balance: 'Balance', offset: 'Offset to date', del: '',
			erInsShort: 'Employer contributions', netBefore: 'Net pay before advances', earningType: 'Earning type', project: 'Project', task: 'Task', branch: 'Location',
			workCenter: 'Department', hours: 'Hours', ratio: 'Ratio', advanceNbr: 'Advance number', balanceAfter: 'Remaining balance', document: 'Document',
		},
		actions: {
			loadEmployees: 'Load Employees', calculate: 'Calculate', removeHold: 'Remove Hold', hold: 'Hold', approve: 'Approve', reject: 'Reject', reopen: 'Reopen',
			release: 'Release', reverse: 'Reverse', agencyBills: 'Create Agency Bills', bankFile: 'Export Bank File', payslips: 'Print Payslips', paymentSheet: 'Print Payment Sheet',
			contractor: 'Print Contractor Settlement', journal: 'Preview Journal', refresh: 'Refresh',
			completeRelease: 'Complete Release', completeReverse: 'Complete Reversal', clearJob: 'Clear job lock (admin)',
		},
		resumed: 'Remaining steps completed',
		confirm: {release: 'Release this payroll batch? The system creates the journal entry and offsets advances.', reverse: 'Reverse this payroll batch? The system creates a reversing journal and restores advance balances.', agencyBills: 'Create bills for the social insurance, union and tax agencies?'},
		detailOf: (c, n) => `Details of ${c} ${n}`,
		employeesTitle: (n) => `Employees (${n})`,
		tabs: {earn: 'Earnings', ded: 'Other deductions', ins: 'Insurance', att: 'Attendance', time: 'Hours', alloc: 'Project allocation', adv: 'Advance offset', journal: 'Journal', bills: 'Agency bills'},
		batchTabs: 'Whole batch:',
		batchDetail: 'Whole batch',
		noLine: 'No employees yet - click Load Employees',
		src: {S: 'System', T: 'Timesheet', M: 'Manual', O: 'Output'},
		allocSrc: {P: 'Ratio table', T: 'Timesheet', R: 'By team', D: 'Default', S: 'Output'},
		inputHint: {E: 'Add a manual earning for the selected employee (amount = quantity × rate × multiplier), then click Calculate.', D: 'Add an after-tax deduction for the selected employee, then click Calculate.'},
		attCols: {std_days: 'Standard days', work_days: 'Paid days', paid_leave: 'Paid leave', unpaid_leave: 'Unpaid leave', si_leave: 'Sick and maternity leave (social insurance)', absence_days: 'Absence days for insurance', ot_hours: 'Overtime hours', att_locked: 'Attendance locked'},
		journalNotReady: 'The payroll batch has not been calculated; there is no journal preview yet',
		addInput: 'Add line',
		kind: {E: 'Earning', D: 'After-tax deduction'},
		employee: 'Employee',
		earningType: 'Earning type',
		deductionCode: 'Deduction code',
		delete: 'Delete',
		journalTitle: 'Journal preview (not released)',
		journalTitleReleased: 'Journal by payroll batch (compare with the released journal entry)',
		totals: (b) => `Gross pay ${money(b.gross || 0)} · Employee insurance ${money(b.ee_ins || 0)} · Employer insurance ${money(b.er_ins || 0)} · PIT ${money(b.pit || 0)} · Net pay ${money(b.net || 0)}`,
		netWords: (w) => `Employee net pay in words: ${w}`,
		unverified: (list) => `Parameters not yet verified against the legal source, pending chief accountant approval: ${list}`,
		unverifiedShort: (n) => `${n} statutory parameters not yet verified against the legal source, pending chief accountant approval (see Setup)`,
		notReady: 'Payroll preferences are missing. Open Setup and click Load VN Defaults.',
		loadDefaults: 'Load VN Defaults',
		generate: 'Generate Periods',
		year: 'Year',
		paygroup: 'Pay group',
		setupLinks: 'Lists (open the NetSuite screen)',
		openSetup: 'General Setup',
		openCompany: 'Company Setup',
		openList: (n) => n,
		lists: {param: 'Statutory parameters', pit_bracket: 'PIT brackets', ins_comp: 'Payroll contributions', holiday: 'Public holidays', earning_type: 'Earning types', earning_rule: 'Earning rules', benefit_pkg: 'Benefit packages', leave_type: 'Leave types', paygroup: 'Pay groups', period: 'Pay periods', attendance: 'Attendance summary'},
		newProfile: 'New Payroll Profile',
		noProfile: 'No profile',
		created: (n) => `Created ${n}`,
		loaded: (r) => `Loaded ${r.added.length} employees${r.skipped.length ? `, skipped ${r.skipped.length} already on another batch of the period: ${r.skipped.join(', ')}` : ''}${r.time ? `. ${TEXT.en.timeSynced(r.time)}` : ''}`,
		timeSynced: (r) => `Hours: ${r.accepted}/${r.entries} timesheet entries accepted${r.pending ? ` (${r.pending} pending or rejected)` : ''}; ${r.inserted} added, ${r.updated} updated, ${r.deleted} removed`,
		time: {
			title: 'Payroll hours (grouped by project and task within the period)',
			hint: 'Hours come from NetSuite Time (timesheets) when you click Load Hours or Load Employees. Editing hours requires a reason; edited hours are kept when hours are loaded again. Regular hours feed hourly pay and project allocation; overtime hours come from approved overtime requests.',
			project: 'Project / customer', task: 'Task', entries: 'Entries', sourceHours: 'Timesheet hours', hours: 'Payroll hours', reason: 'Reason for change', edit: 'Edit hours',
			none: '(no project)', save: 'Save hours', cancel: 'Cancel', editTitle: (n) => `Edit hours: ${n}`,
			detail: (f, to) => `Timesheet details in the period (${f} - ${to}), read directly from NetSuite Time`,
			date: 'Date', status: 'Approval status', memo: 'Memo', counted: 'Counted for payroll',
			approval: {A: 'Approved', P: 'Pending / open', R: 'Rejected', N: 'Approval not used'},
			load: 'Load Hours', loadingSheet: 'Reading timesheets...',
		},
		calcDone: (r) => (r.queued ? 'Queued for calculation (large batch) - click Refresh in a few minutes' : r.ok ? 'Calculated with no errors' : `${r.errors.length} employees with errors: ${r.errors.slice(0, 3).join('; ')}`),
		jeCreated: (id) => `Journal entry ${id} created`,
		billsCreated: (r) => `Created ${r.created.length} bills${r.skipped.length ? `; no agency vendor for: ${r.skipped.map((s) => s.code).join(', ')}` : ''}`,
		txPosted: 'posted',
		txPending: 'not posted, pending approval',
		txVoided: 'voided',
		reversalLabel: 'reversal',
		billsLabel: 'Agency bills',
		billsSummary: (n, posted) => `Agency bills: ${n} bills (${posted ? 'posted' : 'some not posted'}, see the Agency bills tab)`,
		att: {
			build: 'Build Attendance', lock: 'Lock Attendance', unlock: 'Unlock Attendance', summary: 'Attendance summary', docs: 'Documents', docType: 'Document type',
			types: {leave: 'Leave request', ot: 'Overtime request', trip: 'Business trip request', exception: 'Attendance exception'},
			reqStatus: {H: 'On Hold', P: 'Pending Approval', A: 'Approved', R: 'Rejected', C: 'Canceled'},
			ops: {submit: 'Submit', approve: 'Approve', reject: 'Reject', cancel: 'Cancel'},
			newDoc: 'New document', save: 'Save (on hold)', from: 'From date (dd/mm/yyyy)', to: 'To date (dd/mm/yyyy)', workDate: 'Date (dd/mm/yyyy)',
			hours: 'Hours', minutes: 'Minutes', adjust: 'Day adjustment (-1..1)', reason: 'Reason', leaveType: 'Leave type', destination: 'Destination',
			advanceAmount: 'Advance amount', exceptionType: 'Exception type', exTypes: {L: 'Late arrival', E: 'Early leave', A: 'Day adjustment'},
			half: {A: 'Morning', P: 'Afternoon'}, fromHalf: 'Starts', toHalf: 'Ends', days: 'Days', dayUnit: 'days', dayType: 'Day type',
			accrue: 'Accrue Annual Leave', expire: 'Expire Carried Leave', balances: 'Leave balances', year: 'Year',
			accrueYear: (y) => `Accrue ${y} leave (incl. carry-over from ${Number(y) - 1})`,
			expireYear: (y) => `Expire carried leave ${y}`,
			reloadYear: (y) => `Reload leave balances ${y}`,
			leaveYear: 'Leave year',
			leaveHint: (y) => `Accruing ${y} leave also carries the unused ${Number(y) - 1} balance over (up to the leave policy maximum, with an expiry date). Near year end, pick next year to carry leave over early; once it expires, click Expire carried leave to deduct the unused carry-over.`,
			confirmExpire: (y, d) => `Expire carried leave for ${y} as of ${d}? The unused carry-over of balances past their expiry date is deducted (transaction X), for employees of the selected subsidiary only.`,
			expired: (rows) => `Expiry processed: ${rows.length} balances, ${rows.reduce((s, r) => s + (Number(r.expired) || 0), 0)} days deducted`,
			carryTip: (d) => `Carried over from last year, expires ${d}`,
			carryTipNoExpiry: 'Carried over from last year, no expiry date or expiry already processed',
			leaveQuick: 'Quick filter (employee ID, name, leave type...)',
			cols: {std: 'Standard days', paid: 'Paid leave', unpaid: 'Unpaid', si: 'Social insurance', trip: 'Business trip', late: 'Late / early deduction', adj: 'Adjustment', work: 'Paid days', ot: 'OT hours', status: 'Status',
				entitled: 'Entitled', carried: 'Carried over', adjusted: 'Adjusted', used: 'Used', pending: 'Pending approval', available: 'Available'},
			punches: 'Time clock',
			noSummary: 'This period has no attendance summary: click Build Attendance (otherwise the payroll batch uses standard days less days outside the contract)',
			confirmAccrue: (y) => `Accrue ${y} annual leave and carry over the unused ${Number(y) - 1} leave for employees with a payroll profile in the selected subsidiary? Running it again does not accrue or carry over twice.`,
			tabs: {summary: 'Attendance summary', docs: 'Documents', punches: 'Time clock', leave: 'Leave balances'},
			confirmUnlock: 'Unlock attendance for this period? Payroll batches calculated on the old attendance must be recalculated.', punchHint: 'One punch per line: employee ID, time as YYYY-MM-DD HH:mm, device (comma separated). Processing punches creates late / early / absence exceptions and suggested overtime requests in On Hold status; it does not deduct pay by itself.',
			importPunches: 'Import Punches', processPunches: 'Process punches for the selected period',
			punchResult: (r) => `Imported ${r.created} punches, skipped ${r.skipped}${r.errors && r.errors.length ? `, errors: ${r.errors.slice(0, 3).map((e) => e.message || e).join('; ')}` : ''}`,
			processResult: (r) => `Processed ${r.employees} employees: ${r.exceptions} exceptions, ${r.overtime} suggested overtime requests (replaced ${r.deleted} documents from the previous run, kept ${r.kept})`,
			accrued: (rows) => `Leave accrued: ${rows.filter((r) => r.accrued).length} employees${rows.some((r) => r.message) ? ` · ${rows.filter((r) => r.message).map((r) => r.message).join('; ')}` : ''}`,
		},
		out: {
			entries: 'Output entries', type: {I: 'Individual', T: 'Team'}, status: {H: 'On Hold', P: 'Pending Approval', A: 'Approved', C: 'In payroll batch'},
			ops: {submit: 'Submit', approve: 'Approve', hold: 'Hold', split: 'Split Team Pay', members: 'Load Team Members'},
			cols: {date: 'Date', type: 'Type', table: 'Rate table', team: 'Team', total: 'Amount', split: 'Split', lines: 'Output lines', members: 'Members'},
			hint: 'Create entries and enter output lines on the NetSuite screen (New Output Entry button). Here: load team members, split team pay, submit, approve. Click a row to see its details.',
			create: 'New Output Entry',
			detail: (n) => `Details of entry ${n}`,
			people: (n) => `${n} people`,
			lineCount: (n) => `${n} lines`,
			item: 'Product / operation',
		},
		wp: {
			status: {D: 'In preparation', S: 'Submitted', A: 'Valid', E: 'Expired', V: 'Revoked'},
			ops: {submit: 'Submit', issue: 'Issued', revoke: 'Revoke', extend: 'Create Extension'},
			cols: {no: 'Permit number', effective: 'Effective', expiry: 'Expires', left: 'Days left', issue: 'Issue type'},
			issueType: {N: 'New', X: 'Extension', R: 'Reissue'},
			updateExpired: 'Update Expired Permits',
			permitNo: 'Permit number', issued: 'Issue date (dd/mm/yyyy)',
			create: 'New Work Permit',
			issueForm: 'Issue details (fill in before clicking Issued on the row)',
			confirmRevoke: 'Revoke this work permit? The employee will be flagged / blocked in payroll calculation.',
		},
		rep: {
			type: 'Report', types: {insurance: 'Insurance payable and D02-LT (VP402000)', pitq: 'Quarterly PIT return 05/KK-TNCN (VP403000)', pita: 'Annual PIT finalization data 05-1/BK, 05-2/BK (VP404000)', cost: 'Payroll cost by account, GL reconciliation (VP405000)'},
			taxMonth: 'Tax month', year: 'Year', quarter: 'Quarter', schedule: 'Schedule', c12: 'Amount on the C12-TS notice', releasedOnly: 'Released batches only',
			yesNo: {T: 'Yes', F: 'No'}, run: 'View', csv: 'Export CSV', d02: 'D02-LT changes list', indicators: 'Return line items', c12Diff: (a, d) => `C12-TS notice ${money(a)} · Difference ${money(d)}`,
			code: 'Line', item: 'Description', value: 'Value',
		},
		yes: 'OK',
		empType: {E: 'Employee (labor contract)', C: 'Contractor'},
		pitMethods: {P: 'Progressive', F: 'Flat 10% withholding', N: 'Non-resident 20%', X: 'No withholding'},
		adv: {
			newTitle: 'New advance (on hold; select the cash account on the record before removing the hold)',
			date: 'Date (dd/mm/yyyy)', save: 'Create Advance', removeHold: 'Remove Hold', release: 'Release',
			confirmRelease: 'Release this advance? The system creates the advance payment journal.',
		},
		cancel: 'Cancel',
	},
};

const item = (child, key) => (
	<StackPanel.Item key={key} shrink={0}>
		{child}
	</StackPanel.Item>
);

function actionRow(buttons, messages) {
	const parts = [];
	buttons.forEach((b, i) => parts.push(item(b, `btn-${i}`)));
	const list = (messages || []).filter((m) => m && m.text);
	if (list.length) {
		parts.push(
			item(
				<Text size={Text.Size.S} rootStyle={{whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%'}} type={list.some((m) => m.strong) ? Text.Type.STRONG : Text.Type.WEAK}>
					{list.map((m) => m.text).join('  ·  ')}
				</Text>,
				'status'
			)
		);
	}
	return (
		<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.M} alignment={StackPanel.Alignment.CENTER} wrap={true}>
			{parts}
		</StackPanel>
	);
}

const labeled = (label, control) => (
	<StackPanel orientation={StackPanel.Orientation.VERTICAL} itemGap={StackPanel.GapSize.XS}>
		<StackPanel.Item key="label">
			<Text size={Text.Size.S} type={Text.Type.WEAK}>
				{label}
			</Text>
		</StackPanel.Item>
		<StackPanel.Item key="control">{control}</StackPanel.Item>
	</StackPanel>
);

const cell = (child, key) => <GridPanel.Item key={key}>{child}</GridPanel.Item>;

const safe = (fn) => (args) => {
	try {
		return fn(args.cell.row.dataItem);
	} catch (e) {
		return <Text>{''}</Text>;
	}
};

const plain = (v, strong) => <Text weight={strong ? Text.Weight.BOLD : Text.Weight.NORMAL}>{v === null || v === undefined ? '' : String(v)}</Text>;
const textCol = (name, label, width, fn) => ({name, label, width, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => plain(fn(r), r.bold))});
// Cột tiền căn phải (cả tiêu đề) để số thẳng hàng, không dính vào chữ của cột bên trái (GridColumn chỉ có qua DataGrid.Column)
const RIGHT = DataGrid.Column && DataGrid.Column.HorizontalAlignment ? {horizontalAlignment: DataGrid.Column.HorizontalAlignment.RIGHT, headerHorizontalAlignment: DataGrid.Column.HorizontalAlignment.RIGHT} : {};
const rightCol = (name, label, width, fn) =>
	Object.assign({name, label, width, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Text weight={r.bold ? Text.Weight.BOLD : Text.Weight.NORMAL} rootStyle={{paddingRight: '28px'}}>{fn(r)}</Text>)}, RIGHT);
const moneyCol = (name, label, width) => rightCol(name, label, width || 125, (r) => money(r[name]));
// Cột số (công, số lượng, đơn giá, hệ số, giờ) căn phải như cột tiền
const numCol = (name, label, width, fn) => rightCol(name, label, width, fn);

// columnStretch không giãn cột khi tổng bề rộng nhỏ hơn khung: nhân bề rộng cột theo bề ngang cửa sổ để lưới phủ hết trang
const fitCols = (columns) => {
	const sum = columns.reduce((a, c) => a + (c.width || 0), 0);
	const factor = sum ? Math.max(1, (window.innerWidth - 130) / sum) : 1;
	return factor === 1 ? columns : columns.map((c) => Object.assign({}, c, {width: Math.floor((c.width || 0) * factor)}));
};

// Chiều cao lưới theo số dòng (không để khoảng trắng lớn khi ít dòng), tối đa max px
const autoH = (n, max) => `${Math.min(max, 84 + 44 * Math.max(n, 2))}px`;

// Thanh nút dạng tab: nút đang chọn tô đậm
// Tooltip của ô chọn kỳ (Dropdown UIF không có tooltip từng mục): mã kỳ của mục đang chọn
const periodTip = (list, value) => ((list || []).find((o) => o.value === String(value || '')) || {}).title || null;

const tabStrip = (keys, labels, current, pick) =>
	keys.map((k) => <Button label={labels[k]} hierarchy={current === k ? Button.Hierarchy.PRIMARY : Button.Hierarchy.SECONDARY} type={current === k ? Button.Type.PRIMARY : Button.Type.GHOST} action={() => pick(k)} />);

const EMPTY_INPUT = {earning_type: '', code: '', qty: '1', rate: '', multiplier: '', amount: '', description: ''};

// DataGrid giữ thanh cuộn ngang "nổi" ở mép dưới cửa sổ khi đáy lưới nằm ngoài màn hình, và chỉ tính lại vị trí khi cửa sổ
// đổi cỡ: cuộn trang hoặc lưới đổi chiều cao thì thanh cuộn kẹt giữa lưới, đè lên dòng. Phát resize (gộp lần liền nhau) sau mỗi
// lần vẽ và khi trang cuộn; resize không đổi state nên không lặp vẽ. Lần đầu lưới đo muộn hơn nên phát thêm lần sau 800 ms.
// Chỉ chạy khi màn cũ đang hiển thị (legacyActive): các màn mới vẽ bằng HTML thuần, không cần và không nên bị phát resize.
let relayoutTimers = [];
let legacyActive = false;
function scheduleRelayout(delays) {
	relayoutTimers.forEach(clearTimeout);
	relayoutTimers = (delays || [200, 800]).map((ms) => setTimeout(() => legacyActive && window.dispatchEvent(new Event('resize')), ms));
}
window.addEventListener('scroll', () => legacyActive && scheduleRelayout([80]), {capture: true, passive: true});

let renders = 0;
let windowStart = Date.now();

const LEGACY_VIEWS = ['batches', 'attendance', 'outputs', 'permits', 'reports', 'profiles', 'advances', 'setup'];

export default function LegacyView(props) {
	if (Date.now() - windowStart > 2000) {
		windowStart = Date.now();
		renders = 0;
	}
	renders += 1;
	if (renders > 60) throw new Error('S4VP payroll legacy: render loop detected');
	legacyActive = true;
	scheduleRelayout();
	const app = props.app || {};
	const t = useRef(pick(TEXT)).current;
	// Khung cấp bootstrap, công ty con và tên màn; attendanceLegacy là màn chấm công cũ (tên nội bộ: attendance)
	const boot = app.boot || null;
	const subsidiary = String(app.subsidiary || '');
	const named = props.view === 'attendanceLegacy' ? 'attendance' : props.view;
	const view = LEGACY_VIEWS.indexOf(named) >= 0 ? named : 'setup';
	// Vừa đổi màn hoặc công ty con: bỏ bảng lương đang mở ngay trong lần vẽ này (state được dọn ở effect bên dưới)
	const last = useRef({view, subsidiary});
	const moved = last.current.view !== view || last.current.subsidiary !== subsidiary;
	const [period, setPeriod] = useState('');
	const [batches, setBatches] = useState([]);
	const [batchState, setBatch] = useState(null);
	const batch = moved ? null : batchState;
	const [selected, setSelected] = useState(null);
	const [journal, setJournal] = useState(null);
	const [profiles, setProfiles] = useState([]);
	const [advances, setAdvances] = useState([]);
	const [quick, setQuick] = useState('');
	const [description, setDescription] = useState('');
	const [busy, setBusy] = useState('');
	const [notice, setNotice] = useState('');
	const [error, setError] = useState('');
	const [confirm, setConfirm] = useState(null);
	const [tab, setTab] = useState('earn');
	const [tsheet, setTsheet] = useState(null);
	const tsReq = useRef('');
	const [timeEdit, setTimeEdit] = useState(null);
	const timeRef = useRef(null);
	const [input, setInput] = useState(EMPTY_INPUT);
	const inputRef = useRef(input);
	const [year, setYear] = useState(String(new Date().getFullYear()));
	const [paygroup, setPaygroup] = useState('');
	const [attPeriod, setAttPeriod] = useState('');
	const [attRows, setAttRows] = useState([]);
	const [docType, setDocType] = useState('leave');
	const [docs, setDocs] = useState([]);
	const [balances, setBalances] = useState([]);
	// Năm của mục Số dư phép (riêng với ô Năm sinh kỳ ở Thiết lập): năm nay hoặc năm sau
	const [leaveYear, setLeaveYear] = useState(String(new Date().getFullYear()));
	const balReq = useRef(0);
	const [employees, setEmployees] = useState([]);
	const docRef = useRef({});
	const [docForm, setDocForm] = useState({});
	const [repType, setRepType] = useState('insurance');
	const repRef = useRef({taxMonth: '', year: String(new Date().getFullYear()), quarter: String(Math.floor(new Date().getMonth() / 3) + 1), schedule: '', c12: '', releasedOnly: 'F'});
	const [repForm, setRepForm] = useState(repRef.current);
	const [report, setReport] = useState(null);
	const [outputs, setOutputs] = useState([]);
	const [outPeriod, setOutPeriod] = useState('');
	const [outSel, setOutSel] = useState(null);
	const [attTab, setAttTab] = useState('summary');
	const advRef = useRef({employee: '', date: '', amount: '', memo: ''});
	const [advForm, setAdvForm] = useState(advRef.current);
	const [permits, setPermits] = useState([]);
	const wpRef = useRef({permitNo: '', issued: ''});
	const [wpForm, setWpForm] = useState(wpRef.current);

	const alive = useRef(true);
	const run = (label, promise, after) => {
		setBusy(label || t.working);
		setError('');
		setNotice('');
		// Kết quả về sau khi đã rời màn cũ (view bị gỡ): không cập nhật state nữa
		return promise
			.then((r) => {
				if (!alive.current) return r;
				setBusy('');
				if (after) after(r);
				return r;
			})
			.catch((e) => {
				if (!alive.current) return;
				setBusy('');
				setError(`${t.failed}: ${errorText(e)}`);
			});
	};

	// Bootstrap do khung giữ: nạp lại qua app.reloadBoot (sau khi nạp mặc định, sinh kỳ, khóa công)
	const reloadBoot = () => (app.reloadBoot ? app.reloadBoot() : Promise.resolve(boot));

	useEffect(() => {
		if (boot && !paygroup && (boot.paygroups || []).length) setPaygroup(String(boot.paygroups[0].id));
	}, [!!boot]);

	// Rời màn cũ thì ngừng phát resize cho DataGrid
	useEffect(
		() => () => {
			legacyActive = false;
			alive.current = false;
		},
		[]
	);


	const loadBatches = (sub, per) => run(t.loading, call({action: 'batches', subsidiary: sub || subsidiary, period: per === undefined ? period : per}), (r) => setBatches(r.batches));
	// keep: giữ nhân viên, tab và ô lọc đang chọn khi tải lại sau một thao tác trên cùng bảng lương
	const openBatch = (id, keep) =>
		run(t.loading, call({action: 'batch', id}), (r) => {
			setBatch(r);
			setJournal(null);
			if (!keep) {
				setSelected(null);
				setTab('earn');
				setQuick('');
			}
		});
	const refresh = () => (batch ? openBatch(batch.batch.id, true) : loadBatches());

	useEffect(() => {
		// Đổi màn: bỏ ô lọc và báo cáo đang xem; đổi màn hoặc công ty con: bỏ bảng lương đang mở (như nút chuyển màn trước đây)
		if (last.current.view !== view) {
			setQuick('');
			setReport(null);
		}
		if (moved && batchState) setBatch(null);
		const subChanged = last.current.subsidiary !== subsidiary;
		last.current = {view, subsidiary};
		if (!boot) return;
		// Đổi công ty con: bỏ kỳ lọc không thuộc công ty mới (effect chạy lại khi period đổi), bỏ số dư phép và danh sách nhân
		// viên của công ty cũ (số dư phép chỉ nạp khi lưới rỗng nên phải dọn, nếu không lưới vẫn hiện nhân viên công ty trước)
		const ownPeriod = (id) => !id || periodsForSubsidiary(boot, subsidiary).some((x) => String(x.id) === String(id));
		const outPer = subChanged && !ownPeriod(outPeriod) ? '' : outPeriod;
		if (outPer !== outPeriod) setOutPeriod('');
		if (subChanged) {
			setBalances([]);
			setEmployees([]);
		}
		if (subChanged && !ownPeriod(period)) {
			setPeriod('');
			return;
		}
		if (subsidiary && view === 'batches' && !batch) loadBatches(subsidiary, period);
		if (subsidiary && view === 'profiles') run(t.loading, call({action: 'profiles', subsidiary}), (r) => setProfiles(r.employees));
		if (subsidiary && view === 'advances') run(t.loading, call({action: 'advances', subsidiary}), (r) => setAdvances(r.advances));
		if (subsidiary && view === 'outputs') run(t.loading, call({action: 'outputs', subsidiary, period: outPer}), (r) => setOutputs(r.outputs));
		if (subsidiary && view === 'permits') run(t.loading, call({action: 'workPermits', subsidiary}), (r) => setPermits(r.permits));
		if (subsidiary && (view === 'outputs' || view === 'permits' || view === 'advances') && (subChanged || !employees.length)) call({action: 'profiles', subsidiary}).then((r) => alive.current && setEmployees(r.employees.filter((e) => e.profile))).catch(() => {});
		if (subsidiary && view === 'attendance') {
			// Kỳ đang chọn không thuộc công ty con mới (đổi công ty) thì về kỳ mặc định của công ty đó
			const own = !!attPeriod && periodsForSubsidiary(boot, subsidiary).some((x) => String(x.id) === attPeriod);
			const p = own ? attPeriod : defaultPeriod();
			if (p && p !== attPeriod) setAttPeriod(p);
			if (p) loadAttendance(p);
			loadDocs(docType);
			call({action: 'profiles', subsidiary}).then((r) => alive.current && setEmployees(r.employees.filter((e) => e.profile))).catch(() => {});
			// Đang ở tab Số dư phép: nạp lại theo công ty con mới
			if (subChanged && attTab === 'leave') loadBalances();
		}
	}, [subsidiary, period, view, !!boot]);

	// Kỳ mặc định trong các kỳ của công ty con đang chọn (lib/periods.js)
	function defaultPeriod() {
		if (!boot) return '';
		return defaultPeriodId(periodsForSubsidiary(boot, subsidiary), localToday());
	}

	const loadDocs = (type) => run(t.loading, call({action: 'docs', type, subsidiary}), (r) => setDocs(r.docs));
	// Số dư phép của công ty con đang chọn; bỏ kết quả về muộn của lần nạp trước (đổi công ty / năm liền nhau)
	const loadBalances = (y) => {
		balReq.current += 1;
		const mine = balReq.current;
		return run(t.loading, call({action: 'leaveBalances', subsidiary, year: y || leaveYear}), (x) => mine === balReq.current && setBalances((x && x.balances) || []));
	};
	const loadAttendance = (per) => per && run(t.loading, call({action: 'attendance', period: per}), (r) => setAttRows(r.rows));
	const setDoc = (k) => (a) => {
		docRef.current = Object.assign({}, docRef.current, {[k]: a.value !== undefined ? a.value : String(a.text || '')});
		setDocForm(docRef.current);
	};
	const setRep = (k) => (a) => {
		repRef.current = Object.assign({}, repRef.current, {[k]: a.value !== undefined ? a.value : String(a.text || '')});
		setRepForm(repRef.current);
	};

	const act = (action, extra, message, keep) => {
		const id = batch.batch.id;
		return run(t.working, post(Object.assign({action, id}, extra || {})), (r) => {
			const warn = ((r && r.warnings) || []).map((w) => serverText(w.message, w.messageVi)).filter(Boolean);
			// Thao tác trên cùng bảng lương: giữ nhân viên, tab đang chọn (keep = false mới về mặc định)
			return openBatch(id, keep !== false).then(() => setNotice([message ? message(r) : t.done].concat(warn).join(' · ')));
		});
	};

	// Tiêu đề, tab điều hướng, ô chọn công ty con và cảnh báo tham số chưa đối chiếu do khung vẽ
	const items = [];
	if (!boot) {
		items.push(item(actionRow([], [{text: error || busy || t.loading, strong: !!error}]), 'boot'));
		return (
			<StackPanel orientation={StackPanel.Orientation.VERTICAL} itemGap={StackPanel.GapSize.M} outerGap={StackPanel.GapSize.L}>
				{items}
			</StackPanel>
		);
	}

	items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{t.views[view] || ''}</Heading>, 'view-title'));
	// Kỳ của công ty con đang chọn, giảm dần; nhiều nhóm lương thì nhãn có tiền tố mã nhóm (Dropdown UIF không có nhóm)
	const periodItems = [{value: '', label: t.allPeriods}].concat(periodOptions(boot, subsidiary, {lock: 'status', prefixGroup: true}));
	if (view === 'batches' && !batch) {
		const filters = [
			cell(labeled(t.period, <Dropdown size={Dropdown.Size.L} rootStyle={{width: '100%'}} tooltip={periodTip(periodItems, period)} dataSource={new ArrayDataSource(periodItems)} valueMember="value" displayMember="label" selectedValue={period} onSelectionChanged={(a) => a.value !== undefined && a.value !== period && setPeriod(a.value)} />), 'f-period'),
			cell(labeled(t.newBatchDesc, <TextBox rootStyle={{width: '100%'}} text={description} onTextChanged={(a) => setDescription(String(a.text || ''))} />), 'f-desc'),
		];
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{filters}
				</GridPanel>,
				'filters'
			)
		);
	}

	const messages = [];
	if (error) messages.push({text: error, strong: true});
	if (busy) messages.push({text: busy});
	if (notice) messages.push({text: notice});
	if (!boot.setupReady) messages.push({text: t.notReady, strong: true});
	if (view === 'setup' && boot.unverified && boot.unverified.length) messages.push({text: t.unverified(boot.unverified.join('; ')), strong: true});

	// Hộp xác nhận cho thao tác ghi sổ, đảo, lập bill
	if (confirm) {
		items.push(
			item(
				actionRow(
					[
						<Button label={t.yes} hierarchy={Button.Hierarchy.PRIMARY} action={() => {
							const c = confirm;
							setConfirm(null);
							c.go();
						}} />,
						<Button label={t.cancel} action={() => setConfirm(null)} />,
					],
					[{text: confirm.text, strong: true}]
				),
				'confirm'
			)
		);
	}

	if (view === 'batches' && !batch) renderBatchList();
	else if (view === 'batches' && batch) renderBatch();
	else if (view === 'profiles') renderProfiles();
	else if (view === 'advances') renderAdvances();
	else if (view === 'attendance') renderAttendance();
	else if (view === 'reports') renderReports();
	else if (view === 'outputs') renderOutputs();
	else if (view === 'permits') renderPermits();
	else renderSetup();

	return (
		<StackPanel orientation={StackPanel.Orientation.VERTICAL} itemGap={StackPanel.GapSize.M} outerGap={StackPanel.GapSize.L} rootStyle={{paddingRight: '64px'}}>
			{items}
		</StackPanel>
	);

	// ------------------------------------------------------------------ danh sách bảng lương
	function renderBatchList() {
		items.push(
			item(
				actionRow(
					[
						<Button label={t.load} hierarchy={Button.Hierarchy.PRIMARY} enabled={!busy && !!subsidiary} action={() => loadBatches()} />,
						<Button label={t.newBatch} enabled={!busy && !!subsidiary && !!period && boot.setupReady} action={() =>
							run(t.working, post({action: 'createBatch', subsidiary, period, description}), (r) => openBatch(r.id))
						} />,
					],
					period ? messages : messages.concat([{text: t.pickPeriod}])
				),
				'actions'
			)
		);
		const rows = batches.map((b) => Object.assign({}, b, {statusText: t.status[b.status] || b.status}));
		const filtered = quickFilter(rows, quick);
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(filtered.rows)}
					columns={fitCols([
						{name: 'name', label: t.cols.number, width: 110, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.name} type={Button.Type.LINK} action={() => openBatch(r.id)} />)},
						textCol('periodName', t.cols.period, 100, (r) => r.periodName),
						textCol('statusText', t.cols.status, 120, (r) => r.statusText),
						textCol('description', t.description, 220, (r) => r.description || ''),
						textCol('emp_count', t.cols.count, 80, (r) => r.emp_count || 0),
						moneyCol('gross', t.cols.gross, 140),
						moneyCol('ee_ins', t.cols.eeIns),
						moneyCol('er_ins', t.cols.erIns),
						moneyCol('pit', t.cols.pit),
						moneyCol('net', t.cols.net, 140),
						{name: 'journal', label: t.cols.journal, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (r.journal ? <Button label={r.journalNo || `JE ${r.journal}`} type={Button.Type.LINK} action={() => openJournal(r.journal)} /> : plain('')))},
					])}
					columnStretch={true}
					highlightRowsOnHover={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', flexShrink: 0, height: autoH(filtered.rows.length, 520)}}
				/>,
				'grid-batches'
			)
		);
	}

	function quickBox(count, placeholder) {
		return (
			<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.M} alignment={StackPanel.Alignment.CENTER}>
				<StackPanel.Item key="q">
					<TextBox rootStyle={{width: '360px'}} text={quick} placeholder={placeholder || t.quick} onTextChanged={(a) => setQuick(String(a.text || ''))} />
				</StackPanel.Item>
				<StackPanel.Item key="c">
					<Text size={Text.Size.S} type={Text.Type.WEAK}>
						{count === null ? '' : t.quickCount(count)}
					</Text>
				</StackPanel.Item>
			</StackPanel>
		);
	}

	// ------------------------------------------------------------------ một bảng lương
	function renderBatch() {
		const b = batch.batch;
		const s = b.status;
		const isHr = boot.user.isHr;
		const printUrl = (doc) => url.resolveScript(Object.assign({}, PRINT, {params: {batch: b.id, doc, lang: serverLanguage()}}));
		const buttons = [<Button label={t.back} type={Button.Type.GHOST} action={() => (setBatch(null), loadBatches())} />, <Button label={t.actions.refresh} action={refresh} />];
		const add = (cond, label, fn, primary) => cond && buttons.push(<Button label={label} hierarchy={primary ? Button.Hierarchy.PRIMARY : Button.Hierarchy.SECONDARY} enabled={!busy} action={fn} />);
		const editable = ['H', 'B', 'C'].includes(s);
		add(editable, t.actions.loadEmployees, () => act('loadEmployees', null, t.loaded, true));
		add(editable, t.time.load, () => act('syncTime', null, t.timeSynced, true));
		add(editable, t.actions.calculate, () => act('calculate', null, t.calcDone), s === 'B');
		add(s === 'H', t.actions.removeHold, () => act('removeHold'));
		add(['B', 'C'].includes(s), t.actions.hold, () => act('hold'));
		add(['C', 'P'].includes(s) && b.calculated, t.actions.approve, () => act('approve'), s === 'C');
		add(['C', 'P'].includes(s), t.actions.reject, () => act('reject'));
		add(['A', 'J', 'P', 'C', 'B'].includes(s), t.actions.reopen, () => act('reopen'));
		add(!isHr && (s === 'A' || s === 'C') && b.calculated, t.actions.release, () => setConfirm({text: t.confirm.release, go: () => act('release', null, (r) => t.jeCreated(r.journal))}), s === 'A');
		add(!isHr && s === 'R', t.actions.reverse, () => setConfirm({text: t.confirm.reverse, go: () => act('reverse', null, (r) => t.jeCreated(r.journal))}));
		// Hoàn tất khi lần trước dừng giữa chừng (sau khi tạo JE / bill): máy chủ chỉ làm phần còn thiếu
		add(!isHr && s === 'R', t.actions.completeRelease, () => act('release', null, (r) => (r.resumed ? t.resumed : t.jeCreated(r.journal))));
		add(!isHr && s === 'V', t.actions.completeReverse, () => act('reverse', null, (r) => (r.resumed ? t.resumed : t.jeCreated(r.journal))));
		add(boot.user.role === 'administrator' && !!b.job, t.actions.clearJob, () => act('clearJob'));
		add(!isHr && s === 'R', t.actions.agencyBills, () => setConfirm({text: t.confirm.agencyBills, go: () => act('agencyBills', null, t.billsCreated)}));
		add(['A', 'R'].includes(s), t.actions.bankFile, () => run(t.working, call({action: 'bankfile', id: b.id}), (r) => download(r.fileName, r.content)));
		add(b.calculated, t.actions.journal, () => run(t.loading, call({action: 'journal', id: b.id}), (r) => (setJournal(r), setTab('journal'))));
		add(b.calculated, t.actions.payslips, () => window.open(printUrl('payslip'), '_blank'));
		add(b.calculated, t.actions.paymentSheet, () => window.open(printUrl('payment'), '_blank'));
		add(b.calculated && b.ctr_net, t.actions.contractor, () => window.open(printUrl('contractor'), '_blank'));
		add(true, t.openRecord, () => openRecord(boot.recordTypes.batch, b.id));
		items.push(
			item(
				<Heading type={Heading.Type.SMALL_HEADING}>{`${b.name} · ${b.periodName} (${fmtDate(b.periodStart)} - ${fmtDate(b.periodEnd)}) · ${t.status[s] || s}${b.description ? ` · ${b.description}` : ''}`}</Heading>,
				'b-title'
			)
		);
		const extra = [{text: t.totals(b)}];
		const tx = batch.transactions || {};
		const txText = (id) => {
			const x = tx[id] || {};
			const state = x.voided ? t.txVoided : x.posting ? t.txPosted : t.txPending;
			return `${x.tranid || id} (${state})`;
		};
		if (b.journal) extra.push({text: `${t.cols.journal}: ${txText(b.journal)}${b.reversal ? ` / ${t.reversalLabel} ${txText(b.reversal)}` : ''}`});
		const bills = Array.isArray(b.bills) ? b.bills : [];
		if (bills.length) extra.push({text: t.billsSummary(bills.length, bills.every((x) => (tx[x.id] || {}).posting))});
		if (b.messages) extra.push({text: b.messages.split('\n').slice(0, 3).join('; '), strong: true});
		items.push(item(actionRow(buttons, messages), 'b-actions'));
		items.push(item(<Text size={Text.Size.S} rootStyle={{whiteSpace: 'normal'}}>{extra.map((m) => m.text).join('  ·  ')}</Text>, 'b-totals'));

		// Lưới cha: mỗi nhân viên một dòng; bấm mã nhân viên để xem các tab chi tiết bên dưới (như VP302000)
		const current = batch.lines.find((l) => l.id === selected) || batch.lines[0] || null;
		const rows = batch.lines.map((l) => Object.assign({}, l, {note: [l.error, l.warnings].filter(Boolean).join(' | ')}));
		const filtered = quickFilter(rows, quick);
		const sumKeys = ['gross', 'exempt', 'ee_ins', 'er_ins', 'family_ded', 'assessable', 'pit', 'other_ded', 'net_before', 'advance', 'net'];
		const total = filtered.rows.length > 1 ? sumRow(filtered.rows, sumKeys, {code: '', name: '∑', bold: true}) : null;
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{t.employeesTitle(batch.lines.length)}</Heading>, 'e-title'));
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(total ? filtered.rows.concat([total]) : filtered.rows)}
					columns={fitCols([
						{name: 'code', label: t.cols.code, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (r.id ? <Button label={`${current && r.id === current.id ? '▸ ' : ''}${r.code || r.employee}`} type={Button.Type.LINK} action={() => setSelected(r.id)} /> : plain('')))},
						textCol('name', t.cols.name, 190, (r) => r.name),
						textCol('employment_type', t.cols.employment, 60, (r) => r.employment_type || ''),
						numCol('std_days', t.cols.std, 70, (r) => num(r.std_days)),
						numCol('work_days', t.cols.work, 70, (r) => num(r.work_days)),
						moneyCol('gross', t.cols.gross, 120),
						moneyCol('exempt', t.cols.exempt, 105),
						moneyCol('ee_ins', t.cols.eeIns, 100),
						moneyCol('er_ins', t.cols.erInsShort, 100),
						numCol('dependents', t.cols.deps, 50, (r) => (r.id ? r.dependents || 0 : '')),
						moneyCol('family_ded', t.cols.family, 110),
						moneyCol('assessable', t.cols.assessable, 110),
						moneyCol('pit', t.cols.pit, 100),
						moneyCol('other_ded', t.cols.otherDed, 100),
						moneyCol('net_before', t.cols.netBefore, 120),
						moneyCol('advance', t.cols.advance, 100),
						moneyCol('net', t.cols.net, 120),
						textCol('note', t.cols.warn, 240, (r) => r.note || ''),
					])}
					columnStretch={true}
					highlightRowsOnHover={true}
					placeholder={t.empty}
					on={{[DataGrid.Event.CURSOR_UPDATED]: pickLine}}
					rootStyle={{width: '100%', flexShrink: 0, height: autoH(filtered.rows.length + 1, 400)}}
				/>,
				'grid-lines'
			)
		);
		renderDetailTabs(current, editable, bills, txText);
	}

	// Bấm ô bất kỳ trên dòng nhân viên (con trỏ lưới đổi dòng) thì các tab bên dưới chuyển sang nhân viên đó
	// UIF gọi (args, sender): sender là lưới, con trỏ của lưới cho dòng vừa bấm
	function pickLine(args, grid) {
		try {
			const row = (grid && grid.cursor && grid.cursor.row) || (args && (args.row || (args.cell && args.cell.row))) || null;
			const r = row && row.dataItem;
			if (r && r.id) setSelected(r.id);
		} catch (err) {
			// bỏ qua: vẫn chọn được bằng mã nhân viên
		}
	}

	function sumRow(list, keys, base) {
		return list.reduce((acc, r) => {
			keys.forEach((k) => (acc[k] = (acc[k] || 0) + (Number(r[k]) || 0)));
			return acc;
		}, Object.assign({}, base));
	}

	// Các tab con: sáu tab của nhân viên đang chọn, hai tab của cả bảng lương
	function renderDetailTabs(line, editable, bills, txText) {
		const lineTabs = ['earn', 'ded', 'ins', 'att', 'time', 'alloc', 'adv'];
		const strip = [];
		const tabButton = (k) => <Button label={t.tabs[k]} hierarchy={tab === k ? Button.Hierarchy.PRIMARY : Button.Hierarchy.SECONDARY} type={tab === k ? Button.Type.PRIMARY : Button.Type.GHOST} action={() => pickTab(k)} />;
		lineTabs.forEach((k) => strip.push(tabButton(k)));
		strip.push(<Text type={Text.Type.WEAK}>{t.batchTabs}</Text>);
		['journal', 'bills'].forEach((k) => strip.push(tabButton(k)));
		const isLineTab = lineTabs.includes(tab);
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{isLineTab ? (line ? t.detailOf(line.code, line.name) : t.noLine) : t.batchDetail}</Heading>, 'd-title'));
		items.push(item(actionRow(strip), 'd-tabs'));
		if (tab === 'journal') return renderJournalTab();
		if (tab === 'bills') return renderBills(bills, txText);
		if (!line) return;
		if (tab === 'earn') renderEarnings(line, editable);
		else if (tab === 'ded') renderDeductions(line, editable);
		else if (tab === 'ins') renderInsurance(line);
		else if (tab === 'att') renderLineAttendance(line);
		else if (tab === 'time') renderTime(line, editable);
		else if (tab === 'alloc') renderAllocations(line);
		else renderOffsets(line);
	}

	function pickTab(k) {
		setTab(k);
		if (k === 'journal' && !journal && batch.batch.calculated) run(t.loading, call({action: 'journal', id: batch.batch.id}), (r) => setJournal(r));
	}

	function detailGrid(rows, columns, key, height) {
		return item(
			<DataGrid
				dataSource={new ArrayDataSource(rows)}
				columns={fitCols(columns)}
				columnStretch={true}
				placeholder={t.empty}
				rootStyle={{width: '100%', flexShrink: 0, height: height || '260px'}}
			/>,
			key
		);
	}

	function myInputs(line, kind) {
		return (batch.inputs || []).filter((i) => i.employee === line.employee && i.kind === kind);
	}

	function delCol(editable) {
		return {name: 'del', label: '', width: 60, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (editable && r.inputId ? <Button label={t.delete} type={Button.Type.LINK} action={() => act('deleteInput', {id: r.inputId}, null, true)} /> : plain('')))};
	}

	function inputAmount(i) {
		const blankV = (v) => v === null || v === undefined || v === '';
		return !blankV(i.amount) ? Number(i.amount) : (Number(i.qty) || 0) * (Number(i.rate) || 0) * (blankV(i.multiplier) ? 1 : Number(i.multiplier));
	}

	// Thu nhập: dòng hệ thống sinh và dòng nhập tay chung một lưới, cột Nguồn phân biệt (như tab Thu nhập của VP302000)
	function renderEarnings(line, editable) {
		const ets = boot.earningTypes || [];
		const etOf = (id) => ets.find((e) => e.id === id) || {};
		const calc = (line.earnings || []).filter((x) => x.source !== 'M');
		const manualCalc = (line.earnings || []).filter((x) => x.source === 'M');
		const inputs = myInputs(line, 'E');
		const rows = calc.map((x) => ({type: x.earningType, memo: x.name || '', quantity: x.quantity, rate: x.rate, multiplier: x.multiplier, amount: x.amount, exempt: x.taxExemptAmount, src: `${t.src[x.source] || x.source || ''}${x.ruleCode ? ` · ${x.ruleCode}` : ''}`, project: x.project || ''}));
		inputs.forEach((i, n) => {
			// Dòng nhập tay sau khi tính có phần miễn thuế; khớp theo thứ tự nạp vào bộ tính
			const m = manualCalc.length === inputs.length ? manualCalc[n] : null;
			rows.push({inputId: i.id, type: etOf(i.earning_type).code || '', memo: i.description || etOf(i.earning_type).name || '', quantity: i.qty, rate: i.rate, multiplier: i.multiplier, amount: m ? m.amount : inputAmount(i), exempt: m ? m.taxExemptAmount : null, src: t.src.M, project: ''});
		});
		if (rows.length > 1) rows.push(sumRow(rows, ['amount', 'exempt'], {type: '∑', bold: true}));
		items.push(
			detailGrid(rows, [
				textCol('type', t.cols.earningType, 110, (r) => r.type),
				textCol('memo', t.cols.memo, 220, (r) => r.memo),
				numCol('quantity', t.cols.qty, 80, (r) => num(r.quantity)),
				numCol('rate', t.cols.rate, 110, (r) => num(r.rate)),
				numCol('multiplier', t.cols.mult, 60, (r) => num(r.multiplier)),
				moneyCol('amount', t.cols.amount, 120),
				moneyCol('exempt', t.cols.exemptAmt, 110),
				textCol('src', t.cols.source, 140, (r) => r.src),
				textCol('project', t.cols.project, 100, (r) => r.project),
				delCol(editable),
			], 'd-earn')
		);
		if (!editable) return;
		const etItems = ets.map((e) => ({value: e.id, label: `${e.code} ${e.name}`}));
		inputForm(line, 'E', [
			cell(labeled(t.earningType, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(etItems)} valueMember="value" displayMember="label" selectedValue={input.earning_type} onSelectionChanged={(a) => a.value && a.value !== input.earning_type && setField('earning_type')(a)} />), `in-et-${input.rev || 0}`),
			cell(labeled(t.cols.memo, <TextBox rootStyle={{width: '100%'}} text={input.description} onTextChanged={setField('description')} />), 'in-desc'),
			cell(labeled(t.cols.qty, <TextBox rootStyle={{width: '100%'}} text={input.qty} onTextChanged={setField('qty')} />), 'in-qty'),
			cell(labeled(t.cols.rate, <TextBox rootStyle={{width: '100%'}} text={input.rate} onTextChanged={setField('rate')} />), 'in-rate'),
			cell(labeled(t.cols.mult, <TextBox rootStyle={{width: '100%'}} text={input.multiplier} placeholder="1" onTextChanged={setField('multiplier')} />), 'in-mult'),
		]);
	}

	// Khấu trừ khác (sau thuế): chỉ có dòng nhập tay
	function renderDeductions(line, editable) {
		const rows = myInputs(line, 'D').map((i) => ({inputId: i.id, code: i.code || '', memo: i.description || '', amount: i.amount}));
		if (rows.length > 1) rows.push(sumRow(rows, ['amount'], {code: '∑', bold: true}));
		items.push(
			detailGrid(rows, [
				textCol('code', t.deductionCode, 120, (r) => r.code),
				textCol('memo', t.cols.memo, 320, (r) => r.memo),
				moneyCol('amount', t.cols.amount, 130),
				delCol(editable),
			], 'd-ded', '200px')
		);
		if (!editable) return;
		inputForm(line, 'D', [
			cell(labeled(t.deductionCode, <TextBox rootStyle={{width: '100%'}} text={input.code} placeholder="KHAC" onTextChanged={setField('code')} />), 'in-code'),
			cell(labeled(t.cols.memo, <TextBox rootStyle={{width: '100%'}} text={input.description} onTextChanged={setField('description')} />), 'in-desc'),
			cell(labeled(t.cols.amount, <TextBox rootStyle={{width: '100%'}} text={input.amount} onTextChanged={setField('amount')} />), 'in-amt'),
		]);
	}

	// Form thêm dòng nhập tay cho đúng nhân viên đang chọn; giá trị giữ trong ref để hai ô cập nhật liền nhau không ghi đè nhau
	function setField(k) {
		return (a) => {
			inputRef.current = Object.assign({}, inputRef.current, {[k]: a.value !== undefined ? a.value : String(a.text || '')});
			setInput(inputRef.current);
		};
	}

	function inputForm(line, kind, fields) {
		items.push(item(<Text size={Text.Size.S} type={Text.Type.WEAK}>{t.inputHint[kind]}</Text>, `i-hint-${kind}`));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(180px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{fields}
				</GridPanel>,
				`i-form-${kind}`
			)
		);
		const numOrNull = (v) => (String(v === undefined || v === null ? '' : v).trim() === '' ? null : Number(String(v).replace(/\./g, '').replace(',', '.')));
		const ready = kind === 'D' || !!input.earning_type;
		items.push(
			item(
				actionRow([
					<Button label={t.addInput} hierarchy={Button.Hierarchy.PRIMARY} enabled={!busy && ready} action={() => {
						const v = inputRef.current;
						const values = {batch: batch.batch.id, employee: line.employee, kind, earning_type: kind === 'E' ? v.earning_type : null, code: kind === 'D' ? v.code || 'KHAC' : '', description: v.description,
							qty: kind === 'E' ? numOrNull(v.qty) : null, rate: kind === 'E' ? numOrNull(v.rate) : null, multiplier: kind === 'E' ? numOrNull(v.multiplier) : null, amount: kind === 'D' ? numOrNull(v.amount) : null};
						// Chỉ xóa form khi lưu được; rev đổi khóa ô chọn để Dropdown dựng lại ở trạng thái trống
						return act('saveInput', {values}, null, true).then((r) => {
							if (!r) return;
							inputRef.current = Object.assign({}, EMPTY_INPUT, {rev: (v.rev || 0) + 1});
							setInput(inputRef.current);
						});
					}} />,
				]),
				`i-add-${kind}`
			)
		);
	}

	function renderInsurance(line) {
		const rows = (line.insurance || []).slice();
		if (rows.length > 1) rows.push(sumRow(rows, ['employeeAmount', 'employerAmount'], {code: '∑', bold: true}));
		items.push(
			detailGrid(rows, [
				textCol('code', t.cols.component, 110, (r) => r.code),
				moneyCol('wageBase', t.cols.base, 130),
				textCol('employeeRate', t.cols.eeRate, 80, (r) => pct(r.employeeRate)),
				moneyCol('employeeAmount', t.cols.eeIns, 120),
				textCol('employerRate', t.cols.erRate, 80, (r) => pct(r.employerRate)),
				moneyCol('employerAmount', t.cols.erIns, 120),
			], 'd-ins')
		);
	}

	// Công: số liệu công của dòng (từ bảng tổng hợp công nếu đã lập, ngược lại công chuẩn trừ ngày ngoài hợp đồng)
	function renderLineAttendance(line) {
		const rows = [
			['std_days', num(line.std_days)], ['work_days', num(line.work_days)], ['paid_leave', num(line.paid_leave)], ['unpaid_leave', num(line.unpaid_leave)],
			['si_leave', num(line.si_leave)], ['absence_days', num(line.absence_days)], ['ot_hours', num(line.ot_hours)], ['att_locked', t.rep.yesNo[line.att_locked ? 'T' : 'F']],
		].map(([k, v]) => ({label: t.attCols[k], value: v}));
		items.push(detailGrid(rows, [textCol('label', t.rep.item, 260, (r) => r.label), textCol('value', t.rep.value, 140, (r) => r.value)], 'd-att', '300px'));
	}

	// Giờ công (VP312000): dòng gộp theo dự án / công việc, sửa giờ có lý do; bên dưới là timesheet từng ngày đọc từ Time
	function renderTime(line, editable) {
		const tt = t.time;
		const mine = (batch.time || []).filter((x) => x.employee === line.employee);
		const rows = mine.map((x) => Object.assign({}, x, {projectText: x.project_name || x.project || tt.none, taskText: x.task_name || x.task || ''}));
		if (rows.length > 1) rows.push(sumRow(rows, ['source_hours', 'hours'], {projectText: '∑', bold: true}));
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{tt.title}</Heading>, 't-title'));
		items.push(item(<Text size={Text.Size.S} type={Text.Type.WEAK} rootStyle={{whiteSpace: 'normal'}}>{tt.hint}</Text>, 't-hint'));
		items.push(
			detailGrid(rows, [
				textCol('projectText', tt.project, 240, (r) => r.projectText),
				textCol('taskText', tt.task, 180, (r) => r.taskText),
				numCol('entries', tt.entries, 80, (r) => (r.id ? num(r.entries) : '')),
				numCol('source_hours', tt.sourceHours, 110, (r) => num(r.source_hours)),
				numCol('hours', tt.hours, 110, (r) => num(r.hours)),
				textCol('reason', tt.reason, 220, (r) => r.reason || ''),
				{name: 'edit', label: '', width: 90, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (editable && r.id ? <Button label={tt.edit} type={Button.Type.LINK} action={() => {
					timeRef.current = {id: r.id, hours: String(r.hours === null || r.hours === undefined ? '' : r.hours), reason: r.reason || '', label: `${r.projectText}${r.taskText ? ` / ${r.taskText}` : ''}`};
					setTimeEdit(timeRef.current);
				}} /> : plain('')))},
			], 't-grid', autoH(rows.length, 300))
		);
		if (editable && timeEdit && mine.some((x) => x.id === timeEdit.id)) {
			const setT = (k) => (a) => {
				timeRef.current = Object.assign({}, timeRef.current, {[k]: String(a.text || '')});
				setTimeEdit(timeRef.current);
			};
			items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{tt.editTitle(timeEdit.label)}</Heading>, 't-edit-title'));
			items.push(
				item(
					<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(200px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
						{[
							cell(labeled(tt.hours, <TextBox rootStyle={{width: '100%'}} text={timeEdit.hours} onTextChanged={setT('hours')} />), 't-e-h'),
							cell(labeled(tt.reason, <TextBox rootStyle={{width: '100%'}} text={timeEdit.reason} onTextChanged={setT('reason')} />), 't-e-r'),
						]}
					</GridPanel>,
					't-edit-form'
				)
			);
			items.push(
				item(
					actionRow([
						<Button label={tt.save} hierarchy={Button.Hierarchy.PRIMARY} enabled={!busy} action={() => {
							const v = timeRef.current;
							return act('saveTime', {lineId: v.id, values: {hours: String(v.hours).replace(',', '.'), reason: v.reason}}, null, true).then((r) => r && setTimeEdit(null));
						}} />,
						<Button label={tt.cancel} type={Button.Type.GHOST} action={() => setTimeEdit(null)} />,
					]),
					't-edit-actions'
				)
			);
		}
		// Timesheet từng ngày: tải một lần cho mỗi nhân viên đang chọn (tsReq chặn gọi lặp khi vẽ lại)
		const key = `${batch.batch.id}|${line.employee}`;
		if (tsReq.current !== key) {
			tsReq.current = key;
			call({action: 'timesheet', id: batch.batch.id, employee: line.employee}).then((r) => alive.current && setTsheet(Object.assign({key}, r))).catch((e) => alive.current && setTsheet({key, error: e.message, entries: []}));
		}
		if (!tsheet || tsheet.key !== key) return items.push(item(<Text type={Text.Type.WEAK}>{tt.loadingSheet}</Text>, 't-sheet-wait'));
		if (tsheet.error) return items.push(item(<Text type={Text.Type.WEAK}>{`${t.failed}: ${tsheet.error}`}</Text>, 't-sheet-err'));
		const usesApproval = tsheet.entries.some((e) => e.approval !== 'N');
		const counted = (e) => !usesApproval || (tsheet.requireApproval ? e.approval === 'A' : e.approval !== 'R');
		const days = tsheet.entries.map((e) => Object.assign({}, e, {dateText: fmtDate(e.date), projectText: e.projectName || tt.none, countedText: counted(e) ? t.rep.yesNo.T : t.rep.yesNo.F}));
		if (days.length > 1) days.push(sumRow(days, ['hours'], {dateText: '∑', bold: true}));
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{tt.detail(fmtDate(tsheet.from), fmtDate(tsheet.to))}</Heading>, 't-sheet-title'));
		items.push(
			detailGrid(days, [
				textCol('dateText', tt.date, 100, (r) => r.dateText),
				numCol('hours', tt.hours, 90, (r) => num(r.hours)),
				textCol('projectText', tt.project, 220, (r) => (r.bold ? '' : r.projectText)),
				textCol('taskName', tt.task, 160, (r) => r.taskName || ''),
				textCol('approval', tt.status, 140, (r) => (r.bold ? '' : tt.approval[r.approval] || r.statusName || '')),
				textCol('countedText', tt.counted, 90, (r) => (r.bold ? '' : r.countedText)),
				textCol('memo', tt.memo, 220, (r) => r.memo || ''),
			], 't-sheet', autoH(days.length, 420))
		);
	}

	function renderAllocations(line) {
		const rows = (line.allocations || []).slice();
		if (rows.length > 1) rows.push(sumRow(rows, ['amount'], {component: '∑', bold: true}));
		items.push(
			detailGrid(rows, [
				textCol('component', t.cols.component, 100, (r) => r.component),
				textCol('project', t.cols.project, 120, (r) => r.project || ''),
				textCol('task', t.cols.task, 100, (r) => r.task || ''),
				textCol('branch', t.cols.branch, 100, (r) => r.branch || ''),
				textCol('workCenter', t.cols.workCenter, 100, (r) => r.workCenter || ''),
				textCol('source', t.cols.source, 110, (r) => (r.source ? t.allocSrc[r.source] || r.source : '')),
				numCol('hours', t.cols.hours, 70, (r) => num(r.hours)),
				textCol('ratio', t.cols.ratio, 80, (r) => pct(r.ratio)),
				moneyCol('amount', t.cols.amount, 120),
			], 'd-alloc')
		);
	}

	function renderOffsets(line) {
		const rows = (line.advanceOffsets || []).slice();
		if (rows.length > 1) rows.push(sumRow(rows, ['amount'], {refNbr: '∑', bold: true}));
		items.push(
			detailGrid(rows, [
				textCol('refNbr', t.cols.advanceNbr, 140, (r) => r.refNbr),
				moneyCol('amount', t.cols.offset, 130),
				moneyCol('remainingBalance', t.cols.balanceAfter, 130),
			], 'd-adv', '200px')
		);
	}

	function renderBills(bills, txText) {
		const rows = bills.map((x) => ({id: x.id, doc: txText(x.id), memo: x.memo || '', amount: x.amount}));
		items.push(
			detailGrid(rows, [
				{name: 'doc', label: t.cols.document, width: 220, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.doc} type={Button.Type.LINK} action={() => window.open(`/app/accounting/transactions/vendbill.nl?id=${encodeURIComponent(r.id)}`, '_blank')} />)},
				textCol('memo', t.cols.memo, 360, (r) => r.memo),
				moneyCol('amount', t.cols.amount, 140),
			], 'd-bills', '220px')
		);
	}

	function renderJournalTab() {
		if (!batch.batch.calculated) return items.push(item(<Text type={Text.Type.WEAK}>{t.journalNotReady}</Text>, 'j-none'));
		if (!journal) return items.push(item(actionRow([<Button label={t.actions.journal} enabled={!busy} action={() => pickTab('journal')} />]), 'j-wait'));
		renderJournal();
	}

	function renderJournal() {
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{`${batch.batch.journal ? t.journalTitleReleased : t.journalTitle}: ${journal.memo}`}</Heading>, 'j-title'));
		const sum = journal.lines.reduce((a, l) => ({debit: a.debit + Number(l.debit || 0), credit: a.credit + Number(l.credit || 0)}), {debit: 0, credit: 0});
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(journal.lines.concat([{account: '', memo: '∑', debit: sum.debit, credit: sum.credit, bold: true}]))}
					columns={fitCols([
						textCol('account', t.cols.account, 100, (r) => r.accountNumber || r.account),
						textCol('memo', t.cols.memo, 320, (r) => r.memo),
						moneyCol('debit', t.cols.debit, 140),
						moneyCol('credit', t.cols.credit, 140),
						textCol('sub', t.cols.dimension, 160, (r) => [r.sub, r.branch, r.workCenter, r.project].filter(Boolean).join(' / ')),
					])}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', flexShrink: 0, height: autoH(journal.lines.length + 1, 560)}}
				/>,
				'j-grid'
			)
		);
	}

	// ------------------------------------------------------------------ hồ sơ lương
	function renderProfiles() {
		items.push(
			item(
				actionRow(
					[
						<Button label={t.actions.refresh} action={() => run(t.loading, call({action: 'profiles', subsidiary}), (r) => setProfiles(r.employees))} />,
						<Button label={t.newProfile} action={() => window.open(url.resolveRecord({recordType: boot.recordTypes.employee, isEditMode: true}), '_blank')} />,
					],
					messages
				),
				'p-actions'
			)
		);
		const rows = profiles.map((e) => Object.assign({}, e, {
			salary: e.compensation ? e.compensation.base_salary : null,
			insWage: e.compensation ? e.compensation.insurance_wage : null,
			effective: e.compensation ? e.compensation.effective : '',
			employment: e.profile ? e.profile.employment_type : '',
			pit: e.profile ? e.profile.pit_method : '',
		}));
		const filtered = quickFilter(rows, quick);
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(filtered.rows)}
					columns={fitCols([
						textCol('code', t.cols.code, 100, (r) => r.code),
						textCol('name', t.cols.name, 220, (r) => r.name),
						textCol('department', t.cols.dept, 140, (r) => r.department),
						textCol('employment', t.cols.employment, 120, (r) => t.empType[r.employment] || r.employment || ''),
						textCol('pit', t.cols.pitMethod, 120, (r) => t.pitMethods[r.pit] || r.pit || ''),
						moneyCol('salary', t.cols.salary, 130),
						moneyCol('insWage', t.cols.insWage, 130),
						textCol('effective', t.cols.effective, 100, (r) => fmtDate(r.effective)),
						numCol('dependents', t.cols.deps, 60, (r) => r.dependents || 0),
						{name: 'profile', label: t.cols.profile, width: 130, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (r.profile ? <Button label={t.openRecord} type={Button.Type.LINK} action={() => openRecord(boot.recordTypes.employee, r.profile.id)} /> : plain(t.noProfile)))},
					])}
					columnStretch={true}
					highlightRowsOnHover={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', flexShrink: 0, height: autoH(filtered.rows.length, 520)}}
				/>,
				'p-grid'
			)
		);
	}

	// ------------------------------------------------------------------ tạm ứng
	function renderAdvances() {
		const ta = t.adv;
		const reload = () => run(t.loading, call({action: 'advances', subsidiary}), (r) => setAdvances(r.advances));
		items.push(item(actionRow([<Button label={t.actions.refresh} action={reload} />], messages), 'a-actions'));
		const advOp = (r, action) => run(t.working, post({action, id: r.id}), reload);
		const opsFor = (r) => (r.status === 'H' ? [['removeHoldAdvance', ta.removeHold]] : r.status === 'B' ? [['releaseAdvance', ta.release]] : []);
		const rows = advances.map((a) => Object.assign({}, a, {statusText: t.advStatus[a.status] || a.status, empText: `${a.employeeCode || ''} ${a.employeeName || ''}`.trim() || a.employee}));
		const filtered = quickFilter(rows, quick);
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(filtered.rows)}
					columns={fitCols([
						{name: 'name', label: t.cols.number, width: 110, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.name} type={Button.Type.LINK} action={() => openRecord('customrecord_s4vp_advance', r.id)} />)},
						textCol('doc_date', t.cols.docDate, 100, (r) => fmtDate(r.doc_date)),
						textCol('empText', t.employee, 200, (r) => r.empText),
						textCol('statusText', t.cols.status, 130, (r) => r.statusText),
						moneyCol('amount', t.cols.amount, 130),
						moneyCol('offset', t.cols.offset, 130),
						moneyCol('balance', t.cols.balance, 130),
						textCol('memo', t.cols.memo, 250, (r) => r.memo || ''),
						{name: 'journal', label: t.cols.journal, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (r.journal ? <Button label={r.journalNo || `JE ${r.journal}`} type={Button.Type.LINK} action={() => openJournal(r.journal)} /> : plain('')))},
						{name: 'ops', label: '', width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (
							<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.S}>
								{opsFor(r).map(([a, label]) => <StackPanel.Item key={a}><Button label={label} type={Button.Type.LINK} action={() => (a === 'releaseAdvance' ? setConfirm({text: ta.confirmRelease, go: () => advOp(r, a)}) : advOp(r, a))} /></StackPanel.Item>).concat([<StackPanel.Item key="none">{plain('')}</StackPanel.Item>])}
							</StackPanel>
						))},
					])}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', flexShrink: 0, height: autoH(filtered.rows.length, 360)}}
				/>,
				'a-grid'
			)
		);
		// Lập phiếu tạm ứng mới (VP301000): tạo ở trạng thái tạm giữ
		const setAdv = (k) => (a) => {
			advRef.current = Object.assign({}, advRef.current, {[k]: a.value !== undefined ? a.value : String(a.text || '')});
			setAdvForm(advRef.current);
		};
		const empItems = employees.map((e) => ({value: e.employee, label: `${e.code} ${e.name}`}));
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{ta.newTitle}</Heading>, 'a-new-title'));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(200px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{[
						cell(labeled(t.employee, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(empItems)} valueMember="value" displayMember="label" selectedValue={advForm.employee} onSelectionChanged={(a) => a.value && a.value !== advForm.employee && setAdv('employee')(a)} />), 'n-emp'),
						cell(labeled(ta.date, <TextBox rootStyle={{width: '100%'}} text={advForm.date} placeholder={fmtDate(localToday())} onTextChanged={setAdv('date')} />), 'n-date'),
						cell(labeled(t.cols.amount, <TextBox rootStyle={{width: '100%'}} text={advForm.amount} onTextChanged={setAdv('amount')} />), 'n-amt'),
						cell(labeled(t.cols.memo, <TextBox rootStyle={{width: '100%'}} text={advForm.memo} onTextChanged={setAdv('memo')} />), 'n-memo'),
					]}
				</GridPanel>,
				'a-new-form'
			)
		);
		items.push(
			item(
				actionRow([
					<Button label={ta.save} hierarchy={Button.Hierarchy.PRIMARY} enabled={!busy && !!advForm.employee && !!advForm.amount} action={() => {
						const v = advRef.current;
						return run(t.working, post({action: 'createAdvance', subsidiary, employee: v.employee, docDate: toIso(v.date) || localToday(), amount: Number(String(v.amount).replace(/\./g, '').replace(',', '.')), memo: v.memo}), () => {
							advRef.current = {employee: '', date: '', amount: '', memo: ''};
							setAdvForm(advRef.current);
							reload();
						});
					}} />,
				]),
				'a-new-save'
			)
		);
	}

	// ------------------------------------------------------------------ thiết lập
	function renderSetup() {
		const groupItems = boot.paygroups.map((g) => ({value: String(g.id), label: `${g.code}${g.description ? ` - ${g.description}` : ''}`}));
		items.push(
			item(
				actionRow(
					[
						<Button label={t.loadDefaults} hierarchy={boot.setupReady ? Button.Hierarchy.SECONDARY : Button.Hierarchy.PRIMARY} enabled={!busy && boot.user.canEditSetup} action={() =>
							run(t.working, post({action: 'loadDefaults'}), (r) => {
								reloadBoot();
								setNotice(t.created(Object.entries(r.created).map(([k, v]) => `${v} ${k}`).join(', ') || '0'));
							})
						} />,
					],
					messages
				),
				's-defaults'
			)
		);
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{[
						cell(labeled(t.year, <TextBox rootStyle={{width: '100%'}} text={year} onTextChanged={(a) => setYear(String(a.text || ''))} />), 'g-year'),
						cell(labeled(t.paygroup, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(groupItems)} valueMember="value" displayMember="label" selectedValue={paygroup} onSelectionChanged={(a) => a.value && a.value !== paygroup && setPaygroup(a.value)} />), 'g-group'),
					]}
				</GridPanel>,
				's-gen-form'
			)
		);
		items.push(
			item(
				actionRow([
					<Button label={t.generate} enabled={!busy && boot.user.canEditSetup && boot.setupReady && /^\d{4}$/.test(year) && !!paygroup} action={() =>
						run(t.working, post({action: 'generatePeriods', year: Number(year), paygroup}), (r) => {
							reloadBoot();
							setNotice(t.created(`${r.created.length} ${t.period}`));
						})
					} />,
				]),
				's-gen'
			)
		);
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{t.setupLinks}</Heading>, 's-links-title'));
		const links = [
			<Button label={t.openSetup} type={Button.Type.LINK} action={() => run(t.loading, call({action: 'lookups', subsidiary}), (r) => openRecord(boot.recordTypes.setup, r.setup.id))} />,
			<Button label={t.openCompany} type={Button.Type.LINK} action={() => run(t.loading, call({action: 'lookups', subsidiary}), (r) => (r.company ? openRecord(boot.recordTypes.company, r.company.id) : window.open(url.resolveRecord({recordType: boot.recordTypes.company, isEditMode: true}), '_blank')))} />,
		].concat(
			Object.keys(t.lists).map((k) => <Button label={t.lists[k]} type={Button.Type.LINK} action={() => boot.recordTypeIds && boot.recordTypeIds[k] && window.open(`/app/common/custom/custrecordentrylist.nl?rectype=${encodeURIComponent(boot.recordTypeIds[k])}`, '_blank')} />)
		);
		items.push(item(actionRow(links), 's-links'));
	}

	// ------------------------------------------------------------------ chấm công và phép
	function renderAttendance() {
		const ta = t.att;
		const periodItems = periodOptions(boot, subsidiary, {lock: 'att', prefixGroup: true});
		const per = boot.periods.find((p) => String(p.id) === attPeriod);
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(340px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{[
						cell(labeled(t.period, <Dropdown rootStyle={{width: '100%'}} tooltip={periodTip(periodItems, attPeriod)} dataSource={new ArrayDataSource(periodItems)} valueMember="value" displayMember="label" selectedValue={attPeriod} onSelectionChanged={(a) => a.value && a.value !== attPeriod && (setAttPeriod(a.value), loadAttendance(a.value))} />), 'a-per'),
					]}
				</GridPanel>,
				'a-filters'
			)
		);
		const after = (r) => {
			reloadBoot();
			loadAttendance(attPeriod);
			loadDocs(docType);
			return r;
		};
		items.push(
			item(
				actionRow(
					[
						<Button label={ta.build} enabled={!busy && boot.user.canAttendance && !!per && per.attStatus !== 'L'} action={() => run(t.working, post({action: 'buildAttendance', id: attPeriod}), after)} />,
						<Button label={ta.lock} enabled={!busy && boot.user.canAttendance && !!per && per.attStatus !== 'L'} action={() => run(t.working, post({action: 'lockAttendance', id: attPeriod}), after)} />,
						<Button label={ta.unlock} enabled={!busy && boot.user.canAttendance && !!per && per.attStatus === 'L'} action={() => setConfirm({text: ta.confirmUnlock, go: () => run(t.working, post({action: 'unlockAttendance', id: attPeriod}), after)})} />,
					],
					messages
				),
				'a-actions'
			)
		);
		const empName = (id) => {
			const e = employees.find((x) => x.employee === String(id));
			return e ? `${e.code} ${e.name}` : id;
		};
		const pickAttTab = (k) => {
			if (k !== attTab) setQuick('');
			setAttTab(k);
			if (k === 'leave' && !balances.length) loadBalances();
		};
		items.push(item(actionRow(tabStrip(Object.keys(ta.tabs), ta.tabs, attTab, pickAttTab)), 'a-tabs'));
		if (attTab === 'summary') renderAttSummary();
		else if (attTab === 'docs') renderAttDocs();
		else if (attTab === 'punches') renderPunches();
		else renderLeave();

		function renderAttSummary() {
			items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{ta.summary}</Heading>, 'a-sum-title'));
			items.push(
				item(
					<DataGrid
						dataSource={new ArrayDataSource(attRows)}
						columns={fitCols([
							textCol('employee', t.employee, 220, (r) => empName(r.employee)),
							numCol('std_days', ta.cols.std, 80, (r) => num(r.std_days)),
							numCol('paid_leave', ta.cols.paid, 90, (r) => num(r.paid_leave)),
							numCol('unpaid_leave', ta.cols.unpaid, 90, (r) => num(r.unpaid_leave)),
							numCol('si_leave', ta.cols.si, 70, (r) => num(r.si_leave)),
							numCol('trip_days', ta.cols.trip, 80, (r) => num(r.trip_days)),
							numCol('late_days', ta.cols.late, 90, (r) => num(r.late_days)),
							numCol('adjust_days', ta.cols.adj, 80, (r) => num(r.adjust_days)),
							numCol('work_days', ta.cols.work, 100, (r) => num(r.work_days)),
							numCol('ot_hours', ta.cols.ot, 70, (r) => num(r.ot_hours)),
							textCol('status', ta.cols.status, 90, (r) => (r.status === 'L' ? '🔒' : '')),
						])}
						columnStretch={true}
						placeholder={ta.noSummary}
						rootStyle={{width: '100%', flexShrink: 0, height: autoH(attRows.length, 420)}}
					/>,
					'a-sum'
				)
			);
		}

		function renderAttDocs() {

			// Chứng từ
			const typeItems = Object.keys(ta.types).map((k) => ({value: k, label: ta.types[k]}));
			items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{ta.docs}</Heading>, 'a-docs-title'));
			items.push(
				item(
					<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
						{[cell(labeled(ta.docType, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(typeItems)} valueMember="value" displayMember="label" selectedValue={docType} onSelectionChanged={(a) => a.value && a.value !== docType && (setDocType(a.value), loadDocs(a.value))} />), 'd-type')]}
					</GridPanel>,
					'a-doc-type'
				)
			);
			const docAct = (r, op) => run(t.working, post({action: 'docAction', type: docType, id: r.id, op}), (x) => {
				loadDocs(docType);
				if (x.warnings && x.warnings.length) setNotice(x.warnings.map((w) => serverText(w.message, w.messageVi)).join('; '));
			});
			const opsFor = (st, locked) => (locked || !boot.user.canAttendance ? [] : st === 'H' ? ['submit'] : st === 'P' ? ['approve', 'reject', 'cancel'] : st === 'A' ? ['cancel'] : []);
			const range = (r) => (docType === 'leave' || docType === 'trip' ? `${fmtDate(r.from)} - ${fmtDate(r.to)}` : fmtDate(r.work_date));
			const qty = (r) => (docType === 'leave' || docType === 'trip' ? `${num(r.days)} ${ta.dayUnit}` : docType === 'ot' ? `${num(r.hours)} h ${r.day_type || ''}` : r.exception_type === 'A' ? num(r.adjust_days) : `${r.minutes || 0}' (-${num(r.deduct_days)})`);
			items.push(
				item(
					<DataGrid
						dataSource={new ArrayDataSource(docs)}
						columns={fitCols([
							{name: 'name', label: t.cols.number, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.name} type={Button.Type.LINK} action={() => openRecord(`customrecord_s4vp_${{leave: 'leave_request', ot: 'ot_request', trip: 'business_trip', exception: 'att_exception'}[docType]}`, r.id)} />)},
							textCol('employee', t.employee, 200, (r) => empName(r.employee)),
							textCol('range', t.cols.docDate, 170, range),
							textCol('qty', ta.days, 120, qty),
							textCol('reason', ta.reason, 220, (r) => r.reason || r.purpose || ''),
							textCol('status', ta.cols.status, 100, (r) => ta.reqStatus[r.status] || r.status),
							{name: 'ops', label: '', width: 220, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (
								<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.S}>
									{opsFor(r.status, r.summary_locked).map((op) => <StackPanel.Item key={op}><Button label={ta.ops[op]} type={Button.Type.LINK} action={() => docAct(r, op)} /></StackPanel.Item>).concat([<StackPanel.Item key="none">{plain('')}</StackPanel.Item>])}
								</StackPanel>
							))},
						])}
						columnStretch={true}
						placeholder={t.empty}
						rootStyle={{width: '100%', flexShrink: 0, height: autoH(docs.length, 360)}}
					/>,
					'a-docs'
				)
			);

			// Lập chứng từ mới
			const f = docForm;
			const empItems = employees.map((e) => ({value: e.employee, label: `${e.code} ${e.name}`}));
			const leaveItems = (boot.leaveTypes || []).map((l) => ({value: l.id, label: `${l.code} ${l.name}`}));
			const halfItems = [{value: 'A', label: ta.half.A}, {value: 'P', label: ta.half.P}];
			const exItems = Object.keys(ta.exTypes).map((k) => ({value: k, label: ta.exTypes[k]}));
			const dd = (key, label, list, k) => cell(labeled(label, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(list)} valueMember="value" displayMember="label" selectedValue={f[k] || ''} onSelectionChanged={(a) => a.value && a.value !== f[k] && setDoc(k)(a)} />), key);
			const tb = (key, label, k) => cell(labeled(label, <TextBox rootStyle={{width: '100%'}} text={f[k] || ''} onTextChanged={setDoc(k)} />), key);
			const fields = [dd('f-emp', t.employee, empItems, 'employee')];
			if (docType === 'leave') fields.push(dd('f-lt', ta.leaveType, leaveItems, 'leave_type'), tb('f-from', ta.from, 'from'), dd('f-fh', ta.fromHalf, halfItems, 'from_half'), tb('f-to', ta.to, 'to'), dd('f-th', ta.toHalf, halfItems, 'to_half'), tb('f-reason', ta.reason, 'reason'));
			if (docType === 'ot') fields.push(tb('f-wd', ta.workDate, 'work_date'), tb('f-h', ta.hours, 'hours'), tb('f-reason', ta.reason, 'reason'));
			if (docType === 'trip') fields.push(tb('f-from', ta.from, 'from'), tb('f-to', ta.to, 'to'), tb('f-dest', ta.destination, 'destination'), tb('f-purpose', ta.reason, 'purpose'), tb('f-adv', ta.advanceAmount, 'advance_amount'));
			if (docType === 'exception') fields.push(tb('f-wd', ta.workDate, 'work_date'), dd('f-ext', ta.exceptionType, exItems, 'exception_type'), tb('f-min', ta.minutes, 'minutes'), tb('f-adj', ta.adjust, 'adjust_days'), tb('f-reason', ta.reason, 'reason'));
			items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{`${ta.newDoc}: ${ta.types[docType]}`}</Heading>, 'a-new-title'));
			items.push(
				item(
					<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(200px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
						{fields}
					</GridPanel>,
					'a-new-form'
				)
			);
			const n = (v) => (v === undefined || String(v).trim() === '' ? null : Number(String(v).replace(',', '.')));
			items.push(
				item(
					actionRow([
						<Button label={ta.save} enabled={!busy && boot.user.canAttendance && !!f.employee} action={() => {
							const v = Object.assign({subsidiary}, docRef.current);
							['hours', 'minutes', 'adjust_days', 'advance_amount'].forEach((k) => v[k] !== undefined && (v[k] = n(v[k])));
							['from', 'to', 'work_date'].forEach((k) => v[k] !== undefined && (v[k] = toIso(v[k])));
							return run(t.working, post({action: 'saveDoc', type: docType, values: v}), (x) => {
								docRef.current = {};
								setDocForm({});
								loadDocs(docType);
								if (x.warnings && x.warnings.length) setNotice(x.warnings.map((w) => serverText(w.message, w.messageVi)).join('; '));
							});
						}} />,
					]),
					'a-new-save'
				)
			);

		}

		// Chấm công máy (VP310000, VP502000)
		function renderPunches() {
			items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{ta.punches}</Heading>, 'a-p-title'));
			items.push(item(<Text size={Text.Size.S} type={Text.Type.WEAK} rootStyle={{whiteSpace: 'normal'}}>{ta.punchHint}</Text>, 'a-p-hint'));
			items.push(item(<TextArea rootStyle={{width: '100%', maxWidth: '720px', flexShrink: 0}} text={docForm.__punches || ''} onTextChanged={setDoc('__punches')} />, 'a-p-text'));
			items.push(
				item(
					actionRow([
						<Button label={ta.importPunches} enabled={!busy && boot.user.canAttendance} action={() => {
							const rows = String(docRef.current.__punches || '').split(/\r?\n/).map((l) => l.split(',').map((x) => x.trim())).filter((x) => x[0] && x[1]).map((x) => ({employee: x[0], time: x[1], device: x[2] || ''}));
							const chunks = [];
							for (let i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));
							const total = {created: 0, skipped: 0, errors: []};
							const sendAll = chunks.reduce((p, c) => p.then(() => post({action: 'importPunches', rows: c, source: 'I'}).then((r) => {
								total.created += r.created || 0;
								total.skipped += r.skipped || 0;
								total.errors = total.errors.concat(r.errors || []);
							})), Promise.resolve());
							return run(t.working, sendAll, () => setNotice(ta.punchResult(total)));
						}} />,
						<Button label={ta.processPunches} enabled={!busy && boot.user.canAttendance && !!per && per.attStatus !== 'L'} action={() => run(t.working, post({action: 'processPunches', id: attPeriod}), (r) => {
							setNotice(ta.processResult(r));
							loadDocs(docType);
						})} />,
					]),
					'a-p-actions'
				)
			);

		}

		// Phép năm: năm nay hoặc năm sau; cấp phép năm Y kèm chuyển phép còn lại của năm Y-1, hết hạn phép chuyển (giao dịch X)
		function renderLeave() {
			const y = leaveYear;
			const yearItems = leaveYearOptions(localToday());
			if (!yearItems.some((o) => o.value === y)) yearItems.unshift({value: y, label: y});
			const okYear = /^\d{4}$/.test(y);
			items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{ta.balances}</Heading>, 'a-bal-title'));
			items.push(
				item(
					<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(200px, 260px))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
						{[cell(labeled(ta.leaveYear, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(yearItems)} valueMember="value" displayMember="label" selectedValue={y} onSelectionChanged={(a) => a.value && a.value !== y && (setLeaveYear(a.value), setBalances([]), loadBalances(a.value))} />), 'a-bal-year')]}
					</GridPanel>,
					'a-bal-filters'
				)
			);
			items.push(item(<Text size={Text.Size.S} type={Text.Type.WEAK} rootStyle={{whiteSpace: 'normal'}}>{ta.leaveHint(y)}</Text>, 'a-bal-hint'));
			const today = localToday();
			items.push(
				item(
					actionRow([
						<Button label={ta.accrueYear(y)} enabled={!busy && boot.user.canAttendance && okYear && !!subsidiary} action={() => setConfirm({text: ta.confirmAccrue(y), go: () => run(t.working, post({action: 'accrueLeave', year: Number(y), subsidiary, runDate: today}), (r) => {
							setNotice(ta.accrued(r.rows || []));
							return loadBalances(y);
						})})} />,
						<Button label={ta.expireYear(y)} enabled={!busy && boot.user.canAttendance && okYear && !!subsidiary} action={() => setConfirm({text: ta.confirmExpire(y, fmtDate(today)), go: () => run(t.working, post({action: 'expireLeave', year: Number(y), subsidiary, runDate: today}), (r) => {
							setNotice(ta.expired(r.rows || []));
							return loadBalances(y);
						})})} />,
						<Button label={ta.reloadYear(y)} enabled={!busy && !!subsidiary} action={() => loadBalances(y)} />,
					]),
					'a-bal-actions'
				)
			);
			// Dòng đã ghép mã, tên nhân viên và loại nghỉ để ô lọc nhanh khớp được
			const filtered = quickFilter(balanceRows(balances, employees, boot.leaveTypes), quick);
			items.push(item(quickBox(filtered.count, ta.leaveQuick), 'a-bal-quick'));
			// Ô Chuyển: tooltip "chuyển từ năm trước, hạn đến ..." khi có phép chuyển
			const carriedCol = Object.assign(numCol('carried', ta.cols.carried, 80, (r) => num(r.carried)), {
				content: safe((r) => {
					const tip = carryTip(r, ta);
					const p = {rootStyle: {paddingRight: '28px'}};
					if (tip) p.tooltip = tip;
					return <Text {...p}>{num(r.carried)}</Text>;
				}),
			});
			items.push(
				item(
					<DataGrid
						dataSource={new ArrayDataSource(filtered.rows)}
						columns={fitCols([
							textCol('employee', t.employee, 220, (r) => (r.code ? `${r.code} ${r.name}` : r.employee)),
							textCol('leaveTypeCode', ta.leaveType, 80, (r) => r.leaveTypeCode || ''),
							numCol('entitled', ta.cols.entitled, 80, (r) => num(r.entitled)),
							carriedCol,
							numCol('adjusted', ta.cols.adjusted, 80, (r) => num(r.adjusted)),
							numCol('used', ta.cols.used, 80, (r) => num(r.used)),
							numCol('pending', ta.cols.pending, 80, (r) => num(r.pending)),
							numCol('available', ta.cols.available, 80, (r) => num(r.available)),
						])}
						columnStretch={true}
						placeholder={t.empty}
						rootStyle={{width: '100%', flexShrink: 0, height: autoH(filtered.rows.length, 420)}}
					/>,
					'a-bal'
				)
			);
		}
	}

	// ------------------------------------------------------------------ báo cáo, tờ khai
	function renderReports() {
		const tr = t.rep;
		const f = repForm;
		const typeItems = Object.keys(tr.types).map((k) => ({value: k, label: tr.types[k]}));
		const months = [...new Set(periodsForSubsidiary(boot, subsidiary).map((p) => p.taxMonth).filter(Boolean))].sort().reverse().map((m) => ({value: m, label: `${m.slice(4, 6)}/${m.slice(0, 4)}`}));
		const yn = [{value: 'F', label: tr.yesNo.F}, {value: 'T', label: tr.yesNo.T}];
		// Tháng mặc định: tháng hiện tại, chưa có kỳ thì tháng gần nhất đã qua (danh sách sắp xếp giảm dần)
		const curMonth = localToday().slice(0, 7).replace('-', '');
		const defMonth = ((months.find((m) => m.value === curMonth) || months.find((m) => m.value < curMonth) || months[0]) || {}).value || '';
		const dd = (key, label, list, k) => cell(labeled(label, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(list)} valueMember="value" displayMember="label" selectedValue={f[k] || ''} onSelectionChanged={(a) => a.value !== undefined && a.value !== f[k] && setRep(k)(a)} />), key);
		const tb = (key, label, k) => cell(labeled(label, <TextBox rootStyle={{width: '100%'}} text={f[k] || ''} onTextChanged={setRep(k)} />), key);
		const fields = [cell(labeled(tr.type, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(typeItems)} valueMember="value" displayMember="label" selectedValue={repType} onSelectionChanged={(a) => a.value && a.value !== repType && (setRepType(a.value), setReport(null))} />), 'r-type')];
		if (repType === 'insurance' || repType === 'cost') fields.push(cell(labeled(tr.taxMonth, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(months)} valueMember="value" displayMember="label" selectedValue={f.taxMonth || defMonth} onSelectionChanged={(a) => a.value && a.value !== (f.taxMonth || defMonth) && setRep('taxMonth')(a)} />), 'r-month'));
		if (repType === 'insurance') fields.push(tb('r-c12', tr.c12, 'c12'));
		if (repType === 'pitq' || repType === 'pita') fields.push(tb('r-year', tr.year, 'year'));
		if (repType === 'pitq') fields.push(dd('r-q', tr.quarter, ['1', '2', '3', '4'].map((q) => ({value: q, label: `Q${q}`})), 'quarter'));
		if (repType === 'pita') fields.push(dd('r-s', tr.schedule, [{value: '', label: '05-1/BK + 05-2/BK'}, {value: '05-1', label: '05-1/BK'}, {value: '05-2', label: '05-2/BK'}], 'schedule'));
		fields.push(dd('r-rel', tr.releasedOnly, yn, 'releasedOnly'));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(300px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{fields}
				</GridPanel>,
				'r-form'
			)
		);
		const params = () => {
			const v = repRef.current;
			const p = {action: 'report', type: repType, subsidiary, releasedOnly: v.releasedOnly || 'F'};
			if (repType === 'insurance' || repType === 'cost') p.taxMonth = v.taxMonth || defMonth;
			if (repType === 'insurance' && v.c12) p.c12 = v.c12;
			if (repType === 'pitq' || repType === 'pita') p.year = v.year;
			if (repType === 'pitq') p.quarter = v.quarter;
			if (repType === 'pita') p.schedule = v.schedule || '';
			return p;
		};
		const toCsv = (table) => {
			const esc = (x) => `"${String(x === null || x === undefined ? '' : x).replace(/"/g, '""')}"`;
			const head = table.columns.map((c) => esc(localized(c))).join(',');
			const body = table.rows.map((r) => table.columns.map((c) => esc(r[c.key])).join(','));
			return '﻿' + [head].concat(body).join('\r\n');
		};
		const buttons = [<Button label={tr.run} hierarchy={Button.Hierarchy.PRIMARY} enabled={!busy && !!subsidiary} action={() => run(t.loading, call(params()), (r) => setReport(r))} />];
		if (report) buttons.push(<Button label={tr.csv} action={() => download(`${repType}_${params().taxMonth || params().year || ''}.csv`, toCsv(report))} />);
		if (report && report.d02) buttons.push(<Button label={`${tr.csv} D02-LT`} action={() => download(`D02-LT_${params().taxMonth}.csv`, toCsv(report.d02))} />);
		const extra = messages.slice();
		for (const w of (report && report.warnings) || []) extra.push({text: localized(w), strong: true});
		if (report && report.c12Amount !== null && report.c12Amount !== undefined) extra.push({text: tr.c12Diff(report.c12Amount, report.c12Difference)});
		items.push(item(actionRow(buttons, extra), 'r-actions'));
		if (!report) return;
		const grid = (table, key, height) => {
			const cols = table.columns.map((c) => (c.type === 'money' ? moneyCol(c.key, localized(c), 120) : textCol(c.key, localized(c), c.key.toLowerCase().includes('name') ? 200 : 110, (r) => (r[c.key] === null || r[c.key] === undefined ? '' : typeof r[c.key] === 'number' ? num(r[c.key]) : String(r[c.key])))));
			const rows = table.totals ? table.rows.concat([Object.assign({bold: true}, table.totals, {[table.columns[0].key]: '∑'})]) : table.rows;
			return item(<DataGrid dataSource={new ArrayDataSource(rows)} columns={fitCols(cols)} columnStretch={true} placeholder={t.empty} rootStyle={{width: '100%', flexShrink: 0, height: autoH(rows.length, height || 420)}} />, key);
		};
		if (report.indicators) {
			items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{tr.indicators}</Heading>, 'r-ind-title'));
			items.push(
				item(
					<DataGrid
						dataSource={new ArrayDataSource(report.indicators)}
						columns={fitCols([textCol('code', tr.code, 70, (r) => r.code), textCol('vi', tr.item, 420, (r) => localized(r)), numCol('value', tr.value, 160, (r) => (Number(r.value) >= 1000 ? money(r.value) : num(r.value)))])}
						columnStretch={true}
						rootStyle={{width: '100%', flexShrink: 0, height: '420px'}}
					/>,
					'r-ind'
				)
			);
		}
		items.push(grid(report, 'r-grid'));
		if (report.d02) {
			items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{tr.d02}</Heading>, 'r-d02-title'));
			items.push(grid(report.d02, 'r-d02', 240));
		}
	}

	// ------------------------------------------------------------------ sản lượng, khoán tổ
	function renderOutputs() {
		const to = t.out;
		const empName = (id) => {
			const e = employees.find((x) => x.employee === String(id));
			return e ? `${e.code} ${e.name}` : id;
		};
		const periodItems = [{value: '', label: t.allPeriods}].concat(periodOptions(boot, subsidiary, {lock: 'status', prefixGroup: true}));
		const reload = (per) => run(t.loading, call({action: 'outputs', subsidiary, period: per === undefined ? outPeriod : per}), (r) => setOutputs(r.outputs));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(340px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{[cell(labeled(t.period, <Dropdown rootStyle={{width: '100%'}} tooltip={periodTip(periodItems, outPeriod)} dataSource={new ArrayDataSource(periodItems)} valueMember="value" displayMember="label" selectedValue={outPeriod} onSelectionChanged={(a) => a.value !== undefined && a.value !== outPeriod && (setOutPeriod(a.value), reload(a.value))} />), 'o-per')]}
				</GridPanel>,
				'o-filters'
			)
		);
		items.push(item(actionRow([<Button label={t.actions.refresh} action={() => reload()} />, <Button label={to.create} action={() => window.open(url.resolveRecord({recordType: 'customrecord_s4vp_output', isEditMode: true}), '_blank')} />], messages), 'o-actions'));
		items.push(item(<Text size={Text.Size.S} type={Text.Type.WEAK} rootStyle={{whiteSpace: 'normal'}}>{to.hint}</Text>, 'o-hint'));
		const op = (r, action) => run(t.working, post(action === 'split' ? {action: 'splitOutput', id: r.id} : action === 'members' ? {action: 'loadTeamMembers', id: r.id} : {action: 'outputAction', id: r.id, op: action}), () => reload());
		const opsFor = (r) => (r.status === 'H' ? (r.type === 'T' ? ['members', 'split', 'submit'] : ['submit']) : r.status === 'P' ? ['approve', 'hold'] : r.status === 'A' ? ['hold'] : []);
		const rows = outputs.map((r) => Object.assign({}, r, {
			detailText: r.type === 'T' ? to.people((r.members || []).length) : to.lineCount((r.lines || []).length),
		}));
		const current = outputs.find((r) => r.id === outSel) || null;
		const filtered = quickFilter(rows, quick);
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(filtered.rows)}
					columns={fitCols([
						{name: 'name', label: t.cols.number, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.name} type={Button.Type.LINK} action={() => openRecord('customrecord_s4vp_output', r.id)} />)},
						textCol('doc_date', to.cols.date, 100, (r) => fmtDate(r.doc_date)),
						textCol('type', to.cols.type, 70, (r) => to.type[r.type] || r.type),
						textCol('description', t.description, 220, (r) => r.description || ''),
						moneyCol('total', to.cols.total, 120),
						moneyCol('split_total', to.cols.split, 120),
						textCol('detailText', to.cols.members, 120, (r) => r.detailText),
						textCol('status', t.cols.status, 110, (r) => to.status[r.status] || r.status),
						{name: 'ops', label: '', width: 260, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (
							<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.S}>
								{opsFor(r).map((a) => <StackPanel.Item key={a}><Button label={to.ops[a]} type={Button.Type.LINK} action={() => op(r, a)} /></StackPanel.Item>).concat([<StackPanel.Item key="none">{plain('')}</StackPanel.Item>])}
							</StackPanel>
						))},
					])}
					columnStretch={true}
					highlightRowsOnHover={true}
					placeholder={t.empty}
					on={{[DataGrid.Event.CURSOR_UPDATED]: (args, grid) => {
						const row = grid && grid.cursor && grid.cursor.row;
						if (row && row.dataItem && row.dataItem.id) setOutSel(row.dataItem.id);
					}}}
					rootStyle={{width: '100%', flexShrink: 0, height: autoH(filtered.rows.length, 300)}}
				/>,
				'o-grid'
			)
		);
		if (!current) return;
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{to.detail(current.name)}</Heading>, 'o-d-title'));
		if (current.type === 'T') {
			const ms = (current.members || []).slice();
			if (ms.length > 1) ms.push(sumRow(ms, ['amount'], {employee: '', label: '∑', bold: true}));
			items.push(detailGrid(ms, [textCol('employee', t.employee, 300, (r) => r.label || empName(r.employee)), moneyCol('amount', t.cols.amount, 140)], 'o-d-members', '220px'));
		} else {
			const ls = (current.lines || []).slice();
			if (ls.length > 1) ls.push(sumRow(ls, ['amount'], {employee: '', label: '∑', bold: true}));
			items.push(detailGrid(ls, [
				textCol('employee', t.employee, 240, (r) => r.label || empName(r.employee)),
				textCol('item', to.item, 200, (r) => r.item || ''),
				numCol('qty', t.cols.qty, 90, (r) => num(r.qty)),
				numCol('rate', t.cols.rate, 110, (r) => num(r.rate)),
				moneyCol('amount', t.cols.amount, 130),
			], 'o-d-lines', '220px'));
		}
	}

	// ------------------------------------------------------------------ giấy phép lao động
	function renderPermits() {
		const tw = t.wp;
		const empName = (id) => {
			const e = employees.find((x) => x.employee === String(id));
			return e ? `${e.code} ${e.name}` : id;
		};
		const reload = () => run(t.loading, call({action: 'workPermits', subsidiary}), (r) => setPermits(r.permits));
		const setWp = (k) => (a) => {
			wpRef.current = Object.assign({}, wpRef.current, {[k]: String(a.text || '')});
			setWpForm(wpRef.current);
		};
		items.push(
			item(
				actionRow(
					[
						<Button label={t.actions.refresh} action={reload} />,
						<Button label={tw.create} action={() => window.open(url.resolveRecord({recordType: 'customrecord_s4vp_work_permit', isEditMode: true}), '_blank')} />,
						<Button label={tw.updateExpired} action={() => run(t.working, post({action: 'updateExpiredPermits'}), reload)} />,
					],
					messages
				),
				'w-actions'
			)
		);
		const doOp = (r, a) => run(t.working, post({action: 'workPermitAction', id: r.id, op: a, permitNo: wpRef.current.permitNo, issued: toIso(wpRef.current.issued)}), reload);
		const op = (r, a) => (a === 'revoke' ? setConfirm({text: tw.confirmRevoke, go: () => doOp(r, a)}) : doOp(r, a));
		const opsFor = (r) => (r.status === 'D' ? ['submit', 'issue'] : r.status === 'S' ? ['issue'] : r.status === 'A' ? ['extend', 'revoke'] : r.status === 'E' ? ['extend'] : []);
		const filtered = quickFilter(permits, quick);
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(filtered.rows)}
					columns={fitCols([
						{name: 'name', label: t.cols.number, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.name || r.id} type={Button.Type.LINK} action={() => openRecord('customrecord_s4vp_work_permit', r.id)} />)},
						textCol('employee', t.employee, 220, (r) => empName(r.employee)),
						textCol('permit_no', tw.cols.no, 140, (r) => r.permit_no || ''),
						textCol('issue_type', tw.cols.issue, 90, (r) => tw.issueType[r.issue_type] || r.issue_type || ''),
						textCol('effective', tw.cols.effective, 100, (r) => fmtDate(r.effective)),
						textCol('expiry', tw.cols.expiry, 100, (r) => fmtDate(r.expiry)),
						textCol('daysLeft', tw.cols.left, 80, (r) => (r.daysLeft === null || r.daysLeft === undefined ? '' : String(r.daysLeft))),
						textCol('status', t.cols.status, 110, (r) => tw.status[r.status] || r.status),
						{name: 'ops', label: '', width: 220, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (
							<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.S}>
								{opsFor(r).map((a) => <StackPanel.Item key={a}><Button label={tw.ops[a]} type={Button.Type.LINK} action={() => op(r, a)} /></StackPanel.Item>).concat([<StackPanel.Item key="none">{plain('')}</StackPanel.Item>])}
							</StackPanel>
						))},
					])}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', flexShrink: 0, height: autoH(filtered.rows.length, 360)}}
				/>,
				'w-grid'
			)
		);
		// Số giấy và ngày cấp dùng cho thao tác Đã cấp trên dòng (đặt dưới lưới, có tiêu đề rõ)
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{tw.issueForm}</Heading>, 'w-form-title'));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{[
						cell(labeled(tw.permitNo, <TextBox rootStyle={{width: '100%'}} text={wpForm.permitNo} onTextChanged={setWp('permitNo')} />), 'w-no'),
						cell(labeled(tw.issued, <TextBox rootStyle={{width: '100%'}} text={wpForm.issued} onTextChanged={setWp('issued')} />), 'w-iss'),
					]}
				</GridPanel>,
				'w-form'
			)
		);
	}
}
