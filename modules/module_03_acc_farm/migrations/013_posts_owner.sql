-- Lịch sử đăng bài chỉ hiện bài của người đang đăng nhập
ALTER TABLE posts ADD COLUMN IF NOT EXISTS owner_key TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_owner ON posts (owner_key, created_at);

-- Bài cũ: gán theo chủ hiện tại của nick
UPDATE posts SET owner_key = a.owner
FROM (
    SELECT uid, MIN(user_id) AS owner FROM accounts
    WHERE COALESCE(user_id, '') <> '' GROUP BY uid HAVING COUNT(DISTINCT user_id) = 1
) a
WHERE posts.owner_key IS NULL AND posts.account_uid = a.uid;
