// Cầu biến động chi phí lương và các phép tỷ lệ an toàn (core/LaborVariance, docs/UI_V2.md mục 13).
const { core } = require("./helpers");
const V = core("LaborVariance");

const comps = (o) => Object.assign({ wages: 0, overtime: 0, allowance: 0, bonus: 0, piecework: 0, other: 0, employerIns: 0, accrued13: 0, contractor: 0 }, o);
const step = (b, key) => b.find((s) => s.key === key).amount;
const middle = (b) => b.filter((s) => s.key !== "start" && s.key !== "end").reduce((s, x) => s + x.amount, 0);

describe("Tỷ lệ an toàn", () => {
  test("ratio / share: chia cho 0 hoặc thiếu số -> null", () => {
    expect(V.ratio(1, 4)).toBe(0.25);
    expect(V.ratio(1, 3)).toBe(0.333333);
    expect(V.ratio(5, 0)).toBeNull();
    expect(V.ratio(null, 5)).toBeNull();
    expect(V.ratio(5, null)).toBeNull();
    expect(V.ratio(5, undefined)).toBeNull();
    expect(V.ratio(NaN, 5)).toBeNull();
    expect(V.ratio(0, 5)).toBe(0);
    expect(V.share(30, 120)).toBe(0.25);
    expect(V.share(30, 0)).toBeNull();
  });

  test("pct: thay đổi tương đối so với trị tuyệt đối kỳ trước; diff", () => {
    expect(V.pct(120, 100)).toBe(0.2);
    expect(V.pct(80, 100)).toBe(-0.2);
    expect(V.pct(-50, -100)).toBe(0.5);
    expect(V.pct(100, 0)).toBeNull();
    expect(V.pct(null, 100)).toBeNull();
    expect(V.pct(100, null)).toBeNull();
    expect(V.diff(120, 100)).toBe(20);
    expect(V.diff(null, 100)).toBeNull();
    expect(V.diff(100, undefined)).toBeNull();
  });

  test("total cộng đủ chín thành phần", () => {
    expect(V.total(comps({ wages: 10, contractor: 5, accrued13: 1 }))).toBe(16);
    expect(V.total(null)).toBe(0);
    expect(V.COMPONENTS).toEqual(["wages", "overtime", "allowance", "bonus", "piecework", "other", "employerIns", "accrued13", "contractor"]);
  });
});

describe("Cầu biến động", () => {
  const prev = { headcount: 10, components: comps({ wages: 200000000, overtime: 20000000, allowance: 30000000, employerIns: 43000000, accrued13: 7000000, contractor: 15000000 }) };

  test("thứ tự bước; headcount = thay đổi số người x bình quân kỳ trước (không tính CTV); tổng bước = end - start", () => {
    const cur = { headcount: 12, components: comps({ wages: 252000000, overtime: 18000000, allowance: 36000000, bonus: 5000000, employerIns: 54180000, accrued13: 8400000, contractor: 10000000 }) };
    const b = V.bridge(prev, cur);
    expect(b.map((s) => s.key)).toEqual(["start", "headcount", "wages", "overtime", "allowance", "bonus", "piecework", "other", "employerIns", "accrued13", "contractor", "end"]);
    expect(step(b, "start")).toBe(315000000);
    expect(step(b, "end")).toBe(383580000);
    // Bình quân kỳ trước = (315 - 15) / 10 = 30 triệu; thêm 2 người
    expect(step(b, "headcount")).toBe(60000000);
    // wages: 12 người x (21,0 - 20,0 triệu) = 12 triệu = (252 - 200) - 2 x 20
    expect(step(b, "wages")).toBe(12000000);
    expect(step(b, "overtime")).toBe(18000000 - 20000000 - 4000000);
    expect(step(b, "allowance")).toBe(0);
    expect(step(b, "bonus")).toBe(5000000);
    expect(step(b, "employerIns")).toBe(54180000 - 43000000 - 8600000);
    expect(step(b, "contractor")).toBe(-5000000);
    expect(middle(b)).toBe(step(b, "end") - step(b, "start"));
    expect(V.bridgeBalanced(b)).toBe(true);
  });

  test("số người không đổi: headcount = 0, mỗi bước = chênh lệch thành phần", () => {
    const cur = { headcount: 10, components: comps({ wages: 210000000, overtime: 20000000, allowance: 30000000, employerIns: 45150000, accrued13: 7000000, contractor: 15000000 }) };
    const b = V.bridge(prev, cur);
    expect(step(b, "headcount")).toBe(0);
    expect(step(b, "wages")).toBe(10000000);
    expect(step(b, "employerIns")).toBe(2150000);
    expect(b.filter((s) => !["start", "end", "wages", "employerIns"].includes(s.key)).every((s) => s.amount === 0)).toBe(true);
  });

  test("làm tròn: số lẻ vẫn khớp tuyệt đối", () => {
    const p = { headcount: 3, components: comps({ wages: 10000000, overtime: 333333, allowance: 777777, employerIns: 2150001, accrued13: 1, contractor: 5 }) };
    const c = { headcount: 7, components: comps({ wages: 23456789, overtime: 1111111, allowance: 1, bonus: 99, employerIns: 5000003, contractor: 0 }) };
    const b = V.bridge(p, c);
    expect(middle(b)).toBe(step(b, "end") - step(b, "start"));
    expect(step(b, "headcount")).toBe(Math.round((4 * (10000000 + 333333 + 777777 + 2150001 + 1)) / 3));
    expect(b.every((s) => Number.isInteger(s.amount))).toBe(true);
    // Giảm người cũng khớp
    const back = V.bridge(c, p);
    expect(V.bridgeBalanced(back)).toBe(true);
    expect(step(back, "headcount")).toBeLessThan(0);
  });

  test("kỳ trước không có người hoặc không có số liệu: headcount = 0, các bước = số kỳ này", () => {
    const cur = { headcount: 5, components: comps({ wages: 100, employerIns: 20, contractor: 7 }) };
    const b = V.bridge({ headcount: 0, components: comps({}) }, cur);
    expect(step(b, "start")).toBe(0);
    expect(step(b, "headcount")).toBe(0);
    expect(step(b, "wages")).toBe(100);
    expect(step(b, "contractor")).toBe(7);
    expect(V.bridgeBalanced(b)).toBe(true);
    const none = V.bridge(null, cur);
    expect(step(none, "end")).toBe(127);
    expect(V.bridgeBalanced(none)).toBe(true);
  });

  test("kỳ này không còn nhân viên: toàn bộ chi phí nhân viên kỳ trước nằm ở bước headcount", () => {
    const b = V.bridge(prev, { headcount: 0, components: comps({ contractor: 15000000 }) });
    expect(step(b, "headcount")).toBe(-300000000);
    expect(b.filter((s) => !["start", "end", "headcount"].includes(s.key)).every((s) => s.amount === 0)).toBe(true);
    expect(V.bridgeBalanced(b)).toBe(true);
  });

  test("bridgeBalanced phát hiện cầu lệch", () => {
    expect(V.bridgeBalanced([{ key: "start", amount: 1 }, { key: "wages", amount: 5 }, { key: "end", amount: 7 }])).toBe(false);
  });
});
