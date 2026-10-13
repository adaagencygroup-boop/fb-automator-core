"""Browser smoke test for login against mocked API responses, without production data."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3020"

def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        state = {"error": None, "authenticated": False, "requests": []}
        errors = []
        page = context.new_page()
        page.route_web_socket("**/ws/logs", lambda websocket: None)
        page.on("pageerror", lambda error: errors.append(str(error)))

        def api(route):
            request = route.request
            headers = {
                "Access-Control-Allow-Origin": BASE_URL,
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Allow-Headers": "content-type",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            }
            status, data = 200, {}
            if request.method == "OPTIONS":
                route.fulfill(status=204, headers=headers)
                return
            if request.url.endswith("/auth/hwid"):
                data = {"hwid": "TEST-DEVICE-0123456789"}
            elif request.url.endswith("/auth/login"):
                state["requests"].append({"url": request.url, "body": request.post_data_json})
                if state["error"]:
                    status, data = 403 if state["error"].startswith(("ACCOUNT_PENDING", "ACCOUNT_REJECTED", "ACCOUNT_BANNED", "ERR_HWID")) else 401, {"detail": state["error"]}
                else:
                    state["authenticated"] = True
                    data = {"username": "member", "status": "expired", "days_remaining": 0}
            elif request.url.endswith("/auth/me"):
                if state["authenticated"]:
                    data = {"username": "member", "role": "user", "status": "expired", "modules_unlocked": False}
                else:
                    status, data = 401, {"detail": "TOKEN_INVALID"}
            elif request.url.endswith("/auth/refresh"):
                status, data = 401, {"detail": "TOKEN_INVALID"}
            route.fulfill(status=status, headers=headers, content_type="application/json", body=json.dumps(data))

        page.route("**/api/**", api)
        page.goto(BASE_URL, wait_until="networkidle")
        submit = page.get_by_role("button", name="Đăng nhập", exact=True)
        expect(submit).to_be_visible()
        expect(page.get_by_text("TEST-DEVICE-0123456789")).to_be_visible()
        page.add_style_tag(content="nextjs-portal { display: none !important; }")
        page.screenshot(path="logs/login-desktop.png", full_page=True)
        submit.click()
        expect(page.get_by_text("Vui lòng nhập tên đăng nhập.")).to_be_visible()
        expect(page.get_by_text("Vui lòng nhập mật khẩu.")).to_be_visible()
        assert not state["requests"], "Blank fields must not send login request"
        username = page.get_by_role("textbox", name="Tên đăng nhập")
        password = page.get_by_label("Mật khẩu", exact=True)
        username.fill("member")
        password.fill("secret123")
        page.get_by_role("button", name="Hiện mật khẩu").click()
        expect(password).to_have_attribute("type", "text")
        page.get_by_role("button", name="Ẩn mật khẩu").click()
        page.get_by_role("button", name="Quên mật khẩu?").click()
        expect(page.get_by_role("dialog")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog")).not_to_be_visible()
        for error, message in [
            ("ACCOUNT_NOT_FOUND", "Tài khoản không tồn tại trên hệ thống."),
            ("INVALID_PASSWORD", "Mật khẩu không chính xác."),
        ]:
            state["error"] = error
            submit.click()
            expect(page.get_by_role("alert").filter(has_text=message)).to_be_visible()
            page.screenshot(path="logs/login-error.png", full_page=True)
        for error, title in [
            ("ACCOUNT_PENDING", "Tài khoản đang chờ duyệt"),
            ("ACCOUNT_REJECTED", "Tài khoản của bạn đã bị từ chối"),
            ("ACCOUNT_BANNED", "Tài khoản của bạn đang bị khóa"),
            ("ERR_HWID_MISMATCH", "Tài khoản của bạn đang bị khóa"),
        ]:
            state["error"] = error
            submit.click()
            if error == "ERR_HWID_MISMATCH":
                expect(page.locator(".auth-feedback")).to_contain_text("LỖI XÁC THỰC PHẦN CỨNG HWID")
                page.screenshot(path="logs/login-hwid.png", full_page=True)
            expect(page.get_by_role("heading", name=title)).to_be_visible()
            page.get_by_role("button", name="Quay lại đăng nhập").click()
            page.get_by_role("textbox", name="Tên đăng nhập").fill("member")
            page.get_by_label("Mật khẩu", exact=True).fill("secret123")
        page.set_viewport_size({"width": 390, "height": 844})
        expect(submit).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile layout overflows horizontally"
        page.screenshot(path="logs/login-mobile.png", full_page=True)
        page.get_by_role("checkbox", name="Ghi nhớ đăng nhập").check()
        state["error"] = None
        submit.click()
        expect(page.locator(".auth-feedback")).to_contain_text("BẢN QUYỀN HẾT HẠN")
        page.screenshot(path="logs/login-license.png", full_page=True)
        page.set_viewport_size({"width": 1440, "height": 900})
        expect(page.get_by_role("heading", name="Chưa mở được các module")).to_be_visible()
        assert state["requests"][-1]["body"]["remember_me"] is True
        assert page.evaluate("localStorage.getItem('remembered_username')") == "member"
        assert all("password=" not in item["url"] for item in state["requests"])
        assert not errors, errors
        print("PASS: validation, password toggle, support popup, account errors, status screens, mobile layout, remembered login and expired license", flush=True)
        context.close()
        browser.close()


if __name__ == "__main__":
    Path("logs").mkdir(exist_ok=True)
    main()
