CREATE TABLE users (
    id                    UUID PRIMARY KEY,
    email                 TEXT NOT NULL UNIQUE,
    kdf_memory_kib        INTEGER NOT NULL,
    kdf_iterations        INTEGER NOT NULL,
    kdf_parallelism       INTEGER NOT NULL,
    kdf_salt              TEXT NOT NULL,
    auth_hash             TEXT NOT NULL,
    wrapped_account_key   TEXT NOT NULL,
    public_key            TEXT NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash BYTEA PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE SEQUENCE revision_seq;

CREATE TABLE vaults (
    id              UUID PRIMARY KEY,
    personal        BOOLEAN NOT NULL,
    encrypted_meta  TEXT NOT NULL,
    key_version     INTEGER NOT NULL DEFAULT 1,
    rotation_needed BOOLEAN NOT NULL DEFAULT false,
    revision        BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vault_members (
    vault_id            UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    encrypted_vault_key TEXT,
    key_version         INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vault_id, user_id)
);
CREATE INDEX vault_members_user_idx ON vault_members (user_id);

CREATE TABLE items (
    vault_id    UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    id          UUID NOT NULL,
    data        TEXT,
    key_version INTEGER NOT NULL,
    revision    BIGINT NOT NULL,
    deleted     BOOLEAN NOT NULL DEFAULT false,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vault_id, id)
);
CREATE INDEX items_sync_idx ON items (vault_id, revision);

CREATE TABLE invites (
    id          UUID PRIMARY KEY,
    token_hash  BYTEA NOT NULL UNIQUE,
    email       TEXT NOT NULL,
    vault_id    UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    accepted_by UUID REFERENCES users(id) ON DELETE CASCADE,
    accepted_at TIMESTAMPTZ
);
CREATE INDEX invites_vault_idx ON invites (vault_id);
