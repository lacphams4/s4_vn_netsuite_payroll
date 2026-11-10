/**
 * Gọi RESTlet customscript_s4vp_rl_api: call(params) là GET, post(body) là POST. Lỗi nghiệp vụ máy chủ trả ở khóa
 * s4vpError / s4vpErrorVi (không dùng khóa "error": N/https phía trình duyệt nuốt nội dung) và được ném thành {message}.
 */
import url from 'N/url';
import https from 'N/https';
import {language} from './i18n.js';

export const RESTLET = {scriptId: 'customscript_s4vp_rl_api', deploymentId: 'customdeploy_s4vp_rl_api'};
export const PRINT = {scriptId: 'customscript_s4vp_sl_print', deploymentId: 'customdeploy_s4vp_sl_print'};

// Lỗi từ N/https có thể không phải Error chuẩn (message rỗng, nội dung nằm ở details / cause): lấy chuỗi đầu tiên có nội dung
export function errorText(e) {
	if (!e) return '';
	const parts = [e.message, e.text, e.details, e.cause && (e.cause.message || e.cause.details), e.name, typeof e === 'string' ? e : ''];
	const found = parts.find((x) => typeof x === 'string' && x.trim());
	if (found) return found;
	try {
		return JSON.stringify(e).slice(0, 300);
	} catch (x) {
		return String(e);
	}
}

export function unwrap(response) {
	const body = typeof response.body === 'string' ? JSON.parse(response.body || '{}') : response.body;
	// Ném đối tượng thường: Error trong môi trường SPA của NetSuite bị bọc lại, mất message (chỉ còn {userFacing: false})
	if (body && body.s4vpError) throw {message: language() === 'vi' ? body.s4vpErrorVi || body.s4vpError : body.s4vpError};
	return body;
}

export function call(params) {
	return https.get.promise({url: url.resolveScript(Object.assign({}, RESTLET, {params})), headers: {'Content-Type': 'application/json'}}).then(unwrap);
}

export function post(body) {
	return https.post.promise({url: url.resolveScript(Object.assign({}, RESTLET)), body: JSON.stringify(body), headers: {'Content-Type': 'application/json'}}).then(unwrap);
}

// Mở bản ghi NetSuite ở tab mới
export function openRecord(type, id) {
	if (!type || !id) return;
	window.open(url.resolveRecord({recordType: type, recordId: id}), '_blank');
}

export function openJournal(id) {
	if (id) window.open(`/app/accounting/transactions/journal.nl?id=${encodeURIComponent(id)}`, '_blank');
}

// Đường dẫn Suitelet in (phiếu lương, bảng thanh toán, quyết toán CTV) của một bảng lương
export function printUrl(batchId, doc) {
	return url.resolveScript(Object.assign({}, PRINT, {params: {batch: batchId, doc, lang: language()}}));
}

// Tải nội dung văn bản (CSV, file ngân hàng) về máy người dùng
export function download(name, content) {
	const blob = new Blob([content], {type: 'text/csv;charset=utf-8'});
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	document.body.appendChild(a);
	a.click();
	setTimeout(() => {
		URL.revokeObjectURL(a.href);
		a.remove();
	}, 1000);
}
