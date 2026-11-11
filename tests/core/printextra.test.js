// Mô hình in bổ sung (core/PrintModelExtra): bảng chấm công tháng, bảng kê thù lao CTV, bảng chia lương tổ, bảng hoa hồng,
// phiếu thông tin hợp đồng / quyết định. Kiểm: tổng khớp, ngắt trang, chế độ ngôn ngữ, và mẫu in (templates/*.xml) chỉ dùng
// trường mô hình có trả - điền thử bằng bộ FreeMarker rút gọn (chỉ <#list> và ${...}) rồi kiểm thẻ XML cân đối.
const fs = require("fs");
const path = require("path");
const { core } = require("./helpers");
const Extra = core("PrintModelExtra");
const Dates = core("Dates");

const TEMPLATES = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/templates");
const company = { name: "Công ty Test", address: "Hà Nội", taxId: "0100000000" };
const signers = { preparer: "A", chiefAccountant: "B", director: "C" };

// ------------------------------------------------------------------ bộ điền mẫu rút gọn

function lookup(scope, expr) {
	let v = scope;
	for (const k of expr.split(".")) {
		if (v === null || v === undefined || !(k in Object(v))) throw new Error(`Template uses missing value: ${expr}`);
		v = v[k];
	}
	return v;
}

function fill(text, scope) {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const open = text.indexOf("<#list ", i);
		if (open < 0) break;
		out += subst(text.slice(i, open), scope);
		const headEnd = text.indexOf(">", open);
		const m = /^<#list ([\w.]+) as (\w+)$/.exec(text.slice(open, headEnd));
		if (!m) throw new Error(`Unsupported directive: ${text.slice(open, headEnd + 1)}`);
		let depth = 1;
		let j = headEnd + 1;
		while (depth > 0) {
			const a = text.indexOf("<#list ", j);
			const b = text.indexOf("</#list>", j);
			if (b < 0) throw new Error("Unclosed <#list>");
			if (a >= 0 && a < b) {
				depth += 1;
				j = a + 7;
			} else {
				depth -= 1;
				j = b + 8;
			}
		}
		const body = text.slice(headEnd + 1, j - 8);
		const list = lookup(scope, m[1]);
		if (!Array.isArray(list)) throw new Error(`Not a list: ${m[1]}`);
		for (const item of list) out += fill(body, Object.assign({}, scope, { [m[2]]: item }));
		i = j;
	}
	return out + subst(text.slice(i), scope);
}

function subst(text, scope) {
	if (/<#(?!--)/.test(text)) throw new Error(`Unsupported directive in: ${text.slice(0, 80)}`);
	return text.replace(/\$\{([^}]+)\}/g, (all, expr) => {
		const html = /\?html$/.test(expr);
		const key = expr.replace(/\?html$/, "");
		if (key.indexOf("nsfont.") === 0) return "font";
		const v = lookup(scope, key);
		if (typeof v !== "string") throw new Error(`Template value is not a string: ${key}`);
		return html ? v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : v;
	});
}

/** Điền mẫu và kiểm thẻ cân đối; trả XML đã điền. */
function render(name, model) {
	const xml = fill(fs.readFileSync(path.join(TEMPLATES, name), "utf8"), { data: model });
	const stack = [];
	const body = xml.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->|<#--[\s\S]*?-->|<style[\s\S]*?<\/style>/g, "");
	for (const m of body.matchAll(/<(\/?)([\w:-]+)((?:"[^"]*"|[^">])*?)(\/?)>/g)) {
		if (m[4]) continue;
		if (m[1]) {
			const top = stack.pop();
			if (top !== m[2]) throw new Error(`Unbalanced tag in ${name}: </${m[2]}> closes <${top}>`);
		} else stack.push(m[2]);
	}
	if (stack.length) throw new Error(`Unclosed tags in ${name}: ${stack.join(", ")}`);
	return xml;
}

// ------------------------------------------------------------------ bảng chấm công tháng

function gridOf(count, extra = {}) {
	const days = Dates.range("2026-10-01", "2026-10-31").map((date) => {
		const dow = Dates.dayOfWeek(date);
		return { date, day: Dates.day(date), month: 10, dow, type: dow === 0 || dow === 6 ? "W" : "N" };
	});
	const cells = days.map((d) => (d.type === "N" ? { s: "X", k: "W", v: 1 } : { s: "", k: "N" }));
	const rows = [];
	for (let i = 1; i <= count; i++) {
		rows.push({
			employee: String(1000 + i), code: `E${String(i).padStart(4, "0")}`, name: `Nhân viên ${i}`, department: i % 2 ? "Xưởng" : "Kế toán : Thuế", cells,
			totals: { std_days: 22, paid_leave: 1, unpaid_leave: 0.5, si_leave: 0, trip_days: 0, late_days: 0, adjust_days: 0, work_days: 21.5, ot_hours: 2 },
		});
	}
	return Object.assign({ period: { code: "202610", start: "2026-10-01", end: "2026-10-31", stdDays: 22 }, days, rows, legend: { items: [{ s: "X", k: "W" }, { s: "P", k: "P" }, { s: "", k: "A" }, { s: "", k: "M" }] }, symbols: [{ code: "X", description: "Đi làm cả ngày" }] }, extra);
}

describe("PrintModelExtra.timesheet", () => {
	test("cột ngày, ô, tổng theo dòng và dòng tổng cộng", () => {
		const m = Extra.timesheet(gridOf(3), { lang: "vi", company });
		expect(m.title).toBe("BẢNG CHẤM CÔNG THÁNG");
		expect(m.periodLine).toBe("Kỳ 202610 (01/10/2026 - 31/10/2026)");
		expect(m.days).toHaveLength(31);
		expect(m.days[0]).toMatchObject({ day: "01", dow: "T5", bg: "#ffffff" });
		expect(m.days[2]).toMatchObject({ day: "03", dow: "T7", bg: "#e6e6e6" });
		// Sắp theo bộ phận rồi mã: "Kế toán : Thuế" (E0002) trước "Xưởng" (E0001, E0003)
		const rows = m.pages[0].rows;
		expect(rows.map((r) => r.code)).toEqual(["E0002", "E0001", "E0003"]);
		expect(rows[0]).toMatchObject({ stt: "1", std: "22", work: "21,5", paid: "1", unpaid: "0,5", si: "-", ot: "2" });
		expect(rows[0].cells).toHaveLength(31);
		expect(rows[0].cells[0]).toEqual({ s: "X", bg: "#ffffff" });
		expect(m.total).toEqual({ std: "66", work: "64,5", paid: "3", unpaid: "1,5", si: "-", ot: "6" });
		expect(m.pages[0].totals).toEqual([Object.assign({ label: "Tổng cộng" }, m.total)]);
		expect(m.span).toBe("35");
		// Chiều rộng cột cộng lại không quá 100%
		const width = 2.2 + 4.4 + 10 + 7 + 6 * 3.5 + m.days.reduce((s, d) => s + Number(d.w), 0);
		expect(width).toBeLessThanOrEqual(100);
		expect(width).toBeGreaterThan(99);
		expect(m.signers.map((s) => s.title)).toEqual(["Người chấm công", "Phụ trách bộ phận", "Người duyệt"]);
	});

	test("chú giải: mô tả từ danh mục ký hiệu, nhóm cho ký hiệu không có mô tả, ô số", () => {
		const m = Extra.timesheet(gridOf(1), { lang: "vi", company });
		expect(m.legend.map((l) => [l.symbol, l.text])).toEqual([
			["X", "Đi làm cả ngày"], ["P", "Nghỉ có lương"], ["số", "Số công của ngày sau điều chỉnh"], ["ô xám", "Nghỉ tuần, ngày lễ hoặc ngoài thời hạn hợp đồng"],
		]);
	});

	test("ngắt trang: trang đầu ít dòng hơn, dòng tổng chỉ ở trang cuối", () => {
		const m = Extra.timesheet(gridOf(60), { lang: "vi", company, rowsPerPage: 25 });
		expect(m.pages.map((p) => p.rows.length)).toEqual([22, 25, 13]);
		expect(m.pages.map((p) => p.breaks.length)).toEqual([1, 1, 0]);
		expect(m.pages.map((p) => p.totals.length)).toEqual([0, 0, 1]);
		expect(m.pages[2].rows[12].stt).toBe("60");
		expect(m.count).toBe(60);
	});

	test("1.000 nhân viên: in từng phần, tổng phần và tổng toàn bảng", () => {
		const grid = gridOf(1000);
		const a = Extra.timesheet(grid, { lang: "vi", company, maxRows: 500 });
		expect([a.part, a.parts, a.count, a.totalRows]).toEqual([1, 2, 500, 1000]);
		expect(a.pages.reduce((s, p) => s + p.rows.length, 0)).toBe(500);
		expect(a.total.work).toBe("10.750");
		expect(a.grandTotals[0]).toMatchObject({ label: "Tổng cộng 1000 nhân viên", work: "21.500", std: "22.000" });
		expect(a.pages[a.pages.length - 1].totals.map((t) => t.label)).toEqual(["Cộng phần này", "Tổng cộng 1000 nhân viên"]);
		expect(a.notes[0]).toMatch(/^Phần 1\/2: in nhân viên thứ 1 - 500 trên tổng 1000/);
		const b = Extra.timesheet(grid, { lang: "vi", company, maxRows: 500, part: "2" });
		expect(b.pages[0].rows[0].stt).toBe("501");
		expect(b.part).toBe(2);
		// Phần ngoài phạm vi quy về phần cuối
		expect(Extra.timesheet(grid, { maxRows: 500, part: 9 }).part).toBe(2);
	});

	test("lọc bộ phận gồm bộ phận con; rỗng thì count = 0", () => {
		const grid = gridOf(10);
		const m = Extra.timesheet(grid, { lang: "vi", company, department: "Kế toán" });
		expect(m.count).toBe(5);
		expect(m.scopeLines).toEqual(["Bộ phận: Kế toán"]);
		expect(m.total.std).toBe("110");
		const none = Extra.timesheet(grid, { lang: "vi", company, department: "Kho" });
		expect(none.count).toBe(0);
		expect(none.pages).toHaveLength(1);
		expect(none.total.work).toBe("-");
		expect(Extra.timesheet({}, {}).count).toBe(0);
	});

	test("cộng tác viên ghi giờ, không cộng vào tổng; số dự tính và ô ngoài thời hạn hợp đồng", () => {
		const grid = gridOf(1);
		grid.rows.push({ employee: "9", code: "C001", name: "CTV", department: "Xưởng", contractor: true, cells: grid.days.map((d, i) => (i === 0 ? { s: "", k: "O" } : i < 3 ? { s: "8", k: "H", h: 8 } : { s: "", k: "N" })) });
		grid.rows[0].estimated = true;
		const m = Extra.timesheet(grid, { lang: "vi", company });
		const c = m.pages[0].rows[0];
		expect(c).toMatchObject({ code: "C001", std: "-", work: "16h", ot: "-" });
		expect(c.cells[0]).toEqual({ s: "", bg: "#f2f2f2" });
		expect(m.total.work).toBe("21,5");
		expect(m.notes).toHaveLength(2);
	});

	test("ngôn ngữ và mẫu in", () => {
		const en = Extra.timesheet(gridOf(30), { lang: "en", company });
		expect(en.title).toBe("MONTHLY ATTENDANCE SHEET");
		expect(en.days[0].dow).toBe("Th");
		const bi = Extra.timesheet(gridOf(30), { lang: "bi", company, maxRows: 20 });
		expect(bi.heads.work).toBe("Công hưởng lương / Paid days");
		const xml = render("timesheet.xml", bi);
		expect((xml.match(/<pbr\/>/g) || []).length).toBe(bi.pages.length - 1);
		expect((xml.match(/<table class="grid"/g) || []).length).toBe(bi.pages.length);
		render("timesheet.xml", en);
		render("timesheet.xml", Extra.timesheet({}, {}));
	});
});

// ------------------------------------------------------------------ bảng kê thù lao cộng tác viên

const batch = { name: "BL000003", periodName: "202610", tax_month: "202610", periodStart: "2026-10-01", periodEnd: "2026-10-31" };
const ctvDetail = {
	batch,
	lines: [
		{ employee: "2684", code: "E014", name: "CTV C", department: "Dự án", employment_type: "C", base_salary: 15680000, gross: 15680000, pit: 1568000, net: 14112000, earnings: [{ earningType: "PHIDV", quantity: 80, rate: 196000, amount: 15680000 }] },
		{ employee: "2685", code: "E015", name: "CTV D", department: "", employment_type: "C", base_salary: 1000000, gross: 1000000, pit: 0, net: 1000000, earnings: [{ earningType: "PHIDV", quantity: 10, rate: 100000, amount: 1000000 }] },
		{ employee: "2682", code: "E012", name: "Văn phòng A", employment_type: "E", gross: 1, net: 1, earnings: [] },
	],
	time: [
		{ employee: "2684", source: "A", source_key: "2684|77|5", project_name: "Dự án X", task_name: "Thiết kế", source_hours: 48, hours: 48, reason: "" },
		{ employee: "2684", source: "A", source_key: "2684|78|", project_name: "Dự án Y", task_name: "", source_hours: 24, hours: 22, reason: "Trừ 2 giờ họp nội bộ" },
		{ employee: "2684", source: "M", source_key: "", project_name: "", task_name: "", source_hours: 0, hours: 10, reason: "Bổ sung giờ tháng trước" },
	],
};
const entry = (employee, date, hours, project, projectName, task, taskName, memo) => ({ employee, date, hours, project, projectName, task, taskName, memo });
const ctvEntries = [
	entry("2684", "2026-10-01", 8, "77", "Dự án X", "5", "Thiết kế", "Bản vẽ"),
	entry("2684", "2026-10-02", 8, "77", "Dự án X", "5", "Thiết kế", ""),
	entry("2684", "2026-10-05", 32, "77", "Dự án X", "5", "Thiết kế", ""),
	entry("2684", "2026-10-06", 24, "78", "Dự án Y", "", "", ""),
	entry("2684", "2026-10-12", 4, "79", "Dự án Z", "", "", "Nhập sau"),
	entry("2684", "2026-10-13", 0, "79", "Dự án Z", "", "", ""),
];
const ctvOpts = { lang: "vi", company, signers, profiles: { 2684: { taxCode: "8000000001", personalId: "001200000001", contractSalary: 196000 } }, entries: ctvEntries, window: { from: "2026-09-26", to: "2026-10-25" } };

describe("PrintModelExtra.contractorStatement", () => {
	test("mỗi cộng tác viên một trang, sắp theo mã, lọc một người", () => {
		const m = Extra.contractorStatement(ctvDetail, ctvOpts);
		expect(m.title).toBe("BẢNG KÊ XÁC NHẬN THÙ LAO");
		expect(m.periodLine).toBe("Tháng 10 năm 2026 - Bảng lương: BL000003");
		expect(m.windowLine).toBe("Thời gian làm việc: từ 26/09/2026 đến 25/10/2026");
		expect(m.pages.map((p) => p.info[0].value)).toEqual(["E014 - CTV C", "E015 - CTV D"]);
		expect(m.pages.map((p) => p.breaks.length)).toEqual([1, 0]);
		const one = Extra.contractorStatement(ctvDetail, Object.assign({}, ctvOpts, { employee: "2685" }));
		expect(one.count).toBe(1);
		expect(one.pages[0].breaks).toEqual([]);
		expect(Extra.contractorStatement(ctvDetail, Object.assign({}, ctvOpts, { employee: "2682" })).count).toBe(0);
	});

	test("chi tiết giờ theo ngày, giờ điều chỉnh có lý do, giờ nhập tay, giờ chưa nạp; tổng khớp", () => {
		const p = Extra.contractorStatement(ctvDetail, ctvOpts).pages[0];
		expect(p.rows.map((r) => [r.stt, r.date, r.work, r.source, r.hours, r.reason, r.weight])).toEqual([
			["1", "01/10/2026", "Dự án X - Thiết kế", "8", "8", "", "normal"],
			["2", "02/10/2026", "Dự án X - Thiết kế", "8", "8", "", "normal"],
			["3", "05/10/2026", "Dự án X - Thiết kế", "32", "32", "", "normal"],
			["", "", "Cộng: Dự án X - Thiết kế", "48", "48", "", "bold"],
			// Nhóm đã điều chỉnh: giờ tính thù lao chỉ ghi ở dòng cộng, kèm lý do
			["4", "06/10/2026", "Dự án Y", "24", "", "", "normal"],
			["", "", "Cộng: Dự án Y", "24", "22", "Trừ 2 giờ họp nội bộ", "bold"],
			["", "", "Cộng: Giờ nhập tay", "-", "10", "Bổ sung giờ tháng trước", "bold"],
			["5", "12/10/2026", "Dự án Z", "4", "", "", "normal"],
			["", "", "Cộng: Dự án Z", "4", "-", "Chưa nạp vào bảng lương", "bold"],
		]);
		expect(p.rows[0].memo).toBe("Bản vẽ");
		expect(p.total).toEqual({ source: "76", hours: "80" });
		expect(p.info.map((f) => f.value)).toEqual(["E014 - CTV C", "Dự án", "8000000001", "001200000001", "196.000"]);
		expect(p.pay.map((f) => f.value)).toEqual(["80", "15.680.000", "1.568.000"]);
		expect(p.net).toBe("14.112.000");
		expect(p.netWords).toBe("Mười bốn triệu một trăm mười hai nghìn đồng");
		expect(p.signers.map((s) => [s.title, s.name])).toEqual([["Người nhận thù lao", "CTV C"], ["Đại diện đơn vị chi trả", "C"]]);
	});

	test("phụ lục giờ theo tuần thứ Hai - Chủ nhật", () => {
		const p = Extra.contractorStatement(ctvDetail, ctvOpts).pages[0];
		expect(p.weeks).toEqual([
			{ label: "28/09/2026 - 04/10/2026", hours: "16" },
			{ label: "05/10/2026 - 11/10/2026", hours: "56" },
			{ label: "12/10/2026 - 18/10/2026", hours: "4" },
		]);
		expect(p.weekTotal).toBe("76");
	});

	test("không có giờ công tính lương: số giờ lấy từ dòng thu nhập, bảng giờ rỗng", () => {
		const p = Extra.contractorStatement(ctvDetail, ctvOpts).pages[1];
		expect(p.rows).toEqual([]);
		expect(p.total).toEqual({ source: "-", hours: "-" });
		expect(p.pay[0].value).toBe("10");
		expect(p.weeks).toEqual([]);
		// Không có lịch sử lương truyền vào: đơn giá lấy lương chính của dòng
		expect(p.info[4].value).toBe("1.000.000");
	});

	test("ngôn ngữ và mẫu in", () => {
		const en = Extra.contractorStatement(ctvDetail, Object.assign({}, ctvOpts, { lang: "en" }));
		expect(en.title).toBe("CONTRACTOR FEE STATEMENT");
		expect(en.labels.net).toBe("NET AMOUNT");
		const bi = Extra.contractorStatement(ctvDetail, Object.assign({}, ctvOpts, { lang: "bi" }));
		expect(bi.labels.reason).toBe("Lý do điều chỉnh / Adjustment reason");
		const xml = render("contractor_statement.xml", bi);
		expect((xml.match(/<pbr\/>/g) || []).length).toBe(1);
		expect(xml).toContain("font-weight: bold;");
		render("contractor_statement.xml", en);
	});
});

// ------------------------------------------------------------------ bảng chia lương tổ

const splitData = {
	entry: { id: "9", name: "SL000012", doc_date: "2026-10-20", type: "T", split_method: "F", description: "Đổ bê tông sàn tầng 3", total: 10000000, split_total: 10000000, status: "A" },
	periodName: "202610",
	team: { code: "TO01", description: "Tổ bê tông", leaderName: "Tổ trưởng T" },
	rateTable: { code: "KHOAN", description: "Đơn giá khoán" },
	projectName: "Công trình A",
	approvedByName: "Người duyệt D",
	lines: [
		{ item: "BT01", description: "Bê tông sàn", uom: "m3", qty: 40.5, rate: 200000, amount: 8100000 },
		{ item: "CP01", description: "Cốp pha", uom: "m2", qty: 19, rate: 100000, amount: 1900000 },
	],
	members: [
		{ employee: "1", work_days: 10, hours: 80, factor: 1.2, percent: 0, amount: 4000000 },
		{ employee: "2", work_days: 10, hours: 80, factor: 1, percent: 0, amount: 3333334 },
		{ employee: "3", work_days: 8, hours: 64, factor: 1, percent: 0, amount: 2666666 },
	],
	employees: { 1: { code: "E001", name: "Thợ A" }, 2: { code: "E002", name: "Thợ B" }, 3: { code: "E003", name: "Thợ C" } },
};

describe("PrintModelExtra.teamSplit", () => {
	test("khối lượng, thành viên, tổng khớp thì không cảnh báo", () => {
		const m = Extra.teamSplit(splitData, { lang: "vi", company, signers });
		expect(m.title).toBe("BẢNG CHIA LƯƠNG TỔ");
		expect(m.docLine).toBe("Phiếu SL000012 ngày 20/10/2026 - Kỳ lương 202610");
		expect(m.info.map((f) => f.value)).toEqual(["TO01 - Tổ bê tông", "KHOAN - Đơn giá khoán", "Đổ bê tông sàn tầng 3", "Ngày công x hệ số", "Công trình A", "Đã duyệt"]);
		expect(m.lines[0]).toEqual({ stt: "1", item: "BT01 - Bê tông sàn", uom: "m3", qty: "40,5", rate: "200.000", amount: "8.100.000" });
		expect(m.lineTotal).toBe("10.000.000");
		expect(m.members[0]).toEqual({ stt: "1", code: "E001", name: "Thợ A", workDays: "10", hours: "80", factor: "1,2", percent: "-", amount: "4.000.000" });
		expect(m.memberTotal).toEqual({ workDays: "28", hours: "224", percent: "-", amount: "10.000.000" });
		expect(m.words).toBe("Tổng tiền chia bằng chữ: Mười triệu đồng");
		expect(m.warnings).toEqual([]);
		expect(m.signers.map((s) => [s.title, s.name])).toEqual([["Tổ trưởng", "Tổ trưởng T"], ["Người lập", "A"], ["Người duyệt", "Người duyệt D"]]);
	});

	test("tổng chia khác thành tiền: cảnh báo ghi rõ hai số và chênh lệch", () => {
		const off = Object.assign({}, splitData, { members: splitData.members.slice(0, 2) });
		const m = Extra.teamSplit(off, { lang: "vi", company });
		expect(m.warnings).toEqual(["CHÚ Ý: tổng tiền chia 7.333.334 khác thành tiền nghiệm thu 10.000.000, chênh lệch (2.666.666). Cần chia lại trước khi duyệt phiếu."]);
		expect(render("team_split.xml", m)).toContain("CHÚ Ý: tổng tiền chia");
		const none = Extra.teamSplit(Object.assign({}, splitData, { members: [] }), { lang: "en", company });
		expect(none.warnings).toHaveLength(2);
		expect(none.warnings[1]).toBe("WARNING: the team entry has no members.");
	});

	test("phiếu cá nhân: không cảnh báo, có ghi chú; phiếu rỗng count = 0", () => {
		const m = Extra.teamSplit(Object.assign({}, splitData, { entry: Object.assign({}, splitData.entry, { type: "I" }), members: [] }), { lang: "vi", company });
		expect(m.warnings).toEqual([]);
		expect(m.notes).toEqual(["Phiếu cá nhân: không có phần chia cho thành viên tổ."]);
		expect(m.info[3].value).toBe("");
		expect(Extra.teamSplit({ entry: { type: "T" }, lines: [], members: [] }, {}).count).toBe(0);
	});

	test("ngôn ngữ và mẫu in", () => {
		expect(Extra.teamSplit(splitData, { lang: "en", company }).title).toBe("TEAM PAY SPLIT SHEET");
		const bi = Extra.teamSplit(splitData, { lang: "bi", company, signers });
		expect(bi.labels.share).toBe("Số tiền được chia / Split amount");
		render("team_split.xml", bi);
	});
});

// ------------------------------------------------------------------ bảng hoa hồng

const commDetail = {
	batch,
	lines: [
		{ employee: "11", code: "S002", name: "Kinh doanh B", earnings: [{ earningType: "HOAHONG", ruleCode: "HH_THANG", quantity: 500000000, rate: 1.5, amount: 7500000 }, { earningType: "LUONG", ruleCode: "LUONG", quantity: 22, rate: 500000, amount: 11000000 }] },
		{ employee: "10", code: "S001", name: "Kinh doanh A", earnings: [
			{ earningType: "HOAHONG", ruleCode: "hh_thang", quantity: 200000000, rate: 1, amount: 2000000 },
			{ earningType: "THUONGDS", ruleCode: "HH_CODINH", quantity: 200000000, rate: 0.005, amount: 1000000 },
			{ earningType: "HOAHONG", ruleCode: "HH_KHAC", quantity: 200000000, rate: 2, amount: 0 },
		] },
		{ employee: "12", code: "E001", name: "Văn phòng", earnings: [{ earningType: "LUONG", ruleCode: "LUONG", quantity: 22, rate: 1, amount: 22 }] },
	],
};
const commOpts = {
	lang: "vi", company, signers,
	rules: { HH_THANG: { quantitySource: "S", rateSource: "T" }, HH_CODINH: { quantitySource: "S", rateSource: "F" }, HH_KHAC: { quantitySource: "S", rateSource: "C" }, LUONG: { quantitySource: "D", rateSource: "S" } },
	profiles: { 10: { salesTarget: 250000000 }, 11: { salesTarget: 0 } },
};

describe("PrintModelExtra.commission", () => {
	test("chỉ dòng của quy tắc nguồn doanh số, khác 0; % đạt theo chỉ tiêu; tổng khớp", () => {
		const m = Extra.commission(commDetail, commOpts);
		expect(m.title).toBe("BẢNG HOA HỒNG THEO NHÂN VIÊN");
		expect(m.rows).toEqual([
			{ stt: "1", code: "S001", name: "Kinh doanh A", rule: "HH_THANG", sales: "200.000.000", target: "250.000.000", achieved: "80", rate: "1", amount: "2.000.000" },
			// Nguồn đơn giá cố định: đơn giá không phải phần trăm nên cột tỷ lệ để "-"
			{ stt: "2", code: "S001", name: "Kinh doanh A", rule: "HH_CODINH", sales: "200.000.000", target: "250.000.000", achieved: "80", rate: "-", amount: "1.000.000" },
			{ stt: "3", code: "S002", name: "Kinh doanh B", rule: "HH_THANG", sales: "500.000.000", target: "-", achieved: "-", rate: "1,5", amount: "7.500.000" },
		]);
		// Doanh số của một nhân viên chỉ cộng một lần dù có hai quy tắc
		expect(m.total).toEqual({ sales: "700.000.000", amount: "10.500.000" });
		expect(m.words).toBe("Tổng hoa hồng bằng chữ: Mười triệu năm trăm nghìn đồng");
		expect(m.signers.map((s) => s.title)).toEqual(["Người lập", "Trưởng phòng kinh doanh", "Kế toán trưởng"]);
	});

	test("lọc một người; không có quy tắc doanh số thì count = 0", () => {
		expect(Extra.commission(commDetail, Object.assign({}, commOpts, { employee: "11" })).rows).toHaveLength(1);
		const none = Extra.commission(commDetail, Object.assign({}, commOpts, { rules: {} }));
		expect(none.count).toBe(0);
		expect(none.total).toEqual({ sales: "-", amount: "-" });
	});

	test("ngôn ngữ và mẫu in", () => {
		expect(Extra.commission(commDetail, Object.assign({}, commOpts, { lang: "en" })).heads.amount).toBe("Commission");
		const bi = Extra.commission(commDetail, Object.assign({}, commOpts, { lang: "bi" }));
		expect(bi.periodLine).toBe("Tháng 10 năm 2026 / October 2026 - Bảng lương: BL000003 / Payroll batch: BL000003");
		render("commission.xml", bi);
	});
});

// ------------------------------------------------------------------ phiếu thông tin hợp đồng, quyết định

const employee = { code: "E012", name: "Văn phòng A", departmentName: "Kế toán" };
const contract = { id: "5", employee: "2682", number: "HD-2026-012", type: "F", sign_date: "2026-01-02", effective: "2026-01-05", expiry: "2027-01-04", title: "Kế toán viên", base_salary: 30000000, insurance_wage: 30000000, status: "A", note: "Bản scan đính kèm" };

describe("PrintModelExtra.contractSheet", () => {
	test("hợp đồng: các trường của bản ghi, ghi chú không phải hợp đồng, mức lương theo quyền", () => {
		const m = Extra.contractSheet({ record: contract, parent: null, employee }, { lang: "vi", company, showPay: true, today: "2026-11-10" });
		expect(m.title).toBe("PHIẾU THÔNG TIN HỢP ĐỒNG LAO ĐỘNG");
		expect(m.numberLine).toBe("Số: HD-2026-012");
		expect(m.disclaimer).toMatch(/không phải là hợp đồng lao động/);
		expect(m.printedLine).toBe("Ngày in: 10/11/2026");
		expect(m.sections.map((s) => s.title)).toEqual(["I. Người lao động", "II. Hợp đồng", "III. Tiền lương ghi trên hợp đồng (đồng)", "Ghi chú"]);
		expect(m.sections[1].rowBlocks[0].rows.map((r) => r.value)).toEqual(["HD-2026-012", "Xác định thời hạn", "02/01/2026", "05/01/2026", "04/01/2027", "Kế toán viên", "Hiệu lực"]);
		expect(m.sections[2].rowBlocks[0].rows.map((r) => r.value)).toEqual(["30.000.000", "30.000.000"]);
		const hidden = Extra.contractSheet({ record: contract, parent: null, employee }, { lang: "vi", company, showPay: false });
		expect(hidden.sections.map((s) => s.title)).toEqual(["I. Người lao động", "II. Hợp đồng", "Ghi chú"]);
		expect(JSON.stringify(hidden)).not.toContain("30.000.000");
		expect(m.signers.map((s) => [s.title, s.name])).toEqual([["Người lập phiếu", ""], ["Phụ trách nhân sự", ""], ["Người lao động", "Văn phòng A"]]);
	});

	test("phụ lục: tiêu đề phụ lục, dẫn hợp đồng gốc, loại theo hợp đồng gốc; hợp đồng chấm dứt", () => {
		const appendix = { id: "6", employee: "2682", number: "PL-01", parent: "5", effective: "2026-07-01", title: "Kế toán tổng hợp", status: "T", terminated: "2026-09-30", term_reason: "Thỏa thuận" };
		const m = Extra.contractSheet({ record: appendix, parent: contract, employee }, { lang: "vi", company });
		expect(m.title).toBe("PHIẾU THÔNG TIN PHỤ LỤC HỢP ĐỒNG LAO ĐỘNG");
		const rows = m.sections[1].rowBlocks[0].rows;
		expect(rows[1]).toEqual({ label: "Phụ lục của hợp đồng", value: "HD-2026-012, hiệu lực từ 05/01/2026" });
		expect(rows[2].value).toBe("Xác định thời hạn");
		expect(rows.slice(-2).map((r) => r.value)).toEqual(["30/09/2026", "Thỏa thuận"]);
		expect(m.printedLine).toBe("");
	});

	test("ngôn ngữ và mẫu in", () => {
		expect(Extra.contractSheet({ record: contract, employee }, { lang: "en", company }).title).toBe("LABOR CONTRACT - INFORMATION SHEET");
		render("info_sheet.xml", Extra.contractSheet({ record: contract, employee }, { lang: "bi", company, showPay: true, today: "2026-11-10" }));
		render("info_sheet.xml", Extra.contractSheet({ record: {}, employee: {} }, {}));
	});
});

describe("PrintModelExtra.decisionSheet", () => {
	const decision = {
		id: "3", employee: "2682", number: "QD-07", type: "S", sign_date: "2026-06-25", effective: "2026-07-01", old_department: "4", new_department: "7", old_title: "Kế toán viên", new_title: "Kế toán tổng hợp",
		old_salary: 30000000, new_salary: 35000000, old_ins_wage: 30000000, new_ins_wage: 35000000, old_allowance: null, new_allowance: null, status: "A", applied_date: "2026-07-01", note: "",
	};
	const data = { record: decision, employee, departments: { 4: "Kế toán" }, appliedByName: "HR H" };

	test("quyết định: thông tin, bảng thay đổi cũ - mới, lương theo quyền", () => {
		const m = Extra.decisionSheet(data, { lang: "vi", company, showPay: true });
		expect(m.title).toBe("PHIẾU THÔNG TIN QUYẾT ĐỊNH NHÂN SỰ");
		expect(m.disclaimer).toMatch(/không phải là quyết định nhân sự/);
		expect(m.sections[1].rowBlocks[0].rows.map((r) => r.value)).toEqual(["QD-07", "Điều chỉnh lương", "25/06/2026", "01/07/2026", "Đã áp dụng", "01/07/2026", "HR H"]);
		const changes = m.sections[2].changeBlocks[0].rows;
		expect(changes).toEqual([
			// Phòng ban không tra được tên thì ghi mã nội bộ
			{ label: "Phòng ban", before: "Kế toán", after: "#7" },
			{ label: "Chức danh", before: "Kế toán viên", after: "Kế toán tổng hợp" },
			{ label: "Lương hợp đồng (đồng)", before: "30.000.000", after: "35.000.000" },
			{ label: "Lương đóng bảo hiểm (đồng)", before: "30.000.000", after: "35.000.000" },
		]);
		expect(m.sections).toHaveLength(3);
		const hidden = Extra.decisionSheet(data, { lang: "vi", company, showPay: false });
		expect(hidden.sections[2].changeBlocks[0].rows.map((r) => r.label)).toEqual(["Phòng ban", "Chức danh"]);
		expect(JSON.stringify(hidden)).not.toContain("35.000.000");
	});

	test("không có thay đổi nào thì bỏ mục III; ngôn ngữ và mẫu in", () => {
		const plain = Extra.decisionSheet({ record: { number: "QD-08", type: "R", effective: "2026-08-01", note: "Khen thưởng quý" }, employee }, { lang: "en", company });
		expect(plain.sections.map((s) => s.title)).toEqual(["I. Employee", "II. Decision", "Notes"]);
		expect(plain.title).toBe("PERSONNEL DECISION - INFORMATION SHEET");
		render("info_sheet.xml", plain);
		render("info_sheet.xml", Extra.decisionSheet(data, { lang: "bi", company, showPay: true, today: "2026-11-10" }));
	});
});
