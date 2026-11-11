// Mô-đun route api/OutputsV2 (giao diện bản 2): outputsView, outputRate, outputLookups với Store giả (Lean, Schema, lõi thật).
// Kiểm: chỉ đọc, số đếm và thẻ số liệu, tên lấy bằng JOIN, việc cần xử lý, xem trước chia tiền đúng lõi, số truy vấn không tăng
// theo số phiếu, id ghép thẳng, đơn giá hiệu lực theo ngày và dự án.
const path = require("path");
const API = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api");
const CORE = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/core");

const mockDb = { output: [], output_line: [], output_member: [], batch: [], team: [], rate_table: [], rate_line: [], period: [], emp: [], profiles: [], jobs: [], calls: [], sql: [], writes: [], failJob: false, failProjects: false, failBatches: false };
const db = mockDb;

jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => {
  const write = (name) => () => {
    mockDb.writes.push(name);
    throw new Error("OutputsV2 must not write");
  };
  // Dòng thô theo các alias `<prefix><khóa>` có trong câu lệnh
  const raw = (sql, row, prefix, into) => {
    const out = into || { id: row.id };
    const re = new RegExp(` AS ${prefix}(\\w+)`, "g");
    let m;
    while ((m = re.exec(sql))) out[`${prefix}${m[1]}`] = row[m[1]] === undefined ? null : typeof row[m[1]] === "boolean" ? (row[m[1]] ? "T" : "F") : row[m[1]];
    return out;
  };
  const by = (list, id) => list.find((x) => String(x.id) === String(id)) || {};
  // Phạm vi của câu lệnh: công ty con và kỳ ghép thẳng trong WHERE
  const inScope = (sql, e) => {
    const where = sql.slice(sql.lastIndexOf(" WHERE "));
    const sub = /_subsidiary = (\d+)/.exec(where);
    const per = /_period = (\d+)/.exec(where);
    return !e.isInactive && (!sub || String(e.subsidiary) === sub[1]) && (!per || String(e.period) === per[1]);
  };
  const child = (name) => (sql) => {
    const sub = /pf\.\w+_subsidiary = (\d+)/.exec(sql)[1];
    const out = [];
    for (const r of mockDb[name]) {
      const e = by(mockDb.output, r.entry);
      if (!e.id || !inScope(sql, e)) continue;
      const emp = by(mockDb.emp, r.employee);
      const profs = mockDb.profiles.filter((p) => String(p.employee) === String(r.employee) && String(p.subsidiary) === sub);
      // Mỗi hồ sơ lương khớp sinh một dòng (như LEFT JOIN thật); không có hồ sơ thì pf_id rỗng
      for (const p of profs.length ? profs : [null]) out.push(Object.assign(raw(sql, r, "c_"), { e_code: emp.entityid || null, e_first: emp.firstname || null, e_last: emp.lastname || null, pf_id: p ? p.id : null }));
    }
    return out;
  };
  const HANDLERS = {
    s4vp_out_entries: (sql) => {
      if (mockDb.failJob) throw new Error("job not readable");
      return HANDLERS.s4vp_out_entries_df(sql);
    },
    s4vp_out_entries_df: (sql) =>
      mockDb.output
        .filter((e) => inScope(sql, e))
        .sort((a, b) => Number(b.id) - Number(a.id))
        .map((e) => {
          const o = raw(sql, e, "c_");
          raw(sql, by(mockDb.team, e.team), "tm_", o);
          raw(sql, by(mockDb.rate_table, e.rate_table), "rt_", o);
          raw(sql, by(mockDb.period, e.period), "p_", o);
          const ab = by(mockDb.emp, e.approved_by);
          const j = by(mockDb.jobs, e.project);
          return Object.assign(o, { ab_code: ab.entityid || null, ab_first: ab.firstname || null, ab_last: ab.lastname || null, j_code: /job j/.test(sql) ? j.entityid || null : null, j_name: j.companyname || null });
        }),
    s4vp_out_lines: child("output_line"),
    s4vp_out_members: child("output_member"),
    s4vp_out_batches: (sql) => {
      if (mockDb.failBatches) throw new Error("no permission");
      return mockDb.batch.filter((b) => inScope(sql, b)).sort((a, b) => Number(b.id) - Number(a.id)).map((b) => raw(sql, b, "c_"));
    },
    s4vp_out_table: (sql) => mockDb.rate_table.filter((t) => String(t.id) === /t\.id = (\d+)/.exec(sql)[1]).map((t) => raw(sql, t, "c_")),
    s4vp_out_rate_lines: (sql) => mockDb.rate_line.filter((l) => String(l.table) === /_table = (\d+)/.exec(sql)[1]).map((l) => raw(sql, l, "c_")),
    s4vp_out_tables: (sql) => mockDb.rate_table.filter((t) => !t.isInactive).map((t) => raw(sql, t, "c_")),
    s4vp_out_teams: (sql) => mockDb.team.map((t) => raw(sql, t, "c_")),
    s4vp_out_projects: () => {
      if (mockDb.failProjects) throw new Error("no permission");
      return mockDb.jobs.slice(0, 301);
    },
  };
  return {
    codeOf: (list, v) => v,
    run: (sql, params, tag) => {
      mockDb.calls.push(tag);
      mockDb.sql.push({ sql, params, tag });
      if (!HANDLERS[tag]) throw new Error(`unexpected query ${tag}`);
      return HANDLERS[tag](String(sql));
    },
    find: write("find"),
    findIn: write("findIn"),
    get: write("get"),
    create: write("create"),
    update: write("update"),
    submit: write("submit"),
    remove: write("remove"),
  };
});

const V2 = require(path.join(API, "OutputsV2"));
const Rules = require(path.join(CORE, "OutputRules"));

let seq = 1000;
const entry = (id, status, extra) => Object.assign({ id: String(id), name: `SL00000${id}`, subsidiary: "13", doc_date: "2027-03-10", period: "3", type: "T", rate_table: "1", team: "5", split_method: "F", project: null, location: null, work_center: null, description: "", status, approved_by: null, approved_date: null, batch: null }, extra);
const line = (entryId, qty, rate, extra) => Object.assign({ id: String(seq++), entry: String(entryId), employee: null, item: "XAY", description: "Xây tường", uom: "m2", qty, rate, amount: Math.round(qty * rate) }, extra);
const member = (entryId, employee, amount, extra) => Object.assign({ id: String(seq++), entry: String(entryId), employee: String(employee), work_days: 20, hours: 0, factor: 1, percent: 0, amount, manual: false }, extra);
const view = (params) => V2.outputsView(Object.assign({ subsidiary: "13" }, params));
const rowOf = (r, id) => r.rows.find((x) => x.id === String(id));

beforeEach(() => {
  seq = 1000;
  Object.assign(db, { calls: [], sql: [], writes: [], failJob: false, failProjects: false, failBatches: false });
  db.emp = [
    { id: "7", entityid: "E012", firstname: "An", lastname: "Nguyễn Văn" },
    { id: "8", entityid: "E013", firstname: "Bình", lastname: "Trần Thị" },
    { id: "9", entityid: "E014", firstname: "Cường", lastname: "Lê Hoàng" },
    { id: "2", entityid: "E002", firstname: "Dung", lastname: "Phạm Thu" },
  ];
  db.profiles = [{ id: "70", employee: "7", subsidiary: "13" }, { id: "80", employee: "8", subsidiary: "13" }, { id: "81", employee: "8", subsidiary: "13" }, { id: "90", employee: "9", subsidiary: "14" }];
  db.period = [
    { id: "2", name: "2027-02", start: "2027-02-01", end: "2027-02-28", status: "C", att_status: "L" },
    { id: "3", name: "2027-03", start: "2027-03-01", end: "2027-03-31", status: "O", att_status: "O" },
  ];
  db.team = [
    { id: "5", name: "TO-XAY-1", description: "Tổ xây 1", subsidiary: "13", split_method: "F", project: "50", location: null, work_center: null },
    { id: "6", name: "TO-KHAC", description: "Tổ công ty khác", subsidiary: "14", split_method: "D" },
    { id: "7", name: "TO-CHUNG", description: "Tổ dùng chung", subsidiary: null, split_method: "E" },
  ];
  db.rate_table = [
    { id: "1", name: "KHOAN-XD", description: "Khoán xây dựng", type: "W", allow_override: false },
    { id: "2", name: "HH-DS", description: "Hoa hồng doanh số", type: "S", allow_override: false },
    { id: "3", name: "CONG-DOAN", description: "Công đoạn", type: "O", allow_override: true },
  ];
  db.rate_line = [
    { id: "1", table: "1", item: "XAY", description: "Xây tường", uom: "m2", rate: 100000, effective: "2027-01-01", expiration: null, project: null },
    { id: "2", table: "1", item: "XAY", description: "Xây tường", uom: "m2", rate: 120000, effective: "2027-03-01", expiration: null, project: null },
    { id: "3", table: "1", item: "XAY", description: "Xây tường dự án A", uom: "m2", rate: 150000, effective: "2027-01-01", expiration: null, project: "50" },
    { id: "4", table: "1", item: "TRAT", description: "Trát", uom: "m2", rate: 60000, effective: "2027-04-01", expiration: null, project: null },
    { id: "5", table: "3", item: "MAY", description: "May", uom: "cái", rate: 5000, effective: "2027-01-01", expiration: "2027-02-28", project: null },
  ];
  db.jobs = [{ id: "50", entityid: "DA01", companyname: "Dự án A" }];
  db.batch = [
    { id: "6", name: "BL000006", subsidiary: "13", period: "2", status: "R" },
    { id: "7", name: "BL000007", subsidiary: "13", period: "3", status: "C" },
    { id: "8", name: "BL000008", subsidiary: "14", period: "3", status: "R" },
  ];
  db.output = [
    entry(1, "H"), // tổ, đã có dòng và thành viên, chưa chia
    entry(2, "P", { project: "50" }), // tổ, chờ duyệt, chia đủ
    entry(3, "A", { type: "I", team: null, split_method: null, approved_by: "2", approved_date: "2027-03-12" }), // cá nhân, đã duyệt
    entry(4, "C", { period: "2", batch: "6", doc_date: "2027-02-20" }), // đã vào bảng lương
    entry(5, "H", { type: "I", team: null, rate_table: "2", split_method: null }), // doanh số, chưa có dòng
    entry(9, "A", { subsidiary: "14" }),
  ];
  db.output_line = [line(1, 10, 120000), line(2, 5, 150000), line(3, 4, 120000, { employee: "7" }), line(3, 2, 120000, { employee: "9" }), line(4, 10, 100000), line(9, 1, 1)];
  db.output_member = [member(1, 7, 0), member(1, 8, 0, { work_days: 10 }), member(2, 7, 400000), member(2, 8, 350000), member(4, 7, 1000000)];
});

describe("outputsView", () => {
  test("trả phiếu của công ty con, mới nhất trước, kèm tên lấy bằng JOIN", () => {
    const r = view();
    expect(r.rows.map((x) => x.id)).toEqual(["5", "4", "3", "2", "1"]);
    const two = rowOf(r, 2);
    expect(two).toMatchObject({ name: "SL000002", date: "2027-03-10", type: "T", kind: "T", status: "P", teamName: "TO-XAY-1", teamDescription: "Tổ xây 1", rateTableName: "KHOAN-XD", rateTableType: "W", allowOverride: false, periodName: "2027-03", periodStatus: "O", project: "50", projectName: "DA01 Dự án A", total: 750000, splitTotal: 750000, people: 2 });
    expect(two.members.map((m) => [m.code, m.name, m.amount])).toEqual([["E012", "Nguyễn Văn An", 400000], ["E013", "Trần Thị Bình", 350000]]);
    expect(rowOf(r, 3)).toMatchObject({ type: "I", kind: "I", approvedDate: "2027-03-12", approvedBy: "Phạm Thu Dung", total: 720000, people: 2 });
    expect(rowOf(r, 3).lines[0]).toMatchObject({ employee: "7", code: "E012", name: "Nguyễn Văn An", item: "XAY", qty: 4, rate: 120000, amount: 480000, noProfile: false });
    expect(rowOf(r, 5)).toMatchObject({ kind: "S", type: "I", rateTableName: "HH-DS" });
    expect(rowOf(r, 4)).toMatchObject({ status: "C", batch: "6", batchName: "BL000006", batchStatus: "R" });
  });

  test("số đếm, thẻ số liệu và tổng", () => {
    const r = view();
    expect(r.counts).toMatchObject({ all: 5, H: 2, P: 1, A: 1, C: 1 });
    expect(r.cards.pending).toEqual({ count: 1, amount: 750000 });
    expect(r.cards.approved).toEqual({ count: 1, amount: 720000 });
    expect(r.cards.total).toEqual({ count: 5, amount: 1200000 + 750000 + 720000 + 1000000, holdCount: 2, holdAmount: 1200000 });
    expect(r.cards.included).toEqual({ count: 1, amount: 1000000, batches: [{ id: "6", name: "BL000006" }] });
    expect(r.totals).toEqual({ total: 3670000, splitTotal: 750000 + 1000000 });
    expect(r.batches.map((b) => b.id)).toEqual(["7", "6"]);
  });

  test("lọc theo kỳ bằng SQL, id ghép thẳng, không tham số ràng buộc", () => {
    const r = view({ period: "2" });
    expect(r.rows.map((x) => x.id)).toEqual(["4"]);
    expect(r.counts.all).toBe(1);
    for (const q of db.sql) {
      expect(q.params).toEqual([]);
      expect(q.sql).toMatch(/_subsidiary = 13/);
      expect(q.sql).toMatch(/_period = 2/);
      expect(q.sql).not.toMatch(/SELECT \*/);
    }
  });

  test("từ chối công ty con hoặc kỳ không phải số (không ghép chuỗi lạ vào câu lệnh)", () => {
    expect(() => V2.outputsView({})).toThrow(/subsidiary/i);
    expect(() => V2.outputsView({ subsidiary: "13 OR 1=1" })).toThrow(/subsidiary/i);
    expect(() => V2.outputsView({ subsidiary: "13", period: "3; DROP" })).toThrow(/period/i);
    expect(db.calls).toEqual([]);
  });

  test("việc cần xử lý: chưa chia, chia lệch, chưa có thành viên, chưa có hồ sơ lương, kỳ đã ghi sổ, thiếu đơn giá, chưa có dòng, chưa có kỳ", () => {
    db.output.push(
      entry(10, "H"), // tổ có dòng, không thành viên
      entry(11, "P"), // chia lệch
      entry(12, "A", { period: "2", doc_date: "2027-02-25" }), // kỳ 2 đã có bảng lương ghi sổ
      entry(13, "H", { period: null }), // chưa có kỳ, dòng thiếu đơn giá
      entry(14, "H", { type: "I", team: null }) // cá nhân, người chưa có hồ sơ lương ở công ty con này
    );
    db.output_line.push(line(10, 1, 100000), line(11, 10, 100000), line(12, 1, 100000), line(13, 3, 0), line(14, 2, 100000, { employee: "9" }));
    db.output_member.push(member(11, 7, 600000), member(11, 8, 300000), member(12, 7, 100000));
    const r = view();
    expect(rowOf(r, 1).issues).toEqual(["NOT_SPLIT"]);
    expect(rowOf(r, 10).issues).toEqual(["NO_MEMBERS"]);
    expect(rowOf(r, 11).issues).toEqual(["SPLIT_MISMATCH"]);
    expect(rowOf(r, 12).issues).toEqual(["PERIOD_POSTED"]);
    expect(rowOf(r, 12).postedBatch).toEqual({ id: "6", name: "BL000006" });
    expect(rowOf(r, 13).issues).toEqual(["RATE_MISSING", "NO_LINES", "NO_PERIOD"]);
    expect(rowOf(r, 14).issues).toEqual(["NO_PROFILE"]);
    expect(rowOf(r, 14).lines[0].noProfile).toBe(true);
    expect(rowOf(r, 3).issues).toEqual(["NO_PROFILE"]); // nhân viên 9 chỉ có hồ sơ ở công ty con 14
    expect(rowOf(r, 5).issues).toEqual(["NO_LINES"]);
    // Phiếu đã vào bảng lương và phiếu chia đủ không bị nêu
    expect(rowOf(r, 4).issues).toEqual([]);
    expect(rowOf(r, 4).postedBatch).toBeNull();
    expect(rowOf(r, 2).issues).toEqual([]);
    expect(r.issues.map((i) => [i.code, i.count])).toEqual([["PERIOD_POSTED", 1], ["SPLIT_MISMATCH", 1], ["NOT_SPLIT", 1], ["NO_MEMBERS", 1], ["NO_PROFILE", 2], ["RATE_MISSING", 1], ["NO_LINES", 2], ["NO_PERIOD", 1]]);
    expect(r.issues.find((i) => i.code === "NO_PROFILE").entries.sort()).toEqual(["14", "3"]);
    expect(r.counts.attention).toBe(8);
  });

  test("xem trước chia tiền dùng đúng lõi chia của splitOutput và không ghi", () => {
    const r = view();
    const one = rowOf(r, 1);
    const expected = Rules.split(1200000, [{ workDays: 20, hours: 0, splitFactor: 1, fixedPercent: 0 }, { workDays: 10, hours: 0, splitFactor: 1, fixedPercent: 0 }], "F");
    expect(one.members.map((m) => m.preview)).toEqual(expected);
    expect(expected.reduce((s, x) => s + x, 0)).toBe(1200000);
    expect(one.splitError).toBeNull();
    expect(one.hasManual).toBe(false);
    // Phiếu không còn tạm giữ: không tính xem trước
    expect(rowOf(r, 2).members.map((m) => m.preview)).toEqual([null, null]);
    expect(db.writes).toEqual([]);
  });

  test("không chia được (không có ngày công) thì trả lý do hai ngôn ngữ, không ném lỗi", () => {
    db.output_member.filter((m) => m.entry === "1").forEach((m) => (m.work_days = 0));
    const one = rowOf(view(), 1);
    expect(one.splitError.en).toMatch(/no work days/i);
    expect(one.splitError.vi).toMatch(/ngày công/);
    expect(one.members.map((m) => m.preview)).toEqual([null, null]);
  });

  test("nhân viên có hai hồ sơ lương không làm lặp dòng; số sửa tay được đánh dấu", () => {
    db.output_member.find((m) => m.entry === "2" && m.employee === "8").manual = true;
    const two = rowOf(view(), 2);
    expect(two.members).toHaveLength(2);
    expect(two.hasManual).toBe(true);
    expect(two.splitTotal).toBe(750000);
  });

  test("số truy vấn không tăng theo số phiếu", () => {
    view();
    const few = db.calls.slice();
    expect(few).toEqual(["s4vp_out_entries", "s4vp_out_lines", "s4vp_out_members", "s4vp_out_batches"]);
    for (let i = 0; i < 200; i++) {
      db.output.push(entry(100 + i, ["H", "P", "A"][i % 3], { project: i % 2 ? "50" : null }));
      db.output_line.push(line(100 + i, 2, 100000), line(100 + i, 1, 50000));
      db.output_member.push(member(100 + i, 7, 125000), member(100 + i, 8, 125000));
    }
    db.calls = [];
    const r = view();
    expect(r.rows).toHaveLength(205);
    expect(db.calls).toEqual(few);
    expect(db.writes).toEqual([]);
  });

  test("không có phiếu thì không đọc dòng con", () => {
    const r = view({ subsidiary: "99" });
    expect(r.rows).toEqual([]);
    expect(r.counts).toEqual({ all: 0, H: 0, P: 0, A: 0, C: 0, attention: 0 });
    expect(db.calls).toEqual(["s4vp_out_entries", "s4vp_out_batches"]);
  });

  test("vai trò không đọc được bảng job hoặc bảng lương: màn vẫn mở", () => {
    db.failJob = true;
    db.failBatches = true;
    const r = view();
    expect(db.calls.slice(0, 2)).toEqual(["s4vp_out_entries", "s4vp_out_entries_df"]);
    expect(rowOf(r, 2).projectName).toBe("Dự án A");
    expect(r.batches).toEqual([]);
    expect(rowOf(r, 4)).toMatchObject({ batch: "6", batchName: "" });
    expect(r.cards.included.batches).toEqual([{ id: "6", name: "" }]);
  });
});

describe("outputRate", () => {
  const rate = (params) => V2.outputRate(Object.assign({ rateTable: "1", date: "2027-03-10" }, params));
  const itemOf = (r, code) => r.items.find((x) => x.item === code);

  test("đơn giá hiệu lực mới nhất theo ngày phiếu; hạng mục chưa hiệu lực thì rate = null", () => {
    const r = rate();
    expect(r.table).toEqual({ id: "1", code: "KHOAN-XD", description: "Khoán xây dựng", type: "W", allowOverride: false });
    expect(r.items.map((x) => x.item)).toEqual(["TRAT", "XAY"]);
    expect(itemOf(r, "XAY")).toMatchObject({ rate: 120000, effective: "2027-03-01", forProject: false, uom: "m2" });
    expect(itemOf(r, "TRAT")).toMatchObject({ rate: null, description: "Trát" });
    expect(itemOf(rate({ date: "2027-02-10" }), "XAY").rate).toBe(100000);
    expect(db.calls).toEqual(["s4vp_out_table", "s4vp_out_rate_lines", "s4vp_out_table", "s4vp_out_rate_lines"]);
  });

  test("ưu tiên dòng theo dự án của phiếu; lọc một hạng mục", () => {
    const r = rate({ project: "50", item: "xay" });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ item: "XAY", rate: 150000, forProject: true, description: "Xây tường dự án A" });
  });

  test("đơn giá hết hạn không được gợi ý; bảng cho sửa đơn giá", () => {
    const r = rate({ rateTable: "3" });
    expect(r.table.allowOverride).toBe(true);
    expect(itemOf(r, "MAY").rate).toBeNull();
    expect(itemOf(rate({ rateTable: "3", date: "2027-02-01" }), "MAY").rate).toBe(5000);
  });

  test("bảng thang doanh số không có hạng mục và không đọc dòng", () => {
    const r = rate({ rateTable: "2" });
    expect(r.table.type).toBe("S");
    expect(r.items).toEqual([]);
    expect(db.calls).toEqual(["s4vp_out_table"]);
  });

  test("thiếu bảng đơn giá, ngày sai, bảng không tồn tại", () => {
    expect(() => V2.outputRate({ date: "2027-03-10" })).toThrow(/rate table/i);
    expect(() => V2.outputRate({ rateTable: "1", date: "10/03/2027" })).toThrow(/date/i);
    expect(() => V2.outputRate({ rateTable: "77", date: "2027-03-10" })).toThrow(/not found/i);
  });
});

describe("outputLookups", () => {
  test("bảng đơn giá, tổ của công ty con hoặc dùng chung, dự án", () => {
    const r = V2.outputLookups({ subsidiary: "13" });
    expect(r.rateTables.map((t) => [t.code, t.type, t.allowOverride])).toEqual([["KHOAN-XD", "W", false], ["HH-DS", "S", false], ["CONG-DOAN", "O", true]]);
    expect(r.teams.map((t) => t.code)).toEqual(["TO-XAY-1", "TO-CHUNG"]);
    expect(r.teams[0]).toMatchObject({ id: "5", splitMethod: "F", project: "50" });
    expect(r.projects).toEqual([{ id: "50", name: "DA01 Dự án A" }]);
    expect(r.projectsMore).toBe(false);
    expect(db.calls).toEqual(["s4vp_out_tables", "s4vp_out_teams", "s4vp_out_projects"]);
  });

  test("quá 300 dự án thì báo còn nữa; không đọc được dự án thì danh sách rỗng", () => {
    db.jobs = Array.from({ length: 320 }, (x, i) => ({ id: String(1000 + i), entityid: `DA${i}`, companyname: `DA${i}` }));
    const r = V2.outputLookups({ subsidiary: "13" });
    expect(r.projects).toHaveLength(300);
    expect(r.projects[0].name).toBe("DA0");
    expect(r.projectsMore).toBe(true);
    db.failProjects = true;
    expect(V2.outputLookups({ subsidiary: "13" })).toMatchObject({ projects: [], projectsMore: false });
  });
});

describe("routes", () => {
  test("ba lượt đọc cho vai trò payroll, không có POST, không ghi", () => {
    expect(Object.keys(V2.routes.get).sort()).toEqual(["outputLookups", "outputRate", "outputsView"]);
    for (const k of Object.keys(V2.routes.get)) expect(V2.routes.get[k].roles).toBe("payroll");
    expect(V2.routes.post).toEqual({});
    V2.routes.get.outputsView.run({ subsidiary: "13" });
    V2.routes.get.outputRate.run({ rateTable: "1", date: "2027-03-10" });
    V2.routes.get.outputLookups.run({ subsidiary: "13" });
    expect(db.writes).toEqual([]);
  });
});
