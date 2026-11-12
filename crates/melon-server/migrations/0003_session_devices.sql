ALTER TABLE sessions
    ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN device TEXT NOT NULL DEFAULT '',
    ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX sessions_id_idx ON sessions (id);
