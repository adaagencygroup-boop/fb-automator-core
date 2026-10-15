"""API contracts against an isolated test database; production lifecycle is untouched."""
import unittest
from datetime import datetime
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from ..api.router import router
from ..database.connection import get_db
from ..database.models import Account

class TestPagination(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Account.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        def database():
            with self.sessions() as db:
                yield db
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = database
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def add(self, count, owner="alice"):
        with self.sessions() as db:
            for index in range(count):
                db.add(Account(uid=str(1000 + index), user_id=owner, profile_name="Name " + str(index), email="Mail" + str(index) + "@EXAMPLE.com", status="LIVE" if index % 2 else "DIE", status_checked_at=datetime.now(), login_status="LOGGED_IN" if index % 2 else "ERROR"))
            db.commit()

    def page(self, **params):
        return self.client.get("/api/accounts/page", params={"owner_username": "alice", **params})

    def test_boundaries_and_limit(self):
        for count in (0, 10, 11, 37):
            with self.subTest(count=count):
                with self.sessions() as db:
                    db.query(Account).delete(); db.commit()
                self.add(count)
                rows, cursor = [], None
                while True:
                    params = {"limit": 100}
                    if cursor: params["cursor"] = cursor
                    page = self.page(**params).json()
                    self.assertEqual(page["total"], count)
                    self.assertLessEqual(len(page["accounts"]), 10)
                    rows.extend(page["accounts"])
                    if not page["has_more"]:
                        self.assertIsNone(page["next_cursor"])
                        break
                    cursor = page["next_cursor"]
                self.assertEqual(len(rows), count)
                self.assertEqual(len({row["uid"] for row in rows}), count)
                self.assertEqual([row["id"] for row in rows], sorted((row["id"] for row in rows), reverse=True))

    def test_search_filters_stats_and_owner(self):
        self.add(37)
        self.add(5, "bob")
        for search in ("1000", "nAmE 0", "mail0@example.COM"):
            result = self.page(search=search).json()
            self.assertEqual(result["total"], 1)
            self.assertEqual(result["accounts"][0]["uid"], "1000")
        result = self.page(status="live", login_status="logged_in").json()
        self.assertEqual(result["total"], 18)
        self.assertTrue(all(row["status"] == "live" for row in result["accounts"]))
        with self.sessions() as db:
            row = db.query(Account).filter_by(user_id="alice", uid="1000").one()
            row.status_checked_at = None
            row.login_status = "PENDING"
            db.commit()
        self.assertEqual(self.page(status="die").json()["total"], 18)
        self.assertEqual(self.page(login_status="not_logged_in").json()["total"], 1)
        self.assertEqual(self.client.get("/api/accounts/stats?owner_username=alice").json(), {"total": 37, "live": 18, "die": 18})
        self.assertEqual(self.client.get("/api/accounts/stats?owner_username=bob").json()["total"], 5)
        self.assertEqual(self.client.get("/api/accounts/stats").json()["total"], 0)
        self.assertEqual(self.page(status="invalid").status_code, 422)

    def test_changes_between_pages_and_existing_uids(self):
        self.add(11)
        first = self.page().json()
        with self.sessions() as db:
            db.add(Account(uid="new", user_id="alice"))
            db.query(Account).filter_by(uid="1000").delete()
            db.commit()
        second = self.page(cursor=first["next_cursor"]).json()
        self.assertEqual(second["accounts"], [])
        self.assertEqual(second["total"], 11)
        found = self.client.post("/api/accounts/existing-uids", json={"owner_username": "alice", "uids": ["1001", "9999"]}).json()
        self.assertEqual(found, {"uids": ["1001"]})
        self.assertEqual(self.client.post("/api/accounts/existing-uids", json={"owner_username": "bob", "uids": ["1001"]}).json(), {"uids": []})

    def test_farm_accounts_use_live_or_logged_in_before_pagination(self):
        expected = set()
        with self.sessions() as db:
            for index in range(35):
                kind = index % 5
                uid = str(3000 + index)
                db.add(Account(
                    uid=uid, user_id="alice", profile_name="Farm " + str(index),
                    status="NEW" if kind == 1 else "DIE" if kind == 2 else "LIVE",
                    login_status="LOGGED_IN" if kind in (1, 4) else "ERROR",
                    status_checked_at=datetime.now() if kind in (0, 2, 4) else None,
                    proxy="192.0.2.44:1234" if index == 0 else None,
                ))
                if kind in (0, 1, 4):
                    expected.add(uid)
            db.add(Account(uid="9999", user_id="bob", status="LIVE", status_checked_at=datetime.now()))
            db.commit()

        found, sizes, cursor = [], [], None
        while True:
            params = {"active_only": True}
            if cursor is not None:
                params["cursor"] = cursor
            response = self.page(**params)
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(result["total"], 21)
            sizes.append(len(result["accounts"]))
            found.extend(row["uid"] for row in result["accounts"])
            self.assertTrue(all(row["status"] == "live" or row["login_status"] == "logged_in" for row in result["accounts"]))
            if not result["has_more"]:
                break
            cursor = result["next_cursor"]
        self.assertEqual(sizes, [10, 10, 1])
        self.assertEqual(set(found), expected)
        self.assertEqual(len(found), len(set(found)))
        proxy_search = self.page(active_only=True, search="192.0.2.44").json()
        self.assertEqual([row["uid"] for row in proxy_search["accounts"]], ["3000"])
        self.assertEqual(self.page(active_only=True, search="Farm 2").json()["total"], 6)
        self.assertEqual(self.page().json()["total"], 35)

    def test_duplicate_outside_first_page_and_defaults(self):
        self.add(11)
        self.assertNotIn("1000", [row["uid"] for row in self.page().json()["accounts"]])
        body = {"owner_username": "alice", "uid": "1000", "create_only": True}
        self.assertEqual(self.client.post("/api/accounts/single", json=body).status_code, 409)
        body = {"owner_username": "alice", "accounts": [{"uid": "1000", "email": "updated@example.com"}]}
        response = self.client.post("/api/accounts/import", json={**body, "skip_existing": True})
        self.assertEqual(response.json()["skipped_count"], 1)
        self.assertEqual(response.json()["updated_count"], 0)
        with patch("modules.module_02_account_manager.services.account_service.profile_path", return_value=__import__("pathlib").Path("test-profile")):
            self.assertEqual(self.client.post("/api/accounts/import", json=body).json()["updated_count"], 1)
            self.assertEqual(self.client.post("/api/accounts/single", json={"owner_username": "alice", "uid": "1000", "email": "single@example.com"}).status_code, 200)
        self.assertEqual(self.page(search="single@example.com").json()["total"], 1)

    def test_authenticated_owner_applies_to_new_endpoints(self):
        self.add(11, "7")
        self.add(5, "8")
        with patch("modules.module_auth.service.bearer_user", return_value={"id": 7}):
            headers = {"Authorization": "Bearer mock-token"}
            self.assertEqual(self.client.get("/api/accounts/page", headers=headers).json()["total"], 11)
            self.assertEqual(self.client.get("/api/accounts/stats", headers=headers).json()["total"], 11)
            self.assertEqual(self.client.post("/api/accounts/existing-uids", headers=headers, json={"uids": ["1010"]}).json(), {"uids": ["1010"]})
            for endpoint in ("page", "stats"):
                self.assertEqual(self.client.get("/api/accounts/" + endpoint + "?user_id=8", headers=headers).status_code, 403)
            self.assertEqual(self.client.post("/api/accounts/existing-uids", headers=headers, json={"user_id": "8", "uids": ["1000"]}).status_code, 403)
