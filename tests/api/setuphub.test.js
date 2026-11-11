// Mô-đun route api/SetupHub (giao diện bản 2 - Thiết lập) với Store giả; Settings, Profiles, CostAccounts và lõi chạy thật.
// Kiểm: tình trạng từng mục và trình tự lần đầu, một câu đếm UNION ALL (hỏng thì đếm từng bảng), tài khoản theo đích (lưu,
// trùng, ngừng dùng không xóa, tình trạng áp dụng), ô thử dùng đúng thứ tự ưu tiên của tính lương, đánh dấu đối chiếu, vai trò.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");

const mockDb = { t: {}, accounts: [], calls: [], writes: [], today: "2026-11-10", failUnion: false, failTables: [], nextId: 900 };
const db = mockDb;

jest.mock("N/log", () => ({ error: () => {}, audit: () => {}, debug: () => {} }), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => mockDb.today }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
	const table = (name) => mockDb.t[name] || (mockDb.t[name] = []);
	const type = (name) => `customrecord_s4vp_${name}`;
	const guard = (name) => {
		if (mockDb.failTables.includes(name)) throw new Error(`Record ${type(name)} not found`);
	};
	const countOf = (key, sql) => {
		if (key === "employee") return table("employee").filter((r) => !r.isInactive && String(r.subsidiary) === /= (\d+)$/.exec(sql.trim())[1]).length;
		if (key === "holiday_year") return table("holiday").filter((r) => !r.isInactive && String(r.date).slice(0, 4) === /= '(\d+)'$/.exec(sql.trim())[1]).length;
		guard(key);
		return table(key).filter((r) => !r.isInactive).length;
	};
	return {
		rec: (name) => ({ type: type(name), fields: new Proxy({}, { get: (t, k) => ({ id: `custrecord_${name}_${String(k)}` }) }) }),
		find(name, opt = {}) {
			mockDb.calls.push(`find:${name}`);
			guard(name);
			let rows = table(name).filter((r) => opt.includeInactive || !r.isInactive);
			if (opt.where === "{subsidiary} = ?") rows = rows.filter((r) => String(r.subsidiary) === String(opt.params[0]));
			else if (opt.where === "{id} = ?") rows = rows.filter((r) => String(r.id) === String(opt.params[0]));
			else if (/^\{account\} IN/.test(opt.where || "")) rows = rows.filter((r) => mockDb.accounts.some((a) => a.id === String(r.account)));
			return rows.map((r) => Object.assign({}, r));
		},
		get(name, id) {
			return this.find(name, { where: "{id} = ?", params: [id], includeInactive: true })[0] || null;
		},
		run(sql, params, tag) {
			mockDb.calls.push(`run:${tag}`);
			if (tag === "s4vp_st_counts") {
				if (mockDb.failUnion || mockDb.failTables.length) throw new Error("Invalid or unsupported search");
				return sql.split(" UNION ALL ").map((part) => {
					const k = /SELECT '(\w+)' AS k/.exec(part)[1];
					return { k, n: countOf(k, part) };
				});
			}
			if (/^s4vp_st_count_/.test(tag)) return [{ k: tag.slice(14), n: countOf(tag.slice(14), sql) }];
			if (tag === "s4vp_st_names") return ["earning_type", "earning_rule", "rate_table"].flatMap((k) => table(k).map((r) => ({ k, name: r.name })));
			if (tag === "s4vp_accounts") return mockDb.accounts.map((a) => ({ id: a.id, acctnumber: a.number, name: a.name, accttype: "Expense" }));
			if (tag === "s4vp_vendors") return [{ id: "70", entityid: "BHXH", companyname: "BHXH TP" }];
			if (tag === "s4vp_st_cost_names") return table("cost_account").map((r) => ({ id: r.id, project_name: r.project ? `Dự án ${r.project}` : null, wc_name: r.work_center ? `Class ${r.work_center}` : null, dept_name: r.department ? `Phòng ${r.department}` : null, account_name: `TK ${r.account}`, sub_name: r.subsidiary ? `Cty ${r.subsidiary}` : null }));
			if (tag === "s4vp_st_account") return mockDb.accounts.filter((a) => a.id === String(params[0])).map((a) => ({ id: a.id }));
			return [];
		},
		create(name, values) {
			mockDb.nextId += 1;
			const row = Object.assign({ id: String(mockDb.nextId), isInactive: false }, values);
			table(name).push(row);
			mockDb.writes.push(["create", name, row.id, values]);
			return row.id;
		},
		update(name, id, values) {
			Object.assign(table(name).find((r) => String(r.id) === String(id)), values);
			mockDb.writes.push(["update", name, String(id), values]);
			return String(id);
		},
		submit(name, id, values) {
			if ("isInactive" in values) throw new Error(`Unknown field ${name}.isInactive`);
			Object.assign(table(name).find((r) => String(r.id) === String(id)), values);
			mockDb.writes.push(["submit", name, String(id), values]);
		},
		remove(name) {
			throw new Error(`SetupHub must not delete ${name}`);
		},
	};
});

const Hub = require(path.join(API, "SetupHub"));

const names = (list) => list.map((name, i) => ({ id: String(i + 1), name, isInactive: false }));
const comp = (id, name, extra) => Object.assign({ id: String(id), name, isInactive: false, effective: "2025-07-01", expiration: null, ee_rate: 0.08, er_rate: 0.175, account: "338", vendor: "70" }, extra);
const cost = (id, target_type, field, target, account, extra) => Object.assign({ id: String(id), isInactive: false, subsidiary: null, target_type, project: null, work_center: null, department: null, labor_type: null, account, effective: null, note: "", [field]: target }, extra);
const itemOf = (status, key) => status.sections.flatMap((s) => s.items).find((i) => i.key === key);
const stepOf = (status, key) => status.steps.find((s) => s.key === key);

function seed() {
	db.accounts = [{ id: "334", number: "334", name: "Phải trả NLĐ" }, { id: "3335", number: "3335", name: "Thuế TNCN" }, { id: "642", number: "642", name: "Chi phí QLDN" }, { id: "622", number: "622", name: "Nhân công trực tiếp" }, { id: "627", number: "627", name: "Sản xuất chung" }, { id: "641", number: "641", name: "Bán hàng" }];
	db.t = {
		setup: [{ id: "1", isInactive: false, name: "Thiết lập lương VN", base_et: "1", acc_payable: "334", acc_pit: "3335", acc_expense: "642", acc_advance: "141", acc_other_ded: "1388", acc_13th: "335", acc_contractor: "3388", pit_vendor: "71", union_fund: true }],
		company: [{ id: "5", isInactive: false, subsidiary: "13", enabled: true, acc_expense: null, chief_accountant: "Trần Thị B" }],
		paygroup: [{ id: "1", name: "DEFAULT", isInactive: false, subsidiary: null, frequency: "M" }],
		period: [
			{ id: "10", name: "202610", paygroup: "1", start: "2026-10-01", end: "2026-10-31", status: "C", att_status: "L", isInactive: false },
			{ id: "11", name: "202611", paygroup: "1", start: "2026-11-01", end: "2026-11-30", status: "O", att_status: "O", isInactive: false },
			{ id: "12", name: "202612", paygroup: "1", start: "2026-12-01", end: "2026-12-31", status: "O", att_status: "O", isInactive: false },
		],
		param: [
			{ id: "1", name: "PIT.SELF_DEDUCTION", effective: "2026-01-01", expiration: null, value: 15500000, description: "Giảm trừ bản thân", legal_ref: "Luật 109/2025/QH15", verified: true, isInactive: false },
			{ id: "2", name: "INS.REFERENCE_WAGE", effective: "2026-07-01", expiration: null, value: 2530000, description: "Mức tham chiếu", legal_ref: "", verified: false, isInactive: false },
			{ id: "3", name: "INS.REFERENCE_WAGE", effective: "2024-07-01", expiration: "2026-06-30", value: 2340000, description: "Mức tham chiếu", legal_ref: "NĐ 73/2024", verified: true, isInactive: false },
		],
		ins_comp: [comp(1, "BHXH_HT"), comp(2, "BHYT"), comp(3, "BHYT", { effective: "2020-01-01", expiration: "2025-06-30" })],
		pit_bracket: names(["b1", "b2"]),
		holiday: [{ id: "1", name: "Tết Dương lịch", date: "2026-01-01", isInactive: false }],
		earning_type: names(["LUONG", "PHUCAP"]),
		earning_rule: names(["BASE"]),
		benefit_pkg: [],
		leave_type: names(["PN"]),
		leave_policy: [{ id: "1", name: "STD", description: "Phép năm tiêu chuẩn", isInactive: false }],
		att_symbol: names(["X"]),
		att_rule: [],
		shift: [],
		shift_pattern: [],
		rate_table: [],
		team: [],
		employee: [{ id: "1", subsidiary: "13", isInactive: false }, { id: "2", subsidiary: "14", isInactive: false }],
		cost_account: [],
	};
}

beforeEach(() => {
	Object.assign(db, { calls: [], writes: [], today: "2026-11-10", failUnion: false, failTables: [], nextId: 900 });
	seed();
});

describe("setupStatus", () => {
	test("thiết lập đủ: mọi bước xong, các mục bắt buộc ở trạng thái ok, chỉ còn tham số chưa đối chiếu cần chú ý", () => {
		const s = Hub.setupStatus({ subsidiary: "13" });
		expect(s.ready).toBe(true);
		expect(s.firstRun).toBe(false);
		expect(s.steps.map((x) => `${x.key}:${x.state}`)).toEqual(["defaults:done", "industry:todo", "accounts:done", "periods:done", "employees:done"]);
		expect(s.sections.map((x) => x.key)).toEqual(["start", "company", "periods", "legal", "earnings", "attendance", "output"]);
		expect(itemOf(s, "accounts")).toMatchObject({ state: "ok", issues: [] });
		expect(itemOf(s, "insAccounts")).toMatchObject({ state: "ok", count: 2 });
		expect(itemOf(s, "periods")).toMatchObject({ state: "ok", count: 3, lastEnd: "2026-12-31" });
		expect(itemOf(s, "params")).toMatchObject({ state: "attention", count: 3, issues: [{ code: "UNVERIFIED", n: 1, list: ["INS.REFERENCE_WAGE (01/07/2026)"] }] });
		expect(itemOf(s, "employees")).toMatchObject({ state: "ok", count: 1 });
		expect(itemOf(s, "costAccounts")).toMatchObject({ state: "optional", count: 0 });
		expect(itemOf(s, "benefitPkgs").state).toBe("optional");
		expect(itemOf(s, "holidays")).toMatchObject({ state: "ok", count: 1 });
		expect(s.summary.missing).toBe(0);
		expect(s.packs.map((p) => p.code)).toEqual(["CONSTRUCTION", "TRADE", "MANUFACTURING"]);
		expect(s.packs.every((p) => p.loaded === false)).toBe(true);
	});

	test("số lượng danh mục lấy bằng một câu đếm; tổng số truy vấn không phụ thuộc số bản ghi", () => {
		Hub.setupStatus({ subsidiary: "13" });
		expect(db.calls.filter((c) => c === "run:s4vp_st_counts")).toHaveLength(1);
		expect(db.calls.filter((c) => /^run:s4vp_st_count_/.test(c))).toHaveLength(0);
		expect(db.calls.length).toBeLessThanOrEqual(10);
		expect(db.writes).toHaveLength(0);
	});

	test("chưa nạp mặc định: bước hiện tại là Nạp mặc định VN, các mục báo thiếu", () => {
		db.t = { employee: [] };
		const s = Hub.setupStatus({ subsidiary: "13" });
		expect(s.ready).toBe(false);
		expect(s.firstRun).toBe(true);
		expect(stepOf(s, "defaults").state).toBe("current");
		expect(stepOf(s, "industry")).toMatchObject({ state: "todo", optional: true });
		expect(["accounts", "periods", "employees"].map((k) => stepOf(s, k).state)).toEqual(["todo", "todo", "todo"]);
		expect(itemOf(s, "defaults")).toMatchObject({ state: "missing", issues: [{ code: "NOT_LOADED" }] });
		expect(itemOf(s, "general").state).toBe("missing");
		expect(itemOf(s, "accounts").state).toBe("missing");
		expect(itemOf(s, "periods")).toMatchObject({ state: "missing", issues: [{ code: "NO_PERIODS", list: [] }] });
		expect(itemOf(s, "params").state).toBe("missing");
	});

	test("thiếu tài khoản bắt buộc và tài khoản bảo hiểm: bước khai tài khoản là bước hiện tại, nêu đúng mục thiếu", () => {
		Object.assign(db.t.setup[0], { acc_payable: null, acc_13th: null });
		db.t.ins_comp[0].account = null;
		db.t.ins_comp[2].account = null; // dòng hết hiệu lực không tính
		db.t.ins_comp[1].vendor = null;
		const s = Hub.setupStatus({ subsidiary: "13" });
		expect(itemOf(s, "accounts")).toMatchObject({ state: "missing", issues: [{ code: "ACCOUNTS_MISSING", list: ["acc_payable"] }, { code: "ACCOUNTS_OPTIONAL", list: ["acc_13th"] }] });
		expect(itemOf(s, "insAccounts")).toMatchObject({ state: "missing", issues: [{ code: "INS_NO_ACCOUNT", list: ["BHXH_HT"] }, { code: "INS_NO_VENDOR", list: ["BHYT"] }] });
		expect(stepOf(s, "accounts").state).toBe("current");
		expect(s.firstRun).toBe(true);
	});

	test("tài khoản công ty con thắng tài khoản chung; chỉ thiếu mục tùy chọn thì cần chú ý", () => {
		db.t.setup[0].acc_expense = null;
		db.t.company[0].acc_expense = "627";
		db.t.setup[0].pit_vendor = null;
		const s = Hub.setupStatus({ subsidiary: "13" });
		expect(itemOf(s, "accounts")).toMatchObject({ state: "attention", issues: [{ code: "ACCOUNTS_OPTIONAL", list: ["pit_vendor"] }] });
		expect(Hub.setupStatus({ subsidiary: "14" }).sections[1].items.find((i) => i.key === "accounts").state).toBe("missing");
	});

	test("kỳ lương: không có kỳ chứa hôm nay là thiếu; kỳ kế tiếp chưa sinh là cần chú ý", () => {
		db.today = "2026-12-15";
		let s = Hub.setupStatus({ subsidiary: "13" });
		expect(itemOf(s, "periods")).toMatchObject({ state: "attention", issues: [{ code: "NEXT_MISSING", list: ["DEFAULT"] }] });
		expect(itemOf(s, "holidays").state).toBe("ok");
		db.today = "2027-01-05";
		s = Hub.setupStatus({ subsidiary: "13" });
		expect(itemOf(s, "periods")).toMatchObject({ state: "missing", issues: [{ code: "NO_CURRENT", list: ["DEFAULT"] }] });
		expect(stepOf(s, "periods").state).toBe("current");
		expect(itemOf(s, "holidays")).toMatchObject({ state: "attention", issues: [{ code: "NO_HOLIDAYS_YEAR", n: 2027 }] });
	});

	test("nhóm lương của công ty con khác không tính; công ty con chưa có bản ghi riêng thì kế thừa", () => {
		db.t.paygroup.push({ id: "2", name: "XD-W", isInactive: false, subsidiary: "14", frequency: "W" });
		const s = Hub.setupStatus({ subsidiary: "13" });
		expect(s.paygroups.map((g) => g.code)).toEqual(["DEFAULT"]);
		expect(itemOf(s, "paygroups").count).toBe(2);
		expect(itemOf(Hub.setupStatus({ subsidiary: "14" }), "company")).toMatchObject({ state: "optional", issues: [{ code: "INHERITS" }] });
		db.t.company[0].enabled = false;
		expect(itemOf(Hub.setupStatus({ subsidiary: "13" }), "company")).toMatchObject({ state: "attention", issues: [{ code: "COMPANY_DISABLED" }] });
	});

	test("câu đếm gộp hỏng: đếm từng bảng, bảng không đọc được ghi unknown, phần còn lại vẫn đúng", () => {
		db.failTables = ["cost_account"];
		const s = Hub.setupStatus({ subsidiary: "13" });
		expect(itemOf(s, "costAccounts")).toMatchObject({ state: "unknown", issues: [{ code: "UNREADABLE" }] });
		expect(itemOf(s, "earningTypes")).toMatchObject({ state: "ok", count: 2 });
		expect(itemOf(s, "employees").count).toBe(1);
		expect(db.calls.filter((c) => /^run:s4vp_st_count_/.test(c)).length).toBeGreaterThan(5);
	});

	test("gói ngành đã nạp đủ được nhận ra theo mã", () => {
		const Packs = require(path.join(API, "../core/IndustryPacks"));
		const pack = Packs.PACKS.TRADE;
		db.t.earning_type = names(["LUONG"].concat(pack.earningTypes.map((e) => e.code)));
		db.t.earning_rule = names(["BASE"].concat(pack.rules.map((r) => r.code)));
		db.t.rate_table = names(pack.rateTables.map((r) => r.code));
		db.t.paygroup = db.t.paygroup.concat(pack.payGroups.map((g, i) => ({ id: String(50 + i), name: g.code, isInactive: false, subsidiary: "13" })));
		const s = Hub.setupStatus({ subsidiary: "13" });
		expect(itemOf(s, "industry")).toMatchObject({ state: "ok", loaded: ["TRADE"] });
		expect(stepOf(s, "industry").state).toBe("done");
		expect(s.packs.find((p) => p.code === "TRADE").loaded).toBe(true);
	});

	test("công ty con không hợp lệ bị từ chối với thông báo hai ngôn ngữ", () => {
		expect.assertions(2);
		try {
			Hub.setupStatus({ subsidiary: "13 OR 1=1" });
		} catch (e) {
			expect(e.userMessage.vi).toMatch(/không hợp lệ/);
			expect(e.userMessage.en).toMatch(/not valid/);
		}
	});
});

describe("tham số pháp lý", () => {
	test("setupLegal: mục chưa đối chiếu lên đầu, kèm nhóm và cờ đang hiệu lực; không ghi gì", () => {
		const r = Hub.setupLegal();
		expect(r.params.map((p) => p.id)).toEqual(["2", "3", "1"]);
		expect(r.params[0]).toMatchObject({ code: "INS.REFERENCE_WAGE", group: "INS", verified: false, current: true, value: 2530000 });
		expect(r.params[1].current).toBe(false);
		expect(r.unverified).toBe(1);
		expect(r.components.map((c) => c.current)).toEqual([true, true, false]);
		expect(db.writes).toHaveLength(0);
	});

	test("verifyParam chỉ đổi cờ đã đối chiếu, không đụng giá trị; gọi lại không ghi nữa", () => {
		expect(Hub.verifyParam({ id: "2" })).toMatchObject({ id: "2", code: "INS.REFERENCE_WAGE", changed: true });
		expect(db.writes).toEqual([["submit", "param", "2", { verified: true }]]);
		expect(db.t.param[1].value).toBe(2530000);
		expect(Hub.verifyParam({ id: "2" }).changed).toBe(false);
		expect(db.writes).toHaveLength(1);
		expect(() => Hub.verifyParam({ id: "99" })).toThrow(/not found/);
		expect(() => Hub.verifyParam({})).toThrow(/required/);
	});
});

describe("tài khoản mặc định và tài khoản bảo hiểm", () => {
	test("saveSetupAccounts chỉ nhận trường tài khoản; trống là bỏ khai", () => {
		Hub.saveSetupAccounts({ scope: "setup", values: { acc_expense: "627", acc_13th: "", std_days: 26, require_approval: false } });
		expect(db.writes).toEqual([["submit", "setup", "1", { acc_expense: "627", acc_13th: null }]]);
		expect(() => Hub.saveSetupAccounts({ scope: "setup", values: { std_days: 26 } })).toThrow(/Nothing to save/);
		expect(() => Hub.saveSetupAccounts({ scope: "setup", values: { acc_expense: "abc" } })).toThrow(/not valid/);
	});

	test("phạm vi công ty con: cập nhật bản ghi có sẵn hoặc tạo mới cho công ty con chưa có", () => {
		Hub.saveSetupAccounts({ scope: "company", subsidiary: "13", values: { acc_expense: "622" } });
		expect(db.writes[0]).toEqual(["submit", "company", "5", { acc_expense: "622" }]);
		const r = Hub.saveSetupAccounts({ scope: "company", subsidiary: "14", values: { acc_expense: "641" } });
		expect(db.t.company.find((c) => c.id === r.id)).toMatchObject({ subsidiary: "14", enabled: true, acc_expense: "641" });
		expect(() => Hub.saveSetupAccounts({ scope: "company", values: { acc_expense: "641" } })).toThrow(/required/);
	});

	test("saveInsuranceAccounts ghi cho mọi dòng cùng mã, bỏ qua dòng không đổi, mã lạ thì không ghi dở", () => {
		expect(Hub.saveInsuranceAccounts({ items: [{ code: "bhyt", account: "3384", vendor: "70" }, { code: "BHXH_HT", account: "338" }] })).toEqual({ updated: 2 });
		expect(db.t.ins_comp.filter((c) => c.name === "BHYT").map((c) => c.account)).toEqual(["3384", "3384"]);
		db.writes = [];
		expect(() => Hub.saveInsuranceAccounts({ items: [{ code: "BHYT", account: "3385" }, { code: "KHONGCO", account: "1" }] })).toThrow(/KHONGCO/);
		expect(db.writes).toHaveLength(0);
	});
});

describe("tài khoản chi phí lương theo đích", () => {
	test("saveCostAccount: tạo mới, chỉ giữ đích đúng loại, kiểm tài khoản còn dùng", () => {
		const r = Hub.saveCostAccount({ values: { target_type: "P", project: "20", department: "30", account: "622", labor_type: "e", effective: "2026-01-01", subsidiary: "13", note: "Công trình A" } });
		expect(db.t.cost_account.find((c) => c.id === r.id)).toMatchObject({ target_type: "P", project: "20", department: null, work_center: null, account: "622", labor_type: "E", effective: "2026-01-01", subsidiary: "13" });
		expect(() => Hub.saveCostAccount({ values: { target_type: "P", account: "622" } })).toThrow(/Target is required/);
		expect(() => Hub.saveCostAccount({ values: { target_type: "X", account: "622" } })).toThrow(/target type/);
		expect(() => Hub.saveCostAccount({ values: { target_type: "D", department: "30" } })).toThrow(/Expense account is required/);
		expect(() => Hub.saveCostAccount({ values: { target_type: "D", department: "30", account: "999" } })).toThrow(/inactive/);
		expect(() => Hub.saveCostAccount({ values: { target_type: "D", department: "30", account: "622", effective: "2026-02-30" } })).toThrow(/Effective date/);
		expect(() => Hub.saveCostAccount({ values: { target_type: "D", department: "30", account: "622", labor_type: "Z" } })).toThrow(/Labor type/);
	});

	test("không cho hai dòng đang dùng trùng khóa; sửa chính nó thì được; dòng đã ngừng không chặn", () => {
		db.t.cost_account = [cost(1, "D", "department", "30", "642"), cost(2, "D", "department", "31", "642", { isInactive: true })];
		expect(() => Hub.saveCostAccount({ values: { target_type: "D", department: "30", account: "627" } })).toThrow(/already covers/);
		expect(Hub.saveCostAccount({ id: "1", values: { target_type: "D", department: "30", account: "627" } })).toEqual({ id: "1" });
		expect(db.t.cost_account[0].account).toBe("627");
		expect(Hub.saveCostAccount({ values: { target_type: "D", department: "31", account: "627" } }).id).toBeTruthy();
		expect(() => Hub.saveCostAccount({ id: "77", values: { target_type: "D", department: "32", account: "627" } })).toThrow(/Row not found/);
	});

	test("retireCostAccount đặt inactive (không xóa), dùng lại được khi không trùng", () => {
		db.t.cost_account = [cost(1, "D", "department", "30", "642")];
		expect(Hub.retireCostAccount({ id: "1" })).toEqual({ id: "1", inactive: true, changed: true });
		expect(db.t.cost_account).toHaveLength(1);
		expect(db.writes).toEqual([["update", "cost_account", "1", { isInactive: true }]]);
		expect(Hub.retireCostAccount({ id: "1" }).changed).toBe(false);
		db.t.cost_account.push(cost(2, "D", "department", "30", "627"));
		expect(() => Hub.retireCostAccount({ id: "1", restore: true })).toThrow(/already covers/);
		db.t.cost_account[1].isInactive = true;
		expect(Hub.retireCostAccount({ id: "1", restore: true })).toEqual({ id: "1", inactive: false, changed: true });
	});

	test("costAccounts: tên đích, tên tài khoản và tình trạng áp dụng cho công ty con đang chọn", () => {
		db.t.cost_account = [
			cost(1, "D", "department", "30", "642"),
			cost(2, "D", "department", "30", "627", { subsidiary: "13" }),
			cost(3, "P", "project", "20", "622", { effective: "2027-01-01" }),
			cost(4, "W", "work_center", "10", "622", { subsidiary: "14" }),
			cost(5, "W", "work_center", "11", "999"),
			cost(6, "P", "project", "21", "641", { isInactive: true }),
			cost(7, "W", "work_center", "12", "622", { labor_type: "C" }),
		];
		const r = Hub.costAccounts({ subsidiary: "13" });
		const state = Object.fromEntries(r.rows.map((x) => [x.id, x.state]));
		expect(state).toEqual({ 1: "overridden", 2: "inUse", 3: "future", 4: "otherSubsidiary", 5: "accountInactive", 6: "inactive", 7: "inUse" });
		expect(r.rows.find((x) => x.id === "2")).toMatchObject({ targetType: "D", target: "30", targetName: "Phòng 30", accountName: "627 Sản xuất chung", subsidiaryName: "Cty 13", laborType: "" });
		expect(r.rows.find((x) => x.id === "7").laborType).toBe("C");
		expect(r.accounts).toHaveLength(6);
		expect(db.writes).toHaveLength(0);
	});

	test("record chưa đọc được: trả unavailable thay vì ném lỗi", () => {
		db.failTables = ["cost_account"];
		expect(Hub.costAccounts({ subsidiary: "13" })).toMatchObject({ rows: [], unavailable: true });
	});

	test("costAccountTest theo đúng thứ tự ưu tiên class -> dự án -> phòng ban -> mặc định, có xét loại lao động và ngày", () => {
		db.t.cost_account = [
			cost(1, "W", "work_center", "10", "627"),
			cost(2, "P", "project", "20", "622"),
			cost(3, "D", "department", "30", "641"),
			cost(4, "P", "project", "20", "641", { labor_type: "C" }),
			cost(5, "D", "department", "31", "622", { effective: "2027-01-01" }),
		];
		const run = (p) => Hub.costAccountTest(Object.assign({ subsidiary: "13" }, p));
		expect(run({ workCenter: "10", project: "20", department: "30" })).toMatchObject({ account: "627", level: "W", accountName: "627 Sản xuất chung", date: "2026-11-10" });
		expect(run({ project: "20", department: "30" })).toMatchObject({ account: "622", level: "P" });
		expect(run({ project: "20", department: "30", laborType: "C" })).toMatchObject({ account: "641", level: "P" });
		expect(run({ department: "30" })).toMatchObject({ account: "641", level: "D" });
		expect(run({ department: "31" })).toMatchObject({ account: "642", level: "default" });
		expect(run({ department: "31", date: "2027-01-31" })).toMatchObject({ account: "622", level: "D" });
		const none = run({});
		expect(none).toMatchObject({ account: "642", level: "default" });
		expect(none.steps.map((s) => `${s.level}:${s.given}:${s.account}`)).toEqual(["W:false:", "P:false:", "D:false:", "default:true:642"]);
		expect(() => run({ date: "31/01/2027" })).toThrow(/Date is not valid/);
	});

	test("ô thử khi chưa khai tài khoản mặc định và không có dòng khớp: không có tài khoản", () => {
		db.t.setup[0].acc_expense = null;
		expect(Hub.costAccountTest({ subsidiary: "13", department: "30" })).toMatchObject({ account: "", level: "none" });
	});
});

describe("cấp duyệt bảng lương", () => {
	const step = (id, level, name, extra) => Object.assign({ id: String(id), isInactive: false, name, subsidiary: null, level, approver: null, role: null, min_net: null }, extra);

	test("setupStatus: chưa khai dòng nào là duyệt một cấp - trạng thái bình thường, không phải cảnh báo", () => {
		db.t.approval_step = [];
		expect(itemOf(Hub.setupStatus({ subsidiary: "13" }), "approvals")).toMatchObject({ state: "ok", count: 0, levels: 0, issues: [{ code: "SINGLE_LEVEL" }] });
		db.t.approval_step = [step(1, 1, "Kế toán trưởng", { role: "A" }), step(2, 2, "Giám đốc", { approver: "77", min_net: 500000000 }), step(3, 1, "Thiếu người duyệt")];
		expect(itemOf(Hub.setupStatus({ subsidiary: "13" }), "approvals")).toMatchObject({ state: "attention", count: 3, levels: 2, issues: [{ code: "APPROVER_MISSING", n: 1 }] });
		db.failTables = ["approval_step"];
		expect(itemOf(Hub.setupStatus({ subsidiary: "13" }), "approvals").state).toBe("unknown");
	});

	test("approvalSteps: công ty con có dòng riêng thì dòng chung bị thay; các cấp áp dụng theo đúng ApprovalFlow", () => {
		db.t.approval_step = [
			step(1, 1, "Kế toán trưởng", { role: "A" }),
			step(2, 1, "Kế toán trưởng 13", { subsidiary: "13", approver: "77" }),
			step(3, 2, "Giám đốc 13", { subsidiary: "13", role: "D", min_net: 500000000 }),
			step(4, 1, "Công ty 14", { subsidiary: "14", role: "H" }),
			step(5, 3, "Cũ", { subsidiary: "13", role: "A", isInactive: true }),
			step(6, 2, "Thiếu", { subsidiary: "13" }),
		];
		const r = Hub.approvalSteps({ subsidiary: "13" });
		expect(Object.fromEntries(r.rows.map((x) => [x.id, x.state]))).toEqual({ 1: "replaced", 2: "inUse", 3: "inUse", 4: "otherSubsidiary", 5: "inactive", 6: "invalid" });
		expect(r.levels.map((l) => `${l.level}:${l.name}:${l.approvers.map((a) => a.employee || a.role).join("+")}`)).toEqual(["1:Kế toán trưởng 13:77", "2:Giám đốc 13:D"]);
		expect(r.levels[1].approvers[0].minNet).toBe(500000000);
		expect(Hub.approvalSteps({ subsidiary: "15" }).levels.map((l) => l.name)).toEqual(["Kế toán trưởng"]);
		expect(db.writes).toHaveLength(0);
		db.failTables = ["approval_step"];
		expect(Hub.approvalSteps({ subsidiary: "13" })).toMatchObject({ rows: [], unavailable: true });
	});

	test("saveApprovalStep: kiểm cấp, người duyệt, vai trò, ngưỡng, tên; có nhân viên thì không lưu vai trò; chặn trùng", () => {
		db.t.approval_step = [];
		const r = Hub.saveApprovalStep({ values: { level: "2", name: " Giám đốc ", approver: "77", role: "A", min_net: "500000000", subsidiary: "13" } });
		expect(db.t.approval_step.find((x) => x.id === r.id)).toMatchObject({ level: 2, name: "Giám đốc", approver: "77", role: null, min_net: 500000000, subsidiary: "13" });
		expect(() => Hub.saveApprovalStep({ values: { level: "2", name: "X", approver: "77", subsidiary: "13" } })).toThrow(/already on the same level/);
		expect(Hub.saveApprovalStep({ values: { level: "2", name: "X", approver: "77" } }).id).toBeTruthy();
		expect(() => Hub.saveApprovalStep({ values: { level: "0", name: "X", role: "A" } })).toThrow(/whole number/);
		expect(() => Hub.saveApprovalStep({ values: { level: "1.5", name: "X", role: "A" } })).toThrow(/whole number/);
		expect(() => Hub.saveApprovalStep({ values: { level: "1", name: "X" } })).toThrow(/approver or a role/);
		expect(() => Hub.saveApprovalStep({ values: { level: "1", name: "X", role: "Z" } })).toThrow(/role is not valid/);
		expect(() => Hub.saveApprovalStep({ values: { level: "1", name: "X", role: "A", min_net: "-1" } })).toThrow(/threshold/);
		expect(() => Hub.saveApprovalStep({ values: { level: "1", name: " ", role: "A" } })).toThrow(/name is required/);
		expect(Hub.saveApprovalStep({ id: r.id, values: { level: "2", name: "Giám đốc", role: "D", subsidiary: "13" } })).toEqual({ id: r.id });
		expect(db.t.approval_step.find((x) => x.id === r.id)).toMatchObject({ approver: null, role: "D", min_net: null });
	});

	test("retireApprovalStep đặt inactive (không xóa), dùng lại được khi không trùng", () => {
		db.t.approval_step = [step(1, 1, "Kế toán trưởng", { role: "A" })];
		expect(Hub.retireApprovalStep({ id: "1" })).toEqual({ id: "1", inactive: true, changed: true });
		expect(db.writes).toEqual([["update", "approval_step", "1", { isInactive: true }]]);
		db.t.approval_step.push(step(2, 1, "Kế toán", { role: "A" }));
		expect(() => Hub.retireApprovalStep({ id: "1", restore: true })).toThrow(/already on the same level/);
		db.t.approval_step[1].isInactive = true;
		expect(Hub.retireApprovalStep({ id: "1", restore: true })).toMatchObject({ inactive: false, changed: true });
		expect(db.t.approval_step).toHaveLength(2);
	});
});

test("routes: đọc cho mọi vai trò lương; tài khoản và cấp duyệt cho kế toán; đối chiếu tham số cho HR", () => {
	expect(Object.fromEntries(Object.entries(Hub.routes.get).map(([k, v]) => [k, v.roles]))).toEqual({ setupStatus: "all", setupData: "all", setupLegal: "all", costAccounts: "all", costAccountTest: "all", approvalSteps: "all" });
	expect(Object.fromEntries(Object.entries(Hub.routes.post).map(([k, v]) => [k, v.roles]))).toEqual({ saveCostAccount: "acct", retireCostAccount: "acct", saveSetupAccounts: "acct", saveInsuranceAccounts: "acct", saveApprovalStep: "acct", retireApprovalStep: "acct", verifyParam: "hr" });
	for (const r of Object.values(Hub.routes.get).concat(Object.values(Hub.routes.post))) expect(typeof r.run).toBe("function");
});

test("setupData gom thiết lập chung, công ty con, khoản trích, tài khoản, cơ quan thu, chính sách phép", () => {
	const r = Hub.setupData({ subsidiary: "13" });
	expect(r.setup.id).toBe("1");
	expect(r.company.id).toBe("5");
	expect(r.components).toHaveLength(3);
	expect(r.accounts[0]).toEqual({ id: "334", number: "334", name: "Phải trả NLĐ", type: "Expense" });
	expect(r.vendors[0]).toMatchObject({ id: "70", code: "BHXH" });
	expect(r.leavePolicies).toEqual([{ id: "1", code: "STD", name: "Phép năm tiêu chuẩn" }]);
	expect(Hub.setupData({ subsidiary: "14" }).company).toBeNull();
});

test("không phản hồi nào có khóa error ở bất kỳ cấp nào (N/https phía trình duyệt từ chối cả phản hồi)", () => {
	db.t.cost_account = [cost(1, "D", "department", "30", "642")];
	const outs = [
		Hub.setupStatus({ subsidiary: "13" }), Hub.setupData({ subsidiary: "13" }), Hub.setupLegal(), Hub.costAccounts({ subsidiary: "13" }),
		Hub.costAccountTest({ subsidiary: "13", department: "30" }), Hub.verifyParam({ id: "2" }), Hub.retireCostAccount({ id: "1" }), Hub.approvalSteps({ subsidiary: "13" }),
	];
	db.failTables = ["cost_account"];
	outs.push(Hub.setupStatus({ subsidiary: "13" }), Hub.costAccounts({ subsidiary: "13" }), Hub.costAccountTest({ subsidiary: "13" }));
	for (const o of outs) expect(JSON.stringify(o)).not.toMatch(/"error"\s*:/);
});
