"""
=============================================================================
UNIFIED PROJECT LAUNCHER - FACEBOOK AUTOMATOR PRO
Backend FastAPI :28129, giao diện user :3000, giao diện admin :3010.
Tự động dọn dẹp tiến trình khi đóng (Ctrl+C) hoặc khi self-test xong.
=============================================================================
"""
import sys
import os
import json
import time
import subprocess
import webbrowser
import argparse
from pathlib import Path
import urllib.request
import urllib.error
import urllib.parse

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
ADMIN_DIR = BASE_DIR / "web-admin"
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

BACKEND_URL = "http://127.0.0.1:28129/api/health"
FRONTEND_URL = "http://127.0.0.1:3000"
ADMIN_URL = "http://127.0.0.1:3010/login"
API_ORIGIN = "http://127.0.0.1:28129"

MODULE_ENDPOINTS = [
    "/api/modules",
    "/api/dashboard/stats",
    "/api/accounts",
    "/api/pages",
    "/api/settings",
    "/api/proxies",
    "/api/keys",
    "/api/logs",
    "/api/v1/auth/me",
    "/api/v1/admin/stats",
    "/api/v1/admin/users",
]


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
        urls_to_check.append(url.replace("localhost", "127.0.0.1"))
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
                    if response.status in (200, 304):
                        return True
            except Exception:
                pass
        time.sleep(0.5)

    if log_file:
        print_log_tail(log_file)
    return False


def kill_process_tree(pid: int):
    try:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass

def npm_cmd():
    return "npm.cmd" if os.name == "nt" else "npm"


def admin_credentials():
    env = {}
    path = BASE_DIR / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip('"').strip("'")
    return env.get("ADMIN_USERNAME") or "admin", env.get("ADMIN_PASSWORD") or "Admin@123456"


def http_call(method, url, data=None, headers=None, timeout=20):
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers or {"User-Agent": "fb-selftest"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def spawn(cmd, cwd, log_name):
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_file = open(LOGS_DIR / log_name, "w", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(cmd, cwd=str(cwd), stdout=log_file, stderr=subprocess.STDOUT)
    proc._fb_log = log_file
    return proc


def close_proc(proc):
    if not proc:
        return
    log_file = getattr(proc, "_fb_log", None)
    kill_process_tree(proc.pid)
    if log_file:
        log_file.close()


def tail_log(name):
    path = LOGS_DIR / name
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        return
    lines = text.splitlines()[-8:]
    print(f"  [LOG] {name}:")
    for line in lines:
        print(f"    {line}")


def run_self_test():
    print("\n[SELF-TEST] User UI, Admin UI, backend va cac module API:")
    ok = True

    status, _ = http_call("GET", BACKEND_URL)
    print(f"  * GET /api/health -> HTTP {status}")
    ok = ok and status == 200

    status, _ = http_call("GET", "http://127.0.0.1:28129/api/v1/auth/hwid")
    print(f"  * GET /api/v1/auth/hwid -> HTTP {status}")
    ok = ok and status == 200

    status, body = http_call("GET", FRONTEND_URL)
    print(f"  * GET user UI :3000 -> HTTP {status}")
    ok = ok and status == 200

    status, _ = http_call("GET", ADMIN_URL)
    print(f"  * GET admin UI :3010/login -> HTTP {status}")
    ok = ok and status == 200

    username, password = admin_credentials()
    query = urllib.parse.urlencode({"username": username, "password": password})
    status, body = http_call("POST", f"{API_ORIGIN}/api/v1/admin/login?{query}")
    print(f"  * POST /api/v1/admin/login -> HTTP {status}")
    token = ""
    if status == 200:
        token = json.loads(body.decode()).get("access_token") or ""
    else:
        ok = False
    if not token:
        print("  [ERROR] Khong lay duoc phien admin de goi API module.")
        return False

    headers = {"User-Agent": "fb-selftest", "Authorization": f"Bearer {token}"}
    for path in MODULE_ENDPOINTS:
        status, payload = http_call("GET", API_ORIGIN + path, headers=headers)
        extra = ""
        if path == "/api/modules" and status == 200:
            count = json.loads(payload.decode()).get("count")
            extra = f" count={count}"
            if count != 9:
                ok = False
                extra += " (can 9)"
        print(f"  * GET {path} -> HTTP {status}{extra}")
        if status != 200:
            ok = False

    if ok:
        print("\n[PASSED] User UI, Admin UI va backend 9 module deu phan hoi.")
    else:
        print("\n[FAILED] Self-test chua dat.")
    return ok


def run_project(self_test_only: bool = False, open_browser: bool = True):
    print("=" * 70)
    print("[START] KHOI DONG FACEBOOK AUTOMATOR PRO")
    print("=" * 70)

    # 0. Giải phóng cổng 28129, 3000 và 3010 trước khi chạy để tránh xung đột cổng
    free_port(28129)
    free_port(3000)
    free_port(3010)

    backend_proc = None
    frontend_proc = None
    admin_proc = None

    try:
        print("\n[1/3] Backend Local Engine (Port 28129)...")
        backend_proc = spawn([sys.executable, "engine.py", "--port", "28129"], BASE_DIR, "engine.log")
        if wait_for_url(BACKEND_URL, timeout=60, proc=backend_proc, service_name="Backend"):
            print("  [OK] Backend: http://127.0.0.1:28129")
            print("  [OK] Swagger: http://127.0.0.1:28129/docs")
        else:
            print("  [ERROR] Backend khong phan hoi sau 60 giay.")
            tail_log("engine.log")
            return False

        print("\n[2/3] Giao dien user Next.js (Port 3000)...")
        frontend_proc = spawn([npm_cmd(), "run", "dev", "--", "-H", "127.0.0.1", "-p", "3000"], FRONTEND_DIR, "frontend.log")
        if wait_for_url(FRONTEND_URL, timeout=60, proc=frontend_proc, service_name="User UI"):
            print("  [OK] User UI: http://127.0.0.1:3000")
        else:
            print("  [ERROR] User UI khong phan hoi sau 60 giay.")
            tail_log("frontend.log")
            return False

        print("\n[3/3] Giao dien admin Next.js (Port 3010)...")
        admin_proc = spawn([npm_cmd(), "run", "dev"], ADMIN_DIR, "admin.log")
        if wait_for_url(ADMIN_URL, timeout=60, proc=admin_proc, service_name="Admin UI"):
            print("  [OK] Admin UI: http://127.0.0.1:3010")
        else:
            print("  [ERROR] Admin UI khong phan hoi sau 60 giay.")
            tail_log("admin.log")
            return False
            return False

        print("\n" + "=" * 70)
        print("[SUCCESS] USER UI, ADMIN UI VA BACKEND DA LEN.")
        print("  >> User UI:    http://127.0.0.1:3000")
        print("  >> Admin UI:   http://127.0.0.1:3010")
        print("  >> Backend:    http://127.0.0.1:28129")
        print("  >> Swagger:    http://127.0.0.1:28129/docs")
        print("=" * 70)

        if self_test_only:
            return run_self_test()

        if open_browser:
            webbrowser.open("http://127.0.0.1:3000")
            webbrowser.open("http://127.0.0.1:3010/login")

        print("\n[INFO] Nhan [Ctrl + C] de dung user UI, admin UI va backend.")
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n[INFO] Nhan tin hieu dung tu nguoi dung...")
    except Exception as exc:
        print(f"\n[ERROR] Loi ngoai y muon: {exc}")
        return False
    finally:
        print("\n[CLEANUP] Dang dong tien trinh con...")
        close_proc(backend_proc)
        print("  * Da dung Backend (28129).")
        close_proc(frontend_proc)
        print("  * Da dung User UI (3000).")
        close_proc(admin_proc)
        print("  * Da dung Admin UI (3010).")
        free_port(28129)
        free_port(3000)
        free_port(3010)
        print("[CLEANUP DONE] Hoan tat don dep. Cong 28129, 3000 va 3010 da duoc giai phong!")

    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Chay user UI, admin UI va backend Facebook Automator Pro")
    parser.add_argument("--test", action="store_true", help="Chay self-test roi dong")
    parser.add_argument("--no-browser", action="store_true", help="Khong tu dong mo trinh duyet")
    args = parser.parse_args()

    success = run_project(self_test_only=args.test, open_browser=not args.no_browser)
