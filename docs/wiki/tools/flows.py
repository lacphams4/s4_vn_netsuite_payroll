"""Lưu đồ quy trình dạng làn (cross-functional): mỗi làn một vai trò, bước đi từ trên xuống; vẽ SVG theo token màu của trang."""
import html

LANES = {
    "NV": ("Nhân viên", "--r-emp"),
    "HR": ("HR", "--r-hr"),
    "TK": ("Thống kê / HR", "--r-hr"),
    "HRKT": ("HR / Kế toán", "--r-hr"),
    "DUYET": ("Người duyệt", "--r-chief"),
    "KTT": ("Kế toán trưởng", "--r-chief"),
    "KT": ("Kế toán", "--r-acc"),
    "ADMIN": ("Tư vấn / Admin", "--r-admin"),
    "HT": ("Hệ thống", "--r-sys"),
}

# Bước: (làn, chữ, kiểu, trạng thái). Kiểu: s bắt đầu, e kết thúc, t việc, d quyết định (nhánh "Có" đi tiếp xuống).
# Nhánh phụ: (từ bước, tới bước, nhãn) - đánh số từ 1, vẽ nét đứt vòng bên phải.
FLOWS = {
    1: (["ADMIN", "KTT", "KT", "HR"], [
        ("ADMIN", "Deploy gói; bật Departments, Classes, Locations", "s", ""),
        ("ADMIN", "Nạp mặc định VN: tham số, biểu thuế, khoản trích, danh mục", "t", ""),
        ("KTT", "Đối chiếu tham số pháp lý với văn bản, đánh dấu đã đối chiếu", "t", ""),
        ("KT", "Khai tài khoản 334, 3335, 141, 335 và nhà cung cấp cơ quan thu", "t", ""),
        ("KT", "Thiết lập theo công ty con (bật phân hệ); tài khoản chi phí theo đích", "t", ""),
        ("HR", "Nhóm lương, sinh kỳ lương cả năm", "t", ""),
        ("HR", "Loại thu nhập, quy tắc thu nhập, gói phúc lợi, chính sách phép", "t", ""),
        ("KT", "Khai cấp duyệt bảng lương (tùy chọn)", "t", ""),
        ("ADMIN", "Gán vai trò S4VP HR / Accountant cho người dùng", "t", ""),
        ("HR", "Kỳ chạy thử khớp Excel cũ?", "d", ""),
        ("HR", "Vận hành thật", "e", ""),
    ], [(10, 7, "Chưa khớp: chỉnh thiết lập")]),
    2: (["HR", "HT", "KT", "NV"], [
        ("HR", "Tuyển mới, điều chỉnh, điều chuyển, nghỉ việc", "s", ""),
        ("HR", "Hồ sơ lương: loại lao động, cách tính thuế, BH, ngân hàng", "t", ""),
        ("HR", "Lịch sử lương theo ngày hiệu lực: lương HĐ, lương đóng BH, phụ cấp", "t", ""),
        ("HR", "Hợp đồng, phụ lục", "t", "D → A"),
        ("HR", "Lập quyết định nhân sự", "t", "D"),
        ("HR", "Áp dụng quyết định", "t", "D → A"),
        ("HT", "Cập nhật hồ sơ, thêm lịch sử lương; quyết định chấm dứt thì chấm dứt hợp đồng", "t", ""),
        ("HR", "Người phụ thuộc, giấy phép lao động", "t", ""),
        ("KT", "Xem hồ sơ (không sửa)", "t", ""),
        ("NV", "Xem thông tin của mình trên cổng (số định danh che)", "e", ""),
    ], []),
    3: (["NV", "HR", "HT"], [
        ("NV", "Lập đơn nghỉ, OT, công tác (hoặc HR lập hộ)", "s", "H"),
        ("NV", "Gửi duyệt", "t", "H → P"),
        ("HT", "Kiểm trùng ngày, số dư phép, giờ OT; giữ chỗ phép", "t", ""),
        ("HR", "Duyệt? (không tự duyệt đơn của mình)", "d", ""),
        ("HR", "Duyệt đơn", "t", "P → A"),
        ("HT", "Máy chấm công: sinh phiếu trễ sớm, vắng, OT gợi ý để duyệt", "t", "H"),
        ("HR", "Lập bảng công kỳ (chạy lại được)", "t", ""),
        ("HR", "Bảng công đúng?", "d", ""),
        ("HR", "Khóa công", "t", "L"),
        ("HT", "Sang chạy lương: công, nghỉ, OT", "e", ""),
    ], [(4, 1, "Từ chối (R) kèm lý do"), (8, 7, "Sửa bằng phiếu điều chỉnh")]),
    4: (["HR", "NV", "HT"], [
        ("HR", "Đầu năm: cấp phép năm", "s", "A"),
        ("HT", "Tính theo chính sách: số ngày, thâm niên, người mới; chuyển phép năm trước", "t", "C"),
        ("NV", "Lập đơn nghỉ phép, gửi duyệt", "t", "H → P"),
        ("HT", "Đủ số dư?", "d", ""),
        ("HT", "Giữ chỗ: tăng Đang chờ duyệt", "t", ""),
        ("HR", "Duyệt đơn", "t", "P → A"),
        ("HT", "Trừ số dư: tăng Đã dùng", "t", "R"),
        ("HR", "Đến hạn: hết hạn phép chuyển", "t", "X"),
        ("HT", "Nghỉ việc: tự sinh dòng trả phép trên bảng lương", "e", ""),
    ], [(4, 3, "Không đủ: chặn gửi")]),
    5: (["TK", "DUYET", "HT", "KT"], [
        ("HT", "Tùy chọn: sinh phiếu từ chứng từ sản xuất, xuất kho", "s", "H"),
        ("TK", "Lập phiếu cá nhân / tổ; tra đơn giá theo ngày, dự án", "t", "H"),
        ("TK", "Phiếu tổ: nạp thành viên, chia tiền theo cách chia", "t", ""),
        ("TK", "Gửi duyệt", "t", "H → P"),
        ("DUYET", "Duyệt?", "d", ""),
        ("DUYET", "Duyệt phiếu", "t", "P → A"),
        ("HT", "Tính lương: quy tắc nguồn O lấy thành tiền theo bảng đơn giá", "t", ""),
        ("KT", "Ghi sổ bảng lương", "t", ""),
        ("HT", "Phiếu đã dùng khóa lại; chi phí về đích của phiếu", "e", "C"),
    ], [(5, 2, "Từ chối kèm lý do (về H)")]),
    6: (["KT", "HT"], [
        ("KT", "Cấu hình kế hoạch, thành phần, bậc thang; phân công, chỉ tiêu", "s", ""),
        ("KT", "Nạp doanh số ngoài nếu có (dán Excel / CSV, kiểm từng dòng)", "t", ""),
        ("KT", "Tính hoa hồng tháng", "t", "D"),
        ("HT", "Đọc hóa đơn, credit memo, thu tiền, đội bán; ghi nhận cho người có phân công", "t", ""),
        ("HT", "Áp thành phần, % đạt, true-up, quản lý, trần, ứng trước; diễn giải từng bước", "t", ""),
        ("KT", "Số liệu đúng?", "d", ""),
        ("KT", "Duyệt bảng tính", "t", "D → A"),
        ("HT", "Tính lương: dòng thu nhập nguồn C; chi phí theo phân đoạn doanh thu", "t", ""),
        ("KT", "Ghi sổ bảng lương", "t", ""),
        ("HT", "Bảng tính đã vào lương (đảo bảng lương thì về A)", "e", "P"),
    ], [(6, 3, "Điều chỉnh tay kèm lý do, tính lại")]),
    7: (["HRKT", "KT", "HT"], [
        ("HRKT", "Lập phiếu tạm ứng (hoặc tự sinh từ đơn công tác)", "s", "H"),
        ("HRKT", "Bỏ tạm giữ (bắt buộc tài khoản tiền)", "t", "H → B"),
        ("KT", "Ghi sổ tạm ứng: Nợ 141 / Có tiền", "t", "B → O"),
        ("HT", "Tính lương: cấn trừ FIFO, không làm âm thực lĩnh", "t", ""),
        ("KT", "Ghi sổ bảng lương: Có 141 theo từng phiếu", "t", ""),
        ("HT", "Số dư về 0?", "d", ""),
        ("HT", "Tất toán phiếu", "e", "O → C"),
    ], [(6, 4, "Còn dư: cấn trừ kỳ sau")]),
    8: (["HR", "HT", "DUYET", "KT"], [
        ("HR", "Tạo bảng lương (công ty con, kỳ)", "s", "H"),
        ("HR", "Nạp nhân viên, nạp giờ công từ Time", "t", ""),
        ("HR", "Nhập tay thu nhập, khấu trừ; sửa công", "t", ""),
        ("HT", "Tính: thu nhập, OT, trả phép, hoa hồng → BH → thuế → khấu trừ → cấn trừ", "t", "B → C"),
        ("HR", "Hết cảnh báo mức lỗi?", "d", ""),
        ("HR", "Bỏ tạm giữ, gửi duyệt", "t", "C → P"),
        ("DUYET", "Duyệt đủ các cấp?", "d", ""),
        ("DUYET", "Cấp cuối duyệt", "t", "P → A"),
        ("KT", "Ghi sổ: một Journal Entry", "t", "A → R"),
        ("HT", "Cấn trừ tạm ứng, khóa phiếu sản lượng, hoa hồng, ghi số liệu chi phí", "t", ""),
        ("KT", "Bill cơ quan thu, file chi lương, phiếu lương", "e", ""),
    ], [(5, 3, "Còn lỗi: sửa dữ liệu, tính lại"), (7, 3, "Từ chối (J), mở lại về H")]),
    9: (["HR", "HT", "KT"], [
        ("HR", "Khai lương đóng BH, vùng, cờ tham gia BHXH-BHYT / BHTN, đoàn viên", "s", ""),
        ("HT", "Lương đóng ≥ lương tối thiểu vùng?", "d", ""),
        ("HT", "Ngày nghỉ dưới ngưỡng không đóng?", "d", ""),
        ("HT", "Căn cứ có trần: BHXH-BHYT theo mức tham chiếu, BHTN theo lương tối thiểu vùng", "t", ""),
        ("HT", "Từng khoản trích: phần NLĐ trừ lương, phần DN vào chi phí", "t", ""),
        ("KT", "Ghi sổ Có 338x theo khoản; bill BHXH, công đoàn", "t", ""),
        ("KT", "Báo cáo BH tháng, D02-LT; đối chiếu C12-TS", "e", ""),
    ], [(2, 1, "Không: lỗi dòng, sửa lương đóng"), (3, 7, "Đủ ngưỡng: không trích tháng này, lập báo giảm")]),
    10: (["HR", "HT", "KT"], [
        ("HR", "Khai cách tính thuế, MST, người phụ thuộc, cam kết 08/CK", "s", ""),
        ("HT", "Thu nhập chịu thuế = tổng thu nhập - phần miễn thuế", "t", ""),
        ("HT", "Cách tính lũy tiến (P)?", "d", ""),
        ("HT", "Trừ BH NLĐ, giảm trừ bản thân, người phụ thuộc, giảm trừ khác; áp biểu lũy tiến", "t", ""),
        ("HT", "Kỳ cuối tháng: khấu trừ cho cả tháng thuế", "t", ""),
        ("KT", "Ghi sổ Có 3335; bill Cơ quan thuế", "t", ""),
        ("KT", "Hằng quý: 05/KK-TNCN, phiếu số liệu HTKK", "t", ""),
        ("KT", "Cuối năm: 05-1/BK, 05-2/BK, 05/QTT, sổ theo dõi thuế", "e", ""),
    ], [(3, 5, "Không: F 10% từng lần chi, N không cư trú, X không khấu trừ")]),
    11: (["HT", "KT"], [
        ("HT", "Tính lương xong: tổng thu nhập + BH phần DN", "s", ""),
        ("HT", "Thu nhập có đích riêng trước: hoa hồng, nhập tay có phân đoạn, sản lượng", "t", ""),
        ("HT", "Phần còn lại chia theo phương pháp phân bổ (thiết lập, timesheet, tỷ lệ, phân ca)", "t", ""),
        ("HT", "Chọn tài khoản: class → dự án → phòng ban → hồ sơ → phòng ban NV → mặc định", "t", ""),
        ("KT", "Xem trước bút toán", "t", ""),
        ("KT", "Ghi sổ: Nợ chi phí; Có 334, 338x, 3335, 141, 335", "t", "A → R"),
        ("KT", "Lập bill cơ quan thu theo nhà cung cấp", "t", ""),
        ("KT", "Phát hiện sai sau ghi sổ?", "d", ""),
        ("KT", "Void bill → Đảo bảng lương → lập bảng mới cùng kỳ", "t", "R → V"),
        ("HT", "Số liệu phân tích chi phí lao động", "e", ""),
    ], [(8, 10, "Không")]),
    12: (["KT", "HR", "NV"], [
        ("KT", "Bảng lương đã duyệt hoặc đã ghi sổ", "s", "A / R"),
        ("KT", "Đủ số tài khoản ngân hàng?", "d", ""),
        ("KT", "Xuất file chi lương CSV, chuyển ngân hàng", "t", ""),
        ("KT", "Ghi nhận thanh toán Nợ 334 / Có tiền trên NetSuite", "t", ""),
        ("KT", "In bảng thanh toán tiền lương (chữ ký)", "t", ""),
        ("HR", "In phiếu lương PDF (vi, en, song ngữ)", "t", ""),
        ("NV", "Xem, in phiếu lương trên cổng tự phục vụ", "e", ""),
    ], [(2, 1, "Thiếu: bổ sung hồ sơ hoặc trả ngoài file")]),
    14: (["KT", "HT"], [
        ("KT", "Ghi sổ bảng lương", "s", "R"),
        ("HT", "Ghi số liệu chi phí theo tài khoản, phòng ban, class, địa điểm, dự án, thành phần", "t", ""),
        ("HT", "Tách giá vốn / chi phí hoạt động theo loại tài khoản NetSuite", "t", ""),
        ("KT", "Xem xu hướng 12 tháng, cầu biến động, phân rã tới nhân viên", "t", ""),
        ("KT", "Khớp sổ cái?", "d", ""),
        ("KT", "Lãi lỗ tách phần lao động", "e", ""),
    ], [(5, 2, "Lệch: lập lại số liệu")]),
    21: (["HR", "HT"], [
        ("HR", "Khai ca, mẫu xoay ca; sinh phân ca theo tổ", "s", ""),
        ("HR", "Khai hồ sơ nguồn của máy: kiểu dòng, cột, định dạng ngày", "t", ""),
        ("HR", "Nạp chấm công: chọn file hoặc dán, xem trước", "t", ""),
        ("HT", "Đọc theo hồ sơ; nhận người qua bảng đối chiếu; đánh dấu trùng, lỗi, kỳ khóa", "t", ""),
        ("HR", "Hết mã chưa đối chiếu?", "d", ""),
        ("HT", "Ghi lượt chấm mới theo lượt, có tiến độ", "t", ""),
        ("HR", "Xử lý chấm công máy cho kỳ", "t", ""),
        ("HR", "Xử lý chấm công máy cho kỳ (kỳ lớn tự chạy nền)", "t", ""),
        ("HT", "Khớp lượt vào / ra với ca; đề xuất phiếu trễ, sớm, vắng, thiếu lượt, đơn OT", "t", "H"),
        ("HR", "Xem, sửa, duyệt hoặc từ chối từng đề xuất", "t", "P → A"),
        ("HR", "Lập bảng công, khóa công", "e", "L"),
    ], [(5, 4, "Còn: chọn nhân viên cho mã, lưu đối chiếu")]),
    22: (["TK", "HT", "DUYET"], [
        ("TK", "Khai bảng đơn giá, tổ đội, thành viên, quy tắc nguồn O", "s", ""),
        ("TK", "Lập phiếu (màn hình, CSV Import, REST) hoặc lấy từ giao dịch", "t", "H"),
        ("HT", "Tra đơn giá theo hạng mục, ngày, dự án; thành tiền = số lượng x đơn giá", "t", ""),
        ("HT", "Có đơn giá?", "d", ""),
        ("TK", "Phiếu tổ: nạp thành viên, chia tiền; sửa tay nếu cần", "t", ""),
        ("TK", "Gửi duyệt", "t", "H → P"),
        ("DUYET", "Duyệt?", "d", ""),
        ("DUYET", "Duyệt phiếu", "t", "P → A"),
        ("HT", "Bảng lương cộng theo người và mã bảng đơn giá; ghi sổ thì khóa phiếu", "e", "C"),
    ], [(4, 2, "Không: nhập đơn giá hoặc bổ sung bảng"), (7, 2, "Từ chối kèm lý do")]),
    23: (["KT", "HT"], [
        ("KT", "Chọn nguồn doanh số trên kế hoạch: NetSuite, ngoài, cả hai", "s", ""),
        ("KT", "Nạp doanh số ngoài: dán Excel / CSV, tự nhận cột", "t", ""),
        ("HT", "Kiểm từng dòng: chứng từ, ngày, nhân viên, số, phân đoạn, trùng", "t", ""),
        ("KT", "Hết dòng lỗi?", "d", ""),
        ("HT", "Ghi theo khóa chống trùng; nạp lại thì cập nhật", "t", ""),
        ("HT", "Đọc hóa đơn, bán thu tiền ngay, credit memo, thu tiền, đội bán", "t", ""),
        ("HT", "Ghi nhận cho người có phân công; báo doanh số chưa ai được ghi nhận", "t", ""),
        ("KT", "Tính, soát diễn giải, duyệt bảng tính", "e", "D → A"),
    ], [(4, 2, "Còn lỗi: sửa file hoặc bỏ qua dòng lỗi")]),
    15: (["NV", "HT", "HR"], [
        ("NV", "Mở Lương của tôi trên Employee Center", "s", ""),
        ("HT", "Xác định nhân viên từ người đăng nhập; chỉ trả dữ liệu của người đó", "t", ""),
        ("NV", "Xem tổng quan, phiếu lương đã ghi sổ, số dư phép", "t", ""),
        ("NV", "Lập đơn nghỉ, OT, công tác", "t", "H → P"),
        ("HR", "Duyệt?", "d", ""),
        ("HR", "Đơn đã duyệt vào bảng công kỳ", "e", "A"),
    ], [(5, 4, "Từ chối: nhân viên sửa, gửi lại")]),
}

LANE_W, BOX_W, LINE_H, HEAD_H, GAP = 196, 168, 15, 36, 30
CHARS = 25


def wrap(text, width=CHARS):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= width:
            cur = (cur + " " + w).strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def svg(n):
    lanes, steps, extras = FLOWS[n]
    li = {k: i for i, k in enumerate(lanes)}
    label_w = 200 if extras else 0
    total_w = len(lanes) * LANE_W + 24 * len(extras) + label_w
    nodes, y = [], HEAD_H + 18
    for lane, text, kind, status in steps:
        lines = wrap(text, 21 if kind == "d" else CHARS)
        h = max(40, len(lines) * LINE_H + 18) + (18 if kind == "d" else 0)
        cx = li[lane] * LANE_W + LANE_W / 2
        nodes.append({"lane": lane, "lines": lines, "kind": kind, "status": status, "cx": cx, "y": y, "h": h})
        y += h + GAP
    total_h = y - GAP + 18
    out = [f'<svg class="flowsvg" viewBox="0 0 {total_w:.0f} {total_h:.0f}" style="max-width:{total_w:.0f}px" role="img" '
           f'aria-label="Lưu đồ quy trình" xmlns="http://www.w3.org/2000/svg">',
           '<defs><marker id="ah{0}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
           '<path d="M0,0 L10,5 L0,10 z" class="ah"/></marker></defs>'.format(n)]
    for i, k in enumerate(lanes):
        name, color = LANES[k]
        x = i * LANE_W
        out.append(f'<rect x="{x}" y="0" width="{LANE_W}" height="{total_h:.0f}" class="lane{" alt" if i % 2 else ""}"/>')
        out.append(f'<rect x="{x}" y="0" width="{LANE_W}" height="{HEAD_H}" class="lanehead" style="--rc: var({color})"/>')
        out.append(f'<text x="{x + LANE_W / 2}" y="{HEAD_H / 2 + 5}" class="lanename" style="--rc: var({color})">{html.escape(name)}</text>')
    lane_right = len(lanes) * LANE_W

    def bottom(nd):
        return nd["y"] + nd["h"]

    # cạnh tuần tự
    for a, b in zip(nodes, nodes[1:]):
        x1, y1, x2, y2 = a["cx"], bottom(a), b["cx"], b["y"]
        if x1 == x2:
            d = f"M{x1},{y1} L{x2},{y2 - 1}"
        else:
            my = y1 + GAP / 2
            d = f"M{x1},{y1} L{x1},{my} L{x2},{my} L{x2},{y2 - 1}"
        out.append(f'<path d="{d}" class="edge" marker-end="url(#ah{n})"/>')
        if a["kind"] == "d":
            out.append(f'<text x="{x1 + 6}" y="{y1 + 12}" class="elabel">Có</text>')
    # nhánh phụ
    for k, (fr, to, lab) in enumerate(extras):
        a, b = nodes[fr - 1], nodes[to - 1]
        xr = lane_right + 12 + 24 * k
        ya = a["y"] + a["h"] / 2
        yb = b["y"] + b["h"] / 2
        xa = a["cx"] + (BOX_W / 2 if a["kind"] != "d" else BOX_W / 2 + 4)
        xb = b["cx"] + BOX_W / 2
        out.append(f'<path d="M{xa},{ya} L{xr},{ya} L{xr},{yb} L{xb + 2},{yb}" class="edge back" marker-end="url(#ah{n})"/>')
        ly = (ya + yb) / 2
        lx = lane_right + 24 * len(extras) + 8
        lines = wrap(lab, 28)
        out.append(f'<line x1="{xr}" y1="{ly}" x2="{lx - 2}" y2="{ly}" class="lead"/>')
        for j, ln in enumerate(lines):
            out.append(f'<text x="{lx}" y="{ly + 4 + (j - (len(lines) - 1) / 2) * 14:.0f}" class="blabel">{html.escape(ln)}</text>')
    # nút
    for i, nd in enumerate(nodes):
        name, color = LANES[nd["lane"]]
        x0, y0, w, h = nd["cx"] - BOX_W / 2, nd["y"], BOX_W, nd["h"]
        st = f'style="--rc: var({color})"'
        if nd["kind"] == "d":
            cx, cy = nd["cx"], y0 + h / 2
            out.append(f'<polygon points="{cx},{y0} {x0 + w + 4},{cy} {cx},{y0 + h} {x0 - 4},{cy}" class="node dec" {st}/>')
        else:
            r = h / 2 if nd["kind"] in "se" else 8
            cls = "node term" if nd["kind"] in "se" else "node"
            out.append(f'<rect x="{x0}" y="{y0}" width="{w}" height="{h}" rx="{min(r, 20)}" class="{cls}" {st}/>')
        n_lines = len(nd["lines"])
        for j, ln in enumerate(nd["lines"]):
            ty = y0 + h / 2 + (j - (n_lines - 1) / 2) * LINE_H + 4
            out.append(f'<text x="{nd["cx"]}" y="{ty:.1f}" class="ntext">{html.escape(ln)}</text>')
        out.append(f'<text x="{x0 - 4 if nd["kind"] != "d" else x0 - 8}" y="{y0 + 11}" class="nnum">{i + 1}</text>')
        if nd["status"]:
            sw = 12 + 6.6 * len(nd["status"])
            sx = x0 + w - sw + 6
            sy = y0 - 9
            out.append(f'<rect x="{sx:.0f}" y="{sy}" width="{sw:.0f}" height="17" rx="5" class="stbg"/>')
            out.append(f'<text x="{sx + sw / 2:.0f}" y="{sy + 12.5}" class="sttext">{html.escape(nd["status"])}</text>')
    out.append("</svg>")
    return "".join(out)


LEGEND = ('<div class="legend"><span><i class="lg term"></i>Bắt đầu / kết thúc</span><span><i class="lg box"></i>Việc</span>'
          '<span><i class="lg dia"></i>Quyết định (nhánh "Có" đi xuống)</span><span><i class="lg back"></i>Nhánh quay lại / rẽ</span>'
          '<span><b class="lgst">H → P</b>Trạng thái chứng từ sau bước</span></div>')


def block(n):
    if n not in FLOWS:
        return ""
    return ('<h2 id="luu-do">Lưu đồ quy trình</h2><p class="flowhint">Mỗi cột là một vai trò; đọc từ trên xuống. '
            'Số nhỏ cạnh mỗi ô là thứ tự bước.</p>' + LEGEND + '<div class="diagram">' + svg(n) + "</div>")
