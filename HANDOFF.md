# Übergabe: Apple-Apps

## Arbeitsstand

Arbeit läuft auf `feat/apple-apps`. Nur tatsächlich ausgeführte Prüfungen werden als bestanden markiert.

## Entscheidungen

- Bestehendes Homebrew und Xcode bleiben erhalten; rustup verwaltet die zusätzlichen Apple-Ziele.
- Node 22 wird mit dem vorhandenen nvm installiert und als Standard gesetzt.
- Native Datenbanktests verwenden eine isolierte PostgreSQL-15-Instanz unter `tmp/apple-postgres` auf Port 55432.
- Die React-Oberfläche bleibt in `apps/web`; Desktop erhält einen eigenen Einstieg und einen nativen Transport.
- Native Verschlüsselungsschlüssel werden niemals über `exportVaultKeys` oder `importVaultKeys` an JavaScript übertragen.
- Bundle-Präfix ist `de.melonapp`: App `de.melonapp.app`, AutoFill `de.melonapp.app.autofill`, App Group `group.de.melonapp.shared`.

## Bereits geprüft

- Homebrew vorhanden, Apple Silicon (`arm64`).
- `xcode-select -p`: `/Applications/Xcode.app/Contents/Developer`.
- `xcodebuild -version`: Xcode 26.1.1 (17B100).
- `xcrun simctl list devices available`: Simulatoren für iOS 18.6, 26.0 und 26.1 vorhanden.
- Node 22.23.5 installiert; `npm ci` erfolgreich, 0 gemeldete Schwachstellen.
- `npm test -w web`: 5 Dateien, 39 Tests bestanden.

- `cargo test --workspace --locked` mit `MELON_REQUIRE_DB=1` und lokalem PostgreSQL erfolgreich (Baseline vor Apple-Code).
- rustup installiert mit allen vier angeforderten Apple-Zielen sowie WASM.

## Noch offen

Implementierung, native Rust-Tests, Apple-Builds, Security-Review, CI und PR folgen.

- Entscheidung: `melon-native` bleibt im plattformunabhängigen Workspace; Tauri hat einen eigenen Workspace, damit Linux-Server-CI keine WebKit-Systembibliotheken benötigt.
- Entscheidung: Native Frist zunächst fünf Minuten; Hintergrundwechsel sperrt sofort, auch wenn der UI-Timer verzögert wird.
- Geprüft: `cargo test -p melon-native` (7 Tests), `cargo clippy -p melon-native --all-targets -- -D warnings` erfolgreich.
- Blocker: `gh auth status` meldet keine Anmeldung; SSH-Push funktioniert. Draft-PR benötigt noch einen verfügbaren authentifizierten API-Zugang.

- Entscheidung: Cache-Antworten werden verschlüsselt geschrieben, aber nicht automatisch als Offline-Fallback verwendet; Widerruf und Löschungen sollen nicht still durch alte Daten ersetzt werden.
- Entscheidung: HTTP nur für Loopback, sonst HTTPS; native HTTP-Weiterleitungen sind deaktiviert.
- Entscheidung: Keychain verwendet `biometryCurrentSet` plus `WhenPasscodeSetThisDeviceOnly`, ohne ungeschützten Ersatz oder Synchronisation.
- Geprüft: `tauri build` erzeugt `MelonApp.app` (14,65 MiB); `open` startet den Prozess und die WebKit-Prozesse.
- Blocker: `osascript` hat keinen Accessibility-Zugriff; `screencapture` kann kein Display-Bild erstellen. Interaktive macOS-Prüfung bleibt manuell.
- Geprüft: Web-Build mit TypeScript und WASM erfolgreich; native Oberfläche baut ohne WASM.
- Geprüft: Tauri-Plattformtest für Server-Validierung bestanden.
- Geprüft: `tauri ios init` erzeugt das Projekt unter `apps/desktop/src-tauri/gen/apple`.
- Entscheidung: Vorhandene Apple-Development-Identität erkannt, Team `S7FTFS4QRH`; Simulator wird ohne Signierung gebaut.

- Geprüft: ARM64-iOS-Simulator-Bundle gebaut, im iPhone-17-Pro-Simulator (iOS 26.1) installiert und gestartet; Screenshot zeigt die funktionsfähig gerenderte Anmeldeseite.
- Entscheidung: AutoFill benötigt einen ausdrücklich veröffentlichten Snapshot, exakte HTTPS-Hosts und erneute Biometrie; Passwort-Snapshot läuft nach 24 Stunden ab.
- Entscheidung: Passkeys sind zunächst gerätelokal, ES256/RustCrypto, Attestation `none`, Zähler null; kein behaupteter Server-Sync oder Backup.
- Entscheidung: App Group wird zugleich als Keychain-Zugriffsgruppe genutzt, ohne fest eincodierten persönlichen Team-Präfix.
- Geprüft: Passkey-Kryptografietests und Swift-Tests gegen echte UniFFI-Bindings bestanden (Domain-Abgrenzung, Ablauf, Cache, falsche RP-ID).
- Entscheidung: Native Sperre behält das serverseitige Sitzungstoken für biometrisches Wiederaufnehmen; serverseitiger Ablauf/Widerruf bleibt wirksam.

- Entscheidung: Auch Authentifizierungsschlüssel bleiben nativ; React erhält nur zufällige Handles, die beim Sperren ungültig werden.
- Geprüft: iOS-Bundle inklusive `PlugIns/MelonAutoFill.appex` gebaut, erneut im Simulator installiert und gestartet.
- Geprüft: `cargo +1.85.0 check --workspace --locked` erfolgreich.
- Blocker: T3-Geräteautomatisierung ist in den Umgebungseinstellungen ausgeschaltet; keine Umgehung oder Einstellungsänderung vorgenommen. Simulator-Build, Installation, Launch und Screenshot funktionieren über Xcode-Werkzeuge.

- Entscheidung: Nach RustSec-Fund wird `p256` von 0.13 auf 0.14 aktualisiert; `crypto-bigint` ist damit gepatcht, Mindest-Rust-Version steigt auf 1.87.
- Geprüft: `cargo deny check` im Workspace und die separaten macOS-/iOS-Target-Prüfungen im Tauri-Workspace sind erfolgreich; keine Advisory-Ausnahme eingetragen.
- Geprüft: `cargo +1.87.0 check --workspace --locked` sowie erneuter WASM-Build erfolgreich; die frühere 1.85-Prüfung ist durch die Sicherheitsaktualisierung überholt.
- Entscheidung: Kryptografie und biometrische Swift-Aufrufe laufen außerhalb des UI-Threads; abgebrochene/ausgeblendete Abläufe dürfen keine verspätete Entsperrung liefern.
- Geprüft: macOS-Entwicklungsbuild mit vorhandener Apple-Development-Identität signiert; `codesign --verify --deep --strict` erfolgreich, Team `S7FTFS4QRH`.
- Blocker: iOS-Gerätearchiv scheitert an abgelehnter Xcode-Anmeldung und fehlendem App-Group-Entitlement im bestehenden Provisioning-Profil. Kein Gerät wurde verändert.
