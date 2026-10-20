/**
 * Load VN Defaults (đặc tả 1.2.8, 4.9): nạp tham số pháp lý, biểu thuế, khoản trích, ngày lễ, loại thu nhập, loại nghỉ,
 * chính sách phép, quy tắc trừ công, ký hiệu bảng công, nhóm lương DEFAULT, thiết lập chung và bộ quy tắc mặc định V2.
 *
 * Chỉ thêm phần thiếu (so theo khóa nghiệp vụ), không ghi đè dữ liệu người dùng; chạy lại an toàn. Thứ tự theo phụ
 * thuộc (BUG-13): loại thu nhập, loại nghỉ trước; chính sách, thiết lập, quy tắc sau. Tên theo ngôn ngữ người chạy.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "../core/VietnamDefaults", "../core/IndustryPacks"], (runtime, Store, VD, Packs) => {
	function isVietnamese() {
		try {
			return /^vi/i.test(String(runtime.getCurrentUser().getPreference({ name: "LANGUAGE" }) || ""));
		} catch (e) {
			return true;
		}
	}

	function load(options = {}) {
		const vi = options.language ? /^vi/i.test(options.language) : isVietnamese();
		const pick = (o) => (vi ? o.nameVi || o.name : o.name);
		const log = { created: {}, skipped: {} };
		const count = (kind, created) => {
			const bag = created ? log.created : log.skipped;
			bag[kind] = (bag[kind] || 0) + 1;
		};

		// 1. Tham số đơn: khóa code + effective
		const params = Store.find("param", { includeInactive: true });
		const pKey = new Set(params.map((p) => `${String(p.name).toUpperCase()}|${p.effective}`));
		for (const p of VD.params) {
			const key = `${p.code}|${p.effectiveDate}`;
			if (pKey.has(key)) {
				count("param", false);
				continue;
			}
			Store.create("param", { name: p.code, effective: p.effectiveDate, expiration: p.expirationDate, value: Number(p.value), description: p.description, legal_ref: p.legalReference, verified: p.verified });
			count("param", true);
		}

		// 2. Biểu thuế: khóa effective + level
		const brs = Store.find("pit_bracket", { includeInactive: true });
		const bKey = new Set(brs.map((b) => `${b.effective}|${b.level}`));
		for (const b of VD.brackets) {
			if (bKey.has(`${b.effectiveDate}|${b.level}`)) {
				count("pit_bracket", false);
				continue;
			}
			Store.create("pit_bracket", { effective: b.effectiveDate, expiration: b.expirationDate, level: b.level, upper: b.upperBound, rate: Number(b.rate), legal_ref: b.legalReference });
			count("pit_bracket", true);
		}

		// 3. Khoản trích: khóa code + effective
		const comps = Store.find("ins_comp", { includeInactive: true });
		const cKey = new Set(comps.map((c) => `${String(c.name).toUpperCase()}|${c.effective}`));
		for (const c of VD.components) {
			if (cKey.has(`${c.code}|${c.effectiveDate}`)) {
				count("ins_comp", false);
				continue;
			}
			Store.create("ins_comp", {
				name: c.code, description: pick(c), effective: c.effectiveDate, expiration: c.expirationDate, ee_rate: Number(c.employeeRate),
				er_rate: Number(c.employerRate), wage_base: c.wageBase, union_only: !!c.requiresUnionMembership,
				cap_factor: c.employeeCapFactor === null ? null : Number(c.employeeCapFactor), legal_ref: c.legalReference,
			});
			count("ins_comp", true);
		}

		// 4. Ngày lễ
		const hol = new Set(Store.find("holiday", { includeInactive: true }).map((h) => h.date));
		for (const h of VD.holidays) {
			if (hol.has(h.date)) {
				count("holiday", false);
				continue;
			}
			Store.create("holiday", { name: pick(h), date: h.date, compensatory: h.isCompensatory });
			count("holiday", true);
		}

		// 5. Loại thu nhập (mã = name); chạy lại đổi tên còn nguyên tiếng Anh mặc định sang tiếng Việt
		const ets = byName(Store.find("earning_type", { includeInactive: true }));
		for (const e of VD.earningTypes) {
			const cur = ets[e.code];
			if (cur) {
				if (vi && cur.description === e.name) Store.submit("earning_type", cur.id, { description: e.nameVi });
				count("earning_type", false);
				continue;
			}
			const id = Store.create("earning_type", {
				name: e.code, description: pick(e), category: e.category, tax: e.taxTreatment, cap_param: e.exemptCapParam, is_ot: e.isOvertime,
				ot_day: e.overtimeDayType, is_night: e.isNight, had_day_ot: e.hadDaytimeOvertime, time_type: e.timeTypeCode,
			});
			ets[e.code] = { id };
			count("earning_type", true);
		}

		// 6. Loại nghỉ, chính sách
		const lts = byName(Store.find("leave_type", { includeInactive: true }));
		for (const l of VD.leaveTypes) {
			if (lts[l.code]) {
				count("leave_type", false);
				continue;
			}
			lts[l.code] = {
				id: Store.create("leave_type", {
					name: l.code, description: pick(l), is_paid: l.isPaid, deducts_days: l.deductsWorkDays, paid_by_si: l.paidBySocialInsurance,
					uses_balance: l.usesBalance, requires_attachment: l.requiresAttachment, allow_half: l.allowHalfDay, max_days: l.maxDaysPerRequest,
				}),
			};
			count("leave_type", true);
		}
		const pols = byName(Store.find("leave_policy", { includeInactive: true }));
		for (const p of VD.leavePolicies) {
			if (pols[p.code]) {
				count("leave_policy", false);
				continue;
			}
			pols[p.code] = {
				id: Store.create("leave_policy", {
					name: p.code, description: pick(p), leave_type: lts[p.leaveType].id, annual_days: p.annualDays, step_years: p.seniorityStepYears,
					extra_days: p.seniorityExtraDays, method: p.accrualMethod, prorate: p.prorateNewHire, carry_max: p.carryOverMaxDays,
					carry_expiry_month: p.carryOverExpiryMonth, rounding: Number(p.roundingUnit),
				}),
			};
			count("leave_policy", true);
		}

		// 7. Quy tắc trừ công, ký hiệu
		const ars = new Set(Store.find("att_rule", { includeInactive: true }).map((r) => r.min_from));
		for (const r of VD.attendanceRules) {
			if (ars.has(r.minutesFrom)) {
				count("att_rule", false);
				continue;
			}
			Store.create("att_rule", { min_from: r.minutesFrom, min_to: r.minutesTo, deduct: Number(r.deductDays) });
			count("att_rule", true);
		}
		const syms = byName(Store.find("att_symbol", { includeInactive: true }));
		for (const s of VD.attendanceSymbols) {
			if (syms[s.code]) {
				count("att_symbol", false);
				continue;
			}
			Store.create("att_symbol", { name: s.code, description: pick(s), category: s.category, days: Number(s.days) });
			count("att_symbol", true);
		}

		// 8. Nhóm lương DEFAULT
		const groups = byName(Store.find("paygroup", { includeInactive: true }));
		if (!groups.DEFAULT) {
			Store.create("paygroup", { name: "DEFAULT", description: vi ? "Nhóm lương mặc định (tháng)" : "Default pay group (monthly)", frequency: "M", week_start: 1, timing: "L" });
			count("paygroup", true);
		} else count("paygroup", false);

		// 9. Thiết lập chung (một bản ghi)
		const setups = Store.find("setup", { includeInactive: true });
		const s = VD.setup;
		if (!setups.length) {
			Store.create("setup", {
				name: vi ? "Thiết lập lương VN" : "VN Payroll Preferences", std_days: s.standardWorkDays || null, hours_per_day: s.standardHoursPerDay,
				weekly_off: "0,6", region: s.defaultRegion, base_et: ets[s.baseEarningType].id, allow_et: ets[s.allowanceEarningType].id,
				meal_et: ets[s.mealEarningType].id, ctr_et: ets[s.contractorEarningType].id, payout_et: ets[s.leavePayoutEarningType].id,
				meal_amount: s.mealAllowanceAmount, union_fund: s.unionFundApplicable, ext_ot: s.extendedOvertimeSector, require_approval: s.requirePayrollApproval, auto_approve: true,
				time_approval: s.requireTimeApproval, ot_source: s.overtimeSource, require_lock: s.requireAttendanceLock, leave_policy: pols[s.defaultLeavePolicy].id,
				wp_blocks: s.workPermitBlocksPayroll, alloc_method: s.allocationMethod, alloc_fallback: s.allocationFallback, alloc_version: s.allocationVersionMode,
				acc13_basis: s.accrual13thBasis, acc13_months: s.accrual13thMonths,
			});
			count("setup", true);
		} else count("setup", false);

		// 10. Quy tắc thu nhập mặc định: chỉ khi bảng quy tắc còn rỗng (4.2.2)
		const rules = Store.find("earning_rule", { includeInactive: true });
		if (!rules.length) {
			const setupObj = { baseEarningType: s.baseEarningType, contractorEarningType: s.contractorEarningType, allowanceEarningType: s.allowanceEarningType, mealEarningType: s.mealEarningType, mealAllowanceAmount: s.mealAllowanceAmount };
			for (const r of VD.defaultEarningRules(setupObj)) {
				Store.create("earning_rule", {
					name: r.code, description: vi ? r.descriptionVi : r.description, sequence: r.sequence, earning_type: r.earningType ? ets[r.earningType].id : null,
					employment_type: r.employmentType || null, salary_type: r.salaryType || null, qty_source: r.quantitySource, hours_fallback: !!r.hoursFallbackToWorkDays,
					rate_source: r.rateSource, fixed_rate: r.fixedRate === undefined ? null : Number(r.fixedRate), multiplier: r.multiplier, proration: r.proration,
					fail_action: r.failAction, reduction: r.reductionPercent,
				});
				count("earning_rule", true);
			}
		} else count("earning_rule", false);

		return log;
	}

	/**
	 * Load Industry Pack (VP101020, đặc tả 4.4): nạp gói CONSTRUCTION / TRADE / MANUFACTURING cho công ty con.
	 * Chỉ thêm phần chưa có (so theo mã); quy tắc cần mức tiền do khách quyết được nạp ở trạng thái không hoạt động.
	 * Chặn khi bảng quy tắc còn rỗng (phải Nạp mặc định VN trước, 4.9 #1). Ca, mẫu xoay ca chưa có record: bỏ qua, báo lại.
	 */
	function loadIndustryPack(code, subsidiary, options = {}) {
		const vi = options.language ? /^vi/i.test(options.language) : isVietnamese();
		const pick = (o) => (vi ? o.nameVi || o.name : o.name);
		const ets = byName(Store.find("earning_type", { includeInactive: true }));
		const groups = byName(Store.find("paygroup", { includeInactive: true }));
		const tables = byName(Store.find("rate_table", { includeInactive: true }));
		const rules = byName(Store.find("earning_rule", { includeInactive: true }));
		const plan = Packs.planLoad(code, { earningTypes: Object.keys(ets), payGroups: Object.keys(groups), rateTables: Object.keys(tables), shifts: [], patterns: [], rules: Object.keys(rules) });
		const created = { earningTypes: [], payGroups: [], rateTables: [], rules: [] };
		for (const e of plan.earningTypes) {
			ets[e.code] = { id: Store.create("earning_type", { name: e.code, description: pick(e), category: e.category, tax: e.taxTreatment || "T", cap_param: e.exemptCapParam || "" }) };
			created.earningTypes.push(e.code);
		}
		for (const g of plan.payGroups) {
			groups[g.code] = { id: Store.create("paygroup", { name: g.code, description: pick(g), subsidiary: subsidiary || null, frequency: g.frequency, week_start: 1, timing: "L", att_source: g.attendanceSource || "E" }) };
			created.payGroups.push(g.code);
		}
		for (const t of plan.rateTables) {
			Store.create("rate_table", { name: t.code, description: pick(t), type: t.type });
			created.rateTables.push(t.code);
		}
		for (const r of plan.rules) {
			const id = Store.create("earning_rule", {
				name: r.code, description: vi ? r.descriptionVi || r.description : r.description, sequence: r.sequence, earning_type: ets[r.earningType] ? ets[r.earningType].id : null,
				qty_source: r.quantitySource, rate_source: r.rateSource, fixed_rate: Number(r.fixedRate) || 0, multiplier: r.multiplier || 1, proration: r.proration || "N",
				rate_table: r.rateTable || "", tier_method: r.tierMethod || "P", shift_kind: r.shiftKind || "", fail_action: r.failAction || "N", reduction: r.reductionPercent || 0,
				isInactive: !r.isActive,
			});
			for (const c of r.conditions || []) Store.create("rule_cond", { rule: id, field: c.field, operator: c.comparison, value: Number(c.value) });
			created.rules.push(r.code);
		}
		const skipped = plan.shifts.map((x) => x.code).concat(plan.patterns.map((x) => x.code));
		return { created, skippedShifts: skipped };
	}

	function byName(rows) {
		const out = {};
		for (const r of rows) out[String(r.name || "").trim().toUpperCase()] = r;
		return out;
	}

	return { load, loadIndustryPack };
});
