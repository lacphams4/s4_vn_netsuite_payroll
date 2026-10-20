// File chi lương ngân hàng (đặc tả 4.6.7, ca GL-06).
const { core } = require("./helpers");
const Bank = core("BankFileWriter");

describe("BankFileWriter", () => {
  const employees = [
    { code: "E002", name: "Trần Thị B", bankAccount: " 0123456789 ", bankName: "Vietcombank", netPay: 12248000 },
    { code: "E001", name: 'Nguyễn "Văn" A', bankAccount: "9988", bankName: "ACB", netPay: 27467500 },
    { code: "E003", name: "Lê C", bankAccount: "", bankName: "", netPay: 0 },
    { code: "C001", name: "Phạm D", bankAccount: "777", bankName: "BIDV", netPay: 14112000 },
  ];

  test("GL-06 chỉ thực lĩnh > 0, sắp theo mã, BOM, ngoặc kép, nội dung Lương MM/yyyy", () => {
    const f = Bank.write({ batchNbr: "BL000001", periodId: "202610", taxMonth: "202610" }, employees);
    expect(f.fileName).toBe("ChiLuong_BL000001_202610.csv");
    expect(f.content.charCodeAt(0)).toBe(0xfeff);
    const lines = f.content.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe('"STT","Ma NV","Ho ten","So tai khoan","Ngan hang","So tien","Noi dung"');
    expect(lines[1]).toBe('"1","C001","Phạm D","777","BIDV","14112000","Lương 10/2026 Phạm D"');
    expect(lines[2]).toBe('"2","E001","Nguyễn ""Văn"" A","9988","ACB","27467500","Lương 10/2026 Nguyễn ""Văn"" A"');
    expect(lines[3]).toContain('"0123456789"');
    expect(lines).toHaveLength(4);
    expect(f.count).toBe(3);
    expect(f.total).toBe(14112000 + 27467500 + 12248000);
  });

  test("tiếng Anh và tháng lấy từ mã kỳ khi không có tháng tính thuế", () => {
    const f = Bank.write({ batchNbr: "BL2", periodId: "TD-2026W41" }, [employees[0]], { lang: "en" });
    expect(f.content).toContain('"Salary TD-2026W41 Trần Thị B"');
  });

  test("thiếu số tài khoản -> dừng, liệt kê mã", () => {
    const list = employees.concat([{ code: "E009", name: "X", bankAccount: "  ", netPay: 1 }]);
    expect(() => Bank.write({ batchNbr: "B", periodId: "202610" }, list)).toThrow(/E009/);
  });
});
