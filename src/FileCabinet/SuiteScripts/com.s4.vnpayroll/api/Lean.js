/**
 * Đọc gọn cho màn hình có 500 - 1.000 nhân viên: SuiteQL chỉ SELECT đúng các cột cần (Store.find luôn lấy mọi cột của
 * record, hồ sơ lương 40 cột x 1.000 dòng mất 0,2 - 1,0 giây), tên cột lấy từ Schema, kiểu dữ liệu đổi như Store.find
 * (ngày 'YYYY-MM-DD', checkbox thành boolean, select custom list thành mã gốc, số thành Number).
 *
 * Quy ước: id số nguyên ghép thẳng vào câu lệnh bằng idList() (IN với 900 tham số ràng buộc rất chậm); mọi câu lệnh chạy qua
 * Store.run nên lượt GET vẫn gộp được truy vấn trùng (Store.memoize) và có số đo `&timing=1` theo tag.
 *
 * Hai bộ đọc dùng chung giữa Chạy lương (api/PayrollRun) và Kiểm tra (api/Checks) - cùng câu lệnh nên một lượt runView chỉ
 * đọc cơ sở dữ liệu một lần:
 *   batchLines(ids)        dòng nhân viên của một hoặc hai bảng lương kèm mã, họ tên, phòng ban (JOIN, không BUILTIN.DF)
 *   batchesNear(batchId)   bảng lương cùng công ty con với một bảng lương (gồm cả chính nó) kèm kỳ của từng bảng: vừa là
 *                          thông tin bảng lương + kỳ, vừa để tìm bảng lương kỳ trước
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Schema"], (Store, Schema) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const STANDARD = { id: true, name: true, isinactive: true };
	// Cột của dòng nhân viên dùng cho lưới Chạy lương, số tổng, so kỳ trước và các quy tắc kiểm tra (không có JSON chi tiết)
	const LINE_KEYS = ["batch", "employee", "profile", "employment_type", "std_days", "work_days", "insurance_wage", "gross", "exempt", "ee_ins", "er_ins", "pit", "other_ded", "advance", "net", "warnings", "error"];

	function rec(name) {
		const def = Schema.records[name];
		if (!def) throw new Error(`Unknown record ${name}`);
		return def;
	}

	function field(name, key) {
		const f = rec(name).fields[key];
		if (!f) throw new Error(`Unknown field ${name}.${key}`);
		return f;
	}

	/** Cột của một trường logic: `t.custrecord_...`; id, name, isinactive là cột chuẩn. */
	function col(name, key, alias) {
		const a = alias || "t";
		return STANDARD[key] ? `${a}.${key}` : `${a}.${field(name, key).id}`;
	}

	/** Danh sách cột SELECT của các trường logic, alias `<prefix><key>` (mặc định c_, như Store.find). */
	function cols(name, keys, alias, prefix) {
		const p = prefix === undefined ? "c_" : prefix;
		return keys.map((key) => {
			const c = col(name, key, alias);
			return !STANDARD[key] && field(name, key).type === "date" ? `TO_CHAR(${c}, 'YYYY-MM-DD') AS ${p}${key}` : `${c} AS ${p}${key}`;
		});
	}

	/** Giá trị thô của SuiteQL -> giá trị logic (như Store.convertRow). */
	function value(name, key, v) {
		if (v === undefined) v = null;
		if (key === "isinactive") return v === "T" || v === true;
		if (key === "id") return v === null ? null : String(v);
		if (key === "name") return v;
		const f = field(name, key);
		if (f.type === "check") return v === "T" || v === true;
		if (f.type === "select" && f.target && f.target.indexOf("list:") === 0) return Store.codeOf(f.target.slice(5), v);
		if (f.type === "select") return v === null ? null : String(v);
		if (["float", "currency", "int", "percent"].indexOf(f.type) >= 0 && v !== null && v !== "") return Number(v);
		return v;
	}

	/** Một dòng kết quả -> object theo tên logic; `into` để ghép thêm vào object có sẵn (record thứ hai của một JOIN). */
	function row(name, keys, r, prefix, into) {
		const p = prefix === undefined ? "c_" : prefix;
		const o = into || {};
		for (const key of keys) o[key === "isinactive" ? "isInactive" : key] = value(name, key, r[`${p}${key}`]);
		return o;
	}

	/** Thay {field} bằng cột của record (như Store.find). */
	function where(name, text, alias) {
		return String(text).replace(/\{(\w+)\}/g, (m, key) => col(name, key, alias));
	}

	/** Danh sách id số nguyên để ghép thẳng vào IN (...); rỗng thì trả "0" (không khớp dòng nào). */
	function idList(ids) {
		const seen = {};
		const out = [];
		for (const x of ids || []) {
			const s = String(blank(x) ? "" : x);
			if (!/^\d+$/.test(s) || seen[s]) continue;
			seen[s] = true;
			out.push(s);
		}
		return out.join(",") || "0";
	}

	/**
	 * Đọc record với đúng các cột cần.
	 * @param {string} name tên logic (Schema.records)
	 * @param {string[]} keys trường logic cần đọc (id luôn có; thêm "name", "isinactive" nếu cần)
	 * @param {{where?: string, params?: Array, order?: string, includeInactive?: boolean, tag?: string, join?: string, extra?: string[], raw?: string[]}} [opt]
	 *   where / order dùng {field}; join là SQL thô nối sau `FROM <type> t`; extra là biểu thức SELECT thô (có alias),
	 *   raw là các alias thô (chữ thường) chép nguyên sang kết quả.
	 */
	function select(name, keys, opt) {
		const o = opt || {};
		const def = rec(name);
		let cond = o.where ? where(name, o.where) : "1 = 1";
		if (!o.includeInactive) cond = `(${cond}) AND t.isinactive = 'F'`;
		const list = ["t.id AS id"].concat(cols(name, keys)).concat(o.extra || []);
		const sql = `SELECT ${list.join(", ")} FROM ${def.type} t${o.join ? ` ${o.join}` : ""} WHERE ${cond} ORDER BY ${o.order ? where(name, o.order) : "t.id"}`;
		return Store.run(sql, o.params || [], o.tag || `s4vp_lean_${name}`).map((r) => {
			const out = row(name, keys, r, "c_", { id: String(r.id) });
			for (const a of o.raw || []) out[a] = r[a] === undefined ? null : r[a];
			return out;
		});
	}

	const personName = (r) => [r.e_last, r.e_first].filter(Boolean).join(" ").trim() || r.e_code || "";

	/**
	 * Dòng nhân viên của một hoặc hai bảng lương (kỳ này, kỳ trước) trong MỘT truy vấn, kèm mã, họ tên, phòng ban của nhân viên.
	 * Vai trò không đọc được bảng department thì lấy tên phòng ban bằng BUILTIN.DF.
	 * @returns {Array<object>} LINE_KEYS + id, code, name, department
	 */
	function batchLines(batchIds) {
		const ids = idList(batchIds);
		if (ids === "0") return [];
		const def = rec("batch_emp");
		const base = ["t.id AS id"].concat(cols("batch_emp", LINE_KEYS)).concat(["e.entityid AS e_code", "e.firstname AS e_first", "e.lastname AS e_last"]).join(", ");
		const from = `FROM ${def.type} t LEFT JOIN employee e ON e.id = ${col("batch_emp", "employee")}`;
		const tail = `WHERE ${col("batch_emp", "batch")} IN (${ids}) AND t.isinactive = 'F' ORDER BY t.id`;
		let rows;
		try {
			rows = Store.run(`SELECT ${base}, d.fullname AS e_dept ${from} LEFT JOIN department d ON d.id = e.department ${tail}`, [], "s4vp_lean_lines");
		} catch (e) {
			rows = Store.run(`SELECT ${base}, BUILTIN.DF(e.department) AS e_dept ${from} ${tail}`, [], "s4vp_lean_lines_df");
		}
		return rows.map((r) => {
			const o = row("batch_emp", LINE_KEYS, r, "c_", { id: String(r.id) });
			o.code = r.e_code || "";
			o.name = personName(r);
			o.department = r.e_dept || "";
			return o;
		});
	}

	/**
	 * Bảng lương (chưa vô hiệu) cùng công ty con với bảng lương `batchId`, gồm cả chính nó, kèm kỳ của từng bảng: một truy vấn
	 * nhỏ thay cho đọc mọi cột của mọi bảng lương (có hai trường clob) và mọi kỳ. Bảng lương không có công ty con hoặc đã vô
	 * hiệu thì trả danh sách rỗng.
	 * @returns {Array<{id, name, status, calculated, subsidiary, paygroup, period, periodName, periodStart, periodEnd, periodAtt}>}
	 */
	function batchesNear(batchId) {
		if (blank(batchId)) return [];
		const keys = ["name", "status", "calculated", "subsidiary", "paygroup", "period"];
		const pKeys = ["name", "start", "end", "att_status"];
		const type = rec("batch").type;
		const sub = col("batch", "subsidiary");
		const sql =
			`SELECT ${["t.id AS id"].concat(cols("batch", keys)).concat(cols("period", pKeys, "p", "p_")).join(", ")} FROM ${type} t ` +
			`LEFT JOIN ${rec("period").type} p ON p.id = ${col("batch", "period")} ` +
			`WHERE ${sub} = (SELECT ${col("batch", "subsidiary", "s")} FROM ${type} s WHERE s.id = ?) AND t.isinactive = 'F' ORDER BY t.id`;
		return Store.run(sql, [batchId], "s4vp_lean_batches").map((r) => {
			const o = row("batch", keys, r, "c_", { id: String(r.id) });
			const p = row("period", pKeys, r, "p_");
			o.periodName = p.name || "";
			o.periodStart = p.start || null;
			o.periodEnd = p.end || null;
			o.periodAtt = p.att_status || null;
			return o;
		});
	}

	return { LINE_KEYS, rec, col, cols, value, row, where, idList, select, batchLines, batchesNear };
});
