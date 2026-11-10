/**
 * Tài khoản chi phí lương theo đích (VP102080, đặc tả 4.5.6): đọc record cost_account và trả ba bảng tra cho tính lương.
 * Quy tắc chọn bản ghi nằm ở core/CostAccountRules.js; thứ tự ưu tiên khi ghi sổ ở core/CostAllocationBuilder.resolveAccount.
 *
 * Một truy vấn cho cả bảng lương. Bản ghi inactive, hoặc trỏ tới tài khoản inactive, bị bỏ qua ngay trong truy vấn (dòng phân
 * bổ rơi về mức ưu tiên kế tiếp). Không đọc được record (chưa deploy, vai trò thiếu quyền) thì trả bảng rỗng kèm `error`:
 * tính lương vẫn chạy như khi chưa khai tài khoản theo đích, lớp gọi có thể đưa `error` vào cảnh báo.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/log", "./Store", "../core/CostAccountRules"], (log, Store, Rules) => {
	/**
	 * @param {string} subsidiary công ty con của bảng lương (trống: chỉ dùng bản ghi dùng chung)
	 * @param {string} periodEnd ngày cuối kỳ lương (ISO)
	 * @returns {{workCenters: Object, projects: Object, departments: Object, error?: string}}
	 *   đưa thẳng vào emp.accounts của PayrollEngine.calculateEmployee
	 */
	function forPayroll(subsidiary, periodEnd) {
		let rows = [];
		let error = null;
		try {
			rows = Store.find("cost_account", { where: "{account} IN (SELECT a.id FROM account a WHERE a.isinactive = 'F')" });
		} catch (e) {
			error = String((e && e.message) || e);
			log.error({ title: "s4vp cost_account", details: error });
		}
		const maps = Rules.buildMaps(rows, { subsidiary, periodEnd });
		return error ? Object.assign(maps, { error }) : maps;
	}

	return { forPayroll };
});
