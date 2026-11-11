use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use http_body_util::BodyExt;
use melon_crypto::{
    EncString, KdfParams, SymmetricKey, derive_master_key, generate_salt, item_aad,
    unwrap_vault_key, wrap_vault_key,
};
use melon_server::{AppState, Config, MIGRATOR, router};
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

async fn app(allow_registration: bool) -> Option<Router> {
    let Ok(url) = std::env::var("MELON_TEST_DATABASE_URL") else {
        assert!(
            std::env::var("MELON_REQUIRE_DB").is_err(),
            "MELON_REQUIRE_DB is set but MELON_TEST_DATABASE_URL is missing"
        );
        eprintln!("skipping: MELON_TEST_DATABASE_URL not set");
        return None;
    };
    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .unwrap();
    MIGRATOR.run(&db).await.unwrap();
    let config = Config {
        database_url: url,
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        server_secret: b"test-secret-test-secret-test-secret!".to_vec(),
        allow_registration,
        session_ttl_hours: 1,
        cors_origins: vec![],
    };
    Some(router(AppState::new(db, config).unwrap()))
}

async fn call(
    app: &Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(t) = token {
        req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = match body {
        Some(b) => req
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(b.to_string())),
        None => req.body(Body::empty()),
    }
    .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

struct TestClient {
    email: String,
    password: String,
    vault_key: SymmetricKey,
}

impl TestClient {
    fn new() -> Self {
        Self {
            email: format!("{}@example.com", Uuid::new_v4()),
            password: "korrekt-pferd-batterie-heftklammer".into(),
            vault_key: SymmetricKey::generate(),
        }
    }

    async fn register(&self, app: &Router) -> StatusCode {
        let salt = generate_salt();
        let kdf = KdfParams::minimum();
        let mk = derive_master_key(&self.password, &salt, &kdf).unwrap();
        let body = json!({
            "email": self.email,
            "kdf": kdf,
            "salt": STANDARD.encode(salt),
            "auth_key": mk.auth_key().to_base64(),
            "wrapped_vault_key": wrap_vault_key(&mk.wrapping_key(), &self.vault_key),
        });
        call(app, "POST", "/api/v1/auth/register", None, Some(body))
            .await
            .0
    }

    async fn login_with(
        &self,
        app: &Router,
        password: &str,
    ) -> (StatusCode, Option<(String, SymmetricKey)>) {
        let (s, pre) = call(
            app,
            "POST",
            "/api/v1/auth/prelogin",
            None,
            Some(json!({ "email": self.email })),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        let kdf: KdfParams = serde_json::from_value(pre["kdf"].clone()).unwrap();
        let salt = STANDARD.decode(pre["salt"].as_str().unwrap()).unwrap();
        let mk = derive_master_key(password, &salt, &kdf).unwrap();

        let (s, resp) = call(
            app,
            "POST",
            "/api/v1/auth/login",
            None,
            Some(json!({ "email": self.email, "auth_key": mk.auth_key().to_base64() })),
        )
        .await;
        if s != StatusCode::OK {
            return (s, None);
        }
        let wrapped = EncString::parse(resp["wrapped_vault_key"].as_str().unwrap()).unwrap();
        let vault_key = unwrap_vault_key(&mk.wrapping_key(), &wrapped).unwrap();
        (
            s,
            Some((resp["token"].as_str().unwrap().to_owned(), vault_key)),
        )
    }

    async fn login(&self, app: &Router) -> (String, SymmetricKey) {
        self.login_with(app, &self.password.clone())
            .await
            .1
            .expect("login failed")
    }
}

#[tokio::test]
async fn full_vault_flow() {
    let Some(app) = app(true).await else { return };
    let client = TestClient::new();
    assert_eq!(client.register(&app).await, StatusCode::CREATED);
    assert_eq!(client.register(&app).await, StatusCode::CONFLICT);

    let (token, vault_key) = client.login(&app).await;
    assert_eq!(vault_key.as_bytes(), client.vault_key.as_bytes());

    let id = Uuid::new_v4();
    let secret = br#"{"title":"GitHub","username":"melone","password":"s3cr3t"}"#;
    let enc = vault_key.encrypt(secret, &item_aad("passwords", &id.to_string()));
    let uri = format!("/api/v1/vault/items/{id}");
    let (s, r) = call(
        &app,
        "PUT",
        &uri,
        Some(&token),
        Some(json!({ "module": "passwords", "data": enc, "base_revision": null })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let rev1 = r["revision"].as_i64().unwrap();

    let (s, _) = call(
        &app,
        "PUT",
        &uri,
        Some(&token),
        Some(json!({ "module": "passwords", "data": enc, "base_revision": null })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    let (s, sync) = call(
        &app,
        "GET",
        "/api/v1/vault/items?since=0",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let items = sync["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    let data = EncString::parse(items[0]["data"].as_str().unwrap()).unwrap();
    let plain = vault_key
        .decrypt(&data, &item_aad("passwords", &id.to_string()))
        .unwrap();
    assert_eq!(plain.as_slice(), secret);

    assert!(!sync.to_string().contains("s3cr3t"));

    let enc2 = vault_key.encrypt(b"{}", &item_aad("passwords", &id.to_string()));
    let (s, r) = call(
        &app,
        "PUT",
        &uri,
        Some(&token),
        Some(json!({ "module": "passwords", "data": enc2, "base_revision": rev1 })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let rev2 = r["revision"].as_i64().unwrap();
    assert!(rev2 > rev1);
    let (s, _) = call(
        &app,
        "PUT",
        &uri,
        Some(&token),
        Some(json!({ "module": "passwords", "data": enc2, "base_revision": rev1 })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    let (s, _) = call(
        &app,
        "DELETE",
        &format!("{uri}?base_revision={rev2}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (_, sync) = call(
        &app,
        "GET",
        &format!("/api/v1/vault/items?since={rev2}"),
        Some(&token),
        None,
    )
    .await;
    let items = sync["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["deleted"], true);
    assert!(items[0]["data"].is_null());

    let (s, _) = call(&app, "POST", "/api/v1/auth/logout", Some(&token), None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = call(&app, "GET", "/api/v1/vault/items", Some(&token), None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn users_are_isolated() {
    let Some(app) = app(true).await else { return };
    let alice = TestClient::new();
    let bob = TestClient::new();
    alice.register(&app).await;
    bob.register(&app).await;
    let (alice_token, alice_key) = alice.login(&app).await;
    let (bob_token, _) = bob.login(&app).await;

    let id = Uuid::new_v4();
    let enc = alice_key.encrypt(b"alice", &item_aad("notes", &id.to_string()));
    let uri = format!("/api/v1/vault/items/{id}");
    let (s, r) = call(
        &app,
        "PUT",
        &uri,
        Some(&alice_token),
        Some(json!({ "module": "notes", "data": enc, "base_revision": null })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let rev = r["revision"].as_i64().unwrap();

    let (_, sync) = call(
        &app,
        "GET",
        "/api/v1/vault/items?since=0",
        Some(&bob_token),
        None,
    )
    .await;
    assert!(sync["items"].as_array().unwrap().is_empty());
    let (s, _) = call(
        &app,
        "DELETE",
        &format!("{uri}?base_revision={rev}"),
        Some(&bob_token),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = call(
        &app,
        "PUT",
        &uri,
        Some(&bob_token),
        Some(json!({ "module": "notes", "data": enc, "base_revision": rev })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn wrong_password_and_lockout() {
    let Some(app) = app(true).await else { return };
    let client = TestClient::new();
    client.register(&app).await;
    for _ in 0..10 {
        let (s, _) = client.login_with(&app, "falsch").await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }
    let (s, _) = client.login_with(&app, &client.password.clone()).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn prelogin_does_not_reveal_accounts() {
    let Some(app) = app(true).await else { return };
    let body = json!({ "email": "nobody-here@example.com" });
    let (s1, a) = call(
        &app,
        "POST",
        "/api/v1/auth/prelogin",
        None,
        Some(body.clone()),
    )
    .await;
    let (s2, b) = call(&app, "POST", "/api/v1/auth/prelogin", None, Some(body)).await;
    assert_eq!((s1, s2), (StatusCode::OK, StatusCode::OK));
    assert_eq!(a, b, "fake salt must be stable");
    assert_eq!(
        STANDARD.decode(a["salt"].as_str().unwrap()).unwrap().len(),
        16
    );
}

#[tokio::test]
async fn registration_can_be_disabled_and_auth_is_required() {
    let Some(app) = app(false).await else { return };
    assert_eq!(
        TestClient::new().register(&app).await,
        StatusCode::FORBIDDEN
    );
    let (s, _) = call(&app, "GET", "/api/v1/vault/items", None, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = call(
        &app,
        "GET",
        "/api/v1/vault/items",
        Some("made-up-token"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn security_headers_are_set() {
    let Some(app) = app(false).await else { return };
    let resp = app
        .oneshot(Request::get("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let h = resp.headers();
    assert_eq!(h["cache-control"], "no-store");
    assert_eq!(h["x-content-type-options"], "nosniff");
    assert_eq!(h["x-frame-options"], "DENY");
}
