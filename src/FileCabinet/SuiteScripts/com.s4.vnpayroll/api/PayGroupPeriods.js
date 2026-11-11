/**
 * Kỳ lương theo nhóm lương của nhân viên (tài khoản nhiều công ty, mỗi công ty một nhóm lương có kỳ riêng trùng ngày).
 *
 * Quy tắc: mọi kiểm tra "kỳ công đã khóa" và mọi lần tìm kỳ theo ngày cho chứng từ, phân ca, lượt chấm của một nhân viên
 * chỉ xét kỳ thuộc nhóm lương của nhân viên đó - nhóm trên hồ sơ lương (paygroup), trống = DEFAULT; nhân viên chưa có
 * hồ sơ lương cũng tính là DEFAULT. Nhóm so theo mã (tên chuẩn hóa) như Shifts.groupProfiles, Attendance.eligibleProfiles.
 * Tài khoản chỉ có một nhóm lương (mọi nhóm và mọi kỳ cùng một mã) thì không lọc gì: giữ nguyên hành vi cũ và không đọc
 * hồ sơ lương.
 *
 * Số truy vấn cố định: load() đọc nhóm lương và kỳ (hai truy vấn); loadGroups() đọc hồ sơ lương của cả danh sách nhân viên
 * một lần (mỗi 900 nhân viên một truy vấn), nhớ kết quả trong ngữ cảnh - không truy vấn theo từng nhân viên.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "../core/AttendanceSummaryCalculator"], (Store, Summary) => {
	const DEFAULT = "DEFAULT";
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();

	/** Mã nhóm lương theo id; id trống = DEFAULT. */
	function codeOf(paygroupId, names) {
		return blank(paygroupId) ? DEFAULT : names[String(paygroupId)] || DEFAULT;
	}

	/** Kỳ theo cấu trúc lõi (AttendanceSummaryCalculator.lockedPeriodOverlap, AttendanceDocRules.periodOf). */
	const corePeriod = (p) => ({
		id: p.id, code: p.name, paygroup: p.paygroup, startDate: p.start, endDate: p.end, standardWorkDays: p.std_days, attendanceStatus: p.att_status || "O", status: p.status || "O",
	});

	/**
	 * Đọc nhóm lương và mọi kỳ (kể cả ngừng dùng). Mỗi kỳ trả về là map(p) cộng thêm group (mã nhóm của kỳ).
	 * @param {function(Object): Object} [map] dựng đối tượng kỳ từ record (mặc định: cấu trúc lõi)
	 * @returns {{periods: Array, names: Object<string, string>, multi: boolean, byEmployee: Object<string, string>}}
	 */
	function load(map) {
		const names = {};
		for (const g of Store.find("paygroup", { includeInactive: true })) names[String(g.id)] = norm(g.name) || DEFAULT;
		const rows = Store.find("period", { includeInactive: true });
		const codes = new Set(Object.values(names));
		for (const p of rows) codes.add(codeOf(p.paygroup, names));
		const periods = rows.map((p) => Object.assign((map || corePeriod)(p), { group: codeOf(p.paygroup, names) }));
		return { periods, names, multi: codes.size > 1, byEmployee: {} };
	}

	/**
	 * Nạp mã nhóm lương của các nhân viên chưa có trong ngữ cảnh: một truy vấn hồ sơ lương cho cả danh sách. Nhân viên có
	 * nhiều hồ sơ thì ưu tiên hồ sơ đang dùng. Tài khoản một nhóm lương thì không đọc gì.
	 * @returns {Object<string, string>} employee id -> mã nhóm
	 */
	function loadGroups(ctx, employeeIds) {
		if (!ctx.multi) return ctx.byEmployee;
		const want = [...new Set((employeeIds || []).filter((e) => !blank(e)).map(String))].filter((e) => !(e in ctx.byEmployee));
		if (!want.length) return ctx.byEmployee;
		const found = {};
		for (let i = 0; i < want.length; i += 900) {
			const chunk = want.slice(i, i + 900);
			const wanted = new Set(chunk);
			for (const prof of Store.find("employee", { where: `{employee} IN (${chunk.map(() => "?").join(",")})`, params: chunk, includeInactive: true })) {
				const e = String(prof.employee);
				if (!wanted.has(e) || (found[e] && !found[e].isInactive)) continue;
				found[e] = prof;
			}
		}
		for (const e of want) ctx.byEmployee[e] = codeOf(found[e] && found[e].paygroup, ctx.names);
		return ctx.byEmployee;
	}

	/** Mã nhóm lương của nhân viên; null = không lọc (tài khoản một nhóm, hoặc chưa có nhân viên). */
	function groupOf(ctx, employee) {
		if (!ctx.multi || blank(employee)) return null;
		loadGroups(ctx, [employee]);
		return ctx.byEmployee[String(employee)];
	}

	/** Kỳ thuộc nhóm lương của nhân viên. */
	function periodsOf(ctx, employee) {
		return Summary.periodsOfGroup(ctx.periods, groupOf(ctx, employee));
	}

	/** Kỳ công đã khóa của nhóm lương của nhân viên giao [from, to], hoặc null. */
	function lockedFor(ctx, employee, from, to) {
		return Summary.lockedPeriodOverlap(from, to, ctx.periods, groupOf(ctx, employee));
	}

	return { DEFAULT, codeOf, load, loadGroups, groupOf, periodsOf, lockedFor };
});
