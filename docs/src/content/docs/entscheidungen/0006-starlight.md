---
title: "0006: Starlight für die Doku"
description: Warum die Doku mit Astro Starlight gebaut wird.
sidebar:
  order: 6
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Die Doku ist die einzige Quelle für das Warum ([0005](/melonapp/entscheidungen/0005-docs-statt-kommentare/)).
Sie muss deshalb leicht zu schreiben, schnell zu durchsuchen und kostenlos zu hosten sein.

## Entscheidung

**Starlight** (Astro): Markdown/MDX im Repo, eingebaute Volltextsuche (Pagefind, offline,
ohne externen Dienst), Dark Mode, „Seite bearbeiten“-Links, „zuletzt geändert“ aus Git.
Gehostet wird sie auf GitHub Pages.

## Alternativen

- **Docusaurus:** mächtig, aber schwerer und langsamer, React-lastig.
- **VitePress:** sehr gut, Vue-basiert. Die Apps nutzen aber React/TS.
- **MkDocs Material:** sehr gut, aber Python-Toolchain zusätzlich zu Rust und Node.

## Folgen

- Statische Seiten, nichts zu betreiben.
- Die Doku liegt als npm-Workspace im selben Monorepo und läuft durch dieselbe CI.
