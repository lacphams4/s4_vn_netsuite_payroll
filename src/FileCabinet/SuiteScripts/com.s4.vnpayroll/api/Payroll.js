/**
 * Bảng lương (VP302000) trên NetSuite: tạo, nạp nhân viên, tính, trạng thái và duyệt, ghi sổ Journal Entry, đảo,
 * bill cơ quan thu, file chi lương ngân hàng (đặc tả 1.1.5, 1.2.1, 1.2.5, 3.5, 4.6).
 *
 * Ánh xạ chiều phân tích: tiểu khoản (cost center) -> Department, chi nhánh -> Location, work center -> Class,
 * dự án -> Customer:Project (entity của dòng JE). Một bảng lương thuộc một subsidiary; không bút toán liên công ty.
 * NetSuite không có giao dịch nhiều record: ghi sổ lưu id JE lên bảng lương ngay sau khi tạo rồi mới cập nhật tạm ứng,
 * chạy lại được (idempotent theo trường journal).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
	"N/query", "N/record", "N/runtime", "./Store", "./Settings",
	"../core/Money", "../core/Dates", "../core/PayrollEngine", "../core/EmploymentDays", "../core/PayrollJournalBuilder", "../core/BankFileWriter",
	"../core/VietnameseNumberReader", "../core/LeaveLedger", "./Output", "./WorkPermits", "./AllocationPlans", "../core/PlanRecords",
], (query, record, runtime, Store, Settings, Money, Dates, Engine, EmploymentDays, Journal, BankFile, Words, Ledger, Output, WorkPermits, AllocationPlans, PlanRecords) => {
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const blank = (v) => v === null || v === undefined || v === "";
	const LOCK_AFTER = ["A", "R", "V"];

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function lang() {
		try {
			return /^vi/i.test(String(runtime.getCurrentUser().getPreference({ name: "LANGUAGE" }) || "")) ? "vi" : "en";
		} catch (e) {
			return "vi";
		}
	}

	// ------------------------------------------------------------------ dữ liệu tham chiếu

	function getBatch(id) {
		const b = Store.get("batch", id);
		if (!b) throw fail("Payroll batch not found", "Không tìm thấy bảng lương");
		return b;
	}

	function employeesInfo(ids) {
		const out = {};
		const list = [...new Set(ids.filter((x) => !blank(x)).map(String))];
		for (let i = 0; i < list.length; i += 900) {
			const chunk = list.slice(i, i + 900);
			const rows = Store.run(
				`SELECT e.id, e.entityid, e.firstname, e.lastname, e.isinactive, e.department, e.location, e.class, e.subsidiary, BUILTIN.DF(e.department) AS deptname
				 FROM employee e WHERE e.id IN (${chunk.map(() => "?").join(",")})`,
				chunk,
				"s4vp_employee_info"
			);
			for (const r of rows) {
				const name = [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || r.entityid;
				out[String(r.id)] = { id: String(r.id), code: r.entityid, name, isInactive: r.isinactive === "T", department: r.department, location: r.location, cls: r.class, subsidiary: r.subsidiary, departmentName: r.deptname || "" };
			}
		}
		return out;
	}

	/** Ngữ cảnh chung của một bảng lương: kỳ, thiết lập hiệu lực, tham số, loại thu nhập, quy tắc, gói phúc lợi. */
	function context(batch) {
		const period = Store.get("period", batch.period);
		if (!period) throw fail("Pay period not found", "Không tìm thấy kỳ lương");
		const group = Store.get("paygroup", period.paygroup);
		const settings = Settings.resolve(batch.subsidiary, group);
		const ets = Settings.earningTypes();
		const codeOf = (id) => (id && ets.byId[id] ? ets.byId[id].code : "");
		const groups = {};
		for (const g of Store.find("paygroup", { includeInactive: true })) groups[g.id] = String(g.name).trim().toUpperCase();
		const conds = {};
		for (const c of Store.find("rule_cond")) (conds[c.rule] = conds[c.rule] || []).push({ field: c.field, comparison: c.operator, value: c.value });
		const rules = Store.find("earning_rule", { includeInactive: true }).map((r) => ({
			code: String(r.name).trim().toUpperCase(), description: r.description, sequence: blank(r.sequence) ? 100 : r.sequence, earningType: codeOf(r.earning_type),
			payGroup: r.paygroup ? groups[r.paygroup] : "", salaryType: r.salary_type || "", employmentType: r.employment_type || "", effectiveDate: r.effective,
			expirationDate: r.expiration, quantitySource: r.qty_source, hoursFallbackToWorkDays: r.hours_fallback, baseEarningType: codeOf(r.base_et),
			shiftKind: r.shift_kind || "", rateTable: r.rate_table || "", rateSource: r.rate_source, fixedRate: r.fixed_rate, tierMethod: r.tier_method || "P",
			multiplier: blank(r.multiplier) ? 1 : r.multiplier, proration: r.proration || "N", conditions: conds[r.id] || [], failAction: r.fail_action || "N",
			reductionPercent: r.reduction || 0, isActive: !r.isInactive,
		}));
		const pkgNames = {};
		for (const p of Store.find("benefit_pkg", { includeInactive: true })) pkgNames[p.id] = String(p.name).trim().toUpperCase();
		const benefitPackages = {};
		for (const l of Store.find("benefit_line")) {
			const code = pkgNames[l.package];
			if (code) (benefitPackages[code] = benefitPackages[code] || []).push({ earningType: codeOf(l.earning_type), amount: l.amount || 0 });
		}
		const ids = settings.earningTypeIds;
		settings.leavePayoutEarningType = codeOf(ids.payout);
		settings.ruleSetup = { baseEarningType: codeOf(ids.base), contractorEarningType: codeOf(ids.contractor), allowanceEarningType: codeOf(ids.allowance), mealEarningType: codeOf(ids.meal), mealAllowanceAmount: settings.mealAllowanceAmount };
		return {
			batch, period, group, settings, provider: Settings.provider(), earningTypes: ets, rules, benefitPackages, packageNames: pkgNames,
			holidays: Settings.holidays().map((h) => h.date),
			engineCtx: null,
		};
	}

	function engineContext(c) {
		const p = c.period;
		return {
			period: { start: p.start, end: p.end, frequency: p.frequency || c.settings.frequency, taxMonth: p.tax_month || Dates.yyyymm(p.end), isLastInTaxMonth: p.last_in_month, standardWorkDays: p.std_days },
			settings: c.settings, provider: c.provider, earningTypes: c.earningTypes.list, rules: c.rules, benefitPackages: c.benefitPackages, rateTables: {},
		};
	}

	// ------------------------------------------------------------------ tạo, nạp nhân viên

	function create(input) {
		const period = Store.get("period", input.period);
		if (!period) throw fail("Pay period not found", "Không tìm thấy kỳ lương");
		if (period.status === "C") throw fail("The pay period is closed", "Kỳ lương đã đóng");
		const sub = input.subsidiary;
		const company = Settings.company(sub);
		if (company && company.enabled === false) throw fail("Payroll is not enabled for this subsidiary", "Công ty con chưa bật phân hệ lương");
		return Store.create("batch", {
			subsidiary: sub, period: period.id, paygroup: period.paygroup, tax_month: period.tax_month || Dates.yyyymm(period.end), doc_date: input.docDate || period.end,
			description: input.description || "", status: "H", calculated: false,
		});
	}

	function lines(batchId) {
		return Store.find("batch_emp", { where: "{batch} = ?", params: [batchId] });
	}

	function inputs(batchId) {
		return Store.find("batch_input", { where: "{batch} = ?", params: [batchId] });
	}

	/** Load Employees (3.5 LoadEmployeesCore): nạp người mới thuộc nhóm lương, áp lại công cho dòng đã có. */
	function loadEmployees(batchId) {
		const batch = getBatch(batchId);
		assertEditable(batch);
		const c = context(batch);
		const p = c.period;
		if (c.settings.requireAttendanceLock && p.att_status !== "L") throw fail("Attendance of the period must be locked first", "Kỳ công chưa khóa (thiết lập bắt buộc khóa công)");
		const groupCode = c.settings.payGroupCode;
		const groupsByName = {};
		for (const g of Store.find("paygroup", { includeInactive: true })) groupsByName[g.id] = String(g.name).trim().toUpperCase();
		const profiles = Store.find("employee", { where: "{subsidiary} = ?", params: [batch.subsidiary], includeInactive: true });
		const info = employeesInfo(profiles.map((x) => x.employee));
		const existing = lines(batchId);
		const have = new Set(existing.map((l) => l.employee));
		// Nhân viên đã ở bảng lương khác chưa đảo của cùng kỳ
		const others = new Set();
		for (const b of Store.find("batch", { where: "{period} = ? AND {id} <> ?", params: [p.id, batchId] })) {
			if (b.status === "V") continue;
			for (const l of lines(b.id)) others.add(l.employee);
		}
		const attendance = {};
		for (const a of Store.find("attendance", { where: "{period} = ?", params: [p.id] })) attendance[a.employee] = a;
		const weeklyOff = c.settings.weeklyOffDays;
		const added = [];
		const skipped = [];
		for (const prof of profiles) {
			const emp = info[prof.employee] || {};
			const group = prof.paygroup ? groupsByName[prof.paygroup] : "DEFAULT";
			if (norm(group || "DEFAULT") !== groupCode) continue;
			const terminates = EmploymentDays.terminatesIn(prof.termination_date, p.start, p.end);
			if (!(terminates || (!prof.isInactive && !emp.isInactive))) continue;
			if (!EmploymentDays.employedIn(prof.hire_date, prof.termination_date, p.start, p.end)) continue;
			const values = applyLeave(p, prof, attendance[prof.employee], weeklyOff, c.holidays);
			if (have.has(prof.employee)) {
				const line = existing.find((l) => l.employee === prof.employee);
				Store.submit("batch_emp", line.id, values);
				continue;
			}
			if (others.has(prof.employee)) {
				skipped.push(emp.code || prof.employee);
				continue;
			}
			Store.create("batch_emp", Object.assign({ batch: batchId, employee: prof.employee, profile: prof.id, employment_type: prof.employment_type || "E", accrue13: !!prof.accrue13 }, values));
			added.push(emp.code || prof.employee);
		}
		markUncalculated(batch);
		return { added, skipped, updated: existing.length };
	}

	/** ApplyLeave (3.5): từ bảng tổng hợp công nếu có, ngược lại công chuẩn trừ ngày ngoài hợp đồng. */
	function applyLeave(p, prof, summary, weeklyOff, holidays) {
		if (summary) {
			const unpaid = summary.unpaid_leave || 0;
			const si = summary.si_leave || 0;
			return {
				std_days: blank(summary.std_days) ? p.std_days : summary.std_days, work_days: summary.work_days, paid_leave: summary.paid_leave || 0,
				unpaid_leave: unpaid, si_leave: si, absence_days: unpaid + si, ot_hours: summary.ot_hours || 0, att_locked: summary.status === "L",
			};
		}
		const std = p.std_days || 0;
		const outside = EmploymentDays.outsideContract(prof.hire_date, prof.termination_date, p.start, p.end, weeklyOff, holidays);
		return { std_days: std, work_days: Math.max(0, std - outside), paid_leave: 0, unpaid_leave: outside, si_leave: 0, absence_days: outside, att_locked: false };
	}

	// ------------------------------------------------------------------ tính lương

	function latestCompensation(rows, end) {
		let best = null;
		for (const r of rows) if (r.effective && Dates.cmp(r.effective, end) <= 0 && (!best || Dates.cmp(r.effective, best.effective) > 0)) best = r;
		return best;
	}

	/** Số dư tạm ứng còn mở, trừ phần đang cấn ở bảng lương khác chưa ghi sổ (2.9). */
	function openAdvances(c, employeeIds) {
		const end = c.period.end;
		const adv = Store.findIn("advance", "employee", employeeIds).filter((a) => a.status === "O" && (a.balance || 0) > 0 && Dates.cmp(a.doc_date, end) <= 0 && a.subsidiary === c.batch.subsidiary);
		const pending = {};
		for (const b of Store.find("batch", { where: "{id} <> ?", params: [c.batch.id] })) {
			if (["R", "V"].includes(b.status) || !b.calculated) continue;
			for (const l of lines(b.id)) for (const o of parseDetail(l).advanceOffsets || []) pending[o.refNbr] = (pending[o.refNbr] || 0) + o.amount;
		}
		const out = {};
		for (const a of adv) {
			const balance = (a.balance || 0) - (pending[a.name] || 0);
			if (balance > 0) (out[a.employee] = out[a.employee] || []).push({ refNbr: a.name, id: a.id, date: a.doc_date, balance });
		}
		return out;
	}

	/** Kỳ trước cùng tháng thuế (2.7.1) cho kỳ tuần / nửa tháng. */
	function priorEarnings(c) {
		const p = c.period;
		if (!p.frequency || p.frequency === "M") return {};
		const out = {};
		for (const b of Store.find("batch", { where: "{tax_month} = ? AND {id} <> ?", params: [c.batch.tax_month, c.batch.id] })) {
			if (b.status === "V" || !b.calculated) continue;
			const bp = Store.get("period", b.period);
			if (!bp || Dates.cmp(bp.end, p.start) >= 0) continue;
			for (const l of lines(b.id)) {
				const d = parseDetail(l);
				const o = (out[l.employee] = out[l.employee] || { earnings: [], absenceWorkingDays: 0, otherTaxDeductions: 0 });
				for (const e of d.earnings || []) {
					const t = c.earningTypes.byCode[norm(e.earningType)] || {};
					o.earnings.push({ code: norm(e.earningType), amount: e.amount, taxTreatment: t.taxTreatment || "T", taxExemptAmount: e.taxExemptAmount || 0, exemptCapParameter: t.exemptCapParam || "" });
				}
				o.absenceWorkingDays += l.absence_days || 0;
				o.otherTaxDeductions += l.other_tax_ded || 0;
			}
		}
		return out;
	}

	function ytdOvertime(c) {
		const year = String(c.batch.tax_month || "").slice(0, 4);
		const out = {};
		if (!year) return out;
		for (const b of Store.find("batch", { where: "{tax_month} LIKE ?", params: [`${year}%`] })) {
			if (b.status !== "R" || b.id === c.batch.id) continue;
			for (const l of lines(b.id)) out[l.employee] = (out[l.employee] || 0) + (l.ot_hours || 0);
		}
		return out;
	}

	/** Giờ OT từ đơn OT đã duyệt có ngày làm trong [đầu kỳ, cuối kỳ] (3.7 AddOvertimeRequests), khi nguồn OT = R. */
	function overtimeLines(c, employeeIds) {
		const out = {};
		if (c.settings.overtimeSource !== "R") return out;
		const ets = c.earningTypes.byId;
		for (const r of Store.findIn("ot_request", "employee", employeeIds)) {
			if (r.status !== "A" || !(r.hours > 0) || !Dates.within(r.work_date, c.period.start, c.period.end)) continue;
			const et = ets[r.earning_type] || {};
			(out[r.employee] = out[r.employee] || []).push({
				date: r.work_date, isOvertime: true, dayType: r.day_type || "N", hours: r.hours, isNight: !!r.is_night, earningType: et.code || "",
				project: r.project || "", sourceId: r.name,
			});
		}
		return out;
	}

	/** Ngày phép còn lại năm nghỉ việc: tổng khả dụng của loại nghỉ trừ số dư và có lương (2.10.2). */
	function paidLeaveRemaining(employeeIds, year) {
		const types = {};
		for (const t of Store.find("leave_type", { includeInactive: true })) types[t.id] = t;
		const out = {};
		for (const b of Store.findIn("leave_balance", "employee", employeeIds)) {
			const t = types[b.leave_type];
			if (!t || !t.uses_balance || !t.is_paid || Number(b.year) !== Number(year)) continue;
			const avail = Ledger.available({ entitled: b.entitled, carriedOver: b.carried, adjusted: b.adjusted, used: b.used, pending: b.pending });
			out[b.employee] = (out[b.employee] || 0) + Number(avail);
		}
		return out;
	}

	function parseDetail(line) {
		try {
			return line.detail ? JSON.parse(line.detail) : {};
		} catch (e) {
			return {};
		}
	}

	/**
	 * Tính bảng lương. Lỗi một nhân viên không dừng cả bảng: dòng đó về 0 và ghi lỗi (4.6.9).
	 * @param {string} batchId
	 * @param {{lineIds?: string[]}} [opt] chỉ tính một phần (Map/Reduce chia lô); tổng luôn cộng lại toàn bảng
	 */
	function calculate(batchId, opt = {}) {
		const batch = getBatch(batchId);
		assertEditable(batch);
		if (LOCK_AFTER.includes(batch.status) || batch.status === "P" || batch.status === "J") throw fail("Reopen the batch before recalculating", "Mở lại bảng lương trước khi tính lại");
		const c = context(batch);
		if (c.period.status === "C") throw fail("The pay period is closed", "Kỳ lương đã đóng");
		if (c.settings.requireAttendanceLock && c.period.att_status !== "L") throw fail("Attendance of the period must be locked first", "Kỳ công chưa khóa");
		const ectx = engineContext(c);
		let all = lines(batchId);
		const target = opt.lineIds ? all.filter((l) => opt.lineIds.includes(l.id)) : all;
		const empIds = target.map((l) => l.employee);
		const profiles = {};
		for (const pr of Store.findIn("employee", "employee", empIds)) profiles[pr.employee] = pr;
		const profIds = Object.values(profiles).map((p) => p.id);
		const comps = {};
		for (const r of Store.findIn("compensation", "profile", profIds)) (comps[r.profile] = comps[r.profile] || []).push(r);
		const deps = {};
		for (const r of Store.findIn("dependent", "profile", profIds)) (deps[r.profile] = deps[r.profile] || []).push({ deductFrom: r.from, deductTo: r.to });
		const info = employeesInfo(empIds);
		const ins = {};
		for (const i of inputs(batchId)) (ins[i.employee] = ins[i.employee] || []).push(i);
		const advances = openAdvances(c, empIds);
		const prior = priorEarnings(c);
		const ytd = ytdOvertime(c);
		const otLines = overtimeLines(c, empIds);
		// Sản lượng / doanh số (4.3.5), giấy phép lao động (3.9), bảng tỷ lệ phân bổ (4.5.3): đọc một lần cho cả lô
		const outputs = Output.forPayroll(c.period.id, batchId, empIds);
		ectx.rateTables = outputs.rateTables || {};
		const permits = WorkPermits.forPayroll(empIds, c.period.start, c.period.end);
		const plans = AllocationPlans.forPayroll(empIds);
		const leaveLeft = paidLeaveRemaining(empIds.filter((id) => profiles[id] && EmploymentDays.terminatesIn(profiles[id].termination_date, c.period.start, c.period.end)), Dates.year(c.period.end));
		const etById = c.earningTypes.byId;
		const errors = [];

		for (const line of target) {
			const prof = profiles[line.employee];
			const e = info[line.employee] || {};
			try {
				if (!prof) throw fail("The employee payroll profile is missing", "Nhân viên chưa có hồ sơ lương");
				const wp = permits[line.employee];
				if (wp && wp.blocking) throw fail(wp.warning.message, wp.warning.messageVi);
				const comp = latestCompensation(comps[prof.id] || [], c.period.end);
				const myInputs = ins[line.employee] || [];
				const emp = {
					employee: line.employee, code: e.code, name: e.name, employmentType: prof.employment_type || "E", salaryType: prof.salary_type || "M",
					pitMethod: prof.pit_method || "P", hasFlatTaxCommitment: prof.flat_commit, insuranceApplicable: prof.ins_applicable, unemploymentApplicable: prof.ui_applicable,
					isUnionMember: prof.union_member, region: prof.region, accrue13: line.accrue13, isActive: !prof.isInactive, seniorityDate: prof.seniority_date,
					hireDate: prof.hire_date, terminationDate: prof.termination_date, salesTarget: prof.sales_target, allocationMethod: prof.alloc_method,
					compensation: comp ? { effectiveDate: comp.effective, baseSalary: comp.base_salary, insuranceWage: comp.insurance_wage || 0, fixedAllowance: comp.allowance || 0, package: comp.package ? c.packageNames[comp.package] : "" } : null,
					dependents: (prof.pit_method || "P") === "P" ? deps[prof.id] || [] : [],
					line: { standardDays: line.std_days, workDays: line.work_days, absenceDays: line.absence_days || 0, unpaidLeaveDays: line.unpaid_leave || 0, otherTaxDeductions: line.other_tax_ded || 0 },
					timeLines: otLines[line.employee] || [],
					manualEarnings: myInputs.filter((i) => i.kind === "E").map((i) => ({
						earningType: etById[i.earning_type] ? etById[i.earning_type].code : "", description: i.description, quantity: blank(i.qty) ? 1 : i.qty, rate: i.rate || 0,
						multiplier: i.multiplier, amount: i.amount || 0, amountLocked: i.manual_amount, project: i.project || "", branch: i.location || "", workCenter: i.class || "", sub: i.department || "",
					})),
					deductions: myInputs.filter((i) => i.kind === "D").map((i) => ({ code: i.code || "KHAC", name: i.description || i.code || "", amount: i.amount || 0, account: i.account })),
					openAdvances: advances[line.employee] || [],
					prior: prior[line.employee] || {},
					leaveRemaining: leaveLeft[line.employee] || 0,
					yearToDateOvertimeHours: ytd[line.employee] || 0,
					outputAmounts: (outputs.outputAmounts || {})[line.employee] || {},
					salesAmount: (outputs.salesAmount || {})[line.employee] || 0,
					outputShares: (outputs.shares || {})[line.employee] || [],
					allocationVersions: plans[line.employee] || [],
					extraWarnings: wp && wp.warning ? [wp.warning] : [],
					defaults: { project: prof.project || "", task: "", branch: prof.location || e.location || "", workCenter: prof.class || e.cls || "" },
					accounts: {
						employeeAccount: prof.expense_account || "", employeeSub: prof.department || e.department || "", defaultAccount: c.settings.accounts.acc_expense || "",
						defaultSub: prof.department || e.department || "", workCenters: {}, projects: {},
					},
				};
				const r = Engine.calculateEmployee(ectx, emp);
				const ded = emp.deductions.filter((d) => d.amount);
				Store.submit("batch_emp", line.id, {
					std_days: r.standardDays, work_days: r.workDays, base_salary: r.baseSalary, insurance_wage: r.insuranceWage, benefit: r.benefit, gross: r.grossPay,
					exempt: r.taxExemptIncome, taxable: r.taxableIncome, ee_ins: r.employeeInsurance, er_ins: r.employerInsurance, dependents: r.dependentCount,
					family_ded: r.familyDeduction, assessable: r.assessableIncome, pit: r.pit, other_ded: r.otherDeductions, net_before: r.netBeforeAdvance,
					advance: r.advanceOffset, net: r.netPay, accrued13: r.accrued13th, ot_hours: r.overtimeHours,
					warnings: r.warnings.map((w) => (lang() === "vi" ? w.messageVi : w.message)).join(" | ").slice(0, 1000), error: "",
					detail: JSON.stringify({
						earnings: r.earnings.map((x) => ({ earningType: x.earningType, quantity: x.quantity, rate: x.rate, multiplier: x.multiplier, amount: x.amount, taxExemptAmount: x.taxExemptAmount || 0, source: x.source, ruleCode: x.ruleCode || "", project: x.project || "" })),
						insurance: r.insurance, advanceOffsets: r.advanceOffsets.map((o) => Object.assign({}, o, { id: ((advances[line.employee] || []).find((a) => a.refNbr === o.refNbr) || {}).id })),
						allocations: r.allocations, deductions: ded, hourlyRate: r.hourlyRate, employeeCompulsoryInsurance: r.employeeCompulsoryInsurance,
						employmentType: emp.employmentType, expenseAccount: prof.expense_account || "", expenseSub: prof.department || e.department || "",
					}),
				});
			} catch (err) {
				const msg = err.userMessage ? (lang() === "vi" ? err.userMessage.vi : err.userMessage.en) : lang() === "vi" && err.messageVi ? err.messageVi : String(err.message || err);
				errors.push(`${e.code || line.employee}: ${msg}`);
				const zero = {};
				for (const k of ["base_salary", "benefit", "gross", "exempt", "taxable", "ee_ins", "er_ins", "dependents", "family_ded", "assessable", "pit", "other_ded", "net_before", "advance", "net", "accrued13"]) zero[k] = 0;
				Store.submit("batch_emp", line.id, Object.assign(zero, { error: msg.slice(0, 1000), warnings: "", detail: "" }));
			}
		}
		return finishCalculation(batchId, errors, !!opt.lineIds);
	}

	/** Cộng tổng toàn bảng từ dòng nhân viên, đặt trạng thái. */
	function finishCalculation(batchId, errors, partial) {
		const batch = getBatch(batchId);
		const all = lines(batchId);
		const sum = (k, f) => all.filter(f || (() => true)).reduce((s, l) => s + (l[k] || 0), 0);
		const anyError = all.some((l) => !blank(l.error));
		const totals = {
			emp_count: all.length, gross: sum("gross"), ee_ins: sum("ee_ins"), er_ins: sum("er_ins"), pit: sum("pit"), other_ded: sum("other_ded"), advance: sum("advance"),
			net: sum("net"), ee_net: sum("net", (l) => l.employment_type !== "C"), ctr_net: sum("net", (l) => l.employment_type === "C"), accrued13: sum("accrued13"),
		};
		const ok = !anyError && all.length > 0;
		const status = batch.status === "H" ? "H" : ok ? "C" : "B";
		Store.submit("batch", batchId, Object.assign(totals, { calculated: ok, status, messages: errors.join("\n").slice(0, 100000), calc_stamp: stamp(batchId) }));
		return { ok, partial, errors, totals, status };
	}

	/** Dấu dữ liệu đầu vào lúc tính: đổi dòng nhập tay hoặc số dư tạm ứng thì phải tính lại. */
	function stamp(batchId) {
		const parts = inputs(batchId).map((i) => [i.id, i.employee, i.kind, i.earning_type, i.qty, i.rate, i.multiplier, i.amount, i.manual_amount].join(":"));
		const ls = lines(batchId).map((l) => [l.id, l.work_days, l.std_days, l.absence_days, l.other_tax_ded].join(":"));
		return String(hash(parts.concat(ls).sort().join("|")));
	}

	function hash(s) {
		let h = 5381;
		for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
		return h >>> 0;
	}

	function markUncalculated(batch) {
		if (!batch.calculated && batch.status !== "C") return;
		Store.submit("batch", batch.id, { calculated: false, status: batch.status === "H" ? "H" : "B" });
	}

	function assertEditable(batch) {
		if (["A", "P", "R", "V", "J"].includes(batch.status)) throw fail(`The batch is in status ${batch.status}; reopen it first`, `Bảng lương đang ở trạng thái ${batch.status}, cần mở lại trước`);
	}

	/** Thêm / sửa dòng nhập tay (thu nhập nguồn M hoặc khấu trừ sau thuế); bảng lương về "chưa tính". */
	function saveInput(values) {
		const batch = getBatch(values.batch);
		assertEditable(batch);
		const v = Object.assign({}, values);
		delete v.id;
		if (v.kind === "E" && blank(v.earning_type)) throw fail("Earning type is required", "Chưa chọn loại thu nhập");
		const id = values.id ? (Store.update("batch_input", values.id, v), values.id) : Store.create("batch_input", v);
		markUncalculated(getBatch(values.batch));
		return { id };
	}

	function deleteInput(id) {
		const i = Store.get("batch_input", id);
		if (!i) return { ok: true };
		const batch = getBatch(i.batch);
		assertEditable(batch);
		Store.remove("batch_input", id);
		markUncalculated(getBatch(i.batch));
		return { ok: true };
	}

	/** Sửa công, giảm trừ khác trên dòng nhân viên (tối đa 2 x công chuẩn, không âm). */
	function updateLine(lineId, values) {
		const l = Store.get("batch_emp", lineId);
		if (!l) throw fail("Line not found", "Không tìm thấy dòng");
		const batch = getBatch(l.batch);
		assertEditable(batch);
		const v = {};
		if (values.work_days !== undefined) {
			const w = Number(values.work_days);
			if (!(w >= 0) || w > 2 * (l.std_days || 0)) throw fail("Work days must be between 0 and twice the standard days", "Ngày công phải từ 0 đến 2 lần công chuẩn");
			v.work_days = w;
		}
		if (values.other_tax_ded !== undefined) {
			if (Number(values.other_tax_ded) < 0) throw fail("Other tax deductions cannot be negative", "Giảm trừ khác không được âm");
			v.other_tax_ded = Number(values.other_tax_ded);
		}
		for (const k of ["absence_days", "unpaid_leave", "si_leave", "paid_leave"]) if (values[k] !== undefined) v[k] = Number(values[k]) || 0;
		Store.submit("batch_emp", lineId, v);
		markUncalculated(batch);
		return { ok: true };
	}

	function removeLine(lineId) {
		const l = Store.get("batch_emp", lineId);
		if (!l) return { ok: true };
		const batch = getBatch(l.batch);
		assertEditable(batch);
		for (const i of inputs(l.batch).filter((x) => x.employee === l.employee)) Store.remove("batch_input", i.id);
		Store.remove("batch_emp", lineId);
		markUncalculated(batch);
		return { ok: true };
	}

	// ------------------------------------------------------------------ trạng thái, duyệt

	function removeHold(batchId) {
		const b = getBatch(batchId);
		if (b.status !== "H") throw fail("Only on-hold batches", "Chỉ áp dụng cho bảng lương đang tạm giữ");
		Store.submit("batch", batchId, { status: b.calculated ? "C" : "B" });
	}

	function hold(batchId) {
		const b = getBatch(batchId);
		if (!["B", "C"].includes(b.status)) throw fail("Only pending or calculated batches", "Chỉ áp dụng cho bảng lương chờ tính hoặc đã tính");
		Store.submit("batch", batchId, { status: "H" });
	}

	function currentEmployee() {
		const u = runtime.getCurrentUser();
		return u && u.id > 0 ? String(u.id) : null;
	}

	function approve(batchId) {
		const b = getBatch(batchId);
		if (!["C", "P"].includes(b.status) || !b.calculated) throw fail("Only calculated batches can be approved", "Chỉ duyệt bảng lương đã tính");
		if (b.calc_stamp && b.calc_stamp !== stamp(batchId)) throw fail("Data changed after calculation; recalculate first", "Dữ liệu đã đổi sau khi tính, cần tính lại");
		Store.submit("batch", batchId, { status: "A", approved_by: currentEmployee(), approved_date: Dates.iso(new Date()) });
	}

	function reject(batchId) {
		const b = getBatch(batchId);
		if (!["C", "P"].includes(b.status)) throw fail("Only batches pending approval", "Chỉ từ chối bảng lương chờ duyệt");
		Store.submit("batch", batchId, { status: "J" });
	}

	function reopen(batchId) {
		const b = getBatch(batchId);
		if (["R", "V"].includes(b.status)) throw fail("Released batches cannot be reopened; reverse instead", "Bảng lương đã ghi sổ, hãy dùng Đảo");
		Store.submit("batch", batchId, { status: "H", approved_by: null, approved_date: null });
	}

	// ------------------------------------------------------------------ ghi sổ, đảo

	function components(c) {
		const out = {};
		for (const comp of c.provider.getInsuranceComponents(c.period.end)) out[comp.code] = { name: comp.description || comp.code, liabilityAccount: comp.liabilityAccount || "", vendor: comp.vendor || "" };
		return out;
	}

	function journalConfig(c) {
		const a = c.settings.accounts;
		return {
			payableAccount: a.acc_payable, contractorPayableAccount: a.acc_contractor, pitPayableAccount: a.acc_pit, otherDeductionAccount: a.acc_other_ded,
			advanceAccount: a.acc_advance, accrued13thAccount: a.acc_13th, defaultExpenseAccount: a.acc_expense, components: components(c), interBranch: true, lang: lang(),
		};
	}

	function releaseModel(c) {
		const ls = lines(c.batch.id);
		return {
			batchNbr: c.batch.name, periodId: c.period.name, branch: "", date: c.batch.doc_date || c.period.end, grossTotal: c.batch.gross || 0, employerInsTotal: c.batch.er_ins || 0,
			employees: ls.map((l) => {
				const d = parseDetail(l);
				return {
					employee: l.employee, employmentType: l.employment_type || d.employmentType || "E", netPay: l.net || 0, accrued13th: l.accrued13 || 0, expenseAccount: d.expenseAccount || "",
					expenseSub: d.expenseSub || "", pit: l.pit || 0, insurance: d.insurance || [], deductions: d.deductions || [], advanceOffsets: d.advanceOffsets || [], allocations: d.allocations || [],
				};
			}),
		};
	}

	/** Bản xem trước bút toán (không ghi gì). */
	function journalPreview(batchId) {
		const b = getBatch(batchId);
		if (!b.calculated) throw fail("Calculate the batch first", "Hãy tính bảng lương trước");
		const c = context(b);
		const je = Journal.buildRelease(releaseModel(c), journalConfig(c));
		// Số hiệu TK cho màn hình xem trước
		const ids = [...new Set(je.lines.map((l) => String(l.account)))];
		const numbers = {};
		if (ids.length) for (const a of Store.run(`SELECT id, acctnumber FROM account WHERE id IN (${ids.map(() => "?").join(",")})`, ids, "s4vp_je_accounts")) numbers[String(a.id)] = a.acctnumber;
		je.lines = je.lines.map((l) => Object.assign({}, l, { accountNumber: numbers[String(l.account)] || l.account }));
		return je;
	}

	function release(batchId) {
		const b = getBatch(batchId);
		if (b.journal) throw fail("The batch already has a journal entry", "Bảng lương đã có bút toán");
		if (b.status === "H") throw fail("Remove the hold first", "Bảng lương đang tạm giữ");
		if (!b.calculated) throw fail("Calculate the batch first", "Hãy tính bảng lương trước");
		const c = context(b);
		if (c.settings.requirePayrollApproval ? b.status !== "A" : !["A", "C"].includes(b.status)) throw fail("The batch must be approved", "Bảng lương phải được duyệt trước khi ghi sổ");
		if (c.period.status === "C") throw fail("The pay period is closed", "Kỳ lương đã đóng");
		if (b.calc_stamp && b.calc_stamp !== stamp(batchId)) throw fail("Data changed after calculation; recalculate first", "Dữ liệu đã đổi sau khi tính, cần tính lại");
		if (!c.settings.accounts.acc_payable) throw fail("Wages payable account (334) is not configured", "Chưa khai TK phải trả người lao động (334)");
		const model = releaseModel(c);
		if (!model.employees.length) throw fail("The batch has no employees", "Bảng lương không có nhân viên");
		// Số dư tạm ứng không đổi kể từ lúc tính
		const offsets = {};
		for (const e of model.employees) for (const o of e.advanceOffsets) offsets[o.id || o.refNbr] = { amount: (offsets[o.id] ? offsets[o.id].amount : 0) + o.amount, refNbr: o.refNbr, id: o.id };
		const advRecs = Store.findIn("advance", "id", Object.values(offsets).map((o) => o.id).filter(Boolean));
		for (const a of advRecs) if ((a.balance || 0) < offsets[a.id].amount) throw fail(`Advance ${a.name} balance changed; recalculate`, `Số dư tạm ứng ${a.name} đã thay đổi, cần tính lại`);
		const je = Journal.buildRelease(model, journalConfig(c));
		const jeId = createJournal(c.batch.subsidiary, je.date, je.memo, je.lines, c.settings.location);
		Store.submit("batch", batchId, { journal: jeId, status: "R" });
		Output.markIncluded(c.period.id, batchId);
		const used = {};
		for (const e of model.employees) {
			const nbrs = PlanRecords.usedVersions(e.allocations);
			if (nbrs.length) used[e.employee] = nbrs;
		}
		AllocationPlans.markUsed(used);
		for (const a of advRecs) {
			const off = (a.offset || 0) + offsets[a.id].amount;
			const bal = (a.amount || 0) - off;
			const hist = safeJson(a.history, []);
			hist.push({ batch: batchId, batchNbr: b.name, amount: offsets[a.id].amount });
			Store.submit("advance", a.id, { offset: off, balance: bal, status: bal <= 0 ? "C" : "O", history: JSON.stringify(hist) });
		}
		return { journal: jeId };
	}

	function safeJson(s, def) {
		try {
			return s ? JSON.parse(s) : def;
		} catch (e) {
			return def;
		}
	}

	/** Journal Entry từ dòng trung lập; sub -> department, branch -> location, workCenter -> class, project -> entity. */
	/** Account bật duyệt bút toán / bill: tạo ở trạng thái đã duyệt khi thiết lập tự duyệt (AutoReleaseGL). */
	function approveOnCreate(rec) {
		if (Settings.tenant().auto_approve === false) return;
		// Journal Entry duyệt bằng cờ approved (Accounting Preferences > Require Approvals on Journal Entries);
		// Vendor Bill dùng approvalstatus (2 = Approved). Account không bật duyệt thì không có trường: bỏ qua.
		const field = rec.type === record.Type.JOURNAL_ENTRY ? ["approved", true] : ["approvalstatus", "2"];
		try {
			rec.setValue({ fieldId: field[0], value: field[1] });
		} catch (e) {
			// không có trường
		}
	}

	function createJournal(subsidiary, date, memo, jeLines, defaultLocation) {
		const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: false });
		approveOnCreate(je);
		if (subsidiary) je.setValue({ fieldId: "subsidiary", value: subsidiary });
		je.setValue({ fieldId: "trandate", value: Store.toNsDate(date) });
		je.setValue({ fieldId: "memo", value: String(memo).slice(0, 999) });
		jeLines.forEach((l, i) => {
			const set = (fieldId, value) => !blank(value) && je.setSublistValue({ sublistId: "line", fieldId, line: i, value });
			set("account", l.account);
			if (Number(l.debit) > 0) set("debit", Number(l.debit));
			if (Number(l.credit) > 0) set("credit", Number(l.credit));
			set("memo", String(l.memo || "").slice(0, 999));
			set("department", l.sub);
			set("location", blank(l.branch) ? defaultLocation : l.branch);
			set("class", l.workCenter);
			set("entity", l.project);
		});
		return String(je.save({ enableSourcing: true, ignoreMandatoryFields: false }));
	}

	function reverse(batchId) {
		const b = getBatch(batchId);
		if (b.status !== "R" || !b.journal) throw fail("Only released batches can be reversed", "Chỉ đảo bảng lương đã ghi sổ");
		const bills = safeJson(b.bills, []);
		const active = bills.filter((x) => isActiveBill(x.id));
		if (active.length) throw fail(`Void the agency bills first: ${active.map((x) => x.tranid || x.id).join(", ")}`, `Còn bill cơ quan thu hiệu lực: ${active.map((x) => x.tranid || x.id).join(", ")}`);
		const c = context(b);
		const orig = record.load({ type: record.Type.JOURNAL_ENTRY, id: b.journal });
		const out = [];
		const n = orig.getLineCount({ sublistId: "line" });
		for (let i = 0; i < n; i++) {
			const g = (f) => orig.getSublistValue({ sublistId: "line", fieldId: f, line: i });
			out.push({ account: g("account"), debit: Number(g("credit") || 0), credit: Number(g("debit") || 0), memo: g("memo"), sub: g("department"), branch: g("location"), workCenter: g("class"), project: g("entity") });
		}
		const memo = lang() === "vi" ? `Đảo bảng lương ${b.name} (kỳ ${c.period.name})` : `Reversal of payroll batch ${b.name} (period ${c.period.name})`;
		const jeId = createJournal(b.subsidiary, Dates.iso(new Date()), memo, out, c.settings.location);
		Store.submit("batch", batchId, { reversal: jeId, status: "V" });
		Output.unmarkIncluded(batchId);
		// Hoàn số dư tạm ứng
		for (const l of lines(batchId)) {
			for (const o of parseDetail(l).advanceOffsets || []) {
				if (!o.id) continue;
				const a = Store.get("advance", o.id);
				if (!a) continue;
				const off = Math.max(0, (a.offset || 0) - o.amount);
				const bal = (a.amount || 0) - off;
				const hist = safeJson(a.history, []).filter((h) => h.batch !== batchId);
				Store.submit("advance", a.id, { offset: off, balance: bal, status: bal > 0 ? "O" : "C", history: JSON.stringify(hist) });
			}
		}
		return { journal: jeId };
	}

	function isActiveBill(id) {
		const rows = Store.run("SELECT t.id, t.voided, t.status FROM transaction t WHERE t.id = ?", [id], "s4vp_bill_status");
		return rows.length > 0 && rows[0].voided !== "T";
	}

	// ------------------------------------------------------------------ bill cơ quan thu, file ngân hàng

	function agencyBills(batchId) {
		const b = getBatch(batchId);
		if (b.status !== "R") throw fail("Only released batches", "Chỉ lập bill cho bảng lương đã ghi sổ");
		if (safeJson(b.bills, []).length) throw fail("Agency bills were already created", "Đã lập bill cơ quan thu cho bảng lương này");
		const c = context(b);
		const totals = {};
		for (const l of lines(batchId)) {
			for (const i of parseDetail(l).insurance || []) {
				const t = (totals[i.code] = totals[i.code] || { employeeAmount: 0, employerAmount: 0 });
				t.employeeAmount += i.employeeAmount || 0;
				t.employerAmount += i.employerAmount || 0;
			}
		}
		const plan = Journal.buildAgencyBills({ batchNbr: b.name, periodId: c.period.name, pitTotal: b.pit || 0, insuranceTotals: totals }, {
			components: components(c), pitVendor: c.settings.pitVendor, pitPayableAccount: c.settings.accounts.acc_pit, lang: lang(),
		});
		if (!plan.bills.length) throw fail("No agency bill to create (vendors not configured?)", "Không có bill nào để lập (chưa khai cơ quan thu?)");
		const created = [];
		for (const bill of plan.bills) {
			const r = record.create({ type: record.Type.VENDOR_BILL, isDynamic: false });
			r.setValue({ fieldId: "entity", value: bill.vendor });
			approveOnCreate(r);
			if (b.subsidiary) r.setValue({ fieldId: "subsidiary", value: b.subsidiary });
			r.setValue({ fieldId: "trandate", value: Store.toNsDate(Dates.iso(new Date())) });
			r.setValue({ fieldId: "tranid", value: String(bill.refNo || b.name).slice(0, 45) });
			r.setValue({ fieldId: "memo", value: String(bill.memo).slice(0, 255) });
			if (c.settings.location) r.setValue({ fieldId: "location", value: c.settings.location });
			bill.lines.forEach((l, i) => {
				if (c.settings.location) r.setSublistValue({ sublistId: "expense", fieldId: "location", line: i, value: c.settings.location });
				r.setSublistValue({ sublistId: "expense", fieldId: "account", line: i, value: l.account });
				r.setSublistValue({ sublistId: "expense", fieldId: "amount", line: i, value: Number(l.amount) });
				r.setSublistValue({ sublistId: "expense", fieldId: "memo", line: i, value: String(l.memo || "").slice(0, 999) });
			});
			const id = String(r.save({ enableSourcing: true, ignoreMandatoryFields: false }));
			created.push({ id, vendor: bill.vendor, amount: bill.total, memo: bill.memo });
			Store.submit("batch", batchId, { bills: JSON.stringify(created) });
		}
		return { created, skipped: plan.skipped };
	}

	function bankFile(batchId) {
		const b = getBatch(batchId);
		if (!["A", "R"].includes(b.status)) throw fail("The batch must be approved or released", "Bảng lương phải đã duyệt hoặc đã ghi sổ");
		const c = context(b);
		const ls = lines(batchId);
		const info = employeesInfo(ls.map((l) => l.employee));
		const profiles = {};
		for (const p of Store.findIn("employee", "employee", ls.map((l) => l.employee))) profiles[p.employee] = p;
		const emps = ls.map((l) => ({ code: (info[l.employee] || {}).code, name: (info[l.employee] || {}).name, bankAccount: (profiles[l.employee] || {}).bank_account, bankName: (profiles[l.employee] || {}).bank_name, netPay: l.net || 0 }));
		return BankFile.write({ batchNbr: b.name, periodId: c.period.name, taxMonth: b.tax_month }, emps, { lang: lang() });
	}

	// ------------------------------------------------------------------ đọc cho giao diện

	/** Số chứng từ, trạng thái duyệt và ghi sổ của các giao dịch do bảng lương tạo. */
	function transactionsInfo(ids) {
		const list = ids.filter((x) => !blank(x)).map(String);
		if (!list.length) return {};
		const out = {};
		for (const r of Store.run(`SELECT t.id, t.tranid, t.approvalstatus, BUILTIN.DF(t.approvalstatus) AS approval, t.posting, t.voided FROM transaction t WHERE t.id IN (${list.map(() => "?").join(",")})`, list, "s4vp_tran_info")) {
			out[String(r.id)] = { tranid: r.tranid, approvalStatus: r.approvalstatus, approval: r.approval, posting: r.posting === "T", voided: r.voided === "T" };
		}
		return out;
	}

	function detail(batchId) {
		const b = getBatch(batchId);
		const period = Store.get("period", b.period);
		const ls = lines(batchId);
		const info = employeesInfo(ls.map((l) => l.employee));
		const ets = Settings.earningTypes();
		return {
			batch: Object.assign({}, b, { periodName: period ? period.name : "", periodStart: period && period.start, periodEnd: period && period.end, netInWords: Words.readAmount(b.ee_net || 0) }),
			lines: ls.map((l) => {
				const d = parseDetail(l);
				const e = info[l.employee] || {};
				return Object.assign({}, l, {
					code: e.code, name: e.name, department: e.departmentName, detail: undefined,
					earnings: (d.earnings || []).map((x) => Object.assign({}, x, { name: (ets.byCode[norm(x.earningType)] || {}).description || x.earningType })),
					insurance: d.insurance || [], advanceOffsets: d.advanceOffsets || [], deductions: d.deductions || [], allocations: d.allocations || [],
				});
			}),
			inputs: inputs(batchId),
			transactions: transactionsInfo([b.journal, b.reversal].concat(safeJson(b.bills, []).map((x) => x.id))),
		};
	}

	function list(filter = {}) {
		const rows = Store.find("batch", { order: "{id} DESC" });
		const periods = {};
		for (const p of Store.find("period", { includeInactive: true })) periods[p.id] = p.name;
		return rows.filter((b) => (!filter.subsidiary || b.subsidiary === String(filter.subsidiary)) && (!filter.period || b.period === String(filter.period))).map((b) => Object.assign({}, b, { periodName: periods[b.period] || "", messages: undefined, bills: safeJson(b.bills, []) }));
	}

	return {
		create, loadEmployees, calculate, finishCalculation, removeHold, hold, approve, reject, reopen, release, reverse, agencyBills, bankFile,
		journalPreview, detail, list, lines, context, markUncalculated, getBatch, createJournal, saveInput, deleteInput, updateLine, removeLine, transactionsInfo,
	};
});
