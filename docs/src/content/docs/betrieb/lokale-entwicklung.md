---
title: Lokale Entwicklung
description: Bauen, testen und die Doku starten – mit oder ohne lokales Rust.
sidebar:
  order: 2
---

## Rust (ohne lokale Installation, nur Docker)

```sh
docker network create melon-dev
docker run -d --name melon-pg --network melon-dev \
  -e POSTGRES_USER=melon -e POSTGRES_PASSWORD=melon -e POSTGRES_DB=melon_test postgres:17-alpine

docker run --rm --network melon-dev -v "$PWD:/src" \
  -v melon-cargo:/usr/local/cargo/registry -v melon-target:/target \
  -e CARGO_TARGET_DIR=/target -e MELON_REQUIRE_DB=1 \
  -e MELON_TEST_DATABASE_URL=postgres://melon:melon@melon-pg:5432/melon_test \
  -w /src rust:1-bookworm bash -c \
  "rustup component add clippy rustfmt && cargo fmt --all --check \
   && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace"
```

Die Volumes `melon-cargo` und `melon-target` halten Downloads und Build-Ergebnisse
zwischen den Läufen, ab dem zweiten Lauf geht es deshalb schnell. Unter Git Bash auf
Windows vorher `export MSYS_NO_PATHCONV=1` setzen.

## Rust (lokal installiert)

```sh
cargo test --workspace
```

Ohne `MELON_TEST_DATABASE_URL` werden die End-to-End-Tests übersprungen. Mit
`MELON_REQUIRE_DB=1`, wie in der CI, schlagen sie dann stattdessen fehl. So kann die CI sie
nicht unbemerkt auslassen.

In Debug-Builds werden `argon2` und `blake2` trotzdem optimiert gebaut (siehe
`[profile.dev.package.*]` in `Cargo.toml`), sonst würde jede Schlüsselableitung in den
Tests Sekunden dauern.

## Server lokal starten

```sh
docker build -t melonapp-server:dev .
docker run --rm --network melon-dev -p 8080:8080 \
  -e MELON_DATABASE_URL=postgres://melon:melon@melon-pg:5432/melon_test \
  -e MELON_SERVER_SECRET=local-dev-secret-local-dev-secret-123 \
  -e MELON_ALLOW_REGISTRATION=true melonapp-server:dev
curl localhost:8080/health
```

## Web-App

```sh
bash scripts/build-wasm.sh
npm install
npm run dev -w web
```

Der Dev-Server leitet `/api` an `localhost:8080` weiter. Der Server muss also wie oben
laufen, mit `MELON_ALLOW_REGISTRATION=true`. Tests: `npm test -w web`.

`build-wasm.sh` installiert beim ersten Lauf `wasm-bindgen-cli` in genau der Version aus
`Cargo.lock`. CLI und Bibliothek müssen exakt zusammenpassen.

## Gesamtes System + Browser-Test

So läuft es auch in der CI:

```sh
COMPOSE="docker compose -p melon-e2e --env-file apps/web/e2e/e2e.env -f deploy/docker-compose.yml -f apps/web/e2e/compose.override.yml"
$COMPOSE up -d --build --wait
docker run --rm --network container:melon-e2e-caddy-1 -v "$PWD/apps/web/e2e:/e2e" -v "$PWD/tmp:/out" -w /work \
  mcr.microsoft.com/playwright:v1.65.0-noble \
  bash -c "npm init -y && npm i playwright@1.65.0 && cp /e2e/vault.e2e.mjs . && node vault.e2e.mjs"
```

Die App ist dann unter `http://localhost:18081` erreichbar. Der Test spielt Registrieren,
Einträge anlegen, Suchen, Kopieren, Bearbeiten, Neuladen, falsches Passwort und die
Mobilansicht durch und legt Screenshots in `tmp/` ab. Er läuft über `localhost`, weil
Browser bestimmte APIs nur dort oder unter HTTPS anbieten.

## Fuzzing

`fuzz/` ist ein eigener Cargo-Workspace (nightly, `cargo-fuzz`):

```sh
docker run --rm -v "$PWD:/src" -v melon-cargo:/usr/local/cargo/registry -w /src/fuzz rust:1-bookworm \
  bash -c "rustup toolchain install nightly --profile minimal && cargo install cargo-fuzz --locked && \
           cargo +nightly fuzz run formats -- -max_total_time=60"
```

Ziele: `formats`, `passkey`, `native_session`. Ein Fund liegt danach unter `fuzz/artifacts/<Ziel>/`
und lässt sich mit `cargo +nightly fuzz run <Ziel> <Datei>` nachstellen.

## Doku

Benötigt Node ≥ 22.23.

```sh
npm install
npm run docs:dev
```

Ohne passendes Node geht es auch per Docker:

```sh
docker run --rm -it -p 4321:4321 -v "$PWD:/src" -v melon-node:/src/node_modules -w /src node:22-bookworm \
  bash -c "npm install && npm run dev -w docs -- --host"
```

## Entwicklung auf macOS ohne Docker

Xcode aus dem App Store installieren und einmal öffnen. Danach prüfen:

```sh
xcode-select -p
xcodebuild -version
xcrun simctl list devices available
```

Homebrew installieren, falls es fehlt (Anleitung auf https://brew.sh). Rust ≥ 1.87 mit rustup
verwalten; ein vorhandenes Homebrew-Rust muss nicht entfernt werden. `~/.cargo/bin` muss
für dieses Projekt im Suchpfad vor Homebrew stehen.

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup target add aarch64-apple-darwin x86_64-apple-darwin aarch64-apple-ios aarch64-apple-ios-sim wasm32-unknown-unknown
rustup component add rustfmt clippy
nvm install 22
nvm use 22
npm ci
npm test -w web
```

Die Server-Integrationstests benötigen auch lokal PostgreSQL. Eine eigene Instanz
verhindert Eingriffe in vorhandene Datenbanken:

```sh
brew install postgresql@15
export PATH="$(brew --prefix postgresql@15)/bin:$PATH"
mkdir -p tmp
initdb -D tmp/apple-postgres -A trust
pg_ctl -D tmp/apple-postgres -l "$PWD/tmp/apple-postgres.log" -o '-p 55432 -h 127.0.0.1' start
createdb -h 127.0.0.1 -p 55432 melon_test
export MELON_TEST_DATABASE_URL="postgres://$(whoami)@127.0.0.1:55432/melon_test"
MELON_REQUIRE_DB=1 cargo test --workspace --locked
bash scripts/build-wasm.sh
npm run build -w web
```

Die Trust-Authentifizierung gilt ausschließlich für diese lokale Testinstanz; sie bindet
nur an Loopback. Beenden mit `pg_ctl -D tmp/apple-postgres stop`. Für einen vollständigen
lokalen Server eine eigene Datenbank anlegen und die Variablen aus
[Server-Konfiguration](/melonapp/server/konfiguration/) setzen.


### Signierter macOS-Entwicklungsbuild

Eine vorhandene Apple-Development-Identität aus `security find-identity -v -p codesigning`
verwenden. Der Team-Identifier steht im Zertifikat beziehungsweise in Xcode. Das Skript
prüft das passende macOS-Provisioning-Profil, bettet es ein, erzeugt temporäre
Entitlements für die Data Protection Keychain und prüft die Signatur:

```sh
export APPLE_DEVELOPMENT_TEAM="DEIN_TEAM"
export APPLE_SIGNING_IDENTITY="Apple Development: Dein Name (IDENTITY)"
export APPLE_PROVISIONING_PROFILE="/absoluter/Pfad/zum/macOS-Entwicklungsprofil.provisionprofile"
bash scripts/build-macos-signed.sh
```

Es werden keine Apple-Zugangsdaten gespeichert. Ein solcher Entwicklungsbuild ist
nicht notarisiert und nicht zur öffentlichen Verteilung gedacht. Weitere Argumente gehen
an `tauri build`; der Release-Workflow nutzt dasselbe Skript mit Developer ID und
`--bundles app,dmg` ([Pipelines](/melonapp/betrieb/pipelines/#apple-releases)).

Eine gültige Codesign-Signatur allein genügt für diese Keychain-Entitlements nicht:
ohne passendes eingebettetes Provisioning-Profil kann macOS den Start verweigern.
Der normale `tauri build` bleibt für Passwort-Anmeldung ohne Biometrie nutzbar.

### Browser-End-to-End-Test nativ

Bei laufendem lokalem Server auf Port 8080 und `npm run dev -w web -- --host 127.0.0.1`
in einem zweiten Terminal:

```sh
npm install --prefix tmp/playwright playwright@1.65.0
tmp/playwright/node_modules/.bin/playwright install chromium
cp apps/web/e2e/vault.e2e.mjs tmp/playwright/vault.e2e.mjs
mkdir -p tmp/apple-e2e
BASE=http://127.0.0.1:5173 OUT="$PWD/tmp/apple-e2e" node tmp/playwright/vault.e2e.mjs
```

Dafür eine separate lokale Datenbank und offene Registrierung verwenden. Der Test
legt ausschließlich synthetische Konten und Einträge an; niemals gegen den produktiven
Server laufen lassen. Er prüft unter anderem Teilen, Rotation, Recovery und Mobilansicht.
