/**
 * Ngày dạng chuỗi ISO 'YYYY-MM-DD' (không giờ, không múi giờ) cho toàn bộ lõi.
 *
 * Lõi so sánh theo phần ngày, khoảng ngày luôn gồm hai đầu. Tránh đối tượng Date có giờ địa phương: máy chủ
 * NetSuite và người dùng khác múi giờ. Nội bộ quy về số ngày kể từ 1970-01-01 (UTC).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
	const MS_DAY = 86400000;

	/** Chuẩn hóa đầu vào (chuỗi ISO, chuỗi có giờ, Date) về 'YYYY-MM-DD'; null, rỗng thành null. */
	function iso(x) {
		if (x === null || x === undefined || x === "") return null;
		if (x instanceof Date) {
			return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
		}
		const s = String(x).trim();
		const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
		if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
		const v = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); // dd/MM/yyyy
		if (v) return `${v[3]}-${pad(+v[2])}-${pad(+v[1])}`;
		throw new Error(`Invalid date: ${s}`);
	}

	function pad(n, w = 2) {
		return String(n).padStart(w, "0");
	}

	/** Số ngày kể từ 1970-01-01. */
	function toDay(d) {
		const s = iso(d);
		return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / MS_DAY);
	}

	function fromDay(n) {
		const t = new Date(n * MS_DAY);
		return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
	}

	function ymd(y, m, d) {
		return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
	}

	function addDays(d, n) {
		return fromDay(toDay(d) + n);
	}

	/** Cộng tháng giữ ngày, ngày vượt cuối tháng thì lấy ngày cuối tháng (như DateTime.AddMonths). */
	function addMonths(d, n) {
		const s = iso(d);
		let y = +s.slice(0, 4);
		let m = +s.slice(5, 7) - 1 + n;
		y += Math.floor(m / 12);
		m = ((m % 12) + 12) % 12;
		const day = Math.min(+s.slice(8, 10), daysInMonth(y, m + 1));
		return ymd(y, m + 1, day);
	}

	function daysInMonth(y, m) {
		return new Date(Date.UTC(y, m, 0)).getUTCDate();
	}

	/** Thứ trong tuần: 0 = Chủ nhật ... 6 = thứ Bảy. */
	function dayOfWeek(d) {
		return new Date(toDay(d) * MS_DAY).getUTCDay();
	}

	function year(d) {
		return +iso(d).slice(0, 4);
	}

	function month(d) {
		return +iso(d).slice(5, 7);
	}

	function day(d) {
		return +iso(d).slice(8, 10);
	}

	function startOfMonth(d) {
		const s = iso(d);
		return s.slice(0, 8) + "01";
	}

	function endOfMonth(d) {
		const s = iso(d);
		return ymd(+s.slice(0, 4), +s.slice(5, 7), daysInMonth(+s.slice(0, 4), +s.slice(5, 7)));
	}

	/** Hiệu số ngày b - a. */
	function diff(a, b) {
		return toDay(b) - toDay(a);
	}

	function cmp(a, b) {
		return toDay(a) - toDay(b);
	}

	function max(a, b) {
		return cmp(a, b) >= 0 ? iso(a) : iso(b);
	}

	function min(a, b) {
		return cmp(a, b) <= 0 ? iso(a) : iso(b);
	}

	/** a <= d <= b (bỏ qua đầu null). */
	function within(d, a, b) {
		return (!a || cmp(a, d) <= 0) && (!b || cmp(d, b) <= 0);
	}

	/** Mọi ngày trong [from, to]. */
	function range(from, to) {
		const out = [];
		for (let n = toDay(from), e = toDay(to); n <= e; n++) out.push(fromDay(n));
		return out;
	}

	/** 'yyyyMM' của ngày. */
	function yyyymm(d) {
		const s = iso(d);
		return s.slice(0, 4) + s.slice(5, 7);
	}

	/** dd/MM/yyyy cho bản in và thông báo. */
	function vn(d) {
		const s = iso(d);
		return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "";
	}

	return {
		iso, toDay, fromDay, ymd, addDays, addMonths, daysInMonth, dayOfWeek, year, month, day, startOfMonth, endOfMonth,
		diff, cmp, max, min, within, range, yyyymm, vn, pad,
	};
});
