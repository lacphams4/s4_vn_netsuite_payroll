// Store giả trong bộ nhớ cho test tính lương theo lô (tests/api/calcchunks.test.js): find / findIn / get / run / submit trên dữ
// liệu logic (mã list giữ nguyên, checkbox là boolean), đếm số truy vấn và ghi lại cột đã SELECT để kiểm "không đọc thừa".
// Câu lệnh gọn của api/Lean (SELECT ... FROM customrecord_... t WHERE ...) được phân tích theo Schema thật.
const path = require("path");
const ROOT = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll");
const Schema = require(path.join(ROOT, "api/Schema"));
const Defaults = require(path.join(ROOT, "core/VietnamDefaults"));

const blank = (v) => v === null || v === undefined || v === "";
const byType = {};
for (const [name, def] of Object.entries(Schema.records)) byType[def.type] = name;

/** Điều kiện dạng "{a} = ? AND {b} IN (1,2) ..." -> hàm lọc dòng logic. */
function matcher(text, params) {
  const queue = (params || []).slice();
  const tests = String(text || "").split(" AND ").filter((x) => x.trim()).map((raw) => {
    const clause = raw.trim().replace(/^\((.*)\)$/, "$1");
    if (clause === "1 = 1" || /IN \(SELECT /.test(clause)) return () => true;
    let m = /^\{(\w+)\} (=|<>|LIKE) \?$/.exec(clause);
    if (m) {
      const p = queue.shift();
      const key = m[1] === "isinactive" ? "isInactive" : m[1];
      if (m[2] === "LIKE") return (r) => !blank(r[key]) && String(r[key]).indexOf(String(p).replace(/%$/, "")) === 0;
      if (m[2] === "=") return (r) => !blank(p) && !blank(r[key]) && String(r[key]) === String(p);
      return (r) => !blank(p) && !blank(r[key]) && String(r[key]) !== String(p);
    }
    m = /^\{(\w+)\} IN \(([^)]*)\)$/.exec(clause);
    if (m) {
      const list = m[2].split(",").map((x) => (x.trim() === "?" ? String(queue.shift()) : x.trim()));
      return (r) => !blank(r[m[1]]) && list.includes(String(r[m[1]]));
    }
    throw new Error(`calcFake: unsupported clause "${clause}"`);
  });
  return (r) => tests.every((t) => t(r));
}

function make(db) {
  const log = { queries: [], writes: [] };
  const rec = (name) => {
    if (!Schema.records[name]) throw new Error(`Unknown record ${name}`);
    return Schema.records[name];
  };
  const rowsOf = (name) => (db[name] || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
  const full = (name, r) => {
    const def = rec(name);
    const o = { id: String(r.id), isInactive: !!r.isInactive };
    if (def.includeName || def.numbering) o.name = r.name === undefined ? null : r.name;
    for (const [key, f] of Object.entries(def.fields)) o[key] = r[key] === undefined ? (f.type === "check" ? false : null) : r[key];
    return o;
  };

  function find(name, opt = {}) {
    const keep = matcher(opt.where, opt.params);
    const out = rowsOf(name).filter((r) => (opt.includeInactive || !r.isInactive) && keep(r)).map((r) => full(name, r));
    log.queries.push({ kind: "find", name, tag: `s4vp_find_${name}`, columns: Object.keys(rec(name).fields), rows: out.length });
    return out;
  }

  function findIn(name, field, ids, extraWhere, extraParams) {
    const out = [];
    const list = [...new Set((ids || []).filter((x) => !blank(x)).map(String))];
    for (let i = 0; i < list.length; i += 900) {
      const chunk = list.slice(i, i + 900);
      out.push(...find(name, { where: `{${field}} IN (${chunk.map(() => "?").join(",")})` + (extraWhere ? ` AND (${extraWhere})` : ""), params: chunk.concat(extraParams || []) }));
    }
    return out;
  }

  function run(sql, params, tag) {
    const text = String(sql).replace(/\s+/g, " ");
    if (tag === "s4vp_employee_info") {
      const ids = (/e\.id IN \(([\d,]+)\)/.exec(text) || ["", ""])[1].split(",");
      const out = (db.emp || []).filter((e) => ids.includes(String(e.id))).map((e) => Object.assign({ isinactive: "F", department: null, location: null, class: null, subsidiary: null, deptname: "" }, e));
      log.queries.push({ kind: "run", name: "emp", tag, columns: [], rows: out.length });
      return out;
    }
    if (/^s4vp_stamp_/.test(String(tag))) {
      log.queries.push({ kind: "run", name: "stamp", tag, columns: [], rows: 1 });
      return [{ m: "", n: 0 }];
    }
    const from = /FROM (customrecord_\w+) t WHERE (.*) ORDER BY t\.id$/.exec(text);
    if (!from || !byType[from[1]]) throw new Error(`calcFake: unexpected SQL (${tag}): ${text.slice(0, 160)}`);
    const name = byType[from[1]];
    const def = rec(name);
    const keyOf = {};
    for (const [key, f] of Object.entries(def.fields)) keyOf[f.id] = key;
    let cond = from[2];
    let active = false;
    const m = /^\((.*)\) AND t\.isinactive = 'F'$/.exec(cond);
    if (m) {
      cond = m[1];
      active = true;
    }
    cond = cond.replace(/t\.(\w+)/g, (all, col) => `{${keyOf[col] || col}}`);
    const keep = matcher(cond, params);
    const columns = [];
    const re = / AS c_(\w+)/g;
    let a;
    while ((a = re.exec(text))) columns.push(a[1]);
    const out = rowsOf(name).filter((r) => (!active || !r.isInactive) && keep(r)).map((r) => {
      const o = { id: r.id };
      for (const key of columns) o[`c_${key}`] = key === "isinactive" ? (r.isInactive ? "T" : "F") : r[key] === undefined ? null : r[key];
      return o;
    });
    log.queries.push({ kind: "run", name, tag, columns, rows: out.length });
    return out;
  }

  function submit(name, id, values) {
    const def = rec(name);
    for (const key of Object.keys(values)) if (key !== "name" && !def.fields[key]) throw new Error(`Unknown field ${name}.${key}`);
    const row = (db[name] || []).find((r) => String(r.id) === String(id));
    if (!row) throw new Error(`calcFake: ${name} ${id} not found`);
    Object.assign(row, values);
    log.writes.push({ name, id: String(id), values: JSON.parse(JSON.stringify(values)) });
  }

  const store = {
    find, findIn, run, submit, rec,
    get: (name, id) => find(name, { where: "{id} = ?", params: [id], includeInactive: true })[0] || null,
    codeOf: (list, v) => (blank(v) ? null : v),
    idOf: (list, code) => code,
    stats: [], memoize: () => undefined,
  };
  return { store, log };
}

// ------------------------------------------------------------------ dữ liệu mẫu

const ET = {};
Defaults.earningTypes.forEach((e, i) => (ET[e.code] = String(i + 1)));

/**
 * Bảng lương 7 (kỳ tháng 03/2027, công ty con 13) với n nhân viên đủ kiểu: lương tháng / lương giờ, cộng tác viên, người phụ
 * thuộc, gói phúc lợi, dòng nhập tay, giờ công, đơn OT, tạm ứng (một phần đang cấn ở bảng 8), lũy kế OT từ bảng đã ghi sổ 5 - 6,
 * bảng tỷ lệ phân bổ, nghỉ việc trong kỳ (phép còn lại), người nước ngoài (giấy phép), phiếu sản lượng cá nhân và phiếu tổ.
 * opt.semi: kỳ nửa tháng thứ hai, có bảng lương kỳ trước cùng tháng thuế (bảng 9).
 */
function buildDb(n, opt = {}) {
  const semi = !!opt.semi;
  const db = {};
  db.setup = [{
    id: "1", name: "SETUP", std_days: 0, hours_per_day: 8, weekly_off: "0", region: "I", base_et: ET.LUONG, allow_et: ET.PHUCAP, meal_et: ET.ANCA, ctr_et: ET.PHIDV, payout_et: ET.TRAPHEP,
    meal_amount: 35000, union_fund: true, ext_ot: false, require_approval: true, auto_approve: true, time_approval: true, ot_source: "R", require_lock: false, wp_blocks: false,
    alloc_method: "F", alloc_fallback: "P", alloc_version: "E", acc13_basis: "P", acc13_months: 12, acc_payable: "334", acc_pit: "3335", acc_advance: "141", acc_expense: "642",
    acc_other_ded: "3388", acc_13th: "335", acc_contractor: "331",
  }];
  db.company = [{ id: "1", name: "CTY", subsidiary: "13", enabled: true }];
  db.paygroup = [{ id: "1", name: "DEFAULT", frequency: semi ? "S" : "M" }];
  db.period = semi
    ? [
      { id: "2", name: "202703-1", paygroup: "1", frequency: "S", start: "2027-03-01", end: "2027-03-15", std_days: 11, status: "O", att_status: "O", tax_month: "202703", last_in_month: false },
      { id: "3", name: "202703-2", paygroup: "1", frequency: "S", start: "2027-03-16", end: "2027-03-31", std_days: 12, status: "O", att_status: "O", tax_month: "202703", last_in_month: true },
    ]
    : [{ id: "3", name: "202703", paygroup: "1", frequency: "M", start: "2027-03-01", end: "2027-03-31", std_days: 23, status: "O", att_status: "O", tax_month: "202703", last_in_month: true }];
  db.earning_type = Defaults.earningTypes.map((e) => ({
    id: ET[e.code], name: e.code, description: e.nameVi, category: e.category, tax: e.taxTreatment, cap_param: e.exemptCapParam, is_ot: e.isOvertime, ot_day: e.overtimeDayType,
    is_night: e.isNight, had_day_ot: e.hadDaytimeOvertime, time_type: e.timeTypeCode,
  }));
  db.earning_rule = Defaults.defaultEarningRules({ baseEarningType: "LUONG", contractorEarningType: "PHIDV", allowanceEarningType: "PHUCAP", mealEarningType: "ANCA", mealAllowanceAmount: 35000 }).map((r, i) => ({
    id: String(i + 1), name: r.code, description: r.description, sequence: r.sequence, earning_type: r.earningType ? ET[r.earningType] : null, paygroup: null, salary_type: r.salaryType || null,
    employment_type: r.employmentType || null, effective: null, expiration: null, qty_source: r.quantitySource, hours_fallback: !!r.hoursFallbackToWorkDays, base_et: null, shift_kind: null,
    rate_source: r.rateSource, fixed_rate: r.fixedRate === undefined ? null : r.fixedRate, rate_table: null, tier_method: null, multiplier: r.multiplier, proration: r.proration, fail_action: r.failAction, reduction: 0,
  }));
  db.rule_cond = [];
  db.benefit_pkg = [{ id: "1", name: "GOI1", total: 1500000 }];
  db.benefit_line = [{ id: "1", package: "1", earning_type: ET.PHUCAP, amount: 1000000 }, { id: "2", package: "1", earning_type: ET.THUONG, amount: 500000 }];
  db.param = Defaults.params.map((p, i) => ({ id: String(i + 1), name: p.code, effective: p.effectiveDate, expiration: p.expirationDate, value: Number(p.value), verified: p.verified }));
  db.pit_bracket = Defaults.brackets.map((b, i) => ({ id: String(i + 1), effective: b.effectiveDate, expiration: b.expirationDate, level: b.level, upper: b.upperBound, rate: Number(b.rate) }));
  db.ins_comp = Defaults.components.map((c, i) => ({
    id: String(i + 1), name: c.code, description: c.nameVi, effective: c.effectiveDate, expiration: c.expirationDate, ee_rate: Number(c.employeeRate), er_rate: Number(c.employerRate),
    wage_base: c.wageBase, union_only: c.requiresUnionMembership, cap_factor: c.employeeCapFactor === null ? null : Number(c.employeeCapFactor), account: c.liabilityAccount, vendor: null,
  }));
  db.holiday = Defaults.holidays.map((h, i) => ({ id: String(i + 1), name: h.nameVi, date: h.date, compensatory: h.isCompensatory }));
  db.cost_account = [
    { id: "1", subsidiary: null, target_type: "D", department: "31", labor_type: null, account: "6411" },
    { id: "2", subsidiary: "13", target_type: "P", project: "501", labor_type: null, account: "622" },
    { id: "3", subsidiary: "13", target_type: "W", work_center: "41", labor_type: "C", account: "627" },
  ];
  db.leave_type = [{ id: "1", name: "PN", is_paid: true, uses_balance: true }];
  db.rate_table = [{ id: "1", name: "DG1", type: "W", allow_override: false }];
  db.rate_line = [{ id: "1", table: "1", item: "SP1", rate: 5000, from_amount: 0, effective: "2026-01-01", expiration: null, project: null }];

  db.batch = [
    { id: "5", name: "BL000005", subsidiary: "13", period: "1", paygroup: "1", tax_month: "202701", status: "R", calculated: true, messages: "x".repeat(2000) },
    { id: "6", name: "BL000006", subsidiary: "13", period: "1", paygroup: "1", tax_month: "202702", status: "R", calculated: true },
    { id: "7", name: "BL000007", subsidiary: "13", period: "3", paygroup: "1", tax_month: "202703", doc_date: "2027-03-31", status: "B", calculated: false, job: null },
    { id: "8", name: "BL000008", subsidiary: "13", period: "4", paygroup: "1", tax_month: "202704", status: "C", calculated: true },
    { id: "11", name: "BL000011", subsidiary: "99", period: "3", paygroup: "1", tax_month: "202703", status: "C", calculated: true },
  ];
  if (semi) db.batch.push({ id: "9", name: "BL000009", subsidiary: "13", period: "2", paygroup: "1", tax_month: "202703", status: "C", calculated: true });

  for (const name of ["emp", "employee", "compensation", "dependent", "batch_emp", "batch_input", "batch_time", "ot_request", "advance", "alloc_version", "alloc_line", "leave_balance", "work_permit", "output", "output_line", "output_member"]) db[name] = [];
  let seq = 1000;
  const next = () => String(++seq);
  const std = semi ? 12 : 23;
  for (let i = 1; i <= n; i++) {
    const emp = String(100 + i);
    const prof = String(20000 + i);
    const contractor = i % 10 === 0;
    const hourly = !contractor && i % 7 === 0;
    const leaving = i % 11 === 0;
    const foreign = i % 13 === 0;
    db.emp.push({ id: emp, entityid: `E${String(i).padStart(4, "0")}`, firstname: `Tên ${i}`, lastname: "Nguyễn", department: i % 3 === 0 ? "31" : "32", location: "61", class: i % 4 === 0 ? "41" : null, subsidiary: "13", deptname: "Phòng" });
    db.employee.push({
      id: prof, name: `HS${i}`, employee: emp, subsidiary: "13", paygroup: "1", employment_type: contractor ? "C" : "E", salary_type: hourly ? "H" : "M", pit_method: contractor ? "F" : i % 17 === 0 ? "N" : "P",
      flat_commit: false, ins_applicable: !contractor, ui_applicable: !contractor, union_member: i % 3 === 0, region: i % 2 ? "I" : "II", accrue13: i % 2 === 0, expense_account: i % 9 === 0 ? "6421" : null,
      department: i % 3 === 0 ? "31" : null, class: i % 4 === 0 ? "41" : null, location: null, project: i % 5 === 0 ? "501" : null, alloc_method: null, seniority_date: "2020-01-01", hire_date: "2020-01-01",
      termination_date: leaving ? "2027-03-25" : null, foreign, sales_target: null,
    });
    const base = 9000000 + i * 700000;
    db.compensation.push({ id: next(), profile: prof, effective: "2025-01-01", base_salary: base - 1000000, insurance_wage: base - 1000000, allowance: 0, package: null });
    db.compensation.push({ id: next(), profile: prof, effective: "2027-01-01", base_salary: base, insurance_wage: i % 4 ? base : 8000000, allowance: i % 4 === 0 ? 1200000 : 0, package: i % 6 === 0 ? "1" : null });
    db.compensation.push({ id: next(), profile: prof, effective: "2027-06-01", base_salary: base * 2, insurance_wage: base * 2, allowance: 0, package: null });
    for (let d = 0; d < i % 3; d++) db.dependent.push({ id: next(), name: `NPT${i}-${d}`, profile: prof, from: "2026-01-01", to: d ? "2027-12-31" : null });
    db.batch_emp.push({
      id: String(70000 + i), batch: "7", employee: emp, profile: prof, employment_type: contractor ? "C" : "E", std_days: std, work_days: std - (i % 5), absence_days: i % 5, unpaid_leave: i % 5,
      other_tax_ded: i % 8 === 0 ? 400000 : 0, accrue13: i % 2 === 0, gross: 1, net: 1, detail: JSON.stringify({ stale: "y".repeat(500) }),
    });
    if (i % 4 === 1) db.batch_input.push({ id: next(), batch: "7", employee: emp, kind: "E", earning_type: ET.THUONG, description: "Thưởng", qty: 1, rate: 0, amount: 1500000 + i * 1000, manual_amount: true });
    if (i % 6 === 2) db.batch_input.push({ id: next(), batch: "7", employee: emp, kind: "D", code: "PHAT", description: "Phạt", amount: 250000 });
    if (hourly) {
      db.batch_time.push({ id: next(), batch: "7", employee: emp, source: "A", source_key: `${emp}|501|`, project: "501", hours: 100.5 + i, source_hours: 100.5 + i });
      db.batch_time.push({ id: next(), batch: "7", employee: emp, source: "A", source_key: `${emp}|502|`, project: "502", hours: 40.25, source_hours: 40.25 });
    }
    if (i % 3 === 1) {
      db.ot_request.push({ id: next(), name: `OT${i}A`, employee: emp, subsidiary: "13", work_date: semi ? "2027-03-20" : "2027-03-10", day_type: "N", hours: 4.5, is_night: false, earning_type: ET.OT150, status: "A" });
      db.ot_request.push({ id: next(), name: `OT${i}B`, employee: emp, subsidiary: "13", work_date: "2027-02-10", day_type: "N", hours: 8, is_night: false, earning_type: ET.OT150, status: "A" });
      db.ot_request.push({ id: next(), name: `OT${i}C`, employee: emp, subsidiary: "13", work_date: "2027-03-21", day_type: "W", hours: 3, is_night: true, earning_type: ET.OTD200, status: "P" });
    }
    if (i % 9 === 2) {
      db.advance.push({ id: next(), name: `TU${i}`, subsidiary: "13", employee: emp, doc_date: "2027-02-15", amount: 5000000, status: "O", offset: 2000000, balance: 3000000 });
      db.batch_emp.push({ id: String(80000 + i), batch: "8", employee: emp, profile: prof, employment_type: "E", detail: JSON.stringify({ advanceOffsets: [{ refNbr: `TU${i}`, amount: 1000000 + i }] }) });
    }
    // Lũy kế OT của năm: hai bảng đã ghi sổ, số lẻ để thứ tự cộng có ý nghĩa
    db.batch_emp.push({ id: String(50000 + i), batch: "5", employee: emp, profile: prof, ot_hours: 60.1 + i * 0.3, detail: JSON.stringify({ stale: "z".repeat(300) }) });
    db.batch_emp.push({ id: String(60000 + i), batch: "6", employee: emp, profile: prof, ot_hours: 130.2 + i * 0.7, detail: JSON.stringify({ stale: "z".repeat(300) }) });
    if (semi) {
      db.batch_emp.push({
        id: String(90000 + i), batch: "9", employee: emp, profile: prof, absence_days: i % 4, other_tax_ded: i % 8 === 0 ? 100000 : 0,
        detail: JSON.stringify({ earnings: [{ earningType: "LUONG", amount: Math.round(base / 2), taxExemptAmount: 0 }, { earningType: "ANCA", amount: 385000, taxExemptAmount: 385000 }] }),
      });
    }
    if (i % 5 === 3) {
      const v = next();
      db.alloc_version.push({ id: v, employee: emp, version: 1, effective: "2026-01-01", expiration: null, status: "A", used: false, total: 100 });
      db.alloc_line.push({ id: next(), version: v, project: "501", department: "31", percent: 60 });
      db.alloc_line.push({ id: next(), version: v, project: "502", department: "32", work_center: "41", percent: 40 });
    }
    if (leaving) db.leave_balance.push({ id: next(), employee: emp, leave_type: "1", year: 2027, entitled: 12, carried: 1.5, adjusted: 0, used: 3, pending: 0 });
    if (foreign) db.work_permit.push({ id: next(), name: `WP${i}`, employee: emp, doc_type: "P", issue_type: "N", status: "A", effective: "2026-01-01", expiry: "2027-04-10", permit_no: `GP${i}` });
  }
  // Phiếu sản lượng của kỳ: một phiếu cá nhân và một phiếu tổ có thành viên nằm ở nhiều lô
  db.output.push({ id: "1", name: "SL000001", subsidiary: "13", period: "3", type: "I", rate_table: "1", project: "501", status: "A", total: 900000, split_total: 0 });
  db.output_line.push({ id: "1", entry: "1", employee: "101", item: "SP1", qty: 100, rate: 5000, amount: 500000 });
  db.output_line.push({ id: "2", entry: "1", employee: String(100 + n), item: "SP1", qty: 80, rate: 5000, amount: 400000 });
  db.output.push({ id: "2", name: "SL000002", subsidiary: "13", period: "3", type: "T", rate_table: "1", project: "502", status: "A", total: 1200000, split_total: 1200000 });
  db.output_line.push({ id: "3", entry: "2", employee: null, item: "SP1", qty: 240, rate: 5000, amount: 1200000 });
  for (const [k, e] of [102, 100 + Math.ceil(n / 2), 100 + n - 1].entries()) db.output_member.push({ id: String(k + 1), entry: "2", employee: String(e), amount: 400000, manual: false });
  return db;
}

module.exports = { make, buildDb, ROOT, ET };
