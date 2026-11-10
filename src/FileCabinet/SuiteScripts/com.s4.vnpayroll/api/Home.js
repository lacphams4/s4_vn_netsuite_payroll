/**
 * Trang chủ (docs/design/TrangChu.dc.html): việc hôm nay, kỳ đang chạy, chứng từ chờ duyệt, hạn sắp đến.
 *
 * Mô-đun route của giao diện bản 2 (docs/UI_V2.md mục 5): RESTlet s4vp_rl_api tra action trong routes.get / routes.post,
 * kiểm tra vai trò theo roles ("all" | "hr" | "acct" | "payroll" | "admin") rồi gọi run(params | body). Tên action không
 * trùng action cũ của RESTlet. Lỗi nghiệp vụ: throw fail(en, vi).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
	// eslint-disable-next-line no-unused-vars
	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	const routes = {
		get: {},
		post: {},
	};

	return { routes };
});
