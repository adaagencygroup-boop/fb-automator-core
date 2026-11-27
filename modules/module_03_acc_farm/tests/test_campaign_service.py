import unittest
from datetime import datetime, timedelta, timezone

from modules.module_03_acc_farm import campaign_service as svc
from modules.module_03_acc_farm.post_now_service import ComposeInput

TZ = timezone(timedelta(hours=7))
NOW = datetime(2026, 11, 27, 9, 0, 30, tzinfo=TZ)


class SlotTimeTests(unittest.TestCase):
    def test_sorted_and_today(self):
        times = svc.parse_slot_times(["14:00", "9:30", "23:59"], NOW)
        self.assertEqual([t.strftime("%H:%M") for t in times], ["09:30", "14:00", "23:59"])
        self.assertTrue(all(t.date() == NOW.date() and t.tzinfo for t in times))

    def test_needs_five_minutes_lead(self):
        with self.assertRaises(svc.CampaignError):
            svc.parse_slot_times(["09:05"], NOW)  # 4m30s sau bây giờ
        self.assertEqual(len(svc.parse_slot_times(["09:06"], NOW)), 1)
        with self.assertRaises(svc.CampaignError):
            svc.parse_slot_times(["08:00"], NOW)

    def test_keep_existing_waiting_slot(self):
        old = NOW.replace(hour=9, minute=2, second=0).astimezone(timezone.utc)
        self.assertEqual(len(svc.parse_slot_times(["09:02"], NOW, keep=[old])), 1)

    def test_bad_format_and_duplicate(self):
        with self.assertRaises(svc.CampaignError) as ctx:
            svc.parse_slot_times(["25:00", "10:00", "10:00", "abc"], NOW)
        self.assertEqual(len(ctx.exception.errors), 3)

    def test_gap_warning(self):
        settings = {"thread_count": 1, "min_delay": 600, "max_delay": 900}
        # 3 nick, 1 luồng: 3×2 phút + 2×12.5 phút ≈ 31 phút
        self.assertEqual(svc.estimate_slot_seconds(3, settings), 3 * 120 + 2 * 750)
        times = svc.parse_slot_times(["10:00", "10:20", "12:00"], NOW)
        warnings = svc.slot_gap_warnings(times, 3, settings)
        self.assertEqual(len(warnings), 1)
        self.assertIn("10:20", warnings[0])


class ValidateTests(unittest.TestCase):
    def test_accounts_strip_credentials(self):
        accs = svc.normalize_accounts([{"uid": " 1 ", "name": "A", "password": "x", "cookie": "c"}, {"uid": "1"}, {}])
        self.assertEqual(accs, [{"uid": "1", "name": "A"}])

    def test_settings_clamped(self):
        self.assertEqual(svc.normalize_settings(0, 900, 100), {"thread_count": 1, "min_delay": 100, "max_delay": 900})

    def test_preview_collects_everything(self):
        res = svc.preview(ComposeInput(content_text="A\n---\nB"), 3, ["08:00", "10:00", "10:05"],
                          {"thread_count": 1, "min_delay": 600, "max_delay": 900}, now=NOW)
        self.assertFalse(res["ok"])
        self.assertTrue(any("08:00" in e for e in res["errors"]))
        self.assertTrue(any("ít hơn" in e or "nick" in e for e in res["errors"]))
        self.assertEqual(res["parsed"]["count"], 2)

    def test_missing_images_block(self):
        _, check = svc.check_compose(
            ComposeInput(content_text="A\n---\nB", image_mode="SINGLE", image_paths=["x.jpg"]), 2, 1,
            file_exists=lambda p: False,
        )
        self.assertFalse(check.ok)

    def test_can_rerun(self):
        self.assertTrue(svc.can_rerun({"status": "MISSED"}))
        self.assertTrue(svc.can_rerun({"status": "DONE", "failed_count": 2}))
        self.assertFalse(svc.can_rerun({"status": "DONE", "failed_count": 0}))
        self.assertFalse(svc.can_rerun({"status": "RUNNING"}))


if __name__ == "__main__":
    unittest.main()
