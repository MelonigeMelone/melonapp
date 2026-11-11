use std::collections::{HashMap, HashSet};

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use melon_crypto::EncString;
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    access::{Role, access, bump_vault, lock_vault, owners_with_key},
    auth::{AuthUser, normalize_email, token_hash},
    error::{ApiError, ApiResult},
    state::AppState,
    vaults::{check_item, check_meta, parse_sealed},
};

const INVITE_DAYS: i32 = 7;

#[derive(Deserialize)]
pub struct LookupQuery {
    email: String,
}

#[derive(Serialize)]
pub struct UserOut {
    user_id: Uuid,
    email: String,
    public_key: String,
}

pub async fn lookup_user(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(q): Query<LookupQuery>,
) -> ApiResult<Json<UserOut>> {
    let email = normalize_email(&q.email)?;
    let row: Option<(Uuid, String, String)> =
        sqlx::query_as("SELECT id, email, public_key FROM users WHERE email = $1")
            .bind(&email)
            .fetch_optional(&state.db)
            .await?;
    let (user_id, email, public_key) = row.ok_or(ApiError::NotFound("user_not_found"))?;
    Ok(Json(UserOut {
        user_id,
        email,
        public_key,
    }))
}

#[derive(Deserialize)]
pub struct AddMember {
    user_id: Uuid,
    role: Role,
    encrypted_vault_key: String,
    key_version: i32,
}

pub async fn add_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path(vault_id): Path<Uuid>,
    Json(req): Json<AddMember>,
) -> ApiResult<StatusCode> {
    parse_sealed(&req.encrypted_vault_key)?;
    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    let a = access(&mut *tx, vault_id, user.user_id).await?;
    a.require_shared()?;
    a.require_owner()?;
    a.require_key()?;
    a.require_current_version(req.key_version)?;
    let inserted = sqlx::query(
        "INSERT INTO vault_members (vault_id, user_id, role, encrypted_vault_key, key_version)
         SELECT $1, id, $3, $4, $5 FROM users WHERE id = $2
         ON CONFLICT DO NOTHING",
    )
    .bind(vault_id)
    .bind(req.user_id)
    .bind(req.role.as_str())
    .bind(&req.encrypted_vault_key)
    .bind(req.key_version)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(ApiError::Conflict("member_exists_or_unknown_user"));
    }
    bump_vault(&mut *tx, vault_id).await?;
    tx.commit().await?;
    Ok(StatusCode::CREATED)
}

#[derive(Deserialize)]
pub struct ChangeRole {
    role: Role,
}

pub async fn change_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path((vault_id, member_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<ChangeRole>,
) -> ApiResult<StatusCode> {
    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    let a = access(&mut *tx, vault_id, user.user_id).await?;
    a.require_shared()?;
    a.require_owner()?;
    let target = access(&mut *tx, vault_id, member_id).await?;
    if target.role == Role::Owner && req.role != Role::Owner && target.has_key {
        let owners = owners_with_key(&mut *tx, vault_id).await?;
        if owners <= 1 {
            return Err(ApiError::Conflict("last_owner"));
        }
    }
    sqlx::query("UPDATE vault_members SET role = $3 WHERE vault_id = $1 AND user_id = $2")
        .bind(vault_id)
        .bind(member_id)
        .bind(req.role.as_str())
        .execute(&mut *tx)
        .await?;
    bump_vault(&mut *tx, vault_id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct GrantKey {
    encrypted_vault_key: String,
    key_version: i32,
}

pub async fn grant_key(
    State(state): State<AppState>,
    user: AuthUser,
    Path((vault_id, member_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<GrantKey>,
) -> ApiResult<StatusCode> {
    parse_sealed(&req.encrypted_vault_key)?;
    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    let a = access(&mut *tx, vault_id, user.user_id).await?;
    a.require_owner()?;
    a.require_key()?;
    a.require_current_version(req.key_version)?;
    let updated = sqlx::query(
        "UPDATE vault_members SET encrypted_vault_key = $3, key_version = $4
         WHERE vault_id = $1 AND user_id = $2",
    )
    .bind(vault_id)
    .bind(member_id)
    .bind(&req.encrypted_vault_key)
    .bind(req.key_version)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::NotFound("member_not_found"));
    }
    bump_vault(&mut *tx, vault_id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path((vault_id, member_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    let a = access(&mut *tx, vault_id, user.user_id).await?;
    a.require_shared()?;
    let target = access(&mut *tx, vault_id, member_id).await?;
    let leaving = member_id == user.user_id;

    if leaving {
        if target.role == Role::Owner
            && target.has_key
            && owners_with_key(&mut *tx, vault_id).await? <= 1
        {
            return Err(ApiError::Conflict("last_owner"));
        }
    } else {
        a.require_owner()?;
        if target.has_key {
            return Err(ApiError::Conflict("rotation_required"));
        }
    }

    sqlx::query("DELETE FROM vault_members WHERE vault_id = $1 AND user_id = $2")
        .bind(vault_id)
        .bind(member_id)
        .execute(&mut *tx)
        .await?;
    if target.has_key {
        sqlx::query("UPDATE vaults SET rotation_needed = true WHERE id = $1")
            .bind(vault_id)
            .execute(&mut *tx)
            .await?;
    }
    bump_vault(&mut *tx, vault_id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct RotatedMember {
    user_id: Uuid,
    encrypted_vault_key: String,
}

#[derive(Deserialize)]
pub struct RotatedItem {
    id: Uuid,
    data: EncString,
    base_revision: i64,
}

#[derive(Deserialize)]
pub struct Rotate {
    key_version: i32,
    encrypted_meta: EncString,
    members: Vec<RotatedMember>,
    items: Vec<RotatedItem>,
    #[serde(default)]
    remove_user_ids: Vec<Uuid>,
}

pub async fn rotate(
    State(state): State<AppState>,
    user: AuthUser,
    Path(vault_id): Path<Uuid>,
    Json(req): Json<Rotate>,
) -> ApiResult<StatusCode> {
    check_meta(&req.encrypted_meta)?;
    for m in &req.members {
        parse_sealed(&m.encrypted_vault_key)?;
    }
    for i in &req.items {
        check_item(&i.data)?;
    }

    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    let a = access(&mut *tx, vault_id, user.user_id).await?;
    a.require_shared()?;
    a.require_owner()?;
    a.require_key()?;
    if req.key_version != a.vault_key_version + 1 {
        return Err(ApiError::Conflict("key_version_mismatch"));
    }
    let removed: HashSet<Uuid> = req.remove_user_ids.iter().copied().collect();
    if removed.contains(&user.user_id) {
        return Err(ApiError::BadRequest("cannot_remove_self"));
    }

    let keyed: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT user_id, role FROM vault_members
         WHERE vault_id = $1 AND encrypted_vault_key IS NOT NULL",
    )
    .bind(vault_id)
    .fetch_all(&mut *tx)
    .await?;
    let expected: HashSet<Uuid> = keyed
        .iter()
        .map(|(id, _)| *id)
        .filter(|id| !removed.contains(id))
        .collect();
    let provided: HashMap<Uuid, &str> = req
        .members
        .iter()
        .map(|m| (m.user_id, m.encrypted_vault_key.as_str()))
        .collect();
    if provided.len() != req.members.len()
        || provided.keys().copied().collect::<HashSet<_>>() != expected
    {
        return Err(ApiError::Conflict("members_changed"));
    }

    let live: Vec<(Uuid, i64)> =
        sqlx::query_as("SELECT id, revision FROM items WHERE vault_id = $1 AND NOT deleted")
            .bind(vault_id)
            .fetch_all(&mut *tx)
            .await?;
    let live: HashMap<Uuid, i64> = live.into_iter().collect();
    let items: HashMap<Uuid, i64> = req.items.iter().map(|i| (i.id, i.base_revision)).collect();
    if items.len() != req.items.len() || items != live {
        return Err(ApiError::Conflict("items_changed"));
    }

    sqlx::query("DELETE FROM vault_members WHERE vault_id = $1 AND user_id = ANY($2)")
        .bind(vault_id)
        .bind(&req.remove_user_ids)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE vault_members SET encrypted_vault_key = NULL, key_version = NULL
         WHERE vault_id = $1 AND encrypted_vault_key IS NOT NULL",
    )
    .bind(vault_id)
    .execute(&mut *tx)
    .await?;
    for (member_id, key) in &provided {
        sqlx::query(
            "UPDATE vault_members SET encrypted_vault_key = $3, key_version = $4
             WHERE vault_id = $1 AND user_id = $2",
        )
        .bind(vault_id)
        .bind(member_id)
        .bind(key)
        .bind(req.key_version)
        .execute(&mut *tx)
        .await?;
    }
    for item in &req.items {
        sqlx::query(
            "UPDATE items SET data = $3, key_version = $4, updated_at = now(),
                    revision = nextval('revision_seq')
             WHERE vault_id = $1 AND id = $2",
        )
        .bind(vault_id)
        .bind(item.id)
        .bind(item.data.to_string())
        .bind(req.key_version)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "UPDATE vaults SET key_version = $2, encrypted_meta = $3, rotation_needed = false,
                revision = nextval('revision_seq')
         WHERE id = $1",
    )
    .bind(vault_id)
    .bind(req.key_version)
    .bind(req.encrypted_meta.to_string())
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM invites WHERE vault_id = $1 AND accepted_by = ANY($2)")
        .bind(vault_id)
        .bind(&req.remove_user_ids)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    tracing::info!(%vault_id, key_version = req.key_version, "vault key rotated");
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct CreateInvite {
    email: String,
    role: Role,
}

#[derive(Serialize)]
pub struct InviteCreated {
    id: Uuid,
    token: String,
    expires_in_days: i32,
}

pub async fn create_invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path(vault_id): Path<Uuid>,
    Json(req): Json<CreateInvite>,
) -> ApiResult<(StatusCode, Json<InviteCreated>)> {
    let email = normalize_email(&req.email)?;
    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    let a = access(&mut *tx, vault_id, user.user_id).await?;
    a.require_shared()?;
    a.require_owner()?;
    let exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_some() {
        return Err(ApiError::Conflict("user_exists"));
    }
    let mut raw = [0u8; 32];
    OsRng.fill_bytes(&mut raw);
    let token = URL_SAFE_NO_PAD.encode(raw);
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO invites (id, token_hash, email, vault_id, role, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))",
    )
    .bind(id)
    .bind(token_hash(&token))
    .bind(&email)
    .bind(vault_id)
    .bind(req.role.as_str())
    .bind(user.user_id)
    .bind(INVITE_DAYS)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(InviteCreated {
            id,
            token,
            expires_in_days: INVITE_DAYS,
        }),
    ))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct InviteOut {
    id: Uuid,
    email: String,
    role: String,
    expires_in_hours: i64,
}

#[derive(Serialize)]
pub struct InviteList {
    invites: Vec<InviteOut>,
}

pub async fn list_invites(
    State(state): State<AppState>,
    user: AuthUser,
    Path(vault_id): Path<Uuid>,
) -> ApiResult<Json<InviteList>> {
    access(&state.db, vault_id, user.user_id)
        .await?
        .require_owner()?;
    let invites: Vec<InviteOut> = sqlx::query_as(
        "SELECT id, email, role,
                (extract(epoch FROM expires_at - now()) / 3600)::bigint AS expires_in_hours
         FROM invites
         WHERE vault_id = $1 AND accepted_by IS NULL AND expires_at > now()
         ORDER BY created_at",
    )
    .bind(vault_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(InviteList { invites }))
}

pub async fn delete_invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path((vault_id, invite_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    let mut tx = state.db.begin().await?;
    lock_vault(&mut tx, vault_id).await?;
    access(&mut *tx, vault_id, user.user_id)
        .await?
        .require_owner()?;
    sqlx::query("DELETE FROM invites WHERE id = $1 AND vault_id = $2")
        .bind(invite_id)
        .bind(vault_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
