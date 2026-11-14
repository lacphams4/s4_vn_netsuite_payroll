/**
 * Thiết lập (giao diện bản 2, docs/UI_V2.md mục 14). Hai tình huống: thiết lập lần đầu (trình tự 5 bước, mỗi bước một nút
 * chính) và bảo trì (bảng "Tình trạng thiết lập": từng mục đủ / thiếu gì / cần chú ý, có ô tìm và lọc "Cần xử lý").
 *
 * Tham số route: section ('' bảng tình trạng | general | accounts | costAccounts | periods | legal), tab (tab con của mục).
 * Đọc: GET setupStatus, setupData, setupLegal, costAccounts, costAccountTest (api/SetupHub.js), hrLookups (api/HrCore.js).
 * Ghi: action cũ loadDefaults, loadIndustryPack, generatePeriods, closePeriod, reopenPeriod, saveSetup, saveCompany (quản trị + HR);
 *      route mới saveSetupAccounts, saveInsuranceAccounts, saveCostAccount, retireCostAccount (quản trị + kế toán), verifyParam.
 * Danh mục chưa có form trong SPA mở danh sách bản ghi NetSuite (boot.recordTypeIds). Màn này không sửa giá trị pháp lý.
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post} from '../lib/api.js';
import {money, pct, fmtDate, toNumber, fold} from '../lib/format.js';
import {pick, localized} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Table, Badge, Chips, Tabs, Select, AutoSelect, Checkbox, Field, TextInput, NumberInput, MoneyInput, DateInput, TextArea, SearchBox, Dialog, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		title: 'Thiết lập',
		sub: 'Tình trạng thiết lập của phân hệ lương. Mục thiếu hoặc cần chú ý được đánh dấu để xử lý trước.',
		refresh: 'Tải lại',
		legacy: 'Màn hình cũ',
		loading: 'Đang tải...',
		working: 'Đang xử lý...',
		noSubsidiary: 'Chưa chọn công ty con.',
		hrOnly: 'Chỉ nhân sự (hoặc quản trị) được sửa mục này.',
		acctOnly: 'Chỉ kế toán (hoặc quản trị) được sửa tài khoản.',
		open: 'Mở',
		openList: 'Danh sách',
		openListLong: 'Mở danh sách NetSuite',
		openListTitle: 'Mở danh sách bản ghi NetSuite ở tab mới',
		noList: 'Không tìm thấy loại bản ghi này trên tài khoản.',
		save: 'Lưu',
		cancel: 'Hủy',
		edit: 'Sửa',
		yes: 'Có',
		no: 'Không',
		inherit: 'Kế thừa thiết lập chung',
		inherited: (v) => `Kế thừa (${v})`,
		notSet: 'Chưa khai',
		renderError: 'Không hiển thị được mục này.',
		search: 'Tìm mục thiết lập',
		filter: {all: 'Tất cả', todo: 'Cần xử lý', optional: 'Tùy chọn', label: 'Lọc theo tình trạng'},
		state: {ok: 'Đủ', missing: 'Thiếu', attention: 'Cần chú ý', optional: 'Tùy chọn', unknown: 'Không đọc được'},
		count: (n) => `${n} bản ghi`,
		none: 'Không có mục nào khớp.',
		summary: (s) => `${s.missing || 0} mục thiếu, ${s.attention || 0} mục cần chú ý`,
		summaryOk: 'Các mục bắt buộc đã đủ',
		sections: {start: 'Bắt đầu', company: 'Công ty và tài khoản', periods: 'Kỳ và nhóm lương', legal: 'Pháp lý', earnings: 'Thu nhập và quy tắc', attendance: 'Chấm công và phép', output: 'Sản lượng và tổ đội'},
		items: {
			defaults: {name: 'Nạp mặc định VN', desc: 'Tham số pháp lý, biểu thuế, khoản trích, ngày lễ, loại thu nhập, loại nghỉ, nhóm lương DEFAULT và thiết lập chung.'},
			industry: {name: 'Gói theo ngành', desc: 'Loại thu nhập, nhóm lương, bảng đơn giá và quy tắc mẫu cho xây dựng, thương mại, sản xuất.'},
			employees: {name: 'Hồ sơ lương nhân viên', desc: 'Nhân viên của công ty con đang chọn đã có hồ sơ lương.'},
			general: {name: 'Thiết lập chung', desc: 'Ngày công chuẩn, loại thu nhập mặc định, duyệt, giờ công, phân bổ, trích tháng 13.'},
			company: {name: 'Thiết lập theo công ty con', desc: 'Giá trị riêng của công ty con đang chọn và người ký trên báo cáo; ô trống kế thừa thiết lập chung.'},
			accounts: {name: 'Tài khoản kế toán mặc định', desc: 'Tài khoản 334, thuế TNCN, tạm ứng, chi phí mặc định, cơ quan thuế.'},
			insAccounts: {name: 'Tài khoản bảo hiểm theo thành phần', desc: 'Tài khoản phải trả và cơ quan thu của từng khoản trích theo lương.'},
			costAccounts: {name: 'Tài khoản chi phí lương theo đích', desc: 'Tài khoản chi phí riêng theo dự án, class hoặc phòng ban.'},
			security: {name: 'Bảo mật vai trò', desc: 'Vai trò chạy của cổng nhân viên không được gán cho người dùng nào.'},
			approvals: {name: 'Cấp duyệt bảng lương', desc: 'Các cấp phải duyệt trước khi ghi sổ bảng lương, người duyệt và ngưỡng tổng thực lĩnh.'},
			paygroups: {name: 'Nhóm lương', desc: 'Tần suất kỳ, ngày công chuẩn và nguồn công của từng nhóm.'},
			periods: {name: 'Kỳ lương', desc: 'Sinh kỳ theo năm, đóng và mở kỳ, trạng thái công.'},
			params: {name: 'Tham số pháp lý', desc: 'Giảm trừ gia cảnh, mức tham chiếu, lương tối thiểu vùng, hệ số làm thêm theo ngày hiệu lực.'},
			pitBrackets: {name: 'Biểu thuế TNCN', desc: 'Biểu lũy tiến từng phần theo ngày hiệu lực.'},
			insComps: {name: 'Khoản trích theo lương', desc: 'Tỷ lệ BHXH, BHYT, BHTN, KPCĐ phần người lao động và doanh nghiệp.'},
			holidays: {name: 'Ngày lễ', desc: 'Lịch nghỉ lễ dùng để tính ngày công chuẩn và làm thêm ngày lễ.'},
			earningTypes: {name: 'Loại thu nhập', desc: 'Lương, phụ cấp, làm thêm, thưởng và cách tính thuế từng loại.'},
			earningRules: {name: 'Quy tắc thu nhập', desc: 'Cách tính từng khoản thu nhập khi chạy lương.'},
			benefitPkgs: {name: 'Gói phúc lợi', desc: 'Bộ phụ cấp gán cho hồ sơ lương.'},
			leaveTypes: {name: 'Loại nghỉ', desc: 'Nghỉ phép, nghỉ không lương, nghỉ hưởng BHXH.'},
			leavePolicies: {name: 'Chính sách phép năm', desc: 'Số ngày phép, thâm niên, chuyển phép.'},
			attSymbols: {name: 'Ký hiệu bảng công', desc: 'Ký hiệu dùng trên bảng chấm công.'},
			attRules: {name: 'Quy tắc trừ công trễ sớm', desc: 'Số phút trễ, sớm và mức trừ công.'},
			shifts: {name: 'Ca làm việc', desc: 'Giờ vào, giờ ra, nghỉ giữa ca.'},
			shiftPatterns: {name: 'Mẫu xoay ca', desc: 'Chu kỳ ca dùng để phân ca.'},
			rateTables: {name: 'Bảng đơn giá', desc: 'Đơn giá khoán, công đoạn, sản phẩm, thang hoa hồng.'},
			teams: {name: 'Tổ đội', desc: 'Tổ, chuyền, cửa hàng và cách chia tiền tổ.'},
		},
		accountCount: (n) => `${n}/8 mục đã khai`,
		insCount: (n) => `${n} khoản trích đang hiệu lực`,
		packCount: (n) => `${n} gói đã nạp`,
		levelCount: (n) => `${n} cấp`,
		employeeCount: (n) => `${n} hồ sơ`,
		periodCount: (n, last) => (last ? `${n} kỳ, đến ${last}` : `${n} kỳ`),
		issues: {
			UNREADABLE: () => 'Vai trò của bạn không đọc được bảng này, hoặc bảng chưa được cài.',
			EMPTY: () => 'Chưa có bản ghi nào.',
			NONE: () => 'Chưa dùng.',
			NOT_LOADED: () => 'Chưa nạp mặc định VN.',
			NO_SETUP: () => 'Chưa có thiết lập chung: hãy nạp mặc định VN.',
			NO_BASE_EARNING: () => 'Chưa chọn loại thu nhập lương cơ bản.',
			NO_SUBSIDIARY: () => 'Chưa chọn công ty con.',
			INHERITS: () => 'Chưa có bản ghi riêng: công ty con dùng toàn bộ thiết lập chung.',
			COMPANY_DISABLED: () => 'Phân hệ lương đang tắt cho công ty con này.',
			NO_SIGNERS: () => 'Chưa khai người lập biểu, kế toán trưởng, giám đốc để in báo cáo.',
			ESS_ROLE_ASSIGNED: (i) => `Vai trò "S4VP Self-service (run-as only)" đang được gán cho ${i.count} người dùng. Vai trò này xem được lương của mọi nhân viên: hãy gỡ khỏi người dùng (Setup > Users/Roles > Manage Users).`,
			NO_EMPLOYEES: () => 'Công ty con này chưa có hồ sơ lương nào.',
			ACCOUNTS_MISSING: (i, t) => `Thiếu tài khoản bắt buộc: ${i.list.map((k) => t.accountNames[k] || k).join(', ')}.`,
			ACCOUNTS_OPTIONAL: (i, t) => `Chưa khai: ${i.list.map((k) => t.accountNames[k] || k).join(', ')}.`,
			INS_NO_ACCOUNT: (i) => `Chưa có tài khoản phải trả: ${i.list.join(', ')}.`,
			INS_NO_VENDOR: (i) => `Chưa có cơ quan thu: ${i.list.join(', ')}.`,
			UNVERIFIED: (i) => `${i.n} tham số chưa đối chiếu văn bản gốc: ${i.list.join(', ')}${i.n > i.list.length ? '...' : ''}.`,
			NO_HOLIDAYS_YEAR: (i) => `Chưa có ngày lễ của năm ${i.n}.`,
			NO_PERIODS: () => 'Chưa sinh kỳ lương nào.',
			NO_CURRENT: (i) => `Không có kỳ chứa ngày hôm nay: ${i.list.join(', ')}.`,
			NEXT_MISSING: (i) => `Chưa sinh kỳ kế tiếp: ${i.list.join(', ')}.`,
			GROUP_WITHOUT_PERIODS: (i) => `Nhóm lương chưa có kỳ: ${i.list.join(', ')}.`,
			SINGLE_LEVEL: () => 'Chưa khai cấp duyệt - bảng lương đang duyệt một cấp như trước.',
			APPROVER_MISSING: (i) => `${i.n} dòng chưa có người duyệt hoặc vai trò duyệt.`,
		},
		accountNames: {
			acc_payable: 'TK phải trả người lao động (334)', acc_expense: 'TK chi phí lương mặc định', acc_pit: 'TK thuế TNCN (3335)', acc_advance: 'TK tạm ứng (141)',
			acc_other_ded: 'TK khấu trừ khác', acc_13th: 'TK trích trước tháng 13 (335)', acc_contractor: 'TK phải trả cộng tác viên (3388 / 331)', pit_vendor: 'Cơ quan thuế', location: 'Địa điểm mặc định cho chứng từ',
		},
		accountHints: {
			acc_payable: 'Bắt buộc: bên Có khi ghi sổ bảng lương, bên Nợ khi chi lương.',
			acc_expense: 'Bắt buộc: dùng khi không có tài khoản theo đích và hồ sơ nhân viên không khai tài khoản.',
			acc_pit: 'Bắt buộc: thuế TNCN khấu trừ phải nộp.',
			acc_advance: 'Cần khi ghi sổ tạm ứng lương và cấn trừ qua bảng lương.',
			acc_other_ded: 'Khấu trừ sau thuế nhập tay trên bảng lương.',
			acc_13th: 'Cần khi trích trước lương tháng 13 hằng tháng.',
			acc_contractor: 'Thù lao phải trả cộng tác viên; trống thì dùng tài khoản 334.',
			pit_vendor: 'Nhà cung cấp đại diện cơ quan thuế để lập bill nộp thuế TNCN.',
			location: 'Dùng cho bút toán lương và bill khi tài khoản NetSuite bắt buộc địa điểm.',
		},
		first: {
			title: 'Thiết lập lần đầu',
			sub: 'Làm lần lượt từng bước. Bước tùy chọn có thể bỏ qua.',
			done: 'Xong',
			todo: 'Chưa làm',
			optional: 'Tùy chọn',
			label: 'Trình tự thiết lập lần đầu',
			steps: {
				defaults: {name: 'Nạp mặc định VN', desc: 'Tạo tham số pháp lý, danh mục và thiết lập chung. Chỉ thêm phần còn thiếu, chạy lại không ghi đè.', action: 'Nạp mặc định VN', again: 'Nạp bổ sung'},
				industry: {name: 'Chọn gói theo ngành', desc: 'Nếu doanh nghiệp thuộc xây dựng, thương mại hoặc sản xuất: nạp danh mục và quy tắc mẫu của ngành.', action: 'Chọn gói ngành', again: 'Chọn gói ngành'},
				accounts: {name: 'Khai tài khoản kế toán', desc: 'Tài khoản mặc định và tài khoản phải trả của từng khoản bảo hiểm - kế toán khai.', action: 'Khai tài khoản', again: 'Xem tài khoản'},
				periods: {name: 'Sinh kỳ lương', desc: 'Sinh các kỳ của năm cho nhóm lương đang dùng.', action: 'Sinh kỳ lương', again: 'Xem kỳ lương'},
				employees: {name: 'Nạp nhân viên', desc: 'Tạo hồ sơ lương, hợp đồng và mức lương cho nhân viên.', action: 'Mở Nhân sự', again: 'Mở Nhân sự'},
			},
		},
		defaults: {
			confirm: 'Nạp bổ sung mặc định VN? Hệ thống chỉ thêm phần còn thiếu (so theo mã và ngày hiệu lực), không ghi đè dữ liệu đã có.',
			done: (created, skipped) => `Đã nạp mặc định VN: thêm ${created} bản ghi, ${skipped} bản ghi đã có sẵn.`,
		},
		pack: {
			title: 'Nạp gói theo ngành',
			intro: 'Gói chỉ thêm phần chưa có (so theo mã). Quy tắc cần mức tiền do doanh nghiệp quyết định được nạp ở trạng thái ngừng dùng để rà lại trước khi bật.',
			pick: 'Gói ngành',
			pickHint: 'Nhóm lương của gói được tạo cho công ty con đang chọn.',
			placeholder: 'Chọn gói',
			loaded: 'đã nạp đủ',
			load: 'Nạp gói',
			needDefaults: 'Hãy nạp mặc định VN trước.',
			done: (name, n, skipped) => `Đã nạp gói ${name}: thêm ${n} mục${skipped ? `; ${skipped} ca và mẫu xoay ca chưa được nạp tự động` : ''}.`,
		},
		lists: {
			region: {I: 'Vùng I', II: 'Vùng II', III: 'Vùng III', IV: 'Vùng IV'},
			overtime_source: {R: 'Đơn làm thêm đã duyệt', T: 'Timesheet'},
			allocation_method: {S: 'Theo thiết lập', T: 'Giờ timesheet', F: 'Bảng tỷ lệ cố định', R: 'Ngày phân ca'},
			allocation_fallback: {P: 'Bảng tỷ lệ rồi dự án mặc định', D: 'Dự án mặc định'},
			alloc_version: {E: 'Phiên bản hiệu lực cuối kỳ', D: 'Chia theo ngày lịch'},
			accrual13_basis: {P: 'Lương hợp đồng và gói phúc lợi', C: 'Chỉ lương hợp đồng'},
		},
		general: {
			title: 'Thiết lập chung và theo công ty con',
			sub: 'Thiết lập chung áp dụng cho mọi công ty con; công ty con chỉ khai những mục khác với thiết lập chung.',
			tabs: {setup: 'Chung', company: (name) => `Công ty con: ${name}`},
			tabsLabel: 'Phạm vi thiết lập',
			noSetup: 'Chưa có thiết lập chung. Hãy nạp mặc định VN trước.',
			noCompany: 'Công ty con này chưa có bản ghi riêng: đang dùng toàn bộ thiết lập chung. Bấm Sửa ở một nhóm để tạo.',
			accountsNote: 'Tài khoản kế toán khai ở mục Tài khoản kế toán mặc định.',
			openAccounts: 'Mở tài khoản kế toán',
			openRecord: 'Mở bản ghi NetSuite',
			groups: {
				work: 'Ngày công và vùng lương', earning: 'Loại thu nhập mặc định', insurance: 'Bảo hiểm và công đoàn', approval: 'Duyệt và ghi sổ', time: 'Giờ công và chấm công',
				alloc: 'Phân bổ chi phí', accrual: 'Trích trước lương tháng 13', companyState: 'Trạng thái', signers: 'Người ký trên báo cáo',
			},
			editTitle: (group, scope) => `Sửa: ${group} - ${scope}`,
			scopeSetup: 'thiết lập chung',
			saved: 'Đã lưu thiết lập.',
			errNumber: (label) => `${label}: giá trị phải là số.`,
			errWeekly: 'Ngày nghỉ hằng tuần: nhập các số 0 - 6 cách nhau bằng dấu phẩy (0 = Chủ nhật), ví dụ 0,6.',
			fields: {
				std_days: {label: 'Ngày công chuẩn / tháng', hint: 'Trống: tính theo lịch từng kỳ (trừ ngày nghỉ tuần và ngày lễ).'},
				hours_per_day: {label: 'Giờ chuẩn / ngày', hint: 'Dùng quy đổi lương giờ và làm thêm; thường là 8.'},
				weekly_off: {label: 'Ngày nghỉ hằng tuần', hint: '0 = Chủ nhật ... 6 = Thứ bảy, cách nhau bằng dấu phẩy. Ví dụ 0,6.'},
				region: {label: 'Vùng lương tối thiểu', hint: 'Dùng kiểm tra lương tối thiểu vùng và trần BHTN.'},
				base_et: {label: 'Loại thu nhập lương cơ bản', hint: 'Dòng lương theo hợp đồng trên bảng lương.'},
				allow_et: {label: 'Loại thu nhập phụ cấp', hint: 'Phụ cấp cố định khai trên hồ sơ lương.'},
				meal_et: {label: 'Loại thu nhập ăn ca', hint: 'Tiền ăn giữa ca, miễn thuế đến mức trần.'},
				ctr_et: {label: 'Loại thu nhập thù lao cộng tác viên', hint: 'Dùng cho hợp đồng dịch vụ, khấu trừ 10%.'},
				payout_et: {label: 'Loại thu nhập trả phép khi nghỉ việc', hint: 'Thanh toán ngày phép chưa nghỉ.'},
				meal_amount: {label: 'Mức ăn ca / tháng', hint: 'Số tiền ăn ca mặc định cho một tháng đủ công.'},
				union_fund: {label: 'Doanh nghiệp đóng kinh phí công đoàn', hint: 'Tắt nếu doanh nghiệp không thuộc diện đóng 2%.'},
				accident_rate: {label: 'Tỷ lệ BHTNLĐ ghi đè', hint: 'Số thập phân, ví dụ 0,003. Trống: dùng tỷ lệ của khoản trích.'},
				ext_ot: {label: 'Ngành được làm thêm 300 giờ / năm', hint: 'Bật thì giới hạn làm thêm năm là 300 giờ thay vì 200 giờ.'},
				require_approval: {label: 'Bắt buộc duyệt bảng lương', hint: 'Bảng lương phải được duyệt trước khi ghi sổ.'},
				auto_approve: {label: 'Tự duyệt bút toán và bill do phân hệ tạo', hint: 'Dùng khi tài khoản NetSuite bật duyệt bút toán hoặc bill.'},
				time_approval: {label: 'Chỉ lấy giờ đã duyệt', hint: 'Chỉ dòng timesheet đã duyệt mới vào giờ công tính lương.'},
				ot_source: {label: 'Nguồn giờ làm thêm', hint: 'Lấy giờ làm thêm từ đơn làm thêm đã duyệt hoặc từ timesheet.'},
				require_lock: {label: 'Bắt buộc khóa công trước khi tính lương', hint: 'Chặn tính lương khi bảng công của kỳ chưa khóa.'},
				leave_policy: {label: 'Chính sách phép mặc định', hint: 'Áp dụng cho nhân viên không khai chính sách riêng.'},
				wp_blocks: {label: 'Chặn tính lương khi thiếu giấy phép lao động', hint: 'Áp dụng cho lao động nước ngoài hết hạn hoặc chưa có giấy phép.'},
				alloc_method: {label: 'Phương pháp phân bổ', hint: 'Cách chia chi phí lương cho dự án, phòng ban, class.'},
				alloc_fallback: {label: 'Phân bổ dự phòng', hint: 'Dùng khi phương pháp chính không có dữ liệu trong kỳ.'},
				alloc_version: {label: 'Chế độ phiên bản bảng tỷ lệ', hint: 'Khi bảng tỷ lệ đổi giữa kỳ: lấy bản cuối kỳ hoặc chia theo ngày.'},
				acc13_basis: {label: 'Cơ sở trích trước tháng 13', hint: 'Phần thu nhập dùng để tính số trích mỗi tháng.'},
				acc13_months: {label: 'Số tháng chia trích trước', hint: 'Thường là 12: mỗi tháng trích 1/12.'},
				enabled: {label: 'Bật phân hệ lương cho công ty con', hint: 'Tắt thì công ty con không hiện trong danh sách chọn.'},
				preparer: {label: 'Người lập biểu', hint: 'In trên bảng lương, tờ khai.'},
				chief_accountant: {label: 'Kế toán trưởng', hint: 'In trên bảng lương, tờ khai.'},
				director: {label: 'Giám đốc', hint: 'In trên bảng lương, tờ khai.'},
			},
		},
		accounts: {
			title: 'Tài khoản kế toán',
			sub: 'Tài khoản mặc định khi ghi sổ lương và tài khoản phải trả của từng khoản bảo hiểm. Công ty con khai tài khoản nào thì dùng tài khoản đó, còn lại kế thừa thiết lập chung.',
			tabs: {defaults: 'Tài khoản mặc định', ins: 'Tài khoản bảo hiểm'},
			tabsLabel: 'Nhóm tài khoản',
			search: 'Tìm mục, số tài khoản',
			editSetup: 'Sửa tài khoản chung',
			editCompany: 'Sửa cho công ty con',
			cols: {item: 'Mục', common: 'Thiết lập chung', company: 'Công ty con', effective: 'Đang áp dụng', state: 'Tình trạng'},
			required: 'Bắt buộc',
			missing: 'Thiếu',
			set: 'Đã khai',
			optional: 'Chưa khai',
			titleSetup: 'Tài khoản mặc định - thiết lập chung',
			titleCompany: (name) => `Tài khoản mặc định - ${name}`,
			companyHint: 'Để trống ô nào thì công ty con dùng tài khoản của thiết lập chung.',
			pickAccount: 'Chưa khai',
			saved: 'Đã lưu tài khoản.',
			ins: {
				search: 'Tìm khoản trích, tài khoản, cơ quan thu',
				cols: {code: 'Mã', name: 'Khoản trích', ee: 'Người lao động', er: 'Doanh nghiệp', account: 'Tài khoản phải trả', vendor: 'Cơ quan thu', state: 'Tình trạng'},
				expired: 'Hết hiệu lực',
				noAccount: 'Thiếu tài khoản',
				noVendor: 'Thiếu cơ quan thu',
				ok: 'Đủ',
				editTitle: (code) => `Tài khoản của khoản trích ${code}`,
				hint: 'Ghi cho mọi dòng (mọi ngày hiệu lực) của khoản trích này.',
				account: 'Tài khoản phải trả (338x)',
				vendor: 'Cơ quan thu',
				vendorHint: 'Dùng khi lập bill nộp cho cơ quan thu.',
				empty: 'Chưa có khoản trích nào. Hãy nạp mặc định VN.',
			},
		},
		cost: {
			title: 'Tài khoản chi phí lương theo đích',
			sub: 'Gán tài khoản chi phí riêng cho dự án, class hoặc phòng ban. Dòng phân bổ không khớp đích nào thì dùng tài khoản của hồ sơ nhân viên, rồi tài khoản mặc định.',
			add: 'Thêm tài khoản',
			search: 'Tìm đích, tài khoản, công ty con',
			unavailable: 'Không đọc được bảng tài khoản theo đích: bảng chưa được cài hoặc vai trò của bạn chưa có quyền.',
			empty: 'Chưa khai tài khoản theo đích nào: mọi chi phí lương đi vào tài khoản của hồ sơ nhân viên hoặc tài khoản mặc định.',
			emptyFilter: 'Không có dòng nào ở nhóm này.',
			chips: {active: 'Đang dùng', all: 'Tất cả', label: 'Lọc dòng tài khoản'},
			cols: {type: 'Loại đích', target: 'Đích', labor: 'Loại lao động', account: 'Tài khoản chi phí', subsidiary: 'Công ty con', effective: 'Hiệu lực từ', state: 'Tình trạng', act: 'Thao tác'},
			types: {W: 'Class', P: 'Dự án', D: 'Phòng ban'},
			labor: {E: 'Nhân viên', C: 'Cộng tác viên', all: 'Mọi loại'},
			shared: 'Dùng chung',
			always: 'Luôn hiệu lực',
			states: {inUse: 'Đang áp dụng', overridden: 'Bị dòng khác thay', future: 'Chưa đến ngày', otherSubsidiary: 'Công ty con khác', accountInactive: 'Tài khoản đã ngừng', inactive: 'Ngừng dùng', invalid: 'Thiếu đích'},
			retire: 'Ngừng dùng',
			restore: 'Dùng lại',
			retireOf: (name) => `Ngừng dùng dòng ${name}`,
			restoreOf: (name) => `Dùng lại dòng ${name}`,
			editOf: (name) => `Sửa dòng ${name}`,
			confirmRetire: (name, account) => `Ngừng dùng dòng "${name}" (tài khoản ${account})? Dòng không bị xóa; từ lần tính lương sau chi phí của đích này đi theo mức ưu tiên kế tiếp.`,
			retired: 'Đã ngừng dùng dòng tài khoản.',
			restored: 'Đã dùng lại dòng tài khoản.',
			saved: 'Đã lưu tài khoản theo đích. Bảng lương tính lại sẽ dùng tài khoản mới.',
			form: {
				titleNew: 'Thêm tài khoản theo đích',
				titleEdit: 'Sửa tài khoản theo đích',
				type: 'Loại đích',
				target: 'Đích',
				targetPick: 'Chọn đích',
				labor: 'Loại lao động',
				laborHint: 'Dòng riêng cho một loại lao động được dùng trước dòng cho mọi loại.',
				account: 'Tài khoản chi phí',
				accountPick: 'Chọn tài khoản',
				subsidiary: 'Công ty con',
				subsidiaryHint: 'Dòng của một công ty con thay dòng dùng chung cho cùng đích.',
				effective: 'Hiệu lực từ ngày',
				effectiveHint: 'Trống: luôn hiệu lực. Lấy dòng hiệu lực muộn nhất không sau ngày cuối kỳ lương.',
				note: 'Ghi chú',
				errTarget: 'Chưa chọn đích.',
				errAccount: 'Chưa chọn tài khoản chi phí.',
				errDate: 'Ngày hiệu lực không hợp lệ (dd/mm/yyyy).',
			},
			priority: {
				title: 'Thứ tự ưu tiên khi ghi sổ',
				label: 'Thứ tự ưu tiên chọn tài khoản chi phí',
				levels: [
					'Class của dòng phân bổ',
					'Dự án của dòng phân bổ',
					'Phòng ban riêng của dòng phân bổ',
					'Tài khoản chi phí trên hồ sơ lương nhân viên',
					'Phòng ban của nhân viên (khi dòng không có phòng ban riêng)',
					'Tài khoản chi phí lương mặc định',
				],
				note: 'Trong mỗi mức: dòng đúng loại lao động trước dòng cho mọi loại; dòng của công ty con trước dòng dùng chung; cùng mức thì lấy ngày hiệu lực muộn nhất.',
			},
			test: {
				title: 'Thử chọn tài khoản',
				sub: 'Chọn đích của một dòng phân bổ để xem tài khoản sẽ được dùng.',
				workCenter: 'Class',
				project: 'Dự án',
				department: 'Phòng ban của dòng',
				labor: 'Loại lao động',
				date: 'Ngày cuối kỳ lương',
				any: 'Không chọn',
				run: 'Thử',
				result: 'Tài khoản được chọn',
				none: 'Không có tài khoản nào: chưa khai tài khoản chi phí lương mặc định.',
				by: {W: 'theo class', P: 'theo dự án', D: 'theo phòng ban của dòng', default: 'tài khoản mặc định', none: ''},
				level: {W: 'Class', P: 'Dự án', D: 'Phòng ban của dòng', default: 'Mặc định'},
				notGiven: 'không chọn',
				noMatch: 'không có dòng khớp',
				skip: 'Ô thử không xét mức 4 và 5 vì phụ thuộc từng nhân viên.',
				unreadable: 'Không đọc được bảng tài khoản theo đích; kết quả chỉ gồm tài khoản mặc định.',
				steps: 'Kết quả từng mức',
			},
		},
		apv: {
			title: 'Cấp duyệt bảng lương',
			sub: 'Mỗi dòng là một người duyệt của một cấp; nhiều dòng cùng cấp là người duyệt thay thế nhau (một người duyệt là đủ).',
			rule: 'Quy tắc: công ty con có dòng riêng thì chỉ dùng dòng riêng, không thì dùng dòng chung (không ghi công ty con). Dòng có ngưỡng lớn hơn tổng thực lĩnh của bảng lương được bỏ qua. Không khai dòng nào thì bảng lương duyệt một cấp như trước.',
			add: 'Thêm người duyệt',
			search: 'Tìm cấp, tên cấp, người duyệt, công ty con',
			unavailable: 'Không đọc được bảng cấp duyệt: bảng chưa được cài hoặc vai trò của bạn chưa có quyền.',
			empty: 'Chưa khai cấp duyệt nào: bảng lương đang duyệt một cấp như trước.',
			emptyFilter: 'Không có dòng nào ở nhóm này.',
			chips: {active: 'Đang dùng', all: 'Tất cả', label: 'Lọc dòng cấp duyệt'},
			cols: {level: 'Cấp', name: 'Tên cấp', approver: 'Người duyệt', minNet: 'Ngưỡng tổng thực lĩnh', subsidiary: 'Công ty con', state: 'Tình trạng', act: 'Thao tác'},
			roles: {H: 'Vai trò Nhân sự', A: 'Vai trò Kế toán', D: 'Administrator'},
			always: 'Luôn cần',
			fromAmount: (v) => `Từ ${v}`,
			shared: 'Mọi công ty con',
			states: {inUse: 'Đang áp dụng', replaced: 'Bị dòng riêng thay', otherSubsidiary: 'Công ty con khác', inactive: 'Ngừng dùng', invalid: 'Thiếu người duyệt'},
			effective: (name) => `Áp dụng cho ${name}`,
			effectiveShared: 'Áp dụng khi không chọn công ty con',
			single: 'Duyệt một cấp như trước (chưa có dòng nào áp dụng).',
			levelName: (n, name) => `Cấp ${n}${name ? ` - ${name}` : ''}`,
			or: 'hoặc',
			retireOf: (name) => `Ngừng dùng dòng ${name}`,
			restoreOf: (name) => `Dùng lại dòng ${name}`,
			editOf: (name) => `Sửa dòng ${name}`,
			confirmRetire: (name) => `Ngừng dùng dòng "${name}"? Dòng không bị xóa; bảng lương gửi duyệt từ nay không cần người này duyệt.`,
			retired: 'Đã ngừng dùng dòng cấp duyệt.',
			restored: 'Đã dùng lại dòng cấp duyệt.',
			saved: 'Đã lưu cấp duyệt. Áp dụng cho bảng lương gửi duyệt từ nay.',
			form: {
				titleNew: 'Thêm người duyệt',
				titleEdit: 'Sửa người duyệt',
				level: 'Cấp',
				levelHint: 'Số nguyên từ 1; duyệt lần lượt từ cấp nhỏ đến cấp lớn.',
				name: 'Tên cấp',
				nameHint: 'Ví dụ: Kế toán trưởng, Giám đốc.',
				approver: 'Người duyệt (nhân viên)',
				approverPick: 'Không chọn - dùng vai trò',
				approverHint: 'Chọn nhân viên cụ thể, hoặc để trống và chọn vai trò.',
				role: 'Vai trò duyệt',
				rolePick: 'Không chọn',
				roleHint: 'Bất kỳ ai đăng nhập bằng vai trò này đều duyệt được cấp này. Không dùng khi đã chọn nhân viên.',
				minNet: 'Ngưỡng tổng thực lĩnh',
				minNetHint: 'Chỉ cần dòng này khi tổng thực lĩnh của bảng lương từ ngưỡng trở lên. Trống: luôn cần.',
				subsidiary: 'Công ty con',
				subsidiaryHint: 'Trống: áp dụng cho mọi công ty con chưa có dòng riêng.',
				errLevel: 'Cấp phải là số nguyên từ 1.',
				errName: 'Chưa nhập tên cấp.',
				errWho: 'Chọn người duyệt hoặc vai trò duyệt.',
				errNet: 'Ngưỡng tổng thực lĩnh phải là số không âm.',
			},
		},
		periodsSec: {
			title: 'Kỳ lương',
			sub: 'Sinh kỳ theo năm cho từng nhóm lương, đóng kỳ sau khi ghi sổ xong. Khóa và mở khóa công làm ở màn Chấm công.',
			generate: 'Sinh kỳ',
			year: 'Năm',
			paygroup: 'Nhóm lương',
			allGroups: 'Mọi nhóm lương',
			allYears: 'Mọi năm',
			search: 'Tìm mã kỳ, nhóm lương, ngày',
			empty: 'Chưa có kỳ lương nào. Bấm Sinh kỳ để tạo các kỳ của năm.',
			emptyFilter: 'Không có kỳ nào khớp bộ lọc.',
			cols: {code: 'Mã kỳ', paygroup: 'Nhóm lương', start: 'Từ ngày', end: 'Đến ngày', stdDays: 'Ngày công chuẩn', taxMonth: 'Tháng thuế', status: 'Trạng thái kỳ', att: 'Trạng thái công', act: 'Thao tác'},
			status: {O: 'Mở', C: 'Đã đóng'},
			att: {O: 'Công mở', L: 'Công đã khóa'},
			current: 'Kỳ hiện tại',
			close: 'Đóng kỳ',
			reopen: 'Mở lại kỳ',
			attendance: 'Chấm công',
			closeOf: (code) => `Đóng kỳ ${code}`,
			reopenOf: (code) => `Mở lại kỳ ${code}`,
			attendanceOf: (code) => `Mở chấm công kỳ ${code}`,
			confirmClose: (code) => `Đóng kỳ ${code}? Kỳ đã đóng không tạo thêm bảng lương được. Hệ thống từ chối nếu kỳ còn bảng lương chưa ghi sổ.`,
			confirmReopen: (code) => `Mở lại kỳ ${code}? Kỳ mở lại cho phép tạo và sửa bảng lương của kỳ.`,
			closed: (code) => `Đã đóng kỳ ${code}.`,
			reopened: (code) => `Đã mở lại kỳ ${code}.`,
			genTitle: 'Sinh kỳ lương',
			genRun: (y) => (/^\d{4}$/.test(String(y || '').trim()) ? `Sinh các kỳ năm ${String(y).trim()}` : 'Sinh các kỳ'),
			genHint: 'Kỳ đã có (theo mã) không sinh lại. Ngày công chuẩn tính theo ngày nghỉ tuần và ngày lễ đã khai.',
			genNeedSetup: 'Hãy nạp mặc định VN trước khi sinh kỳ.',
			errYear: 'Năm gồm 4 chữ số.',
			errGroup: 'Chưa chọn nhóm lương.',
			generated: (n, skipped) => `Đã sinh ${n} kỳ${skipped ? `, ${skipped} kỳ đã có sẵn` : ''}.`,
			total: (n) => `${n} kỳ`,
		},
		legal: {
			title: 'Tham số pháp lý',
			sub: 'Giá trị theo văn bản pháp luật và ngày hiệu lực. Màn này chỉ xem và đánh dấu đã đối chiếu; sửa giá trị trên bản ghi NetSuite.',
			tabs: {params: 'Tham số', brackets: 'Biểu thuế TNCN', components: 'Khoản trích theo lương'},
			tabsLabel: 'Nhóm dữ liệu pháp lý',
			search: 'Tìm mã, diễn giải, căn cứ, giá trị',
			chips: {all: 'Tất cả', unverified: 'Chưa đối chiếu', label: 'Lọc tham số'},
			groups: {PIT: 'Thuế TNCN', INS: 'Bảo hiểm', MINWAGE: 'Lương tối thiểu vùng', OT: 'Làm thêm giờ'},
			cols: {
				code: 'Mã', description: 'Diễn giải', value: 'Giá trị', effective: 'Hiệu lực từ', expiration: 'Đến', legalRef: 'Căn cứ pháp lý', verified: 'Đối chiếu', act: 'Thao tác',
				level: 'Bậc', upper: 'Thu nhập tính thuế đến', rate: 'Thuế suất', name: 'Khoản trích', ee: 'Người lao động', er: 'Doanh nghiệp', cap: 'Hệ số trần', state: 'Tình trạng',
			},
			verified: 'Đã đối chiếu',
			unverified: 'Chưa đối chiếu',
			current: 'Đang hiệu lực',
			notCurrent: 'Ngoài hiệu lực',
			topBracket: 'Bậc cao nhất',
			verify: 'Đánh dấu đã đối chiếu',
			verifyOf: (code) => `Đánh dấu đã đối chiếu ${code}`,
			confirmVerify: (p) => `Xác nhận đã đối chiếu tham số ${p.code} (${p.description || ''}) = ${p.valueText}, hiệu lực từ ${p.effectiveText}, với văn bản gốc${p.legalRef ? `: ${p.legalRef}` : ''}?\n\nThao tác chỉ đổi cờ đối chiếu, không đổi giá trị. Nếu giá trị chưa đúng, hãy sửa trên bản ghi NetSuite trước.`,
			verifiedDone: (code) => `Đã đánh dấu đối chiếu ${code}.`,
			empty: 'Chưa có dữ liệu. Hãy nạp mặc định VN.',
			emptyFilter: 'Không có tham số nào khớp bộ lọc.',
			unverifiedNote: (n) => `${n} tham số chưa đối chiếu văn bản gốc - đã đưa lên đầu lưới. Kế toán trưởng cần kiểm tra trước khi dùng để tính lương chính thức.`,
		},
	},
	en: {
		title: 'Setup',
		sub: 'Setup status of the payroll module. Missing items and items needing attention are flagged so you can handle them first.',
		refresh: 'Refresh',
		legacy: 'Previous screen',
		loading: 'Loading...',
		working: 'Working...',
		noSubsidiary: 'No subsidiary selected.',
		hrOnly: 'Only HR (or an administrator) can change this.',
		acctOnly: 'Only accounting (or an administrator) can change accounts.',
		open: 'Open',
		openList: 'List',
		openListLong: 'Open NetSuite list',
		openListTitle: 'Open the NetSuite record list in a new tab',
		noList: 'This record type was not found in the account.',
		save: 'Save',
		cancel: 'Cancel',
		edit: 'Edit',
		yes: 'Yes',
		no: 'No',
		inherit: 'Inherit general setup',
		inherited: (v) => `Inherited (${v})`,
		notSet: 'Not set',
		renderError: 'This section could not be displayed.',
		search: 'Search setup items',
		filter: {all: 'All', todo: 'To do', optional: 'Optional', label: 'Filter by status'},
		state: {ok: 'Complete', missing: 'Missing', attention: 'Attention', optional: 'Optional', unknown: 'Unreadable'},
		count: (n) => `${n} records`,
		none: 'No matching items.',
		summary: (s) => `${s.missing || 0} missing, ${s.attention || 0} need attention`,
		summaryOk: 'All required items are complete',
		sections: {start: 'Getting started', company: 'Company and accounts', periods: 'Periods and pay groups', legal: 'Statutory', earnings: 'Earnings and rules', attendance: 'Attendance and leave', output: 'Output and teams'},
		items: {
			defaults: {name: 'Load VN defaults', desc: 'Statutory parameters, tax brackets, contributions, holidays, earning types, leave types, the DEFAULT pay group and general setup.'},
			industry: {name: 'Industry pack', desc: 'Sample earning types, pay groups, rate tables and rules for construction, trade and manufacturing.'},
			employees: {name: 'Employee payroll profiles', desc: 'Employees of the selected subsidiary have payroll profiles.'},
			general: {name: 'General setup', desc: 'Standard days, default earning types, approval, hours, allocation, 13th-month accrual.'},
			company: {name: 'Subsidiary setup', desc: 'Values specific to the selected subsidiary and report signers; empty fields inherit the general setup.'},
			accounts: {name: 'Default GL accounts', desc: 'Accounts for wages payable, PIT, advances, default expense, tax authority.'},
			insAccounts: {name: 'Insurance accounts by component', desc: 'Payable account and agency of each payroll contribution.'},
			costAccounts: {name: 'Payroll expense accounts by target', desc: 'Specific expense accounts by project, class or department.'},
			security: {name: 'Role security', desc: 'The run-as role of the employee portal must not be assigned to any user.'},
			approvals: {name: 'Payroll approval levels', desc: 'Levels that must approve a payroll batch before release, their approvers and net pay thresholds.'},
			paygroups: {name: 'Pay groups', desc: 'Period frequency, standard days and attendance source of each group.'},
			periods: {name: 'Pay periods', desc: 'Generate periods by year, close and reopen periods, attendance status.'},
			params: {name: 'Statutory parameters', desc: 'Deductions, reference wage, regional minimum wages, overtime factors by effective date.'},
			pitBrackets: {name: 'PIT brackets', desc: 'Progressive brackets by effective date.'},
			insComps: {name: 'Payroll contributions', desc: 'Employee and employer rates for social, health, unemployment insurance and union fund.'},
			holidays: {name: 'Public holidays', desc: 'Holiday calendar used for standard days and holiday overtime.'},
			earningTypes: {name: 'Earning types', desc: 'Wages, allowances, overtime, bonuses and their tax treatment.'},
			earningRules: {name: 'Earning rules', desc: 'How each earning is calculated in a payroll run.'},
			benefitPkgs: {name: 'Benefit packages', desc: 'Sets of allowances assigned to payroll profiles.'},
			leaveTypes: {name: 'Leave types', desc: 'Annual leave, unpaid leave, social insurance leave.'},
			leavePolicies: {name: 'Annual leave policies', desc: 'Leave days, seniority, carry-over.'},
			attSymbols: {name: 'Attendance symbols', desc: 'Symbols used on the attendance sheet.'},
			attRules: {name: 'Late and early deduction rules', desc: 'Minutes late or early and the deduction.'},
			shifts: {name: 'Shifts', desc: 'Start time, end time, break.'},
			shiftPatterns: {name: 'Shift patterns', desc: 'Shift cycles used for rostering.'},
			rateTables: {name: 'Rate tables', desc: 'Piece rates, operations, products, commission tiers.'},
			teams: {name: 'Teams', desc: 'Crews, lines, stores and how team pay is split.'},
		},
		accountCount: (n) => `${n}/8 set`,
		insCount: (n) => `${n} contributions in effect`,
		packCount: (n) => `${n} packs loaded`,
		levelCount: (n) => (n === 1 ? '1 level' : `${n} levels`),
		employeeCount: (n) => `${n} profiles`,
		periodCount: (n, last) => (last ? `${n} periods, up to ${last}` : `${n} periods`),
		issues: {
			UNREADABLE: () => 'Your role cannot read this table, or the table is not installed.',
			EMPTY: () => 'No records yet.',
			NONE: () => 'Not used.',
			NOT_LOADED: () => 'VN defaults have not been loaded.',
			NO_SETUP: () => 'No general setup yet: load the VN defaults.',
			NO_BASE_EARNING: () => 'The base salary earning type is not selected.',
			NO_SUBSIDIARY: () => 'No subsidiary selected.',
			INHERITS: () => 'No specific record: the subsidiary uses the general setup.',
			COMPANY_DISABLED: () => 'Payroll is turned off for this subsidiary.',
			NO_SIGNERS: () => 'Preparer, chief accountant and director are not set for printed reports.',
			ESS_ROLE_ASSIGNED: (i) => `The role "S4VP Self-service (run-as only)" is assigned to ${i.count} user(s). This role can read every employee's pay: remove it from users (Setup > Users/Roles > Manage Users).`,
			NO_EMPLOYEES: () => 'This subsidiary has no payroll profile yet.',
			ACCOUNTS_MISSING: (i, t) => `Required accounts missing: ${i.list.map((k) => t.accountNames[k] || k).join(', ')}.`,
			ACCOUNTS_OPTIONAL: (i, t) => `Not set: ${i.list.map((k) => t.accountNames[k] || k).join(', ')}.`,
			INS_NO_ACCOUNT: (i) => `No payable account: ${i.list.join(', ')}.`,
			INS_NO_VENDOR: (i) => `No agency: ${i.list.join(', ')}.`,
			UNVERIFIED: (i) => `${i.n} parameters not verified against the legal source: ${i.list.join(', ')}${i.n > i.list.length ? '...' : ''}.`,
			NO_HOLIDAYS_YEAR: (i) => `No public holidays for ${i.n}.`,
			NO_PERIODS: () => 'No pay periods generated yet.',
			NO_CURRENT: (i) => `No period contains today: ${i.list.join(', ')}.`,
			NEXT_MISSING: (i) => `The next period is not generated: ${i.list.join(', ')}.`,
			GROUP_WITHOUT_PERIODS: (i) => `Pay groups without periods: ${i.list.join(', ')}.`,
			SINGLE_LEVEL: () => 'No approval levels set - payroll batches use single-level approval as before.',
			APPROVER_MISSING: (i) => `${i.n} rows have no approver or approver role.`,
		},
		accountNames: {
			acc_payable: 'Wages payable account (334)', acc_expense: 'Default payroll expense account', acc_pit: 'PIT payable account (3335)', acc_advance: 'Advance account (141)',
			acc_other_ded: 'Other deductions account', acc_13th: '13th-month accrual account (335)', acc_contractor: 'Contractor payable account (3388 / 331)', pit_vendor: 'Tax authority', location: 'Default location for documents',
		},
		accountHints: {
			acc_payable: 'Required: credited when payroll is released, debited when wages are paid.',
			acc_expense: 'Required: used when no target account applies and the employee profile has no account.',
			acc_pit: 'Required: PIT withheld and payable.',
			acc_advance: 'Needed to post payroll advances and offset them through payroll.',
			acc_other_ded: 'After-tax deductions entered manually on a payroll batch.',
			acc_13th: 'Needed for the monthly 13th-month accrual.',
			acc_contractor: 'Fees payable to contractors; when empty, account 334 is used.',
			pit_vendor: 'Vendor representing the tax authority for PIT payment bills.',
			location: 'Used on payroll journals and bills when the NetSuite account requires a location.',
		},
		first: {
			title: 'First-time setup',
			sub: 'Go through the steps in order. Optional steps can be skipped.',
			done: 'Done',
			todo: 'To do',
			optional: 'Optional',
			label: 'First-time setup sequence',
			steps: {
				defaults: {name: 'Load VN defaults', desc: 'Creates statutory parameters, lists and the general setup. Only adds what is missing; running it again overwrites nothing.', action: 'Load VN defaults', again: 'Load missing defaults'},
				industry: {name: 'Choose an industry pack', desc: 'For construction, trade or manufacturing: load sample lists and rules for the industry.', action: 'Choose a pack', again: 'Choose a pack'},
				accounts: {name: 'Set GL accounts', desc: 'Default accounts and the payable account of each insurance component - set by accounting.', action: 'Set accounts', again: 'View accounts'},
				periods: {name: 'Generate pay periods', desc: 'Generate the periods of the year for the pay groups in use.', action: 'Generate periods', again: 'View periods'},
				employees: {name: 'Load employees', desc: 'Create payroll profiles, contracts and pay rates for employees.', action: 'Open Employees', again: 'Open Employees'},
			},
		},
		defaults: {
			confirm: 'Load missing VN defaults? Only missing items are added (matched by code and effective date); existing data is not overwritten.',
			done: (created, skipped) => `VN defaults loaded: ${created} records added, ${skipped} already existed.`,
		},
		pack: {
			title: 'Load an industry pack',
			intro: 'A pack only adds what is missing (matched by code). Rules that need an amount decided by the company are loaded inactive so they can be reviewed before use.',
			pick: 'Industry pack',
			pickHint: 'Pay groups of the pack are created for the selected subsidiary.',
			placeholder: 'Select a pack',
			loaded: 'fully loaded',
			load: 'Load pack',
			needDefaults: 'Load the VN defaults first.',
			done: (name, n, skipped) => `Pack ${name} loaded: ${n} items added${skipped ? `; ${skipped} shifts and shift patterns were not loaded automatically` : ''}.`,
		},
		lists: {
			region: {I: 'Region I', II: 'Region II', III: 'Region III', IV: 'Region IV'},
			overtime_source: {R: 'Approved overtime requests', T: 'Timesheet'},
			allocation_method: {S: 'Per setup', T: 'Timesheet hours', F: 'Fixed ratio table', R: 'Rostered days'},
			allocation_fallback: {P: 'Ratio table, then default project', D: 'Default project'},
			alloc_version: {E: 'Version effective at period end', D: 'Split by calendar day'},
			accrual13_basis: {P: 'Contract salary and benefit package', C: 'Contract salary only'},
		},
		general: {
			title: 'General and subsidiary setup',
			sub: 'The general setup applies to every subsidiary; a subsidiary only sets what differs from it.',
			tabs: {setup: 'General', company: (name) => `Subsidiary: ${name}`},
			tabsLabel: 'Setup scope',
			noSetup: 'No general setup yet. Load the VN defaults first.',
			noCompany: 'This subsidiary has no specific record: it uses the general setup. Click Edit on a group to create one.',
			accountsNote: 'GL accounts are set under Default GL accounts.',
			openAccounts: 'Open GL accounts',
			openRecord: 'Open NetSuite record',
			groups: {
				work: 'Work days and wage region', earning: 'Default earning types', insurance: 'Insurance and union', approval: 'Approval and posting', time: 'Hours and attendance',
				alloc: 'Cost allocation', accrual: '13th-month accrual', companyState: 'Status', signers: 'Report signers',
			},
			editTitle: (group, scope) => `Edit: ${group} - ${scope}`,
			scopeSetup: 'general setup',
			saved: 'Setup saved.',
			errNumber: (label) => `${label}: the value must be a number.`,
			errWeekly: 'Weekly days off: enter numbers 0 - 6 separated by commas (0 = Sunday), for example 0,6.',
			fields: {
				std_days: {label: 'Standard work days / month', hint: 'Empty: computed from each period calendar (less weekly days off and holidays).'},
				hours_per_day: {label: 'Standard hours / day', hint: 'Used to convert hourly pay and overtime; usually 8.'},
				weekly_off: {label: 'Weekly days off', hint: '0 = Sunday ... 6 = Saturday, separated by commas. Example 0,6.'},
				region: {label: 'Minimum wage region', hint: 'Used for the regional minimum wage check and the unemployment insurance cap.'},
				base_et: {label: 'Base salary earning type', hint: 'The contract salary line on a payroll batch.'},
				allow_et: {label: 'Allowance earning type', hint: 'Fixed allowance set on the payroll profile.'},
				meal_et: {label: 'Meal allowance earning type', hint: 'Mid-shift meal, tax exempt up to the cap.'},
				ctr_et: {label: 'Contractor fee earning type', hint: 'Used for service contracts, 10% withholding.'},
				payout_et: {label: 'Leave payout earning type', hint: 'Payment of unused leave days at termination.'},
				meal_amount: {label: 'Meal allowance / month', hint: 'Default meal amount for a full month.'},
				union_fund: {label: 'Employer pays the union fund', hint: 'Turn off when the company is not subject to the 2% fund.'},
				accident_rate: {label: 'Accident insurance rate override', hint: 'Decimal, for example 0.003. Empty: the component rate is used.'},
				ext_ot: {label: 'Sector allowed 300 overtime hours / year', hint: 'When on, the yearly overtime limit is 300 hours instead of 200.'},
				require_approval: {label: 'Payroll approval required', hint: 'A payroll batch must be approved before release.'},
				auto_approve: {label: 'Auto-approve journals and bills created by payroll', hint: 'For accounts that use journal or bill approval.'},
				time_approval: {label: 'Approved hours only', hint: 'Only approved timesheet entries count as payroll hours.'},
				ot_source: {label: 'Overtime hours source', hint: 'Overtime hours come from approved overtime requests or from timesheets.'},
				require_lock: {label: 'Attendance lock required before calculation', hint: 'Blocks calculation while the period attendance is not locked.'},
				leave_policy: {label: 'Default leave policy', hint: 'Applies to employees without their own policy.'},
				wp_blocks: {label: 'Block payroll without a work permit', hint: 'Applies to foreign workers with an expired or missing permit.'},
				alloc_method: {label: 'Allocation method', hint: 'How payroll cost is split across projects, departments, classes.'},
				alloc_fallback: {label: 'Fallback allocation', hint: 'Used when the main method has no data in the period.'},
				alloc_version: {label: 'Ratio table version mode', hint: 'When the ratio table changes mid-period: use the period-end version or split by day.'},
				acc13_basis: {label: '13th-month accrual basis', hint: 'The earnings used to compute the monthly accrual.'},
				acc13_months: {label: 'Months to spread the accrual', hint: 'Usually 12: 1/12 is accrued each month.'},
				enabled: {label: 'Payroll enabled for the subsidiary', hint: 'When off, the subsidiary is not offered for selection.'},
				preparer: {label: 'Preparer', hint: 'Printed on payroll registers and declarations.'},
				chief_accountant: {label: 'Chief accountant', hint: 'Printed on payroll registers and declarations.'},
				director: {label: 'Director', hint: 'Printed on payroll registers and declarations.'},
			},
		},
		accounts: {
			title: 'GL accounts',
			sub: 'Default accounts for payroll posting and the payable account of each insurance component. A subsidiary uses its own account where set, otherwise the general setup.',
			tabs: {defaults: 'Default accounts', ins: 'Insurance accounts'},
			tabsLabel: 'Account groups',
			search: 'Search item, account number',
			editSetup: 'Edit general accounts',
			editCompany: 'Edit for the subsidiary',
			cols: {item: 'Item', common: 'General setup', company: 'Subsidiary', effective: 'In effect', state: 'Status'},
			required: 'Required',
			missing: 'Missing',
			set: 'Set',
			optional: 'Not set',
			titleSetup: 'Default accounts - general setup',
			titleCompany: (name) => `Default accounts - ${name}`,
			companyHint: 'Leave a field empty to use the account of the general setup.',
			pickAccount: 'Not set',
			saved: 'Accounts saved.',
			ins: {
				search: 'Search contribution, account, agency',
				cols: {code: 'Code', name: 'Contribution', ee: 'Employee', er: 'Employer', account: 'Payable account', vendor: 'Agency', state: 'Status'},
				expired: 'Expired',
				noAccount: 'No account',
				noVendor: 'No agency',
				ok: 'Complete',
				editTitle: (code) => `Accounts of contribution ${code}`,
				hint: 'Saved on every row (every effective date) of this contribution.',
				account: 'Payable account (338x)',
				vendor: 'Agency',
				vendorHint: 'Used when creating the payment bill for the agency.',
				empty: 'No contributions yet. Load the VN defaults.',
			},
		},
		cost: {
			title: 'Payroll expense accounts by target',
			sub: 'Assign a specific expense account to a project, class or department. An allocation line matching no target uses the employee profile account, then the default account.',
			add: 'Add account',
			search: 'Search target, account, subsidiary',
			unavailable: 'The target account table cannot be read: it is not installed or your role has no access.',
			empty: 'No target accounts yet: all payroll cost goes to the employee profile account or the default account.',
			emptyFilter: 'No rows in this group.',
			chips: {active: 'In use', all: 'All', label: 'Filter account rows'},
			cols: {type: 'Target type', target: 'Target', labor: 'Labor type', account: 'Expense account', subsidiary: 'Subsidiary', effective: 'Effective from', state: 'Status', act: 'Actions'},
			types: {W: 'Class', P: 'Project', D: 'Department'},
			labor: {E: 'Employees', C: 'Contractors', all: 'All types'},
			shared: 'Shared',
			always: 'Always effective',
			states: {inUse: 'Applied', overridden: 'Replaced by another row', future: 'Not yet effective', otherSubsidiary: 'Other subsidiary', accountInactive: 'Account inactive', inactive: 'Retired', invalid: 'No target'},
			retire: 'Retire',
			restore: 'Restore',
			retireOf: (name) => `Retire row ${name}`,
			restoreOf: (name) => `Restore row ${name}`,
			editOf: (name) => `Edit row ${name}`,
			confirmRetire: (name, account) => `Retire row "${name}" (account ${account})? The row is not deleted; from the next calculation the cost of this target follows the next priority level.`,
			retired: 'Account row retired.',
			restored: 'Account row restored.',
			saved: 'Target account saved. Recalculated payroll batches will use the new account.',
			form: {
				titleNew: 'Add target account',
				titleEdit: 'Edit target account',
				type: 'Target type',
				target: 'Target',
				targetPick: 'Select a target',
				labor: 'Labor type',
				laborHint: 'A row for one labor type is used before a row for all types.',
				account: 'Expense account',
				accountPick: 'Select an account',
				subsidiary: 'Subsidiary',
				subsidiaryHint: 'A row for one subsidiary replaces the shared row for the same target.',
				effective: 'Effective from',
				effectiveHint: 'Empty: always effective. The latest row effective on or before the period end is used.',
				note: 'Note',
				errTarget: 'Select a target.',
				errAccount: 'Select an expense account.',
				errDate: 'Invalid effective date (dd/mm/yyyy).',
			},
			priority: {
				title: 'Priority when posting',
				label: 'Priority order for the expense account',
				levels: [
					'Class of the allocation line',
					'Project of the allocation line',
					'Own department of the allocation line',
					'Expense account on the employee payroll profile',
					'Employee department (when the line has no department of its own)',
					'Default payroll expense account',
				],
				note: 'Within a level: a row for the labor type before a row for all types; a subsidiary row before a shared row; then the latest effective date.',
			},
			test: {
				title: 'Test account selection',
				sub: 'Select the targets of an allocation line to see the account that will be used.',
				workCenter: 'Class',
				project: 'Project',
				department: 'Line department',
				labor: 'Labor type',
				date: 'Pay period end date',
				any: 'None',
				run: 'Test',
				result: 'Selected account',
				none: 'No account: the default payroll expense account is not set.',
				by: {W: 'by class', P: 'by project', D: 'by line department', default: 'default account', none: ''},
				level: {W: 'Class', P: 'Project', D: 'Line department', default: 'Default'},
				notGiven: 'not selected',
				noMatch: 'no matching row',
				skip: 'The test does not cover levels 4 and 5 because they depend on each employee.',
				unreadable: 'The target account table cannot be read; the result only covers the default account.',
				steps: 'Result by level',
			},
		},
		apv: {
			title: 'Payroll approval levels',
			sub: 'Each row is one approver of a level; several rows on the same level are alternative approvers (one approval is enough).',
			rule: 'Rule: a subsidiary that has its own rows uses only those rows, otherwise the shared rows (no subsidiary) apply. Rows whose threshold is above the batch net pay total are skipped. With no rows, payroll batches use single-level approval as before.',
			add: 'Add approver',
			search: 'Search level, level name, approver, subsidiary',
			unavailable: 'The approval level table cannot be read: it is not installed or your role has no access.',
			empty: 'No approval levels yet: payroll batches use single-level approval as before.',
			emptyFilter: 'No rows in this group.',
			chips: {active: 'In use', all: 'All', label: 'Filter approval rows'},
			cols: {level: 'Level', name: 'Level name', approver: 'Approver', minNet: 'Net pay threshold', subsidiary: 'Subsidiary', state: 'Status', act: 'Actions'},
			roles: {H: 'HR role', A: 'Accountant role', D: 'Administrator'},
			always: 'Always',
			fromAmount: (v) => `From ${v}`,
			shared: 'All subsidiaries',
			states: {inUse: 'Applied', replaced: 'Replaced by own rows', otherSubsidiary: 'Other subsidiary', inactive: 'Retired', invalid: 'No approver'},
			effective: (name) => `Applies to ${name}`,
			effectiveShared: 'Applies when no subsidiary is selected',
			single: 'Single-level approval as before (no row applies).',
			levelName: (n, name) => `Level ${n}${name ? ` - ${name}` : ''}`,
			or: 'or',
			retireOf: (name) => `Retire row ${name}`,
			restoreOf: (name) => `Restore row ${name}`,
			editOf: (name) => `Edit row ${name}`,
			confirmRetire: (name) => `Retire row "${name}"? The row is not deleted; batches submitted from now on no longer need this approver.`,
			retired: 'Approval row retired.',
			restored: 'Approval row restored.',
			saved: 'Approval levels saved. They apply to batches submitted from now on.',
			form: {
				titleNew: 'Add approver',
				titleEdit: 'Edit approver',
				level: 'Level',
				levelHint: 'Whole number from 1; levels approve in ascending order.',
				name: 'Level name',
				nameHint: 'For example: Chief accountant, Director.',
				approver: 'Approver (employee)',
				approverPick: 'None - use a role',
				approverHint: 'Select a specific employee, or leave empty and select a role.',
				role: 'Approver role',
				rolePick: 'None',
				roleHint: 'Anyone signed in with this role can approve the level. Not used when an employee is selected.',
				minNet: 'Net pay threshold',
				minNetHint: 'This row is needed only when the batch net pay total is at least this amount. Empty: always needed.',
				subsidiary: 'Subsidiary',
				subsidiaryHint: 'Empty: applies to every subsidiary without its own rows.',
				errLevel: 'The level must be a whole number from 1.',
				errName: 'Enter the level name.',
				errWho: 'Select an approver or an approver role.',
				errNet: 'The net pay threshold must be a non-negative number.',
			},
		},
		periodsSec: {
			title: 'Pay periods',
			sub: 'Generate periods by year for each pay group, close a period once it is fully released. Attendance is locked and unlocked on the Attendance screen.',
			generate: 'Generate periods',
			year: 'Year',
			paygroup: 'Pay group',
			allGroups: 'All pay groups',
			allYears: 'All years',
			search: 'Search period, pay group, date',
			empty: 'No pay periods yet. Click Generate periods to create the periods of a year.',
			emptyFilter: 'No periods match the filter.',
			cols: {code: 'Period', paygroup: 'Pay group', start: 'From', end: 'To', stdDays: 'Standard days', taxMonth: 'Tax month', status: 'Period status', att: 'Attendance status', act: 'Actions'},
			status: {O: 'Open', C: 'Closed'},
			att: {O: 'Attendance open', L: 'Attendance locked'},
			current: 'Current period',
			close: 'Close',
			reopen: 'Reopen',
			attendance: 'Attendance',
			closeOf: (code) => `Close period ${code}`,
			reopenOf: (code) => `Reopen period ${code}`,
			attendanceOf: (code) => `Open attendance for period ${code}`,
			confirmClose: (code) => `Close period ${code}? No more payroll batches can be created in a closed period. The system refuses when the period still has unreleased batches.`,
			confirmReopen: (code) => `Reopen period ${code}? A reopened period allows payroll batches to be created and changed.`,
			closed: (code) => `Period ${code} closed.`,
			reopened: (code) => `Period ${code} reopened.`,
			genTitle: 'Generate pay periods',
			genRun: (y) => (/^\d{4}$/.test(String(y || '').trim()) ? `Generate periods for ${String(y).trim()}` : 'Generate periods'),
			genHint: 'Existing periods (by code) are not generated again. Standard days follow the weekly days off and holidays on file.',
			genNeedSetup: 'Load the VN defaults before generating periods.',
			errYear: 'The year has 4 digits.',
			errGroup: 'Select a pay group.',
			generated: (n, skipped) => `${n} periods generated${skipped ? `, ${skipped} already existed` : ''}.`,
			total: (n) => `${n} periods`,
		},
		legal: {
			title: 'Statutory parameters',
			sub: 'Values from legal documents by effective date. This screen is view only plus marking as verified; change values on the NetSuite record.',
			tabs: {params: 'Parameters', brackets: 'PIT brackets', components: 'Payroll contributions'},
			tabsLabel: 'Statutory data groups',
			search: 'Search code, description, legal basis, value',
			chips: {all: 'All', unverified: 'Not verified', label: 'Filter parameters'},
			groups: {PIT: 'Personal income tax', INS: 'Insurance', MINWAGE: 'Regional minimum wage', OT: 'Overtime'},
			cols: {
				code: 'Code', description: 'Description', value: 'Value', effective: 'Effective from', expiration: 'To', legalRef: 'Legal basis', verified: 'Verification', act: 'Actions',
				level: 'Bracket', upper: 'Assessable income up to', rate: 'Rate', name: 'Contribution', ee: 'Employee', er: 'Employer', cap: 'Cap factor', state: 'Status',
			},
			verified: 'Verified',
			unverified: 'Not verified',
			current: 'In effect',
			notCurrent: 'Not in effect',
			topBracket: 'Top bracket',
			verify: 'Mark as verified',
			verifyOf: (code) => `Mark ${code} as verified`,
			confirmVerify: (p) => `Confirm that parameter ${p.code} (${p.description || ''}) = ${p.valueText}, effective from ${p.effectiveText}, was verified against the legal source${p.legalRef ? `: ${p.legalRef}` : ''}?\n\nThis only changes the verification flag, not the value. If the value is wrong, correct it on the NetSuite record first.`,
			verifiedDone: (code) => `${code} marked as verified.`,
			empty: 'No data yet. Load the VN defaults.',
			emptyFilter: 'No parameters match the filter.',
			unverifiedNote: (n) => `${n} parameters are not verified against the legal source - they are listed first. The chief accountant should check them before they are used for official payroll.`,
		},
	},
};

// ------------------------------------------------------------------ hằng và hàm thuần

const list = (v) => (Array.isArray(v) ? v : []);
const blank = (v) => v === null || v === undefined || v === '';
const STATE_TONE = {ok: 'ok', missing: 'error', attention: 'warn', optional: 'muted', unknown: 'muted'};
const TODO_STATES = ['missing', 'attention', 'unknown'];
const TABLE_HEIGHT = 'max(240px, calc(100vh - 318px))';

// Mục của bảng tình trạng: section = mục dựng trong SPA; list = khóa trong boot.recordTypeIds để mở danh sách NetSuite
const ITEMS = {
	defaults: {run: 'defaults'},
	industry: {run: 'industry'},
	employees: {go: 'employees'},
	general: {section: 'general'},
	company: {section: 'general', tab: 'company'},
	accounts: {section: 'accounts'},
	insAccounts: {section: 'accounts', tab: 'ins'},
	costAccounts: {section: 'costAccounts'},
	security: {},
	approvals: {section: 'approvals', list: 'approval_step'},
	paygroups: {list: 'paygroup'},
	periods: {section: 'periods', list: 'period'},
	params: {section: 'legal', list: 'param'},
	pitBrackets: {section: 'legal', tab: 'brackets', list: 'pit_bracket'},
	insComps: {section: 'legal', tab: 'components', list: 'ins_comp'},
	holidays: {list: 'holiday'},
	earningTypes: {list: 'earning_type'},
	earningRules: {list: 'earning_rule'},
	benefitPkgs: {list: 'benefit_pkg'},
	leaveTypes: {list: 'leave_type'},
	leavePolicies: {list: 'leave_policy'},
	attSymbols: {list: 'att_symbol'},
	attRules: {list: 'att_rule'},
	shifts: {list: 'shift'},
	shiftPatterns: {list: 'shift_pattern'},
	rateTables: {list: 'rate_table'},
	teams: {list: 'team'},
};

// Kiểu ô: num, money, text, bool, inherit (Có / Không / kế thừa), list:<tên>, et (loại thu nhập), policy (chính sách phép)
const FIELD_TYPES = {
	std_days: 'num', hours_per_day: 'num', weekly_off: 'text', region: 'list:region', base_et: 'et', allow_et: 'et', meal_et: 'et', ctr_et: 'et', payout_et: 'et', meal_amount: 'money',
	union_fund: 'bool', accident_rate: 'num', ext_ot: 'bool', require_approval: 'bool', auto_approve: 'bool', time_approval: 'bool', ot_source: 'list:overtime_source', require_lock: 'bool',
	leave_policy: 'policy', wp_blocks: 'bool', alloc_method: 'list:allocation_method', alloc_fallback: 'list:allocation_fallback', alloc_version: 'list:alloc_version',
	acc13_basis: 'list:accrual13_basis', acc13_months: 'num', enabled: 'bool', preparer: 'text', chief_accountant: 'text', director: 'text',
};
const COMPANY_TYPES = {union_fund: 'inherit', ext_ot: 'inherit'};
const SETUP_GROUPS = [
	{key: 'work', fields: ['std_days', 'hours_per_day', 'weekly_off', 'region']},
	{key: 'earning', fields: ['base_et', 'allow_et', 'meal_et', 'ctr_et', 'payout_et', 'meal_amount']},
	{key: 'insurance', fields: ['union_fund', 'accident_rate', 'ext_ot']},
	{key: 'approval', fields: ['require_approval', 'auto_approve']},
	{key: 'time', fields: ['time_approval', 'ot_source', 'require_lock', 'leave_policy', 'wp_blocks']},
	{key: 'alloc', fields: ['alloc_method', 'alloc_fallback', 'alloc_version']},
	{key: 'accrual', fields: ['acc13_basis', 'acc13_months']},
];
const COMPANY_GROUPS = [
	{key: 'companyState', fields: ['enabled']},
	{key: 'insurance', fields: ['union_fund', 'region', 'accident_rate', 'ext_ot']},
	{key: 'accrual', fields: ['acc13_basis', 'acc13_months']},
	{key: 'signers', fields: ['preparer', 'chief_accountant', 'director']},
];
const ACCOUNT_KEYS = ['acc_payable', 'acc_expense', 'acc_pit', 'acc_advance', 'acc_other_ded', 'acc_13th', 'acc_contractor', 'pit_vendor', 'location'];
const REQUIRED_ACCOUNTS = ['acc_payable', 'acc_expense', 'acc_pit'];
const APV_TONE = {inUse: 'ok', replaced: 'muted', otherSubsidiary: 'muted', inactive: 'muted', invalid: 'error'};
const COST_TONE = {inUse: 'ok', overridden: 'warn', future: 'info', otherSubsidiary: 'muted', accountInactive: 'error', inactive: 'muted', invalid: 'error'};
const TARGET_LIST = {W: 'classes', P: 'projects', D: 'departments'};

const validIso = (v) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
	if (!m) return false;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
};
// Giá trị pháp lý có thể là tỷ lệ nhỏ (0,003) hoặc số tiền: giữ đủ chữ số thập phân
const plainNumber = (v) => (blank(v) || isNaN(Number(v)) ? '' : Number(v).toLocaleString('vi-VN', {maximumFractionDigits: 6}));
const accountLabel = (a) => (a ? `${a.number || ''} ${a.name || ''}`.trim() : '');

export default function SetupHubView({app}) {
	const t = pick(TEXT);
	const boot = app.boot || {};
	const user = boot.user || {};
	const subsidiary = app.subsidiary || '';
	const params = (app.route && app.route.params) || {};
	const section = String(params.section || '');
	const tab = String(params.tab || '');
	// Ma trận quyền: thiết lập do quản trị + HR sửa (action cũ, boot.user.canEditSetup); tài khoản do quản trị + kế toán sửa
	const isAdmin = user.role === 'administrator';
	const canSetup = isAdmin || !!user.canEditSetup;
	const canAccounts = isAdmin || !!user.isAccountant || user.role === 'customrole_s4vp_accountant';
	const subName = (id) => {
		const s = list(boot.subsidiaries).find((x) => String(x.id) === String(id));
		return s ? s.name : id ? `#${id}` : '';
	};

	const [status, setStatus] = useState(null);
	const [data, setData] = useState(null);
	const [legal, setLegal] = useState(null);
	const [cost, setCost] = useState(null);
	const [lookups, setLookups] = useState(null);
	const [query, setQuery] = useState('');
	const [filter, setFilter] = useState('all');
	const [dialog, setDialog] = useState(null);
	const formRef = useRef({});
	const [form, setForm] = useState(formRef.current);
	const [error, setError] = useState('');
	const [costFilter, setCostFilter] = useState('active');
	const testRef = useRef({workCenter: '', project: '', department: '', laborType: '', date: ''});
	const [testForm, setTestForm] = useState(testRef.current);
	const [testResult, setTestResult] = useState(null);
	const [periodYear, setPeriodYear] = useState('');
	const [periodGroup, setPeriodGroup] = useState('');
	const [legalFilter, setLegalFilter] = useState('all');
	const [apv, setApv] = useState(null);
	const [apvFilter, setApvFilter] = useState('active');
	const alive = useRef(true);
	const request = useRef(0);

	const go = (sec, subTab) => app.go('setupHub', {section: sec || '', tab: subTab || ''});
	const guard = () => {
		request.current += 1;
		const mine = request.current;
		return () => alive.current && mine === request.current;
	};
	const fetchLookups = () => {
		if (lookups) return Promise.resolve(lookups);
		// Tra danh mục phân đoạn dùng chung với màn Nhân sự; không đọc được thì để trống (ô chọn vẫn hiện giá trị đang lưu)
		return call({action: 'hrLookups'}).then(
			(r) => {
				if (alive.current) setLookups(r || {});
				return r || {};
			},
			() => {
				if (alive.current) setLookups({});
				return {};
			}
		);
	};
	const load = () => {
		const ok = guard();
		if (section === 'general' || section === 'accounts') {
			return app.run(t.loading, Promise.all([call({action: 'setupData', subsidiary}), section === 'accounts' ? fetchLookups() : null])).then((r) => {
				if (r && ok()) setData(r[0] || {});
			});
		}
		if (section === 'legal') return app.run(t.loading, call({action: 'setupLegal'})).then((r) => r && ok() && setLegal(r));
		if (section === 'costAccounts') {
			return app.run(t.loading, Promise.all([call({action: 'costAccounts', subsidiary}), fetchLookups()])).then((r) => {
				if (r && ok()) setCost(r[0] || {});
			});
		}
		if (section === 'periods') return Promise.resolve();
		if (section === 'approvals') return app.run(t.loading, call({action: 'approvalSteps', subsidiary})).then((r) => r && ok() && setApv(r));
		return app.run(t.loading, call({action: 'setupStatus', subsidiary})).then((r) => r && ok() && setStatus(r));
	};

	useEffect(() => {
		alive.current = true;
		load();
		return () => {
			alive.current = false;
		};
	}, [subsidiary, section]);

	// ------------------------------------------------------------------ dùng chung
	const setField = (k) => (v) => {
		formRef.current = Object.assign({}, formRef.current, {[k]: v});
		setForm(formRef.current);
	};
	const openDialog = (meta, values) => {
		formRef.current = values || {};
		setForm(formRef.current);
		setError('');
		setDialog(meta);
	};
	const closeDialog = () => {
		setDialog(null);
		setError('');
	};
	// Chạy thao tác ghi; xong thì đóng hộp thoại, tải lại mục đang xem rồi báo kết quả
	const submit = (work, doneText, after) =>
		app.run(t.working, work).then((r) => {
			if (!r || !alive.current) return undefined;
			closeDialog();
			const next = after ? after(r) : null;
			return Promise.resolve(next)
				.then(() => load())
				.then(() => {
					if (alive.current) app.notify(typeof doneText === 'function' ? doneText(r) : doneText, 'ok');
					return r;
				});
		});
	const listId = (k) => (boot.recordTypeIds || {})[k] || '';
	const openList = (k) => {
		const id = listId(k);
		if (id) window.open(`/app/common/custom/custrecordentrylist.nl?rectype=${encodeURIComponent(id)}`, '_blank');
	};
	const listButton = (k, long) => <Button label={long ? t.openListLong : t.openList} kind={long ? 'default' : 'ghost'} small={!long} disabled={!listId(k)} title={listId(k) ? t.openListTitle : t.noList} onClick={() => openList(k)} />;
	const errorLine = () => (error ? <div class="s4vp-st-err" role="alert">{error}</div> : null);
	const note = (text, tone) => <div class={tone === 'warn' ? 's4vp-st-note s4vp-st-note-warn' : 's4vp-st-note'} role="note">{text}</div>;
	const optionsWith = (options, value, label) => (blank(value) || options.some((o) => String(o.value) === String(value)) ? options : options.concat([{value: String(value), label: label || `#${value}`}]));

	// ------------------------------------------------------------------ nạp mặc định, gói ngành
	const runDefaults = () => {
		const work = () =>
			submit(post({action: 'loadDefaults'}), (r) => {
				const sum = (bag) => Object.keys(bag || {}).reduce((s, k) => s + (Number(bag[k]) || 0), 0);
				return t.defaults.done(sum(r.created), sum(r.skipped));
			}, () => app.reloadBoot());
		if (boot.setupReady) app.confirm(t.defaults.confirm, work);
		else work();
	};
	const openPack = () => openDialog({kind: 'pack'}, {code: ''});
	const savePack = () => {
		const code = formRef.current.code;
		if (!code) return setError(t.pack.placeholder);
		const p = list(status && status.packs).find((x) => x.code === code) || {code};
		return submit(post({action: 'loadIndustryPack', code, subsidiary: subsidiary || null}), (r) => {
			const c = r.created || {};
			const n = ['earningTypes', 'payGroups', 'rateTables', 'rules'].reduce((s, k) => s + list(c[k]).length, 0);
			return t.pack.done(localized({vi: p.nameVi, en: p.name}) || code, n, list(r.skippedShifts).length);
		}, () => app.reloadBoot());
	};
	const packDialog = () => {
		const options = list(status && status.packs).map((p) => ({value: p.code, label: `${localized({vi: p.nameVi, en: p.name}) || p.code}${p.loaded ? ` - ${t.pack.loaded}` : ''}`}));
		return (
			<Dialog title={t.pack.title} width={520} onClose={closeDialog} actions={[<Button label={t.cancel} onClick={closeDialog} />, <Button label={t.pack.load} kind="primary" disabled={!form.code || !!app.busy} onClick={savePack} />]}>
				<div>{t.pack.intro}</div>
				<Field label={t.pack.pick} hint={t.pack.pickHint}>
					<Select value={form.code} onInput={setField('code')} options={options} placeholder={t.pack.placeholder} />
				</Field>
				{errorLine()}
			</Dialog>
		);
	};

	// ------------------------------------------------------------------ bảng tình trạng
	const issueText = (i) => {
		const f = t.issues[i.code];
		try {
			return f ? f(i, t) : i.code;
		} catch (e) {
			return i.code;
		}
	};
	const countText = (it) => {
		if (blank(it.count) || (it.count === 0 && it.state === 'optional')) return '';
		if (it.key === 'accounts') return t.accountCount(it.count);
		if (it.key === 'insAccounts') return t.insCount(it.count);
		if (it.key === 'industry') return t.packCount(it.count);
		if (it.key === 'approvals') return it.levels ? t.levelCount(it.levels) : '';
		if (it.key === 'employees') return t.employeeCount(it.count);
		if (it.key === 'periods') return t.periodCount(it.count, fmtDate(it.lastEnd));
		if (it.key === 'general' || it.key === 'company') return '';
		return t.count(it.count);
	};
	const itemButtons = (it) => {
		const def = ITEMS[it.key] || {};
		const out = [];
		const urgent = it.state === 'missing';
		if (def.run === 'defaults') out.push(<Button small={true} kind={urgent ? 'primary' : 'default'} label={urgent ? t.first.steps.defaults.action : t.first.steps.defaults.again} disabled={!canSetup || !!app.busy} title={canSetup ? '' : t.hrOnly} onClick={runDefaults} />);
		if (def.run === 'industry') out.push(<Button small={true} label={t.first.steps.industry.action} disabled={!canSetup || !boot.setupReady || !!app.busy} title={!canSetup ? t.hrOnly : boot.setupReady ? '' : t.pack.needDefaults} onClick={openPack} />);
		if (def.go) out.push(<Button small={true} kind={urgent ? 'primary' : 'default'} label={t.open} onClick={() => app.go(def.go)} />);
		if (def.section) out.push(<Button small={true} kind={urgent ? 'primary' : 'default'} label={t.open} ariaLabel={`${t.open} ${t.items[it.key].name}`} onClick={() => go(def.section, def.tab)} />);
		if (def.list) out.push(listButton(def.list, false));
		return out;
	};
	const itemRow = (it) => {
		const tx = t.items[it.key] || {name: it.key, desc: ''};
		const issues = list(it.issues).filter((i) => i.code !== 'NONE' || it.state !== 'ok');
		const count = countText(it);
		return (
			<div key={it.key} class="s4vp-st-row">
				<div class="s4vp-st-state">
					<Badge text={t.state[it.state] || it.state} tone={STATE_TONE[it.state] || 'muted'} />
				</div>
				<div class="s4vp-st-main">
					<div class="s4vp-st-name">
						<span>{tx.name}</span>
						{count ? <span class="s4vp-small">{count}</span> : null}
					</div>
					{issues.length ? (
						<div class={it.state === 'missing' ? 's4vp-st-issue s4vp-st-issue-err' : it.state === 'attention' ? 's4vp-st-issue' : 's4vp-st-desc'}>{issues.map(issueText).join(' ')}</div>
					) : (
						<div class="s4vp-st-desc">{tx.desc}</div>
					)}
				</div>
				<div class="s4vp-st-acts">{itemButtons(it).map((b, i) => <span key={`b${i}`} style={{display: 'contents'}}>{b}</span>)}</div>
			</div>
		);
	};
	const stepAction = (s) => {
		const tx = t.first.steps[s.key];
		const label = s.state === 'done' ? tx.again : tx.action;
		const kind = s.state === 'current' ? 'primary' : 'default';
		if (s.key === 'defaults') return <Button label={label} kind={kind} disabled={!canSetup || !!app.busy} title={canSetup ? '' : t.hrOnly} onClick={runDefaults} />;
		if (s.key === 'industry') return <Button label={label} kind={kind} disabled={!canSetup || !status.ready || !!app.busy} title={!canSetup ? t.hrOnly : status.ready ? '' : t.pack.needDefaults} onClick={openPack} />;
		if (s.key === 'accounts') return <Button label={label} kind={kind} disabled={!status.ready} title={status.ready ? '' : t.pack.needDefaults} onClick={() => go('accounts')} />;
		if (s.key === 'periods') return <Button label={label} kind={kind} disabled={!status.ready} title={status.ready ? '' : t.pack.needDefaults} onClick={() => go('periods')} />;
		return <Button label={label} kind={kind} disabled={!status.ready} title={status.ready ? '' : t.pack.needDefaults} onClick={() => app.go('employees')} />;
	};
	const firstRunCard = () => (
		<Card title={t.first.title} sub={t.first.sub} tone="warn">
			<ol class="s4vp-st-steps" aria-label={t.first.label}>
				{list(status.steps).map((s, i) => {
					const tx = t.first.steps[s.key] || {name: s.key, desc: ''};
					const attrs = {class: `s4vp-st-step s4vp-st-step-${s.state}`};
					if (s.state === 'current') attrs['aria-current'] = 'step';
					return (
						<li key={s.key} {...attrs}>
							<span class="s4vp-st-num">{String(i + 1)}</span>
							<div class="s4vp-st-main">
								<div class="s4vp-st-name">
									<span>{tx.name}</span>
									{s.state === 'done' ? <Badge text={t.first.done} tone="ok" /> : s.optional ? <Badge text={t.first.optional} /> : null}
								</div>
								<div class="s4vp-st-desc">{tx.desc}</div>
							</div>
							<div class="s4vp-st-acts">{stepAction(s)}</div>
						</li>
					);
				})}
			</ol>
		</Card>
	);
	const hub = () => {
		if (!status) return <Card><Empty text={t.loading} /></Card>;
		const words = fold(query).split(/\s+/).filter(Boolean);
		const match = (it) => {
			if (filter === 'todo' && TODO_STATES.indexOf(it.state) < 0) return false;
			if (filter === 'optional' && it.state !== 'optional') return false;
			if (!words.length) return true;
			const tx = t.items[it.key] || {};
			const hay = fold([tx.name, tx.desc, t.state[it.state], list(it.issues).map(issueText).join(' ')].join(' '));
			return words.every((w) => hay.indexOf(w) >= 0);
		};
		const all = list(status.sections).reduce((acc, s) => acc.concat(list(s.items)), []);
		const todo = all.filter((i) => TODO_STATES.indexOf(i.state) >= 0).length;
		const groups = list(status.sections).map((s) => ({key: s.key, items: list(s.items).filter(match)})).filter((s) => s.items.length);
		const chips = [
			{value: 'all', label: t.filter.all, count: all.length},
			{value: 'todo', label: t.filter.todo, count: todo, tone: todo ? 'warn' : ''},
			{value: 'optional', label: t.filter.optional, count: all.filter((i) => i.state === 'optional').length},
		];
		return (
			<div class="s4vp-st-hub">
				{status.firstRun ? firstRunCard() : null}
				<div class="s4vp-st-bar">
					<SearchBox value={query} onInput={setQuery} placeholder={t.search} width={280} />
					<Chips items={chips} value={filter} onPick={setFilter} label={t.filter.label} />
				</div>
				{groups.length ? (
					<div class="s4vp-st-groups">
						{groups.map((g) => (
							<Card key={g.key} title={t.sections[g.key] || g.key} flush={true}>
								<div class="s4vp-st-rows">{g.items.map(itemRow)}</div>
							</Card>
						))}
					</div>
				) : (
					<Card><Empty text={t.none} /></Card>
				)}
			</div>
		);
	};

	// ------------------------------------------------------------------ thiết lập chung và theo công ty con
	const earningOptions = list(boot.earningTypes).map((e) => ({value: String(e.id), label: `${e.code || ''} - ${e.name || ''}`}));
	const policyOptions = list(data && data.leavePolicies).map((p) => ({value: String(p.id), label: `${p.code || ''} - ${p.name || ''}`}));
	const typeOf = (key, scope) => (scope === 'company' && COMPANY_TYPES[key]) || FIELD_TYPES[key] || 'text';
	const showValue = (key, v, scope) => {
		const type = typeOf(key, scope);
		if (type === 'bool') return v ? t.yes : t.no;
		if (blank(v)) return '';
		if (type === 'inherit') return v === 'Y' ? t.yes : t.no;
		if (type === 'num') return plainNumber(v);
		if (type === 'money') return money(v);
		if (type.indexOf('list:') === 0) return (t.lists[type.slice(5)] || {})[v] || String(v);
		if (type === 'et' || type === 'policy') {
			const o = (type === 'et' ? earningOptions : policyOptions).find((x) => x.value === String(v));
			return o ? o.label : `#${v}`;
		}
		return String(v);
	};
	const formValue = (key, v, scope) => {
		const type = typeOf(key, scope);
		if (type === 'bool') return v === false ? 'F' : v === true ? 'T' : scope === 'company' && key === 'enabled' ? 'T' : 'F';
		if (blank(v)) return '';
		if (type === 'num' || type === 'money') return plainNumber(v);
		return String(v);
	};
	const editGroup = (group, scope) => {
		const rec = (scope === 'company' ? data.company : data.setup) || {};
		const values = {};
		group.fields.forEach((k) => (values[k] = formValue(k, rec[k], scope)));
		openDialog({kind: 'group', group, scope}, values);
	};
	const saveGroup = () => {
		const {group, scope} = dialog;
		const values = {};
		for (let i = 0; i < group.fields.length; i++) {
			const k = group.fields[i];
			const type = typeOf(k, scope);
			const raw = String(blank(formRef.current[k]) ? '' : formRef.current[k]).trim();
			if (type === 'bool') values[k] = raw === 'T';
			else if (type === 'num' || type === 'money') {
				const n = toNumber(raw);
				if (raw && n === null) return setError(t.general.errNumber(t.general.fields[k].label));
				values[k] = n;
			} else if (k === 'weekly_off') {
				const clean = raw.replace(/\s+/g, '');
				if (clean && !/^[0-6](,[0-6])*$/.test(clean)) return setError(t.general.errWeekly);
				values[k] = clean;
			} else values[k] = raw === '' ? (type === 'text' ? '' : null) : raw;
		}
		const body = scope === 'company' ? {action: 'saveCompany', subsidiary, values} : {action: 'saveSetup', values};
		// Bật / tắt phân hệ cho công ty con đổi danh sách công ty con của khung: nạp lại bootstrap
		return submit(post(body), t.general.saved, () => (scope === 'company' ? app.reloadBoot() : null));
	};
	const fieldControl = (k, scope) => {
		const type = typeOf(k, scope);
		const v = form[k];
		const on = setField(k);
		const inherit = scope === 'company' && k !== 'enabled' ? t.inherit : '';
		if (type === 'bool') return <Checkbox inField={true} checked={v === 'T'} onInput={(b) => on(b ? 'T' : 'F')} label={t.yes} />;
		if (type === 'inherit') return <Select value={v} onInput={on} options={[{value: 'Y', label: t.yes}, {value: 'N', label: t.no}]} placeholder={t.inherit} />;
		if (type === 'money') return <MoneyInput value={v} onInput={on} placeholder={inherit} decimals={0} />;
		if (type === 'num') return <NumberInput value={v} onInput={on} placeholder={inherit} />;
		if (type.indexOf('list:') === 0) {
			const names = t.lists[type.slice(5)] || {};
			return <Select value={v} onInput={on} options={Object.keys(names).map((code) => ({value: code, label: names[code]}))} placeholder={inherit || t.notSet} />;
		}
		if (type === 'et') return <AutoSelect value={v} onInput={on} options={optionsWith(earningOptions, v)} placeholder={t.notSet} />;
		if (type === 'policy') return <Select value={v} onInput={on} options={optionsWith(policyOptions, v)} placeholder={t.notSet} />;
		return <TextInput value={v} onInput={on} placeholder={inherit} />;
	};
	const groupDialog = () => {
		const {group, scope} = dialog;
		const scopeName = scope === 'company' ? subName(subsidiary) : t.general.scopeSetup;
		return (
			<Dialog title={t.general.editTitle(t.general.groups[group.key], scopeName)} width={720} onClose={closeDialog} actions={[<Button label={t.cancel} onClick={closeDialog} />, <Button label={t.save} kind="primary" disabled={!!app.busy} onClick={saveGroup} />]}>
				<div class="s4vp-st-form">
					{group.fields.map((k) => (
						<Field key={k} label={t.general.fields[k].label} hint={t.general.fields[k].hint}>
							{fieldControl(k, scope)}
						</Field>
					))}
				</div>
				{errorLine()}
			</Dialog>
		);
	};
	const generalSection = () => {
		if (!data) return <Card><Empty text={t.loading} /></Card>;
		if (!data.setup) return <Card><Empty text={t.general.noSetup} /></Card>;
		const scope = tab === 'company' && subsidiary ? 'company' : 'setup';
		const rec = (scope === 'company' ? data.company : data.setup) || {};
		const groups = scope === 'company' ? COMPANY_GROUPS : SETUP_GROUPS;
		const tabs = [{value: '', label: t.general.tabs.setup}];
		if (subsidiary) tabs.push({value: 'company', label: t.general.tabs.company(subName(subsidiary))});
		const valueCell = (k) => {
			const own = showValue(k, rec[k], scope);
			if (scope === 'company' && k !== 'enabled' && (blank(rec[k]) || !data.company)) return <span class="s4vp-muted">{t.inherited(showValue(k, data.setup[k], 'setup') || t.notSet)}</span>;
			return own === '' ? <span class="s4vp-muted">{t.notSet}</span> : <span class="s4vp-st-val">{own}</span>;
		};
		const recordId = scope === 'company' ? data.company && data.company.id : data.setup.id;
		return (
			<div class="s4vp-st-hub">
				<div class="s4vp-st-bar">
					<Tabs items={tabs} value={scope === 'company' ? 'company' : ''} onPick={(v) => go('general', v)} label={t.general.tabsLabel} />
					<span class="s4vp-st-grow" />
					<span class="s4vp-small">{t.general.accountsNote}</span>
					<Button small={true} kind="ghost" label={t.general.openAccounts} onClick={() => go('accounts')} />
					{recordId ? <Button small={true} kind="ghost" label={t.general.openRecord} title={t.openListTitle} onClick={() => listId(scope === 'company' ? 'company' : 'setup') && window.open(`/app/common/custom/custrecordentry.nl?rectype=${encodeURIComponent(listId(scope === 'company' ? 'company' : 'setup'))}&id=${encodeURIComponent(recordId)}`, '_blank')} /> : null}
				</div>
				{scope === 'company' && !data.company ? note(t.general.noCompany) : null}
				{canSetup ? null : note(t.hrOnly)}
				<div class="s4vp-st-cards">
					{groups.map((g) => (
						<Card key={g.key} title={t.general.groups[g.key]} actions={[<Button small={true} label={t.edit} ariaLabel={`${t.edit} ${t.general.groups[g.key]}`} disabled={!canSetup || !!app.busy} title={canSetup ? '' : t.hrOnly} onClick={() => editGroup(g, scope)} />]}>
							<div class="s4vp-st-kv">
								{g.fields.map((k) => (
									<div key={k} class="s4vp-st-kv-row" title={t.general.fields[k].hint}>
										<span class="s4vp-muted">{t.general.fields[k].label}</span>
										{valueCell(k)}
									</div>
								))}
							</div>
						</Card>
					))}
				</div>
			</div>
		);
	};

	// ------------------------------------------------------------------ tài khoản kế toán
	const accountOptions = (rows) => list(rows).map((a) => ({value: String(a.id), label: accountLabel(a)}));
	const vendorOptions = () => list(data && data.vendors).map((v) => ({value: String(v.id), label: `${v.code || ''}${v.name && v.name !== v.code ? ` - ${v.name}` : ''}`}));
	const locationOptions = () => list(lookups && lookups.locations).map((l) => ({value: String(l.id), label: l.name || `#${l.id}`}));
	const refLabel = (k, v) => {
		if (blank(v)) return '';
		const options = k === 'pit_vendor' ? vendorOptions() : k === 'location' ? locationOptions() : accountOptions(data && data.accounts);
		const o = options.find((x) => x.value === String(v));
		return o ? o.label : `#${v}`;
	};
	const editAccounts = (scope) => {
		const rec = (scope === 'company' ? data.company : data.setup) || {};
		const values = {};
		ACCOUNT_KEYS.forEach((k) => (values[k] = blank(rec[k]) ? '' : String(rec[k])));
		openDialog({kind: 'accounts', scope, before: values}, values);
	};
	const saveAccounts = () => {
		const {scope, before} = dialog;
		const values = {};
		ACCOUNT_KEYS.forEach((k) => {
			if (String(formRef.current[k] || '') !== String(before[k] || '')) values[k] = formRef.current[k] || '';
		});
		if (!Object.keys(values).length) return closeDialog();
		return submit(post({action: 'saveSetupAccounts', scope, subsidiary, values}), t.accounts.saved);
	};
	const accountsDialog = () => {
		const {scope} = dialog;
		const accounts = accountOptions(data.accounts);
		const placeholder = scope === 'company' ? t.inherit : t.accounts.pickAccount;
		return (
			<Dialog title={scope === 'company' ? t.accounts.titleCompany(subName(subsidiary)) : t.accounts.titleSetup} width={760} onClose={closeDialog} actions={[<Button label={t.cancel} onClick={closeDialog} />, <Button label={t.save} kind="primary" disabled={!!app.busy} onClick={saveAccounts} />]}>
				{scope === 'company' ? <div class="s4vp-small">{t.accounts.companyHint}</div> : null}
				<div class="s4vp-st-form">
					{ACCOUNT_KEYS.map((k) => {
						const options = k === 'pit_vendor' ? vendorOptions() : k === 'location' ? locationOptions() : accounts;
						return (
							<Field key={k} label={t.accountNames[k]} hint={t.accountHints[k]}>
								<AutoSelect value={form[k]} onInput={setField(k)} options={optionsWith(options, form[k])} placeholder={placeholder} />
							</Field>
						);
					})}
				</div>
				{errorLine()}
			</Dialog>
		);
	};
	const editIns = (row) => openDialog({kind: 'ins', code: row.code, before: {account: row.account, vendor: row.vendor}}, {account: row.account, vendor: row.vendor});
	const saveIns = () => {
		const {code, before} = dialog;
		const it = {code};
		if (String(formRef.current.account || '') !== String(before.account || '')) it.account = formRef.current.account || '';
		if (String(formRef.current.vendor || '') !== String(before.vendor || '')) it.vendor = formRef.current.vendor || '';
		if (Object.keys(it).length < 2) return closeDialog();
		return submit(post({action: 'saveInsuranceAccounts', items: [it]}), t.accounts.saved);
	};
	const insDialog = () => (
		<Dialog title={t.accounts.ins.editTitle(dialog.code)} width={560} onClose={closeDialog} actions={[<Button label={t.cancel} onClick={closeDialog} />, <Button label={t.save} kind="primary" disabled={!!app.busy} onClick={saveIns} />]}>
			<div class="s4vp-small">{t.accounts.ins.hint}</div>
			<Field label={t.accounts.ins.account}>
				<AutoSelect value={form.account} onInput={setField('account')} options={optionsWith(accountOptions(data.accounts), form.account)} placeholder={t.accounts.pickAccount} />
			</Field>
			<Field label={t.accounts.ins.vendor} hint={t.accounts.ins.vendorHint}>
				<AutoSelect value={form.vendor} onInput={setField('vendor')} options={optionsWith(vendorOptions(), form.vendor)} placeholder={t.accounts.pickAccount} />
			</Field>
			{errorLine()}
		</Dialog>
	);
	const accountsSection = () => {
		if (!data) return <Card><Empty text={t.loading} /></Card>;
		if (!data.setup) return <Card><Empty text={t.general.noSetup} /></Card>;
		const isIns = tab === 'ins';
		const tabs = [{value: '', label: t.accounts.tabs.defaults}, {value: 'ins', label: t.accounts.tabs.ins}];
		const lock = canAccounts ? '' : t.acctOnly;
		let body;
		if (!isIns) {
			const company = data.company || {};
			const rows = ACCOUNT_KEYS.map((k) => {
				const effective = blank(company[k]) ? data.setup[k] : company[k];
				const required = REQUIRED_ACCOUNTS.indexOf(k) >= 0;
				const state = !blank(effective) ? 'set' : required ? 'missing' : 'optional';
				return {id: k, name: t.accountNames[k], hint: t.accountHints[k], required, common: refLabel(k, data.setup[k]), own: refLabel(k, company[k]), effective: refLabel(k, effective), state, stateText: t.accounts[state]};
			});
			const columns = [
				{key: 'name', label: t.accounts.cols.item, render: (r) => (
					<span class="s4vp-st-cell">
						<span class="s4vp-st-name"><span>{r.name}</span>{r.required ? <Badge text={t.accounts.required} tone="info" /> : null}</span>
						<span class="s4vp-small">{r.hint}</span>
					</span>
				)},
				{key: 'common', label: t.accounts.cols.common, render: (r) => r.common || <span class="s4vp-muted">{t.notSet}</span>},
				subsidiary ? {key: 'own', label: `${t.accounts.cols.company} ${subName(subsidiary)}`, render: (r) => r.own || <span class="s4vp-muted">{t.inherit}</span>} : null,
				{key: 'stateText', label: t.accounts.cols.state, nowrap: true, render: (r) => <Badge text={r.stateText} tone={r.state === 'set' ? 'ok' : r.state === 'missing' ? 'error' : 'muted'} />},
			];
			body = (
				<Card flush={true} label={t.accounts.tabs.defaults}>
					<Table
						label={t.accounts.tabs.defaults}
						columns={columns}
						rows={rows}
						search={true}
						searchPlaceholder={t.accounts.search}
						maxHeight={TABLE_HEIGHT}
						toolbar={
							<div class="s4vp-actions">
								<Button small={true} label={t.accounts.editSetup} kind="primary" disabled={!canAccounts || !!app.busy} title={lock} onClick={() => editAccounts('setup')} />
								{subsidiary ? <Button small={true} label={t.accounts.editCompany} disabled={!canAccounts || !!app.busy} title={lock} onClick={() => editAccounts('company')} /> : null}
							</div>
						}
					/>
				</Card>
			);
		} else {
			const today = data.today || '';
			const byCode = {};
			list(data.components).forEach((c) => {
				const code = String(c.name || '');
				const live = (blank(c.effective) || !today || c.effective <= today) && (blank(c.expiration) || !today || c.expiration >= today);
				if (!byCode[code] || (live && !byCode[code].live)) byCode[code] = Object.assign({}, c, {live});
			});
			const rows = Object.keys(byCode).sort().map((code) => {
				const c = byCode[code];
				const state = !c.live ? 'expired' : blank(c.account) ? 'noAccount' : blank(c.vendor) ? 'noVendor' : 'ok';
				return {
					id: code, code, name: c.description || '', ee: c.ee_rate, er: c.er_rate, account: blank(c.account) ? '' : String(c.account), vendor: blank(c.vendor) ? '' : String(c.vendor),
					accountText: refLabel('acc', c.account), vendorText: refLabel('pit_vendor', c.vendor), state, stateText: t.accounts.ins[state],
				};
			});
			const columns = [
				{key: 'code', label: t.accounts.ins.cols.code, nowrap: true, render: (r) => <span class="s4vp-st-name">{r.code}</span>},
				{key: 'name', label: t.accounts.ins.cols.name},
				{key: 'ee', label: t.accounts.ins.cols.ee, type: 'pct', nowrap: true},
				{key: 'er', label: t.accounts.ins.cols.er, type: 'pct', nowrap: true},
				{key: 'accountText', label: t.accounts.ins.cols.account, render: (r) => r.accountText || <span class="s4vp-muted">{t.notSet}</span>},
				{key: 'vendorText', label: t.accounts.ins.cols.vendor, render: (r) => r.vendorText || <span class="s4vp-muted">{t.notSet}</span>},
				{key: 'stateText', label: t.accounts.ins.cols.state, nowrap: true, render: (r) => <Badge text={r.stateText} tone={r.state === 'ok' ? 'ok' : r.state === 'noAccount' ? 'error' : r.state === 'noVendor' ? 'warn' : 'muted'} />},
				{key: 'act', label: '', nowrap: true, noRowClick: true, render: (r) => <Button small={true} label={t.edit} ariaLabel={`${t.edit} ${r.code}`} disabled={!canAccounts || !!app.busy} title={lock} onClick={() => editIns(r)} />},
			];
			body = (
				<Card flush={true} label={t.accounts.tabs.ins}>
					<Table label={t.accounts.tabs.ins} columns={columns} rows={rows} search={true} searchPlaceholder={t.accounts.ins.search} empty={t.accounts.ins.empty} maxHeight={TABLE_HEIGHT} />
				</Card>
			);
		}
		return (
			<div class="s4vp-st-hub">
				<div class="s4vp-st-bar">
					<Tabs items={tabs} value={isIns ? 'ins' : ''} onPick={(v) => go('accounts', v)} label={t.accounts.tabsLabel} />
					<span class="s4vp-st-grow" />
					<Button small={true} kind="ghost" label={t.items.costAccounts.name} onClick={() => go('costAccounts')} />
				</div>
				{canAccounts ? null : note(t.acctOnly)}
				{body}
			</div>
		);
	};

	// ------------------------------------------------------------------ tài khoản chi phí lương theo đích
	const targetOptions = (type) => list(lookups && lookups[TARGET_LIST[type]]).map((x) => ({value: String(x.id), label: x.name || `#${x.id}`}));
	const laborOptions = [{value: 'E', label: t.cost.labor.E}, {value: 'C', label: t.cost.labor.C}];
	const editCost = (row) => {
		const r = row || {};
		openDialog(
			{kind: 'cost', id: r.id || '', targetName: r.targetName || '', accountName: r.accountName || ''},
			{target_type: r.targetType || 'D', target: r.target || '', labor_type: r.laborType || '', account: r.account || '', subsidiary: row ? r.subsidiary || '' : '', effective: r.effective || '', note: r.note || ''}
		);
	};
	const saveCost = () => {
		const f = formRef.current;
		if (!f.target) return setError(t.cost.form.errTarget);
		if (!f.account) return setError(t.cost.form.errAccount);
		if (f.effective && !validIso(f.effective)) return setError(t.cost.form.errDate);
		const field = {W: 'work_center', P: 'project', D: 'department'}[f.target_type];
		const values = {target_type: f.target_type, labor_type: f.labor_type || '', account: f.account, subsidiary: f.subsidiary || '', effective: f.effective || '', note: f.note || ''};
		values[field] = f.target;
		return submit(post({action: 'saveCostAccount', id: dialog.id || null, values}), t.cost.saved);
	};
	const costDialog = () => {
		const subs = list(boot.subsidiaries).map((s) => ({value: String(s.id), label: s.name}));
		const setType = (v) => {
			formRef.current = Object.assign({}, formRef.current, {target_type: v, target: ''});
			setForm(formRef.current);
		};
		return (
			<Dialog title={dialog.id ? t.cost.form.titleEdit : t.cost.form.titleNew} width={720} onClose={closeDialog} actions={[<Button label={t.cancel} onClick={closeDialog} />, <Button label={t.save} kind="primary" disabled={!!app.busy} onClick={saveCost} />]}>
				<div class="s4vp-st-form">
					<Field label={t.cost.form.type}>
						<Select value={form.target_type} onInput={setType} options={['W', 'P', 'D'].map((k) => ({value: k, label: t.cost.types[k]}))} />
					</Field>
					<Field label={`${t.cost.form.target} (${t.cost.types[form.target_type] || ''})`} required={true}>
						<AutoSelect value={form.target} onInput={setField('target')} options={optionsWith(targetOptions(form.target_type), form.target, dialog.targetName)} placeholder={t.cost.form.targetPick} />
					</Field>
					<Field label={t.cost.form.account} required={true}>
						<AutoSelect value={form.account} onInput={setField('account')} options={optionsWith(accountOptions(cost && cost.accounts), form.account, dialog.accountName)} placeholder={t.cost.form.accountPick} />
					</Field>
					<Field label={t.cost.form.labor} hint={t.cost.form.laborHint}>
						<Select value={form.labor_type} onInput={setField('labor_type')} options={laborOptions} placeholder={t.cost.labor.all} />
					</Field>
					<Field label={t.cost.form.subsidiary} hint={t.cost.form.subsidiaryHint}>
						<AutoSelect value={form.subsidiary} onInput={setField('subsidiary')} options={optionsWith(subs, form.subsidiary)} placeholder={t.cost.shared} />
					</Field>
					<Field label={t.cost.form.effective} hint={t.cost.form.effectiveHint}>
						<DateInput value={form.effective} onInput={setField('effective')} />
					</Field>
				</div>
				<Field label={t.cost.form.note}>
					<TextArea value={form.note} onInput={setField('note')} rows={2} />
				</Field>
				{errorLine()}
			</Dialog>
		);
	};
	const retireCost = (r) => app.confirm(t.cost.confirmRetire(`${t.cost.types[r.targetType] || ''} ${r.targetName}`.trim(), r.accountName), () => submit(post({action: 'retireCostAccount', id: r.id}), t.cost.retired));
	const restoreCost = (r) => submit(post({action: 'retireCostAccount', id: r.id, restore: true}), t.cost.restored);
	const setTest = (k) => (v) => {
		testRef.current = Object.assign({}, testRef.current, {[k]: v});
		setTestForm(testRef.current);
	};
	const runTest = () => {
		const f = testRef.current;
		if (f.date && !validIso(f.date)) return app.notify(t.cost.form.errDate, 'error');
		return app.run(t.working, call({action: 'costAccountTest', subsidiary, workCenter: f.workCenter, project: f.project, department: f.department, laborType: f.laborType, date: f.date})).then((r) => r && alive.current && setTestResult(r));
	};
	const testCard = () => {
		const r = testResult;
		return (
			<Card title={t.cost.test.title} sub={t.cost.test.sub}>
				<div class="s4vp-st-form s4vp-st-form-narrow">
					<Field label={t.cost.test.workCenter}>
						<AutoSelect value={testForm.workCenter} onInput={setTest('workCenter')} options={targetOptions('W')} placeholder={t.cost.test.any} />
					</Field>
					<Field label={t.cost.test.project}>
						<AutoSelect value={testForm.project} onInput={setTest('project')} options={targetOptions('P')} placeholder={t.cost.test.any} />
					</Field>
					<Field label={t.cost.test.department}>
						<AutoSelect value={testForm.department} onInput={setTest('department')} options={targetOptions('D')} placeholder={t.cost.test.any} />
					</Field>
					<Field label={t.cost.test.labor}>
						<Select value={testForm.laborType} onInput={setTest('laborType')} options={laborOptions} placeholder={t.cost.labor.all} />
					</Field>
					<Field label={t.cost.test.date}>
						<DateInput value={testForm.date || (cost && cost.today) || ''} onInput={setTest('date')} />
					</Field>
					<div class="s4vp-st-test-btn">
						<Button label={t.cost.test.run} kind="primary" disabled={!!app.busy} onClick={runTest} />
					</div>
				</div>
				{r ? (
					<div class="s4vp-st-result" role="status">
						<div class="s4vp-st-result-h">
							<span class="s4vp-muted">{t.cost.test.result}</span>
							{r.account ? <span class="s4vp-st-result-v">{r.accountName || r.account}</span> : <span class="s4vp-st-issue s4vp-st-issue-err">{t.cost.test.none}</span>}
							{r.account && t.cost.test.by[r.level] ? <Badge text={t.cost.test.by[r.level]} tone="info" /> : null}
						</div>
						<ol class="s4vp-st-levels" aria-label={t.cost.test.steps}>
							{list(r.steps).map((s) => (
								<li key={s.level} class={s.level === r.level ? 's4vp-st-level s4vp-st-level-on' : 's4vp-st-level'}>
									<span>{t.cost.test.level[s.level] || s.level}</span>
									<span class={s.account ? '' : 's4vp-muted'}>{s.account ? s.accountName || s.account : s.given ? t.cost.test.noMatch : t.cost.test.notGiven}</span>
								</li>
							))}
						</ol>
						<div class="s4vp-small">{r.warning ? t.cost.test.unreadable : t.cost.test.skip}</div>
					</div>
				) : null}
			</Card>
		);
	};
	const costSection = () => {
		if (!cost) return <Card><Empty text={t.loading} /></Card>;
		const lock = canAccounts ? '' : t.acctOnly;
		const all = list(cost.rows).map((r) => Object.assign({}, r, {
			typeText: t.cost.types[r.targetType] || r.targetType, laborText: r.laborType ? t.cost.labor[r.laborType] || r.laborType : t.cost.labor.all,
			subsidiaryText: r.subsidiary ? r.subsidiaryName || subName(r.subsidiary) : t.cost.shared, effectiveText: r.effective ? fmtDate(r.effective) : t.cost.always, stateText: t.cost.states[r.state] || r.state,
		}));
		const rows = costFilter === 'active' ? all.filter((r) => !r.inactive) : all;
		const chips = [{value: 'active', label: t.cost.chips.active, count: all.filter((r) => !r.inactive).length}, {value: 'all', label: t.cost.chips.all, count: all.length}];
		const columns = [
			{key: 'typeText', label: t.cost.cols.type, nowrap: true},
			{key: 'targetName', label: t.cost.cols.target, render: (r) => <span class="s4vp-st-name">{r.targetName}</span>},
			{key: 'laborText', label: t.cost.cols.labor, nowrap: true},
			{key: 'accountName', label: t.cost.cols.account},
			{key: 'subsidiaryText', label: t.cost.cols.subsidiary},
			{key: 'effectiveText', label: t.cost.cols.effective, nowrap: true},
			{key: 'stateText', label: t.cost.cols.state, nowrap: true, render: (r) => <Badge text={r.stateText} tone={COST_TONE[r.state] || 'muted'} />},
			{key: 'act', label: t.cost.cols.act, nowrap: true, noRowClick: true, render: (r) => {
				const name = `${r.typeText} ${r.targetName}`;
				return (
					<span class="s4vp-st-acts">
						<Button small={true} label={t.edit} ariaLabel={t.cost.editOf(name)} disabled={!canAccounts || !!app.busy} title={lock} onClick={() => editCost(r)} />
						{r.inactive
							? <Button small={true} kind="ghost" label={t.cost.restore} ariaLabel={t.cost.restoreOf(name)} disabled={!canAccounts || !!app.busy} title={lock} onClick={() => restoreCost(r)} />
							: <Button small={true} kind="ghost" label={t.cost.retire} ariaLabel={t.cost.retireOf(name)} disabled={!canAccounts || !!app.busy} title={lock} onClick={() => retireCost(r)} />}
					</span>
				);
			}},
		];
		return (
			<div class="s4vp-cols">
				<div class="s4vp-col-main">
					{cost.unavailable ? note(t.cost.unavailable, 'warn') : null}
					{canAccounts ? null : note(t.acctOnly)}
					<Card flush={true} label={t.cost.title}>
						<Table
							label={t.cost.title}
							columns={columns}
							rows={rows}
							search={true}
							searchPlaceholder={t.cost.search}
							empty={all.length ? t.cost.emptyFilter : t.cost.empty}
							maxHeight={TABLE_HEIGHT}
							toolbar={<Chips items={chips} value={costFilter} onPick={setCostFilter} label={t.cost.chips.label} />}
						/>
					</Card>
				</div>
				<div class="s4vp-col-side s4vp-st-side">
					<Card title={t.cost.priority.title}>
						<ol class="s4vp-st-prio" aria-label={t.cost.priority.label}>
							{t.cost.priority.levels.map((text, i) => <li key={`p${i}`}>{text}</li>)}
						</ol>
						<div class="s4vp-small">{t.cost.priority.note}</div>
					</Card>
					{testCard()}
				</div>
			</div>
		);
	};

	// ------------------------------------------------------------------ cấp duyệt bảng lương
	const whoText = (r) => (r.approver ? r.approverName || `#${r.approver}` : t.apv.roles[r.role] || r.role || '');
	const editApv = (row) => {
		const r = row || {};
		const levels = list(apv && apv.rows).filter((x) => !x.inactive).map((x) => x.level);
		openDialog(
			{kind: 'apv', id: r.id || '', approverName: r.approverName || ''},
			{level: row ? String(r.level || '') : String(levels.length ? Math.max.apply(null, levels) + 1 : 1), name: r.name || '', approver: r.approver || '', role: r.role || '', min_net: blank(r.minNet) ? '' : plainNumber(r.minNet), subsidiary: row ? r.subsidiary || '' : ''}
		);
	};
	const saveApv = () => {
		const f = formRef.current;
		const level = String(f.level || '').trim();
		if (!/^\d{1,3}$/.test(level) || Number(level) < 1) return setError(t.apv.form.errLevel);
		if (!String(f.name || '').trim()) return setError(t.apv.form.errName);
		if (!f.approver && !f.role) return setError(t.apv.form.errWho);
		const net = String(f.min_net || '').trim() ? toNumber(f.min_net) : null;
		if (String(f.min_net || '').trim() && (net === null || net < 0)) return setError(t.apv.form.errNet);
		const values = {level, name: String(f.name).trim(), approver: f.approver || '', role: f.approver ? '' : f.role || '', min_net: net === null ? '' : net, subsidiary: f.subsidiary || ''};
		return submit(post({action: 'saveApprovalStep', id: dialog.id || null, values}), t.apv.saved);
	};
	const apvDialog = () => {
		const subs = list(boot.subsidiaries).map((x) => ({value: String(x.id), label: x.name}));
		const users = list(apv && apv.users).map((u) => ({value: u.id, label: `${u.code}${u.name ? ` - ${u.name}` : ''}`}));
		return (
			<Dialog title={dialog.id ? t.apv.form.titleEdit : t.apv.form.titleNew} width={720} onClose={closeDialog} actions={[<Button label={t.cancel} onClick={closeDialog} />, <Button label={t.save} kind="primary" disabled={!!app.busy} onClick={saveApv} />]}>
				<div class="s4vp-st-form">
					<Field label={t.apv.form.level} hint={t.apv.form.levelHint} required={true}>
						<NumberInput value={form.level} onInput={setField('level')} min={1} step={1} />
					</Field>
					<Field label={t.apv.form.name} hint={t.apv.form.nameHint} required={true}>
						<TextInput value={form.name} onInput={setField('name')} />
					</Field>
					<Field label={t.apv.form.approver} hint={t.apv.form.approverHint}>
						<AutoSelect value={form.approver} onInput={setField('approver')} options={optionsWith(users, form.approver, dialog.approverName)} placeholder={t.apv.form.approverPick} />
					</Field>
					<Field label={t.apv.form.role} hint={t.apv.form.roleHint}>
						<Select value={form.approver ? '' : form.role} onInput={setField('role')} options={['A', 'H', 'D'].map((k) => ({value: k, label: t.apv.roles[k]}))} placeholder={t.apv.form.rolePick} disabled={!!form.approver} />
					</Field>
					<Field label={t.apv.form.minNet} hint={t.apv.form.minNetHint}>
						<MoneyInput value={form.min_net} onInput={setField('min_net')} placeholder={t.apv.always} decimals={0} />
					</Field>
					<Field label={t.apv.form.subsidiary} hint={t.apv.form.subsidiaryHint}>
						<AutoSelect value={form.subsidiary} onInput={setField('subsidiary')} options={optionsWith(subs, form.subsidiary)} placeholder={t.apv.shared} />
					</Field>
				</div>
				{errorLine()}
			</Dialog>
		);
	};
	const retireApv = (r) => app.confirm(t.apv.confirmRetire(`${t.apv.levelName(r.level, r.name)}: ${whoText(r)}`), () => submit(post({action: 'retireApprovalStep', id: r.id}), t.apv.retired));
	const restoreApv = (r) => submit(post({action: 'retireApprovalStep', id: r.id, restore: true}), t.apv.restored);
	const approvalsSection = () => {
		if (!apv) return <Card><Empty text={t.loading} /></Card>;
		const lock = canAccounts ? '' : t.acctOnly;
		const all = list(apv.rows).map((r) => Object.assign({}, r, {
			whoText: whoText(r), minNetText: blank(r.minNet) || !Number(r.minNet) ? t.apv.always : t.apv.fromAmount(money(r.minNet)),
			subsidiaryText: r.subsidiary ? r.subsidiaryName || subName(r.subsidiary) : t.apv.shared, stateText: t.apv.states[r.state] || r.state,
		}));
		const rows = apvFilter === 'active' ? all.filter((r) => !r.inactive) : all;
		const chips = [{value: 'active', label: t.apv.chips.active, count: all.filter((r) => !r.inactive).length}, {value: 'all', label: t.apv.chips.all, count: all.length}];
		const columns = [
			{key: 'level', label: t.apv.cols.level, align: 'right', nowrap: true},
			{key: 'name', label: t.apv.cols.name, render: (r) => <span class="s4vp-st-name">{r.name}</span>},
			{key: 'whoText', label: t.apv.cols.approver},
			{key: 'minNetText', label: t.apv.cols.minNet, align: 'right', nowrap: true},
			{key: 'subsidiaryText', label: t.apv.cols.subsidiary},
			{key: 'stateText', label: t.apv.cols.state, nowrap: true, render: (r) => <Badge text={r.stateText} tone={APV_TONE[r.state] || 'muted'} />},
			{key: 'act', label: t.apv.cols.act, nowrap: true, noRowClick: true, render: (r) => {
				const name = `${t.apv.levelName(r.level, r.name)} ${r.whoText}`;
				return (
					<span class="s4vp-st-acts">
						<Button small={true} label={t.edit} ariaLabel={t.apv.editOf(name)} disabled={!canAccounts || !!app.busy} title={lock} onClick={() => editApv(r)} />
						{r.inactive
							? <Button small={true} kind="ghost" label={t.cost.restore} ariaLabel={t.apv.restoreOf(name)} disabled={!canAccounts || !!app.busy} title={lock} onClick={() => restoreApv(r)} />
							: <Button small={true} kind="ghost" label={t.cost.retire} ariaLabel={t.apv.retireOf(name)} disabled={!canAccounts || !!app.busy} title={lock} onClick={() => retireApv(r)} />}
					</span>
				);
			}},
		];
		const levels = list(apv.levels);
		return (
			<div class="s4vp-st-hub">
				{note(t.apv.rule)}
				{apv.unavailable ? note(t.apv.unavailable, 'warn') : null}
				{canAccounts ? null : note(t.acctOnly)}
				<div class="s4vp-cols">
					<div class="s4vp-col-main">
						<Card flush={true} label={t.apv.title}>
							<Table
								label={t.apv.title}
								columns={columns}
								rows={rows}
								search={true}
								searchPlaceholder={t.apv.search}
								empty={all.length ? t.apv.emptyFilter : t.apv.empty}
								maxHeight={TABLE_HEIGHT}
								toolbar={<Chips items={chips} value={apvFilter} onPick={setApvFilter} label={t.apv.chips.label} />}
							/>
						</Card>
					</div>
					<div class="s4vp-col-side s4vp-st-side">
						<Card title={subsidiary ? t.apv.effective(subName(subsidiary)) : t.apv.effectiveShared}>
							{levels.length ? (
								<ol class="s4vp-st-prio">
									{levels.map((l) => (
										<li key={`l${l.level}`}>
											<span class="s4vp-st-name">{t.apv.levelName(l.level, l.name)}</span>
											<div class="s4vp-small">
												{list(l.approvers).map((a) => `${a.employee ? a.employeeName || `#${a.employee}` : t.apv.roles[a.role] || a.role}${a.minNet ? ` (${t.apv.fromAmount(money(a.minNet))})` : ''}`).join(` ${t.apv.or} `)}
											</div>
										</li>
									))}
								</ol>
							) : (
								<div class="s4vp-small">{t.apv.single}</div>
							)}
						</Card>
					</div>
				</div>
			</div>
		);
	};

	// ------------------------------------------------------------------ kỳ lương
	const groupName = (id) => {
		const g = list(boot.paygroups).find((x) => String(x.id) === String(id));
		return g ? g.code : id ? `#${id}` : '';
	};
	const periodAct = (action, p, doneText) =>
		submit(post({action, id: p.id}), doneText, () => app.reloadBoot());
	const openGenerate = () => {
		const groups = list(boot.paygroups);
		const group = periodGroup || (groups[0] ? String(groups[0].id) : '');
		const thisYear = new Date().getFullYear();
		const has = (y) => list(boot.periods).some((p) => String(p.paygroup) === group && String(p.start || '').slice(0, 4) === String(y));
		openDialog({kind: 'generate'}, {year: String(has(thisYear) ? thisYear + 1 : thisYear), paygroup: group});
	};
	const saveGenerate = () => {
		const f = formRef.current;
		if (!/^\d{4}$/.test(String(f.year || '').trim())) return setError(t.periodsSec.errYear);
		if (!f.paygroup) return setError(t.periodsSec.errGroup);
		const year = String(f.year).trim();
		return submit(post({action: 'generatePeriods', year: Number(year), paygroup: f.paygroup}), (r) => t.periodsSec.generated(list(r.created).length, Number(r.skipped) || 0), () => {
			if (alive.current) {
				setPeriodYear(year);
				setPeriodGroup(String(f.paygroup));
			}
			return app.reloadBoot();
		});
	};
	const generateDialog = () => (
		<Dialog title={t.periodsSec.genTitle} width={520} onClose={closeDialog} actions={[<Button label={t.cancel} onClick={closeDialog} />, <Button label={t.periodsSec.genRun(form.year)} kind="primary" disabled={!!app.busy} onClick={saveGenerate} />]}>
			<div class="s4vp-st-form">
				<Field label={t.periodsSec.year} required={true}>
					<NumberInput value={form.year} onInput={setField('year')} onEnter={saveGenerate} min={2000} max={2100} step={1} />
				</Field>
				<Field label={t.periodsSec.paygroup}>
					<Select value={form.paygroup} onInput={setField('paygroup')} options={list(boot.paygroups).map((g) => ({value: String(g.id), label: `${g.code}${g.description ? ` - ${g.description}` : ''}`}))} />
				</Field>
			</div>
			<div class="s4vp-small">{t.periodsSec.genHint}</div>
			{errorLine()}
		</Dialog>
	);
	const periodsSection = () => {
		const today = new Date();
		const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
		const all = list(boot.periods).map((p) => Object.assign({}, p, {
			year: String(p.start || '').slice(0, 4), groupText: groupName(p.paygroup), startText: fmtDate(p.start), endText: fmtDate(p.end), statusText: t.periodsSec.status[p.status] || p.status || '',
			attText: t.periodsSec.att[p.attStatus] || p.attStatus || '', isCurrent: p.start <= iso && iso <= p.end,
		}));
		const years = [...new Set(all.map((p) => p.year).filter(Boolean))].sort().reverse();
		const year = periodYear === 'all' ? '' : periodYear || (years.indexOf(String(today.getFullYear())) >= 0 ? String(today.getFullYear()) : years[0] || '');
		const rows = all.filter((p) => (!year || p.year === year) && (!periodGroup || String(p.paygroup) === periodGroup)).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
		const lock = canSetup ? '' : t.hrOnly;
		const columns = [
			{key: 'code', label: t.periodsSec.cols.code, nowrap: true, render: (p) => (
				<span class="s4vp-st-name"><span>{p.code}</span>{p.isCurrent ? <Badge text={t.periodsSec.current} tone="info" /> : null}</span>
			)},
			{key: 'groupText', label: t.periodsSec.cols.paygroup, nowrap: true},
			{key: 'startText', label: t.periodsSec.cols.start, nowrap: true},
			{key: 'endText', label: t.periodsSec.cols.end, nowrap: true},
			{key: 'stdDays', label: t.periodsSec.cols.stdDays, type: 'num', nowrap: true},
			{key: 'taxMonth', label: t.periodsSec.cols.taxMonth, nowrap: true},
			{key: 'statusText', label: t.periodsSec.cols.status, nowrap: true, render: (p) => <Badge text={p.statusText} tone={p.status === 'C' ? 'muted' : 'ok'} />},
			{key: 'attText', label: t.periodsSec.cols.att, nowrap: true, render: (p) => <Badge text={p.attText} tone={p.attStatus === 'L' ? 'info' : 'muted'} />},
			{key: 'act', label: t.periodsSec.cols.act, nowrap: true, noRowClick: true, render: (p) => (
				<span class="s4vp-st-acts">
					{p.status === 'C'
						? <Button small={true} label={t.periodsSec.reopen} ariaLabel={t.periodsSec.reopenOf(p.code)} disabled={!canSetup || !!app.busy} title={lock} onClick={() => app.confirm(t.periodsSec.confirmReopen(p.code), () => periodAct('reopenPeriod', p, t.periodsSec.reopened(p.code)))} />
						: <Button small={true} label={t.periodsSec.close} ariaLabel={t.periodsSec.closeOf(p.code)} disabled={!canSetup || !!app.busy} title={lock} onClick={() => app.confirm(t.periodsSec.confirmClose(p.code), () => periodAct('closePeriod', p, t.periodsSec.closed(p.code)))} />}
					<Button small={true} kind="ghost" label={t.periodsSec.attendance} ariaLabel={t.periodsSec.attendanceOf(p.code)} onClick={() => app.go('attendance', {period: p.id})} />
				</span>
			)},
		];
		const toolbar = (
			<div class="s4vp-st-filters">
				<Select value={year || 'all'} onInput={(v) => setPeriodYear(v || 'all')} options={[{value: 'all', label: t.periodsSec.allYears}].concat(years.map((y) => ({value: y, label: y})))} ariaLabel={t.periodsSec.year} width={130} />
				<Select value={periodGroup} onInput={setPeriodGroup} options={list(boot.paygroups).map((g) => ({value: String(g.id), label: g.code}))} placeholder={t.periodsSec.allGroups} ariaLabel={t.periodsSec.paygroup} width={190} />
				<span class="s4vp-small">{t.periodsSec.total(rows.length)}</span>
			</div>
		);
		return (
			<div class="s4vp-st-hub">
				{canSetup ? null : note(t.hrOnly)}
				<Card flush={true} label={t.periodsSec.title}>
					<Table label={t.periodsSec.title} columns={columns} rows={rows} search={true} searchPlaceholder={t.periodsSec.search} empty={all.length ? t.periodsSec.emptyFilter : t.periodsSec.empty} maxHeight={TABLE_HEIGHT} toolbar={toolbar} />
				</Card>
			</div>
		);
	};

	// ------------------------------------------------------------------ tham số pháp lý
	const verify = (p) =>
		app.confirm(t.legal.confirmVerify(p), () =>
			// Dải cảnh báo của Trang chủ đọc boot.unverified: nạp lại bootstrap sau khi đổi cờ
			submit(post({action: 'verifyParam', id: p.id}), t.legal.verifiedDone(p.code), () => app.reloadBoot())
		);
	const legalSection = () => {
		if (!legal) return <Card><Empty text={t.loading} /></Card>;
		const which = tab === 'brackets' || tab === 'components' ? tab : 'params';
		const unverified = list(legal.params).filter((p) => !p.verified).length;
		const tabs = [{value: '', label: t.legal.tabs.params, count: unverified || null}, {value: 'brackets', label: t.legal.tabs.brackets}, {value: 'components', label: t.legal.tabs.components}];
		const currentBadge = (r) => <Badge text={r.current ? t.legal.current : t.legal.notCurrent} tone={r.current ? 'ok' : 'muted'} />;
		let body;
		if (which === 'params') {
			const all = list(legal.params).map((p) => Object.assign({}, p, {
				valueText: plainNumber(p.value), effectiveText: fmtDate(p.effective), expirationText: fmtDate(p.expiration), verifiedText: p.verified ? t.legal.verified : t.legal.unverified,
				groupText: t.legal.groups[p.group] || p.group,
			}));
			const groups = [...new Set(all.map((p) => p.group))].sort();
			const rows = all.filter((p) => legalFilter === 'all' || (legalFilter === 'unverified' ? !p.verified : p.group === legalFilter));
			const chips = [{value: 'all', label: t.legal.chips.all, count: all.length}, {value: 'unverified', label: t.legal.chips.unverified, count: unverified, tone: unverified ? 'warn' : ''}].concat(
				groups.map((g) => ({value: g, label: t.legal.groups[g] || g, count: all.filter((p) => p.group === g).length}))
			);
			const columns = [
				{key: 'code', label: t.legal.cols.code, nowrap: true, render: (p) => <span class="s4vp-st-name">{p.code}</span>},
				{key: 'description', label: t.legal.cols.description},
				{key: 'valueText', label: t.legal.cols.value, align: 'right', nowrap: true},
				{key: 'effectiveText', label: t.legal.cols.effective, nowrap: true},
				{key: 'expirationText', label: t.legal.cols.expiration, nowrap: true},
				{key: 'legalRef', label: t.legal.cols.legalRef, render: (p) => <span class="s4vp-small">{p.legalRef}</span>},
				{key: 'verifiedText', label: t.legal.cols.verified, nowrap: true, render: (p) => <Badge text={p.verifiedText} tone={p.verified ? 'ok' : 'warn'} />},
				{key: 'act', label: t.legal.cols.act, nowrap: true, noRowClick: true, render: (p) => (p.verified ? '' : <Button small={true} label={t.legal.verify} ariaLabel={t.legal.verifyOf(p.code)} disabled={!canSetup || !!app.busy} title={canSetup ? '' : t.hrOnly} onClick={() => verify(p)} />)},
			];
			body = (
				<Card flush={true} label={t.legal.tabs.params}>
					<Table label={t.legal.tabs.params} columns={columns} rows={rows} search={true} searchPlaceholder={t.legal.search} empty={all.length ? t.legal.emptyFilter : t.legal.empty} maxHeight={TABLE_HEIGHT} toolbar={<Chips items={chips} value={legalFilter} onPick={setLegalFilter} label={t.legal.chips.label} />} />
				</Card>
			);
		} else if (which === 'brackets') {
			const rows = list(legal.brackets).map((b) => Object.assign({}, b, {effectiveText: fmtDate(b.effective), expirationText: fmtDate(b.expiration), upperText: blank(b.upper) ? t.legal.topBracket : money(b.upper), stateText: b.current ? t.legal.current : t.legal.notCurrent}));
			const columns = [
				{key: 'effectiveText', label: t.legal.cols.effective, nowrap: true},
				{key: 'expirationText', label: t.legal.cols.expiration, nowrap: true},
				{key: 'level', label: t.legal.cols.level, align: 'right', nowrap: true},
				{key: 'upperText', label: t.legal.cols.upper, align: 'right', nowrap: true},
				{key: 'rate', label: t.legal.cols.rate, type: 'pct', nowrap: true},
				{key: 'legalRef', label: t.legal.cols.legalRef, render: (b) => <span class="s4vp-small">{b.legalRef}</span>},
				{key: 'stateText', label: t.legal.cols.state, nowrap: true, render: currentBadge},
			];
			body = (
				<Card flush={true} label={t.legal.tabs.brackets}>
					<Table label={t.legal.tabs.brackets} columns={columns} rows={rows} search={true} searchPlaceholder={t.legal.search} empty={t.legal.empty} maxHeight={TABLE_HEIGHT} />
				</Card>
			);
		} else {
			const rows = list(legal.components).map((c) => Object.assign({}, c, {effectiveText: fmtDate(c.effective), expirationText: fmtDate(c.expiration), capText: plainNumber(c.capFactor), stateText: c.current ? t.legal.current : t.legal.notCurrent}));
			const columns = [
				{key: 'code', label: t.legal.cols.code, nowrap: true, render: (c) => <span class="s4vp-st-name">{c.code}</span>},
				{key: 'description', label: t.legal.cols.name},
				{key: 'employeeRate', label: t.legal.cols.ee, type: 'pct', nowrap: true},
				{key: 'employerRate', label: t.legal.cols.er, type: 'pct', nowrap: true},
				{key: 'capText', label: t.legal.cols.cap, align: 'right', nowrap: true},
				{key: 'effectiveText', label: t.legal.cols.effective, nowrap: true},
				{key: 'expirationText', label: t.legal.cols.expiration, nowrap: true},
				{key: 'legalRef', label: t.legal.cols.legalRef, render: (c) => <span class="s4vp-small">{c.legalRef}</span>},
				{key: 'stateText', label: t.legal.cols.state, nowrap: true, render: currentBadge},
			];
			body = (
				<Card flush={true} label={t.legal.tabs.components}>
					<Table label={t.legal.tabs.components} columns={columns} rows={rows} search={true} searchPlaceholder={t.legal.search} empty={t.legal.empty} maxHeight={TABLE_HEIGHT} />
				</Card>
			);
		}
		return (
			<div class="s4vp-st-hub">
				<div class="s4vp-st-bar">
					<Tabs items={tabs} value={which === 'params' ? '' : which} onPick={(v) => go('legal', v)} label={t.legal.tabsLabel} />
					<span class="s4vp-st-grow" />
					{listButton(which === 'brackets' ? 'pit_bracket' : which === 'components' ? 'ins_comp' : 'param', true)}
				</div>
				{which === 'params' && unverified ? note(t.legal.unverifiedNote(unverified), 'warn') : null}
				{body}
			</div>
		);
	};

	// ------------------------------------------------------------------ khung trang
	const SECTIONS = {
		approvals: {title: t.apv.title, sub: t.apv.sub, render: approvalsSection, actions: () => [listButton('approval_step', true), <Button label={t.apv.add} kind="primary" disabled={!canAccounts || !apv || !!apv.unavailable || !!app.busy} title={canAccounts ? '' : t.acctOnly} onClick={() => editApv(null)} />]},
		general: {title: t.general.title, sub: t.general.sub, render: generalSection},
		accounts: {title: t.accounts.title, sub: t.accounts.sub, render: accountsSection},
		costAccounts: {title: t.cost.title, sub: t.cost.sub, render: costSection, actions: () => [<Button label={t.cost.add} kind="primary" disabled={!canAccounts || !cost || !!cost.unavailable || !!app.busy} title={canAccounts ? '' : t.acctOnly} onClick={() => editCost(null)} />]},
		periods: {title: t.periodsSec.title, sub: t.periodsSec.sub, render: periodsSection, actions: () => [listButton('period', true), <Button label={t.periodsSec.generate} kind="primary" disabled={!canSetup || !boot.setupReady || !list(boot.paygroups).length || !!app.busy} title={!canSetup ? t.hrOnly : boot.setupReady ? '' : t.periodsSec.genNeedSetup} onClick={openGenerate} />]},
		legal: {title: t.legal.title, sub: t.legal.sub, render: legalSection},
	};
	const current = SECTIONS[section] || null;
	const safeRender = (fn) => {
		try {
			return fn();
		} catch (e) {
			return <Card><Empty text={`${t.renderError} ${String((e && e.message) || e)}`} /></Card>;
		}
	};
	const dialogBody = () => {
		if (!dialog) return null;
		if (dialog.kind === 'pack') return packDialog();
		if (dialog.kind === 'group') return groupDialog();
		if (dialog.kind === 'accounts') return accountsDialog();
		if (dialog.kind === 'ins') return insDialog();
		if (dialog.kind === 'cost') return costDialog();
		if (dialog.kind === 'generate') return generateDialog();
		if (dialog.kind === 'apv') return apvDialog();
		return null;
	};
	const summary = (status && status.summary) || null;
	const headerStatus = !current && summary ? (summary.missing || summary.attention ? {text: t.summary(summary), tone: summary.missing ? 'error' : 'warn'} : {text: t.summaryOk, tone: 'ok'}) : null;
	const actions = (current && current.actions ? current.actions() : []).concat([<Button label={t.refresh} onClick={() => (section === 'periods' ? app.reloadBoot() : load())} />]);
	if (!current) actions.unshift(<Button label={t.legacy} kind="ghost" onClick={() => app.go('setup')} />);
	return (
		<Page>
			<PageHeader
				title={current ? current.title : t.title}
				sub={current ? current.sub : subsidiary ? t.sub : t.noSubsidiary}
				status={headerStatus}
				back={current ? {label: t.title, onClick: () => go('')} : null}
				actions={actions}
			/>
			{safeRender(current ? current.render : hub)}
			{dialog ? safeRender(dialogBody) : null}
		</Page>
	);
}
