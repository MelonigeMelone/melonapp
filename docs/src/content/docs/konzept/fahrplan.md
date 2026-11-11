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
| **M4 – Konto absichern** | Recovery-Key (Notfall-Kit), Master-Passwort ändern, Sicherheitscode für geteilte Schlüssel | ✅ fertig |
| **M4b – App-Rahmen** | Startbildschirm, Module als Unterbereiche, „Bereiche“ gelten für alle Module ([ADR 0012](/melonapp/entscheidungen/0012-app-shell-und-bereiche/)) | ✅ fertig |
| **M4c – Import** | Apple Passwörter, 1Password (1PUX/CSV), Chrome, Firefox, Bitwarden, mit Vorschau und Erkennung von Doppelten | ✅ fertig |
| M5 – Desktop | Tauri-App für Windows/Mac, lokaler verschlüsselter Cache, Hotkey, Windows Hello/Touch ID | geplant |
| **M6 – Browser-Erweiterung** | Chromium (Chrome, Edge, Brave, Opera GX) und Firefox: Ausfüllen per Klick, Speichern, Generator, Auto-Lock ([Details](/melonapp/clients/erweiterung/)) | ✅ fertig |
| M7 – iOS | Tauri-iOS-App + Credential Provider Extension, Face ID, Passkeys, Safari-Erweiterung | als Nächstes |
| M8 – Mehr | Personengruppen, eigene Symbole, 2FA-Codes, Sicherheits-Check, Anhänge, Export | geplant |
| M9 – Android | Tauri-Android + Autofill Service | später |

:::tip
Seit M4 gibt es das Notfall-Kit. Erstelle es direkt nach der Registrierung, dann kannst du echte
Passwörter umziehen. Vor dem Umzug sensibler Daten bleibt ein externes Krypto-Review sinnvoll
([Offene Punkte](/melonapp/sicherheit/offene-punkte/)).
:::
