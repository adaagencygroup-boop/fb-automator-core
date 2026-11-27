"""Unit tests cho lỗi ẩn mất target khi có target_id = NULL trong seeding_campaign_targets (Module 8)."""

import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from modules.module_02_account_manager.database.connection import Base
from modules.module_08_interaction_seeding.models.seeding_models import (
    SeedingCampaign,
    SeedingCampaignTarget,
    SeedingTarget,
    SeedingTask,
)
from modules.module_08_interaction_seeding.routes import seeding_routes
from modules.module_08_interaction_seeding.routes.seeding_routes import (
    ValidateTargetsRequest,
    clear_seeding_targets,
    delete_target_by_url,
    list_seeding_targets,
    validate_targets,
)


class TestModule8TargetsVisibility(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            self.engine,
            tables=[
                SeedingTarget.__table__,
                SeedingCampaign.__table__,
                SeedingCampaignTarget.__table__,
                SeedingTask.__table__,
            ],
        )
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.user = {"id": 24, "role": "user"}

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def _seed_completed_with_deleted_target(self):
        """Tái hiện đúng kịch bản bug: chiến dịch COMPLETED (1 SUCCESS + 1 FAILED) rồi xóa target → target_id = NULL."""
        target_a = SeedingTarget(
            target_type="PAGE",
            fb_id="pageA123",
            url="https://web.facebook.com/pageA123",
            display_name="Page pageA123",
            created_by=24,
        )
        self.db.add(target_a)
        self.db.flush()

        camp = SeedingCampaign(
            campaign_type="PAGE",
            actions="FOLLOW",
            account_count=2,
            status="COMPLETED",
            total_planned=2,
            total_success=1,
            total_failed=1,
            created_by=24,
        )
        self.db.add(camp)
        self.db.flush()

        ct = SeedingCampaignTarget(
            campaign_id=camp.id,
            target_id=target_a.id,
            display_name=target_a.display_name,
            target_url=target_a.url,
            planned_count=2,
            success_count=1,
            failed_count=1,
        )
        self.db.add(ct)
        self.db.flush()

        self.db.add_all(
            [
                SeedingTask(
                    campaign_id=camp.id,
                    campaign_target_id=ct.id,
                    target_id=target_a.id,
                    account_uid="acc1",
                    action="FOLLOW",
                    status="SUCCESS",
                ),
                SeedingTask(
                    campaign_id=camp.id,
                    campaign_target_id=ct.id,
                    target_id=target_a.id,
                    account_uid="acc2",
                    action="FOLLOW",
                    status="FAILED",
                ),
            ]
        )
        self.db.commit()

        # Xóa target_a → gán seeding_campaign_targets.target_id = NULL trên chiến dịch COMPLETED
        with patch.object(seeding_routes, "get_current_user_info", return_value=self.user):
            delete_target_by_url(url=target_a.url, target_type="PAGE", db=self.db)

        self.db.expire_all()
        ct_after = self.db.query(SeedingCampaignTarget).filter_by(id=ct.id).one()
        self.assertIsNone(ct_after.target_id)

    def test_validate_and_clear_still_work_when_completed_campaign_has_null_target_id(self):
        self._seed_completed_with_deleted_target()

        with patch.object(seeding_routes, "get_current_user_info", return_value=self.user):
            res = validate_targets(
                ValidateTargetsRequest(
                    target_type="PAGE",
                    urls=["https://www.facebook.com/pageB456", "https://www.facebook.com/pageC789"],
                ),
                db=self.db,
            )
            self.assertEqual(res["total"], 2)
            self.assertEqual(res["added_visible_count"], 2)
            self.assertEqual(res["already_completed_count"], 0)
            self.assertEqual(
                [t["fb_id"] for t in res["targets"]],
                ["pageB456", "pageC789"],
            )

            # Kiểm tra DELETE /targets/clear cũng không bị NOT IN (NULL) chặn
            cleared = clear_seeding_targets(target_type="PAGE", db=self.db)
            self.assertTrue(cleared["success"])
            self.assertEqual(cleared["deleted"], 2)

            after_clear = list_seeding_targets(
                target_type="PAGE",
                include_completed=False,
                page=None,
                page_size=None,
                db=self.db,
            )
            self.assertEqual(after_clear["total"], 0)

    def test_validate_reports_already_completed_count_when_readding_finished_target(self):
        done_target = SeedingTarget(
            target_type="POST",
            fb_id="123456789",
            url="https://web.facebook.com/share/p/123456789",
            display_name="Bài viết 123456789",
            created_by=24,
        )
        self.db.add(done_target)
        self.db.flush()

        camp = SeedingCampaign(
            campaign_type="POST",
            actions="REACT",
            account_count=1,
            status="COMPLETED",
            total_planned=1,
            total_success=1,
            total_failed=0,
            created_by=24,
        )
        self.db.add(camp)
        self.db.flush()

        ct = SeedingCampaignTarget(
            campaign_id=camp.id,
            target_id=done_target.id,
            display_name=done_target.display_name,
            target_url=done_target.url,
            planned_count=1,
            success_count=1,
            failed_count=0,
        )
        self.db.add(ct)
        self.db.flush()

        self.db.add(
            SeedingTask(
                campaign_id=camp.id,
                campaign_target_id=ct.id,
                target_id=done_target.id,
                account_uid="acc1",
                action="REACT",
                status="SUCCESS",
            )
        )
        self.db.commit()

        with patch.object(seeding_routes, "get_current_user_info", return_value=self.user):
            # 1. Chỉ nhập lại link đã chạy thành công 100%
            res_only_old = validate_targets(
                ValidateTargetsRequest(
                    target_type="POST",
                    urls=["https://web.facebook.com/share/p/123456789"],
                ),
                db=self.db,
            )
            self.assertEqual(res_only_old["total"], 0)
            self.assertEqual(res_only_old["added_visible_count"], 0)
            self.assertEqual(res_only_old["already_completed_count"], 1)

            # 2. Nhập lẫn 1 link cũ đã xong + 1 link mới tinh
            res_mixed = validate_targets(
                ValidateTargetsRequest(
                    target_type="POST",
                    urls=[
                        "https://web.facebook.com/share/p/123456789",
                        "https://web.facebook.com/share/p/999888777",
                    ],
                ),
                db=self.db,
            )
            self.assertEqual(res_mixed["total"], 1)
            self.assertEqual(res_mixed["added_visible_count"], 1)
            self.assertEqual(res_mixed["already_completed_count"], 1)
            self.assertEqual([t["fb_id"] for t in res_mixed["targets"]], ["999888777"])


if __name__ == "__main__":
    unittest.main()
