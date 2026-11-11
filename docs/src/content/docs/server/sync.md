---
title: Sync
description: Wie Geräte über Revisionen, Konflikterkennung und Tombstones synchron bleiben.
sidebar:
  order: 3
---

## Ablauf

1. `GET /vaults` liefert alle Tresore, in denen man Mitglied ist, mit Mitgliedern und der
   eigenen Kopie des Tresor-Schlüssels. Ein Tresor, der fehlt, wurde gelöscht oder man wurde
   entfernt. Die App verwirft ihn dann lokal.
2. Für jeden Tresor mit Schlüssel: `GET /vaults/{id}/items?since=<letzte Revision dieses Tresors>`.

## Revisionen

Jede Änderung an einem Tresor, einem Mitglied oder einem Eintrag zieht eine neue Nummer aus
der globalen Sequenz `revision_seq`. Lücken sind egal, weil nur „größer als“ zählt.

Hat ein Tresor einen **neuen Schlüssel** bekommen (`key_version` gestiegen), lädt die App ihn
komplett neu ab Revision 0, weil alle Einträge neu verschlüsselt wurden.

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

**Veralteter Schlüssel:** Wurde der Tresor-Schlüssel inzwischen gewechselt, antwortet der Server
mit `409 key_rotated`. Die App wiederholt dann nicht blind, sondern synchronisiert zuerst. Der
Eintrag wird nie mit einem Schlüssel gespeichert, den die übrigen Mitglieder nicht mehr haben.

**Verschieben** zwischen Tresoren ist „im Ziel neu anlegen, im Quell-Tresor löschen“, weil die
Tresor-ID Teil der [AAD](/melonapp/sicherheit/kryptografie/#zusatzdaten-aad) ist.

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
