import unittest

from modules.module_04_page_creator.automation.share_admin_flow import clean_admin_display_name


class CleanAdminDisplayNameTest(unittest.TestCase):
    def test_keeps_the_name_above_role_and_uid(self):
        text = "Trương Minh\nBạn bè\n100030974022800"
        self.assertEqual(clean_admin_display_name(text, "100030974022800"), "Trương Minh")

    def test_reads_a_single_name_line(self):
        self.assertEqual(clean_admin_display_name("Lan Anh", "100030974022800"), "Lan Anh")

    def test_skips_uid_mutual_friends_and_blank(self):
        text = "100030974022800\n3 bạn chung\n \nNguyễn Hà"
        self.assertEqual(clean_admin_display_name(text, "100030974022800"), "Nguyễn Hà")

    def test_empty_when_only_noise(self):
        self.assertEqual(clean_admin_display_name("Bạn bè\nFriend", "100030974022800"), "")


if __name__ == "__main__":
    unittest.main()
