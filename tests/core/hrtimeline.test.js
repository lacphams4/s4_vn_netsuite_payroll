// Nhân sự bản 2 (core/HrTimeline): trạng thái hợp đồng, chồng lấn, kiểm hợp đồng và quyết định, dòng thời gian, việc sắp đến hạn.
const { core } = require("./helpers");
const T = core("HrTimeline");

const TODAY = "2027-03-15";
const codes = (errs) => errs.map((e) => e.code);
const contract = (o) => Object.assign({ id: "1", employee: "7", type: "F", effective: "2027-01-01", expiry: "2027-12-31", status: "A", parent: null }, o);

describe("contractState / currentContract", () => {
  test("nháp, chấm dứt giữ nguyên; hiệu lực đã qua ngày kết thúc là hết hạn; chưa tới ngày hiệu lực là future", () => {
    expect(T.contractState(contract({ status: "D" }), TODAY)).toEqual({ state: "D", future: false });
    expect(T.contractState(contract({ status: "T", terminated: "2027-02-01" }), TODAY)).toEqual({ state: "T", future: false });
    expect(T.contractState(contract({ expiry: "2027-03-14" }), TODAY)).toEqual({ state: "X", future: false });
    expect(T.contractState(contract({ expiry: "2027-03-15" }), TODAY)).toEqual({ state: "A", future: false });
    expect(T.contractState(contract({ effective: "2027-04-01" }), TODAY)).toEqual({ state: "A", future: true });
    expect(T.contractState(contract({ type: "U", expiry: null }), TODAY)).toEqual({ state: "A", future: false });
  });

  test("hợp đồng hiện tại: hợp đồng gốc hiệu lực mới nhất, bỏ phụ lục, nháp, tương lai", () => {
    const list = [
      contract({ id: "1", type: "P", effective: "2026-11-01", expiry: "2026-12-31" }),
      contract({ id: "2", effective: "2027-01-01", expiry: "2027-12-31" }),
      contract({ id: "3", parent: "2", type: null, effective: "2027-03-01", expiry: null }),
      contract({ id: "4", status: "D", effective: "2027-02-01" }),
      contract({ id: "5", effective: "2028-01-01", expiry: "2028-12-31" }),
    ];
    expect(T.currentContract(list, TODAY).id).toBe("2");
    expect(T.currentContract([list[0]], TODAY)).toBeNull();
    expect(T.latestContract([list[0], list[3]]).id).toBe("1");
  });
});

describe("overlaps", () => {
  const a = contract({ id: "1", number: "HD01", effective: "2027-01-01", expiry: "2027-06-30" });
  test("nối tiếp ngày hôm sau không chồng lấn; trùng một ngày là chồng lấn", () => {
    expect(T.overlaps([a], contract({ id: "2", effective: "2027-07-01", expiry: "2027-12-31" }))).toEqual([]);
    expect(T.overlaps([a], contract({ id: "2", effective: "2027-06-30", expiry: "2027-12-31" })).map((c) => c.id)).toEqual(["1"]);
    expect(T.overlaps([a], contract({ id: "2", effective: "2026-01-01", expiry: "2027-01-01" })).length).toBe(1);
    expect(T.overlaps([a], contract({ id: "2", effective: "2026-01-01", expiry: "2026-12-31" }))).toEqual([]);
  });
  test("không thời hạn chồng với mọi hợp đồng bắt đầu sau nó; hợp đồng đã chấm dứt chỉ tính đến ngày chấm dứt", () => {
    const open = contract({ id: "1", type: "U", effective: "2026-01-01", expiry: null });
    expect(T.overlaps([open], contract({ id: "2", effective: "2030-01-01", expiry: "2030-12-31" })).length).toBe(1);
    const ended = Object.assign({}, open, { status: "T", terminated: "2027-02-28" });
    expect(T.overlaps([ended], contract({ id: "2", effective: "2027-03-01", expiry: "2027-12-31" }))).toEqual([]);
    expect(T.overlaps([ended], contract({ id: "2", effective: "2027-02-28", expiry: "2027-12-31" })).length).toBe(1);
  });
  test("bỏ qua chính nó, bản nháp và phụ lục", () => {
    const list = [a, contract({ id: "3", status: "D", effective: "2027-01-01" }), contract({ id: "4", parent: "1", effective: "2027-03-01" })];
    expect(T.overlaps(list, a)).toEqual([]);
    expect(T.overlaps(list, contract({ id: "9", parent: "1", effective: "2027-02-01" }))).toEqual([]);
    expect(T.overlaps(list, contract({ id: "9", effective: "2027-02-01", expiry: "2027-02-28" })).map((c) => c.id)).toEqual(["1"]);
  });
});

describe("validateContract", () => {
  test("hợp đồng hợp lệ không có lỗi", () => {
    expect(T.validateContract(contract({}))).toEqual([]);
    expect(T.validateContract(contract({ type: "U", expiry: null }))).toEqual([]);
    expect(T.validateContract(contract({ type: "S", expiry: null }))).toEqual([]);
  });
  test("thiếu nhân viên, loại, ngày hiệu lực; ngày kết thúc trước ngày hiệu lực", () => {
    expect(codes(T.validateContract({ type: "F", expiry: "2027-01-01" }))).toEqual(["NO_EMPLOYEE", "NO_EFFECTIVE"]);
    expect(codes(T.validateContract(contract({ type: null })))).toEqual(["NO_TYPE"]);
    expect(codes(T.validateContract(contract({ expiry: "2026-12-31" })))).toEqual(["END_BEFORE_START"]);
  });
  test("thử việc và xác định thời hạn phải có ngày kết thúc; không xác định thời hạn thì không có", () => {
    expect(codes(T.validateContract(contract({ type: "P", expiry: null })))).toEqual(["NEED_EXPIRY"]);
    expect(codes(T.validateContract(contract({ type: "F", expiry: null })))).toEqual(["NEED_EXPIRY"]);
    expect(codes(T.validateContract(contract({ type: "U" })))).toEqual(["NO_EXPIRY_ALLOWED"]);
  });
  test("ngày sai định dạng hoặc không tồn tại, số tiền âm", () => {
    expect(codes(T.validateContract(contract({ effective: "01/01/2027" })))).toEqual(["BAD_DATE"]);
    expect(codes(T.validateContract(contract({ expiry: "2027-02-30" })))).toEqual(["BAD_DATE"]);
    expect(codes(T.validateContract(contract({ base_salary: -1 })))).toEqual(["NEGATIVE"]);
  });
  test("phụ lục: phải thuộc hợp đồng gốc và có hiệu lực trong thời hạn hợp đồng; không cần loại, ngày kết thúc", () => {
    const main = contract({ id: "1" });
    const app = { id: "2", employee: "7", parent: "1", effective: "2027-06-01" };
    expect(T.validateContract(app, main)).toEqual([]);
    expect(codes(T.validateContract(app, null))).toEqual(["APPENDIX_OF_APPENDIX"]);
    expect(codes(T.validateContract(app, contract({ id: "1", parent: "9" })))).toEqual(["APPENDIX_OF_APPENDIX"]);
    expect(codes(T.validateContract(Object.assign({}, app, { effective: "2028-01-01" }), main))).toEqual(["APPENDIX_OUTSIDE"]);
    expect(codes(T.validateContract(Object.assign({}, app, { effective: "2027-06-01" }), contract({ status: "T", terminated: "2027-05-31" })))).toEqual(["APPENDIX_OUTSIDE"]);
  });
  test("thông báo có cả tiếng Anh và tiếng Việt", () => {
    const m = T.validateContract(contract({ type: "P", expiry: null }))[0];
    expect(m.message).toMatch(/end date/);
    expect(m.messageVi).toMatch(/ngày kết thúc/);
  });
  test("chấm dứt: ngày phải trong thời hạn hợp đồng", () => {
    expect(T.validateTermination(contract({}), "2027-06-30")).toEqual([]);
    expect(codes(T.validateTermination(contract({}), "2026-12-31"))).toEqual(["TERMINATE_OUTSIDE"]);
    expect(codes(T.validateTermination(contract({}), "2028-01-01"))).toEqual(["TERMINATE_OUTSIDE"]);
    expect(codes(T.validateTermination(contract({}), ""))).toEqual(["BAD_DATE"]);
    expect(T.validateTermination(contract({ type: "U", expiry: null }), "2030-01-01")).toEqual([]);
  });
});

describe("quyết định", () => {
  const comps = [
    { id: "1", effective: "2026-01-01", base_salary: 20000000, insurance_wage: 10000000, allowance: 1000000, package: "5" },
    { id: "2", effective: "2027-01-01", base_salary: 22000000, insurance_wage: 11000000, allowance: 1000000, package: "5" },
  ];
  const decision = (o) => Object.assign({ id: "9", employee: "7", type: "S", effective: "2027-04-01", status: "D" }, o);

  test("compensationAt lấy dòng mới nhất có hiệu lực không sau ngày hỏi", () => {
    expect(T.compensationAt(comps, "2026-12-31").id).toBe("1");
    expect(T.compensationAt(comps, "2027-01-01").id).toBe("2");
    expect(T.compensationAt(comps, "2025-12-31")).toBeNull();
    expect(T.compensationAt(comps, null).id).toBe("2");
  });
  test("kiểm: điều chỉnh lương phải có mức mới; điều chuyển phải có thay đổi; số âm bị từ chối", () => {
    expect(codes(T.validateDecision(decision({})))).toEqual(["NO_SALARY"]);
    expect(T.validateDecision(decision({ new_salary: 25000000 }))).toEqual([]);
    expect(T.validateDecision(decision({ new_allowance: 0 }))).toEqual([]);
    expect(codes(T.validateDecision(decision({ type: "T" })))).toEqual(["NO_CHANGE"]);
    expect(T.validateDecision(decision({ type: "T", new_department: "3" }))).toEqual([]);
    expect(codes(T.validateDecision(decision({ new_salary: -5 })))).toContain("NEGATIVE");
    expect(codes(T.validateDecision({ type: "R" }))).toEqual(["NO_EMPLOYEE", "NO_EFFECTIVE"]);
    expect(T.validateDecision(decision({ type: "R" }))).toEqual([]);
  });
  test("điều chỉnh lương: dòng lương mới theo ngày hiệu lực, kế thừa phần không đổi từ dòng đang hiệu lực", () => {
    const eff = T.decisionEffects(decision({ new_salary: 25000000 }), { compensations: comps, profile: {} });
    expect(eff.errors).toEqual([]);
    expect(eff.compensation).toEqual({ effective: "2027-04-01", base_salary: 25000000, insurance_wage: 11000000, allowance: 1000000, package: "5" });
    expect(eff.profile).toEqual({});
    expect(eff.terminate).toBeNull();
  });
  test("chỉ đổi lương đóng bảo hiểm thì giữ lương hợp đồng; hiệu lực trong quá khứ kế thừa dòng tại ngày đó và cảnh báo có dòng sau", () => {
    const eff = T.decisionEffects(decision({ effective: "2026-07-01", new_ins_wage: 12000000 }), { compensations: comps });
    expect(eff.compensation).toMatchObject({ effective: "2026-07-01", base_salary: 20000000, insurance_wage: 12000000 });
    expect(codes(eff.warnings)).toEqual(["LATER_COMP"]);
  });
  test("chưa có lương để kế thừa và không nhập lương mới thì lỗi", () => {
    const eff = T.decisionEffects(decision({ new_allowance: 500000 }), { compensations: [] });
    expect(codes(eff.errors)).toEqual(["NO_BASE"]);
    expect(eff.compensation).toBeNull();
  });
  test("điều chuyển đổi phòng ban của hồ sơ; tiếp nhận đặt ngày vào làm khi còn trống; chấm dứt đặt ngày làm việc cuối", () => {
    expect(T.decisionEffects(decision({ type: "T", new_department: 3 }), {}).profile).toEqual({ department: "3" });
    expect(T.decisionEffects(decision({ type: "H", new_department: "3", new_salary: 10 }), { profile: { hire_date: null } }).profile).toEqual({ department: "3", hire_date: "2027-04-01" });
    expect(T.decisionEffects(decision({ type: "H", new_title: "NV" }), { profile: { hire_date: "2020-01-01" } }).profile).toEqual({});
    const x = T.decisionEffects(decision({ type: "X" }), {});
    expect(x.terminate).toBe("2027-04-01");
    expect(x.profile).toEqual({ termination_date: "2027-04-01" });
    expect(x.compensation).toBeNull();
  });
  test("khen thưởng, kỷ luật không đổi hồ sơ, không đổi lương kể cả khi có số tiền", () => {
    const eff = T.decisionEffects(decision({ type: "R", new_salary: 99 }), { compensations: comps });
    expect(eff.profile).toEqual({});
    expect(eff.compensation).toBeNull();
  });
  test("chức danh hiện tại: quyết định đã áp dụng mới nhất, không có thì chức danh trên hợp đồng (phụ lục mới hơn thay hợp đồng)", () => {
    const contracts = [contract({ id: "1", title: "Nhân viên" })];
    expect(T.currentTitle(contracts, [], TODAY)).toBe("Nhân viên");
    const ds = [decision({ id: "1", type: "P", status: "A", effective: "2027-02-01", new_title: "Trưởng nhóm" }), decision({ id: "2", type: "P", status: "D", effective: "2027-03-01", new_title: "Trưởng phòng" }), decision({ id: "3", type: "P", status: "A", effective: "2027-06-01", new_title: "Giám đốc" })];
    expect(T.currentTitle(contracts, ds, TODAY)).toBe("Trưởng nhóm");
    expect(T.currentTitle(contracts.concat([contract({ id: "2", parent: "1", type: null, effective: "2027-03-01", expiry: null, title: "Chuyên viên" })]), ds, TODAY)).toBe("Chuyên viên");
    expect(T.currentTitle([], [], TODAY)).toBe("");
  });
});

describe("timeline", () => {
  const input = {
    profile: { hire_date: "2026-11-01" },
    contracts: [
      contract({ id: "1", number: "TV01", type: "P", effective: "2026-11-01", expiry: "2026-12-31" }),
      contract({ id: "2", number: "HD02", effective: "2027-01-01", expiry: "2027-12-31", base_salary: 22000000 }),
      contract({ id: "3", number: "PL01", parent: "2", type: null, effective: "2027-03-01", expiry: null, base_salary: 24000000 }),
      contract({ id: "4", number: "HD03", status: "D", effective: "2028-01-01", expiry: "2028-12-31" }),
    ],
    decisions: [{ id: "1", number: "QD01", type: "S", status: "A", effective: "2027-03-01", old_salary: 22000000, new_salary: 24000000 }, { id: "2", number: "QD02", type: "R", status: "D", effective: "2027-02-10" }],
    compensations: [{ id: "1", effective: "2026-11-01", base_salary: 18000000 }, { id: "2", effective: "2027-01-01", base_salary: 22000000 }, { id: "3", effective: "2027-03-01", base_salary: 24000000 }],
    dependents: [{ id: "1", name: "Con", from: "2027-01-01", to: "2027-06-30" }],
    permits: [{ id: "1", name: "WP1", permit_no: "GP-9", status: "A", effective: "2026-11-01", expiry: "2027-10-31" }, { id: "2", name: "WP2", status: "D", effective: "2027-11-01", expiry: "2029-10-31" }],
  };
  const tl = T.timeline(input, TODAY);
  const kinds = (pred) => tl.filter(pred).map((e) => `${e.date} ${e.kind} ${e.ref || ""}`.trim());

  test("mới nhất trước, đủ các loại mốc", () => {
    for (let i = 1; i < tl.length; i++) expect(tl[i - 1].date >= tl[i].date).toBe(true);
    const set = new Set(tl.map((e) => e.kind));
    for (const k of ["hire", "contract", "appendix", "contractEnd", "decision", "salary", "dependent", "dependentEnd", "permit", "permitExpiry"]) expect(set.has(k)).toBe(true);
  });
  test("dòng lương trùng ngày với quyết định đã áp dụng có đổi lương không lặp lại; dòng lương kèm mức trước", () => {
    expect(kinds((e) => e.kind === "salary")).toEqual(["2027-01-01 salary", "2026-11-01 salary"]);
    expect(tl.find((e) => e.kind === "salary" && e.date === "2027-01-01")).toMatchObject({ amount: 22000000, previous: 18000000 });
    expect(tl.find((e) => e.kind === "decision" && e.ref === "QD01")).toMatchObject({ amount: 24000000, previous: 22000000, draft: false });
  });
  test("phụ lục mang loại và số của hợp đồng gốc; nháp và tương lai được đánh dấu; nháp không sinh mốc kết thúc", () => {
    expect(tl.find((e) => e.kind === "appendix")).toMatchObject({ ref: "PL01", parentRef: "HD02", code: "F", draft: false });
    expect(tl.find((e) => e.kind === "contract" && e.ref === "HD03")).toMatchObject({ draft: true, future: true });
    expect(kinds((e) => e.kind === "contractEnd")).toEqual(["2027-12-31 contractEnd HD02", "2026-12-31 contractEnd TV01"]);
    expect(tl.find((e) => e.kind === "decision" && e.ref === "QD02").draft).toBe(true);
  });
  test("giấy phép: giấy đang chuẩn bị là nháp và không có mốc hết hạn", () => {
    expect(kinds((e) => e.kind === "permitExpiry")).toEqual(["2027-10-31 permitExpiry GP-9"]);
    expect(tl.find((e) => e.kind === "permit" && e.ref === "WP2").draft).toBe(true);
  });
  test("hợp đồng chấm dứt sinh mốc chấm dứt thay cho mốc kết thúc; đầu vào rỗng không lỗi", () => {
    const t2 = T.timeline({ contracts: [contract({ status: "T", terminated: "2027-05-31", term_reason: "Thỏa thuận" })] }, TODAY);
    expect(t2.map((e) => e.kind)).toEqual(["contractTerminated", "contract"]);
    expect(T.timeline({}, TODAY)).toEqual([]);
    expect(T.timeline(null, TODAY)).toEqual([]);
  });
});

describe("due - việc sắp đến hạn", () => {
  test("hợp đồng hết hạn trong N ngày, N là tham số", () => {
    const list = [contract({ id: "1", number: "HD01", expiry: "2027-04-10" })];
    expect(T.due({ contracts: list }, TODAY, { days: 30 })).toEqual([{ kind: "contractExpiry", date: "2027-04-10", daysLeft: 26, overdue: false, id: "1", ref: "HD01", code: "F" }]);
    expect(T.due({ contracts: list }, TODAY, { days: 25 })).toEqual([]);
    expect(T.due({ contracts: list }, TODAY).length).toBe(1);
  });
  test("thử việc sắp hết là loại riêng", () => {
    expect(T.due({ contracts: [contract({ type: "P", expiry: "2027-03-20" })] }, TODAY, { days: 30 })[0]).toMatchObject({ kind: "probationEnd", daysLeft: 5 });
  });
  test("đã có hợp đồng nối tiếp thì không báo; nháp không tính là nối tiếp", () => {
    const old = contract({ id: "1", expiry: "2027-03-31" });
    expect(T.due({ contracts: [old, contract({ id: "2", effective: "2027-04-01", expiry: "2028-03-31" })] }, TODAY, { days: 30 })).toEqual([]);
    expect(T.due({ contracts: [old, contract({ id: "2", status: "D", effective: "2027-04-01", expiry: "2028-03-31" })] }, TODAY, { days: 30 }).length).toBe(1);
  });
  test("quá hạn mà chưa có hợp đồng mới vẫn báo (overdue); hợp đồng cũ đã được thay thì không", () => {
    const d = T.due({ contracts: [contract({ id: "1", expiry: "2027-03-01" })] }, TODAY, { days: 30 });
    expect(d[0]).toMatchObject({ overdue: true, daysLeft: -14 });
    const replaced = [contract({ id: "1", effective: "2026-01-01", expiry: "2026-12-31" }), contract({ id: "2", type: "U", effective: "2027-01-01", expiry: null })];
    expect(T.due({ contracts: replaced }, TODAY, { days: 30 })).toEqual([]);
  });
  test("bỏ qua hợp đồng không thời hạn, đã chấm dứt, nháp, phụ lục", () => {
    const list = [contract({ id: "1", type: "U", expiry: null }), contract({ id: "2", status: "T", terminated: "2027-03-10", expiry: "2027-03-20" }), contract({ id: "3", status: "D", expiry: "2027-03-20" }), contract({ id: "4", parent: "1", expiry: "2027-03-20" })];
    expect(T.due({ contracts: list }, TODAY, { days: 30 })).toEqual([]);
  });
  test("giấy phép lao động: số ngày nhắc riêng; giấy đã có bản gia hạn hiệu lực thì không báo; sắp theo ngày", () => {
    const permits = [{ id: "1", name: "WP1", permit_no: "GP1", status: "A", expiry: "2027-05-01" }];
    expect(T.due({ permits }, TODAY, { days: 30 })).toEqual([]);
    expect(T.due({ permits }, TODAY, { days: 30, permitDays: 60 })[0]).toMatchObject({ kind: "permitExpiry", ref: "GP1", daysLeft: 47 });
    expect(T.due({ permits: permits.concat([{ id: "2", status: "A", expiry: "2029-05-01" }]) }, TODAY, { days: 30, permitDays: 60 })).toEqual([]);
    const both = T.due({ contracts: [contract({ expiry: "2027-04-10" })], permits: [{ id: "1", status: "E", expiry: "2027-03-01" }] }, TODAY, { days: 30 });
    expect(both.map((x) => x.kind)).toEqual(["permitExpiry", "contractExpiry"]);
  });
});
