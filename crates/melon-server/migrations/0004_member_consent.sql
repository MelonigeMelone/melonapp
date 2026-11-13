ALTER TABLE vault_members
    ADD COLUMN accepted BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN added_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX vault_members_offers_idx ON vault_members (user_id) WHERE NOT accepted;
