# Sổ tay quy trình S4 Advanced Payroll

Wiki nghiệp vụ theo góc nhìn quy trình (trang HTML một file `so-tay-quy-trinh.html`, mở thẳng bằng trình duyệt).

- Nguồn nội dung: `wiki_source.md` (bài 0-20: tổng quan và quy trình), `wiki_inputs.md` (bài 21-23: dữ liệu đầu vào máy chấm công, sản lượng, doanh số), `wiki_roster.md` (bài 24: xếp ca và chế độ ca).
- Lưu đồ làn: `tools/flows.py`; sơ đồ khối và lưu đồ chu kỳ tháng: `tools/figures.py` -> `figures_block.html` (khối HTML tự chứa, dán được vào trang khác).
- Dựng lại sau khi sửa nguồn (chạy trong thư mục này):

```bash
python -I tools/figures.py figures_block.html && python -I tools/build_wiki.py wiki_source.md,wiki_inputs.md,wiki_roster.md shell.html so-tay-quy-trinh.html
```

Bản đang chia sẻ trên claude.ai: https://claude.ai/artifact/LDdwj26JW2JuGD3BERyL3s (riêng tư, chia sẻ qua nút Share).
