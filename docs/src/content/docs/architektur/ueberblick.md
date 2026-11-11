---
title: Überblick
description: Die Bausteine von MelonApp und wie sie zusammenspielen.
sidebar:
  order: 1
---

```text
┌─────────────────────────── Clients ───────────────────────────┐
│ Desktop (Win/Mac)   iOS (+AutoFill-Ext.)   Web   Browser-Ext. │
│        └──── Tauri 2 + React/TS ────┘        │        │       │
│                      │                       │        │       │
│            melon-crypto (Rust) ── nativ ──┘ WASM ─────┘       │
│            Ver-/Entschlüsselung NUR hier                      │
└──────────────────────────────┬────────────────────────────────┘
                               │ HTTPS (nur Chiffretext)
┌──────────────────────────────▼────────────────────────────────┐
│ Caddy (TLS) → melon-server (Rust/axum) → PostgreSQL           │
│ Konten, Sitzungen, verschlüsselte Items, Sync                 │
└───────────────────────────────────────────────────────────────┘
```

## Bausteine

| Teil | Technik | Ort | Status |
|---|---|---|---|
| Krypto-Kern | Rust | `crates/melon-crypto` | ✅ |
| Sync-Server | Rust, axum, PostgreSQL | `crates/melon-server` | ✅ |
| WASM-Brücke | wasm-bindgen | `crates/melon-wasm` → `packages/melon-wasm` | ✅ |
| Web-App | React + TypeScript + MUI, Krypto im Web Worker | `apps/web` | ✅ |
| Desktop & iOS | Tauri 2 mit derselben React-UI | `apps/desktop` | M3 / M5 |
| Browser-Erweiterung | WebExtension (MV3), React + MUI, Chromium (auch Opera GX) und Firefox | `apps/extension` | ✅ |
| iOS-AutoFill | Swift Credential Provider Extension, ruft `melon-crypto` über UniFFI | `apps/desktop/src-tauri/gen/apple` | M5 |
| Doku | Starlight (Astro) | `docs` | ✅ |

Warum diese Technik gewählt wurde, steht in den [Entscheidungen](/melonapp/entscheidungen/).

## Begriffe

| Oberfläche | Code und API | Bedeutung |
|---|---|---|
| Bereich | `vault` | verschlüsselter, teilbarer Behälter für alle Module |
| Eintrag | `item` | ein Objekt in einem Bereich, Typ steht verschlüsselt darin |
| Modul | `modules/registry.ts` | eine Ansicht auf bestimmte Eintragstypen |

## Grundprinzip: dummer Server

Der Server speichert Konten, Sitzungen und undurchsichtige Items. Er kann nichts
entschlüsseln. Deshalb liegt jede Logik, die Inhalte versteht (Suche, Anzeige,
Konfliktauflösung beim Zusammenführen), im Client. Der Server prüft nur:

- ob die Anfrage von einer gültigen Sitzung kommt,
- ob die Daten formal gültig sind (Format, Größe, Modulname),
- ob die Revision passt ([Sync](/melonapp/server/sync/)).
