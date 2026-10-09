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
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

BACKEND_URL = "http://127.0.0.1:28129/api/health"
FRONTEND_URL = "http://127.0.0.1:3000"


def free_port(port: int):
    """Giải phóng cổng mạng nếu bị chiếm dụng bởi tiến trình chạy ngầm cũ trên Windows"""
    if sys.platform == "win32":
        try:
            cmd = f'powershell -Command "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"'
            subprocess.run(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass


def print_log_tail(log_file: Path, max_lines: int = 20):
    """In những dòng cuối của log khi có lỗi để dev dễ chẩn đoán"""
    if not log_file.exists():
        return
    try:
        lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
        tail = lines[-max_lines:]
        print("\n--- [CHI TIET LOG LOI] ---")
        for line in tail:
            print(f"  {line}")
        print("---------------------------\n")
    except Exception:
        pass


def wait_for_url(url: str, timeout: int = 40, proc: subprocess.Popen = None, service_name: str = "Service", log_file: Path = None) -> bool:
    """Chờ URL phản hồi 200 OK với timeout và kiểm tra tiến trình có sống không"""
    start_time = time.time()
    urls_to_check = [url]
    if "localhost" in url:
        urls_to_check.insert(0, url.replace("localhost", "127.0.0.1"))
    elif "127.0.0.1" in url:
        urls_to_check.append(url.replace("127.0.0.1", "localhost"))

    while time.time() - start_time < timeout:
        if proc and proc.poll() is not None:
            print(f"  [ERROR] {service_name} da dung voi exit code {proc.poll()}!")
            if log_file:
                print_log_tail(log_file)
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

    if log_file:
        print_log_tail(log_file)
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

    # 0. Giải phóng cổng 28129 và 3000 trước khi chạy để tránh xung đột cổng
    free_port(28129)
    free_port(3000)

    backend_proc = None
    frontend_proc = None

    backend_log_path = LOGS_DIR / "backend.log"
    frontend_log_path = LOGS_DIR / "frontend.log"

    try:
        # 1. Khởi động Backend (FastAPI Engine - port 28129)
        print("\n[1/3] Dang khoi dong Backend Local Engine (Port 28129)...")
        backend_cmd = [sys.executable, "engine.py", "--port", "28129"]
        
        backend_log_file = open(backend_log_path, "w", encoding="utf-8")
        backend_proc = subprocess.Popen(
            backend_cmd,
            cwd=str(BASE_DIR),
            stdout=backend_log_file,
            stderr=subprocess.STDOUT
        )

        # Chờ Backend sẵn sàng
        if wait_for_url(BACKEND_URL, timeout=15, proc=backend_proc, service_name="Backend", log_file=backend_log_path):
            print("  [OK] Backend da san sang tai: http://127.0.0.1:28129")
            print("  [OK] API Docs (Swagger):      http://127.0.0.1:28129/docs")
        else:
            print("  [ERROR] Loi: Backend khong phan hoi sau 15 giay!")
            return False

        # 2. Khởi động Frontend (Next.js - port 3000)
        print("\n[2/3] Dang khoi dong Frontend Next.js + Tailwind CSS (Port 3000)...")
        frontend_cmd = ["npm.cmd" if os.name == "nt" else "npm", "run", "dev"]
        
        frontend_log_file = open(frontend_log_path, "w", encoding="utf-8")
        frontend_proc = subprocess.Popen(
            frontend_cmd,
            cwd=str(FRONTEND_DIR),
            stdout=frontend_log_file,
            stderr=subprocess.STDOUT,
            shell=(os.name == "nt")
        )

        # Chờ Frontend sẵn sàng
        if wait_for_url(FRONTEND_URL, timeout=45, proc=frontend_proc, service_name="Frontend", log_file=frontend_log_path):
            print("  [OK] Frontend Next.js da san sang tai: http://localhost:3000")
        else:
            print("  [ERROR] Loi: Frontend khong phan hoi sau 45 giay!")
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
        free_port(28129)
        free_port(3000)
        print("[CLEANUP DONE] Hoan tat don dep. Cong 28129 va 3000 da duoc giai phong!")

    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Chay toan bo du an Facebook Automator Pro")
    parser.add_argument("--test", action="store_true", help="Chay che do self-test tu dong roi dong")
    parser.add_argument("--no-browser", action="store_true", help="Khong tu dong mo trinh duyet")
    args = parser.parse_args()

    success = run_project(self_test_only=args.test, open_browser=not args.no_browser)
