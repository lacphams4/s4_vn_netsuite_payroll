// Mô hình dữ liệu của phần Nạp dữ liệu máy chấm công cấu hình được (docs/PUNCH_IMPORT.md mục 1). tools/schema.mjs nạp và gộp file này.
// Tiền tố trường dành riêng: `psr` (hồ sơ nguồn chấm công), `pmp` (bảng đối chiếu mã chấm công). Không dùng tiền tố của phân hệ khác.
//
// Lưu ý tên: list `punch_source` (nguồn của một lượt chấm: I tải file, M nhập tay, A API) đã có trong tools/schema.mjs; record
// `punch_source` ở đây là hồ sơ nguồn (máy / hệ thống chấm công). Hai đối tượng khác loại nên script id không trùng
// (customlist_s4vp_punch_source và customrecord_s4vp_punch_source); Schema.js tra riêng lists / records.
//
// punch_source: mỗi máy hoặc hệ thống chấm công một hồ sơ (tên = mã nguồn, ví dụ ZK-XUONG). Giá trị mặc định khi để trống:
//   layout E, delimiter A, date_format DMY, id_kind B (code xử lý, core/PunchImport).
// punch_map: mã người trên máy -> nhân viên. Khóa: nguồn + máy + mã + ngày hiệu lực. Tra: dòng cùng máy trước, rồi dòng máy trống;
//   hiệu lực tại ngày chấm. Thôi dùng = Inactive (không xóa).
//
// Quyền: HR tạo / sửa, không xóa (EDIT); kế toán xem (như lượt chấm); administrator toàn quyền theo mặc định.
// Sau khi sửa: node tools/gen_objects.mjs. Record mới cần deploy hai bước (tools/deploy_two_pass.py) - người điều phối làm.

export default ({ ROLE_HR, ROLE_ACCT }) => ({
	lists: {
		ps_layout: ["Kiểu dòng file chấm công", { E: "E - Mỗi dòng một lượt chấm", P: "P - Mỗi dòng giờ vào và giờ ra", Z: "Z - ZKTeco attlog" }],
		ps_delim: ["Dấu phân cách cột", { A: "A - Tự nhận", C: "C - Dấu phẩy", S: "S - Dấu chấm phẩy", T: "T - Tab" }],
		ps_datefmt: ["Định dạng ngày", { YMD: "YMD - Năm tháng ngày", DMY: "DMY - Ngày tháng năm", MDY: "MDY - Tháng ngày năm" }],
		ps_idkind: ["Cách nhận mã chấm công", { N: "N - Mã nhân viên NetSuite", M: "M - Theo bảng đối chiếu", B: "B - Bảng đối chiếu, rồi mã nhân viên" }],
	},
	records: [
		{
			id: "punch_source", prefix: "psr", name: "Hồ sơ nguồn chấm công", screen: "UI2", perms: { [ROLE_HR]: "EDIT", [ROLE_ACCT]: "VIEW" }, includeName: true,
			desc: "Attendance device / system import profile: column mapping, date format, line layout and how device IDs map to employees. Name = source code.",
			fields: [
				["subsidiary", "Công ty con", "select:subsidiary", { help: "Empty = every subsidiary." }],
				["description", "Diễn giải", "text"],
				["layout", "Kiểu dòng", "select:list:ps_layout", { help: "E = one punch per line; P = one line with in and out time of a day; Z = ZKTeco attlog (tab separated, no header: ID, date time, status columns ignored). Empty = E." }],
				["has_header", "Có dòng tiêu đề", "check", { def: "T", help: "The first line (after the skipped lines) holds the column names. Ignored for layout Z." }],
				["skip_lines", "Số dòng đầu bỏ qua", "int", { help: "Lines skipped before the header line (report titles)." }],
				["delimiter", "Dấu phân cách", "select:list:ps_delim", { help: "A = detect from the first line (tab, semicolon, comma). Empty = A." }],
				["col_emp", "Cột mã chấm công", "text", { help: "Header name (case and Vietnamese accents ignored) or column number from 1." }],
				["col_datetime", "Cột ngày giờ", "text", { help: "Layout E: one column holding date and time. Leave empty to use the date and time columns." }],
				["col_date", "Cột ngày", "text", { help: "Layout E (with the time column) and layout P." }],
				["col_time", "Cột giờ", "text", { help: "Layout E with a separate date column." }],
				["col_in", "Cột giờ vào", "text", { help: "Layout P." }],
				["col_out", "Cột giờ ra", "text", { help: "Layout P. An out time earlier than the in time belongs to the next day (night shift)." }],
				["col_device", "Cột thiết bị", "text", { help: "Optional. Empty = use the default device below." }],
				["date_format", "Định dạng ngày", "select:list:ps_datefmt", { help: "Order of day, month, year when the year is last. Excel serial numbers and AM/PM times are always accepted. Empty = DMY." }],
				["id_kind", "Cách nhận mã", "select:list:ps_idkind", { help: "N = NetSuite employee ID or internal id; M = mapping table only; B = mapping table first, then employee ID. Empty = B." }],
				["device_default", "Thiết bị mặc định", "text", { help: "Device written on the punches when the file has no device column." }],
				["minute_offset", "Lệch đồng hồ (phút)", "int", { help: "Minutes added to every punch when the device clock is off (negative allowed)." }],
			],
		},
		{
			id: "punch_map", prefix: "pmp", name: "Đối chiếu mã chấm công", screen: "UI2", perms: { [ROLE_HR]: "EDIT", [ROLE_ACCT]: "VIEW" }, includeName: false,
			desc: "Attendance device ID mapping: source + device + device ID + effective date -> employee. Rows for the same device win over rows with no device.",
			fields: [
				["source", "Hồ sơ nguồn", "select:rec:punch_source", { req: true }],
				["device", "Thiết bị", "text", { help: "Empty = every device of the source." }],
				["machine_id", "Mã trên máy chấm công", "text", { req: true }],
				["employee", "Nhân viên", "select:employee", { req: true }],
				["effective", "Hiệu lực từ", "date", { help: "Empty = from the beginning." }],
				["expiration", "Hiệu lực đến", "date", { help: "Empty = no end." }],
			],
		},
	],
});
