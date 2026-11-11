// Mô hình dữ liệu của phân hệ Duyệt nhiều cấp (giao diện bản 2, docs/UI_V2.md mục 6 và 14). tools/schema.mjs nạp và gộp file này.
// Tiền tố trường dành riêng: `apv` (cấu hình cấp duyệt), `apl` (nhật ký duyệt). Không dùng tiền tố của phân hệ khác.
//
// Dạng dữ liệu giống hệt tools/schema.mjs (xem đầu file tools/schema/checks.mjs).
//
// approval_step: MỖI DÒNG là một người duyệt của một cấp. Mặc định không có dòng nào = gói duyệt một cấp như cũ.
//   - Công ty con để trống = áp dụng cho mọi công ty. Công ty nào có dòng riêng thì CHỈ dùng dòng riêng của công ty đó.
//   - Cấp (level) là số nguyên từ 1; nhiều dòng cùng cấp = nhiều người duyệt thay thế nhau (một người duyệt là đủ).
//   - Người duyệt: một nhân viên cụ thể HOẶC một vai trò của gói (list apv_role). Dòng thiếu cả hai bị bỏ qua.
//   - Ngưỡng (min_net): chỉ cần dòng này khi tổng thực lĩnh của bảng lương từ ngưỡng trở lên; trống / 0 = luôn cần.
//   - Thôi dùng một dòng: đánh dấu Inactive (trường chuẩn của NetSuite), không xóa.
// approval_log: nhật ký duyệt, chỉ thêm. Mỗi dòng là một quyết định (A duyệt, R từ chối) của một cấp trong một lượt gửi duyệt.
//   Không chứa số tiền lương.
//
// Quyền: cấu hình - kế toán sửa (EDIT: tạo, sửa, không xóa), HR xem; administrator toàn quyền theo mặc định.
// Nhật ký - hai vai trò đều CREATE (tạo và xem, không sửa, không xóa) vì script ghi theo quyền của người thao tác.
// Sau khi sửa: node tools/gen_objects.mjs. Record mới cần deploy hai bước (tools/deploy_two_pass.py) - người điều phối làm.

export default ({ ROLE_HR, ROLE_ACCT }) => ({
	lists: {
		apv_role: ["Vai trò duyệt bảng lương", { H: "H - Nhân sự (S4VP Payroll HR)", A: "A - Kế toán (S4VP Payroll Accountant)", D: "D - Administrator" }],
		apv_decision: ["Quyết định duyệt", { A: "A - Duyệt", R: "R - Từ chối" }],
	},
	records: [
		{
			id: "approval_step", prefix: "apv", name: "Cấp duyệt bảng lương", screen: "UI2", perms: { [ROLE_HR]: "VIEW", [ROLE_ACCT]: "EDIT" }, includeName: true,
			desc: "Payroll approval levels (UI v2): one row per approver of a level. No rows = single-level approval. Rows of a subsidiary replace the rows that have no subsidiary.",
			fields: [
				["subsidiary", "Công ty con", "select:subsidiary", { help: "Empty = every subsidiary. A subsidiary that has its own rows uses only those rows." }],
				["level", "Cấp (thứ tự)", "int", { req: true, help: "Approval order, starting at 1. Rows sharing a level are alternative approvers." }],
				["approver", "Người duyệt (nhân viên)", "select:employee", { help: "A specific employee, or leave empty and choose a role." }],
				["role", "Người duyệt (vai trò)", "select:list:apv_role", { help: "Any user signed in with this role may approve the level." }],
				["min_net", "Ngưỡng tổng thực lĩnh", "currency", { help: "The row applies when the batch net pay total is at least this amount. Empty or 0 = always." }],
			],
		},
		{
			id: "approval_log", prefix: "apl", name: "Nhật ký duyệt bảng lương", screen: "UI2", perms: { [ROLE_HR]: "CREATE", [ROLE_ACCT]: "CREATE" }, includeName: false,
			desc: "Payroll approval log (UI v2): one row per decision of a level in a submission round. Append only; holds no pay amounts.",
			fields: [
				["batch", "Bảng lương", "select:rec:batch", { req: true, display: "LOCKED" }],
				["round", "Lượt gửi duyệt", "int", { display: "LOCKED", help: "Submission round of the batch, starting at 1. A rejection or reopening ends the round." }],
				["level", "Cấp", "int", { display: "LOCKED" }],
				["step_name", "Tên cấp", "text", { display: "LOCKED" }],
				["approver", "Người quyết định", "select:employee", { display: "LOCKED" }],
				["approver_name", "Tên người quyết định", "text", { display: "LOCKED" }],
				["decision", "Quyết định", "select:list:apv_decision", { display: "LOCKED" }],
				["at", "Thời điểm (UTC, ISO)", "text", { req: true, display: "LOCKED", help: "UTC timestamp in ISO 8601." }],
				["date", "Ngày", "date", { display: "LOCKED" }],
				["note", "Ghi chú", "textarea", { display: "LOCKED" }],
				["waived", "Miễn tách nhiệm vụ", "check", { display: "LOCKED", help: "Checked when the same person approved two consecutive levels because nobody else could approve this level." }],
			],
		},
	],
});
