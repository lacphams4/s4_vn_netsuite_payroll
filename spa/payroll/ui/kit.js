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
import {money, num, pct, fmtDate, toIso, quickFilter} from '../lib/format.js';
import {pick} from '../lib/i18n.js';

const TEXT = {
	vi: {search: 'Tìm (tên, mã, số tiền)', matches: (n) => `${n} dòng khớp`, empty: 'Không có dữ liệu', close: 'Đóng', steps: 'Các bước', crumbs: 'Đường dẫn'},
	en: {search: 'Search (name, code, amount)', matches: (n) => `${n} matching rows`, empty: 'No data', close: 'Close', steps: 'Steps', crumbs: 'Breadcrumb'},
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

export function PageHeader({crumbs, title, status, sub, actions}) {
	const t = pick(TEXT);
	const trail = (crumbs || []).filter(Boolean);
	return (
		<div class="s4vp-ph">
			<div class="s4vp-ph-main">
				{trail.length ? (
					<div class="s4vp-crumbs" aria-label={t.crumbs}>
						{trail.map((c, i) => (
							<span key={`c${i}`} style={{display: 'inline-flex', gap: '4px', alignItems: 'center'}}>
								{i ? <span>/</span> : null}
								{c.onClick ? Button({label: c.label, onClick: c.onClick, kind: 'link'}) : <span>{text(c.label)}</span>}
							</span>
						))}
					</div>
				) : null}
				<div class="s4vp-ph-title">
					<h1>{text(title)}</h1>
					{status && status.text ? Badge({text: status.text, tone: status.tone, large: true}) : null}
				</div>
				{blank(sub) || sub === '' ? null : <div class="s4vp-ph-sub">{sub}</div>}
			</div>
			{actions ? <div class="s4vp-actions">{keyed(actions)}</div> : null}
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

function InputImpl(p) {
	const want = text(p.show ? p.show(p.value) : p.value);
	const id = useSyncedId(want);
	const attrs = controlAttrs(p, id, '');
	attrs.type = p.type || 'text';
	attrs.value = want;
	if (p.inputmode) attrs.inputmode = p.inputmode;
	attrs.autocomplete = 'off';
	return <input {...attrs} />;
}

function SelectImpl(p) {
	const want = text(p.value);
	const id = useSyncedId(want);
	const attrs = controlAttrs(p, id, '');
	attrs.value = want;
	const options = (p.options || []).filter(Boolean).map((o) => (typeof o === 'object' ? {value: text(o.value), label: text(o.label)} : {value: text(o), label: text(o)}));
	const list = blank(p.placeholder) ? options : [{value: '', label: text(p.placeholder)}].concat(options.filter((o) => o.value !== ''));
	delete attrs.placeholder;
	return (
		<select {...attrs}>
			{list.map((o) => {
				const a = {value: o.value};
				if (o.value === want) a.selected = 'selected';
				return (
					<option key={`o${o.value}`} {...a}>
						{o.label}
					</option>
				);
			})}
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

/** Ô số: căn phải, onInput nhận chuỗi người dùng gõ (đổi sang số bằng toNumber của lib/format.js khi lưu). */
export function NumberInput(props) {
	return <InputImpl {...props} align="right" inputmode="decimal" />;
}

/** Ô ngày: nhận dd/mm/yyyy hoặc yyyy-mm-dd; onInput nhận chuỗi ISO khi gõ đủ ngày, ngược lại chuỗi đang gõ; value ISO hiện dd/mm/yyyy. */
export function DateInput(props) {
	return <InputImpl placeholder="dd/mm/yyyy" {...props} show={fmtDate} read={toIso} inputmode="numeric" />;
}

/** Ô chọn: {value, onInput(value), options: [{value, label}], placeholder (dòng trống đầu danh sách), width, disabled, ariaLabel}. */
export function Select(props) {
	return <SelectImpl {...props} />;
}

export function TextArea(props) {
	return <TextAreaImpl {...props} />;
}

/** Ô tìm kiếm: {value, onInput(chuỗi), placeholder, width, label}. */
export function SearchBox({value, onInput, placeholder, width, label}) {
	const t = pick(TEXT);
	return <InputImpl type="search" value={value} onInput={onInput} placeholder={placeholder || t.search} ariaLabel={label || placeholder || t.search} width={width || 260} />;
}

/** Nhãn + ô nhập (+ gợi ý); bọc bằng <label> nên bấm nhãn là vào ô. */
export function Field({label, children, hint}) {
	return (
		<label class="s4vp-field">
			<span>{text(label)}</span>
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

/** Khung chi tiết cho cột bên phải (không cố định vị trí); đặt cạnh cột chính trong <div class="s4vp-cols">. */
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
