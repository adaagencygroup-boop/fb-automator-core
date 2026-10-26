PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS group_campaigns (
    id TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    action_type TEXT NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_group_campaigns_action_type
        CHECK (action_type IN ('POST', 'COMMENT'))
);

CREATE TABLE IF NOT EXISTS group_runs (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL
        REFERENCES group_campaigns(id) ON DELETE CASCADE,
    run_number INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    config_json TEXT,
    total_planned INTEGER NOT NULL DEFAULT 0,
    total_success INTEGER NOT NULL DEFAULT 0,
    total_failed INTEGER NOT NULL DEFAULT 0,
    total_skipped INTEGER NOT NULL DEFAULT 0,
    scheduled_at TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_group_runs_campaign_number
        UNIQUE (campaign_id, run_number),
    CONSTRAINT ck_group_runs_number CHECK (run_number >= 1),
    CONSTRAINT ck_group_runs_status CHECK (status IN (
        'QUEUED', 'SCHEDULED', 'RUNNING', 'PAUSED', 'STOPPING',
        'COMPLETED', 'PARTIAL', 'STOPPED', 'CANCELLED', 'FAILED'
    )),
    CONSTRAINT ck_group_runs_totals CHECK (
        total_planned >= 0
        AND total_success >= 0
        AND total_failed >= 0
        AND total_skipped >= 0
        AND total_success + total_failed + total_skipped <= total_planned
    )
);

CREATE TABLE IF NOT EXISTS group_run_tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES group_runs(id) ON DELETE CASCADE,
    account_id INTEGER,
    account_uid TEXT NOT NULL,
    account_name TEXT,
    group_key TEXT NOT NULL,
    group_name TEXT,
    group_url TEXT NOT NULL,
    content TEXT,
    status TEXT NOT NULL,
    result_message TEXT,
    error_code TEXT,
    error_detail TEXT,
    result_url TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_group_run_tasks_status CHECK (status IN (
        'PENDING', 'RUNNING', 'SUCCESS', 'PENDING_APPROVAL',
        'FAILED', 'SKIPPED', 'CANCELLED'
    )),
    CONSTRAINT ck_group_run_tasks_attempt_count CHECK (attempt_count >= 0)
);

CREATE TABLE IF NOT EXISTS group_sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    data_type TEXT NOT NULL,
    data_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    synced_at TEXT,
    CONSTRAINT ck_group_sync_outbox_data_type CHECK (data_type IN ('RUN', 'LOG')),
    CONSTRAINT ck_group_sync_outbox_status
        CHECK (status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
    CONSTRAINT ck_group_sync_outbox_retry_count CHECK (retry_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_group_campaigns_owner_created
    ON group_campaigns (owner_key, created_at);
CREATE INDEX IF NOT EXISTS idx_group_campaigns_owner_type
    ON group_campaigns (owner_key, action_type, deleted_at);
CREATE INDEX IF NOT EXISTS idx_group_campaigns_owner_name
    ON group_campaigns (owner_key, name);
CREATE INDEX IF NOT EXISTS idx_group_runs_campaign_history
    ON group_runs (campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_group_runs_schedule
    ON group_runs (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_group_run_tasks_status
    ON group_run_tasks (run_id, status);
CREATE INDEX IF NOT EXISTS idx_group_run_tasks_account
    ON group_run_tasks (account_uid, finished_at);
CREATE INDEX IF NOT EXISTS idx_group_run_tasks_group
    ON group_run_tasks (group_key, finished_at);
CREATE INDEX IF NOT EXISTS idx_group_run_tasks_sync
    ON group_run_tasks (status, synced_at);
CREATE INDEX IF NOT EXISTS idx_group_sync_outbox_pending
    ON group_sync_outbox (status, created_at);
CREATE INDEX IF NOT EXISTS idx_group_sync_outbox_data
    ON group_sync_outbox (data_type, data_id);
