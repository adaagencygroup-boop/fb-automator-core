import asyncio
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from modules.module_03_acc_farm import models as farm_models
from modules.module_03_acc_farm import repository
from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.farming import flow as farming_flow

FLOW = "modules.module_03_acc_farm.farming.flow"


class SplitKeywordTests(unittest.TestCase):
    def test_split_trims_drops_empty_and_duplicates(self):
        self.assertEqual(farm_routes.split_group_keywords(" bất động sản, du lịch,, Du Lịch , ẩm thực ,"),
                         ["bất động sản", "du lịch", "ẩm thực"])

    def test_empty_means_suggested_groups(self):
        self.assertEqual(farm_routes.split_group_keywords(""), [])
        self.assertEqual(farm_routes.split_group_keywords(" , ,"), [])

    def test_keyword_dropped_when_join_groups_disabled(self):
        cfg = farm_routes._normalize_config(farm_routes.FarmScenarioConfig(group_keyword="  a, b  "))
        self.assertEqual(cfg.group_keyword, "")
        cfg = farm_routes._normalize_config(farm_routes.FarmScenarioConfig(enabled_join_groups=True, group_keyword="  a, b  "))
        self.assertEqual(cfg.group_keyword, "a, b")


class StartValidationTests(unittest.TestCase):
    def start(self, keyword: str, join_enabled: bool = True):
        req = farm_routes.FarmStartRequest(uids=["1"], threads=1, config=farm_routes.FarmScenarioConfig(
            enabled_join_groups=join_enabled, enabled_check_notif=True, group_keyword=keyword))
        with patch.object(farm_routes.adapters, "get_owner_username", return_value=None), \
                patch.object(farm_routes.adapters, "get_account", return_value=None):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(farm_routes.start_farm_interactions(req))
        return ctx.exception

    def test_50_chars_passes_keyword_check(self):
        err = self.start("a" * 50)
        self.assertNotIn("Từ khóa", err.detail)  # đi tiếp tới bước kiểm tài khoản

    def test_51_chars_rejected(self):
        err = self.start("a" * 51)
        self.assertEqual(err.status_code, 400)
        self.assertEqual(err.detail, "Từ khóa tham gia nhóm không được quá 50 ký tự.")

    def test_length_counted_after_trimming(self):
        self.assertNotIn("Từ khóa", self.start("   " + "a" * 50 + "   ").detail)

    def test_long_keyword_ignored_when_join_disabled(self):
        self.assertNotIn("Từ khóa", self.start("a" * 80, join_enabled=False).detail)


class BuildPlanTests(unittest.TestCase):
    def test_each_plan_gets_all_keywords_in_own_order(self):
        cfg = farm_routes._normalize_config(farm_routes.FarmScenarioConfig(
            enabled_join_groups=True, group_keyword="a, b, c, d"))
        orders = set()
        for _ in range(30):
            params = dict(farm_routes._build_plan(cfg))["JOIN_GROUP"]
            self.assertEqual(sorted(params["keywords"]), ["a", "b", "c", "d"])
            orders.add(tuple(params["keywords"]))
        self.assertGreater(len(orders), 1)


class RunJoinGroupsTests(unittest.TestCase):
    def run_flow(self, keywords, buttons_by_url, target=3, stop_after_picks=None):
        driver = Mock()
        driver.current_url = ""
        opened, picks = [], {"n": 0}

        def open_url(drv, ctl, url, reuse=False):
            drv.current_url = url
            opened.append(url)

        def pick(drv, ctl, locators, clicked):
            picks["n"] += 1
            if stop_after_picks and picks["n"] > stop_after_picks:
                raise farming_flow.FarmStopped()
            remaining = buttons_by_url.get(drv.current_url, 0)
            if remaining <= 0:
                return None
            buttons_by_url[drv.current_url] = remaining - 1
            return Mock()

        with patch(f"{FLOW}._open", side_effect=open_url), \
                patch(f"{FLOW}._wait_for_any", return_value=True), \
                patch(f"{FLOW}._pick_button", side_effect=pick), \
                patch(f"{FLOW}._human_click", return_value=True), \
                patch(f"{FLOW}.check_account_state", return_value=None), \
                patch(f"{FLOW}._handle_group_dialog", return_value="joined"), \
                patch(f"{FLOW}.human_scroll"), \
                patch(f"{FLOW}._pause_between"):
            result = farming_flow.run_join_groups(driver, Mock(), target, keywords, Mock())
        return result, opened

    @staticmethod
    def search(keyword):
        return farming_flow.FB_GROUPS_SEARCH.format(q=farming_flow.quote_plus(keyword))

    def test_moves_to_next_keyword_when_current_runs_out(self):
        result, opened = self.run_flow(["a", "b", "c"], {self.search("a"): 1, self.search("b"): 5})
        self.assertEqual((result["status"], result["quantity"]), ("SUCCESS", 3))
        self.assertEqual(result["keywords"], ["a", "b"])
        self.assertEqual(opened, [self.search("a"), self.search("b")])
        self.assertIn("'a', 'b'", result["details"])

    def test_all_keywords_exhausted(self):
        result, _ = self.run_flow(["a", "b"], {self.search("a"): 1})
        self.assertEqual((result["status"], result["quantity"], result["keywords"]), ("SUCCESS", 1, ["a", "b"]))

    def test_no_keyword_uses_suggested_groups(self):
        result, opened = self.run_flow([], {farming_flow.FB_GROUPS_DISCOVER: 3})
        self.assertEqual(opened, [farming_flow.FB_GROUPS_DISCOVER])
        self.assertEqual((result["quantity"], result["keywords"]), (3, []))
        self.assertIn("nhóm đề xuất", result["details"])

    def test_stop_midway_keeps_used_keywords(self):
        with self.assertRaises(farming_flow.FarmStopped) as ctx:
            self.run_flow(["a", "b"], {self.search("a"): 5}, stop_after_picks=1)
        self.assertEqual(ctx.exception.partial, {"keywords": ["a"]})


class HistoryKeywordTests(unittest.TestCase):
    def test_summary_joins_used_keywords_in_order(self):
        out = repository.summarize_actions([
            {"action": "JOIN_GROUP", "status": "SUCCESS", "quantity": 2, "keywords": ["b", "a"]},
        ])
        self.assertEqual((out["groups_joined"], out["groups_keyword"]), (2, "b, a"))

    def test_summary_null_without_keywords(self):
        self.assertIsNone(repository.summarize_actions([
            {"action": "JOIN_GROUP", "status": "SUCCESS", "quantity": 1, "keywords": []}])["groups_keyword"])
        self.assertIsNone(repository.summarize_actions([])["groups_keyword"])

    def test_column_written_and_exported(self):
        self.assertIn("groups_keyword", repository.HISTORY_COLUMNS)
        self.assertIn(("groups_keyword", "Từ khóa nhóm"), farm_routes._CSV_COLUMNS)


class AddedColumnTests(unittest.TestCase):
    def test_postgres_uses_if_not_exists(self):
        fake = Mock(_is_postgres=True)
        with patch.object(farm_models, "db", fake):
            farm_models._add_missing_columns()
        fake.execute.assert_called_once_with("ALTER TABLE farm_run_history ADD COLUMN IF NOT EXISTS groups_keyword TEXT")

    def test_sqlite_adds_only_when_missing(self):
        fake = Mock(_is_postgres=False)
        fake.fetch_all.return_value = [{"name": "id"}]
        with patch.object(farm_models, "db", fake):
            farm_models._add_missing_columns()
        fake.execute.assert_called_once_with("ALTER TABLE farm_run_history ADD COLUMN groups_keyword TEXT")

        fake = Mock(_is_postgres=False)
        fake.fetch_all.return_value = [{"name": "id"}, {"name": "groups_keyword"}]
        with patch.object(farm_models, "db", fake):
            farm_models._add_missing_columns()
        fake.execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
