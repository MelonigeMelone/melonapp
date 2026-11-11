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
| Chiffretext lässt sich nicht in anderen Eintrag/Tresor/Schlüsselversion verschieben | `sharing::tests::item_aad_separates_contexts`, `api::personal_vault_flow` |
| Geteilter Tresor-Schlüssel ist an Tresor, Person und Version gebunden | `sharing::tests::sealed_key_is_bound_to_vault_user_and_version` |
| Nur der Empfänger öffnet seine Schlüssel-Kopie | `sharing::tests::other_person_cannot_open` |
| Server kann KDF nicht abschwächen | `kdf::tests::weak_or_absurd_params_are_rejected` |
| Gleiches Passwort auf allen Plattformen | `kdf::tests::unicode_is_normalized` |
| Fremde sehen keine Tresore, persönliche Tresore sind nicht teilbar | `api::sharing_respects_roles_and_isolation` |
| Betrachter können nicht schreiben, Bearbeiter keine Mitglieder verwalten | `api::sharing_respects_roles_and_isolation` |
| Einladung: an E-Mail gebunden, einmalig, Registrierung sonst geschlossen | `api::invite_link_registration_and_key_grant` |
| Entfernen erzwingt Schlüsselwechsel über alle Einträge und Mitglieder | `api::removing_a_member_rotates_the_key` |
| Schreiben mit altem Schlüssel wird abgelehnt | `api::removing_a_member_rotates_the_key`, `store.test.ts` |
| Letzter Besitzer kann nicht gehen | `api::leaving_flags_rotation_and_last_owner_stays` |
| Passwortwechsel nur mit altem Passwort, andere Geräte abgemeldet, Tresore bleiben lesbar | `api::changing_the_master_password` |
| Recovery: falscher Key und unbekannte E-Mail sehen gleich aus, Recovery-Sitzung liest nichts, ist einmalig, danach alle Sitzungen weg | `api::recovering_with_the_recovery_key` |
| Recovery-Key: Tippfehler werden erkannt, Groß-/Kleinschreibung und Trennzeichen egal | `recovery::tests` |
| Sicherheitscode beider Seiten stimmt überein | CI-Job `e2e`, Schritt „security code“ |
| Server speichert keinen Klartext | `api::personal_vault_flow` |
| Login-Sperre nach Fehlversuchen | `api::wrong_password_and_lockout` |
| `prelogin` verrät keine Konten | `api::prelogin_does_not_reveal_accounts` |
| Abgemeldete Tokens sind ungültig | `api::personal_vault_flow` |
| Sicherheits-Header sind gesetzt | `api::security_headers_are_set` |
| Konflikt verliert kein Passwort | `store.test.ts: resolves a conflicting edit` |
| Unlesbare Items brechen den Sync nicht ab | `store.test.ts: skips items it cannot decrypt` |
| Keine `javascript:`-Links aus Einträgen | `item.test.ts: only creates safe links` |
| Verborgene Felder sind nicht durchsuchbar | `item.test.ts`, CI-Job `e2e` |
| 2FA-Codes stimmen mit RFC 6238 überein (SHA-1/256/512), kaputte Schlüssel werden abgelehnt | `totp.test.ts` |
| Datenleck-Abgleich sendet nur 5 Hash-Zeichen, jedes Passwort nur einmal | `audit.test.ts` |
| 2FA-Code im echten Browser: Anzeige, Kopieren, Ausfüllen durch die Erweiterung nur auf passender Domain | CI-Job `e2e` |
| Import liest alle Formate korrekt, auch schwierige CSV-Fälle und 1PUX | `import.test.ts` |
| Import im Browser: Doppelte übersprungen, Sonderzeichen in Passwörtern bleiben erhalten | CI-Job `e2e`, Schritt „import“ |
| Angezeigte Passwörter werden beim Wechsel zu einem anderen Eintrag wieder verborgen | CI-Job `e2e` |
| Erweiterung: kein Treffer für Look-alike- und Eltern-Domains, kein https-Login in http-Seiten | `match.test.ts` |
| Erweiterung: versteckte und deaktivierte Felder werden ignoriert | `form.test.ts` |
| Erweiterung im echten Chromium: kein Ausfüllen ohne Klick, nichts auf fremder Domain, Speichern landet verschlüsselt im Bereich, Sperren beendet Ausfüllen | CI-Job `e2e` (`apps/extension/e2e`) |
| Zwei Personen im echten Browser: Einladen, automatische Freigabe, Entfernen mit Schlüsselwechsel, Zugriff danach weg | CI-Job `e2e` (`apps/web/e2e/vault.e2e.mjs`) |
| Datenbank enthält nach dem Browser-Test keinen Klartext, auch keine Tresor-Namen | CI-Job `e2e`, Schritt „no plaintext“ |

## Lokal ausführen

```sh
cargo deny check
cargo clippy --workspace --all-targets -- -D warnings
```

Ohne lokales Rust siehe [Lokale Entwicklung](/melonapp/betrieb/lokale-entwicklung/).

## Native Apple-Sitzung

`cargo test -p melon-native` prüft die native Schlüsselgrenze unabhängig von Tauri:

| Eigenschaft | Test |
|---|---|
| Eintragsverschlüsselung und Bindung an die Eintrags-ID | `roundtrip_and_wrong_item_context` |
| Cache lehnt falschen Schlüssel, Kontext und Manipulation ab | `cache_rejects_wrong_key_scope_and_tampering` |
| Gesperrte Sitzung kann weder Cache noch Tresor lesen | `locked_state_cannot_access_cache_or_vaults` |
| Falsches Passwort verbraucht die Ableitung ohne Restschlüssel | `wrong_password_does_not_leave_keys_and_retry_needs_derivation` |
| Rust erzwingt Ablauf ohne UI-Timer | `timeout_is_enforced_without_ui_timer` |
| Kein Import/Export roher Schlüssel über die UI-Schnittstelle | `raw_keys_and_unknown_commands_are_never_exposed` |
| Fehler bei neuer Anmeldung löschen den alten Zustand | `failed_derivation_clears_previous_session` |
