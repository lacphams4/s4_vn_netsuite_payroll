/**
 * Xếp ca (lưới phân ca nhân viên x ngày) của công ty con đang chọn. Dữ liệu: GET rosterView (api/RosterView.js); lưu ô sửa tay:
 * POST rosterCells; sinh từ mẫu xoay ca theo tổ: action cũ generateRoster. Tham số route: from (yyyy-mm-dd), days (7 | 14 | 31),
 * team.
 *
 * Cách xếp: chọn một ca (hoặc "Nghỉ") ở dải ca phía trên như chọn cây bút, rồi bấm các ô; giữ Shift và bấm ô thứ hai cùng dòng
 * để tô cả đoạn. Ô đã đổi được viền cam và chỉ ghi khi bấm Lưu. Ô sửa tay (nguồn M, chấm ở góc) được giữ khi sinh lại từ mẫu.
 * Ngày thuộc kỳ công đã khóa của nhóm lương của nhân viên không sửa được (máy chủ cũng chặn).
 *
 * Hiệu năng: như lưới chấm công - chỉ vẽ ROW_STEP dòng mỗi lần, một listener DOM trên khung lưới thay cho handler từng ô.
 * CSS riêng chèn bằng thẻ <style id="s4vp-css-ros"> (không sửa ui/css.js).
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post} from '../lib/api.js';
import {fmtDate, fold, localToday} from '../lib/format.js';
import {pick, serverText} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Chips, SearchBox, Field, DateInput, Select, AutoSelect, Dialog, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		crumb: 'Chấm công',
		title: 'Xếp ca',
		sub: 'Phân ca theo ngày cho từng nhân viên. Chọn một ca rồi bấm ô để xếp; giữ Shift bấm ô thứ hai cùng dòng để tô cả đoạn.',
		loading: 'Đang tải bảng phân ca...',
		saving: 'Đang lưu phân ca...',
		generating: 'Đang sinh phân ca từ mẫu...',
		noSubsidiary: 'Chọn công ty con ở góc trên để xem phân ca.',
		noData: 'Chưa tải được bảng phân ca. Kiểm tra thông báo phía trên rồi bấm Tải lại.',
		reload: 'Tải lại',
		generate: 'Sinh từ mẫu xoay ca',
		save: (n) => `Lưu ${n} ô`,
		discard: 'Bỏ thay đổi',
		prev: 'Trước',
		next: 'Sau',
		today: 'Tuần này',
		from: 'Từ ngày',
		span: 'Số ngày',
		spans: {7: '1 tuần', 14: '2 tuần', 31: '31 ngày'},
		team: 'Tổ',
		allTeams: 'Mọi tổ',
		search: 'Tìm mã, tên, phòng ban, tổ',
		brush: 'Ca để xếp',
		brushNone: 'Chọn ca rồi bấm ô. Ô viền cam là thay đổi chưa lưu.',
		brushOn: (name) => `Đang xếp: ${name}. Bấm ô để gán, bấm lại để bỏ.`,
		off: 'Nghỉ',
		offLong: 'Ngày nghỉ (không ca)',
		employee: 'Nhân viên',
		showMore: (n) => `Hiện thêm ${n} người`,
		shown: (a, b) => `Đang hiện ${a} / ${b} người`,
		empty: 'Không có nhân viên nào đang làm việc trong khoảng ngày này.',
		noMatch: 'Không có nhân viên nào khớp ô tìm.',
		noShifts: 'Chưa khai ca làm việc. Vào Thiết lập, mục Ca làm việc để khai ca trước.',
		headcount: 'Số người theo ca',
		readOnly: 'Vai trò của bạn chỉ được xem phân ca.',
		locked: (code) => `Kỳ công ${code} đã khóa, không sửa được phân ca của ngày này.`,
		pickBrush: 'Chọn một ca (hoặc Nghỉ) ở dải ca phía trên trước khi bấm ô.',
		saved: (r) => `Đã lưu phân ca: ${r.created} ô mới, ${r.updated} ô sửa${r.unchanged ? `, ${r.unchanged} ô không đổi` : ''}.`,
		generated: (r) => `Đã sinh phân ca: ${r.created} ô mới, ${r.updated} ô cập nhật, ${r.keptManual} ô sửa tay giữ nguyên, ${r.unchanged} ô không đổi.`,
		confirmDiscard: (n) => `Có ${n} ô đã đổi nhưng chưa lưu. Bỏ các thay đổi này?`,
		cellTitle: (name, day, shift) => `${name} - ${day}: ${shift}`,
		manual: 'sửa tay',
		pending: 'chưa lưu',
		noCell: 'chưa xếp',
		dayTypes: {W: 'nghỉ hằng tuần', H: 'ngày lễ'},
		dow: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
		kinds: {D: 'Ca ngày', E: 'Ca chiều', N: 'Ca đêm'},
		summary: (people, cells) => `${people} người, ${cells} ô đã xếp ca`,
		dlg: {
			title: 'Sinh phân ca từ mẫu xoay ca',
			team: 'Tổ',
			pickTeam: 'Chọn tổ',
			pattern: 'Mẫu xoay ca',
			pickPattern: 'Chọn mẫu xoay ca',
			from: 'Từ ngày',
			to: 'Đến ngày',
			anchor: 'Ngày ứng với ngày 1 của chu kỳ',
			anchorHint: 'Để trống = ngày bắt đầu. Dùng khi chu kỳ đã chạy từ trước khoảng ngày này.',
			cycle: (text, n) => `Chu kỳ ${n} ngày: ${text}`,
			members: (n) => `${n} thành viên hiệu lực trong khoảng đang xem`,
			note: 'Ô đã sửa tay được giữ nguyên. Ngày thuộc kỳ công đã khóa thì không sinh.',
			run: 'Sinh phân ca',
			cancel: 'Hủy',
			noTeams: 'Công ty con này chưa có tổ. Khai tổ và thành viên ở Sản lượng - khoán tổ, mục Tổ đội.',
			noPatterns: 'Chưa có mẫu xoay ca. Vào Thiết lập, mục Mẫu xoay ca.',
		},
	},
	en: {
		crumb: 'Attendance',
		title: 'Shift roster',
		sub: 'Daily shift assignment per employee. Pick a shift, then click cells; hold Shift and click a second cell in the same row to fill the range.',
		loading: 'Loading the roster...',
		saving: 'Saving the roster...',
		generating: 'Generating the roster from the pattern...',
		noSubsidiary: 'Select a subsidiary at the top to see the roster.',
		noData: 'The roster could not be loaded. Check the message above and click Reload.',
		reload: 'Reload',
		generate: 'Generate from pattern',
		save: (n) => `Save ${n} cells`,
		discard: 'Discard changes',
		prev: 'Previous',
		next: 'Next',
		today: 'This week',
		from: 'From',
		span: 'Days',
		spans: {7: '1 week', 14: '2 weeks', 31: '31 days'},
		team: 'Team',
		allTeams: 'All teams',
		search: 'Search code, name, department, team',
		brush: 'Shift to assign',
		brushNone: 'Pick a shift, then click cells. Orange outlined cells are unsaved changes.',
		brushOn: (name) => `Assigning: ${name}. Click a cell to assign, click again to undo.`,
		off: 'Off',
		offLong: 'Day off (no shift)',
		employee: 'Employee',
		showMore: (n) => `Show ${n} more`,
		shown: (a, b) => `Showing ${a} of ${b} employees`,
		empty: 'No employee is working in this date range.',
		noMatch: 'No employee matches the search.',
		noShifts: 'No work shift is defined. Open Setup, Work shifts first.',
		headcount: 'Headcount per shift',
		readOnly: 'Your role can only view the roster.',
		locked: (code) => `Attendance of period ${code} is locked; the roster of this day cannot be changed.`,
		pickBrush: 'Pick a shift (or Off) in the shift bar before clicking a cell.',
		saved: (r) => `Roster saved: ${r.created} new cells, ${r.updated} changed${r.unchanged ? `, ${r.unchanged} unchanged` : ''}.`,
		generated: (r) => `Roster generated: ${r.created} new cells, ${r.updated} updated, ${r.keptManual} manual cells kept, ${r.unchanged} unchanged.`,
		confirmDiscard: (n) => `${n} changed cells are not saved. Discard these changes?`,
		cellTitle: (name, day, shift) => `${name} - ${day}: ${shift}`,
		manual: 'manual',
		pending: 'unsaved',
		noCell: 'not assigned',
		dayTypes: {W: 'weekly day off', H: 'public holiday'},
		dow: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
		kinds: {D: 'Day shift', E: 'Evening shift', N: 'Night shift'},
		summary: (people, cells) => `${people} employees, ${cells} assigned cells`,
		dlg: {
			title: 'Generate the roster from a shift pattern',
			team: 'Team',
			pickTeam: 'Select a team',
			pattern: 'Shift pattern',
			pickPattern: 'Select a shift pattern',
			from: 'From',
			to: 'To',
			anchor: 'Date matching day 1 of the cycle',
			anchorHint: 'Empty = the start date. Use it when the cycle started before this range.',
			cycle: (text, n) => `${n}-day cycle: ${text}`,
			members: (n) => `${n} members effective in the range on screen`,
			note: 'Manually edited cells are kept. Days in a locked attendance period are not generated.',
			run: 'Generate',
			cancel: 'Cancel',
			noTeams: 'This subsidiary has no team. Define teams and members under Output - team piecework, Teams.',
			noPatterns: 'No shift pattern is defined. Open Setup, Shift patterns.',
		},
	},
};

const ROW_STEP = 60;
const GRID_ID = 's4vp-ros-grid';
const DAY_W = 46;
const NAME_W = 230;
const SPANS = [7, 14, 31];
const OFF = 'OFF';
const SAVE_CHUNK = 200;

const CSS = `
.s4vp-ros-bar{padding:8px 12px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.s4vp-ros-bar .s4vp-ros-grow{flex:1 1 auto}
.s4vp-ros-brush{padding:0 12px 8px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;color:var(--s4vp-sub)}
.s4vp-ros-wrap{overflow:auto;max-height:560px;max-height:max(300px,calc(100vh - 250px));max-width:100%;border-top:1px solid var(--s4vp-line);border-bottom:1px solid var(--s4vp-line)}
.s4vp-ros{border-collapse:separate;border-spacing:0;table-layout:fixed;user-select:none;-webkit-user-select:none}
.s4vp-ros th{position:sticky;top:0;z-index:2;background:#F7F8F9;font-size:11px;font-weight:600;color:var(--s4vp-sub);text-align:center;padding:5px 0;border-bottom:1px solid #D9DEE2;line-height:1.25;overflow:hidden;white-space:nowrap}
.s4vp-ros td{font-size:12px;text-align:center;padding:0;height:34px;border-bottom:1px solid var(--s4vp-line-soft);border-right:1px solid #F0F2F4;overflow:hidden;white-space:nowrap;color:var(--s4vp-text);cursor:pointer;font-weight:600}
.s4vp-ros .s4vp-ros-l{position:sticky;left:0;z-index:1;background:var(--s4vp-surface);text-align:left;padding:3px 10px;border-right:1px solid #D9DEE2;text-overflow:ellipsis;cursor:default;font-weight:400}
.s4vp-ros th.s4vp-ros-l{z-index:3;background:#F7F8F9;font-size:12px}
.s4vp-ros-name{display:block;overflow:hidden;text-overflow:ellipsis;font-size:13px;line-height:1.3}
.s4vp-ros-kind{display:block;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--s4vp-sub);line-height:1.3}
.s4vp-ros .s4vp-ros-off{background:#ECEEF0}
.s4vp-ros .s4vp-ros-hol{background:#FBE9E7}
.s4vp-ros td.s4vp-ros-kD{background:#DCEBFA;color:#0B4A8F}
.s4vp-ros td.s4vp-ros-kE{background:#FFE9C7;color:#6B3A00}
.s4vp-ros td.s4vp-ros-kN{background:#E7E1F5;color:#4A2C8F}
.s4vp-ros td.s4vp-ros-rest{color:var(--s4vp-sub);font-weight:400}
.s4vp-ros td.s4vp-ros-m{box-shadow:inset -6px 6px 0 -3px #55616B}
.s4vp-ros td.s4vp-ros-p{outline:2px solid #C97A12;outline-offset:-2px}
.s4vp-ros td.s4vp-ros-lock{cursor:not-allowed;opacity:.55}
.s4vp-ros tr.s4vp-ros-sum td{cursor:default;background:#F7F8F9;font-weight:700;border-top:1px solid #D9DEE2;height:28px}
.s4vp-ros tr.s4vp-ros-sum td.s4vp-ros-l{background:#F7F8F9;font-weight:600}
.s4vp-ros-foot{padding:8px 12px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;font-size:12px;color:var(--s4vp-sub)}
.s4vp-ros-cycle{font-size:12px;color:var(--s4vp-sub);margin:-4px 0 8px}
`;

let cssDone = false;
function ensureCss() {
	try {
		if (cssDone) return;
		let st = document.getElementById('s4vp-css-ros');
		if (!st) {
			st = document.createElement('style');
			st.id = 's4vp-css-ros';
			document.head.appendChild(st);
		}
		st.textContent = CSS;
		cssDone = true;
	} catch (e) {
		// không có document (kiểm thử): bỏ qua
	}
}

const cx = (...names) => names.filter(Boolean).join(' ');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

/** Cộng ngày cho chuỗi yyyy-mm-dd (tính bằng UTC để không lệch múi giờ). */
export function addDays(iso, n) {
	if (!ISO.test(String(iso || ''))) return '';
	const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Thứ hai của tuần chứa ngày iso. */
export function mondayOf(iso) {
	if (!ISO.test(String(iso || ''))) return '';
	const dow = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();
	return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/** Ô nén của máy chủ {nhân viên: [[chỉ số ngày, ca, nguồn]]} -> {nhân viên: mảng theo ngày của {s, m} hoặc undefined}. */
export function expandCells(cells, dayCount) {
	const out = {};
	Object.keys(cells || {}).forEach((e) => {
		const row = new Array(dayCount);
		(cells[e] || []).forEach((c) => {
			if (c[0] >= 0 && c[0] < dayCount) row[c[0]] = {s: String(c[1] || ''), m: c[2] === 'M'};
		});
		out[e] = row;
	});
	return out;
}

/** Kỳ công khóa của ngày với nhân viên (group trống = tài khoản một nhóm lương, không lọc nhóm). */
export function lockOf(locks, group, date) {
	return (locks || []).find((l) => (!l.group || !group || l.group === group) && date >= l.from && date <= l.to) || null;
}

const shortDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export default function RosterView({app}) {
	ensureCss();
	const t = pick(TEXT);
	const subsidiary = app.subsidiary || '';
	const params = (app.route || {}).params || {};
	const from = ISO.test(String(params.from || '')) ? String(params.from) : mondayOf(localToday());
	const span = SPANS.indexOf(Number(params.days)) >= 0 ? Number(params.days) : 14;
	const team = String(params.team || '');
	const to = addDays(from, span - 1);

	const [data, setData] = useState(null);
	const [loaded, setLoaded] = useState(false);
	const [q, setQ] = useState('');
	const [brush, setBrush] = useState('');
	const [limit, setLimit] = useState(ROW_STEP);
	// Thay đổi chưa lưu: khóa "nhân viên|chỉ số ngày" -> id ca ('' = nghỉ). Giữ trong ref + bộ đếm để vẽ lại
	const pendingRef = useRef({});
	const tickRef = useRef(0);
	const [, setTick] = useState(0);
	const bump = () => {
		tickRef.current += 1;
		setTick(tickRef.current);
	};
	const [dialog, setDialog] = useState(false);
	const formRef = useRef({team: '', pattern: '', from: '', to: '', anchor: ''});
	const [form, setForm] = useState(formRef.current);
	const alive = useRef(true);
	const request = useRef(0);
	const shownRef = useRef([]);
	const pickRef = useRef(() => undefined);
	const lastRef = useRef(null);

	const pendingCount = () => Object.keys(pendingRef.current).length;
	const clearPending = () => {
		pendingRef.current = {};
		lastRef.current = null;
		bump();
	};

	const load = () => {
		if (!subsidiary) return Promise.resolve();
		request.current += 1;
		const mine = request.current;
		const args = {action: 'rosterView', subsidiary, from, to};
		if (team) args.team = team;
		return app.run(t.loading, call(args)).then((r) => {
			if (!alive.current || mine !== request.current) return;
			setLoaded(true);
			if (!r) return;
			pendingRef.current = {};
			lastRef.current = null;
			setData(r);
		});
	};

	useEffect(() => {
		alive.current = true;
		setLimit(ROW_STEP);
		load();
		return () => {
			alive.current = false;
		};
	}, [subsidiary, from, span, team]);

	// Đổi khoảng ngày / tổ: có thay đổi chưa lưu thì hỏi trước
	const goWith = (next) => {
		const target = Object.assign({from, days: String(span), team}, next);
		const move = () => {
			pendingRef.current = {};
			app.go('roster', target);
		};
		if (pendingCount()) app.confirm(t.confirmDiscard(pendingCount()), move);
		else move();
	};

	const days = data ? data.days || [] : [];
	const shifts = data ? data.shifts || [] : [];
	const shiftById = {};
	shifts.forEach((s) => (shiftById[s.id] = s));
	const rows = data ? data.rows || [] : [];
	const cellMap = data ? expandCells(data.cells, days.length) : {};
	const canEdit = !!(data && data.canEdit);

	const needle = fold(q).split(/\s+/).filter((w) => w);
	const filtered = needle.length ? rows.filter((r) => {
		const hay = fold([r.code, r.name, r.department, (r.teams || []).join(' ')].join(' '));
		return needle.every((w) => hay.indexOf(w) >= 0);
	}) : rows;
	const shown = filtered.slice(0, limit);
	shownRef.current = shown;

	// Giá trị hiện tại của ô (đã tính thay đổi chưa lưu): {s, m, p} hoặc null khi chưa có ô
	const cellOf = (employee, i) => {
		const key = `${employee}|${i}`;
		if (Object.prototype.hasOwnProperty.call(pendingRef.current, key)) return {s: pendingRef.current[key], m: true, p: true};
		const c = (cellMap[employee] || [])[i];
		return c ? {s: c.s, m: c.m, p: false} : null;
	};

	const setCell = (row, i, value) => {
		const key = `${row.employee}|${i}`;
		const orig = (cellMap[row.employee] || [])[i];
		// Trùng giá trị đã lưu: không coi là thay đổi (ô gốc sinh từ mẫu mà gán lại đúng ca thì vẫn giữ nguồn G)
		if (orig && orig.s === value) delete pendingRef.current[key];
		else pendingRef.current[key] = value;
	};

	pickRef.current = (rowIndex, dayIndex, shiftKey) => {
		const row = shownRef.current[rowIndex];
		if (!row || !data || dayIndex < 0 || dayIndex >= days.length) return;
		if (!canEdit) {
			app.notify(t.readOnly, 'warn');
			return;
		}
		if (!brush) {
			app.notify(t.pickBrush, 'warn');
			return;
		}
		const value = brush === OFF ? '' : brush;
		const last = lastRef.current;
		const list = shiftKey && last && last.employee === row.employee ? (() => {
			const a = Math.min(last.day, dayIndex);
			const b = Math.max(last.day, dayIndex);
			const out = [];
			for (let i = a; i <= b; i++) out.push(i);
			return out;
		})() : [dayIndex];
		let blocked = null;
		const single = list.length === 1;
		list.forEach((i) => {
			const lock = lockOf(data.locks, row.group, days[i].date);
			if (lock) {
				blocked = lock;
				return;
			}
			const key = `${row.employee}|${i}`;
			// Bấm lại một ô đang chờ lưu với cùng ca: bỏ thay đổi của ô đó
			if (single && Object.prototype.hasOwnProperty.call(pendingRef.current, key) && pendingRef.current[key] === value) delete pendingRef.current[key];
			else setCell(row, i, value);
		});
		lastRef.current = {employee: row.employee, day: dayIndex};
		if (blocked) app.notify(t.locked(blocked.code), 'warn');
		bump();
	};

	// Một listener DOM trên khung lưới; gắn lại sau mỗi lần vẽ (gán thuộc tính nên không cộng dồn)
	useEffect(() => {
		try {
			const el = document.getElementById(GRID_ID);
			if (!el) return undefined;
			el.onclick = (ev) => {
				try {
					const td = ev && ev.target && ev.target.closest ? ev.target.closest('td') : null;
					const tr = td ? td.parentNode : null;
					if (!td || !tr || !el.contains(td) || td.cellIndex < 1) return;
					pickRef.current(tr.rowIndex - 1, td.cellIndex - 1, !!ev.shiftKey);
				} catch (e) {
					// bỏ qua lượt bấm lỗi
				}
			};
		} catch (e) {
			// không có document
		}
		return undefined;
	});

	const save = () => {
		const cells = Object.keys(pendingRef.current).map((key) => {
			const cut = key.indexOf('|');
			return {employee: key.slice(0, cut), workDate: days[Number(key.slice(cut + 1))].date, shift: pendingRef.current[key]};
		});
		if (!cells.length) return;
		const chunks = [];
		for (let i = 0; i < cells.length; i += SAVE_CHUNK) chunks.push(cells.slice(i, i + SAVE_CHUNK));
		const total = {created: 0, updated: 0, unchanged: 0};
		const work = chunks.reduce(
			(p, chunk) => p.then(() => post({action: 'rosterCells', subsidiary, cells: chunk})).then((r) => {
				['created', 'updated', 'unchanged'].forEach((k) => (total[k] += Number((r || {})[k]) || 0));
			}),
			Promise.resolve()
		);
		app.run(t.saving, work.then(() => total)).then((r) => {
			if (!alive.current) return;
			// Lỗi giữa chừng: các lô trước đã ghi, tải lại để thấy đúng hiện trạng
			load().then(() => {
				if (r) app.notify(t.saved(r));
			});
		});
	};

	const setField = (k) => (v) => {
		formRef.current = Object.assign({}, formRef.current, {[k]: v});
		setForm(formRef.current);
	};
	const openDialog = () => {
		formRef.current = {team: team || '', pattern: '', from, to, anchor: ''};
		setForm(formRef.current);
		setDialog(true);
	};
	const generate = () => {
		const v = formRef.current;
		if (!v.team || !v.pattern || !ISO.test(v.from) || !ISO.test(v.to)) return;
		// Action cũ: lỗi phân quyền trả ở khóa error / errorVi (không ném)
		const work = post({action: 'generateRoster', team: v.team, pattern: v.pattern, anchor: ISO.test(v.anchor) ? v.anchor : v.from, from: v.from, to: v.to}).then((r) => {
			if (r && r.error) throw {message: serverText(r.error, r.errorVi)};
			return r;
		});
		app.run(t.generating, work).then((r) => {
			if (!r || !alive.current) return;
			setDialog(false);
			load().then(() => app.notify(t.generated({created: r.created || 0, updated: r.updated || 0, keptManual: r.keptManual || 0, unchanged: r.unchanged || 0})));
		});
	};
	const startGenerate = () => {
		if (pendingCount()) app.confirm(t.confirmDiscard(pendingCount()), () => {
			clearPending();
			openDialog();
		});
		else openDialog();
	};

	const header = (extra) => (
		<PageHeader
			crumbs={[{label: t.crumb, onClick: () => app.go('attendance')}]}
			title={t.title}
			sub={t.sub}
			actions={[<Button label={t.reload} disabled={!subsidiary || !!app.busy} onClick={() => (pendingCount() ? app.confirm(t.confirmDiscard(pendingCount()), () => load()) : load())} />].concat(extra || [])}
		/>
	);

	if (!data) {
		return (
			<Page>
				{header()}
				<Card>
					<Empty text={!subsidiary ? t.noSubsidiary : loaded ? t.noData : t.loading} />
				</Card>
			</Page>
		);
	}

	// ------------------------------------------------------------------ dữ liệu suy ra

	const teams = data.teams || [];
	const patterns = (data.patterns || []).filter((p) => p.active);
	const activeShifts = shifts.filter((s) => s.active);
	const shiftLabel = (s) => `${s.code} ${s.start}-${s.end}`;
	const brushItems = activeShifts.map((s) => ({value: s.id, label: shiftLabel(s)})).concat([{value: OFF, label: t.off}]);
	const brushName = brush === OFF ? t.offLong : shiftById[brush] ? `${shiftById[brush].code}${shiftById[brush].description ? ` - ${shiftById[brush].description}` : ''}` : '';
	const nPending = pendingCount();

	// Số người theo ca từng ngày, tính trên mọi nhân viên của lưới (kể cả dòng chưa hiện), gồm thay đổi chưa lưu
	const counts = {};
	let assigned = 0;
	rows.forEach((r) => {
		for (let i = 0; i < days.length; i++) {
			const c = cellOf(r.employee, i);
			if (!c || !c.s) continue;
			assigned += 1;
			(counts[c.s] = counts[c.s] || new Array(days.length).fill(0))[i] += 1;
		}
	});
	const countShifts = shifts.filter((s) => counts[s.id]);

	const tableWidth = NAME_W + days.length * DAY_W;
	const dayClass = (d) => (d.type === 'H' ? 's4vp-ros-hol' : d.type === 'W' ? 's4vp-ros-off' : '');

	const grid = (
		<div id={GRID_ID} class="s4vp-ros-wrap">
			<table class="s4vp-ros" aria-label={t.title} style={{width: `${tableWidth}px`}}>
				<thead>
					<tr>
						<th class="s4vp-ros-l" style={{width: `${NAME_W}px`}}>{t.employee}</th>
						{days.map((d, i) => {
							const a = {style: {width: `${DAY_W}px`}, title: `${t.dow[d.dow]}, ${fmtDate(d.date)}${d.type !== 'N' ? ` - ${t.dayTypes[d.type]}` : ''}`};
							const cls = dayClass(d);
							if (cls) a.class = cls;
							return (
								<th key={`h${i}`} {...a}>
									<div>{t.dow[d.dow]}</div>
									<div>{shortDay(d.date)}</div>
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody>
					{shown.length ? null : (
						<tr key="s4vp-none">
							<td colSpan={String(days.length + 1)} style={{cursor: 'default', height: 'auto', textAlign: 'left', fontWeight: '400'}}>
								<Empty text={rows.length ? t.noMatch : t.empty} />
							</td>
						</tr>
					)}
					{shown.map((r) => (
						<tr key={`e${r.employee}`}>
							<td class="s4vp-ros-l" title={`${r.code} ${r.name}${r.department ? ` - ${r.department}` : ''}`}>
								<span class="s4vp-ros-name">
									<span class="s4vp-link">{r.code}</span>
									{` ${r.name}`}
								</span>
								<span class="s4vp-ros-kind">{[(r.teams || []).join(', '), r.department].filter(Boolean).join(' · ')}</span>
							</td>
							{days.map((d, i) => {
								const c = cellOf(r.employee, i);
								const s = c && c.s ? shiftById[c.s] : null;
								const lock = lockOf(data.locks, r.group, d.date);
								const cls = cx(
									s ? `s4vp-ros-k${s.kind || 'D'}` : c ? cx('s4vp-ros-rest', dayClass(d)) : dayClass(d),
									c && c.m && !c.p ? 's4vp-ros-m' : '',
									c && c.p ? 's4vp-ros-p' : '',
									lock ? 's4vp-ros-lock' : ''
								);
								const label = s ? `${s.code} ${s.start}-${s.end}` : c ? t.offLong : t.noCell;
								const notes = [c && c.p ? t.pending : c && c.m ? t.manual : '', lock ? t.locked(lock.code) : ''].filter(Boolean).join('; ');
								const a = {title: `${t.cellTitle(r.name || r.code, fmtDate(d.date), label)}${notes ? ` (${notes})` : ''}`};
								if (cls) a.class = cls;
								return (
									<td key={`d${i}`} {...a}>
										{s ? s.code : c ? '-' : ''}
									</td>
								);
							})}
						</tr>
					))}
					{countShifts.map((s) => (
						<tr key={`c${s.id}`} class="s4vp-ros-sum">
							<td class="s4vp-ros-l" title={t.headcount}>{`${t.headcount}: ${s.code}`}</td>
							{days.map((d, i) => (
								<td key={`n${i}`}>{counts[s.id][i] ? String(counts[s.id][i]) : ''}</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);

	const teamOptions = teams.map((x) => ({value: x.id, label: `${x.code}${x.description ? ` - ${x.description}` : ''} (${x.members})`}));
	const formTeam = teams.find((x) => x.id === form.team) || null;
	const formPattern = patterns.find((p) => p.id === form.pattern) || null;

	return (
		<Page>
			{header(canEdit ? [<Button label={t.generate} kind={nPending ? 'default' : 'primary'} disabled={!!app.busy} onClick={startGenerate} />] : [])}
			<Card flush={true} label={t.title}>
				<div class="s4vp-ros-bar">
					<Button small={true} label={`‹ ${t.prev}`} onClick={() => goWith({from: addDays(from, -span)})} />
					<DateInput value={from} onInput={(v) => ISO.test(v) && v !== from && goWith({from: v})} ariaLabel={t.from} width={150} />
					<Button small={true} label={`${t.next} ›`} onClick={() => goWith({from: addDays(from, span)})} />
					<Button small={true} kind="ghost" label={t.today} onClick={() => goWith({from: mondayOf(localToday())})} />
					<Select value={String(span)} onInput={(v) => Number(v) !== span && goWith({days: v})} options={SPANS.map((n) => ({value: String(n), label: t.spans[n]}))} ariaLabel={t.span} width={110} />
					<AutoSelect value={team} onInput={(v) => v !== team && goWith({team: v})} options={teamOptions} placeholder={t.allTeams} ariaLabel={t.team} width={230} />
					<span class="s4vp-ros-grow" />
					<SearchBox value={q} onInput={(v) => {
						setQ(v);
						setLimit(ROW_STEP);
					}} placeholder={t.search} width={250} />
				</div>
				{canEdit ? (
					<div class="s4vp-ros-brush">
						{activeShifts.length ? <Chips items={brushItems} value={brush} onPick={(v) => setBrush(v === brush ? '' : v)} label={t.brush} /> : <span>{t.noShifts}</span>}
						<span>{brush ? t.brushOn(brushName) : t.brushNone}</span>
					</div>
				) : (
					<div class="s4vp-ros-brush">
						<span>{t.readOnly}</span>
					</div>
				)}
				{grid}
				<div class="s4vp-ros-foot">
					<span>
						{t.summary(rows.length, assigned)}
						{filtered.length > shown.length || needle.length ? ` · ${t.shown(shown.length, filtered.length)}` : ''}
					</span>
					<span class="s4vp-actions">
						{filtered.length > shown.length ? <Button small={true} label={t.showMore(Math.min(ROW_STEP, filtered.length - shown.length))} onClick={() => setLimit(limit + ROW_STEP)} /> : null}
						{nPending ? <Button small={true} label={t.discard} disabled={!!app.busy} onClick={clearPending} /> : null}
						{nPending ? <Button small={true} kind="primary" label={t.save(nPending)} disabled={!!app.busy} onClick={save} /> : null}
					</span>
				</div>
			</Card>
			{dialog ? (
				<Dialog
					title={t.dlg.title}
					onClose={() => setDialog(false)}
					width={520}
					actions={[
						<Button label={t.dlg.cancel} onClick={() => setDialog(false)} />,
						<Button label={t.dlg.run} kind="primary" disabled={!form.team || !form.pattern || !ISO.test(form.from) || !ISO.test(form.to) || !!app.busy} onClick={generate} />,
					]}
				>
					{teams.length ? null : <div class="s4vp-ros-cycle">{t.dlg.noTeams}</div>}
					{patterns.length ? null : <div class="s4vp-ros-cycle">{t.dlg.noPatterns}</div>}
					<Field label={t.dlg.team} required={true} hint={formTeam ? t.dlg.members(formTeam.members) : null}>
						<AutoSelect value={form.team} onInput={setField('team')} options={teamOptions} placeholder={t.dlg.pickTeam} />
					</Field>
					<Field label={t.dlg.pattern} required={true} hint={formPattern ? t.dlg.cycle(formPattern.cycle.map((c) => c || t.off).join(', '), formPattern.cycle.length) : null}>
						<AutoSelect value={form.pattern} onInput={setField('pattern')} options={patterns.map((p) => ({value: p.id, label: `${p.code}${p.description ? ` - ${p.description}` : ''}`}))} placeholder={t.dlg.pickPattern} />
					</Field>
					<Field label={t.dlg.from} required={true}>
						<DateInput value={form.from} onInput={setField('from')} />
					</Field>
					<Field label={t.dlg.to} required={true}>
						<DateInput value={form.to} onInput={setField('to')} min={form.from} />
					</Field>
					<Field label={t.dlg.anchor} hint={t.dlg.anchorHint}>
						<DateInput value={form.anchor} onInput={setField('anchor')} />
					</Field>
					<div class="s4vp-ros-cycle">{t.dlg.note}</div>
				</Dialog>
			) : null}
		</Page>
	);
}
