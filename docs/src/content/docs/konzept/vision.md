---
title: Vision & Ziele
description: Was MelonApp ist, was es nicht sein soll und woran es sich messen lässt.
sidebar:
  order: 1
---

MelonApp ist **eine persönliche App für alles, was einem im Alltag fehlt**. Es gibt einen
gemeinsamen Rahmen (Konto, Geräte, Sync, Sicherheit), in den **Module** eingesteckt werden.
Das erste Modul ist ein [Passwortmanager](/melonapp/konzept/passwortmanager/).

## Ziele

- **Sicher:** Der Server sieht nie Klartext. Wer den Server komplett übernimmt, bekommt
  nur verschlüsselte Daten.
- **Schnell:** App-Start und Entsperren unter 1 s. Suche fühlt sich sofort an, weil sie
  lokal läuft.
- **Überall:** Windows, macOS, iPhone und Web aus einer Codebasis, dazu eine
  Browser-Erweiterung. Android folgt später.
- **Erweiterbar:** Neue Module brauchen keine Server-Änderung.
- **Unabhängig:** Kein Abo. Läuft auf einem eigenen Server für ein paar Euro im Monat.

## Nicht-Ziele (vorerst)

- Kein Multi-Mandanten-SaaS für Fremde. Gedacht ist es für dich, Familie und Freunde.
- Keine eigene Kryptografie. Es kommen nur geprüfte Bausteine zum Einsatz.
- Android erst nach iOS.

## Anti-Ziele

Diese Punkte würden das Projekt scheitern lassen, auch wenn es technisch funktioniert:

- Passwörter oder Schlüssel liegen irgendwo im Klartext: Server, Logs, Crash-Reports.
- Man sperrt sich aus und verliert alles, weil es keine Wiederherstellung gibt.
- Autofill ist so umständlich, dass man doch wieder den Apple-Schlüsselbund nutzt.
