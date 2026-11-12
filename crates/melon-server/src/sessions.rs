use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    state::AppState,
};

const MAX_DEVICE_LEN: usize = 64;

fn hidden(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{061C}' | '\u{200B}'..='\u{200F}' | '\u{2028}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}'
        )
}

pub(crate) fn device_label(raw: &str) -> String {
    raw.chars()
        .filter(|c| !hidden(*c))
        .collect::<String>()
        .trim()
        .chars()
        .take(MAX_DEVICE_LEN)
        .collect()
}

#[derive(Serialize)]
pub struct SessionOut {
    id: Uuid,
    device: String,
    created_at: i64,
    last_seen_at: i64,
    current: bool,
}

#[derive(Serialize)]
pub struct SessionList {
    sessions: Vec<SessionOut>,
}

pub async fn list_sessions(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<SessionList>> {
    let rows: Vec<(Uuid, String, i64, i64)> = sqlx::query_as(
        "SELECT id, device, extract(epoch FROM created_at)::bigint, extract(epoch FROM last_seen_at)::bigint
         FROM sessions
         WHERE user_id = $1 AND scope = 'full' AND expires_at > now()
         ORDER BY last_seen_at DESC",
    )
    .bind(user.user_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(SessionList {
        sessions: rows
            .into_iter()
            .map(|(id, device, created_at, last_seen_at)| SessionOut {
                current: id == user.session_id,
                id,
                device,
                created_at,
                last_seen_at,
            })
            .collect(),
    }))
}

pub async fn revoke_session(
    State(state): State<AppState>,
    user: AuthUser,
    Path(session_id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    let done = sqlx::query("DELETE FROM sessions WHERE id = $1 AND user_id = $2")
        .bind(session_id)
        .bind(user.user_id)
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(ApiError::NotFound("session_not_found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn revoke_other_sessions(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<StatusCode> {
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2")
        .bind(user.user_id)
        .bind(user.session_id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_labels_are_trimmed_cleaned_and_short() {
        assert_eq!(
            device_label("  Firefox auf Windows \n"),
            "Firefox auf Windows"
        );
        assert_eq!(device_label("a\u{0}b\u{1b}[31mc"), "ab[31mc");
        assert_eq!(device_label(&"x".repeat(500)).len(), MAX_DEVICE_LEN);
        assert_eq!(
            device_label("Chrome\u{202E}swodniW\u{200B} auf\u{2066} Mac"),
            "ChromeswodniW auf Mac"
        );
    }
}
