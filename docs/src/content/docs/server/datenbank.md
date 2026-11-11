---
title: Datenbank
description: Tabellen von melon-server und was in welcher Spalte liegt.
sidebar:
  order: 4
---

PostgreSQL 17. Migrationen liegen in `crates/melon-server/migrations/`, werden beim Start
automatisch ausgeführt (`sqlx::migrate!`) und sind ins Binary eingebettet.

:::danger
Eine Migration, die schon irgendwo gelaufen ist, darf nie geändert werden. sqlx prüft
Checksummen und startet sonst nicht. Änderungen kommen immer als neue Datei.
:::

## `users`

| Spalte | Inhalt |
|---|---|
| `id` | UUID |
| `email` | normalisiert (klein, getrimmt), eindeutig |
| `kdf_memory_kib`, `kdf_iterations`, `kdf_parallelism` | Argon2id-Parameter des Clients |
| `kdf_salt` | Salt des Clients (base64) |
| `auth_hash` | Argon2id-PHC-String des Auth-Keys. **Nie** das Passwort. |
| `wrapped_vault_key` | Vault-Key, vom Client mit dem Wrap-Key verschlüsselt |

## `sessions`

| Spalte | Inhalt |
|---|---|
| `token_hash` | SHA-256 des Tokens (Primärschlüssel). Das Token selbst wird nie gespeichert. |
| `user_id` | Besitzer, wird beim Löschen des Nutzers mitgelöscht |
| `expires_at` | Ablauf, indiziert für das Aufräumen |

## `items`

| Spalte | Inhalt |
|---|---|
| `user_id`, `id` | zusammengesetzter Primärschlüssel. Item-IDs sind nur pro Nutzer eindeutig, sodass ein Nutzer mit einer fremden ID nichts anrichten kann. |
| `module` | Modulname im Klartext |
| `data` | `EncString` oder `NULL` bei Tombstones |
| `revision` | aus `item_revision_seq`, Index `(user_id, revision)` für den Sync |
| `deleted` | Tombstone-Markierung |
