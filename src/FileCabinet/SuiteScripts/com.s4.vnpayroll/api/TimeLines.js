/**
 * Giờ công tính lương (VP312000, đặc tả 3.7, 3.8): đọc bản ghi Time (timesheet) của NetSuite trong cửa sổ kết công của kỳ,
 * gộp theo nhân viên + dự án + công việc thành dòng customrecord_s4vp_batch_time, đồng bộ lại giữ giờ HR đã sửa
 * (TimesheetSync.plan). Chi tiết từng ngày đọc trực tiếp từ Time, không lưu.
 *
 * Kiểm tra trạng thái bảng lương (sửa được, kỳ mở) nằm ở api/Payroll; module này chỉ đọc / ghi dữ liệu giờ.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "../core/TimesheetSync", "../core/Dates"], (Store, Sync, Dates) => {
	const blank = (v) => v === null || v === undefined || v === "";

	/** Trạng thái duyệt của dòng Time: A đã duyệt, R từ chối, P chờ duyệt / mở, N không dùng duyệt. */
	function approvalOf(row) {
		if (blank(row.c_status)) return "N";
		const text = String(row.c_status_name || "").toLowerCase();
		if (/reject|từ chối/.test(text)) return "R";
		if (/approved|đã duyệt|phê duyệt|chấp thuận/.test(text) && !/pending|chờ/.test(text)) return "A";
		return "P";
	}

	/**
	 * Dòng Time của các nhân viên trong [from, to] (yyyy-mm-dd), sắp theo nhân viên, ngày.
	 * @returns {Array<{id, employee, date, hours, project, projectName, task, taskName, approval, statusName, memo}>}
	 */
	function entries(employeeIds, from, to) {
		const ids = [...new Set((employeeIds || []).filter((x) => !blank(x)).map(String))];
		const out = [];
		for (let i = 0; i < ids.length; i += 900) {
			const part = ids.slice(i, i + 900);
			const rows = Store.run(
				`SELECT t.id, t.employee AS c_employee, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS c_date, t.hours AS c_hours, t.customer AS c_project,
					BUILTIN.DF(t.customer) AS c_project_name, t.casetaskevent AS c_task, BUILTIN.DF(t.casetaskevent) AS c_task_name,
					t.approvalstatus AS c_status, BUILTIN.DF(t.approvalstatus) AS c_status_name, t.memo AS c_memo
				FROM timebill t
				WHERE t.employee IN (${part.map(() => "?").join(",")}) AND t.trandate >= TO_DATE(?, 'YYYY-MM-DD') AND t.trandate <= TO_DATE(?, 'YYYY-MM-DD')
				ORDER BY t.employee, t.trandate, t.id`,
				part.concat([from, to]),
				"s4vp_timebill"
			);
			for (const r of rows) {
				out.push({
					id: String(r.id), employee: String(r.c_employee), date: r.c_date, hours: Sync.parseHours(r.c_hours), project: blank(r.c_project) ? "" : String(r.c_project),
					projectName: r.c_project_name || "", task: blank(r.c_task) ? "" : String(r.c_task), taskName: r.c_task_name || "", approval: approvalOf(r),
					statusName: r.c_status_name || "", memo: r.c_memo || "",
				});
			}
		}
		return out;
	}

	/**
	 * Giờ được nhận vào lương: đã duyệt; nếu thiết lập không bắt buộc duyệt thì mọi dòng trừ dòng bị từ chối.
	 * Account không dùng duyệt Time (mọi dòng không có trạng thái) thì nhận tất cả.
	 */
	function accepted(list, requireApproval) {
		const usesApproval = list.some((e) => e.approval !== "N");
		return list.filter((e) => (!usesApproval ? true : requireApproval ? e.approval === "A" : e.approval !== "R"));
	}

	/** Cửa sổ kết công của kỳ: [time_from, time_to] nếu có, ngược lại [đầu kỳ, cuối kỳ]. */
	function windowOf(period) {
		return { from: Dates.iso(period.time_from || period.start), to: Dates.iso(period.time_to || period.end) };
	}

	function forBatch(batchId) {
		return Store.find("batch_time", { where: "{batch} = ?", params: [batchId] });
	}

	/**
	 * Nạp giờ công: gộp Time đã nhận, so với dòng đang có (TimesheetSync.plan), thêm / sửa / xóa dòng nguồn timesheet.
	 * Dòng HR đã sửa giờ được giữ; dòng nhập tay (nguồn M) không đụng tới.
	 * @returns {{entries: number, accepted: number, inserted: number, updated: number, deleted: number, pending: number}}
	 */
	function sync(batchId, period, employeeIds, requireApproval) {
		const w = windowOf(period);
		const all = entries(employeeIds, w.from, w.to);
		const ok = accepted(all, requireApproval);
		const groups = Sync.aggregate(ok);
		const byKey = {};
		for (const g of groups) byKey[g.key] = g;
		const source = {};
		for (const g of groups) source[g.key] = g.hours;
		const existing = forBatch(batchId).filter((l) => employeeIds.includes(l.employee));
		const plan = Sync.plan(existing.map((l) => ({ lineId: l.id, sourceId: l.source === "A" ? l.source_key : null, source: l.source || "A", sourceHours: l.source_hours || 0, hours: l.hours || 0 })), source);
		for (const u of plan.updates) {
			const l = existing.find((x) => x.id === u.lineId);
			const g = byKey[l.source_key] || {};
			Store.submit("batch_time", u.lineId, { source_hours: u.sourceHours, hours: u.hours, entries: g.entries || 0 });
		}
		for (const id of plan.deletes) Store.remove("batch_time", id);
		for (const ins of plan.inserts) {
			const g = byKey[ins.sourceId];
			Store.create("batch_time", {
				batch: batchId, employee: g.employee, source: "A", source_key: g.key, project: g.project, project_name: g.projectName, task: g.task, task_name: g.taskName,
				entries: g.entries, source_hours: ins.hours, hours: ins.hours, reason: "",
			});
		}
		return { entries: all.length, accepted: ok.length, inserted: plan.inserts.length, updated: plan.updates.length, deleted: plan.deletes.length, pending: all.length - ok.length };
	}

	/** Sửa giờ tính lương; giờ khác giờ timesheet thì bắt buộc lý do (TimesheetSync.requiresReason). */
	function save(line, hours, reason) {
		const h = Sync.parseHours(hours);
		if (!(h >= 0)) throw new Error("Hours cannot be negative / Số giờ không được âm");
		if (Sync.requiresReason({ hours: h, sourceHours: line.source_hours || 0 }) && blank(String(reason || "").trim())) {
			const e = new Error("A reason is required when payroll hours differ from the timesheet / Cần ghi lý do khi giờ tính lương khác giờ timesheet");
			e.userMessage = { en: "A reason is required when payroll hours differ from the timesheet", vi: "Cần ghi lý do khi giờ tính lương khác giờ timesheet" };
			throw e;
		}
		Store.submit("batch_time", line.id, { hours: h, reason: String(reason || "").trim().slice(0, 300) });
	}

	function removeFor(batchId, employee) {
		for (const l of forBatch(batchId).filter((x) => x.employee === String(employee))) Store.remove("batch_time", l.id);
	}

	/** Dòng giờ thường cho bộ tính (timeLines không OT): phân bổ dự án theo giờ, số giờ của nhân viên lương giờ. */
	function forPayroll(batchId, periodEnd) {
		const out = {};
		for (const l of forBatch(batchId)) {
			if (!(Number(l.hours) > 0)) continue;
			(out[l.employee] = out[l.employee] || []).push({ date: periodEnd, isOvertime: false, dayType: "N", hours: Number(l.hours), project: l.project || "", task: l.task || "", sourceId: l.source_key || l.id });
		}
		return out;
	}

	return { entries, accepted, approvalOf, windowOf, forBatch, sync, save, removeFor, forPayroll };
});
