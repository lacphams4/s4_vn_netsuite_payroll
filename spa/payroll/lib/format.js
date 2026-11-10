/**
 * Định dạng số, ngày và lọc nhanh dùng chung. Tiền làm tròn đồng, số 0 hiện "-", số âm trong ngoặc; ngày lưu
 * yyyy-mm-dd, hiển thị dd/mm/yyyy; lọc nhanh không phân biệt dấu, mọi từ phải khớp, khớp cả số tiền có hoặc không có dấu chấm.
 */
export const money = (n) => {
	if (n === null || n === undefined || n === '') return '';
	const v = Math.round(Number(n));
	if (v === 0) return '-';
	const s = Math.abs(v).toLocaleString('vi-VN');
	return v < 0 ? `(${s})` : s;
};
export const num = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('vi-VN', {maximumFractionDigits: 2}));
export const pct = (n) => (n === null || n === undefined || n === '' ? '' : `${(Number(n) * 100).toLocaleString('vi-VN', {maximumFractionDigits: 2})}%`);

// Ngày lưu dạng yyyy-mm-dd, hiển thị dd/mm/yyyy; ô nhập nhận cả hai dạng
export const fmtDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v).split('-').reverse().join('/') : v || '');
export const toIso = (v) => {
	const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim());
	return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(v || '').trim();
};

// Ngày hôm nay theo giờ máy người dùng (toISOString là UTC, lệch ngày vào buổi sáng ở Việt Nam)
export const localToday = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Số người dùng gõ (1.234.567,5 hoặc 1234567.5) -> number; ô trống -> null
export const toNumber = (v) => {
	const s = String(v === null || v === undefined ? '' : v).trim();
	if (!s) return null;
	const n = Number(s.indexOf(',') >= 0 ? s.replace(/\./g, '').replace(',', '.') : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s);
	return isNaN(n) ? null : n;
};

export const fold = (v) =>
	String(v === null || v === undefined ? '' : v)
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[đĐ]/g, 'd')
		.toLowerCase();

export function rowText(r) {
	const parts = [];
	for (const k of Object.keys(r || {})) {
		const v = r[k];
		if (v === null || v === undefined || typeof v === 'object' || typeof v === 'function') continue;
		parts.push(String(v));
		if (typeof v === 'number' && Math.abs(v) >= 1) parts.push(Math.round(Math.abs(v)).toLocaleString('vi-VN'));
	}
	return fold(parts.join(' '));
}

export function quickFilter(rows, text) {
	const list = rows || [];
	const words = fold(text).split(/\s+/).filter((w) => w);
	if (!words.length) return {rows: list, count: null};
	const out = list.filter((r) => {
		const t = rowText(r);
		return words.every((w) => t.indexOf(w) >= 0 || t.replace(/[.,]/g, '').indexOf(w.replace(/[.,]/g, '')) >= 0);
	});
	return {rows: out, count: out.length};
}
