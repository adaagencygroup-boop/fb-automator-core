-- Liên kết phiên gần nhất để FE lọc kết quả đúng session (không chỉ first_session_id)
ALTER TABLE scanned_page_followers ADD COLUMN IF NOT EXISTS last_session_id INT;
ALTER TABLE scanned_posts ADD COLUMN IF NOT EXISTS last_session_id INT;

CREATE INDEX IF NOT EXISTS idx_scanned_page_followers_last_session
  ON scanned_page_followers (last_session_id);
CREATE INDEX IF NOT EXISTS idx_scanned_posts_last_session
  ON scanned_posts (last_session_id);

-- Backfill: lần đầu = first
UPDATE scanned_page_followers
SET last_session_id = first_session_id
WHERE last_session_id IS NULL AND first_session_id IS NOT NULL;

UPDATE scanned_posts
SET last_session_id = first_session_id
WHERE last_session_id IS NULL AND first_session_id IS NOT NULL;
