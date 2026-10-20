/**
 * Dòng phân bổ chi phí của một nhân viên (đặc tả mục 4.5.4 "nguồn nào đích đó" và 4.5.6 tài khoản chi phí).
 *
 * Thứ tự: thu nhập có đích riêng (dòng tay có chi nhánh / work center, dòng quy tắc sản lượng O, doanh số S) ->
 * dòng OT có dự án khi nguồn đã chọn không phải timesheet -> phần còn lại (GROSS) và BH phần DN (ERINS) chia theo đích
 * của phương pháp đã chọn. BH DN không đi theo "nguồn nào đích đó". Trích trước tháng 13 không phân bổ.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./ProjectCostAllocator"], (Money, Allocator) => {
	const D = Money.D;
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const blank = (s) => norm(s) === "";
	const hasContent = (t) => !blank(t.project) || !blank(t.branch) || !blank(t.workCenter);

	/**
	 * @param {{grossPay, employerInsurance,
	 *   earnings: Array<{earningType, amount, source (S/T/M), quantitySource, rateTable, project, task, costCode, branch, workCenter, hours}>,
	 *   outputShares: Array<{rateTable, isSales, project, branch, workCenter, amount}>,
	 *   targets: Array (AllocationSourceResolver.resolve), defaultBranch, defaultWorkCenter,
	 *   accounts: {workCenters: {ID: {account, sub}}, projects: {ID: {account, sub}}, employeeAccount, employeeSub, defaultAccount, defaultSub}}} input
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
				if (!blank(e.branch) || !blank(e.workCenter)) {
					own = [{ project: e.project || "", task: e.task || "", costCode: e.costCode || "", branch: e.branch || "", workCenter: e.workCenter || "", source: "S", weight: 1 }];
				} else if (norm(e.quantitySource) === "O" && norm(e.source) === "S") {
					own = (input.outputShares || []).filter((s) => blank(e.rateTable) || norm(s.rateTable) === norm(e.rateTable))
						.map((s) => ({ project: s.project || "", task: "", costCode: "", branch: s.branch || "", workCenter: s.workCenter || "", source: "S", weight: s.amount }));
				} else if (norm(e.quantitySource) === "S" && norm(e.source) === "S") {
					own = (input.outputShares || []).filter((s) => s.isSales)
						.map((s) => ({ project: s.project || "", task: "", costCode: "", branch: s.branch || "", workCenter: s.workCenter || "", source: "S", weight: s.amount }));
				}
				if (!own.some(hasContent)) return;
				handled.add(idx);
				const merged = Allocator.merge(own);
				const parts = Allocator.split(e.amount, merged.map((t) => t.weight));
				merged.forEach((t, i) => {
					if (!hasContent(t) || parts[i] === 0) return;
					const f = fill(t);
					out.push({ component: "GROSS", amount: parts[i], project: f.project, task: f.task, costCode: f.costCode, branch: f.branch, workCenter: f.workCenter, source: "S", version: null, hours: 0, weight: Money.roundTo(t.weight, 6), ratio: Money.roundTo(D(parts[i]).div(gross), 6) });
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
	 * Tài khoản chi phí của dòng phân bổ (4.5.6): work center -> tài khoản dự án -> tài khoản hồ sơ nhân viên -> mặc định.
	 * sub (tiểu khoản / department) mặc định = tiểu khoản nhân viên nếu nhân viên có tài khoản, ngược lại mặc định.
	 */
	function resolveAccount(line, acc) {
		const subDefault = acc.employeeAccount ? acc.employeeSub || "" : acc.defaultSub || "";
		const wc = !blank(line.workCenter) && acc.workCenters ? acc.workCenters[line.workCenter] || acc.workCenters[norm(line.workCenter)] : null;
		if (wc && wc.account) return { account: wc.account, sub: blank(wc.sub) ? subDefault : wc.sub };
		const pa = !blank(line.project) && acc.projects ? acc.projects[line.project] || acc.projects[norm(line.project)] : null;
		if (pa && pa.account) return { account: pa.account, sub: blank(pa.sub) ? subDefault : pa.sub };
		return { account: acc.employeeAccount || acc.defaultAccount || "", sub: subDefault };
	}

	return { build, resolveAccount };
});
