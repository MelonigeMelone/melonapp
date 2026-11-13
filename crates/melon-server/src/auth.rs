use anyhow::anyhow;
use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
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
use hmac::{Hmac, KeyInit, Mac};
use melon_crypto::{EncString, KdfParams, PublicKey, SealedKey};
use rand::{Rng, rand_core::UnwrapErr, rngs::SysRng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::client_ip::{ClientIp, limiter_key};
use crate::{
    access::{bump_vault, lock_vault},
    error::{ApiError, ApiResult},
    state::AppState,
    vaults::MAX_META_LEN,
};

fn server_argon() -> Argon2<'static> {
    let params = Params::new(19 * 1024, 2, 1, None).expect("static params are valid");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

pub fn hash_auth_key(auth_key: &[u8]) -> anyhow::Result<String> {
    PasswordHasher::<PasswordHash>::hash_password(&server_argon(), auth_key)
        .map(|h| h.to_string())
        .map_err(|e| anyhow!("hashing failed: {e}"))
}

pub(crate) fn verify_auth_key(auth_key: &[u8], phc: &str) -> bool {
    PasswordHash::new(phc)
        .map(|h| server_argon().verify_password(auth_key, &h).is_ok())
        .unwrap_or(false)
}

fn fake_salt(server_secret: &[u8], email: &str) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(server_secret).expect("HMAC accepts any key length");
    mac.update(b"melon/prelogin-salt\0");
    mac.update(email.as_bytes());
    let fake = mac.finalize().into_bytes();
    STANDARD.encode(&fake[..16])
}

pub(crate) fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

pub(crate) fn normalize_email(raw: &str) -> ApiResult<String> {
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

pub(crate) fn decode_auth_key(b64: &str) -> Option<[u8; 32]> {
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
        None => PreloginResponse {
            kdf: KdfParams::default(),
            salt: fake_salt(&state.config.server_secret, &email),
        },
    };
    Ok(Json(resp))
}

#[derive(Deserialize)]
pub struct PersonalVault {
    id: Uuid,
    encrypted_meta: EncString,
    encrypted_vault_key: String,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    user_id: Uuid,
    email: String,
    kdf: KdfParams,
    salt: String,
    auth_key: String,
    wrapped_account_key: EncString,
    public_key: String,
    encrypted_private_key: EncString,
    personal_vault: PersonalVault,
    invite_token: Option<String>,
}

#[derive(Serialize)]
pub struct RegisterResponse {
    user_id: Uuid,
}

const MAX_KEY_BLOB: usize = 512;
const MAX_SESSIONS: i64 = 20;

type InviteRow = (Uuid, String, Uuid, String);

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> ApiResult<(StatusCode, Json<RegisterResponse>)> {
    let email = normalize_email(&req.email)?;

    let invite: Option<InviteRow> = match &req.invite_token {
        Some(token) => {
            let row: Option<InviteRow> = sqlx::query_as(
                "SELECT id, email, vault_id, role FROM invites
                 WHERE token_hash = $1 AND accepted_by IS NULL AND expires_at > now()",
            )
            .bind(token_hash(token))
            .fetch_optional(&state.db)
            .await?;
            let row = row.ok_or(ApiError::BadRequest("invalid_invite"))?;
            if row.1 != email {
                return Err(ApiError::BadRequest("invite_email_mismatch"));
            }
            Some(row)
        }
        None => None,
    };
    if invite.is_none() && !state.config.allow_registration {
        return Err(ApiError::Forbidden("registration_disabled"));
    }

    req.kdf
        .validate()
        .map_err(|_| ApiError::BadRequest("invalid_kdf"))?;
    let salt_len = STANDARD.decode(&req.salt).map(|s| s.len()).unwrap_or(0);
    if !(16..=64).contains(&salt_len) {
        return Err(ApiError::BadRequest("invalid_salt"));
    }
    let auth_key =
        decode_auth_key(&req.auth_key).ok_or(ApiError::BadRequest("invalid_auth_key"))?;
    PublicKey::from_base64(&req.public_key)
        .map_err(|_| ApiError::BadRequest("invalid_public_key"))?;
    SealedKey::parse(&req.personal_vault.encrypted_vault_key)
        .map_err(|_| ApiError::BadRequest("invalid_vault_key"))?;
    if req.wrapped_account_key.encoded_len() > MAX_KEY_BLOB
        || req.encrypted_private_key.encoded_len() > MAX_KEY_BLOB
        || req.personal_vault.encrypted_meta.encoded_len() > MAX_META_LEN
    {
        return Err(ApiError::BadRequest("invalid_key_material"));
    }

    let auth_hash = state.argon(move || hash_auth_key(&auth_key)).await??;

    let user_id = req.user_id;
    let mut tx = state.db.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO users (id, email, kdf_memory_kib, kdf_iterations, kdf_parallelism, kdf_salt,
                            auth_hash, wrapped_account_key, public_key, encrypted_private_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(user_id)
    .bind(&email)
    .bind(req.kdf.memory_kib as i32)
    .bind(req.kdf.iterations as i32)
    .bind(req.kdf.parallelism as i32)
    .bind(&req.salt)
    .bind(&auth_hash)
    .bind(req.wrapped_account_key.to_string())
    .bind(&req.public_key)
    .bind(req.encrypted_private_key.to_string())
    .execute(&mut *tx)
    .await;
    match inserted {
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return Err(ApiError::Conflict("email_taken"));
        }
        other => {
            other?;
        }
    }

    sqlx::query(
        "INSERT INTO vaults (id, personal, encrypted_meta, revision)
         VALUES ($1, true, $2, nextval('revision_seq'))",
    )
    .bind(req.personal_vault.id)
    .bind(req.personal_vault.encrypted_meta.to_string())
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(d) if d.is_unique_violation() => ApiError::Conflict("vault_exists"),
        e => e.into(),
    })?;
    sqlx::query(
        "INSERT INTO vault_members (vault_id, user_id, role, encrypted_vault_key, key_version)
         VALUES ($1, $2, 'owner', $3, 1)",
    )
    .bind(req.personal_vault.id)
    .bind(user_id)
    .bind(&req.personal_vault.encrypted_vault_key)
    .execute(&mut *tx)
    .await?;

    if let Some((invite_id, _, vault_id, role)) = invite {
        lock_vault(&mut tx, vault_id).await?;
        let accepted = sqlx::query(
            "UPDATE invites i SET accepted_by = $1, accepted_at = now()
             WHERE i.id = $2 AND i.accepted_by IS NULL AND i.expires_at > now()
               AND EXISTS (SELECT 1 FROM vault_members m
                           WHERE m.vault_id = i.vault_id AND m.user_id = i.created_by
                             AND m.role = 'owner' AND m.encrypted_vault_key IS NOT NULL)",
        )
        .bind(user_id)
        .bind(invite_id)
        .execute(&mut *tx)
        .await?;
        if accepted.rows_affected() != 1 {
            return Err(ApiError::BadRequest("invalid_invite"));
        }
        sqlx::query(
            "INSERT INTO vault_members (vault_id, user_id, role) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING",
        )
        .bind(vault_id)
        .bind(user_id)
        .bind(role)
        .execute(&mut *tx)
        .await?;
        bump_vault(&mut *tx, vault_id).await?;
    }
    tx.commit().await?;

    tracing::info!(%user_id, "account registered");
    Ok((StatusCode::CREATED, Json(RegisterResponse { user_id })))
}

#[derive(Deserialize)]
pub struct LoginRequest {
    email: String,
    auth_key: String,
    #[serde(default)]
    device: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    token: String,
    expires_in_seconds: i64,
    user_id: Uuid,
    wrapped_account_key: String,
    public_key: String,
    encrypted_private_key: String,
    has_recovery: bool,
}

type UserAuthRow = (Uuid, String, String, String, String, bool);

pub async fn login(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(req): Json<LoginRequest>,
) -> ApiResult<Json<LoginResponse>> {
    let email = normalize_email(&req.email)?;
    let ip_key = ip.map(limiter_key);
    let limiter_key = format!("login:{email}");
    if !state.begin_attempt(&limiter_key, ip_key.as_deref()) {
        return Err(ApiError::TooManyRequests);
    }

    let user: Option<UserAuthRow> = sqlx::query_as(
        "SELECT id, auth_hash, wrapped_account_key, public_key, encrypted_private_key,
                recovery_auth_hash IS NOT NULL
         FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await?;

    let phc = user
        .as_ref()
        .map_or_else(|| state.dummy_hash.clone(), |u| u.1.clone());
    let key = decode_auth_key(&req.auth_key);
    let key_for_check = key.unwrap_or([0u8; 32]);
    let matches = state
        .argon(move || verify_auth_key(&key_for_check, &phc))
        .await?;

    let Some((user_id, _, wrapped_account_key, public_key, encrypted_private_key, has_recovery)) =
        user.filter(|_| matches && key.is_some())
    else {
        tracing::info!("failed login");
        return Err(ApiError::Unauthorized);
    };
    state.attempt_succeeded(&limiter_key, ip_key.as_deref());

    let ttl_hours = state.config.session_ttl_hours;
    let device = crate::sessions::device_label(&req.device);
    let token = create_session(&state, user_id, "full", ttl_hours * 60, &device).await?;

    Ok(Json(LoginResponse {
        token,
        expires_in_seconds: i64::from(ttl_hours) * 3600,
        user_id,
        wrapped_account_key,
        public_key,
        encrypted_private_key,
        has_recovery,
    }))
}

#[derive(Deserialize)]
pub struct InvitePreviewRequest {
    token: String,
}

#[derive(Serialize)]
pub struct InvitePreviewResponse {
    email: String,
    invited_by: String,
}

pub async fn invite_preview(
    State(state): State<AppState>,
    Json(req): Json<InvitePreviewRequest>,
) -> ApiResult<Json<InvitePreviewResponse>> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT i.email, u.email FROM invites i JOIN users u ON u.id = i.created_by
         WHERE i.token_hash = $1 AND i.accepted_by IS NULL AND i.expires_at > now()",
    )
    .bind(token_hash(&req.token))
    .fetch_optional(&state.db)
    .await?;
    let (email, invited_by) = row.ok_or(ApiError::NotFound("invite_not_found"))?;
    Ok(Json(InvitePreviewResponse { email, invited_by }))
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
    pub(crate) token_hash: Vec<u8>,
    pub(crate) session_id: Uuid,
}

pub struct RecoveryUser {
    pub user_id: Uuid,
    pub token_hash: Vec<u8>,
}

async fn session(
    parts: &Parts,
    state: &AppState,
    scope: &str,
) -> Result<(Uuid, Vec<u8>, Uuid), ApiError> {
    let token = parts
        .headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .filter(|t| !t.is_empty() && t.len() <= 128)
        .ok_or(ApiError::Unauthorized)?;
    let hash = token_hash(token);
    let row: Option<(Uuid, Uuid, bool)> = sqlx::query_as(
        "SELECT user_id, id, last_seen_at < now() - interval '5 minutes'
         FROM sessions WHERE token_hash = $1 AND scope = $2 AND expires_at > now()",
    )
    .bind(&hash)
    .bind(scope)
    .fetch_optional(&state.db)
    .await?;
    let (user_id, session_id, stale) = row.ok_or(ApiError::Unauthorized)?;
    if stale {
        sqlx::query("UPDATE sessions SET last_seen_at = now() WHERE id = $1")
            .bind(session_id)
            .execute(&state.db)
            .await?;
    }
    Ok((user_id, hash, session_id))
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let (user_id, token_hash, session_id) = session(parts, state, "full").await?;
        Ok(Self {
            user_id,
            token_hash,
            session_id,
        })
    }
}

impl FromRequestParts<AppState> for RecoveryUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let (user_id, token_hash, _) = session(parts, state, "recovery").await?;
        Ok(Self {
            user_id,
            token_hash,
        })
    }
}

pub(crate) async fn create_session(
    state: &AppState,
    user_id: Uuid,
    scope: &str,
    minutes: i32,
    device: &str,
) -> ApiResult<String> {
    let mut raw = [0u8; 32];
    UnwrapErr(SysRng).fill_bytes(&mut raw);
    let token = URL_SAFE_NO_PAD.encode(raw);
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()")
        .bind(user_id)
        .execute(&state.db)
        .await?;
    sqlx::query(
        "INSERT INTO sessions (token_hash, user_id, scope, expires_at, device)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5)",
    )
    .bind(token_hash(&token))
    .bind(user_id)
    .bind(scope)
    .bind(minutes)
    .bind(device)
    .execute(&state.db)
    .await?;
    sqlx::query(
        "DELETE FROM sessions WHERE token_hash IN (
             SELECT token_hash FROM sessions WHERE user_id = $1 AND scope = $2
             ORDER BY created_at DESC OFFSET $3)",
    )
    .bind(user_id)
    .bind(scope)
    .bind(MAX_SESSIONS)
    .execute(&state.db)
    .await?;
    Ok(token)
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

    #[test]
    fn stored_auth_hashes_still_verify() {
        let phc = "$argon2id$v=19$m=19456,t=2,p=1$Cr4ISRSg7EVLuimSoLPotA$H+nxfnqFI0mcRjaOhdVJJ2WoDtL1gpxOHVZ81k0csi4";
        assert!(verify_auth_key(&[42u8; 32], phc));
        assert!(!verify_auth_key(&[43u8; 32], phc));
    }

    #[test]
    fn stored_session_tokens_and_fake_salts_stay_the_same() {
        assert_eq!(
            hex(&token_hash("session-token")),
            "c101e911469c969171040b50d70543313cf968fdef5bacc780776f8fb399ab36"
        );
        assert_eq!(
            fake_salt(&[b'k'; 32], "nobody@example.com"),
            "ekERi91FYaJeP/10s7BBlA=="
        );
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
