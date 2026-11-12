---
title: "0020: Deployment per Versions-Tag"
description: Der Server bekommt nur getaggte Versionen, über einen SSH-Schlüssel, der nur „deploy <Version>“ darf.
---

**Status:** angenommen · **Datum:** 2026-11-12

## Kontext

Die Pipeline baute bisher nur Images, auf den Server kam ein Update von Hand mit
`docker compose pull`. Standard war `latest`, also jeder Zwischenstand von `main`. Auf `main`
landen mehrere Änderungen am Tag. Bei einem Passwortmanager darf kein halbfertiger Stand live
gehen, und vor jedem Update muss ein Backup liegen.

## Entscheidung

- **Nur Tags werden deployt.** `v1.2.0` baut die Images `1.2.0`, danach ruft der Job „Deploy“
  im Workflow „Images“ den Server auf. Ein Push auf `main` ändert am Server nichts.
- **Eigener SSH-Schlüssel mit erzwungenem Befehl.** Der Schlüssel in GitHub darf nur
  `bin/melon-deploy-ssh` ausführen, und das nimmt nur `deploy <x.y.z>` an. Wer den Schlüssel
  stiehlt, kann eine **veröffentlichte** Version einspielen, sonst nichts.
- **`bin/melon-update` auf dem Server** holt Compose-Datei, Caddyfile und Skripte vom Tag,
  macht ein Backup, legt die Images in `.env` auf die Version fest, startet neu, prüft
  `/health` und geht bei einem Fehler auf den alten Stand zurück.
- **GitHub-Environment `production`** hält die drei Secrets. Ohne sie baut ein Tag nur Images.

## Alternativen

- **Watchtower oder Cron mit `latest`:** jeder Zwischenstand live, ohne Backup, ohne Rückmeldung.
- **Deploy bei jedem Push auf `main`:** zu viele Zwischenstände.
- **Server holt selbst (Pull statt Push):** braucht einen Dienst auf dem Server, der GitHub
  abfragt. Mehr bewegliche Teile für denselben Effekt.

## Folgen

- Ein Release ist ein Tag. Der Server läuft nachvollziehbar auf genau einer Version.
- Port 22 muss für GitHub erreichbar sein (nur Schlüssel-Logins).
- Migrationen lassen sich nicht automatisch zurückdrehen. Deshalb das Backup vor jedem Update
  und `bin/melon-restore` für den Notfall.
