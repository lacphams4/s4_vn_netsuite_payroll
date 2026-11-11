/**
 * Hoa hồng nhân viên kinh doanh (docs/COMMISSION.md mục 2 - 6): lớp nghiệp vụ.
 *
 * - Đọc giao dịch NetSuite bằng các truy vấn SuiteQL cố định (không có điểm SuiteQL tổng quát), đã thử trên td2937310:
 *   dòng hóa đơn / cash sale / credit memo trong khoảng ngày, dòng hóa đơn được thu tiền trong kỳ (trigger P), hóa đơn đến
 *   hạn truy thu chưa thu đủ (clawback), đội bán, ngày mua đầu tiên của khách. Id công ty con, id giao dịch là số nguyên
 *   ghép thẳng vào câu lệnh; ngày truyền tham số TO_DATE(?, 'YYYY-MM-DD'); id trường tùy chỉnh (nguồn F) kiểm bằng regex
 *   ^custbody[a-z0-9_]+$ trước khi ghép.
 * - Đọc thêm doanh số ngoài đã nạp (record comm_txn, mục 4.1) khi kế hoạch có nguồn X / B.
 * - Chuẩn hóa về dạng dòng của core/CommissionEngine (mục 5), gọi lõi theo từng kế hoạch, ghi comm_run (nháp D) và
 *   comm_result theo khóa nhân viên + kế hoạch: cập nhật dòng đã có, dòng không còn sinh ra -> isinactive, không xóa.
 * - Một lượt tính ghi đến khi gần hết governance / thời gian thì trả more = true; gọi lại sẽ đọc lại và bỏ qua dòng không đổi.
 * - Duyệt (D -> A), mở lại (A -> D), hủy (isinactive + lý do), cấm khi đã vào bảng lương (P).
 * - Kế hoạch (plan + rules + tiers + assignments + quotas), điều chỉnh tay, mô phỏng, nạp doanh số ngoài.
 *
 * Lỗi nghiệp vụ ném fail(en, vi) (Error có userMessage); kết quả không bao giờ có khóa tên "error".
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Clock", "../core/CommissionEngine", "../core/Dates"], (runtime, Store, Clock, Engine, Dates) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const num = (v) => (blank(v) ? 0 : Number(v) || 0);
	const isId = (v) => /^\d+$/.test(String(blank(v) ? "" : v));
	const isIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
	const DATE = "TO_DATE(?, 'YYYY-MM-DD')";
	const TYPE_CODE = { CustInvc: "I", CashSale: "S", CustCred: "C" };
	const CREDIT_FIELD = /^custbody[a-z0-9_]+$/;
	const IDLIST = /^\d+(,\d+)*$/;
	// Số credit tối đa lưu trong detail của một kết quả (clob); vượt thì ghi creditsTotal để màn hình báo
	const MAX_CREDITS = 1500;
	const IMPORT_LIMIT = 5000;

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function currentEmployee() {
		const u = runtime.getCurrentUser();
		return u && Number(u.id) > 0 ? String(u.id) : null;
	}

	/** Hạn mức một lượt gọi: còn dưới 300 đơn vị governance hoặc quá 40 giây thì dừng (trả more = true). */
	function budget() {
		const script = runtime.getCurrentScript();
		const deadline = Date.now() + 40000;
		return { low: () => script.getRemainingUsage() < 300 || Date.now() > deadline };
	}

	/** Danh sách id số nguyên để ghép thẳng vào IN (...); rỗng thì "0". */
	function idList(ids) {
		const seen = {};
		const out = [];
		for (const x of ids || []) {
			const s = String(blank(x) ? "" : x);
			if (!/^\d+$/.test(s) || seen[s]) continue;
			seen[s] = true;
			out.push(s);
		}
		return out;
	}

	function chunks(list, size) {
		const out = [];
		for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
		return out;
	}

	// ------------------------------------------------------------------ tháng, kỳ

	/** Tháng YYYYMM (số, "202603" hoặc "2026-03") -> {month: 202603, from, to}; from / to ISO tùy chọn ghi đè. */
	function periodOf(month, from, to) {
		const s = String(blank(month) ? "" : month).replace("-", "");
		if (!/^\d{6}$/.test(s) || +s.slice(4) < 1 || +s.slice(4) > 12) throw fail("Select a month (YYYYMM)", "Chưa chọn tháng (YYYYMM)");
		const first = `${s.slice(0, 4)}-${s.slice(4)}-01`;
		const f = blank(from) ? first : String(from);
		const t = blank(to) ? Dates.endOfMonth(first) : String(to);
		if (!isIso(f) || !isIso(t)) throw fail("Dates must be YYYY-MM-DD", "Ngày phải dạng YYYY-MM-DD");
		if (f > t) throw fail("The start date is after the end date", "Từ ngày sau đến ngày");
		return { month: Number(s), from: f, to: t };
	}

	const monthNo = (iso) => Number(String(iso).slice(0, 4) + String(iso).slice(5, 7));

	function subsidiaryOf(v) {
		const s = String(blank(v) ? "" : v);
		if (!isId(s)) throw fail("Select a subsidiary", "Chưa chọn công ty con");
		return s;
	}

	// ------------------------------------------------------------------ đọc giao dịch NetSuite (truy vấn cố định)

	const LINE_JOINS =
		"JOIN transactionline tl ON tl.transaction = t.id LEFT JOIN job jl ON jl.id = tl.entity LEFT JOIN job jh ON jh.id = t.entity " +
		"LEFT JOIN customer c ON c.id = NVL(jh.customer, t.entity) LEFT JOIN item i ON i.id = tl.item";
	const LINE_WHERE = "t.posting = 'T' AND t.voided = 'F' AND tl.mainline = 'F' AND tl.taxline = 'F' AND tl.netamount IS NOT NULL";
	const PAY_LINK = "k.linktype = 'Payment' AND k.previoustype = 'CustInvc'";

	/**
	 * Cột của dòng giao dịch. Dự án: thực thể dòng là job, hoặc thực thể chứng từ là job (khách = job.customer). Doanh thu,
	 * giá vốn ước tính, số lượng đổi dấu (bán hàng âm trên sổ; credit memo dương nên ra số âm). cf_<i>: trường ghi nhận nguồn F.
	 */
	function lineColumns(creditFields) {
		return [
			"t.id AS tran_id", "t.tranid AS tran_no", "t.type AS ttype", "TO_CHAR(t.trandate, 'YYYY-MM-DD') AS tdate",
			"NVL(jh.customer, t.entity) AS customer", "c.entityid AS cust_code", "c.altname AS cust_name", "c.category AS cust_cat",
			"CASE WHEN jl.id IS NOT NULL THEN tl.entity WHEN jh.id IS NOT NULL THEN t.entity ELSE NULL END AS project",
			"t.employee AS sales_rep", "t.foreigntotal AS ftotal", "tl.id AS line_id", "tl.item AS item", "i.itemid AS item_code", "tl.itemtype AS item_type",
			"tl.class AS class_id", "tl.department AS department", "tl.location AS location",
			"-tl.netamount AS revenue", "-tl.costestimate AS cost", "-tl.quantity AS qty",
		].concat(creditFields.map((f, i) => `t.${f} AS cf_${i}`)).join(", ");
	}

	/** Truy vấn có ghép trường tùy chỉnh: lỗi (trường không tồn tại / không đọc được) báo rõ thay vì lỗi SuiteQL chung. */
	function runLines(sql, params, tag, creditFields) {
		try {
			return Store.run(sql, params, tag);
		} catch (e) {
			if (creditFields.length) throw fail(`Cannot read the credit field(s) ${creditFields.join(", ")} on sales transactions`, `Không đọc được trường ghi nhận ${creditFields.join(", ")} trên chứng từ bán hàng`);
			throw e;
		}
	}

	/** Dòng hóa đơn, cash sale, credit memo của công ty con có ngày chứng từ trong [from, to]. */
	function docLines(sub, from, to, creditFields) {
		const sql =
			`SELECT ${lineColumns(creditFields)} FROM transaction t ${LINE_JOINS} WHERE t.type IN ('CustInvc','CashSale','CustCred') AND ${LINE_WHERE} ` +
			`AND tl.subsidiary = ${sub} AND t.trandate >= ${DATE} AND t.trandate <= ${DATE} ORDER BY t.id, tl.id`;
		return runLines(sql, [from, to], "s4vp_cm_lines", creditFields);
	}

	/**
	 * Dòng hóa đơn được thu tiền (CustPymt, DepAppl) có ngày áp trong [starts[0], to] (trigger P). paid_<i> = tổng đã thu từ
	 * starts[i] đến to (mỗi điểm đầu cửa sổ một cột, trong cùng một truy vấn). Ngày đầu đã kiểm ISO nên ghép thẳng.
	 */
	function paidLines(sub, starts, to, creditFields) {
		const sums = starts.map((d, i) => `SUM(CASE WHEN k.nextdate >= TO_DATE('${d}', 'YYYY-MM-DD') THEN k.foreignamount ELSE 0 END) AS paid_${i}`).join(", ");
		const cols = starts.map((d, i) => `p.paid_${i} AS paid_${i}`).join(", ");
		const sql =
			`SELECT ${lineColumns(creditFields)}, ${cols} FROM (SELECT k.previousdoc AS doc, ${sums} FROM previoustransactionlinelink k WHERE ${PAY_LINK} ` +
			`AND k.nexttype IN ('CustPymt','DepAppl') AND k.nextdate >= ${DATE} AND k.nextdate <= ${DATE} GROUP BY k.previousdoc) p ` +
			`JOIN transaction t ON t.id = p.doc ${LINE_JOINS} WHERE t.type = 'CustInvc' AND ${LINE_WHERE} AND tl.subsidiary = ${sub} ORDER BY t.id, tl.id`;
		return runLines(sql, [starts[0], to], "s4vp_cm_paid", creditFields);
	}

	/**
	 * Hóa đơn ngày chứng từ trong [invFrom, invTo] chưa thu đủ tính đến asOf (đã thu = thu tiền, áp cọc, áp credit memo có
	 * ngày áp <= asOf; credit memo đã trừ ở cơ sở nên coi như đã thu để không trừ hai lần).
	 */
	function clawLines(sub, invFrom, invTo, asOf, creditFields) {
		const sql =
			`SELECT ${lineColumns(creditFields)}, NVL(p.paid, 0) AS paid FROM transaction t ${LINE_JOINS} ` +
			`LEFT JOIN (SELECT k.previousdoc AS doc, SUM(k.foreignamount) AS paid FROM previoustransactionlinelink k WHERE ${PAY_LINK} ` +
			`AND k.nexttype IN ('CustPymt','DepAppl','CustCred') AND k.nextdate <= ${DATE} GROUP BY k.previousdoc) p ON p.doc = t.id ` +
			`WHERE t.type = 'CustInvc' AND ${LINE_WHERE} AND tl.subsidiary = ${sub} AND t.trandate >= ${DATE} AND t.trandate <= ${DATE} ` +
			`AND t.foreigntotal > NVL(p.paid, 0) ORDER BY t.id, tl.id`;
		return runLines(sql, [asOf, invFrom, invTo], "s4vp_cm_claw", creditFields);
	}

	/**
	 * Đội bán của các giao dịch: {tranId: [{employee, pct}]}. contribution của NetSuite là tỷ lệ (1 = 100%); lõi nhận phần trăm
	 * nên nhân 100 (tổng có thể khác 100%, giữ nguyên như NetSuite).
	 */
	function salesTeams(tranIds) {
		const out = {};
		for (const part of chunks(idList(tranIds), 900)) {
			const rows = Store.run(`SELECT st.transaction AS tran_id, st.employee AS employee, st.contribution AS pct FROM transactionsalesteam st WHERE st.transaction IN (${part.join(",")}) ORDER BY st.transaction`, [], "s4vp_cm_team");
			for (const r of rows) (out[String(r.tran_id)] = out[String(r.tran_id)] || []).push({ employee: String(r.employee), pct: Math.round(num(r.pct) * 1000000) / 10000 });
		}
		return out;
	}

	/** Ngày mua đầu tiên (hóa đơn / cash sale đã ghi sổ) của các khách: {customer: 'YYYY-MM-DD'}. */
	function firstSales(customerIds) {
		const out = {};
		for (const part of chunks(idList(customerIds), 900)) {
			const rows = Store.run(
				`SELECT f.entity AS customer, TO_CHAR(MIN(f.trandate), 'YYYY-MM-DD') AS first_date FROM transaction f WHERE f.type IN ('CustInvc','CashSale') AND f.posting = 'T' AND f.voided = 'F' AND f.entity IN (${part.join(",")}) GROUP BY f.entity`,
				[], "s4vp_cm_first"
			);
			for (const r of rows) out[String(r.customer)] = r.first_date || null;
		}
		return out;
	}

	/** Dòng doanh số ngoài (comm_txn) của công ty con có ngày chứng từ hoặc ngày thu trong [from, to]. */
	function externalTxns(sub, from, to) {
		return Store.find("comm_txn", {
			where: `{subsidiary} = ? AND (({date} >= ${DATE} AND {date} <= ${DATE}) OR ({collected_date} >= ${DATE} AND {collected_date} <= ${DATE}))`,
			params: [sub, from, to, from, to],
			order: "{date}",
		});
	}

	// ------------------------------------------------------------------ chuẩn hóa dòng (mục 5)

	const str = (v) => (blank(v) ? null : String(v));

	/**
	 * Dòng SuiteQL -> dòng chuẩn của lõi (chưa gắn creditEmployee, tỷ lệ thu / chưa thu). sourceSystem trống = NetSuite (quy
	 * ước của lõi); line = id dòng để khóa credit ổn định giữa các lượt tính.
	 */
	function nsRow(r, teams, first) {
		const customer = str(r.customer);
		return {
			tranId: String(r.tran_id), line: String(r.line_id), tranNo: r.tran_no || "", tranType: TYPE_CODE[r.ttype] || "I", date: r.tdate,
			customer, customerName: [r.cust_code, r.cust_name].filter((x, i, a) => x && a.indexOf(x) === i).join(" "), customerCategory: str(r.cust_cat), firstSaleDate: customer ? first[customer] || null : null,
			item: str(r.item), itemName: r.item_code || "", itemType: r.item_type || "", classId: str(r.class_id), department: str(r.department), location: str(r.location), project: str(r.project),
			revenue: num(r.revenue), cost: num(r.cost), qty: num(r.qty), salesRep: str(r.sales_rep), team: teams[String(r.tran_id)] || [], creditEmployee: null,
			sourceSystem: "", raw: r,
		};
	}

	function parseTeam(text) {
		if (blank(text)) return [];
		try {
			const list = typeof text === "string" ? JSON.parse(text) : text;
			return Array.isArray(list) ? list.filter((m) => m && !blank(m.employee)).map((m) => ({ employee: String(m.employee), pct: num(m.pct) })) : [];
		} catch (e) {
			return [];
		}
	}

	/**
	 * Dòng comm_txn -> dòng chuẩn; người được ghi nhận = employee của dòng với mọi nguồn ghi nhận (đội bán: team của dòng, pct
	 * là phần trăm 100 = 100%). Bộ lọc mặt hàng của thành phần so theo id nội bộ nên không khớp mã mặt hàng ngoài.
	 */
	function extRow(x) {
		return {
			tranId: `X${x.id}`, line: String(blank(x.line_no) ? 0 : x.line_no), tranNo: x.doc_no || "", tranType: x.tran_type || "I", date: x.date,
			customer: x.customer_code || null, customerName: [x.customer_code, x.customer_name].filter((v, i, a) => v && a.indexOf(v) === i).join(" "), customerCategory: str(x.customer_category), firstSaleDate: x.first_sale_date || null,
			item: x.item_code || null, itemName: x.item_code || "", itemType: x.item_type || "", classId: str(x.class), department: str(x.department), location: str(x.location), project: str(x.project),
			revenue: num(x.revenue), cost: num(x.cost), qty: num(x.qty), salesRep: str(x.employee), team: parseTeam(x.team), creditEmployee: str(x.employee),
			sourceSystem: x.source_system || "EXT", external: x,
		};
	}

	const clone = (row, extra) => {
		const o = Object.assign({}, row, extra);
		delete o.raw;
		delete o.external;
		return o;
	};

	// ------------------------------------------------------------------ kế hoạch

	const PLAN_KEYS = ["subsidiary", "description", "effective", "expiration", "basis", "trigger", "credit_source", "credit_field", "window", "include_returns", "clawback_days", "exclude_item_types", "earning_type", "min_attainment", "cap_amount", "draw_type", "draw_amount", "override_pct", "override_basis", "source"];
	const RULE_KEYS = ["sequence", "f_items", "f_classes", "f_departments", "f_locations", "f_cust_categories", "f_new_customer", "new_days", "method", "rate", "unit_amount"];
	const TIER_KEYS = ["from_value", "rate", "amount"];
	const ASSIGN_KEYS = ["employee", "effective", "expiration", "quota", "manager"];
	const QUOTA_KEYS = ["employee", "month", "quota"];
	const LISTS = { basis: ["R", "G", "Q"], trigger: ["I", "P"], credit_source: ["R", "T", "F"], window: ["M", "Q", "Y"], draw_type: ["N", "R", "G"], override_basis: ["B", "C"], source: ["N", "X", "B"], method: ["P", "G", "S", "A", "U", "B"] };

	const hasField = (name, key) => {
		try {
			return !!Store.rec(name).fields[key];
		} catch (e) {
			return false;
		}
	};

	/** Kế hoạch (và dòng con đang hoạt động) theo id; một truy vấn mỗi loại record. */
	function plansWithChildren(plans) {
		const ids = plans.map((p) => p.id);
		const rules = ids.length ? Store.findIn("comm_rule", "plan", ids) : [];
		const tiers = rules.length ? Store.findIn("comm_tier", "rule", rules.map((r) => r.id)) : [];
		const assigns = ids.length ? Store.findIn("comm_assign", "plan", ids) : [];
		const quotas = ids.length ? Store.findIn("comm_quota", "plan", ids) : [];
		const by = (list, key) => list.reduce((o, x) => ((o[x[key]] = o[x[key]] || []).push(x), o), {});
		const rulesBy = by(rules, "plan");
		const tiersBy = by(tiers, "rule");
		const assignBy = by(assigns, "plan");
		const quotaBy = by(quotas, "plan");
		const seq = (a, b) => num(a.sequence) - num(b.sequence) || Number(a.id) - Number(b.id);
		return plans.map((p) => {
			const rs = (rulesBy[p.id] || []).slice().sort(seq).map((r) => Object.assign({}, r, { tiers: (tiersBy[r.id] || []).slice().sort((a, b) => num(a.from_value) - num(b.from_value)) }));
			return Object.assign({}, p, { rules: rs, assignments: assignBy[p.id] || [], quotas: quotaBy[p.id] || [] });
		});
	}

	/** Kế hoạch dùng được cho công ty con (kế hoạch không khai công ty con dùng cho mọi công ty). */
	function plansFor(sub, opt) {
		const o = opt || {};
		const all = Store.find("comm_plan", { includeInactive: !!o.includeInactive, order: "{name}" }).filter((p) => blank(p.subsidiary) || String(p.subsidiary) === String(sub));
		return plansWithChildren(all);
	}

	const overlaps = (eff, exp, from, to) => (blank(eff) || String(eff) <= to) && (blank(exp) || String(exp) >= from);

	// ------------------------------------------------------------------ bảng tính

	function runOf(id) {
		if (!isId(id)) throw fail("Commission run not found", "Không tìm thấy bảng tính hoa hồng");
		const r = Store.get("comm_run", id);
		if (!r) throw fail("Commission run not found", "Không tìm thấy bảng tính hoa hồng");
		if (r.isInactive) throw fail("The commission run has been voided", "Bảng tính hoa hồng đã bị hủy");
		return r;
	}

	/** Bảng tính đang hoạt động của công ty con và tháng (mới nhất nếu lỡ có nhiều). */
	function activeRun(sub, month) {
		const list = Store.find("comm_run", { where: "{subsidiary} = ? AND {month} = ?", params: [sub, month], order: "{id} DESC" });
		return list[0] || null;
	}

	/**
	 * Số đã trả các kỳ trước cùng cửa sổ (tổng earned của kết quả thuộc bảng tính đã duyệt / đã vào lương, tháng trong
	 * [đầu cửa sổ, tháng trước]) và số dư ứng trước của kết quả gần nhất trước tháng này: theo kế hoạch -> nhân viên.
	 */
	function priorState(sub, month, plans, windowStart) {
		const runs = Store.find("comm_run", { where: "{subsidiary} = ? AND {month} < ?", params: [sub, month] }).filter((r) => r.status === "A" || r.status === "P");
		const out = {};
		for (const p of plans) out[p.id] = { priorPaid: {}, drawBalance: {} };
		if (!runs.length) return out;
		const runMonth = {};
		for (const r of runs) runMonth[r.id] = num(r.month);
		// Kết quả gần nhất theo (tháng, id) cho số dư ứng trước
		const latest = {};
		for (const x of Store.findIn("comm_result", "run", runs.map((r) => r.id))) {
			const st = out[x.plan];
			if (!st) continue;
			const m = runMonth[x.run];
			const emp = String(x.employee);
			if (m >= windowStart[x.plan]) st.priorPaid[emp] = num(st.priorPaid[emp]) + num(x.earned);
			const key = `${x.plan}|${emp}`;
			const prev = latest[key];
			if (!prev || m > prev.m || (m === prev.m && Number(x.id) > Number(prev.id))) {
				latest[key] = { m, id: x.id };
				st.drawBalance[emp] = num(x.draw_balance);
			}
		}
		return out;
	}

	/**
	 * Điều chỉnh tay của tháng: điều chỉnh có kế hoạch vào kế hoạch đó; không khai kế hoạch thì vào kế hoạch đầu tiên (id nhỏ
	 * nhất) mà nhân viên có phân công hiệu lực trong kỳ, không có thì trả về danh sách bỏ qua.
	 */
	function adjustmentsOf(month, plans, period) {
		const list = Store.find("comm_adjust", { where: "{month} = ?", params: [month] });
		const byPlan = {};
		const skipped = [];
		const planIds = new Set(plans.map((p) => String(p.id)));
		for (const a of list) {
			let plan = blank(a.plan) ? null : String(a.plan);
			if (plan && !planIds.has(plan)) continue;
			if (!plan) {
				const p = plans.slice().sort((x, y) => Number(x.id) - Number(y.id)).find((pl) => pl.assignments.some((s) => String(s.employee) === String(a.employee) && overlaps(s.effective, s.expiration, period.from, period.to)));
				if (!p) {
					skipped.push(a.id);
					continue;
				}
				plan = String(p.id);
			}
			(byPlan[plan] = byPlan[plan] || []).push({ id: a.id, employee: String(a.employee), amount: num(a.amount), reason: a.reason || "" });
		}
		return { byPlan, skipped };
	}

	/**
	 * Dữ liệu nguồn cho mọi kế hoạch của một lượt tính (số truy vấn cố định, không lặp theo kế hoạch): dòng chứng từ của cửa
	 * sổ rộng nhất, dòng thu tiền (một cột mỗi điểm đầu cửa sổ), dòng truy thu (một truy vấn mỗi số ngày truy thu khác nhau),
	 * đội bán, ngày mua đầu tiên, doanh số ngoài.
	 */
	function sourceData(sub, period, plans) {
		const starts = [period.from];
		const fields = [];
		const clawDays = [];
		let needNs = false;
		let needExt = false;
		let needPaid = false;
		for (const p of plans) {
			const src = p.source || "N";
			if (src !== "X") needNs = true;
			if (src === "X" || src === "B") needExt = true;
			if (!starts.includes(p.window_from)) starts.push(p.window_from);
			if (src !== "X" && p.trigger === "P") needPaid = true;
			if (src !== "X" && p.credit_source === "F" && !fields.includes(p.credit_field)) fields.push(p.credit_field);
			const n = num(p.clawback_days);
			if (src !== "X" && p.trigger !== "P" && n > 0 && !clawDays.includes(n)) clawDays.push(n);
		}
		starts.sort();
		const wFrom = starts[0];
		const docs = needNs ? docLines(sub, wFrom, period.to, fields) : [];
		const paid = needNs && needPaid ? paidLines(sub, starts, period.to, fields) : [];
		const claws = {};
		for (const n of clawDays) claws[n] = clawLines(sub, Dates.addDays(wFrom, -n), Dates.addDays(period.to, -n), period.to, fields);
		const all = docs.concat(paid, ...Object.values(claws));
		const teams = all.length ? salesTeams(all.map((r) => r.tran_id)) : {};
		const first = all.length ? firstSales(all.map((r) => r.customer)) : {};
		const ext = needExt ? externalTxns(sub, wFrom, period.to) : [];
		return { starts, fields, docs: docs.map((r) => nsRow(r, teams, first)), paid: paid.map((r) => nsRow(r, teams, first)), claws: Object.keys(claws).reduce((o, n) => ((o[n] = claws[n].map((r) => nsRow(r, teams, first))), o), {}), ext: ext.map(extRow) };
	}

	/**
	 * Dòng nguồn của một kế hoạch cho một khoảng [start, to] (cửa sổ hoặc kỳ), để đưa vào Engine.normalizeLines với cùng
	 * khoảng đó. Trigger I: chứng từ theo ngày; hóa đơn chưa thu đủ đến hạn truy thu (ngày chứng từ + N ngày) trong khoảng
	 * mang unpaidRatio - gắn vào chính dòng chứng từ nếu hóa đơn cũng nằm trong khoảng, ngược lại thêm dòng riêng (ngày
	 * chứng từ trước khoảng nên lõi chỉ sinh dòng truy thu). Trigger P: cash sale, credit memo theo ngày + hóa đơn x tỷ lệ thu
	 * từ start đến to. Ngoài (comm_txn): như trên; trigger P hóa đơn theo ngày thu x số thu / doanh thu (trống số thu = thu đủ).
	 */
	function planRows(plan, data, start, to) {
		const src = plan.source || "N";
		const inRange = (d) => !blank(d) && String(d) >= start && String(d) <= to;
		const field = plan.credit_source === "F" ? data.fields.indexOf(plan.credit_field) : -1;
		const credited = (row) => (field >= 0 ? str(row.raw && row.raw[`cf_${field}`]) : null);
		const out = [];
		if (src !== "X") {
			const byLine = {};
			for (const r of data.docs) {
				if (!inRange(r.date)) continue;
				if (plan.trigger === "P" && r.tranType === "I") continue;
				const row = clone(r, { creditEmployee: credited(r) });
				byLine[`${r.tranId}:${r.line}`] = row;
				out.push(row);
			}
			if (plan.trigger === "P") {
				const k = data.starts.indexOf(start);
				for (const r of data.paid) {
					const total = num(r.raw.ftotal);
					if (!(total > 0) || k < 0) continue;
					const ratio = Math.min(1, num(r.raw[`paid_${k}`]) / total);
					if (ratio > 0) out.push(clone(r, { creditEmployee: credited(r), collectedRatio: Math.round(ratio * 1e8) / 1e8 }));
				}
			} else if (num(plan.clawback_days) > 0) {
				const n = num(plan.clawback_days);
				for (const r of data.claws[n] || []) {
					const total = num(r.raw.ftotal);
					if (!(total > 0) || !inRange(Dates.addDays(r.date, n))) continue;
					const ratio = Math.round(Math.max(0, Math.min(1, (total - num(r.raw.paid)) / total)) * 1e8) / 1e8;
					if (!(ratio > 0)) continue;
					const own = byLine[`${r.tranId}:${r.line}`];
					if (own) own.unpaidRatio = ratio;
					else out.push(clone(r, { creditEmployee: credited(r), unpaidRatio: ratio }));
				}
			}
		}
		if (src === "X" || src === "B") {
			for (const r of data.ext) {
				const x = r.external;
				if (plan.trigger === "P" && r.tranType === "I") {
					if (!inRange(x.collected_date)) continue;
					const ratio = blank(x.collected_amount) || num(r.revenue) === 0 ? 1 : Math.max(0, Math.min(1, num(x.collected_amount) / num(r.revenue)));
					if (ratio > 0) out.push(clone(r, { collectedRatio: Math.round(ratio * 1e8) / 1e8, collectedDate: x.collected_date }));
					continue;
				}
				if (inRange(r.date)) out.push(clone(r));
			}
		}
		return out;
	}

	// ------------------------------------------------------------------ ghi kết quả

	const RESULT_NUM = ["quota", "base", "window_base", "attainment", "gross", "prior_paid", "earned", "override_amount", "adjustments", "capped", "draw_paid", "draw_recovered", "draw_balance", "payable"];

	/**
	 * Credit gọn cho detail: kind N dòng thường, P phần thu tiền (factor = tỷ lệ thu), K truy thu (factor âm = tỷ lệ chưa thu);
	 * creditDate ngày ghi nhận (ngày thu / ngày đến hạn truy thu); source "NetSuite" hoặc tên hệ thống ngoài.
	 */
	function compactCredit(c) {
		return {
			key: c.key || "", kind: c.kind || "N", tranId: c.tranId, tranNo: c.tranNo, tranType: c.tranType, date: c.date, creditDate: c.creditDate || c.date,
			customer: c.customer || "", customerName: c.customerName || "", item: c.item || "", itemName: c.itemName || "", classId: c.classId || "", department: c.department || "",
			location: c.location || "", project: c.project || "", revenue: c.revenue, factor: c.factor === undefined ? 1 : c.factor, pct: c.pct, base: c.base, qty: c.qty,
			source: c.sourceSystem || "NetSuite",
		};
	}

	/** Kết quả của lõi -> giá trị record comm_result; detail mở đầu bằng warningCount để lưới đọc nhanh bằng SUBSTR. */
	function resultValues(runId, planId, r, credits) {
		const mine = credits.filter((c) => String(c.employee) === String(r.employee));
		const warnings = r.warnings || [];
		const detail = {
			warningCount: warnings.length,
			components: r.components || [], steps: r.steps || [], shares: r.shares || [], overrides: r.overrides || [], warnings,
			qty: r.qty === undefined ? null : r.qty, windowQty: r.windowQty === undefined ? null : r.windowQty, window: r.window || null,
			credits: mine.slice(0, MAX_CREDITS).map(compactCredit), creditsTotal: mine.length,
		};
		const v = { run: String(runId), employee: String(r.employee), plan: String(planId), earning_type: r.earningType || "" };
		const src = { quota: r.quota, base: r.base, window_base: r.windowBase, attainment: r.attainment, gross: r.gross, prior_paid: r.priorPaid, earned: r.earned, override_amount: r.override, adjustments: r.adjustments, capped: r.capped, draw_paid: r.drawPaid, draw_recovered: r.drawRecovered, draw_balance: r.drawBalance, payable: r.payable };
		for (const k of RESULT_NUM) v[k] = blank(src[k]) ? 0 : Number(src[k]) || 0;
		v.detail = JSON.stringify(detail);
		return v;
	}

	const sameValues = (row, values) => !row.isInactive && Object.keys(values).every((k) => (RESULT_NUM.includes(k) ? num(row[k]) === num(values[k]) : String(blank(row[k]) ? "" : row[k]) === String(blank(values[k]) ? "" : values[k])));

	/** Cửa sổ của kế hoạch (lõi windowOf) - đầu cửa sổ dùng để chọn dòng và tính đã trả kỳ trước. */
	function windowOf(plan, period) {
		const w = typeof Engine.windowOf === "function" ? Engine.windowOf(plan, period.from, period.to) : { from: period.from, to: period.to };
		return w && isIso(w.from) && w.from <= period.from ? w.from : period.from;
	}

	/**
	 * Tính (lại) bảng tính hoa hồng nháp của công ty con và tháng. Bảng đã duyệt / đã vào lương thì từ chối (mở lại trước).
	 * @returns {{run, name, status, month, from, to, employees, totalBase, totalAmount, created, updated, unchanged, inactivated, plans, warnings, more?}}
	 */
	function calculate(subsidiary, month, from, to) {
		const sub = subsidiaryOf(subsidiary);
		const period = periodOf(month, from, to);
		let run = activeRun(sub, period.month);
		if (run && run.status === "P") throw fail("The commission run is already included in payroll", "Bảng tính hoa hồng đã vào bảng lương");
		if (run && run.status === "A") throw fail("The commission run is approved; reopen it before recalculating", "Bảng tính hoa hồng đã duyệt, cần mở lại trước khi tính lại");
		const plans = plansFor(sub)
			.filter((p) => overlaps(p.effective, p.expiration, period.from, period.to) && p.assignments.length)
			.map((p) => Object.assign(p, { window_from: windowOf(p, period) }));
		for (const p of plans) {
			if (p.credit_source === "F" && (p.source || "N") !== "X" && !CREDIT_FIELD.test(String(p.credit_field || ""))) {
				throw fail(`Plan ${p.name}: the credit field must be a transaction body field id (custbody...)`, `Kế hoạch ${p.name}: trường ghi nhận phải là id trường body của chứng từ (custbody...)`);
			}
		}
		const data = plans.length ? sourceData(sub, period, plans) : null;
		const windowStart = {};
		for (const p of plans) windowStart[p.id] = monthNo(p.window_from);
		const prior = priorState(sub, period.month, plans, windowStart);
		const adj = adjustmentsOf(period.month, plans, period);
		const names = plans.length ? employeeNames([].concat(...plans.map((p) => p.assignments.map((a) => a.employee).concat(p.assignments.map((a) => a.manager))))) : {};
		const nameMap = {};
		for (const k of Object.keys(names)) nameMap[k] = names[k].name || names[k].code;

		// Kết quả theo kế hoạch
		const produced = [];
		const warnings = [];
		const credited = new Set();
		const loose = {};
		for (const p of plans) {
			const curLines = Engine.normalizeLines(planRows(p, data, period.from, period.to), p, { from: period.from, to: period.to });
			const credits = Engine.credit(curLines, p, p.assignments, period.to);
			// Cửa sổ tháng: credit của cửa sổ chính là credit của kỳ
			const windowCredits = p.window_from === period.from ? credits : Engine.credit(Engine.normalizeLines(planRows(p, data, p.window_from, period.to), p, { from: p.window_from, to: period.to }), p, p.assignments, period.to);
			const out = Engine.calculate({
				plan: p, rules: p.rules, tiers: [].concat(...p.rules.map((r) => r.tiers)), assignments: p.assignments, quotas: p.quotas, credits, windowCredits,
				priorPaid: prior[p.id].priorPaid, drawBalance: prior[p.id].drawBalance, adjustments: adj.byPlan[p.id] || [], from: period.from, to: period.to, names: nameMap,
			});
			for (const r of (out && out.results) || []) {
				produced.push({ plan: p, result: r, credits });
				for (const w of r.warnings || []) warnings.push({ code: w.code, vi: w.vi, en: w.en, employee: String(r.employee), plan: String(p.id) });
			}
			for (const c of credits) credited.add(String(c.employee));
			for (const u of Engine.uncredited(curLines, p, p.assignments, period.to)) if (!loose[u.employee]) loose[u.employee] = u;
		}
		// Doanh số không ai được ghi nhận ở bất kỳ kế hoạch nào (người bán chưa phân công, chứng từ không có người bán)
		const looseIds = Object.keys(loose).filter((e) => e && !credited.has(e));
		const looseNames = looseIds.length ? employeeNames(looseIds) : {};
		for (const u of Object.values(loose)) {
			if (u.employee && credited.has(u.employee)) continue;
			const who = u.employee && looseNames[u.employee] ? [looseNames[u.employee].code, looseNames[u.employee].name].filter(Boolean).join(" - ") : u.employee;
			const amount = Engine.fmt(u.base, "vi", 0);
			if (!u.employee) {
				warnings.push({ code: "NO_SALES_REP", vi: `${u.docs} chứng từ (cơ sở ${amount}) không có người bán, không ai được ghi nhận`, en: `${u.docs} document(s) (base ${Engine.fmt(u.base, "en", 0)}) have no sales rep and were not credited` });
			} else {
				warnings.push({ code: "UNASSIGNED", employee: u.employee, vi: `Người bán ${who} chưa được phân công vào kế hoạch nào: ${u.docs} chứng từ, cơ sở ${amount}`, en: `Sales rep ${who} is not assigned to any plan: ${u.docs} document(s), base ${Engine.fmt(u.base, "en", 0)}` });
			}
		}
		if (adj.skipped.length) warnings.push({ code: "ADJ_NO_PLAN", vi: `${adj.skipped.length} điều chỉnh không có kế hoạch phù hợp, chưa đưa vào`, en: `${adj.skipped.length} adjustment(s) without a matching plan were skipped` });

		// Ghi bảng tính và kết quả
		const gov = budget();
		const header = { subsidiary: sub, month: period.month, date_from: period.from, date_to: period.to, status: "D" };
		if (!run) {
			const id = Store.create("comm_run", Object.assign({ name: `HH${period.month}-${sub}`, calc_at: "", total_base: 0, total_amount: 0, employees: 0 }, header));
			run = Object.assign({ id, name: `HH${period.month}-${sub}` }, header);
		} else if (run.date_from !== period.from || run.date_to !== period.to || !blank(run.calc_at)) {
			Store.submit("comm_run", run.id, { date_from: period.from, date_to: period.to, calc_at: "" });
		}
		const existing = Store.find("comm_result", { where: "{run} = ?", params: [run.id], includeInactive: true });
		const byKey = {};
		for (const x of existing) {
			const key = `${x.employee}|${x.plan}`;
			// Trùng khóa (không nên có): giữ dòng đang hoạt động / id nhỏ, dòng còn lại bị vô hiệu ở cuối
			if (!byKey[key] || (byKey[key].isInactive && !x.isInactive)) byKey[key] = x;
		}
		const keep = new Set();
		const counts = { created: 0, updated: 0, unchanged: 0, inactivated: 0 };
		let totalBase = 0;
		let totalAmount = 0;
		const people = new Set();
		let more = false;
		for (const item of produced) {
			const values = resultValues(run.id, item.plan.id, item.result, item.credits);
			const key = `${values.employee}|${values.plan}`;
			totalBase += values.base;
			totalAmount += values.payable;
			people.add(values.employee);
			const cur = byKey[key];
			if (cur) keep.add(cur.id);
			if (cur && sameValues(cur, values)) {
				counts.unchanged++;
				continue;
			}
			if (gov.low()) {
				more = true;
				break;
			}
			if (!cur) {
				const id = Store.create("comm_result", values);
				keep.add(id);
				counts.created++;
			} else if (cur.isInactive) {
				Store.update("comm_result", cur.id, Object.assign({ isInactive: false }, values));
				counts.updated++;
			} else {
				const changed = {};
				for (const k of Object.keys(values)) if (!sameValues(Object.assign({}, cur, { isInactive: false }), { [k]: values[k] })) changed[k] = values[k];
				Store.submit("comm_result", cur.id, changed);
				counts.updated++;
			}
		}
		const summary = { run: String(run.id), name: run.name || `HH${period.month}-${sub}`, status: "D", month: period.month, from: period.from, to: period.to, plans: plans.length, warnings };
		if (!more) {
			for (const x of existing) {
				if (x.isInactive || keep.has(x.id)) continue;
				if (gov.low()) {
					more = true;
					break;
				}
				Store.update("comm_result", x.id, { isInactive: true });
				counts.inactivated++;
			}
		}
		if (more) return Object.assign(summary, counts, { employees: people.size, totalBase: 0, totalAmount: 0, more: true });
		// Cảnh báo cấp bảng tính (không gắn kế hoạch) lưu lại để màn hình hiện cả sau khi tải lại
		const runLevel = warnings.filter((w) => !w.plan).slice(0, 200);
		Store.submit("comm_run", run.id, {
			total_base: Math.round(totalBase * 100) / 100, total_amount: Math.round(totalAmount), employees: people.size, calc_at: new Date().toISOString(), warnings: JSON.stringify(runLevel),
		});
		return Object.assign(summary, counts, { employees: people.size, totalBase: Math.round(totalBase * 100) / 100, totalAmount: Math.round(totalAmount) });
	}

	/** Duyệt bảng tính nháp đã tính xong (D -> A), ghi người duyệt. */
	function approve(runId) {
		const r = runOf(runId);
		if (r.status !== "D") throw fail("Only a calculated draft run can be approved", "Chỉ duyệt được bảng tính nháp đã tính");
		if (blank(r.calc_at)) throw fail("The calculation has not finished; calculate again", "Bảng tính chưa tính xong, hãy tính lại");
		const by = currentEmployee();
		Store.submit("comm_run", r.id, { status: "A", approved_by: by });
		return { run: String(r.id), name: r.name || "", status: "A", approvedBy: by };
	}

	/** Mở lại bảng tính đã duyệt (A -> D); đã vào bảng lương (P) thì từ chối. */
	function reopen(runId) {
		const r = runOf(runId);
		if (r.status === "P") throw fail("The run is included in payroll; reverse the payroll first", "Bảng tính đã vào bảng lương, cần đảo bảng lương trước");
		if (r.status !== "A") throw fail("Only an approved run can be reopened", "Chỉ mở lại được bảng tính đã duyệt");
		Store.submit("comm_run", r.id, { status: "D", approved_by: null });
		return { run: String(r.id), name: r.name || "", status: "D" };
	}

	/** Hủy bảng tính (isinactive, lý do ghi vào note); đã vào bảng lương thì từ chối. Không xóa kết quả. */
	function voidRun(runId, reason) {
		const r = runOf(runId);
		if (r.status === "P") throw fail("The run is included in payroll; reverse the payroll first", "Bảng tính đã vào bảng lương, cần đảo bảng lương trước");
		const text = String(blank(reason) ? "" : reason).trim();
		if (!text) throw fail("Enter the reason for voiding the run", "Nhập lý do hủy bảng tính");
		const note = `${blank(r.note) ? "" : `${r.note}\n`}[${Clock.today()}] Void: ${text.slice(0, 1000)}`;
		Store.update("comm_run", r.id, { isInactive: true, note });
		return { run: String(r.id), name: r.name || "", status: r.status, voided: true, reason: text.slice(0, 1000) };
	}

	// ------------------------------------------------------------------ lưu kế hoạch

	function pick(src, keys, name) {
		const out = {};
		for (const k of keys) {
			if (!Object.prototype.hasOwnProperty.call(src || {}, k)) continue;
			if (name && !hasField(name, k)) continue;
			out[k] = src[k] === undefined ? null : src[k];
		}
		return out;
	}

	function checkDate(v, en, vi) {
		if (blank(v)) return null;
		if (!isIso(v)) throw fail(`${en} must be YYYY-MM-DD`, `${vi} phải dạng YYYY-MM-DD`);
		return String(v);
	}

	function checkList(key, v, required, label) {
		if (blank(v)) {
			if (required) throw fail(`${label.en} is required`, `Chưa chọn ${label.vi}`);
			return null;
		}
		if (!LISTS[key].includes(String(v))) throw fail(`${label.en}: unknown value ${v}`, `${label.vi}: giá trị không hợp lệ ${v}`);
		return String(v);
	}

	function idsText(v, label) {
		if (blank(v)) return "";
		const s = String(v).replace(/\s+/g, "");
		if (!IDLIST.test(s)) throw fail(`${label.en}: comma separated internal ids`, `${label.vi}: các id nội bộ cách nhau dấu phẩy`);
		return s;
	}

	function numberOrNull(v, label) {
		if (blank(v)) return null;
		const n = Number(v);
		if (!isFinite(n)) throw fail(`${label.en} must be a number`, `${label.vi} phải là số`);
		return n;
	}

	function cleanPlan(input) {
		const v = pick(input, PLAN_KEYS, "comm_plan");
		const name = String(blank(input.name) ? "" : input.name).trim();
		if (!name) throw fail("Plan code is required", "Chưa nhập mã kế hoạch");
		v.name = name.slice(0, 100);
		if (!blank(v.subsidiary) && !isId(v.subsidiary)) throw fail("Unknown subsidiary", "Công ty con không hợp lệ");
		v.effective = checkDate(v.effective, "Effective date", "Ngày hiệu lực");
		v.expiration = checkDate(v.expiration, "Expiration date", "Ngày hết hiệu lực");
		if (v.effective && v.expiration && v.expiration < v.effective) throw fail("Expiration is before the effective date", "Ngày hết hiệu lực trước ngày hiệu lực");
		v.basis = checkList("basis", v.basis, true, { en: "Basis", vi: "cơ sở tính" });
		v.trigger = checkList("trigger", v.trigger, true, { en: "Trigger", vi: "thời điểm ghi nhận" });
		v.credit_source = checkList("credit_source", v.credit_source, true, { en: "Credit source", vi: "nguồn ghi nhận" });
		v.window = checkList("window", v.window, true, { en: "Window", vi: "cửa sổ tính" });
		if ("draw_type" in v) v.draw_type = checkList("draw_type", v.draw_type, false, { en: "Draw type", vi: "loại ứng trước" }) || "N";
		if ("override_basis" in v) v.override_basis = checkList("override_basis", v.override_basis, false, { en: "Override basis", vi: "cơ sở hoa hồng quản lý" });
		if ("source" in v) v.source = checkList("source", v.source, false, { en: "Data source", vi: "nguồn dữ liệu" }) || "N";
		if (v.credit_source === "F") {
			const f = String(blank(v.credit_field) ? "" : v.credit_field).trim().toLowerCase();
			if (!CREDIT_FIELD.test(f)) throw fail("Credit field must be a transaction body field id (custbody...)", "Trường ghi nhận phải là id trường body của chứng từ (custbody...)");
			v.credit_field = f;
		} else if ("credit_field" in v) v.credit_field = blank(v.credit_field) ? "" : String(v.credit_field).trim().toLowerCase();
		if (blank(v.earning_type) || !String(v.earning_type).trim()) throw fail("Payroll earning type is required", "Chưa chọn loại thu nhập lương");
		v.earning_type = String(v.earning_type).trim().toUpperCase();
		for (const [k, en, vi] of [["clawback_days", "Clawback days", "Số ngày truy thu"], ["min_attainment", "Minimum attainment", "Ngưỡng % đạt"], ["cap_amount", "Cap", "Trần"], ["draw_amount", "Draw amount", "Số tiền draw"], ["override_pct", "Override rate", "Tỷ lệ quản lý"]]) {
			if (k in v) v[k] = numberOrNull(v[k], { en, vi });
		}
		if (num(v.clawback_days) < 0) throw fail("Clawback days cannot be negative", "Số ngày truy thu không được âm");
		if ("include_returns" in v) v.include_returns = v.include_returns !== false && v.include_returns !== "F";
		if ("isInactive" in (input || {})) v.isInactive = !!input.isInactive;
		return v;
	}

	function cleanRule(input, index) {
		const v = pick(input, RULE_KEYS);
		const name = String(blank(input.name) ? "" : input.name).trim();
		const label = name || `#${index + 1}`;
		if (!name) throw fail(`Component ${label}: name is required`, `Thành phần ${label}: chưa nhập tên`);
		v.name = name.slice(0, 100);
		v.method = checkList("method", v.method, true, { en: `Component ${label}: method`, vi: `phương pháp của thành phần ${label}` });
		for (const [k, en, vi] of [["f_items", "item filter", "lọc mặt hàng"], ["f_classes", "class filter", "lọc class"], ["f_departments", "department filter", "lọc phòng ban"], ["f_locations", "location filter", "lọc địa điểm"], ["f_cust_categories", "customer category filter", "lọc nhóm khách"]]) {
			if (k in v) v[k] = idsText(v[k], { en: `Component ${label}: ${en}`, vi: `Thành phần ${label}: ${vi}` });
		}
		if ("f_new_customer" in v) v.f_new_customer = !!v.f_new_customer && v.f_new_customer !== "F";
		for (const k of ["sequence", "new_days", "rate", "unit_amount"]) if (k in v) v[k] = numberOrNull(v[k], { en: `Component ${label}: ${k}`, vi: `Thành phần ${label}: ${k}` });
		if (v.sequence === null || v.sequence === undefined) v.sequence = (index + 1) * 10;
		return v;
	}

	function cleanTier(input, label) {
		const v = pick(input, TIER_KEYS);
		for (const k of TIER_KEYS) if (k in v) v[k] = numberOrNull(v[k], { en: `Tier of ${label}: ${k}`, vi: `Bậc của ${label}: ${k}` });
		if (blank(v.from_value)) v.from_value = 0;
		return v;
	}

	function cleanAssign(input) {
		const v = pick(input, ASSIGN_KEYS);
		if (!isId(v.employee)) throw fail("Assignment: select an employee", "Phân công: chưa chọn nhân viên");
		v.employee = String(v.employee);
		v.effective = checkDate(v.effective, "Assignment effective date", "Ngày hiệu lực phân công");
		v.expiration = checkDate(v.expiration, "Assignment expiration date", "Ngày hết hiệu lực phân công");
		if (v.effective && v.expiration && v.expiration < v.effective) throw fail("Assignment expiration is before the effective date", "Phân công: ngày hết hiệu lực trước ngày hiệu lực");
		if ("manager" in v) v.manager = isId(v.manager) ? String(v.manager) : null;
		if (v.manager && v.manager === v.employee) throw fail("An employee cannot be his own manager", "Nhân viên không thể là quản lý của chính mình");
		if ("quota" in v) v.quota = numberOrNull(v.quota, { en: "Assignment quota", vi: "Chỉ tiêu phân công" });
		return v;
	}

	function cleanQuota(input) {
		const v = pick(input, QUOTA_KEYS);
		if (!isId(v.employee)) throw fail("Monthly quota: select an employee", "Chỉ tiêu tháng: chưa chọn nhân viên");
		v.employee = String(v.employee);
		const m = String(blank(v.month) ? "" : v.month).replace("-", "");
		if (!/^\d{6}$/.test(m) || +m.slice(4) < 1 || +m.slice(4) > 12) throw fail("Monthly quota: month must be YYYYMM", "Chỉ tiêu tháng: tháng phải dạng YYYYMM");
		v.month = Number(m);
		v.quota = numberOrNull(v.quota, { en: "Monthly quota", vi: "Chỉ tiêu tháng" }) || 0;
		return v;
	}

	/**
	 * Đồng bộ dòng con: dòng có id cập nhật (id phải thuộc cha), dòng không id tạo mới, dòng đang hoạt động không còn trong
	 * danh sách -> isinactive. Trả {ids: [id theo thứ tự đầu vào], created, updated, inactivated}.
	 */
	function syncChildren(name, parentKey, parentId, existing, items) {
		const own = {};
		for (const x of existing) own[x.id] = x;
		const out = { ids: [], created: 0, updated: 0, inactivated: 0 };
		const seen = new Set();
		for (const it of items) {
			const values = Object.assign({}, it.values, { [parentKey]: String(parentId) });
			if (!blank(it.id)) {
				const cur = own[String(it.id)];
				if (!cur) throw fail(`${name} ${it.id} does not belong to this plan`, `Dòng ${it.id} không thuộc kế hoạch này`);
				seen.add(String(it.id));
				Store.update(name, cur.id, Object.assign({ isInactive: false }, values));
				out.ids.push(String(cur.id));
				out.updated++;
			} else {
				const id = Store.create(name, values);
				out.ids.push(String(id));
				out.created++;
			}
		}
		for (const x of existing) {
			if (x.isInactive || seen.has(String(x.id))) continue;
			Store.update(name, x.id, { isInactive: true });
			out.inactivated++;
		}
		return out;
	}

	const findAll = (name, field, ids) => (ids.length ? Store.find(name, { where: `{${field}} IN (${ids.map(() => "?").join(",")})`, params: ids, includeInactive: true }) : []);

	/**
	 * Tạo / sửa kế hoạch cùng thành phần, bậc thang, phân công, chỉ tiêu tháng. Danh sách con không truyền (undefined) thì giữ
	 * nguyên; truyền mảng thì đồng bộ (dòng bỏ đi -> isinactive). Bậc thang: rules[].tiers (ưu tiên) hoặc tiers[] với rule
	 * (id thành phần) hoặc ruleKey (= rules[].key của thành phần mới trong cùng lượt lưu).
	 * @returns {{id, name, rules: [{key, id}], counts: {rules, tiers, assignments, quotas, inactivated}}}
	 */
	function planSave(body) {
		const b = body || {};
		const input = b.plan || {};
		const values = cleanPlan(input);
		const rules = Array.isArray(b.rules) ? b.rules.map((r, i) => ({ key: blank(r.key) ? null : String(r.key), id: blank(r.id) ? null : String(r.id), values: cleanRule(r, i), tiers: Array.isArray(r.tiers) ? r.tiers : null, label: String(r.name || `#${i + 1}`) })) : null;
		const assigns = Array.isArray(b.assignments) ? b.assignments.map((a) => ({ id: blank(a.id) ? null : String(a.id), values: cleanAssign(a) })) : null;
		const quotas = Array.isArray(b.quotas) ? b.quotas.map((q) => ({ id: blank(q.id) ? null : String(q.id), values: cleanQuota(q) })) : null;
		if (quotas) {
			const keys = new Set();
			for (const q of quotas) {
				const k = `${q.values.employee}|${q.values.month}`;
				if (keys.has(k)) throw fail(`Duplicate monthly quota ${q.values.month}`, `Trùng chỉ tiêu tháng ${q.values.month} của một nhân viên`);
				keys.add(k);
			}
		}
		// Trùng mã kế hoạch đang hoạt động
		const same = Store.find("comm_plan", { where: "{name} = ?", params: [values.name] }).filter((p) => String(p.id) !== String(input.id || ""));
		if (same.length) throw fail(`Plan code ${values.name} already exists`, `Mã kế hoạch ${values.name} đã có`);

		// Kiểm toàn bộ trước khi ghi (không để lại kế hoạch ghi dở khi một dòng con sai)
		let id = blank(input.id) ? null : String(input.id);
		if (id && (!isId(id) || !Store.get("comm_plan", id))) throw fail("Commission plan not found", "Không tìm thấy kế hoạch hoa hồng");
		const oldRules = id ? findAll("comm_rule", "plan", [id]) : [];
		const oldAssigns = id && assigns ? findAll("comm_assign", "plan", [id]) : [];
		const oldQuotas = id && quotas ? findAll("comm_quota", "plan", [id]) : [];
		const owns = (list, x) => blank(x.id) || list.some((o) => String(o.id) === String(x.id));
		const foreign = (rules || []).find((x) => !owns(oldRules, x)) || (assigns || []).find((x) => !owns(oldAssigns, x)) || (quotas || []).find((x) => !owns(oldQuotas, x));
		if (foreign) throw fail(`Row ${foreign.id} does not belong to this plan`, `Dòng ${foreign.id} không thuộc kế hoạch này`);
		// Thành phần còn dùng sau lượt lưu: theo danh sách gửi lên, hoặc thành phần đang hoạt động khi không gửi rules
		const liveRuleIds = new Set(rules ? rules.filter((x) => x.id).map((x) => x.id) : oldRules.filter((r) => !r.isInactive).map((r) => String(r.id)));
		const ruleKeys = new Set((rules || []).filter((x) => x.key).map((x) => x.key));
		const loose = [];
		if (Array.isArray(b.tiers)) {
			for (const t of b.tiers) {
				const key = !blank(t.ruleKey) ? String(t.ruleKey) : null;
				const rid = key ? null : blank(t.rule) ? null : String(t.rule);
				if (key ? !ruleKeys.has(key) : !rid || !liveRuleIds.has(rid)) throw fail("Tier: unknown component", "Bậc thang: thành phần không hợp lệ");
				loose.push({ key, rid, values: cleanTier(t, key || rid), id: blank(t.id) ? null : String(t.id) });
			}
		}
		const nested = (rules || []).map((x) => (x.tiers ? x.tiers.map((t) => ({ id: blank(t.id) ? null : String(t.id), values: cleanTier(t, x.label) })) : null));
		const tierRuleRefs = [...new Set((rules || []).filter((x, i) => x.id && nested[i]).map((x) => x.id).concat(loose.filter((t) => t.rid).map((t) => t.rid)))];
		const oldTiers = tierRuleRefs.length ? findAll("comm_tier", "rule", tierRuleRefs) : [];
		const badTier = (rules || []).reduce((bad, x, i) => bad || (nested[i] || []).find((t) => t.id && !(x.id && oldTiers.some((o) => String(o.id) === t.id && String(o.rule) === x.id))), null)
			|| loose.find((t) => t.id && !(t.rid && oldTiers.some((o) => String(o.id) === t.id && String(o.rule) === t.rid)));
		if (badTier) throw fail(`Tier ${badTier.id} does not belong to its component`, `Bậc ${badTier.id} không thuộc thành phần này`);

		if (id) Store.update("comm_plan", id, values);
		else id = Store.create("comm_plan", values);

		const counts = { rules: 0, tiers: 0, assignments: 0, quotas: 0, inactivated: 0 };
		const ruleIds = [];
		const keyToId = {};
		if (rules) {
			const r = syncChildren("comm_rule", "plan", id, oldRules, rules.map((x) => ({ id: x.id, values: x.values })));
			rules.forEach((x, i) => {
				ruleIds.push({ key: x.key, id: r.ids[i] });
				if (x.key) keyToId[x.key] = r.ids[i];
			});
			counts.rules = rules.length;
			counts.inactivated += r.inactivated;
		}
		// Bậc thang theo thành phần: rules[].tiers rồi tiers[] (rule / ruleKey)
		const tierSets = {};
		(rules || []).forEach((x, i) => nested[i] && (tierSets[ruleIds[i].id] = nested[i].slice()));
		for (const t of loose) {
			const rid = t.key ? keyToId[t.key] : t.rid;
			(tierSets[rid] = tierSets[rid] || []).push({ id: t.id, values: t.values });
		}
		for (const rid of Object.keys(tierSets)) {
			const r = syncChildren("comm_tier", "rule", rid, oldTiers.filter((x) => String(x.rule) === rid), tierSets[rid]);
			counts.tiers += tierSets[rid].length;
			counts.inactivated += r.inactivated;
		}
		if (assigns) {
			const r = syncChildren("comm_assign", "plan", id, oldAssigns, assigns);
			counts.assignments = assigns.length;
			counts.inactivated += r.inactivated;
		}
		if (quotas) {
			const r = syncChildren("comm_quota", "plan", id, oldQuotas, quotas);
			counts.quotas = quotas.length;
			counts.inactivated += r.inactivated;
		}
		return { id: String(id), name: values.name, rules: ruleIds, counts };
	}

	// ------------------------------------------------------------------ điều chỉnh, mô phỏng

	/** Điều chỉnh tay (âm được), lý do bắt buộc; tháng đã có bảng tính duyệt / vào lương của công ty con của kế hoạch thì từ chối. */
	function adjust(body) {
		const b = body || {};
		if (!isId(b.employee)) throw fail("Select an employee", "Chưa chọn nhân viên");
		const period = periodOf(b.month);
		const amount = Number(b.amount);
		if (blank(b.amount) || !isFinite(amount) || amount === 0) throw fail("Enter a non-zero amount", "Nhập số tiền điều chỉnh khác 0");
		const reason = String(blank(b.reason) ? "" : b.reason).trim();
		if (!reason) throw fail("Enter the reason for the adjustment", "Nhập lý do điều chỉnh");
		let plan = null;
		if (!blank(b.plan)) {
			if (!isId(b.plan)) throw fail("Commission plan not found", "Không tìm thấy kế hoạch hoa hồng");
			plan = Store.get("comm_plan", b.plan);
			if (!plan) throw fail("Commission plan not found", "Không tìm thấy kế hoạch hoa hồng");
		}
		const sub = plan && !blank(plan.subsidiary) ? String(plan.subsidiary) : isId(b.subsidiary) ? String(b.subsidiary) : null;
		if (sub) {
			const run = activeRun(sub, period.month);
			if (run && (run.status === "A" || run.status === "P")) throw fail("The commission run of this month is approved; reopen it first", "Bảng tính hoa hồng của tháng đã duyệt, cần mở lại trước");
		}
		const values = { employee: String(b.employee), plan: plan ? String(plan.id) : null, month: period.month, amount: Math.round(amount), reason: reason.slice(0, 4000) };
		const id = Store.create("comm_adjust", values);
		return Object.assign({ id: String(id) }, values);
	}

	/** Mô phỏng một kế hoạch với cơ sở / số lượng / chỉ tiêu nhập tay (không đọc giao dịch, không ghi). */
	function simulate(params) {
		const p = params || {};
		if (!isId(p.plan)) throw fail("Select a commission plan", "Chưa chọn kế hoạch hoa hồng");
		const plan = Store.get("comm_plan", p.plan);
		if (!plan) throw fail("Commission plan not found", "Không tìm thấy kế hoạch hoa hồng");
		const full = plansWithChildren([plan])[0];
		const base = Number(blank(p.base) ? 0 : p.base);
		const qty = Number(blank(p.qty) ? 0 : p.qty);
		const quota = blank(p.quota) ? null : Number(p.quota);
		if (!isFinite(base) || !isFinite(qty) || (quota !== null && !isFinite(quota))) throw fail("Base, quantity and quota must be numbers", "Doanh số, số lượng, chỉ tiêu phải là số");
		const out = Engine.simulate({ plan: full, rules: full.rules, tiers: [].concat(...full.rules.map((r) => r.tiers)), base, qty, quota });
		return { plan: String(plan.id), planName: plan.name || "", base, qty, quota, amount: num(out && out.amount), components: (out && out.components) || [], steps: (out && out.steps) || [], warnings: (out && out.warnings) || [] };
	}

	// ------------------------------------------------------------------ doanh số ngoài (comm_txn)

	const TXN_TEXT = ["customer_code", "customer_name", "customer_category", "item_code", "item_type", "import_batch", "note"];
	const TXN_NUM = ["revenue", "cost", "qty", "collected_amount"];
	// Phân đoạn trong file: id nội bộ, hoặc tên / tên đầy đủ (không phân biệt hoa thường); dự án chỉ nhận id nội bộ
	const TXN_SEGMENTS = { class: { table: "classification", en: "Class", vi: "Class" }, department: { table: "department", en: "Department", vi: "Phòng ban" }, location: { table: "location", en: "Location", vi: "Địa điểm" } };

	function parseNumber(v) {
		if (blank(v)) return null;
		if (typeof v === "number") return isFinite(v) ? v : NaN;
		const s = String(v).trim().replace(/\s+/g, "").replace(/,/g, "");
		return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
	}

	function parseDate(v) {
		if (blank(v)) return null;
		try {
			const d = Dates.iso(v);
			const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && Dates.iso(Dates.fromDay(Dates.toDay(d))) === d;
			return ok ? d : undefined;
		} catch (e) {
			return undefined;
		}
	}

	/** Bảng tính đã duyệt / đã vào lương của công ty con: khoảng ngày bị khóa. */
	function lockedRanges(sub) {
		return Store.find("comm_run", { where: "{subsidiary} = ?", params: [sub] })
			.filter((r) => r.status === "A" || r.status === "P")
			.map((r) => ({ from: r.date_from, to: r.date_to, name: r.name || "" }));
	}

	const lockedBy = (ranges, dates) => ranges.find((r) => dates.some((d) => !blank(d) && !blank(r.from) && !blank(r.to) && d >= r.from && d <= r.to)) || null;

	/** Dò nhân viên theo mã (entityid) hoặc email công việc; một truy vấn mỗi lô 450 mã. {KEY: [id...]} */
	function lookupEmployees(codes) {
		const want = [...new Set(codes.filter((c) => !blank(c)).map((c) => String(c).trim()).filter(Boolean))];
		const out = {};
		for (const part of chunks(want, 450)) {
			const up = part.map((c) => c.toUpperCase());
			const low = part.map((c) => c.toLowerCase());
			const rows = Store.run(
				`SELECT e.id AS id, e.entityid AS code, e.email AS email FROM employee e WHERE UPPER(e.entityid) IN (${up.map(() => "?").join(",")}) OR LOWER(e.email) IN (${low.map(() => "?").join(",")})`,
				up.concat(low), "s4vp_cm_emp_lookup"
			);
			for (const r of rows) {
				for (const k of [String(r.code || "").toUpperCase(), String(r.email || "").toUpperCase()]) {
					if (!k) continue;
					const list = (out[k] = out[k] || []);
					if (!list.includes(String(r.id))) list.push(String(r.id));
				}
			}
		}
		return out;
	}

	const msg = (en, vi) => ({ en, vi });

	/**
	 * Dò class / phòng ban / địa điểm theo id nội bộ hoặc tên / tên đầy đủ (không phân biệt hoa thường): một truy vấn cho cả lô
	 * (mỗi 400 giá trị). Trả hàm resolve(value) -> {id} | {id: null, missing} | {id: null, ambiguous}; trống -> {id: null}.
	 */
	function lookupSegments(kind, values) {
		const table = TXN_SEGMENTS[kind].table;
		const want = [...new Set(values.filter((v) => !blank(v)).map((v) => String(v).trim()).filter(Boolean))];
		const byId = {};
		const byName = {};
		for (const part of chunks(want, 400)) {
			const names = part.map((v) => v.toUpperCase());
			const ids = idList(part);
			const rows = Store.run(
				`SELECT x.id AS id, x.name AS name, x.fullname AS fullname FROM ${table} x WHERE UPPER(x.name) IN (${names.map(() => "?").join(",")}) OR UPPER(x.fullname) IN (${names.map(() => "?").join(",")})` + (ids.length ? ` OR x.id IN (${ids.join(",")})` : ""),
				names.concat(names), `s4vp_cm_seg_${kind}`
			);
			for (const r of rows) {
				byId[String(r.id)] = true;
				for (const n of new Set([String(r.name || "").toUpperCase(), String(r.fullname || "").toUpperCase()])) {
					if (!n) continue;
					const list = (byName[n] = byName[n] || []);
					if (!list.includes(String(r.id))) list.push(String(r.id));
				}
			}
		}
		return (v) => {
			if (blank(v) || !String(v).trim()) return { id: null };
			const s = String(v).trim();
			if (/^\d+$/.test(s) && byId[s]) return { id: s };
			const hit = byName[s.toUpperCase()] || [];
			if (hit.length === 1) return { id: hit[0] };
			return hit.length > 1 ? { id: null, ambiguous: true } : { id: null, missing: true };
		};
	}

	/** Mã, họ tên, phòng ban (id) của nhân viên theo id: {id: {code, name, department}}; một truy vấn mỗi 900 id. */
	function employeeNames(ids) {
		const out = {};
		for (const part of chunks(idList(ids), 900)) {
			for (const e of Store.run(`SELECT e.id AS id, e.entityid AS code, e.firstname AS first, e.lastname AS last, e.department AS department FROM employee e WHERE e.id IN (${part.join(",")})`, [], "s4vp_cm_emp_names")) {
				out[String(e.id)] = { code: e.code || "", name: [e.last, e.first].filter(Boolean).join(" ").trim() || e.code || "", department: blank(e.department) ? null : String(e.department) };
			}
		}
		return out;
	}

	/**
	 * Nạp doanh số ngoài vào comm_txn. Kiểm từng dòng (thiếu số chứng từ / ngày / nhân viên, ngày sai, số không hợp lệ, trùng
	 * khóa trong file, nhân viên không thấy / trùng, dòng thuộc bảng tính đã duyệt / đã vào lương). dryRun: chỉ trả kết quả kiểm;
	 * ghi thật: có dòng lỗi thì từ chối cả lô; tạo mới hoặc cập nhật theo khóa subsidiary + source_system + doc_no + line_no
	 * (dòng không đổi bỏ qua), hết governance thì trả more = true (gọi lại cùng dữ liệu).
	 */
	function importExternal(body) {
		const b = body || {};
		const sub = subsidiaryOf(b.subsidiary);
		const system = String(blank(b.sourceSystem) ? "" : b.sourceSystem).trim().toUpperCase().slice(0, 40);
		if (!system) throw fail("Enter the source system (for example DMS)", "Chưa nhập hệ thống nguồn (ví dụ DMS)");
		const input = Array.isArray(b.rows) ? b.rows : [];
		if (!input.length) throw fail("No rows to import", "Không có dòng nào để nạp");
		if (input.length > IMPORT_LIMIT) throw fail(`At most ${IMPORT_LIMIT} rows per import`, `Tối đa ${IMPORT_LIMIT} dòng mỗi lần nạp`);
		const dryRun = b.dryRun !== false && b.dryRun !== "F";

		const empCodes = [];
		for (const r of input) {
			if (!r) continue;
			empCodes.push(r.employee);
			const team = typeof r.team === "string" ? (() => { try { return JSON.parse(r.team); } catch (e) { return null; } })() : r.team;
			if (Array.isArray(team)) for (const m of team) if (m) empCodes.push(m.employee);
		}
		const emps = lookupEmployees(empCodes.map((c) => (blank(c) ? null : String(c))));
		const resolve = (code) => {
			if (blank(code)) return { id: null };
			const hit = emps[String(code).trim().toUpperCase()] || [];
			if (hit.length === 1) return { id: hit[0] };
			return { id: null, ambiguous: hit.length > 1 };
		};
		const segs = {};
		for (const k of Object.keys(TXN_SEGMENTS)) segs[k] = lookupSegments(k, input.map((r) => r && r[k]));
		const ranges = lockedRanges(sub);
		const docNos = [...new Set(input.filter((r) => r && !blank(r.doc_no)).map((r) => String(r.doc_no).trim()))];
		const existing = {};
		for (const part of chunks(docNos, 800)) {
			const rows = Store.find("comm_txn", { where: `{subsidiary} = ? AND {source_system} = ? AND {doc_no} IN (${part.map(() => "?").join(",")})`, params: [sub, system].concat(part), includeInactive: true });
			for (const x of rows) existing[`${x.doc_no}|${blank(x.line_no) ? 0 : x.line_no}`] = x;
		}

		const seen = {};
		const checked = input.map((raw, index) => {
			const r = raw || {};
			const messages = [];
			const docNo = String(blank(r.doc_no) ? "" : r.doc_no).trim();
			if (!docNo) messages.push(msg("Document number is missing", "Thiếu số chứng từ"));
			let lineNo = 0;
			if (!blank(r.line_no)) {
				lineNo = Number(String(r.line_no).trim());
				if (!Number.isInteger(lineNo) || lineNo < 0) messages.push(msg(`Invalid line number ${r.line_no}`, `Số dòng không hợp lệ ${r.line_no}`));
			}
			const date = parseDate(r.date);
			if (date === null) messages.push(msg("Date is missing", "Thiếu ngày chứng từ"));
			else if (date === undefined) messages.push(msg(`Invalid date ${r.date}`, `Ngày không hợp lệ ${r.date}`));
			const type = blank(r.tran_type) ? "I" : String(r.tran_type).trim().toUpperCase();
			if (!["I", "S", "C"].includes(type)) messages.push(msg(`Transaction type must be I, S or C (${r.tran_type})`, `Loại chứng từ phải là I, S hoặc C (${r.tran_type})`));
			const values = { subsidiary: sub, source_system: system, doc_no: docNo, line_no: lineNo, tran_type: type, date: date || null };
			if (blank(r.employee)) messages.push(msg("Employee code is missing", "Thiếu mã nhân viên"));
			else {
				const e = resolve(r.employee);
				if (!e.id) messages.push(e.ambiguous ? msg(`Employee ${r.employee} matches several employees`, `Mã nhân viên ${r.employee} trùng nhiều người`) : msg(`Employee ${r.employee} not found`, `Không tìm thấy nhân viên ${r.employee}`));
				values.employee = e.id;
			}
			for (const k of TXN_NUM) {
				const n = parseNumber(r[k]);
				if (Number.isNaN(n)) messages.push(msg(`Invalid number in ${k}: ${r[k]}`, `Số không hợp lệ ở ${k}: ${r[k]}`));
				else values[k] = n;
			}
			for (const k of TXN_TEXT) values[k] = blank(r[k]) ? "" : String(r[k]).trim().slice(0, k === "note" ? 4000 : 300);
			for (const k of Object.keys(TXN_SEGMENTS)) {
				const hit = segs[k](r[k]);
				const label = TXN_SEGMENTS[k];
				if (hit.ambiguous) messages.push(msg(`${label.en} ${r[k]} matches several records`, `${label.vi} ${r[k]} trùng nhiều bản ghi`));
				else if (hit.missing) messages.push(msg(`${label.en} ${r[k]} not found`, `Không tìm thấy ${label.vi.toLowerCase()} ${r[k]}`));
				values[k] = hit.id;
			}
			if (blank(r.project)) values.project = null;
			else if (!isId(String(r.project).trim())) messages.push(msg("Project must be an internal id", "Dự án phải là id nội bộ"));
			else values.project = String(r.project).trim();
			for (const k of ["first_sale_date", "collected_date"]) {
				const d = parseDate(r[k]);
				if (d === undefined) messages.push(msg(`Invalid date in ${k}: ${r[k]}`, `Ngày không hợp lệ ở ${k}: ${r[k]}`));
				else values[k] = d;
			}
			if (!blank(r.team)) {
				let team = r.team;
				if (typeof team === "string") {
					try {
						team = JSON.parse(team);
					} catch (e) {
						team = null;
					}
				}
				if (!Array.isArray(team)) messages.push(msg("Team must be a JSON list [{employee, pct}]", "Đội bán phải là danh sách JSON [{employee, pct}]"));
				else {
					const list = [];
					for (const m of team) {
						const e = resolve(m && m.employee);
						const pct = parseNumber(m && m.pct);
						if (!e.id) messages.push(msg(`Team member ${m && m.employee} not found`, `Không tìm thấy thành viên đội bán ${m && m.employee}`));
						else if (pct === null || Number.isNaN(pct)) messages.push(msg(`Team member ${m.employee}: invalid share`, `Thành viên đội bán ${m.employee}: tỷ lệ không hợp lệ`));
						else list.push({ employee: e.id, pct });
					}
					values.team = JSON.stringify(list);
				}
			} else values.team = "";
			const key = `${docNo}|${lineNo}`;
			if (docNo) {
				if (seen[key] !== undefined) messages.push(msg(`Duplicate key ${docNo} / ${lineNo} (row ${seen[key] + 1})`, `Trùng khóa ${docNo} / ${lineNo} (dòng ${seen[key] + 1})`));
				else seen[key] = index;
			}
			const cur = docNo ? existing[key] || null : null;
			const lock = lockedBy(ranges, [values.date, values.collected_date].concat(cur ? [cur.date, cur.collected_date] : []));
			if (lock && !(cur && !cur.isInactive && sameTxn(cur, values))) messages.push(msg(`The date falls in the approved commission run ${lock.name}`, `Ngày thuộc bảng tính hoa hồng đã duyệt ${lock.name}`));
			let status = "new";
			if (messages.length) status = "invalid";
			else if (cur) status = !cur.isInactive && sameTxn(cur, values) ? "ok" : "update";
			return { index, key, status, employee: values.employee || null, messages, values, current: cur };
		});
		const counts = { total: checked.length, new: 0, update: 0, ok: 0, invalid: 0 };
		for (const c of checked) counts[c.status]++;
		const view = checked.map((c) => ({ index: c.index, key: c.key, status: c.status, employee: c.employee, messages: c.messages }));
		if (dryRun) return { ok: counts.invalid === 0, dryRun: true, sourceSystem: system, rows: view, counts };
		if (counts.invalid) throw fail(`${counts.invalid} row(s) are invalid; fix them and import again`, `Có ${counts.invalid} dòng lỗi, hãy sửa rồi nạp lại`);
		const gov = budget();
		let written = 0;
		let more = false;
		for (const c of checked) {
			if (c.status === "ok") continue;
			if (gov.low()) {
				more = true;
				break;
			}
			if (c.current) Store.update("comm_txn", c.current.id, Object.assign({ isInactive: false }, c.values));
			else Store.create("comm_txn", c.values);
			written++;
		}
		const out = { ok: true, dryRun: false, sourceSystem: system, counts, written };
		if (more) out.more = true;
		return out;
	}

	function sameTxn(cur, values) {
		return Object.keys(values).every((k) => {
			const a = cur[k];
			const v = values[k];
			if (TXN_NUM.includes(k) || k === "line_no") return (blank(a) ? null : Number(a)) === (blank(v) ? null : Number(v));
			return String(blank(a) ? "" : a) === String(blank(v) ? "" : v);
		});
	}

	/** Dòng doanh số ngoài của tháng (ngày chứng từ hoặc ngày thu trong tháng) kèm mã, tên nhân viên; locked = thuộc bảng đã duyệt. */
	function externalList(params) {
		const p = params || {};
		const sub = subsidiaryOf(p.subsidiary);
		const period = periodOf(p.month || Dates.yyyymm(Clock.today()));
		const rows = externalTxns(sub, period.from, period.to);
		const names = employeeNames(rows.map((r) => r.employee));
		const ranges = lockedRanges(sub);
		const systems = {};
		let revenue = 0;
		let collected = 0;
		const out = rows.map((x) => {
			const who = names[String(x.employee)] || { code: "", name: "" };
			systems[x.source_system || ""] = (systems[x.source_system || ""] || 0) + 1;
			revenue += num(x.revenue);
			collected += num(x.collected_amount);
			return {
				id: x.id, sourceSystem: x.source_system || "", docNo: x.doc_no || "", lineNo: blank(x.line_no) ? 0 : num(x.line_no), tranType: x.tran_type || "I", date: x.date || null,
				customerCode: x.customer_code || "", customerName: x.customer_name || "", customerCategory: x.customer_category || "", firstSaleDate: x.first_sale_date || null,
				itemCode: x.item_code || "", itemType: x.item_type || "", classId: x.class || null, department: x.department || null, location: x.location || null, project: x.project || null,
				revenue: num(x.revenue), cost: num(x.cost), qty: num(x.qty), employee: x.employee || null, code: who.code, name: who.name, team: parseTeam(x.team),
				collectedDate: x.collected_date || null, collectedAmount: blank(x.collected_amount) ? null : num(x.collected_amount), importBatch: x.import_batch || "", note: x.note || "",
				locked: !!lockedBy(ranges, [x.date, x.collected_date]),
			};
		});
		return { subsidiary: sub, month: period.month, from: period.from, to: period.to, rows: out, counts: { rows: out.length, systems: Object.keys(systems).sort().map((s) => ({ sourceSystem: s, rows: systems[s] })) }, totals: { revenue, collected } };
	}

	return {
		calculate, approve, reopen, voidRun, planSave, adjust, simulate, importExternal, externalList,
		// dùng chung với api/CommissionV2 và test
		periodOf, plansFor, plansWithChildren, activeRun, runOf, idList, employeeNames,
		readers: { docLines, paidLines, clawLines, salesTeams, firstSales, externalTxns },
		CREDIT_FIELD,
	};
});
