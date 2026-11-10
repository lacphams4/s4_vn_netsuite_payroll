/**
 * Nhật ký kỳ lương (docs/design/CanhBao.dc.html): ai làm gì, lúc nào trên bảng lương và kỳ công.
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

	/**
	 * RESTlet gọi sau mỗi POST thành công: entry = { action, batch, period, id, lineId, result }.
	 * batch / period đã được suy ra cho các action cũ khi rõ ràng (body.id của thao tác trên bảng lương, kỳ); id, lineId là
	 * khóa thô của body. Mô-đun này quyết định ghi gì; không ghi số tiền lương, số định danh. Lỗi ném ra bị RESTlet nuốt
	 * (chỉ ghi log) nên không làm hỏng thao tác. Hiện chưa ghi gì.
	 */
	// eslint-disable-next-line no-unused-vars
	function record(entry) {
		return null;
	}

	const routes = {
		get: {},
		post: {},
	};

	return { routes, record };
});
