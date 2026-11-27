"""
Kiểm thử Module 12 không cần Postgres / Chrome / Facebook thật (DB giả, Chrome giả, JSON mẫu theo cấu trúc thật).

Chạy: python -m unittest discover -s modules/module_12_post_engagement/tests -t . -p "test_*.py"
"""
from __future__ import annotations

import base64
import json
import sys
import threading
import types
import unittest
from unittest import mock

if "core.database.connection" not in sys.modules:
    _fake_conn = types.ModuleType("core.database.connection")

    class _FakeDB:
        def fetch_one(self, *a, **k):
            return None

        def fetch_all(self, *a, **k):
            return []

        def execute(self, *a, **k):
            return None

    _fake_conn.db = _FakeDB()
    sys.modules["core.database.connection"] = _fake_conn

from modules.module_12_post_engagement import common, fb_parse, jobs, links, models, scraper  # noqa: E402


def b64(s: str) -> str:
    return base64.b64encode(s.encode()).decode()


# ---------------------------------------------------------------------------
# Link bài viết
# ---------------------------------------------------------------------------


class LinkTests(unittest.TestCase):
    def test_supported_post_links(self):
        cases = {
            "https://www.facebook.com/groups/advertisingvietnam/posts/1355670115166875/?__cft__[0]=x": ("1355670115166875", "group"),
            "facebook.com/groups/741407651747860/permalink/1209783554910265/": ("1209783554910265", "group"),
            "https://m.facebook.com/groups/741407651747860/?multi_permalinks=1209783554910265": ("1209783554910265", "group"),
            "https://www.facebook.com/zuck/posts/pfbid02GGhJR9SJdiJK7Naahzzd6hEXCge2W65zWC9QuVasrAcnG3pLgWcUmq5pkDHs8jaql":
                ("pfbid02GGhJR9SJdiJK7Naahzzd6hEXCge2W65zWC9QuVasrAcnG3pLgWcUmq5pkDHs8jaql", "page"),
            "https://www.facebook.com/permalink.php?story_fbid=123456789012&id=100001": ("123456789012", "page"),
            "https://web.facebook.com/story.php?story_fbid=987654321098&id=1": ("987654321098", "page"),
            "https://www.facebook.com/watch/?v=123456789": ("123456789", "video"),
            "https://www.facebook.com/reel/1143838754903639/?s=1": ("1143838754903639", "video"),
            "https://www.facebook.com/photo/?fbid=10118155440653191&set=pcb.1": ("10118155440653191", "photo"),
            "https://www.facebook.com/share/p/1AbCdEfGh2/": ("share:1AbCdEfGh2", "share"),
            "https://www.facebook.com/somepage/videos/555666777888/": ("555666777888", "video"),
        }
        for raw, (key, hint) in cases.items():
            info = links.parse_post_link(raw)
            self.assertIsNotNone(info, raw)
            self.assertEqual((info["post_key"], info["source_hint"]), (key, hint), raw)
            self.assertTrue(info["url"].startswith("https://www.facebook.com/"), raw)

    def test_rejects_non_post_links(self):
        for raw in ("https://www.facebook.com/groups/123/", "https://google.com/x", "facebook.com/zuck", "", "hello",
                    "https://www.facebook.com/groups/123/posts/abc/"):
            self.assertIsNone(links.parse_post_link(raw), raw)

    def test_parse_rows_dedupes_and_skips_header(self):
        rows = [
            ["STT", "Link bài viết"],
            [1, "https://www.facebook.com/groups/1/posts/1111111111/"],
            [2, "https://m.facebook.com/groups/1/permalink/1111111111/"],
            [3, "chữ linh tinh"],
            [4, "https://www.facebook.com/groups/1/"],
            "Xem bài này https://www.facebook.com/groups/2/posts/2222222222/ nhé",
        ]
        res = links.parse_link_rows(rows)
        self.assertEqual([r["status"] for r in res["rows"]], ["valid", "duplicate", "invalid", "invalid", "valid"])
        self.assertFalse(res["truncated"])
        many = [f"https://www.facebook.com/groups/1/posts/{1000000 + i}/" for i in range(5)]
        self.assertTrue(links.parse_link_rows(many, max_links=3)["truncated"])

    def test_numeric_post_id(self):
        self.assertEqual(links.numeric_post_id("pfbid0abc", "123456"), "123456")
        self.assertEqual(links.numeric_post_id("1234567"), "1234567")
        self.assertEqual(links.numeric_post_id("pfbid0abc"), "")


# ---------------------------------------------------------------------------
# Đọc JSON trang Facebook
# ---------------------------------------------------------------------------


def _story(post_id, *, text, created, actor, to=None, reactions=0, shares=0, comments=0, url=""):
    feedback = {"__typename": "Feedback", "reaction_count": {"count": reactions}, "share_count": {"count": shares},
                "comment_rendering_instance": {"comments": {"total_count": comments}}}
    story = {"__typename": "Story", "post_id": post_id, "creation_time": created, "url": url,
             "comet_sections": {"content": {"story": {"message": {"text": text}, "actors": [actor]}},
                                "feedback": {"story": {"feedback_context": {"feedback_target": feedback}}}}}
    if to:
        story["to"] = to
    return story


def _comment(cid, uid, name, text, depth=0, created=1795000000, fb_id=None, with_typename=True):
    node = {"id": b64(f"comment:999_{cid}"), "legacy_fbid": cid, "depth": depth, "body": {"text": text},
            "author": {"__typename": "User", "id": uid, "name": name, "url": f"https://www.facebook.com/{name.lower()}",
                       "profile_picture_depth_0": {"uri": f"https://cdn/{uid}.jpg"}},
            "created_time": created,
            "feedback": {"id": fb_id or b64(f"feedback:pfbid0XYZ{cid}")}}
    if with_typename:
        node["__typename"] = "Comment"
    return node


class ParseTests(unittest.TestCase):
    def test_post_meta_picks_the_right_post(self):
        other = _story("777777", text="Bài gợi ý khác", created=1, actor={"__typename": "User", "id": "9", "name": "X"},
                       reactions=5)
        main = _story("1355670115166875", text="Tuyển marketing", created=1795490940,
                      actor={"__typename": "User", "id": "100023294658429", "name": "Diễm"},
                      to={"__typename": "Group", "id": "741407651747860", "name": "TUYỂN DỤNG MARKETING - HCM"},
                      reactions=159, shares=3, comments=12)
        meta = fb_parse.post_meta([{"a": other}, {"b": main}], post_key="1355670115166875")
        self.assertEqual(meta["post_id"], "1355670115166875")
        self.assertEqual((meta["reactions"], meta["shares"], meta["comments"]), (159, 3, 12))
        self.assertEqual((meta["source_type"], meta["source_name"]), ("group", "TUYỂN DỤNG MARKETING - HCM"))
        self.assertEqual(meta["message"], "Tuyển marketing")
        self.assertEqual(meta["creation_time"], 1795490940)

    def test_post_meta_pfbid_by_url_and_page_source(self):
        page = _story("10118155444854771", text="Burger night", created=1793554070,
                      actor={"__typename": "Page", "id": "4", "name": "Meta"},
                      url="https://www.facebook.com/zuck/posts/pfbid02GGhJR9", reactions=227742, shares=6710, comments=28385)
        side = _story("1141314225170897", text="Khác", created=2, actor={"__typename": "User", "id": "1", "name": "A"})
        meta = fb_parse.post_meta([{"x": side}, {"y": page}], post_key="pfbid02GGhJR9",
                                  page_url="https://www.facebook.com/zuck/posts/pfbid02GGhJR9")
        self.assertEqual(meta["post_id"], "10118155444854771")
        self.assertEqual((meta["source_type"], meta["source_name"]), ("page", "Meta"))

    def test_html_and_response_readers(self):
        html = ('<script type="application/json" data-sjs>{"__typename":"X","post_id":"1"}</script>'
                '<script type="application/json">{"no":"relay"}</script>')
        self.assertEqual(len(fb_parse.json_blobs_from_html(html)), 1)
        texts = ['for (;;);{"a":1}', '{"b":2}\n{"c":3}\nnot json', 5]
        self.assertEqual(len(fb_parse.json_objects_from_responses(texts)), 3)

    def test_comments_roots_and_replies(self):
        root1 = _comment("111", "100001", "An", "Giá bao nhiêu ạ?")
        root2 = _comment("222", "100002", "Bình", "Inbox em")
        page_html_obj = {"comments": {"edges": [{"node": root1}, {"node": root2}]}}
        # Phản hồi "Xem 1 phản hồi": data.node = feedback của bình luận 111 (không có legacy_fbid), trả lời không có __typename
        reply = _comment("333", "100003", "Chi", "Còn hàng không", depth=1, with_typename=False)
        replies_response = {"data": {"node": {"__typename": "Feedback", "id": root1["feedback"]["id"],
                                              "replies_connection": {"edges": [{"node": reply}]}}}}
        rows = {r["comment_id"]: r for r in fb_parse.extract_comments([page_html_obj, replies_response])}
        self.assertEqual(set(rows), {"111", "222", "333"})
        self.assertEqual(rows["333"]["parent_id"], "111")
        self.assertEqual(rows["333"]["depth"], 1)
        self.assertEqual(rows["111"]["parent_id"], "")
        self.assertEqual(rows["111"]["text"], "Giá bao nhiêu ạ?")
        self.assertEqual(rows["222"]["uid"], "100002")
        self.assertEqual(rows["111"]["avatar"], "https://cdn/100001.jpg")

    def test_comment_without_numeric_author_is_skipped(self):
        bad = _comment("444", "not-a-number", "Ẩn danh", "x")
        self.assertEqual(fb_parse.extract_comments([{"n": bad}]), [])

    def test_reactors_types_paging_and_friends_only(self):
        resp = {"data": {"node": {"reactors": {
            "edges": [
                {"feedback_reaction_info": {"id": "1635855486666999"}, "node": {"__typename": "User", "id": "61555750830508",
                                                                                "name": "Nhi", "url": "https://fb/nhi"}},
                {"feedback_reaction_info": {"id": "1678524932434102"}, "node": {"__typename": "User", "id": "100048970997140",
                                                                                "name": "Như"}},
                {"feedback_reaction_info": {"id": "444813342392137"}, "node": {"__typename": "Page", "id": "123456789", "name": "P"}},
                {"feedback_reaction_info": {}, "node": {"__typename": "User", "id": "abc", "name": "bỏ"}},
            ],
            "page_info": {"has_next_page": True, "end_cursor": "c1"}}}}}
        r = fb_parse.extract_reactors([resp])
        kinds = {x["uid"]: x["reaction"] for x in r["rows"]}
        self.assertEqual(kinds, {"61555750830508": "LIKE", "100048970997140": "LOVE", "123456789": "ANGRY"})
        self.assertTrue(r["has_next"])
        self.assertFalse(r["friends_only"])
        self.assertTrue(next(x for x in r["rows"] if x["uid"] == "123456789")["is_page"])
        last = {"data": {"node": {"reaction_display_config": {"reaction_display_strategy": "USE_REACTION_SHEET_STRING_ONLY"},
                                  "reactors": {"edges": [], "page_info": {"has_next_page": False}}}}}
        r2 = fb_parse.extract_reactors([last])
        self.assertTrue(r2["friends_only"])
        self.assertEqual(r2["rows"], [])

    def test_aria_and_merge(self):
        self.assertEqual(fb_parse.reaction_from_aria("Trương Khương Liked, unseen story"), ("Trương Khương", "LIKE"))
        self.assertEqual(fb_parse.reaction_from_aria("Gia Huy Loved"), ("Gia Huy", "LOVE"))
        self.assertEqual(fb_parse.reaction_from_aria("Nguyễn Văn A"), ("Nguyễn Văn A", ""))
        merged = fb_parse.merge_reactors(
            [{"uid": "111111", "name": "JSON tên", "reaction": "WOW", "avatar": "a", "profile_url": "u", "is_page": False}],
            [{"uid": "111111", "aria": "DOM tên Liked"}, {"uid": "222222", "aria": "Chỉ DOM Cared"}, {"uid": "x", "aria": "bỏ"}],
        )
        by = {m["uid"]: m for m in merged}
        self.assertEqual(by["111111"]["reaction"], "WOW")  # JSON thắng
        self.assertEqual(by["111111"]["name"], "JSON tên")
        self.assertEqual((by["222222"]["name"], by["222222"]["reaction"]), ("Chỉ DOM", "CARE"))
        self.assertNotIn("x", by)

    def test_tier_rule(self):
        # Không tính Share (Facebook chỉ cho xem tổng số): Like + bình luận → 1, chỉ 1 trong 2 → 2
        self.assertEqual(fb_parse.tier_of(True, True), 1)
        self.assertEqual(fb_parse.tier_of(True, False), 2)
        self.assertEqual(fb_parse.tier_of(False, True), 2)
        self.assertIsNone(fb_parse.tier_of(False, False))


# ---------------------------------------------------------------------------
# Thao tác Chrome (driver giả)
# ---------------------------------------------------------------------------


class ReactionTotalTests(unittest.TestCase):
    def test_total_uses_reactors_not_like_only(self):
        # Ảnh/bài HIDE_COUNTS: i18n_reaction_count trong top_reactions là số của 1 loại (Like=27), tổng thật = reactors.count
        fb = {"feedback": {"id": "x", "reactors": {"count": 47},
                           "top_reactions": {"edges": [
                               {"node": {"id": "1635855486666999"}, "i18n_reaction_count": "27", "reaction_count": 27},
                               {"node": {"id": "1678524932434102"}, "i18n_reaction_count": "15", "reaction_count": 15}]}}}
        self.assertEqual(fb_parse._reaction_total(fb["feedback"]), 47)

    def test_total_sums_top_reactions(self):
        fb = {"top_reactions": {"edges": [{"node": {"id": "1"}, "reaction_count": 27},
                                          {"node": {"id": "2"}, "reaction_count": 15},
                                          {"node": {"id": "3"}, "reaction_count": 4},
                                          {"node": {"id": "4"}, "reaction_count": 1}]}}
        self.assertEqual(fb_parse._reaction_total(fb), 47)

    def test_edge_i18n_not_taken_as_total(self):
        self.assertIsNone(fb_parse._reaction_total({"node": {"id": "1"}, "i18n_reaction_count": "27"}))


class ReplyLinkTests(unittest.TestCase):
    @staticmethod
    def _b64(x):
        return base64.b64encode(x.encode()).decode()

    def test_reply_parent_found_from_earlier_response_and_other_post_tagged(self):
        fbid = self._b64("feedback:pfbidPARENT")
        first = {"node": {"__typename": "Comment", "id": self._b64("comment:900_11"), "legacy_fbid": "11", "depth": 0,
                          "author": {"id": "1", "name": "A"}, "body": {"text": "goc"}, "feedback": {"id": fbid}}}
        later = {"data": {"node": {"__typename": "Feedback", "id": fbid, "replies_connection": {"edges": [
            {"node": {"id": self._b64("comment:900_12"), "legacy_fbid": "12", "depth": 1,
                      "author": {"id": "2", "name": "B"}, "body": {"text": "tra loi"}}}]}}}}
        ctx = {}
        c1 = fb_parse.extract_comments([first], ctx)
        self.assertEqual(c1[0]["post_id"], "900")
        c2 = fb_parse.extract_comments([later], ctx)
        self.assertEqual((c2[0]["comment_id"], c2[0]["parent_id"]), ("12", "11"))
        self.assertEqual(fb_parse.extract_comments([later])[0]["parent_id"], "")  # không có ctx thì không biết cha


class FakeDriver:
    """Driver giả cho vòng cuộn: mỗi lượt cuộn 'tải' thêm một trang dữ liệu đã chuẩn bị sẵn."""

    def __init__(self, pages, *, dom_rows=None, page_state=None, heights=None):
        self.pages = list(pages)        # mỗi phần tử: list phản hồi GraphQL (chuỗi) trả về ở lượt đó
        self.dom_rows = dom_rows or []
        self.state = page_state or {"tabs": 8, "ready": "complete", "dialogs": 2, "articles": 3}
        self.heights = list(heights or [])
        self.page_source = "<html></html>"
        self.visited = []
        self.clicked = 0
        self._buffer = []
        self._loaded = 0

    def get(self, url):
        self.visited.append(url)
        if self.pages:
            self._buffer.extend(self.pages.pop(0))

    def execute_script(self, js, *args):
        if js == scraper.DRAIN_JS:
            out, self._buffer = self._buffer, []
            return out
        if js == scraper.PAGE_STATE_JS:
            return dict(self.state)
        if js == scraper.DOM_REACTORS_JS:
            return {"rows": self.dom_rows, "friendsOnly": False, "height": 100}
        if js in (scraper.SCROLL_REACTORS_JS, scraper.SCROLL_COMMENTS_JS):
            if self.pages:
                self._buffer.extend(self.pages.pop(0))
                self._loaded += 1
                return 100 * (self._loaded + 1)
            return 100 * (self._loaded + 1)
        if js == scraper.EXPAND_COMMENTS_JS:
            return 0
        if js == scraper.OPEN_SORT_JS:
            return "already"
        return None


def _reactor_page(start, n, has_next=True):
    edges = [{"feedback_reaction_info": {"id": "1635855486666999"},
              "node": {"__typename": "User", "id": str(100000 + i), "name": f"U{i}"}} for i in range(start, start + n)]
    return json.dumps({"data": {"node": {"reactors": {"edges": edges, "page_info": {"has_next_page": has_next}}}}})


class ScraperLoopTests(unittest.TestCase):
    def run_reactions(self, pages, quota, known=None):
        got = []
        drv = FakeDriver(pages)
        res = scraper.collect_reactions(drv, "1355670115166875", quota, on_batch=got.extend, tick=lambda: False,
                                        pause=lambda: False, known=known, sleep=lambda s: None)
        return res, got, drv

    def test_scrolls_until_facebook_says_no_more(self):
        pages = [[_reactor_page(0, 10)], [_reactor_page(10, 10)], [_reactor_page(20, 7, has_next=False)]]
        res, got, drv = self.run_reactions(pages, 1000)
        self.assertEqual(len(got), 27)
        self.assertEqual(res["reason"], "end")
        self.assertIn("ufi/reaction/profile/browser/?ft_ent_identifier=1355670115166875", drv.visited[0])

    def test_stops_at_quota_and_skips_known(self):
        pages = [[_reactor_page(0, 10)], [_reactor_page(10, 10)], [_reactor_page(20, 10)]]
        res, got, _ = self.run_reactions(pages, 15, known={"100000", "100001"})
        self.assertEqual(len(got), 15)
        self.assertNotIn("100000", {g["uid"] for g in got})
        self.assertEqual(res["reason"], "quota")

    def test_idle_rounds_end_the_loop(self):
        res, got, _ = self.run_reactions([[_reactor_page(0, 5)]], 1000)
        self.assertEqual(len(got), 5)
        self.assertEqual(res["reason"], "end")

    def test_account_problem_is_raised(self):
        drv = FakeDriver([[]], page_state={"checkpoint": True, "tabs": 0})
        with self.assertRaises(scraper.AccountProblem):
            scraper.collect_reactions(drv, "1", 10, on_batch=lambda r: None, tick=lambda: False, pause=lambda: False,
                                      sleep=lambda s: None)

    def test_comments_loop_collects_all_pages(self):
        def page(ids):
            return [json.dumps({"data": {"node": {"comments": {"edges": [{"node": _comment(c, "1000" + c, f"N{c}", f"t{c}")}
                                                                          for c in ids]}}}})]
        drv = FakeDriver([page(["111", "112"]), page(["113"])])
        got = []
        res = scraper.collect_comments(drv, 100, on_batch=got.extend, tick=lambda: False, pause=lambda: False,
                                       sleep=lambda s: None)
        self.assertEqual(sorted(c["comment_id"] for c in got), ["111", "112", "113"])
        self.assertEqual(res["reason"], "end")

    def test_stop_button_interrupts(self):
        res, got, _ = (lambda: (scraper.collect_reactions(FakeDriver([[_reactor_page(0, 10)]]), "1", 100, on_batch=lambda r: None,
                                                          tick=lambda: True, pause=lambda: False, sleep=lambda s: None), [], None))()
        self.assertEqual(res["reason"], "stopped")


class SafetyTests(unittest.TestCase):
    """Không bao giờ bấm nút Thích / Chia sẻ / Bình luận: chỉ JS cuộn và nút "Xem…" khớp mẫu."""

    def test_expand_js_excludes_interaction_buttons(self):
        js = scraper.EXPAND_COMMENTS_JS
        for word in ("react", "like", "share", "comment", "thích", "chia sẻ", "bình luận"):
            self.assertIn(word, js.lower())
        self.assertIn("dataset.peClicked", js)
        self.assertNotIn("toolbar", scraper.SCROLL_REACTORS_JS)
        self.assertNotIn(".click()", scraper.SCROLL_REACTORS_JS + scraper.DOM_REACTORS_JS + scraper.SCROLL_COMMENTS_JS)


# ---------------------------------------------------------------------------
# Lưu DB: phân tầng, nâng hạng, tìm kiếm
# ---------------------------------------------------------------------------


class RecordingDB:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((" ".join(sql.split()), params))

    def fetch_all(self, sql, params=()):
        return []

    def fetch_one(self, sql, params=()):
        return {"likes": 0, "shares": 0, "comments": 0, "c": 0, "n": 0}


class ModelTests(unittest.TestCase):
    def test_fold_strips_vietnamese_marks(self):
        self.assertEqual(models.fold("  Phú   Thọ Đẹp "), "phu tho dep")

    def test_save_users_upgrades_tier_on_conflict(self):
        rec = RecordingDB()
        with mock.patch.object(models, "db", rec):
            n = models.save_users("alice", "123", [{"uid": "100001", "name": "An"}, {"uid": "100001", "name": "An"},
                                                   {"uid": "x"}], action="like")
        self.assertEqual(n, 1)
        sql, params = rec.calls[0]
        self.assertIn("ON CONFLICT (owner_username, post_key, uid) DO UPDATE", sql)
        self.assertIn("has_like = pe_users.has_like OR EXCLUDED.has_like", sql)
        self.assertIn("THEN 1 ELSE 2 END", sql)
        self.assertNotIn("has_share OR EXCLUDED.has_share)::int", sql)
        self.assertEqual(sql.count("?"), len(params))
        self.assertIn(True, params)  # cờ has_like

    def test_save_comments_flags_authors_with_earliest_time(self):
        rec = RecordingDB()
        comments = [
            {"comment_id": "1", "uid": "100001", "name": "An", "text": "a", "created_time": 200},
            {"comment_id": "2", "uid": "100001", "name": "An", "text": "b", "created_time": 100},
            {"comment_id": "3", "uid": "100002", "name": "Bình", "text": "c", "parent_id": "1", "depth": 1},
        ]
        with mock.patch.object(models, "db", rec):
            self.assertEqual(models.save_comments("alice", "123", comments), 3)
        comment_sql = rec.calls[0]
        self.assertIn("INSERT INTO pe_comments", comment_sql[0])
        self.assertEqual(comment_sql[0].count("?"), len(comment_sql[1]))
        user_sql = rec.calls[1]
        self.assertIn("INSERT INTO pe_users", user_sql[0])
        self.assertIn(models.utc_from_epoch(100), user_sql[1])  # thời gian bình luận sớm nhất của An

    def test_share_action_is_not_saved(self):
        rec = RecordingDB()
        with mock.patch.object(models, "db", rec):
            self.assertEqual(models.save_users("alice", "123", [{"uid": "100001"}], action="share"), 0)
        self.assertEqual(rec.calls, [])

    def test_no_share_tab(self):
        self.assertEqual(models.TABS, ("like", "comment"))
        self.assertEqual(models.TIERS, (1, 2))

    def test_no_owner_writes_nothing(self):
        rec = RecordingDB()
        with mock.patch.object(models, "db", rec):
            self.assertEqual(models.save_users("", "1", [{"uid": "1"}], action="like"), 0)
            self.assertEqual(models.save_comments(None, "1", [{"comment_id": "1", "uid": "1"}]), 0)
        self.assertEqual(rec.calls, [])

    def test_resume_remaining(self):
        state = {"request": {"posts": [
            {"post_key": "a", "post_url": "u1", "like_quota": 100, "comment_quota": 50, "share_quota": 0},
            {"post_key": "b", "post_url": "u2", "like_quota": 100, "comment_quota": 0, "share_quota": 0},
            {"post_key": "c", "post_url": "u3", "like_quota": 10, "comment_quota": 0, "share_quota": 0},
        ]}, "progress": {"a": {"likes": 30, "comments": 50}, "b": {"done": True}, "c": {"likes": 10}}}
        left = models.resume_remaining(state)
        self.assertEqual([(p["post_key"], p["like_quota"], p["comment_quota"]) for p in left], [("a", 70, 0)])


# ---------------------------------------------------------------------------
# Điều phối job: song song, chia đều, nhường bài khi nick hỏng
# ---------------------------------------------------------------------------


class JobTests(unittest.TestCase):
    def setUp(self):
        jobs._jobs.clear()
        self.opened = []
        p1 = mock.patch.object(jobs, "BROWSER_STAGGER_SEC", 0)
        p2 = mock.patch.object(jobs, "_spawn", lambda job_id: None)
        p3 = mock.patch.object(jobs, "_finish_session", lambda job_id, final: None)
        p4 = mock.patch.object(jobs, "_save_resume", lambda job_id, force=False: None)
        for p in (p1, p2, p3, p4):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(jobs._jobs.clear)

    def fake_open(self, pool, start, **kw):
        uid = pool[0]
        self.opened.append(uid)
        return {"driver": object(), "lock": None, "uid": uid}

    def test_normalize_targets(self):
        t = jobs.normalize_targets([
            {"post_url": "https://www.facebook.com/groups/1/posts/1111111111/", "like_quota": 99999, "comment_quota": "5"},
            "https://www.facebook.com/groups/1/permalink/1111111111/",
            "https://google.com",
            {"post_url": "https://www.facebook.com/groups/2/posts/2222222222/"},
        ])
        self.assertEqual([x["post_key"] for x in t], ["1111111111", "2222222222"])
        self.assertEqual((t[0]["like_quota"], t[0]["comment_quota"]), (10000, 5))
        self.assertNotIn("share_quota", t[0])

    def test_start_validation(self):
        with self.assertRaises(ValueError):
            jobs.start_check("alice", [], ["https://www.facebook.com/groups/1/posts/1111111111/"])
        with self.assertRaises(ValueError):
            jobs.start_check("alice", ["1"], ["https://google.com"])
        with self.assertRaises(ValueError):
            jobs.start_check("alice", ["1"], [f"https://www.facebook.com/groups/1/posts/{1000000 + i}/" for i in range(21)])
        with self.assertRaises(ValueError):
            jobs.start_scan("alice", ["1"], [{"post_url": "https://www.facebook.com/groups/1/posts/1111111111/",
                                              "like_quota": 0, "comment_quota": 0, "share_quota": 0}])

    def test_scan_delay_floor_and_swap(self):
        with mock.patch.object(models, "create_session", lambda *a, **k: None), \
                mock.patch.object(models, "save_resume_state", lambda *a, **k: None):
            res = jobs.start_scan("alice", ["1"], [{"post_url": "https://www.facebook.com/groups/1/posts/1111111111/",
                                                     "like_quota": 5}], delay_min=20, delay_max=1)
        self.assertEqual((res["delay_min"], res["delay_max"]), (3.0, 20.0))

    def test_scan_delay_ceiling(self):
        """Min và Max tối đa 120 giây (giống giao diện)."""
        with mock.patch.object(models, "create_session", lambda *a, **k: None), \
                mock.patch.object(models, "save_resume_state", lambda *a, **k: None):
            res = jobs.start_scan("alice", ["1"], [{"post_url": "https://www.facebook.com/groups/1/posts/1111111111/",
                                                     "like_quota": 5}], delay_min=500, delay_max=3600)
        self.assertEqual((res["delay_min"], res["delay_max"]), (120.0, 120.0))

    def test_parallel_split_and_account_handoff(self):
        posts = [f"https://www.facebook.com/groups/1/posts/{1000000 + i}/" for i in range(5)]
        done_by = {}
        lock = threading.Lock()

        def fake_check(job_id, session, idx, post, total):
            if session["uid"] == "bad":
                raise scraper.AccountProblem("Nick bị checkpoint")
            with lock:
                done_by[post["post_key"]] = session["uid"]
            jobs._progress(job_id, post["post_key"], status="done")

        with mock.patch.object(jobs, "open_account_session", self.fake_open), \
                mock.patch.object(jobs, "close_account_session", lambda s: None), \
                mock.patch.object(jobs.scraper, "install_capture", lambda d: None), \
                mock.patch.object(jobs, "_check_one", fake_check):
            res = jobs.start_check("alice", ["bad", "ok1", "ok2"], posts)
            jobs._body(res["job_id"])
        status = jobs.get_status(res["job_id"], "alice")
        self.assertEqual(status["status"], "done")
        self.assertEqual(set(done_by), {p.split("/")[-2] for p in posts})
        self.assertNotIn("bad", done_by.values())
        self.assertIn("ok2", self.opened)  # nick dự phòng thay nick bị checkpoint
        self.assertTrue(any("Nhường bài" in l["message"] for l in status["logs"]))
        self.assertIsNone(jobs.get_status(res["job_id"], "bob"))  # người khác không xem được

    def test_all_accounts_dead_aborts_with_message(self):
        def always_bad(job_id, session, idx, post, total):
            raise scraper.AccountProblem("Nick bị chặn tạm thời")

        with mock.patch.object(jobs, "open_account_session", self.fake_open), \
                mock.patch.object(jobs, "close_account_session", lambda s: None), \
                mock.patch.object(jobs.scraper, "install_capture", lambda d: None), \
                mock.patch.object(jobs, "_check_one", always_bad):
            res = jobs.start_check("alice", ["a", "b"], ["https://www.facebook.com/groups/1/posts/1111111111/"])
            jobs._body(res["job_id"])
        st = jobs.get_status(res["job_id"], "alice")
        self.assertEqual(st["status"], "aborted")
        self.assertIn("hết tài khoản Live khả dụng", st["error"])

    def test_item_error_does_not_kill_worker(self):
        posts = [f"https://www.facebook.com/groups/1/posts/{2000000 + i}/" for i in range(3)]

        def flaky(job_id, session, idx, post, total):
            if idx == 0:
                raise RuntimeError("trang lạ")
            jobs._progress(job_id, post["post_key"], status="done")

        with mock.patch.object(jobs, "open_account_session", self.fake_open), \
                mock.patch.object(jobs, "close_account_session", lambda s: None), \
                mock.patch.object(jobs.scraper, "install_capture", lambda d: None), \
                mock.patch.object(jobs, "_check_one", flaky):
            res = jobs.start_check("alice", ["a"], posts)
            jobs._body(res["job_id"])
        st = jobs.get_status(res["job_id"], "alice")
        # Bài lỗi là chưa xong → phiên "dừng giữa chừng" (Chạy tiếp được), không báo Thành công
        self.assertEqual(st["status"], "aborted")
        self.assertIn("1 bài lỗi", st["error"])
        self.assertEqual(sorted(v["status"] for v in st["progress"].values()), ["done", "done", "error"])

    def test_control_and_active(self):
        res = jobs.start_check("alice", ["a"], ["https://www.facebook.com/groups/1/posts/1111111111/"])
        jid = res["job_id"]
        self.assertEqual(jobs.get_active("alice", "check"), jid)
        self.assertIsNone(jobs.get_active("bob", "check"))
        self.assertFalse(jobs.set_control(jid, "pause", "bob"))
        self.assertTrue(jobs.set_control(jid, "pause", "alice"))
        self.assertEqual(jobs.get_status(jid, "alice")["status"], "paused")
        self.assertTrue(jobs.set_control(jid, "abort", "alice"))
        self.assertFalse(jobs.set_control(jid, "bogus", "alice"))


class CommonTests(unittest.TestCase):
    def test_fair_queue_splits_evenly(self):
        q = common.FairQueue(range(5), 2)
        a = [q.take(0), q.take(1)]
        b = [q.take(0), q.take(1)]
        self.assertEqual((len(a), len(b)), (2, 2))
        self.assertIsNotNone(q.take(2, wait=False))  # phần dư cho luồng xong trước
        self.assertIsNone(q.take(3, wait=False))

    def test_browser_dead_detection(self):
        self.assertTrue(common.is_browser_dead_error(Exception("invalid session id")))
        self.assertFalse(common.is_browser_dead_error(Exception("element not found")))


if __name__ == "__main__":
    unittest.main()


class LoopDriver(FakeDriver):
    """Trang cứ đổi chiều cao / còn nút "xem thêm" mà không ra dữ liệu mới (reel treo 14 phút)."""

    def __init__(self, pages, **kw):
        super().__init__(pages, **kw)
        self.h = 0

    def execute_script(self, js, *args):
        if js in (scraper.SCROLL_REACTORS_JS, scraper.SCROLL_COMMENTS_JS):
            if self.pages:
                self._buffer.extend(self.pages.pop(0))
            self.h += 100
            return self.h
        if js == scraper.EXPAND_COMMENTS_JS:
            return 1
        return super().execute_script(js, *args)


def _comments_page(rows):
    """rows: [(comment_id, post_id)] → 1 phản hồi GraphQL. Mã bài nằm trong id bình luận "comment:<bài>_<bình luận>"."""
    def node(cid, pid):
        n = _comment(cid, "1000" + cid, f"N{cid}", f"t{cid}")
        n["id"] = b64(f"comment:{pid}_{cid}" if pid else f"comment:{cid}")
        return n
    return [json.dumps({"data": {"node": {"comments": {"edges": [{"node": node(cid, pid)} for cid, pid in rows]}}}})]


class FixTests(unittest.TestCase):
    """12 lỗi sửa đợt 2026-11-25."""

    # A — chống treo theo SỐ VÒNG không có dữ liệu mới (không theo giây)
    def test_comments_stall_after_rounds_without_new_data(self):
        drv = LoopDriver([_comments_page([("111", "")])])
        got, pauses = [], []
        res = scraper.collect_comments(drv, 0, on_batch=got.extend, tick=lambda: False,
                                       pause=lambda: pauses.append(1) or False, sleep=lambda s: None, stall_rounds=5)
        self.assertEqual(res["reason"], "stalled")
        self.assertEqual(len(got), 1)
        self.assertLessEqual(len(pauses), 6)

    def test_reactions_stall_after_rounds_without_new_data(self):
        drv = LoopDriver([[_reactor_page(0, 3)]])
        res = scraper.collect_reactions(drv, "1", 0, on_batch=lambda r: None, tick=lambda: False, pause=lambda: False,
                                        sleep=lambda s: None, stall_rounds=5)
        self.assertEqual(res["reason"], "stalled")

    def test_stall_counter_ignores_pause_time(self):
        # Tạm dừng / nghỉ dài (pause chạy lâu) không làm dừng sớm: vẫn phải đủ số vòng
        import time as _t
        drv = LoopDriver([_comments_page([("111", "")])])
        clock = {"t": 0.0}
        with mock.patch.object(_t, "monotonic", lambda: clock["t"]):
            def long_pause():
                clock["t"] += 3600  # mỗi lần nghỉ 1 giờ
                return False
            res = scraper.collect_comments(drv, 0, on_batch=lambda r: None, tick=lambda: False, pause=long_pause,
                                           sleep=lambda s: None, stall_rounds=5)
        self.assertEqual(res["reason"], "stalled")

    # 7 — đã biết mã bài thì chỉ giữ bình luận đúng mã; bình luận bài bên cạnh không lọt vào
    def test_comments_keep_only_known_post(self):
        drv = FakeDriver([_comments_page([("1", "OTHER"), ("2", "OTHER")]), _comments_page([("3", "TARGET"), ("4", "OTHER")])])
        got = []
        scraper.collect_comments(drv, 0, on_batch=got.extend, tick=lambda: False, pause=lambda: False,
                                 sleep=lambda s: None, post_id="TARGET")
        self.assertEqual([c["comment_id"] for c in got], ["3"])

    def test_comments_fallback_to_majority_when_known_id_never_seen(self):
        # Trang ảnh có thể dùng mã khác mã bài → hết trang mà không thấy mã bài thì lấy bài chiếm đa số
        drv = FakeDriver([_comments_page([("1", "PHOTO"), ("2", "PHOTO"), ("3", "NEXT")])])
        got = []
        scraper.collect_comments(drv, 0, on_batch=got.extend, tick=lambda: False, pause=lambda: False,
                                 sleep=lambda s: None, post_id="STORY")
        self.assertEqual(sorted(c["comment_id"] for c in got), ["1", "2"])

    # B — fanpage kiểu mới (__typename User + is_additional_profile_plus)
    def test_new_style_fanpage_is_page(self):
        story = {"post_id": "123", "actors": [{"__typename": "User", "id": "555", "name": "Shop ABC"}]}
        profile = {"id": "555", "is_additional_profile_plus": True}
        meta = fb_parse.post_meta([{"a": story}, {"b": profile}], post_key="123")
        self.assertEqual(meta["source_type"], "page")

    # 1 — ô để trống = quét toàn bộ (tối đa hạn mức); số Facebook không rõ giữ None
    def test_blank_quota_means_all(self):
        t = jobs.normalize_targets([{"post_url": "https://www.facebook.com/groups/1/posts/1111111111/",
                                     "like_quota": None, "comment_quota": 0}])
        self.assertEqual((t[0]["like_quota"], t[0]["comment_quota"]), (jobs.QUOTA_LIMITS["like"], 0))

    def test_unknown_counts_stay_none(self):
        meta = jobs._public_meta({"fb_like_count": None, "fb_comment_count": 3, "fb_share_count": 0})
        self.assertEqual((meta["fb_like_count"], meta["fb_comment_count"], meta["fb_share_count"]), (None, 3, 0))

    # 3 — không đọc được dữ liệu ≠ bài đã xoá
    def test_unreadable_page_is_retryable_error(self):
        post = {"post_key": "1111111111", "post_url": "u"}
        with self.assertRaises(jobs.PostReadError):
            jobs._meta_to_post(post, {"state": {"unavailable": False}, "meta": {}})
        row = jobs._meta_to_post(post, {"state": {"unavailable": True}, "meta": {}})
        self.assertEqual(row["availability"], "unavailable")

    # 6 — Dừng khẩn cấp không bị Tạm dừng / Tiếp tục huỷ
    def test_abort_is_not_undone_by_pause_or_resume(self):
        jid = "PES-test-abort"
        with jobs._jobs_lock:
            jobs._jobs[jid] = {"job_id": jid, "kind": "scan", "owner": "zoe", "status": "running", "control": "run",
                               "logs": [], "progress": {}, "totals": {}}
        try:
            self.assertTrue(jobs.set_control(jid, "abort", "zoe"))
            self.assertTrue(jobs.set_control(jid, "resume", "zoe"))
            self.assertTrue(jobs.set_control(jid, "pause", "zoe"))
            self.assertEqual(jobs._control(jid), "abort")
        finally:
            with jobs._jobs_lock:
                jobs._jobs.pop(jid, None)

    # 8 — bấm đúp: phiên thứ 2 bị từ chối
    def test_second_job_is_rejected_atomically(self):
        jid = jobs._new_job("bob", "scan", ["1"], [{"post_key": "a"}])
        try:
            with self.assertRaises(jobs.JobBusy):
                jobs._new_job("bob", "scan", ["1"], [{"post_key": "a"}])
            with self.assertRaises(jobs.JobBusy):
                jobs._new_job("bob", "check", ["1"], [{"post_key": "a"}])
            other = jobs._new_job("carol", "scan", ["1"], [{"post_key": "a"}])  # user khác không bị chặn
            with jobs._jobs_lock:
                jobs._jobs.pop(other, None)
        finally:
            with jobs._jobs_lock:
                jobs._jobs.pop(jid, None)

    # 9 — ký tự đặc biệt trong ô tìm
    def test_like_pattern_escapes_wildcards(self):
        self.assertEqual(models._like("a_b"), "%a\\_b%")
        self.assertEqual(models._like("%"), "%\\%%")
        self.assertEqual(models._like("abc"), "%abc%")

    # 5 — xuất toàn bộ kho: lấy đủ mọi bài khớp bộ lọc, không dừng ở 200
    def test_list_post_keys_pages_through_store(self):
        store = [{"post_key": str(i)} for i in range(2350)]

        def fake_list(owner, *, search="", source="all", sort="newest", limit=200, offset=0, keys=None):
            return {"posts": store[offset:offset + limit], "total": len(store)}

        with mock.patch.object(models, "list_posts", fake_list):
            self.assertEqual(len(models.list_post_keys("alice")), 2350)

