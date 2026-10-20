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
define(["N/query", "N/record", "./Schema"], (query, record, Schema) => {
	const listCache = {};

	/** {mã -> internal id} và {internal id -> mã} của một custom list. */
	function listMap(listName) {
		if (listCache[listName]) return listCache[listName];
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
		listCache[listName] = { toId, toCode };
		return listCache[listName];
	}

	function codeOf(listName, id) {
		if (id === null || id === undefined || id === "") return null;
		return listMap(listName).toCode[String(id)] || null;
	}

	function idOf(listName, code) {
		if (code === null || code === undefined || code === "") return null;
		const id = listMap(listName).toId[String(code)];
		if (!id) throw new Error(`List ${listName} has no value ${code}`);
		return id;
	}

	/** SuiteQL gom mọi trang. */
	function run(sql, params, scriptId) {
		const out = [];
		const paged = query.runSuiteQLPaged({ query: sql, params: params || [], pageSize: 1000, customScriptId: scriptId });
		for (const range of paged.pageRanges) out.push(...paged.fetch({ index: range.index }).data.asMappedResults());
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
		for (const [key, f] of Object.entries(def.fields)) {
			if (f.type === "date") cols.push(`TO_CHAR(t.${f.id}, 'YYYY-MM-DD') AS ${key}`);
			else cols.push(`t.${f.id} AS ${key}`);
		}
		return cols.join(", ");
	}

	function convertRow(name, row) {
		const def = rec(name);
		const o = { id: String(row.id), isInactive: row.isinactive === "T" };
		if (def.includeName || def.numbering) o.name = row.name;
		for (const [key, f] of Object.entries(def.fields)) {
			let v = row[key];
			if (v === undefined) v = null;
			if (f.type === "check") v = v === "T" || v === true;
			else if (f.type === "select" && f.target && f.target.startsWith("list:")) v = codeOf(f.target.slice(5), v);
			else if (f.type === "select" && v !== null) v = String(v);
			else if ((f.type === "float" || f.type === "currency" || f.type === "int" || f.type === "percent") && v !== null && v !== "") v = Number(v);
			o[key] = v;
		}
		return o;
	}

	/**
	 * Đọc record theo điều kiện.
	 * @param {string} name tên logic (Schema.records)
	 * @param {{where?: string, params?: Array, order?: string, includeInactive?: boolean}} [opt]
	 *   where dùng tên trường logic dạng {field}, ví dụ "{batch} = ?"
	 */
	function find(name, opt = {}) {
		const def = rec(name);
		let where = opt.where ? substitute(name, opt.where) : "1 = 1";
		if (!opt.includeInactive) where = `(${where}) AND t.isinactive = 'F'`;
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
		const r = record.create({ type: rec(name).type, isDynamic: false });
		setValues(r, name, values);
		return String(r.save({ enableSourcing: false, ignoreMandatoryFields: true }));
	}

	function update(name, id, values) {
		const r = record.load({ type: rec(name).type, id, isDynamic: false });
		setValues(r, name, values);
		return String(r.save({ enableSourcing: false, ignoreMandatoryFields: true }));
	}

	/** Cập nhật nhanh không tải record (không qua User Event của record khác). */
	function submit(name, id, values) {
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
			if (f.type === "date") value = toNsDate(v);
			else if (f.type === "check") value = !!v;
			else if (f.type === "select" && f.target && f.target.startsWith("list:")) value = idOf(f.target.slice(5), v) || "";
			else if (value === null || value === undefined) value = "";
			out[f.id] = value;
		}
		record.submitFields({ type: def.type, id, values: out, options: { enableSourcing: false, ignoreMandatoryFields: true } });
	}

	function remove(name, id) {
		record.delete({ type: rec(name).type, id });
	}

	return { run, find, findIn, get, create, update, submit, remove, listMap, codeOf, idOf, toNsDate, rec };
});
