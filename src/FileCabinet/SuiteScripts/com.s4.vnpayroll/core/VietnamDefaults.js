/**
 * Dữ liệu mặc định "Load VN Defaults" (VietnamStatutoryDefaults và các danh mục mặc định, đặc tả mục 1.3.6, 2.2, 3.1,
 * 3.2, 3.6). Giá trị đúng như bộ của S4.VP.Core để hai hệ thống ra cùng con số.
 *
 * Ba giá trị đánh dấu verified: false (mức tham chiếu 2.530.000, ngưỡng khấu trừ 10% 5.000.000, trần ăn ca 1.200.000
 * từ 01/07/2026) lấy theo dữ liệu kiểm thử của S4, chưa đối chiếu văn bản gốc; giao diện cảnh báo khi dùng.
 * Mỗi danh mục có tên tiếng Anh (name) và tiếng Việt (nameVi); Load VN Defaults chọn theo ngôn ngữ người chạy.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
	const P = (code, value, effectiveDate, expirationDate, legalReference, description, verified = true) => ({
		code, value, effectiveDate, expirationDate, legalReference, description, verified,
	});
	const UNVERIFIED = " (per S4 payroll test data; verify against the original text)";

	const params = [
		P("PIT.SELF_DEDUCTION", 11000000, "2020-07-01", "2025-12-31", "NQ 954/2020/UBTVQH14", "Giảm trừ bản thân / tháng"),
		P("PIT.SELF_DEDUCTION", 15500000, "2026-01-01", null, "Luật Thuế TNCN 109/2025/QH15", "Giảm trừ bản thân / tháng"),
		P("PIT.DEPENDENT_DEDUCTION", 4400000, "2020-07-01", "2025-12-31", "NQ 954/2020/UBTVQH14", "Giảm trừ mỗi người phụ thuộc / tháng"),
		P("PIT.DEPENDENT_DEDUCTION", 6200000, "2026-01-01", null, "Luật Thuế TNCN 109/2025/QH15", "Giảm trừ mỗi người phụ thuộc / tháng"),
		P("PIT.FLAT_RATE", "0.10", "2018-01-01", null, "TT 111/2013/TT-BTC Điều 25", "Thuế suất khấu trừ 10%"),
		P("PIT.FLAT_THRESHOLD", 2000000, "2018-01-01", "2026-06-30", "TT 111/2013/TT-BTC Điều 25", "Ngưỡng mỗi lần chi trả để khấu trừ 10%"),
		P("PIT.FLAT_THRESHOLD", 5000000, "2026-07-01", null, "Decree 253/2026/ND-CP" + UNVERIFIED, "Ngưỡng mỗi lần chi trả để khấu trừ 10%", false),
		P("PIT.NONRESIDENT_RATE", "0.20", "2018-01-01", null, "Luật Thuế TNCN", "Thuế suất cá nhân không cư trú"),
		P("PIT.MEAL_EXEMPT_CAP", 730000, "2018-01-01", "2026-06-30", "TT 26/2016/TT-BLĐTBXH", "Trần tiền ăn giữa ca miễn thuế / tháng"),
		P("PIT.MEAL_EXEMPT_CAP", 1200000, "2026-07-01", null, "Decree 253/2026/ND-CP" + UNVERIFIED, "Trần tiền ăn giữa ca miễn thuế / tháng", false),
		P("INS.REFERENCE_WAGE", 1490000, "2019-07-01", "2023-06-30", "NĐ 38/2019/NĐ-CP", "Mức tham chiếu / lương cơ sở"),
		P("INS.REFERENCE_WAGE", 1800000, "2023-07-01", "2024-06-30", "NĐ 24/2023/NĐ-CP", "Mức tham chiếu / lương cơ sở"),
		P("INS.REFERENCE_WAGE", 2340000, "2024-07-01", "2026-06-30", "NĐ 73/2024/NĐ-CP; Luật BHXH 41/2024/QH15", "Mức tham chiếu / lương cơ sở"),
		P("INS.REFERENCE_WAGE", 2530000, "2026-07-01", null, "Decree 161/2026/ND-CP" + UNVERIFIED, "Mức tham chiếu / lương cơ sở", false),
		P("INS.SI_CAP_MULTIPLIER", 20, "2018-01-01", null, "Luật BHXH 41/2024/QH15", "Hệ số trần lương đóng BHXH, BHYT"),
		P("INS.UI_CAP_MULTIPLIER", 20, "2018-01-01", null, "Luật Việc làm", "Hệ số trần lương đóng BHTN"),
		P("INS.ABSENCE_DAYS_THRESHOLD", 14, "2018-01-01", null, "Luật BHXH 41/2024/QH15", "Số ngày nghỉ trong tháng không đóng BH"),
		P("INS.UNION_FEE_CAP_FACTOR", "0.10", "2018-01-01", null, "Điều lệ Công đoàn", "Trần đoàn phí (lõi lấy trần theo khoản DOANPHI)"),
		P("MINWAGE.I", 4960000, "2024-07-01", "2025-12-31", "NĐ 74/2024/NĐ-CP", "Lương tối thiểu vùng I"),
		P("MINWAGE.II", 4410000, "2024-07-01", "2025-12-31", "NĐ 74/2024/NĐ-CP", "Lương tối thiểu vùng II"),
		P("MINWAGE.III", 3860000, "2024-07-01", "2025-12-31", "NĐ 74/2024/NĐ-CP", "Lương tối thiểu vùng III"),
		P("MINWAGE.IV", 3450000, "2024-07-01", "2025-12-31", "NĐ 74/2024/NĐ-CP", "Lương tối thiểu vùng IV"),
		P("MINWAGE.I", 5310000, "2026-01-01", null, "NĐ 293/2025/NĐ-CP", "Lương tối thiểu vùng I"),
		P("MINWAGE.II", 4730000, "2026-01-01", null, "NĐ 293/2025/NĐ-CP", "Lương tối thiểu vùng II"),
		P("MINWAGE.III", 4140000, "2026-01-01", null, "NĐ 293/2025/NĐ-CP", "Lương tối thiểu vùng III"),
		P("MINWAGE.IV", 3700000, "2026-01-01", null, "NĐ 293/2025/NĐ-CP", "Lương tối thiểu vùng IV"),
		P("OT.NORMAL_DAY", "1.5", "2018-01-01", null, "BLLĐ 2019 Điều 98", "Hệ số OT ngày thường"),
		P("OT.WEEKLY_OFF", "2.0", "2018-01-01", null, "BLLĐ 2019 Điều 98", "Hệ số OT ngày nghỉ hằng tuần"),
		P("OT.HOLIDAY", "3.0", "2018-01-01", null, "BLLĐ 2019 Điều 98", "Hệ số OT ngày lễ, tết"),
		P("OT.NIGHT_PREMIUM", "0.30", "2018-01-01", null, "BLLĐ 2019 Điều 98", "Phụ cấp làm đêm"),
		P("OT.NIGHT_EXTRA", "0.20", "2018-01-01", null, "NĐ 145/2020/NĐ-CP Điều 57", "Phần thêm 20% khi làm thêm ban đêm"),
		P("OT.LIMIT_MONTH", 40, "2018-01-01", null, "BLLĐ 2019 Điều 107", "Giới hạn giờ OT / tháng"),
		P("OT.LIMIT_YEAR", 200, "2018-01-01", null, "BLLĐ 2019 Điều 107", "Giới hạn giờ OT / năm"),
		P("OT.LIMIT_YEAR_EXTENDED", 300, "2018-01-01", null, "BLLĐ 2019 Điều 107; NĐ 145/2020/NĐ-CP Điều 61", "Giới hạn giờ OT / năm cho ngành được phép"),
	];

	const B = (effectiveDate, expirationDate, level, upperBound, rate, legalReference) => ({ effectiveDate, expirationDate, level, upperBound, rate, legalReference });
	const brackets = [
		B("2020-07-01", "2025-12-31", 1, 5000000, "0.05", "Luật Thuế TNCN 2007 sửa đổi"),
		B("2020-07-01", "2025-12-31", 2, 10000000, "0.10", "Luật Thuế TNCN 2007 sửa đổi"),
		B("2020-07-01", "2025-12-31", 3, 18000000, "0.15", "Luật Thuế TNCN 2007 sửa đổi"),
		B("2020-07-01", "2025-12-31", 4, 32000000, "0.20", "Luật Thuế TNCN 2007 sửa đổi"),
		B("2020-07-01", "2025-12-31", 5, 52000000, "0.25", "Luật Thuế TNCN 2007 sửa đổi"),
		B("2020-07-01", "2025-12-31", 6, 80000000, "0.30", "Luật Thuế TNCN 2007 sửa đổi"),
		B("2020-07-01", "2025-12-31", 7, null, "0.35", "Luật Thuế TNCN 2007 sửa đổi"),
		B("2026-01-01", null, 1, 10000000, "0.05", "Luật Thuế TNCN 109/2025/QH15"),
		B("2026-01-01", null, 2, 30000000, "0.10", "Luật Thuế TNCN 109/2025/QH15"),
		B("2026-01-01", null, 3, 60000000, "0.20", "Luật Thuế TNCN 109/2025/QH15"),
		B("2026-01-01", null, 4, 100000000, "0.30", "Luật Thuế TNCN 109/2025/QH15"),
		B("2026-01-01", null, 5, null, "0.35", "Luật Thuế TNCN 109/2025/QH15"),
	];

	const C = (code, name, nameVi, employeeRate, employerRate, wageBase, requiresUnionMembership = false, employeeCapFactor = null, liabilityAccount = "") => ({
		code, name, nameVi, description: name, employeeRate, employerRate, wageBase, requiresUnionMembership, employeeCapFactor,
		effectiveDate: "2018-01-01", expirationDate: null, liabilityAccount, legalReference: "Luật BHXH 41/2024/QH15; Luật BHYT; Luật Việc làm; Luật Công đoàn",
	});
	const components = [
		C("BHXH_HT", "Social insurance - pension and survivorship", "BHXH hưu trí, tử tuất", "0.08", "0.14", "S", false, null, "3383"),
		C("BHXH_OD", "Social insurance - sickness and maternity", "BHXH ốm đau, thai sản", "0", "0.03", "S", false, null, "3383"),
		C("BHTNLD", "Occupational accident and disease insurance", "Bảo hiểm TNLĐ-BNN", "0", "0.005", "S", false, null, "3383"),
		C("BHYT", "Health insurance", "Bảo hiểm y tế", "0.015", "0.03", "S", false, null, "3384"),
		C("BHTN", "Unemployment insurance", "Bảo hiểm thất nghiệp", "0.01", "0.01", "U", false, null, "3386"),
		C("KPCD", "Trade union fund", "Kinh phí công đoàn", "0", "0.02", "S", false, null, "3382"),
		C("DOANPHI", "Trade union membership fee", "Đoàn phí công đoàn", "0.01", "0", "S", true, "0.10", "3388"),
	];

	const H = (date, name, nameVi, isCompensatory = false) => ({ date, name, nameVi, isCompensatory });
	const holidays = [
		H("2027-01-01", "New Year's Day", "Tết Dương lịch"),
		H("2027-02-04", "Lunar New Year", "Tết Nguyên đán"),
		H("2027-02-05", "Lunar New Year", "Tết Nguyên đán"),
		H("2027-02-06", "Lunar New Year", "Tết Nguyên đán"),
		H("2027-02-07", "Lunar New Year", "Tết Nguyên đán"),
		H("2027-02-08", "Lunar New Year", "Tết Nguyên đán"),
		H("2027-02-09", "Lunar New Year", "Tết Nguyên đán"),
		H("2027-02-10", "Lunar New Year", "Tết Nguyên đán"),
		H("2027-04-16", "Hung Kings Commemoration Day", "Giỗ Tổ Hùng Vương"),
		H("2027-04-30", "Reunification Day", "Ngày Giải phóng miền Nam"),
		H("2027-05-01", "International Labour Day", "Quốc tế Lao động"),
		H("2027-05-03", "Compensatory day for International Labour Day", "Nghỉ bù Quốc tế Lao động", true),
		H("2027-09-02", "National Day", "Quốc khánh"),
		H("2027-09-03", "National Day (adjacent day)", "Quốc khánh (ngày liền kề)"),
		H("2027-11-24", "Vietnam Culture Day", "Ngày Văn hóa Việt Nam"),
	];

	// Loại thu nhập mặc định: category B/O/A/N/P/M/X, taxTreatment T/E/C/P, overtimeDayType N/W/H
	const E = (code, name, nameVi, category, taxTreatment, extra = {}) => Object.assign({
		code, name, nameVi, category, taxTreatment, exemptCapParam: "", isOvertime: false, overtimeDayType: "N", isNight: false,
		hadDaytimeOvertime: false, timeTypeCode: "", isActive: true,
	}, extra);
	const earningTypes = [
		E("LUONG", "Base salary", "Lương cơ bản", "B", "T"),
		E("PHUCAP", "Fixed allowance", "Phụ cấp cố định", "A", "T"),
		E("ANCA", "Meal allowance", "Ăn ca", "M", "C", { exemptCapParam: "PIT.MEAL_EXEMPT_CAP" }),
		E("THUONG", "Bonus", "Thưởng", "N", "T"),
		E("TRAPHEP", "Unused annual leave payout", "Tiền phép chưa nghỉ khi nghỉ việc", "X", "T"),
		E("PHIDV", "Contractor service fee", "Thù lao cộng tác viên", "B", "T"),
		E("OT150", "Overtime - normal day", "Làm thêm ngày thường", "O", "P", { isOvertime: true, overtimeDayType: "N", timeTypeCode: "OT" }),
		E("OT200", "Overtime - weekly day off", "Làm thêm ngày nghỉ hằng tuần", "O", "P", { isOvertime: true, overtimeDayType: "W", timeTypeCode: "OT" }),
		E("OT300", "Overtime - public holiday", "Làm thêm ngày lễ", "O", "P", { isOvertime: true, overtimeDayType: "H", timeTypeCode: "OT" }),
		E("OTD150", "Night overtime - normal day", "Làm thêm ban đêm ngày thường", "O", "P", { isOvertime: true, overtimeDayType: "N", isNight: true }),
		E("OTD200", "Night overtime - weekly day off", "Làm thêm ban đêm ngày nghỉ hằng tuần", "O", "P", { isOvertime: true, overtimeDayType: "W", isNight: true }),
		E("OTD300", "Night overtime - public holiday", "Làm thêm ban đêm ngày lễ", "O", "P", { isOvertime: true, overtimeDayType: "H", isNight: true }),
		E("DEM", "Night work allowance", "Phụ cấp làm đêm", "O", "P", { isNight: true }),
	];

	const L = (code, name, nameVi, extra) => Object.assign({
		code, name, nameVi, isPaid: true, deductsWorkDays: false, paidBySocialInsurance: false, usesBalance: false,
		requiresAttachment: false, allowHalfDay: true, maxDaysPerRequest: 0, isActive: true,
	}, extra);
	const leaveTypes = [
		L("PN", "Annual leave", "Phép năm", { usesBalance: true }),
		L("VR", "Paid personal leave (wedding, funeral)", "Việc riêng có lương", { maxDaysPerRequest: 3 }),
		L("OM", "Sick leave (social insurance)", "Ốm đau (BHXH trả)", { isPaid: false, deductsWorkDays: true, paidBySocialInsurance: true, requiresAttachment: true }),
		L("TS", "Maternity leave (social insurance)", "Thai sản (BHXH trả)", { isPaid: false, deductsWorkDays: true, paidBySocialInsurance: true, requiresAttachment: true }),
		L("KL", "Unpaid leave", "Nghỉ không lương", { isPaid: false, deductsWorkDays: true }),
	];

	const leavePolicies = [{
		code: "STD", name: "Standard annual leave", nameVi: "Phép năm tiêu chuẩn", leaveType: "PN", annualDays: 12, seniorityStepYears: 5,
		seniorityExtraDays: 1, accrualMethod: "Y", prorateNewHire: true, carryOverMaxDays: 0, carryOverExpiryMonth: 0, roundingUnit: "0.5", isActive: true,
	}];

	const attendanceRules = [
		{ minutesFrom: 1, minutesTo: 15, deductDays: "0" },
		{ minutesFrom: 16, minutesTo: 60, deductDays: "0.25" },
		{ minutesFrom: 61, minutesTo: 240, deductDays: "0.5" },
		{ minutesFrom: 241, minutesTo: null, deductDays: "1" },
	];

	// Ký hiệu bảng công: category W/P/U/S/T/N
	const S = (code, name, nameVi, category, days) => ({ code, name, nameVi, category, days });
	const attendanceSymbols = [
		S("X", "Full working day", "Ngày công", "W", "1"),
		S("/2", "Half working day", "Nửa ngày công", "W", "0.5"),
		S("P", "Paid leave", "Nghỉ phép", "P", "1"),
		S("P/2", "Half-day paid leave", "Nghỉ phép nửa ngày", "P", "0.5"),
		S("K", "Unpaid leave", "Nghỉ không lương", "U", "1"),
		S("Ô", "Sick leave (social insurance)", "Ốm (BHXH)", "S", "1"),
		S("TS", "Maternity leave (social insurance)", "Thai sản (BHXH)", "S", "1"),
		S("CT", "Business trip", "Công tác", "T", "1"),
		S("L", "Public holiday", "Nghỉ lễ", "N", "0"),
		S("N", "Day off", "Nghỉ", "N", "0"),
	];

	/**
	 * Bộ quy tắc thu nhập mặc định V2 (mục 4.2.7), dựng từ thiết lập:
	 * baseEarningType, contractorEarningType (trống = base), allowanceEarningType (trống = base), mealEarningType, mealAllowanceAmount.
	 */
	function defaultEarningRules(setup) {
		const s = setup || {};
		const base = s.baseEarningType || "LUONG";
		const rules = [
			{ code: "BASE", description: "Base salary", descriptionVi: "Lương cơ bản", sequence: 10, earningType: base, employmentType: "E", quantitySource: "B", hoursFallbackToWorkDays: true, rateSource: "S", proration: "M" },
			{ code: "BASE-CTV", description: "Contractor fee", descriptionVi: "Thù lao cộng tác viên", sequence: 11, earningType: s.contractorEarningType || base, employmentType: "C", quantitySource: "B", hoursFallbackToWorkDays: false, rateSource: "S", proration: "M" },
			{ code: "ALLOWANCE", description: "Fixed allowance", descriptionVi: "Phụ cấp cố định", sequence: 20, earningType: s.allowanceEarningType || base, quantitySource: "D", rateSource: "A", proration: "M" },
			{ code: "BENEFIT", description: "Benefit package", descriptionVi: "Gói phúc lợi", sequence: 30, earningType: "", quantitySource: "D", rateSource: "P", proration: "M" },
		];
		if (s.mealEarningType && Number(s.mealAllowanceAmount) > 0) {
			rules.push({ code: "MEAL", description: "Meal allowance", descriptionVi: "Ăn ca", sequence: 40, earningType: s.mealEarningType, employmentType: "E", quantitySource: "K", rateSource: "F", fixedRate: s.mealAllowanceAmount, proration: "N" });
		}
		return rules.map((r) => Object.assign({ payGroup: "", salaryType: "", employmentType: "", effectiveDate: null, expirationDate: null, multiplier: 1, conditions: [], failAction: "N", reductionPercent: 0, isActive: true }, r));
	}

	/** Thiết lập tenant mặc định (VPSetup). */
	const setup = {
		standardWorkDays: 0, standardHoursPerDay: 8, weeklyOffDays: "0", defaultRegion: "I",
		baseEarningType: "LUONG", allowanceEarningType: "PHUCAP", mealEarningType: "ANCA", contractorEarningType: "PHIDV", leavePayoutEarningType: "TRAPHEP",
		mealAllowanceAmount: 0, unionFundApplicable: true, occupationalAccidentRate: null, extendedOvertimeSector: false,
		requirePayrollApproval: true, requireTimeApproval: true, overtimeSource: "R", requireAttendanceLock: false,
		defaultLeavePolicy: "STD", workPermitBlocksPayroll: false, workPermitMaxTermMonths: 24, workPermitMaxExtensions: 1, workPermitReminderDays: 60,
		allocationMethod: "F", allocationFallback: "P", allocationVersionMode: "E", accrual13thBasis: "P", accrual13thMonths: 12,
	};

	return { params, brackets, components, holidays, earningTypes, leaveTypes, leavePolicies, attendanceRules, attendanceSymbols, defaultEarningRules, setup };
});
