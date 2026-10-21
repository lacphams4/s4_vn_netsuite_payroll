# S4 VN Payroll cho Oracle NetSuite

Phân hệ lương Việt Nam cho Oracle NetSuite (SuiteCloud Development Framework, dạng Account Customization Project), bản chuyển giao của S4 eSuite Payroll for Acumatica (gói S4VNPayroll). Cùng logic tính toán đến từng đồng, cùng phạm vi chức năng và quy trình để một đội bảo trì được cả hai bản.

Phạm vi: lương tháng, tuần, nửa tháng theo quy tắc thu nhập; BHXH, BHYT, BHTN, BHTNLĐ, KPCĐ, đoàn phí; thuế TNCN lũy tiến, khấu trừ 10%, không cư trú; gộp tháng tính thuế khi trả nhiều lần; OT, làm đêm; tạm ứng và cấn trừ; trích trước lương tháng 13; trả phép khi nghỉ việc; chấm công theo chứng từ ngoại lệ, phép năm; hạch toán Journal Entry, bill cơ quan thu, file chi lương ngân hàng; phiếu lương, bảng thanh toán, quyết toán CTV; bảng BH và D02-LT, 05/KK-TNCN, dữ liệu quyết toán năm.

**Trạng thái 0.1.0 (21/10/2026):** lõi đạt toàn bộ ca vàng của đặc tả (814 test); lớp NetSuite đã chạy thử trên td2937310 subsidiary 13. Chi tiết: [docs/KIEM_THU.md](docs/KIEM_THU.md), mức độ hoàn thành theo từng màn hình: [docs/DOI_CHIEU_DAC_TA.md](docs/DOI_CHIEU_DAC_TA.md).

## Tài liệu

- Kiến trúc, mô hình dữ liệu, ánh xạ Acumatica - NetSuite, lộ trình: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Đối chiếu đặc tả, khác biệt đã chấp nhận: [docs/DOI_CHIEU_DAC_TA.md](docs/DOI_CHIEU_DAC_TA.md)
- Báo cáo kiểm thử: [docs/KIEM_THU.md](docs/KIEM_THU.md)
- Hướng dẫn kiểm tra trên account và vận hành: [docs/HUONG_DAN.md](docs/HUONG_DAN.md)

## Cấu trúc

```
src/FileCabinet/SuiteScripts/com.s4.vnpayroll/
  core/       lõi tính toán thuần (không gọi module N/), test Jest
  lib/        decimal.js (MIT)
  api/        lớp NetSuite: đọc ghi record, thiết lập, bảng lương, chấm công, báo cáo
  scripts/    RESTlet, Map/Reduce, Suitelet, User Event
  templates/  mẫu in PDF
src/Objects/  custom list, record, role, script, SPA, menu
spa/payroll/  mã nguồn màn hình "Lương VN" (UIF)
tools/        schema.mjs (mô hình dữ liệu), gen_objects.mjs, build_spa.mjs, deploy_two_pass.py
tests/core/   ca vàng của đặc tả
```

## Phát triển

```bash
npm install
npm test
```

Sửa mô hình dữ liệu ở `tools/schema.mjs` rồi sinh lại đối tượng:

```bash
npm run gen:objects
```

Deploy (Java 17+, SuiteCloud CLI, `suitecloud account:setup` do người dùng tự chạy; `project.json` không đưa vào repo):

```bash
npm run deploy
```

Khi thêm custom record mới, deploy hai bước để tránh lỗi tham chiếu vòng giữa role và record:

```bash
python tools/deploy_two_pass.py
```

Bản production: không deploy `api/TestData.js` (tạo dữ liệu test) - xem docs/HUONG_DAN.md.
