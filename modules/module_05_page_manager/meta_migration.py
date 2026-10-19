"""Atomic owner migration; preserves row IDs and quarantines unknown owners."""
from core.database.connection import db

OWNED_TABLES = (
    "pages", "posting_schedules", "posting_progress", "posting_history",
    "downloaded_videos", "download_logs", "page_jobs", "page_job_items",
)


def _backfill_owners(cur):
    cur.execute("""UPDATE pages p SET user_id = a.user_id FROM (
        SELECT uid, MIN(user_id) AS user_id FROM accounts
        GROUP BY uid HAVING COUNT(*) = 1 AND MIN(user_id) IS NOT NULL
    ) a WHERE p.account_uid = a.uid AND p.user_id IS NULL""")
    for table in ("posting_schedules", "posting_progress", "posting_history", "downloaded_videos", "download_logs", "page_job_items"):
        cur.execute(f"""UPDATE {table} t SET user_id = p.user_id FROM (
            SELECT page_id, MIN(user_id) AS user_id FROM pages GROUP BY page_id
            HAVING COUNT(*) = 1 AND MIN(user_id) IS NOT NULL
        ) p WHERE t.page_id = p.page_id AND t.user_id IS NULL""")
    cur.execute("""UPDATE page_jobs j SET user_id = i.user_id FROM (
        SELECT job_id, MIN(user_id) AS user_id FROM page_job_items GROUP BY job_id
        HAVING COUNT(user_id) = COUNT(*) AND COUNT(DISTINCT user_id) = 1
    ) i WHERE j.id = i.job_id AND j.user_id IS NULL""")


def migrate_meta_owners():
    with db.session() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(50520261019)")
        cur.execute("CREATE TABLE IF NOT EXISTS module5_migrations (version TEXT PRIMARY KEY)")
        cur.execute("SELECT version FROM module5_migrations WHERE version = 'meta_owner_v1'")
        if cur.fetchone():
            return
        for table in OWNED_TABLES:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS user_id VARCHAR(100)")
        cur.execute("ALTER TABLE pages ADD COLUMN IF NOT EXISTS token_metadata JSONB")
        _backfill_owners(cur)
        # Replace all global unique keys with owner-qualified keys, including custom names.
        for table, old_keys, new_keys in (
            ("pages", ["page_id"], "user_id, page_id"),
            ("posting_progress", ["page_id", "post_type"], "user_id, page_id, post_type"),
            ("downloaded_videos", ["page_id", "source", "video_id"], "user_id, page_id, source, video_id"),
            ("downloaded_videos", ["page_id", "video_id"], None),
            ("page_job_items", ["job_id", "page_id"], "user_id, job_id, page_id"),
        ):
            cur.execute("""SELECT c.conname, array_agg(a.attname ORDER BY u.ord) AS keys
                FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY u(num, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.num
                WHERE c.conrelid = %s::regclass AND c.contype = 'u' GROUP BY c.conname""", (table,))
            for row in cur.fetchall():
                if set(row["keys"]) == set(old_keys):
                    from psycopg2 import sql
                    cur.execute(sql.SQL("ALTER TABLE {} DROP CONSTRAINT {}").format(sql.Identifier(table), sql.Identifier(row["conname"])))
            # Some installations use a standalone unique index instead of a constraint.
            cur.execute("""SELECT i.relname AS index_name,
                array_agg(a.attname ORDER BY u.ord) AS keys
                FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
                CROSS JOIN LATERAL unnest(x.indkey::smallint[]) WITH ORDINALITY u(num, ord)
                JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = u.num
                WHERE x.indrelid = %s::regclass AND x.indisunique AND NOT x.indisprimary
                AND x.indpred IS NULL AND x.indexprs IS NULL
                AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)
                GROUP BY i.relname""", (table,))
            for row in cur.fetchall():
                if set(row["keys"]) == set(old_keys):
                    from psycopg2 import sql
                    cur.execute(sql.SQL("DROP INDEX {}").format(sql.Identifier(row["index_name"])))
            if new_keys:
                cur.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table}_owner ON {table} ({new_keys})")
        cur.execute("""CREATE TABLE IF NOT EXISTS meta_account_connections (
            user_id VARCHAR(100) NOT NULL, account_uid VARCHAR(100) NOT NULL,
            app_id VARCHAR(100) NOT NULL, app_scoped_user_id VARCHAR(100) NOT NULL,
            facebook_name TEXT NOT NULL, token_metadata JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, account_uid, app_id),
            UNIQUE (user_id, app_id, app_scoped_user_id)
        )""")
        cur.execute("""CREATE TABLE IF NOT EXISTS meta_oauth_states (
            state_hash TEXT PRIMARY KEY, user_id VARCHAR(100) NOT NULL,
            account_uid VARCHAR(100) NOT NULL, app_id VARCHAR(100) NOT NULL,
            flow VARCHAR(20) NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ
        )""")
        cur.execute("INSERT INTO module5_migrations VALUES ('meta_owner_v1')")
