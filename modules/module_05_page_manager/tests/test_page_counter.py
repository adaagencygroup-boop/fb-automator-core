import unittest

from modules.module_05_page_manager.page_counter import (
    anchor_key,
    is_profile_picture_label,
    keep_saved_avatars,
    keep_saved_categories,
    page_name_from_anchor_text,
    pages_from_anchors,
    switcher_page_names,
)


class PageCounterTests(unittest.TestCase):
    def test_profile_picture_label(self):
        self.assertTrue(is_profile_picture_label("Profile picture"))
        self.assertTrue(is_profile_picture_label("Ảnh đại diện"))
        self.assertFalse(is_profile_picture_label("Create post"))

    def test_name_skips_switch_label(self):
        self.assertEqual(page_name_from_anchor_text("Bếp Nhà Chị Nấu\nSwitch now"), "Bếp Nhà Chị Nấu")

    def test_ignores_the_your_pages_list_itself(self):
        href = "https://www.facebook.com/pages/?category=your_pages"
        self.assertEqual(anchor_key(href), "")

    def test_counts_unique_switch_links(self):
        pages = pages_from_anchors([
            ("https://www.facebook.com/profile.php?id=111", "Page A\nChuyển sang"),
            ("https://web.facebook.com/profile.php?id=111&ref=pages", "Page A\nSwitch now"),
            ("https://www.facebook.com/pages/?category=your_pages", "Your pages\nSwitch now"),
            ("https://www.facebook.com/lau-nuong", "Lẩu Nướng\nSwitch now"),
        ])
        self.assertEqual(sorted(page["id"] for page in pages), ["111", "lau-nuong"])
        names = {page["id"]: page["name"] for page in pages}
        self.assertEqual(names["111"], "Page A")
        self.assertEqual(names["lau-nuong"], "Lẩu Nướng")

    def test_keeps_keyword_already_saved_for_the_same_page(self):
        pages = keep_saved_categories(
            [{"id": "111", "name": "Page A", "category": ""}, {"id": "222", "name": "Page B", "category": "mới"}],
            {"111": "du lịch biển"},
        )
        self.assertEqual(pages[0]["category"], "du lịch biển")
        self.assertEqual(pages[1]["category"], "mới")

    def test_keeps_avatar_already_saved_for_the_same_page(self):
        pages = keep_saved_avatars(
            [{"id": "111", "avatar_url": ""}, {"id": "222", "avatar_url": "https://new.example/a.jpg"}],
            {"111": "https://scontent.xx.fbcdn.net/old.jpg"},
        )
        self.assertEqual(pages[0]["avatar_url"], "https://scontent.xx.fbcdn.net/old.jpg")
        self.assertEqual(pages[1]["avatar_url"], "https://new.example/a.jpg")

    def test_switcher_rows_are_pages_except_the_personal_profile(self):
        names = switcher_page_names([
            {"name": "Manh Tuan", "checked": True},
            {"name": "See all profiles", "checked": False},
            {"name": "Bếp Nhà Mẹ Nấu", "checked": False},
            {"name": "1 notification", "checked": False},
            {"name": "Bếp Nhà Mẹ Nấu", "checked": False},
            {"name": "An Nhiên Spa & Beauty", "checked": False},
        ], "Manh Tuan")
        self.assertEqual(names, ["Bếp Nhà Mẹ Nấu", "An Nhiên Spa & Beauty"])


if __name__ == "__main__":
    unittest.main()
