---
title: "0003: Abgeleiteter Auth-Key statt OPAQUE"
description: Wie sich Clients beim Server anmelden, ohne das Passwort zu verraten.
sidebar:
  order: 3
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Der Server darf das Master-Passwort nie sehen und daraus auch nichts ableiten können,
was zum Entschlüsseln reicht.

## Entscheidung

Der Client leitet per Argon2id einen Master-Key ab. Per HKDF entstehen daraus ein
**Auth-Key** für den Server und ein **Wrap-Key**, der lokal bleibt
([Details](/melonapp/sicherheit/modell/)). Der Server hasht den Auth-Key erneut mit Argon2id.
Das Verfahren ist erprobt und entspricht im Kern dem von Bitwarden.

## Alternativen

- **OPAQUE (aPAKE):** Der Server sieht nicht einmal einen Hash-Vorläufer und ist resistenter
  gegen Vorab-Berechnung. Dafür ist es deutlich komplexer und hat weniger ausgereifte
  Implementierungen auf allen Zielplattformen.
- **SRP:** veraltet und fehleranfällig.

## Folgen

- Einfach zu implementieren und zu prüfen.
- Wer die Datenbank klaut, kann offline raten, muss dafür aber pro Versuch eine volle
  Argon2id-Ableitung mit 64 MiB bezahlen. Ein starkes Master-Passwort bleibt deshalb Pflicht.
- Ein späterer Wechsel zu OPAQUE ist möglich: Das Login-Verfahren lässt sich austauschen,
  ohne den Vault neu zu verschlüsseln.
