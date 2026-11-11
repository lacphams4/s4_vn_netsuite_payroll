// Mô hình dữ liệu của phân hệ Hoa hồng nhân viên kinh doanh (docs/COMMISSION.md mục 2). tools/schema.mjs nạp và gộp file này.
// Tiền tố trường dành riêng: `cpl` kế hoạch, `ccr` thành phần, `ctr` bậc thang, `cas` phân công, `cqt` chỉ tiêu theo tháng,
// `crn` bảng tính, `crs` kết quả, `cad` điều chỉnh, `cxt` doanh số ngoài (mục 4.1) (`osr` để dành cho nguồn sản lượng từ giao dịch, mục 9, không khai ở đây).
//
// Dạng dữ liệu giống hệt tools/schema.mjs (xem đầu file tools/schema/accounts.mjs).
//
// Quy ước số:
// - Trường tỷ lệ (rate, min_attainment, override_pct, attainment) khai kiểu float, giá trị là số phần trăm (2 = 2%), theo
//   cùng cách các trường "Tỷ lệ (%)" khác của gói (không dùng kiểu PERCENT của NetSuite để SuiteQL trả đúng số đã nhập).
// - Cơ sở (base, window_base, total_base) là float vì cơ sở Q là số lượng; tiền là currency, làm tròn đồng ở lõi.
// - Danh sách id lọc (f_items...) là chuỗi id nội bộ cách nhau dấu phẩy, trống = không lọc.
// - comm_rule dùng trường name chuẩn (includeName) làm tên thành phần.
//
// Quyền: kế toán EDIT mọi record (tạo, sửa, không xóa; thôi dùng = Inactive), HR VIEW; ESS không cần (schema.mjs tự thêm VIEW).
// Sau khi sửa: node tools/gen_objects.mjs. Record mới cần deploy hai bước (tools/deploy_two_pass.py) - người điều phối làm.

export default ({ ROLE_HR, ROLE_ACCT }) => {
	const perms = { [ROLE_HR]: "VIEW", [ROLE_ACCT]: "EDIT" };
	return {
		lists: {
			cm_basis: ["Cơ sở tính hoa hồng", { R: "R - Doanh thu thuần chưa thuế", G: "G - Lãi gộp ước tính", Q: "Q - Số lượng bán" }],
			cm_trigger: ["Thời điểm ghi nhận hoa hồng", { I: "I - Khi xuất hóa đơn", P: "P - Khi thu tiền" }],
			cm_credit: ["Nguồn ghi nhận doanh số", { R: "R - Nhân viên kinh doanh trên chứng từ", T: "T - Đội bán (% đóng góp)", F: "F - Trường tùy chỉnh trên chứng từ" }],
			cm_window: ["Cửa sổ tính hoa hồng", { M: "M - Theo tháng", Q: "Q - Lũy kế quý", Y: "Y - Lũy kế năm" }],
			cm_draw: ["Ứng trước hoa hồng (draw)", { N: "N - Không", R: "R - Ứng trước có thu hồi", G: "G - Bảo đảm tối thiểu" }],
			cm_override: ["Cơ sở hoa hồng quản lý", { B: "B - Doanh số của cấp dưới", C: "C - Hoa hồng của cấp dưới" }],
			cm_method: ["Phương pháp tính hoa hồng", {
				P: "P - Tỷ lệ cố định", G: "G - Thang lũy tiến theo giá trị", S: "S - Thang bậc theo giá trị", A: "A - Theo % đạt chỉ tiêu",
				U: "U - Đơn giá trên số lượng", B: "B - Thưởng mốc % đạt",
			}],
			cm_run_status: ["Trạng thái bảng tính hoa hồng", { D: "D - Nháp đã tính", A: "A - Đã duyệt", P: "P - Đã vào bảng lương" }],
			cm_source: ["Nguồn doanh số hoa hồng", { N: "N - Giao dịch NetSuite", X: "X - Dữ liệu ngoài đã nạp", B: "B - Cả hai" }],
			cm_txn_type: ["Loại chứng từ doanh số ngoài", { I: "I - Hóa đơn", S: "S - Bán thu tiền ngay", C: "C - Trả hàng" }],
		},
		records: [
			{
				id: "comm_plan", prefix: "cpl", name: "Kế hoạch hoa hồng", screen: "UI2", perms, includeName: true,
				desc: "Sales commission plan (SAP Commissions style pipeline: credit, measurement, incentive, payment). The record name is the plan code.",
				fields: [
					["subsidiary", "Công ty con", "select:subsidiary", { help: "Empty = every subsidiary." }],
					["description", "Diễn giải", "text"],
					["effective", "Hiệu lực từ", "date"],
					["expiration", "Hiệu lực đến", "date"],
					["basis", "Cơ sở tính", "select:list:cm_basis", { req: true, help: "R net revenue before tax, G estimated gross profit (revenue - line cost estimate), Q quantity sold." }],
					["trigger", "Thời điểm ghi nhận", "select:list:cm_trigger", { req: true, help: "I when invoiced (document date in the period), P when collected (share collected in the period). Cash sales always use the document date." }],
					["credit_source", "Nguồn ghi nhận doanh số", "select:list:cm_credit", { req: true, help: "R sales rep on the transaction, T sales team by contribution (falls back to the sales rep), F custom employee body field." }],
					["credit_field", "Trường ghi nhận (nguồn F)", "text", { help: "Body field id holding the credited employee when the credit source is F." }],
					["window", "Cửa sổ tính", "select:list:cm_window", { req: true, help: "M monthly, Q quarter to date, Y year to date. Q / Y pay the window commission minus what earlier periods of the window already paid (true-up)." }],
					["include_returns", "Trừ credit memo", "check", { def: "T", help: "Credit memos of the period reduce the base of the credited employee." }],
					["clawback_days", "Truy thu sau (ngày)", "int", { help: "Trigger I: the unpaid part of an invoice still open N days after its date is deducted in the period it falls due. 0 or empty = off." }],
					["exclude_item_types", "Loại dòng bỏ qua", "text", { help: "Comma separated item types to skip. Default TaxItem,ShipItem,Subtotal,Description,EndGroup,Group. Discount lines count because they reduce net revenue." }],
					["earning_type", "Loại thu nhập lương", "text", { req: true, help: "Payroll earning type code that receives the payable commission." }],
					["min_attainment", "Ngưỡng % đạt tối thiểu (%)", "float", { help: "Percent, 80 = 80%. Below this attainment the sales based components pay 0 (milestone bonuses keep their own thresholds)." }],
					["cap_amount", "Trần hoa hồng mỗi kỳ", "currency", { help: "After adjustments, before the draw. Empty = no cap." }],
					["draw_type", "Ứng trước (draw)", "select:list:cm_draw", { help: "N none, R recoverable draw (paid up to the draw amount, recovered later), G guaranteed minimum (not recovered)." }],
					["draw_amount", "Số tiền draw mỗi kỳ", "currency"],
					["override_pct", "Tỷ lệ hoa hồng quản lý (%)", "float", { help: "Percent paid to the manager declared on the assignments of direct reports." }],
					["override_basis", "Cơ sở hoa hồng quản lý", "select:list:cm_override", { help: "B period base of the direct report, C commission earned by the direct report." }],
					["source", "Nguồn doanh số", "select:list:cm_source", { help: "N NetSuite transactions (default when empty), X loaded external sales (comm_txn), B both." }],
				],
			},
			{
				id: "comm_txn", prefix: "cxt", name: "Doanh số ngoài cho hoa hồng", screen: "UI2", perms, includeName: false,
				desc: "External sales lines (DMS, POS, marketplace, legacy software) for commission plans with source X or B; same shape as the normalized line. Unique key: subsidiary + source system + document number + line number; reloading the same key updates the row. Rows used by an approved run are locked (use inactive to drop).",
				fields: [
					["subsidiary", "Công ty con", "select:subsidiary"],
					["source_system", "Hệ thống nguồn", "text", { help: "Name of the source system, e.g. DMS." }],
					["doc_no", "Số chứng từ", "text", { req: true }],
					["line_no", "Dòng", "int"],
					["tran_type", "Loại chứng từ", "select:list:cm_txn_type", { help: "I invoice, S cash sale, C return (amounts negative)." }],
					["date", "Ngày chứng từ", "date", { req: true }],
					["customer_code", "Mã khách hàng", "text"],
					["customer_name", "Tên khách hàng", "text"],
					["customer_category", "Nhóm khách hàng", "text"],
					["first_sale_date", "Ngày mua đầu tiên của khách", "date", { help: "Used by the new customer filter." }],
					["item_code", "Mã mặt hàng", "text"],
					["item_type", "Loại dòng", "text"],
					["class", "Class", "select:class"],
					["department", "Phòng ban", "select:department"],
					["location", "Địa điểm", "select:location"],
					["project", "Dự án", "select:project"],
					["revenue", "Doanh thu thuần", "currency"],
					["cost", "Giá vốn ước tính", "currency"],
					["qty", "Số lượng", "float"],
					["employee", "Nhân viên kinh doanh", "select:employee", { req: true }],
					["team", "Đội bán (JSON)", "textarea", { help: "Optional JSON [{employee, pct}], pct in percent (100 = 100%)." }],
					["collected_date", "Ngày thu tiền", "date", { help: "For plans with trigger P." }],
					["collected_amount", "Số đã thu", "currency", { help: "For plans with trigger P." }],
					["import_batch", "Lô nạp", "text"],
					["note", "Ghi chú", "textarea"],
				],
			},
			{
				id: "comm_rule", prefix: "ccr", name: "Thành phần hoa hồng", screen: "UI2", perms, includeName: true, child: true,
				desc: "Commission plan component: filters on the credited lines and the incentive method. The record name is the component name. Components run independently and may overlap.",
				fields: [
					["plan", "Kế hoạch", "select:rec:comm_plan", { req: true }],
					["sequence", "Thứ tự", "int"],
					["f_items", "Lọc mặt hàng (id)", "text", { help: "Comma separated item internal ids. Empty = no filter." }],
					["f_classes", "Lọc class (id)", "text", { help: "Comma separated class internal ids. Empty = no filter." }],
					["f_departments", "Lọc phòng ban (id)", "text", { help: "Comma separated department internal ids. Empty = no filter." }],
					["f_locations", "Lọc địa điểm (id)", "text", { help: "Comma separated location internal ids. Empty = no filter." }],
					["f_cust_categories", "Lọc nhóm khách hàng (id)", "text", { help: "Comma separated customer category internal ids. Empty = no filter." }],
					["f_new_customer", "Chỉ khách mới", "check", { help: "Only customers whose first sale is within the new customer days counted to the document date." }],
					["new_days", "Số ngày khách mới", "int", { help: "Default 90." }],
					["method", "Phương pháp", "select:list:cm_method", { req: true, help: "P flat rate, G graduated tiers by value, S step tiers by value, A rate by attainment tier, U amount per unit, B milestone bonus by attainment." }],
					["rate", "Tỷ lệ (%)", "float", { help: "Percent, 2 = 2%. Used by method P." }],
					["unit_amount", "Đơn giá trên số lượng", "currency", { help: "Used by method U." }],
				],
			},
			{
				id: "comm_tier", prefix: "ctr", name: "Bậc thang hoa hồng", screen: "UI2", perms, includeName: false, child: true,
				desc: "Tier of a commission component: from value is an amount for methods G / S and an attainment percent for methods A / B.",
				fields: [
					["rule", "Thành phần", "select:rec:comm_rule", { req: true }],
					["from_value", "Từ giá trị", "float", { help: "Amount (G, S) or attainment percent (A, B) where the tier starts; the tier applies from this value inclusive." }],
					["rate", "Tỷ lệ (%)", "float", { help: "Percent, 2 = 2%." }],
					["amount", "Số tiền thưởng", "currency", { help: "Milestone bonus amount (method B)." }],
				],
			},
			{
				id: "comm_assign", prefix: "cas", name: "Phân công kế hoạch hoa hồng", screen: "UI2", perms, includeName: false,
				desc: "Assignment of an employee to a commission plan with a monthly quota and the manager who earns the override. One employee may hold several plans.",
				fields: [
					["plan", "Kế hoạch", "select:rec:comm_plan", { req: true }],
					["employee", "Nhân viên", "select:employee", { req: true }],
					["effective", "Hiệu lực từ", "date"],
					["expiration", "Hiệu lực đến", "date"],
					["quota", "Chỉ tiêu mỗi tháng", "currency"],
					["manager", "Quản lý nhận hoa hồng quản lý", "select:employee"],
				],
			},
			{
				id: "comm_quota", prefix: "cqt", name: "Chỉ tiêu hoa hồng theo tháng", screen: "UI2", perms, includeName: false,
				desc: "Monthly quota of an employee in a plan; overrides the assignment quota for that month. Quarter / year quotas are the sum of the months up to the period.",
				fields: [
					["plan", "Kế hoạch", "select:rec:comm_plan", { req: true }],
					["employee", "Nhân viên", "select:employee", { req: true }],
					["month", "Tháng (YYYYMM)", "int", { req: true }],
					["quota", "Chỉ tiêu", "currency"],
				],
			},
			{
				id: "comm_run", prefix: "crn", name: "Bảng tính hoa hồng", screen: "UI2", perms, includeName: true,
				desc: "Commission calculation run of a subsidiary and month (name HHyyyymm-<sub>). D draft calculated, A approved, P included in payroll. Void = inactive.",
				fields: [
					["subsidiary", "Công ty con", "select:subsidiary", { req: true }],
					["month", "Tháng (YYYYMM)", "int"],
					["date_from", "Từ ngày", "date"],
					["date_to", "Đến ngày", "date"],
					["status", "Trạng thái", "select:list:cm_run_status", { display: "LOCKED" }],
					["batch", "Bảng lương", "select:rec:batch", { display: "LOCKED" }],
					["total_base", "Tổng cơ sở", "float", { display: "LOCKED" }],
					["total_amount", "Tổng hoa hồng phải trả", "currency", { display: "LOCKED" }],
					["employees", "Số nhân viên", "int", { display: "LOCKED" }],
					["calc_at", "Thời điểm tính (UTC, ISO)", "text", { display: "LOCKED" }],
					["approved_by", "Người duyệt", "select:employee", { display: "LOCKED" }],
					["note", "Ghi chú", "textarea"],
					["warnings", "Cảnh báo cấp bảng tính (JSON)", "clob", { display: "LOCKED", help: "Run-level warnings of the last calculation: unassigned sales reps, documents without a sales rep, skipped adjustments." }],
				],
			},
			{
				id: "comm_result", prefix: "crs", name: "Kết quả hoa hồng", screen: "UI2", perms, includeName: false,
				desc: "Commission result per employee and plan of a run, with the step by step explanation, credited transactions and cost segment shares in detail (JSON).",
				fields: [
					["run", "Bảng tính", "select:rec:comm_run", { req: true, display: "LOCKED" }],
					["employee", "Nhân viên", "select:employee", { display: "LOCKED" }],
					["plan", "Kế hoạch", "select:rec:comm_plan", { display: "LOCKED" }],
					["earning_type", "Loại thu nhập", "text", { display: "LOCKED" }],
					["quota", "Chỉ tiêu cửa sổ", "currency", { display: "LOCKED" }],
					["base", "Cơ sở trong kỳ", "float", { display: "LOCKED" }],
					["window_base", "Cơ sở lũy kế cửa sổ", "float", { display: "LOCKED" }],
					["attainment", "% đạt", "float", { display: "LOCKED" }],
					["gross", "Hoa hồng lũy kế cửa sổ", "currency", { display: "LOCKED" }],
					["prior_paid", "Đã trả các kỳ trước của cửa sổ", "currency", { display: "LOCKED" }],
					["earned", "Hoa hồng kỳ này", "currency", { display: "LOCKED" }],
					["override_amount", "Hoa hồng quản lý", "currency", { display: "LOCKED" }],
					["adjustments", "Điều chỉnh", "currency", { display: "LOCKED" }],
					["capped", "Bị cắt bởi trần", "currency", { display: "LOCKED" }],
					["draw_paid", "Draw trả bù", "currency", { display: "LOCKED" }],
					["draw_recovered", "Draw thu hồi", "currency", { display: "LOCKED" }],
					["draw_balance", "Số dư ứng trước sau kỳ", "currency", { display: "LOCKED" }],
					["payable", "Phải trả vào bảng lương", "currency", { display: "LOCKED" }],
					["detail", "Chi tiết (JSON)", "clob", { display: "LOCKED" }],
				],
			},
			{
				id: "comm_adjust", prefix: "cad", name: "Điều chỉnh hoa hồng", screen: "UI2", perms, includeName: false,
				desc: "Manual commission adjustment of an employee for a month (negative allowed); included in the run of the same month.",
				fields: [
					["employee", "Nhân viên", "select:employee", { req: true }],
					["plan", "Kế hoạch", "select:rec:comm_plan"],
					["month", "Tháng (YYYYMM)", "int", { req: true }],
					["amount", "Số tiền", "currency", { req: true }],
					["reason", "Lý do", "textarea", { req: true }],
				],
			},
		],
	};
};
