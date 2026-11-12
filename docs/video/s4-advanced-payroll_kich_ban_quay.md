# Kịch bản quay video S4 Advanced Payroll - Sao Mai Demo (td2937310)

Bản 12/11/2026. Người đọc: Claude điều khiển trình duyệt, quay màn hình, chụp ảnh, không đọc mã. Mọi nhãn nút, tab, ô trong
bảng dưới lấy nguyên văn từ bảng chữ `TEXT.vi` / `TEXT.en` của `spa/payroll/views/*.js` (repo `s4_vn_netsuite_payroll`, nhánh
có commit `022406e`). Dữ liệu lấy từ `s4_netsuite_demo_saomai/out/payroll/plan.json`, `deliverables/payroll/` và SuiteQL chỉ đọc
trên td2937310 ngày 12/11/2026. Mọi người, số định danh, số tài khoản là giả lập.

Quy ước trong tài liệu:
- "Kỳ quay" = kỳ lương `SAOMAI-202701` (id 37), câu chuyện là "tháng 12/2026". Account đã dời ngày khoảng +1 tháng nên trên màn
  hình ngày là 01/01/2027 - 31/01/2027. Lời thoại không nêu tên tháng, chỉ nói "kỳ lương này".
- `[CHỜ]` = số liệu chỉ biết sau khi loader và coordinator chạy xong; người quay ghi số thật vào cột "Kết quả" trước khi quay.
- Mã nhân viên trên màn hình là mã NetSuite (E10xx), KHÔNG phải mã kế hoạch SMxxx. Bảng đối chiếu ở mục C.2.

---

## A. Tổng quan

S4 Advanced Payroll là SuiteApp tính lương Việt Nam chạy trong Oracle NetSuite, do S4, nhà tư vấn Oracle NetSuite tại Việt Nam,
phát triển. Video theo một kỳ lương thật của Công ty TNHH Thương mại Sao Mai Demo (114 người, ba khối thương mại, sản xuất,
dịch vụ): từ file máy chấm công, lương khoán tổ, hoa hồng, đến bảng lương, bút toán, bill cơ quan thu, phân tích chi phí và cổng
nhân viên. Người xem chính là kế toán trưởng, CFO, trưởng phòng nhân sự, nhân viên tính lương; điểm nhấn là số liệu đi một
mạch từ nguồn đến sổ cái, mỗi con số có diễn giải, có kiểm soát duyệt và khóa.

### A.1 Tính năng KHÔNG được quay (chưa làm hoặc chưa ổn định)

Theo mục 20 của tài liệu wiki nguồn và kiểm tra mã:
1. Phân quyền dữ liệu lương theo công ty con / chi nhánh, "quản trị IT không xem lương", vai trò Quản lý trực tiếp.
2. Thời điểm khấu trừ BH, thuế kiểu T / A (kỳ giữa tháng); chỉ có "kỳ cuối tháng".
3. Giờ làm thêm lấy từ timesheet (nguồn OT = T). Giờ OT chỉ lấy từ đơn OT đã duyệt.
4. Quyết toán thuế TNCN năm tự động (nộp thêm / hoàn), chứng từ khấu trừ thuế TNCN, xuất XML HTKK; chỉ tiêu [24], [25], [32]
   của tờ khai 05/KK-TNCN ghi "chưa tính". Không quay màn báo cáo quyết toán năm, không nói "nộp thẳng HTKK".
5. Truy lĩnh, truy đóng BH hồi tố.
6. Tất toán TK 335 khi chi lương tháng 13 (chỉ có trích trước Có 3351).
7. File ngân hàng theo mẫu riêng từng ngân hàng: chỉ có một CSV chung. Không nói "kết nối ngân hàng".
8. Bút toán liên công ty; ánh xạ task, cost code.
9. Dashboard kiểu Acumatica (GI, saved search); ứng dụng mobile riêng; màn "công chi tiết của tôi"; đơn ngoại lệ tự phục vụ.
   Cổng nhân viên là trang web dùng được trên điện thoại, không phải app.
10. Nhãn record / list tiếng Anh (record, list SDF chỉ tiếng Việt). Không mở form record chuẩn NetSuite trong bản EN.
11. Hạn nộp theo luật trên Trang chủ (chưa có dữ liệu).
12. Chưa xác minh, không quay: nguồn sản lượng từ giao dịch sản xuất NetSuite (Assembly Build, Work Order); lưới nhập 31 ô
    bảng công ký hiệu; quy tắc riêng BH / cư trú thuế cho người nước ngoài; cột phiếu 05/QTT; giới hạn giấy phép lao động
    (24 tháng, nhắc 60 ngày là mặc định trong mã).
13. Màn hình cũ (UIF): mục "Màn hình cũ", "Đơn từ, lượt chấm, phép (màn hình cũ)", "Khác > Giấy phép lao động". Các màn này
    còn hiện tên cũ "S4 VN Payroll" - không mở khi quay.
14. Trang chủ (`#/home`) đang được sửa (thay đổi chưa commit trong repo ngày 12/11/2026) và chọn "kỳ đang chạy" theo ngày hôm
    nay, nên có thể hiện kỳ đã xong: chỉ quay Trang chủ nếu chạy thử thấy đúng kỳ (mục G).
15. Không nói "100%", "đạt chuẩn", "certified", không nêu khách hàng hay kết quả dự án.

---

## B. Môi trường

### B.1 Account, công ty, vai trò

| Mục | Giá trị |
| --- | --- |
| Account | td2937310 (đăng nhập sẵn trong trình duyệt; kịch bản không chứa mật khẩu, không gõ mật khẩu) |
| Công ty con | "Công ty TNHH Thương mại Sao Mai Demo" (id 14), nhóm lương SAOMAI (id 5) |
| Kỳ quay | SAOMAI-202701 (id 37), 01/01/2027 - 31/01/2027, công chuẩn 21 ngày |
| Kỳ trước (đã ghi sổ theo kế hoạch) | SAOMAI-202607 ... SAOMAI-202612 (id 31-36) |
| Màn hình | 1920 x 1080, trình duyệt phóng 100%; cảnh di động 390 x 844 |

Vai trò theo cảnh (đổi vai trò bằng menu tên người dùng > chọn vai trò, không cần mật khẩu):

| Cảnh (mục D) | Vai trò khuyến nghị | Ghi chú |
| --- | --- | --- |
| D1-D12, D19-D25 | Administrator (hoặc S4VP Payroll HR) | HR làm được chấm công, sản lượng, tạo / tính / gửi duyệt bảng lương; HR KHÔNG ghi sổ |
| D13-D18 (hoa hồng) | Administrator (hoặc S4VP Payroll Accountant) | Kế toán sửa kế hoạch, tính, duyệt |
| D25 duyệt nhiều cấp | Nhân viên E1024, E1020, E1018 tự đăng nhập | Chỉ khi bật cấp duyệt (mục G.2); người quay KHÔNG đăng nhập hộ |
| D26-D30 | Administrator (hoặc S4VP Payroll Accountant) | Ghi sổ, bill, file ngân hàng, phân tích chi phí là việc của kế toán |
| D31 | Nhân viên E1069 (công nhân) hoặc E1032 (kinh doanh) qua Employee Center | Người dùng tự bật Give Access và tự đăng nhập; người quay chỉ quay |

Khuyến nghị: quay toàn bộ bằng Administrator để không phải đổi vai trò giữa cảnh; Trang chủ khi đó ghi vai trò "Quản trị" /
"Administrator".

### B.2 Đường dẫn màn hình

Gốc: `https://td2937310.app.netsuite.com`. Ứng dụng là SPA, định tuyến bằng hash `#/<view>?k=v`.

| Màn hình | Đường dẫn tương đối | Menu (nếu bản deploy đã có commit 022406e) |
| --- | --- | --- |
| Trang chủ | `/spa/s4vp-payroll#/home` | Tab "S4 - Advanced Payroll" > Lương > "Màn hình S4 Advanced Payroll" |
| Chấm công kỳ quay | `/spa/s4vp-payroll#/attendance?period=37` | Tab ứng dụng: Chấm công / Attendance |
| Chạy lương (danh sách) | `/spa/s4vp-payroll#/payrollList?period=37` | Chạy lương / Run payroll |
| Một bảng lương | `/spa/s4vp-payroll#/payrollRun?id=<id bảng lương>` | bấm dòng trong danh sách |
| Kiểm tra bảng lương | `/spa/s4vp-payroll#/checkDetail?id=<id>` | nút "Nhật ký" / "Activity log" hoặc "Xem tất cả" |
| Hoa hồng | `/spa/s4vp-payroll#/commission` | Hoa hồng / Commission |
| Sản lượng - khoán tổ | `/spa/s4vp-payroll#/outputsV2` | Khác > Sản lượng - khoán tổ / More > Output - team piecework |
| Phân tích chi phí | `/spa/s4vp-payroll#/laborAnalytics` | Phân tích chi phí / Cost analysis |
| Nhân sự | `/spa/s4vp-payroll#/employees` | Nhân sự / Employees |
| In PDF (Suitelet) | `/app/site/hosting/scriptlet.nl?script=customscript_s4vp_sl_print&deploy=customdeploy_s4vp_sl_print&batch=<id>&doc=payslip&lang=vi` | In > Phiếu lương trong màn bảng lương |
| Cổng nhân viên | `/app/site/hosting/scriptlet.nl?script=customscript_s4vp_sl_my_payroll&deploy=customdeploy_s4vp_sl_my_payroll` (thêm `&view=pay` mở thẳng tab Phiếu lương) | Employee Center: tab "Lương của tôi" > Tự phục vụ > "Mở cổng nhân viên (phiếu lương, phép, đơn)" |
| Danh sách record (chỉ đọc, nhãn tiếng Việt) | `/app/common/custom/custrecordentrylist.nl?rectype=2546` (S4VP Bảng lương), `2589` (Phiếu sản lượng), `2685` (Hồ sơ nguồn chấm công), `2555` (Loại thu nhập), `2657` (Cấp duyệt) | Tab "S4 - Advanced Payroll" > Lương |
| Bút toán | `/app/accounting/transactions/journal.nl?id=<id>` | nút "Xem bút toán" rồi mở bản ghi |
| Hóa đơn bán hàng (cảnh hoa hồng) | `/app/accounting/transactions/custinvc.nl?id=<id>` | [CHỜ] chọn một hóa đơn Sao Mai 11/2026 có Sales Rep E1032 |

Nên dùng URL trực tiếp thay cho menu: tab menu vừa đổi tên ("S4 - Advanced Payroll", trung tâm BASIC còn sửa chưa commit) nên
menu trên account có thể khác.

### B.3 Đổi ngôn ngữ

1. NetSuite: menu Home > Set Preferences (Trang chủ > Thiết lập tùy chọn), tab General, mục Localization, ô Language: chọn
   "Tiếng Việt" cho bản VI, "English (U.S.)" cho bản EN. Bấm Save.
2. Tải lại trang SPA (F5). SPA đọc ngôn ngữ từ tùy chọn LANGUAGE của người dùng khi mở trang (`lib/i18n.js`: `vi_VN` -> vi,
   `en_*` -> en, mã khác -> en, lỗi đọc -> vi). Không có nút đổi ngôn ngữ trong SPA.
3. Không cần đăng xuất, không cần xóa cache trình duyệt. Bản bootstrap nhớ trong N/cache 300 giây có khóa gồm người dùng, vai trò
   VÀ ngôn ngữ, nên đổi ngôn ngữ nhận bản mới ngay.
4. Cache cần biết:
   - Bootstrap (công ty con, kỳ, danh mục): 300 giây. Mọi thao tác ghi thành công trên SPA làm mới ngay. Sửa bản ghi bằng form
     NetSuite (ví dụ bật cấp duyệt, sửa kỳ) thì tối đa 5 phút sau SPA mới thấy - chờ 5 phút hoặc bấm "Tải lại".
   - Phân tích chi phí: số liệu nhớ 300 giây, phần sổ cái các tháng đã qua nhớ 600 giây. Sau khi ghi sổ, nếu chưa thấy tháng mới
     thì dùng "Thao tác khác > Lập lại số liệu tháng ..." hoặc chờ 5 phút.
5. Ngôn ngữ PDF:
   - In từ SPA (menu "In"): theo ngôn ngữ người dùng, chỉ `vi` hoặc `en` (tham số `lang` gắn sẵn).
   - Song ngữ: sửa tay URL Suitelet in thành `&lang=bi` (nhãn dạng "Tiếng Việt / English"). Mặc định khi thiếu `lang` là `vi`.
   - Cổng nhân viên: PDF theo ngôn ngữ người dùng (`en*` -> en, còn lại vi); URL `&op=pdf&batch=<id>&lang=bi` cho song ngữ.
6. Định dạng số và ngày trong SPA KHÔNG đổi theo ngôn ngữ: tiền luôn dạng `1.234.567` (dấu chấm hàng nghìn, số âm trong ngoặc),
   ngày luôn `dd/mm/yyyy`. Ô tháng là `<input type="month">` của trình duyệt, hiển thị theo ngôn ngữ của Chrome (không theo
   NetSuite). Lời thoại EN nói "amounts in Vietnamese dong".

---

## C. Dữ liệu demo

### C.1 Trạng thái account tại 12/11/2026 (SuiteQL chỉ đọc)

| Mục | Hiện trạng | Cần có trước khi quay |
| --- | --- | --- |
| Nhân viên sub 14 | 116, mã E1017-E1132, tên tiếng Việt, email `smNNN.demo@example.com` | đủ |
| Loader giai đoạn | pr-paygroup, pr-masters, pr-masters2, pr-employees, pr-employees2, pr-hr (1 lỗi: hợp đồng SM-E026 "Ngày chấm dứt nằm ngoài thời hạn hợp đồng"), pr-accrue xong; pr-config đang chạy (131 / khoảng 280 dòng) | mọi giai đoạn của 6 kỳ + pr-roster, pr-docs, pr-time kỳ 202612 |
| Sales Rep | 12 NV kinh doanh (SM-E015 ... SM-E026) có `issalesrep = F` (cảnh báo WARN của loader); 0 hóa đơn Sao Mai có Sales Rep | bật Sales Rep tay rồi chạy pr-invoice-reps (366 hóa đơn) |
| Kỳ SAOMAI | 202601-202701 có, đều mở, công chưa khóa | 202607-202612 đã ghi sổ; 202701 mở, chưa khóa công |
| Kỳ DEFAULT 202612 (id 12, 01/2027) | công ĐÃ KHÓA (dữ liệu thử sub 13) | gói phải có commit 54007cd (khóa công xét theo nhóm lương) đã deploy, nếu không file chấm công 01/2027 báo "Kỳ đã khóa" |
| Bảng lương | 9 bảng, đều sub 13 (BL000001-BL000009, diễn giải "S4VP TEST ...") | Sao Mai 6 bảng R; bảng quay sẽ là BL0000xx tiếp theo |
| Hồ sơ nguồn | ZK-XUONG (id 102, 38 dòng đối chiếu, có mã 7 và 18, KHÔNG có 51, 52), ZK-KHO (id 101, 14 dòng), ZK-THU (sub 13) | giữ nguyên để có cảnh mã chưa đối chiếu |
| Cấp duyệt Sao Mai | 3 dòng (id 3, 2, 4) đang tắt: cấp 1 E1024 Lê Minh Vân, cấp 2 E1020 Đỗ Diệu Oanh, cấp 3 E1018 Lê Tuấn Vũ (tổng thực lĩnh từ 1.700.000.000) | bật bằng Suitelet loader `action=prapv&on=T` nếu quay duyệt nhiều cấp |
| Kế hoạch hoa hồng | KD-DUAN (id 5), BANLE-CH (id 4); cùng account còn TEST-KD-THANG, TEST-DMS-LAIGOP, TEST-DV-LICENSE (sub 13) | xem G.3 về tên "TEST" |
| Bảng đơn giá / tổ | GC-CONGDOAN (10 đơn giá); TO-CAT, TO-LAPRAP, TO-DONGGOI (37 thành viên); còn KHOAN-XD, S4VP-TO-NE (sub 13) | đủ |
| Ca | HC, C1, C2, C3, K1, K2 | đủ |
| Tham số pháp lý chưa đối chiếu | 0 (Trang chủ không hiện dải cảnh báo) | đủ |
| Khoản trích BH | 7 khoản; vendor là "S4VP TEST - Co quan BHXH" (2679) và "S4VP TEST - Cong doan" (2681) của sub 13 | XEM G.1 rủi ro 3: bill BHXH, công đoàn của Sao Mai |

### C.2 Bản ghi xuất hiện trên màn hình

Nhân viên (mã NetSuite - họ tên - chức danh - phòng ban):

| Mã kế hoạch | Mã trên màn hình | Họ tên | Vai trò trong video |
| --- | --- | --- | --- |
| SM-E001 | E1018 | Lê Tuấn Vũ | Giám đốc, duyệt cấp 3, ký bản in |
| SM-E004 | E1020 | Đỗ Diệu Oanh | Kế toán trưởng, duyệt cấp 2, ký bản in |
| SM-E006 | E1022 | Vũ Bảo Liên | Kế toán viên nghỉ thai sản 01/08/2026-31/01/2027: ngoại lệ trên bảng lương |
| SM-E008 | E1024 | Lê Minh Vân | Trưởng phòng nhân sự, duyệt cấp 1 |
| SM-E015 | E1032 | Nguyễn Tuấn Thắng | NV kinh doanh, hoa hồng KD-DUAN, cổng nhân viên |
| SM-E027 | E1043 | Nguyễn Kim Vân | Cửa hàng trưởng (hoa hồng quản lý 5%) |
| SM-E028 | E1044 | Ngô Công Lộc | NV bán lẻ (doanh số DMS) |
| SM-E049 | E1065 | Lê Quốc Tuấn | Quản đốc xưởng (chi phí 6271) |
| SM-E051 | E1067 | Lê Quốc Nam | Tổ trưởng TO-LAPRAP (hệ số 1,2) |
| SM-E053 | E1069 | Lê Thanh Sơn | Công nhân, chi tiết dòng lương, cổng nhân viên |
| SM-E055 | E1071 | Nguyễn Ngọc Tùng | Công nhân, mã máy mới 51 (mã cũ 7) |
| SM-E066 | E1081 | Trần Thanh Tuấn | Công nhân, mã máy mới 52 (mã cũ 18) |
| SM-E094 | E1110 | Ngô Văn Long | Kỹ thuật viên lương giờ (tab Giờ công) |
| SM-E104 | E1119 | Phạm Hữu An | Kỹ thuật viên, đơn công tác có tạm ứng 3.000.000 |
| SM-E110 | E1126 | Yamamoto Takeshi | Chuyên gia nước ngoài, giấy phép 79-2026-036582 còn hiệu lực đến 31/08/2028 |

Danh mục, chứng từ:

| Loại | Mã / ID | Tên | Số liệu, trạng thái |
| --- | --- | --- | --- |
| Hồ sơ nguồn chấm công | ZK-XUONG | Máy ZKTeco xưởng Bình Dương (attlog), layout Z, nhận diện chỉ theo bảng đối chiếu | file `ZK-XUONG_2026-12.dat`: 1.602 dòng, mã 51 và 52 mỗi mã 44 dòng (88 dòng "Chưa đối chiếu") |
| Hồ sơ nguồn chấm công | ZK-KHO | Máy ZKTeco kho Thủ Đức | file `ZK-KHO_2026-12.dat`: 618 dòng, ca K1 / K2 |
| Phiếu sản lượng (quay trực tiếp) | SL-202612-TO-LAPRAP-104 (số phiếu hệ thống tự cấp) | Tổ Lắp ráp tủ điện, ngày phiếu 29/01/2027, GC-CONGDOAN, chia F | LAP-TU-PP 19 Tủ x 240.000 = 4.560.000; LAP-TU-DK 7 Tủ x 360.000 = 2.520.000; DAU-DAY 1.734 Điểm x 2.500 = 4.335.000; tổng 11.415.000 |
| Phiếu sản lượng (nạp trước) | 14 phiếu còn lại trong `PhieuKhoan_2026-12.csv` | 3 tổ, 5 tuần | tổng 15 phiếu 115.723.000 [CHỜ: coordinator nạp 14 phiếu ở trạng thái Đã duyệt trước khi quay] |
| Doanh số ngoài | DMS, 458 dòng `DMS_CuaHang_2026-12.csv` | Showroom Quận 7 (Sao Mai) | doanh thu 1.164.645.000; hoa hồng ước tính NV bán lẻ 17.623.295, cửa hàng trưởng 881.165 (summary.json, ước tính) |
| Kế hoạch hoa hồng | KD-DUAN | Hoa hồng kinh doanh dự án theo lãi gộp đã thu, lũy kế quý | thành phần "Hoa hồng theo % đạt chỉ tiêu", ngưỡng 80%, quản lý 3% |
| Kế hoạch hoa hồng | BANLE-CH | Hoa hồng bán lẻ cửa hàng theo doanh thu DMS | "Doanh thu bán lẻ" 1,5%; "Thưởng khách mới" 1% (khách mới 90 ngày); quản lý 5% |
| Dự án | DA-SM-01 ... DA-SM-06 | ví dụ "Lắp đặt trạm biến áp KCN Long Hậu" | giờ Time đã duyệt |
| Vendor cơ quan thu | V065, V066, V067 | Liên đoàn Lao động TP. Hồ Chí Minh (Sao Mai); Bảo hiểm xã hội TP. Hồ Chí Minh (Sao Mai); Thuế cơ sở TP. Hồ Chí Minh (Sao Mai) | xem G.1 rủi ro 3 |
| Tài khoản | 622, 6271, 6411, 6421, 3341, 3335, 3383, 3384, 3386, 3382, 33881 (đoàn phí), 3351, 3348, 1411 | tên tiếng Việt | 622 và 6271 là loại COGS (giá vốn), 6411 / 6421 là Expense |
| Bảng lương quay | BL0000xx [CHỜ] | "Lương Sao Mai SAOMAI-202701" (VI) | dự kiến 114 người; tổng thu nhập ước tính khoảng 1,88 tỷ (chưa gồm ăn ca, trích tháng 13) [CHỜ số thật] |

### C.3 Tiêu chí "dữ liệu đẹp"

| Tiêu chí | Đánh giá | Việc cần làm |
| --- | --- | --- |
| Tên công ty, người tiếng Việt | Đạt: 116 tên Việt, 1 tên Nhật cho chuyên gia; phòng ban có hậu tố "(Sao Mai)" | không |
| Không có nhãn test / abc / NV01 | KHÔNG ĐẠT ở dropdown dùng chung: công ty con khác ("Parent", "Australia", "Công ty TNHH S4VN TT99"), kế hoạch TEST-*, bảng KHOAN-XD, tổ S4VP-TO-NE, nguồn ZK-THU, vendor BH "S4VP TEST - ..." | G.3: không mở các dropdown này lâu; đề xuất người dùng cho phép đặt inactive bản ghi TEST hoặc đổi tên |
| Số tiền thực tế, không tròn | Lương cơ bản tròn như thực tế (13.900.000, 7.000.000); thực lĩnh, BH, thuế, khoán, hoa hồng lẻ | không |
| Định dạng số, ngày theo ngôn ngữ | SPA luôn `1.234.567` và `dd/mm/yyyy` cả bản EN | nói rõ trong lời thoại EN; không coi là lỗi |
| Đủ 12 kỳ cho dashboard | KHÔNG ĐẠT: kế hoạch chỉ ghi sổ 6 kỳ (SAOMAI-202607 ... 202612) + kỳ quay = 7 tháng. "Xu hướng 12 tháng" và cổng nhân viên "12 kỳ" sẽ có 5 cột trống; "Cùng kỳ năm trước" không có số | Đề xuất (chưa làm): mở rộng `tools/payroll_plan.js` của repo demo sinh thêm 5 kỳ câu chuyện 01-05/2026 (kỳ SAOMAI-202602 ... SAOMAI-202606 đã có trên account), chạy loader cùng giai đoạn và chạy lương theo runbook mục 4 trước kỳ 202606. Khi đó có 11 kỳ ghi sổ + kỳ quay = 12. Nếu muốn đúng 01-12/2026 thì thêm kỳ 202601 (cần ngày vào làm, phép, quyết định điều chỉnh tương thích) |
| Đủ trạng thái | Bảng lương: H, B/C, P, A, R xuất hiện trong video; J, V không (tránh). Chứng từ công: H, P, A. Phiếu sản lượng: H, P, A, C. Hoa hồng: D, A, P | không quay "Từ chối", "Đảo" |
| Ngoại lệ đáng chú ý | Mã máy 51, 52 chưa đối chiếu; phiếu trễ / thiếu lượt chấm đề xuất từ máy; E1022 nghỉ thai sản cả kỳ (công 0, không đóng BH); thực lĩnh NV kinh doanh lệch nhiều so với kỳ trước (KD-DUAN tính lũy kế quý, quý mới bắt đầu) | ghi tên người thật thấy được ở bước chạy thử |
| Số khớp giữa màn hình | Tổng thực lĩnh trên thẻ bảng lương = Có 3341 trên bút toán = tổng file ngân hàng; tổng hoa hồng đã duyệt = dòng HOAHONG trên bảng lương; phiếu khoán 11.415.000 = tổng chia tổ | kiểm ở bước chạy thử, ghi vào H |

### C.4 Danh mục do gói quản lý: có tên tiếng Anh không?

| Danh mục | Tên trên account | Tiếng Anh? |
| --- | --- | --- |
| Loại thu nhập (20) | Lương cơ bản, Phụ cấp cố định, Ăn ca, Làm thêm ngày thường, Lương khoán, Hoa hồng kinh doanh, Phụ cấp độc hại, ca đêm xưởng... | KHÔNG: một trường diễn giải, tạo bằng tiếng Việt khi "Nạp mặc định VN". Bản EN hiện tên tiếng Việt trên SPA và trên PDF |
| Loại nghỉ (5) | Phép năm, Việc riêng có lương, Ốm đau (BHXH trả), Thai sản (BHXH trả), Nghỉ không lương | KHÔNG |
| Khoản trích BH (7) | BHXH hưu trí, tử tuất; BHXH ốm đau, thai sản; Bảo hiểm TNLĐ-BNN; Bảo hiểm y tế; Bảo hiểm thất nghiệp; Kinh phí công đoàn; Đoàn phí công đoàn | KHÔNG (cả trong memo bill cơ quan thu) |
| Trạng thái (bảng lương, chứng từ, phiếu, hoa hồng) | trên SPA lấy từ bảng chữ vi / en | CÓ trên SPA. Danh sách record NetSuite (customlist) chỉ tiếng Việt |
| Tên record type, trường, menu NetSuite | "S4VP Bảng lương", "Lương", "Phiếu lương của tôi"... | KHÔNG (SDF chỉ tiếng Việt, chưa có Translation Collection) |
| Tài khoản, phòng ban, class, địa điểm, dự án | tiếng Việt | dữ liệu khách hàng, giữ nguyên |
| Diễn giải hoa hồng (các bước tính) | song ngữ trong lõi | CÓ; tên thành phần, kế hoạch là dữ liệu tiếng Việt |

---

## D. Video DEMO (mục tiêu 14 phút sau dựng)

Điều kiện trước khi bấm máy (kiểm lại ngay trước khi quay, ghi kết quả vào mục H):
1. Kỳ SAOMAI-202607 ... SAOMAI-202612 có bảng lương "Đã ghi sổ"; bảng tính hoa hồng các tháng 202607-202612 "đã vào bảng lương".
2. Kỳ SAOMAI-202701: có phân ca, đơn nghỉ / OT / công tác đã duyệt, Time đã duyệt; CHƯA có lượt chấm, CHƯA xử lý chấm công,
   công CHƯA khóa, CHƯA có bảng lương; 14 phiếu khoán khác đã duyệt; chưa có doanh số DMS tháng 2027-01.
3. File `DMS_CuaHang_2026-12.csv` đã sinh lại với cột `employee` là mã NetSuite (E10xx) hoặc email `smNNN.demo@example.com`
   (file hiện ghi SM028... sẽ báo lỗi nhân viên, xem G.1 rủi ro 4).
4. Ba file đầu vào chép vào máy quay: `C:\Claude\s4_netsuite_demo_saomai\deliverables\payroll\ZK-XUONG_2026-12.dat`,
   `ZK-KHO_2026-12.dat`, `DMS_CuaHang_2026-12.csv`.
5. Trình duyệt đã đăng nhập vai trò Administrator, ngôn ngữ đúng bản đang quay, ô "Công ty con" chọn Sao Mai.

Cột "Thao tác" dùng nhãn chính xác; chữ trong ngoặc kép là chữ trên màn hình. "Chờ" là thời gian thật, cắt khi dựng.

| # | Cảnh | Màn hình / đường dẫn | Thao tác VI | Thao tác EN | Kết quả phải thấy VI | Kết quả phải thấy EN | Vùng phóng to | Lời thoại VI | Lời thoại EN | Thời lượng | Chụp ảnh? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Mở đầu tại màn chấm công | `/spa/s4vp-payroll#/attendance?period=37` | Ô "Công ty con" (góc phải thanh tab) chọn "Công ty TNHH Thương mại Sao Mai Demo"; ô "Kỳ lương" chọn "SAOMAI-202701" | "Subsidiary" chọn Sao Mai; "Pay period" chọn "SAOMAI-202701" | Tiêu đề "Công kỳ SAOMAI-202701"; dòng phụ "Kỳ 01/01/2027 - 31/01/2027 · Nhóm lương ... · Công chuẩn 21 ngày · [CHỜ] nhân viên"; thanh bước "Thu thập" sáng | "Attendance for period SAOMAI-202701"; stepper "Collect" active | Thanh tab + tiêu đề | Đây là Công ty Sao Mai, 114 người, ba khối kinh doanh. Cuối kỳ, nhân sự bắt đầu từ dữ liệu chấm công. | This is Sao Mai, a 114-person company with trading, manufacturing and service units. Month-end starts with time clock data. | 0:30 | Không |
| D2 | Mở hộp thoại nạp chấm công | cùng màn | Bấm "Nạp chấm công"; ô "Hồ sơ nguồn" chọn "ZK-XUONG"; ô "File chấm công (.csv, .txt, .dat)" chọn `ZK-XUONG_2026-12.dat` | Click "Import time clock"; "Punch source" = "ZK-XUONG"; "Time clock file (.csv, .txt, .dat)" = the .dat file | Tiêu đề hộp thoại "Nạp chấm công từ máy chấm công"; dòng "ZK-XUONG_2026-12.dat: 1602 dòng, 0.0x MB" | "Import time clock punches"; "...: 1602 lines, ... MB" | Hộp thoại | File xuất thẳng từ máy ZKTeco của xưởng. Không cần sửa lại trên Excel. | The file comes straight from the factory's ZKTeco device. No Excel clean-up needed. | 0:25 | Không |
| D3 | Xem trước, thấy mã chưa đối chiếu | hộp thoại | Bấm "Xem trước"; chờ 3-10 giây | Click "Preview" | Bước "Xem trước, đối chiếu mã"; thẻ đếm có "Chưa đối chiếu" 88, "Mới" [CHỜ khoảng 1.514], "Trùng" 0, "Kỳ đã khóa" 0; khung "Mã chưa đối chiếu (2)" có mã 51 và 52, mỗi mã 44 dòng | "Preview, map IDs"; "Unmapped" 88; "Unmapped IDs (2)" | Thẻ đếm và khung mã chưa đối chiếu | Hệ thống kiểm từng dòng trước khi ghi. Hai mã 51 và 52 chưa gắn với nhân viên nào. | Every line is checked before anything is saved. Device IDs 51 and 52 are not linked to any employee yet. | 0:30 | Có (F01) |
| D4 | Gán mã máy mới ngay trên hộp thoại | hộp thoại, khung "Mã chưa đối chiếu" | Dòng mã 51: ô "Chọn nhân viên..." gõ "Tùng" chọn "E1071 Nguyễn Ngọc Tùng"; dòng 52: gõ "Trần Thanh Tuấn" chọn E1081; để nguyên ô "Áp dụng cho mọi máy của nguồn (bỏ trống thiết bị)"; bấm "Lưu đối chiếu (2)" | "Select an employee..." pick E1071, E1081; click "Save mapping (2)" | Thông báo "Đã lưu 2 dòng đối chiếu."; xem trước tự chạy lại; "Chưa đối chiếu" = 0; nút "Ghi [CHỜ] lượt chấm mới" | "Mapping lines saved: 2."; "Unmapped" 0; button "Write ... new punches" | Hai dòng chọn nhân viên | Hai công nhân vừa đăng ký lại vân tay. Gán mã một lần, hệ thống nhớ cho các lần nạp sau. | Two workers re-registered their fingerprints. Map the new IDs once and future imports use them. | 0:35 | Có (F01, chụp sau khi chọn, trước khi lưu) |
| D5 | Ghi lượt chấm | hộp thoại | Bấm "Ghi 1.602 lượt chấm mới" (số theo màn hình); chờ 30-90 giây (thanh tiến độ theo lượt) | Click "Write 1,602 new punches" (label shows `Write 1.602 ...`) | "Đã ghi xong"; "Đã ghi 1.602 lượt chấm · bỏ qua 0 (trùng) · 0 lỗi · 0 chưa đối chiếu · 0 thuộc kỳ đã khóa"; gợi ý "Bước tiếp theo: bấm Xử lý chấm công máy..." | "Writing finished"; "Written: ..."; "Next step: click Process punches..." | Dòng kết quả | Ghi theo lượt, không giới hạn số dòng. Nạp lại cùng file thì dòng cũ được bỏ qua là trùng. | Punches are written in rounds with no line limit. Re-importing the same file skips duplicates. | 0:20 | Không |
| D6 | Nạp file kho (tua nhanh) | hộp thoại | Bấm "Xem trước lại" sau khi đổi "Hồ sơ nguồn" = "ZK-KHO" và file `ZK-KHO_2026-12.dat`; "Ghi 618 lượt chấm mới"; bấm "Đóng" | Same with "ZK-KHO"; "Preview again"; write; "Close" | "Chưa đối chiếu" 0; ghi 618 | "Unmapped" 0; 618 written | không | Kho Thủ Đức dùng máy riêng, hai ca. Cùng một thao tác. | The warehouse has its own device and two shifts. Same steps. | 0:10 | Không |
| D7 | Xử lý chấm công máy | Chấm công | Bấm "Thao tác khác" > "Xử lý chấm công máy"; chờ tác vụ nền 3-6 phút (116 người x 31 ngày vượt 3.000 ô nên chạy Map/Reduce) | "More actions" > "Process punches" | Khung "Đang xử lý nền", "Xử lý chấm công máy đang chạy nền"; khi xong: "Đã xử lý chấm công: [CHỜ] phiếu ngoại lệ, [CHỜ] đơn làm thêm đề xuất (tạm giữ, chờ duyệt)." | "Background processing"; "Punches processed. Proposed on hold, pending approval: ..." | Dải thông báo | Hệ thống so lượt chấm với lịch phân ca. Đi trễ, về sớm, thiếu lượt chấm, làm thêm đều thành phiếu đề xuất. | Punches are matched against the shift roster. Late arrivals, early leaves, missing punches and overtime become proposals. | 0:30 | Không |
| D8 | Duyệt đề xuất | Chấm công, khung "Ngoại lệ cần xử lý (n)" | Ô tìm "Tìm nhân viên, ngày, loại ngoại lệ" gõ "trễ"; dòng "Phiếu ngoại lệ", ghi chú "Đi trễ N phút", nhãn "hệ thống đề xuất từ chấm công": bấm "Gửi duyệt" rồi "Duyệt". Gõ tìm "làm thêm", một "Đơn làm thêm" thứ Bảy: "Gửi duyệt", "Duyệt" | Search "late" ("Late by N min"); "Submit", "Approve"; search "Overtime request" | Trạng thái dòng từ "tạm giữ" -> "chờ duyệt" -> "đã duyệt"; thông báo "Đã gửi duyệt." / "Đã duyệt." | "on hold" -> "pending approval" -> "approved"; "Submitted." / "Approved." | Một dòng ngoại lệ | Phiếu đề xuất ở trạng thái tạm giữ. Hệ thống không tự trừ lương, quản lý duyệt từng trường hợp. | Proposals stay on hold. Nothing is deducted automatically, a manager approves each case. | 0:45 | Có (F02) |
| D9 | Tổng hợp công | Chấm công | Bấm nút chính "Tổng hợp công" (hoặc "Tổng hợp lại"); chờ 30-120 giây; bấm một ô ngày của E1071 trên lưới "Bảng công tháng" | "Build attendance" / "Rebuild"; click a day cell | "Đã tổng hợp công cho [CHỜ] nhân viên."; khung "Ngày đang chọn" có tab "Lượt chấm" với giờ vào / ra, thiết bị XUONG-01 | "Attendance built (employees: ...)"; "Selected day", tab "Punches" | Lưới + khung ngày | Bảng công tháng lấy từ phân ca, lượt chấm và đơn đã duyệt. Bấm một ô là thấy căn cứ. | The monthly sheet combines roster, punches and approved requests. One click shows the evidence. | 0:25 | Có (F03) |
| D10 | Phiếu khoán tổ | `#/outputsV2` (Khác > Sản lượng - khoán tổ) | Bấm "Tạo phiếu"; "Loại phiếu" = Tổ; "Ngày phiếu" 29/01/2027 (date picker); "Bảng đơn giá" = GC-CONGDOAN; "Tổ" = TO-LAPRAP; "Cách chia tiền" = ngày công x hệ số; "Diễn giải" = "Khoán tổ Lắp ráp tủ điện tuần 25/01-31/01"; bấm "Tạo và nhập sản lượng"; "Thêm dòng" 3 lần: LAP-TU-PP 19, LAP-TU-DK 7, DAU-DAY 1734; bấm "Lưu sản lượng" | "New entry"; "Entry type" Team; "Entry date"; "Rate table"; "Team"; "Split method"; "Description" = "Assembly team piecework, week 25-31 Jan"; "Create and enter output"; "Add line"; "Save output" | Đơn giá tự điền 240.000 / 360.000 / 2.500 (dòng "Đơn giá lấy từ bảng đơn giá hiệu lực theo ngày phiếu..."); "Tổng thành tiền" 11.415.000; "Đã lưu sản lượng phiếu ..." | Rates filled; "Total amount" 11.415.000; "Output of entry ... saved." | Lưới dòng sản lượng | Tổ lắp ráp khai khối lượng theo công đoạn. Đơn giá lấy từ bảng đơn giá, không gõ tay. | The assembly team enters volumes per operation. Rates come from the rate table, not typed by hand. | 0:45 | Không |
| D11 | Chia tiền tổ | cùng phiếu, bước "Thành viên", "Chia tiền" | Bấm "Nạp thành viên từ tổ"; bấm "Chia tiền" | "Load members from the team"; "Split pay" | 15 thành viên, cột "Căn cứ" dạng "N công x 1,2" cho tổ trưởng E1067; "Tổng chia bằng thành tiền phiếu."; "Đã chia tiền phiếu ..." | "N days x 1.2"; "The split total equals the entry amount." | Bảng chia | Tiền khoán chia theo ngày công nhân hệ số. Tổng chia khớp thành tiền phiếu đến từng đồng. | Team pay is split by days worked times a factor. The split matches the entry total to the last dong. | 0:30 | Có (F04) |
| D12 | Gửi duyệt, duyệt phiếu | cùng phiếu | "Gửi duyệt" > xác nhận "Đồng ý"; "Duyệt" | "Submit for approval" > "OK"; "Approve" | "Đã gửi duyệt phiếu ..."; trạng thái "Đã duyệt"; thẻ "Đã duyệt, chưa vào lương" | "Entry ... submitted for approval."; "Approved" | Thanh bước phiếu | Phiếu đã duyệt tự vào bảng lương của kỳ. | Approved entries flow into the payroll of the period. | 0:15 | Không |
| D13 | (Tùy chọn) Hóa đơn có Sales Rep | tab mới: hóa đơn Sao Mai [CHỜ id] | Mở hóa đơn, phóng ô "Sales Rep" = Nguyễn Tuấn Thắng | Same; NetSuite native form in English | Sales Rep là E1032 | same | Ô Sales Rep | Doanh số dự án lấy thẳng từ hóa đơn NetSuite, theo người bán trên chứng từ. | Project sales come straight from NetSuite invoices, credited to the sales rep. | 0:20 | Không |
| D14 | Nạp doanh số cửa hàng từ DMS | `#/commission`, tab "Doanh số ngoài" | Bấm "Nạp doanh số ngoài"; "Hệ thống nguồn" = DMS; "Hoặc chọn file CSV" chọn `DMS_CuaHang_2026-12.csv`; xem "Ánh xạ cột" tự nhận; bấm "Kiểm tra"; bấm "Ghi 458 dòng"; chờ 30-60 giây | "Import external sales"; "Source system" = DMS; "Or choose a CSV file"; "Column mapping"; "Check"; "Write 458 rows" | "Kiểm tra xong: 458 dòng hợp lệ."; "Đã ghi 458 dòng doanh số ngoài. Bấm Tính..." | "Check complete: 458 valid rows."; "458 external sales rows written..." | Lưới kiểm tra | Cửa hàng bán trên phần mềm DMS. Doanh số nạp vào, kiểm lỗi từng dòng rồi mới ghi. | The showroom sells through a separate DMS. Sales are imported and checked line by line before saving. | 0:35 | Có (F06) |
| D15 | Tính hoa hồng tháng | tab "Bảng tính" | Ô "Tháng" chọn 2027-01; bấm "Tính"; chờ 10-60 giây | "Calculation" tab; "Month" 2027-01; "Calculate" | "Đã tính hoa hồng cho [CHỜ] nhân viên."; thẻ "Tổng cơ sở tính", "Tổng hoa hồng phải trả" [CHỜ khoảng 18,5 triệu cho cửa hàng], "Nhân viên"; nếu có: cảnh báo "Doanh số chưa ai được ghi nhận" | "Commissions calculated for ... employees."; "Total base", "Total commission payable"; "Sales not credited to anyone" | Thẻ chỉ số | Hoa hồng tính theo kế hoạch đã cấu hình. Doanh số chưa gắn người được nêu riêng để không bị bỏ sót. | Commission follows the configured plans. Sales not credited to anyone are flagged so nothing is missed. | 0:30 | Không |
| D16 | Diễn giải từng đồng | tab "Bảng tính", dòng nhân viên | Chọn dòng E1044 Ngô Công Lộc; khung phải tab "Diễn giải" (xem "Thành phần", "Các bước tính"); tab "Phân đoạn". Nếu đã có dữ liệu KD-DUAN: đổi "Tháng" 2026-12, chọn E1032 Nguyễn Tuấn Thắng, xem "% đạt", "Hoa hồng quản lý", tab "Giao dịch" | Row E1044; "Explanation" ("Components", "Calculation steps"); "Segments"; optional month 2026-12, E1032, "Attainment", "Transactions" | Khung "Chi tiết kết quả": "Cơ sở trong kỳ", "Phải trả vào lương"; các bước tính có số tiền; tab Phân đoạn có "Cửa hàng (Sao Mai)", "Khối Thương mại", "Showroom Quận 7 (Sao Mai)" | "Result details": "Base this period", "Payable through payroll"; steps in English, component and segment names stay Vietnamese | Khung diễn giải | Mỗi khoản hoa hồng có diễn giải từng bước. Chi phí đi về đúng phòng ban, cửa hàng tạo ra doanh số. | Every commission has a step-by-step explanation. Its cost goes to the department and store that made the sale. | 0:35 | Có (F05) |
| D17 | Mô phỏng | tab "Mô phỏng" | "Kế hoạch" = BANLE-CH; "Cơ sở (doanh thu / lãi gộp)" gõ 250000000 | "Simulation"; "Plan" BANLE-CH; "Base (revenue / gross profit)" 250000000 | Khung "Kết quả mô phỏng", "Hoa hồng" [CHỜ, dự kiến 3.750.000 cho thành phần 1,5%] | "Simulation result", "Commission" | Khung kết quả | Nhân viên hỏi bán thêm bao nhiêu thì được bao nhiêu. Mô phỏng trả lời ngay. | Sales staff ask what extra sales would earn. The simulator answers instantly. | 0:20 | Không |
| D18 | Duyệt bảng tính hoa hồng | tab "Bảng tính", tháng 2027-01 | Bấm "Duyệt" > "Đồng ý" | "Approve" > "OK" | "Đã duyệt bảng tính ..." | "... approved." | Thanh nút | Duyệt xong, hoa hồng tự vào bảng lương của kỳ. | Once approved, commission flows into the period's payroll. | 0:15 | Không |
| D19 | Khóa công | `#/attendance?period=37` | Bấm nút chính "Khóa công"; đọc hộp xác nhận (có câu "Còn N ngoại lệ chưa xử lý..." nếu còn); "Đồng ý"; chờ 30-120 giây | "Lock attendance" > "OK" | "Đã khóa công của kỳ."; trạng thái "Đã khóa công"; nút chính đổi thành "Sang chạy lương" | "Attendance of the period is locked."; "Go to payroll" | Thanh bước | Khóa công chốt số liệu. Sau khóa, chứng từ của kỳ không sửa được nữa. | Locking freezes the attendance. Documents of the period can no longer change. | 0:25 | Không |
| D20 | Tạo bảng lương | bấm "Sang chạy lương" -> `#/payrollList` | Ô "Kỳ lương" chọn SAOMAI-202701; "Tạo bảng lương"; "Diễn giải" gõ "Lương Sao Mai SAOMAI-202701"; "Tạo" | "Pay period"; "New payroll batch"; "Description" = "Sao Mai payroll SAOMAI-202701"; "Create" | Mở màn "Bảng lương kỳ SAOMAI-202701", trạng thái "Tạm giữ", thanh bước "Chuẩn bị" | "Payroll for period SAOMAI-202701", "On hold", "Prepare" | Tiêu đề | Bảng lương mới cho công ty và kỳ đã chọn. | A new payroll batch for the selected company and period. | 0:20 | Không |
| D21 | Tải nhân viên | màn bảng lương | Bấm "Tải nhân viên"; chờ 20-60 giây | "Load employees" | "Đã nạp 114 người" [CHỜ]; dòng "Giờ công: nhận ... dòng timesheet" | "..." | Lưới nhân viên | Hệ thống nạp người đang làm trong kỳ, công đã khóa và giờ dự án từ Time. | The batch loads active employees, locked attendance and project hours from Time. | 0:15 | Không |
| D22 | Tính lương | màn bảng lương | Bấm "Tính lương"; chờ 1-3 phút (114 người dưới ngưỡng 120 nên tính trực tiếp) | "Calculate" | "Đã tính xong, không có lỗi" hoặc "Đã tính, có n nhân viên lỗi - xem tab Cần soát"; 4 thẻ "Thực lĩnh phải chi", "Bảo hiểm phải nộp", "Thuế TNCN phải nộp", "Tổng chi phí công ty" có "Tăng / Giảm ... so với kỳ SAOMAI-202612" | "Calculated with no errors"; "Net pay to disburse", "Insurance payable", "PIT payable", "Total company cost", "Up/Down ... from period SAOMAI-202612" | 4 thẻ | 114 người, ba khối, tính trong vài phút. So sánh với kỳ trước hiện ngay trên thẻ. | 114 people across three units, calculated in minutes. The comparison with last period is right on the cards. | 0:30 | Có (F07) |
| D23 | Chi tiết một công nhân | lưới "Nhân viên", ô tìm "Tên, mã, số tiền" gõ "E1069" | Chọn dòng Lê Thanh Sơn; khung chi tiết tab "Thu nhập" (Lương cơ bản, Lương khoán, Làm thêm..., Phụ cấp độc hại, ca đêm xưởng, Ăn ca), "Bảo hiểm", "Thuế TNCN" | Search "E1069"; tabs "Earnings", "Insurance", "PIT" | Thu nhập có dòng nguồn "Sản lượng"; tab Bảo hiểm có "Căn cứ", "Tỷ lệ NLĐ" 8% / 1,5% / 1%; tab Thuế có "Giảm trừ bản thân", "Thu nhập tính thuế" | Columns "Wage base", "Employee rate"; "Personal deduction", "Assessable income"; earning names stay Vietnamese | Khung chi tiết | Lương cơ bản, khoán, làm thêm, phụ cấp ca đêm trên cùng một dòng. BHXH và thuế TNCN có căn cứ rõ ràng. | Base pay, piecework, overtime and night allowance on one line. Social insurance (BHXH) and PIT (personal income tax) show their basis. | 0:40 | Có (F08) |
| D24 | Soát cảnh báo | khung "Kiểm tra trước khi duyệt" | Tab "Cần xử lý"; tìm "E1022" (Vũ Bảo Liên, nghỉ thai sản: công 0, không đóng BH) và một cảnh báo thực lĩnh lệch so kỳ trước; bấm "Mở" một mục; ô "Ghi chú (bắt buộc khi đóng cảnh báo)" gõ "Nghỉ thai sản theo đơn đã duyệt"; bấm "Chấp nhận" | "To do"; "Open"; "Note (required to close a check)" = "Maternity leave per approved request"; "Accept" | Mục chuyển "Đã chấp nhận"; số "điểm cần xem" giảm | "Accepted" | Bảng kiểm tra | Hệ thống tự soát trước khi duyệt. Mỗi cảnh báo được đóng kèm ghi chú và lưu nhật ký. | Built-in checks run before approval. Each warning is closed with a note and logged. | 0:35 | Có (F09) |
| D25 | Gửi duyệt và duyệt | màn bảng lương | Một cấp (mặc định): "Gửi duyệt" > "Đồng ý"; rồi "Duyệt" > "Đồng ý". Nhiều cấp (chỉ khi G.2 đã chuẩn bị): sau "Gửi duyệt", khung "Các cấp duyệt" hiện Cấp 1-3; người duyệt từng cấp tự đăng nhập và bấm "Duyệt cấp 1/2/3" | "Submit for approval"; "Approve"; multi-level "Approval levels", "Approve level n" | "Đã gửi duyệt" -> trạng thái "Chờ duyệt" -> "Đã duyệt bảng lương", trạng thái "Đã duyệt, chờ ghi sổ" | "Submitted for approval" -> "Pending approval" -> "Batch approved", "Approved, pending release" | Huy hiệu trạng thái | Bảng lương qua duyệt trước khi ghi sổ. Đã duyệt thì số liệu bị khóa. | The batch is approved before posting. Once approved, figures are locked. | 0:30 | Không |
| D26 | Bút toán và ghi sổ | tab "Bút toán" | Xem "Bút toán dự kiến"; ô tìm gõ "622"; bấm "Ghi sổ" > "Đồng ý"; chờ 20-90 giây; tab "Bút toán" giờ là "Bút toán đã ghi sổ"; menu "In" > "Xem bút toán" hoặc mở JE trên NetSuite | "Journal" tab, "Journal preview"; "Release" > "OK"; "Released journal" | "Đã ghi sổ bảng lương"; trạng thái "Đã ghi sổ"; Nợ 622 (công nhân xưởng, theo dự án dịch vụ), 6271 (quản đốc), 6411, 6421; Có 3341, 3335, 3383, 3384, 3386, 3382, 33881, 3351; cột "Phòng ban / địa điểm / dự án"; Tổng Nợ = Tổng Có | "Batch released"; memos in English (language of the user who releases); account names Vietnamese | Bảng bút toán | Một bút toán cho cả bảng lương. Chi phí nhân công trực tiếp vào 622, bán hàng 6411, quản lý 6421, chi tiết theo phòng ban và dự án. | One journal entry for the whole batch. Direct labor goes to 622, selling to 6411, admin to 6421, by department and project. | 0:45 | Có (F10) |
| D27 | Bill cơ quan thu | tab "Bill cơ quan thu" | Bấm "Lập bill cơ quan thu" > "Đồng ý" | "Agency bills"; "Create agency bills" > "OK" | "Đã lập 3 bill"; danh sách bill BHXH, công đoàn, thuế | "Created 3 ..."; bill memos stay Vietnamese | Danh sách bill | Bill nộp BHXH, công đoàn, cơ quan thuế được lập tự động. | Bills for social insurance, the union fund and the tax authority are created automatically. | 0:15 | Không |
| D28 | File chi lương ngân hàng | menu "In" | "In" > "File chi lương ngân hàng" (cần người dùng đồng ý tải file, xem G.4) | "Print" > "Bank payment file" | Tải `ChiLuong_BL0000xx_SAOMAI-202701.csv` | same file name | Thanh tải xuống | File chi lương chuẩn CSV, tổng khớp số thực lĩnh. | A standard CSV payment file whose total matches net pay. | 0:15 | Không |
| D29 | Phiếu lương PDF | menu "In" | "In" > "Phiếu lương"; tab mới mở PDF; cuộn tới trang E1069 | "Print" > "Payslips" | PDF tiếng Việt: thu nhập, khấu trừ, thực lĩnh, "bằng chữ" | PDF English labels; net pay in words still Vietnamese | Một trang phiếu | Phiếu lương in một chạm cho cả công ty, mỗi người một trang. | Payslips for the whole company in one click, one page per person. | 0:25 | Có (F11) |
| D30 | Phân tích chi phí | `#/laborAnalytics` | "Tháng" 2027-01; "So với" = "Tháng trước"; xem thẻ "Chi phí lao động", "Chi phí lao động / Doanh thu", "Lao động trong giá vốn"; "Xu hướng 12 tháng"; "Vì sao thay đổi"; "Chiều phân rã" = Class rồi Dự án; bấm dòng "Khối Sản xuất" | "Month"; "Compare with" = "Previous month"; "Labor cost", "Labor cost / Revenue", "Labor in cost of goods sold"; "12-month trend"; "Why it changed"; "Breakdown dimension" | Cầu biến động có "Lương khoán, sản lượng", "Làm thêm"; xu hướng có 7 tháng dữ liệu [CHỜ 12 nếu bổ sung]; phân rã tới nhân viên | "Piecework, output pay", "Overtime"; 7 bars | Cầu biến động, xu hướng | Chi phí lương đã ghi sổ thành số liệu quản trị. Biết vì sao tăng, khối nào tăng, trong giá vốn bao nhiêu. | Posted payroll becomes management data. See why labor cost moved, where, and how much sits in cost of goods sold. | 0:45 | Có (F12) |
| D31 | Cổng nhân viên | Employee Center của E1069 (hoặc E1032), tab "Lương của tôi" | Người dùng đăng nhập sẵn; mở cổng: tab "Tổng quan" (biến động thu nhập, "Thực lĩnh kỳ gần nhất"), tab "Phiếu lương" chọn kỳ mới nhất, "Tải PDF"; rồi đổi khung hình 390 x 844 và lặp tab Tổng quan | "Overview" ("Pay trend", "Latest net pay"), "Payslips", "Download PDF" | Số định danh hiện dạng che; phiếu kỳ SAOMAI-202701 có cùng thực lĩnh như D23 | same in English | Thẻ thực lĩnh; màn điện thoại | Nhân viên tự xem phiếu lương, phép và lập đơn trên điện thoại. Nhân sự bớt trả lời câu hỏi. | Employees view payslips and leave, and file requests from their phone. HR answers fewer questions. | 0:35 | Có (F13, F14, F15) |
| D32 | Kết | Chạy lương, danh sách | Quay lại `#/payrollList`, dòng bảng lương "Đã ghi sổ" | "Released" | Dòng bảng lương với số thực lĩnh, cột "Bút toán" có số JE | same | Dòng bảng lương | Từ máy chấm công đến sổ cái, một luồng trong Oracle NetSuite. S4 Advanced Payroll, từ S4, nhà tư vấn Oracle NetSuite. | From time clock to general ledger in one flow inside Oracle NetSuite. S4 Advanced Payroll, by S4, Oracle NetSuite consultant. | 0:15 | Không |

Tổng thời lượng sau dựng: khoảng 14 phút 10 giây (không tính D13 tùy chọn). Thời gian chờ thật cộng thêm khoảng 10-20 phút
(D7 3-6 phút, D9, D19 mỗi cảnh 0,5-2 phút, D22 1-3 phút, D26 0,5-1,5 phút): cắt khi dựng, giữ 1-2 giây hiệu ứng "Đang xử lý".

---

## E. Video INTRO (3-5 phút)

Câu mở (vấn đề của khách):
- VI: "Cuối tháng, file chấm công, phiếu khoán, doanh số cửa hàng nằm ở ba nơi. Kế toán nhập lại vào Excel rồi mới tính lương."
- EN: "At month-end, time clock files, piecework sheets and store sales sit in three places. Accounting re-keys them into Excel before payroll can start."

| Thứ tự | Khoảnh khắc (số cảnh D) | Thời lượng | Lời thoại VI | Lời thoại EN |
| --- | --- | --- | --- | --- |
| 1 | D3 + D4 mã máy chưa đối chiếu, gán ngay | 0:35 | Nạp thẳng file máy chấm công. Mã lạ được phát hiện và gán ngay trên màn hình. | Load the time clock file as is. Unknown IDs are caught and mapped on the spot. |
| 2 | D8 phiếu đề xuất từ chấm công | 0:25 | Trễ, thiếu lượt chấm, làm thêm thành phiếu đề xuất. Quản lý duyệt, không tự trừ lương. | Late arrivals, missing punches and overtime become proposals. Managers approve, nothing is deducted automatically. |
| 3 | D11 chia tiền khoán tổ | 0:30 | Lương khoán chia theo ngày công và hệ số. Tổng khớp đến từng đồng. | Team piecework is split by days and factors. Totals match to the last dong. |
| 4 | D16 diễn giải hoa hồng | 0:30 | Hoa hồng từ hóa đơn NetSuite và DMS, có diễn giải từng bước. | Commission from NetSuite invoices and the store DMS, with a step-by-step explanation. |
| 5 | D22 + D24 tính 114 người và soát cảnh báo | 0:35 | 114 người tính trong vài phút. Hệ thống tự soát trước khi duyệt. | 114 people calculated in minutes. Built-in checks run before approval. |
| 6 | D26 bút toán 622, 6411, 6421 | 0:30 | Một bút toán, chi phí về đúng tài khoản, phòng ban, dự án. | One journal entry, with cost on the right account, department and project. |
| 7 | D30 + D31 phân tích chi phí và cổng nhân viên trên điện thoại | 0:40 | CFO xem chi phí lao động theo khối. Nhân viên xem phiếu lương trên điện thoại. | The CFO sees labor cost by unit. Employees see their payslip on their phone. |

Câu kết, kêu gọi hành động (0:15):
- VI: "S4 Advanced Payroll chạy ngay trong Oracle NetSuite của bạn. Liên hệ S4, nhà tư vấn Oracle NetSuite tại Việt Nam, để xem demo trên dữ liệu của bạn: s4.com.vn."
- EN: "S4 Advanced Payroll runs inside your Oracle NetSuite account. Contact S4, an Oracle NetSuite consultant in Vietnam, for a demo on your own data: s4.com.vn."

Tổng: khoảng 4 phút 20 giây (gồm câu mở 0:15).

---

## F. Ảnh chụp cho website

Mỗi ảnh chụp hai bản `_vi.png` và `_en.png`, PNG, 1920 x 1080 rồi cắt; ảnh di động 390 x 844 (thiết bị giả lập).
Tên file: `s4-advanced-payroll_<số>_<tên>_<vi|en>.png`.

| # | Tên file (gốc) | Màn hình | Trạng thái dữ liệu | Vùng cắt | Dùng cho |
| --- | --- | --- | --- | --- | --- |
| F01 | `s4-advanced-payroll_01_nap-cham-cong` | Hộp thoại "Nạp chấm công" (D3-D4) | Xem trước ZK-XUONG, khung "Mã chưa đối chiếu (2)", đã chọn nhân viên cho 51, 52, chưa lưu | Cả hộp thoại | Trang tính năng chấm công máy |
| F02 | `s4-advanced-payroll_02_ngoai-le-de-xuat` | Chấm công, khung ngoại lệ (D8) | Có dòng "Đi trễ ..." và "Đơn làm thêm" đề xuất | Khung ngoại lệ + thanh bước | Bài kiểm soát công |
| F03 | `s4-advanced-payroll_03_bang-cong-thang` | Lưới "Bảng công tháng" + "Ngày đang chọn" (D9) | Đã tổng hợp | Lưới 15 dòng + khung phải | Trang chấm công |
| F04 | `s4-advanced-payroll_04_khoan-to-chia-tien` | Phiếu TO-LAPRAP, bước Chia tiền (D11) | "Tổng chia bằng thành tiền phiếu." | Bảng chia + tổng | Trang lương khoán |
| F05 | `s4-advanced-payroll_05_hoa-hong-dien-giai` | Hoa hồng, khung "Diễn giải" (D16) | E1032 tháng 2026-12 (KD-DUAN) nếu có, không thì E1044 | Lưới + khung phải | Trang hoa hồng |
| F06 | `s4-advanced-payroll_06_hoa-hong-nap-dms` | Hộp thoại "Nạp doanh số ngoài" sau Kiểm tra (D14) | 458 dòng hợp lệ | Hộp thoại | Trang hoa hồng, tích hợp DMS |
| F07 | `s4-advanced-payroll_07_bang-luong-tong-quan` | Màn bảng lương sau tính (D22) | Đã tính, 4 thẻ có so sánh kỳ trước | Thanh bước + 4 thẻ + 10 dòng lưới | Trang chủ website, trang chạy lương |
| F08 | `s4-advanced-payroll_08_chi-tiet-dong-luong` | Khung chi tiết E1069 tab Thu nhập (D23) | Đã tính | Khung chi tiết | Trang tính lương |
| F09 | `s4-advanced-payroll_09_kiem-tra-truoc-duyet` | "Kiểm tra trước khi duyệt" (D24) | Có mục lỗi / cảnh báo / đã chấp nhận | Bảng kiểm tra | Bài kiểm soát nội bộ |
| F10 | `s4-advanced-payroll_10_but-toan-luong` | Tab "Bút toán" sau ghi sổ (D26) | Đã ghi sổ | Bảng bút toán có 622, 6411, 6421, 3341, 3335, 338x | Trang hạch toán, bài TK 622 / 6411 / 6421 |
| F11 | `s4-advanced-payroll_11_phieu-luong-pdf` | PDF phiếu lương E1069 (D29) | Bản vi và bản en; thêm bản `_bi.png` nếu dùng `&lang=bi` | Một trang A4 | Trang phiếu lương |
| F12 | `s4-advanced-payroll_12_phan-tich-chi-phi` | Phân tích chi phí (D30) | Tháng 2027-01 so tháng trước | Thẻ + cầu biến động + xu hướng | Trang CFO, phân tích chi phí lao động |
| F13 | `s4-advanced-payroll_13_cong-nhan-vien` | Cổng nhân viên desktop, tab Tổng quan (D31) | Sau ghi sổ | Cả trang | Trang tự phục vụ |
| F14 | `s4-advanced-payroll_14_cong-nhan-vien-mobile` | Cổng nhân viên 390 x 844, Tổng quan | Sau ghi sổ | Cả màn | Trang tự phục vụ (di động) |
| F15 | `s4-advanced-payroll_15_phieu-luong-mobile` | Cổng nhân viên 390 x 844, tab Phiếu lương | Kỳ SAOMAI-202701 | Cả màn | Trang tự phục vụ (di động) |

Chỉ cổng nhân viên (F13-F15) dùng được trên điện thoại. SPA quản trị thiết kế cho màn hình máy tính, không chụp bản di động.
Mọi ảnh phải che hoặc không có số định danh đầy đủ (cổng nhân viên đã che sẵn); không chụp ô "Công ty con" khi đang mở danh sách.

---

## G. Rủi ro khi quay

### G.1 Lỗi đã biết / có khả năng chặn cảnh quay

| # | Rủi ro | Cảnh | Cách xử lý |
| --- | --- | --- | --- |
| 1 | Kỳ công DEFAULT 202612 (01/2027, sub 13) đang khóa. Nếu bản deploy chưa có commit 54007cd, xem trước file chấm công báo "Kỳ đã khóa" cho mọi dòng, gửi duyệt chứng từ, phiếu khoán ngày 01/2027 bị chặn | D3-D12 | Coordinator kiểm bản deploy trước; chạy thử nạp 5 dòng trên kỳ quay rồi xóa không được (lượt chấm không xóa qua SPA) - nên thử bằng file nhỏ của một ngày đầu kỳ và chấp nhận lượt đó là dữ liệu thật |
| 2 | 12 NV kinh doanh `issalesrep = F`, chưa hóa đơn nào có Sales Rep: KD-DUAN tính 0, cảnh D13 và diễn giải KD-DUAN không có số | D13, D16 | Bật "Sales Rep" tay cho E1029-E1042 (12 người SM-E015 ... SM-E026), chạy pr-invoice-reps. Kỳ quay (tháng hoa hồng 2027-01) KD-DUAN dự kiến 0 vì quý mới; diễn giải KD-DUAN quay ở tháng 2026-12 |
| 3 | Vendor của khoản trích BH, KPCĐ là vendor sub 13 ("S4VP TEST - Co quan BHXH" 2679, "S4VP TEST - Cong doan" 2681). Bill Sao Mai sẽ lỗi NetSuite (vendor không thuộc công ty con) hoặc hiện tên TEST | D27 | Người dùng quyết: chia sẻ vendor Sao Mai cho khoản trích (khoản trích là cấp tenant, đổi sẽ ảnh hưởng sub 13) hoặc bỏ cảnh D27. Lỗi NetSuite native hiện tiếng Anh cả bản VI |
| 4 | `DMS_CuaHang_2026-12.csv` cột employee ghi mã kế hoạch SM028...; mã NetSuite là E10xx. Kiểm tra sẽ báo lỗi nhân viên cho 458 dòng | D14 | Sinh lại file với email `sm0NN.demo@example.com` hoặc mã E10xx (cột "Mã NV hoặc email") |
| 5 | 14 phiếu khoán khác của kỳ quay chưa có cách nạp: loader chỉ chạy pr-outputs cho 6 kỳ trước; SPA không có nút nạp CSV phiếu khoán | D10-D12, D22 | Coordinator nạp 14 phiếu (Đã duyệt) trước khi quay (mở rộng loader cho kỳ 202612 hoặc CSV Import NetSuite); nếu không, lương khoán chỉ có phiếu quay trực tiếp |
| 6 | Phiếu tạm ứng kỳ 202612 để "chờ ghi sổ" (runbook) nên không cấn trừ vào lương kỳ quay | D23 | Không quay tab "Cấn trừ tạm ứng" hoặc kế toán ghi sổ phiếu trước |
| 7 | Ghi sổ JE ngày 31/01/2027: runbook ghi "JE 2027 bị từ chối (kỳ thuế 01/2027 chưa mở)" với phiếu tạm ứng | D26 | Chạy thử ghi sổ một JE Sao Mai ngày 01/2027 trước (hoặc coordinator mở kỳ kế toán / kỳ thuế 01/2027). Đã thấy JE sub 13 ngày 01/2027 nên kỳ kế toán có thể đã mở |
| 8 | Duyệt nhiều cấp cần người duyệt là nhân viên cụ thể (E1024, E1020, E1018) tự đăng nhập; người quay không đăng nhập hộ. Cấp 3 chỉ cần khi tổng thực lĩnh từ 1.700.000.000, kỳ quay ước tính dưới mức này | D25 | Mặc định quay duyệt một cấp. Nếu cần nhiều cấp: người dùng bật cấp duyệt, cấp quyền và tự đăng nhập từng người |
| 9 | Cổng nhân viên cần Give Access + mật khẩu cho E1069 / E1032 (hiện giveaccess = F) | D31 | Người dùng tự bật và tự đăng nhập; người quay chỉ quay |
| 10 | Trang chủ chọn "kỳ đang chạy" theo bảng lương chưa xong, không có thì theo ngày hôm nay (khoảng 11-12/2026 thật) nên có thể hiện SAOMAI-202611 đã xong | không có trong D | Chỉ quay Trang chủ sau D20 (khi bảng lương kỳ quay đang mở) và nếu chạy thử thấy đúng |
| 11 | Hộp thoại xác nhận của SPA ("Xác nhận", nút "Đồng ý" / "Hủy"): luôn bấm "Đồng ý" / "OK" đúng thứ tự; không bấm ra ngoài | mọi bước ghi | |
| 12 | Tác vụ nền: trong lúc chạy, nút bị khóa ("Kỳ đang có tác vụ chạy nền..."). Nếu báo "Tác vụ nền chạy lâu hơn dự kiến", chờ rồi bấm "Tải lại" | D7, D9, D19, D22, D26 | Không bấm "Gỡ khóa tác vụ nền (admin)" |
| 13 | Ô tháng `<input type="month">` hiển thị theo ngôn ngữ Chrome | D15, D30 | Đặt ngôn ngữ Chrome trùng bản quay hoặc phóng nhỏ ô này |
| 14 | Dropdown "Công ty con" liệt kê mọi công ty (Parent, Australia, Canada...) | D1 | Chọn sẵn trước khi quay, không mở danh sách trên hình |

### G.2 Bước không đảo ngược và cách làm lại cho bản EN

Không đảo ngược được trong cùng kỳ: ghi lượt chấm (không xóa qua SPA), lưu đối chiếu mã (chỉ "Thôi dùng"), duyệt chứng từ công
(hủy được nhưng để lại lịch sử), khóa công (KHÔNG mở lại được khi kỳ đã có bảng lương Đã ghi sổ hoặc Đã đảo), ghi sổ (chỉ đảo),
lập bill (chỉ void trên NetSuite).

Vì vậy bản EN không thể làm lại D2-D19 trên cùng kỳ SAOMAI-202701 sau khi bản VI đã ghi sổ: nạp lại file chỉ thấy "Trùng",
không còn mã chưa đối chiếu, phiếu khoán không gửi duyệt được vì "Kỳ công đã khóa".

Phương án (cần người dùng chọn, xem câu hỏi cuối):
- **A (khuyến nghị): bản EN quay kỳ kế tiếp SAOMAI-202702** (ngày 01-28/02/2027, câu chuyện "01/2027"). Cần mở rộng bộ sinh
  repo demo cho kỳ đó (phân ca, đơn, Time, attlog có 2 mã mới, CSV DMS, 14 phiếu khoán) và để mã máy mới khác 51, 52. Lợi ích:
  bản EN có "kỳ trước" là kỳ VI vừa ghi sổ, so sánh và xu hướng đẹp hơn. Số liệu hai bản khác nhau.
- **B: quay xen kẽ**: mỗi cảnh D2-D19 quay VI rồi đổi ngôn ngữ (Set Preferences, F5) và quay EN ngay trên trạng thái kế tiếp.
  Chỉ hợp với cảnh xem (D16, D17, D23, D26 xem trước); cảnh thao tác một lần (D4, D5, D19) chỉ có một bản.
- **C: làm lại phần bảng lương D20-D29 trên cùng kỳ**: void 3 bill cơ quan thu trên NetSuite -> "Thao tác khác" > "Đảo bảng
  lương" (tạo JE đảo ngày hôm nay, phiếu khoán về Đã duyệt, hoa hồng về đã duyệt, hoàn tạm ứng) -> tạo bảng lương mới cùng kỳ ->
  Tải nhân viên -> Tính -> duyệt -> ghi sổ. Nhược điểm: danh sách có thêm bảng "Đã đảo", tháng 2027-01 có JE đảo trên phân tích chi
  phí; vi phạm nguyên tắc tránh trạng thái V trên hình. Doanh số DMS nạp lại sẽ báo "Không đổi" (chống trùng theo nguồn + số chứng
  từ + dòng).
- Không xóa record để "reset" (xóa dữ liệu là hành động phá hủy, gói chặn sửa trực tiếp).

### G.3 Chỗ chưa dịch hoặc lẫn ngôn ngữ (bản EN phải tránh hoặc chấp nhận)

SPA: kiểm bằng `node tools/check_i18n.mjs --same`: 23 file, 3.596 khóa, 0 lỗi; các khóa trùng vi / en là chữ dùng chung
("S4 Advanced Payroll", "Class", "NetSuite", "ZKTeco attlog", "Tab", "Administrator", "Timesheet"). Phần lẫn ngôn ngữ đến từ dữ
liệu, máy chủ và NetSuite:

| Chỗ | Bản EN hiện gì | Cách tránh |
| --- | --- | --- |
| Tên loại thu nhập, loại nghỉ, khoản trích BH, tên kế hoạch / thành phần hoa hồng, tên tổ, hạng mục khoán, ca | Tiếng Việt ("Lương cơ bản", "Thai sản (BHXH trả)", "Doanh thu bán lẻ", "Tổ Lắp ráp tủ điện") | Chấp nhận là dữ liệu; lời thoại EN không đọc tên các dòng này |
| Tên tài khoản, phòng ban, class, địa điểm, dự án, khách hàng, vendor | Tiếng Việt | Chấp nhận |
| Diễn giải dòng bút toán | Theo ngôn ngữ người bấm "Ghi sổ" (EN nếu quay EN) | Bản EN phải ghi sổ bằng người dùng ngôn ngữ EN |
| Memo bill cơ quan thu | Ghép tên khoản trích tiếng Việt ("BHXH hưu trí, tử tuất ...") | Không phóng to memo ở bản EN |
| PDF phiếu lương EN | Nhãn tiếng Anh, nhưng tên khoản thu nhập tiếng Việt và "Total net pay in words: <số đọc bằng tiếng Việt>" (VietnameseNumberReader) | Không phóng vào dòng bằng chữ; hoặc dùng bản `lang=bi` và nói rõ song ngữ |
| PDF từ cổng nhân viên | Không có tên công ty ở phần đầu (mã truyền tên công ty rỗng) | Chụp PDF từ SPA (D29) cho website |
| File chi lương ngân hàng | Tiêu đề cột tiếng Việt không dấu ("STT, Ma NV, Ho ten, So tai khoan, Ngan hang, So tien, Noi dung"); nội dung "Salary MM/yyyy" ở EN | Không mở file trên hình ở bản EN |
| Thông báo lỗi máy chủ của gói | Đúng ngôn ngữ (máy chủ trả cặp en / vi). Lỗi NetSuite native (khóa sổ, vendor, kỳ kế toán) chỉ tiếng Anh, cả ở bản VI | Chạy thử trước để không gặp |
| Form, danh sách record NetSuite, menu "S4 - Advanced Payroll" > "Lương", tên record type "S4VP ..." | Tiếng Việt | Bản EN không mở form record chuẩn |
| Màn hình cũ (UIF) | Tiêu đề phụ "S4 VN Payroll" (tên cũ) | Không mở |
| Số, ngày | `1.234.567`, `dd/mm/yyyy` cả bản EN | Lời thoại EN: "amounts in Vietnamese dong" |

### G.4 Thao tác cần người dùng cho phép (quy tắc an toàn của người quay)

- Tải file (D28 file ngân hàng; D29 PDF mở tab mới, không tải): hỏi người dùng trước, nêu tên file.
- Bấm nút ghi không đảo ngược ("Ghi ... lượt chấm mới", "Lưu đối chiếu", "Duyệt", "Khóa công", "Ghi sổ", "Lập bill cơ quan
  thu"): việc người dùng đã giao trong kịch bản; người quay xác nhận một lần với người dùng trước khi bắt đầu phiên quay.
- Đăng nhập Employee Center, người duyệt nhiều cấp: người dùng tự làm.

### G.5 Nhãn tiếng Anh dài có thể vỡ bố cục (ước lượng theo số ký tự)

| Màn | VI | EN | Ghi chú |
| --- | --- | --- | --- |
| Danh sách bảng lương, cột số | "BH NLĐ" (6), "BH DN" (5) | "Employee insurance" (18), "Employer insurance" (18) | cột số hẹp, tiêu đề xuống dòng; chụp ở 1920 px |
| Thanh bước bảng lương | "Công và giờ" (11) | "Attendance and hours" (20) | thanh 6 bước, có thể co chữ |
| Nút chính | "Gửi duyệt" (9) | "Submit for approval" (19) | ổn ở 1920 px |
| Chấm công, thẻ | "Đơn từ trong kỳ" (15) | "Requests in the period" (22) | |
| Gợi ý nút bị khóa | "Kỳ công đã khóa" (15) | "Attendance of the period is locked" (34) | chỉ là tooltip |
| Sản lượng | "Nạp thành viên từ tổ" (20) | "Load members from the team" (26) | |
| Phân tích chi phí, thẻ KPI | "Lao động trong giá vốn" (22) | "Labor in cost of goods sold" (27) | thẻ 4 cột, có thể xuống dòng |
| Thanh tab ứng dụng | 9 tab + "Khác" | "Reports - declarations", "Run payroll", "Cost analysis" | ô "Subsidiary" rộng 240 px cắt tên công ty ở cả hai bản |

---

## H. Tự kiểm

Không bấm được giao diện trong lần soạn này. Đã kiểm chỉ đọc: nhãn trong mã (bảng chữ vi / en), dữ liệu cấu hình bằng SuiteQL.
"Chưa chạy được" = chưa thao tác trên giao diện; lý do ghi theo từng bước.

Đã kiểm chỉ đọc (12/11/2026): kỳ SAOMAI-202701 id 37 mở, công chưa khóa; 116 nhân viên sub 14; nguồn ZK-XUONG / ZK-KHO và đối
chiếu không có mã 51, 52; ca C1-C3, K1, K2; GC-CONGDOAN, 3 tổ; KD-DUAN, BANLE-CH; 3 cấp duyệt (tắt); vendor V065-V067; tài khoản
622 ... 3386; không còn tham số chưa đối chiếu; mọi nhãn trong cột D có trong bảng chữ. Chưa có: lượt chấm, phân ca, Time, phiếu
khoán, hoa hồng, bảng lương nào của Sao Mai.

| # | VI | EN | Lý do / đã kiểm gì |
| --- | --- | --- | --- |
| D1 | Chưa chạy được | Chưa chạy được | Nhãn đã kiểm; số nhân viên của kỳ phụ thuộc phân ca / hồ sơ kỳ 202612 chưa nạp |
| D2 | Chưa chạy được | Chưa chạy được | Nguồn ZK-XUONG có trên account; chưa thử chọn file |
| D3 | Chưa chạy được | Chưa chạy được | 88 dòng mã 51 / 52 đếm từ file; trạng thái "Kỳ đã khóa" phụ thuộc bản deploy có commit 54007cd (G.1-1) |
| D4 | Chưa chạy được | Chưa chạy được | E1071, E1081 có trên account; chưa lưu đối chiếu (thao tác ghi) |
| D5 | Chưa chạy được | Chưa chạy được | Thao tác ghi, chỉ làm khi quay |
| D6 | Chưa chạy được | Chưa chạy được | Như D5 |
| D7 | Chưa chạy được | Chưa chạy được | Chưa có phân ca kỳ 202612 (loader pr-roster chưa chạy) |
| D8 | Chưa chạy được | Chưa chạy được | Phụ thuộc D7 |
| D9 | Chưa chạy được | Chưa chạy được | Phụ thuộc D7, D8 |
| D10 | Chưa chạy được | Chưa chạy được | Bảng đơn giá, tổ có; 14 phiếu nền chưa nạp (G.1-5) |
| D11 | Chưa chạy được | Chưa chạy được | 15 thành viên TO-LAPRAP theo plan; ngày công phụ thuộc D9 |
| D12 | Chưa chạy được | Chưa chạy được | Phụ thuộc D11, khóa kỳ DEFAULT (G.1-1) |
| D13 | Chưa chạy được | Chưa chạy được | 0 hóa đơn có Sales Rep, issalesrep = F (G.1-2) |
| D14 | Chưa chạy được | Chưa chạy được | File DMS dùng mã SM028, sẽ lỗi nhân viên (G.1-4) |
| D15 | Chưa chạy được | Chưa chạy được | Phụ thuộc D14 |
| D16 | Chưa chạy được | Chưa chạy được | Phụ thuộc D15; KD-DUAN tháng 2026-12 phụ thuộc Sales Rep và chạy lương 06-11 |
| D17 | Chưa chạy được | Chưa chạy được | Kế hoạch BANLE-CH có; số mô phỏng chưa đo |
| D18 | Chưa chạy được | Chưa chạy được | Phụ thuộc D15 |
| D19 | Chưa chạy được | Chưa chạy được | Thao tác không đảo ngược; phụ thuộc D7-D12 |
| D20 | Chưa chạy được | Chưa chạy được | Công ty lương "Sao Mai Demo" (id 2) có; chưa tạo bảng lương |
| D21 | Chưa chạy được | Chưa chạy được | 114 người là ước tính từ plan |
| D22 | Chưa chạy được | Chưa chạy được | Ngưỡng tính trực tiếp 120 người đọc trong mã; chưa đo thời gian |
| D23 | Chưa chạy được | Chưa chạy được | Phụ thuộc D22 |
| D24 | Chưa chạy được | Chưa chạy được | Đơn thai sản E1022 có trong plan, chưa nạp (pr-docs) |
| D25 | Chưa chạy được | Chưa chạy được | Cấp duyệt Sao Mai đang tắt; người duyệt chưa có quyền truy cập (G.1-8) |
| D26 | Chưa chạy được | Chưa chạy được | Tài khoản đã kiểm; khóa sổ / kỳ 01/2027 chưa thử (G.1-7) |
| D27 | Chưa chạy được | Chưa chạy được | Vendor khoản trích thuộc sub 13 (G.1-3) |
| D28 | Chưa chạy được | Chưa chạy được | Phụ thuộc D26; tải file cần người dùng cho phép |
| D29 | Chưa chạy được | Chưa chạy được | Phụ thuộc D26; tham số lang của Suitelet in đã kiểm trong mã |
| D30 | Chưa chạy được | Chưa chạy được | Chưa có cost_fact Sao Mai; 6 kỳ trước chưa ghi sổ |
| D31 | Chưa chạy được | Chưa chạy được | Employee Center chưa bật cho E1069 / E1032; cổng chỉ hiện bảng Đã ghi sổ |
| D32 | Chưa chạy được | Chưa chạy được | Phụ thuộc D26 |

Việc của coordinator để chuyển mục H sang "Đã chạy thử": chạy xong loader (mọi giai đoạn), sửa G.1-1 đến G.1-5, chạy lương
06-11/2026, rồi chạy thử D1-D32 ở chế độ không quay trên một kỳ khác (ví dụ SAOMAI-202702 nếu đã sinh dữ liệu) hoặc chỉ các
bước xem.
