# Kiến trúc và kế hoạch phát triển S4 VN Payroll cho NetSuite

Tài liệu thiết kế của bản NetSuite, viết theo đặc tả chuyển giao "Đặc tả chuyển giao S4 eSuite Payroll - từ Acumatica sang Oracle NetSuite" (phiên bản 20/10/2026, sau đây gọi là "đặc tả"). Đặc tả là file Word nội bộ, không đưa vào repo; các mục được dẫn theo số mục của đặc tả.

## 1. Mục tiêu và nguyên tắc

Bản NetSuite phải giống bản Acumatica (gói S4VNPayroll) ở ba điểm để một đội bảo trì được cả hai (đặc tả 0.1, 5.1):

- **Logic tính toán**: cùng đầu vào ra cùng kết quả đến từng đồng, cùng điểm làm tròn và thứ tự tính.
- **Phạm vi chức năng**: cùng trạng thái chứng từ, cùng kiểm tra, cùng mẫu báo cáo.
- **Quy trình**: cùng bước, vai trò, điểm duyệt và điểm khóa.

Các nguyên tắc đã áp dụng:

1. **Lõi trước, lớp ERP sau** (đặc tả 0.6, 5.2.1). Toàn bộ công thức nằm trong `core/` (SuiteScript 2.1 thuần, không gọi module `N/`), giữ tên lớp theo lõi C# `S4.VP.Core` (PaycheckCalculator, InsuranceCalculator, PitCalculator, TaxMonthAggregator, EarningRuleEngine, TeamSplitCalculator, ProjectCostAllocator, ShiftMatcher, LeaveAccrualCalculator...). Lớp `api/` chỉ đọc dữ liệu NetSuite, gọi lõi, ghi kết quả.
2. **Số thập phân chính xác**: mọi phép tính tiền, tỷ lệ, ngày công đi qua `decimal.js` (MIT, nhúng ở `lib/decimal.js`). `Money.round` làm tròn đến đồng, nửa đơn vị ra xa số 0 (đặc tả 2.1).
3. **Tham số pháp lý là dữ liệu có ngày hiệu lực**, không viết cứng: ba bảng tham số đơn, biểu thuế, khoản trích; nạp bằng "Nạp mặc định VN" (Load VN Defaults), chạy lại an toàn.
4. **Giữ nguyên mã** trạng thái, danh mục, loại (H, B, C, P, A, J, R, V; LUONG, ANCA, OT150...; mã tham số) để đối chiếu dữ liệu giữa hai hệ thống. Custom list giữ mã trong script id giá trị (`val_s4vp_<list>_<mã>`), logic không dựa vào internal id.
5. **Không suy diễn quy định**: ba giá trị từ 01/07/2026 chưa đối chiếu văn bản gốc (mức tham chiếu 2.530.000, ngưỡng khấu trừ 10% 5.000.000, trần ăn ca 1.200.000) mang cờ `verified = F`, màn hình luôn cảnh báo.
6. **Không dữ liệu cá nhân thật khi thử**: dữ liệu thử do chức năng VP509000 tạo, tên "S4VP TEST ...".

## 2. Cấu trúc repo

```
src/                                         SDF Account Customization Project (ACP)
  FileCabinet/SuiteScripts/com.s4.vnpayroll/
    core/        lõi thuần (31 module), test Jest
    lib/         decimal.js 10.6.0 (MIT)
    api/         lớp NetSuite: Store (đọc ghi record theo Schema), Settings, Defaults, Periods, Payroll,
                 Profiles, Advances, Reports, Attendance, TestData; Schema.js sinh tự động
    scripts/     RESTlet, Map/Reduce, Suitelet (mở màn hình, in PDF), User Event
    templates/   mẫu in Advanced PDF (FreeMarker, BFO)
    spa/         SPA đã build (sinh từ spa/)
  Objects/       custom list, custom record, role, script, SPA, menu (phần lớn sinh từ tools/schema.mjs)
spa/payroll/     mã nguồn SPA (UIF, JSX)
tools/           schema.mjs (mô hình dữ liệu), gen_objects.mjs, build_spa.mjs
tests/core/      Jest, ca vàng của đặc tả
docs/            tài liệu
```

Tiền tố `s4vp` riêng, thư mục `com.s4.vnpayroll` riêng: chạy song song với gói kế toán TT99 (`s4vn`) và gói cũ trên cùng account.

## 3. Mô hình dữ liệu

Nguồn duy nhất là `tools/schema.mjs`; `npm run gen:objects` sinh XML custom list, custom record, role và `api/Schema.js` (bảng tra tên logic -> script id cho lớp api). Tương đương `tools/gen/gendac.py` của bản Acumatica.

| Nhóm | Record (customrecord_s4vp_*) | Thực thể Acumatica |
| --- | --- | --- |
| Thiết lập | setup, company, paygroup | VPSetup, VPCompanySettings, VPPayGroup |
| Tham số pháp lý | param, pit_bracket, ins_comp, holiday | VPStatutoryParameter, VPPitBracket, VPInsuranceComponent, VPHoliday |
| Danh mục | earning_type, earning_rule + rule_cond, benefit_pkg + benefit_line, leave_type, leave_policy, att_rule, att_symbol | VPEarningType, VPEarningRule(+Condition), VPBenefitPackage(+Line), VPLeaveType, VPLeavePolicy, VPAttendanceRule, VPAttendanceSymbol |
| Hồ sơ | employee + compensation + dependent | VPEmployee, VPEmployeeCompensation, VPEmployeeDependent |
| Kỳ, công | period, attendance | VPPayPeriod, VPAttendanceSummary |
| Chứng từ công, phép | leave_request, ot_request, business_trip, att_exception, leave_balance, leave_tran | VPLeaveRequest, VPOvertimeRequest, VPBusinessTrip, VPAttendanceException, VPLeaveBalance, VPLeaveTransaction |
| Bảng lương | batch, batch_emp, batch_input | VPPayrollBatch, VPPayrollEmployee, VPPayrollEarning (nhập tay) + VPPayrollDeduction |
| Tạm ứng | advance | VPAdvance |

Quyết định lưu trữ (đặc tả 5.4 "Số lượng record"): mỗi nhân viên trên bảng lương là một record `batch_emp` mang các số tổng dùng cho báo cáo, tìm kiếm; chi tiết dòng thu nhập, BH theo khoản, cấn trừ tạm ứng, phân bổ chi phí lưu JSON ở trường `detail`. 2.000 nhân viên chỉ sinh 2.000 record mỗi kỳ thay vì hàng chục nghìn. Dòng nhập tay (thu nhập nguồn M, khấu trừ sau thuế) là record riêng `batch_input` để người dùng sửa.

Hồ sơ lương là custom record 1-1 với Employee (đặc tả 5.2.2 phương án a), tách quyền xem lương khỏi bản ghi nhân viên chuẩn.

## 4. Ánh xạ khái niệm

| Acumatica | NetSuite (đã chọn) | Ghi chú |
| --- | --- | --- |
| Company (Organization) | Subsidiary | Thiết lập công ty theo subsidiary |
| Branch | Location (dòng JE) | Chi nhánh trong cùng công ty; chưa làm bút toán liên công ty |
| Subaccount / cost center | Department | |
| Work center | Class | Có thể đổi sang custom segment khi khách cần |
| Project / Task | Customer:Project (entity của dòng JE) | Chưa dùng Project Task |
| Cost code | (chưa ánh xạ) | Trường trống trên dòng phân bổ |
| GL Batch | Journal Entry | Một JE cho mỗi bảng lương; tự duyệt khi bật "Tự duyệt bút toán" |
| AP Bill cơ quan thu | Vendor Bill | Một bill mỗi cơ quan thu |
| Approval Map | Duyệt một cấp trong gói (RequirePayrollApproval) | Duyệt nhiều cấp bằng SuiteFlow: giai đoạn sau |
| Numbering sequence | Auto numbering custom record (BL, TU, NP, OT, CT, NL) | |
| Time Activities | (chưa nối) | Giờ OT / CTV hiện nhập tay trên bảng lương; nối Time Bill ở giai đoạn sau |

## 5. Xử lý (script)

| Quy trình | Thành phần |
| --- | --- |
| Màn hình chính | SPA `custspa_s4vp_payroll` (/spa/s4vp-payroll), menu "Lương VN" -> Suitelet `customscript_s4vp_sl_open` |
| Dữ liệu, thao tác | RESTlet `customscript_s4vp_rl_api` (mọi thao tác kiểm tra trạng thái và quyền phía máy chủ; HR không ghi sổ, không đảo, không lập bill) |
| Tính lương lớn | Map/Reduce `customscript_s4vp_mr_calculate` (lô 50 dòng), RESTlet tự chuyển khi bảng trên 120 người |
| In | Suitelet `customscript_s4vp_sl_print`: phiếu lương (VP641000), bảng thanh toán (VP643000), quyết toán CTV (VP644000) |
| Kiểm soát | User Event dòng nhập tay (khóa khi đã duyệt, đưa bảng về "chưa tính"), User Event chứng từ công |

Toàn vẹn khi ghi sổ (đặc tả 5.4): NetSuite không có giao dịch nhiều record. Ghi sổ kiểm tra mọi điều kiện trước, tạo JE, lưu id JE lên bảng lương ngay, rồi mới cập nhật tạm ứng; bảng đã có JE thì không tạo JE thứ hai. Dấu dữ liệu đầu vào (`calc_stamp`) được kiểm khi duyệt và ghi sổ: sửa dòng nhập, công, giảm trừ sau khi tính thì phải tính lại.

## 6. Lộ trình

| Giai đoạn | Nội dung | Trạng thái 21/10/2026 |
| --- | --- | --- |
| 0 | Lõi tính toán và toàn bộ ca vàng của đặc tả | Xong (xem docs/KIEM_THU.md) |
| 1 | Thiết lập, tham số, hồ sơ, kỳ lương, bảng lương tháng (nạp, tính, duyệt, ghi sổ, đảo), tạm ứng, bill cơ quan thu, file ngân hàng, bản in, SPA | Xong, đã chạy trên td2937310 sub 13 |
| 2 | Chứng từ công (nghỉ, OT, công tác, ngoại lệ), lập / khóa bảng công, sổ phép, cấp phép năm; báo cáo BH + D02-LT, 05/KK-TNCN, quyết toán năm, chi phí theo tài khoản | API xong, đang nối giao diện (xem docs/DOI_CHIEU_DAC_TA.md) |
| 3 | Chấm công máy (lượt chấm, phân ca, xử lý chấm công), bảng công ký hiệu, Time Bill -> giờ công tính lương (VP312000), phiếu sản lượng và chia tổ, bảng tỷ lệ phân bổ có phiên bản, giấy phép lao động | Lõi đã có và đạt ca vàng; chưa có record, màn hình |
| 4 | Tự phục vụ (phiếu lương của tôi, đơn của tôi), duyệt nhiều cấp SuiteFlow, phân quyền theo công ty, gói ngành, dashboard, bản dịch tiếng Anh nhãn record | Chưa làm |

## 7. Rủi ro và việc cần chủ dự án / KTT quyết

1. Ba giá trị pháp lý từ 01/07/2026 chưa đối chiếu văn bản gốc (đặc tả 6.1 #1).
2. Account td2937310 bắt buộc Location trên Vendor Bill: gói dùng "Địa điểm mặc định cho chứng từ" trên thiết lập công ty.
3. Account bật duyệt bút toán: thiết lập "Tự duyệt bút toán, bill do phân hệ lương tạo" (mặc định bật, tương đương AutoReleaseGL). Tắt thì JE, bill chờ người có quyền duyệt.
4. Ánh xạ Branch -> Location, work center -> Class cần chốt với từng khách.
5. Nhãn record, list đang là tiếng Việt (thị trường chính); bản tiếng Anh cho khách FDI cần Translation Collection (SPA, bản in đã song ngữ).
