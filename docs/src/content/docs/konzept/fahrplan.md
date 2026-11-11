---
title: Fahrplan
description: Meilensteine von MelonApp.
sidebar:
  order: 5
---

| Meilenstein | Inhalt | Status |
|---|---|---|
| **M1 – Fundament** | Krypto-Kern, Server (Auth, Sitzungen, Sync), Docker, CI- und Sicherheits-Pipelines, Doku | ✅ fertig |
| **M2 – Web-App** | React + MUI, Krypto im Web Worker, Einträge, Suche, Generator, Passwort-Verlauf, Auto-Lock, E2E-Test | ✅ fertig |
| **M3 – Tresore & Teilen** | persönlicher und geteilte Tresore mit eigenen Schlüsseln, Rollen (Besitzer/Bearbeiter/Betrachter), Einladungslinks, Schlüsselwechsel beim Entfernen, Eintragstypen, eigene Felder ([Konzept](/melonapp/konzept/tresore/)) | ✅ fertig |
| M4 – Konto absichern | Recovery-Key (Notfall-Kit), Master-Passwort ändern, Fingerabdruck-Vergleich für geteilte Schlüssel | als Nächstes |
| M5 – Desktop | Tauri-App für Windows/Mac, lokaler verschlüsselter Cache, Hotkey, Windows Hello/Touch ID | geplant |
| M6 – Browser-Erweiterung | Autofill, Speichern-Dialog, Generator | geplant |
| M7 – iOS | Tauri-iOS-App + Credential Provider Extension, Face ID, Passkeys | geplant |
| M8 – Mehr | Personengruppen, eigene Symbole, 2FA-Codes, Sicherheits-Check, Anhänge, Import/Export | geplant |
| M9 – Android | Tauri-Android + Autofill Service | später |

:::caution
Bis M4 fertig ist, gibt es keine Wiederherstellung. Wer sein Master-Passwort vergisst,
verliert den Tresor. Echte Passwörter also erst danach umziehen.
:::
