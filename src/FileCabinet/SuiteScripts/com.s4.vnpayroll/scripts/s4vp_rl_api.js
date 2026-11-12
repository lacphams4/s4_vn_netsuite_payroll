/**
 * API của màn hình Lương VN (SPA) và của hệ thống ngoài (OAuth 2.0): danh mục, kỳ lương, bảng lương và thao tác.
 * Toàn bộ điều phối, phân quyền theo role và nhật ký nằm ở api/Dispatch.js (dùng chung với bộ công cụ AI
 * scripts/s4vp_ct_payroll.js); danh sách action xem ở đó.
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(["../api/Dispatch"], (Dispatch) => ({ get: Dispatch.get, post: Dispatch.post }));
