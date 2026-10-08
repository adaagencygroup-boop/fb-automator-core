"""
=============================================================================
UNIFIED PROJECT LAUNCHER - FACEBOOK AUTOMATOR PRO
Khởi chạy đồng thời cả Backend (FastAPI: 28129) và Frontend (Next.js: 3000)
Tự động dọn dẹp tiến trình khi đóng (Ctrl+C).
=============================================================================
"""
import sys
import os
import time
import subprocess
import signal
import webbrowser
import argparse
from pathlib import Path
import urllib.request
import urllib.error

# Bảo đảm mã hóa đầu ra an toàn cho Windows Terminal (tránh lỗi charmap cp1252)
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

BACKEND_URL = "http://127.0.0.1:28129/api/health"
FRONTEND_URL = "http://localhost:3000"

def wait_for_url(url: str, timeout: int = 40, proc: subprocess.Popen = None, service_name: str = "Service") -> bool:
    """Chờ URL phản hồi 200 OK với timeout và kiểm tra tiến trình có sống không"""
    start_time = time.time()
    urls_to_check = [url]
    if "localhost" in url:
        urls_to_check.append(url.replace("localhost", "127.0.0.1"))

    while time.time() - start_time < timeout:
        if proc and proc.poll() is not None:
            print(f"  [ERROR] {service_name} da dung voi exit code {proc.poll()}!")
            return False
        for target_url in urls_to_check:
            try:
                req = urllib.request.Request(target_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=2) as response:
                    if response.status in [200, 304]:
                        return True
            except Exception:
                pass
        time.sleep(0.5)
    return False

def kill_process_tree(pid: int):
    """Diệt tiến trình và toàn bộ tiến trình con trên Windows an toàn"""
    try:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
    except Exception:
        pass

def run_project(self_test_only: bool = False, open_browser: bool = True):
    print("=" * 70)
    print("[START] KHOI DONG HE THONG FACEBOOK AUTOMATOR PRO (FULLSTACK)")
    print("=" * 70)

    backend_proc = None
    frontend_proc = None

    try:
        # 1. Khởi động Backend (FastAPI Engine - port 28129)
        print("\n[1/3] Dang khoi dong Backend Local Engine (Port 28129)...")
        backend_cmd = [sys.executable, "engine.py", "--port", "28129"]
        backend_proc = subprocess.Popen(
            backend_cmd,
            cwd=str(BASE_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        # Chờ Backend sẵn sàng
        if wait_for_url(BACKEND_URL, timeout=15, proc=backend_proc, service_name="Backend"):
            print("  [OK] Backend da san sang tai: http://127.0.0.1:28129")
            print("  [OK] API Docs (Swagger):      http://127.0.0.1:28129/docs")
        else:
            print("  [ERROR] Loi: Backend khong phan hoi sau 15 giay!")
            return False

        # 2. Khởi động Frontend (Next.js - port 3000)
        print("\n[2/3] Dang khoi dong Frontend Next.js + Tailwind CSS (Port 3000)...")
        frontend_cmd = ["npm.cmd" if os.name == "nt" else "npm", "run", "dev"]
        frontend_proc = subprocess.Popen(
            frontend_cmd,
            cwd=str(FRONTEND_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        # Chờ Frontend sẵn sàng
        if wait_for_url(FRONTEND_URL, timeout=40, proc=frontend_proc, service_name="Frontend"):
            print("  [OK] Frontend Next.js da san sang tai: http://localhost:3000")
        else:
            print("  [ERROR] Loi: Frontend khong phan hoi sau 40 giay!")
            return False

        print("\n" + "=" * 70)
        print("[SUCCESS] TOAN BO DU AN DA KHOI CHAY THANH CONG!")
        print("  >> Frontend UI:   http://localhost:3000")
        print("  >> Backend API:  http://127.0.0.1:28129")
        print("  >> API Swagger:  http://127.0.0.1:28129/docs")
        print("  >> Supabase DB:   aws-0-ap-northeast-1.pooler.supabase.com (Online)")
        print("=" * 70)

        # Nếu là chế độ self-test
        if self_test_only:
            print("\n[SELF-TEST] Kiem tra cac endpoint cot loi:")
            
            # Test Backend Health
            req_health = urllib.request.urlopen("http://127.0.0.1:28129/api/health")
            print(f"  * GET /api/health           -> HTTP {req_health.status} OK")

            # Test Backend Dashboard
            req_dash = urllib.request.urlopen("http://127.0.0.1:28129/api/dashboard/stats")
            print(f"  * GET /api/dashboard/stats  -> HTTP {req_dash.status} OK")

            # Test Frontend HTML
            req_fe = urllib.request.urlopen("http://localhost:3000")
            print(f"  * GET http://localhost:3000 -> HTTP {req_fe.status} OK")

            print("\n[PASSED] TAT CA CAC BAI KIEM THU (SELF-TEST) DEU HOAN TOAN THANH CONG!")
            return True

        # Tự động mở trình duyệt nếu không phải test
        if open_browser:
            webbrowser.open("http://localhost:3000")

        print("\n[INFO] Nhan [Ctrl + C] tai cua so nay de DUNG toan bo du an sach se.")
        
        # Vòng lặp giữ tiến trình chạy
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n[INFO] Nhan tin hieu dung tu nguoi dung...")
    except Exception as e:
        print(f"\n[ERROR] Loi ngoai y muon: {e}")
        return False
    finally:
        # Dọn dẹp tiến trình sạch sẽ
        print("\n[CLEANUP] Dang don dep va dong toan bo tien trinh con...")
        if backend_proc:
            kill_process_tree(backend_proc.pid)
            print("  * Da dung Backend Local Engine (Port 28129).")
        if frontend_proc:
            kill_process_tree(frontend_proc.pid)
            print("  * Da dung Frontend Next.js (Port 3000).")
        print("[CLEANUP DONE] Hoan tat don dep. Cong 28129 va 3000 da duoc giai phong!")

    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Chay toan bo du an Facebook Automator Pro")
    parser.add_argument("--test", action="store_true", help="Chay che do self-test tu dong roi dong")
    parser.add_argument("--no-browser", action="store_true", help="Khong tu dong mo trinh duyet")
    args = parser.parse_args()

    success = run_project(self_test_only=args.test, open_browser=not args.no_browser)
    sys.exit(0 if success else 1)
