---
title: "0028: Bereiche nur mit Zustimmung"
description: Wer ein bestehendes Konto in einen Bereich aufnimmt, macht nur ein Angebot. Der Bereich erscheint erst, wenn die Person annimmt.
---

**Status:** angenommen · **Datum:** 2026-11-13

## Kontext

Bisher konnte jedes Konto jedes andere Konto auf demselben Server sofort in einen eigenen Bereich
aufnehmen. Die E-Mail genügte. Der Bereich erschien dann bei der Person wie jeder andere, mit
allen Einträgen in Suche und beim Ausfüllen. Ein Angreifer mit eigenem Konto konnte so
untergeschobene Logins neben echte legen, etwa eine Bank-Anmeldung mit seiner eigenen URL.
Alles, was die Person versehentlich in diesem Bereich speicherte, konnte er lesen.

## Entscheidung

`POST /vaults/{id}/members` legt die Mitgliedschaft als **Angebot** an (`accepted = false`,
`added_by` = wer hinzugefügt hat). Solange die Person nicht angenommen hat,

- zeigt `GET /vaults` den Bereich bei ihr nicht, sondern nur unter `offers` mit Absender und Rolle,
- behandelt der Server sie bei allen anderen Endpunkten wie ein Nicht-Mitglied (`404`),
- zählt sie nicht als Besitzer, weder für `last_owner` noch für Einladungen.

Die Web-App zeigt Angebote auf der Startseite mit „Annehmen“ und „Ablehnen“.
`POST /vaults/{id}/accept` macht sie zum Mitglied. `POST /vaults/{id}/decline` entfernt die
Mitgliedschaft und setzt `rotation_needed`, weil die Person eine Kopie des Schlüssels bekommen
hatte. Wer sich über einen Einladungslink registriert, hat damit schon zugestimmt.

Für Besitzer erscheint die Person sofort in der Mitgliederliste, mit „Hat noch nicht zugestimmt“.
Beim Schlüsselwechsel gehört sie dazu wie jedes andere Mitglied mit Schlüssel.

## Alternativen

- **Nur im Client markieren und vom Ausfüllen ausnehmen:** Jede App (Web, Erweiterung, Desktop,
  iPhone-AutoFill) müsste das einzeln umsetzen, und der Server würde die Daten trotzdem ausliefern.
- **Schlüssel erst nach Annahme verschlüsseln:** Das bräuchte einen zweiten Schritt beim Besitzer
  wie bei wartenden Mitgliedern. Der Angreifer ist hier ein anderes Konto, nicht der Server, also
  reicht die Prüfung auf dem Server.

## Folgen

- Geteilte Bereiche brauchen einen Klick mehr bei der eingeladenen Person.
- Ältere Apps zeigen Angebote nicht an. Sie sehen den Bereich erst nach der Annahme in einer
  neuen App.
- Ein übernommener Server kann die Zustimmung weiter überspringen. Dagegen hilft sie nicht und
  soll sie nicht helfen: Gegen den Server schützen Sicherheitscode und
  [ADR 0027](/melonapp/entscheidungen/0027-authentisierte-tresor-schluessel/).
