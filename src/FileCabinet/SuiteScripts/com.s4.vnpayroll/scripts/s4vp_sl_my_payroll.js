/**
 * Tự phục vụ: Phiếu lương của tôi (VP601000) và In phiếu lương của tôi (VP641100), đặc tả 1.4.3.
 * Nhân viên xác định từ người dùng đăng nhập; chỉ bảng lương đã ghi sổ (R) có dòng của chính người đó; lọc năm theo
 * tháng tính thuế (không theo đầu mã kỳ - sửa điểm 6.1 #8 của bản Acumatica). Deployment chạy với role có quyền đọc
 * dữ liệu lương nhưng mọi truy vấn lọc phía máy chủ theo nhân viên đăng nhập; người dùng chưa gắn nhân viên thì báo rõ.
 * GET ?year=yyyy -> danh sách; GET ?batch=<id>&lang=vi|en|bi -> PDF phiếu lương của chính mình.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(["N/file", "N/render", "N/runtime", "N/url", "N/log", "../api/Store", "../api/Payroll", "../api/Settings", "../core/PrintModel"], (
	file,
	render,
	runtime,
	url,
	log,
	Store,
	Payroll,
	Settings,
	PrintModel
) => {
	const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
	const money = (n) => (Math.round(Number(n) || 0) === 0 ? "-" : Math.round(Number(n)).toLocaleString("vi-VN"));

	function page(response, title, body) {
		response.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:16px;color:#222}table{border-collapse:collapse;width:100%;max-width:900px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}td.n{text-align:right}a{color:#0b5fa5}</style></head>
<body><h2>${esc(title)}</h2>${body}</body></html>`);
	}

	/** Nhân viên của người dùng đăng nhập (Employee Center đăng nhập bằng bản ghi Employee). */
	function me() {
		const u = runtime.getCurrentUser();
		const id = u && Number(u.id) > 0 ? String(u.id) : null;
		if (!id) return null;
		const rows = Store.run("SELECT id FROM employee WHERE id = ?", [id], "s4vp_my_employee");
		return rows.length ? id : null;
	}

	/** Các dòng của tôi trên bảng lương đã ghi sổ. */
	function myLines(employee) {
		const lines = Store.find("batch_emp", { where: "{employee} = ?", params: [employee] });
		const batches = {};
		for (const b of Store.findIn("batch", "id", lines.map((l) => l.batch))) batches[b.id] = b;
		const periods = {};
		for (const p of Store.find("period", { includeInactive: true })) periods[p.id] = p;
		return lines
			.filter((l) => batches[l.batch] && batches[l.batch].status === "R")
			.map((l) => ({ line: l, batch: batches[l.batch], period: periods[batches[l.batch].period] || {} }))
			.sort((a, b) => String(b.period.end || "").localeCompare(String(a.period.end || "")));
	}

	function onRequest(context) {
		const p = context.request.parameters;
		const vi = !/^en/i.test(String(runtime.getCurrentUser().getPreference({ name: "LANGUAGE" }) || ""));
		const title = vi ? "Phiếu lương của tôi" : "My Payslips";
		const employee = me();
		if (!employee) return page(context.response, title, `<p>${vi ? "Tài khoản đăng nhập chưa gắn với nhân viên." : "Your user account is not linked to an employee."}</p>`);
		let mine;
		try {
			mine = myLines(employee);
		} catch (e) {
			log.error({ title: "s4vp_sl_my_payroll", details: String(e.message || e).slice(0, 300) });
			return page(context.response, title, `<p>${esc(e.message || e)}</p>`);
		}
		if (p.batch) {
			const hit = mine.find((m) => m.batch.id === String(p.batch));
			if (!hit) return page(context.response, title, `<p>${vi ? "Không tìm thấy phiếu lương đã ghi sổ của bạn trong bảng lương này." : "No released payslip of yours in this batch."}</p>`);
			const detail = Payroll.detail(hit.batch.id);
			// Chỉ giữ dòng của chính mình trước khi dựng mô hình in
			detail.lines = detail.lines.filter((l) => l.employee === employee);
			const settings = Settings.resolve(detail.batch.subsidiary, null);
			const lang = ["vi", "en", "bi"].includes(p.lang) ? p.lang : vi ? "vi" : "en";
			const model = PrintModel.payslips(detail, { lang, company: { name: "", address: "", taxId: "" }, signers: settings.signers, profiles: {}, employee });
			const renderer = render.create();
			renderer.templateContent = file.load({ id: "../templates/payslip.xml" }).getContents();
			renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: "data", data: model });
			const pdf = renderer.renderAsPdf();
			pdf.name = `PhieuLuong_${hit.batch.name}.pdf`;
			context.response.writeFile({ file: pdf, isInline: true });
			return;
		}
		const year = /^\d{4}$/.test(String(p.year || "")) ? String(p.year) : String(new Date().getFullYear());
		const rows = mine.filter((m) => String(m.batch.tax_month || m.period.tax_month || "").slice(0, 4) === year);
		const self = url.resolveScript({ scriptId: "customscript_s4vp_sl_my_payroll", deploymentId: "customdeploy_s4vp_sl_my_payroll" });
		const years = [...new Set(mine.map((m) => String(m.batch.tax_month || m.period.tax_month || "").slice(0, 4)).filter(Boolean))];
		if (!years.includes(year)) years.push(year);
		const head = vi ? ["Kỳ lương", "Bảng lương", "Tổng thu nhập", "Thuế TNCN", "Thực lĩnh", ""] : ["Pay period", "Batch", "Gross pay", "PIT", "Net pay", ""];
		const body = `<p>${years.sort().reverse().map((y) => (y === year ? `<b>${y}</b>` : `<a href="${self}&year=${y}">${y}</a>`)).join(" · ")}</p>
<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>
${rows.map((m) => `<tr><td>${esc(m.period.name)}</td><td>${esc(m.batch.name)}</td><td class="n">${money(m.line.gross)}</td><td class="n">${money(m.line.pit)}</td><td class="n"><b>${money(m.line.net)}</b></td><td><a href="${self}&batch=${encodeURIComponent(m.batch.id)}" target="_blank">${vi ? "In phiếu lương" : "Print payslip"}</a></td></tr>`).join("") || `<tr><td colspan="6">${vi ? "Chưa có phiếu lương đã ghi sổ trong năm." : "No released payslip in this year."}</td></tr>`}
</table><p style="color:#666;font-size:12px">${vi ? "Thông tin lương là bảo mật, không chia sẻ." : "Payroll information is confidential."}</p>`;
		page(context.response, title, body);
	}

	return { onRequest };
});
