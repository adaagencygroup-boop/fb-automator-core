"""
Chạy toàn bộ test Module 8 (Interaction Seeding):

    .venv/bin/python modules/module_08_interaction_seeding/tests/run_suite.py

- Không kết nối DB thật: mỗi test dùng SQLite tạm, mọi kết nối psycopg2 tới Supabase đều bị chặn.
- Không vào Facebook: bot Selenium được thay bằng bot giả; test trình duyệt chạy Chrome headless trên trang HTML giả.
- Bỏ qua test trình duyệt: đặt MODULE8_SKIP_BROWSER=1.
"""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[3]


class ForbiddenHostPool:
    def __init__(self, *args, **kwargs):
        pass

    def getconn(self):
        raise AssertionError("Module 8 tests không được kết nối DB thật")


def forbidden_connect(*args, **kwargs):
    raise AssertionError("Module 8 tests không được kết nối DB thật")


def main():
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))
    # Package modules.module_08_interaction_seeding import worker -> core.database.connection, file này mở pool
    # PostgreSQL thật ngay khi import. Thay bằng đối tượng giả TRƯỚC khi nạp bất kỳ test nào.
    sys.modules["core.database.connection"] = MagicMock()
    with patch("psycopg2.pool.ThreadedConnectionPool", ForbiddenHostPool), \
            patch("psycopg2.connect", forbidden_connect):
        suite = unittest.defaultTestLoader.discover(
            "modules/module_08_interaction_seeding/tests", top_level_dir=".")
        result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
