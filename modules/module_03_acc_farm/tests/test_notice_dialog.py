import unittest
from unittest.mock import Mock, patch

from modules.module_03_acc_farm.farming import flow as farming_flow
from modules.module_03_acc_farm.farming.locators import FARM_COMMON

RESTRICTION_TEXT = (
    "What happened\n8 Oct 2026\nWe added a restriction to your account\n"
    "You can't create multiple sessions\nEnds on 9 Oct 2026\nSee why"
)


class FakeNoticeDriver:
    """Driver giả: popup thông báo biến mất sau khi bấm nút X."""

    def __init__(self, open_dialogs=1, has_close=True, blocked=False):
        self.open_dialogs = open_dialogs
        self.has_close = has_close
        self.blocked = blocked
        self.current_url = "https://www.facebook.com/"
        self.close_button = Mock(name="close")

    def find_visible(self, driver, locators, root=None):
        if locators is FARM_COMMON["blocked_dialog"]:
            return [Mock()] if self.blocked else []
        if locators is FARM_COMMON["notice_dialog"]:
            return [Mock(text=RESTRICTION_TEXT)] if self.open_dialogs > 0 else []
        if locators is FARM_COMMON["notice_close"]:
            return [self.close_button] if self.has_close else []
        return []

    def click(self, driver, element):
        self.open_dialogs -= 1
        return True


class NoticeDialogTests(unittest.TestCase):
    def setUp(self):
        farming_flow.pop_notices()

    def run_dismiss(self, fake, **kwargs):
        with patch.object(farming_flow, "_find_visible", side_effect=fake.find_visible), \
                patch.object(farming_flow, "_human_click", side_effect=fake.click) as click, \
                patch.object(farming_flow, "ActionChains") as chains, \
                patch.object(farming_flow.time, "sleep"):
            closed = farming_flow.dismiss_notice_dialogs(fake, **kwargs)
        return closed, click, chains

    def test_clicks_close_and_records_restriction_text(self):
        fake = FakeNoticeDriver()
        closed, click, chains = self.run_dismiss(fake)
        self.assertEqual(closed, 1)
        click.assert_called_once_with(fake, fake.close_button)
        chains.assert_not_called()
        notices = farming_flow.pop_notices()
        self.assertEqual(len(notices), 1)
        self.assertIn("You can't create multiple sessions", notices[0])
        self.assertIn("Ends on 9 Oct 2026", notices[0])
        self.assertNotIn("See why", notices[0])

    def test_no_dialog_does_nothing(self):
        fake = FakeNoticeDriver(open_dialogs=0)
        closed, click, _ = self.run_dismiss(fake)
        self.assertEqual(closed, 0)
        click.assert_not_called()
        self.assertEqual(farming_flow.pop_notices(), [])

    def test_stacked_dialogs_closed_without_duplicate_notice(self):
        fake = FakeNoticeDriver(open_dialogs=2)
        closed, click, _ = self.run_dismiss(fake)
        self.assertEqual(closed, 2)
        self.assertEqual(click.call_count, 2)
        self.assertEqual(len(farming_flow.pop_notices()), 1)

    def test_falls_back_to_escape_without_close_button(self):
        fake = FakeNoticeDriver(has_close=False)
        closed, click, chains = self.run_dismiss(fake, max_rounds=1)
        self.assertEqual(closed, 1)
        click.assert_not_called()
        chains.return_value.send_keys.assert_called_once_with(farming_flow.Keys.ESCAPE)

    def test_blocked_dialog_kept_for_blocked_status(self):
        fake = FakeNoticeDriver(blocked=True)
        with patch.object(farming_flow, "_find_visible", side_effect=fake.find_visible), \
                patch.object(farming_flow, "_check_logged_in", return_value=True), \
                patch.object(farming_flow, "dismiss_notice_dialogs") as dismiss:
            self.assertEqual(farming_flow.check_account_state(fake), "blocked")
        dismiss.assert_not_called()

    def test_account_state_dismisses_notice(self):
        fake = FakeNoticeDriver()
        with patch.object(farming_flow, "_find_visible", side_effect=fake.find_visible), \
                patch.object(farming_flow, "_check_logged_in", return_value=True), \
                patch.object(farming_flow, "_human_click", side_effect=fake.click), \
                patch.object(farming_flow.time, "sleep"):
            self.assertIsNone(farming_flow.check_account_state(fake))
        self.assertEqual(fake.open_dialogs, 0)


class NoticeLocatorTests(unittest.TestCase):
    """Chạy XPath thật trên HTML mô phỏng popup trong ảnh (Chrome headless)."""

    HTML = """
    <html><body>
      <div aria-label="Close" role="button" id="post-x">x</div>
      <div role="dialog" id="notice">
        <div><h2>What happened</h2>
          <div aria-label="Close" role="button" id="notice-x"></div></div>
        <span>We added a restriction to your account</span>
        <span>You can’t create multiple sessions</span>
      </div>
      <div role="dialog" id="post"><span>What happened here?</span>
        <div aria-label="Close" role="button" id="post-dialog-x"></div></div>
      <div role="dialog" id="notif-panel"><h2>Notifications</h2>
        <div role="tab">All</div><div role="tab">Unread</div>
        <a role="link"><span>We added a restriction to your account. Ends on 9 Oct 2026.</span></a>
        <div aria-label="Close" role="button" id="notif-x"></div></div>
      <div role="dialog" id="composer"><span>Create post</span>
        <div aria-label="Close" role="button" id="composer-x"></div></div>
    </body></html>
    """

    @classmethod
    def setUpClass(cls):
        import urllib.parse
        try:
            from selenium import webdriver
            options = webdriver.ChromeOptions()
            options.add_argument("--headless=new")
            cls.driver = webdriver.Chrome(options=options)
        except Exception as e:
            raise unittest.SkipTest(f"Không mở được Chrome headless: {e}")
        cls.driver.get("data:text/html;charset=utf-8," + urllib.parse.quote(cls.HTML))

    @classmethod
    def tearDownClass(cls):
        cls.driver.quit()

    def xpath(self, locator, root=None):
        from selenium.webdriver.common.by import By
        return (root or self.driver).find_elements(By.XPATH, locator)

    def test_matches_only_notice_dialog_and_its_close(self):
        dialogs = self.xpath(FARM_COMMON["notice_dialog"][0])
        self.assertEqual([d.get_attribute("id") for d in dialogs], ["notice"])
        buttons = self.xpath(FARM_COMMON["notice_close"][0], dialogs[0])
        self.assertEqual([b.get_attribute("id") for b in buttons], ["notice-x"])

    def test_blocked_dialog_not_triggered_by_restriction_notice(self):
        self.assertEqual(self.xpath(FARM_COMMON["blocked_dialog"][0]), [])


if __name__ == "__main__":
    unittest.main()
