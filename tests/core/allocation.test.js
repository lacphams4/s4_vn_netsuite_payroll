// Phân bổ chi phí lương (đặc tả 4.5, ca 4.8.4).
const { core } = require("./helpers");
const Alloc = core("ProjectCostAllocator");
const Resolver = core("AllocationSourceResolver");
const Builder = core("CostAllocationBuilder");

const PS = "2026-10-01";
const PE = "2026-10-31";
const T = (project, hours, extra) => Object.assign({ project, task: "", costCode: "", branch: "", workCenter: "", source: "T", weight: hours, hours }, extra);

describe("ProjectCostAllocator 4.5.5", () => {
  test("TC-PB-01 theo giờ 88/44/44", () => {
    const res = Alloc.allocate([T("A", 88), T("B", 44), T("C", 44)], [{ component: "GROSS", amount: 37050000 }]);
    expect(res.map((r) => r.amount)).toEqual([18525000, 9262500, 9262500]);
    expect(res[0].ratio).toBe(0.5);
  });
  test("TC-PB-02 chênh lệch trừ ở dòng đầu khi trọng số bằng nhau", () => {
    expect(Alloc.split(10000001, [1, 1, 1])).toEqual([3333333, 3333334, 3333334]);
  });
  test("TC-PB-03 dự án và không dự án", () => {
    expect(Alloc.allocate([T("A", 160), T("", 16)], [{ component: "GROSS", amount: 17600000 }]).map((r) => r.amount)).toEqual([16000000, 1600000]);
  });
  test("gộp đích trùng", () => {
    const res = Alloc.allocate([T("A", 40), T("A", 48), T("B", 88)], [{ component: "GROSS", amount: 10000000 }]);
    expect(res.map((r) => [r.project, r.amount, r.hours])).toEqual([["A", 5000000, 88], ["B", 5000000, 88]]);
  });
  test("khác task", () => {
    expect(Alloc.allocate([T("A", 30, { task: "01" }), T("A", 10, { task: "02" })], [{ component: "GROSS", amount: 4000000 }]).map((r) => r.amount)).toEqual([3000000, 1000000]);
  });
  test("không giờ: toàn bộ vào dòng đầu", () => {
    expect(Alloc.split(1000, [0, 0])).toEqual([1000, 0]);
  });
  test("không đích -> lỗi; trọng số âm -> lỗi; allocateDirect rỗng khi 0", () => {
    expect(() => Alloc.allocate([], [{ component: "GROSS", amount: 1 }])).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
    expect(() => Alloc.split(10, [1, -1])).toThrow(expect.objectContaining({ code: "VP-INVALID-INPUT" }));
    expect(Alloc.allocateDirect("GROSS", 0, [T("A", 1)])).toEqual([]);
  });
});

describe("Bảng tỷ lệ có phiên bản và nguồn trọng số 4.5.2 - 4.5.3", () => {
  const versions = [
    { versionNbr: 1, status: "S", effectiveDate: "2026-09-01", expirationDate: "2026-10-15", lines: [{ project: "A", percent: 60 }, { project: "B", percent: 40 }] },
    { versionNbr: 2, status: "A", effectiveDate: "2026-10-16", expirationDate: null, lines: [{ project: "A", percent: 30 }, { project: "C", percent: 70 }] },
  ];
  const run = (input) => Resolver.resolve(Object.assign({ periodStart: PS, periodEnd: PE, versions }, input));
  const amounts = (targets, total) => Alloc.allocate(targets, [{ component: "GROSS", amount: total }]).map((r) => [r.project, r.version, r.amount]);

  test("SIT-V2-01 chế độ D: 4 đích", () => {
    expect(amounts(run({ method: "F", versionMode: "D" }), 31000000)).toEqual([["A", 1, 9000000], ["B", 1, 6000000], ["A", 2, 4800000], ["C", 2, 11200000]]);
  });
  test("AP-16 chế độ E: phiên bản 2", () => {
    expect(amounts(run({ method: "F", versionMode: "E" }), 31000000)).toEqual([["A", 2, 9300000], ["C", 2, 21700000]]);
  });
  test("AP-17 chế độ E, phiên bản duy nhất hết hạn 20/10 vẫn dùng", () => {
    const v = [{ versionNbr: 1, status: "S", effectiveDate: "2026-09-01", expirationDate: "2026-10-20", lines: [{ project: "A", percent: 100 }] }];
    expect(Resolver.resolve({ method: "F", versionMode: "E", periodStart: PS, periodEnd: PE, versions: v }).map((t) => [t.project, t.version])).toEqual([["A", 1]]);
  });
  test("AP-18 chế độ D, ngày trống chia theo tỷ lệ có hiệu lực", () => {
    const v = [{ versionNbr: 1, status: "A", effectiveDate: "2026-10-16", lines: [{ project: "A", percent: 25 }, { project: "B", percent: 75 }] }];
    expect(amounts(Resolver.resolve({ method: "F", versionMode: "D", periodStart: PS, periodEnd: PE, versions: v }), 10000000).map((r) => r[2])).toEqual([2500000, 7500000]);
  });
  test("AP-12 timesheet không giờ, fallback D -> dự án mặc định nguồn D", () => {
    const res = run({ method: "T", fallback: "D", timeLines: [{ project: "X", hours: 0 }], defaultProject: "DEF", defaultTask: "00" });
    expect(res).toEqual([expect.objectContaining({ project: "DEF", task: "00", source: "D", weight: 100 })]);
  });
  test("SIT-V2-02 timesheet không giờ, fallback P -> bảng tỷ lệ cả v1 và v2", () => {
    const res = run({ method: "T", fallback: "P", versionMode: "D", timeLines: [] });
    expect(new Set(res.map((t) => t.version))).toEqual(new Set([1, 2]));
    expect(res.every((t) => t.source === "P")).toBe(true);
  });
  test("AP-13 phương pháp F bỏ qua giờ timesheet", () => {
    const res = run({ method: "F", versionMode: "E", timeLines: [{ project: "X", hours: 8 }] });
    expect(res.map((t) => t.project)).toEqual(["A", "C"]);
  });
  test("AP-14 / AP-15 không có bảng tỷ lệ dùng được", () => {
    const drafts = [{ versionNbr: 1, status: "D", effectiveDate: "2026-10-01", lines: [{ project: "A", percent: 100 }] }, { versionNbr: 2, status: "A", effectiveDate: "2026-12-01", lines: [{ project: "B", percent: 100 }] }];
    expect(Resolver.resolve({ method: "F", periodStart: PS, periodEnd: PE, versions: drafts, defaultProject: "DEF" })[0]).toMatchObject({ project: "DEF", source: "D" });
    expect(Resolver.resolve({ method: "F", periodStart: PS, periodEnd: PE, versions: drafts })[0]).toMatchObject({ project: "", source: "D" });
  });
  test("AP-07 kích hoạt v2 hiệu lực 16/10 khi v1 Active", () => {
    const vs = [
      { versionNbr: 1, status: "A", effectiveDate: "2026-09-01", lines: [{ project: "A", percent: 60 }, { project: "B", percent: 40 }] },
      { versionNbr: 2, status: "D", effectiveDate: null, lines: [{ project: "A", percent: 30 }, { project: "C", percent: 70 }] },
    ];
    const res = Resolver.activateVersion(vs, 2, "2026-10-16");
    expect(res[0]).toMatchObject({ status: "S", expirationDate: "2026-10-15" });
    expect(res[1]).toMatchObject({ status: "A", effectiveDate: "2026-10-16", expirationDate: null, totalPercent: 100 });
    expect(() => Resolver.activateVersion(vs, 2, "2026-10-16", { lastReleasedPeriodEnd: "2026-10-31" })).toThrow();
    expect(() => Resolver.activateVersion([{ versionNbr: 1, status: "D", lines: [{ project: "A", percent: 90 }] }], 1, "2026-10-01")).toThrow();
    expect(Resolver.newVersion(vs)).toMatchObject({ versionNbr: 3, status: "D", lines: vs[0].lines });
  });
  test("validateLines: trùng đích, thiếu đích, tỷ lệ ngoài khoảng", () => {
    expect(Resolver.validateLines([{ project: "a", percent: 50 }, { project: "A", percent: 50 }], true).length).toBe(1);
    expect(Resolver.validateLines([{ percent: 100 }], true).length).toBe(1);
    expect(Resolver.validateLines([{ project: "A", percent: 0 }], false).length).toBe(1);
  });
});

describe("Phân ca và nguồn nào đích đó (4.5.4)", () => {
  const roster = (branch, wc, n, start = 1) => Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(start + i).padStart(2, "0")}`, shiftCode: "HC", branch, workCenter: wc }));

  test("PA03 phân ca HCM 8 + 7, HN 10", () => {
    const targets = Resolver.resolve({ method: "R", periodStart: PS, periodEnd: PE, rosterDays: [...roster("HCM", "", 8), ...roster("HCM", "", 7, 9), ...roster("HN", "", 10, 16), { date: "2026-10-30", shiftCode: "" }] });
    const res = Alloc.allocate(targets, [{ component: "GROSS", amount: 10000000 }, { component: "ERINS", amount: 2150000 }]);
    expect(res.map((r) => [r.component, r.branch, r.amount])).toEqual([["GROSS", "HCM", 6000000], ["GROSS", "HN", 4000000], ["ERINS", "HCM", 1290000], ["ERINS", "HN", 860000]]);
  });

  test("PA04 work center 9 / 11 / 6 ngày, tổng đúng 9.876.543", () => {
    const targets = Resolver.resolve({ method: "R", periodStart: PS, periodEnd: PE, defaultBranch: "NM1", rosterDays: [...roster("", "WC-LAP", 9), ...roster("", "WC-HAN", 11, 10), ...roster("", "WC-SON", 6, 21)] });
    const res = Alloc.allocate(targets, [{ component: "GROSS", amount: 9876543 }]);
    expect(res).toHaveLength(3);
    expect(res.reduce((s, r) => s + r.amount, 0)).toBe(9876543);
    expect(res.every((r) => r.branch === "NM1")).toBe(true);
  });

  test("PA05 phân ca không có đích -> bảng tỷ lệ 100% WC-LAP", () => {
    const res = Resolver.resolve({
      method: "R", fallback: "P", periodStart: PS, periodEnd: PE, rosterDays: roster("", "", 5),
      versions: [{ versionNbr: 1, status: "A", effectiveDate: "2026-01-01", lines: [{ workCenter: "WC-LAP", percent: 100 }] }],
    });
    expect(res).toEqual([expect.objectContaining({ source: "P", workCenter: "WC-LAP" })]);
  });

  const accounts = { workCenters: { "WC-LAP": { account: "622", sub: "SX" } }, projects: { P1: { account: "632" } }, employeeAccount: "", defaultAccount: "642", defaultSub: "QL" };

  test("PA06 lương sản phẩm theo phiếu: WC-LAP 714.286, WC-HAN 285.714; phần còn lại theo đích", () => {
    const shares = [
      { rateTable: "CONGDOAN", project: "", branch: "", workCenter: "WC-LAP", amount: 100000 },
      { rateTable: "CONGDOAN", project: "", branch: "", workCenter: "WC-HAN", amount: 200000 },
      { rateTable: "CONGDOAN", project: "", branch: "", workCenter: "WC-LAP", amount: 400000 },
    ];
    const res = Builder.build({
      grossPay: 6000000, employerInsurance: 1000000, defaultBranch: "HCM", accounts,
      earnings: [{ earningType: "LUONG", amount: 5000000, source: "S", quantitySource: "B" }, { earningType: "SANPHAM", amount: 1000000, source: "S", quantitySource: "O", rateTable: "CONGDOAN" }],
      outputShares: shares,
      targets: [{ project: "", task: "", costCode: "", branch: "", workCenter: "", source: "D", weight: 100 }],
    });
    expect(res.map((r) => [r.component, r.source, r.workCenter, r.amount, r.account])).toEqual([
      ["GROSS", "S", "WC-LAP", 714286, "622"], ["GROSS", "S", "WC-HAN", 285714, "642"], ["GROSS", "D", "", 5000000, "642"], ["ERINS", "D", "", 1000000, "642"],
    ]);
    expect(res[0]).toMatchObject({ branch: "HCM", sub: "SX" });
    expect(res.reduce((s, r) => s + r.amount, 0)).toBe(7000000);
  });

  test("PA07 đích thiếu chi nhánh, work center nhận mặc định; đích có HN giữ HN", () => {
    const res = Builder.build({
      grossPay: 1000, employerInsurance: 0, defaultBranch: "HCM", defaultWorkCenter: "WC-LAP", accounts,
      earnings: [], targets: [{ project: "P1", source: "P", weight: 50 }, { project: "P2", branch: "HN", source: "P", weight: 50 }],
    });
    expect(res.map((r) => [r.project, r.branch, r.workCenter, r.account])).toEqual([["P1", "HCM", "WC-LAP", "622"], ["P2", "HN", "WC-LAP", "622"]]);
  });

  test("OT có dự án khi nguồn không phải timesheet đi thẳng vào dự án; dòng tay có chi nhánh đi thẳng", () => {
    const res = Builder.build({
      grossPay: 10000000, employerInsurance: 2000000, accounts,
      earnings: [
        { earningType: "LUONG", amount: 8000000, source: "S", quantitySource: "B" },
        { earningType: "OT150", amount: 1500000, source: "T", project: "P1", hours: 20 },
        { earningType: "THUONG", amount: 500000, source: "M", branch: "HN" },
      ],
      targets: [{ project: "", source: "D", weight: 100 }],
    });
    expect(res.map((r) => [r.component, r.source, r.project, r.branch, r.amount, r.account])).toEqual([
      ["GROSS", "S", "", "HN", 500000, "642"], ["GROSS", "T", "P1", "", 1500000, "632"], ["GROSS", "D", "", "", 8000000, "642"], ["ERINS", "D", "", "", 2000000, "642"],
    ]);
  });

  test("tài khoản: work center -> dự án -> nhân viên -> mặc định", () => {
    expect(Builder.resolveAccount({ workCenter: "WC-LAP", project: "P1" }, accounts)).toEqual({ account: "622", sub: "SX" });
    expect(Builder.resolveAccount({ project: "P1" }, accounts)).toEqual({ account: "632", sub: "QL" });
    expect(Builder.resolveAccount({}, Object.assign({}, accounts, { employeeAccount: "6411", employeeSub: "KD" }))).toEqual({ account: "6411", sub: "KD" });
    expect(Builder.resolveAccount({}, accounts)).toEqual({ account: "642", sub: "QL" });
  });
});
