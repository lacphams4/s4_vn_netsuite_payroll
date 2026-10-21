/**
 * Chặn sửa trực tiếp record do quy trình của gói kiểm soát (QC #3): bảng lương, dòng nhân viên, sổ phép, giao dịch phép
 * chỉ thay đổi qua màn hình Lương VN (RESTlet), Map/Reduce của gói; phiếu tạm ứng và kỳ lương cho lập / sửa trên
 * giao diện NetSuite nhưng không cho đổi trạng thái, số dư, bút toán. Script của gói (RESTlet, Map/Reduce, Suitelet,
 * User Event khác) không bị chặn. Lỗi ném chuỗi ngắn song ngữ.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(["N/runtime", "../api/Store"], (runtime, Store) => {
	// Dòng nhập tay cũng chỉ sửa qua màn hình (QC2 #8): sửa trên giao diện thì không đưa được bảng lương về "chưa tính"
	const LOCKED_TYPES = ["customrecord_s4vp_batch", "customrecord_s4vp_batch_emp", "customrecord_s4vp_batch_input", "customrecord_s4vp_batch_time", "customrecord_s4vp_leave_balance", "customrecord_s4vp_leave_tran"];
	const ADVANCE = "customrecord_s4vp_advance";
	const PERIOD = "customrecord_s4vp_period";
	const ADVANCE_CONTROLLED = ["custrecord_s4vp_ad_status", "custrecord_s4vp_ad_offset", "custrecord_s4vp_ad_balance", "custrecord_s4vp_ad_journal", "custrecord_s4vp_ad_history"];
	const PERIOD_CONTROLLED = ["custrecord_s4vp_pp_status", "custrecord_s4vp_pp_att_status"];
	const MSG_LOCKED = "Dữ liệu này chỉ thay đổi qua màn hình Lương VN. / This record can only be changed from the VN Payroll screen.";

	function fromUser() {
		const c = runtime.executionContext;
		const E = runtime.ContextType;
		return [E.USER_INTERFACE, E.CSV_IMPORT, E.WEBSERVICES, E.REST_WEBSERVICES].filter(Boolean).includes(c);
	}

	function changed(context, fields) {
		const n = context.newRecord;
		const o = context.oldRecord;
		return fields.filter((f) => {
			let nv;
			try {
				nv = n.getValue({ fieldId: f });
			} catch (e) {
				return false;
			}
			// XEDIT: trường không gửi lên thì không đổi
			if (context.type === context.UserEventType.XEDIT && n.getFields && !n.getFields().includes(f)) return false;
			return String(nv === null || nv === undefined ? "" : nv) !== String(o ? o.getValue({ fieldId: f }) || "" : "");
		});
	}

	function beforeSubmit(context) {
		if (!fromUser()) return;
		const rec = context.newRecord || context.oldRecord;
		const type = rec.type;
		const T = context.UserEventType;
		if (LOCKED_TYPES.includes(type)) throw MSG_LOCKED;
		if (type === ADVANCE) {
			if (context.type === T.CREATE) {
				// Phiếu mới luôn Tạm giữ, chưa cấn trừ, chưa có bút toán
				for (const f of ADVANCE_CONTROLLED) context.newRecord.setValue({ fieldId: f, value: "" });
				context.newRecord.setValue({ fieldId: "custrecord_s4vp_ad_status", value: Store.idOf("advance_status", "H") });
				return;
			}
			const status = String((context.oldRecord && context.oldRecord.getText({ fieldId: "custrecord_s4vp_ad_status" })) || "");
			if (context.type === T.DELETE) {
				if (status && !/^H\b/.test(status)) throw "Chỉ xóa được phiếu tạm ứng đang tạm giữ. / Only on-hold advances can be deleted.";
				return;
			}
			if (changed(context, ADVANCE_CONTROLLED).length) throw MSG_LOCKED;
			if (status && !/^H\b/.test(status)) throw "Chỉ sửa được phiếu tạm ứng đang tạm giữ. / Only on-hold advances can be edited.";
			return;
		}
		if (type === PERIOD) {
			if (context.type === T.CREATE || context.type === T.DELETE) return;
			if (changed(context, PERIOD_CONTROLLED).length) throw "Đóng / mở kỳ và khóa công thực hiện trên màn hình Lương VN. / Close periods and lock attendance from the VN Payroll screen.";
		}
	}

	return { beforeSubmit };
});
