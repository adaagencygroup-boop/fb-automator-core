"""Chọn file = chỉ xem trước (không ghi DB); chỉ "Bắt đầu" (save_to_db=true) mới tạo phiên + lưu page."""
from __future__ import annotations

import asyncio
import importlib
import unittest
from unittest import mock

router = importlib.import_module("modules.module_11_page_scanner.api.router")

CONTENT = b"https://www.facebook.com/innisfreevietnam\nhttps://www.facebook.com/biluxuryvn\n"


class _FakeUpload:
    filename = "pages.txt"

    async def read(self):
        return CONTENT


class TestUploadPreview(unittest.TestCase):
    def _call(self, save_to_db):
        with mock.patch.object(router, "_get_owner", return_value="42"), \
                mock.patch.object(router, "create_scan_session", return_value=31) as create, \
                mock.patch.object(router, "save_batch_pages", return_value=(2, 0)) as save, \
                mock.patch.object(router, "finalize_scan_session") as finalize:
            res = asyncio.run(router.upload_pages_file(file=_FakeUpload(), filter_existing=False, save_to_db=save_to_db))
        return res, create, save, finalize

    def test_preview_does_not_touch_db(self):
        res, create, save, finalize = self._call(save_to_db=False)
        self.assertEqual(res["valid_count"], 2)
        self.assertNotIn("session_id", res)
        create.assert_not_called()
        save.assert_not_called()
        finalize.assert_not_called()

    def test_start_saves_once(self):
        res, create, save, finalize = self._call(save_to_db=True)
        self.assertEqual(res["session_id"], 31)
        create.assert_called_once()
        save.assert_called_once()
        finalize.assert_called_once()


if __name__ == "__main__":
    unittest.main()
