/**
 * Bảng tỷ lệ phân bổ chi phí lương có phiên bản (VP205000, đặc tả 4.5.3): tạo bản nháp, sửa dòng, kích hoạt, đánh dấu
 * phiên bản đã dùng bởi bảng lương ghi sổ, cấp phiên bản cho tính lương. Chi nhánh = Location, work center = Class,
 * tiểu khoản = Department (ánh xạ của gói, docs/ARCHITECTURE.md mục 4).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "../core/Dates", "../core/Money", "../core/AllocationSourceResolver", "../core/PlanRecords"], (runtime, Store, Dates, Money, Resolver, Plan) => {
	const blank = (v) => v === null || v === undefined || v === "";

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	/** Mọi phiên bản (kèm dòng) của các nhân viên, dạng lõi; theo id nhân viên. */
	function versionsOf(employeeIds) {
		const ids = [...new Set((employeeIds || []).filter((x) => !blank(x)).map(String))];
		const out = {};
		if (!ids.length) return out;
		const vs = Store.findIn("alloc_version", "employee", ids);
		const lines = {};
		for (const l of Store.findIn("alloc_line", "version", vs.map((v) => v.id))) (lines[l.version] = lines[l.version] || []).push(l);
		for (const v of vs) (out[v.employee] = out[v.employee] || []).push(Object.assign(Plan.versionFromRecords(v, lines[v.id] || []), { employee: v.employee }));
		for (const e of Object.keys(out)) out[e].sort((a, b) => a.versionNbr - b.versionNbr);
		return out;
	}

	function getVersion(id) {
		const v = Store.get("alloc_version", id);
		if (!v) throw fail("Allocation plan version not found", "Không tìm thấy phiên bản bảng tỷ lệ");
		return v;
	}

	function list(employee) {
		return versionsOf([employee])[String(employee)] || [];
	}

	/** Bản nháp mới, chép dòng của phiên bản Active (không có thì mới nhất). */
	function newVersion(employee, reason) {
		if (blank(employee)) throw fail("Employee is required", "Chưa chọn nhân viên");
		const existing = list(employee);
		if (existing.some((v) => v.status === "D")) throw fail("The employee already has a draft version", "Nhân viên đã có bản nháp");
		const nv = Resolver.newVersion(existing);
		const id = Store.create("alloc_version", { employee, version: nv.versionNbr, status: "D", reason: reason || "", total: Money.sum(nv.lines, (l) => l.percent).toNumber(), used: false });
		for (const l of nv.lines) Store.create("alloc_line", Object.assign({ version: id }, Plan.lineToRecord(l)));
		return { id, versionNbr: nv.versionNbr, lines: nv.lines.length };
	}

	/** Thay toàn bộ dòng của bản nháp. Bản nháp được lưu dở (chỉ chặn lỗi dòng), tổng 100% kiểm khi kích hoạt. */
	function saveLines(versionId, lines, reason) {
		const v = getVersion(versionId);
		if (v.status !== "D") throw fail("Only draft versions can be edited", "Chỉ sửa được bản nháp");
		if (v.used) throw fail("The version is used by a released payroll batch", "Phiên bản đã dùng bởi bảng lương ghi sổ");
		const core = (lines || []).map((l) => ({ project: l.project || "", task: "", costCode: "", branch: l.location || l.branch || "", workCenter: l.work_center || l.workCenter || "", sub: l.department || l.sub || "", percent: Number(l.percent) }));
		const errs = Resolver.validateLines(core, false).filter((m) => !/ít nhất một dòng/.test(m));
		if (errs.length) throw fail(errs.join(" "), errs.join(" "));
		for (const old of Store.find("alloc_line", { where: "{version} = ?", params: [versionId] })) Store.remove("alloc_line", old.id);
		for (const l of core) Store.create("alloc_line", Object.assign({ version: versionId }, Plan.lineToRecord(l)));
		const total = Money.sum(core, (l) => l.percent).toNumber();
		Store.submit("alloc_version", versionId, Object.assign({ total }, reason !== undefined ? { reason } : {}));
		return { id: versionId, total };
	}

	/** Ngày cuối kỳ muộn nhất của bảng lương đã ghi sổ có dòng phân bổ nguồn P của nhân viên. */
	function lastReleasedPlanEnd(employee) {
		const rows = Store.find("batch_emp", { where: "{employee} = ?", params: [employee] });
		if (!rows.length) return null;
		const batches = {};
		for (const b of Store.findIn("batch", "id", rows.map((r) => r.batch))) batches[b.id] = b;
		const periods = {};
		for (const p of Store.findIn("period", "id", Object.values(batches).map((b) => b.period))) periods[p.id] = p;
		return Plan.lastReleasedPlanEnd(rows.map((r) => {
			const b = batches[r.batch] || {};
			let d = {};
			try {
				d = r.detail ? JSON.parse(r.detail) : {};
			} catch (e) {
				d = {};
			}
			return { status: b.status, periodEnd: (periods[b.period] || {}).end, allocations: d.allocations || [] };
		}).filter((x) => x.periodEnd));
	}

	/** Kích hoạt bản nháp (Activate): phiên bản Active cũ -> Superseded, hết hạn ngày trước ngày hiệu lực mới. */
	function activate(versionId, effective) {
		const v = getVersion(versionId);
		const versions = list(v.employee);
		const me = versions.find((x) => x.id === String(versionId));
		const user = runtime.getCurrentUser();
		const res = Resolver.activateVersion(versions, me.versionNbr, Dates.iso(effective), {
			lastReleasedPeriodEnd: lastReleasedPlanEnd(v.employee), user: user && user.id > 0 ? String(user.id) : null, date: Dates.iso(new Date()),
		});
		const before = {};
		for (const x of versions) before[x.id] = x;
		for (const x of res) {
			const b = before[x.id];
			if (x.id === me.id) {
				Store.submit("alloc_version", x.id, { status: "A", effective: x.effectiveDate, expiration: null, activated_by: x.activatedBy, activated_date: x.activatedDate, total: x.totalPercent });
			} else if (b && (b.status !== x.status || b.expirationDate !== x.expirationDate)) {
				Store.submit("alloc_version", x.id, { status: x.status, expiration: x.expirationDate });
			}
		}
		return { id: me.id, status: "A", effective: Dates.iso(effective) };
	}

	/** Xóa bản nháp (chỉ bản nháp chưa dùng). */
	function removeDraft(versionId) {
		const v = getVersion(versionId);
		if (v.status !== "D" || v.used) throw fail("Only unused drafts can be deleted", "Chỉ xóa được bản nháp chưa dùng");
		for (const l of Store.find("alloc_line", { where: "{version} = ?", params: [versionId] })) Store.remove("alloc_line", l.id);
		Store.remove("alloc_version", versionId);
		return { ok: true };
	}

	/**
	 * Phiên bản cho tính lương (đúng cấu trúc versions của AllocationSourceResolver.resolve).
	 * @returns {Object<string, Array<{versionNbr, status, effectiveDate, expirationDate, usedByReleasedBatch, lines}>>}
	 */
	function forPayroll(employeeIds) {
		return versionsOf(employeeIds);
	}

	/**
	 * Đánh dấu phiên bản đã dùng bởi bảng lương ghi sổ (gọi khi Release).
	 * @param {Array<{employee, versionNbr}>|Object<string, number[]>} used theo nhân viên: số phiên bản (từ allocations nguồn P)
	 */
	function markUsed(used) {
		const pairs = Array.isArray(used) ? used : Object.entries(used || {}).flatMap(([employee, nbrs]) => (nbrs || []).map((versionNbr) => ({ employee, versionNbr })));
		if (!pairs.length) return { marked: 0 };
		const by = versionsOf(pairs.map((p) => p.employee));
		let marked = 0;
		for (const p of pairs) {
			const v = (by[String(p.employee)] || []).find((x) => x.versionNbr === Number(p.versionNbr));
			if (v && !v.usedByReleasedBatch) {
				Store.submit("alloc_version", v.id, { used: true });
				v.usedByReleasedBatch = true;
				marked++;
			}
		}
		return { marked };
	}

	return { list, newVersion, saveLines, activate, removeDraft, forPayroll, markUsed, lastReleasedPlanEnd };
});
