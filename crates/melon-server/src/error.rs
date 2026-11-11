use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("bad request: {0}")]
    BadRequest(&'static str),
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden: {0}")]
    Forbidden(&'static str),
    #[error("conflict: {0}")]
    Conflict(&'static str),
    #[error("too many requests")]
    TooManyRequests,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        Self::Internal(e.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            Self::BadRequest(c) => (StatusCode::BAD_REQUEST, *c),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::Forbidden(c) => (StatusCode::FORBIDDEN, *c),
            Self::Conflict(c) => (StatusCode::CONFLICT, *c),
            Self::TooManyRequests => (StatusCode::TOO_MANY_REQUESTS, "too_many_requests"),
            Self::Internal(e) => {
                tracing::error!(error = ?e, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal")
            }
        };
        (status, Json(json!({ "error": code }))).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
