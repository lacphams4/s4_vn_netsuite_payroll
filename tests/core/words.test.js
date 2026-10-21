// 4.8.5 Đọc số bằng chữ (VietnameseNumberReader)
const { core } = require("./helpers");
const W = core("VietnameseNumberReader");

describe("4.7.6 Đọc số tiền bằng chữ", () => {
	test.each([
		[0, "Không đồng"],
		[5, "Năm đồng"],
		[15, "Mười lăm đồng"],
		[21, "Hai mươi mốt đồng"],
		[105, "Một trăm linh năm đồng"],
		[1005, "Một nghìn không trăm linh năm đồng"],
		[1000021, "Một triệu không trăm hai mươi mốt đồng"],
		[10000000, "Mười triệu đồng"],
		[48715200, "Bốn mươi tám triệu bảy trăm mười lăm nghìn hai trăm đồng"],
		[66575655, "Sáu mươi sáu triệu năm trăm bảy mươi lăm nghìn sáu trăm năm mươi lăm đồng"],
		[2000000000, "Hai tỷ đồng"],
		[1000000000000, "Một nghìn tỷ đồng"],
		[1250000000000, "Một nghìn hai trăm năm mươi tỷ đồng"],
	])("%d", (n, s) => expect(W.readAmount(n)).toBe(s));

	test("số âm và làm tròn", () => {
		expect(W.readAmount(-24)).toBe("Âm hai mươi bốn đồng");
		expect(W.readAmount(14.5)).toBe("Mười lăm đồng");
	});
});
