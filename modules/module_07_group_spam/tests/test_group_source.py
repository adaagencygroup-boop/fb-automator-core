import unittest
from fastapi.testclient import TestClient
from fastapi import FastAPI

from modules.module_07_group_spam.api.router import router
from modules.module_07_group_spam.group_source import (
    clean_group_url,
    extract_group_identifier,
    is_valid_group_entry,
    parse_group_file_content,
    search_facebook_groups,
    get_sample_template,
)


class GroupSourceUnitTests(unittest.TestCase):
    def test_clean_group_url(self):
        # Tách query parameters '?' như FaceBook_Post_Group.py
        url1 = "https://www.facebook.com/groups/vieclamonline2024?ref=share&mibextid=wwXIfr"
        self.assertEqual(clean_group_url(url1), "facebook.com/groups/vieclamonline2024")

        # Hỗ trợ m.facebook.com
        url2 = "http://m.facebook.com/groups/123456789/?ref=bookmarks"
        self.assertEqual(clean_group_url(url2), "facebook.com/groups/123456789")

        # Hỗ trợ chỉ truyền UID
        self.assertEqual(clean_group_url("987654321"), "facebook.com/groups/987654321")

    def test_extract_group_identifier(self):
        self.assertEqual(extract_group_identifier("https://facebook.com/groups/vieclam2024"), "vieclam2024")
        self.assertEqual(extract_group_identifier("facebook.com/groups/11223344"), "11223344")

    def test_parse_group_file_content(self):
        sample_file = """
        # Đây là dòng ghi chú
        https://www.facebook.com/groups/group_a?ref=123
        https://www.facebook.com/groups/group_b
        https://www.facebook.com/groups/group_a?ref=456
        dòng này bị lỗi không phải link nhóm
        123456789
        """
        result = parse_group_file_content(sample_file)
        self.assertEqual(result["total_lines"], 5)
        # group_a bị lặp -> dedup = 1
        self.assertEqual(result["dedup_count"], 1)
        # 1 dòng lỗi
        self.assertEqual(result["invalid_count"], 1)
        # Còn lại 3 nhóm hợp lệ: group_a, group_b, 123456789
        self.assertEqual(result["valid_count"], 3)
        self.assertEqual(len(result["groups"]), 3)
        self.assertEqual(result["groups"][0]["url"], "facebook.com/groups/group_a")

    def test_search_facebook_groups(self):
        results = search_facebook_groups("việc làm", max_results=3)
        self.assertEqual(len(results), 3)
        self.assertTrue(all("url" in r and "key" in r for r in results))

    def test_get_sample_template(self):
        template = get_sample_template()
        self.assertIn("DANH SÁCH LINK NHÓM FACEBOOK", template)
        self.assertIn("facebook.com/groups/", template)


class GroupSourceApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def test_api_parse_source(self):
        response = self.client.post(
            "/api/groups/source/parse",
            json={"content": "https://facebook.com/groups/test_group\nhttps://facebook.com/groups/test_group"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["valid_count"], 1)
        self.assertEqual(data["dedup_count"], 1)

    def test_api_search_source(self):
        response = self.client.post(
            "/api/groups/source/search",
            json={"keyword": "tuyển dụng", "max_results": 4},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 4)

    def test_api_template(self):
        response = self.client.get("/api/groups/source/template")
        self.assertEqual(response.status_code, 200)
        self.assertIn("vieclamonline2024", response.text)

    def test_api_campaign(self):
        response = self.client.post(
            "/api/groups/campaign",
            json={
                "action_type": "POST",
                "account_uids": ["10001", "10002"],
                "groups": [{"key": "g1", "url": "facebook.com/groups/g1"}],
                "posts": ["Bài viết mẫu"],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])
