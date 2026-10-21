"""
Script Build Python Sidecar Binary cho Tauri
Tu dong goi PyInstaller va sao chep vao src-tauri/binaries theo dung target triple cua Windows:
src-tauri/binaries/local_engine-x86_64-pc-windows-msvc.exe
"""
import os
import sys
import subprocess
import shutil
from pathlib import Path

# Ensure UTF-8 output in Windows consoles
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).resolve().parent.parent
TAURI_BIN_DIR = BASE_DIR / "src-tauri" / "binaries"
TAURI_RELEASE_DIR = BASE_DIR / "src-tauri" / "target" / "release"

def build_sidecar():
    print("=" * 70)
    print(">> BAT DAU DONG GOI PYTHON LOCAL ENGINE (SIDECAR BINARY)")
    print("=" * 70)

    spec_file = BASE_DIR / "build_engine.spec"
    if not spec_file.exists():
        print(f"[ERROR] Khong tim thay {spec_file}!")
        return False

    # Chay PyInstaller
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", str(spec_file)]
    print(f">> Dang thuc thi: {' '.join(cmd)}")
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    result = subprocess.run(cmd, cwd=str(BASE_DIR), env=env)

    if result.returncode != 0:
        print("[ERROR] Loi khi dong goi local_engine!")
        return False

    built_exe = BASE_DIR / "dist" / "local_engine.exe"
    if not built_exe.exists():
        print(f"[ERROR] Khong tim thay file da build tai: {built_exe}")
        return False

    # Tao thu muc src-tauri/binaries neu chua co
    TAURI_BIN_DIR.mkdir(parents=True, exist_ok=True)

    # Tauri quy dinh ten binary sidecar theo target triple: <name>-<target-triple>.exe
    target_triple_exe = TAURI_BIN_DIR / "local_engine-x86_64-pc-windows-msvc.exe"
    shutil.copy2(built_exe, target_triple_exe)
    print(f">> Da sao chep vao: {target_triple_exe}")

    # Neu da co thu muc target/release, sao chep truc tiep vao de chay thu nghiem ngay
    if TAURI_RELEASE_DIR.exists():
        shutil.copy2(built_exe, TAURI_RELEASE_DIR / "local_engine.exe")
        shutil.copy2(built_exe, TAURI_RELEASE_DIR / "local_engine-x86_64-pc-windows-msvc.exe")
        print(f">> Da sao chep vao target/release!")

    print("\n" + "=" * 70)
    print(">> BUILD SIDECAR HOAN TAT THANH CONG!")
    print("=" * 70)
    return True

if __name__ == "__main__":
    success = build_sidecar()
    if not success:
        sys.exit(1)
