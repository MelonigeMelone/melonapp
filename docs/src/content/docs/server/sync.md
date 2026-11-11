---
title: Sync
description: Wie Geräte über Revisionen, Konflikterkennung und Tombstones synchron bleiben.
sidebar:
  order: 3
---

## Revisionen

Jede Änderung an irgendeinem Item zieht eine neue Nummer aus der globalen Sequenz
`item_revision_seq`. Jedes Gerät merkt sich die höchste Revision, die es kennt, und fragt nur
danach:

```text
GET /vault/items?since=<letzte bekannte Revision>
```

Eine globale Sequenz statt eines Zählers pro Nutzer ist einfacher und braucht keine
Sperren. Lücken in der Nummernfolge sind egal, weil nur „größer als“ zählt.

## Konflikte (Optimistic Concurrency)

Beim Ändern schickt der Client die Revision mit, auf der seine Änderung basiert (`base_revision`):

- Stimmt sie mit dem Stand in der Datenbank überein, wird gespeichert und die neue Revision
  zurückgegeben.
- Stimmt sie nicht, weil ein anderes Gerät inzwischen geändert hat, antwortet der Server mit
  `409 revision_mismatch`. Der Client synchronisiert, führt beide Stände zusammen und
  versucht es erneut.

Das Zusammenführen muss der Client übernehmen, weil nur er die Inhalte lesen kann. Die
Web-App lässt die gerade gespeicherte Änderung gewinnen und legt das Passwort der anderen
Seite im Verlauf ab ([Details](/melonapp/clients/web/#konflikte)).

Anlegen (`base_revision: null`) einer schon existierenden ID ist ebenfalls ein `409`.
Der Modulname eines Items lässt sich nicht ändern, weil er Teil der
[AAD](/melonapp/sicherheit/kryptografie/#zusatzdaten-aad) ist.

## Löschen

Ein gelöschtes Item bleibt als **Tombstone** erhalten: `data = NULL`, `deleted = true`,
neue Revision. Würde der Server die Zeile einfach entfernen, bekämen andere Geräte beim
nächsten Sync nichts davon mit und hätten den Eintrag für immer.

Ein Tombstone lässt sich per `PUT` mit seiner Revision als `base_revision` wiederbeleben.

## Offline

Die Web-App hält die Einträge nur im Speicher. Die Desktop-App (M3) bekommt eine
verschlüsselte lokale Kopie aller Items, damit Lesen und Suchen ohne Netz und sofort gehen.
Dort landen Offline-Änderungen in einer Warteschlange und werden mit ihrer
`base_revision` hochgeladen, sobald wieder Netz da ist. Konflikte laufen wie oben beschrieben.
