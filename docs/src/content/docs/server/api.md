---
title: API
description: Alle Endpunkte von melon-server (v1).
sidebar:
  order: 1
---

Basis: `https://<deine-domain>/api/v1`. Bodies sind JSON. Authentifizierte Endpunkte
erwarten `Authorization: Bearer <token>`.

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| GET | `/health` (ohne `/api/v1`) | – | Lebenszeichen, antwortet `ok` |
| POST | `/auth/prelogin` | – | KDF-Parameter + Salt zu einer E-Mail |
| POST | `/auth/register` | – | Konto anlegen |
| POST | `/auth/login` | – | Sitzungstoken + verschlüsselter Vault-Key |
| POST | `/auth/logout` | ✓ | Sitzung beenden |
| GET | `/vault/items?since=N` | ✓ | Änderungen seit Revision N |
| PUT | `/vault/items/{id}` | ✓ | Item anlegen oder ändern |
| DELETE | `/vault/items/{id}?base_revision=N` | ✓ | Item löschen |

## Auth

### `POST /auth/prelogin`

```json
{ "email": "max@example.com" }
```

→ `200`

```json
{ "kdf": { "memory_kib": 65536, "iterations": 3, "parallelism": 4 }, "salt": "<base64>" }
```

Für unbekannte E-Mails gibt es ein stabiles Fake-Salt ([warum](/melonapp/server/authentifizierung/#prelogin)).

### `POST /auth/register`

```json
{
  "email": "max@example.com",
  "kdf": { "memory_kib": 65536, "iterations": 3, "parallelism": 4 },
  "salt": "<base64, 16–64 Byte>",
  "auth_key": "<base64, 32 Byte>",
  "wrapped_vault_key": "1.<…>"
}
```

→ `201 { "user_id": "<uuid>" }` · `403 registration_disabled` · `409 email_taken` · `400 invalid_*`

### `POST /auth/login`

```json
{ "email": "max@example.com", "auth_key": "<base64>" }
```

→ `200`

```json
{ "token": "<base64url>", "expires_in_seconds": 1209600, "user_id": "<uuid>", "wrapped_vault_key": "1.<…>" }
```

`401 unauthorized` · `429 too_many_requests`

### `POST /auth/logout`

→ `204`

## Vault

### `GET /vault/items?since=N`

→ `200`

```json
{
  "items": [{ "id": "<uuid>", "module": "passwords", "data": "1.<…>", "revision": 42, "deleted": false }],
  "latest_revision": 42,
  "has_more": false
}
```

Höchstens 1000 Items pro Antwort. Bei `has_more: true` mit `since=latest_revision` erneut abfragen.

### `PUT /vault/items/{id}`

```json
{ "module": "passwords", "data": "1.<…>", "base_revision": null }
```

`base_revision: null` legt an, eine Zahl ändert. → `200 { "revision": 43 }` ·
`409 revision_mismatch` · `400 invalid_module | item_too_large` (max. 64 KiB)

### `DELETE /vault/items/{id}?base_revision=N`

→ `200 { "revision": 44 }` · `409 revision_mismatch`

## Fehler

Fehler sind immer `{ "error": "<code>" }` mit einem stabilen Code. Details landen nur
im Server-Log, damit Antworten nichts über Interna verraten.
