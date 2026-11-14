# Kết quả UAT vòng 1 - S4 Advanced Payroll

Chạy đêm 14/11/2026 trên td2937310, pháp nhân Sao Mai Demo (14), vai trò "S4 Advanced Payroll - Demo". Người chạy: Claude (vai QC), không có key user ngồi cùng nên các testcase UX cần người thật chưa chấm được. Bộ testcase: `docs/UAT_TESTCASES.md`.

Cách chạy: phần lớn testcase tính toán và kiểm soát chạy qua chính API của gói (RESTlet `customscript_s4vp_rl_api`) từ phiên trình duyệt, số mong đợi tính độc lập bằng mã riêng của người kiểm, tham số pháp lý đọc từ Thiết lập (dòng hiệu lực tại ngày cuối kỳ).

## 1. Lỗi và điểm cần xử lý (ghi nhận, chưa sửa)

| Mã | Mức | Testcase | Mô tả | Bằng chứng |
| --- | --- | --- | --- | --- |
| UAT-001 | S1 | HS-08 | API `profiles` trả đủ MST, CCCD, số sổ BHXH, số tài khoản ngân hàng dạng rõ về trình duyệt cho vai trò lương. Sổ tay ghi số định danh "không rời máy chủ ở màn Nhân sự, chỉ cờ có / không" | GET action=profiles&subsidiary=14: profile.tax_code 10 ký tự, personal_id 12, si_number 10, bank_account 9 |
| UAT-002 | S2 | KT-09 | Vai trò Demo lập bill cơ quan thu báo lỗi gốc NetSuite "Permission Violation: You need a higher permission for custom record type Budget Preferences". Thiếu quyền với record của gói khác trên form Vendor Bill; thông báo không phải ngôn ngữ nghiệp vụ. Chưa thử vai trò Kế toán | POST agencyBills id=17 |
| UAT-003 | S4 | BL-34 | Thao tác trên bảng đã ghi sổ báo "Bảng lương đang ở trạng thái R, cần mở lại trước", nhưng bảng đã ghi sổ không mở lại được (phải Đảo). Thông báo dẫn sai hướng và lộ mã trạng thái R | POST calculate, loadEmployees, saveInput, updateLine id=17 |
| UAT-004 | S4 | BL-31 | Dòng thu nhập hiện đơn giá đã làm tròn nên số lượng x đơn giá không ra đúng số tiền (E1055: 18,75 x 452.632 = 8.486.850, số tiền 8.486.842). Số tiền đúng; phần diễn giải gây thắc mắc | batch 17, dòng BASE của E1055 |
| UAT-005 | S3 | CC-14, PH | Từ chối đơn nghỉ không cần ghi lý do (sổ tay: từ chối ghi lý do). Phiếu khoán và duyệt nhiều cấp thì có bắt buộc | docAction reject đơn NP000123 không có reason: thành công |
| UAT-006 | S3 | SL, PQ-03 | API `saveOutput` nhận phiếu sản lượng không có công ty con (subsidiary rỗng); phiếu đó không hiện trên màn hình của công ty nào. GET `outputs` không truyền công ty con trả phiếu của mọi công ty | Phiếu SL000116 lúc tạo; đã gán lại công ty 14 |
| UAT-007 | S3 | BL-21 | Duyệt một cấp: từ chối bảng lương không cần ghi chú; người lập cũng duyệt được (BL-19, đã biết). Duyệt nhiều cấp thì bắt buộc ghi chú và chặn người không phải người duyệt | POST reject id=18 |
| UAT-008 | S3 | TU | Phiếu tạm ứng đang Tạm giữ thiếu tài khoản tiền không có thao tác sửa (API chỉ có tạo, bỏ tạm giữ, ghi sổ). Phải lập phiếu mới, phiếu cũ nằm lại | TU000036 |
| UAT-009 | S3 | BC-07, UX-C8 | Ô Công ty con không được nhớ: mỗi lần tải lại trang hoặc mở thẳng một bảng lương, ô trở về công ty đầu danh sách (S4VN TT99), kể cả khi đang xem bảng lương của Sao Mai | Mở `#/payrollRun?id=17`: tiêu đề là bảng lương Sao Mai, ô Công ty con hiện TT99; không có khóa lưu công ty con trong localStorage |
| UAT-010 | S2 | CC-30, UX-C8 | Màn Chấm công mở mặc định kỳ 202610 của nhóm lương mặc định; đổi sang Sao Mai vẫn giữ kỳ đó nên báo "Không có nhân viên thuộc nhóm lương của kỳ". Ô chọn kỳ hiện nhãn "10" thay vì tên kỳ. Người dùng phải tự tìm đúng kỳ | `#/attendance`, đổi công ty con sang Sao Mai |
| UAT-011 | S3 | TN-11 | Tờ khai 05/KK-TNCN mặc định gộp cả bảng lương đã tính nhưng chưa ghi sổ (quý 1/2027: chỉ tiêu [29] 150.206.500 khi gồm bảng nháp kỳ 03, so với 100.032.950 nếu chỉ lấy bảng đã ghi sổ). Đúng mô tả trong sổ tay, nhưng dễ kê khai nhầm; nên mặc định "chỉ đã ghi sổ" | GET report type=pitq có và không có releasedOnly |
| UAT-012 | S3 | CC-11 | (Đã biết) Đề xuất "vắng" cho ngày lễ. Bổ sung: ngày lễ trên account demo bị dời một tháng (01/01 thành 01/02, Tết rơi vào tháng 3), nên cần kiểm lại trên account không dời ngày trước khi kết luận nguyên nhân | Công chuẩn các kỳ 2027: tháng 1 đủ 21 ngày, tháng 2 thiếu 1, tháng 3 thiếu 5 |

**Đính chính so với ghi nhận hôm quay:** link số bút toán trên bảng lương (KT-02) gọi `/app/accounting/transactions/journal.nl?id=...`; trang này tải được với vai trò Demo và có đúng JE2141. "Tab trắng" hôm quay nhiều khả năng do công cụ điều khiển trình duyệt mở tab mới chưa kịp tải, không phải lỗi của gói. Cần một người bấm thật để xác nhận.

## 2. Kết quả theo testcase

Ký hiệu: Đ đạt; K không đạt; C bị chặn (thiếu dữ liệu, vai trò hoặc cần người thật); G ghi nhận hành vi, chờ key user quyết định.

| Testcase | Kết quả | Ghi chú |
| --- | --- | --- |
| Hồi quy mục 4.3 (E1069) | Đ | Khớp từng khoản |
| BH-01, BH-04, BH-05, BH-08 (trên 114 dòng BL000017) | Đ | Từng khoản = Round(căn cứ x tỷ lệ), riêng NLĐ và DN; tổng dòng khớp; CTV không có khoản trích |
| BH-02 | Đ một phần | Căn cứ BHXH, BHYT = min(lương đóng, 2.530.000 x 20 = 50.600.000) đúng trên mọi dòng; căn cứ BHTN chưa đối chiếu theo vùng |
| TN-01, TN-02, TN-04 (114 dòng) | Đ | Giảm trừ 15.500.000 + 6.200.000 x NPT; thuế biểu 5 bậc hiệu lực 2026 khớp tính độc lập từng người; thu nhập tính thuế không âm |
| TN-06, TN-07 | Đ | Dòng cách tính F khớp |
| BL-01, BL-04 (chia ngày công) | Đ | E1055 (18,75 / 19 công) và E1095 (17 / 19 công) khớp Round(lương HĐ x công / công chuẩn) |
| KT-07 | Đ | Trích tháng 13 = Round(lương HĐ / 12); lương giờ = 0 |
| KT-01 | Đ | Bút toán xem trước: Nợ = Có = 2.266.852.033; Có 3341 = thực lĩnh NV; Có 3348 = thực lĩnh CTV; Có 3335 = thuế; Có 338x = 512.084.000 = BH NLĐ + DN; Có 3351 = trích tháng 13 |
| KT-03 | Đ | Tổng phân bổ từng người = thu nhập + BH DN (114 / 114) |
| KT-12 | Đ | Chi phí theo tài khoản: bảng lương 2.266.852.033 = sổ cái, chênh lệch 0 |
| BH-13 | Đ | Báo cáo BH tháng: 474.224.000 + đoàn phí 8.218.000 + KPCĐ 29.642.000 = 512.084.000 = phát sinh 338x |
| BC-01 | Đ | Chi phí lao động tháng trên Phân tích = Nợ chi phí trên bút toán |
| CT-01 | Đ | File chi lương: 114 dòng, tổng 1.592.133.576 = thực lĩnh NV + CTV; UTF-8 có BOM. Ghi nhận: tiêu đề cột không dấu; file gồm cả CTV |
| BL-24 | Đ | Gọi Ghi sổ lần hai trên bảng đã ghi sổ: trả lại đúng bút toán cũ (JE2141), không tạo bút toán mới |
| BL-25 (qua API) | Đ | Tính, nạp nhân viên, thêm dòng nhập tay, sửa công trên bảng đã ghi sổ đều bị chặn |
| CC-17 | Đ | Mở khóa công kỳ đã có bảng lương ghi sổ bị chặn, thông báo rõ |
| PQ-08 | Đ | Đóng kỳ khi mọi bảng đã ghi sổ: được; kỳ đóng thì không lập bảng công. Đã mở lại kỳ SAOMAI-202702 sau khi thử |
| PQ-01 (một phần) | Đ | Vai trò Demo không gọi được thao tác chỉ dành cho Administrator (generateTestData, clearJob) |
| HS-08 | K | Xem UAT-001 |
| KT-09 | K | Xem UAT-002 (và BUG-002 đã biết) |
| CC-07 | Đ | Đi trễ 15, 16, 60, 61, 240, 241 phút: trừ 0; 0,25; 0,25; 0,5; 0,5; 1 ngày |
| CC-15 | Đ | Đơn trùng ngày, đơn vượt số dư phép bị chặn khi gửi duyệt, thông báo nêu số dư còn lại |
| CC-19, CC-20 | Đ | Nửa ngày = 0,5; đơn thứ Năm đến thứ Ba = 4 ngày (bỏ thứ Bảy, Chủ nhật) |
| CC-21 | Đ một phần | Đơn 30/03 - 02/04: kỳ 03 nhận đúng 2 ngày; kỳ 04 chưa lập bảng công nên chưa kiểm |
| PH-05 | Đ | Gửi: chờ duyệt +4, khả dụng 14 -> 10; duyệt: đã dùng 4; từ chối, hủy: trả lại đủ 14 |
| PH-09 | Đ | Việc riêng 4 ngày một đơn bị chặn (tối đa 3) |
| CC-12, CC-13 (đơn làm thêm lập tay) | Đ | Ngày thường loại N, thứ Bảy loại W; 30 giờ một ngày bị chặn (0 - 12 giờ, giới hạn 4 giờ ngày thường) |
| CC-08, CC-18 | Đ | E1020 kỳ 03: công chuẩn 18, nghỉ không lương 2, trễ 1,25 -> công 14,75; lập lại bảng công không nhân đôi |
| SL-02 (biến thể) | Đ | Chia đều 1.240.000 cho 15 người: 10 người 82.667, 5 người 82.666, tổng đúng |
| SL-03 | Đ một phần | Chia theo ngày công x hệ số: tổng khớp 1.800.000; chưa soát tay từng người |
| SL-05 | Đ | Phiếu Tạm giữ không vào lương; phiếu Đã duyệt vào đúng số chia |
| SL-06 (một phần), SL-08, SL-11, SL-12 | Đ | Phiếu đã duyệt không sửa được; đơn giá sửa tay bị bỏ khi bảng không cho sửa; tổng sửa tay lệch bị chặn gửi duyệt; từ chối thiếu lý do bị chặn |
| TU-01 | Đ | Số tiền 0 hoặc âm bị chặn; thiếu tài khoản tiền không bỏ tạm giữ được; ghi sổ tạo bút toán, số dư = số tiền; ghi sổ lần hai bị chặn |
| TU-03 | Đ | E1020: thực lĩnh trước tạm ứng 30.618.111; cấn TU000035 hết 5.000.000, TU000037 cấn 25.618.111; thực lĩnh 0; còn 14.381.889 chuyển kỳ sau, có cảnh báo |
| BL-08 | Đ | Lương giờ 38.000.000 / (18 x 8) = 263.888,89; 2 giờ x 1,5 = 791.667 (miễn thuế 263.889); 4 giờ x 2 = 2.111.111 (miễn thuế 1.055.555) |
| BH-05 | Đ | Đoàn phí chạm trần 0,1 x mức tham chiếu = 253.000; không trừ khi tính thuế |
| BL-12, BL-15 | Đ | Thưởng 5.000.000 và khấu trừ 500.000 cho E1021: thuế 240.225, thực lĩnh 19.564.275 khớp tính tay; thêm dòng làm bảng về chưa tính; duyệt, gửi duyệt, ghi sổ đều bị chặn đến khi tính lại |
| BL-17, BL-16 | Đ | Thực lĩnh âm: cảnh báo mức lỗi, chặn duyệt |
| BL-18 | Đ | Cần soát kỳ 03: 1 lỗi, 43 lệch kỳ trước, 1 thực lĩnh 0, 18 lương giờ chưa có giờ, 1 thông tin công chưa khóa |
| TN-10 | Đ | Giảm trừ khác âm bị chặn; ngày công ngoài 0 - 2 lần công chuẩn bị chặn |
| BL-13 | Đ | Bảng lương thứ hai cùng kỳ: 114 người bị bỏ qua và liệt kê |
| BL-14 | G | Sao Mai đang tắt "Bắt buộc khóa công trước khi tính lương" nên tính được khi chưa khóa; có cảnh báo thông tin |
| BL-19 | G | Duyệt một cấp: người lập tự duyệt được (đã biết) |
| BL-20, BL-21, TL-08 (một phần) | Đ | Bật cấp duyệt: duyệt thẳng bị chặn "chưa gửi duyệt"; người không phải người duyệt bị chặn; từ chối thiếu ghi chú bị chặn. Chưa thử trường hợp người gửi là người duyệt và ngưỡng thực lĩnh (cần người dùng thứ hai) |
| CT-01 (bảng Đã duyệt) | Đ | File chi lương lập được ở trạng thái Đã duyệt; người thực lĩnh 0 không có trong file |
| KT-08, KT-09 (điều kiện) | Đ | Lập bill, đảo trên bảng chưa ghi sổ bị chặn |
| HH-01 | Đ | BANLE-CH: 250.000.000 x (1,5% + 1%) = 6.250.000, có diễn giải từng bước |
| HH-04, HH-05 | Đ | KD-DUAN ngưỡng 80%: đạt 79,9% trả 0; đạt 80% trả 4%; 100% trả 5%; 120% trả 6%. Quy ước: cận dưới của bậc được tính vào bậc |
| HH-18 | Đ | Mô phỏng không ghi dữ liệu |
| CC-05 | Đ | File 7 dòng thử: 2 dòng sai định dạng báo Lỗi, 1 mã chưa đối chiếu, 3 dòng thuộc kỳ đã khóa, 1 dòng mới. Ghi nhận: ngày dạng dd/mm/yyyy vẫn được nhận dù hồ sơ nguồn khai năm-tháng-ngày |
| CC-02 | Đ một phần | Nạp lại dòng của kỳ 02 báo "Kỳ đã khóa" (kỳ đã khóa công nên không tới bước báo Trùng) |
| CC-06, PQ-02 (vai trò Demo) | Đ | Xử lý chấm công, tính lương nền chạy bằng vai trò Demo trong buổi quay. Vai trò HR, Kế toán: chưa thử |
| PH-01 | Đ | 110 / 110 nhân viên: ngày phép = 12 + 1 ngày mỗi 5 năm thâm niên tính đến 31/12 |
| PH-03 | Đ | Chạy cấp phép lần hai: mọi người "Đã cấp trong năm", tổng số dư không đổi |
| CA-07 | Đ | Sửa ô ca trong kỳ đã khóa công bị chặn; ca không tồn tại và nhân viên khác công ty con bị chặn |
| TL-05 | G | Công chuẩn từng kỳ = ngày thường trừ ngày lễ; không kết luận được vì ngày lễ trên account demo bị dời một tháng |
| TN-11 | Đ | Quý 1/2027 (chỉ bảng đã ghi sổ): [21] = tổng thu nhập chịu thuế hai bảng 3.568.619.640; [29] = tổng thuế 100.032.950. Chỉ tiêu [26] chưa đối chiếu định nghĩa. Xem UAT-011 |
| BC-02 | Đ | Cầu biến động: 2.224.086.520 + các thành phần = 2.266.852.033 |
| BH-14 | Đ một phần | D02-LT tháng 02 có một dòng (E1022, mã ON); chưa dựng đủ tình huống tăng, giảm, điều chỉnh |
| KT-02 | Đ một phần | Bút toán JE2141 tồn tại, đã vào sổ, trang mở được. Chưa so từng dòng bút toán thật với bản xem trước |
| BC-07, CC-30 | K | Xem UAT-009, UAT-010 |

## 3. Chưa chạy được và lý do

| Nhóm | Testcase | Lý do |
| --- | --- | --- |
| Ghi sổ rồi đảo | E2E-04, KT-08, TU-04, TU-05, SL-06 (phần đảo), HH-13 | Lệnh ghi sổ bảng lương thử bị cơ chế an toàn của phiên làm việc tự động từ chối (thao tác ghi sổ cái). Cần anh cho phép rõ, hoặc anh tự bấm Ghi sổ và Đảo trên một bảng thử (đề xuất BL000006 của pháp nhân TT99, 4 người) |
| Vai trò khác | PQ-01 đủ ma trận, PQ-02 với HR và Kế toán, TU-02, BL-22, HS-07, CT-04, PQ-06 | Phiên chỉ có vai trò Demo. Em không tự gán vai trò cho người dùng |
| Cổng nhân viên | ES-01 đến ES-07 | Cần phiên đăng nhập bằng nhân viên (E1069). Đã xem bằng mắt hôm quay cảnh 13 nhưng chưa thử đổi tham số để xem dữ liệu người khác |
| Dữ liệu U01 - U15 | BL-02, BL-03, BL-05, BL-06, BL-07, BL-09, BL-11, BL-30, BH-03, BH-06, BH-07, TN-03, TN-05, TN-08, TN-09, PH-02, PH-04, PH-06, HS-01 đến HS-13 | Cần tạo bộ nhân viên UAT trong một pháp nhân riêng. Tạo nhân viên trong pháp nhân demo sẽ làm lệch số liệu trình diễn nên em chưa làm |
| Cần người thật | E2E-05, E2E-07, toàn bộ UX-M1 đến UX-M7, phần lớn testcase loại UX | Đo thời gian, số lần hỏi, mức hài lòng phải do key user làm |
| Thiết lập, sản xuất | TL-01 đến TL-04, TL-06 đến TL-12, SL-16, HH-06 đến HH-17 | Thay đổi thiết lập chung ảnh hưởng mọi pháp nhân; account chưa có phân hệ sản xuất; hoa hồng nâng cao cần dựng kế hoạch và chứng từ riêng |

## 4. Dữ liệu thử còn lại trên account

- Kỳ SAOMAI-202703: bảng lương BL000018 "UAT 03/2027" (Tạm giữ, 114 người, đã xóa dòng nhập tay) và BL000019 (rỗng). Gói không có thao tác xóa bảng lương; khi trình diễn kỳ 03 có thể dùng tiếp BL000018.
- Đơn từ của E1020 trong tháng 03/2027: đã hủy hết các đơn đã duyệt; còn 3 đơn Tạm giữ không gửi được (2 đơn nghỉ, 1 đơn làm thêm 30 giờ) và 1 đơn bị từ chối. Bảng công kỳ 03 của E1020 đã về đủ 18 công, phép năm về 14 ngày.
- Phiếu khoán SL000116, SL000117: đã hủy (inactive).
- **Tạm ứng của E1020: TU000035 (5.000.000) và TU000037 (40.000.000) đã ghi sổ, bút toán JE2142 và một bút toán kế tiếp, Nợ 141 / Có tài khoản tiền, ngày 03 và 10/03/2027. Gói không có thao tác hủy phiếu đã ghi sổ.** Nếu không xử lý, bảng lương kỳ 03 của E1020 sẽ bị cấn trừ hết. Quyết định 14/11/2026: giữ làm dữ liệu trình diễn tạm ứng và cấn trừ (thực lĩnh kỳ 03 của E1020 sẽ về 0, còn 14.381.889 chuyển kỳ sau). TU000036 (Tạm giữ, thiếu tài khoản tiền) nằm lại.
- Cấp duyệt "UAT cap 1" của Sao Mai: đã ngừng dùng.
- Kỳ SAOMAI-202702: đã đóng thử rồi mở lại; bảng lương BL000017 và công đã khóa không đổi.

## 5. Tóm tắt

- Đã chạy khoảng 75 trên 244 testcase, chủ yếu loại tính toán và kiểm soát: 2 không đạt mới (HS-08, KT-09 với vai trò Demo), 2 không đạt đã biết (BC-07, CC-30), còn lại đạt hoặc đạt một phần.
- Tính toán: không thấy sai số nào. 114 dòng lương kỳ 02 khớp tính độc lập về bảo hiểm, thuế, thực lĩnh, phân bổ, trích tháng 13; bút toán, báo cáo bảo hiểm, chi phí theo tài khoản, tờ khai quý, phân tích chi phí khớp nhau đến đồng. Một dòng phức tạp của kỳ 03 (nghỉ không lương, đi trễ, làm thêm hai loại ngày, đoàn phí chạm trần, cấn hai phiếu tạm ứng) khớp tính tay.
- Kiểm soát: các chốt chặn theo trạng thái, khóa công, dấu dữ liệu, duyệt nhiều cấp hoạt động đúng. Điểm yếu là lộ số định danh qua API hồ sơ (UAT-001) và vài chỗ từ chối không cần lý do.
- Dễ dùng: hai lỗi giữ ngữ cảnh (UAT-009, UAT-010) là thứ người dùng gặp mỗi ngày; nên sửa trước khi cho key user chạy phần UX.

## 6. Thử bổ sung bằng vai trò thật (14/11/2026, sau khi có lớp quyền api/Access)

Người dùng gán ba vai trò của gói cho tài khoản thử; chạy qua API và màn hình.

| Testcase | Kết quả | Ghi chú |
| --- | --- | --- |
| PQ-02 | K rồi Đ | Lần đầu ba vai trò đều lỗi đọc bảng nhân viên (UAT-013). Sau khi thêm quyền Employee Record: HR và Kế toán mở được bảng lương, file ngân hàng, báo cáo, chấm công, xếp ca, nhân sự |
| PQ-01 (HR vận hành) | Đ | Mọi API về lương (bảng lương, bút toán, file ngân hàng, tạm ứng, sản lượng, báo cáo, hoa hồng, phân tích, trang chủ lương) bị từ chối; chấm công, xếp ca, đơn từ, phép dùng được; danh sách hồ sơ không trả lịch sử lương |
| PQ-01 (HR) | Đ | Ghi sổ, đảo, ghi sổ tạm ứng, lập bill bị từ chối |
| PQ-01 (Kế toán) | Đ | Lưu đơn từ, lưu hồ sơ, khóa công, xem số định danh đầy đủ bị từ chối; phân tích chi phí dùng được |
| HS-08 | Đ | API hồ sơ trả số định danh dạng che (ví dụ ******3794) với cả ba vai trò; HR xem số đầy đủ qua revealIds |
| Menu | Đ | Tab S4 Advanced Payroll hiện với cả ba vai trò; HR vận hành chỉ có nhóm Time; mở thẳng địa chỉ bảng lương bằng HR vận hành thì giao diện chuyển về Chấm công |
| PQ-03 | C | Chưa có vai trò nhân bản giới hạn công ty con để thử |
