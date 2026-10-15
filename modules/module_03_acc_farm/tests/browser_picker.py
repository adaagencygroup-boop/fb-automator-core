"""Farm picker browser checks. Requires a running FE; every API call is mocked."""
import json
import os
from pathlib import Path
import unittest
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright


class FarmPickerBrowserTests(unittest.TestCase):
    def setUp(self):
        self.playwright = sync_playwright().start()
        self.addCleanup(self.playwright.stop)
        chrome = Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe"
        options = {"headless": True}
        if chrome.is_file():
            options["executable_path"] = str(chrome)
        self.browser = self.playwright.chromium.launch(**options)
        self.addCleanup(self.browser.close)
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1050}, service_workers="block")
        # Tests never connect to the engine's log socket or use a user's session.
        self.context.route_web_socket("**:28129/**", lambda socket: None)
        self.context.route("**/api/**", self.api)
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: print("Browser error:", str(error), flush=True))
        self.page.on("console", lambda message: print("Browser console:", message.text, flush=True) if message.type == "error" else None)
        self.page.set_default_timeout(10000)
        self.calls = []
        self.next_error = False
        self.pending_search = []
        self.started = []
        self.running = False
        self.rows = [dict(id=index + 100, uid=str(80000 + index), profile_name=f"Fixture {index}", status="live", login_status="logged_in", proxy="") for index in range(25)]
        self.rows += [
            dict(id=10, uid="70001", profile_name="Live only", status="live", login_status="failed", proxy=""),
            dict(id=9, uid="70002", profile_name="Logged in only", status=None, login_status="logged_in", proxy=""),
            dict(id=8, uid="70003", profile_name="Inactive", status="die", login_status="failed", proxy=""),
        ]
        self.page.goto(os.environ.get("FARM_UI_URL", "http://127.0.0.1:3000") + "/interact/engage/")
        self.table = self.page.get_by_role("table", name="Danh sách tài khoản thực thi")
        expect(self.table).to_be_visible(timeout=20000)
        expect(self.table.locator("tbody tr[data-account-uid]")).to_have_count(10)

    def fulfill(self, route, value, status=200):
        route.fulfill(status=status, content_type="application/json", body=json.dumps(value), headers={
            "Access-Control-Allow-Origin": os.environ.get("FARM_UI_URL", "http://127.0.0.1:3000"),
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Headers": "Content-Type, X-Auth-Client, X-Auth-User-Id, Authorization",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        })

    def api(self, route):
        request = route.request
        url = urlsplit(request.url)
        if request.method == "OPTIONS":
            return self.fulfill(route, {}, 204)
        if url.path == "/api/v1/auth/me":
            return self.fulfill(route, {"id": "fixture", "username": "Fixture user", "status": "active", "role": "MEMBER", "modules_unlocked": True})
        if url.path == "/api/accounts/page":
            params = parse_qs(url.query)
            self.calls.append(params)
            self.assertEqual(params.get("limit"), ["10"])
            self.assertEqual(params.get("active_only"), ["true"])
            search = params.get("search", [""])[0]
            if search == "slow":
                self.pending_search.append(route)
                return
            if "cursor" in params and self.next_error:
                self.next_error = False
                return self.fulfill(route, {"detail": "Fixture load more failed"}, 503)
            rows = [row for row in self.rows if row["status"] == "live" or row["login_status"] == "logged_in"]
            if search:
                rows = [row for row in rows if search in row["uid"] or search.lower() in row["profile_name"].lower()]
            rows.sort(key=lambda row: row["id"], reverse=True)
            total = len(rows)
            if "cursor" in params:
                rows = [row for row in rows if row["id"] < int(params["cursor"][0])]
            more = len(rows) > 10
            rows = rows[:10]
            return self.fulfill(route, {"accounts": rows, "total": total, "has_more": more, "next_cursor": rows[-1]["id"] if more else None})
        if url.path == "/api/farm/start":
            self.started = request.post_data_json["uids"]
            self.running = True
            return self.fulfill(route, {"accepted": self.started, "rejected": [], "threads": 5})
        if url.path == "/api/farm/status":
            return self.fulfill(route, {"running": self.running, "accounts": [dict(uid=uid, name="Fixture", status="RUNNING", actions={}) for uid in self.started]})
        if url.path == "/api/health":
            return self.fulfill(route, {"status": "online"})
        if url.path == "/api/farm/settings":
            return self.fulfill(route, {})
        # An unexpected endpoint cannot reach the real backend.
        return self.fulfill(route, {"detail": "Unexpected test API: " + url.path}, 404)

    def checked_rows(self):
        return self.table.locator("tbody [role=checkbox][aria-checked=true]")

    def scroll_bottom(self):
        self.table.evaluate("table => { const root=table.parentElement; root.scrollTop=root.scrollHeight; }")

    def test_select_all_only_selects_loaded_rows_and_retry_preserves_selection(self):
        expect(self.table.locator("select, [role=combobox]")).to_have_count(0)
        self.assertEqual(len(self.calls), 1)
        header = self.table.get_by_role("checkbox", name="Chọn tất cả tài khoản đã tải đủ điều kiện")
        header.click()
        expect(self.checked_rows()).to_have_count(10)
        self.next_error = True
        self.scroll_bottom()
        expect(self.table.get_by_role("alert")).to_have_text("Fixture load more failed")
        expect(self.checked_rows()).to_have_count(10)
        self.table.get_by_role("button", name="Thử lại").click()
        expect(self.table.locator("tbody tr[data-account-uid]")).to_have_count(20)
        expect(self.checked_rows()).to_have_count(10)
        expect(header).to_have_attribute("aria-checked", "false")
        header.click()
        expect(self.checked_rows()).to_have_count(20)
        self.scroll_bottom()
        expect(self.table.get_by_text("Logged in only", exact=True)).to_be_visible()
        expect(self.checked_rows()).to_have_count(20)
        expect(self.table.get_by_text("Live only", exact=True)).to_be_visible()
        expect(self.table.get_by_text("Inactive", exact=True)).to_have_count(0)
        expect(self.table.get_by_role("checkbox", name="Chọn tài khoản 70001", exact=True)).to_be_disabled()
        expect(self.table.get_by_role("checkbox", name="Chọn tài khoản 70002", exact=True)).to_be_disabled()
        self.table.evaluate("table => { table.parentElement.scrollTop=0; }")
        header.click()
        expect(self.checked_rows()).to_have_count(25)

    def drag(self, start, end, control=False):
        rows = self.table.locator("tbody tr[data-account-uid]")
        first, last = rows.nth(start).locator("td").nth(3), rows.nth(end).locator("td").nth(3)
        a, b = first.bounding_box(), last.bounding_box()
        if control:
            self.page.keyboard.down("Control")
        self.page.mouse.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 2)
        self.page.mouse.down()
        self.page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=12)
        self.page.mouse.up()
        if control:
            self.page.keyboard.up("Control")

    def test_drag_search_and_running_session_keep_exact_selected_uids(self):
        self.drag(0, 2)
        expect(self.checked_rows()).to_have_count(3)
        self.drag(3, 4, control=True)
        expect(self.checked_rows()).to_have_count(5)
        self.table.get_by_role("button", name="80024", exact=True).click()
        expect(self.checked_rows()).to_have_count(5)
        search = self.page.get_by_role("textbox", name="Tìm tài khoản thực thi")
        search.fill("80000")
        expect(self.table.locator("tbody tr[data-account-uid]")).to_have_count(1)
        expect(self.checked_rows()).to_have_count(0)
        self.table.get_by_role("checkbox", name="Chọn tất cả tài khoản đã tải đủ điều kiện").click()
        expect(self.checked_rows()).to_have_count(1)
        self.page.get_by_role("button", name="Kích hoạt", exact=True).click()
        expect(self.page.get_by_role("button", name="Tạm dừng", exact=True)).to_be_visible()
        self.assertEqual(set(self.started), {"80024", "80023", "80022", "80021", "80020", "80000"})
        expect(self.table.locator("tbody tr")).to_have_count(6)
        expect(self.table.get_by_role("checkbox")).to_have_count(0)

    def test_late_search_result_does_not_replace_current_results(self):
        search = self.page.get_by_role("textbox", name="Tìm tài khoản thực thi")
        search.fill("slow")
        self.page.wait_for_timeout(450)
        self.assertEqual(len(self.pending_search), 1)
        search.fill("80000")
        expect(self.table.locator("tbody tr[data-account-uid]")).to_have_count(1)
        self.fulfill(self.pending_search.pop(), {"accounts": self.rows[:10], "total": 25, "has_more": True, "next_cursor": 109})
        self.page.wait_for_timeout(100)
        expect(self.table.locator("tbody tr[data-account-uid]")).to_have_count(1)
        expect(self.table.get_by_role("button", name="80000", exact=True)).to_be_visible()


if __name__ == "__main__":
    unittest.main(verbosity=2)
