// CommissionEngine (docs/COMMISSION.md mục 3, 5): dòng nguồn, ghi nhận, 6 phương pháp, bậc thang, cổng, trần, draw, true-up
// cửa sổ quý / năm, hoa hồng quản lý, điều chỉnh, phân bổ chi phí, mô phỏng. Số kỳ vọng tính tay ghi ngay cạnh.
const { core } = require("./helpers");
const CE = core("CommissionEngine");

const NOV = { from: "2026-11-01", to: "2026-11-30" };
const OCT = { from: "2026-10-01", to: "2026-10-31" };
const M = 1000000;

const plan = (o) => Object.assign({ id: "1", code: "KH1", basis: "R", trigger: "I", creditSource: "R", window: "M", earningType: "HOAHONG" }, o);
const asg = (employee, o) => Object.assign({ plan: "1", employee, effective: "2026-01-01", quota: 100 * M }, o);
const rule = (o) => Object.assign({ id: "r1", plan: "1", sequence: 1, name: "Doanh số", method: "P", rate: 2 }, o);
let seq = 0;
const row = (o) => Object.assign({ tranId: `T${++seq}`, tranNo: `INV${seq}`, tranType: "I", date: "2026-11-10", item: "10", itemType: "InvtPart", revenue: 0, cost: 0, qty: 0, salesRep: "101" }, o);

/** Chuẩn hóa + ghi nhận + tính một kỳ. */
function run(o) {
	const p = plan(o.plan);
	const period = o.period || NOV;
	const assignments = o.assignments || [asg("101")];
	const credits = CE.credit(CE.normalizeLines(o.rows || [], p, period), p, assignments);
	const windowCredits = o.windowRows ? CE.credit(CE.normalizeLines(o.windowRows, p, CE.windowOf(p, period.from, period.to)), p, assignments) : undefined;
	return CE.calculate(Object.assign({ plan: p, rules: o.rules || [rule()], tiers: o.tiers || [], assignments, quotas: o.quotas || [], credits, windowCredits, from: period.from, to: period.to }, o.extra || {}));
}
const one = (o, emp = "101") => run(o).results.find((r) => r.employee === emp);
const sumShares = (r) => r.shares.reduce((s, x) => s + x.amount, 0);

describe("normalizeLines", () => {
	const p = plan({ subsidiary: "13" });
	test("bỏ loại dòng loại trừ, dòng công ty khác, dòng ngoài kỳ; chiết khấu vẫn tính", () => {
		const lines = CE.normalizeLines([
			row({ revenue: 100 * M }),
			row({ itemType: "TaxItem", revenue: 10 * M }),
			row({ itemType: "ShipItem", revenue: 1 * M }),
			row({ itemType: "Discount", revenue: -5 * M }),
			row({ subsidiary: "99", revenue: 7 * M }),
			row({ subsidiary: "13", revenue: 3 * M }),
			row({ date: "2026-10-31", revenue: 9 * M }),
		], p, NOV);
		expect(lines.map((l) => l.base)).toEqual([100 * M, -5 * M, 3 * M]);
		expect(lines.every((l) => l.kind === "N" && l.factor === 1)).toBe(true);
	});
	test("không có kỳ thì không lọc ngày; loại dòng loại trừ tự khai", () => {
		const lines = CE.normalizeLines([row({ date: "2026-01-01", revenue: 1 }), row({ itemType: "Kit", revenue: 2 })], plan({ excludeItemTypes: "Kit" }));
		expect(lines.map((l) => l.base)).toEqual([1]);
	});
	test("cơ sở G = doanh thu - giá vốn, Q = số lượng; credit memo giữ dấu âm, bỏ khi không trừ trả hàng", () => {
		const rows = [row({ revenue: 100 * M, cost: 70 * M, qty: 10 }), row({ tranType: "C", revenue: -20 * M, cost: -14 * M, qty: -2 })];
		expect(CE.normalizeLines(rows, plan({ basis: "G" }), NOV).map((l) => l.base)).toEqual([30 * M, -6 * M]);
		expect(CE.normalizeLines(rows, plan({ basis: "Q" }), NOV).map((l) => l.base)).toEqual([10, -2]);
		expect(CE.normalizeLines(rows, plan({ include_returns: false }), NOV).map((l) => l.base)).toEqual([100 * M]);
	});
	test("giữ sourceSystem (trống = NetSuite) đến tận credit", () => {
		const lines = CE.normalizeLines([row({ revenue: 5 * M, sourceSystem: "DMS", tranNo: "D-01" }), row({ revenue: 1 * M })], plan(), NOV);
		expect(lines.map((l) => l.sourceSystem)).toEqual(["DMS", ""]);
		expect(lines[0].key).toMatch(/^DMS:/);
		const credits = CE.credit(lines, plan(), [asg("101")]);
		expect(credits.map((c) => [c.sourceSystem, c.tranNo])).toEqual([["DMS", "D-01"], ["", lines[1].tranNo]]);
	});
});

describe("credit", () => {
	const lines = (o) => CE.normalizeLines([row(Object.assign({ revenue: 100 * M }, o))], plan(o && o.planO), NOV);
	test("R: salesrep 100%", () => {
		const c = CE.credit(lines(), plan(), [asg("101")]);
		expect(c).toHaveLength(1);
		expect(c[0]).toMatchObject({ employee: "101", pct: 100, base: 100 * M });
	});
	test("T: đội bán theo % đóng góp, tổng khác 100% giữ nguyên; không có đội thì lùi về salesrep", () => {
		const p = plan({ creditSource: "T" });
		const team = [{ employee: "101", pct: 60 }, { employee: "102", pct: 60 }];
		const c = CE.credit(CE.normalizeLines([row({ revenue: 100 * M, team })], p, NOV), p, [asg("101"), asg("102")]);
		expect(c.map((x) => [x.employee, x.base])).toEqual([["101", 60 * M], ["102", 60 * M]]);
		const f = CE.credit(CE.normalizeLines([row({ revenue: 100 * M, team: [] })], p, NOV), p, [asg("101")]);
		expect(f.map((x) => [x.employee, x.base])).toEqual([["101", 100 * M]]);
	});
	test("F: trường tùy chỉnh 100%, trống thì không ai được ghi nhận", () => {
		const p = plan({ creditSource: undefined, credit_source: "F" });
		const ls = CE.normalizeLines([row({ revenue: 10 * M, creditEmployee: "105" }), row({ revenue: 5 * M })], p, NOV);
		expect(CE.credit(ls, p, [asg("101"), asg("105")]).map((x) => [x.employee, x.base])).toEqual([["105", 10 * M]]);
	});
	test("chỉ người có phân công hiệu lực tại ngày ghi nhận, đúng kế hoạch", () => {
		expect(CE.credit(lines(), plan(), [asg("101", { effective: "2026-11-11" })])).toHaveLength(0);
		expect(CE.credit(lines(), plan(), [asg("101", { effective: "2026-11-10" })])).toHaveLength(1);
		expect(CE.credit(lines(), plan(), [asg("101", { expiration: "2026-11-09" })])).toHaveLength(0);
		expect(CE.credit(lines(), plan(), [asg("101", { plan: "2" })])).toHaveLength(0);
		expect(CE.credit(lines(), plan(), [asg("102")])).toHaveLength(0);
	});
});

describe("windowOf", () => {
	test("M kỳ, Q đầu quý, Y đầu năm của ngày cuối", () => {
		expect(CE.windowOf(plan(), NOV.from, NOV.to)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
		expect(CE.windowOf(plan({ window: "Q" }), NOV.from, NOV.to)).toEqual({ from: "2026-10-01", to: "2026-11-30" });
		expect(CE.windowOf(plan({ window: "Q" }), "2026-03-01", "2026-03-31")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
		expect(CE.windowOf(plan({ window: "Y" }), NOV.from, NOV.to)).toEqual({ from: "2026-01-01", to: "2026-11-30" });
	});
});

describe("phương pháp và bậc thang", () => {
	const G = [{ rule: "r1", fromValue: 0, rate: 2 }, { rule: "r1", fromValue: 100 * M, rate: 3 }, { rule: "r1", fromValue: 200 * M, rate: 5 }];
	const S = [{ rule: "r1", from_value: 0, rate: 1 }, { rule: "r1", from_value: 100 * M, rate: 2 }, { rule: "r1", from_value: 200 * M, rate: 3 }];
	const A = [{ rule: "r1", fromValue: 0, rate: 1 }, { rule: "r1", fromValue: 100, rate: 3 }, { rule: "r1", fromValue: 120, rate: 4 }];
	const B = [{ rule: "r1", fromValue: 100, amount: 5 * M }, { rule: "r1", fromValue: 120, amount: 8 * M }];
	const calc = (method, tiers, revenue, extra = {}) => one(Object.assign({ rules: [rule(Object.assign({ method }, extra.rule))], tiers, rows: [row({ revenue, qty: extra.qty || 0 })] }, extra.o || {}));

	test("P: 120.000.000 x 2% = 2.400.000, có diễn giải song ngữ định dạng số", () => {
		const r = calc("P", [], 120 * M);
		expect(r.earned).toBe(2400000);
		expect(r.payable).toBe(2400000);
		expect(r.components[0]).toMatchObject({ rule: "r1", method: "P", base: 120 * M, amount: 2400000 });
		expect(r.components[0].steps[0]).toEqual({ vi: "Tỷ lệ cố định: 120.000.000 x 2% = 2.400.000", en: "Flat rate: 120,000,000 x 2% = 2,400,000" });
		expect(r.steps.some((s) => s.vi === "Doanh số: Tỷ lệ cố định: 120.000.000 x 2% = 2.400.000")).toBe(true);
		expect(r.steps[r.steps.length - 1]).toEqual({ vi: "Phải trả vào bảng lương: 2.400.000", en: "Payable to payroll: 2,400,000" });
	});
	test("G lũy tiến: 250tr = 100tr x 2% + 100tr x 3% + 50tr x 5% = 7.500.000; đúng ngưỡng 100tr = 2.000.000, 200tr = 5.000.000", () => {
		const r = calc("G", G, 250 * M);
		expect(r.earned).toBe(7500000);
		expect(r.components[0].steps.map((s) => s.vi)).toEqual([
			"Thang lũy tiến: 0 - 100.000.000 x 2% = 2.000.000",
			"Thang lũy tiến: 100.000.000 - 200.000.000 x 3% = 3.000.000",
			"Thang lũy tiến: 200.000.000 - 250.000.000 x 5% = 2.500.000",
		]);
		expect(calc("G", G, 100 * M).earned).toBe(2000000);
		expect(calc("G", G, 200 * M).earned).toBe(5000000);
		expect(calc("G", G, -5 * M).earned).toBe(0);
	});
	test("S bậc: đúng ngưỡng 100tr là đạt bậc 2%; 99.999.999 x 1% = 999.999,99 -> 1.000.000; 250tr x 3%", () => {
		expect(calc("S", S, 100 * M).earned).toBe(2000000);
		expect(calc("S", S, 99999999).earned).toBe(1000000);
		expect(calc("S", S, 250 * M).earned).toBe(7500000);
		const r = calc("S", [{ rule: "r1", fromValue: 10 * M, rate: 1 }], 5 * M);
		expect(r.earned).toBe(0);
		expect(r.components[0].steps[0].vi).toBe("Thang bậc: cơ sở 5.000.000 chưa đạt bậc đầu tiên (10.000.000): 0");
	});
	test("A theo % đạt (chỉ tiêu 100tr): 100% -> 3%; 90% -> 1%; 130% -> 4%", () => {
		expect(calc("A", A, 100 * M).earned).toBe(3000000);
		expect(calc("A", A, 90 * M).earned).toBe(900000);
		const r = calc("A", A, 130 * M);
		expect(r.attainment).toBe(130);
		expect(r.earned).toBe(5200000);
		expect(r.components[0].steps[0].vi).toBe("Theo % đạt: đạt 130% thuộc bậc từ 120%: 130.000.000 x 4% = 5.200.000");
	});
	test("A / B không có chỉ tiêu: 0 và cảnh báo NO_QUOTA", () => {
		const r = calc("A", A, 130 * M, { o: { assignments: [asg("101", { quota: 0 })] } });
		expect(r.attainment).toBeNull();
		expect(r.earned).toBe(0);
		expect(r.warnings.map((w) => w.code)).toContain("NO_QUOTA");
		expect(r.warnings[0]).toHaveProperty("vi");
		expect(r.warnings[0]).toHaveProperty("en");
		expect(calc("B", B, 130 * M, { o: { assignments: [asg("101", { quota: 0 })] } }).earned).toBe(0);
	});
	test("U: 37 x 50.000 = 1.850.000", () => {
		expect(calc("U", [], 10 * M, { qty: 37, rule: { unitAmount: 50000 } }).earned).toBe(1850000);
		expect(calc("U", [], 10 * M, { qty: 37, rule: { unit_amount: 50000 } }).earned).toBe(1850000);
	});
	test("B thưởng mốc: 125% qua mốc 120% = 8.000.000; đúng 100% = 5.000.000; 99,99% = 0", () => {
		expect(calc("B", B, 125 * M).earned).toBe(8 * M);
		expect(calc("B", B, 100 * M).earned).toBe(5 * M);
		expect(calc("B", B, 99990000).earned).toBe(0);
	});
	test("thiếu bậc thang: 0 và cảnh báo NO_TIERS", () => {
		const r = calc("G", [], 10 * M);
		expect(r.earned).toBe(0);
		expect(r.warnings.map((w) => w.code)).toContain("NO_TIERS");
	});
});

describe("cổng % đạt tối thiểu", () => {
	const rules = [rule(), rule({ id: "r2", sequence: 2, name: "Thưởng", method: "B" })];
	const tiers = [{ rule: "r2", fromValue: 100, amount: 3 * M }];
	test("79% dưới ngưỡng 80%: 0; đúng 80%: 80tr x 2% = 1.600.000", () => {
		const r = one({ plan: { minAttainment: 80 }, rows: [row({ revenue: 79 * M })] });
		expect(r.earned).toBe(0);
		expect(r.components[0].steps[0].vi).toBe("Chưa đạt ngưỡng 80% (đạt 79%): 0");
		expect(one({ plan: { min_attainment: 80 }, rows: [row({ revenue: 80 * M })] }).earned).toBe(1600000);
	});
	test("cổng không áp cho thưởng mốc B", () => {
		const r = one({ plan: { minAttainment: 130 }, rules, tiers, rows: [row({ revenue: 125 * M })] });
		expect(r.components.map((c) => c.amount)).toEqual([0, 3 * M]);
		expect(r.earned).toBe(3 * M);
	});
	test("có ngưỡng nhưng không có chỉ tiêu: 0 và NO_QUOTA", () => {
		const r = one({ plan: { minAttainment: 50 }, rows: [row({ revenue: 100 * M })], assignments: [asg("101", { quota: null })] });
		expect(r.earned).toBe(0);
		expect(r.warnings.map((w) => w.code)).toContain("NO_QUOTA");
	});
});

describe("bộ lọc thành phần", () => {
	const rows = [
		row({ revenue: 10 * M, item: "1", classId: "41", department: "31", location: "61", customerCategory: "7", firstSaleDate: "2026-08-12" }),
		row({ revenue: 20 * M, item: "2", classId: "42", department: "32", location: "62", customerCategory: "8", firstSaleDate: "2026-08-11" }),
		row({ revenue: 40 * M, item: "3", classId: "41", department: "32", location: "61", customerCategory: "7" }),
	];
	const base = (filter) => one({ rules: [rule(filter)], rows }).components[0].base;
	test("mặt hàng, class, phòng ban, địa điểm, nhóm khách (danh sách id)", () => {
		expect(base({ fItems: "1, 3" })).toBe(50 * M);
		expect(base({ f_classes: "42" })).toBe(20 * M);
		expect(base({ fDepartments: ["32"] })).toBe(60 * M);
		expect(base({ fLocations: "61" })).toBe(50 * M);
		expect(base({ fCustCategories: "8" })).toBe(20 * M);
		expect(base({ fItems: "" })).toBe(70 * M);
	});
	test("khách mới: lần mua đầu trong 90 ngày tính đến ngày chứng từ (đúng 90 ngày vẫn tính, 91 thì không)", () => {
		expect(base({ fNewCustomer: true })).toBe(10 * M);
		expect(base({ f_new_customer: true, new_days: 91 })).toBe(30 * M);
	});
	test("% đạt luôn tính trên tổng cơ sở của kế hoạch (không lọc); các thành phần chồng nhau", () => {
		const r = one({ rules: [rule(), rule({ id: "r2", sequence: 2, name: "Mặt hàng mới", rate: 1, fItems: "3" })], rows });
		expect(r.attainment).toBe(70);
		expect(r.components.map((c) => c.amount)).toEqual([1400000, 400000]);
		expect(r.earned).toBe(1800000);
	});
});

describe("trigger thu tiền, credit memo, truy thu", () => {
	test("P: hóa đơn tính theo tỷ lệ thu trong kỳ kể cả hóa đơn kỳ trước; cash sale và credit memo theo ngày", () => {
		const r = one({
			plan: { trigger: "P" },
			rows: [
				row({ revenue: 100 * M, collectedRatio: 0.4 }),
				row({ date: "2026-09-20", revenue: 50 * M, collectedRatio: 0.5 }),
				row({ revenue: 80 * M, collectedRatio: 0 }),
				row({ tranType: "S", revenue: 10 * M }),
				row({ tranType: "S", date: "2026-10-30", revenue: 99 * M }),
				row({ tranType: "C", revenue: -5 * M }),
			],
		});
		// 40 + 25 + 10 - 5 = 70tr
		expect(r.base).toBe(70 * M);
		expect(r.earned).toBe(1400000);
	});
	test("credit memo trong kỳ trừ vào cơ sở của người được ghi nhận", () => {
		const r = one({ rows: [row({ revenue: 100 * M }), row({ tranType: "C", revenue: -30 * M })] });
		expect(r.base).toBe(70 * M);
		expect(r.earned).toBe(1400000);
		expect(one({ plan: { includeReturns: false }, rows: [row({ revenue: 100 * M }), row({ tranType: "C", revenue: -30 * M })] }).base).toBe(100 * M);
	});
	test("clawback 60 ngày: hóa đơn 15/09 còn nợ 50% của 80tr trừ 40tr vào kỳ đến hạn", () => {
		const p = plan({ clawbackDays: 60 });
		const lines = CE.normalizeLines([row({ revenue: 100 * M }), row({ date: "2026-09-15", revenue: 80 * M, unpaidRatio: 0.5 })], p, NOV);
		expect(lines.map((l) => [l.kind, l.base, l.creditDate])).toEqual([["N", 100 * M, "2026-11-10"], ["K", -40 * M, "2026-11-14"]]);
		const r = one({ plan: { clawbackDays: 60 }, rows: [row({ revenue: 100 * M }), row({ date: "2026-09-15", revenue: 80 * M, unpaidRatio: 0.5 })] });
		expect(r.base).toBe(60 * M);
		expect(r.earned).toBe(1200000);
		// clawback tắt: bỏ qua unpaidRatio
		expect(one({ rows: [row({ date: "2026-09-15", revenue: 80 * M, unpaidRatio: 0.5 })] }).base).toBe(0);
	});
	test("clawback làm hoa hồng âm: phải trả 0, phần âm thành số dư ứng trước, kỳ sau thu hồi", () => {
		const r = one({ plan: { clawbackDays: 30 }, rows: [row({ date: "2026-10-01", revenue: 100 * M, unpaidRatio: 0.5 })] });
		expect(r.earned).toBe(-1000000);
		expect(r.payable).toBe(0);
		expect(r.drawBalance).toBe(1000000);
		expect(r.warnings.map((w) => w.code)).toContain("NEGATIVE_CARRIED");
		const next = one({ rows: [row({ date: "2026-12-05", revenue: 100 * M })], period: { from: "2026-12-01", to: "2026-12-31" }, extra: { drawBalance: { 101: r.drawBalance } } });
		expect([next.earned, next.drawRecovered, next.payable, next.drawBalance]).toEqual([2000000, 1000000, 1000000, 0]);
	});
});

describe("trần, điều chỉnh", () => {
	test("trần 2.000.000: earned 2.400.000 + điều chỉnh 300.000 -> cắt 700.000", () => {
		const r = one({
			plan: { capAmount: 2 * M }, rows: [row({ revenue: 120 * M })],
			extra: { adjustments: [{ employee: "101", plan: "1", month: 202611, amount: 300000, reason: "Bù đơn tháng 10" }, { employee: "101", plan: "2", amount: 999 }, { employee: "101", month: 202610, amount: 777 }] },
		});
		expect([r.earned, r.adjustments, r.capped, r.payable]).toEqual([2400000, 300000, 700000, 2 * M]);
		expect(r.steps.some((s) => s.vi === "Điều chỉnh tay: 300.000 (Bù đơn tháng 10)")).toBe(true);
	});
	test("trần trống hoặc 0 = không trần; điều chỉnh âm cho người không có doanh số", () => {
		expect(one({ plan: { capAmount: 0 }, rows: [row({ revenue: 120 * M })] }).payable).toBe(2400000);
		const r = one({ rows: [], assignments: [asg("101"), asg("102")], extra: { adjustments: [{ employee: "102", amount: -200000, reason: "Thu lại" }] } }, "102");
		expect([r.adjustments, r.payable, r.drawBalance]).toEqual([-200000, 0, 200000]);
	});
});

describe("draw qua nhiều kỳ", () => {
	const months = [["2026-09-01", "2026-09-30", 100 * M], ["2026-10-01", "2026-10-31", 300 * M], ["2026-11-01", "2026-11-30", 500 * M], ["2026-12-01", "2026-12-31", 100 * M]];
	function series(drawType) {
		let bal = 0;
		return months.map(([from, to, rev]) => {
			const r = one({ plan: { drawType, drawAmount: 5 * M }, period: { from, to }, rows: [row({ date: from, revenue: rev })], extra: { drawBalance: { 101: bal } } });
			bal = r.drawBalance;
			return [r.earned, r.drawPaid, r.drawRecovered, r.payable, r.drawBalance];
		});
	}
	test("R có thu hồi: 2tr -> trả 5tr (dư nợ 3tr); 6tr -> thu 1tr; 10tr -> thu 2tr; 2tr -> lại ứng 3tr", () => {
		expect(series("R")).toEqual([
			[2 * M, 3 * M, 0, 5 * M, 3 * M],
			[6 * M, 0, 1 * M, 5 * M, 2 * M],
			[10 * M, 0, 2 * M, 8 * M, 0],
			[2 * M, 3 * M, 0, 5 * M, 3 * M],
		]);
	});
	test("G bảo đảm: trả bù không thu hồi, không có số dư", () => {
		expect(series("G")).toEqual([
			[2 * M, 3 * M, 0, 5 * M, 0],
			[6 * M, 0, 0, 6 * M, 0],
			[10 * M, 0, 0, 10 * M, 0],
			[2 * M, 3 * M, 0, 5 * M, 0],
		]);
	});
	test("draw R khi hoa hồng âm: số dư tăng cả phần âm lẫn phần trả bù", () => {
		const r = one({ plan: { drawType: "R", drawAmount: 5 * M }, rows: [row({ tranType: "C", revenue: -25 * M })] });
		expect([r.earned, r.drawPaid, r.payable, r.drawBalance]).toEqual([-500000, 5 * M, 5 * M, 5500000]);
	});
	test("nhân viên được phân công nhưng không bán: draw G vẫn trả", () => {
		const r = one({ plan: { drawType: "G", drawAmount: 4 * M }, rows: [] });
		expect([r.base, r.earned, r.payable]).toEqual([0, 0, 4 * M]);
	});
});

describe("cửa sổ quý / năm và true-up", () => {
	const S = [{ rule: "r1", fromValue: 0, rate: 1 }, { rule: "r1", fromValue: 200 * M, rate: 2 }];
	const oct = row({ date: "2026-10-15", revenue: 150 * M });
	const nov = row({ date: "2026-11-15", revenue: 100 * M });
	test("tháng 10: 150tr x 1% = 1.500.000; tháng 11 lũy kế 250tr lên bậc 2% = 5.000.000, trừ đã trả 1.500.000 -> 3.500.000", () => {
		const o = one({ plan: { window: "Q" }, rules: [rule({ method: "S" })], tiers: S, period: OCT, rows: [oct], windowRows: [oct] });
		expect([o.base, o.windowBase, o.gross, o.earned, o.quota, o.attainment]).toEqual([150 * M, 150 * M, 1500000, 1500000, 100 * M, 150]);
		const n = one({ plan: { window: "Q" }, rules: [rule({ method: "S" })], tiers: S, rows: [nov], windowRows: [oct, nov], extra: { priorPaid: { 101: o.earned } } });
		expect([n.base, n.windowBase, n.quota, n.attainment, n.gross, n.priorPaid, n.earned, n.payable]).toEqual([100 * M, 250 * M, 200 * M, 125, 5 * M, 1500000, 3500000, 3500000]);
		expect(n.window).toEqual({ from: "2026-10-01", to: "2026-11-30" });
		expect(n.steps.some((s) => s.vi === "Hoa hồng lũy kế cửa sổ 5.000.000 - đã trả các kỳ trước 1.500.000 = 3.500.000")).toBe(true);
		expect(n.steps.some((s) => s.vi === "Cơ sở lũy kế quý 2026-10-01 - 2026-11-30: 250.000.000")).toBe(true);
	});
	test("chỉ tiêu theo tháng ghi đè chỉ tiêu phân công; Y cộng mọi tháng từ đầu năm", () => {
		const n = one({ plan: { window: "Q" }, rows: [nov], windowRows: [oct, nov], quotas: [{ plan: "1", employee: "101", month: 202611, quota: 150 * M }] });
		expect([n.quota, n.attainment]).toEqual([250 * M, 100]);
		const y = one({ plan: { window: "Y" }, rows: [nov], windowRows: [oct, nov], assignments: [asg("101", { effective: "2026-07-01", quota: 50 * M })] });
		// tháng 7 - 11: 5 x 50tr
		expect([y.quota, y.attainment]).toEqual([250 * M, 100]);
	});
	test("người chỉ có doanh số các tháng trước của cửa sổ vẫn có kết quả (true-up)", () => {
		const r = run({ plan: { window: "Q" }, rows: [], windowRows: [oct], extra: { priorPaid: { 101: 2 * M } } }).results[0];
		expect([r.base, r.windowBase, r.gross, r.earned]).toEqual([0, 150 * M, 3 * M, 1 * M]);
	});
});

describe("hoa hồng quản lý", () => {
	const assignments = [asg("101", { manager: "900" }), asg("102", { manager: "900" }), asg("103")];
	const rows = [row({ revenue: 100 * M, department: "31" }), row({ revenue: 40 * M, salesRep: "102", department: "32" }), row({ revenue: 10 * M, salesRep: "103" })];
	test("B: 5% x doanh số kỳ của cấp dưới trực tiếp; quản lý không cần là người bán", () => {
		const res = run({ plan: { overridePct: 5, overrideBasis: "B" }, assignments, rows, extra: { names: { 101: "An" } } });
		const m = res.results.find((r) => r.employee === "900");
		expect(m.overrides).toEqual([{ employee: "101", basis: "B", base: 100 * M, amount: 5 * M }, { employee: "102", basis: "B", base: 40 * M, amount: 2 * M }]);
		expect([m.base, m.earned, m.override, m.payable]).toEqual([0, 0, 7 * M, 7 * M]);
		expect(m.steps[0].vi).toBe("Hoa hồng quản lý từ An (101): 5% x doanh số 100.000.000 = 5.000.000");
		// chi phí theo phòng ban của cấp dưới
		expect(m.shares).toEqual([{ sub: "31", workCenter: "", branch: "", project: "", amount: 5 * M }, { sub: "32", workCenter: "", branch: "", project: "", amount: 2 * M }]);
		expect(res.results.map((r) => r.employee)).toEqual(["101", "102", "103", "900"]);
	});
	test("C: 5% x hoa hồng của cấp dưới (2.000.000 và 800.000) = 140.000; quản lý cũng là người bán", () => {
		const res = run({ plan: { override_pct: 5, override_basis: "C" }, assignments: assignments.concat([asg("900")]), rows: rows.concat([row({ revenue: 50 * M, salesRep: "900" })]) });
		const m = res.results.find((r) => r.employee === "900");
		expect([m.earned, m.override, m.payable]).toEqual([1 * M, 140000, 1140000]);
		expect(sumShares(m)).toBe(m.payable);
	});
});

describe("phân bổ chi phí theo phân đoạn", () => {
	const rows = [
		row({ revenue: 60 * M, department: "31", classId: "41", location: "61", project: "501" }),
		row({ revenue: 40 * M, department: "32", classId: "42", location: "62" }),
		row({ tranType: "C", revenue: -10 * M, department: "33" }),
	];
	test("payable chia theo cơ sở dương của từng phân đoạn (department -> sub, class -> workCenter, location -> branch)", () => {
		const r = one({ rows });
		expect(r.payable).toBe(1800000);
		expect(r.shares).toEqual([
			{ sub: "31", workCenter: "41", branch: "61", project: "501", amount: 1080000 },
			{ sub: "32", workCenter: "42", branch: "62", project: "", amount: 720000 },
		]);
	});
	test("draw trả bù cũng chia theo cùng tỷ trọng; phần lẻ dồn vào phân đoạn lớn nhất; tổng luôn bằng payable", () => {
		const r = one({ plan: { drawType: "R", drawAmount: 5 * M }, rows });
		expect(r.shares.map((s) => s.amount)).toEqual([3 * M, 2 * M]);
		const eq = one({ rows: ["31", "32", "33"].map((d) => row({ revenue: 50 * M / 3, department: d })), extra: { adjustments: [{ employee: "101", amount: 1 }] } });
		expect(eq.payable).toBe(1000001);
		expect(sumShares(eq)).toBe(eq.payable);
		for (const res of [one({ rows }), one({ plan: { capAmount: 999999 }, rows })]) expect(sumShares(res)).toBe(res.payable);
	});
	test("không có credit (chỉ draw) thì một phần không phân đoạn; payable 0 thì không có phần nào", () => {
		expect(one({ plan: { drawType: "G", drawAmount: 1 * M }, rows: [] }).shares).toEqual([{ sub: "", workCenter: "", branch: "", project: "", amount: 1 * M }]);
		expect(one({ rows: [] }).shares).toEqual([]);
	});
});

describe("tổng và cảnh báo kế hoạch", () => {
	test("totals và NO_EARNING_TYPE", () => {
		const res = run({ plan: { earningType: "" }, assignments: [asg("101"), asg("102")], rows: [row({ revenue: 10 * M }), row({ revenue: 20 * M, salesRep: "102" })] });
		expect(res.totals).toEqual({ base: 30 * M, payable: 600000, employees: 2 });
		expect(res.results[0].warnings.map((w) => w.code)).toContain("NO_EARNING_TYPE");
	});
	test("nhận cấu hình theo tên trường Schema (snake_case)", () => {
		const p = { id: "7", name: "KH7", basis: "R", trigger: "I", credit_source: "R", window: "M", earning_type: "hoahong", cap_amount: 1 * M, draw_type: "N" };
		const credits = CE.credit(CE.normalizeLines([row({ revenue: 100 * M })], p, NOV), p, [{ plan: "7", employee: "101", effective: "2026-01-01", quota: 100 * M }]);
		const res = CE.calculate({ plan: p, rules: [{ id: "9", plan: "7", name: "X", method: "P", rate: 2 }], tiers: [], assignments: [{ plan: "7", employee: "101", quota: 100 * M }], credits, from: NOV.from, to: NOV.to });
		expect(res.results[0]).toMatchObject({ plan: "7", planCode: "KH7", earningType: "HOAHONG", earned: 2 * M, capped: 1 * M, payable: 1 * M });
	});
});

describe("simulate và định dạng số", () => {
	test("2% + thưởng mốc 120%: 120tr / chỉ tiêu 100tr = 2.400.000 + 5.000.000; trần 6.000.000", () => {
		const input = {
			plan: plan(), rules: [rule(), rule({ id: "r2", sequence: 2, name: "Thưởng", method: "B" })], tiers: [{ rule: "r2", fromValue: 120, amount: 5 * M }],
			base: 120 * M, qty: 0, quota: 100 * M,
		};
		const s = CE.simulate(input);
		expect([s.amount, s.attainment, s.capped]).toEqual([7400000, 120, 0]);
		expect(s.components.map((c) => c.amount)).toEqual([2400000, 5 * M]);
		expect(s.steps[1]).toEqual({ vi: "% đạt = 120.000.000 / 100.000.000 x 100 = 120%", en: "Attainment = 120,000,000 / 100,000,000 x 100 = 120%" });
		const c = CE.simulate(Object.assign({}, input, { plan: plan({ capAmount: 6 * M }) }));
		expect([c.amount, c.gross, c.capped]).toEqual([6 * M, 7400000, 1400000]);
	});
	test("fmt: vi 1.234.567,5; en 1,234,567.5; số âm; làm tròn", () => {
		expect(CE.fmt(1234567.5, "vi", 2)).toBe("1.234.567,5");
		expect(CE.fmt(1234567.5, "en", 2)).toBe("1,234,567.5");
		expect(CE.fmt(-1234567, "vi")).toBe("-1.234.567");
		expect(CE.fmt(999.995, "vi", 2)).toBe("1.000");
	});
});
