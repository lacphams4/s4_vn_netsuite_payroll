# Sổ tay quy trình S4 Advanced Payroll

Wiki nghiệp vụ theo góc nhìn quy trình (trang HTML một file `so-tay-quy-trinh.html`, mở thẳng bằng trình duyệt).

- Nguồn nội dung: `wiki_source.md` (bài 0-20: tổng quan và quy trình), `wiki_inputs.md` (bài 21-23: dữ liệu đầu vào máy chấm công, sản lượng, doanh số), `wiki_roster.md` (bài 24: xếp ca và chế độ ca), `wiki_ai.md` (bài 25: trợ lý AI qua NetSuite AI Connector), `wiki_security.md` (bài 26: tổ chức vai trò để bảo mật thông tin lương).
- Hình chụp màn hình: đặt file vào `img/` rồi viết `![chú thích](img/ten.webp)` trên một dòng riêng trong file nguồn; bản dựng nhúng hình vào trang (vẫn một file), bấm hình để phóng to. Hình thiếu thì bản dựng bỏ qua và báo tên.
- Lưu đồ làn: `tools/flows.py`; sơ đồ khối và lưu đồ chu kỳ tháng: `tools/figures.py` -> `figures_block.html` (khối HTML tự chứa, dán được vào trang khác).
- Dựng lại sau khi sửa nguồn (chạy trong thư mục này):

```bash
python -I tools/figures.py figures_block.html && python -I tools/build_wiki.py wiki_source.md,wiki_inputs.md,wiki_roster.md,wiki_ai.md,wiki_security.md shell.html so-tay-quy-trinh.html
```

Bản đang chia sẻ trên claude.ai: https://claude.ai/artifact/LDdwj26JW2JuGD3BERyL3s (riêng tư, chia sẻ qua nút Share).

## Hình chụp màn hình

- `img/*.webp`: hình chụp trên dữ liệu demo Sao Mai (tên và số tiền là dữ liệu giả). Hình được nhúng vào `so-tay-quy-trinh.html` khi dựng.
- `tools/shots.py`: chuyển ảnh chụp thô (jpg) sang webp, cắt dải trắng, làm mờ cột định danh (MST, CCCD, số sổ BHXH). Bảng `MAP` trong file ghi tên hình và vùng làm mờ.
- `hinh-noi-bat.html`: trang 10 màn hình tiêu biểu để đưa lên website S4, dùng chung thư mục `img/` (cần tải kèm 10 file hình khi đăng).
