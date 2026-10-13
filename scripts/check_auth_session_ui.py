"""Session failure/recovery checks with mocked APIs; never uses production data."""
import json
import sys
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"


with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    for final_error in ("SESSION_REVOKED", "ACCOUNT_BANNED", "ACCOUNT_PENDING", "ACCOUNT_REJECTED"):
        context = browser.new_context()
        page = context.new_page()
        state = {"mode": "500"}
        page.route_web_socket("**/ws/logs", lambda ws: None)

        def route_api(route):
            headers = {"Access-Control-Allow-Origin": BASE, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS"}
            if route.request.method == "OPTIONS":
                route.fulfill(status=204, headers=headers)
                return
            url = route.request.url
            status, data = 200, {}
            if url.endswith(("/auth/me", "/auth/refresh")):
                if state["mode"] == "offline":
                    route.abort("internetdisconnected")
                    return
                if state["mode"] == "500":
                    status, data = 500, {"detail": "Database unavailable"}
                elif state["mode"] != "ok":
                    status, data = 401, {"detail": state["mode"]}
                else:
                    data = {"username": "member", "role": "user", "status": "expired", "modules_unlocked": False}
            elif url.endswith("/auth/hwid"):
                data = {"hwid": "TEST-DEVICE"}
            elif url.endswith("/auth/registration-status"):
                data = {"username": "member", "status": "banned"}
            route.fulfill(status=status, headers=headers, content_type="application/json", body=json.dumps(data))

        page.route("**/api/**", route_api)
        page.goto(BASE, wait_until="networkidle")
        expect(page.get_by_role("status").filter(has_text="Mất kết nối máy chủ")).to_be_visible()
        state["mode"] = "ok"
        expect(page.get_by_role("status").filter(has_text="Mất kết nối máy chủ")).to_have_count(0, timeout=15000)
        login = page.locator("#login-username")
        expect(login).to_have_count(0)
        for failure in ("500", "offline"):
            state["mode"] = failure
            page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
            expect(page.get_by_role("status").filter(has_text="Mất kết nối máy chủ")).to_be_visible()
            expect(login).to_have_count(0)
            state["mode"] = "ok"
            page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
            expect(page.get_by_role("status").filter(has_text="Mất kết nối máy chủ")).to_have_count(0)
        state["mode"] = final_error
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        if final_error == "SESSION_REVOKED":
            expect(login).to_be_visible()
            expect(page.locator(".auth-feedback")).to_contain_text("Phiên đăng nhập đã bị thu hồi")
        else:
            title = {"ACCOUNT_BANNED": "Tài khoản của bạn đang bị khóa", "ACCOUNT_PENDING": "Tài khoản đang chờ duyệt", "ACCOUNT_REJECTED": "Tài khoản của bạn đã bị từ chối"}[final_error]
            expect(page.get_by_text(title, exact=True)).to_be_visible()
        page.reload(wait_until="networkidle")
        if final_error == "SESSION_REVOKED":
            expect(login).to_be_visible()
        else:
            expect(page.get_by_text(title, exact=True)).to_be_visible()
        context.close()
    browser.close()
print("PASS: network/500 recovery preserves workspace; session/status routing is distinct")
