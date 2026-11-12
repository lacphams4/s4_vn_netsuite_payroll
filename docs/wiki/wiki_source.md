# S4 Advanced Payroll (S4 Tính Lương Nâng Cao) trên Oracle NetSuite - quy trình nghiệp vụ (tài liệu nguồn cho wiki)

Tài liệu nguồn để biên soạn wiki theo góc nhìn quy trình nghiệp vụ, dành cho HR, kế toán, kế toán trưởng, CFO, nhân viên tính lương và tư vấn S4. Nội dung đối chiếu với mã nguồn repo `s4_vn_netsuite_payroll` (lõi `core/`, lớp `api/`, màn hình `spa/payroll/views/`), mô hình dữ liệu `tools/schema.mjs` và `tools/schema/*.mjs`, tài liệu `docs/` và đặc tả chuyển giao "Đặc tả chuyển giao S4 eSuite Payroll - từ Acumatica sang Oracle NetSuite" (bản 20/10/2026). Khi tài liệu và mã khác nhau, tài liệu này theo mã (mã mới hơn `docs/ARCHITECTURE.md` và `docs/DOI_CHIEU_DAC_TA.md` ở một số điểm, đã ghi chú).

Quy ước:
- Mã trạng thái, mã danh mục, mã tham số giữ nguyên như trong hệ thống (ví dụ bảng lương H/B/C/P/A/J/R/V, tham số `PIT.SELF_DEDUCTION`).
- "Theo tham số pháp lý" nghĩa là giá trị là dữ liệu có ngày hiệu lực trong record Tham số pháp lý (có cờ "Đã đối chiếu văn bản gốc" - `verified`), không viết cứng trong mã. Giá trị nạp sẵn chỉ là điểm khởi đầu, kế toán trưởng phải đối chiếu văn bản trước khi dùng.
- "(chưa xác minh)" = chưa đọc được bằng chứng chắc chắn trong mã; "CHƯA LÀM" = không có trong mã hiện tại.

---

## 0. Bức tranh chung

### 0.1 Vai trò trong hệ thống

| Vai trò nghiệp vụ | Vai trò NetSuite của gói | Phạm vi chính |
| --- | --- | --- |
| Quản trị / tư vấn triển khai | Administrator | Toàn quyền; riêng quyền tạo dữ liệu thử, xóa cờ tác vụ nền treo |
| HR / nhân viên tính lương | S4VP Payroll HR (`customrole_s4vp_hr`) | Thiết lập, hồ sơ, chấm công, đơn từ, sản lượng, bảng lương đến bước duyệt; KHÔNG ghi sổ, đảo, lập bill, ghi sổ tạm ứng (chặn cả ở máy chủ) |
| Kế toán / kế toán trưởng | S4VP Payroll Accountant (`customrole_s4vp_accountant`) | Bảng lương (gồm ghi sổ, đảo, bill cơ quan thu), ghi sổ tạm ứng, tài khoản hạch toán, cấp duyệt, hoa hồng, phân tích chi phí; xem thiết lập và hồ sơ |
| Nhân viên | Không cần vai trò của gói; dùng Employee Center | Cổng tự phục vụ "Lương của tôi" (Suitelet chạy bằng vai trò ẩn `customrole_s4vp_selfservice`, lọc cứng theo người đăng nhập) |
| Quản lý trực tiếp | KHÔNG có vai trò riêng trên NetSuite | Bản Acumatica có "VP Manager"; trên NetSuite đơn từ do người có vai trò HR (hoặc Administrator) duyệt |
| Trình diễn, quay video | S4 Advanced Payroll - Demo (`customrole_s4vp_demo`) | Toàn quyền mọi record của gói, làm được mọi thao tác của HR và kế toán; menu riêng (custom center `custcenter_s4vp_demo`: tab S4 Advanced Payroll, Nhân sự & thời gian, Kinh doanh, Kế toán); không có thao tác bảo trì chỉ dành cho Administrator (sinh dữ liệu thử, gỡ cờ tác vụ nền treo); không giới hạn công ty con. Chỉ dùng cho môi trường demo |
| Kế toán trưởng / giám đốc duyệt nhiều cấp | Khai theo nhân viên cụ thể hoặc theo vai trò trong "Cấp duyệt bảng lương" | Chỉ khi bật duyệt nhiều cấp |

Ghi chú: gói không có vai trò riêng cho "kế toán trưởng"; phân biệt kế toán viên và kế toán trưởng làm bằng cấu hình cấp duyệt theo nhân viên cụ thể.

### 0.2 Màn hình (tab trong ứng dụng "S4 Advanced Payroll")

Menu NetSuite: tab **S4 Advanced Payroll** (giao diện tiếng Việt: **S4 Tính Lương Nâng Cao**) **> Lương > Màn hình S4 Advanced Payroll** (SPA `/spa/s4vp-payroll`); tiêu đề ứng dụng cũng đổi theo ngôn ngữ người dùng. Vai trò Demo có menu riêng dẫn thẳng tới từng màn. Hàng tab ngang:

| Tab | Việc chính |
| --- | --- |
| Trang chủ | Kỳ đang chạy, mốc việc (khóa công, tính, duyệt, ghi sổ), cảnh báo tham số pháp lý chưa đối chiếu. Bốn thẻ số liệu bấm được: Kỳ đang chạy mở Chấm công của kỳ; Bảng lương của kỳ mở bảng lương (hoặc danh sách lọc theo kỳ); Việc cần xử lý cuộn tới bảng việc cần làm (mỗi việc có nút đi thẳng tới màn xử lý); Thực lĩnh mở hộp thoại theo bảng lương, so kỳ trước |
| Chấm công | Bảng công tháng theo kỳ, các bước thu thập - ngoại lệ - khóa - chuyển sang lương, chứng từ công, bảng công ký hiệu, xử lý chấm công |
| Chạy lương | Danh sách bảng lương; màn một bảng lương: thanh bước, lưới nhân viên, khung chi tiết theo tab, Cần soát, Bút toán, Bill cơ quan thu, duyệt |
| Nhân sự | Danh sách nhân viên, hồ sơ một người: tổng quan, lương và phụ cấp, hợp đồng, quyết định, người phụ thuộc, phân bổ chi phí, giấy phép lao động, phép năm, bảng lương |
| Tạm ứng | Phiếu tạm ứng, số dư, lịch sử cấn trừ |
| Hoa hồng | Bảng tính, kế hoạch, mô phỏng (chỉ hiện với vai trò được xem) |
| Phân tích chi phí | Chi phí lao động 12 tháng, cầu biến động, phân rã theo chiều, lãi lỗ, đối chiếu sổ cái |
| Báo cáo - tờ khai | BH tháng + D02-LT, chi phí theo tài khoản, quỹ lương, 05/KK-TNCN quý, sổ thuế TNCN năm, quyết toán năm, bản in |
| Thiết lập | Thiết lập chung, tài khoản, tài khoản chi phí theo đích, kỳ lương, cấp duyệt, tham số pháp lý, gói ngành |
| Khác | Xếp ca (lịch ca và chế độ ca, bài 24); Sản lượng - khoán tổ; Giấy phép lao động (màn cũ) |

Ô chọn kỳ lương ở mọi màn chỉ liệt kê kỳ của nhóm lương thuộc công ty con đang chọn (công ty không có nhóm riêng thì dùng nhóm không gắn công ty, ví dụ DEFAULT), sắp giảm dần, nhãn dạng "Tháng 11/2026 (01/11 - 30/11)", mã kỳ ở chú thích khi rê chuột; công ty có nhiều nhóm lương thì gom theo nhóm.

Ngoài SPA: danh sách record chuẩn NetSuite trong nhóm menu "Thiết lập lương" (tham số, biểu thuế, khoản trích, ngày lễ, loại thu nhập, quy tắc, gói phúc lợi, loại nghỉ, chính sách phép, ký hiệu bảng công...), Suitelet in PDF, cổng tự phục vụ và portlet Employee Center.

---

## 1. Thiết lập ban đầu

**Mục đích.** Đưa gói vào vận hành cho một công ty con: nạp danh mục và tham số pháp lý mặc định, khai tài khoản hạch toán, nhóm lương, kỳ lương, quy tắc thu nhập và cấp duyệt.

**Vai trò.** Tư vấn / Administrator (nạp mặc định, gói ngành), kế toán trưởng (đối chiếu tham số pháp lý, khai tài khoản, cơ quan thu, cấp duyệt), HR (nhóm lương, sinh kỳ, danh mục thu nhập, phép).

**Kích hoạt, tần suất.** Một lần khi triển khai; cập nhật khi văn bản pháp luật đổi, khi thêm công ty con, đầu mỗi năm (sinh kỳ, ngày lễ).

**Các bước.**
1. Deploy gói; account cần Custom Records, Server SuiteScript; nên bật Departments, Classes, Locations.
2. Thiết lập > **Nạp mặc định VN** (Load VN Defaults): tạo tham số pháp lý theo ngày hiệu lực, biểu thuế lũy tiến, khoản trích (BHXH_HT, BHXH_OD, BHTNLD, BHYT, BHTN, KPCD, DOANPHI), ngày lễ đã công bố, loại thu nhập mặc định, loại nghỉ (PN, VR, OM, TS, KL), chính sách phép STD, quy tắc trừ công trễ sớm, ký hiệu bảng công, nhóm lương DEFAULT, bộ quy tắc thu nhập mặc định. Chạy lại an toàn (chỉ thêm phần thiếu); tên danh mục theo ngôn ngữ người chạy.
3. Kế toán trưởng mở Thiết lập > Tham số pháp lý: mục chưa đối chiếu hiện trước; sửa giá trị nếu khác văn bản rồi đánh dấu "Đã đối chiếu" (action `verifyParam`, quyền Administrator + HR). Ba dòng từ 01/07/2026 nạp sẵn ở trạng thái `verified = F`: `INS.REFERENCE_WAGE`, `PIT.FLAT_THRESHOLD`, `PIT.MEAL_EXEMPT_CAP`. Trang chủ cảnh báo khi còn tham số chưa đối chiếu.
4. **Thiết lập chung** (record `setup`): ngày công chuẩn, giờ chuẩn / ngày (mặc định 8), ngày nghỉ hằng tuần (chuỗi số 0 = Chủ nhật ... 6 = thứ Bảy), vùng mặc định, loại thu nhập lương cơ bản / phụ cấp / ăn ca / thù lao CTV / trả phép khi nghỉ việc, mức ăn ca / tháng, DN đóng KPCĐ, tỷ lệ BHTNLĐ ghi đè, ngành được làm thêm 300 giờ / năm, Bắt buộc duyệt bảng lương (mặc định bật), Tự duyệt bút toán và bill do phân hệ lương tạo (mặc định bật), Chỉ lấy giờ đã duyệt (mặc định bật), Nguồn giờ làm thêm (R / T), Bắt buộc khóa công trước khi tính lương, chính sách phép mặc định, Chặn tính lương khi thiếu giấy phép lao động, phương pháp phân bổ, phân bổ dự phòng, chế độ phiên bản bảng tỷ lệ, cơ sở và số tháng chia trích trước tháng 13.
5. **Tài khoản** (kế toán khai, trên thiết lập chung hoặc theo công ty con): 334 phải trả người lao động, 3335 thuế TNCN, 141 tạm ứng, chi phí lương mặc định, khấu trừ khác, 335 trích trước tháng 13, phải trả CTV (3388 / 331), nhà cung cấp "Cơ quan thuế", địa điểm mặc định cho chứng từ (khi account bắt buộc Location).
6. **Thiết lập lương theo công ty** (record `company`): một dòng mỗi công ty con dùng lương, cờ "Bật phân hệ lương", ô trống kế thừa thiết lập chung; người ký bản in (người lập biểu, kế toán trưởng, giám đốc).
7. **Khoản trích theo lương**: mỗi khoản khai tài khoản phải trả 338x và nhà cung cấp cơ quan thu (BHXH, công đoàn). Thiếu vendor thì khoản đó không lên bill.
8. **Tài khoản chi phí lương theo đích** (record `cost_account`, màn Thiết lập > Tài khoản chi phí theo đích; HR xem, kế toán toàn quyền): gán tài khoản chi phí cho một dự án (P), class / work center (W) hoặc phòng ban (D), tùy chọn theo công ty con, loại lao động, ngày hiệu lực. Có công cụ thử "tài khoản sẽ được chọn" (`costAccountTest`). Thôi dùng bằng inactive, không xóa.
9. **Nhóm lương** (record `paygroup`): tần suất (M tháng / S nửa tháng / W tuần), ngày đầu tuần, thời điểm khấu trừ BH - thuế, ngày công chuẩn tháng, giờ / ngày, nghỉ tuần, nguồn OT, bắt buộc khóa công, nguồn công (E chứng từ ngoại lệ / S bảng công ký hiệu), chính sách phép, phương pháp phân bổ. Nhóm DEFAULT luôn có.
10. **Sinh kỳ lương** (Thiết lập > Kỳ lương > Sinh kỳ): theo năm và nhóm lương. Mã kỳ: nhóm DEFAULT `yyyyMM`; nhóm khác `<nhóm>-yyyyMM` / `yyyyMMS1`, `S2` / `yyyyWnn`. Tháng tính thuế = yyyyMM theo ngày cuối kỳ; "Kỳ cuối tháng thuế" đánh dấu kỳ có ngày cuối muộn nhất trong tháng. Ngày công chuẩn kỳ tháng = số ngày trong kỳ trừ ngày nghỉ tuần và ngày lễ; kỳ nửa tháng / tuần dùng ngày công chuẩn tháng của nhóm lương. Cửa sổ kết công (Lấy giờ từ / đến ngày) nhập tay nếu lệch kỳ.
11. **Loại thu nhập** (record `earning_type`): mã, nhóm (B lương cơ bản, O làm thêm - làm đêm, A phụ cấp, N thưởng, P sản phẩm - khoán, M ăn ca, X khác), cách tính thuế (T chịu thuế, E miễn thuế, C miễn đến trần - kèm mã tham số trần, P miễn phần chênh lệch OT / đêm), cờ OT, loại ngày OT, làm đêm, mã loại giờ timesheet. Mặc định: LUONG, PHUCAP, ANCA (C, trần `PIT.MEAL_EXEMPT_CAP`), THUONG, TRAPHEP, PHIDV, OT150, OT200, OT300, OTD150, OTD200, OTD300, DEM.
12. **Gói phúc lợi**: các khoản phụ cấp cố định / tháng theo loại thu nhập, gán trên lịch sử lương.
13. **Quy tắc thu nhập** (mục 8.2 bên dưới) - rà bộ mặc định với khách.
14. **Gói ngành** (Thiết lập, hộp thoại gói ngành; action `loadIndustryPack`): Xây dựng (CONSTRUCTION), Thương mại (TRADE), Sản xuất (MANUFACTURING, kèm ca và mẫu xoay ca 3C4K, 2CA, HC6). Tạo nhóm lương, loại thu nhập, bảng đơn giá, quy tắc mẫu.
15. **Cấp duyệt bảng lương** (record `approval_step`, kế toán sửa, HR xem): mặc định không có dòng = duyệt một cấp. Mỗi dòng là một người duyệt của một cấp: công ty con (trống = mọi công ty; công ty có dòng riêng thì chỉ dùng dòng riêng), cấp (1, 2...), người duyệt là nhân viên cụ thể hoặc vai trò (H nhân sự / A kế toán / D Administrator), ngưỡng tổng thực lĩnh (chỉ cần cấp này khi tổng thực lĩnh >= ngưỡng).
16. Gán vai trò S4VP Payroll HR / Accountant cho người dùng; thêm portlet "S4VP My Payroll" vào dashboard role Employee Center nếu dùng tự phục vụ.
17. Chạy một kỳ thử, so với bảng lương Excel cũ đến từng đồng trước khi chạy thật.

**Record NetSuite.** `customrecord_s4vp_setup`, `_company`, `_paygroup`, `_period`, `_param`, `_pit_bracket`, `_ins_comp`, `_holiday`, `_earning_type`, `_earning_rule` + `_rule_cond`, `_benefit_pkg` + `_benefit_line`, `_leave_type`, `_leave_policy`, `_att_rule`, `_att_symbol`, `_cost_account`, `_approval_step`, `_rate_table` + `_rate_line`.

**Tham số pháp lý nạp sẵn (dữ liệu, có ngày hiệu lực, cần KTT đối chiếu).**

| Mã tham số | Ý nghĩa |
| --- | --- |
| `PIT.SELF_DEDUCTION`, `PIT.DEPENDENT_DEDUCTION` | Giảm trừ bản thân, mỗi người phụ thuộc / tháng |
| `PIT.FLAT_RATE`, `PIT.FLAT_THRESHOLD` | Thuế suất khấu trừ 10% và ngưỡng mỗi lần chi |
| `PIT.NONRESIDENT_RATE` | Thuế suất cá nhân không cư trú |
| `PIT.MEAL_EXEMPT_CAP` | Trần tiền ăn giữa ca miễn thuế / tháng |
| `INS.REFERENCE_WAGE` | Mức tham chiếu (lương cơ sở) |
| `INS.SI_CAP_MULTIPLIER`, `INS.UI_CAP_MULTIPLIER` | Hệ số trần lương đóng BHXH-BHYT; BHTN |
| `INS.ABSENCE_DAYS_THRESHOLD` | Số ngày nghỉ trong tháng không đóng BH |
| `INS.UNION_FEE_CAP_FACTOR` | Trần đoàn phí (lõi thực tế lấy trần theo hệ số trên khoản DOANPHI) |
| `MINWAGE.I` ... `MINWAGE.IV` | Lương tối thiểu vùng |
| `OT.NORMAL_DAY`, `OT.WEEKLY_OFF`, `OT.HOLIDAY` | Hệ số OT ngày thường, nghỉ tuần, lễ |
| `OT.NIGHT_PREMIUM`, `OT.NIGHT_EXTRA` | Phụ cấp làm đêm; phần thêm khi làm thêm ban đêm |
| `OT.LIMIT_MONTH`, `OT.LIMIT_YEAR`, `OT.LIMIT_YEAR_EXTENDED` | Giới hạn giờ OT tháng, năm, năm cho ngành được phép |

Biểu thuế lũy tiến (record `pit_bracket`) có hai bộ theo ngày hiệu lực: bộ 7 bậc đến 31/12/2025 và bộ 5 bậc từ 01/01/2026 (nạp theo Luật Thuế TNCN 109/2025/QH15). Không trộn hai bộ; bậc chọn theo ngày cuối kỳ.

**Kiểm soát.** Mọi tham số có ngày hiệu lực và cờ đối chiếu; màn Thiết lập không sửa giá trị pháp lý (chỉ đổi cờ đã đối chiếu); Nạp mặc định không ghi đè dữ liệu đã có; thiết lập theo công ty con bật / tắt phân hệ (công ty chưa bật thì không tạo được bảng lương).

**Ngoại lệ.** Văn bản mới: thêm dòng tham số với ngày hiệu lực mới (giữ dòng cũ để tính lại kỳ cũ đúng). Tài khoản sai: sửa thiết lập rồi tính lại bảng chưa ghi sổ; bảng đã ghi sổ phải đảo.

---

## 2. Hồ sơ nhân sự và lương

**Mục đích.** Lưu mọi dữ kiện của người lao động mà bảng lương cần, tách quyền xem lương khỏi bản ghi Employee chuẩn.

**Vai trò.** HR lập và sửa; kế toán xem; nhân viên xem phần của mình trên cổng tự phục vụ (số định danh che).

**Kích hoạt.** Tuyển mới, điều chỉnh lương, điều chuyển, thêm người phụ thuộc, nghỉ việc.

**Thành phần và bước.**
1. **Hồ sơ lương nhân viên** (record `employee`, 1-1 với Employee): công ty con, nhóm lương, loại lao động (E nhân viên HĐLĐ / C cộng tác viên HĐDV), loại lương (M tháng / D ngày / H giờ), cách tính thuế (P lũy tiến / F khấu trừ 10% / N không cư trú 20% / X không khấu trừ), cờ đã nộp cam kết 08/CK-TNCN, mã số thuế, CCCD, số sổ BHXH, tham gia BHXH-BHYT, tham gia BHTN, đoàn viên công đoàn, vùng lương, trích trước tháng 13, tài khoản chi phí, phòng ban / class / địa điểm / dự án mặc định, phương pháp phân bổ, ngân hàng, số tài khoản, chính sách phép, ngày tính thâm niên, ngày vào làm, ngày làm việc cuối, người nước ngoài, quốc tịch, chỉ tiêu doanh số / tháng.
2. **Lịch sử lương** (record `compensation`): theo ngày hiệu lực - lương hợp đồng, lương đóng BHXH, phụ cấp cố định / tháng, gói phúc lợi. Bảng lương lấy dòng hiệu lực muộn nhất không sau ngày cuối kỳ. Không có dòng nào thì dòng nhân viên báo lỗi; lương hợp đồng phải > 0.
3. **Người phụ thuộc** (record `dependent`): họ tên, quan hệ, ngày sinh, MST, giảm trừ từ - đến. Chỉ áp cho cách tính thuế P.
4. **Hợp đồng lao động và phụ lục** (record `contract`, tab Nhân sự > Hợp đồng): loại P thử việc / F xác định thời hạn / U không xác định / S thời vụ - khoán việc / C cộng tác viên - dịch vụ; trạng thái D nháp -> A hiệu lực -> T chấm dứt (X hết hạn: hệ thống tự coi hợp đồng A quá ngày kết thúc là hết hạn). Phụ lục là dòng có "Phụ lục của hợp đồng"; không chấm dứt riêng phụ lục. **Mức lương trên hợp đồng chỉ để ghi nhận, KHÔNG phải nguồn tính lương.**
5. **Quyết định nhân sự** (record `decision`): H tiếp nhận, T điều chuyển, P bổ nhiệm, S điều chỉnh lương, R khen thưởng, D kỷ luật, X chấm dứt. Trạng thái D nháp -> A đã áp dụng. "Áp dụng" (`hrApplyDecision`) cập nhật hồ sơ lương và thêm lịch sử lương theo ngày hiệu lực; quyết định chấm dứt tự chấm dứt các hợp đồng đang hiệu lực. Đã áp dụng thì không sửa được.
6. **Nhân viên nước ngoài / giấy phép lao động** (record `work_permit`, menu Khác > Giấy phép lao động hoặc tab Nhân sự): loại giấy (P giấy phép / E giấy xác nhận miễn), loại cấp (N cấp mới / X gia hạn / R cấp lại), chuỗi giấy trước, trạng thái D đang chuẩn bị -> S đã nộp -> A còn hiệu lực -> E hết hạn / V thu hồi, vị trí (M nhà quản lý, D giám đốc điều hành, E chuyên gia, T lao động kỹ thuật, O khác), hộ chiếu. Kiểm tra thời hạn tối đa (mặc định trong gói: 24 tháng, gia hạn 1 lần, nhắc trước 60 ngày - các số này là mặc định cấu hình trong mã, chưa có trường thiết lập riêng (chưa xác minh)). Khi tính lương, người có cờ "Người nước ngoài" được đánh giá: còn hiệu lực / sắp hết hạn (cảnh báo) / phủ một phần / không phủ (cảnh báo, hoặc chặn tính lương khi bật "Chặn tính lương khi thiếu giấy phép lao động").
7. **Bảng tỷ lệ phân bổ có phiên bản** (record `alloc_version` + `alloc_line`, tab Nhân sự > Phân bổ chi phí): phiên bản D nháp -> A hiệu lực (kích hoạt khi tổng = 100%, thay thế bản cũ thành S) ; dòng: dự án, phòng ban, địa điểm, class, %. Phiên bản đã được bảng lương ghi sổ dùng thì đánh dấu "đã dùng" (khóa).

**Kiểm soát.** Số tiền lương chỉ trả cho vai trò lương; số định danh (MST, CCCD, sổ BHXH, tài khoản ngân hàng) không rời máy chủ ở màn Nhân sự (chỉ cờ có / không); không ghi lương, số định danh vào log; hồ sơ, hợp đồng, quyết định không xóa (HR quyền EDIT, không DELETE); nhật ký thao tác gắn nhân viên cho hợp đồng, quyết định, người phụ thuộc, hồ sơ, phân bổ, giấy phép, tạm ứng.

**Ngoại lệ.** Lương sai sau khi tính: sửa lịch sử lương rồi tính lại (bảng chưa duyệt); đã ghi sổ thì đảo và lập bảng mới. Quyết định đã áp dụng sai: lập quyết định mới có ngày hiệu lực đúng (không sửa quyết định cũ).

**Chưa làm.** Phân quyền dữ liệu lương theo công ty / chi nhánh (HR công ty A không thấy lương công ty B) và kiểm soát "quản trị IT không xem lương": CHƯA LÀM (đặc tả 1.4.1). Mẫu văn bản hợp đồng / quyết định theo pháp luật: không có, chỉ có "phiếu thông tin" in.

---

## 3. Chấm công và thời gian

**Mục đích.** Xác định công hưởng lương, ngày nghỉ (có lương, không lương, BHXH trả), giờ làm thêm và giờ công theo dự án của từng người trong kỳ, rồi khóa làm căn cứ tính lương.

**Vai trò.** Nhân viên (lập đơn trên cổng tự phục vụ), HR (lập hộ, duyệt đơn, nạp chấm công, lập và khóa bảng công), Administrator. Kế toán chỉ xem.

**Kích hoạt, tần suất.** Đơn từ phát sinh hằng ngày; lập và khóa bảng công cuối mỗi kỳ.

### 3.1 Hai mô hình công (theo nhóm lương, trường "Nguồn công")
- **E - Chứng từ ngoại lệ (mặc định):** mặc định đủ công chuẩn; công hưởng lương = max(0, công chuẩn - nghỉ không lương - nghỉ BHXH - quy đổi trễ sớm + điều chỉnh). Ngày nghỉ xét BH = nghỉ không lương + nghỉ BHXH. Nghỉ có lương và công tác chỉ thống kê. Ngày ngoài thời hạn hợp đồng (vào làm / nghỉ việc giữa kỳ) cộng vào nghỉ không lương.
- **S - Bảng công ký hiệu** (record `att_sheet`, 31 ô ngày): ký hiệu tra danh mục (nhóm W làm việc, P nghỉ có lương, U không lương, S BHXH trả, T công tác, N không tính; số ngày mỗi ô). Mặc định: X, /2, P, P/2, K, Ô, TS, CT, L, N. Ký hiệu lạ bị bỏ qua và cảnh báo.

### 3.2 Chứng từ công (đơn nghỉ NP, đơn OT, đơn công tác CT, phiếu ngoại lệ NL)
Luồng chung (core `AttendanceDocRules`): **H Tạm giữ -> (Gửi duyệt) P Chờ duyệt -> (Duyệt) A Đã duyệt / (Từ chối) R Từ chối; P hoặc A -> (Hủy) C Đã hủy.**
1. Nhân viên hoặc HR lập đơn ở H. Hệ thống tự tính: số ngày đơn nghỉ (bỏ ngày nghỉ tuần, ngày lễ; nửa ngày theo buổi sáng / chiều), loại ngày OT (N thường / W nghỉ tuần / H lễ) và loại thu nhập OT, ngày bị trừ của phiếu trễ sớm, kỳ lương chứa ngày chứng từ.
2. Gửi duyệt: kiểm tra trùng ngày, số dư phép (loại nghỉ dùng số dư), tối đa ngày / đơn, loại nghỉ cần đính kèm (chỉ cảnh báo người duyệt, chưa kiểm được file trên custom record), giờ OT trong ngày, phiếu ngoại lệ phải có lý do và kỳ. Đơn nghỉ phép năm: giữ chỗ số dư (Pending).
3. Duyệt / từ chối: **không được tự duyệt đơn của chính mình**; ghi người duyệt, ngày duyệt; từ chối ghi lý do.
4. Kỳ công đã khóa thì không gửi, duyệt, hủy chứng từ có ngày thuộc kỳ đó; chứng từ đã khóa theo kỳ công (cờ `summary_locked`) không hủy được.
5. Đơn công tác có "Số tiền tạm ứng": khi duyệt tự sinh phiếu tạm ứng ở H; hủy đơn thì xóa phiếu tạm ứng chưa ghi sổ, phiếu đã ghi sổ thì chặn hủy.
6. Phiếu ngoại lệ: L đi trễ / E về sớm (số phút -> ngày bị trừ theo quy tắc trừ công; mặc định nạp sẵn: 1-15 phút 0; 16-60 phút 0,25; 61-240 phút 0,5; từ 241 phút 1 ngày - là quy chế mặc định, khách chỉnh được) hoặc A điều chỉnh công (-1 đến 1 ngày).

### 3.3 Ca, phân ca, máy chấm công
1. Khai ca (giờ vào / ra HH:mm, nghỉ giữa ca, loại ca D/E/N, cho phép trễ / sớm, OT tối thiểu; ca qua đêm khi giờ ra nhỏ hơn giờ vào) và mẫu xoay ca.
2. Xếp ca (màn **Xếp ca**, chi tiết ở bài 24): khai **chế độ ca** - mẫu xoay ca gán cho nhân viên, tổ, phòng ban, nhóm lương hoặc cả công ty con theo hiệu lực - rồi chỉ sửa ngoại lệ thành ô phân ca (nguồn M). Lịch ca hiệu lực = ô đã lưu đè lên lịch suy ra từ chế độ ca; không cần sinh từng ô. Ô sinh từ mẫu theo tổ ở bản trước (nguồn G) vẫn được dùng; action `generateRoster` còn ở máy chủ nhưng không còn nút trên màn hình.
3. Nạp lượt chấm công: nút **Nạp chấm công** trên tab Chấm công, theo hồ sơ nguồn của từng máy và bảng đối chiếu mã chấm công (chi tiết ở bài "Dữ liệu máy chấm công"); ngoài ra API, CSV Import, REST.
4. **Xử lý chấm công** (`processPunches`): đối chiếu lịch ca hiệu lực (chế độ ca + ô phân ca) với lượt chấm, sinh phiếu trễ / sớm / vắng / thiếu lượt chấm và **đơn OT gợi ý, tất cả ở trạng thái Tạm giữ** để người duyệt xem (hệ thống không tự trừ lương - Điều 127 BLLĐ cấm phạt tiền). Chạy lại thay chứng từ lần trước. Giờ đêm 22:00 - 06:00.
5. Kỳ lớn (quá 200 nhân viên hoặc quá 3.000 ô nhân viên x ngày) tự chạy nền bằng Map/Reduce theo lô 10 nhân viên; màn hình theo dõi tác vụ và báo số phiếu, số đơn làm thêm đề xuất khi xong.

### 3.4 Lập và khóa bảng công (tab Chấm công)
1. HR chọn kỳ; thanh bước: thu thập (collect) -> xử lý ngoại lệ (exceptions) -> khóa (lock) -> chuyển sang lương (handoff).
2. **Lập bảng công** (`buildAttendance`): chạy lại nhiều lần; chỉ hồ sơ cùng nhóm lương, đang làm hoặc nghỉ trong kỳ; **CTV bị loại** khỏi bảng công (CTV lương giờ đi theo giờ Time). Kỳ đóng, kỳ đã khóa công, kỳ đã có bảng lương ghi sổ thì không lập lại được. Trên 150 người chạy Map/Reduce.
3. Sửa công chỉ bằng chứng từ (phiếu điều chỉnh có lý do) hoặc ô của bảng công ký hiệu.
4. **Khóa công** (`lockAttendance`): lập lại ngay trước khi khóa, đặt dòng tổng hợp công trạng thái L, kỳ `att_status = L`, đặt cờ khóa trên chứng từ nguồn.
5. **Mở khóa** (`unlockAttendance`): bị chặn khi kỳ có bảng lương R hoặc V (kể cả đã đảo).
6. Khi công đã khóa, nút "Sang chạy lương".

### 3.5 Giờ công từ Time của NetSuite (giờ công tính lương, VP312000)
1. Trên bảng lương bấm **Nạp giờ công** (`syncTime`; cũng tự chạy sau Nạp nhân viên): đọc bản ghi Time trong cửa sổ kết công của kỳ (trống thì ngày đầu - cuối kỳ), chỉ giờ đã duyệt khi bật "Chỉ lấy giờ đã duyệt" (tắt thì lấy mọi dòng trừ dòng bị từ chối), gộp theo nhân viên + dự án + công việc thành record `batch_time`.
2. HR **Sửa giờ** phải ghi lý do; nạp lại giữ giờ đã sửa, dòng chưa sửa cập nhật theo timesheet, dòng mất nguồn: chưa sửa thì xóa, đã sửa thì giờ nguồn = 0 và giữ giờ HR.
3. Tab Giờ công xem timesheet từng ngày (chỉ đọc).
4. Giờ thường từ Time dùng cho lương giờ (nguồn số lượng B) và phân bổ theo timesheet. **Giờ OT vẫn lấy từ đơn OT đã duyệt; nguồn OT = T (đọc OT từ timesheet): CHƯA nối.**

**Kiểm soát chung.** User Event chặn sửa trực tiếp chứng từ công trên form NetSuite / CSV / web service khi không ở H hoặc đã khóa; tạo mới qua giao diện luôn ở H; không đổi được trạng thái, người duyệt, cờ khóa, số ngày. Nhật ký thao tác ghi khóa / mở khóa / lập công.

**Ngoại lệ.** Công sai sau khi khóa nhưng chưa ghi sổ: mở khóa, sửa chứng từ, lập và khóa lại, rồi Nạp nhân viên và tính lại bảng lương. Sau khi kỳ có bảng lương ghi sổ (kể cả đã đảo) không mở khóa được: điều chỉnh qua kỳ sau bằng dòng nhập tay (chưa có chức năng truy lĩnh tự động).

**Chưa làm.** Bảng chấm công in theo bộ phận đã có (bản in `timesheet`); lưới nhập 31 ô bảng công ký hiệu trên SPA (DOI_CHIEU ghi "chưa có", màn Chấm công bản 2 có `saveSheet` sửa ô - mức đầy đủ chưa xác minh); màn "Công, phép và đơn của tôi" trên mobile: CHƯA LÀM (cổng tự phục vụ thay thế một phần).

---

## 4. Nghỉ phép

**Mục đích.** Cấp, theo dõi và sử dụng phép năm; trả tiền phép chưa nghỉ khi nghỉ việc.

**Vai trò.** HR (cấp phép, hết hạn, điều chỉnh, duyệt đơn), nhân viên (lập đơn, xem số dư).

**Kích hoạt.** Đầu năm (cấp phép, chuyển phép), hằng tháng nếu cấp theo tháng, ngày hết hạn phép chuyển, mỗi đơn nghỉ, kỳ có người nghỉ việc.

**Các bước.**
1. **Loại nghỉ** (mặc định nạp sẵn): PN phép năm (trừ số dư), VR việc riêng có lương (tối đa 3 ngày / đơn), OM ốm đau BHXH trả, TS thai sản BHXH trả (hai loại này trừ ngày công, cần đính kèm), KL không lương (trừ ngày công). Cờ: có lương, trừ ngày công, BHXH trả, trừ số dư, bắt buộc đính kèm, cho nửa ngày, tối đa ngày / đơn.
2. **Chính sách phép** (mặc định STD, là quy chế mẫu cần HR rà): số ngày / năm (12), cộng thêm ngày mỗi số năm thâm niên (1 ngày / 5 năm), cách cấp Y đầu năm / M theo tháng, tỷ lệ cho người mới, chuyển tối đa, tháng hết hạn phép chuyển, đơn vị làm tròn (0,5).
3. **Cấp phép năm** (Chấm công / Thiết lập, action `accrueLeave`; trên số hồ sơ lớn chạy Map/Reduce): công thức `LeaveAccrualCalculator`:
   - Thâm niên: cộng `seniorityExtraDays` cho mỗi `seniorityStepYears` năm tròn tính đến 31/12 năm cấp (từ ngày tính thâm niên).
   - Người mới (khi bật tỷ lệ): chia theo tháng; tháng vào làm được tính nếu ngày vào <= 15.
   - Cấp theo tháng: tính đến tháng của ngày chạy (tháng chạy được tính nếu ngày chạy >= 15 hoặc là 31/12).
   - Làm tròn theo đơn vị làm tròn, nửa ra xa 0.
   - Chạy lại không cấp trùng (cấp theo năm đã cấp thì 0; theo tháng chỉ cấp phần chênh). Ghi giao dịch nguồn A.
   - Chuyển phép năm trước: min(số dư khả dụng năm trước, chuyển tối đa), giao dịch C, kèm hạn = cuối tháng hết hạn.
   - **CTV (loại lao động C) không được cấp phép** ("Cộng tác viên (hợp đồng dịch vụ): không có phép năm").
4. **Hết hạn phép chuyển** (`expireLeave`): giao dịch X trừ phần chuyển chưa dùng.
5. **Điều chỉnh tay** (`adjustLeave`): giao dịch J, bắt buộc nhân viên, loại, năm, số ngày khác 0, lý do.
6. **Đơn nghỉ**: gửi duyệt -> Pending tăng; duyệt -> Pending giảm, Used tăng (giao dịch R số âm); từ chối / hủy -> trả lại. Năm của số dư là năm của ngày bắt đầu nghỉ.
7. **Trả phép khi nghỉ việc**: kỳ có ngày làm việc cuối (không phải CTV), hệ thống tự sinh dòng thu nhập loại "trả phép khi nghỉ việc" (mặc định TRAPHEP, chịu thuế) = số ngày phép còn lại x lương một ngày. Lương một ngày: M = lương hợp đồng / công chuẩn; D = lương ngày; H = lương giờ x giờ / ngày. Ngày còn lại = tổng khả dụng năm nghỉ việc của các loại nghỉ có lương và trừ số dư. Có dòng nhập tay cùng loại thì dùng dòng tay. Chưa khai loại thu nhập trả phép thì chỉ cảnh báo, không trả.

**Sổ phép.** Record `leave_balance` (khóa nhân viên + loại + năm): Khả dụng = Được cấp + Chuyển từ năm trước + Điều chỉnh - Đã dùng - Đang chờ duyệt. Record `leave_tran`: số dương cấp, âm dùng; nguồn A cấp / C chuyển / X hết hạn / R đơn nghỉ / J điều chỉnh. Có đối soát tự sửa số dư theo giao dịch khi lần cấp trước dừng giữa chừng.

**Kiểm soát.** Sổ phép và giao dịch phép chỉ đổi qua màn hình gói (User Event chặn sửa tay); vượt số dư bị chặn khi gửi duyệt.

**Màn hình.** Chấm công > Thao tác khác > Đơn từ, lượt chấm, phép (màn hình cũ), mục Số dư phép: chọn năm hiện tại hoặc năm sau (chạy năm sau để chuyển phép còn lại sang năm mới), nút Cấp phép năm (kèm chuyển phép năm trước), Hết hạn phép chuyển, Tải lại; lưới số dư chỉ gồm nhân viên của công ty con đang chọn, có ô lọc nhanh theo mã, tên, loại nghỉ; cột Chuyển hiện số ngày chuyển từ năm trước, rê chuột thấy hạn dùng phép chuyển. Ngoài ra: Nhân sự > Phép năm, cổng tự phục vụ (số dư, hạn phép chuyển).

---

## 5. Sản lượng và lương khoán

**Mục đích.** Trả lương theo khối lượng / sản phẩm / công đoạn cho cá nhân hoặc tổ, chia tiền tổ cho thành viên, đưa vào bảng lương và hạch toán chi phí về đúng dự án / phòng ban.

**Vai trò.** Thống kê / HR lập phiếu; quản lý hoặc HR duyệt (trên NetSuite: người có vai trò HR); kế toán sửa được phiếu (quyền EDIT).

**Kích hoạt.** Theo đợt nghiệm thu, tuần hoặc tháng.

**Danh mục.**
- **Bảng đơn giá** (record `rate_table` + `rate_line`): loại W hạng mục khoán / O công đoạn / P sản phẩm / S thang hoa hồng doanh số; dòng: mã hạng mục, đơn vị tính, đơn giá (hoặc %), từ doanh số (bậc thang), hiệu lực từ - đến, dự án (tùy chọn); cờ cho sửa đơn giá trên phiếu.
- **Tổ đội** (record `team` + `team_member`): loại C tổ đội / L chuyền / S cửa hàng, tổ trưởng, cách chia mặc định, dự án, địa điểm, class, phòng ban; thành viên theo hiệu lực, hệ số chia, tỷ lệ cố định %. Thành viên có thể là CTV.

**Các bước (tab Khác > Sản lượng - khoán tổ).**
1. Lập phiếu ở **H Tạm giữ**: công ty con, ngày phiếu, kỳ lương, loại I cá nhân / T tổ, bảng đơn giá, tổ, cách chia, dự án, địa điểm, class, phòng ban; dòng sản lượng (nhân viên với phiếu cá nhân, mã hạng mục, số lượng, đơn giá). Đơn giá trống thì tra bảng theo ngày phiếu và dự án; đơn giá nhập tay chỉ giữ khi bảng cho sửa. Thành tiền dòng = Round(số lượng x đơn giá).
2. Phiếu tổ: **Nạp thành viên** (thành viên hiệu lực tại ngày phiếu, ngày công từ bảng công, hệ số từ tổ), **Chia tiền** theo cách chia: D ngày công, F ngày công x hệ số, H giờ, P tỷ lệ cố định, E chia đều. Mỗi phần làm tròn xuống đến đồng, phần dư chia từng đồng theo phần lẻ lớn nhất trước để tổng đúng bằng thành tiền. Sửa tay số tiền được (cờ "Sửa tay").
3. **Gửi duyệt** H -> P: phiếu tổ chưa có số sửa tay thì tự chia lại; kiểm tra kỳ còn mở và kỳ công chưa khóa; tính lại tổng.
4. **Duyệt** P -> A (ghi người, ngày duyệt). **Từ chối** P -> H (bắt buộc lý do, lưu "lý do từ chối gần nhất"). **Trả về tạm giữ** P hoặc A -> H (chỉ khi phiếu chưa vào bảng lương).
5. Bảng lương dùng phiếu A (hoặc C của chính bảng đó) trong kỳ qua quy tắc thu nhập nguồn số lượng O "Thành tiền sản lượng" (hoặc S doanh số với bảng loại S). Khi ghi sổ bảng lương, đúng các phiếu đã dùng chuyển **C Đã vào bảng lương** và gắn bảng lương; đảo bảng lương trả về A.
6. **Hủy phiếu**: chỉ phiếu H chưa vào bảng lương; đặt inactive và ghi lý do (không xóa).

**Nguồn sản lượng từ giao dịch NetSuite** (record `out_source`, `outputSourcePreview` / `outputSourceGenerate`): từ Assembly Build, Work Order Completion, Item Fulfillment; khai trường nhân viên / tổ trên giao dịch, bảng đơn giá, dấu số lượng (mặc định -1 với Item Fulfillment), phòng ban theo dòng. Sinh phiếu H (cá nhân hoặc tổ), mã hạng mục = mã mặt hàng, khóa nguồn chống sinh trùng; phiếu sinh ra vẫn qua duyệt. Account thử chưa có sản xuất nên phần này mới kiểm bằng test đơn vị (chưa chạy trên account).

**Hạch toán.** Chi phí khoán đi theo đích của phiếu ("nguồn nào đích đó"): dự án, địa điểm, class, phòng ban của phiếu; không khai phòng ban thì theo phòng ban nhân viên. Phiếu cũng nạp được bằng CSV Import.

**Bản in.** Bảng chia lương tổ (`doc=teamSplit`, VP645000) theo phiếu, có chữ ký tổ trưởng, người lập, người duyệt.

---

## 6. Hoa hồng nhân viên kinh doanh

**Mục đích.** Tính hoa hồng từ giao dịch bán hàng NetSuite hoặc dữ liệu bán hàng ngoài, giải thích từng đồng, đưa vào bảng lương và hạch toán về phân đoạn của doanh thu.

**Vai trò.** Kế toán (cấu hình kế hoạch, tính, duyệt, mở lại, hủy, điều chỉnh); HR xem. Tab "Hoa hồng" chỉ hiện với vai trò được xem.

**Kích hoạt.** Hằng tháng trước khi chạy lương.

**Cấu hình (tab Hoa hồng > Kế hoạch).**
- Kế hoạch (`comm_plan`): công ty con, hiệu lực; cơ sở R doanh thu thuần chưa thuế / G lãi gộp ước tính / Q số lượng; ghi nhận I khi xuất hóa đơn / P khi thu tiền (tỷ lệ thu trong kỳ); người được ghi nhận R NV kinh doanh trên chứng từ / T đội bán theo % đóng góp / F trường tùy chỉnh; cửa sổ M tháng / Q lũy kế quý / Y lũy kế năm (true-up: trừ phần đã trả các kỳ trước); trừ hàng trả lại; clawback N ngày; loại dòng bỏ qua; loại thu nhập của bảng lương (bắt buộc); ngưỡng % đạt tối thiểu; trần mỗi kỳ; draw N không / R ứng trước có thu hồi / G bảo đảm tối thiểu; hoa hồng quản lý (% trên doanh số B hoặc hoa hồng C của cấp dưới trực tiếp); nguồn dữ liệu N NetSuite / X dữ liệu ngoài / B cả hai; trường nhóm hàng tùy chỉnh.
- Thành phần (`comm_rule`): bộ lọc mặt hàng, loại mặt hàng, mã hàng, nhóm hàng, class, phòng ban, địa điểm, nhóm khách, phạm vi khách (A tất cả / N khách mới / E khách cũ, số ngày khách mới mặc định 90); phương pháp **P** tỷ lệ cố định, **G** thang lũy tiến theo giá trị, **S** thang bậc toàn phần, **A** theo % đạt chỉ tiêu, **U** đơn giá trên số lượng, **B** thưởng mốc. Bậc thang (`comm_tier`).
- Phân công (`comm_assign`): nhân viên vào kế hoạch, chỉ tiêu tháng, quản lý; chỉ tiêu riêng theo tháng (`comm_quota`).
- Doanh số ngoài (`comm_txn`): nạp bằng dán từ Excel / CSV có xem trước và kiểm lỗi, CSV Import hoặc REST; khóa chống trùng công ty + hệ thống nguồn + số chứng từ + dòng.

**Chuỗi tính (core `CommissionEngine`).** Dòng nguồn -> lọc -> ghi nhận (credit) theo phân công hiệu lực -> cơ sở dòng (credit memo mang dấu âm) -> % đạt = cơ sở cửa sổ / chỉ tiêu cửa sổ x 100 -> áp phương pháp từng thành phần (cổng ngưỡng % đạt cho P/G/S/A/U) -> true-up -> hoa hồng quản lý -> điều chỉnh tay -> trần -> draw -> số phải trả (không âm; phần âm do clawback thành số dư ứng trước) -> phân bổ chi phí theo tỷ trọng cơ sở của từng phân đoạn (phòng ban, class, địa điểm, dự án). Mỗi bước có diễn giải song ngữ; tab Mô phỏng tính thử what-if.

**Trạng thái bảng tính (`comm_run`).** **D nháp đã tính -> (Duyệt) A đã duyệt -> (ghi sổ bảng lương) P đã vào bảng lương.** Mở lại A -> D (cấm khi P). Hủy = inactive kèm lý do (cấm khi P). Đảo bảng lương trả P -> A. Tính lại khi đã A phải mở lại trước.

**Nối bảng lương.** Khi tính lương, kết quả của bảng tính A (hoặc P của chính bảng lương) cùng công ty con, có ngày cuối trong kỳ lương, được gộp theo nhân viên + loại thu nhập thành dòng thu nhập nguồn C (số lượng 1, đơn giá = số tiền), miễn thuế theo cách tính thuế của loại thu nhập; chi phí đi theo phân đoạn doanh thu.

**Kiểm soát.** Điều chỉnh tay bắt buộc lý do; dòng doanh số ngoài đã dùng trong bảng tính đã duyệt bị khóa sửa; chỉ đọc giao dịch qua truy vấn cố định. Chưa thấy kiểm tra người tính khác người duyệt bảng tính hoa hồng (cùng vai trò kế toán làm được cả hai) (chưa xác minh có chủ đích).

**Bản in.** Bảng hoa hồng (`doc=commission`, VP646000).

---

## 7. Tạm ứng lương và cấn trừ

**Mục đích.** Chi tạm ứng cho nhân viên trong kỳ và tự cấn trừ vào lương.

**Vai trò.** HR / kế toán lập phiếu; chỉ kế toán ghi sổ tạm ứng.

**Kích hoạt.** Khi phát sinh tạm ứng; đơn công tác có số tiền tạm ứng được duyệt.

**Trạng thái phiếu (`advance`, mã TU).** **H Tạm giữ -> (Bỏ tạm giữ, bắt buộc tài khoản tiền) B Chờ ghi sổ -> (Ghi sổ) O Đang cấn trừ -> C Đã tất toán (số dư = 0).**

**Các bước (tab Tạm ứng).**
1. Lập phiếu: công ty con, nhân viên, ngày, số tiền > 0, tài khoản tiền, dự án (tùy chọn), diễn giải.
2. Bỏ tạm giữ -> B.
3. Kế toán **Ghi sổ** (`releaseAdvance`): Journal Entry **Nợ 141 (gắn dự án) / Có tài khoản tiền**; số dư = số tiền; trạng thái O.
4. Khi tính lương: lấy phiếu O của nhân viên, cùng công ty con, ngày phiếu <= cuối kỳ, số dư > 0, trừ phần đang cấn ở bảng lương khác đã tính chưa ghi sổ. Cấn trừ **FIFO theo ngày rồi số phiếu**, không vượt thực lĩnh trước tạm ứng (không làm âm), không vượt số dư từng phiếu. Phần còn lại chuyển kỳ sau (cảnh báo "Còn ... tạm ứng chưa cấn trừ, chuyển sang kỳ sau"). Trần cấn trừ mỗi kỳ có trong lõi nhưng chưa truyền (không giới hạn).
5. Khi ghi sổ bảng lương: kiểm tra số dư tạm ứng không đổi kể từ lúc tính (đổi thì bắt tính lại); bút toán lương **Có 141** theo từng phiếu; giảm số dư, lưu lịch sử cấn trừ theo bảng lương; về 0 thì C.
6. Đảo bảng lương: hoàn số đã cấn của chính bảng đó, phiếu về O.

**Kiểm soát.** User Event chặn sửa trực tiếp trạng thái, số đã cấn, số dư, bút toán, lịch sử của phiếu; HR không có quyền ghi sổ tạm ứng.

---

## 8. Chạy lương tháng

**Mục đích.** Lập, tính, soát, duyệt và ghi sổ bảng lương của một kỳ và một nhóm lương.

**Vai trò.** HR (tạo, nạp, nhập tay, tính, soát cảnh báo, gửi duyệt), người duyệt (kế toán trưởng / giám đốc theo cấp duyệt, hoặc HR / kế toán khi duyệt một cấp), kế toán (ghi sổ, bill, file ngân hàng, đảo).

**Kích hoạt.** Cuối mỗi kỳ lương (tháng; hoặc nửa tháng / tuần với nhóm lương tương ứng).

### 8.1 Trạng thái bảng lương (`batch`, mã BL)
**H Tạm giữ, B Chờ tính, C Đã tính, P Chờ duyệt, A Đã duyệt, J Từ chối, R Đã ghi sổ, V Đã đảo.**

| Thao tác | Từ -> đến | Điều kiện chính |
| --- | --- | --- |
| Tạo bảng lương | -> H | Kỳ chưa đóng, công ty con đã bật lương; tháng tính thuế lấy theo kỳ |
| Nạp nhân viên, nhập tay, sửa công, nạp giờ, tính | giữ H; B <-> C | Không sửa ở A, P, R, V, J; sửa dữ liệu làm mất cờ "đã tính" (C -> B) |
| Tính lương | B -> C (lỗi thì B); H giữ H | Kỳ mở; nếu bắt buộc khóa công thì kỳ công phải L |
| Bỏ tạm giữ | H -> C (nếu đã tính) hoặc B | |
| Tạm giữ | B / C -> H | |
| Gửi duyệt (`submitRun`) | C -> P | Đã tính, không có tác vụ nền, kỳ mở |
| Duyệt | C / P -> A (nhiều cấp: chỉ khi đủ cấp và đang P) | Không còn cảnh báo mức lỗi, dấu dữ liệu khớp |
| Từ chối | C / P -> J | Nhiều cấp: chỉ người duyệt của cấp đang chờ |
| Mở lại | mọi trạng thái trừ R, V -> H | Xóa người duyệt, kết thúc lượt duyệt |
| Ghi sổ | A (hoặc C khi tắt bắt buộc duyệt) -> R | Chỉ kế toán / Administrator |
| Đảo | R -> V | Không còn bill cơ quan thu hiệu lực |

### 8.2 Các bước
1. **Tạo bảng lương** (tab Chạy lương): chọn công ty con, kỳ; ngày chứng từ mặc định = ngày cuối kỳ.
2. **Nạp nhân viên** (`loadEmployees`): hồ sơ cùng công ty con và nhóm lương, đang hoạt động hoặc nghỉ việc trong kỳ, có làm việc trong kỳ, **chưa nằm trong bảng lương chưa đảo khác của cùng kỳ** (bị bỏ qua và liệt kê). Công lấy từ bảng tổng hợp công nếu có; không có thì công chuẩn trừ ngày ngoài hợp đồng. Chạy lại cập nhật công cho dòng đã có. Bảng lớn chạy theo lượt. Sau đó tự nạp giờ công từ Time.
3. **Nhập tay** trong tab Thu nhập hoặc Khấu trừ khác của từng nhân viên (record `batch_input`): thu nhập (loại thu nhập, số lượng, đơn giá, hệ số hoặc số tiền tự nhập; tùy chọn dự án, phòng ban, class, địa điểm làm đích chi phí riêng) hoặc khấu trừ sau thuế (mã, diễn giải, số tiền, tài khoản). Sửa ngày công (0 đến 2 lần công chuẩn), giảm trừ khác khi tính thuế (không âm).
4. **Tính lương** (`calculate`; bảng trên 120 người tự chạy Map/Reduce theo lô). Thứ tự cố định cho mỗi nhân viên (core `PayrollEngine`):
   1. Dữ kiện: công chuẩn (dòng -> kỳ -> nhóm lương; không có mặc định 26, thiếu thì lỗi), công thực tế, giờ / ngày (mặc định 8), giờ thường từ Time.
   2. Quy tắc thu nhập (mục 8.3).
   3. OT và làm đêm từ giờ (mục 8.4).
   4. Trả phép khi nghỉ việc (mục 4).
   5. Dòng nhập tay; dòng hoa hồng đã duyệt (nguồn C).
   6. Lõi phiếu lương: tổng thu nhập -> thu nhập miễn thuế -> bảo hiểm -> thuế TNCN -> khấu trừ khác -> cấn trừ tạm ứng (thứ tự theo luật, không cấu hình).
   7. Kiểm tra giới hạn OT (chỉ cảnh báo).
   8. Trích trước tháng 13, phân bổ chi phí.
   Kỳ tuần / nửa tháng: gộp tháng tính thuế (mục 10.4). Dòng lỗi (thiếu hồ sơ, thiếu lịch sử lương, lương dưới tối thiểu vùng, thiếu giấy phép khi bật chặn...) ghi lỗi và đưa số về 0; bảng còn dòng lỗi ở B.
5. **Soát** (tab Cần soát, màn Chi tiết cảnh báo): cảnh báo tính lại mỗi lần đọc, không lưu; chỉ lưu kết quả xử lý (record `check_result`: O chưa xử lý / A đã chấp nhận / R đã xử lý, người phụ trách, ghi chú, lịch sử). Cảnh báo đã đóng tự mở lại khi số liệu đổi.

   | Quy tắc | Mức | Nội dung |
   | --- | --- | --- |
   | NO_EMPLOYEES | lỗi | Bảng lương chưa có nhân viên |
   | CALC_ERROR | lỗi | Dòng tính không thành công |
   | MISSING_PROFILE | lỗi | Thiếu hồ sơ lương |
   | NET_NEGATIVE | lỗi | Thực lĩnh âm |
   | NET_ZERO | cảnh báo | Thực lĩnh bằng 0 |
   | NO_HOURS | cảnh báo | Lương giờ chưa có giờ công |
   | NO_ATTENDANCE | cảnh báo | Công hưởng lương = 0 |
   | NET_CHANGE | cảnh báo | Thực lĩnh lệch quá ngưỡng so với kỳ trước (mặc định 20%) |
   | INS_BELOW_MIN | cảnh báo | Lương đóng BH dưới mức tối thiểu theo vùng |
   | MISSING_TAX_CODE | cảnh báo | Thiếu MST cá nhân |
   | MISSING_BANK | cảnh báo | Thiếu ngân hàng / số tài khoản |
   | LEFT_BEFORE_PERIOD | cảnh báo | Đã nghỉ việc trước kỳ mà vẫn trong bảng |
   | NEW_EMPLOYEE, LEAVER, NOT_IN_BATCH | thông tin | Nhân viên mới, nghỉ trong kỳ, có ở kỳ trước nhưng không có kỳ này |
   | ATT_NOT_LOCKED | thông tin | Công của kỳ chưa khóa |

   Mức lỗi chặn duyệt (không đóng tay được, phải sửa dữ liệu và tính lại); mức cảnh báo cần chấp nhận kèm ghi chú hoặc xử lý nhưng không chặn duyệt; mức thông tin chỉ để biết. Ngoài ra cảnh báo của lõi trên từng dòng: giấy phép lao động, vượt giới hạn OT, nghỉ từ ngưỡng ngày không đóng BH, thực lĩnh âm, tạm ứng chuyển kỳ sau, chưa khai loại thu nhập trả phép. Tab So kỳ trước so từng khoản.
6. **Bỏ tạm giữ** H -> C.
7. **Gửi duyệt và duyệt.**
   - Duyệt một cấp (không khai cấp duyệt): người có vai trò HR hoặc kế toán (hoặc Administrator) bấm Duyệt ở C hoặc P. Theo mã, quyền "approve" nằm trong cả hai vai trò và **không có kiểm tra người duyệt khác người lập** ở chế độ này (tách nhiệm vụ dựa vào tổ chức).
   - Duyệt nhiều cấp (khai `approval_step`): bắt buộc Gửi duyệt C -> P, rồi qua lần lượt từng cấp (`approveStep`). Quy tắc: người duyệt là nhân viên được khai hoặc người đăng nhập bằng vai trò được khai; **không phải người gửi duyệt của lượt; không phải người vừa duyệt cấp liền trước** (trừ khi cấp đang chờ chỉ có đúng một người đủ quyền là chính người đó - ghi "miễn tách nhiệm vụ"). Từ chối (bắt buộc ghi chú) hoặc mở lại kết thúc lượt; gửi lại bắt đầu từ cấp 1. Cấp cuối duyệt thì bảng sang A. Nhật ký duyệt (`approval_log`) chỉ thêm, không chứa số tiền.
   - Mọi lần duyệt kiểm tra: đã tính, kỳ mở, **dấu dữ liệu đầu vào (`calc_stamp`) khớp** (sửa dòng nhập, công, giảm trừ, giờ, phiếu sản lượng sau khi tính thì phải tính lại), không còn cảnh báo mức lỗi.
8. **Ghi sổ** (kế toán, `release`): kiểm tra không tạm giữ, đã tính, đã duyệt (hoặc C khi tắt "Bắt buộc duyệt bảng lương"), kỳ mở, dấu dữ liệu khớp, đã khai TK 334, số dư tạm ứng không đổi, tổng phân bổ = tổng thu nhập + BH DN. Tạo **một Journal Entry** cho bảng lương (mục 11), lưu id JE và chuyển R ngay, rồi chạy các bước sau JE (chạy lại được): cấn trừ tạm ứng, khóa đúng phiếu sản lượng đã dùng (C), đánh dấu bảng tính hoa hồng P, đánh dấu phiên bản bảng tỷ lệ đã dùng, ghi số liệu chi phí lao động (`cost_fact`). Lỗi ghi số liệu phân tích không làm hỏng ghi sổ (chỉ báo FACTS_OUTDATED để lập lại).
9. **Sau ghi sổ:** lập bill cơ quan thu, file chi lương, in phiếu lương, bảng thanh toán (mục 11, 12).
10. **Đóng kỳ** (Thiết lập > Kỳ lương): không đóng được khi kỳ còn bảng lương chưa R hoặc V.

### 8.3 Quy tắc thu nhập (record `earning_rule` + `rule_cond`)
Số tiền = Số lượng x Đơn giá x Hệ số [/ Ngày công chuẩn] x Hệ số điều kiện. Không có công thức tự do. Quy tắc áp theo nhóm lương, loại lương, loại lao động, hiệu lực tại ngày cuối kỳ; chạy theo thứ tự (Sequence, trống = 100, rồi mã).
- Nguồn số lượng: K hằng số 1; D ngày công; B theo loại lương (M, D: ngày công; H: giờ thường, không có giờ thì 0 hoặc ngày công x giờ / ngày nếu bật "lấy ngày công"); O thành tiền sản lượng (theo bảng đơn giá); J số ngày có mặt ở dự án (từ giờ công); S doanh số; E tiền của loại thu nhập cơ sở đã sinh trước; H số ca đã làm (theo loại ca).
- Nguồn đơn giá: F số cố định; S lương hợp đồng; A phụ cấp cố định; P gói phúc lợi (mỗi khoản một dòng theo loại thu nhập của khoản); Q số lượng là thành tiền; C phần trăm; T thang phần trăm (bảng đơn giá, P lũy tiến theo bậc / W toàn bộ theo bậc đạt).
- Chia ngày công: N không; A luôn chia (x ngày công / công chuẩn); M chỉ với lương tháng.
- Điều kiện (AND): D ngày công, U ngày nghỉ không lương, L số lần trễ sớm, A còn làm việc cuối kỳ, T thâm niên (tháng), P % đạt chỉ tiêu doanh số; so sánh >=, <=, =. Không đạt: N không trả, hoặc R giảm `reduction`% cho mỗi đơn vị vi phạm (không âm).
- Bộ mặc định (khi không khai quy tắc nào): BASE (lương cơ bản nhân viên E, số lượng B, đơn giá S, chia M), BASE-CTV (thù lao CTV, đơn giá S), ALLOWANCE (phụ cấp, D x A, chia M), BENEFIT (gói phúc lợi, D x P, chia M), MEAL (ăn ca, chỉ khi khai loại ăn ca và mức ăn ca > 0, số cố định, không chia).
- Lương giờ (H) không có giờ công và không có dòng nhập tay: cảnh báo "bấm Nạp giờ công".

### 8.4 Làm thêm giờ và làm đêm (core `OvertimeCalculator`, `EarningRuleEngine.timeEarnings`)
- Nguồn giờ OT: đơn OT đã duyệt có ngày làm trong kỳ (khi nguồn OT = R). Đơn OT tự xác định loại ngày (N / W / H) theo ngày nghỉ tuần và ngày lễ.
- Lương giờ: M = lương hợp đồng / (công chuẩn x giờ / ngày); D = lương ngày / giờ / ngày; H = lương giờ. Không làm tròn đơn giá, làm tròn số tiền một lần.
- Hệ số theo tham số pháp lý tại ngày cuối kỳ: OT ngày thường `OT.NORMAL_DAY`, nghỉ tuần `OT.WEEKLY_OFF`, lễ `OT.HOLIDAY`. Làm đêm không phải OT: 1 + `OT.NIGHT_PREMIUM` (chỉ sinh dòng phần phụ trội, miễn thuế toàn bộ phần phụ trội). OT ban đêm: hệ số OT + `OT.NIGHT_PREMIUM` + `OT.NIGHT_EXTRA` x hệ số nền (ngày thường: hệ số OT nếu loại thu nhập đánh dấu "đêm có OT ban ngày trước đó", nếu không thì 1; ngày nghỉ, lễ: hệ số OT).
- Số tiền = Round(lương giờ x giờ x hệ số); phần miễn thuế (cách tính thuế P) = số tiền - Round(lương giờ x giờ).
- Giới hạn `OT.LIMIT_MONTH` (xét theo bảng lương hiện tại), `OT.LIMIT_YEAR` hoặc `OT.LIMIT_YEAR_EXTENDED` (ngành được 300 giờ): **chỉ cảnh báo**, bằng giới hạn là hợp lệ. Lũy kế năm từ các bảng lương R cùng năm thuế.

### 8.5 Kiểm soát của bảng lương
- RESTlet kiểm tra vai trò và trạng thái phía máy chủ cho mọi thao tác; HR không có Ghi sổ, Đảo, Lập bill, Ghi sổ tạm ứng (cả nút và máy chủ).
- Một nhân viên chỉ ở một bảng lương chưa đảo của cùng kỳ.
- Dấu dữ liệu đầu vào kiểm khi duyệt và ghi sổ; User Event dòng nhập tay chặn sửa khi bảng ở A, P, R, V, J và đưa bảng về "chưa tính" khi sửa.
- User Event chặn sửa trực tiếp bảng lương, dòng nhân viên, dòng nhập tay, giờ công trên form NetSuite / CSV / web service.
- Khóa tác vụ nền trên bảng lương (một người xử lý tại một thời điểm); ghi sổ, đảo, lập bill chạy lại an toàn nhờ `externalid` duy nhất (`s4vp-rel-<id>`, `s4vp-rev-<id>`, `s4vp-bill-<id>-<vendor>`), không tạo JE thứ hai.
- Nhật ký thao tác (`audit_log`) cho mọi POST thành công: thời điểm UTC, người, thao tác, bảng lương / kỳ, dòng; không chứa số tiền, số định danh; chỉ thêm.

### 8.6 Sửa sai
- Chưa ghi sổ: **Mở lại** (về H, xóa duyệt) -> sửa dữ liệu nguồn hoặc dòng tay -> bỏ tạm giữ -> tính -> duyệt lại.
- Đã ghi sổ: void (hoặc xóa) bill cơ quan thu trên NetSuite -> **Đảo** (kế toán) -> lập bảng lương mới cùng kỳ (bảng đã đảo không chặn trùng nhân viên) -> nạp, tính, duyệt, ghi sổ. Chi tiết đảo ở mục 11.4.
- Kỳ tuần / nửa tháng: không đảo khi bảng lương kỳ sau cùng tháng thuế đã ghi sổ; phải đảo bảng kỳ sau trước.
- Truy lĩnh / truy đóng BH hồi tố, chứng từ khấu trừ TNCN: CHƯA LÀM (đặc tả 1.2.5).

---

## 9. Bảo hiểm bắt buộc và kinh phí công đoàn

**Mục đích.** Tính phần người lao động và phần doanh nghiệp của BHXH, BHYT, BHTN, BHTNLĐ-BNN, KPCĐ, đoàn phí trên lương đóng BH khai báo.

**Vai trò.** HR khai lương đóng BH, vùng, cờ tham gia; kế toán khai tài khoản 338x và cơ quan thu; KTT đối chiếu tỷ lệ.

**Quy tắc (core `InsuranceCalculator`), tra theo ngày cuối kỳ (kỳ nhiều lần trong tháng: cuối tháng thuế).**
1. Căn cứ đóng là **lương đóng BHXH trên lịch sử lương**, không phải thu nhập thực tế.
2. Vùng: hồ sơ, trống thì vùng mặc định. Vùng chưa khai tham số `MINWAGE.<vùng>` -> lỗi. **Lương đóng BH < lương tối thiểu vùng -> lỗi** (dòng không tính được). Kiểm tra vùng chạy trước kiểm tra ngưỡng ngày nghỉ.
3. Trần: căn cứ BHXH-BHYT = min(lương đóng, `INS.REFERENCE_WAGE` x `INS.SI_CAP_MULTIPLIER`); căn cứ BHTN = min(lương đóng, `MINWAGE.<vùng>` x `INS.UI_CAP_MULTIPLIER`).
4. Ngày nghỉ xét BH (nghỉ không lương + nghỉ BHXH, gồm ngày ngoài hợp đồng) >= `INS.ABSENCE_DAYS_THRESHOLD` -> **không tính mọi khoản trích của tháng** (kể cả KPCĐ) và cảnh báo "lập báo giảm".
5. Từng khoản trích (record `ins_comp`, có ngày hiệu lực): tỷ lệ NLĐ, tỷ lệ DN, cơ sở đóng S (lương đóng BHXH) hoặc U (lương đóng BHTN), "chỉ đoàn viên", hệ số trần NLĐ (x mức tham chiếu). Mặc định nạp sẵn: BHXH_HT, BHXH_OD, BHTNLD (cơ sở S), BHYT (S), BHTN (U), KPCD (DN đóng, S), DOANPHI (NLĐ đoàn viên, trần theo hệ số x mức tham chiếu). Tỷ lệ là tham số pháp lý.
6. Loại trừ: CTV (loại C) không BH; cờ "Tham gia BHXH, BHYT" tắt -> không tính khoản nào; "Tham gia BHTN" tắt -> bỏ BHTN; KPCĐ bỏ khi thiết lập "DN đóng KPCĐ" tắt (công ty con ghi đè được); DOANPHI chỉ đoàn viên.
7. Tỷ lệ BHTNLĐ ghi đè (thiết lập chung / công ty) thay tỷ lệ DN của BHTNLD.
8. Làm tròn từng khoản riêng phần NLĐ và DN rồi mới cộng. BH NLĐ trừ khi tính thuế không gồm đoàn phí; thực lĩnh trừ toàn bộ BH NLĐ gồm đoàn phí.

**Đầu ra.** Dòng BH theo khoản trong chi tiết dòng lương (tab Bảo hiểm); bút toán Có 338x theo khoản (NLĐ + DN); bill cơ quan thu theo vendor; báo cáo BH tháng và D02-LT (mục 13).

**Người nước ngoài.** Gói không có quy tắc BH riêng cho người nước ngoài; dùng cờ tham gia BH trên hồ sơ (chưa xác minh đủ cho mọi trường hợp theo luật).

---

## 10. Thuế TNCN

**Mục đích.** Khấu trừ thuế TNCN mỗi kỳ chi trả và cung cấp số liệu kê khai quý, quyết toán năm.

**Vai trò.** HR khai cách tính thuế, người phụ thuộc, cam kết; kế toán kê khai, nộp.

### 10.1 Thu nhập miễn thuế (theo dòng, theo loại thu nhập)
- E: miễn toàn bộ. P: miễn phần chênh (OT, đêm) đã tính trên dòng. C: miễn đến trần tham số (mặc định `PIT.MEAL_EXEMPT_CAP`), cộng dồn theo mã trần trong tháng. T: chịu thuế.
- Thu nhập chịu thuế = max(0, tổng thu nhập - miễn thuế).

### 10.2 Cách tính theo hồ sơ (`pit_method`)
- **P - Lũy tiến** (mặc định; trống hoặc mã lạ cũng là P): Thu nhập tính thuế = max(0, thu nhập chịu thuế - BH bắt buộc NLĐ (không gồm đoàn phí) - `PIT.SELF_DEDUCTION` - `PIT.DEPENDENT_DEDUCTION` x số người phụ thuộc - giảm trừ khác). Thuế = biểu lũy tiến tháng (record `pit_bracket` hiệu lực ngày cuối kỳ), thuế từng bậc không làm tròn, cộng rồi làm tròn một lần. Người phụ thuộc được tính trọn tháng khi khoảng giảm trừ giao với kỳ. Giảm trừ khác (từ thiện, hưu trí tự nguyện) nhập trên dòng, không âm.
- **F - Khấu trừ 10%** (CTV, thu nhập vãng lai): thuế = Round(thu nhập chịu thuế x `PIT.FLAT_RATE`), bằng 0 khi có cam kết 08/CK-TNCN hoặc thu nhập < `PIT.FLAT_THRESHOLD`. Xét **theo từng lần chi**, không cộng dồn các lần chi trong tháng.
- **N - Không cư trú**: thuế = Round(thu nhập chịu thuế x `PIT.NONRESIDENT_RATE`). Áp cho người nước ngoài không cư trú khi HR chọn N (gói không tự xác định tình trạng cư trú).
- **X - Không khấu trừ**: thuế 0; thu nhập tính thuế ghi 0.

### 10.3 Thời điểm khấu trừ
Chỉ hỗ trợ "L - Kỳ cuối tháng" (khấu trừ BH, thuế ở kỳ cuối tháng). Lựa chọn T (tạm khấu trừ từng kỳ) và A (kỳ giữa tháng là tạm ứng): CHƯA hỗ trợ.

### 10.4 Gộp tháng tính thuế (kỳ tuần / nửa tháng, core `TaxMonthAggregator`)
- Kỳ giữa tháng: chỉ trả thu nhập, trừ khấu trừ khác, cấn trừ tạm ứng; không BH, không thuế.
- Kỳ cuối tháng: tính BH và thuế cho cả tháng trên thu nhập gộp các bảng lương trước cùng tháng thuế (đã tính, chưa đảo) cộng kỳ này, ngày nghỉ và giảm trừ khác cộng dồn.
- Người không BH và cách tính F hoặc N: xét theo từng lần chi.

### 10.5 Đầu ra và quyết toán
- Bút toán Có 3335; bill cho nhà cung cấp "Cơ quan thuế".
- Báo cáo: 05/KK-TNCN quý (chỉ tiêu [16] - [32] và danh sách cá nhân; các chỉ tiêu [24], [25], [32] ghi "chưa tính"), phiếu số liệu nhập HTKK (05kk), sổ theo dõi thuế TNCN đã khấu trừ theo nhân viên 12 tháng, quyết toán năm 05-1/BK (HĐLĐ từ 3 tháng) và 05-2/BK (cá nhân khác), phiếu số liệu 05/QTT (cột theo gói Acumatica, chưa đối chiếu phụ lục mẫu pháp lý).
- Nguồn số liệu: dòng nhân viên của bảng lương đã tính, không đảo (tùy chọn chỉ bảng đã ghi sổ); kỳ quy về tháng tính thuế.
- **Tính lại thuế năm, xác định số nộp thêm / hoàn, chứng từ khấu trừ thuế TNCN, xuất XML HTKK: CHƯA LÀM** (lõi đã có hàm thuế năm `calculateAnnualProgressive` với cận trên x 12 nhưng chưa dùng ở màn hình nào).

---

## 11. Hạch toán kế toán và phân bổ chi phí

**Mục đích.** Ghi chi phí lương rất chi tiết theo tài khoản, phòng ban, dự án, địa điểm, class và ghi nhận các khoản phải trả.

**Vai trò.** Kế toán (ghi sổ, đảo, bill), kế toán trưởng (khai tài khoản, quy tắc tài khoản theo đích).

### 11.1 Phân bổ chi phí (core `AllocationSourceResolver`, `CostAllocationBuilder`)
Bất biến: **tổng dòng phân bổ = tổng thu nhập + BH phần DN** (kiểm lại khi ghi sổ). Trích tháng 13 không nằm trong phân bổ nhưng được chia theo cơ cấu phân bổ (11.3).

Thứ tự:
1. Thu nhập có đích riêng ("nguồn nào đích đó"): hoa hồng (theo phân đoạn doanh thu), dòng nhập tay có địa điểm / class / phòng ban, thu nhập sản lượng nguồn O và doanh số S (theo phiếu).
2. Dòng OT có dự án (khi phương pháp không phải timesheet).
3. Phần còn lại của tổng thu nhập (GROSS) và BH DN (ERINS) chia theo đích của phương pháp phân bổ: **S** theo thiết lập (thiết lập mặc định F), **T** giờ timesheet, **F** bảng tỷ lệ cố định có phiên bản, **R** ngày phân ca. Dự phòng: **P** bảng tỷ lệ rồi dự án mặc định, **D** dự án mặc định. Chế độ phiên bản: **E** phiên bản hiệu lực cuối kỳ, **D** chia theo số ngày lịch của từng phiên bản. BH DN không đi theo "nguồn nào đích đó".

Phòng ban của dòng: đích có phòng ban riêng (dòng bảng tỷ lệ, dòng nhập tay, phiếu sản lượng) thì theo phòng ban đó; không có thì phòng ban của hồ sơ lương (không có thì của Employee).

**Tài khoản chi phí của dòng, theo thứ tự ưu tiên** (`resolveAccount`):
1. Class (work center) của dòng
2. Dự án của dòng
3. Phòng ban riêng của dòng
4. Tài khoản chi phí trên hồ sơ lương
5. Phòng ban của nhân viên (chỉ khi dòng không có phòng ban riêng)
6. Tài khoản chi phí mặc định của thiết lập

Mức 1, 2, 3, 5 tra record `cost_account`: theo (đích, loại lao động của nhân viên) trước rồi (đích, mọi loại); bản ghi của công ty con cụ thể thắng bản ghi dùng chung; lấy bản hiệu lực muộn nhất không sau ngày cuối kỳ; bản ghi inactive hoặc trỏ tới tài khoản inactive bị bỏ qua. Không khai gì thì kết quả như cũ (hồ sơ -> mặc định). Gói không gắn cứng số hiệu 622, 627, 641, 642: kế toán khai.

Ánh xạ chiều NetSuite: tiểu khoản -> Department; chi nhánh -> Location; work center -> Class; dự án -> entity (Customer:Project) của dòng JE. Task, cost code: chưa ánh xạ. Bút toán liên công ty: chưa làm.

### 11.2 Bút toán ghi sổ bảng lương (một Journal Entry, ngày = ngày chứng từ bảng lương)
| Bên | Tài khoản | Nội dung |
| --- | --- | --- |
| Nợ | TK chi phí theo dòng phân bổ (kèm phòng ban, địa điểm, class, dự án) | "Chi phí lương" (nhân viên), "Thù lao cộng tác viên" (CTV), "BH, KPCĐ doanh nghiệp đóng" (ERINS) |
| Nợ | TK chi phí theo dòng chia trích tháng 13 | "Trích trước lương tháng 13" |
| Có | 334 | Tổng thực lĩnh nhân viên E |
| Có | Phải trả CTV (3388 / 331) | Tổng thực lĩnh CTV (bắt buộc khai khi có CTV) |
| Có | 338x theo khoản trích | Phần NLĐ + DN của từng khoản |
| Có | 3335 | Thuế TNCN đã khấu trừ |
| Có | TK khấu trừ khác (TK trên dòng khấu trừ, trống thì TK mặc định) | Từng khoản khấu trừ |
| Có | 141 | Cấn trừ tạm ứng theo từng phiếu |
| Có | 335 | Tổng trích trước tháng 13 |

Quy tắc: gộp dòng cùng (tài khoản, phòng ban, dự án, task, cost code, diễn giải, địa điểm, class); bỏ dòng 0; thiếu tài khoản -> lỗi nêu diễn giải; không cân -> lỗi. Thực lĩnh trong bút toán đã trừ cấn trừ tạm ứng. Diễn giải theo ngôn ngữ người ghi sổ. Địa điểm trống dùng "Địa điểm mặc định cho chứng từ". Khi account bật duyệt bút toán / bill và thiết lập "Tự duyệt" bật, JE và bill tạo ở trạng thái đã duyệt; tắt thì JE / bill chờ người có quyền duyệt (hệ thống cảnh báo "chưa vào sổ cái cho tới khi được duyệt"). Bút toán đi qua User Event tách đối ứng của gói TT99 nếu có.

### 11.3 Trích trước lương tháng 13
- Điều kiện: dòng có cờ "Có trích trước tháng 13" (lấy từ hồ sơ khi nạp), không phải CTV.
- Số trích = Round(cơ sở / số tháng). Cơ sở = (lương hợp đồng nếu lương tháng M, lương ngày / giờ thì 0) + (tổng gói phúc lợi / tháng nếu cơ sở P; cơ sở C chỉ lương HĐ). Số tháng = thiết lập công ty, trống hoặc 0 thì 12. Không phụ thuộc ngày công; không đổi tổng thu nhập, thực lĩnh.
- Hạch toán: Nợ chi phí chia theo cơ cấu phân bổ GROSS của chính nhân viên (tài khoản, phòng ban, dự án, địa điểm, class; làm tròn dồn vào nhóm lớn nhất) / Có 335. Bảng lương tính trước khi có quy tắc chia: Nợ TK chi phí của hồ sơ (hoặc mặc định).
- **Chi trả lương tháng 13 và tất toán 335 (Nợ 335): CHƯA thấy luồng trong mã** - khoản chi thực tế nhập như dòng thu nhập (ví dụ THUONG) sẽ ghi Nợ chi phí theo phân bổ; xử lý số dư 335 hiện phải làm bằng bút toán thủ công (chưa xác minh với KTT).

### 11.4 Đảo bảng lương (kế toán, `reverse`)
1. Điều kiện: bảng R có JE; không còn bill cơ quan thu hiệu lực (void trước); kỳ tuần / nửa tháng không có bảng kỳ sau cùng tháng thuế đã ghi sổ.
2. Tạo JE đảo (ngày hôm nay): từng dòng gốc đảo Nợ / Có, giữ tài khoản, phòng ban, địa điểm, class, dự án, diễn giải "Đảo bảng lương ...". Bảng -> V.
3. Sau JE đảo (chạy lại được): phiếu sản lượng về A, bảng tính hoa hồng P -> A, hoàn số đã cấn tạm ứng (phiếu về O), dòng `cost_fact` của bảng bỏ cờ còn hiệu lực (không xóa).
4. Lập bảng lương mới cùng kỳ để chạy lại.

### 11.5 Bill cơ quan thu (kế toán, `agencyBills`, chỉ bảng R)
- Gom theo nhà cung cấp: mỗi khoản trích (phần NLĐ + DN) lên bill của vendor khai trên khoản trích, dòng chi phí = TK 338x của khoản; thuế TNCN lên bill của "Cơ quan thuế" với TK 3335. Khoản thiếu vendor bị bỏ qua và báo. Số hiệu bill = số bảng lương; ngày = hôm nay; địa điểm mặc định nếu có.
- Lập lại được khi lần trước lỗi giữa chừng (bỏ qua vendor đã có bill); đã đủ thì báo "Đã lập bill". Bill tự duyệt theo thiết lập.
- Còn bill hiệu lực thì không đảo được bảng lương.

**Màn hình.** Chạy lương > tab Bút toán (xem trước JE trước khi ghi sổ, `journalPreview`; sau ghi sổ mở JE), tab Bill cơ quan thu, tab Phân bổ dự án của từng nhân viên; Thiết lập > Tài khoản, Tài khoản chi phí theo đích.

---

## 12. Chi trả

**Mục đích.** Chuyển tiền lương và cung cấp chứng từ cho người lao động.

**Vai trò.** Kế toán (file ngân hàng, bảng thanh toán), HR (phiếu lương), nhân viên (tự in phiếu lương).

1. **File chi lương ngân hàng** (`bankFile`, bảng A hoặc R): CSV UTF-8 có BOM, cột STT, Mã NV, Họ tên, Số tài khoản, Ngân hàng, Số tiền, Nội dung (theo tháng thuế MM/yyyy); tên file `ChiLuong_<số bảng>_<kỳ>.csv`; chỉ người có thực lĩnh > 0, sắp theo mã nhân viên; **thiếu số tài khoản -> lỗi liệt kê mã nhân viên** (người trả tiền mặt cần xử lý ngoài file). Định dạng riêng từng ngân hàng: CHƯA LÀM (chỉ một mẫu CSV chung). Bút toán thanh toán (Nợ 334 / Có tiền): làm trên NetSuite theo nghiệp vụ chuẩn, gói không tạo (chưa xác minh có chủ đích).
2. **Phiếu lương** (`doc=payslip`, VP641000): PDF, tiếng Việt, tiếng Anh hoặc song ngữ; chỉ nhân viên E; một người một trang; thu nhập, khấu trừ (BH NLĐ, thuế, khấu trừ khác, cấn trừ), phần thuế, thực lĩnh bằng chữ.
3. **Bảng thanh toán tiền lương** (`doc=payment`, VP643000): A4 ngang, chỉ nhân viên E, dòng tổng, thực lĩnh bằng chữ, chữ ký người lập biểu, kế toán trưởng, giám đốc (khai theo công ty con).
4. **Quyết toán CTV** (`doc=contractor`, VP644000) và **Bảng kê xác nhận thù lao CTV** (`doc=contractorStatement`, mỗi người một trang).
5. Bản in có số tiền chỉ cho Administrator và hai vai trò lương; không ghi số tiền, số định danh vào log.

---

## 13. Báo cáo và kê khai (tab Báo cáo - tờ khai)

Danh mục thực có (`reportsCatalog`): nguồn là dòng lương đã tính, không đảo; tùy chọn "chỉ đã ghi sổ"; xuất CSV.

| Báo cáo | Chu kỳ | Nội dung |
| --- | --- | --- |
| BH phải nộp + D02-LT (`insurance`) | Tháng | Theo nhân viên: số sổ BHXH, lương đóng, BH NLĐ / DN theo nhóm; nhập số trên thông báo C12-TS để xem chênh lệch. D02-LT: mã biến động TM (tăng mới), ON, GH (giảm hẳn), KL (nghỉ không lương / không đóng), DC (điều chỉnh lương) suy từ so sánh tháng này với tháng trước |
| Chi phí nhân sự theo tài khoản (`cost`, VP405000) | Tháng | Lương, BH DN, trích tháng 13, phí CTV theo tài khoản / phòng ban, so với dòng JE của bảng lương, ra chênh lệch (chỉ bảng đã ghi sổ) |
| Quỹ lương (`fund`) | Tháng / quý | Theo phòng ban x loại lao động (phòng ban hiện tại của hồ sơ, không phải lúc tính) |
| 05/KK-TNCN (`pitq`, VP403000) + phiếu số liệu HTKK | Quý | Chỉ tiêu [16] - [32] và danh sách cá nhân |
| Sổ theo dõi thuế TNCN (`pitLedger`) | Năm | Thuế đã khấu trừ theo nhân viên, 12 tháng |
| Quyết toán TNCN năm (`pita`, VP404000) + phiếu 05/QTT | Năm | 05-1/BK, 05-2/BK |
| Bản in (`print`) | Theo bảng | Phiếu lương, bảng thanh toán, quyết toán CTV, bảng kê CTV, bảng chấm công tháng (VP642000, A4 ngang, theo bộ phận, tối đa 500 người / file), bảng chia lương tổ, bảng hoa hồng, phiếu thông tin hợp đồng / quyết định |

Bản quản trị (lọc theo chiều) cần ghi rõ không dùng để nộp theo nguyên tắc chung của gói (mức áp dụng trên từng báo cáo: chưa xác minh).

**Chưa làm.** Xuất XML HTKK; mẫu báo cáo tình hình đóng BHXH dạng nộp cơ quan BHXH ngoài D02-LT (chưa xác minh); GI / dashboard / saved search kiểu VP409000 - VP409110 của bản Acumatica (thay một phần bằng Trang chủ và Phân tích chi phí); hạn nộp theo luật trên Trang chủ chỉ hiện khi được truyền từ thiết lập (chưa có dữ liệu hạn luật nạp sẵn).

---

## 14. Phân tích chi phí lao động (tab Phân tích chi phí)

**Mục đích.** Khai thác hạch toán chi tiết để phân tích biến động chi phí lao động so với doanh thu, giá vốn và lãi lỗ.

**Vai trò.** Kế toán, CFO (route vai trò kế toán); HR chỉ xem record số liệu.

**Dữ liệu.** Record `cost_fact` ghi khi ghi sổ bảng lương: mỗi dòng = bảng lương x tháng kế toán (theo ngày JE) x tài khoản x phòng ban x class x địa điểm x dự án x loại lao động (E / C) x thành phần. Thành phần: wages (lương, nhóm B), overtime (O), allowance (A, M), bonus (N), piecework (P), other (X), employerIns (BH, KPCĐ DN), accrued13, contractor (mọi chi phí CTV). Tổng dòng của một bảng = tổng Nợ chi phí của JE. Đảo bảng lương: bỏ cờ còn hiệu lực, không xóa. Lập lại số liệu (`rebuildLaborFacts`) khi bị báo FACTS_OUTDATED.

**Màn hình.** Thẻ chỉ số (tổng chi phí lao động, tỷ lệ trên doanh thu, phần trong giá vốn, phần trong chi phí hoạt động, số người, chi phí / người, tỷ trọng OT, chi phí / giờ; so kỳ trước và cùng kỳ năm trước), xu hướng 12 tháng, cầu biến động (số người, mức lương bình quân, OT, phụ cấp, thưởng, khoán, khác, BH DN, tháng 13, CTV), phân rã theo phòng ban / dự án / class / địa điểm / tài khoản / thành phần / loại lao động có ô tìm và xem tới nhân viên, lãi lỗ tách phần lao động, đối chiếu với sổ cái theo tài khoản.

**Quy tắc.** Lao động trong giá vốn hay chi phí hoạt động xác định theo **loại tài khoản NetSuite** của tài khoản chi phí (COGS -> giá vốn, còn lại -> chi phí hoạt động), không theo số hiệu tài khoản. Vai trò không có quyền đọc giao dịch thì phần sổ cái để trống (ghi chú NO_GL_ACCESS). Hoa hồng đi vào thành phần theo nhóm của loại thu nhập hoa hồng (chưa có thành phần "commission" riêng).

---

## 15. Cổng tự phục vụ nhân viên

**Mục đích.** Nhân viên tự xem lương, phép và lập đơn.

**Cách truy cập.** Suitelet "Lương của tôi" (`customscript_s4vp_sl_my_payroll`, dùng được trên điện thoại) và portlet "S4VP My Payroll" trên dashboard Employee Center (nhúng tab Tổng quan).

**Chức năng.**
1. Tổng quan: biến động thu nhập 12 kỳ đã ghi sổ (tổng thu nhập, thực lĩnh), thực lĩnh kỳ gần nhất so kỳ trước, bình quân 6 kỳ, thuế đã khấu trừ trong năm; dòng thời gian lương, quyết định đã áp dụng, hợp đồng; người phụ thuộc (MST che); việc của tôi (đơn đang xử lý, phép còn lại, hạn phép chuyển, hợp đồng hết hạn trong 60 ngày).
2. Phiếu lương: chỉ bảng lương **R đã ghi sổ** của chính mình, lọc năm theo tháng tính thuế; in PDF phiếu lương của mình.
3. Phép: số dư theo năm.
4. Đơn: lập đơn nghỉ, OT, công tác (trường giới hạn); Lưu (H) -> Gửi duyệt (P). Không qua kiểm tra thì đơn ở lại H để sửa. Nhân viên chỉ tự hủy đơn đang P; đơn đã duyệt do HR hủy. Phiếu ngoại lệ chấm công không lập từ cổng.
5. Thông tin của tôi: MST, tài khoản, CCCD, sổ BHXH chỉ hiện dạng che.

**Kiểm soát.** Nhân viên xác định lại từ người đăng nhập ở mỗi lượt gọi; tham số nhân viên khác bị từ chối; chứng từ của người khác trả "không tìm thấy"; POST cần mã phiên của trang (chống gửi chéo trang); Suitelet chạy bằng vai trò ẩn `customrole_s4vp_selfservice` (không gán cho người dùng; chỉ ghi được đơn, số dư phép, nhật ký); không ghi số tiền vào log.

**Chưa làm.** Ứng dụng mobile riêng, màn công chi tiết theo ngày của tôi (VP602000), đơn ngoại lệ chấm công tự phục vụ; chưa thử với tài khoản Employee Center thật (DOI_CHIEU, chưa xác minh lại sau bản 11/11/2026).

---

## 16. Kiểm soát nội bộ và phân quyền

| Kiểm soát | Cách thực hiện |
| --- | --- |
| Phân quyền theo vai trò | Record dùng danh sách quyền (USEPERMISSIONLIST): thiết lập HR toàn quyền / kế toán xem; bảng lương cả hai toàn quyền; hồ sơ HR toàn quyền / kế toán xem; cấp duyệt, tài khoản chi phí theo đích, hoa hồng: kế toán sửa, HR xem |
| Allow-list thao tác trên RESTlet | POST mặc định từ chối; HR: thao tác thiết lập, hồ sơ, chấm công, bảng lương đến duyệt; kế toán: thao tác bảng lương + ghi sổ, đảo, bill, ghi sổ tạm ứng; Administrator: thêm tạo dữ liệu thử, xóa cờ tác vụ treo |
| Tách nhiệm vụ | HR không ghi sổ / đảo / lập bill / ghi sổ tạm ứng; không tự duyệt đơn của mình; duyệt nhiều cấp: người gửi không duyệt, một người không duyệt hai cấp liền nhau (trừ khi là người duy nhất, ghi "miễn tách nhiệm vụ"). Duyệt một cấp: không kiểm tra người lập khác người duyệt |
| Khóa | Khóa công theo kỳ (chặn chứng từ nguồn; không mở khi kỳ có bảng R / V); đóng kỳ lương (chặn mọi thao tác ghi); trạng thái bảng lương; dấu dữ liệu đầu vào; phiếu sản lượng C, bảng tính hoa hồng P, phiên bản bảng tỷ lệ đã dùng |
| Chống sửa ngoài luồng | User Event chặn sửa trực tiếp bảng lương, dòng lương, dòng nhập tay, giờ công, sổ phép; trạng thái / số dư của tạm ứng và kỳ; trạng thái chứng từ công |
| Toàn vẹn ghi sổ | Kiểm tra trước, externalid duy nhất, lưu id JE trước khi cập nhật tạm ứng, các bước sau JE chạy lại được |
| Không xóa dữ liệu nghiệp vụ | Hủy = inactive kèm lý do (phiếu sản lượng, bảng tính hoa hồng, cấp duyệt, tài khoản chi phí theo đích); sửa sai bằng đảo |
| Nhật ký | `audit_log` (mọi POST thành công, gắn bảng lương / kỳ / nhân viên), `approval_log` (quyết định duyệt), lịch sử xử lý cảnh báo; System Notes của NetSuite cho record |
| Dữ liệu cá nhân | Không ghi lương, số định danh vào log; số định danh che hoặc chỉ cờ có / không ở màn hình; bản in lương giới hạn vai trò |
| Tham số pháp lý | Có ngày hiệu lực, cờ đã đối chiếu, cảnh báo khi chưa đối chiếu |

**Chưa làm.** Phân quyền dữ liệu theo công ty / chi nhánh; "quản trị IT không xem lương"; vai trò Quản lý trực tiếp; nhãn record song ngữ (record, list chỉ tiếng Việt; SPA và bản in song ngữ).

---

## 17. Chu kỳ tháng đầu cuối

```
Thiết lập (một lần) -> Hồ sơ, lịch sử lương, người phụ thuộc
        |
Trong kỳ: Đơn nghỉ / OT / công tác / ngoại lệ (NV, HR lập; HR duyệt)
          Lượt chấm công -> Xử lý chấm công -> chứng từ đề xuất (H) -> duyệt
          Time NetSuite (dự án) ; Phiếu sản lượng (H -> P -> A) ; Tạm ứng (H -> B -> O)
          Doanh số -> Bảng tính hoa hồng (D -> A)
        |
Cuối kỳ: Lập bảng công -> rà soát -> Khóa công (att_status L)
        |
Bảng lương: Tạo (H) -> Nạp nhân viên + Nạp giờ -> Nhập tay -> Tính (C) -> Soát cảnh báo
            -> Bỏ tạm giữ -> Gửi duyệt (P) -> Duyệt từng cấp (A)
        |
Kế toán: Ghi sổ (R): JE lương; cấn trừ tạm ứng (O -> C); phiếu sản lượng -> C; hoa hồng -> P;
         phiên bản phân bổ "đã dùng"; số liệu cost_fact
         -> Bill cơ quan thu (BHXH, công đoàn, thuế) -> File chi lương -> In phiếu lương, bảng thanh toán
        |
Báo cáo: BH tháng + D02-LT (đối chiếu C12-TS), chi phí theo tài khoản (đối chiếu JE), quỹ lương,
         phân tích chi phí lao động ; Nhân viên xem phiếu lương trên cổng tự phục vụ
        |
Đóng kỳ lương (khi mọi bảng lương của kỳ đã R hoặc V)
Hằng quý: 05/KK-TNCN + phiếu số liệu HTKK
```

Nguồn nào cấp cho đâu:
- Bảng tổng hợp công -> ngày công, nghỉ không lương / BHXH (ngưỡng BH), giờ OT -> bảng lương.
- Đơn OT đã duyệt -> dòng OT; Time NetSuite -> giờ lương giờ và phân bổ theo timesheet.
- Phiếu sản lượng A -> quy tắc nguồn O; bảng tính hoa hồng A -> dòng nguồn C.
- Tạm ứng O -> cấn trừ; sổ phép -> trả phép khi nghỉ việc.
- Bảng lương R -> JE, bill, file ngân hàng, báo cáo, cost_fact, cổng tự phục vụ.

---

## 18. Chu kỳ cuối năm, đầu năm

1. **Trước 31/12:** đảm bảo mọi bảng lương trong năm đã R (bảng V không tính); Thiết lập: nạp ngày lễ năm sau khi đã công bố (gói chỉ giao năm đã công bố, hiện nạp sẵn 2027); sinh kỳ lương năm sau cho mọi nhóm lương; rà tham số pháp lý có hiệu lực từ 01/01 năm sau, đánh dấu đã đối chiếu.
2. **Quyết toán thuế TNCN:** chạy báo cáo quyết toán năm (05-1/BK, 05-2/BK), phiếu số liệu 05/QTT, sổ theo dõi thuế; kế toán nhập vào phần mềm khai thuế. Tính thuế năm, số nộp thêm / hoàn, chứng từ khấu trừ: làm ngoài gói (CHƯA LÀM trong gói).
3. **Lương tháng 13:** trích trước hằng tháng Có 335 theo cơ sở và số tháng thiết lập; khi chi trả, nhập dòng thu nhập trên bảng lương (chịu thuế theo loại thu nhập chọn). Tất toán 335 tự động: CHƯA LÀM (xem 11.3).
4. **Phép năm:** đầu năm chạy Cấp phép (giao dịch A, chuyển phép C kèm hạn); đến hạn chạy Hết hạn phép chuyển (X); với chính sách cấp theo tháng chạy định kỳ (chạy lại không cấp trùng). CTV không được cấp.
5. **Giấy phép lao động:** cập nhật giấy hết hạn (`updateExpiredPermits`), gia hạn theo chuỗi trước khi hết hạn.

---

## 19. Thuật ngữ

| Tiếng Việt | English | Nghĩa trong gói |
| --- | --- | --- |
| Bảng lương | Payroll batch | Một lần tính lương cho một kỳ và một nhóm lương của một công ty con (mã BL) |
| Dòng nhân viên bảng lương | Payroll employee line | Kết quả một người trên bảng lương; chi tiết lưu JSON |
| Dòng nhập tay | Manual input line | Thu nhập nhập tay (nguồn M) hoặc khấu trừ sau thuế |
| Kỳ lương | Pay period | Khoảng ngày trả lương thuộc một nhóm lương; mã yyyyMM với nhóm DEFAULT |
| Nhóm lương | Pay group | Nhóm nhân viên cùng tần suất, nguồn công, quy tắc |
| Tháng tính thuế | Tax month | yyyyMM dùng gộp BH, thuế khi trả nhiều lần trong tháng |
| Cửa sổ kết công | Time window | Khoảng ngày lấy giờ công cho kỳ |
| Bảng tổng hợp công | Attendance summary | Công của từng người trong kỳ |
| Bảng công ký hiệu | Attendance sheet | Lưới 31 ô ký hiệu công |
| Chứng từ công | Attendance document | Đơn nghỉ, đơn OT, đơn công tác, phiếu ngoại lệ |
| Khóa công | Attendance lock | Chốt công kỳ, chặn sửa chứng từ nguồn |
| Công chuẩn | Standard work days | Số ngày làm việc chuẩn của kỳ (không có mặc định 26) |
| Công hưởng lương | Paid work days | Công dùng tính lương theo ngày công |
| Lương đóng BH | Insurance wage | Căn cứ đóng BH khai trên lịch sử lương |
| Mức tham chiếu | Reference wage | Tham số `INS.REFERENCE_WAGE` dùng tính trần BHXH-BHYT |
| Lương tối thiểu vùng | Regional minimum wage | Tham số `MINWAGE.I` - `MINWAGE.IV` |
| Khoản trích theo lương | Payroll contribution component | BHXH, BHYT, BHTN, BHTNLĐ, KPCĐ, đoàn phí |
| Giảm trừ gia cảnh | Family deduction | Giảm trừ bản thân + người phụ thuộc |
| Thu nhập chịu thuế | Taxable income | Tổng thu nhập - miễn thuế |
| Thu nhập tính thuế | Assessable income | Chịu thuế - BH NLĐ - giảm trừ |
| HĐLĐ / nhân viên (E) | Employee | Đóng BH, thuế lũy tiến (mặc định) |
| HĐDV / CTV (C) | Contractor | Không BH, không phép năm, thường khấu trừ 10% |
| Cam kết 08/CK-TNCN | Flat-tax commitment | Cờ hồ sơ: không khấu trừ 10% |
| Quy tắc thu nhập | Earning rule | Công thức cấu hình sinh dòng thu nhập |
| Loại thu nhập | Earning type | Khoản thu nhập kèm nhóm và cách tính thuế |
| Gói phúc lợi | Benefit package | Bộ phụ cấp cố định / tháng |
| Bảng đơn giá | Rate table | Đơn giá khoán / sản phẩm / thang hoa hồng theo hiệu lực |
| Phiếu sản lượng | Output entry | Nghiệm thu khối lượng cá nhân hoặc tổ (mã SL) |
| Chia tiền tổ | Team split | Phân tiền phiếu tổ cho thành viên |
| Tạm ứng lương | Payroll advance | Chi trước, cấn trừ vào lương (mã TU) |
| Cấn trừ tạm ứng | Advance offset | Trừ tạm ứng vào thực lĩnh, FIFO |
| Thực lĩnh | Net pay | Số tiền chi trả sau mọi khoản trừ |
| Đích phân bổ | Allocation target | Dự án, phòng ban, địa điểm, class nhận chi phí |
| Bảng tỷ lệ phân bổ | Allocation plan | Tỷ lệ % theo đích, có phiên bản |
| Tài khoản chi phí theo đích | Cost account by target | Quy tắc chọn TK chi phí theo class / dự án / phòng ban |
| Ghi sổ | Release | Tạo bút toán, chuyển R |
| Đảo | Reverse | Bút toán đảo, chuyển V |
| Bill cơ quan thu | Agency bill | Vendor Bill nộp BH, công đoàn, thuế |
| Trích trước tháng 13 | 13th-month accrual | Nợ chi phí / Có 335 hằng tháng |
| Trả phép khi nghỉ việc | Leave payout | Tiền phép năm chưa nghỉ |
| Sổ phép | Leave ledger | Số dư và giao dịch phép |
| Dấu dữ liệu khi tính | Calculation stamp | Mã kiểm đầu vào không đổi giữa tính và duyệt / ghi sổ |
| Cảnh báo cần soát | Payroll check | Quy tắc kiểm tra trước duyệt, mức lỗi / cảnh báo / thông tin |
| Cấp duyệt | Approval step | Cấu hình duyệt nhiều cấp |
| Số liệu chi phí lương | Labor cost fact | Bảng số liệu phân tích ghi khi ghi sổ |
| Tham số pháp lý | Statutory parameter | Giá trị luật có ngày hiệu lực và cờ đối chiếu |
| Gói ngành | Industry pack | Bộ cấu hình mẫu Xây dựng, Thương mại, Sản xuất |
| Draw | Draw | Ứng trước / bảo đảm tối thiểu hoa hồng |
| True-up | True-up | Trả bù khi tính lũy kế quý / năm |

---

## 20. Danh sách điểm chưa làm hoặc chưa chắc (tổng hợp)

CHƯA LÀM (theo mã và tài liệu repo):
1. Phân quyền dữ liệu lương theo công ty / chi nhánh; "quản trị IT không xem lương"; vai trò Quản lý trực tiếp.
2. Thời điểm khấu trừ BH, thuế T (tạm khấu trừ từng kỳ) và A (kỳ giữa tháng là tạm ứng).
3. Nguồn giờ OT từ timesheet (OT source T); giờ OT chỉ lấy từ đơn OT.
4. Quyết toán thuế năm tự động (thuế năm, nộp thêm / hoàn), chứng từ khấu trừ TNCN, xuất XML HTKK; chỉ tiêu [24], [25], [32] của 05/KK.
5. Truy lĩnh, truy đóng BH hồi tố.
6. Tất toán TK 335 khi chi lương tháng 13.
7. File ngân hàng theo định dạng riêng từng ngân hàng (chỉ CSV chung).
8. Bút toán liên công ty; ánh xạ task, cost code.
9. (Đã làm, ghi chú cũ sai) Xử lý chấm công khối lượng lớn đã chạy nền bằng Map/Reduce.
10. GI / dashboard / saved search kiểu Acumatica; ứng dụng mobile; màn công chi tiết của tôi; đơn ngoại lệ tự phục vụ.
11. Nhãn record / list tiếng Anh (Translation Collection).
12. Hạn nộp theo luật trên Trang chủ chưa có dữ liệu nạp sẵn.
13. Xếp ca: ô chưa hiện ngày nghỉ phép, công tác; chế độ ca không mang chi nhánh, work center.
14. Phân hệ **Phân ca kíp sản xuất** tạm dừng sau màn Xếp ca: định biên theo chuyền / ca, tay nghề, kiểm luật lao động khi xếp ca, công bố kế hoạch, ca thực tế do tổ trưởng xác nhận, sản lượng theo chuyền ca và chia sản lượng theo giờ có mặt (thiết kế: `docs/SHIFT_CREW.md`, `docs/SHIFT_CREW_SPEC.md`).
15. Quy tắc thu nhập nguồn số lượng H (số ca đã làm) và phương pháp phân bổ R (ngày phân ca): lõi tính đã có nhưng lớp api chưa cấp số ca và ngày phân ca cho bảng lương.

Chưa xác minh:
1. Không có kiểm tra người lập khác người duyệt ở chế độ duyệt một cấp; không có kiểm tra người tính khác người duyệt bảng tính hoa hồng (đọc theo mã; có thể là chủ đích dựa vào tổ chức).
2. Giới hạn giấy phép lao động (24 tháng, 1 lần gia hạn, nhắc 60 ngày) là mặc định trong mã, chưa thấy trường thiết lập để đổi.
3. Nguồn sản lượng từ giao dịch sản xuất chưa chạy trên account thật.
4. Cổng tự phục vụ chưa thử với tài khoản Employee Center thật.
5. Lưới nhập bảng công ký hiệu đầy đủ trên SPA bản 2.
6. Quy tắc riêng về BH, cư trú thuế cho người nước ngoài (gói dựa vào cờ hồ sơ và cách tính thuế HR chọn).
7. Cột phiếu 05/QTT chưa đối chiếu phụ lục mẫu pháp lý.
8. Ba tham số từ 01/07/2026 (`INS.REFERENCE_WAGE`, `PIT.FLAT_THRESHOLD`, `PIT.MEAL_EXEMPT_CAP`) đang `verified = F`.

Tài liệu repo lạc hậu so với mã (cần cập nhật khi viết wiki): `docs/ARCHITECTURE.md` mục 4 và 6 ghi duyệt nhiều cấp là "giai đoạn sau" nhưng đã có `approval_step` / `ApprovalFlow` (mặc định tắt); `docs/DOI_CHIEU_DAC_TA.md` ghi VP642000, VP645000, VP646000 "chưa làm" và `cost_account` "chờ nối" nhưng mã đã có bản in tương ứng và `CostAccounts.forPayroll` đã nối vào tính lương.
