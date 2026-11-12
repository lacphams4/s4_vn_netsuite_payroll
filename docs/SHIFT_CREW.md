# Phân hệ Phân ca kíp sản xuất - thiết kế (bản đề xuất 12/11/2026)

Đặc tả kỹ thuật chi tiết (mô hình dữ liệu, mô-đun, route, thuật toán, điểm nối): `docs/SHIFT_CREW_SPEC.md`.

Phân hệ con của S4 Advanced Payroll, dùng cho nhà máy. Mục đích: trả lời được ba câu hỏi mà hôm nay gói chưa trả lời trọn:
1. **Kế hoạch:** đầu kỳ, ai được xếp làm chuyền nào, ca nào, vị trí nào, có đủ người và đủ tay nghề không.
2. **Thực tế:** trong ngày, ai thật sự có mặt ở chuyền nào, bao nhiêu giờ (đổi ca, làm thay, điều chuyển giữa ca).
3. **Sản lượng:** khi lệnh sản xuất hay phiếu thành phẩm không gắn người hoặc tổ, sản lượng của chuyền x ca x ngày thuộc về ai,
   mỗi người bao nhiêu sản phẩm và bao nhiêu tiền khoán.

Nguyên tắc sản phẩm (đã thống nhất): tiệm cận độ sâu của các hệ thống lớn nhưng **không chép**: cấu hình có kiểu dữ liệu rõ
ràng, không có ngôn ngữ quy tắc tự do, màn hình gọn, lưới nào cũng có ô tìm kiếm, nguồn dữ liệu cấu hình được theo khách hàng.

## 1. Các hệ thống lớn làm thế nào (tham chiếu khái niệm)

| Hệ thống | Khái niệm | Điều rút ra cho gói |
| --- | --- | --- |
| SAP HCM Shift Planning (PT-SP) | Nhu cầu nhân lực theo đơn vị x ca (kèm yêu cầu tay nghề); **kế hoạch mục tiêu** (target plan) và **kế hoạch thực tế** (actual plan) tách nhau; điều động tạm sang đơn vị khác; kiểm tra tay nghề khi xếp | Tách Kế hoạch và Thực tế; định biên theo chuyền x ca; tay nghề có hiệu lực |
| SAP PP / Digital Manufacturing | Work center là **nơi làm** (năng lực, ca), tách khỏi tổ chức con người; xác nhận công đoạn có thể ghi mã nhân viên; người vận hành đăng nhập vào trạm (labor on / off) | Tách **Chuyền** (nơi làm) khỏi **Kíp / tổ** (nhóm người); nhận thời gian vào ra theo trạm khi có |
| SAP Incentive Wages (PT-IW) | Phiếu khoán cá nhân hoặc **nhóm**; tiền khoán nhóm chia cho thành viên theo giờ có mặt trong nhóm, có hệ số | Chia sản lượng nhóm theo **giờ thực tế ở đúng chuyền, đúng ca**, không theo ngày công cả kỳ |
| UKG (Kronos), Oracle Time and Labor | Chấm công kèm mã chuyền / lệnh (labor transfer ngay trên máy chấm); quy tắc lao động kiểm khi xếp ca | Máy chấm đặt tại chuyền thì thiết bị = chuyền; kiểm luật lao động ngay lúc xếp |

Không đưa vào: tối ưu hóa xếp ca tự động bằng thuật toán, ngôn ngữ quy tắc tự viết, MES đầy đủ (dừng máy, OEE). Gói nhận kết
quả từ MES qua nguồn nạp cấu hình được.

## 2. Gói đang có gì để dựa vào

- Ca (`shift`), mẫu xoay ca (`shift_pattern`), ô phân ca người x ngày (`roster`: ca, chi nhánh, work center) và API sinh phân
  ca theo tổ từ mẫu, sửa ô; **chưa có màn hình SPA**.
- Lượt chấm (`punch`) với hồ sơ nguồn cấu hình được (`punch_source`, ZKTeco, CSV, dán Excel), xử lý chấm công đối chiếu
  phân ca sinh phiếu trễ / sớm / vắng / thiếu lượt và đơn OT gợi ý.
- Tổ đội (`team`, `team_member` có hệ số, tỷ lệ, hiệu lực), phiếu sản lượng cá nhân / tổ (`output`, `output_line`,
  `output_member`), chia tiền D / F / H / P / E, nguồn sản lượng từ giao dịch (`out_source`).
- Phân bổ chi phí theo "Ngày phân ca" (phương pháp R), cảnh báo giới hạn OT trong bảng lương.

Phân hệ mới **mở rộng** các record này, không làm lại.

## 3. Khái niệm chính

| Khái niệm | Nghĩa | Record |
| --- | --- | --- |
| **Chuyền** (nơi làm) | Chuyền, trạm, khu vực, máy; thuộc chi nhánh, xưởng; gắn đích chi phí (phòng ban, class, work center NetSuite) | `line` (mới) |
| **Định biên** | Chuyền x ca (x vị trí) cần tối thiểu / chuẩn bao nhiêu người, tay nghề gì, hiệu lực từ - đến | `line_staffing` (mới) |
| **Tay nghề** | Kỹ năng / bậc thợ / chứng chỉ vận hành của nhân viên, có hạn | `skill`, `emp_skill` (mới) |
| **Kíp / tổ** | Nhóm người làm cùng nhau, xoay ca cùng nhau (kíp A, B, C, D) | `team` hiện có, thêm loại K - Kíp và chuyền mặc định |
| **Kế hoạch ca** | Bản kế hoạch một tuần / một kỳ cho một nhóm chuyền; trạng thái Nháp - Công bố - Khóa; có phiên bản | `shift_plan` (mới, đầu phiếu) |
| **Ô kế hoạch** | Người x ngày x ca x chuyền x vị trí | `roster` hiện có, thêm `line`, `position`, `crew`, `plan` |
| **Ô thực tế** | Người x ngày x ca x chuyền, giờ từ - đến, nguồn xác nhận, trạng thái | `shift_actual` (mới) |
| **Sản lượng chuyền ca** | Chuyền x ngày x ca x hạng mục x số lượng, nguồn gốc (giao dịch, MES, nhập tay) | `line_output` (mới) |

Vì sao tách Chuyền khỏi Kíp: một kíp có thể được điều sang chuyền khác trong ngày; một chuyền chạy ba ca với ba kíp khác nhau.
Sản lượng gắn với **nơi làm và thời gian**, còn tiền gắn với **người**. Ghép hai thứ đó qua bảng thực tế.

### 3.1 Chuyền, work center và công đoạn (operation)
Ba khái niệm khác nhau, theo đúng cách NetSuite Manufacturing Routing và SAP PP tách:

| Khái niệm | Trả lời câu hỏi | NetSuite | Ví dụ |
| --- | --- | --- | --- |
| **Công đoạn** (operation) | **Làm việc gì**, bước thứ mấy trong quy trình sản phẩm | Dòng operation của routing: số thứ tự, tên, work center, thời gian chuẩn bị, định mức chạy | 10 Cắt, 20 Hàn, 30 Sơn, 40 Đóng gói |
| **Work center** | **Làm ở đâu**, bằng nguồn lực nào | Manufacturing Work Center (nhóm nhân viên / máy) gắn trên operation | Khu cắt, chuyền lắp ráp 2 |
| **Chuyền** của phân hệ (`line`) | Đơn vị **xếp người theo ca** | Ánh xạ 1-1 tới work center khi khách dùng routing; tự khai khi không dùng | như trên |

Một công đoạn chạy tại một work center; một work center có thể làm nhiều công đoạn (của nhiều sản phẩm). Ở xưởng tổ chức theo
công đoạn (tổ Cắt, tổ Lắp ráp, tổ Đóng gói) thì chuyền gần như trùng công đoạn; ở chuyền may hay lắp ráp liên hoàn thì một
chuyền làm trọn nhiều công đoạn. Vì vậy phân hệ **xếp người theo chuyền** (nơi làm) và **tính sản lượng theo công đoạn**:
- `line_output` ghi thêm **công đoạn**: chuyền x ngày x ca x công đoạn x sản phẩm x số lượng. Work Order Completion có công
  đoạn (bắt đầu - kết thúc) cho biết số lượng hoàn thành của từng công đoạn; work center của công đoạn suy ra chuyền.
- Đơn giá khoán theo công đoạn dùng bảng đơn giá loại O hiện có (mã hạng mục = mã công đoạn, hoặc công đoạn x sản phẩm).
- Định biên có thể khai theo chuyền x ca x **vị trí**; vị trí thường ứng với công đoạn trên chuyền liên hoàn (đứng máy cắt, hàn).
- Khi chuyền làm nhiều công đoạn, sản lượng từng công đoạn chia cho người có mặt; có cấu hình chọn chỉ chia cho người đứng đúng
  vị trí của công đoạn đó (chuyền liên hoàn) hay chia cho cả chuyền (khoán chung).

## 4. Quy trình

```
Đầu kỳ (HR nhà máy)          Trong ngày (tổ trưởng / máy)          Cuối ngày - cuối kỳ (thống kê, HR)
--------------------         ----------------------------          ---------------------------------
Định biên chuyền x ca   ->   Điểm danh / quẹt tại chuyền     ->     Đối chiếu kế hoạch - thực tế - chấm công
Sinh kế hoạch từ kíp,        Đổi ca, làm thay, điều chuyển          Nạp sản lượng chuyền x ca
  mẫu xoay ca                  giữa ca (giờ từ - đến)               Chia sản lượng và tiền cho người có mặt
Kiểm tra: thiếu người,       Tổ trưởng xác nhận ca                  Duyệt, khóa ngày / kỳ
  tay nghề, luật lao động                                           -> Phiếu sản lượng tổ -> Bảng lương
Công bố cho tổ trưởng                                               -> Phân bổ chi phí theo chuyền / lệnh
```

### 4.1 Lập kế hoạch (HR nhà máy, đầu tuần hoặc đầu kỳ)
1. Khai **định biên** cho chuyền x ca: số người tối thiểu, chuẩn, vị trí và tay nghề yêu cầu. Nguồn định biên: nhập tay (giai
   đoạn 1); về sau có thể gợi ý từ kế hoạch sản xuất (số lệnh x định mức giờ công) - ngoài phạm vi giai đoạn 1.
2. Tạo **kế hoạch ca** (tuần / kỳ, nhóm chuyền), bấm **Sinh từ kíp**: mỗi kíp có chuyền mặc định và mẫu xoay ca (ví dụ 4 kíp 3 ca
   chu kỳ 8 ngày). Ô sửa tay được giữ khi sinh lại.
3. Lưới hai chế độ xem:
   - **Người x ngày** (giống bảng phân ca giấy): ô hiện mã ca + mã chuyền, màu theo ca; kéo chọn nhiều ô để gán.
   - **Chuyền x ca x ngày** (độ phủ): ô hiện "có / chuẩn", đỏ khi thiếu tối thiểu, vàng khi thiếu tay nghề, xanh khi đủ; bấm ô
     ra danh sách người và người có thể bổ sung (cùng tay nghề, đang nghỉ hoặc dư).
4. **Kiểm tra trước khi công bố** (cảnh báo, không chặn trừ khi cấu hình chặn):
   - thiếu định biên, thiếu tay nghề, tay nghề hết hạn;
   - người đang nghỉ phép, thai sản, đã nghỉ việc, chưa có hợp đồng;
   - nghỉ giữa hai ca, số giờ trong ngày / tuần, giới hạn làm thêm, làm đêm với lao động được bảo vệ: lấy từ **tham số pháp lý
     dạng dữ liệu có cờ đã đối chiếu**, không gắn cứng con số trong mã;
   - một người hai chuyền cùng giờ.
5. **Công bố**: kế hoạch chuyển trạng thái, tổ trưởng và nhân viên xem được (Employee Center / màn hình tổ trưởng). Sửa sau công
   bố ghi lịch sử thay đổi (ai, lúc nào, lý do).

### 4.2 Xác nhận thực tế (trong ngày)
Ô thực tế ban đầu = ô kế hoạch (nguồn P). Được ghi đè bởi các nguồn, theo thứ tự ưu tiên cấu hình được:

| Nguồn | Cách | Ghi chú |
| --- | --- | --- |
| D - Máy chấm tại chuyền | Thiết bị khai thuộc chuyền nào (`punch_source` / mã thiết bị -> chuyền); lượt chấm vào ra cho biết người có mặt ở chuyền đó từ giờ nào | Không cần thao tác thêm; hợp với vân tay / khuôn mặt đặt tại xưởng |
| L - Tổ trưởng điểm danh | Màn hình gọn cho điện thoại: danh sách người của chuyền ca hôm nay, đánh dấu có mặt / vắng / điều đi, thêm người làm thay, giờ từ - đến | Cách thực tế nhất ở nhà máy Việt Nam; chỉ tổ trưởng cần quyền truy cập |
| Q - Công nhân tự quét mã | Quét mã QR dán tại chuyền bằng điện thoại | Mỗi công nhân cần quyền truy cập NetSuite (chi phí giấy phép); để ở giai đoạn sau hoặc qua ứng dụng bên ngoài |
| X - Hệ thống ngoài (MES, app chấm công) | Đẩy ô thực tế qua API / CSV với hồ sơ nguồn và bảng ánh xạ như nạp chấm công | Nguồn cấu hình được theo khách hàng |
| M - Sửa tay | HR / thống kê sửa có lý do | Ghi lịch sử |

Điều chuyển giữa ca: một người có thể có nhiều ô thực tế trong một ca (chuyền 1 từ 06:00 - 10:00, chuyền 3 từ 10:00 - 14:00).

Lưu ý về mobile: công nhân sản xuất thường không có giấy phép NetSuite. Thiết kế mặc định chỉ **tổ trưởng** đăng nhập (Employee
Center hoặc vai trò riêng) và màn hình xác nhận phải dùng tốt trên điện thoại. Công nhân xác nhận bằng **máy chấm tại chuyền**.
Ứng dụng di động riêng cho từng công nhân là tích hợp ngoài (nguồn X), không nằm trong gói.

### 4.3 Đối chiếu và khóa
Mỗi ngày (hoặc cuối kỳ) gói đối chiếu ba lớp: **kế hoạch - thực tế - lượt chấm**, sinh danh sách ngoại lệ:
- có kế hoạch, không có mặt (vắng không phép, chưa có đơn nghỉ);
- có mặt, không có kế hoạch (làm thay, làm thêm chưa có đơn OT);
- tổ trưởng xác nhận có mặt nhưng không có lượt chấm, hoặc ngược lại;
- giờ thực tế vượt ca (gợi ý đơn OT, dùng lại cơ chế hiện có);
- chuyền có sản lượng nhưng không ai có mặt; người có mặt nhưng chuyền không có sản lượng.

Ô thực tế đi qua trạng thái: Tạm - Tổ trưởng xác nhận - Quản đốc / HR duyệt - Khóa. Khóa ngày theo kỳ công của nhóm lương
(cơ chế khóa kỳ công hiện có).

### 4.4 Ánh xạ sản lượng (giải bài toán chứng từ không gắn người)
1. **Sản lượng chuyền ca** (`line_output`) nạp từ:
   - giao dịch NetSuite (Assembly Build, Work Order Completion): chuyền lấy theo thứ tự cấu hình - trường chuyền trên giao dịch,
     work center của lệnh / công đoạn, địa điểm hoặc class; **ca** suy từ trường ca, hoặc từ giờ ghi nhận so với khung giờ ca;
   - MES / Excel / API qua hồ sơ nguồn và bảng ánh xạ (mã chuyền ngoài -> chuyền);
   - nhập tay của thống kê xưởng.
   Chứng từ đã gắn người hoặc tổ thì đi đường cũ (phiếu cá nhân / phiếu tổ), không qua bước chia.
2. **Chia** sản lượng của chuyền x ngày x ca cho người có ô thực tế ở đúng chuyền, ngày, ca đó:
   - trọng số = giờ thực tế trong khung ca x hệ số (hệ số theo vị trí / bậc thợ / thành viên kíp);
   - cách chia cấu hình được theo chuyền: H giờ (mặc định), F giờ x hệ số, E đều, P tỷ lệ cố định;
   - chia cả **số lượng** (giữ số lẻ để cộng báo cáo) và **tiền** (làm tròn đồng, dư chia cho phần lẻ lớn nhất, như hiện nay).
3. Kết quả sinh **phiếu sản lượng tổ** ở Tạm giữ, thành viên = người có mặt, có số lượng quy đổi theo người; sau đó gửi duyệt,
   vào bảng lương như phiếu tổ hiện có. Khóa nguồn chống sinh trùng như `out_source`.
4. Báo cáo: sản lượng theo người / kíp / chuyền / hạng mục / ngày / kỳ; năng suất = sản lượng / giờ thực tế; so định mức.

### 4.5 Nối với lương và kế toán
- Ngày công, giờ, ca đêm lấy từ ô thực tế đã duyệt (bảng công hiện có nhận thêm nguồn này).
- Phụ cấp theo chuyền / vị trí (độc hại, ca đêm, trưởng ca) qua quy tắc thu nhập: điều kiện là loại chuyền / vị trí, số đếm là
  số ca thực tế.
- Phân bổ chi phí lương theo chuyền (đích chi phí của chuyền) hoặc theo lệnh sản xuất khi sản lượng có lệnh: mở rộng phương pháp R
  "Ngày phân ca" thành "Giờ thực tế theo chuyền".

## 5. Mô hình dữ liệu (record mới, tên dự kiến)

| Record | Trường chính |
| --- | --- |
| `line` Chuyền | mã, tên, công ty con, chi nhánh (location), phòng ban, class, work center NetSuite (nhóm), cách chia mặc định, ca được chạy, ngừng dùng |
| `line_staffing` Định biên | chuyền, ca (trống = mọi ca), vị trí, tay nghề yêu cầu, bậc tối thiểu, số người tối thiểu, chuẩn, hiệu lực từ - đến |
| `skill` Tay nghề | mã, tên, có hạn hay không |
| `emp_skill` Tay nghề nhân viên | nhân viên, tay nghề, bậc, cấp ngày, hết hạn, chứng chỉ (file) |
| `shift_plan` Kế hoạch ca | công ty con, từ ngày - đến ngày, nhóm chuyền, trạng thái N / P công bố / L khóa, phiên bản, người công bố, ngày công bố |
| `roster` (mở rộng) | thêm: kế hoạch, chuyền, vị trí, kíp |
| `shift_actual` Ô thực tế | nhân viên, ngày làm, ca, chuyền, vị trí, giờ từ, giờ đến, số giờ, nguồn P / D / L / Q / X / M, trạng thái, người xác nhận, lý do |
| `line_output` Sản lượng chuyền ca | công ty con, chuyền, ngày, ca, công đoạn (mã, số thứ tự), sản phẩm, hạng mục đơn giá, số lượng, đơn vị tính, lệnh sản xuất, nguồn, khóa nguồn, phiếu sản lượng đã sinh |
| `output_member` (mở rộng) | thêm: số lượng quy đổi, giờ thực tế |
| `team` (mở rộng) | loại K - Kíp, chuyền mặc định, mẫu xoay ca mặc định |
| `punch_source` (mở rộng) | thiết bị -> chuyền (bảng con) |

Tham số pháp lý mới (dạng dữ liệu, cờ đã đối chiếu): thời gian nghỉ tối thiểu khi chuyển ca, giờ làm tối đa trong ngày / tuần,
các giới hạn làm đêm. Giá trị phải đối chiếu văn bản gốc trước khi bật chặn.

## 6. Màn hình (SPA, tab Chấm công hoặc tab riêng "Phân ca kíp")

1. **Chuyền và định biên**: lưới chuyền (ô tìm kiếm), khung phải là định biên theo ca, tay nghề yêu cầu.
2. **Kế hoạch ca**: chọn kỳ / tuần (date picker), nhóm chuyền; hai chế độ xem người x ngày và chuyền x ca; nút Sinh từ kíp,
   Kiểm tra, Công bố; ô tìm kiếm nhanh; danh sách cảnh báo bên phải bấm được để nhảy tới ô.
3. **Xác nhận ca (tổ trưởng)**: giao diện gọn dùng trên điện thoại; mặc định ca hiện tại của chuyền mình; đánh dấu nhanh, thêm
   người làm thay, điều chuyển với giờ.
4. **Đối chiếu**: lưới ngoại lệ theo ngày, lọc theo loại; xử lý ngay (tạo đơn OT, đơn nghỉ, sửa ô thực tế).
5. **Sản lượng chuyền ca**: nạp (giao dịch, file, nhập tay), xem trước phần chia theo người, sinh phiếu tổ.
6. **Năng suất**: sản lượng và giờ theo người / kíp / chuyền, so định mức; xuất Excel.

## 7. Giai đoạn đề xuất

| Giai đoạn | Nội dung | Kết quả dùng được |
| --- | --- | --- |
| 1. Kế hoạch | `line`, `line_staffing`, `skill`, `emp_skill`, `shift_plan`, mở rộng `roster` và `team`; màn hình Chuyền, Kế hoạch ca (sinh từ kíp, kiểm tra, công bố) | HR nhà máy xếp ca đầu kỳ trên hệ thống, thấy độ phủ và thiếu tay nghề |
| 2. Thực tế | `shift_actual`; thiết bị -> chuyền; màn hình Xác nhận ca cho tổ trưởng; đối chiếu ba lớp; khóa | Biết ai thật sự làm ở chuyền nào, bao lâu; bảng công lấy từ thực tế |
| 3. Sản lượng | `line_output`, nguồn từ giao dịch / MES / file; chia số lượng và tiền theo giờ thực tế; báo cáo năng suất | Tính được sản lượng từng người kể cả khi lệnh sản xuất không gắn người |
| 4. Mở rộng | Gợi ý định biên từ kế hoạch sản xuất; phụ cấp theo vị trí; phân bổ chi phí theo lệnh; tích hợp app di động ngoài | Theo nhu cầu khách hàng |

Demo Sao Mai: xưởng Bình Dương 40 người, 3 tổ (Cắt, Lắp ráp, Đóng gói), 3 ca xoay là bối cảnh quay cho cả bốn giai đoạn.

## 8. Câu hỏi cần chốt
1. Chuyền là record mới (`line`) hay dùng work center NetSuite (nhóm nhân viên của Manufacturing Routing) làm chuyền? Đề xuất: record
   mới, ánh xạ 1-1 tới work center NetSuite cho khách dùng routing (khách không dùng routing vẫn xếp ca được). Công đoạn không
   thành record riêng của phân hệ: lấy từ routing NetSuite, hoặc mã công đoạn trong bảng đơn giá loại O.
2. Đơn vị kế hoạch: theo tuần hay theo kỳ lương? Đề xuất: kế hoạch theo khoảng ngày bất kỳ, mặc định tuần.
3. Kiểm tra luật lao động: chỉ cảnh báo hay cho phép chặn theo cấu hình? Đề xuất: cảnh báo mặc định, chặn khi bật cấu hình.
4. Ai xác nhận thực tế ở khách hàng điển hình: tổ trưởng trên điện thoại hay chỉ máy chấm tại chuyền? Đề xuất: cả hai, ưu tiên máy.
