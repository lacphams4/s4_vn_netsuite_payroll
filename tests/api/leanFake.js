// Store.run giả cho các câu SuiteQL gọn (api/Lean và các mô-đun hiệu năng): tra theo tag của câu lệnh, lọc dữ liệu mẫu trong
// bộ nhớ và trả dòng thô đúng các alias mà câu lệnh SELECT (c_<trường>, p_<trường>, e_code...). Giá trị list trả thẳng mã gốc
// (Store.codeOf của test phải giữ nguyên mã lạ), checkbox trả boolean.
//
// db: { <tên logic của record>: [dòng logic], emp: [{id, entityid, firstname, lastname, dept}] (bảng employee của NetSuite) }
// Dùng: const out = leanFake.run(db, sql, params, tag); out === undefined nghĩa là tag không thuộc bộ này.

const blank = (v) => v === null || v === undefined || v === "";
const table = (db, name) => (db[name] || []).filter(Boolean);
const active = (rows) => rows.filter((r) => !r.isInactive);
const idsIn = (sql, re) => ((re.exec(sql) || ["", ""])[1] || "").split(",").map((x) => x.trim()).filter(Boolean);

/** Số cột trong danh sách SELECT đầu tiên của câu lệnh (để test kiểm "không kéo cột thừa"). */
function columnsOf(sql) {
  const head = String(sql).slice(0, String(sql).indexOf(" FROM "));
  return (head.match(/ AS /g) || []).length;
}

/** Dòng thô theo các alias `<prefix><key>` có trong câu lệnh. */
function raw(sql, row, prefix, into) {
  const out = into || { id: row.id };
  const re = new RegExp(` AS ${prefix}(\\w+)`, "g");
  let m;
  while ((m = re.exec(sql))) {
    const k = m[1];
    if (k === "isinactive") out[`${prefix}${k}`] = row.isInactive ? "T" : "F";
    else out[`${prefix}${k}`] = row[k] === undefined ? null : row[k];
  }
  return out;
}

function empInfo(db, id, into) {
  const e = table(db, "emp").find((x) => String(x.id) === String(id));
  const d = e || (db.autoEmp ? { entityid: `E0${id}`, firstname: `NV${id}`, lastname: "", dept: "Kế toán" } : {});
  into.e_code = d.entityid || null;
  into.e_first = d.firstname || null;
  into.e_last = d.lastname || null;
  into.e_dept = d.dept || null;
  return into;
}

const inRange = (from, to, start, end) => !blank(from) && String(from) <= String(end) && String(blank(to) ? from : to) >= String(start);

const DOCS = {
  leave: { name: "leave_request", from: "from", to: "to", reason: "reason" },
  trip: { name: "business_trip", from: "from", to: "to", reason: "purpose" },
  exception: { name: "att_exception", from: "work_date", to: "work_date", reason: "reason" },
  ot: { name: "ot_request", from: "work_date", to: "work_date", reason: "reason" },
};
const DOC_KEYS = ["name", "employee", "status", "summary_locked", "days", "hours", "minutes", "leave_type", "from_half", "to_half", "exception_type", "deduct_days", "adjust_days", "from_punches"];

function attDocs(db, type, end, start) {
  const d = DOCS[type];
  return active(table(db, d.name))
    .filter((r) => inRange(r[d.from], r[d.to], start, end))
    .map((r) => {
      const o = { kind: type, id: r.id, c_from: r[d.from] || null, c_to: r[d.to] || null, c_reason: String(r[d.reason] || "").slice(0, 200) || null };
      for (const k of DOC_KEYS) o[`c_${k}`] = r[k] === undefined ? null : r[k];
      const lt = type === "leave" ? table(db, "leave_type").find((x) => String(x.id) === String(r.leave_type)) || {} : {};
      for (const k of ["name", "is_paid", "deducts_days", "paid_by_si"]) o[`lt_${k}`] = lt[k] === undefined ? null : lt[k];
      return o;
    });
}

function homeDocs(db, type, p) {
  const [end, start, pending, sub] = p;
  const d = DOCS[type];
  const mine = (r) => (blank(r.subsidiary) ? table(db, "employee").some((x) => String(x.employee) === String(r.employee) && String(x.subsidiary) === String(sub)) : String(r.subsidiary) === String(sub));
  const rows = active(table(db, d.name)).filter((r) => r.status === pending && mine(r));
  return [{ kind: type, n: rows.length, inp: rows.length ? rows.filter((r) => inRange(r[d.from], r[d.to], start, end)).length : null }];
}

/** Hồ sơ lương thuộc lưới công: nhóm lương (IN / NOT IN trong câu lệnh), thời gian làm việc theo 4 tham số ngày đầu tiên. */
function attScope(db, sql, params) {
  const [start, end] = params;
  const notIn = /NOT IN \(([\d,]+)\)/.exec(sql);
  const isIn = /WHERE \(*t\.\w+ IN \(([\d,]+)\)/.exec(sql);
  return table(db, "employee").filter((r) => {
    if (notIn && !blank(r.paygroup) && notIn[1].split(",").includes(String(r.paygroup))) return false;
    if (!notIn && isIn && !isIn[1].split(",").includes(String(r.paygroup))) return false;
    if (r.isInactive && !(r.termination_date && r.termination_date >= start && r.termination_date <= end)) return false;
    return (blank(r.hire_date) || r.hire_date <= end) && (blank(r.termination_date) || r.termination_date >= start);
  });
}

const HANDLERS = {
  // ---------------- api/Lean
  s4vp_lean_lines(db, sql) {
    const ids = idsIn(sql, / IN \(([\d,]+)\) AND t\.isinactive/);
    return active(table(db, "batch_emp")).filter((l) => ids.includes(String(l.batch))).map((l) => empInfo(db, l.employee, raw(sql, l, "c_")));
  },
  s4vp_lean_batches(db, sql, params) {
    const me = table(db, "batch").find((b) => String(b.id) === String(params[0]));
    if (!me || blank(me.subsidiary) || me.isInactive) return [];
    return active(table(db, "batch")).filter((b) => String(b.subsidiary) === String(me.subsidiary)).map((b) => raw(sql, table(db, "period").find((p) => String(p.id) === String(b.period)) || {}, "p_", raw(sql, b, "c_")));
  },
  // ---------------- api/Checks
  s4vp_checks_batch(db, sql, params) {
    return table(db, "batch").filter((b) => String(b.id) === String(params[0])).map((b) => raw(sql, table(db, "period").find((p) => String(p.id) === String(b.period)) || {}, "p_", raw(sql, b, "c_")));
  },
  s4vp_checks_profiles(db, sql) {
    const ids = idsIn(sql, / IN \(([\d,]+)\) AND l\.isinactive/);
    const emps = active(table(db, "batch_emp")).filter((l) => ids.includes(String(l.batch))).map((l) => String(l.employee));
    return active(table(db, "employee")).filter((p) => emps.includes(String(p.employee))).map((p) => {
      const o = raw(sql, p, "c_");
      o.has_tax = blank(String(p.tax_code || "").trim()) ? "F" : "T";
      o.has_bank = blank(String(p.bank_account || "").trim()) || blank(String(p.bank_name || "").trim()) ? "F" : "T";
      return o;
    });
  },
  s4vp_checks_hours(db, sql, params) {
    const by = {};
    for (const t of active(table(db, "batch_time"))) if (String(t.batch) === String(params[0])) by[t.employee] = (by[t.employee] || 0) + (Number(t.hours) || 0);
    return Object.keys(by).map((emp) => ({ emp, n: by[emp] }));
  },
  s4vp_checks_inputs(db, sql, params) {
    const by = {};
    for (const t of active(table(db, "batch_input"))) if (String(t.batch) === String(params[0]) && t.kind === params[1]) by[t.employee] = (by[t.employee] || 0) + 1;
    return Object.keys(by).map((emp) => ({ emp, n: by[emp] }));
  },
  s4vp_checks_params(db, sql) {
    return active(table(db, "param")).filter((p) => /^(MINWAGE\.|CHECK\.)/.test(String(p.name || "").toUpperCase())).map((p) => raw(sql, p, "c_"));
  },
  s4vp_checks_results(db, sql, params) {
    if (db.notDeployed) throw new Error("Record type not found");
    return active(table(db, "check_result")).filter((r) => String(r.batch) === String(params[0])).map((r) => raw(sql, r, "c_"));
  },
  s4vp_checks_history(db, sql) {
    const ids = idsIn(sql, /t\.id IN \(([\d,]+)\)/);
    return table(db, "check_result").filter((r) => ids.includes(String(r.id))).map((r) => raw(sql, r, "c_"));
  },
  // ---------------- api/Home
  s4vp_home_paygroups: (db, sql) => table(db, "paygroup").map((g) => raw(sql, g, "c_")),
  s4vp_home_periods: (db, sql) => active(table(db, "period")).map((p) => raw(sql, p, "c_")),
  s4vp_home_batches: (db, sql, params) => active(table(db, "batch")).filter((b) => String(b.subsidiary) === String(params[0])).sort((a, b) => Number(b.id) - Number(a.id)).map((b) => raw(sql, b, "c_")),
  s4vp_home_docs(db, sql, params) {
    if (db.failUnion) throw new Error("UNION not supported");
    return Object.keys(DOCS).filter((t) => sql.indexOf(`'${t}' AS kind`) >= 0).reduce((all, t, i) => all.concat(homeDocs(db, t, params.slice(i * 5, i * 5 + 5))), []);
  },
  s4vp_home_permits(db, sql, params) {
    if (db.failPermits) throw new Error("no permission");
    const [a, e, sub] = params;
    return active(table(db, "work_permit"))
      .filter((r) => (r.status === a || r.status === e) && table(db, "employee").some((x) => String(x.employee) === String(r.employee) && String(x.subsidiary) === String(sub)))
      .map((r) => raw(sql, r, "c_"));
  },
  // ---------------- api/AttendanceMonth
  s4vp_att_paygroups: (db, sql) => table(db, "paygroup").map((g) => raw(sql, g, "c_")),
  s4vp_att_period: (db, sql, params) => table(db, "period").filter((p) => String(p.id) === String(params[0])).map((p) => raw(sql, p, "c_")),
  s4vp_att_periods: (db, sql) => table(db, "period").map((p) => raw(sql, p, "c_")),
  s4vp_att_profiles(db, sql, params) {
    if (db.failDepartment && / department d /.test(sql)) throw new Error("no department");
    return attScope(db, sql, params).filter((r) => params.length < 5 || String(r.subsidiary) === String(params[4])).map((r) => empInfo(db, r.employee, raw(sql, r, "c_")));
  },
  s4vp_att_batches(db, sql, params) {
    const by = {};
    for (const b of active(table(db, "batch"))) if (String(b.period) === String(params[0])) by[b.status] = (by[b.status] || 0) + 1;
    return Object.keys(by).map((v) => ({ k: "B", v, n: by[v] }));
  },
  s4vp_att_other: (db, sql, params) => [{ k: "O", v: 0, n: attScope(db, sql, params).filter((r) => blank(r.subsidiary) || String(r.subsidiary) !== String(params[4])).length }],
  s4vp_att_meta(db, sql, params) {
    if (db.failUnion) throw new Error("UNION not supported");
    return HANDLERS.s4vp_att_batches(db, sql, params).concat(HANDLERS.s4vp_att_other(db, sql.slice(sql.indexOf("UNION ALL")), params.slice(1)));
  },
  s4vp_att_symbols: (db, sql) => active(table(db, "att_symbol")).map((s) => raw(sql, s, "c_")),
  s4vp_att_docs(db, sql, params) {
    if (db.failUnion) throw new Error("UNION not supported");
    return Object.keys(DOCS).reduce((all, t) => all.concat(attDocs(db, t, params[0], params[1])), []);
  },
  s4vp_att_summaries: (db, sql, params) => active(table(db, "attendance")).filter((r) => String(r.period) === String(params[0])).map((r) => raw(sql, r, "c_")),
};
HANDLERS.s4vp_lean_lines_df = HANDLERS.s4vp_lean_lines;
HANDLERS.s4vp_att_profiles_df = HANDLERS.s4vp_att_profiles;
for (const t of Object.keys(DOCS)) {
  HANDLERS[`s4vp_home_docs_${t}`] = (db, sql, params) => homeDocs(db, t, params);
  HANDLERS[`s4vp_att_docs_${t}`] = (db, sql, params) => attDocs(db, t, params[0], params[1]);
}

function run(db, sql, params, tag) {
  const h = HANDLERS[tag];
  if (!h) return undefined;
  if (/SELECT \*/i.test(sql)) throw new Error(`SELECT * in ${tag}`);
  return h(db, String(sql), params || [], tag);
}

module.exports = { run, columnsOf, HANDLERS };
