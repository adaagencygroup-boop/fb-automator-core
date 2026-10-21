import json
import unittest
from unittest.mock import Mock, patch

from modules.module_03_acc_farm import repository
from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.farming import flow as farming_flow


class AddLogTargetsTests(unittest.TestCase):
    def write_log(self, **kwargs):
        queued, executed = [], []
        with patch.object(repository.writer, "put", side_effect=lambda label, fn: queued.append(fn)), \
                patch.object(repository.db, "execute", side_effect=lambda sql, params: executed.append((sql, params))):
            repository.add_log(7, "m1", "100", "ADD_FRIEND", "SUCCESS", 2, "ok", **kwargs)
            queued[0]()
        return executed[0]

    def test_targets_saved_as_json(self):
        people = [{"name": "Nguyễn Văn A", "url": "https://www.facebook.com/profile.php?id=1"}]
        sql, params = self.write_log(targets=people)
        cols = sql.split("(")[1].split(")")[0].split(", ")
        self.assertIn("targets", cols)
        self.assertEqual(json.loads(params[cols.index("targets")]), people)

    def test_no_targets_keeps_old_insert(self):
        # Hành động không có đối tượng không đụng cột targets (DB chưa thêm cột vẫn ghi được)
        sql, _ = self.write_log()
        self.assertNotIn("targets", sql)


class DetailTargetsTests(unittest.TestCase):
    def test_json_list(self):
        self.assertEqual(farm_routes._json_list('[{"name": "A"}]'), [{"name": "A"}])
        self.assertEqual(farm_routes._json_list(None), [])
        self.assertEqual(farm_routes._json_list("hỏng"), [])
        self.assertEqual(farm_routes._json_list('{"name": "A"}'), [])


class ReadTargetTests(unittest.TestCase):
    def read(self, returned):
        driver = Mock()
        driver.execute_script.return_value = returned
        return farming_flow._read_target(driver, Mock(), "friend")

    def test_keeps_facebook_link_and_trims_name(self):
        out = self.read({"name": "  " + "A" * 200, "url": "https://www.facebook.com/profile.php?id=1"})
        self.assertEqual((len(out["name"]), out["url"]), (150, "https://www.facebook.com/profile.php?id=1"))

    def test_drops_non_facebook_link(self):
        self.assertEqual(self.read({"name": "A", "url": "javascript:alert(1)"}), {"name": "A", "url": None})

    def test_unreadable_card_still_counts(self):
        self.assertEqual(self.read(None), {"name": None, "url": None})

    def test_script_error_does_not_break_flow(self):
        driver = Mock()
        driver.execute_script.side_effect = farming_flow.WebDriverException("stale")
        self.assertEqual(farming_flow._read_target(driver, Mock(), "group", "t1"), {"name": None, "url": None})


class GroupStatusTests(unittest.TestCase):
    LIST = "https://www.facebook.com/search/groups/?q=tro"

    def status(self, current_url, script_result, outcome="none"):
        driver = Mock(current_url=current_url)
        driver.execute_script.return_value = script_result
        return farming_flow._group_join_status(driver, "t1", self.LIST, outcome)

    def test_redirected_to_group_means_joined(self):
        self.assertEqual(self.status("https://www.facebook.com/groups/123/", None), "joined")

    def test_reads_card_status(self):
        self.assertEqual(self.status(self.LIST, "pending"), "pending")
        self.assertEqual(self.status(self.LIST, "joined"), "joined")

    def test_answered_form_defaults_to_pending(self):
        self.assertEqual(self.status(self.LIST, None, outcome="submitted"), "pending")
        self.assertIsNone(self.status(self.LIST, None))


if __name__ == "__main__":
    unittest.main()
