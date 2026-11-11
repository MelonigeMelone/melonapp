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
