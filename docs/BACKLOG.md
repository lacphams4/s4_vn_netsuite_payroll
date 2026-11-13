# Backlog lỗi và việc tồn

Mỗi mục: mã, ngày phát hiện, mức, mô tả, cách tái hiện, hướng xử lý dự kiến, trạng thái. Xử lý xong thì ghi commit và chuyển trạng thái, không xóa mục.

## BUG-001 - Vai trò Demo không chạy được tác vụ nền chấm công

- Phát hiện: 13/11/2026, buổi quay video kỳ SAOMAI-202701 (td2937310).
- Mức: cao (chặn luồng chấm công của người dùng không phải Administrator).
- Mô tả: đăng nhập vai trò `customrole_s4vp_demo`, màn Chấm công, "Thao tác khác" > "Xử lý chấm công máy" báo "Bạn không có quyền để thực hiện thao tác này". RESTlet trả 200, lỗi đến từ NetSuite. Kỳ 116 người x 31 ngày vượt ngưỡng nên `api/Attendance.runPunches` gọi `queue()` -> `task.create(MAP_REDUCE).submit()` bằng role của người dùng. Cùng thao tác bằng Administrator chạy được.
- Ảnh hưởng nhiều khả năng: mọi thao tác đi qua `queue()` (build, lock, unlock, punches, accrue) với vai trò Demo và vai trò HR (Demo có đủ quyền của HR). Chưa kiểm vai trò HR.
- Tái hiện: vai trò Demo, kỳ có trên 3.000 nhân viên x ngày, bấm Xử lý chấm công máy.
- Hướng xử lý: xác định quyền NetSuite cần để submit Map/Reduce từ RESTlet (thử thêm quyền vào role, hoặc chuyển submit sang script chạy với role riêng, ví dụ Suitelet/RESTlet nội bộ có "Execute as role"). Kiểm lại cả build, lock bằng vai trò HR và Demo. Thêm vào `docs/KIEM_THU.md` ca kiểm bằng vai trò không phải Administrator.
- Trạng thái: mở.

## BUG-002 - Lập bill cơ quan thu lỗi subsidiary 14

- Phát hiện: 13/11/2026, bảng lương BL000016 (SAOMAI-202701, đã ghi sổ JE2140).
- Mức: trung bình.
- Mô tả: tab "Bill cơ quan thu" > "Lập bill cơ quan thu" > Đồng ý báo "Bạn đã nhập giá trị trường không hợp lệ 14 cho trường sau đây: subsidiary". Không có bill nào được tạo.
- Nguyên nhân nghi ngờ: nhà cung cấp cơ quan thu (BHXH, công đoàn, cơ quan thuế) trong thiết lập chưa gán công ty con Sao Mai Demo (id 14). Đây cũng là điểm còn treo "agency bill vendors" của dữ liệu demo.
- Hướng xử lý: (1) dữ liệu: gán vendor cơ quan thu cho sub 14 hoặc tạo vendor riêng cho Sao Mai; (2) sản phẩm: kiểm tra trước khi lập bill, báo lỗi nghiệp vụ song ngữ dễ hiểu ("Nhà cung cấp X chưa gán công ty con Y") thay cho lỗi gốc NetSuite; mục Thiết lập nên đánh dấu "Cần chú ý" khi vendor không thuộc công ty con đang dùng gói.
- Trạng thái: mở. Sau khi sửa, lập bill cho BL000016.

## BUG-003 - 10 phiếu khoán tổ kỳ SAOMAI-202701 còn tạm giữ (dữ liệu demo)

- Phát hiện: 13/11/2026.
- Mức: thấp (dữ liệu demo, không phải lỗi mã).
- Mô tả: loader tạo 14 phiếu khoán tổ ở Tạm giữ, chưa chia tiền. Kịch bản quay giả định đã duyệt sẵn. Trong buổi quay đã duyệt SL000099-SL000102 và phiếu mới SL000114 (tổ Lắp ráp); còn 10 phiếu tổ Đóng gói, tổ Cắt (từ SL000098 trở xuống) tạm giữ nên lương khoán hai tổ không vào BL000016.
- Hướng xử lý: sửa loader (`s4_netsuite_demo_saomai`) để phiếu không quay trên video được chia và duyệt sẵn; với kỳ 202702 (bản tiếng Anh) kiểm trước khi quay. Cân nhắc thao tác hàng loạt "Chia và gửi duyệt các phiếu đã chọn" trên màn Sản lượng.
- Trạng thái: mở.

## FEAT-001 - Hoa hồng tính từ đơn bán hàng (Sales Order)

- Ghi nhận: 13/11/2026, yêu cầu từ nội dung video ("lấy từ SO, Invoice tùy mô hình").
- Hiện trạng: nguồn doanh số NetSuite chỉ đọc Invoice, Cash Sale, Credit Memo đã ghi sổ (`api/CommissionV2`, `docs/COMMISSION.md`).
- Đề xuất: thêm lựa chọn nguồn chứng từ trên kế hoạch hoa hồng: Sales Order (theo ngày đơn, trạng thái đã duyệt, trừ dòng đóng hoặc hủy), có quy tắc tránh đếm trùng khi đơn đã lập hóa đơn; ghi nhận theo Sales Rep hoặc đội bán như hiện tại.
- Trạng thái: mở.

## FEAT-002 - Lương, thưởng KPI lấy dữ liệu từ báo cáo hoặc saved search NetSuite

- Ghi nhận: 13/11/2026, yêu cầu từ nội dung video ("dữ liệu KPI lấy trực tiếp từ báo cáo NetSuite").
- Hiện trạng: chỉ có % đạt chỉ tiêu doanh số (kế hoạch hoa hồng, điều kiện P của quy tắc thu nhập); chưa có KPI nhiều tiêu chí, chưa đọc báo cáo hoặc saved search.
- Đề xuất: record "Nguồn KPI" khai saved search (hoặc dataset) trả về nhân viên, kỳ, chỉ số, giá trị; bảng KPI theo kỳ có trọng số, thang điểm; quy tắc thu nhập dùng điểm KPI làm điều kiện hoặc hệ số. Không nhận SuiteQL tự do; chỉ chọn saved search đã khai.
- Trạng thái: mở.

## BUG-004 - SDF deploy lỗi CUSTOM_OBJECT_ACCOUNT_VALIDATION

- Phát hiện: 13/11/2026.
- Mức: cao (chặn mọi lần deploy).
- Mô tả: `suitecloud project:deploy` báo "Đã xảy ra lỗi trong khi kiểm duyệt Đối tượng tùy chỉnh đối với tài khoản" ở đối tượng account validation đầu tiên (custcentercategory_s4vp_demo_acct, bỏ ra thì lỗi chuyển sang đối tượng kế tiếp). Lỗi có cả khi bỏ thay đổi mới nhất; buổi sáng cùng ngày deploy thành công. Không có chi tiết lỗi trong log.
- Đang chờ deploy: commit 334e7d8 (thêm REST Web Services cho vai trò HR, Accountant, Demo).
- Hướng xử lý: thử lại khi account ổn định; kiểm token SDF (`account:setup`), quyền Administrator của token; nếu vẫn lỗi, deploy thử một project nhỏ để khoanh vùng.
- Trạng thái: mở.
