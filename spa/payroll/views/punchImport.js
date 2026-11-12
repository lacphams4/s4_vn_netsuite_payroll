/**
 * Hộp thoại "Nạp chấm công" của màn Chấm công (docs/PUNCH_IMPORT.md mục 3, 4). Mở từ views/attendance.js, vai trò HR và
 * administrator (cùng nhóm được chạy processPunches).
 *
 * Tab "Nạp dữ liệu" gồm ba bước:
 *   1. Chọn hồ sơ nguồn (SearchSelect, GET punchSourcesView {subsidiary}); liên kết tạo / sửa hồ sơ trên form NetSuite.
 *      Chọn file (.csv, .txt, .dat; đọc UTF-8 bằng FileReader) hoặc dán từ Excel; quá 5 MB (số ký tự, như máy chủ) thì cảnh
 *      báo và khóa Xem trước.
 *   2. Xem trước (POST punchPreview {source, text}): bộ lọc trạng thái kèm số đếm, lưới có ô tìm; khung "Mã chưa đối chiếu"
 *      chọn nhân viên cho từng mã rồi Lưu đối chiếu (POST punchMapSave) và tự xem trước lại.
 *   3. Ghi (POST punchCommit {source, text, cursor?}) theo lượt: hộp thoại tự lặp, gửi lại cursor máy chủ trả về (post() của
 *      lib/api.js gửi lại nguyên nội dung cũ, không mang cursor, nên không dùng cho bước này); thanh tiến độ, kết quả cuối, gợi ý
 *      Xử lý chấm công máy cho kỳ.
 * Tab "Đối chiếu mã chấm công": GET punchMappings {source}, sửa nhân viên / hiệu lực tại chỗ, thêm mã, lưu bằng punchMapSave.
 *
 * Tên action, tên khóa đọc / gửi và cách cộng dồn kết quả ghi nằm ở khối "hợp đồng API" ngay dưới để khớp với bản cuối của
 * api/PunchImport.js. Hàm thuần (đọc phản hồi, dựng nội dung POST, vòng ghi) xuất ra để kiểm thử
 * (tests/tools/punch_import_view.test.js).
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import https from 'N/https';
import url from 'N/url';
import {call, post, errorText, unwrap, RESTLET} from '../lib/api.js';
import {num, fmtDate} from '../lib/format.js';
import {pick, serverText} from '../lib/i18n.js';
import {Button, Badge, Chips, Tabs, Stepper, Table, Field, TextInput, TextArea, SearchSelect, DateInput, Checkbox, Dialog, Empty} from '../ui/kit.js';

// ------------------------------------------------------------------ hợp đồng API (sửa ở đây khi api/PunchImport.js chốt tên)

export const ACTIONS = {
	sources: 'punchSourcesView', // GET {subsidiary} -> {sources, mapCounts, recordTypes: {source, map}, employees?}
	mappings: 'punchMappings', // GET {source} -> {rows: [{id, device, machineId, employee, code, name, effective, expiration}]}
	preview: 'punchPreview', // POST {source, text} -> {counts, rows, unmatched, range, employees}
	commit: 'punchCommit', // POST {source, text, cursor?} -> {created, skipped, invalid, unmatched, locked, more?, cursor}
	mapSave: 'punchMapSave', // POST {source, rows: [{id?, device, machineId, employee, effective?, expiration?}]} -> {saved, rows}
	employees: 'employeeSearch', // GET {subsidiary, q} -> {items: [{id, code, name, department}], more} (api/AdvancesV2.js)
};

// Khóa đọc ở phản hồi: khóa đầu theo tài liệu, các khóa sau là tên dự phòng (snake_case, tên cũ)
export const FIELDS = {
	view: {sources: ['sources'], mapCounts: ['mapCounts', 'map_counts'], recordTypes: ['recordTypes', 'record_types'], employees: ['employees']},
	recordTypes: {source: ['source', 'punch_source', 'punchSource'], map: ['map', 'punch_map', 'punchMap']},
	source: {
		id: ['id'], code: ['code', 'name'], description: ['description'], subsidiary: ['subsidiary'], layout: ['layout'], idKind: ['idKind', 'id_kind'],
		delimiter: ['delimiter'], hasHeader: ['hasHeader', 'has_header'], skipLines: ['skipLines', 'skip_lines'], dateFormat: ['dateFormat', 'date_format'],
		deviceDefault: ['deviceDefault', 'device_default'], minuteOffset: ['minuteOffset', 'minute_offset'], inactive: ['inactive', 'isinactive'],
	},
	preview: {counts: ['counts'], rows: ['rows'], unmatched: ['unmatched'], range: ['range'], employees: ['employees'], truncated: ['truncated']},
	counts: {total: ['total'], new: ['new', 'created'], duplicate: ['duplicate', 'duplicates'], invalid: ['invalid', 'errors'], unmatched: ['unmatched'], locked: ['locked']},
	row: {line: ['line'], machineId: ['machineId', 'machine_id'], device: ['device'], time: ['time'], kind: ['kind'], employee: ['employee'], code: ['code', 'employeeCode'], name: ['name', 'employeeName'], status: ['status'], vi: ['vi', 'messageVi'], en: ['en', 'message']},
	unmatched: {machineId: ['machineId', 'machine_id'], device: ['device'], lines: ['lines', 'count'], firstTime: ['firstTime', 'first_time', 'first']},
	mapping: {id: ['id'], device: ['device'], machineId: ['machineId', 'machine_id'], employee: ['employee'], code: ['code', 'employeeCode'], name: ['name', 'employeeName'], effective: ['effective'], expiration: ['expiration']},
	commit: {created: ['created'], skipped: ['skipped', 'duplicate'], invalid: ['invalid'], unmatched: ['unmatched'], locked: ['locked'], failed: ['failed'], failures: ['failures'], more: ['more'], cursor: ['cursor']},
	employee: {id: ['id', 'value'], code: ['code', 'entityId', 'entityid'], name: ['name']},
};

// Kết quả ghi qua nhiều lượt: api/PunchImport.punchCommit chỉ đếm các dòng đã xử lý trong lượt đó nên mọi số đều cộng dồn
// ('max' dùng khi máy chủ đổi sang trả số đếm của cả file ở mỗi lượt). failed: số lượt chấm máy chủ không ghi được (lỗi
// từng dòng, không chặn dòng khác), kèm failures [{line, vi, en}].
export const COMMIT_MERGE = {created: 'sum', skipped: 'sum', invalid: 'sum', unmatched: 'sum', locked: 'sum', failed: 'sum'};
export const MAX_FAILURES = 100;

// Một dòng gửi punchMapSave. withDates: gửi cả hiệu lực (trống = null để xóa); khung mã chưa đối chiếu không gửi ngày.
// inactive: thôi dùng dòng đã lưu (chỉ gửi id).
export function mapSaveRow(r, withDates) {
	if (r.inactive && has(r.id)) return {id: str(r.id), inactive: true};
	const out = {device: str(r.device).trim(), machineId: str(r.machineId).trim(), employee: str(r.employee)};
	if (has(r.id)) out.id = str(r.id);
	if (withDates) {
		out.effective = str(r.effective) || null;
		out.expiration = str(r.expiration) || null;
	}
	return out;
}

// Máy chủ nhận text tối đa 5 MB mỗi lượt gọi (api/PunchImport.textOf so text.length, tức số ký tự). File lớn hơn hai lần
// mức này không đọc (tránh treo trình duyệt); còn lại đọc rồi so số ký tự như máy chủ.
export const MAX_TEXT = 5 * 1024 * 1024;
export const MAX_BYTES = 2 * MAX_TEXT;
export const DETAIL_LIMIT = 1000; // preview chỉ trả tối đa 1000 dòng chi tiết
export const COMMIT_MAX_ROUNDS = 300; // chặn vòng ghi chạy mãi khi máy chủ trả more mà không tiến
export const STATUSES = ['new', 'duplicate', 'invalid', 'unmatched', 'locked'];
export const LAYOUTS = ['E', 'P', 'Z'];
export const ID_KINDS = ['N', 'M', 'B'];
const FILE_ID = 's4vp-pi-file';
const STORE_KEY = 's4vp-pi-source';

// ------------------------------------------------------------------ hàm thuần

const has = (v) => v !== undefined && v !== null && v !== '';
const str = (v) => (has(v) && typeof v !== 'object' ? String(v) : '');
const int = (v) => {
	const n = Number(v);
	return isFinite(n) ? n : 0;
};
const arr = (v) => (Array.isArray(v) ? v : []);
const cx = (...names) => names.filter(Boolean).join(' ');

/** Giá trị đầu tiên có mặt theo danh sách khóa. */
export function rd(o, keys) {
	if (!o || typeof o !== 'object') return undefined;
	for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
	return undefined;
}
const bool = (v) => v === true || v === 'T' || v === 't' || v === 1 || v === '1' || v === 'true';

export function mapSource(s) {
	const F = FIELDS.source;
	const hdr = rd(s, F.hasHeader);
	return {
		id: str(rd(s, F.id)), code: str(rd(s, F.code)), description: str(rd(s, F.description)), subsidiary: str(rd(s, F.subsidiary)),
		layout: str(rd(s, F.layout)).toUpperCase(), idKind: str(rd(s, F.idKind)).toUpperCase(), delimiter: str(rd(s, F.delimiter)).toUpperCase(),
		hasHeader: hdr === undefined ? true : bool(hdr), skipLines: int(rd(s, F.skipLines)), dateFormat: str(rd(s, F.dateFormat)).toUpperCase(),
		deviceDefault: str(rd(s, F.deviceDefault)), minuteOffset: int(rd(s, F.minuteOffset)), inactive: bool(rd(s, F.inactive)),
	};
}

export function mapEmployee(e) {
	const F = FIELDS.employee;
	return {id: str(rd(e, F.id)), code: str(rd(e, F.code)), name: str(rd(e, F.name))};
}

export function mapSourcesView(raw) {
	const F = FIELDS.view;
	const counts = rd(raw, F.mapCounts) || {};
	const types = rd(raw, F.recordTypes) || {};
	const mapCounts = {};
	Object.keys(counts).forEach((k) => (mapCounts[String(k)] = int(counts[k])));
	return {
		sources: arr(rd(raw, F.sources)).map(mapSource).filter((s) => s.id && !s.inactive),
		mapCounts,
		recordTypes: {source: str(rd(types, FIELDS.recordTypes.source)), map: str(rd(types, FIELDS.recordTypes.map))},
		employees: arr(rd(raw, F.employees)).map(mapEmployee).filter((e) => e.id),
	};
}

const statusOf = (v) => {
	const s = str(v).toLowerCase();
	return STATUSES.indexOf(s) >= 0 ? s : 'invalid';
};

export function mapPreviewRow(r, i) {
	const F = FIELDS.row;
	const line = int(rd(r, F.line));
	return {
		id: `r${line}-${i}`, line, machineId: str(rd(r, F.machineId)), device: str(rd(r, F.device)), time: str(rd(r, F.time)), kind: str(rd(r, F.kind)).toLowerCase(),
		employee: str(rd(r, F.employee)), code: str(rd(r, F.code)), name: str(rd(r, F.name)), status: statusOf(rd(r, F.status)), vi: str(rd(r, F.vi)), en: str(rd(r, F.en)),
	};
}

export const unmatchedKey = (machineId, device) => `${machineId}\u0001${device || ''}`;

export function mapPreview(raw) {
	const F = FIELDS.preview;
	const c = rd(raw, F.counts) || {};
	const counts = {};
	Object.keys(FIELDS.counts).forEach((k) => (counts[k] = int(rd(c, FIELDS.counts[k]))));
	const rows = arr(rd(raw, F.rows)).map(mapPreviewRow);
	if (!counts.total) counts.total = STATUSES.reduce((a, k) => a + counts[k], 0) || rows.length;
	const U = FIELDS.unmatched;
	const unmatched = arr(rd(raw, F.unmatched)).map((u) => {
		const machineId = str(rd(u, U.machineId));
		const device = str(rd(u, U.device));
		return {id: unmatchedKey(machineId, device), machineId, device, lines: int(rd(u, U.lines)), firstTime: str(rd(u, U.firstTime))};
	}).filter((u) => u.machineId);
	const range = rd(raw, F.range) || {};
	const emp = rd(raw, F.employees);
	return {
		counts, rows, unmatched,
		range: {from: str(range.from).slice(0, 10), to: str(range.to).slice(0, 10)},
		employees: typeof emp === 'number' ? emp : Array.isArray(emp) ? emp.length : int(emp),
		employeeList: Array.isArray(emp) ? emp.map(mapEmployee).filter((e) => e.id) : [],
		truncated: bool(rd(raw, F.truncated)) || rows.length < counts.total,
	};
}

export function mapMappings(raw) {
	const F = FIELDS.mapping;
	return arr(raw && raw.rows).map((r, i) => {
		const id = str(rd(r, F.id));
		return {
			key: id ? `m${id}` : `x${i}`, id, device: str(rd(r, F.device)), machineId: str(rd(r, F.machineId)), employee: str(rd(r, F.employee)),
			code: str(rd(r, F.code)), name: str(rd(r, F.name)), effective: str(rd(r, F.effective)).slice(0, 10), expiration: str(rd(r, F.expiration)).slice(0, 10),
		};
	});
}

export function mapCommitStep(raw) {
	const F = FIELDS.commit;
	const out = {};
	Object.keys(COMMIT_MERGE).forEach((k) => (out[k] = int(rd(raw, F[k]))));
	out.failures = arr(rd(raw, F.failures)).map((f) => ({line: int(f && f.line), vi: str(f && f.vi), en: str(f && f.en)}));
	out.more = rd(raw, F.more) === true;
	const cursor = rd(raw, F.cursor);
	out.cursor = cursor === undefined ? null : cursor;
	return out;
}

/** Cộng kết quả một lượt ghi vào tổng (theo COMMIT_MERGE). */
export function addCommit(acc, step) {
	const out = Object.assign({}, acc || {});
	Object.keys(COMMIT_MERGE).forEach((k) => {
		const a = int(out[k]);
		const b = int(step[k]);
		out[k] = acc ? (COMMIT_MERGE[k] === 'sum' ? a + b : Math.max(a, b)) : b;
	});
	out.failures = arr(acc && acc.failures).concat(arr(step.failures)).slice(0, MAX_FAILURES);
	out.more = !!step.more;
	out.cursor = step.cursor;
	return out;
}

const sameCursor = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

/**
 * Ghi theo lượt: gửi {..body, cursor} cho đến khi máy chủ hết more. Lượt sau mang cursor lượt trước trả về. Dừng (stalled) khi
 * máy chủ trả more mà cursor không đổi và không ghi thêm dòng nào; dừng (more còn true) khi quá maxRounds. Luôn resolve: lỗi
 * của cả lượt gọi (governance, mạng) nằm ở `stopped` (chuỗi) cùng các số đã ghi được. onStep(tổng tạm) gọi sau mỗi lượt.
 */
export function runCommit(send, body, opts) {
	const o = opts || {};
	const limit = o.maxRounds || COMMIT_MAX_ROUNDS;
	const errText = o.errorText || ((e) => String((e && e.message) || e));
	let total = null;
	const step = (cursor, round) => {
		const payload = Object.assign({}, body);
		if (cursor !== null && cursor !== undefined && cursor !== '') payload.cursor = cursor;
		return Promise.resolve()
			.then(() => send(payload))
			.then((raw) => {
				const r = mapCommitStep(raw);
				total = addCommit(total, r);
				total.rounds = round;
				if (o.onStep) o.onStep(Object.assign({}, total));
				if (!r.more) return Object.assign(total, {more: false, done: true});
				if (sameCursor(r.cursor, cursor) && !r.created) return Object.assign(total, {done: true, stalled: true});
				if (round >= limit) return Object.assign(total, {done: true});
				return step(r.cursor, round + 1);
			});
	};
	return step(null, 1).catch((e) => Object.assign(total || addCommit(null, mapCommitStep({})), {rounds: (total && total.rounds) || 0, done: true, stopped: errText(e) || '?'}));
}

/** Số byte UTF-8 của chuỗi (giới hạn 5 MB của máy chủ tính theo byte). */
export function utf8Bytes(s) {
	const text = String(s || '');
	let n = 0;
	for (let i = 0; i < text.length; i += 1) {
		const c = text.charCodeAt(i);
		if (c < 0x80) n += 1;
		else if (c < 0x800) n += 2;
		else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
			n += 4;
			i += 1;
		} else n += 3;
	}
	return n;
}

/** Số dòng có dữ liệu (bỏ dòng trống). */
export function lineCount(text) {
	const s = String(text || '');
	if (!s.trim()) return 0;
	return s.split(/\r\n|\r|\n/).filter((l) => l.trim()).length;
}

export const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

/** 'YYYY-MM-DD HH:mm[:ss]' -> 'dd/mm/yyyy HH:mm'. */
export function fmtTime(v) {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(str(v));
	if (!m) return str(v);
	return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

/** Danh sách chọn nhân viên: gộp nhiều nguồn, bỏ trùng theo id, sắp theo mã. */
export function employeeOptions(...lists) {
	const seen = {};
	const out = [];
	lists.forEach((list) =>
		arr(list).forEach((e) => {
			const id = str(e && (e.id || e.employee));
			if (!id || seen[id]) return;
			seen[id] = true;
			out.push({value: id, label: `${str(e.code)} ${str(e.name)}`.trim() || id, code: str(e.code)});
		})
	);
	out.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
	return out.map((o) => ({value: o.value, label: o.label}));
}

/**
 * Đường dẫn form NetSuite của hồ sơ nguồn / dòng đối chiếu: recordType là số (id nội bộ của loại record) thì
 * custrecordentry.nl?rectype=; là script id (customrecord_...) thì N/url.resolveRecord (resolve truyền vào để kiểm thử).
 */
export function recordHref(recordType, id, resolve) {
	const rt = str(recordType);
	if (!rt) return '';
	if (/^\d+$/.test(rt)) return `/app/common/custom/custrecordentry.nl?rectype=${encodeURIComponent(rt)}${has(id) ? `&id=${encodeURIComponent(id)}&e=T` : ''}`;
	try {
		const opts = {recordType: rt, isEditMode: true};
		if (has(id)) opts.recordId = String(id);
		return (resolve && resolve(opts)) || '';
	} catch (e) {
		return '';
	}
}

/** Kỳ lương giao với khoảng ngày của file (để gợi ý Xử lý chấm công máy). */
export function periodsInRange(periods, range) {
	const from = str(range && range.from).slice(0, 10);
	const to = str(range && range.to).slice(0, 10);
	if (!from || !to) return [];
	return arr(periods).filter((p) => str(p.start) && str(p.end) && str(p.start) <= to && str(p.end) >= from);
}

/** Dòng gửi lưu từ khung "Mã chưa đối chiếu": chỉ mã đã chọn nhân viên; allDevices thì bỏ trống thiết bị và gộp mã trùng. */
export function unmatchedPayload(unmatched, assign, allDevices) {
	const out = [];
	const seen = {};
	arr(unmatched).forEach((u) => {
		const employee = str((assign || {})[u.id]);
		if (!employee) return;
		const device = allDevices ? '' : u.device;
		const k = unmatchedKey(u.machineId, device);
		if (seen[k]) return;
		seen[k] = true;
		out.push(mapSaveRow({device, machineId: u.machineId, employee}, false));
	});
	return out;
}

/** Lỗi của một dòng đối chiếu đang sửa: mã trên máy, nhân viên bắt buộc; hết hiệu lực không trước ngày hiệu lực. */
export function mappingError(r) {
	if (r.inactive) return '';
	if (!str(r.machineId).trim()) return 'machineId';
	if (!str(r.employee)) return 'employee';
	if (str(r.effective) && str(r.expiration) && str(r.expiration) < str(r.effective)) return 'dates';
	return '';
}

/** Dòng đối chiếu sau khi áp phần sửa; changed: có khác bản máy chủ. */
export function mergeMappings(rows, edits, added) {
	const base = arr(rows).map((r) => {
		const e = (edits || {})[r.key];
		const m = e ? Object.assign({}, r, e) : r;
		const changed = !!e && (!!m.inactive || ['device', 'machineId', 'employee', 'effective', 'expiration'].some((k) => str(m[k]) !== str(r[k])));
		return Object.assign({}, m, {isNew: false, changed});
	});
	return base.concat(arr(added).map((r) => Object.assign({}, r, {isNew: true, changed: true})));
}

export function canImport(user, data) {
	if (data && typeof data.canEdit === 'boolean') return data.canEdit;
	const role = str(user && user.role);
	return !!(user && (user.isHr || user.fullAccess === true)) || role === 'administrator' || role === 'customrole_s4vp_hr';
}

export function initialState(source) {
	return {
		tab: 'import', sources: null, mapCounts: {}, recordTypes: {}, srcEmployees: [], source: source || '',
		text: '', fileText: '', fileName: '', fileBytes: 0, fileError: '', lines: 0,
		preview: null, filter: 'all', assign: {}, allDevices: false, extraEmployees: [], findQ: '', findNote: '',
		commit: null, mappings: null, mapFor: '', mapEdits: {}, mapNew: [], error: '',
	};
}

// ------------------------------------------------------------------ chữ

const TEXT = {
	vi: {
		button: 'Nạp chấm công',
		title: 'Nạp chấm công từ máy chấm công',
		tabs: {import: 'Nạp dữ liệu', map: 'Đối chiếu mã chấm công', label: 'Nạp chấm công'},
		steps: {pick: 'Chọn nguồn và dữ liệu', preview: 'Xem trước, đối chiếu mã', commit: 'Ghi lượt chấm', label: 'Các bước nạp chấm công'},
		source: 'Hồ sơ nguồn', sourcePh: 'Chọn hồ sơ nguồn...', loadingSources: 'Đang tải hồ sơ nguồn...',
		noSources: 'Chưa có hồ sơ nguồn nào. Bấm Tạo hồ sơ nguồn, lưu trên form NetSuite rồi bấm Tải lại danh sách.',
		createSource: 'Tạo hồ sơ nguồn', editSource: 'Sửa hồ sơ', reloadSources: 'Tải lại danh sách', noRecordType: 'Máy chủ chưa trả loại record của hồ sơ nguồn',
		layouts: {E: 'Mỗi dòng một lượt chấm', P: 'Mỗi dòng có giờ vào và giờ ra', Z: 'ZKTeco attlog'},
		idKinds: {N: 'Nhận diện theo mã nhân viên NetSuite', M: 'Nhận diện chỉ theo bảng đối chiếu', B: 'Bảng đối chiếu trước, không có thì mã nhân viên NetSuite'},
		dateFormats: {YMD: 'Ngày năm-tháng-ngày', DMY: 'Ngày ngày/tháng/năm', MDY: 'Ngày tháng/ngày/năm'},
		summary: {device: (d) => `thiết bị mặc định ${d}`, offset: (m) => `lệch đồng hồ ${m} phút`, maps: (n) => `${n} mã đã đối chiếu`, noHeader: 'không có dòng tiêu đề', skip: (n) => `bỏ ${n} dòng đầu`},
		file: 'File chấm công (.csv, .txt, .dat)', fileHint: 'Đọc dạng UTF-8, tối đa 5 MB mỗi lần nạp.', fileRead: (name, n, size) => `${name}: ${n} dòng, ${size} MB`,
		fileFailed: 'Không đọc được file. Kiểm tra file rồi chọn lại, hoặc dán dữ liệu từ Excel.',
		tooBig: (size) => `Dữ liệu ${size} MB vượt giới hạn 5 MB mỗi lần nạp. Tách file theo tháng hoặc theo máy rồi nạp từng phần.`,
		paste: 'Hoặc dán từ Excel', pastePh: 'Chọn vùng trong Excel (kể cả dòng tiêu đề nếu hồ sơ nguồn có tiêu đề), Ctrl+C rồi dán vào đây',
		pasteRead: (n) => `${n} dòng đã dán`, usingFile: (name) => `Đang dùng file ${name}. Dán vào ô này để thay bằng dữ liệu dán.`, noData: 'Chưa có dữ liệu.',
		preview: 'Xem trước', previewAgain: 'Xem trước lại', previewing: 'Đang đọc và kiểm dữ liệu chấm công...',
		needSource: 'Chọn hồ sơ nguồn', needData: 'Chọn file hoặc dán dữ liệu', needPreview: 'Bấm Xem trước trước khi ghi', nothingNew: 'Không có lượt chấm mới để ghi',
		commit: (n) => `Ghi ${num(n)} lượt chấm mới`, close: 'Đóng', running: 'Đang ghi, chờ xong rồi đóng',
		status: {all: 'Tất cả', new: 'Mới', duplicate: 'Trùng', invalid: 'Lỗi', unmatched: 'Chưa đối chiếu', locked: 'Kỳ đã khóa'},
		kind: {in: 'vào', out: 'ra'},
		previewTitle: 'Kết quả xem trước', range: (a, b, n) => `Từ ${a} đến ${b} · ${n} nhân viên`,
		truncated: (shown, total) => `Chỉ hiện ${num(shown)} / ${num(total)} dòng chi tiết đầu (ưu tiên dòng lỗi và chưa đối chiếu); số đếm và danh sách mã chưa đối chiếu là của toàn bộ dữ liệu.`,
		search: 'Tìm dòng, mã trên máy, nhân viên, thời điểm, thiết bị, trạng thái, lý do', noRows: 'Không có dòng nào.',
		cols: {line: 'Dòng', machineId: 'Mã trên máy', employee: 'Nhân viên', time: 'Thời điểm', device: 'Thiết bị', status: 'Trạng thái', reason: 'Lý do', lines: 'Số dòng', first: 'Lượt đầu', effective: 'Hiệu lực từ', expiration: 'Hết hiệu lực', state: 'Ghi chú'},
		unm: {
			title: (n) => `Mã chưa đối chiếu (${num(n)})`, hint: 'Chọn nhân viên cho từng mã trên máy rồi bấm Lưu đối chiếu; hệ thống tự xem trước lại.',
			save: (n) => `Lưu đối chiếu (${n})`, saving: 'Đang lưu bảng đối chiếu...', saved: (n) => `Đã lưu ${n} dòng đối chiếu.`, allDevices: 'Áp dụng cho mọi máy của nguồn (bỏ trống thiết bị)',
			pick: 'Chọn nhân viên...', search: 'Tìm mã trên máy, thiết bị', find: 'Tìm thêm', findPh: 'Nhân viên chưa có trong danh sách: gõ mã hoặc họ tên', finding: 'Đang tìm nhân viên...',
			found: (n) => `Đã thêm ${n} nhân viên vào danh sách chọn.`, notFound: 'Không tìm thấy nhân viên nào khớp.', none: 'Không có mã nào khớp.',
		},
		progress: {
			running: (r) => `Đang ghi lượt ${r}...`, done: 'Đã ghi xong', writing: 'Đang ghi lượt chấm...', of: (a, b) => `${num(a)} / ${num(b)} lượt chấm mới`,
			counts: (c) => `Đã ghi ${num(c.created)} lượt chấm · bỏ qua ${num(c.skipped)} (trùng) · ${num(c.invalid)} lỗi · ${num(c.unmatched)} chưa đối chiếu · ${num(c.locked)} thuộc kỳ đã khóa`,
			stopped: (m) => `Lượt ghi bị dừng vì lỗi: ${m}. Các lượt chấm đã ghi được giữ lại; bấm Ghi lại để tiếp tục (dòng đã ghi được bỏ qua là trùng).`,
			failedLines: (n) => `${num(n)} lượt chấm không ghi được (các dòng khác vẫn ghi):`, line: (n) => `Dòng ${n}`,
			stalled: 'Máy chủ báo còn dữ liệu nhưng không ghi thêm được. Bấm Xem trước lại để kiểm tra.',
			incomplete: 'Đã đạt số lượt ghi tối đa của một lần bấm. Bấm Ghi lại để ghi tiếp phần còn lại.',
			next: 'Bước tiếp theo: bấm Xử lý chấm công máy để lập phiếu ngoại lệ (trễ, sớm, thiếu lượt chấm) và đơn làm thêm đề xuất từ lượt chấm mới.',
			process: (code) => `Xử lý chấm công máy kỳ ${code}`, openPeriod: (code) => `Mở kỳ ${code}`, otherPeriods: 'Dữ liệu còn thuộc kỳ khác:',
			noProcess: 'Mở kỳ tương ứng rồi bấm Thao tác khác > Xử lý chấm công máy.', writtenNotice: (n) => `Đã ghi ${num(n)} lượt chấm từ file.`,
		},
		map: {
			title: (code) => `Bảng đối chiếu của nguồn ${code}`, hint: 'Mỗi dòng gán một mã trên máy (thiết bị trống = mọi máy của nguồn) cho một nhân viên trong khoảng hiệu lực. Sửa tại chỗ rồi bấm Lưu thay đổi.',
			noSource: 'Chọn hồ sơ nguồn ở tab Nạp dữ liệu để xem bảng đối chiếu.', loading: 'Đang tải bảng đối chiếu...', empty: 'Nguồn này chưa có dòng đối chiếu nào.',
			search: 'Tìm mã trên máy, thiết bị, nhân viên, ngày', add: 'Thêm mã', reload: 'Tải lại', save: (n) => `Lưu thay đổi (${n})`, saving: 'Đang lưu bảng đối chiếu...',
			saved: (n) => `Đã lưu ${n} dòng đối chiếu.`, isNew: 'mới', changed: 'đã sửa', remove: 'Bỏ', open: 'Mở', anyDevice: 'mọi máy',
			deactivate: 'Thôi dùng', undo: 'Hoàn tác', inactive: 'thôi dùng khi lưu',
			errors: {machineId: 'Thiếu mã trên máy', employee: 'Chưa chọn nhân viên', dates: 'Hết hiệu lực trước ngày hiệu lực'}, fixFirst: 'Sửa các dòng báo lỗi trước khi lưu',
		},
		loadFailed: 'Không tải được dữ liệu. Xem thông báo phía trên rồi thử lại.',
	},
	en: {
		button: 'Import time clock',
		title: 'Import time clock punches',
		tabs: {import: 'Import data', map: 'Punch ID mapping', label: 'Import time clock'},
		steps: {pick: 'Choose source and data', preview: 'Preview, map IDs', commit: 'Write punches', label: 'Import steps'},
		source: 'Punch source', sourcePh: 'Select a punch source...', loadingSources: 'Loading punch sources...',
		noSources: 'No punch source yet. Click Create punch source, save it on the NetSuite form, then click Reload list.',
		createSource: 'Create punch source', editSource: 'Edit source', reloadSources: 'Reload list', noRecordType: 'The server did not return the punch source record type',
		layouts: {E: 'One punch per line', P: 'Time in and time out per line', Z: 'ZKTeco attlog'},
		idKinds: {N: 'Identified by NetSuite employee ID', M: 'Identified by the mapping table only', B: 'Mapping table first, then NetSuite employee ID'},
		dateFormats: {YMD: 'Dates year-month-day', DMY: 'Dates day/month/year', MDY: 'Dates month/day/year'},
		summary: {device: (d) => `default device ${d}`, offset: (m) => `clock offset ${m} min`, maps: (n) => `mapped IDs: ${n}`, noHeader: 'no header row', skip: (n) => `skip first ${n} lines`},
		file: 'Time clock file (.csv, .txt, .dat)', fileHint: 'Read as UTF-8, at most 5 MB per import.', fileRead: (name, n, size) => `${name}: ${n} lines, ${size} MB`,
		fileFailed: 'The file could not be read. Check the file and choose it again, or paste the data from Excel.',
		tooBig: (size) => `The data is ${size} MB, over the 5 MB limit per import. Split the file by month or by device and import each part.`,
		paste: 'Or paste from Excel', pastePh: 'Select the range in Excel (including the header row if the source has one), press Ctrl+C and paste here',
		pasteRead: (n) => `Pasted lines: ${n}`, usingFile: (name) => `Using file ${name}. Paste here to replace it with pasted data.`, noData: 'No data yet.',
		preview: 'Preview', previewAgain: 'Preview again', previewing: 'Reading and checking punches...',
		needSource: 'Select a punch source', needData: 'Choose a file or paste data', needPreview: 'Click Preview before writing', nothingNew: 'No new punches to write',
		commit: (n) => `Write ${num(n)} new punches`, close: 'Close', running: 'Writing, wait until it finishes',
		status: {all: 'All', new: 'New', duplicate: 'Duplicate', invalid: 'Error', unmatched: 'Unmapped', locked: 'Locked period'},
		kind: {in: 'in', out: 'out'},
		previewTitle: 'Preview result', range: (a, b, n) => `From ${a} to ${b} · employees: ${n}`,
		truncated: (shown, total) => `Showing the first ${num(shown)} / ${num(total)} detail lines (errors and unmapped first); counts and the unmapped ID list cover all data.`,
		search: 'Search line, device ID, employee, time, device, status, reason', noRows: 'No lines.',
		cols: {line: 'Line', machineId: 'Device ID', employee: 'Employee', time: 'Time', device: 'Device', status: 'Status', reason: 'Reason', lines: 'Lines', first: 'First punch', effective: 'Effective', expiration: 'Expires', state: 'Note'},
		unm: {
			title: (n) => `Unmapped IDs (${num(n)})`, hint: 'Select an employee for each device ID, then click Save mapping; the preview runs again automatically.',
			save: (n) => `Save mapping (${n})`, saving: 'Saving the mapping table...', saved: (n) => `Mapping lines saved: ${n}.`, allDevices: 'Apply to every device of the source (blank device)',
			pick: 'Select an employee...', search: 'Search device ID, device', find: 'Find more', findPh: 'Employee not in the list: type a code or name', finding: 'Searching employees...',
			found: (n) => `Employees added to the list: ${n}.`, notFound: 'No matching employee.', none: 'No matching ID.',
		},
		progress: {
			running: (r) => `Writing round ${r}...`, done: 'Writing finished', writing: 'Writing punches...', of: (a, b) => `${num(a)} / ${num(b)} new punches`,
			counts: (c) => `Written: ${num(c.created)} · skipped (duplicate): ${num(c.skipped)} · errors: ${num(c.invalid)} · unmapped: ${num(c.unmatched)} · in locked periods: ${num(c.locked)}`,
			stopped: (m) => `Writing stopped on an error: ${m}. Punches already written are kept; click Write again to continue (written lines are skipped as duplicates).`,
			failedLines: (n) => `Punches that could not be saved (other lines were saved): ${num(n)}`, line: (n) => `Line ${n}`,
			stalled: 'The server reported more data but wrote nothing further. Click Preview again to check.',
			incomplete: 'The maximum number of rounds for one click was reached. Click Write again to continue.',
			next: 'Next step: click Process punches to create exceptions (late, early, missing punches) and proposed overtime requests from the new punches.',
			process: (code) => `Process punches for period ${code}`, openPeriod: (code) => `Open period ${code}`, otherPeriods: 'The data also covers other periods:',
			noProcess: 'Open the matching period, then click More actions > Process punches.', writtenNotice: (n) => `Punches imported from the file: ${num(n)}.`,
		},
		map: {
			title: (code) => `Mapping table of source ${code}`, hint: 'Each line assigns a device ID (blank device = every device of the source) to an employee within the effective dates. Edit in place, then click Save changes.',
			noSource: 'Select a punch source on the Import data tab to see its mapping table.', loading: 'Loading the mapping table...', empty: 'This source has no mapping lines yet.',
			search: 'Search device ID, device, employee, date', add: 'Add ID', reload: 'Reload', save: (n) => `Save changes (${n})`, saving: 'Saving the mapping table...',
			saved: (n) => `Mapping lines saved: ${n}.`, isNew: 'new', changed: 'edited', remove: 'Remove', open: 'Open', anyDevice: 'every device',
			deactivate: 'Deactivate', undo: 'Undo', inactive: 'deactivated on save',
			errors: {machineId: 'Device ID is missing', employee: 'No employee selected', dates: 'Expiry is before the effective date'}, fixFirst: 'Fix the lines with errors before saving',
		},
		loadFailed: 'The data could not be loaded. See the message above and try again.',
	},
};

const TONES = {new: 'ok', duplicate: 'muted', invalid: 'error', unmatched: 'warn', locked: 'info'};

// Lượt gọi POST một lần (không lặp như post() của lib/api.js): vòng ghi tự gửi cursor
let restletBase = '';
export function sendOnce(body) {
	if (!restletBase) restletBase = url.resolveScript(Object.assign({}, RESTLET));
	return https.post.promise({url: restletBase, body: JSON.stringify(body), headers: {'Content-Type': 'application/json'}}).then(unwrap);
}

const remembered = () => {
	try {
		return String(window.localStorage.getItem(STORE_KEY) || '');
	} catch (e) {
		return '';
	}
};
const remember = (id) => {
	try {
		window.localStorage.setItem(STORE_KEY, String(id || ''));
	} catch (e) {
		// bỏ qua: chỉ là tiện ích
	}
};

// ------------------------------------------------------------------ hộp thoại

/**
 * props: app; subsidiary; period ({id, code, start, end} kỳ đang mở trên màn, có thể null); periods (kỳ của công ty con);
 * employees ([{id, code, name}] nhân viên của kỳ, làm sẵn danh sách chọn); onClose(); onProcess (chạy Xử lý chấm công máy cho
 * kỳ đang mở, null khi không được); onOpenPeriod(id).
 */
export function PunchImportDialog(props) {
	const t = pick(TEXT);
	const app = props.app;
	const subsidiary = String(props.subsidiary || '');
	const [st, setSt] = useState(initialState(remembered()));
	const ref = useRef(st);
	ref.current = st;
	const alive = useRef(true);
	const fileFn = useRef(null);
	const busy = !!(app && app.busy);

	const put = (patch) => {
		if (!alive.current) return;
		ref.current = Object.assign({}, ref.current, typeof patch === 'function' ? patch(ref.current) : patch);
		setSt(ref.current);
	};
	// Lỗi: báo trên dải thông báo (app.run) và giữ một dòng trong hộp thoại (dải thông báo nằm sau lớp phủ)
	const run = (label, promise) =>
		app.run(
			label,
			Promise.resolve(promise).catch((e) => {
				put({error: errorText(e)});
				throw e;
			})
		);

	const loadMappings = (source) => {
		const id = String(source || ref.current.source || '');
		if (!id) return Promise.resolve();
		put({mappings: null, mapFor: id, mapEdits: {}, mapNew: [], error: ''});
		return run(t.map.loading, call({action: ACTIONS.mappings, source: id})).then((r) => {
			if (!alive.current || ref.current.mapFor !== id) return;
			put({mappings: r ? mapMappings(r) : []});
		});
	};

	const loadSources = () => {
		put({error: ''});
		return run(t.loadingSources, call({action: ACTIONS.sources, subsidiary})).then((r) => {
			if (!alive.current) return;
			if (!r) {
				put({sources: ref.current.sources || []});
				return;
			}
			const v = mapSourcesView(r);
			const keep = v.sources.some((s) => s.id === ref.current.source) ? ref.current.source : v.sources.length === 1 ? v.sources[0].id : '';
			put({sources: v.sources, mapCounts: v.mapCounts, recordTypes: v.recordTypes, srcEmployees: v.employees, source: keep});
			if (keep && ref.current.tab === 'map' && ref.current.mapFor !== keep) loadMappings(keep);
		});
	};

	useEffect(() => {
		alive.current = true;
		loadSources();
		return () => {
			alive.current = false;
		};
	}, [subsidiary]);

	// File: đọc bằng FileReader (UTF-8) qua trình nghe "change" gốc (UIF không bắn onChange)
	fileFn.current = (file) => {
		if (!file) return;
		const size = Number(file.size) || 0;
		if (size > MAX_BYTES) {
			put({fileText: '', fileName: file.name, fileBytes: size, lines: 0, fileError: t.tooBig(mb(size)), preview: null, commit: null});
			return;
		}
		try {
			const fr = new FileReader();
			fr.onload = () => {
				const text = String(fr.result || '');
				put({text: '', fileText: text, fileName: file.name, fileBytes: size || utf8Bytes(text), lines: lineCount(text), fileError: '', preview: null, commit: null, assign: {}, error: ''});
			};
			fr.onerror = () => put({fileError: t.fileFailed});
			fr.readAsText(file, 'UTF-8');
		} catch (e) {
			put({fileError: t.fileFailed});
		}
	};
	useEffect(() => {
		try {
			const el = document.getElementById(FILE_ID);
			if (el && !el.__s4vpFile) {
				el.__s4vpFile = true;
				el.addEventListener('change', () => {
					fileFn.current && fileFn.current(el.files && el.files[0]);
					// chọn lại cùng file vẫn đọc lại
					try {
						el.value = '';
					} catch (x) {
						// bỏ qua
					}
				});
			}
		} catch (e) {
			// bỏ qua: vẫn dán được từ Excel
		}
	});

	// ------------------------------------------------------------------ thao tác

	const src = (st.sources || []).find((s) => s.id === st.source) || null;
	const dataText = st.text ? st.text : st.fileText;
	const size = dataText.length;
	const tooBig = size > MAX_TEXT;
	const committing = !!(st.commit && !st.commit.done);

	const pickSource = (id) => {
		remember(id);
		put({source: id, preview: null, commit: null, assign: {}, error: ''});
		if (ref.current.tab === 'map') loadMappings(id);
	};
	const setPaste = (text) => put({text, fileText: text ? '' : ref.current.fileText, fileName: text ? '' : ref.current.fileName, fileError: '', lines: lineCount(text || ref.current.fileText), preview: null, commit: null, assign: {}});

	const preview = () => {
		const cur = ref.current;
		const text = cur.text ? cur.text : cur.fileText;
		if (!cur.source || !text) return Promise.resolve();
		put({error: ''});
		return run(t.previewing, post({action: ACTIONS.preview, source: cur.source, text})).then((r) => {
			if (!r || !alive.current) return;
			// Bỏ kết quả của dữ liệu cũ (người dùng đã đổi nguồn hoặc dữ liệu trong lúc chờ)
			const now = ref.current;
			if (now.source !== cur.source || (now.text ? now.text : now.fileText) !== text) return;
			const v = mapPreview(r);
			const keepAssign = {};
			v.unmatched.forEach((u) => now.assign[u.id] && (keepAssign[u.id] = now.assign[u.id]));
			put({preview: v, commit: null, assign: keepAssign, filter: 'all'});
		});
	};

	const saveUnmatched = () => {
		const cur = ref.current;
		const rows = unmatchedPayload(cur.preview ? cur.preview.unmatched : [], cur.assign, cur.allDevices);
		if (!rows.length) return;
		run(t.unm.saving, post({action: ACTIONS.mapSave, source: cur.source, rows})).then((r) => {
			if (!r || !alive.current) return;
			app.notify(t.unm.saved(Number(r.saved) || rows.length), 'ok');
			const counts = Object.assign({}, ref.current.mapCounts);
			counts[cur.source] = (counts[cur.source] || 0) + (Number(r.saved) || rows.length);
			put({assign: {}, mapCounts: counts, mapFor: ''});
			preview();
		});
	};

	const findEmployees = () => {
		const q = String(ref.current.findQ || '').trim();
		if (!q || !subsidiary) return;
		put({findNote: t.unm.finding});
		call({action: ACTIONS.employees, subsidiary, q}).then(
			(r) => {
				const items = arr(r && r.items).map(mapEmployee).filter((e) => e.id);
				put((s) => ({extraEmployees: s.extraEmployees.concat(items), findNote: items.length ? t.unm.found(items.length) : t.unm.notFound}));
			},
			(e) => put({findNote: errorText(e)})
		);
	};

	const commit = () => {
		const cur = ref.current;
		const text = cur.text ? cur.text : cur.fileText;
		if (!cur.preview || !cur.preview.counts.new || !text) return;
		put({commit: {created: 0, skipped: 0, invalid: 0, unmatched: 0, locked: 0, rounds: 0, done: false}, error: ''});
		const body = {action: ACTIONS.commit, source: cur.source, text};
		app.run(t.progress.writing, runCommit(sendOnce, body, {errorText, onStep: (s) => put({commit: Object.assign(s, {done: false})})})).then((res) => {
			if (!alive.current) return;
			const out = res || Object.assign({}, ref.current.commit, {done: true, stopped: '?'});
			put({commit: out});
			if (out.created && !out.stopped) app.notify(t.progress.writtenNotice(out.created), 'ok');
		});
	};

	const switchTab = (v) => {
		put({tab: v});
		if (v === 'map' && ref.current.source && ref.current.mapFor !== ref.current.source) loadMappings(ref.current.source);
	};

	// Bảng đối chiếu: sửa tại chỗ
	const editMap = (key, field) => (v) => {
		const cur = ref.current;
		if (String(key).indexOf('n') === 0 && cur.mapNew.some((r) => r.key === key)) {
			put({mapNew: cur.mapNew.map((r) => (r.key === key ? Object.assign({}, r, {[field]: v}) : r))});
			return;
		}
		put({mapEdits: Object.assign({}, cur.mapEdits, {[key]: Object.assign({}, cur.mapEdits[key] || {}, {[field]: v})})});
	};
	const addMap = () => {
		const cur = ref.current;
		put({mapNew: cur.mapNew.concat([{key: `n${Date.now()}${cur.mapNew.length}`, id: '', device: '', machineId: '', employee: '', code: '', name: '', effective: '', expiration: ''}])});
	};
	const removeNew = (key) => put({mapNew: ref.current.mapNew.filter((r) => r.key !== key)});
	const saveMappings = () => {
		const cur = ref.current;
		const list = mergeMappings(cur.mappings, cur.mapEdits, cur.mapNew).filter((r) => r.changed);
		if (!list.length || list.some((r) => mappingError(r))) return;
		const rows = list.map((r) => mapSaveRow(r, true));
		run(t.map.saving, post({action: ACTIONS.mapSave, source: cur.source, rows})).then((r) => {
			if (!r || !alive.current) return;
			app.notify(t.map.saved(Number(r.saved) || rows.length), 'ok');
			const delta = list.filter((x) => x.isNew).length - list.filter((x) => x.inactive && !x.isNew).length;
			if (delta) {
				const counts = Object.assign({}, ref.current.mapCounts);
				counts[cur.source] = Math.max(0, (counts[cur.source] || 0) + delta);
				put({mapCounts: counts});
			}
			loadMappings(cur.source).then(() => {
				if (alive.current && ref.current.preview) preview();
			});
		});
	};

	const openSource = (id) => {
		const href = recordHref(st.recordTypes.source, id, (o) => url.resolveRecord(o));
		if (href) window.open(href, '_blank');
	};

	// ------------------------------------------------------------------ vẽ

	const pool = employeeOptions(
		st.srcEmployees,
		props.employees,
		st.preview ? st.preview.employeeList : [],
		st.preview ? st.preview.rows.filter((r) => r.employee).map((r) => ({id: r.employee, code: r.code, name: r.name})) : [],
		(st.mappings || []).map((r) => ({id: r.employee, code: r.code, name: r.name})),
		st.extraEmployees
	);
	const empLabel = {};
	pool.forEach((o) => (empLabel[o.value] = o.label));

	const sourceOptions = (st.sources || []).map((s) => ({value: s.id, label: s.description ? `${s.code} - ${s.description}` : s.code}));
	let sourceInfo = null;
	if (st.sources === null) sourceInfo = <span class="s4vp-small">{t.loadingSources}</span>;
	else if (!st.sources.length) sourceInfo = <span class="s4vp-pi-warn">{t.noSources}</span>;
	else if (src) {
		const parts = [
			t.layouts[src.layout] || src.layout,
			t.idKinds[src.idKind] || src.idKind,
			t.dateFormats[src.dateFormat] || '',
			src.hasHeader ? '' : t.summary.noHeader,
			src.skipLines ? t.summary.skip(src.skipLines) : '',
			src.deviceDefault ? t.summary.device(src.deviceDefault) : '',
			src.minuteOffset ? t.summary.offset(src.minuteOffset) : '',
			t.summary.maps(st.mapCounts[src.id] || 0),
		].filter(Boolean);
		sourceInfo = <span class="s4vp-pi-sum-t">{parts.join(' · ')}</span>;
	}
	const noType = st.recordTypes.source ? '' : t.noRecordType;

	const tabs = (
		<Tabs
			items={[{value: 'import', label: t.tabs.import}, {value: 'map', label: t.tabs.map, count: src ? st.mapCounts[src.id] || 0 : null}]}
			value={st.tab}
			onPick={(v) => !committing && switchTab(v)}
			label={t.tabs.label}
		/>
	);

	const sourceRow = (
		<div class="s4vp-pi-top">
			<Field label={t.source} required={true}>
				<SearchSelect value={st.source} options={sourceOptions} placeholder={t.sourcePh} onInput={pickSource} ariaLabel={t.source} disabled={committing} />
			</Field>
			<div class="s4vp-pi-sum">
				{sourceInfo}
				<div class="s4vp-pi-links">
					<Button kind="link" label={t.createSource} disabled={!!noType} title={noType} onClick={() => openSource('')} />
					{src ? <Button kind="link" label={t.editSource} disabled={!!noType} title={noType} onClick={() => openSource(src.id)} /> : null}
					<Button kind="link" label={t.reloadSources} disabled={busy || committing} onClick={() => loadSources()} />
				</div>
			</div>
		</div>
	);

	// ---- tab Nạp dữ liệu
	const v = st.preview;
	const c = st.commit;
	let importBody;
	{
		const fileHint = st.fileError ? <span class="s4vp-pi-err">{st.fileError}</span> : st.fileName && st.fileText ? t.fileRead(st.fileName, st.lines, mb(st.fileBytes)) : t.fileHint;
		const pasteHint = st.text ? t.pasteRead(st.lines) : st.fileName && st.fileText ? t.usingFile(st.fileName) : t.noData;
		const dataRow = (
			<div class="s4vp-pi-data">
				<Field label={t.file} hint={fileHint}>
					<input id={FILE_ID} type="file" accept=".csv,.txt,.dat,text/csv,text/plain" class="s4vp-in s4vp-pi-file" />
				</Field>
				<Field label={t.paste} hint={pasteHint}>
					<TextArea value={st.text} rows={3} placeholder={t.pastePh} onInput={setPaste} ariaLabel={t.paste} disabled={committing} />
				</Field>
			</div>
		);
		const big = tooBig ? <div class="s4vp-pi-warn" role="alert">{t.tooBig(mb(size))}</div> : null;

		let previewBlock = null;
		let unmatchedBlock = null;
		if (v) {
			const reasonOf = (r) => (r.vi || r.en ? serverText(r.en || r.vi, r.vi || r.en) : '');
			const rows = v.rows
				.filter((r) => st.filter === 'all' || r.status === st.filter)
				.map((r) => Object.assign({}, r, {employeeText: r.employee ? `${r.code || ''} ${r.name || empLabel[r.employee] || ''}`.trim() : '', timeText: `${fmtTime(r.time)}${t.kind[r.kind] ? ` (${t.kind[r.kind]})` : ''}`, statusText: t.status[r.status] || r.status, reason: reasonOf(r)}));
			const chips = [{value: 'all', label: t.status.all, count: num(v.counts.total)}].concat(STATUSES.map((k) => ({value: k, label: t.status[k], count: num(v.counts[k]), tone: k === 'invalid' ? 'error' : k === 'unmatched' || k === 'locked' ? 'warn' : k === 'new' ? 'ok' : ''})));
			previewBlock = (
				<div class="s4vp-pi-sec">
					<div class="s4vp-pi-sub">
						<span>{t.previewTitle}</span>
						{v.range.from ? <span class="s4vp-small">{t.range(fmtDate(v.range.from), fmtDate(v.range.to), num(v.employees))}</span> : null}
					</div>
					{v.truncated ? <div class="s4vp-pi-note">{t.truncated(v.rows.length, v.counts.total)}</div> : null}
					<div class="s4vp-pi-box">
						<Table
							label={t.previewTitle}
							toolbar={<Chips items={chips} value={st.filter} onPick={(x) => put({filter: x})} label={t.cols.status} />}
							columns={[
								{key: 'line', label: t.cols.line, type: 'num', nowrap: true},
								{key: 'machineId', label: t.cols.machineId, nowrap: true},
								{key: 'employeeText', label: t.cols.employee},
								{key: 'timeText', label: t.cols.time, nowrap: true},
								{key: 'device', label: t.cols.device, nowrap: true},
								{key: 'statusText', label: t.cols.status, nowrap: true, render: (r) => <Badge text={r.statusText} tone={TONES[r.status] || 'muted'} />},
								{key: 'reason', label: t.cols.reason, render: (r) => (r.reason ? <span class={r.status === 'invalid' ? 's4vp-pi-err' : 's4vp-small'}>{r.reason}</span> : '')},
							]}
							rows={rows}
							search={true}
							searchPlaceholder={t.search}
							empty={t.noRows}
							maxHeight={260}
						/>
					</div>
				</div>
			);
			if (v.unmatched.length) {
				const chosen = unmatchedPayload(v.unmatched, st.assign, st.allDevices).length;
				const urows = v.unmatched.map((u) => Object.assign({}, u, {firstText: fmtTime(u.firstTime), employeeText: empLabel[st.assign[u.id]] || ''}));
				unmatchedBlock = (
					<div class="s4vp-pi-sec s4vp-pi-unm">
						<div class="s4vp-pi-sub">
							<span>{t.unm.title(v.unmatched.length)}</span>
							<span class="s4vp-actions">
								<Checkbox checked={!!st.allDevices} label={t.unm.allDevices} onInput={(x) => put({allDevices: !!x})} />
								<Button small={true} kind="primary" label={t.unm.save(chosen)} disabled={!chosen || busy || committing} onClick={saveUnmatched} />
							</span>
						</div>
						<div class="s4vp-small">{t.unm.hint}</div>
						<div class="s4vp-pi-find">
							<TextInput value={st.findQ} onInput={(x) => put({findQ: x})} onEnter={findEmployees} placeholder={t.unm.findPh} ariaLabel={t.unm.findPh} width={320} />
							<Button small={true} label={t.unm.find} disabled={!String(st.findQ || '').trim() || !subsidiary} onClick={findEmployees} />
							{st.findNote ? <span class="s4vp-small">{st.findNote}</span> : null}
						</div>
						<div class="s4vp-pi-box s4vp-pi-edit">
							<Table
								label={t.unm.title(v.unmatched.length)}
								columns={[
									{key: 'machineId', label: t.cols.machineId, nowrap: true},
									{key: 'device', label: t.cols.device, nowrap: true},
									{key: 'lines', label: t.cols.lines, type: 'num', nowrap: true},
									{key: 'firstText', label: t.cols.first, nowrap: true},
									{key: 'employeeText', label: t.cols.employee, width: 280, render: (u) => <SearchSelect value={st.assign[u.id] || ''} options={pool} placeholder={t.unm.pick} onInput={(x) => put({assign: Object.assign({}, ref.current.assign, {[u.id]: x})})} ariaLabel={`${t.cols.employee} ${u.machineId}`} width={270} />},
								]}
								rows={urows}
								search={true}
								searchPlaceholder={t.unm.search}
								empty={t.unm.none}
							/>
						</div>
					</div>
				);
			}
		}

		let commitBlock = null;
		if (c) {
			const target = v ? v.counts.new : 0;
			const pct = c.done && !c.stopped && !c.more && !c.stalled ? 100 : target ? Math.min(100, Math.round((c.created / target) * 100)) : 0;
			const periodList = Array.isArray(props.periods) ? props.periods : [];
			const inRange = v ? periodsInRange(periodList, v.range) : [];
			const cur = props.period || null;
			const curIn = cur && (!inRange.length || inRange.some((p) => String(p.id) === String(cur.id)));
			const others = inRange.filter((p) => !cur || String(p.id) !== String(cur.id));
			commitBlock = (
				<div class={cx('s4vp-pi-result', c.stopped ? 's4vp-pi-bad' : c.done ? 's4vp-pi-ok' : '')} role="status" aria-live="polite">
					<div class="s4vp-pi-sub">
						<span>{c.done ? t.progress.done : t.progress.running(c.rounds + 1)}</span>
						{target ? <span class="s4vp-small">{t.progress.of(c.created, target)}</span> : null}
					</div>
					<div class="s4vp-pi-track">
						<div class="s4vp-pi-fill" style={{width: `${pct}%`}} />
					</div>
					<div>{t.progress.counts(c)}</div>
					{c.stopped ? <div class="s4vp-pi-err">{t.progress.stopped(c.stopped)}</div> : null}
					{c.failed ? (
						<div class="s4vp-pi-err">
							<div>{t.progress.failedLines(c.failed)}</div>
							{(c.failures || []).slice(0, 10).map((f, i) => (
								<div key={`f${i}`}>{`${t.progress.line(f.line)}: ${serverText(f.en || f.vi, f.vi || f.en)}`}</div>
							))}
						</div>
					) : null}
					{c.stalled ? <div class="s4vp-pi-warn">{t.progress.stalled}</div> : null}
					{c.done && !c.stopped && !c.stalled && c.more ? <div class="s4vp-pi-warn">{t.progress.incomplete}</div> : null}
					{c.done && !c.stopped && c.created ? (
						<div class="s4vp-pi-next">
							<div>{t.progress.next}</div>
							<div class="s4vp-pi-links">
								{curIn && props.onProcess ? <Button kind="primary" small={true} label={t.progress.process(cur.code)} disabled={busy} onClick={() => props.onProcess()} /> : null}
								{others.length ? <span class="s4vp-small">{t.progress.otherPeriods}</span> : null}
								{others.map((p) => (props.onOpenPeriod ? <Button key={`p${p.id}`} small={true} label={t.progress.openPeriod(p.code)} onClick={() => props.onOpenPeriod(String(p.id))} /> : null))}
							</div>
							{curIn && props.onProcess ? null : <div class="s4vp-small">{t.progress.noProcess}</div>}
						</div>
					) : null}
				</div>
			);
		}

		importBody = [sourceRow, dataRow, big, previewBlock, unmatchedBlock, commitBlock];
	}

	// ---- tab Đối chiếu mã chấm công
	let mapBody;
	const merged = st.mappings ? mergeMappings(st.mappings, st.mapEdits, st.mapNew) : [];
	const changed = merged.filter((r) => r.changed);
	const badCount = changed.filter((r) => mappingError(r)).length;
	if (!st.source || !src) mapBody = [sourceRow, <Empty text={t.map.noSource} />];
	else if (st.mappings === null) mapBody = [sourceRow, <Empty text={t.map.loading} />];
	else {
		const rows = merged.map((r) => Object.assign({}, r, {employeeText: empLabel[r.employee] || `${r.code} ${r.name}`.trim(), deviceText: r.device || t.map.anyDevice, effectiveText: fmtDate(r.effective), expirationText: fmtDate(r.expiration)}));
		mapBody = [
			sourceRow,
			<div class="s4vp-pi-sec">
				<div class="s4vp-pi-sub">
					<span>{t.map.title(src.code)}</span>
					<span class="s4vp-actions">
						<Button small={true} label={t.map.add} disabled={busy} onClick={addMap} />
						<Button small={true} kind="ghost" label={t.map.reload} disabled={busy} onClick={() => loadMappings(st.source)} />
						<Button small={true} kind="primary" label={t.map.save(changed.length)} disabled={!changed.length || !!badCount || busy} title={badCount ? t.map.fixFirst : ''} onClick={saveMappings} />
					</span>
				</div>
				<div class="s4vp-small">{t.map.hint}</div>
				<div class="s4vp-pi-box s4vp-pi-edit">
					<Table
						label={t.map.title(src.code)}
						keyOf={(r) => r.key}
						columns={[
							{key: 'machineId', label: t.cols.machineId, nowrap: true, render: (r) => (r.isNew ? <TextInput value={r.machineId} onInput={editMap(r.key, 'machineId')} ariaLabel={t.cols.machineId} width={130} /> : r.machineId)},
							{key: 'deviceText', label: t.cols.device, nowrap: true, render: (r) => (r.isNew ? <TextInput value={r.device} onInput={editMap(r.key, 'device')} placeholder={t.map.anyDevice} ariaLabel={t.cols.device} width={120} /> : r.deviceText)},
							{key: 'employeeText', label: t.cols.employee, width: 280, render: (r) => <SearchSelect value={r.employee} options={pool} placeholder={t.unm.pick} onInput={editMap(r.key, 'employee')} ariaLabel={`${t.cols.employee} ${r.machineId}`} width={270} />},
							{key: 'effectiveText', label: t.cols.effective, nowrap: true, render: (r) => <DateInput value={r.effective} onInput={editMap(r.key, 'effective')} ariaLabel={t.cols.effective} width={150} />},
							{key: 'expirationText', label: t.cols.expiration, nowrap: true, render: (r) => <DateInput value={r.expiration} min={r.effective || undefined} onInput={editMap(r.key, 'expiration')} ariaLabel={t.cols.expiration} width={150} />},
							{
								key: 'state',
								label: t.cols.state,
								render: (r) => {
									const err = r.changed ? mappingError(r) : '';
									const note = err ? <span class="s4vp-pi-err">{t.map.errors[err]}</span> : r.isNew ? Badge({text: t.map.isNew, tone: 'info'}) : r.inactive ? Badge({text: t.map.inactive, tone: 'error'}) : r.changed ? Badge({text: t.map.changed, tone: 'warn'}) : null;
									let act;
									if (r.isNew) act = <Button small={true} kind="ghost" label={t.map.remove} onClick={() => removeNew(r.key)} />;
									else if (r.inactive) act = <Button small={true} kind="ghost" label={t.map.undo} onClick={() => editMap(r.key, 'inactive')(false)} />;
									else act = <Button small={true} kind="ghost" label={t.map.deactivate} onClick={() => editMap(r.key, 'inactive')(true)} />;
									return (
										<span class="s4vp-actions">
											{note}
											{act}
										</span>
									);
								},
							},
						]}
						rows={rows}
						search={true}
						searchPlaceholder={t.map.search}
						empty={t.map.empty}
					/>
				</div>
			</div>,
		];
	}

	// ---- khung, nút chân
	const stepState = (k) => {
		if (k === 'pick') return v ? 'done' : 'current';
		if (k === 'preview') return !v ? 'todo' : c ? 'done' : 'current';
		return c && c.done && !c.stopped && !c.more && !c.stalled ? 'done' : c ? 'current' : 'todo';
	};
	const steps = <Stepper steps={['pick', 'preview', 'commit'].map((k) => ({key: k, label: t.steps[k], state: stepState(k)}))} label={t.steps.label} />;

	let why = '';
	if (!st.source) why = t.needSource;
	else if (!dataText) why = t.needData;
	else if (tooBig) why = t.tooBig(mb(size));
	const newCount = v ? v.counts.new : 0;
	let commitWhy = why;
	if (!commitWhy && !v) commitWhy = t.needPreview;
	else if (!commitWhy && !newCount) commitWhy = t.nothingNew;
	const close = () => !committing && props.onClose && props.onClose();
	const finished = c && c.done && !c.stopped && !c.more && !c.stalled;
	const actions =
		st.tab === 'import'
			? [
					<Button label={t.close} disabled={committing} title={committing ? t.running : ''} onClick={close} />,
					<Button label={v ? t.previewAgain : t.preview} kind={v ? 'default' : 'primary'} disabled={!!why || busy || committing} title={why} onClick={() => preview()} />,
					finished ? null : <Button label={t.commit(newCount)} kind={v && newCount ? 'primary' : 'default'} disabled={!!commitWhy || busy || committing} title={commitWhy} onClick={commit} />,
			  ]
			: [<Button label={t.close} onClick={close} />];

	return (
		<Dialog title={t.title} width={1180} onClose={close} actions={actions}>
			{tabs}
			{st.tab === 'import' ? steps : null}
			{st.error ? <div class="s4vp-pi-err" role="alert">{st.error}</div> : null}
			{(st.tab === 'import' ? importBody : mapBody).map((n, i) => (n ? <div key={`b${i}`} style={{display: 'contents'}}>{n}</div> : null))}
		</Dialog>
	);
}

/** Nhãn nút mở hộp thoại (màn Chấm công đặt ở hàng tiêu đề). */
export const buttonLabel = () => pick(TEXT).button;
