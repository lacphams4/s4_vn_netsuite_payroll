/**
 * Bộ thành phần dùng chung của giao diện bản 2 (docs/UI_V2.md mục 4): HTML thuần trong JSX của UIF, kiểu dáng ở ui/css.js.
 *
 * Quy tắc vẽ (mỗi điều đã gây lỗi thật): thuộc tính `class` (không phải className); `style` là đối tượng; bấm bằng
 * <button type="button" onClick>; nhập bằng onInput (onChange, onBlur không bắn); handler nhận message của UIF, phần tử DOM
 * ở m.element -> valueOf(m). Thuộc tính boolean (disabled, selected) chỉ đặt khi đúng, không bao giờ đặt giá trị false.
 *
 * Mọi hàm nhận một đối tượng props và trả JSX; dùng được cả hai cách `<Table rows={...} />` và `{Table({rows})}`.
 * Thành phần có trạng thái riêng (Table có ô tìm, Menu, ô nhập) giữ hook trong thành phần con nội bộ nên gọi kiểu hàm
 * trong nhánh điều kiện vẫn an toàn.
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {money, num, pct, fmtDate, toIso, toNumber, fold, quickFilter} from '../lib/format.js';
import {pick} from '../lib/i18n.js';

const TEXT = {
	vi: {
		search: 'Tìm (tên, mã, số tiền)', matches: (n) => `${n} dòng khớp`, empty: 'Không có dữ liệu', close: 'Đóng', steps: 'Các bước', back: 'Quay lại', backTo: (name) => `Quay lại ${name}`,
		choose: 'Chọn...', filter: 'Gõ để lọc', noMatch: 'Không có mục nào khớp', more: (n) => `Còn ${n} mục, gõ thêm để lọc`, required: 'Bắt buộc', monthHint: 'yyyy-mm', timeHint: 'hh:mm',
	},
	en: {
		search: 'Search (name, code, amount)', matches: (n) => `${n} matching rows`, empty: 'No data', close: 'Close', steps: 'Steps', back: 'Back', backTo: (name) => `Back to ${name}`,
		choose: 'Select...', filter: 'Type to filter', noMatch: 'No matching items', more: (n) => `${n} more, type to narrow the list`, required: 'Required', monthHint: 'yyyy-mm', timeHint: 'hh:mm',
	},
};

const cx = (...names) => names.filter(Boolean).join(' ');
const px = (v) => (typeof v === 'number' ? `${v}px` : v);
const blank = (v) => v === null || v === undefined || v === false;
const text = (v) => (blank(v) ? '' : String(v));
// Danh sách nút / phần tử do nơi gọi truyền vào: bọc từng phần tử có khóa để UIF không phải đoán khóa
const keyed = (nodes) => (Array.isArray(nodes) ? nodes : blank(nodes) ? [] : [nodes]).filter((n) => !blank(n)).map((n, i) => <span key={`k${i}`} style={{display: 'contents'}}>{n}</span>);

/** Đọc giá trị ô nhập từ message onInput của UIF (phần tử DOM ở m.element, dự phòng m._element, m.target). */
export function valueOf(m) {
	try {
		if (m === null || m === undefined) return '';
		if (typeof m === 'string' || typeof m === 'number') return String(m);
		const el = m.element || m._element || m.target || m.currentTarget || null;
		if (el && el.value !== undefined && el.value !== null) return String(el.value);
		return m.value !== undefined && m.value !== null ? String(m.value) : '';
	} catch (e) {
		return '';
	}
}

const keyOfMessage = (m) => {
	try {
		return m ? m._key || m.key || (m._keyCode === 27 || m.keyCode === 27 ? 'Escape' : '') : '';
	} catch (e) {
		return '';
	}
};

// ------------------------------------------------------------------ khung trang

export function Page({children}) {
	return <div class="s4vp-page">{children}</div>;
}

/**
 * Đầu trang một hàng: nút quay lại + tiêu đề + trạng thái bên trái (dòng phụ ngay dưới), nút thao tác bên phải.
 * Không có hàng đường dẫn riêng: `crumbs` [{label, onClick}] chỉ dùng để lấy mục cha gần nhất (mục cuối cùng có onClick)
 * làm nút quay lại; hoặc truyền thẳng `back` {label, onClick}. Tiêu đề dài bị cắt bằng dấu ba chấm, có title đầy đủ.
 */
export function PageHeader({crumbs, back, title, status, sub, actions}) {
	const t = pick(TEXT);
	const parents = (crumbs || []).filter((c) => c && c.onClick);
	const up = back && back.onClick ? back : parents.length ? parents[parents.length - 1] : null;
	const upLabel = up ? (blank(up.label) || up.label === '' ? t.back : t.backTo(text(up.label))) : '';
	const acts = keyed(actions);
	return (
		<div class="s4vp-ph">
			<div class="s4vp-ph-main">
				{up ? (
					<button type="button" class="s4vp-back" aria-label={upLabel} title={upLabel} onClick={() => up.onClick()}>
						{'‹'}
					</button>
				) : null}
				<div class="s4vp-ph-text">
					<div class="s4vp-ph-title">
						<h1 title={text(title)}>{text(title)}</h1>
						{status && status.text ? Badge({text: status.text, tone: status.tone, large: true}) : null}
					</div>
					{blank(sub) || sub === '' ? null : <div class="s4vp-ph-sub">{sub}</div>}
				</div>
			</div>
			{acts.length ? <div class="s4vp-actions">{acts}</div> : null}
		</div>
	);
}

// ------------------------------------------------------------------ nút, menu

/** kind: 'primary' | 'default' | 'ghost' | 'link' | 'danger' | 'dashed'; small, block: tùy chọn kích thước. */
export function Button({label, onClick, kind, disabled, title, small, block, ariaLabel, pressed}) {
	const attrs = {type: 'button', class: cx('s4vp-btn', kind && kind !== 'default' ? `s4vp-btn-${kind}` : '', small ? 's4vp-btn-sm' : '', block ? 's4vp-btn-block' : '')};
	if (disabled) attrs.disabled = 'disabled';
	else if (onClick) attrs.onClick = () => onClick();
	if (title) attrs.title = title;
	if (ariaLabel) attrs['aria-label'] = ariaLabel;
	if (pressed !== undefined) attrs['aria-pressed'] = pressed ? 'true' : 'false';
	return <button {...attrs}>{text(label)}</button>;
}

function MenuImpl({label, items, kind, align, disabled, title, active}) {
	const [open, setOpen] = useState(false);
	// Bấm ra ngoài thì đóng; gắn listener sau lượt bấm đang xử lý để chính lượt bấm mở menu không đóng nó ngay
	useEffect(() => {
		if (!open) return undefined;
		let on = true;
		const close = () => on && setOpen(false);
		const timer = setTimeout(() => on && document.addEventListener('click', close), 0);
		return () => {
			on = false;
			clearTimeout(timer);
			document.removeEventListener('click', close);
		};
	}, [open]);
	const list = (items || []).filter(Boolean);
	const attrs = {type: 'button', class: kind === 'tab' ? cx('s4vp-navtab', active ? 's4vp-on' : '') : cx('s4vp-btn', kind && kind !== 'default' ? `s4vp-btn-${kind}` : ''), 'aria-haspopup': 'true', 'aria-expanded': open ? 'true' : 'false'};
	if (disabled || !list.length) attrs.disabled = 'disabled';
	else attrs.onClick = () => setOpen(!open);
	if (title) attrs.title = title;
	return (
		<div class={cx('s4vp-menu', align === 'right' ? 's4vp-menu-right' : '')} onKeyUp={(m) => keyOfMessage(m) === 'Escape' && open && setOpen(false)}>
			<button {...attrs}>{`${text(label)} ▾`}</button>
			{open ? (
				<div class="s4vp-menu-list" role="menu">
					{list.map((it, i) => {
						const a = {type: 'button', class: 's4vp-menu-item', role: 'menuitem'};
						if (it.disabled) a.disabled = 'disabled';
						else
							a.onClick = () => {
								setOpen(false);
								if (it.onClick) it.onClick();
							};
						if (it.title) a.title = it.title;
						return (
							<button key={`m${i}`} {...a}>
								{text(it.label)}
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}

/** Nút mở danh sách thao tác; items: [{label, onClick, disabled, title}]; align: 'right' để danh sách bám mép phải. */
export function Menu(props) {
	return <MenuImpl {...props} />;
}

// ------------------------------------------------------------------ thanh bước, thẻ số, bộ lọc nhanh, tab

/** steps: [{label, note, state, noteTone, onClick}]; state: 'done' | 'current' | 'todo'. */
export function Stepper({steps, label}) {
	const t = pick(TEXT);
	return (
		<ol class="s4vp-steps" aria-label={label || t.steps}>
			{(steps || []).filter(Boolean).map((s, i) => {
				const state = s.state === 'done' || s.state === 'current' ? s.state : 'todo';
				const attrs = {class: cx('s4vp-step', `s4vp-step-${state}`)};
				if (state === 'current') attrs['aria-current'] = 'step';
				const tone = s.noteTone || (state === 'current' ? 'warn' : '');
				const body = [<span key="n" class="s4vp-step-n">{String(i + 1)}</span>, <span key="l">{text(s.label)}</span>];
				if (!blank(s.note) && s.note !== '') body.push(<span key="t" class={cx('s4vp-step-note', tone ? `s4vp-t-${tone}` : '')}>{text(s.note)}</span>);
				return (
					<li key={s.key || `s${i}`} {...attrs}>
						{s.onClick ? <button type="button" class="s4vp-step-btn" onClick={() => s.onClick()}>{body}</button> : body}
					</li>
				);
			})}
		</ol>
	);
}

/** cards: [{label, value, note, tone, onClick}]. */
export function StatCards({cards}) {
	return (
		<div class="s4vp-stats">
			{(cards || []).filter(Boolean).map((c, i) => (
				<div key={c.key || `c${i}`} class={cx('s4vp-stat', c.tone ? `s4vp-t-${c.tone}` : '')}>
					<div class="s4vp-stat-l">{text(c.label)}</div>
					<div class="s4vp-stat-v">{text(c.value)}</div>
					{blank(c.note) || c.note === '' ? null : <div class="s4vp-stat-n">{c.note}</div>}
				</div>
			))}
		</div>
	);
}

/** Bộ lọc nhanh dạng viên: items [{value, label, count, tone}], value đang chọn, onPick(value). */
export function Chips({items, value, onPick, label}) {
	const attrs = {class: 's4vp-chips'};
	if (label) attrs['aria-label'] = label;
	return (
		<div {...attrs}>
			{(items || []).filter(Boolean).map((it) => {
				const on = it.value === value;
				return (
					<button key={`v${it.value}`} type="button" class={cx('s4vp-chip', on ? 's4vp-on' : '', it.tone ? `s4vp-t-${it.tone}` : '')} aria-pressed={on ? 'true' : 'false'} onClick={() => onPick && onPick(it.value)}>
						{blank(it.count) ? text(it.label) : `${text(it.label)} ${it.count}`}
					</button>
				);
			})}
		</div>
	);
}

/** items [{value, label, count}], value đang chọn, onPick(value). */
export function Tabs({items, value, onPick, label}) {
	const attrs = {class: 's4vp-tabs', role: 'tablist'};
	if (label) attrs['aria-label'] = label;
	return (
		<div {...attrs}>
			{(items || []).filter(Boolean).map((it) => {
				const on = it.value === value;
				return (
					<button key={`v${it.value}`} type="button" role="tab" class={cx('s4vp-tab', on ? 's4vp-on' : '')} aria-selected={on ? 'true' : 'false'} onClick={() => onPick && onPick(it.value)}>
						{blank(it.count) ? text(it.label) : `${text(it.label)} ${it.count}`}
					</button>
				);
			})}
		</div>
	);
}

/** tone: 'ok' | 'warn' | 'error' | 'info' | 'muted'. */
export function Badge({text: label, tone, large}) {
	return <span class={cx('s4vp-badge', tone && tone !== 'muted' ? `s4vp-t-${tone}` : '', large ? 's4vp-badge-lg' : '')}>{text(label)}</span>;
}

/** Thẻ nội dung; flush: phần thân không có lề (cho bảng sát mép thẻ); tone: 'warn' | 'error' | 'ok' đổi màu viền. */
export function Card({title, sub, actions, children, tone, flush, label}) {
	const attrs = {class: cx('s4vp-card', tone ? `s4vp-t-${tone}` : '')};
	if (label || title) attrs['aria-label'] = label || text(title);
	return (
		<section {...attrs}>
			{title || actions ? (
				<div class="s4vp-card-h">
					<div>
						<div class="s4vp-card-t">{text(title)}</div>
						{blank(sub) || sub === '' ? null : <div class="s4vp-card-s">{sub}</div>}
					</div>
					{actions ? <div class="s4vp-actions">{keyed(actions)}</div> : null}
				</div>
			) : null}
			<div class={cx('s4vp-card-b', flush ? 's4vp-card-flush' : '')}>{children}</div>
		</section>
	);
}

export function Empty({text: label}) {
	const t = pick(TEXT);
	return <div class="s4vp-empty">{text(label) || t.empty}</div>;
}

// ------------------------------------------------------------------ ô nhập

let fieldSeq = 0;

// Ô nhập vẽ bằng thuộc tính nên giá trị đặt từ chương trình (xóa form sau khi lưu) có thể không tới ô đã gõ: sau khi vẽ,
// gán lại el.value nếu lệch. Không đụng ô đang có con trỏ để không nuốt phím người dùng đang gõ.
function useSyncedId(want) {
	const ref = useRef(null);
	if (!ref.current) {
		fieldSeq += 1;
		ref.current = `s4vp-f${fieldSeq}`;
	}
	const id = ref.current;
	useEffect(() => {
		try {
			const el = document.getElementById(id);
			if (el && document.activeElement !== el && el.value !== want) el.value = want;
		} catch (e) {
			// bỏ qua: ô vẫn dùng được với giá trị người dùng gõ
		}
	}, [want]);
	return id;
}

function controlAttrs(p, id, extraClass) {
	const attrs = {id, class: cx('s4vp-in', extraClass, p.align === 'right' ? 's4vp-r' : '')};
	if (p.onInput) attrs.onInput = (m) => p.onInput(p.read ? p.read(valueOf(m)) : valueOf(m));
	if (p.onEnter) attrs.onKeyUp = (m) => (keyOfMessage(m) === 'Enter' || (m && (m._keyCode === 13 || m.keyCode === 13))) && p.onEnter();
	if (p.disabled) attrs.disabled = 'disabled';
	if (p.placeholder) attrs.placeholder = p.placeholder;
	if (p.ariaLabel) attrs['aria-label'] = p.ariaLabel;
	if (p.title) attrs.title = p.title;
	if (p.width) attrs.style = {width: px(p.width)};
	return attrs;
}

// Thuộc tính giới hạn của ô số / ngày: đặt qua JSX và đặt lại sau khi vẽ (không phụ thuộc UIF có ghi ra DOM hay không)
const LIMIT_ATTRS = ['min', 'max', 'step'];
function limitAttrs(p, attrs) {
	LIMIT_ATTRS.forEach((k) => {
		if (!blank(p[k]) && p[k] !== '') attrs[k] = String(p[k]);
	});
}
function syncLimits(el, p) {
	LIMIT_ATTRS.forEach((k) => {
		const v = blank(p[k]) ? '' : String(p[k]);
		if (v) {
			if (el.getAttribute(k) !== v) el.setAttribute(k, v);
		} else if (el.hasAttribute(k)) el.removeAttribute(k);
	});
}

function InputImpl(p) {
	const want = text(p.show ? p.show(p.value) : p.value);
	const id = useSyncedId(want);
	const attrs = controlAttrs(p, id, '');
	attrs.type = p.type || 'text';
	attrs.value = want;
	if (p.inputmode) attrs.inputmode = p.inputmode;
	if (attrs.type === 'number') limitAttrs(p, attrs);
	attrs.autocomplete = 'off';
	useEffect(() => {
		if (attrs.type !== 'number') return;
		try {
			const el = document.getElementById(id);
			if (el) syncLimits(el, p);
		} catch (e) {
			// bỏ qua: ô vẫn nhập được, chỉ thiếu bước / giới hạn của trình duyệt
		}
	});
	return <input {...attrs} />;
}

// ------------------------------------------------------------------ ô ngày, tháng, giờ (ô gốc của trình duyệt)

// Trình duyệt có ô gốc cho kiểu này không: kiểu không hỗ trợ bị đổi về 'text' và nhận mọi giá trị. Kết quả nhớ theo kiểu;
// sau khi vẽ còn kiểm lại input.type thật (UIF không ghi thuộc tính type thì cũng lùi về ô chữ).
const NATIVE = {};
export function nativeType(type) {
	if (NATIVE[type] !== undefined) return NATIVE[type];
	let ok = false;
	try {
		const el = document.createElement('input');
		el.setAttribute('type', type);
		el.value = 'x-not-valid';
		ok = el.type === type && el.value === '';
	} catch (e) {
		ok = false;
	}
	NATIVE[type] = ok;
	return ok;
}

const pad2 = (n) => String(n).padStart(2, '0');
/** Ô chữ dự phòng của ô ngày: dd/mm/yyyy hoặc yyyy-mm-dd -> yyyy-mm-dd (ngày có thật); chưa đủ ngày thì trả nguyên chuỗi đang gõ. */
export function readDate(raw) {
	const s = text(raw).trim();
	const iso = toIso(s);
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(iso);
	if (!m) return s;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return s;
	return `${m[1]}-${pad2(mo)}-${pad2(d)}`;
}
/** Ô chữ dự phòng của ô tháng: yyyy-mm, mm/yyyy -> yyyy-mm; chưa đủ thì trả nguyên chuỗi. */
export function readMonth(raw) {
	const s = text(raw).trim();
	let m = /^(\d{4})[-/.](\d{1,2})$/.exec(s);
	if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${pad2(m[2])}`;
	m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
	if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${pad2(m[1])}`;
	return s;
}
/** Ô chữ dự phòng của ô giờ: 8:30, 08h30, 8.30 -> 08:30; chưa đủ thì trả nguyên chuỗi. */
export function readTime(raw) {
	const s = text(raw).trim();
	const m = /^(\d{1,2})[:hH.](\d{2})$/.exec(s);
	if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${pad2(m[1])}:${m[2]}`;
	return s;
}

const TYPED = {
	date: {valid: /^\d{4}-\d{2}-\d{2}$/, show: fmtDate, read: readDate, hint: () => 'dd/mm/yyyy', inputmode: 'numeric'},
	month: {valid: /^\d{4}-\d{2}$/, show: (v) => text(v), read: readMonth, hint: (t) => t.monthHint, inputmode: 'numeric'},
	time: {valid: /^\d{2}:\d{2}(:\d{2})?$/, show: (v) => text(v), read: readTime, hint: (t) => t.timeHint, inputmode: 'numeric'},
};

/**
 * Giá trị ô theo chế độ: ô gốc nhận đúng dạng ISO (khác dạng thì để trống); ô chữ dự phòng hiện dạng gõ được
 * (ngày dd/mm/yyyy). Xuất ra để kiểm thử.
 */
export function typedValue(kind, native, value) {
	const spec = TYPED[kind];
	const v = text(value);
	if (native) return spec.valid.test(v) ? v : '';
	return text(spec.show(v));
}

function TypedImpl(p) {
	const t = pick(TEXT);
	const kind = TYPED[p.kind] ? p.kind : 'date';
	const spec = TYPED[kind];
	const [, redraw] = useState(0);
	const native = nativeType(kind);
	const want = typedValue(kind, native, p.value);
	const id = useSyncedId(want);
	useEffect(() => {
		if (!native) return;
		try {
			const el = document.getElementById(id);
			if (!el) return;
			// UIF không ghi type hoặc trình duyệt đổi về ô chữ: lùi về ô chữ cho mọi ô cùng kiểu
			if (el.type !== kind) {
				NATIVE[kind] = false;
				redraw(Date.now());
				return;
			}
			syncLimits(el, p);
		} catch (e) {
			// bỏ qua
		}
	});
	const attrs = controlAttrs(Object.assign({}, p, {read: native ? (v) => v : spec.read}), id, '');
	attrs.value = want;
	attrs.autocomplete = 'off';
	if (native) {
		attrs.type = kind;
		limitAttrs(p, attrs);
		delete attrs.placeholder;
		if (!attrs.title && p.placeholder) attrs.title = p.placeholder;
	} else {
		attrs.type = 'text';
		attrs.inputmode = spec.inputmode;
		attrs.placeholder = p.placeholder || spec.hint(t);
	}
	return <input {...attrs} />;
}

// ------------------------------------------------------------------ ô số tiền, hộp kiểm

/** Chuỗi số tiền đã gõ -> có phân tách nghìn theo vi-VN (1.234.567,5); không đọc được số thì null. */
export function formatAmountText(raw, decimals) {
	const n = toNumber(raw);
	if (n === null) return null;
	return n.toLocaleString('vi-VN', {maximumFractionDigits: blank(decimals) ? 2 : decimals});
}

// Gắn trình nghe sự kiện gốc một lần cho phần tử (UIF không bắn onBlur / onChange): đánh dấu trên phần tử để vẽ lại không gắn lặp
function bindOnce(id, mark, event, fn) {
	try {
		const el = document.getElementById(id);
		if (!el || el[mark]) return;
		el[mark] = true;
		el.addEventListener(event, () => fn(el));
	} catch (e) {
		// bỏ qua
	}
}

function MoneyImpl(p) {
	const want = text(typeof p.value === 'number' ? formatAmountText(p.value, p.decimals) : p.value);
	const id = useSyncedId(want);
	const latest = useRef(p);
	latest.current = p;
	useEffect(() => {
		bindOnce(id, '__s4vpMoney', 'focusout', (el) => {
			const f = formatAmountText(el.value, latest.current.decimals);
			if (f === null || f === el.value) return;
			el.value = f;
			if (latest.current.onInput) latest.current.onInput(f);
		});
		// Giá trị chương trình đặt dạng số thô ("15000000"): hiện có phân tách khi ô không có con trỏ (toNumber đọc được cả hai dạng)
		try {
			const el = document.getElementById(id);
			if (el && document.activeElement !== el && /^-?\d+(\.\d+)?$/.test(el.value)) {
				const f = formatAmountText(el.value, latest.current.decimals);
				if (f !== null) el.value = f;
			}
		} catch (e) {
			// bỏ qua
		}
	});
	const attrs = controlAttrs(Object.assign({}, p, {align: 'right'}), id, '');
	attrs.type = 'text';
	attrs.value = want;
	attrs.inputmode = 'decimal';
	attrs.autocomplete = 'off';
	return <input {...attrs} />;
}

function CheckImpl(p) {
	const ref = useRef(null);
	if (!ref.current) {
		fieldSeq += 1;
		ref.current = `s4vp-f${fieldSeq}`;
	}
	const id = ref.current;
	const latest = useRef(p);
	latest.current = p;
	useEffect(() => {
		try {
			const el = document.getElementById(id);
			if (el && el.checked !== !!p.checked) el.checked = !!p.checked;
		} catch (e) {
			// bỏ qua
		}
		bindOnce(id, '__s4vpCheck', 'change', (el) => latest.current.onInput && latest.current.onInput(!!el.checked));
	});
	const attrs = {id, type: 'checkbox', class: 's4vp-check-in'};
	if (p.checked) attrs.checked = 'checked';
	if (p.disabled) attrs.disabled = 'disabled';
	if (p.ariaLabel) attrs['aria-label'] = p.ariaLabel;
	const body = [<input key="i" {...attrs} />, blank(p.label) || p.label === '' ? null : <span key="l">{text(p.label)}</span>];
	// Trong Field (đã là <label>) thì không lồng thêm <label>
	return p.inField ? <span class="s4vp-check">{body}</span> : <label class="s4vp-check">{body}</label>;
}

// ------------------------------------------------------------------ ô chọn có tìm kiếm

// Mục chọn: {value, label} hoặc chuỗi; tùy chọn title (tooltip của mục) và group (tên nhóm, các mục cùng nhóm đứng liền nhau)
const normOption = (o) => {
	if (typeof o !== 'object') return {value: text(o), label: text(o)};
	const out = {value: text(o.value), label: text(o.label)};
	if (!blank(o.title) && o.title !== '') out.title = text(o.title);
	if (!blank(o.group) && o.group !== '') out.group = text(o.group);
	return out;
};
const normOptions = (options) => (options || []).filter((o) => !blank(o)).map(normOption);

/** Lọc danh sách chọn: mọi từ gõ phải khớp nhãn hoặc giá trị (không phân biệt dấu); trả tối đa `limit` mục và tổng số khớp. */
export function filterOptions(options, query, limit) {
	const list = normOptions(options);
	const words = fold(query).split(/\s+/).filter((w) => w);
	const hits = words.length ? list.filter((o) => {
		const s = fold(`${o.label} ${o.value} ${o.title || ''} ${o.group || ''}`);
		return words.every((w) => s.indexOf(w) >= 0);
	}) : list;
	return {items: hits.slice(0, limit || 200), total: hits.length};
}

const SEARCH_LIMIT = 200;

function SearchSelectImpl(p) {
	const t = pick(TEXT);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);
	const ref = useRef(null);
	if (!ref.current) {
		fieldSeq += 1;
		ref.current = `s4vp-ss${fieldSeq}`;
	}
	const base = ref.current;
	const want = text(p.value);
	const options = normOptions(p.options);
	const all = blank(p.placeholder) ? options : [{value: '', label: text(p.placeholder)}].concat(options.filter((o) => o.value !== ''));
	const current = all.filter((o) => o.value === want)[0] || null;
	const shown = filterOptions(all, query, SEARCH_LIMIT);
	const close = (focusBack) => {
		setOpen(false);
		setQuery('');
		setActive(0);
		if (focusBack)
			setTimeout(() => {
				try {
					const b = document.getElementById(`${base}-b`);
					if (b) b.focus();
				} catch (e) {
					// bỏ qua
				}
			}, 0);
	};
	const choose = (o) => {
		close(true);
		if (o && p.onInput && o.value !== want) p.onInput(o.value);
	};
	// Phím trên ô lọc xử lý bằng trình nghe gốc (mũi tên lặp khi giữ phím; Esc không lan ra hộp thoại bao ngoài)
	const live = useRef(null);
	live.current = {shown, active, choose, close, setActive};
	useEffect(() => {
		if (!open) return undefined;
		let on = true;
		const outside = (ev) => {
			try {
				const w = document.getElementById(base);
				if (on && w && !w.contains(ev.target)) close(false);
			} catch (e) {
				// bỏ qua
			}
		};
		const timer = setTimeout(() => {
			if (!on) return;
			document.addEventListener('click', outside);
			try {
				const q = document.getElementById(`${base}-q`);
				if (q) q.focus();
			} catch (e) {
				// bỏ qua
			}
		}, 0);
		return () => {
			on = false;
			clearTimeout(timer);
			document.removeEventListener('click', outside);
		};
	}, [open]);
	useEffect(() => {
		if (!open) return;
		try {
			const q = document.getElementById(`${base}-q`);
			if (q && !q.__s4vpKeys) {
				q.__s4vpKeys = true;
				q.addEventListener('keydown', (ev) => {
					const L = live.current;
					const n = L.shown.items.length;
					if (ev.key === 'ArrowDown') L.setActive(Math.min(L.active + 1, Math.max(n - 1, 0)));
					else if (ev.key === 'ArrowUp') L.setActive(Math.max(L.active - 1, 0));
					else if (ev.key === 'Home') L.setActive(0);
					else if (ev.key === 'End') L.setActive(Math.max(n - 1, 0));
					else if (ev.key === 'Enter') {
						if (n) L.choose(L.shown.items[Math.min(L.active, n - 1)]);
					} else if (ev.key === 'Escape') L.close(true);
					else return;
					ev.preventDefault();
					ev.stopPropagation();
				});
				q.addEventListener('keyup', (ev) => {
					if (ev.key === 'Escape') ev.stopPropagation();
				});
			}
			const opt = document.getElementById(`${base}-o${active}`);
			if (opt && opt.scrollIntoView) opt.scrollIntoView({block: 'nearest'});
		} catch (e) {
			// bỏ qua
		}
	});
	const label = current ? current.label : want ? want : t.choose;
	const btn = {id: `${base}-b`, type: 'button', class: cx('s4vp-in', 's4vp-ss-btn', current && current.value !== '' ? '' : 's4vp-ss-ph'), 'aria-haspopup': 'listbox', 'aria-expanded': open ? 'true' : 'false'};
	if (p.disabled) btn.disabled = 'disabled';
	else btn.onClick = () => (open ? close(false) : setOpen(true));
	if (p.ariaLabel) btn['aria-label'] = `${p.ariaLabel}: ${label}`;
	btn.title = p.title || label;
	const wrap = {id: base, class: cx('s4vp-ss', open ? 's4vp-ss-open' : '')};
	if (p.width) wrap.style = {width: px(p.width)};
	const q = {id: `${base}-q`, type: 'search', class: 's4vp-in', value: query, placeholder: t.filter, 'aria-label': p.ariaLabel ? `${p.ariaLabel} - ${t.filter}` : t.filter, autocomplete: 'off', role: 'combobox', 'aria-controls': `${base}-l`, 'aria-expanded': 'true'};
	q.onInput = (m) => {
		setQuery(valueOf(m));
		setActive(0);
	};
	if (shown.items.length) q['aria-activedescendant'] = `${base}-o${Math.min(active, shown.items.length - 1)}`;
	return (
		<div {...wrap}>
			<button {...btn}>
				<span class="s4vp-ss-val">{label}</span>
				<span class="s4vp-ss-caret" aria-hidden="true">{'▾'}</span>
			</button>
			{open ? (
				<div class="s4vp-ss-pop">
					<input {...q} />
					<div id={`${base}-l`} class="s4vp-ss-list" role="listbox">
						{shown.items.reduce((out, o, i) => {
							// Tiêu đề nhóm trước mục đầu của mỗi nhóm
							if (o.group && (i === 0 || shown.items[i - 1].group !== o.group)) out.push(<div key={`g${i}`} class="s4vp-ss-note" role="presentation">{o.group}</div>);
							const a = {key: `o${o.value}`, id: `${base}-o${i}`, type: 'button', role: 'option', tabindex: '-1', class: cx('s4vp-ss-opt', i === active ? 's4vp-on' : '', o.value === want ? 's4vp-sel' : ''), 'aria-selected': o.value === want ? 'true' : 'false', onClick: () => choose(o)};
							if (o.title) a.title = o.title;
							out.push(<button {...a}>{o.label || o.value || t.choose}</button>);
							return out;
						}, [])}
						{shown.total ? null : <div class="s4vp-ss-note">{t.noMatch}</div>}
						{shown.total > shown.items.length ? <div class="s4vp-ss-note">{t.more(shown.total - shown.items.length)}</div> : null}
					</div>
				</div>
			) : null}
		</div>
	);
}

function SelectImpl(p) {
	const want = text(p.value);
	const id = useSyncedId(want);
	const attrs = controlAttrs(p, id, '');
	attrs.value = want;
	const options = (p.options || []).filter(Boolean).map(normOption);
	const list = blank(p.placeholder) ? options : [{value: '', label: text(p.placeholder)}].concat(options.filter((o) => o.value !== ''));
	delete attrs.placeholder;
	const option = (o) => {
		const a = {value: o.value};
		if (o.value === want) a.selected = 'selected';
		if (o.title) a.title = o.title;
		return (
			<option key={`o${o.value}`} {...a}>
				{o.label}
			</option>
		);
	};
	// Mục có group: các mục liền nhau cùng nhóm gom vào một <optgroup>
	const children = [];
	list.forEach((o) => {
		const last = children[children.length - 1];
		if (!o.group) children.push(option(o));
		else if (last && last.group === o.group) last.items.push(option(o));
		else children.push({group: o.group, items: [option(o)]});
	});
	return (
		<select {...attrs}>
			{children.map((c, i) => (c && c.group !== undefined && Array.isArray(c.items) ? (
				<optgroup key={`g${i}`} label={c.group}>
					{c.items}
				</optgroup>
			) : c))}
		</select>
	);
}

function TextAreaImpl(p) {
	const want = text(p.value);
	const id = useSyncedId(want);
	const attrs = controlAttrs(p, id, '');
	attrs.rows = String(p.rows || 3);
	return <textarea {...attrs}>{want}</textarea>;
}

/** Ô chữ: {value, onInput(chuỗi), placeholder, width, disabled, ariaLabel, type, onEnter}. */
export function TextInput(props) {
	return <InputImpl {...props} />;
}

/**
 * Ô số: căn phải, bàn phím số trên điện thoại; onInput nhận chuỗi người dùng gõ (đổi sang số bằng toNumber khi lưu).
 * Có min / max / step thì là <input type="number"> (mũi tên lên xuống theo bước, ví dụ giờ step 0.5 min 0); không có thì là ô chữ
 * (gõ được 1.234,5).
 */
export function NumberInput(props) {
	const spin = ['min', 'max', 'step'].some((k) => !blank(props[k]) && props[k] !== '');
	return <InputImpl {...props} align="right" inputmode="decimal" type={spin ? 'number' : 'text'} />;
}

/** Ô số tiền: căn phải, gõ tự do (1234567 hoặc 1.234.567), rời ô thì tự thêm phân tách nghìn; value số thì hiện đã phân tách. decimals: số lẻ tối đa (mặc định 2). */
export function MoneyInput(props) {
	return <MoneyImpl {...props} />;
}

/**
 * Ô ngày: <input type="date"> (lịch chọn của trình duyệt, hiển thị theo ngôn ngữ trình duyệt, vẫn gõ được); value và onInput là
 * ISO yyyy-mm-dd ('' khi xóa). min / max ISO. Trình duyệt không có ô ngày (hoặc UIF không ghi type) thì là ô chữ dd/mm/yyyy như cũ:
 * onInput nhận ISO khi gõ đủ một ngày có thật, ngược lại chuỗi đang gõ.
 */
export function DateInput(props) {
	return <TypedImpl {...props} kind="date" />;
}

/** Ô tháng (kỳ YYYY-MM): <input type="month">; trình duyệt không hỗ trợ thì ô chữ yyyy-mm (nhận cả mm/yyyy). */
export function MonthInput(props) {
	return <TypedImpl {...props} kind="month" />;
}

/** Ô giờ trong ngày (HH:MM): <input type="time">; không hỗ trợ thì ô chữ hh:mm (nhận 8:30, 8h30). */
export function TimeInput(props) {
	return <TypedImpl {...props} kind="time" />;
}

/** Hộp kiểm có / không: {checked, onInput(boolean), label, disabled, ariaLabel, inField (đặt trong Field thì không lồng <label>)}. */
export function Checkbox(props) {
	return <CheckImpl {...props} />;
}

/** Ô chọn: {value, onInput(value), options: [{value, label}], placeholder (dòng trống đầu danh sách), width, disabled, ariaLabel}. */
export function Select(props) {
	return <SelectImpl {...props} />;
}

/**
 * Ô chọn có tìm kiếm cho danh sách dài (nhân viên, dự án, tài khoản...): cùng props với Select. Bấm mở khung có ô lọc (không phân
 * biệt dấu, khớp nhãn và mã); mũi tên lên / xuống chọn, Enter lấy, Esc đóng; hiện tối đa 200 mục khớp.
 */
export function SearchSelect(props) {
	return <SearchSelectImpl {...props} />;
}

/** Chọn Select hay SearchSelect theo độ dài danh sách (quá 15 mục thì có ô tìm). */
export function AutoSelect(props) {
	return (props.options || []).length > 15 ? <SearchSelectImpl {...props} /> : <SelectImpl {...props} />;
}

export function TextArea(props) {
	return <TextAreaImpl {...props} />;
}

/** Ô tìm kiếm: {value, onInput(chuỗi), placeholder, width, label}. */
export function SearchBox({value, onInput, placeholder, width, label}) {
	const t = pick(TEXT);
	return <InputImpl type="search" value={value} onInput={onInput} placeholder={placeholder || t.search} ariaLabel={label || placeholder || t.search} width={width || 260} />;
}

/** Nhãn + ô nhập (+ gợi ý); bọc bằng <label> nên bấm nhãn là vào ô. required: thêm dấu * đỏ sau nhãn. */
export function Field({label, children, hint, required}) {
	const t = pick(TEXT);
	return (
		<label class="s4vp-field">
			<span>
				{text(label)}
				{required ? <span class="s4vp-req" title={t.required}>{' *'}</span> : null}
			</span>
			{children}
			{blank(hint) || hint === '' ? null : <span class="s4vp-field-hint">{hint}</span>}
		</label>
	);
}

// ------------------------------------------------------------------ bảng

const TYPE_FORMAT = {money, num, pct, date: fmtDate};
const formatCell = (col, v) => (TYPE_FORMAT[col.type] ? TYPE_FORMAT[col.type](v) : text(v));
const alignOf = (col) => col.align || (col.type === 'money' || col.type === 'num' || col.type === 'pct' ? 'right' : 'left');
const cellClass = (col) => cx(alignOf(col) === 'right' ? 's4vp-r' : alignOf(col) === 'center' ? 's4vp-c' : '', col.nowrap ? 's4vp-nw' : '');

function cellOf(col, row) {
	try {
		if (col.render) {
			const v = col.render(row);
			return blank(v) ? '' : v;
		}
		return formatCell(col, row[col.key]);
	} catch (e) {
		return '';
	}
}

// Nút trong ô (cột noRowClick) không được kéo theo onRowClick của dòng: handler của UIF không có stopPropagation,
// nên ô ghi lại thời điểm bấm và dòng bỏ qua lượt bấm vừa được ô nhận.
let cellClickAt = 0;

function TableImpl({columns, rows, keyOf, onRowClick, selectedKey, total, empty, search, maxHeight, toolbar, searchPlaceholder, label}) {
	const t = pick(TEXT);
	const [query, setQuery] = useState('');
	const cols = (columns || []).filter(Boolean);
	const all = Array.isArray(rows) ? rows : [];
	let shown = {rows: all, count: null};
	if (search) {
		try {
			shown = quickFilter(all, query);
		} catch (e) {
			shown = {rows: all, count: null};
		}
	}
	const keyFor = (row, i) => {
		try {
			const k = keyOf ? keyOf(row) : row && row.id;
			return blank(k) || k === '' ? `i${i}` : String(k);
		} catch (e) {
			return `i${i}`;
		}
	};
	const wrap = {class: 's4vp-tbl-wrap'};
	if (maxHeight) wrap.style = {maxHeight: px(maxHeight), overflowY: 'auto'};
	const tableAttrs = {class: cx('s4vp-tbl', onRowClick ? 's4vp-tbl-click' : '', maxHeight ? 's4vp-tbl-sticky' : '')};
	if (label) tableAttrs['aria-label'] = label;
	return (
		<div>
			{search || toolbar ? (
				<div class="s4vp-tbl-bar">
					<div class="s4vp-tbl-bar-l">{toolbar || null}</div>
					{search ? (
						<div class="s4vp-tbl-bar-r">
							{shown.count === null ? null : <span class="s4vp-tbl-count">{t.matches(shown.count)}</span>}
							<InputImpl type="search" value={query} onInput={setQuery} placeholder={searchPlaceholder || t.search} ariaLabel={searchPlaceholder || t.search} width={260} />
						</div>
					) : null}
				</div>
			) : null}
			<div {...wrap}>
				<table {...tableAttrs}>
					<thead>
						<tr>
							{cols.map((c, i) => {
								const a = {class: cellClass(c)};
								if (c.width) a.style = {width: px(c.width), minWidth: px(c.width)};
								return (
									<th key={`h${c.key || i}`} {...a}>
										{text(c.label)}
									</th>
								);
							})}
						</tr>
					</thead>
					<tbody>
						{shown.rows.map((row, i) => {
							const k = keyFor(row, i);
							const a = {class: cx('s4vp-row', !blank(selectedKey) && String(selectedKey) === k ? 's4vp-sel' : '')};
							if (onRowClick) a.onClick = () => Date.now() - cellClickAt > 80 && onRowClick(row);
							return (
								<tr key={k} {...a}>
									{cols.map((c, j) => {
										const content = cellOf(c, row);
										const td = {class: cellClass(c)};
										if (onRowClick && c.noRowClick)
											td.onClick = () => {
												cellClickAt = Date.now();
											};
										// Cột đầu của dòng bấm được bọc trong nút thật để chọn dòng bằng bàn phím (Enter / Space nổi bọt lên dòng)
										const asButton = onRowClick && j === 0 && !c.noRowClick && c.rowButton !== false;
										return (
											<td key={`c${c.key || j}`} {...td}>
												{asButton ? <button type="button" class="s4vp-rowbtn">{content}</button> : content}
											</td>
										);
									})}
								</tr>
							);
						})}
						{shown.rows.length ? null : (
							<tr key="s4vp-empty">
								<td colSpan={String(cols.length || 1)}>
									<div class="s4vp-empty">{text(empty) || t.empty}</div>
								</td>
							</tr>
						)}
						{total ? (
							<tr key="s4vp-total" class="s4vp-total">
								{cols.map((c, j) => (
									<td key={`t${c.key || j}`} class={cellClass(c)}>
										{c.key ? formatCell(c, total[c.key]) : ''}
									</td>
								))}
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/**
 * Bảng đơn giản trong khung cuộn ngang.
 * columns: [{key, label, align, render(row), width, nowrap, type, noRowClick, rowButton}]
 *   type: 'money' | 'num' | 'pct' | 'date' tự định dạng row[key] (money, num, pct căn phải); render(row) trả JSX hoặc chuỗi.
 *   noRowClick: ô có nút riêng, bấm trong ô không kích hoạt onRowClick.
 * search: true có ô tìm phía trên (quickFilter trên dữ liệu thô của dòng); toolbar: JSX đặt bên trái ô tìm (bộ lọc, nút).
 * total: đối tượng cùng khóa, hiện đậm ở cuối, không bị lọc, định dạng theo type của cột (không gọi render).
 * selectedKey: khóa dòng đang chọn (so với keyOf(row), mặc định row.id); maxHeight: thân bảng cuộn dọc, tiêu đề dính.
 */
export function Table(props) {
	return <TableImpl {...props} />;
}

// ------------------------------------------------------------------ hộp thoại, khung bên phải

/** Hộp thoại giữa màn hình; actions: mảng nút ở chân; onClose: nút đóng góc phải và phím Esc. */
export function Dialog({title, children, actions, onClose, width}) {
	const t = pick(TEXT);
	const panel = {class: 's4vp-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': text(title)};
	if (width) panel.style = {width: px(width)};
	return (
		<div class="s4vp-overlay" onKeyUp={(m) => keyOfMessage(m) === 'Escape' && onClose && onClose()}>
			<div {...panel}>
				<div class="s4vp-dialog-h">
					<div class="s4vp-dialog-t">{text(title)}</div>
					{onClose ? <button type="button" class="s4vp-x" aria-label={t.close} title={t.close} onClick={() => onClose()}>{'×'}</button> : null}
				</div>
				<div class="s4vp-dialog-b">{children}</div>
				{actions ? <div class="s4vp-dialog-f">{keyed(actions)}</div> : null}
			</div>
		</div>
	);
}

/** Khung chi tiết cho cột bên phải (không cố định vị trí); đặt cạnh cột chính trong <div class="s4vp-cols"> (tỷ lệ 6:4), hoặc trong <div class="s4vp-col-side"> khi cột phải có nhiều khối. */
export function SidePanel({title, sub, onClose, children, actions}) {
	const t = pick(TEXT);
	return (
		<aside class="s4vp-side" aria-label={text(title)}>
			<div class="s4vp-side-h">
				<div>
					<div class="s4vp-side-t">{text(title)}</div>
					{blank(sub) || sub === '' ? null : <div class="s4vp-side-s">{sub}</div>}
				</div>
				<div class="s4vp-actions">
					{keyed(actions)}
					{onClose ? <button type="button" class="s4vp-x" aria-label={t.close} title={t.close} onClick={() => onClose()}>{'×'}</button> : null}
				</div>
			</div>
			{children}
		</aside>
	);
}
