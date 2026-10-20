/**
 * Bộ máy quy tắc thu nhập (EarningRuleEngine, đặc tả mục 4.1, 4.2) và sinh dòng thu nhập từ giờ công (4.2.9 bước 3),
 * dòng nhập tay (bước 6).
 *
 * Số tiền = Số lượng x Đơn giá x Hệ số [/ Ngày công chuẩn] x Hệ số điều kiện. Không có ngôn ngữ công thức tự do.
 * Danh sách quy tắc rỗng thì dùng bộ mặc định V2 (VietnamDefaults.defaultEarningRules(setup)).
 *
 * Quy tắc: {code, description, sequence, earningType, payGroup, salaryType, employmentType, effectiveDate, expirationDate,
 *   quantitySource (K/D/B/O/J/S/E/H), hoursFallbackToWorkDays, baseEarningType, shiftKind, rateTable,
 *   rateSource (F/S/A/P/Q/C/T), fixedRate, tierMethod (P/W), multiplier, proration (N/A/M),
 *   conditions: [{field (D/U/L/A/T/P), comparison (G/L/E), value}], failAction (N/R), reductionPercent, isActive}
 *
 * Ngữ cảnh nhân viên (ctx): {periodEnd, payGroup, salaryType, employmentType, standardDays, workDays, hoursPerDay,
 *   compensation: {baseSalary, fixedAllowance, benefitLines: [{earningType, amount}]},
 *   regularHours, timeLines: [{date, project, hours, isOvertime}], outputAmounts: {RATETABLE: amount}, salesAmount,
 *   shiftCounts: {D, E, N}, unpaidLeaveDays, lateCount, isActive, seniorityDate, salesTarget,
 *   rateTables: {RATETABLE: {type, lines: [...]}}}
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./Errors", "./RateTable", "./VietnamDefaults"], (Money, Dates, Errors, RateTable, VietnamDefaults) => {
	const D = Money.D;
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const blank = (s) => norm(s) === "";
	const bool = (b, dflt) => (b === null || b === undefined || b === "" ? dflt : b === true || b === "T" || b === "Y" || b === 1 || b === "1" || b === "true");

	/** Ngày công chuẩn thiếu khi cần chia ngày công (không có số 26 mặc định). */
	function missingStandardDays() {
		return Errors.invalid("Standard work days are not specified for the pay period or pay group.", "Thiếu ngày công chuẩn của kỳ lương hoặc nhóm lương.");
	}

	/** Quy tắc có áp cho nhân viên tại ngày cuối kỳ không (4.2.2). */
	function applies(rule, ctx) {
		if (!bool(rule.isActive, true)) return false;
		const group = blank(ctx.payGroup) ? "DEFAULT" : norm(ctx.payGroup);
		if (!blank(rule.payGroup) && norm(rule.payGroup) !== group) return false;
		if (!blank(rule.salaryType) && norm(rule.salaryType) !== norm(ctx.salaryType || "M")) return false;
		if (!blank(rule.employmentType) && norm(rule.employmentType) !== norm(ctx.employmentType || "E")) return false;
		if (rule.effectiveDate && Dates.cmp(ctx.periodEnd, rule.effectiveDate) < 0) return false;
		if (rule.expirationDate && Dates.cmp(ctx.periodEnd, rule.expirationDate) > 0) return false;
		return true;
	}

	/** Thứ tự chạy: Sequence tăng dần (trống = 100), rồi RuleCD theo chữ cái không phân biệt hoa thường. */
	function sortRules(rules) {
		const seq = (r) => (r.sequence === null || r.sequence === undefined || r.sequence === "" ? 100 : Number(r.sequence));
		return [...rules].sort((a, b) => seq(a) - seq(b) || (norm(a.code) < norm(b.code) ? -1 : norm(a.code) > norm(b.code) ? 1 : 0));
	}

	function workDaysOf(ctx) {
		return ctx.workDays === null || ctx.workDays === undefined || ctx.workDays === "" ? D(ctx.standardDays) : D(ctx.workDays);
	}

	function hoursPerDay(ctx) {
		return ctx.hoursPerDay === null || ctx.hoursPerDay === undefined || ctx.hoursPerDay === "" || D(ctx.hoursPerDay).lte(0) ? D(8) : D(ctx.hoursPerDay);
	}

	/** Số tháng tròn từ ngày thâm niên đến cuối kỳ (điều kiện T). */
	function tenureMonths(seniorityDate, periodEnd) {
		if (!seniorityDate || Dates.cmp(seniorityDate, periodEnd) > 0) return 0;
		const y1 = Dates.year(seniorityDate), m1 = Dates.month(seniorityDate), d1 = Dates.day(seniorityDate);
		const y2 = Dates.year(periodEnd), m2 = Dates.month(periodEnd), d2 = Dates.day(periodEnd);
		return (y2 - y1) * 12 + m2 - m1 - (d2 < d1 ? 1 : 0);
	}

	/** Dữ kiện của điều kiện; null = không xác định. */
	function conditionFact(field, ctx) {
		switch (norm(field)) {
			case "D":
				return workDaysOf(ctx);
			case "U":
				return D(ctx.unpaidLeaveDays);
			case "L":
				return D(ctx.lateCount);
			case "A":
				return D(bool(ctx.isActive, true) ? 1 : 0);
			case "T":
				return D(tenureMonths(ctx.seniorityDate, ctx.periodEnd));
			case "P": {
				const target = D(ctx.salesTarget);
				if (target.lte(0)) return null;
				return D(ctx.salesAmount).times(100).div(target);
			}
			default:
				return null;
		}
	}

	/** Hệ số điều kiện (4.2.6): 1 khi đạt, 0 hoặc giảm theo đơn vị vi phạm khi không đạt. Trả Decimal. */
	function conditionFactor(rule, ctx) {
		let violation = D(0);
		let failed = false;
		for (const c of rule.conditions || []) {
			const actual = conditionFact(c.field, ctx);
			if (actual === null) return D(0);
			const v = D(c.value);
			const op = norm(c.comparison);
			const miss = op === "G" ? Money.max(0, v.minus(actual)) : op === "L" ? Money.max(0, actual.minus(v)) : actual.minus(v).abs();
			if (miss.gt(0)) {
				failed = true;
				violation = violation.plus(miss);
			}
		}
		if (!failed) return D(1);
		if (norm(rule.failAction) !== "R" || D(rule.reductionPercent).lte(0)) return D(0);
		return Money.max(0, D(1).minus(D(rule.reductionPercent).div(100).times(violation)));
	}

	/** Số lượng theo nguồn (4.2.3). generated: dòng đã sinh trong lần chạy (cho nguồn E). */
	function quantity(rule, ctx, generated) {
		switch (norm(rule.quantitySource || "K")) {
			case "K":
				return D(1);
			case "D":
				return workDaysOf(ctx);
			case "B": {
				if (norm(ctx.salaryType || "M") !== "H") return workDaysOf(ctx);
				const hours = D(ctx.regularHours);
				if (hours.gt(0)) return hours;
				return bool(rule.hoursFallbackToWorkDays, false) ? workDaysOf(ctx).times(hoursPerDay(ctx)) : D(0);
			}
			case "O": {
				const amounts = ctx.outputAmounts || {};
				if (!blank(rule.rateTable)) return D(amounts[norm(rule.rateTable)]);
				return Money.sum(Object.keys(amounts), (k) => amounts[k]);
			}
			case "J": {
				const days = new Set();
				for (const t of ctx.timeLines || []) if (!blank(t.project)) days.add(Dates.iso(t.date));
				return D(days.size);
			}
			case "S":
				return D(ctx.salesAmount);
			case "E": {
				const base = norm(rule.baseEarningType);
				return Money.sum(generated.filter((g) => norm(g.earningType) === base), (g) => g.amount);
			}
			case "H": {
				const counts = ctx.shiftCounts || {};
				if (!blank(rule.shiftKind)) return D(counts[norm(rule.shiftKind)]);
				return Money.sum(Object.keys(counts), (k) => counts[k]);
			}
			default:
				return D(0);
		}
	}

	/** Đơn giá đơn vị theo nguồn (4.2.4): [{unit, earningType, monthly}] (gói phúc lợi: nhiều phần). */
	function units(rule, ctx) {
		const comp = ctx.compensation || {};
		const monthlySalary = norm(ctx.salaryType || "M") === "M";
		switch (norm(rule.rateSource || "F")) {
			case "F":
				return [{ unit: D(rule.fixedRate), earningType: rule.earningType, monthly: false }];
			case "S":
				return [{ unit: D(comp.baseSalary), earningType: rule.earningType, monthly: monthlySalary }];
			case "A":
				return [{ unit: D(comp.fixedAllowance), earningType: rule.earningType, monthly: true }];
			case "P":
				return (comp.benefitLines || []).map((b) => ({ unit: D(b.amount), earningType: b.earningType, monthly: true }));
			case "Q":
				return [{ unit: D(1), earningType: rule.earningType, monthly: false }];
			case "C":
				return [{ unit: D(rule.fixedRate).div(100), earningType: rule.earningType, monthly: false, percent: true }];
			default:
				return [];
		}
	}

	/** Dòng của một quy tắc (chưa áp hệ số điều kiện). */
	function evaluateRule(rule, ctx, generated) {
		const mult = rule.multiplier === null || rule.multiplier === undefined || rule.multiplier === "" ? D(1) : D(rule.multiplier);
		const base = { ruleCode: rule.code, rateSource: norm(rule.rateSource), quantitySource: norm(rule.quantitySource), rateTable: norm(rule.rateTable), source: "S" };
		if (norm(rule.rateSource) === "T") {
			const qty = quantity(rule, ctx, generated);
			const table = (ctx.rateTables || {})[norm(rule.rateTable)];
			const tiers = RateTable.tiersAt(table ? table.lines : [], ctx.periodEnd);
			const amount = Money.round(RateTable.tieredAmount(qty, tiers, rule.tierMethod || "P").times(mult));
			if (amount === 0) return [];
			const rate = qty.isZero() || mult.isZero() ? D(0) : D(Money.roundTo(D(amount).div(qty).div(mult), 6));
			return [Object.assign({}, base, { earningType: rule.earningType, quantity: qty.toNumber(), rate: Money.roundTo(rate.times(100), 2), multiplier: mult.toNumber(), amount })];
		}
		const prorate = norm(rule.proration) === "A" || (norm(rule.proration) === "M" && norm(ctx.salaryType || "M") === "M");
		const std = D(ctx.standardDays);
		const out = [];
		for (const u of units(rule, ctx)) {
			if (u.unit.isZero()) continue;
			let qty;
			let rate;
			let amount;
			if (prorate) {
				if (std.lte(0)) throw missingStandardDays();
				qty = quantity(rule, ctx, generated);
				rate = D(Money.round(u.unit.div(std)));
				amount = Money.round(u.unit.times(qty).times(mult).div(std));
			} else if (u.monthly) {
				qty = D(1);
				rate = u.unit;
				amount = Money.round(u.unit.times(mult));
			} else {
				qty = quantity(rule, ctx, generated);
				rate = u.unit;
				amount = Money.round(u.unit.times(qty).times(mult));
			}
			if (amount === 0) continue;
			const shown = u.percent ? rate.times(100) : rate;
			out.push(Object.assign({}, base, { earningType: u.earningType, quantity: qty.toNumber(), rate: Money.roundTo(shown, 2), multiplier: mult.toNumber(), amount }));
		}
		return out;
	}

	/**
	 * Chạy bộ quy tắc cho một nhân viên.
	 * @param {Array} rules quy tắc khai trong tenant (rỗng = bộ mặc định V2 dựng từ setup)
	 * @param {Object} ctx ngữ cảnh nhân viên
	 * @param {Object} [options] {setup, earningTypes: {CODE: {taxTreatment}}}
	 * @returns {{lines: Array, baseSalaryTotal: number, benefitTotal: number}}
	 */
	function run(rules, ctx, options) {
		const opts = options || {};
		const list = rules && rules.length ? rules : VietnamDefaults.defaultEarningRules(opts.setup);
		const generated = [];
		for (const rule of sortRules(list.filter((r) => applies(r, ctx)))) {
			const factor = conditionFactor(rule, ctx);
			if (factor.lte(0)) continue;
			let lines = evaluateRule(rule, ctx, generated);
			if (factor.lt(1)) {
				lines = lines
					.map((l) => Object.assign(l, { amount: Money.round(D(l.amount).times(factor)), multiplier: Money.roundTo(D(l.multiplier).times(factor), 4) }))
					.filter((l) => l.amount !== 0);
			}
			for (const l of lines) {
				const type = opts.earningTypes && opts.earningTypes[norm(l.earningType)];
				l.taxExemptAmount = exemptPortion(type ? type.taxTreatment : "T", l.amount, l.amount);
				generated.push(l);
			}
		}
		return {
			lines: generated,
			baseSalaryTotal: Money.sum(generated.filter((l) => l.rateSource === "S"), (l) => l.amount).toNumber(),
			benefitTotal: Money.sum(generated.filter((l) => l.rateSource === "P"), (l) => l.amount).toNumber(),
		};
	}

	/**
	 * Phần miễn thuế ghi trên dòng (4.1.1): E toàn bộ; P max(0, min(Amount, phần chênh)); T và C 0 (trần C áp ở lõi thuế).
	 * @param {string} taxTreatment T | E | C | P
	 * @param {*} amount số tiền dòng
	 * @param {*} premium phần chênh (OT: Amount - Round(Qty x Rate); dòng quy tắc: bằng Amount)
	 */
	function exemptPortion(taxTreatment, amount, premium) {
		const t = norm(taxTreatment || "T");
		if (t === "E") return D(amount).toNumber();
		if (t === "P") return Money.max(0, Money.min(amount, premium)).toNumber();
		return 0;
	}

	/** Kiểm tra khi lưu quy tắc (4.2.1). Trả danh sách lỗi tiếng Việt. */
	function validateRule(rule, allRules) {
		const errors = [];
		const rs = norm(rule.rateSource);
		if (rs !== "P" && blank(rule.earningType)) errors.push("Quy tắc phải có loại thu nhập (trừ nguồn đơn giá gói phúc lợi).");
		if (rule.effectiveDate && rule.expirationDate && Dates.cmp(rule.expirationDate, rule.effectiveDate) < 0) errors.push("Ngày hết hiệu lực trước ngày hiệu lực.");
		if (rs === "T" && blank(rule.rateTable)) errors.push("Nguồn thang % phải có bảng đơn giá.");
		if (norm(rule.quantitySource) === "E") {
			if (blank(rule.baseEarningType)) errors.push("Nguồn số tiền của loại thu nhập khác phải có loại thu nhập cơ sở.");
			else {
				const seq = (r) => (r.sequence === null || r.sequence === undefined || r.sequence === "" ? 100 : Number(r.sequence));
				const ok = (allRules || []).some((r) => norm(r.code) !== norm(rule.code) && norm(r.earningType) === norm(rule.baseEarningType) && seq(r) < seq(rule));
				if (!ok) errors.push(`Không có quy tắc nào có thứ tự nhỏ hơn sinh loại thu nhập cơ sở ${rule.baseEarningType}.`);
			}
		}
		if (String(rule.code || "").length > 15) errors.push("Mã quy tắc tối đa 15 ký tự.");
		return errors;
	}

	// ---- Giờ công: chọn loại thu nhập, OT và làm đêm (4.1.1, 2.6, 4.2.9 bước 3) ----

	/** Đơn giá giờ theo loại lương (không làm tròn): M lương / (chuẩn x giờ/ngày); D lương / giờ/ngày; H lương. */
	function hourlyRate(salaryType, baseSalary, standardDays, hoursPerDayValue) {
		const hpd = hoursPerDayValue === null || hoursPerDayValue === undefined || hoursPerDayValue === "" || D(hoursPerDayValue).lte(0) ? D(8) : D(hoursPerDayValue);
		const t = norm(salaryType || "M");
		if (t === "H") return D(baseSalary);
		if (t === "D") return D(baseSalary).div(hpd);
		if (D(standardDays).lte(0)) throw missingStandardDays();
		return D(baseSalary).div(D(standardDays).times(hpd));
	}

	/**
	 * Chọn loại thu nhập cho một dòng giờ; null = bỏ qua (giờ thường đã nằm trong lương cơ bản).
	 * @param {{earningType, timeType, isOvertime, isNight, dayType}} t dòng giờ
	 * @param {Array} earningTypes [{code, isActive, isOvertime, overtimeDayType, isNight, timeTypeCode}]
	 */
	function selectEarningType(t, earningTypes) {
		const active = (earningTypes || []).filter((e) => bool(e.isActive, true)).sort((a, b) => (norm(a.code) < norm(b.code) ? -1 : norm(a.code) > norm(b.code) ? 1 : 0));
		const isOt = bool(t.isOvertime, false);
		const dayType = norm(t.dayType || "N");
		if (!blank(t.earningType)) {
			const own = active.find((e) => norm(e.code) === norm(t.earningType));
			if (own) return own;
		}
		const mapped = blank(t.timeType) ? null : active.find((e) => norm(e.timeTypeCode) === norm(t.timeType)) || null;
		if (!isOt && !(mapped && bool(mapped.isNight, false))) return null;
		if (mapped && bool(mapped.isOvertime, false) === isOt && (!isOt || norm(mapped.overtimeDayType || "N") === dayType)) return mapped;
		const night = t.isNight === null || t.isNight === undefined ? (mapped ? bool(mapped.isNight, false) : false) : bool(t.isNight, false);
		const hit = active.find((e) => bool(e.isOvertime, false) === isOt && bool(e.isNight, false) === night && (!isOt || norm(e.overtimeDayType || "N") === dayType));
		if (!hit) {
			throw Errors.invalid(`There is no earning type for day type ${dayType}.`, `Không có loại thu nhập cho loại ngày ${dayType}.`);
		}
		return hit;
	}

	/** Hệ số OT, làm đêm (2.6.1) từ tham số OT.* tại ngày tính. */
	function multiplier(provider, date, segment) {
		const night = provider.getValue("OT.NIGHT_PREMIUM", date);
		const dayType = norm(segment.dayType || "N");
		if (!segment.isOvertime) return segment.isNight ? D(1).plus(night) : D(1);
		const ot = provider.getValue(dayType === "H" ? "OT.HOLIDAY" : dayType === "W" ? "OT.WEEKLY_OFF" : "OT.NORMAL_DAY", date);
		if (!segment.isNight) return ot;
		const dayBase = dayType === "N" ? (segment.hadDaytimeOvertime ? ot : D(1)) : ot;
		return ot.plus(night).plus(provider.getValue("OT.NIGHT_EXTRA", date).times(dayBase));
	}

	/**
	 * Dòng thu nhập nguồn Time từ dòng giờ (OT và phụ cấp đêm trong giờ chuẩn).
	 * @param {{timeLines: Array<{earningType, timeType, isOvertime, isNight, dayType, hours, project, task, costCode}>,
	 *          earningTypes: Array, hourlyRate, provider, date}} input  date = ngày cuối kỳ (tra tham số)
	 */
	function timeEarnings(input) {
		const rate = D(input.hourlyRate);
		const groups = new Map();
		for (const t of input.timeLines || []) {
			const hours = D(t.hours);
			if (hours.lte(0)) continue;
			const type = selectEarningType(t, input.earningTypes);
			if (!type) continue;
			const dayType = bool(type.isOvertime, false) ? norm(t.dayType || "N") : "N";
			const key = [norm(type.code), dayType, norm(t.project), norm(t.task), norm(t.costCode)].join("|");
			const g = groups.get(key) || { type, dayType, project: t.project || "", task: t.task || "", costCode: t.costCode || "", hours: D(0) };
			g.hours = g.hours.plus(hours);
			groups.set(key, g);
		}
		const out = [];
		for (const g of groups.values()) {
			if (rate.lt(0) || g.hours.lt(0)) throw Errors.invalid("The hourly rate and hours cannot be negative.", "Đơn giá giờ và số giờ không được âm.");
			const seg = { dayType: g.dayType, isOvertime: bool(g.type.isOvertime, false), isNight: bool(g.type.isNight, false), hadDaytimeOvertime: bool(g.type.hadDaytimeOvertime, false) };
			const m = multiplier(input.provider, input.date, seg);
			const amount = Money.round(rate.times(g.hours).times(m));
			const baseAmount = Money.round(rate.times(g.hours));
			const common = { earningType: g.type.code, quantity: g.hours.toNumber(), rate: Money.roundTo(rate, 2), source: "T", dayType: g.dayType, project: g.project, task: g.task, costCode: g.costCode, hours: g.hours.toNumber() };
			if (seg.isOvertime) {
				out.push(Object.assign(common, { multiplier: m.toNumber(), amount, taxExemptAmount: exemptPortion(g.type.taxTreatment || "P", amount, amount - baseAmount) }));
			} else {
				const premium = amount - baseAmount;
				if (premium === 0) continue;
				out.push(Object.assign(common, { multiplier: m.minus(1).toNumber(), amount: premium, taxExemptAmount: premium }));
			}
		}
		return out;
	}

	/**
	 * Dòng nhập tay (4.2.9 bước 6): không khóa số tiền thì Amount = Round(Qty x Rate x Multiplier) (hệ số trống = 1);
	 * phần miễn = ExemptPortion(loại, Amount, Amount - Round(Qty x Rate)).
	 */
	function manualLine(line, earningType) {
		const mult = line.multiplier === null || line.multiplier === undefined || line.multiplier === "" ? D(1) : D(line.multiplier);
		const locked = bool(line.amountLocked, false);
		const amount = locked ? Money.round(line.amount) : Money.round(D(line.quantity).times(D(line.rate)).times(mult));
		const premium = amount - Money.round(D(line.quantity).times(D(line.rate)));
		return Object.assign({}, line, { multiplier: mult.toNumber(), amount, source: "M", taxExemptAmount: exemptPortion(earningType ? earningType.taxTreatment : "T", amount, premium) });
	}

	return {
		run, applies, sortRules, conditionFactor, tenureMonths, quantity, evaluateRule, validateRule, exemptPortion,
		hourlyRate, selectEarningType, multiplier, timeEarnings, manualLine,
	};
});
