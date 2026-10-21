/**
 * Đồng bộ giờ công tính lương với giờ timesheet gốc (đặc tả mục 3.8; TimesheetSync.Plan, VP312000).
 *
 * Dòng nguồn timesheet (Source A) giữ giờ HR đã sửa; dòng chưa sửa theo timesheet; dòng không còn nguồn: chưa sửa thì
 * xóa, đã sửa thì đặt SourceHours = 0 giữ giờ HR. Dòng nhập tay (Source M) không bị động đến.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money"], (Money) => {
	const h2 = (x) => Money.roundTo(x || 0, 2);

	/**
	 * @param {Array<{lineId, sourceId, source: "A"|"M", sourceHours, hours}>} existing
	 * @param {Object<string, number>|Map} source id activity -> giờ (đã làm tròn 2 số)
	 * @returns {{updates: Array<{lineId, sourceHours, hours}>, deletes: Array, inserts: Array<{sourceId, hours}>}}
	 */
	function plan(existing, source) {
		const src = source instanceof Map ? source : new Map(Object.entries(source || {}));
		const seen = new Set();
		const updates = [];
		const deletes = [];
		for (const line of existing || []) {
			if (line.source === "M" || line.sourceId === null || line.sourceId === undefined || line.sourceId === "") continue;
			const id = String(line.sourceId);
			const lh = h2(line.hours);
			const ls = h2(line.sourceHours);
			const adjusted = lh !== ls;
			if (!seen.has(id) && src.has(id)) {
				seen.add(id);
				const s = h2(src.get(id));
				const newHours = adjusted ? lh : s;
				if (s !== ls || newHours !== lh) updates.push({ lineId: line.lineId, sourceHours: s, hours: newHours });
				continue;
			}
			seen.add(id);
			if (!adjusted) deletes.push(line.lineId);
			else if (ls !== 0) updates.push({ lineId: line.lineId, sourceHours: 0, hours: lh });
		}
		const inserts = [];
		for (const [id, hours] of src) if (!seen.has(String(id))) inserts.push({ sourceId: String(id), hours: h2(hours) });
		return { updates, deletes, inserts };
	}

	/** Giờ tính lương khác giờ timesheet thì bắt buộc lý do (dòng tay có SourceHours = 0 nên cũng cần lý do). */
	function requiresReason(line) {
		return h2(line.hours) !== h2(line.sourceHours);
	}

	/** Số giờ từ bản ghi Time của NetSuite: số thập phân hoặc chuỗi thời lượng "h:mm". */
	function parseHours(v) {
		if (v === null || v === undefined || v === "") return 0;
		const m = /^(-?\d+):(\d{1,2})$/.exec(String(v).trim());
		if (m) return h2(Number(m[1]) + (Number(m[1]) < 0 ? -1 : 1) * Number(m[2]) / 60);
		const n = Number(String(v).replace(",", "."));
		return Number.isFinite(n) ? h2(n) : 0;
	}

	/**
	 * Gộp giờ timesheet đã duyệt theo nhân viên + dự án + công việc trong kỳ (một dòng giờ công tính lương mỗi nhóm).
	 * @param {Array<{employee, project?, projectName?, task?, taskName?, hours}>} entries
	 * @returns {Array<{key, employee, project, projectName, task, taskName, hours, entries}>} theo thứ tự key
	 */
	function aggregate(entries) {
		const groups = new Map();
		for (const e of entries || []) {
			const hours = parseHours(e.hours);
			if (!(hours > 0)) continue;
			const key = [e.employee, e.project || "", e.task || ""].map(String).join("|");
			const g = groups.get(key) || { key, employee: String(e.employee), project: String(e.project || ""), projectName: e.projectName || "", task: String(e.task || ""), taskName: e.taskName || "", hours: 0, entries: 0 };
			g.hours = h2(g.hours + hours);
			g.entries += 1;
			groups.set(key, g);
		}
		return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	}

	return { plan, requiresReason, parseHours, aggregate };
});
