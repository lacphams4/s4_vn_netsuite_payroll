/**
 * Ngôn ngữ giao diện: theo tùy chọn LANGUAGE của người dùng NetSuite (vi hoặc en), mặc định tiếng Việt khi không đọc được.
 * Mỗi view tự mang bảng chữ `const TEXT = {vi: {...}, en: {...}}` và lấy bảng đang dùng bằng pick(TEXT).
 */
import runtime from 'N/runtime';

export function language() {
	try {
		return String(runtime.getCurrentUser().getPreference({name: 'LANGUAGE'}) || '').toLowerCase().startsWith('vi') ? 'vi' : 'en';
	} catch (e) {
		return 'vi';
	}
}

// Bảng chữ theo ngôn ngữ; khóa thiếu ở bản tiếng Anh lấy bản tiếng Việt (chỉ bù ở cấp ngoài cùng)
export function pick(TEXT) {
	const table = TEXT || {};
	const lang = language();
	return lang === 'vi' || !table[lang] ? table.vi || {} : Object.assign({}, table.vi, table[lang]);
}
