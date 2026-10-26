import unittest
import uuid
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.module_07_group_spam.app.routes.router import router


app = FastAPI()
app.include_router(router)


class FakeCloudDatabase:
    def __init__(self):
        self.campaign_id = f"test_camp_{uuid.uuid4().hex[:8]}"
        self.run_id = f"test_run_{uuid.uuid4().hex[:8]}"
        self.task_id = f"test_task_{uuid.uuid4().hex[:8]}"
        self.deleted = False

    def campaign(self):
        return {
            "id": self.campaign_id,
            "name": "Campaign Test 1",
            "description": "Test description",
            "action_type": "POST",
            "created_at": "2026-10-26T09:00:00",
            "last_run_at": "2026-10-26T10:00:00",
            "latest_status": "COMPLETED",
            "total_accounts_run": 1,
            "total_runs": 1,
        }

    def log(self):
        return {
            "id": self.task_id,
            "run_id": self.run_id,
            "campaign_id": self.campaign_id,
            "campaign_name": "Campaign Test 1",
            "action_type": "POST",
            "account_uid": "12345",
            "account_name": "",
            "group_key": "grp_1",
            "group_name": "Test Group",
            "group_url": "https://facebook.com/groups/grp_1",
            "content": "Test content",
            "status": "SUCCESS",
            "result_message": "Success",
            "result_url": "https://facebook.com/groups/grp_1/posts/999",
            "finished_at": "2026-10-26T10:00:00",
            "synced_at": "2026-10-26T10:00:00",
        }

    def fetch_one(self, query, params=()):
        if "COUNT(l.log_id)" in query:
            return {"total_count": 1, "success_count": 1, "failed_count": 0}
        if "FROM cloud_group_runs WHERE campaign_id" in query:
            return {
                "id": self.run_id,
                "config_json": {
                    "name": "Campaign Test 1",
                    "account_uids": ["12345"],
                },
                "run_number": 1,
                "created_at": "2026-10-26T10:00:00",
            }
        if "FROM cloud_group_campaigns" in query and not self.deleted:
            return self.campaign()
        return None

    def fetch_all(self, query, params=()):
        if "c.campaign_id AS id" in query and "FROM cloud_group_campaigns c" in query:
            return [] if self.deleted else [self.campaign()]
        if "SELECT campaign_id AS id, name FROM cloud_group_campaigns" in query:
            return [] if self.deleted else [{"id": self.campaign_id, "name": "Campaign Test 1"}]
        if "FROM cloud_group_logs" in query:
            return [self.log()]
        return []

    def execute(self, query, params=()):
        if "UPDATE cloud_group_campaigns" in query:
            self.deleted = True


class CampaignManagementTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.cloud_db = FakeCloudDatabase()
        self.cloud_patch = patch(
            "modules.module_07_group_spam.app.routes.campaign_management.db",
            self.cloud_db,
        )
        self.cloud_patch.start()
        self.addCleanup(self.cloud_patch.stop)

    def test_campaign_lifecycle_and_history(self):
        cid = self.cloud_db.campaign_id

        response = self.client.get("/api/groups/campaigns?q=Test")
        self.assertEqual(response.status_code, 200)
        found = response.json()["campaigns"][0]
        self.assertEqual(found["id"], cid)
        self.assertEqual(found["total_accounts_run"], 1)
        self.assertEqual(found["status"], "COMPLETED")

        details = self.client.get(f"/api/groups/campaigns/{cid}/details")
        self.assertEqual(details.status_code, 200)
        detail_data = details.json()["details"]
        self.assertEqual(len(detail_data), 1)
        self.assertEqual(detail_data[0]["account_uid"], "12345")
        self.assertEqual(
            detail_data[0]["result_url"],
            "https://facebook.com/groups/grp_1/posts/999",
        )

        rerun = self.client.get(f"/api/groups/campaigns/{cid}/rerun")
        self.assertEqual(rerun.status_code, 200)
        rerun_data = rerun.json()
        self.assertEqual(rerun_data["name"], "Campaign Test 1")
        self.assertEqual(rerun_data["config"]["account_uids"], ["12345"])

        history = self.client.get("/api/groups/history?status=SUCCESS")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()["stats"]["success"], 1)

        invalid_dates = self.client.get(
            "/api/groups/history?from_date=2026-10-25&to_date=2026-10-20"
        )
        self.assertEqual(invalid_dates.status_code, 400)

        deleted = self.client.delete(f"/api/groups/campaigns/{cid}")
        self.assertEqual(deleted.status_code, 200)
        after_delete = self.client.get("/api/groups/campaigns")
        self.assertEqual(after_delete.json()["campaigns"], [])


if __name__ == "__main__":
    unittest.main()
