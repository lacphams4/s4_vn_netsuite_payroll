/**
 * Tra tham số pháp lý theo ngày hiệu lực (đặc tả mục 2.2.1, theo VPParameterProvider - bản chạy thật).
 *
 * Ba bảng: tham số đơn (code + effectiveDate), biểu thuế (effectiveDate + level), khoản trích (code + effectiveDate).
 * Một bản ghi hiệu lực tại ngày d khi effectiveDate <= d và (expirationDate null hoặc >= d).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./Errors"], (Money, Dates, Errors) => {
	function effective(rec, d) {
		return Dates.cmp(rec.effectiveDate, d) <= 0 && (!rec.expirationDate || Dates.cmp(rec.expirationDate, d) >= 0);
	}

	function latest(list) {
		let best = null;
		for (const r of list) if (!best || Dates.cmp(r.effectiveDate, best.effectiveDate) > 0) best = r;
		return best;
	}

	/**
	 * @param {{params?: Array, brackets?: Array, components?: Array}} data
	 *   params: {code, effectiveDate, expirationDate, value}
	 *   brackets: {effectiveDate, expirationDate, level, upperBound (null = bậc cuối), rate}
	 *   components: {code, description, effectiveDate, expirationDate, employeeRate, employerRate, wageBase ('S'|'U'),
	 *                requiresUnionMembership, employeeCapFactor (null hoặc số), liabilityAccount, vendor}
	 */
	function create(data) {
		const params = (data && data.params) || [];
		const brackets = (data && data.brackets) || [];
		const components = (data && data.components) || [];

		/** Giá trị tham số (Decimal) hiệu lực tại d; không có thì lỗi VP-PARAM-MISSING. */
		function getValue(code, d) {
			const key = String(code).trim().toUpperCase();
			const hit = latest(params.filter((p) => String(p.code).trim().toUpperCase() === key && effective(p, d)));
			if (!hit) {
				throw new Errors.PayrollError(
					Errors.Codes.PARAM_MISSING,
					`Parameter ${key} effective on ${Dates.vn(d)} is not defined.`,
					`Tham số ${key} hiệu lực ngày ${Dates.vn(d)} chưa được khai báo.`
				);
			}
			return Money.D(hit.value);
		}

		/** Như getValue nhưng trả null khi thiếu. */
		function tryGetValue(code, d) {
			try {
				return getValue(code, d);
			} catch (e) {
				if (e.code === Errors.Codes.PARAM_MISSING) return null;
				throw e;
			}
		}

		/** Bộ biểu thuế mới nhất hiệu lực tại d, sắp theo bậc; không trộn hai bộ chồng khoảng. */
		function getPitBrackets(d) {
			const live = brackets.filter((b) => effective(b, d));
			if (!live.length) {
				throw new Errors.PayrollError(
					Errors.Codes.PARAM_MISSING,
					`No progressive tax bracket is effective on ${Dates.vn(d)}.`,
					`Chưa có biểu thuế lũy tiến hiệu lực ngày ${Dates.vn(d)}.`
				);
			}
			const top = latest(live).effectiveDate;
			return live
				.filter((b) => Dates.cmp(b.effectiveDate, top) === 0)
				.sort((a, b) => a.level - b.level)
				.map((b) => ({ level: b.level, upperBound: b.upperBound === null || b.upperBound === undefined || b.upperBound === "" ? null : Money.D(b.upperBound), rate: Money.D(b.rate) }));
		}

		/** Khoản trích hiệu lực tại d, mỗi mã lấy bản có effectiveDate muộn nhất; giữ thứ tự khai báo. */
		function getInsuranceComponents(d) {
			const byCode = new Map();
			for (const c of components) {
				if (!effective(c, d)) continue;
				const key = String(c.code).trim().toUpperCase();
				const cur = byCode.get(key);
				if (!cur || Dates.cmp(c.effectiveDate, cur.effectiveDate) > 0) byCode.set(key, c);
			}
			return [...byCode.values()].map((c) => Object.assign({}, c, { code: String(c.code).trim().toUpperCase() }));
		}

		return { getValue, tryGetValue, getPitBrackets, getInsuranceComponents, data: { params, brackets, components } };
	}

	return { create, effective };
});
