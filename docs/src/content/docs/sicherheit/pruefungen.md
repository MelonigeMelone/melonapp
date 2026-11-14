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
| gitleaks | jeder Push/PR + täglich | versehentlich committete Secrets im gesamten Verlauf des geprüften Stands (`--log-opts=HEAD`). Andere Branches prüft ihr eigener PR, damit ein fremder Branch nicht jeden PR rot macht. Geprüfte Fehlalarme stehen mit Fingerprint (Commit:Datei:Regel:Zeile) in `.gitleaksignore`; bisher nur ein erfundener Testwert in `export/formats.test.ts` (zweimal, weil der Squash-Merge einen neuen Commit erzeugt; Fingerprints gelten pro Commit). |
| Fuzzing (`cargo-fuzz`, `fuzz/`) | täglich + manuell, je Ziel 2 Minuten | Abstürze und falsche Annahmen bei kaputten Eingaben. `formats`: `EncString`, `SealedKey`, Recovery-Key, öffentlicher Schlüssel (Parsen, Rundweg, Entschlüsseln mit falschem Schlüssel schlägt fehl). `passkey`: Passkey-Signatur mit beliebiger RP-ID, ID und Schlüssel. `native_session`: jede Methode der nativen Sitzung mit beliebigem JSON, Auflösen von Login-Nachweisen, Cache und biometrischem Zustand; Login-Schlüssel kommen nie im Klartext heraus. Funde landen als Artefakt `fuzz-<Ziel>`. |
| GitHub Secret Scanning mit Push-Schutz | jeder Push | lehnt Pushes mit erkannten Secrets ab, bevor sie im Repo landen |
| Dependabot-Alerts und -Sicherheitsupdates | laufend | Warnung und automatischer PR, sobald eine Abhängigkeit eine bekannte Schwachstelle hat |
| Dependabot | wöchentlich | Updates für Cargo, npm, Actions, Docker (beide Dockerfiles und `deploy/docker-compose.yml`). Krypto-Crates (RustCrypto, `hpke`, `rand`) kommen als **ein** gemeinsamer PR, im Haupt-Workspace und in `apps/desktop/src-tauri`, weil sie voneinander abhängen. Die Rust-Version steht als `toolchain`-Eingabe im Workflow, nicht im Action-Tag. Im MSRV-Job ist sie absichtlich gleich `rust-version` aus `Cargo.toml`. |
| Image-Provenance + SBOM | jeder Image-Build | nachweisbar, aus welchem Commit das Server-Image stammt |
| Update-Test (`deploy/test/update.sh`) | jeder Push/PR | spielt Version 0.3.0 mit `bin/melon-update` ein: ein Image aus einem fremden Workflow wird abgelehnt, ohne etwas zu ändern; die Images landen per Digest in `.env`; ein fehlgeschlagenes Update ohne Migration startet die alte Version; nach einer Migration bleibt der Server gestoppt |
| trivy (Container-Images) | jeder Push/PR + täglich | baut Server- und Web-Image und schlägt fehl bei hohen oder kritischen Schwachstellen, für die es einen Fix gibt. Ausnahmen stehen mit Begründung und Ablaufdatum in `.trivyignore.yaml`; derzeit nur `x/net` in Caddy 2.11.9 (noch kein Caddy-Release mit Fix, Caddy parst nur die eigene `index.html`). Das PostgreSQL-Image wird nur gemeldet, nicht als Fehler gewertet: Seine Funde stecken in `gosu`, das nur beim Start die Rechte abgibt. |

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
| Öffentliche Schlüssel kleiner Ordnung werden abgelehnt; Verschlüsseln für sie scheitert sauber, ohne die Sitzung zu stören; unbrauchbare Absender werden beim Öffnen übersprungen | `sharing::tests::low_order_public_keys_are_rejected_and_sealing_to_them_fails_cleanly`, `melon-native`: `sealing_for_a_weak_public_key_fails_without_breaking_the_session`, `an_unusable_sender_key_is_skipped_and_positions_stay_right`, `api::registration_refuses_public_keys_nobody_can_encrypt_for` |
| Schlüssel-Kopien tragen ihren Absender: fremde Absender scheitern, alte Kopien werden als „ohne Absender“ erkannt, umetikettierte auch | `sharing::tests::copy_from_a_sender_outside_the_list_is_rejected`, `copy_without_sender_is_reported_as_legacy`, `relabelling_a_legacy_copy_as_authenticated_fails`, `melon-native`: `vault_key_from_a_sender_outside_the_list_is_refused`, `vault_key_that_does_not_match_the_pinned_one_is_refused`, `legacy_vault_key_opens_only_when_allowed` |
| Server kann keinen eigenen Tresor-Schlüssel unterschieben: persönlicher Tresor nur mit eigener Kopie und einmaligem Wechsel weg von alten Kopien; bekannte Tresore nur mit gemerktem Schlüssel; neue Versionen nur von bekannten oder geprüften Mitgliedern, nicht von ausgetauschten Schlüsseln, vom Server ergänzten Mitgliedern (auch mit zurückgespielter Mitgliederliste) oder ehemaligen Mitgliedern; mit altem persönlichem Schlüssel wird nichts geschrieben; ältere Versionen und versteckter Schlüsselbund stoppen | `manager.test.ts` (`authenticated vault keys in the vaults manager`), `api::personal_vault_can_get_a_new_key_but_never_loses_its_owner` |
| Server kann KDF nicht unter die Mindestwerte abschwächen; die Apps lehnen alles unter den Standardwerten ab, bevor sie etwas ableiten oder senden | `kdf::tests::weak_or_absurd_params_are_rejected`, `session.test.ts` (`refuses weaker key derivation …`) |
| Ein vom Server verschluckter Schlüsselwechsel stoppt das Schreiben mit dem alten Schlüssel; Entfernen wechselt den Schlüssel auch, wenn der Server „kein Schlüssel“ behauptet; ein still entferntes Mitglied löst einen Wechsel aus | `manager.test.ts` (`removing members and key changes the server cannot fake`) |
| Gleiches Passwort auf allen Plattformen | `kdf::tests::unicode_is_normalized` |
| Fremde sehen keine Tresore, persönliche Tresore sind nicht teilbar | `api::sharing_respects_roles_and_isolation` |
| Betrachter können nicht schreiben, Bearbeiter keine Mitglieder verwalten | `api::sharing_respects_roles_and_isolation` |
| Einladung: an E-Mail gebunden, einmalig, Registrierung sonst geschlossen | `api::invite_link_registration_and_key_grant` |
| Besitzer ohne Schlüssel können nichts verwalten oder löschen; Einladungen verfallen, wenn ihr Ersteller geht, entfernt oder herabgestuft wird oder den Schlüssel nicht mehr hat; die App gibt auf solche Einladungen nichts frei | `api::an_owner_without_the_key_cannot_manage_or_delete_the_vault`, `api::invites_end_when_their_owner_leaves_is_removed_or_demoted`, `api::an_invite_only_counts_while_its_creator_is_an_owner_with_the_key`, `manager.test.ts` (`an invitation from someone who is no longer a member grants nothing`) |
| Entfernen erzwingt Schlüsselwechsel über alle Einträge und Mitglieder | `api::removing_a_member_rotates_the_key` |
| Schlüsselwechsel überschreibt keine gleichzeitige Änderung (Revision wird geprüft) | `api::removing_a_member_rotates_the_key` |
| Schreiben mit altem Schlüssel wird abgelehnt | `api::removing_a_member_rotates_the_key`, `store.test.ts` |
| Letzter Besitzer kann nicht gehen | `api::leaving_flags_rotation_and_last_owner_stays` |
| Passwortwechsel nur mit altem Passwort, andere Geräte abgemeldet, Tresore bleiben lesbar | `api::changing_the_master_password` |
| Recovery: falscher Key und unbekannte E-Mail sehen gleich aus, Recovery-Sitzung liest nichts, ist einmalig, danach alle Sitzungen weg | `api::recovering_with_the_recovery_key` |
| Recovery-Key: Tippfehler werden erkannt, Groß-/Kleinschreibung und Trennzeichen egal | `recovery::tests` |
| Sicherheitscode beider Seiten stimmt überein | CI-Job `e2e`, Schritt „security code“ |
| Eigener Sicherheitscode kommt vom entschlüsselten Schlüsselpaar; falscher öffentlicher Schlüssel vom Server bricht den Login ab | `session.test.ts` |
| Vom Server erfundene Mitglieder bekommen keinen Tresor-Schlüssel, auch nicht im persönlichen Tresor und nicht beim Schlüsselwechsel; Eingeladene und Geprüfte schon; zurückgespielte oder fehlende Mitgliederliste stoppt die Freigabe | `manager.test.ts` (`does not hand the vault key to a member the server invents`, `does not seal a rotated key …`, `never hands the key of the personal vault …`, `refuses a replayed or removed member list`, `grants invited people …`) |
| Geprüfter Code ist an den Schlüssel gebunden: ausgetauschter Schlüssel bekommt keinen Tresor-Schlüssel (Freigabe, Hinzufügen, Schlüsselwechsel), auch wenn der Server die Reihenfolge ändert, den persönlichen Tresor versteckt, einen fremden als persönlich ausgibt oder die Liste zurückspielt; nach erneuter Prüfung wieder | `manager.test.ts`, `verified.test.ts`, E2E-Schritt „re-adding bob shows his security code first“ |
| Private Daten öffnet nur dasselbe Konto mit derselben User-ID und demselben Zweck; alte Daten bleiben lesbar | `private::tests` in `melon-crypto`, `private_data_from_older_versions_still_opens`, `melon-native`: `private_data_is_bound_to_the_account_user_and_purpose` |
| Server speichert keinen Klartext | `api::personal_vault_flow` |
| Login-Sperre nach Fehlversuchen | `api::wrong_password_and_lockout` |
| Geräte: nur eigene Sitzungen sichtbar und abmeldbar, abgemeldete verlieren sofort den Zugriff | `api::devices_can_be_listed_and_signed_out_but_only_your_own`, E2E-Schritt „devices: see the other device and sign it out“ |
| Sperre pro Adresse über alle Konten, gefälschter erster `X-Forwarded-For`-Eintrag hilft nicht, ohne vertrauten Proxy zählt der Header nicht | `api::many_failed_logins_from_one_address_are_blocked_across_accounts`, `client_ip::tests` |
| Eine Adresse sperrt ein Konto nicht für alle, das Konto hat trotzdem ein Gesamtlimit; Login- und Recovery-Zähler sind getrennt; Limiter-Speicher bleibt bei einer Flut neuer E-Mails begrenzt, ohne gesperrte Zähler zu vergessen; höchstens 20 Sitzungen je Konto; Recovery-Sitzung nur einmal nutzbar, auch gleichzeitig | `api::one_address_cannot_lock_an_account_for_everyone`, `api::login_and_recovery_limits_do_not_share_counters`, `state::tests::memory_stays_bounded_under_a_flood_of_new_keys`, `a_flood_of_new_keys_does_not_push_out_a_blocked_key`, `a_table_full_of_counted_keys_refuses_new_ones_instead_of_forgetting`, `api::an_account_keeps_only_its_newest_sessions`, `api::recovering_with_the_recovery_key` |
| Erweiterung: Seiten-Skripte lösen keine Speicher-Karte aus und speichern keinen Vorschlag, sehen das iframe der Karte nicht und halten die Erweiterung nicht durch Fokus entsperrt; Vorschläge pro Website; Server nur über https | E2E-Schritte „page scripts can neither trigger the save prompt nor keep the extension unlocked“ und „generate a password on sign-up …“, `pending.test.ts`, `server.test.ts` |
| Gleichzeitige Anfragen kommen nicht an den Limits vorbei | `api::simultaneous_failed_logins_cannot_slip_past_the_limits` |
| `prelogin` verrät keine Konten | `api::prelogin_does_not_reveal_accounts` |
| Kopierte Geheimnisse werden geleert, auch wenn man zum Einfügen die App verlassen hat, und sofort beim Sperren; anderes Kopiertes bleibt | `clipboard.test.ts` |
| Krypto-Worker läuft mit eigener CSP; Rechtschreibprüfung ist aus | E2E-Schritt „the crypto worker runs under a CSP and nothing is spell-checked“ |
| `mailto:`-Links bringen keine weiteren Empfänger oder Texte mit | `item.test.ts: only creates safe links` |
| Niemand landet ohne Zustimmung in einem fremden Bereich: Angebote sind unsichtbar und ohne Rechte, ein nicht angenommener Besitzer zählt nicht, Ablehnen erzwingt einen Schlüsselwechsel | `api::nobody_lands_in_a_shared_vault_without_accepting_it`, `manager.test.ts` (`shared vaults offered to me`), E2E-Schritt „re-adding bob shows his security code first“ |
| Ein Tresor wächst nie über das, was ein Schlüsselwechsel tragen kann; Grenzen für Tresore, Mitglieder und Angebote; ein Absender kann die Angebote einer Person nicht aufbrauchen | `api::a_vault_cannot_grow_past_what_one_key_change_can_carry`, `api::offers_shared_vaults_and_members_are_capped` |
| Konten-Suche und Einladungen sind je Konto begrenzt | `api::looking_up_accounts_is_rate_limited` |
| Ein vorhandener Tresor-Schlüssel wird nie über die Freigabe überschrieben | `api::a_key_can_only_be_granted_to_a_member_still_waiting_for_one` |
| Unbenutzte Sitzungen enden nach 7 Tagen; vergebene Nutzer-IDs werden als solche gemeldet | `api::unused_sessions_end_and_taken_ids_are_named` |
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
| Backups verlassen den Server nur mit age verschlüsselt (ohne Empfänger wird nichts kopiert); falscher Schlüssel oder veränderte Datei lassen die Datenbank unberührt, der richtige stellt sie wieder her; Fehler und Erfolg werden an `BACKUP_PING_URL` gemeldet, ohne Konfiguration preiszugeben | CI-Job „Server scripts“, `deploy/test/backup-restore.sh` |

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
| API-Pfade verlassen `/api/v1/` nicht, auch nicht mit `%2e%2e` | `platform::tests::api_paths_cannot_leave_the_api_prefix` |
| Geräteschlüssel sind vom Kontoschlüssel und voneinander getrennt | `private::tests::device_keys_are_separate_from_the_account_and_each_other` |
| AutoFill-Schlüssel öffnet weder Identität noch API-Cache und kann keinen Cache fälschen | `autofill_key_cannot_open_the_account` |
| AutoFill-Dateien öffnen nur mit Scope und Namen | `autofill_files_open_only_with_their_scope_and_name` |
| Passkeys für die Extension lassen sich nicht mit dem Kontoschlüssel öffnen | `passkeys::tests::synced_copy_for_the_extension_cannot_be_opened_with_the_account_key` |
| Briefkasten-Dateien von vor dem Update werden weiter übernommen | `passkeys::tests::outbox_files_written_before_the_autofill_key_are_still_imported` |
| Face-ID-Zustand mit fremdem Kontoschlüssel und alte v1-Zustände werden abgelehnt; alte Zustände des eigenen Kontos werden erkannt | `biometric_restore_authenticates_snapshot_and_never_returns_keys`, `old_biometric_snapshots_under_the_raw_account_key_are_refused` |

| Apple-Extension-Eigenschaft | Test |
|---|---|
| UniFFI-Cache: Roundtrip, falscher Schlüssel/Kontext und falsche Schlüssellänge | `swift_cache_roundtrip_and_attack_cases` |
| Passkey-Registrierung/Assertion: Attestation, Signatur und Challenge-Bindung | `passkey::tests::registration_and_assertion_verify_and_bind_challenge` |
| Passkey: falsche RP-ID, Schlüssel, Credential-ID, Hash und beschädigte Schlüsselhülle | `passkey::tests::wrong_rp_key_id_hash_and_tampered_key_fail` |
| Passkey-Sync: Schlüssel neu verpackt signiert identisch | `passkey::tests::exported_key_reseals_and_signs_like_the_original` |
| Passkey-Sync: Öffnen mit falschem Schlüssel, RP-ID, Credential-ID oder manipulierter Hülle scheitert | `passkey::tests::export_rejects_wrong_key_rp_id_and_tampering` |
| Passkey-Sync: ungültiger Skalar, RP-ID oder ID wird nicht verpackt | `passkey::tests::seal_rejects_invalid_scalars_rp_and_ids` |
| Passkey-Sync nur mit entsperrtem, eigenem Konto | `tests::passkey_keys_move_between_wrappings_only_with_the_unlocked_account` (`melon-native`) |
| Briefkasten: fremder Scope, fremdes Konto, umbenannte oder manipulierte Datei wird ignoriert | `passkeys::tests::foreign_renamed_or_tampered_outbox_files_are_ignored` (Desktop) |
| Briefkasten: Bestätigen löscht nur Briefkasten-Dateien dieses Scopes, keine Pfade | `passkeys::tests::acknowledge_only_deletes_this_scopes_outbox_files` (Desktop) |
| Briefkasten und Veröffentlichen verweigern bei gesperrter Sitzung | `passkeys::tests::locked_session_reads_and_publishes_nothing` (Desktop) |
| Übernahme in den Tresor: keine Doppelten, Papierkorb respektiert, Datei bleibt bei Fehler; gleiche Credential-ID in geteiltem Bereich verdrängt keinen neuen Passkey | `vault/passkeys.test.ts` |
| Teilweise unlesbare Gerätedatei wird nicht gelöscht | `passkeys::tests::partly_unreadable_legacy_file_is_marked_partial` (Desktop) |
| Extension: eigener Passkey gewinnt gegen gleichnamige ID aus dem Tresor | `apps/desktop/apple/Tests/main.swift` |
| CSV-Export enthält keine Passkeys, verschlüsselter Export behält sie vollständig | `export/formats.test.ts` |
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
