# Nạp dữ liệu máy chấm công cấu hình được (11/11/2026)

Mục tiêu: mỗi khách, mỗi máy hoặc hệ thống chấm công khai một **hồ sơ nguồn** (ánh xạ cột, định dạng ngày giờ, kiểu dòng),
mã người trên máy được đối chiếu sang nhân viên qua **bảng đối chiếu mã chấm công**. Người dùng chọn file hoặc dán từ Excel,
xem trước có kiểm lỗi từng dòng, gán nhanh mã chưa đối chiếu, rồi ghi theo lượt không giới hạn 500 dòng. Xử lý chấm công
chạy nền khi khối lượng lớn. Bổ sung, không thay cách nạp cũ (action `importPunches` giữ nguyên).

## 1. Dữ liệu (tools/schema/punchimport.mjs)

### punch_source - Hồ sơ nguồn chấm công (includeName: mã nguồn, ví dụ ZK-XUONG)
- subsidiary (select subsidiary, trống = mọi công ty), description
- layout (list ps_layout): `E` mỗi dòng một lượt chấm; `P` mỗi dòng có giờ vào và giờ ra (một ngày); `Z` ZKTeco attlog
  (tab, không tiêu đề: mã, thời điểm yyyy-mm-dd HH:mm:ss, các cột trạng thái bỏ qua)
- has_header (check, mặc định T), skip_lines (int, số dòng đầu bỏ qua trước tiêu đề)
- delimiter (list ps_delim): `A` tự nhận (tab, chấm phẩy, phẩy theo dòng đầu), `C` phẩy, `S` chấm phẩy, `T` tab
- col_emp, col_datetime, col_date, col_time, col_in, col_out, col_device (text): tên cột trên dòng tiêu đề (không phân biệt
  hoa thường, bỏ dấu) hoặc số thứ tự cột từ 1. Layout E dùng col_datetime, hoặc col_date + col_time. Layout P dùng col_date +
  col_in + col_out.
- date_format (list ps_datefmt): `YMD`, `DMY` (mặc định), `MDY`. Luôn nhận thêm số ngày kiểu Excel (serial) và giờ có AM/PM.
- id_kind (list ps_idkind): `N` mã nhân viên NetSuite (entityid) hoặc id nội bộ; `M` chỉ theo bảng đối chiếu; `B` bảng đối
  chiếu trước, không có thì mã nhân viên NetSuite (mặc định)
- device_default (text): thiết bị ghi vào lượt chấm khi file không có cột thiết bị
- minute_offset (int): phút cộng thêm khi đồng hồ máy lệch (âm được)

### punch_map - Bảng đối chiếu mã chấm công
- source (select rec punch_source, req), device (text, trống = mọi máy của nguồn), machine_id (text, req), employee (select
  employee, req), effective, expiration (date). Khóa: nguồn + máy + mã + hiệu lực. Thôi dùng = isinactive.
- Thứ tự tra: dòng cùng máy trước, rồi dòng máy trống; hiệu lực tại ngày chấm.

Quyền: HR toàn quyền tạo / sửa (không xóa), kế toán xem (như punch).

## 2. Lõi (core/PunchImport.js, thuần, có test)
```
parseText(text, profile) -> {rows: [{line, machineId, device, time: 'YYYY-MM-DD HH:mm', kind: 'in'|'out'|''}], errors: [{line, vi, en}], header: [..]}
resolveEmployees(rows, {mappings, employeesByCode, employeeIds, idKind}) -> rows + {employee|null, how: 'map'|'code'|null}
dedupe(rows, existingKeys) -> rows + {status: 'new'|'duplicate'}   (khóa employee|time; trùng trong file cũng là duplicate)
```
- CSV có dấu ngoặc kép, ký tự BOM, dòng trống bỏ qua. Ngày không tồn tại, giờ > 23:59 là lỗi dòng.
- Layout P: giờ ra nhỏ hơn giờ vào thì giờ ra thuộc ngày hôm sau (ca đêm). Ô giờ trống thì bỏ lượt đó (không lỗi).
- minute_offset áp sau khi đọc. Giây bị bỏ (khóa chống trùng theo phút, giống action cũ).

## 3. API (api/PunchImport.js, route module; HR + admin ghi, HR + kế toán + admin đọc)
- GET `punchSourcesView {subsidiary}` -> `{sources: [{id, code, description, layout, idKind, ...}], mapCounts: {sourceId: n}, recordTypes: {source, map}}`
- GET `punchMappings {source}` -> `{rows: [{id, device, machineId, employee, code, name, effective, expiration}]}`
- POST `punchPreview {source, text}` -> `{counts: {total, new, duplicate, invalid, unmatched, locked}, rows: [...tối đa 1000 dòng đầu, ưu tiên dòng lỗi / chưa đối chiếu],
  unmatched: [{machineId, device, lines, firstTime}], range: {from, to}, employees: n}`. Dòng: `{line, machineId, device, time, employee, code, name, status, vi, en}`.
  status: new, duplicate, invalid, unmatched, locked (kỳ công đã khóa).
- POST `punchCommit {source, text, cursor?}` -> ghi dòng new theo thứ tự, dừng khi gần hết governance:
  `{created, skipped, invalid, unmatched, locked, more?: true, cursor}`. SPA gửi lại cùng text + cursor (lib/api.js post() lặp khi more).
  Ghi lượt chấm với source `I` (file) và device; dòng không ghi được không chặn dòng khác.
- POST `punchMapSave {source, rows: [{id?, device, machineId, employee, effective?, expiration?}]}` -> upsert; `{saved, rows}`.
- Kích thước: text tối đa 5 MB mỗi lần gọi; preview chỉ trả tối đa 1000 dòng chi tiết nhưng counts và unmatched là đầy đủ.
- JSON trả về không có khóa tên "error" ở bất kỳ cấp nào; lỗi s4vpError / s4vpErrorVi.

## 4. Màn hình (spa/payroll/views/attendance.js)
Nút **Nạp chấm công** ở hàng tiêu đề tab Chấm công (HR, admin). Hộp thoại ba bước:
1. Chọn hồ sơ nguồn (SearchSelect; có liên kết tạo / sửa hồ sơ trên form NetSuite), chọn file (.csv, .txt, .dat) hoặc dán từ Excel.
2. Xem trước: thẻ đếm (tổng, mới, trùng, lỗi, chưa đối chiếu, kỳ đã khóa), lưới có ô tìm nhanh và lọc trạng thái; khung
   **Mã chưa đối chiếu**: mỗi mã một dòng với SearchSelect nhân viên, nút Lưu đối chiếu rồi tự xem trước lại.
3. Ghi: thanh tiến độ theo lượt, kết quả cuối; gợi ý bấm Xử lý chấm công máy.
Tab hoặc khung "Đối chiếu mã chấm công" xem / sửa bảng đối chiếu của nguồn (ô tìm nhanh).

## 5. Xử lý chấm công chạy nền
Đã có từ 10/11/2026 (commit 55ebb69): `processPunches` chạy nền bằng `scripts/s4vp_mr_attendance.js` (op `punches`, lô 10
nhân viên ở reduce), trạng thái theo cơ chế tác vụ nền của chấm công (`jobStatus {period}`), kết quả cộng dồn số phiếu, số
đơn OT. Ngưỡng (11/11/2026) gom ở `api/Shifts.js`: chạy nền khi quá 200 nhân viên hoặc quá 3.000 ô nhân viên x ngày
(`SYNC_EMPLOYEES`, `SYNC_CELLS`); định tuyến ở `Attendance.runPunches`.
