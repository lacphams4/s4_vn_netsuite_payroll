/**
 * Ngôn ngữ giao diện: theo tùy chọn LANGUAGE của người dùng NetSuite (vi_VN -> vi, en_US -> en, fr_FR -> fr...).
 * Mỗi view tự mang bảng chữ `const TEXT = {vi: {...}, en: {...}}` và lấy bảng đang dùng bằng pick(TEXT).
 * Thêm ngôn ngữ thứ ba: thêm bảng `TEXT.<mã>` (ví dụ `ja`) vào bảng chữ của view, không phải sửa mã vẽ; khóa chưa dịch
 * tự lấy bản tiếng Anh rồi bản tiếng Việt. Độ phủ vi / en được kiểm bằng `node tools/check_i18n.mjs`.
 */
import runtime from 'N/runtime';

// Thứ tự lùi khi bảng của ngôn ngữ đang dùng thiếu chữ
const FALLBACK = ['en', 'vi'];

// Mã ngôn ngữ 2 chữ thường; không đọc được tùy chọn thì tiếng Việt, tùy chọn rỗng hoặc lạ thì tiếng Anh
export function language() {
	try {
		const raw = String(runtime.getCurrentUser().getPreference({name: 'LANGUAGE'}) || '').toLowerCase();
		const m = /^[a-z]{2}/.exec(raw);
		return m ? m[0] : 'en';
	} catch (e) {
		return 'vi';
	}
}

export function isVi() {
	return language() === 'vi';
}

// Thứ tự tra chữ: ngôn ngữ đang dùng -> en -> vi (không lặp)
export function chain(lang) {
	const out = [];
	[lang || language()].concat(FALLBACK).forEach((l) => {
		if (l && out.indexOf(l) < 0) out.push(l);
	});
	return out;
}

// Đối tượng thường ({...}): nguyên mẫu là Object.prototype (của bất kỳ khung nào) hoặc không có nguyên mẫu
const isPlain = (v) => {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === null || Object.getPrototypeOf(proto) === null;
};

// Bù khóa thiếu theo chiều sâu: đối tượng thường thì gộp từng khóa con; hàm, mảng, chuỗi, số thì lấy nguyên của bảng ưu tiên
function fill(primary, backup) {
	if (primary === undefined || primary === null) return backup;
	if (!isPlain(primary) || !isPlain(backup)) return primary;
	const out = {};
	Object.keys(backup).forEach((k) => {
		out[k] = backup[k];
	});
	Object.keys(primary).forEach((k) => {
		out[k] = fill(primary[k], backup[k]);
	});
	return out;
}

// Gộp bảng chữ theo thứ tự ưu tiên của `lang` (dùng được ngoài NetSuite, ví dụ trong kiểm thử)
export function resolve(TEXT, lang) {
	const table = TEXT || {};
	let out;
	chain(lang).forEach((l) => {
		if (isPlain(table[l])) out = out === undefined ? table[l] : fill(out, table[l]);
	});
	return out || {};
}

const cache = typeof WeakMap === 'function' ? new WeakMap() : null;

// Bảng chữ theo ngôn ngữ của người dùng; kết quả được giữ lại theo từng TEXT (ngôn ngữ không đổi trong một lần mở trang)
export function pick(TEXT) {
	if (!TEXT || typeof TEXT !== 'object') return {};
	const lang = language();
	const hit = cache && cache.get(TEXT);
	if (hit && hit.lang === lang) return hit.value;
	const value = resolve(TEXT, lang);
	if (cache) cache.set(TEXT, {lang, value});
	return value;
}

// Chọn chữ từ đối tượng mang sẵn nhiều ngôn ngữ, ví dụ cột báo cáo {vi: 'Mã NV', en: 'Employee ID'}
export function localized(obj, lang) {
	if (!obj || typeof obj !== 'object') return obj;
	const order = chain(lang);
	for (let i = 0; i < order.length; i++) {
		const v = obj[order[i]];
		if (v !== undefined && v !== null && v !== '') return v;
	}
	return undefined;
}

// Chọn thông báo từ cặp (bản tiếng Anh, bản tiếng Việt) máy chủ trả về: bản Việt chỉ khi người dùng đặt tiếng Việt
export function serverText(en, vi) {
	return isVi() ? vi || en : en || vi;
}

// Mã ngôn ngữ gửi máy chủ (mẫu in, báo cáo): máy chủ hiện chỉ có bản vi và en, ngôn ngữ khác dùng bản tiếng Anh
export function serverLanguage() {
	return isVi() ? 'vi' : 'en';
}
