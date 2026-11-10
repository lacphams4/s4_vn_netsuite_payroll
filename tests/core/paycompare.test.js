// So sánh bảng lương với kỳ trước (core/PayCompare): chọn kỳ trước, chênh theo nhân viên, tổng hợp, so từng khoản.
const { core } = require("./helpers");
const PayCompare = core("PayCompare");

const line = (employee, net, extra) => Object.assign({ employee, net, gross: net, ee_ins: 0, pit: 0 }, extra || {});
const row = (r, employee) => r.rows.find((x) => x.employee === String(employee));

describe("delta", () => {
  test("chênh tuyệt đối và phần trăm trên giá trị tuyệt đối kỳ trước", () => {
    expect(PayCompare.delta(110, 100)).toEqual({ current: 110, previous: 100, diff: 10, pct: 0.1 });
    expect(PayCompare.delta(90, 100)).toEqual({ current: 90, previous: 100, diff: -10, pct: -0.1 });
    expect(PayCompare.delta(-50, -100)).toEqual({ current: -50, previous: -100, diff: 50, pct: 0.5 });
  });

  test("kỳ trước bằng 0: phần trăm không xác định, cả hai bằng 0 thì 0", () => {
    expect(PayCompare.delta(5, 0)).toEqual({ current: 5, previous: 0, diff: 5, pct: null });
    expect(PayCompare.delta(0, 0)).toEqual({ current: 0, previous: 0, diff: 0, pct: 0 });
  });

  test("không có số kỳ trước", () => {
    expect(PayCompare.delta(5, null)).toEqual({ current: 5, previous: null, diff: null, pct: null });
  });

  test("không sai số dấu phẩy động, phần trăm làm tròn 4 chữ số", () => {
    expect(PayCompare.delta(0.3, 0.1).diff).toBe(0.2);
    expect(PayCompare.delta(100766900, 101990000).pct).toBe(-0.012);
    expect(PayCompare.delta(1, 3).pct).toBe(-0.6667);
  });

  test("giá trị rỗng hoặc không phải số coi là 0", () => {
    expect(PayCompare.delta("", 100).diff).toBe(-100);
    expect(PayCompare.delta("abc", 100).current).toBe(0);
    expect(PayCompare.delta("150", "100").pct).toBe(0.5);
  });
});

describe("compareLines", () => {
  const prev = [line("1", 10000000), line("2", 20000000), line("3", 5000000)];
  const cur = [line("1", 10000000), line("2", 23000000), line("4", 7000000)];

  test("phân loại người mới, người nghỉ, giữ đúng thứ tự kỳ này", () => {
    const r = PayCompare.compareLines(cur, prev);
    expect(r.rows.map((x) => x.employee)).toEqual(["1", "2", "4"]);
    expect(r.rows.map((x) => x.kind)).toEqual(["both", "both", "new"]);
    expect(r.leavers).toEqual([{ employee: "3", kind: "left", previous: 5000000, values: expect.any(Object) }]);
    expect(r.leavers[0].values.net).toEqual({ current: null, previous: 5000000, diff: null, pct: null });
  });

  test("chênh và cờ vượt ngưỡng theo thực lĩnh, ngưỡng mặc định 10%", () => {
    const r = PayCompare.compareLines(cur, prev);
    expect(row(r, 1)).toMatchObject({ current: 10000000, previous: 10000000, diff: 0, pct: 0, over: false });
    expect(row(r, 2)).toMatchObject({ current: 23000000, previous: 20000000, diff: 3000000, pct: 0.15, over: true });
    expect(row(r, 4)).toMatchObject({ current: 7000000, previous: null, diff: null, pct: null, over: false });
  });

  test("ngưỡng là tham số; đúng bằng ngưỡng thì gắn cờ; giảm cũng gắn cờ", () => {
    const a = [line("1", 110), line("2", 80)];
    const b = [line("1", 100), line("2", 100)];
    expect(PayCompare.compareLines(a, b, { threshold: 0.1 }).rows.map((x) => x.over)).toEqual([true, true]);
    expect(PayCompare.compareLines(a, b, { threshold: 0.15 }).rows.map((x) => x.over)).toEqual([false, true]);
    expect(PayCompare.compareLines(a, b, { threshold: 0.25 }).rows.map((x) => x.over)).toEqual([false, false]);
    expect(PayCompare.compareLines(a, b, { threshold: 0 }).rows.map((x) => x.over)).toEqual([false, false]);
  });

  test("minDiff bỏ qua chênh nhỏ dù tỷ lệ lớn", () => {
    const r = PayCompare.compareLines([line("1", 1500)], [line("1", 1000)], { threshold: 0.1, minDiff: 100000 });
    expect(r.rows[0]).toMatchObject({ pct: 0.5, over: false });
  });

  test("kỳ trước bằng 0 mà kỳ này có tiền: vượt ngưỡng, phần trăm không xác định", () => {
    const r = PayCompare.compareLines([line("1", 5000000)], [line("1", 0)]);
    expect(r.rows[0]).toMatchObject({ kind: "both", pct: null, over: true });
  });

  test("chỉ tiêu xét ngưỡng và danh sách chỉ tiêu là tham số", () => {
    const a = [{ employee: "1", gross: 130, net: 100 }];
    const b = [{ employee: "1", gross: 100, net: 100 }];
    const r = PayCompare.compareLines(a, b, { key: "gross", keys: ["gross", "net"] });
    expect(r.rows[0]).toMatchObject({ current: 130, previous: 100, pct: 0.3, over: true });
    expect(r.rows[0].values.net).toEqual({ current: 100, previous: 100, diff: 0, pct: 0 });
    expect(r.summary.key).toBe("gross");
  });

  test("tổng hợp toàn bảng: số người, người mới, người nghỉ, tổng kỳ trước gồm cả người đã nghỉ", () => {
    const r = PayCompare.compareLines(cur, prev);
    expect(r.summary).toMatchObject({ hasPrevious: true, count: 3, prevCount: 3, joiners: 1, leavers: 1, both: 2, over: 1, unchanged: 1, threshold: 0.1 });
    expect(r.summary.totals.net).toEqual({ current: 40000000, previous: 35000000, diff: 5000000, pct: 0.1429 });
    expect(Object.keys(r.summary.totals)).toEqual(["gross", "ee_ins", "pit", "net"]);
  });

  test("không có kỳ trước: không ai là người mới, không có cờ, tổng không có số so sánh", () => {
    const r = PayCompare.compareLines(cur, null);
    expect(r.rows.every((x) => x.kind === "both" && x.previous === null && x.diff === null && !x.over)).toBe(true);
    expect(r.leavers).toEqual([]);
    expect(r.summary).toMatchObject({ hasPrevious: false, count: 3, prevCount: 0, joiners: 0, leavers: 0, both: 0, over: 0 });
    expect(r.summary.totals.net).toEqual({ current: 40000000, previous: null, diff: null, pct: null });
  });

  test("kỳ trước có bảng lương nhưng rỗng: mọi người là người mới", () => {
    const r = PayCompare.compareLines(cur, []);
    expect(r.rows.every((x) => x.kind === "new")).toBe(true);
    expect(r.summary).toMatchObject({ hasPrevious: true, joiners: 3, both: 0 });
    expect(r.summary.totals.net.previous).toBe(0);
  });

  test("id nhân viên dạng số và chuỗi khớp nhau; nhiều dòng kỳ trước của một người được cộng dồn", () => {
    const r = PayCompare.compareLines([line(7, 300)], [line("7", 100), line("7", 100)]);
    expect(r.rows[0]).toMatchObject({ employee: "7", kind: "both", previous: 200, diff: 100, pct: 0.5 });
    expect(r.summary.prevCount).toBe(1);
  });

  test("đầu vào rỗng hoặc null không ném lỗi", () => {
    expect(PayCompare.compareLines(null, null).rows).toEqual([]);
    expect(PayCompare.compareLines([], [line("1", 5)]).leavers.length).toBe(1);
    expect(PayCompare.compareLines([null, line("1", 5)], [null]).rows.length).toBe(1);
  });
});

describe("pickPrevious - kỳ trước theo ngày kết thúc kỳ", () => {
  // Mã kỳ cố ý lệch với ngày (account demo bị dời ngày): chỉ ngày kết thúc quyết định
  const periods = { 10: { end: "2027-01-31" }, 11: { end: "2027-02-28" }, 12: { end: "2027-03-31" }, 13: { end: "2027-04-30" } };
  const me = { id: "50", subsidiary: "13", paygroup: "1", period: "12" };
  const b = (id, period, status, extra) => Object.assign({ id: String(id), subsidiary: "13", paygroup: "1", period: String(period), status, calculated: true }, extra || {});

  test("lấy bảng lương của kỳ kết thúc muộn nhất trước kỳ này", () => {
    const got = PayCompare.pickPrevious(me, [b(40, 10, "R"), b(41, 11, "R"), b(60, 13, "R")], periods);
    expect(got.id).toBe("41");
  });

  test("không theo mã kỳ hay id: kỳ có id lớn hơn nhưng kết thúc sớm hơn vẫn là kỳ trước", () => {
    const odd = { 99: { end: "2027-02-28" }, 12: { end: "2027-03-31" }, 5: { end: "2027-01-31" } };
    expect(PayCompare.pickPrevious(me, [b(40, 5, "R"), b(41, 99, "R")], odd).id).toBe("41");
  });

  test("bỏ bảng đã đảo, chưa tính, khác công ty con, khác nhóm lương, cùng kỳ và chính nó", () => {
    const list = [
      b(41, 11, "V"), b(42, 11, "B", { calculated: false }), b(43, 11, "R", { subsidiary: "14" }), b(44, 11, "R", { paygroup: "2" }),
      b(45, 12, "R"), b(50, 11, "R"), b(40, 10, "C"),
    ];
    expect(PayCompare.pickPrevious(me, list, periods).id).toBe("40");
  });

  test("một kỳ nhiều bảng lương: ưu tiên đã ghi sổ, rồi đã duyệt, rồi id lớn hơn", () => {
    expect(PayCompare.pickPrevious(me, [b(41, 11, "C"), b(42, 11, "A"), b(43, 11, "R"), b(44, 11, "P")], periods).id).toBe("43");
    expect(PayCompare.pickPrevious(me, [b(41, 11, "C"), b(42, 11, "C")], periods).id).toBe("42");
  });

  test("periods dạng mảng; cờ calculated dạng T", () => {
    const arr = [{ id: "11", end: "2027-02-28" }, { id: "12", end: "2027-03-31" }];
    expect(PayCompare.pickPrevious(me, [b(41, 11, "R", { calculated: "T" })], arr).id).toBe("41");
  });

  test("không có kỳ trước hoặc thiếu dữ liệu kỳ: null", () => {
    expect(PayCompare.pickPrevious(me, [b(60, 13, "R")], periods)).toBeNull();
    expect(PayCompare.pickPrevious(me, [], periods)).toBeNull();
    expect(PayCompare.pickPrevious(me, [b(41, 11, "R")], {})).toBeNull();
    expect(PayCompare.pickPrevious(null, null, null)).toBeNull();
  });
});

describe("compareItems - so từng khoản của một nhân viên", () => {
  test("gộp theo mã, khoản mới, khoản không còn", () => {
    const cur = [{ code: "BASE", name: "Lương", amount: 30000000 }, { code: "ot", name: "Làm thêm", amount: 1000000 }, { code: "OT", amount: 500000 }];
    const prev = [{ code: "BASE", name: "Lương", amount: 28000000 }, { code: "MEAL", name: "Ăn ca", amount: 730000 }];
    expect(PayCompare.compareItems(cur, prev)).toEqual([
      { code: "BASE", name: "Lương", kind: "both", current: 30000000, previous: 28000000, diff: 2000000, pct: 0.0714 },
      { code: "OT", name: "Làm thêm", kind: "new", current: 1500000, previous: 0, diff: 1500000, pct: null },
      { code: "MEAL", name: "Ăn ca", kind: "gone", current: 0, previous: 730000, diff: -730000, pct: -1 },
    ]);
  });

  test("không có kỳ trước: không có số so sánh", () => {
    expect(PayCompare.compareItems([{ code: "BASE", name: "Lương", amount: 5 }], null)).toEqual([{ code: "BASE", name: "Lương", kind: "both", current: 5, previous: null, diff: null, pct: null }]);
  });

  test("đọc dạng dữ liệu khác bằng hàm lấy mã, số tiền, tên", () => {
    const opt = { codeOf: (x) => x.earningType, amountOf: (x) => x.value, nameOf: (x) => x.label };
    const out = PayCompare.compareItems([{ earningType: "A", value: 2, label: "Khoản A" }], [{ earningType: "A", value: 1, label: "Khoản A" }], opt);
    expect(out).toEqual([{ code: "A", name: "Khoản A", kind: "both", current: 2, previous: 1, diff: 1, pct: 1 }]);
  });
});
