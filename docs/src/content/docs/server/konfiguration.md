---
title: Konfiguration
description: Umgebungsvariablen von melon-server und HTTP-Schutzmaßnahmen.
sidebar:
  order: 5
---

## Umgebungsvariablen

| Variable | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `MELON_DATABASE_URL` | ✓ | – | PostgreSQL-URL |
| `MELON_SERVER_SECRET` | ✓ | – | mind. 32 Zeichen, erzeugt die Fake-Salts. Erzeugen mit `openssl rand -base64 48`. Ändert es sich, ändern sich die Fake-Salts, das ist unkritisch. |
| `MELON_BIND` | | `0.0.0.0:8080` | Adresse und Port |
| `MELON_ALLOW_REGISTRATION` | | `false` | `true`/`1`/`yes` öffnet die Registrierung. Danach wieder ausschalten. |
| `MELON_SESSION_TTL_HOURS` | | `336` (14 Tage) | Lebensdauer einer Sitzung, 1–8760 |
| `MELON_CORS_ORIGINS` | | leer | kommagetrennte Browser-Origins (Web-App, Erweiterung). Leer heißt: kein Browser-Zugriff von fremden Origins. |
| `MELON_TRUST_PROXY` | | `false` | `true`, wenn der Server **nur** über einen eigenen Reverse Proxy erreichbar ist. Dann gilt der letzte Eintrag von `X-Forwarded-For` als Client-Adresse für die Sperre pro Adresse ([Authentifizierung](/melonapp/server/authentifizierung/)). Die mitgelieferte Compose-Datei setzt das, weil der Server dort keinen eigenen Port hat. Nie setzen, wenn der Server direkt aus dem Internet erreichbar ist: Dann könnte jeder die Sperre mit einem gefälschten Header umgehen. |
| `RUST_LOG` | | `info` | Log-Level, Ausgabe als JSON |

## HTTP-Schutz

Jede Antwort trägt:

| Header | Wert | Warum |
|---|---|---|
| `Cache-Control` | `no-store` | keine Tresor-Daten in Browser- oder Proxy-Caches |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | die API liefert nie ausführbare Inhalte |
| `X-Content-Type-Options` | `nosniff` | |
| `X-Frame-Options` | `DENY` | kein Einbetten (Clickjacking) |
| `Referrer-Policy` | `no-referrer` | |
| `Cross-Origin-Resource-Policy` | `same-origin` | |
| `Strict-Transport-Security` | 2 Jahre, setzt Caddy | nur HTTPS |

Zusätzlich gilt ein Body-Limit von 1 MiB pro Anfrage und 64 KiB pro Item.

Fehler mit dem Status `500` erscheinen nach außen nur als `internal`. Die Ursache steht
im Log. Bodies, Tokens und Schlüssel werden nie geloggt.
