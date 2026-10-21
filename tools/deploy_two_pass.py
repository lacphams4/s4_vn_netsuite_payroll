"""Deploy hai bước khi thêm custom record mới (bài học SDF: role và record tham chiếu vòng thì lỗi BEGIN_DEPLOYMENT).

Bước 1: record mới (chưa có trong git HEAD) bỏ khối <permissions>, tạm dùng CUSTRECORDENTRYPERM, role lấy bản ở HEAD -> deploy.
Bước 2: trả lại file đầy đủ -> deploy.
Cách dùng (thư mục gốc repo): python tools/deploy_two_pass.py
"""
import os
import re
import shutil
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OBJ = os.path.join(ROOT, "src", "Objects")


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf8").stdout


def deploy():
    r = subprocess.run("suitecloud project:deploy", cwd=ROOT, shell=True, capture_output=True, text=True, encoding="utf8", errors="replace")
    lines = [l for l in r.stdout.splitlines() if re.search(r"Status:|ERROR|Chi tiết|Details", l)]
    print("\n".join(lines[:6]))
    return "Status: SUCCESS" in r.stdout


def main():
    untracked = [l[3:].strip() for l in git("status", "--porcelain", "src/Objects").splitlines() if l.startswith("??")]
    new_records = [p for p in untracked if os.path.basename(p).startswith("customrecord_")]
    roles = [os.path.join("src", "Objects", f) for f in os.listdir(OBJ) if f.startswith("customrole_")]
    backup = tempfile.mkdtemp(prefix="s4vp_deploy_")
    touched = []
    try:
        for p in new_records + roles:
            full = os.path.join(ROOT, p)
            shutil.copy2(full, os.path.join(backup, os.path.basename(p)))
            touched.append(p)
        for p in new_records:
            full = os.path.join(ROOT, p)
            s = open(full, encoding="utf8").read()
            # Bước 1: bỏ danh sách quyền (role chưa có) và tạm dùng quyền theo bản ghi; bước 2 trả lại USEPERMISSIONLIST
            s = re.sub(r"\s*<permissions>.*?</permissions>", "", s, flags=re.S)
            s = s.replace("<accesstype>USEPERMISSIONLIST</accesstype>", "<accesstype>CUSTRECORDENTRYPERM</accesstype>")
            open(full, "w", encoding="utf8", newline="").write(s)
        for p in roles:
            head = git("show", f"HEAD:{p.replace(os.sep, '/')}")
            if head:
                open(os.path.join(ROOT, p), "w", encoding="utf8", newline="").write(head)
        print("Pass 1:")
        ok = deploy()
    finally:
        for p in touched:
            shutil.copy2(os.path.join(backup, os.path.basename(p)), os.path.join(ROOT, p))
        shutil.rmtree(backup, ignore_errors=True)
    if not ok:
        raise SystemExit("Pass 1 failed")
    print("Pass 2:")
    if not deploy():
        raise SystemExit("Pass 2 failed")


if __name__ == "__main__":
    main()
