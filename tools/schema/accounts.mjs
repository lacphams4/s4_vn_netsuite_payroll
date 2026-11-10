// Mô hình dữ liệu của phần Tài khoản chi phí lương theo đích (VP102080, docs/UI_V2.md mục 6). tools/schema.mjs nạp và gộp file này.
// Tiền tố trường dành riêng: `pca`. Không dùng tiền tố của phân hệ khác hoặc của tools/schema.mjs.
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
// Record cost_account: mỗi bản ghi gán một tài khoản chi phí cho một đích phân bổ (dự án, class / work center hoặc phòng ban),
// có thể riêng cho một công ty con, một loại lao động và từ một ngày hiệu lực. Quy tắc chọn bản ghi: core/CostAccountRules.js;
// thứ tự ưu tiên khi ghi sổ: class -> dự án -> phòng ban -> tài khoản hồ sơ nhân viên -> mặc định
// (core/CostAllocationBuilder.resolveAccount). Số hiệu tài khoản do kế toán của khách khai, gói không cài sẵn giá trị nào.
//
// Quyền (USEPERMISSIONLIST): HR xem, kế toán toàn quyền (thiết lập hạch toán thuộc kế toán).
// Sau khi sửa: node tools/gen_objects.mjs. Record mới cần deploy hai bước (tools/deploy_two_pass.py) - người điều phối làm.

export default ({ ROLE_HR, ROLE_ACCT }) => ({
	lists: {
		pca_target: ["Loại đích tài khoản chi phí lương", { P: "P - Dự án", W: "W - Class (work center)", D: "D - Phòng ban" }],
	},
	records: [
		{
			id: "cost_account", prefix: "pca", name: "Tài khoản chi phí lương theo đích", screen: "VP102080", perms: { [ROLE_HR]: "VIEW", [ROLE_ACCT]: "FULL" }, includeName: false,
			desc: "Payroll expense account by allocation target (project, class / work center or department), optionally per subsidiary, labor type and effective date. Priority when posting: class, project, department, employee profile account, default account.",
			fields: [
				["subsidiary", "Công ty con", "select:subsidiary", { help: "Empty = applies to every subsidiary. A row with a subsidiary overrides a shared row for the same target." }],
				["target_type", "Loại đích", "select:list:pca_target", { req: true, help: "P = project, W = class (work center), D = department. Fill the matching target field below." }],
				["project", "Dự án", "select:project", { help: "Required when the target type is P." }],
				["work_center", "Class (work center)", "select:class", { help: "Required when the target type is W." }],
				["department", "Phòng ban", "select:department", { help: "Required when the target type is D." }],
				["labor_type", "Loại lao động", "select:list:employment_type", { help: "Empty = both employees and contractors. A row with a labor type is used before a row without one." }],
				["account", "Tài khoản chi phí", "select:account", { req: true }],
				["effective", "Hiệu lực từ ngày", "date", { help: "Empty = always effective. The latest row effective on or before the pay period end date is used." }],
				["note", "Ghi chú", "textarea"],
			],
		},
	],
});
