---
title: "0005: Doku als einzige Quelle für das Warum"
description: Code ohne Kommentare, Erklärungen ausschließlich in docs/.
sidebar:
  order: 5
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Das Projekt wird ein großes Monorepo. Kommentare im Code veralten unbemerkt, verteilen
Wissen über viele Dateien und widersprechen sich irgendwann mit der Doku.

## Entscheidung

- **Code enthält keine Kommentare**, auch keine Doc-Comments (`///`, `//!`). Der Code
  sagt *was* passiert, durch gute Namen, kleine Funktionen und Tests.
- **Warum** und **wie es zusammenhängt** steht ausschließlich in `docs/`.
- Eine Änderung, die Verhalten, Sicherheit, API oder Datenmodell betrifft, ändert die
  passende Doku-Seite **im selben PR**.

Ausnahmen: technisch nötige Direktiven wie `# syntax=` im Dockerfile oder `// @ts-check`.

## Folgen

- Eine Quelle der Wahrheit: Code für das Was, Doku für das Warum.
- Reviews prüfen die Doku mit (siehe PR-Vorlage).
- Kein `cargo doc` mit Erklärtexten. Die API-Referenz steht in der Doku.
