// Mốc việc của kỳ lương cho Trang chủ (core/Deadlines): trạng thái mốc theo ngày, chọn kỳ đang chạy theo ngày.
const { core } = require("./helpers");
const Deadlines = core("Deadlines");

const period = { id: "5", start: "2027-03-01", end: "2027-03-31", status: "O", att_status: "O", paygroup: "1" };
const byKey = (list, key) => list.find((m) => m.key === key);

describe("milestones - mốc nội bộ", () => {
  test("không có hôm nay hoặc không có kỳ: danh sách rỗng, không ném lỗi", () => {
    expect(Deadlines.milestones(null)).toEqual([]);
    expect(Deadlines.milestones({ period })).toEqual([]);
    expect(Deadlines.milestones({ today: "2027-03-30" })).toEqual([]);
    expect(Deadlines.milestones({ today: "sai ngày", period })).toEqual([]);
    expect(Deadlines.milestones({ today: "2027-03-30", period: { end: "2027-02-31" } })).toEqual([]);
  });

  test("bốn mốc theo đúng thứ tự quy trình, ngày lấy từ kỳ", () => {
    const list = Deadlines.milestones({ today: "2027-03-20", period });
    expect(list.map((m) => m.key)).toEqual(["lockAttendance", "calculate", "approve", "post"]);
    expect(list.every((m) => m.date === "2027-03-31" && m.daysLeft === 11 && m.state === "upcoming")).toBe(true);
  });

  test("due khi còn 0 đến dueSoonDays ngày, overdue khi đã quá ngày", () => {
    expect(byKey(Deadlines.milestones({ today: "2027-03-28", period }), "calculate")).toEqual({ key: "calculate", date: "2027-03-31", state: "due", daysLeft: 3 });
    expect(byKey(Deadlines.milestones({ today: "2027-03-27", period }), "calculate").state).toBe("upcoming");
    expect(byKey(Deadlines.milestones({ today: "2027-03-31", period }), "calculate")).toMatchObject({ state: "due", daysLeft: 0 });
    expect(byKey(Deadlines.milestones({ today: "2027-04-02", period }), "calculate")).toMatchObject({ state: "overdue", daysLeft: -2 });
    expect(byKey(Deadlines.milestones({ today: "2027-03-20", period, dueSoonDays: 14 }), "calculate").state).toBe("due");
    expect(byKey(Deadlines.milestones({ today: "2027-03-30", period, dueSoonDays: 0 }), "calculate").state).toBe("upcoming");
  });

  test("khóa công: xong khi att_status = L (cả dạng attStatus) hoặc attendance.locked", () => {
    const today = "2027-04-05";
    expect(byKey(Deadlines.milestones({ today, period }), "lockAttendance").state).toBe("overdue");
    expect(byKey(Deadlines.milestones({ today, period: Object.assign({}, period, { att_status: "L" }) }), "lockAttendance")).toMatchObject({ state: "done", daysLeft: -5 });
    expect(byKey(Deadlines.milestones({ today, period: { end: "2027-03-31", attStatus: "L" } }), "lockAttendance").state).toBe("done");
    expect(byKey(Deadlines.milestones({ today, period, attendance: { locked: true } }), "lockAttendance").state).toBe("done");
  });

  test("trạng thái bảng lương quyết định mốc tính, duyệt, ghi sổ", () => {
    const states = (batch) => Deadlines.milestones({ today: "2027-04-05", period, batch }).slice(1).map((m) => m.state);
    const O = "overdue";
    const D = "done";
    expect(states(null)).toEqual([O, O, O]);
    expect(states({ status: "H" })).toEqual([O, O, O]);
    expect(states({ status: "B" })).toEqual([O, O, O]);
    expect(states({ status: "C", calculated: false })).toEqual([O, O, O]);
    expect(states({ status: "C", calculated: true })).toEqual([D, O, O]);
    expect(states({ status: "C", calculated: "T" })).toEqual([D, O, O]);
    expect(states({ status: "J", calculated: true })).toEqual([O, O, O]);
    expect(states({ status: "P" })).toEqual([D, O, O]);
    expect(states({ status: "A" })).toEqual([D, D, O]);
    expect(states({ status: "R" })).toEqual([D, D, D]);
    expect(states({ status: "V" })).toEqual([D, D, D]);
  });

  test("duyệt và ghi sổ theo ngày chứng từ của bảng lương; ngày sai thì về ngày kết thúc kỳ", () => {
    const list = Deadlines.milestones({ today: "2027-03-30", period, batch: { status: "C", calculated: true, doc_date: "2027-04-05" } });
    expect(byKey(list, "calculate").date).toBe("2027-03-31");
    expect(byKey(list, "approve")).toEqual({ key: "approve", date: "2027-04-05", state: "upcoming", daysLeft: 6 });
    expect(byKey(list, "post").date).toBe("2027-04-05");
    expect(byKey(Deadlines.milestones({ today: "2027-03-30", period, batch: { status: "B", docDate: "2027-04-02" } }), "post").date).toBe("2027-04-02");
    expect(byKey(Deadlines.milestones({ today: "2027-03-30", period, batch: { status: "B", doc_date: "?" } }), "post").date).toBe("2027-03-31");
  });

  test("offsets dời từng mốc nội bộ theo số ngày của đơn vị", () => {
    const list = Deadlines.milestones({ today: "2027-03-30", period, offsets: { lockAttendance: 2, post: 5, calculate: "x" } });
    expect(byKey(list, "lockAttendance").date).toBe("2027-04-02");
    expect(byKey(list, "calculate").date).toBe("2027-03-31");
    expect(byKey(list, "post")).toMatchObject({ date: "2027-04-05", daysLeft: 6 });
  });

  test("tính theo ngày kể cả khi mã kỳ lệch tháng, qua cả ranh giới năm", () => {
    const shifted = { id: "9", code: "202703", start: "2026-12-01", end: "2026-12-31", status: "O", att_status: "O" };
    expect(byKey(Deadlines.milestones({ today: "2027-01-02", period: shifted }), "calculate")).toMatchObject({ date: "2026-12-31", state: "overdue", daysLeft: -2 });
  });
});

describe("milestones - hạn truyền vào (theo luật, từ thiết lập)", () => {
  test("không tự sinh hạn theo luật nào khi nơi gọi không truyền", () => {
    const keys = Deadlines.milestones({ today: "2027-03-30", period }).map((m) => m.key);
    expect(keys.every((k) => Deadlines.INTERNAL_KEYS.includes(k))).toBe(true);
  });

  test("hạn truyền vào đứng sau mốc nội bộ, xếp theo ngày; bỏ dòng thiếu ngày, ngày sai, trùng key nội bộ", () => {
    const list = Deadlines.milestones({
      today: "2027-03-30",
      period,
      statutory: [
        { key: "pitReturn", date: "2027-04-30" },
        { key: "insurance", date: "2027-03-31", done: true },
        { key: "noDate" },
        { key: "bad", date: "31/31/2027" },
        { key: "post", date: "2027-01-01" },
        null,
      ],
    });
    expect(list.map((m) => m.key)).toEqual(["lockAttendance", "calculate", "approve", "post", "insurance", "pitReturn"]);
    expect(byKey(list, "insurance")).toEqual({ key: "insurance", date: "2027-03-31", state: "done", daysLeft: 1 });
    expect(byKey(list, "pitReturn")).toEqual({ key: "pitReturn", date: "2027-04-30", state: "upcoming", daysLeft: 31 });
  });

  test("hạn truyền vào vẫn tính được khi chưa có kỳ; nhận ngày dd/mm/yyyy", () => {
    expect(Deadlines.milestones({ today: "2027-03-30", statutory: [{ key: "insurance", date: "29/03/2027" }] })).toEqual([{ key: "insurance", date: "2027-03-29", state: "overdue", daysLeft: -1 }]);
  });
});

describe("currentPeriod - chọn kỳ đang chạy theo ngày", () => {
  const P = (id, start, end, extra) => Object.assign({ id, start, end, status: "O", paygroup: "1" }, extra);
  const year = [P("1", "2027-01-01", "2027-01-31"), P("2", "2027-02-01", "2027-02-28"), P("3", "2027-03-01", "2027-03-31"), P("4", "2027-04-01", "2027-04-30")];

  test("kỳ chứa hôm nay đã ghi sổ: kỳ đang chạy là kỳ kế sau kỳ ghi sổ muộn nhất", () => {
    // Hôm nay giữa kỳ 2; kỳ 1, 2 đã ghi sổ -> kỳ 3
    expect(Deadlines.currentPeriod(year, "2027-02-15", [], ["1", "2"]).id).toBe("3");
    // Đã ghi sổ trước cả kỳ 3 (dữ liệu dựng trước): hôm nay ở kỳ 2 -> kỳ 4
    expect(Deadlines.currentPeriod(year, "2027-02-15", [], ["1", "2", "3"]).id).toBe("4");
    // Kỳ chứa hôm nay chưa ghi sổ: giữ kỳ đó
    expect(Deadlines.currentPeriod(year, "2027-03-10", [], ["1", "2"]).id).toBe("3");
    // Kỳ ghi sổ muộn nhất là kỳ cuối cùng: không có kỳ kế tiếp, giữ cách chọn theo ngày
    expect(Deadlines.currentPeriod(year, "2027-04-10", [], ["4"]).id).toBe("4");
    // Có bảng lương đang dở thì kỳ của bảng đó vẫn thắng
    expect(Deadlines.currentPeriod(year, "2027-02-15", ["2"], ["1", "2"]).id).toBe("2");
    // Hai nhóm lương có kỳ trùng ngày: lấy kỳ kế tiếp cùng nhóm với kỳ vừa ghi sổ
    const two = [P("a1", "2027-01-01", "2027-01-31", { paygroup: "9" }), P("a2", "2027-02-01", "2027-02-28", { paygroup: "9" })].concat(year);
    expect(Deadlines.currentPeriod(two, "2027-01-15", [], ["1"]).id).toBe("2");
    expect(Deadlines.currentPeriod(two, "2027-01-15", [], ["a1"]).id).toBe("a2");
    // Không truyền danh sách kỳ đã ghi sổ: như cũ
    expect(Deadlines.currentPeriod(year, "2027-02-15", []).id).toBe("2");
  });

  test("không có kỳ, hôm nay sai, hoặc mọi kỳ đã đóng: null", () => {
    expect(Deadlines.currentPeriod([], "2027-03-30")).toBeNull();
    expect(Deadlines.currentPeriod(null, "2027-03-30")).toBeNull();
    expect(Deadlines.currentPeriod(year, "")).toBeNull();
    expect(Deadlines.currentPeriod(year.map((p) => Object.assign({}, p, { status: "C" })), "2027-03-30")).toBeNull();
  });

  test("kỳ chứa hôm nay, gồm hai đầu", () => {
    expect(Deadlines.currentPeriod(year, "2027-03-30").id).toBe("3");
    expect(Deadlines.currentPeriod(year, "2027-03-01").id).toBe("3");
    expect(Deadlines.currentPeriod(year, "2027-02-28").id).toBe("2");
  });

  test("kỳ có bảng lương chưa ghi sổ được ưu tiên, lấy kỳ sớm nhất", () => {
    expect(Deadlines.currentPeriod(year, "2027-03-30", ["2"]).id).toBe("2");
    expect(Deadlines.currentPeriod(year, "2027-03-30", [4, 2]).id).toBe("2");
    // kỳ đã đóng không được chọn dù có bảng lương dở
    const closed = year.map((p) => (p.id === "2" ? Object.assign({}, p, { status: "C" }) : p));
    expect(Deadlines.currentPeriod(closed, "2027-03-30", ["2"]).id).toBe("3");
  });

  test("hôm nay ngoài mọi kỳ: kỳ đã qua gần nhất, rồi mới tới kỳ sắp tới gần nhất", () => {
    expect(Deadlines.currentPeriod(year, "2027-06-15").id).toBe("4");
    expect(Deadlines.currentPeriod(year, "2026-11-10").id).toBe("1");
    expect(Deadlines.currentPeriod([P("7", "2027-05-01", "2027-05-31"), P("1", "2027-01-01", "2027-01-31")], "2027-03-10").id).toBe("1");
  });

  test("bỏ qua kỳ đã đóng và kỳ có ngày sai; mã kỳ không ảnh hưởng", () => {
    const list = [P("3", "2027-03-01", "2027-03-31", { status: "C" }), P("x", "", "2027-03-31"), P("y", "2027-03-31", "2027-03-01"), P("8", "2027-03-16", "2027-03-31", { code: "202609" })];
    expect(Deadlines.currentPeriod(list, "2027-03-20").id).toBe("8");
  });

  test("nhiều kỳ cùng chứa hôm nay (nửa tháng, tuần): kỳ bắt đầu muộn nhất", () => {
    const list = [P("m", "2027-03-01", "2027-03-31"), P("w", "2027-03-15", "2027-03-21")];
    expect(Deadlines.currentPeriod(list, "2027-03-18").id).toBe("w");
  });
});

describe("previousPeriod, upcomingPeriods", () => {
  const P = (id, start, end, paygroup, status) => ({ id, start, end, paygroup, status: status || "O" });
  const list = [P("1", "2027-01-01", "2027-01-31", "1", "C"), P("2", "2027-02-01", "2027-02-28", "1", "C"), P("3", "2027-03-01", "2027-03-31", "1"), P("4", "2027-04-01", "2027-04-30", "1"), P("9", "2027-02-16", "2027-02-28", "2")];

  test("kỳ liền trước cùng nhóm lương, kể cả kỳ đã đóng", () => {
    expect(Deadlines.previousPeriod(list, list[2]).id).toBe("2");
    expect(Deadlines.previousPeriod(list, list[1]).id).toBe("1");
    expect(Deadlines.previousPeriod(list, list[0])).toBeNull();
    expect(Deadlines.previousPeriod(list, list[4])).toBeNull();
    expect(Deadlines.previousPeriod(list, null)).toBeNull();
  });

  test("kỳ sắp tới: bắt đầu sau hôm nay, gần nhất trước, giới hạn số lượng, bỏ kỳ đã đóng", () => {
    expect(Deadlines.upcomingPeriods(list, "2027-02-10", 5).map((p) => p.id)).toEqual(["9", "3", "4"]);
    expect(Deadlines.upcomingPeriods(list, "2027-03-30").map((p) => p.id)).toEqual(["4"]);
    expect(Deadlines.upcomingPeriods(list, "2027-03-30", 0)).toEqual([]);
    expect(Deadlines.upcomingPeriods(list, "2027-05-01", 3)).toEqual([]);
    expect(Deadlines.upcomingPeriods(list, null, 3)).toEqual([]);
  });
});
