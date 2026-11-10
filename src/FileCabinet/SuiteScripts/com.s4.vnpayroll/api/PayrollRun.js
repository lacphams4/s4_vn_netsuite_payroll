/**
 * Chạy lương cho một bảng lương (docs/design/Main.dc.html): các bước, số tổng, so sánh kỳ trước, thao tác theo bước.
 *
 * Mô-đun route của giao diện bản 2 (docs/UI_V2.md mục 5): RESTlet s4vp_rl_api tra action trong routes.get / routes.post,
 * kiểm tra vai trò theo roles ("all" | "hr" | "acct" | "payroll" | "admin") rồi gọi run(params | body). Tên action không
 * trùng action cũ của RESTlet. Lỗi nghiệp vụ: throw fail(en, vi).
 *
 * GET  runView  {id, threshold?}        toàn bộ dữ liệu màn chạy lương, không kèm chi tiết từng nhân viên (dạng trả về: xem view()).
 * GET  runLine  {id, line, prev?}       chi tiết một nhân viên (thu nhập, khấu trừ, bảo hiểm, công, giờ, phân bổ, tạm ứng) và
 *                                       so sánh từng khoản với kỳ trước; prev = id bảng lương kỳ trước do runView trả.
 * POST submitRun {id}                   gửi duyệt: bảng lương đã tính (C) -> chờ duyệt (P). RESTlet cũ chưa có thao tác đặt
 *                                       trạng thái P; duyệt / từ chối / mở lại của api/Payroll đã nhận trạng thái P.
 * Mọi thao tác khác (tải nhân viên, đồng bộ giờ, tính, giữ, duyệt, từ chối, mở lại, ghi sổ, đảo...) dùng action cũ.
 *
 * Governance: số truy vấn không phụ thuộc số nhân viên (dòng kỳ này, dòng kỳ trước, thông tin nhân viên mỗi thứ một truy
 * vấn theo lô 900); chi tiết JSON của dòng chỉ đọc khi mở một nhân viên (runLine).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Payroll", "./Settings", "./Checks", "../core/RunSteps", "../core/PayCompare", "../core/Money"], (Store, Payroll, Settings, Checks, RunSteps, PayCompare, Money) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const DEFAULT_THRESHOLD = 0.1;
	const COMPARE_KEYS = ["gross", "ee_ins", "er_ins", "pit", "net"];
	// Cột của dòng nhân viên đưa lên lưới (không có trường detail: JSON chi tiết chỉ đọc ở runLine)
	const LINE_FIELDS = [
		"employee", "employment_type", "std_days", "work_days", "paid_leave", "unpaid_leave", "ot_hours", "gross", "exempt", "ee_ins", "er_ins", "family_ded",
		"assessable", "pit", "other_ded", "net_before", "advance", "net", "att_locked", "warnings", "error",
	];
	const PREV_FIELDS = ["employee"].concat(COMPARE_KEYS);
	const TOTAL_KEYS = ["gross", "exempt", "ee_ins", "er_ins", "pit", "other_ded", "advance", "net"];

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function safeJson(s, def) {
		try {
			const v = s ? JSON.parse(s) : def;
			return v === null || v === undefined ? def : v;
		} catch (e) {
			return def;
		}
	}

	/** Dòng nhân viên của một bảng lương, chỉ các cột cần (một truy vấn, không đọc JSON chi tiết). */
	function leanLines(batchId, fields) {
		const def = Store.rec("batch_emp");
		const cols = ["t.id AS id"].concat(fields.map((k) => `t.${def.fields[k].id} AS c_${k}`));
		const rows = Store.run(`SELECT ${cols.join(", ")} FROM ${def.type} t WHERE t.${def.fields.batch.id} = ? AND t.isinactive = 'F' ORDER BY t.id`, [batchId], "s4vp_run_lines");
		return rows.map((r) => {
			const o = { id: String(r.id) };
			for (const k of fields) {
				const f = def.fields[k];
				let v = r[`c_${k}`];
				if (v === undefined) v = null;
				if (f.type === "check") v = v === "T" || v === true;
				else if (f.type === "select" && f.target && f.target.indexOf("list:") === 0) v = Store.codeOf(f.target.slice(5), v);
				else if (f.type === "select" && v !== null) v = String(v);
				else if (["float", "currency", "int", "percent"].indexOf(f.type) >= 0 && v !== null && v !== "") v = Number(v);
				o[k] = v;
			}
			return o;
		});
	}

	/** Số cảnh báo của bảng lương từ phân hệ Kiểm tra (mục 9); null khi phân hệ chưa có hoặc lỗi. */
	function checksSummary(batchId) {
		try {
			if (!Checks || typeof Checks.summary !== "function") return null;
			const s = Checks.summary(batchId);
			if (!s || typeof s !== "object") return null;
			const n = (v) => (isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
			return { open: n(s.open), errors: n(s.errors), warnings: n(s.warnings), resolved: n(s.resolved) };
		} catch (e) {
			return null;
		}
	}

	function threshold(v) {
		const n = Number(v);
		return !blank(v) && isFinite(n) && n > 0 && n <= 10 ? n : DEFAULT_THRESHOLD;
	}

	/** Bảng lương kỳ liền trước (theo ngày kết thúc kỳ) cùng công ty con, cùng nhóm lương; null nếu không có. */
	function previousBatch(batch) {
		const periods = {};
		for (const p of Store.find("period", { includeInactive: true })) periods[p.id] = { id: p.id, name: p.name, end: p.end };
		const batches = Store.find("batch", { where: "{subsidiary} = ?", params: [batch.subsidiary] });
		const prev = PayCompare.pickPrevious(batch, batches, periods);
		if (!prev) return null;
		const p = periods[prev.period] || {};
		return { id: prev.id, name: prev.name, status: prev.status, period: prev.period, periodName: p.name || "", periodEnd: p.end || "" };
	}

	function sumOf(lines, key, filter) {
		return Money.round(Money.sum(filter ? lines.filter(filter) : lines, (l) => l[key] || 0));
	}

	/**
	 * Dữ liệu màn chạy lương.
	 * @returns {{
	 *   batch: object,            bảng lương (các trường của record batch + periodName, journalNo, reversalNo, bills[]; messages là mảng dòng)
	 *   period: object|null,      {id, name, start, end, status, att_status, std_days}
	 *   paygroup: object|null,    {id, code, description}
	 *   steps: Array, progress: object,   theo core/RunSteps.payrollSteps / progress
	 *   checks: object|null,      {open, errors, warnings, resolved} từ Checks.summary; null khi chưa có phân hệ Kiểm tra
	 *   lines: Array,             dòng nhân viên: {id, employee, code, name, department, employment_type, std_days, work_days, ...,
	 *                             gross, ee_ins, er_ins, pit, other_ded, advance, net, error, warnings,
	 *                             cmp: {kind: "new"|"both", previous, diff, pct, over, values: {gross|ee_ins|er_ins|pit|net: {current, previous, diff, pct}}}}
	 *   totals: object,           {count, errors, warned, gross, exempt, ee_ins, er_ins, pit, other_ded, advance, net, insurance, cost,
	 *                             pitEmployee, pitContractor, netEmployee, netContractor}
	 *   compare: {previous: {id, name, status, period, periodName, periodEnd}|null, threshold, summary, leavers: [{employee, code, name, previous, values}]}
	 *   transactions: object      {<id>: {tranid, approval, posting, voided}} của bút toán ghi sổ, bút toán đảo, bill
	 * }}
	 */
	function view(params) {
		const id = String((params && params.id) || "");
		if (!id) throw fail("Payroll batch is required", "Chưa chọn bảng lương");
		const b = Payroll.getBatch(id);
		const period = Store.get("period", b.period);
		const group = blank(b.paygroup) ? null : Store.get("paygroup", b.paygroup);
		const lines = leanLines(id, LINE_FIELDS);
		const limit = threshold(params.threshold);

		let prev = null;
		let prevLines = null;
		try {
			prev = previousBatch(b);
			if (prev) prevLines = leanLines(prev.id, PREV_FIELDS);
		} catch (e) {
			// Không đọc được kỳ trước: màn hình vẫn mở, chỉ thiếu số so sánh
			prev = null;
			prevLines = null;
		}
		const cmp = PayCompare.compareLines(lines, prevLines, { key: "net", keys: COMPARE_KEYS, threshold: limit });
		const info = Payroll.employeesInfo(lines.map((l) => l.employee).concat(cmp.leavers.map((l) => l.employee)));

		const checks = checksSummary(id);
		const steps = RunSteps.payrollSteps(b, period, { employees: lines.length, openChecks: checks ? checks.open : undefined });
		const bills = safeJson(b.bills, []);
		const tx = Payroll.transactionsInfo([b.journal, b.reversal].concat((Array.isArray(bills) ? bills : []).map((x) => x && x.id)));
		const isContractor = (l) => l.employment_type === "C";
		const totals = { count: lines.length, errors: lines.filter((l) => !blank(l.error)).length, warned: lines.filter((l) => !blank(l.warnings)).length };
		for (const k of TOTAL_KEYS) totals[k] = sumOf(lines, k);
		totals.insurance = totals.ee_ins + totals.er_ins;
		totals.cost = totals.gross + totals.er_ins;
		totals.pitContractor = sumOf(lines, "pit", isContractor);
		totals.pitEmployee = totals.pit - totals.pitContractor;
		totals.netContractor = sumOf(lines, "net", isContractor);
		totals.netEmployee = totals.net - totals.netContractor;

		return {
			batch: Object.assign({}, b, {
				bills: Array.isArray(bills) ? bills : [],
				messages: blank(b.messages) ? [] : String(b.messages).split("\n").filter((m) => m).slice(0, 50),
				periodName: period ? period.name : "",
				journalNo: b.journal ? (tx[String(b.journal)] || {}).tranid || "" : "",
				reversalNo: b.reversal ? (tx[String(b.reversal)] || {}).tranid || "" : "",
			}),
			period: period ? { id: period.id, name: period.name, start: period.start, end: period.end, status: period.status, att_status: period.att_status, std_days: period.std_days } : null,
			paygroup: group ? { id: group.id, code: group.name, description: group.description } : null,
			steps,
			progress: RunSteps.progress(steps),
			checks,
			lines: lines.map((l, i) => {
				const e = info[l.employee] || {};
				const c = cmp.rows[i];
				return Object.assign({}, l, { code: e.code || "", name: e.name || "", department: e.departmentName || "", cmp: { kind: c.kind, previous: c.previous, diff: c.diff, pct: c.pct, over: c.over, values: c.values } });
			}),
			totals,
			compare: {
				previous: prev,
				threshold: limit,
				summary: cmp.summary,
				leavers: cmp.leavers.map((l) => Object.assign({}, l, { code: (info[l.employee] || {}).code || "", name: (info[l.employee] || {}).name || "" })),
			},
			transactions: tx,
		};
	}

	const inputAmount = (i) => (!blank(i.amount) ? Number(i.amount) : (Number(i.qty) || 0) * (Number(i.rate) || 0) * (blank(i.multiplier) ? 1 : Number(i.multiplier)));

	/**
	 * Chi tiết một nhân viên của bảng lương.
	 * @returns {{
	 *   line: object,             dòng nhân viên (không kèm JSON) + code, name, department
	 *   earnings: Array,          {inputId?, code, name, quantity, rate, multiplier, amount, exempt, source, ruleCode, project} - dòng hệ thống
	 *                             sinh và dòng nhập tay (inputId có giá trị: xóa được bằng action cũ deleteInput)
	 *   deductions: Array,        {inputId, code, name, amount} - khấu trừ sau thuế nhập tay
	 *   insurance: Array,         {code, wageBase, employeeRate, employeeAmount, employerRate, employerAmount}
	 *   time: Array,              dòng giờ công tính lương của nhân viên (record batch_time)
	 *   allocations: Array, advanceOffsets: Array,
	 *   compare: {previous: {id, name}|null, line: {gross|ee_ins|er_ins|pit|net: {current, previous, diff, pct}}|null,
	 *             earnings: [{code, name, current, previous, diff, pct, kind}], insurance: [...]}
	 * }}
	 */
	function lineDetail(params) {
		const id = String((params && params.id) || "");
		const lineId = String((params && params.line) || "");
		if (!id || !lineId) throw fail("Payroll batch and employee line are required", "Chưa chọn bảng lương hoặc nhân viên");
		const l = Store.get("batch_emp", lineId);
		if (!l || String(l.batch) !== id) throw fail("Employee line not found on this batch", "Không tìm thấy nhân viên trong bảng lương");
		const d = safeJson(l.detail, {});
		const ets = Settings.earningTypes();
		const nameOf = (code) => (ets.byCode[norm(code)] || {}).description || code || "";
		const inputs = Store.find("batch_input", { where: "{batch} = ? AND {employee} = ?", params: [id, l.employee] });
		const info = Payroll.employeesInfo([l.employee])[String(l.employee)] || {};

		const calc = (d.earnings || []).filter((x) => x.source !== "M");
		const manualCalc = (d.earnings || []).filter((x) => x.source === "M");
		const manualInputs = inputs.filter((i) => i.kind === "E");
		const earnings = calc.map((x) => ({
			code: x.earningType || "", name: nameOf(x.earningType), quantity: x.quantity, rate: x.rate, multiplier: x.multiplier, amount: x.amount || 0,
			exempt: x.taxExemptAmount || 0, source: x.source || "", ruleCode: x.ruleCode || "", project: x.project || "",
		}));
		manualInputs.forEach((i, n) => {
			// Dòng nhập tay sau khi tính có phần miễn thuế; khớp theo thứ tự nạp vào bộ tính (như màn cũ)
			const m = manualCalc.length === manualInputs.length ? manualCalc[n] : null;
			const et = ets.byId[i.earning_type] || {};
			earnings.push({
				inputId: i.id, code: et.code || "", name: i.description || et.description || "", quantity: i.qty, rate: i.rate, multiplier: i.multiplier,
				amount: m ? m.amount || 0 : inputAmount(i), exempt: m ? m.taxExemptAmount || 0 : null, source: "M", ruleCode: "", project: "",
			});
		});
		const insurance = d.insurance || [];

		// Kỳ trước: nhận id do runView trả (kiểm cùng công ty con), không thì tự tìm
		let prev = null;
		let prevDetail = null;
		let prevLine = null;
		try {
			const b = Payroll.getBatch(id);
			if (!blank(params.prev) && String(params.prev) !== id) {
				const pb = Store.get("batch", params.prev);
				if (pb && String(pb.subsidiary) === String(b.subsidiary)) prev = { id: pb.id, name: pb.name };
			} else if (blank(params.prev)) {
				const pb = previousBatch(b);
				if (pb) prev = { id: pb.id, name: pb.name };
			}
			if (prev) {
				prevLine = Store.find("batch_emp", { where: "{batch} = ? AND {employee} = ?", params: [prev.id, l.employee] })[0] || null;
				prevDetail = prevLine ? safeJson(prevLine.detail, {}) : {};
			}
		} catch (e) {
			prev = null;
			prevDetail = null;
			prevLine = null;
		}
		const lineCompare = {};
		for (const k of COMPARE_KEYS) lineCompare[k] = PayCompare.delta(l[k], prevLine ? prevLine[k] || 0 : null);
		const itemOpt = { codeOf: (x) => x.code, amountOf: (x) => x.amount, nameOf: (x) => x.name };
		const prevEarnings = prev && prevLine ? (prevDetail.earnings || []).map((x) => ({ code: x.earningType || "", name: nameOf(x.earningType), amount: x.amount || 0 })) : null;
		const prevInsurance = prev && prevLine ? (prevDetail.insurance || []).map((x) => ({ code: x.code, name: x.code, amount: x.employeeAmount || 0 })) : null;

		return {
			line: Object.assign({}, l, { detail: undefined, code: info.code || "", name: info.name || "", department: info.departmentName || "" }),
			earnings,
			deductions: inputs.filter((i) => i.kind === "D").map((i) => ({ inputId: i.id, code: i.code || "", name: i.description || "", amount: i.amount || 0 })),
			insurance,
			time: Store.find("batch_time", { where: "{batch} = ? AND {employee} = ?", params: [id, l.employee] }),
			allocations: d.allocations || [],
			advanceOffsets: d.advanceOffsets || [],
			compare: {
				previous: prev,
				inPrevious: !!prevLine,
				line: prev ? lineCompare : null,
				earnings: PayCompare.compareItems(earnings.map((x) => ({ code: x.code, name: x.name, amount: x.amount })), prevEarnings, itemOpt),
				insurance: PayCompare.compareItems(insurance.map((x) => ({ code: x.code, name: x.code, amount: x.employeeAmount || 0 })), prevInsurance, itemOpt),
			},
		};
	}

	/** Gửi duyệt: đã tính (C) -> chờ duyệt (P). Không đổi số liệu; duyệt vẫn kiểm dấu dữ liệu sau khi tính. */
	function submit(body) {
		const id = String((body && body.id) || "");
		if (!id) throw fail("Payroll batch is required", "Chưa chọn bảng lương");
		const b = Payroll.getBatch(id);
		if (!blank(b.job)) throw fail("The batch is being processed in the background; refresh later", "Bảng lương đang được xử lý nền (tính lương / ghi sổ / đảo), hãy tải lại sau");
		if (b.status !== "C" || !b.calculated) throw fail("Only calculated batches can be submitted for approval", "Chỉ gửi duyệt bảng lương đã tính");
		const period = Store.get("period", b.period);
		if (period && period.status === "C") throw fail("The pay period is closed", "Kỳ lương đã đóng");
		Store.submit("batch", id, { status: "P" });
		return { ok: true, status: "P" };
	}

	const routes = {
		get: {
			runView: { roles: "payroll", run: view },
			runLine: { roles: "payroll", run: lineDetail },
		},
		post: {
			submitRun: { roles: "payroll", run: submit },
		},
	};

	return { routes, view, lineDetail, submit };
});
