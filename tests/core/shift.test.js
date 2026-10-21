// Ca kiểm thử vàng mục 3.10 (8-19), kịch bản nghiệm thu chấm công 100 người và hiệu năng 2.000 người x 31 ngày.
const { core } = require("./helpers");
const SM = core("ShiftMatcher");
const SP = core("ShiftPattern");
const Dates = core("Dates");

const HC = { code: "HC", startTime: "08:00", endTime: "17:00", breakMinutes: 60, kind: "D", lateGraceMinutes: 5, earlyGraceMinutes: 5, overtimeMinMinutes: 30 };
const C1 = { code: "C1", startTime: "06:00", endTime: "14:00", breakMinutes: 30, kind: "D", lateGraceMinutes: 5, earlyGraceMinutes: 5, overtimeMinMinutes: 30 };
const C2 = { code: "C2", startTime: "14:00", endTime: "22:00", breakMinutes: 30, kind: "E", lateGraceMinutes: 5, earlyGraceMinutes: 5, overtimeMinMinutes: 30 };
const C3 = { code: "C3", startTime: "22:00", endTime: "06:00", breakMinutes: 30, kind: "N", lateGraceMinutes: 5, earlyGraceMinutes: 5, overtimeMinMinutes: 30 };
const SHIFTS = [HC, C1, C2, C3];

function run(cells, punches, excused, from, to) {
  return SM.match({ roster: cells.map(([d, s]) => ({ employee: "E1", workDate: d, shiftCode: s })), shifts: SHIFTS, punches: punches.map((t) => ({ employee: "E1", time: t })), excused: (excused || []).map((d) => ({ employee: "E1", date: d })), from: from || cells[0][0], to: to || cells[cells.length - 1][0] });
}

describe("ca và giờ chuẩn", () => {
  test("giờ chuẩn, ca qua đêm", () => {
    expect(SM.standardHours(HC)).toBe(8);
    expect(SM.standardHours(C3)).toBe(7.5);
    expect(() => SM.standardHours(Object.assign({}, HC, { breakMinutes: 540 }))).toThrow();
    expect(() => SM.parseTime("24:00")).toThrow();
  });
});

describe("3.10 #8-17 đối chiếu ca", () => {
  test("#8", () => {
    const [r] = run([["2026-10-05", "HC"]], ["2026-10-05 07:55", "2026-10-05 12:00", "2026-10-05 17:05"]);
    expect(r).toMatchObject({ status: "OnTime", worked: 480, late: 0, overtime: 0 });
  });
  test.each([
    ["08:05", "17:00", "OnTime", 5, 0],
    ["08:20", "17:00", "LateOrEarly", 20, 0],
    ["08:00", "16:30", "LateOrEarly", 0, 30],
    ["08:31", "16:00", "LateOrEarly", 31, 60],
  ])("#9 vào %s ra %s", (i, o, st, late, early) => {
    const [r] = run([["2026-10-05", "HC"]], [`2026-10-05 ${i}`, `2026-10-05 ${o}`]);
    expect(r).toMatchObject({ status: st, late, early });
  });
  test("#10 hai đêm liên tiếp", () => {
    const rs = run([["2026-10-05", "C3"], ["2026-10-06", "C3"]], ["2026-10-05 21:55", "2026-10-06 06:02", "2026-10-06 21:58", "2026-10-07 06:05"]);
    expect(rs).toHaveLength(2);
    expect(rs.every((r) => r.status === "OnTime" && r.worked === 450 && r.night === 480)).toBe(true);
    expect(rs[0].out).toBe("2026-10-06 06:02");
    expect(rs[1].in).toBe("2026-10-06 21:58");
  });
  test("#11 BUG-38 ngày nghỉ sau ca đêm", () => {
    const rs = run([["2026-10-05", "C3"], ["2026-10-06", null]], ["2026-10-05 21:53", "2026-10-06 06:04", "2026-10-06 08:00", "2026-10-06 12:00"]);
    expect(rs[0]).toMatchObject({ status: "OnTime", out: "2026-10-06 06:04", overtime: 0 });
    expect(rs[1]).toMatchObject({ status: "WorkedWithoutShift", workDate: "2026-10-06", worked: 240 });
  });
  test("#12 ca đêm ra trễ", () => {
    const [r] = run([["2026-10-05", "C3"]], ["2026-10-05 21:55", "2026-10-06 09:30"]);
    expect(r).toMatchObject({ status: "OnTime", overtime: 210 });
  });
  test("#13 chấm nối tiếp trong 15 phút", () => {
    expect(run([["2026-10-05", "HC"]], ["2026-10-05 08:00", "2026-10-05 17:32", "2026-10-05 17:40"])[0]).toMatchObject({ out: "2026-10-05 17:40", overtime: 40 });
    expect(run([["2026-10-05", "HC"]], ["2026-10-05 08:00", "2026-10-05 17:02", "2026-10-05 18:00"])[0]).toMatchObject({ out: "2026-10-05 17:02", overtime: 0 });
  });
  test.each([["17:20", 0], ["17:30", 30], ["18:30", 90]])("#14 ra %s -> OT %s", (o, ot) => {
    expect(run([["2026-10-05", "HC"]], ["2026-10-05 08:00", `2026-10-05 ${o}`])[0].overtime).toBe(ot);
  });
  test("#15 vắng / có đơn nghỉ", () => {
    expect(run([["2026-10-05", "HC"]], [])[0].status).toBe("Absent");
    const r = run([["2026-10-05", "HC"]], [], ["2026-10-05"])[0];
    expect(r.status).toBe("Excused");
    expect(SM.isWorkedShift(r)).toBe(false);
  });
  test("#16 thiếu lượt chấm", () => {
    for (const p of ["2026-10-05 07:58", "2026-10-05 17:02"]) {
      const r = run([["2026-10-05", "HC"]], [p])[0];
      expect(r.status).toBe("MissingPunch");
      expect(SM.isWorkedShift(r)).toBe(true);
    }
  });
  test("#17 ngày nghỉ có chấm", () => {
    const rs = run([["2026-10-05", null], ["2026-10-06", null]], ["2026-10-05 08:00", "2026-10-05 12:00", "2026-10-06 09:00"]);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ status: "WorkedWithoutShift", workDate: "2026-10-05", worked: 240 });
  });
  test("không có ô phân ca -> rỗng", () => {
    expect(SM.match({ roster: [], shifts: SHIFTS, punches: [{ employee: "E1", time: "2026-10-05 08:00" }], from: "2026-10-01", to: "2026-10-31" })).toEqual([]);
  });
});

describe("3.10 #18 NightOverlap", () => {
  const m = (t) => SM.toMinutes(t);
  test.each([
    ["2026-10-05 20:00", "2026-10-06 00:00", 120],
    ["2026-10-05 05:00", "2026-10-05 09:00", 60],
    ["2026-10-05 08:00", "2026-10-05 17:00", 0],
    ["2026-10-05 22:00", "2026-10-06 23:00", 540],
  ])("%s - %s = %s", (a, b, v) => expect(SM.nightOverlap(m(a), m(b))).toBe(v));
});

const PATTERN = ["C1", "C1", "C2", "C2", "C3", "C3", null, null];

describe("3.10 #19 mẫu 3 ca 4 kíp", () => {
  test("mỗi ngày đúng một kíp mỗi ca và một kíp nghỉ", () => {
    const crews = [0, 1, 2, 3].map((k) => SP.expand(PATTERN, Dates.addDays("2026-10-01", -2 * k), "2026-10-01", "2026-10-31"));
    for (let i = 0; i < 31; i++) {
      const day = crews.map((c) => c[i].shiftCode).sort();
      expect(day).toEqual(["C1", "C2", "C3", null].sort());
    }
  });
  test("anchor 9/10 thì 1/10 là C1", () => {
    expect(SP.expand(PATTERN, "2026-10-09", "2026-10-01", "2026-10-01")[0].shiftCode).toBe("C1");
  });
});

// Dữ liệu chấm công tất định: nhân viên idx thuộc kíp idx % 4, mọi ca chấm vào sớm 3 phút, ra trễ 2 phút; cases ghi đè
function buildScenario(n, cases) {
  const from = "2026-10-01";
  const to = "2026-10-31";
  const byCode = { C1, C2, C3 };
  const roster = [];
  const punches = [];
  const excused = [];
  const caseOf = new Map((cases || []).map((c) => [`${c.employee}|${c.date}`, c.type]));
  for (let i = 0; i < n; i++) {
    const emp = `E${String(i + 1).padStart(4, "0")}`;
    for (const cell of SP.expand(PATTERN, Dates.addDays(from, -2 * (i % 4)), from, to)) {
      roster.push({ employee: emp, workDate: cell.date, shiftCode: cell.shiftCode });
      const type = caseOf.get(`${emp}|${cell.date}`);
      if (!cell.shiftCode) {
        if (type === "WWS") punches.push({ employee: emp, time: `${cell.date} 08:00` }, { employee: emp, time: `${cell.date} 12:00` });
        continue;
      }
      const s = SM.startOn(cell.date, byCode[cell.shiftCode]);
      const e = SM.endOn(cell.date, byCode[cell.shiftCode]);
      if (type === "ABSENT") continue;
      if (type === "EXCUSED") {
        excused.push({ employee: emp, date: cell.date });
        continue;
      }
      const tin = type === "LATE" ? s + 20 : s - 3;
      punches.push({ employee: emp, time: SM.fromMinutes(tin) });
      if (type === "MISSING") continue;
      punches.push({ employee: emp, time: SM.fromMinutes(type === "OT" ? e + 90 : e + 2) });
    }
  }
  return { roster, punches, excused, from, to };
}

describe("nghiệm thu chấm công 100 người, tháng 10/2026, 3 ca 4 kíp", () => {
  const types = ["LATE", "ABSENT", "MISSING", "WWS", "OT", "EXCUSED"];
  const cases = [];
  const n = 100;
  // 60 nhân viên đầu, mỗi loại 10 người, mỗi người một ô
  for (let i = 0; i < 60; i++) {
    const emp = `E${String(i + 1).padStart(4, "0")}`;
    const type = types[Math.floor(i / 10)];
    const cells = SP.expand(PATTERN, Dates.addDays("2026-10-01", -2 * (i % 4)), "2026-10-01", "2026-10-31");
    const pool = cells.filter((c) => (type === "WWS" ? !c.shiftCode : !!c.shiftCode));
    cases.push({ employee: emp, date: pool[(i % 10) % pool.length].date, type, shiftCode: pool[(i % 10) % pool.length].shiftCode });
  }
  const sc = buildScenario(n, cases);
  const results = SM.match({ roster: sc.roster, shifts: SHIFTS, punches: sc.punches, excused: sc.excused, from: sc.from, to: sc.to });
  const count = (st) => results.filter((r) => r.status === st).length;
  const shiftCells = sc.roster.filter((c) => c.shiftCode).length;

  test("đúng số trường hợp cài sẵn", () => {
    expect(count("LateOrEarly")).toBe(10);
    expect(results.filter((r) => r.status === "LateOrEarly").every((r) => r.late === 20 && r.early === 0)).toBe(true);
    expect(count("Absent")).toBe(10);
    expect(count("MissingPunch")).toBe(10);
    expect(count("WorkedWithoutShift")).toBe(10);
    expect(count("Excused")).toBe(10);
    expect(results.filter((r) => r.overtime > 0).map((r) => r.overtime)).toEqual(Array(10).fill(90));
    expect(count("OnTime")).toBe(shiftCells - 40);
  });

  test("số ca đêm theo người khớp", () => {
    for (let i = 0; i < n; i++) {
      const emp = `E${String(i + 1).padStart(4, "0")}`;
      const lost = cases.filter((c) => c.employee === emp && c.shiftCode === "C3" && (c.type === "ABSENT" || c.type === "EXCUSED")).length;
      const expected = sc.roster.filter((c) => c.employee === emp && c.shiftCode === "C3").length - lost;
      expect(SM.countShifts(results.filter((r) => r.employee === emp), "N")).toBe(expected);
    }
  });

  test("xử lý chấm công sinh chứng từ chờ duyệt", () => {
    const docs = SM.processPunches(results, { startDate: sc.from, endDate: sc.to, shifts: SHIFTS });
    expect(docs.exceptions.filter((x) => x.exceptionType === "L")).toHaveLength(10);
    expect(docs.exceptions.filter((x) => x.exceptionType === "E")).toHaveLength(0);
    expect(docs.exceptions.filter((x) => x.exceptionType === "A" && x.adjustDays === -1)).toHaveLength(10);
    expect(docs.exceptions.filter((x) => x.exceptionType === "A" && x.adjustDays === 0)).toHaveLength(10);
    expect(docs.overtime).toHaveLength(20);
    expect(docs.overtime.filter((o) => o.hours === 1.5)).toHaveLength(10);
    expect(docs.overtime.filter((o) => o.hours === 4)).toHaveLength(10);
    // chạy lại: chứng từ đã gửi duyệt không sinh trùng
    const kept = docs.exceptions.map((x) => ({ kind: "exception", employee: x.employee, workDate: x.workDate, exceptionType: x.exceptionType }))
      .concat(docs.overtime.map((o) => ({ kind: "overtime", employee: o.employee, workDate: o.workDate })));
    const again = SM.processPunches(results, { startDate: sc.from, endDate: sc.to, shifts: SHIFTS, kept });
    expect(again.exceptions).toHaveLength(0);
    expect(again.overtime).toHaveLength(0);
    expect(again.kept).toBe(50);
  });

  test("OT đêm: ca đêm ra trễ 90 phút sau 06:00 không phải giờ đêm", () => {
    const r = results.find((x) => x.overtime > 0 && x.shiftCode === "C3");
    if (r) {
      const docs = SM.processPunches([r], { startDate: sc.from, endDate: sc.to, shifts: SHIFTS });
      expect(docs.overtime[0].isNight).toBe(false);
    }
  });
});

describe("hiệu năng", () => {
  test("2.000 người x 31 ngày < 10 giây", () => {
    const sc = buildScenario(2000, []);
    const t0 = Date.now();
    const results = SM.match({ roster: sc.roster, shifts: SHIFTS, punches: sc.punches, from: sc.from, to: sc.to });
    const ms = Date.now() - t0;
    expect(results.filter((r) => r.status === "OnTime")).toHaveLength(sc.roster.filter((c) => c.shiftCode).length);
    expect(ms).toBeLessThan(10000);
  }, 30000);
});
