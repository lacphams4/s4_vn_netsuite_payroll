/**
 * Dòng phân bổ chi phí của một nhân viên (đặc tả mục 4.5.4 "nguồn nào đích đó" và 4.5.6 tài khoản chi phí).
 *
 * Thứ tự: thu nhập có đích riêng (hoa hồng C theo shares, dòng tay có chi nhánh / work center / phòng ban, dòng quy tắc sản
 * lượng O, doanh số S) ->
 * dòng OT có dự án khi nguồn đã chọn không phải timesheet -> phần còn lại (GROSS) và BH phần DN (ERINS) chia theo đích
 * của phương pháp đã chọn. BH DN không đi theo "nguồn nào đích đó". Trích trước tháng 13 không phân bổ.
 *
 * Phòng ban (sub) của dòng phân bổ: đích có phòng ban riêng (dòng bảng tỷ lệ, dòng nhập tay, phần sản lượng) thì chi phí
 * đi theo phòng ban đó; đích không khai thì dùng phòng ban của nhân viên / mặc định (resolveAccount).
 * Bất biến: tổng dòng phân bổ = gross + BH phần doanh nghiệp.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./ProjectCostAllocator"], (Money, Allocator) => {
	const D = Money.D;
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const blank = (s) => norm(s) === "";
	const hasContent = (t) => !blank(t.project) || !blank(t.branch) || !blank(t.workCenter) || !blank(t.sub);
	// Phòng ban riêng chỉ ghi vào đích / dòng khi có: đích không khai phòng ban giữ nguyên dạng cũ
	const withSub = (o, sub) => (blank(sub) ? o : Object.assign(o, { sub }));

	/**
	 * @param {{grossPay, employerInsurance,
	 *   earnings: Array<{earningType, amount, source (S/T/M/C), shares (C: [{sub, workCenter, branch, project, amount}]), quantitySource, rateTable, project, task, costCode, branch, workCenter, sub, hours}>,
	 *   outputShares: Array<{rateTable, isSales, project, branch, workCenter, sub, amount}>,
	 *   targets: Array (AllocationSourceResolver.resolve; đích có thể mang sub), defaultBranch, defaultWorkCenter,
	 *   accounts: {workCenters, projects, departments: {ID: {account, byLabor: {E, C}, sub}} (CostAccountRules.buildMaps), laborType (E/C),
	 *              employeeAccount, employeeSub, defaultAccount, defaultSub}}} input
	 * @returns {Array} dòng phân bổ {component, amount, account, sub, project, task, costCode, branch, workCenter, source, version, hours, weight, ratio}
	 */
	function build(input) {
		const gross = D(input.grossPay);
		let pool = gross;
		const out = [];
		const fill = (t) => Object.assign({}, t, {
			branch: blank(t.branch) ? input.defaultBranch || "" : t.branch,
			workCenter: blank(t.workCenter) ? input.defaultWorkCenter || "" : t.workCenter,
		});
		const handled = new Set();
		const earnings = input.earnings || [];
		if (!gross.isZero()) {
			earnings.forEach((e, idx) => {
				if (D(e.amount).isZero()) return;
				let own = [];
				if (norm(e.source) === "C" && (e.shares || []).length) {
					// Hoa hồng (docs/COMMISSION.md mục 7): đích theo phân đoạn của doanh thu được ghi nhận, trọng số = số tiền phần
					own = e.shares.filter((s) => D(s.amount).gt(0))
						.map((s) => withSub({ project: s.project || "", task: "", costCode: "", branch: s.branch || "", workCenter: s.workCenter || "", source: "S", weight: s.amount }, s.sub));
				} else if (!blank(e.branch) || !blank(e.workCenter) || !blank(e.sub)) {
					own = [withSub({ project: e.project || "", task: e.task || "", costCode: e.costCode || "", branch: e.branch || "", workCenter: e.workCenter || "", source: "S", weight: 1 }, e.sub)];
				} else if (norm(e.quantitySource) === "O" && norm(e.source) === "S") {
					own = (input.outputShares || []).filter((s) => blank(e.rateTable) || norm(s.rateTable) === norm(e.rateTable))
						.map((s) => withSub({ project: s.project || "", task: "", costCode: "", branch: s.branch || "", workCenter: s.workCenter || "", source: "S", weight: s.amount }, s.sub));
				} else if (norm(e.quantitySource) === "S" && norm(e.source) === "S") {
					own = (input.outputShares || []).filter((s) => s.isSales)
						.map((s) => withSub({ project: s.project || "", task: "", costCode: "", branch: s.branch || "", workCenter: s.workCenter || "", source: "S", weight: s.amount }, s.sub));
				}
				if (!own.some(hasContent)) return;
				handled.add(idx);
				const merged = Allocator.merge(own);
				const parts = Allocator.split(e.amount, merged.map((t) => t.weight));
				merged.forEach((t, i) => {
					if (!hasContent(t) || parts[i] === 0) return;
					const f = fill(t);
					out.push(withSub({ component: "GROSS", amount: parts[i], project: f.project, task: f.task, costCode: f.costCode, branch: f.branch, workCenter: f.workCenter, source: "S", version: null, hours: 0, weight: Money.roundTo(t.weight, 6), ratio: Money.roundTo(D(parts[i]).div(gross), 6) }, t.sub));
					pool = pool.minus(parts[i]);
				});
			});
			const timesheetTargets = (input.targets || []).some((t) => norm(t.source) === "T");
			if (!timesheetTargets) {
				const groups = new Map();
				earnings.forEach((e, idx) => {
					if (handled.has(idx) || norm(e.source) !== "T" || blank(e.project) || D(e.amount).isZero()) return;
					const key = [e.project, e.task, e.costCode].map(norm).join("|");
					const g = groups.get(key) || { project: e.project, task: e.task || "", costCode: e.costCode || "", amount: D(0), hours: D(0) };
					g.amount = g.amount.plus(D(e.amount));
					g.hours = g.hours.plus(D(e.hours || e.quantity));
					groups.set(key, g);
				});
				for (const g of groups.values()) {
					const f = fill({ project: g.project, branch: "", workCenter: "" });
					out.push({ component: "GROSS", amount: g.amount.toNumber(), project: g.project, task: g.task, costCode: g.costCode, branch: f.branch, workCenter: f.workCenter, source: "T", version: null, hours: g.hours.toNumber(), weight: g.hours.toNumber(), ratio: Money.roundTo(g.amount.div(gross), 6) });
					pool = pool.minus(g.amount);
				}
			}
		}
		const rest = Allocator.allocate((input.targets || []).map(fill), [{ component: "GROSS", amount: pool.toNumber() }, { component: "ERINS", amount: D(input.employerInsurance).toNumber() }]);
		out.push(...rest);
		return out.filter((l) => l.amount !== 0).map((l) => Object.assign(l, resolveAccount(l, input.accounts || {})));
	}

	/**
	 * Tài khoản chi phí và phòng ban của dòng phân bổ (4.5.6).
	 *
	 * Phòng ban (sub): phòng ban riêng của dòng (line.sub) -> sub khai kèm bản ghi tài khoản (nếu có) -> phòng ban của nhân viên
	 * khi nhân viên có tài khoản riêng, ngược lại phòng ban mặc định.
	 * Tài khoản, theo thứ tự ưu tiên:
	 *   1. work center (class) của dòng        - acc.workCenters
	 *   2. dự án của dòng                      - acc.projects
	 *   3. phòng ban riêng của dòng            - acc.departments
	 *   4. tài khoản của hồ sơ nhân viên       - acc.employeeAccount
	 *   5. phòng ban của nhân viên / mặc định  - acc.departments (chỉ khi dòng không có phòng ban riêng)
	 *   6. tài khoản mặc định                  - acc.defaultAccount
	 * Mỗi bảng tra theo (đích, loại lao động acc.laborType) rồi (đích, mọi loại): {account, byLabor: {E, C}}.
	 * Không khai bảng nào thì kết quả như trước: tài khoản hồ sơ -> mặc định, phòng ban nhân viên / mặc định.
	 */
	function resolveAccount(line, acc) {
		const own = blank(line.sub) ? "" : line.sub;
		const subDefault = acc.employeeAccount ? acc.employeeSub || "" : acc.defaultSub || "";
		const labor = norm(acc.laborType);
		const pick = (table, key) => {
			if (!table || blank(key)) return null;
			const e = table[key] || table[norm(key)];
			if (!e) return null;
			const account = (labor && e.byLabor && e.byLabor[labor]) || e.account;
			return account ? { account, sub: e.sub } : null;
		};
		const hit = pick(acc.workCenters, line.workCenter) || pick(acc.projects, line.project) || pick(acc.departments, own);
		if (hit) return { account: hit.account, sub: own || (blank(hit.sub) ? subDefault : hit.sub) };
		if (acc.employeeAccount) return { account: acc.employeeAccount, sub: own || subDefault };
		const dept = own ? null : pick(acc.departments, subDefault);
		return { account: (dept && dept.account) || acc.defaultAccount || "", sub: own || subDefault };
	}

	return { build, resolveAccount };
});
