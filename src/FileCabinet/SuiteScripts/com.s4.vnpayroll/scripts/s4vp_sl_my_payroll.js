/**
 * Cổng tự phục vụ của nhân viên (VP601000 Phiếu lương của tôi, VP602000 Công và phép của tôi, VP603000 Đơn của tôi,
 * VP641100 In phiếu lương của tôi; đặc tả 1.4.3). Một trang HTML + JS thuần (core/SelfServicePage), dùng được trên điện thoại.
 *
 * Nhân viên xác định từ người dùng đăng nhập ở MỖI lượt gọi; trang không gửi và máy chủ không nhận mã nhân viên từ trình
 * duyệt (yêu cầu kèm employee của người khác bị từ chối). Deployment chạy với role có quyền đọc dữ liệu lương nhưng mọi
 * truy vấn lọc phía máy chủ theo nhân viên đăng nhập (core/SelfServiceOps). Chỉ bảng lương đã ghi sổ (R); lọc năm theo
 * tháng tính thuế (không theo đầu mã kỳ - sửa điểm 6.1 #8 của bản Acumatica). Số định danh chỉ trả dạng che. Không ghi số
 * tiền vào log.
 *
 * GET  (không có op)                 -> trang; &view=dashboard|pay|leave|requests|me chọn tab mở đầu (mặc định Tổng quan),
 *      &embed=1 bản gọn chỉ tab Tổng quan để nhúng vào portlet Employee Center (nút "Mở đầy đủ" mở cổng ở tab mới)
 * GET  ?op=dashboard|payslips|payslip|leave|requests|me|boot -> JSON { ok, data } | { ok: false, code, message }
 * GET  ?op=pdf&batch=<id>&lang=vi|en|bi (hoặc ?batch=<id> như bản cũ) -> PDF phiếu lương của chính mình
 * POST thân JSON { op: saveRequest | requestAction, token, ... } -> JSON; cần mã phiên (token của trang) hoặc tiêu đề
 *      X-S4VP-Request (trang khác nguồn không gửi được cả hai) để chống gửi chéo trang.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define([
	"N/file", "N/render", "N/runtime", "N/url", "N/log", "../api/Store", "../api/Attendance", "../api/Settings", "../api/Clock",
	"../core/PrintModel", "../core/SelfServiceOps", "../core/SelfServicePage",
], (file, render, runtime, url, log, Store, Attendance, Settings, Clock, PrintModel, Ops, Page) => {
	const TOKEN_KEY = "s4vp_ss_token";

	function userId() {
		const u = runtime.getCurrentUser();
		return u && Number(u.id) > 0 ? String(u.id) : null;
	}

	function language() {
		try {
			return /^en/i.test(String(runtime.getCurrentUser().getPreference({ name: "LANGUAGE" }) || "")) ? "en" : "vi";
		} catch (e) {
			return "vi";
		}
	}

	const ops = Ops.create({
		userId,
		today: () => Clock.today(),
		Store,
		Attendance,
		Settings,
		log: (text) => log.error({ title: "s4vp_sl_my_payroll", details: text }),
	});

	/** Mã phiên của trang: lưu trong phiên đăng nhập NetSuite; không dùng được phiên thì trả chuỗi rỗng. */
	function sessionToken(create) {
		try {
			const session = runtime.getCurrentSession();
			let t = session.get({ name: TOKEN_KEY });
			if (!t && create) {
				t = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
				session.set({ name: TOKEN_KEY, value: t });
			}
			return t ? String(t) : "";
		} catch (e) {
			return "";
		}
	}

	function header(request, name) {
		const hs = request.headers || {};
		for (const k of Object.keys(hs)) if (k.toLowerCase() === name.toLowerCase()) return hs[k];
		return null;
	}

	function noStore(response) {
		try {
			response.setHeader({ name: "Cache-Control", value: "no-store" });
		} catch (e) {
			// tiêu đề không đặt được: bỏ qua
		}
	}

	function json(response, payload) {
		response.setHeader({ name: "Content-Type", value: "application/json; charset=utf-8" });
		noStore(response);
		response.write(JSON.stringify(payload));
	}

	function page(response, boot) {
		noStore(response);
		response.write(Page.html(Object.assign({ lang: language() }, boot)));
	}

	function pdf(context, batchId, lang) {
		let detail = null;
		try {
			detail = ops.printDetail(batchId);
		} catch (e) {
			if (!e.userMessage) log.error({ title: "s4vp_sl_my_payroll", details: `pdf: ${String(e.message || e).slice(0, 300)}` });
			return page(context.response, { blocked: e.userMessage || { en: "The payslip could not be printed.", vi: "Không in được phiếu lương." } });
		}
		if (!detail) return page(context.response, { blocked: { en: "No released payslip of yours in this batch.", vi: "Không tìm thấy phiếu lương đã ghi sổ của bạn trong bảng lương này." } });
		const settings = Settings.resolve(detail.batch.subsidiary, null);
		const model = PrintModel.payslips(detail, { lang: ["vi", "en", "bi"].includes(lang) ? lang : language(), company: { name: "", address: "", taxId: "" }, signers: settings.signers, profiles: {}, employee: detail.employee });
		const renderer = render.create();
		renderer.templateContent = file.load({ id: "../templates/payslip.xml" }).getContents();
		renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: "data", data: model });
		const out = renderer.renderAsPdf();
		out.name = `PhieuLuong_${detail.batch.name || batchId}.pdf`;
		context.response.writeFile({ file: out, isInline: true });
	}

	function onRequest(context) {
		const request = context.request;
		const p = request.parameters || {};
		if (String(request.method).toUpperCase() === "POST") {
			let body = null;
			try {
				body = JSON.parse(request.body || "{}");
			} catch (e) {
				body = null;
			}
			if (!body || typeof body !== "object") return json(context.response, { ok: false, code: "INVALID", message: { en: "Invalid request.", vi: "Yêu cầu không hợp lệ." } });
			const token = sessionToken(false);
			const trusted = (!!token && String(body.token || "") === token) || String(header(request, "X-S4VP-Request") || "") === "1";
			if (!trusted) return json(context.response, { ok: false, code: "FORBIDDEN", message: { en: "The page has expired. Please reload it.", vi: "Trang đã hết hạn. Hãy tải lại trang." } });
			// op chỉ lấy từ thân JSON; tham số URL của POST không được dùng
			return json(context.response, ops.handle("POST", {}, body));
		}
		if (p.op === "pdf" || (!p.op && p.batch)) return pdf(context, p.batch, p.lang);
		if (p.op) return json(context.response, ops.handle("GET", p, null));

		const boot = ops.handle("GET", { op: "boot" }, null);
		if (!boot.ok) return page(context.response, { blocked: boot.message });
		const self = url.resolveScript({ scriptId: "customscript_s4vp_sl_my_payroll", deploymentId: "customdeploy_s4vp_sl_my_payroll" });
		// view: tab mở đầu (dashboard = Tổng quan); embed=1: bản gọn nhúng trong portlet (scripts/s4vp_pl_my_payroll.js)
		const VIEW = { dashboard: "home", home: "home", pay: "pay", payslips: "pay", leave: "leave", requests: "req", req: "req", me: "me" };
		page(context.response, {
			url: self,
			token: sessionToken(true),
			employee: boot.data.employee,
			hasProfile: boot.data.hasProfile,
			today: boot.data.today,
			view: VIEW[String(p.view || "")] || "home",
			embed: String(p.embed || "") === "1",
			fullUrl: self,
		});
	}

	return { onRequest };
});
