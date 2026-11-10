// Số liệu chi phí lương (core/LaborCostFacts): phân loại thành phần, chia dòng phân bổ theo cơ cấu thu nhập, làm tròn khớp
// tuyệt đối, bất biến "tổng số liệu = tổng Nợ chi phí của bút toán ghi sổ" (đối chiếu với PayrollJournalBuilder), kế hoạch ghi.
const { core } = require("./helpers");
const F = core("LaborCostFacts");
const J = core("PayrollJournalBuilder");

const earningTypes = { LUONG: "B", OT150: "O", PHUCAP: "A", ANCA: "M", THUONG: "N", KHOAN: "P", KHAC: "X", DEM: { category: "", isOvertime: true } };
const options = { earningTypes, defaultExpenseAccount: "642", defaultLocation: "L0" };
const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
const by = (facts, key) => {
  const o = {};
  for (const f of facts) o[f[key]] = (o[f[key]] || 0) + f.amount;
  return o;
};
const line = (employee, detail, extra) => Object.assign({ employee, employment_type: "E", accrued13: 0, detail: JSON.stringify(detail) }, extra);

const config = {
  payableAccount: "334", contractorPayableAccount: "3388", pitPayableAccount: "3335", otherDeductionAccount: "1388", advanceAccount: "141", accrued13thAccount: "335",
  defaultExpenseAccount: "642", interBranch: true, components: { ER: { name: "BH DN", liabilityAccount: "3383" } },
};

/** Tổng Nợ chi phí của bút toán ghi sổ theo khóa tài khoản | phòng ban | class | địa điểm | dự án (địa điểm trống -> mặc định). */
function journalDebits(lines) {
  const d = (l) => (typeof l.detail === "string" ? JSON.parse(l.detail) : l.detail);
  const model = {
    batchNbr: "BL1", periodId: "202703", branch: "", date: "2027-03-31",
    grossTotal: sum(lines, (l) => sum(d(l).allocations.filter((a) => a.component !== "ERINS"), (a) => a.amount)),
    employerInsTotal: sum(lines, (l) => sum(d(l).allocations.filter((a) => a.component === "ERINS"), (a) => a.amount)),
    employees: lines.map((l) => {
      const x = d(l);
      const gross = sum(x.allocations.filter((a) => a.component !== "ERINS"), (a) => a.amount);
      const er = sum(x.allocations.filter((a) => a.component === "ERINS"), (a) => a.amount);
      return {
        employee: l.employee, employmentType: l.employment_type, netPay: gross, pit: 0, accrued13th: l.accrued13 || 0, expenseAccount: x.expenseAccount || "", expenseSub: x.expenseSub || "",
        insurance: [{ code: "ER", employeeAmount: 0, employerAmount: er }], deductions: [], advanceOffsets: [], allocations: x.allocations,
      };
    }),
  };
  const je = J.buildRelease(model, config);
  const out = {};
  for (const l of je.lines) {
    if (!(l.debit > 0)) continue;
    const k = [l.account, l.sub, l.workCenter, l.branch || "L0", l.project].join("|");
    out[k] = (out[k] || 0) + l.debit;
  }
  return out;
}

function factDebits(facts) {
  const out = {};
  for (const f of facts) {
    const k = [f.account, f.department, f.class, f.location, f.project].join("|");
    out[k] = (out[k] || 0) + f.amount;
  }
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}

describe("Phân loại thành phần", () => {
  test("nhóm thu nhập -> thành phần", () => {
    expect(F.CATEGORY).toEqual({ B: "wages", O: "overtime", A: "allowance", M: "allowance", N: "bonus", P: "piecework", X: "other" });
    expect(["B", "O", "A", "M", "N", "P", "X"].map((c) => F.componentOf(c))).toEqual(["wages", "overtime", "allowance", "allowance", "bonus", "piecework", "other"]);
    expect(F.componentOf("", true)).toBe("overtime");
    expect(F.componentOf(null, false)).toBe("other");
    expect(F.componentOf("?", false)).toBe("other");
    expect(F.COMPONENTS).toEqual(["wages", "overtime", "allowance", "bonus", "piecework", "other", "employerIns", "accrued13", "contractor"]);
  });
});

describe("Dòng số liệu của một nhân viên", () => {
  const detail = () => ({
    earnings: [
      { earningType: "LUONG", amount: 20000000, source: "S" }, { earningType: "PHUCAP", amount: 5000000, source: "S" }, { earningType: "ANCA", amount: 730000, source: "S" },
      { earningType: "OT150", amount: 4270000, source: "S" }, { earningType: "THUONG", amount: 880000, source: "M" },
    ],
    allocations: [
      { component: "GROSS", amount: 20000000, account: "642", sub: "D1", project: "", branch: "", workCenter: "", source: "D", hours: 0 },
      { component: "GROSS", amount: 10880000, account: "632", sub: "D2", project: "P1", branch: "L1", workCenter: "WC1", source: "P", hours: 0 },
      { component: "ERINS", amount: 4515000, account: "642", sub: "D1", project: "", branch: "", workCenter: "" },
      { component: "ERINS", amount: 2535000, account: "632", sub: "D2", project: "P1", branch: "L1", workCenter: "WC1" },
    ],
    expenseAccount: "6421", expenseSub: "D9",
  });

  test("GROSS chia theo cơ cấu thu nhập; tổng theo dòng phân bổ và theo thành phần khớp tuyệt đối", () => {
    const facts = F.employeeFacts(line("7", detail(), { accrued13: 2500000 }), options);
    expect(by(facts, "component")).toEqual({ wages: 20000000, allowance: 5730000, overtime: 4270000, bonus: 880000, employerIns: 7050000, accrued13: 2500000 });
    const d1 = facts.filter((f) => f.account === "642" && f.component !== "employerIns");
    expect(sum(d1, (f) => f.amount)).toBe(20000000);
    expect(d1.every((f) => f.department === "D1" && f.location === "L0" && f.class === "" && f.project === "" && f.employmentType === "E")).toBe(true);
    const p1 = facts.filter((f) => f.account === "632" && f.component !== "employerIns");
    expect(sum(p1, (f) => f.amount)).toBe(10880000);
    expect(p1.every((f) => f.department === "D2" && f.location === "L1" && f.class === "WC1" && f.project === "P1")).toBe(true);
    // Tỷ lệ: lương 20/30,88 của dòng 20 triệu = 12.953.368 (làm tròn), phần còn lại dồn vào dòng lớn nhất
    expect(p1.find((f) => f.component === "wages").amount).toBe(Math.round((10880000 * 20000000) / 30880000));
    expect(d1.find((f) => f.component === "wages").amount).toBe(20000000 - Math.round((10880000 * 20000000) / 30880000));
  });

  test("trích tháng 13: tài khoản và phòng ban của hồ sơ; không có thì tài khoản mặc định, phòng ban trống", () => {
    const own = F.employeeFacts(line("7", detail(), { accrued13: 2500000 }), options).find((f) => f.component === "accrued13");
    expect(own).toMatchObject({ account: "6421", department: "D9", class: "", location: "L0", project: "", amount: 2500000 });
    const d = detail();
    d.expenseAccount = "";
    const def = F.employeeFacts(line("7", d, { accrued13: 2500000 }), options).find((f) => f.component === "accrued13");
    expect(def).toMatchObject({ account: "642", department: "", amount: 2500000 });
    expect(F.employeeFacts(line("7", detail(), { accrued13: -5 }), options).some((f) => f.component === "accrued13")).toBe(false);
    expect(F.employeeFacts(line("7", detail(), { accrued13: 100, employment_type: "C" }), options).some((f) => f.component === "accrued13")).toBe(false);
  });

  test("cộng tác viên: toàn bộ GROSS thành contractor, kể cả giờ", () => {
    const facts = F.employeeFacts(line("9", { earnings: [{ earningType: "LUONG", amount: 15680000 }], allocations: [{ component: "GROSS", amount: 15680000, account: "642", sub: "D1", hours: 12 }] }, { employment_type: "C" }), options);
    expect(facts).toEqual([{ account: "642", department: "D1", class: "", location: "L0", project: "", employmentType: "C", component: "contractor", amount: 15680000, hours: 12 }]);
    // Loại lao động lấy từ detail khi trường vô hướng trống
    const d = F.employeeFacts({ employee: "9", detail: { employmentType: "C", allocations: [{ component: "GROSS", amount: 100, account: "642" }] } }, options);
    expect(d[0].component).toBe("contractor");
  });

  test("làm tròn: nhiều dòng phân bổ lẻ, cơ cấu lẻ - hai chiều tổng đều khớp", () => {
    const d = {
      earnings: [{ earningType: "LUONG", amount: 3333333 }, { earningType: "OT150", amount: 3333334 }, { earningType: "PHUCAP", amount: 3333334 }, { earningType: "KHAC", amount: -7 }],
      allocations: [1111111, 2222223, 3333331, 1, 3333328].map((amount, i) => ({ component: "GROSS", amount, account: "642", sub: `D${i}` })),
    };
    const facts = F.employeeFacts(line("7", d), options);
    expect(by(facts, "component")).toEqual({ wages: 3333333, overtime: 3333334, allowance: 3333334, other: -7 });
    expect(by(facts, "department")).toEqual({ D0: 1111111, D1: 2222223, D2: 3333331, D3: 1, D4: 3333328 });
    expect(facts.every((f) => Number.isInteger(f.amount))).toBe(true);
  });

  test("thu nhập có dự án riêng (OT theo dự án, dòng tay có đích) gắn đúng dòng phân bổ của dự án", () => {
    const d = {
      earnings: [
        { earningType: "LUONG", amount: 20000000, source: "S", project: "" }, { earningType: "OT150", amount: 1500000, source: "T", project: "P1" },
        { earningType: "OT150", amount: 500000, source: "T", project: "P2" }, { earningType: "THUONG", amount: 3000000, source: "M", project: "P3" },
      ],
      allocations: [
        { component: "GROSS", amount: 1500000, account: "632", sub: "D1", project: "P1", source: "T", hours: 10 },
        { component: "GROSS", amount: 500000, account: "632", sub: "D1", project: "P2", source: "T", hours: 3 },
        { component: "GROSS", amount: 3000000, account: "641", sub: "D1", project: "P3", workCenter: "WC9", source: "S", hours: 0 },
        { component: "GROSS", amount: 12000000, account: "642", sub: "D1", project: "", source: "P", hours: 0 },
        { component: "GROSS", amount: 8000000, account: "642", sub: "D2", project: "", source: "P", hours: 0 },
      ],
    };
    const facts = F.employeeFacts(line("7", d), options);
    const of = (project) => facts.filter((f) => f.project === project).map((f) => [f.component, f.amount, f.hours]);
    expect(of("P1")).toEqual([["overtime", 1500000, 10]]);
    expect(of("P2")).toEqual([["overtime", 500000, 3]]);
    expect(of("P3")).toEqual([["bonus", 3000000, 0]]);
    expect(of("")).toEqual([["wages", 12000000, 0], ["wages", 8000000, 0]]);
  });

  test("tổng dòng của dự án không bằng tổng thu nhập mang dự án đó (phân bổ theo timesheet) -> chia theo tỷ lệ", () => {
    const d = {
      earnings: [{ earningType: "LUONG", amount: 9000000, source: "S" }, { earningType: "OT150", amount: 1000000, source: "T", project: "P1" }],
      allocations: [
        { component: "GROSS", amount: 6000000, account: "632", project: "P1", source: "T", hours: 96 },
        { component: "GROSS", amount: 4000000, account: "632", project: "P2", source: "T", hours: 64 },
      ],
    };
    const facts = F.employeeFacts(line("7", d), options);
    expect(facts.filter((f) => f.project === "P1").map((f) => [f.component, f.amount, f.hours])).toEqual([["overtime", 600000, 0], ["wages", 5400000, 96]]);
    expect(facts.filter((f) => f.project === "P2").map((f) => [f.component, f.amount, f.hours])).toEqual([["overtime", 400000, 0], ["wages", 3600000, 64]]);
    expect(sum(facts, (f) => f.hours)).toBe(160);
  });

  test("lương khoán do quy tắc sinh ra, chia theo phiếu sản lượng: các dòng nguồn S nhận đúng piecework", () => {
    const d = {
      earnings: [{ earningType: "LUONG", amount: 6000000, source: "S" }, { earningType: "KHOAN", amount: 4000000, source: "S" }],
      allocations: [
        { component: "GROSS", amount: 2500000, account: "622", project: "P1", workCenter: "WC1", source: "S" },
        { component: "GROSS", amount: 1500000, account: "622", project: "P2", workCenter: "WC2", source: "S" },
        { component: "GROSS", amount: 6000000, account: "642", project: "", source: "D" },
      ],
    };
    const facts = F.employeeFacts(line("7", d), options);
    expect(facts.map((f) => [f.account, f.project, f.class, f.component, f.amount])).toEqual([
      ["622", "P1", "WC1", "piecework", 2500000], ["622", "P2", "WC2", "piecework", 1500000], ["642", "", "", "wages", 6000000],
    ]);
  });

  test("tổng thu nhập lệch tổng phân bổ GROSS: phần lệch vào other, tổng theo dòng vẫn đúng; không có thu nhập thì cả dòng vào other", () => {
    const d = { earnings: [{ earningType: "LUONG", amount: 9000000 }], allocations: [{ component: "GROSS", amount: 6000000, account: "642", sub: "D1" }, { component: "GROSS", amount: 4000000, account: "642", sub: "D2" }] };
    const facts = F.employeeFacts(line("7", d), options);
    expect(by(facts, "component")).toEqual({ wages: 9000000, other: 1000000 });
    expect(by(facts, "department")).toEqual({ D1: 6000000, D2: 4000000 });
    const none = F.employeeFacts(line("7", { allocations: [{ component: "GROSS", amount: 500, account: "642" }] }), options);
    expect(none.map((f) => [f.component, f.amount])).toEqual([["other", 500]]);
    expect(F.employeeFacts(line("7", {}), options)).toEqual([]);
    expect(F.employeeFacts({ employee: "7", detail: "{broken" }, options)).toEqual([]);
  });

  test("loại thu nhập không có trong bảng -> other; loại làm thêm không có nhóm -> overtime", () => {
    const d = { earnings: [{ earningType: "LA", amount: 100 }, { earningType: "dem", amount: 300 }], allocations: [{ component: "GROSS", amount: 400, account: "642" }] };
    expect(by(F.employeeFacts(line("7", d), options), "component")).toEqual({ other: 100, overtime: 300 });
  });
});

describe("Bảng lương: gộp theo khóa và bất biến với bút toán", () => {
  test("hai phân bổ chỉ khác class ra hai nhóm số liệu, khớp từng dòng Nợ của bút toán", () => {
    const lines = [
      line("1", {
        earnings: [{ earningType: "LUONG", amount: 10000000 }],
        allocations: [
          { component: "GROSS", amount: 6000000, account: "642", sub: "D1", workCenter: "WC1" }, { component: "GROSS", amount: 4000000, account: "642", sub: "D1", workCenter: "WC2" },
          { component: "ERINS", amount: 1290000, account: "642", sub: "D1", workCenter: "WC1" }, { component: "ERINS", amount: 860000, account: "642", sub: "D1", workCenter: "WC2" },
        ],
      }),
      line("2", { earnings: [{ earningType: "LUONG", amount: 5000000 }], allocations: [{ component: "GROSS", amount: 5000000, account: "642", sub: "D1", workCenter: "WC1" }] }),
    ];
    const r = F.build(lines, options);
    expect(r.facts.map((f) => [f.class, f.component, f.amount])).toEqual([["WC1", "employerIns", 1290000], ["WC1", "wages", 11000000], ["WC2", "employerIns", 860000], ["WC2", "wages", 4000000]]);
    expect(r.check).toEqual({ ok: true, total: 17150000, expected: 17150000, difference: 0 });
    expect(factDebits(r.facts)).toEqual(journalDebits(lines));
  });

  test("bất biến trên dữ liệu ngẫu nhiên: tổng số liệu = tổng Nợ chi phí bút toán, khớp từng khóa và từng thành phần", () => {
    let seed = 20270331;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const codes = ["LUONG", "OT150", "PHUCAP", "ANCA", "THUONG", "KHOAN", "KHAC"];
    const lines = [];
    const wantComponents = {};
    for (let i = 0; i < 250; i++) {
      const contractor = rnd(10) === 0;
      const earnings = [];
      const n = 1 + rnd(5);
      for (let k = 0; k < n; k++) earnings.push({ earningType: codes[rnd(codes.length)], amount: 100000 + rnd(30000000), source: "S", project: "" });
      if (rnd(4) === 0) earnings.push({ earningType: "KHAC", amount: -rnd(50000), source: "M", project: "" });
      const gross = sum(earnings, (e) => e.amount);
      const parts = 1 + rnd(4);
      const allocations = [];
      let left = gross;
      for (let k = 0; k < parts; k++) {
        const amount = k === parts - 1 ? left : rnd(Math.max(1, Math.floor(left / 2)));
        left -= amount;
        allocations.push({ component: "GROSS", amount, account: ["642", "632", "641"][rnd(3)], sub: `D${rnd(3)}`, project: rnd(3) ? "" : `P${rnd(2)}`, branch: rnd(3) ? "" : "L1", workCenter: rnd(2) ? "" : `WC${rnd(2)}`, source: "P", hours: rnd(40) });
      }
      const er = contractor ? 0 : Math.round(gross * 0.215);
      if (er) allocations.push({ component: "ERINS", amount: er, account: "642", sub: `D${rnd(3)}`, project: "", branch: "", workCenter: "" });
      const accrued13 = contractor || rnd(2) ? 0 : Math.round(gross / 12);
      lines.push(line(String(i + 1), { earnings, allocations, expenseAccount: rnd(2) ? "6421" : "", expenseSub: "D7" }, { employment_type: contractor ? "C" : "E", accrued13 }));
      const add = (c, v) => (wantComponents[c] = (wantComponents[c] || 0) + v);
      if (contractor) add("contractor", gross);
      else for (const e of earnings) add(F.componentOf(earningTypes[e.earningType]), e.amount);
      add("employerIns", er);
      add("accrued13", accrued13);
    }
    const r = F.build(lines, options);
    const debits = journalDebits(lines);
    expect(r.check.ok).toBe(true);
    expect(r.total).toBe(sum(Object.values(debits), (v) => v));
    expect(factDebits(r.facts)).toEqual(debits);
    for (const k of Object.keys(wantComponents)) if (wantComponents[k] === 0) delete wantComponents[k];
    expect(by(r.facts, "component")).toEqual(wantComponents);
    expect(F.verify(r.facts, r.total + 1)).toEqual({ ok: false, total: r.total, expected: r.total + 1, difference: -1 });
    expect(F.expected(lines).total).toBe(r.total);
    // Khóa không trùng và đã sắp xếp
    const keys = r.facts.map(F.factKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.slice().sort()).toEqual(keys);
  });
});

describe("Kế hoạch ghi record (plan)", () => {
  const header = { batch: "8", subsidiary: "13", month: "202703", postingDate: "2027-03-31" };
  const facts = [
    { account: "642", department: "D1", class: "", location: "L0", project: "", employmentType: "E", component: "wages", amount: 100, hours: 8 },
    { account: "642", department: "D1", class: "", location: "L0", project: "", employmentType: "E", component: "employerIns", amount: 20, hours: 0 },
  ];
  const stored = (id, f, extra) => Object.assign({ id: String(id), isInactive: false }, F.toRecord(f, header), extra);

  test("monthOf, toRecord", () => {
    expect(F.monthOf("2027-03-31")).toBe("202703");
    expect(F.monthOf("")).toBe("");
    expect(F.toRecord(facts[0], header)).toEqual({
      batch: "8", subsidiary: "13", month: "202703", posting_date: "2027-03-31", account: "642", department: "D1", class: "", location: "L0", project: "",
      employment_type: "E", component: "wages", amount: 100, hours: 8, active: true,
    });
  });

  test("chưa có gì -> tạo hết; đã đúng -> không ghi gì (chạy lại được)", () => {
    const first = F.plan([], facts, header);
    expect(first).toMatchObject({ update: [], deactivate: [], unchanged: 0 });
    expect(first.create).toHaveLength(2);
    const again = F.plan(first.create.map((v, i) => Object.assign({ id: String(i + 1) }, v)), facts, header);
    expect(again).toEqual({ create: [], update: [], deactivate: [], unchanged: 2 });
    // Trường trống đọc lên là null vẫn coi là trùng
    expect(F.plan([stored(1, facts[0], { class: null, project: null }), stored(2, facts[1], { class: null, project: null })], facts, header).unchanged).toBe(2);
  });

  test("số tiền đổi -> cập nhật tại chỗ; số dòng không đổi thì không tạo thêm", () => {
    const p = F.plan([stored(1, facts[0], { amount: 90 }), stored(2, facts[1])], facts, header);
    expect(p.create).toEqual([]);
    expect(p.deactivate).toEqual([]);
    expect(p.unchanged).toBe(1);
    expect(p.update).toEqual([{ id: "1", values: F.toRecord(facts[0], header) }]);
  });

  test("khóa đổi: dùng lại dòng thừa (ưu tiên dòng đã hết hiệu lực), dòng thừa còn lại bỏ hiệu lực, không xóa", () => {
    const old = [
      stored(1, Object.assign({}, facts[0], { department: "D5" })), stored(2, facts[1]), stored(3, Object.assign({}, facts[0], { department: "D6" }), { active: false }),
      stored(4, Object.assign({}, facts[0], { department: "D7" })),
    ];
    const p = F.plan(old, facts, header);
    expect(p.create).toEqual([]);
    expect(p.update).toEqual([{ id: "3", values: F.toRecord(facts[0], header) }]);
    expect(p.deactivate).toEqual(["1", "4"]);
    expect(p.unchanged).toBe(1);
  });

  test("bảng lương đã đảo (không còn số liệu mong muốn): bỏ hiệu lực mọi dòng còn hiệu lực", () => {
    const p = F.plan([stored(1, facts[0]), stored(2, facts[1], { active: false })], [], header);
    expect(p).toEqual({ create: [], update: [], deactivate: ["1"], unchanged: 0 });
  });

  test("dòng hết hiệu lực trùng khóa được bật lại bằng cập nhật; đổi tháng / ngày bút toán cũng cập nhật", () => {
    const p = F.plan([stored(1, facts[0], { active: false }), stored(2, facts[1], { month: "202702" })], facts, header);
    expect(p.update.map((u) => u.id)).toEqual(["1", "2"]);
    expect(p.create).toEqual([]);
  });
});
