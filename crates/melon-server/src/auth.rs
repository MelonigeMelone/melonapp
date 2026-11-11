use anyhow::anyhow;
use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::{
    Json,
    extract::{FromRequestParts, State},
    http::{StatusCode, header::AUTHORIZATION, request::Parts},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use hmac::{Hmac, Mac};
use melon_crypto::{EncString, KdfParams};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    state::AppState,
};

fn server_argon() -> Argon2<'static> {
    let params = Params::new(19 * 1024, 2, 1, None).expect("static params are valid");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

pub fn hash_auth_key(auth_key: &[u8]) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    server_argon()
        .hash_password(auth_key, &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow!("hashing failed: {e}"))
}

fn verify_auth_key(auth_key: &[u8], phc: &str) -> bool {
    PasswordHash::new(phc)
        .map(|h| server_argon().verify_password(auth_key, &h).is_ok())
        .unwrap_or(false)
}

fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn normalize_email(raw: &str) -> ApiResult<String> {
    let email = raw.trim().to_lowercase();
    let valid = email.len() <= 254
        && email
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.'));
    if valid {
        Ok(email)
    } else {
        Err(ApiError::BadRequest("invalid_email"))
    }
}

fn decode_auth_key(b64: &str) -> Option<[u8; 32]> {
    STANDARD.decode(b64).ok()?.try_into().ok()
}

fn kdf_from_row(memory: i32, iterations: i32, parallelism: i32) -> KdfParams {
    KdfParams {
        memory_kib: memory as u32,
        iterations: iterations as u32,
        parallelism: parallelism as u32,
    }
}

#[derive(Deserialize)]
pub struct PreloginRequest {
    email: String,
}

#[derive(Serialize)]
pub struct PreloginResponse {
    kdf: KdfParams,
    salt: String,
}

pub async fn prelogin(
    State(state): State<AppState>,
    Json(req): Json<PreloginRequest>,
) -> ApiResult<Json<PreloginResponse>> {
    let email = normalize_email(&req.email)?;
    let row: Option<(i32, i32, i32, String)> = sqlx::query_as(
        "SELECT kdf_memory_kib, kdf_iterations, kdf_parallelism, kdf_salt FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await?;

    let resp = match row {
        Some((m, i, p, salt)) => PreloginResponse {
            kdf: kdf_from_row(m, i, p),
            salt,
        },
        None => {
            let mut mac = Hmac::<Sha256>::new_from_slice(&state.config.server_secret)
                .expect("HMAC accepts any key length");
            mac.update(b"melon/prelogin-salt\0");
            mac.update(email.as_bytes());
            let fake = mac.finalize().into_bytes();
            PreloginResponse {
                kdf: KdfParams::default(),
                salt: STANDARD.encode(&fake[..16]),
            }
        }
    };
    Ok(Json(resp))
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    email: String,
    kdf: KdfParams,
    salt: String,
    auth_key: String,
    wrapped_vault_key: EncString,
}

#[derive(Serialize)]
pub struct RegisterResponse {
    user_id: Uuid,
}

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> ApiResult<(StatusCode, Json<RegisterResponse>)> {
    if !state.config.allow_registration {
        return Err(ApiError::Forbidden("registration_disabled"));
    }
    let email = normalize_email(&req.email)?;
    req.kdf
        .validate()
        .map_err(|_| ApiError::BadRequest("invalid_kdf"))?;
    let salt_len = STANDARD.decode(&req.salt).map(|s| s.len()).unwrap_or(0);
    if !(16..=64).contains(&salt_len) {
        return Err(ApiError::BadRequest("invalid_salt"));
    }
    let auth_key =
        decode_auth_key(&req.auth_key).ok_or(ApiError::BadRequest("invalid_auth_key"))?;
    if req.wrapped_vault_key.encoded_len() > 512 {
        return Err(ApiError::BadRequest("invalid_wrapped_key"));
    }

    let auth_hash = tokio::task::spawn_blocking(move || hash_auth_key(&auth_key))
        .await
        .map_err(|e| anyhow!(e))??;

    let user_id = Uuid::new_v4();
    let result = sqlx::query(
        "INSERT INTO users (id, email, kdf_memory_kib, kdf_iterations, kdf_parallelism, kdf_salt, auth_hash, wrapped_vault_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(user_id)
    .bind(&email)
    .bind(req.kdf.memory_kib as i32)
    .bind(req.kdf.iterations as i32)
    .bind(req.kdf.parallelism as i32)
    .bind(&req.salt)
    .bind(&auth_hash)
    .bind(req.wrapped_vault_key.to_string())
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => {
            tracing::info!(%user_id, "account registered");
            Ok((StatusCode::CREATED, Json(RegisterResponse { user_id })))
        }
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            Err(ApiError::Conflict("email_taken"))
        }
        Err(e) => Err(e.into()),
    }
}

#[derive(Deserialize)]
pub struct LoginRequest {
    email: String,
    auth_key: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    token: String,
    expires_in_seconds: i64,
    user_id: Uuid,
    wrapped_vault_key: String,
}

type UserAuthRow = (Uuid, String, String);

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> ApiResult<Json<LoginResponse>> {
    let email = normalize_email(&req.email)?;
    if state.limiter.is_blocked(&email) {
        return Err(ApiError::TooManyRequests);
    }

    let user: Option<UserAuthRow> =
        sqlx::query_as("SELECT id, auth_hash, wrapped_vault_key FROM users WHERE email = $1")
            .bind(&email)
            .fetch_optional(&state.db)
            .await?;

    let phc = user
        .as_ref()
        .map_or_else(|| state.dummy_hash.clone(), |(_, h, _)| h.clone());
    let key = decode_auth_key(&req.auth_key);
    let key_for_check = key.unwrap_or([0u8; 32]);
    let matches = tokio::task::spawn_blocking(move || verify_auth_key(&key_for_check, &phc))
        .await
        .map_err(|e| anyhow!(e))?;

    let Some((user_id, _, wrapped_vault_key)) = user.filter(|_| matches && key.is_some()) else {
        state.limiter.record_failure(&email);
        tracing::info!("failed login");
        return Err(ApiError::Unauthorized);
    };
    state.limiter.reset(&email);

    let mut raw = [0u8; 32];
    OsRng.fill_bytes(&mut raw);
    let token = URL_SAFE_NO_PAD.encode(raw);
    let ttl_hours = state.config.session_ttl_hours;

    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()")
        .bind(user_id)
        .execute(&state.db)
        .await?;
    sqlx::query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))",
    )
    .bind(token_hash(&token))
    .bind(user_id)
    .bind(ttl_hours)
    .execute(&state.db)
    .await?;

    Ok(Json(LoginResponse {
        token,
        expires_in_seconds: i64::from(ttl_hours) * 3600,
        user_id,
        wrapped_vault_key,
    }))
}

pub async fn logout(State(state): State<AppState>, user: AuthUser) -> ApiResult<StatusCode> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
        .bind(&user.token_hash)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub struct AuthUser {
    pub user_id: Uuid,
    token_hash: Vec<u8>,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|t| !t.is_empty() && t.len() <= 128)
            .ok_or(ApiError::Unauthorized)?;
        let hash = token_hash(token);
        let row: Option<(Uuid,)> = sqlx::query_as(
            "SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()",
        )
        .bind(&hash)
        .fetch_optional(&state.db)
        .await?;
        let (user_id,) = row.ok_or(ApiError::Unauthorized)?;
        Ok(Self {
            user_id,
            token_hash: hash,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_is_normalized_and_validated() {
        assert_eq!(
            normalize_email("  Max@Example.COM ").unwrap(),
            "max@example.com"
        );
        assert!(normalize_email("no-at-sign").is_err());
        assert!(normalize_email("@example.com").is_err());
        assert!(normalize_email("max@localhost").is_err());
    }

    #[test]
    fn auth_hash_verifies_only_the_right_key() {
        let phc = hash_auth_key(&[7u8; 32]).unwrap();
        assert!(verify_auth_key(&[7u8; 32], &phc));
        assert!(!verify_auth_key(&[8u8; 32], &phc));
        assert!(!verify_auth_key(&[7u8; 32], "garbage"));
    }
}
