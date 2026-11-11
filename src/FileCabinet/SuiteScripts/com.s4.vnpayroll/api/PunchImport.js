/**
 * Nạp dữ liệu máy chấm công cấu hình được (docs/PUNCH_IMPORT.md mục 3). Mô-đun route (docs/UI_V2.md mục 5):
 *   GET  punchSourcesView {subsidiary?}            hồ sơ nguồn dùng được cho công ty con + số dòng đối chiếu của mỗi nguồn
 *   GET  punchMappings    {source}                 bảng đối chiếu mã chấm công của một nguồn
 *   POST punchPreview     {source, text}           đọc + kiểm từng dòng, không ghi
 *   POST punchCommit      {source, text, cursor?}  ghi lượt chấm mới theo thứ tự dòng, dừng khi gần hết governance (more + cursor)
 *   POST punchMapSave     {source, rows}           thêm / sửa dòng đối chiếu (chỉ các dòng gửi lên)
 * Đọc: administrator, HR, kế toán ("payroll"); ghi: administrator + HR ("hr"). Phần đọc file ở core/PunchImport.
 *
 * Số truy vấn của một lượt preview / commit cố định theo kích thước file: hồ sơ nguồn, dòng đối chiếu của nguồn (JOIN nhân viên),
 * nhân viên theo mã (mỗi 900 mã một truy vấn, mã đi bằng tham số ràng buộc), lượt chấm đã có của các nhân viên đã nhận trong
 * khoảng ngày của file (mỗi 900 nhân viên một truy vấn), nhóm lương và kỳ lương, hồ sơ lương của các nhân viên đã nhận (mỗi 900
 * nhân viên một truy vấn, chỉ khi tài khoản có nhiều nhóm lương). Kỳ công đã khóa xét theo nhóm lương của từng nhân viên
 * (api/PayGroupPeriods, như api/Shifts): kỳ khóa của nhóm lương công ty khác trùng ngày không chặn.
 * Tương thích action cũ importPunches: id_kind N nhận mã nhân viên NetSuite hoặc id nội bộ (id thắng khi trùng; B chỉ mã), khóa chống trùng
 * nhân viên|thời điểm theo phút, lượt chấm ghi với nguồn I (tải file). Mọi kết quả qua safe(): không có khóa tên "error".
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Lean", "./PayGroupPeriods", "../core/PunchImport", "../core/AttendanceSummaryCalculator", "../core/Dates"], (runtime, Store, Lean, PG, Core, Summary, Dates) => {
	const blank = (v) => v === null || v === undefined || String(v).trim() === "";
	const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
	const isId = (v) => /^\d+$/.test(str(v));
	const person = (code, first, last) => [last, first].filter(Boolean).join(" ").trim() || code || "";
	const DATE = "TO_DATE(?, 'YYYY-MM-DD')";
	// Giới hạn một lượt gọi
	const MAX_TEXT = 5 * 1024 * 1024;
	const PREVIEW_ROWS = 1000;
	const MAX_MAP_ROWS = 500;
	const MAX_FAILURES = 100;
	const STATUS_ORDER = { invalid: 0, unmatched: 1, locked: 2, duplicate: 3, new: 4 };

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	/** Bản sao sâu không còn khóa tên "error" (đổi thành "issue"). */
	function safe(x) {
		if (Array.isArray(x)) return x.map(safe);
		if (!x || typeof x !== "object") return x;
		const o = {};
		for (const k of Object.keys(x)) o[k === "error" ? "issue" : k] = safe(x[k]);
		return o;
	}

	/** Hạn mức một lượt gọi: còn dưới 300 đơn vị governance hoặc quá 40 giây thì dừng (như api/Commission). */
	function budget() {
		const script = runtime.getCurrentScript();
		const deadline = Date.now() + 40000;
		return { low: () => script.getRemainingUsage() < 300 || Date.now() > deadline };
	}

	function chunks(list, size) {
		const out = [];
		for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
		return out;
	}

	// ------------------------------------------------------------------ hồ sơ nguồn

	const sourceView = (s) => ({
		id: s.id, code: s.name || "", description: s.description || "", subsidiary: s.subsidiary || null,
		layout: s.layout || "E", hasHeader: s.has_header !== false, skipLines: Number(s.skip_lines) || 0, delimiter: s.delimiter || "A",
		colEmp: s.col_emp || "", colDatetime: s.col_datetime || "", colDate: s.col_date || "", colTime: s.col_time || "", colIn: s.col_in || "", colOut: s.col_out || "", colDevice: s.col_device || "",
		dateFormat: s.date_format || "DMY", idKind: s.id_kind || "B", deviceDefault: s.device_default || "", minuteOffset: Number(s.minute_offset) || 0,
	});

	function sourceOf(id) {
		if (!isId(id)) throw fail("Select an attendance source profile", "Chưa chọn hồ sơ nguồn chấm công");
		const s = Store.get("punch_source", str(id));
		if (!s || s.isInactive) throw fail("Attendance source profile not found", "Không tìm thấy hồ sơ nguồn chấm công");
		return s;
	}

	function punchSourcesView(params) {
		const sub = str(params && params.subsidiary);
		const opt = isId(sub) ? { where: "{subsidiary} = ? OR {subsidiary} IS NULL", params: [sub], order: "{name}" } : { order: "{name}" };
		const sources = Store.find("punch_source", opt).map(sourceView);
		const col = Lean.col("punch_map", "source");
		const mapCounts = {};
		for (const r of Store.run(`SELECT ${col} AS src, COUNT(*) AS n FROM ${Lean.rec("punch_map").type} t WHERE t.isinactive = 'F' GROUP BY ${col}`, [], "s4vp_pi_map_counts")) {
			if (!blank(r.src)) mapCounts[String(r.src)] = Number(r.n) || 0;
		}
		return safe({ sources, mapCounts, recordTypes: { source: Lean.rec("punch_source").type, map: Lean.rec("punch_map").type } });
	}

	// ------------------------------------------------------------------ bảng đối chiếu

	const MAP_KEYS = ["device", "machine_id", "employee", "effective", "expiration"];

	/** Dòng đối chiếu đang dùng của nguồn kèm mã, họ tên nhân viên (một truy vấn). */
	function mappingRows(sourceId) {
		return Lean.select("punch_map", MAP_KEYS, {
			where: "{source} = ?", params: [String(sourceId)], order: "{machine_id}, {device}, {effective}",
			join: `LEFT JOIN employee e ON e.id = ${Lean.col("punch_map", "employee")}`,
			extra: ["e.entityid AS e_code", "e.firstname AS e_first", "e.lastname AS e_last"], raw: ["e_code", "e_first", "e_last"], tag: "s4vp_pi_maps",
		}).map((m) => ({
			id: m.id, device: m.device || "", machineId: m.machine_id || "", employee: m.employee || null, code: m.e_code || "", name: person(m.e_code, m.e_first, m.e_last),
			effective: m.effective || null, expiration: m.expiration || null,
		}));
	}

	function punchMappings(params) {
		const src = sourceOf(params && params.source);
		return safe({ source: src.id, rows: mappingRows(src.id) });
	}

	// ------------------------------------------------------------------ đọc dữ liệu cho kiểm tra

	/** Nhân viên theo mã (entityid, không phân biệt hoa thường) hoặc id nội bộ; mỗi 900 mã một truy vấn, mã đi bằng tham số. */
	function lookupEmployees(codes, withIds) {
		const byCode = {};
		const ids = new Set();
		const info = {};
		const want = [...new Set(codes.map((c) => str(c)).filter(Boolean))];
		for (const part of chunks(want, 900)) {
			const numeric = withIds ? Lean.idList(part.filter(isId)) : "0";
			const sql = `SELECT e.id AS id, e.entityid AS code, e.firstname AS first, e.lastname AS last FROM employee e WHERE UPPER(e.entityid) IN (${part.map(() => "?").join(",")})` + (numeric !== "0" ? ` OR e.id IN (${numeric})` : "");
			for (const e of Store.run(sql, part.map((c) => c.toUpperCase()), "s4vp_pi_emp")) {
				const id = String(e.id);
				ids.add(id);
				if (!blank(e.code)) byCode[String(e.code).trim().toUpperCase()] = id;
				info[id] = { code: e.code || "", name: person(e.code, e.first, e.last) };
			}
		}
		return { byCode, ids, info };
	}

	/** Khóa employee|punch_time của lượt chấm đang dùng trong [from, to]; mỗi 900 nhân viên một truy vấn. */
	function existingKeys(employeeIds, from, to) {
		const keys = new Set();
		if (!employeeIds.length || !from) return keys;
		for (const part of chunks(employeeIds, 900)) {
			const rows = Lean.select("punch", ["employee", "punch_time"], {
				where: `{employee} IN (${Lean.idList(part)}) AND {punch_date} >= ${DATE} AND {punch_date} <= ${DATE}`, params: [from, to], tag: "s4vp_pi_existing",
			});
			for (const p of rows) keys.add(`${p.employee}|${str(p.punch_time)}`);
		}
		return keys;
	}

	/** Kỳ lương theo cấu trúc lõi kèm mã nhóm lương (như periodsCore của api/Shifts) để kiểm kỳ công đã khóa. */
	function periods() {
		return PG.load((p) => ({ id: p.id, code: p.name, startDate: p.start, endDate: p.end, attendanceStatus: p.att_status || "O" }));
	}

	function textOf(body) {
		const text = body && body.text;
		if (typeof text !== "string" || !text.trim()) throw fail("Choose a file or paste the attendance data", "Chưa chọn file hoặc dán dữ liệu chấm công");
		if (text.length > MAX_TEXT) throw fail("The data is larger than 5 MB; split the file", "Dữ liệu lớn hơn 5 MB, hãy chia nhỏ file");
		return text;
	}

	/**
	 * Đọc và kiểm toàn bộ text. Trả mọi mục theo thứ tự dòng: dòng lỗi (invalid) và lượt chấm với trạng thái
	 * new | duplicate | unmatched | locked, kèm thông tin nhân viên và câu giải thích hai thứ tiếng.
	 */
	function analyse(src, text) {
		const parsed = Core.parseText(text, src);
		if (parsed.fatal) throw fail(parsed.fatal.en, parsed.fatal.vi);
		const idKind = ["N", "M", "B"].includes(src.id_kind) ? src.id_kind : "B";
		const maps = idKind === "N" ? [] : mappingRows(src.id);
		const emp = idKind === "M" ? { byCode: {}, ids: new Set(), info: {} } : lookupEmployees(parsed.rows.map((r) => r.machineId), idKind === "N");
		const info = Object.assign({}, emp.info);
		for (const m of maps) if (m.employee && !info[m.employee]) info[m.employee] = { code: m.code, name: m.name };
		const resolved = Core.resolveEmployees(parsed.rows, { mappings: maps, employeesByCode: emp.byCode, employeeIds: emp.ids, idKind });

		const matched = resolved.filter((r) => r.employee);
		// Kỳ khóa theo nhóm lương của nhân viên: nhóm của mọi nhân viên đã nhận tra một lần, nhớ theo nhóm|ngày
		const ps = periods();
		const groups = PG.loadGroups(ps, matched.map((r) => r.employee));
		const lockCache = {};
		const lockOf = (emp, d) => {
			const g = ps.multi ? groups[String(emp)] || PG.DEFAULT : null;
			const k = `${g || ""}|${d}`;
			if (!(k in lockCache)) lockCache[k] = Summary.lockedPeriodOverlap(d, d, ps.periods, g);
			return lockCache[k];
		};
		const dates = matched.map((r) => r.time.slice(0, 10)).sort();
		const keys = existingKeys([...new Set(matched.map((r) => r.employee))], dates[0], dates[dates.length - 1]);
		const candidates = resolved.map((r, i) => Object.assign({ index: i }, r)).filter((r) => r.employee && !lockOf(r.employee, r.time.slice(0, 10)));
		const status = {};
		for (const d of Core.dedupe(candidates, keys)) status[d.index] = d;

		const items = parsed.errors.map((e) => ({ line: e.line, machineId: "", device: "", time: "", kind: "", employee: null, code: "", name: "", how: null, status: "invalid", vi: e.vi, en: e.en }));
		resolved.forEach((r, i) => {
			const who = r.employee ? info[r.employee] || { code: "", name: "" } : { code: "", name: "" };
			const item = { line: r.line, machineId: r.machineId, device: r.device, time: r.time, kind: r.kind, employee: r.employee, code: who.code, name: who.name, how: r.how, status: "new", vi: "", en: "" };
			const lock = r.employee ? lockOf(r.employee, r.time.slice(0, 10)) : null;
			if (!r.employee) Object.assign(item, { status: "unmatched", vi: `Mã chấm công ${r.machineId} chưa đối chiếu với nhân viên`, en: `Attendance ID ${r.machineId} is not mapped to an employee` });
			else if (lock) Object.assign(item, { status: "locked", vi: `Kỳ công ${lock.code} đã khóa`, en: `Attendance of period ${lock.code} is locked` });
			else if (status[i].status === "duplicate") {
				const dup = status[i].dupLine;
				Object.assign(item, dup === null ? { status: "duplicate", vi: "Đã có lượt chấm này", en: "This punch already exists" } : { status: "duplicate", vi: `Trùng lượt chấm ở dòng ${dup}`, en: `Same punch as line ${dup}` });
			}
			items.push(item);
		});
		// Sắp theo dòng; trong một dòng lỗi trước, rồi theo thứ tự đọc (giờ vào trước giờ ra)
		items.forEach((it, i) => (it.seq = i));
		items.sort((a, b) => a.line - b.line || (a.status === "invalid" ? 0 : 1) - (b.status === "invalid" ? 0 : 1) || a.seq - b.seq);
		for (const it of items) delete it.seq;
		const allDates = parsed.rows.map((r) => r.time.slice(0, 10)).sort();
		return { items, header: parsed.header, range: { from: allDates[0] || null, to: allDates[allDates.length - 1] || null }, employees: new Set(matched.map((r) => r.employee)).size };
	}

	// ------------------------------------------------------------------ preview

	function punchPreview(body) {
		const src = sourceOf(body && body.source);
		const a = analyse(src, textOf(body));
		const counts = { total: a.items.length, new: 0, duplicate: 0, invalid: 0, unmatched: 0, locked: 0 };
		for (const it of a.items) counts[it.status]++;
		const groups = new Map();
		for (const it of a.items) {
			if (it.status !== "unmatched") continue;
			const k = `${Core.machineKey(it.machineId)}|${str(it.device).toUpperCase()}`;
			const g = groups.get(k);
			if (!g) groups.set(k, { machineId: it.machineId, device: it.device, lines: 1, firstTime: it.time });
			else {
				g.lines++;
				if (it.time < g.firstTime) g.firstTime = it.time;
			}
		}
		const unmatched = [...groups.values()].sort((x, y) => x.machineId.localeCompare(y.machineId, undefined, { numeric: true }) || x.device.localeCompare(y.device));
		// Tối đa 1.000 dòng chi tiết: ưu tiên lỗi, chưa đối chiếu, kỳ khóa, trùng; rồi xếp lại theo dòng
		let rows = a.items;
		if (rows.length > PREVIEW_ROWS) {
			const order = a.items.map((it, i) => ({ it, i })).sort((x, y) => STATUS_ORDER[x.it.status] - STATUS_ORDER[y.it.status] || x.i - y.i).slice(0, PREVIEW_ROWS);
			rows = order.sort((x, y) => x.i - y.i).map((x) => x.it);
		}
		return safe({ source: src.id, counts, rows, unmatched, range: a.range, employees: a.employees, header: a.header, truncated: a.items.length > rows.length });
	}

	// ------------------------------------------------------------------ commit

	/**
	 * Ghi lượt chấm mới theo thứ tự dòng, bỏ các dòng trước cursor (số dòng). Dừng ở ranh giới dòng khi gần hết governance:
	 * more = true, cursor = dòng chưa xử lý; số đếm chỉ của các dòng đã xử lý trong lượt này (cộng dồn các lượt là đủ).
	 * Dòng ghi lỗi không chặn dòng khác (failed + failures).
	 */
	function punchCommit(body) {
		const src = sourceOf(body && body.source);
		const text = textOf(body);
		const from = Math.max(0, Math.floor(Number(body && body.cursor) || 0));
		const a = analyse(src, text);
		const gov = budget();
		const out = { created: 0, skipped: 0, invalid: 0, unmatched: 0, locked: 0, failed: 0, failures: [] };
		let cursor = null;
		let line = null;
		for (const it of a.items) {
			if (it.line < from) continue;
			if (it.line !== line) {
				// Lượt nào cũng xử lý ít nhất một dòng (không lặp vô hạn khi governance còn ít ngay sau bước đọc)
				if (line !== null && gov.low()) {
					cursor = it.line;
					break;
				}
				line = it.line;
			}
			if (it.status === "duplicate") out.skipped++;
			else if (it.status !== "new") out[it.status]++;
			else {
				try {
					Store.create("punch", { employee: it.employee, punch_date: it.time.slice(0, 10), punch_time: it.time, device: str(it.device).slice(0, 300), source: "I" });
					out.created++;
				} catch (e) {
					out.failed++;
					const m = (e && e.message) || String(e);
					if (out.failures.length < MAX_FAILURES) out.failures.push({ line: it.line, vi: `Không ghi được lượt chấm: ${m}`, en: `The punch could not be saved: ${m}` });
				}
			}
		}
		if (cursor !== null) {
			out.more = true;
			out.cursor = cursor;
		} else {
			const last = a.items.length ? a.items[a.items.length - 1].line : 0;
			out.cursor = Math.max(from, last + 1);
		}
		return safe(out);
	}

	// ------------------------------------------------------------------ lưu đối chiếu

	/** Ngày ISO hoặc dd/MM/yyyy -> 'YYYY-MM-DD'; trống -> null; sai -> undefined. */
	function dateOf(v) {
		if (blank(v)) return null;
		return Core.parseDate(str(v), "DMY") || undefined;
	}

	const mapKey = (machineId, device, effective) => `${Core.machineKey(machineId)}|${str(device).toUpperCase()}|${effective || ""}`;

	/**
	 * Thêm / sửa dòng đối chiếu của nguồn. Mỗi dòng {id?, device, machineId, employee, effective?, expiration?, inactive?}:
	 * có id thì sửa dòng đó; không id mà trùng khóa (máy + mã + hiệu lực) với dòng đang dùng thì sửa dòng đó; còn lại tạo mới.
	 * inactive = true thôi dùng dòng có id. Dòng không gửi lên giữ nguyên. Kiểm hết trước khi ghi (một dòng sai thì không ghi gì).
	 */
	function punchMapSave(body) {
		const src = sourceOf(body && body.source);
		const input = Array.isArray(body && body.rows) ? body.rows : [];
		if (!input.length) throw fail("No mapping rows to save", "Không có dòng đối chiếu nào để lưu");
		if (input.length > MAX_MAP_ROWS) throw fail(`At most ${MAX_MAP_ROWS} mapping rows per save`, `Mỗi lần lưu tối đa ${MAX_MAP_ROWS} dòng đối chiếu`);
		const all = Store.find("punch_map", { where: "{source} = ?", params: [src.id], includeInactive: true });
		const byId = {};
		for (const m of all) byId[m.id] = m;
		const activeKey = {};
		for (const m of all) if (!m.isInactive) activeKey[mapKey(m.machine_id, m.device, m.effective)] = m.id;

		const empIds = [...new Set(input.map((r) => str(r && r.employee)).filter(isId))];
		const known = new Set();
		for (const part of chunks(empIds, 900)) for (const e of Store.run(`SELECT e.id AS id FROM employee e WHERE e.id IN (${Lean.idList(part)})`, [], "s4vp_pi_map_emp")) known.add(String(e.id));

		const plan = [];
		const seen = {};
		input.forEach((raw, i) => {
			const r = raw || {};
			const n = i + 1;
			const id = str(r.id);
			const inactive = r.inactive === true || r.inactive === "T" || r.isInactive === true;
			if (id && !byId[id]) throw fail(`Row ${n}: mapping row ${id} does not belong to this source`, `Dòng ${n}: dòng đối chiếu ${id} không thuộc nguồn này`);
			if (inactive) {
				if (!id) throw fail(`Row ${n}: only a saved mapping row can be deactivated`, `Dòng ${n}: chỉ thôi dùng được dòng đối chiếu đã lưu`);
				plan.push({ id, inactive: true });
				return;
			}
			const machineId = str(r.machineId).slice(0, 100);
			const device = str(r.device).slice(0, 100);
			const employee = str(r.employee);
			if (!machineId) throw fail(`Row ${n}: the attendance ID is missing`, `Dòng ${n}: thiếu mã chấm công`);
			if (!isId(employee) || !known.has(employee)) throw fail(`Row ${n}: select an employee for attendance ID ${machineId}`, `Dòng ${n}: chưa chọn nhân viên cho mã chấm công ${machineId}`);
			const effective = dateOf(r.effective);
			const expiration = dateOf(r.expiration);
			if (effective === undefined) throw fail(`Row ${n}: invalid effective date ${r.effective}`, `Dòng ${n}: ngày hiệu lực ${r.effective} không hợp lệ`);
			if (expiration === undefined) throw fail(`Row ${n}: invalid expiration date ${r.expiration}`, `Dòng ${n}: ngày hết hiệu lực ${r.expiration} không hợp lệ`);
			if (effective && expiration && Dates.cmp(expiration, effective) < 0) throw fail(`Row ${n}: the expiration date is before the effective date`, `Dòng ${n}: ngày hết hiệu lực trước ngày hiệu lực`);
			const key = mapKey(machineId, device, effective);
			if (seen[key]) throw fail(`Row ${n}: attendance ID ${machineId} is repeated (row ${seen[key]})`, `Dòng ${n}: mã chấm công ${machineId} lặp lại (dòng ${seen[key]})`);
			seen[key] = n;
			const other = activeKey[key];
			if (id && other && other !== id) throw fail(`Row ${n}: attendance ID ${machineId} is already mapped from the same date`, `Dòng ${n}: mã chấm công ${machineId} đã có dòng đối chiếu cùng ngày hiệu lực`);
			plan.push({ id: id || other || null, values: { device, machine_id: machineId, employee, effective, expiration } });
		});

		let saved = 0;
		for (const p of plan) {
			if (p.inactive) {
				if (!byId[p.id].isInactive) Store.update("punch_map", p.id, { isInactive: true });
			} else if (p.id) {
				if (byId[p.id].isInactive) Store.update("punch_map", p.id, Object.assign({ isInactive: false }, p.values));
				else Store.submit("punch_map", p.id, p.values);
			} else Store.create("punch_map", Object.assign({ source: src.id }, p.values));
			saved++;
		}
		return safe({ source: src.id, saved, rows: mappingRows(src.id) });
	}

	const routes = {
		get: {
			punchSourcesView: { roles: "payroll", run: punchSourcesView },
			punchMappings: { roles: "payroll", run: punchMappings },
		},
		post: {
			punchPreview: { roles: "hr", run: punchPreview },
			punchCommit: { roles: "hr", run: punchCommit },
			punchMapSave: { roles: "hr", run: punchMapSave },
		},
	};

	return { routes, punchSourcesView, punchMappings, punchPreview, punchCommit, punchMapSave, safe };
});
