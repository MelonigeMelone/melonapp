---
title: Datenbank
description: Tabellen von melon-server und was in welcher Spalte liegt.
sidebar:
  order: 4
---

PostgreSQL 17. Migrationen liegen in `crates/melon-server/migrations/`, werden beim Start
automatisch ausgeführt (`sqlx::migrate!`) und sind ins Binary eingebettet.

:::danger
Eine Migration, die schon irgendwo produktiv gelaufen ist, darf nie geändert werden. sqlx prüft
Checksummen und startet sonst nicht. Änderungen kommen immer als neue Datei.

Ausnahme bisher: `0001_init.sql` wurde für M3 (Tresore) einmal komplett ersetzt, weil noch
keine Installation produktiv lief.
:::

Alle Revisionen (Tresore und Einträge) kommen aus derselben Sequenz `revision_seq`.

## `users`

| Spalte | Inhalt |
|---|---|
| `id` | UUID, vom Client erzeugt |
| `email` | normalisiert (klein, getrimmt), eindeutig |
| `kdf_*`, `kdf_salt` | Argon2id-Parameter und Salt des Clients |
| `auth_hash` | Argon2id-PHC-String des Auth-Keys. **Nie** das Passwort. |
| `wrapped_account_key` | Konto-Schlüssel, mit dem Wrap-Key verschlüsselt |
| `public_key` | X25519, Klartext (öffentlich) |
| `encrypted_private_key` | privater Schlüssel, mit dem Konto-Schlüssel verschlüsselt |
| `recovery_auth_hash` | Argon2id-Hash des Recovery-Auth-Keys, `NULL` ohne Notfall-Kit (Migration 0002) |
| `recovery_wrapped_account_key` | Konto-Schlüssel, mit dem Recovery-Wrap-Key verschlüsselt (Migration 0002) |

## `sessions`

`token_hash` (SHA-256 des Tokens), `user_id`, `expires_at` und `scope` (Migration 0002):
`full` für normale Sitzungen, `recovery` für die 15-Minuten-Sitzung beim Wiederherstellen.

Seit Migration 0003 außerdem `id` (zufällige UUID, für die Geräteliste, nie das Token),
`device` (Name vom Client, höchstens 64 Zeichen) und `last_seen_at`.

## `vaults`

| Spalte | Inhalt |
|---|---|
| `id` | UUID, vom Client erzeugt |
| `personal` | persönlicher Tresor (genau einer pro Konto, nicht teilbar) |
| `encrypted_meta` | Name usw., mit dem Tresor-Schlüssel verschlüsselt |
| `key_version` | aktuelle Schlüsselversion |
| `rotation_needed` | jemand mit Schlüssel hat den Tresor verlassen, ein Besitzer muss rotieren |
| `revision` | steigt bei jeder Änderung an Tresor oder Mitgliedern |

## `vault_members`

| Spalte | Inhalt |
|---|---|
| `vault_id`, `user_id` | Primärschlüssel |
| `role` | `owner`, `editor` oder `viewer` |
| `encrypted_vault_key` | Tresor-Schlüssel per HPKE für dieses Mitglied. `NULL` = wartet auf Freigabe. |
| `key_version` | Version des hinterlegten Schlüssels |

## `items`

| Spalte | Inhalt |
|---|---|
| `vault_id`, `id` | Primärschlüssel. IDs sind nur pro Tresor eindeutig. |
| `data` | `EncString` oder `NULL` bei Tombstones |
| `key_version` | mit welcher Schlüsselversion verschlüsselt |
| `revision`, `deleted` | Sync und Tombstones |

## `invites`

| Spalte | Inhalt |
|---|---|
| `token_hash` | SHA-256 des Einladungs-Tokens, nie der Token selbst |
| `email`, `vault_id`, `role` | wofür die Einladung gilt |
| `expires_at` | 7 Tage nach Erstellung |
| `accepted_by`, `accepted_at` | gesetzt, sobald jemand sich damit registriert hat |
