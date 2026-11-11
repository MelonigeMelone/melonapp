CREATE TABLE users (
    id                UUID PRIMARY KEY,
    email             TEXT NOT NULL UNIQUE,
    kdf_memory_kib    INTEGER NOT NULL,
    kdf_iterations    INTEGER NOT NULL,
    kdf_parallelism   INTEGER NOT NULL,
    kdf_salt          TEXT NOT NULL,
    auth_hash         TEXT NOT NULL,
    wrapped_vault_key TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash BYTEA PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE SEQUENCE item_revision_seq;

CREATE TABLE items (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id         UUID NOT NULL,
    module     TEXT NOT NULL,
    data       TEXT,
    revision   BIGINT NOT NULL,
    deleted    BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id)
);
CREATE INDEX items_sync_idx ON items (user_id, revision);
