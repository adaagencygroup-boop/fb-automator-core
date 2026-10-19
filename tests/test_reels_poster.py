# -*- coding: utf-8 -*-
"""
Tests for Module 05: Facebook Reels Poster logic and service.
"""
import os
import shutil
import tempfile
import unittest

from modules.module_05_page_manager.reels_service import (
    scan_root_directory,
    count_videos_in_folder,
    auto_match_folders,
    get_next_reel_video,
    normalize_text
)
from modules.module_05_page_manager.reels_runner import ReelsTaskRunner


class TestReelsPoster(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="test_reels_")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_normalize_text(self):
        self.assertEqual(normalize_text("Fanpage Bán Hàng - 2026!"), "fanpagebánhàng2026!")
        self.assertEqual(normalize_text("   Page_A.xyz   "), "pageaxyz")

    def test_format_a_numbered_folders(self):
        """Kiểm tra cấu trúc thư mục con đánh số 1, 2... kèm caption.txt"""
        page_folder = os.path.join(self.test_dir, "Goc_Doi_Song")
        os.makedirs(os.path.join(page_folder, "1"), exist_ok=True)
        os.makedirs(os.path.join(page_folder, "2"), exist_ok=True)

        with open(os.path.join(page_folder, "1", "clip1.mp4"), "wb") as f:
            f.write(b"video1")
        with open(os.path.join(page_folder, "1", "caption.txt"), "w", encoding="utf-8") as f:
            f.write("Caption cho video 1 #reels")

        with open(os.path.join(page_folder, "2", "clip2.mp4"), "wb") as f:
            f.write(b"video2")

        count = count_videos_in_folder(page_folder)
        self.assertEqual(count, 2)

        # Lần đầu tiên (last_index = 0) -> lấy folder 1
        next_vid = get_next_reel_video("101", page_folder, last_index=0)
        self.assertIsNotNone(next_vid)
        self.assertEqual(next_vid["folder_number"], 1)
        self.assertEqual(next_vid["caption"], "Caption cho video 1 #reels")

        # Sau khi đăng folder 1 (last_index = 1) -> lấy folder 2
        next_vid2 = get_next_reel_video("101", page_folder, last_index=1)
        self.assertIsNotNone(next_vid2)
        self.assertEqual(next_vid2["folder_number"], 2)
        self.assertEqual(next_vid2["caption"], "")

        # Sau khi đăng folder 2 (last_index = 2) -> hết video
        next_vid3 = get_next_reel_video("101", page_folder, last_index=2)
        self.assertIsNone(next_vid3)

    def test_format_b_direct_video_files(self):
        """Kiểm tra cấu trúc file video trực tiếp trong thư mục Page"""
        page_folder = os.path.join(self.test_dir, "Hài_Hước_TV")
        os.makedirs(page_folder, exist_ok=True)

        with open(os.path.join(page_folder, "video_a.mp4"), "wb") as f:
            f.write(b"vidA")
        with open(os.path.join(page_folder, "video_a.txt"), "w", encoding="utf-8") as f:
            f.write("Caption A")

        with open(os.path.join(page_folder, "video_b.mp4"), "wb") as f:
            f.write(b"vidB")

        count = count_videos_in_folder(page_folder)
        self.assertEqual(count, 2)

        next_vid = get_next_reel_video("202", page_folder, last_index=0)
        self.assertIsNotNone(next_vid)
        self.assertEqual(next_vid["caption"], "Caption A")

    def test_scan_and_auto_match(self):
        """Kiểm tra quét thư mục gốc và đối chiếu tự động với tên Fanpage"""
        p1_dir = os.path.join(self.test_dir, "Việt Nam Trong Tôi")
        p2_dir = os.path.join(self.test_dir, "Ẩm Thực Phố")
        os.makedirs(p1_dir, exist_ok=True)
        os.makedirs(p2_dir, exist_ok=True)

        scan_res = scan_root_directory(self.test_dir)
        self.assertTrue(scan_res["success"])
        self.assertEqual(scan_res["total_folders"], 2)

        pages = [
            {"page_id": "111", "page_name": "Việt Nam Trong Tôi"},
            {"page_id": "222", "page_name": "Ẩm Thực & Món Ngon"},
            {"page_id": "333", "page_name": "Bóng Đá 24h"}
        ]

        matches = auto_match_folders(pages, scan_res["folders"])
        self.assertTrue(matches["111"]["auto_matched"])
        self.assertEqual(matches["111"]["folder_name"], "Việt Nam Trong Tôi")

        self.assertFalse(matches["333"]["auto_matched"])

    def test_runner_state(self):
        """Kiểm tra trạng thái runner và hàng đợi log"""
        runner = ReelsTaskRunner()
        runner.clear_logs()
        self.assertFalse(runner.is_running)

        runner.log("Test log entry message", "INFO")
        st = runner.get_status()
        self.assertEqual(len(st["recent_logs"]), 1)
        self.assertIn("Test log entry message", st["recent_logs"][0]["message"])


if __name__ == "__main__":
    unittest.main()
