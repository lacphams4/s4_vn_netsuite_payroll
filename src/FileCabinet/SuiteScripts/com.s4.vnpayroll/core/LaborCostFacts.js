/**
 * Số liệu chi phí lương (fact) của một bảng lương đã tính (docs/UI_V2.md mục 13).
 *
 * Từ dòng nhân viên bảng lương (trường vô hướng + detail) dựng danh sách dòng số liệu gộp theo khóa
 * (tài khoản, phòng ban, class, địa điểm, dự án, loại lao động, thành phần chi phí).
 *
 * Bất biến: tổng dòng số liệu của một bảng lương = tổng Nợ chi phí của bút toán ghi sổ (PayrollJournalBuilder.buildRelease)
 * = tổng dòng phân bổ (GROSS + ERINS) + trích trước tháng 13; và khớp từng khóa (tài khoản, phòng ban, class, địa điểm, dự án).
 *
 * Quy tắc:
 * - Dòng phân bổ ERINS -> employerIns. Trích trước tháng 13 (nhân viên, số dương) -> accrued13, tài khoản và phòng ban như
 *   bút toán: tài khoản chi phí của hồ sơ (kèm phòng ban của hồ sơ), không có thì tài khoản chi phí mặc định, phòng ban trống.
 * - Cộng tác viên (C): mọi dòng GROSS -> contractor.
 * - Nhân viên (E): mỗi dòng GROSS chia theo cơ cấu thu nhập của chính nhân viên đó (nhóm loại thu nhập -> thành phần, bảng
 *   CATEGORY bên dưới). Thu nhập có đích riêng được gắn đúng đích khi nhận ra được từ dữ liệu đã lưu:
 *     1. các dòng GROSS nguồn S / T của một dự án có tổng đúng bằng tổng thu nhập mang dự án đó -> dùng cơ cấu của các thu
 *        nhập đó (CostAllocationBuilder: dòng tay có đích, dòng OT có dự án);
 *     2. các dòng GROSS nguồn S còn lại có tổng đúng bằng tổng thu nhập khoán do quy tắc sinh ra (nguồn S, nhóm P) -> piecework
 *        (thu nhập sản lượng chia theo phiếu sản lượng);
 *     3. phần còn lại chia theo tỷ lệ số tiền của các thu nhập còn lại.
 *   Làm tròn đến đồng; chênh lệch làm tròn dồn vào dòng phân bổ lớn nhất nên tổng theo dòng phân bổ VÀ tổng theo thành phần
 *   của nhân viên đều khớp tuyệt đối. Tổng thu nhập lệch tổng phân bổ GROSS (dữ liệu cũ) thì phần lệch vào `other`.
 * - Giờ: lấy từ hours của dòng phân bổ GROSS, ghi vào thành phần có số tiền lớn nhất của dòng đó (không đếm hai lần).
 * - Địa điểm trống -> địa điểm mặc định của chứng từ (như lớp ghi bút toán). Task, cost code không có trên bút toán nên
 *   không thuộc khóa.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money"], (Money) => {
	const D = Money.D;
	const norm = (s) => String(s === null || s === undefined ? "" : s).trim().toUpperCase();
	const str = (s) => (s === null || s === undefined ? "" : String(s).trim());
	const blank = (s) => str(s) === "";

	const GROSS_COMPONENTS = ["wages", "overtime", "allowance", "bonus", "piecework", "other"];
	const COMPONENTS = GROSS_COMPONENTS.concat(["employerIns", "accrued13", "contractor"]);
	// Nhóm thu nhập (list earning_category) -> thành phần chi phí
	const CATEGORY = { B: "wages", O: "overtime", A: "allowance", M: "allowance", N: "bonus", P: "piecework", X: "other" };
	const DIMS = ["account", "department", "class", "location", "project", "employmentType", "component"];

	/** Thành phần chi phí của một loại thu nhập: theo nhóm; nhóm trống / lạ mà là loại làm thêm -> overtime; còn lại other. */
	function componentOf(category, isOvertime) {
		const c = CATEGORY[norm(category)];
		if (c) return c;
		return isOvertime ? "overtime" : "other";
	}

	function parseDetail(line) {
		if (!line || !line.detail) return {};
		if (typeof line.detail === "object") return line.detail;
		try {
			return JSON.parse(line.detail) || {};
		} catch (e) {
			return {};
		}
	}

	function employmentTypeOf(line, detail) {
		return norm(line.employment_type || line.employmentType || (detail || {}).employmentType || "E") === "C" ? "C" : "E";
	}

	function earningComponent(code, earningTypes) {
		const t = (earningTypes || {})[norm(code)] || (earningTypes || {})[code];
		if (!t) return "other";
		if (typeof t === "string") return componentOf(t, false);
		return componentOf(t.category, !!(t.isOvertime || t.is_ot));
	}

	function factKey(f) {
		return DIMS.map((k) => str(f[k])).join("|");
	}

	const zeroMix = () => {
		const m = {};
		for (const c of GROSS_COMPONENTS) m[c] = D(0);
		return m;
	};

	function mixOf(earnings) {
		const m = zeroMix();
		for (const e of earnings) m[e.component] = m[e.component].plus(e.amount);
		return m;
	}

	const mixTotal = (m) => Money.sum(GROSS_COMPONENTS, (c) => m[c]);

	/**
	 * Chia các dòng (số tiền cố định) theo tổng từng thành phần. Tổng theo dòng luôn giữ nguyên; tổng theo thành phần giữ nguyên
	 * khi tổng các dòng = tổng các thành phần (phần lệch đã được đưa vào `other` trước khi gọi).
	 * @param {Array<{amount: Decimal}>} rows
	 * @param {Object<string, Decimal>} mix
	 * @returns {Array<Object<string, Decimal>>} ô theo dòng, cùng thứ tự rows
	 */
	function spread(rows, mix) {
		const G = Money.sum(rows, (r) => r.amount);
		const comps = GROSS_COMPONENTS.filter((c) => !mix[c].isZero());
		const biggest = comps.reduce((b, c) => (b === null || mix[c].abs().gt(mix[b].abs()) ? c : b), null) || "other";
		if (G.isZero() || !comps.length) {
			// Không có cơ cấu để chia (tổng 0 hoặc không có thu nhập): cả dòng vào thành phần lớn nhất
			return rows.map((r) => ({ [biggest]: r.amount }));
		}
		let last = 0;
		rows.forEach((r, i) => {
			if (r.amount.abs().gt(rows[last].amount.abs())) last = i;
		});
		const used = zeroMix();
		const out = rows.map((r, i) => {
			if (i === last) return null;
			const cells = {};
			let top = null;
			let sum = D(0);
			for (const c of comps) {
				const v = D(Money.round(r.amount.times(mix[c]).div(G)));
				cells[c] = v;
				sum = sum.plus(v);
				if (top === null || v.abs().gt(cells[top].abs())) top = c;
			}
			const diff = r.amount.minus(sum);
			if (!diff.isZero()) {
				if (cells[top].isZero()) top = biggest;
				cells[top] = cells[top].plus(diff);
			}
			for (const c of comps) used[c] = used[c].plus(cells[c]);
			return cells;
		});
		const rest = {};
		for (const c of comps) rest[c] = mix[c].minus(used[c]);
		out[last] = rest;
		return out;
	}

	/**
	 * Dòng số liệu của MỘT nhân viên (đã gộp theo khóa trong phạm vi nhân viên đó).
	 * @param {{employee, employment_type?, employmentType?, accrued13?, accrued13th?, detail: string|object}} line dòng batch_emp
	 * @param {{earningTypes?: Object<string, string|{category, isOvertime}>, defaultExpenseAccount?, defaultLocation?}} [options]
	 *   earningTypes theo mã loại thu nhập (viết hoa): nhóm (B/O/A/N/P/M/X) hoặc đối tượng của Settings.earningTypes().byCode
	 * @returns {Array<{account, department, class, location, project, employmentType, component, amount: number, hours: number}>}
	 */
	function employeeFacts(line, options) {
		const opt = options || {};
		const d = parseDetail(line);
		const type = employmentTypeOf(line, d);
		const map = new Map();
		const push = (dim, component, amount, hours) => {
			const f = Object.assign({}, dim, { employmentType: type, component });
			const k = factKey(f);
			const cur = map.get(k);
			if (cur) {
				cur.amount = cur.amount.plus(D(amount));
				cur.hours = cur.hours.plus(D(hours));
			} else {
				map.set(k, Object.assign(f, { amount: D(amount), hours: D(hours) }));
			}
		};
		const dimOf = (a) => ({
			account: str(a.account), department: str(a.sub), class: str(a.workCenter), location: blank(a.branch) ? str(opt.defaultLocation) : str(a.branch), project: str(a.project),
		});

		const gross = [];
		for (const a of d.allocations || []) {
			if (D(a.amount).isZero()) continue;
			if (norm(a.component) === "ERINS") push(dimOf(a), "employerIns", a.amount, 0);
			else if (type === "C") push(dimOf(a), "contractor", a.amount, a.hours);
			else gross.push({ dim: dimOf(a), amount: D(a.amount), hours: D(a.hours), source: norm(a.source), project: norm(a.project), done: false });
		}

		if (gross.length) {
			let pool = (d.earnings || []).filter((e) => !D(e.amount).isZero())
				.map((e) => ({ amount: D(e.amount), component: earningComponent(e.earningType, opt.earningTypes), project: norm(e.project), source: norm(e.source) }));
			const assign = (rows, mix) => {
				const cells = spread(rows, mix);
				rows.forEach((r, i) => {
					let top = null;
					for (const c of Object.keys(cells[i])) if (top === null || cells[i][c].abs().gt(cells[i][top].abs())) top = c;
					for (const c of Object.keys(cells[i])) push(r.dim, c, cells[i][c], c === top ? r.hours : 0);
					r.done = true;
				});
			};
			// 1. Thu nhập có dự án riêng: tổng dòng GROSS nguồn S / T của dự án = tổng thu nhập mang dự án đó
			const projects = [...new Set(gross.filter((r) => (r.source === "S" || r.source === "T") && r.project !== "").map((r) => r.project))];
			for (const p of projects) {
				const rows = gross.filter((r) => !r.done && (r.source === "S" || r.source === "T") && r.project === p);
				const own = pool.filter((e) => e.project === p);
				if (!rows.length || !own.length) continue;
				const total = Money.sum(rows, (r) => r.amount);
				if (total.isZero() || !total.eq(Money.sum(own, (e) => e.amount))) continue;
				assign(rows, mixOf(own));
				pool = pool.filter((e) => !own.includes(e));
			}
			// 2. Thu nhập khoán do quy tắc sinh ra, chia theo phiếu sản lượng (dòng GROSS nguồn S còn lại)
			const direct = gross.filter((r) => !r.done && r.source === "S");
			const piece = pool.filter((e) => e.source === "S" && e.component === "piecework");
			if (direct.length && piece.length) {
				const total = Money.sum(direct, (r) => r.amount);
				if (!total.isZero() && total.eq(Money.sum(piece, (e) => e.amount))) {
					assign(direct, mixOf(piece));
					pool = pool.filter((e) => !piece.includes(e));
				}
			}
			// 3. Phần còn lại theo tỷ lệ; tổng thu nhập còn lại lệch tổng dòng còn lại thì phần lệch vào other
			const rest = gross.filter((r) => !r.done);
			if (rest.length) {
				const mix = mixOf(pool);
				const diff = Money.sum(rest, (r) => r.amount).minus(mixTotal(mix));
				if (!diff.isZero()) mix.other = mix.other.plus(diff);
				assign(rest, mix);
			}
		}

		const accrued = D(line.accrued13 !== undefined && line.accrued13 !== null ? line.accrued13 : line.accrued13th);
		if (type !== "C" && accrued.gt(0)) {
			const own = !blank(d.expenseAccount);
			push({ account: own ? str(d.expenseAccount) : str(opt.defaultExpenseAccount), department: own ? str(d.expenseSub) : "", class: "", location: str(opt.defaultLocation), project: "" }, "accrued13", accrued, 0);
		}
		return finish(map);
	}

	function finish(map) {
		return [...map.values()].filter((f) => !f.amount.isZero() || !f.hours.isZero())
			.map((f) => Object.assign(f, { amount: f.amount.toNumber(), hours: f.hours.toNumber() }))
			.sort((a, b) => (factKey(a) < factKey(b) ? -1 : factKey(a) > factKey(b) ? 1 : 0));
	}

	/** Tổng Nợ chi phí mà bút toán ghi sổ sẽ ghi cho các dòng này: phân bổ GROSS + ERINS và trích trước tháng 13. */
	function expected(lines) {
		let gross = D(0);
		let employerIns = D(0);
		let accrued13 = D(0);
		for (const line of lines || []) {
			const d = parseDetail(line);
			for (const a of d.allocations || []) {
				if (norm(a.component) === "ERINS") employerIns = employerIns.plus(D(a.amount));
				else gross = gross.plus(D(a.amount));
			}
			const acc = D(line.accrued13 !== undefined && line.accrued13 !== null ? line.accrued13 : line.accrued13th);
			if (employmentTypeOf(line, d) !== "C" && acc.gt(0)) accrued13 = accrued13.plus(acc);
		}
		return { gross: gross.toNumber(), employerIns: employerIns.toNumber(), accrued13: accrued13.toNumber(), total: gross.plus(employerIns).plus(accrued13).toNumber() };
	}

	/** Tổng số tiền của danh sách dòng số liệu. */
	function total(facts) {
		return Money.sum(facts || [], (f) => f.amount).toNumber();
	}

	/**
	 * Kiểm bất biến: tổng dòng số liệu = tổng Nợ chi phí của bút toán.
	 * @param {Array} facts
	 * @param {number|{total: number}} expectedTotal số của expected(lines) hoặc tổng Nợ chi phí của bút toán
	 */
	function verify(facts, expectedTotal) {
		const exp = D(expectedTotal && typeof expectedTotal === "object" ? expectedTotal.total : expectedTotal);
		const sum = Money.sum(facts || [], (f) => f.amount);
		return { ok: sum.eq(exp), total: sum.toNumber(), expected: exp.toNumber(), difference: sum.minus(exp).toNumber() };
	}

	/**
	 * Dòng số liệu của cả bảng lương, gộp theo khóa.
	 * @param {Array} lines dòng batch_emp của một bảng lương
	 * @param {object} [options] như employeeFacts
	 * @returns {{facts: Array, total: number, check: {ok, total, expected, difference}}}
	 */
	function build(lines, options) {
		const map = new Map();
		for (const line of lines || []) {
			for (const f of employeeFacts(line, options)) {
				const k = factKey(f);
				const cur = map.get(k);
				if (cur) {
					cur.amount = cur.amount.plus(D(f.amount));
					cur.hours = cur.hours.plus(D(f.hours));
				} else {
					map.set(k, Object.assign({}, f, { amount: D(f.amount), hours: D(f.hours) }));
				}
			}
		}
		const facts = finish(map);
		return { facts, total: total(facts), check: verify(facts, expected(lines)) };
	}

	/** Tháng kế toán YYYYMM của ngày ISO (ngày bút toán). */
	function monthOf(date) {
		const s = str(date);
		return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 4) + s.slice(5, 7) : "";
	}

	/** Giá trị trường của record cost_fact cho một dòng số liệu. */
	function toRecord(fact, header) {
		const h = header || {};
		return {
			batch: str(h.batch), subsidiary: str(h.subsidiary), month: str(h.month), posting_date: str(h.postingDate),
			account: str(fact.account), department: str(fact.department), class: str(fact.class), location: str(fact.location), project: str(fact.project),
			employment_type: str(fact.employmentType), component: str(fact.component), amount: D(fact.amount).toNumber(), hours: D(fact.hours).toNumber(), active: true,
		};
	}

	const RECORD_KEYS = ["batch", "subsidiary", "month", "posting_date", "account", "department", "class", "location", "project", "employment_type", "component"];
	const recordKey = (r) => ["account", "department", "class", "location", "project", "employment_type", "component"].map((k) => str(r[k])).join("|");

	function sameRecord(existing, values) {
		if (existing.active !== true) return false;
		if (!RECORD_KEYS.every((k) => str(existing[k]) === str(values[k]))) return false;
		return D(existing.amount).eq(D(values.amount)) && D(existing.hours).eq(D(values.hours));
	}

	/**
	 * Kế hoạch ghi dòng số liệu của một bảng lương, chạy lại được (idempotent): dòng đang có trùng khóa và trùng số thì giữ
	 * nguyên; dòng đang có khác thì cập nhật tại chỗ (kể cả dòng đã hết hiệu lực - dùng lại để không phình dữ liệu); thiếu thì
	 * tạo; thừa thì bỏ cờ còn hiệu lực. Không bao giờ xóa.
	 * @param {Array<{id, active, ...trường record}>} existing mọi dòng cost_fact của bảng lương (cả dòng hết hiệu lực)
	 * @param {Array} facts dòng số liệu mong muốn (rỗng khi bảng lương đã đảo)
	 * @param {{batch, subsidiary, month, postingDate}} header
	 * @returns {{create: Array<object>, update: Array<{id, values}>, deactivate: Array<string>, unchanged: number}}
	 */
	function plan(existing, facts, header) {
		const wanted = (facts || []).map((f) => toRecord(f, header));
		const free = (existing || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
		const byKey = new Map();
		for (const e of free) {
			const k = recordKey(e);
			if (!byKey.has(k)) byKey.set(k, []);
			byKey.get(k).push(e);
		}
		const taken = new Set();
		const out = { create: [], update: [], deactivate: [], unchanged: 0 };
		const pending = [];
		for (const w of wanted) {
			const list = byKey.get(recordKey(w)) || [];
			const hit = list.find((e) => !taken.has(e.id) && e.active === true) || list.find((e) => !taken.has(e.id));
			if (!hit) {
				pending.push(w);
				continue;
			}
			taken.add(hit.id);
			if (sameRecord(hit, w)) out.unchanged++;
			else out.update.push({ id: String(hit.id), values: w });
		}
		// Dòng thừa: ưu tiên dùng lại dòng đã hết hiệu lực, rồi tới dòng còn hiệu lực không còn khóa tương ứng
		const spare = free.filter((e) => !taken.has(e.id)).sort((a, b) => (a.active === b.active ? Number(a.id) - Number(b.id) : a.active ? 1 : -1));
		for (const w of pending) {
			const e = spare.shift();
			if (e) {
				taken.add(e.id);
				out.update.push({ id: String(e.id), values: w });
			} else {
				out.create.push(w);
			}
		}
		for (const e of spare) if (e.active === true) out.deactivate.push(String(e.id));
		return out;
	}

	return { COMPONENTS, GROSS_COMPONENTS, CATEGORY, DIMS, componentOf, employeeFacts, build, expected, total, verify, monthOf, toRecord, plan, factKey, parseDetail };
});
