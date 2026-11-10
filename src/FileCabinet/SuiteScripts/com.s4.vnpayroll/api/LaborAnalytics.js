/**
 * Phân tích chi phí lương (docs/UI_V2.md mục 13): chi phí lương theo chiều hạch toán, so với doanh thu, giá vốn, lãi lỗ.
 * Mô-đun route của giao diện bản 2 (mục 5).
 *
 * Nguồn số liệu:
 * - Bảng số liệu cost_fact (tiền tố lcf) do gói ghi khi ghi sổ bảng lương (refreshFacts, gọi từ api/Payroll.release / reverse)
 *   và lập lại bằng rebuildLaborFacts. Dòng dựng bởi core/LaborCostFacts; tổng dòng còn hiệu lực của một bảng lương = tổng Nợ
 *   chi phí của bút toán ghi sổ. Không xóa dòng: đảo bảng lương hoặc lập lại thì bỏ cờ còn hiệu lực / cập nhật tại chỗ.
 * - laborAnalytics chỉ chạy truy vấn gom nhóm (GROUP BY ở cơ sở dữ liệu, nhãn chiều lấy bằng JOIN), số truy vấn không phụ thuộc
 *   số nhân viên. Số người lấy từ batch_emp (COUNT DISTINCT). laborDrill mới đọc chi tiết dòng bảng lương của tháng.
 * - Sổ cái: transactionaccountingline theo công ty con và kỳ kế toán, gom theo loại tài khoản. Vai trò không đọc được thì
 *   notes có NO_GL_ACCESS, các trường sổ cái = null, phần lương vẫn đủ.
 *
 * Quy ước trả về: tháng dạng 'YYYY-MM'; tỷ lệ là phân số (0,153 = 15,3%), null khi mẫu số bằng 0 hoặc thiếu số liệu.
 * Dữ liệu lương nhạy cảm: không ghi số tiền, số định danh vào log.
 *
 * Route (roles "acct"): GET laborAnalytics, GET laborDrill, POST rebuildLaborFacts.
 * Hàm máy chủ cho phân hệ khác: refreshFacts(batchId) -> {ok, ...} (không ném lỗi).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "N/cache", "./Store", "./Settings", "./Clock", "../core/LaborCostFacts", "../core/LaborVariance"], (runtime, log, cache, Store, Settings, Clock, Facts, Variance) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const num = (v) => {
		const n = Number(v);
		return blank(v) || !isFinite(n) ? 0 : n;
	};
	const str = (v) => (blank(v) ? "" : String(v));
	const COMPONENTS = Facts.COMPONENTS;
	const DIM_FIELDS = { department: "department", project: "project", class: "class", location: "location", account: "account", component: "component", employmentType: "employment_type" };
	const DIM_PROPS = { department: "department", project: "project", class: "class", location: "location", account: "account", component: "component", employmentType: "employmentType" };
	const DIMS = Object.keys(DIM_FIELDS);
	const MIN_USAGE = 400;
	const MAX_MS = 40000;

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	// ------------------------------------------------------------------ tháng

	/** 'YYYY-MM' hoặc 'YYYYMM' -> 'YYYYMM'; không hợp lệ thì ''. */
	function ym(s) {
		const m = /^(\d{4})-?(\d{2})$/.exec(str(s).trim());
		return m && +m[2] >= 1 && +m[2] <= 12 ? m[1] + m[2] : "";
	}

	const show = (m) => (m ? `${m.slice(0, 4)}-${m.slice(4, 6)}` : "");

	function addMonths(m, n) {
		const t = +m.slice(0, 4) * 12 + (+m.slice(4, 6) - 1) + n;
		return `${String(Math.floor(t / 12)).padStart(4, "0")}${String((t % 12) + 1).padStart(2, "0")}`;
	}

	const firstDay = (m) => `${m.slice(0, 4)}-${m.slice(4, 6)}-01`;

	// ------------------------------------------------------------------ tên bảng, cột

	const tbl = (name) => Store.rec(name).type;
	const col = (name, field) => Store.rec(name).fields[field].id;
	const fc = (field) => `f.${col("cost_fact", field)}`;
	const activeFact = () => `${fc("active")} = 'T' AND f.isinactive = 'F'`;
	/** Tháng kế toán của bảng lương = tháng của ngày bút toán (ngày chứng từ, trống thì ngày cuối kỳ). */
	const batchMonth = () => `TO_CHAR(COALESCE(b.${col("batch", "doc_date")}, p.${col("period", "end")}), 'YYYYMM')`;

	/** Loại tài khoản NetSuite -> nhóm lãi lỗ; chịu được cả mã ('COGS', 'OthIncome') lẫn tên ('Cost of Goods Sold', 'Other Income'). */
	function accountClass(accttype) {
		const t = str(accttype).toLowerCase().replace(/[^a-z]/g, "");
		if (t === "cogs" || t === "costofgoodssold") return "cogs";
		if (t === "income" || t === "othincome" || t === "otherincome") return "revenue";
		if (t === "expense" || t === "othexpense" || t === "otherexpense") return "opex";
		return "";
	}

	const componentCode = (id) => Store.codeOf("lcf_component", id) || "other";
	const typeCode = (id) => Store.codeOf("employment_type", id) || "E";

	// ------------------------------------------------------------------ ghi số liệu

	/** Còn hạn mức để ghi tiếp: governance từ 400 trở lên và chưa quá 40 giây. */
	function guardOf(started) {
		let script = null;
		try {
			script = runtime.getCurrentScript();
		} catch (e) {
			script = null;
		}
		const t0 = started || Date.now();
		return () => {
			if (Date.now() - t0 > MAX_MS) return false;
			try {
				return !script || script.getRemainingUsage() >= MIN_USAGE;
			} catch (e) {
				return true;
			}
		};
	}

	/** Tùy chọn dựng số liệu của một bảng lương: loại thu nhập, tài khoản chi phí và địa điểm mặc định, ngày bút toán. */
	function factContext(batch, shared) {
		const memo = shared || {};
		const period = batch.period ? Store.get("period", batch.period) : null;
		const group = period && period.paygroup ? Store.get("paygroup", period.paygroup) : null;
		const settings = Settings.resolve(batch.subsidiary, group);
		if (!memo.earningTypes) memo.earningTypes = Settings.earningTypes().byCode;
		const date = batch.doc_date || (period && period.end) || "";
		return {
			date, month: Facts.monthOf(date),
			options: { earningTypes: memo.earningTypes, defaultExpenseAccount: (settings.accounts || {}).acc_expense || "", defaultLocation: settings.location || "" },
		};
	}

	const isPosted = (batch) => batch.status === "R" && !blank(batch.journal);

	/**
	 * Đồng bộ dòng số liệu của một bảng lương với dữ liệu hiện tại: bảng đã ghi sổ thì dựng lại từ dòng nhân viên, bảng đã đảo /
	 * chưa ghi sổ thì bỏ hiệu lực mọi dòng. Chạy lại được; dừng giữa chừng khi hết hạn mức (complete = false).
	 */
	function syncFacts(batch, guard, shared) {
		const existing = Store.find("cost_fact", { where: "{batch} = ?", params: [batch.id] });
		let facts = [];
		let header = { batch: batch.id, subsidiary: batch.subsidiary, month: "", postingDate: "" };
		let check = null;
		if (isPosted(batch)) {
			const ctx = factContext(batch, shared);
			const lines = Store.find("batch_emp", { where: "{batch} = ?", params: [batch.id] });
			const built = Facts.build(lines, ctx.options);
			facts = built.facts;
			check = built.check;
			header = { batch: batch.id, subsidiary: batch.subsidiary, month: ctx.month, postingDate: ctx.date };
		}
		const plan = Facts.plan(existing, facts, header);
		const out = { complete: true, rows: facts.length, created: 0, updated: 0, deactivated: 0, unchanged: plan.unchanged, balanced: check ? check.ok : true };
		// Dòng cũ hết hiệu lực trước, rồi cập nhật tại chỗ, rồi tạo mới
		for (const id of plan.deactivate) {
			if (!guard()) return Object.assign(out, { complete: false });
			Store.submit("cost_fact", id, { active: false });
			out.deactivated++;
		}
		for (const u of plan.update) {
			if (!guard()) return Object.assign(out, { complete: false });
			Store.submit("cost_fact", u.id, u.values);
			out.updated++;
		}
		for (const values of plan.create) {
			if (!guard()) return Object.assign(out, { complete: false });
			Store.create("cost_fact", values);
			out.created++;
		}
		return out;
	}

	/**
	 * Lập (hoặc bỏ hiệu lực) số liệu của một bảng lương ngay sau khi ghi sổ / đảo. Không ném lỗi: lỗi chỉ ghi log (không có số
	 * tiền) và trả ok = false để nơi gọi gắn notes FACTS_OUTDATED; rebuildLaborFacts sẽ lập lại sau.
	 * @returns {{ok: boolean, rows?: number}}
	 */
	function refreshFacts(batchId) {
		try {
			const batch = Store.get("batch", batchId);
			if (!batch) return { ok: false };
			const r = syncFacts(batch, guardOf());
			return { ok: r.complete && r.balanced, rows: r.rows };
		} catch (e) {
			try {
				log.error({ title: "s4vp labor facts", details: `batch ${batchId}: ${String((e && (e.name || e.message)) || e).replace(/\d/g, "#").slice(0, 200)}` });
			} catch (e2) {
				// không ghi được log
			}
			return { ok: false };
		}
	}

	// ------------------------------------------------------------------ truy vấn gom nhóm

	/** Chi phí theo tháng x thành phần x loại tài khoản. */
	function queryMonthly(sub, from, to) {
		return Store.run(
			`SELECT ${fc("month")} AS month, ${fc("component")} AS component, a.accttype AS accttype, SUM(${fc("amount")}) AS amount, SUM(${fc("hours")}) AS hours
			 FROM ${tbl("cost_fact")} f LEFT JOIN account a ON a.id = ${fc("account")}
			 WHERE ${fc("subsidiary")} = ? AND ${activeFact()} AND ${fc("month")} >= ? AND ${fc("month")} <= ?
			 GROUP BY ${fc("month")}, ${fc("component")}, a.accttype`,
			[sub, from, to], "s4vp_la_monthly");
	}

	/** Số người theo tháng x loại lao động, từ dòng nhân viên của bảng lương đã ghi sổ. */
	function queryHeadcount(sub, from, to) {
		const month = batchMonth();
		return Store.run(
			`SELECT ${month} AS month, be.${col("batch_emp", "employment_type")} AS etype, COUNT(DISTINCT be.${col("batch_emp", "employee")}) AS headcount
			 FROM ${tbl("batch_emp")} be
			 INNER JOIN ${tbl("batch")} b ON b.id = be.${col("batch_emp", "batch")}
			 INNER JOIN ${tbl("period")} p ON p.id = b.${col("batch", "period")}
			 WHERE b.${col("batch", "subsidiary")} = ? AND b.${col("batch", "status")} = ? AND b.${col("batch", "journal")} IS NOT NULL
			   AND be.isinactive = 'F' AND b.isinactive = 'F' AND ${month} >= ? AND ${month} <= ?
			 GROUP BY ${month}, be.${col("batch_emp", "employment_type")}`,
			[sub, Store.idOf("batch_status", "R"), from, to], "s4vp_la_headcount");
	}

	/** Số nhân viên (không tính cộng tác viên) theo tháng x phòng ban (phòng ban của hồ sơ lương, trống thì của nhân viên). */
	function queryDepartmentHeadcount(sub, months) {
		const month = batchMonth();
		const dept = `COALESCE(pr.${col("employee", "department")}, e.department)`;
		const etype = `be.${col("batch_emp", "employment_type")}`;
		return Store.run(
			`SELECT ${month} AS month, ${dept} AS k, COUNT(DISTINCT be.${col("batch_emp", "employee")}) AS headcount
			 FROM ${tbl("batch_emp")} be
			 INNER JOIN ${tbl("batch")} b ON b.id = be.${col("batch_emp", "batch")}
			 INNER JOIN ${tbl("period")} p ON p.id = b.${col("batch", "period")}
			 LEFT JOIN ${tbl("employee")} pr ON pr.id = be.${col("batch_emp", "profile")}
			 LEFT JOIN employee e ON e.id = be.${col("batch_emp", "employee")}
			 WHERE b.${col("batch", "subsidiary")} = ? AND b.${col("batch", "status")} = ? AND b.${col("batch", "journal")} IS NOT NULL
			   AND be.isinactive = 'F' AND b.isinactive = 'F' AND (${etype} IS NULL OR ${etype} <> ?) AND ${month} IN (${months.map(() => "?").join(",")})
			 GROUP BY ${month}, ${dept}`,
			[sub, Store.idOf("batch_status", "R"), Store.idOf("employment_type", "C")].concat(months), "s4vp_la_dept_headcount");
	}

	// Bảng nhãn của từng chiều: [bảng, cột chọn (kèm alias), cột GROUP BY]
	const LABELS = {
		department: ["department", "d.fullname AS label", "d.fullname"],
		class: ["classification", "d.fullname AS label", "d.fullname"],
		location: ["location", "d.fullname AS label", "d.fullname"],
		project: ["job", "d.entityid AS code, d.companyname AS label", "d.entityid, d.companyname"],
		account: ["account", "d.acctnumber AS code, d.accountsearchdisplaynamecopy AS label, d.accttype AS accttype", "d.acctnumber, d.accountsearchdisplaynamecopy, d.accttype"],
	};

	/** Chi phí theo tháng x giá trị chiều x thành phần, nhãn chiều bằng JOIN (JOIN lỗi thì dùng BUILTIN.DF trên dòng đã gom). */
	function queryBreakdown(sub, dim, months) {
		const field = fc(DIM_FIELDS[dim]);
		const where = `${fc("subsidiary")} = ? AND ${activeFact()} AND ${fc("month")} IN (${months.map(() => "?").join(",")})`;
		const params = [sub].concat(months);
		const lab = LABELS[dim];
		if (!lab) {
			const sel = dim === "component" ? "" : `${field} AS k, `;
			const grp = dim === "component" ? "" : `, ${field}`;
			return Store.run(
				`SELECT ${fc("month")} AS month, ${sel}${fc("component")} AS component, SUM(${fc("amount")}) AS amount
				 FROM ${tbl("cost_fact")} f WHERE ${where} GROUP BY ${fc("month")}${grp}, ${fc("component")}`,
				params, "s4vp_la_breakdown");
		}
		try {
			return Store.run(
				`SELECT ${fc("month")} AS month, ${field} AS k, ${lab[1]}, ${fc("component")} AS component, SUM(${fc("amount")}) AS amount
				 FROM ${tbl("cost_fact")} f LEFT JOIN ${lab[0]} d ON d.id = ${field}
				 WHERE ${where} GROUP BY ${fc("month")}, ${field}, ${lab[2]}, ${fc("component")}`,
				params, "s4vp_la_breakdown");
		} catch (e) {
			return Store.run(
				`SELECT ${fc("month")} AS month, ${field} AS k, BUILTIN.DF(${field}) AS label, ${fc("component")} AS component, SUM(${fc("amount")}) AS amount
				 FROM ${tbl("cost_fact")} f WHERE ${where} GROUP BY ${fc("month")}, ${field}, BUILTIN.DF(${field}), ${fc("component")}`,
				params, "s4vp_la_breakdown_df");
		}
	}

	/**
	 * Sổ cái theo tháng của ngày chứng từ x loại tài khoản lãi lỗ (chỉ dòng posting của công ty con). Gom theo ngày chứng từ để
	 * cùng cách tính tháng với số liệu lương; bảng accountingperiod không đọc được bằng SuiteQL trên một số vai trò (đã thử td2937310). Thử với sổ chính (multi-book) trước, không
	 * được thì bỏ điều kiện sổ. Không đọc được -> null.
	 */
	function queryGl(sub, from, to) {
		const sql = (book) =>
			`SELECT TO_CHAR(t.trandate, 'YYYYMM') AS month, a.accttype AS accttype, SUM(COALESCE(tal.debit, 0)) AS debit, SUM(COALESCE(tal.credit, 0)) AS credit
			 FROM transactionaccountingline tal
			 INNER JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
			 INNER JOIN transaction t ON t.id = tal.transaction
			 INNER JOIN account a ON a.id = tal.account${book ? " INNER JOIN accountingbook ab ON ab.id = tal.accountingbook" : ""}
			 WHERE tl.subsidiary = ? AND tal.posting = 'T'${book ? " AND ab.isprimary = 'T'" : ""}
			   AND a.accttype IN ('Income', 'OthIncome', 'COGS', 'Expense', 'OthExpense')
			   AND t.trandate >= TO_DATE(?, 'YYYY-MM-DD') AND t.trandate < ADD_MONTHS(TO_DATE(?, 'YYYY-MM-DD'), 1)
			 GROUP BY TO_CHAR(t.trandate, 'YYYYMM'), a.accttype`;
		const params = [sub, firstDay(from), firstDay(to)];
		try {
			return Store.run(sql(true), params, "s4vp_la_gl");
		} catch (e) {
			try {
				return Store.run(sql(false), params, "s4vp_la_gl_nobook");
			} catch (e2) {
				return null;
			}
		}
	}

	const GL_TTL = 600;

	function glCacheKey(sub, from, to) {
		let who = "";
		try {
			const u = runtime.getCurrentUser();
			who = `${u.id || ""}_${u.role || ""}`;
		} catch (e) {
			who = "";
		}
		return `gl_${who}_${sub}_${from}_${to}`;
	}

	/**
	 * Sổ cái theo tháng, nhớ phần các tháng ĐÃ QUA (trước tháng hiện tại) trong N/cache theo người dùng và vai trò (600 giây):
	 * truy vấn sổ cái 13 tháng là phần chậm nhất của lượt gọi đầu, mà số của tháng đã qua hiếm khi đổi. Tháng hiện tại trở đi
	 * luôn đọc trực tiếp. `fresh` bỏ qua bản nhớ (nút Tải lại của màn hình). Không đọc được sổ cái -> null, không nhớ.
	 */
	function queryGlCached(sub, from, to, fresh) {
		const cur = ym(str(Clock.today()).slice(0, 7));
		const lastPast = cur ? addMonths(cur, -1) : "";
		if (!cur || from > lastPast) return queryGl(sub, from, to);
		const pastTo = to < lastPast ? to : lastPast;
		const key = glCacheKey(sub, from, pastTo);
		let store = null;
		let past = null;
		try {
			store = cache.getCache({ name: "s4vp_labor_gl", scope: cache.Scope.PROTECTED });
			if (!fresh) {
				const raw = store.get({ key });
				past = raw ? JSON.parse(raw) : null;
			}
		} catch (e) {
			past = null;
		}
		if (!Array.isArray(past)) {
			const rows = queryGl(sub, from, pastTo);
			if (rows === null) return null;
			past = rows.map((r) => ({ month: str(r.month), accttype: str(r.accttype), debit: num(r.debit), credit: num(r.credit) }));
			try {
				if (store) store.put({ key, value: JSON.stringify(past), ttl: GL_TTL });
			} catch (e) {
				// không có cache: lượt sau đọc lại
			}
		}
		if (to <= lastPast) return past;
		const live = queryGl(sub, cur, to);
		return live === null ? null : past.concat(live);
	}

	/**
	 * Trích tháng 13 mà bút toán ghi sổ thực ghi, theo bảng lương: chỉ dòng nhân viên (không phải cộng tác viên) có số trích
	 * dương - đúng điều kiện của PayrollJournalBuilder.buildRelease và LaborCostFacts. Tổng `accrued13` trên bảng lương cộng mọi
	 * dòng nên lệch khi có cộng tác viên hoặc dòng âm mang số trích. Không đọc được -> null (nơi gọi dùng tổng trên bảng lương).
	 */
	function queryBatchAccruals(sub, from, to) {
		const month = batchMonth();
		const acc = `be.${col("batch_emp", "accrued13")}`;
		const etype = `be.${col("batch_emp", "employment_type")}`;
		try {
			const out = {};
			for (const r of Store.run(
				`SELECT be.${col("batch_emp", "batch")} AS batch, SUM(${acc}) AS accrued13
				 FROM ${tbl("batch_emp")} be
				 INNER JOIN ${tbl("batch")} b ON b.id = be.${col("batch_emp", "batch")}
				 INNER JOIN ${tbl("period")} p ON p.id = b.${col("batch", "period")}
				 WHERE b.${col("batch", "subsidiary")} = ? AND b.${col("batch", "journal")} IS NOT NULL AND be.isinactive = 'F' AND b.isinactive = 'F'
				   AND ${acc} > 0 AND (${etype} IS NULL OR ${etype} <> ?) AND ${month} >= ? AND ${month} <= ?
				 GROUP BY be.${col("batch_emp", "batch")}`,
				[sub, Store.idOf("employment_type", "C"), from, to], "s4vp_la_batch_accruals")) out[String(r.batch)] = num(r.accrued13);
			return out;
		} catch (e) {
			return null;
		}
	}

	/**
	 * Bảng lương có bút toán của công ty con trong khoảng tháng, kèm số dòng và tổng số liệu còn hiệu lực. `expected` = tổng Nợ
	 * chi phí của bút toán ghi sổ: thu nhập + BH doanh nghiệp + trích tháng 13 của nhân viên có số trích dương.
	 */
	function queryBatches(sub, from, to) {
		const month = batchMonth();
		const b = (f) => `b.${col("batch", f)}`;
		const rows = Store.run(
			`SELECT b.id AS id, ${b("status")} AS status, ${b("journal")} AS journal, ${month} AS month, ${b("gross")} AS gross, ${b("er_ins")} AS er_ins, ${b("accrued13")} AS accrued13,
			        COUNT(f.id) AS facts, SUM(${fc("amount")}) AS amount
			 FROM ${tbl("batch")} b
			 INNER JOIN ${tbl("period")} p ON p.id = ${b("period")}
			 LEFT JOIN ${tbl("cost_fact")} f ON ${fc("batch")} = b.id AND ${activeFact()}
			 WHERE ${b("subsidiary")} = ? AND ${b("journal")} IS NOT NULL AND b.isinactive = 'F' AND ${month} >= ? AND ${month} <= ?
			 GROUP BY b.id, ${b("status")}, ${b("journal")}, ${month}, ${b("gross")}, ${b("er_ins")}, ${b("accrued13")}`,
			[sub, from, to], "s4vp_la_batches");
		const accruals = rows.length ? queryBatchAccruals(sub, from, to) : {};
		return rows.map((r) => ({
			id: String(r.id), status: Store.codeOf("batch_status", r.status), journal: str(r.journal), month: str(r.month),
			expected: num(r.gross) + num(r.er_ins) + (accruals ? accruals[String(r.id)] || 0 : num(r.accrued13)), facts: num(r.facts), amount: num(r.amount),
		}));
	}

	/** Số liệu theo tài khoản của một tháng (để đối chiếu). */
	function queryFactAccounts(sub, month) {
		return Store.run(
			`SELECT ${fc("account")} AS account, a.acctnumber AS num, a.accountsearchdisplaynamecopy AS name, SUM(${fc("amount")}) AS amount
			 FROM ${tbl("cost_fact")} f LEFT JOIN account a ON a.id = ${fc("account")}
			 WHERE ${fc("subsidiary")} = ? AND ${activeFact()} AND ${fc("month")} = ?
			 GROUP BY ${fc("account")}, a.acctnumber, a.accountsearchdisplaynamecopy`,
			[sub, month], "s4vp_la_fact_accounts");
	}

	/** Nợ, Có theo tài khoản của các bút toán lương (cùng cách đọc với Reports.journalLines, gom nhóm ở cơ sở dữ liệu). */
	function queryJournalAccounts(journalIds) {
		const ids = [...new Set(journalIds.filter((x) => /^\d+$/.test(str(x))).map(String))];
		if (!ids.length) return [];
		return Store.run(
			`SELECT tl.expenseaccount AS account, a.acctnumber AS num, a.accountsearchdisplaynamecopy AS name,
			        SUM(COALESCE(tl.debitforeignamount, 0)) AS debit, SUM(COALESCE(tl.creditforeignamount, 0)) AS credit
			 FROM transactionline tl LEFT JOIN account a ON a.id = tl.expenseaccount
			 WHERE tl.transaction IN (${ids.join(",")}) AND tl.expenseaccount IS NOT NULL
			 GROUP BY tl.expenseaccount, a.acctnumber, a.accountsearchdisplaynamecopy`,
			[], "s4vp_la_journal_accounts");
	}

	function latestMonth(sub) {
		const r = Store.run(`SELECT MAX(${fc("month")}) AS month FROM ${tbl("cost_fact")} f WHERE ${fc("subsidiary")} = ? AND ${activeFact()}`, [sub], "s4vp_la_latest")[0];
		return ym(r && r.month);
	}

	// ------------------------------------------------------------------ laborAnalytics

	const emptyComponents = () => {
		const o = {};
		for (const c of COMPONENTS) o[c] = 0;
		return o;
	};

	function resolveMonths(params) {
		const sub = str(params.subsidiary);
		if (!sub) throw fail("The subsidiary is required", "Thiếu công ty con");
		let month = ym(params.month);
		if (!blank(params.month) && !month) throw fail("The month must be YYYY-MM", "Tháng phải có dạng YYYY-MM");
		if (!month) month = latestMonth(sub) || ym(str(Clock.today()).slice(0, 7));
		const mode = blank(params.compare) ? "prev" : str(params.compare);
		let compare;
		if (mode === "prev") compare = addMonths(month, -1);
		else if (mode === "yoy") compare = addMonths(month, -12);
		else {
			compare = ym(mode);
			if (!compare) throw fail("The comparison period must be prev, yoy or YYYY-MM", "Kỳ so sánh phải là prev, yoy hoặc YYYY-MM");
		}
		return { sub, month, compare, mode, yoy: addMonths(month, -12) };
	}

	function laborAnalytics(params) {
		const p = params || {};
		const { sub, month, compare, mode, yoy } = resolveMonths(p);
		const dim = blank(p.dim) ? "department" : str(p.dim);
		if (!DIM_FIELDS[dim]) throw fail("Unknown breakdown dimension", "Chiều phân tích không hợp lệ");
		const from = [addMonths(month, -12), compare].sort()[0];
		const to = [month, compare].sort()[1];
		const notes = [];

		// 1. Chi phí theo tháng
		const agg = {};
		const monthOf = (m) => {
			if (!agg[m]) agg[m] = { labor: 0, laborCogs: 0, laborOpex: 0, hours: 0, components: emptyComponents(), rows: 0 };
			return agg[m];
		};
		for (const r of queryMonthly(sub, from, to)) {
			const a = monthOf(str(r.month));
			const amount = num(r.amount);
			const c = componentCode(r.component);
			a.rows++;
			a.labor += amount;
			a.components[c] = (a.components[c] || 0) + amount;
			a.hours += num(r.hours);
			if (accountClass(r.accttype) === "cogs") a.laborCogs += amount;
			else a.laborOpex += amount;
		}
		if (!Object.keys(agg).length) notes.push("NO_FACTS");
		const has = (m) => !!agg[m] && agg[m].rows > 0;
		if (!has(compare)) notes.push("NO_COMPARE");

		// 2. Số người
		const heads = {};
		for (const r of queryHeadcount(sub, from, to)) {
			const m = str(r.month);
			const t = typeCode(r.etype);
			heads[m] = heads[m] || { E: 0, C: 0 };
			heads[m][t] = (heads[m][t] || 0) + num(r.headcount);
		}
		const headcount = (m) => (heads[m] ? heads[m].E : has(m) ? 0 : null);

		// 3. Sổ cái
		const glRows = queryGlCached(sub, from, to, !blank(p.fresh) && str(p.fresh) !== "0");
		const gl = {};
		if (glRows) {
			for (const r of glRows) {
				const cls = accountClass(r.accttype);
				if (!cls) continue;
				const m = str(r.month);
				gl[m] = gl[m] || { revenue: 0, cogs: 0, opex: 0 };
				gl[m][cls] += cls === "revenue" ? num(r.credit) - num(r.debit) : num(r.debit) - num(r.credit);
			}
		}
		// Đọc được nhưng không thấy dòng lãi lỗ nào trong khi có chi phí lương đã ghi sổ: vai trò không thấy giao dịch
		const glOk = !!glRows && (Object.keys(gl).length > 0 || !Object.keys(agg).length);
		if (!glOk) notes.push("NO_GL_ACCESS");
		const glOf = (m) => {
			if (!glOk) return { revenue: null, cogs: null, opex: null, netIncome: null, hasGl: false };
			const g = gl[m] || { revenue: 0, cogs: 0, opex: 0 };
			return { revenue: g.revenue, cogs: g.cogs, opex: g.opex, netIncome: g.revenue - g.cogs - g.opex, hasGl: !!gl[m] };
		};

		const monthRow = (m) => {
			const a = agg[m] || { labor: 0, laborCogs: 0, laborOpex: 0, hours: 0, components: emptyComponents() };
			return Object.assign({ month: show(m), labor: a.labor, laborCogs: a.laborCogs, laborOpex: a.laborOpex }, a.components, { headcount: headcount(m) || 0, hours: a.hours }, glOf(m));
		};
		const months = [];
		for (let i = 11; i >= 0; i--) months.push(monthRow(addMonths(month, -i)));

		// 4. Chỉ số
		const kpiOf = (m) => {
			if (!has(m)) return { labor: null, laborToRevenue: null, laborInCogs: null, laborInOpex: null, headcount: null, costPerHead: null, overtimeShare: null, costPerHour: null };
			const a = agg[m];
			const g = glOf(m);
			const hc = headcount(m);
			return {
				labor: a.labor, laborToRevenue: Variance.ratio(a.labor, g.revenue), laborInCogs: Variance.ratio(a.laborCogs, g.cogs), laborInOpex: Variance.ratio(a.laborOpex, g.opex),
				headcount: hc, costPerHead: Variance.ratio(a.labor - a.components.contractor, hc), overtimeShare: Variance.share(a.components.overtime, a.labor),
				costPerHour: Variance.ratio(a.labor, a.hours),
			};
		};
		const kCur = kpiOf(month);
		const kPrev = kpiOf(compare);
		const kYoy = kpiOf(yoy);
		const kpis = {};
		for (const k of Object.keys(kCur)) kpis[k] = { cur: kCur[k], prev: kPrev[k], yoy: kYoy[k] };

		// 5. Cầu biến động
		const side = (m) => ({ headcount: headcount(m) || 0, components: (agg[m] || { components: emptyComponents() }).components });
		const bridge = Variance.bridge(side(compare), side(month));

		// 6. Phân rã theo chiều
		const breakdown = buildBreakdown(sub, dim, month, compare, heads, agg[month] ? agg[month].labor : 0);

		// 7. Lãi lỗ có tách phần lao động
		const gc = glOf(month);
		const gp = glOf(compare);
		const lc = agg[month] || { laborCogs: 0, laborOpex: 0 };
		const lp = agg[compare] || { laborCogs: 0, laborOpex: 0 };
		const minus = (a, b) => (a === null || b === null ? null : a - b);
		const pnlRow = (key, cur, prev) => ({ key, cur, prev, diff: Variance.diff(cur, prev), pct: Variance.pct(cur, prev), ofRevenue: Variance.ratio(cur, gc.revenue) });
		const pnl = [
			pnlRow("revenue", gc.revenue, gp.revenue),
			pnlRow("cogs", gc.cogs, gp.cogs),
			pnlRow("laborCogs", lc.laborCogs, has(compare) ? lp.laborCogs : null),
			pnlRow("grossProfit", minus(gc.revenue, gc.cogs), minus(gp.revenue, gp.cogs)),
			pnlRow("opex", gc.opex, gp.opex),
			pnlRow("laborOpex", lc.laborOpex, has(compare) ? lp.laborOpex : null),
			pnlRow("operatingProfit", gc.netIncome, gp.netIncome),
		];

		// 8. Bảng lương của kỳ: số liệu còn thiếu / lệch, và đối chiếu với bút toán
		const batches = queryBatches(sub, from, to);
		const outdated = batches.some((b) => (b.status === "R" ? Math.abs(b.amount - b.expected) >= 0.5 || (b.facts === 0 && b.expected !== 0) : b.facts > 0));
		if (outdated) notes.push("FACTS_OUTDATED");
		const reconcile = buildReconcile(sub, month, batches.filter((b) => b.status === "R" && b.month === month).map((b) => b.journal), notes);

		return { subsidiary: sub, month: show(month), compare: show(compare), compareMode: mode, months, kpis, bridge, breakdown, pnl, reconcile, notes };
	}

	function buildBreakdown(sub, dim, month, compare, heads, totalCur) {
		const map = new Map();
		const get = (key) => {
			if (!map.has(key)) map.set(key, { key, label: "", cur: 0, prev: 0, components: emptyComponents() });
			return map.get(key);
		};
		const months = month === compare ? [month] : [month, compare];
		for (const r of queryBreakdown(sub, dim, months)) {
			const c = componentCode(r.component);
			const key = dim === "component" ? c : dim === "employmentType" ? typeCode(r.k) : str(r.k);
			const row = get(key);
			const amount = num(r.amount);
			if (dim === "component" || dim === "employmentType") row.label = key;
			else if (dim === "account") {
				row.accountNumber = str(r.code);
				row.label = [str(r.code), str(r.label)].filter(Boolean).join(" ") || row.label;
				row.inCogs = accountClass(r.accttype) === "cogs";
			} else if (dim === "project") row.label = str(r.label) || str(r.code) || row.label;
			else row.label = str(r.label) || row.label;
			if (str(r.month) === month) {
				row.cur += amount;
				row.components[c] = (row.components[c] || 0) + amount;
			}
			if (str(r.month) === compare && compare !== month) row.prev += amount;
		}
		// Số người theo dòng: chỉ có nghĩa với phòng ban (theo hồ sơ lương) và loại lao động; chiều khác để null
		const hc = {};
		let known = dim === "department" || dim === "employmentType";
		if (dim === "department") {
			try {
				for (const r of queryDepartmentHeadcount(sub, months)) hc[`${str(r.month)}|${str(r.k)}`] = num(r.headcount);
			} catch (e) {
				// vai trò không JOIN được bảng nhân viên: để trống số người theo phòng ban
				known = false;
			}
		} else if (dim === "employmentType") {
			for (const m of months) for (const t of ["E", "C"]) hc[`${m}|${t}`] = heads[m] ? heads[m][t] || 0 : 0;
		}
		const headOf = (m, key) => (known ? hc[`${m}|${key}`] || 0 : null);
		const rows = [...map.values()].map((r) => {
			const headcount = headOf(month, r.key);
			const employeeCost = dim === "employmentType" ? r.cur : r.cur - r.components.contractor;
			return Object.assign(r, {
				diff: r.cur - r.prev, pct: Variance.pct(r.cur, r.prev), share: Variance.share(r.cur, totalCur), headcount,
				prevHeadcount: compare === month ? headcount : headOf(compare, r.key), perHead: Variance.ratio(employeeCost, headcount),
			});
		}).sort((a, b) => b.cur - a.cur || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
		return { dim, dims: DIMS, rows };
	}

	function buildReconcile(sub, month, journalIds, notes) {
		const map = new Map();
		const get = (r) => {
			const id = str(r.account);
			if (!map.has(id)) map.set(id, { account: id, accountNumber: str(r.num), accountName: str(r.name), payroll: 0, gl: null, difference: null });
			return map.get(id);
		};
		for (const r of queryFactAccounts(sub, month)) get(r).payroll += num(r.amount);
		let glOk = true;
		try {
			const lines = queryJournalAccounts(journalIds);
			for (const r of lines) {
				const net = num(r.debit) - num(r.credit);
				// Tài khoản không có trong số liệu: chỉ nêu khi bút toán ghi Nợ ròng (chi phí chưa vào số liệu); tài khoản phải trả bỏ qua
				if (!map.has(str(r.account)) && net <= 0) continue;
				const row = get(r);
				row.gl = (row.gl || 0) + net;
			}
		} catch (e) {
			glOk = false;
			if (!notes.includes("NO_GL_ACCESS")) notes.push("NO_GL_ACCESS");
		}
		const rows = [...map.values()].map((r) => Object.assign(r, { gl: glOk ? r.gl || 0 : null, difference: glOk ? r.payroll - (r.gl || 0) : null }))
			.sort((a, b) => (a.accountNumber < b.accountNumber ? -1 : a.accountNumber > b.accountNumber ? 1 : 0));
		return { rows, ok: glOk ? rows.every((r) => Math.abs(r.difference) < 0.5) : null };
	}

	// ------------------------------------------------------------------ laborDrill

	function employeeInfo(ids) {
		const out = {};
		const list = [...new Set(ids.map(String).filter((x) => /^\d+$/.test(x)))];
		for (let i = 0; i < list.length; i += 900) {
			const inList = list.slice(i, i + 900).join(",");
			let rows;
			try {
				rows = Store.run(`SELECT e.id, e.entityid, e.firstname, e.lastname, d.fullname AS deptname FROM employee e LEFT JOIN department d ON d.id = e.department WHERE e.id IN (${inList})`, [], "s4vp_la_employees");
			} catch (e) {
				rows = Store.run(`SELECT e.id, e.entityid, e.firstname, e.lastname, BUILTIN.DF(e.department) AS deptname FROM employee e WHERE e.id IN (${inList})`, [], "s4vp_la_employees_df");
			}
			for (const r of rows) out[String(r.id)] = { code: str(r.entityid), name: [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || str(r.entityid), department: str(r.deptname) };
		}
		return out;
	}

	/**
	 * Chi tiết tới nhân viên của đúng một nhóm (dim = key): tính từ dòng bảng lương đã ghi sổ của tháng này và kỳ so sánh.
	 * Mỗi nhân viên kèm `batch` (bảng lương của tháng đang xem; nhiều bảng thì bảng có số tiền của nhóm lớn nhất, bằng nhau thì
	 * bảng có id nhỏ hơn) và `line` (id dòng batch_emp của bảng đó) để giao diện mở thẳng dòng lương; chỉ có ở kỳ so sánh -> null.
	 */
	function laborDrill(params) {
		const p = params || {};
		const { sub, month, compare } = resolveMonths(p);
		const dim = blank(p.dim) ? "department" : str(p.dim);
		const prop = DIM_PROPS[dim];
		if (!prop) throw fail("Unknown breakdown dimension", "Chiều phân tích không hợp lệ");
		const key = str(p.key);
		const wanted = month === compare ? [month] : [month, compare];
		const range = [month, compare].sort();
		const posted = queryBatches(sub, range[0], range[1]).filter((b) => b.status === "R" && wanted.includes(b.month));
		const monthOfBatch = {};
		for (const b of posted) monthOfBatch[b.id] = b.month;
		const ids = posted.map((b) => b.id);
		const byEmployee = new Map();
		if (ids.length) {
			const shared = {};
			const options = {};
			for (const b of Store.findIn("batch", "id", ids)) options[b.id] = factContext(b, shared).options;
			for (const line of Store.findIn("batch_emp", "batch", ids)) {
				const m = monthOfBatch[String(line.batch)];
				if (!m || !options[line.batch]) continue;
				for (const f of Facts.employeeFacts(line, options[line.batch])) {
					if (str(f[prop]) !== key) continue;
					const emp = String(line.employee);
					if (!byEmployee.has(emp)) byEmployee.set(emp, { employee: emp, code: "", name: "", department: "", cur: 0, prev: 0, components: emptyComponents(), batches: {} });
					const row = byEmployee.get(emp);
					if (m === month) {
						row.cur += f.amount;
						row.components[f.component] = (row.components[f.component] || 0) + f.amount;
						const src = (row.batches[String(line.batch)] = row.batches[String(line.batch)] || { batch: String(line.batch), line: String(line.id), amount: 0 });
						src.amount += f.amount;
					} else {
						row.prev += f.amount;
					}
				}
			}
		}
		const info = byEmployee.size ? employeeInfo([...byEmployee.keys()]) : {};
		const rows = [...byEmployee.values()].map((r) => {
			const src = Object.values(r.batches).sort((a, b) => b.amount - a.amount || Number(a.batch) - Number(b.batch))[0] || null;
			delete r.batches;
			return Object.assign(r, info[r.employee] || {}, { diff: r.cur - r.prev, pct: Variance.pct(r.cur, r.prev), batch: src ? src.batch : null, line: src ? src.line : null });
		})
			.sort((a, b) => b.cur - a.cur || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
		return { subsidiary: sub, month: show(month), compare: show(compare), dim, key, rows };
	}

	// ------------------------------------------------------------------ rebuildLaborFacts

	function cursorStore() {
		return cache.getCache({ name: "s4vp_labor_facts", scope: cache.Scope.PROTECTED });
	}

	function cursorKey(sub, month) {
		let user = "";
		try {
			user = String(runtime.getCurrentUser().id || "");
		} catch (e) {
			user = "";
		}
		return `rebuild_${user}_${sub}_${month || "all"}`;
	}

	function readCursor(key) {
		try {
			const raw = cursorStore().get({ key });
			const c = raw ? JSON.parse(raw) : null;
			return c && c.after ? c : null;
		} catch (e) {
			return null;
		}
	}

	function writeCursor(key, value) {
		try {
			const c = cursorStore();
			if (value) c.put({ key, value: JSON.stringify(value), ttl: 300 });
			else c.remove({ key });
		} catch (e) {
			// không có cache: lượt sau làm lại từ đầu (đồng bộ chạy lại được, dòng đã đúng thì không ghi)
		}
	}

	/**
	 * Lập lại số liệu cho các bảng lương đã có bút toán của công ty con (đã ghi sổ: dựng lại; đã đảo: bỏ hiệu lực), theo lượt.
	 * Giao diện gọi lại cùng nội dung khi more = true (lib/api.js cộng dồn các số), nên vị trí đang làm được nhớ trong N/cache
	 * theo người dùng (300 giây); `done` là số bảng lương xong trong lượt này, `total` chỉ khác 0 ở lượt đầu - cộng dồn các lượt
	 * ra đúng "done / total".
	 * @param {{subsidiary, month?: 'YYYY-MM'}} body
	 */
	function rebuildLaborFacts(body) {
		const b = body || {};
		const sub = str(b.subsidiary);
		if (!sub) throw fail("The subsidiary is required", "Thiếu công ty con");
		const month = ym(b.month);
		if (!blank(b.month) && !month) throw fail("The month must be YYYY-MM", "Tháng phải có dạng YYYY-MM");
		const guard = guardOf(Date.now());
		let batches = Store.find("batch", { where: "{subsidiary} = ? AND {journal} IS NOT NULL", params: [sub] }).filter((x) => x.status === "R" || x.status === "V");
		if (month) {
			const ends = {};
			for (const p of Store.findIn("period", "id", batches.filter((x) => blank(x.doc_date)).map((x) => x.period))) ends[p.id] = p.end;
			batches = batches.filter((x) => Facts.monthOf(x.doc_date || ends[x.period] || "") === month);
		}
		batches.sort((x, y) => Number(x.id) - Number(y.id));
		const key = cursorKey(sub, month);
		const cursor = readCursor(key);
		const after = cursor ? Number(cursor.after) : 0;
		const shared = {};
		let done = 0;
		let more = false;
		let last = after;
		for (const batch of batches) {
			if (Number(batch.id) <= after) continue;
			if (!guard()) {
				more = true;
				break;
			}
			const r = syncFacts(batch, guard, shared);
			if (!r.complete) {
				more = true;
				break;
			}
			done++;
			last = Number(batch.id);
		}
		const total = cursor ? 0 : batches.length;
		if (more) {
			// Bảng lương đang dở (rất nhiều dòng) không được ghi vào vị trí: lượt sau làm tiếp chính bảng đó, dòng đã ghi được giữ
			writeCursor(key, { after: last || -1 });
			return { more: true, done, total };
		}
		writeCursor(key, null);
		return { done, total };
	}

	const routes = {
		get: {
			laborAnalytics: { roles: "acct", run: (params) => laborAnalytics(params) },
			laborDrill: { roles: "acct", run: (params) => laborDrill(params) },
		},
		post: {
			rebuildLaborFacts: { roles: "acct", run: (body) => rebuildLaborFacts(body) },
		},
	};

	return { routes, refreshFacts, laborAnalytics, laborDrill, rebuildLaborFacts };
});
