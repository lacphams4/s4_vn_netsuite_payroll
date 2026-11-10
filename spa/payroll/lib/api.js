/**
 * Gọi RESTlet customscript_s4vp_rl_api: call(params) là GET, post(body) là POST. Lỗi nghiệp vụ máy chủ trả ở khóa
 * s4vpError / s4vpErrorVi (không dùng khóa "error": N/https phía trình duyệt nuốt nội dung) và được ném thành {message}.
 */
import url from 'N/url';
import https from 'N/https';
import {serverText, serverLanguage} from './i18n.js';

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
	if (body && body.s4vpError) throw {message: serverText(body.s4vpError, body.s4vpErrorVi)};
	return body;
}

// Địa chỉ RESTlet chỉ hỏi máy chủ một lần (mỗi lần url.resolveScript là một lượt gọi đồng bộ khoảng 0,3 giây), tham số tự ghép
let restletBase = '';
function restletUrl(params) {
	if (!restletBase) restletBase = url.resolveScript(Object.assign({}, RESTLET));
	const query = Object.keys(params || {})
		.filter((k) => params[k] !== undefined && params[k] !== null)
		.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
		.join('&');
	return query ? `${restletBase}${restletBase.indexOf('?') >= 0 ? '&' : '?'}${query}` : restletBase;
}

const get = (params) => https.get.promise({url: restletUrl(params), headers: {'Content-Type': 'application/json'}}).then(unwrap);

// Gọi trước: khung gửi lượt đọc của màn đang mở song song với bootstrap; view gọi call() cùng tham số sẽ nhận đúng kết quả đó
// (dùng một lần, trong 20 giây) thay vì chờ bootstrap xong mới bắt đầu gọi.
const early = {};
const keyOf = (params) => JSON.stringify(Object.keys(params || {}).sort().map((k) => [k, String(params[k])]));

export function prefetch(params) {
	try {
		const promise = get(params);
		// lỗi của lượt gọi trước không được thành "unhandled rejection"; view nhận lại lỗi khi dùng
		promise.then(() => undefined, () => undefined);
		early[keyOf(params)] = {promise, at: Date.now()};
	} catch (e) {
		// không gọi trước được: view tự gọi như thường
	}
}

export function call(params) {
	const key = keyOf(params);
	const hit = early[key];
	if (hit) {
		delete early[key];
		if (Date.now() - hit.at < 20000) return hit.promise;
	}
	return get(params);
}

export function post(body) {
	return https.post.promise({url: restletUrl(), body: JSON.stringify(body), headers: {'Content-Type': 'application/json'}}).then(unwrap);
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
	return url.resolveScript(Object.assign({}, PRINT, {params: {batch: batchId, doc, lang: serverLanguage()}}));
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
