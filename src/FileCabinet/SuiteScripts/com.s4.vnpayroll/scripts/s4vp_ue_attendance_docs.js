/**
 * Chứng từ công (đơn nghỉ, đơn OT, đơn công tác, phiếu ngoại lệ - đặc tả 3.4) khi sửa trên màn hình NetSuite, CSV
 * import hoặc web service: chỉ sửa / xóa được khi đang Tạm giữ và chưa khóa theo kỳ công; khi lưu ở Tạm giữ tự tính số
 * ngày, loại ngày, loại thu nhập OT, ngày bị trừ, kỳ. Thao tác duyệt đi qua api/Attendance (RESTlet), không qua script này.
 * Lỗi ném chuỗi ngắn song ngữ để NetSuite hiện gọn.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "../api/Schema", "../api/Store", "../api/Attendance"], (runtime, log, Schema, Store, Attendance) => {
	const TYPE_BY_RECORD = {};
	for (const [type, name] of Object.entries(Attendance.RECORD)) TYPE_BY_RECORD[Schema.records[name].type] = { type, name };

	// Chỉ kiểm soát thao tác của người dùng; script của gói (RESTlet, Map/Reduce) tự kiểm trạng thái
	function fromUser() {
		const c = runtime.executionContext;
		const E = runtime.ContextType;
		return [E.USER_INTERFACE, E.CSV_IMPORT, E.WEBSERVICES, E.REST_WEBSERVICES, E.SUITELET].includes(c);
	}

	function readValues(rec, name) {
		const out = { id: rec.id ? String(rec.id) : "" };
		for (const [key, f] of Object.entries(Schema.records[name].fields)) {
			let v = rec.getValue({ fieldId: f.id });
			if (f.type === "date" && v instanceof Date) v = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
			else if (f.type === "select" && f.target && f.target.startsWith("list:")) v = Store.codeOf(f.target.slice(5), v);
			else if (v === "") v = null;
			out[key] = v;
		}
		out.name = rec.getValue({ fieldId: "name" }) || "";
		return out;
	}

	function beforeSubmit(context) {
		const rec = context.newRecord || context.oldRecord;
		const map = TYPE_BY_RECORD[rec.type];
		if (!map || !fromUser()) return;
		const T = context.UserEventType;
		if (context.type === T.EDIT || context.type === T.XEDIT || context.type === T.DELETE) {
			const old = readValues(context.oldRecord, map.name);
			if ((old.status && old.status !== "H") || old.summary_locked) {
				throw "Chứng từ không ở trạng thái Tạm giữ hoặc đã khóa theo kỳ công, không sửa / xóa được. / Only on-hold, unlocked documents can be changed or deleted.";
			}
		}
		if (context.type === T.DELETE || context.type === T.XEDIT) return;
		const values = readValues(context.newRecord, map.name);
		if (values.status && values.status !== "H") return;
		try {
			const d = Attendance.derive(map.type, values);
			const fields = Schema.records[map.name].fields;
			const set = Object.assign({}, d.values, values.status ? {} : { status: "H" });
			for (const [key, v] of Object.entries(set)) {
				const f = fields[key];
				if (!f) continue;
				let value = v;
				if (f.type === "date") value = Store.toNsDate(v);
				else if (f.type === "select" && f.target && f.target.startsWith("list:")) value = Store.idOf(f.target.slice(5), v) || "";
				else if (value === null || value === undefined) value = "";
				context.newRecord.setValue({ fieldId: f.id, value });
			}
		} catch (e) {
			log.error({ title: "s4vp_ue_attendance_docs derive", details: String(e.message || e) });
			throw `${e.messageVi || e.message || e}`;
		}
	}

	return { beforeSubmit };
});
