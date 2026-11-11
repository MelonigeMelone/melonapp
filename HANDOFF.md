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
