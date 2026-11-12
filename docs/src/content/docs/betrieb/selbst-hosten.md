---
title: Selbst hosten
description: MelonApp auf einem eigenen Server betreiben.
sidebar:
  order: 1
---

**Empfehlung:** ein kleiner Hetzner-Cloud-Server in Deutschland (ca. 4–6 €/Monat) mit
Docker Compose. Warum nicht Kubernetes, steht in [ADR 0004](/melonapp/entscheidungen/0004-hosting/).

## Aufbau

```text
Internet ─► Caddy :443 (TLS, HSTS)  ─┬─ /api/*, /health ─► melon-server :8080 ─► PostgreSQL
            Image melonapp-web       └─ alles andere ───► Web-App (statisch, /srv)
            Netz "web"                   Netz "web" + "internal"   nur Netz "internal"
```

Die Web-App und die API laufen unter derselben Domain. CORS ist dafür nicht nötig.
Caddy setzt für die Web-App eine strenge Content-Security-Policy ([Details](/melonapp/clients/web/#schutzmaßnahmen)).
Dafür erzeugt Caddy je Aufruf einen Nonce (`templates` für `index.html`). Wer einen eigenen
Reverse Proxy vor die Web-App setzt, muss `index.html` ungecacht durchreichen und den
CSP-Header von Caddy übernehmen ([ADR 0019](/melonapp/entscheidungen/0019-csp-nonce-fuer-styles/)).

- Die Datenbank hängt nur im internen Netz und ist von außen nicht erreichbar.
- Der Server-Container läuft schreibgeschützt (`read_only`), ohne Linux-Capabilities und mit
  `no-new-privileges`. Das Image ist distroless: kein Shell, kein Paketmanager, Nutzer `nonroot`.
- Caddy holt und erneuert das TLS-Zertifikat automatisch.

## Einrichten

1. Server anlegen (Ubuntu LTS), Nutzer `melon` in der Gruppe `docker`, Docker installieren,
   Firewall nur für 22, 80 und 443 (TCP und UDP) öffnen.
2. DNS-Eintrag (A/AAAA) für deine Domain auf den Server zeigen lassen.
3. Den Ordner `deploy/` nach `/home/melon/melonapp` kopieren und dort:

```sh
cp .env.example .env && chmod 600 .env
chmod +x bin/*
docker compose up -d --no-build
```

### `.env`

| Variable | Wert |
|---|---|
| `MELON_DOMAIN` | z. B. `vault.example.com` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 32`. **Hex, nicht base64**: Das Passwort steht in einer Verbindungs-URL, `/` und `+` würden sie zerbrechen. Nach dem ersten Start nie mehr ändern, Postgres liest es nur beim Anlegen der Datenbank. |
| `MELON_SERVER_SECRET` | `openssl rand -hex 32` |
| `MELON_ALLOW_REGISTRATION` | zum Anlegen der Konten `true`, danach `false` und `docker compose up -d` |
| `MELON_CORS_ORIGINS` | nur für die Browser-Erweiterung (M4) nötig. Die Web-App läuft auf derselben Domain. |
| `MELON_IMAGE` | `ghcr.io/melonigemelone/melonapp-server:latest`, ab dem ersten Update eine feste Version (setzt `bin/melon-update`) |
| `MELON_WEB_IMAGE` | `ghcr.io/melonigemelone/melonapp-web:latest` (Caddy + Web-App), ebenso |

Alle Variablen des Servers: [Konfiguration](/melonapp/server/konfiguration/).

Danach `https://<deine-domain>` öffnen und unter **Konto erstellen** die Konten anlegen.
Anschließend die Registrierung wieder ausschalten.

## Updates: Version per Tag

Der Server läuft immer auf einer **festen Version**, nie auf `latest`
([ADR 0020](/melonapp/entscheidungen/0020-deploy-per-tag/)). Ein Update ist ein Git-Tag:

```text
git tag v1.2.0 && git push origin v1.2.0
   └─► Workflow „Images“ baut melonapp-server:1.2.0 und melonapp-web:1.2.0
       └─► Job „Deploy“: ssh melon@server "deploy 1.2.0"
           └─► bin/melon-deploy-ssh lässt nur genau diesen Befehl zu
               └─► bin/melon-update 1.2.0
```

`bin/melon-update <x.y.z>` macht auf dem Server:

1. `docker-compose.yml`, `Caddyfile` und `bin/*` **von genau diesem Tag** holen. Schlägt das
   fehl, bleibt alles unverändert.
2. Backup (`bin/melon-backup`).
3. Die Images in `.env` auf `:<x.y.z>` festlegen, `docker compose pull` und `up -d`.
4. Bis zu 60 Sekunden auf `/health` warten.
5. Klappt etwas nicht: alte Dateien und alte `.env` zurück, alte Version wieder starten, der
   Workflow wird rot. Hat die neue Version die Datenbank schon migriert, das Backup aus
   Schritt 2 mit `bin/melon-restore` einspielen.

Ein zweites Update gleichzeitig wird abgelehnt (`flock`). Von Hand geht dasselbe mit
`bin/melon-update 1.2.0` auf dem Server. Vorabversionen (`v1.2.0-rc1`) bauen nur Images.

**Wer deployen darf:** Ein Tag startet Code mit Root-Rechten auf dem Server. Deshalb:

- Ein Repo-Ruleset erlaubt nur Admins, `v*`-Tags anzulegen, zu ändern oder zu löschen.
- Das Environment `production` gibt seine Secrets nur an Läufe für `v*`-Tags.
- Der Job prüft vor dem SSH-Aufruf, dass der getaggte Commit auf `main` liegt
  (`git merge-base --is-ancestor`). Ein Tag auf einen ungemergten Branch deployt nichts.
- Wer den Deploy-Schlüssel stiehlt, kann jede vorhandene Version einspielen, auch eine ältere,
  aber keine eigenen Befehle ausführen.

### Deploy-Zugang einrichten (einmal)

1. Auf dem eigenen Rechner einen Schlüssel nur für das Deployment erzeugen:
   `ssh-keygen -t ed25519 -N "" -C github-deploy -f melon-deploy`
2. Auf dem Server in `/home/melon/.ssh/authorized_keys` eine Zeile anhängen, die den Schlüssel
   auf den einen Befehl festlegt:
   `command="/home/melon/melonapp/bin/melon-deploy-ssh",restrict ssh-ed25519 AAAA… github-deploy`
3. In GitHub ein Environment `production` mit drei Secrets anlegen:

   ```sh
   gh secret set DEPLOY_SSH_KEY --env production < melon-deploy
   gh secret set DEPLOY_HOST --env production --body app.example.com
   ssh-keyscan app.example.com | gh secret set DEPLOY_KNOWN_HOSTS --env production
   ```

4. Die lokale Datei `melon-deploy` löschen.
5. Port 22 muss für GitHub erreichbar sein. Steht in der Firewall nur die eigene IP, kommt der
   Workflow nicht durch. Port 22 für alle ist in Ordnung, solange nur SSH-Schlüssel erlaubt sind.

Ohne `DEPLOY_HOST` baut ein Tag nur die Images und deployt nichts.

## Backups

Die Einträge sind Ende-zu-Ende verschlüsselt, ohne Master-Passwort oder Recovery-Key sind sie
auch im Backup nicht lesbar. **Trotzdem ist ein Dump schützenswert:** Er enthält E-Mail-Adressen,
Salts und die Argon2-Hashes der Login-Schlüssel. Wer ihn hat, kann offline Master-Passwörter
raten, gebremst nur durch Argon2. Ein Backup ist also so sicher wie das schwächste
Master-Passwort darin. Deshalb: starke Master-Passwörter und die Backups nicht offen ablegen.

| Was | Wann | Wo |
|---|---|---|
| `bin/melon-backup`: `pg_dump` im Custom-Format, danach mit `pg_restore --list` geprüft | nächtlich 03:30 (systemd-Timer) und vor jedem Update | `backups/` auf dem Server (`chmod 700`), 14 Tage |
| Kopie per `rsync` (ohne `--delete`) | nächtlich, wenn `backup.env` existiert. Vor Updates nur lokal, damit ein Ausfall der Storage Box kein Deployment blockiert. | Hetzner Storage Box. Dort wird nichts gelöscht, auch nicht von einem übernommenen Server aus. |
| Hetzner-Backups (Server-Snapshot) | täglich, 7 Tage | Hetzner, Schutz gegen „Server kaputt“ |

**Timer einrichten (einmal):**

```sh
sudo cp systemd/melon-backup.* /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now melon-backup.timer
systemctl list-timers melon-backup.timer
```

**Storage Box (optional, empfohlen):**

1. Storage Box bestellen, darin einen **Sub-Account** nur für den Ordner `melonapp/` anlegen und
   SSH dafür einschalten.
2. In der Storage Box **automatische Snapshots** einschalten. Die kann der Server nicht löschen,
   auch nicht mit seinem Schlüssel.
3. Auf dem Server einen Schlüssel ohne Passphrase erzeugen (`ssh-keygen -t ed25519 -N "" -f ~/.ssh/storagebox`)
   und beim Sub-Account hinterlegen.
4. Den Host-Schlüssel der Box festhalten und den Fingerabdruck mit der Hetzner-Doku vergleichen:
   `ssh-keyscan -p 23 <box>.your-storagebox.de >> ~/.ssh/known_hosts`
5. `backup.env.example` nach `backup.env` kopieren (`chmod 600`) und ausfüllen. Ein Lauf von
   `bin/melon-backup` zeigt danach `copied to …`.

Lokal hält `bin/melon-backup` höchstens 14 Tage und höchstens 60 Dumps.

**Wiederherstellen:**

```sh
bin/melon-restore backups/melon-20261112T033000Z.dump --yes
```

Das ersetzt die ganze Datenbank durch den Dump, stoppt dafür kurz den Server und startet ihn
wieder. Nur eigene Dumps einspielen: Ein manipulierter Dump könnte als Datenbank-Superuser
Befehle im Datenbank-Container ausführen. Die Wiederherstellung einmal auf einem Testserver (oder lokal) durchzuspielen gehört zur
Einrichtung: Erst wenn man mit dem eingespielten Stand entsperren kann, ist ein Backup eines.

## Optional: nur über Tailscale

Wer den Server nicht ins offene Internet stellen will, lässt Caddy nur im Tailscale-Netz
lauschen. Unterwegs braucht dann jedes Gerät Tailscale.
