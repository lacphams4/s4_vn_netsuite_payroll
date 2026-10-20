/**
 * Gói ngành (Load Industry Pack, đặc tả mục 4.4): Xây dựng, Thương mại, Sản xuất. Dữ liệu đúng như bản Acumatica.
 *
 * Nạp chỉ thêm bản ghi chưa có (so theo mã), theo thứ tự: loại thu nhập -> nhóm lương -> bảng đơn giá -> ca -> mẫu
 * xoay ca -> quy tắc. Quy tắc cần mức tiền do khách quyết nạp ở trạng thái không hoạt động, mức 0. Gói không có quy
 * tắc lương cơ bản: phải nạp VN Defaults trước (planLoad chặn khi bảng quy tắc còn rỗng).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
	const ET = (code, name, nameVi, category, taxTreatment = "T", exemptCapParam = "") => ({ code, name, nameVi, category, taxTreatment, exemptCapParam, isActive: true });
	const PG = (code, name, nameVi, frequency, attendanceSource = "E") => ({ code, name, nameVi, frequency, attendanceSource, isActive: true });
	const RT = (code, name, nameVi, type) => ({ code, name, nameVi, type, isActive: true, lines: [] });
	const R = (code, earningType, sequence, quantitySource, rateSource, isActive, description, descriptionVi, extra = {}) => Object.assign({
		code, earningType, sequence, quantitySource, rateSource, isActive, description, descriptionVi, fixedRate: 0, multiplier: 1, proration: "N",
		rateTable: "", tierMethod: "P", shiftKind: "", conditions: [], failAction: "N", reductionPercent: 0,
	}, extra);
	const SH = (code, start, end, breakMinutes, shiftKind) => ({ code, startTime: start, endTime: end, breakMinutes, shiftKind, lateGraceMinutes: 5, earlyGraceMinutes: 5, overtimeMinMinutes: 30, isActive: true });

	const PACKS = {
		CONSTRUCTION: {
			code: "CONSTRUCTION", name: "Construction", nameVi: "Xây dựng",
			earningTypes: [
				ET("PCCT", "Site allowance", "Phụ cấp công trường", "A"),
				ET("PCXANHA", "Away-from-home allowance", "Phụ cấp xa nhà", "A"),
				ET("KHOAN", "Contract work (piece rate)", "Lương khoán", "P"),
			],
			payGroups: [
				PG("XD-VP", "Construction - office staff (monthly)", "Xây dựng - văn phòng (tháng)", "M"),
				PG("XD-CT", "Construction - site staff (monthly)", "Xây dựng - công trường (tháng)", "M"),
				PG("XDKHOAN", "Construction - contract crews (weekly)", "Xây dựng - tổ khoán (tuần)", "W", "S"),
			],
			rateTables: [RT("KHOAN-XD", "Contract work item rates", "Đơn giá hạng mục khoán", "W")],
			shifts: [],
			patterns: [],
			rules: [
				R("XD-SITE", "PCCT", 50, "J", "F", false, "Site allowance per site day (set rate, then activate)", "Phụ cấp công trường theo ngày (khai mức rồi kích hoạt)"),
				R("XD-KHOAN", "KHOAN", 60, "O", "Q", true, "Contract work from approved acceptance entries", "Lương khoán từ phiếu nghiệm thu đã duyệt", { rateTable: "KHOAN-XD" }),
			],
		},
		TRADE: {
			code: "TRADE", name: "Trade", nameVi: "Thương mại",
			earningTypes: [
				ET("HOAHONG", "Sales commission", "Hoa hồng bán hàng", "N"),
				ET("THUONGCH", "Store bonus", "Thưởng cửa hàng", "N"),
				ET("PCGH", "Delivery allowance", "Phụ cấp giao hàng", "A"),
			],
			payGroups: [
				PG("TM-VP", "Trade - office staff (monthly)", "Thương mại - văn phòng (tháng)", "M"),
				PG("TM-KD", "Trade - sales staff (monthly)", "Thương mại - kinh doanh (tháng)", "M"),
				PG("TMPT", "Trade - store part-time (semi-monthly)", "Thương mại - bán thời gian (nửa tháng)", "S"),
			],
			rateTables: [RT("HH-TM", "Sales commission tiers", "Thang hoa hồng doanh số", "S"), RT("DS-CH", "Store sales", "Doanh số cửa hàng", "S")],
			shifts: [],
			patterns: [],
			rules: [
				R("TM-COMM", "HOAHONG", 50, "S", "T", true, "Tiered commission, paid at 80% of sales target", "Hoa hồng theo thang, đạt từ 80% chỉ tiêu", {
					rateTable: "HH-TM", tierMethod: "P", conditions: [{ field: "P", comparison: "G", value: 80 }], failAction: "N",
				}),
				R("TM-STORE", "THUONGCH", 55, "O", "C", false, "Store bonus, % of store sales (set %, then activate)", "Thưởng cửa hàng theo % doanh số (khai % rồi kích hoạt)", { rateTable: "DS-CH" }),
			],
		},
		MANUFACTURING: {
			code: "MANUFACTURING", name: "Manufacturing", nameVi: "Sản xuất",
			earningTypes: [
				ET("PCCA3", "Night shift allowance", "Phụ cấp ca 3", "A"),
				ET("ANCACA", "Meal allowance per shift", "Ăn ca theo ca", "M", "C", "PIT.MEAL_EXEMPT_CAP"),
				ET("CHUYENCAN", "Attendance bonus", "Thưởng chuyên cần", "N"),
				ET("DOCHAI", "Hazardous work allowance", "Phụ cấp độc hại", "A"),
				ET("SANPHAM", "Piece rate by operation", "Lương sản phẩm theo công đoạn", "P"),
			],
			payGroups: [
				PG("SX-GT", "Manufacturing - indirect staff (monthly)", "Sản xuất - gián tiếp (tháng)", "M"),
				PG("SX-CA", "Manufacturing - shift workers (monthly)", "Sản xuất - công nhân ca (tháng)", "M"),
				PG("SXTV", "Manufacturing - seasonal workers (semi-monthly)", "Sản xuất - thời vụ (nửa tháng)", "S"),
			],
			rateTables: [RT("CONGDOAN", "Operation piece rates", "Đơn giá công đoạn", "O")],
			shifts: [
				SH("HC", "08:00", "17:00", 60, "D"),
				SH("C1", "06:00", "14:00", 30, "D"),
				SH("C2", "14:00", "22:00", 30, "E"),
				SH("C3", "22:00", "06:00", 30, "N"),
			],
			patterns: [
				{ code: "3C4K", name: "3 shifts 4 crews", nameVi: "3 ca 4 kíp", days: ["C1", "C1", "C2", "C2", "C3", "C3", "", ""] },
				{ code: "2CA", name: "2 shifts, weekly rotation", nameVi: "2 ca đổi tuần", days: ["C1", "C1", "C1", "C1", "C1", "C1", "", "C2", "C2", "C2", "C2", "C2", "C2", ""] },
				{ code: "HC6", name: "Office hours Monday to Saturday", nameVi: "Hành chính thứ 2 - thứ 7", days: ["HC", "HC", "HC", "HC", "HC", "HC", ""] },
			],
			rules: [
				R("SX-CA3", "PCCA3", 45, "H", "F", false, "Night shift allowance per shift (set rate, then activate)", "Phụ cấp ca 3 theo ca đêm (khai mức rồi kích hoạt)", { shiftKind: "N" }),
				R("SX-ANCA", "ANCACA", 46, "H", "F", false, "Meal allowance per shift (set rate, then activate)", "Ăn ca theo số ca (khai mức rồi kích hoạt)"),
				R("SX-CC", "CHUYENCAN", 47, "K", "F", false, "Attendance bonus (set amount, then activate)", "Thưởng chuyên cần (khai mức rồi kích hoạt)", {
					conditions: [{ field: "U", comparison: "E", value: 0 }, { field: "L", comparison: "L", value: 2 }], failAction: "R", reductionPercent: 20,
				}),
				R("SX-SP", "SANPHAM", 60, "O", "Q", true, "Piece rate from approved output entries", "Lương sản phẩm từ phiếu sản lượng đã duyệt", { rateTable: "CONGDOAN" }),
			],
		},
	};

	/** Độ dài tối đa mã nhóm lương để mã kỳ <= 15 ký tự: tháng 8, tuần 7, nửa tháng 6. */
	const MAX_GROUP_LENGTH = { M: 8, W: 7, S: 6 };

	/** Kiểm tra gói: trả danh sách lỗi. */
	function validatePack(pack) {
		const errors = [];
		for (const g of pack.payGroups) if (g.code.length > (MAX_GROUP_LENGTH[g.frequency] || 8)) errors.push(`Mã nhóm lương ${g.code} quá dài cho tần suất ${g.frequency}.`);
		const tables = new Set(pack.rateTables.map((t) => t.code));
		const types = new Set(pack.earningTypes.map((t) => t.code));
		for (const r of pack.rules) {
			if (r.rateTable && !tables.has(r.rateTable)) errors.push(`Quy tắc ${r.code} tham chiếu bảng đơn giá ${r.rateTable} không có trong gói.`);
			if (!types.has(r.earningType)) errors.push(`Quy tắc ${r.code} tham chiếu loại thu nhập ${r.earningType} không có trong gói.`);
			if (r.code.length > 15) errors.push(`Mã quy tắc ${r.code} quá 15 ký tự.`);
			if ((r.description || "").length > 60 || (r.descriptionVi || "").length > 60) errors.push(`Diễn giải quy tắc ${r.code} quá 60 ký tự.`);
		}
		const shifts = new Set(pack.shifts.map((s) => s.code));
		for (const p of pack.patterns) for (const d of p.days) if (d && !shifts.has(d)) errors.push(`Mẫu xoay ca ${p.code} dùng ca ${d} không có trong gói.`);
		for (const list of [pack.earningTypes, pack.payGroups, pack.rateTables, pack.shifts, pack.patterns]) for (const x of list) if (x.code.length > 15) errors.push(`Mã ${x.code} quá 15 ký tự.`);
		return errors;
	}

	/**
	 * Kế hoạch nạp: chỉ phần chưa có, theo thứ tự phụ thuộc.
	 * @param {string} code mã gói
	 * @param {{earningTypes: string[], payGroups: string[], rateTables: string[], shifts: string[], patterns: string[], rules: string[]}} existing mã đã có
	 */
	function planLoad(code, existing) {
		const pack = PACKS[String(code || "").toUpperCase()];
		if (!pack) throw new Error(`Unknown industry pack: ${code}`);
		const ex = existing || {};
		if (!(ex.rules || []).length) {
			throw new Error("Load VN Defaults first: the earning rule table is empty and the pack has no base salary rule.");
		}
		const missing = (list, have) => {
			const s = new Set((have || []).map((x) => String(x).trim().toUpperCase()));
			return list.filter((x) => !s.has(x.code.toUpperCase()));
		};
		return {
			earningTypes: missing(pack.earningTypes, ex.earningTypes), payGroups: missing(pack.payGroups, ex.payGroups), rateTables: missing(pack.rateTables, ex.rateTables),
			shifts: missing(pack.shifts, ex.shifts), patterns: missing(pack.patterns, ex.patterns), rules: missing(pack.rules, ex.rules),
		};
	}

	return { PACKS, MAX_GROUP_LENGTH, validatePack, planLoad };
});
