import unittest
from unittest.mock import Mock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from ..automation.login_flow import _get_account_identity, _get_avatar_url, _read_profile_link_avatar, run_login
from selenium.webdriver.common.by import By
from ..context import owner_scope
from ..database.connection import Base
from ..database.models import Account
from ..database.repository import AccountRepository as Repo
from ..services.account_service import serialize


class AvatarTests(unittest.TestCase):
    @patch("modules.module_02_account_manager.automation.login_flow._get_profile_name")
    def test_name_and_avatar_are_read_together_without_opening_profile(self, fallback):
        driver = self.driver()
        anchor, image = Mock(), Mock()
        anchor.is_displayed.return_value = True
        anchor.get_attribute.return_value = "https://web.facebook.com/profile.php?id=123"
        anchor.text = "Hồng Hạnh"
        anchor.find_elements.return_value = [image]
        url = "https://scontent.fbcdn.net/avatar.png?oh=abc&oe=123"
        image.get_attribute.return_value = url
        driver.find_elements.side_effect = lambda by, _: [anchor] if by == By.CSS_SELECTOR else []
        self.assertEqual(_get_account_identity(driver, "123"), {"profile_name": "Hồng Hạnh", "avatar_url": url})
        driver.get.assert_not_called()
        fallback.assert_not_called()

    @patch("modules.module_02_account_manager.automation.login_flow._get_profile_name", return_value="Fallback name")
    @patch("modules.module_02_account_manager.automation.login_flow._get_avatar_url", return_value="https://scontent.fbcdn.net/a.png")
    def test_missing_homepage_name_keeps_avatar_and_uses_name_fallback(self, avatar, fallback):
        identity = _get_account_identity(self.driver(), "123")
        self.assertEqual(identity, {"profile_name": "Fallback name", "avatar_url": "https://scontent.fbcdn.net/a.png"})
        fallback.assert_called_once()

    def test_profile_link_svg_without_account_label_or_header(self):
        driver = self.driver()
        anchor, image = Mock(), Mock()
        anchor.is_displayed.return_value = True
        anchor.get_attribute.return_value = "https://web.facebook.com/profile.php?id=61581308882268"
        anchor.find_elements.return_value = [image]
        url = "https://scontent.fhan17-1.fna.fbcdn.net/avatar.png?oh=abc&oe=6AD4CC73"
        image.get_attribute.side_effect = lambda name: url if name == "xlink:href" else None
        driver.find_elements.return_value = [anchor]
        self.assertEqual(_read_profile_link_avatar(driver, "61581308882268"), url)
        image.get_attribute.assert_called_with("xlink:href")
        driver.execute_script.assert_not_called()

    def test_profile_link_rejects_other_uid_and_non_facebook_host(self):
        driver = self.driver()
        for href in ("https://web.facebook.com/profile.php?id=1234", "https://example.com/profile.php?id=123"):
            anchor = Mock()
            anchor.is_displayed.return_value = True
            anchor.get_attribute.return_value = href
            driver.find_elements.return_value = [anchor]
            self.assertIsNone(_read_profile_link_avatar(driver, "123"))
            anchor.find_elements.assert_not_called()

    def test_returns_home_after_name_extraction_before_reading_avatar(self):
        driver = self.driver()
        driver.current_url = "https://www.facebook.com/me"
        url = "https://scontent.fbcdn.net/avatar.png?oh=abc&oe=123"
        def read_dom(*_):
            driver.get.assert_called_once_with("https://www.facebook.com")
            return [url]
        driver.execute_script.side_effect = read_dom
        self.assertEqual(_get_avatar_url(driver, "123"), url)

    def test_login_service_commits_avatar_for_the_correct_owner(self):
        from ..services.login_service import login_one
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        url = "https://scontent.fbcdn.net/avatar.png?oh=abc&oe=123"
        with Session(engine) as db:
            db.add_all([Account(uid="123", user_id="7"), Account(uid="123", user_id="5")])
            db.commit()
        with owner_scope("7"), patch(
            "modules.module_02_account_manager.services.login_service.SessionLocal",
            side_effect=lambda: Session(engine, expire_on_commit=False),
        ), patch(
            "modules.module_02_account_manager.services.login_service.runtime.stopping.is_set", return_value=False,
        ), patch(
            "modules.module_02_account_manager.automation.login_flow.run_login",
            return_value={"success": True, "profile_name": "Name", "avatar_url": url},
        ), patch("modules.module_02_account_manager.services.login_service.broadcast") as broadcast:
            login_one("123")
            self.assertTrue(any("Đã lấy và lưu" in call.args[1] for call in broadcast.call_args_list))
        # A new session verifies commit, rather than an in-memory ORM assignment.
        with Session(engine) as db:
            with owner_scope("7"):
                self.assertEqual(Repo.get_by_uid(db, "123").avatar_url, url)
            with owner_scope("5"):
                self.assertIsNone(Repo.get_by_uid(db, "123").avatar_url)
        engine.dispose()

    def driver(self):
        driver = Mock()
        driver.get_cookie.side_effect = lambda name: {"value": "123"} if name == "c_user" else None
        driver.timeouts.page_load = 30
        driver.current_url = "https://www.facebook.com/"
        driver.get_cookies.return_value = [{"name": "c_user", "value": "123"}]
        driver.find_elements.return_value = []
        return driver

    def test_signed_svg_url_is_preserved_and_timeout_restored(self):
        driver = self.driver()
        url = "https://scontent.fhan17-1.fna.fbcdn.net/avatar.png?oh=abc&oe=123"
        driver.execute_script.return_value = ["https://example.com/image.png", url]
        self.assertEqual(_get_avatar_url(driver, "123"), url)
        driver.get.assert_not_called()
        driver.set_page_load_timeout.assert_called_with(30)
        self.assertIn("getAttributeNS", driver.execute_script.call_args.args[0])

    def test_other_account_is_rejected(self):
        driver = self.driver()
        self.assertIsNone(_get_avatar_url(driver, "456"))
        driver.get.assert_not_called()

    def test_navigation_failure_is_nonfatal(self):
        driver = self.driver()
        driver.execute_script.return_value = []
        driver.get.side_effect = RuntimeError("network failed")
        self.assertIsNone(_get_avatar_url(driver, "123"))
        driver.set_page_load_timeout.assert_called_with(30)

    def test_page_identity_is_reset_before_reading_avatar(self):
        driver = self.driver()
        state = {"page": True}
        driver.get_cookie.side_effect = lambda name: ({"value": "123"} if name == "c_user"
            else {"value": "999"} if state["page"] else None)
        driver.delete_cookie.side_effect = lambda *_: state.update(page=False)
        driver.execute_script.return_value = ["https://scontent.fbcdn.net/personal.png"]
        self.assertEqual(_get_avatar_url(driver, "123"), "https://scontent.fbcdn.net/personal.png")
        driver.delete_cookie.assert_called_once_with("i_user")
        driver.get.assert_called_once()

    @patch("modules.module_02_account_manager.automation.login_flow.time.sleep")
    @patch("modules.module_02_account_manager.automation.login_flow.human_sleep")
    @patch("modules.module_02_account_manager.automation.login_flow._get_profile_name", return_value="Name")
    @patch("modules.module_02_account_manager.automation.login_flow._get_avatar_url", return_value="https://scontent.fbcdn.net/a.png")
    @patch("modules.module_02_account_manager.automation.login_flow.create_driver")
    def test_existing_session_collects_avatar_before_quit(self, create, avatar, *_):
        driver = self.driver()
        create.return_value = driver
        avatar.side_effect = lambda *_: self.assertFalse(driver.quit.called) or "https://scontent.fbcdn.net/a.png"
        result = run_login("123", "")
        self.assertTrue(result["success"])
        self.assertEqual(result["avatar_url"], "https://scontent.fbcdn.net/a.png")
        driver.quit.assert_called_once()

    def test_persistence_preserves_old_url_and_scopes_owner(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add_all([Account(uid="123", user_id="alice"), Account(uid="123", user_id="bob")])
            db.commit()
            with owner_scope("alice"):
                Repo.update_login_status(db, "123", "logged_in", avatar_url="https://scontent.fbcdn.net/a.png")
                Repo.update_login_status(db, "123", "logged_in", avatar_url=None)
                Repo.update_login_status(db, "123", "failed", avatar_url="https://scontent.fbcdn.net/b.png")
                self.assertEqual(serialize(Repo.get_by_uid(db, "123"))["avatar_url"], "https://scontent.fbcdn.net/a.png")
            with owner_scope("bob"):
                self.assertIsNone(serialize(Repo.get_by_uid(db, "123"))["avatar_url"])
        engine.dispose()
