pub mod auth;
pub mod config;
pub mod error;
pub mod state;
pub mod vault;

use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderName, HeaderValue, Method, header},
    routing::{get, post, put},
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

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/auth/prelogin", post(auth::prelogin))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/vault/items", get(vault::list))
        .route("/vault/items/{id}", put(vault::put).delete(vault::delete));

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
