// PlanRecords: record giấy phép / bảng tỷ lệ -> cấu trúc lõi, kiểm tra giấy phép cho kỳ lương (3.9), ngày cuối kỳ đã ghi
// sổ có dùng bảng tỷ lệ (4.5.3). Ca vàng SIT-V2-01, AP-16, AP-07 (4.8.4), ca 37 - 39 (3.10).
const { core } = require("./helpers");
const Plan = core("PlanRecords");
const Resolver = core("AllocationSourceResolver");
const Allocator = core("ProjectCostAllocator");

const PS = "2026-10-01";
const PE = "2026-10-31";

const recV1 = { id: "11", employee: "7", version: 1, status: "S", effective: "2026-09-01", expiration: "2026-10-15" };
const recV2 = { id: "12", employee: "7", version: 2, status: "A", effective: "2026-10-16", expiration: null };
const lines = {
	11: [{ id: "1", version: "11", project: "A", percent: 60 }, { id: "2", version: "11", project: "B", percent: 40 }],
	12: [{ id: "3", version: "12", project: "A", percent: 30 }, { id: "4", version: "12", project: "C", percent: 70 }],
};
const versions = [Plan.versionFromRecords(recV1, lines[11]), Plan.versionFromRecords(recV2, lines[12])];

function amounts(targets, total) {
	const merged = Allocator.merge(targets);
	const parts = Allocator.split(total, merged.map((t) => t.weight));
	return merged.map((t, i) => [t.project, t.version, parts[i]]);
}

describe("PlanRecords - bảng tỷ lệ", () => {
	test("chuyển record sang phiên bản lõi", () => {
		expect(versions[1]).toMatchObject({ id: "12", versionNbr: 2, status: "A", effectiveDate: "2026-10-16", expirationDate: null });
		expect(versions[1].lines[0]).toEqual({ id: "3", project: "A", task: "", costCode: "", branch: "", workCenter: "", sub: "", percent: 30 });
		expect(Plan.lineToRecord({ project: "P", branch: "L1", workCenter: "C1", sub: "D1", percent: "25" })).toEqual({ project: "P", department: "D1", location: "L1", work_center: "C1", percent: 25 });
	});
	test("SIT-V2-01 chế độ D từ record: 4 đích", () => {
		const t = Resolver.resolve({ method: "F", versionMode: "D", periodStart: PS, periodEnd: PE, versions });
		expect(amounts(t, 31000000)).toEqual([["A", 1, 9000000], ["B", 1, 6000000], ["A", 2, 4800000], ["C", 2, 11200000]]);
	});
	test("AP-16 chế độ E từ record: phiên bản 2", () => {
		const t = Resolver.resolve({ method: "F", versionMode: "E", periodStart: PS, periodEnd: PE, versions });
		expect(amounts(t, 31000000)).toEqual([["A", 2, 9300000], ["C", 2, 21700000]]);
	});
	test("AP-07 kích hoạt từ record nháp, chặn ngày trong kỳ đã ghi sổ", () => {
		const v1 = Plan.versionFromRecords({ id: "21", version: 1, status: "A", effective: "2026-09-01" }, lines[11]);
		const v2 = Plan.versionFromRecords({ id: "22", version: 2, status: "D" }, lines[12]);
		const res = Resolver.activateVersion([v1, v2], 2, "2026-10-16");
		expect(res[0]).toMatchObject({ id: "21", status: "S", expirationDate: "2026-10-15" });
		expect(res[1]).toMatchObject({ id: "22", status: "A", effectiveDate: "2026-10-16" });
		const last = Plan.lastReleasedPlanEnd([
			{ status: "R", periodEnd: "2026-09-30", allocations: [{ source: "P", version: 1 }] },
			{ status: "R", periodEnd: "2026-10-31", allocations: [{ source: "D", version: null }] },
			{ status: "V", periodEnd: "2026-11-30", allocations: [{ source: "P", version: 1 }] },
		]);
		expect(last).toBe("2026-09-30");
		expect(() => Resolver.activateVersion([v1, v2], 2, "2026-09-20", { lastReleasedPeriodEnd: last })).toThrow();
		expect(Plan.usedVersions([{ source: "P", version: 2 }, { source: "P", version: 2 }, { source: "T", version: null }, { source: "P", version: 1 }])).toEqual([2, 1]);
	});
});

describe("PlanRecords - giấy phép lao động cho kỳ lương", () => {
	const permit = (id, ref, eff, exp, extra) => Plan.permitFromRecord(Object.assign({ id, name: ref, employee: "9", doc_type: "P", issue_type: "N", status: "A", effective: eff, expiry: exp }, extra || {}), { 1: "WP1" });
	test("Valid, ExpiringSoon, PartiallyCovered (ca 37)", () => {
		expect(Plan.payrollCheck([permit("1", "WP1", "2026-01-01", "2027-12-31")], PS, PE, 60, true)).toMatchObject({ coverage: "Valid", days: 426, warning: null, blocking: false });
		const soon = Plan.payrollCheck([permit("1", "WP1", "2026-01-01", "2026-12-15")], PS, PE, 60, true);
		expect(soon).toMatchObject({ coverage: "ExpiringSoon", days: 45, blocking: false });
		expect(soon.warning.code).toBe("WorkPermit");
		const part = Plan.payrollCheck([permit("1", "WP1", "2026-01-01", "2026-10-15")], PS, PE, 60, true);
		expect(part).toMatchObject({ coverage: "PartiallyCovered", blocking: true });
		expect(Plan.payrollCheck([permit("1", "WP1", "2026-01-01", "2026-10-15")], PS, PE, 60, false).blocking).toBe(false);
	});
	test("Không có giấy: NotCovered, chặn khi bật wp_blocks", () => {
		expect(Plan.payrollCheck([], PS, PE, 60, true)).toMatchObject({ coverage: "NotCovered", blocking: true });
		expect(Plan.payrollCheck([permit("1", "WP1", "2026-01-01", "2027-12-31", { status: "D" })], PS, PE, 60, false)).toMatchObject({ coverage: "NotCovered", blocking: false });
	});
	test("Chuỗi gia hạn (ca 38): giấy trước theo id -> mã", () => {
		const p1 = permit("1", "WP1", "2024-10-16", "2026-10-15");
		const p2 = permit("2", "WP2", "2026-10-16", "2028-10-15", { issue_type: "X", previous: "1" });
		expect(p2.previousRefNbr).toBe("WP1");
		expect(Plan.payrollCheck([p1, p2], PS, PE, 60, true)).toMatchObject({ coverage: "Valid", refNbr: "WP2" });
	});
});
