/**
 * Mô hình in của bảng lương (đặc tả 4.7.1): VP641000 Phiếu lương, VP643000 Bảng thanh toán tiền lương, VP644000 Bảng
 * quyết toán chi phí CTV. Template Advanced PDF (BFO) không dùng điều kiện trên dữ liệu: mọi số, nhãn đã định dạng sẵn
 * thành chuỗi ở đây; phần có / không có là danh sách 0..n phần tử.
 *
 * Đầu vào: detail = Payroll.detail(batchId) {batch, lines[]}; opts = {lang 'vi'|'en'|'bi', company {name, address, taxId,
 * logoUrl}, signers {preparer, chiefAccountant, director}, profiles {employeeId: {taxCode, personalId}}, employee (lọc một người)}.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./VietnameseNumberReader"], (Money, Words) => {
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? 0 : Number(v));

	/** Số tiền: dấu chấm nghìn, số âm trong ngoặc, 0 hiện "-". */
	function money(v) {
		const n = Money.round(num(v));
		if (n === 0) return "-";
		const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
		return n < 0 ? `(${s})` : s;
	}

	/** Ngày công, giờ, đơn giá: tối đa 2 số lẻ, dấu phẩy thập phân, 0 hiện "-". */
	function qty(v) {
		const n = Money.roundTo(num(v), 2);
		if (n === 0) return "-";
		const [i, d] = String(Math.abs(n)).split(".");
		const s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (d ? `,${d}` : "");
		return n < 0 ? `-${s}` : s;
	}

	function vnDate(iso) {
		const s = String(iso || "");
		return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "";
	}

	function T(lang) {
		return (vi, en) => (lang === "en" ? en : lang === "bi" ? `${vi} / ${en}` : vi);
	}

	function periodLine(batch, lang) {
		const tm = String(batch.tax_month || "");
		const m = /^(\d{4})(\d{2})$/.exec(tm);
		if (!m) return T(lang)(`Kỳ lương ${batch.periodName || ""}`, `Pay period ${batch.periodName || ""}`);
		const vi = `Tháng ${Number(m[2])} năm ${m[1]}`;
		const en = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(m[2]) - 1]} ${m[1]}`;
		return T(lang)(vi, en);
	}

	function insAmount(line, codes, part) {
		return (line.insurance || []).filter((i) => codes.includes(norm(i.code))).reduce((s, i) => s + num(part === "ee" ? i.employeeAmount : part === "er" ? i.employerAmount : num(i.employeeAmount) + num(i.employerAmount)), 0);
	}

	/** BH bắt buộc phần NLĐ được trừ khi tính thuế (không gồm đoàn phí). */
	function compulsory(line) {
		return num(line.ee_ins) - insAmount(line, ["DOANPHI"], "ee");
	}

	function header(detail, opts, titleVi, titleEn) {
		const lang = opts.lang || "vi";
		const t = T(lang);
		const c = opts.company || {};
		const s = opts.signers || {};
		return {
			lang,
			companyName: c.name || "",
			companyLines: [c.address ? t(`Địa chỉ: ${c.address}`, `Address: ${c.address}`) : "", c.taxId ? t(`Mã số thuế: ${c.taxId}`, `Tax code: ${c.taxId}`) : ""].filter(Boolean),
			logos: c.logoUrl ? [{ url: c.logoUrl }] : [],
			title: t(titleVi, titleEn).toUpperCase(),
			periodLine: periodLine(detail.batch, lang),
			batchLine: t(`Bảng lương: ${detail.batch.name || ""}`, `Payroll batch: ${detail.batch.name || ""}`),
			currencyLine: t("Đơn vị tính: đồng", "Currency: VND"),
			signers: [
				{ title: t("Người lập biểu", "Prepared by"), name: s.preparer || "" },
				{ title: t("Kế toán trưởng", "Chief accountant"), name: s.chiefAccountant || "" },
				{ title: t("Giám đốc", "Director"), name: s.director || "" },
			],
			signNote: t("(Ký, họ tên)", "(Signature, full name)"),
		};
	}

	/** Lương hợp đồng (lịch sử lương hiệu lực cuối kỳ) do lớp in truyền qua profiles; thiếu thì lấy lương chính. */
	function contract(l, opts) {
		const p = (opts.profiles || {})[String(l.employee)] || {};
		return p.contractSalary !== undefined && p.contractSalary !== null ? num(p.contractSalary) : num(l.base_salary);
	}

	function filterLines(detail, type, opts) {
		return (detail.lines || [])
			.filter((l) => norm(l.employment_type || "E") === type)
			.filter((l) => !opts.employee || String(l.employee) === String(opts.employee))
			.sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));
	}

	/** VP641000 Phiếu lương: mỗi nhân viên E một trang. */
	function payslips(detail, opts = {}) {
		const h = header(detail, opts, "Phiếu lương", "Payslip");
		const t = T(h.lang);
		const pages = filterLines(detail, "E", opts).map((l) => {
			const earnings = (l.earnings || []).filter((e) => num(e.amount) !== 0).map((e, i) => ({ stt: String(i + 1), name: e.name || e.earningType, qty: qty(e.quantity), rate: money(e.rate), amount: money(e.amount) }));
			const ded = [];
			const add = (label, v) => num(v) !== 0 && ded.push({ label, amount: money(v) });
			add(t("BHXH (8%)", "Social insurance (8%)"), insAmount(l, ["BHXH_HT", "BHXH_OD", "BHTNLD"], "ee"));
			add(t("BHYT (1,5%)", "Health insurance (1.5%)"), insAmount(l, ["BHYT"], "ee"));
			add(t("BHTN (1%)", "Unemployment insurance (1%)"), insAmount(l, ["BHTN"], "ee"));
			add(t("Đoàn phí công đoàn", "Trade union fee"), insAmount(l, ["DOANPHI"], "ee"));
			add(t("Thuế TNCN", "Personal income tax"), l.pit);
			for (const d of l.deductions || []) add(d.name || d.code, d.amount);
			add(t("Cấn trừ tạm ứng", "Advance offset"), l.advance);
			const totalDed = num(l.gross) - num(l.net);
			return {
				info: [
					{ label: t("Mã nhân viên", "Employee ID"), value: l.code || "" },
					{ label: t("Họ và tên", "Full name"), value: l.name || "" },
					{ label: t("Bộ phận", "Department"), value: l.department || "" },
					{ label: t("Lương hợp đồng", "Contract salary"), value: money(contract(l, opts)) },
					{ label: t("Công chuẩn", "Standard days"), value: qty(l.std_days) },
					{ label: t("Công thực tế", "Actual days"), value: qty(l.work_days) },
					{ label: t("Số người phụ thuộc", "Dependents"), value: String(num(l.dependents)) },
					{ label: t("Lương đóng BH", "Insurance wage"), value: money(l.insurance_wage) },
				],
				earnings,
				gross: money(l.gross),
				deductions: ded,
				totalDeduction: money(totalDed),
				tax: [
					{ label: t("Thu nhập chịu thuế", "Taxable income"), value: money(l.taxable) },
					{ label: t("Giảm trừ gia cảnh", "Family deduction"), value: money(l.family_ded) },
					{ label: t("BH bắt buộc được trừ", "Deductible compulsory insurance"), value: money(compulsory(l)) },
					{ label: t("Giảm trừ khác", "Other deductions"), value: money(l.other_tax_ded) },
					{ label: t("Thu nhập tính thuế", "Assessable income"), value: money(l.assessable) },
				],
				net: money(l.net),
				netWords: Words.readAmount(num(l.net)),
			};
		});
		return Object.assign(h, {
			pages,
			labels: {
				a: t("A. THU NHẬP", "A. EARNINGS"), b: t("B. KHẤU TRỪ", "B. DEDUCTIONS"), c: t("C. THUẾ TNCN", "C. PERSONAL INCOME TAX"),
				stt: t("STT", "No."), item: t("Khoản", "Item"), qty: t("Số lượng", "Qty"), rate: t("Đơn giá", "Rate"), amount: t("Số tiền", "Amount"),
				gross: t("Tổng thu nhập", "Gross pay"), totalDeduction: t("Tổng khấu trừ", "Total deductions"), net: t("THỰC LĨNH", "NET PAY"), words: t("Bằng chữ", "In words"),
				confidential: t("Phiếu lương là thông tin bảo mật, không chia sẻ cho người khác.", "This payslip is confidential. Do not share it."),
			},
		});
	}

	/** VP643000 Bảng thanh toán tiền lương: nhân viên E, A4 ngang. */
	function paymentSheet(detail, opts = {}) {
		const h = header(detail, opts, "Bảng thanh toán tiền lương", "Payroll payment sheet");
		const t = T(h.lang);
		const keys = ["base", "leave", "benefit", "main", "gross", "exempt", "taxable", "deduct", "assessable", "pit", "si", "hi", "ui", "insTotal", "eeIns", "adjust", "net"];
		const sum = Object.fromEntries(keys.map((k) => [k, 0]));
		const rows = filterLines(detail, "E", opts).map((l, i) => {
			const v = {
				base: num(l.base_salary),
				leave: Math.max(0, num(l.std_days) - num(l.work_days)),
				benefit: num(l.benefit),
				main: num(l.base_salary),
				gross: num(l.gross),
				exempt: num(l.exempt),
				taxable: num(l.taxable),
				deduct: num(l.family_ded) + compulsory(l) + num(l.other_tax_ded),
				assessable: num(l.assessable),
				pit: num(l.pit),
				si: insAmount(l, ["BHXH_HT", "BHXH_OD", "BHTNLD"], "all"),
				hi: insAmount(l, ["BHYT"], "all"),
				ui: insAmount(l, ["BHTN"], "all"),
				eeIns: num(l.ee_ins),
				adjust: -(num(l.other_ded) + num(l.advance)),
				net: num(l.net),
			};
			v.insTotal = v.si + v.hi + v.ui;
			// "Lương HĐ" là mức lương hợp đồng; "Lương chính" là tổng dòng do quy tắc nguồn lương HĐ sinh (line.base_salary)
			v.base = contract(l, opts);
			for (const k of keys) sum[k] += v[k];
			const r = { stt: String(i + 1), code: l.code || "", name: l.name || "" };
			for (const k of keys) r[k] = k === "leave" ? qty(v[k]) : money(v[k]);
			return r;
		});
		const total = {};
		for (const k of keys) total[k] = k === "leave" ? qty(sum[k]) : money(sum[k]);
		return Object.assign(h, {
			rows,
			total,
			netWords: t(`Tổng thực lĩnh bằng chữ: ${Words.readAmount(sum.net)}`, `Total net pay in words: ${Words.readAmount(sum.net)}`),
			heads: {
				stt: t("STT", "No."), code: t("Mã NV", "ID"), name: t("Họ và tên", "Full name"), base: t("Lương HĐ", "Contract salary"), leave: t("Ngày nghỉ", "Days off"),
				benefit: t("Phụ cấp, phúc lợi", "Allowances"), main: t("Lương chính", "Basic pay"), gross: t("Tổng thu nhập", "Gross"), exempt: t("Miễn thuế", "Exempt"),
				taxable: t("Chịu thuế", "Taxable"), deduct: t("Giảm trừ", "Deductions"), assessable: t("Tính thuế", "Assessable"), pit: t("Thuế TNCN", "PIT"),
				si: t("BHXH-TNLĐ 25,5%", "SI-OA 25.5%"), hi: t("BHYT 4,5%", "HI 4.5%"), ui: t("BHTN 2%", "UI 2%"), insTotal: t("Tổng BH", "Total ins."),
				eeIns: t("BH NLĐ", "Employee ins."), adjust: t("Điều chỉnh", "Adjustments"), net: t("Thực lĩnh", "Net pay"), sign: t("Ký nhận", "Signature"),
				total: t("Tổng cộng", "Total"),
			},
		});
	}

	/** VP644000 Bảng quyết toán chi phí CTV: nhân viên C. */
	function contractorSettlement(detail, opts = {}) {
		const h = header(detail, opts, "Bảng quyết toán chi phí cộng tác viên", "Contractor fee settlement");
		const t = T(h.lang);
		const profiles = opts.profiles || {};
		const sum = { hours: 0, gross: 0, pit: 0, net: 0 };
		const rows = filterLines(detail, "C", opts).map((l, i) => {
			const fee = (l.earnings || []).filter((e) => num(e.amount) !== 0);
			const hours = fee.reduce((s, e) => s + num(e.quantity), 0);
			const rate = contract(l, opts);
			sum.hours += hours;
			sum.gross += num(l.gross);
			sum.pit += num(l.pit);
			sum.net += num(l.net);
			const p = profiles[String(l.employee)] || {};
			return { stt: String(i + 1), name: l.name || "", taxCode: p.taxCode || "", personalId: p.personalId || "", hours: qty(hours), rate: money(rate), gross: money(l.gross), pit: money(l.pit), net: money(l.net) };
		});
		const b = detail.batch || {};
		return Object.assign(h, {
			rows,
			total: { hours: qty(sum.hours), gross: money(sum.gross), pit: money(sum.pit), net: money(sum.net) },
			windowLine: t(`Kỳ thanh toán: ${b.periodName || ""} (${vnDate(b.periodStart)} - ${vnDate(b.periodEnd)})`, `Pay period: ${b.periodName || ""} (${vnDate(b.periodStart)} - ${vnDate(b.periodEnd)})`),
			netWords: t(`Tổng thực lĩnh bằng chữ: ${Words.readAmount(sum.net)}`, `Total net pay in words: ${Words.readAmount(sum.net)}`),
			heads: {
				stt: t("STT", "No."), name: t("Họ và tên", "Full name"), taxCode: t("Mã số thuế", "Tax code"), personalId: t("Số CCCD", "ID number"), hours: t("Số giờ", "Hours"),
				rate: t("Đơn giá", "Rate"), gross: t("Tổng thu nhập", "Gross"), pit: t("Thuế TNCN đã khấu trừ", "PIT withheld"), net: t("Thực lĩnh", "Net pay"),
				sign: t("Ký nhận", "Signature"), total: t("Tổng cộng", "Total"),
			},
		});
	}

	return { payslips, paymentSheet, contractorSettlement, money, qty, vnDate };
});
