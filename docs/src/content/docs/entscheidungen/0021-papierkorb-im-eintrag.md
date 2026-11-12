---
title: "0021: Papierkorb als verschlüsselte Markierung im Eintrag"
description: Gelöschte Einträge bleiben normale Einträge mit verschlüsseltem trashedAt, der Server weiß nichts vom Papierkorb.
---

**Status:** angenommen · **Datum:** 2026-11-12

## Kontext

Bisher war Löschen endgültig: Der Server setzte `deleted` und leerte `data`. Ein versehentlich
gelöschtes Passwort war weg, auch für alle anderen Mitglieder eines geteilten Bereichs. Ein
Papierkorb muss den Chiffretext bis zum endgültigen Löschen behalten, beim Schlüsselwechsel
mitnehmen und dieselben Rechte beachten wie Bearbeiten.

## Entscheidung

- **„In den Papierkorb“ ist eine normale Änderung.** Der Eintrag bekommt im verschlüsselten
  JSON `trashedAt` (ISO-Zeit), „Wiederherstellen“ entfernt es wieder. Für den Server ist beides
  ein gewöhnliches Speichern mit neuer Revision.
- **Der Server bleibt unverändert** und erfährt nicht, was im Papierkorb liegt.
- **Schlüsselwechsel** nimmt Papierkorb-Einträge automatisch mit, sie sind ja normale Einträge.
- **Rechte:** Wer schreiben darf, darf löschen, wiederherstellen und endgültig löschen. Wer nur
  lesen darf, sieht den Papierkorb, kann aber nichts ändern.
- **Nach 30 Tagen** löscht jede App mit Schreibrecht beim Sync die abgelaufenen Einträge
  endgültig (`DELETE` wie bisher).
- **Überall sonst ausgeblendet:** `VaultsManager` trennt `snapshot.items` und `snapshot.trash`.
  Liste, Suche, Sicherheits-Check, Export, Erweiterung und AutoFill sehen nur `items`.

## Alternativen

- **Papierkorb auf dem Server** (Spalte `trashed_at`, Endpunkte zum Wiederherstellen):
  braucht Migration und neue Endpunkte, und der Server sähe, was gelöscht wurde.
- **Kein Papierkorb, nur Nachfrage:** schützt nicht vor dem falschen Klick bei geteilten Bereichen.

## Folgen

- Endgültig gelöscht wird erst, wenn nach 30 Tagen eine App mit Schreibrecht online ist. Bis
  dahin liegt der Chiffretext weiter auf dem Server.
- Ältere Apps ohne Papierkorb zeigen Papierkorb-Einträge als normale Einträge an.
- Automatisches und gesammeltes Löschen prüft **unmittelbar vor jedem** `DELETE` (auch nach einem
  Konflikt), ob der Eintrag noch im Papierkorb liegt bzw. abgelaufen ist. Hat ein anderes Mitglied
  ihn inzwischen wiederhergestellt, bleibt er.
- `trashedAt` kommt von der Uhr des löschenden Geräts, abgelaufen wird nach der Uhr jedes Geräts
  mit Schreibrecht. Eine stark falsch gehende Uhr kann Einträge in geteilten Bereichen früher
  endgültig löschen. Das kann ein Mitglied mit Schreibrecht ohnehin, es ist also keine neue Lücke.
- Bei Konflikten gewinnt wie immer die zuletzt speichernde Seite: Bearbeitet jemand einen Eintrag,
  den ein anderer gerade gelöscht hat, ist er danach wieder da.
