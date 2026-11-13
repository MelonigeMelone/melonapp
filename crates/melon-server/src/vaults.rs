use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use melon_crypto::{EncString, SealedKey};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    access::{Role, access, lock_vault},
    auth::AuthUser,
    error::{ApiError, ApiResult},
    state::AppState,
};

pub const MAX_META_LEN: usize = 64 * 1024;
pub const MAX_ITEM_LEN: usize = 64 * 1024;
const PAGE_SIZE: i64 = 1000;

pub fn parse_sealed(s: &str) -> ApiResult<()> {
    SealedKey::parse(s)
        .map(|_| ())
        .map_err(|_| ApiError::BadRequest("invalid_vault_key"))
}

pub fn check_meta(meta: &EncString) -> ApiResult<()> {
    if meta.encoded_len() > MAX_META_LEN {
        Err(ApiError::BadRequest("meta_too_large"))
    } else {
        Ok(())
    }
}

pub fn check_item(data: &EncString) -> ApiResult<()> {
    if data.encoded_len() > MAX_ITEM_LEN {
        Err(ApiError::BadRequest("item_too_large"))
    } else {
        Ok(())
    }
}

#[derive(Serialize)]
pub struct MemberOut {
    user_id: Uuid,
    email: String,
    role: Role,
    public_key: String,
    has_key: bool,
    key_version: Option<i32>,
}

#[derive(Serialize)]
pub struct VaultOut {
    id: Uuid,
    personal: bool,
    encrypted_meta: String,
    key_version: i32,
    revision: i64,
    rotation_needed: bool,
    role: Role,
    encrypted_vault_key: Option<String>,
    member_key_version: Option<i32>,
    members: Vec<MemberOut>,
}

#[derive(Serialize)]
pub struct VaultList {
    vaults: Vec<VaultOut>,
}

type VaultRow = (
    Uuid,
    bool,
    String,
    i32,
    i64,
    bool,
    String,
    Option<String>,
    Option<i32>,
);
type MemberRow = (Uuid, Uuid, String, String, String, bool, Option<i32>);

pub async fn list_vaults(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<VaultList>> {
    let rows: Vec<VaultRow> = sqlx::query_as(
        "SELECT v.id, v.personal, v.encrypted_meta, v.key_version, v.revision, v.rotation_needed,
                m.role, m.encrypted_vault_key, m.key_version
         FROM vault_members m JOIN vaults v ON v.id = m.vault_id
         WHERE m.user_id = $1 ORDER BY v.personal DESC, v.created_at",
    )
    .bind(user.user_id)
    .fetch_all(&state.db)
    .await?;

    let ids: Vec<Uuid> = rows.iter().map(|r| r.0).collect();
    let member_rows: Vec<MemberRow> = sqlx::query_as(
        "SELECT m.vault_id, u.id, u.email, m.role, u.public_key,
                m.encrypted_vault_key IS NOT NULL, m.key_version
         FROM vault_members m JOIN users u ON u.id = m.user_id
         WHERE m.vault_id = ANY($1) ORDER BY u.email",
    )
    .bind(&ids)
    .fetch_all(&state.db)
    .await?;

    let mut members: HashMap<Uuid, Vec<MemberOut>> = HashMap::new();
    for (vault_id, user_id, email, role, public_key, has_key, key_version) in member_rows {
        members.entry(vault_id).or_default().push(MemberOut {
            user_id,
            email,
            role: Role::parse(&role)?,
            public_key,
            has_key,
            key_version,
        });
    }

    let mut vaults = Vec::with_capacity(rows.len());
    for (
        id,
        personal,
        encrypted_meta,
        key_version,
        revision,
        rotation_needed,
        role,
        key,
        member_key_version,
    ) in rows
    {
        vaults.push(VaultOut {
            id,
            personal,
            encrypted_meta,
            key_version,
            revision,
            rotation_needed,
            role: Role::parse(&role)?,
            encrypted_vault_key: key,
            member_key_version,
            members: members.remove(&id).unwrap_or_default(),
        });
    }
    Ok(Json(VaultList { vaults }))
}

#[derive(Deserialize)]
pub struct CreateVault {
    id: Uuid,
    encrypted_meta: EncString,
    encrypted_vault_key: String,
}

#[derive(Serialize)]
pub struct RevisionOut {
    revision: i64,
}

pub async fn create_vault(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<CreateVault>,
) -> ApiResult<(StatusCode, Json<RevisionOut>)> {
    check_meta(&req.encrypted_meta)?;
    parse_sealed(&req.encrypted_vault_key)?;
    let mut tx = state.db.begin().await?;
    let row: Option<(i64,)> = sqlx::query_as(
        "INSERT INTO vaults (id, personal, encrypted_meta, revision)
         VALUES ($1, false, $2, nextval('revision_seq'))
         ON CONFLICT DO NOTHING RETURNING revision",
    )
    .bind(req.id)
    .bind(req.encrypted_meta.to_string())
    .fetch_optional(&mut *tx)
    .await?;
    let (revision,) = row.ok_or(ApiError::Conflict("vault_exists"))?;
    sqlx::query(
        "INSERT INTO vault_members (vault_id, user_id, role, encrypted_vault_key, key_version)
         VALUES ($1, $2, 'owner', $3, 1)",
    )
    .bind(req.id)
    .bind(user.user_id)
    .bind(&req.encrypted_vault_key)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(RevisionOut { revision })))
}

#[derive(Deserialize)]
pub struct UpdateVault {
    encrypted_meta: EncString,
    key_version: i32,
}

pub async fn update_vault(
    State(state): State<AppState>,
    user: AuthUser,
    Path(vault_id): Path<Uuid>,
    Json(req): Json<UpdateVault>,
) -> ApiResult<Json<RevisionOut>> {
    check_meta(&req.encrypted_meta)?;
    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    let a = access(&mut *tx, vault_id, user.user_id).await?;
    a.require_key()?;
    a.require_owner()?;
    a.require_current_version(req.key_version)?;
    let (revision,): (i64,) = sqlx::query_as(
        "UPDATE vaults SET encrypted_meta = $2, revision = nextval('revision_seq')
         WHERE id = $1 RETURNING revision",
    )
    .bind(vault_id)
    .bind(req.encrypted_meta.to_string())
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(RevisionOut { revision }))
}

pub async fn delete_vault(
    State(state): State<AppState>,
    user: AuthUser,
    Path(vault_id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    let a = access(&mut *tx, vault_id, user.user_id).await?;
    a.require_shared()?;
    a.require_owner()?;
    sqlx::query("DELETE FROM vaults WHERE id = $1")
        .bind(vault_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct SyncQuery {
    #[serde(default)]
    since: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ItemOut {
    id: Uuid,
    data: Option<String>,
    key_version: i32,
    revision: i64,
    deleted: bool,
}

#[derive(Serialize)]
pub struct ItemPage {
    items: Vec<ItemOut>,
    latest_revision: i64,
    has_more: bool,
}

pub async fn list_items(
    State(state): State<AppState>,
    user: AuthUser,
    Path(vault_id): Path<Uuid>,
    Query(q): Query<SyncQuery>,
) -> ApiResult<Json<ItemPage>> {
    access(&state.db, vault_id, user.user_id)
        .await?
        .require_key()?;
    let items: Vec<ItemOut> = sqlx::query_as(
        "SELECT id, data, key_version, revision, deleted FROM items
         WHERE vault_id = $1 AND revision > $2 ORDER BY revision LIMIT $3",
    )
    .bind(vault_id)
    .bind(q.since)
    .bind(PAGE_SIZE)
    .fetch_all(&state.db)
    .await?;
    let latest_revision = items.last().map_or(q.since, |i| i.revision);
    let has_more = items.len() as i64 == PAGE_SIZE;
    Ok(Json(ItemPage {
        items,
        latest_revision,
        has_more,
    }))
}

#[derive(Deserialize)]
pub struct PutItem {
    data: EncString,
    key_version: i32,
    base_revision: Option<i64>,
}

pub async fn put_item(
    State(state): State<AppState>,
    user: AuthUser,
    Path((vault_id, item_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<PutItem>,
) -> ApiResult<Json<RevisionOut>> {
    check_item(&req.data)?;
    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    let a = access(&mut *tx, vault_id, user.user_id).await?;
    a.require_write()?;
    a.require_current_version(req.key_version)?;
    let data = req.data.to_string();

    let row: Option<(i64,)> =
        match req.base_revision {
            None => {
                sqlx::query_as(
                    "INSERT INTO items (vault_id, id, data, key_version, revision)
                 VALUES ($1, $2, $3, $4, nextval('revision_seq'))
                 ON CONFLICT DO NOTHING RETURNING revision",
                )
                .bind(vault_id)
                .bind(item_id)
                .bind(&data)
                .bind(req.key_version)
                .fetch_optional(&mut *tx)
                .await?
            }
            Some(base) => sqlx::query_as(
                "UPDATE items SET data = $3, key_version = $4, deleted = false, updated_at = now(),
                        revision = nextval('revision_seq')
                 WHERE vault_id = $1 AND id = $2 AND revision = $5
                 RETURNING revision",
            )
            .bind(vault_id)
            .bind(item_id)
            .bind(&data)
            .bind(req.key_version)
            .bind(base)
            .fetch_optional(&mut *tx)
            .await?,
        };
    let (revision,) = row.ok_or(ApiError::Conflict("revision_mismatch"))?;
    tx.commit().await?;
    Ok(Json(RevisionOut { revision }))
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    base_revision: i64,
}

pub async fn delete_item(
    State(state): State<AppState>,
    user: AuthUser,
    Path((vault_id, item_id)): Path<(Uuid, Uuid)>,
    Query(q): Query<DeleteQuery>,
) -> ApiResult<Json<RevisionOut>> {
    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    access(&mut *tx, vault_id, user.user_id)
        .await?
        .require_write()?;
    let row: Option<(i64,)> = sqlx::query_as(
        "UPDATE items SET data = NULL, deleted = true, updated_at = now(),
                revision = nextval('revision_seq')
         WHERE vault_id = $1 AND id = $2 AND revision = $3 AND NOT deleted
         RETURNING revision",
    )
    .bind(vault_id)
    .bind(item_id)
    .bind(q.base_revision)
    .fetch_optional(&mut *tx)
    .await?;
    let (revision,) = row.ok_or(ApiError::Conflict("revision_mismatch"))?;
    tx.commit().await?;
    Ok(Json(RevisionOut { revision }))
}
