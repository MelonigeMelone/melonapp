pub mod access;
pub mod account;
pub mod auth;
pub mod client_ip;
pub mod config;
pub mod error;
pub mod members;
pub mod sessions;
pub mod state;
pub mod vaults;

use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderName, HeaderValue, Method, header},
    routing::{delete, get, post, put},
};
use sqlx::migrate::Migrator;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

pub use config::Config;
pub use state::AppState;

pub static MIGRATOR: Migrator = sqlx::migrate!();

const BODY_LIMIT: usize = 1024 * 1024;
const ROTATE_BODY_LIMIT: usize = 32 * 1024 * 1024;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/auth/prelogin", post(auth::prelogin))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/invites/preview", post(auth::invite_preview))
        .route("/auth/recover/start", post(account::recover_start))
        .route("/auth/recover/complete", post(account::recover_complete))
        .route(
            "/sessions",
            get(sessions::list_sessions).delete(sessions::revoke_other_sessions),
        )
        .route("/sessions/{session_id}", delete(sessions::revoke_session))
        .route("/account/password", put(account::change_password))
        .route("/account/recovery", put(account::set_recovery))
        .route("/users/lookup", get(members::lookup_user))
        .route(
            "/vaults",
            get(vaults::list_vaults).post(vaults::create_vault),
        )
        .route(
            "/vaults/{vault_id}",
            put(vaults::update_vault).delete(vaults::delete_vault),
        )
        .route("/vaults/{vault_id}/items", get(vaults::list_items))
        .route(
            "/vaults/{vault_id}/items/{item_id}",
            put(vaults::put_item).delete(vaults::delete_item),
        )
        .route("/vaults/{vault_id}/members", post(members::add_member))
        .route(
            "/vaults/{vault_id}/members/{user_id}",
            put(members::change_role).delete(members::remove_member),
        )
        .route(
            "/vaults/{vault_id}/members/{user_id}/key",
            put(members::grant_key),
        )
        .route(
            "/vaults/{vault_id}/rotate",
            post(members::rotate).layer(DefaultBodyLimit::max(ROTATE_BODY_LIMIT)),
        )
        .route(
            "/vaults/{vault_id}/invites",
            get(members::list_invites).post(members::create_invite),
        )
        .route(
            "/vaults/{vault_id}/invites/{invite_id}",
            delete(members::delete_invite),
        );

    let origins: Vec<HeaderValue> = state
        .config
        .cors_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    let security_headers = [
        (header::CACHE_CONTROL, "no-store"),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        (header::X_FRAME_OPTIONS, "DENY"),
        (header::REFERRER_POLICY, "no-referrer"),
        (
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; frame-ancestors 'none'",
        ),
        (
            HeaderName::from_static("cross-origin-resource-policy"),
            "same-origin",
        ),
    ];

    let mut app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest("/api/v1", api)
        .layer(DefaultBodyLimit::max(BODY_LIMIT));
    for (name, value) in security_headers {
        app = app.layer(SetResponseHeaderLayer::overriding(
            name,
            HeaderValue::from_static(value),
        ));
    }
    app.layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
