import unittest

from modules.module_04_page_creator.automation.facebook_urls import (
    facebook_picture_id,
    facebook_picture_url,
)


class FacebookPictureTests(unittest.TestCase):
    def test_uid_becomes_graph_url(self):
        self.assertEqual(facebook_picture_id("100030974022800"), "100030974022800")
        self.assertEqual(
            facebook_picture_url("100030974022800"),
            "https://graph.facebook.com/100030974022800/picture?type=square&width=80&height=80",
        )

    def test_profile_php_id(self):
        url = "https://www.facebook.com/profile.php?id=61577351974413"
        self.assertEqual(facebook_picture_id(url), "61577351974413")

    def test_vanity_username(self):
        self.assertEqual(
            facebook_picture_id("https://www.facebook.com/BepNhaChiNau"),
            "BepNhaChiNau",
        )

    def test_people_and_pages_numeric_tail(self):
        self.assertEqual(
            facebook_picture_id("https://www.facebook.com/people/Bep-Nha/61577351974413"),
            "61577351974413",
        )
        self.assertEqual(
            facebook_picture_id("https://www.facebook.com/pages/category/Restaurant/123456789"),
            "123456789",
        )

    def test_empty_and_system_paths(self):
        self.assertEqual(facebook_picture_id(""), "")
        self.assertEqual(facebook_picture_url(""), "")
        self.assertEqual(facebook_picture_id("https://www.facebook.com/login"), "")
        self.assertEqual(facebook_picture_id("https://www.facebook.com/messages"), "")
        self.assertEqual(facebook_picture_url("not-a-facebook-url"), "")


if __name__ == "__main__":
    unittest.main()
