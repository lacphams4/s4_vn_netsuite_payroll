/**
 * Bảo hiểm bắt buộc và công đoàn (InsuranceCalculator, đặc tả mục 2.3).
 *
 * Căn cứ đóng là lương đóng BH khai báo (InsuranceWage), không phải thu nhập thực tế. Kiểm tra vùng và lương tối thiểu
 * vùng chạy trước kiểm tra ngưỡng 14 ngày nghỉ. Mỗi khoản làm tròn riêng phần NLĐ và phần DN rồi mới cộng.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./Errors"], (Money, Dates, Errors) => {
	const D = Money.D;

	/** Kết quả rỗng (không thuộc diện BH hoặc CTV). */
	function empty() {
		return {
			siBase: 0, uiBase: 0, minWage: 0, reference: 0, skippedForAbsence: false, lines: [],
			employeeTotal: 0, employeeCompulsoryInsurance: 0, employerTotal: 0,
		};
	}

	/**
	 * @param {Object} input
	 * @param {string} input.periodDate ngày tính (cuối kỳ hoặc cuối tháng tính thuế)
	 * @param {number|string} input.insuranceWage lương đóng BHXH
	 * @param {string} input.region vùng I-IV
	 * @param {number|string} [input.absenceWorkingDays] ngày nghỉ xét ngưỡng 14 ngày
	 * @param {boolean} [input.isUnionMember]
	 * @param {boolean} [input.unemploymentApplicable=true]
	 * @param {boolean} [input.unionFundApplicable=true]
	 * @param {Object<string, number|string>} [input.employerRateOverrides] ghi đè tỷ lệ DN theo mã khoản
	 * @param {Object} provider StatutoryParameterProvider
	 */
	function calculate(input, provider) {
		const date = Dates.iso(input.periodDate);
		const region = String(input.region === null || input.region === undefined ? "" : input.region).trim().toUpperCase();
		const minWage = region ? provider.tryGetValue("MINWAGE." + region, date) : null;
		if (!minWage) {
			throw new Errors.PayrollError(
				Errors.Codes.UNKNOWN_REGION,
				`Minimum wage region "${region}" is not defined on ${Dates.vn(date)}.`,
				`Vùng lương tối thiểu "${region}" chưa được khai báo tại ngày ${Dates.vn(date)}.`
			);
		}
		const wage = D(input.insuranceWage);
		if (wage.lt(minWage)) {
			throw new Errors.PayrollError(
				Errors.Codes.BELOW_MINWAGE,
				`The insurance wage ${fmt(wage, "en")} is below the regional minimum wage ${fmt(minWage, "en")} (region ${region}).`,
				`Lương đóng BHXH ${fmt(wage, "vi")} thấp hơn lương tối thiểu vùng ${region} (${fmt(minWage, "vi")}).`
			);
		}
		const reference = provider.getValue("INS.REFERENCE_WAGE", date);
		const siCap = reference.times(provider.getValue("INS.SI_CAP_MULTIPLIER", date));
		const uiCap = minWage.times(provider.getValue("INS.UI_CAP_MULTIPLIER", date));
		const siBase = Money.min(wage, siCap);
		const uiBase = Money.min(wage, uiCap);
		const result = empty();
		result.siBase = siBase.toNumber();
		result.uiBase = uiBase.toNumber();
		result.minWage = minWage.toNumber();
		result.reference = reference.toNumber();

		const threshold = provider.getValue("INS.ABSENCE_DAYS_THRESHOLD", date);
		if (D(input.absenceWorkingDays).gte(threshold)) {
			result.skippedForAbsence = true;
			return result;
		}

		const unemployment = input.unemploymentApplicable !== false;
		const unionFund = input.unionFundApplicable !== false;
		const overrides = normalizeOverrides(input.employerRateOverrides);
		let ee = D(0);
		let eeCompulsory = D(0);
		let er = D(0);
		for (const c of provider.getInsuranceComponents(date)) {
			if (c.requiresUnionMembership && !input.isUnionMember) continue;
			if (c.code === "BHTN" && !unemployment) continue;
			if (c.code === "KPCD" && !unionFund) continue;
			const base = String(c.wageBase || "S").toUpperCase() === "U" ? uiBase : siBase;
			const employeeRate = D(c.employeeRate);
			const employerRate = Object.prototype.hasOwnProperty.call(overrides, c.code) ? D(overrides[c.code]) : D(c.employerRate);
			let employeeAmount = Money.round(base.times(employeeRate));
			if (c.employeeCapFactor !== null && c.employeeCapFactor !== undefined && c.employeeCapFactor !== "") {
				employeeAmount = Math.min(employeeAmount, Money.round(reference.times(D(c.employeeCapFactor))));
			}
			const employerAmount = Money.round(base.times(employerRate));
			result.lines.push({
				code: c.code, description: c.description || c.name || c.code, nameVi: c.nameVi || "", wageBase: base.toNumber(),
				employeeRate: employeeRate.toNumber(), employerRate: employerRate.toNumber(), employeeAmount, employerAmount,
				liabilityAccount: c.liabilityAccount || null, vendor: c.vendor || null,
			});
			ee = ee.plus(employeeAmount);
			if (c.code !== "DOANPHI") eeCompulsory = eeCompulsory.plus(employeeAmount);
			er = er.plus(employerAmount);
		}
		result.employeeTotal = ee.toNumber();
		result.employeeCompulsoryInsurance = eeCompulsory.toNumber();
		result.employerTotal = er.toNumber();
		return result;
	}

	function normalizeOverrides(o) {
		const out = {};
		for (const k of Object.keys(o || {})) {
			if (o[k] === null || o[k] === undefined || o[k] === "") continue;
			out[String(k).trim().toUpperCase()] = o[k];
		}
		return out;
	}

	/** Định dạng số nghìn: en dùng dấu phẩy, vi dùng dấu chấm. */
	function fmt(x, lang) {
		const s = D(x).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, lang === "vi" ? "." : ",");
		return s;
	}

	return { calculate, empty, fmt };
});
