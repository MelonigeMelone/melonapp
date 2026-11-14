---
title: Änderungen
description: Was sich mit jeder Version geändert hat, und was man beim Update beachten muss.
sidebar:
  order: 4
---

Jede Version ist ein Git-Tag ([Updates](/melonapp/betrieb/selbst-hosten/#updates-version-per-tag)).
Der Text eines Abschnitts steht auch im GitHub-Release.

## 0.3.1 — 14.11.2026

Härtung von Server und Deployment nach dem Pentest. Keine bekannte Lücke, aber weniger
Angriffsfläche, falls doch einmal etwas durchrutscht.

### Server und Container

- Der Server verbindet sich als eigene Datenbank-Rolle `melon_app` ohne Superuser-Rechte. Eine
  SQL-Injection könnte damit keine Rollen anlegen und keine Befehle im Datenbank-Container
  ausführen. Bestehende Tabellen bekommt die Rolle beim ersten Start automatisch (#101).
- Server und Datenbank erreichen das Internet nicht mehr. Nur Caddy hängt im äußeren Netz (#101).
- Caddy läuft nicht mehr als root, alle Container laufen schreibgeschützt und mit
  `no-new-privileges` (#101).
- Neue Basis-Images: Der Server läuft auf distroless Debian 13. Alle Basis-Images sind per Digest
  festgelegt, ein trivy-Scan prüft die gebauten Images bei jedem Push (#100).

### Deployment

- `bin/melon-update` prüft vor jedem Update mit `cosign`, dass beide Images vom Workflow dieses
  Repos für genau diesen Tag gebaut wurden, und legt sie per Digest in `.env` fest (#79).
- Scheitert ein Update, nachdem die neue Version die Datenbank schon migriert hat, startet die alte
  Version nicht mehr gegen das neue Schema. Der Server bleibt gestoppt, `bin/melon-restore` spielt
  das Backup ein (#79).
- `bin/melon-restore` gibt die Tabellen nach dem Einspielen wieder `melon_app`.

### Apps

- Behoben: Lief während eines Schlüsselwechsels (z. B. beim Entfernen eines Mitglieds) ein Sync im
  Hintergrund, konnte die App fälschlich „Mitgliederliste älter als zuletzt gesehen“ melden und in
  diesem Bereich keine Schlüssel mehr weitergeben, bis man neu lud (#126).

### Beim Update beachten

- Nichts von Hand. Die Rolle `melon_app` und die Rechte für Caddy richten zwei Einmal-Dienste
  (`db-setup`, `caddy-volumes`) beim Start selbst ein.
- Das Update auf 0.3.1 läuft noch mit dem `melon-update` aus 0.3.0. Die Herkunftsprüfung der
  Images greift deshalb ab dem Update danach.
- Wer statt Caddy einen eigenen Proxy nutzt: Er muss jetzt im Netz `internal` hängen, um den Server
  zu erreichen.

## 0.3.0 — 14.11.2026

Sicherheitsrelease nach dem internen Pentest vom 12.11.2026, mit elf behobenen Advisories
(zwei kritisch, eins hoch, fünf mittel, drei niedrig). Die Liste steht im
[GitHub-Release](https://github.com/MelonigeMelone/melonapp/releases/tag/v0.3.0) und unter
[Security Advisories](https://github.com/MelonigeMelone/melonapp/security/advisories).

- Bereiche teilen nur noch mit Zustimmung: Wer ein bestehendes Konto aufnimmt, schickt ein Angebot.
- Tresor-Schlüssel sind authentisiert, der eigene Sicherheitscode wird nicht mehr aus Daten des
  Servers berechnet.
- Sitzungen enden nach 7 Tagen ohne Nutzung.
- Mac und iPhone: Face ID bzw. Touch ID einmal mit dem Master-Passwort neu einrichten, die
  Server-Adresse liegt im Schlüsselbund.
- Eigener Proxy statt Caddy: den CSP-Header für `/assets/*` aus `deploy/Caddyfile` übernehmen.
