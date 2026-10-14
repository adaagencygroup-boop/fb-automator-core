"""Run Module 2 without allowing eager host imports to open a production pool."""
import sys
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch


class ForbiddenHostPool:
    def __init__(self, *args, **kwargs):
        pass

    def getconn(self):
        raise AssertionError("Host database access forbidden in Module 2 tests")


def main():
    with patch("psycopg2.pool.ThreadedConnectionPool", ForbiddenHostPool):
        suite = unittest.defaultTestLoader.discover(
            "modules/module_02_account_manager/tests", top_level_dir=".")
        result = unittest.TextTestRunner(verbosity=2).run(suite)
    if os.getenv("MODULE2_RESULTS"):
        Path(os.environ["MODULE2_RESULTS"], "be-summary.json").write_text(json.dumps({
            "run": result.testsRun, "passed": result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped),
            "failures": len(result.failures), "errors": len(result.errors),
            "blocked": [{"test": str(test), "reason": reason} for test, reason in result.skipped],
        }, indent=2), encoding="utf-8")
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
