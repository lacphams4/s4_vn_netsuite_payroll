/**
 * Đọc ghi custom record của gói theo bảng tra Schema (tên logic -> script id), trả object thuần cho lõi.
 *
 * - Đọc bằng SuiteQL phân trang (runSuiteQLPaged), ngày luôn TO_CHAR 'YYYY-MM-DD', checkbox thành boolean,
 *   select custom list thành mã gốc (H, B, C...) theo scriptid giá trị, không dựa vào internal id.
 * - Ghi bằng N/record; mã list đổi ngược sang internal id; ngày ISO đổi sang Date giữa trưa để không lệch múi giờ.
 * - Danh sách IN (...) chia lô 900.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/query", "N/record", "N/format", "N/cache", "./Schema", "./Access"], (query, record, format, cache, Schema, Access) => {
	const listCache = {};
	// Bảng {mã <-> internal id} của custom list là dữ liệu cố định theo bản deploy: nhớ chung trong N/cache (một lần đọc cho
	// mọi list) thay vì mỗi list một truy vấn ở mỗi lượt gọi. Mã lạ / id lạ thì đọc lại list đó từ cơ sở dữ liệu.
	const LIST_TTL = 3600;
	let shared = null;
	let sharedDirty = false;

	function sharedLists() {
		if (shared) return shared;
		shared = {};
		try {
			const raw = cache.getCache({ name: "s4vp_lists", scope: cache.Scope.PROTECTED }).get({ key: "all" });
			if (raw) shared = JSON.parse(raw) || {};
		} catch (e) {
			shared = {};
		}
		return shared;
	}

	function saveSharedLists() {
		if (!sharedDirty) return;
		sharedDirty = false;
		try {
			cache.getCache({ name: "s4vp_lists", scope: cache.Scope.PROTECTED }).put({ key: "all", value: JSON.stringify(shared), ttl: LIST_TTL });
		} catch (e) {
			// không ghi được cache: lượt sau đọc lại từ cơ sở dữ liệu
		}
	}

	function loadList(listName) {
		const def = Schema.lists[listName];
		if (!def) throw new Error(`Unknown list ${listName}`);
		const byScript = {};
		for (const [code, sid] of Object.entries(def.values)) byScript[sid.toLowerCase()] = code;
		const rows = run(`SELECT id, scriptid FROM ${def.type}`, [], "s4vp_list_" + listName);
		const toId = {};
		const toCode = {};
		for (const r of rows) {
			const code = byScript[String(r.scriptid || "").toLowerCase()];
			if (code === undefined) continue;
			toId[code] = String(r.id);
			toCode[String(r.id)] = code;
		}
		listCache[listName] = { toId, toCode, fromDb: true };
		sharedLists()[listName] = { toId, toCode };
		sharedDirty = true;
		saveSharedLists();
		return listCache[listName];
	}

	/** {mã -> internal id} và {internal id -> mã} của một custom list. */
	function listMap(listName) {
		if (listCache[listName]) return listCache[listName];
		const hit = sharedLists()[listName];
		if (hit && hit.toId && hit.toCode) {
			listCache[listName] = { toId: hit.toId, toCode: hit.toCode, fromDb: false };
			return listCache[listName];
		}
		return loadList(listName);
	}

	/** Bản nhớ không có mã / id này (list vừa thêm giá trị): đọc lại từ cơ sở dữ liệu một lần. */
	function fresh(listName) {
		const m = listMap(listName);
		return m.fromDb ? m : loadList(listName);
	}

	function codeOf(listName, id) {
		if (id === null || id === undefined || id === "") return null;
		const code = listMap(listName).toCode[String(id)];
		if (code !== undefined) return code;
		return fresh(listName).toCode[String(id)] || null;
	}

	function idOf(listName, code) {
		if (code === null || code === undefined || code === "") return null;
		const id = listMap(listName).toId[String(code)] || fresh(listName).toId[String(code)];
		if (!id) throw new Error(`List ${listName} has no value ${code}`);
		return id;
	}

	/** SuiteQL gom mọi trang. */
	// Số liệu đo từng truy vấn của lượt chạy hiện tại (tên, mili giây, số dòng); RESTlet trả kèm khi được hỏi (?timing=1)
	const stats = [];

	// Gộp truy vấn trùng trong một lượt ĐỌC (GET của RESTlet bật bằng memoize(true)): cùng câu lệnh + tham số thì dùng lại kết
	// quả. Không bật cho lượt ghi; mọi thao tác ghi qua Store cũng xóa bản nhớ.
	let memo = null;
	function memoize(on) {
		memo = on ? {} : null;
	}
	function forget() {
		if (memo) memo = {};
	}

	function run(sql, params, scriptId) {
		const key = memo ? sql + "" + JSON.stringify(params || []) : null;
		if (key !== null && memo[key]) return memo[key].map((r) => Object.assign({}, r));
		const rows = runQuery(sql, params, scriptId);
		if (key !== null) memo[key] = rows.map((r) => Object.assign({}, r));
		return rows;
	}

	function runQuery(sql, params, scriptId) {
		const started = Date.now();
		const out = [];
		const paged = query.runSuiteQLPaged({ query: sql, params: params || [], pageSize: 1000, customScriptId: scriptId });
		for (const range of paged.pageRanges) out.push(...paged.fetch({ index: range.index }).data.asMappedResults());
		if (stats.length < 200) stats.push({ q: scriptId || String(sql).replace(/\s+/g, " ").slice(0, 60), ms: Date.now() - started, rows: out.length });
		return out;
	}

	function rec(name) {
		const def = Schema.records[name];
		if (!def) throw new Error(`Unknown record ${name}`);
		return def;
	}

	function columns(name) {
		const def = rec(name);
		const cols = ["t.id AS id", "t.isinactive AS isinactive"];
		if (def.includeName || def.numbering) cols.push("t.name AS name");
		// Alias có tiền tố c_ để không trùng từ khóa SQL (from, to, date...)
		for (const [key, f] of Object.entries(def.fields)) {
			if (f.type === "date") cols.push(`TO_CHAR(t.${f.id}, 'YYYY-MM-DD') AS c_${key}`);
			else cols.push(`t.${f.id} AS c_${key}`);
		}
		return cols.join(", ");
	}

	function convertRow(name, row) {
		const def = rec(name);
		const o = { id: String(row.id), isInactive: row.isinactive === "T" };
		if (def.includeName || def.numbering) o.name = row.name;
		for (const [key, f] of Object.entries(def.fields)) {
			let v = row[`c_${key}`];
			if (v === undefined) v = null;
			if (f.type === "check") v = v === "T" || v === true;
			else if (f.type === "select" && f.target && f.target.startsWith("list:")) v = codeOf(f.target.slice(5), v);
			else if (f.type === "select" && v !== null) v = String(v);
			else if ((f.type === "float" || f.type === "currency" || f.type === "int" || f.type === "percent") && v !== null && v !== "") v = Number(v);
			o[key] = v;
		}
		return o;
	}

	// Record cấu hình dùng chung: dòng không gắn công ty con (NULL) là dòng áp cho mọi công ty, người bị giới hạn vẫn thấy
	const SHARED_WHEN_NULL = ["company", "paygroup", "team", "out_source", "cost_account", "approval_step", "comm_plan", "punch_source", "shift_assign"];

	/**
	 * Điều kiện phạm vi công ty con của người đang thao tác (api/Access), ghép vào mọi lượt đọc qua find / get / findIn.
	 * Thứ tự: record có trường công ty con -> lọc trực tiếp; record con của bảng lương -> theo bảng lương; record theo nhân
	 * viên -> theo công ty con của hồ sơ lương; record con của hồ sơ lương -> theo hồ sơ. Record danh mục khác không lọc.
	 * Trả "" khi người dùng không bị giới hạn (hoặc Access chưa được cấu hình: Map/Reduce, Suitelet vai trò ẩn).
	 */
	function scopeClause(def) {
		let list = null;
		try {
			list = Access && typeof Access.subsidiaries === "function" ? Access.subsidiaries() : null;
		} catch (e) {
			list = [];
		}
		if (list === null) return "";
		const ids = list.filter((x) => /^\d+$/.test(String(x))).join(",") || "-1";
		const f = def.fields;
		const name = Object.keys(Schema.records).find((k) => Schema.records[k] === def);
		if (f.subsidiary && f.subsidiary.target === "subsidiary") {
			const col = `t.${f.subsidiary.id}`;
			return SHARED_WHEN_NULL.includes(name) ? `(${col} IS NULL OR ${col} IN (${ids}))` : `${col} IN (${ids})`;
		}
		const batch = Schema.records.batch;
		const prof = Schema.records.employee;
		if (f.batch && f.batch.target === "rec:batch") {
			return `(t.${f.batch.id} IS NULL OR t.${f.batch.id} IN (SELECT sb.id FROM ${batch.type} sb WHERE sb.${batch.fields.subsidiary.id} IN (${ids})))`;
		}
		if (f.employee && f.employee.target === "employee") {
			return `(t.${f.employee.id} IS NULL OR t.${f.employee.id} IN (SELECT sp.${prof.fields.employee.id} FROM ${prof.type} sp WHERE sp.${prof.fields.subsidiary.id} IN (${ids})))`;
		}
		if (f.profile && f.profile.target === "rec:employee") {
			return `t.${f.profile.id} IN (SELECT sp.id FROM ${prof.type} sp WHERE sp.${prof.fields.subsidiary.id} IN (${ids}))`;
		}
		return "";
	}

	/** Chặn ghi record sang công ty con ngoài phạm vi của người đang thao tác. */
	function assertWriteScope(name, values) {
		const f = rec(name).fields.subsidiary;
		if (!f || f.target !== "subsidiary" || !values || values.subsidiary === undefined) return;
		if (!Access || typeof Access.restricted !== "function" || !Access.restricted()) return;
		if ((values.subsidiary === null || values.subsidiary === "") && SHARED_WHEN_NULL.includes(name)) throw scopeError();
		if (!Access.allowsSubsidiary(values.subsidiary)) throw scopeError();
	}

	function scopeError() {
		const e = new Error("Your role is not allowed to access this subsidiary / Vai trò của bạn không được truy cập công ty con này");
		e.userMessage = { en: "Your role is not allowed to access this subsidiary", vi: "Vai trò của bạn không được truy cập công ty con này" };
		return e;
	}

	/**
	 * Đọc record theo điều kiện.
	 * @param {string} name tên logic (Schema.records)
	 * @param {{where?: string, params?: Array, order?: string, includeInactive?: boolean, unscoped?: boolean}} [opt]
	 *   where dùng tên trường logic dạng {field}, ví dụ "{batch} = ?"
	 */
	function find(name, opt = {}) {
		const def = rec(name);
		let where = opt.where ? substitute(name, opt.where) : "1 = 1";
		if (!opt.includeInactive) where = `(${where}) AND t.isinactive = 'F'`;
		const scope = opt.unscoped ? null : scopeClause(def);
		if (scope) where = `(${where}) AND ${scope}`;
		const sql = `SELECT ${columns(name)} FROM ${def.type} t WHERE ${where}` + (opt.order ? ` ORDER BY ${substitute(name, opt.order)}` : " ORDER BY t.id");
		return run(sql, opt.params, "s4vp_find_" + name).map((r) => convertRow(name, r));
	}

	/** Thay {field} bằng cột t.custrecord_... ; {id}, {name} giữ cột chuẩn. */
	function substitute(name, text) {
		const def = rec(name);
		return text.replace(/\{(\w+)\}/g, (m, key) => {
			if (key === "id" || key === "name" || key === "isinactive") return `t.${key}`;
			if (!def.fields[key]) throw new Error(`Unknown field ${name}.${key}`);
			return `t.${def.fields[key].id}`;
		});
	}

	function findIn(name, field, ids, extraWhere, extraParams) {
		const out = [];
		const list = [...new Set((ids || []).filter((x) => x !== null && x !== undefined && x !== "").map(String))];
		for (let i = 0; i < list.length; i += 900) {
			const chunk = list.slice(i, i + 900);
			const where = `{${field}} IN (${chunk.map(() => "?").join(",")})` + (extraWhere ? ` AND (${extraWhere})` : "");
			out.push(...find(name, { where, params: chunk.concat(extraParams || []) }));
		}
		return out;
	}

	function get(name, id) {
		return find(name, { where: "{id} = ?", params: [id], includeInactive: true })[0] || null;
	}

	function toNsDate(iso) {
		if (!iso) return null;
		const s = String(iso);
		return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12, 0, 0);
	}

	function setValues(r, name, values) {
		const def = rec(name);
		for (const [key, v] of Object.entries(values)) {
			if (key === "name") {
				r.setValue({ fieldId: "name", value: v });
				continue;
			}
			if (key === "isInactive") {
				r.setValue({ fieldId: "isinactive", value: !!v });
				continue;
			}
			const f = def.fields[key];
			if (!f) throw new Error(`Unknown field ${name}.${key}`);
			let value = v;
			if (f.type === "date") value = toNsDate(v);
			else if (f.type === "check") value = !!v;
			else if (f.type === "select" && f.target && f.target.startsWith("list:")) value = idOf(f.target.slice(5), v);
			else if (value === undefined) value = null;
			if (value === null && f.type !== "check") value = "";
			r.setValue({ fieldId: f.id, value });
		}
	}

	function create(name, values) {
		forget();
		assertWriteScope(name, values);
		const r = record.create({ type: rec(name).type, isDynamic: false });
		setValues(r, name, values);
		return String(r.save({ enableSourcing: false, ignoreMandatoryFields: true }));
	}

	function update(name, id, values) {
		forget();
		assertWriteScope(name, values);
		const r = record.load({ type: rec(name).type, id, isDynamic: false });
		setValues(r, name, values);
		return String(r.save({ enableSourcing: false, ignoreMandatoryFields: true }));
	}

	/** Cập nhật nhanh không tải record (không qua User Event của record khác). */
	function submit(name, id, values) {
		forget();
		assertWriteScope(name, values);
		const def = rec(name);
		const out = {};
		for (const [key, v] of Object.entries(values)) {
			if (key === "name") {
				out.name = v;
				continue;
			}
			const f = def.fields[key];
			if (!f) throw new Error(`Unknown field ${name}.${key}`);
			let value = v;
			// submitFields quy đổi Date theo múi giờ máy chủ -> người dùng (lệch ngày): truyền chuỗi theo định dạng ngày của người dùng
			if (f.type === "date") value = v ? format.format({ value: toNsDate(v), type: format.Type.DATE }) : "";
			else if (f.type === "check") value = !!v;
			else if (f.type === "select" && f.target && f.target.startsWith("list:")) value = idOf(f.target.slice(5), v) || "";
			else if (value === null || value === undefined) value = "";
			out[f.id] = value;
		}
		record.submitFields({ type: def.type, id, values: out, options: { enableSourcing: false, ignoreMandatoryFields: true } });
	}

	function remove(name, id) {
		forget();
		record.delete({ type: rec(name).type, id });
	}

	return { run, find, findIn, get, create, update, submit, remove, listMap, codeOf, idOf, toNsDate, rec, stats, memoize };
});
