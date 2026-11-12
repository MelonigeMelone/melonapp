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
| [M5 – Desktop](https://github.com/MelonigeMelone/melonapp/milestone/1) | macOS: Tauri mit nativer Krypto, verschlüsselter Cache, Hotkey und Keychain/Touch ID; Windows bleibt offen | macOS-Build und Start geprüft; Hardware-Abnahme offen |
| **M6 – Browser-Erweiterung** | Chromium (Chrome, Edge, Brave, Opera GX) und Firefox: Ausfüllen per Klick, Speichern, Generator, Auto-Lock ([Details](/melonapp/clients/erweiterung/)) | ✅ fertig |
| [M7 – iOS](https://github.com/MelonigeMelone/melonapp/milestone/2) | Tauri-iOS-App, Face-ID-Keychain, Credential Provider Extension und gerätelokale Passkeys; Safari-Erweiterung bleibt offen | Simulator-Build und Start geprüft; Geräte-/AutoFill-Abnahme offen |
| **M8a – 2FA und Sicherheits-Check** | 2FA-Codes in Web-App und Erweiterung (auch per QR-Bild), Stärke-Anzeige, schwache und mehrfach verwendete Passwörter, Datenleck-Abgleich auf Knopfdruck ([ADR 0014](/melonapp/entscheidungen/0014-2fa-und-sicherheits-check/)) | ✅ fertig |
| [M8 – Mehr](https://github.com/MelonigeMelone/melonapp/milestone/3) | Personengruppen, eigene Symbole, Anhänge, Export | geplant |
| [M9 – Android](https://github.com/MelonigeMelone/melonapp/milestone/4) | Tauri-Android + Autofill Service | später |

Was in einem Meilenstein noch fehlt, steht in seinem
[Milestone](https://github.com/MelonigeMelone/melonapp/milestones). Die Härtung vor dem
Umzug echter Passwörter sammelt [„Vor dem echten Einsatz“](https://github.com/MelonigeMelone/melonapp/milestone/5).

:::tip
Seit M4 gibt es das Notfall-Kit. Erstelle es direkt nach der Registrierung, dann kannst du echte
Passwörter umziehen. Vor dem Umzug sensibler Daten bleibt ein externes Krypto-Review sinnvoll
([Offene Punkte](/melonapp/sicherheit/offene-punkte/)).
:::
