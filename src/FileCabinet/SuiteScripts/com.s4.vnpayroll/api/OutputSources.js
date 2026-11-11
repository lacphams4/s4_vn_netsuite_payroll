/**
 * Sản lượng từ giao dịch (docs/COMMISSION.md mục 9): sinh phiếu sản lượng Tạm giữ từ giao dịch sản xuất của NetSuite theo cấu
 * hình record out_source (loại giao dịch, trường nhân viên / tổ trên giao dịch, bảng đơn giá, dấu số lượng, phòng ban theo dòng).
 *
 *   GET  outputSources        {subsidiary?}             danh sách nguồn (ô chọn của hộp thoại)
 *   POST outputSourcePreview  {source, from, to, cursor?} dòng đề xuất, đánh dấu dòng đã sinh (cũng khai ở GET)
 *   POST outputSourceGenerate {source, from, to, cursor?} tạo phiếu Tạm giữ, trả more: true khi còn việc cho lượt sau
 *
 * Dòng nguồn theo loại giao dịch (đã thử cột trên td2937310, account chưa có Build / WOCompl):
 *   Build (Assembly Build), WOCompl (Work Order Completion): dòng chính (tl.mainline = 'T') - thành phẩm và số lượng hoàn thành.
 *   ItemShip (Item Fulfillment): dòng hàng (tl.iscogs = 'F', bỏ dòng thành phần kit); dòng hàng đầu tiên của phiếu xuất là
 *   dòng mainline = 'T' nên không lọc theo mainline. Số lượng xuất mang dấu âm: dấu mặc định -1.
 * Mã hạng mục = item.itemid viết hoa, định giá qua bảng đơn giá như phiếu nhập tay (OutputRules.priceLine, cảnh báo
 * RATE_MISSING khi thiếu đơn giá). Một phiếu cho mỗi giao dịch x nhân viên (hoặc x tổ khi dòng có tổ -> phiếu tổ, thành viên
 * nạp bằng Output.loadTeamMembers) x phòng ban dòng (khi department_from_line). Ngày phiếu = ngày chứng từ.
 *
 * Không sinh trùng: mỗi dòng nguồn có khóa "type:id:line"; phiếu sinh ra lưu các khóa trong output.src_tran (cách nhau bởi ";",
 * tối đa 300 ký tự - nhiều hơn thì tách thành nhiều phiếu) và output.src. Dòng có khóa nằm trên phiếu đang hoạt động (chưa
 * hủy) thì bỏ qua; phiếu bị hủy (isinactive) thì dòng được sinh lại. Phiếu đã sinh tra theo công ty con, loại giao dịch và
 * ngày phiếu trong khoảng: phiếu tạm giữ bị sửa ngày ra ngoài khoảng sẽ không được nhận ra.
 *
 * Phiếu được tạo qua Output.save (cùng kiểm tra, cùng cách tính tổng như phiếu nhập tay) rồi ghi src / src_tran; vẫn phải gửi
 * duyệt và duyệt như phiếu nhập tay.
 *
 * Mỗi lượt đọc giao dịch là MỘT câu SuiteQL cố định (cột trường nhân viên / tổ chỉ nhận id dạng ^cust(body|col)[a-z0-9_]+$),
 * tối đa WINDOW dòng theo t.id tăng dần; cửa sổ đầy thì bỏ giao dịch cuối (có thể thiếu dòng) và đọc tiếp từ con trỏ.
 * Governance: tối đa ENTRY_CAP phiếu mỗi lượt gọi và dừng khi điểm còn lại dưới USAGE_FLOOR; trả more: true, cursor để gọi
 * lại (lib/api.js post() gửi lại cùng nội dung; dòng đã sinh tự bỏ qua nên vẫn tiến).
 *
 * Quyền: vai trò chạy cần quyền xem loại giao dịch tương ứng (Build Assemblies, Mark Work Orders Built, Item Fulfillment).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Lean", "./Output", "../core/OutputRules", "../core/Dates"], (runtime, Store, Lean, Output, Rules, Dates) => {
	const WINDOW = 1000;
	const ENTRY_CAP = 25;
	const USAGE_FLOOR = 1000;
	const MAX_WINDOWS = 20;
	const MAX_DAYS = 366;
	const KEY_MAX = 300;
	const FIELD_RE = /^cust(body|col)[a-z0-9_]+$/;
	// Điều kiện dòng nguồn và dấu số lượng mặc định theo loại giao dịch (mã = transaction.type)
	const TYPES = {
		Build: { lines: "tl.mainline = 'T' AND tl.item IS NOT NULL", sign: 1 },
		WOCompl: { lines: "tl.mainline = 'T' AND tl.item IS NOT NULL", sign: 1 },
		ItemShip: { lines: "tl.iscogs = 'F' AND tl.taxline = 'F' AND NVL(tl.kitcomponent, 'F') = 'F' AND tl.item IS NOT NULL", sign: -1 },
	};

	const blank = (v) => v === null || v === undefined || v === "";
	const isId = (v) => /^\d+$/.test(String(blank(v) ? "" : v));
	const upper = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const person = (code, first, last) => [last, first].filter(Boolean).join(" ").trim() || code || "";

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function messageOf(e) {
		const u = e && e.userMessage;
		if (u) return { en: u.en, vi: u.vi };
		const m = String((e && e.message) || e);
		return { en: m, vi: String((e && e.messageVi) || m) };
	}

	function lowUsage() {
		try {
			return Number(runtime.getCurrentScript().getRemainingUsage()) < USAGE_FLOOR;
		} catch (e) {
			return false;
		}
	}

	// ------------------------------------------------------------------ cấu hình

	/** Id trường body / dòng -> cột SuiteQL (t. hoặc tl.); id sai dạng thì báo lỗi, không ghép vào câu lệnh. */
	function fieldColumn(raw, en, vi) {
		if (blank(raw) || !String(raw).trim()) return null;
		const id = String(raw).trim().toLowerCase();
		if (!FIELD_RE.test(id)) throw fail(`${en} "${String(raw).slice(0, 60)}" is not a custbody / custcol field ID`, `${vi} "${String(raw).slice(0, 60)}" không phải id trường custbody / custcol`);
		return id.indexOf("custbody") === 0 ? `t.${id}` : `tl.${id}`;
	}

	function sourceOf(id) {
		if (!isId(id)) throw fail("Select an output source", "Chưa chọn nguồn sản lượng");
		const s = Store.get("out_source", id);
		if (!s || s.isInactive) throw fail("Output source not found or inactive", "Không tìm thấy nguồn sản lượng hoặc nguồn đã ngưng dùng");
		const type = TYPES[s.tran_type];
		if (!type) throw fail("The output source has no supported transaction type", "Nguồn sản lượng chưa chọn loại giao dịch hợp lệ");
		if (!isId(s.subsidiary)) throw fail("The output source has no subsidiary", "Nguồn sản lượng chưa chọn công ty con");
		if (!isId(s.rate_table)) throw fail("The output source has no rate table", "Nguồn sản lượng chưa chọn bảng đơn giá");
		const empCol = fieldColumn(s.employee_field, "Employee field", "Trường nhân viên");
		const teamCol = fieldColumn(s.team_field, "Team field", "Trường tổ");
		if (!empCol && !teamCol) throw fail("The output source needs an employee field or a team field", "Nguồn sản lượng cần trường nhân viên hoặc trường tổ");
		const sign = Number(s.qty_sign) === -1 ? -1 : Number(s.qty_sign) === 1 ? 1 : type.sign;
		return {
			id: String(s.id), name: s.name || "", subsidiary: String(s.subsidiary), tranType: s.tran_type, lineFilter: type.lines, rateTable: String(s.rate_table),
			empCol, teamCol, sign, departmentFromLine: s.department_from_line !== false,
		};
	}

	function rangeOf(p) {
		const from = String((p && p.from) || "");
		const to = String((p && p.to) || "");
		const ok = (v) => {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
			try {
				return Dates.iso(v) === v && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
			} catch (e) {
				return false;
			}
		};
		if (!ok(from) || !ok(to)) throw fail("Enter a valid date range", "Nhập khoảng ngày hợp lệ");
		if (from > to) throw fail("The start date is after the end date", "Từ ngày sau đến ngày");
		if (Dates.toDay(to) - Dates.toDay(from) + 1 > MAX_DAYS) throw fail(`The date range cannot exceed ${MAX_DAYS} days`, `Khoảng ngày không quá ${MAX_DAYS} ngày`);
		return { from, to };
	}

	const cursorOf = (v) => (isId(v) ? Number(v) : 0);

	// ------------------------------------------------------------------ đọc giao dịch

	/** Câu SuiteQL cố định của một nguồn: tham số subsidiary, from, to, cursor (t.id >). */
	function sqlOf(src) {
		const emp = src.empCol || "NULL";
		const team = src.teamCol || "NULL";
		const cols = [
			"t.id AS t_id", "t.tranid AS t_no", "TO_CHAR(t.trandate, 'YYYY-MM-DD') AS t_date", "tl.id AS l_id", "tl.item AS l_item", "i.itemid AS i_code", "tl.quantity AS l_qty",
			"tl.department AS l_dept", "BUILTIN.DF(tl.department) AS d_name", `${emp} AS w_emp`, `${team} AS w_team`,
		]
			.concat(src.empCol ? ["e.entityid AS e_code", "e.firstname AS e_first", "e.lastname AS e_last"] : ["NULL AS e_code", "NULL AS e_first", "NULL AS e_last"])
			.concat(src.teamCol ? ["tm.name AS tm_name"] : ["NULL AS tm_name"]);
		const join =
			"FROM transaction t INNER JOIN transactionline tl ON tl.transaction = t.id LEFT JOIN item i ON i.id = tl.item" +
			(src.empCol ? ` LEFT JOIN employee e ON e.id = ${emp}` : "") +
			(src.teamCol ? ` LEFT JOIN ${Lean.rec("team").type} tm ON tm.id = ${team}` : "");
		const where =
			`WHERE t.type = '${src.tranType}' AND ${src.lineFilter} AND t.voided = 'F' AND tl.subsidiary = ? ` +
			"AND t.trandate BETWEEN TO_DATE(?, 'YYYY-MM-DD') AND TO_DATE(?, 'YYYY-MM-DD') AND t.id > ?";
		// ROWNUM lấy đúng các dòng đầu theo thứ tự trong, nhưng thứ tự trả về chỉ giữ khi câu ngoài cũng ORDER BY (thử trên td2937310)
		return `SELECT * FROM (SELECT ${cols.join(", ")} ${join} ${where} ORDER BY t.id, tl.id) WHERE ROWNUM <= ${WINDOW + 1} ORDER BY t_id, l_id`;
	}

	/**
	 * Một cửa sổ dòng nguồn sau con trỏ. Cửa sổ đầy: bỏ mọi dòng của giao dịch cuối (có thể chưa đủ dòng), lượt sau đọc từ
	 * giao dịch đó. Một giao dịch có hơn WINDOW dòng thì báo lỗi (không sinh thiếu dòng).
	 * @returns {{rows: Array, truncated: boolean, last: number}}
	 */
	function readWindow(src, range, cursor) {
		const raw = Store.run(sqlOf(src), [Number(src.subsidiary), range.from, range.to, cursor], "s4vp_osr_lines")
			.slice()
			.sort((a, b) => Number(a.t_id) - Number(b.t_id) || Number(a.l_id) - Number(b.l_id));
		if (raw.length <= WINDOW) return { rows: raw, truncated: false, last: raw.length ? Number(raw[raw.length - 1].t_id) : cursor };
		const cut = String(raw[raw.length - 1].t_id);
		const rows = raw.filter((r) => String(r.t_id) !== cut);
		if (!rows.length) throw fail(`Transaction ${raw[0].t_no || cut} has more than ${WINDOW} lines`, `Giao dịch ${raw[0].t_no || cut} có hơn ${WINDOW} dòng`);
		return { rows, truncated: true, last: Number(rows[rows.length - 1].t_id) };
	}

	/** Dòng SuiteQL -> dòng nguồn: khóa, giao dịch, người làm (tổ ưu tiên hơn nhân viên), hạng mục, số lượng đã đổi dấu. */
	function lineOf(src, r) {
		const team = blank(r.w_team) ? null : String(r.w_team);
		const employee = blank(r.w_emp) ? null : String(r.w_emp);
		const kind = team ? "T" : employee ? "I" : null;
		const qty = (Number(r.l_qty) || 0) * src.sign;
		const item = upper(r.i_code);
		const dept = src.departmentFromLine && !blank(r.l_dept) ? String(r.l_dept) : null;
		let skip = null;
		if (!kind) skip = "NO_WORKER";
		else if (!item) skip = "NO_ITEM";
		else if (!(qty > 0)) skip = "BAD_QTY";
		return {
			key: `${src.tranType}:${r.t_id}:${r.l_id}`, tran: String(r.t_id), tranNo: r.t_no || String(r.t_id), tranType: src.tranType, date: r.t_date || null, line: String(r.l_id),
			kind, employee: kind === "I" ? employee : null, employeeName: kind === "I" ? person(r.e_code, r.e_first, r.e_last) : "", employeeCode: kind === "I" ? r.e_code || "" : "",
			team: kind === "T" ? team : null, teamName: kind === "T" ? r.tm_name || "" : "",
			item, qty, department: dept, departmentName: dept ? r.d_name || "" : "", skip,
		};
	}

	/** Khóa dòng nguồn đã có trên phiếu đang hoạt động (cùng công ty con, loại giao dịch, ngày phiếu trong khoảng). */
	function doneKeys(src, range) {
		const where =
			`{subsidiary} = ${src.subsidiary} AND {src_tran} LIKE '${src.tranType}:%' AND ` +
			`{doc_date} BETWEEN TO_DATE('${range.from}', 'YYYY-MM-DD') AND TO_DATE('${range.to}', 'YYYY-MM-DD')`;
		const out = new Map();
		for (const e of Lean.select("output", ["name", "src_tran"], { where, tag: "s4vp_osr_done" })) {
			for (const key of String(e.src_tran || "").split(/[;,\s]+/)) if (key) out.set(key, { id: String(e.id), name: e.name || "" });
		}
		return out;
	}

	/** Gom dòng thành phiếu: giao dịch x người làm x phòng ban; khóa nối không quá KEY_MAX ký tự (vượt thì tách phiếu). */
	function groupsOf(lines) {
		const groups = [];
		const open = {};
		for (const l of lines) {
			const g = `${l.tran}|${l.kind}${l.kind === "T" ? l.team : l.employee}|${l.department || ""}`;
			let cur = open[g];
			if (!cur || cur.size + l.key.length + 1 > KEY_MAX) {
				cur = open[g] = { lines: [], keys: [], size: -1 };
				groups.push(cur);
			}
			cur.lines.push(l);
			cur.keys.push(l.key);
			cur.size += l.key.length + 1;
		}
		return groups;
	}

	const whoOf = (l) => (l.kind === "T" ? l.teamName || l.team : [l.employeeCode, l.employeeName].filter((x, i, a) => x && a.indexOf(x) === i).join(" ") || l.employee) || "";

	// ------------------------------------------------------------------ preview

	/**
	 * Dòng đề xuất cho khoảng ngày. rows[].status: G đã sinh (entry, entryName), S bỏ qua (skip: NO_WORKER, NO_ITEM, BAD_QTY),
	 * N sẽ sinh; rate / amount định giá như phiếu nhập tay (dự án của tổ nếu có), warning RATE_MISSING khi thiếu đơn giá.
	 * Cửa sổ đầy thì truncated = true, cursor = giao dịch cuối đã đọc (không dùng khóa more để post() không tự gọi lại).
	 */
	function preview(params) {
		const p = params || {};
		const src = sourceOf(p.source);
		const range = rangeOf(p);
		const w = readWindow(src, range, cursorOf(p.cursor));
		const done = doneKeys(src, range);
		const table = Output.rateTable(src.rateTable);
		const lines = w.rows.map((r) => lineOf(src, r));
		const teamIds = [...new Set(lines.filter((l) => l.kind === "T").map((l) => l.team))];
		const projectOf = {};
		if (teamIds.length) for (const t of Store.findIn("team", "id", teamIds)) projectOf[String(t.id)] = t.project || "";
		const counts = { lines: lines.length, generated: 0, skipped: 0, ready: 0, entries: 0, amount: 0, rateMissing: 0 };
		const rows = lines.map((l) => {
			const hit = done.get(l.key);
			const row = Object.assign({}, l, { who: whoOf(l), status: hit ? "G" : l.skip ? "S" : "N", entry: hit ? hit.id : null, entryName: hit ? hit.name : "", rate: null, amount: null, warning: null });
			if (!l.skip) {
				try {
					const priced = Rules.priceLine({ item: l.item, qty: l.qty, rate: "" }, table, l.date, l.kind === "T" ? projectOf[l.team] || "" : "");
					row.rate = priced.rate;
					row.amount = priced.amount;
					row.warning = priced.warning ? priced.warning.code : null;
				} catch (e) {
					row.status = hit ? "G" : "S";
					row.skip = "BAD_QTY";
				}
			}
			if (row.status === "G") counts.generated += 1;
			else if (row.status === "S") counts.skipped += 1;
			else {
				counts.ready += 1;
				counts.amount += row.amount || 0;
				if (row.warning) counts.rateMissing += 1;
			}
			return row;
		});
		counts.entries = groupsOf(rows.filter((r) => r.status === "N")).length;
		return {
			source: { id: src.id, name: src.name, tranType: src.tranType, rateTable: src.rateTable, rateTableCode: table.code },
			from: range.from, to: range.to, rows, counts, truncated: w.truncated, cursor: w.truncated ? String(w.last) : null,
		};
	}

	// ------------------------------------------------------------------ generate

	/**
	 * Tạo phiếu Tạm giữ cho các dòng chưa sinh. Trả {created, entries: [{id, tranNo, date, kind, who, department, lines,
	 * members}], warnings: [{code, message, messageVi}], failed: [{tranNo, who, entry, message, messageVi}], more, cursor}.
	 * more = true khi dừng vì giới hạn phiếu / governance (gọi lại cùng tham số; cursor là chuỗi để post() không cộng dồn).
	 */
	function generate(params) {
		const p = params || {};
		const src = sourceOf(p.source);
		const range = rangeOf(p);
		Output.rateTable(src.rateTable);
		const done = doneKeys(src, range);
		const out = { created: 0, entries: [], warnings: [], failed: [] };
		const seen = {};
		let cursor = cursorOf(p.cursor);
		let more = false;
		let windows = 0;
		for (;;) {
			const w = readWindow(src, range, cursor);
			windows += 1;
			const todo = w.rows.map((r) => lineOf(src, r)).filter((l) => !l.skip && !done.has(l.key));
			for (const g of groupsOf(todo)) {
				if (out.created >= ENTRY_CAP || lowUsage()) {
					more = true;
					break;
				}
				createEntry(src, g, done, out, seen);
			}
			if (more || !w.truncated) break;
			if (windows >= MAX_WINDOWS || lowUsage()) {
				more = true;
				cursor = w.last;
				break;
			}
			cursor = w.last;
		}
		out.more = more;
		out.cursor = more ? String(cursor) : null;
		return out;
	}

	function createEntry(src, g, done, out, seen) {
		const first = g.lines[0];
		const who = whoOf(first);
		const values = {
			subsidiary: src.subsidiary, doc_date: first.date, rate_table: src.rateTable, type: first.kind, team: first.kind === "T" ? first.team : null,
			department: first.department || null, description: `${src.tranType} ${first.tranNo}`.slice(0, 300),
			// Khóa nguồn ghi ngay lúc tạo (Output.save nhận src / src_tran khi tạo mới): lỗi giữa chừng không sinh trùng
			src: src.id, src_tran: g.keys.join(";"),
		};
		const lines = g.lines.map((l) => ({ employee: l.kind === "I" ? l.employee : null, item: l.item, description: String(l.tranNo).slice(0, 300), uom: "", qty: l.qty, rate: "" }));
		let id = null;
		try {
			const r = Output.save(values, lines, null);
			id = String(r.id);
			for (const key of g.keys) done.set(key, { id, name: "" });
			let members = 0;
			if (first.kind === "T") members = ((Output.loadTeamMembers(id) || {}).added || []).length;
			out.created += 1;
			out.entries.push({ id, tranNo: first.tranNo, date: first.date, kind: first.kind, who, department: first.department, lines: lines.length, members });
			for (const w of (r && r.warnings) || []) {
				const k = `${w.code}|${w.message}`;
				if (seen[k]) continue;
				seen[k] = true;
				out.warnings.push({ code: w.code, message: w.message, messageVi: w.messageVi });
			}
		} catch (e) {
			// Phiếu đã tạo nhưng bước sau lỗi: hủy phiếu (isinactive, không xóa) để lượt sau sinh lại mà không trùng
			const m = messageOf(e);
			let voided = false;
			if (id) {
				try {
					Output.voidEntry(id, `Generation failed / Sinh tự động lỗi: ${m.en}`.slice(0, 1000));
					voided = true;
				} catch (x) {
					voided = false;
				}
			}
			out.failed.push({ tranNo: first.tranNo, who, entry: id, voided, message: m.en, messageVi: m.vi });
		}
	}

	// ------------------------------------------------------------------ danh sách nguồn

	/** Nguồn sản lượng đang dùng (lọc công ty con nếu có) kèm mã bảng đơn giá; recordType để mở form tạo nguồn mới. */
	function sources(params) {
		const sub = String((params && params.subsidiary) || "");
		const tables = {};
		for (const t of Store.find("rate_table", { includeInactive: true })) tables[t.id] = t.name || "";
		const rows = Store.find("out_source")
			.filter((s) => !isId(sub) || String(s.subsidiary) === sub)
			.map((s) => ({
				id: String(s.id), name: s.name || "", subsidiary: s.subsidiary || null, tranType: s.tran_type || "", rateTable: s.rate_table || null, rateTableCode: tables[s.rate_table] || "",
				employeeField: s.employee_field || "", teamField: s.team_field || "", qtySign: s.qty_sign === null || s.qty_sign === undefined ? null : Number(s.qty_sign), departmentFromLine: s.department_from_line !== false,
			}))
			.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		return { sources: rows, recordType: Lean.rec("out_source").type };
	}

	const routes = {
		get: {
			outputSources: { roles: "payroll", run: sources },
			outputSourcePreview: { roles: "hr", run: preview },
		},
		post: {
			outputSourcePreview: { roles: "hr", run: preview },
			outputSourceGenerate: { roles: "hr", run: generate },
		},
	};

	return { routes, sources, preview, generate, sqlOf, fieldColumn, TYPES, WINDOW, ENTRY_CAP };
});
