/**
 * Trang tự phục vụ của nhân viên (Suitelet s4vp_sl_my_payroll): một trang HTML + CSS + JS thuần, không dùng UIF, chạy
 * được trên màn hẹp 360 px. Bảng màu, bo góc, cỡ chữ theo giao diện bản 2 (spa/payroll/ui/css.js, tiền tố lớp ở đây là
 * s4ss-). Mọi chữ hiển thị nằm trong TEXT với đủ hai ngôn ngữ vi / en; máy chủ chọn bảng theo ngôn ngữ người dùng.
 *
 * html(boot) -> chuỗi HTML đầy đủ. boot: { lang: 'vi' | 'en', url (địa chỉ Suitelet), token (chống gửi chéo trang),
 *   employee: {code, name} | null, hasProfile, today, blocked: {en, vi} | null } (thông báo chặn, thay cho các tab).
 * Mã phía trình duyệt là hàm client() bên dưới, được chèn vào trang bằng Function.prototype.toString(): hàm này KHÔNG được
 * tham chiếu biến nào ngoài tham số BOOT và đối tượng của trình duyệt.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
	const TEXT = {
		vi: {
			title: "Cổng nhân viên", tabPay: "Phiếu lương", tabLeave: "Phép năm", tabReq: "Đơn của tôi", tabMe: "Thông tin",
			loading: "Đang tải...", retry: "Thử lại", close: "Đóng", back: "Các kỳ lương", search: "Tìm nhanh", noMatch: "Không có dòng nào khớp.",
			sessionExpired: "Phiên đăng nhập đã hết hạn hoặc mất kết nối. Hãy tải lại trang.", confidential: "Thông tin lương là bảo mật, không chia sẻ cho người khác.",
			noProfile: "Bạn chưa có hồ sơ lương nên chưa có phiếu lương, số dư phép và chưa gửi được đơn. Vui lòng liên hệ bộ phận nhân sự.",
			year: "Năm", period: "Kỳ lương", noSlips: "Chưa có phiếu lương đã ghi sổ trong năm này.", pickSlip: "Chọn một kỳ lương để xem chi tiết.",
			net: "Thực lĩnh", gross: "Tổng thu nhập", totalDed: "Tổng các khoản trừ", pdf: "Tải PDF", batch: "Bảng lương",
			vsPrev: "so với kỳ {0}", up: "Tăng {0}", down: "Giảm {0}", same: "Không đổi", noPrev: "Chưa có kỳ trước để so sánh.",
			why: "Vì sao khác kỳ trước", whyNone: "Các khoản giống kỳ trước.", raises: "làm thực lĩnh tăng", lowers: "làm thực lĩnh giảm", isNew: "mới có kỳ này", isGone: "kỳ này không còn",
			item: "Khoản", qty: "Số lượng", thisPeriod: "Kỳ này", prevPeriod: "Kỳ trước", change: "Chênh lệch",
			gEarn: "Thu nhập", gIns: "Bảo hiểm trừ vào lương", gTax: "Thuế thu nhập cá nhân", gOther: "Khấu trừ khác", gDays: "Ngày công",
			insTotal: "Cộng bảo hiểm", taxable: "Thu nhập chịu thuế", familyDed: "Giảm trừ gia cảnh ({0} người phụ thuộc)", assessable: "Thu nhập tính thuế", pit: "Thuế TNCN",
			otherDed: "Khấu trừ khác", advance: "Cấn trừ tạm ứng", stdDays: "Công chuẩn", workDays: "Công thực tế", paidLeave: "Nghỉ có lương", unpaidLeave: "Nghỉ không lương", otHours: "Giờ làm thêm",
			available: "Còn lại", entitled: "Được cấp", carried: "Chuyển từ năm trước", adjusted: "Điều chỉnh", used: "Đã dùng", pending: "Đang chờ duyệt", days: "ngày", hours: "giờ", colDays: "Số ngày", tileOther: "Tạm ứng, khấu trừ khác",
			carryExpiry: "Phép chuyển dùng đến {0}", noBalance: "Chưa có số dư phép của năm này.", leaveHistory: "Đơn nghỉ trong năm", leaveLedger: "Biến động số dư", noLeave: "Chưa có đơn nghỉ trong năm này.",
			date: "Ngày", type: "Loại", ref: "Chứng từ", srcA: "Cấp phép", srcC: "Chuyển phép", srcX: "Hết hạn", srcR: "Đơn nghỉ", srcJ: "Điều chỉnh",
			newReq: "Tạo đơn", allTypes: "Tất cả loại đơn", tLeave: "Nghỉ phép", tOt: "Làm thêm", tTrip: "Công tác", open: "Đang xử lý", closed: "Đã xong", noReq: "Chưa có đơn nào.",
			number: "Số đơn", time: "Thời gian", amount: "Số lượng", status: "Trạng thái", reason: "Lý do", actions: "Thao tác",
			stH: "Nháp", stP: "Chờ duyệt", stA: "Đã duyệt", stR: "Từ chối", stC: "Đã hủy", rejectedBecause: "Lý do từ chối: {0}",
			edit: "Sửa", submit: "Gửi duyệt", cancel: "Hủy đơn", keep: "Không hủy", confirmCancel: "Hủy đơn {0}? Đơn đã hủy không khôi phục được.",
			fType: "Loại đơn", fLeaveType: "Loại nghỉ", fFrom: "Từ ngày", fTo: "Đến ngày", fFromHalf: "Bắt đầu từ", fToHalf: "Kết thúc", halfA: "Buổi sáng", halfP: "Buổi chiều", endA: "Hết buổi sáng", endP: "Hết ngày",
			fDate: "Ngày làm thêm", fHours: "Số giờ", fNight: "Làm ban đêm", fReason: "Lý do", fDest: "Nơi công tác", fPurpose: "Mục đích", fAdvance: "Đề nghị tạm ứng (đồng)", dateHint: "dd/mm/yyyy",
			balanceLeft: "Còn {0} ngày", send: "Gửi duyệt", sending: "Đang gửi...", discard: "Bỏ qua", editTitle: "Sửa đơn nháp", newTitle: "Tạo đơn",
			eRequired: "Bắt buộc nhập.", eDate: "Nhập ngày dạng dd/mm/yyyy.", eRange: "Ngày kết thúc trước ngày bắt đầu.", eHours: "Số giờ phải lớn hơn 0 và không quá 12.", eAmount: "Số tiền phải từ 0 trở lên.",
			sent: "Đã gửi đơn {0}, đang chờ duyệt.", savedDraft: "Đơn {0} đã lưu nháp nhưng chưa gửi duyệt được: {1}", cancelled: "Đã hủy đơn {0}.",
			contract: "Hợp đồng hiện tại", noContract: "Chưa có hợp đồng trên hệ thống.", cNumber: "Số hợp đồng", cType: "Loại hợp đồng", cTitle: "Chức danh", cFrom: "Hiệu lực từ", cTo: "Hết hạn", indefinite: "Không thời hạn",
			ctP: "Thử việc", ctF: "Xác định thời hạn", ctU: "Không xác định thời hạn", ctS: "Thời vụ / khoán việc", ctC: "Cộng tác viên / dịch vụ",
			csA: "Hiệu lực", csX: "Hết hạn", csT: "Đã chấm dứt", csD: "Nháp", daysLeft: "Còn {0} ngày", expired: "Đã hết hạn",
			personal: "Hồ sơ của tôi", code: "Mã nhân viên", name: "Họ và tên", dept: "Phòng ban", jobTitle: "Chức danh", hireDate: "Ngày vào làm",
			taxCode: "Mã số thuế", personalId: "Số CCCD", siNumber: "Số sổ BHXH", bank: "Ngân hàng", bankAccount: "Số tài khoản", masked: "Số được che, chỉ hiện các ký tự cuối. Cần sửa thông tin, vui lòng liên hệ bộ phận nhân sự.",
			dependents: "Người phụ thuộc", noDependents: "Chưa đăng ký người phụ thuộc.", relationship: "Quan hệ", birthDate: "Ngày sinh", dedFrom: "Giảm trừ từ", dedTo: "Đến", active: "Đang giảm trừ", inactive: "Không còn giảm trừ",
		},
		en: {
			title: "Employee portal", tabPay: "Payslips", tabLeave: "Leave", tabReq: "My requests", tabMe: "My info",
			loading: "Loading...", retry: "Retry", close: "Close", back: "Pay periods", search: "Quick search", noMatch: "No matching rows.",
			sessionExpired: "Your session has expired or the connection was lost. Please reload the page.", confidential: "Payroll information is confidential. Do not share it.",
			noProfile: "You do not have a payroll profile yet, so there are no payslips or leave balances and requests cannot be sent. Please contact the HR department.",
			year: "Year", period: "Pay period", noSlips: "No released payslip in this year.", pickSlip: "Select a pay period to see the details.",
			net: "Net pay", gross: "Gross pay", totalDed: "Total deductions", pdf: "Download PDF", batch: "Payroll batch",
			vsPrev: "compared with {0}", up: "Up {0}", down: "Down {0}", same: "No change", noPrev: "No earlier period to compare with.",
			why: "Why it differs from the previous period", whyNone: "All items match the previous period.", raises: "raises net pay", lowers: "lowers net pay", isNew: "new this period", isGone: "not in this period",
			item: "Item", qty: "Quantity", thisPeriod: "This period", prevPeriod: "Previous", change: "Change",
			gEarn: "Earnings", gIns: "Insurance deducted from pay", gTax: "Personal income tax", gOther: "Other deductions", gDays: "Work days",
			insTotal: "Total insurance", taxable: "Taxable income", familyDed: "Family deduction ({0} dependents)", assessable: "Assessable income", pit: "Personal income tax",
			otherDed: "Other deductions", advance: "Advance offset", stdDays: "Standard days", workDays: "Actual days", paidLeave: "Paid leave", unpaidLeave: "Unpaid leave", otHours: "Overtime hours",
			available: "Available", entitled: "Entitled", carried: "Carried over", adjusted: "Adjusted", used: "Used", pending: "Pending approval", days: "days", hours: "hours", colDays: "Days", tileOther: "Advance and other deductions",
			carryExpiry: "Carried-over days expire on {0}", noBalance: "No leave balance for this year.", leaveHistory: "Leave requests in the year", leaveLedger: "Balance movements", noLeave: "No leave request in this year.",
			date: "Date", type: "Type", ref: "Document", srcA: "Accrual", srcC: "Carry-over", srcX: "Expired", srcR: "Leave request", srcJ: "Adjustment",
			newReq: "New request", allTypes: "All request types", tLeave: "Leave", tOt: "Overtime", tTrip: "Business trip", open: "In progress", closed: "Completed", noReq: "No requests yet.",
			number: "Number", time: "Dates", amount: "Quantity", status: "Status", reason: "Reason", actions: "Actions",
			stH: "Draft", stP: "Pending", stA: "Approved", stR: "Rejected", stC: "Cancelled", rejectedBecause: "Reject reason: {0}",
			edit: "Edit", submit: "Submit", cancel: "Cancel request", keep: "Keep it", confirmCancel: "Cancel request {0}? A cancelled request cannot be restored.",
			fType: "Request type", fLeaveType: "Leave type", fFrom: "From", fTo: "To", fFromHalf: "Starts", fToHalf: "Ends", halfA: "Morning", halfP: "Afternoon", endA: "After the morning", endP: "End of day",
			fDate: "Overtime date", fHours: "Hours", fNight: "Night work", fReason: "Reason", fDest: "Destination", fPurpose: "Purpose", fAdvance: "Advance requested (VND)", dateHint: "dd/mm/yyyy",
			balanceLeft: "{0} days available", send: "Submit", sending: "Sending...", discard: "Discard", editTitle: "Edit draft request", newTitle: "New request",
			eRequired: "This field is required.", eDate: "Enter a date as dd/mm/yyyy.", eRange: "The end date is before the start date.", eHours: "Hours must be greater than 0 and at most 12.", eAmount: "The amount must be zero or more.",
			sent: "Request {0} was submitted and is waiting for approval.", savedDraft: "Request {0} was saved as a draft but could not be submitted: {1}", cancelled: "Request {0} was cancelled.",
			contract: "Current contract", noContract: "No contract on file.", cNumber: "Contract number", cType: "Contract type", cTitle: "Job title", cFrom: "Effective from", cTo: "Expires", indefinite: "Indefinite term",
			ctP: "Probation", ctF: "Fixed term", ctU: "Indefinite term", ctS: "Seasonal / piecework", ctC: "Contractor / service",
			csA: "Active", csX: "Expired", csT: "Terminated", csD: "Draft", daysLeft: "{0} days left", expired: "Expired",
			personal: "My record", code: "Employee ID", name: "Full name", dept: "Department", jobTitle: "Job title", hireDate: "Hire date",
			taxCode: "Tax code", personalId: "ID number", siNumber: "Social insurance number", bank: "Bank", bankAccount: "Bank account", masked: "Numbers are masked; only the last characters are shown. To correct your details, please contact the HR department.",
			dependents: "Dependents", noDependents: "No dependents registered.", relationship: "Relationship", birthDate: "Date of birth", dedFrom: "Deduction from", dedTo: "To", active: "Deduction active", inactive: "No longer deducted",
		},
	};

	const CSS = `
:root{--bg:#F3F4F2;--surface:#FFFFFF;--text:#1D2730;--sub:#55616B;--accent:#24566B;--accent-dark:#16394A;--accent-soft:#E6EFF3;--line:#E1E5E8;--line-soft:#E8EBEE;--ctl:#B8C1C8;--ok:#0F5132;--ok-bg:#DDF1E4;--warn:#6B3A00;--warn-bg:#FFE9C7;--err:#8A1C14;--err-bg:#FBE3E0;--info:#16394A;--info-bg:#E6EFF3}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Oracle Sans",-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:1.4}
button,input,select,textarea{font:inherit;color:inherit;margin:0}
button{cursor:pointer}
button[disabled]{cursor:not-allowed;opacity:.55}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
h1,h2,h3,p{margin:0}
[hidden]{display:none!important}
.s4ss-top{background:var(--surface);border-bottom:1px solid #D9DEE2;position:sticky;top:0;z-index:5}
.s4ss-head{display:flex;gap:4px 12px;align-items:baseline;justify-content:space-between;flex-wrap:wrap;padding:8px 12px 0;max-width:1180px;margin:0 auto}
.s4ss-head h1{font-size:16px;font-weight:700}
.s4ss-who{font-size:12px;color:var(--sub);min-width:0;overflow-wrap:anywhere}
.s4ss-tabs{display:flex;max-width:1180px;margin:0 auto;padding:0 4px}
.s4ss-tab{flex:1 1 auto;min-width:0;background:none;border:0;border-bottom:3px solid transparent;color:#3A4650;padding:9px 4px 6px;min-height:44px;font-size:14px;line-height:1.2;white-space:nowrap}
@media (max-width:379px){.s4ss-tab{font-size:13px;padding-left:2px;padding-right:2px}}
.s4ss-tab[aria-selected="true"]{color:var(--accent-dark);border-bottom-color:var(--accent);font-weight:700}
.s4ss-page{max-width:1180px;margin:0 auto;padding:12px 12px 32px;display:flex;flex-direction:column;gap:12px;min-width:0}
.s4ss-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0}
.s4ss-card h2{font-size:15px;font-weight:700;margin-bottom:8px}
.s4ss-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.s4ss-row-end{justify-content:space-between}
.s4ss-sub{font-size:12px;color:var(--sub)}
.s4ss-btn{font-size:14px;min-height:40px;padding:0 16px;border-radius:8px;border:1px solid var(--ctl);background:var(--surface);color:var(--text);display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;text-decoration:none}
.s4ss-btn:hover{background:#F7F8F9}
.s4ss-btn-primary{font-weight:600;border-color:var(--accent);background:var(--accent);color:#FFFFFF}
.s4ss-btn-primary:hover{background:var(--accent-dark)}
.s4ss-btn-danger{font-weight:600;border-color:var(--err);color:var(--err)}
.s4ss-btn-danger:hover{background:var(--err-bg)}
.s4ss-btn-sm{min-height:36px;padding:0 10px;font-size:13px}
.s4ss-in{min-height:40px;padding:6px 10px;border:1px solid var(--ctl);border-radius:8px;background:var(--surface);width:100%;min-width:0}
textarea.s4ss-in{min-height:72px;resize:vertical}
.s4ss-in[aria-invalid="true"]{border-color:var(--err)}
.s4ss-search{flex:1 1 180px;max-width:320px}
.s4ss-sel{width:auto;flex:0 0 auto}
.s4ss-strip{padding:8px 12px;border-radius:8px;border:1px solid transparent;display:flex;gap:8px;align-items:flex-start;justify-content:space-between;overflow-wrap:anywhere}
.s4ss-strip-ok{color:var(--ok);background:var(--ok-bg);border-color:#B7DFC5}
.s4ss-strip-warn{color:var(--warn);background:var(--warn-bg);border-color:#F0D3A6}
.s4ss-strip-error{color:var(--err);background:var(--err-bg);border-color:#F1BDB7}
.s4ss-strip-info{color:var(--info);background:var(--info-bg);border-color:#C9DCE4}
.s4ss-x{background:none;border:0;min-width:32px;min-height:32px;border-radius:8px;font-size:18px;line-height:1;color:inherit;flex:0 0 auto}
.s4ss-badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;background:var(--line-soft);color:var(--sub)}
.s4ss-b-P{background:var(--warn-bg);color:var(--warn)}
.s4ss-b-A{background:var(--ok-bg);color:var(--ok)}
.s4ss-b-R{background:var(--err-bg);color:var(--err)}
.s4ss-b-H{background:var(--info-bg);color:var(--info)}
.s4ss-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start}
.s4ss-list{display:flex;flex-direction:column;gap:6px}
.s4ss-slip{display:flex;justify-content:space-between;gap:8px;align-items:center;width:100%;text-align:left;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-height:52px}
.s4ss-slip:hover{background:#F7F8F9}
.s4ss-slip[aria-current="true"]{border-color:var(--accent);background:var(--accent-soft)}
.s4ss-slip b{display:block}
.s4ss-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.s4ss-hero{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:flex-end;justify-content:space-between}
.s4ss-big{font-size:28px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums}
.s4ss-up{color:var(--ok)}
.s4ss-down{color:var(--err)}
.s4ss-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.s4ss-tile{border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:0;background:var(--surface)}
.s4ss-tile b{display:block;font-size:17px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.s4ss-why{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.s4ss-why li{display:flex;justify-content:space-between;gap:8px;align-items:baseline;border-bottom:1px solid var(--line-soft);padding:4px 0}
.s4ss-why li:last-child{border-bottom:0}
.s4ss-scroll{overflow-x:auto;max-width:100%}
table.s4ss-t{border-collapse:collapse;width:100%}
.s4ss-t th,.s4ss-t td{padding:7px 8px;border-bottom:1px solid var(--line-soft);text-align:left;vertical-align:top}
.s4ss-t th{font-size:12px;font-weight:600;color:var(--sub);white-space:nowrap}
.s4ss-t td:first-child,.s4ss-t th:first-child{padding-left:0}
.s4ss-t td:last-child,.s4ss-t th:last-child{padding-right:0}
.s4ss-t th.s4ss-num,.s4ss-t td.s4ss-num{text-align:right}
.s4ss-t tr.s4ss-g td{font-weight:700;background:var(--bg);padding-left:8px;border-bottom:0}
.s4ss-t tr.s4ss-sum td{font-weight:700}
.s4ss-t tr.s4ss-net td{font-weight:700;font-size:15px;border-top:2px solid var(--accent);border-bottom:0}
.s4ss-wide{display:none}
.s4ss-kv{display:grid;grid-template-columns:minmax(110px,2fr) 3fr;gap:6px 12px}
.s4ss-kv dt{color:var(--sub);font-size:13px}
.s4ss-kv dd{margin:0;overflow-wrap:anywhere}
dl{margin:0}
.s4ss-bal{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.s4ss-req{border:1px solid var(--line);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px;background:var(--surface)}
.s4ss-reqs{display:flex;flex-direction:column;gap:8px}
.s4ss-empty{color:var(--sub);padding:12px 0}
.s4ss-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--ctl);border-top-color:var(--accent);animation:s4ss-rot .8s linear infinite;display:inline-block;vertical-align:middle;margin-right:8px}
@keyframes s4ss-rot{to{transform:rotate(360deg)}}
.s4ss-modal{position:fixed;inset:0;background:rgba(29,39,48,.45);z-index:20;display:flex;align-items:flex-end;justify-content:center}
.s4ss-dialog{background:var(--surface);width:100%;max-width:560px;max-height:100%;overflow:auto;border-radius:12px 12px 0 0;padding:14px 14px 16px;display:flex;flex-direction:column;gap:12px}
.s4ss-dialog h2{font-size:17px}
.s4ss-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.s4ss-f{display:flex;flex-direction:column;gap:3px;min-width:0}
.s4ss-f-full{grid-column:1 / -1}
.s4ss-f label{font-size:13px;font-weight:600}
.s4ss-err{color:var(--err);font-size:12px}
.s4ss-seg{display:flex;border:1px solid var(--ctl);border-radius:8px;overflow:hidden}
.s4ss-seg button{flex:1 1 0;min-width:0;min-height:40px;border:0;background:var(--surface);border-right:1px solid var(--ctl);padding:0 4px}
.s4ss-seg button:last-child{border-right:0}
.s4ss-seg button[aria-pressed="true"]{background:var(--accent);color:#FFFFFF;font-weight:600}
.s4ss-check{display:flex;gap:8px;align-items:center;min-height:40px}
.s4ss-check input{width:18px;height:18px}
.s4ss-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.s4ss-backbtn{align-self:flex-start}
@media (max-width:811px){.s4ss-detail-open .s4ss-col-list{display:none}.s4ss-pick{display:none}}
@media (min-width:600px){.s4ss-wide{display:table-cell}.s4ss-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}.s4ss-modal{align-items:center;padding:16px}.s4ss-dialog{border-radius:12px}}
@media (min-width:812px){.s4ss-cols{grid-template-columns:minmax(280px,4fr) minmax(0,6fr)}.s4ss-backbtn{display:none}.s4ss-head{padding-top:10px}.s4ss-tab{flex:0 0 auto;padding-left:14px;padding-right:14px}}
`;

	/* eslint-disable */
	/** Mã chạy trong trình duyệt. Tự chứa: chỉ dùng BOOT và DOM. */
	function client(BOOT) {
		var T = BOOT.text;
		var EN = BOOT.lang === "en";
		var root = document.getElementById("s4ss");
		var S = { tab: "pay", notice: null, pay: { year: null, data: null, sel: null, detail: null, loading: false }, leave: { year: null, data: null }, req: { data: null, type: "" }, me: { data: null }, modal: null };

		function h(tag, attrs, kids) {
			var el = document.createElement(tag);
			var a = attrs || {};
			Object.keys(a).forEach(function (k) {
				var v = a[k];
				if (v === null || v === undefined || v === false) return;
				if (k === "class") el.className = v;
				else if (k === "text") el.textContent = v;
				else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
				else el.setAttribute(k, v === true ? "" : v);
			});
			(Array.isArray(kids) ? kids : kids === undefined || kids === null ? [] : [kids]).forEach(function (c) {
				if (c === null || c === undefined || c === false) return;
				el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
			});
			return el;
		}
		function fmt(s) {
			var args = arguments;
			return String(s).replace(/\{(\d)\}/g, function (m, i) { return args[Number(i) + 1] === undefined ? "" : args[Number(i) + 1]; });
		}
		function fold(s) {
			return String(s === null || s === undefined ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
		}
		function group(n) {
			return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, EN ? "," : ".");
		}
		function money(v) {
			var n = Math.round(Number(v) || 0);
			if (n === 0) return "-";
			return (n < 0 ? "-" : "") + group(Math.abs(n));
		}
		function signed(v) {
			var n = Math.round(Number(v) || 0);
			if (n === 0) return "-";
			return (n > 0 ? "+" : "-") + group(Math.abs(n));
		}
		function qty(v) {
			var n = Math.round((Number(v) || 0) * 100) / 100;
			if (n === 0) return "-";
			var p = String(Math.abs(n)).split(".");
			return (n < 0 ? "-" : "") + group(p[0]) + (p[1] ? (EN ? "." : ",") + p[1] : "");
		}
		function day(iso) {
			var s = String(iso || "");
			return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "";
		}
		function span(from, to) {
			return !to || to === from ? day(from) : day(from) + " - " + day(to);
		}
		function parseDay(text) {
			var s = String(text || "").trim();
			var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
			var y, mo, d;
			if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
			else {
				m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
				if (!m) return null;
				y = +m[1]; mo = +m[2]; d = +m[3];
			}
			if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
			return y + "-" + (mo < 10 ? "0" : "") + mo + "-" + (d < 10 ? "0" : "") + d;
		}
		function msg(m) {
			if (!m) return "";
			return typeof m === "string" ? m : (EN ? m.en : m.vi) || m.vi || m.en || "";
		}

		// ---- gọi máy chủ: mọi lượt đều do máy chủ lọc theo người đăng nhập, trang không gửi mã nhân viên
		function parse(res) {
			return res.text().then(function (t) {
				var o;
				try { o = JSON.parse(t); } catch (e) { o = null; }
				if (!o || typeof o.ok !== "boolean") throw new Error(T.sessionExpired);
				if (!o.ok) { var er = new Error(msg(o.message)); er.fields = o.fields; er.code = o.code; throw er; }
				return o.data;
			});
		}
		function get(op, params) {
			var q = "&op=" + encodeURIComponent(op);
			Object.keys(params || {}).forEach(function (k) {
				if (params[k] !== null && params[k] !== undefined && params[k] !== "") q += "&" + k + "=" + encodeURIComponent(params[k]);
			});
			return fetch(BOOT.url + q, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(parse, function () { throw new Error(T.sessionExpired); });
		}
		function post(op, body) {
			var b = Object.assign({ op: op, token: BOOT.token }, body);
			return fetch(BOOT.url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-S4VP-Request": "1", Accept: "application/json" }, body: JSON.stringify(b) }).then(parse, function () { throw new Error(T.sessionExpired); });
		}

		// ---- thành phần dùng chung
		function badge(st) {
			return h("span", { class: "s4ss-badge s4ss-b-" + st, text: T["st" + st] || st });
		}
		function strip(kind, text, onClose) {
			return h("div", { class: "s4ss-strip s4ss-strip-" + kind, role: kind === "error" ? "alert" : "status" }, [h("span", { text: text }), onClose ? h("button", { class: "s4ss-x", type: "button", "aria-label": T.close, onclick: onClose, text: "×" }) : null]);
		}
		function loading() {
			return h("div", { class: "s4ss-empty", role: "status" }, [h("span", { class: "s4ss-spin" }), T.loading]);
		}
		function failed(text, again) {
			return h("div", { class: "s4ss-card" }, [strip("error", text), h("div", { class: "s4ss-row", style: "margin-top:8px" }, [h("button", { class: "s4ss-btn", type: "button", onclick: again, text: T.retry })])]);
		}
		/** Ô tìm nhanh: ẩn các phần tử [data-q] không khớp trong vùng `scope` (không phân biệt dấu). */
		function search(scope) {
			var empty = h("div", { class: "s4ss-empty", hidden: true, text: T.noMatch });
			var input = h("input", {
				class: "s4ss-in s4ss-search", type: "search", placeholder: T.search, "aria-label": T.search,
				oninput: function () {
					var q = fold(input.value).trim();
					var rows = scope().querySelectorAll("[data-q]");
					var shown = 0;
					for (var i = 0; i < rows.length; i++) {
						var ok = !q || rows[i].getAttribute("data-q").indexOf(q) >= 0;
						rows[i].hidden = !ok;
						if (ok) shown++;
					}
					empty.hidden = !(q && rows.length && !shown);
				},
			});
			return { input: input, empty: empty };
		}
		function table(heads, rows) {
			return h("div", { class: "s4ss-scroll" }, [h("table", { class: "s4ss-t" }, [h("thead", {}, [h("tr", {}, heads.map(function (c) { return h("th", { class: c.cls || "", scope: "col", text: c.label }); }))]), h("tbody", {}, rows)])]);
		}
		function yearSelect(years, value, onChange) {
			var sel = h("select", { class: "s4ss-in s4ss-sel", "aria-label": T.year, onchange: function () { onChange(sel.value); } }, (years || []).map(function (y) { return h("option", { value: y, selected: String(y) === String(value), text: T.year + " " + y }); }));
			return sel;
		}
		function noProfile() {
			return strip("warn", T.noProfile);
		}

		// ---- Phiếu lương
		function loadPay(year) {
			S.pay.data = null; S.pay.error = null; S.pay.sel = null; S.pay.detail = null;
			render();
			get("payslips", { year: year }).then(function (d) {
				S.pay.data = d; S.pay.year = d.year;
				if (d.rows.length && window.matchMedia("(min-width:812px)").matches) openSlip(d.rows[0].batch);
				else render();
			}, function (e) { S.pay.error = e.message; render(); });
		}
		function openSlip(batch) {
			S.pay.sel = batch; S.pay.detail = null; S.pay.detailError = null;
			render();
			get("payslip", { batch: batch }).then(function (d) {
				if (S.pay.sel !== batch) return;
				S.pay.detail = d; render();
				if (!window.matchMedia("(min-width:812px)").matches) window.scrollTo(0, 0);
			}, function (e) { if (S.pay.sel === batch) { S.pay.detailError = e.message; render(); } });
		}
		function slipDetail(d) {
			var v = d.view, f = v.figures, c = d.compare, has = c.hasPrevious;
			var net = c.totals.net;
			var trend;
			if (!has) trend = h("span", { class: "s4ss-sub", text: T.noPrev });
			else if (!net.diff) trend = h("span", { class: "s4ss-sub", text: T.same + " " + fmt(T.vsPrev, d.previous.periodName) });
			else trend = h("span", { class: net.diff > 0 ? "s4ss-up" : "s4ss-down" }, [fmt(net.diff > 0 ? T.up : T.down, money(Math.abs(net.diff))) + (net.pct === null ? "" : " (" + qty(Math.abs(net.pct) * 100) + "%)") + " " + fmt(T.vsPrev, d.previous.periodName)]);
			var body = h("div", {});
			var q = {};
			v.earnings.forEach(function (e) { q[e.code] = (q[e.code] || 0) + e.quantity; });
			function line(name, r, quantity, cls, noSearch) {
				return h("tr", { class: cls || "", "data-q": noSearch ? null : fold(name + " " + money(r.current) + " " + Math.round(r.current || 0)) }, [
					h("td", {}, [name, r.kind === "new" ? h("div", { class: "s4ss-sub", text: T.isNew }) : r.kind === "gone" ? h("div", { class: "s4ss-sub", text: T.isGone }) : null]),
					h("td", { class: "s4ss-num s4ss-wide", text: quantity === null || quantity === undefined ? "" : qty(quantity) }),
					h("td", { class: "s4ss-num", text: money(r.current) }),
					h("td", { class: "s4ss-num s4ss-wide", text: has ? money(r.previous) : "" }),
					h("td", { class: "s4ss-num", text: has ? signed(r.diff) : "" }),
				]);
			}
			function grp(label) {
				return h("tr", { class: "s4ss-g" }, [h("td", { colspan: 5, text: label })]);
			}
			function plain(name, value) {
				return h("tr", { "data-q": fold(name) }, [h("td", { text: name }), h("td", { class: "s4ss-wide" }), h("td", { class: "s4ss-num", text: money(value) }), h("td", { class: "s4ss-wide" }), h("td", {})]);
			}
			var rows = [grp(T.gEarn)];
			c.earnings.forEach(function (r) { rows.push(line(r.name, r, q[r.code])); });
			rows.push(line(T.gross, c.totals.gross, null, "s4ss-sum", true));
			if (c.insurance.length || c.totals.ee_ins.current || c.totals.ee_ins.previous) {
				rows.push(grp(T.gIns));
				c.insurance.forEach(function (r) { rows.push(line(r.name, r)); });
				rows.push(line(T.insTotal, c.totals.ee_ins, null, "s4ss-sum", true));
			}
			rows.push(grp(T.gTax));
			rows.push(plain(T.taxable, f.taxable));
			rows.push(plain(fmt(T.familyDed, f.dependents), f.family_ded));
			rows.push(plain(T.assessable, f.assessable));
			rows.push(line(T.pit, c.totals.pit, null, "s4ss-sum", true));
			if (c.deductions.length || c.totals.other_ded.current || c.totals.advance.current || c.totals.advance.previous || c.totals.other_ded.previous) {
				rows.push(grp(T.gOther));
				c.deductions.forEach(function (r) { rows.push(line(r.name, r)); });
				if (!c.deductions.length && (c.totals.other_ded.current || c.totals.other_ded.previous)) rows.push(line(T.otherDed, c.totals.other_ded));
				if (c.totals.advance.current || c.totals.advance.previous) rows.push(line(T.advance, c.totals.advance));
			}
			rows.push(line(T.net, c.totals.net, null, "s4ss-net", true));
			var find = search(function () { return body; });
			body.appendChild(table([{ label: T.item }, { label: T.qty, cls: "s4ss-num s4ss-wide" }, { label: T.thisPeriod, cls: "s4ss-num" }, { label: T.prevPeriod, cls: "s4ss-num s4ss-wide" }, { label: T.change, cls: "s4ss-num" }], rows));
			body.appendChild(find.empty);
			var why = null;
			if (has) {
				why = h("div", { class: "s4ss-card" }, [h("h2", { text: T.why }), c.reasons.length ? h("ul", { class: "s4ss-why" }, c.reasons.map(function (r) {
					var name = r.group === "pit" ? T.pit : r.group === "advance" ? T.advance : r.name;
					return h("li", {}, [h("span", {}, [name, " ", h("span", { class: "s4ss-sub", text: "- " + (r.effect > 0 ? T.raises : T.lowers) + (r.kind === "new" ? ", " + T.isNew : r.kind === "gone" ? ", " + T.isGone : "") })]), h("span", { class: "s4ss-num " + (r.effect > 0 ? "s4ss-up" : "s4ss-down"), text: signed(r.effect) })]);
				})) : h("p", { class: "s4ss-sub", text: T.whyNone })]);
			}
			function tile(label, value) {
				return h("div", { class: "s4ss-tile" }, [h("span", { class: "s4ss-sub", text: label }), h("b", { text: money(value) })]);
			}
			return [
				h("button", { class: "s4ss-btn s4ss-btn-sm s4ss-backbtn", type: "button", onclick: function () { S.pay.sel = null; S.pay.detail = null; render(); } }, ["‹ " + T.back]),
				h("div", { class: "s4ss-card" }, [
					h("div", { class: "s4ss-row s4ss-row-end" }, [
						h("div", {}, [h("h2", { style: "margin:0", text: T.period + " " + d.slip.periodName }), h("div", { class: "s4ss-sub", text: span(d.slip.start, d.slip.end) + " · " + T.batch + " " + d.slip.batchName })]),
						d.slip.canPdf ? h("a", { class: "s4ss-btn s4ss-btn-sm", href: BOOT.url + "&op=pdf&batch=" + encodeURIComponent(d.slip.batch), target: "_blank", rel: "noopener", text: T.pdf }) : null,
					]),
					h("div", { class: "s4ss-hero", style: "margin-top:10px" }, [h("div", {}, [h("div", { class: "s4ss-sub", text: T.net }), h("div", { class: "s4ss-big", text: money(f.net) })]), h("div", {}, [trend])]),
				]),
				h("div", { class: "s4ss-tiles" }, [tile(T.gross, f.gross), tile(T.gIns, f.ee_ins), tile(T.pit, f.pit), tile(T.tileOther, f.other_ded + f.advance)]),
				why,
				h("div", { class: "s4ss-card" }, [h("div", { class: "s4ss-row", style: "margin-bottom:6px" }, [find.input]), body]),
				h("div", { class: "s4ss-card" }, [h("h2", { text: T.gDays }), h("dl", { class: "s4ss-kv" }, [[T.stdDays, f.std_days], [T.workDays, f.work_days], [T.paidLeave, f.paid_leave], [T.unpaidLeave, f.unpaid_leave], [T.otHours, f.ot_hours]].reduce(function (acc, p) { acc.push(h("dt", { text: p[0] }), h("dd", { class: "s4ss-num", style: "text-align:left", text: qty(p[1]) })); return acc; }, []))]),
				h("p", { class: "s4ss-sub", text: T.confidential }),
			];
		}
		function viewPay() {
			var p = S.pay;
			if (p.error) return [failed(p.error, function () { loadPay(p.year); })];
			if (!p.data) return [loading()];
			var d = p.data;
			var listBox = h("div", { class: "s4ss-list" });
			var find = search(function () { return listBox; });
			d.rows.forEach(function (r) {
				listBox.appendChild(h("button", { class: "s4ss-slip", type: "button", "aria-current": p.sel === r.batch ? "true" : null, "data-q": fold(r.periodName + " " + r.batchName + " " + day(r.end) + " " + money(r.net) + " " + Math.round(r.net)), onclick: function () { openSlip(r.batch); } }, [
					h("span", {}, [h("b", { text: r.periodName || r.batchName }), h("span", { class: "s4ss-sub", text: span(r.start, r.end) })]),
					h("span", { class: "s4ss-num" }, [h("b", { text: money(r.net) }), h("span", { class: "s4ss-sub", text: T.net })]),
				]));
			});
			var list = h("div", { class: "s4ss-card s4ss-col-list" }, [
				h("div", { class: "s4ss-row", style: "margin-bottom:8px" }, [yearSelect(d.years, d.year, loadPay), find.input]),
				d.rows.length ? listBox : h("div", { class: "s4ss-empty", text: T.noSlips }), find.empty,
			]);
			var detail;
			if (!p.sel) detail = d.rows.length ? [h("div", { class: "s4ss-card s4ss-empty s4ss-pick", text: T.pickSlip })] : [];
			else if (p.detailError) detail = [h("button", { class: "s4ss-btn s4ss-btn-sm s4ss-backbtn", type: "button", onclick: function () { S.pay.sel = null; render(); } }, ["‹ " + T.back]), failed(p.detailError, function () { openSlip(p.sel); })];
			else if (!p.detail) detail = [loading()];
			else detail = slipDetail(p.detail);
			return [d.hasProfile ? null : noProfile(), h("div", { class: "s4ss-cols" + (p.sel ? " s4ss-detail-open" : "") }, [list, h("div", { style: "display:flex;flex-direction:column;gap:12px;min-width:0" }, detail)])];
		}

		// ---- Phép năm
		function loadLeave(year) {
			S.leave.data = null; S.leave.error = null;
			render();
			get("leave", { year: year }).then(function (d) { S.leave.data = d; S.leave.year = d.year; render(); }, function (e) { S.leave.error = e.message; render(); });
		}
		function viewLeave() {
			var L = S.leave;
			if (L.error) return [failed(L.error, function () { loadLeave(L.year); })];
			if (!L.data) return [loading()];
			var d = L.data;
			var cards = d.balances.map(function (b) {
				return h("div", { class: "s4ss-card" }, [
					h("div", { class: "s4ss-sub", text: b.name + (b.code ? " (" + b.code + ")" : "") }),
					h("div", { class: "s4ss-big" }, [qty(b.available) === "-" ? "0" : qty(b.available), " ", h("span", { class: "s4ss-sub", style: "font-weight:400", text: T.days + " " + T.available.toLowerCase() })]),
					h("dl", { class: "s4ss-kv", style: "margin-top:8px" }, [h("dt", { text: T.entitled }), h("dd", { text: qty(b.entitled) }), h("dt", { text: T.carried }), h("dd", { text: qty(b.carried) }), b.adjusted ? h("dt", { text: T.adjusted }) : null, b.adjusted ? h("dd", { text: qty(b.adjusted) }) : null, h("dt", { text: T.used }), h("dd", { text: qty(b.used) }), h("dt", { text: T.pending }), h("dd", { text: qty(b.pending) })]),
					b.carryExpiry && b.carried > 0 ? h("div", { class: "s4ss-sub", style: "margin-top:6px", text: fmt(T.carryExpiry, day(b.carryExpiry)) }) : null,
				]);
			});
			var all = d.requests.open.concat(d.requests.closed);
			var box = h("div", {});
			var find = search(function () { return box; });
			box.appendChild(all.length ? table([{ label: T.number, cls: "s4ss-wide" }, { label: T.type }, { label: T.time }, { label: T.colDays, cls: "s4ss-num" }, { label: T.status }], all.map(function (r) {
				return h("tr", { "data-q": fold([r.number, r.leaveName, r.leaveCode, span(r.from, r.to), T["st" + r.status], r.reason].join(" ")) }, [h("td", { class: "s4ss-wide", text: r.number }), h("td", { text: r.leaveName || r.leaveCode }), h("td", { text: span(r.from, r.to) }), h("td", { class: "s4ss-num", text: qty(r.days) }), h("td", {}, [badge(r.status)])]);
			})) : h("div", { class: "s4ss-empty", text: T.noLeave }));
			box.appendChild(find.empty);
			var box2 = h("div", {});
			var find2 = search(function () { return box2; });
			box2.appendChild(table([{ label: T.date }, { label: T.type }, { label: T.ref, cls: "s4ss-wide" }, { label: T.colDays, cls: "s4ss-num" }], d.transactions.map(function (t) {
				var src = T["src" + t.source] || t.source;
				return h("tr", { "data-q": fold([day(t.date), src, t.leaveName, t.leaveCode, t.ref].join(" ")) }, [h("td", { text: day(t.date) }), h("td", {}, [src, h("div", { class: "s4ss-sub", text: t.leaveName || t.leaveCode })]), h("td", { class: "s4ss-wide", text: t.ref }), h("td", { class: "s4ss-num " + (t.qty > 0 ? "s4ss-up" : t.qty < 0 ? "s4ss-down" : ""), text: (t.qty > 0 ? "+" : "") + qty(t.qty) })]);
			})));
			box2.appendChild(find2.empty);
			return [
				d.hasProfile ? null : noProfile(),
				h("div", { class: "s4ss-row s4ss-row-end" }, [yearSelect(d.years, d.year, loadLeave), h("button", { class: "s4ss-btn s4ss-btn-primary", type: "button", disabled: !d.hasProfile, onclick: function () { openForm("leave"); }, text: T.newReq })]),
				cards.length ? h("div", { class: "s4ss-bal" }, cards) : h("div", { class: "s4ss-card s4ss-empty", text: T.noBalance }),
				h("div", { class: "s4ss-card" }, [h("div", { class: "s4ss-row s4ss-row-end", style: "margin-bottom:6px" }, [h("h2", { style: "margin:0", text: T.leaveHistory }), all.length ? find.input : null]), box]),
				d.transactions.length ? h("div", { class: "s4ss-card" }, [h("div", { class: "s4ss-row s4ss-row-end", style: "margin-bottom:6px" }, [h("h2", { style: "margin:0", text: T.leaveLedger }), find2.input]), box2]) : null,
			];
		}

		// ---- Đơn của tôi
		var TYPE_LABEL = { leave: T.tLeave, ot: T.tOt, trip: T.tTrip };
		function loadReq() {
			S.req.data = null; S.req.error = null;
			render();
			get("requests").then(function (d) { S.req.data = d; render(); }, function (e) { S.req.error = e.message; render(); });
		}
		function ensureLookups(then) {
			if (S.req.data) return then();
			get("requests").then(function (d) { S.req.data = d; then(); }, function (e) { S.notice = { kind: "error", text: e.message }; render(); });
		}
		function reqCard(r) {
			var what = r.type === "leave" ? r.leaveName || r.leaveCode : r.type === "trip" ? r.destination : "";
			var amount = r.type === "ot" ? qty(r.hours) + " " + T.hours : qty(r.days) + " " + T.days;
			return h("div", { class: "s4ss-req", "data-type": r.type, "data-q": fold([r.number, TYPE_LABEL[r.type], what, span(r.from, r.to), T["st" + r.status], r.reason].join(" ")) }, [
				h("div", { class: "s4ss-row s4ss-row-end" }, [h("b", { text: TYPE_LABEL[r.type] + (what ? " - " + what : "") }), badge(r.status)]),
				h("div", {}, [span(r.from, r.to), " · ", amount, r.number ? h("span", { class: "s4ss-sub", text: " · " + r.number }) : null]),
				r.reason ? h("div", { class: "s4ss-sub", text: r.reason }) : null,
				r.rejectReason ? h("div", { class: "s4ss-err", text: fmt(T.rejectedBecause, r.rejectReason) }) : null,
				r.canEdit || r.canSubmit || r.canCancel ? h("div", { class: "s4ss-row" }, [
					r.canEdit ? h("button", { class: "s4ss-btn s4ss-btn-sm", type: "button", onclick: function () { openForm(r.type, r); }, text: T.edit }) : null,
					r.canSubmit ? h("button", { class: "s4ss-btn s4ss-btn-sm s4ss-btn-primary", type: "button", onclick: function () { act(r, "submit"); }, text: T.submit }) : null,
					r.canCancel ? h("button", { class: "s4ss-btn s4ss-btn-sm s4ss-btn-danger", type: "button", onclick: function () { confirmCancel(r); }, text: T.cancel }) : null,
				]) : null,
			]);
		}
		function viewReq() {
			var R = S.req;
			if (R.error) return [failed(R.error, loadReq)];
			if (!R.data) return [loading()];
			var d = R.data;
			var box = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
			var find = search(function () { return box; });
			function section(label, rows) {
				var list = rows.filter(function (r) { return !R.type || r.type === R.type; });
				return h("div", { class: "s4ss-card" }, [h("h2", { text: label + " (" + list.length + ")" }), list.length ? h("div", { class: "s4ss-reqs" }, list.map(reqCard)) : h("div", { class: "s4ss-empty", text: T.noReq })]);
			}
			box.appendChild(section(T.open, d.requests.open));
			box.appendChild(section(T.closed, d.requests.closed));
			var sel = h("select", { class: "s4ss-in s4ss-sel", "aria-label": T.fType, onchange: function () { R.type = sel.value; render(); } }, [["", T.allTypes], ["leave", T.tLeave], ["ot", T.tOt], ["trip", T.tTrip]].map(function (o) { return h("option", { value: o[0], selected: R.type === o[0], text: o[1] }); }));
			return [
				d.hasProfile ? null : noProfile(),
				h("div", { class: "s4ss-row s4ss-row-end" }, [h("div", { class: "s4ss-row", style: "flex:1 1 240px" }, [sel, find.input]), h("button", { class: "s4ss-btn s4ss-btn-primary", type: "button", disabled: !d.hasProfile, onclick: function () { openForm(R.type || "leave"); }, text: T.newReq })]),
				box, find.empty,
			];
		}
		function refreshAfterWrite() {
			S.leave.data = null;
			S.modal = null;
			if (S.tab === "leave") { loadLeave(S.leave.year); get("requests").then(function (d) { S.req.data = d; }, function () {}); }
			else { S.tab = "req"; loadReq(); }
		}
		function act(r, action) {
			S.notice = null;
			post("requestAction", { type: r.type, id: r.id, action: action }).then(function (d) {
				S.notice = { kind: "ok", text: fmt(action === "cancel" ? T.cancelled : T.sent, d.request.number || "") };
				refreshAfterWrite();
			}, function (e) { S.modal = null; S.notice = { kind: "error", text: e.message }; render(); });
		}
		function confirmCancel(r) {
			S.modal = { kind: "confirm", text: fmt(T.confirmCancel, r.number || ""), yes: function () { act(r, "cancel"); } };
			render();
		}
		function openForm(type, row) {
			ensureLookups(function () {
				var r = row || {};
				S.modal = { kind: "form", type: type, id: r.id || null, errors: {}, busy: false, v: {
					leave_type: r.leaveType || "", from: day(r.from), to: day(r.to), from_half: r.fromHalf || "A", to_half: r.toHalf || "P",
					work_date: day(r.from), hours: r.hours || "", is_night: !!r.isNight, reason: r.reason || "", destination: r.destination || "", purpose: row && type === "trip" ? r.reason : "", advance_amount: r.advanceAmount || "",
				} };
				render();
			});
		}
		function checkForm(m) {
			var v = m.v, e = {};
			function need(k) { if (!String(v[k] === null || v[k] === undefined ? "" : v[k]).trim()) e[k] = T.eRequired; }
			function isDay(k) { if (!e[k] && !parseDay(v[k])) e[k] = T.eDate; }
			if (m.type === "leave" || m.type === "trip") {
				if (m.type === "leave") need("leave_type");
				need("from"); isDay("from");
				if (String(v.to || "").trim()) { isDay("to"); if (!e.from && !e.to && parseDay(v.to) < parseDay(v.from)) e.to = T.eRange; }
				if (m.type === "trip") {
					need("destination"); need("purpose");
					if (String(v.advance_amount || "").trim() && !(Number(String(v.advance_amount).replace(/[.,\s]/g, "")) >= 0)) e.advance_amount = T.eAmount;
				}
			} else {
				need("work_date"); isDay("work_date");
				var hrs = Number(String(v.hours).replace(",", "."));
				if (!(hrs > 0 && hrs <= 12)) e.hours = T.eHours;
				need("reason");
			}
			return e;
		}
		function sendForm() {
			var m = S.modal;
			m.errors = checkForm(m);
			m.error = null;
			if (Object.keys(m.errors).length) { render(); var bad = document.querySelector('.s4ss-dialog [aria-invalid="true"]'); if (bad) bad.focus(); return; }
			var v = m.v, values;
			if (m.type === "leave") values = { leave_type: v.leave_type, from: v.from, to: v.to, from_half: v.from_half, to_half: v.to_half, reason: v.reason };
			else if (m.type === "ot") values = { work_date: v.work_date, hours: String(v.hours).replace(",", "."), is_night: !!v.is_night, reason: v.reason };
			else values = { from: v.from, to: v.to, destination: v.destination, purpose: v.purpose, advance_amount: String(v.advance_amount || "").replace(/[.,\s]/g, "") };
			m.busy = true;
			render();
			post("saveRequest", { type: m.type, id: m.id, values: values }).then(function (d) {
				S.notice = d.submitted ? { kind: "ok", text: fmt(T.sent, d.request.number || "") } : { kind: "warn", text: fmt(T.savedDraft, d.request.number || "", msg(d.submitError)) };
				refreshAfterWrite();
			}, function (e) {
				m.busy = false;
				m.error = e.message;
				(e.fields || []).forEach(function (f) { m.errors[f.field] = EN ? f.en : f.vi; });
				if (e.fields && e.fields.length) m.error = null;
				render();
			});
		}
		function viewModal() {
			var m = S.modal;
			if (!m) return null;
			function closeModal() { S.modal = null; render(); }
			if (m.kind === "confirm") {
				return h("div", { class: "s4ss-modal" }, [h("div", { class: "s4ss-dialog", role: "alertdialog", "aria-modal": "true" }, [h("p", { text: m.text }), h("div", { class: "s4ss-foot" }, [h("button", { class: "s4ss-btn", type: "button", onclick: closeModal, text: T.keep }), h("button", { class: "s4ss-btn s4ss-btn-danger", type: "button", "data-focus": "1", onclick: m.yes, text: T.cancel })])])]);
			}
			var v = m.v;
			var n = 0;
			function field(key, label, control, full) {
				var id = "s4ss-f-" + key;
				control.id = id;
				if (m.errors[key]) { control.setAttribute("aria-invalid", "true"); control.setAttribute("aria-describedby", id + "-e"); }
				if (!n++ && !m.id) control.setAttribute("data-focus", "1");
				return h("div", { class: "s4ss-f" + (full ? " s4ss-f-full" : "") }, [h("label", { for: id, text: label }), control, m.errors[key] ? h("div", { class: "s4ss-err", id: id + "-e", text: m.errors[key] }) : null]);
			}
			function input(key, attrs) {
				var el = h("input", Object.assign({ class: "s4ss-in", type: "text", value: v[key] === null || v[key] === undefined ? "" : String(v[key]), oninput: function () { v[key] = el.value; } }, attrs || {}));
				return el;
			}
			function dateIn(key) { return input(key, { placeholder: T.dateHint, inputmode: "numeric", autocomplete: "off", maxlength: 10 }); }
			function area(key) {
				var el = h("textarea", { class: "s4ss-in", rows: 3, maxlength: 1000, oninput: function () { v[key] = el.value; } });
				el.value = v[key] || "";
				return el;
			}
			function pick(key, options) {
				var el = h("select", { class: "s4ss-in", onchange: function () { v[key] = el.value; if (key === "leave_type") render(); } }, options.map(function (o) { return h("option", { value: o[0], selected: String(v[key]) === String(o[0]), text: o[1] }); }));
				return el;
			}
			var fields = [];
			if (m.type === "leave") {
				var types = (S.req.data && S.req.data.leaveTypes) || [];
				var lt = types.filter(function (t) { return String(t.id) === String(v.leave_type); })[0];
				fields.push(field("leave_type", T.fLeaveType, pick("leave_type", [["", ""]].concat(types.map(function (t) { return [t.id, t.name + (t.available === null ? "" : " - " + fmt(T.balanceLeft, qty(t.available) === "-" ? "0" : qty(t.available)))]; }))), true));
				fields.push(field("from", T.fFrom, dateIn("from")));
				fields.push(field("to", T.fTo, dateIn("to")));
				if (!lt || lt.allowHalf) {
					fields.push(field("from_half", T.fFromHalf, pick("from_half", [["A", T.halfA], ["P", T.halfP]])));
					fields.push(field("to_half", T.fToHalf, pick("to_half", [["P", T.endP], ["A", T.endA]])));
				}
				fields.push(field("reason", T.fReason, area("reason"), true));
			} else if (m.type === "ot") {
				fields.push(field("work_date", T.fDate, dateIn("work_date")));
				fields.push(field("hours", T.fHours, input("hours", { inputmode: "decimal", maxlength: 5 })));
				var cb = h("input", { type: "checkbox", id: "s4ss-f-night", checked: !!v.is_night, onchange: function () { v.is_night = cb.checked; } });
				fields.push(h("div", { class: "s4ss-f s4ss-f-full" }, [h("div", { class: "s4ss-check" }, [cb, h("label", { for: "s4ss-f-night", style: "font-weight:400", text: T.fNight })])]));
				fields.push(field("reason", T.fReason, area("reason"), true));
			} else {
				fields.push(field("from", T.fFrom, dateIn("from")));
				fields.push(field("to", T.fTo, dateIn("to")));
				fields.push(field("destination", T.fDest, input("destination", { maxlength: 300 }), true));
				fields.push(field("purpose", T.fPurpose, area("purpose"), true));
				fields.push(field("advance_amount", T.fAdvance, input("advance_amount", { inputmode: "numeric", maxlength: 15 }), true));
			}
			var seg = m.id ? null : h("div", { class: "s4ss-seg", role: "group", "aria-label": T.fType }, ["leave", "ot", "trip"].map(function (t) {
				return h("button", { type: "button", "aria-pressed": m.type === t ? "true" : "false", onclick: function () { m.type = t; m.errors = {}; m.error = null; render(); }, text: TYPE_LABEL[t] });
			}));
			return h("div", { class: "s4ss-modal" }, [h("form", { class: "s4ss-dialog", role: "dialog", "aria-modal": "true", "aria-label": m.id ? T.editTitle : T.newTitle, novalidate: true, onsubmit: function (ev) { ev.preventDefault(); if (!m.busy) sendForm(); } }, [
				h("div", { class: "s4ss-row s4ss-row-end" }, [h("h2", { text: (m.id ? T.editTitle : T.newTitle) + (m.id ? " - " + TYPE_LABEL[m.type] : "") }), h("button", { class: "s4ss-x", type: "button", "aria-label": T.close, onclick: closeModal, text: "×" })]),
				seg,
				m.error ? strip("error", m.error) : null,
				h("div", { class: "s4ss-form" }, fields),
				h("div", { class: "s4ss-foot" }, [h("button", { class: "s4ss-btn", type: "button", onclick: closeModal, text: T.discard }), h("button", { class: "s4ss-btn s4ss-btn-primary", type: "submit", disabled: m.busy, text: m.busy ? T.sending : T.send })]),
			])]);
		}

		// ---- Thông tin của tôi
		function loadMe() {
			S.me.data = null; S.me.error = null;
			render();
			get("me").then(function (d) { S.me.data = d; render(); }, function (e) { S.me.error = e.message; render(); });
		}
		function kv(pairs) {
			var out = [];
			pairs.forEach(function (p) { if (p) out.push(h("dt", { text: p[0] }), h("dd", {}, [p[1] === "" || p[1] === null || p[1] === undefined ? "-" : p[1]])); });
			return h("dl", { class: "s4ss-kv" }, out);
		}
		function viewMe() {
			var M = S.me;
			if (M.error) return [failed(M.error, loadMe)];
			if (!M.data) return [loading()];
			var d = M.data, c = d.contract, p = d.profile;
			var left = null;
			if (c && c.expiry && c.state === "A" && c.daysLeft !== null) left = h("span", { class: "s4ss-badge " + (c.daysLeft <= 60 ? "s4ss-b-P" : ""), text: c.daysLeft < 0 ? T.expired : fmt(T.daysLeft, c.daysLeft) });
			var box = h("div", {});
			var find = search(function () { return box; });
			box.appendChild(d.dependents.length ? table([{ label: T.name }, { label: T.relationship }, { label: T.birthDate, cls: "s4ss-wide" }, { label: T.taxCode, cls: "s4ss-wide" }, { label: T.dedFrom }, { label: T.status }], d.dependents.map(function (x) {
				return h("tr", { "data-q": fold([x.name, x.relationship, day(x.birthDate), span(x.from, x.to)].join(" ")) }, [h("td", { text: x.name }), h("td", { text: x.relationship }), h("td", { class: "s4ss-wide", text: day(x.birthDate) }), h("td", { class: "s4ss-wide", text: x.taxCode || "-" }), h("td", { text: day(x.from) + (x.to ? " - " + day(x.to) : "") }), h("td", {}, [h("span", { class: "s4ss-badge " + (x.active ? "s4ss-b-A" : ""), text: x.active ? T.active : T.inactive })])]);
			})) : h("div", { class: "s4ss-empty", text: T.noDependents }));
			box.appendChild(find.empty);
			return [
				p ? null : noProfile(),
				h("div", { class: "s4ss-cols" }, [
					h("div", { class: "s4ss-card" }, [h("h2", { text: T.personal }), kv([[T.code, d.employee.code], [T.name, d.employee.name], [T.dept, d.employee.department], [T.jobTitle, d.employee.jobTitle], p ? [T.hireDate, day(p.hireDate)] : null, p ? [T.taxCode, p.taxCode] : null, p ? [T.personalId, p.personalId] : null, p ? [T.siNumber, p.siNumber] : null, p ? [T.bank, p.bankName] : null, p ? [T.bankAccount, p.bankAccount] : null]), p ? h("p", { class: "s4ss-sub", style: "margin-top:8px", text: T.masked }) : null]),
					h("div", { class: "s4ss-card" }, [h("div", { class: "s4ss-row s4ss-row-end", style: "margin-bottom:8px" }, [h("h2", { style: "margin:0", text: T.contract }), c ? h("span", { class: "s4ss-badge s4ss-b-" + (c.state === "A" ? "A" : c.state === "D" ? "H" : "R"), text: T["cs" + c.state] || c.state }) : null]),
						c ? kv([[T.cNumber, c.number], [T.cType, T["ct" + c.type] || c.type], [T.cTitle, c.title], [T.cFrom, day(c.effective)], [T.cTo, c.expiry ? h("span", {}, [day(c.expiry), " ", left]) : T.indefinite]]) : h("div", { class: "s4ss-empty", text: T.noContract })]),
				]),
				h("div", { class: "s4ss-card" }, [h("div", { class: "s4ss-row s4ss-row-end", style: "margin-bottom:6px" }, [h("h2", { style: "margin:0", text: T.dependents + " (" + d.dependents.length + ")" }), d.dependents.length ? find.input : null]), box]),
			];
		}

		// ---- khung trang
		var TABS = [["pay", T.tabPay, viewPay, function () { loadPay(S.pay.year); }], ["leave", T.tabLeave, viewLeave, function () { loadLeave(S.leave.year); }], ["req", T.tabReq, viewReq, loadReq], ["me", T.tabMe, viewMe, loadMe]];
		function go(tab) {
			S.tab = tab; S.notice = null;
			var t = TABS.filter(function (x) { return x[0] === tab; })[0];
			var have = tab === "pay" ? S.pay.data : tab === "leave" ? S.leave.data : tab === "req" ? S.req.data : S.me.data;
			if (have) render(); else t[3]();
		}
		function render() {
			var active = document.activeElement && document.activeElement.id;
			var kids = [];
			var head = h("div", { class: "s4ss-top" }, [
				h("div", { class: "s4ss-head" }, [h("h1", { text: T.title }), BOOT.employee ? h("span", { class: "s4ss-who", text: BOOT.employee.name + (BOOT.employee.code ? " - " + BOOT.employee.code : "") }) : null]),
				BOOT.blocked ? null : h("div", { class: "s4ss-tabs", role: "tablist" }, TABS.map(function (t) { return h("button", { class: "s4ss-tab", type: "button", role: "tab", "aria-selected": S.tab === t[0] ? "true" : "false", onclick: function () { go(t[0]); }, text: t[1] }); })),
			]);
			if (BOOT.blocked) kids = [strip("warn", msg(BOOT.blocked))];
			else {
				if (S.notice) kids.push(strip(S.notice.kind, S.notice.text, function () { S.notice = null; render(); }));
				kids = kids.concat(TABS.filter(function (t) { return t[0] === S.tab; })[0][2]());
			}
			var modal = BOOT.blocked ? null : viewModal();
			root.textContent = "";
			root.appendChild(head);
			root.appendChild(h("main", { class: "s4ss-page" }, kids));
			if (modal) {
				root.appendChild(modal);
				var f = (active && document.getElementById(active)) || modal.querySelector("[data-focus]");
				if (f) f.focus();
			}
		}
		document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && S.modal && !S.modal.busy) { S.modal = null; render(); } });
		if (BOOT.blocked) render(); else go("pay");
	}
	/* eslint-enable */

	const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
	/** JSON nhúng trong thẻ script: không để chuỗi dữ liệu đóng thẻ hoặc mở chú thích HTML. */
	const embed = (o) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

	function html(boot) {
		const b = boot || {};
		const lang = b.lang === "en" ? "en" : "vi";
		const data = { lang, text: TEXT[lang], url: String(b.url || ""), token: String(b.token || ""), employee: b.employee || null, hasProfile: !!b.hasProfile, today: b.today || "", blocked: b.blocked || null };
		return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(TEXT[lang].title)}</title><style>${CSS}</style></head>
<body><div id="s4ss"></div><script>(${client.toString()})(${embed(data)});</script></body></html>`;
	}

	return { TEXT, CSS, html, client };
});
