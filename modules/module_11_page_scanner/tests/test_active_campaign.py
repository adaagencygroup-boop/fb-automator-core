"""/campaigns/active chỉ trả phiên đúng loại job của trang (DISCOVERY / FOLLOW / POST_SCAN)."""
from __future__ import annotations

import asyncio
import importlib
import unittest
from unittest import mock

from fastapi import HTTPException

router = importlib.import_module("modules.module_11_page_scanner.api.router")


def _flat(sql: str) -> str:
    return " ".join(sql.split())


class TestActiveCampaignJobType(unittest.TestCase):
    def setUp(self):
        for name, value in (("_get_owner", "42"), ("_sweep_orphan_sessions", [])):
            p = mock.patch.object(router, name, return_value=value)
            p.start()
            self.addCleanup(p.stop)

    def _call(self, **kwargs):
        return asyncio.run(router.get_active_campaign(**kwargs))

    def test_filters_by_requested_job_type(self):
        with mock.patch.object(router.db, "fetch_one", return_value=None) as fetch_one:
            res = self._call(job_type="follow")
        self.assertEqual(res["active"], False)
        sql, params = fetch_one.call_args.args
        self.assertIn("COALESCE(job_type, 'DISCOVERY') = %s", _flat(sql))
        self.assertEqual(params, ("42", "FOLLOW"))

    def test_default_is_discovery(self):
        with mock.patch.object(router.db, "fetch_one", return_value=None) as fetch_one:
            self._call(job_type="DISCOVERY")
        self.assertEqual(fetch_one.call_args.args[1], ("42", "DISCOVERY"))

    def test_campaign_siblings_also_filtered(self):
        top = {"id": 9, "status": "RUNNING", "campaign_id": "camp_x", "settings": "{}"}
        with mock.patch.object(router.db, "fetch_one", return_value=top), \
                mock.patch.object(router.db, "fetch_all", return_value=[top]) as fetch_all:
            res = self._call(job_type="POST_SCAN")
        self.assertTrue(res["active"])
        self.assertEqual(res["job_type"], "POST_SCAN")
        sql, params = fetch_all.call_args.args
        self.assertIn("COALESCE(job_type, 'DISCOVERY') = %s", _flat(sql))
        self.assertEqual(params, ("42", "camp_x", "POST_SCAN"))

    def test_invalid_job_type_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            self._call(job_type="DROP TABLE")
        self.assertEqual(ctx.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
