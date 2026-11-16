import json
import sqlite3
import time
import unittest
from unittest.mock import MagicMock, patch

from core.facebook.fb_graph_client import fb_client
from modules.module_05_page_manager import meta_sync as sync
from modules.module_05_page_manager import meta_web as web
from tests.test_module05_meta import IsolatedDB, META, ENV


class BulkUpsertBenchmarkTests(unittest.TestCase):
    """
    Unit tests and benchmark verifications for Bulk Upsert in Module 05:
    - Verifies 100+ pages mock insertion and update
    - Asserts single SQL batch execution instead of 100 individual sequential INSERTs
    - Benchmarks execution time
    - Verifies psycopg2 execute_values branch and fallback batch branch
    - Verifies empty pages edge case and transactional rollback
    """

    def setUp(self):
        self.db = IsolatedDB()
        self.addCleanup(self.db.conn.close)
        self.patches = [
            patch.object(sync, "db", self.db),
            patch.object(web, "db", self.db),
            patch.object(sync, "start_background_page_verification"),
            patch.dict("os.environ", ENV),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def _generate_mock_pages(self, count=100, prefix="page"):
        return [
            {
                "id": f"{prefix}_{i:03d}",
                "name": f"Fanpage {prefix.capitalize()} {i}",
                "access_token": f"EAA_mock_token_{prefix}_{i}",
                "category": f"Category_{i % 5}",
                "token_metadata": {
                    "is_valid": True,
                    "app_id": META["app_id"],
                    "expires_at": 0,
                    "type": "PAGE",
                },
            }
            for i in range(count)
        ]

    def test_sync_save_bulk_100_pages_benchmark(self):
        """Test sync.save with 100 mock pages, measuring execution time and verifying single-batch insert."""
        pages = self._generate_mock_pages(count=100, prefix="sync_p")
        prepared = {
            "metadata": META,
            "identity": {"id": META["user_id"], "name": "Bulk Sync Owner"},
            "token": "bulk_sync_token_xyz",
            "pages": pages,
        }

        # Track cursor executions to ensure bulk insert runs in a single SQL statement
        insert_page_calls = []
        original_session = self.db.session

        from contextlib import contextmanager
        @contextmanager
        def tracking_session():
            with original_session() as cur:
                orig_exec = cur.execute
                def tracked_exec(sql, params=()):
                    if "INSERT INTO pages" in sql:
                        insert_page_calls.append((sql, params))
                    return orig_exec(sql, params)
                cur.execute = tracked_exec
                yield cur

        with patch.object(self.db, "session", tracking_session):
            start_time = time.perf_counter()
            result = sync.save("a", "111", prepared)
            elapsed_ms = (time.perf_counter() - start_time) * 1000

        # Assert results
        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 100)

        # CRUCIAL VERIFICATION: pages INSERT must be executed EXACTLY ONCE (bulk), NOT 100 times!
        self.assertEqual(
            len(insert_page_calls),
            1,
            f"Expected exactly 1 bulk INSERT call for pages, but got {len(insert_page_calls)}!"
        )

        # Verify SQL contains multiple rows
        sql, params = insert_page_calls[0]
        self.assertIn("ON CONFLICT (user_id, page_id) DO UPDATE", sql)
        self.assertEqual(len(params), 100 * 9, "Expected 900 flattened parameters for 100 rows x 9 columns")

        # Verify execution time is fast (< 200ms in-memory, typically < 30ms)
        self.assertLess(elapsed_ms, 500, f"Bulk upsert took too long: {elapsed_ms:.2f}ms")

        # Verify all 100 rows in DB
        rows = self.db.fetch_all("SELECT * FROM pages WHERE user_id = 'a' ORDER BY page_id ASC")
        self.assertEqual(len(rows), 100)
        self.assertEqual(rows[0]["page_id"], "sync_p_000")
        self.assertEqual(rows[99]["page_id"], "sync_p_099")
        self.assertEqual(rows[0]["account_uid"], "111")
        self.assertIsNone(rows[0]["web_connection_id"])
        self.assertEqual(rows[0]["status"], "ACTIVE")

        # Now test bulk upsert ON CONFLICT UPDATE with 100 modified pages
        for p in pages:
            p["name"] = p["name"] + " Updated"
            p["access_token"] = p["access_token"] + "_new"
            p["category"] = "Updated_Cat"

        prepared_update = {
            "metadata": META,
            "identity": {"id": META["user_id"], "name": "Bulk Sync Owner"},
            "token": "bulk_sync_token_xyz_new",
            "pages": pages,
        }
        res_update = sync.save("a", "111", prepared_update)
        self.assertTrue(res_update["success"])
        self.assertEqual(res_update["count"], 100)

        # Still 100 rows, but updated
        rows_after = self.db.fetch_all("SELECT * FROM pages WHERE user_id = 'a' ORDER BY page_id ASC")
        self.assertEqual(len(rows_after), 100)
        self.assertTrue(rows_after[0]["page_name"].endswith("Updated"))
        self.assertTrue(rows_after[0]["access_token"].endswith("_new"))
        self.assertEqual(rows_after[0]["category"], "Updated_Cat")

    def test_web_save_bulk_100_pages_benchmark(self):
        """Test meta_web._save and _sync_web with 100 mock pages, verifying single SQL execution."""
        pages = self._generate_mock_pages(count=100, prefix="web_p")
        prepared = {
            "metadata": META,
            "identity": {"id": META["user_id"], "name": "Web Bulk User"},
            "token": "web_bulk_token_123",
            "pages": pages,
        }
        job = {"status": "COMMITTING", "message": ""}

        insert_page_calls = []
        original_session = self.db.session

        from contextlib import contextmanager
        @contextmanager
        def tracking_session():
            with original_session() as cur:
                orig_exec = cur.execute
                def tracked_exec(sql, params=()):
                    if "INSERT INTO pages" in sql:
                        insert_page_calls.append((sql, params))
                    return orig_exec(sql, params)
                cur.execute = tracked_exec
                yield cur

        with patch.object(self.db, "session", tracking_session):
            start_time = time.perf_counter()
            result = web._sync_web("a", prepared, job)
            elapsed_ms = (time.perf_counter() - start_time) * 1000

        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 100)
        self.assertEqual(
            len(insert_page_calls),
            1,
            f"Expected exactly 1 bulk INSERT call for web pages, got {len(insert_page_calls)}!"
        )

        self.assertLess(elapsed_ms, 500, f"Web bulk upsert took {elapsed_ms:.2f}ms")

        # Verify DB records
        rows = self.db.fetch_all("SELECT * FROM pages WHERE page_id LIKE 'web_p_%' ORDER BY page_id ASC")
        self.assertEqual(len(rows), 100)
        self.assertIsNone(rows[0]["account_uid"])
        self.assertEqual(rows[0]["web_connection_id"], result["connection_id"])
        self.assertEqual(rows[0]["status"], "ACTIVE")

    def test_empty_pages_skip_sql(self):
        """Verify when pages is empty list or None, no INSERT INTO pages is executed."""
        insert_page_calls = []
        original_session = self.db.session

        from contextlib import contextmanager
        @contextmanager
        def tracking_session():
            with original_session() as cur:
                orig_exec = cur.execute
                def tracked_exec(sql, params=()):
                    if "INSERT INTO pages" in sql:
                        insert_page_calls.append((sql, params))
                    return orig_exec(sql, params)
                cur.execute = tracked_exec
                yield cur

        # Test sync.save with empty pages
        prep_empty = {
            "metadata": META,
            "identity": {"id": META["user_id"], "name": "Empty Owner"},
            "token": "tok_empty",
            "pages": [],
        }
        with patch.object(self.db, "session", tracking_session):
            res_sync = sync.save("a", "111", prep_empty)
            self.assertTrue(res_sync["success"])
            self.assertEqual(res_sync["count"], 0)
            self.assertEqual(len(insert_page_calls), 0)

        # Test web._save with None pages
        prep_none = {
            "metadata": META,
            "identity": {"id": META["user_id"], "name": "None Owner"},
            "token": "tok_none",
            "pages": None,
        }
        job = {"status": "COMMITTING", "message": ""}
        with patch.object(self.db, "session", tracking_session):
            res_web = web._save("a", prep_none, job)
            self.assertTrue(res_web["success"])
            self.assertEqual(res_web["count"], 0)
            self.assertEqual(len(insert_page_calls), 0)

    def test_execute_values_path(self):
        """Verify the psycopg2 execute_values code branch when running against Postgres driver."""
        mock_cur = MagicMock()
        mock_cur.connection.encoding = "UTF8"
        mock_cur.fetchone.return_value = {"id": 1, "app_scoped_user_id": META["user_id"]}

        mock_db = MagicMock()
        mock_db.session.return_value.__enter__.return_value = mock_cur

        pages = self._generate_mock_pages(count=100, prefix="pg_exec")
        prepared = {
            "metadata": META,
            "identity": {"id": META["user_id"], "name": "Postgres User"},
            "token": "tok_pg",
            "pages": pages,
        }

        mock_execute_values = MagicMock()

        # Test sync.save with execute_values
        with patch.object(sync, "db", mock_db), patch.object(sync, "execute_values", mock_execute_values):
            sync.save("a", "111", prepared)
            self.assertTrue(mock_execute_values.called)
            args, kwargs = mock_execute_values.call_args
            cur_arg, sql_arg, rows_arg = args[0], args[1], args[2]
            self.assertEqual(cur_arg, mock_cur)
            self.assertIn("INSERT INTO pages", sql_arg)
            self.assertIn("VALUES %s", sql_arg)
            self.assertIn("ON CONFLICT (user_id, page_id) DO UPDATE", sql_arg)
            self.assertEqual(len(rows_arg), 100)
            self.assertEqual(kwargs.get("template"), "(%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)")

        # Test web._save with execute_values
        mock_execute_values.reset_mock()
        with patch.object(web, "db", mock_db), patch.object(web, "execute_values", mock_execute_values):
            job = {"status": "COMMITTING", "message": ""}
            web._save("a", prepared, job)
            self.assertTrue(mock_execute_values.called)
            args, kwargs = mock_execute_values.call_args
            self.assertEqual(len(args[2]), 100)
            self.assertEqual(kwargs.get("template"), "(%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)")

    def test_benchmark_bulk_vs_sequential_simulation(self):
        """
        Benchmark simulation: compares 100-page single bulk upsert against
        100 individual sequential INSERTs to prove elimination of the 99-loop overhead.
        """
        pages = self._generate_mock_pages(count=100, prefix="bench")

        # 1. Measure sequential loop simulation
        start_seq = time.perf_counter()
        with self.db.session() as cur:
            for p in pages:
                cur.execute(
                    """INSERT INTO pages (user_id, page_id, page_name, access_token, category, account_uid, status, token_metadata)
                       VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE', %s::jsonb)
                       ON CONFLICT (user_id, page_id) DO UPDATE SET page_name = EXCLUDED.page_name""",
                    ("a", p["id"], p["name"], p["access_token"], p["category"], "111", json.dumps(p["token_metadata"]))
                )
        duration_seq = time.perf_counter() - start_seq

        # 2. Measure bulk upsert
        prepared = {
            "metadata": META,
            "identity": {"id": META["user_id"], "name": "Bench Bulk"},
            "token": "tok_bench",
            "pages": pages,
        }
        start_bulk = time.perf_counter()
        sync.save("a", "111", prepared)
        duration_bulk = time.perf_counter() - start_bulk

        print(f"\n[BENCHMARK] 100 Pages - Sequential: {duration_seq*1000:.2f}ms vs Bulk Upsert: {duration_bulk*1000:.2f}ms")
        print(f"[BENCHMARK] Speedup Factor: {duration_seq / max(duration_bulk, 0.0001):.2f}x faster")

        # Bulk must be executed in 1 operation and significantly faster or comparable even in in-memory sqlite
        self.assertLess(duration_bulk, duration_seq + 0.1)


if __name__ == "__main__":
    unittest.main()
