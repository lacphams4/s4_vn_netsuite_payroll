// Mô hình dữ liệu của phân hệ Nhân sự (giao diện bản 2, docs/UI_V2.md mục 6 và 14). tools/schema.mjs nạp và gộp file này.
// Tiền tố trường dành riêng: `hrc` (hợp đồng lao động và phụ lục), `hrd` (quyết định nhân sự).
//
// Hợp đồng lao động (contract): một dòng cho mỗi hợp đồng; PHỤ LỤC là một dòng cùng record có trường `parent` trỏ về
// hợp đồng gốc (tự tham chiếu). Trạng thái "hết hạn" (X) chỉ để ghi nhận khi cần; giao diện và máy chủ tự coi hợp đồng
// hiệu lực (A) đã qua ngày kết thúc là hết hạn nên không cần tác vụ nền cập nhật. Mức lương trên hợp đồng là số ghi
// trên giấy, KHÔNG phải nguồn tính lương: lương tính theo lịch sử lương (compensation), thay đổi qua quyết định.
//
// Quyết định nhân sự (decision): ghi thay đổi phòng ban / chức danh / lương (cũ -> mới) theo ngày hiệu lực. "Áp dụng"
// (api/HrCore.js) mới cập nhật hồ sơ lương và lịch sử lương qua Profiles.save; sau khi áp dụng không sửa được nữa.
//
// File đính kèm: gen_objects.mjs chưa có kiểu trường tài liệu; cả hai record bật allowattachments (tab Files của bản ghi
// NetSuite) nên bản scan hợp đồng / quyết định đính kèm ở đó.
//
// Quyền: HR tạo và sửa, KHÔNG xóa (EDIT); kế toán chỉ xem (VIEW). Không lưu giới hạn pháp lý nào ở đây.
// Sau khi sửa: node tools/gen_objects.mjs. Record mới cần deploy hai bước (tools/deploy_two_pass.py) - người điều phối làm.

export default ({ ROLE_HR, ROLE_ACCT }) => ({
	lists: {
		hrc_type: ["Loại hợp đồng lao động", { P: "P - Thử việc", F: "F - Xác định thời hạn", U: "U - Không xác định thời hạn", S: "S - Thời vụ / khoán việc", C: "C - Cộng tác viên / dịch vụ" }],
		hrc_status: ["Trạng thái hợp đồng lao động", { D: "D - Nháp", A: "A - Hiệu lực", X: "X - Hết hạn", T: "T - Chấm dứt" }],
		hrd_type: ["Loại quyết định nhân sự", { H: "H - Tiếp nhận", T: "T - Điều chuyển", P: "P - Bổ nhiệm", S: "S - Điều chỉnh lương", R: "R - Khen thưởng", D: "D - Kỷ luật", X: "X - Chấm dứt" }],
		hrd_status: ["Trạng thái quyết định nhân sự", { D: "D - Nháp", A: "A - Đã áp dụng" }],
	},
	records: [
		{
			id: "contract", prefix: "hrc", name: "Hợp đồng lao động", screen: "UI2", perms: { [ROLE_HR]: "EDIT", [ROLE_ACCT]: "VIEW" }, includeName: false,
			desc: "Labor contract or contract appendix of an employee (UI v2). An appendix is a row whose parent points to the main contract. Salary figures are the amounts written on the contract, not the payroll source.",
			fields: [
				["employee", "Nhân viên", "select:employee", { req: true }],
				["profile", "Hồ sơ lương", "select:rec:employee"],
				["number", "Số hợp đồng / phụ lục", "text"],
				["type", "Loại hợp đồng", "select:list:hrc_type", { help: "Empty on an appendix (it follows the main contract)." }],
				["parent", "Phụ lục của hợp đồng", "select:rec:contract", { help: "Main contract of this appendix; empty for a main contract." }],
				["sign_date", "Ngày ký", "date"],
				["effective", "Hiệu lực từ", "date", { req: true }],
				["expiry", "Hiệu lực đến", "date", { help: "Empty for an indefinite-term contract and for appendices." }],
				["title", "Chức danh", "text"],
				["base_salary", "Mức lương ghi trên hợp đồng", "currency"],
				["insurance_wage", "Lương đóng bảo hiểm", "currency"],
				["status", "Trạng thái", "select:list:hrc_status", { display: "LOCKED" }],
				["terminated", "Ngày chấm dứt", "date", { display: "LOCKED" }],
				["term_reason", "Lý do chấm dứt", "text"],
				["note", "Ghi chú", "textarea"],
			],
		},
		{
			id: "decision", prefix: "hrd", name: "Quyết định nhân sự", screen: "UI2", perms: { [ROLE_HR]: "EDIT", [ROLE_ACCT]: "VIEW" }, includeName: false,
			desc: "Personnel decision of an employee (UI v2): onboarding, transfer, appointment, salary change, reward, discipline, termination. Applying it updates the payroll profile and compensation history by effective date.",
			fields: [
				["employee", "Nhân viên", "select:employee", { req: true }],
				["profile", "Hồ sơ lương", "select:rec:employee"],
				["number", "Số quyết định", "text"],
				["type", "Loại quyết định", "select:list:hrd_type", { req: true }],
				["sign_date", "Ngày ký", "date"],
				["effective", "Ngày hiệu lực", "date", { req: true }],
				["old_department", "Phòng ban cũ", "select:department", { display: "LOCKED" }],
				["new_department", "Phòng ban mới", "select:department"],
				["old_title", "Chức danh cũ", "text", { display: "LOCKED" }],
				["new_title", "Chức danh mới", "text"],
				["old_salary", "Lương hợp đồng cũ", "currency", { display: "LOCKED" }],
				["new_salary", "Lương hợp đồng mới", "currency"],
				["old_ins_wage", "Lương đóng bảo hiểm cũ", "currency", { display: "LOCKED" }],
				["new_ins_wage", "Lương đóng bảo hiểm mới", "currency"],
				["old_allowance", "Phụ cấp cố định cũ", "currency", { display: "LOCKED" }],
				["new_allowance", "Phụ cấp cố định mới", "currency"],
				["status", "Trạng thái", "select:list:hrd_status", { display: "LOCKED" }],
				["applied_date", "Ngày áp dụng", "date", { display: "LOCKED" }],
				["applied_by", "Người áp dụng", "select:employee", { display: "LOCKED" }],
				["note", "Ghi chú", "textarea"],
			],
		},
	],
});
