// Báo cáo, tờ khai (đặc tả 4.7, ca 4.8.5): 05/KK-TNCN, quyết toán năm, BH phải nộp, D02-LT.
const { core } = require("./helpers");
const R = core("PayrollReports");

const row = (code, taxMonth, taxable, pit, extra) => Object.assign({ employee: code, employeeCode: code, taxMonth, pitMethod: "P", employmentType: "E", taxableIncome: taxable, pit }, extra);

describe("05/KK-TNCN 4.7.4", () => {
  test("TC34 quý 1/2025", () => {
    const rows = [];
    for (const tm of ["202502", "202503"]) {
      rows.push(row("E001", tm, 7920000, 0), row("E002", tm, 22420000, 39545), row("E003", tm, 22420000, 0));
    }
    rows.push(row("E007", "202502", 0, 0, { pitMethod: "F", employmentType: "C" }), row("E007", "202503", 15680000, 1568000, { pitMethod: "F", employmentType: "C" }));
    rows.push(row("E001", "202504", 7920000, 0));
    const { indicators: i, people } = R.pitQuarterly(rows, 2025, 1);
    expect([i[16], i[17], i[18], i[21], i[26], i[29]]).toEqual([4, 3, 2, 121200000, 60520000, 1647090]);
    expect(Object.keys(i)).toHaveLength(17);
    expect([i[24], i[25], i[32]]).toEqual([0, 0, 0]);
    expect(people.map((p) => [p.employeeCode, p.schedule])).toEqual([["E001", "05-1/BK"], ["E002", "05-1/BK"], ["E003", "05-1/BK"], ["E007", "05-2/BK"]]);
  });

  test("TC36", () => {
    const rows = [row("E001", "202504", 7920000, 0), row("E002", "202504", 12420000, 0), row("E003", "202504", 12420000, 0), row("E007", "202504", 4116000, 411600, { pitMethod: "F", employmentType: "C" })];
    const { indicators: i } = R.pitQuarterly(rows, 2025, 2);
    expect([i[18], i[29]]).toEqual([1, 411600]);
  });

  test("không cư trú hai kỳ", () => {
    const rows = [row("F01", "202502", 50000000, 10000000, { pitMethod: "N" }), row("F01", "202503", 50000000, 10000000, { pitMethod: "N" })];
    const { indicators: i } = R.pitQuarterly(rows, 2025, 1);
    expect([i[16], i[17], i[20], i[23], i[28], i[31]]).toEqual([1, 0, 1, 100000000, 100000000, 20000000]);
  });

  test("quý của kỳ", () => {
    expect([R.quarterOf("202502"), R.quarterOf("202504"), R.quarterOf("202512")]).toEqual([1, 2, 4]);
    expect(R.taxMonthOf({ taxMonth: "", periodId: "202603" })).toBe("202603");
  });
});

describe("Quyết toán năm 4.7.5", () => {
  test("gộp theo người, bảng kê, thu nhập thuộc diện khấu trừ, NPT lớn nhất", () => {
    const rows = [
      row("E002", "202501", 22420000, 39545, { dependentCount: 1, familyDeduction: 15400000, employeeCompulsoryInsurance: 1829100, assessableIncome: 790900, taxCode: "8001", idNumber: "001090000001" }),
      row("E002", "202502", 22420000, 0, { dependentCount: 2, familyDeduction: 19800000, employeeCompulsoryInsurance: 1829100, assessableIncome: 0 }),
      row("E007", "202503", 15680000, 1568000, { pitMethod: "F", employmentType: "C" }),
      row("E009", "202503", 0, 0),
      row("E002", "202601", 1, 1),
    ];
    const res = R.pitAnnual(rows, 2025);
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({
      employeeCode: "E002", schedule: "05-1/BK", resident: true, periods: 2, taxableIncome: 44840000, withholdingIncome: 22420000, dependentCount: 2,
      familyDeduction: 35200000, insurance: 3658200, assessableIncome: 790900, pit: 39545, taxCode: "8001", idNumber: "001090000001",
    });
    expect(R.pitAnnual(rows, 2025, "05-2/BK").map((r) => r.employeeCode)).toEqual(["E007"]);
  });
});

describe("BH phải nộp 4.7.2", () => {
  test("cột theo quỹ và chênh lệch C12", () => {
    const ins = [
      { code: "BHXH_HT", wageBase: 30000000, employeeAmount: 2400000, employerAmount: 4200000 }, { code: "BHXH_OD", wageBase: 30000000, employeeAmount: 0, employerAmount: 900000 },
      { code: "BHTNLD", wageBase: 30000000, employeeAmount: 0, employerAmount: 150000 }, { code: "BHYT", wageBase: 30000000, employeeAmount: 450000, employerAmount: 900000 },
      { code: "BHTN", wageBase: 30000000, employeeAmount: 300000, employerAmount: 300000 }, { code: "KPCD", wageBase: 30000000, employeeAmount: 0, employerAmount: 600000 },
    ];
    const lines = R.insuranceByEmployee([{ employee: "E001", employeeCode: "E001", socialInsuranceNbr: "79", insurance: ins }, { employee: "E002", insurance: [] }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ insuranceWage: 30000000, eeSocial: 2400000, eeHealth: 450000, eeUnemployment: 300000, eeTotal: 3150000, erSocial: 5100000, erAccident: 150000, erHealth: 900000, erUnemployment: 300000, erTotal: 6450000, erUnionFund: 600000, total: 9600000 });
    expect(R.c12Difference(lines, 9500000)).toBe(100000);
  });
});

describe("D02-LT 4.7.3", () => {
  const rec = (employee, wage, contributed, extra) => Object.assign({ employee, employeeCode: employee, eligible: true, contributed, insuranceWage: wage }, extra);
  const sep = [rec("E003", 20000000, true), rec("T104", 12000000, true), rec("T105", 25000000, true), rec("T106", 12000000, true), rec("T101", 10000000, true)];
  const oct = [
    rec("E003", 20000000, true), rec("T101", 10000000, true),
    rec("T103", 15000000, false, { eligible: false, hireDate: "2026-10-15" }),
    rec("T104", 12000000, false),
    rec("T105", 25000000, true, { terminationDate: "2026-10-20" }),
    rec("T106", 14000000, true, { wageEffectiveDate: "2026-09-01" }),
    rec("T107", 6000000, true),
  ];

  test("S4-TC47 tháng 10/2026: đúng 4 dòng", () => {
    const res = R.d02(oct, sep, "202610");
    expect(res.map((r) => [r.employee, r.code, r.fromMonth, r.toMonth, r.oldWage, r.newWage])).toEqual([
      ["T104", "KL", "10/2026", "10/2026", 12000000, null],
      ["T105", "GH", "11/2026", "", 25000000, null],
      ["T106", "DC", "09/2026", "", 12000000, 14000000],
      ["T107", "TM", "10/2026", "", null, 6000000],
    ]);
  });

  test("tháng 11: T104 tăng lại ON, T103 tăng mới TM", () => {
    const nov = [rec("T104", 12000000, true), rec("T103", 15000000, true, { hireDate: "2026-10-15" })];
    expect(R.d02(nov, oct, "202611").map((r) => [r.employee, r.code])).toEqual([["T104", "ON"], ["T103", "TM"]]);
  });

  test("tháng trước chưa có bảng lương: chỉ người vào làm trong tháng là TM", () => {
    const res = R.d02([rec("E003", 20000000, true, { hireDate: "2020-01-01" }), rec("T108", 8000000, true, { hireDate: "2026-10-01" })], null, "202610");
    expect(res.map((r) => [r.employee, r.code])).toEqual([["T108", "TM"]]);
  });

  test("monthRecords gộp kỳ trong tháng", () => {
    const recs = R.monthRecords([
      { employee: "T1", insuranceWage: 8000000, insurance: [{ code: "BHXH_HT", employeeAmount: 0 }] },
      { employee: "T1", insuranceWage: 8000000, insurance: [{ code: "BHXH_HT", employeeAmount: 640000 }] },
      { employee: "C1", employmentType: "C", insuranceWage: 0, insurance: [] },
    ], { T1: { insuranceApplicable: true, hireDate: "2026-01-05" } });
    expect(recs[0]).toMatchObject({ employee: "T1", eligible: true, contributed: true, insuranceWage: 8000000, hireDate: "2026-01-05" });
    expect(recs[1]).toMatchObject({ employee: "C1", eligible: false, contributed: false });
  });
});
