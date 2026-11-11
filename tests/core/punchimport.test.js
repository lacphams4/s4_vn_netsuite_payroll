// core/PunchImport: đọc file máy chấm công theo hồ sơ nguồn (docs/PUNCH_IMPORT.md mục 2).
const { core } = require("./helpers");
const P = core("PunchImport");

const prof = (o) => Object.assign({ layout: "E", has_header: true, delimiter: "A", date_format: "DMY", col_emp: "Mã NV", col_datetime: "Thời điểm" }, o);
const times = (res) => res.rows.map((r) => `${r.machineId}@${r.time}${r.kind ? `/${r.kind}` : ""}`);

describe("helpers", () => {
  test("normalizeName bỏ dấu, đ -> d, chữ thường, gộp khoảng trắng", () => {
    expect(P.normalizeName("  Mã   Nhân viên ")).toBe("ma nhan vien");
    expect(P.normalizeName("ĐIỂM DANH")).toBe("diem danh");
    expect(P.normalizeName("﻿Giờ Vào")).toBe("gio vao");
    expect(P.normalizeName("Ngày chấm công")).toBe("ngay cham cong");
  });

  test("machineKey bỏ số 0 đầu với mã toàn số, chữ hoa", () => {
    expect(P.machineKey(" 00012 ")).toBe("12");
    expect(P.machineKey("0")).toBe("0");
    expect(P.machineKey("nv001")).toBe("NV001");
  });

  test("detectDelimiter: nhiều nhất thắng, bằng nhau tab > ; > ,", () => {
    expect(P.detectDelimiter("a,b,c")).toBe(",");
    expect(P.detectDelimiter("a;b;c,d")).toBe(";");
    expect(P.detectDelimiter("a\tb;c")).toBe("\t");
    expect(P.detectDelimiter('"x;y;z",b')).toBe(",");
    expect(P.detectDelimiter("abc")).toBe(",");
  });

  test("splitRecords: ngoặc kép, dấu phân cách và xuống dòng trong ô, CRLF, BOM", () => {
    const r = P.splitRecords('﻿a,"b,1","c ""q"""\r\nx,"multi\r\nline",z\ry', ",").records;
    expect(r).toEqual([
      { line: 1, cells: ["a", "b,1", 'c "q"'] },
      { line: 2, cells: ["x", "multi\nline", "z"] },
      { line: 4, cells: ["y"] },
    ]);
  });

  test("parseDate theo định dạng, serial, yyyyMMdd, năm 2 chữ số, ngày không tồn tại", () => {
    expect(P.parseDate("03/11/2026", "DMY")).toBe("2026-11-03");
    expect(P.parseDate("11/03/2026", "MDY")).toBe("2026-11-03");
    expect(P.parseDate("2026-11-03", "MDY")).toBe("2026-11-03");
    expect(P.parseDate("2026/11/3", "DMY")).toBe("2026-11-03");
    expect(P.parseDate("03.11.26", "DMY")).toBe("2026-11-03");
    expect(P.parseDate("3-11-2026", "YMD")).toBe("2026-11-03"); // YMD mà năm đứng cuối: hiểu DMY
    expect(P.parseDate("20261103", "DMY")).toBe("2026-11-03");
    expect(P.parseDate("46329", "DMY")).toBe("2026-11-03");
    expect(P.parseDate("31/02/2026", "DMY")).toBeNull();
    expect(P.parseDate("29/02/2028", "DMY")).toBe("2028-02-29");
    expect(P.parseDate("2026-13-01", "DMY")).toBeNull();
    expect(P.parseDate("hôm nay", "DMY")).toBeNull();
    expect(P.parseDate("46329.5", "DMY")).toBeNull();
  });

  test("parseTime: HH:mm[:ss], H:mm, AM/PM, SA/CH, 7h30, phần ngày Excel, giờ > 23:59 sai", () => {
    expect(P.parseTime("07:58")).toBe(478);
    expect(P.parseTime("7:58:59")).toBe(478);
    expect(P.parseTime("17:05:00.000")).toBe(1025);
    expect(P.parseTime("7:58 AM")).toBe(478);
    expect(P.parseTime("12:10 AM")).toBe(10);
    expect(P.parseTime("12:10 PM")).toBe(730);
    expect(P.parseTime("5:30 pm")).toBe(1050);
    expect(P.parseTime("5:30 CH")).toBe(1050);
    expect(P.parseTime("7:30 SA")).toBe(450);
    expect(P.parseTime("8 AM")).toBe(480);
    expect(P.parseTime("7h30")).toBe(450);
    expect(P.parseTime("7h")).toBe(420);
    expect(P.parseTime("7.30")).toBe(450);
    expect(P.parseTime("0.5")).toBe(720);
    expect(P.parseTime("0,75")).toBe(1080);
    expect(P.parseTime(".33333333")).toBe(480); // làm tròn đến giây trước: không thành 07:59
    expect(P.parseTime("46329.25")).toBe(360);
    expect(P.parseTime("24:00")).toBeNull();
    expect(P.parseTime("23:60")).toBeNull();
    expect(P.parseTime("13:00 PM")).toBeNull();
    expect(P.parseTime("7")).toBeNull();
    expect(P.parseTime("abc")).toBeNull();
  });

  test("parseDateTime: ISO T, AM/PM, serial có giờ, ngày không giờ, múi giờ cuối bỏ", () => {
    expect(P.parseDateTime("2026-11-03T07:58:12", "DMY")).toEqual({ date: "2026-11-03", minutes: 478 });
    expect(P.parseDateTime("2026-11-03T07:58:12Z", "DMY")).toEqual({ date: "2026-11-03", minutes: 478 });
    expect(P.parseDateTime("11/3/2026 5:02 PM", "MDY")).toEqual({ date: "2026-11-03", minutes: 1022 });
    expect(P.parseDateTime("46329.5", "DMY")).toEqual({ date: "2026-11-03", minutes: 720 });
    expect(P.parseDateTime("46329", "DMY")).toEqual({ date: "2026-11-03", minutes: null });
    expect(P.parseDateTime("03/11/2026", "DMY")).toEqual({ date: "2026-11-03", minutes: null });
    expect(P.parseDateTime("03/11/2026 25:00", "DMY")).toBeNull();
    expect(P.parseDateTime("31/11/2026 08:00", "DMY")).toBeNull();
  });

  test("stamp cộng lệch phút qua nửa đêm hai chiều", () => {
    expect(P.stamp("2026-11-03", 1435, 10)).toBe("2026-11-04 00:05");
    expect(P.stamp("2026-11-03", 5, -10)).toBe("2026-11-02 23:55");
    expect(P.stamp("2026-12-31", 1439, 1)).toBe("2027-01-01 00:00");
  });
});

describe("parseText - layout E", () => {
  test("cột ngày giờ theo tên có dấu, dấu phẩy tự nhận, BOM, CRLF, dòng trống bỏ qua", () => {
    const text = "﻿MÃ NV,Thoi diem,Máy\r\nNV001,03/11/2026 07:58:30,M1\r\n\r\n , , \r\nnv002,03/11/2026 17:05,\r\n";
    const res = P.parseText(text, prof({ col_device: "may", device_default: "CỔNG" }));
    expect(res.errors).toEqual([]);
    expect(res.header).toEqual(["MÃ NV", "Thoi diem", "Máy"]);
    expect(res.rows).toEqual([
      { line: 2, machineId: "NV001", device: "M1", time: "2026-11-03 07:58", kind: "" },
      { line: 5, machineId: "nv002", device: "CỔNG", time: "2026-11-03 17:05", kind: "" },
    ]);
  });

  test("cột theo số thứ tự, không tiêu đề, chấm phẩy, ngày + giờ tách riêng", () => {
    const text = "101;03/11/2026;7:58 AM\n102;03/11/2026;5:30 PM\n103;03/11/2026;\n";
    const res = P.parseText(text, prof({ has_header: false, col_emp: "1", col_datetime: "", col_date: "2", col_time: "3" }));
    expect(res.errors).toEqual([]);
    expect(times(res)).toEqual(["101@2026-11-03 07:58", "102@2026-11-03 17:30"]); // ô giờ trống: bỏ lượt, không lỗi
  });

  test("tab (dán từ Excel), ô có ngoặc kép chứa dấu phân cách", () => {
    const text = 'Mã\tNgày\tGiờ\tGhi chú\n"NV,01"\t2026-11-03\t08:00\t"a\tb"\n';
    const res = P.parseText(text, prof({ col_emp: "ma", col_datetime: "", col_date: "ngay", col_time: "gio" }));
    expect(times(res)).toEqual(["NV,01@2026-11-03 08:00"]);
  });

  test("date_format YMD / DMY / MDY", () => {
    const base = { has_header: false, col_emp: "1", col_datetime: "2" };
    expect(times(P.parseText("1,2026/11/03 08:00", prof(Object.assign({ date_format: "YMD" }, base))))).toEqual(["1@2026-11-03 08:00"]);
    expect(times(P.parseText("1;03/11/2026 08:00", prof(Object.assign({ date_format: "DMY" }, base))))).toEqual(["1@2026-11-03 08:00"]);
    expect(times(P.parseText("1;11/03/2026 08:00", prof(Object.assign({ date_format: "MDY" }, base))))).toEqual(["1@2026-11-03 08:00"]);
    expect(times(P.parseText("1;11/03/2026 08:00", prof(Object.assign({ date_format: "" }, base))))).toEqual(["1@2026-03-11 08:00"]); // mặc định DMY
  });

  test("serial Excel: ngày giờ một ô, và ngày serial + giờ phần ngày ở ô riêng", () => {
    const one = P.parseText("E1\t46329.3333333\n", prof({ has_header: false, col_emp: "1", col_datetime: "2" }));
    expect(times(one)).toEqual(["E1@2026-11-03 08:00"]);
    const two = P.parseText("E1\t46329\t0.75\nE2\t46329\t46329.5\n", prof({ has_header: false, col_emp: "1", col_datetime: "", col_date: "2", col_time: "3" }));
    expect(times(two)).toEqual(["E1@2026-11-03 18:00", "E2@2026-11-03 12:00"]);
  });

  test("ô giờ xuất từ Excel kèm ngày gốc 1899-12-30: chỉ lấy giờ", () => {
    const res = P.parseText("E1,03/11/2026,1899-12-30 07:45:00\n", prof({ has_header: false, col_emp: "1", col_datetime: "", col_date: "2", col_time: "3" }));
    expect(times(res)).toEqual(["E1@2026-11-03 07:45"]);
  });

  test("ô ngày có cả giờ, không khai cột giờ", () => {
    const res = P.parseText("E1,03/11/2026 07:45\nE2,03/11/2026\n", prof({ has_header: false, col_emp: "1", col_datetime: "", col_date: "2" }));
    expect(times(res)).toEqual(["E1@2026-11-03 07:45"]);
    expect(res.errors).toEqual([{ line: 2, vi: 'Ô ngày "03/11/2026" không có giờ', en: 'The date cell "03/11/2026" has no time' }]);
  });

  test("lỗi dòng hai thứ tiếng: ngày không tồn tại, giờ > 23:59, thiếu mã, thiếu ngày", () => {
    const text = "Mã,Thời điểm\nA,31/02/2026 08:00\nB,03/11/2026 24:10\n,03/11/2026 08:00\nC,03/11/2026 08:00\n";
    const res = P.parseText(text, prof({ col_emp: "ma", col_datetime: "thoi diem" }));
    expect(times(res)).toEqual(["C@2026-11-03 08:00"]);
    expect(res.errors).toEqual([
      { line: 2, vi: 'Ngày giờ "31/02/2026 08:00" không hợp lệ', en: 'Invalid date time "31/02/2026 08:00"' },
      { line: 3, vi: 'Ngày giờ "03/11/2026 24:10" không hợp lệ', en: 'Invalid date time "03/11/2026 24:10"' },
      { line: 4, vi: "Thiếu mã chấm công", en: "Missing attendance ID" },
    ]);
    const noDate = P.parseText("A,,08:00\n", prof({ has_header: false, col_emp: "1", col_datetime: "", col_date: "2", col_time: "3" }));
    expect(noDate.errors).toEqual([{ line: 1, vi: "Thiếu ngày", en: "Missing date" }]);
    const badTime = P.parseText("A,03/11/2026,7:61\n", prof({ has_header: false, col_emp: "1", col_datetime: "", col_date: "2", col_time: "3" }));
    expect(badTime.errors[0].en).toBe('Invalid time "7:61"');
  });

  test("skip_lines trước dòng tiêu đề; số dòng báo lỗi là dòng vật lý", () => {
    const text = "BÁO CÁO CHẤM CÔNG\nTháng 11\nMã;Thời điểm\nA;03/11/2026 08:00\nB;xx\n";
    const res = P.parseText(text, prof({ skip_lines: 2, col_emp: "Mã" }));
    expect(times(res)).toEqual(["A@2026-11-03 08:00"]);
    expect(res.errors.map((e) => e.line)).toEqual([5]);
  });

  test("minute_offset cộng sau khi đọc, qua nửa đêm", () => {
    const res = P.parseText("A,03/11/2026 23:55\nB,04/11/2026 00:03\n", prof({ has_header: false, col_emp: "1", col_datetime: "2", minute_offset: 10 }));
    expect(times(res)).toEqual(["A@2026-11-04 00:05", "B@2026-11-04 00:13"]);
    const back = P.parseText("A,04/11/2026 00:03\n", prof({ has_header: false, col_emp: "1", col_datetime: "2", minute_offset: -5 }));
    expect(times(back)).toEqual(["A@2026-11-03 23:58"]);
  });

  test("lỗi cấp file (fatal): không thấy cột, file không tiêu đề mà khai tên cột, thiếu khai cột", () => {
    expect(P.parseText("Mã,Giờ\nA,1\n", prof({ col_datetime: "Thời điểm" })).fatal.vi).toBe('Không thấy cột mã chấm công "Mã NV" trên dòng tiêu đề');
    expect(P.parseText("Mã,Giờ\nA,1\n", prof({ col_emp: "Mã", col_datetime: "Thời điểm" })).fatal.vi).toBe('Không thấy cột ngày giờ "Thời điểm" trên dòng tiêu đề');
    expect(P.parseText("A,1\n", prof({ has_header: false })).fatal.en).toMatch(/no header line/);
    expect(P.parseText("Mã\nA\n", prof({ col_emp: "", col_datetime: "1" })).fatal.vi).toBe("Hồ sơ nguồn chưa khai cột mã chấm công");
    expect(P.parseText("Mã\nA\n", prof({ col_emp: "Mã", col_datetime: "" })).fatal.en).toMatch(/no date time column/);
    expect(P.parseText("Mã\nA\n", prof({ col_emp: "1", col_datetime: "0" })).fatal.vi).toMatch(/phải từ 1/);
  });

  test("ngoặc kép không đóng: báo lỗi và đọc lại từng dòng", () => {
    const res = P.parseText('A,"03/11/2026 08:00\nB,03/11/2026 09:00\n', prof({ has_header: false, col_emp: "1", col_datetime: "2" }));
    expect(res.errors[0]).toEqual({ line: 1, vi: "Dấu ngoặc kép không đóng; dòng được đọc riêng từng dòng", en: "Unclosed quote; lines were read one by one" });
    expect(times(res)).toEqual(["A@2026-11-03 08:00", "B@2026-11-03 09:00"]);
  });

  test("file rỗng / chỉ có tiêu đề", () => {
    expect(P.parseText("", prof())).toEqual({ rows: [], errors: [], header: [] });
    expect(P.parseText("Mã NV,Thời điểm\n", prof()).rows).toEqual([]);
  });
});

describe("parseText - layout P", () => {
  const p = (o) => prof(Object.assign({ layout: "P", col_emp: "Mã", col_datetime: "", col_date: "Ngày", col_in: "Giờ vào", col_out: "Giờ ra" }, o));

  test("giờ vào và giờ ra, ca đêm sang ngày hôm sau, ô trống bỏ lượt đó", () => {
    const text = "Mã,Ngày,Giờ vào,Giờ ra\nA,03/11/2026,07:55,17:05\nB,03/11/2026,21:58,06:03\nC,03/11/2026,08:00,\nD,03/11/2026,,\nE,03/11/2026,,17:00\n";
    const res = P.parseText(text, p());
    expect(res.errors).toEqual([]);
    expect(times(res)).toEqual([
      "A@2026-11-03 07:55/in", "A@2026-11-03 17:05/out",
      "B@2026-11-03 21:58/in", "B@2026-11-04 06:03/out",
      "C@2026-11-03 08:00/in",
      "E@2026-11-03 17:00/out",
    ]);
  });

  test("ca đêm cuối tháng / cuối năm và lệch phút", () => {
    const res = P.parseText("A,31/12/2026,22:00,06:00\n", p({ has_header: false, col_emp: "1", col_date: "2", col_in: "3", col_out: "4", minute_offset: -3 }));
    expect(times(res)).toEqual(["A@2026-12-31 21:57/in", "A@2027-01-01 05:57/out"]);
  });

  test("ô giờ có kèm ngày thì dùng ngày đó (không cộng ngày ca đêm)", () => {
    const res = P.parseText("A,03/11/2026,03/11/2026 22:00,05/11/2026 06:00\n", p({ has_header: false, col_emp: "1", col_date: "2", col_in: "3", col_out: "4" }));
    expect(times(res)).toEqual(["A@2026-11-03 22:00/in", "A@2026-11-05 06:00/out"]);
  });

  test("lỗi dòng: giờ sai, ngày sai, thiếu ngày, thiếu mã", () => {
    const text = "A,03/11/2026,25:00,17:00\nB,30/02/2026,08:00,17:00\nC,,08:00,17:00\n,03/11/2026,08:00,17:00\nF,03/11/2026,08:00,17:99\n";
    const res = P.parseText(text, p({ has_header: false, col_emp: "1", col_date: "2", col_in: "3", col_out: "4" }));
    expect(res.rows).toEqual([]);
    expect(res.errors).toEqual([
      { line: 1, vi: 'Giờ vào "25:00" không hợp lệ', en: 'Invalid in time "25:00"' },
      { line: 2, vi: 'Ngày "30/02/2026" không hợp lệ', en: 'Invalid date "30/02/2026"' },
      { line: 3, vi: "Thiếu ngày", en: "Missing date" },
      { line: 4, vi: "Thiếu mã chấm công", en: "Missing attendance ID" },
      { line: 5, vi: 'Giờ ra "17:99" không hợp lệ', en: 'Invalid out time "17:99"' },
    ]);
  });

  test("thiếu khai cột của layout P là lỗi cấp file", () => {
    expect(P.parseText("Mã,Ngày\n", p({ col_in: "", col_out: "" })).fatal.vi).toBe("Layout P cần cột ngày, cột giờ vào và cột giờ ra");
  });
});

describe("parseText - layout Z (ZKTeco attlog)", () => {
  test("tab, không tiêu đề, mã có khoảng trắng đầu, cột trạng thái bỏ qua, bỏ qua has_header và khai cột", () => {
    const text = "     1\t2026-11-03 07:58:12\t1\t0\t1\t0\r\n    23\t2026-11-03 17:01:59\t1\t1\t1\t0\r\n";
    const res = P.parseText(text, { layout: "Z", has_header: true, col_emp: "Mã", date_format: "MDY", device_default: "ZK-01" });
    expect(res.errors).toEqual([]);
    expect(res.rows).toEqual([
      { line: 1, machineId: "1", device: "ZK-01", time: "2026-11-03 07:58", kind: "" },
      { line: 2, machineId: "23", device: "ZK-01", time: "2026-11-03 17:01", kind: "" },
    ]);
  });

  test("attlog cách bằng khoảng trắng (không tab) và dòng hỏng", () => {
    const res = P.parseText("  7  2026-11-03 08:00:00  1 0\n  8\t2026-02-30 08:00:00\t1\n", { layout: "Z" });
    expect(times(res)).toEqual(["7@2026-11-03 08:00"]);
    expect(res.errors).toEqual([{ line: 2, vi: 'Ngày giờ "2026-02-30 08:00:00" không hợp lệ', en: 'Invalid date time "2026-02-30 08:00:00"' }]);
  });

  test("minute_offset áp cho Z", () => {
    expect(times(P.parseText("1\t2026-11-03 23:59:00\n", { layout: "Z", minute_offset: 2 }))).toEqual(["1@2026-11-04 00:01"]);
  });
});

describe("resolveEmployees", () => {
  const row = (machineId, time, device) => ({ line: 1, machineId, device: device || "", time, kind: "" });

  test("idKind N: mã nhân viên NetSuite (không phân biệt hoa thường) hoặc id nội bộ (id thắng khi trùng)", () => {
    const out = P.resolveEmployees([row("nv001", "2026-11-03 08:00"), row("501", "2026-11-03 08:00"), row("X", "2026-11-03 08:00"), row("123", "2026-11-03 08:00")], {
      idKind: "N", employeesByCode: { NV001: "501", 123: "900" }, employeeIds: ["501", "123"], mappings: [{ machineId: "X", employee: "777" }],
    });
    expect(out.map((r) => [r.employee, r.how])).toEqual([["501", "code"], ["501", "code"], [null, null], ["123", "code"]]);
  });

  test("idKind M: chỉ bảng đối chiếu", () => {
    const out = P.resolveEmployees([row("NV001", "2026-11-03 08:00"), row("12", "2026-11-03 08:00")], {
      idKind: "M", employeesByCode: { NV001: "501" }, employeeIds: ["501"], mappings: [{ machineId: "0012", device: "", employee: "601" }],
    });
    expect(out.map((r) => [r.employee, r.how])).toEqual([[null, null], ["601", "map"]]);
  });

  test("idKind B (mặc định): bảng đối chiếu trước, không có thì mã nhân viên (không id nội bộ)", () => {
    const out = P.resolveEmployees([row("NV001", "2026-11-03 08:00"), row("NV002", "2026-11-03 08:00"), row("501", "2026-11-03 08:00")], {
      employeesByCode: { NV001: "501", NV002: "502" }, employeeIds: new Set(["501", "502"]), mappings: [{ machineId: "nv001", employee: "999" }],
    });
    // B sau bảng đối chiếu chỉ tra mã nhân viên: mã số 501 của máy không bị hiểu thành id nội bộ 501
    expect(out.map((r) => [r.employee, r.how])).toEqual([["999", "map"], ["502", "code"], [null, null]]);
  });

  test("ưu tiên dòng cùng máy hơn dòng máy trống; máy khác không dùng", () => {
    const mappings = [
      { machineId: "5", device: "", employee: "100" },
      { machineId: "5", device: "M2", employee: "200" },
      { machineId: "6", device: "M9", employee: "300" },
    ];
    const out = P.resolveEmployees([row("5", "2026-11-03 08:00", "m2"), row("5", "2026-11-03 08:00", "M1"), row("5", "2026-11-03 08:00", ""), row("6", "2026-11-03 08:00", "M1")], { idKind: "M", mappings });
    expect(out.map((r) => r.employee)).toEqual(["200", "100", "100", null]);
  });

  test("hiệu lực: ngoài khoảng thì không dùng; dòng cùng máy hết hiệu lực thì về dòng máy trống; nhiều dòng lấy hiệu lực muộn nhất", () => {
    const mappings = [
      { machineId: "5", device: "", employee: "100", effective: "2026-01-01", expiration: null },
      { machineId: "5", device: "", employee: "150", effective: "2026-11-01", expiration: "" },
      { machineId: "5", device: "M2", employee: "200", effective: "2026-01-01", expiration: "2026-10-31" },
      { machineId: "7", device: "", employee: "700", effective: "2026-12-01" },
    ];
    const rows = [row("5", "2026-10-31 08:00", "M2"), row("5", "2026-11-01 08:00", "M2"), row("5", "2026-10-15 08:00"), row("7", "2026-11-30 23:59")];
    expect(P.resolveEmployees(rows, { idKind: "M", mappings }).map((r) => r.employee)).toEqual(["200", "150", "100", null]);
  });

  test("dòng đối chiếu thiếu mã / nhân viên bị bỏ qua", () => {
    const out = P.resolveEmployees([row("5", "2026-11-03 08:00")], { idKind: "M", mappings: [null, { machineId: "", employee: "1" }, { machineId: "5", employee: "" }] });
    expect(out[0].employee).toBeNull();
  });
});

describe("dedupe", () => {
  test("trùng lượt đã có và trùng trong file; dòng chưa có nhân viên giữ status null", () => {
    const rows = [
      { line: 2, employee: "1", time: "2026-11-03 08:00" },
      { line: 3, employee: "1", time: "2026-11-03 08:00" },
      { line: 4, employee: "1", time: "2026-11-03 17:00" },
      { line: 5, employee: "2", time: "2026-11-03 08:00" },
      { line: 6, employee: null, time: "2026-11-03 08:00" },
    ];
    const out = P.dedupe(rows, ["1|2026-11-03 17:00"]);
    expect(out.map((r) => [r.status, r.dupLine])).toEqual([["new", null], ["duplicate", 2], ["duplicate", null], ["new", null], [null, null]]);
  });

  test("khóa theo phút: giây khác nhau cùng phút là trùng (parseText đã bỏ giây)", () => {
    const res = P.parseText("A,03/11/2026 08:00:05\nA,03/11/2026 08:00:55\n", prof({ has_header: false, col_emp: "1", col_datetime: "2" }));
    const out = P.dedupe(P.resolveEmployees(res.rows, { idKind: "N", employeesByCode: { A: "9" } }), new Set());
    expect(out.map((r) => r.status)).toEqual(["new", "duplicate"]);
  });
});
