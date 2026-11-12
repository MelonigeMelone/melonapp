use anyhow::anyhow;
use axum::{Json, extract::State, http::StatusCode};
use base64::{Engine, engine::general_purpose::STANDARD};
use melon_crypto::{EncString, KdfParams};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::{
        AuthUser, RecoveryUser, create_session, decode_auth_key, hash_auth_key, normalize_email,
        verify_auth_key,
    },
    client_ip::{self, ClientIp},
    error::{ApiError, ApiResult},
    state::AppState,
};

const MAX_KEY_BLOB: usize = 512;
const RECOVERY_MINUTES: i32 = 15;

fn key(b64: &str) -> ApiResult<[u8; 32]> {
    decode_auth_key(b64).ok_or(ApiError::BadRequest("invalid_auth_key"))
}

fn blob(enc: &EncString) -> ApiResult<String> {
    if enc.encoded_len() > MAX_KEY_BLOB {
        Err(ApiError::BadRequest("invalid_key_material"))
    } else {
        Ok(enc.to_string())
    }
}

async fn hash(secret: [u8; 32]) -> ApiResult<String> {
    Ok(tokio::task::spawn_blocking(move || hash_auth_key(&secret))
        .await
        .map_err(|e| anyhow!(e))??)
}

async fn verify(secret: [u8; 32], phc: String) -> ApiResult<bool> {
    Ok(
        tokio::task::spawn_blocking(move || verify_auth_key(&secret, &phc))
            .await
            .map_err(|e| anyhow!(e))?,
    )
}

#[derive(Deserialize)]
pub struct NewCredentials {
    kdf: KdfParams,
    salt: String,
    auth_key: String,
    wrapped_account_key: EncString,
}

struct ValidCredentials {
    kdf: KdfParams,
    salt: String,
    auth_hash: String,
    wrapped_account_key: String,
}

async fn validate(c: NewCredentials) -> ApiResult<ValidCredentials> {
    c.kdf
        .validate()
        .map_err(|_| ApiError::BadRequest("invalid_kdf"))?;
    let salt_len = STANDARD.decode(&c.salt).map(|s| s.len()).unwrap_or(0);
    if !(16..=64).contains(&salt_len) {
        return Err(ApiError::BadRequest("invalid_salt"));
    }
    let wrapped_account_key = blob(&c.wrapped_account_key)?;
    Ok(ValidCredentials {
        kdf: c.kdf,
        salt: c.salt,
        auth_hash: hash(key(&c.auth_key)?).await?,
        wrapped_account_key,
    })
}

async fn store_credentials(state: &AppState, user_id: Uuid, c: &ValidCredentials) -> ApiResult<()> {
    sqlx::query(
        "UPDATE users SET kdf_memory_kib = $2, kdf_iterations = $3, kdf_parallelism = $4,
                kdf_salt = $5, auth_hash = $6, wrapped_account_key = $7
         WHERE id = $1",
    )
    .bind(user_id)
    .bind(c.kdf.memory_kib as i32)
    .bind(c.kdf.iterations as i32)
    .bind(c.kdf.parallelism as i32)
    .bind(&c.salt)
    .bind(&c.auth_hash)
    .bind(&c.wrapped_account_key)
    .execute(&state.db)
    .await?;
    Ok(())
}

async fn require_current_password(state: &AppState, user_id: Uuid, current: &str) -> ApiResult<()> {
    let limiter_key = format!("reauth:{user_id}");
    if !state.begin_attempt(&limiter_key, None) {
        return Err(ApiError::TooManyRequests);
    }
    let (phc,): (String,) = sqlx::query_as("SELECT auth_hash FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
    let candidate = decode_auth_key(current).unwrap_or([0u8; 32]);
    if verify(candidate, phc).await? {
        state.attempt_succeeded(&limiter_key, None);
        Ok(())
    } else {
        Err(ApiError::Forbidden("wrong_password"))
    }
}

#[derive(Deserialize)]
pub struct ChangePassword {
    current_auth_key: String,
    #[serde(flatten)]
    new: NewCredentials,
}

pub async fn change_password(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<ChangePassword>,
) -> ApiResult<StatusCode> {
    require_current_password(&state, user.user_id, &req.current_auth_key).await?;
    let creds = validate(req.new).await?;
    store_credentials(&state, user.user_id, &creds).await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2")
        .bind(user.user_id)
        .bind(&user.token_hash)
        .execute(&state.db)
        .await?;
    tracing::info!(user_id = %user.user_id, "master password changed");
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct SetRecovery {
    current_auth_key: String,
    recovery_auth_key: String,
    recovery_wrapped_account_key: EncString,
}

pub async fn set_recovery(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<SetRecovery>,
) -> ApiResult<StatusCode> {
    require_current_password(&state, user.user_id, &req.current_auth_key).await?;
    let recovery_hash = hash(key(&req.recovery_auth_key)?).await?;
    sqlx::query(
        "UPDATE users SET recovery_auth_hash = $2, recovery_wrapped_account_key = $3 WHERE id = $1",
    )
    .bind(user.user_id)
    .bind(recovery_hash)
    .bind(blob(&req.recovery_wrapped_account_key)?)
    .execute(&state.db)
    .await?;
    tracing::info!(user_id = %user.user_id, "recovery key set");
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct RecoverStart {
    email: String,
    recovery_auth_key: String,
}

#[derive(Serialize)]
pub struct RecoverStarted {
    token: String,
    expires_in_seconds: i64,
    recovery_wrapped_account_key: String,
}

pub async fn recover_start(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(req): Json<RecoverStart>,
) -> ApiResult<Json<RecoverStarted>> {
    let email = normalize_email(&req.email)?;
    let limiter_key = format!("recover:{email}");
    let ip_key = ip.map(client_ip::limiter_key);
    if !state.begin_attempt(&limiter_key, ip_key.as_deref()) {
        return Err(ApiError::TooManyRequests);
    }
    let row: Option<(Uuid, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, recovery_auth_hash, recovery_wrapped_account_key FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await?;
    let phc = row
        .as_ref()
        .and_then(|r| r.1.clone())
        .unwrap_or_else(|| state.dummy_hash.clone());
    let candidate = decode_auth_key(&req.recovery_auth_key);
    let matches = verify(candidate.unwrap_or([0u8; 32]), phc).await?;

    let found = row.and_then(|(id, h, w)| match (h, w) {
        (Some(_), Some(w)) if matches && candidate.is_some() => Some((id, w)),
        _ => None,
    });
    let Some((user_id, recovery_wrapped_account_key)) = found else {
        tracing::info!("failed recovery attempt");
        return Err(ApiError::Unauthorized);
    };
    state.attempt_succeeded(&limiter_key, ip_key.as_deref());
    let token = create_session(&state, user_id, "recovery", RECOVERY_MINUTES, "").await?;
    Ok(Json(RecoverStarted {
        token,
        expires_in_seconds: i64::from(RECOVERY_MINUTES) * 60,
        recovery_wrapped_account_key,
    }))
}

pub async fn recover_complete(
    State(state): State<AppState>,
    user: RecoveryUser,
    Json(req): Json<NewCredentials>,
) -> ApiResult<StatusCode> {
    let creds = validate(req).await?;
    store_credentials(&state, user.user_id, &creds).await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(user.user_id)
        .execute(&state.db)
        .await?;
    tracing::info!(user_id = %user.user_id, "account recovered with recovery key");
    Ok(StatusCode::NO_CONTENT)
}
