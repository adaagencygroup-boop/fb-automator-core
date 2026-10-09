-- Auth module schema from project_auto_create_page_facebook.
-- Supabase PostgreSQL only. Manual migration; not loaded by init_database().
-- Schema only; no application code or existing records are modified.
BEGIN;

CREATE TABLE IF NOT EXISTS public.users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    contact_info VARCHAR(100),
    hwid VARCHAR(64),
    role VARCHAR(20) DEFAULT 'user',
    status VARCHAR(20) DEFAULT 'pending',
    expired_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    last_login_at TIMESTAMP WITHOUT TIME ZONE,
    last_login_ip VARCHAR(45),
    last_hwid_reset_at TIMESTAMP WITHOUT TIME ZONE
);

-- fb-automator-core already declares users with additional fields and a
-- VARCHAR(100) username. Retain those fields, lengths and existing records.
-- Add only missing legacy fields; keep last_login alongside last_login_at.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS contact_info VARCHAR(100),
    ADD COLUMN IF NOT EXISTS hwid VARCHAR(64),
    ADD COLUMN IF NOT EXISTS expired_at TIMESTAMP WITHOUT TIME ZONE,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITHOUT TIME ZONE,
    ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(45),
    ADD COLUMN IF NOT EXISTS last_hwid_reset_at TIMESTAMP WITHOUT TIME ZONE;

-- Defaults for FUTURE inserts only. Existing ADMIN/MEMBER and ACTIVE/BLOCKED
-- values are deliberately preserved for the later application migration.
ALTER TABLE public.users
    ALTER COLUMN role SET DEFAULT 'user',
    ALTER COLUMN status SET DEFAULT 'pending',
    ALTER COLUMN created_at SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

CREATE INDEX IF NOT EXISTS ix_users_username ON public.users (username);

CREATE TABLE IF NOT EXISTS public.user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.users (id),
    ip_address VARCHAR(45),
    device_type VARCHAR(50),
    user_agent TEXT,
    browser VARCHAR(100),
    os VARCHAR(100),
    login_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    last_active_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    logout_at TIMESTAMP WITHOUT TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    token_hash VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS ix_user_sessions_user_id ON public.user_sessions (user_id);

CREATE TABLE IF NOT EXISTS public.system_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.users (id),
    type VARCHAR(50) NOT NULL,
    target VARCHAR(20) NOT NULL DEFAULT 'admin',
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
    id SERIAL PRIMARY KEY,
    admin_username VARCHAR(100) NOT NULL,
    admin_role VARCHAR(50),
    action_type VARCHAR(50) NOT NULL,
    target_username VARCHAR(100),
    target_uid INTEGER,
    target_role VARCHAR(50),
    change_detail TEXT,
    result VARCHAR(20) NOT NULL DEFAULT 'success',
    error_message TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    note TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS ix_admin_activity_logs_admin_username ON public.admin_activity_logs (admin_username);
CREATE INDEX IF NOT EXISTS ix_admin_activity_logs_action_type ON public.admin_activity_logs (action_type);
CREATE INDEX IF NOT EXISTS ix_admin_activity_logs_created_at ON public.admin_activity_logs (created_at);

-- Trusted backend access; no browser-facing policies are created.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

COMMIT;


