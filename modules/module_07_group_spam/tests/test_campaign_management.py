import json
import unittest
import uuid
from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.module_07_group_spam.app.routes.router import router
from modules.module_07_group_spam.app.local_database import local_db

app = FastAPI()
app.include_router(router)


class CampaignManagementTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        local_db.initialize()

    def test_campaign_lifecycle_and_history(self):
        cid = f"test_camp_{uuid.uuid4().hex[:8]}"
        run_id = f"test_run_{uuid.uuid4().hex[:8]}"
        task_id = f"test_task_{uuid.uuid4().hex[:8]}"

        # Insert test data into SQLite
        with local_db.session() as cursor:
            cursor.execute(
                """
                    INSERT INTO group_campaigns (id, owner_key, name, description, action_type)
                    VALUES (?, 'test_owner', 'Chiến dịch Test 1', 'Mô tả test', 'POST')
                """,
                (cid,),
            )
            cursor.execute(
                """
                    INSERT INTO group_runs (id, campaign_id, run_number, status, config_json, total_planned, total_success)
                    VALUES (?, ?, 1, 'COMPLETED', ?, 2, 2)
                """,
                (run_id, cid, json.dumps({"name": "Chiến dịch Test 1", "account_uids": ["12345"]})),
            )
            cursor.execute(
                """
                    INSERT INTO group_run_tasks (id, run_id, account_uid, group_key, group_name, group_url, status, result_message, result_url)
                    VALUES (?, ?, '12345', 'grp_1', 'Hội Sinh Viên', 'https://facebook.com/groups/grp_1', 'SUCCESS', 'Đã đăng bài', 'https://facebook.com/groups/grp_1/posts/999')
                """,
                (task_id, run_id),
            )

        # 1. List campaigns
        res = self.client.get("/api/groups/campaigns?q=Test")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreaterEqual(data["count"], 1)
        found = next((c for c in data["campaigns"] if c["id"] == cid), None)
        self.assertIsNotNone(found)
        self.assertEqual(found["total_accounts_run"], 1)
        self.assertEqual(found["status"], "COMPLETED")

        # 2. Details
        res_det = self.client.get(f"/api/groups/campaigns/{cid}/details")
        self.assertEqual(res_det.status_code, 200)
        det_data = res_det.json()
        self.assertEqual(len(det_data["details"]), 1)
        self.assertEqual(det_data["details"][0]["account_uid"], "12345")
        self.assertEqual(det_data["details"][0]["result_url"], "https://facebook.com/groups/grp_1/posts/999")

        # 3. Rerun config
        res_rerun = self.client.get(f"/api/groups/campaigns/{cid}/rerun")
        self.assertEqual(res_rerun.status_code, 200)
        rerun_data = res_rerun.json()
        self.assertEqual(rerun_data["name"], "Chiến dịch Test 1")
        self.assertEqual(rerun_data["config"]["account_uids"], ["12345"])

        # 4. History
        res_hist = self.client.get("/api/groups/history?status=SUCCESS")
        self.assertEqual(res_hist.status_code, 200)
        hist_data = res_hist.json()
        self.assertGreaterEqual(hist_data["stats"]["total"], 1)
        self.assertGreaterEqual(hist_data["stats"]["success"], 1)

        # 5. Invalid date range check
        res_bad_date = self.client.get("/api/groups/history?from_date=2026-10-25&to_date=2026-10-20")
        self.assertEqual(res_bad_date.status_code, 400)

        # 6. Delete campaign (soft-delete)
        res_del = self.client.delete(f"/api/groups/campaigns/{cid}")
        self.assertEqual(res_del.status_code, 200)

        # Verify not in active campaigns list
        res_after = self.client.get("/api/groups/campaigns")
        active_ids = [c["id"] for c in res_after.json()["campaigns"]]
        self.assertNotIn(cid, active_ids)

        # Verify tasks still accessible in history
        res_hist_after = self.client.get(f"/api/groups/history?q={cid}")
        self.assertEqual(res_hist_after.status_code, 200)


if __name__ == "__main__":
    unittest.main()
