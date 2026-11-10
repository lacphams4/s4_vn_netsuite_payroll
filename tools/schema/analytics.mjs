// Mô hình dữ liệu của Phân tích chi phí lương (docs/UI_V2.md mục 13). tools/schema.mjs nạp và gộp file này.
// Tiền tố trường dành riêng: `lcf` (bảng số liệu chi phí lương). Không dùng tiền tố của phân hệ khác hoặc của tools/schema.mjs.
//
// Dạng dữ liệu giống hệt tools/schema.mjs (xem chú thích đầu tools/schema/checks.mjs).
//
// Record cost_fact: mỗi dòng = một bảng lương x tháng kế toán (YYYYMM theo ngày bút toán) x tài khoản chi phí x phòng ban
// x class x địa điểm x dự án x loại lao động (E / C) x thành phần chi phí. Tổng số tiền các dòng còn hiệu lực của một bảng
// lương = tổng Nợ chi phí của bút toán ghi sổ (thu nhập + BH doanh nghiệp + trích tháng 13). Dòng do script ghi khi ghi sổ
// (api/LaborAnalytics.js, core/LaborCostFacts.js); đảo bảng lương thì bỏ cờ còn hiệu lực, không xóa.
// Không có nhân viên trong record này: số người và chi phí theo nhân viên đọc từ batch_emp.
//
// Quyền (USEPERMISSIONLIST): RESTlet chạy bằng vai trò của người dùng và chỉ kế toán (hoặc administrator) ghi sổ, đảo, lập
// lại số liệu, nên kế toán EDIT (tạo, sửa, không xóa); HR chỉ xem. Không vai trò nào của gói có quyền xóa.
// Sau khi sửa: node tools/gen_objects.mjs. Record mới cần deploy hai bước (tools/deploy_two_pass.py) - người điều phối làm.

export default ({ ROLE_HR, ROLE_ACCT }) => ({
	lists: {
		lcf_component: ["Thành phần chi phí lương", {
			wages: "wages - Lương",
			overtime: "overtime - Làm thêm, làm đêm",
			allowance: "allowance - Phụ cấp",
			bonus: "bonus - Thưởng",
			piecework: "piecework - Lương khoán, sản lượng",
			other: "other - Thu nhập khác",
			employerIns: "employerIns - BH, KPCĐ doanh nghiệp đóng",
			accrued13: "accrued13 - Trích trước lương tháng 13",
			contractor: "contractor - Thù lao cộng tác viên",
		}],
	},
	records: [
		{
			id: "cost_fact", prefix: "lcf", name: "Số liệu chi phí lương", screen: "UI2", perms: { [ROLE_HR]: "VIEW", [ROLE_ACCT]: "EDIT" }, includeName: false,
			desc: "Labor cost fact (UI v2 labor cost analytics): one row per payroll batch, accounting month, expense account, department, class, location, project, employment type and cost component. Written by script when the batch is released; rows of a reversed batch are flagged as not active and never deleted.",
			fields: [
				["batch", "Bảng lương", "select:rec:batch", { req: true, display: "LOCKED" }],
				["subsidiary", "Công ty con", "select:subsidiary", { req: true, display: "LOCKED" }],
				["month", "Tháng kế toán (YYYYMM)", "text", { req: true, display: "LOCKED", help: "Accounting month YYYYMM, taken from the date of the payroll journal entry." }],
				["posting_date", "Ngày bút toán", "date", { display: "LOCKED" }],
				["account", "Tài khoản chi phí", "select:account", { display: "LOCKED" }],
				["department", "Phòng ban", "select:department", { display: "LOCKED" }],
				["class", "Class", "select:class", { display: "LOCKED" }],
				["location", "Địa điểm", "select:location", { display: "LOCKED" }],
				["project", "Dự án", "select:project", { display: "LOCKED" }],
				["employment_type", "Loại lao động", "select:list:employment_type", { display: "LOCKED" }],
				["component", "Thành phần chi phí", "select:list:lcf_component", { req: true, display: "LOCKED" }],
				["amount", "Số tiền", "currency", { display: "LOCKED" }],
				["hours", "Số giờ", "float", { display: "LOCKED", help: "Hours of the allocation lines behind this row, when the allocation source carries hours." }],
				["active", "Còn hiệu lực", "check", { def: "T", display: "LOCKED", help: "Cleared when the payroll batch is reversed or the row is replaced by a rebuild." }],
			],
		},
	],
});
