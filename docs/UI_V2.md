# Giao diện Lương VN bản 2 - kiến trúc và quy ước

Tài liệu này là hợp đồng chung cho mọi người (và agent) làm giao diện bản 2. Mẫu thiết kế đã được duyệt nằm ở `docs/design/*.dc.html` (HTML tĩnh, mở bằng trình duyệt hoặc đọc mã nguồn): `TrangChu` (Trang chủ), `TinhCong` (Chấm công), `Main` (Chạy lương), `CanhBao` (Chi tiết cảnh báo và nhật ký).

## 1. Nguyên tắc UX (đã chốt với người dùng)

- Theo việc của người dùng, không theo cấu trúc bảng dữ liệu. Không sao chép Acumatica.
- Điều hướng: giữ thanh menu NetSuite; các mục của phân hệ là một hàng tab ngang ngay dưới (Trang chủ, Chấm công, Chạy lương, Nhân sự, Tạm ứng, Báo cáo, Thiết lập). **Không có menu dọc bên trái.**
- Mỗi quy trình (tính công, chạy lương) có thanh các bước; mỗi bước chỉ một nút chính cho việc kế tiếp, nút khác gom vào "In", "Thao tác khác".
- Việc cần xử lý (lỗi, cảnh báo, ngoại lệ) đưa lên trước, có nút xử lý tại chỗ.
- **Mọi lưới đều có ô tìm kiếm** (không phân biệt dấu, khớp tên, mã, số tiền), kể cả lưới con.
- Nhập liệu trong hộp thoại hoặc khung bên phải, không đặt form rời dưới đáy trang.
- Ngày hiển thị dd/mm/yyyy; ô nhập ngày là lịch chọn của trình duyệt (`DateInput`, giá trị ISO). Chọn control theo kiểu dữ liệu ở mục 15. Số tiền căn phải, `font-variant-numeric: tabular-nums`.
- Chạy tốt ở laptop 14 inch (vùng hiển thị khoảng 1536 x 674 CSS px): không đè chữ, bảng rộng cuộn trong khung riêng.
- Tiếng Việt mặc định, có bản tiếng Anh. Dùng dấu gạch ngắn (-), không dùng gạch dài.
- Không dùng emoji làm biểu tượng.

## 2. Kỹ thuật vẽ: HTML thuần trong UIF (đã thử trên td2937310, UIF 10.0.29)

JSX của `@uif-js/core` vẽ được phần tử HTML (`div`, `table`, `button`, `input`, `select`, `textarea`, `a`...). Bản 2 vẽ bằng HTML + CSS để giống mẫu; không dùng `DataGrid`, `StackPanel`, `GridPanel` cho màn mới.

Quy tắc bắt buộc (mỗi điều đã gây lỗi thật khi thử):

| Việc | Đúng | Sai |
| --- | --- | --- |
| Lớp CSS | `class="s4vp-x"` | `className` (bị bỏ qua) |
| Style nội tuyến | `style={{padding: '8px'}}` (đối tượng) | `style="padding:8px"` (**ném lỗi, sập cả màn hình**) |
| Bấm | `onClick={fn}` trên `button` | `a href="#"` (không chặn được điều hướng: handler nhận message của UIF, **không có `preventDefault`**) |
| Nhập | `onInput={fn}` trên `input`, `select`, `textarea` | `onChange`, `onBlur` (**không bắn**) |
| Lấy giá trị | `fn(m)` nhận message của UIF; phần tử DOM ở `m.element` (dự phòng `m._element`) -> `kit.valueOf(m)` | `e.target.value`, `e.preventDefault()` |
| Phím | `onKeyUp` (message có `_key`, `_keyCode`) | |
| Danh sách | `{rows.map((r) => <tr key={r.id}>...</tr>)}`; điều kiện `{cond ? <b/> : null}` đều chạy | |
| CSS chung | chèn một thẻ `<style id="s4vp-css">` vào `document.head` một lần (ui/css.js) | file .css rời |
| Nhiều lớp CSS | `class="s4vp-btn s4vp-btn-primary"` viết bình thường: `lib/jsx-safe.js` tự tách thành mảng | tự gọi jsx-runtime của UIF với chuỗi có dấu cách hoặc chuỗi rỗng (UIF dùng `classList.add`, **ném lỗi, màn hình trắng hoặc không chuyển màn**) |
| Con là boolean | `{cond && <b/>}` viết được: `lib/jsx-safe.js` đổi `true` / `false` thành `null` | đưa đối tượng thường làm con (**ném "Invalid node type"**) |
| Thuộc tính boolean | chỉ đặt khi đúng: `if (disabled) attrs.disabled = 'disabled'` rồi `<button {...attrs}>` (kit đã làm sẵn) | `disabled={false}` (chưa thử; nếu UIF ghi thành thuộc tính HTML thì nút bị khóa) |

Ghi nhớ khác: lỗi ném trong lúc vẽ làm sập toàn màn hình ("ERROR"), nên bọc phần tính toán dễ lỗi; `Error` ném từ promise bị NetSuite bọc mất message, hãy ném đối tượng thường `{message}`; RESTlet không được trả khóa `error` (N/https phía trình duyệt nuốt nội dung) mà trả `s4vpError` / `s4vpErrorVi`.

`tools/build_spa.mjs` trỏ mọi lời gọi JSX qua `spa/payroll/lib/jsx-safe.js` (lớp bọc jsx-runtime của UIF) để chặn hai lỗi trên. Khi UIF ném lỗi lúc vẽ một view mới, cây cũ vẫn đứng yên (hash đổi nhưng màn không đổi) và console chỉ ghi "ERROR h": dò bằng cách gọi `core.VDom.render(phần tử, div)` trong try / catch từ console trình duyệt.

Hook `useState`, `useRef`, `useEffect` lấy từ `@uif-js/core`. Giá trị form đang gõ giữ trong `useRef` rồi `setState` (hai ô cập nhật liền nhau không ghi đè nhau).

## 3. Cấu trúc mã nguồn giao diện

```
spa/payroll/
  SpaClient.js            điểm vào (giữ nguyên)
  PayrollApp.js           khung: nạp bootstrap, tab điều hướng, định tuyến, thông báo, hộp xác nhận
  lib/api.js              call(params) GET, post(body) POST, errorText(e), openRecord(type, id), openJournal(id), printUrl(batchId, doc), download(name, content)
  lib/format.js           money, num, pct, fmtDate, toIso, localToday, toNumber, fold, rowText, quickFilter
  lib/i18n.js             language(), pick(TEXT) -> bảng chữ theo ngôn ngữ
  ui/css.js               CSS chung (tiền tố lớp s4vp-), ensureCss()
  ui/kit.js               thành phần dùng chung (mục 4)
  views/home.js           Trang chủ
  views/attendance.js     Chấm công (tính công)
  views/payrollList.js    Danh sách bảng lương
  views/payrollRun.js     Chạy lương (một bảng lương)
  views/checkDetail.js    Chi tiết cảnh báo và nhật ký
  views/legacy.js         các màn cũ chưa làm lại (sản lượng, giấy phép, báo cáo, hồ sơ, tạm ứng, thiết lập, và bảng lương / chấm công bản cũ) giữ nguyên bằng UIF
```

Mỗi view là một function component `export default function XView({app})` và tự mang bảng chữ `const TEXT = {vi: {...}, en: {...}}` (không sửa file chữ chung). `app` do khung cấp:

```
app.boot                    kết quả bootstrap (user, subsidiaries, periods, paygroups, leaveTypes, earningTypes, recordTypes...)
app.subsidiary              id công ty con đang chọn (chuỗi)
app.route                   {view, params}
app.go(view, params)        chuyển màn (cập nhật hash #/view?k=v)
app.run(label, promise)     chạy thao tác: hiện "đang xử lý", bắt lỗi và báo lỗi; trả promise kết quả (undefined nếu lỗi)
app.notify(text, kind)      thông báo ('ok' | 'warn' | 'error')
app.confirm(text, onYes)    hộp xác nhận cho thao tác khó hoàn tác
app.busy                    chuỗi đang xử lý hoặc ''
app.lang                    mã ngôn ngữ 2 chữ ('vi', 'en', hoặc mã khác khi có bảng chữ)
app.reloadBoot()            nạp lại bootstrap (sau khi đổi thiết lập, sinh kỳ, khóa công); trả promise bootstrap mới
```

Ghi chú khi dùng `app`:

- Khung dựng lại đối tượng `app` ở mỗi lần vẽ: **không đưa `app` vào mảng phụ thuộc của `useEffect`**, chỉ đưa giá trị cần theo dõi (`app.subsidiary`, `app.route.params.id`...).
- `app.run(label, promise)` cũng nhận hàm trả promise. Lỗi được báo trên dải thông báo và promise trả `undefined`, nên luôn kiểm `if (!r) return;`. Dòng "đang xử lý" hiện ở góc phải thanh tab (không đẩy nội dung).
- Kết quả có thể về sau khi người dùng đã rời màn: giữ `const alive = useRef(true)`, đặt `false` trong hàm dọn của `useEffect`, và không `setState` khi `!alive.current` (mẫu: views/payrollList.js).
- `app.notify` thay thông báo đang hiện; thông báo tự xóa khi sang màn khác, lỗi cũ tự xóa khi `app.run` bắt đầu thao tác mới. Muốn báo rồi chuyển màn thì gọi `app.go` trước, `app.notify` sau.
- `app.go` tới đúng route hiện tại là không làm gì. Tham số rỗng / null bị bỏ khỏi hash; mọi tham số đọc lại là chuỗi.
- Đổi view thì view cũ bị gỡ hẳn (state mất); các màn trong legacy.js dùng chung một thành phần nên giữ state khi chuyển qua lại giữa chúng.
- `app.boot` luôn khác null khi view được vẽ (khung chờ bootstrap xong mới vẽ view); `app.subsidiary` có thể là `''` nếu tài khoản không có công ty con nào.

Tên view cho `app.go`: `home`, `attendance` (params `period`), `payrollList`, `payrollRun` (params `id`), `checkDetail` (params `id`, `rule`, `employee`), và các tên cũ `outputs`, `permits`, `reports`, `profiles`, `advances`, `setup`, `batches` (danh sách và chi tiết bảng lương bản cũ), `attendanceLegacy` (chấm công và phép bản cũ). Tên lạ về `home`. Tab sáng: `payrollList`, `payrollRun`, `checkDetail`, `batches` -> Chạy lương; `attendance`, `attendanceLegacy` -> Chấm công; `outputs`, `permits` nằm trong menu "Khác".

## 4. Bộ thành phần `ui/kit.js`

Hàm nhận một đối tượng props và trả JSX; dùng được cả hai cách `<Table rows={rows} />` và `{Table({rows})}`. Dùng các hàm này thay vì tự viết lại để giao diện đồng nhất. Thành phần có trạng thái riêng (Table có ô tìm, Menu, các ô nhập) giữ hook trong thành phần con nội bộ.

```
Page({children})                                   khung nội dung, lề phải chừa nút trợ giúp nổi của NetSuite
PageHeader({crumbs, title, status, sub, actions})  crumbs: [{label, onClick}], status: {text, tone}, actions: mảng nút
Button({label, onClick, kind, disabled, title, small, block, ariaLabel, pressed})
    kind: 'primary' | 'default' | 'ghost' | 'link' | 'danger' | 'dashed'
Menu({label, items, kind, align, disabled, title}) nút mở danh sách thao tác; items: [{label, onClick, disabled, title}]; align: 'right'
Stepper({steps, label})                            steps: [{key, label, note, state, noteTone, onClick}] state: 'done' | 'current' | 'todo'; note là chữ nhỏ
StatCards({cards})                                 cards: [{label, value, note, tone}]
Chips({items, value, onPick, label})               bộ lọc nhanh: [{value, label, count, tone}]
SearchBox({value, onInput, placeholder, width, label})
Tabs({items, value, onPick, label})                [{value, label, count}]
Badge({text, tone, large})                         tone: 'ok' | 'warn' | 'error' | 'info' | 'muted'
Card({title, sub, actions, children, tone, flush, label})   flush: thân thẻ không lề (đặt Table sát mép thẻ)
Table({columns, rows, keyOf, onRowClick, selectedKey, total, empty, search, maxHeight, toolbar, searchPlaceholder, label})
    columns: [{key, label, align: 'left'|'right'|'center', render(row), width, nowrap, type, noRowClick, rowButton}]
        type: 'money' | 'num' | 'pct' | 'date' tự định dạng row[key] (money, num, pct mặc định căn phải)
        render(row) trả JSX hoặc chuỗi; lỗi trong render chỉ làm trống ô
        noRowClick: ô có nút riêng (liên kết, thao tác), bấm trong ô không kích hoạt onRowClick
    search: true -> tự có ô tìm kiếm phía trên (lọc bằng quickFilter trên dữ liệu thô của dòng: muốn tìm theo chữ hiển thị thì đưa chữ đó vào dòng)
    toolbar: JSX đặt bên trái ô tìm (Chips, Select, nút)
    total: dòng tổng (đối tượng cùng khóa) hiện đậm ở cuối, không bị lọc, định dạng theo type của cột, không gọi render
    selectedKey: so với keyOf(row) (mặc định row.id), dòng được tô nền và có vạch nhấn bên trái
    onRowClick(row): cả dòng bấm được; ô đầu được bọc trong nút thật để chọn bằng bàn phím (tắt bằng rowButton: false)
    maxHeight: thân bảng cuộn dọc, tiêu đề dính
Field({label, children, hint, required})           nhãn + ô nhập (bọc bằng <label>); required: dấu * đỏ sau nhãn
TextInput / NumberInput / MoneyInput / DateInput / MonthInput / TimeInput / Select / SearchSelect / AutoSelect / TextArea
    ({value, onInput, placeholder, width, disabled, ariaLabel, title})   onInput nhận giá trị đã đọc
    TextInput thêm type, onEnter; NumberInput căn phải, onInput nhận chuỗi đang gõ (đổi sang số bằng toNumber của lib/format.js);
        có min / max / step thì là <input type="number"> (ví dụ giờ: step 0.5 min 0), không có thì ô chữ gõ được 1.234,5
    MoneyInput: ô chữ căn phải, rời ô thì tự phân tách nghìn (15.000.000), value số thì hiện đã phân tách; decimals (mặc định 2)
    DateInput: <input type="date">, value / onInput là ISO yyyy-mm-dd ('' khi xóa), min / max ISO; trình duyệt không hỗ trợ (hoặc UIF
        không ghi type) thì ô chữ dd/mm/yyyy như cũ: onInput nhận ISO khi gõ đủ một ngày có thật, ngược lại chuỗi đang gõ
    MonthInput (YYYY-MM, <input type="month">), TimeInput (HH:MM, <input type="time">): cùng cách lùi về ô chữ
    Select: options [{value, label}], placeholder là dòng trống đầu danh sách (value ''); TextArea thêm rows
    SearchSelect: cùng props với Select; bấm mở khung có ô lọc (không phân biệt dấu, khớp nhãn và mã), mũi tên / Enter / Esc, tối đa 200 mục
    AutoSelect: Select khi danh sách có tối đa 15 mục, SearchSelect khi dài hơn (danh sách lớn dần theo dữ liệu: kỳ lương, nhân viên, tài khoản)
Checkbox({checked, onInput(boolean), label, disabled, ariaLabel, inField})   có / không; inField khi đặt trong Field (không lồng <label>)
Dialog({title, children, actions, onClose, width}) hộp thoại giữa màn hình; đóng bằng nút góc phải hoặc Esc
SidePanel({title, sub, onClose, children, actions})   khung chi tiết bên phải (không cố định vị trí)
Empty({text})
valueOf(m)                                         đọc giá trị từ message onInput
```

Lớp CSS bố cục dùng trực tiếp: `s4vp-cols` (hàng hai cột co giãn) + `s4vp-col-main` (cột chính) cạnh `SidePanel`; `s4vp-form` (lưới ô nhập trong hộp thoại); `s4vp-line` (một dòng nhãn - số); `s4vp-muted`, `s4vp-small`, `s4vp-num`, `s4vp-link`.

Ô nhập: giá trị đặt từ chương trình (xóa form sau khi lưu) được kit gán lại vào ô sau khi vẽ, trừ ô đang có con trỏ. Ô trong hộp thoại bị gỡ khi đóng hộp thoại nên mở lại luôn sạch.

Màu (biến CSS trong ui/css.js): nền trang `#F3F4F2`, bề mặt `#FFFFFF`, chữ `#1D2730`, chữ phụ `#55616B`, nhấn `#24566B`, viền `#E1E5E8`; tone ok `#0F5132` trên `#DDF1E4`, warn `#6B3A00` trên `#FFE9C7`, error `#8A1C14` trên `#FBE3E0`. Vùng bấm tối thiểu 36 px cao trên màn desktop.

## 5. Máy chủ: mô-đun route

`scripts/s4vp_rl_api.js` giữ nguyên các action cũ và tra thêm trong các mô-đun đã đăng ký. Mô-đun API mới xuất `routes`:

```js
return {
  routes: {
    get:  { homeSummary: { roles: "all", run: (params) => ... } },
    post: { resolveCheck: { roles: "payroll", run: (body) => ... } },
  },
};
```

`roles`: `"all"` (administrator, HR, kế toán), `"hr"` (administrator + HR), `"acct"` (administrator + kế toán), `"payroll"` (cả ba, thao tác trên bảng lương), `"admin"`. Tên action không trùng action cũ. Lỗi nghiệp vụ ném bằng `fail(en, vi)` như các mô-đun hiện có (đối tượng Error có `userMessage`).

Mô-đun đã đăng ký sẵn (file có sẵn, routes rỗng, người làm phân hệ điền vào): `api/Home.js`, `api/PayrollRun.js`, `api/Checks.js`, `api/AuditLog.js`, `api/AttendanceMonth.js`.

Chi tiết đã cài trong RESTlet: route không khai `roles` (hoặc khai giá trị lạ) chỉ administrator chạy được; vai trò không đủ quyền nhận lỗi `s4vpError` "Vai trò của bạn không được thực hiện thao tác này"; `run` trả `undefined` / `null` thì RESTlet trả `{ok: true}`; action trùng tên action cũ không bao giờ được gọi (action cũ thắng); trùng tên giữa hai mô-đun thì mô-đun đăng ký trước thắng (thứ tự: Home, PayrollRun, Checks, AuditLog, AttendanceMonth). GET của route cũng kiểm tra vai trò.

Nhật ký: RESTlet gọi `AuditLog.record({action, batch, period, id, lineId, result})` sau mỗi POST thành công (action cũ lẫn mới; thành công = kết quả không có khóa `s4vpError` / `error`); mô-đun AuditLog quyết định ghi gì. `batch` / `period` được suy ra khi rõ ràng: `body.id` của thao tác trên bảng lương (loadEmployees, syncTime, calculate, removeHold, hold, approve, reject, reopen, release, reverse, agencyBills, clearJob) và trên kỳ (closePeriod, reopenPeriod, lockAttendance, unlockAttendance, buildAttendance, processPunches, loadSheetEmployees), `result.id` của createBatch, `body.batch` / `body.values.batch` / `body.period` / `body.values.period` nếu có; còn lại `id`, `lineId` là khóa thô của body. Lỗi ném từ `record` chỉ ghi log, không làm hỏng thao tác. Lưu ý: `jobStatus` (hỏi trạng thái tác vụ nền) cũng là POST nên cũng được gọi - AuditLog nên bỏ qua.

Quy ước có sẵn cần giữ: đọc bằng `Store.find / Store.get / Store.run` (SuiteQL, alias có tiền tố `c_`), ghi bằng `Store.create / update / submit / remove`; ngày là chuỗi ISO `YYYY-MM-DD`; không ghi lương, số định danh vào log; không xóa vĩnh viễn dữ liệu nghiệp vụ; governance: việc nặng theo lô.

## 6. Dữ liệu mới

`tools/schema.mjs` nạp thêm định nghĩa từ `tools/schema/*.mjs` (mỗi file xuất `lists` và `records`, cùng dạng với schema.mjs: `export const lists / records`, hoặc `export default {lists, records}`, hoặc `export default ({SETUP, PAYROLL, PROFILE, ROLE_HR, ROLE_ACCT, DOC_COMMON}) => ({lists, records})` khi cần hằng quyền dùng chung). File phần **không import schema.mjs** (vòng lặp import). File tên bắt đầu bằng `_` bị bỏ qua. List hoặc record trùng id với phần đã có thì gen báo lỗi. Mỗi phân hệ chỉ sửa file của mình. Tiền tố trường phải duy nhất:

| File | Tiền tố record dành riêng |
| --- | --- |
| tools/schema/checks.mjs | `bck` (kết quả xử lý cảnh báo), `blg` (nhật ký) |
| tools/schema/attendance.mjs | `atd` |
| tools/schema/home.mjs | `hom` |
| tools/schema/payrollrun.mjs | `prn` |

Sau khi sửa schema chạy `node tools/gen_objects.mjs`. Record mới cần deploy hai bước (`tools/deploy_two_pass.py`) - người điều phối làm.

## 7. Lõi và kiểm thử

`core/RunSteps.js` (đã có, test `tests/core/runsteps.test.js`): `payrollSteps(batch, period, counts)` trả 6 bước `prepare, attendance, calculate, review, approve, post`; `attendanceSteps(period, counts)` trả 4 bước `collect, exceptions, lock, handoff`; mỗi bước `{key, state, note?, count?}` (note là mã: `employees`, `locked`, `open`, `hold`, `openChecks`, `rejected`, `pending`, `reversed`, `openExceptions` - giao diện đổi thành chữ); `progress(steps)` trả `{done, total, currentKey}`. Quy tắc chi tiết ở đầu file.

Mọi phép tính, quy tắc đặt trong `src/FileCabinet/SuiteScripts/com.s4.vnpayroll/core/*.js` (AMD thuần, không gọi N/*), có test Jest trong `tests/core/` (mẫu: `tests/core/timesheet.test.js`, nạp bằng `core("Tên")` từ `tests/core/helpers`). `npx jest` phải đạt toàn bộ.

## 8. Phân công file (không sửa file ngoài phần của mình)

| Phân hệ | File được sửa |
| --- | --- |
| Nền (khung) | PayrollApp.js, lib/*, ui/*, views/legacy.js, s4vp_rl_api.js, tools/schema.mjs, tools/gen_objects.mjs, core/RunSteps.js |
| Trang chủ | views/home.js, api/Home.js, core/Deadlines.js, tools/schema/home.mjs, tests của mình |
| Chạy lương | views/payrollList.js, views/payrollRun.js, api/PayrollRun.js, core/PayCompare.js, tools/schema/payrollrun.mjs, tests của mình |
| Kiểm tra và nhật ký | views/checkDetail.js, api/Checks.js, api/AuditLog.js, core/PayrollChecks.js, tools/schema/checks.mjs, tests của mình |
| Chấm công | views/attendance.js, api/AttendanceMonth.js, core/AttendanceMonthGrid.js, tools/schema/attendance.mjs, tests của mình |

Cần thay đổi ở file dùng chung (thêm thành phần vào kit, sửa `api/Payroll.js`...): ghi yêu cầu vào báo cáo cuối cho người điều phối, và tạm tự xử lý trong file của mình.

Không ai ngoài người điều phối chạy `suitecloud project:deploy`, commit, push. Kiểm biên dịch giao diện bằng `node tools/build_spa.mjs` (ghi đè file build, không sao).

## 9. Hợp đồng giữa các phân hệ (để làm song song)

Mỗi phân hệ chỉ gọi phân hệ khác qua các điểm dưới đây; bên gọi phải chạy được khi bên kia chưa có (kiểm `typeof X.fn === "function"`, hoặc bắt lỗi rồi coi như danh sách rỗng).

Kiểm tra và nhật ký (`api/Checks.js`, `api/AuditLog.js`) cung cấp:

- Hàm máy chủ `Checks.summary(batchId)` -> `{open, errors, warnings, resolved}` (số nguyên) để Chạy lương và Trang chủ dùng cho thanh bước và thẻ số liệu.
- GET `checksList` `{batch}` -> `{counts: {open, errors, warnings, resolved}, items: [{key, rule, severity: 'error'|'warn'|'info', title, employee, employeeName, lineId, amount, status: 'open'|'accepted'|'resolved', assignee, note}]}`; `key` = `rule` + ":" + `employee` (hoặc `rule` nếu cảnh báo cấp bảng lương).
- GET `checkDetail` `{batch, rule, employee}`; POST `resolveCheck` `{batch, rule, employee, status, note, assignee}`.
- GET `auditLog` `{batch}` hoặc `{period}` -> `{items: [{at, user, action, text, lineId}]}` (mới nhất trước).
- Màn `checkDetail` nhận params `id` (bảng lương), `rule`, `employee`, `tab` (`log` để mở thẳng nhật ký).

Chạy lương (`api/PayrollRun.js`) cung cấp:

- GET `runView` `{id}` -> toàn bộ dữ liệu màn chạy lương (bảng lương, kỳ, các bước theo `core/RunSteps`, dòng nhân viên, so sánh với kỳ trước theo `core/PayCompare`).
- Màn `payrollRun` nhận params `id`, `tab`; bấm một cảnh báo thì `app.go('checkDetail', {id, rule, employee})`; danh sách cảnh báo lấy bằng GET `checksList`.

Chấm công (`api/AttendanceMonth.js`) cung cấp GET `attendanceMonth` `{period, subsidiary}`; màn `attendance` nhận params `period`. Khi công đã khóa, nút "Sang chạy lương" gọi `app.go('payrollList')`.

Trang chủ (`api/Home.js`) cung cấp GET `homeSummary` `{subsidiary}`; chỉ đọc (kỳ, bảng lương, bảng công, hạn nộp theo `core/Deadlines`), điều hướng bằng `app.go` tới các màn trên.

Các thao tác đã có trên bảng lương và bảng công (createBatch, loadEmployees, syncTime, calculate, hold, removeHold, approve, reject, reopen, release, reverse, lockAttendance, unlockAttendance, buildAttendance...) dùng lại action cũ của RESTlet, không viết lại.

Bổ sung sau khi dựng (10/11/2026):

- `Checks.summary`: `open` = lỗi + cảnh báo chưa đóng, mục mức info không tính. Thêm `Checks.blockers(batchId)`, `Checks.assertApprovable(batchId)`; `Payroll.approve` gọi `assertApprovable` nên còn lỗi mức error thì máy chủ từ chối duyệt.
- `checksList` trả thêm `batch`, `blocking`, `assignees`; mỗi item thêm `headline`, `employeeCode`, `assigneeName`, `reopened`, `canClose`. Cảnh báo đã đóng tự mở lại khi số liệu đổi.
- Chạy lương: thêm GET `runLine` `{id, line, prev?}` (chi tiết một nhân viên) và POST `submitRun` `{id}` (gửi duyệt: C -> P). Màn `payrollRun` nhận thêm params `tab`, `line`.
- Chấm công: thêm GET `attendanceEmployee` `{period, employee}`; `attendanceMonth` không truyền `period` thì máy chủ chọn kỳ mở, chưa khóa công, gần hôm nay nhất. Không có POST mới.
- RESTlet: mọi lỗi (kể cả từ chối quyền, action lạ) trả `s4vpError` / `s4vpErrorVi`; không còn nhánh trả `error`.
- Trình duyệt giữ bản SpaClient cũ sau deploy: đổi hash không tải lại trang, phải tải lại hẳn (F5).

## 10. Đa ngôn ngữ

- Có sẵn tiếng Việt và tiếng Anh; ngôn ngữ theo tùy chọn LANGUAGE của người dùng NetSuite. `lib/i18n.js`: `language()` trả mã 2 chữ; `pick(TEXT)` gộp sâu theo thứ tự ngôn ngữ đang dùng -> en -> vi. Thêm ngôn ngữ thứ ba: thêm `TEXT.<mã>` trong từng view, không sửa cơ chế.
- Không so sánh `language() === 'vi'` trong view: dùng `isVi()`, `serverText(en, vi)`, `localized({vi, en})`, `serverLanguage()` (máy chủ hiện chỉ có vi / en nên ngôn ngữ khác gửi 'en').
- Mọi chữ hiển thị nằm trong TEXT với đủ khóa vi và en. `node tools/check_i18n.mjs` (và test `tests/tools/check_i18n.test.js`) báo khóa thiếu, chữ Việt trong bản en, chữ Việt viết cứng ngoài TEXT; phải thoát mã 0 trước khi commit.
- Chưa đa ngôn ngữ (ngoài SPA): nhãn object SDF (tên record, trường, giá trị list, menu chỉ tiếng Việt), tên dữ liệu mặc định khi nạp (ghi một bản theo ngôn ngữ người nạp), diễn giải bút toán (chốt theo người ghi sổ), một số lỗi máy chủ ghép "English / Tiếng Việt" trong một chuỗi.

## 11. Bố cục gọn và hiệu năng (10/11/2026)

Bố cục (theo góp ý người dùng trên laptop 14 inch): lề trang 12 px trái, 52 px phải (chừa nút trợ giúp nổi), khoảng cách khối 12 px (biến `--s4vp-pad-l`, `--s4vp-pad-r`, `--s4vp-gap`); hai cột lưới chính : khung chi tiết = 6 : 4 (`s4vp-col-main` : `s4vp-col-side` / `s4vp-side`); không có hàng đường dẫn - `PageHeader` lấy mục `crumbs` cuối có `onClick` (hoặc prop `back`) làm nút "‹" trước tiêu đề; nút thao tác cùng hàng tiêu đề; dải "tham số pháp lý chưa đối chiếu" chỉ hiện ở Trang chủ.

Hiệu năng (đo trên td2937310, bảng lương 4 nhân viên, lượt gọi nóng): bootstrap 0,7 -> 0,3 giây, runView (đã gồm danh sách cảnh báo) 1,2 + 1,0 -> 0,9 giây, homeSummary 1,3 -> 0,9, attendanceMonth 1,2 -> 0,6; từ lúc script SPA chạy đến lúc có dữ liệu màn Chạy lương khoảng 5,4 -> 0,9 giây.

- `lib/api.js`: địa chỉ RESTlet hỏi một lần; `prefetch(params)` gửi lượt đọc song song với bootstrap, `call()` cùng tham số nhận lại kết quả đó (khung dùng cho `payrollRun`).
- RESTlet: bootstrap nhớ trong N/cache theo người dùng (ttl 300 giây, mọi POST thành công làm mất hiệu lực, `fresh=1` để bỏ qua; `app.reloadBoot()` luôn gửi `fresh=1`). Sửa bản ghi bằng form chuẩn NetSuite thì tối đa 5 phút sau khung mới thấy.
- `Store`: bảng mã custom list nhớ chung trong N/cache (ttl 1 giờ, mã lạ thì đọc lại); lượt GET gộp truy vấn trùng (`Store.memoize(true)`, thao tác ghi xóa bản nhớ).
- `runView` trả kèm `checksList` (`{counts, items}`); giao diện không gọi `checksList` riêng nữa.
- Đo: thêm `&timing=1` vào lượt GET (chỉ administrator) để nhận `_timing: {ms, queries: [{q, ms, rows}]}`.

## 12. Chạy lương theo bố cục cha - con của bản cũ, và thử tải 1.000 nhân viên (10/11/2026)

Bố cục (người dùng yêu cầu giữ cách tổ chức dữ liệu của bản cũ, chia hai cột 50% - 50%): dưới thẻ số liệu là `s4vp-cols-half` gồm lưới nhân viên (trái) và khung chi tiết luôn hiện (phải, mặc định chọn dòng đầu). Tab theo nhân viên (GET `runLine`, tải cho một nhân viên): Thu nhập, Khấu trừ khác, Bảo hiểm, Thuế TNCN, Công, Giờ công (timesheet từng ngày, sửa giờ), Phân bổ dự án, Cấn trừ tạm ứng, So kỳ trước. Tab cấp bảng lương: Cần soát (thay thẻ "Kiểm tra trước khi duyệt"), Bút toán (action `journal`, tải khi mở tab), Bill cơ quan thu. Tỷ lệ 6 : 4 vẫn dùng cho các màn khác.

`runLine` trả thêm `attendance`, `tax`, `timesheet`; không gọi hàm nạp cả bảng lương. `runView.checksList` chỉ gồm 200 cảnh báo đầu (lỗi và mục chưa đóng trước) kèm `total`, `truncated`, `groups` (số lượng theo quy tắc), `byEmployee` (số điểm mở theo nhân viên); `checksList` nhận thêm `limit`, `rule`, `brief`.

Thử tải trên td2937310 (công ty con 13, 1.000 nhân viên thử "S4VP TEST LT0001-LT1000" tạo bằng action admin `generateTestBulk`, bảng lương BL000008 kỳ 202704 có 1.004 dòng):

| Việc | Kết quả |
| --- | --- |
| Tạo 1.000 nhân viên + hồ sơ lương | khoảng 12 phút (4 luồng, 40 người mỗi lượt gọi) |
| Tải nhân viên vào bảng lương | khoảng 8 dòng / giây, hơn 2 phút; một lượt gọi không ghi hết nên `loadEmployees` làm theo lượt (`more: true`, `lib/api.js` tự gọi lại) |
| Tính lương (Map/Reduce) | 367 giây, không dòng lỗi |
| runView (nóng) | 1,3 giây máy chủ, 0,9 MB |
| runLine (bấm một nhân viên) | 1,0 giây máy chủ |
| checksList đầy đủ (3.007 mục) | 0,8 giây máy chủ, 1 MB |
| homeSummary | 2,4 giây |
| attendanceMonth | 3,2 giây, 0,4 MB |
| profiles (màn Nhân sự) | 1,6 giây, 0,9 MB |
| Lọc nhanh trên lưới 1.004 dòng | 0,2 giây |

Đã sửa trong lượt thử: `loadEmployees` chạy theo lượt và bỏ qua dòng không đổi; `employeesInfo` ghép id thẳng vào câu lệnh và lấy tên phòng ban bằng JOIN (1,06 -> 0,25 giây cho 900 nhân viên); giới hạn danh sách cảnh báo trong runView. Chưa làm: thu gọn dữ liệu dòng của runView (0,9 MB), phân trang phía máy chủ cho màn Kiểm tra và Nhân sự, tăng tốc attendanceMonth và homeSummary; chưa thử duyệt, ghi sổ, in phiếu lương, file ngân hàng với 1.000 dòng.

## 13. Phân tích chi phí lương (hợp đồng dữ liệu)

Mục tiêu (người dùng, 10/11/2026): thế mạnh của gói là tích hợp kế toán, hạch toán chi phí lương rất mịn; báo cáo và dashboard phải khai thác điều đó để phân tích sâu biến động chi phí lao động so với giá vốn và lãi lỗ.

Thực trạng dữ liệu: chi tiết đầy đủ nằm ở `batch_emp.detail` (earnings theo loại thu nhập, insurance theo thành phần, allocations theo tài khoản - phòng ban - dự án - địa điểm - class, giờ); bút toán gộp theo tài khoản x phòng ban x dự án x địa điểm (x class), không có nhân viên hay loại thu nhập. Vì vậy phân tích đọc từ BẢNG SỐ LIỆU (fact) do gói ghi khi ghi sổ, và đối chiếu với sổ cái.

Bảng số liệu `cost_fact` (tools/schema/analytics.mjs, tiền tố `lcf`): mỗi dòng = một bảng lương x tháng kế toán (YYYYMM theo ngày bút toán) x tài khoản chi phí x phòng ban x class x địa điểm x dự án x loại lao động (E / C) x thành phần chi phí; giá trị: số tiền, số giờ (nếu có). Thành phần (`component`): `wages` (lương, phụ cấp cố định theo công), `overtime`, `allowance`, `bonus`, `piecework` (lương khoán, sản lượng), `other`, `employerIns` (BH, KPCĐ doanh nghiệp đóng), `accrued13` (trích lương tháng 13), `contractor` (thù lao cộng tác viên). Ghi khi ghi sổ bảng lương; đảo bảng lương thì đánh dấu dòng không còn hiệu lực (không xóa). Số người (headcount) và chi phí theo nhân viên lấy từ `batch_emp` (trường vô hướng), không lưu trong fact.

Phân loại lao động trong giá vốn / chi phí hoạt động: theo LOẠI TÀI KHOẢN NetSuite của tài khoản chi phí (COGS -> trong giá vốn; còn lại -> chi phí hoạt động), tức đúng cách báo cáo lãi lỗ của NetSuite phân loại. Không gắn cứng số hiệu 622 / 627 / 641 / 642.

Số liệu sổ cái (doanh thu, giá vốn, chi phí, lãi) đọc bằng SuiteQL theo công ty con và kỳ kế toán, gom theo loại tài khoản; vai trò không có quyền đọc giao dịch thì trả `notes: ['NO_GL_ACCESS']` và các tỷ lệ theo doanh thu để trống.

Route (api/LaborAnalytics.js, roles "acct"):

- GET `laborAnalytics` `{subsidiary, month?: 'YYYY-MM', compare?: 'YYYY-MM' | 'prev' | 'yoy', dim?: 'department'|'project'|'class'|'location'|'account'|'component'|'employmentType'}` ->
  `{subsidiary, month, compare, months: [{month, labor, laborCogs, laborOpex, wages, overtime, allowance, bonus, piecework, other, employerIns, accrued13, contractor, headcount, hours, revenue, cogs, opex, netIncome, hasGl}]` (12 tháng đến `month`), `kpis: {labor, laborToRevenue, laborInCogs, laborInOpex, headcount, costPerHead, overtimeShare, costPerHour}` (mỗi mục `{cur, prev, yoy}`), `bridge: [{key, amount}]` (từ kỳ so sánh đến kỳ này: `start`, `headcount` (thay đổi số người x chi phí bình quân kỳ trước), `wages` (thay đổi mức lương bình quân), `overtime`, `allowance`, `bonus`, `piecework`, `other`, `employerIns`, `accrued13`, `contractor`, `end`; tổng các bước = `end - start`), `breakdown: {dim, dims, rows: [{key, label, cur, prev, diff, pct, share, headcount, prevHeadcount, perHead, components}]}`, `pnl: [{key: 'revenue'|'cogs'|'laborCogs'|'grossProfit'|'opex'|'laborOpex'|'operatingProfit', cur, prev, diff, pct, ofRevenue}]`, `reconcile: {rows: [{account, accountNumber, accountName, payroll, gl, difference}], ok}`, `notes: [mã]}`. Mã `notes`: `NO_FACTS`, `NO_GL_ACCESS`, `NO_COMPARE`, `FACTS_OUTDATED`.
- GET `laborDrill` `{subsidiary, month, compare, dim, key}` -> `{rows: [{employee, code, name, department, cur, prev, diff, pct, components}]}` (tính từ chi tiết dòng bảng lương của các bảng lương trong tháng, cho đúng một nhóm).
- POST `rebuildLaborFacts` `{subsidiary, month?}` (roles "acct") -> lập lại fact cho các bảng lương đã ghi sổ (theo lượt, trả `more: true` khi chưa xong - lib/api.js tự gọi lại).

Màn `laborAnalytics` (tab "Phân tích chi phí", params `month`, `compare`, `dim`): thẻ chỉ số, xu hướng 12 tháng, cầu biến động, bảng phân rã theo chiều có ô tìm và bấm dòng để xem tới nhân viên, bảng lãi lỗ có tách phần lao động, đối chiếu sổ cái.

## 14. Backlog đợt 1 và 2 (phân công file)

Khung đã có sẵn và đã đăng ký (view trong PayrollApp, mô-đun route trong RESTlet): người làm chỉ điền vào file của mình, KHÔNG sửa PayrollApp.js, scripts/s4vp_rl_api.js, ui/kit.js (thiếu gì tự làm trong view và ghi vào báo cáo); ui/css.js chỉ THÊM lớp có tiền tố riêng.

| Phân hệ | File | Tiền tố CSS / schema |
| --- | --- | --- |
| Nhân sự | views/employees.js (view `employees` danh sách, `employee` hồ sơ một người với params `id`, `tab`), api/HrCore.js, core/Hr*.js, tools/schema/hr.mjs | `s4vp-hr-`, `hrc` (hợp đồng), `hrd` (quyết định) |
| Báo cáo - tờ khai | views/reportsHub.js (view `reportsHub`, params `report`), api/ReportsHub.js | `s4vp-rp-` |
| Tạm ứng | views/advancesV2.js (view `advancesV2`), api/AdvancesV2.js | `s4vp-adv-` |
| Thiết lập | views/setupHub.js (view `setupHub`, params `section`), api/SetupHub.js | `s4vp-st-` |

Tab điều hướng vẫn trỏ về màn cũ cho tới khi người điều phối chuyển (VIEW_OF_TAB). Màn cũ tương ứng nằm trong views/legacy.js (`profiles`, `reports`, `advances`, `setup`) - đọc để biết action và dữ liệu sẵn có, không sửa.

Đợt 1 đã gộp (10/11/2026): tab Nhân sự -> `employees` (hồ sơ `employee`), Tạm ứng -> `advancesV2`, Báo cáo -> `reportsHub`; màn cũ vẫn mở được bằng `app.go('profiles' | 'advances' | 'reports')`. Route mới: HrCore (`employeesPage`, `employeeCard`, `hrLookups`, `hrSaveContract`, `hrActivateContract`, `hrTerminateContract`, `hrSaveDecision`, `hrApplyDecision`, `hrSaveDependent`), ReportsHub (`reportsCatalog`, `reportsHtkk`, `reportsFund`, `reportsPitLedger`), AdvancesV2 (`advancesView`, `employeeSearch`), Checks (`resolveCheckGroup`; `checksList` nhận `severity`, `status`, `q`, `offset`), LaborAnalytics (`laborDrill` trả `batch`, `line`; `fresh=1`). Record mới: `contract` (hrc), `decision` (hrd). `api/Lean.js`: bộ đọc gọn (chỉ cột cần, id ghép thẳng). runView `lines[]` chỉ còn các trường lưới dùng; attendanceMonth nén thêm `cellRows`, `totalsTable`. Trích tháng 13 chia theo cơ cấu phân bổ GROSS của nhân viên (`detail.accrual13`), `detail.pit` tách giảm trừ bản thân / người phụ thuộc - chỉ với bảng lương tính sau thay đổi.

Đợt 2 (phân công file; cùng quy tắc mục 14):

| Phân hệ | File | Tiền tố |
| --- | --- | --- |
| Thiết lập | views/setupHub.js (`setupHub`, params `section`), api/SetupHub.js | `s4vp-st-` |
| Sản lượng - lương khoán | views/outputsV2.js (`outputsV2`), api/OutputsV2.js | `s4vp-out-` |
| Bản in | core/PrintModel.js, core/Print*.js mới, scripts/s4vp_sl_print.js, mẫu in | - |
| Duyệt nhiều cấp, nhật ký nhân sự, thông báo hai ngôn ngữ | api/Approvals.js, tools/schema/approvals.mjs (`apv`), api/AuditLog.js, phần approve / reject / submit trong api/Payroll.js và api/PayrollRun.js, views/payrollRun.js (chỉ phần duyệt) | `apv` |
| Tự phục vụ | scripts/s4vp_sl_my_payroll.js, core/SelfService*.js | - |
| Tính lương nền nhanh hơn | scripts/s4vp_mr_calculate.js, phần calculate trong api/Payroll.js | - |

Đợt 2 đã gộp (11/11/2026): tab Thiết lập -> `setupHub` (cũng là đích khi chưa thiết lập), menu Khác -> `outputsV2`. Mới: duyệt nhiều cấp (`approval_step` apv, `approval_log` apl; core/ApprovalFlow; GET `approvalState`, POST `approveStep` / `rejectStep`; mặc định tắt), nhật ký gắn nhân viên (`audit_log.employee`), thông báo máy chủ một ngôn ngữ (`fail(en, vi)`), cổng tự phục vụ (scripts/s4vp_sl_my_payroll.js + core/SelfService*.js; lọc cứng theo người đăng nhập), bản in mới của Suitelet in (`timesheet`, `contractorStatement`, `teamSplit`, `commission`, `contract`, `decision`), tính lương nền theo lô gọn (lô 100, ngữ cảnh tĩnh nhớ N/cache, concurrency 2), PayrollEngine trả `pitDetail`.

Quy tắc bắt buộc (học từ account thật): JSON trả về qua RESTlet KHÔNG có khóa tên `error` ở bất kỳ cấp nào - N/https phía trình duyệt từ chối cả phản hồi và giao diện chỉ thấy "Cannot read properties of undefined (reading 'message')".

## 15. Control nhập liệu (11/11/2026)

Người dùng rà cổng thật: "rà soát các control, vd: data thì phải xài date picker". Quy tắc chọn control theo kiểu dữ liệu, áp cho SPA (ui/kit.js) và cổng tự phục vụ (core/SelfServicePage.js):

| Dữ liệu | Control | Ghi chú |
| --- | --- | --- |
| Ngày | `DateInput` = `<input type="date">` | Lịch chọn của trình duyệt, hiển thị theo ngôn ngữ trình duyệt (vi: dd/mm/yyyy), vẫn gõ được; giá trị ISO yyyy-mm-dd; đặt min / max hợp lý; cặp từ / đến thì ô "đến" có min = ô "từ" |
| Tháng, kỳ thuế dạng YYYY-MM | `MonthInput` = `<input type="month">` | Firefox, Safari desktop không có ô tháng: lùi về ô chữ yyyy-mm (nhận mm/yyyy) |
| Kỳ dạng mã (YYYYMM, kỳ lương) | `AutoSelect` | Danh sách lấy từ dữ liệu, dài dần theo năm |
| Giờ trong ngày | `TimeInput` = `<input type="time">` | |
| Số giờ, số lượng, hệ số | `NumberInput` có `min` / `step` (giờ: step 0.5, min 0) | Ô số căn phải, `inputmode="decimal"`. Giá trị đưa vào ô phải là số dạng dấu chấm ("7.5"); nơi đang giữ chuỗi kiểu Việt ("7,5", ví dụ lưới sản lượng outputsV2) thì giữ ô chữ không có step |
| Số tiền | `MoneyInput` | Căn phải, rời ô thì phân tách nghìn; khi lưu đọc bằng `toNumber` (nhận cả 15.000.000 và 15000000) |
| Danh sách dài (hơn khoảng 15 mục: nhân viên, dự án, phòng ban, tài khoản, nhà cung cấp, loại thu nhập, kỳ lương) | `SearchSelect` (hoặc `AutoSelect` khi độ dài thay đổi) | Ô lọc + danh sách bấm chọn; bàn phím: mũi tên, Home / End, Enter, Esc |
| Danh sách ngắn cố định | `Select` | |
| Có / không | `Checkbox` | Ba trạng thái (có / không / kế thừa) vẫn là `Select` có dòng trống |
| Chữ | `TextInput` / `TextArea` | |

Trường bắt buộc: `Field required` (dấu * đỏ) và kiểm tại chỗ (lỗi hiện ngay dưới ô, như các form hiện có). Mặc định hợp lý: ngày làm thêm = hôm nay, loại nghỉ = phép năm, ngày thử tài khoản chi phí = hôm nay của máy chủ.

Kỹ thuật (UIF): thuộc tính HTML thường (`type`, `min`, `max`, `step`, `inputmode`) truyền qua JSX như `type="search"` đang chạy; kit đặt lại `min` / `max` / `step` sau khi vẽ bằng DOM (như cách gán lại `value`) để không phụ thuộc UIF. Sau khi vẽ ô ngày, kit kiểm `input.type === 'date'`; khác thì lùi mọi ô cùng kiểu về ô chữ. UIF không bắn `onBlur` / `onChange`: MoneyInput (rời ô) và Checkbox (đổi) gắn trình nghe gốc `focusout` / `change` một lần cho phần tử. SearchSelect xử lý phím bằng trình nghe gốc trên ô lọc và chặn Esc lan ra hộp thoại bao ngoài. Test: `tests/tools/kit_controls.test.js` (nạp kit.js bằng TypeScript với jsx-runtime giả). Chưa thử trên UIF thật (td2937310): ô ngày, ô số có step, Checkbox, SearchSelect.

Đã áp (11/11/2026): Tạm ứng (ngày bắt buộc, tài khoản tiền -> AutoSelect, số tiền -> MoneyInput), Chấm công (kỳ, ký hiệu -> AutoSelect, điều chỉnh công -> ô số -1..1 bước 0,5), Kiểm tra (người phụ trách -> AutoSelect), Nhân sự (lương -> MoneyInput, phòng ban và các chiều phân bổ -> AutoSelect, tỷ lệ % -> ô số 0..100), Phân tích chi phí (ô gõ YYYY-MM -> MonthInput), Sản lượng (bảng giá, tổ, kỳ, dự án, mặt hàng -> AutoSelect; đơn giá, tiền chia -> MoneyInput), Danh sách bảng lương (kỳ -> AutoSelect), Chạy lương (giờ công -> ô số bước 0,5; loại thu nhập -> AutoSelect; đơn giá, số tiền khấu trừ -> MoneyInput), Báo cáo (tháng -> AutoSelect, số C12-TS -> MoneyInput), Thiết lập (có / không -> Checkbox, tiền -> MoneyInput, tài khoản / nhà cung cấp / đối tượng / người duyệt / công ty con -> AutoSelect, năm sinh kỳ và cấp duyệt -> ô số bước 1).

## 16. Cổng tự phục vụ: tab Tổng quan và portlet Employee Center (11/11/2026)

- Tab đầu tiên và mặc định "Tổng quan" (GET `op=dashboard`, core/SelfServiceOps): biến động thu nhập 12 kỳ đã ghi sổ (SVG nội tuyến: cột tổng thu nhập, đường thực lĩnh, nhãn số ở kỳ mới nhất và kỳ cao nhất; màn hẹp 6 kỳ) với 3 chỉ số (thực lĩnh kỳ gần nhất so kỳ trước, bình quân 6 kỳ, thuế TNCN đã khấu trừ trong năm); dòng thời gian lương (compensation), quyết định đã áp dụng (decision), hợp đồng; người phụ thuộc (số đang giảm trừ, sắp hết giảm trừ trong 90 ngày, mã số thuế che); việc của tôi (đơn đang xử lý, phép còn lại, hạn phép chuyển, hợp đồng hết hạn trong 60 ngày). Dữ liệu biểu đồ dựng ở máy chủ (`SelfService.payTrend`, `niceScale`). Số truy vấn cố định (test).
- Form đơn: ô ngày `<input type="date">` (min / max: nghỉ, công tác từ đầu năm trước đến hết năm sau; làm thêm từ đầu tháng trước đến 60 ngày tới), số giờ làm thêm ô số bước 0,5; loại nghỉ mặc định là phép năm (loại được chính sách phép năm trỏ tới, không có thì mã PN, không có thì loại đầu tiên còn số dư) và hiện số ngày còn lại dưới ô chọn. Máy chủ nhận ngày ISO (và dd/mm/yyyy cho tương thích).
- Suitelet: `&view=dashboard|pay|leave|requests|me` chọn tab mở đầu; `&embed=1` bản gọn chỉ tab Tổng quan, không có thanh tab, nút "Mở đầy đủ".
- Portlet `customscript_s4vp_pl_my_payroll` (scripts/s4vp_pl_my_payroll.js, HTML portlet, chạy bằng quyền người xem nên không đọc record lương): dòng tóm tắt + iframe cao 900 px tới Suitelet `view=dashboard&embed=1&ifrmcntnr=T`. Để hiện sẵn trên tab "Lương của tôi" của Employee Center: quản trị viên mở dashboard của role Employee Center, thêm portlet "S4VP My Payroll" vào tab đó, rồi Publish Dashboard cho role (hoặc từng người tự Personalize > thêm portlet).
