# Phân ca kíp sản xuất - đặc tả kỹ thuật (bản 1, 12/11/2026)

Tài liệu đi kèm: `docs/SHIFT_CREW.md` (thiết kế nghiệp vụ). Tài liệu này đủ chi tiết để lập trình: mô hình dữ liệu theo quy ước
`tools/schema.mjs`, mô-đun lõi và api, route RESTlet, thuật toán, điểm nối với record chuẩn NetSuite và với các phân hệ khác của
S4 Advanced Payroll. Mã phân hệ: **shiftcrew**, tiền tố tài liệu SC.

## Tình trạng (12/11/2026): TẠM DỪNG sau màn Xếp ca (bản 2 có Chế độ ca)

Người dùng quyết định: làm màn hình Xếp ca rồi dừng, chuyển sang giai đoạn bán hàng; phần còn lại làm tiếp khi có khách hàng.
Account td2937310 không có giấy phép Manufacturing nên nguồn sản xuất NetSuite (mục 6.2, lát 4 - 5) chưa thể kiểm.

Yêu cầu bổ sung của người dùng cho màn Xếp ca (đã làm ở bản 2): cấu hình linh hoạt theo từng công ty; ca ít khi đổi nên phải thao
tác hàng loạt được cho hàng nghìn công nhân; không phải nhân viên nào cũng thuộc diện xếp ca; học cách làm của phần mềm lớn.

### Chế độ ca (đã làm, đã deploy)
Học cách của SAP (quy tắc lịch làm việc gán cho nhân viên theo hiệu lực, chỉ lưu "thay ca") và UKG (mẫu lịch gán cho nhóm): **không
lưu từng ô cho từng người**. Lịch ca hiệu lực = ô phân ca đã lưu (`roster`, thực chất là ngoại lệ sửa tay) đè lên lịch suy ra từ
**chế độ ca**.

- Record mới `shift_assign` (Chế độ ca, `tools/schema/shiftassign.mjs`): công ty con, phạm vi `E` nhân viên / `T` tổ / `D` phòng
  ban / `G` nhóm lương / `S` cả công ty con, đích tương ứng, mẫu xoay ca, ngày neo chu kỳ, hiệu lực từ - đến, ghi chú.
- Ưu tiên theo ngày: E > T > D > G > S; cùng mức lấy dòng hiệu lực muộn nhất (`core/ShiftAssign.js`). Tổ xét thành viên hiệu lực
  tại từng ngày. Các kíp lệch nhau bằng ngày neo.
- `api/EffectiveRoster.js` là nơi duy nhất trả "nhân viên làm ca nào ngày nào": xử lý chấm công (`Shifts.roster`), khung chi tiết
  nhân viên của màn Chấm công và màn Xếp ca đều đọc qua đây. Account chưa khai chế độ ca thì kết quả đúng bằng các ô đã lưu như
  trước (hành vi cũ giữ nguyên, không thêm truy vấn ngoài một lượt đọc `shift_assign`).
- **Diện xếp ca**: nhân viên có chế độ ca hiệu lực hoặc có ô phân ca trong khoảng ngày. Người ngoài diện (văn phòng không xếp ca)
  mặc định ẩn trên lưới; chấm công của họ vẫn theo ngày nghỉ hằng tuần như trước.
- Quy mô: gán 2.000 công nhân vào 3 kíp là 3 dòng chế độ ca; đổi chế độ từ một ngày là thêm một dòng có ngày hiệu lực mới; không
  có bước "sinh ô" nào phải chạy. Ô phân ca sinh từ mẫu trước đây (nguồn G) vẫn được tôn trọng.

### Màn Xếp ca (`#/roster`, menu Khác > Xếp ca; `spa/payroll/views/roster.js`)
- Lưới nhân viên x ngày (1 tuần, 2 tuần, 31 ngày); lọc Diện xếp ca / Tất cả, tổ, phòng ban, ô tìm; số người theo ca từng ngày.
- Nút **Chế độ ca**: danh sách có ô tìm, thêm / sửa / thôi dùng.
- Sửa ngoại lệ: chọn ca (hoặc Nghỉ, hoặc Theo chế độ ca) rồi bấm ô; Shift để tô đoạn; bấm tiêu đề ngày để tô cho người đang chọn.
- Hàng loạt trên người được tích chọn (có "Chọn tất cả đang lọc"): xếp một ca cho khoảng ngày (lọc theo thứ, tối đa 6.000 ô mỗi
  lần, gửi theo lô 200), gán chế độ ca riêng (lô 100 người), trả về chế độ ca.
- Route: GET `rosterView`; POST `rosterCells`, `rosterReset`, `rosterAssignSave`, `rosterAssignBatch` (`api/RosterView.js`).
- Test: `tests/core/rostergrid.test.js`, `tests/core/shiftassign.test.js`, `tests/api/rosterview.test.js`.

Giới hạn hiện tại: ô chưa hiện ngày nghỉ phép / công tác; chế độ ca không mang chi nhánh, work center (ô suy ra có hai trường này
trống); chưa có kiểm tra định biên, tay nghề, luật lao động; chưa có công bố kế hoạch.

Chưa làm (mọi mục còn lại của tài liệu này): lát 0 (cấp `shiftCounts`, `rosterDays` cho bảng lương - khi làm phải đọc qua
`EffectiveRoster`), chuyền, định biên, tay nghề, kế hoạch có công bố, ca thực tế, sản lượng chuyền ca.

## 0. Trạng thái kiểm chứng

| Nội dung | Trạng thái |
| --- | --- |
| Điểm nối trong gói (Shifts, RosterPlan, ShiftMatcher, Output, OutputSources, PayGroupPeriods, PayrollEngine, AllocationSourceResolver, EarningRuleEngine, RESTlet) | Đã đọc mã nguồn nhánh `feature/ui-v2` (commit 82337a1) |
| Assembly Build, Work Order | Trường lấy từ tài liệu tham chiếu record; `OutputSources` đã thử cột SuiteQL trên td2937310 |
| Work Order Completion, Manufacturing Operation Task, Manufacturing Routing, work center | **Chưa kiểm được**: td2937310 chưa bật Manufacturing Routing / WIP (SuiteQL metadata trả "record type does not exist"). Tên trường ở mục 6.2 là dự kiến, phải kiểm trên account có bật tính năng trước khi viết mã phần đó |
| Giá trị luật lao động (nghỉ chuyển ca, giờ tối đa) | Chưa đối chiếu văn bản gốc: khai là tham số `verified = F`, không gắn trong mã |

Hai phát hiện khi đọc mã, phân hệ này xử lý luôn:
1. `EarningRuleEngine` đã hỗ trợ nguồn số lượng **H - Số ca đã làm** (`ctx.shiftCounts`) và `AllocationSourceResolver` đã hỗ trợ
   phương pháp **R - Ngày phân ca** (`input.rosterDays`), nhưng **lớp api chưa cấp hai dữ liệu này** (`api/Payroll.js` không dựng
   `shiftCounts`, `rosterDays`). Hiện quy tắc nguồn H luôn ra 0 và phương pháp R luôn rơi xuống dự phòng.
2. `tools/gen_objects.mjs` chưa có đích `select:item`; phân hệ cần thêm (mục 2.4).

## 1. Kiến trúc và bản đồ liên kết

```
NetSuite chuẩn                         Phân hệ Phân ca kíp                          Phân hệ khác của gói
--------------                         -------------------                          --------------------
Employee, Subsidiary, Location,   ->   line, line_staffing, skill, emp_skill   <->  Hồ sơ lương (employee), nhóm lương, kỳ
Department, Class                      shift_plan + roster (kế hoạch)          <->  shift, shift_pattern, team, team_member
Manufacturing Work Center (nhóm)  ->   line.ns_work_center                          PayGroupPeriods (khóa kỳ công)
                                       shift_actual (thực tế)                  <->  punch, punch_source (thiết bị -> chuyền)
                                                                               <->  ShiftMatcher -> att_exception, ot_request
                                                                               ->   attendance (bảng tổng hợp công)
Assembly Build, Work Order        ->   line_output (sản lượng chuyền ca)       ->   output, output_line, output_member
Completion, Operation Task             prod_source, line_map                        rate_table (đơn giá công đoạn)
Item (assembly)                                                                ->   Payroll: shiftCounts (H), rosterDays (R),
                                                                                    outputAmounts, outputShares
Employee Center                   ->   cổng tổ trưởng (s4vp_sl_my_payroll)          Home, Checks, AuditLog, LaborAnalytics
```

Nguyên tắc tích hợp:
- **Không sửa record chuẩn**. Gói chỉ đọc giao dịch sản xuất bằng SuiteQL cố định (không nhận câu SQL từ ngoài) và ghi custom
  record của gói. Trường tùy chỉnh trên giao dịch (chuyền, ca) do khách hàng tạo, khai script id trong cấu hình nguồn
  (kiểm bằng `FIELD_RE = /^cust(body|col)[a-z0-9_]+$/` như `OutputSources`).
- **Một đường ghi cho mỗi loại dữ liệu**: phiếu sản lượng luôn qua `Output.save`; chứng từ công luôn qua cơ chế Tạm giữ của
  `Shifts.processPunchChunk`; khóa luôn qua `PayGroupPeriods`.
- **Lõi thuần** (`core/*`, không gọi N/*) chứa mọi quy tắc tính, có test jest; `api/*` chỉ đọc ghi theo lô.
- Mọi thao tác chạy lại được (idempotent) bằng trường khóa (`key`) như `roster`, `punch`, `output.src_tran`.

## 2. Mô hình dữ liệu

File mới `tools/schema/shiftcrew.mjs` (nạp như `punchimport.mjs`). Tiền tố trường dành riêng, không trùng tiền tố đang dùng:
`ln, lst, sk, esk, spl, sa, lo, prs, lmp, ldv`.

### 2.1 Custom list mới

| List | Giá trị |
| --- | --- |
| `line_kind` | L - Chuyền; S - Trạm / máy; A - Khu vực |
| `plan_status` | D - Nháp; P - Đã công bố; L - Đã khóa |
| `actual_source` | P - Theo kế hoạch; D - Máy chấm tại chuyền; L - Tổ trưởng xác nhận; X - Hệ thống ngoài; M - Sửa tay |
| `actual_status` | T - Tạm; C - Tổ trưởng đã xác nhận; A - Đã duyệt |
| `presence` | P - Có mặt; A - Vắng |
| `lo_source` | T - Giao dịch NetSuite; X - Hệ thống ngoài / file; M - Nhập tay |
| `lo_status` | N - Chưa chia; G - Đã sinh phiếu; S - Bỏ qua |
| `share_scope` | L - Mọi người có mặt ở chuyền; P - Chỉ người đúng vị trí của công đoạn |
| `line_detect` | F - Trường chuyền trên giao dịch; W - Work center của công đoạn; L - Địa điểm; C - Class |
| `shift_detect` | F - Trường ca trên giao dịch; O - Một ca cố định của nguồn; N - Không tách ca (cả ngày) |
| `sc_check_mode` | W - Chỉ cảnh báo; B - Chặn công bố |

Mở rộng list có sẵn: `team_type` **không đổi** (kíp là tổ bất kỳ có khai mẫu xoay ca, xem ADR-2 mục 14); `roster_source` thêm `K - Từ kíp theo kế hoạch`; `split_method` giữ nguyên
(H theo giờ đã có; F được hiểu là "trọng số x hệ số": ngày công với phiếu thường, giờ với phiếu chuyền ca).

### 2.2 Record mới

```js
// quyền: SETUP = HR toàn quyền, kế toán xem; PROFILE = HR toàn quyền, kế toán xem
{ id: "line", prefix: "ln", name: "Chuyền sản xuất", screen: "SC101", perms: SETUP, includeName: true,   // name = mã chuyền
  fields: [
    ["description", "Diễn giải", "text"], ["subsidiary", "Công ty con", "select:subsidiary", { req: true }],
    ["kind", "Loại", "select:list:line_kind"], ["location", "Chi nhánh (địa điểm)", "select:location"],
    ["department", "Phòng ban", "select:department"], ["work_center", "Work center (lớp)", "select:class"],
    ["ns_work_center", "Work center NetSuite (id nhóm)", "int", { help: "Internal ID of the Manufacturing Work Center (entity group). Used to map routing operations to this line." }],
    ["leader", "Trưởng chuyền", "select:employee"], ["shifts", "Ca được chạy", "multi:rec:shift"],
    ["split_method", "Cách chia sản lượng", "select:list:split_method", { help: "Empty = H (hours)." }],
    ["share_scope", "Phạm vi chia", "select:list:share_scope", { help: "Empty = L." }],
    ["rate_table", "Bảng đơn giá mặc định", "select:rec:rate_table"],
  ] },
{ id: "line_staffing", prefix: "lst", name: "Định biên chuyền", screen: "SC101", perms: SETUP, includeName: false, child: true,
  fields: [
    ["line", "Chuyền", "select:rec:line", { req: true, parent: true }], ["shift", "Ca", "select:rec:shift", { help: "Empty = every shift." }],
    ["position", "Vị trí", "text"], ["operation", "Công đoạn", "text", { help: "Operation code handled by this position (rate table item code)." }],
    ["skill", "Tay nghề yêu cầu", "select:rec:skill"], ["min_level", "Bậc tối thiểu", "int"],
    ["min_count", "Số người tối thiểu", "int", { req: true }], ["std_count", "Số người chuẩn", "int"],
    ["factor", "Hệ số chia của vị trí", "float"], ["effective", "Hiệu lực từ", "date"], ["expiration", "Hiệu lực đến", "date"],
  ] },
{ id: "skill", prefix: "sk", name: "Tay nghề", screen: "SC102", perms: SETUP, includeName: true,          // name = mã tay nghề
  fields: [["description", "Diễn giải", "text"], ["expires", "Có thời hạn", "check"]] },
{ id: "emp_skill", prefix: "esk", name: "Tay nghề nhân viên", screen: "SC102", perms: PROFILE, includeName: false,
  fields: [
    ["employee", "Nhân viên", "select:employee", { req: true }], ["skill", "Tay nghề", "select:rec:skill", { req: true }],
    ["level", "Bậc", "int"], ["issued", "Ngày cấp", "date"], ["expiration", "Hết hạn", "date"], ["note", "Ghi chú", "text"],
  ] },
{ id: "shift_plan", prefix: "spl", name: "Kế hoạch ca", screen: "SC201", perms: PROFILE, includeName: false, numbering: "KH",
  fields: [
    ["subsidiary", "Công ty con", "select:subsidiary", { req: true }], ["from", "Từ ngày", "date", { req: true }], ["to", "Đến ngày", "date", { req: true }],
    ["lines", "Chuyền", "multi:rec:line"], ["description", "Diễn giải", "text"],
    ["status", "Trạng thái", "select:list:plan_status", { display: "LOCKED" }], ["version", "Phiên bản", "int", { display: "LOCKED" }],
    ["published_by", "Người công bố", "select:employee", { display: "LOCKED" }], ["published_date", "Ngày công bố", "date", { display: "LOCKED" }],
    ["check_result", "Kết quả kiểm tra gần nhất", "clob", { display: "LOCKED" }],
  ] },
{ id: "shift_actual", prefix: "sa", name: "Ca thực tế", screen: "SC301", perms: PROFILE, includeName: false,
  fields: [
    ["employee", "Nhân viên", "select:employee", { req: true }], ["work_date", "Ngày làm", "date", { req: true }],
    ["shift", "Ca", "select:rec:shift"], ["line", "Chuyền", "select:rec:line"], ["position", "Vị trí", "text"],
    ["presence", "Có mặt", "select:list:presence", { req: true }],
    ["from_min", "Từ (phút tính từ 00:00 ngày làm)", "int"], ["to_min", "Đến (phút tính từ 00:00 ngày làm)", "int", { help: "Above 1440 = next day (overnight shift)." }],
    ["hours", "Giờ trong ca", "float", { display: "LOCKED" }], ["night_hours", "Giờ đêm", "float", { display: "LOCKED" }],
    ["source", "Nguồn", "select:list:actual_source", { req: true }], ["status", "Trạng thái", "select:list:actual_status", { display: "LOCKED" }],
    ["confirmed_by", "Người xác nhận", "select:employee", { display: "LOCKED" }], ["confirmed_date", "Ngày xác nhận", "date", { display: "LOCKED" }],
    ["reason", "Lý do", "text"], ["ext_ref", "Mã nguồn ngoài", "text"], ["key", "Khóa", "text", { display: "HIDDEN" }],
  ] },
{ id: "line_output", prefix: "lo", name: "Sản lượng chuyền ca", screen: "SC401", perms: PROFILE, includeName: false,
  fields: [
    ["subsidiary", "Công ty con", "select:subsidiary", { req: true }], ["line", "Chuyền", "select:rec:line", { req: true }],
    ["work_date", "Ngày", "date", { req: true }], ["shift", "Ca", "select:rec:shift", { help: "Empty = whole day." }],
    ["operation", "Công đoạn", "text"], ["product", "Sản phẩm", "select:item"], ["item", "Mã hạng mục đơn giá", "text", { req: true }],
    ["qty", "Số lượng", "float", { req: true }], ["uom", "Đơn vị tính", "text"], ["work_order", "Lệnh sản xuất", "select:transaction"],
    ["source", "Nguồn", "select:list:lo_source"], ["prod_source", "Cấu hình nguồn", "select:rec:prod_source"],
    ["src_key", "Khóa nguồn", "text", { display: "LOCKED" }], ["status", "Trạng thái", "select:list:lo_status", { display: "LOCKED" }],
    ["entry", "Phiếu sản lượng", "select:rec:output", { display: "LOCKED" }], ["skip_reason", "Lý do bỏ qua", "text"],
  ] },
{ id: "prod_source", prefix: "prs", name: "Nguồn sản lượng chuyền ca", screen: "SC401", perms: SETUP, includeName: true,
  fields: [
    ["subsidiary", "Công ty con", "select:subsidiary", { req: true }], ["tran_type", "Loại giao dịch", "select:list:out_tran_type", { help: "Build or WOCompl. Empty = external / file source." }],
    ["line_detect", "Cách nhận chuyền", "select:list:line_detect"], ["line_field", "Trường chuyền trên giao dịch", "text"],
    ["shift_detect", "Cách nhận ca", "select:list:shift_detect"], ["shift_field", "Trường ca trên giao dịch", "text"], ["fixed_shift", "Ca cố định", "select:rec:shift"],
    ["by_operation", "Lấy số lượng theo công đoạn", "check", { help: "WOCompl with routing: one row per completed operation." }],
    ["item_code", "Mã hạng mục = ", "select:list:prs_item", { help: "I = item ID; O = operation name; B = operation + item." }],
    ["rate_table", "Bảng đơn giá", "select:rec:rate_table"], ["skip_tagged", "Bỏ qua giao dịch đã gắn người / tổ", "check", { def: "T" }],
    ["tagged_source", "Nguồn sản lượng từ giao dịch tương ứng", "select:rec:out_source", { help: "Its employee / team fields decide which transactions are already tagged." }],
  ] },
{ id: "line_map", prefix: "lmp", name: "Đối chiếu mã chuyền", screen: "SC401", perms: { [ROLE_HR]: "EDIT", [ROLE_ACCT]: "VIEW" }, includeName: false,
  fields: [
    ["source", "Nguồn", "select:rec:prod_source", { req: true }], ["ext_code", "Mã ngoài (chuyền, địa điểm, class, work center)", "text", { req: true }],
    ["line", "Chuyền", "select:rec:line", { req: true }], ["effective", "Hiệu lực từ", "date"], ["expiration", "Hiệu lực đến", "date"],
  ] },
{ id: "line_device", prefix: "ldv", name: "Thiết bị chấm công của chuyền", screen: "SC101", perms: { [ROLE_HR]: "EDIT", [ROLE_ACCT]: "VIEW" }, includeName: false,
  fields: [
    ["source", "Hồ sơ nguồn chấm công", "select:rec:punch_source", { req: true }], ["device", "Thiết bị", "text", { help: "Empty = every device of the source." }],
    ["line", "Chuyền", "select:rec:line", { req: true }], ["effective", "Hiệu lực từ", "date"], ["expiration", "Hiệu lực đến", "date"],
  ] },
```

List phụ `prs_item`: I - Mã mặt hàng; O - Tên công đoạn; B - Công đoạn + mặt hàng.

### 2.3 Mở rộng record hiện có (trong `tools/schema.mjs`)

| Record | Trường thêm | Ghi chú |
| --- | --- | --- |
| `roster` (ro) | `plan` select:rec:shift_plan; `line` select:rec:line; `position` text; `crew` select:rec:team | Khóa `key = employee|work_date` giữ nguyên: kế hoạch mỗi người một ô mỗi ngày |
| `team` (tm) | `line` select:rec:line (chuyền mặc định); `pattern` select:rec:shift_pattern; `anchor` date (ngày 1 của chu kỳ) | Kíp = tổ có `pattern` |
| `company` | `sc_enabled` check (bật phân ca kíp cho công ty con) | Tắt: tab ẩn, bảng lương lấy số ca từ `roster`, không có kiểm tra mới |
| `output` (oe) | `line` select:rec:line; `shift` select:rec:shift | Phiếu sinh từ sản lượng chuyền ca: `type T`, `team` trống |
| `output_member` (om) | `qty_share` float; `position` text | `hours` đã có, nay được điền giờ thực tế |
| `setup` (set) | `sc_check_mode` select:list:sc_check_mode; `sc_actual_days` check (ngày công lấy từ ca thực tế đã duyệt); `sc_require_actual` check (bắt buộc duyệt ca thực tế trước khi khóa công) | Mặc định W, F, F: bật dần theo khách hàng |
| `param` | Mã mới: `SHIFT.REST_BETWEEN_HOURS`, `SHIFT.MAX_HOURS_DAY`, `SHIFT.MAX_HOURS_WEEK`, `SHIFT.MAX_NIGHT_STREAK` | Nạp với `verified = F`, giá trị trống; kiểm tra tương ứng chỉ chạy khi tham số có giá trị |

`shift_actual.key = employee|work_date|seq` với `seq` = thứ tự đoạn trong ngày (0 cho dòng chính; 1, 2... khi điều chuyển). Một
người có nhiều dòng trong một ca khi điều chuyển. Giờ lưu bằng **phút tương đối so với ngày làm** (ADR-4), màn hình hiển thị HH:mm.
`line_output.src_key`: giao dịch `type:id:line[:opseq]`; nguồn ngoài `source:ext_ref`; nhập tay để trống.

### 2.4 Việc cần làm ở công cụ sinh
- `tools/gen_objects.mjs`: thêm đích `item` vào bảng `SELECT` (id danh sách chuẩn của Item, kiểm bằng một custom field thử).
- Record mới -> deploy hai bước `tools/deploy_two_pass.py` (`S4VP_BASE` = commit đã deploy cuối).
- Vai trò: HR, kế toán theo `perms`; `customrole_s4vp_demo` FULL; `customrole_s4vp_selfservice` thêm `shift_actual` vào `ESS_WRITE`
  (cổng tổ trưởng ghi), xem `roster`, `line`, `shift`.

## 3. Mô-đun mã

### 3.1 Lõi thuần (`core/`, có test jest)

| Mô-đun | Hàm | Mô tả |
| --- | --- | --- |
| `CrewPlan.js` | `generate({crews, patterns, shifts, from, to})` | Gọi `RosterPlan.generate` cho từng kíp (chu kỳ, anchor, thành viên hiệu lực), gắn `line`, `crew`; trả ô cùng cấu trúc `RosterPlan` cộng `line, crew, position` |
| | `plan(existing, generated)` | Như `RosterPlan.plan` nhưng so thêm `line, crew, position`; ô nguồn M giữ nguyên |
| | `coverage({cells, staffing, skills, date range})` | Theo chuyền x ngày x ca (x vị trí): `{need: {min, std}, have, skilled, gap, status: OK / SHORT / SKILL}` |
| | `candidates({line, date, shift, cells, skills, leaves})` | Người có thể bổ sung: đủ tay nghề, không có ô ca ngày đó, không nghỉ, xếp theo số ca đã xếp trong tuần |
| `CrewChecks.js` | `run({cells, shifts, staffing, skills, leaves, profiles, params, otLimits})` | Trả `[{code, level: E / W, employee, date, line, vi, en}]`. Mã: `SHORT_STAFF, SKILL_MISSING, SKILL_EXPIRED, ON_LEAVE, NOT_EMPLOYED, NO_PROFILE, DOUBLE_BOOKED, REST_BETWEEN, MAX_DAY, MAX_WEEK, NIGHT_STREAK, LINE_SHIFT_NOT_ALLOWED` |
| `ActualBuilder.js` | `fromPlan(cells)` | Dòng thực tế nguồn P cho ô kế hoạch có ca |
| | `fromMatch(results, cells, deviceLines, shifts)` | Từ kết quả `ShiftMatcher.match` (`in, out, worked, night, status`): dòng nguồn D; chuyền = chuyền của thiết bị lượt vào (bảng `line_device`), không có thì chuyền kế hoạch |
| | `merge(existing, incoming, precedence)` | Chọn dòng thắng theo thứ tự nguồn (mặc định M > L > X > D > P); dòng đã duyệt (A) không bị ghi đè |
| | `hours(row, shift)` | Giờ trong ca = phút giao của [from, to] với khung ca, trừ nghỉ giữa ca theo tỷ lệ; giờ đêm dùng `ShiftMatcher.nightOverlap` |
| | `validateSegments(rows)` | Một người không được có hai dòng có mặt giao giờ nhau; tổng giờ một ca không vượt độ dài ca + ngưỡng OT |
| `CrewReconcile.js` | `diff({plan, actual, match, outputs})` | Ngoại lệ: `PLANNED_ABSENT, UNPLANNED_PRESENT, CONFIRMED_NO_PUNCH, PUNCH_NOT_CONFIRMED, OVER_SHIFT, OUTPUT_NO_CREW, CREW_NO_OUTPUT, LINE_MISMATCH` |
| `LineOutputSplit.js` | `allocate({rows, actual, staffing, line})` | Mục 5.5: chia số lượng và trọng số theo người; trả `{members: [{employee, hours, factor, weight, qtyShare, position}], issues}` |
| | `splitQty(total, weights, decimals = 4)` | Chia số lượng giữ tổng: làm tròn xuống đến 4 số lẻ, phần dư cộng cho phần lẻ lớn nhất (cùng phép của `TeamSplitCalculator`) |
| `ProdSourceRows.js` | `toLineOutput(tranRow, source, maps, shifts)` | Chuẩn hóa một dòng giao dịch / dòng file thành `line_output` hoặc `{skip: NO_LINE / NO_SHIFT / NO_ITEM / BAD_QTY / TAGGED}` |

Sửa lõi hiện có:
- `ShiftMatcher.match`: thêm đầu vào tùy chọn `confirmed: [{employee, workDate, presence, from, to}]`. Ngày có xác nhận của tổ
  trưởng mà không có lượt chấm: `presence P` -> coi là có mặt với giờ xác nhận (trạng thái `OnTime` / `LateOrEarly` theo giờ),
  `presence A` -> `Absent`. Không có `confirmed` thì hành vi không đổi (test hiện có giữ nguyên).
- `AllocationSourceResolver.resolve`: `rosterDays[].weight` tùy chọn (mặc định 1) để phân bổ theo **giờ** khi nguồn là ca thực tế.
- `TeamSplitCalculator`: không đổi (phiếu chuyền ca dùng H hoặc F với `workDays` = giờ).

### 3.2 Lớp api (`api/`)

| Mô-đun | Vai trò |
| --- | --- |
| `Lines.js` | Danh mục chuyền, định biên, tay nghề, thiết bị, kíp; route của màn Chuyền |
| `CrewPlans.js` | Kế hoạch ca: tạo, sinh từ kíp, sửa ô, kiểm tra, công bố, mở lại, khóa; đọc lưới hai chế độ |
| `ShiftActuals.js` | Dựng ca thực tế từ kế hoạch + lượt chấm, xác nhận của tổ trưởng, sửa tay, duyệt; đối chiếu |
| `LineOutputs.js` | Nạp sản lượng chuyền ca (giao dịch, file, nhập tay), xem trước chia, sinh phiếu sản lượng |
| `CrewReports.js` | Năng suất theo người / kíp / chuyền; dữ liệu thẻ Trang chủ |

Sửa api hiện có: `Shifts.js` (4.3), `Output.js` (5.6), `Payroll.js` (7.3), `Attendance.js` (7.2), `Home.js`, `Checks.js`,
`SetupHub.js` (khai record mới vào trung tâm thiết lập), `PunchImport.js` (không đổi dữ liệu; chỉ đọc `line_device`).

Đăng ký: thêm `Lines, CrewPlans, ShiftActuals, LineOutputs, CrewReports` vào `ROUTE_MODULES` của `scripts/s4vp_rl_api.js`.

### 3.3 Script

| Script | Thay đổi |
| --- | --- |
| `s4vp_rl_api.js` | Đăng ký mô-đun route |
| `s4vp_mr_attendance.js` | Thêm op `actual` (dựng ca thực tế theo lô nhân viên, sau `punches`) và op `lineout` (chia sản lượng theo lô chuyền x ngày); cùng cách chia lô, cờ tác vụ nền và lưu kết quả như op `punches` |
| `s4vp_ue_guard.js` | Không đổi (script này chỉ chặn sửa trực tiếp bảng lương, sổ phép, tạm ứng, kỳ) |
| `s4vp_ue_shiftcrew.js` (mới) | beforeSubmit trên `shift_actual`, `line_output`, `shift_plan` khi ghi từ giao diện NetSuite, CSV Import, REST: tính `key` / `src_key`, `hours`; chặn trùng khóa; chặn ghi khi kỳ công của nhóm lương đã khóa; chặn sửa dòng đã duyệt / đã sinh phiếu; chặn đổi trạng thái kế hoạch. Thao tác của gói (RESTlet, Map/Reduce, Suitelet) bỏ qua như `s4vp_ue_output` |
| `s4vp_sl_my_payroll.js` | Thêm trang "Ca của tôi" (mọi nhân viên) và "Xác nhận ca" (trưởng chuyền, tổ trưởng) - mục 6.4 |

## 4. Route RESTlet

Quy ước như hiện có: `routes: { get: {name: {roles, run(params)}}, post: {name: {roles, run(body)}} }`; lỗi trả `s4vpError`,
`s4vpErrorVi`; JSON không có khóa `error`; POST dài trả `more: true` + `cursor` (màn hình tự lặp, vì `lib/api.js post()` không gửi
lại con trỏ).

### 4.1 Lines (thiết lập)
| Route | Quyền | Vào -> ra |
| --- | --- | --- |
| GET `linesView` | payroll | `{subsidiary}` -> chuyền, định biên, thiết bị, kíp (team type K / L), ca, mẫu xoay ca, tay nghề |
| POST `lineSave` | hr | `{id?, values, staffing?: [...], devices?: [...]}` -> `{id}`; thôi dùng = Inactive |
| POST `skillSave`, `empSkillSave` | hr | Danh mục tay nghề; tay nghề nhân viên (một hoặc nhiều dòng) |
| GET `empSkills` | payroll | `{subsidiary, line?, q?}` -> ma trận nhân viên x tay nghề (bậc, hết hạn) |

### 4.2 CrewPlans (kế hoạch)
| Route | Quyền | Vào -> ra |
| --- | --- | --- |
| GET `crewPlans` | payroll | `{subsidiary, from?, to?}` -> danh sách kế hoạch (trạng thái, số ô, số cảnh báo) |
| GET `crewPlanView` | payroll | `{plan, mode: people / coverage, line?}` -> ô lưới, độ phủ, cảnh báo, khóa kỳ theo nhóm lương |
| POST `crewPlanSave` | hr | `{id?, subsidiary, from, to, lines, description}` -> `{id}`; khoảng ngày tối đa 62 ngày |
| POST `crewPlanGenerate` | hr | `{plan, crews?: [teamId], cursor?}` -> `{created, updated, keptManual, unchanged, more}`; theo lô kíp |
| POST `crewPlanCell` | hr | `{plan, employee, workDate, shift?, line?, position?}` hoặc `{cells: [...]}` (tối đa 200 ô) -> ô nguồn M |
| POST `crewPlanCheck` | payroll | `{plan}` -> `{issues, counts}`; lưu `check_result` |
| POST `crewPlanPublish` | hr | `{plan, acknowledge?: true}` -> D -> P; chạy kiểm tra, có lỗi mức E và `sc_check_mode = B` thì từ chối; tăng `version` |
| POST `crewPlanReopen`, `crewPlanLock` | hr | P -> D (ghi AuditLog); P -> L |
| GET `crewCandidates` | payroll | `{plan, line, workDate, shift}` -> người có thể bổ sung |

### 4.3 ShiftActuals (thực tế)
| Route | Quyền | Vào -> ra |
| --- | --- | --- |
| POST `actualBuild` | hr | `{period}` hoặc `{from, to, line?}` -> dựng / cập nhật dòng nguồn P, D; kỳ lớn chạy nền (op `actual`), trả `{background: true}` |
| GET `actualView` | payroll | `{subsidiary, workDate, line?, shift?}` -> người theo chuyền ca: kế hoạch, thực tế, lượt chấm vào ra, trạng thái |
| POST `actualConfirm` | hr | `{line, workDate, shift, rows: [{employee, presence, from?, to?, toLine?, reason?}], add?: [...]}` -> nguồn L, trạng thái C |
| POST `actualEdit` | hr | Sửa tay một dòng (nguồn M, bắt buộc lý do) |
| POST `actualApprove`, `actualReopen` | hr | `{from, to, line?}` -> C / T -> A; A -> C. Duyệt chạy `validateSegments` |
| GET `crewReconcile` | payroll | `{subsidiary, from, to, type?}` -> danh sách ngoại lệ (mục 5.4) kèm hành động gợi ý |
| POST `actualImport` | hr | `{source, rows: [{employee, workDate, shift, line, from, to, extRef}]}` -> nguồn X; tối đa 500 dòng mỗi lần; cũng nhận qua CSV Import / REST record |

Cổng tổ trưởng (Suitelet tự phục vụ, không qua RESTlet): `shiftMine` (xem ca của mình), `shiftCrew` (đọc) và `shiftConfirm`
(ghi) chỉ cho chuyền mà nhân viên đăng nhập là `line.leader` hoặc `team.leader`; máy chủ tự lọc, không nhận `line` tùy ý.

### 4.4 LineOutputs (sản lượng)
| Route | Quyền | Vào -> ra |
| --- | --- | --- |
| GET `lineOutputsView` | payroll | `{subsidiary, period?, from?, to?, line?}` -> dòng sản lượng, trạng thái, phiếu đã sinh, số đếm |
| GET `prodSources` | payroll | Cấu hình nguồn |
| POST `lineOutputPull` | hr | `{source, from, to, cursor?}` -> đọc giao dịch, ghi `line_output` mới (bỏ qua `src_key` đã có); `{read, created, skipped: {NO_LINE..}, more}` |
| POST `lineOutputImport` | hr | `{source, rows}` (dán Excel / CSV) -> xem trước rồi ghi, cùng luồng preview / commit của `PunchImport` |
| POST `lineOutputSave` | hr | Nhập tay / sửa dòng trạng thái N |
| POST `lineOutputPreview` | payroll | `{from, to, line?}` -> từng nhóm chuyền x ngày x ca: tổng tiền, danh sách người (giờ, hệ số, số lượng, tiền), vấn đề |
| POST `lineOutputGenerate` | hr | `{from, to, line?, cursor?}` -> sinh phiếu Tạm giữ; `{entries, amount, issues, more}`; lớn thì op `lineout` chạy nền |
| POST `lineOutputSkip` | hr | Đánh dấu bỏ qua kèm lý do (không xóa) |

### 4.5 CrewReports
GET `crewProductivity` `{subsidiary, from, to, by: employee / crew / line / item}` -> số lượng, giờ, sản lượng / giờ, tiền khoán;
GET `crewHomeTiles` -> số liệu thẻ Trang chủ (bấm mở danh sách tương ứng).

## 5. Thuật toán

### 5.1 Sinh kế hoạch từ kíp
1. Kíp = `team` loại K (hoặc L, C có `pattern`). Mỗi kíp: `line`, `pattern`, `anchor`.
2. Với từng kíp: `RosterPlan.generate({cycle, anchor, from, to, members, location: line.location, workCenter: line.work_center})`,
   gắn `line`, `crew`. Vị trí lấy từ thành viên nếu sau này thêm trường vị trí cho `team_member` (giai đoạn 1 để trống).
3. `lockedIn(from, to, employees)` theo nhóm lương (mã hiện có): có kỳ công khóa thì từ chối cả lô kíp đó.
4. `CrewPlan.plan`: ô M giữ; ô G / K cập nhật khi khác; ô mới tạo với `source K`, `plan = id kế hoạch`.
5. Ô đã thuộc **kế hoạch khác đã công bố** của cùng người, cùng ngày: không ghi đè, trả cảnh báo `IN_OTHER_PLAN`.

Tương thích ngược: `generateRoster` / `setRosterCell` hiện có vẫn chạy (ô không có `plan`, `line`); lưới kế hoạch hiển thị được.

### 5.2 Kiểm tra (CrewChecks)
- Độ phủ: với mỗi chuyền x ngày x ca có định biên hiệu lực: đếm ô có ca; `have < min_count` -> `SHORT_STAFF` (E); thiếu chuẩn
  -> W. Có `skill`: đếm người có `emp_skill` đạt bậc và còn hạn tại ngày đó.
- Nhân sự: `ON_LEAVE` (đơn nghỉ, công tác đã duyệt giao ngày - tái dùng `Shifts.excusedDays`), `NOT_EMPLOYED`
  (`EmploymentDays.employedIn`), `NO_PROFILE` (chưa có hồ sơ lương).
- Thời giờ: `REST_BETWEEN` (khoảng giữa giờ ra ca trước và giờ vào ca sau nhỏ hơn tham số), `MAX_DAY`, `MAX_WEEK`,
  `NIGHT_STREAK`. Tham số lấy qua `StatutoryParameterProvider`; tham số trống thì bỏ qua kiểm tra đó; tham số `verified = F` thì
  cảnh báo luôn ở mức W dù `sc_check_mode = B`.
- Giới hạn làm thêm: dùng `OT.LIMIT_MONTH`, `OT.LIMIT_YEAR`, `OT.LIMIT_YEAR_EXTENDED` đã có (ca xếp vào ngày nghỉ tuần / lễ, phân
  loại bằng `WorkingDayCounter.classifyDay`).

### 5.3 Dựng ca thực tế
Đầu vào một lô nhân viên trong [from, to]: ô kế hoạch, lượt chấm (kèm `device`), `line_device`, xác nhận hiện có.
1. `fromPlan`: mỗi ô có ca -> dòng P, `presence P`, giờ = khung ca.
2. `Matcher.match({roster, shifts, punches, excused, confirmed})`; `fromMatch`: mỗi kết quả có `in` / `out` -> dòng D với giờ
   thật; `Absent` -> `presence A`; `Excused` -> không có dòng (đã có chứng từ nghỉ); `WorkedWithoutShift` -> dòng D không ca,
   chuyền theo thiết bị.
3. Chuyền của dòng D: thiết bị của lượt chấm vào -> `line_device` (hiệu lực tại ngày, dòng có thiết bị thắng dòng trống);
   không có thì chuyền kế hoạch.
4. `merge` với dòng đang có: M > L > X > D > P; dòng trạng thái A không đổi; dòng D / P cũ không còn nguồn thì ngừng dùng
   (Inactive, không xóa).
5. Điều chuyển giữa ca do tổ trưởng nhập: dòng gốc bị cắt `to_min`, thêm dòng mới (`seq` kế tiếp) ở chuyền đích từ thời điểm đó.

### 5.4 Đối chiếu
`CrewReconcile.diff` chạy trên dữ liệu đã có, không ghi gì. Hành động gợi ý trên màn hình tái dùng chức năng sẵn có: tạo đơn
nghỉ, tạo đơn OT (`ot_request` Tạm giữ), sửa dòng thực tế, bổ sung lượt chấm (nguồn M), mở phiếu sản lượng.
Sinh chứng từ công vẫn do `Shifts.processPunchChunk` làm: sau khi có xác nhận của tổ trưởng, chạy lại xử lý chấm công sẽ thay
chứng từ Tạm giữ cũ (cơ chế hiện có) với đầu vào `confirmed`, nên không còn phiếu "thiếu lượt chấm" cho người đã được xác nhận.

### 5.5 Chia sản lượng chuyền ca
Nhóm các dòng `line_output` trạng thái N theo `subsidiary x line x work_date x shift` (shift trống = cả ngày: lấy mọi dòng
thực tế của chuyền trong ngày).
1. Người tham gia = dòng `shift_actual` `presence P` của nhóm, trạng thái theo cấu hình: mặc định cần A (đã duyệt); cho phép C.
2. Với `share_scope = P`: dòng sản lượng có `operation` chỉ chia cho người có `position` thuộc định biên của công đoạn đó;
   không ai đúng vị trí -> vấn đề `NO_POSITION`, rơi về chia cả chuyền nếu cấu hình cho phép.
3. Trọng số: H = giờ; F = giờ x hệ số (hệ số: `line_staffing.factor` của vị trí, không có thì `team_member.factor` của kíp,
   không có thì 1); E = 1; P = `team_member.percent`.
4. Tiền: định giá từng dòng bằng `OutputRules.priceLine` (bảng đơn giá của nguồn hoặc của chuyền, ngày phiếu = `work_date`), tổng
   tiền nhóm chia bằng `TeamSplitCalculator.split` (làm tròn đồng, giữ tổng).
5. Số lượng quy đổi: với mỗi mã hạng mục, `splitQty(qty, weights)`; `qty_share` của người = tổng theo hạng mục khi phiếu một
   hạng mục, nhiều hạng mục thì lưu tổng và chi tiết nằm ở báo cáo (tính lại từ trọng số đã lưu: `hours`, `factor`).
6. Vấn đề chặn sinh phiếu của nhóm: `NO_CREW` (không ai có mặt), `RATE_MISSING`, `NOT_APPROVED`, `PERIOD_POSTED`,
   `PERIOD_LOCKED`. Nhóm có vấn đề được liệt kê, không sinh.

### 5.6 Sinh phiếu sản lượng
Một phiếu cho mỗi nhóm: `Output.save({subsidiary, doc_date: work_date, type: "T", rate_table, line, shift, split_method,
location, work_center, department (của chuyền), src: prod_source, src_tran: khóa nhóm}, lines, members)` với
`members = [{employee, hours, factor, percent, work_days: 0, qty_share, position, amount, manual: false}]`.
- `Output.save` thêm nhận `line`, `shift` ở đầu phiếu và `qty_share`, `position` ở thành viên; phiếu có `line` thì nút "Nạp
  thành viên" gọi `LineOutputs.membersFromActual` thay vì `loadTeamMembers`.
- Ghi xong: các dòng `line_output` của nhóm -> `status G`, `entry = id phiếu`. Phiếu bị hủy (`voidEntry`) -> dòng về N.
- Phiếu đi tiếp đúng luồng hiện có: Tạm giữ -> gửi duyệt -> duyệt -> vào bảng lương (`Output.forPayroll`), khóa khi ghi sổ.
- Chống trùng: khóa nhóm `LO:line:date:shift` trong `src_tran`; nhóm đã có phiếu đang hoạt động thì bỏ qua.

## 6. Liên kết với NetSuite chuẩn

### 6.1 Danh mục
| Record NetSuite | Dùng ở | Cách dùng |
| --- | --- | --- |
| Employee | mọi record của phân hệ | Chỉ đọc; nhân viên phải có hồ sơ lương (`employee`) mới vào kế hoạch (cảnh báo `NO_PROFILE`) |
| Subsidiary | `line`, `shift_plan`, `line_output`, `prod_source` | Lọc theo công ty con như mọi màn của gói; nhóm lương theo công ty con quyết định kỳ và khóa |
| Location, Department, Class | `line` | Đích chi phí của chuyền; đổ xuống `roster`, `output`, phân bổ lương |
| Item (assembly) | `line_output.product` | Mã hạng mục đơn giá mặc định = `itemid` viết hoa (như `OutputSources`) |
| Manufacturing Work Center (entity group) | `line.ns_work_center` | Ánh xạ 1-1 chuyền - work center; dùng cho `line_detect = W` |
| Project (job) | qua `team`, `output` hiện có | Không thêm mới |

### 6.2 Giao dịch sản xuất (đọc bằng SuiteQL, không ghi)
| Nguồn | Điều kiện dòng | Số lượng | Chuyền | Ca |
| --- | --- | --- | --- | --- |
| Assembly Build (`Build`) | `tl.mainline = 'T' AND tl.item IS NOT NULL` (như `OutputSources.TYPES`) | số lượng dòng chính | trường `line_field`; hoặc location / class qua `line_map` | `shift_field`, ca cố định, hoặc không tách |
| Work Order Completion (`WOCompl`), không routing | như trên | số lượng hoàn thành | như trên | như trên |
| Work Order Completion có routing (`by_operation`) | mỗi công đoạn hoàn thành một dòng | số lượng hoàn thành của công đoạn | work center của công đoạn -> `line.ns_work_center` | như trên |

Phần routing **phải kiểm trên account có bật Manufacturing Routing and Work Center + WIP** trước khi viết mã: tên bảng và cột
SuiteQL của sublist công đoạn trên Work Order Completion, bảng Manufacturing Operation Task (số thứ tự, tên công đoạn, work
center, số lượng hoàn thành), và cách nhận biết nhóm là work center. Thiết kế tách phần này sau một adapter
(`ProdSourceRows` + một câu SuiteQL cho mỗi loại nguồn) để việc kiểm chứng không ảnh hưởng phần còn lại.

Lưu ý nghiệp vụ:
- Giao dịch NetSuite chỉ có **ngày** chứng từ, không có giờ làm; ngày tạo bản ghi không tin được (nhập bù). Vì vậy ca phải đến
  từ trường tùy chỉnh trên giao dịch, hoặc nguồn chỉ có một ca, hoặc chia theo cả ngày.
- `skip_tagged`: giao dịch đã gắn người / tổ (trường khai ở `out_source` tương ứng) đi đường `OutputSources`; nguồn chuyền ca bỏ
  qua để **không tính hai lần**. Kiểm chéo: `output.src_tran LIKE 'type:id:%'`.
- Quyền: vai trò chạy cần xem Build Assemblies / Mark Work Orders Built (đã nêu ở `OutputSources`); bổ sung vào vai trò HR nếu
  khách dùng nguồn giao dịch.
- Gói không ghi Time (timebill) và không đụng chi phí nhân công của WIP (NetSuite tính theo cost template, không theo người).
  Xuất giờ thực tế sang Time là tùy chọn giai đoạn 4.

### 6.3 Máy chấm công
Không thêm đường nạp mới: lượt chấm vẫn vào `punch` qua `PunchImport` (hồ sơ nguồn, bảng đối chiếu mã). Phân hệ chỉ thêm bảng
`line_device` để suy ra chuyền từ `punch.device`. Hệ thống chấm công đẩy thẳng dòng thực tế (đã có chuyền, giờ) dùng nguồn X.

### 6.4 Employee Center (cổng tự phục vụ)
- Suitelet `s4vp_sl_my_payroll` chạy bằng vai trò `customrole_s4vp_selfservice`, lọc cứng theo nhân viên đăng nhập (cơ chế hiện có).
- "Ca của tôi": ô `roster` thuộc kế hoạch đã công bố của chính nhân viên, 14 ngày tới.
- "Xác nhận ca": chỉ hiện khi nhân viên là `line.leader` hoặc `team.leader`; danh sách người của chuyền ca hôm nay / hôm qua;
  ghi `shift_actual` nguồn L. Không cho sửa dòng đã duyệt, không cho xác nhận ngày thuộc kỳ công đã khóa.
- Giao diện một cột, nút lớn, dùng được trên điện thoại; không cần SPA UIF.
- Tổ trưởng cần quyền truy cập Employee Center (người dùng tự cấp, gói không tạo tài khoản).

## 7. Liên kết với các phân hệ khác của gói

### 7.1 Chấm công máy và chứng từ công
- `Shifts.processPunchChunk`: đọc thêm xác nhận (`shift_actual` nguồn L / M / X trong khoảng) truyền vào `Matcher.match` dưới
  dạng `confirmed`. Mọi thứ khác (xóa chứng từ Tạm giữ lần trước, sinh `att_exception`, `ot_request`) giữ nguyên.
- Sau bước xử lý chấm công của kỳ, tự gọi dựng ca thực tế cho cùng lô (đồng bộ) hoặc xếp op `actual` (chạy nền).

### 7.2 Bảng tổng hợp công (`attendance`)
- Mặc định **không đổi**: ngày công vẫn tính từ chứng từ (nguồn E) hoặc bảng công ký hiệu (nguồn S).
- `sc_require_actual = T`: `lockAttendance` từ chối khi còn dòng `shift_actual` chưa duyệt trong kỳ của nhân viên thuộc nhóm lương.
- `sc_actual_days = T` (giai đoạn 2, tùy chọn): `Attendance.buildChunk` đối chiếu số ca có mặt đã duyệt với ngày công tính từ
  chứng từ và ghi chênh lệch vào cảnh báo của dòng; không tự sửa ngày công (tránh hai nguồn sự thật).

### 7.3 Bảng lương (`api/Payroll.js`)
Khi dựng dữ liệu nhân viên cho `PayrollEngine`:
- `shiftCounts {D, E, N}`: đếm (ngày, ca) có `presence P`, trạng thái A trong kỳ, theo `shift.kind`. Không có dòng thực tế nào
  của nhân viên trong kỳ thì lấy từ `roster` (ô có ca) để khách chưa dùng phân hệ vẫn có số ca. Việc này **nối lại** nguồn số
  lượng H đang chưa được cấp dữ liệu.
- `rosterDays [{date, shiftCode, branch, workCenter, weight}]`: từ ca thực tế (branch = `line.location`, workCenter =
  `line.work_center`, weight = giờ), không có thì từ `roster`. Nối lại phương pháp phân bổ R.
- `outputAmounts`, `outputShares`: không đổi; phiếu chuyền ca là phiếu tổ bình thường, đích chi phí theo đầu phiếu (chuyền).
- Dấu dữ liệu đầu vào của bảng lương (`calc_stamp`, hàm `stamp(batchId)`: số dòng và thời điểm sửa gần nhất của từng record đầu
  vào) thêm `shift_actual` và `roster` trong khoảng ngày của kỳ, để duyệt / ghi sổ yêu cầu tính lại khi ca thực tế đổi.

### 7.4 Kiểm tra trước khi chạy lương (`api/Checks.js`)
Thêm ba kiểm tra: ca thực tế chưa duyệt trong kỳ; sản lượng chuyền ca chưa chia (trạng thái N); chuyền có sản lượng nhưng không
ai có mặt. Mức cảnh báo; bấm mở màn tương ứng.

### 7.5 Kỳ, nhóm lương, khóa
- Ghi `roster`, `shift_actual`: kiểm `lockedIn(date, date, [employee])` theo nhóm lương của nhân viên.
- `line_output` và phiếu sinh ra: kỳ lấy bằng `Output.defaultPeriod(work_date, subsidiary)`; kỳ đã có bảng lương ghi sổ ->
  `PERIOD_POSTED`.

### 7.6 Trang chủ, nhật ký, phân tích
- `Home`: thẻ "Chuyền thiếu người 7 ngày tới", "Ca chưa xác nhận", "Sản lượng chưa chia"; mỗi thẻ bấm mở danh sách.
- `AuditLog`: mọi POST tự ghi (cơ chế RESTlet); công bố / mở lại kế hoạch, sửa tay và duyệt ca thực tế ghi kèm lý do.
- `LaborAnalytics`: thêm chiều **chuyền** (từ `output.line`, và `rosterDays` theo giờ) cho chi phí khoán / sản lượng / giờ.
- `SetupHub`: nhóm "Phân ca kíp" gồm Chuyền, Tay nghề, Nguồn sản lượng chuyền ca, tham số `SHIFT.*`.

### 7.7 Hoa hồng, tạm ứng, thuế, bảo hiểm
Không liên quan trực tiếp; không thay đổi.

## 8. Giao diện SPA

Tab mới **Phân ca kíp** (`views/shiftCrew.js`, tách file con nếu dài), ẩn khi công ty con chưa có chuyền nào. Song ngữ vi / en
theo bảng `TEXT`; mọi lưới có ô tìm nhanh; ngày dùng date picker; ca, chuyền, kíp dùng dropdown; giờ dùng ô giờ.

| Màn | Thành phần chính |
| --- | --- |
| Kế hoạch | Thanh chọn: công ty con, kế hoạch (hoặc tuần), chuyền, chế độ xem. Lưới người x ngày (ô = mã ca + mã chuyền, màu theo loại ca, chấm góc cho ô sửa tay, xám cho nghỉ / lễ / nghỉ phép). Chế độ độ phủ: hàng chuyền x ca, cột ngày, ô "có / chuẩn" tô đỏ / vàng / xanh. Khung phải: cảnh báo (bấm nhảy tới ô), ứng viên bổ sung. Nút: Sinh từ kíp, Kiểm tra, Công bố, Mở lại |
| Thực tế | Chọn ngày, chuyền, ca. Bảng người: kế hoạch, giờ vào ra từ máy, có mặt, giờ, nguồn, trạng thái. Sửa nhanh, điều chuyển, thêm người. Nút: Dựng từ chấm công, Xác nhận, Duyệt |
| Đối chiếu | Lưới ngoại lệ, lọc theo loại và khoảng ngày, hành động theo dòng |
| Sản lượng | Lưới dòng chuyền ca (lọc trạng thái). Hộp thoại Lấy từ giao dịch (nguồn, khoảng ngày, xem trước), Nạp file (dán Excel), Nhập tay. Xem trước chia (theo nhóm: người, giờ, hệ số, số lượng, tiền). Nút Sinh phiếu; liên kết sang phiếu sản lượng |
| Năng suất | Bảng theo người / kíp / chuyền / hạng mục: số lượng, giờ, sản lượng mỗi giờ, tiền khoán; xuất Excel |
| Thiết lập | Trong Trung tâm thiết lập: chuyền + định biên + thiết bị; tay nghề và ma trận tay nghề nhân viên; nguồn sản lượng |

Lưới kế hoạch 100 người x 31 ngày = 3.100 ô: tải theo chuyền và theo tuần (mặc định 14 ngày), không tải cả kỳ cho mọi chuyền.

## 9. Hiệu năng và governance

| Thao tác | Cỡ dự kiến | Cách chạy |
| --- | --- | --- |
| Sinh kế hoạch | kíp 15 người x 31 ngày = 465 ô (mỗi ô 1 lần ghi) | RESTlet theo lô kíp, `more / cursor`; dừng khi còn dưới 1.000 đơn vị |
| Dựng ca thực tế | như xử lý chấm công | Ngưỡng `SYNC_EMPLOYEES`, `SYNC_CELLS` hiện có; vượt thì op `actual` của Map/Reduce, lô 10 nhân viên |
| Lấy sản lượng từ giao dịch | một câu SuiteQL cố định mỗi cửa sổ 1.000 dòng theo `t.id` tăng dần | Như `OutputSources` (WINDOW, MAX_WINDOWS, con trỏ) |
| Sinh phiếu | mỗi nhóm 1 phiếu + n thành viên | Tối đa 25 phiếu mỗi lượt gọi (`ENTRY_CAP`), lớn thì op `lineout` |
| Đọc lưới | `Lean.select` theo khoảng ngày + `findIn` theo nhân viên | Điều kiện ngày trong SQL, không đọc toàn bộ lịch sử |

Số bản ghi: `shift_actual` khoảng 1 dòng / người / ngày làm (nhà máy 500 công nhân: khoảng 13.000 dòng / tháng). Cần chính sách
lưu trữ sau: không xóa; báo cáo luôn lọc theo khoảng ngày.

## 10. Bảo mật và quyền

- Ma trận: HR toàn quyền nghiệp vụ; kế toán xem; demo như administrator; tổ trưởng chỉ qua cổng tự phục vụ với bộ lọc máy chủ.
- Không có RESTlet nhận SuiteQL tự do; trường tùy chỉnh trong cấu hình nguồn kiểm bằng biểu thức chính quy và chỉ ghép vào câu
  SQL dưới dạng tên cột đã kiểm.
- Không ghi lương, số định danh vào log; AuditLog chỉ ghi mã, id, số đếm.
- Không xóa dữ liệu: thôi dùng bằng Inactive, hủy bằng trạng thái + lý do (trừ ô `roster` nguồn G / K được cập nhật khi sinh lại,
  như hiện nay).

## 11. Kiểm thử

| Lớp | Nội dung |
| --- | --- |
| `tests/core` | `CrewPlan` (sinh từ nhiều kíp, giữ ô M, ô thuộc kế hoạch khác); `CrewChecks` (từng mã, tham số trống thì bỏ qua); `ActualBuilder` (thứ tự nguồn, điều chuyển, ca qua đêm, giờ đêm); `CrewReconcile`; `LineOutputSplit` (H / F / E / P, phạm vi P, giữ tổng số lượng và tiền, không ai có mặt); `ProdSourceRows`; `ShiftMatcher` với `confirmed` (test cũ không đổi) |
| `tests/api` | Khóa kỳ theo nhóm lương cho `roster`, `shift_actual`; chống trùng `src_key`, khóa nhóm phiếu; hủy phiếu trả dòng về N; `Payroll` nhận `shiftCounts`, `rosterDays` (quy tắc nguồn H ra số; phương pháp R ra đích); `skip_tagged` không tính hai lần |
| Trên account | Sao Mai, xưởng Bình Dương: 3 tổ -> 3 chuyền + kíp, 3 ca xoay; kế hoạch 2 tuần; file ZK có thiết bị theo chuyền; tổ trưởng xác nhận; sản lượng nhập file theo chuyền ca; sinh phiếu; chạy lương kỳ thử. Nguồn giao dịch: chỉ thử được Build khi account có dữ liệu; routing chưa thử được |

## 12. Thứ tự làm: lát cắt dọc (thay cho chia giai đoạn theo tầng)

Chia theo tầng (hết Kế hoạch mới tới Thực tế, rồi Sản lượng) khiến giá trị chính - **biết sản lượng từng người khi lệnh sản xuất
không gắn người** - chỉ có ở cuối. Kiến trúc chọn làm một đường xuyên suốt mỏng trước, rồi làm dày từng khâu. Mỗi lát deploy được,
dùng được, có test, và tắt được bằng `company.sc_enabled`.

| Lát | Nội dung | Dùng được gì sau lát này | Cỡ |
| --- | --- | --- | --- |
| 0. Vá điểm nối | `api/Payroll` cấp `shiftCounts`, `rosterDays` từ `roster`; test hồi quy. PR riêng, không phụ thuộc phân hệ | Quy tắc "số ca đã làm" và phân bổ "ngày phân ca" chạy đúng cho mọi khách hiện tại | S |
| 1. Đường xuyên suốt | `line`; `roster` thêm `line`, `crew`; `team` thêm `line`, `pattern`, `anchor`; màn Kế hoạch (lưới người x ngày, sinh từ kíp, sửa ô, chưa có kiểm tra / công bố); `shift_actual` dựng tự động từ kế hoạch + kết quả khớp ca (nguồn P, D), HR duyệt cả ngày; `line_output` nhập tay / dán Excel; `LineOutputSplit` theo giờ; sinh phiếu tổ; báo cáo sản lượng theo người | Trọn bài toán gốc trên dữ liệu Sao Mai, chưa có tổ trưởng và nguồn giao dịch | L |
| 2. Kế hoạch đầy đủ | `line_staffing`, `skill`, `emp_skill`, `shift_plan` (trạng thái, phiên bản); `CrewChecks`; chế độ xem độ phủ, ứng viên; công bố; "Ca của tôi" trên cổng tự phục vụ | HR nhà máy lập và công bố kế hoạch có kiểm soát | L |
| 3. Thực tế đầy đủ | `line_device`; cổng tổ trưởng xác nhận; điều chuyển giữa ca; `Matcher.confirmed`; màn Đối chiếu; op `actual` chạy nền; nguồn X | Thực tế do xưởng xác nhận, ngoại lệ được xử lý | M |
| 4. Nguồn sản xuất NetSuite | `prod_source`, `line_map`; lấy từ Assembly Build; `skip_tagged`; op `lineout`; chia theo vị trí (`share_scope P`) | Sản lượng tự lấy từ NetSuite | M |
| 5. Routing | Work Order Completion theo công đoạn, ánh xạ work center | Khoán theo công đoạn tự động | M, **chờ kiểm chứng 6.2** |
| 6. Mở rộng | Gợi ý định biên từ kế hoạch sản xuất; phụ cấp theo vị trí; phân bổ theo lệnh sản xuất; xuất giờ sang Time; app ngoài | Theo khách hàng | - |

Cỡ: S dưới 2 ngày công, M khoảng 3 - 5 ngày, L khoảng 6 - 10 ngày (ước lượng thô để xếp thứ tự, không phải cam kết).

Điều kiện xong của mỗi lát: test jest của lõi và api qua; deploy hai bước thành công trên td2937310; chạy kịch bản Sao Mai của lát
đó trên account; cập nhật `docs/wiki` (trang quy trình và trang dữ liệu đầu vào); không làm đổi kết quả bảng lương của công ty con
chưa bật `sc_enabled` (so bảng lương BL thử trước và sau).

## 13. Điểm cần quyết

1. Ca thực tế phải **đã duyệt (A)** mới được chia sản lượng, hay chấp nhận **tổ trưởng đã xác nhận (C)**? Đề xuất: A mặc định, C là
   cấu hình theo chuyền sau này.
2. `sc_actual_days`: giữ chứng từ công là nguồn ngày công duy nhất (đề xuất), ca thực tế chỉ để đối chiếu và chia sản lượng.
3. Nguồn routing: cần một account có bật Manufacturing Routing / WIP để kiểm trường. Có bật trên td2937310 được không (thay đổi
   cấu hình account, cần người dùng quyết)?
4. Tham số `SHIFT.*`: cần đối chiếu Bộ luật Lao động 2019 và Nghị định 145/2020 từ văn bản gốc trước khi điền giá trị.

## 14. Rà soát kiến trúc (góc nhìn Technical Lead / Solution Architect)

### 14.1 Quyết định kiến trúc (ADR)

| ADR | Quyết định | Lý do | Phương án đã loại |
| --- | --- | --- | --- |
| 1. Chuyền là record riêng | `line` tách khỏi Class ("Work center (lớp)" đang dùng trong gói) và khỏi `team` | Class là phân đoạn kế toán của khách (Sao Mai dùng Class cho "Khối"), không chắc ứng với chuyền; `team` là nhóm người. `line` vẫn mang location / department / class để đổ đích chi phí xuống `roster`, `output` nên phân bổ lương hiện có không đổi | Dùng Class làm chuyền (gắn cứng cách khách dùng phân đoạn); dùng `team` loại L làm chuyền (một tổ không thể vừa là người vừa là nơi) |
| 2. Không thêm loại tổ K | Kíp = tổ bất kỳ có `pattern`; `team_type L - Chuyền` giữ nghĩa cũ (nhóm người của chuyền) | Ít thay đổi dữ liệu và màn hình hiện có; tránh hai khái niệm trùng tên | Thêm K - Kíp |
| 3. Ba lớp dữ liệu, một nguồn sự thật cho mỗi câu hỏi | Kế hoạch (`roster`) trả lời "dự kiến ai ở đâu"; thực tế (`shift_actual`) trả lời "ai ở đâu, mấy giờ" cho chia sản lượng và phân bổ chi phí; **chứng từ công vẫn là nguồn duy nhất của ngày công hưởng lương** | Tránh hai nơi cùng quyết định ngày công; giữ nguyên bộ quy tắc công đã kiểm thử | Lấy ngày công từ ca thực tế (đổi nền tảng tính lương, rủi ro hồi quy lớn) |
| 4. Giờ lưu bằng phút tương đối | `shift_actual.from_min / to_min` tính từ 00:00 của `work_date` | Tính giao khung ca và ca qua đêm bằng số nguyên; không lệch khi account demo dịch ngày (trường ngày bị dịch, chuỗi ngày giờ thì không) | Chuỗi 'YYYY-MM-DD HH:mm' như `punch.punch_time` |
| 5. Mỗi dòng một bản ghi cho ca thực tế | 1 record / người / đoạn làm | Cần lọc, nối bằng SuiteQL theo chuyền x ngày x ca để chia sản lượng và báo cáo | Gộp cả tháng vào một dòng như `att_sheet` (ít bản ghi hơn khoảng 30 lần nhưng không truy vấn được theo chuyền) |
| 6. Sản lượng chuyền ca sinh **phiếu sản lượng tổ** | Không tạo đường vào lương thứ hai | Tái dùng duyệt, khóa khi ghi sổ, phân bổ "nguồn nào đích đó", in phiếu lương; kế toán chỉ học một loại chứng từ | Đưa thẳng tiền khoán vào bảng lương từ `line_output` |
| 7. Xác nhận của tổ trưởng đi vào bước khớp ca | `Matcher.match` nhận `confirmed`; chứng từ công vẫn do một hàm sinh | Một nơi sinh chứng từ Tạm giữ, không có hai bộ quy tắc trễ / vắng | Viết bộ sinh chứng từ riêng từ ca thực tế |
| 8. Nguồn NetSuite sau lớp chuyển đổi | Mỗi loại giao dịch một câu SuiteQL cố định + `ProdSourceRows` | Phần routing chưa kiểm chứng không chặn phần còn lại; thêm nguồn mới không đụng thuật toán chia | Đọc thẳng giao dịch trong thuật toán chia |
| 9. Bật theo công ty con | `company.sc_enabled`; tắt thì hành vi cũ giữ nguyên | Triển khai dần, khách không có nhà máy không thấy gì mới | Bật cho cả account |
| 10. Làm theo lát cắt dọc | Mục 12 | Có giá trị sớm, phát hiện sai thiết kế sớm trên dữ liệu thật | Làm hết từng tầng |

### 14.2 Rủi ro và cách giảm

| Rủi ro | Mức | Giảm thiểu |
| --- | --- | --- |
| Hồi quy bảng lương khi nối `shiftCounts`, `rosterDays` (khách đang có quy tắc nguồn H hoặc phương pháp R sẽ **đổi kết quả** từ 0 sang số thật) | Cao | Lát 0 làm riêng; trước khi deploy liệt kê quy tắc nguồn H và thiết lập R đang có trên account; ghi chú phát hành; bảng lương đã ghi sổ không tính lại |
| Thay đổi `ShiftMatcher` làm đổi chứng từ công | Trung bình | `confirmed` là đầu vào tùy chọn; test hiện có giữ nguyên; chỉ truyền khi `sc_enabled` |
| Hai tiến trình ghi cùng ô (tổ trưởng xác nhận trong lúc HR dựng lại) | Trung bình | Hợp nhất theo thứ tự nguồn; dòng đã xác nhận / đã duyệt không bị nguồn thấp hơn ghi đè; NetSuite không có ràng buộc duy nhất trên trường tùy chỉnh nên trùng `key` được dọn ở lần dựng kế tiếp (giữ dòng nguồn cao nhất, dòng kia Inactive) |
| Sản lượng về trễ sau khi kỳ đã ghi sổ | Trung bình | Không mở lại kỳ: nhóm bị `PERIOD_POSTED` được sinh phiếu vào **kỳ mở kế tiếp** với ngày phiếu = ngày đầu kỳ đó, diễn giải ghi ngày sản xuất gốc; cần người dùng xác nhận từng lần |
| Tính hai lần cùng một giao dịch (đường gắn người và đường chuyền ca) | Trung bình | `skip_tagged` + kiểm chéo `output.src_tran`; test riêng |
| Số bản ghi lớn (khoảng 13.000 dòng ca thực tế / tháng cho 500 công nhân) | Trung bình | Mọi truy vấn có điều kiện ngày; dựng và chia theo lô ở Map/Reduce; lưới tải theo chuyền + 14 ngày |
| Routing chưa kiểm chứng | Trung bình | Lát 5 tách riêng; không viết mã trước khi có account bật tính năng |
| Tham số luật lao động chưa đối chiếu | Thấp | Tham số trống thì không kiểm; không bao giờ chặn dựa trên tham số `verified = F` |
| Tổ trưởng không có quyền truy cập NetSuite | Thấp | Thực tế vẫn dựng được từ máy chấm; HR xác nhận thay trên SPA |

### 14.3 Giới hạn đã biết (chấp nhận ở bản đầu)
- Kế hoạch: mỗi người một ca mỗi ngày (khóa `employee|work_date` của `roster`). Ca gãy / hai ca một ngày chưa hỗ trợ ở kế hoạch;
  thực tế vẫn ghi được nhiều đoạn.
- Ca của sản lượng lấy từ trường trên giao dịch hoặc cấu hình nguồn; không suy từ giờ nhập liệu.
- Số lượng lấy theo đơn vị cơ sở của dòng giao dịch; bảng đơn giá phải khai đơn giá theo cùng đơn vị (không quy đổi đơn vị tính).
- Không tối ưu xếp ca tự động; chỉ gợi ý ứng viên.
- Không ghi ngược vào NetSuite Manufacturing (giờ công WIP, Time).

### 14.4 Nguyên tắc lập trình cho phân hệ
- Lõi thuần trước, api sau, màn hình cuối; mỗi hàm lõi có test trước khi nối api.
- Không thêm thư viện; dùng `Store`, `Lean`, `Dates`, `Money` hiện có. Số tiền dùng `Money.D`; số lượng 4 số lẻ.
- Mọi route POST dài trả `more / cursor` và chạy lại an toàn; mọi câu SuiteQL có tag (`s4vp_sc_*`) để theo dõi.
- Thông báo lỗi song ngữ qua `fail(en, vi)`; nhãn màn hình trong bảng `TEXT` vi / en.
- Record mới: thêm vào `SetupHub` nếu là danh mục; thêm vào vai trò demo và vai trò tự phục vụ khi cần; deploy hai bước.
- Cập nhật `docs/wiki` cùng lúc với mỗi lát (trang quy trình "Phân ca kíp" và mục dữ liệu đầu vào "Sản lượng chuyền ca").
