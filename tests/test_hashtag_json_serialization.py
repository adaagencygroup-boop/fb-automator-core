"""
Test hồi quy cho lỗi phiên hashtag FAILED với error_message:
    "Object of type set is not JSON serializable"

Nguyên nhân gốc: luồng HASHTAG gom Page với matched_hashtags là set
(scanner.run_hashtag_search_flow), trong khi save_batch_pages() lại
json.dumps() toàn bộ dict Page để lưu cột raw_data -> TypeError ngay
batch đầu tiên có Page khớp.

Test này thay db bằng bản ghi giả (không cần DB thật, không cần trình
duyệt) và kiểm tra:
1. save_batch_pages() không còn ném TypeError với Page kiểu hashtag.
2. raw_data lưu xuống là JSON hợp lệ, matched_hashtags thành list sắp xếp.
3. Cột matched_hashtags dạng chuỗi cũng được sắp xếp ổn định.
"""
import json
import unittest
from unittest.mock import patch

from modules.module_11_page_scanner import scanner


class _FakeDB:
    _is_postgres = True

    def __init__(self):
        self.fetched = []
        self.executed = []

    def fetch_one(self, query, params=None):
        self.fetched.append((query, params))
        return {"is_new": True}

    def execute(self, query, params=None):
        self.executed.append((query, params))
        return 1

    def fetch_all(self, query, params=None):
        return []


def _hashtag_page():
    """Dict Page đúng hình dạng run_hashtag_search_flow tạo ra (có set)."""
    return {
        "page_key": "user:shopthoitrang",
        "page_name": "Shop Thời Trang",
        "page_url": "https://www.facebook.com/shopthoitrang",
        "avatar_url": None,
        "category": "Cửa hàng quần áo",
        "follower_count": None,
        "follower_text": None,
        "is_verified": None,
        "is_sponsored": False,
        "identifier_quality": "high",
        "matched_hashtags": {"thoitrang", "mypham"},
        "hashtag_post_count": 3,
        "evidence_posts": ["https://www.facebook.com/shopthoitrang/posts/123"],
        "latest_post_at": "Gần đây",
        "relevance_score": 55,
        "relevance_status": "RELEVANT",
        "relevance_reasons": ["+30đ: 3 bài viết khớp hashtag"],
    }


class TestHashtagJsonSerialization(unittest.TestCase):
    def test_save_batch_pages_with_set_matched_hashtags(self):
        fake_db = _FakeDB()
        with patch.object(scanner, "db", fake_db):
            # Trước bản vá: dòng này ném TypeError "Object of type set..."
            scanner.save_batch_pages(
                44, "2", 1, [_hashtag_page()], "61577080577029", "HASHTAG"
            )
        self.assertTrue(fake_db.fetched, "save_batch_pages phải gọi upsert")

    def test_raw_data_is_valid_json_with_sorted_list(self):
        fake_db = _FakeDB()
        with patch.object(scanner, "db", fake_db):
            scanner.save_batch_pages(
                44, "2", 1, [_hashtag_page()], "61577080577029", "HASHTAG"
            )
        upsert_params = fake_db.fetched[-1][1]
        raw = json.loads(upsert_params[-1])  # raw_data là tham số cuối
        self.assertEqual(raw["matched_hashtags"], ["mypham", "thoitrang"])
        # Cột matched_hashtags (tham số thứ 14) cũng sắp xếp ổn định
        self.assertEqual(upsert_params[13], "mypham, thoitrang")

    def test_dumps_json_handles_frozenset_and_datetime(self):
        from datetime import datetime

        payload = {"tags": frozenset({"b", "a"}), "at": datetime(2026, 10, 22)}
        parsed = json.loads(scanner._dumps_json(payload))
        self.assertEqual(parsed["tags"], ["a", "b"])
        self.assertTrue(parsed["at"].startswith("2026-10-22"))


if __name__ == "__main__":
    unittest.main()
