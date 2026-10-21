"""Registration browser regression checks using mocked auth API, no real database."""
import json
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3020"

def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
        page = context.new_page()
        state = {"error": None, "hwid": "TEST-REGISTER-DEVICE", "requests": []}
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
                data = {"hwid": state["hwid"]}
            elif request.url.endswith("/auth/register"):
                state["requests"].append(request.post_data_json)
                if state["error"]:
                    status, data = 409, {"detail": state["error"]}
                else:
                    status, data = 201, {"user_id": 42, "status": "pending", "message": "Registration successful"}
            else:
                status, data = 401, {"detail": "TOKEN_INVALID"}
            route.fulfill(status=status, headers=headers, content_type="application/json", body=json.dumps(data))

        page.route("**/api/**", api)
        page.goto(BASE_URL, wait_until="networkidle")
        page.get_by_role("button", name="Đăng ký ngay", exact=True).click()
        expect(page.get_by_role("heading", name="Đăng ký tài khoản mới")).to_be_visible()
        expect(page.get_by_text("TEST-REGISTER-DEVICE")).to_be_visible()
        # Hide development-only controls in exported screenshots.
        page.add_style_tag(content="nextjs-portal { display: none !important; }")
        page.screenshot(path="logs/register-desktop.png", full_page=True)
        submit = page.get_by_role("button", name="Tạo tài khoản", exact=True)
        submit.click()
        expect(page.get_by_text("Vui lòng nhập tên đăng nhập.")).to_be_visible()
        expect(page.get_by_text("Vui lòng xác nhận lại mật khẩu.")).to_be_visible()
        expect(page.get_by_text("Bạn cần đồng ý với Điều khoản dịch vụ và bảo mật HWID.")).to_be_visible()
        assert not state["requests"]
        username = page.get_by_label("Tên đăng nhập", exact=False)
        password = page.locator("#register-password")
        confirm = page.locator("#register-confirmPassword")
        phone = page.locator("#register-contactInfo")
        username.fill("123")
        expect(page.get_by_text("Tên đăng nhập phải bắt đầu bằng chữ cái.")).to_be_visible()
        username.fill("new member")
        expect(username).to_have_value("newmember")
        password.fill("secret123")
        expect(page.get_by_text("Mật khẩu phải từ 8 đến 12 ký tự", exact=False)).to_be_visible()
        password.fill("Secure1!")
        confirm.fill("Different1!")
        expect(page.get_by_text("Mật khẩu xác nhận không trùng khớp.")).to_be_visible()
        confirm.fill("Secure1!")
        password.fill("Changed1!")
        expect(page.get_by_text("Mật khẩu xác nhận không trùng khớp.")).to_be_visible()
        password.fill("Secure1!")
        expect(page.get_by_text("Mật khẩu xác nhận không trùng khớp.")).not_to_be_visible()
        page.get_by_role("button", name="Hiện mật khẩu", exact=True).click()
        expect(password).to_have_attribute("type", "text")
        page.get_by_role("button", name="Ẩn mật khẩu", exact=True).click()
        page.get_by_role("button", name="Hiện mật khẩu xác nhận", exact=True).click()
        expect(confirm).to_have_attribute("type", "text")
        page.get_by_role("button", name="Ẩn mật khẩu xác nhận", exact=True).click()
        phone.fill("1987654321")
        expect(page.get_by_text("Số điện thoại phải bắt đầu bằng số 0.")).to_be_visible()
        phone.fill("0987")
        expect(page.get_by_text("Số điện thoại phải có đủ 10 chữ số.")).to_be_visible()
        phone.fill("0987654321")
        submit.click()
        assert not state["requests"], "Terms must be accepted before submitting"
        page.get_by_role("checkbox").check()
        state["error"] = "Tên đăng nhập đã tồn tại trên hệ thống"
        submit.click()
        expect(page.get_by_role("alert").filter(has_text=state["error"])).to_be_visible()
        expect(page.get_by_text("Tên đăng nhập đã tồn tại. Vui lòng chọn tên khác.")).to_be_visible()
        username.fill("othermember")
        expect(page.get_by_role("alert").filter(has_text=state["error"])).not_to_be_visible()
        page.get_by_role("button", name="Sao chép", exact=True).click()
        expect(page.get_by_text("Đã chép", exact=True)).to_be_visible()
        assert page.evaluate("navigator.clipboard.readText()") == state["hwid"]
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.screenshot(path="logs/register-mobile.png", full_page=True)
        state["error"] = None
        submit.click()
        expect(page.get_by_role("status")).to_contain_text("ĐĂNG KÝ THÀNH CÔNG")
        expect(page.get_by_role("heading", name="Tài khoản đang chờ duyệt")).to_be_visible()
        assert page.evaluate("localStorage.getItem('pending_username')") == "othermember"
        assert len(state["requests"]) == 2
        assert state["requests"][-1] == {"username": "othermember", "password": "Secure1!", "contact_info": "0987654321", "hwid": "TEST-REGISTER-DEVICE"}
        page.get_by_role("button", name="Quay lại đăng nhập").click()
        expect(page.get_by_role("heading", name="Đăng nhập", exact=True)).to_be_visible()
        assert not errors, errors
        context.close()
        browser.close()
        print("PASS: registration fields, live validation, confirmation, terms, duplicate username, HWID copy, desktop/mobile, pending status and return to login", flush=True)


if __name__ == "__main__":
    Path("logs").mkdir(exist_ok=True)
    main()
