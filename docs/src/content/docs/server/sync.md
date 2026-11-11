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

Das Zusammenführen muss der Client übernehmen, weil nur er die Inhalte lesen kann. Plan
für den Passwortmanager: feldweise zusammenführen. Ändern beide Geräte dasselbe Feld,
gewinnt die neuere Änderung, und die ältere landet im Verlauf des Eintrags.

Anlegen (`base_revision: null`) einer schon existierenden ID ist ebenfalls ein `409`.
Der Modulname eines Items lässt sich nicht ändern, weil er Teil der
[AAD](/melonapp/sicherheit/kryptografie/#zusatzdaten-aad) ist.

## Löschen

Ein gelöschtes Item bleibt als **Tombstone** erhalten: `data = NULL`, `deleted = true`,
neue Revision. Würde der Server die Zeile einfach entfernen, bekämen andere Geräte beim
nächsten Sync nichts davon mit und hätten den Eintrag für immer.

Ein Tombstone lässt sich per `PUT` mit seiner Revision als `base_revision` wiederbeleben.

## Offline

Clients halten eine verschlüsselte lokale Kopie aller Items. Lesen und Suchen gehen damit
ohne Netz und sofort. Offline-Änderungen landen in einer Warteschlange und werden mit ihrer
`base_revision` hochgeladen, sobald wieder Netz da ist. Konflikte laufen wie oben beschrieben.
