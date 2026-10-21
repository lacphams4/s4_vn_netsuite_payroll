/**
 * Báo cáo, tờ khai lương (đặc tả 4.7.2 - 4.7.5): BH phải nộp và D02-LT (VP402000), 05/KK-TNCN quý (VP403000),
 * quyết toán TNCN năm 05-1/BK, 05-2/BK (VP404000), chi phí nhân sự theo tài khoản so với bút toán (VP405000).
 *
 * Nguồn: dòng nhân viên của các bảng lương đã tính, không đảo, cùng công ty con; tùy chọn chỉ bảng đã ghi sổ.
 * Kỳ quy về tháng tính thuế (TaxMonth, trống thì mã kỳ yyyyMM). Module chỉ đọc record rồi gọi core/ReportData.
 * Dữ liệu lương nhạy cảm: không ghi số tiền, số định danh vào log.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Settings", "../core/ReportData", "../core/PayrollReports"], (Store, Settings, ReportData, PayrollReports) => {
	const blank = (v) => v === null || v === undefined || v === "";

	function employeeInfo(ids) {
		const out = {};
		const list = [...new Set(ids.filter((x) => !blank(x)).map(String))];
		for (let i = 0; i < list.length; i += 900) {
			const chunk = list.slice(i, i + 900);
			const rows = Store.run(`SELECT e.id, e.entityid, e.firstname, e.lastname FROM employee e WHERE e.id IN (${chunk.map(() => "?").join(",")})`, chunk, "s4vp_rpt_emp");
			for (const r of rows) out[String(r.id)] = { code: r.entityid, name: [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || r.entityid };
		}
		return out;
	}

	/**
	 * Bảng lương dùng được của công ty con, kèm tháng tính thuế đã chuẩn hóa.
	 * @param {string} subsidiary
	 * @param {(taxMonth: string) => boolean} monthFilter
	 * @param {{releasedOnly?: boolean}} opt
	 */
	function batchesFor(subsidiary, monthFilter, opt) {
		const periods = {};
		for (const p of Store.find("period", { includeInactive: true })) periods[p.id] = p.name;
		const all = Store.find("batch").filter((b) => !subsidiary || b.subsidiary === String(subsidiary));
		return ReportData.usableBatches(all, opt)
			.map((b) => Object.assign({}, b, { periodName: periods[b.period] || "", tax_month: PayrollReports.taxMonthOf({ taxMonth: b.tax_month, periodId: periods[b.period] || "" }) }))
			.filter((b) => monthFilter(b.tax_month));
	}

	/** Dòng nguồn + hồ sơ + lịch sử lương của các bảng lương. */
	function load(batches) {
		const lines = batches.length ? Store.findIn("batch_emp", "batch", batches.map((b) => b.id)) : [];
		const empIds = [...new Set(lines.map((l) => l.employee))];
		const profiles = {};
		for (const p of empIds.length ? Store.findIn("employee", "employee", empIds) : []) profiles[p.employee] = p;
		const rows = ReportData.sourceRows(batches, lines, profiles, employeeInfo(empIds));
		return { rows, profiles, lines };
	}

	function compensationsByEmployee(profiles) {
		const byProfile = {};
		const ids = Object.values(profiles).map((p) => p.id);
		for (const c of ids.length ? Store.findIn("compensation", "profile", ids) : []) (byProfile[c.profile] = byProfile[c.profile] || []).push(c);
		const out = {};
		for (const [emp, p] of Object.entries(profiles)) out[emp] = byProfile[p.id] || [];
		return out;
	}

	function d02Profiles(profiles, comps, taxMonth) {
		const end = ReportData.monthEnd(taxMonth);
		const out = {};
		for (const [emp, p] of Object.entries(profiles)) {
			out[emp] = {
				insuranceApplicable: p.ins_applicable !== false, employmentType: p.employment_type || "E", hireDate: p.hire_date || null,
				terminationDate: p.termination_date || null, wageEffectiveDate: ReportData.wageEffective(comps[emp], end),
			};
		}
		return out;
	}

	/**
	 * VP402000 BH phải nộp tháng và D02-LT.
	 * @param {{subsidiary, taxMonth: 'yyyyMM', c12?: number, releasedOnly?: boolean}} p
	 */
	function insurance(p) {
		const tm = String(p.taxMonth || "");
		if (!/^\d{6}$/.test(tm)) throw new Error("Tax month must be yyyyMM / Tháng tính thuế phải dạng yyyyMM");
		const prev = ReportData.prevMonth(tm);
		const opt = { releasedOnly: !!p.releasedOnly };
		const cur = load(batchesFor(p.subsidiary, (m) => m === tm, opt));
		const prevBatches = batchesFor(p.subsidiary, (m) => m === prev, opt);
		const old = prevBatches.length ? load(prevBatches) : null;
		const allProfiles = Object.assign({}, old ? old.profiles : {}, cur.profiles);
		const comps = compensationsByEmployee(allProfiles);
		return ReportData.insuranceReport(cur.rows, old ? old.rows : null, d02Profiles(allProfiles, comps, tm), d02Profiles(allProfiles, comps, prev), tm, p.c12);
	}

	/** VP403000 05/KK-TNCN quý. */
	function pitQuarter(p) {
		const year = Number(p.year);
		const quarter = Number(p.quarter);
		if (!(year >= 2000) || !(quarter >= 1 && quarter <= 4)) throw new Error("Year and quarter are required / Thiếu năm hoặc quý");
		const src = load(batchesFor(p.subsidiary, (m) => Number(m.slice(0, 4)) === year && PayrollReports.quarterOf(m) === quarter, { releasedOnly: !!p.releasedOnly }));
		return ReportData.pitQuarterReport(src.rows, year, quarter);
	}

	/** VP404000 dữ liệu quyết toán năm; schedule '05-1' | '05-2' | ''. */
	function pitAnnual(p) {
		const year = Number(p.year);
		if (!(year >= 2000)) throw new Error("Year is required / Thiếu năm");
		const src = load(batchesFor(p.subsidiary, (m) => Number(m.slice(0, 4)) === year, { releasedOnly: !!p.releasedOnly }));
		return ReportData.pitAnnualReport(src.rows, year, p.schedule || "");
	}

	/** Phát sinh trên bút toán ghi sổ của bảng lương; lỗi truy vấn thì null kèm thông báo. */
	function journalLines(journalIds) {
		const ids = journalIds.filter((x) => !blank(x)).map(String);
		if (!ids.length) return { lines: [], error: null };
		try {
			const rows = Store.run(
				`SELECT tl.transaction, tl.expenseaccount AS account, tl.debitforeignamount AS debit, tl.creditforeignamount AS credit
				 FROM transactionline tl WHERE tl.transaction IN (${ids.map(() => "?").join(",")}) AND tl.expenseaccount IS NOT NULL`,
				ids,
				"s4vp_rpt_gl"
			);
			return { lines: rows.map((r) => ({ account: String(r.account), debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 })), error: null };
		} catch (e) {
			return { lines: null, error: String(e.message || e) };
		}
	}

	function accountsRef(ids) {
		const list = [...new Set(ids.filter((x) => !blank(x)).map(String))];
		const out = {};
		if (!list.length) return out;
		for (const a of Store.run(`SELECT a.id, a.acctnumber, a.accountsearchdisplaynamecopy AS name FROM account a WHERE a.id IN (${list.map(() => "?").join(",")})`, list, "s4vp_rpt_acc")) {
			out[String(a.id)] = { number: a.acctnumber || "", name: a.name || "" };
		}
		return out;
	}

	function departmentsRef(ids) {
		const list = [...new Set(ids.filter((x) => !blank(x)).map(String))];
		const out = {};
		if (!list.length) return out;
		try {
			for (const d of Store.run(`SELECT d.id, d.name FROM department d WHERE d.id IN (${list.map(() => "?").join(",")})`, list, "s4vp_rpt_dept")) out[String(d.id)] = d.name;
		} catch (e) {
			// Account không bật phòng ban
		}
		return out;
	}

	/** VP405000 chi phí nhân sự theo tài khoản so với bút toán ghi sổ (bảng đã ghi sổ của tháng). */
	function costByAccount(p) {
		const tm = String(p.taxMonth || "");
		if (!/^\d{6}$/.test(tm)) throw new Error("Tax month must be yyyyMM / Tháng tính thuế phải dạng yyyyMM");
		const batches = batchesFor(p.subsidiary, (m) => m === tm, { releasedOnly: p.releasedOnly !== false });
		const src = load(batches);
		const gl = journalLines(batches.filter((b) => b.status === "R").map((b) => b.journal));
		let defaultExpenseAccount = "";
		try {
			defaultExpenseAccount = Settings.resolve(p.subsidiary, null).accounts.acc_expense || "";
		} catch (e) {
			defaultExpenseAccount = "";
		}
		const accIds = [defaultExpenseAccount];
		const deptIds = [];
		for (const r of src.rows) {
			accIds.push(r.expenseAccount);
			for (const a of r.allocations) {
				accIds.push(a.account);
				deptIds.push(a.sub);
			}
		}
		for (const l of gl.lines || []) accIds.push(l.account);
		const report = ReportData.costReport(src.rows, gl.lines, { defaultExpenseAccount, accounts: accountsRef(accIds), departments: departmentsRef(deptIds) });
		if (gl.error) report.warnings.push({ code: "GL_QUERY", vi: `Không đọc được bút toán để so sánh: ${gl.error}`, en: `Journal lines could not be read: ${gl.error}` });
		report.taxMonth = tm;
		return report;
	}

	/** Chọn báo cáo theo tham số RESTlet type=insurance|pitq|pita|cost. */
	function run(params) {
		const p = Object.assign({}, params, { releasedOnly: params.releasedOnly === "T" || params.releasedOnly === true });
		switch (params.type) {
			case "insurance":
				return insurance(Object.assign(p, { c12: blank(params.c12) ? null : Number(params.c12) }));
			case "pitq":
				return pitQuarter(p);
			case "pita":
				return pitAnnual(p);
			case "cost":
				return costByAccount(Object.assign(p, { releasedOnly: params.releasedOnly !== "F" }));
			default:
				throw new Error(`Unknown report ${params.type} / Báo cáo không hợp lệ`);
		}
	}

	return { insurance, pitQuarter, pitAnnual, costByAccount, run, toCsv: ReportData.toCsv };
});
