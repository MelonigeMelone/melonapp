---
title: Bereiche & Teilen
description: Persönlicher Bereich, geteilte Bereiche, Rollen, Einladungen, Eintragstypen und eigene Felder.
sidebar:
  order: 3
---

Vorbild ist 1Password. Jede Person hat einen **persönlichen Bereich**. Dazu kommen beliebig
viele **geteilte Bereiche**, etwa „Familie“ oder „WG“, mit eigenen Mitgliedern.

Ein Bereich gilt für **alle Module**: Wer im Bereich „Familie“ ist, sieht dort die Passwörter
und später auch den Kalender ([ADR 0012](/melonapp/entscheidungen/0012-app-shell-und-bereiche/)).
In Code und API heißt ein Bereich `vault`.

## Begriffe

| Begriff | Bedeutung |
|---|---|
| **Bereich** | Behälter für Einträge mit eigenem Schlüssel. Wer den Schlüssel hat, kann alle Einträge darin lesen. |
| **Persönlicher Bereich** | wird bei der Registrierung angelegt, gehört nur dir, kann nicht geteilt werden |
| **Geteilter Bereich** | hat Mitglieder mit Rollen. Sichtbar für alle Mitglieder. |
| **Mitglied** | Person mit Zugriff auf einen Bereich, mit genau einer Rolle |
| **Einladung** | Link, mit dem jemand ohne Konto sich registriert und einem Bereich beitritt |
| **Eintrag** | ein Objekt im Bereich mit Typ (Login, Notiz, Karte …) und Feldern |

## Rollen

| Recht | Betrachter | Bearbeiter | Besitzer |
|---|---|---|---|
| Einträge lesen | ✓ | ✓ | ✓ |
| Einträge anlegen, ändern, löschen | | ✓ | ✓ |
| Bereich umbenennen, löschen | | | ✓ |
| Mitglieder einladen, Rollen ändern, entfernen | | | ✓ |

- Ein Bereich hat immer mindestens einen Besitzer. Der letzte Besitzer kann nicht gehen,
  sondern nur den Bereich löschen.
- Jedes Mitglied kann einen geteilten Bereich selbst verlassen.
- Die Rechte setzt der **Server** durch. Er lehnt Schreibzugriffe von Betrachtern ab, ohne
  dafür etwas entschlüsseln zu müssen.

:::note[Grenze von „Betrachter“]
Ein Betrachter kann Einträge lesen, also auch abschreiben oder kopieren. „Nur lesen“
verhindert Änderungen im Bereich, nicht das Weitergeben dessen, was man sieht.
Das gilt für jeden Passwortmanager.
:::

## Jemanden hinzufügen

**Hat die Person schon ein Konto** auf deinem Server, gibst du ihre E-Mail ein. Die App zeigt
ihren **Sicherheitscode** (sechs fünfstellige Zahlen). Sie sieht ihren eigenen unter „Konto“.
Stimmen beide überein, fügst du sie hinzu: Die App verschlüsselt den Bereichs-Schlüssel für sie, und
sie sieht den Bereich sofort. Der Vergleich stellt sicher, dass niemand auf dem Server einen
falschen Schlüssel untergeschoben hat. Danach steht bei ihr „Code geprüft“. Ändert sich ihr
Schlüssel später, steht dort „Code geändert“, und sie bekommt keine neuen Bereichs-Schlüssel, bis
du den Code neu verglichen hast. Den Code jedes Mitglieds kannst du auch nachträglich prüfen
(Fingerabdruck-Knopf) und als geprüft markieren.

**Hat sie noch kein Konto**, erzeugt die App einen **Einladungslink** (7 Tage gültig, nur
einmal nutzbar, an die E-Mail gebunden). Den schickst du ihr per Messenger. Der Server
verschickt selbst keine E-Mails.

1. Sie öffnet den Link und registriert sich. Das geht auch, wenn die offene Registrierung aus ist.
2. Sie ist jetzt **wartendes Mitglied**: Der Server kennt sie, aber sie hat den Bereichs-Schlüssel
   noch nicht. Den kann nur ein Besitzer verschlüsseln, der Server kann es nicht.
3. Sobald ein Besitzer die App das nächste Mal öffnet, erledigt die App das automatisch.
   Danach sieht das neue Mitglied den Bereich.

Die App merkt sich jede Einladung verschlüsselt im Bereich. Automatisch freigegeben wird nur, wer
eingeladen wurde, schon in der verschlüsselten Mitgliederliste steht oder einen geprüften Code hat.
Taucht jemand anderes als wartendes Mitglied auf, gibt die App den Schlüssel erst, wenn du seinen
Code geprüft hast ([ADR 0025](/melonapp/entscheidungen/0025-verschluesselte-mitgliederliste/)).

Eine Einladung gilt nur, solange die Person, die sie erzeugt hat, Besitzer ist. Verlässt sie den
Bereich, wird sie entfernt oder herabgestuft, verfallen ihre offenen Einladungen. Wer als Besitzer
eingeladen wurde, darf erst etwas verwalten oder löschen, wenn er den Bereichs-Schlüssel hat.

## Jemanden entfernen

Wer einmal Mitglied war, hatte den Bereichs-Schlüssel. Deshalb bekommt der Bereich beim
Entfernen einen **neuen Schlüssel**. Alle Einträge werden neu verschlüsselt, und die
verbleibenden Mitglieder bekommen den neuen Schlüssel. Das passiert in einem Schritt.
Danach kann die entfernte Person neue Einträge und Änderungen nicht mehr lesen.

Was sie vorher gesehen hat, kann sie behalten haben, etwa abgeschrieben oder in einem
Export. Nach dem Entfernen sollte man die wichtigen Passwörter in dem Bereich ändern.
Die App weist darauf hin.

Verlässt jemand einen Bereich selbst, erneuert die App eines Besitzers den Schlüssel beim
nächsten Öffnen automatisch.

## Eintragstypen und eigene Felder

Jeder Eintrag hat einen **Typ**. Der Typ legt die Standardfelder fest:

| Typ | Standardfelder |
|---|---|
| Login | Benutzername, Passwort, Websites |
| Sichere Notiz | nur Notiz |
| Kreditkarte | Karteninhaber, Nummer, Ablaufdatum, Prüfnummer, PIN |
| Identität | Name, Geburtsdatum, Adresse, Telefon, E-Mail |
| WLAN | Netzwerkname, Passwort, Sicherheit |
| Passkey | Website (RP-ID), Benutzername, Credential-ID, User-Handle, privater Schlüssel (verborgen, nie angezeigt) |

Passkeys entstehen nur über die iOS-AutoFill-Extension und lassen sich nicht von Hand anlegen
oder ihre Schlüsselfelder bearbeiten ([ADR 0023](/melonapp/entscheidungen/0023-passkeys-im-tresor/)).

Zusätzlich kann jeder Eintrag **eigene Abschnitte und Felder** haben, mit frei wählbarem Namen:

| Feldart | Verhalten |
|---|---|
| Text | normal angezeigt |
| Verborgen | wie ein Passwort: verborgen, anzeigbar, kopierbar, mit Generator |
| URL | als Link, liefert das Logo |
| E-Mail, Telefon | als Link (`mailto:`, `tel:`) |
| Datum | Datumsauswahl |

Typen und Felder liegen vollständig **im verschlüsselten Eintrag**. Neue Typen und Feldarten
brauchen deshalb nie eine Server-Änderung. Ältere Apps zeigen unbekannte Feldarten als Text an.

## Symbole statt Logos

Einträge zeigen einen **farbigen Anfangsbuchstaben**. Logos von Websites werden bewusst
nicht geladen ([ADR 0010](/melonapp/entscheidungen/0010-keine-logos/)). Später kann man pro
Eintrag ein eigenes Symbol oder eine Farbe wählen. Das bleibt im verschlüsselten Eintrag
und braucht keine Verbindung nach außen.

## Später

- **Personengruppen** („Familie“), die man mehreren Bereichen auf einmal hinzufügt
- einzelnen Eintrag per Link teilen, Anhänge
