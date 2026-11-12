---
title: Pipelines
description: Die GitHub-Actions-Workflows und was sie tun.
sidebar:
  order: 3
---

| Workflow | Datei | Auslöser | Inhalt |
|---|---|---|---|
| CI | `ci.yml` | Push auf `main`, PR | ShellCheck für `deploy/bin/*`, `fmt`, `clippy -D warnings`, Rust-Tests mit PostgreSQL, Mindest-Rust-Version 1.87, Web-App und Erweiterung (WASM-Build, Tests, Build, Erweiterung als Artefakt `melonapp-extension`), **E2E**: kompletter Stack per Compose + Browser-Test der Web-App + Test der Erweiterung in Chromium + Prüfung, dass die Datenbank keinen Klartext enthält |
| Security | `security.yml` | Push, PR, täglich 05:17 UTC, manuell | cargo-deny (auch für die Apple-Abhängigkeiten), npm audit (Produktionsabhängigkeiten, ab „high“), gitleaks, CodeQL, Fuzzing (nur täglich und manuell) ([Details](/melonapp/sicherheit/pruefungen/)) |
| Images | `docker.yml` | Push auf `main`, Tags `v*`, PR mit Code-Änderungen | Images `melonapp-server` und `melonapp-web` bauen und nach GHCR pushen (nicht bei PRs), mit SBOM und Provenance. Bei einem Tag `v*` danach Job **Deploy**: Update des Servers per SSH ([Selbst hosten](/melonapp/betrieb/selbst-hosten/#updates-version-per-tag)) |
| Docs | `docs.yml` | Push auf `main` mit Änderungen in `docs/`, PR, manuell | Doku bauen und auf GitHub Pages veröffentlichen (nicht bei PRs) |

## Image-Tags

| Tag | Wann |
|---|---|
| `latest` | jeder Push auf `main` |
| `sha-<commit>` | jeder Push |
| `1.2.3` | Git-Tag `v1.2.3` |

Images: `ghcr.io/melonigemelone/melonapp-server` und `ghcr.io/melonigemelone/melonapp-web`.

## Öffentliches oder privates Repo

Alle Actions sind auf einen **Commit-SHA** festgelegt, die Version steht als Kommentar dahinter
(`actions/checkout@3d3c42e… # v7.0.1`). Ein Tag wie `v7` kann nachträglich auf anderen Code
zeigen, ein SHA nicht. Dependabot erkennt den Kommentar und hebt SHA und Kommentar gemeinsam an.
Bei `dtolnay/rust-toolchain` steht die Rust-Version als Eingabe `toolchain`.

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

## Apple-Apps

`apple.yml` baut auf `macos-15` die macOS-App und das ARM64-iOS-Simulator-Bundle
inklusive Credential Provider Extension. Vorher laufen Rust-Angriffstests,
Tauri-Lint/Tests sowie Swift-Tests gegen die tatsächlich erzeugten UniFFI-Bindings.
XcodeGen erzeugt das Projekt aus der versionierten `project.yml`. Die Artefakte sind
unsignierte Entwicklungsstände; Hardware-Biometrie, Provisioning und App-Store-
Distribution sind damit nicht bestätigt. Der Apple-Job läuft auch bei Pushes auf
`feat/apple-apps`, damit die Nachtarbeit ohne fertigen PR geprüft werden kann.

Der Apple-Job prüft mit `cargo-deny` auch den getrennten Tauri-Workspace für macOS
und iOS. Der vollständige plattformübergreifende Tauri-Graph enthält zusätzlich
eine ungewartete Linux-GTK-Build-Abhängigkeit (`proc-macro-error`); sie wird nicht
für die Apple-Targets gebaut. Für das reine UniFFI-Generatorwerkzeug besteht eine begründete Wartungsausnahme
([Apple-Review](/melonapp/sicherheit/apple-review/)); echte Schwachstellen werden nicht
unterdrückt. Der nächtliche Security-Workflow und Dependabot erfassen auch den
getrennten Tauri-Workspace.
