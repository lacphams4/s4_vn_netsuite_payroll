/**
 * Dòng nhập tay của bảng lương: không sửa khi bảng đã duyệt / ghi sổ / đảo (4.2.9); sửa xong thì bảng lương về
 * "chưa tính" để phải tính lại trước khi duyệt (4.6.9). Lỗi ném chuỗi ngắn để NetSuite hiện gọn.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(["N/log", "../api/Store", "../api/Payroll"], (log, Store, Payroll) => {
	const LOCKED = ["A", "P", "R", "V", "J"];
	const FIELD = "custrecord_s4vp_bi_batch";

	function batchOf(context) {
		const rec = context.newRecord || context.oldRecord;
		const id = rec.getValue({ fieldId: FIELD }) || (context.oldRecord && context.oldRecord.getValue({ fieldId: FIELD }));
		return id ? Store.get("batch", id) : null;
	}

	function beforeSubmit(context) {
		const b = batchOf(context);
		if (b && LOCKED.includes(b.status)) throw `Bảng lương ${b.name} đang ở trạng thái ${b.status}, hãy mở lại trước khi sửa dòng nhập tay. / Reopen payroll batch ${b.name} before editing input lines.`;
	}

	function afterSubmit(context) {
		try {
			const b = batchOf(context);
			if (b) Payroll.markUncalculated(b);
		} catch (e) {
			log.error({ title: "s4vp_ue_batch_input", details: String(e.message || e) });
		}
	}

	return { beforeSubmit, afterSubmit };
});
