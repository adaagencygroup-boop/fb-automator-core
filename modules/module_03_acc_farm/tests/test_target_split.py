"""Chia đích cho các nick (mỗi nhóm / người chỉ thuộc 1 nick trong dàn): chia link / từ khóa, giành chủ, chép chủ từ log."""
import json
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

from modules.module_03_acc_farm import repository
from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.farming import flow as farming_flow

FLOW = "modules.module_03_acc_farm.farming.flow"


def items(*names):
    return [{"key": f"group:{n}", "url": f"https://www.facebook.com/groups/{n}/", "source": f"fb.com/groups/{n}"}
            for n in names]


class FakeOwners:
    """Giống routes.TargetOwners nhưng ghi lại lời gọi; owned: key -> uid chủ (nick khác)."""
    keys = staticmethod(farm_routes.TargetOwners.keys)

    def __init__(self, owned=None, enforce=True):
        self.owned, self.enforce = dict(owned or {}), enforce
        self.calls = []

    def claim(self, keys, name=None, url=None):
        self.calls.append(("claim", sorted(keys)))
        other = next((self.owned[k] for k in keys if k in self.owned), None)
        return other if self.enforce else None

    def settle(self, keys, status, name=None, url=None):
        self.calls.append(("settle", sorted(keys), status))

    def release(self, keys):
        self.calls.append(("release", sorted(keys)))

    def record(self, keys, status, name=None, url=None):
        self.calls.append(("record", sorted(keys), status))


class SplitLinksTests(unittest.TestCase):
    def test_each_link_goes_to_exactly_one_nick_evenly(self):
        links = items(*map(str, range(20)))
        parts, dropped = farm_routes.split_links(links, ["a", "b", "c", "d", "e"], {})
        self.assertEqual(dropped, 0)
        self.assertEqual(sorted(len(v) for v in parts.values()), [4, 4, 4, 4, 4])
        keys = [link["key"] for v in parts.values() for link in v]
        self.assertEqual(sorted(keys), sorted(link["key"] for link in links))

    def test_uneven_split_differs_by_at_most_one(self):
        parts, _ = farm_routes.split_links(items(*map(str, range(7))), ["a", "b", "c"], {})
        sizes = sorted(len(v) for v in parts.values())
        self.assertEqual((sum(sizes), sizes[-1] - sizes[0] <= 1), (7, True))

    def test_owned_links_go_to_owner_or_are_dropped(self):
        links = items("1", "2", "3", "4")
        owners = {"group:1": "b", "group:2": "zzz"}  # zzz: nick khác của dàn, không chạy lượt này
        parts, dropped = farm_routes.split_links(links, ["a", "b"], owners)
        self.assertEqual(dropped, 1)
        self.assertIn("group:1", [link["key"] for link in parts["b"]])
        self.assertNotIn("group:2", [link["key"] for v in parts.values() for link in v])
        self.assertEqual(sum(len(v) for v in parts.values()), 3)

    def test_fewer_links_than_nicks(self):
        parts, _ = farm_routes.split_links(items("1"), ["a", "b", "c"], {})
        self.assertEqual(sorted(len(v) for v in parts.values()), [0, 0, 1])


class SplitKeywordsTests(unittest.TestCase):
    def test_disjoint_when_enough_keywords(self):
        parts = farm_routes.split_keywords(["k1", "k2", "k3", "k4", "k5"], ["a", "b"])
        words = [w for v in parts.values() for w in v]
        self.assertEqual(sorted(words), ["k1", "k2", "k3", "k4", "k5"])
        self.assertTrue(all(parts.values()))

    def test_one_keyword_each_when_fewer_keywords(self):
        parts = farm_routes.split_keywords(["k1", "k2"], ["a", "b", "c", "d"])
        self.assertTrue(all(len(v) == 1 for v in parts.values()))
        self.assertEqual({v[0] for v in parts.values()}, {"k1", "k2"})

    def test_no_keyword(self):
        self.assertEqual(farm_routes.split_keywords([], ["a"]), {"a": []})


class AssignAndPlanTests(unittest.TestCase):
    def cfg(self, **kw):
        base = dict(enabled_join_groups=True, group_source="list",
                    group_links="\n".join(f"fb.com/groups/{i}" for i in range(6)),
                    enabled_add_friends=True, friend_source="list",
                    friend_links="fb.com/profile.php?id=1\nfb.com/profile.php?id=2")
        base.update(kw)
        return farm_routes._normalize_config(farm_routes.FarmScenarioConfig(**base))

    def test_assign_list_modes(self):
        with patch.object(repository, "target_owners", return_value={"group:0": "outsider"}) as owners:
            assigned, notes = farm_routes._assign_targets(self.cfg(), ["a", "b"], "owner:binh")
        self.assertEqual(owners.call_args_list[0].args[0], "owner:binh")
        groups = [link["key"] for uid in "ab" for link in assigned[uid]["group_links"]]
        self.assertEqual(sorted(groups), [f"group:{i}" for i in range(1, 6)])
        self.assertEqual(sorted(len(assigned[u]["friend_links"]) for u in "ab"), [1, 1])
        self.assertIn("bỏ 1 link đã thuộc nick khác", notes[0])

    def test_split_off_assigns_nothing(self):
        cfg = self.cfg(groups_split_enabled=False, friends_split_enabled=False)
        with patch.object(repository, "target_owners") as owners:
            assigned, notes = farm_routes._assign_targets(cfg, ["a"], "owner:binh")
        owners.assert_not_called()
        self.assertEqual((assigned, notes), ({"a": {}}, []))
        plan = dict(farm_routes._build_plan(cfg, assigned["a"]))
        self.assertEqual(len(plan["JOIN_GROUP"]["links"]), 6)  # bỏ tick chia: mỗi nick cả danh sách

    def test_assign_keywords(self):
        cfg = self.cfg(group_source="keyword", group_keyword="a, b, c", enabled_add_friends=False)
        assigned, notes = farm_routes._assign_targets(cfg, ["x", "y", "z"], "owner:binh")
        self.assertEqual(sorted(w for v in assigned.values() for w in v["group_keywords"]), ["a", "b", "c"])
        plan = dict(farm_routes._build_plan(cfg, assigned["x"]))
        self.assertEqual(plan["JOIN_GROUP"]["keywords"], assigned["x"]["group_keywords"])
        self.assertIn("Chia từ khóa", notes[0])

    def test_plan_uses_assigned_links(self):
        share = {"group_links": items("9"), "friend_links": []}
        plan = dict(farm_routes._build_plan(self.cfg(), share))
        self.assertEqual([link["key"] for link in plan["JOIN_GROUP"]["links"]], ["group:9"])
        self.assertEqual(plan["ADD_FRIEND"]["links"], [])

    def test_empty_share_is_skipped_without_opening_browser(self):
        cfg = self.cfg()
        with patch.object(farm_routes, "_apply_daily_limit", return_value=(10, 0, 0)), \
                patch.object(farm_routes, "run_join_groups_from_links") as run:
            result = farm_routes._run_action(Mock(), Mock(), "a", "JOIN_GROUP", {"target": 10, "links": []}, cfg, Mock())
        run.assert_not_called()
        self.assertEqual(result["status"], "SKIPPED")
        self.assertIn("Không có link nào được chia", result["details"])


class TargetOwnersTests(unittest.TestCase):
    def test_keys_dedupe_and_skip_invalid(self):
        keys = farm_routes.TargetOwners.keys("fb.com/groups/123", "https://www.facebook.com/groups/123/", None,
                                             "not a link", "https://www.facebook.com/groups/Ten.Nhom/")
        self.assertEqual(keys, ["group:123", "group:ten.nhom"])

    def test_claim_not_enforced_never_blocks(self):
        owners = farm_routes.TargetOwners("owner:binh", "a", "group", enforce=False)
        with patch.object(repository, "claim_target", return_value="b") as claim:
            self.assertIsNone(owners.claim(["group:1"]))
        self.assertFalse(claim.call_args.kwargs["exclusive"])

    def test_claim_enforced_returns_other_owner(self):
        owners = farm_routes.TargetOwners("owner:binh", "a", "group", enforce=True)
        with patch.object(repository, "claim_target", return_value="b"):
            self.assertEqual(owners.claim(["group:1"]), "b")

    def test_db_error_raises_only_when_enforced(self):
        with patch.object(repository, "claim_target", side_effect=Exception("offline")):
            with self.assertRaises(RuntimeError):
                farm_routes.TargetOwners("s", "a", "group", True).claim(["group:1"])
            self.assertIsNone(farm_routes.TargetOwners("s", "a", "group", False).claim(["group:1"]))

    def test_settle_left_keeps_owner(self):
        owners = Mock()
        farm_routes._settle_left(owners, [{"url": "https://www.facebook.com/groups/1/", "result": "left"},
                                          {"url": "https://www.facebook.com/groups/2/", "result": "skipped_last_admin"}])
        owners.settle.assert_called_once_with(["group:1"], "left")


class FakeCursor:
    def __init__(self, owners):
        self.owners, self.executed, self.last = owners, [], None

    def execute(self, query, params):
        self.executed.append((" ".join(query.split())[:30], params))
        if query.lstrip().startswith("SELECT"):
            keys = params[1:]
            self.last = [{"fb_uid": self.owners.get(k, "a")} for k in keys]

    def fetchall(self):
        return self.last


class ClaimTargetTests(unittest.TestCase):
    def run_claim(self, owners, exclusive=True):
        cursor = FakeCursor(owners)
        state = {}

        @contextmanager
        def session():
            try:
                yield cursor
                state["result"] = "commit"
            except Exception:
                state["result"] = "rollback"
                raise

        with patch.object(repository.db, "session", side_effect=session), \
                patch.object(repository, "_q", side_effect=lambda q: q):
            other = repository.claim_target("owner:binh", "a", "group", ["group:z", "group:b"], "claimed",
                                            exclusive=exclusive)
        return other, cursor, state["result"]

    def test_free_target_is_committed_in_sorted_order(self):
        other, cursor, result = self.run_claim({})
        self.assertEqual((other, result), (None, "commit"))
        inserted = [p[2] for q, p in cursor.executed if q.startswith("INSERT")]
        self.assertEqual(inserted, ["group:b", "group:z"])

    def test_alias_owned_by_other_rolls_back(self):
        other, _, result = self.run_claim({"group:z": "b"})
        self.assertEqual((other, result), ("b", "rollback"))

    def test_not_exclusive_skips_check(self):
        other, cursor, result = self.run_claim({"group:z": "b"}, exclusive=False)
        self.assertEqual((other, result), (None, "commit"))
        self.assertFalse(any(q.startswith("SELECT") for q, _ in cursor.executed))


class BackfillTests(unittest.TestCase):
    def test_entries_from_logs(self):
        rows = [
            {"machine_id": "m1", "owner_username": "binh", "fb_uid": "a", "action_type": "JOIN_GROUP",
             "targets": json.dumps([
                 {"url": "https://www.facebook.com/groups/1/", "status": "pending"},          # từ khóa
                 {"url": "https://www.facebook.com/groups/2/", "source_url": "fb.com/groups/2", "result": "joined"},
                 {"url": "https://www.facebook.com/groups/3/", "source_url": "fb.com/groups/3",
                  "result": "skipped_done", "reason": "vừa rời nhóm chưa đủ 7 ngày (theo lịch sử tool)"},
                 {"url": "https://www.facebook.com/groups/4/", "source_url": "fb.com/groups/4",
                  "result": "skipped_unavailable"},
             ])},
            {"machine_id": "m2", "owner_username": None, "fb_uid": "b", "action_type": "ADD_FRIEND",
             "targets": json.dumps([
                 {"url": "https://www.facebook.com/profile.php?id=7"},                          # theo gợi ý
                 {"url": "https://www.facebook.com/profile.php?id=8", "source_url": "fb.com/profile.php?id=8",
                  "result": "sent"},
             ])},
            {"machine_id": "m1", "owner_username": "binh", "fb_uid": "a", "action_type": "LEAVE_GROUP",
             "targets": json.dumps([{"url": "https://www.facebook.com/groups/2/", "result": "left"}])},
            {"machine_id": "m1", "owner_username": "binh", "fb_uid": "a", "action_type": "JOIN_GROUP",
             "targets": "không phải json"},
        ]
        entries = farm_routes._owner_backfill_entries(rows)
        self.assertEqual([(e["scope"], e["uid"], e["keys"], e["status"]) for e in entries], [
            ("owner:binh", "a", ["group:1"], "pending"),
            ("owner:binh", "a", ["group:2"], "joined"),
            ("machine:m2", "b", ["id:8"], "sent"),
            ("owner:binh", "a", ["group:2"], "left"),
        ])

    def test_backfill_skips_dead_and_deleted_nicks(self):
        entries = [{"scope": "owner:binh", "uid": u, "kind": "group", "keys": [f"group:{u}"], "status": "joined"}
                   for u in ("live", "dead", "gone", "cp")] + \
                  [{"scope": "machine:m1", "uid": "local", "kind": "group", "keys": ["group:x"], "status": "joined"}]
        accounts = {"binh": {"live": "LIVE", "dead": "DIE", "cp": "CHECKPOINT"}, None: {"local": "NEW"}}
        with patch.object(repository, "has_target_owners", return_value=False), \
                patch.object(repository, "owner_backfill_logs", return_value=[]), \
                patch.object(farm_routes, "_owner_backfill_entries", return_value=entries), \
                patch.object(farm_routes.adapters, "list_owner_accounts", side_effect=lambda owner: accounts[owner]), \
                patch.object(repository, "apply_owner_backfill", side_effect=len) as apply:
            self.assertEqual(farm_routes._backfill_target_owners(), 3)
        self.assertEqual([e["uid"] for e in apply.call_args.args[0]], ["live", "cp", "local"])

    def test_backfill_only_when_table_empty(self):
        with patch.object(repository, "has_target_owners", return_value=True), \
                patch.object(repository, "owner_backfill_logs") as logs:
            self.assertEqual(farm_routes._backfill_target_owners(), 0)
        logs.assert_not_called()


class ReleaseGoneOwnersTests(unittest.TestCase):
    def run_release(self, accounts, holders=None):
        holders = holders if holders is not None else {"live": 3, "dead": 9, "cp": 2, "deleted": 1}
        with patch.object(repository, "owner_holders", return_value=holders), \
                patch.object(repository, "delete_owner_rows", side_effect=lambda scope, uids: len(uids) * 5) as delete:
            notes = farm_routes._release_gone_owners("owner:binh", accounts)
        return notes, delete

    def test_releases_dead_and_deleted_keeps_checkpoint(self):
        notes, delete = self.run_release({"live": "LIVE", "dead": "DIE", "cp": "CHECKPOINT"})
        delete.assert_called_once_with("owner:binh", ["dead", "deleted"])
        self.assertEqual(notes[0][0], "info")
        self.assertIn("dead, deleted", notes[0][1])

    def test_read_error_releases_nothing(self):
        notes, delete = self.run_release(None)
        delete.assert_not_called()
        self.assertEqual(notes[0][0], "warning")

    def test_owner_without_nicks_releases_nothing(self):
        notes, delete = self.run_release({})
        delete.assert_not_called()
        self.assertEqual(notes, [])

    def test_nothing_to_release(self):
        notes, delete = self.run_release({"live": "LIVE"}, holders={"live": 3})
        delete.assert_not_called()
        self.assertEqual(notes, [])

    def test_db_error_is_warning_not_crash(self):
        with patch.object(repository, "owner_holders", side_effect=Exception("offline")):
            notes = farm_routes._release_gone_owners("owner:binh", {"a": "LIVE"})
        self.assertEqual(notes[0][0], "warning")

    def test_scope_owner(self):
        self.assertEqual(farm_routes._scope_owner("owner:binh"), "binh")
        self.assertIsNone(farm_routes._scope_owner("machine:abc"))


class GroupAliasTests(unittest.TestCase):
    def aliases(self, info, page_url):
        with patch(f"{FLOW}._script", return_value=info):
            return farming_flow._group_alias_urls(Mock(), page_url)

    def test_id_and_slug_of_current_group(self):
        urls = self.aliases({"id": "835892593690478", "slug": "nhatrogiarenhat"},
                            "https://www.facebook.com/groups/nhatrogiarenhat/")
        self.assertEqual(farm_routes.TargetOwners.keys(*urls), ["group:835892593690478", "group:nhatrogiarenhat"])

    def test_data_of_other_group_ignored(self):
        self.assertEqual(self.aliases({"id": "111", "slug": "khac"}, "https://www.facebook.com/groups/222/"), [])

    def test_group_without_slug(self):
        urls = self.aliases({"id": "222", "slug": "222"}, "https://www.facebook.com/groups/222/")
        self.assertEqual(urls, ["https://www.facebook.com/groups/222/"])


class JoinLinksOwnersTests(unittest.TestCase):
    def run_flow(self, pages, owners, target=5):
        driver = Mock()
        driver.current_url = ""
        links = [{"key": f"group:{k}", "url": f"https://www.facebook.com/groups/{k}/", "source": f"fb.com/groups/{k}"}
                 for k in pages]
        clicks = []

        def gid():
            return driver.current_url.split("/")[-2]

        def open_link(drv, ctl, url):
            drv.current_url = url
            return True

        def find(drv, locators, root=None):
            if locators is farming_flow.FARM_GROUP["page_join_button"]:
                return ["button"] if pages[gid()] in ("join", "form") else []
            return []

        def script(drv, js, *args):
            if js is farming_flow._PAGE_NAME_JS:
                return f"Nhóm {gid()}"
            if js is farming_flow._GROUP_ALIASES_JS:
                return {"id": f"9{gid()}", "slug": gid()}
            return {"joined": "joined"}.get(pages[gid()])

        with patch(f"{FLOW}._open_link", side_effect=open_link), \
                patch(f"{FLOW}._wait_for_any", return_value=True), \
                patch(f"{FLOW}._find_visible", side_effect=find), \
                patch(f"{FLOW}._script", side_effect=script), \
                patch(f"{FLOW}._human_click", side_effect=lambda d, b: clicks.append(gid()) or True), \
                patch(f"{FLOW}.check_account_state", return_value=None), \
                patch(f"{FLOW}._close_dialogs"), \
                patch(f"{FLOW}._handle_group_dialog", side_effect=lambda d: "skipped" if pages[gid()] == "form" else "none"), \
                patch(f"{FLOW}._pause_between"):
            result = farming_flow.run_join_groups_from_links(driver, Mock(), links, target, Mock(), owners=owners)
        return result, clicks

    def test_group_owned_by_other_nick_not_clicked(self):
        # Nhóm b được nick khác vào bằng ID số (9b), danh sách dán tên rút gọn: vẫn nhận ra là cùng nhóm
        owners = FakeOwners({"group:9b": "nick2"})
        result, clicks = self.run_flow({"a": "join", "b": "join", "c": "joined", "d": "form"}, owners)
        self.assertEqual(clicks, ["a", "d"])
        self.assertEqual([t["result"] for t in result["targets"]], [None, "skipped_owned", "skipped_done", "skipped_form"])
        self.assertIn("nick2", result["targets"][1]["reason"])
        self.assertIn(("settle", ["group:9a", "group:a"], "joined"), owners.calls)
        self.assertIn(("record", ["group:9c", "group:c"], "member"), owners.calls)
        self.assertIn(("release", ["group:9d", "group:d"]), owners.calls)

    def test_not_enforced_joins_owned_group(self):
        result, clicks = self.run_flow({"a": "join"}, FakeOwners({"group:a": "nick2"}, enforce=False))
        self.assertEqual((clicks, result["quantity"]), (["a"], 1))


class KeywordOwnersTests(unittest.TestCase):
    def run_flow(self, cards, owners, target=3):
        driver = Mock()
        driver.current_url = ""
        queue = [Mock(id=f"btn{i}", card=card) for i, card in enumerate(cards)]
        clicks = []

        def pick(drv, ctl, locators, clicked):
            return queue.pop(0) if queue else None

        with patch(f"{FLOW}._open"), \
                patch(f"{FLOW}._wait_for_any", return_value=True), \
                patch(f"{FLOW}._pick_button", side_effect=pick), \
                patch(f"{FLOW}._read_target", side_effect=lambda d, b, kind, token="": dict(b.card)), \
                patch(f"{FLOW}._human_click", side_effect=lambda d, b: clicks.append(b.card["name"]) or True), \
                patch(f"{FLOW}.check_account_state", return_value=None), \
                patch(f"{FLOW}._handle_group_dialog", return_value="joined"), \
                patch(f"{FLOW}._group_join_status", return_value="joined"), \
                patch(f"{FLOW}.human_scroll"), \
                patch(f"{FLOW}._pause_between"):
            result = farming_flow.run_join_groups(driver, Mock(), target, ["k"], Mock(), owners=owners)
        return result, clicks

    def test_skips_owned_and_unreadable_groups(self):
        cards = [{"name": "A", "url": "https://www.facebook.com/groups/1/"},
                 {"name": "B", "url": "https://www.facebook.com/groups/2/"},
                 {"name": "C", "url": None},
                 {"name": "D", "url": "https://www.facebook.com/groups/4/"}]
        owners = FakeOwners({"group:2": "nick2"})
        result, clicks = self.run_flow(cards, owners)
        self.assertEqual(clicks, ["A", "D"])
        self.assertIn("bỏ qua 1 nhóm đã thuộc nick khác", result["details"])
        self.assertIn("bỏ qua 1 nhóm không đọc được link", result["details"])
        self.assertIn(("settle", ["group:4"], "joined"), owners.calls)

    def test_stops_scrolling_after_many_consecutive_skips(self):
        cards = [{"name": f"G{i}", "url": f"https://www.facebook.com/groups/{i}/"} for i in range(40)]
        owners = FakeOwners({f"group:{i}": "nick2" for i in range(40)})
        result, clicks = self.run_flow(cards, owners)
        self.assertEqual(clicks, [])
        self.assertEqual(len([c for c in owners.calls if c[0] == "claim"]), farming_flow.KEYWORD_MAX_MISSES)
        self.assertEqual(result["status"], "SKIPPED")


class FriendLinksOwnersTests(unittest.TestCase):
    def test_person_owned_by_other_nick_not_invited(self):
        driver = Mock()
        driver.current_url = ""
        states = {"1": "add", "2": "add", "3": "pending"}
        links = [{"key": f"id:{k}", "url": f"https://www.facebook.com/profile.php?id={k}",
                  "source": f"fb.com/profile.php?id={k}"} for k in states]
        clicked = []

        def who():
            return driver.current_url.rsplit("=", 1)[-1]

        def open_link(drv, ctl, url):
            drv.current_url = url
            return True

        def script(drv, js, *args):
            return {"owner": f"Tên {who()}", "state": states[who()], "button": "btn" if states[who()] == "add" else None}

        owners = FakeOwners({"id:2": "nick2"})
        with patch(f"{FLOW}._open_link", side_effect=open_link), \
                patch(f"{FLOW}._wait_for_any", return_value=True), \
                patch(f"{FLOW}._find_visible", return_value=[]), \
                patch(f"{FLOW}._script", side_effect=script), \
                patch(f"{FLOW}._human_click", side_effect=lambda d, b: clicked.append(who()) or True), \
                patch(f"{FLOW}.check_account_state", return_value=None), \
                patch(f"{FLOW}._close_dialogs"), \
                patch(f"{FLOW}._pause_between"):
            result = farming_flow.run_add_friends_from_links(driver, Mock(), links, 5, Mock(), owners=owners)
        self.assertEqual(clicked, ["1"])
        self.assertEqual([t["result"] for t in result["targets"]], ["sent", "skipped_owned", "skipped_done"])
        self.assertIn(("settle", ["id:1"], "sent"), owners.calls)
        self.assertIn(("record", ["id:3"], "sent"), owners.calls)


if __name__ == "__main__":
    unittest.main()
