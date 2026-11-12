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

1. Server anlegen (Ubuntu LTS), Docker installieren, Firewall nur für 22, 80 und 443 öffnen.
2. DNS-Eintrag (A/AAAA) für deine Domain auf den Server zeigen lassen.
3. Den Ordner `deploy/` auf den Server kopieren und dort:

```sh
cp .env.example .env
docker compose up -d
```

### `.env`

| Variable | Wert |
|---|---|
| `MELON_DOMAIN` | z. B. `vault.example.com` |
| `POSTGRES_PASSWORD` | `openssl rand -base64 48` |
| `MELON_SERVER_SECRET` | `openssl rand -base64 48` |
| `MELON_ALLOW_REGISTRATION` | zum Anlegen der Konten `true`, danach `false` und `docker compose up -d` |
| `MELON_CORS_ORIGINS` | nur für die Browser-Erweiterung (M4) nötig. Die Web-App läuft auf derselben Domain. |
| `MELON_IMAGE` | `ghcr.io/melonigemelone/melonapp-server:latest` |
| `MELON_WEB_IMAGE` | `ghcr.io/melonigemelone/melonapp-web:latest` (Caddy + Web-App) |

Alle Variablen des Servers: [Konfiguration](/melonapp/server/konfiguration/).

Danach `https://<deine-domain>` öffnen und unter **Konto erstellen** die Konten anlegen.
Anschließend die Registrierung wieder ausschalten.

## Updates

```sh
docker compose pull && docker compose up -d
```

Für einen festen, geprüften Stand die Images in der `.env` auf einen Commit festlegen statt
`latest` zu ziehen. Jeder Build auf `main` bekommt einen Tag `sha-<kurzer Commit>`:

```sh
MELON_IMAGE=ghcr.io/melonigemelone/melonapp-server:sha-4a66521
MELON_WEB_IMAGE=ghcr.io/melonigemelone/melonapp-web:sha-4a66521
```

Ein Update ist dann bewusst: Tag ändern, `docker compose up -d`.

## Backups

Nächtlich per `pg_dump` auf eine Hetzner Storage Box. Die Inhalte sind ohnehin
Ende-zu-Ende verschlüsselt. Ohne Master-Passwort oder Recovery-Key ist ein Backup wertlos,
für einen Dieb ebenso wie für dich.

```sh
docker compose exec -T db pg_dump -U melon melon | gzip > melon-$(date +%F).sql.gz
```

## Optional: nur über Tailscale

Wer den Server nicht ins offene Internet stellen will, lässt Caddy nur im Tailscale-Netz
lauschen. Unterwegs braucht dann jedes Gerät Tailscale.
