## 21. Dữ liệu máy chấm công

**Mục đích.** Đưa lượt chấm từ máy chấm công (vân tay, khuôn mặt, thẻ) hoặc hệ thống chấm công khác vào NetSuite, đối chiếu với ca đã phân để đề xuất phiếu đi trễ, về sớm, vắng, thiếu lượt chấm và đơn làm thêm. HR duyệt các đề xuất đó trước khi khóa công.

**Vai trò.** HR (nạp, xử lý, duyệt), bộ phận IT hoặc nhà cung cấp máy (xuất file, kết nối tự động), Hệ thống (chống trùng, đối chiếu ca).

**Dữ liệu cần có trước.**
- **Ca làm việc** (record `shift`): mã ca, giờ vào, giờ ra (HH:mm; giờ ra nhỏ hơn giờ vào là ca qua đêm), nghỉ giữa ca (phút), loại ca D ngày / E chiều / N đêm, cho phép trễ (phút), cho phép về sớm (phút), OT tối thiểu (phút, trống = 30).
- **Mẫu xoay ca** (record `shift_pattern`): chuỗi mã ca theo chu kỳ, ô trống là ngày nghỉ (ví dụ mẫu 3 ca 4 kíp của gói ngành Sản xuất).
- **Phân ca** (record `roster`): mỗi nhân viên mỗi ngày một ô ca. Sinh từ mẫu xoay ca theo tổ, sửa tay từng ô; sinh lại không ghi đè ô đã sửa tay. Ngày không có ca là ngày nghỉ.

### 21.1 Hồ sơ nguồn chấm công: mỗi máy hoặc hệ thống một hồ sơ

Mỗi hãng máy xuất file một kiểu, nên gói không ép một định dạng. Tư vấn hoặc HR khai **Hồ sơ nguồn chấm công** (record `punch_source`, mở từ hộp thoại nạp) một lần cho mỗi máy hoặc hệ thống:

| Thiết lập | Lựa chọn |
| --- | --- |
| Kiểu dòng | **E** mỗi dòng một lượt chấm; **P** mỗi dòng có ngày, giờ vào và giờ ra; **Z** file attlog của máy ZKTeco (tab, không tiêu đề: mã, thời điểm, các cột trạng thái bỏ qua) |
| Dòng tiêu đề, số dòng bỏ qua ở đầu file | Có / không; số dòng |
| Dấu phân cách | Tự nhận (tab, chấm phẩy, phẩy), hoặc chọn cố định |
| Ánh xạ cột | Cột mã người, thời điểm (hoặc ngày + giờ riêng), giờ vào, giờ ra, thiết bị: ghi tên cột trên dòng tiêu đề (không phân biệt hoa thường, có dấu hay không dấu) hoặc số thứ tự cột (1, 2, 3...) |
| Định dạng ngày | dd/mm/yyyy (mặc định), yyyy-mm-dd, mm/dd/yyyy; luôn nhận thêm số ngày kiểu Excel và giờ có AM/PM |
| Cách nhận người | **B** bảng đối chiếu trước, không có thì mã nhân viên NetSuite (mặc định); **M** chỉ theo bảng đối chiếu; **N** mã nhân viên NetSuite hoặc id nội bộ |
| Thiết bị mặc định | Ghi vào lượt chấm khi file không có cột thiết bị |
| Lệch đồng hồ (phút) | Cộng thêm số phút khi đồng hồ máy chạy sai (âm được) |

Kiểu P: giờ ra nhỏ hơn giờ vào thì giờ ra thuộc ngày hôm sau (ca đêm); ô giờ trống thì bỏ lượt đó, không báo lỗi.

### 21.2 Bảng đối chiếu mã chấm công

Máy chấm công thường đánh số người theo máy (1, 2, 3...), khác mã nhân viên NetSuite. **Bảng đối chiếu** (record `punch_map`) ghi: hồ sơ nguồn, máy (trống = mọi máy của nguồn), mã trên máy, nhân viên, hiệu lực từ - đến. Gói tra dòng cùng máy trước rồi dòng không ghi máy, theo hiệu lực tại ngày chấm. Mã số bỏ qua số 0 ở đầu ("0012" khớp "12"). Thôi dùng một dòng thì đánh dấu ngừng dùng, không xóa. Người vào làm thay số máy của người đã nghỉ: kết thúc hiệu lực dòng cũ, thêm dòng mới.

### 21.3 Nạp trên màn hình: nút Nạp chấm công

1. Tab Chấm công, nút **Nạp chấm công** ở hàng tiêu đề (HR, Administrator).
2. Chọn hồ sơ nguồn; chọn file (.csv, .txt, .dat, tối đa 5 MB mỗi lần) hoặc dán vùng dữ liệu từ Excel.
3. **Xem trước:** đếm tổng dòng, mới, trùng, lỗi, chưa đối chiếu, thuộc kỳ công đã khóa; lưới có ô tìm nhanh và lọc theo trạng thái (hiện tối đa 1.000 dòng chi tiết, ưu tiên dòng lỗi và chưa đối chiếu; số đếm luôn đủ cả file).
4. **Mã chưa đối chiếu:** mỗi mã trên máy một dòng, chọn nhân viên tương ứng, bấm Lưu đối chiếu; gói tự xem trước lại.
5. **Ghi:** gói ghi lượt chấm mới theo từng lượt gọi kèm thanh tiến độ, không giới hạn 500 dòng; dòng lỗi không chặn dòng khác.
6. Xong, bấm **Xử lý chấm công máy** cho kỳ (gợi ý ngay trong hộp thoại).

Tab **Đối chiếu mã chấm công** trong cùng hộp thoại cho xem, sửa nhân viên và ngày hiệu lực, thêm hoặc ngừng dùng từng dòng.

### 21.4 Cách nạp khác

| Cách nạp | Dùng khi | Ghi chú |
| --- | --- | --- |
| API của gói (`punchPreview`, `punchCommit` theo hồ sơ nguồn) | Chương trình trung gian đọc máy tại văn phòng rồi đẩy lên | Cùng kiểm tra và đối chiếu như màn hình |
| API cũ `importPunches` | Tích hợp đã có | Mỗi dòng `mã nhân viên, thời điểm, thiết bị`; tối đa 500 dòng mỗi lần; chỉ nhận mã nhân viên NetSuite |
| CSV Import / REST record API trên record "Lượt chấm công" | Hệ thống chấm công đám mây đẩy định kỳ | Phải gửi đúng nhân viên NetSuite; không qua bước chống trùng và đối chiếu của gói |

**Gói kiểm tra khi nạp.**
1. Thời điểm sai định dạng, ngày không tồn tại, giờ quá 23:59: lỗi dòng, dòng khác vẫn nạp.
2. Không tìm thấy nhân viên (qua bảng đối chiếu hoặc mã nhân viên): dòng "chưa đối chiếu".
3. Ngày thuộc kỳ công đã khóa: dòng "kỳ đã khóa", không ghi.
4. Cùng nhân viên, cùng phút đã có trên hệ thống hoặc đã xuất hiện trước đó trong file: dòng "trùng", không ghi. Nạp lại cả file vẫn an toàn.
5. Lỗi ở mức hồ sơ (không tìm thấy cột đã khai, thiếu dòng tiêu đề khi khai tên cột): báo ngay, không nạp dòng nào.

### 21.5 Xử lý chấm công: từ lượt chấm ra chứng từ đề xuất

Bấm **Xử lý chấm công máy** trên tab Chấm công cho kỳ đang chọn. Với mỗi ô phân ca có ca:
1. **Khung tìm lượt vào:** từ 4 giờ trước giờ vào ca đến giữa ca. Lượt vào là lượt sớm nhất trong khung.
2. **Khung tìm lượt ra:** từ giữa ca đến 8 giờ sau giờ ra ca. Lượt ra là lượt muộn nhất liền mạch; các lượt cách nhau không quá 15 phút sau giờ ra được coi là cùng một lần ra.
3. **Phân loại ngày:**
   - Có cả vào và ra, trễ và sớm trong mức cho phép của ca: đúng giờ.
   - Trễ hơn mức cho phép trễ, hoặc về sớm hơn mức cho phép về sớm: đề xuất **phiếu đi trễ (L)** hoặc **phiếu về sớm (E)** kèm số phút.
   - Thiếu lượt vào hoặc ra: đề xuất **phiếu điều chỉnh công (A)** với 0 ngày để HR kiểm tra.
   - Không có lượt chấm nào và không có đơn nghỉ / công tác đã duyệt: đề xuất **phiếu điều chỉnh (A) trừ 1 ngày** (vắng).
   - Không có lượt chấm nhưng có đơn nghỉ hoặc công tác đã duyệt: coi là có lý do, không sinh gì.
4. **Làm thêm:** ra sau giờ ra ca từ mức "OT tối thiểu" trở lên (mặc định 30 phút): đề xuất **đơn làm thêm** bằng số giờ sau ca (tối đa 12 giờ / ngày). Nếu hơn nửa thời gian làm thêm rơi vào 22:00 - 06:00 thì đánh dấu làm đêm.
5. **Đi làm ngày không có ca:** có từ 2 lượt chấm trong ngày mà ngày đó không có ca: đề xuất đơn làm thêm bằng khoảng từ lượt đầu đến lượt cuối.
6. Giờ làm trong ca = từ max(giờ vào, giờ vào ca) đến min(giờ ra, giờ ra ca), trừ nghỉ giữa ca.

**Mọi chứng từ đề xuất ở trạng thái Tạm giữ (H)**, có cờ "Sinh từ chấm công". Hệ thống không tự trừ lương (Điều 127 Bộ luật Lao động cấm phạt tiền); số phút trễ chỉ thành ngày công bị trừ khi HR duyệt phiếu, theo quy tắc trừ công trễ sớm của công ty. Chạy lại xử lý chấm công: xóa các đề xuất cũ còn ở Tạm giữ của kỳ rồi sinh lại; đề xuất đã gửi duyệt hoặc đã duyệt được giữ, không sinh trùng.

### 21.6 Hỏi đáp thường gặp

**Máy chấm công dùng số thứ tự riêng (1, 2, 3...), không phải mã nhân viên NetSuite thì sao?** Khai bảng đối chiếu mã chấm công cho hồ sơ nguồn. Cách nhanh nhất: nạp thử file, khung "Mã chưa đối chiếu" liệt kê mọi mã chưa biết, chọn nhân viên cho từng mã rồi lưu một lần.

**File xuất từ máy có cột Giờ vào và Giờ ra trên cùng một dòng?** Khai hồ sơ nguồn kiểu P (ngày, giờ vào, giờ ra). Gói tự tách thành hai lượt chấm; ca đêm có giờ ra nhỏ hơn giờ vào được hiểu là ra vào ngày hôm sau.

**Máy ZKTeco xuất file attlog .dat?** Chọn kiểu Z; không cần khai cột.

**Một tháng 200 người, mỗi người 4 lượt / ngày thì nạp thế nào?** Khoảng 20.000 dòng, khoảng 1 MB: nạp một lần bằng hộp thoại, gói ghi theo lượt và hiện tiến độ. File trên 5 MB thì chia theo tuần.

**Xử lý chấm công kỳ lớn có bị treo không?** Kỳ quá 200 nhân viên hoặc quá 3.000 ô nhân viên x ngày tự chạy nền theo lô; màn hình báo khi xong.

**Đồng hồ máy chạy nhanh 5 phút?** Ghi -5 vào ô lệch đồng hồ của hồ sơ nguồn trước khi nạp; lượt chấm đã nạp sai giờ cần xóa rồi nạp lại.

**Nhân viên quên chấm công thì sao?** Gói đề xuất phiếu điều chỉnh công 0 ngày để HR xem. HR xác minh rồi sửa số ngày điều chỉnh, hoặc từ chối phiếu.

**Nhân viên đến sớm 2 tiếng có được tính làm thêm không?** Không. Làm thêm chỉ tính phần sau giờ ra ca, hoặc cả ngày khi làm vào ngày không có ca. Giờ làm trước ca phải lập đơn làm thêm riêng.

**Ca đêm qua ngày hôm sau xử lý thế nào?** Ca có giờ ra nhỏ hơn giờ vào là ca qua đêm; lượt ra của ngày hôm sau vẫn gắn với ca của ngày bắt đầu.

**Xử lý chấm công xong có tự vào lương không?** Không. Đề xuất phải được duyệt, sau đó HR lập bảng công và khóa công; bảng lương lấy công từ bảng công đã khóa và giờ làm thêm từ đơn làm thêm đã duyệt.

**Nạp nhầm lượt chấm thì sao?** Khi kỳ công chưa khóa, xóa hoặc sửa lượt chấm trên danh sách record "Lượt chấm công" rồi chạy lại xử lý chấm công.

---

## 22. Dữ liệu sản lượng, năng suất

**Mục đích.** Ghi nhận khối lượng, sản phẩm, công đoạn hoặc hạng mục khoán của từng người hoặc từng tổ để trả lương theo năng suất, và hạch toán chi phí khoán về đúng dự án, phòng ban, class, địa điểm.

**Vai trò.** Thống kê / HR (lập phiếu), người duyệt (trên NetSuite là người có vai trò HR), Kế toán (sửa được phiếu, ghi sổ bảng lương), Hệ thống (tra đơn giá, chia tiền tổ, chống sinh trùng).

**Dữ liệu cần có trước.**
- **Bảng đơn giá** (record `rate_table`): mã bảng, loại W hạng mục khoán / O công đoạn / P sản phẩm / S thang hoa hồng doanh số, cờ "Cho sửa đơn giá trên phiếu". Dòng bảng (`rate_line`): mã hạng mục, diễn giải, đơn vị tính, đơn giá, hiệu lực từ - đến, dự án (tùy chọn).
- **Tổ đội** (record `team`): loại tổ (tổ đội, chuyền, cửa hàng), tổ trưởng, cách chia mặc định, dự án, địa điểm, class, phòng ban. Thành viên (`team_member`): nhân viên, hệ số chia, tỷ lệ cố định %, hiệu lực từ - đến. Thành viên có thể là cộng tác viên.
- **Quy tắc thu nhập nguồn O** (Thành tiền sản lượng): gắn với một mã bảng đơn giá hoặc để trống (lấy mọi bảng), và loại thu nhập để in trên phiếu lương (ví dụ KHOAN).

### 22.1 Cách đưa sản lượng vào gói

| Cách | Dùng khi | Ghi chú |
| --- | --- | --- |
| Lập phiếu trên màn hình (tab Khác > Sản lượng - khoán tổ) | Nghiệm thu từng đợt, số phiếu vừa phải | Tra đơn giá tự động, chia tiền tổ, gửi duyệt ngay trên màn hình |
| Lấy từ giao dịch NetSuite (nút **Lấy từ giao dịch**) | Doanh nghiệp ghi sản xuất trên NetSuite | Từ Assembly Build, Work Order Completion hoặc Item Fulfillment; xem mục 22.3 |
| CSV Import Assistant trên record "Phiếu sản lượng" và "Dòng sản lượng" | Số liệu từ hệ thống MES, Excel của xưởng | Nạp phiếu trước, dòng sau (dòng tham chiếu phiếu); script tự tính thành tiền và tổng phiếu; chỉ sửa được phiếu đang Tạm giữ |
| REST record API trên cùng các record | Hệ thống khác đẩy định kỳ | Cùng kiểm tra như CSV Import |

**Một phiếu gồm:** công ty con, ngày phiếu, kỳ lương (trống thì tự lấy kỳ của nhóm DEFAULT chứa ngày phiếu), loại I cá nhân / T tổ, bảng đơn giá, tổ (phiếu tổ), cách chia, dự án, địa điểm, class, phòng ban, diễn giải; các dòng: nhân viên (chỉ phiếu cá nhân), mã hạng mục, diễn giải, đơn vị tính, số lượng, đơn giá.

### 22.2 Quy tắc tính

1. **Đơn giá:** để trống thì gói tra bảng đơn giá theo mã hạng mục, ngày phiếu và dự án. Dòng bảng gắn đúng dự án được ưu tiên hơn dòng không gắn dự án; cùng mức thì lấy dòng có ngày hiệu lực mới nhất. Đơn giá nhập tay chỉ được giữ khi bảng cho sửa đơn giá (hoặc khi bảng không có giá cho hạng mục đó).
2. **Không tìm thấy đơn giá:** đơn giá 0 và cảnh báo "Chưa có đơn giá cho hạng mục ... ngày ...; nhập đơn giá".
3. **Thành tiền dòng** = làm tròn (số lượng x đơn giá) đến đồng.
4. **Phiếu tổ, chia tiền cho thành viên** (bấm Nạp thành viên rồi Chia tiền):
   - Thành viên lấy theo hiệu lực tại ngày phiếu; ngày công lấy từ bảng công; hệ số lấy từ tổ.
   - Cách chia: D theo ngày công, F theo ngày công x hệ số, H theo giờ, P theo tỷ lệ cố định, E chia đều.
   - Mỗi phần làm tròn xuống đến đồng; phần dư chia từng đồng cho người có phần lẻ lớn nhất trước, nên tổng chia luôn đúng bằng thành tiền phiếu.
   - Sửa tay số tiền của một người được (đánh dấu "Sửa tay"); khi đó gửi duyệt không tự chia lại.
5. **Trạng thái:** H Tạm giữ → (Gửi duyệt) P Chờ duyệt → (Duyệt) A Đã duyệt → (ghi sổ bảng lương) C Đã vào bảng lương. Từ chối đưa P về H và bắt buộc lý do. Trả về tạm giữ được khi phiếu chưa vào bảng lương. Hủy chỉ áp cho phiếu Tạm giữ, ghi lý do, không xóa.
6. **Vào bảng lương:** bảng lương lấy phiếu A (và phiếu C của chính bảng đó) thuộc kỳ, cùng công ty con; cộng theo nhân viên và theo mã bảng đơn giá; quy tắc thu nhập nguồn O nhân hệ số của quy tắc ra dòng thu nhập.
7. **Hạch toán:** phần lương khoán đi về đích của phiếu ("nguồn nào đích đó"): dự án, địa điểm, class, phòng ban của phiếu; phiếu không khai phòng ban thì theo phòng ban của nhân viên.

### 22.3 Lấy sản lượng từ giao dịch NetSuite

Cấu hình **Nguồn sản lượng từ giao dịch** (record `out_source`, khai trên form NetSuite):
- Loại giao dịch: Build (Assembly Build), WOCompl (Work Order Completion), ItemShip (Item Fulfillment).
- Trường nhân viên trên giao dịch: script ID trường thân (custbody...) hoặc dòng (custcol...) kiểu danh sách nhân viên.
- Trường tổ (tùy chọn): trường kiểu danh sách "S4VP Tổ đội"; có tổ thì sinh phiếu tổ.
- Bảng đơn giá; dấu số lượng (Item Fulfillment ghi số âm nên mặc định -1); lấy phòng ban theo dòng giao dịch.

Luồng: chọn nguồn và khoảng ngày → **Xem trước** (từng dòng: chứng từ, ngày, nhân viên / tổ, hạng mục, số lượng, đơn giá, thành tiền, đã sinh hay chưa) → **Sinh phiếu**. Mỗi giao dịch x nhân viên (hoặc tổ) x phòng ban thành một phiếu Tạm giữ, mã hạng mục = mã mặt hàng (viết hoa), ngày phiếu = ngày giao dịch, đi qua đúng đường lưu và tra giá như phiếu nhập tay. Mỗi dòng giao dịch có khóa nguồn nên sinh lại không trùng; phiếu bị hủy thì dòng nguồn được sinh lại. Phần này mới kiểm bằng test vì account thử chưa dùng sản xuất; vai trò HR cần thêm quyền xem các loại giao dịch này.

### 22.4 Hỏi đáp thường gặp

**Vì sao lương khoán trên bảng lương bằng 0?** Kiểm theo thứ tự: phiếu đã ở trạng thái A chưa; phiếu có thuộc đúng kỳ lương và công ty con của bảng lương không; có quy tắc thu nhập nguồn O áp cho nhóm lương, loại lao động của người đó không; quy tắc gắn bảng đơn giá nào, có khớp bảng của phiếu không. Lưu ý: trước bản 11/11/2026 quy tắc gắn một bảng đơn giá cụ thể luôn ra 0 do lỗi so mã bảng; bảng lương tính trước ngày đó cần tính lại.

**Duyệt phiếu sau khi bảng lương đã tính thì sao?** Bảng lương phải tính lại mới nhận phiếu mới; khi duyệt hoặc ghi sổ, gói kiểm dấu dữ liệu đầu vào và yêu cầu tính lại nếu phiếu thay đổi.

**Phiếu đã vào bảng lương có sửa được không?** Không. Phải đảo bảng lương (phiếu về A), trả phiếu về Tạm giữ, sửa, duyệt lại và chạy bảng lương mới.

**Thành viên mới vào tổ giữa tháng có được chia không?** Có, nếu hiệu lực thành viên bao phủ ngày phiếu. Phiếu có ngày trước ngày vào tổ thì người đó không có trong danh sách chia.

**Tổ có cả cộng tác viên thì sao?** Được chia bình thường; phần của cộng tác viên đi theo cách tính thuế của họ (thường khấu trừ 10%) và hạch toán vào phải trả cộng tác viên.

**Đơn giá thay đổi giữa tháng?** Thêm dòng bảng đơn giá mới với ngày hiệu lực mới; phiếu tra giá theo ngày phiếu nên phiếu trước và sau ngày đổi lấy đúng giá của từng thời điểm.

---

## 23. Dữ liệu doanh số và hoa hồng

**Mục đích.** Lấy doanh số làm căn cứ tính hoa hồng từ giao dịch bán hàng của NetSuite, từ hệ thống bán hàng khác (DMS, POS, sàn thương mại điện tử), hoặc cả hai, tùy cấu hình từng kế hoạch hoa hồng.

**Vai trò.** Kế toán (cấu hình kế hoạch, nạp doanh số ngoài, tính, duyệt), Hệ thống (đọc giao dịch, kiểm dữ liệu nạp), HR (xem).

### 23.1 Nguồn doanh số: chọn trên từng kế hoạch

| Nguồn | Ý nghĩa |
| --- | --- |
| N - Giao dịch NetSuite (mặc định) | Đọc hóa đơn, bán thu tiền ngay, credit memo, thu tiền trên NetSuite |
| X - Dữ liệu ngoài đã nạp | Chỉ dùng doanh số đã nạp vào vùng đệm "Doanh số ngoài" (record `comm_txn`) |
| B - Cả hai | Cộng cả hai nguồn; mỗi dòng giao dịch ghi rõ nguồn là NetSuite hay tên hệ thống ngoài |

### 23.2 Doanh số từ giao dịch NetSuite

- **Chứng từ đọc:** Invoice (I), Cash Sale (S), Credit Memo (C); chỉ chứng từ đã ghi sổ, không bị void; lọc công ty con theo dòng chứng từ.
- **Dòng bỏ qua:** loại dòng trong danh sách "Loại dòng bỏ qua" của kế hoạch (mặc định TaxItem, ShipItem, Subtotal, Description, EndGroup, Group). Dòng chiết khấu vẫn tính vì làm giảm doanh thu thuần.
- **Cơ sở dòng:**
  - R doanh thu thuần = số tiền dòng chưa thuế.
  - G lãi gộp = doanh thu dòng - giá vốn ước tính của dòng (Est. Cost trên dòng hóa đơn, không phải giá vốn thực tế ghi sổ).
  - Q số lượng bán.
  - Credit memo mang số âm khi kế hoạch bật "Trừ hàng trả lại".
- **Người được ghi nhận:**
  - R: nhân viên kinh doanh trên chứng từ (Sales Rep), nhận 100%.
  - T: đội bán (Team Selling) theo % đóng góp; chứng từ không có đội bán thì lùi về Sales Rep.
  - F: một trường tùy chỉnh trên chứng từ (custbody...) chứa nhân viên.
  - Chỉ người có phân công hiệu lực vào kế hoạch tại ngày ghi nhận mới được tính; doanh số của người chưa phân công hiện thành cảnh báo "Doanh số chưa ai được ghi nhận".
- **Thời điểm ghi nhận:**
  - I: theo ngày chứng từ trong tháng.
  - P: theo tiền đã thu trong tháng; mỗi hóa đơn tính phần = số tiền khách trả (Customer Payment, áp tiền đặt cọc) trong tháng / tổng hóa đơn.
- **Truy thu (clawback):** khi bật N ngày, hóa đơn ghi nhận theo ngày xuất mà quá N ngày chưa thu đủ thì phần chưa thu bị trừ lại vào cơ sở ở tháng đến hạn.
- **Khách mới / khách cũ:** dựa trên ngày mua đầu tiên của khách (hóa đơn hoặc bán thu tiền ngay sớm nhất) so với ngày chứng từ và số ngày khai trên thành phần.

### 23.3 Doanh số ngoài: nạp từ Excel, CSV, hệ thống khác

**Cách nạp.**
1. Tab Hoa hồng > **Nạp doanh số ngoài**: nhập tên hệ thống nguồn (ví dụ DMS), dán vùng dữ liệu từ Excel hoặc chọn file CSV (UTF-8, dấu phẩy hoặc chấm phẩy).
2. Gói tự nhận cột theo tiêu đề tiếng Việt hoặc tiếng Anh; sửa ánh xạ cột được bằng ô chọn. Có file mẫu tải về.
3. **Kiểm tra** (chưa ghi): từng dòng có trạng thái Mới / Cập nhật / Không đổi / Lỗi kèm lý do.
4. **Ghi**: chỉ bật khi không còn dòng lỗi, hoặc khi chọn bỏ qua dòng lỗi. Nhiều dòng thì gói ghi theo lượt.
5. Khối lượng lớn hoặc tích hợp tự động: CSV Import Assistant hoặc REST record API trên record "Doanh số ngoài".

**Các cột của file mẫu.**

| Cột | Bắt buộc | Ý nghĩa, định dạng |
| --- | --- | --- |
| doc_no | Có | Số chứng từ ở hệ thống nguồn |
| line_no | | Số dòng trong chứng từ (trống = 0) |
| tran_type | | I hóa đơn (mặc định), S bán thu tiền ngay, C trả hàng; dòng C luôn làm giảm cơ sở dù file ghi số dương |
| date | Có | Ngày chứng từ: yyyy-mm-dd hoặc dd/mm/yyyy |
| employee | Có | Mã nhân viên NetSuite hoặc email công việc |
| customer_code, customer_name, customer_category | | Mã, tên, nhóm khách hàng |
| item_code, item_type, item_group | | Mã hàng (lọc theo mã hàng), loại mặt hàng (InvtPart, Service...), nhóm hàng |
| revenue, cost, qty | | Doanh thu chưa thuế, giá vốn, số lượng; dấu phẩy là phân cách nghìn, dấu chấm là thập phân |
| department, class, location | | Phòng ban, class, địa điểm: id nội bộ hoặc tên trên NetSuite (để hạch toán chi phí hoa hồng theo phân đoạn) |
| collected_date, collected_amount | | Ngày và số tiền đã thu (cho kế hoạch ghi nhận khi thu tiền) |
| customer_type | | Khách mới / khách cũ do hệ thống nguồn xác định: N, E, mới, cũ, new, existing; có giá trị thì gói dùng thẳng, không tự tính theo ngày |

**Gói kiểm tra khi nạp.** Thiếu số chứng từ, ngày, nhân viên; ngày sai; số không hợp lệ; trùng số chứng từ + dòng trong cùng file; không tìm thấy nhân viên hoặc tìm thấy nhiều người; phòng ban / class / địa điểm không tìm thấy hoặc trùng tên; loại khách lạ. **Khóa chống trùng** là công ty con + hệ thống nguồn + số chứng từ + dòng: nạp lại cùng khóa thì cập nhật dòng cũ. Dòng có ngày thuộc tháng mà bảng tính hoa hồng đã duyệt hoặc đã vào lương thì không sửa được.

### 23.4 Từ doanh số đến số hoa hồng

Đọc dòng nguồn → lọc theo thành phần (mặt hàng, mã hàng, loại hàng, nhóm hàng, class, phòng ban, địa điểm, nhóm khách, khách mới / cũ) → ghi nhận cho người có phân công → tính % đạt = cơ sở / chỉ tiêu → áp cách tính từng thành phần (% cố định, thang lũy tiến, thang bậc, theo % đạt, đơn giá trên số lượng, thưởng mốc) → trả bù phần chênh nếu là kế hoạch lũy kế quý, năm → hoa hồng quản lý → điều chỉnh tay → trần → ứng trước → số phải trả → chia chi phí theo phân đoạn của doanh số. Mỗi kết quả có diễn giải từng bước và danh sách chứng từ nguồn trên màn hình.

### 23.5 Hỏi đáp thường gặp

**Vì sao nhân viên A bán hàng mà không có hoa hồng?** Kiểm theo thứ tự: người đó đã có phân công vào kế hoạch còn hiệu lực tại ngày chứng từ chưa (nếu chưa, bảng tính hiện cảnh báo "Người bán ... chưa được phân công vào kế hoạch nào"); chứng từ có ghi Sales Rep / đội bán / trường ghi nhận đúng người không; dòng hàng có bị loại khỏi thành phần do bộ lọc không; kế hoạch có ngưỡng % đạt tối thiểu mà người đó chưa đạt không.

**Hóa đơn không có nhân viên kinh doanh?** Không ai được ghi nhận; bảng tính hiện cảnh báo số chứng từ không có người bán và tổng cơ sở của chúng. Bổ sung Sales Rep trên chứng từ rồi tính lại.

**Lãi gộp trong hoa hồng khác lãi gộp trên báo cáo tài chính?** Đúng. Hoa hồng dùng giá vốn ước tính trên dòng hóa đơn tại lúc bán; báo cáo tài chính dùng giá vốn thực tế ghi sổ. Với doanh số ngoài, giá vốn lấy từ cột cost của file.

**Khách trả hàng sau khi đã trả hoa hồng thì sao?** Credit memo trong tháng trừ vào cơ sở của người được ghi nhận. Nếu cơ sở của tháng âm, phần hoa hồng âm chuyển thành số dư ứng trước và được thu hồi dần từ hoa hồng các tháng sau.

**Hóa đơn chưa thu tiền có được tính hoa hồng không?** Tùy kế hoạch: ghi nhận khi xuất hóa đơn thì có; ghi nhận khi thu tiền thì chỉ tính phần đã thu trong tháng. Có thể bật truy thu sau N ngày cho hóa đơn quá hạn chưa thu.

**Đội bán chia thế nào?** Doanh số của chứng từ nhân % đóng góp của từng người trong đội bán trước, rồi mới tính hoa hồng, nên % đạt chỉ tiêu của mỗi người chỉ tính phần của họ.

**Bảng tính đã duyệt mà phát hiện sai?** Mở lại (về nháp) khi chưa vào lương, sửa dữ liệu hoặc thêm điều chỉnh tay có lý do, tính lại và duyệt lại. Đã vào lương thì phải đảo bảng lương trước.

**Nạp lại file doanh số tháng cũ có bị nhân đôi không?** Không, cùng hệ thống nguồn + số chứng từ + dòng thì gói cập nhật dòng cũ. Dòng thuộc tháng đã duyệt bị từ chối sửa.
