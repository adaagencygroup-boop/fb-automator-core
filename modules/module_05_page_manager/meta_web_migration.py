"""Standalone web connections, without changing the existing account migration."""
from core.database.connection import db


def migrate_meta_web():
    with db.session() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(50520261019)")
        cur.execute("SELECT version FROM module5_migrations WHERE version = 'meta_web_v2'")
        if cur.fetchone():
            return
        cur.execute("""CREATE TABLE meta_web_connections (
            id BIGSERIAL PRIMARY KEY, user_id VARCHAR(100) NOT NULL,
            app_id VARCHAR(100) NOT NULL, app_scoped_user_id VARCHAR(100) NOT NULL,
            facebook_name TEXT NOT NULL, user_access_token TEXT NOT NULL,
            token_metadata JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (user_id, app_id, app_scoped_user_id), UNIQUE (user_id, id)
        )""")
        cur.execute("ALTER TABLE pages ADD COLUMN web_connection_id BIGINT")
        cur.execute("""ALTER TABLE pages ADD CONSTRAINT fk_pages_web_owner
            FOREIGN KEY (user_id, web_connection_id) REFERENCES meta_web_connections (user_id, id)""")
        cur.execute("CREATE INDEX idx_pages_web_connection ON pages (user_id, web_connection_id)")
        cur.execute("ALTER TABLE meta_oauth_states ALTER COLUMN account_uid DROP NOT NULL")
        cur.execute("ALTER TABLE meta_oauth_states ADD COLUMN job_id TEXT")
        cur.execute("""ALTER TABLE meta_oauth_states ADD CONSTRAINT ck_meta_state_account
            CHECK ((flow = 'web_standalone' AND account_uid IS NULL AND job_id IS NOT NULL)
                OR (flow IN ('web', 'profile') AND account_uid IS NOT NULL))""")
        cur.execute("INSERT INTO module5_migrations VALUES ('meta_web_v2')")
