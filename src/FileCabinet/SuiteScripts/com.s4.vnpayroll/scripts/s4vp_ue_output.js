/**
 * Phiếu sản lượng và dòng, thành viên (đặc tả 4.3.3 - 4.3.4) khi sửa trên màn hình NetSuite, CSV import, web service:
 * chỉ sửa / xóa khi phiếu đang Tạm giữ; dòng sản lượng tự tính thành tiền = Round(Số lượng x Đơn giá); sau khi đổi dòng
 * hoặc thành viên thì cập nhật tổng phiếu. Thao tác của gói (RESTlet, Map/Reduce) tự kiểm trạng thái, script bỏ qua.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "../api/Schema", "../api/Store", "../api/Output", "../core/OutputEntries"], (runtime, log, Schema, Store, Output, Entries) => {
	const R = Schema.records;
	const HEADER = R.output.type;
	const PARENT = { [R.output_line.type]: R.output_line.fields.entry.id, [R.output_member.type]: R.output_member.fields.entry.id };
	const LOCKED = "Phiếu sản lượng không ở trạng thái Tạm giữ, không sửa / xóa được. / Only on-hold output entries can be changed or deleted.";

	function fromUser() {
		const c = runtime.executionContext;
		const E = runtime.ContextType;
		return [E.USER_INTERFACE, E.CSV_IMPORT, E.WEBSERVICES, E.REST_WEBSERVICES, E.SUITELET].filter(Boolean).includes(c);
	}

	function statusOfEntry(id) {
		const e = id ? Store.get("output", id) : null;
		return e ? e.status || "H" : "H";
	}

	function headerStatus(rec) {
		return Store.codeOf("output_status", rec.getValue({ fieldId: R.output.fields.status.id })) || "H";
	}

	function beforeSubmit(context) {
		if (!fromUser()) return;
		const T = context.UserEventType;
		const rec = context.newRecord || context.oldRecord;
		if (rec.type === HEADER) {
			if ((context.type === T.EDIT || context.type === T.XEDIT || context.type === T.DELETE) && headerStatus(context.oldRecord) !== "H") throw LOCKED;
			return;
		}
		const parentField = PARENT[rec.type];
		if (!parentField) return;
		const ids = [context.newRecord && context.newRecord.getValue({ fieldId: parentField }), context.oldRecord && context.oldRecord.getValue({ fieldId: parentField })].filter(Boolean);
		for (const id of ids) if (statusOfEntry(id) !== "H") throw LOCKED;
		// Dòng sản lượng: thành tiền tính lại
		if (rec.type === R.output_line.type && context.newRecord && context.type !== T.DELETE && context.type !== T.XEDIT) {
			const f = R.output_line.fields;
			const qty = context.newRecord.getValue({ fieldId: f.qty.id }) || 0;
			const rate = context.newRecord.getValue({ fieldId: f.rate.id }) || 0;
			if (Number(qty) < 0 || Number(rate) < 0) throw "Số lượng, đơn giá không được âm. / Quantity and rate cannot be negative.";
			context.newRecord.setValue({ fieldId: f.amount.id, value: Entries.lineAmount(qty, rate) });
		}
	}

	function afterSubmit(context) {
		if (!fromUser()) return;
		const rec = context.newRecord || context.oldRecord;
		const parentField = PARENT[rec.type];
		if (!parentField) return;
		try {
			const id = rec.getValue({ fieldId: parentField }) || (context.oldRecord && context.oldRecord.getValue({ fieldId: parentField }));
			if (id) Output.refreshTotals(String(id));
		} catch (e) {
			log.error({ title: "s4vp_ue_output totals", details: String(e.message || e) });
		}
	}

	return { beforeSubmit, afterSubmit };
});
