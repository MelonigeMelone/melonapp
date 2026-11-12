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
| [0007](/melonapp/entscheidungen/0007-schluessel-im-worker/) | Schlüssel leben im Web Worker | angenommen |
| [0008](/melonapp/entscheidungen/0008-mui/) | MUI als Komponentenbibliothek | angenommen |
| [0009](/melonapp/entscheidungen/0009-tresor-schluessel/) | Tresor-Schlüssel und Schlüsselpaare (HPKE) | angenommen |
| [0010](/melonapp/entscheidungen/0010-keine-logos/) | Keine Logos von Websites | angenommen |
| [0011](/melonapp/entscheidungen/0011-recovery-und-sicherheitscode/) | Recovery-Key und Sicherheitscode | angenommen |
| [0012](/melonapp/entscheidungen/0012-app-shell-und-bereiche/) | App-Rahmen, Module und Bereiche | angenommen |
| [0013](/melonapp/entscheidungen/0013-browser-erweiterung/) | Browser-Erweiterung | angenommen |
| [0014](/melonapp/entscheidungen/0014-2fa-und-sicherheits-check/) | 2FA-Codes und Sicherheits-Check | angenommen |
| [0015](/melonapp/entscheidungen/0015-native-apple-clients/) | Native Apple-Clients und Schlüsselisolation | angenommen |
| [0016](/melonapp/entscheidungen/0016-ios-autofill-und-passkeys/) | iOS AutoFill, UniFFI und lokale Passkeys | angenommen |
| [0017](/melonapp/entscheidungen/0017-issues-fuer-offene-arbeit/) | GitHub Issues für offene Arbeit | angenommen |

Vorlage für neue ADRs: `docs/src/content/docs/entscheidungen/_vorlage.md`.
