/**
 * Tính bảng lương lớn (đặc tả 5.4 giới hạn governance): map theo lô 50 dòng nhân viên, mỗi lô gọi Payroll.calculate
 * với lineIds; summarize cộng tổng toàn bảng và đặt trạng thái. Tham số custscript_s4vp_mr_batch = id bảng lương.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "../api/Payroll", "../api/Store"], (runtime, log, Payroll, Store) => {
	const CHUNK = 50;

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
		const v = JSON.parse(context.value);
		const r = Payroll.calculate(v.batch, { lineIds: v.lineIds });
		context.write({ key: v.batch, value: JSON.stringify(r.errors || []) });
	}

	function summarize(summary) {
		const id = batchId();
		const errors = [];
		summary.output.iterator().each((key, value) => {
			errors.push(...JSON.parse(value));
			return true;
		});
		summary.mapSummary.errors.iterator().each((key, error) => {
			errors.push(String(JSON.parse(error).message || error));
			return true;
		});
		Payroll.finishCalculation(id, errors, false);
		Store.submit("batch", id, { job: "" });
		log.audit({ title: "s4vp_mr_calculate", details: `batch ${id}: ${errors.length} error(s)` });
	}

	return { getInputData, map, summarize };
});
