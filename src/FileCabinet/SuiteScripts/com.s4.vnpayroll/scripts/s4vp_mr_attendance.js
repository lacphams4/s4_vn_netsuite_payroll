/**
 * Chấm công chạy nền (đặc tả 3.5, 3.6; QC #16, #18): lập / khóa / mở khóa bảng tổng hợp công của kỳ, xử lý chấm công máy
 * và cấp phép năm theo lô nhân viên, tránh vượt governance của RESTlet với kỳ đông người.
 * Tham số: custscript_s4vp_mra_op (build | lock | unlock | punches | accrue), custscript_s4vp_mra_period (id kỳ),
 * accrue thêm custscript_s4vp_mra_year, _policy, _rundate, _subsidiary.
 * Trạng thái công của kỳ chỉ đổi ở summarize khi mọi lô thành công; có lỗi thì giữ nguyên và ghi log.
 * punches: kiểm tra kỳ và danh sách nhân viên ở getInputData (một lần); mỗi lô tự xóa chứng từ tạm giữ do lần trước sinh của
 * chính nhân viên trong lô rồi sinh lại (chạy lại một lô không sinh trùng); không đổi trạng thái kỳ.
 * summarize lưu kết quả (số đếm, lỗi) cho màn hình và gỡ cờ tác vụ nền của kỳ.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "../api/Attendance", "../api/Store", "../api/Shifts"], (runtime, log, Attendance, Store, Shifts) => {
	// Làm việc ở reduce (5.000 đơn vị), không ở map (1.000 đơn vị): mỗi lô nạp lại ngữ cảnh kỳ
	const CHUNK = 25;
	// Xử lý chấm công ghi nhiều record hơn: lô nhỏ hơn, cỡ lô khai báo cùng ngưỡng chạy nền ở api/Shifts
	const PUNCH_CHUNK = Shifts.PUNCH_CHUNK || 10;

	function param(name) {
		return String(runtime.getCurrentScript().getParameter({ name }) || "");
	}

	function chunks(ids, extra, size) {
		const n = size || CHUNK;
		const out = [];
		for (let i = 0; i < ids.length; i += n) out.push(Object.assign({ ids: ids.slice(i, i + n) }, extra));
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
		if (op === "punches") return chunks(Shifts.punchEmployees(period), { op, period }, PUNCH_CHUNK);
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
		else if (v.op === "punches") {
			r = Shifts.processPunchChunk(v.period, v.ids);
			context.write({ key: `${v.op}-${context.key}`, value: JSON.stringify(r) });
			return;
		} else if (v.op === "accrue") {
			const profiles = Store.findIn("employee", "id", v.ids);
			r = Attendance.accrueFor(Number(param("custscript_s4vp_mra_year")), param("custscript_s4vp_mra_policy") || null, param("custscript_s4vp_mra_rundate") || null, profiles);
			r = { employees: r.rows.length };
		}
		context.write({ key: `${v.op}-${context.key}`, value: String((r && r.employees) || 0) });
	}

	function summarize(summary) {
		const op = param("custscript_s4vp_mra_op");
		const period = param("custscript_s4vp_mra_period");
		let result = null;
		try {
			result = finish(summary, op, period);
		} catch (e) {
			result = { op, ok: false, errors: 1, message: String((e && e.message) || e).slice(0, 300) };
			throw e;
		} finally {
			// Lưu kết quả cho màn hình và gỡ cờ tác vụ nền của kỳ (hoặc cấp phép năm) để thao tác đồng bộ chạy lại được
			Attendance.finishJob(op === "accrue" ? null : period, result);
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
		const parts = [];
		summary.output.iterator().each((key, value) => {
			if (String(value).charAt(0) === "{") {
				try {
					parts.push(JSON.parse(value));
				} catch (e) {
					// bỏ qua dòng kết quả hỏng
				}
			} else count += Number(value) || 0;
			return true;
		});
		const punches = op === "punches" ? Shifts.mergePunchResults(parts) : null;
		if (punches) count = punches.employees;
		const result = { op, ok: !errors.length, employees: count, errors: errors.length };
		if (punches) Object.assign(result, { deleted: punches.deleted, exceptions: punches.exceptions, overtime: punches.overtime, kept: punches.kept });
		if (errors.length) {
			log.error({ title: `s4vp_mr_attendance ${op} ${period}`, details: errors.join(" | ").slice(0, 3900) });
			result.message = errors[0].slice(0, 300);
			return result;
		}
		if (op === "lock") Store.submit("period", period, { att_status: "L" });
		if (op === "unlock") {
			const c = Attendance.unlockContext(period);
			// Chứng từ của nhân viên không còn dòng tổng hợp vẫn được gỡ khóa
			Attendance.setSummaryLocked(c.period, false, c.otherLocked, null, c.ref.pg);
			Store.submit("period", period, { att_status: "O" });
		}
		log.audit({ title: `s4vp_mr_attendance ${op} ${period}`, details: punches ? `${count} employee(s), ${punches.exceptions} exception(s), ${punches.overtime} overtime request(s), ${punches.deleted} replaced` : `${count} employee(s)` });
		return result;
	}

	return { getInputData, map, reduce, summarize };
});
