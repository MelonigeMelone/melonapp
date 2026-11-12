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

   `ssh-keyscan` unter Windows (OpenSSH 9.5) bricht bei aktuellen Servern mit `unsupported KEX
   method` ab und liefert nichts, das Secret ist dann leer und der erste Deploy scheitert mit
   `Host key verification failed`. Dann den Befehl in Git Bash oder auf dem Server ausführen und
   den Fingerabdruck mit `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` auf dem Server vergleichen.
4. Die lokale Datei `melon-deploy` löschen.
5. Port 22 muss für GitHub erreichbar sein. Steht in der Firewall nur die eigene IP, kommt der
   Workflow nicht durch. Port 22 für alle ist in Ordnung, solange nur SSH-Schlüssel erlaubt sind.

Ohne `DEPLOY_HOST` baut ein Tag nur die Images und deployt nichts.

## Backups

Die Einträge sind Ende-zu-Ende verschlüsselt, ohne Master-Passwort oder Recovery-Key sind sie
auch im Backup nicht lesbar. **Trotzdem ist ein Dump schützenswert:** Er enthält E-Mail-Adressen,
Salts und die Argon2-Hashes der Login-Schlüssel. Wer ihn hat, kann offline Master-Passwörter
raten, gebremst nur durch Argon2. Deshalb verlässt ein Dump den Server nur mit
[age](https://age-encryption.org) verschlüsselt, an einen Schlüssel, dessen privater Teil nicht
auf dem Server liegt ([ADR 0022](/melonapp/entscheidungen/0022-backups-mit-age/)).

| Was | Wann | Wo |
|---|---|---|
| `bin/melon-backup`: `pg_dump` im Custom-Format, danach mit `pg_restore --list` geprüft | nächtlich 03:30 (systemd-Timer) und vor jedem Update | `backups/` auf dem Server (`chmod 700`), 14 Tage, unverschlüsselt |
| Verschlüsselte Kopie (`offsite/*.dump.age`) per `rsync` (ohne `--delete`) | nächtlich, wenn `backup.env` existiert. Vor Updates nur lokal, damit ein Ausfall der Storage Box kein Deployment blockiert. | Hetzner Storage Box. Dort wird nichts gelöscht, auch nicht von einem übernommenen Server aus. |
| Hetzner-Backups (Server-Snapshot) | täglich, 7 Tage | Hetzner, Schutz gegen „Server kaputt“ |
| Kopie zu Hause (`scripts/home-backup.ps1`) | wenn das letzte Mal 30 Tage her ist, geprüft bei jeder Anmeldung und täglich um 12 Uhr | eigener Windows-Rechner, die 12 neuesten, verschlüsselt, Schutz gegen „Hetzner-Konto weg“ |

**Timer einrichten (einmal):**

```sh
sudo cp systemd/melon-backup.* /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now melon-backup.timer
systemctl list-timers melon-backup.timer
```

**Backup-Schlüssel (einmal, auf dem eigenen Rechner, nicht auf dem Server):**

1. age installieren: unter Windows `winget install FiloSottile.age` (danach PowerShell neu
   öffnen), unter macOS `brew install age`.
2. Schlüssel erzeugen. Die Ausgabe `Public key: age1…` ist der öffentliche Teil:

   ```powershell
   age-keygen -o melon-backup-key.txt
   ```

3. `melon-backup-key.txt` **ausdrucken** (die Zeile `AGE-SECRET-KEY-1…` zählt) und zum
   Notfall-Kit legen.
4. Eine mit Passphrase geschützte Kopie für den Rechner anlegen, dann das Original löschen:

   ```powershell
   age -p -o $HOME\.melonapp\melon-backup-key.age melon-backup-key.txt
   Remove-Item melon-backup-key.txt
   ```

   Die Passphrase gehört in den Passwortmanager **und** aufs Papier zum Schlüssel. Ohne den
   Schlüssel sind alle Kopien auf Box und Rechner wertlos.

**Storage Box (optional, empfohlen):**

1. Storage Box bestellen, darin einen **Sub-Account** nur für den Ordner `melonapp/` anlegen und
   SSH dafür einschalten.
2. In der Storage Box **automatische Snapshots** einschalten. Die kann der Server nicht löschen,
   auch nicht mit seinem Schlüssel.
3. Auf dem Server einen Schlüssel ohne Passphrase erzeugen (`ssh-keygen -t ed25519 -N "" -f ~/.ssh/storagebox`)
   und beim Sub-Account hinterlegen.
4. Den Host-Schlüssel der Box festhalten und den Fingerabdruck mit der Hetzner-Doku vergleichen:
   `ssh-keyscan -p 23 <box>.your-storagebox.de >> ~/.ssh/known_hosts`
5. age installieren (`sudo apt install age`) und den **öffentlichen** Backup-Schlüssel eintragen.
   Mehrere Zeilen sind möglich, z. B. ein zweiter Schlüssel bei einer Vertrauensperson:

   ```sh
   echo age1… > ~/melonapp/backup.recipients
   ```

6. `backup.env.example` nach `backup.env` kopieren (`chmod 600`) und ausfüllen. Ein Lauf von
   `bin/melon-backup` zeigt danach `copied offsite/melon-….dump.age to …`. Fehlt age oder
   `backup.recipients`, bricht die Kopie mit Fehler ab und es wird nichts unverschlüsselt kopiert.

Lokal hält `bin/melon-backup` in `backups/` und `offsite/` je höchstens 14 Tage und höchstens 60
Dateien.

**Umstellen von unverschlüsselten Kopien:** Erst age und `backup.recipients` auf dem Server
einrichten, dann das Update einspielen (`bin/melon-update` warnt, wenn es fehlt, sonst bricht ab
dann die nächtliche Kopie ab). Nach dem ersten verschlüsselten Lauf und einer erfolgreichen
Test-Wiederherstellung damit die alten `melon-*.dump` löschen: auf der Box mit dem
Server-Sub-Account per `sftp` (`rm melon-*.dump` im Zielordner), zu Hause im Zielordner
(`melon-*.dump` und `melon-*.dump.part`). In den Snapshots der Box bleiben sie, bis diese
auslaufen.

**Benachrichtigung (empfohlen):** Ein gescheitertes Backup steht sonst nur im Journal.
`bin/melon-backup` meldet sich deshalb nach jedem nächtlichen Lauf bei einem Überwachungsdienst,
der [healthchecks.io](https://healthchecks.io) versteht (dort kostenlos, oder selbst gehostet).
Bleibt die Meldung aus, weil der ganze Server steht, schlägt der Dienst ebenfalls Alarm.

1. Bei healthchecks.io einen Check anlegen: Zeitplan „Cron“, `30 3 * * *`, Zeitzone
   `Europe/Berlin`, Gnadenfrist 2 Stunden. Unter „Integrations“ E-Mail oder die Smartphone-App
   (z. B. ntfy, Pushover) einrichten.
2. Die Ping-URL in `backup.env` eintragen: `BACKUP_PING_URL=https://hc-ping.com/<uuid>`
3. `sudo systemctl start melon-backup.service`, im Dashboard erscheint „up“.

Gemeldet wird: Erfolg nach der verschlüsselten Kopie (oder nach dem lokalen Dump, wenn
`BACKUP_TARGET` leer ist), `/fail` mit kurzer Ursache (z. B. „no age recipient …“ oder Zeile und
Befehl), nichts bei `--local` vor Updates. Die Meldung enthält nur den Hostnamen und den
Dateinamen, keine Zugangsdaten oder Pfade der Box. Die Ping-URL ist geheim zu halten (wer sie
kennt, kann „up“ melden), sie steht deshalb in `backup.env` (`chmod 600`).

**Kopie zu Hause (Windows, optional):** Der eigene Rechner holt sich alle 30 Tage den neuesten
verschlüsselten Dump von der Storage Box. Er braucht dafür einen **eigenen, nur lesenden** Zugang,
damit ein befallener Rechner dort nichts löschen kann.

1. In der Storage Box einen zweiten Sub-Account für `melonapp/` anlegen, SSH an, noch **nicht**
   schreibgeschützt.
2. In PowerShell einen Schlüssel erzeugen und hinterlegen (fragt einmal nach dem Passwort des
   Sub-Accounts). Beim ersten Verbinden den Fingerabdruck mit der Hetzner-Doku vergleichen und mit
   `yes` bestätigen, dann steht der Host-Schlüssel in `~\.ssh\known_hosts`:

   ```powershell
   New-Item -ItemType Directory -Force $HOME\.melonapp | Out-Null
   ssh-keygen -t ed25519 -N '""' -C melon-home -f $HOME\.melonapp\storagebox
   Get-Content $HOME\.melonapp\storagebox.pub | ssh -p 23 u123456-sub2@u123456-sub2.your-storagebox.de install-ssh-key
   ```

3. Jetzt den Sub-Account in der Hetzner-Konsole auf **schreibgeschützt** stellen.
4. `deploy/home-backup.example.json` nach `~\.melonapp\home-backup.json` kopieren und ausfüllen.
   Optional: `Target` (Standard `~\MelonApp-Backups`), `IntervalDays` (30), `Keep` (12).
5. Einmal von Hand holen, dann die geplante Aufgabe einrichten:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\home-backup.ps1 -Force
   powershell -ExecutionPolicy Bypass -File scripts\home-backup.ps1 -Install
   ```

Das Skript lädt nur den neuesten `melon-*.dump.age`, prüft den age-Header (sonst wird die Datei
verworfen), behält die 12 neuesten und schreibt `home-backup.log`. Läuft es als geplante Aufgabe und scheitert, erscheint ein
Hinweisfenster. `-Uninstall` entfernt die Aufgabe. Der Rechner braucht dafür keinen Schlüssel.

**Wiederherstellen:**

Aus einem lokalen Dump auf dem Server (z. B. nach einem misslungenen Update):

```sh
bin/melon-restore backups/melon-20261112T033000Z.dump --yes
```

Aus einer verschlüsselten Kopie: auf dem **eigenen Rechner** entschlüsseln (fragt nach der
Passphrase), hochladen, einspielen, danach die Klartext-Datei auf beiden Seiten löschen. So
kommen Schlüssel und Passphrase nie auf den Server:

```powershell
age -d -i $HOME\.melonapp\melon-backup-key.age -o melon-restore.dump melon-20261112T033000Z.dump.age
scp melon-restore.dump root@app.example.com:/home/melon/melonapp/backups/
Remove-Item melon-restore.dump
```

```sh
bin/melon-restore backups/melon-restore.dump --yes && rm backups/melon-restore.dump
```

`bin/melon-restore` kann `.age` auch selbst (`--identity <Schlüsseldatei>`), etwa auf einem
frisch aufgesetzten Server. Dann aber Schlüsseldatei danach löschen und bedenken: Auf einem
übernommenen Server wären Schlüssel und Passphrase offen.

Das ersetzt die ganze Datenbank durch den Dump, stoppt dafür kurz den Server und startet ihn
wieder. Ein `.age`-Dump wird zuerst vollständig entschlüsselt: Falscher Schlüssel oder veränderte
Datei brechen ab, bevor die Datenbank angefasst wird.

Nur eigene Dumps einspielen: Ein manipulierter Dump könnte als Datenbank-Superuser Befehle im
Datenbank-Container ausführen. age prüft, dass die Datei unverändert ist, aber nicht, wer sie
verschlüsselt hat. Wer den öffentlichen Schlüssel kennt und auf die Box schreiben kann, könnte
also einen gültigen Dump unterschieben. Die Wiederherstellung einmal auf einem Testserver (oder
lokal) durchzuspielen gehört zur Einrichtung: Erst wenn man mit dem eingespielten Stand
entsperren kann, ist ein Backup eines.

## Optional: nur über Tailscale

Wer den Server nicht ins offene Internet stellen will, lässt Caddy nur im Tailscale-Netz
lauschen. Unterwegs braucht dann jedes Gerät Tailscale.
