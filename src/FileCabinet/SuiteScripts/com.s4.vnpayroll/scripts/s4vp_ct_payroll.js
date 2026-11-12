/**
 * Bộ công cụ S4 Advanced Payroll cho trợ lý AI (NetSuite AI Connector Service - MCP: Claude, ChatGPT...).
 * Mỗi công cụ khai trong s4vp_ct_payroll_schema.json (sinh từ api/AiTools.TOOLS bằng tools/gen_ai_schema.mjs) ứng với một
 * hàm xuất cùng tên ở đây; toàn bộ kiểm tra tham số, phân quyền theo role, xác nhận trước khi ghi và cắt gọn kết quả nằm ở
 * api/AiTools.js. Script chạy bằng role của người đang kết nối (không có run-as): chỉ thấy và làm được đúng những gì role đó
 * được phép trên màn hình.
 *
 * Log: chỉ tên công cụ, kết cục và thời gian; không ghi tham số, không ghi kết quả (dữ liệu lương).
 * Governance: 1.000 đơn vị mỗi lần gọi; tính lương luôn chạy nền (Map/Reduce).
 *
 * @NApiVersion 2.1
 * @NScriptType CustomTool
 * @NModuleScope SameAccount
 */
define(["N/log", "../api/AiTools"], (log, AiTools) => {
	const tools = {};
	for (const name of AiTools.names()) {
		tools[name] = async (params) => {
			const started = Date.now();
			const out = AiTools.run(name, params || {});
			const outcome = out.ok ? (out.needsConfirmation ? "confirm" : "ok") : out.error.type;
			log.audit({ title: "s4vp_ct_payroll", details: `tool=${name} outcome=${outcome} ms=${Date.now() - started}` });
			return out;
		};
	}
	return tools;
});
