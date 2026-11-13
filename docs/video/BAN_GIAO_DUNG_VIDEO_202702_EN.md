# Bàn giao dựng video và lồng tiếng - S4 Advanced Payroll bản tiếng Anh, kỳ SAOMAI-202702

Người nhận: Claude (hoặc người) phụ trách dựng, cắt, lồng tiếng video demo **bản tiếng Anh**. Tài liệu này tự đủ để làm việc, không cần đọc mã nguồn. Tài liệu viết bằng tiếng Việt; lời thoại và phụ đề là tiếng Anh.

## 1. Bối cảnh

- Sản phẩm: **S4 Advanced Payroll**, phân hệ tính lương Việt Nam chạy trong Oracle NetSuite, do S4 Consulting (www.s4.com.vn) phát triển.
- Dữ liệu: doanh nghiệp giả lập "Công ty TNHH Thương mại Sao Mai Demo", 114 nhân viên, có xưởng gia công chạy ba kíp. Mọi tên người, số tiền, mã số là giả lập. Tên người, phòng ban, tên khoản lương trên hình là tiếng Việt (dữ liệu demo), chấp nhận; giao diện là tiếng Anh.
- Kỳ quay: **SAOMAI-202702** (trên hình là tháng 02/2027 do account demo dời ngày). Lời thoại không nêu tháng cụ thể, nói "this pay period".
- Bản ghi do người dùng tự ghi màn hình ngày 14/11/2026, Claude điều khiển trình duyệt. Hỏi người dùng đường dẫn file. Có thể gồm hai phần: phần chính (cảnh 1-12) và phần cổng nhân viên (cảnh 13, đăng nhập bằng nhân viên E1069, khung điện thoại).
- Toàn bộ quay bằng vai trò **"S4 Advanced Payroll - Demo"** (góc phải trên), không đổi vai trò giữa chừng.
- Thời lượng mục tiêu sau dựng: **12-15 phút**. Mọi đoạn chờ hệ thống chạy đều cắt.
- Kịch bản gốc: `docs/video/s4-advanced-payroll_sx_kich_ban_quay.md` (mục 3 có lời thoại EN từng cảnh, mục 4 là ghi chú bản tiếng Anh). Bàn giao bản tiếng Việt để tham khảo cách làm: `docs/video/BAN_GIAO_DUNG_VIDEO_202701.md`.

## 2. Quy tắc dựng

1. Cắt mọi đoạn chờ (thanh tiến độ, "Working...", "Writing round...", "Loading..."). Giữ 1-2 giây trạng thái đang xử lý rồi nhảy tới kết quả.
2. Cắt các đoạn dò tìm, đoạn lỗi, đoạn làm ngoài kịch bản (mục 5).
3. Không để lộ: trang đăng nhập, mật khẩu, menu đổi vai trò, tab trình duyệt trắng.
4. Phóng to vào vùng số liệu khi lời thoại nhắc tới con số.
5. Lời thoại tiếng Anh, giọng chuyên nghiệp, rõ, không cường điệu. Không nói điều màn hình không chứng minh được.
6. Thuật ngữ thống nhất: "pay period", "payroll batch", "attendance", "lock attendance", "post / release", "journal entry", "piece rate / piecework pay", "commission", "personal income tax (PIT)", "statutory insurance", "shift roster", "shift scheme".
7. Số tiền đọc theo kiểu tiếng Anh, làm tròn khi đọc: "about 1.59 billion dong", "10,702,500 dong". Trên hình SPA dùng dấu chấm phân cách (1.592.133.576), cổng nhân viên dùng dấu phẩy; không cần sửa hình.

## 3. Thứ tự cảnh khi dựng

Đúng thứ tự quay: 0 - 1 - 2 - 3 - 4 - 5 - 6 - (hoa hồng, xem mục 5) - 7 - 8 - 9 - 10 - 11 - 12 - 13 - Kết.

Ước lượng sau dựng: khoảng 13-14 phút.

## 4. Danh sách cảnh, dấu hiệu trên hình, lời thoại

| # | Cảnh | Dấu hiệu trên hình | Giữ lại | Lời thoại (EN) | Thời lượng |
| --- | --- | --- | --- | --- | --- |
| 0 | Mở đầu | Chưa quay: thẻ chữ trên nền, hoặc Trang chủ làm nền mờ | Thẻ tiêu đề "S4 Advanced Payroll on Oracle NetSuite" | At month end, time clock files, team output sheets and store sales sit in three different places, and someone retypes them into a spreadsheet before payroll can start. This video runs one full payroll cycle for a factory inside NetSuite, from the time clock to the general ledger. | 0:30 |
| 1 | Home | Màn "Today", thẻ "Current period SAOMAI-202702", "Runs in progress", "To do (2)", "Coming due", chip "Completed 7"; dòng phụ "role HR, payroll and accounting" | Lướt 4 thẻ số, To do, Coming due, chip Completed 7 | This is Sao Mai, 114 employees, with a workshop running three shifts. The home page shows the pay period in progress, what has to be done first, and each deadline. Seven periods are already closed; today we run one full payroll cycle for the plant. | 0:45 |
| 2 | Shift roster | More > Shift roster; chọn 31 days từ 01/02/2027; hộp "Shift schemes" 3 dòng KIP-A, KIP-B, KIP-C mẫu XOAY3, ngày neo lệch một tuần; lọc "Xưởng gia công"; dòng "Headcount per shift" cuối lưới; bấm Next sang 04/03/2027, tìm E1069, bút "C2", ô 08/03, "Save 1 cells" -> "Saved: 1 new cells"; bút "Per scheme", cùng ô, Save -> "1 back to the scheme" | Toàn bộ, bỏ đoạn rê chuột thừa | The whole workshop roster is three lines: one rotation pattern per crew, one week apart. Nobody fills in cells one by one. The grid shows who works which shift and the headcount per shift, and handles exceptions: change one day, then go back to the scheme. | 1:15 |
| 3 | Import time clock | Attendance kỳ SAOMAI-202702; "Import time clock"; nguồn "ZK-XUONG - Máy ZKTeco xưởng Bình Dương"; file ZK-XUONG_2027-01.dat 1.409 lines; Preview: All 1.409, New 1.331, Duplicate 0, Error 0, Unmapped 78; khung "Unmapped IDs (2)": 53 -> E1077 Ngô Tuấn Hải, 54 -> E1092 Lê Hữu Lộc; "Save mapping (2)"; preview lại New 1.409, Unmapped 0; "Write 1.409 new punches"; "Writing finished 1.409 / 1.409" | Từ khi hộp nạp mở đến "Writing finished". Cắt các vòng ghi (khoảng 3 phút) | The file comes straight from the fingerprint device, no spreadsheet in between. People are matched through a mapping table. Two workers re-enrolled their fingerprints, so two new IDs are unassigned; we assign them here and commit. Re-importing the same file never creates duplicates. | 1:30 |
| 4 | Process punches, approve exceptions | Nút "Process punches for period SAOMAI-202702" trong hộp nạp; "Process punches is running in the background"; kết quả "Punches processed. Proposed on hold... exceptions: 82, overtime requests: 61"; khung "Exceptions to resolve"; (a) tìm "late", View E1055 Nguyễn Thanh Duy 02/02: ca K1 06:00-14:00, chấm 06:17 và 14:04, trễ 17 phút; Submit, Approve -> công 0,75; (b) tìm "Saturday", View E1061 Trần Thanh Quang 06/02: làm thêm 8,18 giờ; Submit, Approve; (c) tìm "OT000930", E1066 Dương Quốc Minh 02/02: ca HC 08:00-17:00, chấm ra 18:26, làm thêm 1,43 giờ; Submit, Approve; (d) tìm "missing": danh sách thiếu lượt chấm, không duyệt | (a), (b), (c), (d). Cắt chờ xử lý nền | The system compares punches with the roster and proposes: late arrival, early leave, missing punch, overtime. Everything is on hold. Nothing is deducted automatically; a manager reviews and approves each case, with a full approval trail. Missing punches stay open for HR to verify. | 1:45 |
| 5 | Output - team piecework | More > Output - team piecework, kỳ February 2027: 11 phiếu, 1 On hold; mở SL000106 tổ TO-CAT: bước Output (dòng công đoạn, đơn giá tra từ bảng), Members, Split; "Split pay" -> 6.637.000 cho 10 người; "Submit for approval", OK; "Approve", OK. "New entry": Team, ngày 26/02/2027, bảng đơn giá GC-CONGDOAN, tổ TO-LAPRAP; SL000115: LAP-TU-PP 17, LAP-TU-DK 8, DAU-DAY 1497, "Total amount: 10.702.500"; "Save output"; "Load members from the team" -> 15 thành viên (tổ trưởng hệ số 1,2); "Next: Split", "Split pay"; Submit, Approve -> 12 phiếu Approved, tổng 90.980.500 | Toàn bộ. Khi thấy nút "From transactions" ở góc phải trên thì phóng to (lời thoại bắt buộc mục 7.3) | The workshop pays piece rates by operation. The shop clerk enters the team's quantities; rates come from the rate table by effective date. The team amount is split by days worked times a factor, and it always adds up to the last dong. | 2:00 |
| 6 | Lock attendance | Attendance kỳ SAOMAI-202702; "Rebuild" -> "Attendance built (employees: 108)", Overtime hours 40,11; "Lock attendance", hộp "120 exceptions are still open: unapproved documents will not be counted..."; OK -> "Attendance of the period is locked", thanh bước sang "4 Hand off to payroll", nút "Go to payroll" | Rebuild (cắt chờ), hộp xác nhận, kết quả | Attendance is closed once. The system warns about open exceptions before locking; unapproved documents are simply not counted. After locking, no attendance document of the period can change, and payroll reads from here. | 0:30 |
| 7 | Run payroll | Run payroll > "New payroll batch": kỳ February 2027, "Payroll 02/2027"; "Load employees" -> "Loaded 114 employees"; "Calculate" -> "Calculated with no errors"; 4 thẻ: Net pay 1.592.133.576 (Up 2.4% from period SAOMAI-202701), Insurance payable 512.084.000, PIT payable 50.026.124, Total company cost 2.154.243.700; cột "Vs previous" | Tạo, tải, tính, 4 thẻ, cột so kỳ trước. Cắt chờ | One payroll batch for the whole company. The system loads employees, attendance, overtime, output and commission, then calculates pay, statutory insurance and personal income tax under current rules. Last period's figures sit alongside for review. | 1:15 |
| 8 | One worker in detail | Lọc E1069 Lê Thanh Sơn; tab Earnings: Lương cơ bản 7.000.000, Lương khoán 2.502.317, Phụ cấp độc hại, ca đêm xưởng 200.000, tổng 9.702.317; tab Insurance (BHXH, BHYT, BHTN, KPCĐ, tổng NLĐ 805.000); tab PIT; tab Attendance (Standard days 19, Paid work days 19, Attendance locked Yes) | Toàn bộ | Every figure is explained: base pay by days worked, piece pay from approved team entries, night-shift allowance from the night shifts in the roster. Insurance and tax show their calculation bases. | 1:30 |
| 9 | Sales commission, briefly | Lọc E1044 Ngô Công Lộc (Cửa hàng); tab Earnings: Lương cơ bản 9.400.000, Hoa hồng kinh doanh 2.624.160 | Toàn bộ, ngắn | In the same batch, sales staff earn commission. Commission is calculated in its own module from sales and collections, and flows into payroll once approved. | 0:40 |
| 10 | Allocation and journal | E1069 tab "Project allocation": Xưởng Bình Dương (Sao Mai), Khối Sản xuất, nguồn Output / Default; tab "Journal" (Whole batch BL000017): gõ "62" -> 29 dòng, 6271 và 622 theo Xưởng gia công / Xưởng Bình Dương / Khối Sản xuất; xóa ô tìm: 6421, 6411 | Toàn bộ | Labor cost lands where it is incurred: direct workers in account 622 of the workshop, the supervisor in 6271, sales in 641, administration in 642, each with department, location and division. The journal is previewed as soon as payroll is calculated. | 1:00 |
| 11 | Approve and post | "Remove hold" -> "Calculated, pending review"; "Submit for approval" (hộp "20 review items are still open..."), OK; "Approve" (hộp tương tự), OK -> "Approved, pending release"; "Release" (hộp "...creates the journal entry and offsets advances"), OK -> "Batch released", "Release journal JE2141 (posted)" | Toàn bộ, cắt chờ ghi sổ (khoảng 80 giây) | After review, approve and post. One standard NetSuite journal entry is created and linked back to the payroll batch. | 0:45 |
| 12 | Cost analysis | "Labor cost analysis" tháng 02/2027: Labor cost 2.266.852.033 (+42,8 M, +1,9% vs 01/2027); 12-month trend; "Why it changed - from 01/2027 to 02/2027" (Piecework, output pay +43,8 M); bảng phân rã Department; bấm dòng Xưởng gia công -> hộp 43 employees, cột Piecework 90.980.500; Close; chip "Cost component": Piecework 90.980.500 (+92,7%), Overtime 6.316.427 | Toàn bộ | Once posted, management sees a year of labor cost, why this month moved, how much the workshop takes, and how much of that is piece pay and overtime. | 1:00 |
| 13 | Employee portal (phone) | Khung điện thoại, "Employee portal" của Lê Thanh Sơn - E1069: Overview (Latest net pay 8,897,317, Up 2,462,317 (38.26%), biểu đồ 6 kỳ); Payslips: SAOMAI-202702 8,897,317 và SAOMAI-202701 6,435,000; mở SAOMAI-202702: "Why it differs from the previous period" (Lương khoán +2,502,317 new this period; Phụ cấp độc hại, ca đêm xưởng -40,000); cuộn: Earnings, Insurance 805,000, PIT 0 (giảm trừ 2 người phụ thuộc), Net pay 8,897,317, Work days 19/19 | Toàn bộ | Workers see their payslip on their phone, and what changed from last month: here, the new piece pay. From the roster to the general ledger, every step lives in one system. | 0:45 |
| Kết | Thẻ kết | Danh sách Run payroll có BL000017, hoặc thẻ chữ | 4-5 giây hình, rồi thẻ kết logo S4, s4.com.vn | (Lời thoại bắt buộc mục 7.3, dòng Kết) | 0:30 |

## 5. Đoạn phải cắt

| Vị trí | Nội dung | Xử lý |
| --- | --- | --- |
| Đầu bản ghi | Trang chủ NetSuite chung (portlet "What's new in the Suite"), mở trang gói, ô Subsidiary đang "Công ty TNHH S4VN TT99" rồi đổi sang Sao Mai | Cắt, bắt đầu khi Trang chủ gói hiện kỳ SAOMAI-202702 |
| Đầu cảnh 2 | Mở menu More, chỉnh số ngày và ngày bắt đầu | Giữ ngắn hoặc tua nhanh |
| Đầu cảnh 3 | Màn Attendance mở ở kỳ 202610 ("No employee belongs to the pay group"), chọn lại kỳ February 2027 | Cắt, bắt đầu từ màn kỳ SAOMAI-202702 |
| Cảnh 3 | Các vòng "Writing round 1...5" | Cắt, giữ 1-2 giây rồi nhảy tới "Writing finished" |
| Cảnh 4 | Bấm "Open document" (mở tab mới rồi đóng) | Cắt |
| Cảnh 4 | Các lần tìm "22:", "night", "Xưởng", "Overtime request" ra "No matching exception" hoặc danh sách dài | Cắt, chỉ giữ ba phiếu đã duyệt và danh sách "missing" |
| Cảnh 4 | Khung ngoại lệ hiện nhiều phiếu "No punches (absent)" ngày Monday 01/02 (ngày lễ) | Không dừng lâu, không phóng to, lời thoại không nhắc. Đây là lỗi đề xuất của hệ thống, các phiếu này không được duyệt và không vào lương |
| Cảnh 6 | Chờ Rebuild và chờ Lock (khoảng 1 phút mỗi lần) | Cắt |
| Giữa cảnh 6 và 7 | Toàn bộ phần Hoa hồng: tháng February 2027, "Import external sales" file DMS_CuaHang_2027-01.csv 441 dòng, Check, Write, Calculate (21 nhân viên, tổng 18.064.747), Approve | Cắt toàn bộ. Tùy chọn: giữ 5-8 giây màn kết quả sau Calculate (cột Quota, Attainment, Payable) để đọc lời thoại hoa hồng và KPI ở mục 7.3 |
| Cảnh 7 | Chờ Load employees (khoảng 50 giây) và Calculate (khoảng 50 giây) | Cắt |
| Cảnh 11 | Bấm "JE2141" mở ra tab trắng | Cắt. Kết cảnh ở dòng "Release journal JE2141 (posted)" |
| Trước cảnh 13 | Menu S4 Advanced Payroll > People > Employee portal; cổng nhân viên của tài khoản Lac Pham ("You do not have a payroll profile yet"); quay lại Cost analysis; đăng nhập E1069 | Cắt toàn bộ, nối cảnh 12 sang 13 bằng chuyển cảnh |

## 6. Lưu ý hình ảnh

- Thanh menu NetSuite trên cùng có tab của các gói S4 khác (S4 - Accounting Localization, S4 - AP Automation, S4 - EInvoice, S4 Localization) và hai tab tiếng Việt "Kinh doanh", "Kế toán". Nếu muốn gọn, cắt khung hình bỏ thanh menu NetSuite hoặc làm mờ nhẹ, giữ thanh tab của gói ("S4 Advanced Payroll  Home  Attendance  Run payroll...").
- Góc phải trên hiện tên người dùng và vai trò "S4 Advanced Payroll - Demo", đồng nhất cả video; có thể làm mờ tên người dùng.
- Tên khoản lương, phòng ban, tổ trên hình là tiếng Việt. Có thể thêm phụ đề nhỏ cho các dòng được nhắc: "Lương cơ bản = Base pay", "Lương khoán = Piece pay", "Phụ cấp độc hại, ca đêm xưởng = Hazard and night-shift allowance", "Hoa hồng kinh doanh = Sales commission", "Xưởng gia công = Workshop".
- Cảnh 13 quay trong khung điện thoại giả lập, nền tối hai bên; giữ nguyên hoặc cắt khung cho dọc 9:16 nếu làm bản ngắn mạng xã hội.
- Số liệu nhắc trong lời thoại phải khớp hình:

| Nội dung | Số trên hình |
| --- | --- |
| Lượt chấm xưởng | 1.409 dòng, 2 mã chưa đối chiếu (53, 54) |
| Kết quả xử lý chấm công | 82 ngoại lệ, 61 đơn làm thêm |
| Phiếu khoán mới SL000115 | 10.702.500, 15 người |
| Tổng lương khoán kỳ | 90.980.500, 12 phiếu |
| Thực lĩnh cả bảng lương | 1.592.133.576 (tăng 2,4% so với SAOMAI-202701) |
| Bảo hiểm phải nộp | 512.084.000 |
| Thuế TNCN phải nộp | 50.026.124 |
| Tổng chi phí công ty | 2.154.243.700 |
| Bảng lương, bút toán | BL000017, JE2141 |
| E1069 | Gross 9.702.317, khoán 2.502.317, thực lĩnh 8.897.317, tăng 2.462.317 (38,26%) |
| E1044 hoa hồng | 2.624.160 |
| Chi phí lao động tháng | 2.266.852.033 (+42,8 triệu, +1,9%) |

## 7. Thông điệp giá trị (quyết định của S4, bản tiếng Anh)

Dùng đúng ý ở đây. Lời thoại chỉ nói phân hệ làm được gì; không nói về tính năng chưa có hay đang phát triển. Không dùng so sánh không chứng minh được ("N times faster", "save X%").

### 7.1 Ba giá trị khi chạy bên trong NetSuite

1. **(Nhấn mạnh nhất)** Commission, piecework pay and KPI-based pay take their data directly from other Oracle NetSuite modules, so figures are accurate, seamless and less error-prone. Commission comes from NetSuite sales transactions (sales orders or invoices, depending on each company's model and requirements), credited by sales rep or sales team; output comes from manufacturing transactions; attendance days come from the attendance sheet. Payroll posts back as one journal entry with account, department, location, division and project. No exports, no re-keying, no monthly reconciliation between two systems.
2. Labor cost becomes management information, not just a payroll sheet: labor in cost of goods sold vs operating expenses, by project and division, and why it moved this month.
3. Control and permissions shared with NetSuite: the same roles, approvals and audit trail; attendance lock, payroll approval, warnings before approval, every figure explained step by step, statutory parameters with effective dates.

### 7.2 Ba điểm nổi bật của phân hệ

1. Flexible and deeply configurable to each company: earning rules, commission plans, KPIs, piece-rate tables, shift schemes and data sources (NetSuite, time clocks, DMS, Excel), with industry setup packs; S4 tailors it further to each customer's process.
2. Employee self-service: employees see payslips, leave and send requests on their phone with NetSuite Employee Center access, without a full user license for every employee. Không nói "free license" hay "no license cost", không nêu giá license.
3. Works with personal AI assistants such as Claude, ChatGPT and Copilot: payroll staff ask questions and act on the module in plain language, within their own permissions. Bản ghi không có cảnh trợ lý AI: chỉ nói trên thẻ chữ hoặc ở phần kết, không ghép với hình thao tác khác.

### 7.3 Lời thoại bắt buộc (chèn đúng cảnh)

| Cảnh | Thời điểm | Lời thoại |
| --- | --- | --- |
| 5 | Màn Output, phóng to nút "From transactions" | "Here the shop clerk keys in the team's output. Companies running NetSuite manufacturing don't need to: click From transactions, and the system reads work order completions, assembly builds or item fulfillments directly to calculate piecework pay." |
| 9 | Dòng Hoa hồng kinh doanh của E1044 (hoặc màn kết quả hoa hồng nếu giữ ở mục 5) | "Commission is based directly on NetSuite sales transactions, sales orders or invoices depending on each company's model, credited to the sales rep or sales team on the transaction. Stores selling on another system, such as a DMS, simply import a file, as in this example." |
| 9 | Chỉ khi giữ màn kết quả hoa hồng có cột Attainment | "KPI-based pay also takes its data directly from NetSuite, with no spreadsheet in between. Here it is attainment against the sales quota. KPI sources and formulas are configured by S4 to fit each company." |
| 13 | Mở đầu cảnh cổng nhân viên | "Employees check payslips, leave and requests on their phone, with NetSuite Employee Center access, without a full user license for every employee." |
| Trước Kết | Thẻ chữ ba điểm nổi bật | "S4 Advanced Payroll adapts to each company's way of working, gives every employee self-service, and works with AI assistants such as Claude, ChatGPT and Copilot, so payroll staff can ask and act in plain language." |
| Kết | Thẻ kết | "Running inside NetSuite means commission, piecework and KPI pay come straight from sales and manufacturing in NetSuite, with nothing re-keyed; labor cost becomes management information by project; and one system of roles, approvals and audit trail. Contact S4, Oracle NetSuite consultants in Vietnam, for a demo on your own data: s4.com.vn." |

### 7.4 Khớp lời với hình

- Cảnh 5: phiếu SL000115 trên hình nhập sản lượng tay; câu "From transactions" đọc khi hình ở nút đó, không nói phiếu trên hình được lấy tự động.
- Cảnh 9: hoa hồng của E1044 trên hình đến từ file DMS; lời thoại nói chung "from NetSuite sales transactions and from other systems such as a DMS", không nói E1044 lấy từ hóa đơn NetSuite.
- Cảnh 4: không nhắc các phiếu vắng ngày 01/02.
- Cảnh 11: không nói "click to open the journal entry" vì đoạn mở bút toán bị cắt.

## 8. Đầu ra mong đợi

1. Video demo 16:9, 1920x1080, lời thoại tiếng Anh, 12-15 phút, thẻ tiêu đề đầu và thẻ kết có logo S4, website s4.com.vn.
2. File phụ đề tiếng Anh (.srt) khớp thời gian.
3. Danh sách điểm cắt đã dùng (thời điểm trong bản ghi gốc) để người dùng duyệt.
4. Ghi chú chỗ cần quay bổ sung, nếu có (ví dụ: mở Journal Entry JE2141 trên NetSuite, cảnh trợ lý AI).

Không đăng video lên kênh công khai khi người dùng chưa duyệt.
