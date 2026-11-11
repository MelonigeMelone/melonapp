---
title: Pipelines
description: Die GitHub-Actions-Workflows und was sie tun.
sidebar:
  order: 3
---

| Workflow | Datei | Auslöser | Inhalt |
|---|---|---|---|
| CI | `ci.yml` | Push auf `main`, PR | `fmt`, `clippy -D warnings`, Rust-Tests mit PostgreSQL, Mindest-Rust-Version 1.85, Web-App (WASM-Build, Tests, Build), **E2E**: kompletter Stack per Compose + Browser-Test + Prüfung, dass die Datenbank keinen Klartext enthält |
| Security | `security.yml` | Push, PR, täglich 05:17 UTC, manuell | cargo-deny, gitleaks, CodeQL ([Details](/melonapp/sicherheit/pruefungen/)) |
| Images | `docker.yml` | Push auf `main`, Tags `v*`, PR mit Code-Änderungen | Images `melonapp-server` und `melonapp-web` bauen und nach GHCR pushen (nicht bei PRs), mit SBOM und Provenance |
| Docs | `docs.yml` | Push auf `main` mit Änderungen in `docs/`, PR, manuell | Doku bauen und auf GitHub Pages veröffentlichen (nicht bei PRs) |

## Image-Tags

| Tag | Wann |
|---|---|
| `latest` | jeder Push auf `main` |
| `sha-<commit>` | jeder Push |
| `1.2.3` | Git-Tag `v1.2.3` |

Images: `ghcr.io/melonigemelone/melonapp-server` und `ghcr.io/melonigemelone/melonapp-web`.

## Öffentliches oder privates Repo

CodeQL und GitHub Pages sind für **öffentliche** Repos kostenlos. Bei einem privaten Repo
brauchen sie einen kostenpflichtigen Plan (Advanced Security bzw. Pro). Deshalb laufen der
CodeQL-Job und das Veröffentlichen der Doku nur, wenn das Repo öffentlich ist. Gebaut wird
die Doku trotzdem immer, damit kaputte Seiten auffallen.

Ein öffentliches Repo schadet der Sicherheit nicht. Das Modell hängt nicht an geheimem
Code, sondern an Schlüsseln, die nur auf den Geräten existieren. Secrets gehören nie ins
Repo, das prüft gitleaks.

## Einmalige Einrichtung im Repo

- **Pages:** Settings → Pages → Source: *GitHub Actions*.
- **Private Vulnerability Reporting:** Settings → Code security → aktivieren.
- **Branch-Schutz für `main`:** CI und Security als Pflicht-Checks.
