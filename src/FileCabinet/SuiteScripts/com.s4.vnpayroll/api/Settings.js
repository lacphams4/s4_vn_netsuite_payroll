/**
 * Thiết lập hiệu lực ba lớp (đặc tả 1.3.5, 4.6.1): tenant (setup) <- công ty (company theo subsidiary) <- nhóm lương.
 * Ô trống ở lớp hẹp kế thừa lớp rộng. Tài khoản: công ty khai tài khoản nào thì dùng tài khoản đó của công ty.
 * Đồng thời nạp dữ liệu tham chiếu dùng chung cho một lần tính (tham số pháp lý, loại thu nhập, ngày lễ...).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "../core/StatutoryParameterProvider"], (Store, Provider) => {
	const ACCOUNT_KEYS = ["acc_payable", "acc_pit", "acc_advance", "acc_expense", "acc_other_ded", "acc_13th", "acc_contractor"];
	const empty = (v) => v === null || v === undefined || v === "";
	const pick = (...vals) => {
		for (const v of vals) if (!empty(v)) return v;
		return null;
	};
	const inherit = (v, fallback) => (v === "Y" ? true : v === "N" ? false : fallback);

	function tenant() {
		const rows = Store.find("setup");
		if (!rows.length) throw new Error("VN Payroll preferences are missing. Run Load VN Defaults first. / Chưa có thiết lập lương VN, hãy chạy Nạp mặc định VN.");
		return rows[0];
	}

	function company(subsidiary) {
		if (!subsidiary) return null;
		return Store.find("company", { where: "{subsidiary} = ?", params: [subsidiary] })[0] || null;
	}

	function paygroupByName(name) {
		const key = String(name || "DEFAULT").trim().toUpperCase() || "DEFAULT";
		return Store.find("paygroup", { includeInactive: true }).find((g) => String(g.name).trim().toUpperCase() === key) || null;
	}

	/**
	 * @param {string} subsidiary internal id
	 * @param {object|null} group record nhóm lương (Store)
	 */
	function resolve(subsidiary, group) {
		const t = tenant();
		const c = company(subsidiary) || {};
		const g = group || {};
		const accounts = {};
		for (const k of ACCOUNT_KEYS) accounts[k] = pick(c[k], t[k]);
		return {
			subsidiary,
			companyEnabled: c.id ? c.enabled !== false : true,
			companyId: c.id || null,
			payGroupId: g.id || null,
			payGroupCode: g.name ? String(g.name).trim().toUpperCase() : "DEFAULT",
			frequency: g.frequency || "M",
			statutoryTiming: g.timing || "L",
			weekStart: empty(g.week_start) ? 1 : g.week_start,
			standardWorkDays: pick(g.std_days, t.std_days),
			standardHoursPerDay: pick(g.hours_per_day, t.hours_per_day) || 8,
			weeklyOffDays: pick(g.weekly_off, t.weekly_off),
			tenantWeeklyOffDays: t.weekly_off,
			defaultRegion: pick(c.region, t.region) || "I",
			unionFundApplicable: inherit(c.union_fund, t.union_fund !== false),
			occupationalAccidentRate: pick(c.accident_rate, t.accident_rate),
			extendedOvertimeSector: inherit(c.ext_ot, !!t.ext_ot),
			accrual13Basis: pick(c.acc13_basis, t.acc13_basis) || "P",
			accrual13Months: pick(c.acc13_months, t.acc13_months) || 12,
			overtimeSource: pick(g.ot_source, t.ot_source) || "R",
			requireAttendanceLock: inherit(g.require_lock, !!t.require_lock),
			attendanceSource: g.att_source || "E",
			allocationMethod: pick(g.alloc_method, t.alloc_method) || "F",
			allocationFallback: pick(g.alloc_fallback, t.alloc_fallback) || "P",
			allocationVersionMode: pick(g.alloc_version, t.alloc_version) || "E",
			requirePayrollApproval: t.require_approval !== false,
			requireTimeApproval: t.time_approval !== false,
			workPermitBlocksPayroll: !!t.wp_blocks,
			mealAllowanceAmount: t.meal_amount || 0,
			earningTypeIds: { base: t.base_et, allowance: t.allow_et, meal: t.meal_et, contractor: t.ctr_et, payout: t.payout_et },
			accounts,
			pitVendor: pick(c.pit_vendor, t.pit_vendor),
			signers: { preparer: c.preparer || "", chiefAccountant: c.chief_accountant || "", director: c.director || "" },
		};
	}

	/** Provider tham số pháp lý từ ba bảng record (kèm tài khoản và cơ quan thu của khoản trích). */
	function provider() {
		const params = Store.find("param").map((p) => ({ code: p.name, effectiveDate: p.effective, expirationDate: p.expiration, value: String(p.value), verified: p.verified }));
		const brackets = Store.find("pit_bracket").map((b) => ({ effectiveDate: b.effective, expirationDate: b.expiration, level: b.level, upperBound: b.upper === null ? null : String(b.upper), rate: String(b.rate) }));
		const components = Store.find("ins_comp").map((c) => ({
			code: c.name, description: c.description, nameVi: c.description, effectiveDate: c.effective, expirationDate: c.expiration,
			employeeRate: String(c.ee_rate || 0), employerRate: String(c.er_rate || 0), wageBase: c.wage_base || "S", requiresUnionMembership: c.union_only,
			employeeCapFactor: c.cap_factor === null || c.cap_factor === "" ? null : String(c.cap_factor), liabilityAccount: c.account, vendor: c.vendor,
		}));
		const unverified = params.filter((p) => p.verified === false).map((p) => `${p.code} ${p.effectiveDate}`);
		return Object.assign(Provider.create({ params, brackets, components }), { unverified });
	}

	/** Loại thu nhập: {byId, byCode} với cấu trúc lõi dùng. */
	function earningTypes() {
		const byId = {};
		const byCode = {};
		for (const e of Store.find("earning_type", { includeInactive: true })) {
			const o = {
				id: e.id, code: String(e.name).trim().toUpperCase(), description: e.description, category: e.category, taxTreatment: e.tax || "T",
				exemptCapParam: e.cap_param || "", isOvertime: e.is_ot, overtimeDayType: e.ot_day || "N", isNight: e.is_night,
				hadDaytimeOvertime: e.had_day_ot, timeTypeCode: e.time_type || "", isActive: !e.isInactive,
			};
			byId[e.id] = o;
			byCode[o.code] = o;
		}
		return { byId, byCode, list: Object.values(byCode) };
	}

	function holidays() {
		return Store.find("holiday").map((h) => ({ date: h.date, name: h.name, isCompensatory: h.compensatory }));
	}

	return { tenant, company, paygroupByName, resolve, provider, earningTypes, holidays };
});
