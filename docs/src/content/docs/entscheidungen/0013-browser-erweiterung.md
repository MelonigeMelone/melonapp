---
title: "0013: Browser-Erweiterung"
description: Wie die Erweiterung entsperrt bleibt, warum nur per Klick ausgefüllt wird und was das kostet.
sidebar:
  order: 13
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Die Erweiterung soll Logins auf Websites ausfüllen und neue speichern, in Chromium-Browsern
(inklusive Opera GX) und Firefox. Manifest V3 beendet Hintergrund-Prozesse und Popups nach kurzer
Zeit. Ein Entsperren mit Master-Passwort bei jedem Klick wäre unbenutzbar.

## Entscheidung

1. **Schnappschuss in `storage.session`:** Nach dem Entsperren liegen dort entschlüsselte Logins,
   Sitzungs-Token und die Bereichs-Schlüssel als Rohbytes. Die Schlüssel verlassen dafür den WASM-Speicher
   (`VaultKey.exportRaw`). Das gibt es nur in der Erweiterung.
2. **Ausfüllen nur nach Klick** auf das Symbol im Feld oder im Popup. Nie automatisch.
3. **Adresse vom Browser:** Treffer und Zugangsdaten gibt der Hintergrund nur für die Adresse heraus,
   die der Browser für den Tab meldet.
4. **Speichern über das Popup:** Nach dem Absenden merkt sich der Hintergrund den Login, das Symbol
   zeigt eine 1. Gespeichert wird im Popup mit dem normalen Sync.
5. **Generator in TypeScript** (`crypto.getRandomValues`, Rejection Sampling, jede Zeichenklasse
   mindestens einmal), weil der Hintergrund kein WASM lädt.

## Alternativen

- **Schlüssel nur im WASM-Speicher eines Offscreen-Dokuments:** sicherer gegen Speicher-Auslesen, aber
  nur in Chrome verfügbar, nicht in Firefox. Kommt eventuell später für Chromium.
- **Bei jedem Öffnen neu entsperren:** maximal sicher, praktisch unbenutzbar.
- **Automatisches Ausfüllen beim Laden** (wie früher üblich): bequemer, aber genau das nutzen Angriffe
  mit unsichtbaren Formularen aus.
- **Speicher-Dialog direkt in der Seite:** wie bei 1Password, kommt später. Ein Dialog in fremden
  Seiten braucht mehr Abwehr gegen Clickjacking.

## Folgen

- **Gleiche Vertrauensstufe wie der entsperrte Zustand jedes Passwortmanagers:** Wer den laufenden
  Browser-Prozess auslesen kann, kommt an die Daten. Gegen Websites, andere Erweiterungen und
  Festplatten-Zugriff schützt `storage.session` (nur im Speicher, nur für eigene Seiten).
- Auto-Lock nach 30 Minuten ohne Nutzung und beim Schließen des Browsers.
- Die Zwischenablage wird im Popup nicht automatisch geleert, weil das Popup dafür zu kurz lebt.
  Ausfüllen ist deshalb der empfohlene Weg.
- Der Generator existiert zweimal (Rust und TypeScript). Beide sind getestet. Schlüssel erzeugt der
  TypeScript-Generator nie.
