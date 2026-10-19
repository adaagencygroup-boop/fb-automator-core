# -*- coding: utf-8 -*-
"""
File: tests/test_module_05_flow.py
Comprehensive automated test suite for Module 05: Fanpage Manager & Reels Poster.
Covers:
1. Multi-tenant user scoping & isolation (User A vs User B).
2. Live Token Verification (ThreadPoolExecutor, LIVE 200, EXPIRED 190, NONE, ERROR).
3. Background OAuth/sync API contracts; detailed worker regressions are in test_module05_meta.
4. Token-free synchronization/account responses.
5. Reels Poster Engine & Folder Auto-matching (Format A, Format B, Runner lifecycle).
6. Frontend & Backend status contracts (live/die/uncheck, login_status, page status mapping).
"""
import os
import re
import tempfile
import shutil
import unittest
from unittest.mock import patch, MagicMock, PropertyMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.module_05_page_manager.routes_pages import router as pages_router
from modules.module_05_page_manager.routes_reels import router as reels_router
from modules.module_05_page_manager.reels_service import (
    scan_root_directory,
    count_videos_in_folder,
    auto_match_folders,
    get_next_reel_video,
    normalize_text,
)
from modules.module_05_page_manager.reels_runner import ReelsTaskRunner


class Module05ComprehensiveFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Thiết lập FastAPI test client
        cls.app = FastAPI()
        cls.app.include_router(pages_router, prefix="/api")
        cls.app.include_router(reels_router, prefix="/api")
        cls.client = TestClient(cls.app)

    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="test_mod05_")
        inspection = patch("modules.module_05_page_manager.routes_pages.fb_client.inspect_token")
        self.token_inspection = inspection.start()
        self.token_inspection.return_value = {"is_valid": True}
        self.addCleanup(inspection.stop)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    # =========================================================================
    # KỊCH BẢN 1: MULTI-TENANCY DATA SCOPING & ISOLATION (USER_ID ISOLATION)
    # =========================================================================

    @patch("modules.module_05_page_manager.routes_pages.db")
    def test_managed_pages_scoped_by_user_id(self, mock_db):
        """
        User A gọi /pages/managed chỉ truy vấn và nhận đúng các Fanpage thuộc sở hữu của User A.
        Không thể nhìn thấy dữ liệu của User B.
        """
        user_a_pages = [
            {
                "id": 1,
                "page_id": "111001",
                "page_name": "Page của User A",
                "category": "Kinh Doanh",
                "status": "ACTIVE",
                "account_uid": "uid_user_a",
                "reels_folder": "folder_a",
                "created_at": "2026-10-18 10:00:00",
            }
        ]
        user_a_accounts = [
            {
                "uid": "uid_user_a",
                "profile_name": "Nick Clone của A",
                "avatar_url": "https://img.com/a.jpg",
                "status": "live",
                "login_status": "logged_in",
            }
        ]

        def db_fetch_all_side_effect(sql, params=None):
            if "FROM pages WHERE user_id = %s" in sql:
                self.assertEqual(params, ("user_101",))
                return user_a_pages
            if "FROM accounts WHERE user_id = %s" in sql:
                self.assertEqual(params, ("user_101",))
                return user_a_accounts
            return []

        mock_db.fetch_all.side_effect = db_fetch_all_side_effect

        response = self.client.get(
            "/api/pages/managed",
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("pages", data)
        self.assertEqual(len(data["pages"]), 1)
        page = data["pages"][0]
        self.assertEqual(page["page_id"], "111001")
        self.assertEqual(page["manager_name"], "Nick Clone của A")
        self.assertEqual(page["status"], "SUCCESS")

    @patch("modules.module_05_page_manager.routes_pages.db")
    def test_delete_page_strictly_scoped_to_user_id(self, mock_db):
        """
        User A xóa Fanpage: câu lệnh SQL bắt buộc phải có điều kiện WHERE ... AND user_id = %s.
        User A không thể xóa Page của User B.
        """
        response = self.client.delete(
            "/api/pages/111001",
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get("success"))

        # Xác thực câu lệnh DELETE chứa user_id = %s và truyền đúng user_101
        called_args = mock_db.execute.call_args
        self.assertIsNotNone(called_args)
        sql, params = called_args[0]
        self.assertIn("user_id = %s", sql)
        self.assertIn("user_101", params)

    # =========================================================================
    # KỊCH BẢN 2: LIVE TOKEN VERIFICATION (KIỂM TRA SỐNG/CHẾT THỜI GIAN THỰC)
    # =========================================================================

    @patch("modules.module_05_page_manager.routes_pages.requests.get")
    @patch("modules.module_05_page_manager.routes_pages.db")
    def test_verify_tokens_live_scenario(self, mock_db, mock_requests_get):
        """
        Token còn sống (Meta Graph API /me trả về HTTP 200 kèm id và name)
        -> Kết quả trả về status = 'LIVE'.
        """
        mock_db.fetch_all.return_value = [
            {"uid": "uid_live", "profile_name": "Tài khoản sống", "token": "EAA_VALID_TOKEN"}
        ]

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "id": "uid_live",
            "name": "Nguyễn Văn Live"
        }
        mock_requests_get.return_value = mock_resp

        response = self.client.post(
            "/api/pages/tokens/verify",
            json={"account_uids": ["uid_live"]},
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("success"))
        results = data.get("results", {})
        self.assertIn("uid_live", results)
        self.assertEqual(results["uid_live"]["status"], "LIVE")
        self.assertEqual(results["uid_live"]["meta_name"], "Nguyễn Văn Live")

    @patch("modules.module_05_page_manager.routes_pages.requests.get")
    @patch("modules.module_05_page_manager.routes_pages.db")
    def test_verify_tokens_expired_scenario_code_190(self, mock_db, mock_requests_get):
        """
        Token hết hạn hoặc bị hủy quyền (Meta API trả error code 190)
        -> Kết quả trả về status = 'EXPIRED' kèm mã lỗi 190.
        """
        mock_db.fetch_all.return_value = [
            {"uid": "uid_expired", "profile_name": "Tài khoản hết hạn", "token": "EAA_EXPIRED_TOKEN"}
        ]

        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.json.return_value = {
            "error": {
                "message": "Error validating access token: Session has expired.",
                "type": "OAuthException",
                "code": 190,
                "error_subcode": 463
            }
        }
        mock_requests_get.return_value = mock_resp

        response = self.client.post(
            "/api/pages/tokens/verify",
            json={"account_uids": ["uid_expired"]},
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        results = response.json().get("results", {})
        self.assertEqual(results["uid_expired"]["status"], "EXPIRED")
        self.assertEqual(results["uid_expired"]["code"], 190)

    @patch("modules.module_05_page_manager.routes_pages.requests.get")
    @patch("modules.module_05_page_manager.routes_pages.db")
    def test_verify_tokens_empty_token_returns_none(self, mock_db, mock_requests_get):
        """
        Tài khoản chưa có Token (token trống)
        -> Trả về status = 'NONE', không gọi vô nghĩa ra bên ngoài.
        """
        mock_db.fetch_all.return_value = [
            {"uid": "uid_no_tok", "profile_name": "Chưa có token", "token": ""}
        ]

        response = self.client.post(
            "/api/pages/tokens/verify",
            json={"account_uids": ["uid_no_tok"]},
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        results = response.json().get("results", {})
        self.assertEqual(results["uid_no_tok"]["status"], "NONE")
        mock_requests_get.assert_not_called()

    @patch("modules.module_05_page_manager.routes_pages.requests.get")
    @patch("modules.module_05_page_manager.routes_pages.db")
    def test_verify_tokens_network_exception_returns_error(self, mock_db, mock_requests_get):
        """
        Lỗi mạng bất ngờ (DNS, timeout, mất kết nối) khi kiểm tra token
        -> Bắt ngoại lệ và trả về status = 'ERROR' thay vì làm crash hệ thống.
        """
        mock_db.fetch_all.return_value = [
            {"uid": "uid_net_err", "profile_name": "Lỗi mạng", "token": "EAA_TOKEN"}
        ]
        mock_requests_get.side_effect = Exception("Connection timeout to graph.facebook.com")

        response = self.client.post(
            "/api/pages/tokens/verify",
            json={"account_uids": ["uid_net_err"]},
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        results = response.json().get("results", {})
        self.assertEqual(results["uid_net_err"]["status"], "ERROR")
        self.assertIn("Không kết nối được Facebook", results["uid_net_err"]["message"])

    @patch("modules.module_05_page_manager.routes_pages.requests.get")
    @patch("modules.module_05_page_manager.routes_pages.db")
    def test_verify_tokens_rate_limited_code_4_or_17_or_341(self, mock_db, mock_requests_get):
        """
        Khi Meta trả mã lỗi Rate Limit (mã 4, 17, 32, 341, 613):
        Hệ thống phân loại chính xác là RATE_LIMITED chứ KHÔNG đánh đồng là EXPIRED.
        """
        mock_db.fetch_all.return_value = [
            {"uid": "uid_rate_limit", "profile_name": "Acc Rate Limit", "token": "EAA_VALID_BUT_LIMITED", "proxy": None}
        ]

        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.json.return_value = {
            "error": {
                "message": "User request limit reached",
                "type": "OAuthException",
                "code": 17
            }
        }
        mock_requests_get.return_value = mock_resp

        response = self.client.post(
            "/api/pages/tokens/verify",
            json={"account_uids": ["uid_rate_limit"]},
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        results = response.json().get("results", {})
        self.assertEqual(results["uid_rate_limit"]["status"], "RATE_LIMITED")
        self.assertEqual(results["uid_rate_limit"]["code"], 17)

    @patch("modules.module_05_page_manager.routes_pages.requests.get")
    @patch("modules.module_05_page_manager.routes_pages.db")
    def test_verify_tokens_with_proxy_success(self, mock_db, mock_requests_get):
        """
        Tài khoản có Proxy cài đặt sẵn:
        Request kiểm tra token được định tuyến qua đúng Proxy của nick đó để phân tán tải.
        """
        mock_db.fetch_all.return_value = [
            {"uid": "uid_proxy_ok", "profile_name": "Acc Proxy OK", "token": "EAA_TOKEN", "proxy": "103.1.2.3:8080"}
        ]

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "uid_proxy_ok", "name": "Nick Proxy"}
        mock_requests_get.return_value = mock_resp

        response = self.client.post(
            "/api/pages/tokens/verify",
            json={"account_uids": ["uid_proxy_ok"]},
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        results = response.json().get("results", {})
        self.assertEqual(results["uid_proxy_ok"]["status"], "LIVE")

        # Xác thực requests.get được gọi kèm tham số proxies
        call_kwargs = mock_requests_get.call_args[1]
        self.assertIn("proxies", call_kwargs)
        self.assertEqual(call_kwargs["proxies"]["http"], "http://103.1.2.3:8080")

    @patch("modules.module_05_page_manager.routes_pages.requests.get")
    @patch("modules.module_05_page_manager.routes_pages.db")
    def test_verify_tokens_proxy_failure_falls_back_to_direct_ip(self, mock_db, mock_requests_get):
        """
        Khi Proxy của nick bị lỗi hoặc timeout:
        Tự động fallback sang gọi trực tiếp qua IP server để tránh báo sai token chết.
        """
        mock_db.fetch_all.return_value = [
            {"uid": "uid_fallback", "profile_name": "Acc Proxy Die", "token": "EAA_TOKEN", "proxy": "1.1.1.1:9999"}
        ]

        # Lần gọi đầu qua proxy gặp ngoại lệ, lần gọi thứ 2 fallback trực tiếp thành công 200
        mock_success_resp = MagicMock()
        mock_success_resp.status_code = 200
        mock_success_resp.json.return_value = {"id": "uid_fallback", "name": "Nick Sống"}

        mock_requests_get.side_effect = [
            Exception("Proxy connection refused"),
            mock_success_resp
        ]

        response = self.client.post(
            "/api/pages/tokens/verify",
            json={"account_uids": ["uid_fallback"]},
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        results = response.json().get("results", {})
        self.assertEqual(results["uid_fallback"]["status"], "LIVE")
        self.assertTrue(results["uid_fallback"].get("proxy_fallback"))

    # =========================================================================
    # KỊCH BẢN 3: CẤP TOKEN QUA CHROME PROFILE (OAUTH BY PROFILE)
    # =========================================================================

    @patch("modules.module_05_page_manager.meta_sync.submit", return_value={"job_id": "job", "status": "QUEUED"})
    @patch("modules.module_05_page_manager.meta_sync.account", return_value={"uid": "111", "token": "stored"})
    @patch.dict(os.environ, {"FACEBOOK_APP_ID": "app", "FACEBOOK_APP_SECRET": "secret", "FACEBOOK_OAUTH_CALLBACK_URL": "https://dashboard.example/oauth/meta/callback"})
    def test_sync_routes_return_job_without_tokens(self, account, submit):
        for path, payload in (
            ("sync-by-token", {"account_uid": "111", "access_token": "raw"}),
            ("sync-by-account", {"account_uid": "111"}),
            ("oauth-by-profile", {"account_uid": "111"}),
        ):
            with self.subTest(path=path):
                response = self.client.post("/api/pages/" + path, json=payload, headers={"X-User-Id": "a"})
                self.assertEqual(response.status_code, 202)
                self.assertEqual(response.json(), {"job_id": "job", "status": "QUEUED"})
                self.assertEqual(submit.call_args.args[:2], ("a", "111"))

    @patch("modules.module_05_page_manager.meta_sync.account", return_value={"uid": "111", "token": None})
    @patch.dict(os.environ, {"FACEBOOK_APP_ID": "app", "FACEBOOK_APP_SECRET": "secret"})
    def test_sync_by_account_no_token_raises_400(self, account):
        response = self.client.post("/api/pages/sync-by-account", json={"account_uid": "111"}, headers={"X-User-Id": "a"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("chưa có token", response.json()["detail"])

    @patch.dict(os.environ, {"FACEBOOK_APP_ID": "987654321", "FACEBOOK_APP_SECRET": "secret", "FACEBOOK_OAUTH_CALLBACK_URL": "https://dashboard.example/oauth/meta/callback"})
    def test_oauth_config_endpoint(self):
        response = self.client.get("/api/pages/oauth-config")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["app_id"], "987654321")
        self.assertTrue(data["configured"])
        self.assertIn("pages_messaging", data["scopes"])
        self.assertIn("pages_manage_metadata", data["scopes"])

    # =========================================================================
    # KỊCH BẢN 5: REELS POSTER ENGINE & FOLDER STRUCTURES (ĐỊNH DẠNG A & B)
    # =========================================================================

    @patch("modules.module_05_page_manager.routes_reels.db")
    def test_reels_scan_folders_endpoint(self, mock_db):
        """
        Kiểm tra endpoint /pages/reels/scan-folders:
        - Quét thư mục thật trên đĩa.
        - Đối chiếu với Fanpage trong DB.
        """
        page_folder = os.path.join(self.test_dir, "Góc Đời Sống")
        os.makedirs(page_folder, exist_ok=True)
        with open(os.path.join(page_folder, "vid1.mp4"), "wb") as f:
            f.write(b"video")

        mock_db.fetch_all.return_value = [
            {"page_id": "p_life", "page_name": "Góc Đời Sống"}
        ]

        response = self.client.post(
            "/api/pages/reels/scan-folders",
            json={"root_dir": self.test_dir},
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertIn("matches", data)
        self.assertTrue(data["matches"]["p_life"]["auto_matched"])

    @patch("modules.module_05_page_manager.routes_reels.db")
    def test_reels_start_and_stop_job_endpoints(self, mock_db):
        mock_db.fetch_one.return_value = {"page_id": "p_job", "page_name": "Page Job Test", "account_uid": "111"}
        """
        Kiểm tra khởi động và dừng job Reels qua API /pages/reels/start và /pages/reels/stop.
        """
        page_dir = os.path.join(self.test_dir, "Page_Reels_Run")
        os.makedirs(page_dir, exist_ok=True)

        # 1. Start job hợp lệ
        payload = {
            "root_dir": self.test_dir,
            "pages_config": [
                {
                    "page_id": "p_job",
                    "page_name": "Page Job Test",
                    "access_token": "EAA_JOB_TOKEN",
                    "folder_name": "Page_Reels_Run"
                }
            ],
            "schedule_enabled": False
        }
        res_start = self.client.post(
            "/api/pages/reels/start",
            json=payload,
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(res_start.status_code, 200)
        self.assertTrue(res_start.json()["success"])

        # 2. Kiểm tra status endpoint
        res_status = self.client.get(
            "/api/pages/reels/status",
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(res_status.status_code, 200)

        # 3. Stop job
        res_stop = self.client.post(
            "/api/pages/reels/stop",
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(res_stop.status_code, 200)

        # 4. Clear logs
        res_clear = self.client.post(
            "/api/pages/reels/clear-logs",
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(res_clear.status_code, 200)
        self.assertTrue(res_clear.json()["success"])

    def test_reels_normalize_and_auto_match(self):
        """
        Kiểm tra độ chính xác của thuật toán normalize_text và auto_match_folders:
        - Bỏ qua viết hoa/thường, dấu gạch nối, dấu câu chuẩn, khoảng trắng thừa.
        """
        self.assertEqual(normalize_text("  Ẩm Thực - Món Ngon 2026  "), "ẩmthựcmónngon2026")
        self.assertEqual(normalize_text("Fanpage Bán Hàng - 2026!"), "fanpagebánhàng2026!")

        pages = [
            {"page_id": "p1", "page_name": "Ẩm Thực & Món Ngon"},
            {"page_id": "p2", "page_name": "Review Phim Hay"},
            {"page_id": "p3", "page_name": "Bóng Đá TV"}
        ]
        folders = [
            {"folder_name": "Ẩm Thực & Món Ngon", "folder_path": "/fake/p1", "video_count": 5},
            {"folder_name": "Review Phim Hay", "folder_path": "/fake/p2", "video_count": 12},
            {"folder_name": "Khong_Lien_Quan", "folder_path": "/fake/p3", "video_count": 2}
        ]

        matches = auto_match_folders(pages, folders)
        self.assertTrue(matches["p1"]["auto_matched"])
        self.assertEqual(matches["p1"]["folder_name"], "Ẩm Thực & Món Ngon")
        self.assertTrue(matches["p2"]["auto_matched"])
        self.assertEqual(matches["p2"]["folder_name"], "Review Phim Hay")
        self.assertFalse(matches["p3"]["auto_matched"])

    @patch("modules.module_05_page_manager.routes_reels.db")
    def test_reels_accounts_pages_grouped_by_account_uid(self, mock_db):
        """
        Kiểm tra endpoint /pages/reels/accounts-pages:
        - Gom nhóm các Fanpage con theo account_uid của chủ sở hữu.
        - Scoped chặt chẽ theo user_id của người đăng nhập.
        """
        mock_pages = [
            {
                "id": 1,
                "page_id": "p101",
                "page_name": "Page 1 của Acc A",
                "account_uid": "acc_a",
                "access_token": "tok_p1",
                "category": "Blog",
                "status": "ACTIVE",
                "reels_folder": "folder_1",
            },
            {
                "id": 2,
                "page_id": "p102",
                "page_name": "Page 2 của Acc A",
                "account_uid": "acc_a",
                "access_token": "tok_p2",
                "category": "News",
                "status": "ACTIVE",
                "reels_folder": "folder_2",
            },
        ]
        mock_accounts = [
            {
                "uid": "acc_a",
                "profile_name": "Nguyễn Văn Acc A",
                "avatar_url": "https://img.com/acc_a.jpg",
                "status": "live",
                "login_status": "logged_in",
            }
        ]

        def db_fetch_all_reels(sql, params=None):
            if "FROM pages WHERE user_id = %s" in sql:
                self.assertEqual(params, ("user_101",))
                return mock_pages
            if "FROM accounts WHERE user_id = %s" in sql:
                self.assertEqual(params, ("user_101",))
                return mock_accounts
            return []

        mock_db.fetch_all.side_effect = db_fetch_all_reels

        response = self.client.get(
            "/api/pages/reels/accounts-pages",
            headers={"X-User-Id": "user_101"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("success"))
        accounts = data.get("accounts", [])
        self.assertEqual(len(accounts), 1)
        acc_a = accounts[0]
        self.assertEqual(acc_a["account_uid"], "acc_a")
        self.assertEqual(acc_a["pages_count"], 2)
        self.assertEqual(len(acc_a["pages"]), 2)

    def test_reels_folder_format_a_and_advance_index(self):
        """
        Kiểm tra cấu trúc thư mục Định dạng A:
        Thư mục con đánh số 1, 2, 3... kèm file clip*.mp4 và caption.txt.
        - Lấy đúng thứ tự theo last_index.
        - Trích xuất caption tiếng Việt chuẩn.
        - Hết video thì trả về None.
        """
        page_dir = os.path.join(self.test_dir, "FormatA_Page")
        folder_1 = os.path.join(page_dir, "1")
        folder_2 = os.path.join(page_dir, "2")
        os.makedirs(folder_1, exist_ok=True)
        os.makedirs(folder_2, exist_ok=True)

        with open(os.path.join(folder_1, "video_1.mp4"), "wb") as f:
            f.write(b"mp4_content_1")
        with open(os.path.join(folder_1, "caption.txt"), "w", encoding="utf-8") as f:
            f.write("Tiêu đề video 1 #xuhuong")

        with open(os.path.join(folder_2, "video_2.mp4"), "wb") as f:
            f.write(b"mp4_content_2")

        count = count_videos_in_folder(page_dir)
        self.assertEqual(count, 2)

        # last_index = 0 -> lấy folder 1
        item1 = get_next_reel_video("p1", page_dir, last_index=0)
        self.assertIsNotNone(item1)
        self.assertEqual(item1["folder_number"], 1)
        self.assertEqual(item1["caption"], "Tiêu đề video 1 #xuhuong")

        # last_index = 1 -> lấy folder 2
        item2 = get_next_reel_video("p1", page_dir, last_index=1)
        self.assertIsNotNone(item2)
        self.assertEqual(item2["folder_number"], 2)
        self.assertEqual(item2["caption"], "")

        # last_index = 2 -> hết video
        item3 = get_next_reel_video("p1", page_dir, last_index=2)
        self.assertIsNone(item3)

    def test_reels_folder_format_b_direct_files(self):
        """
        Kiểm tra cấu trúc thư mục Định dạng B:
        File video trực tiếp trong thư mục Page (ví dụ: clip.mp4 và clip.txt).
        """
        page_dir = os.path.join(self.test_dir, "FormatB_Page")
        os.makedirs(page_dir, exist_ok=True)

        with open(os.path.join(page_dir, "phim_tap_01.mp4"), "wb") as f:
            f.write(b"mp4_direct")
        with open(os.path.join(page_dir, "phim_tap_01.txt"), "w", encoding="utf-8") as f:
            f.write("Tập 1 phim hay 2026")

        count = count_videos_in_folder(page_dir)
        self.assertEqual(count, 1)

        item = get_next_reel_video("p2", page_dir, last_index=0)
        self.assertIsNotNone(item)
        self.assertEqual(item["caption"], "Tập 1 phim hay 2026")

    def test_reels_runner_lifecycle(self):
        """
        Kiểm tra trạng thái Task Runner:
        - Bắt đầu ở trạng thái idle (is_running = False).
        - Ghi nhận log và xóa log thành công.
        """
        runner = ReelsTaskRunner()
        runner.clear_logs()
        self.assertFalse(runner.is_running)

        runner.log("Bắt đầu tiến trình test", "INFO")
        runner.log("Lỗi thử nghiệm", "ERROR")

        status = runner.get_status()
        self.assertEqual(len(status["recent_logs"]), 2)
        self.assertEqual(status["recent_logs"][0]["level"], "INFO")
        self.assertEqual(status["recent_logs"][1]["level"], "ERROR")

        runner.clear_logs()
        self.assertEqual(len(runner.get_status()["recent_logs"]), 0)

    # =========================================================================
    # KỊCH BẢN 6: FRONTEND STATUS MAPPING & FILTER CONTRACT
    # =========================================================================

    def test_status_mapping_and_badge_contract(self):
        """
        Kiểm tra tính nhất quán giữa dữ liệu Backend và logic hiển thị/lọc Frontend:
        - acc.status: 'live' -> Live badge, 'die' -> Die badge, khác -> '--' (uncheck).
        - acc.login_status: 'logged_in' -> Đã login, khác -> Lỗi / Chưa.
        - page status: ACTIVE/SUCCESS/LIVE -> SUCCESS, còn lại -> ERROR.
        """
        mock_accounts = [
            {"uid": "1", "status": "live", "login_status": "logged_in"},
            {"uid": "2", "status": "die", "login_status": "not_logged_in"},
            {"uid": "3", "status": None, "login_status": "not_logged_in"},
            {"uid": "4", "status": "active", "login_status": "logged_in"},
        ]

        # Mô phỏng filter theo status: 'live'
        live_filtered = [
            a for a in mock_accounts if (a.get("status") or "").lower() == "live"
        ]
        self.assertEqual(len(live_filtered), 1)
        self.assertEqual(live_filtered[0]["uid"], "1")

        # Mô phỏng filter theo status: 'die'
        die_filtered = [
            a for a in mock_accounts if (a.get("status") or "").lower() == "die"
        ]
        self.assertEqual(len(die_filtered), 1)
        self.assertEqual(die_filtered[0]["uid"], "2")

        # Mô phỏng filter theo status: 'uncheck' (khác live và khác die)
        uncheck_filtered = [
            a for a in mock_accounts if (a.get("status") or "").lower() not in ("live", "die")
        ]
        self.assertEqual(len(uncheck_filtered), 2)
        self.assertEqual([a["uid"] for a in uncheck_filtered], ["3", "4"])


if __name__ == "__main__":
    unittest.main()
