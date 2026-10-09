-- Dashboard data from project_auto_create_page_facebook.
-- Scope: statistics only; account/page creation modules are not implemented.
-- Supabase PostgreSQL only. Manual migration; not loaded by init_database().
BEGIN;

CREATE TABLE IF NOT EXISTS public.fb_accounts (
    id SERIAL PRIMARY KEY,
    owner_username VARCHAR(100),
    uid VARCHAR(50) NOT NULL,
    password VARCHAR(255) NOT NULL,
    two_fa VARCHAR(100),
    cookie TEXT,
    token TEXT,
    email VARCHAR(150),
    pass_mail VARCHAR(255),
    mail_recovery VARCHAR(150),
    token_hotmail TEXT,
    client_id VARCHAR(100),
    proxy VARCHAR(255),
    profile_name VARCHAR(150),
    profile_path VARCHAR(255) NOT NULL,
    login_status VARCHAR(30) DEFAULT 'not_logged_in',
    status VARCHAR(10),
    status_checked_at TIMESTAMP WITHOUT TIME ZONE,
    last_login_at TIMESTAMP WITHOUT TIME ZONE
);
CREATE INDEX IF NOT EXISTS ix_fb_accounts_owner_username ON public.fb_accounts (owner_username);
CREATE INDEX IF NOT EXISTS ix_fb_accounts_uid ON public.fb_accounts (uid);

CREATE TABLE IF NOT EXISTS public.created_pages (
    id SERIAL PRIMARY KEY,
    owner_username VARCHAR(100),
    creator_fb_uid VARCHAR(50) NOT NULL,
    shared_admin_uid VARCHAR(50) NOT NULL,
    page_name VARCHAR(255) NOT NULL,
    page_category VARCHAR(100),
    page_url TEXT,
    status VARCHAR(30) NOT NULL,
    log_detail TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS ix_created_pages_owner_username ON public.created_pages (owner_username);

-- Trusted backend access; no browser-facing policies are created.
ALTER TABLE public.fb_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.created_pages ENABLE ROW LEVEL SECURITY;

COMMIT;

