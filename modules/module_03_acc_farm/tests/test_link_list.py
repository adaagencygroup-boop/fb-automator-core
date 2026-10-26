import asyncio
import json
import unittest
from datetime import timedelta
from unittest.mock import Mock, patch

from fastapi import HTTPException

from modules.module_03_acc_farm import repository
from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.farming import flow as farming_flow

FLOW = "modules.module_03_acc_farm.farming.flow"


class ParseLinkTests(unittest.TestCase):
    def key(self, raw):
        link = farm_routes.parse_fb_link(raw)
        return (link["kind"], link["key"], link["url"]) if link else None

    def test_group_links(self):
        url = "https://www.facebook.com/groups/123456/"
        for raw in ("https://www.facebook.com/groups/123456",
                    "https://web.facebook.com/groups/123456/?ref=share",
                    "m.facebook.com/groups/123456/posts/999/",
                    "https://mbasic.facebook.com/groups/123456/permalink/888/",
                    "http://fb.com/groups/123456#top"):
            self.assertEqual(self.key(raw), ("group", "group:123456", url), raw)
        self.assertEqual(self.key("https://www.facebook.com/groups/PhongTro.HCM/"),
                         ("group", "group:phongtro.hcm", "https://www.facebook.com/groups/PhongTro.HCM/"))

    def test_person_links(self):
        by_id = ("friend", "id:1000123", "https://www.facebook.com/profile.php?id=1000123")
        for raw in ("https://www.facebook.com/profile.php?id=1000123&sk=about",
                    "https://www.facebook.com/people/Nguyen-Van-A/1000123/",
                    "https://www.facebook.com/friends/suggestions/?profile_id=1000123",
                    "https://www.facebook.com/groups/555/user/1000123/",
                    "facebook.com/1000123"):
            self.assertEqual(self.key(raw), by_id, raw)
        self.assertEqual(self.key("https://www.facebook.com/Zuck.Berg?mibextid=abc"),
                         ("friend", "user:zuck.berg", "https://www.facebook.com/Zuck.Berg"))

    def test_share_links_accepted_without_knowing_target(self):
        self.assertEqual(self.key("https://www.facebook.com/share/g/1AbCdE/"),
                         ("group", "share:/share/g/1AbCdE/", "https://www.facebook.com/share/g/1AbCdE/"))
        self.assertEqual(self.key("https://www.facebook.com/share/1XyZ"),
                         ("friend", "share:/share/1XyZ/", "https://www.facebook.com/share/1XyZ/"))
        self.assertIsNone(self.key("https://www.facebook.com/share/p/1XyZ/"))  # bài viết

    def test_rejected(self):
        for raw in ("", "abc", "https://evil.com/groups/1", "https://facebook.com.evil.com/groups/1",
                    "javascript:alert(1)", "ftp://facebook.com/groups/1", "https://www.facebook.com/groups/joins/",
                    "https://www.facebook.com/groups/", "https://www.facebook.com/watch", "https://www.facebook.com/",
                    "https://www.facebook.com/profile.php?id=abc", "https://www.facebook.com/abc",
                    "https://www.facebook.com/a/b", "https://www.facebook.com/groups/1 x",
                    "https://www.facebook.com/groups/" + "1" * 600):
            self.assertIsNone(self.key(raw), raw)


class ParseLinkListTests(unittest.TestCase):
    def test_line_numbers_duplicates_and_wrong_box(self):
        raw = ("https://www.facebook.com/groups/111\n"
               "\n"
               "  https://web.facebook.com/groups/111/posts/5  \n"
               "https://www.facebook.com/profile.php?id=9\n"
               "rác\n"
               "https://www.facebook.com/groups/222/\n")
        out = farm_routes.parse_link_list(raw, "group")
        self.assertEqual([i["key"] for i in out["items"]], ["group:111", "group:222"])
        self.assertEqual(out["items"][0]["source"], "https://www.facebook.com/groups/111")
        self.assertEqual(out["duplicates"], 1)
        self.assertEqual([n for n, _ in out["errors"]], [4, 5])
        self.assertIn("link trang cá nhân", out["errors"][0][1])

    def test_group_link_in_friend_box(self):
        out = farm_routes.parse_link_list("https://www.facebook.com/groups/1", "friend")
        self.assertEqual(out["items"], [])
        self.assertIn("link nhóm", out["errors"][0][1])

    def test_error_message(self):
        self.assertIsNone(farm_routes._link_list_error("https://www.facebook.com/groups/1", "group"))
        self.assertEqual(farm_routes._link_list_error(" \n ", "group"),
                         "Danh sách nhóm đang trống. Vui lòng dán ít nhất 1 link.")
        msg = farm_routes._link_list_error("\n".join(["x"] * 7), "friend")
        self.assertTrue(msg.startswith("Danh sách kết bạn có link sai (dòng 1: "))
        self.assertIn("và 2 dòng khác", msg)


class ListConfigTests(unittest.TestCase):
    def test_defaults(self):
        cfg = farm_routes.FarmScenarioConfig()
        self.assertFalse(cfg.daily_limit_enabled)
        self.assertEqual((cfg.group_source, cfg.group_list_limit, cfg.friend_source, cfg.friend_list_limit),
                         ("keyword", 10, "suggestions", 10))

    def test_invalid_source_rejected(self):
        with self.assertRaises(ValueError):
            farm_routes.FarmScenarioConfig(group_source="scan")

    def test_limits_clamped_and_unused_fields_dropped(self):
        cfg = farm_routes._normalize_config(farm_routes.FarmScenarioConfig(
            enabled_join_groups=True, group_source="list", group_links=" a ", group_keyword="kw", group_list_limit=500,
            enabled_add_friends=True, friend_source="suggestions", friend_links="b", friend_list_limit=0,
            friends_fallback_group_members=True))
        self.assertEqual((cfg.group_links, cfg.group_keyword, cfg.group_list_limit), ("a", "", 100))
        self.assertEqual((cfg.friend_links, cfg.friend_list_limit, cfg.friends_fallback_group_members), ("", 1, True))

    def test_fallback_off_in_friend_list_mode(self):
        cfg = farm_routes._normalize_config(farm_routes.FarmScenarioConfig(
            enabled_add_friends=True, friend_source="list", friend_links="x", friends_fallback_group_members=True))
        self.assertFalse(cfg.friends_fallback_group_members)

    def test_plan_uses_limit_and_own_order(self):
        links = "\n".join(f"https://www.facebook.com/groups/{i}" for i in range(6))
        cfg = farm_routes._normalize_config(farm_routes.FarmScenarioConfig(
            enabled_join_groups=True, group_source="list", group_links=links, group_list_limit=4))
        orders = set()
        for _ in range(30):
            params = dict(farm_routes._build_plan(cfg))["JOIN_GROUP"]
            self.assertEqual(params["target"], 4)
            self.assertEqual(sorted(i["key"] for i in params["links"]), [f"group:{i}" for i in range(6)])
            orders.add(tuple(i["key"] for i in params["links"]))
        self.assertGreater(len(orders), 1)
        self.assertEqual(farm_routes._action_label("JOIN_GROUP", params), "Tham gia nhóm theo danh sách")
        self.assertEqual(farm_routes._action_source("JOIN_GROUP", params), "list")
        self.assertEqual(farm_routes._action_source("JOIN_GROUP", {"keywords": []}), "suggested")
        self.assertEqual(farm_routes._action_source("JOIN_GROUP", {"keywords": ["a"]}), "keyword")


class StartListValidationTests(unittest.TestCase):
    def start(self, **config):
        req = farm_routes.FarmStartRequest(uids=["1"], threads=1, config=farm_routes.FarmScenarioConfig(**config))
        with patch.object(farm_routes.adapters, "owner_from_request", return_value=None), \
                patch.object(farm_routes.adapters, "get_account", return_value=None):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(farm_routes.start_farm_interactions(req, Mock()))
        return ctx.exception

    def test_empty_list_rejected(self):
        err = self.start(enabled_join_groups=True, group_source="list", group_links="  ")
        self.assertEqual((err.status_code, err.detail), (400, "Danh sách nhóm đang trống. Vui lòng dán ít nhất 1 link."))

    def test_bad_line_rejected(self):
        err = self.start(enabled_add_friends=True, friend_source="list",
                         friend_links="https://www.facebook.com/zuck.berg\nhttps://www.facebook.com/groups/1")
        self.assertEqual(err.status_code, 400)
        self.assertIn("dòng 2", err.detail)

    def test_valid_list_passes_to_account_check(self):
        err = self.start(enabled_join_groups=True, group_source="list", group_links="https://www.facebook.com/groups/1")
        self.assertIn("đủ điều kiện", err.detail)

    def test_list_of_disabled_scenario_ignored(self):
        err = self.start(enabled_check_notif=True, group_source="list", group_links="rác")
        self.assertIn("đủ điều kiện", err.detail)


class GroupHistorySkipTests(unittest.TestCase):
    def skips(self, rows):
        with patch.object(repository, "group_target_history", return_value=rows):
            return farm_routes._group_history_skips("100")

    @staticmethod
    def row(action, targets, days_ago):
        return {"action_type": action, "targets": json.dumps(targets),
                "created_at": repository.utc_now() - timedelta(days=days_ago)}

    def test_joined_pending_and_keyword_mode_skipped(self):
        out = self.skips([
            self.row("JOIN_GROUP", [{"name": "A", "url": "https://www.facebook.com/groups/1/", "status": None}], 30),
            self.row("JOIN_GROUP", [{"url": "https://www.facebook.com/groups/2/", "source_url": "fb.com/groups/2",
                                     "result": "pending"}], 1),
            self.row("JOIN_GROUP", [{"url": "https://www.facebook.com/groups/real/",
                                     "source_url": "https://www.facebook.com/share/g/XYZ/", "result": "joined"}], 1),
            self.row("JOIN_GROUP", [{"url": "https://www.facebook.com/groups/3/", "result": "skipped_unavailable"}], 1),
        ])
        self.assertEqual(set(out), {"group:1", "group:2", "group:real", "share:/share/g/XYZ/"})

    def test_left_recently_skipped_left_long_ago_allowed(self):
        joined = [{"url": "https://www.facebook.com/groups/1/", "result": "joined"}]
        left = [{"url": "https://www.facebook.com/groups/1/", "result": "left"}]
        recent = self.skips([self.row("JOIN_GROUP", joined, 20), self.row("LEAVE_GROUP", left, 3)])
        self.assertIn("chưa đủ 7 ngày", recent["group:1"])
        self.assertEqual(self.skips([self.row("JOIN_GROUP", joined, 20), self.row("LEAVE_GROUP", left, 8)]), {})
        # Rời rồi vào lại: trạng thái cuối là đã vào
        self.assertIn("group:1", self.skips([self.row("LEAVE_GROUP", left, 10), self.row("JOIN_GROUP", joined, 2)]))

    def test_broken_rows_ignored(self):
        rows = [{"action_type": "JOIN_GROUP", "targets": "hỏng", "created_at": repository.utc_now()},
                {"action_type": "JOIN_GROUP", "targets": '{"a": 1}', "created_at": repository.utc_now()},
                {"action_type": "JOIN_GROUP", "targets": '["x", {"url": "javascript:1"}]', "created_at": None}]
        self.assertEqual(self.skips(rows), {})

    def test_db_error_raises(self):
        with patch.object(repository, "group_target_history", side_effect=OSError("offline")):
            with self.assertRaises(RuntimeError):
                farm_routes._group_history_skips("100")


class SummarizeSourceTests(unittest.TestCase):
    def test_groups_and_friends_source(self):
        out = repository.summarize_actions([
            {"action": "JOIN_GROUP", "status": "SUCCESS", "quantity": 2, "source": "list"},
            {"action": "ADD_FRIEND", "status": "SUCCESS", "quantity": 3, "source": "list"},
        ])
        self.assertEqual((out["groups_source"], out["friends_source"], out["groups_joined"]), ("list", "list", 2))
        self.assertIsNone(repository.summarize_actions([])["groups_source"])
        self.assertIn("groups_source", repository.HISTORY_COLUMNS)


def links_of(*keys):
    return [{"key": f"group:{k}", "url": f"https://www.facebook.com/groups/{k}/", "source": f"fb.com/groups/{k}"}
            for k in keys]


class JoinGroupsFromLinksTests(unittest.TestCase):
    """pages: id nhóm -> "join" (có nút) | "joined" | "pending" | "dead" (không xem được) | "form" (form phức tạp)."""

    def run_flow(self, pages, target, links=None, skips=None, blocked_on=None, pause_error=None):
        driver = Mock()
        driver.current_url = ""
        opened, logs, counts = [], [], []
        links = links if links is not None else links_of(*pages)

        def open_link(drv, ctl, url):
            drv.current_url = url
            opened.append(url.split("/")[-2])
            return True

        def page(drv=driver):
            return pages[drv.current_url.split("/")[-2]]

        def find(drv, locators, root=None):
            if locators is farming_flow.FARM_COMMON["unavailable_page"]:
                return ["x"] if page() == "dead" else []
            if locators is farming_flow.FARM_GROUP["page_join_button"]:
                return ["button"] if page() in ("join", "form", "joined_stray") else []
            return []

        def script(drv, js, *args):
            if js is farming_flow._PAGE_NAME_JS:
                return f"Nhóm {drv.current_url.split('/')[-2]}"
            return {"joined": "joined", "pending": "pending", "joined_stray": "joined"}.get(page())

        def state(drv):
            return "blocked" if blocked_on and drv.current_url.split("/")[-2] == blocked_on else None

        with patch(f"{FLOW}._open_link", side_effect=open_link), \
                patch(f"{FLOW}._wait_for_any", return_value=True), \
                patch(f"{FLOW}._find_visible", side_effect=find), \
                patch(f"{FLOW}._script", side_effect=script), \
                patch(f"{FLOW}._human_click", return_value=True), \
                patch(f"{FLOW}.check_account_state", side_effect=state), \
                patch(f"{FLOW}._close_dialogs"), \
                patch(f"{FLOW}._handle_group_dialog", side_effect=lambda d: "skipped" if page() == "form" else "none"), \
                patch(f"{FLOW}._pause_between", side_effect=pause_error):
            result = farming_flow.run_join_groups_from_links(
                driver, Mock(), links, target, Mock(), progress=counts.append,
                skips=skips or {}, log=lambda level, text: logs.append((level, text)))
        return result, opened, logs, counts

    def test_skips_do_not_count_toward_limit(self):
        pages = {"1": "joined", "2": "join", "3": "dead", "4": "form", "5": "join", "6": "join"}
        result, opened, logs, counts = self.run_flow(pages, target=2, skips={"group:2": "đã vào (theo lịch sử tool)"})
        self.assertEqual((result["status"], result["quantity"]), ("SUCCESS", 2))
        self.assertEqual(opened, ["1", "3", "4", "5", "6"])  # nhóm 2 bỏ qua theo lịch sử, không mở
        self.assertEqual(counts, [1, 2])
        self.assertEqual([(t["source_url"].split("/")[-1], t["result"]) for t in result["targets"]], [
            ("1", "skipped_done"), ("2", "skipped_done"), ("3", "skipped_unavailable"), ("4", "skipped_form"),
            ("5", None), ("6", None)])
        self.assertEqual(result["targets"][0]["reason"], "nick đã là thành viên nhóm")
        self.assertEqual(len(logs), 6)
        self.assertIn("bỏ qua 4 link", result["details"])

    def test_joined_page_with_stray_join_button_not_clicked(self):
        result, opened, _, _ = self.run_flow({"1": "joined_stray", "2": "join"}, target=2)
        self.assertEqual(opened, ["1", "2"])
        self.assertEqual([t["result"] for t in result["targets"]], ["skipped_done", None])
        self.assertEqual(result["quantity"], 1)

    def test_list_shorter_than_limit_uses_whole_list(self):
        result, opened, _, _ = self.run_flow({"1": "join", "2": "pending"}, target=10)
        self.assertEqual(result["quantity"], 1)
        self.assertEqual(opened, ["1", "2"])
        self.assertIn("1/10 nhóm, hết danh sách, bỏ qua 1 link", result["details"])

    def test_nothing_joined_is_skipped_with_targets(self):
        result, _, _, _ = self.run_flow({"1": "dead"}, target=3)
        self.assertEqual((result["status"], result["quantity"], len(result["targets"])), ("SKIPPED", 0, 1))

    def test_blocked_stops(self):
        result, opened, _, _ = self.run_flow({"1": "join", "2": "join", "3": "join"}, target=3, blocked_on="2")
        self.assertEqual((result["status"], result["quantity"], opened), ("BLOCKED", 1, ["1", "2"]))

    def test_stop_keeps_targets(self):
        with self.assertRaises(farming_flow.FarmStopped) as ctx:
            self.run_flow({"1": "join", "2": "join"}, target=2, pause_error=farming_flow.FarmStopped())
        self.assertEqual([t["source_url"] for t in ctx.exception.partial["targets"]], ["fb.com/groups/1"])


class AddFriendsFromLinksTests(unittest.TestCase):
    def run_flow(self, states, target, know_on=None):
        driver = Mock()
        driver.current_url = ""
        links = [{"key": f"user:{k}", "url": f"https://www.facebook.com/{k}", "source": f"fb.com/{k}"} for k in states]
        clicked = []

        def open_link(drv, ctl, url):
            drv.current_url = url
            return True

        def who():
            return driver.current_url.rsplit("/", 1)[-1]

        def script(drv, js, *args):
            state = states[who()]
            if state == "unknown":
                return {"owner": None, "state": "unknown", "button": None}
            return {"owner": f"Tên {who()}", "state": state, "button": f"btn-{who()}" if state == "add" else None}

        def find(drv, locators, root=None):
            if locators is farming_flow.FARM_FRIEND["know_person_dialog"]:
                return ["dialog"] if know_on == who() else []
            return []

        with patch(f"{FLOW}._open_link", side_effect=open_link), \
                patch(f"{FLOW}._wait_for_any", return_value=True), \
                patch(f"{FLOW}._find_visible", side_effect=find), \
                patch(f"{FLOW}._script", side_effect=script), \
                patch(f"{FLOW}._human_click", side_effect=lambda d, b: clicked.append(b) or True), \
                patch(f"{FLOW}.check_account_state", return_value=None), \
                patch(f"{FLOW}._close_dialogs"), \
                patch(f"{FLOW}._pause_between"):
            result = farming_flow.run_add_friends_from_links(driver, Mock(), links, target, Mock())
        return result, clicked

    def test_only_owner_button_clicked_and_skips_not_counted(self):
        states = {"aaaaa": "friends", "bbbbb": "add", "ccccc": "pending", "ddddd": "unknown", "eeeee": "add",
                  "fffff": "add"}
        result, clicked = self.run_flow(states, target=2)
        self.assertEqual(clicked, ["btn-bbbbb", "btn-eeeee"])
        self.assertEqual((result["status"], result["quantity"]), ("SUCCESS", 2))
        self.assertEqual([(t["source_url"], t["result"]) for t in result["targets"]], [
            ("fb.com/aaaaa", "skipped_done"), ("fb.com/bbbbb", "sent"), ("fb.com/ccccc", "skipped_done"),
            ("fb.com/ddddd", "skipped_unavailable"), ("fb.com/eeeee", "sent")])
        self.assertEqual(result["targets"][1]["name"], "Tên bbbbb")
        self.assertEqual(result["targets"][0]["reason"], "đã là bạn bè")

    def test_know_person_dialog_stops(self):
        result, clicked = self.run_flow({"aaaaa": "add", "bbbbb": "add", "ccccc": "add"}, target=3, know_on="bbbbb")
        self.assertEqual((result["status"], result["quantity"], len(clicked)), ("SUCCESS", 1, 2))


class CleanPageUrlTests(unittest.TestCase):
    def test_clean(self):
        clean = farming_flow._clean_page_url
        self.assertEqual(clean("https://www.facebook.com/groups/123/?ref=share", "x"), "https://www.facebook.com/groups/123/")
        self.assertEqual(clean("https://web.facebook.com/profile.php?sk=about&id=42", "x"),
                         "https://www.facebook.com/profile.php?id=42")
        self.assertEqual(clean("https://www.facebook.com/zuck.berg?mibextid=1", "x"), "https://www.facebook.com/zuck.berg")
        self.assertEqual(clean("https://www.facebook.com/", "fallback"), "fallback")
        self.assertEqual(clean("about:blank", "fallback"), "fallback")


if __name__ == "__main__":
    unittest.main()
