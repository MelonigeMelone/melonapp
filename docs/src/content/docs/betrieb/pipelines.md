---
title: Pipelines
description: Die GitHub-Actions-Workflows und was sie tun.
sidebar:
  order: 3
---

| Workflow | Datei | Auslöser | Inhalt |
|---|---|---|---|
| CI | `ci.yml` | Push auf `main`, PR | `fmt`, `clippy -D warnings`, Tests mit PostgreSQL-Service, WASM-Build, Mindest-Rust-Version 1.85 |
| Security | `security.yml` | Push, PR, täglich 05:17 UTC, manuell | cargo-deny, gitleaks, CodeQL ([Details](/melonapp/sicherheit/pruefungen/)) |
| Server image | `docker.yml` | Push auf `main`, Tags `v*`, PR mit Rust-Änderungen | Docker-Image bauen und nach GHCR pushen (nicht bei PRs), mit SBOM und Provenance |
| Docs | `docs.yml` | Push auf `main` mit Änderungen in `docs/`, PR, manuell | Doku bauen und auf GitHub Pages veröffentlichen (nicht bei PRs) |

## Image-Tags

| Tag | Wann |
|---|---|
| `latest` | jeder Push auf `main` |
| `sha-<commit>` | jeder Push |
| `1.2.3` | Git-Tag `v1.2.3` |

Image: `ghcr.io/melonigemelone/melonapp-server`.

## Einmalige Einrichtung im Repo

- **Pages:** Settings → Pages → Source: *GitHub Actions*.
- **Private Vulnerability Reporting:** Settings → Code security → aktivieren.
- **Branch-Schutz für `main`:** CI und Security als Pflicht-Checks.
