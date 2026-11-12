---
title: Regeln
description: Wie Code und Doku in MelonApp geschrieben werden – für Menschen und KI-Agenten.
sidebar:
  order: 1
---

## Code und Doku

- **Keine Kommentare im Code** ([ADR 0005](/melonapp/entscheidungen/0005-docs-statt-kommentare/)).
  Statt eines Kommentars: besserer Name, kleinere Funktion, Test, und das Warum hier in der Doku.
- **Doku im selben PR:** Wer Verhalten, API, Datenmodell, Konfiguration oder Sicherheit
  ändert, aktualisiert die zugehörige Seite.
- **Neue Grundsatzentscheidung → neues ADR** in `entscheidungen/`, nach der Vorlage `_vorlage.md`.

### Welche Seite?

| Änderung | Seite |
|---|---|
| Krypto, Schlüssel, Formate | `sicherheit/kryptografie.md`, ggf. `sicherheit/modell.md` |
| Endpunkt neu/geändert | `server/api.md` |
| Login, Sitzungen, Limits | `server/authentifizierung.md` |
| Sync-Verhalten | `server/sync.md` |
| Migration | `server/datenbank.md` |
| Umgebungsvariable | `server/konfiguration.md` und `betrieb/selbst-hosten.md` |
| Web-App: Verhalten, Sync, Schutzmaßnahmen, Design | `clients/web.md` |
| Neues Modul | `konzept/module.md`, Eintrag in `modules/registry.ts` |
| Browser-Erweiterung | `clients/erweiterung.md` |
| Workflow | `betrieb/pipelines.md` |
| Neuer Sicherheitstest | Tabelle in `sicherheit/pruefungen.md` |
| Bekannte Lücke | `sicherheit/offene-punkte.md`, und ein Issue, wenn sie behoben werden soll |

## Offene Arbeit

- **Jede offene Aufgabe ist ein [GitHub Issue](https://github.com/MelonigeMelone/melonapp/issues)**
  ([ADR 0017](/melonapp/entscheidungen/0017-issues-fuer-offene-arbeit/)). Keine TODO-Listen,
  `HANDOFF.md` oder Checklisten in Markdown-Dateien.
- Labels: Bereich (`apple`, `web`, `erweiterung`, `server`, `krypto`, `betrieb`) plus bei Bedarf
  `sicherheit`, `manuell` (braucht Hardware, Konten oder Handarbeit) und `blockiert`
  (mit „Blockiert durch #NN“ im Text).
- Milestones folgen dem [Fahrplan](/melonapp/konzept/fahrplan/).
- Das [Board](https://github.com/users/MelonigeMelone/projects/9) zeigt den Stand: Backlog,
  Als Nächstes, In Arbeit, Blockiert, Fertig. Neue Issues kommen dort in den Backlog.
- Der PR schließt sein Issue mit `Fixes #NN`. Was am Ende einer Sitzung offen bleibt,
  wird ein neues Issue oder ein Kommentar am bestehenden.
- Schwachstellen nie als Issue, sondern über **Security → Report a vulnerability**.

## Sicherheit

1. Keine eigene Kryptografie. Nur geprüfte Crates (RustCrypto, dalek).
2. Jede Änderung an `melon-crypto` oder an der Authentifizierung braucht Tests für den
   **Fehler- und Angriffsfall**, nicht nur für den Erfolgsfall.
3. Niemals Secrets, Tokens, Auth-Keys oder Klartext loggen oder in Fehlerantworten zurückgeben.
4. Schlüsselmaterial wird in `Zeroize`-Typen gehalten und implementiert kein `Debug`.
5. Kein `unsafe` (im Workspace auf `forbid` gesetzt).
6. Der Server darf nie etwas entschlüsseln können. Nutzerinhalte gehören in das
   verschlüsselte `data` eines Items.
7. Vor dem Merge von Änderungen an Krypto, Auth oder Datenzugriff läuft ein Security-Review
   (bei Claude Code: `/security-review`).

## Ablauf

- Arbeit auf Feature-Branches, Merge nach `main` per Pull Request.
- CI und Security müssen grün sein.
- Commit-Nachrichten auf Englisch im Imperativ (`Add TOTP module`). Die Doku ist auf Deutsch.
