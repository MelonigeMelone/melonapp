---
title: "0022: Backups verschlüsselt mit age, Schlüssel offline"
description: Kopien, die den Server verlassen, sind mit age an einen öffentlichen Schlüssel verschlüsselt, der private Schlüssel liegt nur offline.
---

**Status:** angenommen · **Datum:** 2026-11-12

## Kontext

Ein Dump enthält E-Mail-Adressen, Salts und die Argon2-Hashes der Login-Schlüssel. Wer eine Kopie
von der Storage Box oder vom Heim-Rechner bekommt, kann offline Master-Passwörter raten. Mit
mehreren Personen auf dem Server ist das schwächste Master-Passwort die Grenze. Die Kopien liegen
bei einem anderen Anbieter und auf einem Alltagsrechner, also an Orten mit eigenem Risiko
([#77](https://github.com/MelonigeMelone/melonapp/issues/77)).

## Entscheidung

- `bin/melon-backup` verschlüsselt jede Kopie für die Storage Box mit
  [age](https://age-encryption.org) an die Empfänger in `backup.recipients` (öffentliche
  Schlüssel, `age1…`). Auf die Box geht nur der Ordner `offsite/` mit `*.dump.age`.
- **Ohne Empfänger wird nichts kopiert.** Der Lauf bricht mit Fehler ab, der lokale Dump ist
  trotzdem da. Unverschlüsselt verlässt kein Dump den Server.
- **Der private Schlüssel liegt nie auf dem Server**, sondern ausgedruckt beim Notfall-Kit und
  als mit Passphrase geschützte Datei (`age -p`) auf dem eigenen Rechner. Er wird nur zum
  Wiederherstellen gebraucht.
- Die Dumps in `backups/` auf dem Server bleiben unverschlüsselt. Der Server hat die Datenbank
  ohnehin, und `bin/melon-update` braucht sie für eine schnelle Rückkehr ohne Schlüssel.
- Wiederherstellen aus einer Kopie: auf dem eigenen Rechner entschlüsseln und den Dump
  hochladen, damit der Schlüssel nie auf den Server muss. `bin/melon-restore` kann `*.dump.age`
  zur Not auch selbst (`--identity`). Es entschlüsselt zuerst vollständig in eine temporäre Datei
  und rührt die Datenbank erst danach an.
- `scripts/home-backup.ps1` holt nur noch `*.dump.age` und prüft den age-Header. Alte
  unverschlüsselte Kopien löscht man von Hand, erst nach einer Test-Wiederherstellung mit dem
  neuen Schlüssel.

## Alternativen

- **Passwort in `backup.env` (`age -p`, restic, borg):** Das Geheimnis läge auf dem Server. Wer
  den Server übernimmt, liest auch alle alten Kopien auf der Box.
- **GnuPG:** kann dasselbe, ist aber schwerer richtig einzurichten und zu prüfen.
- **Nur auf die Storage Box vertrauen:** schützt nicht vor geleakten Zugangsdaten oder einem
  befallenen Heim-Rechner.

## Folgen

- **Schlüssel weg heißt Kopien weg.** Ohne den privaten Schlüssel sind Box und Heim-Kopie
  wertlos. Deshalb zwei Kopien an getrennten Orten und einmal die Wiederherstellung durchspielen.
- age prüft Unversehrtheit, aber nicht den Absender: Wer den öffentlichen Schlüssel kennt und
  auf die Box schreiben kann, kann einen gültigen Dump unterschieben. Schreiben kann dort nur
  der Server-Sub-Account. Wie bisher gilt: nur eigene Dumps einspielen.
- Der Server braucht das Paket `age`. Fehlt es oder `backup.recipients`, bricht die Kopie mit
  Fehler ab, und `bin/melon-update` warnt nach dem Update. Mit `BACKUP_PING_URL` meldet
  ein Überwachungsdienst das gescheiterte oder ausbleibende Backup
  ([#94](https://github.com/MelonigeMelone/melonapp/issues/94)).
- Ältere, unverschlüsselte Dumps auf der Box und in ihren Snapshots bleiben, bis man sie löscht
  bzw. bis die Snapshots auslaufen.
