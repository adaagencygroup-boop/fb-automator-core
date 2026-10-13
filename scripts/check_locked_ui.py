"""Locked screen regression coverage with mocked APIs, no production data."""
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
        state = {"status": "banned", "fail": False, "mismatch": False, "login_error": "ACCOUNT_BANNED"}
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
            elif request.url.endswith("/auth/login"):
                status, data = 403, {"detail": state["login_error"]}
            elif request.url.endswith("/auth/registration-status"):
                if state["fail"]:
                    status, data = 503, {"detail": "Không thể kết nối tới máy chủ xác thực."}
                else:
                    data = {"username": "member", "status": state["status"]}
                    if state["mismatch"]:
                        data["hwid_mismatch"] = True
            else:
                status, data = 401, {"detail": "TOKEN_INVALID"}
            route.fulfill(status=status, headers=headers, content_type="application/json", body=json.dumps(data))

        page.route("**/api/**", api)
        page.goto(BASE_URL, wait_until="networkidle")
        page.get_by_role("textbox", name="Tên đăng nhập").fill("member")
        page.get_by_label("Mật khẩu", exact=True).fill("secret123")
        page.get_by_role("button", name="Đăng nhập", exact=True).click()
        title = page.get_by_role("heading", name="Tài khoản của bạn đang bị khóa")
        expect(title).to_be_visible()
        expect(page.get_by_role("heading", name="Hỗ trợ Zalo CSKH")).to_be_visible()
        expect(page.get_by_role("heading", name="Kỹ thuật viên Telegram")).to_be_visible()
        expect(page.get_by_text("Hệ thống phát hiện tài khoản đã bị khóa bởi quản trị viên")).to_be_visible()
        assert page.locator("header").count() == 0
        expect(page.get_by_role("link", name="Mở Zalo Chat")).to_have_attribute("href", "https://zalo.me/0988888247")
        expect(page.get_by_role("link", name="Nhắn Telegram")).to_have_attribute("href", "https://t.me/admin_support")
        page.add_style_tag(content="nextjs-portal { display: none !important; }")
        page.screenshot(path="logs/locked-desktop.png", full_page=True)
        page.get_by_role("button", name="Sao chép số", exact=True).click()
        expect(page.get_by_role("status")).to_contain_text("Đã sao chép số Zalo Hotline")
        assert page.evaluate("navigator.clipboard.readText()") == "0988888247"
        page.get_by_role("button", name="Sao chép Tag", exact=True).click()
        expect(page.get_by_role("status")).to_contain_text("Đã sao chép Telegram Tag")
        assert page.evaluate("navigator.clipboard.readText()") == "@admin_support"
        refresh = page.get_by_role("button", name="Làm mới trạng thái")
        refresh.click()
        expect(page.get_by_role("alert").filter(has_text="vẫn đang bị khóa")).to_be_visible()
        state["fail"] = True
        refresh.click()
        expect(page.get_by_role("alert").filter(has_text="Không thể kết nối")).to_be_visible()
        state["fail"] = False
        page.reload(wait_until="networkidle")
        expect(title).to_be_visible()
        page.add_style_tag(content="nextjs-portal { display: none !important; }")
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        expect(refresh).to_be_visible()
        page.screenshot(path="logs/locked-mobile.png", full_page=True)
        state["status"] = "pending"
        refresh.click()
        expect(page.get_by_role("heading", name="Tài khoản đang chờ duyệt")).to_be_visible()
        state["status"] = "banned"
        page.get_by_role("button", name="Quay lại đăng nhập").click()
        page.get_by_role("textbox", name="Tên đăng nhập").fill("member")
        page.get_by_label("Mật khẩu", exact=True).fill("secret123")
        page.get_by_role("button", name="Đăng nhập", exact=True).click()
        expect(title).to_be_visible()
        state["status"] = "approved"
        refresh.click()
        expect(page.get_by_role("status")).to_contain_text("ĐÃ MỞ KHÓA")
        expect(page.get_by_role("heading", name="Đăng nhập", exact=True)).to_be_visible()
        state.update({"mismatch": True, "login_error": "ERR_HWID_MISMATCH"})
        page.get_by_role("textbox", name="Tên đăng nhập").fill("member")
        page.get_by_label("Mật khẩu", exact=True).fill("secret123")
        page.get_by_role("button", name="Đăng nhập", exact=True).click()
        expect(title).to_be_visible()
        refresh.click()
        expect(page.get_by_role("alert").filter(has_text="Mã máy vẫn chưa khớp")).to_be_visible()
        expect(title).to_be_visible()
        state["mismatch"] = False
        expect(page.get_by_role("heading", name="Đăng nhập", exact=True)).to_be_visible(timeout=9000)
        assert not errors, errors
        context.close()
        browser.close()
        print("PASS: locked/HWID screens, old layout/footer, support links/copy, desktop/mobile, reload, refresh/error, pending and unlock transitions", flush=True)


if __name__ == "__main__":
    Path("logs").mkdir(exist_ok=True)
    main()
