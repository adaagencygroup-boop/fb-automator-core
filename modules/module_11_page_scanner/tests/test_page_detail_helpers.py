"""Offline helpers for DETAIL + tick/description (không cần Chrome)."""
from __future__ import annotations

import json
import unittest

from modules.module_11_page_scanner.scanner import (
    _detail_description_json,
    _detail_missing_contact,
    _empty_detail_result,
    _merge_detail_missing,
    _sanitize_detail_address,
    _sanitize_detail_email,
)


class TestPageDetailHelpers(unittest.TestCase):
    def test_empty_failed(self):
        d = _empty_detail_result(status="FAILED")
        self.assertEqual(d["detail_status"], "FAILED")
        self.assertFalse(d["panel_found"])
        self.assertIsNone(d["phone"])
        self.assertIsNone(d["website"])

    def test_description_json_korea_shape(self):
        detail = {
            "instagram": "k.style01",
            "messenger": "Korea style",
            "messenger_handle": "koreashop.79",
            "lat": 21.1110372,
            "lng": 105.8414997,
            "district": None,
            "city": "Hanoi",
            "opening": "Đang mở cửa",
        }
        raw = _detail_description_json(detail)
        data = json.loads(raw)
        self.assertEqual(data["instagram"], "k.style01")
        self.assertEqual(data["messenger_handle"], "koreashop.79")
        self.assertEqual(data["city"], "Hanoi")
        self.assertIsNone(data["district"])
        self.assertAlmostEqual(data["lat"], 21.1110372)

    def test_description_json_hannah_shape(self):
        detail = {
            "instagram": None,
            "messenger": "HannahOlala",
            "messenger_handle": None,
            "lat": None,
            "lng": None,
            "district": None,
            "city": None,
            "opening": None,
        }
        data = json.loads(_detail_description_json(detail))
        self.assertEqual(data["messenger"], "HannahOlala")
        self.assertIsNone(data["instagram"])
        self.assertIsNone(data["city"])
        self.assertNotIn("phone", data)

    def test_merge_only_missing(self):
        base = _empty_detail_result(status="SCANNED")
        base["panel_found"] = True
        base["email"] = "a@b.com"
        base["website"] = None
        extra = {
            "panel_found": True,
            "detail_status": "SCANNED",
            "email": "should-not-overwrite@x.com",
            "website": "https://simpleshop.vn/Koreastyle79",
            "phone": "0979680809",
        }
        merged = _merge_detail_missing(base, extra)
        self.assertEqual(merged["email"], "a@b.com")
        self.assertEqual(merged["website"], "https://simpleshop.vn/Koreastyle79")
        self.assertEqual(merged["phone"], "0979680809")
        self.assertEqual(merged["detail_status"], "SCANNED")

    def test_missing_contact(self):
        d = _empty_detail_result(status="SCANNED")
        d["panel_found"] = True
        self.assertTrue(_detail_missing_contact(d))
        d["phone"] = "0979680809"
        d["email"] = "x@y.com"
        d["website"] = "https://hannaholala.com"
        d["address"] = "somewhere"
        self.assertFalse(_detail_missing_contact(d))

    def test_reject_bio_as_address(self):
        bio = (
            "Tin nóng Việt Nam và thế giới, cập nhật 24/7. Video bình luận ngắn về vụ án, "
            "thiên tai, người tốt việc tốt - nhanh, chính xác, có kiểm chứng."
        )
        self.assertIsNone(_sanitize_detail_address(bio))
        ok = "35/26 cát linh, Hanoi, Vietnam, 100000"
        self.assertEqual(_sanitize_detail_address(ok), ok)

    def test_sanitize_email(self):
        self.assertEqual(_sanitize_detail_email("hannaholala@gmail.com"), "hannaholala@gmail.com")
        self.assertIsNone(_sanitize_detail_email("foo.png"))
        self.assertIsNone(_sanitize_detail_email("noreply@facebookmail.com"))


if __name__ == "__main__":
    unittest.main()
