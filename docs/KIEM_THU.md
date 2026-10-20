# Báo cáo kiểm thử S4 VN Payroll cho NetSuite

Cập nhật 21/10/2026. Hai lớp kiểm thử: (1) unit test lõi trên Node theo bộ ca vàng của đặc tả, (2) kiểm thử tích hợp trên account td2937310, subsidiary 13 "S4VN TT99 Test", dữ liệu giả lập "S4VP TEST".

## 1. Unit test lõi

Chạy: `npm test`. Kết quả: **825 / 825 đạt**, 27 bộ, không có `test.todo`.

| Bộ test | Số test | Ca vàng của đặc tả |
| --- | --- | --- |
| insurance | 26 | BH-01 đến BH-15 (2.13.1) |
| pit | 40 | TN-01 đến TN-13, FL-01 đến FL-04 (2.13.2, 2.13.3) |
| overtime | 22 | OT-01 đến OT-10 (2.13.4) |
| paycheck | 26 | KB-01 đến KB-16, UAT-1 đến UAT-5, FL-05/06, bất biến 200 nhân viên ngẫu nhiên (2.13.5, 2.5.2) |
| taxmonth | 9 | TM-01 đến TM-08 (2.13.6) |
| advance, extras, words | 30 | TU-01 đến TU-06, HD-01/02 phần tiền, đọc số bằng chữ (2.13.7, 4.8.5) |
| periods | 10 | KY-01 đến KY-04, NL-01 |
| attendance, shift, leave, timesheet, workpermit | 93 | 40 ca của 3.10, kịch bản chấm công 100 người 3 ca 4 kíp, hiệu năng 2.000 người x 31 ngày dưới 10 giây |
| earningrules | 463 | TC-ER-01 (432 tổ hợp so công thức V2), TC-ER-02 đến 05, TC-QT, TC-DK-01 đến 04, thang hoa hồng 4.8.2, TC-HH-02, TC-GN-02, kiểm tra gói ngành |
| teamsplit, allocation | 34 | TC-TS-01 đến 04, TC-PB, SIT-V2-01/02, AP-07, AP-12 đến AP-18, PA03 đến PA07 |
| journal, bankfile | 12 | GL-01, GL-02, GL-05, GL-06 ở mức lõi |
| reports, reportdata | 19 | TC34, TC36, không cư trú, S4-TC47 D02-LT và tăng lại |
| engine | 6 | Nối toàn bộ pipeline 4.2.9: KB-15, FL-05, TC-ER-03, HD-02, UAT-1, TM-03 |
| attendancedocs, print, foundation | 24 | Quy tắc chứng từ công, mô hình bản in, làm tròn, ngày, tham số |
| outputrules, planrecords | 11 | TC-TS-01 phiếu tổ trên dữ liệu record, SIT-V2-01, AP-16, AP-07, ca 37/38 giấy phép lao động |

Giả định ghi nhận khi port (chi tiết trong docs/DOI_CHIEU_DAC_TA.md mục 3):

- UAT gói phúc lợi: đặc tả chỉ ghi cách tính thuế của PL01, PL07 - PL10; từ số liệu UAT-2 suy ra PL02 - PL06 miễn thuế toàn bộ (E). Số tính thuế TC34 khớp với cách hiểu này.
- Thuế phương pháp X: thu nhập tính thuế ghi 0.

## 2. Kiểm thử tích hợp trên td2937310

Dữ liệu thử do chức năng "Tạo dữ liệu test" (VP509000) tạo: nhân viên ID 2682 - 2686 (mã E012 - E016, họ "S4VP TEST"), nhà cung cấp cơ quan thu 2679 - 2681. Tài khoản: 334 = 3341, 3335, 141 = 1411, chi phí 6421, phải trả CTV và khấu trừ khác 33881, trích trước 3351, 338x theo khoản; địa điểm mặc định 23.

| Nhân viên | Kịch bản | Ca vàng |
| --- | --- | --- |
| E012 NV01 Văn phòng | Lương 30tr, 1 NPT, tạm ứng 5tr, trích tháng 13 | TN-01, KB-10 |
| E013 NV02 Công nhân | Vùng II, 10,4tr, OT ba loại nhập tay, phụ cấp 1tr | KB-15 |
| E014 CTV03 | CTV theo giờ 80 x 196.000, khấu trừ 10% | FL-05 |
| E015 NV04 Nước ngoài | 60tr, không BHTN | BH-15 |
| E016 NV05 Thử việc | Vào làm 15/10, lương 85%, khấu trừ 10% | HD-01, FL-02 |

### 2.1 Kỳ 10/2026 (BL000001, BL000002, BL000003)

Kết quả tính trên NetSuite khớp từng đồng với số tính tay theo ca vàng:

| Mã | Gross | BH NLĐ | BH DN | Thuế | Cấn trừ | Thực lĩnh |
| --- | --- | --- | --- | --- | --- | --- |
| E012 | 30.000.000 | 3.150.000 | 7.050.000 | 257.500 | 5.000.000 | 21.592.500 |
| E013 | 13.340.000 (miễn 940.000) | 1.092.000 | 2.444.000 | 0 | 0 | 12.248.000 |
| E014 | 15.680.000 | 0 | 0 | 1.568.000 | 0 | 14.112.000 |
| E015 | 60.000.000 | 4.807.000 | 11.385.000 | 4.438.600 | 0 | 50.754.400 |
| E016 | 6.954.545 (12/22 công) | 0 | 0 | 695.455 | 0 | 6.259.090 |
| Tổng | 125.974.545 | 9.049.000 | 20.879.000 | 6.959.555 | 5.000.000 | 104.965.990 |

Luồng đã chạy: tạo, nạp nhân viên, nhập tay, tính (9 giây cho 5 người), chặn ghi sổ khi tạm giữ, duyệt, chặn sửa dòng nhập khi đã duyệt, ghi sổ (JE, tạm ứng TU000001 tất toán), đảo (JE đảo, tạm ứng hoàn số dư), lập lại bảng lương cùng kỳ (bảng đã đảo không chặn trùng nhân viên), bill cơ quan thu (BHXH 28.108.000, KPCĐ 1.820.000, thuế 6.959.555), chặn lập bill lần hai, chặn đảo khi còn bill, file chi lương ngân hàng, ba bản in PDF.

### 2.2 Kỳ 11/2026 (BL000004, thao tác hoàn toàn trên SPA)

Tạo bảng, nạp nhân viên (công chuẩn 21), thêm dòng thù lao CTV 21 giờ qua form, tính, bỏ tạm giữ, duyệt, ghi sổ. Thù lao CTV 4.116.000 dưới ngưỡng 5.000.000 từ 01/07/2026 nên không khấu trừ thuế (FL-02).

### 2.3 Kỳ 12/2026 (BL000005, từ chứng từ công)

Cấp phép năm 2026 (CTV bị loại, có thông báo), đơn nghỉ phép E012 07-09/12 (3 ngày), đơn OT E013 thứ Bảy 05/12 4 giờ, phiếu đi trễ E013 20 phút (trừ 0,25), nghỉ không lương E015 14-18/12 (5 ngày), E016 nghỉ việc 31/12; lập và khóa bảng công; nạp, tính:

| Mã | Công | Kết quả |
| --- | --- | --- |
| E012 | 23/23, phép 3 | Gross 30.000.000; phép năm còn 9 |
| E013 | 22,75/23 | Lương 10.286.957, OT200 4 giờ 452.174 (miễn 226.087), cấn trừ tạm ứng TU000002 1.000.000 |
| E015 | 18/23, nghỉ 5 ngày (< 14 vẫn đóng BH) | Gross 46.956.522, BH NLĐ 4.807.000, thuế 2.164.952 |
| E016 | 23/23, nghỉ việc trong kỳ | Lương 12.750.000 + trả 12 ngày phép 6.652.174; thuế 10% 1.940.217 |

### 2.4 Kỳ 01/2027 (BL000006, khoán tổ, giấy phép lao động)

Nạp gói ngành Xây dựng (loại thu nhập PCCT, PCXANHA, KHOAN; nhóm lương XD-VP, XD-CT, XDKHOAN; bảng đơn giá KHOAN-XD; quy tắc XD-SITE không hoạt động, XD-KHOAN hoạt động). Bảng đơn giá: bê tông 850.000 / m3, tường 125.000 / m2. Phiếu tổ SL000001 tổ nề: 12,5 m3 + 48 m2 = 16.625.000, chia ngày công x hệ số (E012 6 x 1,2; E013 6; E015 5) = **6.576.923 / 5.480.769 / 4.567.308** đúng TC-TS-01; gửi duyệt, duyệt. Giấy phép lao động WP000001 của E015 hết hạn 15/02/2027.

Bảng lương 01/2027: công chuẩn 20 (đã loại ngày lễ 01/01/2027 trong lịch mặc định); mỗi người trong tổ có dòng KHOAN đúng phần chia; E015 có cảnh báo "Giấy phép lao động WP000001 hết hạn ngày 15/02/2027 (còn 15 ngày sau cuối kỳ)"; E016 đã nghỉ việc 31/12/2026 không được nạp; thuế E012 672.692 (khớp tính tay).

### 2.5 Báo cáo

BH tháng 12/2026: 3 người, tổng 28.108.000, chênh lệch C12 tính đúng; D02-LT tháng 12 không có biến động (khớp tháng 11). 05/KK-TNCN quý 4/2026: [16] = 5, [17] = 3, [21] = 349.172.285 (bảng lương đã đảo bị loại). Quyết toán năm 2026: E012, E013, E015 vào 05-1/BK; E014, E016 vào 05-2/BK.

## 3. Lỗi phát hiện và đã sửa khi kiểm thử trên account

| # | Hiện tượng | Nguyên nhân | Sửa |
| --- | --- | --- | --- |
| 1 | Tính lương báo lỗi cú pháp SuiteQL | Alias cột trùng từ khóa (from, to) | Alias có tiền tố c_ |
| 2 | Vendor Bill không lưu "Vui lòng nhập Vị trí" | Account bắt buộc Location | Thiết lập "Địa điểm mặc định cho chứng từ" (công ty / chung) |
| 3 | JE tạo ra ở trạng thái chờ duyệt | Account bật duyệt bút toán; JE dùng cờ approved, bill dùng approvalstatus | Thiết lập "Tự duyệt bút toán, bill do phân hệ lương tạo" (mặc định bật), đặt đúng trường theo loại |
| 4 | Ngày "đến" của đơn nghỉ lệch +1 | record.submitFields quy đổi Date theo múi giờ máy chủ | Store.submit truyền ngày dạng chuỗi theo định dạng người dùng |
| 5 | SPA: form nhập tay lưu sai số lượng | Hai ô cập nhật liền nhau, ô sau ghi đè trạng thái cũ | Giữ giá trị form trong useRef |
| 6 | SPA: lưới bị bóp, thông báo tràn ngang | StackPanel co phần tử | shrink 0, flexShrink 0, thông báo dài xuống dòng riêng |
| 7 | Bảng thanh toán: tiêu đề giãn chữ, số xuống dòng | BFO dàn đều chữ trong ô tiêu đề; cột hẹp | Bọc tiêu đề trong p align center, cỡ chữ 6pt, chỉnh độ rộng cột |
| 8 | Deploy lỗi BEGIN_DEPLOYMENT khi thêm record | Role và record tham chiếu vòng | tools/deploy_two_pass.py |

## 4. Giao dịch thử còn chờ duyệt trên account

Tạo trước khi sửa lỗi #3, vẫn chờ duyệt (chưa vào sổ cái); anh quyết định duyệt hoặc xóa:

- JE tạm ứng TU000001: JE1801 (ID 51715).
- BL000001: ghi sổ JE1802 (51716), đảo ID 51717. BL000002: ghi sổ ID 51718, đảo ID 51719. Hai cặp này triệt tiêu nhau.
- BL000003: JE1806 (51720); bill cơ quan thu 51721, 51722, 51723 (số hóa đơn NCC BL000003).
- BL000004: JE1807 (51724).

Đã ghi sổ (sau khi sửa): JE1808 (51725) tạm ứng TU000002.

Bảng lương đang tạm giữ để anh thử thao tác: BL000005 (12/2026), BL000006 (01/2027).
