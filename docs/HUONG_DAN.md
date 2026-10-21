# Hướng dẫn kiểm tra và vận hành S4 VN Payroll trên NetSuite

## 1. Mở màn hình

- Menu: tab **Lương VN** > **Lương** > **Màn hình Lương VN** (hoặc mở thẳng `/spa/s4vp-payroll`).
- Nhóm **Thiết lập lương** trên cùng tab: danh sách thiết lập, tham số pháp lý, biểu thuế, khoản trích, ngày lễ, loại thu nhập, quy tắc, gói phúc lợi, loại nghỉ, chính sách phép, ký hiệu bảng công (màn hình NetSuite chuẩn).
- Role: Administrator, **S4VP Payroll HR**, **S4VP Payroll Accountant**. HR không có nút Ghi sổ, Đảo, Lập bill, Ghi sổ tạm ứng; máy chủ cũng chặn.

## 2. Kiểm tra nhanh (dữ liệu thử đã có trên td2937310, subsidiary "S4VN TT99 Test")

1. Màn hình **Bảng lương**: chọn công ty con S4VN TT99 Test. Mở một bảng lương: phía trên là lưới nhân viên, phía dưới là các tab của nhân viên đang chọn (Thu nhập, Khấu trừ khác, Bảo hiểm, Công, Phân bổ dự án, Cấn trừ tạm ứng) và hai tab của cả bảng (Bút toán, Bill cơ quan thu), như VP302000 bên Acumatica. Các bảng lương thử:
   - BL000003 (10/2026, đã ghi sổ, có bill cơ quan thu): bấm số bảng, xem lưới nhân viên, bấm mã nhân viên để xem các tab chi tiết; tab **Bút toán**; **In phiếu lương**, **In bảng thanh toán**, **In quyết toán CTV**; **File chi lương**.
   - BL000001, BL000002: đã đảo (thử nghiệp vụ đảo).
   - BL000004 (11/2026): lập hoàn toàn trên giao diện, đã ghi sổ.
   - BL000005 (12/2026, đã ghi sổ JE1809 và bill cơ quan thu): tính từ bảng công đã khóa, đơn OT, nghỉ việc.
   - BL000007 (03/2027, chờ tính): thử thêm / xóa dòng nhập tay ngay trong tab Thu nhập hoặc Khấu trừ khác của một nhân viên, rồi **Tính lương**.
2. Màn hình **Chấm công và phép**: chọn kỳ 202612, xem bảng tổng hợp công (đã khóa), chứng từ đơn nghỉ / OT / ngoại lệ; thử lập một đơn mới ở kỳ chưa khóa (ví dụ 202701 sau khi sinh kỳ 2027), Gửi duyệt, Duyệt; **Số dư phép 2026**.
3. Màn hình **Báo cáo, tờ khai**: BH tháng 202612 (nhập số C12 để xem chênh lệch), 05/KK quý 4/2026, quyết toán 2026, chi phí theo tài khoản tháng 202610; **Xuất CSV**.
4. Màn hình **Thiết lập**: Nạp mặc định VN (chạy lại không tạo trùng), Sinh kỳ lương (năm, nhóm lương), liên kết tới các danh mục.

Số liệu kỳ vọng của từng nhân viên thử: docs/KIEM_THU.md mục 2.

## 3. Triển khai cho một account mới

1. Deploy gói (README). Account cần Custom Records, Server SuiteScript; nên bật Departments, Classes, Locations.
2. Đăng nhập Administrator, mở màn hình Lương VN > **Thiết lập** > **Nạp mặc định VN**. Tên danh mục tạo theo ngôn ngữ người chạy.
3. Kế toán trưởng đối chiếu **Tham số pháp lý** với văn bản gốc. Ba dòng từ 01/07/2026 đang `Đã đối chiếu = F` (mức tham chiếu 2.530.000, ngưỡng khấu trừ 10% 5.000.000, trần ăn ca 1.200.000): sửa giá trị nếu khác văn bản, đánh dấu đã đối chiếu.
4. **Thiết lập chung**: tài khoản 334, 3335, 141, chi phí mặc định, khấu trừ khác, 335, phải trả CTV; cơ quan thuế; vùng mặc định; ngày nghỉ hằng tuần (mặc định "0,6" = Chủ nhật, thứ Bảy); "Tự duyệt bút toán" (mặc định bật); địa điểm mặc định nếu account bắt buộc Location.
5. **Thiết lập lương theo công ty**: một dòng cho mỗi subsidiary dùng lương (ô trống kế thừa thiết lập chung); người ký bản in.
6. **Khoản trích theo lương**: tài khoản 338x và cơ quan thu (vendor) cho từng khoản.
7. **Sinh kỳ lương** cho nhóm lương DEFAULT (và nhóm khác nếu có).
8. **Hồ sơ lương nhân viên**: một hồ sơ cho mỗi nhân viên (cách tính thuế, loại lao động, loại lương, vùng, BH, ngân hàng...), lịch sử lương (lương hợp đồng, lương đóng BH, phụ cấp, gói phúc lợi), người phụ thuộc.
9. Gán role S4VP Payroll HR / Accountant cho người dùng.
10. Chạy một kỳ thử, so với bảng lương Excel cũ của khách đến từng đồng, rồi mới chạy thật (đặc tả 1.2.8).

Bản production: xóa dòng `api/TestData.js` khỏi gói trước khi deploy hoặc xóa file sau khi deploy; RESTlet chỉ cho Administrator gọi chức năng tạo dữ liệu test.

## 4. Quy trình tháng (đặc tả 1.2.1)

1. HR: chứng từ công (đơn nghỉ, OT, công tác, ngoại lệ) Gửi duyệt; quản lý Duyệt (không tự duyệt đơn của mình).
2. HR cuối kỳ: Lập bảng công, rà soát, Khóa công.
3. HR: Tạo bảng lương (công ty con, kỳ), Nạp nhân viên, nhập dòng thu nhập / khấu trừ tay, Tính lương, xử lý cảnh báo, Bỏ tạm giữ.
4. Kế toán trưởng: Duyệt.
5. Kế toán: Ghi sổ (JE, cấn trừ tạm ứng), Lập bill cơ quan thu, File chi lương, In phiếu lương, bảng thanh toán.
6. Sửa sau ghi sổ: void bill cơ quan thu trên NetSuite, Đảo bảng lương, lập bảng mới cùng kỳ.
