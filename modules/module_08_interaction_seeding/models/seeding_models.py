"""
seeding_models.py
ORM Models cho Module 8: Interaction Seeding (Seeding Page, Seeding Profile, Seeding Post, History).
Tuân thủ chuẩn DBML Module 8 (fb_automator_seeding).
Tương thích SQLite & PostgreSQL, hỗ trợ partial index và cascade delete.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Index, UniqueConstraint, text
)
from sqlalchemy.orm import relationship

from modules.module_02_account_manager.database.connection import Base

VN_TZ = timezone(timedelta(hours=7))


def vn_now() -> datetime:
    """Giờ Việt Nam (UTC+7) hiện tại, dạng naive để lưu vào cột TIMESTAMP của các bảng seeding_*.
    Riêng Module 8 lưu giờ Việt Nam; các module khác vẫn lưu UTC (utc_now của Module 2)."""
    return datetime.now(VN_TZ).replace(tzinfo=None)


# 1. Đối tượng được seeding (Page / Trang cá nhân / Bài viết), dùng chung giữa các chiến dịch
class SeedingTarget(Base):
    __tablename__ = "seeding_targets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    target_type = Column(String(20), nullable=False)   # 'PAGE' | 'PROFILE' | 'POST'
    fb_id = Column(String(100), nullable=False)        # UID / Page ID / Post ID sau khi xác thực link
    url = Column(Text, nullable=False)
    display_name = Column(String(255), nullable=True)  # Cột "Tên hiển thị" (Page / Trang cá nhân / Bài viết + fb_id)
    created_by = Column(Integer, nullable=True)        # users.id (người dùng sở hữu/import link)
    created_at = Column(DateTime, default=vn_now)
    updated_at = Column(DateTime, default=vn_now, onupdate=vn_now)

    # Relationships
    campaign_targets = relationship("SeedingCampaignTarget", back_populates="target", cascade="all, delete-orphan")
    tasks = relationship("SeedingTask", back_populates="target", cascade="all, delete-orphan")

    __table_args__ = (
        Index("uq_seeding_targets_user", "target_type", "fb_id", "created_by", unique=True),
    )


# 2. Chiến dịch seeding (mỗi lần bấm "Bắt đầu seeding") + cấu hình + bộ đếm cho trang Lịch sử
class SeedingCampaign(Base):
    __tablename__ = "seeding_campaigns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_type = Column(String(20), nullable=False)      # 'PAGE' | 'PROFILE' | 'POST'
    actions = Column(String(100), nullable=False)           # 'FOLLOW' (Page, Profile) hoặc 'REACT,COMMENT,SHARE' (Post)
    reactions = Column(String(100), nullable=True)          # 'LIKE,LOVE,CARE,HAHA,WOW,SAD,ANGRY' (chỉ cho POST)
    account_count = Column(Integer, nullable=False)
    delay_seconds_min = Column(Integer, default=30)         # Thời gian nghỉ giữa 2 lần tương tác (giây)
    delay_seconds_max = Column(Integer, default=60)
    status = Column(String(20), default="PENDING")          # 'PENDING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'COMPLETED' | 'FAILED'
    total_planned = Column(Integer, default=0)
    total_success = Column(Integer, default=0)
    total_failed = Column(Integer, default=0)
    created_by = Column(Integer, nullable=True)             # users.id (bảng core) - tham chiếu logic, không có FK
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=vn_now)
    updated_at = Column(DateTime, default=vn_now, onupdate=vn_now)

    # Relationships
    campaign_targets = relationship("SeedingCampaignTarget", back_populates="campaign", cascade="all, delete-orphan")
    comments = relationship("SeedingComment", back_populates="campaign", cascade="all, delete-orphan")
    tasks = relationship("SeedingTask", back_populates="campaign", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_seeding_campaigns_history", "campaign_type", "created_at"),
    )

    @property
    def target_summary(self) -> str:
        """Tóm tắt mục tiêu hiển thị trên UI Lịch sử."""
        if self.campaign_targets and len(self.campaign_targets) > 0:
            ct = self.campaign_targets[0]
            if ct.display_name:
                return ct.display_name
            if ct.target and ct.target.display_name:
                return ct.target.display_name
            if ct.target_url:
                return ct.target_url
            if ct.target and ct.target.url:
                return ct.target.url
        if self.tasks and len(self.tasks) > 0:
            tk = self.tasks[0]
            if tk.display_name:
                return tk.display_name
            if tk.target_url:
                return tk.target_url
        return ""


# 3. Mục tiêu trong từng chiến dịch (ghi chú lấy từ file Excel) + bộ đếm cho từng dòng Lịch sử
class SeedingCampaignTarget(Base):
    __tablename__ = "seeding_campaign_targets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("seeding_campaigns.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(Integer, ForeignKey("seeding_targets.id", ondelete="SET NULL"), nullable=True)
    display_name = Column(String(255), nullable=True)       # Tên mục tiêu snapshot cố định
    target_url = Column(Text, nullable=True)                # Đường dẫn mục tiêu snapshot cố định
    note = Column(Text, nullable=True)                      # Ghi chú hoặc nhãn nội dung trong file Excel
    source = Column(String(10), default="MANUAL")           # 'MANUAL' | 'EXCEL'
    planned_count = Column(Integer, default=0)              # Lịch sử: cột "Số lượng"
    success_count = Column(Integer, default=0)              # Lịch sử: cột "Thành công"
    failed_count = Column(Integer, default=0)               # Lịch sử: cột "Thất bại"

    # Relationships
    campaign = relationship("SeedingCampaign", back_populates="campaign_targets")
    target = relationship("SeedingTarget", back_populates="campaign_targets")
    tasks = relationship("SeedingTask", back_populates="campaign_target", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("campaign_id", "target_id", name="unique_campaign_target"),
        Index("idx_seeding_campaign_targets_target", "target_id"),
    )


# 4. Kho bình luận random của chiến dịch (tối đa 50 dòng) hoặc kho bình luận mẫu của user (campaign_id IS NULL)
class SeedingComment(Base):
    __tablename__ = "seeding_comments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("seeding_campaigns.id", ondelete="CASCADE"), nullable=True)
    created_by = Column(Integer, nullable=True)                      # users.id (người dùng sở hữu/import comment)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=vn_now)

    # Relationships
    campaign = relationship("SeedingCampaign", back_populates="comments")

    __table_args__ = (
        Index("idx_seeding_comments_user", "created_by", "campaign_id"),
    )


# 5. Tác vụ nguyên tử: 1 tài khoản x 1 hành động x 1 mục tiêu
class SeedingTask(Base):
    __tablename__ = "seeding_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("seeding_campaigns.id", ondelete="CASCADE"), nullable=False)
    campaign_target_id = Column(Integer, ForeignKey("seeding_campaign_targets.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(Integer, ForeignKey("seeding_targets.id", ondelete="SET NULL"), nullable=True)
    display_name = Column(String(255), nullable=True)       # Tên mục tiêu snapshot cố định
    target_url = Column(Text, nullable=True)                # Đường dẫn mục tiêu snapshot cố định
    account_uid = Column(String(100), nullable=False)       # accounts.uid (Module 2) - tham chiếu logic, không có FK
    action = Column(String(20), nullable=False)             # 'FOLLOW' | 'REACT' | 'COMMENT' | 'SHARE'
    reaction = Column(String(10), nullable=True)            # 'LIKE,LOVE,CARE,HAHA,WOW,SAD,ANGRY' (chỉ cho REACT)
    comment_id = Column(Integer, ForeignKey("seeding_comments.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), default="PENDING")          # 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED'
    error_message = Column(Text, nullable=True)
    scheduled_at = Column(DateTime, default=vn_now)        # Thời điểm sớm nhất được phép chạy (giãn cách)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=vn_now)

    # Relationships
    campaign = relationship("SeedingCampaign", back_populates="tasks")
    campaign_target = relationship("SeedingCampaignTarget", back_populates="tasks")
    target = relationship("SeedingTarget", back_populates="tasks")
    comment = relationship("SeedingComment")

    __table_args__ = (
        Index("idx_seeding_tasks_queue", "status", "scheduled_at"),
        Index("idx_seeding_tasks_campaign", "campaign_id", "status"),
        Index("idx_seeding_tasks_account", "account_uid", "finished_at"),
        Index(
            "uq_seeding_tasks_once",
            "account_uid", "target_id", "action",
            unique=True,
            sqlite_where=text("status IN ('PENDING', 'RUNNING', 'SUCCESS')"),
            postgresql_where=text("status IN ('PENDING', 'RUNNING', 'SUCCESS')")
        ),
    )
