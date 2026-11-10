/**
 * Chạy lương cho một bảng lương (docs/design/Main.dc.html): các bước, số tổng, so sánh kỳ trước, thao tác theo bước.
 *
 * Mô-đun route của giao diện bản 2 (docs/UI_V2.md mục 5): RESTlet s4vp_rl_api tra action trong routes.get / routes.post,
 * kiểm tra vai trò theo roles ("all" | "hr" | "acct" | "payroll" | "admin") rồi gọi run(params | body). Tên action không
 * trùng action cũ của RESTlet. Lỗi nghiệp vụ: throw fail(en, vi).
 *
 * GET  runView  {id, threshold?}        toàn bộ dữ liệu màn chạy lương, không kèm chi tiết từng nhân viên (dạng trả về: xem view()).
 * GET  runLine  {id, line, prev?}       chi tiết một nhân viên cho mọi tab theo nhân viên của khung chi tiết (thu nhập, khấu trừ,
 *                                       bảo hiểm, thuế TNCN, công, giờ công + timesheet từng ngày, phân bổ, cấn trừ tạm ứng) và
 *                                       so sánh từng khoản với kỳ trước; prev = id bảng lương kỳ trước do runView trả.
 *                                       Chỉ đọc đúng một dòng (không gọi Payroll.detail / Payroll.timesheet vì hai hàm đó nạp
 *                                       mọi dòng của bảng lương).
 * POST submitRun {id}                   gửi duyệt: bảng lương đã tính (C) -> chờ duyệt (P). RESTlet cũ chưa có thao tác đặt
 *                                       trạng thái P; duyệt / từ chối / mở lại của api/Payroll đã nhận trạng thái P.
 * Mọi thao tác khác (tải nhân viên, đồng bộ giờ, tính, giữ, duyệt, từ chối, mở lại, ghi sổ, đảo...) dùng action cũ.
 *
 * Governance: số truy vấn không phụ thuộc số nhân viên. runView đọc dòng kỳ này + kỳ trước kèm mã, họ tên, phòng ban trong
 * MỘT truy vấn (api/Lean.batchLines, cùng câu lệnh với phân hệ Kiểm tra nên lượt GET chỉ đọc một lần), bảng lương kỳ trước
 * bằng một truy vấn nhỏ (Lean.batchesNear); chi tiết JSON của dòng chỉ đọc khi mở một nhân viên (runLine).
 * Dòng gửi về trình duyệt được thu gọn (xem leanLine): 1.000 dòng dưới 0,5 MB.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Payroll", "./Settings", "./Checks", "./TimeLines", "./Lean", "../core/RunSteps", "../core/PayCompare", "../core/Money"], (Store, Payroll, Settings, Checks, TimeLines, Lean, RunSteps, PayCompare, Money) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const DEFAULT_THRESHOLD = 0.1;
	const COMPARE_KEYS = ["gross", "ee_ins", "er_ins", "pit", "net"];
	const TOTAL_KEYS = ["gross", "exempt", "ee_ins", "er_ins", "pit", "other_ded", "advance", "net"];
	// Số tiền của dòng đưa lên lưới: bằng 0 thì không gửi (giao diện coi thiếu là 0)
	const LINE_MONEY = ["gross", "ee_ins", "pit", "net"];

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

	/**
	 * Dòng nhân viên thu gọn cho lưới của màn Chạy lương: chỉ các trường giao diện dùng, bỏ giá trị rỗng (null, chuỗi rỗng,
	 * số tiền bằng 0, cờ false). cmp chỉ còn {kind, diff?, pct?, over?}; số chi tiết của một nhân viên lấy bằng runLine.
	 */
	function leanLine(l, c) {
		const out = { id: l.id, employee: l.employee };
		if (!blank(l.code)) out.code = l.code;
		if (!blank(l.name)) out.name = l.name;
		if (!blank(l.department)) out.department = l.department;
		if (!blank(l.employment_type)) out.employment_type = l.employment_type;
		if (!blank(l.std_days)) out.std_days = l.std_days;
		if (!blank(l.work_days)) out.work_days = l.work_days;
		for (const k of LINE_MONEY) if (!blank(l[k]) && Number(l[k]) !== 0) out[k] = l[k];
		if (!blank(l.error)) out.error = l.error;
		if (!blank(l.warnings)) out.warnings = l.warnings;
		const cmp = { kind: c.kind };
		if (c.diff !== null && c.diff !== undefined) cmp.diff = c.diff;
		if (c.pct !== null && c.pct !== undefined) cmp.pct = c.pct;
		if (c.over) cmp.over = true;
		out.cmp = cmp;
		return out;
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

	/**
	 * Như previousBatch nhưng cho runView: một truy vấn nhỏ (bảng lương của công ty con kèm kỳ) thay cho đọc mọi cột của mọi kỳ
	 * và mọi bảng lương. Cùng quy tắc chọn (core/PayCompare.pickPrevious).
	 */
	function previousOf(batch, period) {
		const list = Lean.batchesNear(batch.id);
		const periods = {};
		for (const x of list) if (!blank(x.period)) periods[x.period] = { id: x.period, name: x.periodName, end: x.periodEnd };
		if (period) periods[period.id] = { id: period.id, name: period.name, end: period.end };
		const prev = PayCompare.pickPrevious(batch, list, periods);
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
	 *   lines: Array,             dòng nhân viên thu gọn (leanLine): {id, employee, code, name, department, employment_type, std_days,
	 *                             work_days, gross, ee_ins, pit, net, error, warnings, cmp: {kind: "new"|"both", diff, pct, over}};
	 *                             trường rỗng / bằng 0 / false không gửi
	 *   totals: object,           {count, errors, warned, gross, exempt, ee_ins, er_ins, pit, other_ded, advance, net, insurance, cost,
	 *                             pitEmployee, pitContractor, netEmployee, netContractor}
	 *   compare: {previous: {id, name, status, period, periodName, periodEnd}|null, threshold, summary, leavers: [{employee, kind, code, name, previous}]}
	 *   transactions: object      {<id>: {tranid, approval, posting, voided}} của bút toán ghi sổ, bút toán đảo, bill
	 * }}
	 */
	function view(params) {
		const id = String((params && params.id) || "");
		if (!id) throw fail("Payroll batch is required", "Chưa chọn bảng lương");
		const b = Payroll.getBatch(id);
		const period = Store.get("period", b.period);
		const group = blank(b.paygroup) ? null : Store.get("paygroup", b.paygroup);
		const limit = threshold(params.threshold);

		let prev = null;
		try {
			prev = previousOf(b, period);
		} catch (e) {
			// Không đọc được kỳ trước: màn hình vẫn mở, chỉ thiếu số so sánh
			prev = null;
		}
		// Dòng kỳ này và kỳ trước trong một truy vấn (kèm mã, họ tên, phòng ban)
		const all = Lean.batchLines([id, prev ? prev.id : null]);
		const lines = all.filter((l) => l.batch === id);
		const prevLines = prev ? all.filter((l) => l.batch === String(prev.id)) : null;
		const cmp = PayCompare.compareLines(lines, prevLines, { key: "net", keys: COMPARE_KEYS, threshold: limit });
		const prevInfo = {};
		for (const l of prevLines || []) if (!prevInfo[l.employee]) prevInfo[l.employee] = l;

		// Danh sách cảnh báo trả kèm: gọi checksList trước rồi lấy số đếm từ đó (một lần tính, giao diện khỏi gọi checksList).
		// Bảng lương lớn có thể có vài nghìn cảnh báo: chỉ gửi 200 mục đầu (lỗi và mục chưa đóng trước) kèm tổng theo quy tắc.
		let checks = null;
		let checksList = null;
		try {
			if (Checks && typeof Checks.checksList === "function") {
				const cl = Checks.checksList({ batch: id, limit: 200, brief: true });
				checksList = { counts: cl.counts || null, items: cl.items || [], total: cl.total || 0, truncated: !!cl.truncated, groups: cl.groups || [], byEmployee: cl.byEmployee || null };
				const n = (v) => (isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
				if (cl.counts) checks = { open: n(cl.counts.open), errors: n(cl.counts.errors), warnings: n(cl.counts.warnings), resolved: n(cl.counts.resolved) };
			}
		} catch (e) {
			checksList = null;
		}
		if (!checks) checks = checksSummary(id);
		if (!checks) checksList = null;
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
			checksList,
			lines: lines.map((l, i) => leanLine(l, cmp.rows[i])),
			totals,
			compare: {
				previous: prev,
				threshold: limit,
				summary: cmp.summary,
				leavers: cmp.leavers.map((l) => ({ employee: l.employee, kind: l.kind, previous: l.previous, code: (prevInfo[l.employee] || {}).code || "", name: (prevInfo[l.employee] || {}).name || "" })),
			},
			transactions: tx,
		};
	}

	const numOrNull = (v) => (blank(v) || !isFinite(Number(v)) ? null : Number(v));
	const ATTENDANCE_KEYS = ["std_days", "work_days", "paid_leave", "unpaid_leave", "si_leave", "absence_days", "ot_hours"];

	/**
	 * Số liệu tính thuế TNCN của dòng: chỉ lấy số gói đã tính và lưu trên dòng / trong JSON chi tiết, không tính lại.
	 * Ưu tiên khối d.pit {method, selfDeduction, dependentDeduction} lưu lúc tính lương (phương pháp đúng tại thời điểm tính).
	 * Bảng lương tính trước khi có khối này: method đọc từ hồ sơ lương hiện tại, selfDeduction / dependentDeduction = null và
	 * giao diện hiện tổng giảm trừ gia cảnh.
	 */
	function taxOf(l, d) {
		let method = null;
		let flatCommitment = null;
		try {
			const prof = blank(l.profile) ? null : Store.get("employee", l.profile);
			if (prof) {
				method = norm(prof.pit_method) || "P";
				flatCommitment = !!prof.flat_commit;
			}
		} catch (e) {
			method = null;
		}
		const p = d.pit && typeof d.pit === "object" ? d.pit : {};
		if (!blank(p.method)) method = norm(p.method);
		return {
			method,
			flatCommitment,
			gross: numOrNull(l.gross),
			exempt: numOrNull(l.exempt),
			taxable: numOrNull(l.taxable),
			insurance: numOrNull(d.employeeCompulsoryInsurance),
			dependents: numOrNull(l.dependents),
			selfDeduction: numOrNull(p.selfDeduction),
			dependentDeduction: numOrNull(p.dependentDeduction),
			familyDeduction: numOrNull(l.family_ded),
			otherDeductions: numOrNull(l.other_tax_ded),
			assessable: numOrNull(l.assessable),
			pit: numOrNull(l.pit),
		};
	}

	/**
	 * Timesheet từng ngày của một nhân viên trong cửa sổ kết công của kỳ (chỉ xem), cùng dạng với Payroll.timesheet.
	 * Lỗi (vai trò không xem được Time, thiếu kỳ) trả kèm khóa failed để các tab khác vẫn mở được.
	 */
	function timesheetOf(batch, employee) {
		try {
			const period = Store.get("period", batch.period);
			if (!period) return { from: "", to: "", requireApproval: false, entries: [] };
			const w = TimeLines.windowOf(period);
			const group = blank(period.paygroup) ? null : Store.get("paygroup", period.paygroup);
			return { from: w.from, to: w.to, requireApproval: !!Settings.resolve(batch.subsidiary, group).requireTimeApproval, entries: TimeLines.entries([employee], w.from, w.to) };
		} catch (e) {
			return { from: "", to: "", requireApproval: false, entries: [], failed: String((e && e.message) || e).slice(0, 300) };
		}
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
	 *   attendance: object,       {std_days, work_days, paid_leave, unpaid_leave, si_leave, absence_days, ot_hours, att_locked}
	 *   tax: object,              {method, flatCommitment, gross, exempt, taxable, insurance, dependents, selfDeduction, dependentDeduction,
	 *                             familyDeduction, otherDeductions, assessable, pit} - xem taxOf()
	 *   timesheet: object,        {from, to, requireApproval, entries: [{id, date, hours, projectName, taskName, approval, statusName, memo}], failed?}
	 *   allocations: Array,       {component, project, task, branch, workCenter, source, hours, ratio, amount}
	 *   advanceOffsets: Array,    {refNbr, amount, remainingBalance, id}
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
		const b = Payroll.getBatch(id);
		const attendance = { att_locked: !!l.att_locked };
		for (const k of ATTENDANCE_KEYS) attendance[k] = numOrNull(l[k]);
		try {
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
			attendance,
			tax: taxOf(l, d),
			time: Store.find("batch_time", { where: "{batch} = ? AND {employee} = ?", params: [id, l.employee] }),
			timesheet: timesheetOf(b, l.employee),
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
