/**
 * Mốc việc của kỳ lương cho Trang chủ (docs/UI_V2.md): chọn kỳ đang chạy theo NGÀY (không theo mã kỳ, vì mã kỳ có thể
 * lệch tháng so với ngày bắt đầu / kết thúc) và tính trạng thái từng mốc so với hôm nay.
 *
 * KHÔNG chứa giá trị pháp lý nào. Mốc nội bộ (khóa công, tính lương, duyệt, ghi sổ) suy ra từ dữ liệu của kỳ và bảng lương:
 *   lockAttendance  ngày kết thúc kỳ; xong khi công của kỳ đã khóa (att_status = "L").
 *   calculate       ngày kết thúc kỳ; xong khi bảng lương đã tính (cờ calculated và trạng thái C, P, A, R, V).
 *   approve         ngày chứng từ của bảng lương (doc_date, thiếu thì ngày kết thúc kỳ); xong khi A, R, V.
 *   post            ngày chứng từ của bảng lương; xong khi R (hoặc V - đã ghi sổ rồi đảo).
 * Có thể dời từng mốc nội bộ bằng input.offsets = { key: số ngày cộng thêm } (thiết lập của đơn vị, mặc định 0).
 *
 * Hạn theo luật (nộp tờ khai, nộp bảo hiểm...) chỉ xuất hiện khi nơi gọi truyền vào input.statutory =
 * [{ key, date, done? }] lấy từ thiết lập / tham số pháp lý; dòng thiếu ngày hoặc ngày sai bị bỏ qua.
 *
 * milestones(input) -> [{ key, date, state, daysLeft }]
 *   state: "done" | "overdue" (chưa xong, đã quá ngày) | "due" (chưa xong, còn 0 .. dueSoonDays ngày) | "upcoming".
 *   daysLeft = date - today (âm khi đã quá ngày); dueSoonDays mặc định 3 (ngưỡng nhắc việc của giao diện, không phải luật).
 *   Thứ tự: mốc nội bộ theo quy trình, sau đó hạn truyền vào theo ngày tăng dần.
 *
 * currentPeriod(periods, today, activePeriodIds) -> kỳ đang chạy hoặc null. Chỉ xét kỳ chưa đóng (status khác "C"), ngày hợp lệ:
 *   1. kỳ sớm nhất đang có bảng lương chưa ghi sổ (id nằm trong activePeriodIds);
 *   2. kỳ chứa hôm nay (start <= today <= end; nhiều kỳ thì kỳ bắt đầu muộn nhất);
 *   3. kỳ đã qua gần nhất; 4. kỳ sắp tới gần nhất.
 * previousPeriod(periods, current) -> kỳ liền trước cùng nhóm lương (kết thúc trước ngày bắt đầu của kỳ hiện tại), hoặc null.
 * upcomingPeriods(periods, today, limit) -> các kỳ chưa đóng bắt đầu sau hôm nay, gần nhất trước.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates"], (Dates) => {
	const INTERNAL_KEYS = ["lockAttendance", "calculate", "approve", "post"];
	const DEFAULT_DUE_SOON = 3;

	/** Chuẩn hóa ngày; ngày thiếu hoặc sai trả null (không ném lỗi). */
	function safeIso(v) {
		try {
			const s = Dates.iso(v);
			if (!s) return null;
			// Loại ngày không có thật (2027-02-31): quy đổi qua số ngày phải ra đúng chuỗi cũ
			return Dates.fromDay(Dates.toDay(s)) === s ? s : null;
		} catch (e) {
			return null;
		}
	}

	const upper = (v) => String(v === null || v === undefined ? "" : v).trim().toUpperCase();
	const truthy = (v) => v === true || v === "T" || v === 1 || v === "1" || v === "true";
	const wholeNumber = (v, fallback) => {
		const n = Number(v);
		return v !== null && v !== undefined && v !== "" && isFinite(n) ? Math.trunc(n) : fallback;
	};

	function stateOf(done, daysLeft, dueSoonDays) {
		if (done) return "done";
		if (daysLeft < 0) return "overdue";
		return daysLeft <= dueSoonDays ? "due" : "upcoming";
	}

	function milestones(input) {
		const i = input || {};
		const today = safeIso(i.today);
		if (!today) return [];
		const dueSoon = Math.max(0, wholeNumber(i.dueSoonDays, DEFAULT_DUE_SOON));
		const offsets = i.offsets || {};
		const out = [];
		const push = (key, date, done) => {
			const d = safeIso(date);
			if (!key || !d) return;
			const daysLeft = Dates.diff(today, d);
			out.push({ key: String(key), date: d, state: stateOf(!!done, daysLeft, dueSoon), daysLeft });
		};

		const period = i.period || null;
		const end = period ? safeIso(period.end) : null;
		if (end) {
			const batch = i.batch || null;
			const status = upper(batch && batch.status);
			const locked = upper(period.att_status || period.attStatus) === "L" || truthy((i.attendance || {}).locked);
			const calculated = !!batch && (["P", "A", "R", "V"].includes(status) || (status === "C" && truthy(batch.calculated)));
			const docDate = (batch && safeIso(batch.doc_date || batch.docDate)) || end;
			const shift = (key, base) => Dates.addDays(base, wholeNumber(offsets[key], 0));
			push("lockAttendance", shift("lockAttendance", end), locked);
			push("calculate", shift("calculate", end), calculated);
			push("approve", shift("approve", docDate), ["A", "R", "V"].includes(status));
			push("post", shift("post", docDate), status === "R" || status === "V");
		}

		const internalCount = out.length;
		for (const s of Array.isArray(i.statutory) ? i.statutory : []) {
			if (!s || INTERNAL_KEYS.includes(String(s.key))) continue;
			push(s.key, s.date, truthy(s.done));
		}
		const extra = out.splice(internalCount).sort((a, b) => Dates.cmp(a.date, b.date) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		return out.concat(extra);
	}

	/** Kỳ dùng được: chưa đóng, có ngày bắt đầu và kết thúc hợp lệ, bắt đầu không sau kết thúc. */
	function usable(periods) {
		return (Array.isArray(periods) ? periods : [])
			.map((p) => (p ? { p, start: safeIso(p.start), end: safeIso(p.end) } : null))
			.filter((x) => x && x.start && x.end && Dates.cmp(x.start, x.end) <= 0 && upper(x.p.status) !== "C");
	}

	/**
	 * Kỳ đang chạy. Thứ tự: kỳ có bảng lương đang dở (activePeriodIds) -> kỳ chứa hôm nay -> kỳ đã qua gần nhất -> kỳ sớm nhất.
	 * postedPeriodIds (tùy chọn): kỳ đã có bảng lương ghi sổ. Khi kỳ chứa hôm nay (hoặc kỳ đã qua gần nhất) đã ghi sổ xong thì việc
	 * tiếp theo là kỳ kế sau kỳ ghi sổ muộn nhất - trả kỳ đó thay cho một kỳ không còn việc gì.
	 */
	function currentPeriod(periods, today, activePeriodIds, postedPeriodIds) {
		const t = safeIso(today);
		const list = usable(periods);
		if (!t || !list.length) return null;
		const active = new Set((activePeriodIds || []).map(String));
		const byStart = (a, b) => Dates.cmp(a.start, b.start) || Dates.cmp(a.end, b.end);
		const running = list.filter((x) => active.has(String(x.p.id))).sort(byStart);
		if (running.length) return running[0].p;
		const posted = new Set((postedPeriodIds || []).map(String));
		if (posted.size) {
			const done = list.filter((x) => posted.has(String(x.p.id))).sort((a, b) => Dates.cmp(a.end, b.end));
			const last = done.length ? done[done.length - 1] : null;
			const byDate = list.filter((x) => Dates.within(t, x.start, x.end)).sort(byStart);
			const pastList = list.filter((x) => Dates.cmp(x.end, t) < 0).sort((a, b) => Dates.cmp(a.end, b.end));
			const natural = byDate.length ? byDate[byDate.length - 1] : pastList.length ? pastList[pastList.length - 1] : null;
			if (last && natural && Dates.cmp(natural.end, last.end) <= 0) {
				// Ưu tiên kỳ cùng nhóm lương với kỳ vừa ghi sổ (tài khoản nhiều nhóm lương có kỳ trùng ngày)
				const groupOf = (x) => (x.p.paygroup === null || x.p.paygroup === undefined ? "" : String(x.p.paygroup));
				const later = list.filter((x) => Dates.cmp(x.start, last.end) > 0).sort(byStart);
				const next = later.filter((x) => groupOf(x) === groupOf(last))[0] || later[0];
				if (next) return next.p;
			}
		}
		const containing = list.filter((x) => Dates.within(t, x.start, x.end)).sort(byStart);
		if (containing.length) return containing[containing.length - 1].p;
		const past = list.filter((x) => Dates.cmp(x.end, t) < 0).sort((a, b) => Dates.cmp(a.end, b.end));
		if (past.length) return past[past.length - 1].p;
		return list.sort(byStart)[0].p;
	}

	function previousPeriod(periods, current) {
		const start = current ? safeIso(current.start) : null;
		if (!start) return null;
		const group = current.paygroup === null || current.paygroup === undefined ? "" : String(current.paygroup);
		let best = null;
		for (const p of Array.isArray(periods) ? periods : []) {
			if (!p || String(p.id) === String(current.id)) continue;
			if ((p.paygroup === null || p.paygroup === undefined ? "" : String(p.paygroup)) !== group) continue;
			const end = safeIso(p.end);
			if (!end || Dates.cmp(end, start) >= 0) continue;
			if (!best || Dates.cmp(end, best.end) > 0) best = { p, end };
		}
		return best ? best.p : null;
	}

	function upcomingPeriods(periods, today, limit) {
		const t = safeIso(today);
		if (!t) return [];
		const n = Math.max(0, wholeNumber(limit, 1));
		return usable(periods)
			.filter((x) => Dates.cmp(x.start, t) > 0)
			.sort((a, b) => Dates.cmp(a.start, b.start))
			.slice(0, n)
			.map((x) => x.p);
	}

	return { INTERNAL_KEYS, DEFAULT_DUE_SOON, milestones, currentPeriod, previousPeriod, upcomingPeriods };
});
