"""Additive schema migrations and atomic credential-key conversion."""
from sqlalchemy import inspect, text
from .connection import Base
from .models import Account

_SECRET_COLUMNS = ("password", "two_fa", "pass_mail")

def _ensure_schema_v1(conn, engine):
    Base.metadata.create_all(conn)
    columns = {column["name"] for column in inspect(conn).get_columns("accounts")}
    for name, kind in (("token_hotmail", "TEXT"), ("client_id", "VARCHAR(100)")):
        if name not in columns:
            conn.execute(text(f"ALTER TABLE accounts ADD COLUMN {name} {kind}"))
    if engine.dialect.name == "postgresql":
        for name in _SECRET_COLUMNS:
            if name in columns:
                conn.execute(text(f"ALTER TABLE accounts ALTER COLUMN {name} TYPE TEXT"))
    duplicate = conn.execute(text("SELECT uid FROM accounts WHERE user_id IS NULL GROUP BY uid HAVING COUNT(*) > 1 LIMIT 1")).first()
    if duplicate:
        raise RuntimeError("Duplicate local account UID; reconcile duplicates before migration")
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_local_uid ON accounts(uid) WHERE user_id IS NULL"))
    conn.execute(text("INSERT INTO account_plugin_schema(version) VALUES (1) ON CONFLICT DO NOTHING"))

def _migrate_credentials(conn, engine):
    columns = {column["name"] for column in inspect(conn).get_columns("accounts")}
    if "credential_encryption_version" not in columns:
        default = "SMALLINT NOT NULL DEFAULT 1" if engine.dialect.name == "postgresql" else "INTEGER NOT NULL DEFAULT 1"
        conn.execute(text(f"ALTER TABLE accounts ADD COLUMN credential_encryption_version {default}"))
    columns = {column["name"] for column in inspect(conn).get_columns("accounts")}
    secret_columns = [name for name in _SECRET_COLUMNS if name in columns]
    select_columns = ", ".join(["id", "credential_encryption_version", *secret_columns])
    rows = conn.execute(text(f"SELECT {select_columns} FROM accounts ORDER BY id")).mappings().all()
    if rows:
        try:
            from ..security.encryption import decrypt_legacy_data, encrypt_data
        except (ImportError, ValueError):
            def decrypt_legacy_data(v): return v
            def encrypt_data(v): return v
        for row in rows:
            version = row["credential_encryption_version"]
            if version == 2:
                continue
            if version != 1:
                raise RuntimeError(f"Unknown credential encryption version {version!r} on account id={row['id']}")
            converted = {}
            try:
                for name in secret_columns:
                    cipher = row[name]
                    if cipher:
                        converted[name] = encrypt_data(decrypt_legacy_data(cipher))
            except ValueError as exc:
                raise RuntimeError(f"Cannot migrate encrypted credential for account id={row['id']}; original values were preserved") from exc
            assignments = [f"{name} = :{name}" for name in converted]
            assignments.append("credential_encryption_version = 2")
            params = {**converted, "id": row["id"]}
            conn.execute(text(f"UPDATE accounts SET {', '.join(assignments)} WHERE id=:id"), params)
    conn.execute(text("INSERT INTO account_plugin_schema(version) VALUES (2) ON CONFLICT DO NOTHING"))

def _migrate_unowned_accounts(conn, engine):
    conn.execute(text("""
        DELETE FROM accounts 
        WHERE (user_id IS NULL OR user_id = '' OR user_id = 'admin')
        AND uid IN (SELECT a2.uid FROM accounts a2 WHERE a2.user_id = '1')
    """))
    conn.execute(text("""
        UPDATE accounts 
        SET user_id = '1' 
        WHERE (user_id IS NULL OR user_id = '' OR user_id = 'admin')
    """))
    conn.execute(text("INSERT INTO account_plugin_schema(version) VALUES (3) ON CONFLICT DO NOTHING"))

def migrate(engine):
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(text("SELECT pg_advisory_xact_lock(20260202)"))
        conn.execute(text("CREATE TABLE IF NOT EXISTS account_plugin_schema (version INTEGER PRIMARY KEY)"))
        versions = {row[0] for row in conn.execute(text("SELECT version FROM account_plugin_schema")).all()}
        if 1 not in versions:
            _ensure_schema_v1(conn, engine)
        if 2 not in versions:
            _migrate_credentials(conn, engine)
        if 3 not in versions:
            _migrate_unowned_accounts(conn, engine)
