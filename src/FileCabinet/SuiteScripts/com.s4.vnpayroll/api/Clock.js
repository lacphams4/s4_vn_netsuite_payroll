/**
 * Ngày làm việc hiện tại (business date) theo múi giờ của người dùng, không theo giờ máy chủ NetSuite (Pacific).
 * Dates.iso(new Date()) trên máy chủ cho ngày hôm trước trong khoảng 00:00 - 14:00 giờ Việt Nam: ngày JE đảo, bill
 * cơ quan thu, ngày duyệt có thể rơi vào kỳ kế toán trước. Mọi "hôm nay" của lớp api lấy từ đây.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/format", "N/runtime", "../core/Dates"], (format, runtime, Dates) => {
	const FALLBACK_TZ = "Asia/Bangkok"; // GMT+7, cùng giờ Việt Nam

	function timezone() {
		try {
			return runtime.getCurrentUser().getPreference({ name: "TIMEZONE" }) || FALLBACK_TZ;
		} catch (e) {
			return FALLBACK_TZ;
		}
	}

	/** Hôm nay 'YYYY-MM-DD' theo múi giờ người dùng. */
	function today() {
		try {
			// DATETIMETZ: chuỗi theo định dạng ngày của người dùng, giờ đã quy đổi sang múi giờ chỉ định;
			// lấy phần ngày (trước dấu cách) rồi parse kiểu DATE (Date nửa đêm giờ máy chủ, đọc bằng getter địa phương)
			const s = format.format({ value: new Date(), type: format.Type.DATETIMETZ, timezone: timezone() });
			const d = format.parse({ value: String(s).trim().split(/\s+/)[0], type: format.Type.DATE });
			return Dates.iso(d);
		} catch (e) {
			// Dự phòng: cộng 7 giờ vào UTC
			const t = new Date(Date.now() + 7 * 3600000);
			return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
		}
	}

	return { today, timezone };
});
