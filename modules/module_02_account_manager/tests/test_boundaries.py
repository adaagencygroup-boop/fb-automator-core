import ast
import importlib
from pathlib import Path
import unittest
from unittest.mock import patch

class BoundaryTests(unittest.TestCase):
    def test_plugin_import_never_initializes_database_or_hardware(self):
        import subprocess
        import sys
        code = """
from unittest.mock import patch
with patch("sqlalchemy.create_engine", side_effect=AssertionError("DB at import")), patch("subprocess.run", side_effect=AssertionError("Hardware at import")):
    from modules.module_02_account_manager import plugin
    from modules.module_02_account_manager.api.router import router
    from modules.module_02_account_manager.database import connection
    assert connection.engine is None
"""
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_no_host_or_source_project_imports(self):
        root = Path(__file__).resolve().parents[1]
        forbidden = {"app", "config", "PyQt5"}
        allowed_core_prefixes = ("core.browser",)
        for path in root.rglob("*.py"):
            if "tests" in path.parts:
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                imports = [node.module] if isinstance(node, ast.ImportFrom) and not node.level else [item.name for item in node.names] if isinstance(node, ast.Import) else []
                for name in imports:
                    if not name:
                        continue
                    root_pkg = name.split(".")[0]
                    self.assertNotIn(root_pkg, forbidden, str(path))
                    if root_pkg == "core":
                        self.assertTrue(
                            any(name == pref or name.startswith(pref + ".") for pref in allowed_core_prefixes),
                            f"Disallowed core import '{name}' in {path}",
                        )
