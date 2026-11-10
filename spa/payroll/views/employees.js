/**
 * Nhân sự (giao diện bản 2, docs/UI_V2.md mục 14). Một file phục vụ hai view:
 *   employees  danh sách: ô tìm lớn (tìm PHÍA MÁY CHỦ, có trễ ngắn), chip lọc có số đếm, bảng gọn có phân trang, khung "Sắp đến hạn"
 *   employee   hồ sơ một người (params id, tab): dải thông tin chính và các tab Tổng quan, Lương và phụ cấp, Hợp đồng, Quyết định,
 *              Người phụ thuộc, Phân bổ chi phí, Giấy phép lao động, Phép năm, Bảng lương
 *
 * Dữ liệu: GET employeesPage, employeeCard, hrLookups (api/HrCore). Ghi: POST hrSaveContract, hrActivateContract,
 * hrTerminateContract, hrSaveDecision, hrApplyDecision, hrSaveDependent; phân bổ và giấy phép dùng action cũ của RESTlet
 * (newAllocVersion, saveAllocLines, activateAllocVersion, deleteAllocVersion, saveWorkPermit, workPermitAction).
 * Mọi thay đổi nhập trong hộp thoại có ngày hiệu lực, kiểm lỗi tại chỗ; lỗi máy chủ hiện ngay trong hộp thoại.
 * Số định danh (mã số thuế, CCCD, tài khoản) không về trình duyệt: chỉ có cờ có / không; sửa ở bản ghi NetSuite.
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import url from 'N/url';
import {call, post, openRecord, errorText} from '../lib/api.js';
import {money, num, fmtDate, toNumber, quickFilter} from '../lib/format.js';
import {pick, serverText} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Table, Badge, Chips, Tabs, Select, Field, TextInput, NumberInput, DateInput, TextArea, Dialog, SidePanel, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		title: 'Nhân sự',
		sub: 'Tìm một người, xem việc sắp đến hạn. Bấm một dòng để mở hồ sơ.',
		loading: 'Đang tải...',
		working: 'Đang xử lý...',
		findHint: 'Tìm theo mã, tên, phòng ban',
		newProfile: 'Tạo hồ sơ lương',
		legacy: 'Màn hình cũ',
		refresh: 'Tải lại',
		noSubsidiary: 'Chưa chọn công ty con.',
		empty: 'Không có nhân viên nào khớp.',
		filters: {all: 'Tất cả', working: 'Đang làm', probation: 'Thử việc', expiring: 'Sắp hết hạn hợp đồng', missing: 'Thiếu thông tin', left: 'Đã nghỉ'},
		filterLabel: 'Bộ lọc nhân viên',
		sortLabel: 'Sắp xếp',
		sorts: {code: 'Sắp theo mã', name: 'Sắp theo tên', department: 'Sắp theo phòng ban', expiry: 'Sắp theo hạn hợp đồng'},
		cols: {
			code: 'Mã', name: 'Họ tên', department: 'Phòng ban', employment: 'Loại lao động', contract: 'Hợp đồng hiện tại', expiry: 'Hết hạn', salary: 'Lương cơ bản', status: 'Trạng thái',
			number: 'Số', type: 'Loại', signDate: 'Ngày ký', effective: 'Hiệu lực từ', to: 'Đến', title: 'Chức danh', contractSalary: 'Lương trên hợp đồng', insWage: 'Lương đóng BH',
			allowance: 'Phụ cấp cố định', package: 'Gói phúc lợi', change: 'Nội dung', note: 'Ghi chú', relationship: 'Quan hệ', birthDate: 'Ngày sinh', taxCode: 'Mã số thuế',
			from: 'Giảm trừ từ', until: 'Giảm trừ đến', version: 'Phiên bản', total: 'Tổng %', reason: 'Lý do', project: 'Dự án', location: 'Địa điểm', cls: 'Lớp (class)',
			percent: 'Tỷ lệ %', permitNo: 'Số giấy phép', issue: 'Loại cấp', left: 'Thời hạn còn', leaveType: 'Loại nghỉ', entitled: 'Được cấp', carried: 'Chuyển sang',
			adjusted: 'Điều chỉnh', used: 'Đã dùng', pending: 'Chờ duyệt', available: 'Còn lại', period: 'Kỳ', batch: 'Bảng lương', gross: 'Tổng thu nhập', eeIns: 'BH NLĐ',
			pit: 'Thuế TNCN', net: 'Thực lĩnh', appliedDate: 'Ngày áp dụng',
		},
		pager: {prev: 'Trước', next: 'Sau', page: (p, n) => `Trang ${p} / ${n}`, range: (a, b, n) => `${a} - ${b} trong ${n} người`, none: 'Không có dòng nào'},
		status: {working: 'Đang làm', left: 'Đã nghỉ', probation: 'Thử việc', noProfile: 'Chưa có hồ sơ lương', noTax: 'Thiếu mã số thuế', noBank: 'Thiếu tài khoản', noId: 'Thiếu CCCD', noSi: 'Thiếu sổ BHXH'},
		empType: {E: 'Nhân viên', C: 'Cộng tác viên'},
		contractType: {P: 'Thử việc', F: 'Xác định thời hạn', U: 'Không xác định thời hạn', S: 'Thời vụ / khoán việc', C: 'Cộng tác viên / dịch vụ'},
		contractState: {D: 'Nháp', A: 'Hiệu lực', X: 'Hết hạn', T: 'Chấm dứt'},
		upcoming: 'Chưa tới ngày hiệu lực',
		decisionType: {H: 'Tiếp nhận', T: 'Điều chuyển', P: 'Bổ nhiệm', S: 'Điều chỉnh lương', R: 'Khen thưởng', D: 'Kỷ luật', X: 'Chấm dứt'},
		decisionStatus: {D: 'Nháp', A: 'Đã áp dụng'},
		allocStatus: {D: 'Nháp', A: 'Hiệu lực', S: 'Đã thay thế'},
		permitStatus: {D: 'Đang chuẩn bị', S: 'Đã nộp', A: 'Còn hiệu lực', E: 'Hết hạn', V: 'Thu hồi'},
		permitDoc: {P: 'Giấy phép', E: 'Giấy xác nhận miễn'},
		permitIssue: {N: 'Cấp mới', X: 'Gia hạn', R: 'Cấp lại'},
		permitJob: {M: 'Nhà quản lý', D: 'Giám đốc điều hành', E: 'Chuyên gia', T: 'Lao động kỹ thuật', O: 'Khác'},
		batchStatus: {H: 'Tạm giữ', B: 'Chờ tính', C: 'Đã tính', P: 'Chờ duyệt', A: 'Đã duyệt', J: 'Từ chối', R: 'Đã ghi sổ', V: 'Đã đảo'},
		yes: 'Có',
		no: 'Chưa có',
		openEnded: 'Không thời hạn',
		appendixOf: (n) => `Phụ lục của ${n || 'hợp đồng'}`,
		due: {
			title: 'Sắp đến hạn',
			sub: (n) => `${n} việc cần xử lý`,
			days: (n) => `Trong ${n} ngày tới`,
			daysLabel: 'Khoảng thời gian',
			find: 'Tìm trong danh sách',
			empty: 'Không có việc nào đến hạn trong khoảng này.',
			more: (n) => `Còn ${n} việc khác chưa hiện. Thu hẹp khoảng thời gian để xem hết.`,
			kind: {contractExpiry: 'Hợp đồng hết hạn', probationEnd: 'Hết thử việc', permitExpiry: 'Giấy phép lao động hết hạn'},
			left: (n) => (n < 0 ? `Quá hạn ${-n} ngày` : n === 0 ? 'Hôm nay' : `Còn ${n} ngày`),
			failed: 'Không đọc được danh sách đến hạn.',
			renew: 'Gia hạn',
			view: 'Xem',
		},
		notes: {NO_CONTRACTS: 'Dữ liệu hợp đồng lao động chưa được cài trên tài khoản này: chưa có cột hợp đồng và bộ lọc theo hợp đồng.', NO_FOLD: 'Tìm kiếm đang phân biệt dấu trên tài khoản này: hãy gõ đủ dấu.'},
		card: {
			back: 'Nhân sự',
			notFound: 'Không mở được hồ sơ nhân viên.',
			openProfile: 'Sửa hồ sơ lương',
			openRecord: 'Mở bản ghi',
			noProfile: 'Nhân viên này chưa có hồ sơ lương. Tạo hồ sơ lương để nhập lương, người phụ thuộc và áp dụng quyết định.',
			facts: {department: 'Phòng ban', title: 'Chức danh', employment: 'Loại lao động', hired: 'Ngày vào làm', contract: 'Hợp đồng hiện tại', salary: 'Lương cơ bản', insWage: 'Lương đóng BH', dependents: 'Người phụ thuộc', info: 'Thông tin hồ sơ', lastDay: 'Ngày làm việc cuối'},
			complete: 'Đủ',
			none: 'Chưa có',
			tabs: {overview: 'Tổng quan', pay: 'Lương và phụ cấp', contracts: 'Hợp đồng', decisions: 'Quyết định', dependents: 'Người phụ thuộc', alloc: 'Phân bổ chi phí', permits: 'Giấy phép lao động', leave: 'Phép năm', payslips: 'Bảng lương'},
			tabsLabel: 'Các phần của hồ sơ',
			timeline: 'Dòng thời gian',
			timelineFind: 'Tìm trong dòng thời gian',
			timelineEmpty: 'Chưa có mốc nào.',
			noMatch: 'Không có dòng nào khớp.',
			dueEmpty: 'Không có việc nào sắp đến hạn.',
			draft: 'Nháp',
			future: 'Sắp tới',
			payHidden: 'Vai trò của bạn không được xem số tiền lương.',
			currentPay: 'Lương hiện tại',
			currentPaySub: (d) => `Hiệu lực từ ${d}`,
			noPay: 'Chưa có dòng lương nào.',
			payHistory: 'Lịch sử lương',
			find: 'Tìm trong bảng',
			pickRow: 'Chọn một dòng để thao tác.',
			allocLines: (n) => `Dòng phân bổ của phiên bản ${n}`,
			allocEmpty: 'Chưa có phiên bản phân bổ nào. Tạo bản nháp, nhập tỷ lệ rồi kích hoạt với ngày hiệu lực.',
			allocPick: 'Chọn một phiên bản để xem các dòng.',
			used: 'Đã dùng cho bảng lương ghi sổ',
			permitsEmpty: 'Chưa có giấy phép lao động nào.',
			notForeign: 'Hồ sơ lương chưa đánh dấu người nước ngoài.',
			leaveYear: (y) => `Số dư phép năm ${y}`,
			leaveEmpty: 'Chưa có số dư phép của năm nay.',
			leaveOpen: 'Mở màn hình phép',
			payslipsEmpty: 'Chưa có kỳ lương nào.',
			payslipsSub: '6 kỳ gần nhất. Bấm một dòng để mở bảng lương tại nhân viên này.',
			attach: 'File đính kèm (bản scan) lưu ở tab Files của bản ghi NetSuite: bấm Mở bản ghi.',
		},
		act: {
			raise: 'Điều chỉnh lương', addContract: 'Thêm hợp đồng', addAppendix: 'Thêm phụ lục', renew: 'Gia hạn', terminate: 'Chấm dứt', activate: 'Kích hoạt', edit: 'Sửa',
			addDecision: 'Thêm quyết định', apply: 'Áp dụng', addDependent: 'Thêm người phụ thuộc', endDependent: 'Kết thúc giảm trừ', newVersion: 'Tạo bản nháp', editLines: 'Sửa tỷ lệ',
			deleteDraft: 'Xóa bản nháp', addPermit: 'Thêm giấy phép', submit: 'Nộp hồ sơ', issue: 'Đã cấp', extend: 'Gia hạn', revoke: 'Thu hồi', addLine: 'Thêm dòng', removeLine: 'Bỏ dòng',
			cancel: 'Hủy', saveDraft: 'Lưu nháp', save: 'Lưu', saveApply: 'Lưu và áp dụng', saveActivate: 'Lưu và kích hoạt',
		},
		dlg: {
			raise: 'Điều chỉnh lương',
			raiseHint: 'Tạo quyết định điều chỉnh lương. Áp dụng sẽ thêm một dòng lịch sử lương từ ngày hiệu lực; ô để trống giữ nguyên mức hiện tại.',
			contractNew: 'Thêm hợp đồng',
			contractEdit: 'Sửa hợp đồng',
			contractRenew: 'Gia hạn - hợp đồng mới',
			appendix: (n) => `Phụ lục của hợp đồng ${n || ''}`.trim(),
			approvedHint: 'Hợp đồng đã kích hoạt: chỉ sửa được số, ngày ký và ghi chú.',
			contractHint: 'Mức lương trên hợp đồng chỉ để ghi nhận. Lương tính theo lịch sử lương: đổi lương bằng nút Điều chỉnh lương.',
			terminate: (n) => `Chấm dứt hợp đồng ${n || ''}`.trim(),
			terminateHint: 'Ngày chấm dứt là ngày cuối cùng hợp đồng còn giá trị. Bản ghi được giữ lại, không xóa.',
			decisionNew: 'Thêm quyết định',
			decisionEdit: 'Sửa quyết định',
			decisionHint: 'Giá trị cũ (phòng ban, chức danh, lương) được hệ thống ghi lại theo ngày hiệu lực. Ô để trống nghĩa là không đổi.',
			dependentNew: 'Thêm người phụ thuộc',
			dependentEdit: 'Sửa người phụ thuộc',
			taxKeep: 'Để trống để giữ nguyên',
			allocNew: 'Tạo bản nháp phân bổ',
			allocNewHint: 'Bản nháp chép các dòng của phiên bản đang hiệu lực.',
			allocLines: (n) => `Tỷ lệ phân bổ - phiên bản ${n}`,
			allocTotal: (v) => `Tổng: ${v}%`,
			allocTotalHint: 'Tổng phải bằng 100% khi kích hoạt.',
			allocActivate: (n) => `Kích hoạt phiên bản ${n}`,
			allocActivateHint: 'Phiên bản đang hiệu lực sẽ hết hạn vào ngày trước ngày hiệu lực mới.',
			permitNew: 'Thêm giấy phép lao động',
			permitIssue: (n) => `Ghi nhận đã cấp - ${n || ''}`.trim(),
		},
		f: {
			number: 'Số hợp đồng', appendixNumber: 'Số phụ lục', decisionNumber: 'Số quyết định', type: 'Loại hợp đồng', decisionType: 'Loại quyết định', signDate: 'Ngày ký', effective: 'Ngày hiệu lực',
			expiry: 'Ngày kết thúc', title: 'Chức danh', contractSalary: 'Mức lương ghi trên hợp đồng', insWage: 'Lương đóng bảo hiểm', note: 'Ghi chú', newSalary: 'Lương hợp đồng mới',
			newInsWage: 'Lương đóng bảo hiểm mới', newAllowance: 'Phụ cấp cố định mới', newDepartment: 'Phòng ban mới', newTitle: 'Chức danh mới', keep: 'Không đổi', current: (v) => `Hiện tại: ${v}`,
			terminateDate: 'Ngày chấm dứt', reason: 'Lý do', name: 'Họ tên', relationship: 'Quan hệ', birthDate: 'Ngày sinh', taxCode: 'Mã số thuế', from: 'Giảm trừ từ', to: 'Giảm trừ đến',
			docType: 'Loại giấy', issueType: 'Loại cấp', authority: 'Cơ quan cấp', permitExpiry: 'Ngày hết hạn', job: 'Vị trí công việc', workLocation: 'Địa điểm làm việc', passport: 'Số hộ chiếu',
			passportExpiry: 'Hộ chiếu hết hạn', permitNo: 'Số giấy phép', issued: 'Ngày cấp', pick: 'Chọn', none: '(không)',
		},
		err: {
			required: 'Bắt buộc nhập', date: 'Ngày không hợp lệ, nhập dd/mm/yyyy', number: 'Số không hợp lệ', negative: 'Không được âm', endBeforeStart: 'Phải từ ngày hiệu lực trở đi',
			needOne: 'Nhập ít nhất một mức mới', needChange: 'Nhập ít nhất một nội dung thay đổi', percent: 'Tỷ lệ phải lớn hơn 0 và không quá 100', fix: 'Còn ô chưa hợp lệ. Sửa các ô có chữ đỏ rồi lưu lại.',
		},
		confirm: {
			activate: (n) => `Kích hoạt hợp đồng ${n || ''}? Sau khi kích hoạt chỉ sửa được số, ngày ký và ghi chú.`,
			apply: (n) => `Áp dụng quyết định ${n || ''}? Hồ sơ lương và lịch sử lương sẽ được cập nhật theo ngày hiệu lực; sau đó quyết định không sửa được nữa.`,
			deleteDraft: (n) => `Xóa bản nháp phân bổ phiên bản ${n}?`,
			revoke: (n) => `Thu hồi giấy phép ${n || ''}?`,
		},
		done: {
			contract: 'Đã lưu hợp đồng.', activated: 'Đã kích hoạt hợp đồng.', terminated: 'Đã chấm dứt hợp đồng.', decision: 'Đã lưu quyết định.', applied: 'Đã áp dụng quyết định.',
			dependent: 'Đã lưu người phụ thuộc.', alloc: 'Đã lưu phân bổ.', allocActivated: 'Đã kích hoạt phiên bản phân bổ.', allocDeleted: 'Đã xóa bản nháp.', permit: 'Đã lưu giấy phép.', permitOp: 'Đã cập nhật giấy phép.',
		},
		tl: {
			hire: 'Vào làm',
			leave: 'Ngày làm việc cuối',
			contract: (type, ref) => `Hợp đồng ${type}${ref ? ` số ${ref}` : ''}`.replace(/\s+/g, ' ').trim(),
			appendix: (ref, parent) => `Phụ lục${ref ? ` ${ref}` : ''}${parent ? ` của hợp đồng ${parent}` : ''}`,
			contractEnd: (type, ref) => `Hết hạn hợp đồng ${type}${ref ? ` số ${ref}` : ''}`.replace(/\s+/g, ' ').trim(),
			contractTerminated: (type, ref) => `Chấm dứt hợp đồng ${type}${ref ? ` số ${ref}` : ''}`.replace(/\s+/g, ' ').trim(),
			decision: (type, ref) => `Quyết định ${type}${ref ? ` số ${ref}` : ''}`.replace(/\s+/g, ' ').trim(),
			salary: 'Thay đổi lương',
			dependent: (name) => `Đăng ký người phụ thuộc ${name}`.trim(),
			dependentEnd: (name) => `Kết thúc giảm trừ người phụ thuộc ${name}`.trim(),
			permit: (ref) => `Giấy phép lao động ${ref} có hiệu lực`.replace(/\s+/g, ' '),
			permitExpiry: (ref) => `Giấy phép lao động ${ref} hết hạn`.replace(/\s+/g, ' '),
			until: (d) => `đến ${d}`,
			pay: (v) => `lương ${v}`,
			insWage: (v) => `lương đóng BH ${v}`,
			allowance: (v) => `phụ cấp ${v}`,
			department: 'Phòng ban',
			title: 'Chức danh',
			salaryWord: 'Lương',
		},
	},
	en: {
		title: 'Employees',
		sub: 'Find a person and see what is coming due. Click a row to open the employee file.',
		loading: 'Loading...',
		working: 'Working...',
		findHint: 'Search by code, name, department',
		newProfile: 'New payroll profile',
		legacy: 'Previous screen',
		refresh: 'Refresh',
		noSubsidiary: 'No subsidiary is selected.',
		empty: 'No matching employees.',
		filters: {all: 'All', working: 'Active', probation: 'On probation', expiring: 'Contract expiring', missing: 'Missing information', left: 'Left'},
		filterLabel: 'Employee filter',
		sortLabel: 'Sort',
		sorts: {code: 'Sort by code', name: 'Sort by name', department: 'Sort by department', expiry: 'Sort by contract end'},
		cols: {
			code: 'Code', name: 'Name', department: 'Department', employment: 'Employment type', contract: 'Current contract', expiry: 'Ends', salary: 'Base salary', status: 'Status',
			number: 'Number', type: 'Type', signDate: 'Signed', effective: 'Effective', to: 'To', title: 'Job title', contractSalary: 'Contract salary', insWage: 'Insurance wage',
			allowance: 'Fixed allowance', package: 'Benefit package', change: 'Content', note: 'Note', relationship: 'Relationship', birthDate: 'Birth date', taxCode: 'Tax code',
			from: 'Deduction from', until: 'Deduction to', version: 'Version', total: 'Total %', reason: 'Reason', project: 'Project', location: 'Location', cls: 'Class',
			percent: 'Percent', permitNo: 'Permit number', issue: 'Issue type', left: 'Time left', leaveType: 'Leave type', entitled: 'Entitled', carried: 'Carried over',
			adjusted: 'Adjusted', used: 'Used', pending: 'Pending', available: 'Available', period: 'Period', batch: 'Payroll batch', gross: 'Gross', eeIns: 'Employee insurance',
			pit: 'PIT', net: 'Net pay', appliedDate: 'Applied on',
		},
		pager: {prev: 'Previous', next: 'Next', page: (p, n) => `Page ${p} / ${n}`, range: (a, b, n) => `${a} - ${b} of ${n} people`, none: 'No rows'},
		status: {working: 'Active', left: 'Left', probation: 'On probation', noProfile: 'No payroll profile', noTax: 'No tax code', noBank: 'No bank account', noId: 'No ID number', noSi: 'No social insurance book'},
		empType: {E: 'Employee', C: 'Contractor'},
		contractType: {P: 'Probation', F: 'Fixed term', U: 'Indefinite term', S: 'Seasonal / piecework', C: 'Contractor / service'},
		contractState: {D: 'Draft', A: 'Active', X: 'Expired', T: 'Terminated'},
		upcoming: 'Not yet in effect',
		decisionType: {H: 'Onboarding', T: 'Transfer', P: 'Appointment', S: 'Salary change', R: 'Reward', D: 'Discipline', X: 'Termination'},
		decisionStatus: {D: 'Draft', A: 'Applied'},
		allocStatus: {D: 'Draft', A: 'Active', S: 'Superseded'},
		permitStatus: {D: 'In preparation', S: 'Submitted', A: 'Valid', E: 'Expired', V: 'Revoked'},
		permitDoc: {P: 'Work permit', E: 'Exemption certificate'},
		permitIssue: {N: 'New', X: 'Extension', R: 'Reissue'},
		permitJob: {M: 'Manager', D: 'Executive director', E: 'Expert', T: 'Technical worker', O: 'Other'},
		batchStatus: {H: 'On hold', B: 'Pending calculation', C: 'Calculated', P: 'Pending approval', A: 'Approved', J: 'Rejected', R: 'Released', V: 'Reversed'},
		yes: 'Yes',
		no: 'Missing',
		openEnded: 'No end date',
		appendixOf: (n) => `Appendix of ${n || 'the contract'}`,
		due: {
			title: 'Coming due',
			sub: (n) => `${n} items to handle`,
			days: (n) => `Within ${n} days`,
			daysLabel: 'Time window',
			find: 'Search this list',
			empty: 'Nothing comes due in this window.',
			more: (n) => `${n} more items are not shown. Narrow the time window to see them all.`,
			kind: {contractExpiry: 'Contract ends', probationEnd: 'Probation ends', permitExpiry: 'Work permit expires'},
			left: (n) => (n < 0 ? `${-n} days overdue` : n === 0 ? 'Today' : `${n} days left`),
			failed: 'The due list could not be read.',
			renew: 'Renew',
			view: 'View',
		},
		notes: {NO_CONTRACTS: 'Labor contract data is not installed on this account yet: no contract column and no contract filters.', NO_FOLD: 'Search is accent-sensitive on this account: type the full diacritics.'},
		card: {
			back: 'Employees',
			notFound: 'The employee file could not be opened.',
			openProfile: 'Edit payroll profile',
			openRecord: 'Open record',
			noProfile: 'This employee has no payroll profile yet. Create one to enter pay, dependents and to apply decisions.',
			facts: {department: 'Department', title: 'Job title', employment: 'Employment type', hired: 'Hire date', contract: 'Current contract', salary: 'Base salary', insWage: 'Insurance wage', dependents: 'Dependents', info: 'Profile information', lastDay: 'Last working day'},
			complete: 'Complete',
			none: 'None',
			tabs: {overview: 'Overview', pay: 'Pay and allowances', contracts: 'Contracts', decisions: 'Decisions', dependents: 'Dependents', alloc: 'Cost allocation', permits: 'Work permits', leave: 'Annual leave', payslips: 'Payroll'},
			tabsLabel: 'Sections of the employee file',
			timeline: 'Timeline',
			timelineFind: 'Search the timeline',
			timelineEmpty: 'No events yet.',
			noMatch: 'No matching rows.',
			dueEmpty: 'Nothing is coming due.',
			draft: 'Draft',
			future: 'Upcoming',
			payHidden: 'Your role is not allowed to see pay amounts.',
			currentPay: 'Current pay',
			currentPaySub: (d) => `Effective from ${d}`,
			noPay: 'No pay rows yet.',
			payHistory: 'Pay history',
			find: 'Search this table',
			pickRow: 'Select a row to act on it.',
			allocLines: (n) => `Allocation lines of version ${n}`,
			allocEmpty: 'No allocation versions yet. Create a draft, enter the percentages, then activate it with an effective date.',
			allocPick: 'Select a version to see its lines.',
			used: 'Used by a released payroll batch',
			permitsEmpty: 'No work permits yet.',
			notForeign: 'The payroll profile is not marked as a foreign worker.',
			leaveYear: (y) => `Leave balances for ${y}`,
			leaveEmpty: 'No leave balances for this year yet.',
			leaveOpen: 'Open the leave screen',
			payslipsEmpty: 'No pay periods yet.',
			payslipsSub: 'Latest 6 periods. Click a row to open the payroll batch at this employee.',
			attach: 'Attachments (scans) are kept on the Files tab of the NetSuite record: click Open record.',
		},
		act: {
			raise: 'Change salary', addContract: 'Add contract', addAppendix: 'Add appendix', renew: 'Renew', terminate: 'Terminate', activate: 'Activate', edit: 'Edit',
			addDecision: 'Add decision', apply: 'Apply', addDependent: 'Add dependent', endDependent: 'End deduction', newVersion: 'New draft', editLines: 'Edit percentages',
			deleteDraft: 'Delete draft', addPermit: 'Add permit', submit: 'Submit', issue: 'Mark issued', extend: 'Extend', revoke: 'Revoke', addLine: 'Add line', removeLine: 'Remove line',
			cancel: 'Cancel', saveDraft: 'Save draft', save: 'Save', saveApply: 'Save and apply', saveActivate: 'Save and activate',
		},
		dlg: {
			raise: 'Change salary',
			raiseHint: 'Creates a salary change decision. Applying it adds a pay history row from the effective date; empty boxes keep the current amount.',
			contractNew: 'Add contract',
			contractEdit: 'Edit contract',
			contractRenew: 'Renew - new contract',
			appendix: (n) => `Appendix of contract ${n || ''}`.trim(),
			approvedHint: 'The contract is active: only the number, signing date and note can be edited.',
			contractHint: 'The contract salary is for the record only. Payroll uses the pay history: change pay with Change salary.',
			terminate: (n) => `Terminate contract ${n || ''}`.trim(),
			terminateHint: 'The termination date is the last day the contract is valid. The record is kept, not deleted.',
			decisionNew: 'Add decision',
			decisionEdit: 'Edit decision',
			decisionHint: 'Previous values (department, job title, pay) are captured by the system as of the effective date. An empty box means no change.',
			dependentNew: 'Add dependent',
			dependentEdit: 'Edit dependent',
			taxKeep: 'Leave empty to keep the current value',
			allocNew: 'New allocation draft',
			allocNewHint: 'The draft copies the lines of the active version.',
			allocLines: (n) => `Allocation percentages - version ${n}`,
			allocTotal: (v) => `Total: ${v}%`,
			allocTotalHint: 'The total must be 100% to activate.',
			allocActivate: (n) => `Activate version ${n}`,
			allocActivateHint: 'The active version expires on the day before the new effective date.',
			permitNew: 'Add work permit',
			permitIssue: (n) => `Mark as issued - ${n || ''}`.trim(),
		},
		f: {
			number: 'Contract number', appendixNumber: 'Appendix number', decisionNumber: 'Decision number', type: 'Contract type', decisionType: 'Decision type', signDate: 'Signing date', effective: 'Effective date',
			expiry: 'End date', title: 'Job title', contractSalary: 'Salary written on the contract', insWage: 'Insurance wage', note: 'Note', newSalary: 'New contract salary',
			newInsWage: 'New insurance wage', newAllowance: 'New fixed allowance', newDepartment: 'New department', newTitle: 'New job title', keep: 'No change', current: (v) => `Current: ${v}`,
			terminateDate: 'Termination date', reason: 'Reason', name: 'Full name', relationship: 'Relationship', birthDate: 'Birth date', taxCode: 'Tax code', from: 'Deduction from', to: 'Deduction to',
			docType: 'Document type', issueType: 'Issue type', authority: 'Issuing authority', permitExpiry: 'Expiry date', job: 'Job position', workLocation: 'Work location', passport: 'Passport number',
			passportExpiry: 'Passport expiry', permitNo: 'Permit number', issued: 'Issue date', pick: 'Select', none: '(none)',
		},
		err: {
			required: 'Required', date: 'Invalid date, use dd/mm/yyyy', number: 'Invalid number', negative: 'Cannot be negative', endBeforeStart: 'Must be on or after the effective date',
			needOne: 'Enter at least one new amount', needChange: 'Enter at least one change', percent: 'The percent must be above 0 and at most 100', fix: 'Some boxes are not valid. Fix the ones marked in red, then save again.',
		},
		confirm: {
			activate: (n) => `Activate contract ${n || ''}? After activation only the number, signing date and note can be edited.`,
			apply: (n) => `Apply decision ${n || ''}? The payroll profile and pay history are updated from the effective date; the decision can no longer be edited.`,
			deleteDraft: (n) => `Delete the allocation draft version ${n}?`,
			revoke: (n) => `Revoke permit ${n || ''}?`,
		},
		done: {
			contract: 'Contract saved.', activated: 'Contract activated.', terminated: 'Contract terminated.', decision: 'Decision saved.', applied: 'Decision applied.',
			dependent: 'Dependent saved.', alloc: 'Allocation saved.', allocActivated: 'Allocation version activated.', allocDeleted: 'Draft deleted.', permit: 'Permit saved.', permitOp: 'Permit updated.',
		},
		tl: {
			hire: 'Hired',
			leave: 'Last working day',
			contract: (type, ref) => `${type} contract${ref ? ` no. ${ref}` : ''}`.replace(/\s+/g, ' ').trim(),
			appendix: (ref, parent) => `Appendix${ref ? ` ${ref}` : ''}${parent ? ` of contract ${parent}` : ''}`,
			contractEnd: (type, ref) => `${type} contract${ref ? ` no. ${ref}` : ''} ends`.replace(/\s+/g, ' ').trim(),
			contractTerminated: (type, ref) => `${type} contract${ref ? ` no. ${ref}` : ''} terminated`.replace(/\s+/g, ' ').trim(),
			decision: (type, ref) => `${type} decision${ref ? ` no. ${ref}` : ''}`.replace(/\s+/g, ' ').trim(),
			salary: 'Pay change',
			dependent: (name) => `Dependent ${name} registered`.replace(/\s+/g, ' '),
			dependentEnd: (name) => `Deduction for dependent ${name} ends`.replace(/\s+/g, ' '),
			permit: (ref) => `Work permit ${ref} takes effect`.replace(/\s+/g, ' '),
			permitExpiry: (ref) => `Work permit ${ref} expires`.replace(/\s+/g, ' '),
			until: (d) => `to ${d}`,
			pay: (v) => `salary ${v}`,
			insWage: (v) => `insurance wage ${v}`,
			allowance: (v) => `allowance ${v}`,
			department: 'Department',
			title: 'Job title',
			salaryWord: 'Salary',
		},
	},
};

const blank = (v) => v === null || v === undefined || v === '';
const isIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const str = (v) => (blank(v) ? '' : String(v));
const nextDay = (iso) => {
	if (!isIso(iso)) return '';
	const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + 1));
	return d.toISOString().slice(0, 10);
};
const CONTRACT_TONE = {D: 'muted', A: 'ok', X: 'warn', T: 'muted'};
const PERMIT_TONE = {D: 'muted', S: 'info', A: 'ok', E: 'warn', V: 'muted'};
const ALLOC_TONE = {D: 'muted', A: 'ok', S: 'muted'};
const BATCH_TONE = {H: 'muted', B: 'info', C: 'warn', P: 'warn', A: 'ok', J: 'error', R: 'ok', V: 'muted'};
const DAY_OPTIONS = [30, 60, 90];
const LIST_HEIGHT = 'max(220px, calc(100vh - 322px))';
const TAB_HEIGHT = 'max(200px, calc(100vh - 392px))';
// Action cũ của RESTlet từng trả lỗi phân quyền ở khóa error / errorVi (không ném): đổi thành lỗi
const guard = (r) => {
	if (r && r.error) throw {message: serverText(r.error, r.errorVi)};
	return r;
};
const dueTone = (x) => (x.overdue ? 'error' : x.daysLeft <= 7 ? 'warn' : 'info');
const arrow = (a, b) => `${a || '-'} -> ${b || '-'}`;

/** Chữ "cũ -> mới" của một thay đổi (quyết định, mốc dòng thời gian); pay = được xem số tiền. */
function changeText(t, c, pay) {
	const parts = [];
	if (c.deptNew) parts.push(`${t.tl.department}: ${arrow(c.deptOld, c.deptNew)}`);
	if (c.titleNew) parts.push(`${t.tl.title}: ${arrow(c.titleOld, c.titleNew)}`);
	if (pay) {
		if (!blank(c.payNew)) parts.push(`${t.tl.salaryWord}: ${blank(c.payOld) ? money(c.payNew) : arrow(money(c.payOld), money(c.payNew))}`);
		if (!blank(c.ins)) parts.push(t.tl.insWage(money(c.ins)));
		if (!blank(c.allow)) parts.push(t.tl.allowance(money(c.allow)));
	}
	return parts.join('; ');
}

function eventView(t, ev, pay) {
	const type = t.contractType[ev.code] || '';
	const join = (list) => list.filter((x) => !blank(x)).join(', ');
	switch (ev.kind) {
		case 'hire':
			return {title: t.tl.hire, detail: ''};
		case 'leave':
			return {title: t.tl.leave, detail: ''};
		case 'contract':
			return {title: t.tl.contract(type, ev.ref), detail: join([ev.to ? t.tl.until(fmtDate(ev.to)) : ev.code === 'U' ? t.openEnded : '', ev.title, pay && ev.amount ? t.tl.pay(money(ev.amount)) : ''])};
		case 'appendix':
			return {title: t.tl.appendix(ev.ref, ev.parentRef), detail: join([ev.title, pay && ev.amount ? t.tl.pay(money(ev.amount)) : ''])};
		case 'contractEnd':
			return {title: t.tl.contractEnd(type, ev.ref), detail: ''};
		case 'contractTerminated':
			return {title: t.tl.contractTerminated(type, ev.ref), detail: ev.reason || ''};
		case 'decision':
			return {
				title: t.tl.decision(t.decisionType[ev.code] || '', ev.ref),
				detail: changeText(t, {deptOld: ev.oldDepartmentName, deptNew: ev.newDepartmentName, titleOld: ev.oldTitle, titleNew: ev.newTitle, payOld: ev.previous, payNew: ev.amount, ins: ev.insuranceWage, allow: ev.allowance}, pay),
			};
		case 'salary':
			return {title: t.tl.salary, detail: changeText(t, {payOld: ev.previous, payNew: ev.amount, ins: ev.insuranceWage, allow: ev.allowance}, pay)};
		case 'dependent':
			return {title: t.tl.dependent(ev.ref || ''), detail: ev.relationship || ''};
		case 'dependentEnd':
			return {title: t.tl.dependentEnd(ev.ref || ''), detail: ''};
		case 'permit':
			return {title: t.tl.permit(ev.ref || ''), detail: ''};
		case 'permitExpiry':
			return {title: t.tl.permitExpiry(ev.ref || ''), detail: ''};
		default:
			return {title: str(ev.kind), detail: ''};
	}
}

const newProfileRecord = (boot) => {
	try {
		window.open(url.resolveRecord({recordType: (boot.recordTypes || {}).employee, isEditMode: true}), '_blank');
	} catch (e) {
		// không mở được form NetSuite: bỏ qua
	}
};

// ------------------------------------------------------------------ danh sách

function EmployeeList({app}) {
	const t = pick(TEXT);
	const boot = app.boot || {};
	const subsidiary = app.subsidiary || '';
	const [typing, setTyping] = useState('');
	const [query, setQuery] = useState('');
	const [filter, setFilter] = useState('all');
	const [page, setPage] = useState(1);
	const [sort, setSort] = useState('code');
	const [days, setDays] = useState(30);
	const [data, setData] = useState(null);
	const [due, setDue] = useState(null);
	const [dueFind, setDueFind] = useState('');
	const [tick, setTick] = useState(0);
	const alive = useRef(true);
	const request = useRef(0);
	const timer = useRef(null);
	const dueKey = useRef('');

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			if (timer.current) clearTimeout(timer.current);
		};
	}, []);

	useEffect(() => {
		if (!subsidiary) return;
		request.current += 1;
		const mine = request.current;
		// Khung sắp đến hạn chỉ hỏi lại khi đổi công ty con, khoảng ngày hoặc bấm tải lại; gõ tìm và lật trang không hỏi lại
		const key = `${subsidiary}|${days}|${tick}`;
		const wantDue = dueKey.current !== key;
		const params = {action: 'employeesPage', subsidiary, q: query, filter, page, pageSize: 50, sort, days};
		if (wantDue) params.due = '1';
		app.run(t.loading, call(params)).then((r) => {
			if (!alive.current || mine !== request.current || !r) return;
			setData(r);
			if (wantDue) {
				dueKey.current = key;
				setDue(r.due || {items: [], total: 0, failed: true});
			}
		});
	}, [subsidiary, query, filter, page, sort, days, tick]);

	// Gõ là tìm phía máy chủ, trễ 300 ms để không gọi theo từng phím
	const onType = (v) => {
		setTyping(v);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			if (!alive.current) return;
			setPage(1);
			setQuery(String(v || '').trim());
		}, 300);
	};
	const pickFilter = (v) => {
		setPage(1);
		setFilter(v);
	};
	const pickSort = (v) => {
		setPage(1);
		setSort(v || 'code');
	};

	const d = data || {rows: [], counts: {}, total: 0, page: 1, pages: 1, pageSize: 50, notes: []};
	const pay = !!d.canSeePay;
	const rows = (d.rows || []).map((r) => Object.assign({}, r, {id: r.employee}));
	const chips = Object.keys(t.filters).map((k) => ({value: k, label: t.filters[k], count: data && d.counts ? d.counts[k] : undefined, tone: k === 'expiring' && d.counts && d.counts.expiring ? 'warn' : ''}));
	const statusOf = (r) => {
		const tags = [];
		if (r.left) tags.push({text: t.status.left, tone: 'muted'});
		else if (r.probation) tags.push({text: t.status.probation, tone: 'info'});
		else tags.push({text: t.status.working, tone: 'ok'});
		if (!r.left) {
			if (!r.hasProfile) tags.push({text: t.status.noProfile, tone: 'warn'});
			if (r.missingTax) tags.push({text: t.status.noTax, tone: 'warn'});
			if (r.missingBank) tags.push({text: t.status.noBank, tone: 'warn'});
		}
		return tags;
	};
	const expiryCell = (r) => {
		const c = r.contract;
		if (!c) return '';
		if (!c.expiry) return <span class="s4vp-muted">{c.type === 'U' ? t.openEnded : ''}</span>;
		const left = Math.round((Date.parse(c.expiry) - Date.parse(d.today || c.expiry)) / 86400000);
		const soon = !r.left && c.state !== 'T' && left <= (d.days || 30);
		return (
			<span class="s4vp-hr-tags s4vp-hr-nw">
				<span>{fmtDate(c.expiry)}</span>
				{soon ? <Badge text={t.due.left(left)} tone={left < 0 ? 'error' : 'warn'} /> : null}
			</span>
		);
	};
	const columns = [
		{key: 'code', label: t.cols.code, nowrap: true, render: (r) => <span class="s4vp-link">{r.code}</span>},
		{key: 'name', label: t.cols.name, render: (r) => (
			<span class="s4vp-hr-name s4vp-hr-nw">
				<b>{r.name}</b>
				{r.jobTitle ? <span>{r.jobTitle}</span> : null}
			</span>
		)},
		{key: 'department', label: t.cols.department},
		{key: 'employmentType', label: t.cols.employment, nowrap: true, render: (r) => t.empType[r.employmentType] || ''},
		{key: 'contract', label: t.cols.contract, render: (r) => (r.contract ? (
			<span class="s4vp-hr-name">
				<b>{t.contractType[r.contract.type] || ''}</b>
				<span>{[r.contract.number, r.contract.state !== 'A' ? t.contractState[r.contract.state] : ''].filter(Boolean).join(' - ')}</span>
			</span>
		) : '')},
		{key: 'expiry', label: t.cols.expiry, nowrap: true, render: expiryCell},
		pay ? {key: 'baseSalary', label: t.cols.salary, type: 'money', nowrap: true} : null,
		{key: 'status', label: t.cols.status, render: (r) => <span class="s4vp-hr-tags">{statusOf(r).map((x, i) => <Badge key={`s${i}`} text={x.text} tone={x.tone} />)}</span>},
	];

	const first = d.total ? (d.page - 1) * d.pageSize + 1 : 0;
	const last = Math.min(d.total || 0, d.page * d.pageSize);
	const dueAll = (due && due.items) || [];
	const dueShown = quickFilter(dueAll.map((x) => Object.assign({}, x, {kindText: t.due.kind[x.kind] || '', dateText: fmtDate(x.date)})), dueFind).rows;
	const notes = (d.notes || []).map((n) => t.notes[n]).filter(Boolean);

	return (
		<Page>
			<div class="s4vp-hr">
				<PageHeader
					title={t.title}
					sub={subsidiary ? t.sub : t.noSubsidiary}
					actions={[
						<Button label={t.legacy} kind="ghost" onClick={() => app.go('profiles')} />,
						<Button label={t.refresh} onClick={() => setTick(tick + 1)} />,
						<Button label={t.newProfile} kind="primary" disabled={!subsidiary} onClick={() => newProfileRecord(boot)} />,
					]}
				/>
				<div class="s4vp-hr-find">
					<TextInput type="search" value={typing} onInput={onType} placeholder={t.findHint} ariaLabel={t.findHint} />
					<Chips items={chips} value={filter} onPick={pickFilter} label={t.filterLabel} />
				</div>
				{notes.length ? <div class="s4vp-hr-note">{notes.join(' ')}</div> : null}
				<div class="s4vp-cols">
					<div class="s4vp-col-main">
						<Card flush={true} label={t.title}>
							<Table
								columns={columns}
								rows={rows}
								keyOf={(r) => r.employee}
								onRowClick={(r) => app.go('employee', {id: r.employee})}
								empty={data || !app.busy ? t.empty : t.loading}
								maxHeight={LIST_HEIGHT}
								label={t.title}
							/>
							<div class="s4vp-hr-pager">
								<span>{d.total ? t.pager.range(num(first), num(last), num(d.total)) : t.pager.none}</span>
								<span class="s4vp-hr-pager-nav">
									<Select value={sort} onInput={pickSort} options={Object.keys(t.sorts).map((k) => ({value: k, label: t.sorts[k]}))} ariaLabel={t.sortLabel} width={190} />
									<Button small={true} label={`‹ ${t.pager.prev}`} disabled={d.page <= 1 || !!app.busy} onClick={() => setPage(d.page - 1)} />
									<span>{t.pager.page(d.page, d.pages)}</span>
									<Button small={true} label={`${t.pager.next} ›`} disabled={d.page >= d.pages || !!app.busy} onClick={() => setPage(d.page + 1)} />
								</span>
							</div>
						</Card>
					</div>
					<div class="s4vp-col-side s4vp-hr-side">
						<SidePanel title={t.due.title} sub={due ? t.due.sub(due.total || 0) : ''}>
							<div class="s4vp-hr-side-ctl">
								<Select value={String(days)} onInput={(v) => setDays(Number(v) || 30)} options={DAY_OPTIONS.map((n) => ({value: String(n), label: t.due.days(n)}))} ariaLabel={t.due.daysLabel} width={150} />
								<TextInput type="search" value={dueFind} onInput={setDueFind} placeholder={t.due.find} ariaLabel={t.due.find} />
							</div>
							{due && due.failed ? <div class="s4vp-hr-note">{t.due.failed}</div> : null}
							{dueShown.length ? (
								<div class="s4vp-hr-due">
									{dueShown.map((x) => (
										<button key={`${x.kind}${x.id}`} type="button" class="s4vp-hr-due-item" onClick={() => app.go('employee', {id: x.employee, tab: x.kind === 'permitExpiry' ? 'permits' : 'contracts'})}>
											<span class="s4vp-hr-due-who">
												<b>{`${x.employeeCode} ${x.employeeName}`.trim()}</b>
												<span>{[x.kindText, x.ref].filter(Boolean).join(' - ')}</span>
											</span>
											<span class="s4vp-hr-due-when">
												<span>{x.dateText}</span>
												<Badge text={t.due.left(x.daysLeft)} tone={dueTone(x)} />
											</span>
										</button>
									))}
								</div>
							) : (
								<Empty text={due ? (dueAll.length ? t.card.noMatch : t.due.empty) : t.loading} />
							)}
							{due && due.total > dueAll.length ? <div class="s4vp-hr-note">{t.due.more(due.total - dueAll.length)}</div> : null}
						</SidePanel>
					</div>
				</div>
			</div>
		</Page>
	);
}

// ------------------------------------------------------------------ hồ sơ một người

function EmployeeCard({app, id}) {
	const t = pick(TEXT);
	const boot = app.boot || {};
	const params = (app.route && app.route.params) || {};
	const [data, setData] = useState(null);
	const [failed, setFailed] = useState(false);
	const [tab, setTab] = useState(params.tab || 'overview');
	const [dlg, setDlg] = useState(null);
	const formRef = useRef({});
	const [form, setForm] = useState({});
	const [errs, setErrs] = useState({});
	const [saving, setSaving] = useState(false);
	const [lookups, setLookups] = useState(null);
	const [sel, setSel] = useState({});
	const [tlFind, setTlFind] = useState('');
	const alive = useRef(true);
	const request = useRef(0);

	const load = () => {
		request.current += 1;
		const mine = request.current;
		return app.run(t.loading, call({action: 'employeeCard', id})).then((r) => {
			if (!alive.current || mine !== request.current) return;
			if (!r) {
				setFailed(true);
				return;
			}
			setFailed(false);
			setData(r);
		});
	};

	useEffect(() => {
		alive.current = true;
		load();
		return () => {
			alive.current = false;
		};
	}, [id]);

	const back = {label: t.card.back, onClick: () => app.go('employees')};
	if (!data) {
		return (
			<Page>
				<PageHeader back={back} title={t.title} />
				<Card>
					<Empty text={failed ? t.card.notFound : t.loading} />
				</Card>
			</Page>
		);
	}

	const emp = data.employee || {};
	const prof = data.profile;
	const pay = !!data.canSeePay;
	const canEdit = !!data.canEdit;
	const today = data.today || '';
	const comp = (data.compensation && data.compensation.current) || null;
	const contracts = data.contracts || [];
	const current = contracts.find((c) => c.id === data.currentContract) || null;
	const left = emp.inactive || !!(prof && prof.termination_date && prof.termination_date < today);
	const busy = saving || !!app.busy;

	// -------------------------------------------------------------- form và hộp thoại
	const setField = (k) => (v) => {
		formRef.current = Object.assign({}, formRef.current, {[k]: v});
		setForm(formRef.current);
	};
	const open = (kind, ctx, values) => {
		formRef.current = Object.assign({}, values);
		setForm(formRef.current);
		setErrs({});
		setSaving(false);
		setDlg(Object.assign({kind}, ctx || {}));
	};
	const close = () => setDlg(null);
	const ensureLookups = () => {
		if (lookups) return;
		call({action: 'hrLookups', subsidiary: emp.subsidiary || app.subsidiary || ''}).then(
			(r) => alive.current && setLookups(r || {}),
			() => alive.current && setLookups({})
		);
	};
	const warnText = (r) => ((r && r.warnings) || []).map((w) => serverText(w.message, w.messageVi)).filter(Boolean).join(' ');
	// Gửi từ hộp thoại: lỗi máy chủ hiện ngay trong hộp thoại (dải thông báo của khung nằm sau lớp phủ)
	const submit = (body, done) => {
		setSaving(true);
		setErrs({});
		post(body).then(guard).then(
			(r) => {
				if (!alive.current) return;
				setSaving(false);
				setDlg(null);
				const w = warnText(r);
				app.notify(w ? `${done} ${w}` : done, w ? 'warn' : 'ok');
				load();
			},
			(e) => {
				if (!alive.current) return;
				setSaving(false);
				setErrs({server: errorText(e)});
			}
		);
	};
	// Thao tác một bước (sau hộp xác nhận)
	const act = (body, done) =>
		app.run(t.working, post(body).then(guard)).then((r) => {
			if (!r || !alive.current) return;
			const w = warnText(r);
			app.notify(w ? `${done} ${w}` : done, w ? 'warn' : 'ok');
			load();
		});

	const reqDate = (e, k, required) => {
		const v = formRef.current[k];
		if (blank(v)) {
			if (required) e[k] = t.err.required;
		} else if (!isIso(v)) e[k] = t.err.date;
	};
	const reqNum = (e, k, required) => {
		const v = formRef.current[k];
		if (blank(v)) {
			if (required) e[k] = t.err.required;
			return;
		}
		const n = toNumber(v);
		if (n === null) e[k] = t.err.number;
		else if (n < 0) e[k] = t.err.negative;
	};
	const reqText = (e, k) => {
		if (blank(formRef.current[k]) || !String(formRef.current[k]).trim()) e[k] = t.err.required;
	};
	const fails = (e) => {
		if (!Object.keys(e).length) return false;
		setErrs(Object.assign({server: t.err.fix}, e));
		return true;
	};
	const numOrNull = (k) => (blank(formRef.current[k]) ? null : toNumber(formRef.current[k]));
	const F = (k, label, control, hint) => (
		<Field label={label} hint={errs[k] ? <span class="s4vp-hr-err">{errs[k]}</span> : hint}>
			{control}
		</Field>
	);
	const txt = (k, extra) => <TextInput value={str(form[k])} onInput={setField(k)} {...(extra || {})} />;
	const dat = (k, extra) => <DateInput value={str(form[k])} onInput={setField(k)} {...(extra || {})} />;
	const amt = (k, extra) => <NumberInput value={str(form[k])} onInput={setField(k)} {...(extra || {})} />;
	const dialogActions = (buttons) => [<Button label={t.act.cancel} onClick={close} disabled={saving} />].concat(buttons);
	const serverBox = errs.server ? <div class="s4vp-hr-errbox" role="alert">{errs.server}</div> : null;

	// -------------------------------------------------------------- điều chỉnh lương, quyết định
	const openRaise = () => open('raise', null, {number: '', sign_date: '', effective: today, new_salary: '', new_ins_wage: '', new_allowance: '', note: ''});
	const openDecision = (d) => {
		ensureLookups();
		if (d) {
			open('decision', {id: d.id}, {
				type: d.type || 'T', number: str(d.number), sign_date: str(d.sign_date), effective: str(d.effective), new_department: str(d.new_department), new_title: str(d.new_title),
				new_salary: str(d.new_salary), new_ins_wage: str(d.new_ins_wage), new_allowance: str(d.new_allowance), note: str(d.note),
			});
		} else open('decision', null, {type: 'T', number: '', sign_date: '', effective: today, new_department: '', new_title: '', new_salary: '', new_ins_wage: '', new_allowance: '', note: ''});
	};
	const saveDecision = (apply) => {
		const v = formRef.current;
		const isRaise = dlg.kind === 'raise';
		const type = isRaise ? 'S' : v.type;
		const e = {};
		reqDate(e, 'effective', true);
		reqDate(e, 'sign_date', false);
		const orgType = ['H', 'T', 'P'].indexOf(type) >= 0;
		// Vai trò không xem được lương thì không nhập được lương (ô lương không hiện)
		const payType = pay && (orgType || type === 'S');
		if (payType) {
			reqNum(e, 'new_salary', false);
			reqNum(e, 'new_ins_wage', false);
			reqNum(e, 'new_allowance', false);
		}
		if (type === 'S' && blank(v.new_salary) && blank(v.new_ins_wage) && blank(v.new_allowance)) e.new_salary = t.err.needOne;
		if ((type === 'T' || type === 'P') && blank(v.new_department) && blank(v.new_title) && blank(v.new_salary) && blank(v.new_ins_wage) && blank(v.new_allowance)) e.new_department = t.err.needChange;
		if (fails(e)) return;
		const values = {employee: emp.id, type, number: v.number || '', sign_date: v.sign_date || '', effective: v.effective, note: v.note || ''};
		if (dlg.id) values.id = dlg.id;
		values.new_department = orgType ? v.new_department || '' : '';
		values.new_title = orgType ? v.new_title || '' : '';
		if (pay) {
			values.new_salary = payType ? numOrNull('new_salary') : null;
			values.new_ins_wage = payType ? numOrNull('new_ins_wage') : null;
			values.new_allowance = payType ? numOrNull('new_allowance') : null;
		}
		submit({action: 'hrSaveDecision', values, apply: !!apply}, apply ? t.done.applied : t.done.decision);
	};
	const applyDecision = (d) => app.confirm(t.confirm.apply(d.number), () => act({action: 'hrApplyDecision', id: d.id}, t.done.applied));

	// -------------------------------------------------------------- hợp đồng
	const contractBlank = () => ({number: '', type: 'F', sign_date: '', effective: today, expiry: '', title: data.title || '', base_salary: pay && comp ? str(comp.base_salary) : '', insurance_wage: pay && comp ? str(comp.insurance_wage) : '', note: ''});
	const openContract = (mode, c) => {
		if (mode === 'new') open('contract', {mode}, contractBlank());
		else if (mode === 'appendix') open('contract', {mode, parent: c.id, parentNumber: c.number}, {number: '', sign_date: '', effective: today, title: '', base_salary: '', insurance_wage: '', note: ''});
		else if (mode === 'renew') {
			open('contract', {mode}, Object.assign(contractBlank(), {type: c.type === 'P' ? 'F' : c.type || 'F', effective: nextDay(c.expiry) || today, title: str(c.title) || data.title || '', base_salary: str(c.base_salary), insurance_wage: str(c.insurance_wage)}));
		} else {
			open('contract', {mode: 'edit', id: c.id, approved: c.status !== 'D', parent: c.parent || '', parentNumber: c.parentNumber}, {
				number: str(c.number), type: c.type || 'F', sign_date: str(c.sign_date), effective: str(c.effective), expiry: str(c.expiry), title: str(c.title), base_salary: str(c.base_salary),
				insurance_wage: str(c.insurance_wage), note: str(c.note),
			});
		}
	};
	const saveContract = (activate) => {
		const v = formRef.current;
		const appendix = !!dlg.parent;
		const e = {};
		reqDate(e, 'sign_date', false);
		let values = {number: v.number || '', sign_date: v.sign_date || '', note: v.note || ''};
		if (!dlg.approved) {
			reqDate(e, 'effective', true);
			if (pay) {
				reqNum(e, 'base_salary', false);
				reqNum(e, 'insurance_wage', false);
			}
			if (!appendix && v.type !== 'U') {
				reqDate(e, 'expiry', v.type === 'P' || v.type === 'F');
				if (!e.expiry && !e.effective && !blank(v.expiry) && v.expiry < v.effective) e.expiry = t.err.endBeforeStart;
			}
			values = Object.assign(values, {employee: emp.id, effective: v.effective, title: v.title || ''});
			if (pay) Object.assign(values, {base_salary: numOrNull('base_salary'), insurance_wage: numOrNull('insurance_wage')});
			if (appendix) values.parent = dlg.parent;
			else Object.assign(values, {type: v.type, expiry: v.type === 'U' ? '' : v.expiry || ''});
		}
		if (fails(e)) return;
		if (dlg.id) values.id = dlg.id;
		submit({action: 'hrSaveContract', values, activate: !!activate}, activate ? t.done.activated : t.done.contract);
	};
	const activateContract = (c) => app.confirm(t.confirm.activate(c.number), () => act({action: 'hrActivateContract', id: c.id}, t.done.activated));
	const openTerminate = (c) => open('terminate', {id: c.id, number: c.number, effective: c.effective, expiry: c.expiry}, {date: c.expiry && c.expiry < today ? c.expiry : today, reason: ''});
	const saveTerminate = () => {
		const e = {};
		reqDate(e, 'date', true);
		if (fails(e)) return;
		submit({action: 'hrTerminateContract', id: dlg.id, date: formRef.current.date, reason: formRef.current.reason || ''}, t.done.terminated);
	};

	// -------------------------------------------------------------- người phụ thuộc
	const openDependent = (d, ending) => {
		if (d) open('dependent', {id: d.id}, {name: str(d.name), relationship: str(d.relationship), birth_date: str(d.birth_date), tax_code: '', from: str(d.from), to: ending && !d.to ? today : str(d.to)});
		else open('dependent', null, {name: '', relationship: '', birth_date: '', tax_code: '', from: today, to: ''});
	};
	const saveDependent = () => {
		const v = formRef.current;
		const e = {};
		reqText(e, 'name');
		reqDate(e, 'from', true);
		reqDate(e, 'to', false);
		reqDate(e, 'birth_date', false);
		if (!e.to && !e.from && !blank(v.to) && v.to < v.from) e.to = t.err.endBeforeStart;
		if (fails(e)) return;
		const values = {name: String(v.name).trim(), relationship: v.relationship || '', birth_date: v.birth_date || '', tax_code: v.tax_code || '', from: v.from, to: v.to || ''};
		if (dlg.id) values.id = dlg.id;
		submit({action: 'hrSaveDependent', employee: emp.id, values}, t.done.dependent);
	};

	// -------------------------------------------------------------- phân bổ chi phí
	const openAllocLines = (v) => {
		ensureLookups();
		open('allocLines', {id: v.id, nbr: v.versionNbr}, {
			reason: str(v.reason),
			lines: (v.lines || []).map((l) => ({project: str(l.project), department: str(l.sub), location: str(l.branch), work_center: str(l.workCenter), percent: str(l.percent)})),
		});
	};
	const setLine = (i, k) => (v) => {
		const lines = (formRef.current.lines || []).map((l, j) => (j === i ? Object.assign({}, l, {[k]: v}) : l));
		setField('lines')(lines);
	};
	const addLine = () => setField('lines')((formRef.current.lines || []).concat([{project: '', department: '', location: '', work_center: '', percent: ''}]));
	const removeLine = (i) => setField('lines')((formRef.current.lines || []).filter((l, j) => j !== i));
	const saveAllocLines = () => {
		const lines = formRef.current.lines || [];
		const e = {};
		lines.forEach((l, i) => {
			const n = toNumber(l.percent);
			if (n === null || !(n > 0) || n > 100) e[`line${i}`] = t.err.percent;
		});
		if (fails(e)) return;
		submit({action: 'saveAllocLines', id: dlg.id, reason: formRef.current.reason || '', lines: lines.map((l) => ({project: l.project || '', department: l.department || '', location: l.location || '', work_center: l.work_center || '', percent: toNumber(l.percent)}))}, t.done.alloc);
	};
	const saveAllocActivate = () => {
		const e = {};
		reqDate(e, 'effective', true);
		if (fails(e)) return;
		submit({action: 'activateAllocVersion', id: dlg.id, effective: formRef.current.effective}, t.done.allocActivated);
	};

	// -------------------------------------------------------------- giấy phép lao động
	const openPermit = () => open('permit', null, {doc_type: 'P', issue_type: 'N', authority: '', effective: today, expiry: '', job: '', title: data.title || '', work_location: '', passport: '', passport_expiry: ''});
	const savePermit = () => {
		const v = formRef.current;
		const e = {};
		reqDate(e, 'effective', true);
		reqDate(e, 'expiry', true);
		reqDate(e, 'passport_expiry', false);
		if (!e.expiry && !e.effective && v.expiry < v.effective) e.expiry = t.err.endBeforeStart;
		if (fails(e)) return;
		submit({action: 'saveWorkPermit', values: {employee: emp.id, doc_type: v.doc_type, issue_type: v.issue_type, authority: v.authority || '', effective: v.effective, expiry: v.expiry, job: v.job || null, title: v.title || '', work_location: v.work_location || '', passport: v.passport || '', passport_expiry: v.passport_expiry || null}}, t.done.permit);
	};
	const savePermitIssue = () => {
		const e = {};
		reqDate(e, 'issued', true);
		if (dlg.docType !== 'E') reqText(e, 'permitNo');
		if (fails(e)) return;
		submit({action: 'workPermitAction', id: dlg.id, op: 'issue', permitNo: formRef.current.permitNo || '', issued: formRef.current.issued}, t.done.permitOp);
	};
	const permitOp = (w, op) => act({action: 'workPermitAction', id: w.id, op}, t.done.permitOp);

	// -------------------------------------------------------------- phần hiển thị
	const pickRow = (k) => (r) => setSel(Object.assign({}, sel, {[k]: r.id}));
	const selected = (k, list) => list.find((r) => String(r.id) === String(sel[k])) || null;
	const bar = (buttons) => <div class="s4vp-hr-bar">{buttons.filter(Boolean).map((b, i) => <span key={`b${i}`} style={{display: 'contents'}}>{b}</span>)}</div>;
	const sm = (label, onClick, kind, disabled) => <Button small={true} label={label} kind={kind} disabled={disabled || busy} onClick={onClick} />;

	const statusBadge = left ? {text: t.status.left, tone: 'muted'} : !prof ? {text: t.status.noProfile, tone: 'warn'} : current && current.type === 'P' ? {text: t.status.probation, tone: 'info'} : {text: t.status.working, tone: 'ok'};
	const missing = prof ? [!prof.hasTaxCode && t.status.noTax, !prof.hasPersonalId && t.status.noId, !prof.hasSiNumber && t.status.noSi, !prof.hasBank && t.status.noBank].filter(Boolean) : [];
	const activeDeps = (data.dependents || []).filter((x) => x.active).length;
	const deptName = (prof && prof.departmentName) || emp.departmentName || '';
	const fact = (label, value) => (
		<div class="s4vp-hr-fact">
			<span class="s4vp-hr-fact-l">{label}</span>
			<span class="s4vp-hr-fact-v">{blank(value) ? '-' : value}</span>
		</div>
	);
	const contractFact = current ? `${t.contractType[current.type] || ''}${current.expiry ? ` - ${t.tl.until(fmtDate(current.expiry))}` : ''}` : t.card.none;

	const dueItems = data.due || [];
	const dueList = dueItems.length ? (
		<div class="s4vp-hr-due">
			{dueItems.map((x) => {
				const c = contracts.find((k) => k.id === x.id);
				return (
					<div key={`${x.kind}${x.id}`} class="s4vp-hr-due-item s4vp-hr-due-static">
						<span class="s4vp-hr-due-who">
							<b>{[t.due.kind[x.kind] || '', x.ref].filter(Boolean).join(' - ')}</b>
							<span>{fmtDate(x.date)}</span>
						</span>
						<span class="s4vp-hr-due-when">
							<Badge text={t.due.left(x.daysLeft)} tone={dueTone(x)} />
							{x.kind === 'permitExpiry' ? sm(t.due.view, () => setTab('permits'), 'link') : canEdit && c ? sm(t.due.renew, () => openContract('renew', c), 'link') : sm(t.due.view, () => setTab('contracts'), 'link')}
						</span>
					</div>
				);
			})}
		</div>
	) : (
		<Empty text={t.card.dueEmpty} />
	);

	const renderOverview = () => {
		const events = (data.timeline || []).map((ev, i) => {
			const v = eventView(t, ev, pay);
			return {key: `e${i}`, date: ev.date, dateText: fmtDate(ev.date), title: v.title, detail: v.detail, draft: !!ev.draft, future: !!ev.future};
		});
		const shown = quickFilter(events, tlFind).rows;
		return (
			<div class="s4vp-cols">
				<div class="s4vp-col-main">
					<Card flush={true} title={t.card.timeline} actions={[<TextInput type="search" value={tlFind} onInput={setTlFind} placeholder={t.card.timelineFind} ariaLabel={t.card.timelineFind} width={240} />]}>
						{shown.length ? (
							<div class="s4vp-hr-tl">
								{shown.map((ev) => (
									<div key={ev.key} class={ev.draft || ev.future ? 's4vp-hr-tl-row s4vp-hr-tl-soft' : 's4vp-hr-tl-row'}>
										<span class="s4vp-hr-tl-date">{ev.dateText}</span>
										<span class="s4vp-hr-tl-text">
											<b>{ev.title}</b>
											{ev.detail ? <span>{ev.detail}</span> : null}
										</span>
										<span class="s4vp-hr-tags">
											{ev.draft ? <Badge text={t.card.draft} tone="muted" /> : null}
											{ev.future && !ev.draft ? <Badge text={t.card.future} tone="info" /> : null}
										</span>
									</div>
								))}
							</div>
						) : (
							<Empty text={events.length ? t.card.noMatch : t.card.timelineEmpty} />
						)}
					</Card>
				</div>
				<div class="s4vp-col-side">
					<SidePanel title={t.due.title} sub={t.due.days(data.days || 30)}>
						{dueList}
						{missing.length ? <div class="s4vp-hr-tags">{missing.map((m, i) => <Badge key={`m${i}`} text={m} tone="warn" />)}</div> : null}
					</SidePanel>
				</div>
			</div>
		);
	};

	const renderPay = () => {
		if (!pay) {
			return (
				<Card>
					<Empty text={t.card.payHidden} />
				</Card>
			);
		}
		const history = (data.compensation.history || []).map((h) => Object.assign({}, h, {effectiveText: fmtDate(h.effective)}));
		const line = (label, value) => (
			<div class="s4vp-line">
				<span class="s4vp-muted">{label}</span>
				<b class="s4vp-num">{value}</b>
			</div>
		);
		return (
			<div class="s4vp-cols">
				<div class="s4vp-col-main">
					<Card flush={true} title={t.card.payHistory}>
						<Table
							columns={[
								{key: 'effective', label: t.cols.effective, type: 'date', nowrap: true},
								{key: 'base_salary', label: t.cols.salary, type: 'money', nowrap: true},
								{key: 'insurance_wage', label: t.cols.insWage, type: 'money', nowrap: true},
								{key: 'allowance', label: t.cols.allowance, type: 'money', nowrap: true},
								{key: 'packageName', label: t.cols.package},
							]}
							rows={history}
							selectedKey={comp ? comp.id : null}
							empty={t.card.noPay}
							search={true}
							searchPlaceholder={t.card.find}
							maxHeight={TAB_HEIGHT}
						/>
					</Card>
				</div>
				<div class="s4vp-col-side">
					<SidePanel title={t.card.currentPay} sub={comp ? t.card.currentPaySub(fmtDate(comp.effective)) : t.card.noPay} actions={canEdit && prof ? [<Button small={true} kind="primary" label={t.act.raise} disabled={busy} onClick={openRaise} />] : null}>
						{comp ? (
							<div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
								{line(t.cols.salary, money(comp.base_salary))}
								{line(t.cols.insWage, money(comp.insurance_wage))}
								{line(t.cols.allowance, money(comp.allowance))}
								{comp.packageName ? line(t.cols.package, comp.packageName) : null}
							</div>
						) : null}
					</SidePanel>
				</div>
			</div>
		);
	};

	const renderContracts = () => {
		const rows = contracts.map((c) => Object.assign({}, c, {
			typeText: c.isAppendix ? t.appendixOf(c.parentNumber) : t.contractType[c.type] || '',
			stateText: `${t.contractState[c.state] || ''}${c.future ? ` - ${t.upcoming}` : ''}`,
			toText: c.status === 'T' && c.terminated ? fmtDate(c.terminated) : c.expiry ? fmtDate(c.expiry) : !c.isAppendix && c.type === 'U' ? t.openEnded : '',
		}));
		const c = selected('contract', rows);
		const main = c && !c.isAppendix;
		const openRec = c ? sm(t.card.openRecord, () => openRecord('customrecord_s4vp_contract', c.id), 'ghost') : null;
		const tools = canEdit ? bar([
			sm(t.act.addContract, () => openContract('new'), 'primary'),
			c ? sm(t.act.edit, () => openContract('edit', c)) : null,
			c && c.status === 'D' ? sm(t.act.activate, () => activateContract(c)) : null,
			main && c.status === 'A' ? sm(t.act.addAppendix, () => openContract('appendix', c)) : null,
			main && c.status !== 'D' && c.expiry ? sm(t.act.renew, () => openContract('renew', c)) : null,
			main && c.status === 'A' ? sm(t.act.terminate, () => openTerminate(c), 'danger') : null,
			openRec,
		]) : c ? bar([openRec]) : null;
		return (
			<Card flush={true} label={t.card.tabs.contracts}>
				<Table
					columns={[
						{key: 'number', label: t.cols.number, nowrap: true, render: (r) => <span class="s4vp-link">{r.number || `#${r.id}`}</span>},
						{key: 'typeText', label: t.cols.type},
						{key: 'sign_date', label: t.cols.signDate, type: 'date', nowrap: true},
						{key: 'effective', label: t.cols.effective, type: 'date', nowrap: true},
						{key: 'toText', label: t.cols.to, nowrap: true},
						{key: 'title', label: t.cols.title},
						pay ? {key: 'base_salary', label: t.cols.contractSalary, type: 'money', nowrap: true} : null,
						{key: 'stateText', label: t.cols.status, nowrap: true, render: (r) => <Badge text={r.stateText} tone={r.future ? 'info' : CONTRACT_TONE[r.state] || 'muted'} />},
						{key: 'note', label: t.cols.note},
					]}
					rows={rows}
					onRowClick={pickRow('contract')}
					selectedKey={sel.contract}
					empty={t.card.none}
					search={true}
					searchPlaceholder={t.card.find}
					toolbar={tools}
					maxHeight={TAB_HEIGHT}
				/>
				<div class="s4vp-hr-pager">
					<span>{c ? t.card.attach : t.card.pickRow}</span>
				</div>
			</Card>
		);
	};

	const renderDecisions = () => {
		const rows = (data.decisions || []).map((d) => Object.assign({}, d, {
			typeText: t.decisionType[d.type] || '',
			statusText: t.decisionStatus[d.status] || t.decisionStatus.D,
			change: changeText(t, {deptOld: d.oldDepartmentName, deptNew: d.newDepartmentName, titleOld: d.old_title, titleNew: d.new_title, payOld: d.old_salary, payNew: d.new_salary, ins: d.new_ins_wage, allow: d.new_allowance}, pay),
		}));
		const d = selected('decision', rows);
		const draft = d && d.status !== 'A';
		const openRec = d ? sm(t.card.openRecord, () => openRecord('customrecord_s4vp_decision', d.id), 'ghost') : null;
		const tools = canEdit ? bar([
			sm(t.act.addDecision, () => openDecision(null), 'primary'),
			prof && pay ? sm(t.act.raise, openRaise) : null,
			draft ? sm(t.act.edit, () => openDecision(d)) : null,
			draft ? sm(t.act.apply, () => applyDecision(d)) : null,
			openRec,
		]) : d ? bar([openRec]) : null;
		return (
			<Card flush={true} label={t.card.tabs.decisions}>
				<Table
					columns={[
						{key: 'number', label: t.cols.number, nowrap: true, render: (r) => <span class="s4vp-link">{r.number || `#${r.id}`}</span>},
						{key: 'typeText', label: t.cols.type, nowrap: true},
						{key: 'sign_date', label: t.cols.signDate, type: 'date', nowrap: true},
						{key: 'effective', label: t.cols.effective, type: 'date', nowrap: true},
						{key: 'change', label: t.cols.change},
						{key: 'statusText', label: t.cols.status, nowrap: true, render: (r) => <Badge text={r.statusText} tone={r.status === 'A' ? 'ok' : 'muted'} />},
						{key: 'applied_date', label: t.cols.appliedDate, type: 'date', nowrap: true},
						{key: 'note', label: t.cols.note},
					]}
					rows={rows}
					onRowClick={pickRow('decision')}
					selectedKey={sel.decision}
					empty={t.card.none}
					search={true}
					searchPlaceholder={t.card.find}
					toolbar={tools}
					maxHeight={TAB_HEIGHT}
				/>
				<div class="s4vp-hr-pager">
					<span>{d ? t.card.attach : t.card.pickRow}</span>
				</div>
			</Card>
		);
	};

	const renderDependents = () => {
		const rows = (data.dependents || []).map((d) => Object.assign({}, d, {taxText: d.hasTaxCode ? t.yes : t.no, statusText: d.active ? t.contractState.A : t.contractState.X}));
		const d = selected('dependent', rows);
		const tools = canEdit && prof ? bar([
			sm(t.act.addDependent, () => openDependent(null), 'primary'),
			d ? sm(t.act.edit, () => openDependent(d)) : null,
			d && !d.to ? sm(t.act.endDependent, () => openDependent(d, true)) : null,
		]) : null;
		return (
			<Card flush={true} label={t.card.tabs.dependents}>
				<Table
					columns={[
						{key: 'name', label: t.cols.name, render: (r) => <b>{r.name}</b>},
						{key: 'relationship', label: t.cols.relationship},
						{key: 'birth_date', label: t.cols.birthDate, type: 'date', nowrap: true},
						{key: 'taxText', label: t.cols.taxCode, nowrap: true, render: (r) => <Badge text={r.taxText} tone={r.hasTaxCode ? 'ok' : 'warn'} />},
						{key: 'from', label: t.cols.from, type: 'date', nowrap: true},
						{key: 'to', label: t.cols.until, type: 'date', nowrap: true},
						{key: 'statusText', label: t.cols.status, nowrap: true, render: (r) => <Badge text={r.statusText} tone={r.active ? 'ok' : 'muted'} />},
					]}
					rows={rows}
					onRowClick={pickRow('dependent')}
					selectedKey={sel.dependent}
					empty={prof ? t.card.none : t.card.noProfile}
					search={true}
					searchPlaceholder={t.card.find}
					toolbar={tools}
					maxHeight={TAB_HEIGHT}
				/>
			</Card>
		);
	};

	const renderAlloc = () => {
		const versions = (data.allocations || []).slice().sort((a, b) => b.versionNbr - a.versionNbr).map((v) => Object.assign({}, v, {statusText: t.allocStatus[v.status] || '', usedText: v.usedByReleasedBatch ? t.card.used : ''}));
		const v = selected('alloc', versions) || versions.find((x) => x.status === 'A') || versions[0] || null;
		const hasDraft = versions.some((x) => x.status === 'D');
		const draft = v && v.status === 'D' && !v.usedByReleasedBatch;
		const tools = canEdit ? bar([
			sm(t.act.newVersion, () => open('allocNew', null, {reason: ''}), 'primary', hasDraft),
			draft ? sm(t.act.editLines, () => openAllocLines(v)) : null,
			draft ? sm(t.act.activate, () => open('allocActivate', {id: v.id, nbr: v.versionNbr}, {effective: today})) : null,
			draft ? sm(t.act.deleteDraft, () => app.confirm(t.confirm.deleteDraft(v.versionNbr), () => act({action: 'deleteAllocVersion', id: v.id}, t.done.allocDeleted)), 'danger') : null,
		]) : null;
		const lines = v ? (v.lines || []).map((l, i) => Object.assign({}, l, {id: l.id || `l${i}`})) : [];
		const total = lines.length > 1 ? {projectName: t.cols.total, percent: lines.reduce((s, l) => s + (Number(l.percent) || 0), 0)} : null;
		return (
			<div class="s4vp-cols">
				<div class="s4vp-col-main">
					<Card flush={true} label={t.card.tabs.alloc}>
						<Table
							columns={[
								{key: 'versionNbr', label: t.cols.version, nowrap: true, render: (r) => <span class="s4vp-link">{String(r.versionNbr)}</span>},
								{key: 'statusText', label: t.cols.status, nowrap: true, render: (r) => <Badge text={r.statusText} tone={ALLOC_TONE[r.status] || 'muted'} />},
								{key: 'effectiveDate', label: t.cols.effective, type: 'date', nowrap: true},
								{key: 'expirationDate', label: t.cols.to, type: 'date', nowrap: true},
								{key: 'totalPercent', label: t.cols.total, type: 'num', nowrap: true},
								{key: 'reason', label: t.cols.reason, render: (r) => [r.reason, r.usedText].filter(Boolean).join(' - ')},
							]}
							rows={versions}
							onRowClick={pickRow('alloc')}
							selectedKey={v ? v.id : null}
							empty={t.card.allocEmpty}
							search={true}
							searchPlaceholder={t.card.find}
							toolbar={tools}
							maxHeight={TAB_HEIGHT}
						/>
					</Card>
				</div>
				<div class="s4vp-col-side">
					<Card flush={true} title={v ? t.card.allocLines(v.versionNbr) : t.card.allocPick}>
						<Table
							columns={[
								{key: 'projectName', label: t.cols.project},
								{key: 'departmentName', label: t.cols.department},
								{key: 'locationName', label: t.cols.location},
								{key: 'className', label: t.cols.cls},
								{key: 'percent', label: t.cols.percent, type: 'num', nowrap: true},
							]}
							rows={lines}
							total={total}
							empty={t.card.none}
							search={true}
							searchPlaceholder={t.card.find}
							maxHeight={TAB_HEIGHT}
						/>
					</Card>
				</div>
			</div>
		);
	};

	const renderPermits = () => {
		const rows = (data.permits || []).map((w) => Object.assign({}, w, {statusText: t.permitStatus[w.status] || '', issueText: t.permitIssue[w.issue_type] || '', docText: t.permitDoc[w.doc_type] || ''}));
		const w = selected('permit', rows);
		const st = w ? w.status || 'D' : '';
		const tools = canEdit ? bar([
			sm(t.act.addPermit, openPermit, 'primary'),
			st === 'D' ? sm(t.act.submit, () => permitOp(w, 'submit')) : null,
			st === 'D' || st === 'S' ? sm(t.act.issue, () => open('permitIssue', {id: w.id, name: w.name, docType: w.doc_type}, {permitNo: str(w.permit_no), issued: today})) : null,
			st === 'A' || st === 'E' ? sm(t.act.extend, () => permitOp(w, 'extend')) : null,
			st === 'A' ? sm(t.act.revoke, () => app.confirm(t.confirm.revoke(w.permit_no || w.name), () => permitOp(w, 'revoke')), 'danger') : null,
			w ? sm(t.card.openRecord, () => openRecord('customrecord_s4vp_work_permit', w.id), 'ghost') : null,
		]) : null;
		return (
			<Card flush={true} label={t.card.tabs.permits}>
				<Table
					columns={[
						{key: 'name', label: t.cols.number, nowrap: true, render: (r) => <span class="s4vp-link">{r.name || `#${r.id}`}</span>},
						{key: 'docText', label: t.cols.type, nowrap: true},
						{key: 'permit_no', label: t.cols.permitNo, nowrap: true},
						{key: 'issueText', label: t.cols.issue, nowrap: true},
						{key: 'effective', label: t.cols.effective, type: 'date', nowrap: true},
						{key: 'expiry', label: t.cols.expiry, type: 'date', nowrap: true},
						{key: 'daysLeft', label: t.cols.left, nowrap: true, render: (r) => (r.status === 'A' && !blank(r.daysLeft) ? <Badge text={t.due.left(r.daysLeft)} tone={r.daysLeft < 0 ? 'error' : r.daysLeft <= (data.permitDays || 60) ? 'warn' : 'ok'} /> : '')},
						{key: 'statusText', label: t.cols.status, nowrap: true, render: (r) => <Badge text={r.statusText} tone={PERMIT_TONE[r.status] || 'muted'} />},
					]}
					rows={rows}
					onRowClick={pickRow('permit')}
					selectedKey={sel.permit}
					empty={t.card.permitsEmpty}
					search={true}
					searchPlaceholder={t.card.find}
					toolbar={tools}
					maxHeight={TAB_HEIGHT}
				/>
				{prof && !prof.foreign ? (
					<div class="s4vp-hr-pager">
						<span>{t.card.notForeign}</span>
					</div>
				) : null}
			</Card>
		);
	};

	const renderLeave = () => {
		const leave = data.leave || {balances: []};
		return (
			<Card flush={true} title={t.card.leaveYear(leave.year || '')} actions={[<Button small={true} kind="ghost" label={t.card.leaveOpen} onClick={() => app.go('attendanceLegacy')} />]}>
				<Table
					columns={[
						{key: 'leaveTypeCode', label: t.cols.leaveType, nowrap: true, render: (r) => <b>{r.leaveTypeCode}</b>},
						{key: 'leaveTypeName', label: t.cols.name},
						{key: 'entitled', label: t.cols.entitled, type: 'num'},
						{key: 'carried', label: t.cols.carried, type: 'num'},
						{key: 'adjusted', label: t.cols.adjusted, type: 'num'},
						{key: 'used', label: t.cols.used, type: 'num'},
						{key: 'pending', label: t.cols.pending, type: 'num'},
						{key: 'available', label: t.cols.available, type: 'num', render: (r) => <b>{num(r.available)}</b>},
					]}
					rows={leave.balances || []}
					empty={t.card.leaveEmpty}
					search={true}
					searchPlaceholder={t.card.find}
					maxHeight={TAB_HEIGHT}
				/>
			</Card>
		);
	};

	const renderPayslips = () => {
		const rows = (data.payslips || []).map((p) => Object.assign({}, p, {id: p.line, statusText: t.batchStatus[p.status] || '', periodEndText: fmtDate(p.periodEnd)}));
		return (
			<Card flush={true} title={t.card.tabs.payslips} sub={t.card.payslipsSub}>
				<Table
					columns={[
						{key: 'period', label: t.cols.period, nowrap: true, render: (r) => <span class="s4vp-link">{r.period}</span>},
						{key: 'number', label: t.cols.batch, nowrap: true},
						{key: 'statusText', label: t.cols.status, nowrap: true, render: (r) => <Badge text={r.statusText} tone={BATCH_TONE[r.status] || 'muted'} />},
						pay ? {key: 'gross', label: t.cols.gross, type: 'money', nowrap: true} : null,
						pay ? {key: 'eeIns', label: t.cols.eeIns, type: 'money', nowrap: true} : null,
						pay ? {key: 'pit', label: t.cols.pit, type: 'money', nowrap: true} : null,
						pay ? {key: 'net', label: t.cols.net, type: 'money', nowrap: true} : null,
					]}
					rows={rows}
					onRowClick={(r) => app.go('payrollRun', {id: r.batch, line: r.line})}
					empty={t.card.payslipsEmpty}
					search={true}
					searchPlaceholder={t.card.find}
					maxHeight={TAB_HEIGHT}
				/>
			</Card>
		);
	};

	// -------------------------------------------------------------- hộp thoại
	const opt = (map) => Object.keys(map).map((k) => ({value: k, label: map[k]}));
	const lk = (name) => ((lookups && lookups[name]) || []).map((x) => ({value: x.id, label: x.name}));
	const renderDialog = () => {
		if (!dlg) return null;
		if (dlg.kind === 'raise' || dlg.kind === 'decision') {
			const isRaise = dlg.kind === 'raise';
			const type = isRaise ? 'S' : form.type;
			const org = ['H', 'T', 'P'].indexOf(type) >= 0;
			const payType = pay && (org || type === 'S');
			const cur = (v) => (comp && !blank(v) ? t.f.current(money(v)) : '');
			return (
				<Dialog
					title={isRaise ? t.dlg.raise : dlg.id ? t.dlg.decisionEdit : t.dlg.decisionNew}
					width={640}
					onClose={close}
					actions={dialogActions([<Button label={t.act.saveDraft} disabled={saving} onClick={() => saveDecision(false)} />, <Button label={t.act.saveApply} kind="primary" disabled={saving} onClick={() => saveDecision(true)} />])}
				>
					{serverBox}
					<div class="s4vp-hr-note">{isRaise ? t.dlg.raiseHint : t.dlg.decisionHint}</div>
					<div class="s4vp-form">
						{isRaise ? null : F('type', t.f.decisionType, <Select value={str(form.type)} onInput={setField('type')} options={opt(t.decisionType)} />)}
						{F('number', t.f.decisionNumber, txt('number'))}
						{F('sign_date', t.f.signDate, dat('sign_date'))}
						{F('effective', `${t.f.effective} *`, dat('effective'))}
						{org ? F('new_department', t.f.newDepartment, <Select value={str(form.new_department)} onInput={setField('new_department')} options={lk('departments')} placeholder={t.f.keep} />, deptName ? t.f.current(deptName) : '') : null}
						{org ? F('new_title', t.f.newTitle, txt('new_title'), data.title ? t.f.current(data.title) : '') : null}
						{payType ? F('new_salary', isRaise ? `${t.f.newSalary} *` : t.f.newSalary, amt('new_salary'), cur(comp && comp.base_salary)) : null}
						{payType ? F('new_ins_wage', t.f.newInsWage, amt('new_ins_wage'), cur(comp && comp.insurance_wage)) : null}
						{payType ? F('new_allowance', t.f.newAllowance, amt('new_allowance'), cur(comp && comp.allowance)) : null}
					</div>
					{F('note', t.f.note, <TextArea value={str(form.note)} onInput={setField('note')} rows={2} />)}
				</Dialog>
			);
		}
		if (dlg.kind === 'contract') {
			const appendix = !!dlg.parent;
			const locked = !!dlg.approved;
			const off = locked ? {disabled: true} : {};
			const title = appendix ? t.dlg.appendix(dlg.parentNumber) : dlg.mode === 'renew' ? t.dlg.contractRenew : dlg.id ? t.dlg.contractEdit : t.dlg.contractNew;
			const buttons = locked
				? [<Button label={t.act.save} kind="primary" disabled={saving} onClick={() => saveContract(false)} />]
				: [<Button label={t.act.saveDraft} disabled={saving} onClick={() => saveContract(false)} />, <Button label={t.act.saveActivate} kind="primary" disabled={saving} onClick={() => saveContract(true)} />];
			return (
				<Dialog title={title} width={640} onClose={close} actions={dialogActions(buttons)}>
					{serverBox}
					<div class="s4vp-hr-note">{locked ? t.dlg.approvedHint : t.dlg.contractHint}</div>
					<div class="s4vp-form">
						{F('number', appendix ? t.f.appendixNumber : t.f.number, txt('number'))}
						{appendix ? null : F('type', t.f.type, <Select value={str(form.type)} onInput={setField('type')} options={opt(t.contractType)} {...off} />)}
						{F('sign_date', t.f.signDate, dat('sign_date'))}
						{F('effective', `${t.f.effective} *`, dat('effective', off))}
						{appendix || form.type === 'U' ? null : F('expiry', form.type === 'P' || form.type === 'F' ? `${t.f.expiry} *` : t.f.expiry, dat('expiry', off))}
						{F('title', t.f.title, txt('title', off))}
						{pay ? F('base_salary', t.f.contractSalary, amt('base_salary', off)) : null}
						{pay ? F('insurance_wage', t.f.insWage, amt('insurance_wage', off)) : null}
					</div>
					{F('note', t.f.note, <TextArea value={str(form.note)} onInput={setField('note')} rows={2} />)}
				</Dialog>
			);
		}
		if (dlg.kind === 'terminate') {
			return (
				<Dialog title={t.dlg.terminate(dlg.number)} onClose={close} actions={dialogActions([<Button label={t.act.terminate} kind="danger" disabled={saving} onClick={saveTerminate} />])}>
					{serverBox}
					<div class="s4vp-hr-note">{t.dlg.terminateHint}</div>
					{F('date', `${t.f.terminateDate} *`, dat('date'), `${fmtDate(dlg.effective)} - ${dlg.expiry ? fmtDate(dlg.expiry) : t.openEnded}`)}
					{F('reason', t.f.reason, txt('reason'))}
				</Dialog>
			);
		}
		if (dlg.kind === 'dependent') {
			return (
				<Dialog title={dlg.id ? t.dlg.dependentEdit : t.dlg.dependentNew} width={640} onClose={close} actions={dialogActions([<Button label={t.act.save} kind="primary" disabled={saving} onClick={saveDependent} />])}>
					{serverBox}
					<div class="s4vp-form">
						{F('name', `${t.f.name} *`, txt('name'))}
						{F('relationship', t.f.relationship, txt('relationship'))}
						{F('birth_date', t.f.birthDate, dat('birth_date'))}
						{F('tax_code', t.f.taxCode, txt('tax_code'), dlg.id ? t.dlg.taxKeep : '')}
						{F('from', `${t.f.from} *`, dat('from'))}
						{F('to', t.f.to, dat('to'))}
					</div>
				</Dialog>
			);
		}
		if (dlg.kind === 'allocNew') {
			return (
				<Dialog title={t.dlg.allocNew} onClose={close} actions={dialogActions([<Button label={t.act.newVersion} kind="primary" disabled={saving} onClick={() => submit({action: 'newAllocVersion', employee: emp.id, reason: formRef.current.reason || ''}, t.done.alloc)} />])}>
					{serverBox}
					<div class="s4vp-hr-note">{t.dlg.allocNewHint}</div>
					{F('reason', t.f.reason, txt('reason'))}
				</Dialog>
			);
		}
		if (dlg.kind === 'allocActivate') {
			return (
				<Dialog title={t.dlg.allocActivate(dlg.nbr)} onClose={close} actions={dialogActions([<Button label={t.act.activate} kind="primary" disabled={saving} onClick={saveAllocActivate} />])}>
					{serverBox}
					<div class="s4vp-hr-note">{t.dlg.allocActivateHint}</div>
					{F('effective', `${t.f.effective} *`, dat('effective'))}
				</Dialog>
			);
		}
		if (dlg.kind === 'allocLines') {
			const lines = form.lines || [];
			const total = lines.reduce((s, l) => s + (toNumber(l.percent) || 0), 0);
			const pickOf = (i, k, name, label) => <Select value={str(lines[i][k])} onInput={setLine(i, k)} options={lk(name)} placeholder={t.f.none} ariaLabel={label} />;
			return (
				<Dialog title={t.dlg.allocLines(dlg.nbr)} width={900} onClose={close} actions={dialogActions([<Button label={t.act.save} kind="primary" disabled={saving} onClick={saveAllocLines} />])}>
					{serverBox}
					<div class="s4vp-hr-alloc">
						<div class="s4vp-hr-alloc-row s4vp-hr-alloc-head">
							<span>{t.cols.project}</span>
							<span>{t.cols.department}</span>
							<span>{t.cols.location}</span>
							<span>{t.cols.cls}</span>
							<span>{t.cols.percent}</span>
							<span>{''}</span>
						</div>
						{lines.map((l, i) => (
							<div key={`l${i}`}>
								<div class="s4vp-hr-alloc-row">
									{pickOf(i, 'project', 'projects', t.cols.project)}
									{pickOf(i, 'department', 'departments', t.cols.department)}
									{pickOf(i, 'location', 'locations', t.cols.location)}
									{pickOf(i, 'work_center', 'classes', t.cols.cls)}
									<NumberInput value={str(l.percent)} onInput={setLine(i, 'percent')} ariaLabel={t.cols.percent} />
									<button type="button" class="s4vp-x" aria-label={t.act.removeLine} title={t.act.removeLine} onClick={() => removeLine(i)}>
										{'×'}
									</button>
								</div>
								{errs[`line${i}`] ? <div class="s4vp-hr-err s4vp-small">{errs[`line${i}`]}</div> : null}
							</div>
						))}
					</div>
					<div class="s4vp-line">
						<Button small={true} kind="dashed" label={t.act.addLine} onClick={addLine} />
						<span>
							<b class={Math.abs(total - 100) > 0.001 ? 's4vp-hr-err' : 's4vp-num'}>{t.dlg.allocTotal(num(total))}</b>
							<span class="s4vp-small">{` - ${t.dlg.allocTotalHint}`}</span>
						</span>
					</div>
					{F('reason', t.f.reason, txt('reason'))}
				</Dialog>
			);
		}
		if (dlg.kind === 'permit') {
			return (
				<Dialog title={t.dlg.permitNew} width={640} onClose={close} actions={dialogActions([<Button label={t.act.save} kind="primary" disabled={saving} onClick={savePermit} />])}>
					{serverBox}
					<div class="s4vp-form">
						{F('doc_type', t.f.docType, <Select value={str(form.doc_type)} onInput={setField('doc_type')} options={opt(t.permitDoc)} />)}
						{F('issue_type', t.f.issueType, <Select value={str(form.issue_type)} onInput={setField('issue_type')} options={opt({N: t.permitIssue.N, R: t.permitIssue.R})} />)}
						{F('effective', `${t.f.effective} *`, dat('effective'))}
						{F('expiry', `${t.f.permitExpiry} *`, dat('expiry'))}
						{F('authority', t.f.authority, txt('authority'))}
						{F('job', t.f.job, <Select value={str(form.job)} onInput={setField('job')} options={opt(t.permitJob)} placeholder={t.f.pick} />)}
						{F('title', t.f.title, txt('title'))}
						{F('work_location', t.f.workLocation, txt('work_location'))}
						{F('passport', t.f.passport, txt('passport'))}
						{F('passport_expiry', t.f.passportExpiry, dat('passport_expiry'))}
					</div>
				</Dialog>
			);
		}
		if (dlg.kind === 'permitIssue') {
			return (
				<Dialog title={t.dlg.permitIssue(dlg.name)} onClose={close} actions={dialogActions([<Button label={t.act.issue} kind="primary" disabled={saving} onClick={savePermitIssue} />])}>
					{serverBox}
					{F('permitNo', dlg.docType === 'E' ? t.f.permitNo : `${t.f.permitNo} *`, txt('permitNo'))}
					{F('issued', `${t.f.issued} *`, dat('issued'))}
				</Dialog>
			);
		}
		return null;
	};

	const showPermits = (prof && prof.foreign) || (data.permits || []).length > 0;
	const tabs = [
		{value: 'overview', label: t.card.tabs.overview, count: dueItems.length || undefined},
		{value: 'pay', label: t.card.tabs.pay},
		{value: 'contracts', label: t.card.tabs.contracts, count: contracts.length || undefined},
		{value: 'decisions', label: t.card.tabs.decisions, count: (data.decisions || []).length || undefined},
		{value: 'dependents', label: t.card.tabs.dependents, count: (data.dependents || []).length || undefined},
		{value: 'alloc', label: t.card.tabs.alloc},
		showPermits ? {value: 'permits', label: t.card.tabs.permits, count: (data.permits || []).length || undefined} : null,
		{value: 'leave', label: t.card.tabs.leave},
		{value: 'payslips', label: t.card.tabs.payslips},
	].filter(Boolean);
	const active = tabs.some((x) => x.value === tab) ? tab : 'overview';
	const body = {overview: renderOverview, pay: renderPay, contracts: renderContracts, decisions: renderDecisions, dependents: renderDependents, alloc: renderAlloc, permits: renderPermits, leave: renderLeave, payslips: renderPayslips}[active]();
	const notes = (data.notes || []).map((n) => t.notes[n]).filter(Boolean);

	const headerActions = [];
	if (prof) headerActions.push(<Button label={t.card.openProfile} onClick={() => openRecord((boot.recordTypes || {}).employee, prof.id)} />);
	else if (canEdit) headerActions.push(<Button label={t.newProfile} kind="primary" onClick={() => newProfileRecord(boot)} />);
	if (canEdit) {
		headerActions.push(<Button label={t.act.addContract} disabled={busy} onClick={() => openContract('new')} />);
		headerActions.push(<Button label={t.act.addDecision} disabled={busy} onClick={() => openDecision(null)} />);
		if (prof && pay) headerActions.push(<Button label={t.act.raise} kind="primary" disabled={busy} onClick={openRaise} />);
	}

	return (
		<Page>
			<div class="s4vp-hr">
				<PageHeader back={back} title={`${emp.code || ''} - ${emp.name || ''}`} status={statusBadge} sub={[deptName, data.title].filter(Boolean).join(' · ')} actions={headerActions} />
				{prof ? null : <div class="s4vp-hr-errbox">{t.card.noProfile}</div>}
				{notes.length ? <div class="s4vp-hr-note">{notes.join(' ')}</div> : null}
				<div class="s4vp-hr-facts">
					{fact(t.card.facts.department, deptName)}
					{fact(t.card.facts.title, data.title)}
					{fact(t.card.facts.employment, prof ? t.empType[prof.employment_type] || '' : '')}
					{fact(t.card.facts.hired, prof ? fmtDate(prof.hire_date) : '')}
					{left && prof && prof.termination_date ? fact(t.card.facts.lastDay, fmtDate(prof.termination_date)) : fact(t.card.facts.contract, contractFact)}
					{pay ? fact(t.card.facts.salary, comp ? money(comp.base_salary) : '') : null}
					{pay ? fact(t.card.facts.insWage, comp ? money(comp.insurance_wage) : '') : null}
					{fact(t.card.facts.dependents, String(activeDeps))}
					{fact(t.card.facts.info, prof ? (missing.length ? missing.join(', ') : t.card.complete) : t.status.noProfile)}
				</div>
				<Tabs items={tabs} value={active} onPick={setTab} label={t.card.tabsLabel} />
				{body}
				{renderDialog()}
			</div>
		</Page>
	);
}

export default function EmployeesView({app}) {
	const route = app.route || {};
	const id = route.view === 'employee' ? (route.params || {}).id : '';
	// key theo id: đổi sang người khác thì dựng lại hồ sơ từ đầu (tab, hộp thoại, dòng đang chọn)
	return id ? <EmployeeCard key={`e${id}`} app={app} id={String(id)} /> : <EmployeeList key="list" app={app} />;
}
