"""Missing pagination/search/batch contracts using the real router, isolated SQLite."""
from . import test_pagination as original
from ..database.models import Account


class TestModule2Matrix(original.TestPagination):
    # Existing cases remain in their original suite, rather than inherited twice.
    test_boundaries_and_limit = None
    test_search_filters_stats_and_owner = None
    test_changes_between_pages_and_existing_uids = None
    test_duplicate_outside_first_page_and_defaults = None
    test_authenticated_owner_applies_to_new_endpoints = None

    def test_be01_small_counts_and_small_limit(self):
        for count in (1, 9):
            with self.subTest(count=count):
                with self.sessions() as db:
                    db.query(Account).delete()
                    db.commit()
                self.add(count)
                cursor, seen = None, []
                for _ in range(count + 1):
                    page = self.page(limit=3, **({"cursor": cursor} if cursor else {})).json()
                    self.assertEqual(page["total"], count)
                    self.assertLessEqual(len(page["accounts"]), 3)
                    seen.extend(row["uid"] for row in page["accounts"])
                    if not page["has_more"]:
                        break
                    cursor = page["next_cursor"]
                self.assertEqual(len(set(seen)), count)

    def test_be02_cursor_validation_and_foreign_boundary(self):
        self.add(11)
        self.add(1, "bob")
        for cursor in ("bad", 0, -1, "1.5"):
            with self.subTest(cursor=cursor):
                self.assertEqual(self.page(cursor=cursor).status_code, 422)
        for cursor in (1, 999999, 12):
            page = self.page(cursor=cursor).json()
            self.assertEqual(page["total"], 11)
            self.assertTrue(all(row["user_id"] == "alice" for row in page["accounts"]))

    def test_be03_literal_search_and_whitespace(self):
        with self.sessions() as db:
            for i, name in enumerate(("Percent%", "Under_score", "Back\\slash", "ordinary")):
                db.add(Account(uid=str(2000+i), user_id="alice", profile_name=name))
            db.commit()
        for term, uid in ((" % ", "2000"), ("_", "2001"), ("\\", "2002"), ("  pErCeNt%  ", "2000")):
            with self.subTest(term=term):
                result = self.page(search=term).json()
                self.assertEqual([row["uid"] for row in result["accounts"]], [uid])
        self.assertEqual(self.page(search="   ").json()["total"], 4)

    def test_be04_large_uid_batch_and_owner_isolation(self):
        self.add(37)
        self.add(1, "bob")
        def lookup(uids):
            response = self.client.post("/api/accounts/existing-uids", json={"owner_username": "alice", "uids": uids})
            self.assertEqual(response.status_code, 200)
            return response.json()["uids"]
        self.assertEqual(lookup([]), [])
        self.assertEqual(lookup(["1000", "1000", "9999"]), ["1000"])
        self.assertEqual(set(lookup([str(i) for i in range(1000, 1601)])), {str(i) for i in range(1000, 1037)})

    def test_be05_duplicate_across_batch_chunks_is_unique(self):
        self.add(1)
        uids = ["1000"] + [str(i) for i in range(2000, 2500)] + ["1000"]
        response = self.client.post("/api/accounts/existing-uids", json={"owner_username": "alice", "uids": uids})
        self.assertEqual(response.json()["uids"], ["1000"])

    def test_be06_mutations_update_global_stats(self):
        self.add(11)
        self.add(1, "bob")
        def stats():
            return self.client.get("/api/accounts/stats?owner_username=alice").json()
        response = self.client.post("/api/accounts/import", json={"owner_username": "alice", "skip_existing": True, "accounts": [{"uid": "1000"}, {"uid": "9000"}, {"uid": "9000"}]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["added_count"], 1)
        self.assertEqual(response.json()["skipped_count"], 2)
        self.assertEqual(stats(), {"total": 12, "live": 5, "die": 6})
        response = self.client.post("/api/accounts/single", json={"owner_username": "alice", "uid": "9001", "original_uid": "9000", "email": "changed@example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(stats()["total"], 12)
        self.assertEqual(self.page(search="changed@example.com").json()["total"], 1)
        self.assertEqual(self.client.delete("/api/accounts/9001?owner_username=alice").status_code, 200)
        self.assertEqual(stats()["total"], 11)
        self.assertEqual(self.client.get("/api/accounts/stats?owner_username=bob").json()["total"], 1)
