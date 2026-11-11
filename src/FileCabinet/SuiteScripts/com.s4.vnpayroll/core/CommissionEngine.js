/**
 * Hoa hồng nhân viên kinh doanh (docs/COMMISSION.md mục 3, 5), theo chuỗi của SAP Commissions:
 * dòng giao dịch -> ghi nhận (credit) -> đo lường (cơ sở, % đạt) -> thành phần (incentive) -> true-up, quản lý, điều chỉnh,
 * trần, draw (deposit / payment) -> phân bổ chi phí theo phân đoạn.
 *
 * Thuần, không gọi N/*: lớp api đọc dữ liệu, gọi các hàm dưới đây, ghi kết quả. Mọi phép tính qua Decimal (Money.D); tiền
 * làm tròn đồng (Money.round), % làm tròn 2 số.
 *
 * Quy ước dữ liệu vào (nhận cả tên camelCase của lõi lẫn tên trường Schema snake_case, xem normalizePlan / normalizeRule...):
 * - Tỷ lệ là số phần trăm: rate 2 = 2%, minAttainment 80 = 80%, overridePct 5 = 5%; team[].pct cũng là phần trăm (100 = 100%,
 *   tầng dữ liệu nhân contribution của NetSuite với 100).
 * - Dòng nguồn (row) mang dấu như mục 4: doanh thu = -tl.netamount nên dòng credit memo (tranType C) đã âm sẵn; lõi KHÔNG
 *   đổi dấu (dòng chiết khấu trên credit memo vì thế vẫn đúng dấu).
 * - row.sourceSystem: hệ thống nguồn của dòng doanh số ngoài (comm_txn); trống = giao dịch NetSuite. Lõi chỉ giữ nguyên để
 *   màn hình hiện nguồn của credit; plan.source chỉ ảnh hưởng tầng dữ liệu (API lọc nguồn).
 * - normalizeLines nhận thêm period {from, to} (khuyến nghị): dòng I (trigger I), S, C chỉ tính khi ngày chứng từ trong kỳ; hóa
 *   đơn trigger P tính theo collectedRatio bất kể ngày; dòng truy thu (clawback) sinh từ unpaidRatio (tầng dữ liệu chỉ đặt
 *   unpaidRatio cho hóa đơn đến hạn trong kỳ). Không có period thì không lọc ngày.
 * - Q / Y: credits là credit của kỳ, windowCredits là credit của cả cửa sổ đến cuối kỳ (gồm kỳ này); priorPaid {employee: số
 *   tiền} là phần đã trả các kỳ trước cùng cửa sổ (tổng earned các kết quả đã duyệt); drawBalance {employee: số dư ứng trước}.
 * - Cổng min_attainment khi không có chỉ tiêu: không xác định được % đạt nên coi như chưa đạt (0) và cảnh báo NO_QUOTA.
 * - cap_amount trống hoặc <= 0 = không trần.
 * - Dòng mang thêm itemCode (mã hàng), itemGroup (nhóm hàng theo trường của khách hàng, dạng chữ hiển thị) và customerType
 *   (dòng ngoài: N khách mới / E khách cũ do hệ thống nguồn khai) cho bộ lọc fItemTypes / fItemCodes / fItemGroups /
 *   customerScope của thành phần (passes).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates"], (Money, Dates) => {
	const D = Money.D;
	const ZERO = D(0);
	const HUNDRED = D(100);
	const DEFAULT_EXCLUDE = "TaxItem,ShipItem,Subtotal,Description,EndGroup,Group";

	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const blank = (v) => v === null || v === undefined || String(v).trim() === "";
	const str = (v) => (blank(v) ? "" : String(v).trim());
	const num = (v) => (blank(v) ? null : Number(v));
	const bool = (v, def) => (v === null || v === undefined || v === "" ? def : v === true || v === "T" || v === "t" || v === "true" || v === 1);
	const byId = (a, b) => String(a).localeCompare(String(b), "en", { numeric: true });

	/** Giá trị đầu tiên có nội dung trong các khóa (false, 0 vẫn tính là có). */
	function pick(o, ...keys) {
		if (!o) return null;
		for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
		return null;
	}

	/** Danh sách id lọc: chuỗi "1, 2,3" hoặc mảng -> mảng chuỗi; trống -> null (không lọc). */
	function idList(v) {
		if (v === null || v === undefined) return null;
		const list = (Array.isArray(v) ? v : String(v).split(",")).map(str).filter(Boolean);
		return list.length ? list : null;
	}

	/** Danh sách mã lọc so không phân biệt hoa thường (loại mặt hàng, mã hàng, nhóm hàng): như idList nhưng viết hoa, bỏ trùng. */
	function codeList(v) {
		const list = idList(v);
		return list ? [...new Set(list.map(norm))] : null;
	}

	// Phạm vi khách hàng của thành phần: A tất cả, N chỉ khách mới, E chỉ khách cũ
	const CUSTOMER_SCOPES = ["A", "N", "E"];

	// ------------------------------------------------------------------ định dạng số cho diễn giải song ngữ

	/** Số theo ngôn ngữ: vi 1.234.567,5; en 1,234,567.5; tối đa dp chữ số thập phân, bỏ số 0 thừa. */
	function fmt(x, lang, dp) {
		const r = D(x).toDecimalPlaces(dp === undefined ? 0 : dp, Money.Decimal.ROUND_HALF_UP);
		const neg = r.isNegative() && !r.isZero();
		const parts = r.abs().toFixed().split(".");
		const vi = lang === "vi";
		const head = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, vi ? "." : ",");
		return (neg ? "-" : "") + head + (parts[1] ? (vi ? "," : ".") + parts[1] : "");
	}

	function speaker(lang, plan) {
		const q = plan && plan.basis === "Q";
		return {
			t: (vi, en) => (lang === "vi" ? vi : en),
			n: (x) => fmt(x, lang, 0),
			b: (x) => fmt(x, lang, q ? 4 : 0),
			p: (x) => `${fmt(x, lang, 2)}%`,
		};
	}

	/** Một dòng diễn giải {vi, en} từ hàm nhận bộ định dạng theo ngôn ngữ. */
	function step(plan, fn) {
		return { vi: fn(speaker("vi", plan)), en: fn(speaker("en", plan)) };
	}

	const WARN = {
		NO_QUOTA: { code: "NO_QUOTA", vi: "Chưa có chỉ tiêu: % đạt không xác định, thành phần theo % đạt và cổng ngưỡng cho 0.", en: "No quota: attainment is unknown, attainment based components and the threshold give 0." },
		NO_TIERS: (name) => ({ code: "NO_TIERS", vi: `Thành phần ${name} chưa có bậc thang.`, en: `Component ${name} has no tiers.` }),
		UNKNOWN_METHOD: (name, m) => ({ code: "UNKNOWN_METHOD", vi: `Thành phần ${name} có phương pháp không hợp lệ (${m}).`, en: `Component ${name} has an invalid method (${m}).` }),
		NO_EARNING_TYPE: { code: "NO_EARNING_TYPE", vi: "Kế hoạch chưa khai loại thu nhập lương.", en: "The plan has no payroll earning type." },
		NEGATIVE_CARRIED: (lang) => ({ code: "NEGATIVE_CARRIED", vi: `Hoa hồng âm ${lang.vi} chuyển thành số dư ứng trước.`, en: `Negative commission ${lang.en} is carried to the draw balance.` }),
		UNKNOWN_CUSTOMER_AGE: (name, n, scope) => ({
			code: "UNKNOWN_CUSTOMER_AGE",
			vi: `Thành phần ${name} (${scope === "E" ? "chỉ khách cũ" : "chỉ khách mới"}): ${n} dòng không xác định được khách mới hay cũ (thiếu ngày mua đầu tiên), không tính.`,
			en: `Component ${name} (${scope === "E" ? "existing customers only" : "new customers only"}): ${n} line(s) without a first sale date cannot be classified as new or existing and were skipped.`,
		}),
	};

	const BASIS = { R: ["doanh thu thuần", "net revenue"], G: ["lãi gộp ước tính", "estimated gross profit"], Q: ["số lượng", "quantity"] };
	const WINDOW = { M: ["tháng", "month"], Q: ["lũy kế quý", "quarter to date"], Y: ["lũy kế năm", "year to date"] };

	// ------------------------------------------------------------------ chuẩn hóa cấu hình

	function normalizePlan(p) {
		const o = p || {};
		const ex = pick(o, "excludeItemTypes", "exclude_item_types");
		const exclude = (Array.isArray(ex) ? ex : String(ex === null ? DEFAULT_EXCLUDE : ex).split(",")).map(norm).filter(Boolean);
		return {
			id: str(o.id),
			code: str(pick(o, "code", "name")),
			subsidiary: str(o.subsidiary),
			source: norm(o.source) || "N",
			basis: norm(o.basis) || "R",
			trigger: norm(o.trigger) || "I",
			creditSource: norm(pick(o, "creditSource", "credit_source")) || "R",
			creditField: str(pick(o, "creditField", "credit_field")),
			window: norm(o.window) || "M",
			includeReturns: bool(pick(o, "includeReturns", "include_returns"), true),
			clawbackDays: Number(pick(o, "clawbackDays", "clawback_days") || 0),
			excludeItemTypes: exclude,
			earningType: norm(pick(o, "earningType", "earning_type")),
			minAttainment: num(pick(o, "minAttainment", "min_attainment")),
			capAmount: num(pick(o, "capAmount", "cap_amount")),
			drawType: norm(pick(o, "drawType", "draw_type")) || "N",
			drawAmount: Number(pick(o, "drawAmount", "draw_amount") || 0),
			overridePct: Number(pick(o, "overridePct", "override_pct") || 0),
			overrideBasis: norm(pick(o, "overrideBasis", "override_basis")) || "B",
		};
	}

	/**
	 * Thành phần. Bộ lọc mới (trống = không lọc): fItemTypes (mã loại mặt hàng NetSuite: InvtPart, Service...), fItemCodes (mã
	 * hàng), fItemGroups (giá trị nhóm hàng do khách hàng định nghĩa) - cả ba so không phân biệt hoa thường. customerScope A / N /
	 * E (f_customer_scope); trống thì lấy theo f_new_customer cũ (T = N) để tương thích. fNewCustomer = (customerScope N).
	 */
	function normalizeRule(r) {
		const o = r || {};
		const rawScope = norm(pick(o, "customerScope", "f_customer_scope", "fCustomerScope"));
		const customerScope = CUSTOMER_SCOPES.includes(rawScope) ? rawScope : bool(pick(o, "fNewCustomer", "f_new_customer"), false) ? "N" : "A";
		return {
			id: str(o.id),
			plan: str(o.plan),
			sequence: Number(o.sequence || 0),
			name: str(o.name),
			method: norm(o.method) || "P",
			rate: Number(o.rate || 0),
			unitAmount: Number(pick(o, "unitAmount", "unit_amount") || 0),
			fItems: idList(pick(o, "fItems", "f_items")),
			fClasses: idList(pick(o, "fClasses", "f_classes")),
			fDepartments: idList(pick(o, "fDepartments", "f_departments")),
			fLocations: idList(pick(o, "fLocations", "f_locations")),
			fCustCategories: idList(pick(o, "fCustCategories", "f_cust_categories")),
			fItemTypes: codeList(pick(o, "fItemTypes", "f_item_types")),
			fItemCodes: codeList(pick(o, "fItemCodes", "f_item_codes")),
			fItemGroups: codeList(pick(o, "fItemGroups", "f_item_groups")),
			customerScope,
			fNewCustomer: customerScope === "N",
			newDays: Number(pick(o, "newDays", "new_days") || 90),
		};
	}

	function normalizeTier(t) {
		const o = t || {};
		return { rule: str(o.rule), fromValue: Number(pick(o, "fromValue", "from_value") || 0), rate: Number(o.rate || 0), amount: Number(o.amount || 0) };
	}

	function normalizeAssignment(a) {
		const o = a || {};
		return {
			id: str(o.id), plan: str(o.plan), employee: str(o.employee), effective: Dates.iso(o.effective), expiration: Dates.iso(o.expiration),
			quota: Number(o.quota || 0), manager: str(o.manager),
		};
	}

	function normalizeQuota(q) {
		const o = q || {};
		return { plan: str(o.plan), employee: str(o.employee), month: Number(o.month || 0), quota: Number(o.quota || 0) };
	}

	const samePlan = (x, plan) => blank(x.plan) || !plan.id || x.plan === plan.id;
	const activeAt = (a, d) => !!d && (!a.effective || Dates.cmp(a.effective, d) <= 0) && (!a.expiration || Dates.cmp(d, a.expiration) <= 0);
	const overlaps = (a, from, to) => (!a.effective || !to || Dates.cmp(a.effective, to) <= 0) && (!a.expiration || !from || Dates.cmp(a.expiration, from) >= 0);

	// ------------------------------------------------------------------ cửa sổ

	/** Cửa sổ tính: M = kỳ; Q = từ đầu quý của `to`; Y = từ đầu năm của `to` (không muộn hơn `from`). */
	function windowOf(planIn, from, to) {
		const plan = normalizePlan(planIn);
		const f = Dates.iso(from);
		const t = Dates.iso(to);
		if (!t || plan.window === "M") return { from: f, to: t };
		const y = Dates.year(t);
		const m = Dates.month(t);
		const start = plan.window === "Q" ? Dates.ymd(y, m - ((m - 1) % 3), 1) : Dates.ymd(y, 1, 1);
		return { from: f ? Dates.min(start, f) : start, to: t };
	}

	/** Các tháng YYYYMM (số) từ tháng của a đến tháng của b. */
	function monthsBetween(a, b) {
		const out = [];
		if (!a || !b) return out;
		for (let d = Dates.startOfMonth(a); Dates.cmp(d, b) <= 0; d = Dates.addMonths(d, 1)) out.push(Number(Dates.yyyymm(d)));
		return out;
	}

	// ------------------------------------------------------------------ 1-2. dòng nguồn

	/**
	 * Chuẩn hóa dòng nguồn: bỏ loại dòng loại trừ, dòng ngoài công ty con, credit memo khi không trừ trả hàng; tính cơ sở theo
	 * basis, nhân tỷ lệ thu (trigger P), sinh dòng truy thu (kind K) khi clawback.
	 * @param {Array} rows dòng của tầng dữ liệu (mục 5)
	 * @param {object} planIn kế hoạch
	 * @param {{from, to}} [period] kỳ tính
	 * @returns {Array} dòng {key, kind N|P|K, factor, creditDate, base, qty, ...dòng nguồn, sourceSystem}
	 */
	function normalizeLines(rows, planIn, period) {
		const plan = normalizePlan(planIn);
		const from = period ? Dates.iso(period.from) : null;
		const to = period ? Dates.iso(period.to) : null;
		const exclude = new Set(plan.excludeItemTypes);
		const out = [];
		(rows || []).forEach((row, idx) => {
			if (exclude.has(norm(row.itemType))) return;
			if (plan.subsidiary && !blank(row.subsidiary) && str(row.subsidiary) !== plan.subsidiary) return;
			const tranType = norm(row.tranType) || "I";
			if (tranType === "C" && !plan.includeReturns) return;
			const revenue = D(row.revenue);
			const cost = D(row.cost);
			const qty = D(row.qty);
			const value = plan.basis === "Q" ? qty : plan.basis === "G" ? revenue.minus(cost) : revenue;
			const date = Dates.iso(row.date);
			const line = {
				tranId: str(row.tranId), tranNo: str(row.tranNo), tranType, date, customer: str(row.customer), customerName: str(row.customerName),
				customerCategory: str(row.customerCategory), firstSaleDate: Dates.iso(row.firstSaleDate), item: str(row.item), itemName: str(row.itemName),
				itemType: str(row.itemType), itemCode: str(row.itemCode), itemGroup: str(row.itemGroup), customerType: norm(row.customerType), classId: str(row.classId), department: str(row.department), location: str(row.location), project: str(row.project),
				subsidiary: str(row.subsidiary), revenue: revenue.toNumber(), cost: cost.toNumber(), lineQty: qty.toNumber(), salesRep: str(row.salesRep),
				team: (row.team || []).map((t) => ({ employee: str(t.employee), pct: Number(t.pct || 0) })), creditEmployee: str(row.creditEmployee),
				sourceSystem: str(row.sourceSystem),
			};
			const ref = blank(row.line) ? idx : row.line;
			const push = (kind, factor, creditDate) => {
				out.push(Object.assign({}, line, {
					key: `${line.sourceSystem ? `${line.sourceSystem}:` : ""}${line.tranId || line.tranNo}:${ref}:${kind}`, kind, factor: factor.toNumber(), creditDate,
					base: value.times(factor).toNumber(), qty: qty.times(factor).toNumber(),
				}));
			};
			if (tranType === "I" && plan.trigger === "P") {
				const ratio = D(row.collectedRatio);
				if (!ratio.isZero()) push("P", ratio, Dates.iso(row.collectedDate) || to || date);
			} else if (!from || !date || Dates.within(date, from, to)) {
				push("N", D(1), date);
			}
			if (tranType === "I" && plan.trigger === "I" && plan.clawbackDays > 0 && D(row.unpaidRatio).gt(0)) {
				push("K", D(row.unpaidRatio).neg(), date ? Dates.addDays(date, plan.clawbackDays) : to);
			}
		});
		return out;
	}

	// ------------------------------------------------------------------ 3. ghi nhận

	/**
	 * Credit cho từng người theo nguồn ghi nhận: R salesrep 100%; T đội bán theo pct (không có đội thì salesrep); F trường tùy
	 * chỉnh 100%. Chỉ người có phân công hiệu lực vào kế hoạch tại ngày ghi nhận (creditDate, thiếu thì `date`).
	 * @returns {Array} credit {employee, ...line, pct, base, qty}
	 */
	function credit(lines, planIn, assignments, date) {
		const plan = normalizePlan(planIn);
		const asg = (assignments || []).map(normalizeAssignment).filter((a) => samePlan(a, plan));
		const out = [];
		for (const l of lines || []) {
			const when = l.creditDate || l.date || Dates.iso(date);
			let recips;
			const team = (l.team || []).filter((t) => !blank(t.employee));
			if (plan.creditSource === "T" && team.length) recips = team.map((t) => ({ employee: str(t.employee), pct: D(t.pct) }));
			else if (plan.creditSource === "F") recips = blank(l.creditEmployee) ? [] : [{ employee: str(l.creditEmployee), pct: HUNDRED }];
			else recips = blank(l.salesRep) ? [] : [{ employee: str(l.salesRep), pct: HUNDRED }];
			for (const r of recips) {
				if (!asg.some((a) => a.employee === r.employee && activeAt(a, when))) continue;
				const k = r.pct.div(100);
				out.push(Object.assign({}, l, { employee: r.employee, pct: r.pct.toNumber(), base: D(l.base).times(k).toNumber(), qty: D(l.qty).times(k).toNumber() }));
			}
		}
		return out;
	}

	/**
	 * Doanh số không ai được ghi nhận trong kế hoạch (kiểm soát kiểu "unassigned credits"): người bán chưa có phân công hiệu
	 * lực, hoặc chứng từ không có người bán. employee "" = dòng không có người bán.
	 * @returns {Array<{employee, base: number, docs: number}>}
	 */
	function uncredited(lines, planIn, assignments, date) {
		const plan = normalizePlan(planIn);
		const asg = (assignments || []).map(normalizeAssignment).filter((a) => samePlan(a, plan));
		const acc = new Map();
		const add = (emp, base, doc) => {
			const g = acc.get(emp) || { employee: emp, base: D(0), docs: new Set() };
			g.base = g.base.plus(D(base));
			g.docs.add(str(doc));
			acc.set(emp, g);
		};
		for (const l of lines || []) {
			const when = l.creditDate || l.date || Dates.iso(date);
			const team = (l.team || []).filter((t) => !blank(t.employee));
			let recips;
			if (plan.creditSource === "T" && team.length) recips = team.map((t) => ({ employee: str(t.employee), pct: D(t.pct) }));
			else if (plan.creditSource === "F") recips = blank(l.creditEmployee) ? [] : [{ employee: str(l.creditEmployee), pct: HUNDRED }];
			else recips = blank(l.salesRep) ? [] : [{ employee: str(l.salesRep), pct: HUNDRED }];
			if (!recips.length) add("", l.base, l.tranId || l.tranNo);
			for (const r of recips) {
				if (asg.some((a) => a.employee === r.employee && activeAt(a, when))) continue;
				add(r.employee, D(l.base).times(r.pct.div(100)), l.tranId || l.tranNo);
			}
		}
		return [...acc.values()].map((g) => ({ employee: g.employee, base: Money.roundTo(g.base, 2), docs: g.docs.size }));
	}

	// ------------------------------------------------------------------ 5-7. đo lường và thành phần

	/**
	 * Khách của dòng là mới (N) hay cũ (E): dòng ngoài có customerType N / E thì dùng thẳng (hệ thống nguồn biết rõ hơn);
	 * ngược lại khách mới = lần mua đầu tiên cách ngày chứng từ 0..newDays ngày, khách cũ = hơn newDays ngày. Thiếu ngày mua
	 * đầu tiên / ngày chứng từ, hoặc ngày mua đầu tiên sau ngày chứng từ (dữ liệu lệch) -> null (không xác định).
	 */
	function customerAge(c, newDays) {
		if (c.customerType === "N" || c.customerType === "E") return c.customerType;
		if (!c.firstSaleDate || !c.date) return null;
		const age = Dates.diff(c.firstSaleDate, c.date);
		if (age < 0) return null;
		return age <= newDays ? "N" : "E";
	}

	/** Bộ lọc của thành phần trừ phạm vi khách hàng; danh sách trống = không lọc. */
	function filtersOk(rule, c) {
		const inList = (list, v) => !list || list.includes(str(v));
		const inCodes = (list, v) => !list || list.includes(norm(v));
		if (!inList(rule.fItems, c.item) || !inList(rule.fClasses, c.classId) || !inList(rule.fDepartments, c.department)) return false;
		if (!inList(rule.fLocations, c.location) || !inList(rule.fCustCategories, c.customerCategory)) return false;
		if (!inCodes(rule.fItemTypes, c.itemType) || !inCodes(rule.fItemCodes, c.itemCode)) return false;
		if (rule.fItemGroups) {
			// Trường nhóm hàng nhiều giá trị (multi select): BUILTIN.DF trả các tên cách nhau dấu phẩy, khớp một tên là đủ
			const g = norm(c.itemGroup);
			if (!g || !(rule.fItemGroups.includes(g) || g.split(",").some((x) => rule.fItemGroups.includes(x.trim())))) return false;
		}
		return true;
	}

	function passes(rule, c) {
		if (!filtersOk(rule, c)) return false;
		if (rule.customerScope === "N" || rule.customerScope === "E") return customerAge(c, rule.newDays) === rule.customerScope;
		return true;
	}

	/** Số dòng qua mọi bộ lọc khác nhưng không xác định được khách mới / cũ (thành phần lọc N / E). */
	function unknownAge(rule, list) {
		if (rule.customerScope !== "N" && rule.customerScope !== "E") return 0;
		return list.filter((c) => filtersOk(rule, c) && customerAge(c, rule.newDays) === null).length;
	}

	const sumOf = (list, key) => Money.sum(list, (x) => x[key]);
	/** Bậc cao nhất có ngưỡng <= giá trị (đúng ngưỡng là đạt). */
	const hitTier = (tiers, v) => {
		let hit = null;
		for (const t of tiers) if (D(t.fromValue).lte(v)) hit = t;
		return hit;
	};

	/** Tiền của một thành phần theo phương pháp; ghi diễn giải vào steps, cảnh báo vào warnings. Trả Decimal. */
	function applyMethod(plan, rule, tiers, inp, attainment, steps, warnings) {
		const b = D(inp.base);
		const name = rule.name || rule.id;
		const needTiers = ["G", "S", "A", "B"].includes(rule.method);
		if (needTiers && !tiers.length) {
			warnings.push(WARN.NO_TIERS(name));
			steps.push(step(plan, (L) => L.t("Chưa có bậc thang: 0", "No tiers: 0")));
			return ZERO;
		}
		switch (rule.method) {
			case "P": {
				const a = b.times(rule.rate).div(100);
				steps.push(step(plan, (L) => `${L.t("Tỷ lệ cố định", "Flat rate")}: ${L.b(b)} x ${L.p(rule.rate)} = ${L.n(Money.round(a))}`));
				return a;
			}
			case "G": {
				if (b.lte(0)) {
					steps.push(step(plan, (L) => `${L.t("Thang lũy tiến: cơ sở không dương", "Graduated tiers: base not positive")} (${L.b(b)}): 0`));
					return ZERO;
				}
				let total = ZERO;
				for (let i = 0; i < tiers.length; i++) {
					const lo = D(tiers[i].fromValue);
					if (b.lte(lo)) break;
					const hi = i + 1 < tiers.length ? Money.min(b, tiers[i + 1].fromValue) : b;
					const part = hi.minus(lo).times(tiers[i].rate).div(100);
					total = total.plus(part);
					steps.push(step(plan, (L) => `${L.t("Thang lũy tiến", "Graduated tier")}: ${L.b(lo)} - ${L.b(hi)} x ${L.p(tiers[i].rate)} = ${L.n(Money.round(part))}`));
				}
				return total;
			}
			case "S": {
				const hit = hitTier(tiers, b);
				if (!hit) {
					steps.push(step(plan, (L) => `${L.t("Thang bậc: cơ sở", "Step tiers: base")} ${L.b(b)} ${L.t("chưa đạt bậc đầu tiên", "below the first tier")} (${L.b(tiers[0].fromValue)}): 0`));
					return ZERO;
				}
				const a = b.times(hit.rate).div(100);
				steps.push(step(plan, (L) => `${L.t("Thang bậc: đạt bậc từ", "Step tiers: tier from")} ${L.b(hit.fromValue)}: ${L.b(b)} x ${L.p(hit.rate)} = ${L.n(Money.round(a))}`));
				return a;
			}
			case "A":
			case "B": {
				if (attainment === null) {
					steps.push(step(plan, (L) => L.t("% đạt không xác định (chưa có chỉ tiêu): 0", "Attainment unknown (no quota): 0")));
					return ZERO;
				}
				const hit = hitTier(tiers, attainment);
				if (!hit) {
					steps.push(step(plan, (L) => `${L.t("Đạt", "Attained")} ${L.p(attainment)}, ${L.t("chưa tới bậc đầu tiên", "below the first tier")} ${L.p(tiers[0].fromValue)}: 0`));
					return ZERO;
				}
				if (rule.method === "B") {
					const a = D(hit.amount);
					steps.push(step(plan, (L) => `${L.t("Thưởng mốc: đạt", "Milestone bonus: attained")} ${L.p(attainment)} ${L.t("qua mốc", "passed")} ${L.p(hit.fromValue)} = ${L.n(a)}`));
					return a;
				}
				const a = b.times(hit.rate).div(100);
				steps.push(step(plan, (L) => `${L.t("Theo % đạt: đạt", "By attainment: attained")} ${L.p(attainment)} ${L.t("thuộc bậc từ", "in tier from")} ${L.p(hit.fromValue)}: ${L.b(b)} x ${L.p(hit.rate)} = ${L.n(Money.round(a))}`));
				return a;
			}
			case "U": {
				const q = D(inp.qty);
				const a = q.times(rule.unitAmount);
				steps.push(step(plan, (L) => `${L.t("Đơn giá trên số lượng", "Amount per unit")}: ${L.b(q)} x ${L.n(rule.unitAmount)} = ${L.n(Money.round(a))}`));
				return a;
			}
			default:
				warnings.push(WARN.UNKNOWN_METHOD(name, rule.method));
				return ZERO;
		}
	}

	/**
	 * Chạy mọi thành phần trên đầu vào đã đo: cổng min_attainment (không áp cho B), làm tròn đồng từng thành phần.
	 * @returns {{components, gross: Decimal, steps, warnings}}
	 */
	function evaluate(plan, rules, tiersByRule, attainment, inputs) {
		const steps = [];
		const warnings = [];
		const components = [];
		const minA = D(plan.minAttainment || 0);
		const needQuota = minA.gt(0) || rules.some((r) => r.method === "A" || r.method === "B");
		if (attainment === null && needQuota) warnings.push(WARN.NO_QUOTA);
		const gateOk = minA.lte(0) || (attainment !== null && D(attainment).gte(minA));
		let gross = ZERO;
		rules.forEach((rule, i) => {
			const inp = inputs[i];
			const tiers = tiersByRule[rule.id] || [];
			const cs = [];
			let amount;
			if (rule.method !== "B" && !gateOk) {
				amount = ZERO;
				cs.push(step(plan, (L) => `${L.t("Chưa đạt ngưỡng", "Below the threshold")} ${L.p(minA)} (${L.t("đạt", "attained")} ${attainment === null ? L.t("không xác định", "unknown") : L.p(attainment)}): 0`));
			} else {
				amount = applyMethod(plan, rule, tiers, inp, attainment, cs, warnings);
			}
			const rounded = Money.round(amount);
			gross = gross.plus(rounded);
			const label = rule.name || rule.id || String(i + 1);
			components.push({ rule: rule.id, name: rule.name, method: rule.method, base: baseValue(plan, inp.base), qty: Money.roundTo(inp.qty, 4), amount: rounded, steps: cs });
			for (const s of cs) steps.push({ vi: `${label}: ${s.vi}`, en: `${label}: ${s.en}` });
		});
		return { components, gross, steps, warnings };
	}

	const baseValue = (plan, x) => (plan.basis === "Q" ? Money.roundTo(x, 4) : Money.round(x));

	function prepare(input) {
		const plan = normalizePlan(input.plan);
		const rules = (input.rules || []).map(normalizeRule).filter((r) => samePlan(r, plan)).sort((a, b) => a.sequence - b.sequence || byId(a.id, b.id));
		const tiersByRule = {};
		for (const t of (input.tiers || []).map(normalizeTier)) (tiersByRule[t.rule] = tiersByRule[t.rule] || []).push(t);
		for (const k of Object.keys(tiersByRule)) tiersByRule[k].sort((a, b) => a.fromValue - b.fromValue);
		return { plan, rules, tiersByRule };
	}

	// ------------------------------------------------------------------ 14. phân bổ chi phí

	const SEG_KEYS = ["sub", "workCenter", "branch", "project"];
	const segOf = (c) => ({ sub: str(c.department), workCenter: str(c.classId), branch: str(c.location), project: str(c.project) });
	const segKey = (s) => SEG_KEYS.map((k) => s[k]).join("|");
	const EMPTY_SEG = { sub: "", workCenter: "", branch: "", project: "" };

	/** Trọng số dương theo phân đoạn của các credit; không có thì null. */
	function weightsOf(list) {
		const map = new Map();
		for (const c of list || []) {
			const s = segOf(c);
			const k = segKey(s);
			const cur = map.get(k) || { seg: s, w: ZERO };
			cur.w = cur.w.plus(D(c.base));
			map.set(k, cur);
		}
		const pos = [...map.values()].filter((x) => x.w.gt(0));
		return pos.length ? pos : null;
	}

	/** Chia số tiền nguyên theo trọng số dương; phần lẻ dồn vào trọng số lớn nhất (tổng đúng bằng số tiền). */
	function splitInt(total, weights) {
		const T = D(total);
		const S = Money.sum(weights);
		const parts = weights.map((w) => Money.round(T.times(w).div(S)));
		const diff = T.minus(Money.sum(parts));
		if (!diff.isZero()) {
			let k = 0;
			for (let i = 1; i < weights.length; i++) if (D(weights[i]).gt(weights[k])) k = i;
			parts[k] = D(parts[k]).plus(diff).toNumber();
		}
		return parts;
	}

	/**
	 * Phân đoạn của số phải trả: phần của chính nhân viên (earned + điều chỉnh) theo cơ sở credit của kỳ (không có thì của cửa
	 * sổ), hoa hồng quản lý theo cơ sở credit của từng cấp dưới; số phải trả chia theo tỷ trọng các phần dương.
	 */
	function sharesOf(payable, ownAmount, ownWeights, overrideParts) {
		if (!payable) return [];
		const raw = new Map();
		const spread = (amount, weights) => {
			const ws = weights || [{ seg: EMPTY_SEG, w: D(1) }];
			const S = Money.sum(ws, (x) => x.w);
			for (const x of ws) {
				const k = segKey(x.seg);
				const cur = raw.get(k) || { seg: x.seg, w: ZERO };
				cur.w = cur.w.plus(D(amount).times(x.w).div(S));
				raw.set(k, cur);
			}
		};
		spread(ownAmount, ownWeights);
		for (const o of overrideParts) spread(o.amount, o.weights);
		let pos = [...raw.values()].filter((x) => x.w.gt(0));
		if (!pos.length) pos = [{ seg: EMPTY_SEG, w: D(1) }];
		const parts = splitInt(payable, pos.map((x) => x.w));
		return pos.map((x, i) => Object.assign({}, x.seg, { amount: parts[i] })).filter((s) => s.amount !== 0);
	}

	// ------------------------------------------------------------------ chuỗi tính

	/**
	 * Tính hoa hồng của một kế hoạch cho một kỳ (mục 3 bước 5-14).
	 * @param {{plan, rules, tiers, assignments, quotas, credits, windowCredits, priorPaid, drawBalance, adjustments, from, to, names}} input
	 *   adjustments: [{employee, plan?, month?, amount, reason}]; names (tùy chọn): {employee: tên} cho diễn giải.
	 * @returns {{results: Array, totals: {base, payable, employees}, window: {from, to}}}
	 */
	function calculate(input) {
		const { plan, rules, tiersByRule } = prepare(input);
		const from = Dates.iso(input.from);
		const to = Dates.iso(input.to);
		const win = windowOf(plan, from, to);
		const asg = (input.assignments || []).map(normalizeAssignment).filter((a) => samePlan(a, plan));
		const quotas = (input.quotas || []).map(normalizeQuota).filter((q) => samePlan(q, plan));
		const credits = input.credits || [];
		const windowCredits = plan.window === "M" || !input.windowCredits ? credits : input.windowCredits;
		const months = monthsBetween(win.from, to);
		const periodMonths = new Set(monthsBetween(from, to));
		const priorPaid = input.priorPaid || {};
		const drawBal = input.drawBalance || {};
		const names = input.names || {};
		const who = (e) => (names[e] ? `${names[e]} (${e})` : e);

		const adjustments = {};
		for (const a of input.adjustments || []) {
			if (blank(a.employee) || !samePlan({ plan: str(a.plan) }, plan)) continue;
			if (!blank(a.month) && periodMonths.size && !periodMonths.has(Number(a.month))) continue;
			(adjustments[str(a.employee)] = adjustments[str(a.employee)] || []).push({ amount: Money.round(a.amount), reason: str(a.reason) });
		}

		const groupBy = (list) => {
			const m = {};
			for (const c of list) (m[str(c.employee)] = m[str(c.employee)] || []).push(c);
			return m;
		};
		const byEmp = groupBy(credits);
		const byEmpWin = windowCredits === credits ? byEmp : groupBy(windowCredits);

		const assigned = new Set(asg.filter((a) => overlaps(a, from, to)).map((a) => a.employee));
		const emps = new Set([...assigned, ...Object.keys(byEmp), ...Object.keys(byEmpWin), ...Object.keys(adjustments)]);

		function monthQuota(e, m) {
			const own = quotas.filter((q) => q.employee === e && q.month === m);
			if (own.length) return D(own[own.length - 1].quota);
			const mFrom = Dates.ymd(Math.floor(m / 100), m % 100, 1);
			const cands = asg.filter((a) => a.employee === e && overlaps(a, mFrom, Dates.endOfMonth(mFrom)))
				.sort((a, b) => Dates.cmp(b.effective || "1900-01-01", a.effective || "1900-01-01"));
			return cands.length ? D(cands[0].quota) : ZERO;
		}

		function managerOf(e) {
			const cands = asg.filter((a) => a.employee === e && overlaps(a, from, to) && a.manager)
				.sort((a, b) => Dates.cmp(b.effective || "1900-01-01", a.effective || "1900-01-01"));
			return cands.length ? cands[0].manager : "";
		}

		function measure(e) {
			const my = byEmp[e] || [];
			const myWin = byEmpWin[e] || [];
			const base = sumOf(my, "base");
			const windowBase = sumOf(myWin, "base");
			const windowQty = sumOf(myWin, "qty");
			const quota = Money.sum(months.map((m) => monthQuota(e, m)));
			const attainment = quota.gt(0) ? Money.roundTo(windowBase.div(quota).times(100), 2) : null;
			const active = assigned.has(e) || my.length > 0 || myWin.length > 0;
			const ev = active
				? evaluate(plan, rules, tiersByRule, attainment, rules.map((r) => {
					const cs = myWin.filter((c) => passes(r, c));
					return { base: sumOf(cs, "base"), qty: sumOf(cs, "qty") };
				}))
				: { components: [], gross: ZERO, steps: [], warnings: [] };
			const prior = Money.round(priorPaid[e] || 0);
			const earned = ev.gross.minus(prior);
			const steps = [];
			const [bvi, ben] = BASIS[plan.basis] || BASIS.R;
			if (active) {
				steps.push(step(plan, (L) => `${L.t("Cơ sở kỳ", "Period base")} ${from || ""} - ${to || ""} (${L.t(bvi, ben)}): ${L.b(base)}`));
				if (plan.window !== "M") {
					const [wvi, wen] = WINDOW[plan.window] || WINDOW.M;
					steps.push(step(plan, (L) => `${L.t("Cơ sở", "Base")} ${L.t(wvi, wen)} ${win.from} - ${win.to}: ${L.b(windowBase)}`));
				}
				steps.push(attainment === null
					? step(plan, (L) => L.t("Chưa có chỉ tiêu: % đạt không xác định", "No quota: attainment unknown"))
					: step(plan, (L) => `${L.t("% đạt", "Attainment")} = ${L.b(windowBase)} / ${L.b(quota)} x 100 = ${L.p(attainment)}`));
				steps.push(...ev.steps);
				if (plan.window !== "M") {
					steps.push(step(plan, (L) => `${L.t("Hoa hồng lũy kế cửa sổ", "Window commission")} ${L.n(ev.gross)} - ${L.t("đã trả các kỳ trước", "paid in earlier periods")} ${L.n(prior)} = ${L.n(earned)}`));
				} else {
					steps.push(step(plan, (L) => `${L.t("Hoa hồng kỳ này", "Commission of the period")}: ${L.n(earned)}`));
				}
			}
			const warnings = ev.warnings.slice();
			if (active) {
				for (const r of rules) {
					const n = unknownAge(r, myWin);
					if (n) warnings.push(WARN.UNKNOWN_CUSTOMER_AGE(r.name || r.id, n, r.customerScope));
				}
			}
			if (!plan.earningType) warnings.push(WARN.NO_EARNING_TYPE);
			return {
				employee: e, plan: plan.id, planCode: plan.code, earningType: plan.earningType, window: win,
				quota: baseValue(plan, quota), base: baseValue(plan, base), windowBase: baseValue(plan, windowBase), qty: Money.roundTo(sumOf(my, "qty"), 4),
				windowQty: Money.roundTo(windowQty, 4), attainment, gross: ev.gross.toNumber(), priorPaid: prior, earned: earned.toNumber(),
				override: 0, overrides: [], adjustments: 0, capped: 0, drawPaid: 0, drawRecovered: 0, drawBalance: 0, payable: 0,
				components: ev.components, steps, shares: [], warnings,
				_weights: weightsOf(my) || weightsOf(myWin),
			};
		}

		const results = {};
		for (const e of [...emps].sort(byId)) results[e] = measure(e);

		// 9. Hoa hồng quản lý trên cấp dưới trực tiếp (theo phân công); quản lý không cần là người bán
		if (D(plan.overridePct).gt(0)) {
			for (const r of Object.values(results).slice()) {
				const mgr = managerOf(r.employee);
				if (!mgr || mgr === r.employee) continue;
				const ob = plan.overrideBasis === "C" ? D(r.earned) : D(r.base);
				const amount = Money.round(ob.times(plan.overridePct).div(100));
				if (!results[mgr]) results[mgr] = measure(mgr);
				results[mgr].overrides.push({ employee: r.employee, basis: plan.overrideBasis, base: ob.toNumber(), amount, weights: r._weights });
			}
		}

		const list = Object.values(results).sort((a, b) => byId(a.employee, b.employee));
		for (const r of list) finish(r);

		function finish(r) {
			const e = r.employee;
			const L2 = (fn) => step(plan, fn);
			const override = Money.sum(r.overrides, (o) => o.amount);
			for (const o of r.overrides) {
				const [bvi, ben] = o.basis === "C" ? ["hoa hồng", "commission"] : ["doanh số", "sales"];
				r.steps.push(L2((L) => `${L.t("Hoa hồng quản lý từ", "Override from")} ${who(o.employee)}: ${L.p(plan.overridePct)} x ${L.t(bvi, ben)} ${L.b(o.base)} = ${L.n(o.amount)}`));
			}
			const adj = adjustments[e] || [];
			const adjTotal = Money.sum(adj, (a) => a.amount);
			for (const a of adj) r.steps.push(L2((L) => `${L.t("Điều chỉnh tay", "Manual adjustment")}: ${L.n(a.amount)}${a.reason ? ` (${a.reason})` : ""}`));
			let total = D(r.earned).plus(override).plus(adjTotal);
			// 11. Trần
			let capped = ZERO;
			if (plan.capAmount !== null && D(plan.capAmount).gt(0) && total.gt(plan.capAmount)) {
				const cap = D(Money.round(plan.capAmount));
				capped = total.minus(cap);
				total = cap;
				r.steps.push(L2((L) => `${L.t("Trần", "Cap")} ${L.n(cap)}: ${L.t("cắt", "cut")} ${L.n(capped)}`));
			}
			// 12-13. Draw và số âm
			const prev = D(Money.round(drawBal[e] || 0));
			// Ứng trước chỉ cho người có phân công hiệu lực trong kỳ; quản lý chỉ nhận override (không phân công) thì không bù
			const floor = (plan.drawType === "R" || plan.drawType === "G") && assigned.has(e) ? D(Money.round(plan.drawAmount)) : ZERO;
			const neg = total.lt(0) ? total.neg() : ZERO;
			const pos = Money.max(total, 0);
			let payable;
			let drawPaid = ZERO;
			let recovered = ZERO;
			let balance;
			if (pos.lt(floor)) {
				drawPaid = floor.minus(pos);
				payable = floor;
				balance = prev.plus(neg).plus(plan.drawType === "R" ? drawPaid : 0);
				r.steps.push(L2((L) => plan.drawType === "R"
					? `${L.t("Ứng trước có thu hồi: trả bù", "Recoverable draw: top up")} ${L.n(drawPaid)} ${L.t("lên", "to")} ${L.n(floor)}`
					: `${L.t("Bảo đảm tối thiểu: trả bù", "Guaranteed draw: top up")} ${L.n(drawPaid)} ${L.t("lên", "to")} ${L.n(floor)}`));
			} else {
				const excess = pos.minus(floor);
				recovered = prev.gt(0) ? Money.min(prev, excess) : ZERO;
				payable = pos.minus(recovered);
				balance = prev.minus(recovered).plus(neg);
				if (recovered.gt(0)) r.steps.push(L2((L) => `${L.t("Thu hồi ứng trước", "Draw recovery")}: ${L.n(recovered)}`));
			}
			if (neg.gt(0)) {
				const w = WARN.NEGATIVE_CARRIED({ vi: fmt(neg.neg(), "vi"), en: fmt(neg.neg(), "en") });
				r.warnings.push(w);
				r.steps.push({ vi: w.vi, en: w.en });
			}
			if (!balance.isZero() || !prev.isZero()) r.steps.push(L2((L) => `${L.t("Số dư ứng trước", "Draw balance")}: ${L.n(prev)} -> ${L.n(balance)}`));
			r.steps.push(L2((L) => `${L.t("Phải trả vào bảng lương", "Payable to payroll")}: ${L.n(payable)}`));
			r.override = override.toNumber();
			r.adjustments = adjTotal.toNumber();
			r.capped = capped.toNumber();
			r.drawPaid = drawPaid.toNumber();
			r.drawRecovered = recovered.toNumber();
			r.drawBalance = balance.toNumber();
			r.payable = payable.toNumber();
			r.shares = sharesOf(r.payable, D(r.earned).plus(adjTotal), r._weights, r.overrides.map((o) => ({ amount: o.amount, weights: o.weights })));
			r.overrides = r.overrides.map((o) => ({ employee: o.employee, basis: o.basis, base: o.base, amount: o.amount }));
			delete r._weights;
		}

		return {
			results: list,
			totals: { base: Money.sum(list, (r) => r.base).toNumber(), payable: Money.sum(list, (r) => r.payable).toNumber(), employees: list.length },
			window: win,
		};
	}

	/**
	 * Mô phỏng (what-if): một người, cơ sở / số lượng / chỉ tiêu nhập tay, mọi thành phần nhận cùng cơ sở (không lọc), có cổng và
	 * trần; không true-up, không draw.
	 * @returns {{amount, gross, capped, attainment, components, steps, warnings}}
	 */
	function simulate(input) {
		const { plan, rules, tiersByRule } = prepare(input);
		const base = D(input.base);
		const qty = D(input.qty);
		const quota = D(input.quota);
		const attainment = quota.gt(0) ? Money.roundTo(base.div(quota).times(100), 2) : null;
		const ev = evaluate(plan, rules, tiersByRule, attainment, rules.map(() => ({ base, qty })));
		const steps = [step(plan, (L) => `${L.t("Cơ sở", "Base")}: ${L.b(base)}`)];
		steps.push(attainment === null
			? step(plan, (L) => L.t("Chưa có chỉ tiêu: % đạt không xác định", "No quota: attainment unknown"))
			: step(plan, (L) => `${L.t("% đạt", "Attainment")} = ${L.b(base)} / ${L.b(quota)} x 100 = ${L.p(attainment)}`));
		steps.push(...ev.steps);
		let amount = ev.gross;
		let capped = ZERO;
		if (plan.capAmount !== null && D(plan.capAmount).gt(0) && amount.gt(plan.capAmount)) {
			const cap = D(Money.round(plan.capAmount));
			capped = amount.minus(cap);
			amount = cap;
			steps.push(step(plan, (L) => `${L.t("Trần", "Cap")} ${L.n(cap)}: ${L.t("cắt", "cut")} ${L.n(capped)}`));
		}
		steps.push(step(plan, (L) => `${L.t("Hoa hồng", "Commission")}: ${L.n(amount)}`));
		return { amount: amount.toNumber(), gross: ev.gross.toNumber(), capped: capped.toNumber(), attainment, components: ev.components, steps, warnings: ev.warnings };
	}

	return { normalizeLines, credit, uncredited, calculate, simulate, windowOf, normalizePlan, normalizeRule, normalizeTier, normalizeAssignment, normalizeQuota, fmt, passes, customerAge };
});
