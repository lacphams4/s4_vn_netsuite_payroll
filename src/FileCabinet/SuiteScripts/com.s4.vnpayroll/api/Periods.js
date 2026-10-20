/**
 * Kỳ lương (đặc tả 2.8): sinh kỳ theo nhóm lương, đóng / mở kỳ, khóa / mở khóa công.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Settings", "../core/PayPeriodGenerator"], (Store, Settings, Generator) => {
	/** Sinh kỳ của năm cho nhóm lương; kỳ đã có (theo mã) không sinh lại. */
	function generate(year, paygroupId) {
		const group = paygroupId ? Store.get("paygroup", paygroupId) : Settings.paygroupByName("DEFAULT");
		if (!group) throw new Error("Pay group not found / Không tìm thấy nhóm lương");
		const code = String(group.name).trim().toUpperCase();
		const freq = group.frequency || "M";
		const bad = code === "DEFAULT" ? null : Generator.validatePayGroupId(code, freq);
		if (bad) throw new Error(`${bad.message} / ${bad.messageVi}`);
		const settings = Settings.resolve(group.subsidiary, group);
		const periods = Generator.withStandardDays(Generator.generate(Number(year), freq, code === "DEFAULT" ? "" : code, settings.weekStart), {
			weeklyOff: settings.weeklyOffDays,
			holidays: Settings.holidays().map((h) => h.date),
			payGroupStandardDays: settings.standardWorkDays,
		});
		const existing = new Set(Store.find("period", { includeInactive: true }).map((p) => String(p.name).toUpperCase()));
		const created = [];
		for (const p of periods) {
			if (existing.has(p.periodId.toUpperCase())) continue;
			Store.create("period", {
				name: p.periodId, paygroup: group.id, frequency: p.frequency || freq, start: p.startDate, end: p.endDate, std_days: p.standardWorkDays,
				status: "O", att_status: "O", tax_month: p.taxMonth, last_in_month: !!p.isLastInTaxMonth,
			});
			created.push(p.periodId);
		}
		return { created, skipped: periods.length - created.length };
	}

	function list(filter = {}) {
		const rows = Store.find("period", { includeInactive: true, order: "{start} DESC" });
		return rows.filter((p) => !filter.paygroup || p.paygroup === String(filter.paygroup));
	}

	/** Đóng kỳ: không được khi còn bảng lương chưa ghi sổ (trừ bảng đã đảo). */
	function close(periodId) {
		const open = Store.find("batch", { where: "{period} = ?", params: [periodId] }).filter((b) => b.status !== "R" && b.status !== "V");
		if (open.length) throw new Error(`The period still has unreleased payroll batches: ${open.map((b) => b.name).join(", ")} / Kỳ còn bảng lương chưa ghi sổ`);
		Store.submit("period", periodId, { status: "C" });
	}

	function reopen(periodId) {
		Store.submit("period", periodId, { status: "O" });
	}

	/** Khóa công kỳ (3.5): đặt trạng thái các dòng tổng hợp công và kỳ. */
	function lockAttendance(periodId) {
		for (const a of Store.find("attendance", { where: "{period} = ?", params: [periodId] })) if (a.status !== "L") Store.submit("attendance", a.id, { status: "L" });
		Store.submit("period", periodId, { att_status: "L" });
	}

	/** Mở khóa công: chặn khi kỳ đã có bảng lương ghi sổ (kể cả đã đảo, 3.11 #5). */
	function unlockAttendance(periodId) {
		const released = Store.find("batch", { where: "{period} = ?", params: [periodId] }).filter((b) => b.status === "R" || b.status === "V");
		if (released.length) throw new Error("The period has a released payroll batch; attendance cannot be unlocked. / Kỳ đã có bảng lương ghi sổ, không mở khóa công được.");
		for (const a of Store.find("attendance", { where: "{period} = ?", params: [periodId] })) if (a.status !== "O") Store.submit("attendance", a.id, { status: "O" });
		Store.submit("period", periodId, { att_status: "O" });
	}

	return { generate, list, close, reopen, lockAttendance, unlockAttendance };
});
