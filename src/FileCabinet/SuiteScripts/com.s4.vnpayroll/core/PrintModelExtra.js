/**
 * Mô hình in bổ sung (tương ứng các báo cáo VP642000, VP644100 / VP644110 / VP644010, VP645000 / VP645010, VP646000,
 * VP647000 - VP647020 của gói Acumatica): bảng chấm công tháng, bảng kê xác nhận thù lao cộng tác viên, bảng chia lương
 * tổ, bảng hoa hồng, phiếu thông tin hợp đồng lao động / phụ lục / quyết định nhân sự.
 *
 * Cùng quy ước với core/PrintModel: template Advanced PDF không dùng điều kiện trên dữ liệu, mọi số và nhãn đã định dạng
 * thành chuỗi ở đây; phần có / không có là danh sách 0..n phần tử; ngắt trang là danh sách `breaks` (rỗng ở trang cuối).
 * Mọi mô hình trả `count` (số dòng / số trang dữ liệu): Suitelet in báo "không có dữ liệu" khi count = 0.
 *
 * Phiếu thông tin hợp đồng / quyết định KHÔNG phải mẫu văn bản pháp lý: chỉ tóm tắt các trường của bản ghi, không có điều
 * khoản; dòng ghi chú nói rõ điều đó được in trên phiếu.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./PrintModel", "./Money", "./Dates", "./VietnameseNumberReader"], (Base, Money, Dates, Words) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();
	const num = (v) => (blank(v) || isNaN(Number(v)) ? 0 : Number(v));
	const h2 = (v) => Money.roundTo(num(v), 2);
	const money = Base.money;
	const qty = Base.qty;
	const vnDate = Base.vnDate;
	const T = Base.T;
	const BREAK = [{}];

	/** Số tối đa 4 số lẻ (khối lượng, hệ số), dấu phẩy thập phân, 0 hiện "-". */
	function qty4(v) {
		const n = Money.roundTo(num(v), 4);
		if (n === 0) return "-";
		const [i, d] = String(Math.abs(n)).split(".");
		const s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (d ? `,${d}` : "");
		return n < 0 ? `-${s}` : s;
	}

	/** Khối đầu trang dùng chung: công ty, tiêu đề, ghi chú chữ ký. */
	function head(opts, titleVi, titleEn) {
		const lang = opts.lang || "vi";
		const t = T(lang);
		const c = opts.company || {};
		return {
			lang,
			companyName: c.name || "",
			companyLines: [c.address ? t(`Địa chỉ: ${c.address}`, `Address: ${c.address}`) : "", c.taxId ? t(`Mã số thuế: ${c.taxId}`, `Tax code: ${c.taxId}`) : ""].filter(Boolean),
			logos: c.logoUrl ? [{ url: c.logoUrl }] : [],
			title: t(titleVi, titleEn).toUpperCase(),
			signNote: t("(Ký, họ tên)", "(Signature, full name)"),
		};
	}

	function chunk(list, first, size) {
		const out = [];
		let i = 0;
		let cap = Math.max(1, first);
		while (i < list.length) {
			out.push(list.slice(i, i + cap));
			i += cap;
			cap = Math.max(1, size);
		}
		return out;
	}

	const byCode = (a, b) => String(a.code || "").localeCompare(String(b.code || "")) || String(a.employee || "").localeCompare(String(b.employee || ""));

	// ------------------------------------------------------------------ VP642000 Bảng chấm công tháng

	const DOW = { vi: ["CN", "T2", "T3", "T4", "T5", "T6", "T7"], en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] };
	const TS_KEYS = ["std", "work", "paid", "unpaid", "si", "ot"];
	const TS_FIELDS = { std: "std_days", work: "work_days", paid: "paid_leave", unpaid: "unpaid_leave", si: "si_leave", ot: "ot_hours" };
	// Chiều rộng cột (%): STT, mã, họ tên, bộ phận, sáu cột tổng; phần còn lại chia đều cho các ngày
	const TS_WIDTH = { stt: 2.2, code: 4.4, name: 10, department: 7, total: 3.5 };

	/** Nhân viên thuộc bộ phận đang lọc: đúng tên hoặc bộ phận con ("Cha : Con" của NetSuite). */
	function inDepartment(row, name) {
		if (blank(name)) return true;
		const d = String(row.department || "");
		return d === name || d.indexOf(`${name} : `) === 0;
	}

	/**
	 * Bảng chấm công tháng, A4 ngang.
	 * @param {Object} grid kết quả api/AttendanceMonth.month đã giải nén dòng (Grid.unpackRows):
	 *   {period: {code, start, end, stdDays}, days: [{date, day, dow, type}], rows: [{employee, code, name, department, contractor,
	 *   estimated, cells: [{s, k, h?, hp?}], totals?: {std_days, work_days, paid_leave, unpaid_leave, si_leave, ot_hours}}],
	 *   legend: {items: [{s, k}]}, symbols: [{code, description}]}
	 * @param {Object} opts {lang, company, department (tên bộ phận lọc), maxRows (500), part (1..), rowsPerPage (25), signers}
	 */
	function timesheet(grid, opts = {}) {
		const h = head(opts, "Bảng chấm công tháng", "Monthly attendance sheet");
		const t = T(h.lang);
		const g = grid || {};
		const p = g.period || {};
		const days = g.days || [];
		const maxRows = Math.max(1, num(opts.maxRows) || 500);
		const perPage = Math.max(5, num(opts.rowsPerPage) || 25);
		const all = (g.rows || [])
			.filter((r) => inDepartment(r, opts.department))
			.slice()
			.sort((a, b) => String(a.department || "").localeCompare(String(b.department || "")) || byCode(a, b));
		const parts = Math.max(1, Math.ceil(all.length / maxRows));
		const part = Math.min(parts, Math.max(1, Math.trunc(num(opts.part)) || 1));
		const offset = (part - 1) * maxRows;
		const list = all.slice(offset, offset + maxRows);

		// Làm tròn xuống để tổng chiều rộng các cột không vượt 100%
		const dayWidth = days.length ? Math.floor(((100 - TS_WIDTH.stt - TS_WIDTH.code - TS_WIDTH.name - TS_WIDTH.department - TS_KEYS.length * TS_WIDTH.total) * 100) / days.length) / 100 : 0;
		const shade = (d) => (d.type === "N" ? "#ffffff" : "#e6e6e6");
		const dow = DOW[h.lang === "en" ? "en" : "vi"];
		const dayCols = days.map((d) => ({ day: String(d.day).padStart(2, "0"), dow: dow[d.dow] || "", bg: shade(d), w: String(dayWidth) }));

		const zero = () => Object.fromEntries(TS_KEYS.map((k) => [k, 0]));
		const add = (sum, r) => {
			if (!r.totals) return;
			for (const k of TS_KEYS) sum[k] += num(r.totals[TS_FIELDS[k]]);
		};
		const fmt = (sum) => Object.fromEntries(TS_KEYS.map((k) => [k, qty(sum[k])]));
		const partSum = zero();
		const grandSum = zero();
		for (const r of all) add(grandSum, r);

		let estimated = false;
		let contractors = false;
		const rows = list.map((r, i) => {
			add(partSum, r);
			if (r.estimated) estimated = true;
			const cells = days.map((d, j) => {
				const c = (r.cells || [])[j] || {};
				return { s: c.s || "", bg: c.k === "O" ? "#f2f2f2" : shade(d) };
			});
			const out = { stt: String(offset + i + 1), code: r.code || "", name: r.name || "", department: r.department || "", cells };
			if (r.totals) for (const k of TS_KEYS) out[k] = qty(r.totals[TS_FIELDS[k]]);
			else {
				// Cộng tác viên không có bảng tổng hợp công: cột công hưởng lương ghi tổng giờ đã nhận
				contractors = true;
				for (const k of TS_KEYS) out[k] = "-";
				const hours = (r.cells || []).reduce((s, c) => s + num(c && c.h), 0);
				if (hours) out.work = `${qty(hours)}h`;
			}
			return out;
		});

		// Mỗi trang một bảng riêng (lặp tiêu đề cột); trang đầu ít dòng hơn vì có khối tiêu đề; dòng tổng nằm ở trang cuối
		const pages = chunk(rows, perPage - 3, perPage).map((rs, i, a) => ({ rows: rs, totals: [], breaks: i < a.length - 1 ? BREAK : [] }));
		if (!pages.length) pages.push({ rows: [], totals: [], breaks: [] });
		const totalLabel = parts > 1 ? t("Cộng phần này", "Total of this part") : t("Tổng cộng", "Total");
		const grandTotals = parts > 1 ? [Object.assign({ label: t(`Tổng cộng ${all.length} nhân viên`, `Grand total, ${all.length} employees`) }, fmt(grandSum))] : [];
		pages[pages.length - 1].totals = [Object.assign({ label: totalLabel }, fmt(partSum))].concat(grandTotals);

		const CATEGORY = {
			W: t("Làm việc", "Worked"), P: t("Nghỉ có lương", "Paid leave"), U: t("Nghỉ không lương", "Unpaid leave"), S: t("Nghỉ hưởng BHXH", "Leave paid by social insurance"),
			T: t("Công tác", "Business trip"), N: t("Nghỉ lễ", "Public holiday"), A: t("Số công của ngày sau điều chỉnh", "Day value after adjustment"), H: t("Số giờ của cộng tác viên", "Contractor hours"),
		};
		const describe = {};
		for (const s of g.symbols || []) if (!blank(s.code) && !blank(s.description)) describe[norm(s.code)] = s.description;
		const legend = [];
		for (const it of (g.legend && g.legend.items) || []) {
			if (!CATEGORY[it.k]) continue;
			if (blank(it.s)) {
				if (it.k === "A" || it.k === "H") legend.push({ symbol: t("số", "number"), text: CATEGORY[it.k] });
				continue;
			}
			legend.push({ symbol: it.s, text: describe[norm(it.s)] || CATEGORY[it.k] });
		}
		legend.push({ symbol: t("ô xám", "grey"), text: t("Nghỉ tuần, ngày lễ hoặc ngoài thời hạn hợp đồng", "Weekly rest day, public holiday or outside the contract term") });

		const notes = [];
		if (parts > 1) {
			notes.push(t(
				`Phần ${part}/${parts}: in nhân viên thứ ${offset + 1} - ${offset + list.length} trên tổng ${all.length}. In phần khác bằng tham số page hoặc lọc theo bộ phận.`,
				`Part ${part} of ${parts}: employees ${offset + 1} - ${offset + list.length} of ${all.length}. Print the other parts with the page parameter or filter by department.`
			));
		}
		if (estimated) notes.push(t("Kỳ chưa lập đủ bảng tổng hợp công: số tổng của một số nhân viên là số dự tính từ chứng từ hiện có.", "The attendance summary is not complete for this period: some totals are estimates from current documents."));
		if (contractors) notes.push(t("Cộng tác viên: ô ngày và cột công hưởng lương ghi số giờ (h), không cộng vào dòng tổng.", "Contractors: day cells and the paid days column show hours (h) and are not included in the totals."));

		const s = opts.signers || {};
		return Object.assign(h, {
			count: list.length,
			totalRows: all.length,
			part,
			parts,
			periodLine: t(`Kỳ ${p.code || ""} (${vnDate(p.start)} - ${vnDate(p.end)})`, `Period ${p.code || ""} (${vnDate(p.start)} - ${vnDate(p.end)})`),
			scopeLines: blank(opts.department) ? [] : [t(`Bộ phận: ${opts.department}`, `Department: ${opts.department}`)],
			unitLine: t("Đơn vị tính: ngày công; giờ làm thêm tính bằng giờ", "Unit: work days; overtime in hours"),
			days: dayCols,
			pages,
			total: fmt(partSum),
			totalLabel,
			grandTotals,
			span: String(4 + days.length),
			legendTitle: t("Ký hiệu", "Legend"),
			legend,
			notes,
			widths: { stt: String(TS_WIDTH.stt), code: String(TS_WIDTH.code), name: String(TS_WIDTH.name), department: String(TS_WIDTH.department), total: String(TS_WIDTH.total) },
			heads: {
				stt: t("STT", "No."), code: t("Mã NV", "ID"), name: t("Họ và tên", "Full name"), department: t("Bộ phận", "Department"), std: t("Công chuẩn", "Std days"),
				work: t("Công hưởng lương", "Paid days"), paid: t("Nghỉ phép", "Paid leave"), unpaid: t("Nghỉ không lương", "Unpaid leave"), si: t("Nghỉ hưởng BHXH", "SI leave"), ot: t("Giờ làm thêm", "OT hours"),
			},
			signers: [
				{ title: t("Người chấm công", "Timekeeper"), name: s.timekeeper || "" },
				{ title: t("Phụ trách bộ phận", "Head of department"), name: s.departmentHead || "" },
				{ title: t("Người duyệt", "Approved by"), name: s.approver || "" },
			],
		});
	}

	// ------------------------------------------------------------------ VP644100 / VP644110 / VP644010 Bảng kê xác nhận thù lao CTV

	const keyOf = (e) => [e.employee, e.project || "", e.task || ""].map(String).join("|");
	const label = (a, b) => [a, b].filter((x) => !blank(x)).join(" - ");

	/** Thứ Hai của tuần chứa ngày d. */
	function monday(d) {
		return Dates.addDays(d, -((Dates.dayOfWeek(d) + 6) % 7));
	}

	/**
	 * Bảng kê xác nhận thù lao cộng tác viên: mỗi người một trang (chi tiết giờ theo ngày, thù lao, xác nhận, phụ lục giờ theo tuần).
	 * @param {Object} detail Payroll.detail(batchId): {batch, lines, time: dòng giờ công tính lương (batch_time)}
	 * @param {Object} opts {lang, company, signers, profiles, employee, entries: dòng Time ĐÃ NHẬN vào lương trong cửa sổ kết công
	 *   [{employee, date, hours, project, projectName, task, taskName, memo}], window: {from, to}}
	 */
	function contractorStatement(detail, opts = {}) {
		const h = head(opts, "Bảng kê xác nhận thù lao", "Contractor fee statement");
		const t = T(h.lang);
		const b = detail.batch || {};
		const w = opts.window || { from: b.periodStart, to: b.periodEnd };
		const profiles = opts.profiles || {};
		const s = opts.signers || {};
		const entriesOf = {};
		for (const e of opts.entries || []) if (num(e.hours) > 0) (entriesOf[String(e.employee)] = entriesOf[String(e.employee)] || []).push(e);
		const timeOf = {};
		for (const l of detail.time || []) (timeOf[String(l.employee)] = timeOf[String(l.employee)] || []).push(l);
		const lines = (detail.lines || [])
			.filter((l) => norm(l.employment_type || "E") === "C")
			.filter((l) => !opts.employee || String(l.employee) === String(opts.employee))
			.sort(byCode);

		const pages = lines.map((l, idx) => {
			const id = String(l.employee);
			const mine = (entriesOf[id] || []).slice().sort((x, y) => String(x.date).localeCompare(String(y.date)));
			const byKey = {};
			for (const e of mine) (byKey[keyOf(e)] = byKey[keyOf(e)] || []).push(e);
			const used = new Set();
			const rows = [];
			let n = 0;
			let sumSource = 0;
			let sumHours = 0;
			const dayRows = (list, counted) => {
				for (const e of list) {
					n += 1;
					rows.push({ stt: String(n), date: vnDate(e.date), work: label(e.projectName, e.taskName), memo: e.memo || "", source: qty(e.hours), hours: counted ? qty(e.hours) : "", reason: "", weight: "normal" });
				}
			};
			const groupRow = (name, source, hours, reason) => {
				sumSource += num(source);
				sumHours += num(hours);
				rows.push({ stt: "", date: "", work: t(`Cộng: ${name}`, `Subtotal: ${name}`), memo: "", source: qty(source), hours: qty(hours), reason: reason || "", weight: "bold" });
			};
			for (const tl of timeOf[id] || []) {
				const key = tl.source === "M" || blank(tl.source_key) ? null : String(tl.source_key);
				const list = key && !used.has(key) ? byKey[key] || [] : [];
				if (key) used.add(key);
				const adjusted = h2(tl.hours) !== h2(tl.source_hours);
				dayRows(list, !adjusted);
				const name = label(tl.project_name, tl.task_name) || (key ? t("Không gắn dự án", "No project") : t("Giờ nhập tay", "Manual hours"));
				groupRow(name, tl.source_hours, tl.hours, tl.reason);
			}
			// Dòng Time đã nhận nhưng chưa có trong giờ công tính lương của bảng lương (timesheet đổi sau lần nạp cuối)
			for (const key of Object.keys(byKey).sort()) {
				if (used.has(key)) continue;
				const list = byKey[key];
				dayRows(list, false);
				groupRow(label(list[0].projectName, list[0].taskName) || t("Không gắn dự án", "No project"), list.reduce((a, e) => a + num(e.hours), 0), 0, t("Chưa nạp vào bảng lương", "Not loaded into the payroll batch"));
			}

			const weeksMap = new Map();
			for (const e of mine) {
				const ws = monday(e.date);
				weeksMap.set(ws, (weeksMap.get(ws) || 0) + num(e.hours));
			}
			const weeks = [...weeksMap.keys()].sort().map((ws) => ({ label: `${vnDate(ws)} - ${vnDate(Dates.addDays(ws, 6))}`, hours: qty(weeksMap.get(ws)) }));
			const weekHours = mine.reduce((a, e) => a + num(e.hours), 0);

			const paidHours = (timeOf[id] || []).length ? sumHours : (l.earnings || []).filter((e) => num(e.amount) !== 0).reduce((a, e) => a + num(e.quantity), 0);
			const p = profiles[id] || {};
			return {
				info: [
					{ label: t("Họ và tên", "Full name"), value: label(l.code, l.name) },
					{ label: t("Bộ phận", "Department"), value: l.department || "" },
					{ label: t("Mã số thuế", "Tax code"), value: p.taxCode || "" },
					{ label: t("Số CCCD", "ID number"), value: p.personalId || "" },
					{ label: t("Đơn giá thù lao (đồng/giờ)", "Fee rate (VND per hour)"), value: money(Base.contract(l, opts)) },
				],
				rows,
				total: { source: qty(sumSource), hours: qty(sumHours) },
				pay: [
					{ label: t("Số giờ tính thù lao", "Payable hours"), value: qty(paidHours) },
					{ label: t("Tổng thù lao", "Total fee"), value: money(l.gross) },
					{ label: t("Thuế TNCN khấu trừ", "PIT withheld"), value: money(l.pit) },
				],
				net: money(l.net),
				netWords: Words.readAmount(num(l.net)),
				weeks,
				weekTotal: qty(weekHours),
				signers: [
					{ title: t("Người nhận thù lao", "Contractor"), name: l.name || "" },
					{ title: t("Đại diện đơn vị chi trả", "For the paying organisation"), name: s.director || "" },
				],
				breaks: idx < lines.length - 1 ? BREAK : [],
			};
		});

		return Object.assign(h, {
			count: pages.length,
			periodLine: `${Base.periodLine(b, h.lang)} - ${t(`Bảng lương: ${b.name || ""}`, `Payroll batch: ${b.name || ""}`)}`,
			windowLine: t(`Thời gian làm việc: từ ${vnDate(w.from)} đến ${vnDate(w.to)}`, `Working time: from ${vnDate(w.from)} to ${vnDate(w.to)}`),
			currencyLine: t("Đơn vị tính: đồng", "Currency: VND"),
			pages,
			labels: {
				a: t("A. CHI TIẾT GIỜ LÀM (giờ đã được nhận vào bảng lương)", "A. HOURS DETAIL (hours accepted into the payroll batch)"), b: t("B. THÙ LAO", "B. FEE"), c: t("C. XÁC NHẬN", "C. CONFIRMATION"),
				d: t("PHỤ LỤC: GIỜ GHI NHẬN THEO TUẦN (thứ Hai - Chủ nhật)", "APPENDIX: RECORDED HOURS BY WEEK (Monday - Sunday)"),
				stt: t("STT", "No."), date: t("Ngày", "Date"), work: t("Dự án / công việc", "Project / task"), memo: t("Diễn giải", "Description"), source: t("Giờ ghi nhận", "Recorded hours"),
				hours: t("Giờ tính thù lao", "Payable hours"), reason: t("Lý do điều chỉnh", "Adjustment reason"), total: t("Tổng cộng", "Total"), week: t("Tuần", "Week"), weekHours: t("Số giờ", "Hours"),
				weekTotal: t("Tổng số giờ", "Total hours"), net: t("SỐ TIỀN THỰC NHẬN", "NET AMOUNT"), words: t("Bằng chữ", "In words"),
				confirm: t(
					"Đề nghị Anh/Chị kiểm tra giờ làm, dự án, công việc và số tiền nêu trên rồi ký xác nhận; nếu có sai sót, nêu rõ ngày và dòng cần điều chỉnh. Dòng có giờ tính thù lao khác giờ ghi nhận là dòng đã được điều chỉnh, lý do ghi ở cột cuối.",
					"Please check the hours, projects, tasks and amounts above and sign to confirm; if anything is wrong, state the date and the line to correct. Lines whose payable hours differ from the recorded hours were adjusted; the reason is in the last column."
				),
				confidential: t("Bảng kê là thông tin bảo mật, chỉ gửi riêng cho người có tên trên đây.", "This statement is confidential and is sent only to the person named above."),
			},
		});
	}

	// ------------------------------------------------------------------ VP645000 / VP645010 Bảng chia lương tổ

	/**
	 * Bảng chia lương tổ của một phiếu sản lượng.
	 * @param {Object} data {entry: bản ghi output, periodName, team: {code, description, leaderName}, rateTable: {code, description},
	 *   projectName, approvedByName, lines: output_line[], members: output_member[], employees: {id: {code, name}}}
	 */
	function teamSplit(data, opts = {}) {
		const h = head(opts, "Bảng chia lương tổ", "Team pay split sheet");
		const t = T(h.lang);
		const e = data.entry || {};
		const team = data.team || {};
		const table = data.rateTable || {};
		const emps = data.employees || {};
		const isTeam = norm(e.type) === "T";
		const METHOD = { D: t("Theo ngày công", "By work days"), F: t("Ngày công x hệ số", "Work days x factor"), H: t("Theo giờ", "By hours"), P: t("Tỷ lệ cố định", "Fixed percentage"), E: t("Chia đều", "Equal shares") };
		const STATUS = { H: t("Tạm giữ", "On hold"), P: t("Chờ duyệt", "Pending approval"), A: t("Đã duyệt", "Approved"), C: t("Đã vào bảng lương", "Included in payroll") };

		const lineTotal = Money.sum(data.lines || [], (l) => num(l.amount)).toNumber();
		const lines = (data.lines || []).map((l, i) => ({ stt: String(i + 1), item: label(l.item, l.description), uom: l.uom || "", qty: qty4(l.qty), rate: qty(l.rate), amount: money(l.amount) }));
		const sum = { workDays: 0, hours: 0, percent: 0 };
		const splitTotal = Money.sum(data.members || [], (m) => num(m.amount)).toNumber();
		const members = (data.members || []).map((m, i) => {
			const emp = emps[String(m.employee)] || {};
			sum.workDays += num(m.work_days);
			sum.hours += num(m.hours);
			sum.percent += num(m.percent);
			return { stt: String(i + 1), code: emp.code || "", name: emp.name || "", workDays: qty(m.work_days), hours: qty(m.hours), factor: qty4(m.factor), percent: qty(m.percent), amount: money(m.amount) };
		});

		const warnings = [];
		const notes = [];
		if (isTeam) {
			const diff = Money.round(splitTotal) - Money.round(lineTotal);
			if (diff !== 0) {
				warnings.push(t(
					`CHÚ Ý: tổng tiền chia ${money(splitTotal)} khác thành tiền nghiệm thu ${money(lineTotal)}, chênh lệch ${money(diff)}. Cần chia lại trước khi duyệt phiếu.`,
					`WARNING: the split total ${money(splitTotal)} differs from the accepted amount ${money(lineTotal)} by ${money(diff)}. Split again before approving the entry.`
				));
			}
			if (!members.length) warnings.push(t("CHÚ Ý: phiếu tổ chưa có thành viên.", "WARNING: the team entry has no members."));
		} else notes.push(t("Phiếu cá nhân: không có phần chia cho thành viên tổ.", "Individual entry: there is no split to team members."));

		return Object.assign(h, {
			count: lines.length + members.length,
			docLine: t(`Phiếu ${e.name || ""} ngày ${vnDate(e.doc_date)} - Kỳ lương ${data.periodName || ""}`, `Entry ${e.name || ""} dated ${vnDate(e.doc_date)} - Pay period ${data.periodName || ""}`),
			currencyLine: t("Đơn vị tính: đồng", "Currency: VND"),
			info: [
				{ label: t("Tổ", "Team"), value: label(team.code, team.description) },
				{ label: t("Bảng đơn giá", "Rate table"), value: label(table.code, table.description) },
				{ label: t("Nội dung", "Description"), value: e.description || "" },
				{ label: t("Cách chia", "Split method"), value: isTeam ? METHOD[norm(e.split_method || "F")] || "" : "" },
				{ label: t("Dự án", "Project"), value: data.projectName || "" },
				{ label: t("Trạng thái", "Status"), value: STATUS[norm(e.status || "H")] || "" },
			],
			lines,
			lineTotal: money(lineTotal),
			members,
			memberTotal: { workDays: qty(sum.workDays), hours: qty(sum.hours), percent: qty(sum.percent), amount: money(splitTotal) },
			words: t(`Tổng tiền chia bằng chữ: ${Words.readAmount(splitTotal)}`, `Split total in words: ${Words.readAmount(splitTotal)}`),
			warnings,
			notes,
			labels: {
				i: t("I. Khối lượng nghiệm thu", "I. Accepted output"), ii: t("II. Chia cho thành viên", "II. Split to members"),
				stt: t("STT", "No."), item: t("Hạng mục / công đoạn", "Item / operation"), uom: t("ĐVT", "UoM"), qty: t("Khối lượng", "Quantity"), rate: t("Đơn giá", "Rate"), amount: t("Thành tiền", "Amount"),
				lineTotal: t("Cộng thành tiền", "Total amount"), code: t("Mã NV", "ID"), name: t("Họ và tên", "Full name"), workDays: t("Ngày công", "Work days"), hours: t("Giờ", "Hours"),
				factor: t("Hệ số", "Factor"), percent: t("Tỷ lệ %", "Percent"), share: t("Số tiền được chia", "Split amount"), sign: t("Ký nhận", "Signature"), total: t("Tổng cộng", "Total"),
			},
			signers: [
				{ title: t("Tổ trưởng", "Team leader"), name: team.leaderName || "" },
				{ title: t("Người lập", "Prepared by"), name: (opts.signers || {}).preparer || "" },
				{ title: t("Người duyệt", "Approved by"), name: data.approvedByName || "" },
			],
		});
	}

	// ------------------------------------------------------------------ VP646000 Bảng hoa hồng

	/**
	 * Bảng hoa hồng theo nhân viên của một bảng lương: dòng thu nhập của quy tắc có nguồn số lượng S (doanh số).
	 * Doanh số = số lượng của dòng, tỷ lệ = đơn giá của dòng (phần trăm với nguồn đơn giá C và thang T), chỉ tiêu là giá trị
	 * đang khai trên hồ sơ lương (không lưu theo kỳ).
	 * @param {Object} detail Payroll.detail(batchId)
	 * @param {Object} opts {lang, company, signers, rules: {MÃ: {quantitySource, rateSource}}, profiles: {id: {salesTarget}}, employee}
	 */
	function commission(detail, opts = {}) {
		const h = head(opts, "Bảng hoa hồng theo nhân viên", "Commission sheet by employee");
		const t = T(h.lang);
		const b = detail.batch || {};
		const rules = opts.rules || {};
		const profiles = opts.profiles || {};
		const s = opts.signers || {};
		const sum = { sales: 0, amount: 0 };
		const rows = [];
		const lines = (detail.lines || []).filter((l) => !opts.employee || String(l.employee) === String(opts.employee)).sort(byCode);
		for (const l of lines) {
			let counted = false;
			for (const e of l.earnings || []) {
				const rule = rules[norm(e.ruleCode)];
				if (!rule || norm(rule.quantitySource) !== "S" || num(e.amount) === 0) continue;
				const target = num((profiles[String(l.employee)] || {}).salesTarget);
				// Một nhân viên có nhiều quy tắc hoa hồng trên cùng doanh số: doanh số chỉ cộng một lần vào dòng tổng
				if (!counted) sum.sales += num(e.quantity);
				counted = true;
				sum.amount += num(e.amount);
				const percent = ["C", "T"].includes(norm(rule.rateSource));
				rows.push({
					stt: String(rows.length + 1), code: l.code || "", name: l.name || "", rule: norm(e.ruleCode), sales: money(e.quantity), target: money(target),
					achieved: target > 0 ? qty((num(e.quantity) * 100) / target) : "-", rate: percent ? qty(e.rate) : "-", amount: money(e.amount),
				});
			}
		}
		return Object.assign(h, {
			count: rows.length,
			periodLine: `${Base.periodLine(b, h.lang)} - ${t(`Bảng lương: ${b.name || ""}`, `Payroll batch: ${b.name || ""}`)}`,
			currencyLine: t("Đơn vị tính: đồng", "Currency: VND"),
			note: t("Doanh số và hoa hồng lấy từ bảng lương; chỉ tiêu là giá trị đang khai trên hồ sơ lương.", "Sales and commission come from the payroll batch; the target is the value currently on the payroll profile."),
			rows,
			total: { sales: money(sum.sales), amount: money(sum.amount) },
			words: t(`Tổng hoa hồng bằng chữ: ${Words.readAmount(sum.amount)}`, `Total commission in words: ${Words.readAmount(sum.amount)}`),
			heads: {
				stt: t("STT", "No."), code: t("Mã NV", "ID"), name: t("Họ và tên", "Full name"), rule: t("Quy tắc", "Rule"), sales: t("Doanh số", "Sales"), target: t("Chỉ tiêu tháng (hiện tại)", "Monthly target (current)"),
				achieved: t("% đạt", "% achieved"), rate: t("Tỷ lệ bình quân %", "Average rate %"), amount: t("Hoa hồng", "Commission"), total: t("Tổng cộng", "Total"),
			},
			signers: [
				{ title: t("Người lập", "Prepared by"), name: s.preparer || "" },
				{ title: t("Trưởng phòng kinh doanh", "Head of sales"), name: s.salesHead || "" },
				{ title: t("Kế toán trưởng", "Chief accountant"), name: s.chiefAccountant || "" },
			],
		});
	}

	// ------------------------------------------------------------------ VP647000 - VP647020 Phiếu thông tin hợp đồng, quyết định

	function sheetBase(h, t, data, opts) {
		const emp = data.employee || {};
		const s = opts.signers || {};
		return {
			count: 1,
			employeeSection: {
				title: t("I. Người lao động", "I. Employee"),
				rowBlocks: [{ rows: [
					{ label: t("Mã nhân viên", "Employee ID"), value: emp.code || "" },
					{ label: t("Họ và tên", "Full name"), value: emp.name || "" },
					{ label: t("Bộ phận", "Department"), value: emp.departmentName || "" },
				] }],
				changeBlocks: [],
			},
			printedLine: blank(opts.today) ? "" : t(`Ngày in: ${vnDate(opts.today)}`, `Printed on: ${vnDate(opts.today)}`),
			signers: [
				{ title: t("Người lập phiếu", "Prepared by"), name: s.preparer || "" },
				{ title: t("Phụ trách nhân sự", "HR officer"), name: s.hr || "" },
				{ title: t("Người lao động", "Employee"), name: emp.name || "" },
			],
		};
	}

	const noteSection = (t, title, text) => (blank(text) ? [] : [{ title, rowBlocks: [{ rows: [{ label: t("Ghi chú", "Note"), value: String(text) }] }], changeBlocks: [] }]);

	/**
	 * Phiếu thông tin hợp đồng lao động / phụ lục: tóm tắt các trường của bản ghi, KHÔNG phải mẫu hợp đồng.
	 * @param {Object} data {record: bản ghi contract, parent: hợp đồng gốc của phụ lục (hoặc null), employee: {code, name, departmentName}}
	 * @param {Object} opts {lang, company, signers, showPay: in mức lương (vai trò được xem lương), today}
	 */
	function contractSheet(data, opts = {}) {
		const r = data.record || {};
		const parent = data.parent || null;
		const appendix = !!parent || !blank(r.parent);
		const h = appendix ? head(opts, "Phiếu thông tin phụ lục hợp đồng lao động", "Labor contract appendix - information sheet") : head(opts, "Phiếu thông tin hợp đồng lao động", "Labor contract - information sheet");
		const t = T(h.lang);
		const TYPE = {
			P: t("Thử việc", "Probation"), F: t("Xác định thời hạn", "Fixed-term"), U: t("Không xác định thời hạn", "Indefinite-term"),
			S: t("Thời vụ / khoán việc", "Seasonal / piecework"), C: t("Cộng tác viên / dịch vụ", "Contractor / service"),
		};
		const STATUS = { D: t("Nháp", "Draft"), A: t("Hiệu lực", "Active"), X: t("Hết hạn", "Expired"), T: t("Chấm dứt", "Terminated") };
		const rows = [{ label: appendix ? t("Số phụ lục", "Appendix number") : t("Số hợp đồng", "Contract number"), value: r.number || "" }];
		if (appendix) {
			const p = parent || {};
			rows.push({ label: t("Phụ lục của hợp đồng", "Appendix to contract"), value: [p.number || "", p.effective ? t(`hiệu lực từ ${vnDate(p.effective)}`, `effective ${vnDate(p.effective)}`) : ""].filter(Boolean).join(", ") });
		}
		const type = norm(r.type || (parent || {}).type);
		rows.push(
			{ label: t("Loại hợp đồng", "Contract type"), value: TYPE[type] || "" },
			{ label: t("Ngày ký", "Signing date"), value: vnDate(r.sign_date) },
			{ label: t("Hiệu lực từ", "Effective from"), value: vnDate(r.effective) },
			{ label: t("Hiệu lực đến", "Effective to"), value: vnDate(r.expiry) },
			{ label: t("Chức danh", "Job title"), value: r.title || "" },
			{ label: t("Trạng thái", "Status"), value: STATUS[norm(r.status || "D")] || "" }
		);
		if (!blank(r.terminated)) rows.push({ label: t("Ngày chấm dứt", "Termination date"), value: vnDate(r.terminated) });
		if (!blank(r.term_reason)) rows.push({ label: t("Lý do chấm dứt", "Termination reason"), value: r.term_reason });
		const base = sheetBase(h, t, data, opts);
		const sections = [base.employeeSection, { title: appendix ? t("II. Phụ lục", "II. Appendix") : t("II. Hợp đồng", "II. Contract"), rowBlocks: [{ rows }], changeBlocks: [] }];
		if (opts.showPay) {
			sections.push({
				title: t("III. Tiền lương ghi trên hợp đồng (đồng)", "III. Pay stated on the contract (VND)"),
				rowBlocks: [{ rows: [
					{ label: t("Mức lương ghi trên hợp đồng", "Salary stated on the contract"), value: money(r.base_salary) },
					{ label: t("Lương đóng bảo hiểm", "Insurance wage"), value: money(r.insurance_wage) },
				] }],
				changeBlocks: [],
			});
		}
		sections.push(...noteSection(t, t("Ghi chú", "Notes"), r.note));
		return Object.assign(h, {
			count: base.count,
			numberLine: t(`Số: ${r.number || ""}`, `No.: ${r.number || ""}`),
			printedLine: base.printedLine,
			disclaimer: t(
				"Phiếu này tóm tắt dữ liệu đang ghi trên hệ thống để đối chiếu hồ sơ. Đây không phải là hợp đồng lao động và không thay thế văn bản đã ký giữa hai bên.",
				"This sheet summarises the data recorded in the system for file checking. It is not a labor contract and does not replace the document signed by the parties."
			),
			sections,
			signers: base.signers,
		});
	}

	/**
	 * Phiếu thông tin quyết định nhân sự: tóm tắt các trường của bản ghi, KHÔNG phải mẫu quyết định.
	 * @param {Object} data {record: bản ghi decision, employee: {code, name, departmentName}, departments: {id: tên}, appliedByName}
	 * @param {Object} opts {lang, company, signers, showPay, today}
	 */
	function decisionSheet(data, opts = {}) {
		const r = data.record || {};
		const h = head(opts, "Phiếu thông tin quyết định nhân sự", "Personnel decision - information sheet");
		const t = T(h.lang);
		const TYPE = {
			H: t("Tiếp nhận", "Onboarding"), T: t("Điều chuyển", "Transfer"), P: t("Bổ nhiệm", "Appointment"), S: t("Điều chỉnh lương", "Salary change"),
			R: t("Khen thưởng", "Reward"), D: t("Kỷ luật", "Discipline"), X: t("Chấm dứt", "Termination"),
		};
		const STATUS = { D: t("Nháp", "Draft"), A: t("Đã áp dụng", "Applied") };
		const dept = (id) => (blank(id) ? "" : (data.departments || {})[String(id)] || `#${id}`);
		const rows = [
			{ label: t("Số quyết định", "Decision number"), value: r.number || "" },
			{ label: t("Loại quyết định", "Decision type"), value: TYPE[norm(r.type)] || "" },
			{ label: t("Ngày ký", "Signing date"), value: vnDate(r.sign_date) },
			{ label: t("Ngày hiệu lực", "Effective date"), value: vnDate(r.effective) },
			{ label: t("Trạng thái", "Status"), value: STATUS[norm(r.status || "D")] || "" },
		];
		if (!blank(r.applied_date)) rows.push({ label: t("Ngày áp dụng", "Applied on"), value: vnDate(r.applied_date) });
		if (!blank(data.appliedByName)) rows.push({ label: t("Người áp dụng", "Applied by"), value: data.appliedByName });
		const changes = [];
		const change = (lab, before, after) => {
			if (blank(before) && blank(after)) return;
			changes.push({ label: lab, before: blank(before) ? "" : String(before), after: blank(after) ? "" : String(after) });
		};
		change(t("Phòng ban", "Department"), dept(r.old_department), dept(r.new_department));
		change(t("Chức danh", "Job title"), r.old_title, r.new_title);
		if (opts.showPay) {
			const m = (v) => (blank(v) ? "" : money(v));
			change(t("Lương hợp đồng (đồng)", "Contract salary (VND)"), m(r.old_salary), m(r.new_salary));
			change(t("Lương đóng bảo hiểm (đồng)", "Insurance wage (VND)"), m(r.old_ins_wage), m(r.new_ins_wage));
			change(t("Phụ cấp cố định (đồng)", "Fixed allowance (VND)"), m(r.old_allowance), m(r.new_allowance));
		}
		const base = sheetBase(h, t, data, opts);
		const sections = [base.employeeSection, { title: t("II. Quyết định", "II. Decision"), rowBlocks: [{ rows }], changeBlocks: [] }];
		if (changes.length) {
			sections.push({
				title: t("III. Nội dung thay đổi", "III. Changes"), rowBlocks: [],
				changeBlocks: [{ heads: { label: t("Khoản", "Item"), before: t("Trước quyết định", "Before"), after: t("Theo quyết định", "After") }, rows: changes }],
			});
		}
		sections.push(...noteSection(t, t("Ghi chú", "Notes"), r.note));
		return Object.assign(h, {
			count: base.count,
			numberLine: t(`Số: ${r.number || ""}`, `No.: ${r.number || ""}`),
			printedLine: base.printedLine,
			disclaimer: t(
				"Phiếu này tóm tắt dữ liệu đang ghi trên hệ thống để đối chiếu hồ sơ. Đây không phải là quyết định nhân sự và không thay thế văn bản đã ban hành.",
				"This sheet summarises the data recorded in the system for file checking. It is not a personnel decision and does not replace the issued document."
			),
			sections,
			signers: base.signers,
		});
	}

	return { timesheet, contractorStatement, teamSplit, commission, contractSheet, decisionSheet, qty4, inDepartment };
});
