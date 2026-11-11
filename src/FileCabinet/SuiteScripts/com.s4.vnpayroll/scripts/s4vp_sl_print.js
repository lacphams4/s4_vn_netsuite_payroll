/**
 * In bảng lương PDF (đặc tả 4.7.1): VP641000 Phiếu lương, VP643000 Bảng thanh toán tiền lương, VP644000 Bảng quyết toán
 * chi phí CTV. Mô hình in dựng sẵn ở core/PrintModel, template FreeMarker trong templates/ không dùng điều kiện trên dữ liệu.
 * GET: batch (internal id), doc=payslip|payment|contractor, employee (tùy chọn, một người), lang=vi|en|bi,
 * format=xml trả XML đã điền thay cho PDF (gỡ lỗi). Chỉ role Administrator và hai role lương của gói.
 *
 * Bản in bổ sung (mô hình core/PrintModelExtra, dữ liệu api/PrintData; cùng lang, format):
 *   doc=timesheet            Bảng chấm công tháng (VP642000), A4 ngang: period (hoặc batch), subsidiary, department (id bộ
 *                            phận, gồm bộ phận con), page (phần thứ n khi quá TIMESHEET_MAX_ROWS nhân viên). Không có số tiền.
 *   doc=contractorStatement  Bảng kê xác nhận thù lao CTV (VP644100 / 644110 / 644010), mỗi người một trang: batch, employee.
 *   doc=teamSplit            Bảng chia lương tổ (VP645000 / 645010): output (id phiếu sản lượng).
 *   doc=commission           Bảng hoa hồng (VP646000): batch, employee (tùy chọn).
 *   doc=contract | decision  Phiếu thông tin hợp đồng lao động / phụ lục, quyết định nhân sự (VP647000 - 647020): id. Không phải
 *                            mẫu văn bản pháp lý; mức lương chỉ in cho vai trò được xem lương.
 * Bản có số tiền lương (pay: true) chỉ cho PAY_ROLES; không ghi số tiền, số định danh vào log.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(["N/file", "N/query", "N/render", "N/runtime", "N/log", "../api/Payroll", "../api/Settings", "../api/Store", "../core/PrintModel", "../core/Dates", "../api/PrintData", "../core/PrintModelExtra"], (
	file,
	query,
	render,
	runtime,
	log,
	Payroll,
	Settings,
	Store,
	PrintModel,
	Dates,
	PrintData,
	Extra
) => {
	const ROLES = ["administrator", "customrole_s4vp_hr", "customrole_s4vp_accountant"];
	// Vai trò được xem số tiền lương (cùng danh sách với api/HrCore.PAY_ROLES). Hiện trùng ROLES; tách riêng để khi mở bản in
	// không có số tiền cho vai trò khác thì bản có lương vẫn bị chặn.
	const PAY_ROLES = ["administrator", "customrole_s4vp_hr", "customrole_s4vp_accountant"];
	// Bảng chấm công: tối đa số nhân viên trong một file PDF (khoảng 20 trang A4 ngang, mỗi dòng 31 ô ngày). Nhiều hơn thì in
	// từng phần (tham số page) hoặc lọc theo bộ phận: dựng PDF vài chục nghìn ô dễ vượt thời gian chạy của Suitelet.
	const TIMESHEET_MAX_ROWS = 500;
	const DOCS = {
		payslip: { template: "../templates/payslip.xml", build: PrintModel.payslips, name: "PhieuLuong", pay: true },
		payment: { template: "../templates/payment_sheet.xml", build: PrintModel.paymentSheet, name: "BangThanhToanLuong", pay: true },
		contractor: { template: "../templates/contractor_settlement.xml", build: PrintModel.contractorSettlement, name: "QuyetToanCTV", pay: true },
		timesheet: { template: "../templates/timesheet.xml", load: loadTimesheet, name: "BangChamCong", pay: false },
		contractorStatement: { template: "../templates/contractor_statement.xml", load: loadContractorStatement, name: "BangKeThuLaoCTV", pay: true },
		teamSplit: { template: "../templates/team_split.xml", load: loadTeamSplit, name: "BangChiaLuongTo", pay: true },
		commission: { template: "../templates/commission.xml", load: loadCommission, name: "BangHoaHong", pay: true },
		contract: { template: "../templates/info_sheet.xml", load: loadContract, name: "PhieuHopDong", pay: false },
		decision: { template: "../templates/info_sheet.xml", load: loadDecision, name: "PhieuQuyetDinh", pay: false },
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
			out[p.employee] = { taxCode: p.tax_code || "", personalId: p.personal_id || "", contractSalary: c ? c.base_salary : undefined, salesTarget: p.sales_target || 0 };
		}
		return out;
	}

	// ------------------------------------------------------------------ bản in bổ sung: mỗi hàm trả {model, key}

	function loadTimesheet(p, ctx) {
		const d = PrintData.timesheet(p);
		const subsidiary = d.subsidiary || String(runtime.getCurrentUser().subsidiary || "");
		const model = Extra.timesheet(d.grid, { lang: ctx.lang, company: company(subsidiary), department: d.department, maxRows: TIMESHEET_MAX_ROWS, part: p.page });
		return { model, key: `${d.grid.period.code || ""}${model.parts > 1 ? `_${model.part}` : ""}` };
	}

	function loadContractorStatement(p, ctx) {
		const d = PrintData.contractorStatement(p.batch, p.employee || null);
		const batch = d.detail.batch;
		const model = Extra.contractorStatement(d.detail, {
			lang: ctx.lang, company: company(batch.subsidiary), signers: d.settings.signers, profiles: profiles(d.detail.lines.filter((l) => l.employment_type === "C"), batch.periodEnd),
			employee: p.employee || null, entries: d.entries, window: d.window,
		});
		return { model, key: batch.name || p.batch };
	}

	function loadTeamSplit(p, ctx) {
		const d = PrintData.teamSplit(p.output);
		const settings = Settings.resolve(d.entry.subsidiary, null);
		return { model: Extra.teamSplit(d, { lang: ctx.lang, company: company(d.entry.subsidiary), signers: settings.signers }), key: d.entry.name || p.output };
	}

	function loadCommission(p, ctx) {
		const d = PrintData.commission(p.batch);
		const batch = d.detail.batch;
		const settings = Settings.resolve(batch.subsidiary, null);
		const model = Extra.commission(d.detail, {
			lang: ctx.lang, company: company(batch.subsidiary), signers: settings.signers, rules: d.rules, profiles: profiles(d.detail.lines, batch.periodEnd), employee: p.employee || null,
		});
		return { model, key: batch.name || p.batch };
	}

	function loadContract(p, ctx) {
		const d = PrintData.contract(p.id);
		return { model: Extra.contractSheet(d, { lang: ctx.lang, company: company(d.employee.subsidiary), showPay: ctx.showPay, today: d.today }), key: d.record.number || p.id };
	}

	function loadDecision(p, ctx) {
		const d = PrintData.decision(p.id);
		return { model: Extra.decisionSheet(d, { lang: ctx.lang, company: company(d.employee.subsidiary), showPay: ctx.showPay, today: d.today }), key: d.record.number || p.id };
	}

	function onRequest(context) {
		const p = context.request.parameters;
		const role = String(runtime.getCurrentUser().roleId || "");
		if (!ROLES.includes(role)) return message(context.response, "Không có quyền in bảng lương. / You are not allowed to print payroll documents.");
		const doc = DOCS[p.doc] || DOCS.payslip;
		const showPay = PAY_ROLES.includes(role);
		if (doc.pay && !showPay) return message(context.response, "Vai trò này không được xem số tiền lương. / This role is not allowed to view pay amounts.");
		const lang = ["vi", "en", "bi"].includes(p.lang) ? p.lang : "vi";
		let model;
		let key;
		try {
			if (doc.load) {
				const loaded = doc.load(p, { lang, showPay });
				model = loaded.model;
				key = loaded.key;
			} else {
				const detail = Payroll.detail(p.batch);
				const settings = Settings.resolve(detail.batch.subsidiary, null);
				model = doc.build(detail, {
					lang,
					company: company(detail.batch.subsidiary),
					signers: settings.signers,
					profiles: profiles(detail.lines, detail.batch.periodEnd),
					employee: p.employee || null,
				});
				key = detail.batch.name || p.batch;
			}
		} catch (e) {
			log.error({ title: "s4vp_sl_print", details: `${p.doc || "payslip"}: ${String(e.message || e).slice(0, 300)}` });
			return message(context.response, e.message || e);
		}
		if (model.count === 0) return message(context.response, "Không có dữ liệu để in. / There is nothing to print.");
		const renderer = render.create();
		renderer.templateContent = file.load({ id: doc.template }).getContents();
		renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: "data", data: model });
		if (p.format === "xml") {
			context.response.setHeader({ name: "Content-Type", value: "text/plain; charset=utf-8" });
			context.response.write(renderer.renderAsString());
			return;
		}
		const pdf = renderer.renderAsPdf();
		pdf.name = `${doc.name}_${String(key || "").replace(/[^\w.-]+/g, "_")}.pdf`;
		context.response.writeFile({ file: pdf, isInline: true });
	}

	return { onRequest };
});
