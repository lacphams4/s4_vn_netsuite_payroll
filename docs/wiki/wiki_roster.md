## 24. Xếp ca và chế độ ca

**Mục đích.** Cho biết mỗi nhân viên làm ca nào vào ngày nào, để xử lý chấm công máy khớp lượt vào ra với đúng ca, đề xuất phiếu đi trễ, về sớm, vắng, thiếu lượt chấm và đơn làm thêm. Lịch ca được khai một lần cho cả nhóm người bằng **chế độ ca**; hằng ngày chỉ sửa ngoại lệ.

**Vai trò.** HR (khai chế độ ca, sửa lịch, thao tác hàng loạt), Kế toán (chỉ xem), Hệ thống (suy ra lịch, chặn kỳ công đã khóa). Vai trò Demo và Administrator làm được như HR.

**Kích hoạt, tần suất.** Khi triển khai, khi đổi kíp hoặc đổi mẫu xoay ca, khi có người mới vào tổ; ngoại lệ (đổi ca, làm thay, nghỉ) phát sinh hằng ngày. Ca thường ít thay đổi nên phần lớn công việc là khai chế độ ca, không phải xếp từng ô.

### 24.1 Cách gói tính lịch ca: chế độ ca cộng ô ngoại lệ

Các phần mềm lớn không lưu lịch từng ngày cho từng người: SAP gán quy tắc lịch làm việc cho nhân viên theo ngày hiệu lực và chỉ lưu những ngày thay ca; UKG gán mẫu lịch cho nhóm. Gói làm theo cùng cách:

- **Chế độ ca** (record `shift_assign`): một dòng gán một **mẫu xoay ca** cho một **phạm vi**, có hiệu lực từ ngày đến ngày. Phạm vi: **E** một nhân viên, **T** một tổ, **D** một phòng ban, **G** một nhóm lương, **S** cả công ty con. Mỗi dòng có thêm **ngày neo** (ngày ứng với ngày 1 của chu kỳ; trống = ngày hiệu lực) và ghi chú.
- **Ô phân ca** (record `roster`): một nhân viên, một ngày, một ca (trống = nghỉ). Ô nguồn **M** là sửa tay; ô nguồn **G** là ô sinh từ mẫu ở bản trước, vẫn được tôn trọng.
- **Lịch ca hiệu lực** = ô phân ca đã lưu đè lên lịch suy ra từ chế độ ca. Không có bước "sinh phân ca" nào phải chạy: đổi chế độ ca thì lịch đổi ngay.

Quy tắc chọn chế độ ca cho một người trong một ngày:
1. Chỉ xét dòng còn dùng, cùng công ty con, có hiệu lực tại ngày đó.
2. Ưu tiên theo phạm vi: **nhân viên > tổ > phòng ban > nhóm lương > cả công ty con**.
3. Cùng mức ưu tiên thì lấy dòng có ngày hiệu lực muộn nhất.
4. Dòng theo tổ chỉ áp khi người đó là thành viên hiệu lực của tổ tại đúng ngày đó (vào tổ, rời tổ giữa tháng tự đúng).
5. Ca trong ngày = phần tử của chu kỳ mẫu tại vị trí (ngày - ngày neo) chia lấy dư cho độ dài chu kỳ; ô trống của mẫu là ngày nghỉ. Mã ca của mẫu không còn tồn tại thì ngày đó coi như chưa xếp.

Ví dụ: xưởng 2.000 công nhân chia 3 kíp xoay 3 ca chỉ cần 3 dòng chế độ ca (mỗi kíp một dòng theo tổ, ngày neo lệch nhau); đổi mẫu từ một ngày là thêm một dòng có ngày hiệu lực mới.

### 24.2 Diện xếp ca

Nhân viên **thuộc diện xếp ca** khi có chế độ ca hiệu lực hoặc có ô phân ca trong khoảng ngày đang xem. Người ngoài diện (thường là khối văn phòng) mặc định ẩn trên lưới; chấm công của họ vẫn theo ngày nghỉ hằng tuần của nhóm lương như trước. Muốn xếp ca cho một người ngoài diện: chọn bộ lọc **Tất cả** rồi xếp tay, hoặc khai chế độ ca cho người đó.

### 24.3 Màn Xếp ca

Mở từ **Khác > Xếp ca**, hoặc tab **Chấm công > Thao tác khác > Xếp ca** (đường dẫn `#/roster`).

| Phần | Nội dung |
| --- | --- |
| Thanh lọc | Khoảng ngày (Trước / Sau, chọn ngày bắt đầu bằng ô lịch, Tuần này), số ngày 1 tuần / 2 tuần / 31 ngày, Diện xếp ca / Tất cả, tổ, phòng ban, ô tìm (mã, tên, phòng ban, tổ, mẫu) |
| Lưới | Hàng là nhân viên, cột là ngày; ô hiện mã ca, tô màu theo loại ca (ngày, chiều, đêm); ngày nghỉ tuần, ngày lễ tô nền riêng; ô sửa tay có dấu ở góc; ô có thay đổi chưa lưu viền cam; ngày thuộc kỳ công đã khóa mờ và không bấm được |
| Hàng cuối | Số người theo từng ca mỗi ngày, tính trên các nhân viên đang lọc, gồm cả thay đổi chưa lưu |
| Nút **Chế độ ca** | Danh sách chế độ ca của công ty con (có ô tìm), thêm, sửa, thôi dùng |
| Dải bút ca | Chọn một ca, **Nghỉ**, hoặc **Theo chế độ ca** (bỏ ô sửa tay để trở về lịch của chế độ ca) |
| Thanh chọn người | Tích chọn từng người hoặc "Chọn tất cả đang lọc"; ba thao tác hàng loạt (24.4) |
| Chân lưới | Số người thuộc diện, số dòng đang hiện, Hiện thêm (60 người mỗi lần), Bỏ thay đổi, Lưu |

Sửa ngoại lệ trên lưới:
1. Chọn bút ca ở dải bút.
2. Bấm ô để gán; bấm lại ô vừa gán để bỏ. Giữ **Shift** và bấm ô thứ hai cùng dòng để tô cả đoạn.
3. Bấm **tiêu đề ngày** để tô bút ca cho cả ngày đó của những người đang chọn.
4. Bấm **Lưu**: gói ghi ô sửa tay theo lô 200 ô; ô "Theo chế độ ca" được bỏ (đánh dấu không dùng, không xóa).

### 24.4 Thao tác hàng loạt

Áp cho những người đang được chọn:
- **Xếp ca theo khoảng ngày**: chọn ca (hoặc Nghỉ), từ ngày, đến ngày, lọc theo thứ trong tuần. Tối đa 6.000 ô mỗi lần, gửi theo lô 200 ô; ngày thuộc kỳ công đã khóa được bỏ qua và báo số ô bỏ qua. Kết quả là ô sửa tay, nên dùng cho thay đổi ngắn hạn.
- **Gán chế độ ca riêng**: mỗi người nhận một dòng chế độ ca phạm vi nhân viên (ưu tiên hơn chế độ ca của tổ, phòng ban). Dòng riêng cũ giao khoảng hiệu lực mới được đóng ở ngày trước ngày hiệu lực mới, hoặc thôi dùng nếu bắt đầu từ ngày đó trở đi. Gửi theo lô 100 người. Dùng cho thay đổi lâu dài.
- **Trả về chế độ ca**: bỏ mọi ô sửa tay của những người đang chọn trong khoảng ngày đang xem (trừ ngày đã khóa), có hỏi xác nhận.

### 24.5 Quy tắc kiểm tra

- Ô sửa tay: nhân viên phải có hồ sơ lương ở công ty con đang chọn; ca phải tồn tại và đang dùng; ngày không thuộc kỳ công đã khóa của **nhóm lương của nhân viên đó** (kỳ khóa của nhóm lương công ty khác không chặn). Mỗi lần lưu tối đa 200 ô.
- Chế độ ca: bắt buộc phạm vi, đích của phạm vi (trừ cả công ty con), mẫu xoay ca đang dùng và mọi mã ca trong mẫu phải tồn tại, ngày hiệu lực; ngày hết hiệu lực không trước ngày hiệu lực. Tổ phải thuộc công ty con (hoặc không gắn công ty). Không sửa được dòng của công ty con khác.
- Chế độ ca không bị chặn theo kỳ khóa: kỳ đã khóa không xử lý lại chấm công nên lịch mới không ảnh hưởng số đã chốt.
- Quyền: HR, Demo, Administrator ghi; Kế toán chỉ xem.

### 24.6 Lịch ca dùng ở đâu

- **Xử lý chấm công máy** đọc lịch ca hiệu lực (chế độ ca + ô đã lưu) để khớp lượt chấm với ca (xem bài "Dữ liệu máy chấm công").
- **Khung chi tiết nhân viên** của màn Chấm công hiện ca của từng ngày cạnh lượt chấm.
- Account chưa khai chế độ ca nào thì lịch đúng bằng các ô đã lưu như trước; hành vi cũ giữ nguyên.

Route của màn hình: GET `rosterView`; POST `rosterCells` (ô sửa tay), `rosterReset` (trả về chế độ ca), `rosterAssignSave` (thêm, sửa, thôi dùng chế độ ca), `rosterAssignBatch` (gán chế độ ca riêng hàng loạt). Action cũ `generateRoster` (sinh ô từ mẫu theo tổ) vẫn còn ở máy chủ nhưng không còn nút trên màn hình.

### 24.7 Giới hạn hiện tại

- Ô chưa hiện ngày nghỉ phép, công tác của nhân viên.
- Chế độ ca không mang chi nhánh, work center: ô suy ra từ chế độ ca để trống hai trường này (ô sửa tay mới lấy chi nhánh, work center của tổ).
- CHƯA LÀM: định biên theo chuyền / ca, tay nghề, kiểm luật lao động khi xếp (nghỉ giữa hai ca, giờ tối đa), công bố kế hoạch, ca thực tế do tổ trưởng xác nhận, sản lượng theo chuyền ca. Các phần này thuộc phân hệ **Phân ca kíp sản xuất**, đang tạm dừng sau màn Xếp ca (thiết kế ở `docs/SHIFT_CREW_SPEC.md`).
- CHƯA LÀM: quy tắc thu nhập nguồn số lượng **H - Số ca đã làm** và phương pháp phân bổ **R - Ngày phân ca** đã có trong lõi tính nhưng lớp api chưa cấp dữ liệu số ca và ngày phân ca cho bảng lương (quy tắc H ra 0, phương pháp R rơi xuống phân bổ dự phòng).

### 24.8 Hỏi đáp thường gặp

**Cả kíp đổi sang mẫu khác từ một ngày thì làm gì?** Thêm một dòng chế độ ca cho tổ với mẫu mới và ngày hiệu lực là ngày đổi; dòng cũ giữ nguyên làm lịch sử (cùng mức ưu tiên thì dòng hiệu lực muộn hơn thắng). Nếu muốn dòng cũ kết thúc rõ ràng, sửa ngày hết hiệu lực của dòng cũ.

**Hai kíp cùng mẫu nhưng lệch ca thì khai thế nào?** Hai dòng chế độ ca cùng mẫu, khác ngày neo. Ví dụ mẫu 3 ca mỗi ca 5 ngày: kíp sau có ngày neo lệch 7 ngày so với kíp trước.

**Người mới vào tổ giữa tháng có ca không?** Có, từ ngày hiệu lực của dòng thành viên tổ; trước ngày đó người này không theo chế độ ca của tổ.

**Vì sao nhân viên văn phòng không hiện trên lưới?** Họ không có chế độ ca và không có ô phân ca, nên ngoài diện xếp ca. Chọn bộ lọc **Tất cả** để thấy mọi người.

**Ô sửa tay khác gì ô theo chế độ ca?** Ô sửa tay được lưu và luôn thắng chế độ ca, kể cả khi đổi chế độ ca sau đó. Ô theo chế độ ca không được lưu, chỉ tính ra khi xem. Muốn một ngày quay lại theo chế độ ca, dùng bút **Theo chế độ ca** hoặc **Trả về chế độ ca**.

**Sửa lịch ca của ngày đã khóa công được không?** Không. Phải mở khóa kỳ công (khi kỳ chưa có bảng lương ghi sổ), sửa, chạy lại xử lý chấm công rồi khóa lại.

**Đổi chế độ ca có làm mất ô đã sửa tay không?** Không. Ô sửa tay giữ nguyên; muốn bỏ thì dùng Trả về chế độ ca.
