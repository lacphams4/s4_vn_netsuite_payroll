# Kịch bản quay video S4 Advanced Payroll - Doanh nghiệp sản xuất (bản 12/11/2026)

Video demo khoảng 14 phút sau dựng, kể một tháng lương của xưởng gia công: **xếp ca -> chấm công máy -> sản lượng khoán -> lương ->
giá thành**. Có một cảnh lướt qua lương kinh doanh. Kịch bản chung (mục A-H, ba mô hình) ở `s4-advanced-payroll_kich_ban_quay.md`;
file này thay phần "Video 1 - Sản xuất" và đã cập nhật theo các thay đổi ngày 12/11/2026.

## 1. Môi trường và dữ liệu

| Mục | Giá trị |
| --- | --- |
| Account | td2937310, công ty con "Công ty TNHH Thương mại Sao Mai Demo" (chọn ở ô Công ty con góc phải trước mọi thao tác) |
| Màn hình | `/spa/s4vp-payroll` (tab S4 Tính Lương Nâng Cao / S4 Advanced Payroll) |
| Vai trò quay | S4 Advanced Payroll - Demo (menu gọn) hoặc Administrator; chốt một vai trò cho cả buổi quay |
| Kỳ quay bản Việt | SAOMAI-202701 (01/01/2027 - 31/01/2027; câu chuyện "tháng 12/2026") |
| Kỳ quay bản Anh | SAOMAI-202702 (01/02/2027 - 28/02/2027), quay sau khi bản Việt đã ghi sổ |
| Bối cảnh | Xưởng gia công Bình Dương: 34 công nhân 3 kíp A / B / C xoay 3 ca (C1 06:00-14:00, C2 14:00-22:00, C3 22:00-06:00), 3 tổ sản xuất Cắt, Lắp ráp, Đóng gói hưởng lương khoán theo công đoạn; quản đốc, tổ trưởng ca hành chính |
| File đầu vào | Repo `s4_netsuite_demo_saomai`, thư mục `deliverables/payroll/`: `ZK-XUONG_2026-12.dat`, `ZK-KHO_2026-12.dat`, `DMS_CuaHang_2026-12.csv` (bản Anh: các file `_2027-01`) |

Trạng thái dữ liệu đã kiểm ngày 12/11/2026:
- Sáu kỳ SAOMAI-202607 đến 202612 đã khóa công, chạy lương và ghi sổ (BL000010 - BL000015); hoa hồng sáu tháng đã duyệt.
- Kỳ quay có đủ phân ca, đơn nghỉ, công tác, làm thêm, giờ công dự án; 14 phiếu khoán tổ ở Tạm giữ (104.308.000 đ); chưa có lượt chấm máy.
- Ba dòng chế độ ca cho KIP-A, KIP-B, KIP-C (mẫu XOAY3, hiệu lực 01/07/2026).
- Trang chủ của Sao Mai hiện kỳ đang chạy SAOMAI-202701, hai việc cần làm (lập bảng công, tạo bảng lương).

## 2. Chuẩn bị trước khi bấm máy (ngoài máy quay)

1. Chọn công ty con Sao Mai. Mở link kỳ khi ô Công ty con đang ở công ty khác thì màn Chấm công hiện 0 nhân viên.
2. **Hoa hồng tháng quay** (để cảnh 9 có dòng Hoa hồng): tab Hoa hồng > Nạp doanh số ngoài, hệ thống nguồn `DMS`, file
   `DMS_CuaHang_2026-12.csv` (đã kiểm: 458 dòng hợp lệ, 0 lỗi) > Ghi; chọn tháng 01/2027 > Tính lại > Duyệt.
   Nếu quay cả video thương mại: quay các cảnh hoa hồng của video thương mại ở bước này thay vì làm ngoài máy quay.
3. **Chấm công kho**: nạp trước `ZK-KHO_2026-12.dat` (nguồn ZK-KHO) rồi Ghi. Không nạp thì 14 nhân viên kho bị đề xuất vắng cả
   tháng khi xử lý chấm công. File xưởng để nạp trên video.
4. Cổng nhân viên: bật Give Access (Employee Center) cho E1069 Lê Thanh Sơn. Người dùng tự làm.
5. Đặt trình duyệt 1920 x 1080, thu phóng 100%, ẩn thanh dấu trang; đăng nhập sẵn, mở sẵn Trang chủ.
6. Không bấm nút "Lấy từ giao dịch" trên màn Sản lượng (account không có phân hệ Manufacturing).

## 3. Mạch quay

Thời lượng là thời lượng sau dựng. Bước chờ dài (nạp nhân viên khoảng 50 giây, tính lương khoảng 40 giây) cắt khi dựng.

### Cảnh 1 - Trang chủ (0:45)
- Thao tác: Trang chủ. Chỉ vào thẻ "Kỳ đang chạy SAOMAI-202701", khung "Việc cần làm" (Lập bảng công rồi khóa công; Tạo bảng lương),
  khung "Sắp đến hạn", chip "Đã xong 6".
- VI: "Đây là Sao Mai, 110 nhân viên, có một xưởng gia công chạy ba ca. Trang chủ cho biết kỳ lương đang chạy, việc nào phải làm
  trước và hạn của từng việc. Sáu kỳ trước đã chốt xong; hôm nay chúng ta chạy trọn một kỳ lương của nhà máy."
- EN: "This is Sao Mai, 110 employees, with a workshop running three shifts. The home page shows the pay period in progress, what
  has to be done first, and each deadline. Six periods are already closed; today we run one full payroll cycle for the plant."

### Cảnh 2 - Xếp ca (1:30)
- Thao tác: Khác > Xếp ca. Chọn 31 ngày, từ 01/01/2027. Bấm **Chế độ ca (3)**: ba dòng KIP-A, KIP-B, KIP-C cùng mẫu XOAY3, ngày
  neo lệch nhau một tuần; Đóng. Trên lưới: lọc Phòng ban "Xưởng gia công", chỉ vào màu ca và dòng "Số người theo ca" cuối lưới.
  Minh họa ngoại lệ ở tháng chưa có dữ liệu: bấm Sau để sang tháng 03/2027, chọn bút "C2", bấm ô 08/03 của E1069, bấm Lưu 1 ô; chọn
  bút "Theo chế độ ca", bấm lại ô đó, Lưu.
- VI: "Lịch ca của cả xưởng chỉ là ba dòng: mỗi kíp một mẫu xoay ca, lệch nhau một tuần. Không phải xếp từng ô cho từng người.
  Lưới này để xem ai làm ca nào, mỗi ca có bao nhiêu người, và sửa ngoại lệ: đổi ca một ngày, rồi trả về lịch chung khi cần."
- EN: "The whole workshop roster is three lines: one rotation pattern per crew, one week apart. Nobody fills in cells one by one.
  The grid shows who works which shift, the headcount per shift, and handles exceptions: change one day, then go back to the scheme."
- Lưu ý: không sửa ô trong tháng 01/2027 (trùng dữ liệu chấm công sắp nạp).

### Cảnh 3 - Nạp chấm công máy (1:30)
- Thao tác: Chấm công (kỳ SAOMAI-202701) > Nạp chấm công. Hồ sơ nguồn **ZK-XUONG**, chọn file `ZK-XUONG_2026-12.dat`, Xem trước.
  Kết quả mong đợi: 1.602 dòng, Mới 1.514, Chưa đối chiếu 88 (mã 51 và 52, mỗi mã 44 dòng), Trùng 0, Lỗi 0, Kỳ đã khóa 0.
  Gán mã: 51 -> E1071 Nguyễn Ngọc Tùng, 52 -> E1081 Trần Thanh Tuấn, Lưu đối chiếu, Xem trước lại (Mới 1.602), **Ghi**.
- VI: "File lấy thẳng từ máy chấm công vân tay, không qua Excel. Hệ thống nhận người theo bảng đối chiếu mã. Hai công nhân vừa đăng
  ký lại vân tay nên mã mới chưa có chủ; gán ngay tại đây rồi ghi. Nạp lại cùng file sẽ không ghi trùng."
- EN: "The file comes straight from the fingerprint device, no spreadsheet in between. People are matched through a mapping table.
  Two workers re-enrolled their fingerprints, so two new IDs are unassigned; we assign them here and commit. Re-importing the same
  file never creates duplicates."

### Cảnh 4 - Xử lý chấm công, duyệt ngoại lệ (1:30)
- Thao tác: Thao tác khác > Xử lý chấm công máy. Xem thẻ "Ngoại lệ chờ xử lý". Khung phải: mở một phiếu đi trễ, một đơn làm thêm
  thứ Bảy, một đơn làm thêm ca đêm; Gửi duyệt rồi Duyệt 3 - 4 chứng từ. Phiếu "thiếu lượt chấm" để lại, nói rõ HR xác minh sau.
- VI: "Hệ thống so lượt chấm với lịch ca và đề xuất: đi trễ, về sớm, thiếu lượt chấm, làm thêm. Tất cả ở trạng thái Tạm giữ. Hệ
  thống không tự trừ lương; người quản lý xem và duyệt từng trường hợp, có lịch sử ai duyệt, lúc nào."
- EN: "The system compares punches with the roster and proposes: late arrival, early leave, missing punch, overtime. Everything is
  on hold. Nothing is deducted automatically; a manager reviews and approves each case, with a full approval trail."

### Cảnh 5 - Sản lượng, lương khoán tổ (2:00)
- Thao tác: Khác > Sản lượng - khoán tổ, kỳ 01/2027: 14 phiếu Tạm giữ. Mở một phiếu tổ Cắt: dòng công đoạn, đơn giá tra tự động, thành
  viên; bấm Chia tiền; Gửi duyệt; Duyệt. **Tạo phiếu** mới: tổ TO-LAPRAP, ngày 29/01/2027, bảng đơn giá GC-CONGDOAN, ba dòng
  LAP-TU-PP 19, LAP-TU-DK 7, DAU-DAY 1734 (tổng mong đợi 11.415.000); Nạp thành viên, Chia tiền, Gửi duyệt, Duyệt. Các phiếu còn
  lại: chia tiền và duyệt ngoài máy quay hoặc tua nhanh.
- VI: "Xưởng trả lương khoán theo công đoạn. Thống kê xưởng nhập số lượng của tổ; đơn giá tra theo bảng, theo ngày hiệu lực. Tiền
  của tổ chia cho từng người theo ngày công nhân hệ số, tổng luôn khớp từng đồng. Sản lượng cũng có thể nạp từ file, từ hệ thống
  điều hành sản xuất, hoặc lấy từ lệnh sản xuất trên NetSuite."
- EN: "The workshop pays piece rates by operation. The shop clerk enters the team's quantities; rates come from the rate table by
  effective date. The team amount is split by days worked times a factor, and it always adds up to the last dong. Output can also
  be imported from a file, an MES, or NetSuite work orders."
- Lưu ý: phải duyệt hết phiếu của kỳ trước khi tính lương, phiếu Tạm giữ không vào lương.

### Cảnh 6 - Khóa công (0:30)
- Thao tác: Chấm công > Tổng hợp công (lập bảng công) > Khóa công. Thanh bước chuyển sang "Chuyển sang tính lương".
- VI: "Công được chốt một lần. Sau khi khóa, mọi chứng từ công của kỳ không sửa được nữa, và bảng lương lấy số từ đây."
- EN: "Attendance is closed once. After locking, no attendance document of the period can change, and payroll reads from here."

### Cảnh 7 - Chạy lương (1:15)
- Thao tác: Sang chạy lương > Tạo bảng lương (kỳ 01/2027, diễn giải "Lương tháng 12/2026") > Tải nhân viên > Tính lương. Chỉ vào
  bốn thẻ số: thực lĩnh, bảo hiểm, thuế TNCN, tổng chi phí công ty; cột "So kỳ trước".
- VI: "Một bảng lương cho cả công ty. Hệ thống nạp nhân viên, công, làm thêm, sản lượng, hoa hồng rồi tính lương, bảo hiểm, thuế
  thu nhập cá nhân theo quy định hiện hành. Số liệu kỳ trước nằm ngay bên cạnh để soát biến động."
- EN: "One payroll batch for the whole company. The system loads employees, attendance, overtime, output and commission, then
  calculates pay, statutory insurance and personal income tax under current rules. Last period's figures sit alongside for review."

### Cảnh 8 - Chi tiết một công nhân (1:30)
- Thao tác: tìm E1069 Lê Thanh Sơn. Tab Thu nhập: Lương cơ bản, Lương khoán, Phụ cấp độc hại, ca đêm xưởng (số ca đêm x 40.000), làm
  thêm nếu có. Tab Bảo hiểm, tab Thuế TNCN, tab Công.
- VI: "Mỗi con số đều có diễn giải: lương cơ bản theo ngày công, lương khoán từ các phiếu tổ đã duyệt, phụ cấp ca đêm tính theo số
  ca đêm trong lịch ca. Bảo hiểm và thuế hiện rõ căn cứ tính."
- EN: "Every figure is explained: base pay by days worked, piece pay from approved team entries, night-shift allowance from the
  number of night shifts in the roster. Insurance and tax show their calculation bases."

### Cảnh 9 - Lương kinh doanh, lướt qua (0:40)
- Thao tác: trong cùng bảng lương, tìm một nhân viên cửa hàng (E1044). Tab Thu nhập: dòng Hoa hồng cạnh lương cơ bản.
- VI: "Cùng bảng lương đó, nhân viên bán hàng hưởng hoa hồng. Hoa hồng được tính ở phân hệ riêng theo doanh số và thu tiền; duyệt
  xong thì tự vào lương. Phần này có một video riêng."
- EN: "In the same batch, sales staff earn commission. Commission is calculated in its own module from sales and collections, and
  flows into payroll once approved. That is covered in a separate video."
- Điều kiện: đã làm mục 2.2. Chưa làm thì bỏ cảnh này.

### Cảnh 10 - Phân bổ và bút toán (1:00)
- Thao tác: quay lại E1069, tab Phân bổ dự án (Xưởng Bình Dương, Khối Sản xuất, nguồn Sản lượng / Mặc định). Tab Bút toán: gõ "62" ở
  ô tìm: 622 chi phí công nhân xưởng, 6271 quản đốc; xóa ô tìm, chỉ 6411 kinh doanh, 6421 quản lý.
- VI: "Chi phí lương về đúng nơi phát sinh: công nhân trực tiếp vào 622 của xưởng, quản đốc vào 6271, kinh doanh vào 641, quản lý
  vào 642, kèm phòng ban và khối. Bút toán xem trước được ngay từ lúc tính."
- EN: "Labor cost lands where it is incurred: direct workers in account 622 of the workshop, the supervisor in 6271, sales in 641,
  administration in 642, each with department and division. The journal is previewed as soon as payroll is calculated."
- Lưu ý: 622 tách theo xưởng và khối, không tách theo từng tổ. Không nói "622 theo tổ".

### Cảnh 11 - Duyệt và ghi sổ (0:45)
- Thao tác: Bỏ tạm giữ > Gửi duyệt > Duyệt > Chi lương và ghi sổ. Bấm số bút toán để mở Journal Entry trên NetSuite.
- VI: "Soát xong thì duyệt và ghi sổ. Một bút toán chuẩn của NetSuite được tạo, liên kết ngược về bảng lương."
- EN: "After review, approve and post. One standard NetSuite journal entry is created and linked back to the payroll batch."
- Lưu ý: duyệt một cấp (cấp duyệt nhiều cấp của Sao Mai đang tắt). Không lập bill cơ quan thu trong video này.

### Cảnh 12 - Phân tích chi phí (1:00)
- Thao tác: Phân tích chi phí, tháng 01/2027. Biểu đồ xu hướng, khung "Vì sao thay đổi", bảng phân rã theo Phòng ban: bấm dòng Xưởng
  gia công; chuyển chip Thành phần chi phí để thấy lương khoán và làm thêm.
- VI: "Sau khi ghi sổ, ban giám đốc thấy chi phí lao động bảy tháng liền, tháng này tăng giảm vì đâu, và xưởng chiếm bao nhiêu,
  trong đó lương khoán và làm thêm là bao nhiêu."
- EN: "Once posted, management sees seven months of labor cost, why this month moved, how much the workshop takes, and how much of
  that is piece pay and overtime."

### Cảnh 13 - Cổng nhân viên và kết (0:45)
- Thao tác: đăng nhập Employee Center bằng E1069, mở "Lương của tôi": phiếu lương kỳ vừa ghi sổ, so với kỳ trước.
- VI: "Công nhân tự xem phiếu lương và lý do thay đổi so với tháng trước trên điện thoại. Từ lịch ca đến sổ cái, mọi bước nằm trong
  một hệ thống: S4 Advanced Payroll trên Oracle NetSuite."
- EN: "Workers see their payslip and what changed from last month on their phone. From the roster to the general ledger, every step
  lives in one system: S4 Advanced Payroll on Oracle NetSuite."
- Điều kiện: đã bật Give Access cho E1069. Chưa bật thì kết ở cảnh 12.

Tổng: khoảng 14 phút 30 giây. Rút về 11 phút: bỏ cảnh 9, 13 và phần minh họa ngoại lệ của cảnh 2.

## 4. Bản tiếng Anh

- Đổi ngôn ngữ người dùng NetSuite sang English rồi tải lại trang; tên gói thành "S4 Advanced Payroll".
- Quay trên kỳ SAOMAI-202702 sau khi bản Việt đã ghi sổ. Khác biệt: file `ZK-XUONG_2027-01.dat` (1.409 dòng; mã chưa đối chiếu 53
  -> E1077 Ngô Tuấn Hải, 54 -> E1092 Lê Hữu Lộc), `ZK-KHO_2027-01.dat`, `DMS_CuaHang_2027-01.csv`; 11 phiếu khoán Tạm giữ; phiếu lập
  trên video: tổ TO-LAPRAP ngày 26/02/2027, LAP-TU-PP 17, LAP-TU-DK 8, DAU-DAY 1497 (tổng 10.702.500); ngày lễ 01/02/2027.
- Tên nhân viên, phòng ban, diễn giải dữ liệu vẫn là tiếng Việt (dữ liệu demo), chấp nhận.

## 5. Rủi ro và cách xử lý khi quay

| Tình huống | Xử lý |
| --- | --- |
| Xem trước chấm công báo "Kỳ đã khóa" | Kiểm ô Công ty con đang là Sao Mai và kỳ SAOMAI-202701 chưa khóa công |
| Xử lý chấm công đề xuất vắng hàng loạt | Chưa nạp file kho (mục 2.3) hoặc nạp nhầm file tháng; nạp bổ sung rồi chạy lại xử lý chấm công (chứng từ Tạm giữ cũ tự được thay) |
| Tính lương xong không có lương khoán | Còn phiếu khoán chưa duyệt; duyệt rồi Tính lại |
| Sửa lịch ca sau khi đã tính lương | Bảng lương không tự báo cần tính lại; bấm Tính lại trước khi duyệt |
| Phải quay lại từ đầu | Trước ghi sổ: Mở lại bảng lương, mở khóa công. Sau ghi sổ: Đảo bảng lương, nhưng kỳ đã có bảng lương ghi sổ / đảo thì KHÔNG mở khóa công lại được, và lượt chấm đã ghi vẫn còn (nạp lại sẽ báo trùng). Vì vậy mỗi kỳ quay chỉ dùng được một lần cho các cảnh 3 - 6 |
| Bước chờ lâu | Nạp nhân viên khoảng 50 giây, tính lương khoảng 40 giây, lưu hóa đơn / bút toán chậm: cắt khi dựng |

## 6. Phần đã kiểm và chưa kiểm (12/11/2026)

- Đã kiểm trên account, trên kỳ quay bản Việt, **chỉ ở mức xem trước, không ghi**: Trang chủ, Xếp ca và Chế độ ca, màn Chấm công,
  xem trước nạp `ZK-XUONG_2026-12.dat`, danh sách 14 phiếu khoán, kiểm tra file `DMS_CuaHang_2026-12.csv`.
- Đã chạy thật trên sáu kỳ lịch sử: tính hoa hồng và duyệt, tạo bảng lương, nạp nhân viên, tính, duyệt, ghi sổ, phân bổ, bút toán,
  Phân tích chi phí. Nạp chấm công, xử lý chấm công, duyệt đề xuất, phiếu khoán và khóa công của sáu kỳ đó do loader chạy qua mô-đun
  của gói, không qua giao diện.
- **Chưa chạy thử qua giao diện trên kỳ quay**: ghi lượt chấm và gán mã trong hộp thoại, xử lý chấm công, duyệt chứng từ ở khung phải,
  lập phiếu khoán mới, chia tiền, khóa công, toàn bộ cảnh 7 - 13. Lý do: các bước này không hoàn nguyên sạch được (xem bảng mục 5),
  chạy thử sẽ làm hỏng kỳ quay. Số liệu mong đợi của cảnh 7 - 12 chưa có; ghi lại ở lần chạy thật.
- Cổng nhân viên của E1069 chưa kiểm (chưa có quyền truy cập).
