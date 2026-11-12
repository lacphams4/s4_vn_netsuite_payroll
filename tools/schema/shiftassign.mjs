// Mô hình dữ liệu của Chế độ ca (màn Xếp ca, docs/SHIFT_CREW_SPEC.md mục "Chế độ ca"). tools/schema.mjs nạp và gộp file này.
// Tiền tố trường dành riêng: `sas`.
//
// shift_assign: gán một mẫu xoay ca cho một phạm vi (nhân viên, tổ, phòng ban, nhóm lương, cả công ty con) trong khoảng hiệu
// lực. Lịch ca của nhân viên = ô phân ca đã lưu (roster, thường là ô sửa tay) đè lên lịch suy ra từ chế độ ca; không cần sinh
// trước từng ô cho từng người (core/ShiftAssign). Nhân viên không có chế độ ca nào và không có ô phân ca = không thuộc diện xếp ca.
// Ưu tiên khi nhiều dòng cùng áp cho một người trong một ngày: E nhân viên > T tổ > D phòng ban > G nhóm lương > S công ty con;
// cùng mức lấy dòng có ngày hiệu lực muộn nhất. Thôi dùng = Inactive (không xóa).
//
// Quyền: HR toàn quyền, kế toán xem. Sau khi sửa: node tools/gen_objects.mjs. Record mới cần deploy hai bước.

export default ({ PROFILE }) => ({
	lists: {
		sa_scope: ["Phạm vi chế độ ca", { E: "E - Nhân viên", T: "T - Tổ", D: "D - Phòng ban", G: "G - Nhóm lương", S: "S - Cả công ty con" }],
	},
	records: [
		{
			id: "shift_assign", prefix: "sas", name: "Chế độ ca", screen: "VP309000", perms: PROFILE, includeName: false,
			desc: "Shift scheme assignment: a shift pattern applied to an employee, team, department, pay group or the whole subsidiary for an effective date range. The effective roster is the stored roster cells over the days derived from these assignments.",
			fields: [
				["subsidiary", "Công ty con", "select:subsidiary", { req: true }],
				["scope", "Phạm vi", "select:list:sa_scope", { req: true }],
				["employee", "Nhân viên", "select:employee"],
				["team", "Tổ", "select:rec:team"],
				["department", "Phòng ban", "select:department"],
				["paygroup", "Nhóm lương", "select:rec:paygroup"],
				["pattern", "Mẫu xoay ca", "select:rec:shift_pattern", { req: true }],
				["anchor", "Ngày ứng với ngày 1 của chu kỳ", "date", { help: "Empty = the effective date. Shift crews offset each other by moving this date." }],
				["effective", "Hiệu lực từ", "date", { req: true }],
				["expiration", "Hiệu lực đến", "date", { help: "Empty = no end." }],
				["note", "Ghi chú", "text"],
			],
		},
	],
});
