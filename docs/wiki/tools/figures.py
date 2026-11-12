"""Hai hình cho wiki S4 VN Payroll: (1) sơ đồ khối hai tầng, (2) lưu đồ chu kỳ tháng lương. Xuất một khối HTML tự chứa."""
import html
import sys

FS, FT = 11.5, 12.5  # cỡ chữ mô tả, tên ô
CW = 0.6  # bề rộng ký tự trung bình / cỡ chữ (chữ Việt không chân)


def wrap(text, width_px, fs=FS):
    per = max(4, int(width_px / (fs * CW)))
    out, cur = [], ""
    for w in text.split():
        if len(cur) + len(w) + (1 if cur else 0) <= per:
            cur = (cur + " " + w).strip()
        else:
            out.append(cur)
            cur = w
    if cur:
        out.append(cur)
    return out


def esc(s):
    return html.escape(s, quote=False)


def tlines(x, y, lines, cls, lh=14.5, anchor="start"):
    return "".join(f'<text x="{x:.1f}" y="{y + i * lh:.1f}" class="{cls}" text-anchor="{anchor}">{esc(l)}</text>' for i, l in enumerate(lines))


# ------------------------------------------------------------------ Hình 1: sơ đồ khối hai tầng
GROUPS = [
    ("nb", "Nền tảng", 200, [(1, "Thiết lập ban đầu", "Tham số pháp lý, tài khoản, nhóm lương, kỳ lương, quy tắc thu nhập"),
                             (2, "Hồ sơ nhân sự và lương", "Hồ sơ lương, lịch sử lương, hợp đồng, quyết định, người phụ thuộc")]),
    ("gn", "Ghi nhận trong kỳ", 262, [(3, "Chấm công và thời gian", "Đơn từ, máy chấm công, khóa công"),
                                       (4, "Nghỉ phép", "Cấp phép, sổ phép, đơn nghỉ"),
                                       (5, "Sản lượng và lương khoán", "Đơn giá, phiếu cá nhân / tổ"),
                                       (6, "Hoa hồng nhân viên kinh doanh", "Kế hoạch, doanh số NetSuite, DMS"),
                                       (7, "Tạm ứng lương và cấn trừ", "Phiếu tạm ứng, cấn trừ FIFO")]),
    ("lo", "Lõi xử lý", 222, [(8, "Chạy lương tháng", "Nạp, tính, soát cảnh báo, duyệt nhiều cấp"),
                              (9, "Bảo hiểm bắt buộc, KPCĐ", "Căn cứ đóng, trần, phần NLĐ / DN"),
                              (10, "Thuế TNCN", "Lũy tiến, khấu trừ 10%, giảm trừ")]),
    ("dr", "Ghi sổ và đầu ra", 262, [(11, "Hạch toán, phân bổ chi phí", "Journal Entry, bill, phân bổ theo đích"),
                                      (12, "Chi trả", "File chi lương, phiếu lương, bảng thanh toán"),
                                      (13, "Báo cáo và kê khai", "BH tháng, D02-LT, 05/KK, quyết toán"),
                                      (14, "Phân tích chi phí lao động", "Biến động, giá vốn / chi phí, sổ cái")]),
    ("nd", "Người dùng cuối", 160, [(15, "Cổng tự phục vụ", "Phiếu lương, phép, đơn của tôi trên Employee Center")]),
]
CORE = [
    ("Employee", "Employee (1-1 với hồ sơ lương), phòng ban, cờ Sales Rep", "→ 2, 8", [("hồ sơ nhân viên", "up")]),
    ("Timesheet", "Time (timebill) đã duyệt theo dự án", "→ 3, 8, 11", [("giờ công", "up")]),
    ("Sales", "Invoice, Cash Sale, Credit Memo đã ghi sổ; Customer Payment; Sales Team", "→ 6", [("doanh số", "up")]),
    ("Inventory, Manufacturing", "Assembly Build, Work Order Completion, Item Fulfillment *", "→ 5", [("sản lượng", "up")]),
    ("Tài chính kế toán (GL, AP)", "Journal Entry, Vendor Bill; Account; Department, Class, Location, Project", "↔ 7, 11 · → 14", [("phân đoạn", "up"), ("bút toán, bill", "down")]),
    ("Role & Permission", "Vai trò S4VP Payroll HR, Accountant; vai trò chạy ẩn của cổng", "→ 16", [("quyền", "up")]),
    ("Employee Center", "Tab Lương của tôi, portlet; đăng nhập của nhân viên", "↔ 15", [("đơn từ", "up"), ("phiếu lương", "down")]),
]
BAR = [("Menu", "Tab Lương VN trong menu NetSuite"), ("Dữ liệu", "Custom record ngay trong NetSuite"), ("Quyền", "Vai trò, quyền chuẩn của NetSuite"),
       ("Ghi sổ", "Journal Entry, Vendor Bill chuẩn"), ("Người dùng", "Người dùng NetSuite, Employee Center"), ("Báo cáo", "Báo cáo trong gói, CSV, bản in PDF")]


def fig1():
    W, X0, X1 = 1240, 34, 1206
    o = []
    # khung ngoài NetSuite
    T1Y, COLY, COLH = 78, 196, 300
    T1B = COLY + COLH + 16
    GAP = 96
    T2Y = T1B + GAP
    T2H = 150
    BARY = T2Y + T2H + 18
    H = BARY + 62 + 16
    o.append(f'<rect x="8" y="8" width="{W - 16}" height="{H - 16}" rx="16" class="f-ns"/>')
    o.append(f'<text x="28" y="40" class="f-h1">ORACLE NETSUITE</text>')
    o.append(f'<text x="250" y="40" class="f-sub">một cơ sở dữ liệu · một lần đăng nhập · một bộ phân quyền</text>')
    # tầng 1
    o.append(f'<rect x="22" y="{T1Y - 24}" width="{W - 44}" height="{T1B - T1Y + 30}" rx="12" class="f-t1"/>')
    o.append(f'<text x="{X0}" y="{T1Y - 5}" class="f-h2">S4 VN Payroll · SuiteApp cài ngay trong Oracle NetSuite</text>')
    # hàng kiểm soát
    o.append(f'<rect x="{X0}" y="{T1Y + 6}" width="{X1 - X0}" height="44" rx="8" class="f-box" style="--c: var(--dg-nb)"/>')
    o.append(f'<text x="{X0 + 12}" y="{T1Y + 25}" class="f-name"><tspan class="f-num">16</tspan>  Kiểm soát nội bộ và phân quyền</text>')
    o.append(f'<text x="{X0 + 12}" y="{T1Y + 41}" class="f-desc">Vai trò, tách nhiệm vụ, khóa công / khóa kỳ, dấu dữ liệu đầu vào, nhật ký thao tác và nhật ký duyệt</text>')
    # các cột module
    gap_c = (X1 - X0 - sum(g[2] for g in GROUPS)) / (len(GROUPS) - 1)
    x = X0
    centers = []
    for key, gname, w, mods in GROUPS:
        o.append(f'<text x="{x}" y="{COLY - 10}" class="f-grp" style="fill: var(--dg-{key})">{esc(gname.upper())}</text>')
        n = len(mods)
        bh = (COLH - (n - 1) * 8) / n
        for i, (num, name, desc) in enumerate(mods):
            y = COLY + i * (bh + 8)
            o.append(f'<rect x="{x}" y="{y:.1f}" width="{w}" height="{bh:.1f}" rx="8" class="f-box" style="--c: var(--dg-{key})"/>')
            nl = wrap(name, w - 44, FT)
            dl = wrap(desc, w - 20, FS)
            room = int((bh - 12 - len(nl) * 15) // 14.5)
            dl = dl[: max(0, room)]
            block_h = len(nl) * 15 + len(dl) * 14.5
            ty = y + (bh - block_h) / 2 + 11
            o.append(f'<text x="{x + 10}" y="{ty:.1f}" class="f-num">{num}</text>')
            o.append(tlines(x + 34, ty, nl, "f-name", 15))
            o.append(tlines(x + 34, ty + len(nl) * 15, dl, "f-desc"))
        centers.append((x, w))
        x += w + gap_c
    # mũi tên dòng dữ liệu giữa các cột
    for (xa, wa), (xb, _) in zip(centers, centers[1:]):
        mx = xa + wa + 3
        o.append(f'<path d="M{mx:.1f},{COLY + COLH / 2:.1f} L{xb - 3:.1f},{COLY + COLH / 2:.1f}" class="f-flow" marker-end="url(#dg-ah)"/>')
    # tầng 2
    o.append(f'<rect x="22" y="{T2Y - 30}" width="{W - 44}" height="{T2H + 36}" rx="12" class="f-t2"/>')
    o.append(f'<text x="{X0}" y="{T2Y - 10}" class="f-h2">ORACLE NETSUITE CORE · gói đọc, ghi trực tiếp các record này bằng SuiteScript</text>')
    n = len(CORE)
    cw = (X1 - X0 - (n - 1) * 10) / n
    by = T2Y + 4
    bh = T2H - 30
    for i, (name, recs, lab, arrows) in enumerate(CORE):
        bx = X0 + i * (cw + 10)
        o.append(f'<rect x="{bx:.1f}" y="{by}" width="{cw:.1f}" height="{bh}" rx="8" class="f-core"/>')
        nl = wrap(name, cw - 16, FT)
        o.append(tlines(bx + 8, by + 18, nl, "f-name", 15))
        rl = wrap(recs, cw - 16, FS)[:5]
        o.append(tlines(bx + 8, by + 18 + len(nl) * 15 + 2, rl, "f-desc"))
        o.append(f'<text x="{bx + 8:.1f}" y="{by + bh + 17}" class="f-lab">{esc(lab)}</text>')
        # mũi tên dọc lên tầng 1 (và xuống nếu có ghi)
        cx = bx + cw / 2
        top, bot = T1B + 8, T2Y - 32
        mid = (top + bot) / 2 + 4
        if len(arrows) == 1:
            o.append(f'<path d="M{cx:.1f},{bot} L{cx:.1f},{top}" class="f-up" marker-end="url(#dg-ah)"/>')
            o.append(f'<text x="{cx + 6:.1f}" y="{mid:.1f}" class="f-alab">{esc(arrows[0][0])}</text>')
        else:
            o.append(f'<path d="M{cx - 7:.1f},{bot} L{cx - 7:.1f},{top}" class="f-up" marker-end="url(#dg-ah)"/>')
            o.append(f'<path d="M{cx + 7:.1f},{top} L{cx + 7:.1f},{bot}" class="f-up" marker-end="url(#dg-ah)"/>')
            o.append(f'<text x="{cx - 12:.1f}" y="{mid:.1f}" class="f-alab" text-anchor="end">↑ {esc(arrows[0][0])}</text>')
            o.append(f'<text x="{cx + 12:.1f}" y="{mid:.1f}" class="f-alab">↓ {esc(arrows[1][0])}</text>')
    # thanh cuối
    bw = (X1 - X0 - 5 * 8) / 6
    for i, (k, v) in enumerate(BAR):
        bx = X0 + i * (bw + 8)
        o.append(f'<rect x="{bx:.1f}" y="{BARY}" width="{bw:.1f}" height="62" rx="8" class="f-bar"/>')
        o.append(f'<text x="{bx + 10:.1f}" y="{BARY + 19}" class="f-name">{esc(k)}</text>')
        o.append(tlines(bx + 10, BARY + 36, wrap(v, bw - 18, FS)[:2], "f-desc"))
    svg = (f'<svg class="dg-svg" viewBox="0 0 {W} {H}" role="img" aria-label="Sơ đồ khối hai tầng S4 VN Payroll trong Oracle NetSuite" xmlns="http://www.w3.org/2000/svg">'
           '<defs><marker id="dg-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="f-ahead"/></marker>'
           '<marker id="dg-ahr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="f-aheadr"/></marker></defs>'
           + "".join(o) + "</svg>")
    return svg


# ------------------------------------------------------------------ Hình 2: lưu đồ chu kỳ tháng lương
LANES = [("HR", "dg-gn"), ("Hệ thống", "dg-core"), ("Người duyệt", "dg-nd"), ("Kế toán", "dg-dr")]
STEPS = [  # (làn, kiểu s/t/d/e, chữ)
    (0, "s", "Khóa công kỳ L"),
    (0, "t", "Tạo bảng lương, nạp nhân viên, giờ công H"),
    (0, "t", "Nhập tay thu nhập, khấu trừ"),
    (1, "t", "Tính lương B→C"),
    (0, "d", "Hết cảnh báo mức lỗi?"),
    (0, "t", "Bỏ tạm giữ, gửi duyệt C→P"),
    (2, "d", "Duyệt đủ các cấp?"),
    (3, "t", "Ghi sổ: một Journal Entry A→R"),
    (1, "t", "Cấn trừ tạm ứng, khóa phiếu khoán, hoa hồng"),
    (3, "e", "Bill cơ quan thuế, BHXH; file chi lương; phiếu lương"),
]
BACK = [(5, 3, "Còn lỗi: sửa dữ liệu, tính lại", 66), (7, 3, "Từ chối J, mở lại về H", 44), (8, 2, "Sai sau ghi sổ: void bill, đảo R→V, lập bảng mới", 22)]


def fig2():
    W, LW, TOP, LH = 1240, 112, 86, 112
    H = TOP + LH * len(LANES) + 12
    colw = (W - LW - 20) / len(STEPS)
    NW = colw - 16
    o = [f'<rect x="0" y="0" width="{W}" height="{H}" rx="12" class="f-paper"/>']
    for i, (name, c) in enumerate(LANES):
        y = TOP + i * LH
        o.append(f'<rect x="8" y="{y}" width="{W - 16}" height="{LH}" class="f-lane{" alt" if i % 2 else ""}"/>')
        o.append(f'<rect x="8" y="{y}" width="{LW - 10}" height="{LH}" class="f-lanehead" style="--c: var(--{c})"/>')
        o.append(f'<text x="{8 + (LW - 10) / 2}" y="{y + LH / 2 + 4}" class="f-lname" text-anchor="middle" style="fill: var(--{c})">{esc(name)}</text>')
    nodes = []
    for k, (lane, kind, text) in enumerate(STEPS):
        cx = LW + 10 + colw * k + colw / 2
        cy = TOP + lane * LH + LH / 2
        lines = wrap(text, NW - (22 if kind == "d" else 10), FS)
        h = (70 if kind == "d" else max(44, len(lines) * 14.5 + 16))
        h = min(h, LH - 14)
        nodes.append((cx, cy, h, kind, lane))
        c = LANES[lane][1]
        if kind == "d":
            o.append(f'<polygon points="{cx},{cy - h / 2} {cx + NW / 2 + 2},{cy} {cx},{cy + h / 2} {cx - NW / 2 - 2},{cy}" class="f-dec" style="--c: var(--{c})"/>')
        else:
            rx = h / 2 if kind in "se" else 8
            o.append(f'<rect x="{cx - NW / 2:.1f}" y="{cy - h / 2:.1f}" width="{NW:.1f}" height="{h:.1f}" rx="{rx:.1f}" class="f-node{" term" if kind in "se" else ""}" style="--c: var(--{c})"/>')
        o.append(tlines(cx, cy - (len(lines) - 1) * 7.25 + 4, lines, "f-ntext", 14.5, "middle"))
        o.append(f'<text x="{cx - NW / 2 - 2:.1f}" y="{cy - h / 2 - 4:.1f}" class="f-step">{k + 1}</text>')
    # cạnh xuôi
    for k in range(len(nodes) - 1):
        (ax, ay, ah, ak, al), (bx, by, bh, bk, bl) = nodes[k], nodes[k + 1]
        sx = ax + NW / 2 + (2 if ak == "d" else 0)
        ex = bx - NW / 2 - (2 if bk == "d" else 0)
        if al == bl:
            d = f"M{sx:.1f},{ay:.1f} L{ex - 2:.1f},{by:.1f}"
        else:
            mx = (sx + ex) / 2
            d = f"M{sx:.1f},{ay:.1f} L{mx:.1f},{ay:.1f} L{mx:.1f},{by:.1f} L{ex - 2:.1f},{by:.1f}"
        o.append(f'<path d="{d}" class="f-edge" marker-end="url(#dg-ah)"/>')
        if ak == "d":
            lab = "Có: P→A" if k == 6 else "Có"
            o.append(f'<text x="{sx + 4:.1f}" y="{ay + 15:.1f}" class="f-elab">{esc(lab)}</text>')
    # nhánh quay lại (đỏ, nét đứt) đi phía trên làn HR
    for fr, to, lab, ly in BACK:
        (ax, ay, ah, ak, al), (bx, by, bh, bk, bl) = nodes[fr - 1], nodes[to - 1]
        off = {66: 0, 44: 10, 22: -10}[ly]
        sy = ay - ah / 2
        ey = by - bh / 2
        o.append(f'<path d="M{ax + off:.1f},{sy:.1f} L{ax + off:.1f},{ly} L{bx + off:.1f},{ly} L{bx + off:.1f},{ey - 2:.1f}" class="f-back" marker-end="url(#dg-ahr)"/>')
        tw = len(lab) * FS * CW + 10
        tx = (ax + bx) / 2 - tw / 2
        o.append(f'<rect x="{tx:.1f}" y="{ly - 9}" width="{tw:.1f}" height="17" rx="4" class="f-paperfill"/>')
        o.append(f'<text x="{tx + 5:.1f}" y="{ly + 4}" class="f-blab">{esc(lab)}</text>')
    return (f'<svg class="dg-svg" viewBox="0 0 {W} {H}" role="img" aria-label="Lưu đồ chu kỳ một tháng lương" xmlns="http://www.w3.org/2000/svg">'
            '<defs><marker id="dg-ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="f-ahead"/></marker></defs>'
            + "".join(o).replace("url(#dg-ah)", "url(#dg-ah2)") + "</svg>")


STYLE = """<style>
/* Hình kiến trúc và lưu đồ (tự chứa): token màu riêng, sáng / tối */
.dg { --dg-paper:#ffffff; --dg-bg:#f4f7f6; --dg-ink:#17231f; --dg-muted:#55645f; --dg-line:#cfd9d5;
  --dg-ns:#1f6f5c; --dg-nb:#5b7083; --dg-gn:#2f6db5; --dg-lo:#a85a1c; --dg-dr:#2e7d4f; --dg-nd:#7a4fb0; --dg-core:#6b7280; --dg-red:#c0392b; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .dg { --dg-paper:#16201d; --dg-bg:#0f1614; --dg-ink:#e3ece9; --dg-muted:#9db0aa; --dg-line:#2a3733;
  --dg-ns:#5cc0a3; --dg-nb:#93a8bb; --dg-gn:#7fb0ea; --dg-lo:#e0a06a; --dg-dr:#6cc58f; --dg-nd:#b99be6; --dg-core:#a3aab5; --dg-red:#ef7a6c; } }
:root[data-theme="dark"] .dg { --dg-paper:#16201d; --dg-bg:#0f1614; --dg-ink:#e3ece9; --dg-muted:#9db0aa; --dg-line:#2a3733;
  --dg-ns:#5cc0a3; --dg-nb:#93a8bb; --dg-gn:#7fb0ea; --dg-lo:#e0a06a; --dg-dr:#6cc58f; --dg-nd:#b99be6; --dg-core:#a3aab5; --dg-red:#ef7a6c; }
.dg-wrap { overflow-x: auto; margin: 10px 0 4px; }
.dg-svg { display:block; width:100%; min-width:900px; height:auto; font-family:"Be Vietnam Pro","Segoe UI",system-ui,sans-serif; }
.dg-svg text { fill: var(--dg-ink); }
.dg-svg .f-ns { fill: var(--dg-bg); stroke: var(--dg-ns); stroke-width: 3; }
.dg-svg .f-h1 { font-size: 20px; font-weight: 800; letter-spacing: .06em; fill: var(--dg-ns); }
.dg-svg .f-sub { font-size: 13px; fill: var(--dg-muted); }
.dg-svg .f-h2 { font-size: 13.5px; font-weight: 700; }
.dg-svg .f-t1 { fill: var(--dg-paper); stroke: var(--dg-line); stroke-width: 1.4; }
.dg-svg .f-t2 { fill: var(--dg-paper); stroke: var(--dg-core); stroke-width: 1.6; }
.dg-svg .f-box { fill: var(--c); fill-opacity: .1; stroke: var(--c); stroke-width: 1.5; }
.dg-svg .f-core { fill: var(--dg-core); fill-opacity: .1; stroke: var(--dg-core); stroke-width: 1.5; }
.dg-svg .f-bar { fill: var(--dg-ns); fill-opacity: .1; stroke: var(--dg-ns); stroke-width: 1.2; }
.dg-svg .f-grp { font-size: 11.5px; font-weight: 700; letter-spacing: .06em; }
.dg-svg .f-num { font-size: 12.5px; font-weight: 800; fill: var(--dg-muted); }
.dg-svg .f-name { font-size: 12.5px; font-weight: 700; }
.dg-svg .f-desc { font-size: 11.5px; fill: var(--dg-muted); }
.dg-svg .f-lab { font-size: 11.5px; font-weight: 700; fill: var(--dg-core); }
.dg-svg .f-alab { font-size: 11.5px; fill: var(--dg-muted); }
.dg-svg .f-flow { stroke: var(--dg-muted); stroke-width: 1.6; fill: none; }
.dg-svg .f-up { stroke: var(--dg-core); stroke-width: 1.6; fill: none; }
.dg-svg .f-ahead { fill: var(--dg-muted); }
.dg-svg .f-aheadr { fill: var(--dg-red); }
.dg-svg .f-paper { fill: var(--dg-paper); stroke: var(--dg-line); }
.dg-svg .f-paperfill { fill: var(--dg-paper); }
.dg-svg .f-lane { fill: var(--dg-paper); }
.dg-svg .f-lane.alt { fill: var(--dg-bg); }
.dg-svg .f-lanehead { fill: var(--c); fill-opacity: .12; }
.dg-svg .f-lname { font-size: 13px; font-weight: 700; }
.dg-svg .f-node { fill: var(--dg-paper); stroke: var(--c); stroke-width: 1.6; }
.dg-svg .f-node.term { stroke-width: 2.6; }
.dg-svg .f-dec { fill: var(--c); fill-opacity: .12; stroke: var(--c); stroke-width: 1.6; }
.dg-svg .f-ntext { font-size: 11.5px; }
.dg-svg .f-step { font-size: 11px; font-weight: 700; fill: var(--dg-muted); text-anchor: end; }
.dg-svg .f-edge { stroke: var(--dg-muted); stroke-width: 1.5; fill: none; }
.dg-svg .f-elab { font-size: 11.5px; fill: var(--dg-muted); }
.dg-svg .f-back { stroke: var(--dg-red); stroke-width: 1.5; stroke-dasharray: 6 4; fill: none; }
.dg-svg .f-blab { font-size: 11.5px; fill: var(--dg-red); font-weight: 600; }
.dg-cap { font-size: 13.5px; color: var(--dg-muted); margin: 6px 0 18px; max-width: 78ch; }
.dg-cap b { color: var(--dg-ink); }
</style>"""

SRC = "Nguồn: Sổ tay quy trình S4 VN Payroll (wiki), đối chiếu ngày 11/11/2026."
CAP1 = ("Đọc hình: tầng trên là 16 module của gói, xếp theo dòng dữ liệu từ nền tảng tới đầu ra; tầng dưới là các phân hệ chuẩn "
        "của Oracle NetSuite mà gói đọc vào (→) hoặc vừa đọc vừa ghi (↔). Cả hai tầng nằm trong một khung: gói chạy ngay trong "
        "Oracle NetSuite, không phải hệ thống riêng. * Sản lượng từ chứng từ sản xuất, xuất kho mới kiểm bằng test, chưa chạy trên "
        "account có dùng sản xuất.")
CAP2 = ("Đọc hình: HR khóa công, lập và tính bảng lương; người duyệt duyệt lần lượt từng cấp; kế toán ghi sổ một Journal Entry "
        "rồi lập bill, file chi lương. Mã trạng thái: L công đã khóa; bảng lương H Tạm giữ, B Chờ tính, C Đã tính, P Chờ duyệt, "
        "A Đã duyệt, J Từ chối, R Đã ghi sổ, V Đã đảo. Nét đứt đỏ là nhánh quay lại.")


def block():
    return (STYLE + '<div class="dg dg-wide"><div class="dg-wrap">' + fig1() + f'</div><p class="dg-cap">{esc(CAP1)}<br>{esc(SRC)}</p>'
            + '<div class="dg-wrap">' + fig2() + f'</div><p class="dg-cap">{esc(CAP2)}<br>{esc(SRC)}</p></div>')


if __name__ == "__main__":
    out = block()
    assert "—" not in out and "–" not in out
    open(sys.argv[1], "w", encoding="utf-8").write(out)
    print("ok", len(out))
