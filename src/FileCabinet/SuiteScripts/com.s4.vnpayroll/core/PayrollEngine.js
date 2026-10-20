/**
 * Tính lương một nhân viên trên bảng lương (đặc tả 2.5.3 và 4.2.9), nối các module lõi theo đúng thứ tự cố định:
 * dữ kiện -> quy tắc thu nhập -> OT và làm đêm từ giờ công -> trả phép khi nghỉ việc -> dòng nhập tay -> lõi phiếu lương
 * (BH, thuế, khấu trừ, cấn trừ tạm ứng; kỳ tuần / nửa tháng qua gộp tháng thuế) -> trích trước tháng 13 -> phân bổ chi phí.
 *
 * Không gọi API NetSuite: lớp api thu thập dữ liệu thành ctx / emp, gọi calculateEmployee, ghi kết quả.
 *
 * ctx: {period: {start, end, frequency, taxMonth, isLastInTaxMonth, standardWorkDays},
 *       settings: {standardWorkDays, standardHoursPerDay, unionFundApplicable, defaultRegion, occupationalAccidentRate,
 *                  extendedOvertimeSector, accrual13Basis, accrual13Months, allocationMethod, allocationFallback,
 *                  allocationVersionMode, payGroupCode, leavePayoutEarningType, ruleSetup},
 *       provider, earningTypes: [{code, taxTreatment, exemptCapParam, isOvertime, ...}], rules: [], benefitPackages: {CODE: [{earningType, amount}]},
 *       rateTables: {}}
 * emp:  {employee, code, name, employmentType E/C, salaryType M/D/H, pitMethod, hasFlatTaxCommitment, insuranceApplicable,
 *        unemploymentApplicable, isUnionMember, region, accrue13, isActive, seniorityDate, hireDate, terminationDate, salesTarget,
 *        compensation: {effectiveDate, baseSalary, insuranceWage, fixedAllowance, package}, dependents: [{deductFrom, deductTo}],
 *        line: {standardDays, workDays, absenceDays, unpaidLeaveDays, otherTaxDeductions, lateCount},
 *        timeLines, manualEarnings: [{earningType, quantity, rate, multiplier, amount, amountLocked, description, project, branch, workCenter}],
 *        deductions: [{code, name, amount, account}], openAdvances: [{refNbr, date, balance}], prior: {earnings, absenceWorkingDays, otherTaxDeductions},
 *        leaveRemaining, yearToDateOvertimeHours, outputAmounts, salesAmount, outputShares, shiftCounts, rosterDays, allocationVersions,
 *        defaults: {project, task, branch, workCenter}, accounts: {workCenters, projects, employeeAccount, employeeSub, defaultAccount, defaultSub}}
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
	"./Money", "./Dates", "./Errors", "./EarningRuleEngine", "./PayrollExtras", "./PaycheckCalculator", "./TaxMonthAggregator", "./OvertimeCalculator",
	"./EmploymentDays", "./AllocationSourceResolver", "./CostAllocationBuilder",
], (Money, Dates, Errors, Rules, Extras, Paycheck, Aggregator, Overtime, EmploymentDays, Resolver, CostAllocation) => {
	const D = Money.D;
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const blank = (v) => v === null || v === undefined || v === "";

	function warning(code, message, messageVi) {
		return { code, message, messageVi };
	}

	/** Ngày công chuẩn: dòng > kỳ > thiết lập (nhóm lương); không có mặc định 26 (V3). */
	function standardDaysOf(ctx, emp) {
		const line = emp.line || {};
		for (const v of [line.standardDays, ctx.period.standardWorkDays, ctx.settings.standardWorkDays]) if (!blank(v) && D(v).gt(0)) return D(v);
		throw Errors.invalid("Standard work days are not specified for the pay period or pay group.", "Chưa khai ngày công chuẩn cho kỳ lương hoặc nhóm lương.");
	}

	function calculateEmployee(ctx, emp) {
		const period = ctx.period;
		const settings = ctx.settings || {};
		const provider = ctx.provider;
		const date = period.end;
		const types = ctx.earningTypes || [];
		const typeByCode = {};
		for (const t of types) typeByCode[norm(t.code)] = t;
		// Cảnh báo do lớp gọi đưa vào (giấy phép lao động sắp hết hạn...) đứng đầu danh sách
		const warnings = (emp.extraWarnings || []).slice();
		const isContractor = norm(emp.employmentType) === "C";

		if (!emp.compensation) throw Errors.invalid("The employee has no compensation effective on the period end date.", "Nhân viên chưa có lịch sử lương hiệu lực đến cuối kỳ.");
		const comp = emp.compensation;
		if (!(D(comp.baseSalary).gt(0))) throw Errors.invalid("The contract salary must be greater than zero.", "Lương hợp đồng phải lớn hơn 0.");

		// 1. Dữ kiện
		const standardDays = standardDaysOf(ctx, emp);
		const line = emp.line || {};
		const workDays = blank(line.workDays) ? standardDays : D(line.workDays);
		const hoursPerDay = blank(settings.standardHoursPerDay) || D(settings.standardHoursPerDay).lte(0) ? D(8) : D(settings.standardHoursPerDay);
		const timeLines = emp.timeLines || [];
		const regularHours = Money.sum(timeLines.filter((t) => !t.isOvertime), (t) => t.hours);
		const pkg = (ctx.benefitPackages || {})[norm(comp.package)] || [];
		const packageMonthly = Money.sum(pkg, (l) => l.amount);

		// 2. Quy tắc thu nhập
		const ruleCtx = {
			periodEnd: date, payGroup: settings.payGroupCode || "DEFAULT", salaryType: emp.salaryType || "M", employmentType: emp.employmentType || "E",
			standardDays: standardDays.toNumber(), workDays: workDays.toNumber(), hoursPerDay: hoursPerDay.toNumber(),
			compensation: { baseSalary: comp.baseSalary, fixedAllowance: comp.fixedAllowance || 0, benefitLines: pkg },
			regularHours: regularHours.toNumber(), timeLines, outputAmounts: emp.outputAmounts || {}, salesAmount: emp.salesAmount || 0,
			shiftCounts: emp.shiftCounts || {}, unpaidLeaveDays: line.unpaidLeaveDays || 0, lateCount: line.lateCount || 0,
			isActive: emp.isActive !== false, seniorityDate: emp.seniorityDate || emp.hireDate || null, salesTarget: emp.salesTarget || 0,
			rateTables: ctx.rateTables || {},
		};
		const typeTax = {};
		for (const t of types) typeTax[norm(t.code)] = { taxTreatment: t.taxTreatment };
		const ruleResult = Rules.run(ctx.rules || [], ruleCtx, { setup: settings.ruleSetup || {}, earningTypes: typeTax });
		const earnings = ruleResult.lines.map((l) => Object.assign({}, l, { source: "S" }));

		// 3. OT và làm đêm từ giờ công
		const hourly = Extras.hourlyRate({ salaryType: emp.salaryType || "M", baseSalary: comp.baseSalary, standardDays, hoursPerDay });
		const overtimeHours = Money.sum(timeLines.filter((t) => t.isOvertime), (t) => t.hours);
		earnings.push(...Rules.timeEarnings({ timeLines, earningTypes: types, hourlyRate: hourly, provider, date }));

		// 4. Trả phép khi nghỉ việc (2.10.2): dòng nhập tay cùng loại được ưu tiên
		const manual = emp.manualEarnings || [];
		const payoutCode = norm(settings.leavePayoutEarningType);
		if (!isContractor && emp.terminationDate && EmploymentDays.terminatesIn(emp.terminationDate, period.start, period.end)) {
			if (!payoutCode || !typeByCode[payoutCode]) {
				warnings.push(warning("LeavePayoutTypeMissing", "The leave payout earning type is not configured; unused leave is not paid.", "Chưa khai loại thu nhập trả phép khi nghỉ việc; chưa trả tiền phép còn lại."));
			} else if (!manual.some((m) => norm(m.earningType) === payoutCode) && D(emp.leaveRemaining).gt(0)) {
				const daily = Extras.dailyRate({ salaryType: emp.salaryType || "M", baseSalary: comp.baseSalary, standardDays, hoursPerDay });
				const p = Extras.leavePayout({ remainingDays: emp.leaveRemaining, dailyRate: daily });
				if (p.amount !== 0) {
					const t = typeByCode[payoutCode];
					earnings.push({
						earningType: payoutCode, quantity: p.quantity, rate: Money.roundTo(p.rate, 2), multiplier: 1, amount: p.amount, source: "S", ruleCode: "TRAPHEP",
						taxExemptAmount: Rules.exemptPortion(t.taxTreatment, p.amount, p.amount),
					});
				}
			}
		}

		// 5. Dòng nhập tay
		for (const m of manual) {
			const t = typeByCode[norm(m.earningType)];
			if (!t) throw Errors.invalid(`Earning type ${m.earningType} does not exist.`, `Loại thu nhập ${m.earningType} không tồn tại.`);
			earnings.push(Rules.manualLine(Object.assign({}, m, { earningType: norm(m.earningType) }), t));
		}

		// 6. Lõi phiếu lương
		const toPaycheck = (e) => {
			const t = typeByCode[norm(e.earningType)] || {};
			return { code: norm(e.earningType), amount: e.amount, taxTreatment: t.taxTreatment || "T", taxExemptAmount: e.taxExemptAmount || 0, exemptCapParameter: t.exemptCapParam || "" };
		};
		const overrides = {};
		if (!blank(settings.occupationalAccidentRate)) overrides.BHTNLD = settings.occupationalAccidentRate;
		const current = {
			periodStart: period.start,
			periodEnd: period.end,
			employee: {
				employeeCd: emp.code, pitMethod: emp.pitMethod || "P", hasFlatTaxCommitment: !!emp.hasFlatTaxCommitment, dependents: emp.dependents || [],
				insuranceApplicable: emp.insuranceApplicable !== false && !isContractor, unemploymentApplicable: emp.unemploymentApplicable !== false && !isContractor,
				insuranceWage: comp.insuranceWage || 0, region: blank(emp.region) ? settings.defaultRegion : emp.region, isUnionMember: !!emp.isUnionMember,
			},
			earnings: earnings.filter((e) => e.amount !== 0).map(toPaycheck),
			absenceWorkingDays: line.absenceDays || 0,
			otherDeductions: (emp.deductions || []).map((d) => ({ code: d.code, amount: d.amount })),
			otherTaxDeductions: line.otherTaxDeductions || 0,
			openAdvances: emp.openAdvances || [],
			employerRateOverrides: overrides,
			unionFundApplicable: settings.unionFundApplicable !== false,
		};
		const freq = norm(period.frequency || "M");
		let pay;
		if (freq === "" || freq === "M") pay = Paycheck.calculate(current, provider);
		else {
			const taxMonth = period.taxMonth || Dates.yyyymm(period.end);
			const tmStart = `${taxMonth.slice(0, 4)}-${taxMonth.slice(4, 6)}-01`;
			pay = Aggregator.calculate({ current, isLastInTaxMonth: !!period.isLastInTaxMonth, taxMonthStart: tmStart, taxMonthEnd: Dates.endOfMonth(tmStart), prior: emp.prior || {} }, provider);
		}
		warnings.push(...(pay.warnings || []));

		// 7. Giới hạn OT (chỉ cảnh báo, tháng xét theo bảng lương hiện tại: monthToDate = 0)
		if (overtimeHours.gt(0)) {
			const lim = Overtime.checkLimits({ monthToDate: 0, yearToDate: emp.yearToDateOvertimeHours || 0, newHours: overtimeHours, extendedSector: !!settings.extendedOvertimeSector }, provider, date);
			if (lim.monthExceeded) warnings.push(warning("OvertimeLimit", `Overtime ${overtimeHours} hours exceeds the monthly limit of ${lim.monthLimit} hours.`, `Giờ làm thêm ${overtimeHours} vượt giới hạn tháng ${lim.monthLimit} giờ.`));
			if (lim.yearExceeded) warnings.push(warning("OvertimeLimit", `Overtime exceeds the yearly limit of ${lim.yearLimit} hours.`, `Giờ làm thêm vượt giới hạn năm ${lim.yearLimit} giờ.`));
		}

		// 8. Trích trước tháng 13, phân bổ chi phí
		const accrued13th = Extras.accrued13th({
			accrue13th: !!emp.accrue13, isContractor, salaryType: emp.salaryType || "M", baseSalary: comp.baseSalary, packageMonthly,
			basis: settings.accrual13Basis || "P", months: settings.accrual13Months || 12,
		});
		const defaults = emp.defaults || {};
		const targets = Resolver.resolve({
			method: blank(emp.allocationMethod) || emp.allocationMethod === "S" ? settings.allocationMethod || "F" : emp.allocationMethod,
			fallback: settings.allocationFallback || "P", versionMode: settings.allocationVersionMode || "E", periodStart: period.start, periodEnd: period.end,
			timeLines, versions: emp.allocationVersions || [], rosterDays: emp.rosterDays || [], defaultProject: defaults.project || "", defaultTask: defaults.task || "",
			defaultBranch: defaults.branch || "", defaultWorkCenter: defaults.workCenter || "",
		});
		const allocations = CostAllocation.build({
			grossPay: pay.grossPay, employerInsurance: pay.employerInsurance, earnings, outputShares: emp.outputShares || [], targets,
			defaultBranch: defaults.branch || "", defaultWorkCenter: defaults.workCenter || "", accounts: emp.accounts || {},
		});

		const insurance = (pay.insurance && pay.insurance.lines) || [];
		return {
			employee: emp.employee,
			standardDays: standardDays.toNumber(),
			workDays: workDays.toNumber(),
			hourlyRate: Money.roundTo(hourly, 2),
			overtimeHours: overtimeHours.toNumber(),
			baseSalary: ruleResult.baseSalaryTotal,
			benefit: ruleResult.benefitTotal,
			insuranceWage: comp.insuranceWage || 0,
			earnings,
			grossPay: pay.grossPay,
			taxExemptIncome: pay.taxExemptIncome,
			taxableIncome: pay.taxableIncome,
			employeeInsurance: pay.employeeInsurance,
			employeeCompulsoryInsurance: pay.employeeCompulsoryInsurance,
			employerInsurance: pay.employerInsurance,
			insurance: insurance.map((l) => ({ code: l.code, description: l.description, wageBase: l.wageBase, employeeRate: l.employeeRate, employerRate: l.employerRate, employeeAmount: l.employeeAmount, employerAmount: l.employerAmount })),
			dependentCount: pay.dependentCount,
			familyDeduction: pay.pit ? pay.pit.familyDeduction : 0,
			assessableIncome: pay.pit ? pay.pit.assessableIncome : 0,
			pit: pay.pit ? pay.pit.tax : 0,
			otherDeductions: pay.otherDeductions,
			netBeforeAdvance: pay.netBeforeAdvance,
			advanceOffsets: ((pay.advanceOffset && pay.advanceOffset.lines) || []).filter((l) => l.amount > 0),
			advanceOffset: pay.advanceOffset ? pay.advanceOffset.totalOffset : 0,
			netPay: pay.netPay,
			employerCost: pay.employerCost,
			accrued13th,
			allocations,
			warnings: dedupe(warnings),
		};
	}

	function dedupe(list) {
		const seen = new Set();
		return list.filter((w) => {
			const k = `${w.code}|${w.message}`;
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		});
	}

	return { calculateEmployee, standardDaysOf };
});
