#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_release.py - Tự động hóa toàn bộ quy trình đóng gói ứng dụng FB Page Automator.

Quy trình chuẩn hóa (Cách B):
1. Build Frontend Next.js (tự động thử lại lần 2 nếu lần 1 bị lỗi bảo mật/file lock).
2. Build Engine onedir (PyInstaller) qua scripts/build_sidecar.py -> src-tauri/engine-runtime.
3. Tạm thời tắt beforeBuildCommand trong src-tauri/tauri.conf.json (dùng try...finally để luôn khôi phục).
4. Chạy npx @tauri-apps/cli build để tạo bộ cài đặt NSIS (.exe).
5. Khôi phục tauri.conf.json về trạng thái ban đầu.
6. Kiểm tra file .exe xuất xưởng, hiển thị đường dẫn và dung lượng.
"""

import os
import sys
import subprocess
from pathlib import Path
from datetime import datetime

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent.parent
TAURI_CONF_PATH = ROOT_DIR / "src-tauri" / "tauri.conf.json"


def log_step(step: str, title: str):
    print("\n" + "=" * 70)
    print(f" [{step}] {title}")
    print("=" * 70 + "\n")


def run_command(cmd: str, description: str, cwd: Path = ROOT_DIR, allow_fail: bool = False) -> int:
    print(f"--> Đang thực hiện: {description}")
    print(f"    Lệnh: {cmd}")
    res = subprocess.run(cmd, cwd=str(cwd), shell=True)
    if res.returncode != 0 and not allow_fail:
        print(f"\n[X] LỖI: Lệnh '{description}' thất bại với mã lỗi {res.returncode}!")
        sys.exit(res.returncode)
    return res.returncode


def main():
    start_time = datetime.now()
    print("======================================================================")
    print("  BẮT ĐẦU ĐÓNG GÓI BẢN PHÁT HÀNH FB PAGE AUTOMATOR (Release Package)")
    print(f"  Thư mục gốc: {ROOT_DIR}")
    print(f"  Thời gian:   {start_time.strftime('%d/%m/%Y %H:%M:%S')}")
    print("======================================================================")

    # ------------------------------------------------------------------
    # Bước 1: Build Frontend Next.js
    # ------------------------------------------------------------------
    log_step("BƯỚC 1/4", "BIÊN DỊCH FRONTEND NEXT.JS (Static Export)")
    fe_code = run_command("npm --prefix frontend run build", "Build Frontend", allow_fail=True)
    if fe_code != 0:
        print("\n[!] Next.js build lần 1 chưa thành công, đang tự động thử lại lần 2...")
        run_command("npm --prefix frontend run build", "Build Frontend (Lần 2)")

    out_index = ROOT_DIR / "frontend" / "out" / "index.html"
    if not out_index.exists():
        print(f"\n[X] LỖI: Không tìm thấy file xuất xưởng Frontend: {out_index}")
        sys.exit(1)
    print("[OK] Frontend đã được biên dịch thành công!")

    # ------------------------------------------------------------------
    # Bước 2: Build Engine onedir (PyInstaller)
    # ------------------------------------------------------------------
    log_step("BƯỚC 2/4", "ĐÓNG GÓI PYTHON LOCAL ENGINE (PyInstaller Onedir)")
    python_bin = sys.executable
    run_command(f'"{python_bin}" scripts/build_sidecar.py', "Build Sidecar Engine")

    engine_exe = ROOT_DIR / "src-tauri" / "engine-runtime" / "local_engine.exe"
    if not engine_exe.exists():
        print(f"\n[X] LỖI: Không tìm thấy file engine sau khi build: {engine_exe}")
        sys.exit(1)
    print("[OK] Python Engine Runtime đã sẵn sàng trong src-tauri/engine-runtime!")

    # ------------------------------------------------------------------
    # Bước 3: Build Tauri NSIS Setup
    # ------------------------------------------------------------------
    log_step("BƯỚC 3/4", "ĐÓNG GÓI TAURI NSIS INSTALLER (.exe)")
    if not TAURI_CONF_PATH.exists():
        print(f"\n[X] LỖI: Không tìm thấy file cấu hình: {TAURI_CONF_PATH}")
        sys.exit(1)

    original_tauri_conf = TAURI_CONF_PATH.read_text(encoding="utf-8")
    try:
        # Tạm thời bỏ beforeBuildCommand vì FE đã build xong ở Bước 1
        temp_tauri_conf = original_tauri_conf.replace(
            '"beforeBuildCommand": "npm --prefix frontend run build"',
            '"beforeBuildCommand": ""',
        )
        TAURI_CONF_PATH.write_text(temp_tauri_conf, encoding="utf-8")
        print("--> Đã tạm thời gỡ 'beforeBuildCommand' để tránh xung đột build lại.")

        run_command("npx @tauri-apps/cli build", "Build Tauri NSIS Package")
    finally:
        # Luôn luôn khôi phục lại tauri.conf.json ngay cả khi build gặp lỗi hoặc bị hủy
        TAURI_CONF_PATH.write_text(original_tauri_conf, encoding="utf-8")
        print("--> Đã khôi phục 'beforeBuildCommand' trong src-tauri/tauri.conf.json.")

    # ------------------------------------------------------------------
    # Bước 4: Kiểm tra kết quả file cài đặt
    # ------------------------------------------------------------------
    log_step("BƯỚC 4/4", "KIỂM TRA VÀ XÁC NHẬN FILE BẢN MỚI")
    nsis_dir = ROOT_DIR / "src-tauri" / "target" / "release" / "bundle" / "nsis"
    exe_files = list(nsis_dir.glob("*.exe")) if nsis_dir.exists() else []

    if not exe_files:
        print(f"\n[X] LỖI: Không tìm thấy file cài đặt .exe nào trong: {nsis_dir}")
        sys.exit(1)

    latest_exe = max(exe_files, key=lambda f: f.stat().st_mtime)
    size_mb = latest_exe.stat().st_size / (1024 * 1024)
    file_time = datetime.fromtimestamp(latest_exe.stat().st_mtime).strftime("%d/%m/%Y %H:%M:%S")
    elapsed = datetime.now() - start_time
    minutes = int(elapsed.total_seconds() // 60)
    seconds = int(elapsed.total_seconds() % 60)

    print("======================================================================")
    print("  🎉 QUÁ TRÌNH ĐÓNG GÓI HOÀN TẤT THÀNH CÔNG!")
    print("======================================================================")
    print(f"  📦 File cài đặt:  {latest_exe.name}")
    print(f"  📏 Dung lượng:    {size_mb:.2f} MB ({latest_exe.stat().st_size:,} bytes)")
    print(f"  🕒 Thời gian tạo: {file_time}")
    print(f"  ⏱ Tổng thời gian:{minutes} phút {seconds} giây")
    print(f"  📍 Đường dẫn:     {latest_exe.resolve()}")
    print("======================================================================")

    try:
        if sys.stdin and sys.stdin.isatty():
            choice = input("\nBạn có muốn mở thư mục chứa file cài đặt vừa tạo không? [Y/n]: ").strip().lower()
            if choice in ("", "y", "yes"):
                os.startfile(str(nsis_dir))
    except Exception:
        pass


if __name__ == "__main__":
    main()

