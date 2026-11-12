---
title: "0024: Apple-Apps über Developer ID und TestFlight verteilen"
description: Die Mac-App wird notarisiert als DMG verteilt, die iOS-App über TestFlight; beide baut ein eigener Release-Workflow mit geschützten Secrets.
---

**Status:** angenommen · **Datum:** 2026-11-12

## Kontext

Bisher liefen die Apple-Apps nur als Entwicklungsbuilds aus Xcode oder per Kabel. Für
den Alltag braucht es Builds, die ohne Xcode installiert werden und sich aktualisieren
lassen. Signierschlüssel und App-Store-Connect-Zugang sind dabei die wertvollsten
Geheimnisse der Lieferkette: Wer sie hat, kann eine manipulierte App als echte ausgeben.

## Entscheidung

- **macOS:** Signatur mit „Developer ID Application“, eingebettetes Developer-ID-
  Provisioning-Profil (nötig für die Data Protection Keychain), Notarisierung und
  Stapling durch Apple, Verteilung als DMG im GitHub-Release. Kein Mac App Store.
- **iOS:** Signatur mit „Apple Distribution“, Profile verwaltet Xcode automatisch über
  den App-Store-Connect-API-Schlüssel, Upload nach TestFlight.
- `apple-release.yml` läuft nur bei Versions-Tags `v*` und manuell, analog zu
  [ADR 0020](/melonapp/entscheidungen/0020-deploy-per-tag/). Der Tag muss der Version in
  `tauri.conf.json` entsprechen, die iOS-Build-Nummer ist die Laufnummer des Workflows.
- Alle Apple-Secrets liegen im GitHub-Environment `apple-release`, das nur `main` und
  Tags `v*` verwenden dürfen. Pull Requests und Forks sehen sie nicht. Zertifikate
  landen nur in einem temporären Schlüsselbund des Runners und werden danach gelöscht.
- Der API-Schlüssel hat die Rolle „App Manager“, nicht „Admin“.

## Alternativen

- **Mac App Store:** erfordert App Sandbox und Review; der globale Hotkey und der
  freie Serverzugriff müssten angepasst werden. Für eine persönliche App unnötig.
- **Lokal signieren und hochladen:** kein reproduzierbarer Weg, Schlüssel lägen
  dauerhaft auf einem Arbeitsrechner, jede Version hinge an einer Person.
- **fastlane match:** zusätzliches Repo und Werkzeug für ein einzelnes Team ohne Nutzen.

## Folgen

Neue Versionen entstehen durch Hochzählen der Version und einen Tag. Ein kompromittiertes
Environment oder Workflow auf `main` kann Apple-signierte Builds erzeugen; deshalb gelten
für Änderungen an `apple-release.yml` dieselben Review-Regeln wie für Krypto-Code. Ein
abgelaufenes Zertifikat oder Profil lässt nur den Release-Workflow scheitern, nicht die
installierten Apps. Die Ablaufdaten von Zertifikaten und Profil stehen unter
[Pipelines](/melonapp/betrieb/pipelines/#apple-releases); vorher neu erzeugen und im
Environment ersetzen.
