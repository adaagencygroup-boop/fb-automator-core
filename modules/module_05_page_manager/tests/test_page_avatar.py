import unittest

from modules.module_05_page_manager.page_avatar import avatar_from_html, valid_page_avatar


class PageAvatarTests(unittest.TestCase):
    def test_reads_profile_image_from_og_tag(self):
        html = (
            '<meta property="og:image" content="https://scontent.fhan18-1.fna.fbcdn.net'
            '/v/t39.30808-1/843141881_122095249635516707_n.png?_nc_cat=1" />'
        )
        url = avatar_from_html(html)
        self.assertTrue(url.startswith("https://scontent.fhan18-1.fna.fbcdn.net/"))
        self.assertTrue(valid_page_avatar(url))

    def test_rejects_graph_silhouette(self):
        html = (
            '<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/t1.30497-1/'
            '84628273_176159830277856_972693363922829312_n.jpg" />'
        )
        self.assertEqual(avatar_from_html(html), "")
        self.assertFalse(valid_page_avatar("https://graph.facebook.com/1/picture"))


if __name__ == "__main__":
    unittest.main()
