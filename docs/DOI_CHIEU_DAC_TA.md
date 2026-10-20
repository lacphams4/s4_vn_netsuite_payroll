# Đối chiếu đặc tả chuyển giao S4 eSuite Payroll (Acumatica -> NetSuite)

Nguồn: "Đặc tả chuyển giao S4 eSuite Payroll - từ Acumatica sang Oracle NetSuite", phiên bản 20/10/2026 (S4VNPayroll, Acumatica 26.200.0334, commit 8ed155f). Cập nhật 21/10/2026.

Phân loại: **Xong** (có trên NetSuite và đã chạy thử trên account), **Lõi xong** (công thức đã port và đạt ca vàng, chưa có màn hình / record), **Một phần**, **Chưa làm**.

## 1. Màn hình (đặc tả 1.1)

| Mã | Tên | Trạng thái | Trên NetSuite |
| --- | --- | --- | --- |
| VP101000 | Thiết lập lương VN | Xong | Record S4VP Thiết lập lương VN; SPA > Thiết lập: Nạp mặc định VN. Tab quy tắc trừ công, ký hiệu: record riêng. Approval Map: chưa (duyệt một cấp) |
| VP101010 | Tham số pháp lý | Xong | Ba record tham số, biểu thuế, khoản trích + ngày lễ; cờ đã đối chiếu |
| VP101020 | Thiết lập lương theo công ty | Xong | Theo subsidiary, ô trống kế thừa; thêm người ký, địa điểm mặc định. Load Industry Pack: API `loadIndustryPack` (đã chạy gói Xây dựng), chưa có nút trên SPA; ca, mẫu xoay ca của gói Sản xuất bỏ qua vì chưa có record ca |
| VP101030 | Nhóm lương | Xong | Record + Sinh kỳ lương (tháng / nửa tháng / tuần) |
| VP102000 | Loại thu nhập | Xong | |
| VP102010 | Loại nghỉ, chính sách phép | Xong | |
| VP102020 | Gói phúc lợi | Xong | Record cha / con |
| VP102030 | Quy tắc thu nhập | Xong | Record + điều kiện; bộ máy quy tắc đầy đủ 4.2 (463 test) |
| VP102040 | Bảng đơn giá | Xong | Record bảng + dòng theo ngày hiệu lực, dự án; thang hoa hồng cho quy tắc nguồn T. Màn hình: danh sách NetSuite |
| VP102050, VP102060 | Ca, mẫu xoay ca | Lõi xong | ShiftMatcher, ShiftPattern; chưa có record |
| VP102070 | Work center | Ánh xạ | Dùng Class của NetSuite |
| VP102080 | Tài khoản lương theo dự án | Chưa làm | Lõi CostAllocationBuilder đã hỗ trợ ưu tiên tài khoản dự án |
| VP201000 | Kỳ lương | Xong | Sinh kỳ, đóng kỳ, khóa / mở khóa công |
| VP203000 | Hồ sơ lương nhân viên | Xong | Hồ sơ + lịch sử lương + người phụ thuộc; danh sách trên SPA |
| VP204000 | Giấy phép lao động | Xong (API) | Lập, nộp, cấp, thu hồi, gia hạn theo chuỗi, cập nhật hết hạn; cảnh báo / chặn khi tính lương (đã chạy). Chưa có màn hình SPA riêng |
| VP205000 | Bảng tỷ lệ phân bổ dự án | Xong (API) | Phiên bản nháp, kích hoạt (thay thế bản cũ), khóa khi đã dùng; đưa vào phân bổ khi tính lương. Chưa có màn hình SPA riêng |
| VP206000 | Số dư phép | Xong | Sổ phép, giao dịch phép, điều chỉnh; SPA > Chấm công và phép |
| VP207000 | Tổ đội | Xong | Record tổ + thành viên theo hiệu lực |
| VP303000 - VP306000 | Đơn nghỉ, OT, công tác, ngoại lệ | Xong | Luồng H -> P -> A / R, C; khóa theo kỳ công; giữ chỗ / dùng / hoàn phép; công tác sinh phiếu tạm ứng |
| VP307000 | Bảng tổng hợp công | Xong | Lập (mô hình ngoại lệ), khóa, mở khóa; nguồn bảng công ký hiệu: chưa |
| VP308000 | Phiếu sản lượng | Xong (API) | Phiếu cá nhân / tổ, tra đơn giá, nạp thành viên, chia tổ, duyệt, khóa khi ghi sổ, mở khi đảo; vào bảng lương qua quy tắc nguồn O / S (đã chạy TC-TS-01). Chưa có màn hình SPA riêng |
| VP309000, VP310000, VP502000 | Phân ca, lượt chấm, xử lý chấm công | Lõi xong | Kịch bản 100 người, hiệu năng 2.000 x 31 ngày đạt |
| VP311000 | Bảng công ký hiệu | Lõi xong | AttendanceSheetCalculator |
| VP312000 | Giờ công tính lương | Lõi xong | TimesheetSync, TimeImport; chưa nối Time Bill NetSuite |
| VP501000 | Cấp phép năm | Xong | Cấp, chuyển phép, hết hạn; bỏ CTV |
| VP301000 | Tạm ứng lương | Xong | Ghi sổ Nợ 141 / Có tiền; cấn trừ FIFO; hoàn khi đảo |
| VP302000 | Bảng lương | Xong | Nạp nhân viên, tính, duyệt, ghi sổ, đảo, bill cơ quan thu, file ngân hàng, in; Map/Reduce cho bảng lớn |
| VP402000 | Bảng BH phải nộp, D02-LT | Xong | SPA > Báo cáo, xuất CSV |
| VP403000 | 05/KK-TNCN | Xong | Chỉ tiêu [16] - [32] + danh sách cá nhân |
| VP404000 | Quyết toán TNCN năm | Xong | 05-1/BK, 05-2/BK |
| VP405000 | Chi phí nhân sự theo tài khoản | Xong | So với dòng JE của bảng lương |
| VP409000 - VP409110 | GI, dashboard | Chưa làm | Có danh sách trên SPA; saved search / dashboard: giai đoạn sau |
| VP641000 | Phiếu lương | Xong | PDF, song ngữ chọn được |
| VP601000, VP641100 | Phiếu lương của tôi, in phiếu lương của tôi | Xong | Suitelet tự phục vụ: chỉ bảng đã ghi sổ của chính người đăng nhập, lọc năm theo tháng tính thuế (sửa điểm 6.1 #8); chưa thử với tài khoản Employee Center |
| VP602000 - VP603030 | Công, phép và đơn của tôi; mobile | Chưa làm | |
| VP642000 | Bảng chấm công tháng (in) | Chưa làm | Dữ liệu có trên SPA |
| VP643000 | Bảng thanh toán tiền lương | Xong | PDF A4 ngang |
| VP644000 | Quyết toán CTV | Xong | PDF |
| VP645000, VP646000 | Chia lương tổ, hoa hồng (in) | Chưa làm | |
| VP509000 | Tạo dữ liệu test | Xong | Chỉ Administrator, loại khỏi bản production |

## 2. Quy tắc nghiệp vụ trọng yếu (đặc tả 1.6, 2, 4.6)

| Quy tắc | Trạng thái |
| --- | --- |
| Làm tròn Money.Round, vị trí làm tròn (2.1) | Xong, decimal.js |
| Tham số theo ngày hiệu lực, không trộn bộ biểu thuế (2.2.1) | Xong |
| Thứ tự tính thu nhập -> miễn thuế -> BH -> thuế -> khấu trừ -> tạm ứng (1.6.5 #3) | Xong |
| Kiểm tra lương tối thiểu vùng chạy trước ngưỡng 14 ngày (2.3.2) | Xong |
| Gộp tháng tính thuế kỳ tuần / nửa tháng, CTV xét từng lần chi (2.7) | Xong |
| Ngày ngoài hợp đồng tính vào nghỉ không lương và ngưỡng 14 ngày (1.6.1 #5) | Xong |
| CTV không cấp phép năm, không vào bảng công trừ tổ / bảng công ký hiệu (BUG-50, 51, 54) | Xong (tổ chưa có dữ liệu trên NetSuite) |
| Một nhân viên chỉ ở một bảng lương chưa đảo của cùng kỳ (1.6.1 #4) | Xong |
| Sửa dữ liệu sau khi tính làm mất cờ đã tính (4.6.9) | Xong (dấu dữ liệu đầu vào kiểm khi duyệt, ghi sổ; User Event dòng nhập tay) |
| Tổng phân bổ = gross + BH DN khi ghi sổ (1.6.2 #4) | Xong |
| Đảo bị chặn khi còn bill cơ quan thu; bill chỉ một lần (1.6.3 #5) | Xong |
| Khóa công chặn chứng từ nguồn; mở khóa bị chặn khi có bảng đã ghi sổ (BUG-18) | Xong |
| Tên dữ liệu mặc định theo ngôn ngữ người chạy (BUG-48) | Xong |
| Phân quyền: HR không ghi sổ, không đảo, không lập bill (1.4.1) | Xong (role + kiểm tra phía máy chủ) |
| Phân quyền dữ liệu theo công ty, "quản trị IT không xem lương" | Chưa làm (đặc tả 1.4.1 cũng ghi chưa làm) |

## 3. Khác biệt đã chấp nhận giữa hai nền tảng (đặc tả 6.3)

| # | Khác biệt | Lý do | Bảo đảm kết quả |
| --- | --- | --- | --- |
| 1 | Chi tiết dòng thu nhập, BH theo khoản, phân bổ, cấn trừ lưu JSON trên dòng nhân viên, không phải record riêng | Giới hạn số record và governance (đặc tả 5.4) | Số tổng dùng cho báo cáo là trường riêng; JSON giữ đủ trường để in và ghi sổ |
| 2 | Tính lại xóa và sinh lại dòng hệ thống thay vì cập nhật tại chỗ | Cho phép theo 4.2.9 | Kết quả giống |
| 3 | Branch -> Location, tiểu khoản -> Department, work center -> Class, dự án -> entity của dòng JE; chưa có cost code, task | NetSuite không có khái niệm Branch, cost code tương đương | Lõi giữ đủ trường; lớp ghi chọn trường NetSuite |
| 4 | Ghi sổ không có giao dịch nhiều record | NetSuite | Kiểm tra trước, lưu id JE trước khi cập nhật tạm ứng, không tạo JE thứ hai |
| 5 | JE và bill tự duyệt theo thiết lập (tương đương AutoReleaseGL); account bật duyệt thì tắt được | Duyệt bút toán của NetSuite | |
| 6 | Duyệt bảng lương một cấp (RequirePayrollApproval); chưa có Approval Map nhiều bước | SuiteFlow để giai đoạn sau | Trạng thái giữ nguyên mã H/B/C/P/A/J/R/V |
| 7 | Giờ OT lấy từ đơn OT đã duyệt; giờ timesheet (nguồn OT = T) và VP312000 chưa nối Time Bill | Cần xác minh feature Timesheets trên account khách | Lõi TimeImport, TimesheetSync đã đạt ca vàng |
| 8 | Nhãn record, list là tiếng Việt; SPA và bản in song ngữ | Thị trường chính; Translation Collection để sau | |
| 9 | Thuế phương pháp X: thu nhập tính thuế ghi 0; giảm trừ khác âm báo lỗi | Đặc tả không ghi rõ | Không ảnh hưởng số thuế |
| 10 | Gói phúc lợi UAT: PL02 - PL06 coi là miễn thuế (E) | Suy ra từ số liệu UAT-2 vì đặc tả không ghi | Khớp UAT-1 đến UAT-5 và TC34 |

## 4. Cần chủ dự án / kế toán trưởng quyết

1. Ba giá trị pháp lý từ 01/07/2026 (đặc tả 6.1 #1) - đang `verified = F`.
2. Các điểm 6.1 #2 - #10 của đặc tả: bản NetSuite làm theo đúng code Acumatica hiện chạy (ví dụ giới hạn OT tháng xét theo từng bảng lương, lịch nghỉ tuần của bảng công lấy thiết lập chung).
3. Ánh xạ chiều phân tích (mục 3 #3) cho từng khách.
