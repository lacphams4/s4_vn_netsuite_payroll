## 25. Trợ lý AI qua NetSuite AI Connector

**Mục đích.** Cho người làm lương hỏi và thao tác với phân hệ bằng lời, ngay trong Claude, ChatGPT hoặc trợ lý AI khác đã kết nối NetSuite: kỳ lương đang ở bước nào, bảng lương còn cảnh báo gì, lương của một nhân viên gồm những khoản nào, tạo đơn nghỉ, gửi duyệt bảng lương. Trợ lý không có đường đi riêng: nó dùng đúng lớp nghiệp vụ, phân quyền và nhật ký của màn hình.

**Vai trò.** HR, Kế toán (hỏi và thao tác trong phạm vi quyền của mình), Quản trị (bật tính năng, gán vai trò, tắt công cụ khi cần). Vai trò Demo dùng được như HR và Kế toán. Vai trò Administrator không kết nối được với connector của NetSuite.

**Kích hoạt, tần suất.** Bất kỳ lúc nào trong kỳ. Hợp nhất với việc tra cứu nhanh, soát số trước khi duyệt, và các thao tác lặp lại đơn giản.

### 25.1 Cách kết nối hoạt động

NetSuite AI Connector Service là cổng MCP của NetSuite. Trợ lý AI kết nối vào đó bằng tài khoản và vai trò của chính người dùng, rồi thấy hai nhóm công cụ: công cụ chuẩn của NetSuite (truy vấn, đọc record, chạy báo cáo) và các bộ công cụ do gói cài thêm. Connector không gọi được RESTlet, nên gói khai một bộ công cụ riêng tên **S4 Advanced Payroll** (đối tượng `custtoolset_s4vp_payroll`), gồm 20 công cụ có tên bắt đầu bằng `s4vp_`.

| Cửa vào | Ai dùng | Thành phần |
| --- | --- | --- |
| Màn hình S4 Advanced Payroll | Người dùng trên trình duyệt | SPA gọi RESTlet `customscript_s4vp_rl_api` |
| Hệ thống ngoài | Phần mềm tích hợp bằng OAuth 2.0 | Gọi cùng RESTlet đó |
| Trợ lý AI | Claude, ChatGPT... qua AI Connector | Bộ công cụ `custtoolset_s4vp_payroll` |

Cả ba cửa đi qua một lớp điều phối chung (`api/Dispatch`): kiểm tra quyền theo vai trò, kiểm tra trạng thái, ghi nhật ký thao tác. Bộ công cụ AI có thêm một lớp phía trước (`api/AiTools`): kiểm tra kiểu từng tham số, đòi xác nhận trước khi ghi, cắt gọn kết quả dài.

### 25.2 Thiết lập cho một người dùng (các bước)

1. Quản trị bật tính năng AI Connector Service và OAuth 2.0 trên account NetSuite.
2. Gán cho người dùng một vai trò của gói: S4VP Payroll HR, S4VP Payroll Accountant hoặc S4VP Demo. Ba vai trò này đã có sẵn quyền **MCP Server Connection** và **Log in using OAuth 2.0 Access Tokens**.
3. Trong Claude hoặc ChatGPT, người dùng kết nối NetSuite và chọn đúng vai trò đó. Nếu đã kết nối từ trước thì ngắt và kết nối lại để trợ lý tải danh sách công cụ mới.
4. Hỏi bằng lời bình thường. Không có lệnh hay kỹ năng riêng phải gọi; nếu trợ lý chưa chọn đúng công cụ thì nói rõ "dùng công cụ `s4vp_context` của NetSuite để bắt đầu".

Ví dụ câu hỏi:
- "Kỳ lương tháng này của công ty đang ở bước nào, còn việc gì phải làm?"
- "Bảng lương BL000015 tổng thực lĩnh bao nhiêu, so với kỳ trước lệch thế nào, còn cảnh báo nào chưa xử lý?"
- "Nhân viên E1069 tháng này được những khoản thu nhập nào, thuế tính ra sao?"
- "Tạo đơn nghỉ phép năm cho nhân viên E1069 ngày 05/01/2027."
- "Chi phí lao động tháng 12 theo phòng ban, so với tháng 11."

### 25.3 Công cụ đọc

| Công cụ | Trả về |
| --- | --- |
| `s4vp_context` | Điểm bắt đầu: người dùng và vai trò, công ty con đang dùng gói, nhóm lương, kỳ lương, loại nghỉ |
| `s4vp_home` | Việc hôm nay: kỳ đang chạy, số bảng lương theo trạng thái, tiến độ chấm công, việc cần làm, hạn sắp tới |
| `s4vp_payroll_runs` | Danh sách bảng lương của công ty con hoặc của một kỳ |
| `s4vp_payroll_run` | Một bảng lương: bước, số tổng, so sánh kỳ trước, dòng từng nhân viên (phân trang, tìm theo mã hoặc tên) |
| `s4vp_payroll_employee` | Chi tiết lương một nhân viên: thu nhập, khấu trừ, bảo hiểm, thuế TNCN, công, phân bổ, cấn trừ tạm ứng |
| `s4vp_payroll_checks` | Cảnh báo và lỗi của bảng lương, lọc theo mức và tình trạng xử lý |
| `s4vp_payroll_journal` | Bút toán của bảng lương (xem trước nếu chưa ghi sổ) |
| `s4vp_attendance_month` | Bảng công của kỳ: tình trạng khóa, thống kê, dòng từng nhân viên |
| `s4vp_attendance_employee` | Lượt chấm, ca được xếp, giờ công của một nhân viên trong kỳ |
| `s4vp_attendance_docs` | Đơn nghỉ, đơn làm thêm, đơn công tác, phiếu ngoại lệ |
| `s4vp_leave_balances` | Số dư phép theo năm |
| `s4vp_employees`, `s4vp_employee` | Tìm nhân viên; toàn cảnh một nhân viên |
| `s4vp_labor_cost` | Phân tích chi phí lao động theo tháng và theo chiều (chỉ vai trò kế toán) |
| `s4vp_commission` | Bảng tính hoa hồng của tháng |
| `s4vp_roster` | Lịch ca hiệu lực trong khoảng ngày (tối đa 62 ngày) |
| `s4vp_setup_status` | Tình trạng thiết lập: mục nào đủ, mục nào thiếu |

### 25.4 Công cụ ghi

| Công cụ | Làm được | Giới hạn |
| --- | --- | --- |
| `s4vp_attendance_doc_save` | Tạo đơn nghỉ, đơn làm thêm, đơn công tác, phiếu ngoại lệ ở trạng thái Tạm giữ | Chưa gửi duyệt; kỳ công đã khóa thì từ chối |
| `s4vp_attendance_doc_action` | Gửi duyệt, duyệt, từ chối (bắt buộc lý do), hủy chứng từ công | Người duyệt không được là nhân viên trên chứng từ |
| `s4vp_payroll_action` | Tính (luôn chạy nền), gửi duyệt, duyệt cấp đang chờ, từ chối, giữ, bỏ giữ, mở lại bảng lương | Mọi kiểm tra trạng thái và tách nhiệm vụ của gói vẫn áp dụng |

Mọi công cụ ghi đều theo hai nhịp: lần gọi đầu chỉ trả mô tả việc sẽ làm và không đổi gì; trợ lý hỏi lại người dùng; chỉ khi người dùng đồng ý thì gọi lại với `confirm = true`.

**Cố ý không mở cho trợ lý AI:** ghi sổ bảng lương, đảo bảng lương, lập bill cơ quan thu, đóng và mở kỳ, khóa và mở khóa công, sửa thiết lập và tham số pháp lý, nạp file chấm công, sản lượng, doanh số. Các việc này ảnh hưởng sổ cái hoặc khó hoàn lại nên vẫn làm trên màn hình.

### 25.5 Kiểm soát

| Kiểm soát | Cách thực hiện |
| --- | --- |
| Đúng người, đúng quyền | Công cụ chạy bằng vai trò của người đang kết nối, không có chế độ chạy thay. Vai trò không thuộc gói bị từ chối trước khi đọc bất kỳ dữ liệu nào; sau đó từng thao tác chịu đúng ma trận quyền của màn hình (ví dụ HR không xem phân tích chi phí, không duyệt đơn của chính mình) |
| Không có truy vấn tự do | Không công cụ nào nhận câu lệnh SuiteQL, tên bảng, tên trường hay tên thao tác tự do. Tham số chỉ là id số, ngày, tháng, giá trị trong danh sách cho trước, chuỗi có giới hạn độ dài |
| Xác nhận trước khi ghi | Thiếu `confirm = true` thì không có gì thay đổi |
| Nhật ký | Thao tác ghi thành công có dòng trong nhật ký thao tác của gói (`audit_log`) như thao tác trên màn hình |
| Dữ liệu cá nhân | Mã số thuế, CCCD, sổ BHXH, tài khoản ngân hàng không rời máy chủ, chỉ có cờ có hoặc thiếu. Log chỉ ghi tên công cụ, kết cục, thời gian; không ghi tham số, không ghi kết quả |
| Giới hạn kết quả | Danh sách dài trả theo trang (mặc định 30 dòng, tối đa 200) kèm tổng số; kết quả quá lớn bị cắt và có ghi chú |
| Tắt nhanh | Customization > Scripting > Custom Tools để tắt cả bộ hoặc từng công cụ; hoặc bỏ quyền MCP Server Connection khỏi vai trò |

Lưu ý cho doanh nghiệp: **số tiền lương có trong kết quả trả cho trợ lý AI** và đi qua nhà cung cấp trợ lý đó. Bật cho vai trò nào, dùng trợ lý nào là quyết định về bảo mật dữ liệu của từng doanh nghiệp, nên được cân nhắc trước khi gán quyền MCP Server Connection.

### 25.6 Hỏi đáp thường gặp

- **Trong ChatGPT hoặc Claude phải gọi kỹ năng tên gì?** Không có kỹ năng riêng. Sau khi kết nối NetSuite bằng vai trò của gói, các công cụ `s4vp_*` nằm sẵn trong connector NetSuite; chỉ cần hỏi bằng lời.
- **Trợ lý báo không có quyền (ACCESS_DENIED)?** Connector đang dùng vai trò không thuộc gói. Kết nối lại và chọn vai trò HR, Accountant hoặc Demo của gói.
- **Không thấy công cụ `s4vp_*`?** Kiểm tra vai trò có quyền MCP Server Connection, bộ công cụ chưa bị tắt ở trang Custom Tools, rồi ngắt và kết nối lại connector.
- **Trợ lý có ghi sổ bảng lương được không?** Không. Ghi sổ, đảo và lập bill chỉ làm trên màn hình Chạy lương.
- **Tính lương qua trợ lý mất bao lâu?** Lệnh tính luôn chạy nền; hỏi lại tình trạng bảng lương sau ít phút để xem kết quả.
- **Hệ thống khác muốn tích hợp thì dùng gì?** Dùng RESTlet của gói với OAuth 2.0, không dùng bộ công cụ AI.

**Chưa làm.** Chưa gọi thử qua connector thật trên account thử (cần một người dùng kết nối bằng vai trò của gói) (chưa xác minh). Nhật ký thao tác chưa đánh dấu riêng thao tác đến từ trợ lý AI. Cổng tự phục vụ nhân viên chưa có công cụ AI.
