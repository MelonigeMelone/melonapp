use axum::{
    Json,
    extract::{Path, Query, State},
};
use melon_crypto::EncString;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    state::AppState,
};

const MAX_ITEM_LEN: usize = 64 * 1024;
const PAGE_SIZE: i64 = 1000;

fn validate_module(module: &str) -> ApiResult<()> {
    let mut chars = module.chars();
    let valid = (1..=32).contains(&module.len())
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
    if valid {
        Ok(())
    } else {
        Err(ApiError::BadRequest("invalid_module"))
    }
}

#[derive(Deserialize)]
pub struct SyncQuery {
    #[serde(default)]
    since: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ItemOut {
    id: Uuid,
    module: String,
    data: Option<String>,
    revision: i64,
    deleted: bool,
}

#[derive(Serialize)]
pub struct SyncResponse {
    items: Vec<ItemOut>,
    latest_revision: i64,
    has_more: bool,
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<SyncQuery>,
) -> ApiResult<Json<SyncResponse>> {
    let items: Vec<ItemOut> = sqlx::query_as(
        "SELECT id, module, data, revision, deleted FROM items
         WHERE user_id = $1 AND revision > $2 ORDER BY revision LIMIT $3",
    )
    .bind(user.user_id)
    .bind(q.since)
    .bind(PAGE_SIZE)
    .fetch_all(&state.db)
    .await?;

    let latest_revision = items.last().map_or(q.since, |i| i.revision);
    let has_more = items.len() as i64 == PAGE_SIZE;
    Ok(Json(SyncResponse {
        items,
        latest_revision,
        has_more,
    }))
}

#[derive(Deserialize)]
pub struct PutRequest {
    module: String,
    data: EncString,
    base_revision: Option<i64>,
}

#[derive(Serialize)]
pub struct RevisionResponse {
    revision: i64,
}

pub async fn put(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<PutRequest>,
) -> ApiResult<Json<RevisionResponse>> {
    validate_module(&req.module)?;
    if req.data.encoded_len() > MAX_ITEM_LEN {
        return Err(ApiError::BadRequest("item_too_large"));
    }
    let data = req.data.to_string();

    let revision: Option<(i64,)> = match req.base_revision {
        None => {
            sqlx::query_as(
                "INSERT INTO items (user_id, id, module, data, revision)
                 VALUES ($1, $2, $3, $4, nextval('item_revision_seq'))
                 ON CONFLICT DO NOTHING RETURNING revision",
            )
            .bind(user.user_id)
            .bind(id)
            .bind(&req.module)
            .bind(&data)
            .fetch_optional(&state.db)
            .await?
        }
        Some(base) => {
            sqlx::query_as(
                "UPDATE items SET data = $4, deleted = false, updated_at = now(),
                        revision = nextval('item_revision_seq')
                 WHERE user_id = $1 AND id = $2 AND module = $3 AND revision = $5
                 RETURNING revision",
            )
            .bind(user.user_id)
            .bind(id)
            .bind(&req.module)
            .bind(&data)
            .bind(base)
            .fetch_optional(&state.db)
            .await?
        }
    };

    revision
        .map(|(revision,)| Json(RevisionResponse { revision }))
        .ok_or(ApiError::Conflict("revision_mismatch"))
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    base_revision: i64,
}

pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<DeleteQuery>,
) -> ApiResult<Json<RevisionResponse>> {
    let revision: Option<(i64,)> = sqlx::query_as(
        "UPDATE items SET data = NULL, deleted = true, updated_at = now(),
                revision = nextval('item_revision_seq')
         WHERE user_id = $1 AND id = $2 AND revision = $3 AND NOT deleted
         RETURNING revision",
    )
    .bind(user.user_id)
    .bind(id)
    .bind(q.base_revision)
    .fetch_optional(&state.db)
    .await?;

    revision
        .map(|(revision,)| Json(RevisionResponse { revision }))
        .ok_or(ApiError::Conflict("revision_mismatch"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_names() {
        for ok in ["passwords", "totp", "notes-v2", "a_b"] {
            assert!(validate_module(ok).is_ok(), "{ok}");
        }
        for bad in ["", "Passwords", "1abc", "a b", "../x", &"a".repeat(33)] {
            assert!(validate_module(bad).is_err(), "{bad}");
        }
    }
}
