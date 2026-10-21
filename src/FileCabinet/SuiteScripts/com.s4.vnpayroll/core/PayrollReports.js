/**
 * Báo cáo, tờ khai từ dòng nhân viên của bảng lương đã tính, không đảo (đặc tả mục 4.7.2 - 4.7.5):
 * BH phải nộp theo nhân viên (VP402000), danh sách biến động D02-LT, tờ khai 05/KK-TNCN quý (VP403000),
 * dữ liệu quyết toán năm 05-1/BK, 05-2/BK (VP404000).
 *
 * Dòng nguồn (row): {employee, employeeCode, employeeName, taxMonth (yyyyMM), periodId, pitMethod (P/F/N/X),
 *   employmentType (E/C), taxableIncome, pit, familyDeduction, dependentCount, employeeCompulsoryInsurance,
 *   otherTaxDeductions, assessableIncome, taxCode, idNumber, socialInsuranceNbr,
 *   insurance: [{code, wageBase, employeeAmount, employerAmount}]}
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates"], (Money, Dates) => {
	const D = Money.D;
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();

	/** Tháng tính thuế của dòng: TaxMonth, trống thì mã kỳ yyyyMM. */
	function taxMonthOf(row) {
		const tm = String(row.taxMonth || "").trim();
		return /^\d{6}$/.test(tm) ? tm : String(row.periodId || "").trim().slice(0, 6);
	}

	/** Quý của tháng tính thuế (1-4). */
	function quarterOf(taxMonth) {
		return Math.floor((Number(String(taxMonth).slice(4, 6)) - 1) / 3) + 1;
	}

	// ---- 4.7.2 BH phải nộp ----

	/**
	 * Mỗi nhân viên một dòng: lương đóng (lớn nhất), phần NLĐ BHXH (HT + OD), BHYT, BHTN; phần DN BHXH, BHTNLĐ, BHYT,
	 * BHTN; KPCĐ và đoàn phí tách cột riêng (không nằm trong số đối chiếu C12-TS).
	 */
	function insuranceByEmployee(rows) {
		const map = new Map();
		for (const r of rows || []) {
			const k = String(r.employee);
			const e = map.get(k) || {
				employee: r.employee, employeeCode: r.employeeCode, employeeName: r.employeeName, socialInsuranceNbr: r.socialInsuranceNbr || "",
				insuranceWage: D(0), eeSocial: D(0), eeHealth: D(0), eeUnemployment: D(0), erSocial: D(0), erAccident: D(0), erHealth: D(0), erUnemployment: D(0), erUnionFund: D(0), eeUnionFee: D(0),
			};
			for (const i of r.insurance || []) {
				const code = norm(i.code);
				if (D(i.wageBase).gt(e.insuranceWage)) e.insuranceWage = D(i.wageBase);
				const ee = D(i.employeeAmount);
				const er = D(i.employerAmount);
				if (code === "BHXH_HT" || code === "BHXH_OD") {
					e.eeSocial = e.eeSocial.plus(ee);
					e.erSocial = e.erSocial.plus(er);
				} else if (code === "BHTNLD") {
					e.erAccident = e.erAccident.plus(er);
					e.eeSocial = e.eeSocial.plus(ee);
				} else if (code === "BHYT") {
					e.eeHealth = e.eeHealth.plus(ee);
					e.erHealth = e.erHealth.plus(er);
				} else if (code === "BHTN") {
					e.eeUnemployment = e.eeUnemployment.plus(ee);
					e.erUnemployment = e.erUnemployment.plus(er);
				} else if (code === "KPCD") {
					e.erUnionFund = e.erUnionFund.plus(er);
				} else if (code === "DOANPHI") {
					e.eeUnionFee = e.eeUnionFee.plus(ee);
				}
			}
			map.set(k, e);
		}
		return [...map.values()].map((e) => {
			const out = {};
			for (const key of Object.keys(e)) out[key] = e[key] && typeof e[key].toNumber === "function" ? e[key].toNumber() : e[key];
			out.eeTotal = out.eeSocial + out.eeHealth + out.eeUnemployment;
			out.erTotal = out.erSocial + out.erAccident + out.erHealth + out.erUnemployment;
			out.total = out.eeTotal + out.erTotal;
			return out;
		}).filter((e) => e.total !== 0 || e.erUnionFund !== 0 || e.eeUnionFee !== 0);
	}

	/** Chênh lệch so với thông báo C12-TS = tổng - C12. */
	function c12Difference(lines, c12Amount) {
		return Money.sum(lines, (l) => l.total).minus(D(c12Amount)).toNumber();
	}

	// ---- 4.7.3 D02-LT ----

	/**
	 * Bản ghi tháng của từng người (gộp mọi kỳ lương cùng tháng).
	 * @param {Array} rows dòng của tháng (mọi bảng lương đã tính, không đảo)
	 * @param {Object<string, {insuranceApplicable, employmentType, hireDate, terminationDate, wageEffectiveDate}>} profiles
	 */
	function monthRecords(rows, profiles) {
		const map = new Map();
		for (const r of rows || []) {
			const k = String(r.employee);
			const p = (profiles || {})[k] || {};
			const rec = map.get(k) || {
				employee: r.employee, employeeCode: r.employeeCode, employeeName: r.employeeName,
				eligible: p.insuranceApplicable !== false && norm(p.employmentType || r.employmentType) !== "C",
				contributedAmount: D(0), insuranceWage: D(0), hireDate: p.hireDate || null, terminationDate: p.terminationDate || null, wageEffectiveDate: p.wageEffectiveDate || null,
			};
			for (const i of r.insurance || []) rec.contributedAmount = rec.contributedAmount.plus(D(i.employeeAmount));
			if (D(r.insuranceWage).gt(rec.insuranceWage)) rec.insuranceWage = D(r.insuranceWage);
			map.set(k, rec);
		}
		return [...map.values()].map((r) => ({
			employee: r.employee, employeeCode: r.employeeCode, employeeName: r.employeeName, eligible: r.eligible, contributed: r.contributedAmount.gt(0),
			insuranceWage: r.insuranceWage.toNumber(), hireDate: r.hireDate, terminationDate: r.terminationDate, wageEffectiveDate: r.wageEffectiveDate,
		}));
	}

	/**
	 * Danh sách biến động D02-LT tháng báo cáo.
	 * @param {Array} current bản ghi tháng này {employee, eligible, contributed, insuranceWage, hireDate, terminationDate, wageEffectiveDate}
	 * @param {Array|null} previous bản ghi tháng trước; null = tháng trước không có bảng lương nào
	 * @param {string} taxMonth yyyyMM tháng báo cáo
	 * @returns {Array<{employee, code (TM/ON/DC/KL/GH), fromMonth, toMonth, oldWage, newWage}>}
	 */
	function d02(current, previous, taxMonth) {
		const first = `${String(taxMonth).slice(0, 4)}-${String(taxMonth).slice(4, 6)}-01`;
		const last = Dates.endOfMonth(first);
		const mm = (d) => `${Dates.pad(Dates.month(d))}/${Dates.year(d)}`;
		const prevMap = new Map((previous || []).map((p) => [String(p.employee), p]));
		const out = [];
		const row = (r, code, from, to, oldWage, newWage) => out.push({
			employee: r.employee, employeeCode: r.employeeCode, employeeName: r.employeeName, code, fromMonth: mm(from), toMonth: to ? mm(to) : "",
			oldWage: oldWage === null || oldWage === undefined ? null : oldWage, newWage: newWage === null || newWage === undefined ? null : newWage,
		});
		for (const r of current || []) {
			const p = prevMap.get(String(r.employee)) || null;
			if (r.terminationDate && Dates.within(r.terminationDate, first, last)) {
				if (r.eligible && (r.contributed || (p && p.contributed))) row(r, "GH", Dates.addMonths(first, 1), null, r.insuranceWage, null);
				continue;
			}
			if (!r.eligible) continue;
			if (!r.contributed) {
				if (!p || p.contributed) row(r, "KL", first, first, p ? p.insuranceWage : r.insuranceWage, null);
				continue;
			}
			if (!p) {
				if (previous !== null && previous !== undefined) row(r, "TM", first, null, null, r.insuranceWage);
				else if (r.hireDate && Dates.within(r.hireDate, first, last)) row(r, "TM", first, null, null, r.insuranceWage);
				continue;
			}
			if (!p.contributed) {
				row(r, p.eligible ? "ON" : "TM", first, null, null, r.insuranceWage);
				continue;
			}
			if (!D(p.insuranceWage).eq(D(r.insuranceWage))) {
				const from = r.wageEffectiveDate && Dates.cmp(r.wageEffectiveDate, first) < 0 ? Dates.startOfMonth(r.wageEffectiveDate) : first;
				row(r, "DC", from, null, p.insuranceWage, r.insuranceWage);
			}
		}
		return out;
	}

	// ---- 4.7.4 05/KK-TNCN ----

	function isResident(row) {
		return norm(row.pitMethod) !== "N";
	}

	function hasLaborContract(row) {
		const m = norm(row.pitMethod);
		return norm(row.employmentType) !== "C" && isResident(row) && (m === "" || m === "P");
	}

	/**
	 * Chỉ tiêu [16] - [32] và danh sách cá nhân của quý.
	 * @returns {{indicators: Object<string, number>, people: Array}}
	 */
	function pitQuarterly(rows, year, quarter) {
		const recs = (rows || []).filter((r) => {
			const tm = taxMonthOf(r);
			return Number(tm.slice(0, 4)) === Number(year) && quarterOf(tm) === Number(quarter);
		}).map((r) => ({ key: String(r.employeeCode || r.employee), resident: isResident(r), labor: hasLaborContract(r), taxable: D(r.taxableIncome), pit: D(r.pit), row: r }))
			.filter((r) => !(r.taxable.isZero() && r.pit.isZero()));
		const people = (pred) => new Set(recs.filter(pred).map((r) => r.key)).size;
		const sum = (pred, f) => Money.sum(recs.filter(pred), f).toNumber();
		const i = {};
		i[16] = people(() => true);
		i[17] = people((r) => r.resident && r.labor);
		i[19] = people((r) => r.resident && r.pit.gt(0));
		i[20] = people((r) => !r.resident && r.pit.gt(0));
		i[18] = i[19] + i[20];
		i[22] = sum((r) => r.resident, (r) => r.taxable);
		i[23] = sum((r) => !r.resident, (r) => r.taxable);
		i[21] = i[22] + i[23];
		i[24] = 0;
		i[25] = 0;
		i[27] = sum((r) => r.resident && r.pit.gt(0), (r) => r.taxable);
		i[28] = sum((r) => !r.resident && r.pit.gt(0), (r) => r.taxable);
		i[26] = i[27] + i[28];
		i[30] = sum((r) => r.resident, (r) => r.pit);
		i[31] = sum((r) => !r.resident, (r) => r.pit);
		i[29] = i[30] + i[31];
		i[32] = 0;
		return { indicators: i, people: annualRows(recs.map((r) => r.row)) };
	}

	// ---- 4.7.5 quyết toán năm ----

	function annualRows(rows) {
		const map = new Map();
		for (const r of rows || []) {
			const k = String(r.employeeCode || r.employee);
			const e = map.get(k) || {
				employee: r.employee, employeeCode: r.employeeCode, employeeName: r.employeeName, taxCode: r.taxCode || "", idNumber: r.idNumber || "",
				labor: false, resident: true, periods: 0, taxableIncome: D(0), withholdingIncome: D(0), dependentCount: 0, familyDeduction: D(0),
				insurance: D(0), otherDeductions: D(0), assessableIncome: D(0), pit: D(0),
			};
			e.labor = e.labor || hasLaborContract(r);
			e.resident = e.resident && isResident(r);
			e.periods += 1;
			e.taxableIncome = e.taxableIncome.plus(D(r.taxableIncome));
			if (D(r.pit).gt(0)) e.withholdingIncome = e.withholdingIncome.plus(D(r.taxableIncome));
			e.dependentCount = Math.max(e.dependentCount, Number(r.dependentCount) || 0);
			e.familyDeduction = e.familyDeduction.plus(D(r.familyDeduction));
			e.insurance = e.insurance.plus(D(r.employeeCompulsoryInsurance));
			e.otherDeductions = e.otherDeductions.plus(D(r.otherTaxDeductions));
			e.assessableIncome = e.assessableIncome.plus(D(r.assessableIncome));
			e.pit = e.pit.plus(D(r.pit));
			if (r.taxCode) e.taxCode = r.taxCode;
			if (r.idNumber) e.idNumber = r.idNumber;
			map.set(k, e);
		}
		return [...map.values()].map((e) => ({
			employee: e.employee, employeeCode: e.employeeCode, employeeName: e.employeeName, schedule: e.labor ? "05-1/BK" : "05-2/BK", resident: e.resident,
			taxCode: e.taxCode, idNumber: e.idNumber, periods: e.periods, taxableIncome: e.taxableIncome.toNumber(), withholdingIncome: e.withholdingIncome.toNumber(),
			dependentCount: e.dependentCount, familyDeduction: e.familyDeduction.toNumber(), insurance: e.insurance.toNumber(), otherDeductions: e.otherDeductions.toNumber(),
			assessableIncome: e.assessableIncome.toNumber(), pit: e.pit.toNumber(),
		})).filter((e) => !(e.taxableIncome === 0 && e.pit === 0))
			.sort((a, b) => (a.schedule < b.schedule ? -1 : a.schedule > b.schedule ? 1 : String(a.employeeCode) < String(b.employeeCode) ? -1 : String(a.employeeCode) > String(b.employeeCode) ? 1 : 0));
	}

	/** Dữ liệu quyết toán năm; schedule: '05-1/BK' | '05-2/BK' | trống (cả hai). */
	function pitAnnual(rows, year, schedule) {
		const list = annualRows((rows || []).filter((r) => Number(taxMonthOf(r).slice(0, 4)) === Number(year)));
		return schedule ? list.filter((r) => r.schedule === schedule) : list;
	}

	return { taxMonthOf, quarterOf, insuranceByEmployee, c12Difference, monthRecords, d02, pitQuarterly, pitAnnual, isResident, hasLaborContract };
});
