use std::collections::HashMap;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use http_body_util::BodyExt;
use melon_crypto::{
    EncString, KdfParams, KeyPair, PublicKey, RecoveryKey, SealedKey, SymmetricKey,
    VaultKeyContext, derive_master_key, generate_salt, item_aad, seal_vault_key,
    unwrap_account_key, vault_meta_aad, wrap_account_key,
};
use melon_server::{AppState, Config, MIGRATOR, router};
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

async fn app(allow_registration: bool) -> Option<Router> {
    app_with(allow_registration, false).await
}

async fn app_with(allow_registration: bool, trust_proxy: bool) -> Option<Router> {
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
        trust_proxy,
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn ctx<'a>(vault: &'a str, user: &'a str, version: u32) -> VaultKeyContext<'a> {
    VaultKeyContext {
        vault_id: vault,
        user_id: user,
        key_version: version,
    }
}

struct Person {
    id: String,
    email: String,
    password: String,
    keys: KeyPair,
    account_key: SymmetricKey,
    personal_vault: String,
    token: String,
}

impl Person {
    fn new(name: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            email: format!("{name}-{}@example.com", Uuid::new_v4()),
            password: "korrekt-pferd-batterie-heftklammer".into(),
            keys: KeyPair::generate(),
            account_key: SymmetricKey::generate(),
            personal_vault: Uuid::new_v4().to_string(),
            token: String::new(),
        }
    }

    async fn register(&self, app: &Router, invite: Option<&str>) -> StatusCode {
        self.register_with_key(app, invite, &self.keys.public_key().to_base64())
            .await
    }

    async fn register_with_key(
        &self,
        app: &Router,
        invite: Option<&str>,
        public_key: &str,
    ) -> StatusCode {
        let salt = generate_salt();
        let kdf = KdfParams::minimum();
        let mk = derive_master_key(&self.password, &salt, &kdf).unwrap();
        let account_key = &self.account_key;
        let vault_key = SymmetricKey::generate();
        let pv = &self.personal_vault;
        let body = json!({
            "user_id": self.id,
            "email": self.email,
            "kdf": kdf,
            "salt": STANDARD.encode(salt),
            "auth_key": mk.auth_key().to_base64(),
            "wrapped_account_key": wrap_account_key(&mk.wrapping_key(), account_key),
            "public_key": public_key,
            "encrypted_private_key": self.keys.seal_with(account_key),
            "personal_vault": {
                "id": pv,
                "encrypted_meta": vault_key.encrypt(br#"{"name":"Privat"}"#, &vault_meta_aad(pv, 1)),
                "encrypted_vault_key": seal_vault_key(&self.keys, self.keys.public_key(), &vault_key, &ctx(pv, &self.id, 1)).unwrap().to_string(),
            },
            "invite_token": invite,
        });
        call(app, "POST", "/api/v1/auth/register", None, Some(body))
            .await
            .0
    }

    async fn login_with(&self, app: &Router, password: &str) -> (StatusCode, Value) {
        let (_, pre) = call(
            app,
            "POST",
            "/api/v1/auth/prelogin",
            None,
            Some(json!({ "email": self.email })),
        )
        .await;
        let kdf: KdfParams = serde_json::from_value(pre["kdf"].clone()).unwrap();
        let salt = STANDARD.decode(pre["salt"].as_str().unwrap()).unwrap();
        let mk = derive_master_key(password, &salt, &kdf).unwrap();
        let (s, mut resp) = call(
            app,
            "POST",
            "/api/v1/auth/login",
            None,
            Some(json!({ "email": self.email, "auth_key": mk.auth_key().to_base64(), "device": " Testgerät
" })),
        )
        .await;
        if s == StatusCode::OK {
            let account_key = unwrap_account_key(
                &mk.wrapping_key(),
                &EncString::parse(resp["wrapped_account_key"].as_str().unwrap()).unwrap(),
            )
            .unwrap();
            let reopened = KeyPair::open_with(
                &account_key,
                &EncString::parse(resp["encrypted_private_key"].as_str().unwrap()).unwrap(),
            )
            .unwrap();
            resp["key_matches"] = json!(reopened.public_key() == self.keys.public_key());
        }
        (s, resp)
    }

    async fn login(&mut self, app: &Router) {
        let (s, resp) = self.login_with(app, &self.password.clone()).await;
        assert_eq!(s, StatusCode::OK, "{resp}");
        assert_eq!(
            resp["key_matches"], true,
            "private key survives the round trip"
        );
        self.token = resp["token"].as_str().unwrap().to_owned();
    }

    async fn get(&self, app: &Router, uri: &str) -> (StatusCode, Value) {
        call(app, "GET", uri, Some(&self.token), None).await
    }

    async fn send(
        &self,
        app: &Router,
        method: &str,
        uri: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        call(app, method, uri, Some(&self.token), Some(body)).await
    }

    async fn vault(&self, app: &Router, id: &str) -> Option<Value> {
        let (s, list) = self.get(app, "/api/v1/vaults").await;
        assert_eq!(s, StatusCode::OK);
        list["vaults"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == id)
            .cloned()
    }

    async fn vault_key(&self, app: &Router, id: &str) -> SymmetricKey {
        let v = self.vault(app, id).await.expect("vault visible");
        let version = v["member_key_version"].as_u64().unwrap() as u32;
        let sealed = SealedKey::parse(v["encrypted_vault_key"].as_str().unwrap()).unwrap();
        let senders: Vec<PublicKey> = v["members"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| PublicKey::from_base64(m["public_key"].as_str().unwrap()).unwrap())
            .collect();
        self.keys
            .open_vault_key(&sealed, &ctx(id, &self.id, version), &senders)
            .unwrap()
            .0
    }
}

async fn create_shared_vault(app: &Router, owner: &Person) -> (String, SymmetricKey) {
    let id = Uuid::new_v4().to_string();
    let key = SymmetricKey::generate();
    let (s, _) = owner
        .send(
            app,
            "POST",
            "/api/v1/vaults",
            json!({
                "id": id,
                "encrypted_meta": key.encrypt(br#"{"name":"Familie"}"#, &vault_meta_aad(&id, 1)),
                "encrypted_vault_key": seal_vault_key(&owner.keys, owner.keys.public_key(), &key, &ctx(&id, &owner.id, 1)).unwrap().to_string(),
            }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED);
    (id, key)
}

async fn add_member(
    app: &Router,
    owner: &Person,
    vault: &str,
    key: &SymmetricKey,
    member: &Person,
    role: &str,
) -> StatusCode {
    let (s, found) = owner
        .get(app, &format!("/api/v1/users/lookup?email={}", member.email))
        .await;
    if s != StatusCode::OK {
        return s;
    }
    let public = PublicKey::from_base64(found["public_key"].as_str().unwrap()).unwrap();
    let s = offer(app, owner, vault, key, &member.id, &public, role).await;
    if s == StatusCode::CREATED && !member.token.is_empty() {
        let (accepted, _) = member
            .send(
                app,
                "POST",
                &format!("/api/v1/vaults/{vault}/accept"),
                json!({}),
            )
            .await;
        assert_eq!(accepted, StatusCode::NO_CONTENT);
    }
    s
}

async fn offer(
    app: &Router,
    owner: &Person,
    vault: &str,
    key: &SymmetricKey,
    member_id: &str,
    public: &PublicKey,
    role: &str,
) -> StatusCode {
    owner
        .send(
            app,
            "POST",
            &format!("/api/v1/vaults/{vault}/members"),
            json!({
                "user_id": member_id,
                "role": role,
                "encrypted_vault_key": seal_vault_key(&owner.keys, public, key, &ctx(vault, member_id, 1)).unwrap().to_string(),
                "key_version": 1,
            }),
        )
        .await
        .0
}

async fn put_item(
    app: &Router,
    who: &Person,
    (vault, key, version): (&str, &SymmetricKey, u32),
    item: &str,
    plaintext: &[u8],
    base: Value,
) -> (StatusCode, Value) {
    who.send(
        app,
        "PUT",
        &format!("/api/v1/vaults/{vault}/items/{item}"),
        json!({
            "data": key.encrypt(plaintext, &item_aad(vault, item, version)),
            "key_version": version,
            "base_revision": base,
        }),
    )
    .await
}

#[tokio::test]
async fn registration_refuses_public_keys_nobody_can_encrypt_for() {
    let Some(app) = app(true).await else { return };
    let eve = Person::new("eve");
    let mut one = [0u8; 32];
    one[0] = 1;
    for weak in [[0u8; 32], one] {
        assert_eq!(
            eve.register_with_key(&app, None, &STANDARD.encode(weak))
                .await,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(eve.register(&app, None).await, StatusCode::CREATED);
}

#[tokio::test]
async fn personal_vault_flow() {
    let Some(app) = app(true).await else { return };
    let mut alice = Person::new("alice");
    assert_eq!(alice.register(&app, None).await, StatusCode::CREATED);
    assert_eq!(alice.register(&app, None).await, StatusCode::CONFLICT);
    alice.login(&app).await;

    let vault = alice.personal_vault.clone();
    let v = alice.vault(&app, &vault).await.unwrap();
    assert_eq!(v["personal"], true);
    assert_eq!(v["role"], "owner");
    let key = alice.vault_key(&app, &vault).await;
    let meta = EncString::parse(v["encrypted_meta"].as_str().unwrap()).unwrap();
    assert_eq!(
        key.decrypt(&meta, &vault_meta_aad(&vault, 1))
            .unwrap()
            .as_slice(),
        r#"{"name":"Privat"}"#.as_bytes()
    );

    let item = Uuid::new_v4().to_string();
    let secret = br#"{"type":"login","title":"GitHub","password":"s3cr3t"}"#;
    let (s, r) = put_item(&app, &alice, (&vault, &key, 1), &item, secret, Value::Null).await;
    assert_eq!(s, StatusCode::OK);
    let rev1 = r["revision"].clone();
    let (s, _) = put_item(&app, &alice, (&vault, &key, 1), &item, secret, Value::Null).await;
    assert_eq!(s, StatusCode::CONFLICT);

    let (_, page) = alice
        .get(&app, &format!("/api/v1/vaults/{vault}/items?since=0"))
        .await;
    assert!(!page.to_string().contains("s3cr3t"));
    let data = EncString::parse(page["items"][0]["data"].as_str().unwrap()).unwrap();
    assert_eq!(
        key.decrypt(&data, &item_aad(&vault, &item, 1))
            .unwrap()
            .as_slice(),
        secret
    );
    assert!(
        key.decrypt(&data, &item_aad(&vault, &Uuid::new_v4().to_string(), 1))
            .is_err()
    );

    let (s, r) = put_item(&app, &alice, (&vault, &key, 1), &item, b"{}", rev1.clone()).await;
    assert_eq!(s, StatusCode::OK);
    let rev2 = r["revision"].as_i64().unwrap();
    let (s, _) = put_item(&app, &alice, (&vault, &key, 1), &item, b"{}", rev1).await;
    assert_eq!(s, StatusCode::CONFLICT);

    let (s, _) = call(
        &app,
        "DELETE",
        &format!("/api/v1/vaults/{vault}/items/{item}?base_revision={rev2}"),
        Some(&alice.token),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (_, page) = alice
        .get(&app, &format!("/api/v1/vaults/{vault}/items?since={rev2}"))
        .await;
    assert_eq!(page["items"][0]["deleted"], true);

    let (s, _) = alice
        .send(
            &app,
            "DELETE",
            &format!("/api/v1/vaults/{vault}"),
            json!({}),
        )
        .await;
    assert_eq!(
        s,
        StatusCode::BAD_REQUEST,
        "personal vault cannot be deleted"
    );

    let (s, _) = call(
        &app,
        "POST",
        "/api/v1/auth/logout",
        Some(&alice.token),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = alice.get(&app, "/api/v1/vaults").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn sharing_respects_roles_and_isolation() {
    let Some(app) = app(true).await else { return };
    let (mut alice, mut bob, mut vic) =
        (Person::new("alice"), Person::new("bob"), Person::new("vic"));
    for p in [&alice, &bob, &vic] {
        p.register(&app, None).await;
    }
    alice.login(&app).await;
    bob.login(&app).await;
    vic.login(&app).await;

    let (vault, key) = create_shared_vault(&app, &alice).await;
    let item = Uuid::new_v4().to_string();
    put_item(
        &app,
        &alice,
        (&vault, &key, 1),
        &item,
        b"wlan-passwort",
        Value::Null,
    )
    .await;

    assert_eq!(bob.vault(&app, &vault).await, None, "not shared yet");
    let (s, _) = bob
        .get(&app, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    assert_eq!(
        add_member(&app, &alice, &vault, &key, &bob, "editor").await,
        StatusCode::CREATED
    );
    assert_eq!(
        add_member(&app, &alice, &vault, &key, &vic, "viewer").await,
        StatusCode::CREATED
    );
    assert_eq!(
        add_member(&app, &alice, &vault, &key, &bob, "editor").await,
        StatusCode::CONFLICT
    );

    let bob_key = bob.vault_key(&app, &vault).await;
    assert_eq!(bob_key.as_bytes(), key.as_bytes());
    let (_, page) = bob
        .get(&app, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    let data = EncString::parse(page["items"][0]["data"].as_str().unwrap()).unwrap();
    assert_eq!(
        bob_key
            .decrypt(&data, &item_aad(&vault, &item, 1))
            .unwrap()
            .as_slice(),
        b"wlan-passwort"
    );

    let (s, _) = put_item(
        &app,
        &bob,
        (&vault, &bob_key, 1),
        &Uuid::new_v4().to_string(),
        b"von bob",
        Value::Null,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "editor can write");

    let vic_key = vic.vault_key(&app, &vault).await;
    let (s, r) = put_item(
        &app,
        &vic,
        (&vault, &vic_key, 1),
        &Uuid::new_v4().to_string(),
        b"x",
        Value::Null,
    )
    .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::FORBIDDEN, Some("read_only"))
    );

    let mut eve = Person::new("eve");
    eve.register(&app, None).await;
    eve.login(&app).await;
    assert_eq!(
        add_member(&app, &bob, &vault, &key, &eve, "viewer").await,
        StatusCode::FORBIDDEN,
        "editors cannot add members"
    );
    let (s, _) = bob
        .send(
            &app,
            "PUT",
            &format!("/api/v1/vaults/{vault}/members/{}", vic.id),
            json!({ "role": "owner" }),
        )
        .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "editors cannot change roles");
    let (s, _) = eve
        .get(&app, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "outsiders see nothing");

    let (s, _) = bob
        .get(
            &app,
            &format!("/api/v1/vaults/{}/items", alice.personal_vault),
        )
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "personal vaults stay private");
    let pv = alice.personal_vault.clone();
    let (s, _) = alice.send(&app, "POST", &format!("/api/v1/vaults/{pv}/members"), json!({
        "user_id": eve.id,
        "role": "viewer",
        "encrypted_vault_key": seal_vault_key(&alice.keys, eve.keys.public_key(), &key, &ctx(&pv, &eve.id, 1)).unwrap().to_string(),
        "key_version": 1,
    })).await;
    assert_eq!(
        s,
        StatusCode::BAD_REQUEST,
        "personal vaults cannot be shared"
    );

    let members = alice.vault(&app, &vault).await.unwrap()["members"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(members, 3);
}

#[tokio::test]
async fn invite_link_registration_and_key_grant() {
    let Some(closed) = app(false).await else {
        return;
    };
    let Some(open) = app(true).await else { return };
    let mut alice = Person::new("alice");
    alice.register(&open, None).await;
    alice.login(&closed).await;
    let (vault, key) = create_shared_vault(&closed, &alice).await;
    put_item(
        &closed,
        &alice,
        (&vault, &key, 1),
        &Uuid::new_v4().to_string(),
        b"geteilt",
        Value::Null,
    )
    .await;

    let mut carol = Person::new("carol");
    assert_eq!(
        carol.register(&closed, None).await,
        StatusCode::FORBIDDEN,
        "registration closed"
    );

    let (s, inv) = alice
        .send(
            &closed,
            "POST",
            &format!("/api/v1/vaults/{vault}/invites"),
            json!({ "email": carol.email, "role": "editor" }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED);
    let token = inv["token"].as_str().unwrap().to_owned();
    let (_, list) = alice
        .get(&closed, &format!("/api/v1/vaults/{vault}/invites"))
        .await;
    assert_eq!(list["invites"].as_array().unwrap().len(), 1);

    let (s, preview) = call(
        &closed,
        "POST",
        "/api/v1/auth/invites/preview",
        None,
        Some(json!({ "token": token })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(preview["email"], carol.email.as_str());
    assert_eq!(preview["invited_by"], alice.email.as_str());

    let mut mallory = Person::new("mallory");
    assert_eq!(
        mallory.register(&closed, Some(&token)).await,
        StatusCode::BAD_REQUEST,
        "invite is bound to the e-mail"
    );
    assert_eq!(
        carol.register(&closed, Some("wrong-token")).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        carol.register(&closed, Some(&token)).await,
        StatusCode::CREATED
    );
    mallory.email = format!("other-{}", carol.email);
    assert_eq!(
        mallory.register(&closed, Some(&token)).await,
        StatusCode::BAD_REQUEST,
        "invite is single use"
    );

    carol.login(&closed).await;
    let pending = carol.vault(&closed, &vault).await.unwrap();
    assert_eq!(pending["encrypted_vault_key"], Value::Null);
    let (s, r) = carol
        .get(&closed, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::FORBIDDEN, Some("vault_key_pending"))
    );

    let v = alice.vault(&closed, &vault).await.unwrap();
    let carol_entry = v["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["email"] == carol.email.as_str())
        .unwrap()
        .clone();
    assert_eq!(carol_entry["has_key"], false);
    let carol_pub = PublicKey::from_base64(carol_entry["public_key"].as_str().unwrap()).unwrap();
    let (s, _) = alice.send(&closed, "PUT", &format!("/api/v1/vaults/{vault}/members/{}/key", carol.id), json!({
        "encrypted_vault_key": seal_vault_key(&alice.keys, &carol_pub, &key, &ctx(&vault, &carol.id, 1)).unwrap().to_string(),
        "key_version": 1,
    })).await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    assert_eq!(
        carol.vault_key(&closed, &vault).await.as_bytes(),
        key.as_bytes()
    );
    let (s, _) = carol
        .get(&closed, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = alice
        .send(
            &closed,
            "POST",
            &format!("/api/v1/vaults/{vault}/invites"),
            json!({ "email": carol.email, "role": "viewer" }),
        )
        .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "existing users are added directly, not invited"
    );
}

#[tokio::test]
async fn personal_vault_can_get_a_new_key_but_never_loses_its_owner() {
    let Some(app) = app(true).await else { return };
    let mut alice = Person::new("alice");
    alice.register(&app, None).await;
    alice.login(&app).await;
    let vault = alice.personal_vault.clone();
    let key = alice.vault_key(&app, &vault).await;
    let item = Uuid::new_v4().to_string();
    let (_, r) = put_item(&app, &alice, (&vault, &key, 1), &item, b"alt", Value::Null).await;
    let new_key = SymmetricKey::generate();
    let body = |remove: Value| {
        json!({
            "key_version": 2,
            "encrypted_meta": new_key.encrypt(br#"{"name":"Privat"}"#, &vault_meta_aad(&vault, 2)),
            "members": [{
                "user_id": alice.id,
                "encrypted_vault_key": seal_vault_key(&alice.keys, alice.keys.public_key(), &new_key, &ctx(&vault, &alice.id, 2)).unwrap().to_string(),
            }],
            "items": [{ "id": item, "data": new_key.encrypt(b"neu", &item_aad(&vault, &item, 2)), "base_revision": r["revision"] }],
            "remove_user_ids": remove,
        })
    };
    let uri = format!("/api/v1/vaults/{vault}/rotate");
    let (s, r) = alice
        .send(&app, "POST", &uri, body(json!([alice.id])))
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::BAD_REQUEST, Some("personal_vault"))
    );
    let (s, _) = alice.send(&app, "POST", &uri, body(json!([]))).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let v = alice.vault(&app, &vault).await.unwrap();
    assert_eq!(v["key_version"], 2);
    assert_eq!(v["personal"], true);
    assert_eq!(
        alice.vault_key(&app, &vault).await.as_bytes(),
        new_key.as_bytes()
    );
}

#[tokio::test]
async fn removing_a_member_rotates_the_key() {
    let Some(app) = app(true).await else { return };
    let (mut alice, mut bob, mut dave) = (
        Person::new("alice"),
        Person::new("bob"),
        Person::new("dave"),
    );
    for p in [&alice, &bob, &dave] {
        p.register(&app, None).await;
    }
    alice.login(&app).await;
    bob.login(&app).await;
    dave.login(&app).await;
    let (vault, key) = create_shared_vault(&app, &alice).await;
    let items: Vec<String> = (0..3).map(|_| Uuid::new_v4().to_string()).collect();
    for i in &items {
        put_item(&app, &alice, (&vault, &key, 1), i, b"alt", Value::Null).await;
    }
    add_member(&app, &alice, &vault, &key, &bob, "editor").await;
    add_member(&app, &alice, &vault, &key, &dave, "viewer").await;

    let (s, r) = alice
        .send(
            &app,
            "DELETE",
            &format!("/api/v1/vaults/{vault}/members/{}", bob.id),
            json!({}),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("rotation_required"))
    );

    let new_key = SymmetricKey::generate();
    let seal_for = |p: &Person| {
        json!({
            "user_id": p.id,
            "encrypted_vault_key": seal_vault_key(&alice.keys, p.keys.public_key(), &new_key, &ctx(&vault, &p.id, 2)).unwrap().to_string(),
        })
    };
    let revisions = |page: &Value| -> HashMap<String, i64> {
        page["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|it| {
                (
                    it["id"].as_str().unwrap().to_owned(),
                    it["revision"].as_i64().unwrap(),
                )
            })
            .collect()
    };
    let (_, page) = alice
        .get(&app, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    let mut seen = revisions(&page);
    let rotated_items = |ids: &[String], seen: &HashMap<String, i64>| {
        ids.iter()
            .map(|i| json!({ "id": i, "data": new_key.encrypt(b"neu", &item_aad(&vault, i, 2)), "base_revision": seen[i] }))
            .collect::<Vec<_>>()
    };
    let meta = new_key.encrypt(br#"{"name":"Familie"}"#, &vault_meta_aad(&vault, 2));
    let uri = format!("/api/v1/vaults/{vault}/rotate");

    let (s, _) = put_item(
        &app,
        &bob,
        (&vault, &key, 1),
        &items[0],
        b"gerade bearbeitet",
        json!(seen[&items[0]]),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, r) = alice.send(&app, "POST", &uri, json!({
        "key_version": 2, "encrypted_meta": meta, "members": [seal_for(&alice), seal_for(&dave)],
        "items": rotated_items(&items, &seen), "remove_user_ids": [bob.id],
    })).await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("items_changed")),
        "a concurrent edit must not be overwritten by the rotation"
    );
    let (_, page) = alice
        .get(&app, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    seen = revisions(&page);

    let (s, r) = alice.send(&app, "POST", &uri, json!({
        "key_version": 2, "encrypted_meta": meta, "members": [seal_for(&alice), seal_for(&dave)],
        "items": rotated_items(&items[..2], &seen), "remove_user_ids": [bob.id],
    })).await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("items_changed"))
    );

    let (s, r) = alice
        .send(
            &app,
            "POST",
            &uri,
            json!({
                "key_version": 2, "encrypted_meta": meta, "members": [seal_for(&alice)],
                "items": rotated_items(&items, &seen), "remove_user_ids": [bob.id],
            }),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("members_changed")),
        "dave must not be dropped silently"
    );

    let (s, _) = bob
        .send(
            &app,
            "POST",
            &uri,
            json!({
                "key_version": 2, "encrypted_meta": meta, "members": [seal_for(&bob)],
                "items": rotated_items(&items, &seen), "remove_user_ids": [alice.id],
            }),
        )
        .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "only owners rotate");

    let (s, _) = alice.send(&app, "POST", &uri, json!({
        "key_version": 2, "encrypted_meta": meta, "members": [seal_for(&alice), seal_for(&dave)],
        "items": rotated_items(&items, &seen), "remove_user_ids": [bob.id],
    })).await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    assert_eq!(bob.vault(&app, &vault).await, None);
    let (s, _) = bob
        .get(&app, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "removed member loses access");

    let dave_key = dave.vault_key(&app, &vault).await;
    assert_eq!(dave_key.as_bytes(), new_key.as_bytes());
    let (_, page) = dave
        .get(&app, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    assert_eq!(page["items"].as_array().unwrap().len(), 3);
    for it in page["items"].as_array().unwrap() {
        let id = it["id"].as_str().unwrap();
        assert_eq!(it["key_version"], 2);
        let data = EncString::parse(it["data"].as_str().unwrap()).unwrap();
        assert_eq!(
            dave_key
                .decrypt(&data, &item_aad(&vault, id, 2))
                .unwrap()
                .as_slice(),
            b"neu"
        );
        assert!(
            key.decrypt(&data, &item_aad(&vault, id, 2)).is_err(),
            "old key is useless"
        );
    }

    let (s, r) = put_item(
        &app,
        &alice,
        (&vault, &key, 1),
        &Uuid::new_v4().to_string(),
        b"x",
        Value::Null,
    )
    .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("key_rotated"))
    );
}

async fn test_db() -> sqlx::PgPool {
    PgPoolOptions::new()
        .max_connections(1)
        .connect(&std::env::var("MELON_TEST_DATABASE_URL").unwrap())
        .await
        .unwrap()
}

async fn invite(
    app: &Router,
    by: &Person,
    vault: &str,
    email: &str,
    role: &str,
) -> (StatusCode, String) {
    let (s, r) = by
        .send(
            app,
            "POST",
            &format!("/api/v1/vaults/{vault}/invites"),
            json!({ "email": email, "role": role }),
        )
        .await;
    (s, r["token"].as_str().unwrap_or_default().to_owned())
}

#[tokio::test]
async fn an_owner_without_the_key_cannot_manage_or_delete_the_vault() {
    let Some(app) = app(true).await else { return };
    let mut alice = Person::new("alice");
    alice.register(&app, None).await;
    alice.login(&app).await;
    let (vault, key) = create_shared_vault(&app, &alice).await;
    let mut carol = Person::new("carol");
    let (_, token) = invite(&app, &alice, &vault, &carol.email, "owner").await;
    assert_eq!(
        carol.register(&app, Some(&token)).await,
        StatusCode::CREATED
    );
    carol.login(&app).await;
    let dave = Person::new("dave");
    let (_, dave_token) = invite(&app, &alice, &vault, &dave.email, "viewer").await;
    assert_eq!(
        dave.register(&app, Some(&dave_token)).await,
        StatusCode::CREATED
    );

    let pending = |r: (StatusCode, Value)| (r.0, r.1["error"].as_str().map(str::to_owned));
    let refused = (StatusCode::FORBIDDEN, Some("vault_key_pending".to_owned()));
    let invites = format!("/api/v1/vaults/{vault}/invites");
    assert_eq!(
        pending(
            carol
                .send(
                    &app,
                    "DELETE",
                    &format!("/api/v1/vaults/{vault}"),
                    json!({})
                )
                .await
        ),
        refused
    );
    assert_eq!(
        pending(
            carol
                .send(
                    &app,
                    "POST",
                    &invites,
                    json!({ "email": "x@example.com", "role": "owner" })
                )
                .await
        ),
        refused
    );
    assert_eq!(pending(carol.get(&app, &invites).await), refused);
    assert_eq!(
        pending(
            carol
                .send(
                    &app,
                    "PUT",
                    &format!("/api/v1/vaults/{vault}/members/{}", alice.id),
                    json!({ "role": "viewer" })
                )
                .await
        ),
        refused
    );
    assert_eq!(
        pending(
            carol
                .send(
                    &app,
                    "DELETE",
                    &format!("/api/v1/vaults/{vault}/members/{}", dave.id),
                    json!({})
                )
                .await
        ),
        refused
    );
    let (_, list) = alice.get(&app, &invites).await;
    let first = list["invites"].as_array().map(Vec::len);
    assert_eq!(
        pending(
            carol
                .send(
                    &app,
                    "DELETE",
                    &format!("{invites}/{}", Uuid::new_v4()),
                    json!({})
                )
                .await
        ),
        refused
    );
    assert!(
        alice.vault(&app, &vault).await.is_some(),
        "vault still exists"
    );
    assert_eq!(
        alice.get(&app, &invites).await.1["invites"]
            .as_array()
            .map(Vec::len),
        first
    );

    let v = alice.vault(&app, &vault).await.unwrap();
    let carol_pub = v["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["user_id"] == carol.id.as_str())
        .unwrap()["public_key"]
        .as_str()
        .unwrap()
        .to_owned();
    let carol_pub = PublicKey::from_base64(&carol_pub).unwrap();
    let (s, _) = alice.send(&app, "PUT", &format!("/api/v1/vaults/{vault}/members/{}/key", carol.id), json!({
        "encrypted_vault_key": seal_vault_key(&alice.keys, &carol_pub, &key, &ctx(&vault, &carol.id, 1)).unwrap().to_string(),
        "key_version": 1,
    })).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(carol.get(&app, &invites).await.0, StatusCode::OK);
}

#[tokio::test]
async fn invites_end_when_their_owner_leaves_is_removed_or_demoted() {
    let Some(app) = app(true).await else { return };
    let (mut alice, mut bob) = (Person::new("alice"), Person::new("bob"));
    alice.register(&app, None).await;
    bob.register(&app, None).await;
    alice.login(&app).await;
    bob.login(&app).await;
    let (vault, key) = create_shared_vault(&app, &alice).await;
    add_member(&app, &alice, &vault, &key, &bob, "owner").await;

    let removed = Person::new("removed");
    let (s, removed_token) = invite(&app, &bob, &vault, &removed.email, "owner").await;
    assert_eq!(s, StatusCode::CREATED);
    let new_key = SymmetricKey::generate();
    let (s, _) = alice.send(&app, "POST", &format!("/api/v1/vaults/{vault}/rotate"), json!({
        "key_version": 2,
        "encrypted_meta": new_key.encrypt(br#"{"name":"Familie"}"#, &vault_meta_aad(&vault, 2)),
        "members": [{ "user_id": alice.id, "encrypted_vault_key": seal_vault_key(&alice.keys, alice.keys.public_key(), &new_key, &ctx(&vault, &alice.id, 2)).unwrap().to_string() }],
        "items": [],
        "remove_user_ids": [bob.id],
    })).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        removed.register(&app, Some(&removed_token)).await,
        StatusCode::BAD_REQUEST,
        "removed owner's invite is gone"
    );

    let (s, _) = alice
        .send(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault}/members"),
            json!({
                "user_id": bob.id,
                "role": "owner",
                "encrypted_vault_key": seal_vault_key(&alice.keys, bob.keys.public_key(), &new_key, &ctx(&vault, &bob.id, 2)).unwrap().to_string(),
                "key_version": 2,
            }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = bob
        .send(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault}/accept"),
            json!({}),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let demoted = Person::new("demoted");
    let (_, demoted_token) = invite(&app, &bob, &vault, &demoted.email, "owner").await;
    let (s, _) = alice
        .send(
            &app,
            "PUT",
            &format!("/api/v1/vaults/{vault}/members/{}", bob.id),
            json!({ "role": "editor" }),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        demoted.register(&app, Some(&demoted_token)).await,
        StatusCode::BAD_REQUEST,
        "demoted owner's invite is gone"
    );

    let (s, _) = alice
        .send(
            &app,
            "PUT",
            &format!("/api/v1/vaults/{vault}/members/{}", bob.id),
            json!({ "role": "owner" }),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let left = Person::new("left");
    let (_, left_token) = invite(&app, &bob, &vault, &left.email, "owner").await;
    let (s, _) = bob
        .send(
            &app,
            "DELETE",
            &format!("/api/v1/vaults/{vault}/members/{}", bob.id),
            json!({}),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        left.register(&app, Some(&left_token)).await,
        StatusCode::BAD_REQUEST,
        "invite of an owner who left is gone"
    );

    let kept = Person::new("kept");
    let (_, kept_token) = invite(&app, &alice, &vault, &kept.email, "viewer").await;
    assert_eq!(
        kept.register(&app, Some(&kept_token)).await,
        StatusCode::CREATED,
        "other owners' invites stay"
    );
}

#[tokio::test]
async fn an_invite_only_counts_while_its_creator_is_an_owner_with_the_key() {
    let Some(app) = app(true).await else { return };
    let (mut alice, mut bob) = (Person::new("alice"), Person::new("bob"));
    alice.register(&app, None).await;
    bob.register(&app, None).await;
    alice.login(&app).await;
    bob.login(&app).await;
    let (vault, key) = create_shared_vault(&app, &alice).await;
    add_member(&app, &alice, &vault, &key, &bob, "owner").await;
    let erin = Person::new("erin");
    let (_, token) = invite(&app, &bob, &vault, &erin.email, "editor").await;
    sqlx::query("UPDATE vault_members SET encrypted_vault_key = NULL WHERE vault_id = $1::uuid AND user_id = $2::uuid")
        .bind(&vault)
        .bind(&bob.id)
        .execute(&test_db().await)
        .await
        .unwrap();
    assert_eq!(
        erin.register(&app, Some(&token)).await,
        StatusCode::BAD_REQUEST
    );
    let (s, r) = alice.get(&app, "/api/v1/vaults").await;
    assert_eq!(s, StatusCode::OK);
    assert!(!r.to_string().contains(&erin.email), "nobody joined");
}

#[tokio::test]
async fn leaving_flags_rotation_and_last_owner_stays() {
    let Some(app) = app(true).await else { return };
    let (mut alice, mut bob) = (Person::new("alice"), Person::new("bob"));
    alice.register(&app, None).await;
    bob.register(&app, None).await;
    alice.login(&app).await;
    bob.login(&app).await;
    let (vault, key) = create_shared_vault(&app, &alice).await;
    add_member(&app, &alice, &vault, &key, &bob, "owner").await;

    let (s, _) = bob
        .send(
            &app,
            "DELETE",
            &format!("/api/v1/vaults/{vault}/members/{}", bob.id),
            json!({}),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        alice.vault(&app, &vault).await.unwrap()["rotation_needed"],
        true
    );

    let (s, r) = alice
        .send(
            &app,
            "DELETE",
            &format!("/api/v1/vaults/{vault}/members/{}", alice.id),
            json!({}),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("last_owner"))
    );
    let (s, r) = alice
        .send(
            &app,
            "PUT",
            &format!("/api/v1/vaults/{vault}/members/{}", alice.id),
            json!({ "role": "viewer" }),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("last_owner"))
    );

    let (s, _) = alice
        .send(
            &app,
            "DELETE",
            &format!("/api/v1/vaults/{vault}"),
            json!({}),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(alice.vault(&app, &vault).await, None);
}

#[tokio::test]
async fn wrong_password_and_lockout() {
    let Some(app) = app(true).await else { return };
    let client = Person::new("lock");
    client.register(&app, None).await;
    for _ in 0..10 {
        assert_eq!(
            client.login_with(&app, "falsch").await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        client.login_with(&app, &client.password.clone()).await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
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
async fn auth_is_required_and_headers_are_set() {
    let Some(app) = app(false).await else { return };
    let (s, _) = call(&app, "GET", "/api/v1/vaults", None, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = call(&app, "GET", "/api/v1/vaults", Some("made-up-token"), None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = call(&app, "GET", "/api/v1/users/lookup?email=a@b.de", None, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "user lookup needs a session");

    let resp = app
        .oneshot(Request::get("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let h = resp.headers();
    assert_eq!(h["cache-control"], "no-store");
    assert_eq!(h["x-content-type-options"], "nosniff");
    assert_eq!(h["x-frame-options"], "DENY");
}

const WRONG_KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

impl Person {
    async fn current_auth_key(&self, app: &Router) -> String {
        let (_, pre) = call(
            app,
            "POST",
            "/api/v1/auth/prelogin",
            None,
            Some(json!({ "email": self.email })),
        )
        .await;
        let salt = STANDARD.decode(pre["salt"].as_str().unwrap()).unwrap();
        derive_master_key(&self.password, &salt, &KdfParams::minimum())
            .unwrap()
            .auth_key()
            .to_base64()
    }

    fn new_credentials(&self, password: &str) -> Value {
        let salt = generate_salt();
        let kdf = KdfParams::minimum();
        let mk = derive_master_key(password, &salt, &kdf).unwrap();
        json!({
            "kdf": kdf,
            "salt": STANDARD.encode(salt),
            "auth_key": mk.auth_key().to_base64(),
            "wrapped_account_key": wrap_account_key(&mk.wrapping_key(), &self.account_key),
        })
    }
}

#[tokio::test]
async fn changing_the_master_password() {
    let Some(app) = app(true).await else { return };
    let mut alice = Person::new("alice");
    alice.register(&app, None).await;
    alice.login(&app).await;
    let other_device = alice.token.clone();
    alice.login(&app).await;
    let vault = alice.personal_vault.clone();
    let key_before = alice.vault_key(&app, &vault).await;

    let mut body = alice.new_credentials("neues-sehr-langes-passwort");
    body["current_auth_key"] = json!(WRONG_KEY);
    let (s, r) = alice
        .send(&app, "PUT", "/api/v1/account/password", body.clone())
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::FORBIDDEN, Some("wrong_password"))
    );

    body["current_auth_key"] = json!(alice.current_auth_key(&app).await);
    let (s, _) = alice
        .send(&app, "PUT", "/api/v1/account/password", body)
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    let (s, _) = call(&app, "GET", "/api/v1/vaults", Some(&other_device), None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "other devices are signed out");
    let (s, _) = alice.get(&app, "/api/v1/vaults").await;
    assert_eq!(s, StatusCode::OK, "the current session stays");

    assert_eq!(
        alice.login_with(&app, &alice.password.clone()).await.0,
        StatusCode::UNAUTHORIZED
    );
    alice.password = "neues-sehr-langes-passwort".into();
    alice.login(&app).await;
    let key_after = alice.vault_key(&app, &vault).await;
    assert_eq!(
        key_before.as_bytes(),
        key_after.as_bytes(),
        "vault keys survive a password change"
    );
}

#[tokio::test]
async fn recovering_with_the_recovery_key() {
    let Some(app) = app(true).await else { return };
    let mut alice = Person::new("alice");
    alice.register(&app, None).await;
    alice.login(&app).await;
    let vault = alice.personal_vault.clone();
    let key = alice.vault_key(&app, &vault).await;
    let item = Uuid::new_v4().to_string();
    put_item(
        &app,
        &alice,
        (&vault, &key, 1),
        &item,
        b"vor dem vergessen",
        Value::Null,
    )
    .await;

    let start = |email: &str, recovery: &RecoveryKey| json!({ "email": email, "recovery_auth_key": recovery.auth_key().to_base64() });
    let recovery = RecoveryKey::generate();
    let (s, _) = call(
        &app,
        "POST",
        "/api/v1/auth/recover/start",
        None,
        Some(start(&alice.email, &recovery)),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "no recovery key set yet");

    let setup = |current: String| {
        json!({
            "current_auth_key": current,
            "recovery_auth_key": recovery.auth_key().to_base64(),
            "recovery_wrapped_account_key": recovery.wrap_account_key(&alice.account_key),
        })
    };
    let (s, r) = alice
        .send(
            &app,
            "PUT",
            "/api/v1/account/recovery",
            setup(WRONG_KEY.into()),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::FORBIDDEN, Some("wrong_password"))
    );
    let current = alice.current_auth_key(&app).await;
    let (s, _) = alice
        .send(&app, "PUT", "/api/v1/account/recovery", setup(current))
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, login) = alice.login_with(&app, &alice.password.clone()).await;
    assert_eq!(login["has_recovery"], true);

    let (s, _) = call(
        &app,
        "POST",
        "/api/v1/auth/recover/start",
        None,
        Some(start(&alice.email, &RecoveryKey::generate())),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "wrong recovery key");
    let (s, _) = call(
        &app,
        "POST",
        "/api/v1/auth/recover/start",
        None,
        Some(start("nobody@example.com", &recovery)),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "unknown e-mail looks the same");

    let typed = RecoveryKey::parse(&recovery.display().to_lowercase()).unwrap();
    let (s, started) = call(
        &app,
        "POST",
        "/api/v1/auth/recover/start",
        None,
        Some(start(&alice.email, &typed)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let recovery_token = started["token"].as_str().unwrap().to_owned();
    let (s, _) = call(&app, "GET", "/api/v1/vaults", Some(&recovery_token), None).await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "a recovery session cannot read vaults"
    );
    let (s, _) = call(
        &app,
        "POST",
        "/api/v1/auth/recover/complete",
        Some(&alice.token),
        Some(alice.new_credentials("x-y-z-neu-12345")),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "a normal session cannot use the recovery endpoint"
    );

    let wrapped =
        EncString::parse(started["recovery_wrapped_account_key"].as_str().unwrap()).unwrap();
    assert_eq!(
        typed.unwrap_account_key(&wrapped).unwrap().as_bytes(),
        alice.account_key.as_bytes()
    );

    let first_password = "nach-dem-vergessen-lang-genug";
    let second_password = "gleichzeitig-auch-lang-genug";
    let (first, second) = tokio::join!(
        call(
            &app,
            "POST",
            "/api/v1/auth/recover/complete",
            Some(&recovery_token),
            Some(alice.new_credentials(first_password)),
        ),
        call(
            &app,
            "POST",
            "/api/v1/auth/recover/complete",
            Some(&recovery_token),
            Some(alice.new_credentials(second_password)),
        ),
    );
    let statuses = [first.0, second.0];
    assert_eq!(
        statuses
            .iter()
            .filter(|s| **s == StatusCode::NO_CONTENT)
            .count(),
        1,
        "two requests at the same time cannot both use the recovery session: {statuses:?}"
    );
    let new_password = if first.0 == StatusCode::NO_CONTENT {
        first_password
    } else {
        second_password
    };
    let (s, _) = alice.get(&app, "/api/v1/vaults").await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "all sessions end after recovery"
    );
    let (s, _) = call(
        &app,
        "POST",
        "/api/v1/auth/recover/complete",
        Some(&recovery_token),
        Some(alice.new_credentials("again-and-again")),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "the recovery session is single use"
    );

    alice.password = new_password.into();
    alice.login(&app).await;
    let key_after = alice.vault_key(&app, &vault).await;
    let (_, page) = alice
        .get(&app, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    let data = EncString::parse(page["items"][0]["data"].as_str().unwrap()).unwrap();
    assert_eq!(
        key_after
            .decrypt(&data, &item_aad(&vault, &item, 1))
            .unwrap()
            .as_slice(),
        b"vor dem vergessen"
    );
}

#[tokio::test]
async fn native_client_registers_unlocks_and_roundtrips_items() {
    let Some(app) = app(true).await else { return };
    let mut native = melon_native::Session::default();
    let user = Uuid::new_v4().to_string();
    let vault = Uuid::new_v4().to_string();
    let email = format!("native-{user}@example.com");
    let salt = native.call("generateSalt", Value::Null).unwrap();
    let derive =
        json!({"password":"native-test-password", "salt":salt, "kdf":KdfParams::minimum()});
    let auth = native.call("derive", derive.clone()).unwrap();
    let account = native
        .call(
            "createAccount",
            json!({"userId":user,"personalVaultId":vault,"meta":"{\"name\":\"Native\"}"}),
        )
        .unwrap();
    let mut registration = json!({"user_id":user,"email":email,"salt":salt,"kdf":KdfParams::minimum(),"auth_key":auth,"wrapped_account_key":account["wrappedAccountKey"],"public_key":account["publicKey"],"encrypted_private_key":account["encryptedPrivateKey"],"personal_vault":{"id":vault,"encrypted_meta":account["personalVault"]["encryptedMeta"],"encrypted_vault_key":account["personalVault"]["encryptedVaultKey"]}});
    native.resolve_auth_proofs(&mut registration).unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/auth/register",
            None,
            Some(registration)
        )
        .await
        .0,
        StatusCode::CREATED
    );
    native.lock();
    let auth = native.call("derive", derive).unwrap();
    let mut login = json!({"email":email,"auth_key":auth});
    native.resolve_auth_proofs(&mut login).unwrap();
    let (status, login) = call(&app, "POST", "/api/v1/auth/login", None, Some(login)).await;
    assert_eq!(status, StatusCode::OK);
    let token = login["token"].as_str().unwrap();
    native.call("unlock",json!({"wrappedAccountKey":login["wrapped_account_key"],"encryptedPrivateKey":login["encrypted_private_key"]})).unwrap();
    let (_, vaults) = call(&app, "GET", "/api/v1/vaults", Some(token), None).await;
    let remote = &vaults["vaults"][0];
    native.call("openVault",json!({"vaultId":vault,"userId":user,"keyVersion":1,"sealed":remote["encrypted_vault_key"],"senders":[login["public_key"]]})).unwrap();
    let item = Uuid::new_v4().to_string();
    let encrypted = native
        .call(
            "encryptItem",
            json!({"vaultId":vault,"itemId":item,"plaintext":"native-secret"}),
        )
        .unwrap();
    let (status, _) = call(
        &app,
        "PUT",
        &format!("/api/v1/vaults/{vault}/items/{item}"),
        Some(token),
        Some(json!({"data":encrypted,"key_version":1,"base_revision":null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, page) = call(
        &app,
        "GET",
        &format!("/api/v1/vaults/{vault}/items?since=0"),
        Some(token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!page.to_string().contains("native-secret"));
    let decrypted = native.call("decryptItems",json!({"vaultId":vault,"items":[{"id":item,"keyVersion":1,"data":page["items"][0]["data"]}]})).unwrap();
    assert_eq!(decrypted[0]["plaintext"], "native-secret");
    let recovery = native.call("setupRecovery",json!({"password":"native-test-password","salt":salt,"kdf":KdfParams::minimum(),"wrappedAccountKey":login["wrapped_account_key"]})).unwrap();
    let mut body = json!({"current_auth_key":recovery["currentAuthKey"],"recovery_auth_key":recovery["recoveryAuthKey"],"recovery_wrapped_account_key":recovery["recoveryWrappedAccountKey"]});
    native.resolve_auth_proofs(&mut body).unwrap();
    assert_eq!(
        call(
            &app,
            "PUT",
            "/api/v1/account/recovery",
            Some(token),
            Some(body)
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    native.lock();
    assert!(
        native
            .call("decryptItems", json!({"vaultId":vault,"items":[]}))
            .is_err()
    );
}

async fn login_from(app: &Router, ip: &str, email: &str) -> StatusCode {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login")
        .header("x-forwarded-for", ip)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "email": email, "auth_key": STANDARD.encode([1u8; 32]) }).to_string(),
        ))
        .unwrap();
    app.clone().oneshot(req).await.unwrap().status()
}

#[tokio::test]
async fn many_failed_logins_from_one_address_are_blocked_across_accounts() {
    let Some(app) = app_with(true, true).await else {
        return;
    };
    let alice = Person::new("alice");
    assert_eq!(alice.register(&app, None).await, StatusCode::CREATED);
    for n in 0..30 {
        let status = login_from(&app, "203.0.113.9", &format!("guess-{n}@example.com")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    assert_eq!(
        login_from(&app, "203.0.113.9", &alice.email).await,
        StatusCode::TOO_MANY_REQUESTS,
        "the address is blocked even for an account it has not tried yet"
    );
    assert_eq!(
        login_from(&app, "6.6.6.6, 203.0.113.9", &alice.email).await,
        StatusCode::TOO_MANY_REQUESTS,
        "a forged first entry does not escape the limit"
    );
    assert_eq!(
        login_from(&app, "198.51.100.4", &alice.email).await,
        StatusCode::UNAUTHORIZED,
        "other addresses are unaffected"
    );
    let untrusted = app_with(true, false).await.unwrap();
    for n in 0..31 {
        let status = login_from(&untrusted, "203.0.113.9", &format!("x-{n}@example.com")).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "without a trusted proxy the header is ignored"
        );
    }
}

#[tokio::test]
async fn one_address_cannot_lock_an_account_for_everyone() {
    let Some(app) = app_with(true, true).await else {
        return;
    };
    let alice = Person::new("alice");
    assert_eq!(alice.register(&app, None).await, StatusCode::CREATED);
    for _ in 0..10 {
        assert_eq!(
            login_from(&app, "203.0.113.50", &alice.email).await,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        login_from(&app, "203.0.113.50", &alice.email).await,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(
        login_from(&app, "198.51.100.20", &alice.email).await,
        StatusCode::UNAUTHORIZED,
        "the owner's own address still reaches the password check"
    );
    for n in 1..=4 {
        for _ in 0..10 {
            login_from(&app, &format!("192.0.2.{n}"), &alice.email).await;
        }
    }
    assert_eq!(
        login_from(&app, "192.0.2.99", &alice.email).await,
        StatusCode::TOO_MANY_REQUESTS,
        "the whole account still has a limit across addresses"
    );
}

#[tokio::test]
async fn login_and_recovery_limits_do_not_share_counters() {
    let Some(app) = app(true).await else { return };
    let alice = Person::new("alice");
    assert_eq!(alice.register(&app, None).await, StatusCode::CREATED);
    let disguised = format!("recover:{}", alice.email);
    for _ in 0..12 {
        call(
            &app,
            "POST",
            "/api/v1/auth/login",
            None,
            Some(json!({ "email": disguised, "auth_key": STANDARD.encode([1u8; 32]) })),
        )
        .await;
    }
    let (s, _) = call(
        &app,
        "POST",
        "/api/v1/auth/recover/start",
        None,
        Some(json!({ "email": alice.email, "recovery_auth_key": STANDARD.encode([1u8; 32]) })),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_account_keeps_only_its_newest_sessions() {
    let Some(app) = app(true).await else { return };
    let mut alice = Person::new("alice");
    assert_eq!(alice.register(&app, None).await, StatusCode::CREATED);
    alice.login(&app).await;
    let first = alice.token.clone();
    for _ in 0..24 {
        alice.login(&app).await;
    }
    let (s, list) = alice.get(&app, "/api/v1/sessions").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(list["sessions"].as_array().unwrap().len(), 20);
    let (s, _) = call(&app, "GET", "/api/v1/vaults", Some(&first), None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "the oldest session ended");
}

#[tokio::test]
async fn simultaneous_failed_logins_cannot_slip_past_the_limits() {
    let Some(app) = app_with(true, true).await else {
        return;
    };
    let mut tasks = tokio::task::JoinSet::new();
    for n in 0..60 {
        let app = app.clone();
        tasks.spawn(async move {
            login_from(&app, "192.0.2.77", &format!("race-{n}@example.com")).await
        });
    }
    let mut checked = 0;
    while let Some(status) = tasks.join_next().await {
        if status.unwrap() == StatusCode::UNAUTHORIZED {
            checked += 1;
        }
    }
    assert_eq!(
        checked, 30,
        "exactly the per-address limit reaches the password check"
    );

    let alice = Person::new("alice");
    assert_eq!(alice.register(&app, None).await, StatusCode::CREATED);
    let mut tasks = tokio::task::JoinSet::new();
    for _ in 0..25 {
        let app = app.clone();
        let email = alice.email.clone();
        tasks.spawn(async move { login_from(&app, "198.51.100.8", &email).await });
    }
    let mut checked = 0;
    while let Some(status) = tasks.join_next().await {
        if status.unwrap() == StatusCode::UNAUTHORIZED {
            checked += 1;
        }
    }
    assert_eq!(
        checked, 10,
        "exactly the per-account limit reaches the password check"
    );
}

#[tokio::test]
async fn devices_can_be_listed_and_signed_out_but_only_your_own() {
    let Some(app) = app(true).await else {
        return;
    };
    let mut alice = Person::new("alice");
    assert_eq!(alice.register(&app, None).await, StatusCode::CREATED);
    alice.login(&app).await;
    let first = alice.token.clone();
    alice.login(&app).await;
    let second = alice.token.clone();
    let mut bob = Person::new("bob");
    assert_eq!(bob.register(&app, None).await, StatusCode::CREATED);
    bob.login(&app).await;

    let (s, list) = alice.get(&app, "/api/v1/sessions").await;
    assert_eq!(s, StatusCode::OK);
    let sessions = list["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 2);
    assert!(sessions.iter().all(|x| x["device"] == "Testgerät"));
    let current: Vec<_> = sessions.iter().filter(|x| x["current"] == true).collect();
    assert_eq!(current.len(), 1);
    let other_id = sessions.iter().find(|x| x["current"] == false).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let (s, _) = bob
        .send(
            &app,
            "DELETE",
            &format!("/api/v1/sessions/{other_id}"),
            json!(null),
        )
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "bob cannot sign out alice");
    let (s, _) = call(&app, "GET", "/api/v1/vaults", Some(&first), None).await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = alice
        .send(
            &app,
            "DELETE",
            &format!("/api/v1/sessions/{other_id}"),
            json!(null),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = call(&app, "GET", "/api/v1/vaults", Some(&first), None).await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "signed-out device loses access"
    );

    alice.login(&app).await;
    let (s, _) = alice
        .send(&app, "DELETE", "/api/v1/sessions", json!(null))
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = call(&app, "GET", "/api/v1/vaults", Some(&second), None).await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "all other devices are signed out"
    );
    let (s, list) = alice.get(&app, "/api/v1/sessions").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(list["sessions"].as_array().unwrap().len(), 1);
    let (s, _) = bob.get(&app, "/api/v1/vaults").await;
    assert_eq!(s, StatusCode::OK, "other users are untouched");
    let (s, _) = call(&app, "GET", "/api/v1/sessions", None, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn nobody_lands_in_a_shared_vault_without_accepting_it() {
    let Some(app) = app(true).await else { return };
    let (mut mallory, mut victim, mut bob) = (
        Person::new("mallory"),
        Person::new("victim"),
        Person::new("bob"),
    );
    for p in [&mallory, &victim, &bob] {
        p.register(&app, None).await;
    }
    mallory.login(&app).await;
    victim.login(&app).await;
    bob.login(&app).await;
    let (vault, key) = create_shared_vault(&app, &mallory).await;
    put_item(
        &app,
        &mallory,
        (&vault, &key, 1),
        &Uuid::new_v4().to_string(),
        b"bank",
        Value::Null,
    )
    .await;

    let victim_key = victim.keys.public_key().clone();
    assert_eq!(
        offer(
            &app,
            &mallory,
            &vault,
            &key,
            &victim.id,
            &victim_key,
            "owner"
        )
        .await,
        StatusCode::CREATED
    );
    assert_eq!(victim.vault(&app, &vault).await, None);
    let (_, list) = victim.get(&app, "/api/v1/vaults").await;
    assert_eq!(list["offers"][0]["vault_id"], vault.as_str());
    assert_eq!(list["offers"][0]["from_email"], mallory.email.as_str());
    let (s, _) = victim
        .get(&app, &format!("/api/v1/vaults/{vault}/items"))
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = victim
        .send(
            &app,
            "DELETE",
            &format!("/api/v1/vaults/{vault}"),
            json!({}),
        )
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let pending = mallory.vault(&app, &vault).await.unwrap()["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["user_id"] == victim.id.as_str())
        .cloned()
        .unwrap();
    assert_eq!(pending["pending"], true);

    let (s, r) = mallory
        .send(
            &app,
            "DELETE",
            &format!("/api/v1/vaults/{vault}/members/{}", mallory.id),
            json!({}),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("last_owner")),
        "an owner who has not accepted does not count"
    );

    let (s, _) = victim
        .send(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault}/decline"),
            json!({}),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, list) = victim.get(&app, "/api/v1/vaults").await;
    assert_eq!(list["offers"], json!([]));
    let after = mallory.vault(&app, &vault).await.unwrap();
    assert_eq!(after["rotation_needed"], true);
    assert_eq!(after["members"].as_array().unwrap().len(), 1);
    let (s, _) = victim
        .send(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault}/accept"),
            json!({}),
        )
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let (bobs, bob_key) = create_shared_vault(&app, &bob).await;
    assert_eq!(
        add_member(&app, &bob, &bobs, &bob_key, &victim, "editor").await,
        StatusCode::CREATED
    );
    assert!(victim.vault(&app, &bobs).await.is_some());
    assert_eq!(
        victim.vault_key(&app, &bobs).await.as_bytes(),
        bob_key.as_bytes()
    );
}

#[tokio::test]
async fn offers_shared_vaults_and_members_are_capped() {
    let Some(app) = app(true).await else { return };
    let (mut mallory, mut victim, mut bob) = (
        Person::new("mallory"),
        Person::new("victim"),
        Person::new("bob"),
    );
    for p in [&mallory, &victim, &bob] {
        p.register(&app, None).await;
    }
    mallory.login(&app).await;
    victim.login(&app).await;
    bob.login(&app).await;
    let victim_key = victim.keys.public_key().clone();
    for _ in 0..3 {
        let (vault, key) = create_shared_vault(&app, &mallory).await;
        assert_eq!(
            offer(
                &app,
                &mallory,
                &vault,
                &key,
                &victim.id,
                &victim_key,
                "viewer"
            )
            .await,
            StatusCode::CREATED
        );
    }
    let (vault, key) = create_shared_vault(&app, &mallory).await;
    let (s, r) = mallory
        .send(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault}/members"),
            json!({
                "user_id": victim.id,
                "role": "viewer",
                "encrypted_vault_key": seal_vault_key(&mallory.keys, &victim_key, &key, &ctx(&vault, &victim.id, 1)).unwrap().to_string(),
                "key_version": 1,
            }),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("too_many_offers"))
    );
    let (bobs, bob_key) = create_shared_vault(&app, &bob).await;
    assert_eq!(
        add_member(&app, &bob, &bobs, &bob_key, &victim, "editor").await,
        StatusCode::CREATED,
        "one sender cannot use up someone's offers"
    );

    let db = test_db().await;
    sqlx::query(
        "WITH v AS (
             INSERT INTO vaults (id, personal, encrypted_meta, revision)
             SELECT gen_random_uuid(), false, 'x', nextval('revision_seq')
             FROM generate_series(1, 96) RETURNING id)
         INSERT INTO vault_members (vault_id, user_id, role) SELECT id, $1, 'owner' FROM v",
    )
    .bind(Uuid::parse_str(&mallory.id).unwrap())
    .execute(&db)
    .await
    .unwrap();
    let id = Uuid::new_v4().to_string();
    let key = SymmetricKey::generate();
    let (s, r) = mallory
        .send(
            &app,
            "POST",
            "/api/v1/vaults",
            json!({
                "id": id,
                "encrypted_meta": key.encrypt(b"{}", &vault_meta_aad(&id, 1)),
                "encrypted_vault_key": seal_vault_key(&mallory.keys, mallory.keys.public_key(), &key, &ctx(&id, &mallory.id, 1)).unwrap().to_string(),
            }),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("too_many_vaults"))
    );

    sqlx::query(
        "WITH u AS (
             INSERT INTO users (id, email, kdf_memory_kib, kdf_iterations, kdf_parallelism,
                                kdf_salt, auth_hash, wrapped_account_key, public_key,
                                encrypted_private_key)
             SELECT gen_random_uuid(), gen_random_uuid() || '@example.com', 0, 0, 0, '', '', '', '', ''
             FROM generate_series(1, 98) RETURNING id)
         INSERT INTO vault_members (vault_id, user_id, role) SELECT $1, id, 'viewer' FROM u",
    )
    .bind(Uuid::parse_str(&vault).unwrap())
    .execute(&db)
    .await
    .unwrap();
    let (s, r) = invite(&app, &mallory, &vault, "noch-einer@example.com", "viewer").await;
    assert_eq!(s, StatusCode::CREATED, "{r}");
    let (s, r) = mallory
        .send(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault}/invites"),
            json!({ "email": "zu-viele@example.com", "role": "viewer" }),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("too_many_members"))
    );
}

#[tokio::test]
async fn a_vault_cannot_grow_past_what_one_key_change_can_carry() {
    let Some(app) = app(true).await else { return };
    let mut alice = Person::new("alice");
    alice.register(&app, None).await;
    alice.login(&app).await;
    let (vault, key) = create_shared_vault(&app, &alice).await;
    let vault_id = Uuid::parse_str(&vault).unwrap();
    let db = test_db().await;
    sqlx::query(
        "INSERT INTO items (vault_id, id, data, key_version, revision)
         SELECT $1, gen_random_uuid(), repeat('x', 65000), 1, nextval('revision_seq')
         FROM generate_series(1, 387)",
    )
    .bind(vault_id)
    .execute(&db)
    .await
    .unwrap();
    let big = vec![b'a'; 40_000];
    let item = Uuid::new_v4().to_string();
    let (s, r) = put_item(&app, &alice, (&vault, &key, 1), &item, &big, Value::Null).await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("vault_full"))
    );
    let (s, small) = put_item(
        &app,
        &alice,
        (&vault, &key, 1),
        &item,
        b"klein",
        Value::Null,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{small}");
    let (s, r) = put_item(
        &app,
        &alice,
        (&vault, &key, 1),
        &item,
        &big,
        small["revision"].clone(),
    )
    .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("vault_full")),
        "growing an existing item counts too"
    );

    let live: Vec<(Uuid, i64)> =
        sqlx::query_as("SELECT id, revision FROM items WHERE vault_id = $1 AND NOT deleted")
            .bind(vault_id)
            .fetch_all(&db)
            .await
            .unwrap();
    let new_key = SymmetricKey::generate();
    let filler = vec![b'b'; 48_000];
    let items: Vec<Value> = live
        .iter()
        .map(|(id, rev)| {
            let id = id.to_string();
            json!({
                "id": id,
                "data": new_key.encrypt(&filler, &item_aad(&vault, &id, 2)),
                "base_revision": rev,
            })
        })
        .collect();
    let (s, r) = alice
        .send(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault}/rotate"),
            json!({
                "key_version": 2,
                "encrypted_meta": new_key.encrypt(b"{}", &vault_meta_aad(&vault, 2)),
                "members": [{
                    "user_id": alice.id,
                    "encrypted_vault_key": seal_vault_key(&alice.keys, alice.keys.public_key(), &new_key, &ctx(&vault, &alice.id, 2)).unwrap().to_string(),
                }],
                "items": items,
            }),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{r}");

    sqlx::query("DELETE FROM items WHERE vault_id = $1")
        .bind(vault_id)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO items (vault_id, id, data, key_version, revision)
         SELECT $1, gen_random_uuid(), 'x', 2, nextval('revision_seq')
         FROM generate_series(1, 5000)",
    )
    .bind(vault_id)
    .execute(&db)
    .await
    .unwrap();
    let (s, r) = put_item(
        &app,
        &alice,
        (&vault, &new_key, 2),
        &Uuid::new_v4().to_string(),
        b"eins zu viel",
        Value::Null,
    )
    .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("vault_full"))
    );
}

#[tokio::test]
async fn looking_up_accounts_is_rate_limited() {
    let Some(app) = app(true).await else { return };
    let mut alice = Person::new("alice");
    alice.register(&app, None).await;
    alice.login(&app).await;
    for i in 0..30 {
        let (s, _) = alice
            .get(
                &app,
                &format!("/api/v1/users/lookup?email=raten{i}@example.com"),
            )
            .await;
        assert_eq!(s, StatusCode::NOT_FOUND);
    }
    let (s, _) = alice
        .get(&app, &format!("/api/v1/users/lookup?email={}", alice.email))
        .await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
    let (vault, _) = create_shared_vault(&app, &alice).await;
    let (s, _) = invite(&app, &alice, &vault, "noch-jemand@example.com", "viewer").await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn a_key_can_only_be_granted_to_a_member_still_waiting_for_one() {
    let Some(app) = app(true).await else { return };
    let (mut alice, mut bob) = (Person::new("alice"), Person::new("bob"));
    alice.register(&app, None).await;
    bob.register(&app, None).await;
    alice.login(&app).await;
    bob.login(&app).await;
    let (vault, key) = create_shared_vault(&app, &alice).await;
    add_member(&app, &alice, &vault, &key, &bob, "editor").await;
    let other = SymmetricKey::generate();
    let (s, r) = alice
        .send(
            &app,
            "PUT",
            &format!("/api/v1/vaults/{vault}/members/{}/key", bob.id),
            json!({
                "encrypted_vault_key": seal_vault_key(&alice.keys, bob.keys.public_key(), &other, &ctx(&vault, &bob.id, 1)).unwrap().to_string(),
                "key_version": 1,
            }),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("member_has_key"))
    );
    assert_eq!(bob.vault_key(&app, &vault).await.as_bytes(), key.as_bytes());

    let pv = alice.personal_vault.clone();
    let (s, r) = alice
        .send(
            &app,
            "PUT",
            &format!("/api/v1/vaults/{pv}/members/{}/key", alice.id),
            json!({
                "encrypted_vault_key": seal_vault_key(&alice.keys, alice.keys.public_key(), &other, &ctx(&pv, &alice.id, 1)).unwrap().to_string(),
                "key_version": 1,
            }),
        )
        .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::BAD_REQUEST, Some("personal_vault"))
    );
}

#[tokio::test]
async fn unused_sessions_end_and_taken_ids_are_named() {
    let Some(app) = app(true).await else { return };
    let mut alice = Person::new("alice");
    alice.register(&app, None).await;
    alice.login(&app).await;
    let (s, _) = alice.get(&app, "/api/v1/vaults").await;
    assert_eq!(s, StatusCode::OK);
    let db = test_db().await;
    sqlx::query("UPDATE sessions SET last_seen_at = now() - interval '8 days' WHERE user_id = $1")
        .bind(Uuid::parse_str(&alice.id).unwrap())
        .execute(&db)
        .await
        .unwrap();
    let (s, _) = alice.get(&app, "/api/v1/vaults").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    let mut copy = Person::new("copy");
    copy.id = alice.id.clone();
    let salt = generate_salt();
    let kdf = KdfParams::minimum();
    let mk = derive_master_key(&copy.password, &salt, &kdf).unwrap();
    let vault_key = SymmetricKey::generate();
    let pv = copy.personal_vault.clone();
    let (s, r) = call(
        &app,
        "POST",
        "/api/v1/auth/register",
        None,
        Some(json!({
            "user_id": copy.id,
            "email": copy.email,
            "kdf": kdf,
            "salt": STANDARD.encode(salt),
            "auth_key": mk.auth_key().to_base64(),
            "wrapped_account_key": wrap_account_key(&mk.wrapping_key(), &copy.account_key),
            "public_key": copy.keys.public_key().to_base64(),
            "encrypted_private_key": copy.keys.seal_with(&copy.account_key),
            "personal_vault": {
                "id": pv,
                "encrypted_meta": vault_key.encrypt(b"{}", &vault_meta_aad(&pv, 1)),
                "encrypted_vault_key": seal_vault_key(&copy.keys, copy.keys.public_key(), &vault_key, &ctx(&pv, &copy.id, 1)).unwrap().to_string(),
            },
        })),
    )
    .await;
    assert_eq!(
        (s, r["error"].as_str()),
        (StatusCode::CONFLICT, Some("user_id_taken"))
    );
}
