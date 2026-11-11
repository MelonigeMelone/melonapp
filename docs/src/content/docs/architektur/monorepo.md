---
title: Monorepo
description: Aufbau des Repositories und wo neuer Code hingehört.
sidebar:
  order: 2
---

```text
melonapp/
├── crates/                Rust (Cargo-Workspace)
│   ├── melon-crypto/      gesamte Kryptografie, nativ + WASM
│   ├── melon-wasm/        JS-Bindings von melon-crypto (wasm-bindgen)
│   └── melon-server/      Sync-Server
│       ├── migrations/    SQL-Migrationen (sqlx)
│       └── tests/         End-to-End-Tests gegen echtes PostgreSQL
├── apps/
│   └── web/               Web-App (React), Dockerfile, E2E-Test
├── packages/
│   └── melon-wasm/        npm-Paket mit dem gebauten WASM (pkg/ wird generiert)
├── scripts/build-wasm.sh  baut melon-wasm und erzeugt die JS-Bindings
├── docs/                  diese Doku (Starlight)
├── deploy/                Docker Compose + Caddy für den eigenen Server
├── .github/               CI-, Sicherheits-, Image- und Doku-Pipelines
├── Cargo.toml             Rust-Workspace
└── package.json           npm-Workspaces
```

## Zwei Workspaces

- **Cargo** für alles in Rust. Gemeinsame Version, Edition und Lints stehen in der
  Wurzel-`Cargo.toml`. `unsafe` ist für den ganzen Workspace verboten.
- **npm** für alles in JavaScript/TypeScript (`docs`, `apps/*`, `packages/*`).
  Benötigt Node ≥ 22.23 (siehe `.nvmrc`).

## Wo kommt neuer Code hin?

| Ich will … | Ort |
|---|---|
| etwas ver- oder entschlüsseln, Schlüssel ableiten | `crates/melon-crypto` |
| einen neuen API-Endpunkt | `crates/melon-server/src`, dazu ein Test in `tests/api.rs` |
| eine Tabelle ändern | neue Datei in `crates/melon-server/migrations/`. Bestehende Migrationen nie ändern. |
| eine Krypto-Funktion im Browser nutzen | in `melon-wasm` exportieren, im Worker (`apps/web/src/crypto/worker.ts`) anbieten |
| ein neues Modul (z. B. TOTP) | nur Client-Code in `apps/` bzw. `packages/` |
| erklären, warum etwas so ist | hier in `docs/` |
