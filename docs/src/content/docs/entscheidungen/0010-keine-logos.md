---
title: "0010: Keine Logos von Websites"
description: Warum Einträge Anfangsbuchstaben statt geladener Logos zeigen.
sidebar:
  order: 10
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Viele Passwortmanager zeigen zu jedem Eintrag das Logo der Website. Dafür muss irgendwer
das Logo von außen holen. Geprüft wurden drei Wege:

| Weg | Wer erfährt, welche Konten du hast? |
|---|---|
| Browser lädt direkt von der Website | jede einzelne Website, und deine IP-Adresse dazu |
| Dienst eines Dritten (Google, DuckDuckGo, Icon-CDN) | dieser Dritte, für alle Einträge |
| eigener Server lädt und speichert zwischen | dein Server. Außerdem holt dein Server Adressen aus dem Internet ab (SSRF-Angriffsfläche). |

## Entscheidung

**Keine Logos von außen.** Einträge zeigen einen farbigen Anfangsbuchstaben. Später lässt sich
pro Eintrag ein eigenes Symbol oder eine Farbe wählen. Das liegt im verschlüsselten Eintrag.

## Folgen

- Weder Dritte noch der eigene Server erfahren, zu welchen Websites Einträge existieren.
- Der Server stellt nie selbst Verbindungen ins Internet her. Keine SSRF-Angriffsfläche.
- Optisch schlichter als 1Password. Ausgleich durch eigene Symbole und Farben.
