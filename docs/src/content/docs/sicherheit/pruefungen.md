---
title: Automatische Prüfungen
description: Was bei jedem Push und täglich auf Sicherheit geprüft wird.
sidebar:
  order: 3
---

| Prüfung | Wann | Was |
|---|---|---|
| `cargo clippy -D warnings`, `cargo test` | jeder Push/PR | Code-Qualität und Sicherheits-Tests |
| `cargo-deny` | jeder Push/PR + täglich | bekannte Schwachstellen (RustSec), Lizenzen, unbekannte Paketquellen |
| CodeQL (`security-extended`) | jeder Push/PR + täglich | statische Code-Analyse für Rust und die Workflows |
| gitleaks | jeder Push/PR + täglich | versehentlich committete Secrets |
| Dependabot | wöchentlich | Updates für Cargo, npm, Actions, Docker |
| Image-Provenance + SBOM | jeder Image-Build | nachweisbar, aus welchem Commit das Server-Image stammt |

**Warum täglich?** Neue Schwachstellen in Abhängigkeiten werden laufend veröffentlicht.
Der tägliche Lauf findet sie auch dann, wenn niemand pusht.

## Tests, die Sicherheitseigenschaften festnageln

| Eigenschaft | Test |
|---|---|
| Manipulierter Chiffretext wird erkannt | `cipher::tests::tampering_is_detected` |
| Chiffretext lässt sich nicht in anderes Item/Modul verschieben | `cipher::tests::wrong_context_fails` |
| Server kann KDF nicht abschwächen | `kdf::tests::weak_or_absurd_params_are_rejected` |
| Gleiches Passwort auf allen Plattformen | `kdf::tests::unicode_is_normalized` |
| Nutzer sehen und ändern keine fremden Items | `api::users_are_isolated` |
| Server speichert keinen Klartext | `api::full_vault_flow` |
| Login-Sperre nach Fehlversuchen | `api::wrong_password_and_lockout` |
| `prelogin` verrät keine Konten | `api::prelogin_does_not_reveal_accounts` |
| Abgemeldete Tokens sind ungültig | `api::full_vault_flow` |
| Sicherheits-Header sind gesetzt | `api::security_headers_are_set` |
| Konflikt verliert kein Passwort | `store.test.ts: resolves a conflicting edit` |
| Unlesbare Items brechen den Sync nicht ab | `store.test.ts: skips items it cannot decrypt` |
| Keine `javascript:`-Links aus Einträgen | `entry.test.ts: only links http and https urls` |
| Ganzer Ablauf im echten Browser, falsches Passwort wird abgelehnt | CI-Job `e2e` (`apps/web/e2e/vault.e2e.mjs`) |
| Datenbank enthält nach dem Browser-Test keinen Klartext | CI-Job `e2e`, Schritt „no plaintext“ |

## Lokal ausführen

```sh
cargo deny check
cargo clippy --workspace --all-targets -- -D warnings
```

Ohne lokales Rust siehe [Lokale Entwicklung](/melonapp/betrieb/lokale-entwicklung/).
