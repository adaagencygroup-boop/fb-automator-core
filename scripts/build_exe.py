"""
Script Tự Động Đóng Gói Ứng Dụng (1-Click Build Exe)
Hỗ trợ kiểm tra môi trường, chạy PyInstaller và sao chép dữ liệu cần thiết.
"""
import os
import sys
import subprocess
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def build():
    print("=" * 70)
    print("🚀 BẮT ĐẦU ĐÓNG GÓI FACEBOOK AUTOMATOR PRO SANG .EXE")
    print("=" * 70)

    # 1. Kiểm tra PyInstaller
    try:
        import PyInstaller
        print(f"✅ PyInstaller đã sẵn sàng: phiên bản {PyInstaller.__version__}")
    except ImportError:
        print("❌ Thiếu thư viện PyInstaller. Đang tiến hành cài đặt...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

    # 2. Xóa các bản build cũ
    dist_dir = BASE_DIR / "dist"
    build_dir = BASE_DIR / "build"
    if dist_dir.exists():
        print("🧹 Đang dọn dẹp thư mục dist/ cũ...")
        shutil.rmtree(dist_dir, ignore_errors=True)
    if build_dir.exists():
        print("🧹 Đang dọn dẹp thư mục build/ cũ...")
        shutil.rmtree(build_dir, ignore_errors=True)

    # 3. Chạy PyInstaller với build.spec
    spec_file = BASE_DIR / "build.spec"
    if not spec_file.exists():
        print(f"❌ Không tìm thấy file {spec_file}!")
        return

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        str(spec_file)
    ]

    print(f"⚡ Đang thực thi lệnh: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(BASE_DIR))

    if result.returncode == 0:
        output_folder = dist_dir / "FacebookAutomatorPro"
        exe_path = output_folder / "FacebookAutomatorPro.exe"
        print("\n" + "=" * 70)
        print("🎉 ĐÓNG GÓI THÀNH CÔNG RỰC RỠ!")
        print(f"📂 Thư mục sản phẩm: {output_folder}")
        print(f"🚀 File thực thi: {exe_path}")
        print("=" * 70)
    else:
        print("\n❌ Quá trình đóng gói gặp lỗi! Vui lòng kiểm tra log ở trên.")

if __name__ == "__main__":
    build()
