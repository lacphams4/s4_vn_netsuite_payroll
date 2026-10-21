/**
 * Chấm công chạy nền (đặc tả 3.5, 3.6; QC #16, #18): lập / khóa / mở khóa bảng tổng hợp công của kỳ và cấp phép năm
 * theo lô 50 nhân viên, tránh vượt governance của RESTlet với kỳ đông người.
 * Tham số: custscript_s4vp_mra_op (build | lock | unlock | accrue), custscript_s4vp_mra_period (id kỳ),
 * accrue thêm custscript_s4vp_mra_year, _policy, _rundate, _subsidiary.
 * Trạng thái công của kỳ chỉ đổi ở summarize khi mọi lô thành công; có lỗi thì giữ nguyên và ghi log.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "../api/Attendance", "../api/Store"], (runtime, log, Attendance, Store) => {
	// Làm việc ở reduce (5.000 đơn vị), không ở map (1.000 đơn vị): mỗi lô nạp lại ngữ cảnh kỳ
	const CHUNK = 25;

	function param(name) {
		return String(runtime.getCurrentScript().getParameter({ name }) || "");
	}

	function chunks(ids, extra) {
		const out = [];
		for (let i = 0; i < ids.length; i += CHUNK) out.push(Object.assign({ ids: ids.slice(i, i + CHUNK) }, extra));
		return out;
	}

	function getInputData() {
		const op = param("custscript_s4vp_mra_op");
		const period = param("custscript_s4vp_mra_period");
		if (op === "accrue") {
			const ids = Attendance.accrualProfiles(param("custscript_s4vp_mra_subsidiary") || null).map((p) => p.id);
			return chunks(ids, { op });
		}
		if (op === "unlock") {
			Attendance.unlockContext(period);
			return chunks(Attendance.unlockEmployees(period), { op, period });
		}
		if (op === "build" || op === "lock") {
			const ctx = Attendance.buildContext(period, { allowLocked: false });
			const ids = Attendance.eligibleProfiles(ctx).map((p) => p.employee);
			Attendance.cleanupStale(period, ids);
			return chunks(ids, { op, period });
		}
		throw new Error(`Unknown operation ${op}`);
	}

	function map(context) {
		context.write({ key: String(context.key), value: context.value });
	}

	function reduce(context) {
		for (const value of context.values) work(context, JSON.parse(value));
	}

	function work(context, v) {
		let r;
		if (v.op === "build") r = Attendance.buildChunk(v.period, v.ids);
		else if (v.op === "lock") r = Attendance.lockChunk(v.period, v.ids);
		else if (v.op === "unlock") r = Attendance.unlockChunk(v.period, v.ids);
		else if (v.op === "accrue") {
			const profiles = Store.findIn("employee", "id", v.ids);
			r = Attendance.accrueFor(Number(param("custscript_s4vp_mra_year")), param("custscript_s4vp_mra_policy") || null, param("custscript_s4vp_mra_rundate") || null, profiles);
			r = { employees: r.rows.length };
		}
		context.write({ key: `${v.op}-${context.key}`, value: String((r && r.employees) || 0) });
	}

	function summarize(summary) {
		const op = param("custscript_s4vp_mra_op");
		const period = param("custscript_s4vp_mra_period");
		try {
			finish(summary, op, period);
		} finally {
			// Gỡ cờ tác vụ nền của kỳ (hoặc cấp phép năm) để thao tác đồng bộ chạy lại được
			Attendance.clearQueued(op === "accrue" ? null : period);
		}
	}

	function finish(summary, op, period) {
		const errors = [];
		if (summary.inputSummary.error) errors.push(String(summary.inputSummary.error));
		const onError = (key, error) => {
			let msg = error;
			try {
				msg = JSON.parse(error).message || error;
			} catch (e) {
				// giữ nguyên chuỗi lỗi
			}
			errors.push(String(msg));
			return true;
		};
		summary.mapSummary.errors.iterator().each(onError);
		summary.reduceSummary.errors.iterator().each(onError);
		let count = 0;
		summary.output.iterator().each((key, value) => {
			count += Number(value) || 0;
			return true;
		});
		if (errors.length) {
			log.error({ title: `s4vp_mr_attendance ${op} ${period}`, details: errors.join(" | ").slice(0, 3900) });
			return;
		}
		if (op === "lock") Store.submit("period", period, { att_status: "L" });
		if (op === "unlock") {
			const c = Attendance.unlockContext(period);
			// Chứng từ của nhân viên không còn dòng tổng hợp vẫn được gỡ khóa
			Attendance.setSummaryLocked(c.period, false, c.otherLocked, null);
			Store.submit("period", period, { att_status: "O" });
		}
		log.audit({ title: `s4vp_mr_attendance ${op} ${period}`, details: `${count} employee(s)` });
	}

	return { getInputData, map, reduce, summarize };
});
