"""Chuyển ảnh chụp màn hình thô (jpg) thành webp cho wiki: cắt dải trắng dưới, bỏ thanh cuộn trang, làm mờ cột định danh.
Dùng: python -I tools/shots.py <thư mục ảnh thô> img  (bảng MAP: tên đích -> hậu tố file thô, vùng làm mờ)"""
import sys, glob, os
from PIL import Image, ImageFilter

MAP = {
    "home": ("qpow5p", []), "payroll-list": ("h7fx2p", []), "run-overview": ("rif9o3", []), "run-pit": ("b4mv4b", []),
    "run-insurance": ("e73q31", []), "run-checks": ("la1wm0", []), "run-journal": ("06p71f", []), "run-print": ("5y03f6", []),
    "run-allocation": ("9nwax7", []), "attendance": ("5c17j0", []), "attendance-day": ("mmc58f", []), "attendance-docs": ("w4rxjs", []),
    "punch-import": ("dxqxna", []), "roster": ("qzhnmt", []), "roster-regime": ("zcf39b", []), "employees": ("wb3r3n", []),
    "employee-card": ("42pqha", []), "employee-salary": ("89ihjj", []), "employee-contracts": ("xrodlk", []),
    "employee-leave": ("jiypkf", []), "employee-payroll": ("ju6ax9", []), "advances": ("to0f2o", []), "commission": ("wut3px", []),
    "commission-external": ("bdroxc", []), "commission-plans": ("fsnke5", []), "analytics": ("vqjyqs", []),
    "analytics-breakdown": ("lc72jk", []), "reports-hub": ("0k7i64", []), "report-insurance": ("xhatk3", [(262, 396, 356, 642)]),
    "report-05kk": ("p3csxq", []), "report-finalization": ("h0atn0", [(262, 380, 468, 622)]), "report-cost": ("5b05em", []),
    "setup": ("szl0u6", []), "setup-tax": ("ebk7nb", []), "outputs": ("l0muw2", []), "output-detail": ("t76svt", []),
}

def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    for name, (suffix, blurs) in MAP.items():
        hits = glob.glob(os.path.join(src, f"*-{suffix}.jpg"))
        if len(hits) != 1:
            print("THIEU", name, suffix); continue
        im = Image.open(hits[0]).convert("RGB")
        for box in blurs:
            im.paste(im.crop(box).filter(ImageFilter.GaussianBlur(7)), box)
        im = im.crop((0, 0, min(im.width, 1516), im.height))
        px = im.convert("L").load(); h = im.height
        while h > 200 and all(px[x, h - 1] >= 250 for x in range(0, im.width, 8)):
            h -= 1
        im = im.crop((0, 0, im.width, min(im.height, h + 6)))
        out = os.path.join(dst, name + ".webp")
        im.save(out, "WEBP", quality=82, method=6)
        print(name, im.size, os.path.getsize(out) // 1024, "KB")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
