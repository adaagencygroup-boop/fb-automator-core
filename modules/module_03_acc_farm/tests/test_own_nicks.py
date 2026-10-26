"""Kết bạn không mời trúng nick trong dàn (cùng owner): gợi ý, thành viên nhóm, danh sách link."""
import unittest
from unittest.mock import Mock, patch

from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.farming import flow as farming_flow

FLOW = "modules.module_03_acc_farm.farming.flow"
OWN = {"111", "222"}


def profile(uid):
    return f"https://www.facebook.com/profile.php?id={uid}"


class ProfileUidTests(unittest.TestCase):
    def test_reads_numeric_id_only(self):
        self.assertEqual(farming_flow._profile_uid(profile("123")), "123")
        self.assertEqual(farming_flow._profile_uid(None, "https://www.facebook.com/ten.nick", profile("9")), "9")
        self.assertIsNone(farming_flow._profile_uid("https://www.facebook.com/ten.nick", None))


class CardFlowsTests(unittest.TestCase):
    """Gợi ý + thành viên nhóm: thẻ có link profile.php?id=<số> (đọc trước khi bấm)."""

    def run_cards(self, runner, uids, target=5):
        driver = Mock()
        driver.current_url = ""
        driver.execute_script.return_value = ["g1"]  # nhóm đã tham gia (thành viên nhóm)
        queue = [Mock(id=f"b{i}", uid=u) for i, u in enumerate(uids)]
        clicked = []

        def pick(drv, ctl, locators, ids):
            return queue.pop(0) if queue else None

        with patch(f"{FLOW}._open"), \
                patch(f"{FLOW}._wait_for_any", return_value=True), \
                patch(f"{FLOW}._pick_button", side_effect=pick), \
                patch(f"{FLOW}._read_target", side_effect=lambda d, b, kind, token="": {"name": b.uid, "url": profile(b.uid)}), \
                patch(f"{FLOW}._human_click", side_effect=lambda d, b: clicked.append(b.uid) or True), \
                patch(f"{FLOW}.check_account_state", return_value=None), \
                patch(f"{FLOW}._find_visible", return_value=[]), \
                patch(f"{FLOW}.human_scroll"), \
                patch(f"{FLOW}._pause_between"):
            result = runner(driver, Mock(), target, Mock(), own_uids=OWN)
        return result, clicked

    def test_suggestions_skip_own_nicks(self):
        result, clicked = self.run_cards(farming_flow.run_add_friends, ["111", "500", "222", "600"])
        self.assertEqual(clicked, ["500", "600"])
        self.assertEqual(result["quantity"], 2)
        self.assertIn("bỏ qua 2 người là nick trong dàn", result["details"])
        self.assertEqual([t["url"] for t in result["targets"]], [profile("500"), profile("600")])

    def test_only_own_nicks_suggested_counts_as_no_suggestion(self):
        result, clicked = self.run_cards(farming_flow.run_add_friends, ["111", "222"])
        self.assertEqual((clicked, result["status"], result.get("no_suggestions")), ([], "SKIPPED", True))
        self.assertIn("bỏ qua 2 người là nick trong dàn", result["details"])

    def test_group_members_skip_own_nicks(self):
        result, clicked = self.run_cards(farming_flow.run_add_friends_from_groups, ["222", "700"], target=1)
        self.assertEqual((clicked, result["quantity"]), (["700"], 1))
        self.assertIn("bỏ qua 1 người là nick trong dàn", result["details"])


class LinkFlowTests(unittest.TestCase):
    def test_list_skips_own_nick_before_and_after_opening(self):
        driver = Mock()
        driver.current_url = ""
        links = [
            {"key": "id:111", "url": profile("111"), "source": "fb.com/profile.php?id=111"},   # nick nhà theo link
            {"key": "user:nick.hai", "url": "https://www.facebook.com/nick.hai", "source": "fb.com/nick.hai"},
            {"key": "id:500", "url": profile("500"), "source": "fb.com/profile.php?id=500"},
        ]
        opened, clicked = [], []

        def open_link(drv, ctl, url):
            opened.append(url)
            # Link username mở ra trang profile.php?id=222 (nick nhà)
            drv.current_url = profile("222") if url.endswith("nick.hai") else url
            return True

        def script(drv, js, *args):
            return {"owner": "Tên", "state": "add", "button": "btn"}

        with patch(f"{FLOW}._open_link", side_effect=open_link), \
                patch(f"{FLOW}._wait_for_any", return_value=True), \
                patch(f"{FLOW}._find_visible", return_value=[]), \
                patch(f"{FLOW}._script", side_effect=script), \
                patch(f"{FLOW}._human_click", side_effect=lambda d, b: clicked.append(driver.current_url) or True), \
                patch(f"{FLOW}.check_account_state", return_value=None), \
                patch(f"{FLOW}._close_dialogs"), \
                patch(f"{FLOW}._pause_between"):
            result = farming_flow.run_add_friends_from_links(driver, Mock(), links, 5, Mock(), own_uids=OWN)
        self.assertEqual(opened, ["https://www.facebook.com/nick.hai", profile("500")])  # link 111 không mở
        self.assertEqual(clicked, [profile("500")])
        self.assertEqual([t["result"] for t in result["targets"]], ["skipped_own_nick", "skipped_own_nick", "sent"])


class RoutesTests(unittest.TestCase):
    cfg = farm_routes.FarmScenarioConfig(enabled_add_friends=True)

    def run_action(self, own_uids):
        with patch.object(farm_routes, "_own_uids", own_uids), \
                patch.object(farm_routes, "_apply_daily_limit", return_value=(5, 0, 0)), \
                patch.object(farm_routes, "run_add_friends", return_value={"status": "SUCCESS", "quantity": 1}) as run:
            result = farm_routes._run_action(Mock(), Mock(), "a", "ADD_FRIEND", {"target": 5}, self.cfg, Mock())
        return result, run

    def test_passes_own_uids(self):
        result, run = self.run_action(frozenset(OWN))
        self.assertEqual(run.call_args.kwargs["own_uids"], frozenset(OWN))
        self.assertEqual(result["status"], "SUCCESS")

    def test_db_error_fails_instead_of_inviting_blind(self):
        result, run = self.run_action(None)
        run.assert_not_called()
        self.assertEqual(result["status"], "FAILED")
        self.assertIn("nick trong dàn", result["details"])


if __name__ == "__main__":
    unittest.main()
