#!/usr/bin/env python3
"""
Self-test TỪNG MODULE trên Local Engine của bản .exe (port 28129).
Giống client Tauri: Origin tauri.localhost + X-Auth-Client:user + Bearer.

Chỉ probe GET / POST an toàn (list/status/settings/health) — không start job / xóa data.

  python scripts/smoke_exe_modules.py --user truonglon --password 123456
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from typing import Any, Optional

import requests

BASE = "http://127.0.0.1:28129"
ORIGIN = "https://tauri.localhost"
TIMEOUT = 25

# Probe an toàn theo module — path lấy từ router thật trong repo
SMOKE_ROUTES: dict[str, list[dict[str, Any]]] = {
    "engine_core": [
        {"method": "GET", "path": "/api/health", "auth": False},
        {"method": "GET", "path": "/api/modules"},
        {"method": "GET", "path": "/api/logs"},
    ],
    "auth": [
        {"method": "GET", "path": "/api/v1/auth/hwid", "auth": False},
        {"method": "GET", "path": "/api/v1/auth/me"},
        {"method": "GET", "path": "/api/v1/auth/my-sessions"},
    ],
    "module_01_dashboard": [
        {"method": "GET", "path": "/api/dashboard/stats"},
    ],
    "module_02_accounts": [
        {"method": "GET", "path": "/api/accounts"},
        {"method": "GET", "path": "/api/accounts/page"},
        {"method": "GET", "path": "/api/accounts/stats"},
        {"method": "GET", "path": "/api/accounts/categories"},
        {"method": "POST", "path": "/api/accounts/existing-uids", "body": {"uids": []}},
    ],
    "module_03_farm": [
        {"method": "GET", "path": "/api/farm/status"},
        {"method": "GET", "path": "/api/farm/settings"},
        {"method": "GET", "path": "/api/farm/history"},
    ],
    "module_03_post": [
        {"method": "GET", "path": "/api/post/settings"},
        {"method": "GET", "path": "/api/post/status"},
        {"method": "GET", "path": "/api/post/history"},
        {"method": "GET", "path": "/api/post/drafts"},
        {"method": "GET", "path": "/api/post/gemini-models"},
    ],
    "module_04_creator": [
        {"method": "GET", "path": "/api/creator/tasks/status"},
        {"method": "GET", "path": "/api/creator/pages/history"},
        {"method": "GET", "path": "/api/creator/pages/managed"},
        {"method": "GET", "path": "/api/creator/settings"},
    ],
    "module_05_pages": [
        {"method": "GET", "path": "/api/pages"},
        {"method": "GET", "path": "/api/pages/managed"},
        {"method": "GET", "path": "/api/pages/accounts"},
        {"method": "GET", "path": "/api/pages/web-connection"},
        {"method": "GET", "path": "/api/pages/oauth-config"},
        {"method": "GET", "path": "/api/pages/ai/accounts"},
        {"method": "GET", "path": "/api/pages/ai/settings"},
        {"method": "GET", "path": "/api/pages/ai/status"},
        {"method": "GET", "path": "/api/pages/reels/accounts-pages"},
        {"method": "GET", "path": "/api/pages/reels/status"},
        {"method": "GET", "path": "/api/pages/history/stats"},
        {"method": "GET", "path": "/api/pages/history/terminal-logs"},
        {"method": "GET", "path": "/api/pages/history"},
        {"method": "GET", "path": "/api/pages/tiktok/auth-status"},
        {"method": "GET", "path": "/api/pages/tiktok/config"},
        {"method": "GET", "path": "/api/pages/youtube/config"},
    ],
    "module_06_chat": [
        {"method": "GET", "path": "/api/facebook/status"},
        {"method": "GET", "path": "/api/facebook/config"},
        {"method": "GET", "path": "/api/facebook/pages"},
        {"method": "GET", "path": "/api/facebook/conversations"},
        {"method": "GET", "path": "/api/facebook/messages"},
        {"method": "GET", "path": "/api/facebook/notifications"},
    ],
    "module_07_groups": [
        {"method": "GET", "path": "/api/groups/settings"},
        {"method": "GET", "path": "/api/groups/credentials"},
        {"method": "GET", "path": "/api/groups/source/template"},
        {"method": "GET", "path": "/api/groups/source/history"},
        {"method": "GET", "path": "/api/groups/media/list"},
        {"method": "GET", "path": "/api/groups/campaign/current"},
        {"method": "GET", "path": "/api/groups/campaigns"},
        {"method": "GET", "path": "/api/groups/history"},
        {"method": "POST", "path": "/api/groups/source/parse", "body": {"content": "", "filter_posted": False}},
    ],
    "module_08_seeding": [
        {"method": "GET", "path": "/api/seeding/targets"},
        {"method": "GET", "path": "/api/seeding/comments"},
        {"method": "GET", "path": "/api/seeding/campaigns"},
        {"method": "GET", "path": "/api/seeding/campaigns/active"},
        {"method": "GET", "path": "/api/seeding/stats"},
    ],
    "module_09_profile": [
        {"method": "GET", "path": "/api/settings"},
        {"method": "GET", "path": "/api/proxies"},
        {"method": "GET", "path": "/api/keys"},
    ],
    "module_10_group_scan": [
        {"method": "GET", "path": "/api/group-scan/health"},
        {"method": "GET", "path": "/api/group-scan/accounts"},
        {
            "method": "POST",
            "path": "/api/group-scan/lookup-keywords",
            "body": {"keywords": ["__smoke__"], "include_groups": False},
        },
    ],
    "module_11_page_scanner": [
        {"method": "GET", "path": "/api/page-scanner/source/template"},
        {"method": "GET", "path": "/api/page-scanner/sessions"},
        {"method": "GET", "path": "/api/page-scanner/pages"},
        {"method": "GET", "path": "/api/page-scanner/campaigns/active"},
    ],
}

OK = "\033[92m"
FAIL = "\033[91m"
WARN = "\033[93m"
DIM = "\033[90m"
BOLD = "\033[1m"
END = "\033[0m"


def headers(token: Optional[str] = None) -> dict:
    h = {
        "Content-Type": "application/json",
        "X-Auth-Client": "user",
        "Origin": ORIGIN,
        "Referer": f"{ORIGIN}/",
    }
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def classify(status: int, body: str) -> str:
    """pass | warn | fail"""
    if status < 400:
        return "pass"
    # Auth / license / empty resource — route sống, không phải crash đóng gói
    if status in (401, 403):
        return "warn"
    if status == 404:
        # 404 có thể là "chưa có resource" hoặc route thiếu — phân biệt nhanh
        low = (body or "").lower()
        if any(k in low for k in ("not found", "không tìm", "no job", "unknown", "detail")):
            return "warn"
        return "fail"
    if status >= 500:
        return "fail"
    return "warn"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--user", default="truonglon")
    ap.add_argument("--password", default="123456")
    ap.add_argument("--json-out", default="")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    session = requests.Session()

    print(f"\n{BOLD}=== SMOKE EXE PER-MODULE @ {base} ==={END}\n")

    # Health
    try:
        r = session.get(f"{base}/api/health", headers=headers(), timeout=TIMEOUT)
        r.raise_for_status()
        print(f"{OK}Engine online{END}: {r.json()}")
    except Exception as exc:
        print(f"{FAIL}Engine offline{END}: {exc}")
        print("Mở Desktop\\FB_Page_Automator\\fb_page_automator.exe rồi chạy lại.")
        return 2

    # Login
    hwid = session.get(f"{base}/api/v1/auth/hwid", headers=headers(), timeout=TIMEOUT).json().get("hwid", "")
    login = session.post(
        f"{base}/api/v1/auth/login",
        headers=headers(),
        json={"username": args.user, "password": args.password, "hwid": hwid, "remember_me": True},
        timeout=TIMEOUT,
    )
    if login.status_code >= 400:
        print(f"{FAIL}Login failed{END}: {login.status_code} {login.text[:300]}")
        return 1
    data = login.json()
    token = data.get("access_token")
    if not token:
        print(f"{FAIL}Login không trả access_token — sidecar cũ.{END}")
        return 1
    print(f"{OK}Login OK{END}: user={data.get('username')} role={data.get('role')} status={data.get('status')}\n")

    report: dict[str, list[dict]] = defaultdict(list)
    totals = {"pass": 0, "warn": 0, "fail": 0}

    for module, routes in SMOKE_ROUTES.items():
        print(f"{BOLD}── {module} ({len(routes)} probes) ──{END}")
        for route in routes:
            method = route["method"].upper()
            path = route["path"]
            need_auth = route.get("auth", True)
            body = route.get("body")
            t0 = time.time()
            try:
                h = headers(token if need_auth else None)
                if method == "GET":
                    resp = session.get(f"{base}{path}", headers=h, timeout=TIMEOUT)
                else:
                    resp = session.request(method, f"{base}{path}", headers=h, json=body if body is not None else {}, timeout=TIMEOUT)
                ms = int((time.time() - t0) * 1000)
                kind = classify(resp.status_code, resp.text)
                snippet = (resp.text or "").replace("\n", " ")[:120]
                item = {
                    "method": method,
                    "path": path,
                    "status": resp.status_code,
                    "ms": ms,
                    "result": kind,
                    "body": snippet,
                }
            except Exception as exc:
                ms = int((time.time() - t0) * 1000)
                kind = "fail"
                item = {
                    "method": method,
                    "path": path,
                    "status": 0,
                    "ms": ms,
                    "result": kind,
                    "body": str(exc)[:200],
                }
            report[module].append(item)
            totals[kind] += 1
            color = OK if kind == "pass" else WARN if kind == "warn" else FAIL
            print(f"  {color}{kind.upper():4}{END} {method:4} {path}  {DIM}HTTP {item['status']} {ms}ms{END}")
            if kind == "fail":
                print(f"       {item['body']}")
        print()

    # Logout
    session.post(f"{base}/api/v1/auth/logout", headers=headers(token), json={}, timeout=TIMEOUT)

    print(f"{BOLD}=== TỔNG: {totals['pass']} pass | {totals['warn']} warn | {totals['fail']} fail ==={END}")
    if totals["fail"]:
        print(f"\n{FAIL}Module có FAIL (route thiếu / 500 — cần fix đóng gói):{END}")
        for mod, items in report.items():
            fails = [i for i in items if i["result"] == "fail"]
            if fails:
                print(f"  • {mod}:")
                for i in fails:
                    print(f"      {i['method']} {i['path']} → HTTP {i['status']} {i['body'][:160]}")
    elif totals["warn"]:
        print(f"{WARN}Không có FAIL cứng. Warn = 401/403/404 nghiệp vụ (thường OK nếu user thiếu quyền/module).{END}")
    else:
        print(f"{OK}Tất cả probe module trên .exe Engine đều ổn.{END}")

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump({"totals": totals, "modules": report}, f, ensure_ascii=False, indent=2)
        print(f"Wrote {args.json_out}")

    return 1 if totals["fail"] else 0


if __name__ == "__main__":
    sys.exit(main())
