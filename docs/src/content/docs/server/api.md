---
title: API
description: Alle Endpunkte von melon-server (v1).
sidebar:
  order: 1
---

Basis: `https://<deine-domain>/api/v1`. Bodies sind JSON. Authentifizierte Endpunkte
erwarten `Authorization: Bearer <token>`. Fehler sind immer `{ "error": "<code>" }`.

Formate: `EncString` = `1.<base64url>` (XChaCha20-Poly1305), `SealedKey` = `h1.<base64url>`
(HPKE), öffentliche Schlüssel und Salts als Standard-Base64. Siehe [Kryptografie](/melonapp/sicherheit/kryptografie/).

## Übersicht

| Methode | Pfad | Wer | Zweck |
|---|---|---|---|
| GET | `/health` (ohne `/api/v1`) | alle | Lebenszeichen |
| POST | `/auth/prelogin` | alle | KDF-Parameter + Salt |
| POST | `/auth/register` | alle* | Konto + persönlicher Tresor |
| POST | `/auth/login` | alle | Sitzung + verschlüsseltes Schlüsselmaterial |
| POST | `/auth/logout` | angemeldet | Sitzung beenden |
| GET | `/sessions` | angemeldet | eigene angemeldete Geräte |
| DELETE | `/sessions/{id}` | angemeldet | ein eigenes Gerät abmelden |
| DELETE | `/sessions` | angemeldet | alle eigenen Geräte außer diesem abmelden |
| POST | `/auth/invites/preview` | alle | E-Mail und Einladender zu einem Einladungslink |
| POST | `/auth/recover/start` | alle | Recovery-Sitzung mit Recovery-Auth-Key |
| POST | `/auth/recover/complete` | Recovery-Sitzung | neues Master-Passwort setzen |
| PUT | `/account/password` | angemeldet | Master-Passwort ändern |
| PUT | `/account/recovery` | angemeldet | Recovery-Key setzen oder ersetzen |
| GET | `/users/lookup?email=` | angemeldet | Nutzer-ID und öffentlicher Schlüssel |
| GET | `/vaults` | angemeldet | eigene Tresore mit Mitgliedern |
| POST | `/vaults` | angemeldet | geteilten Tresor anlegen |
| PUT | `/vaults/{id}` | Besitzer | Name ändern |
| DELETE | `/vaults/{id}` | Besitzer | geteilten Tresor löschen |
| GET | `/vaults/{id}/items?since=N` | Mitglied mit Schlüssel | Änderungen seit Revision N |
| PUT | `/vaults/{id}/items/{item}` | Bearbeiter, Besitzer | Eintrag anlegen/ändern |
| DELETE | `/vaults/{id}/items/{item}?base_revision=N` | Bearbeiter, Besitzer | Eintrag löschen |
| POST | `/vaults/{id}/members` | Besitzer | bestehendes Konto hinzufügen |
| PUT | `/vaults/{id}/members/{user}` | Besitzer | Rolle ändern |
| PUT | `/vaults/{id}/members/{user}/key` | Besitzer | Schlüssel für wartendes Mitglied hinterlegen |
| DELETE | `/vaults/{id}/members/{user}` | selbst / Besitzer | verlassen bzw. wartendes Mitglied entfernen |
| POST | `/vaults/{id}/rotate` | Besitzer | neuer Tresor-Schlüssel, optional Mitglieder entfernen (persönlicher Tresor: nur neuer Schlüssel) |
| GET/POST | `/vaults/{id}/invites` | Besitzer | Einladungen auflisten / erzeugen |
| DELETE | `/vaults/{id}/invites/{invite}` | Besitzer | Einladung zurückziehen |

\* Registrierung nur bei `MELON_ALLOW_REGISTRATION=true` oder mit gültigem Einladungs-Token.

Alle Besitzer-Aktionen (Tresor löschen, Rollen ändern, Mitglieder hinzufügen, entfernen oder
freischalten, Einladungen, Schlüsselwechsel, Name ändern) verlangen zusätzlich, dass der Besitzer
den Tresor-Schlüssel schon hat. Ein Besitzer, der noch wartet, bekommt `403 vault_key_pending`.

Wer kein Mitglied ist, bekommt für einen Tresor immer `404 vault_not_found`, auch wenn es ihn
gibt. So verrät die API nicht, welche Tresore existieren.

## Auth

### `POST /auth/register`

```json
{
  "user_id": "<uuid, vom Client erzeugt>",
  "email": "max@example.com",
  "kdf": { "memory_kib": 65536, "iterations": 3, "parallelism": 4 },
  "salt": "<base64, 16–64 Byte>",
  "auth_key": "<base64, 32 Byte>",
  "wrapped_account_key": "1.<…>",
  "public_key": "<base64, 32 Byte X25519>",
  "encrypted_private_key": "1.<…>",
  "personal_vault": { "id": "<uuid>", "encrypted_meta": "1.<…>", "encrypted_vault_key": "h2.<…>" },
  "invite_token": null
}
```

→ `201 { "user_id" }` · `403 registration_disabled` · `409 email_taken` ·
`400 invalid_invite | invite_email_mismatch | invalid_*`

Die Nutzer-ID kommt vom Client, weil der Tresor-Schlüssel des persönlichen Tresors schon
bei der Registrierung an sie gebunden wird. Mit Einladungs-Token wird die Person zusätzlich
**wartendes Mitglied** des einladenden Tresors. Ob die Einladung noch offen ist und ihr Ersteller
noch Besitzer mit Schlüssel ist, prüft der Server in derselben Transaktion, in der er sie
einlöst, mit gesperrter Tresor-Zeile. Ein gleichzeitiger Widerruf gewinnt also immer
(`400 invalid_invite`).

### `POST /auth/login`

`{ "email", "auth_key", "device"? }` → `200`

`device` ist ein Name für die Geräteliste, z. B. „Firefox auf Windows“. Der Server entfernt
Steuerzeichen und kürzt auf 64 Zeichen. Er ist eine Angabe des Clients, kein Nachweis.

```json
{ "token": "…", "expires_in_seconds": 1209600, "user_id": "…",
  "wrapped_account_key": "1.<…>", "public_key": "…", "encrypted_private_key": "1.<…>",
  "has_recovery": true }
```

`401 unauthorized` · `429 too_many_requests`

### `POST /auth/invites/preview`

`{ "token" }` → `200 { "email", "invited_by" }` · `404 invite_not_found`

Der Token steht im Link hinter `#`. Browser schicken diesen Teil nie an den Server, er landet
also nicht in Server- oder Proxy-Logs. Die Web-App sendet ihn nur im Body dieser Anfrage.

## Geräte

### `GET /sessions`

```json
{ "sessions": [ { "id": "…", "device": "Firefox auf Windows", "created_at": 1794480000,
                  "last_seen_at": 1794488000, "current": true } ] }
```

Nur normale Sitzungen (`full`) des eigenen Kontos, die noch gelten, zuletzt aktive zuerst. Zeiten
in Unix-Sekunden. `last_seen_at` wird höchstens alle 5 Minuten aktualisiert.

### `DELETE /sessions/{id}` · `DELETE /sessions`

`204`. Eine fremde oder unbekannte ID ergibt `404 session_not_found`. `DELETE /sessions` beendet
alle eigenen Sitzungen außer der aufrufenden.

## Konto

Beide Endpunkte verlangen das **aktuelle** Master-Passwort als `current_auth_key`. Bei falschem
Passwort kommt `403 wrong_password`, nach 10 Fehlversuchen in 15 Minuten `429`.

### `PUT /account/password`

`{ "current_auth_key", "kdf", "salt", "auth_key", "wrapped_account_key" }` → `204`

Alle anderen Sitzungen des Kontos werden beendet, die aktuelle bleibt.

### `PUT /account/recovery`

`{ "current_auth_key", "recovery_auth_key", "recovery_wrapped_account_key" }` → `204`

Ersetzt einen vorhandenen Recovery-Key.

## Wiederherstellung

### `POST /auth/recover/start`

`{ "email", "recovery_auth_key" }` → `200`

```json
{ "token": "…", "expires_in_seconds": 900, "recovery_wrapped_account_key": "1.<…>" }
```

`401 unauthorized` bei falschem Key, unbekannter E-Mail oder fehlendem Recovery-Key. Die drei
Fälle sehen gleich aus und dauern gleich lang. `429` nach 10 Fehlversuchen für diese E-Mail
oder 30 Fehlversuchen von derselben Adresse.

Der Token gilt 15 Minuten und **nur** für `recover/complete`. Alle anderen Endpunkte lehnen ihn ab.

### `POST /auth/recover/complete`

`Authorization: Bearer <Recovery-Token>`, Body `{ "kdf", "salt", "auth_key", "wrapped_account_key" }`
→ `204`. Danach sind alle Sitzungen des Kontos beendet, auch die Recovery-Sitzung.

## Tresore

### `GET /vaults`

```json
{ "vaults": [{
  "id": "…", "personal": false, "encrypted_meta": "1.<…>", "key_version": 2,
  "revision": 41, "rotation_needed": false,
  "role": "owner", "encrypted_vault_key": "h2.<…>", "member_key_version": 2,
  "members": [{ "user_id": "…", "email": "…", "role": "editor", "public_key": "…",
                "has_key": true, "key_version": 2 }]
}]}
```

`encrypted_vault_key: null` heißt: wartendes Mitglied, der Schlüssel fehlt noch.

### `POST /vaults`

`{ "id", "encrypted_meta", "encrypted_vault_key" }` → `201 { "revision" }` · `409 vault_exists`

### `PUT /vaults/{id}`

`{ "encrypted_meta", "key_version" }` → `200 { "revision" }` · `409 key_rotated`

## Einträge

### `GET /vaults/{id}/items?since=N`

```json
{ "items": [{ "id": "…", "data": "1.<…>", "key_version": 2, "revision": 42, "deleted": false }],
  "latest_revision": 42, "has_more": false }
```

Höchstens 1000 pro Antwort. `403 vault_key_pending` für wartende Mitglieder.

### `PUT /vaults/{id}/items/{item}`

`{ "data", "key_version", "base_revision": null | N }` → `200 { "revision" }`

`409 revision_mismatch` (anderes Gerät war schneller) · `409 key_rotated` (Schlüssel veraltet) ·
`403 read_only` (Betrachter) · `400 item_too_large` (über 64 KiB)

## Mitglieder

### `POST /vaults/{id}/members`

`{ "user_id", "role", "encrypted_vault_key", "key_version" }` → `201`
· `409 member_exists_or_unknown_user` · `400 personal_vault`

### `PUT /vaults/{id}/members/{user}`

`{ "role" }` → `204` · `409 last_owner`

### `DELETE /vaults/{id}/members/{user}`

- **eigene ID:** Tresor verlassen. Setzt `rotation_needed`. `409 last_owner`, wenn man der
  letzte Besitzer ist.
- **fremde ID:** nur für wartende Mitglieder ohne Schlüssel. Wer den Schlüssel hat, wird über
  `rotate` entfernt: `409 rotation_required`.

### `POST /vaults/{id}/rotate`

```json
{
  "key_version": 3,
  "encrypted_meta": "1.<…>",
  "members": [{ "user_id": "…", "encrypted_vault_key": "h2.<…>" }],
  "items": [{ "id": "…", "data": "1.<…>", "base_revision": 41 }],
  "remove_user_ids": ["…"]
}
```

→ `204`. Der Server übernimmt alles in **einer** Transaktion, aber nur, wenn

- `key_version` genau eins höher ist als bisher (`409 key_version_mismatch`),
- beim persönlichen Tresor niemand entfernt wird (`400 personal_vault`). Die Apps wechseln dort
  einmal den Schlüssel, um alte Kopien ohne Absender abzulösen
  ([ADR 0027](/melonapp/entscheidungen/0027-authentisierte-tresor-schluessel/)),
- `members` genau alle verbleibenden Mitglieder mit Schlüssel enthält (`409 members_changed`),
- `items` genau alle nicht gelöschten Einträge enthält, jeweils mit der Revision, die der Client
  neu verschlüsselt hat (`409 items_changed`).

So kann niemand versehentlich Mitglieder ausschließen, Einträge mit altem Schlüssel zurücklassen
oder eine gleichzeitige Änderung mit einem älteren Stand überschreiben. Bei `409` synchronisiert
der Client und versucht es einmal neu.

Alle schreibenden Endpunkte eines Tresors (Einträge, Löschen, Mitglieder, Einladungen, Rotation)
sperren die Tresor-Zeile (`SELECT … FOR UPDATE`) und prüfen Mitgliedschaft und Rolle **in derselben
Transaktion**. Ein gleichzeitiges Entfernen oder Herabstufen kann also nicht zwischen Prüfung und
Schreiben rutschen.

## Einladungen

### `POST /vaults/{id}/invites`

`{ "email", "role" }` → `201 { "id", "token", "expires_in_days": 7 }` · `409 user_exists`

Der Token wird nur dieses eine Mal zurückgegeben. Gespeichert ist nur sein SHA-256-Hash.

Offene Einladungen enden, sobald ihr Ersteller den Tresor verlässt, entfernt wird oder nicht mehr
Besitzer ist. Sonst könnte ein entfernter Besitzer mit einer vorher erzeugten Einladung wieder
eintreten.

### `GET /vaults/{id}/invites`

→ `{ "invites": [{ "id", "email", "role", "expires_in_hours" }] }` (nur offene)
