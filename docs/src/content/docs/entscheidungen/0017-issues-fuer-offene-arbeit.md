---
title: "0017: GitHub Issues für offene Arbeit"
description: Offene Aufgaben stehen als Issues mit Labels und Milestones, nicht in Markdown-Dateien.
---

**Status:** angenommen · **Datum:** 2026-11-12

## Kontext

Offene Aufgaben lagen verstreut in `HANDOFF.md`, in Checklisten und Tabellen der Doku
und in Übergabetexten von Agenten-Sitzungen. Niemand sah auf einen Blick, was als Nächstes
ansteht, was blockiert ist und was erledigt wurde. Die Doku mischte dadurch Wissen
(wie und warum) mit Arbeit (was noch fehlt).

## Entscheidung

- Jede offene Aufgabe ist ein [GitHub Issue](https://github.com/MelonigeMelone/melonapp/issues).
- Labels ordnen nach Bereich (`apple`, `web`, `erweiterung`, `server`, `krypto`, `betrieb`)
  und Zustand (`sicherheit`, `manuell`, `blockiert`).
- [Milestones](https://github.com/MelonigeMelone/melonapp/milestones) entsprechen dem
  [Fahrplan](/melonapp/konzept/fahrplan/), dazu „Vor dem echten Einsatz“ für die Härtung.
- Ein PR schließt sein Issue mit `Fixes #NN`.
- Die Doku beschreibt nur den Ist-Zustand und bewusste Grenzen. Wo eine Grenze behoben
  werden soll, verweist sie auf das Issue.
- Übergaben zwischen Sitzungen stehen im Issue und in der PR-Beschreibung, nicht in
  `HANDOFF.md` oder ähnlichen Dateien.

## Alternativen

- **Eine zentrale Markdown-Seite:** kein Status, keine Verknüpfung mit PRs, veraltet still.
- **Trello oder Notion:** ein weiterer Ort, der von Hand mit Code und PRs abgeglichen werden muss,
  und für Agenten ohne eigene Anbindung nicht erreichbar.

## Folgen

- Agenten lesen und schließen Aufgaben über `gh`, eine Sitzung startet mit „arbeite an #NN“.
- Das Repo ist öffentlich, Issues also auch. Schwachstellen werden weiterhin nur über
  **Security → Report a vulnerability** gemeldet, nie als Issue.
- Aufgaben ohne Issue gelten als nicht geplant.
