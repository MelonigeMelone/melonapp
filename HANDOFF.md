# Übergabe: Apple-Apps

Stand: 11. November 2026. Branch: `feat/apple-apps`; alle Änderungen werden ausschließlich dorthin gepusht. M5/macOS und M7/iOS sind implementierte, lokal gebaute Entwicklungsstände, **noch keine freigegebenen Releases**.

## Fertig und tatsächlich geprüft

- Homebrew vorhanden; Node 22.23.5 über nvm als Standard eingerichtet; rustup mit `aarch64-apple-darwin`, `x86_64-apple-darwin`, `aarch64-apple-ios`, `aarch64-apple-ios-sim` und WASM installiert; Tauri CLI 2 im npm-Workspace.
- Xcode 26.1.1 (17B100), `xcode-select` und iOS-Simulatoren funktionieren.
- `apps/desktop` verwendet direkt die React-Oberfläche aus `apps/web`, mit nativer Rust-Krypto statt WASM. Schlüssel und Authentifizierungsschlüssel bleiben nativ; JS erhält nur kurzlebige Nachweis-Handles. Absichtlich angezeigte Einträge, Recovery-Key und Sitzungstokens bleiben in der Oberfläche.
- Verschlüsselter lokaler Cache, native Inaktivitätssperre, Sperre bei Hintergrund/Fokusverlust, globaler Hotkey `⌘⇧M`, Keychain-Integration für Touch ID/Face ID implementiert.
- `tauri build` erzeugt die macOS-App; der ad-hoc signierte Standardbuild startet und bleibt als Prozess aktiv. Zusätzlich Intel-macOS-Target mit `cargo check` geprüft.
- `tauri ios init` ausgeführt; Xcode-Projekt liegt unter `apps/desktop/src-tauri/gen/apple`. ARM64-Simulator-Bundle inklusive `PlugIns/MelonAutoFill.appex` gebaut, installiert und gestartet. Screenshot zeigt die mobile Anmeldeseite.
- `melon-ffi` mit UniFFI, Swift Credential Provider, verschlüsselter App-Group-Cache, explizite Passwort-Veröffentlichung und iOS-17-Passkey-Callbacks implementiert. ES256-Signaturen und verschlüsselte private Passkeys kommen aus `melon-crypto`.
- 61 Rust-Tests bestanden: 34 Krypto-, 12 native Sitzungs-, 1 FFI-, 3 Server-Unit- und 11 echte PostgreSQL-Integrationstests. Zusätzlich 2 Tauri-Plattformtests und Swift-Tests gegen tatsächlich generierte UniFFI-Bindings bestanden.
- Angriffsprüfungen umfassen falsche Schlüssel, manipulierte/kontextfremde Caches, gesperrte und abgelaufene Sitzungen, ungültige Auth-Handles, Hintergrundzustand, RP-/Challenge-Bindung und AutoFill-Domain-Abgrenzung.
- Web: 39 Unit-Tests, TypeScript/Produktionsbuild und vollständiger vorhandener Browser-E2E-Test nativ erfolgreich (`ALL GREEN`, einschließlich Teilen, Rotation und Recovery). Erweiterungsprüfungen, WASM-Neubau und deutscher Doku-Build ebenfalls erfolgreich.
- Rustfmt, Clippy mit `-D warnings`, MSRV 1.87 sowie cargo-deny einschließlich optionalem UniFFI-Generator und separaten Apple-Target-Graphen bestanden.
- macOS-CI baut Desktop und iOS-Simulator; regelmäßige Sicherheitsprüfung und Dependabot berücksichtigen den separaten Tauri-Workspace. Der erste Remote-Lauf fand einen Clippy-Befund, der lokal reproduziert und behoben wurde. Remote-Ergebnis des nachfolgenden Laufs siehe unten.

Lokale Prüfprotokolle liegen in `tmp/apple-verification/` (absichtlich nicht eingecheckt). Die ausführlichen deutschen Anleitungen und Sicherheitsgrenzen stehen in `docs/src/content/docs/clients/desktop.md`, `betrieb/lokale-entwicklung.md` und `sicherheit/apple-review.md`.

## Nicht fertig / blockiert

- **Echte biometrische Abnahme fehlt.** Touch-ID-Hardware ist verfügbar, aber Erfolg/Abbruch/Neuregistrierung wurden nicht interaktiv geprüft. Simulator-Start beweist weder Face ID noch funktionierende App-Group-Berechtigungen.
- **macOS-Provisioning fehlt.** Signierter Build mit vorhandener Entwicklungsidentität bestand `codesign --verify`, wurde beim Start aber vom System beendet. Ein passendes macOS-Provisioning-Profil ist erforderlich. Der Standardbuild wurde wiederhergestellt; daraus keine funktionierende Touch-ID-Keychain ableiten.
- **iPhone-Signierung blockiert.** Automatisch erkanntes Team: `S7FTFS4QRH`. Der tatsächliche Archivierungsversuch scheiterte an der in Xcode gespeicherten Anmeldung und einem Profil ohne App Groups. Kein echtes Gerät wurde installiert oder verändert.
- **AutoFill/Passkeys sind noch nicht Ende-zu-Ende mit Safari bzw. einer echten RP abgenommen.** Keine Synchronisation, kein Export und keine Wiederherstellung der gerätelokalen Passkeys. Keine Safari-Web-Erweiterung implementiert.
- Globale Hotkey-Aktivierung, Zwischenablage und vollständige native Login-Bedienung benötigen manuelle Prüfung; Accessibility-/Display-Zugriff und T3-Geräteautomatisierung sind hier nicht freigegeben. Web-E2E ersetzt diese native Prüfung nicht.
- `/security-review` ist in dieser Codex-Umgebung nicht verfügbar und wurde **nicht ausgeführt**. Manuelle Implementierungsprüfung ist dokumentiert; der separate vorgeschriebene Review bleibt vor Abschluss/Merge erforderlich.
- Draft-PR konnte nicht erstellt werden: `gh pr create` scheitert an fehlender GitHub-API-Anmeldung, obwohl SSH-Push funktioniert. Die sichere Zugangsdatenabfrage blieb unbeantwortet; keine Zugangsdaten wurden geraten oder aus anderen Anwendungen entnommen. Fertiger Beschreibungstext: `tmp/apple-pr.md`.
- Keine notarisierten/distributierbaren Builds, kein App Store Connect, kein Windows-Build. M5/M7 bleiben im Fahrplan entsprechend teilweise offen.

## Entscheidungen (jeweils eine Zeile)

- Vorhandenes Homebrew und Xcode bleiben erhalten; zusätzliche Rust-Ziele verwaltet rustup.
- Node 22 wird über das vorhandene nvm installiert und als Standard gewählt.
- Native Datenbanktests verwenden PostgreSQL 15 unter `tmp/apple-postgres`, Loopback-Port 55432 und separate Testdatenbanken.
- Die React-UI wird direkt wiederverwendet; es gibt keinen zweiten UI-Fork.
- Der native TypeScript-Build prüft nur den nativen Einstieg und seine transitiven UI-Imports; der Browser-WASM-Worker bleibt außerhalb dieses Builds.
- Der native Core bleibt im Root-Workspace; Tauri erhält einen separaten Workspace, damit Linux-Server-CI keine Desktop-Systembibliotheken braucht.
- Konto-, Identitäts-, Bereichs- und Auth-Schlüssel bleiben in Rust; rohe Schlüssel-Import-/Export-Operationen sind für die UI gesperrt.
- Auth-Nachweise werden durch zufällige native Handles ersetzt und beim Sperren verworfen.
- Native Inaktivitätsfrist ist fünf Minuten; Hintergrund/Fokusverlust sperrt sofort und verhindert verspätete Wiederaufnahme.
- `⌘⇧M` aktiviert das Fenster, entsperrt aber niemals selbst.
- Caches sind authentifiziert verschlüsselt und kontextgebunden; Dateien werden privat und atomar ersetzt.
- Normale API-Caches liefern zunächst keinen automatischen Offline-Fallback, damit Widerruf nicht still durch Altbestände umgangen wird.
- Server müssen HTTPS verwenden; nur Loopback darf HTTP verwenden, Weiterleitungen sind abgeschaltet und Serverwechsel erfordert Sperren.
- Keychain verwendet `biometryCurrentSet` und `WhenPasscodeSetThisDeviceOnly`, ohne Synchronisation oder ungeschützten Fallback.
- Native Sperre behält das Server-Sitzungstoken für biometrische Wiederaufnahme; Server-Ablauf und Widerruf bleiben wirksam.
- Bundle-Präfix ist `de.melonapp`, App-ID `de.melonapp.app`, Extension-ID `de.melonapp.app.autofill`, App Group `group.de.melonapp.shared`.
- App und Extension verwenden dieselbe App Group auch als Keychain-Zugriffsgruppe, ohne persönlichen Team-Präfix im Quelltext.
- Automatisch gefundenes Team ist `S7FTFS4QRH`; Simulator-Builds verwenden keine Signierung.
- AutoFill erhält nur ausdrücklich veröffentlichte, verschlüsselte Passwort-Snapshots mit exaktem HTTPS-Hostvergleich und 24-Stunden-Frist.
- AutoFill-Snapshots sind bewusste Offline-Kopien; Server-Widerruf ist dort nicht sofort wirksam und die Frist hängt von der Gerätezeit ab.
- Passkeys verwenden ES256, Attestation `none`, Zähler null und bleiben vorerst gerätelokal.
- Kryptografie und biometrische Aufrufe laufen außerhalb des UI-Threads; abgebrochene Swift-Abläufe dürfen keine verspätete erfolgreiche UI-Antwort liefern.
- RustCrypto P-256 wurde wegen RUSTSEC-2026-0387 auf 0.14 aktualisiert; die Mindest-Rust-Version steigt dadurch auf 1.87.
- Nur RUSTSEC-2026-0374 für den ungewarteten, ausschließlich lokalen UniFFI-Buildparser `basic-toml` wird begründet ausgenommen; auch UniFFI 0.32.2 enthielt ihn und Runtime-Advisories bleiben aktiv.
- Die bestehende optionale Datenleck-Prüfung darf aus der nativen UI ausschließlich `api.pwnedpasswords.com` kontaktieren.
- Das Apple-Vorbereitungsskript erzeugt auch leere Tauri-Artefaktverzeichnisse, damit XcodeGen auf einem frischen Checkout funktioniert.
- `project.yml` ist die Quelle des Xcode-Projekts; generierte UniFFI-Bindings und Bibliotheken bleiben Build-Artefakte.
- Ein signierter macOS-Build benötigt ein validiertes Provisioning-Profil; das Hilfsskript verlangt es ausdrücklich, statt einen bekannten nicht startbaren Build zu erzeugen.
- Fehlende Hardware-/Signierungs-/Review-Abnahmen werden offen ausgewiesen und blockieren nicht die unabhängigen Simulator-, Test- und Dokumentationsarbeiten.

## Morgen: genaue Checkliste

- [ ] Branch `feat/apple-apps` prüfen und dieses Dokument sowie `sicherheit/apple-review.md` lesen; zunächst ausschließlich Testzugangsdaten verwenden.
- [ ] In Xcode → Settings → Accounts die vorhandene Apple-Anmeldung reparieren; Team `S7FTFS4QRH` und gültiges Apple-Development-Zertifikat prüfen.
- [ ] Im Apple-Developer-Konto beide Bundle-IDs und `group.de.melonapp.shared` registrieren/zuordnen; App Groups für beide Targets sowie AutoFill Credential Provider für die Extension aktivieren. Falls das Team diese Fähigkeiten nicht unterstützt, Simulator weiterverwenden.
- [ ] Xcode-Projekt öffnen; unter Signing & Capabilities für `melon-desktop_iOS` und `MelonAutoFill` dasselbe Team und passende automatisch verwaltete Profile wählen. Persönliche Signing-Änderungen nicht unbesehen einchecken.
- [ ] Für macOS ein gültiges Entwicklungs-Provisioning-Profil für Team/App-ID installieren und den signierten Build mit dem Hilfsskript unten erstellen; danach sowohl Start als auch echte Keychain-Biometrie prüfen.
- [ ] iPhone verbinden, Vertrauen bestätigen, Developer Mode aktivieren, Gerät in Xcode auswählen und für Entwicklung registrieren; Gerätecode und Face ID müssen eingerichtet sein.
- [ ] Auf dem iPhone einen vom Gerät erreichbaren HTTPS-Server eintragen; `127.0.0.1` bezeichnet dort das iPhone und nicht den Mac. Testkonto anmelden, Testeintrag mit HTTPS-URL anlegen, Face ID im Konto aktivieren.
- [ ] Sperren, Hintergrundwechsel, fünf Minuten Inaktivität, falsches Passwort, Face-ID-Abbruch und erneutes Entsperren prüfen; auf macOS zusätzlich `⌘⇧M`, Touch-ID-Abbruch und Zwischenablage prüfen.
- [ ] Im Konto „Passwörter für iOS AutoFill aktualisieren“ ausführen; unter iOS Einstellungen nach „Automatisch ausfüllen & Passwörter“ suchen und MelonApp als Anbieter aktivieren (Menüposition abhängig von iOS-Version).
- [ ] Safari-Testlogin ausfüllen; ähnliche Domain/andere Subdomain darf keinen Treffer liefern. Ohne Biometrie und nach Ablauf des Snapshots muss AutoFill verweigern; Änderungen erst nach erneutem Veröffentlichen erwarten.
- [ ] Mit einer Test-RP einen Passkey registrieren und danach anmelden; anderen RP, Abbruch, Hintergrundwechsel und erneute Anmeldung testen. Keine wichtigen Konten ausschließlich an diese gerätelokalen Passkeys binden.
- [ ] Nach Verfügbarkeit der GitHub-API-Anmeldung den vorbereiteten Draft-PR erstellen; vorhandene Branch-Pushes nicht ersetzen oder force-pushen.
- [ ] In Claude Code auf diesem Branch `/security-review` ausführen, Befunde beheben und betroffene Angriffsprüfungen wiederholen; danach Remote-CI und menschlichen Review abwarten, bevor gemergt wird.

## App ausprobieren

```sh
cd /Users/tobiaseberle/Documents/workspace/private/melonapp
source "$HOME/.nvm/nvm.sh"
nvm use 22
source "$HOME/.cargo/env"
npm ci
npm run tauri -w desktop -- build
open apps/desktop/src-tauri/target/release/bundle/macos/MelonApp.app
```

Für Entwicklung: `npm run tauri -w desktop -- dev`. Server und Datenbank wie in `docs/src/content/docs/betrieb/lokale-entwicklung.md` starten; beim nativen Client die Server-Basisadresse ohne `/api/v1` eintragen.

```sh
bash scripts/test-apple-swift.sh
bash scripts/build-apple-ffi.sh iphonesimulator
xcodegen generate --spec apps/desktop/src-tauri/gen/apple/project.yml
npm run tauri -w desktop -- ios build --target aarch64-sim --no-sign --ci
open -a Simulator
xcrun simctl bootstatus C6EBD1AB-B0B8-458C-A5DD-06812AE23CCD -b
xcrun simctl install C6EBD1AB-B0B8-458C-A5DD-06812AE23CCD apps/desktop/src-tauri/gen/apple/build/arm64-sim/MelonApp.app
xcrun simctl launch C6EBD1AB-B0B8-458C-A5DD-06812AE23CCD de.melonapp.app
open apps/desktop/src-tauri/gen/apple/melon-desktop.xcodeproj
```

Nicht erneut `tauri ios init` ausführen: die Extension-Konfiguration ist bereits enthalten. Bei anderem Simulator dessen UUID aus `xcrun simctl list devices available` einsetzen.

Nach Reparatur der Signierung:

```sh
npm run tauri -w desktop -- ios build --target aarch64 --archive-only --ci --config '{"bundle":{"iOS":{"developmentTeam":"S7FTFS4QRH"}}}'
APPLE_DEVELOPMENT_TEAM=S7FTFS4QRH \
APPLE_SIGNING_IDENTITY='Apple Development: Tobias Eberle (UXZMXG53TB)' \
APPLE_PROVISIONING_PROFILE='/absoluter/Pfad/zum/macOS-Entwicklungsprofil.provisionprofile' \
bash scripts/build-macos-signed.sh
```

Tests mit der bereits eingerichteten lokalen Datenbank:

```sh
/opt/homebrew/opt/postgresql@15/bin/pg_ctl -D tmp/apple-postgres status
export MELON_TEST_DATABASE_URL="postgres://$(whoami)@127.0.0.1:55432/melon_test"
MELON_REQUIRE_DB=1 cargo test --workspace --locked
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --lib
bash scripts/test-apple-swift.sh
npm test -w web
npm run build -w docs
```

Draft-PR nach verfügbarer API-Anmeldung:

```sh
gh pr create --draft --base main --head feat/apple-apps \
  --title 'Add native macOS and iOS clients with encrypted cache and AutoFill' \
  --body-file tmp/apple-pr.md
```

## Remote-CI-Stand

**Apple-CI erfolgreich:** [Lauf 43108817497](https://github.com/MelonigeMelone/melonapp/actions/runs/43108817497) für Commit `7df79b4c708a50abffa4ab70a364b0ba74637951` ist mit `completed / success` abgeschlossen. Auf einem frischen macOS-Runner bestanden Dependency-Scans, Rust-/Plattform-/Swift-Tests, Clippy, Desktop-Build, UniFFI-Simulator-Build, XcodeGen, vollständiger iOS-Simulator-Build und Upload von `apple-apps-unsigned` (8.621.778 Bytes).

Die vorherigen CI-Befunde wurden behoben: verschachtelte Bedingung in Clippy, fehlende generierte Tauri-Verzeichnisse beim frischen Checkout und die unerwünschte WASM-Typabhängigkeit im nativen Frontend. Der korrigierte Frontend-Build wurde zusätzlich lokal mit tatsächlich entfernten WASM-Artefakten geprüft. Der letzte Folgecommit aktualisiert ausschließlich diese Übergabe; der oben genannte grüne Lauf prüft den unveränderten Implementierungsstand. Die übrigen PR-/Security-Workflows und der vorgeschriebene Review bleiben bis zur PR-Erstellung bzw. verfügbaren Review-Umgebung offen.

GitHub-API-Anmeldung wurde nach dem erfolgreichen Lauf erneut geprüft und fehlt weiterhin. Signing, Hardware-Abnahme und `/security-review` bleiben die oben beschriebenen externen Abschlussblocker; der Gesamtauftrag wird deshalb nicht als vollständig abgeschlossen markiert.
