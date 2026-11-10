"""Ô link / từ khóa còn lại sau 1 lượt: xóa phần đã chạy xong, giữ phần chưa xong để chạy lại."""
import asyncio
import unittest
from unittest.mock import Mock, patch

from modules.module_03_acc_farm import routes as farm_routes

G = "https://www.facebook.com/groups/{}"
P = "https://www.facebook.com/profile.php?id={}"


def cfg(**fields):
    return farm_routes.FarmScenarioConfig(**fields)


def groups(*ids):
    return "\n".join(G.format(i) for i in ids)


def target(link, result):
    return {"name": link, "url": link, "source_url": link, "result": result}


def act(action, status, *targets):
    return {"action": action, "status": status, "targets": list(targets)}


def link_items(*ids):
    return [{"key": f"group:{i}", "url": G.format(i), "source": G.format(i)} for i in ids]


class GroupListTests(unittest.TestCase):
    def config(self, split=True, links=groups(1, 2, 3, 4, 5)):
        return cfg(enabled_join_groups=True, group_source="list", group_links=links, groups_split_enabled=split)

    def test_all_success_clears_everything(self):
        out = farm_routes.leftover_inputs(self.config(), ["a", "b"], {}, {
            "a": [act("JOIN_GROUP", "SUCCESS", target(G.format(1), "joined"))],
            "b": [act("JOIN_GROUP", "SUCCESS", target(G.format(2), "pending"))],
        })
        self.assertEqual(out, {"group_links": "", "group_keyword": None, "friend_links": None})

    def test_split_keeps_only_links_not_done(self):
        assigned = {"a": {"group_links": link_items(1, 2, 5)}, "b": {"group_links": link_items(3, 4)}}
        out = farm_routes.leftover_inputs(self.config(), ["a", "b"], assigned, {
            "a": [act("JOIN_GROUP", "SUCCESS", target(G.format(1), "joined"), target(G.format(2), "skipped_done"),
                      target(G.format(5), "skipped_unavailable"))],
            # Nick b vào được nhóm 3 rồi lỗi: nhóm 3 xóa, nhóm 4 chưa tới lượt thì giữ
            "b": [act("JOIN_GROUP", "FAILED", target(G.format(3), "joined"))],
        })
        self.assertEqual(out["group_links"], groups(4, 5))

    def test_split_keeps_form_and_owned_links(self):
        out = farm_routes.leftover_inputs(self.config(links=groups(1, 2, 3)), ["a", "b"], {}, {
            "a": [act("JOIN_GROUP", "SUCCESS", target(G.format(1), "skipped_form"), target(G.format(2), "skipped_owned"))],
            "b": [],
        })
        self.assertEqual(out["group_links"], groups(1, 2, 3))

    def test_not_split_keeps_everything_when_a_nick_fails(self):
        out = farm_routes.leftover_inputs(self.config(split=False), ["a", "b"], {}, {
            "a": [act("JOIN_GROUP", "SUCCESS", target(G.format(1), "joined"))],
            "b": [act("JOIN_GROUP", "BLOCKED")],
        })
        self.assertIsNone(out["group_links"])

    def test_nick_without_assigned_links_is_not_a_failure(self):
        assigned = {"a": {"group_links": link_items(1)}, "b": {"group_links": []}}
        out = farm_routes.leftover_inputs(self.config(links=groups(1)), ["a", "b"], assigned, {
            "a": [act("JOIN_GROUP", "SUCCESS", target(G.format(1), "joined"))],
            "b": [act("JOIN_GROUP", "SKIPPED")],
        })
        self.assertEqual(out["group_links"], "")

    def test_nick_that_never_reached_join_is_a_failure(self):
        out = farm_routes.leftover_inputs(self.config(links=groups(1, 2)), ["a", "b"], {}, {
            "a": [act("JOIN_GROUP", "SUCCESS", target(G.format(1), "joined"))],
            "b": [act("NEWSFEED", "SUCCESS")],
        })
        self.assertEqual(out["group_links"], groups(2))

    def test_keeps_original_lines_and_order(self):
        raw = f"  {G.format(3)}  \n\n{G.format(1)}/posts/99\n{G.format(2)}"
        out = farm_routes.leftover_inputs(self.config(links=raw), ["a", "b"], {}, {
            "a": [act("JOIN_GROUP", "SUCCESS", target(G.format(2), "joined"))],
            "b": [act("JOIN_GROUP", "FAILED")],
        })
        self.assertEqual(out["group_links"], f"{G.format(3)}\n{G.format(1)}/posts/99")

    def test_uses_last_result_of_the_action(self):
        out = farm_routes.leftover_inputs(self.config(links=groups(1)), ["a"], {}, {
            "a": [act("JOIN_GROUP", "FAILED"), act("JOIN_GROUP", "SUCCESS", target(G.format(1), "joined"))],
        })
        self.assertEqual(out["group_links"], "")


class GroupKeywordTests(unittest.TestCase):
    def config(self, split=True, keywords="trọ cầu giấy, review đồ gia dụng, mẹ bỉm"):
        return cfg(enabled_join_groups=True, group_source="keyword", group_keyword=keywords, groups_split_enabled=split)

    def test_all_success_clears_keywords(self):
        out = farm_routes.leftover_inputs(self.config(), ["a"], {"a": {"group_keywords": ["mẹ bỉm"]}},
                                          {"a": [act("JOIN_GROUP", "SUCCESS")]})
        self.assertEqual(out["group_keyword"], "")

    def test_split_keeps_keywords_of_failed_nick(self):
        assigned = {"a": {"group_keywords": ["trọ cầu giấy", "mẹ bỉm"]}, "b": {"group_keywords": ["review đồ gia dụng"]}}
        out = farm_routes.leftover_inputs(self.config(), ["a", "b"], assigned, {
            "a": [act("JOIN_GROUP", "SUCCESS")], "b": [act("JOIN_GROUP", "SKIPPED")],
        })
        self.assertEqual(out["group_keyword"], "review đồ gia dụng")

    def test_shared_keyword_kept_when_one_nick_fails(self):
        assigned = {"a": {"group_keywords": ["mẹ bỉm"]}, "b": {"group_keywords": ["mẹ bỉm"]}}
        out = farm_routes.leftover_inputs(self.config(keywords="mẹ bỉm"), ["a", "b"], assigned, {
            "a": [act("JOIN_GROUP", "SUCCESS")], "b": [act("JOIN_GROUP", "FAILED")],
        })
        self.assertEqual(out["group_keyword"], "mẹ bỉm")

    def test_not_split_keeps_keywords(self):
        out = farm_routes.leftover_inputs(self.config(split=False), ["a", "b"], {}, {
            "a": [act("JOIN_GROUP", "SUCCESS")], "b": [act("JOIN_GROUP", "FAILED")],
        })
        self.assertIsNone(out["group_keyword"])

    def test_suggested_groups_has_nothing_to_clear(self):
        out = farm_routes.leftover_inputs(self.config(keywords=""), ["a"], {}, {"a": [act("JOIN_GROUP", "SUCCESS")]})
        self.assertIsNone(out["group_keyword"])


class FriendAndMixedTests(unittest.TestCase):
    def test_friend_list_removes_sent_and_already_friends(self):
        config = cfg(enabled_add_friends=True, friend_source="list", friend_links="\n".join(P.format(i) for i in (1, 2, 3)))
        out = farm_routes.leftover_inputs(config, ["a", "b"], {}, {
            "a": [act("ADD_FRIEND", "SUCCESS", target(P.format(1), "sent"), target(P.format(2), "skipped_done"))],
            "b": [act("ADD_FRIEND", "BLOCKED")],
        })
        self.assertEqual(out["friend_links"], P.format(3))

    def test_friend_suggestions_has_no_input(self):
        out = farm_routes.leftover_inputs(cfg(enabled_add_friends=True), ["a"], {}, {"a": [act("ADD_FRIEND", "SUCCESS")]})
        self.assertEqual(out, {"group_links": None, "group_keyword": None, "friend_links": None})

    def test_each_input_judged_by_its_own_scenario(self):
        config = cfg(enabled_join_groups=True, group_source="list", group_links=groups(1, 2),
                     enabled_add_friends=True, friend_source="list", friend_links=P.format(1))
        out = farm_routes.leftover_inputs(config, ["a", "b"], {}, {
            "a": [act("ADD_FRIEND", "SUCCESS", target(P.format(1), "sent")),
                  act("JOIN_GROUP", "SUCCESS", target(G.format(1), "joined"))],
            "b": [act("ADD_FRIEND", "SUCCESS"), act("JOIN_GROUP", "FAILED")],
        })
        self.assertEqual(out["friend_links"], "")
        self.assertEqual(out["group_links"], groups(2))

    def test_disabled_scenario_left_alone(self):
        config = cfg(enabled_join_groups=False, group_source="list", group_links=groups(1))
        self.assertIsNone(farm_routes.leftover_inputs(config, ["a"], {}, {"a": []})["group_links"])


class SessionLeftoverTests(unittest.TestCase):
    """Cả lượt chạy thật qua /start (worker giả): kết thúc thì status có leftover, Dừng khẩn cấp thì giữ nguyên."""

    def run_session(self, stop=False):
        config = cfg(enabled_join_groups=True, group_source="list", group_links=groups(1, 2), groups_split_enabled=False)
        req = farm_routes.FarmStartRequest(uids=["a"], threads=1, config=config)

        def worker(uid, slot, run_cfg, owner):
            with farm_routes._state_lock:
                farm_routes._history_data.setdefault(uid, {}).setdefault("actions", []).append(
                    act("JOIN_GROUP", "SUCCESS", target(G.format(1), "joined")))
                farm_routes._state["accounts"][uid]["status"] = "COMPLETED"
            if stop:
                farm_routes._control.stop()

        async def main():
            await farm_routes.start_farm_interactions(req, Mock())
            await farm_routes._active_task

        account = {"uid": "a", "status": "live", "login_status": "logged_in", "profile_name": "Nick A"}
        with patch.object(farm_routes.adapters, "owner_from_request", return_value=None),                 patch.object(farm_routes.adapters, "get_accounts", return_value={"a": account}),                 patch.object(farm_routes.adapters, "get_machine_id", return_value="m1"),                 patch.object(farm_routes.adapters, "list_owner_accounts", return_value={}),                 patch.object(farm_routes, "_release_gone_owners", return_value=[]),                 patch.object(farm_routes, "_assign_targets", return_value=({"a": {}}, [])),                 patch.object(farm_routes.repository, "create_runs", return_value={"a": 1}),                 patch.object(farm_routes, "_history_checkpoint_alerts", return_value=[]),                 patch.object(farm_routes, "_farm_worker", side_effect=worker),                 patch.object(farm_routes, "_finalize"), patch.object(farm_routes, "_emit"):
            asyncio.run(main())
        snap = farm_routes._snapshot()
        self.assertFalse(snap["running"])
        return snap["leftover"]

    def test_finished_session_reports_leftover(self):
        self.assertEqual(self.run_session()["group_links"], "")

    def test_emergency_stop_keeps_inputs(self):
        self.assertIsNone(self.run_session(stop=True))


if __name__ == "__main__":
    unittest.main()
