"""Dựng wiki quy trình S4 VN Payroll: wiki_source.md + shell.html -> wiki/index.html (một trang, định tuyến bằng #)."""
import html
import json
import re
import sys
import unicodedata

SRC, SHELL, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

# flows.py nằm cạnh script; chạy với -I nên nạp theo đường dẫn
import importlib.util
import os
_spec = importlib.util.spec_from_file_location("flows", os.path.join(os.path.dirname(os.path.abspath(__file__)), "flows.py"))
flows = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(flows)
text = "\n".join(open(p, encoding="utf-8").read() for p in SRC.split(","))
shell = open(SHELL, encoding="utf-8").read()


def slug(s):
    s = unicodedata.normalize("NFD", s.replace("đ", "d").replace("Đ", "D"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:48].strip("-")


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = s.replace("-&gt;", "→").replace("&lt;-&gt;", "↔")
    s = s.replace("CHƯA LÀM", '<span class="todo">CHƯA LÀM</span>')
    s = s.replace("(chưa xác minh)", '<span class="unsure">chưa xác minh</span>')
    return s


LIST_RE = re.compile(r"^(\s*)(\d+\.|-)\s+(.*)$")


def render_list(items, steps=False):
    """items: [(indent, ordered, text)] -> html lồng nhau theo thụt lề."""
    out = []

    def build(i, base):
        ordered = items[i][1]
        tag = "ol" if ordered else "ul"
        cls = ' class="steps"' if (ordered and steps and base == 0) else ""
        parts = [f"<{tag}{cls}>"]
        while i < len(items) and items[i][0] >= base:
            ind, _, t = items[i]
            if ind > base:
                sub, i = build(i, ind)
                parts[-1] = parts[-1][: -len("</li>")] + sub + "</li>"
                continue
            parts.append(f"<li>{inline(t)}</li>")
            i += 1
        parts.append(f"</{tag}>")
        return "".join(parts), i

    i = 0
    while i < len(items):
        h, i = build(i, items[i][0])
        out.append(h)
    return "".join(out)


def render_table(rows):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    head, body = cells[0], [r for r in cells[2:]]
    th = "".join(f"<th>{inline(c)}</th>" for c in head)
    trs = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body)
    return f'<div class="tbl"><table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>'


def render_body(lines):
    out, para, i = [], [], 0
    steps_next = False

    def flush():
        nonlocal para
        if para:
            out.append(f"<p>{inline(' '.join(para))}</p>")
            para = []

    while i < len(lines):
        ln = lines[i]
        st = ln.strip()
        if st.startswith("```"):
            flush()
            j = i + 1
            block = []
            while j < len(lines) and not lines[j].strip().startswith("```"):
                block.append(lines[j])
                j += 1
            out.append('<pre class="cyc">' + html.escape("\n".join(block)).replace("-&gt;", "→") + "</pre>")
            i = j + 1
            continue
        if not st or st == "---":
            flush()
            i += 1
            continue
        if st.startswith("### "):
            flush()
            t = st[4:]
            hid = slug(t)
            out.append(f'<h2 id="{hid}">{inline(t)}</h2>')
            steps_next = "bước" in t.lower() or "luồng" in t.lower()
            i += 1
            continue
        if st.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            out.append(render_table(rows))
            continue
        if LIST_RE.match(ln):
            flush()
            items = []
            while i < len(lines):
                m = LIST_RE.match(lines[i])
                if m:
                    items.append((len(m.group(1)), m.group(2) != "-", m.group(3)))
                    i += 1
                elif lines[i].strip() and lines[i].startswith("   ") and items:
                    ind, o, t = items[-1]
                    items[-1] = (ind, o, t + " " + lines[i].strip())
                    i += 1
                else:
                    break
            out.append(render_list(items, steps=steps_next))
            steps_next = False
            continue
        # đoạn mở đầu dạng "**Các bước.**" báo hiệu danh sách đánh số kế tiếp là luồng bước
        if re.match(r"^\*\*(Các bước|Thành phần và bước|Các bước \(.*?\))", st):
            steps_next = True
        para.append(st)
        i += 1
    flush()
    return "".join(out)


# ---- tách trang theo "## N. Tiêu đề"
pages, cur = [], None
intro = []
for ln in text.splitlines():
    m = re.match(r"^## (\d+)\. (.+)$", ln)
    if m:
        cur = {"n": int(m.group(1)), "title": m.group(2).strip(), "lines": []}
        pages.append(cur)
        continue
    if ln.startswith("# "):
        continue
    (cur["lines"] if cur else intro).append(ln)

SHORT = {0: "Bức tranh chung", 17: "Chu kỳ tháng", 18: "Cuối năm, đầu năm", 19: "Thuật ngữ", 20: "Chưa làm, chưa chắc",
         21: "Máy chấm công", 22: "Sản lượng, năng suất", 23: "Doanh số, hoa hồng"}
for p in pages:
    p["id"] = slug(p["title"]) or f"muc-{p['n']}"
    p["short"] = SHORT.get(p["n"], p["title"])

GROUPS = [
    ("Tổng quan", [0, 17, 18]),
    ("Thiết lập và dữ liệu gốc", [1, 2]),
    ("Ghi nhận trong kỳ", [3, 4, 5, 6, 7]),
    ("Dữ liệu đầu vào chi tiết", [21, 22, 23]),
    ("Tính và duyệt lương", [8, 9, 10]),
    ("Hạch toán và chi trả", [11, 12]),
    ("Báo cáo và phân tích", [13, 14]),
    ("Nhân viên và kiểm soát", [15, 16]),
    ("Tra cứu", [19, 20]),
]
byn = {p["n"]: p for p in pages}

# ---- bản đồ chu kỳ tháng (vẽ thay khối chữ ở mục 17, và hiện ở trang đầu)
PHASES = [
    ("Một lần, khi triển khai", "Thiết lập", [1, 2]),
    ("Hằng ngày trong kỳ", "Ghi nhận đầu vào", [3, 4, 5, 6, 7]),
    ("Cuối kỳ", "Tính, soát, duyệt", [8, 9, 10]),
    ("Sau khi duyệt", "Ghi sổ và chi trả", [11, 12]),
    ("Sau ghi sổ, hằng quý", "Báo cáo, phân tích", [13, 14]),
    ("Liên tục", "Nhân viên tự tra cứu", [15]),
]


def cycle_html():
    cards = []
    for when, name, ns in PHASES:
        links = "".join(f'<a href="#{byn[n]["id"]}">{n}. {html.escape(byn[n]["title"])}</a>' for n in ns if n in byn)
        cards.append(f'<div class="phase"><h3>{name}</h3><div class="when">{when}</div>{links}</div>')
    return '<div class="cycle">' + "".join(cards) + "</div>"


arts = []
for p in pages:
    body = render_body(p["lines"])
    extra = ""
    if p["n"] == 0:
        conv = render_body(intro)
        figp = os.path.join(os.path.dirname(OUT), "figures_block.html")
        if os.path.exists(figp):
            conv = '<h2 id="kien-truc">Gói nằm ở đâu trong Oracle NetSuite</h2>' + open(figp, encoding="utf-8").read() + conv
        extra = ('<h2>Đọc sổ tay này thế nào</h2>' + conv +
                 '<h2>Chu kỳ một tháng lương</h2><p>Mỗi ô là một giai đoạn; bấm tên quy trình để mở bài chi tiết. '
                 'Bài nào cũng có cùng khung: mục đích, vai trò, khi nào làm, các bước kèm trạng thái, quy tắc, đầu ra, kiểm soát và cách sửa sai.</p>' + cycle_html())
    if p["n"] == 17:
        body = cycle_html() + body
    fb = flows.block(p["n"])
    # quy trình có bài dữ liệu đầu vào chi tiết: dẫn sang ngay dưới lưu đồ
    deep = {3: 21, 5: 22, 6: 23}.get(p["n"])
    if deep and deep in byn:
        fb += (f'<div class="callout info"><b>Dữ liệu đầu vào</b>Cách nạp, định dạng file, quy tắc kiểm tra và hỏi đáp thường gặp: '
               f'xem <a href="#{byn[deep]["id"]}">{html.escape(byn[deep]["title"])}</a>.</div>')
    if fb:
        # lưu đồ đặt ngay sau đoạn Mục đích (đoạn đầu tiên của bài)
        cut = body.find("</p>")
        body = body[: cut + 4] + fb + body[cut + 4:] if cut >= 0 else fb + body
    order = [n for _, ns in GROUPS for n in ns]
    idx = order.index(p["n"]) if p["n"] in order else -1
    prev_ = byn.get(order[idx - 1]) if idx > 0 else None
    next_ = byn.get(order[idx + 1]) if 0 <= idx < len(order) - 1 else None
    grp = next((g for g, ns in GROUPS if p["n"] in ns), "")
    nav = '<div class="next">' + (f'<a href="#{prev_["id"]}">← {html.escape(prev_["short"])}</a>' if prev_ else "<span></span>") + \
          (f'<a href="#{next_["id"]}">{html.escape(next_["short"])} →</a>' if next_ else "") + "</div>"
    num = "" if p["n"] in (0, 17, 18, 19, 20) else f"Quy trình {p['n']} · "
    arts.append(
        f'<article id="{p["id"]}" data-page hidden><div class="eyebrow">{num}{html.escape(grp)}</div>'
        f'<h1>{html.escape(p["title"])}</h1>{extra if p["n"] == 0 else ""}{body}{nav}'
        f'<p class="foot">Nguồn: đặc tả chuyển giao S4 eSuite Payroll (20/10/2026), mã nguồn gói s4_vn_netsuite_payroll và tài liệu repo, đối chiếu ngày 11/11/2026.</p></article>'
    )

toc = []
for g, ns in GROUPS:
    toc.append(f"<h4>{g}</h4>")
    for n in ns:
        if n not in byn:
            continue
        p = byn[n]
        label = f'<span class="n">{n if n not in (0,17,18,19,20) else "·"}</span><span class="t">{html.escape(p["short"])}</span><span class="cnt" hidden></span>'
        toc.append(f'<a href="#{p["id"]}" data-for="{p["id"]}">{label}</a>')

home = byn[0]["id"]
page = shell + """
<header class="top">
  <button class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="toc">Mục lục</button>
  <div class="brand"><b>Sổ tay quy trình</b><span>S4 VN Payroll trên NetSuite</span></div>
  <div class="search"><input id="q" type="search" placeholder="Tìm trong sổ tay: bảo hiểm, 334, D02-LT, tạm ứng..." aria-label="Tìm trong sổ tay" autocomplete="off"></div>
</header>
<div class="wrap">
  <nav class="toc" id="toc" aria-label="Mục lục">""" + "".join(toc) + """<div class="empty" id="no-hit" hidden>Không có bài nào khớp.</div></nav>
  <main id="main">""" + "".join(arts) + """</main>
</div>
<script>
(function(){
  var HOME = """ + json.dumps(home) + """;
  var pages = Array.prototype.slice.call(document.querySelectorAll('[data-page]'));
  var links = Array.prototype.slice.call(document.querySelectorAll('#toc a[data-for]'));
  var toc = document.getElementById('toc'), btn = document.getElementById('menu-btn'), q = document.getElementById('q');
  var fold = function(s){ return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase(); };
  var texts = {}; pages.forEach(function(a){ texts[a.id] = fold(a.textContent); });
  function show(id){
    var target = document.getElementById(id);
    if (!target || !target.hasAttribute('data-page')) {
      // neo con (h2) trong một bài: mở bài chứa nó
      var inner = target && target.closest('[data-page]');
      if (inner) { show(inner.id); target.scrollIntoView(); return; }
      id = HOME; target = document.getElementById(HOME);
    }
    pages.forEach(function(a){ a.hidden = a !== target; });
    links.forEach(function(l){ if (l.getAttribute('data-for') === id) l.setAttribute('aria-current','page'); else l.removeAttribute('aria-current'); });
    document.title = (id === HOME ? '' : target.querySelector('h1').textContent + ' - ') + 'Sổ tay quy trình S4 VN Payroll';
    toc.classList.remove('open'); btn.setAttribute('aria-expanded','false');
    // trình duyệt tự nhảy tới phần tử có id trùng hash sau khi xử lý: cuộn về đầu bài ở khung kế tiếp
    window.scrollTo(0,0); setTimeout(function(){ window.scrollTo(0,0); }, 0);
    mark(target);
  }
  function route(){ show((location.hash || '').slice(1) || HOME); }
  window.addEventListener('hashchange', route);
  btn.addEventListener('click', function(){ var o = toc.classList.toggle('open'); btn.setAttribute('aria-expanded', o ? 'true' : 'false'); });

  // Tìm: lọc mục lục theo bài có chữ khớp (không phân biệt dấu), đếm số lần khớp, tô sáng trong bài đang mở
  function clearMarks(root){ Array.prototype.slice.call(root.querySelectorAll('mark.hl')).forEach(function(m){ m.replaceWith(document.createTextNode(m.textContent)); }); root.normalize(); }
  function mark(root){
    pages.forEach(clearMarks);
    var term = fold(q.value.trim()); if (term.length < 2) return;
    // bỏ qua chữ trong lưu đồ SVG: không chèn thẻ HTML vào SVG
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function(t){ return t.parentNode.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } }), nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    var first = null;
    nodes.forEach(function(node){
      var t = node.nodeValue, f = fold(t), pos = f.indexOf(term); if (pos < 0) return;
      var frag = document.createDocumentFragment(), last = 0;
      while (pos >= 0) { frag.appendChild(document.createTextNode(t.slice(last,pos))); var m = document.createElement('mark'); m.className='hl'; m.textContent = t.slice(pos,pos+term.length); frag.appendChild(m); if (!first) first = m; last = pos + term.length; pos = f.indexOf(term, last); }
      frag.appendChild(document.createTextNode(t.slice(last))); node.replaceWith(frag);
    });
    if (first && q === document.activeElement) {} else if (first) first.scrollIntoView({block:'center'});
  }
  var timer;
  q.addEventListener('input', function(){
    clearTimeout(timer);
    timer = setTimeout(function(){
      var term = fold(q.value.trim()), any = false;
      links.forEach(function(l){
        var id = l.getAttribute('data-for'), cnt = l.querySelector('.cnt');
        if (term.length < 2) { l.hidden = false; cnt.hidden = true; any = true; return; }
        var c = texts[id].split(term).length - 1;
        l.hidden = c === 0; cnt.hidden = c === 0; cnt.textContent = c; if (c) any = true;
      });
      Array.prototype.slice.call(toc.querySelectorAll('h4')).forEach(function(h){
        var el = h.nextElementSibling, vis = false;
        while (el && el.tagName === 'A') { if (!el.hidden) vis = true; el = el.nextElementSibling; }
        h.hidden = !vis;
      });
      document.getElementById('no-hit').hidden = any;
      var cur = pages.filter(function(a){ return !a.hidden; })[0];
      if (cur) mark(cur);
      if (term.length >= 2 && window.innerWidth <= 860) { toc.classList.add('open'); btn.setAttribute('aria-expanded','true'); }
    }, 180);
  });
  q.addEventListener('keydown', function(e){
    if (e.key === 'Enter') { var l = links.filter(function(x){ return !x.hidden; })[0]; if (l) { location.hash = l.getAttribute('data-for'); route(); } }
  });
  route();
})();
</script>
"""
open(OUT, "w", encoding="utf-8").write(page)
print("pages", len(pages), "bytes", len(page.encode("utf-8")))
