/**
 * Tạm ứng lương (giao diện bản 2). Mô-đun route (docs/UI_V2.md mục 5), chỉ đọc:
 *   GET advancesView   {subsidiary, status?}  danh sách phiếu + số đếm + tổng + lịch sử cấn trừ gọn + phần đang chờ cấn trừ
 *   GET employeeSearch {subsidiary, q}        tìm nhân viên có hồ sơ lương (tối đa 20: mã, tên, phòng ban)
 * Nghiệp vụ (tạo, bỏ tạm giữ, ghi sổ) giữ ở api/Advances.js qua action cũ createAdvance, removeHoldAdvance, releaseAdvance.
 *
 * Số truy vấn của advancesView không lặp theo từng phiếu: phiếu, nhân viên, bút toán, bảng lương của công ty con, kỳ,
 * nhóm lương, tài khoản tiền; thêm dòng bảng lương có cấn trừ (chỉ khi có bảng lương đang mở và có phiếu còn dư) và tên dự án
 * (chỉ khi có phiếu gắn dự án).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Advances", "./Payroll", "./Clock"], (Store, Advances, Payroll, Clock) => {
	const STATUSES = ["H", "B", "O", "C"];
	const SEARCH_LIMIT = 20;

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	const num = (v) => Number(v) || 0;
	const isId = (v) => /^\d+$/.test(String(v === null || v === undefined ? "" : v));
	const idList = (ids) => [...new Set((ids || []).map(String).filter(isId))];

	function safeJson(text, fallback) {
		if (!text) return fallback;
		try {
			const v = JSON.parse(text);
			return v === null || v === undefined ? fallback : v;
		} catch (e) {
			return fallback;
		}
	}

	/** Chạy fn, lỗi (vai trò không đọc được bảng) thì trả giá trị dự phòng: màn hình vẫn mở được. */
	function attempt(fn, fallback) {
		try {
			return fn();
		} catch (e) {
			return fallback;
		}
	}

	/** Số chứng từ của bút toán; gọi theo lô 900 id (giới hạn danh sách IN). */
	function journalNumbers(ids) {
		const out = {};
		const list = idList(ids);
		for (let i = 0; i < list.length; i += 900) Object.assign(out, attempt(() => Payroll.transactionsInfo(list.slice(i, i + 900)), {}) || {});
		return out;
	}

	/** Tài khoản tiền (loại Bank) để chọn khi lập phiếu, kèm tên của tài khoản đã gắn trên phiếu nhưng không thuộc loại Bank. */
	function cashAccounts(usedIds) {
		const shape = (a) => ({ id: String(a.id), number: a.acctnumber || "", name: a.name || "" });
		const list = attempt(() => Store.run("SELECT a.id, a.acctnumber, a.accountsearchdisplaynamecopy AS name FROM account a WHERE a.isinactive = 'F' AND a.accttype = 'Bank' ORDER BY a.acctnumber", [], "s4vp_adv_cash"), []).map(shape);
		const names = {};
		for (const a of list) names[a.id] = a;
		const missing = idList(usedIds).filter((id) => !names[id]);
		if (missing.length) {
			const rows = attempt(() => Store.run(`SELECT a.id, a.acctnumber, a.accountsearchdisplaynamecopy AS name FROM account a WHERE a.id IN (${missing.slice(0, 900).join(",")})`, [], "s4vp_adv_cash_used"), []);
			for (const a of rows.map(shape)) names[a.id] = a;
		}
		return { list, names };
	}

	function projectNames(ids) {
		const out = {};
		const list = idList(ids).slice(0, 900);
		if (!list.length) return out;
		const rows = attempt(() => Store.run(`SELECT j.id, j.entityid, j.companyname FROM job j WHERE j.id IN (${list.join(",")})`, [], "s4vp_adv_job"), []);
		for (const r of rows) out[String(r.id)] = [r.entityid, r.companyname].filter((x, i, a) => x && a.indexOf(x) === i).join(" ");
		return out;
	}

	/**
	 * Phần đang cấn ở bảng lương đã tính nhưng chưa ghi sổ (cùng quy tắc với Payroll.openAdvances): đọc chi tiết của các dòng
	 * bảng lương có số cấn trừ > 0, gom theo phiếu tạm ứng (id, thiếu id thì số phiếu).
	 * @returns {Object<string, Array<{batch, batchNbr, period, amount}>>} khóa "id:<id>" hoặc "nbr:<số phiếu>"
	 */
	function pendingOffsets(openBatches) {
		const out = {};
		if (!openBatches.length) return out;
		const byId = {};
		for (const b of openBatches) byId[b.id] = b;
		const lines = attempt(() => Store.findIn("batch_emp", "batch", openBatches.map((b) => b.id), "{advance} > 0"), []);
		for (const l of lines) {
			const b = byId[String(l.batch)];
			if (!b) continue;
			for (const o of safeJson(l.detail, {}).advanceOffsets || []) {
				const amount = num(o.amount);
				if (!(amount > 0)) continue;
				const key = o.id ? `id:${o.id}` : `nbr:${o.refNbr}`;
				const list = (out[key] = out[key] || []);
				const hit = list.find((x) => x.batch === b.id);
				if (hit) hit.amount += amount;
				else list.push({ batch: b.id, batchNbr: b.name || "", period: b.period || null, amount });
			}
		}
		return out;
	}

	/**
	 * Dữ liệu màn Tạm ứng: phiếu của công ty con (lọc theo trạng thái nếu có); số đếm theo trạng thái và thẻ số liệu luôn tính
	 * trên toàn bộ phiếu của công ty con, dòng tổng tính trên các phiếu trả về.
	 */
	function advancesView(params) {
		const subsidiary = String((params && params.subsidiary) || "");
		if (!isId(subsidiary)) throw fail("Select a subsidiary", "Chưa chọn công ty con");
		const status = String((params && params.status) || "").toUpperCase();
		if (status && !STATUSES.includes(status)) throw fail("Unknown advance status", "Trạng thái tạm ứng không hợp lệ");
		const today = attempt(() => Clock.today(), "") || "";

		const all = Advances.list({ subsidiary });
		const info = attempt(() => Payroll.employeesInfo(all.map((a) => a.employee)), {}) || {};
		const tx = journalNumbers(all.map((a) => a.journal));
		const cash = cashAccounts(all.map((a) => a.cash_account));
		const projects = projectNames(all.map((a) => a.project));

		const batches = attempt(() => Store.find("batch", { where: "{subsidiary} = ?", params: [subsidiary] }), []);
		const batchById = {};
		for (const b of batches) batchById[b.id] = b;
		const periods = attempt(() => Store.find("period"), []);
		const periodById = {};
		for (const p of periods) periodById[p.id] = p;
		const groups = {};
		for (const g of attempt(() => Store.find("paygroup"), [])) groups[g.id] = g;
		// Kỳ áp dụng cho công ty con: nhóm lương không gắn công ty con, hoặc gắn đúng công ty con này
		const applicable = periods.filter((p) => {
			const g = groups[p.paygroup];
			return !g || !g.subsidiary || String(g.subsidiary) === subsidiary;
		});
		const periodName = (id) => (id && periodById[id] ? periodById[id].name || "" : "");

		const anyOpenAdvance = all.some((a) => a.status === "O" && num(a.balance) > 0);
		const openBatches = anyOpenAdvance ? batches.filter((b) => !["R", "V"].includes(b.status) && b.calculated) : [];
		const pending = pendingOffsets(openBatches);

		// Kỳ dự kiến cấn trừ của phần chưa nằm trong bảng lương nào: kỳ đang mở sớm nhất kết thúc từ ngày phiếu trở đi và chưa có
		// bảng lương đã ghi sổ của công ty con (bảng lương chỉ cấn phiếu có ngày <= ngày cuối kỳ).
		const releasedPeriods = new Set(batches.filter((b) => b.status === "R").map((b) => String(b.period)));
		const candidates = applicable.filter((p) => p.status !== "C" && p.end && !releasedPeriods.has(p.id)).sort((x, y) => (x.end < y.end ? -1 : x.end > y.end ? 1 : 0));
		const nextPeriodFor = (date) => {
			const p = candidates.find((c) => !date || c.end >= date);
			return p ? { id: p.id, name: p.name || "", end: p.end } : null;
		};

		// Kỳ hiện tại (chứa hôm nay) để đếm phiếu vừa tất toán
		const currentPeriods = applicable.filter((p) => today && p.start && p.end && p.start <= today && p.end >= today);
		const currentIds = new Set(currentPeriods.map((p) => p.id));

		const counts = { all: all.length, H: 0, B: 0, O: 0, C: 0 };
		const cards = {
			onHold: { count: 0, amount: 0 },
			pendingPost: { count: 0, amount: 0 },
			open: { count: 0, balance: 0, pending: 0 },
			settled: { count: 0, amount: 0, period: currentPeriods.map((p) => p.name).filter(Boolean).join(", ") },
		};

		const rows = [];
		for (const a of all) {
			const st = STATUSES.includes(a.status) ? a.status : "H";
			counts[st] += 1;
			const emp = info[a.employee] || {};
			const parsed = safeJson(a.history, []);
			const history = (Array.isArray(parsed) ? parsed : []).map((h) => {
				const b = batchById[String(h.batch)] || {};
				return { batch: String(h.batch || ""), batchNbr: h.batchNbr || b.name || "", period: periodName(b.period), date: b.doc_date || null, amount: num(h.amount) };
			});
			const waiting = st === "O" ? (pending[`id:${a.id}`] || []).concat(pending[`nbr:${a.name}`] || []).map((p) => ({ batch: p.batch, batchNbr: p.batchNbr, period: periodName(p.period), amount: p.amount })) : [];
			const pendingAmount = waiting.reduce((s, p) => s + p.amount, 0);
			const balance = st === "O" || st === "C" ? num(a.balance) : 0;
			const free = Math.max(0, balance - pendingAmount);
			const acc = a.cash_account ? cash.names[String(a.cash_account)] : null;

			if (st === "H") {
				cards.onHold.count += 1;
				cards.onHold.amount += num(a.amount);
			} else if (st === "B") {
				cards.pendingPost.count += 1;
				cards.pendingPost.amount += num(a.amount);
			} else if (st === "O") {
				cards.open.count += 1;
				cards.open.balance += balance;
				cards.open.pending += Math.min(balance, pendingAmount);
			} else if (history.length && currentIds.has(String((batchById[history[history.length - 1].batch] || {}).period))) {
				cards.settled.count += 1;
				cards.settled.amount += num(a.amount);
			}
			if (status && st !== status) continue;
			rows.push({
				id: a.id, name: a.name || "", date: a.doc_date || null, status: st,
				employee: a.employee, employeeCode: emp.code || "", employeeName: emp.name || "", department: emp.departmentName || "",
				amount: num(a.amount), offset: st === "O" || st === "C" ? num(a.offset) : 0, balance,
				memo: a.memo || "", project: a.project || null, projectName: a.project ? projects[String(a.project)] || "" : "",
				cashAccount: a.cash_account || null, cashAccountName: acc ? `${acc.number} ${acc.name}`.trim() : "",
				journal: a.journal || null, journalNo: a.journal ? (tx[String(a.journal)] || {}).tranid || "" : "",
				history, pending: waiting, pendingAmount,
				nextPeriod: st === "O" && free > 0 ? nextPeriodFor(a.doc_date) : null,
			});
		}
		const totals = rows.reduce((t, r) => ({ amount: t.amount + r.amount, offset: t.offset + r.offset, balance: t.balance + r.balance }), { amount: 0, offset: 0, balance: 0 });
		return { subsidiary, status: status || "", today, counts, cards, totals, rows, cashAccounts: cash.list };
	}

	/**
	 * Tìm nhân viên có hồ sơ lương của công ty con theo mã hoặc họ tên (không phân biệt hoa thường; dấu tiếng Việt phải gõ đúng).
	 * Trả tối đa 20 dòng {id, code, name, department}; more = true khi còn kết quả chưa hiện.
	 */
	function employeeSearch(params) {
		const subsidiary = String((params && params.subsidiary) || "");
		if (!isId(subsidiary)) throw fail("Select a subsidiary", "Chưa chọn công ty con");
		const q = String((params && params.q) || "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 60);
		const prof = Store.rec("employee");
		const like = `%${q.replace(/[%_\\]/g, "")}%`;
		const match = q ? " AND (LOWER(e.entityid) LIKE ? OR LOWER(e.lastname || ' ' || e.firstname) LIKE ? OR LOWER(e.firstname || ' ' || e.lastname) LIKE ?)" : "";
		const binds = q ? [like, like, like] : [];
		// Id công ty con là số nguyên: ghép thẳng. Tên phòng ban lấy bằng JOIN; vai trò không đọc được bảng department thì dùng BUILTIN.DF.
		const sql = (dept, join) =>
			`SELECT * FROM (SELECT e.id, e.entityid, e.firstname, e.lastname, ${dept} AS deptname FROM employee e` +
			` INNER JOIN ${prof.type} p ON p.${prof.fields.employee.id} = e.id AND p.isinactive = 'F'${join}` +
			` WHERE e.isinactive = 'F' AND p.${prof.fields.subsidiary.id} = ${subsidiary}${match} ORDER BY e.entityid) WHERE ROWNUM <= ${SEARCH_LIMIT + 1}`;
		let rows;
		try {
			rows = Store.run(sql("d.fullname", " LEFT JOIN department d ON d.id = e.department"), binds, "s4vp_adv_emp_search");
		} catch (e) {
			rows = Store.run(sql("BUILTIN.DF(e.department)", ""), binds, "s4vp_adv_emp_search");
		}
		const seen = new Set();
		const items = [];
		for (const r of rows) {
			const id = String(r.id);
			if (seen.has(id)) continue;
			seen.add(id);
			items.push({ id, code: r.entityid || "", name: [r.lastname, r.firstname].filter(Boolean).join(" ").trim() || r.entityid || "", department: r.deptname || "" });
		}
		return { items: items.slice(0, SEARCH_LIMIT), more: items.length > SEARCH_LIMIT };
	}

	const routes = {
		get: {
			advancesView: { roles: "payroll", run: advancesView },
			employeeSearch: { roles: "payroll", run: employeeSearch },
		},
		post: {},
	};

	return { routes, advancesView, employeeSearch };
});
