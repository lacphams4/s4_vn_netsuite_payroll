# Bàn giao nội dung website - S4 Advanced Payroll cho Oracle NetSuite

Người nhận: Claude (hoặc người) dựng trang sản phẩm trên website S4 (www.s4.com.vn). Tài liệu này chỉ chỗ đọc để lấy nội dung, câu chữ đã được S4 chốt, hình dùng được, và những gì không được đưa lên. Không cần đọc mã nguồn.

Mọi đường dẫn dưới đây tính từ gốc repo `s4_vn_netsuite_payroll` (GitHub `lacphams4/s4_vn_netsuite_payroll`, nhánh `feature/ui-v2`).

## 1. Sản phẩm trong một đoạn

- Tên: **S4 Advanced Payroll** (tiếng Việt: **S4 Tính Lương Nâng Cao**). Không dùng tên nội bộ "S4 VN Payroll", "S4VP", "gói lương".
- Là phân hệ tính lương Việt Nam chạy ngay bên trong Oracle NetSuite, do S4 Consulting phát triển: chấm công và xếp ca, lương khoán sản lượng, hoa hồng, tạm ứng, bảo hiểm bắt buộc, thuế TNCN, hạch toán vào sổ cái NetSuite, báo cáo - tờ khai, phân tích chi phí lao động, cổng tự phục vụ cho nhân viên, trợ lý AI.
- Người đọc chính: giám đốc tài chính, kế toán trưởng, trưởng phòng nhân sự, người làm lương tại doanh nghiệp Việt Nam đang dùng hoặc đang cân nhắc Oracle NetSuite.

## 2. Đọc theo thứ tự này

| Thứ tự | File | Lấy gì | Ghi chú |
| --- | --- | --- | --- |
| 1 | `docs/video/BAN_GIAO_DUNG_VIDEO_202701.md`, **mục 7** | Thông điệp giá trị, 3 điểm nổi bật, câu chữ đã chốt | Nguồn quan trọng nhất về câu chữ. Mục 7.3 có các câu đã duyệt dùng lại được cho website |
| 2 | `docs/wiki/hinh-noi-bat.html` | Trang 10 màn hình tiêu biểu đã viết sẵn: tiêu đề dạng câu hỏi, đoạn trả lời, 4 câu hỏi đáp | Gần như là bản nháp trang sản phẩm; dùng làm khung |
| 3 | `docs/wiki/so-tay-quy-trinh.html` (mở bằng trình duyệt) hoặc các file nguồn `docs/wiki/wiki_source.md`, `wiki_inputs.md`, `wiki_roster.md`, `wiki_ai.md` | Mô tả chi tiết từng quy trình để viết trang tính năng, bài blog | Sổ tay 26 bài, có 36 hình. Đọc phần "Mục đích", "Thành phần và bước", "Kiểm soát" của mỗi bài |
| 4 | `docs/COMMISSION.md` (mục mục tiêu, nguồn dữ liệu, phương pháp tính) | Nội dung trang hoặc bài về hoa hồng | Bỏ qua phần tên trường, record, API |
| 5 | `docs/PUNCH_IMPORT.md` (phần đầu) | Nội dung về nạp dữ liệu máy chấm công cấu hình được | Bỏ qua phần kỹ thuật |
| 6 | `docs/AI_CONNECTOR.md` mục 1-3 và `docs/wiki/wiki_ai.md` | Nội dung về trợ lý AI | Câu chữ theo mục 4 tài liệu này, không theo phần "Tình trạng kiểm thử" |

Bản đồ sổ tay (để tìm nhanh): bài 0 bức tranh chung; 1 thiết lập; 2 hồ sơ nhân sự; 3 chấm công; 4 nghỉ phép; 5 lương khoán; 6 hoa hồng; 7 tạm ứng; 8 chạy lương; 9 bảo hiểm; 10 thuế TNCN; 11 hạch toán, phân bổ chi phí; 12 chi trả; 13 báo cáo - tờ khai; 14 phân tích chi phí; 15 cổng nhân viên; 16 kiểm soát, phân quyền; 17-18 chu kỳ tháng, năm; 19 thuật ngữ; 21 máy chấm công; 22 sản lượng; 23 doanh số; 24 xếp ca; 25 trợ lý AI.

## 3. Hình ảnh dùng được

- Thư mục `docs/wiki/img/` (36 file `.webp`, 1516 px ngang): chụp trên dữ liệu minh họa "Công ty TNHH Thương mại Sao Mai Demo"; tên người, số tiền là giả lập; cột mã số thuế, CCCD, số sổ BHXH đã làm mờ.
- 10 hình đã chọn cho website: xem `docs/wiki/hinh-noi-bat.html` (home, attendance, roster, employee-card, run-overview, run-checks, run-journal, commission, analytics, reports-hub).
- Mỗi hình dùng trên website cần có chú thích ghi "dữ liệu minh họa".
- Không dùng hình có thanh menu NetSuite với tên người dùng thật (các hình trong `img/` đã cắt bỏ thanh này).
- Video demo đang được dựng riêng; khi có link, nhúng vào trang sản phẩm.

## 4. Câu chữ đã chốt (S4 duyệt ngày 13/11/2026)

### 4.1 Ba giá trị khi chạy bên trong NetSuite

1. **Lương hoa hồng, lương sản lượng, lương thưởng theo KPI lấy dữ liệu trực tiếp từ các phân hệ khác của Oracle NetSuite: chính xác, liền mạch, giảm sai sót.** (nhấn mạnh nhất)
   - Hoa hồng: doanh số lấy từ chứng từ bán hàng trên NetSuite, từ đơn bán hàng hoặc hóa đơn, tùy mô hình và yêu cầu từng doanh nghiệp; cửa hàng bán trên hệ thống khác như DMS thì nạp file.
   - Lương sản lượng: lấy trực tiếp từ phân hệ quản lý sản xuất của NetSuite (phiếu hoàn thành lệnh sản xuất, phiếu lắp ráp thành phẩm, phiếu giao hàng).
   - KPI: lấy dữ liệu trực tiếp từ NetSuite, nguồn và cách tính được S4 cấu hình, tùy chỉnh linh hoạt theo yêu cầu từng doanh nghiệp.
   - Bảng lương ghi sổ thành một bút toán trên sổ cái NetSuite, chi tiết theo tài khoản, phòng ban, địa điểm, khối, dự án; đối chiếu được với sổ cái.
2. **Chi phí nhân công trở thành số quản trị:** tách chi phí lao động trong giá vốn và chi phí hoạt động, theo dự án, theo khối, giải thích nguyên nhân tăng giảm.
3. **Kiểm soát và phân quyền chung với NetSuite:** vai trò, duyệt, nhật ký, khóa công, cảnh báo trước khi duyệt, mỗi con số có diễn giải.

### 4.2 Ba điểm nổi bật của phân hệ do S4 phát triển

1. **Linh hoạt, tùy chỉnh sâu theo đặc thù doanh nghiệp:** quy tắc thu nhập, kế hoạch hoa hồng, KPI, bảng đơn giá khoán, chế độ ca, nguồn dữ liệu (NetSuite, máy chấm công, DMS, Excel) cấu hình theo từng doanh nghiệp; gói thiết lập sẵn theo ngành; tham số pháp lý có ngày hiệu lực.
2. **Cổng tự phục vụ cho nhân viên:** xem phiếu lương, phép, gửi đơn trên điện thoại bằng quyền Employee Center của NetSuite, **không cần license người dùng đầy đủ** cho từng nhân viên.
3. **Tích hợp trợ lý AI cá nhân như Claude, ChatGPT, Copilot:** người làm lương hỏi và thao tác bằng lời, vẫn đúng phân quyền.

### 4.3 Câu không được dùng

- "Miễn phí license", "không phát sinh license NetSuite" (đúng là: không cần license người dùng đầy đủ; Employee Center là loại license nhân viên riêng). Không nêu giá license.
- Số liệu so sánh không có căn cứ: "nhanh gấp N lần", "tiết kiệm X% chi phí", "giảm X giờ mỗi tháng".
- Tên khách hàng, kết quả dự án, case study, lời chứng thực: không có, không được tạo ra.
- "Đạt chuẩn", "được Oracle chứng nhận", "SuiteApp trên SuiteApp Marketplace": chưa có căn cứ, không dùng.
- Không nói về tính năng chưa có hay đang phát triển; không nhắc lỗi, backlog.

## 5. Không được đưa lên website

- `docs/BACKLOG.md`, `docs/KIEM_THU.md`, `docs/DOI_CHIEU_DAC_TA.md`, `docs/ARCHITECTURE.md`, `docs/UI_V2.md`, `docs/SHIFT_CREW_SPEC.md`, `docs/design/`: tài liệu nội bộ.
- Mục "Chưa làm", "chưa xác minh" trong các bài sổ tay, bài 20 "Danh sách điểm chưa làm hoặc chưa chắc".
- Mã account NetSuite (td2937310), mã script, tên record, đường dẫn kỹ thuật, tên nhân viên S4.
- Nội dung so sánh với sản phẩm Acumatica của S4 (ghi chú "tương đương S4 eSuite Payroll for Acumatica" trong README là thông tin nội bộ), trừ khi S4 yêu cầu.

## 6. Chuẩn nội dung website của S4

- Tiếng Việt mặc định; giọng chuyên nghiệp, chính xác, hướng doanh nghiệp; không cường điệu.
- Dùng gạch ngắn (-), không dùng gạch dài.
- Mỗi trang hoặc bài: SEO Title dưới 60 ký tự đặt đầu; Meta Description dưới 160 ký tự; trả lời câu hỏi chính trong 2-4 câu đầu; tiêu đề dạng câu hỏi theo ý định tìm kiếm, trả lời ngay sau tiêu đề; đoạn văn tiếng Việt ưu tiên dài trên 50 chữ khi phù hợp; 3-5 câu hỏi đáp cuối trang (dạng phù hợp FAQ structured data); không dùng gạch đầu dòng trang trí bằng biểu tượng.
- Ưu tiên định nghĩa, so sánh, hướng dẫn triển khai thực tế, checklist; có bối cảnh doanh nghiệp Việt Nam (BHXH, thuế TNCN, tờ khai 05/KK-TNCN, D02-LT, lương khoán, ca kíp).
- Thông tin về tính năng, phiên bản, license, tích hợp của Oracle NetSuite phải kiểm tra với tài liệu Oracle trước khi đăng.

## 7. Gợi ý cấu trúc trang

- Trang sản phẩm chính: S4 Advanced Payroll cho Oracle NetSuite (khung theo `docs/wiki/hinh-noi-bat.html`, thêm khối 3 giá trị và 3 điểm nổi bật ở mục 4).
- Trang hoặc bài theo chủ đề (mỗi bài lấy từ bài sổ tay tương ứng): chấm công máy và xếp ca ca kíp (bài 3, 21, 24); lương khoán sản lượng từ phân hệ sản xuất NetSuite (bài 5, 22); hoa hồng và KPI kinh doanh (bài 6, 23); bảo hiểm bắt buộc và thuế TNCN, tờ khai (bài 9, 10, 13); hạch toán lương và phân tích chi phí lao động (bài 11, 14); cổng nhân viên (bài 15); trợ lý AI cho người làm lương (bài 25).
- Mỗi trang có lời kêu gọi liên hệ S4 để xem demo trên dữ liệu của doanh nghiệp.

Đầu ra: bản nháp nội dung (HTML hoặc Markdown theo yêu cầu của S4) gửi S4 duyệt trước khi đăng. Không đăng trực tiếp lên website khi chưa được duyệt.
