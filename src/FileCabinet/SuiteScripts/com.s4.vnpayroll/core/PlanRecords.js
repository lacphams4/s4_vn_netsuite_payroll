/**
 * Chuyển record giấy phép lao động (VP204000) và bảng tỷ lệ phân bổ (VP205000) sang cấu trúc lõi, cảnh báo giấy phép
 * cho kỳ lương, ngày cuối kỳ đã ghi sổ có dùng bảng tỷ lệ. Hàm thuần, lớp api/WorkPermits.js và api/AllocationPlans.js gọi.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./WorkPermitEvaluator"], (Dates, Evaluator) => {
	const DEFAULTS = { maxTermMonths: 24, maxExtensions: 1, reminderDays: 60 };

	/** Record work_permit (Store) -> {refNbr, id, employee, docType, issueType, previousRefNbr, status, effectiveDate, expiryDate}. */
	function permitFromRecord(r, refById) {
		return {
			id: r.id, refNbr: r.name || r.id, employee: r.employee, docType: r.doc_type || "P", issueType: r.issue_type || "N",
			previousRefNbr: r.previous ? (refById && refById[r.previous]) || r.previous : null, previousId: r.previous || null,
			status: r.status || "D", effectiveDate: r.effective || null, expiryDate: r.expiry || null, issuedDate: r.issued || null, permitNo: r.permit_no || "",
		};
	}

	/**
	 * Đánh giá giấy phép cho kỳ: chỉ người nước ngoài. NotCovered / PartiallyCovered chặn tính lương khi bật wp_blocks;
	 * ExpiringSoon chỉ cảnh báo; Valid không cảnh báo.
	 */
	function payrollCheck(permits, ps, pe, reminderDays, blocks) {
		const r = Evaluator.evaluate(permits, ps, pe, reminderDays === undefined || reminderDays === null ? DEFAULTS.reminderDays : reminderDays);
		const C = Evaluator.COVERAGE;
		let warning = null;
		if (r.coverage === C.NONE) warning = { code: "WorkPermit", message: "The foreign worker has no valid work permit for the pay period.", messageVi: "Người lao động nước ngoài không có giấy phép lao động hiệu lực trong kỳ." };
		else if (r.coverage === C.PARTIAL) warning = { code: "WorkPermit", message: `The work permit covers only part of the pay period (to ${Dates.vn(r.coveredTo)}).`, messageVi: `Giấy phép lao động chỉ phủ một phần kỳ lương (đến ${Dates.vn(r.coveredTo)}).` };
		else if (r.coverage === C.EXPIRING) warning = { code: "WorkPermit", message: `The work permit ${r.refNbr} expires on ${Dates.vn(r.coveredTo)} (${r.days} days after the period end).`, messageVi: `Giấy phép lao động ${r.refNbr} hết hạn ngày ${Dates.vn(r.coveredTo)} (còn ${r.days} ngày sau cuối kỳ).` };
		const blocking = !!blocks && (r.coverage === C.NONE || r.coverage === C.PARTIAL);
		return Object.assign({}, r, { warning, blocking });
	}

	/** Record alloc_version + alloc_line -> phiên bản lõi (AllocationSourceResolver). Chi nhánh = location, work center = class. */
	function versionFromRecords(v, lines) {
		return {
			id: v.id, versionNbr: Number(v.version) || 0, status: v.status || "D", effectiveDate: v.effective || null, expirationDate: v.expiration || null,
			usedByReleasedBatch: !!v.used, reason: v.reason || "", totalPercent: v.total || 0,
			lines: (lines || []).map((l) => ({
				id: l.id, project: l.project || "", task: "", costCode: "", branch: l.location || "", workCenter: l.work_center || "", sub: l.department || "", percent: Number(l.percent) || 0,
			})),
		};
	}

	/** Dòng lõi -> giá trị record alloc_line. */
	function lineToRecord(l) {
		return { project: l.project || null, department: l.sub || l.department || null, location: l.branch || l.location || null, work_center: l.workCenter || l.work_center || null, percent: Number(l.percent) };
	}

	/**
	 * Ngày cuối kỳ muộn nhất của bảng lương đã ghi sổ (R) có dòng phân bổ nguồn P của nhân viên (4.5.3 Activate).
	 * @param {Array<{status, periodEnd, allocations: Array<{source, version}>}>} batches dòng bảng lương của nhân viên
	 */
	function lastReleasedPlanEnd(batches) {
		let last = null;
		for (const b of batches || []) {
			if (b.status !== "R") continue;
			if (!(b.allocations || []).some((a) => a.source === "P")) continue;
			if (!last || Dates.cmp(b.periodEnd, last) > 0) last = b.periodEnd;
		}
		return last;
	}

	/** Số phiên bản đã dùng bởi dòng phân bổ nguồn P (để đánh dấu UsedByReleasedBatch khi ghi sổ). */
	function usedVersions(allocations) {
		return [...new Set((allocations || []).filter((a) => a.source === "P" && a.version !== null && a.version !== undefined).map((a) => Number(a.version)))];
	}

	return { DEFAULTS, permitFromRecord, payrollCheck, versionFromRecords, lineToRecord, lastReleasedPlanEnd, usedVersions };
});
