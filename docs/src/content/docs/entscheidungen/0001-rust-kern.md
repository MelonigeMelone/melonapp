---
title: "0001: Rust für Krypto-Kern und Server"
description: Warum Kryptografie und Server in Rust geschrieben sind.
sidebar:
  order: 1
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Der Passwortmanager muss auf Windows, macOS, iOS, im Browser und später auf Android
**dieselbe** Kryptografie ausführen. Zwei Implementierungen, die sich minimal
unterscheiden, sind ein klassischer Fehler. Gefordert sind außerdem Sicherheit und
Geschwindigkeit. Persönlich bevorzugt ist JavaScript/TypeScript.

## Entscheidung

- Die Kryptografie liegt in **einer Rust-Crate** (`melon-crypto`). Sie läuft nativ in
  Tauri, iOS und Android und als WASM in Web und Erweiterung.
- Der Server ist ebenfalls in Rust geschrieben (axum, sqlx, PostgreSQL). Er nutzt
  `melon-crypto`, um Formate zu prüfen (KDF-Grenzen, `EncString`).
- Die Oberflächen bleiben in TypeScript.

## Alternativen

- **Alles in TypeScript** (WebCrypto + Node-Server): kein Argon2 in WebCrypto, auf iOS
  native Extensions nötig, mehr Laufzeitfehler-Risiko.
- **Go-Server:** ebenfalls schnell, aber zwei Sprachen für den Kern statt einer.

## Folgen

- Speichersicherheit ohne Garbage Collector, `unsafe` ist verboten.
- Der Server-Container ist klein (≈ 43 MB) und braucht wenig RAM.
- Rust hat eine Lernkurve. TypeScript-Entwickler arbeiten hauptsächlich in `apps/`.
