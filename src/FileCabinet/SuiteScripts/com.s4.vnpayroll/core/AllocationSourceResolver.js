/**
 * Chọn nguồn trọng số phân bổ chi phí lương (AllocationSourceResolver, đặc tả mục 4.5.2) và bảng tỷ lệ có phiên bản
 * (VP205000, mục 4.5.3).
 *
 * Phương pháp: T timesheet, F bảng tỷ lệ cố định, R phân ca. Fallback: P bảng tỷ lệ rồi dự án mặc định, D dự án mặc
 * định. Chế độ phiên bản: E phiên bản hiệu lực cuối kỳ, D chia theo số ngày lịch.
 * Phiên bản: {versionNbr, status (D/A/S), effectiveDate, expirationDate, usedByReleasedBatch,
 *             lines: [{project, task, costCode, branch, workCenter, percent}]}.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./Errors"], (Money, Dates, Errors) => {
	const D = Money.D;
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const blank = (s) => norm(s) === "";

	/** Số ngày lịch của phiên bản nằm trong [from, to]. */
	function daysWithin(v, from, to) {
		if (!v.effectiveDate) return 0;
		const s = Dates.max(v.effectiveDate, from);
		const e = Dates.min(v.expirationDate || to, to);
		const n = Dates.diff(s, e) + 1;
		return n > 0 ? n : 0;
	}

	function usable(v, from, to) {
		return norm(v.status) !== "D" && !!v.effectiveDate && (v.lines || []).length > 0 && daysWithin(v, from, to) > 0;
	}

	/** Đích từ bảng tỷ lệ (nguồn P). */
	function planTargets(versions, mode, from, to) {
		const list = (versions || []).filter((v) => usable(v, from, to));
		if (!list.length) return [];
		const toTarget = (v, l, weight) => ({
			project: l.project || "", task: l.task || "", costCode: l.costCode || "", branch: l.branch || "", workCenter: l.workCenter || "",
			source: "P", version: v.versionNbr, weight, hours: 0,
		});
		if (norm(mode) === "D") {
			const periodDays = Dates.diff(from, to) + 1;
			const out = [];
			for (const v of list) {
				const share = D(daysWithin(v, from, to)).div(periodDays);
				for (const l of v.lines) out.push(toTarget(v, l, Money.roundTo(D(l.percent).times(share), 6)));
			}
			return out;
		}
		const byEff = (a, b) => Dates.cmp(a.effectiveDate, b.effectiveDate);
		const atEnd = list.filter((v) => Dates.cmp(v.effectiveDate, to) <= 0 && (!v.expirationDate || Dates.cmp(v.expirationDate, to) >= 0)).sort(byEff);
		const v = atEnd.length ? atEnd[atEnd.length - 1] : [...list].sort(byEff)[list.length - 1];
		return v.lines.map((l) => toTarget(v, l, D(l.percent).toNumber()));
	}

	/**
	 * @param {{method, fallback, versionMode, periodStart, periodEnd, timeLines: Array<{project, task, costCode, hours}>,
	 *          versions: Array, rosterDays: Array<{date, shiftCode, branch, workCenter}>, defaultProject, defaultTask,
	 *          defaultBranch, defaultWorkCenter}} input
	 * @returns {Array} đích (chưa gộp)
	 */
	function resolve(input) {
		const ps = input.periodStart;
		const pe = input.periodEnd;
		if (Dates.cmp(pe, ps) < 0) throw Errors.invalid("The pay period end date is earlier than the start date.", "Ngày cuối kỳ trước ngày đầu kỳ.");
		const method = norm(input.method || "F");
		const fallback = norm(input.fallback || "P");
		let result = [];

		if (method === "T") {
			const groups = new Map();
			for (const t of input.timeLines || []) {
				if (D(t.hours).lte(0)) continue;
				const key = [t.project, t.task, t.costCode].map(norm).join("|");
				const g = groups.get(key) || { project: t.project || "", task: t.task || "", costCode: t.costCode || "", branch: "", workCenter: "", source: "T", version: null, weight: D(0), hours: D(0) };
				g.weight = g.weight.plus(D(t.hours));
				g.hours = g.hours.plus(D(t.hours));
				groups.set(key, g);
			}
			result = [...groups.values()].map((g) => Object.assign(g, { weight: g.weight.toNumber(), hours: g.hours.toNumber() }));
		}
		if (!result.length && method === "R") {
			const groups = new Map();
			for (const r of input.rosterDays || []) {
				if (blank(r.shiftCode)) continue;
				const branch = blank(r.branch) ? input.defaultBranch || "" : r.branch;
				const wc = blank(r.workCenter) ? input.defaultWorkCenter || "" : r.workCenter;
				if (blank(branch) && blank(wc)) continue;
				const key = ["", "", "", branch, wc].map(norm).join("|");
				const g = groups.get(key) || { project: "", task: "", costCode: "", branch, workCenter: wc, source: "R", version: null, weight: 0, hours: 0 };
				g.weight += 1;
				groups.set(key, g);
			}
			result = [...groups.values()];
		}
		if (!result.length && (method === "F" || fallback === "P")) {
			result = planTargets(input.versions, input.versionMode || "E", ps, pe);
		}
		if (!result.length) {
			result = [{ project: input.defaultProject || "", task: input.defaultProject ? input.defaultTask || "" : "", costCode: "", branch: "", workCenter: "", source: "D", version: null, weight: 100, hours: 0 }];
		}
		return result.map((t) => Object.assign({}, t, {
			branch: blank(t.branch) ? input.defaultBranch || "" : t.branch,
			workCenter: blank(t.workCenter) ? input.defaultWorkCenter || "" : t.workCenter,
		}));
	}

	/** Kiểm tra dòng phiên bản (4.5.3); requireTotal: phiên bản kích hoạt phải đủ 100%. Trả danh sách lỗi. */
	function validateLines(lines, requireTotal) {
		const errors = [];
		if (!(lines || []).length) errors.push("Phiên bản phải có ít nhất một dòng.");
		const seen = new Set();
		for (const l of lines || []) {
			if (blank(l.project) && blank(l.branch) && blank(l.workCenter)) errors.push("Mỗi dòng phải có dự án, chi nhánh hoặc work center.");
			const p = D(l.percent);
			if (p.lte(0) || p.gt(100)) errors.push("Tỷ lệ mỗi dòng phải lớn hơn 0 và không quá 100.");
			const key = [l.project, l.task, l.costCode, l.branch, l.workCenter].map(norm).join("|");
			if (seen.has(key)) errors.push("Đích phân bổ bị trùng.");
			seen.add(key);
		}
		if (requireTotal && !Money.sum(lines || [], (l) => l.percent).eq(100)) errors.push("Tổng tỷ lệ phải bằng 100%.");
		return errors;
	}

	/**
	 * Kích hoạt bản nháp (Activate). Trả danh sách phiên bản mới (không sửa đầu vào).
	 * @param {Array} versions
	 * @param {number} versionNbr bản nháp cần kích hoạt
	 * @param {string} effectiveDate
	 * @param {{lastReleasedPeriodEnd?: string, user?: string, date?: string}} [options]
	 */
	function activateVersion(versions, versionNbr, effectiveDate, options) {
		const opts = options || {};
		const list = (versions || []).map((v) => Object.assign({}, v));
		const draft = list.find((v) => v.versionNbr === versionNbr);
		if (!draft || norm(draft.status) !== "D") throw Errors.invalid("Only a draft version can be activated.", "Chỉ kích hoạt được bản nháp.");
		if (!effectiveDate) throw Errors.invalid("The effective date is required.", "Phải có ngày hiệu lực.");
		const errs = validateLines(draft.lines, true);
		if (errs.length) throw Errors.invalid(errs.join(" "), errs.join(" "));
		if (opts.lastReleasedPeriodEnd && Dates.cmp(effectiveDate, opts.lastReleasedPeriodEnd) <= 0) {
			throw Errors.invalid("The effective date falls in a period with a released payroll batch.", `Ngày hiệu lực phải sau ${Dates.vn(opts.lastReleasedPeriodEnd)} (kỳ đã có bảng lương ghi sổ dùng bảng tỷ lệ).`);
		}
		const active = list.find((v) => norm(v.status) === "A");
		if (active && Dates.cmp(effectiveDate, active.effectiveDate) <= 0) {
			throw Errors.invalid("The new effective date must be after the active version's effective date.", "Ngày hiệu lực mới phải sau ngày hiệu lực của phiên bản đang dùng.");
		}
		if (active) {
			active.status = "S";
			active.expirationDate = Dates.addDays(effectiveDate, -1);
		}
		draft.status = "A";
		draft.effectiveDate = Dates.iso(effectiveDate);
		draft.expirationDate = null;
		draft.activatedBy = opts.user || null;
		draft.activatedDate = opts.date || null;
		draft.totalPercent = Money.sum(draft.lines, (l) => l.percent).toNumber();
		return list;
	}

	/** Bản nháp mới chép dòng của phiên bản Active (không có thì phiên bản mới nhất). */
	function newVersion(versions) {
		const list = versions || [];
		const nbr = list.reduce((m, v) => Math.max(m, Number(v.versionNbr) || 0), 0) + 1;
		const src = list.find((v) => norm(v.status) === "A") || [...list].sort((a, b) => (Number(b.versionNbr) || 0) - (Number(a.versionNbr) || 0))[0];
		return { versionNbr: nbr, status: "D", effectiveDate: null, expirationDate: null, lines: src ? src.lines.map((l) => Object.assign({}, l)) : [] };
	}

	return { resolve, planTargets, daysWithin, validateLines, activateVersion, newVersion };
});
