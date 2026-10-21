/**
 * Tính bảng lương lớn (đặc tả 5.4 giới hạn governance): reduce theo lô 25 dòng nhân viên, mỗi lô chỉ tính và ghi dòng
 * (Payroll.calculate với skipFinish); summarize cộng tổng toàn bảng, đặt trạng thái và gỡ khóa job. Bảng lương được đưa
 * vào hàng đợi bằng Payroll.markQueued (chưa tính, job = id tác vụ) nên không duyệt / ghi sổ được khi lô còn đang chạy.
 * Có lô lỗi (governance, timeout) thì dòng của lô đó còn số cũ: bảng không được coi là đã tính.
 * Tham số custscript_s4vp_mr_batch = id bảng lương.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "../api/Payroll"], (runtime, log, Payroll) => {
	// Mỗi lô nạp lại ngữ cảnh bảng lương (tham số, quy tắc, hồ sơ...): tính ở bước reduce (giới hạn 5.000 đơn vị),
	// không ở map (1.000 đơn vị - đã vượt khi thử trên account với 4 nhân viên)
	const CHUNK = 25;

	function batchId() {
		return String(runtime.getCurrentScript().getParameter({ name: "custscript_s4vp_mr_batch" }) || "");
	}

	function getInputData() {
		const id = batchId();
		const ids = Payroll.lines(id).map((l) => l.id);
		const chunks = [];
		for (let i = 0; i < ids.length; i += CHUNK) chunks.push({ batch: id, lineIds: ids.slice(i, i + CHUNK) });
		return chunks;
	}

	function map(context) {
		// Mỗi lô một khóa riêng để reduce chạy song song từng lô
		context.write({ key: String(context.key), value: context.value });
	}

	function reduce(context) {
		for (const value of context.values) {
			const v = JSON.parse(value);
			const r = Payroll.calculate(v.batch, { lineIds: v.lineIds, skipFinish: true, fromJob: true });
			context.write({ key: context.key, value: JSON.stringify(r.errors || []) });
		}
	}

	function summarize(summary) {
		const id = batchId();
		const errors = [];
		let failedChunks = 0;
		summary.output.iterator().each((key, value) => {
			errors.push(...JSON.parse(value));
			return true;
		});
		const countError = (key, error) => {
			failedChunks++;
			let msg = error;
			try {
				msg = JSON.parse(error).message || error;
			} catch (e) {
				// giữ nguyên chuỗi lỗi
			}
			errors.push(String(msg));
			return true;
		};
		summary.mapSummary.errors.iterator().each(countError);
		summary.reduceSummary.errors.iterator().each(countError);
		if (summary.inputSummary.error) {
			failedChunks++;
			errors.push(String(summary.inputSummary.error));
		}
		try {
			Payroll.finishCalculation(id, errors, false, failedChunks);
		} finally {
			Payroll.clearJob(id);
		}
		log.audit({ title: "s4vp_mr_calculate", details: `batch ${id}: ${errors.length} error(s), ${failedChunks} failed chunk(s)` });
	}

	return { getInputData, map, reduce, summarize };
});
