/**
 * Portlet "Lương của tôi" cho tab tự tạo của Employee Center (và dashboard của các role nội bộ).
 *
 * Portlet chạy bằng quyền của người xem (không có runasrole), nên KHÔNG đọc record lương: chỉ hiện một dòng tóm tắt nhẹ (tên
 * người đăng nhập, lời nhắc bảo mật, nút mở cổng đầy đủ) và nhúng cổng tự phục vụ (Suitelet s4vp_sl_my_payroll, chạy bằng role
 * customrole_s4vp_selfservice và lọc cứng theo người đăng nhập) bằng iframe với `view=dashboard&embed=1` (bản gọn chỉ tab Tổng
 * quan). `ifrmcntnr=T` theo khuyến nghị của NetSuite cho Suitelet nằm trong iframe.
 *
 * Để portlet hiện sẵn cho mọi nhân viên: quản trị viên thêm portlet vào tab rồi Publish Dashboard cho role Employee Center
 * (cấu hình account, không làm bằng SDF).
 *
 * @NApiVersion 2.1
 * @NScriptType Portlet
 * @NModuleScope SameAccount
 */
define(["N/url", "N/runtime"], (url, runtime) => {
	const TEXT = {
		vi: { title: "Lương của tôi", hello: "Xin chào {0}.", note: "Chỉ bạn xem được thông tin này. Số liệu lấy từ bảng lương đã ghi sổ.", open: "Mở đầy đủ", frame: "Tổng quan lương của tôi", blocked: "Không mở được cổng nhân viên." },
		en: { title: "My payroll", hello: "Hello {0}.", note: "Only you can see this information. Figures come from released payroll batches.", open: "Open full portal", frame: "My pay overview", blocked: "The employee portal could not be opened." },
	};
	const FRAME_HEIGHT = 900;

	const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
	const fill = (s, v) => String(s).replace("{0}", v);

	function language() {
		try {
			return /^en/i.test(String(runtime.getCurrentUser().getPreference({ name: "LANGUAGE" }) || "")) ? "en" : "vi";
		} catch (e) {
			return "vi";
		}
	}

	/** HTML của portlet (tách riêng để kiểm thử): base là địa chỉ Suitelet tự phục vụ. */
	function markup(base, lang, name) {
		const t = TEXT[lang] || TEXT.vi;
		if (!base) return `<div style="padding:8px 4px;color:#8A1C14;font-size:13px">${esc(t.blocked)}</div>`;
		const sep = base.indexOf("?") >= 0 ? "&" : "?";
		const full = `${base}${sep}view=dashboard`;
		const frame = `${base}${sep}view=dashboard&embed=1&ifrmcntnr=T`;
		return (
			`<div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;justify-content:space-between;padding:4px 2px 8px;font-size:13px;color:#1D2730">` +
			`<span>${name ? esc(fill(t.hello, name)) + " " : ""}<span style="color:#55616B">${esc(t.note)}</span></span>` +
			`<a href="${esc(full)}" target="_blank" rel="noopener" style="display:inline-block;padding:6px 12px;border:1px solid #24566B;border-radius:8px;color:#24566B;font-weight:600;text-decoration:none">${esc(t.open)}</a>` +
			`</div>` +
			`<iframe src="${esc(frame)}" title="${esc(t.frame)}" loading="lazy" style="display:block;width:100%;height:${FRAME_HEIGHT}px;border:0;border-radius:8px;background:#F3F4F2"></iframe>`
		);
	}

	function render(params) {
		const lang = language();
		const t = TEXT[lang];
		const portlet = params.portlet;
		portlet.title = t.title;
		let base = "";
		try {
			base = url.resolveScript({ scriptId: "customscript_s4vp_sl_my_payroll", deploymentId: "customdeploy_s4vp_sl_my_payroll" });
		} catch (e) {
			base = "";
		}
		let name = "";
		try {
			name = String(runtime.getCurrentUser().name || "");
		} catch (e) {
			name = "";
		}
		portlet.html = markup(base, lang, name);
	}

	return { render, markup, TEXT };
});
