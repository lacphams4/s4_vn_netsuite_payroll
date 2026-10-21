/**
 * In bảng lương PDF (đặc tả 4.7.1): VP641000 Phiếu lương, VP643000 Bảng thanh toán tiền lương, VP644000 Bảng quyết toán
 * chi phí CTV. Mô hình in dựng sẵn ở core/PrintModel, template FreeMarker trong templates/ không dùng điều kiện trên dữ liệu.
 * GET: batch (internal id), doc=payslip|payment|contractor, employee (tùy chọn, một người), lang=vi|en|bi,
 * format=xml trả XML đã điền thay cho PDF (gỡ lỗi). Chỉ role Administrator và hai role lương của gói.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(["N/file", "N/query", "N/render", "N/runtime", "N/log", "../api/Payroll", "../api/Settings", "../api/Store", "../core/PrintModel", "../core/Dates"], (
	file,
	query,
	render,
	runtime,
	log,
	Payroll,
	Settings,
	Store,
	PrintModel,
	Dates
) => {
	const ROLES = ["administrator", "customrole_s4vp_hr", "customrole_s4vp_accountant"];
	const DOCS = {
		payslip: { template: "../templates/payslip.xml", build: PrintModel.payslips, name: "PhieuLuong" },
		payment: { template: "../templates/payment_sheet.xml", build: PrintModel.paymentSheet, name: "BangThanhToanLuong" },
		contractor: { template: "../templates/contractor_settlement.xml", build: PrintModel.contractorSettlement, name: "QuyetToanCTV" },
	};

	function message(response, text) {
		response.write(`<html><body style="font-family:sans-serif;padding:24px"><h3>S4 VN Payroll</h3><p>${String(text).replace(/[<>&]/g, "")}</p></body></html>`);
	}

	function company(subsidiaryId) {
		try {
			const r =
				query
					.runSuiteQL({
						query: "SELECT NVL(s.legalname, s.name) AS name, BUILTIN.DF(s.mainaddress) AS address, s.federalidnumber AS taxid FROM subsidiary s WHERE s.id = ?",
						params: [subsidiaryId],
						customScriptId: "s4vp_print_company",
					})
					.asMappedResults()[0] || {};
			return { name: r.name || "", address: r.address ? String(r.address).replace(/\s*\n\s*/g, ", ") : "", taxId: r.taxid || "" };
		} catch (e) {
			return { name: "", address: "", taxId: "" };
		}
	}

	/** MST, CCCD, lương hợp đồng hiệu lực cuối kỳ của nhân viên trên bảng lương. */
	function profiles(lines, periodEnd) {
		const out = {};
		const profs = Store.findIn("employee", "employee", lines.map((l) => l.employee));
		const latest = {};
		for (const c of Store.findIn("compensation", "profile", profs.map((p) => p.id))) {
			if (!c.effective || (periodEnd && Dates.cmp(c.effective, periodEnd) > 0)) continue;
			if (!latest[c.profile] || Dates.cmp(c.effective, latest[c.profile].effective) > 0) latest[c.profile] = c;
		}
		for (const p of profs) {
			const c = latest[p.id];
			out[p.employee] = { taxCode: p.tax_code || "", personalId: p.personal_id || "", contractSalary: c ? c.base_salary : undefined };
		}
		return out;
	}

	function onRequest(context) {
		const p = context.request.parameters;
		if (!ROLES.includes(String(runtime.getCurrentUser().roleId || ""))) return message(context.response, "Không có quyền in bảng lương. / You are not allowed to print payroll documents.");
		const doc = DOCS[p.doc] || DOCS.payslip;
		const lang = ["vi", "en", "bi"].includes(p.lang) ? p.lang : "vi";
		let model;
		let detail;
		try {
			detail = Payroll.detail(p.batch);
			const settings = Settings.resolve(detail.batch.subsidiary, null);
			model = doc.build(detail, {
				lang,
				company: company(detail.batch.subsidiary),
				signers: settings.signers,
				profiles: profiles(detail.lines, detail.batch.periodEnd),
				employee: p.employee || null,
			});
		} catch (e) {
			log.error({ title: "s4vp_sl_print", details: String(e.message || e).slice(0, 300) });
			return message(context.response, e.message || e);
		}
		const renderer = render.create();
		renderer.templateContent = file.load({ id: doc.template }).getContents();
		renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: "data", data: model });
		if (p.format === "xml") {
			context.response.setHeader({ name: "Content-Type", value: "text/plain; charset=utf-8" });
			context.response.write(renderer.renderAsString());
			return;
		}
		const pdf = renderer.renderAsPdf();
		pdf.name = `${doc.name}_${detail.batch.name || p.batch}.pdf`;
		context.response.writeFile({ file: pdf, isInline: true });
	}

	return { onRequest };
});
