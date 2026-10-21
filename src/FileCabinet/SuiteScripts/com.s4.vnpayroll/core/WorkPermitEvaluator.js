/**
 * Giấy phép lao động người nước ngoài (đặc tả mục 3.9; VP204000, NĐ 219/2025/NĐ-CP).
 *
 * Loại cấp (IssueType): N cấp mới, X gia hạn, R cấp lại (giữ thời hạn giấy cũ). Trạng thái: D Preparing,
 * S Submitted, A Active, E Expired, V Revoked. Tham số mặc định: MaxTermMonths 24, MaxExtensions 1, ReminderDays 60.
 * Đánh giá cho kỳ lương: Valid, ExpiringSoon (cảnh báo), PartiallyCovered, NotCovered (cảnh báo hoặc chặn tính lương
 * khi bật WorkPermitBlocksPayroll).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./Errors"], (Dates, Errors) => {
	const COVERAGE = { VALID: "Valid", EXPIRING: "ExpiringSoon", PARTIAL: "PartiallyCovered", NONE: "NotCovered" };

	/** Hạn tối đa: Effective + MaxTermMonths tháng - 1 ngày. */
	function maxExpiry(effective, maxTermMonths) {
		return Dates.addDays(Dates.addMonths(effective, Number(maxTermMonths)), -1);
	}

	/** Kiểm tra thời hạn; trả null nếu hợp lệ, ngược lại lỗi {message, messageVi}. */
	function validateTerm(effective, expiry, maxTermMonths) {
		if (Dates.cmp(expiry, effective) < 0) return { message: "The expiry date cannot be earlier than the effective date.", messageVi: "Ngày hết hạn không được trước ngày hiệu lực." };
		if (Number(maxTermMonths) > 0) {
			const max = maxExpiry(effective, maxTermMonths);
			if (Dates.cmp(expiry, max) > 0) {
				return { message: `The term exceeds ${maxTermMonths} months; the latest expiry date is ${Dates.vn(max)}.`, messageVi: `Thời hạn vượt ${maxTermMonths} tháng; ngày hết hạn muộn nhất là ${Dates.vn(max)}.` };
			}
		}
		return null;
	}

	/**
	 * Đếm số giấy gia hạn trong chuỗi tính từ giấy này đi ngược theo previousRefNbr: X đếm, R đi tiếp không đếm, N dừng,
	 * gặp vòng lặp thì dừng.
	 * @param {Object} permit {refNbr, issueType, previousRefNbr}
	 * @param {Object|Map} byRef refNbr -> giấy
	 */
	function countExtensions(permit, byRef) {
		const get = (r) => (byRef instanceof Map ? byRef.get(r) : byRef[r]);
		const seen = new Set();
		let n = 0;
		let cur = permit;
		while (cur && !seen.has(cur.refNbr)) {
			seen.add(cur.refNbr);
			if (cur.issueType === "X") n++;
			else if (cur.issueType === "N") break;
			cur = cur.previousRefNbr ? get(cur.previousRefNbr) : null;
		}
		return n;
	}

	/** Kiểm tra chuỗi khi lưu: giấy không phải cấp mới phải có giấy trước; gia hạn vượt MaxExtensions là lỗi. */
	function validateChain(permit, byRef, maxExtensions) {
		if (permit.issueType !== "N" && !permit.previousRefNbr) return { message: "Select the previous permit for an extension or reissue.", messageVi: "Chọn giấy phép trước cho giấy gia hạn hoặc cấp lại." };
		if (permit.issueType === "X" && countExtensions(permit, byRef) > Number(maxExtensions)) {
			return { message: `A permit can be extended at most ${maxExtensions} time(s).`, messageVi: `Giấy phép chỉ được gia hạn tối đa ${maxExtensions} lần.` };
		}
		return null;
	}

	/** Giấy gia hạn mới: hiệu lực = ngày sau hết hạn giấy cũ, hết hạn = hiệu lực + MaxTermMonths tháng - 1 ngày. */
	function extensionTerm(previous, maxTermMonths) {
		const eff = Dates.addDays(previous.expiryDate, 1);
		return { effectiveDate: eff, expiryDate: maxExpiry(eff, maxTermMonths) };
	}

	/** Trạng thái khi Mark as Issued: Expired nếu đã hết hạn so với hôm nay, ngược lại Active. */
	function issuedStatus(expiry, today) {
		return Dates.cmp(expiry, today) < 0 ? "E" : "A";
	}

	/**
	 * Đánh giá giấy phép cho kỳ lương [ps, pe].
	 * @param {Array<{refNbr, status, effectiveDate, expiryDate}>} permits giấy của nhân viên
	 * @returns {{coverage: string, days: number|null, refNbr: string|null, coveredTo: string|null}}
	 */
	function evaluate(permits, ps, pe, reminderDays) {
		const valid = (permits || []).filter((p) => (p.status === "A" || p.status === "E") && p.effectiveDate && p.expiryDate && Dates.cmp(p.expiryDate, p.effectiveDate) >= 0);
		const active = valid.filter((p) => Dates.cmp(p.effectiveDate, pe) <= 0 && Dates.cmp(p.expiryDate, ps) >= 0);
		if (!active.length) return { coverage: COVERAGE.NONE, days: null, refNbr: null, coveredTo: null };
		let covered = true;
		for (let t = Dates.toDay(ps), e = Dates.toDay(pe); t <= e && covered; t++) {
			const d = Dates.fromDay(t);
			covered = active.some((p) => Dates.within(d, p.effectiveDate, p.expiryDate));
		}
		const byExpiryDesc = (a, b) => Dates.cmp(b.expiryDate, a.expiryDate);
		const atEndCandidates = active.filter((p) => Dates.cmp(p.expiryDate, pe) >= 0).sort(byExpiryDesc);
		let cur = atEndCandidates[0] || active.slice().sort(byExpiryDesc)[0];
		let coveredTo = cur.expiryDate;
		const guard = new Set([cur.refNbr]);
		for (;;) {
			const next = valid
				.filter((p) => Dates.cmp(p.effectiveDate, Dates.addDays(coveredTo, 1)) <= 0 && Dates.cmp(p.expiryDate, coveredTo) > 0)
				.sort(byExpiryDesc)[0];
			if (!next || guard.has(next.refNbr)) break;
			guard.add(next.refNbr);
			cur = next;
			coveredTo = next.expiryDate;
		}
		const days = Dates.diff(pe, coveredTo);
		const coverage = !covered ? COVERAGE.PARTIAL : days <= Number(reminderDays) ? COVERAGE.EXPIRING : COVERAGE.VALID;
		return { coverage, days, refNbr: cur.refNbr, coveredTo };
	}

	return { COVERAGE, maxExpiry, validateTerm, countExtensions, validateChain, extensionTerm, issuedStatus, evaluate };
});
