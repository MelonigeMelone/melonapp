---
title: "0025: Verschlüsselte Mitgliederliste für Schlüssel-Freigaben"
description: Besitzer-Apps geben Tresor-Schlüssel nur noch an Personen, die in einer verschlüsselten Liste im Tresor stehen, eingeladen wurden oder deren Code geprüft ist.
---

**Status:** angenommen · **Datum:** 2026-11-12

## Kontext

Die App eines Besitzers verteilt bei jedem Sync Tresor-Schlüssel an wartende Mitglieder und
an alle Mitglieder nach einem Schlüsselwechsel. Welche Mitglieder es gibt, wusste sie bisher nur
vom Server. Ein übernommener Server konnte deshalb ein erfundenes Mitglied mit eigenem
Schlüssel melden und bekam den Tresor-Schlüssel ohne Einladung und ohne Zutun des Besitzers.
Mit einem falschen `personal`-Flag galt das auch für den persönlichen Tresor. Der Sicherheitscode
half nicht, weil ungeprüfte Personen bewusst weiter freigeschaltet wurden
([ADR 0011](/melonapp/entscheidungen/0011-recovery-und-sicherheitscode/)).

## Entscheidung

Jeder Tresor führt im verschlüsselten `encrypted_meta` ein Feld
`trust: { seq, members, invited }`. Nur wer den Tresor-Schlüssel hat, kann es schreiben.

- `members`: User-IDs, denen ein Besitzer den Schlüssel gegeben hat oder geben will.
- `invited`: `{ email, until, by }` für jede Einladung, die ein Besitzer erzeugt hat, mit
  Ablaufdatum und User-ID des Einladenden.
- `seq`: Zähler, der bei jeder Änderung steigt. Jedes Gerät merkt sich den höchsten gesehenen
  Wert wie bei der [Rollback-Erkennung](/melonapp/clients/web/#rollback-erkennung).

Die App gibt einem wartenden Mitglied den Schlüssel nur, wenn es in `members` steht, seine
E-Mail in einer gültigen Einladung steht oder sein Sicherheitscode geprüft ist. Ein
Schlüsselwechsel bricht mit `member_unconfirmed` ab, wenn ein Mitglied mit Schlüssel weder in
`members` steht noch geprüft ist. Beim Entfernen fallen die Person und ihre Einladungen aus der
Liste.

Fehlt die Liste, obwohl dieses Gerät schon eine gesehen hat, oder ist `seq` kleiner als bekannt,
verteilt die App in diesem Tresor keine Schlüssel (`members_unavailable`).

Neue Tresore und neue Konten bekommen die Liste beim Anlegen. Für bestehende Tresore legt die
erste Besitzer-App nach dem Update sie aus den Mitgliedern an, die schon einen Schlüssel haben.
Wer zu diesem Zeitpunkt noch wartet, braucht danach einen geprüften Code oder eine neue Einladung.

## Alternativen

- **Freigabe nur nach Code-Vergleich:** am sichersten, aber jede Einladung bräuchte einen Anruf.
  Bleibt über den Code-Knopf möglich.
- **Signierte Mitgliederliste mit eigenem Signaturschlüssel:** schützt zusätzlich gegen
  Mitglieder, die die Liste ändern. Mitglieder mit Schlüssel können aber ohnehin alles lesen.
  Kommt mit der Authentifizierung der Tresor-Schlüssel in Frage.

## Folgen

- Ein Server kann keine Personen mehr in Tresore schmuggeln. Er kann weiter einer echten
  Einladung einen falschen Schlüssel unterschieben; dagegen hilft der Code-Vergleich wie bisher.
- Die erste Übernahme der Liste vertraut dem Server einmal. Neue Geräte erkennen eine zurückgespielte
  Liste nicht, wie bei Einträgen.
- Wartende Mitglieder ohne Einladung erscheinen im Tresor-Dialog, werden aber erst nach geprüftem
  Code freigegeben.
