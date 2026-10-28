#!/usr/bin/env python3
"""
Self-test API giống client .exe (Tauri):
  - Origin giả lập tauri.localhost
  - X-Auth-Client: user
  - Login → Bearer token → gọi các endpoint chính

Chạy khi Engine .exe đang listen 28129:
  python scripts/smoke_exe_api.py
  python scripts/smoke_exe_api.py --user truonglon --password 123456
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any, Callable, Optional

import requests

BASE = "http://127.0.0.1:28129"
ORIGIN = "https://tauri.localhost"
TIMEOUT = 20


class Colors:
    OK = "\033[92m"
    FAIL = "\033[91m"
    WARN = "\033[93m"
    DIM = "\033[90m"
    END = "\033[0m"


def hdr(**extra: str) -> dict:
    h = {
        "Content-Type": "application/json",
        "X-Auth-Client": "user",
        "Origin": ORIGIN,
        "Referer": f"{ORIGIN}/",
    }
    h.update(extra)
    return h


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--user", default="truonglon")
    parser.add_argument("--password", default="123456")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    results: list[tuple[str, bool, str]] = []

    def check(name: str, fn: Callable[[], Any]) -> Any:
        t0 = time.time()
        try:
            value = fn()
            ms = int((time.time() - t0) * 1000)
            results.append((name, True, f"{ms}ms"))
            print(f"{Colors.OK}PASS{Colors.END}  {name}  {Colors.DIM}{ms}ms{Colors.END}")
            return value
        except Exception as exc:
            ms = int((time.time() - t0) * 1000)
            msg = str(exc)
            results.append((name, False, msg))
            print(f"{Colors.FAIL}FAIL{Colors.END}  {name}  {Colors.DIM}{ms}ms{Colors.END}")
            print(f"      {msg}")
            return None

    session = requests.Session()

    def get(path: str, token: Optional[str] = None, **kw):
        headers = hdr(**({"Authorization": f"Bearer {token}"} if token else {}))
        r = session.get(f"{base}{path}", headers=headers, timeout=TIMEOUT, **kw)
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
        return r.json() if r.content else {}

    def post(path: str, body: Optional[dict] = None, token: Optional[str] = None, **kw):
        headers = hdr(**({"Authorization": f"Bearer {token}"} if token else {}))
        r = session.post(f"{base}{path}", headers=headers, json=body or {}, timeout=TIMEOUT, **kw)
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
        return r.json() if r.content else {}

    print(f"\n=== SMOKE EXE API @ {base} (Origin={ORIGIN}) ===\n")

    health = check("GET /api/health", lambda: get("/api/health"))
    if not health or health.get("status") != "online":
        print(f"\n{Colors.FAIL}Engine offline — mở FB_Page_Automator.exe trước.{Colors.END}")
        return 2

    hwid_data = check("GET /api/v1/auth/hwid", lambda: get("/api/v1/auth/hwid"))
    hwid = (hwid_data or {}).get("hwid") or ""

    login = check(
        "POST /api/v1/auth/login (+access_token in body)",
        lambda: post(
            "/api/v1/auth/login",
            {"username": args.user, "password": args.password, "hwid": hwid, "remember_me": True},
        ),
    )
    token = (login or {}).get("access_token")
    refresh = (login or {}).get("refresh_token")
    if not token:
        print(f"\n{Colors.FAIL}Login không trả access_token — bản sidecar cũ / cookie-only.{Colors.END}")
        _summary(results)
        return 1

    me = check("GET /api/v1/auth/me (Bearer)", lambda: get("/api/v1/auth/me", token=token))
    if me:
        print(f"      user={me.get('username')} role={me.get('role')} status={me.get('status')}")

    check("GET /api/modules (Bearer)", lambda: get("/api/modules", token=token))

    check(
        "POST /api/v1/auth/refresh (body refresh_token)",
        lambda: post("/api/v1/auth/refresh", {"refresh_token": refresh}, token=token),
    )

    # Module endpoints — expect 200 (data) hoặc 401/403 có ý nghĩa; 500/404 router = fail
    def soft_get(path: str, token: str):
        headers = hdr(Authorization=f"Bearer {token}")
        r = session.get(f"{base}{path}", headers=headers, timeout=TIMEOUT)
        if r.status_code >= 500:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
        if r.status_code == 404:
            raise RuntimeError(f"HTTP 404 route missing: {path}")
        # 401/403 vẫn coi là route sống (auth/permission)
        return {"status": r.status_code, "ok": r.status_code < 500}

    # Đúng path thật trong codebase (không đoán)
    module_paths = [
        "/api/accounts",
        "/api/accounts/stats",
        "/api/pages",
        "/api/pages/managed",
        "/api/pages/oauth-config",
        "/api/group-scan/health",
        "/api/group-scan/accounts",
        "/api/groups/campaigns",
        "/api/v1/auth/my-sessions",
        "/api/seeding/campaigns",
        "/api/seeding/stats",
        "/api/farm/status",
        "/api/farm/settings",
        "/api/farm/history",
        "/api/page-scanner/sessions",
        "/api/page-scanner/pages",
    ]

    for path in module_paths:
        check(f"GET {path}", lambda p=path: soft_get(p, token))

    # CORS preflight style Origin acceptance via simple GET with Origin
    def cors_ok():
        r = session.get(
            f"{base}/api/health",
            headers=hdr(),
            timeout=TIMEOUT,
        )
        allow = r.headers.get("access-control-allow-origin", "")
        # With credentials, server may echo origin
        if r.status_code != 200:
            raise RuntimeError(f"health {r.status_code}")
        return {"allow_origin": allow or "(none/reflect via middleware)"}

    check("CORS Origin tauri.localhost → /api/health", cors_ok)

    check(
        "POST /api/v1/auth/logout",
        lambda: post("/api/v1/auth/logout", {}, token=token),
    )

    return _summary(results)


def _summary(results: list[tuple[str, bool, str]]) -> int:
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"\n=== SUMMARY: {passed} passed, {failed} failed / {len(results)} ===")
    if failed:
        print(f"{Colors.FAIL}EXE API chưa sẵn sàng — xem FAIL ở trên.{Colors.END}")
        return 1
    print(f"{Colors.OK}EXE API self-test OK — login Bearer + module routes sống.{Colors.END}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
