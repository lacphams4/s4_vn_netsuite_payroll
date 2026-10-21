/**
 * Sinh kỳ lương theo nhóm lương (đặc tả mục 2.8; PayPeriodGenerator của S4.VP.Core).
 *
 * Mã kỳ: nhóm DEFAULT (tiền tố trống) yyyyMM; nhóm khác <TIỀN TỐ>-yyyyMM, -yyyyMMS1/S2, -yyyyWnn; tối đa 15 ký tự.
 * Tuần thuộc năm của ngày cuối tuần, các tuần liên tục không chồng ngày. TaxMonth = yyyyMM theo ngày cuối kỳ;
 * IsLastInTaxMonth cho kỳ có ngày cuối muộn nhất trong mỗi TaxMonth.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./Errors", "./WorkingDayCounter"], (Dates, Errors, WorkingDayCounter) => {
	const MAX_ID = 15;
	/** Độ dài tối đa của mã nhóm lương (tiền tố) để mã kỳ không vượt 15 ký tự. */
	const MAX_PREFIX = { M: 8, W: 7, S: 6 };

	function head(prefix) {
		const p = prefix === null || prefix === undefined ? "" : String(prefix).trim().toUpperCase();
		return p ? p + "-" : "";
	}

	function checkId(id) {
		if (id.length > MAX_ID) {
			throw Errors.invalid(
				`The pay period ID ${id} is longer than ${MAX_ID} characters. Use a shorter pay group ID.`,
				`Mã kỳ lương ${id} dài hơn ${MAX_ID} ký tự. Hãy dùng mã nhóm lương ngắn hơn.`
			);
		}
		return id;
	}

	/**
	 * Sinh kỳ của một năm.
	 * @param {number} year 2000-2100
	 * @param {"M"|"S"|"W"} frequency tháng, nửa tháng, tuần
	 * @param {string} [prefix] mã nhóm lương; trống = nhóm DEFAULT
	 * @param {number} [weekStart=1] ngày đầu tuần 0 = Chủ nhật ... 6 = thứ Bảy
	 * @returns {Array<{periodId, number, startDate, endDate, taxMonth, isLastInTaxMonth, frequency}>}
	 */
	function generate(year, frequency, prefix, weekStart = 1) {
		year = Number(year);
		if (!Number.isInteger(year) || year < 2000 || year > 2100) {
			throw Errors.invalid(`The year ${year} is outside 2000-2100.`, `Năm ${year} nằm ngoài khoảng 2000-2100.`);
		}
		const h = head(prefix);
		const freq = frequency || "M";
		const out = [];
		if (freq === "M") {
			for (let m = 1; m <= 12; m++) {
				const start = Dates.ymd(year, m, 1);
				out.push({ periodId: checkId(`${h}${year}${Dates.pad(m)}`), number: m, startDate: start, endDate: Dates.endOfMonth(start) });
			}
		} else if (freq === "S") {
			for (let m = 1; m <= 12; m++) {
				const s1 = Dates.ymd(year, m, 1);
				out.push({ periodId: checkId(`${h}${year}${Dates.pad(m)}S1`), number: 2 * m - 1, startDate: s1, endDate: Dates.ymd(year, m, 15) });
				out.push({ periodId: checkId(`${h}${year}${Dates.pad(m)}S2`), number: 2 * m, startDate: Dates.ymd(year, m, 16), endDate: Dates.endOfMonth(s1) });
			}
		} else if (freq === "W") {
			const ws = ((Number(weekStart) % 7) + 7) % 7;
			const jan1 = Dates.ymd(year, 1, 1);
			let start = Dates.addDays(jan1, -((Dates.dayOfWeek(jan1) - ws + 7) % 7));
			let n = 0;
			for (;;) {
				const end = Dates.addDays(start, 6);
				const y = Dates.year(end);
				if (y > year) break;
				if (y === year) {
					n++;
					out.push({ periodId: checkId(`${h}${year}W${Dates.pad(n)}`), number: n, startDate: start, endDate: end });
				}
				start = Dates.addDays(start, 7);
			}
		} else {
			throw Errors.invalid(`Unknown pay frequency ${freq}.`, `Tần suất kỳ lương ${freq} không hợp lệ.`);
		}
		const lastEnd = {};
		for (const p of out) {
			p.frequency = freq;
			p.taxMonth = Dates.yyyymm(p.endDate);
			if (!lastEnd[p.taxMonth] || Dates.cmp(p.endDate, lastEnd[p.taxMonth]) > 0) lastEnd[p.taxMonth] = p.endDate;
		}
		for (const p of out) p.isLastInTaxMonth = p.endDate === lastEnd[p.taxMonth];
		return out;
	}

	/**
	 * Điền ngày công chuẩn: kỳ tháng đếm ngày làm việc của kỳ; kỳ nửa tháng / tuần dùng ngày công chuẩn THÁNG của nhóm.
	 * @param {Array} periods kết quả generate
	 * @param {{weeklyOff?: string, holidays?: Array, payGroupStandardDays?: number}} opts
	 */
	function withStandardDays(periods, opts) {
		const o = opts || {};
		return periods.map((p) => Object.assign({}, p, {
			standardWorkDays: p.frequency === "M" || !p.frequency
				? WorkingDayCounter.countWorkDays(p.startDate, p.endDate, o.weeklyOff, o.holidays)
				: Number(o.payGroupStandardDays) || 0,
		}));
	}

	/** Kiểm tra độ dài mã nhóm lương theo tần suất (khi lưu nhóm lương). Trả null nếu hợp lệ, ngược lại thông báo. */
	function validatePayGroupId(payGroupId, frequency) {
		const id = String(payGroupId || "").trim();
		const max = MAX_PREFIX[frequency || "M"];
		if (id.toUpperCase() === "DEFAULT") return null;
		if (max && id.length > max) {
			return {
				message: `The pay group ID must not exceed ${max} characters for this frequency so that period IDs stay within ${MAX_ID} characters.`,
				messageVi: `Mã nhóm lương không quá ${max} ký tự với tần suất này để mã kỳ không vượt ${MAX_ID} ký tự.`,
			};
		}
		return null;
	}

	/**
	 * Mã kỳ nhập tay của nhóm DEFAULT: phải đúng yyyyMM (năm >= 2000, tháng 1-12) trừ khi có dấu "-".
	 * @returns {{valid: boolean, startDate?: string, endDate?: string, taxMonth?: string}}
	 */
	function parseManualPeriodId(periodId) {
		const id = String(periodId || "").trim();
		if (id.includes("-")) return { valid: id.length <= MAX_ID };
		const m = /^(\d{4})(\d{2})$/.exec(id);
		if (!m || +m[1] < 2000 || +m[2] < 1 || +m[2] > 12) return { valid: false };
		const start = Dates.ymd(+m[1], +m[2], 1);
		return { valid: true, startDate: start, endDate: Dates.endOfMonth(start), taxMonth: id };
	}

	/** TaxMonth suy từ ngày cuối kỳ. */
	function taxMonthOf(endDate) {
		return Dates.yyyymm(endDate);
	}

	return { MAX_ID, MAX_PREFIX, generate, withStandardDays, validatePayGroupId, parseManualPeriodId, taxMonthOf };
});
