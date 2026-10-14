"""Browser contracts. Runner owns both local servers; screenshots on failure."""
import os
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
