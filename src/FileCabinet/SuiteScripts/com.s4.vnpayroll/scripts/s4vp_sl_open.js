/**
 * Mở màn hình SPA "Lương VN" từ menu: center category chưa nhận link tới SPA, nên menu trỏ vào Suitelet này rồi
 * chuyển hướng tới /spa/s4vp-payroll.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(["N/redirect"], (redirect) => {
	function onRequest() {
		redirect.redirect({ url: "/spa/s4vp-payroll" });
	}

	return { onRequest };
});
