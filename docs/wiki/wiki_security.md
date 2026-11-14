## 26. Tổ chức vai trò để bảo mật thông tin lương

**Mục đích.** Hướng dẫn tổ chức vai trò (role) NetSuite trong doanh nghiệp sao cho thông tin nhạy cảm - trước hết là lương, sau đó là số định danh cá nhân và tài khoản ngân hàng - chỉ đến đúng người cần biết, theo đúng công ty mình phụ trách, và mọi lần chạm vào đều để lại dấu vết. Bài này dành cho quản trị hệ thống, kế toán trưởng, trưởng phòng nhân sự và tư vấn triển khai.

**Vai trò.** Quản trị hệ thống (tạo và gán vai trò), kế toán trưởng và trưởng phòng nhân sự (quyết định ai được xem gì), tư vấn S4 (thiết lập ban đầu, rà soát).

**Kích hoạt, tần suất.** Một lần khi triển khai; rà lại khi có người mới, người chuyển việc, người nghỉ việc, khi thêm công ty con, và định kỳ mỗi quý.

### 26.1 Nguyên tắc

1. **Biết vừa đủ.** Mỗi người chỉ có quyền cho đúng công việc của mình. Người làm công, phép không cần thấy lương. Người làm lương công ty A không cần thấy lương công ty B.
2. **Tách ba loại thông tin.** Hồ sơ và công phép; số tiền lương; số định danh đầy đủ. Ba loại này đi theo ba gói quyền khác nhau, không cấp chung một cục.
3. **Tách người lập và người duyệt.** Người lập bảng lương không tự duyệt bảng của mình.
4. **Quyền rộng đè quyền hẹp.** Một vai trò rộng cấp nhầm làm vô hiệu mọi giới hạn khác. Vì vậy rà vai trò rộng trước (Administrator, vai trò có quyền trên record lương).
5. **Không chặn được thì phải thấy được.** Với những người không thể chặn tuyệt đối (quản trị hệ thống), dùng nhật ký và rà soát định kỳ.

### 26.2 Mô hình quyền của gói: gói thông tin nhân với phạm vi

Quyền của một người = **gói thông tin** được xem x **phạm vi** công ty con.

| Gói thông tin | Gồm | Vai trò có gói này |
| --- | --- | --- |
| Hồ sơ, công, phép | Hồ sơ nhân viên (không có số tiền), chấm công, đơn từ, phép năm, ca, máy chấm công, giấy phép lao động | HR vận hành, HR tiền lương, Kế toán lương (xem) |
| Tiền lương | Lịch sử lương, bảng lương, tạm ứng, sản lượng và lương khoán, hoa hồng, phân tích chi phí, báo cáo, bản in có số tiền | HR tiền lương, Kế toán lương |
| Số định danh đầy đủ | Mã số thuế, CCCD, số sổ BHXH, số tài khoản ngân hàng | HR tiền lương (qua thao tác xem số đầy đủ của từng nhân viên, có ghi nhật ký) |

Phạm vi công ty con lấy từ chính giới hạn công ty con của vai trò NetSuite (Subsidiary Restrictions trên vai trò). Gói đọc danh sách công ty con mà vai trò được phép và áp vào mọi lượt đọc, ghi: bảng lương, hồ sơ, chứng từ công, phiếu khoán, tạm ứng, hoa hồng của công ty khác không hiện ra và không thao tác được. Cấu hình dùng chung (không gắn công ty con, ví dụ nhóm lương mặc định) thì mọi người đều thấy.

Số định danh: mọi danh sách và màn hình hồ sơ chỉ hiện dạng che, giữ 4 ký tự cuối (ví dụ `********6789`). Số đầy đủ chỉ xuất hiện ở báo cáo bảo hiểm, tờ khai, file chi lương ngân hàng, và qua thao tác xem số đầy đủ của từng nhân viên dành cho HR tiền lương.

### 26.3 Các vai trò của gói

| Vai trò | Dành cho | Thấy tiền lương | Thấy số định danh đầy đủ | Thao tác chính |
| --- | --- | --- | --- | --- |
| S4VP HR Operations (no pay) | Nhân viên chấm công, hành chính nhân sự, thống kê xưởng | Không | Không | Xếp ca, nạp và xử lý chấm công, đơn từ, phép năm, lập và khóa bảng công |
| S4VP Payroll HR | Chuyên viên tiền lương | Có | Có | Mọi việc của HR vận hành, hồ sơ lương, lập và tính bảng lương, gửi duyệt |
| S4VP Payroll Accountant | Kế toán lương, kế toán trưởng | Có | Không | Duyệt, ghi sổ, đảo, bill cơ quan thu, tạm ứng, hoa hồng, báo cáo |
| Employee Center (chuẩn NetSuite) | Mọi nhân viên | Chỉ lương của chính mình | Không | Xem phiếu lương, phép, gửi đơn trên cổng nhân viên |
| S4VP Self-service (run-as only) | **Không gán cho ai** | - | - | Vai trò kỹ thuật để cổng nhân viên chạy |
| S4 Advanced Payroll - Demo | Trình diễn, đào tạo | Có | Có | Gộp quyền HR và Kế toán. **Không dùng trên môi trường thật** |

Vai trò HR vận hành không có quyền trên bất kỳ record nào chứa số tiền lương, nên không xem được lương cả trên màn hình của gói lẫn danh sách record, tìm kiếm, báo cáo của NetSuite. Đơn công tác có tạm ứng phải do HR tiền lương duyệt (vì sinh phiếu tạm ứng).

Vai trò Self-service có quyền xem hồ sơ lương và bảng lương của mọi người để cổng nhân viên đọc được dữ liệu; cổng tự lọc chỉ còn dữ liệu của người đăng nhập. Nếu gán vai trò này cho một người dùng, người đó xem được lương cả công ty qua danh sách record của NetSuite. Màn **Thiết lập** có mục **Bảo mật vai trò** báo "Cần chú ý" khi phát hiện vai trò này đang được gán cho người dùng.

### 26.4 Tổ chức vai trò theo quy mô

**Một công ty, phòng nhân sự nhỏ.**

| Người | Vai trò |
| --- | --- |
| Chuyên viên tiền lương | S4VP Payroll HR |
| Kế toán trưởng | S4VP Payroll Accountant, khai là người duyệt bảng lương |
| Nhân viên chấm công (nếu có) | S4VP HR Operations |
| Nhân viên | Employee Center |

Bật duyệt nhiều cấp (Thiết lập > Cấp duyệt bảng lương) để người lập không tự duyệt.

**Tập đoàn nhiều công ty con.** Mỗi công ty một bộ vai trò riêng, giới hạn đúng công ty đó:

1. Vào Setup > Users/Roles > Manage Roles, bấm **Customize** trên vai trò của gói (ví dụ S4VP Payroll HR) để nhân bản, đặt tên "HR tiền lương - Công ty A", đặt ID dễ nhớ (ví dụ `customrole_hr_cty_a`).
2. Ở mục Subsidiary Restrictions của vai trò mới chọn **Selected** và chọn Công ty A (hoặc **User Subsidiary** nếu muốn một vai trò dùng chung, mỗi người chỉ thấy công ty của chính mình). Không tick "Allow Cross-Subsidiary Record Viewing".
3. Mở record **Thiết lập lương VN** (Thiết lập chung), điền ID vai trò mới vào trường tương ứng: **Vai trò tương đương HR tiền lương**, **Vai trò tương đương Kế toán lương** hoặc **Vai trò tương đương HR vận hành**. Nhiều vai trò cách nhau bằng dấu phẩy. Gói sẽ coi vai trò nhân bản có đúng quyền của vai trò gốc.
4. Thêm vai trò mới vào đối tượng được dùng (Audience) của: RESTlet "S4VP Payroll API", Suitelet in, Suitelet mở màn hình, ứng dụng "S4VP VN Payroll", và tab menu "S4 Advanced Payroll" của Accounting Center (vai trò HR vận hành dùng tab riêng chỉ có Chấm công và Xếp ca). Vai trò nhân bản phải cùng trung tâm (Center Type) với tab thì tab mới hiện.
5. Gán vai trò mới cho người dùng. Đăng nhập thử: ô Công ty con chỉ còn Công ty A; mở thẳng một bảng lương của Công ty B phải báo không tìm thấy.
6. Bộ phận dùng chung của tập đoàn (kế toán hợp nhất, ban kiểm soát) dùng vai trò gốc không giới hạn công ty con, cấp cho rất ít người.

Mỗi công ty con nên có **nhóm lương riêng**. Hai công ty dùng chung một nhóm lương thì dùng chung kỳ lương; dữ liệu vẫn được lọc theo công ty con của từng nhân viên nhưng thao tác theo kỳ (khóa công, đóng kỳ) ảnh hưởng cả hai.

**Lương ban lãnh đạo.** Cách làm hiện tại: tách ban lãnh đạo thành một công ty con hoặc một nhóm lương riêng do một chuyên viên tiền lương riêng phụ trách bằng vai trò giới hạn. Lưu ý trên sổ cái: phòng ban chỉ có một người thì dòng chi phí theo phòng ban chính là lương người đó; nên hạch toán ban lãnh đạo vào một phòng ban gộp hoặc giới hạn vai trò xem sổ cái theo phòng ban.

### 26.5 Quản trị hệ thống và người làm báo cáo

**Người làm báo cáo, kế toán tổng hợp.** Vai trò không có quyền trên record lương thì không tìm, không báo cáo, không truy vấn được dữ liệu lương (Saved Search, Workbook, SuiteQL). Sổ cái chỉ có một bút toán gộp cho cả bảng lương, không có tên người. Việc cần làm: **không cấp quyền record của gói cho vai trò ngoài bảng ở mục 26.3**.

**Administrator.** NetSuite cho vai trò Administrator toàn quyền trên mọi record; không cấu hình nào của gói chặn được. Cách xử lý:

1. Tạo một vai trò quản trị IT riêng: đủ quyền quản trị hệ thống thường ngày (người dùng, vai trò, tùy biến) nhưng không có quyền trên record của gói. Đội IT làm việc hằng ngày bằng vai trò này.
2. Vai trò Administrator thật chỉ cấp cho một hoặc hai người, có biên bản giao nhận.
3. Bắt buộc xác thực hai lớp (2FA) cho Administrator và cho mọi vai trò có gói Tiền lương (Setup > Users/Roles > Two-Factor Authentication Roles).
4. Rà **Login Audit Trail** hằng tháng: ai đăng nhập bằng Administrator, bằng vai trò lương, từ đâu.
5. Theo dõi thay đổi vai trò và script: ai sửa được script thì với tới được dữ liệu; mọi thay đổi script trên môi trường thật phải qua quy trình triển khai.

### 26.6 Danh sách kiểm khi triển khai

| # | Việc | Người làm |
| --- | --- | --- |
| 1 | Lập bảng "ai được xem gì": từng người, gói thông tin, công ty con | Kế toán trưởng, trưởng phòng nhân sự |
| 2 | Tạo vai trò theo mục 26.4, khai vai trò tương đương, thêm vào Audience | Quản trị, tư vấn S4 |
| 3 | Kiểm mục Bảo mật vai trò trên màn Thiết lập ở trạng thái Đủ | Quản trị |
| 4 | Bật 2FA cho Administrator và vai trò có gói Tiền lương | Quản trị |
| 5 | Tạo vai trò quản trị IT không có quyền lương; thu hẹp số Administrator | Quản trị |
| 6 | Bật duyệt nhiều cấp, khai người duyệt | Kế toán trưởng |
| 7 | Đăng nhập thử bằng từng vai trò: thấy đúng công ty, đúng màn hình; thử mở dữ liệu ngoài phạm vi | Tư vấn S4, key user |
| 8 | Rà các vai trò khác của doanh nghiệp: không vai trò nào có quyền trên record của gói | Quản trị |
| 9 | Không dùng vai trò Demo trên môi trường thật | Quản trị |

### 26.7 Kiểm soát định kỳ

| Tần suất | Việc |
| --- | --- |
| Mỗi tháng | Rà nhật ký thao tác của gói: ai ghi sổ, đảo, in phiếu lương, xuất file ngân hàng, xem số định danh đầy đủ |
| Mỗi tháng | Rà Login Audit Trail cho Administrator và vai trò lương |
| Mỗi quý | Rà danh sách người dùng theo vai trò; gỡ quyền của người chuyển việc, nghỉ việc |
| Khi có thay đổi | Thêm công ty con: tạo bộ vai trò mới; đổi người phụ trách: gán lại, không dùng chung tài khoản |

**Nhật ký của gói ghi gì.** Mọi thao tác ghi (tạo, tính, duyệt, ghi sổ, đảo, khóa công, sửa hồ sơ...), cùng ba sự kiện đọc nhạy cảm: in chứng từ có lương, xuất file chi lương ngân hàng, xem số định danh đầy đủ. Nhật ký không chứa số tiền hay số định danh; vai trò HR và Kế toán chỉ thêm được, không sửa, không xóa.

### 26.8 Giới hạn hiện tại

- Giới hạn theo công ty con đã áp ở lớp đọc ghi dữ liệu chung và ở tham số công ty con của mọi API. Một số báo cáo tổng hợp tự viết truy vấn riêng luôn nhận tham số công ty con và được kiểm ở cổng vào; chưa rà hết từng truy vấn không có tham số công ty con.
- Chưa có phạm vi theo người (quản lý chỉ xem cấp dưới) và chưa có nhóm lương bảo mật riêng cho lãnh đạo; hiện xử lý bằng cách tổ chức ở mục 26.4.
- Vai trò HR vận hành chưa có màn Nhân sự (danh sách và hồ sơ nhân viên); chọn nhân viên ngay trên màn Chấm công và Xếp ca.
- Số tiền lương lưu dạng số thường, không mã hóa: Administrator xem được qua record. Đây là lựa chọn có chủ đích (giữ được báo cáo và tốc độ); kiểm soát bằng mục 26.5.
- Thao tác xem số định danh đầy đủ mới có ở máy chủ (API `revealIds`, có nhật ký); nút trên màn hình hồ sơ chưa có. Muốn sửa một số định danh thì nhập lại toàn bộ số mới.
- Xuất CSV từ màn báo cáo tạo file ngay trên trình duyệt, chưa ghi nhật ký.
- Phần giới hạn theo công ty con và vai trò HR vận hành đã qua kiểm thử tự động; **chưa thử bằng người dùng thật gán vai trò giới hạn**. Phải chạy bước 7 của danh sách kiểm trước khi dùng thật.

### 26.9 Hỏi đáp thường gặp

**Kế toán tổng hợp có thấy lương từng người trên sổ cái không?** Không. Bảng lương ghi sổ thành một bút toán gộp theo tài khoản, phòng ban, địa điểm, dự án. Trường hợp cần lưu ý là phòng ban chỉ có một người.

**Nhân viên có xem được lương của người khác trên cổng nhân viên không?** Không. Cổng chỉ trả dữ liệu của người đang đăng nhập và không nhận tham số chọn nhân viên khác.

**Trưởng bộ phận muốn duyệt đơn của nhân viên mình thì cấp vai trò gì?** Hiện đơn từ do HR vận hành hoặc HR tiền lương duyệt. Không cấp vai trò có gói Tiền lương cho trưởng bộ phận chỉ để duyệt đơn.

**Tư vấn S4 hỗ trợ từ xa thì dùng vai trò gì?** Một vai trò riêng, có thời hạn, đúng phạm vi cần hỗ trợ; thu hồi khi xong việc. Không dùng chung tài khoản Administrator của khách.

**Trợ lý AI có làm lộ lương không?** Trợ lý AI kết nối bằng tài khoản và vai trò của chính người dùng, nên chỉ đọc được những gì vai trò đó được phép (bài 25).

**Vì sao không mã hóa lương để chặn cả Administrator?** Mã hóa làm mất khả năng tìm kiếm, báo cáo trên số tiền, làm chậm tính lương, và vẫn không chặn được một Administrator cố ý (họ tự gán vai trò lương hoặc sửa script, dù để lại dấu vết). Cách hiệu quả hơn là thu hẹp số Administrator, tách vai trò IT, 2FA và rà nhật ký.
