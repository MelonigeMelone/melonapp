---
title: "0025: Safari-Erweiterung nur auf dem Mac, eingebettet in die Mac-App"
description: Die vorhandene Browser-Erweiterung läuft als Safari Web Extension in MelonApp.app; auf dem iPhone deckt der AutoFill-Anbieter Safari ab.
---

**Status:** angenommen · **Datum:** 2026-11-13

## Kontext

Safari akzeptiert Web-Erweiterungen nur in einer nativen App. Auf dem iPhone füllt der
AutoFill-Anbieter ([ADR 0016](/melonapp/entscheidungen/0016-ios-autofill-und-passkeys/)) bereits
Passwörter und Passkeys in Safari und allen Apps. Auf dem Mac gab es für Safari dagegen keine
Möglichkeit zum Ausfüllen, während Chromium und Firefox die Erweiterung aus M6 nutzen.

## Entscheidung

- Dieselbe Erweiterung wie für Chromium und Firefox, mit eigenem Safari-Manifest
  (`build/safari`): Hintergrund als Service Worker, ohne `use_dynamic_url`, ab Safari 18.
- Verpackt als App-Extension `de.melonigemelone.app.safari` (`apps/desktop/apple/Safari`,
  XcodeGen), sandboxed, mit leerem nativen Handler: Die Erweiterung spricht wie in anderen
  Browsern direkt mit dem Server und nicht mit der Mac-App.
- Eingebettet unter `MelonApp.app/Contents/PlugIns/` und mit Developer ID signiert, notarisiert
  mit der App ([ADR 0024](/melonapp/entscheidungen/0024-apple-verteilung/)).
- Keine Safari-Erweiterung für iOS.

## Alternativen

- **iOS-Erweiterung zusätzlich:** brächte nur Popup und Speicher-Karte, dafür strengere
  Speichergrenzen für Argon2 und eine weitere App-ID mit Profilen.
- **macOS-AutoFill-Anbieter:** würde auch native Mac-Apps abdecken, aber ohne Popup,
  Speicher-Karte und Generator und mit anderer Bedienung als in Chrome.

## Folgen

Safari auf dem Mac verhält sich wie Chrome. Die Extension braucht weder Provisioning-Profil
noch App Group, weil sie nur die Sandbox-Berechtigung hat. Sie hat einen eigenen
Schnappschuss in `storage.session`; die Anmeldung in der Mac-App gilt dort nicht. Safari kennt
kein `trackVisibility`, es gelten dieselben Ersatzprüfungen wie in Firefox.
