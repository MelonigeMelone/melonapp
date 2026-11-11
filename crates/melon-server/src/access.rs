use serde::{Deserialize, Serialize};
use sqlx::{PgExecutor, Postgres, Transaction};
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Owner,
    Editor,
    Viewer,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Editor => "editor",
            Self::Viewer => "viewer",
        }
    }

    pub fn parse(s: &str) -> ApiResult<Self> {
        match s {
            "owner" => Ok(Self::Owner),
            "editor" => Ok(Self::Editor),
            "viewer" => Ok(Self::Viewer),
            _ => Err(ApiError::Internal(anyhow::anyhow!("unknown role {s}"))),
        }
    }

    pub fn can_write(self) -> bool {
        matches!(self, Self::Owner | Self::Editor)
    }
}

pub struct Access {
    pub role: Role,
    pub personal: bool,
    pub vault_key_version: i32,
    pub has_key: bool,
}

impl Access {
    pub fn require_key(&self) -> ApiResult<()> {
        if self.has_key {
            Ok(())
        } else {
            Err(ApiError::Forbidden("vault_key_pending"))
        }
    }

    pub fn require_write(&self) -> ApiResult<()> {
        self.require_key()?;
        if self.role.can_write() {
            Ok(())
        } else {
            Err(ApiError::Forbidden("read_only"))
        }
    }

    pub fn require_owner(&self) -> ApiResult<()> {
        if self.role == Role::Owner {
            Ok(())
        } else {
            Err(ApiError::Forbidden("owner_only"))
        }
    }

    pub fn require_shared(&self) -> ApiResult<()> {
        if self.personal {
            Err(ApiError::BadRequest("personal_vault"))
        } else {
            Ok(())
        }
    }

    pub fn require_current_version(&self, key_version: i32) -> ApiResult<()> {
        if key_version == self.vault_key_version {
            Ok(())
        } else {
            Err(ApiError::Conflict("key_rotated"))
        }
    }
}

type AccessRow = (String, bool, i32, bool);

pub async fn access<'e>(
    db: impl PgExecutor<'e>,
    vault_id: Uuid,
    user_id: Uuid,
) -> ApiResult<Access> {
    let row: Option<AccessRow> = sqlx::query_as(
        "SELECT m.role, v.personal, v.key_version, m.encrypted_vault_key IS NOT NULL
         FROM vault_members m JOIN vaults v ON v.id = m.vault_id
         WHERE m.vault_id = $1 AND m.user_id = $2",
    )
    .bind(vault_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    let (role, personal, vault_key_version, has_key) =
        row.ok_or(ApiError::NotFound("vault_not_found"))?;
    Ok(Access {
        role: Role::parse(&role)?,
        personal,
        vault_key_version,
        has_key,
    })
}

pub async fn lock_vault(tx: &mut Transaction<'_, Postgres>, vault_id: Uuid) -> ApiResult<()> {
    sqlx::query("SELECT id FROM vaults WHERE id = $1 FOR UPDATE")
        .bind(vault_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn bump_vault<'e>(db: impl PgExecutor<'e>, vault_id: Uuid) -> ApiResult<()> {
    sqlx::query("UPDATE vaults SET revision = nextval('revision_seq') WHERE id = $1")
        .bind(vault_id)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn owners_with_key<'e>(db: impl PgExecutor<'e>, vault_id: Uuid) -> ApiResult<i64> {
    let (n,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM vault_members
         WHERE vault_id = $1 AND role = 'owner' AND encrypted_vault_key IS NOT NULL",
    )
    .bind(vault_id)
    .fetch_one(db)
    .await?;
    Ok(n)
}
