"""Browser contracts. Runner owns both local servers; screenshots on failure."""
import os
import re
import time
import unittest
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect


class AccountsBrowserTests(unittest.TestCase):
    def setUp(self):
        self.p = sync_playwright().start()
        self.addCleanup(self.p.stop)
        self.browser = self.p.chromium.launch()
        self.addCleanup(self.browser.close)
        self.page = self.browser.new_page()
        self.requests = []
        self.page.on("request", lambda r: self.requests.append(r.url) if "/api/accounts/page" in r.url else None)
        self.page.goto(os.getenv("MODULE2_UI_URL", "http://127.0.0.1:3012") + "/accounts")
        self.search = self.page.get_by_placeholder("Tìm kiếm theo UID, Tên tài khoản...")
        expect(self.search).to_be_visible(timeout=60000)
        expect(self.page.locator("tbody tr").first).to_be_visible()

    def tearDown(self):
        # Keep evidence for every browser case, including assertion failures.
        root = Path(os.getenv("MODULE2_RESULTS", "test-results/module2"))
        root.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(root / (self._testMethodName + ".png")), full_page=True)

    def test_e01_debounce_and_real_search(self):
        self.page.wait_for_timeout(500)
        self.requests.clear()
        self.search.fill("mail1")
        self.page.wait_for_timeout(100)
        self.search.fill("mail2")
        self.page.wait_for_timeout(100)
        self.assertEqual(self.requests, [])
        self.page.wait_for_timeout(600)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(parse_qs(urlparse(self.requests[0]).query)["search"], ["mail2"])
        expect(self.page.locator("tbody")).to_contain_text("1029")

    def test_e02_initial_error_retry(self):
        failed = []
        def fail_once(route):
            if not failed:
                failed.append(True)
                route.fulfill(status=503, content_type="application/json", body='{"detail":"fixture list unavailable"}')
            else:
                route.continue_()
        self.page.route("**/api/accounts/page*", fail_once)
        self.search.fill("1000")
        expect(self.page.get_by_text("fixture list unavailable", exact=False)).to_be_visible()
        self.page.get_by_role("button", name="Thử lại", exact=True).click()
        expect(self.page.locator("tbody")).to_contain_text("1000")

    def test_e03_owner_and_literal_search(self):
        expect(self.page.locator("tbody")).not_to_contain_text("bob Name")
        self.search.fill("%")
        self.page.wait_for_timeout(600)
        expect(self.page.locator("tbody")).not_to_contain_text("alice Name")

    def test_e10_realtime_browser_and_bulk_login_without_blocking_table(self):
        # Intercept every automation request; never launch a real account's Chrome.
        changed, login_requests = {}, []

        def page_response(route):
            response = route.fetch()
            data = response.json()
            data["accounts"] = [{**row, **changed.get(row["uid"], {})} for row in data["accounts"]]
            route.fulfill(response=response, json=data)

        def login_response(route):
            login_requests.append(route.request.post_data_json)
            route.fulfill(json={"started": True, "count": len(login_requests[-1]["uids"]), "operation_id": "mock-bulk"})

        self.page.route("**/api/accounts/page*", page_response)
        self.page.route("**/api/accounts/login", login_response)
        self.page.route("**/api/accounts/open-browser", lambda route: route.fulfill(json={"started": True, "operation_id": "mock-browser"}))
        self.page.route("**/api/accounts/operations/*", lambda route: route.fulfill(json={
            "operation_id": route.request.url.rsplit("/", 1)[-1], "sequence": 0,
            "started_at": time.time(), "done": False, "kind": "login", "accounts": {},
        }))

        row = self.page.locator("tbody tr[data-account-uid]").first
        uid = row.get_attribute("data-account-uid")
        row.get_by_title("Mở trình duyệt Profile Chrome", exact=True).click()
        changed[uid] = {"login_status": "logged_in", "status": "live"}
        started = time.time()
        detail = {"event": "account_operation_updated", "operation_id": "mock-browser", "kind": "browser",
                  "sequence": 1, "started_at": started, "done": False,
                  "account": {"uid": uid, "phase": "authenticated", "changes": changed[uid]}}
        self.page.evaluate("detail => window.dispatchEvent(new CustomEvent('local_engine_event', {detail}))", detail)
        expect(row.get_by_text("Đã đăng nhập", exact=True)).to_be_visible(timeout=1000)
        chrome_button = row.locator("button[aria-busy]")
        expect(chrome_button).to_have_attribute("aria-busy", "true")
        expect(chrome_button).to_be_disabled()
        expect(chrome_button.locator("svg.animate-spin")).to_be_visible()
        expect(row.get_by_text("Đã đăng nhập · đang cập nhật hồ sơ", exact=True)).to_have_count(0)
        expect(self.search).to_be_enabled()
        detail.update(sequence=2, done=True)
        detail["account"]["phase"] = "completed"
        self.page.evaluate("detail => window.dispatchEvent(new CustomEvent('local_engine_event', {detail}))", detail)
        expect(chrome_button).to_have_attribute("aria-busy", "false")
        expect(chrome_button).to_be_enabled()
        expect(chrome_button.locator("svg.animate-spin")).to_have_count(0)
        expect(row.get_by_text("Đã hoàn tất", exact=True)).to_have_count(0)

        for target in self.page.locator("tbody tr[data-account-uid]").all()[:2]:
            target.get_by_role("checkbox").check()
        with self.page.expect_response(lambda response: response.url.split("?")[0].endswith("/api/accounts/login") and response.request.method == "POST"):
            self.page.get_by_role("button", name=re.compile(r"^Đăng nhập \(2\)$")).click()
        expect(self.page.get_by_role("button", name=re.compile(r"^Đang đăng nhập"))).to_be_disabled()
        self.requests.clear()
        uids = login_requests[0]["uids"]
        for target_uid in uids:
            target = self.page.locator(f'tr[data-account-uid="{target_uid}"]')
            expect(target.locator("button[aria-busy]")).to_have_attribute("aria-busy", "true")
            expect(target.locator("button[aria-busy]")).to_be_disabled()
            expect(target.get_by_text("Đang chờ", exact=True)).to_have_count(0)
        started = time.time()
        for target_uid in uids:
            changed[target_uid] = {"login_status": "logged_in", "status": "live"}
        # One account finishing must not stop the other account's spinner.
        self.page.evaluate("detail => window.dispatchEvent(new CustomEvent('local_engine_event', {detail}))", {
            "event": "account_operation_updated", "operation_id": "mock-bulk", "kind": "login",
            "sequence": 1, "started_at": started, "done": False,
            "account": {"uid": uids[0], "phase": "completed", "changes": changed[uids[0]]},
        })
        expect(self.page.locator(f'tr[data-account-uid="{uids[0]}"] button[aria-busy]')).to_have_attribute("aria-busy", "false")
        expect(self.page.locator(f'tr[data-account-uid="{uids[1]}"] button[aria-busy]')).to_have_attribute("aria-busy", "true")
        # A burst must patch rows and coalesce GETs rather than refresh per result.
        details = [{"event": "account_operation_updated", "operation_id": "mock-bulk", "kind": "login",
                    "sequence": sequence, "started_at": started, "done": sequence == 101,
                    "accounts": {target_uid: {"uid": target_uid, "phase": "completed", "changes": changed[target_uid]} for target_uid in uids}}
                   for sequence in range(2, 102)]
        self.page.evaluate("events => events.forEach(detail => window.dispatchEvent(new CustomEvent('local_engine_event', {detail})))", details)
        expect(self.page.get_by_role("button", name=re.compile(r"^Đăng nhập \(2\)$"))).to_be_enabled()
        expect(self.page.get_by_text("Đang làm mới dữ liệu...", exact=True)).to_have_count(0)
        expect(self.page.get_by_text("Đang đồng bộ…", exact=True)).to_have_count(0)
        for target_uid in uids:
            target = self.page.locator(f'tr[data-account-uid="{target_uid}"]')
            expect(target.get_by_role("checkbox")).to_be_checked()
            expect(target.get_by_text("Đã đăng nhập", exact=True)).to_be_visible(timeout=1000)
            expect(target.locator("button[aria-busy]")).to_have_attribute("aria-busy", "false")
            expect(target.locator("button[aria-busy]")).to_be_enabled()
            expect(target.get_by_text("Đã hoàn tất", exact=True)).to_have_count(0)
        self.page.wait_for_timeout(2300)
        self.assertLessEqual(len(self.requests), 2, "Burst must not reload per account/event")


if __name__ == "__main__":
    unittest.main(verbosity=2)
