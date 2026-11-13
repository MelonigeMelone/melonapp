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
4. **Speichern über eine Karte auf der Seite:** Nach dem Absenden merkt sich der Hintergrund den
   Login. Auf derselben Domain blendet das Content-Script eine **Erweiterungsseite als iframe** ein
   (`save.html`), die mit dem normalen Sync speichert. Die Karte fragt nie nach dem Master-Passwort.
   Ist MelonApp gesperrt, verweist sie auf das Symbol in der Leiste.
5. **Generator in TypeScript** (`crypto.getRandomValues`, Rejection Sampling, jede Zeichenklasse
   mindestens einmal), weil der Hintergrund kein WASM lädt.

## Alternativen

- **Schlüssel nur im WASM-Speicher eines Offscreen-Dokuments:** sicherer gegen Speicher-Auslesen, aber
  nur in Chrome verfügbar, nicht in Firefox. Kommt eventuell später für Chromium.
- **Bei jedem Öffnen neu entsperren:** maximal sicher, praktisch unbenutzbar.
- **Automatisches Ausfüllen beim Laden** (wie früher üblich): bequemer, aber genau das nutzen Angriffe
  mit unsichtbaren Formularen aus.
- **Speicher-Dialog als HTML direkt in der Seite** (statt iframe): Die Website könnte ihn lesen,
  verändern oder Klicks fälschen.
- **Entsperren in der Karte:** bequemer, aber genau so würde eine nachgebaute Karte das
  Master-Passwort abgreifen. Deshalb bleibt Entsperren dem Popup in der Browserleiste vorbehalten,
  an das keine Website herankommt.

## Folgen

- **Gleiche Vertrauensstufe wie der entsperrte Zustand jedes Passwortmanagers:** Wer den laufenden
  Browser-Prozess auslesen kann, kommt an die Daten. Gegen Websites, andere Erweiterungen und
  Festplatten-Zugriff schützt `storage.session` (nur im Speicher, nur für eigene Seiten).
- Auto-Lock nach 30 Minuten ohne Nutzung und beim Schließen des Browsers.
- Eine Website könnte die Karte überdecken und so einen Klick auf „Speichern“ oder „Aktualisieren“ erzwingen.
  Weil nur selbst eingegebene Passwörter einen Vorschlag auslösen und die Knöpfe erst nach 600 ms
  Sichtbarkeit reagieren, landet so höchstens das Passwort im Tresor, das man gerade selbst getippt hat.
  Nichts wird preisgegeben.
- Die Zwischenablage wird im Popup nicht automatisch geleert, weil das Popup dafür zu kurz lebt.
  Ausfüllen ist deshalb der empfohlene Weg.
- Der Generator existiert zweimal (Rust und TypeScript). Beide sind getestet. Schlüssel erzeugt der
  TypeScript-Generator nie.
