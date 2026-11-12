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
| CodeQL (`security-extended`) | jeder Push/PR + täglich | statische Code-Analyse für Rust und die Workflows. Testverzeichnisse (`crates/*/tests`, `apps/*/e2e`) sind ausgenommen (`.github/codeql/codeql-config.yml`), weil feste Testpasswörter und -Salts dort gewollt sind. |
| gitleaks | jeder Push/PR + täglich | versehentlich committete Secrets |
| Fuzzing (`cargo-fuzz`, `fuzz/`) | täglich + manuell, je Ziel 2 Minuten | Abstürze und falsche Annahmen bei kaputten Eingaben. `formats`: `EncString`, `SealedKey`, Recovery-Key, öffentlicher Schlüssel (Parsen, Rundweg, Entschlüsseln mit falschem Schlüssel schlägt fehl). `passkey`: Passkey-Signatur mit beliebiger RP-ID, ID und Schlüssel. `native_session`: jede Methode der nativen Sitzung mit beliebigem JSON, Auflösen von Login-Nachweisen, Cache und biometrischem Zustand; Login-Schlüssel kommen nie im Klartext heraus. Funde landen als Artefakt `fuzz-<Ziel>`. |
| GitHub Secret Scanning mit Push-Schutz | jeder Push | lehnt Pushes mit erkannten Secrets ab, bevor sie im Repo landen |
| Dependabot-Alerts und -Sicherheitsupdates | laufend | Warnung und automatischer PR, sobald eine Abhängigkeit eine bekannte Schwachstelle hat |
| Dependabot | wöchentlich | Updates für Cargo, npm, Actions, Docker. Krypto-Crates (RustCrypto, `hpke`, `rand`) kommen als **ein** gemeinsamer PR, im Haupt-Workspace und in `apps/desktop/src-tauri`, weil sie voneinander abhängen. Die Rust-Version steht als `toolchain`-Eingabe im Workflow, nicht im Action-Tag. Im MSRV-Job ist sie absichtlich gleich `rust-version` aus `Cargo.toml`. |
| Image-Provenance + SBOM | jeder Image-Build | nachweisbar, aus welchem Commit das Server-Image stammt |

**Warum täglich?** Neue Schwachstellen in Abhängigkeiten werden laufend veröffentlicht.
Der tägliche Lauf findet sie auch dann, wenn niemand pusht.

## Tests, die Sicherheitseigenschaften festnageln

| Eigenschaft | Test |
|---|---|
| Bestehende Tresore bleiben nach Krypto-Updates lesbar (feste Daten aus älteren Versionen) | `compat::*` in `melon-crypto`, `auth::tests::stored_auth_hashes_still_verify`, `auth::tests::stored_session_tokens_and_fake_salts_stay_the_same` |
| Manipulierter Chiffretext wird erkannt | `cipher::tests::tampering_is_detected` |
| Papierkorb: Rückgängig, Wiederherstellen, endgültig Löschen; gelöschte Einträge nicht bearbeitbar, nach 30 Tagen weg | `trash.test.ts`, E2E-Schritt „trash: undo, restore and delete for good“ |
| Export: nur das richtige Export-Passwort öffnet die Datei, kurze Passwörter, geschwächte KDF, fremdes Salt und neue Versionen werden abgelehnt | `export::tests` in `melon-crypto` |
| Export braucht das Master-Passwort, auch in der nativen Sitzung | `melon-native`: `export_needs_the_master_password_and_reopens_with_the_export_password`, E2E-Schritt „export encrypted and as CSV …“ |
| Export-Datei ist wirklich verschlüsselt, CSV nur nach Bestätigung, Wieder-Import mit falschem Export-Passwort scheitert | E2E-Schritt „export encrypted and as CSV, import the encrypted file again“ |
| Server spielt alte Version eines Eintrags oder einen gelöschten Eintrag zurück, auch nach Neustart | `store.test.ts` (`detects an old version replayed …`, `remembers what it has seen across sessions`, `detects a deleted item brought back …`), `seen.test.ts` |
| Native Apps: fehlgeschlagenes Entsperren und Serverwechsel verwerfen Login-Nachweise; Cache und Biometrie-Zustand sind nicht vertauschbar | `melon-native`: `failed_unlock_discards_pending_auth_proofs`, `server_change_drops_an_abandoned_login_but_not_an_open_vault`, `api_cache_and_biometric_snapshot_cannot_be_swapped` |
| Chiffretext lässt sich nicht in anderen Eintrag/Tresor/Schlüsselversion verschieben | `sharing::tests::item_aad_separates_contexts`, `api::personal_vault_flow` |
| Geteilter Tresor-Schlüssel ist an Tresor, Person und Version gebunden | `sharing::tests::sealed_key_is_bound_to_vault_user_and_version` |
| Nur der Empfänger öffnet seine Schlüssel-Kopie | `sharing::tests::other_person_cannot_open` |
| Server kann KDF nicht abschwächen | `kdf::tests::weak_or_absurd_params_are_rejected` |
| Gleiches Passwort auf allen Plattformen | `kdf::tests::unicode_is_normalized` |
| Fremde sehen keine Tresore, persönliche Tresore sind nicht teilbar | `api::sharing_respects_roles_and_isolation` |
| Betrachter können nicht schreiben, Bearbeiter keine Mitglieder verwalten | `api::sharing_respects_roles_and_isolation` |
| Einladung: an E-Mail gebunden, einmalig, Registrierung sonst geschlossen | `api::invite_link_registration_and_key_grant` |
| Entfernen erzwingt Schlüsselwechsel über alle Einträge und Mitglieder | `api::removing_a_member_rotates_the_key` |
| Schlüsselwechsel überschreibt keine gleichzeitige Änderung (Revision wird geprüft) | `api::removing_a_member_rotates_the_key` |
| Schreiben mit altem Schlüssel wird abgelehnt | `api::removing_a_member_rotates_the_key`, `store.test.ts` |
| Letzter Besitzer kann nicht gehen | `api::leaving_flags_rotation_and_last_owner_stays` |
| Passwortwechsel nur mit altem Passwort, andere Geräte abgemeldet, Tresore bleiben lesbar | `api::changing_the_master_password` |
| Recovery: falscher Key und unbekannte E-Mail sehen gleich aus, Recovery-Sitzung liest nichts, ist einmalig, danach alle Sitzungen weg | `api::recovering_with_the_recovery_key` |
| Recovery-Key: Tippfehler werden erkannt, Groß-/Kleinschreibung und Trennzeichen egal | `recovery::tests` |
| Sicherheitscode beider Seiten stimmt überein | CI-Job `e2e`, Schritt „security code“ |
| Geprüfter Code ist an den Schlüssel gebunden: ausgetauschter Schlüssel bekommt keinen Tresor-Schlüssel (Freigabe, Hinzufügen, Schlüsselwechsel), nach erneuter Prüfung wieder | `manager.test.ts`, `verified.test.ts`, E2E-Schritt „re-adding bob shows his security code first“ |
| Server speichert keinen Klartext | `api::personal_vault_flow` |
| Login-Sperre nach Fehlversuchen | `api::wrong_password_and_lockout` |
| Geräte: nur eigene Sitzungen sichtbar und abmeldbar, abgemeldete verlieren sofort den Zugriff | `api::devices_can_be_listed_and_signed_out_but_only_your_own`, E2E-Schritt „devices: see the other device and sign it out“ |
| Sperre pro Adresse über alle Konten, gefälschter erster `X-Forwarded-For`-Eintrag hilft nicht, ohne vertrauten Proxy zählt der Header nicht | `api::many_failed_logins_from_one_address_are_blocked_across_accounts`, `client_ip::tests` |
| Gleichzeitige Anfragen kommen nicht an den Limits vorbei | `api::simultaneous_failed_logins_cannot_slip_past_the_limits` |
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
| Erweiterung: Seiten-Skripte erreichen das Shadow DOM nicht, öffnen nichts per `click()`, und Klicks durch ein Overlay oder auf eine unsichtbar gemachte Seite füllen nicht aus | CI-Job `e2e` (`apps/extension/e2e`) |
| npm-Abhängigkeiten ohne bekannte hohe Schwachstellen | CI-Workflow `security`, Job `npm audit` |
| Erweiterung im echten Chromium: kein Ausfüllen ohne Klick, nichts auf fremder Domain, Speichern landet verschlüsselt im Bereich, Sperren beendet Ausfüllen | CI-Job `e2e` (`apps/extension/e2e`) |
| Zwei Personen im echten Browser: Einladen, automatische Freigabe, Entfernen mit Schlüsselwechsel, Zugriff danach weg | CI-Job `e2e` (`apps/web/e2e/vault.e2e.mjs`) |
| Datenbank enthält nach dem Browser-Test keinen Klartext, auch keine Tresor-Namen | CI-Job `e2e`, Schritt „no plaintext“ |
| Backups verlassen den Server nur mit age verschlüsselt (ohne Empfänger wird nichts kopiert); falscher Schlüssel oder veränderte Datei lassen die Datenbank unberührt, der richtige stellt sie wieder her | CI-Job „Server scripts“, `deploy/test/backup-restore.sh` |

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

| Zusätzliche native Eigenschaft | Test |
|---|---|
| Biometrischer Snapshot authentifiziert Schlüssel und Kontext; Ergebnis enthält nur UI-Metadaten | `biometric_restore_authenticates_snapshot_and_never_returns_keys` |
| Server-Adresse erzwingt TLS außer Loopback und lehnt eingebettete Zugangsdaten ab | `platform::tests::server_requires_tls_except_loopback_and_rejects_credentials` |

| Apple-Extension-Eigenschaft | Test |
|---|---|
| UniFFI-Cache: Roundtrip, falscher Schlüssel/Kontext und falsche Schlüssellänge | `swift_cache_roundtrip_and_attack_cases` |
| Passkey-Registrierung/Assertion: Attestation, Signatur und Challenge-Bindung | `passkey::tests::registration_and_assertion_verify_and_bind_challenge` |
| Passkey: falsche RP-ID, Schlüssel, Credential-ID, Hash und beschädigte Schlüsselhülle | `passkey::tests::wrong_rp_key_id_hash_and_tampered_key_fail` |
| Swift: exakte HTTPS-Hosts, keine Eltern-/Subdomains, Cache-Ablauf und Aufrufe über echte UniFFI-Bindings | `bash scripts/test-apple-swift.sh` |

| Native Authentifizierung | Test |
|---|---|
| React erhält nur zufällige Auth-Handles; fremde und gesperrte Handles werden verworfen | `auth_proofs_stay_native_and_handles_expire_on_lock` |
| Nativer Client registriert und entsperrt gegen den echten Server mit PostgreSQL, liest verschlüsselte Items und richtet Recovery ein | `api::native_client_registers_unlocks_and_roundtrips_items` |


| Zusätzliche Lebenszyklus- und Speichertests | Test |
|---|---|
| Hintergrund verwirft Schlüssel und verhindert verspätetes biometrisches Entsperren | `background_rejects_pending_biometric_restore_and_new_derivation` |
| Teilen/Rotation binden Empfänger und Version; alter Schlüssel liest neue Version nicht | `sharing_and_rotation_preserve_context_and_versions` |
| Passwortwechsel und Recovery behalten Kontoidentität, falsches Passwort wird abgelehnt | `password_change_and_recovery_preserve_account_and_reject_wrong_password` |
| Cache-Dateien bleiben privat (0600), atomarer Ersatz hinterlässt keine temporäre Datei | `platform::tests::cache_files_are_private_and_atomically_replaced` |

Der Passkey-Test rekonstruiert den öffentlichen Schlüssel direkt aus dem ausgelieferten
COSE-Objekt der Registrierung und prüft damit die Assertion. Er greift für diesen
Nachweis nicht auf den verschlüsselten privaten Schlüssel zurück; falsche COSE-Labels,
Kurvenparameter oder Koordinaten fallen damit im Interoperabilitätstest auf.

Die Swift-Tests gegen UniFFI lehnen zusätzlich einen fremden Cache-Kontext und
abgeschnittenen Chiffretext ab. Die tatsächlich provisionierte App-Group-Grenze
bleibt Teil der Hardware-Abnahme in #23 und #27.

## Biometrie-Einstellungen

`melon-native` prüft den gespeicherten Status ausschließlich in einer entsperrten Sitzung.
Neue Angriffsprüfungen decken fremde Kontoschlüssel, fremde Server-Kontexte, beschädigte
Snapshots, vertauschte API-Caches sowie gesperrte und abgelaufene Sitzungen ab. Eine
Statusabfrage verlängert die Inaktivitätsfrist nicht und stellt keine Sitzung wieder her.

Die React-Interaktionstests prüfen Wiederöffnen, verzögerte Aktivierung und gesperrte
Bedienelemente, fehlende native Erfolgsbestätigung, fehlgeschlagene Deaktivierung mit
Wiederholung, Status-Lesefehler, verspätete Antworten nach Kontowechsel und fehlgeschlagene
AutoFill-Veröffentlichung. Die `.test.tsx`-Tests laufen in jsdom, bestehende `.test.ts`-Tests
weiterhin in Node. Die Prüfung ist kein Ersatz für Touch ID oder Face ID auf Hardware.
