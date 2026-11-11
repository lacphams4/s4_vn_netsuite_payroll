// Mô hình dữ liệu của phân hệ Kiểm tra và nhật ký (giao diện bản 2, docs/UI_V2.md mục 6). tools/schema.mjs nạp và gộp file này.
// Tiền tố trường dành riêng: `bck` (kết quả xử lý cảnh báo), `blg` (nhật ký). Không dùng tiền tố của phân hệ khác hoặc của tools/schema.mjs.
//
// Dạng dữ liệu giống hệt tools/schema.mjs:
//   lists:   { <id>: ["Nhãn list", { <MÃ>: "Nhãn giá trị", ... }] }            -> customlist_s4vp_<id>, giá trị val_s4vp_<id>_<mã>
//   records: [{ id, prefix, name, screen, perms, desc, fields: [[id, nhãn, kiểu, tùy chọn], ...],
//               includeName?, numbering?, child? }]                             -> customrecord_s4vp_<id>, custrecord_s4vp_<prefix>_<field>
//   kiểu: text, textarea, clob, int, float, currency, percent, date, check, select:<đích>, multi:<đích>
//   đích: employee, subsidiary, account, vendor, department, class, location, transaction, project, list:<id>, rec:<id>
//   tùy chọn: { req: true, parent: true, show: false, help: "...", def: "T" | "F", display: "LOCKED" | "HIDDEN" }
//   Giới hạn độ dài: scriptid record 38 ký tự, trường 40 ký tự (gen_objects.mjs báo lỗi khi vượt).
//
// Cảnh báo của bảng lương KHÔNG lưu: api/Checks.js tính lại từ dữ liệu bảng lương mỗi lần đọc (core/PayrollChecks.js).
// Record check_result chỉ giữ kết quả xử lý của người dùng cho từng cảnh báo (khóa = bảng lương + quy tắc + nhân viên).
// Record audit_log là nhật ký thao tác: chỉ thêm, không sửa, không xóa; không chứa số tiền lương hay số định danh.
//
// Quyền (USEPERMISSIONLIST, cùng cách khai như tools/schema.mjs): hai vai trò lương đều thao tác trên bảng lương nên đều
// được ghi. Kết quả xử lý: EDIT (tạo, sửa, không xóa). Nhật ký: CREATE (tạo và xem, không sửa, không xóa).
// Sau khi sửa: node tools/gen_objects.mjs. Record mới cần deploy hai bước (tools/deploy_two_pass.py) - người điều phối làm.

export default ({ ROLE_HR, ROLE_ACCT }) => ({
	lists: {
		bck_status: ["Trạng thái xử lý cảnh báo", { O: "O - Chưa xử lý", A: "A - Đã chấp nhận", R: "R - Đã xử lý" }],
	},
	records: [
		{
			id: "check_result", prefix: "bck", name: "Kết quả xử lý cảnh báo bảng lương", screen: "UI2", perms: { [ROLE_HR]: "EDIT", [ROLE_ACCT]: "EDIT" }, includeName: false,
			desc: "Handling result of a payroll check (UI v2): one row per batch, rule and employee. The checks themselves are recomputed on read and are not stored.",
			fields: [
				["batch", "Bảng lương", "select:rec:batch", { req: true }],
				["rule", "Quy tắc", "text", { req: true, help: "Rule code of core/PayrollChecks, for example NET_CHANGE." }],
				["employee", "Nhân viên", "select:employee", { help: "Empty for batch-level checks." }],
				["status", "Trạng thái", "select:list:bck_status"],
				["assignee", "Người phụ trách", "select:employee"],
				["note", "Ghi chú", "textarea"],
				["updated_by", "Người cập nhật", "select:employee", { display: "LOCKED" }],
				["updated_date", "Ngày cập nhật", "date", { display: "LOCKED" }],
				["key", "Khóa (quy tắc:nhân viên)", "text", { display: "HIDDEN", show: false }],
				["stamp", "Dấu số liệu khi đóng", "text", { display: "HIDDEN", show: false, help: "Short hash of the figures behind the check when it was closed; the check reopens when the figures change. No amounts are stored." }],
				["history", "Lịch sử xử lý (JSON)", "clob", { display: "HIDDEN" }],
			],
		},
		{
			id: "audit_log", prefix: "blg", name: "Nhật ký thao tác lương", screen: "UI2", perms: { [ROLE_HR]: "CREATE", [ROLE_ACCT]: "CREATE" }, includeName: false,
			desc: "Activity log of payroll batches and attendance periods (UI v2): who did what and when. Append only; holds no pay amounts and no personal identifiers.",
			fields: [
				["at", "Thời điểm (UTC, ISO)", "text", { req: true, display: "LOCKED", help: "UTC timestamp in ISO 8601, for example 2027-03-30T02:42:11Z." }],
				["date", "Ngày", "date", { display: "LOCKED" }],
				["user", "Người dùng", "select:employee", { display: "LOCKED" }],
				["user_name", "Tên người dùng", "text", { display: "LOCKED" }],
				["action", "Thao tác", "text", { req: true, display: "LOCKED" }],
				["batch", "Bảng lương", "select:rec:batch", { display: "LOCKED" }],
				["period", "Kỳ lương", "select:rec:period", { display: "LOCKED" }],
				["employee", "Nhân viên", "select:employee", { display: "LOCKED", help: "Employee the action is about (HR actions: contract, decision, dependent, profile, allocation, work permit, advance)." }],
				["line", "Dòng", "text", { display: "LOCKED", help: "Line or object reference of the action (line id, check key)." }],
				["text_vi", "Diễn giải", "text", { display: "LOCKED" }],
				["text_en", "Diễn giải (tiếng Anh)", "text", { display: "LOCKED" }],
			],
		},
	],
});
