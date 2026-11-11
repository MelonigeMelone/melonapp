ALTER TABLE users
    ADD COLUMN recovery_auth_hash TEXT,
    ADD COLUMN recovery_wrapped_account_key TEXT;

ALTER TABLE sessions
    ADD COLUMN scope TEXT NOT NULL DEFAULT 'full' CHECK (scope IN ('full', 'recovery'));
