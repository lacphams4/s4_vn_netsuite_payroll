/**
 * Trang chủ (docs/design/TrangChu.dc.html): việc hôm nay, kỳ đang chạy, việc cần xử lý, hạn sắp đến.
 *
 * Mô-đun route của giao diện bản 2 (docs/UI_V2.md mục 5): RESTlet s4vp_rl_api tra action trong routes.get / routes.post,
 * kiểm tra vai trò theo roles ("all" | "hr" | "acct" | "payroll" | "admin") rồi gọi run(params | body). Tên action không
 * trùng action cũ của RESTlet. Lỗi nghiệp vụ: throw fail(en, vi).
 *
 * GET homeSummary {subsidiary} - CHỈ ĐỌC, không ghi gì. Trả:
 *   today            'YYYY-MM-DD' theo múi giờ người dùng (api/Clock)
 *   period           kỳ đang chạy chọn theo ngày (core/Deadlines.currentPeriod) hoặc null:
 *                    {id, code, start, end, status, attStatus, stdDays, taxMonth, paygroup, paygroupCode, containsToday}
 *   previousPeriod   kỳ liền trước cùng nhóm lương {id, code, start, end} hoặc null
 *   batchCounts      {total, byStatus: {H, B, C, P, A, J, R, V}} của kỳ đang chạy
 *   runs             [{kind: 'payroll' | 'attendance' | 'period', group: 'running' | 'upcoming' | 'done', ...}]
 *                      payroll:    {id, name, description, status, empCount, period, periodCode, docDate, steps, progress, checks}
 *                      attendance: {period, periodCode, stdDays, locked, employees, lockedRows, pendingDocs, steps, progress}
 *                      period:     {period, periodCode, start, end}
 *                    steps / progress theo core/RunSteps; checks = Checks.summary(batch) hoặc null khi chưa có / chưa biết
 *   runCounts        {running, upcoming, done} (done đếm đủ, runs chỉ mang RECENT_DONE bảng lương đã xong gần nhất)
 *   todos            [{key, kind, tone: 'error' | 'warn' | 'info', owner: 'hr' | 'acct' | 'all', count?, note?, date?, daysLeft?,
 *                      batch?: {id, name}, period?: {id, code}, go: {view, params}}] - giao diện đổi kind / note thành chữ
 *   pendingDocs      {leave, ot, trip, exception, total} chứng từ công chờ duyệt (trạng thái P) của công ty con
 *   net              {current, previous, diff, pct, currentBatches, previousBatches} tổng thực lĩnh các bảng lương đã tính
 *                    (không tính bảng đã đảo) của kỳ đang chạy và kỳ liền trước; previous / diff / pct = null khi không có
 *   periodBatches    {current, previous}: [{id, name, description, status, empCount, counted, net}] - current là mọi bảng lương
 *                    của kỳ đang chạy, previous chỉ bảng đã tính của kỳ liền trước (tối đa MAX_PERIOD_BATCHES mỗi kỳ, mới nhất
 *                    trước); net chỉ có khi counted (đã tính, chưa đảo), ngược lại null. Lấy từ cùng truy vấn bảng lương.
 *   deadlines        core/Deadlines.milestones của kỳ đang chạy: [{key, date, state, daysLeft}]
 *   deadlineBatch    {id, name} bảng lương dùng để tính mốc, hoặc null
 *   statutoryDeadlines  false: gói chưa có tham số hạn nộp tờ khai / bảo hiểm nên chỉ có mốc nội bộ
 *   permits          {expired, expiring, nextExpiry} giấy phép lao động (null khi không đọc được)
 *
 * Governance: số truy vấn cố định và nhỏ, không kéo dữ liệu theo nhân viên: nhóm lương, kỳ, bảng lương (mỗi thứ một truy vấn
 * chỉ các cột cần), chứng từ công chờ duyệt (MỘT truy vấn đếm UNION ALL cho bốn loại, lọc công ty con bằng EXISTS trên hồ
 * sơ lương thay cho đọc mọi hồ sơ), số dòng tổng hợp công (gom nhóm), giấy phép lao động (chỉ giấy đang hiệu lực / đã hết
 * hạn của công ty con); Checks.summary chỉ gọi cho tối đa MAX_CHECKED bảng lương đang dở.
 * Không ghi lương hay số định danh vào log.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/log", "./Store", "./Clock", "./Checks", "./WorkPermits", "./Lean", "../core/Dates", "../core/RunSteps", "../core/Deadlines"], (log, Store, Clock, Checks, WorkPermits, Lean, Dates, RunSteps, Deadlines) => {
	const MAX_RUNNING = 20; // số bảng lương đang dở đưa lên trang chủ
	const MAX_CHECKED = 6; // số bảng lương đang dở được hỏi cảnh báo (Checks.summary)
	const RECENT_DONE = 5; // số bảng lương đã xong gần nhất đưa lên trang chủ
	const UPCOMING = 2; // số kỳ sắp tới
	const MAX_PERIOD_BATCHES = 50; // số bảng lương mỗi kỳ trả trong periodBatches (thẻ số liệu bấm xem chi tiết)
	const DOC_TYPES = { leave: "leave_request", ot: "ot_request", trip: "business_trip", exception: "att_exception" };
	// Trường ngày đầu / ngày cuối của từng loại chứng từ công (đơn làm thêm, phiếu ngoại lệ chỉ có một ngày)
	const DOC_DATES = { leave: ["from", "to"], trip: ["from", "to"], ot: ["work_date", "work_date"], exception: ["work_date", "work_date"] };
	const BATCH_KEYS = ["name", "description", "subsidiary", "period", "status", "calculated", "emp_count", "doc_date", "net"];
	const PERIOD_KEYS = ["name", "paygroup", "start", "end", "std_days", "status", "att_status", "tax_month"];
	// Số ngày nhắc trước khi giấy phép hết hạn khi không đọc được thiết lập (core/PlanRecords.DEFAULTS.reminderDays)
	const PERMIT_REMINDER_DAYS = 60;
	const FINAL = ["R", "V"];

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	/** Phần phụ (chứng từ công, cảnh báo, giấy phép) lỗi thì trang chủ vẫn chạy với giá trị dự phòng. */
	function safe(title, fallback, fn) {
		try {
			return fn();
		} catch (e) {
			log.error({ title: `s4vp home ${title}`, details: String((e && e.message) || e).slice(0, 300) });
			return fallback;
		}
	}

	const int = (v) => {
		const n = Number(v);
		return isFinite(n) && n > 0 ? Math.floor(n) : 0;
	};
	const amount = (v) => {
		const n = Number(v);
		return isFinite(n) ? n : 0;
	};
	const periodRef = (p) => (p ? { id: String(p.id), code: p.name || "" } : null);
	const batchRef = (b) => (b ? { id: String(b.id), name: b.name || String(b.id) } : null);

	// ------------------------------------------------------------------ đọc dữ liệu

	/** Kỳ của các nhóm lương dùng cho công ty con (nhóm không gắn công ty con là nhóm dùng chung). */
	function periodsOf(subsidiary) {
		const groups = {};
		for (const g of Lean.select("paygroup", ["name", "subsidiary"], { includeInactive: true, tag: "s4vp_home_paygroups" })) groups[g.id] = g;
		const periods = Lean.select("period", PERIOD_KEYS, { tag: "s4vp_home_periods" }).filter((p) => {
			const g = groups[p.paygroup];
			return !g || !g.subsidiary || String(g.subsidiary) === subsidiary;
		});
		return { periods, groups };
	}

	/** Số dòng tổng hợp công của kỳ theo trạng thái, chỉ nhân viên của công ty con: {total, locked}; null khi không đọc được. */
	function attendanceCounts(periodId, subsidiary) {
		const def = Store.rec("attendance");
		const f = def.fields;
		const tally = (rows) => {
			const out = { total: 0, locked: 0 };
			for (const r of rows) {
				const n = int(r.n);
				out.total += n;
				if (Store.codeOf("attendance_status", r.st) === "L") out.locked += n;
			}
			return out;
		};
		const base = `SELECT t.${f.status.id} AS st, COUNT(*) AS n FROM ${def.type} t`;
		const group = ` GROUP BY t.${f.status.id}`;
		try {
			return tally(Store.run(`${base} INNER JOIN employee e ON e.id = t.${f.employee.id} WHERE t.${f.period.id} = ? AND t.isinactive = 'F' AND e.subsidiary = ?${group}`, [periodId, subsidiary], "s4vp_home_att"));
		} catch (e) {
			// Vai trò không đọc được bảng employee: đếm theo kỳ (nhóm lương dùng chung thì gồm cả công ty con khác)
			return safe("attendance", null, () => tally(Store.run(`${base} WHERE t.${f.period.id} = ? AND t.isinactive = 'F'${group}`, [periodId], "s4vp_home_att2")));
		}
	}

	/**
	 * Câu đếm chứng từ công chờ duyệt của một loại: n = số chứng từ của công ty con, inp = số chứng từ giao kỳ đang chạy.
	 * Chứng từ không ghi công ty con thì lấy theo hồ sơ lương của nhân viên (như api/Attendance.list) bằng EXISTS - không đọc
	 * hồ sơ nào về máy chủ ứng dụng. Tham số: [cuối kỳ, đầu kỳ, trạng thái P, công ty con, công ty con].
	 */
	function docCountSql(type) {
		const name = DOC_TYPES[type];
		const from = Lean.col(name, DOC_DATES[type][0]);
		const to = Lean.col(name, DOC_DATES[type][1]);
		const sub = Lean.col(name, "subsidiary");
		const mine = `(${sub} = ? OR (${sub} IS NULL AND EXISTS (SELECT 1 FROM ${Lean.rec("employee").type} p WHERE ${Lean.col("employee", "employee", "p")} = ${Lean.col(name, "employee")} AND ${Lean.col("employee", "subsidiary", "p")} = ?)))`;
		return (
			`SELECT '${type}' AS kind, COUNT(*) AS n, SUM(CASE WHEN ${from} <= TO_DATE(?, 'YYYY-MM-DD') AND COALESCE(${to}, ${from}) >= TO_DATE(?, 'YYYY-MM-DD') THEN 1 ELSE 0 END) AS inp ` +
			`FROM ${Lean.rec(name).type} t WHERE t.isinactive = 'F' AND ${Lean.col(name, "status")} = ? AND ${mine}`
		);
	}

	/**
	 * Chứng từ công chờ duyệt (P) của công ty con: {leave, ot, trip, exception, total, inPeriod} - chỉ số đếm.
	 * Một truy vấn UNION ALL cho cả bốn loại; account không chạy được câu gộp (hoặc thiếu một loại record) thì đếm từng loại.
	 */
	function pendingDocs(subsidiary, period) {
		const out = { leave: 0, ot: 0, trip: 0, exception: 0, total: 0, inPeriod: 0 };
		const pending = safe("request_status", null, () => Store.idOf("request_status", "P"));
		if (!pending) return out;
		// Không có kỳ đang chạy: khoảng ngày rỗng để inp = 0
		const one = [period ? period.end : "1900-01-01", period ? period.start : "2999-12-31", pending, subsidiary, subsidiary];
		const types = Object.keys(DOC_TYPES);
		let rows;
		try {
			rows = Store.run(types.map(docCountSql).join(" UNION ALL "), types.reduce((all) => all.concat(one), []), "s4vp_home_docs");
		} catch (e) {
			rows = [];
			for (const type of types) rows = rows.concat(safe(`docs ${type}`, [], () => Store.run(docCountSql(type), one, `s4vp_home_docs_${type}`)));
		}
		for (const r of rows) {
			if (!(r.kind in DOC_TYPES)) continue;
			out[r.kind] += int(r.n);
			out.total += int(r.n);
			out.inPeriod += int(r.inp);
		}
		return out;
	}

	/** Cảnh báo của bảng lương qua Checks.summary (mục 9); null khi phân hệ Kiểm tra chưa có hoặc lỗi. */
	function checksOf(batchId) {
		if (!Checks || typeof Checks.summary !== "function") return null;
		return safe("checks", null, () => {
			const s = Checks.summary(batchId);
			if (!s || typeof s !== "object") return null;
			return { open: int(s.open), errors: int(s.errors), warnings: int(s.warnings), resolved: int(s.resolved) };
		});
	}

	/**
	 * Giấy phép lao động của công ty con: chỉ đọc giấy đang hiệu lực (A) hoặc đã hết hạn (E) với hai cột trạng thái, ngày hết
	 * hạn; công ty con lấy theo hồ sơ lương của nhân viên bằng EXISTS (không đọc mọi hồ sơ như WorkPermits.list). Số ngày nhắc
	 * trước lấy từ WorkPermits.params() và chỉ hỏi khi có giấy đang hiệu lực.
	 */
	function permitsOf(subsidiary, today) {
		return safe("permits", null, () => {
			const out = { expired: 0, expiring: 0, nextExpiry: null };
			const mine = `EXISTS (SELECT 1 FROM ${Lean.rec("employee").type} p WHERE ${Lean.col("employee", "employee", "p")} = {employee} AND ${Lean.col("employee", "subsidiary", "p")} = ?)`;
			const rows = Lean.select("work_permit", ["status", "expiry"], {
				where: `{status} IN (?, ?) AND ${mine}`, params: [Store.idOf("wp_status", "A"), Store.idOf("wp_status", "E"), subsidiary], tag: "s4vp_home_permits",
			});
			let reminder = null;
			for (const p of rows) {
				// A = đang hiệu lực, E = đã hết hạn; bản nháp, đã nộp, đã thu hồi không nhắc
				const daysLeft = p.expiry ? Dates.diff(today, p.expiry) : null;
				if (p.status === "E" || (p.status === "A" && daysLeft !== null && daysLeft < 0)) {
					out.expired += 1;
					continue;
				}
				if (p.status !== "A" || daysLeft === null) continue;
				if (reminder === null) {
					reminder = PERMIT_REMINDER_DAYS;
					try {
						const v = WorkPermits && typeof WorkPermits.params === "function" ? Number(WorkPermits.params().reminderDays) : NaN;
						if (isFinite(v) && v >= 0) reminder = v;
					} catch (e) {
						reminder = PERMIT_REMINDER_DAYS;
					}
				}
				if (daysLeft <= reminder) {
					out.expiring += 1;
					if (!out.nextExpiry || Dates.cmp(p.expiry, out.nextExpiry) < 0) out.nextExpiry = p.expiry;
				}
			}
			return out;
		});
	}

	// ------------------------------------------------------------------ dựng kết quả

	function payrollRun(b, period, checks) {
		const counts = { employees: b.emp_count };
		if (checks) counts.openChecks = checks.open;
		const steps = RunSteps.payrollSteps(b, period, counts);
		return {
			kind: "payroll", group: FINAL.includes(b.status) ? "done" : "running", id: String(b.id), name: b.name || String(b.id), description: b.description || "",
			status: b.status || "", empCount: int(b.emp_count), period: period ? String(period.id) : b.period ? String(b.period) : "", periodCode: period ? period.name || "" : "",
			docDate: b.doc_date || null, steps, progress: RunSteps.progress(steps), checks: checks || null,
		};
	}

	/** Việc của một bảng lương đang dở, theo bước hiện tại của thanh bước. */
	function batchTodo(run, b, period, today, currentId) {
		const key = run.progress.currentKey;
		if (!key) return null;
		const step = run.steps.find((s) => s.key === key) || {};
		const todo = { key: `batch:${run.id}`, kind: `batch_${key}`, tone: "warn", owner: "all", batch: batchRef(b), period: periodRef(period), go: { view: "payrollRun", params: { id: run.id } } };
		if (key === "attendance") {
			// Công của kỳ đang chạy đã có việc "khóa công" riêng: không nhắc hai lần
			if (period && String(period.id) === currentId) return null;
			todo.owner = "hr";
			todo.go = { view: "attendance", params: { period: period ? String(period.id) : "" } };
		} else if (key === "prepare") todo.tone = "info";
		else if (key === "calculate") todo.note = step.note === "hold" ? "hold" : "";
		else if (key === "review") {
			if (step.note === "rejected") {
				todo.note = "rejected";
				todo.tone = "error";
			} else if (run.checks) {
				todo.note = "openChecks";
				todo.count = run.checks.open;
				if (run.checks.errors > 0) todo.tone = "error";
			} else todo.note = "unknownChecks";
		} else if (key === "approve") todo.note = step.note === "pending" ? "pending" : "";
		else if (key === "post") todo.owner = "acct";
		const due = period && period.end ? b.doc_date || period.end : null;
		if (due) {
			todo.date = due;
			todo.daysLeft = safe("todo date", null, () => Dates.diff(today, due));
			if (todo.daysLeft !== null && todo.daysLeft < 0 && todo.tone !== "info") todo.tone = "error";
		}
		return todo;
	}

	function summary(params) {
		const subsidiary = String((params && params.subsidiary) || "").trim();
		if (!subsidiary) throw fail("Select a subsidiary first", "Hãy chọn công ty con");
		const today = Clock.today();
		const { periods, groups } = periodsOf(subsidiary);
		const periodById = {};
		for (const p of periods) periodById[p.id] = p;
		const batches = Lean.select("batch", BATCH_KEYS, { where: "{subsidiary} = ?", params: [subsidiary], order: "{id} DESC", tag: "s4vp_home_batches" });
		const open = batches.filter((b) => !FINAL.includes(b.status));
		const finished = batches.filter((b) => FINAL.includes(b.status));

		const current = Deadlines.currentPeriod(periods, today, open.map((b) => b.period));
		const currentId = current ? String(current.id) : "";
		const previous = Deadlines.previousPeriod(periods, current);
		const inCurrent = current ? batches.filter((b) => String(b.period) === currentId) : [];
		const docs = safe("docs", { leave: 0, ot: 0, trip: 0, exception: 0, total: 0, inPeriod: 0 }, () => pendingDocs(subsidiary, current));
		const docCounts = { leave: docs.leave, ot: docs.ot, trip: docs.trip, exception: docs.exception, total: docs.total };

		const runs = [];
		const todos = [];

		// Công của kỳ đang chạy
		let attendanceDone = false;
		if (current) {
			const counts = attendanceCounts(currentId, subsidiary);
			const docsInPeriod = docs.inPeriod;
			const locked = current.att_status === "L";
			const steps = RunSteps.attendanceSteps(current, { openExceptions: docsInPeriod, hasSummary: counts ? counts.total : 0, hasBatch: inCurrent.some((b) => b.status !== "V") });
			const progress = RunSteps.progress(steps);
			attendanceDone = !progress.currentKey;
			runs.push({
				kind: "attendance", group: attendanceDone ? "done" : "running", period: currentId, periodCode: current.name || "", stdDays: current.std_days === undefined ? null : current.std_days,
				locked, employees: counts ? counts.total : null, lockedRows: counts ? counts.locked : null, pendingDocs: docsInPeriod, steps, progress,
			});
			if (!locked) {
				const daysLeft = safe("lock date", null, () => Dates.diff(today, current.end));
				todos.push({
					key: `lock:${currentId}`, kind: "lockAttendance", tone: daysLeft !== null && daysLeft < 0 ? "error" : "warn", owner: "hr", count: docsInPeriod,
					note: counts && counts.total ? "" : "noSummary", date: current.end, daysLeft, period: periodRef(current), go: { view: "attendance", params: { period: currentId } },
				});
			}
		}
		for (const type of Object.keys(DOC_TYPES)) {
			if (docCounts[type] > 0) todos.push({ key: `docs:${type}`, kind: `docs_${type}`, tone: "warn", owner: "hr", count: docCounts[type], go: { view: "attendanceLegacy", params: {} } });
		}

		// Bảng lương đang dở (mới nhất trước), rồi kỳ sắp tới, rồi bảng lương đã xong gần đây
		const runOf = {};
		open.slice(0, MAX_RUNNING).forEach((b, i) => {
			const period = periodById[b.period] || null;
			// Cảnh báo chỉ có nghĩa khi bảng lương đã tính (C), bị từ chối (J) hoặc đang chờ duyệt (P)
			const checks = i < MAX_CHECKED && ["C", "J", "P"].includes(b.status) ? checksOf(b.id) : null;
			const run = payrollRun(b, period, checks);
			runOf[b.id] = run;
			runs.push(run);
			const todo = batchTodo(run, b, period, today, currentId);
			if (todo) todos.push(todo);
		});
		if (current && !inCurrent.some((b) => b.status !== "V")) {
			todos.push({ key: `create:${currentId}`, kind: "createBatch", tone: "info", owner: "all", period: periodRef(current), go: { view: "payrollList", params: { period: currentId } } });
		}
		const withBatch = new Set(batches.map((b) => String(b.period)));
		const upcoming = Deadlines.upcomingPeriods(periods, today, UPCOMING + 1).filter((p) => String(p.id) !== currentId && !withBatch.has(String(p.id))).slice(0, UPCOMING);
		for (const p of upcoming) runs.push({ kind: "period", group: "upcoming", period: String(p.id), periodCode: p.name || "", start: p.start, end: p.end });
		for (const b of finished.slice(0, RECENT_DONE)) runs.push(payrollRun(b, periodById[b.period] || null, null));

		// Giấy phép lao động
		const permits = permitsOf(subsidiary, today);
		if (permits && permits.expired > 0) todos.push({ key: "permits:expired", kind: "permitsExpired", tone: "error", owner: "hr", count: permits.expired, go: { view: "permits", params: {} } });
		if (permits && permits.expiring > 0) todos.push({ key: "permits:expiring", kind: "permitsExpiring", tone: "warn", owner: "hr", count: permits.expiring, date: permits.nextExpiry, daysLeft: safe("permit date", null, () => Dates.diff(today, permits.nextExpiry)), go: { view: "permits", params: {} } });

		// Thực lĩnh kỳ này so với kỳ trước: chỉ bảng lương đã tính, không tính bảng đã đảo
		const counted = (list) => list.filter((b) => b.status !== "V" && b.calculated);
		const sum = (list) => list.reduce((s, b) => s + amount(b.net), 0);
		const curList = counted(inCurrent);
		const prevList = previous ? counted(batches.filter((b) => String(b.period) === String(previous.id))) : [];
		const net = { current: curList.length ? sum(curList) : null, previous: prevList.length ? sum(prevList) : null, diff: null, pct: null, currentBatches: curList.length, previousBatches: prevList.length };
		if (net.current !== null && net.previous !== null) {
			net.diff = net.current - net.previous;
			net.pct = net.previous ? net.diff / net.previous : null;
		}
		// Bảng lương của kỳ cho thẻ số liệu bấm xem chi tiết: dựng từ danh sách bảng lương đã đọc, không thêm truy vấn
		const countedIds = new Set(curList.concat(prevList).map((b) => String(b.id)));
		const brief = (b) => {
			const counted = countedIds.has(String(b.id));
			return { id: String(b.id), name: b.name || String(b.id), description: b.description || "", status: b.status || "", empCount: int(b.emp_count), counted, net: counted ? amount(b.net) : null };
		};
		const periodBatches = { current: inCurrent.slice(0, MAX_PERIOD_BATCHES).map(brief), previous: prevList.slice(0, MAX_PERIOD_BATCHES).map(brief) };

		// Mốc việc của kỳ: theo bảng lương đang dở của kỳ, không có thì bảng lương mới nhất chưa bị đảo
		const mainBatch = inCurrent.find((b) => !FINAL.includes(b.status)) || inCurrent.find((b) => b.status !== "V") || null;
		const deadlines = current ? Deadlines.milestones({ today, period: current, batch: mainBatch, statutory: [] }) : [];

		const byStatus = {};
		for (const b of inCurrent) byStatus[b.status || ""] = (byStatus[b.status || ""] || 0) + 1;
		const group = current ? groups[current.paygroup] : null;
		return {
			today,
			subsidiary,
			period: current
				? {
						id: currentId, code: current.name || "", start: current.start, end: current.end, status: current.status || "O", attStatus: current.att_status || "O",
						stdDays: current.std_days === undefined ? null : current.std_days, taxMonth: current.tax_month || "", paygroup: current.paygroup ? String(current.paygroup) : "",
						paygroupCode: group ? group.name || "" : "", containsToday: safe("contains", false, () => Dates.within(today, current.start, current.end)),
					}
				: null,
			previousPeriod: previous ? { id: String(previous.id), code: previous.name || "", start: previous.start, end: previous.end } : null,
			batchCounts: { total: inCurrent.length, byStatus },
			runs,
			runCounts: { running: open.length + (current && !attendanceDone ? 1 : 0), upcoming: upcoming.length, done: finished.length + (current && attendanceDone ? 1 : 0) },
			todos,
			pendingDocs: docCounts,
			net,
			periodBatches,
			deadlines,
			deadlineBatch: batchRef(mainBatch),
			statutoryDeadlines: false,
			permits,
		};
	}

	const routes = {
		get: {
			homeSummary: { roles: "all", run: (params) => summary(params) },
		},
		post: {},
	};

	return { routes, summary };
});
