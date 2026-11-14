# Rà soát bảo mật thông tin lương - so sánh SuitePeople và S4 Advanced Payroll

Bản 14/11/2026. Phạm vi: ai xem được lương của ai, qua đường nào (màn hình, tìm kiếm, báo cáo, sổ cái, API, file), và có để lại dấu vết không. Phần SuitePeople lấy từ tài liệu trợ giúp của Oracle (danh sách nguồn ở cuối); phần gói S4 đối chiếu mã nguồn nhánh `feature/ui-v2` và kết quả UAT vòng 1. Chưa thử xâm nhập thực tế bằng các vai trò ngoài vai trò Demo.

Lưu ý: SuitePeople Payroll là dịch vụ tính lương cho thị trường Mỹ; ở Việt Nam khách hàng dùng SuitePeople HR (hồ sơ, phân quyền nhân viên) còn tính lương do gói S4 làm. Vì vậy so sánh này là so về **cơ chế bảo mật**, không phải so tính năng tính lương.

## 1. SuitePeople bảo vệ thông tin lương bằng cách nào

| # | Cơ chế | Nội dung theo tài liệu Oracle |
| --- | --- | --- |
| 1 | Quyền riêng cho nghiệp vụ lương | Xem, xử lý, chốt lương cần quyền riêng (Process Payroll, Commit Payroll, Paychecks...). Chỉ vai trò có Process Payroll mức Full mới chốt được kỳ lương |
| 2 | Tách trường nhạy cảm trên hồ sơ nhân viên (Advanced Employee Permissions) | Hồ sơ chia thành các nhóm quyền: Employee Public, Employee Confidential, Employee Compensation, Employee Self... Mỗi nhóm chỉ mở một tập trường. Lương nằm ở nhóm Compensation (lương cơ bản, loại lương, mục tiêu thưởng) |
| 3 | Giới hạn theo người (restriction) | Mỗi quyền gắn một phạm vi: Own Only (chỉ mình), Subordinates (cấp dưới), Active and Non-Terminated, kế thừa từ vai trò, hoặc phạm vi tùy chỉnh. Mặc định Employee Compensation là View + Subordinates: quản lý chỉ xem lương cấp dưới |
| 4 | Giới hạn theo công ty con, phòng ban, địa điểm | Employee Restrictions và Subsidiary Restrictions trên vai trò |
| 5 | Che số định danh | Số an sinh xã hội được mã hóa và che mặc định trên màn hình và bản in; muốn xem đủ phải có quyền Employee Social Security Numbers. Có thêm tùy chọn che trên phiếu lương kể cả với người có quyền đủ |
| 6 | Quyền riêng cho tài khoản ngân hàng | Quyền Personal Banking Information (None / View / Full) |
| 7 | Ẩn lương từng người trên sổ cái | Tùy chọn "Combine Paychecks into Payroll Batch Totals": sổ cái chỉ còn tổng theo đợt lương, tắt lọc sổ cái theo nhân viên. Oracle cảnh báo phải bỏ cả quyền Report Customization ở vai trò không được xem, nếu không người dùng tự dựng lại chi tiết |
| 8 | Nhân viên tự xem | Quyền Employee Self mặc định View + Own Only; phiếu lương hiện ở Employee Center theo thời điểm cấu hình |
| 9 | Xác thực hai lớp | Bắt buộc với Administrator và vai trò đặc quyền cao; quản trị chỉ định thêm vai trò phải dùng 2FA. Một nguồn đối tác ghi vai trò lương không tự bị ép, phải bật tay (cần kiểm trên account) |
| 10 | Nhật ký | System Notes trên record, Login Audit Trail |

Điểm yếu SuitePeople tự nêu hoặc cộng đồng phản ánh: quyền chuẩn Lists > Employees ghi đè các quyền nhân viên chi tiết; vai trò có Process Payroll thấy mọi nhân viên trong đợt lương dù bị giới hạn cấp dưới; Administrator xem được tất cả; tìm kiếm phiếu lương là một đường khác tới dữ liệu từng người.

## 2. Gói S4 đang làm gì

| # | Cơ chế | Hiện trạng trong mã |
| --- | --- | --- |
| 1 | Tách lương khỏi hồ sơ Employee chuẩn | Lương, lương đóng BH, người phụ thuộc nằm ở custom record riêng. Người chỉ có quyền Lists > Employees không thấy lương |
| 2 | Quyền theo danh sách vai trò | Cả 68 custom record dùng `USEPERMISSIONLIST`; chỉ vai trò HR, Kế toán, Demo, vai trò ẩn Tự phục vụ và Administrator có quyền. Tắt tìm kiếm nhanh trên mọi record |
| 3 | Kiểm tra vai trò và trạng thái ở máy chủ | Mọi thao tác qua RESTlet đều kiểm tra vai trò; HR không ghi sổ, đảo, lập bill, ghi sổ tạm ứng. Bản in chỉ cho Administrator và vai trò lương |
| 4 | Chặn sửa trực tiếp | User Event chặn sửa record lương, chứng từ công, sổ phép trên form NetSuite, CSV Import, web service |
| 5 | Cổng nhân viên | Suitelet chạy bằng vai trò ẩn, mọi truy vấn lọc cứng theo người đăng nhập; không có tham số chọn nhân viên khác; chỉ hiện bảng đã ghi sổ |
| 6 | Sổ cái | Một bút toán cho cả bảng lương, gộp theo tài khoản, phòng ban, địa điểm, dự án; không có tên hay mã nhân viên trên dòng |
| 7 | Nhật ký | System Notes bật trên mọi record; nhật ký thao tác và nhật ký duyệt chỉ thêm (HR, Kế toán chỉ có quyền Create), không chứa số tiền hay số định danh; log máy chủ không ghi lương |
| 8 | Tách nhiệm vụ | Duyệt nhiều cấp chặn người gửi tự duyệt và một người duyệt hai cấp liền nhau |
| 9 | Trợ lý AI | Công cụ AI chạy theo quyền vai trò của người dùng; thao tác ghi cần xác nhận |

## 3. So sánh và khoảng trống

Mức: **Cao** cần xử lý trước khi bán cho khách có yêu cầu bảo mật lương; **Trung bình** nên có; **Thấp** tùy khách.

| Tiêu chí | SuitePeople | Gói S4 | Khoảng trống | Mức |
| --- | --- | --- | --- | --- |
| Lương tách khỏi hồ sơ nhân viên chung | Có, bằng nhóm quyền Compensation | Có, bằng custom record riêng | Tương đương | - |
| Phạm vi theo người (chỉ mình, cấp dưới) | Có | Không. Vai trò HR và Kế toán thấy lương **mọi người** | Không có vai trò quản lý xem lương cấp dưới; không tách được nhóm lương lãnh đạo | Cao |
| Phạm vi theo công ty con, phòng ban | Có | Không. Vai trò của gói đặt `subsidiaryoption = ALL`; API không lọc theo công ty con của người dùng (UAT-006: GET `outputs` thiếu công ty con trả dữ liệu mọi công ty) | Tập đoàn nhiều pháp nhân: HR công ty A thấy lương công ty B | Cao |
| Tách xem hồ sơ và xem tiền lương | Có (Confidential khác Compensation) | Không. HR có Full trên cả hồ sơ lẫn bảng lương; Kế toán có View lịch sử lương và Full bảng lương | Không tạo được vai trò "làm công, phép nhưng không thấy lương" | Trung bình |
| Che số định danh | Mã hóa, che mặc định, quyền riêng để xem đủ | Màn Nhân sự bản mới chỉ trả cờ có / không. **Nhưng API `profiles` bản cũ trả đủ MST, CCCD, số sổ BHXH, số tài khoản dạng rõ (UAT-001)**; trường lưu dạng văn bản thường, không mã hóa; báo cáo bảo hiểm hiện đủ số sổ | Lộ số định danh với mọi vai trò lương; không có quyền riêng "xem số đầy đủ" | Cao |
| Tài khoản ngân hàng | Quyền riêng | Chung quyền với hồ sơ lương | Không tách | Trung bình |
| Ẩn lương từng người trên sổ cái | Phải bật tùy chọn | Mặc định đã gộp, không có tên người | Gói S4 tốt hơn. Lưu ý: phòng ban chỉ một người (ví dụ giám đốc) thì dòng chi phí theo phòng ban vẫn lộ lương người đó; bút toán tạm ứng ghi theo từng phiếu | Thấp |
| Đường vòng qua tìm kiếm, báo cáo, SuiteQL | Có cảnh báo bỏ Report Customization | Người có quyền record xem được danh sách record gốc, Saved Search, SuiteQL, Analytics trên record lương. Ngoài vai trò lương thì không có quyền record nên không đọc được | Chưa kiểm bằng vai trò thật (PQ-06). Vai trò tùy chỉnh của khách nếu được cấp quyền record là thấy hết | Trung bình |
| Vai trò ẩn Tự phục vụ | Không dùng mô hình này | Vai trò `customrole_s4vp_selfservice` có View trên hồ sơ lương, lịch sử lương, bảng lương của **mọi người** (để Suitelet chạy thay) | Nếu ai đó gán nhầm vai trò này cho một người dùng, người đó xem được lương cả công ty qua danh sách record | Cao |
| Administrator xem lương | Xem được | Xem được | Như nhau; xử lý bằng tổ chức (hạn chế số quản trị, 2FA, rà nhật ký đăng nhập). Sổ tay đã ghi "quản trị IT không xem lương: chưa làm" | Trung bình |
| Nhân viên tự xem phiếu lương | Own Only | Lọc cứng theo người đăng nhập | Tương đương. Chưa thử đổi tham số bằng phiên nhân viên (ES-02) | - |
| Xác thực hai lớp cho vai trò lương | Chỉ định theo vai trò | Gói không đặt; là thiết lập của account | Chưa có hướng dẫn triển khai bắt buộc 2FA cho vai trò HR, Kế toán | Trung bình |
| Nhật ký ai xem lương | Không có nhật ký xem | Không có nhật ký xem; chỉ ghi thao tác ghi | Như nhau. In phiếu lương, xuất file ngân hàng, xuất CSV chưa ghi nhật ký | Thấp |
| Nhật ký không sửa xóa được | System Notes | HR, Kế toán chỉ Create; **vai trò Demo có Full trên nhật ký (xóa được)**; Tự phục vụ có Edit | Vai trò Demo không dùng cho môi trường thật; nên hạ quyền | Thấp |
| File chứa lương | - | File ngân hàng, CSV tải thẳng về máy người dùng, PDF trả trực tiếp, không lưu File Cabinet | Tốt. Rủi ro còn lại là file trên máy người dùng | Thấp |
| Tách nhiệm vụ lập và duyệt | Process và Commit là hai quyền | Duyệt một cấp: người lập tự duyệt được (UAT-007); hoa hồng cùng vai trò tính và duyệt | Phải bật duyệt nhiều cấp mới có tách | Trung bình |

## 4. Khuyến nghị theo thứ tự ưu tiên

1. **Sửa UAT-001:** API `profiles` (và mọi API đọc hồ sơ) không trả số định danh dạng rõ; chỉ trả cờ, hoặc che còn 4 số cuối; thêm một thao tác "xem số đầy đủ" có quyền riêng và ghi nhật ký. Báo cáo bảo hiểm, tờ khai là nơi duy nhất hiện số đầy đủ.
2. **Khóa vai trò Tự phục vụ:** kiểm tra khi cài đặt và trên màn Thiết lập rằng không người dùng nào được gán vai trò này; cảnh báo "Cần chú ý" nếu có. Cân nhắc thu hẹp quyền record của vai trò về đúng những record cổng nhân viên cần.
3. **Phạm vi theo công ty con:** lọc mọi API đọc và ghi theo công ty con mà vai trò người dùng được phép (đọc từ giới hạn công ty con của vai trò NetSuite); bỏ `subsidiaryoption = ALL` trên vai trò mẫu, để khách tự đặt.
4. **Vai trò theo phạm vi người:** thêm vai trò "Quản lý" chỉ xem công, đơn từ (và tùy chọn lương) của cấp dưới; thêm nhóm lương "bảo mật" (lãnh đạo) chỉ một số người được xem, kiểm ở tầng API.
5. **Tách quyền xem tiền:** một vai trò HR vận hành (công, phép, hồ sơ không lương) tách khỏi vai trò tiền lương.
6. **Hướng dẫn triển khai:** bắt buộc 2FA cho vai trò HR, Kế toán, Administrator; hạn chế số Administrator; không cấp quyền custom record lương cho vai trò khác; rà Login Audit Trail định kỳ; lưu ý phòng ban một người trên sổ cái.
7. **Nhật ký:** ghi thêm sự kiện in phiếu lương, xuất file ngân hàng, xuất CSV, xem số định danh đầy đủ; hạ quyền nhật ký của vai trò Demo và Tự phục vụ về Create.
8. **Kiểm chứng:** chạy các testcase PQ-01, PQ-03, PQ-06, ES-02, HS-07, CT-04 bằng vai trò thật (HR, Kế toán, nhân viên, một vai trò kế toán tổng hợp không thuộc gói) trước khi khẳng định với khách.

## 5. Câu trả lời ngắn cho khách hàng

- Đã làm được: lương tách khỏi hồ sơ nhân viên chung; chỉ vai trò lương mới thấy; sổ cái không lộ lương từng người; nhân viên chỉ xem được phiếu của mình; mọi thao tác có nhật ký; không sửa được dữ liệu lương ngoài màn hình của gói.
- Linh hoạt theo yêu cầu từng doanh nghiệp: phạm vi xem theo công ty con, theo cấp quản lý, nhóm lương bảo mật, che số định danh theo quyền.

## Nguồn

- [Advanced Employee Permissions Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1513370474.html)
- [Employee Compensation Permission Overview](https://oracle.hydrogen.sagittarius.connect.product.adaptavist.com/en/cloud/saas/netsuite/ns-online-help/section_156114123091.html)
- [Compensation Tracking Permission Requirements](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1548186061.html)
- [Custom Restrictions for Advanced Employee Permissions](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1515610286.html)
- [Employee Self Permission Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1502477001.html)
- [Setting Employee Restrictions](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4637690919.html)
- [Working with Employee Social Security Numbers](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N901259.html)
- [General Payroll Preferences](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_N920326.html)
- [Enabling Employees to Update Direct Deposit Information](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1511534973.html)
- [Combining Paychecks in the General Ledger](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_26151229606.html)
- [General Accounting Preferences](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1385293.html)
- [Viewing Payroll Batches](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N948008.html)
- [Managing Two-Factor Authentication](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_N327761.html)
- [Two-factor authentication (2FA) for NetSuite - RSM](https://technologyblog.rsmus.com/netsuite/two-factor-authentication-2fa-for-netsuite)
- [Oracle community: restrict access to see payroll](https://community.oracle.com/netsuite/english/discussion/4224009/restrict-access-to-see-payroll)
