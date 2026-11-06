"""
Tiện ích dùng chung cho bộ test Module 8.
Mỗi test có DB SQLite tạm riêng, người dùng giả, log giả và bot Selenium giả:
không kết nối Supabase, không mở Chrome thật, không vào Facebook.
"""
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

# core.database.connection mở pool PostgreSQL thật ngay khi được import -> thay bằng đối tượng giả trước
sys.modules.setdefault("core.database.connection", MagicMock())

import warnings  # noqa: E402

warnings.filterwarnings("ignore", category=DeprecationWarning)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

import modules.module_08_interaction_seeding.routes.seeding_routes as R  # noqa: E402
from modules.module_02_account_manager.database.connection import Base, get_db  # noqa: E402
from modules.module_02_account_manager.database.models import Account  # noqa: E402
from modules.module_08_interaction_seeding.models import (  # noqa: E402
    SeedingCampaign,
    SeedingCampaignTarget,
    SeedingComment,
    SeedingTarget,
    SeedingTask,
)

USER = {"id": 7, "username": "tester", "role": "user"}


class FakeBot:
    """Bot giả thay cho FacebookSeedingBot (Selenium). Kết quả từng hành động do test quy định qua class attribute."""

    session_alive = True
    results = {}          # action -> (ok, msg); mặc định thành công
    verify = (True, "")   # kết quả verify_action_kept
    calls = []            # (action, url)
    verify_calls = []

    @classmethod
    def reset(cls):
        cls.session_alive = True
        cls.results = {}
        cls.verify = (True, "")
        cls.calls = []
        cls.verify_calls = []

    def __init__(self, driver):
        self.driver = driver

    def is_facebook_session_alive(self, navigate=True):
        return FakeBot.session_alive

    def apply_facebook_support_data(self, *args, **kwargs):
        return False

    def _run(self, action, url):
        FakeBot.calls.append((action, url))
        return FakeBot.results.get(action, (True, f"Thành công ({action})"))

    def execute_follow(self, url, **kwargs):
        return self._run("FOLLOW", url)

    def execute_react(self, url, **kwargs):
        return self._run("REACT", url)

    def execute_comment(self, url, **kwargs):
        return self._run("COMMENT", url)

    def execute_share(self, url, **kwargs):
        return self._run("SHARE", url)

    def verify_action_kept(self, action, **kwargs):
        FakeBot.verify_calls.append(action)
        return FakeBot.verify


class SeedingTestCase(unittest.TestCase):
    """Một DB SQLite (file tạm, nhiều luồng dùng được) + app FastAPI chỉ gồm router Module 8 cho mỗi test."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.engine = create_engine(
            f"sqlite:///{os.path.join(tmp.name, 'm8.db')}",
            connect_args={"check_same_thread": False, "timeout": 30},
            poolclass=NullPool,
        )
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.Session()
        self.addCleanup(self.db.close)

        self.user = dict(USER)
        self.logs = []
        FakeBot.reset()
        fakes = {
            "SessionLocal": self.Session,
            "get_current_user_info": lambda *a, **k: self.user,
            "broadcast": lambda level, message, *a, **k: self.logs.append((level, message)),
            "FacebookSeedingBot": FakeBot,
            "create_driver": lambda **k: object(),
            "safe_close_driver": lambda d: None,
            "close_driver_for_uid": lambda uid: None,
            "close_scoped_active_drivers": lambda **k: None,
            "_safe_close_seeding_driver": lambda *a, **k: None,
            "_close_scoped_seeding_drivers": lambda *a, **k: None,
        }
        for name, value in fakes.items():
            p = patch.object(R, name, value)
            p.start()
            self.addCleanup(p.stop)
        R._batch_campaign_chains.clear()
        R._active_seeding_campaigns.clear()
        self.addCleanup(R._batch_campaign_chains.clear)
        self.addCleanup(R._active_seeding_campaigns.clear)

        app = FastAPI()
        app.include_router(R.router, prefix="/api")

        def override_db():
            s = self.Session()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    # ── HTTP ──────────────────────────────────────────────────────
    def api(self, method, path, expect=200, **kwargs):
        res = self.client.request(method, f"/api/seeding{path}", **kwargs)
        self.assertEqual(res.status_code, expect, f"{method} {path} -> {res.status_code}: {res.text[:300]}")
        return res.json()

    # ── Dữ liệu mẫu ───────────────────────────────────────────────
    def add_accounts(self, count, owner="7", prefix="uid"):
        uids = [f"{prefix}{i:03d}" for i in range(count)]
        for u in uids:
            self.db.add(Account(uid=u, user_id=owner, status="LIVE", login_status="LOGGED_IN"))
        self.db.commit()
        return uids

    def validate(self, target_type, urls):
        return self.api("POST", "/targets/validate", json={"target_type": target_type, "urls": urls})

    def list_targets(self, target_type):
        return self.api("GET", "/targets", params={"target_type": target_type})["targets"]

    def create(self, target_type, urls, actions=None, expect=200, **kwargs):
        body = {
            "campaign_type": target_type,
            "actions": actions or ["FOLLOW"],
            "targets": [{"url": u} for u in urls],
            "account_count": kwargs.pop("account_count", 50),
            **kwargs,
        }
        return self.api("POST", "/campaigns/create", expect=expect, json=body)

    def tasks(self, campaign_id, action=None):
        self.db.expire_all()
        q = self.db.query(SeedingTask).filter(SeedingTask.campaign_id == campaign_id)
        if action:
            q = q.filter(SeedingTask.action == action)
        return q.order_by(SeedingTask.id).all()

    def campaign(self, campaign_id):
        self.db.expire_all()
        return self.db.get(SeedingCampaign, campaign_id)

    def history(self, **params):
        params.setdefault("page_size", 100)
        res = self.api("GET", "/campaigns", params=params)
        return res.get("items") or res.get("campaigns") or res.get("data") or []

    def run_campaign(self, campaign_id):
        """Chạy 1 chiến dịch như engine thật (đa luồng) nhưng với bot giả và không nghỉ."""
        with patch.object(R.time, "sleep", lambda s: None):
            R._run_single_campaign(campaign_id)


__all__ = [
    "R", "Account", "FakeBot", "SeedingTestCase", "SeedingCampaign", "SeedingCampaignTarget",
    "SeedingComment", "SeedingTarget", "SeedingTask",
]
