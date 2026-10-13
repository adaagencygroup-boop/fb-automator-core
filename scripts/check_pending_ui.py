"""Pending screen UI and account decision flow, all API requests intercepted."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3020"


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
        page = context.new_page()
        state = {"status": "pending", "fail": False, "checks": 0}
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def api(route):
            request = route.request
            headers = {"Access-Control-Allow-Origin": BASE_URL, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS"}
            if request.method == "OPTIONS":
                route.fulfill(status=204, headers=headers)
                return
            status, data = 200, {}
            if request.url.endswith("/auth/hwid"):
                data = {"hwid": "TEST-DEVICE"}
            elif request.url.endswith("/auth/register"):
                status, data = 201, {"user_id": 42, "status": "pending"}
            elif request.url.endswith("/auth/registration-status"):
                state["checks"] += 1
                if state["fail"]:
                    status, data = 503, {"detail": "Không thể kết nối tới máy chủ xác thực."}
                else:
                    data = {"username": "newmember", "status": state["status"]}
            else:
                status, data = 401, {"detail": "TOKEN_INVALID"}
            route.fulfill(status=status, headers=headers, content_type="application/json", body=json.dumps(data))

        page.route("**/api/**", api)
        page.goto(BASE_URL, wait_until="networkidle")
        page.get_by_role("button", name="Đăng ký ngay", exact=True).click()
        page.locator("#register-username").fill("newmember")
        page.locator("#register-password").fill("Secure1!")
        page.locator("#register-confirmPassword").fill("Secure1!")
        page.locator("#register-contactInfo").fill("0987654321")
        page.get_by_role("checkbox").check()
        page.get_by_role("button", name="Tạo tài khoản", exact=True).click()
        expect(page.get_by_role("heading", name="Tài khoản đang chờ duyệt")).to_be_visible()
        expect(page.get_by_role("heading", name="Hỗ trợ Zalo CSKH")).to_be_visible()
        expect(page.get_by_role("heading", name="Kỹ thuật viên Telegram")).to_be_visible()
        expect(page.get_by_role("link", name="Mở Zalo Chat")).to_have_attribute("href", "https://zalo.me/0988888247")
        expect(page.get_by_role("link", name="Nhắn Telegram")).to_have_attribute("href", "https://t.me/admin_support")
        page.add_style_tag(content="nextjs-portal { display: none !important; }")
        page.screenshot(path="logs/pending-desktop.png", full_page=True)
        page.get_by_role("button", name="Sao chép số", exact=True).click()
        expect(page.get_by_role("status")).to_contain_text("Đã sao chép số Zalo Hotline")
        assert page.evaluate("navigator.clipboard.readText()") == "0988888247"
        page.get_by_role("button", name="Sao chép Tag", exact=True).click()
        expect(page.get_by_role("status")).to_contain_text("Đã sao chép Telegram Tag")
        assert page.evaluate("navigator.clipboard.readText()") == "@admin_support"
        refresh = page.get_by_role("button", name="Làm mới trạng thái")
        refresh.click()
        expect(page.get_by_role("alert").filter(has_text="Tài khoản vẫn đang")).to_be_visible()
        state["fail"] = True
        refresh.click()
        expect(page.get_by_role("alert").filter(has_text="Không thể kết nối")).to_be_visible()
        state["fail"] = False
        page.reload(wait_until="networkidle")
        expect(page.get_by_role("heading", name="Tài khoản đang chờ duyệt")).to_be_visible()
        page.add_style_tag(content="nextjs-portal { display: none !important; }")
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        expect(refresh).to_be_visible()
        page.screenshot(path="logs/pending-mobile.png", full_page=True)
        state["status"] = "approved"
        refresh.click()
        expect(page.get_by_role("status")).to_contain_text("ĐÃ ĐƯỢC DUYỆT")
        expect(page.get_by_role("heading", name="Đăng nhập", exact=True)).to_be_visible()
        assert page.evaluate("localStorage.getItem('pending_username')") is None
        page.set_viewport_size({"width": 1440, "height": 900})
        for decision, title in (("rejected", "Tài khoản của bạn đã bị từ chối"), ("banned", "Tài khoản của bạn đang bị khóa")):
            state["status"] = "pending"
            page.evaluate("localStorage.setItem('pending_username', 'newmember')")
            page.reload(wait_until="networkidle")
            expect(page.get_by_role("heading", name="Tài khoản đang chờ duyệt")).to_be_visible()
            state["status"] = decision
            # Automatic checking should detect the decision without clicking refresh.
            expect(page.get_by_role("heading", name=title)).to_be_visible(timeout=9000)
        assert state["checks"] >= 6
        assert not errors, errors
        context.close()
        browser.close()
        print("PASS: pending after signup, support links/copy, desktop/mobile, refresh/error, reload restoration, approval/rejection/ban transitions", flush=True)


if __name__ == "__main__":
    Path("logs").mkdir(exist_ok=True)
    main()
