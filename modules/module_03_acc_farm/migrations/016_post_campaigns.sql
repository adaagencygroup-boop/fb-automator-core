-- Module 03 - Tab 2: Chiến dịch đăng bài Status nhiều khung giờ + ô soạn bài chung.
--   post_compose_drafts : nháp ô soạn bài (nội dung tách bằng dòng "---" + kho ảnh chung), 1 nháp / người dùng / loại bài
--   post_campaigns      : chiến dịch (nick, cài đặt, nội dung + kho ảnh)
--   post_campaign_slots : mỗi khung giờ của chiến dịch (WAITING / RUNNING / DONE / MISSED / STOPPED / FAILED)
--   post_campaign_usage : nick nào đã dùng bài / ảnh nào, ở khung nào (luật không đăng trùng)
--   posts.campaign_id / posts.slot_id : bài đăng thuộc chiến dịch nào, khung nào (lọc Lịch sử)
-- Engine cũng tự tạo bảng / thêm cột khi khởi động (models.py).
BEGIN;

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS campaign_id UUID;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS slot_id UUID;

CREATE TABLE IF NOT EXISTS public.post_compose_drafts (
  owner_key TEXT NOT NULL DEFAULT '',
  post_type TEXT NOT NULL CHECK (post_type IN ('status', 'reels', 'story')),
  content_text TEXT NOT NULL DEFAULT '',
  content_mode TEXT NOT NULL DEFAULT 'MULTI' CHECK (content_mode IN ('SINGLE', 'MULTI')),
  image_mode TEXT NOT NULL DEFAULT 'NONE' CHECK (image_mode IN ('NONE', 'SINGLE', 'MULTI')),
  image_paths TEXT,
  min_images INTEGER NOT NULL DEFAULT 1 CHECK (min_images BETWEEN 1 AND 3),
  max_images INTEGER NOT NULL DEFAULT 1 CHECK (max_images BETWEEN 1 AND 3),
  -- TEXT = ô soạn chung; ACCOUNTS = Từng bài (mỗi nick 1 bài riêng cho mỗi khung giờ)
  layout TEXT NOT NULL DEFAULT 'ACCOUNTS',
  -- JSON {uid: [{content, images}, ...]} cho layout ACCOUNTS
  account_posts TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_key, post_type),
  CHECK (min_images <= max_images)
);

CREATE TABLE IF NOT EXISTS public.post_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key TEXT NOT NULL DEFAULT '',
  -- Máy tạo chiến dịch (profile Chrome của nick nằm trên máy này) — chỉ máy này chạy các khung giờ
  machine_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  post_type TEXT NOT NULL DEFAULT 'status' CHECK (post_type IN ('status', 'reels', 'story')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STOPPED', 'COMPLETED')),
  accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_text TEXT NOT NULL DEFAULT '',
  content_mode TEXT NOT NULL DEFAULT 'MULTI' CHECK (content_mode IN ('SINGLE', 'MULTI')),
  image_mode TEXT NOT NULL DEFAULT 'NONE' CHECK (image_mode IN ('NONE', 'SINGLE', 'MULTI')),
  image_paths TEXT,
  min_images INTEGER NOT NULL DEFAULT 1 CHECK (min_images BETWEEN 1 AND 3),
  max_images INTEGER NOT NULL DEFAULT 1 CHECK (max_images BETWEEN 1 AND 3),
  layout TEXT NOT NULL DEFAULT 'TEXT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_images <= max_images)
);
CREATE INDEX IF NOT EXISTS idx_post_campaigns_owner ON public.post_campaigns (owner_key, created_at DESC);

CREATE TABLE IF NOT EXISTS public.post_campaign_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.post_campaigns(id) ON DELETE CASCADE,
  run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN
    ('WAITING', 'RUNNING', 'DONE', 'MISSED', 'STOPPED', 'FAILED')),
  session_id UUID REFERENCES public.post_sessions(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  total_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  -- Layout ACCOUNTS: JSON {uid: {content, images}} bài của từng nick ở khung này
  account_posts TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_post_campaign_slots_campaign ON public.post_campaign_slots (campaign_id, run_at);
CREATE INDEX IF NOT EXISTS idx_post_campaign_slots_due ON public.post_campaign_slots (status, run_at);

CREATE TABLE IF NOT EXISTS public.post_campaign_usage (
  id BIGSERIAL PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.post_campaigns(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES public.post_campaign_slots(id) ON DELETE CASCADE,
  account_uid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('TEXT', 'IMAGE')),
  item_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_post_campaign_usage_campaign ON public.post_campaign_usage (campaign_id, account_uid, kind);
CREATE INDEX IF NOT EXISTS idx_post_campaign_usage_slot ON public.post_campaign_usage (slot_id);
CREATE INDEX IF NOT EXISTS idx_posts_campaign ON public.posts (campaign_id, slot_id);

DROP TRIGGER IF EXISTS trg_post_campaigns_updated_at ON public.post_campaigns;
CREATE TRIGGER trg_post_campaigns_updated_at
  BEFORE UPDATE ON public.post_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_post_campaign_slots_updated_at ON public.post_campaign_slots;
CREATE TRIGGER trg_post_campaign_slots_updated_at
  BEFORE UPDATE ON public.post_campaign_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Bảng tạo từ bản trước của migration này: thêm cột dạng soạn "Từng bài"
ALTER TABLE public.post_compose_drafts ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT 'ACCOUNTS';
ALTER TABLE public.post_compose_drafts ADD COLUMN IF NOT EXISTS account_posts TEXT;
ALTER TABLE public.post_campaigns ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT 'TEXT';
ALTER TABLE public.post_campaign_slots ADD COLUMN IF NOT EXISTS account_posts TEXT;

ALTER TABLE public.post_compose_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_campaign_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_campaign_usage ENABLE ROW LEVEL SECURITY;

COMMIT;
