"""Load auth against a database double without opening a production connection."""
import importlib
import sys
import types
from unittest.mock import MagicMock, patch

_loaded = None


def load_auth_modules():
    global _loaded
    if _loaded is None:
        # Keep native extensions imported outside patch.dict's module snapshot.
        security = importlib.import_module("modules.module_auth.security")
        importlib.import_module("psycopg2")
        connection = types.ModuleType("core.database.connection")
        connection.db = MagicMock()
        with patch.dict(sys.modules, {"core.database.connection": connection}):
            service = importlib.import_module("modules.module_auth.service")
            router = importlib.import_module("modules.module_auth.router")
            events = importlib.import_module("modules.module_auth.notification_events")
        _loaded = service, router, security, connection.db, events
    return _loaded
