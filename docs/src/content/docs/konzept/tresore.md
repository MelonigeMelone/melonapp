---
title: Tresore & Teilen
description: Persönlicher Tresor, geteilte Tresore, Rollen, Einladungen, Eintragstypen und eigene Felder.
sidebar:
  order: 3
---

Vorbild ist 1Password. Jede Person hat einen **persönlichen Tresor**. Dazu kommen beliebig
viele **geteilte Tresore**, etwa „Familie“ oder „WG“, mit eigenen Mitgliedern.

## Begriffe

| Begriff | Bedeutung |
|---|---|
| **Tresor** | Behälter für Einträge mit eigenem Schlüssel. Wer den Schlüssel hat, kann alle Einträge darin lesen. |
| **Persönlicher Tresor** | wird bei der Registrierung angelegt, gehört nur dir, kann nicht geteilt werden |
| **Geteilter Tresor** | hat Mitglieder mit Rollen. Sichtbar für alle Mitglieder. |
| **Mitglied** | Person mit Zugriff auf einen Tresor, mit genau einer Rolle |
| **Einladung** | Link, mit dem jemand ohne Konto sich registriert und einem Tresor beitritt |
| **Eintrag** | ein Objekt im Tresor mit Typ (Login, Notiz, Karte …) und Feldern |

## Rollen

| Recht | Betrachter | Bearbeiter | Besitzer |
|---|---|---|---|
| Einträge lesen | ✓ | ✓ | ✓ |
| Einträge anlegen, ändern, löschen | | ✓ | ✓ |
| Tresor umbenennen, löschen | | | ✓ |
| Mitglieder einladen, Rollen ändern, entfernen | | | ✓ |

- Ein Tresor hat immer mindestens einen Besitzer. Der letzte Besitzer kann nicht gehen,
  sondern nur den Tresor löschen.
- Jedes Mitglied kann einen geteilten Tresor selbst verlassen.
- Die Rechte setzt der **Server** durch. Er lehnt Schreibzugriffe von Betrachtern ab, ohne
  dafür etwas entschlüsseln zu müssen.

:::note[Grenze von „Betrachter“]
Ein Betrachter kann Einträge lesen, also auch abschreiben oder kopieren. „Nur lesen“
verhindert Änderungen im Tresor, nicht das Weitergeben dessen, was man sieht.
Das gilt für jeden Passwortmanager.
:::

## Jemanden hinzufügen

**Hat die Person schon ein Konto** auf deinem Server, gibst du ihre E-Mail ein. Die App holt
ihren öffentlichen Schlüssel, verschlüsselt den Tresor-Schlüssel dafür, und sie sieht den
Tresor sofort.

**Hat sie noch kein Konto**, erzeugt die App einen **Einladungslink** (7 Tage gültig, nur
einmal nutzbar, an die E-Mail gebunden). Den schickst du ihr per Messenger. Der Server
verschickt selbst keine E-Mails.

1. Sie öffnet den Link und registriert sich. Das geht auch, wenn die offene Registrierung aus ist.
2. Sie ist jetzt **wartendes Mitglied**: Der Server kennt sie, aber sie hat den Tresor-Schlüssel
   noch nicht. Den kann nur ein Besitzer verschlüsseln, der Server kann es nicht.
3. Sobald ein Besitzer die App das nächste Mal öffnet, erledigt die App das automatisch.
   Danach sieht das neue Mitglied den Tresor.

## Jemanden entfernen

Wer einmal Mitglied war, hatte den Tresor-Schlüssel. Deshalb bekommt der Tresor beim
Entfernen einen **neuen Schlüssel**. Alle Einträge werden neu verschlüsselt, und die
verbleibenden Mitglieder bekommen den neuen Schlüssel. Das passiert in einem Schritt.
Danach kann die entfernte Person neue Einträge und Änderungen nicht mehr lesen.

Was sie vorher gesehen hat, kann sie behalten haben, etwa abgeschrieben oder in einem
Export. Nach dem Entfernen sollte man die wichtigen Passwörter in dem Tresor ändern.
Die App weist darauf hin.

Verlässt jemand einen Tresor selbst, erneuert die App eines Besitzers den Schlüssel beim
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

- **Personengruppen** („Familie“), die man mehreren Tresoren auf einmal hinzufügt
- einzelnen Eintrag per Link teilen, Sicherheits-Check, 2FA-Codes, Passkeys, Anhänge
