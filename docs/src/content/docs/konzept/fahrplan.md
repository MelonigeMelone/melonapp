---
title: Fahrplan
description: Meilensteine von MelonApp.
sidebar:
  order: 4
---

| Meilenstein | Inhalt | Status |
|---|---|---|
| **M1 – Fundament** | Krypto-Kern, Server (Auth, Sitzungen, Sync), Docker, CI- und Sicherheits-Pipelines, Doku | ✅ fertig |
| **M2 – Web-App** | React-App, Krypto via WASM im Worker, Tresor anzeigen/anlegen/bearbeiten/löschen, Suche, Generator, Passwort-Verlauf, Auto-Lock, E2E-Test | ✅ fertig |
| M2b – Konto absichern | Recovery-Key (Notfall-Kit), Master-Passwort ändern | als Nächstes |
| M3 – Desktop | Tauri-App für Windows/Mac, lokaler verschlüsselter Cache, Hotkey, Windows Hello/Touch ID | geplant |
| M4 – Browser-Erweiterung | Autofill, Speichern-Dialog, Generator | geplant |
| M5 – iOS | Tauri-iOS-App + Credential Provider Extension, Face ID, Passkeys | geplant |
| M6 – Module | TOTP, Notizen, Teilen mit Familie, Import/Export | geplant |
| M7 – Android | Tauri-Android + Autofill Service | später |

:::caution
Bis M2b fertig ist, gibt es keine Wiederherstellung. Wer sein Master-Passwort vergisst,
verliert den Tresor. Echte Passwörter also erst danach umziehen.
:::
