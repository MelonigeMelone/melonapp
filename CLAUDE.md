# MelonApp

Persönliche All-in-One-App mit Modulen. Das erste Modul ist ein Ende-zu-Ende verschlüsselter
Passwortmanager. Die gesamte Doku liegt in `docs/src/content/docs/` (Starlight).

## Grundregeln

- **Keine Kommentare im Code**, auch keine Doc-Comments. Das Warum gehört in `docs/`.
  Siehe `docs/src/content/docs/entscheidungen/0005-docs-statt-kommentare.md`.
- **Doku im selben Commit/PR aktualisieren**, wenn sich Verhalten, API, Datenmodell,
  Konfiguration, Pipelines oder Sicherheit ändern. Welche Seite zu welcher Änderung gehört,
  steht in `docs/src/content/docs/mitwirken/regeln.md`.
- Neue Grundsatzentscheidung → neues ADR in `docs/src/content/docs/entscheidungen/`.
- Sicherheitsregeln aus `mitwirken/regeln.md` gelten immer. Bei Änderungen an Krypto,
  Auth oder Datenzugriff: Tests für den Angriffsfall und `/security-review` vor dem Abschluss.

## Struktur

- `crates/melon-crypto`: gesamte Kryptografie, nativ + WASM
- `crates/melon-server`: axum + PostgreSQL, speichert nur Chiffretext
- `crates/melon-wasm` → `packages/melon-wasm`: WASM-Bindings (`bash scripts/build-wasm.sh`)
- `apps/web`: React-Web-App, Krypto im Web Worker; E2E-Test in `apps/web/e2e`
- `apps/desktop`: Tauri 2, gemeinsame React-UI, eigener Cargo-Workspace
- `crates/melon-native`: native Schlüsselsitzung und Cache
- `crates/melon-ffi` → `apps/desktop/apple/Bindings`: UniFFI für die Swift-AutoFill-Extension
- `docs/`: Starlight-Doku (npm-Workspace)
- `deploy/`: Docker Compose für den eigenen Server

## Befehle

Native Entwicklung auf macOS und Docker werden unterstützt
(Befehle in `docs/src/content/docs/betrieb/lokale-entwicklung.md`). Unter Git Bash vorher
`export MSYS_NO_PATHCONV=1` setzen.
