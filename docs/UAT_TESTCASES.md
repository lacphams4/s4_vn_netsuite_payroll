# Bộ UAT testcase - S4 Advanced Payroll trên Oracle NetSuite

Bản 14/11/2026. Người soạn: vai trò senior QC kiêm key user (HR tiền lương, kế toán lương). Nguồn đối chiếu: Sổ tay quy trình (`docs/wiki/wiki_source.md`, `wiki_inputs.md`, `wiki_roster.md`), báo cáo kiểm thử kỹ thuật (`docs/KIEM_THU.md`), backlog (`docs/BACKLOG.md`) và các lỗi ghi nhận trong buổi quay demo kỳ SAOMAI-202701, SAOMAI-202702.

## 1. Mục tiêu và cách dùng

UAT trả lời năm câu hỏi, mỗi testcase gắn một loại tương ứng:

| Loại | Câu hỏi | Ký hiệu |
| --- | --- | --- |
| Nghiệp vụ | Quy trình có chạy trọn từ đầu đến cuối, đúng vai trò, đúng trạng thái không | NV |
| Tình huống thực tế | Tình huống hay gặp ở doanh nghiệp Việt Nam có được xử lý, hay bị sót | TH |
| Tính toán | Số hệ thống tính có khớp số tính tay độc lập đến từng đồng không | TT |
| Dễ dùng, nhập liệu | Người làm lương có tự làm được, nhập có nhanh, có dễ sai không | UX |
| Kiểm soát | Phân quyền, khóa, duyệt, nhật ký có chặn được sai sót và gian lận không | KS |

Cách dùng:
- Mỗi testcase chạy bởi key user đúng vai trò, không phải người phát triển. QC ngồi quan sát và ghi nhận, không cầm chuột hộ.
- Testcase loại TT bắt buộc có **phiếu tính tay** lập trước bằng Excel, độc lập với hệ thống (mục 4). Không lấy số hệ thống làm số mong đợi.
- Kết quả ghi vào nhật ký UAT (mẫu ở mục 9): Đạt / Không đạt / Bị chặn / Chấp nhận có điều kiện.
- Ưu tiên: **P1** phải đạt mới nghiệm thu (sai là trả sai lương, sai sổ, lộ dữ liệu); **P2** nên đạt, có cách làm thay thì chấp nhận có điều kiện; **P3** cải tiến.
- Mức lỗi khi không đạt: S1 chặn nghiệp vụ hoặc sai tiền; S2 sai nhưng có cách làm thay; S3 bất tiện; S4 thẩm mỹ, câu chữ.

Điều kiện nghiệm thu đề xuất: 100% P1 đạt; P2 đạt từ 90%, phần còn lại có cách làm thay được kế toán trưởng ký chấp nhận; không còn lỗi S1; chạy song song một kỳ thật khớp bảng lương cũ đến từng đồng (TC-E2E-05).

## 2. Môi trường, vai trò, dữ liệu

### 2.1 Môi trường

- Account thử: td2937310. Không chạy UAT trên dữ liệu thật; không dùng thông tin cá nhân thật.
- Công ty con UAT riêng (đề xuất "UAT Payroll"), không dùng chung với Sao Mai Demo (pháp nhân 14, dùng để trình diễn) và S4VN TT99 Test (pháp nhân 13, dùng cho kiểm thử kỹ thuật).
- Trước khi chạy: Thiết lập > Nạp mặc định VN; kế toán trưởng đối chiếu toàn bộ Tham số pháp lý với văn bản gốc và đánh dấu "Đã đối chiếu". Chưa đối chiếu thì các testcase TT về bảo hiểm, thuế chưa có giá trị nghiệm thu.

### 2.2 Vai trò tham gia

| Ký hiệu | Vai trò NetSuite | Người chạy |
| --- | --- | --- |
| HR | S4VP Payroll HR | Chuyên viên tiền lương |
| KT | S4VP Payroll Accountant | Kế toán lương |
| KTT | Người duyệt khai trong Cấp duyệt bảng lương | Kế toán trưởng |
| NV | Employee Center | Một nhân viên thường |
| QL | Employee Center | Một trưởng bộ phận |
| AD | Administrator | Tư vấn S4 (chỉ cho bước thiết lập) |

### 2.3 Bộ nhân viên UAT (dữ liệu giả, tạo trước khi chạy)

Lương là số giả để dễ tính tay. Kỳ thử chính: một tháng có 22 ngày công chuẩn; nếu tháng thử khác 22 ngày thì tính lại số mong đợi theo ngày công chuẩn thực tế của kỳ.

| Mã | Mô tả | Lương hợp đồng | Lương đóng BH | Đặc điểm |
| --- | --- | --- | --- | --- |
| U01 | Nhân viên văn phòng, lương tháng | 20.000.000 | 20.000.000 | Không người phụ thuộc, đủ công |
| U02 | Trưởng phòng, lương tháng | 30.000.000 | 30.000.000 | 2 người phụ thuộc, đoàn viên, phụ cấp cố định 2.000.000, có trích tháng 13 |
| U03 | Giám đốc, lương tháng | 120.000.000 | 120.000.000 | Vượt trần đóng BHXH và BHTN |
| U04 | Công nhân ba ca, lương tháng | 7.000.000 | 7.000.000 | Thuộc tổ khoán, có ca đêm, 2 người phụ thuộc |
| U05 | Công nhân lương ngày | 400.000 / ngày | Theo hợp đồng | Loại lương D |
| U06 | Cộng tác viên, thù lao | 8.000.000 | Không | Loại lao động C, thuế F, chưa có cam kết 08 |
| U07 | Cộng tác viên có cam kết | 8.000.000 | Không | Như U06, đã nộp cam kết 08/CK-TNCN |
| U08 | Chuyên gia nước ngoài | 80.000.000 | Theo cờ tham gia | Thuế N, có giấy phép lao động |
| U09 | Nhân viên mới | 20.000.000 | 20.000.000 | Vào làm ngày 16 của kỳ |
| U10 | Nhân viên nghỉ việc | 20.000.000 | 20.000.000 | Ngày làm việc cuối là ngày 10, còn 3 ngày phép |
| U11 | Nhân viên nghỉ thai sản | 15.000.000 | 15.000.000 | Nghỉ TS cả kỳ |
| U12 | Nhân viên kinh doanh | 12.000.000 | 12.000.000 | Chỉ tiêu 200.000.000 / tháng, thuộc kế hoạch hoa hồng |
| U13 | Lương đóng BH thấp | 5.000.000 | Dưới lương tối thiểu vùng | Dùng thử ca lỗi |
| U14 | Nhân viên lương giờ | 60.000 / giờ | Theo hợp đồng | Loại lương H, giờ từ Time NetSuite |
| U15 | Nhân viên có tạm ứng | 10.000.000 | 10.000.000 | Hai phiếu tạm ứng 3.000.000 và 9.000.000 |

## 3. Kịch bản đầu cuối (chạy trước, quyết định có đi tiếp không)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| E2E-01 | P1 | Một kỳ lương văn phòng, không máy chấm công: HR lập đơn nghỉ, đơn làm thêm; QL duyệt; HR lập và khóa bảng công; tạo bảng lương, nạp nhân viên, tính; soát cảnh báo; gửi duyệt; KTT duyệt; KT ghi sổ; in phiếu lương; xuất file ngân hàng | Đi hết 6 bước trên thanh bước không cần hỗ trợ kỹ thuật; một bút toán cân; phiếu lương khớp dòng lương; file ngân hàng đủ người có thực lĩnh > 0 | NV |
| E2E-02 | P1 | Một kỳ lương nhà máy: xếp ca theo chế độ ca; nạp file máy chấm công; gán mã chưa đối chiếu; xử lý chấm công; duyệt ngoại lệ; lập phiếu khoán tổ, chia, duyệt; khóa công; tính lương; ghi sổ | Công, ca đêm, làm thêm, lương khoán vào đúng người; chi phí công nhân trực tiếp vào tài khoản khai cho xưởng | NV |
| E2E-03 | P1 | Một kỳ có hoa hồng: nạp doanh số ngoài hoặc đọc hóa đơn NetSuite; tính; duyệt bảng tính; tính lương | Dòng hoa hồng xuất hiện ở tab Thu nhập của đúng nhân viên, số bằng số phải trả trên bảng tính | NV |
| E2E-04 | P1 | Sửa sai sau ghi sổ: void bill cơ quan thu, đảo bảng lương, lập bảng mới cùng kỳ, tính, duyệt, ghi sổ lại | Bút toán đảo đối ứng đủ từng dòng; tạm ứng, phiếu khoán, bảng hoa hồng trở về trạng thái trước; bảng mới không báo trùng nhân viên | NV |
| E2E-05 | P1 | Chạy song song: lấy bảng lương Excel của một kỳ thật (đã ẩn danh), nhập cùng dữ liệu vào gói, so từng người, từng khoản | Chênh lệch bằng 0 từng người; mọi chênh lệch có giải thích bằng văn bản (khác quy chế làm tròn, khác tham số) và được KTT ký | TT |
| E2E-06 | P1 | Vòng đời quý và năm: chạy đủ 3 kỳ của một quý rồi mở tờ khai 05/KK-TNCN, báo cáo bảo hiểm tháng, chi phí theo tài khoản | Tổng các chỉ tiêu bằng tổng ba bảng lương; chi phí theo tài khoản khớp phát sinh trên sổ cái | TT |
| E2E-07 | P2 | Người mới tự làm: một chuyên viên chưa từng dùng gói, chỉ đọc Sổ tay quy trình, tự chạy E2E-01 | Hoàn thành trong 90 phút; ghi lại mọi chỗ phải hỏi | UX |

## 4. Phiếu tính tay (dùng cho mọi testcase TT)

Lập trong Excel trước khi chạy. Giá trị pháp lý **không ghi cứng trong tài liệu này**: người lập phiếu chép từ Thiết lập > Tham số pháp lý, dòng hiệu lực tại ngày cuối kỳ, sau khi KTT đã đối chiếu văn bản gốc.

### 4.1 Tham số cần chép vào phiếu

| Ô | Tham số | Mã trong hệ thống |
| --- | --- | --- |
| P1, P2 | Giảm trừ bản thân, mỗi người phụ thuộc | `PIT.SELF_DEDUCTION`, `PIT.DEPENDENT_DEDUCTION` |
| P3 | Biểu thuế lũy tiến (cận từng bậc, thuế suất) | Biểu thuế TNCN hiệu lực ngày cuối kỳ |
| P4, P5 | Thuế suất khấu trừ và ngưỡng mỗi lần chi | `PIT.FLAT_RATE`, `PIT.FLAT_THRESHOLD` |
| P6 | Thuế suất không cư trú | `PIT.NONRESIDENT_RATE` |
| P7 | Trần ăn ca miễn thuế | `PIT.MEAL_EXEMPT_CAP` |
| P8 | Mức tham chiếu | `INS.REFERENCE_WAGE` |
| P9, P10 | Hệ số trần BHXH-BHYT, trần BHTN | `INS.SI_CAP_MULTIPLIER`, `INS.UI_CAP_MULTIPLIER` |
| P11 | Số ngày nghỉ không đóng BH | `INS.ABSENCE_DAYS_THRESHOLD` |
| P12 | Lương tối thiểu vùng của nhân viên | `MINWAGE.I` ... `MINWAGE.IV` |
| P13 | Tỷ lệ từng khoản trích, phần NLĐ và DN | Khoản trích theo lương (BHXH_HT, BHXH_OD, BHTNLD, BHYT, BHTN, KPCD, DOANPHI) |
| P14 - P18 | Hệ số làm thêm ngày thường, nghỉ tuần, lễ; phụ cấp đêm; phần thêm khi làm thêm đêm | `OT.NORMAL_DAY`, `OT.WEEKLY_OFF`, `OT.HOLIDAY`, `OT.NIGHT_PREMIUM`, `OT.NIGHT_EXTRA` |
| P19 | Giới hạn giờ làm thêm tháng, năm | `OT.LIMIT_MONTH`, `OT.LIMIT_YEAR`, `OT.LIMIT_YEAR_EXTENDED` |

### 4.2 Công thức đối chiếu (theo Sổ tay quy trình)

1. Lương theo ngày công (lương tháng) = Round(lương hợp đồng x công hưởng lương / công chuẩn).
2. Lương giờ để tính làm thêm: lương tháng = lương hợp đồng / (công chuẩn x giờ một ngày); lương ngày = lương ngày / giờ một ngày. Không làm tròn đơn giá, chỉ làm tròn số tiền.
3. Tiền làm thêm = Round(lương giờ x số giờ x hệ số). Phần miễn thuế = số tiền - Round(lương giờ x số giờ).
4. Căn cứ BHXH, BHYT = min(lương đóng BH, P8 x P9). Căn cứ BHTN = min(lương đóng BH, P12 x P10). Từng khoản làm tròn riêng phần NLĐ và phần DN.
5. Thu nhập chịu thuế = tổng thu nhập - thu nhập miễn thuế. Thu nhập tính thuế = max(0, chịu thuế - BH bắt buộc NLĐ (không gồm đoàn phí) - P1 - P2 x số người phụ thuộc - giảm trừ khác).
6. Thuế lũy tiến: tính từng bậc không làm tròn, cộng rồi làm tròn một lần.
7. Thực lĩnh = tổng thu nhập - BH NLĐ (gồm đoàn phí) - thuế - khấu trừ khác - cấn trừ tạm ứng.
8. Trích tháng 13 = Round(cơ sở / số tháng), không phụ thuộc ngày công.
9. Chia tiền tổ: mỗi phần làm tròn xuống đến đồng, phần dư chia từng đồng theo phần lẻ lớn nhất trước; tổng các phần bằng đúng thành tiền phiếu.

### 4.3 Số đối chiếu đã có sẵn (lấy từ màn hình kỳ SAOMAI-202702, dùng làm hồi quy)

Công nhân E1069, bảng lương BL000017: lương cơ bản 7.000.000 + lương khoán 2.502.317 + phụ cấp độc hại, ca đêm xưởng 200.000 = 9.702.317; bảo hiểm NLĐ 560.000 + 105.000 + 70.000 + đoàn phí 70.000 = 805.000; thuế 0; thực lĩnh 8.897.317. Chạy lại "Tính" trên bản sao dữ liệu phải ra đúng các số này.

## 5. Testcase theo phân hệ

### 5.1 Thiết lập ban đầu (TL)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| TL-01 | P1 | AD bấm Nạp mặc định VN hai lần liên tiếp | Lần 2 không tạo trùng tham số, khoản trích, loại thu nhập, loại nghỉ; không ghi đè giá trị đã sửa | NV |
| TL-02 | P1 | KTT mở Tham số pháp lý, so từng dòng với văn bản gốc, đánh dấu Đã đối chiếu | Mỗi dòng có ngày hiệu lực và căn cứ; dòng chưa đối chiếu hiện trước; Trang chủ hết cảnh báo khi đối chiếu xong | KS |
| TL-03 | P1 | Thêm một dòng tham số có ngày hiệu lực giữa năm (ví dụ lương tối thiểu vùng đổi từ 01/07), tính lại một kỳ trước và một kỳ sau ngày đó | Kỳ trước dùng giá trị cũ, kỳ sau dùng giá trị mới; không phải sửa mã | TH |
| TL-04 | P1 | KT khai tài khoản 334, 3335, 141, 335, chi phí mặc định, phải trả CTV; để trống 334 rồi thử ghi sổ | Ghi sổ bị chặn với thông báo nêu rõ tài khoản thiếu, bằng ngôn ngữ người dùng | KS |
| TL-05 | P1 | Sinh kỳ lương cho năm, nhóm lương tháng | Đủ 12 kỳ; ngày công chuẩn từng kỳ = số ngày trong kỳ trừ ngày nghỉ tuần và ngày lễ; tự kiểm 3 tháng có lễ | TT |
| TL-06 | P2 | Sinh kỳ cho nhóm lương nửa tháng và tuần | Mã kỳ đúng quy ước; kỳ cuối tháng thuế được đánh dấu | NV |
| TL-07 | P2 | Khai Tài khoản chi phí theo đích cho một dự án, một phòng ban; dùng công cụ thử "tài khoản sẽ được chọn" | Kết quả thử khớp thứ tự ưu tiên: class, dự án, phòng ban riêng, hồ sơ, phòng ban nhân viên, mặc định | NV |
| TL-08 | P2 | Khai Cấp duyệt bảng lương 2 cấp có ngưỡng thực lĩnh | Bảng dưới ngưỡng chỉ cần cấp 1; bảng từ ngưỡng trở lên cần đủ 2 cấp | KS |
| TL-09 | P2 | Tắt cờ "Bật phân hệ lương" của một công ty con rồi tạo bảng lương cho công ty đó | Bị chặn, thông báo rõ | KS |
| TL-10 | P2 | Nạp gói ngành Sản xuất | Có ca, mẫu xoay ca, loại thu nhập, bảng đơn giá mẫu; không ghi đè danh mục đã có | NV |
| TL-11 | P2 | Tab Thiết lập: tìm một mục bất kỳ (ví dụ Ngày lễ) | Tìm thấy trong 15 giây; mỗi mục có tình trạng Đủ, Cần chú ý, Thiếu đúng thực tế | UX |
| TL-12 | P3 | Khai ngày lễ năm mới, gồm ngày nghỉ bù và ngày hoán đổi | Khai được từng ngày; kỳ lương sinh sau đó tính lại ngày công chuẩn | TH |

### 5.2 Hồ sơ nhân sự và lương (HS)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| HS-01 | P1 | HR tạo hồ sơ lương U01 từ một Employee có sẵn, thêm lịch sử lương | Lưu được; thiếu lịch sử lương thì khi tính lương dòng báo lỗi rõ, không trả 0 đồng im lặng | NV |
| HS-02 | P1 | Điều chỉnh lương U01 có hiệu lực từ ngày 1 của kỳ sau | Kỳ hiện tại giữ lương cũ, kỳ sau dùng lương mới | TT |
| HS-03 | P1 | Điều chỉnh lương U01 có hiệu lực **giữa kỳ** (ngày 16) | Ghi nhận hành vi: hệ thống lấy dòng hiệu lực muộn nhất không sau ngày cuối kỳ cho cả kỳ, không tự chia hai mức theo ngày. Key user quyết định chấp nhận hay yêu cầu chia theo ngày | TH |
| HS-04 | P1 | Thêm người phụ thuộc cho U02 với giảm trừ từ giữa tháng; thêm một người có ngày kết thúc giảm trừ trong tháng | Cả hai được tính trọn tháng khi khoảng giảm trừ giao với kỳ; tháng sau người đã hết hạn không còn được tính | TT |
| HS-05 | P1 | Lập quyết định điều chỉnh lương, bấm Áp dụng | Hồ sơ và lịch sử lương cập nhật theo ngày hiệu lực; quyết định đã áp dụng không sửa được | NV |
| HS-06 | P1 | Lập quyết định chấm dứt cho U10 | Hợp đồng đang hiệu lực tự chấm dứt; ngày làm việc cuối cập nhật; kỳ đó U10 được trả theo ngày và trả phép | NV |
| HS-07 | P1 | Người dùng vai trò KT mở hồ sơ, người dùng không có vai trò lương mở record Employee chuẩn | KT xem được, không sửa; người ngoài vai trò lương không thấy số lương ở đâu | KS |
| HS-08 | P1 | Xem MST, CCCD, số sổ BHXH, số tài khoản trên màn Nhân sự | Chỉ hiện có hoặc không, không hiện số đầy đủ; nhật ký và log không chứa số định danh | KS |
| HS-09 | P2 | Hợp đồng thử việc chuyển sang hợp đồng chính thức giữa kỳ, lương thử việc 85% | Ghi nhận cách làm: hai dòng lịch sử lương theo ngày hiệu lực; xem HS-03 về việc chia theo ngày | TH |
| HS-10 | P2 | Nhân viên nghỉ việc rồi được tuyển lại sau 3 tháng | Hồ sơ dùng lại được; thâm niên, phép, lũy kế thuế xử lý hợp lý; ghi nhận hành vi | TH |
| HS-11 | P2 | Điều chuyển U01 sang phòng ban khác giữa kỳ | Ghi nhận chi phí kỳ đó về phòng ban nào; báo cáo quỹ lương dùng phòng ban hiện tại (theo sổ tay) - key user đánh giá | TH |
| HS-12 | P2 | Giấy phép lao động của U08 hết hạn trong kỳ; bật "Chặn tính lương khi thiếu giấy phép" | Dòng U08 báo lỗi và không tính; tắt cờ thì chỉ cảnh báo | KS |
| HS-13 | P2 | Lập bảng tỷ lệ phân bổ 60% dự án A, 30% dự án B (tổng 90%) rồi kích hoạt | Không kích hoạt được khi tổng khác 100% | KS |
| HS-14 | P2 | Nhập 20 hồ sơ lương mới liên tục | Đo thời gian; có nhập hàng loạt hoặc dán từ Excel không; số lần bấm cho một hồ sơ. Mục tiêu dưới 2 phút một hồ sơ | UX |
| HS-15 | P2 | Danh sách Nhân sự: tìm theo mã, tên, phòng ban; lọc theo tình trạng | Có ô tìm nhanh, kết quả tức thì; bấm một dòng mở đúng hồ sơ | UX |
| HS-16 | P3 | Nhập ngày sinh, ngày hiệu lực bằng bàn phím và bằng lịch | Có date picker; gõ tay dạng dd/mm/yyyy được chấp nhận; nhập sai định dạng báo ngay tại ô | UX |
| HS-17 | P3 | Xóa một hợp đồng, một quyết định đã lưu | Không xóa được, chỉ chấm dứt hoặc lập bản mới; có nhật ký | KS |

### 5.3 Xếp ca và chế độ ca (CA)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| CA-01 | P1 | Khai chế độ ca xoay 3 ca cho 3 kíp, ngày neo lệch nhau một tuần | Lưới hiện đúng ca từng ngày cho từng kíp trong 31 ngày mà không phải lưu từng ô | NV |
| CA-02 | P1 | Đổi một ô sang ca khác, Lưu; chọn "Theo chế độ ca", bấm lại ô, Lưu | Ô đổi rồi trở về lịch chung; dòng Số người theo ca cập nhật | NV |
| CA-03 | P1 | Một nhân viên vừa thuộc chế độ ca của tổ vừa có chế độ ca cá nhân | Chế độ cụ thể hơn thắng (nhân viên, tổ, phòng ban, nhóm lương, công ty con); cùng mức thì dòng hiệu lực muộn nhất | NV |
| CA-04 | P1 | Ca đêm 22:00 - 06:00 qua ngày, qua cuối tháng | Ca thuộc ngày bắt đầu; lượt chấm ra sáng hôm sau gắn đúng ca | TH |
| CA-05 | P2 | Chuyển một công nhân từ kíp A sang kíp B từ giữa tháng | Trước ngày chuyển theo kíp A, sau theo kíp B; không mất ô ngoại lệ đã lưu | TH |
| CA-06 | P2 | Gán ca hàng loạt cho 30 người trong một khoảng ngày | Làm bằng một thao tác; ô chưa lưu có viền báo; hủy thay đổi được | UX |
| CA-07 | P2 | Sửa ô ca trong kỳ đã khóa công | Bị chặn hoặc cảnh báo rõ; nếu cho sửa thì bảng lương phải báo cần tính lại (theo kịch bản quay: hiện không tự báo) - ghi nhận | KS |
| CA-08 | P2 | Lưới 31 ngày x 50 người trên màn hình laptop 14 inch | Đọc được không cần cuộn ngang quá một lần; cột nhân viên cố định khi cuộn | UX |
| CA-09 | P3 | Ngày lễ rơi vào ngày có ca | Lưới đánh dấu ngày lễ; ca ngày lễ được tính làm thêm ngày lễ khi có lượt chấm (xem CC-12) | TH |

### 5.4 Chấm công, máy chấm công, đơn từ (CC)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| CC-01 | P1 | Nạp file máy chấm công 1.400 dòng theo hồ sơ nguồn | Xem trước đủ số dòng: Mới, Trùng, Lỗi, Chưa đối chiếu, Kỳ đã khóa; ghi đủ số Mới | NV |
| CC-02 | P1 | Nạp lại đúng file vừa ghi | Toàn bộ là Trùng, ghi 0 dòng | KS |
| CC-03 | P1 | File có 2 mã máy chưa gán nhân viên | Hiện danh sách mã, số dòng, lượt chấm đầu; gán tại chỗ, lưu, xem trước tự chạy lại và hết Chưa đối chiếu | NV |
| CC-04 | P1 | Gán nhầm mã máy cho sai người rồi phát hiện sau khi ghi | Có cách sửa đối chiếu và xử lý lại lượt đã ghi; ghi nhận số bước | TH |
| CC-05 | P1 | File sai định dạng: sai dấu phân cách, ngày tháng đảo, dòng thiếu cột, dòng ngoài kỳ | Dòng lỗi được chỉ rõ số dòng và lý do; dòng đúng vẫn ghi được; không ghi dữ liệu rác | KS |
| CC-06 | P1 | Xử lý chấm công máy cho kỳ trên 3.000 ô nhân viên x ngày, bằng vai trò HR | Chạy nền được bằng vai trò HR (BUG-001 đã sửa, phải kiểm lại bằng HR); màn hình báo tiến độ và kết quả | NV |
| CC-07 | P1 | Đi trễ đúng 15, 16, 60, 61, 240, 241 phút (quy tắc mặc định) | Ngày bị trừ lần lượt 0; 0,25; 0,25; 0,5; 0,5; 1 | TT |
| CC-08 | P1 | Duyệt một phiếu đi trễ 0,25 ngày của U01 | Công hưởng lương giảm 0,25; lương cơ bản = Round(20.000.000 x 21,75 / 22) = 19.772.727 | TT |
| CC-09 | P1 | Không duyệt phiếu đề xuất rồi khóa công | Phiếu chưa duyệt không ảnh hưởng công; hộp xác nhận nêu số ngoại lệ còn mở | KS |
| CC-10 | P1 | Thiếu lượt chấm ra | Sinh phiếu "thiếu lượt chấm", không tự coi là vắng, không tự trừ công | TH |
| CC-11 | P1 | **Ngày lễ không có lượt chấm** (lỗi đã thấy ở kỳ SAOMAI-202702, ngày 01/02) | Không được đề xuất "vắng" cho ngày lễ. Hiện trạng: hệ thống đề xuất vắng. Phải đạt trước nghiệm thu | TH |
| CC-12 | P1 | Có lượt chấm vào ngày lễ và ngày nghỉ tuần | Sinh đơn làm thêm đề xuất loại ngày lễ, nghỉ tuần tương ứng | TH |
| CC-13 | P1 | Làm thêm sau ca 1,43 giờ, ngưỡng làm thêm tối thiểu của ca là 30 phút; trường hợp 20 phút | Trên ngưỡng: có đơn đề xuất đúng số giờ; dưới ngưỡng: không sinh đơn | TT |
| CC-14 | P1 | Người lập đơn tự duyệt đơn của mình | Bị chặn | KS |
| CC-15 | P1 | Lập đơn nghỉ trùng ngày với đơn đã duyệt; đơn nghỉ vượt số dư phép | Bị chặn khi gửi duyệt, thông báo nêu ngày trùng hoặc số dư còn lại | KS |
| CC-16 | P1 | Khóa công rồi thử gửi, duyệt, hủy chứng từ thuộc kỳ; thử sửa trực tiếp chứng từ trên form NetSuite và bằng CSV Import | Tất cả bị chặn | KS |
| CC-17 | P1 | Mở khóa công khi kỳ chưa có bảng lương ghi sổ; khi đã có bảng lương ghi sổ hoặc đã đảo | Trường hợp đầu mở được; trường hợp sau bị chặn, thông báo nêu cách điều chỉnh qua kỳ sau | KS |
| CC-18 | P1 | Lập bảng công nhiều lần sau mỗi lần duyệt chứng từ | Số công đổi đúng; chạy lại không nhân đôi | TT |
| CC-19 | P2 | Nghỉ nửa ngày phép (sáng), nửa ngày không lương (chiều) cùng ngày | Ký hiệu và công đúng: 0,5 có lương, 0,5 không lương | TH |
| CC-20 | P2 | Đơn nghỉ 5 ngày vắt qua cuối tuần và một ngày lễ | Số ngày đơn tự bỏ ngày nghỉ tuần và ngày lễ | TT |
| CC-21 | P2 | Đơn nghỉ vắt qua hai kỳ lương | Mỗi kỳ nhận đúng số ngày của mình | TH |
| CC-22 | P2 | Nghỉ không lương từ ngưỡng `INS.ABSENCE_DAYS_THRESHOLD` ngày trở lên trong tháng | Không tính mọi khoản trích của tháng, cảnh báo "lập báo giảm" (kiểm tại BH-06) | TH |
| CC-23 | P2 | Đơn công tác có số tiền tạm ứng, duyệt rồi hủy | Duyệt sinh phiếu tạm ứng Tạm giữ; hủy đơn xóa phiếu chưa ghi sổ; phiếu đã ghi sổ thì chặn hủy | NV |
| CC-24 | P2 | Công nhân quên thẻ cả ngày, quản lý xác nhận có đi làm | Có cách ghi nhận bằng phiếu điều chỉnh công có lý do; số bước hợp lý | TH |
| CC-25 | P2 | Hai máy chấm công (xưởng, kho), một người chấm ở cả hai trong ngày | Lượt chấm gộp đúng theo người; không báo thiếu lượt | TH |
| CC-26 | P2 | Bấm một ô ngày trên lưới công | Thấy ca, lượt chấm, chứng từ liên quan, nút xử lý ngay trong khung bên phải, không mở tab mới | UX |
| CC-27 | P2 | Duyệt 60 đơn làm thêm đề xuất của một tuần | Có duyệt hàng loạt không; nếu phải duyệt từng phiếu (2 lần bấm mỗi phiếu) thì ghi nhận là điểm cần cải tiến | UX |
| CC-28 | P2 | Ô tìm trong khung ngoại lệ: tìm theo tên, ngày, loại, số chứng từ | Tìm được bằng tiếng Việt và tiếng Anh theo ngôn ngữ giao diện; kết quả tức thì | UX |
| CC-29 | P2 | Nút "Mở chứng từ" trong khung ngoại lệ | Hiện trạng: mở tab trình duyệt mới. Đánh giá có gây rối luồng không | UX |
| CC-30 | P3 | Mở tab Chấm công lần đầu trong ngày | Kỳ mặc định phải là kỳ đang chạy của công ty con đang chọn. Hiện trạng: có lúc mở kỳ cũ (202610) - ghi nhận | UX |
| CC-31 | P3 | In bảng chấm công tháng theo bộ phận | PDF A4 ngang, đủ ký hiệu, chú giải, chữ ký | NV |

### 5.5 Nghỉ phép (PH)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| PH-01 | P1 | Cấp phép năm theo chính sách mẫu 12 ngày, thêm 1 ngày mỗi 5 năm thâm niên: người 4 năm 11 tháng, 5 năm, 10 năm tính đến 31/12 | 12; 13; 14 ngày | TT |
| PH-02 | P1 | Người mới vào ngày 15 và ngày 16 của tháng 7 (bật tỷ lệ cho người mới) | Vào ngày 15: tính từ tháng 7 (6 tháng, 6 ngày); vào ngày 16: tính từ tháng 8 (5 tháng, 5 ngày); làm tròn 0,5 | TT |
| PH-03 | P1 | Chạy cấp phép hai lần | Không cấp trùng | KS |
| PH-04 | P1 | Chuyển phép năm trước với trần chuyển 5 ngày, người còn 8 ngày | Chuyển 5, kèm hạn dùng; chạy hết hạn phép chuyển sau hạn thì trừ phần chưa dùng | TT |
| PH-05 | P1 | Gửi đơn, duyệt, từ chối, hủy đơn phép | Sổ phép: gửi thì Chờ duyệt tăng; duyệt thì Đã dùng tăng; từ chối, hủy thì trả lại. Khả dụng = cấp + chuyển + điều chỉnh - đã dùng - chờ duyệt | TT |
| PH-06 | P1 | U10 nghỉ việc còn 3 ngày phép | Dòng trả phép = 3 x (20.000.000 / 22) = 2.727.273, chịu thuế | TT |
| PH-07 | P2 | Cộng tác viên lập đơn phép năm | Không có phép năm, thông báo rõ | KS |
| PH-08 | P2 | Nghỉ ốm, thai sản (BHXH trả) cả tháng cho U11 | Công hưởng lương 0; không trích BH khi đạt ngưỡng ngày; cảnh báo thực lĩnh 0 và không có công, không báo lỗi | TH |
| PH-09 | P2 | Nghỉ việc riêng có lương 4 ngày một đơn (tối đa 3) | Bị chặn hoặc cảnh báo theo cấu hình loại nghỉ | KS |
| PH-10 | P2 | Điều chỉnh tay số dư phép không ghi lý do | Bị chặn | KS |
| PH-11 | P2 | Phép dùng trước khi được cấp (tháng 1, cấp theo tháng) | Ghi nhận hành vi: có cho ứng phép không; key user quyết định | TH |
| PH-12 | P3 | Nhân viên xem số dư và hạn phép chuyển trên điện thoại | Số khớp sổ phép HR | NV |

### 5.6 Sản lượng, lương khoán (SL)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| SL-01 | P1 | Phiếu tổ 3 dòng: 17 x 240.000; 8 x 360.000; 1.497 x 2.500 | Thành tiền 4.080.000 + 2.880.000 + 3.742.500 = 10.702.500 | TT |
| SL-02 | P1 | Chia đều 1.000.000 cho 3 người | Một người 333.334, hai người 333.333; tổng đúng 1.000.000 | TT |
| SL-03 | P1 | Chia theo ngày công x hệ số: thành tiền 6.600.000; A 20 ngày hệ số 1,2; B 20 ngày hệ số 1; C 10 ngày hệ số 1 | Đơn vị chia 24 + 20 + 10 = 54. Phần nguyên: A 2.933.333; B 2.444.444; C 1.222.222 (tổng 6.599.999). Dư 1 đồng về người có phần lẻ lớn nhất là B (0,44). Kết quả: A 2.933.333; B 2.444.445; C 1.222.222; tổng 6.600.000 | TT |
| SL-04 | P1 | Thành viên có 0 ngày công trong kỳ (nghỉ cả đợt) | Nhận 0 đồng; không lỗi chia cho 0; tổng vẫn khớp | TT |
| SL-05 | P1 | Phiếu Tạm giữ hoặc Chờ duyệt khi tính lương | Không vào lương; có cảnh báo hoặc chỉ dẫn trên màn Sản lượng ("Việc cần làm") | KS |
| SL-06 | P1 | Ghi sổ bảng lương rồi mở lại phiếu đã dùng | Phiếu ở "Đã vào bảng lương", không sửa, không trả về tạm giữ được; đảo bảng lương thì phiếu về Đã duyệt | KS |
| SL-07 | P1 | Đơn giá đổi từ giữa tháng (hai dòng hiệu lực), phiếu ngày trước và sau ngày đổi | Mỗi phiếu tra đúng đơn giá theo ngày phiếu | TT |
| SL-08 | P1 | Sửa tay đơn giá trên phiếu khi bảng đơn giá không cho sửa | Hệ thống giữ đơn giá bảng | KS |
| SL-09 | P2 | Thành viên vào tổ giữa tháng (hiệu lực từ ngày 16), phiếu ngày 10 và ngày 20 | Phiếu ngày 10 không có người đó; phiếu ngày 20 có | TH |
| SL-10 | P2 | Một công nhân thuộc hai tổ trong tháng | Nhận tiền từ cả hai phiếu; ngày công không bị tính trùng cách bất hợp lý - ghi nhận | TH |
| SL-11 | P2 | Sửa tay số tiền một thành viên sau khi chia | Cờ Sửa tay; tổng phải vẫn bằng thành tiền, lệch thì chặn gửi duyệt | KS |
| SL-12 | P2 | Từ chối phiếu không ghi lý do | Bị chặn | KS |
| SL-13 | P2 | Lập phiếu cho kỳ đã khóa công | Bị chặn khi gửi duyệt | KS |
| SL-14 | P2 | Nhập 40 dòng sản lượng cho một phiếu | Đo thời gian; có dán từ Excel không; Tab di chuyển đúng thứ tự mã hạng mục, số lượng; tổng cập nhật tức thì | UX |
| SL-15 | P2 | Lập 12 phiếu tuần cho 3 tổ trong một tháng | Có thao tác hàng loạt chia và gửi duyệt không (BUG-003 đề xuất). Hiện trạng: từng phiếu, mỗi phiếu khoảng 8 lần bấm | UX |
| SL-16 | P2 | "Lấy từ giao dịch" với Work Order Completion (cần account có sản xuất) | Sinh phiếu Tạm giữ, không sinh trùng khi chạy lại. Phần này mới kiểm bằng test đơn vị, phải chạy thật trước khi cam kết với khách sản xuất | NV |
| SL-17 | P3 | In bảng chia lương tổ | Có chữ ký tổ trưởng, người lập, người duyệt; tổng khớp phiếu | NV |

### 5.7 Hoa hồng (HH)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| HH-01 | P1 | Kế hoạch tỷ lệ cố định 2,5%, doanh số thuần 250.000.000 | Hoa hồng 6.250.000 | TT |
| HH-02 | P1 | Thang lũy tiến theo giá trị: đến 100 triệu 1%, 100 - 200 triệu 2%, trên 200 triệu 3%; doanh số 250 triệu | 1.000.000 + 2.000.000 + 1.500.000 = 4.500.000 | TT |
| HH-03 | P1 | Thang bậc toàn phần cùng bậc, doanh số 250 triệu | 250.000.000 x 3% = 7.500.000 | TT |
| HH-04 | P1 | Doanh số đúng tại cận bậc 100.000.000 và 200.000.000 | Kết quả thống nhất với quy ước cận trên hay cận dưới ghi trong kế hoạch; ghi lại quy ước | TT |
| HH-05 | P1 | Ngưỡng đạt tối thiểu 80%, U12 đạt 79,9% và 80% | Dưới ngưỡng 0; đúng ngưỡng có hoa hồng | TT |
| HH-06 | P1 | Hóa đơn 100 triệu, credit memo trả hàng 20 triệu cùng kỳ | Cơ sở 80 triệu | TT |
| HH-07 | P1 | Hóa đơn tháng trước, trả hàng tháng này (clawback) | Tháng này cơ sở âm; số phải trả không âm, phần âm thành số dư ứng trước trừ kỳ sau | TH |
| HH-08 | P1 | Ghi nhận khi thu tiền: hóa đơn 100 triệu, thu 40 triệu trong kỳ | Cơ sở 40 triệu | TT |
| HH-09 | P1 | Đơn có hai nhân viên bán, chia 60 / 40 | Mỗi người nhận đúng tỷ lệ; tổng bằng 100% | TT |
| HH-10 | P1 | Nạp file doanh số ngoài hai lần | Lần hai báo trùng theo khóa công ty + hệ thống nguồn + số chứng từ + dòng | KS |
| HH-11 | P1 | File doanh số có mã nhân viên sai, ngày sai, số âm, thiếu cột | Dòng lỗi nêu rõ; không ghi dòng lỗi | KS |
| HH-12 | P1 | Doanh số chưa ai được ghi nhận (hóa đơn không có sales rep) | Cảnh báo trên bảng tính kèm số chứng từ và giá trị | KS |
| HH-13 | P1 | Duyệt bảng tính, tính lương, ghi sổ; rồi thử mở lại bảng tính | Dòng hoa hồng vào lương bằng số phải trả; bảng tính sang "Đã vào bảng lương", không mở lại được; đảo lương thì về Đã duyệt | KS |
| HH-14 | P2 | Hoa hồng quản lý 3% trên hoa hồng cấp dưới | Bằng 3% tổng hoa hồng các cấp dưới trực tiếp; diễn giải từng bước đúng | TT |
| HH-15 | P2 | Trần hoa hồng mỗi kỳ; bảo đảm tối thiểu (draw) | Vượt trần thì cắt; dưới mức bảo đảm thì bù, theo đúng loại draw | TT |
| HH-16 | P2 | Cửa sổ lũy kế quý: tháng 1 và 2 đã trả, tháng 3 đạt bậc cao hơn | Tháng 3 trả phần chênh lũy kế (true-up), không trả trùng | TT |
| HH-17 | P2 | Nhân viên kinh doanh nghỉ việc giữa tháng; đổi vùng, đổi kế hoạch giữa tháng | Ghi nhận theo phân công hiệu lực tại ngày chứng từ | TH |
| HH-18 | P2 | Tab Mô phỏng: nhập doanh số giả định | Kết quả khớp tính tay; không ghi dữ liệu | NV |
| HH-19 | P2 | Người tính và người duyệt bảng tính là một | Hiện trạng: cùng vai trò kế toán làm được cả hai. Key user quyết định có cần tách không | KS |
| HH-20 | P2 | Bấm vào một con số hoa hồng | Thấy diễn giải từng bước và danh sách giao dịch; từ giao dịch mở được chứng từ NetSuite | UX |
| HH-21 | P3 | Tính hoa hồng từ đơn bán hàng (Sales Order) | Theo backlog FEAT-001 hiện chỉ đọc Invoice, Cash Sale, Credit Memo. Xác nhận phạm vi với khách trước khi cam kết | TH |

### 5.8 Tạm ứng (TU)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| TU-01 | P1 | Lập phiếu 3.000.000 cho U15, bỏ tạm giữ, KT ghi sổ | Bút toán Nợ 141 / Có tài khoản tiền; số dư 3.000.000; trạng thái Đang cấn trừ | NV |
| TU-02 | P1 | HR thử ghi sổ tạm ứng | Không có nút; gọi trực tiếp cũng bị máy chủ chặn | KS |
| TU-03 | P1 | U15 có hai phiếu 3.000.000 (ngày 5) và 9.000.000 (ngày 12), thực lĩnh trước tạm ứng 8.950.000 | Cấn phiếu ngày 5 hết 3.000.000, phiếu ngày 12 cấn 5.950.000; thực lĩnh 0; còn 3.050.000 chuyển kỳ sau kèm cảnh báo | TT |
| TU-04 | P1 | Tính lương xong, thêm một phiếu tạm ứng mới đã ghi sổ, rồi ghi sổ bảng lương | Bị chặn, yêu cầu tính lại | KS |
| TU-05 | P1 | Ghi sổ bảng lương có cấn trừ, rồi đảo | Ghi sổ: Có 141 theo từng phiếu, số dư giảm; đảo: hoàn đúng số đã cấn | TT |
| TU-06 | P2 | Nhân viên nghỉ việc còn dư tạm ứng lớn hơn lương kỳ cuối | Cảnh báo còn dư; ghi nhận cách thu hồi phần còn lại | TH |
| TU-07 | P2 | Giới hạn cấn trừ tối đa mỗi kỳ (ví dụ không quá 30% lương) | Theo sổ tay: lõi có nhưng chưa nối, hiện không giới hạn. Key user quyết định có cần không | TH |
| TU-08 | P3 | Sửa trực tiếp số dư phiếu trên form NetSuite | Bị chặn | KS |

### 5.9 Chạy lương (BL)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| BL-01 | P1 | U01 đủ công | Lương cơ bản 20.000.000; BH, thuế theo phiếu tính tay; thực lĩnh khớp đến đồng | TT |
| BL-02 | P1 | U09 vào làm ngày 16, kỳ 22 ngày công chuẩn, làm 11 ngày | Lương cơ bản Round(20.000.000 x 11 / 22) = 10.000.000; ngày ngoài hợp đồng tính là nghỉ không lương khi xét ngưỡng BH | TT |
| BL-03 | P1 | U10 nghỉ việc ngày 10, làm 7 ngày công, còn 3 ngày phép | Lương cơ bản Round(20.000.000 x 7 / 22) = 6.363.636; trả phép 2.727.273 | TT |
| BL-04 | P1 | U02 phụ cấp cố định 2.000.000, nghỉ không lương 2 ngày | Lương 30.000.000 x 20 / 22 = 27.272.727; phụ cấp 2.000.000 x 20 / 22 = 1.818.182 (quy tắc mặc định chia theo ngày công) | TT |
| BL-05 | P1 | U05 lương ngày 400.000, làm 18 ngày | 7.200.000 | TT |
| BL-06 | P1 | U14 lương giờ 60.000, 150 giờ đã duyệt trên Time; thêm 10 giờ chưa duyệt | 9.000.000 khi bật "Chỉ lấy giờ đã duyệt"; HR sửa giờ phải ghi lý do; nạp lại giữ giờ đã sửa | TT |
| BL-07 | P1 | Ăn ca vượt trần miễn thuế | Phần đến trần miễn thuế, phần vượt chịu thuế; hai khoản cùng mã trần cộng dồn trong tháng | TT |
| BL-08 | P1 | Làm thêm U01: 2 giờ ngày thường, 4 giờ ngày nghỉ tuần, 8 giờ ngày lễ | Lương giờ 20.000.000 / (22 x 8) = 113.636,36; tiền = Round(lương giờ x giờ x hệ số P14, P15, P16); phần miễn thuế = phần chênh so với lương giờ thường | TT |
| BL-09 | P1 | Làm đêm không phải làm thêm 8 giờ; làm thêm ban đêm ngày thường 2 giờ | Làm đêm: chỉ sinh phần phụ trội theo P17, miễn thuế toàn bộ phần phụ trội; làm thêm đêm theo công thức mục 8.4 sổ tay, tester tính tay hai trường hợp có và không có làm thêm ban ngày trước đó | TT |
| BL-10 | P1 | Làm thêm vượt giới hạn tháng, năm | Chỉ cảnh báo, không chặn, không cắt giờ; đúng bằng giới hạn thì không cảnh báo | KS |
| BL-11 | P1 | U04 có số ca đêm theo lịch ca, phụ cấp ca đêm 40.000 một ca | Số ca x 40.000; đổi ô ca rồi tính lại thì số đổi theo | TT |
| BL-12 | P1 | Thêm dòng thu nhập nhập tay (thưởng 5.000.000) và khấu trừ sau thuế (500.000) | Thưởng vào tổng thu nhập, chịu thuế; khấu trừ trừ sau thuế; bảng về trạng thái chưa tính, phải tính lại | TT |
| BL-13 | P1 | Một nhân viên đã ở bảng lương chưa đảo của kỳ; tạo bảng thứ hai và nạp nhân viên | Người đó bị bỏ qua và được liệt kê | KS |
| BL-14 | P1 | Tính lương khi chưa khóa công (bật bắt buộc khóa công) | Bị chặn | KS |
| BL-15 | P1 | Sửa một dòng nhập tay sau khi đã tính, rồi duyệt ngay | Duyệt bị chặn vì dấu dữ liệu không khớp, yêu cầu tính lại | KS |
| BL-16 | P1 | Bảng có một dòng lỗi (U13) | Bảng ở Chờ tính; cảnh báo mức lỗi chặn duyệt; dòng lỗi nêu lý do; các dòng khác vẫn có số | KS |
| BL-17 | P1 | Thực lĩnh âm (khấu trừ lớn hơn thu nhập) | Cảnh báo mức lỗi, chặn duyệt | KS |
| BL-18 | P1 | Tab Cần soát: thực lĩnh lệch trên 20% so với kỳ trước, thiếu MST, thiếu tài khoản ngân hàng, thực lĩnh 0 | Đủ các cảnh báo; chấp nhận phải ghi chú; sửa số liệu thì cảnh báo đã đóng tự mở lại | KS |
| BL-19 | P1 | Duyệt một cấp: người lập cũng là người duyệt | Hiện trạng: hệ thống cho phép. KTT quyết định bật duyệt nhiều cấp hay chấp nhận | KS |
| BL-20 | P1 | Duyệt hai cấp: người gửi tự duyệt cấp 1; người duyệt cấp 1 duyệt luôn cấp 2 | Cả hai bị chặn (trừ khi cấp chỉ có một người đủ quyền, có ghi "miễn tách nhiệm vụ") | KS |
| BL-21 | P1 | Từ chối không ghi chú; từ chối có ghi chú rồi gửi lại | Lần đầu bị chặn; gửi lại bắt đầu từ cấp 1; nhật ký duyệt đủ dòng | KS |
| BL-22 | P1 | HR thử Ghi sổ, Đảo | Không có nút; máy chủ chặn | KS |
| BL-23 | P1 | Hai người cùng bấm Tính hoặc Ghi sổ một bảng | Một người chạy, người kia nhận thông báo đang xử lý; không tạo hai bút toán | KS |
| BL-24 | P1 | Mất mạng hoặc đóng trình duyệt giữa lúc ghi sổ, rồi bấm lại | Không tạo bút toán thứ hai; các bước sau bút toán chạy tiếp | KS |
| BL-25 | P1 | Sửa trực tiếp record bảng lương, dòng nhân viên trên form NetSuite hoặc CSV | Bị chặn | KS |
| BL-26 | P2 | Bảng 1.000 nhân viên | Nạp, tính, ghi sổ chạy nền hoàn tất; mốc tham khảo đã đo: nạp 131 giây, tính 165 giây, ghi sổ 79 giây; có thanh tiến độ, người dùng không phải tải lại | UX |
| BL-27 | P2 | Bảng lương ngoài kỳ (thưởng Tết, lương tháng 13 chi riêng) | Ghi nhận cách làm: bảng lương riêng hay dòng nhập tay; thuế tính gộp tháng thế nào; tất toán 335 hiện làm tay - KTT đánh giá | TH |
| BL-28 | P2 | Truy lĩnh lương do tăng lương hồi tố 2 tháng | Theo sổ tay chưa có chức năng tự động. Ghi nhận cách làm bằng dòng nhập tay và rủi ro | TH |
| BL-29 | P2 | Nhân viên làm ở hai công ty con trong tháng | Ghi nhận hành vi; thuế, BH xử lý ở công ty nào | TH |
| BL-30 | P2 | Nhóm lương nửa tháng: kỳ 1 tạm trả, kỳ 2 tính BH và thuế cả tháng | Kỳ 1 không BH, không thuế; kỳ 2 tính trên thu nhập gộp; tổng thuế tháng bằng tính tay cả tháng | TT |
| BL-31 | P2 | Màn một bảng lương: tìm một người, đọc từng khoản | Tìm trong 5 giây; mỗi dòng thu nhập có diễn giải công thức (số lượng x đơn giá); các tab Thu nhập, Khấu trừ, Bảo hiểm, Thuế, Công, Giờ công, Phân bổ, Cấn trừ, Bút toán, Bill đủ | UX |
| BL-32 | P2 | Nhập thưởng cho 50 người | Có nhập hàng loạt hoặc dán từ Excel không; nếu phải vào từng người thì đo thời gian và ghi nhận | UX |
| BL-33 | P2 | So kỳ trước | Cột lệch đúng; người mới, người nghỉ được đánh dấu; bấm vào xem lệch do khoản nào | UX |
| BL-34 | P3 | Thông báo lỗi khi tính | Bằng ngôn ngữ người dùng, nêu việc cần làm; không hiện mã lỗi kỹ thuật hay tiếng Anh lẫn tiếng Việt | UX |

### 5.10 Bảo hiểm bắt buộc, công đoàn (BH)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| BH-01 | P1 | U01 lương đóng 20.000.000 | Từng khoản = Round(20.000.000 x tỷ lệ P13), riêng phần NLĐ và DN; tổng khớp phiếu tính tay | TT |
| BH-02 | P1 | U03 lương đóng 120.000.000 | Căn cứ BHXH, BHYT = P8 x P9; căn cứ BHTN = P12 x P10; không tính trên 120.000.000 | TT |
| BH-03 | P1 | U13 lương đóng dưới lương tối thiểu vùng | Dòng báo lỗi, không tính; thông báo nêu mức tối thiểu của vùng | KS |
| BH-04 | P1 | U06 cộng tác viên | Không có khoản trích nào | TT |
| BH-05 | P1 | U02 đoàn viên, U01 không phải đoàn viên | Đoàn phí chỉ U02; đoàn phí không trừ khi tính thuế nhưng trừ vào thực lĩnh; trần đoàn phí theo hệ số x mức tham chiếu | TT |
| BH-06 | P1 | Nghỉ không lương đúng P11 - 1 ngày và đúng P11 ngày | Dưới ngưỡng: trích đủ; đúng ngưỡng: không trích khoản nào (kể cả KPCĐ) và cảnh báo lập báo giảm | TT |
| BH-07 | P1 | Người mới vào ngày 16 mà số ngày ngoài hợp đồng đạt ngưỡng P11 | Không trích tháng đó (ngày ngoài hợp đồng cộng vào ngày nghỉ xét BH); HR xác nhận đúng thực tế đơn vị | TH |
| BH-08 | P1 | Tắt cờ tham gia BHTN của một người; tắt "DN đóng KPCĐ" | Bỏ đúng khoản tương ứng | TT |
| BH-09 | P2 | Lương đóng BH khác lương hợp đồng (đóng trên lương thấp hơn hoặc gồm phụ cấp) | Căn cứ là lương đóng BH trên lịch sử lương, không phải thu nhập thực tế | TT |
| BH-10 | P2 | Người nước ngoài U08 | Theo sổ tay không có quy tắc riêng, dùng cờ tham gia. HR, KTT xác nhận đủ cho trường hợp của đơn vị | TH |
| BH-11 | P2 | Người lao động cao tuổi, đang hưởng lương hưu, người thử việc | Ghi nhận cách khai (cờ tham gia) và kết quả; KTT xác nhận | TH |
| BH-12 | P2 | Truy đóng BH do khai sót tháng trước | Theo sổ tay chưa có. Ghi nhận cách làm tay | TH |
| BH-13 | P1 | Báo cáo BH phải nộp tháng | Tổng từng quỹ bằng tổng tab Bảo hiểm các nhân viên và bằng phát sinh Có 338x trên bút toán; nhập số C12 thấy chênh lệch | TT |
| BH-14 | P2 | D02-LT: tháng có người tăng mới, giảm hẳn, nghỉ không lương, điều chỉnh lương | Mã biến động TM, GH, KL, DC đúng người | NV |

### 5.11 Thuế TNCN (TN)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| TN-01 | P1 | U01 không người phụ thuộc | Thu nhập tính thuế và thuế khớp phiếu tính tay theo công thức 5, 6 mục 4.2 | TT |
| TN-02 | P1 | U02 hai người phụ thuộc | Giảm trừ = P1 + 2 x P2; thuế khớp | TT |
| TN-03 | P1 | Thu nhập tính thuế đúng bằng cận từng bậc và cận + 1 đồng | Thuế liên tục qua cận, không nhảy; làm tròn một lần ở tổng | TT |
| TN-04 | P1 | Thu nhập chịu thuế nhỏ hơn tổng giảm trừ (U04) | Thu nhập tính thuế 0, thuế 0, không âm | TT |
| TN-05 | P1 | Kỳ cuối năm cũ và kỳ đầu năm mới khi biểu thuế đổi theo ngày hiệu lực | Mỗi kỳ dùng đúng bộ biểu theo ngày cuối kỳ, không trộn | TT |
| TN-06 | P1 | U06 thù lao 8.000.000, không cam kết; thù lao dưới ngưỡng P5 | Trên ngưỡng: thuế = Round(thu nhập x P4); dưới ngưỡng: 0 | TT |
| TN-07 | P1 | U07 có cam kết 08/CK-TNCN | Thuế 0 | TT |
| TN-08 | P1 | CTV nhận hai lần chi trong tháng, mỗi lần dưới ngưỡng nhưng tổng vượt ngưỡng | Xét từng lần chi, mỗi lần thuế 0. KTT xác nhận phù hợp cách hiểu của đơn vị | TH |
| TN-09 | P1 | U08 không cư trú | Thuế = Round(thu nhập chịu thuế x P6), không giảm trừ | TT |
| TN-10 | P1 | Giảm trừ khác (từ thiện, hưu trí tự nguyện) nhập số âm, nhập số dương | Số âm bị chặn; số dương được trừ | KS |
| TN-11 | P1 | Tờ khai 05/KK-TNCN quý | Từng chỉ tiêu bằng tổng các bảng lương của quý; chỉ tiêu ghi "chưa tính" được liệt kê để kế toán tự điền | TT |
| TN-12 | P2 | Người phụ thuộc đăng ký giữa năm, muốn tính từ tháng phát sinh nghĩa vụ | Khai ngày bắt đầu giảm trừ; kỳ đã ghi sổ không tự tính lại - ghi nhận | TH |
| TN-13 | P2 | Người nước ngoài chuyển từ không cư trú sang cư trú giữa năm | HR đổi cách tính thuế thủ công; không tự tính lại các tháng trước - ghi nhận | TH |
| TN-14 | P2 | Quyết toán năm: tính lại thuế năm, số nộp thêm hoặc hoàn, chứng từ khấu trừ, XML HTKK | Theo sổ tay chưa có; chỉ có bảng kê 05-1/BK, 05-2/BK và phiếu số liệu. KTT quyết định mức chấp nhận cho mùa quyết toán | TH |
| TN-15 | P2 | Nhân viên làm dưới 3 tháng, thử việc: khấu trừ 10% hay lũy tiến | HR chọn cách tính trên hồ sơ; hệ thống không tự chọn - ghi nhận | TH |
| TN-16 | P2 | Tab Thuế TNCN của một nhân viên | Hiện đủ từng bước: tổng thu nhập, miễn thuế, BH, giảm trừ, thu nhập tính thuế, thuế từng bậc; người không chuyên thuế đọc hiểu | UX |

### 5.12 Hạch toán, phân bổ, đảo, bill (KT)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| KT-01 | P1 | Xem trước bút toán trước khi ghi sổ | Tổng Nợ = tổng Có; Có 334 = tổng thực lĩnh nhân viên; Có 3335 = tổng thuế; Có 338x = BH NLĐ + DN từng khoản; Có 141 = tổng cấn trừ | TT |
| KT-02 | P1 | Ghi sổ, mở Journal Entry trên NetSuite | Một bút toán duy nhất, ngày = ngày chứng từ bảng lương; số dòng và số tiền bằng bản xem trước. **Lưu ý: link số bút toán trên bảng lương hiện mở ra tab trắng (thấy khi quay kỳ SAOMAI-202702), phải đạt** | TT |
| KT-03 | P1 | Tổng phân bổ của một nhân viên | = tổng thu nhập + BH phần DN của người đó | TT |
| KT-04 | P1 | Công nhân trực tiếp, quản đốc, nhân viên bán hàng, nhân viên văn phòng | Chi phí vào đúng tài khoản kế toán đã khai theo đích (ví dụ 622, 6271, 641, 642), kèm phòng ban, địa điểm, khối | TT |
| KT-05 | P1 | Nhân viên phân bổ 60 / 40 hai dự án theo bảng tỷ lệ | Lương và BH DN chia đúng 60 / 40, làm tròn không lệch tổng | TT |
| KT-06 | P1 | Lương khoán, hoa hồng có đích riêng | Chi phí đi theo dự án, phòng ban của phiếu hoặc phân đoạn doanh thu, không theo bảng tỷ lệ của nhân viên | TT |
| KT-07 | P1 | U02 có trích tháng 13, lương 30.000.000, phụ cấp không tính | Trích Round(30.000.000 / 12) = 2.500.000; Nợ chi phí / Có 335; không đổi thực lĩnh; không phụ thuộc ngày công | TT |
| KT-08 | P1 | Đảo bảng lương đã ghi sổ | Bút toán đảo đủ từng dòng, giữ phân đoạn; bảng sang Đã đảo; còn bill hiệu lực thì chặn đảo | KS |
| KT-09 | P1 | Lập bill cơ quan thu | Mỗi nhà cung cấp một bill, số tiền = phát sinh 338x và 3335. **Lưu ý BUG-002: pháp nhân 14 đang lỗi "giá trị không hợp lệ cho trường subsidiary" do nhà cung cấp chưa gán công ty con; phải có thông báo nghiệp vụ dễ hiểu** | NV |
| KT-10 | P1 | Kỳ kế toán NetSuite đã đóng hoặc ngày khóa sổ sau ngày chứng từ | Ghi sổ báo lỗi rõ, bảng lương không rơi vào trạng thái dở dang | KS |
| KT-11 | P1 | Account bật duyệt bút toán, tắt "Tự duyệt" | Bút toán tạo ở chờ duyệt; hệ thống cảnh báo chưa vào sổ cái | KS |
| KT-12 | P1 | Báo cáo Chi phí theo tài khoản | Số theo bảng lương = phát sinh trên bút toán, chênh lệch 0 | TT |
| KT-13 | P2 | Thiếu tài khoản chi phí cho một đích | Lỗi nêu đúng đích thiếu; không ghi bút toán thiếu dòng | KS |
| KT-14 | P2 | Thanh toán lương (Nợ 334 / Có tiền), nộp BH, nộp thuế | Gói không tạo; làm bằng nghiệp vụ chuẩn NetSuite. KT xác nhận quy trình đủ và số dư 334, 338x, 3335 về 0 sau thanh toán | TH |
| KT-15 | P2 | Chi lương tháng 13 và tất toán 335 | Theo sổ tay chưa có luồng. KTT xác nhận cách làm tay | TH |
| KT-16 | P2 | Bút toán liên công ty (nhân viên công ty A làm cho dự án công ty B) | Theo sổ tay chưa làm. Ghi nhận nhu cầu | TH |

### 5.13 Chi trả, bản in (CT)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| CT-01 | P1 | Xuất file chi lương ngân hàng | CSV UTF-8, mở bằng Excel không lỗi dấu; tổng số tiền = Có 334; chỉ người có thực lĩnh > 0 | TT |
| CT-02 | P1 | Một người thiếu số tài khoản | Báo lỗi liệt kê mã nhân viên; ghi nhận cách xử lý người nhận tiền mặt | KS |
| CT-03 | P1 | In phiếu lương tiếng Việt, tiếng Anh, song ngữ | Số từng khoản = tab chi tiết; thực lĩnh bằng chữ đúng; mỗi người một trang | TT |
| CT-04 | P1 | Người không có vai trò lương mở link in phiếu lương | Bị chặn | KS |
| CT-05 | P2 | Ngân hàng của đơn vị yêu cầu mẫu file riêng | Hiện chỉ có một mẫu CSV chung. Ghi nhận ngân hàng và mẫu cần | TH |
| CT-06 | P2 | Bảng thanh toán tiền lương, quyết toán CTV | Tổng khớp bảng lương; đủ chữ ký theo công ty con | NV |
| CT-07 | P3 | Gửi phiếu lương qua email cho từng người | Ghi nhận có hay không; nhân viên tự xem trên cổng | TH |

### 5.14 Báo cáo, phân tích chi phí (BC)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| BC-01 | P1 | Phân tích chi phí tháng vừa ghi sổ | Tổng chi phí lao động = Nợ chi phí trên bút toán lương; ô đối chiếu sổ cái báo Khớp | TT |
| BC-02 | P1 | Khung "Vì sao thay đổi" | Tổng các thành phần tăng giảm = chênh lệch hai tháng | TT |
| BC-03 | P1 | Phân rã theo phòng ban, dự án, thành phần chi phí; bấm một dòng | Tổng các dòng = tổng tháng; xem được đến từng nhân viên | TT |
| BC-04 | P2 | Đảo bảng lương rồi mở lại phân tích | Số của bảng đã đảo không còn | TT |
| BC-05 | P2 | Xuất CSV mọi báo cáo | Mở bằng Excel đúng dấu, đúng số; số định danh che theo quyền | NV |
| BC-06 | P2 | Màn Báo cáo - tờ khai | Mỗi mục gợi ý kỳ gần nhất có số liệu; tìm đúng báo cáo trong 15 giây | UX |
| BC-07 | P2 | Màn hình báo cáo sau khi tải lại trang | Phải giữ công ty con đang chọn. Hiện trạng: có lúc trở về công ty khác sau khi tải lại (thấy nhiều lần khi quay) - ghi nhận | UX |

### 5.15 Cổng nhân viên (ES)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| ES-01 | P1 | NV đăng nhập, mở Phiếu lương | Chỉ thấy phiếu của mình, chỉ bảng đã ghi sổ; số khớp phiếu in | KS |
| ES-02 | P1 | NV đổi tham số trên địa chỉ (mã bảng lương, mã nhân viên khác) | Không xem được dữ liệu người khác | KS |
| ES-03 | P1 | "Vì sao khác kỳ trước" | Liệt kê đúng khoản tăng, giảm; tổng = chênh lệch thực lĩnh | TT |
| ES-04 | P1 | NV lập đơn nghỉ, đơn làm thêm trên điện thoại | Gửi được; HR thấy ở khung ngoại lệ; NV không tự duyệt được | NV |
| ES-05 | P2 | Người chưa có hồ sơ lương mở cổng | Thông báo rõ, không lỗi kỹ thuật | UX |
| ES-06 | P2 | Dùng trên điện thoại màn 6 inch, mạng 4G | Đọc được không phóng to; mở phiếu lương dưới 5 giây | UX |
| ES-07 | P2 | Ngôn ngữ cổng theo ngôn ngữ tài khoản | Nhãn đổi theo ngôn ngữ; tên khoản lương theo dữ liệu | UX |
| ES-08 | P3 | QL duyệt đơn của nhân viên mình trên điện thoại | Theo sổ tay không có vai trò quản lý trực tiếp trên NetSuite, HR duyệt. Ghi nhận nhu cầu | TH |

### 5.16 Phân quyền, kiểm soát, nhật ký (PQ)

| Mã | Ưu tiên | Tình huống và bước | Kết quả mong đợi | Loại |
| --- | --- | --- | --- | --- |
| PQ-01 | P1 | Ma trận quyền: với từng vai trò HR, KT, NV thử từng thao tác chính (tạo, tính, duyệt, ghi sổ, đảo, lập bill, ghi sổ tạm ứng, sửa thiết lập, xem lương) | Đúng bảng vai trò mục 0.1 sổ tay; nút không có quyền thì không hiện và máy chủ cũng chặn | KS |
| PQ-02 | P1 | Vai trò HR, KT chạy mọi thao tác chạy nền (lập và khóa công kỳ lớn, xử lý chấm công, tính lương trên 120 người) | Chạy được, không báo "không có quyền" (BUG-001 đã sửa; vai trò HR chưa được thử, phải thử) | KS |
| PQ-03 | P1 | HR công ty A xem lương công ty B | Theo sổ tay chưa phân quyền dữ liệu theo công ty. Nếu đơn vị có nhiều pháp nhân thì đây là điểm phải quyết định trước nghiệm thu | KS |
| PQ-04 | P1 | Quản trị IT (Administrator) xem lương | Hiện xem được. Ghi nhận rủi ro và biện pháp tổ chức | KS |
| PQ-05 | P1 | Nhật ký thao tác sau một kỳ | Đủ ai, lúc nào, thao tác gì trên bảng nào; không chứa số tiền, số định danh; không sửa, xóa được | KS |
| PQ-06 | P2 | Tìm kiếm toàn cục NetSuite, Saved Search, SuiteQL bằng vai trò không có quyền lương | Không đọc được record lương | KS |
| PQ-07 | P2 | Trợ lý AI qua NetSuite AI Connector bằng vai trò HR, KT | Chỉ làm được việc đúng quyền vai trò; thao tác ghi cần xác nhận | KS |
| PQ-08 | P2 | Đóng kỳ khi còn bảng lương chưa ghi sổ | Bị chặn | KS |

## 6. Đánh giá dễ dùng và nhập liệu (chạy cùng các testcase trên, chấm riêng)

### 6.1 Chỉ số đo

| Mã | Nhiệm vụ đo | Cách đo | Ngưỡng đạt đề xuất |
| --- | --- | --- | --- |
| UX-M1 | Lập một đơn nghỉ phép | Thời gian, số lần bấm | Dưới 45 giây, dưới 8 lần bấm |
| UX-M2 | Nạp file máy chấm công đến khi ghi xong (không tính thời gian chờ) | Thời gian thao tác | Dưới 2 phút |
| UX-M3 | Lập một phiếu khoán tổ 5 dòng đến khi duyệt | Thời gian, số lần bấm | Dưới 3 phút |
| UX-M4 | Từ khóa công đến bảng lương đã tính (114 người) | Thời gian thao tác và thời gian chờ | Thao tác dưới 2 phút; chờ dưới 3 phút |
| UX-M5 | Tìm và giải thích thực lĩnh của một người cho chính người đó | Thời gian | Dưới 1 phút |
| UX-M6 | Tỷ lệ tự hoàn thành E2E-07 không cần hỏi | Số lần phải hỏi | Không quá 3 lần |
| UX-M7 | Điểm hài lòng của key user từng màn (1 - 5) | Phiếu chấm | Trung bình từ 4 |

### 6.2 Danh sách kiểm áp cho mọi màn hình

| Mã | Điểm kiểm | Đạt khi |
| --- | --- | --- |
| UX-C1 | Lưới dữ liệu có ô tìm nhanh, kể cả lưới con | Mọi lưới trên 10 dòng đều có |
| UX-C2 | Control đúng loại dữ liệu | Ngày có lịch chọn; tháng có chọn tháng; số tiền tự định dạng nghìn; danh sách dài có gõ để lọc |
| UX-C3 | Trường bắt buộc và lỗi nhập | Đánh dấu trước khi lưu; lỗi hiện tại ô, nêu cách sửa; không mất dữ liệu đã nhập khi lỗi |
| UX-C4 | Nhập bằng bàn phím | Tab đi đúng thứ tự; Enter lưu ở lưới nhập; dán nhiều dòng từ Excel ở các lưới nhập khối lượng lớn |
| UX-C5 | Trạng thái và bước tiếp theo | Mỗi chứng từ hiện trạng thái và đúng một nút chính cho bước tiếp theo |
| UX-C6 | Thao tác không hoàn nguyên được | Có hộp xác nhận nêu hậu quả (khóa công, ghi sổ, đảo) |
| UX-C7 | Thao tác chạy lâu | Có tiến độ; không khóa cả màn hình quá 3 giây mà không báo; xong thì tự cập nhật |
| UX-C8 | Giữ ngữ cảnh | Công ty con, kỳ, bộ lọc được giữ khi chuyển tab và khi tải lại trang |
| UX-C9 | Song ngữ | Nhãn, thông báo, lỗi đủ tiếng Việt và tiếng Anh theo ngôn ngữ người dùng, không lẫn hai thứ tiếng |
| UX-C10 | Laptop 14 inch | Màn làm việc chính không phải cuộn ngang; nút chính luôn thấy |
| UX-C11 | Liên kết | Số chứng từ, số bút toán bấm được và mở đúng nơi, không mở tab trắng |
| UX-C12 | Thuật ngữ | Dùng từ của người làm lương Việt Nam (bảng lương, khóa công, ghi sổ), thống nhất giữa các màn |

## 7. Bảng rà độ phủ tình huống thực tế

Dùng trong buổi làm việc với key user: đánh dấu từng tình huống là Có sẵn / Có cách làm thay / Thiếu, cần có trước khi dùng thật / Không áp dụng. Cột "Hiện trạng theo sổ tay" là điểm xuất phát, phải kiểm lại bằng testcase tương ứng.

| # | Tình huống | Testcase | Hiện trạng theo sổ tay |
| --- | --- | --- | --- |
| 1 | Vào làm, nghỉ việc giữa tháng | BL-02, BL-03 | Có |
| 2 | Tăng lương hiệu lực giữa tháng, chia hai mức theo ngày | HS-03 | Lấy một mức cho cả kỳ, cần quyết định |
| 3 | Thử việc 85% rồi chính thức giữa tháng | HS-09 | Như dòng 2 |
| 4 | Truy lĩnh, truy thu lương hồi tố | BL-28 | Chưa có, làm bằng dòng nhập tay |
| 5 | Truy đóng bảo hiểm | BH-12 | Chưa có |
| 6 | Nghỉ thai sản, ốm đau dài ngày | PH-08, BH-06 | Có |
| 7 | Nghỉ không lương từ ngưỡng ngày không đóng bảo hiểm | BH-06 | Có, theo tham số |
| 8 | Làm thêm ngày thường, nghỉ tuần, lễ, ban đêm | BL-08, BL-09 | Có |
| 9 | Vượt giới hạn giờ làm thêm | BL-10 | Chỉ cảnh báo |
| 10 | Ca kíp xoay vòng, ca đêm qua ngày | CA-01, CA-04 | Có |
| 11 | Ngày lễ, nghỉ bù, hoán đổi ngày làm việc | TL-12, CC-11 | Khai được ngày lễ; đề xuất vắng ngày lễ đang lỗi |
| 12 | Lương khoán tổ, khoán cá nhân | SL-01 - SL-11 | Có |
| 13 | Sản lượng lấy từ lệnh sản xuất NetSuite | SL-16 | Có, chưa chạy thật trên account |
| 14 | Hoa hồng theo hóa đơn, theo thu tiền, theo đội bán | HH-01 - HH-09 | Có |
| 15 | Hoa hồng theo đơn bán hàng | HH-21 | Chưa có (FEAT-001) |
| 16 | Thưởng KPI từ báo cáo, saved search NetSuite | - | Chưa có (FEAT-002); hiện có % đạt chỉ tiêu doanh số |
| 17 | Tạm ứng lương, cấn trừ nhiều kỳ | TU-03 | Có; chưa có trần cấn trừ mỗi kỳ |
| 18 | Thưởng Tết, lương tháng 13 chi riêng, tất toán 335 | BL-27, KT-15 | Trích trước có; chi và tất toán làm tay |
| 19 | Cộng tác viên, khấu trừ 10%, cam kết 08 | TN-06 - TN-08 | Có |
| 20 | Người nước ngoài, không cư trú, giấy phép lao động | TN-09, HS-12, BH-10 | Có; bảo hiểm theo cờ, đổi tình trạng cư trú làm tay |
| 21 | Quyết toán thuế năm, chứng từ khấu trừ, XML HTKK | TN-14 | Chưa có; có bảng kê |
| 22 | Nhiều pháp nhân, phân quyền lương theo pháp nhân | PQ-03 | Chưa phân quyền dữ liệu theo công ty |
| 23 | Nhân viên làm cho hai pháp nhân, bút toán liên công ty | BL-29, KT-16 | Chưa có |
| 24 | Trả lương hai lần một tháng | BL-30 | Có (kỳ nửa tháng); chưa hỗ trợ tạm khấu trừ từng kỳ |
| 25 | Trả tiền mặt, mẫu file riêng từng ngân hàng | CT-02, CT-05 | Một mẫu CSV chung |
| 26 | Quản lý trực tiếp duyệt đơn | ES-08 | HR duyệt |
| 27 | Duyệt, nhập hàng loạt (đơn làm thêm, thưởng, phiếu khoán) | CC-27, BL-32, SL-15 | Cần kiểm; nhiều thao tác đang từng phiếu |
| 28 | Thay đổi luật giữa năm (lương tối thiểu, mức tham chiếu, biểu thuế) | TL-03, TN-05 | Có, bằng tham số có ngày hiệu lực |
| 29 | Lao động thời vụ, lương ngày, lương giờ | BL-05, BL-06 | Có |
| 30 | Tuyển lại người cũ, điều chuyển phòng ban giữa kỳ | HS-10, HS-11 | Cần kiểm |

## 8. Lỗi và điểm yếu đã biết, phải kiểm lại trong UAT

| # | Nội dung | Nguồn | Testcase |
| --- | --- | --- | --- |
| 1 | Xử lý chấm công đề xuất "vắng" cho ngày lễ | Buổi quay kỳ SAOMAI-202702 | CC-11 |
| 2 | Link số bút toán trên bảng lương mở ra tab trắng | Buổi quay kỳ SAOMAI-202702 | KT-02, UX-C11 |
| 3 | Lập bill cơ quan thu lỗi trường subsidiary khi nhà cung cấp chưa gán công ty con | BUG-002 | KT-09 |
| 4 | Vai trò không phải Administrator gửi tác vụ nền: đã sửa cho HR, Kế toán, Demo; mới thử bằng Demo | BUG-001 | CC-06, PQ-02 |
| 5 | Ô Công ty con trở về công ty khác sau khi tải lại trang; tab Chấm công mở kỳ cũ | Buổi quay | BC-07, CC-30, UX-C8 |
| 6 | "Mở chứng từ" mở tab trình duyệt mới | Buổi quay | CC-29 |
| 7 | Duyệt đề xuất chấm công, chia và duyệt phiếu khoán phải làm từng phiếu | Buổi quay, BUG-003 | CC-27, SL-15 |
| 8 | Sửa lịch ca sau khi tính lương, bảng lương không tự báo cần tính lại | Kịch bản quay mục 5 | CA-07 |
| 9 | Duyệt một cấp không tách người lập và người duyệt; hoa hồng cùng vai trò tính và duyệt | Sổ tay mục 6, 8.2 | BL-19, HH-19 |

## 9. Mẫu nhật ký UAT

| Mã TC | Ngày chạy | Người chạy, vai trò | Kết quả | Số thực tế (với TT) | Số tính tay | Chênh lệch | Bằng chứng (ảnh, số chứng từ) | Mức lỗi | Ghi chú, mã lỗi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BL-02 | | | | | 10.000.000 | | | | |

Biên bản nghiệm thu gồm: tổng số testcase theo ưu tiên và kết quả; danh sách lỗi mở theo mức; bảng độ phủ mục 7 đã đánh dấu và ký; kết quả chạy song song E2E-05; quyết định của kế toán trưởng với các điểm kiểm soát ở dòng 9 mục 8.
