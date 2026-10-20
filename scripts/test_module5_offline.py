"""Run Module 5 regressions without ever opening the production DB."""
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
connection = types.ModuleType("core.database.connection")
connection.db = MagicMock()
sys.modules["core.database.connection"] = connection
suite = unittest.defaultTestLoader.loadTestsFromNames(sys.argv[1:] or [
    "tests.test_module05_meta", "tests.test_module05_web_popup", "tests.test_module_05_flow", "tests.test_reels_poster",
    "modules.module_05_page_manager.tests.test_ai_schedule",
    "modules.module_05_page_manager.tests.test_page_counter",
    "modules.module_02_account_manager.tests.test_account_deletion",
])
result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(not result.wasSuccessful())
