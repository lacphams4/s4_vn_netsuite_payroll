// api/CostAccounts.forPayroll: một truy vấn đọc record cost_account (lọc tài khoản inactive ngay trong truy vấn), trả bảng tra
// qua core/CostAccountRules; không đọc được record thì trả bảng rỗng kèm error, không ném lỗi.
const mockDb = { rows: [], calls: [], fail: false, logs: [] };

jest.mock("N/log", () => ({ error: (o) => mockDb.logs.push(o.details), audit: () => {}, debug: () => {} }), { virtual: true });
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => ({
	find(name, opt) {
		mockDb.calls.push([name, opt]);
		if (mockDb.fail) throw new Error("Record customrecord_s4vp_cost_account not found");
		return mockDb.rows;
	},
}));

const CostAccounts = require("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/CostAccounts");
const row = (id, target_type, field, target, account, extra) => Object.assign({ id: String(id), isInactive: false, subsidiary: null, target_type, labor_type: null, account, effective: null, [field]: target }, extra);

beforeEach(() => Object.assign(mockDb, { rows: [], calls: [], fail: false, logs: [] }));

test("một truy vấn, lọc tài khoản inactive, áp công ty con và ngày cuối kỳ", () => {
	mockDb.rows = [
		row(1, "D", "department", "30", "501"), row(2, "D", "department", "30", "502", { subsidiary: "5" }), row(3, "P", "project", "20", "503", { effective: "2027-01-01" }),
		row(4, "W", "work_center", "10", "504", { labor_type: "C" }),
	];
	const maps = CostAccounts.forPayroll("5", "2026-10-31");
	expect(mockDb.calls).toHaveLength(1);
	expect(mockDb.calls[0][0]).toBe("cost_account");
	expect(mockDb.calls[0][1].where).toMatch(/\{account\} IN \(SELECT .* FROM account .*isinactive = 'F'\)/);
	expect(maps).toEqual({ workCenters: { 10: { account: "", byLabor: { C: "504" } } }, projects: {}, departments: { 30: { account: "502", byLabor: {} } } });
});

test("không đọc được record: bảng rỗng kèm error, có ghi log, không ném lỗi", () => {
	mockDb.fail = true;
	const maps = CostAccounts.forPayroll("5", "2026-10-31");
	expect(maps).toEqual({ workCenters: {}, projects: {}, departments: {}, error: expect.stringContaining("cost_account") });
	expect(mockDb.logs).toHaveLength(1);
});
