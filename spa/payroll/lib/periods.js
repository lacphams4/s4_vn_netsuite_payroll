/**
 * Danh sách kỳ lương cho ô chọn kỳ của mọi màn: chỉ kỳ của nhóm lương thuộc công ty con đang chọn (công ty không có nhóm
 * riêng thì dùng nhóm không gắn công ty, ví dụ DEFAULT), sắp giảm dần, nhãn dễ đọc "Tháng 11/2026 (01/11 - 30/11)", mã kỳ
 * để ở tooltip (title). Công ty có nhiều nhóm lương thì gom theo nhóm (trường group của mục, kit.js vẽ thành nhóm; Dropdown
 * UIF của màn cũ dùng tiền tố mã nhóm qua prefixGroup).
 *
 * boot.periods: [{id, code, paygroup, start, end, status, attStatus, taxMonth}]; boot.paygroups: [{id, code, description, subsidiary}].
 */
import {pick, resolve} from './i18n.js';
import {fmtDate, localToday} from './format.js';

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const TEXT = {
	vi: {
		month: (m, y) => `Tháng ${m}/${y}`,
		code: (c) => `Mã kỳ ${c}`,
		attLocked: 'công đã khóa',
		closed: 'kỳ đã đóng',
	},
	en: {
		month: (m, y) => `${EN_MONTHS[m - 1] || m} ${y}`,
		code: (c) => `Period code ${c}`,
		attLocked: 'attendance locked',
		closed: 'period closed',
	},
};

const LOCK = '🔒';
const str = (v) => (v === null || v === undefined ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);

/** Nhóm lương dùng cho công ty con: nhóm gắn công ty đó; không có thì nhóm không gắn công ty; chưa chọn công ty thì mọi nhóm. */
export function groupsForSubsidiary(boot, subsidiary) {
	const groups = arr((boot || {}).paygroups);
	const sub = str(subsidiary);
	if (!sub) return groups;
	const own = groups.filter((g) => str(g.subsidiary) === sub);
	return own.length ? own : groups.filter((g) => !str(g.subsidiary));
}

// Giảm dần theo ngày bắt đầu, cùng ngày thì theo mã kỳ
const byStartDesc = (a, b) => (str(a.start) === str(b.start) ? (str(a.code) < str(b.code) ? 1 : -1) : str(a.start) < str(b.start) ? 1 : -1);

/**
 * Kỳ của công ty con, sắp giảm dần. Kỳ không gắn nhóm lương (dữ liệu cũ) đi cùng nhóm dùng chung.
 * Chưa có nhóm lương nào thì trả mọi kỳ (không giấu dữ liệu).
 */
export function periodsForSubsidiary(boot, subsidiary) {
	const all = arr((boot || {}).periods);
	const groups = groupsForSubsidiary(boot, subsidiary);
	if (!arr((boot || {}).paygroups).length) return all.slice().sort(byStartDesc);
	const ids = new Set(groups.map((g) => str(g.id)));
	const shared = groups.some((g) => !str(g.subsidiary));
	// Cùng ngày bắt đầu thì theo thứ tự nhóm lương (nhóm khai trước đứng trước)
	const rank = {};
	groups.forEach((g, i) => (rank[str(g.id)] = i));
	const r = (p) => (Object.prototype.hasOwnProperty.call(rank, str(p.paygroup)) ? rank[str(p.paygroup)] : 1e6);
	return all.filter((p) => ids.has(str(p.paygroup)) || (shared && !str(p.paygroup))).sort((a, b) => (str(a.start) === str(b.start) ? r(a) - r(b) || byStartDesc(a, b) : byStartDesc(a, b)));
}

// "01/11 - 30/11" khi cùng năm, khác năm thì đủ ngày
function shortRange(p) {
	const s = str(p.start);
	const e = str(p.end);
	if (!s || !e) return '';
	if (s.slice(0, 4) === e.slice(0, 4)) return `${fmtDate(s).slice(0, 5)} - ${fmtDate(e).slice(0, 5)}`;
	return `${fmtDate(s)} - ${fmtDate(e)}`;
}

/** Tháng của kỳ: theo tháng thuế (YYYYMM), không có thì theo ngày bắt đầu; {m, y} hoặc null. */
function monthOf(p) {
	// Theo ngày bắt đầu để tháng trong nhãn luôn khớp khoảng ngày hiện cạnh đó; không có ngày thì theo tháng thuế
	const st = /^(\d{4})-(\d{2})-\d{2}$/.exec(str(p.start));
	if (st) return {y: st[1], m: Number(st[2])};
	const tm = /^(\d{4})(\d{2})$/.exec(str(p.taxMonth));
	return tm ? {y: tm[1], m: Number(tm[2])} : null;
}

/** Kỳ bị khóa theo kiểu: 'att' = công đã khóa, 'status' = kỳ đã đóng, khác thì không xét. */
const isLocked = (p, lock) => (lock === 'att' ? p.attStatus === 'L' : lock === 'status' ? p.status === 'C' : false);

/**
 * Nhãn dễ đọc của kỳ: "Tháng 11/2026 (01/11 - 30/11)", thêm 🔒 khi khóa (opts.lock). Không suy được tháng thì dùng mã kỳ.
 * @param {object} p kỳ của boot.periods
 * @param {{lock?: string, lang?: string}} [opts]
 */
export function periodLabel(p, opts) {
	const o = opts || {};
	const t = o.lang ? resolve(TEXT, o.lang) : pick(TEXT);
	const mo = monthOf(p || {});
	const range = shortRange(p || {});
	const head = mo ? t.month(mo.m, mo.y) : str((p || {}).code);
	return `${head}${range ? ` (${range})` : ''}${isLocked(p || {}, o.lock) ? ` ${LOCK}` : ''}`;
}

/** Tooltip của kỳ: mã kỳ (kèm lý do khóa). */
export function periodTitle(p, opts) {
	const o = opts || {};
	const t = o.lang ? resolve(TEXT, o.lang) : pick(TEXT);
	const why = isLocked(p || {}, o.lock) ? (o.lock === 'att' ? t.attLocked : t.closed) : '';
	return `${t.code(str((p || {}).code))}${why ? ` - ${why}` : ''}`;
}

/**
 * Mục cho ô chọn kỳ: [{value, label, title, group}], giảm dần; nhiều nhóm lương thì xếp theo nhóm (thứ tự của boot.paygroups)
 * và có group = mã nhóm (kèm diễn giải). Một nhóm thì không có group, nhãn không có mã nhóm.
 * @param {object} boot
 * @param {string} subsidiary
 * @param {{lock?: string, lang?: string, filter?: function, prefixGroup?: boolean}} [opts] filter(p) giữ kỳ; prefixGroup: ghép
 *   mã nhóm vào đầu nhãn (Dropdown UIF không có nhóm)
 */
export function periodOptions(boot, subsidiary, opts) {
	const o = opts || {};
	const groups = groupsForSubsidiary(boot, subsidiary);
	const list = periodsForSubsidiary(boot, subsidiary).filter((p) => (o.filter ? o.filter(p) : true));
	const used = groups.filter((g) => list.some((p) => str(p.paygroup) === str(g.id)));
	const multi = used.length > 1;
	const groupOf = {};
	groups.forEach((g) => (groupOf[str(g.id)] = g));
	const order = {};
	groups.forEach((g, i) => (order[str(g.id)] = i));
	const rank = (p) => (Object.prototype.hasOwnProperty.call(order, str(p.paygroup)) ? order[str(p.paygroup)] : 1e6);
	const rows = multi ? list.slice().sort((a, b) => rank(a) - rank(b) || byStartDesc(a, b)) : list;
	return rows.map((p) => {
		const g = groupOf[str(p.paygroup)];
		const gName = g ? (g.description && g.description !== g.code ? `${g.code} - ${g.description}` : str(g.code)) : '';
		const label = periodLabel(p, o);
		const item = {value: str(p.id), label: multi && o.prefixGroup && g ? `${g.code} · ${label}` : label, title: periodTitle(p, o)};
		if (multi && !o.prefixGroup) item.group = gName;
		return item;
	});
}

const contains = (p, day) => !!p.start && !!p.end && str(p.start) <= day && day <= str(p.end);

/** Kỳ chưa đóng chứa ngày `today` (mặc định hôm nay); '' nếu không có. */
export function currentPeriodId(periods, today) {
	const day = today || localToday();
	const hit = arr(periods).find((p) => p.status !== 'C' && contains(p, day));
	return hit ? str(hit.id) : '';
}

/**
 * Kỳ mặc định của ô chọn: kỳ chưa đóng chứa hôm nay, rồi kỳ bất kỳ chứa hôm nay, rồi kỳ mở gần nhất đã bắt đầu, rồi kỳ mở
 * sắp tới gần nhất, rồi kỳ đầu danh sách.
 */
export function defaultPeriodId(periods, today) {
	const day = today || localToday();
	const list = arr(periods);
	const cur = currentPeriodId(list, day) || str((list.find((p) => contains(p, day)) || {}).id);
	if (cur) return cur;
	const open = list.filter((p) => p.status !== 'C' && p.start);
	// Giữ thứ tự danh sách khi trùng ngày bắt đầu (mục đứng trước thắng)
	const past = open.filter((p) => str(p.start) <= day).reduce((best, p) => (!best || str(p.start) > str(best.start) ? p : best), null);
	if (past) return str(past.id);
	const next = open.filter((p) => str(p.start) > day).reduce((best, p) => (!best || str(p.start) < str(best.start) ? p : best), null);
	if (next) return str(next.id);
	return list.length ? str(list[0].id) : '';
}
