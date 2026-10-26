"""Regression checks for campaign identity, reruns, isolation and deletion."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_07_group_spam.app.local_database import local_db
from modules.module_07_group_spam.app.routes.router import router
from modules.module_07_group_spam.app.services.campaign import CampaignManager


class CampaignFlowTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path_patch = patch.object(local_db, "path", Path(directory.name) / "test.db")
        path_patch.start()
        self.addCleanup(path_patch.stop)
        self.manager = CampaignManager()
        thread_patch = patch.object(self.manager, "_run")
        thread_patch.start()
        self.addCleanup(thread_patch.stop)
        app = FastAPI()
        app.include_router(router)
        self.owner = "owner-1"
        app.dependency_overrides[scoped_owner] = lambda: self.owner
        self.client = TestClient(app)
        self.payload = {"name": "Campaign", "action_type": "POST", "account_uids": ["123"],
                        "groups": [{"key": "group", "url": "https://facebook.com/groups/group"}],
                        "posts": ["Content"], "settings": {"api_key": "secret"}}

    def finish(self, started):
        job = self.manager.jobs[started["job_id"]]
        job.status = "COMPLETED"
        job.total = job.success = 1
        job.finished_at = "2026-10-23T10:00:00"
        job.results = [{"account_uid": "123", "group_key": "group", "group_url": self.payload["groups"][0]["url"],
                        "status": "SUCCESS", "message": "OK"}]
        self.manager._persist_final_results(job)
        return job

    def test_run_is_visible_before_execution_and_rerun_keeps_identity(self):
        first = self.manager.start(dict(self.payload), self.owner)
        campaigns = self.client.get("/api/groups/campaigns").json()["campaigns"]
        self.assertEqual(campaigns[0]["id"], first["campaign_id"])
        self.assertEqual(campaigns[0]["status"], "QUEUED")
        self.finish(first)
        config = self.client.get(f"/api/groups/campaigns/{first['campaign_id']}/rerun").json()
        self.assertNotIn("api_key", config["config"]["settings"])
        second = self.manager.start({**self.payload, "campaign_id": first["campaign_id"]}, self.owner)
        self.assertEqual(second["campaign_id"], first["campaign_id"])
        self.assertNotEqual(second["job_id"], first["job_id"])
        self.finish(second)
        rows = local_db.fetch_all("SELECT run_number FROM group_runs ORDER BY run_number")
        self.assertEqual([r["run_number"] for r in rows], [1, 2])
        listed = self.client.get("/api/groups/campaigns").json()["campaigns"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["total_runs"], 2)
        self.assertEqual(listed[0]["total_interactions"], 2)
        details = self.client.get(f"/api/groups/campaigns/{first['campaign_id']}/details").json()
        self.assertTrue(details["campaign"]["created_at"])
        self.assertEqual(len(details["details"]), 2)
        self.assertEqual(local_db.fetch_one("SELECT COUNT(*) AS n FROM group_sync_outbox")["n"], 4)

    def test_owner_cannot_read_rerun_delete_or_list_another_campaign(self):
        first = self.manager.start(dict(self.payload), self.owner)
        self.finish(first)
        self.owner = "owner-2"
        cid = first["campaign_id"]
        self.assertEqual(self.client.get("/api/groups/campaigns").json()["campaigns"], [])
        for suffix in ["details", "rerun"]:
            self.assertEqual(self.client.get(f"/api/groups/campaigns/{cid}/{suffix}").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/groups/campaigns/{cid}").status_code, 404)
        self.assertEqual(self.client.get("/api/groups/history").json()["campaigns"], [])
        with self.assertRaises(ValueError):
            self.manager.start({**self.payload, "campaign_id": cid}, self.owner)

    def test_delete_requires_terminal_run_and_preserves_history(self):
        first = self.manager.start(dict(self.payload), self.owner)
        cid = first["campaign_id"]
        self.assertEqual(self.client.delete(f"/api/groups/campaigns/{cid}").status_code, 409)
        self.finish(first)
        self.assertEqual(self.client.delete(f"/api/groups/campaigns/{cid}").status_code, 200)
        self.assertEqual(self.client.get("/api/groups/campaigns").json()["campaigns"], [])
        self.assertEqual(self.client.get(f"/api/groups/campaigns/{cid}/rerun").status_code, 404)
        self.assertEqual(self.client.get("/api/groups/history").json()["stats"]["total"], 1)
        with self.assertRaises(ValueError):
            self.manager.start({**self.payload, "campaign_id": cid}, self.owner)

    def test_invalid_date_range_is_rejected(self):
        self.assertEqual(self.client.get("/api/groups/campaigns?from_date=2026-10-25&to_date=2026-10-20").status_code, 400)

    def test_http_start_returns_separate_campaign_and_job_ids_and_stop_updates_db(self):
        with patch("modules.module_07_group_spam.app.routes.campaign.campaign_manager", self.manager):
            response = self.client.post("/api/groups/campaign", json=self.payload)
            self.assertEqual(response.status_code, 200)
            started = response.json()
            self.assertNotEqual(started["campaign_id"], started["job_id"])
            self.assertEqual(started["action_type"], "POST")
            current = self.client.get("/api/groups/campaign/current").json()
            self.assertEqual(current["campaign_id"], started["campaign_id"])
            self.assertEqual(self.client.post(f"/api/groups/campaign/{started['job_id']}/stop").status_code, 200)
            run = local_db.fetch_one("SELECT status FROM group_runs WHERE id = ?", (started["job_id"],))
            self.assertEqual(run["status"], "STOPPING")
