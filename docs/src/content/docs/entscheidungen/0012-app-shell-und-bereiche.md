---
title: "0012: App-Rahmen, Module und Bereiche"
description: Warum nach dem Anmelden ein Startbildschirm kommt und Teilen über alle Module gilt.
sidebar:
  order: 12
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

MelonApp soll eine App für vieles sein, der Passwortmanager ist nur das erste Modul. Bis M4
landete man nach dem Anmelden direkt im Passwortmanager, und geteilte Behälter hießen „Tresore“.
Das passte zu einem reinen Passwortmanager, nicht zur Vision.

## Entscheidung

### Rahmen und Module

- Nach dem Anmelden kommt ein **Startbildschirm** mit den Modulen, den Bereichen und Hinweisen
  zum Konto.
- Anmeldung, Konto, Sperren, Sync und Bereiche gehören dem **App-Rahmen** (`Shell`). Module
  bekommen davon nur, was sie brauchen.
- Ein **Modul** ist ein Eintrag in `apps/web/src/modules/registry.ts`: Name, Symbol, Route und
  die Eintragstypen, die es anzeigt. Der Passwortmanager ist das Modul `passwords` mit den Typen
  Login, Notiz, Kreditkarte, Identität und WLAN.
- Module teilen sich einen Sync. Jedes Modul filtert die Einträge nach seinen Typen. Einträge
  unbekannter Typen, etwa von einem neueren Modul, lässt es einfach liegen.

### Bereiche

- Ein **Bereich** („Persönlich“, „Familie“) ist ein geteilter, verschlüsselter Behälter für
  **alle** Module. Mitglieder und Rollen gelten für alles im Bereich: Wer im Bereich „Familie“
  ist, sieht dort Passwörter und später auch den Kalender.
- Wer etwas nur mit einem Teil der Leute teilen will, legt einen zweiten Bereich an, etwa
  „Familie“ und „Eltern – Passwörter“.
- **Benennung:** In Oberfläche und Doku heißt es „Bereich“. In Code, API und Datenbank bleibt
  es `vault`, ebenso in den Krypto-Kontexten (`melon/v2/vault-key` …). Ein Umbenennen dort hätte
  alle Chiffretexte ungültig gemacht, ohne etwas zu verbessern.

## Alternativen

- **Teilen pro Modul:** feiner steuerbar, aber jede Familie müsste jedes Modul einzeln teilen,
  mit eigener Mitgliederliste und eigenem Schlüssel. Für den Anwendungsfall zu umständlich.
- **Startbildschirm weglassen, Module als Tabs:** schneller zum Passwortmanager, aber ohne Ort
  für Bereiche, Konto und künftige Module.

## Folgen

- Neue Module brauchen weiterhin keine Server-Änderung: neuer Eintragstyp, Eintrag in der
  Registry, eigene Ansicht.
- Der Server kann Inhalte nicht lesen. Module, die zeitgesteuert etwas tun sollen (etwa
  Kalender-Erinnerungen), müssen das auf dem Gerät erledigen.
