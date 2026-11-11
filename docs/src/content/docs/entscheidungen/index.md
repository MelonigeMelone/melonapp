---
title: Entscheidungen
description: Architecture Decision Records – warum MelonApp so gebaut ist, wie es ist.
sidebar:
  order: 0
  label: Übersicht
---

Jede größere Entscheidung bekommt eine eigene Seite (ADR): Kontext, Entscheidung,
Alternativen, Folgen. So lässt sich später nachvollziehen, warum etwas so ist. Ändert sich
eine Entscheidung, bekommt die alte Seite den Status *ersetzt durch …*, statt gelöscht zu werden.

| Nr. | Entscheidung | Status |
|---|---|---|
| [0001](/melonapp/entscheidungen/0001-rust-kern/) | Rust für Krypto-Kern und Server | angenommen |
| [0002](/melonapp/entscheidungen/0002-tauri/) | Tauri 2 + React für alle Clients | angenommen |
| [0003](/melonapp/entscheidungen/0003-schluesselmodell/) | Abgeleiteter Auth-Key statt OPAQUE | angenommen |
| [0004](/melonapp/entscheidungen/0004-hosting/) | Docker Compose auf einem VPS statt Kubernetes | angenommen |
| [0005](/melonapp/entscheidungen/0005-docs-statt-kommentare/) | Doku als einzige Quelle für das Warum, Code ohne Kommentare | angenommen |
| [0006](/melonapp/entscheidungen/0006-starlight/) | Starlight für die Doku | angenommen |

Vorlage für neue ADRs: `docs/src/content/docs/entscheidungen/_vorlage.md`.
