# Dùng S4 Advanced Payroll qua trợ lý AI (NetSuite AI Connector - MCP)

Người dùng kết nối Claude, ChatGPT hoặc trợ lý AI khác với NetSuite qua NetSuite AI Connector Service (MCP) sẽ thấy thêm 20 công cụ `s4vp_*` của gói, và hỏi - làm việc với phân hệ lương bằng lời.

## 1. Vì sao là Custom Tool, không phải RESTlet

Connector MCP của NetSuite không gọi được RESTlet. Nó chỉ thấy các công cụ chuẩn của NetSuite (SuiteQL, record, report) và các bộ công cụ tùy biến (script loại Custom Tool, đối tượng SDF `custtoolset_*`). Vì vậy gói có hai cửa vào trên cùng một lớp nghiệp vụ:

| Cửa vào | Dùng cho | File |
|---|---|---|
| RESTlet `customscript_s4vp_rl_api` | Màn hình SPA; hệ thống ngoài tích hợp bằng OAuth 2.0 | `scripts/s4vp_rl_api.js` |
| Toolset `custtoolset_s4vp_payroll` | Trợ lý AI qua MCP | `scripts/s4vp_ct_payroll.js` + `s4vp_ct_payroll_schema.json` |

Cả hai gọi `api/Dispatch.js` (điều phối, ma trận quyền theo role, nhật ký thao tác). Bộ công cụ AI đi thêm qua `api/AiTools.js`: kiểm tra kiểu tham số, yêu cầu xác nhận trước khi ghi, cắt gọn kết quả.

## 2. Danh sách công cụ

Đọc (17): `s4vp_context` (bắt đầu ở đây: công ty con, nhóm lương, kỳ), `s4vp_home`, `s4vp_payroll_runs`, `s4vp_payroll_run`, `s4vp_payroll_employee`, `s4vp_payroll_checks`, `s4vp_payroll_journal`, `s4vp_attendance_month`, `s4vp_attendance_employee`, `s4vp_attendance_docs`, `s4vp_leave_balances`, `s4vp_employees`, `s4vp_employee`, `s4vp_labor_cost`, `s4vp_commission`, `s4vp_roster`, `s4vp_setup_status`.

Ghi (3, đều cần `confirm = true`):
- `s4vp_attendance_doc_save`: tạo đơn nghỉ, đơn OT, đơn công tác, phiếu ngoại lệ ở trạng thái Tạm giữ.
- `s4vp_attendance_doc_action`: gửi duyệt, duyệt, từ chối, hủy chứng từ công.
- `s4vp_payroll_action`: tính (luôn chạy nền), gửi duyệt, duyệt, từ chối, giữ, bỏ giữ, mở lại bảng lương.

Cố ý không mở cho AI: ghi sổ, đảo bảng lương, lập bill cơ quan thu, đóng - mở kỳ, khóa - mở khóa công, sửa thiết lập và tham số pháp lý, nạp file. Các việc này làm trên màn hình.

## 3. Kiểm soát

- Script chạy bằng role của người đang kết nối, không có run-as. Role phải là role của gói (S4VP Payroll HR, S4VP Payroll Accountant, S4VP Demo); role khác bị từ chối (`ACCESS_DENIED`) trước khi đọc bất kỳ dữ liệu nào. Sau đó từng action chịu đúng ma trận quyền như trên màn hình (ví dụ HR không xem phân tích chi phí).
- Không công cụ nào nhận SuiteQL, tên bảng, tên trường hay tên action tự do. Tham số là id số, ngày, tháng, enum, chuỗi có giới hạn độ dài.
- Thao tác ghi thiếu `confirm = true` chỉ trả mô tả việc sẽ làm, không đổi gì. Thao tác ghi thành công có dòng trong nhật ký thao tác của gói.
- Mã số thuế, CCCD, sổ BHXH, tài khoản ngân hàng không rời máy chủ (chỉ có cờ có / thiếu). Số tiền lương thì có trong kết quả: bật cho role nào là quyết định của doanh nghiệp.
- Log chỉ ghi tên công cụ, kết cục, thời gian.
- Tắt cả bộ: Customization > Scripting > Custom Tools, hoặc bỏ quyền MCP Server Connection khỏi role.

## 4. Thiết lập cho một người dùng

1. Account bật tính năng AI Connector Service và OAuth 2.0.
2. Gán cho người dùng một role của gói. Ba role HR, Accountant, Demo đã có sẵn quyền `MCP Server Connection` và `Log in using OAuth 2.0 Access Tokens`.
3. Trong Claude hoặc ChatGPT, kết nối NetSuite và chọn đúng role đó (role Administrator không dùng được với connector).

## 5. Sửa hoặc thêm công cụ

Sửa bảng `TOOLS` trong `api/AiTools.js`, rồi chạy:

```bash
node tools/gen_ai_schema.mjs
```

Test `tests/api/aitools.test.js` báo lỗi nếu schema chưa sinh lại, nếu tên hàm lệch schema, hoặc nếu có công cụ chạm tới action bị cấm.

## 6. Tình trạng kiểm thử

- Test đơn vị: qua. Validate và deploy lên td2937310: qua.
- CHƯA gọi thử qua connector thật: phiên connector hiện dùng role `customrole_s4_mcp_ai_access` (không phải role của gói), nên cần một người dùng kết nối lại bằng role của gói để thử.
