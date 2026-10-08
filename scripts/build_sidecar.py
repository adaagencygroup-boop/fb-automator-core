"""
Script Build Python Sidecar Binary cho Tauri
Tự động gọi PyInstaller và sao chép vào src-tauri/binaries theo đúng target triple của Windows:
src-tauri/binaries/local_engine-x86_64-pc-windows-msvc.exe
"""
import os
import sys
import subprocess
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TAURI_BIN_DIR = BASE_DIR / "src-tauri" / "binaries"

def build_sidecar():
    print("=" * 70)
    print("🚀 BẮT ĐẦU ĐÓNG GÓI PYTHON LOCAL ENGINE (SIDECAR BINARY)")
    print("=" * 70)

    spec_file = BASE_DIR / "build_engine.spec"
    if not spec_file.exists():
        print(f"❌ Không tìm thấy {spec_file}!")
        return

    # Chạy PyInstaller
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", str(spec_file)]
    print(f"⚡ Đang thực thi: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(BASE_DIR))

    if result.returncode != 0:
        print("❌ Lỗi khi đóng gói local_engine!")
        return

    built_exe = BASE_DIR / "dist" / "local_engine.exe"
    if not built_exe.exists():
        print(f"❌ Không tìm thấy file đã build tại: {built_exe}")
        return

    # Tạo thư mục src-tauri/binaries nếu chưa có
    TAURI_BIN_DIR.mkdir(parents=True, exist_ok=True)

    # Tauri quy định tên binary sidecar theo target triple: <name>-<target-triple>.exe
    target_triple_exe = TAURI_BIN_DIR / "local_engine-x86_64-pc-windows-msvc.exe"
    shutil.copy2(built_exe, target_triple_exe)

    print("\n" + "=" * 70)
    print("🎉 BUILD SIDECAR HOÀN TẤT THÀNH CÔNG!")
    print(f"📂 Đã sao chép vào: {target_triple_exe}")
    print("👉 Bây giờ bạn có thể chạy `cargo tauri build` hoặc `npm run tauri build`!")
    print("=" * 70)

if __name__ == "__main__":
    build_sidecar()
