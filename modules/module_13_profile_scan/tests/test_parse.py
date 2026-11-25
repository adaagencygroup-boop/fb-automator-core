import unittest

from modules.module_13_profile_scan.parse import (
    about_region, bio_from_source, find_phones, page_state, parse_about, parse_counts, parse_intro, profile_key,
    section_url, uid_from_source,
)


class KeyTests(unittest.TestCase):
    def test_forms(self):
        for raw, want in {
            "id:61591833389526": "id:61591833389526",
            "user:An.Yen": "user:an.yen",
            "100076461610282": "id:100076461610282",
            "https://www.facebook.com/profile.php?id=100076461610282&__cft__[0]=x": "id:100076461610282",
            "https://m.facebook.com/people/A-B/100076461610282/": "id:100076461610282",
            "facebook.com/Zuck/about": "user:zuck",
            "https://facebook.com/groups/123": None,
            "https://evil.com/zuck": None,
            "https://notfacebook.com/zuck": None,
            "12": None,
            "": None,
        }.items():
            self.assertEqual(profile_key(raw), want, raw)

    def test_section(self):
        self.assertEqual(section_url("id:12345", "about"), "https://www.facebook.com/profile.php?id=12345&sk=about")
        self.assertEqual(section_url("user:zuck", "about"), "https://www.facebook.com/zuck/about")


class CountTests(unittest.TestCase):
    def check(self, text, friends, followers):
        self.assertEqual(parse_counts(text), {"friends": friends, "followers": followers}, text)

    def test_counts(self):
        self.check("Na Na Star\n27K followers • 8 following", None, 27000)
        self.check("1.234 bạn bè · 1,2K người theo dõi", 1234, 1200)
        self.check("4,890 friends", 4890, None)
        self.check("1,5 triệu người theo dõi", None, 1500000)
        self.check("3 mutual friends · 12 bạn chung", None, None)
        self.check("0 followers", None, 0)
        self.check("Không có gì", None, None)


class PhoneTests(unittest.TestCase):
    def test_formats(self):
        for text, want in {
            "098 578 66 30": ["0985786630"],
            "(+84)912-345-678": ["0912345678"],
            "+84 (0) 912 345 678": ["0912345678"],
            "84912345678": ["0912345678"],
            "O912.345.678": ["0912345678"],
            "0️⃣9️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣": ["0912345678"],
            "𝟎𝟗𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖": ["0912345678"],
            "Zalo 0912345678 / 0987654321": ["0912345678", "0987654321"],
            "02438261234": ["02438261234"],
            "STK 0123456789 MB": [],
            "stk: 0912345678": [],
            "0912345678 - MB Bank": [],
            "Vietcombank 0912345678": [],
            "100076461610282": [],
            "Giá 350.000": [],
        }.items():
            self.assertEqual(find_phones(text), want, text)


class AboutTests(unittest.TestCase):
    def test_overview_vi(self):
        text = """Nguyễn A\nBài viết\nGiới thiệu\nBạn bè\nẢnh\nGiới thiệu\nTổng quan\nCông việc và học vấn
Làm việc tại Công ty ABC\nĐã học Marketing tại Đại học Ngoại thương\nSống tại Hà Nội\nĐến từ Nam Định
0912 345 678\nDi động\nBạn bè\nĐến từ Huế"""
        got = parse_about(about_region(text))
        self.assertEqual(got["job_place"], "Công ty ABC")
        self.assertEqual(got["education"], "Đại học Ngoại thương")
        self.assertEqual(got["location"], "Hà Nội")
        self.assertEqual(got["hometown"], "Nam Định")
        self.assertEqual(got["phone"], "0912345678")

    def test_sections_en(self):
        got = parse_about([
            "Work", "CEO at ABC Group", "2019 - Present", "College", "FTU", "High school", "No schools to show",
            "Hanoi, Vietnam", "Current city", "Nam Dinh", "Hometown", "13 November", "Birth date", "1990", "Birth year",
        ])
        self.assertEqual((got["job_title"], got["job_place"]), ("CEO", "ABC Group"))
        self.assertEqual(got["education"], "FTU")
        self.assertEqual(got["location"], "Hanoi, Vietnam")
        self.assertEqual(got["hometown"], "Nam Dinh")
        self.assertEqual(got["birthday"], "13 November, 1990")

    def test_empty_not_saved(self):
        self.assertEqual(parse_about(["Work", "No workplaces to show", "College", "Không có trường học để hiển thị"]), {})

    def test_intro(self):
        got = parse_intro(["Giới thiệu", "Quản lý tại Cửa hàng X", "Học tại FPT", "Sống tại Đà Nẵng"])
        self.assertEqual((got["job_title"], got["job_place"], got["education"], got["location"]), ("Quản lý", "Cửa hàng X", "FPT", "Đà Nẵng"))


class SourceTests(unittest.TestCase):
    def test_uid(self):
        src = '"USER_ID":"111111"…"userVanity":"me","userID":"111111"…"userVanity":"zuck","userID":"4444444"'
        self.assertEqual(uid_from_source(src, "zuck", "111111"), "4444444")
        self.assertIsNone(uid_from_source('"profileID":"111111"', None, "111111"))

    def test_bio(self):
        self.assertEqual(bio_from_source(r'"profile_intro_card":{"bio":{"text":"Xin chào\n\"A\""}'), 'Xin chào\n"A"')

    def test_state(self):
        self.assertEqual(page_state("This content isn’t available right now", False), "UNAVAILABLE")
        self.assertEqual(page_state("Nguyễn A\nbài viết: This content isn't available", True), "OK")
        self.assertEqual(page_state("A locked her profile", True), "LOCKED")
        self.assertEqual(page_state("You’re Temporarily Blocked", False), "BLOCKED")


if __name__ == "__main__":
    unittest.main()
