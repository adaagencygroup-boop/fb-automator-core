"""Admin refresh and session expiry in a browser, using mocked APIs only."""
import base64
import json
import re
from playwright.sync_api import sync_playwright, expect


def token(name):
    payload = base64.urlsafe_b64encode(json.dumps({"sub": "admin", "role": "admin", "uid": 1, "jti": name}).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page()
        page.clock.install()
        state = {"refreshes": 0, "mode": "success"}
        admin = {"id": 1, "username": "admin", "role": "admin", "status": "approved", "contact_info": "", "created_at": "2026-01-01"}
        user = {**admin, "id": 2, "username": "testmember", "role": "user", "days_remaining": 30, "is_online": False}
        headers = {"Access-Control-Allow-Origin": "http://127.0.0.1:3010", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type,authorization,x-auth-client", "Access-Control-Allow-Methods": "GET,POST,OPTIONS"}

        def api(route):
            request = route.request
            path = request.url.split("?")[0]
            if request.method == "OPTIONS":
                route.fulfill(status=204, headers=headers)
                return
            if path.endswith("/notifications/stream"):
                route.abort()
                return
            status, data = 200, {}
            if path.endswith("/admin/login"):
                data = {"access_token": token("expired")}
            elif path.endswith("/auth/refresh"):
                assert request.headers.get("x-auth-client") == "admin"
                state["refreshes"] += 1
                if state["mode"] == "server-error":
                    status, data = 503, {"detail": "Database unavailable"}
                elif state["mode"] == "expired-refresh":
                    status, data = 401, {"detail": "TOKEN_INVALID"}
                else:
                    data = {"ok": True, "access_token": token(f"renewed-{state['refreshes']}")}
            elif request.headers.get("authorization") == f"Bearer {token('expired')}":
                status, data = 401, {"detail": "TOKEN_INVALID"}
            elif state["mode"] == "revoked":
                status, data = 401, {"detail": "SESSION_REVOKED"}
            elif path.endswith("/admin/me"):
                data = admin
            elif path.endswith("/admin/users"):
                data = [admin, user]
            elif path.endswith("/admin/stats"):
                data = {"total_users": 1, "approved": 1, "pending": 0, "banned": 0, "expiring_soon": 0, "unread_notifications": 0}
            elif path.endswith("/notifications"):
                data = []
            route.fulfill(status=status, headers=headers, content_type="application/json", body=json.dumps(data))

        page.route("**/api/**", api)

        def login():
            page.goto("http://127.0.0.1:3010/login")
            page.locator("#admin-user").fill("admin")
            page.locator("#admin-pass").fill("test-password")
            page.locator("form button[type=submit]").click()

        login()
        expect(page.get_by_text("testmember", exact=True)).to_be_visible()
        assert state["refreshes"] == 1, state
        assert page.evaluate("localStorage.getItem('admin_token')") == token("renewed-1")
        page.clock.fast_forward(10 * 60 * 1000)
        page.wait_for_function("expected => localStorage.getItem('admin_token') === expected", arg=token("renewed-2"))
        assert state["refreshes"] == 2, state
        expect(page).to_have_url("http://127.0.0.1:3010/dashboard/users")

        state["mode"] = "revoked"
        page.reload()
        expect(page).to_have_url(re.compile(r"/login(?:\?|$)"))
        assert page.evaluate("localStorage.getItem('admin_token')") is None
        assert state["refreshes"] == 2, state

        state["mode"] = "server-error"
        login()
        expect(page).to_have_url("http://127.0.0.1:3010/dashboard/users")
        expect(page.get_by_role("heading", name="Quản lý người dùng")).to_be_visible()
        assert page.evaluate("localStorage.getItem('admin_token')") == token("expired")

        state["mode"] = "expired-refresh"
        page.reload()
        expect(page).to_have_url(re.compile(r"/login(?:\?|$)"))
        assert page.evaluate("localStorage.getItem('admin_token')") is None
        browser.close()
        print("PASS: expired access recovery, 10-minute refresh, revoked/expired sessions logout, temporary errors keep login")


if __name__ == "__main__":
    main()
