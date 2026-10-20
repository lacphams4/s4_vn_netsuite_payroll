/**
 * Mẫu xoay ca (đặc tả mục 3.3, VP102060): chu kỳ n ngày, mỗi ngày một mã ca hoặc trống (nghỉ).
 *
 * anchor là ngày ứng với phần tử đầu của chu kỳ; lệch kíp bằng cách dời anchor (3 ca 4 kíp: kíp k dùng
 * anchor = from - 2k).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates", "./Errors"], (Dates, Errors) => {
	/**
	 * @param {Array<string|null>} cycle mã ca theo DayNbr tăng dần; trống = nghỉ
	 * @param {string} anchor ngày ứng với cycle[0]
	 * @param {string} from
	 * @param {string} to
	 * @returns {Array<{date: string, shiftCode: string|null}>}
	 */
	function expand(cycle, anchor, from, to) {
		const n = (cycle || []).length;
		if (!n) throw Errors.invalid("The shift pattern has no days.", "Mẫu xoay ca chưa có ngày nào.");
		const a = Dates.toDay(anchor);
		const out = [];
		for (let t = Dates.toDay(from), e = Dates.toDay(to); t <= e; t++) {
			let i = (t - a) % n;
			if (i < 0) i += n;
			const c = cycle[i];
			out.push({ date: Dates.fromDay(t), shiftCode: c === null || c === undefined || String(c).trim() === "" ? null : String(c).trim() });
		}
		return out;
	}

	return { expand };
});
