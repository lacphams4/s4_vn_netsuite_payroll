/**
 * Tài khoản chi phí lương theo đích (VP102080, đặc tả 4.5.6): chọn bản ghi record cost_account áp dụng cho một công ty con
 * và một kỳ lương, trả ba bảng tra đúng dạng CostAllocationBuilder.resolveAccount cần.
 *
 * Bản ghi (dạng Store): {id, isInactive, subsidiary, target_type (P dự án / W work center = class / D phòng ban), project,
 *   work_center, department, labor_type (E / C, trống = cả hai), account, effective (ngày ISO, trống = luôn hiệu lực)}.
 *
 * Quy tắc chọn, cho mỗi (loại đích, đích, loại lao động):
 *   - bỏ bản ghi inactive, thiếu tài khoản, thiếu đích của loại đã chọn, của công ty con khác, hoặc hiệu lực sau ngày cuối kỳ;
 *   - bản ghi có công ty con cụ thể thắng bản ghi dùng chung (công ty con trống);
 *   - cùng mức đó thì lấy bản ghi hiệu lực muộn nhất (không ngày hiệu lực xếp trước mọi ngày); vẫn bằng nhau thì id lớn hơn.
 * Khi tra (resolveAccount): bản ghi đúng loại lao động của nhân viên trước, rồi bản ghi cho mọi loại lao động.
 * Thứ tự ưu tiên giữa các bảng (work center -> dự án -> phòng ban -> hồ sơ -> mặc định) nằm ở resolveAccount.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates"], (Dates) => {
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const blank = (s) => norm(s) === "";
	const TABLES = { W: ["workCenters", "work_center"], P: ["projects", "project"], D: ["departments", "department"] };

	function rank(r) {
		return [blank(r.subsidiary) ? 0 : 1, blank(r.effective) ? "" : Dates.iso(r.effective), Number(r.id) || 0];
	}

	function better(a, b) {
		for (let i = 0; i < a.length; i++) {
			if (a[i] === b[i]) continue;
			return a[i] > b[i];
		}
		return false;
	}

	/**
	 * @param {Array} records bản ghi cost_account
	 * @param {{subsidiary?: string, periodEnd?: string, activeAccounts?: Array<string>|Set<string>}} [options]
	 *   subsidiary: công ty con của bảng lương (trống: chỉ dùng bản ghi dùng chung); periodEnd: ngày cuối kỳ (trống: không xét
	 *   ngày hiệu lực); activeAccounts: id các tài khoản còn dùng được - có truyền thì bản ghi trỏ tới tài khoản khác bị bỏ qua.
	 * @returns {{workCenters: Object, projects: Object, departments: Object}} mỗi bảng {ID đích: {account, byLabor: {E, C}}}
	 */
	function buildMaps(records, options) {
		const opt = options || {};
		const sub = blank(opt.subsidiary) ? "" : String(opt.subsidiary);
		const active = opt.activeAccounts ? new Set([...opt.activeAccounts].map(String)) : null;
		const best = {};
		for (const r of records || []) {
			if (!r || r.isInactive || blank(r.account)) continue;
			const def = TABLES[norm(r.target_type)];
			if (!def || blank(r[def[1]])) continue;
			if (!blank(r.subsidiary) && String(r.subsidiary) !== sub) continue;
			if (!blank(r.effective) && !blank(opt.periodEnd) && Dates.cmp(r.effective, opt.periodEnd) > 0) continue;
			if (active && !active.has(String(r.account))) continue;
			const labor = norm(r.labor_type);
			const key = [def[0], String(r[def[1]]), labor].join("|");
			const cand = { table: def[0], target: String(r[def[1]]), labor, account: String(r.account), rank: rank(r) };
			if (!best[key] || better(cand.rank, best[key].rank)) best[key] = cand;
		}
		const out = { workCenters: {}, projects: {}, departments: {} };
		for (const c of Object.values(best)) {
			const e = out[c.table][c.target] || (out[c.table][c.target] = { account: "", byLabor: {} });
			if (c.labor === "") e.account = c.account;
			else e.byLabor[c.labor] = c.account;
		}
		return out;
	}

	return { buildMaps };
});
