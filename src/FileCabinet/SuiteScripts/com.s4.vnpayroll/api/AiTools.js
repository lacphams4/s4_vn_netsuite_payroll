/**
 * Bộ công cụ cho trợ lý AI (NetSuite AI Connector Service - MCP; Claude, ChatGPT...): mặt tiền CÓ KIỂU của api/Dispatch.
 *
 * Nguyên tắc:
 *   - Mỗi công cụ ứng với đúng một action cố định của Dispatch; tham số được kiểm tra kiểu (id, ngày, tháng, enum, độ dài)
 *     trước khi gọi. Không công cụ nào nhận SuiteQL, tên bảng, tên trường hay tên action tự do.
 *   - Quyền: người gọi phải dùng role của gói (HR, kế toán, trình diễn, administrator); sau đó Dispatch áp ma trận quyền của
 *     từng action như trên màn hình. Thao tác ghi đi qua Dispatch.post nên có nhật ký thao tác (audit_log).
 *   - Thao tác ghi cần confirm = true; thiếu thì chỉ trả mô tả việc sẽ làm (needsConfirmation) để trợ lý hỏi lại người dùng.
 *   - Cố ý KHÔNG mở cho AI: ghi sổ bảng lương, đảo bảng lương, lập bill cơ quan thu, đóng / mở kỳ, khóa / mở khóa công,
 *     sửa thiết lập và tham số pháp lý, nạp file. Các việc này làm trên màn hình.
 *   - Kết quả được cắt gọn: danh sách dài trả theo limit / offset kèm tổng số; số định danh cá nhân vốn không rời máy chủ
 *     (api/HrCore). Không ghi tham số hay kết quả vào log.
 *
 * TOOLS là nguồn duy nhất: schema() sinh file scripts/s4vp_ct_payroll_schema.json (tools/gen_ai_schema.mjs), run() thực thi.
 * Kết quả run(): {ok: true, data} | {ok: true, needsConfirmation: true, willDo} | {ok: false, error: {type, message, messageVi}}.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dispatch"], (Dispatch) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const DEFAULT_LIMIT = 30;
	const MAX_LIMIT = 200;
	// Kết quả lớn hơn ngưỡng này (ký tự JSON) thì cắt mọi mảng dài còn TRIM_ARRAY phần tử
	const MAX_CHARS = 150000;
	const TRIM_ARRAY = 40;

	const fold = (s) =>
		String(blank(s) ? "" : s)
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/đ/g, "d")
			.replace(/Đ/g, "D")
			.toLowerCase();

	// ------------------------------------------------------------------ kiểu tham số
	const P = {
		id: (description, required) => ({ kind: "id", json: "string", description: `${description} (NetSuite internal id, digits only)`, required: !!required }),
		date: (description, required) => ({ kind: "date", json: "string", description: `${description} (YYYY-MM-DD)`, required: !!required }),
		month: (description, required) => ({ kind: "month", json: "string", description: `${description} (YYYY-MM)`, required: !!required }),
		int: (description, min, max, required) => ({ kind: "int", json: "integer", description, min, max, required: !!required }),
		num: (description, required) => ({ kind: "num", json: "number", description, required: !!required }),
		bool: (description) => ({ kind: "bool", json: "boolean", description }),
		text: (description, max, required) => ({ kind: "text", json: "string", description, max: max || 200, required: !!required }),
		choice: (description, values, required) => ({ kind: "choice", json: "string", description, values, required: !!required }),
	};
	const SUB = P.id("Subsidiary (legal entity) id; get it from s4vp_context", true);
	const LIMIT = P.int(`Maximum rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`, 1, MAX_LIMIT);
	const OFFSET = P.int("Rows to skip, for paging (default 0)", 0, 100000);
	const QUERY = P.text("Filter rows by employee code or name (accent-insensitive, contains)", 80);
	const CONFIRM = P.bool("Must be true to perform the action. Ask the user to confirm first; without it the tool only describes what it would do.");

	function check(spec, value, name) {
		if (blank(value)) return spec.required ? { err: `${name} is required` } : { skip: true };
		switch (spec.kind) {
			case "id":
				return /^\d{1,12}$/.test(String(value)) ? { value: String(value) } : { err: `${name} must be a numeric internal id` };
			case "date":
				return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !isNaN(Date.parse(String(value))) ? { value: String(value) } : { err: `${name} must be a date YYYY-MM-DD` };
			case "month":
				return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value)) ? { value: String(value) } : { err: `${name} must be a month YYYY-MM` };
			case "int": {
				const n = Number(value);
				if (!Number.isInteger(n) || n < spec.min || n > spec.max) return { err: `${name} must be a whole number from ${spec.min} to ${spec.max}` };
				return { value: n };
			}
			case "num": {
				const n = Number(value);
				return isFinite(n) ? { value: n } : { err: `${name} must be a number` };
			}
			case "bool":
				if (value === true || value === "true") return { value: true };
				if (value === false || value === "false") return { value: false };
				return { err: `${name} must be true or false` };
			case "choice":
				return spec.values.includes(String(value)) ? { value: String(value) } : { err: `${name} must be one of: ${spec.values.join(", ")}` };
			default: {
				const s = String(value);
				return s.length <= spec.max ? { value: s } : { err: `${name} must be at most ${spec.max} characters` };
			}
		}
	}

	function validate(tool, raw) {
		const out = {};
		const errors = [];
		for (const name of Object.keys(tool.params)) {
			const r = check(tool.params[name], raw[name], name);
			if (r.err) errors.push(r.err);
			else if (!r.skip) out[name] = r.value;
		}
		return { values: out, errors };
	}

	// ------------------------------------------------------------------ cắt gọn kết quả
	/** Lọc mảng out[key] theo q (mã, tên), cắt theo offset / limit; ghi tổng số và cờ còn nữa. */
	function page(out, key, p, textOf) {
		if (!out || !Array.isArray(out[key])) return out;
		let rows = out[key];
		if (!blank(p.q)) {
			const term = fold(p.q);
			const get = textOf || ((r) => `${r.code || r.employeeCode || ""} ${r.name || r.employeeName || ""}`);
			rows = rows.filter((r) => fold(get(r)).includes(term));
		}
		const offset = p.offset || 0;
		const limit = p.limit || DEFAULT_LIMIT;
		const slice = rows.slice(offset, offset + limit);
		const res = Object.assign({}, out);
		res[key] = slice;
		res[`${key}Paging`] = { total: rows.length, offset, returned: slice.length, more: offset + slice.length < rows.length };
		return res;
	}

	/** Lưới an toàn: kết quả vẫn quá lớn thì cắt mọi mảng dài, ghi chú đã cắt. */
	function fit(data) {
		let size;
		try {
			size = JSON.stringify(data).length;
		} catch (e) {
			return { data: null, trimmed: true };
		}
		if (size <= MAX_CHARS) return { data, trimmed: false };
		const walk = (v) => {
			if (Array.isArray(v)) return v.slice(0, TRIM_ARRAY).map(walk);
			if (v && typeof v === "object") {
				const o = {};
				for (const k of Object.keys(v)) o[k] = walk(v[k]);
				return o;
			}
			return v;
		};
		return { data: walk(data), trimmed: true };
	}

	const get = (action, input) => ({ method: "get", input: Object.assign({ action }, input) });
	const post = (action, input) => ({ method: "post", input: Object.assign({ action }, input) });

	const BATCH_STATUS = "Payroll run status codes: H on hold (draft), B queued for calculation, C calculated, P pending approval, A approved, J rejected, R posted to the general ledger, V reversed.";
	const DOC_TYPES = ["leave", "ot", "trip", "exception"];
	const DOC_FIELDS = {
		leave: ["leave_type", "from", "from_half", "to", "to_half", "reason"],
		ot: ["work_date", "hours", "is_night", "earning_type", "project", "reason"],
		trip: ["from", "to", "destination", "purpose", "project"],
		exception: ["work_date", "exception_type", "minutes", "adjust_days", "reason"],
	};
	const PAYROLL_OPS = {
		calculate: (p) => post("calculate", { id: p.id, background: true }),
		submit: (p) => post("submitRun", { id: p.id }),
		approve: (p) => post("approveStep", { batch: p.id, note: p.note || "" }),
		reject: (p) => post("rejectStep", { batch: p.id, note: p.note || "" }),
		hold: (p) => post("hold", { id: p.id }),
		removeHold: (p) => post("removeHold", { id: p.id }),
		reopen: (p) => post("reopen", { id: p.id }),
	};

	// ------------------------------------------------------------------ danh sách công cụ
	const TOOLS = {
		s4vp_context: {
			title: "S4 Payroll: context",
			description:
				"START HERE. Returns the current user and role, the subsidiaries (legal entities) that use S4 Advanced Payroll, pay groups, pay periods and leave types. Other S4 Payroll tools need the subsidiary id and period id from this result. Amounts in all S4 Payroll tools are in VND.",
			params: { subsidiary: P.id("Only return pay groups and periods of this subsidiary"), year: P.int("Only return periods starting in this year", 2000, 2100) },
			call: () => get("bootstrap", {}),
			shape(out, p) {
				const groups = (out.paygroups || []).filter((g) => blank(p.subsidiary) || blank(g.subsidiary) || String(g.subsidiary) === p.subsidiary);
				const groupIds = new Set(groups.map((g) => String(g.id)));
				let periods = (out.periods || []).filter((x) => blank(p.subsidiary) || groupIds.has(String(x.paygroup)));
				if (p.year) periods = periods.filter((x) => String(x.start || "").slice(0, 4) === String(p.year));
				const u = out.user || {};
				return {
					user: { name: u.name, role: u.role, isHr: !!u.isHr, isAccountant: !!u.isAccountant, fullAccess: !!u.fullAccess, language: u.lang },
					setupReady: !!out.setupReady,
					subsidiaries: (out.subsidiaries || []).filter((s) => s.enabled !== false).map((s) => ({ id: s.id, name: s.name })),
					paygroups: groups,
					periods: periods.slice(-60),
					leaveTypes: out.leaveTypes || [],
					unverifiedLegalParameters: (out.unverified || []).length,
					note: "Period status and attStatus (attendance lock) are codes of the package; periods are listed oldest first.",
				};
			},
		},
		s4vp_home: {
			title: "S4 Payroll: today's work",
			description: "What needs attention today for one subsidiary: the running pay period, payroll run counts by status, attendance progress, to-do items and upcoming deadlines. Use it to answer 'where are we in this month's payroll'.",
			params: { subsidiary: SUB },
			call: (p) => get("homeSummary", { subsidiary: p.subsidiary }),
		},
		s4vp_payroll_runs: {
			title: "S4 Payroll: list payroll runs",
			description: `Lists payroll runs (bảng lương) of a subsidiary, optionally of one pay period, with status, totals and the journal number once posted. ${BATCH_STATUS}`,
			params: { subsidiary: SUB, period: P.id("Pay period id"), limit: LIMIT, offset: OFFSET },
			call: (p) => get("batches", { subsidiary: p.subsidiary, period: p.period }),
			shape: (out, p) => page(out, "batches", Object.assign({}, p, { q: "" })),
		},
		s4vp_payroll_run: {
			title: "S4 Payroll: payroll run summary",
			description: `One payroll run: steps and status, totals (gross, employee and employer insurance, personal income tax, net pay), comparison with the previous period, open checks, and employee lines (gross, insurance, tax, net per employee). Lines are paged; use q to find an employee. ${BATCH_STATUS}`,
			params: { id: P.id("Payroll run id", true), q: QUERY, limit: LIMIT, offset: OFFSET },
			call: (p) => get("runView", { id: p.id }),
			shape: (out, p) => page(out, "lines", p),
		},
		s4vp_payroll_employee: {
			title: "S4 Payroll: one employee's pay detail",
			description: "Full pay detail of one employee line in a payroll run: earnings, deductions, insurance, personal income tax steps, attendance, hours, cost allocation and advance offsets. Get the line id from s4vp_payroll_run.",
			params: { id: P.id("Payroll run id", true), line: P.id("Employee line id from s4vp_payroll_run", true), prev: P.id("Previous payroll run id (prev.id in s4vp_payroll_run) to compare each amount") },
			call: (p) => get("runLine", { id: p.id, line: p.line, prev: p.prev }),
		},
		s4vp_payroll_checks: {
			title: "S4 Payroll: payroll checks",
			description: "Warnings and errors found by the payroll checks for a run (missing data, unusual variance, negative net pay...), with counts by severity and whether anything blocks approval.",
			params: {
				batch: P.id("Payroll run id", true),
				severity: P.choice("Only this severity", ["error", "warn", "info"]),
				status: P.choice("Only this handling status", ["open", "accepted", "resolved"]),
				q: P.text("Search text", 80),
				limit: LIMIT,
				offset: OFFSET,
			},
			call: (p) => get("checksList", { batch: p.batch, severity: p.severity, status: p.status, q: p.q, limit: p.limit || DEFAULT_LIMIT, offset: p.offset || 0 }),
		},
		s4vp_payroll_journal: {
			title: "S4 Payroll: journal preview",
			description: "The accounting entry of a payroll run (debit and credit lines by account, department, class, location, project). For a run not yet posted this is a preview.",
			params: { id: P.id("Payroll run id", true) },
			call: (p) => get("journal", { id: p.id }),
		},
		s4vp_attendance_month: {
			title: "S4 Payroll: attendance of a period",
			description: "Attendance sheet of a pay period: lock state, steps, counts of open attendance documents, statistics, and one row per employee with the day-by-day codes. Rows are paged; use q to find an employee. Without period the default period is used.",
			params: { subsidiary: SUB, period: P.id("Pay period id"), q: QUERY, limit: LIMIT, offset: OFFSET },
			call: (p) => get("attendanceMonth", { subsidiary: p.subsidiary, period: p.period }),
			shape: (out, p) => page(out, "rows", p),
		},
		s4vp_attendance_employee: {
			title: "S4 Payroll: one employee's attendance detail",
			description: "Clock punches, rostered shifts and NetSuite time entries of one employee in a pay period.",
			params: { period: P.id("Pay period id", true), employee: P.id("Employee id", true) },
			call: (p) => get("attendanceEmployee", { period: p.period, employee: p.employee }),
		},
		s4vp_attendance_docs: {
			title: "S4 Payroll: attendance documents",
			description: "Lists attendance documents of one type: leave requests, overtime requests, business trips or attendance exceptions. Status codes: H on hold (draft), P pending approval, A approved, R rejected, C cancelled.",
			params: {
				type: P.choice("Document type", DOC_TYPES, true),
				subsidiary: SUB,
				status: P.choice("Only this status", ["H", "P", "A", "R", "C"]),
				employee: P.id("Only this employee"),
				from: P.date("Documents overlapping from this date"),
				to: P.date("Documents overlapping up to this date"),
				limit: LIMIT,
				offset: OFFSET,
			},
			call: (p) => get("docs", { type: p.type, subsidiary: p.subsidiary, status: p.status, employee: p.employee, from: p.from, to: p.to }),
			shape: (out, p) => page(out, "docs", Object.assign({}, p, { q: "" })),
		},
		s4vp_leave_balances: {
			title: "S4 Payroll: leave balances",
			description: "Leave balances of a subsidiary for a year: entitled, carried over, adjusted, used, pending and remaining days per employee and leave type.",
			params: { subsidiary: SUB, year: P.int("Leave year", 2000, 2100, true), employee: P.id("Only this employee (id from s4vp_employees)"), limit: LIMIT, offset: OFFSET },
			call: (p) => get("leaveBalances", { subsidiary: p.subsidiary, year: p.year }),
			shape(out, p) {
				const rows = (out.balances || []).filter((b) => blank(p.employee) || String(b.employee) === p.employee);
				return page(Object.assign({}, out, { balances: rows }), "balances", Object.assign({}, p, { q: "" }));
			},
		},
		s4vp_employees: {
			title: "S4 Payroll: find employees",
			description: "Searches employees of a subsidiary (code, name) with department, job title, contract state, probation and missing-data flags. Base salary is included only for payroll roles. Tax codes, ID numbers and bank accounts are never returned.",
			params: {
				subsidiary: SUB,
				q: P.text("Search by code or name", 80),
				filter: P.choice("Subset", ["all", "working", "probation", "expiring", "missing", "left"]),
				page: P.int("Page number, from 1", 1, 10000),
				pageSize: P.int("Rows per page (max 50)", 1, 50),
			},
			call: (p) => get("employeesPage", { subsidiary: p.subsidiary, q: p.q, filter: p.filter, page: p.page || 1, pageSize: p.pageSize || 25 }),
		},
		s4vp_employee: {
			title: "S4 Payroll: employee card",
			description: "Everything the package knows about one employee: pay profile, contracts, decisions, dependents, leave, recent pay. Identity numbers are returned only as present / missing flags.",
			params: { id: P.id("Employee id", true) },
			call: (p) => get("employeeCard", { id: p.id }),
		},
		s4vp_labor_cost: {
			title: "S4 Payroll: labor cost analysis",
			description: "Labor cost of posted payroll for a month, compared with another month, broken down by a dimension, with a 12-month trend. Accounting roles only.",
			params: {
				subsidiary: SUB,
				month: P.month("Month to analyse; default is the latest posted month"),
				compare: P.text("Comparison: prev (previous month, default), yoy (same month last year) or a month YYYY-MM", 7),
				dim: P.choice("Breakdown dimension (default department)", ["department", "project", "class", "location", "account", "component", "employmentType"]),
			},
			call: (p) => get("laborAnalytics", { subsidiary: p.subsidiary, month: p.month, compare: p.compare, dim: p.dim }),
		},
		s4vp_commission: {
			title: "S4 Payroll: sales commission",
			description: "Sales commission calculation of a month for a subsidiary: the run and its status, result per salesperson, summary figures and the months already calculated.",
			params: { subsidiary: SUB, month: P.month("Month; default is the current one") },
			call: (p) => get("commissionView", { subsidiary: p.subsidiary, month: p.month }),
		},
		s4vp_roster: {
			title: "S4 Payroll: shift roster",
			description: "Effective shift roster for a date range (at most 62 days): shifts, rotation patterns, crews, shift schemes and one row per employee. Rows are paged; use q to find an employee.",
			params: { subsidiary: SUB, from: P.date("First day", true), to: P.date("Last day", true), team: P.id("Only this crew / team"), q: QUERY, limit: LIMIT, offset: OFFSET },
			call: (p) => get("rosterView", { subsidiary: p.subsidiary, from: p.from, to: p.to, team: p.team }),
			shape: (out, p) => page(out, "rows", p),
		},
		s4vp_setup_status: {
			title: "S4 Payroll: setup status",
			description: "Health of the payroll setup for a subsidiary: which setup areas are complete, what is missing or needs attention, and the first-time setup sequence.",
			params: { subsidiary: SUB },
			call: (p) => get("setupStatus", { subsidiary: p.subsidiary }),
		},
		s4vp_attendance_doc_save: {
			title: "S4 Payroll: create attendance document",
			description:
				"Creates a draft (on hold) attendance document for an employee: leave request, overtime request, business trip or attendance exception. It is not submitted; use s4vp_attendance_doc_action to submit. Fields by type - leave: leave_type (id from s4vp_context), from, to, from_half, to_half, reason; ot: work_date, hours, is_night, reason; trip: from, to, destination, purpose; exception: work_date, exception_type, minutes, adjust_days, reason. WRITE: requires confirm = true after the user agrees.",
			write: true,
			params: {
				type: P.choice("Document type", DOC_TYPES, true),
				employee: P.id("Employee id", true),
				subsidiary: SUB,
				leave_type: P.id("Leave type id (leave)"),
				from: P.date("First day (leave, trip)"),
				to: P.date("Last day (leave, trip)"),
				from_half: P.bool("Leave starts at midday (leave)"),
				to_half: P.bool("Leave ends at midday (leave)"),
				work_date: P.date("Work date (ot, exception)"),
				hours: P.num("Overtime hours (ot)"),
				is_night: P.bool("Night overtime (ot)"),
				exception_type: P.text("Exception type code (exception)", 20),
				minutes: P.int("Minutes late or early (exception)", 0, 1440),
				adjust_days: P.num("Workday adjustment (exception)"),
				destination: P.text("Destination (trip)", 200),
				purpose: P.text("Purpose (trip)", 300),
				reason: P.text("Reason", 300),
				confirm: CONFIRM,
			},
			willDo: (p) => `Create a draft ${p.type} document for employee ${p.employee}`,
			call(p) {
				const values = { employee: p.employee, subsidiary: p.subsidiary };
				for (const k of DOC_FIELDS[p.type]) if (!blank(p[k])) values[k] = p[k];
				return post("saveDoc", { type: p.type, values });
			},
		},
		s4vp_attendance_doc_action: {
			title: "S4 Payroll: act on attendance document",
			description: "Moves an attendance document through its workflow: submit (draft to pending approval), approve, reject (reason required) or cancel. The approver may not be the employee on the document; locked attendance periods refuse changes. WRITE: requires confirm = true after the user agrees.",
			write: true,
			params: {
				type: P.choice("Document type", DOC_TYPES, true),
				id: P.id("Document id", true),
				op: P.choice("Action", ["submit", "approve", "reject", "cancel"], true),
				rejectReason: P.text("Reason, required for reject", 300),
				confirm: CONFIRM,
			},
			willDo: (p) => `${p.op} ${p.type} document ${p.id}`,
			call: (p) => post("docAction", { type: p.type, id: p.id, op: p.op, rejectReason: p.rejectReason || "" }),
		},
		s4vp_payroll_action: {
			title: "S4 Payroll: act on payroll run",
			description:
				"Runs one step of a payroll run: calculate (always queued in the background; poll s4vp_payroll_run for the result), submit (calculated to pending approval), approve (current approval level), reject (note required), hold, removeHold, reopen. Segregation of duties and all status checks of the package apply. Posting to the general ledger, reversing and agency bills are NOT available here; do them on the Payroll Run screen. WRITE: requires confirm = true after the user agrees.",
			write: true,
			params: {
				id: P.id("Payroll run id", true),
				op: P.choice("Action", Object.keys(PAYROLL_OPS), true),
				note: P.text("Note (required for reject)", 300),
				confirm: CONFIRM,
			},
			willDo: (p) => `${p.op} payroll run ${p.id}`,
			call: (p) => PAYROLL_OPS[p.op](p),
		},
	};

	const names = () => Object.keys(TOOLS);

	/** Định nghĩa MCP (rpcschema) sinh từ TOOLS. */
	function schema() {
		return {
			tools: names().map((name) => {
				const t = TOOLS[name];
				const properties = {};
				const required = [];
				for (const k of Object.keys(t.params)) {
					const s = t.params[k];
					const prop = { type: s.json, description: s.description };
					if (s.kind === "choice") prop.enum = s.values.slice();
					properties[k] = prop;
					if (s.required) required.push(k);
				}
				return {
					name,
					description: t.description,
					inputSchema: { type: "object", properties, required },
					annotations: { title: t.title, readOnlyHint: !t.write, idempotentHint: !t.write, destructiveHint: false, openWorldHint: false },
				};
			}),
		};
	}

	const failure = (type, message, messageVi) => ({ ok: false, error: { type, message, messageVi: messageVi || message } });

	/** Chạy một công cụ. Không ném lỗi: mọi kết cục đều là object trả về. */
	function run(name, raw) {
		const tool = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
		if (!tool) return failure("UNKNOWN_TOOL", `Unknown tool ${name}`, `Không có công cụ ${name}`);
		try {
			if (!Dispatch.roleIn("payroll")) {
				return failure(
					"ACCESS_DENIED",
					"S4 Advanced Payroll tools need a payroll role (S4VP Payroll HR, S4VP Payroll Accountant). Connect the AI client with such a role; it also needs the MCP Server Connection permission.",
					"Công cụ S4 Tính Lương Nâng Cao cần vai trò lương (S4VP Payroll HR, S4VP Payroll Accountant). Hãy kết nối trợ lý AI bằng vai trò đó; vai trò cũng cần quyền MCP Server Connection.",
				);
			}
			const v = validate(tool, raw || {});
			if (v.errors.length) return failure("VALIDATION_ERROR", v.errors.join("; "), v.errors.join("; "));
			const p = v.values;
			if (tool.write && p.confirm !== true) {
				return { ok: true, needsConfirmation: true, willDo: tool.willDo(p), note: "Nothing was changed. Show this to the user, and call again with confirm = true only after they agree." };
			}
			const c = tool.call(p);
			const input = {};
			for (const k of Object.keys(c.input)) {
				if (blank(c.input[k])) continue;
				// GET của RESTlet nhận tham số dạng chuỗi (query string): giữ đúng kiểu đó
				input[k] = c.method === "get" ? String(c.input[k]) : c.input[k];
			}
			const out = Dispatch[c.method](input);
			if (out && (out.s4vpError || out.error)) {
				return failure("BUSINESS_ERROR", String(out.s4vpError || out.error), String(out.s4vpErrorVi || out.errorVi || out.s4vpError || out.error));
			}
			const f = fit(tool.shape ? tool.shape(out || {}, p) : out);
			const res = { ok: true, data: f.data };
			if (f.trimmed) res.note = `The result was too large: every list was cut to ${TRIM_ARRAY} items. Narrow the request (q, limit, period).`;
			return res;
		} catch (e) {
			return failure("UNEXPECTED_ERROR", "Unexpected error while running the tool", "Lỗi không mong đợi khi chạy công cụ");
		}
	}

	return { TOOLS, names, schema, run };
});
