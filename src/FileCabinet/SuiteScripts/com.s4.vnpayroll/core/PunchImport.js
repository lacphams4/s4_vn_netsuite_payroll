/**
 * Đọc file máy chấm công theo hồ sơ nguồn (docs/PUNCH_IMPORT.md mục 2). Thuần, không gọi N/*; lớp api/PunchImport đọc ghi record.
 *
 * parseText(text, profile) -> {rows: [{line, machineId, device, time: 'YYYY-MM-DD HH:mm', kind: 'in'|'out'|''}],
 *                              errors: [{line, vi, en}], header: [..], fatal?: {vi, en}}
 *   profile là dòng punch_source theo tên logic (Store.find): layout, has_header, skip_lines, delimiter, col_emp, col_datetime,
 *   col_date, col_time, col_in, col_out, col_device, date_format, id_kind, device_default, minute_offset.
 *   fatal: lỗi cấp file (không thấy cột trên dòng tiêu đề, thiếu khai cột...) - không đọc được dòng nào.
 * resolveEmployees(rows, {mappings, employeesByCode, employeeIds, idKind}) -> rows + {employee|null, how: 'map'|'code'|null}
 * dedupe(rows, existingKeys) -> rows + {status: 'new'|'duplicate'|null, dupLine}  (khóa employee|time; trùng trong file cũng là
 *   duplicate, dupLine = dòng xuất hiện trước trong file, null khi trùng lượt chấm đã có; dòng chưa có nhân viên: status null)
 *
 * Quy tắc đọc:
 * - CSV có ngoặc kép (dấu phân cách, xuống dòng trong ô, "" là một dấu "), BOM, CRLF / CR; dòng trống bỏ qua. Ngoặc kép không đóng
 *   thì đọc lại theo từng dòng vật lý (một dòng hỏng không nuốt phần còn lại của file).
 * - Dấu phân cách A: đếm tab, chấm phẩy, phẩy (ngoài ngoặc kép) trên dòng đầu tiên có dữ liệu; nhiều nhất thắng, bằng nhau thì
 *   tab > chấm phẩy > phẩy; không có dấu nào thì phẩy.
 * - Cột: tên trên dòng tiêu đề (chữ thường, bỏ dấu tiếng Việt, đ thành d, gộp khoảng trắng) hoặc số thứ tự từ 1 (số luôn là số cột).
 * - Ngày: phần đầu 4 chữ số luôn là năm-tháng-ngày; còn lại theo date_format (DMY mặc định; YMD mà năm đứng cuối thì hiểu DMY);
 *   năm 2 chữ số là 20yy; yyyyMMdd; số ngày kiểu Excel (serial 20000 - 80000, phần thập phân là giờ).
 * - Giờ: HH:mm[:ss], H:mm, 7h30, 7.30, AM/PM (cả SA / CH của Windows tiếng Việt), phần ngày kiểu Excel (0,3319); giây bị bỏ.
 *   Ô giờ có kèm ngày (xuất từ Excel) thì lấy phần giờ; layout P dùng cả phần ngày nếu năm từ 1950.
 * - Layout Z (ZKTeco attlog): tab, không tiêu đề, cột 1 mã, cột 2 thời điểm, các cột sau bỏ qua.
 * - Layout P: giờ ra nhỏ hơn giờ vào (cùng ngày) thì giờ ra thuộc ngày hôm sau; ô giờ trống thì bỏ lượt đó.
 * - minute_offset cộng sau khi đọc (có thể sang ngày khác). Ngày không tồn tại, giờ > 23:59 là lỗi dòng.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Dates"], (Dates) => {
	const blank = (v) => v === null || v === undefined || String(v).trim() === "";
	const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
	const DELIMS = { C: ",", S: ";", T: "\t" };
	const SERIAL_MIN = 20000;
	const SERIAL_MAX = 80000;
	// Số ngày từ 1899-12-30 (gốc serial Excel hệ 1900) đến 1970-01-01
	const SERIAL_EPOCH = 25569;
	const MAX_ID = 100;

	const err = (line, vi, en) => ({ line, vi, en });

	// ------------------------------------------------------------------ chuẩn hóa

	/** Tên cột để so: chữ thường, bỏ dấu tiếng Việt, đ -> d, gộp khoảng trắng. */
	function normalizeName(s) {
		let t = str(s).replace(/^﻿/, "").toLowerCase().replace(/đ/g, "d");
		if (typeof t.normalize === "function") t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
		return t.replace(/\s+/g, " ").trim();
	}

	/** Khóa so mã chấm công với bảng đối chiếu: bỏ khoảng trắng hai đầu, chữ hoa; mã toàn số bỏ số 0 đứng đầu. */
	function machineKey(s) {
		const t = str(s).toUpperCase();
		return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, "") : t;
	}

	/** Thiết bị để so (trống = mọi máy). */
	const deviceKey = (s) => str(s).toUpperCase();

	// ------------------------------------------------------------------ CSV

	/**
	 * Tách text thành bản ghi theo dấu phân cách. {records: [{line, cells}], unterminated: số dòng | 0}.
	 * singleLine: xuống dòng luôn kết thúc bản ghi kể cả trong ngoặc kép (đọc lại khi ngoặc kép không đóng).
	 */
	function splitRecords(text, delim, singleLine) {
		const s = String(text || "").replace(/^﻿/, "");
		const out = [];
		let cells = [];
		let cell = "";
		let quoted = false;
		let line = 1;
		let start = 1;
		const endRecord = () => {
			cells.push(cell);
			out.push({ line: start, cells });
			cells = [];
			cell = "";
		};
		for (let i = 0; i < s.length; i++) {
			const c = s[i];
			if (quoted) {
				if (c === '"') {
					if (s[i + 1] === '"') {
						cell += '"';
						i++;
					} else quoted = false;
					continue;
				}
				if (c === "\r" || c === "\n") {
					if (c === "\r" && s[i + 1] === "\n") i++;
					if (singleLine) {
						quoted = false;
						endRecord();
						line++;
						start = line;
						continue;
					}
					line++;
					cell += "\n";
					continue;
				}
				cell += c;
				continue;
			}
			if (c === '"' && cell.trim() === "") {
				quoted = true;
				cell = "";
				continue;
			}
			if (c === delim) {
				cells.push(cell);
				cell = "";
				continue;
			}
			if (c === "\r" || c === "\n") {
				if (c === "\r" && s[i + 1] === "\n") i++;
				endRecord();
				line++;
				start = line;
				continue;
			}
			cell += c;
		}
		const unterminated = quoted ? start : 0;
		if (cell !== "" || cells.length) endRecord();
		return { records: out, unterminated };
	}

	/** Dấu phân cách theo một dòng: đếm tab, chấm phẩy, phẩy ngoài ngoặc kép. */
	function detectDelimiter(line) {
		const n = { "\t": 0, ";": 0, ",": 0 };
		let quoted = false;
		for (const c of String(line || "")) {
			if (c === '"') quoted = !quoted;
			else if (!quoted && n[c] !== undefined) n[c]++;
		}
		let best = ",";
		let max = 0;
		for (const d of ["\t", ";", ","]) {
			if (n[d] > max) {
				max = n[d];
				best = d;
			}
		}
		return best;
	}

	const isBlankRecord = (r) => r.cells.every((c) => str(c) === "");

	// ------------------------------------------------------------------ ngày giờ

	function validDate(y, m, d) {
		if (!(y >= 1900 && y <= 2199) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= Dates.daysInMonth(y, m))) return null;
		return Dates.ymd(y, m, d);
	}

	const isSerial = (s) => /^\d+(?:[.,]\d+)?$/.test(s) && Number(s.replace(",", ".")) >= SERIAL_MIN && Number(s.replace(",", ".")) < SERIAL_MAX;

	/** Serial Excel -> {date, minutes|null}; minutes null khi không có phần thập phân. */
	function fromSerial(s) {
		const v = Number(s.replace(",", "."));
		const days = Math.floor(v);
		const frac = v - days;
		const date = Dates.fromDay(days - SERIAL_EPOCH);
		return { date, minutes: /[.,]/.test(s) ? fractionMinutes(frac) : null };
	}

	/** Phần ngày (0 <= f < 1) -> phút, làm tròn đến giây trước rồi bỏ giây (0,33333 không thành 07:59). */
	function fractionMinutes(f) {
		const sec = Math.round(f * 86400);
		return sec >= 86400 ? null : Math.floor(sec / 60);
	}

	/**
	 * Ô ngày -> 'YYYY-MM-DD'; null nếu sai. Không nhận giờ (dùng parseDateTime cho ô có giờ).
	 * @param {string} s
	 * @param {'YMD'|'DMY'|'MDY'} fmt
	 */
	function parseDate(s, fmt) {
		const t = str(s);
		if (!t) return null;
		if (/^\d{8}$/.test(t) && !isSerial(t)) return validDate(+t.slice(0, 4), +t.slice(4, 6), +t.slice(6, 8));
		if (isSerial(t)) return /[.,]/.test(t) ? null : fromSerial(t).date;
		const m = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/.exec(t);
		if (!m) return null;
		if (m[1].length === 4) return validDate(+m[1], +m[2], +m[3]);
		if (m[3].length !== 4 && m[3].length !== 2) return null;
		const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
		return fmt === "MDY" ? validDate(y, +m[1], +m[2]) : validDate(y, +m[2], +m[1]);
	}

	/** Ô giờ -> phút trong ngày (0 - 1439); null nếu sai. Nhận AM/PM, SA/CH, phần ngày Excel, serial có giờ (lấy phần giờ). */
	function parseTime(s) {
		let t = str(s).toUpperCase().replace(/\s+/g, " ");
		if (!t) return null;
		if (/^(?:0?[.,]\d+|0)$/.test(t)) return fractionMinutes(Number(t.replace(",", ".")));
		if (isSerial(t)) return /[.,]/.test(t) ? fromSerial(t).minutes : null;
		let half = null;
		const ap = /\s*(A\.?M\.?|P\.?M\.?|SA|CH|SÁNG|CHIỀU)$/.exec(t);
		if (ap) {
			half = /^(A|SA|SÁNG)/.test(ap[1]) ? "AM" : "PM";
			t = t.slice(0, ap.index).trim();
		}
		const m = /^(\d{1,2})(?:[:H.](\d{2}))?(?:[:.](\d{2})(?:[.,]\d+)?)?$/.exec(t);
		if (!m || (m[2] === undefined && half === null && !/H$/.test(t))) {
			// "7h" (không phút) chỉ nhận khi có chữ h; số trần "7" không phải giờ trừ khi có AM/PM
			const h = /^(\d{1,2})H$/.exec(t);
			if (!h) return null;
			return +h[1] <= 23 ? +h[1] * 60 : null;
		}
		let hh = +m[1];
		const mm = m[2] === undefined ? 0 : +m[2];
		const ss = m[3] === undefined ? 0 : +m[3];
		if (mm > 59 || ss > 59) return null;
		if (half) {
			if (hh < 1 || hh > 12) return null;
			hh = half === "AM" ? hh % 12 : (hh % 12) + 12;
		}
		if (hh > 23) return null;
		return hh * 60 + mm;
	}

	/**
	 * Ô ngày giờ -> {date, minutes|null} (minutes null: ô chỉ có ngày); null nếu sai.
	 * Nhận 'ngày giờ', 'ngàyTgiờ', serial Excel có phần thập phân.
	 */
	function parseDateTime(s, fmt) {
		const t = str(s).replace(/\s+/g, " ");
		if (!t) return null;
		if (isSerial(t)) return fromSerial(t);
		const m = /^(\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}|\d{8})(?:[ T](.+))?$/.exec(t);
		if (!m) return null;
		const date = parseDate(m[1], fmt);
		if (!date) return null;
		if (m[2] === undefined) return { date, minutes: null };
		const minutes = parseTime(m[2].replace(/(?:Z|[+-]\d{2}:?\d{2})$/, ""));
		return minutes === null ? null : { date, minutes };
	}

	/**
	 * Ô giờ của layout E (cột giờ riêng) và P: giờ thuần, hoặc ngày + giờ (xuất từ Excel). {minutes, date|null}; null nếu sai.
	 * date chỉ có khi phần ngày hợp lệ và năm từ 1950 (bỏ ngày gốc 1899-12-30 của ô chỉ có giờ).
	 */
	function parseTimeCell(s, fmt) {
		const t = str(s);
		const plain = parseTime(t);
		if (plain !== null) {
			// serial có phần ngày: giữ cả ngày
			if (isSerial(t)) return { minutes: plain, date: fromSerial(t).date };
			return { minutes: plain, date: null };
		}
		const m = /^(.+?)[ T]+(\d{1,2}[:hH.]\d{2}.*)$/.exec(t);
		if (!m) return null;
		const minutes = parseTime(m[2]);
		if (minutes === null) return null;
		const date = parseDate(m[1], fmt);
		return { minutes, date: date && +date.slice(0, 4) >= 1950 ? date : null };
	}

	/** Ngày + phút (+ lệch phút) -> 'YYYY-MM-DD HH:mm'. */
	function stamp(date, minutes, offset) {
		const total = minutes + (Number(offset) || 0);
		const shiftDays = Math.floor(total / 1440);
		const m = total - shiftDays * 1440;
		return `${shiftDays ? Dates.addDays(date, shiftDays) : date} ${Dates.pad(Math.floor(m / 60))}:${Dates.pad(m % 60)}`;
	}

	// ------------------------------------------------------------------ hồ sơ

	function settings(profile) {
		const p = profile || {};
		const layout = ["E", "P", "Z"].includes(str(p.layout).toUpperCase()) ? str(p.layout).toUpperCase() : "E";
		const hasHeader = layout === "Z" ? false : !(p.has_header === false || p.has_header === "F" || p.has_header === "false");
		const fmt = ["YMD", "DMY", "MDY"].includes(str(p.date_format).toUpperCase()) ? str(p.date_format).toUpperCase() : "DMY";
		const skip = Math.max(0, Math.floor(Number(p.skip_lines) || 0));
		const offset = Math.trunc(Number(p.minute_offset) || 0);
		const delim = layout === "Z" ? "T" : ["A", "C", "S", "T"].includes(str(p.delimiter).toUpperCase()) ? str(p.delimiter).toUpperCase() : "A";
		return { layout, hasHeader, fmt, skip, offset, delim, deviceDefault: str(p.device_default) };
	}

	const LABEL = {
		col_emp: ["cột mã chấm công", "attendance ID column"], col_datetime: ["cột ngày giờ", "date time column"], col_date: ["cột ngày", "date column"],
		col_time: ["cột giờ", "time column"], col_in: ["cột giờ vào", "in time column"], col_out: ["cột giờ ra", "out time column"], col_device: ["cột thiết bị", "device column"],
	};

	/**
	 * Vị trí cột (0-based) theo khai báo; -1 nếu không khai. Ném {vi, en} khi khai tên mà file không có tiêu đề / không thấy cột.
	 */
	function columnIndex(profile, key, header) {
		const spec = str(profile && profile[key]);
		if (!spec) return -1;
		if (/^\d+$/.test(spec)) {
			if (+spec < 1) throw { vi: `Số cột của ${LABEL[key][0]} phải từ 1`, en: `The ${LABEL[key][1]} number must start at 1` };
			return +spec - 1;
		}
		if (!header) throw { vi: `File không có dòng tiêu đề nên ${LABEL[key][0]} phải ghi bằng số thứ tự (1, 2...)`, en: `The file has no header line, so the ${LABEL[key][1]} must be a column number (1, 2...)` };
		const want = normalizeName(spec);
		const i = header.findIndex((h) => normalizeName(h) === want);
		if (i < 0) throw { vi: `Không thấy ${LABEL[key][0]} "${spec}" trên dòng tiêu đề`, en: `The ${LABEL[key][1]} "${spec}" is not on the header line` };
		return i;
	}

	// ------------------------------------------------------------------ parseText

	/**
	 * Đọc text theo hồ sơ nguồn.
	 * @returns {{rows: Array<{line, machineId, device, time, kind}>, errors: Array<{line, vi, en}>, header: string[], fatal?: {vi, en}}}
	 */
	function parseText(text, profile) {
		const cfg = settings(profile);
		const raw = String(text === null || text === undefined ? "" : text).replace(/^﻿/, "");
		const physical = raw.split(/\r\n|\r|\n/);
		// Bỏ skip dòng vật lý đầu; dòng đầu tiên có dữ liệu sau đó dùng để nhận dấu phân cách
		let delim = DELIMS[cfg.delim];
		if (!delim) {
			const first = physical.slice(cfg.skip).find((l) => l.trim() !== "");
			delim = detectDelimiter(first || "");
		}
		let split = splitRecords(raw, delim, false);
		const errors = [];
		if (split.unterminated) {
			errors.push(err(split.unterminated, "Dấu ngoặc kép không đóng; dòng được đọc riêng từng dòng", "Unclosed quote; lines were read one by one"));
			split = splitRecords(raw, delim, true);
		}
		const records = split.records.filter((r) => r.line > cfg.skip && !isBlankRecord(r));
		let header = [];
		let body = records;
		if (cfg.hasHeader) {
			if (!records.length) return { rows: [], errors, header: [] };
			header = records[0].cells.map((c) => str(c));
			body = records.slice(1);
		}
		const out = { rows: [], errors, header };
		const col = {};
		try {
			if (cfg.layout === "Z") {
				Object.assign(col, { col_emp: 0, col_datetime: 1, col_date: -1, col_time: -1, col_in: -1, col_out: -1, col_device: -1 });
			} else {
				for (const k of Object.keys(LABEL)) col[k] = columnIndex(profile, k, cfg.hasHeader ? header : null);
				if (col.col_emp < 0) throw { vi: "Hồ sơ nguồn chưa khai cột mã chấm công", en: "The source profile has no attendance ID column" };
				if (cfg.layout === "E" && col.col_datetime < 0 && col.col_date < 0) throw { vi: "Hồ sơ nguồn chưa khai cột ngày giờ (hoặc cột ngày và cột giờ)", en: "The source profile has no date time column (or date and time columns)" };
				if (cfg.layout === "P" && (col.col_date < 0 || (col.col_in < 0 && col.col_out < 0))) throw { vi: "Layout P cần cột ngày, cột giờ vào và cột giờ ra", en: "Layout P needs the date, in time and out time columns" };
			}
		} catch (e) {
			out.fatal = { vi: e.vi || String(e.message || e), en: e.en || String(e.message || e) };
			return out;
		}
		const cell = (r, i) => (i < 0 ? "" : str(r.cells[i]));
		const push = (r, id, date, minutes, kind) => {
			out.rows.push({ line: r.line, machineId: id, device: (col.col_device >= 0 ? cell(r, col.col_device) : "") || cfg.deviceDefault, time: stamp(date, minutes, cfg.offset), kind });
		};
		for (const r of body) {
			let cells = r.cells;
			if (cfg.layout === "Z" && cells.length < 2) {
				// attlog không có tab (khoảng trắng): mã, rồi ngày và giờ
				const m = /^\s*(\S+)\s+(\S+\s+\S+)/.exec(cells.join(" "));
				cells = m ? [m[1], m[2]] : cells;
			}
			const row = { line: r.line, cells };
			const id = cell(row, col.col_emp).replace(/\s+/g, " ").slice(0, MAX_ID);
			if (cfg.layout === "P") {
				const dateText = cell(row, col.col_date);
				const inText = cell(row, col.col_in);
				const outText = cell(row, col.col_out);
				if (!inText && !outText) continue;
				if (!id) {
					errors.push(err(r.line, "Thiếu mã chấm công", "Missing attendance ID"));
					continue;
				}
				const inT = inText ? parseTimeCell(inText, cfg.fmt) : null;
				const outT = outText ? parseTimeCell(outText, cfg.fmt) : null;
				if (inText && !inT) {
					errors.push(err(r.line, `Giờ vào "${inText}" không hợp lệ`, `Invalid in time "${inText}"`));
					continue;
				}
				if (outText && !outT) {
					errors.push(err(r.line, `Giờ ra "${outText}" không hợp lệ`, `Invalid out time "${outText}"`));
					continue;
				}
				let base = null;
				if (dateText) {
					const dt = parseDateTime(dateText, cfg.fmt);
					if (!dt) {
						errors.push(err(r.line, `Ngày "${dateText}" không hợp lệ`, `Invalid date "${dateText}"`));
						continue;
					}
					base = dt.date;
				}
				base = base || (inT && inT.date) || (outT && outT.date);
				if (!base) {
					errors.push(err(r.line, "Thiếu ngày", "Missing date"));
					continue;
				}
				const inDate = (inT && inT.date) || base;
				let outDate = (outT && outT.date) || base;
				// Ca đêm: giờ ra (không kèm ngày) sớm hơn giờ vào cùng ngày thì sang ngày hôm sau
				if (inT && outT && !outT.date && outDate === inDate && outT.minutes < inT.minutes) outDate = Dates.addDays(inDate, 1);
				if (inT) push(row, id, inDate, inT.minutes, "in");
				if (outT) push(row, id, outDate, outT.minutes, "out");
				continue;
			}
			// Layout E và Z
			let date = null;
			let minutes = null;
			if (col.col_datetime >= 0) {
				const text = cell(row, col.col_datetime);
				if (!text) continue;
				if (!id) {
					errors.push(err(r.line, "Thiếu mã chấm công", "Missing attendance ID"));
					continue;
				}
				const dt = parseDateTime(text, cfg.layout === "Z" ? "YMD" : cfg.fmt);
				if (!dt || dt.minutes === null) {
					errors.push(err(r.line, `Ngày giờ "${text}" không hợp lệ`, `Invalid date time "${text}"`));
					continue;
				}
				date = dt.date;
				minutes = dt.minutes;
			} else {
				const dateText = cell(row, col.col_date);
				const timeText = col.col_time >= 0 ? cell(row, col.col_time) : "";
				if (col.col_time >= 0 ? !timeText : !dateText) continue;
				if (!id) {
					errors.push(err(r.line, "Thiếu mã chấm công", "Missing attendance ID"));
					continue;
				}
				const dt = dateText ? parseDateTime(dateText, cfg.fmt) : null;
				if (dateText && !dt) {
					errors.push(err(r.line, `Ngày "${dateText}" không hợp lệ`, `Invalid date "${dateText}"`));
					continue;
				}
				if (col.col_time >= 0) {
					const t = parseTimeCell(timeText, cfg.fmt);
					if (!t) {
						errors.push(err(r.line, `Giờ "${timeText}" không hợp lệ`, `Invalid time "${timeText}"`));
						continue;
					}
					date = dt ? dt.date : t.date;
					minutes = t.minutes;
					if (!date) {
						errors.push(err(r.line, "Thiếu ngày", "Missing date"));
						continue;
					}
				} else {
					if (dt.minutes === null) {
						errors.push(err(r.line, `Ô ngày "${dateText}" không có giờ`, `The date cell "${dateText}" has no time`));
						continue;
					}
					date = dt.date;
					minutes = dt.minutes;
				}
			}
			push(row, id, date, minutes, "");
		}
		return out;
	}

	// ------------------------------------------------------------------ đối chiếu nhân viên

	/** Dòng đối chiếu hiệu lực tại ngày d cho mã + thiết bị: dòng cùng máy trước, rồi dòng máy trống; nhiều dòng thì hiệu lực muộn nhất. */
	function mappingFor(index, machineId, device, d) {
		const list = index.get(machineKey(machineId)) || [];
		const live = list.filter((m) => (blank(m.effective) || Dates.cmp(m.effective, d) <= 0) && (blank(m.expiration) || Dates.cmp(m.expiration, d) >= 0));
		const dev = deviceKey(device);
		const own = dev ? live.filter((m) => deviceKey(m.device) === dev) : [];
		const pool = own.length ? own : live.filter((m) => !deviceKey(m.device));
		let best = null;
		for (const m of pool) if (!best || (m.effective || "") > (best.effective || "")) best = m;
		return best;
	}

	/**
	 * Gán nhân viên cho từng dòng.
	 * @param {Array} rows kết quả parseText().rows
	 * @param {{mappings: Array<{device, machineId, employee, effective, expiration}>, employeesByCode: Object<string,string>,
	 *          employeeIds: string[]|Set<string>, idKind: 'N'|'M'|'B'}} ctx
	 *   employeesByCode: khóa là mã nhân viên chữ hoa; employeeIds: id nội bộ có thật - chỉ dùng với idKind N (mã trùng id nội bộ
 *   thì id thắng, như importPunches); idKind B sau bảng đối chiếu chỉ tra mã nhân viên (entityid).
	 */
	function resolveEmployees(rows, ctx) {
		const c = ctx || {};
		const kind = ["N", "M", "B"].includes(str(c.idKind).toUpperCase()) ? str(c.idKind).toUpperCase() : "B";
		const index = new Map();
		for (const m of c.mappings || []) {
			if (!m || blank(m.machineId) || blank(m.employee)) continue;
			const k = machineKey(m.machineId);
			if (!index.has(k)) index.set(k, []);
			index.get(k).push(m);
		}
		const ids = c.employeeIds instanceof Set ? c.employeeIds : new Set((c.employeeIds || []).map(String));
		const byCode = c.employeesByCode || {};
		// N: id nội bộ hoặc mã nhân viên (id thắng, như importPunches); B: chỉ mã nhân viên (mã số của máy chấm công không bị hiểu
		// nhầm thành id nội bộ của người khác)
		const byCodeOf = (v) => {
			const t = str(v);
			if (kind === "N" && ids.has(t)) return t;
			const hit = byCode[t.toUpperCase()];
			return hit === undefined || hit === null ? null : String(hit);
		};
		return (rows || []).map((r) => {
			let employee = null;
			let how = null;
			if (kind !== "N") {
				const m = mappingFor(index, r.machineId, r.device, String(r.time).slice(0, 10));
				if (m) {
					employee = String(m.employee);
					how = "map";
				}
			}
			if (!employee && kind !== "M") {
				employee = byCodeOf(r.machineId);
				if (employee) how = "code";
			}
			return Object.assign({}, r, { employee, how });
		});
	}

	/**
	 * Đánh dấu trùng theo khóa employee|time (phút). existingKeys: lượt chấm đã có (mảng hoặc Set).
	 * Dòng chưa có nhân viên giữ status null.
	 */
	function dedupe(rows, existingKeys) {
		const have = existingKeys instanceof Set ? existingKeys : new Set(existingKeys || []);
		const firstLine = new Map();
		return (rows || []).map((r) => {
			if (blank(r.employee)) return Object.assign({}, r, { status: null, dupLine: null });
			const k = `${r.employee}|${r.time}`;
			if (have.has(k)) return Object.assign({}, r, { status: "duplicate", dupLine: null });
			if (firstLine.has(k)) return Object.assign({}, r, { status: "duplicate", dupLine: firstLine.get(k) });
			firstLine.set(k, r.line);
			return Object.assign({}, r, { status: "new", dupLine: null });
		});
	}

	return {
		parseText, resolveEmployees, dedupe,
		// phần dưới cho api và test
		normalizeName, machineKey, splitRecords, detectDelimiter, parseDate, parseTime, parseDateTime, parseTimeCell, stamp, settings,
	};
});
