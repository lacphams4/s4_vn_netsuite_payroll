# Hoa hồng nhân viên kinh doanh và sản lượng từ giao dịch (11/11/2026)

Phân hệ con của S4 VN Payroll. Mục tiêu: tính hoa hồng cho nhân viên kinh doanh trực tiếp từ giao dịch bán hàng của
NetSuite (hóa đơn, bán thu tiền ngay, credit memo, thu tiền), cấu hình được nhiều kiểu cơ chế, giải thích được từng đồng, rồi
đưa vào bảng lương và hạch toán chi phí hoa hồng về đúng phòng ban, lớp (class), địa điểm, dự án của doanh thu.

## 1. Tham chiếu best practice (SAP S/4HANA, SAP Sales Performance Management - Commissions)

SAP tách tính hoa hồng thành chuỗi bước có cấu hình riêng. Gói giữ cùng tư duy nhưng gọn hơn:

| Bước SAP | Ý nghĩa | Trong gói |
|---|---|---|
| Transaction / Classification | Lấy giao dịch, phân loại theo sản phẩm, khách hàng | Đọc dòng hóa đơn, credit memo, cash sale; lọc theo mặt hàng, class, phòng ban, địa điểm, nhóm khách hàng, khách mới |
| Credit rules | Ai được ghi nhận doanh số, bao nhiêu % | Nguồn ghi nhận: NV kinh doanh trên chứng từ, đội bán (Team Selling, % đóng góp), hoặc trường tùy chỉnh |
| Primary measurement | Gom doanh số theo kỳ, theo nhóm | Cơ sở tính (doanh thu thuần, lãi gộp, số lượng) theo từng thành phần |
| Secondary measurement | % đạt chỉ tiêu | % đạt = cơ sở của kế hoạch / chỉ tiêu (theo tháng, lũy kế quý, lũy kế năm) |
| Incentive rules | Tỷ lệ, thang, hệ số tăng tốc, thưởng mốc | 6 phương pháp: %, thang lũy tiến, thang bậc, theo % đạt, đơn giá / sản phẩm, thưởng mốc |
| Deposit / Payment | Trần, ứng trước (draw), số dư, trả lương | Ngưỡng tối thiểu, trần, draw có thu hồi hoặc bảo đảm, điều chỉnh tay, truy thu (clawback) |

Nguyên tắc: không công thức tự do; mọi biến thể là cấu hình có kiểu dữ liệu. Mỗi kết quả kèm diễn giải từng bước và danh
sách giao dịch nguồn.

## 2. Mô hình dữ liệu (tools/schema/commission.mjs)

Tiền tố trường: `cpl` kế hoạch, `ccr` thành phần, `ctr` bậc thang, `cas` phân công, `cqt` chỉ tiêu theo tháng, `crn` bảng
tính, `crs` kết quả, `cad` điều chỉnh. `osr` nguồn sản lượng từ giao dịch (mục 9).

### comm_plan - Kế hoạch hoa hồng (includeName: mã kế hoạch)
- subsidiary (select subsidiary, trống = mọi công ty), description, effective, expiration (date)
- basis (list cm_basis): `R` doanh thu thuần chưa thuế, `G` lãi gộp ước tính (doanh thu - giá vốn ước tính dòng), `Q` số lượng bán
- trigger (list cm_trigger): `I` ghi nhận khi xuất hóa đơn (ngày chứng từ trong kỳ), `P` ghi nhận khi thu tiền (phần đã thu
  trong kỳ / tổng hóa đơn). Cash sale luôn tính theo ngày chứng từ.
- credit_source (list cm_credit): `R` NV kinh doanh trên chứng từ (salesrep), `T` đội bán (transactionsalesteam, % đóng góp;
  không có đội thì lùi về salesrep), `F` trường tùy chỉnh trên chứng từ (credit_field: id trường body, kiểu nhân viên)
- credit_field (text)
- window (list cm_window): `M` theo tháng, `Q` lũy kế quý, `Y` lũy kế năm. Q/Y: tính trên lũy kế từ đầu quý / năm đến cuối
  kỳ rồi trừ phần đã trả các kỳ trước (true-up), nên lên bậc giữa quý thì phần chênh được trả bù.
- include_returns (check, mặc định T): credit memo trong kỳ trừ vào cơ sở của người được ghi nhận
- clawback_days (int, 0 = tắt): trigger I, hóa đơn quá N ngày chưa thu đủ thì phần chưa thu bị trừ lại vào cơ sở ở kỳ đến hạn
- exclude_item_types (text, mặc định `TaxItem,ShipItem,Subtotal,Description,EndGroup,Group`): loại dòng bỏ qua (chiết khấu
  vẫn tính vì làm giảm doanh thu thuần)
- earning_type (text, mã loại thu nhập của bảng lương, bắt buộc)
- min_attainment (percent): % đạt dưới ngưỡng thì hoa hồng các thành phần theo doanh số = 0 (thưởng mốc tự có ngưỡng riêng)
- cap_amount (currency, trống = không trần): trần hoa hồng mỗi kỳ (sau điều chỉnh, trước draw)
- draw_type (list cm_draw): `N` không, `R` ứng trước có thu hồi (thiếu thì ứng, kỳ sau trừ dần), `G` bảo đảm tối thiểu không thu hồi
- draw_amount (currency)
- override_pct (percent), override_basis (list cm_override: `B` doanh số của cấp dưới, `C` hoa hồng của cấp dưới): hoa hồng
  quản lý trên cấp dưới trực tiếp được khai ở phân công (cas.manager)

### comm_rule - Thành phần (cách tính) của kế hoạch
- plan (select rec comm_plan, req), sequence (int), name (text)
- Bộ lọc (trống = không lọc; danh sách id nội bộ cách nhau dấu phẩy): f_items, f_classes, f_departments, f_locations,
  f_cust_categories; f_new_customer (check) + new_days (int, mặc định 90): chỉ hóa đơn của khách có lần mua đầu tiên trong
  N ngày tính đến ngày chứng từ
- method (list cm_method):
  - `P` tỷ lệ cố định: cơ sở x rate%
  - `G` thang lũy tiến theo giá trị: từng khoảng cơ sở x % của khoảng
  - `S` thang bậc theo giá trị: toàn bộ cơ sở x % của bậc đạt được
  - `A` theo % đạt chỉ tiêu (tăng tốc / giảm tốc): toàn bộ cơ sở x % của bậc % đạt
  - `U` đơn giá trên số lượng: số lượng x unit_amount
  - `B` thưởng mốc: số tiền cố định của bậc % đạt cao nhất đã qua
- rate (percent), unit_amount (currency)
- Các thành phần chạy độc lập trên tập giao dịch lọc riêng (cho phép chồng nhau, ví dụ 2% mọi mặt hàng + thưởng 1% riêng
  mặt hàng mới). % đạt luôn tính trên tổng cơ sở của cả kế hoạch (không lọc).

### comm_tier - Bậc thang của thành phần
- rule (select rec comm_rule, req), from_value (float: số tiền với G/S, % đạt với A/B), rate (percent), amount (currency, cho B)

### comm_assign - Phân công nhân viên vào kế hoạch
- plan (req), employee (req), effective, expiration, quota (currency, chỉ tiêu mỗi tháng), manager (select employee, nhận
  hoa hồng quản lý)
- Một nhân viên có thể ở nhiều kế hoạch (ví dụ kế hoạch doanh thu + kế hoạch thưởng khách mới).

### comm_quota - Chỉ tiêu riêng theo tháng (ghi đè quota của phân công)
- plan, employee, month (int YYYYMM), quota (currency)
- Chỉ tiêu quý / năm = tổng chỉ tiêu các tháng trong cửa sổ đến kỳ đang tính.

### comm_run - Bảng tính hoa hồng (includeName: mã HHyyyymm-<sub>)
- subsidiary (req), month (int YYYYMM), date_from, date_to (date), status (list cm_run_status: `D` nháp đã tính, `A` đã
  duyệt, `P` đã vào bảng lương), batch (select rec batch), total_base, total_amount (currency), employees (int),
  calc_at (text ISO), approved_by (select employee), note (textarea). Hủy = isinactive (không xóa).

### comm_result - Kết quả theo nhân viên và kế hoạch
- run (req), employee, plan, earning_type (text), quota, base (cơ sở trong kỳ), window_base (lũy kế cửa sổ),
  attainment (percent), gross (hoa hồng lũy kế cửa sổ trước trừ), prior_paid, earned (kỳ này = gross - prior_paid),
  override_amount, adjustments, capped (số bị cắt bởi trần), draw_paid, draw_recovered, draw_balance (số dư ứng trước sau
  kỳ), payable (số đưa vào bảng lương)
- detail (clob JSON): `{components: [...], steps: [{vi, en}], credits: [...], shares: [...]}` (mục 5)

### comm_adjust - Điều chỉnh tay
- employee (req), plan, month (int YYYYMM), amount (currency, âm được), reason (textarea, req). Vào bảng tính cùng tháng.

Quyền: kế toán EDIT mọi record (sửa, không xóa), HR VIEW; ESS không cần.

## 3. Chuỗi tính (core/CommissionEngine.js, thuần, có test)

Cho một kế hoạch và một kỳ [from, to]:
1. **Dòng nguồn** (data layer đưa vào đã chuẩn hóa, mục 4): mỗi dòng giao dịch một phần tử.
2. **Lọc dòng**: bỏ loại dòng trong exclude_item_types, bỏ dòng ngoài công ty con.
3. **Ghi nhận (credit)**: mỗi dòng sinh credit cho từng người theo credit_source: salesrep 100%; đội bán theo contribution%
   (tổng có thể khác 100%, giữ nguyên như NetSuite); trường tùy chỉnh 100%. Credit chỉ tính cho người có phân công hiệu
   lực vào kế hoạch tại ngày ghi nhận.
4. **Cơ sở dòng** theo basis: R = doanh thu thuần dòng; G = doanh thu - giá vốn ước tính; Q = số lượng. Credit memo mang dấu
   âm (khi include_returns). Trigger P: cơ sở x tỷ lệ thu trong kỳ.
5. **Đo lường**: tổng cơ sở của kế hoạch theo người (cho % đạt) và tổng theo từng thành phần (sau bộ lọc).
6. **% đạt** = cơ sở cửa sổ / chỉ tiêu cửa sổ x 100 (chỉ tiêu 0 hoặc trống = không xác định: A, B cho 0 và có cảnh báo).
7. **Thành phần**: áp phương pháp trên cơ sở cửa sổ của thành phần. Cổng min_attainment áp cho P/G/S/A/U.
8. **True-up**: earned = gross cửa sổ - prior_paid (kết quả đã duyệt các kỳ trước trong cùng cửa sổ, cùng kế hoạch, cùng người).
9. **Hoa hồng quản lý**: sau khi có kết quả mọi người, manager nhận override_pct x (cơ sở kỳ hoặc earned) của từng cấp dưới
   trực tiếp (theo cas.manager). Manager không cần là người bán.
10. **Điều chỉnh tay** cộng vào.
11. **Trần**: min(earned + override + adjustments, cap_amount); phần cắt ghi capped.
12. **Draw**: R - nếu số sau trần < draw_amount thì trả bù lên draw_amount và tăng số dư ứng trước; nếu lớn hơn thì thu hồi số
    dư cũ tối đa phần vượt. G - trả bù lên draw_amount, không có số dư.
13. **payable** = kết quả sau draw (không âm; phần âm do clawback chuyển thành số dư ứng trước như draw R).
14. **Phân bổ chi phí**: payable chia theo tỷ trọng cơ sở của từng phân đoạn (department -> sub, class -> workCenter,
    location -> branch, job -> project) của các credit; override và điều chỉnh theo phòng ban của cấp dưới / nhân viên.

Mỗi bước sinh dòng diễn giải song ngữ (`steps`), ví dụ "Thang lũy tiến: 0 - 100.000.000 x 2% = 2.000.000".

## 4. Nguồn dữ liệu NetSuite (đã thử SuiteQL trên td2937310)

- Dòng hóa đơn / cash sale / credit memo: `transaction t JOIN transactionline tl ON tl.transaction = t.id`, `tl.mainline = 'F'
  AND tl.taxline = 'F' AND tl.netamount IS NOT NULL`, loại `CustInvc`, `CashSale`, `CustCred`. Doanh thu dòng = `-tl.netamount`
  (bán hàng mang dấu âm; credit memo dấu dương nên cùng công thức cho ra số âm), giá vốn ước tính = `-tl.costestimate`, số
  lượng = `-tl.quantity`. Dòng COGS phụ (netamount null) tự bị loại. `tl.itemtype`, `tl.item`, `tl.class`, `tl.department`,
  `tl.location`, `tl.subsidiary`, `t.entity` (khách), `t.employee` (salesrep), `t.trandate`, `t.tranid`, `t.foreigntotal`.
- Đội bán: `transactionsalesteam (transaction, employee, salesrole, contribution, isprimary)`; contribution là tỷ lệ (1 = 100%).
- Thu tiền: `previoustransactionlinelink` với `linktype = 'Payment'`, `previoustype = 'CustInvc'`, `previousdoc` (hóa đơn),
  `nextdoc`, `nexttype` (CustPymt, CustCred, DepAppl...), `nextdate`, `foreignamount` (số áp). Tỷ lệ thu trong kỳ = tổng
  foreignamount có nextdate trong kỳ và nexttype trong {CustPymt, DepAppl} / t.foreigntotal của hóa đơn.
- Khách mới: `MIN(t.trandate)` theo `t.entity` trên CustInvc/CashSale; nhóm khách: `customer.category`.
- Chỉ đọc qua truy vấn cố định trong api/Commission.js; không có RESTlet SuiteQL tổng quát.

### 4.1 Nguồn dữ liệu cấu hình theo khách hàng (bổ sung 11/11/2026)

Khách hàng có thể bán qua hệ thống khác (DMS, POS, sàn thương mại điện tử, phần mềm cũ) nên nguồn doanh số phải chọn được:
- comm_plan.source (list cm_source): `N` giao dịch NetSuite (mặc định), `X` dữ liệu ngoài đã nạp, `B` cả hai.
- Record **comm_txn** (tiền tố `cxt`) - vùng đệm doanh số ngoài, cùng hình dạng với dòng chuẩn hóa ở mục 5: subsidiary,
  source_system (text, ví dụ DMS), doc_no (req), line_no, tran_type (list: I hóa đơn, S bán thu tiền ngay, C trả hàng), date
  (req), customer_code, customer_name, customer_category (text), first_sale_date, item_code, item_type, class, department,
  location, project (select), revenue, cost, qty, employee (select, req), team (textarea JSON [{employee, pct}] tùy chọn),
  collected_date, collected_amount (cho trigger P), import_batch (text), note. Khóa chống trùng: subsidiary + source_system +
  doc_no + line_no; nạp lại cùng khóa thì cập nhật. Dòng đã dùng trong bảng tính đã duyệt thì khóa sửa (dùng isinactive để bỏ).
- Cách nạp: (1) màn Hoa hồng có hộp thoại "Nạp doanh số ngoài": dán trực tiếp từ Excel (TSV từ clipboard) hoặc chọn file CSV,
  ánh xạ cột tự nhận theo tên tiêu đề (vi / en), xem trước có kiểm lỗi từng dòng (thiếu mã NV, ngày sai, số không hợp lệ,
  trùng khóa) rồi mới ghi; (2) NetSuite CSV Import Assistant trên record comm_txn cho khối lượng lớn; (3) tích hợp hệ thống
  qua REST record API của NetSuite trên cùng record.
- Mã nhân viên trong file là mã nhân viên (entityid) hoặc email công việc; API dò ra internal id, không thấy thì báo lỗi dòng.
- Bảng tính ghi rõ nguồn của từng credit (NetSuite / tên hệ thống ngoài) trong tab Giao dịch.

Sản lượng (phiếu sản lượng) đã nạp được bằng CSV Import trên record output; mục 9 thêm nguồn giao dịch sản xuất.

## 5. Hợp đồng lõi (core/CommissionEngine.js)

```
normalizeLines(rows, plan) -> lines
  row (data layer): {tranId, tranNo, tranType: 'I'|'S'|'C', date, customer, customerCategory, firstSaleDate, item, itemType,
    classId, department, location, project, revenue, cost, qty, salesRep, team: [{employee, pct}], creditEmployee,
    collectedRatio (trigger P: 0..1 cho kỳ), unpaidRatio (clawback: 0..1, chỉ dòng đến hạn trong kỳ)}
credit(lines, plan, assignments, date) -> credits [{employee, ...line, pct, base, qty}]
calculate({plan, rules, tiers, assignments, quotas, credits, windowCredits, priorPaid, drawBalance, adjustments, from, to})
  -> {results: [{employee, plan, earningType, quota, base, windowBase, attainment, gross, priorPaid, earned, override,
       adjustments, capped, drawPaid, drawRecovered, drawBalance, payable, components: [{rule, name, method, base, amount,
       steps}], steps: [{vi, en}], shares: [{sub, workCenter, branch, project, amount}], warnings: [{code, vi, en}]}]}
simulate({plan, rules, tiers, base, qty, quota}) -> {amount, components, steps}   (màn Mô phỏng)
windowOf(plan, from, to) -> {from, to}   (M: kỳ; Q: đầu quý của `to`; Y: đầu năm của `to`)
```
Tiền làm tròn đồng (Money.round), % làm tròn 2 số. Mọi hàm thuần, không gọi N/*.

## 6. Hợp đồng API (api/Commission.js + route module api/CommissionV2.js)

GET (route module, vai trò acct, payroll, admin; HR xem):
- `commissionView {subsidiary, month}` -> `{run: {id, name, status, from, to, totalBase, totalAmount, employees, batch}|null,
  rows: [{resultId, employee, code, name, department, plan, planName, quota, base, attainment, earned, override,
  adjustments, capped, drawPaid, payable, warnings: n}], kpis: {...}, months: [YYYYMM...]}`
- `commissionResult {id}` -> kết quả đầy đủ + detail (components, steps, credits có tranNo / ngày / khách / mặt hàng)
- `commissionSetup {subsidiary}` -> `{plans: [{...plan, rules: [{..., tiers: []}], assignments: [], quotas: []}], earningTypes,
  lookups: {classes, departments, locations, customerCategories, employees(sales reps)}}`
- `commissionSimulate {plan, base, qty, quota}`
POST actions (acct, admin):
- `commissionCalculate {subsidiary, month, from?, to?}` (tạo hoặc tính lại bảng tính nháp; trả `more: true` nếu cần lượt
  sau), `commissionApprove {run}`, `commissionReopen {run}` (A -> D, cấm khi P), `commissionVoid {run, reason}`
- `commissionPlanSave {plan, rules, tiers, assignments, quotas}` (tạo / sửa; dòng bỏ đi -> isinactive)
- `commissionAdjust {employee, plan, month, amount, reason}`
Lỗi: s4vpError / s4vpErrorVi; JSON trả về không có khóa tên "error" ở bất kỳ cấp nào.

## 7. Nối bảng lương

- api/Payroll.js khi tính: đọc comm_result của comm_run đang hoạt động, cùng công ty con, status `A` (hoặc `P` của chính bảng
  lương này), date_to nằm trong [period.start, period.end]; gom theo nhân viên và earning_type -> `emp.commissionLines:
  [{earningType, amount, shares, runId}]`.
- core/PayrollEngine.js: thêm dòng thu nhập `source: "C"`, quantity 1, rate = amount, mang `shares`.
- core/CostAllocationBuilder.js: dòng `source === "C"` có shares -> đích riêng theo shares (như outputShares).
- Ghi sổ bảng lương: run -> `P` + batch; đảo bảng lương: về `A`.
- Phân tích chi phí lương: thành phần mới `commission` trong cost_fact nếu cần (hoặc gộp vào bonus) - người điều phối quyết.

## 8. Màn hình (spa/payroll/views/commission.js)

Tab chính mới "Hoa hồng" (VIEW_OF_TAB commission). Ba tab con:
- **Bảng tính**: chọn tháng (MonthInput), nút Tính / Duyệt / Mở lại / Hủy trên hàng tiêu đề. Bố cục 6:4: lưới nhân viên có ô tìm
  nhanh (mã, tên, kế hoạch), cột số căn phải; khung phải các tab Diễn giải (steps), Giao dịch (credits, có ô tìm), Phân đoạn
  (shares), Điều chỉnh (thêm điều chỉnh với MoneyInput, lý do bắt buộc).
- **Kế hoạch**: danh sách kế hoạch (ô tìm) + biểu mẫu kế hoạch (control đúng kiểu: ngày, %, tiền, danh sách), lưới thành phần,
  lưới bậc thang của thành phần chọn, lưới phân công (SearchSelect nhân viên, chỉ tiêu, quản lý), chỉ tiêu theo tháng.
- **Mô phỏng**: chọn kế hoạch, nhập doanh số / số lượng / chỉ tiêu -> hoa hồng và diễn giải ngay (what-if).

## 9. Sản lượng từ giao dịch (OutputSources)

Account thử chưa dùng sản xuất (không có Assembly Build / Work Order), nên phần này chỉ kiểm bằng test đơn vị.
- Record out_source (prefix osr): name, subsidiary, tran_type (list: `Build` Assembly Build, `WOCompl` Work Order Completion,
  `ItemShip` Item Fulfillment), employee_field (id trường body hoặc dòng chứa nhân viên), team_field (id trường chứa tổ, tùy
  chọn), rate_table (select rec rate_table, req), qty_sign (int 1 / -1), active.
- Trường mới trên output: src_tran (text, khóa "type:id:line" để không sinh trùng), src (select rec out_source).
- `outputSourcePreview {source, from, to}` -> dòng đề xuất; `outputSourceGenerate {source, from, to}` -> tạo phiếu Tạm giữ
  (cá nhân theo nhân viên, hoặc tổ khi có team_field), mã hạng mục = itemid của mặt hàng, ngày phiếu = ngày chứng từ, phòng
  ban = phòng ban dòng. Phiếu sinh ra vẫn qua duyệt như phiếu nhập tay.

## 10. Phân công file

- Lõi + schema + nối bảng lương: tools/schema/commission.mjs, core/CommissionEngine.js, tests/core/commission*.test.js,
  core/PayrollEngine.js, core/CostAllocationBuilder.js, api/Payroll.js (chỉ phần đọc kết quả và đánh dấu P), tests liên quan.
- API: api/Commission.js, api/CommissionV2.js, scripts/s4vp_rl_api.js (đăng ký route và action), tests/api/commission*.test.js.
- Giao diện: spa/payroll/views/commission.js, spa/payroll/PayrollApp.js (tab), spa/payroll/ui/css.js (tiền tố `s4vp-cm-`),
  spa/payroll/lib/i18n.js (khóa `cm.*`).
- Sản lượng từ giao dịch: tools/schema.mjs (record output thêm trường, record out_source), api/OutputSources.js,
  tests/api/outputsources.test.js, spa/payroll/views/outputsV2.js (nút và hộp thoại). Route/action đăng ký ở
  scripts/s4vp_rl_api.js do người làm API thêm theo yêu cầu.
