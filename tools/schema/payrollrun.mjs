// Mô hình dữ liệu của phân hệ Chạy lương (giao diện bản 2, docs/UI_V2.md mục 6). tools/schema.mjs nạp và gộp file này.
// Tiền tố trường dành riêng: `prn`. Không dùng tiền tố của phân hệ khác hoặc của tools/schema.mjs.
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
// Cần hằng quyền dùng chung thì xuất hàm: export default ({ SETUP, PAYROLL, PROFILE, ROLE_HR, ROLE_ACCT, DOC_COMMON }) => ({ lists, records })
//   SETUP: HR toàn quyền, kế toán xem; PAYROLL: cả hai toàn quyền; PROFILE: HR toàn quyền, kế toán xem.
// Ví dụ:
//   export default ({ PAYROLL }) => ({
//     lists: { prn_status: ["Trạng thái", { O: "O - Mở", D: "D - Xong" }] },
//     records: [{ id: "prn_item", prefix: "prn", name: "Tên bản ghi", screen: "UI2", perms: PAYROLL, desc: "English description.",
//                 fields: [["batch", "Bảng lương", "select:rec:batch", { req: true }], ["status", "Trạng thái", "select:list:prn_status"]] }],
//   });
// Sau khi sửa: node tools/gen_objects.mjs. Record mới cần deploy hai bước (tools/deploy_two_pass.py) - người điều phối làm.

export const lists = {};

export const records = [];
