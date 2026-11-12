---
title: "0018: Aurora-Design statt Wassermelonen-Farben"
description: Kühle, dunkle Aurora-Gestaltung mit Violett und Eisblau, echter Dunkelmodus und dezenten Animationen.
---

**Status:** angenommen · **Datum:** 2026-11-12

## Kontext

Die erste Gestaltung nahm die Farben einer Wassermelone: Grün als Fläche, Rot als Akzent.
Im Dunkelmodus wirkte das wie eingefärbtes Grün und nicht wie ein echter Dunkelmodus. Gewünscht
ist ein schlichter, aber eindrucksvoller Auftritt in Hell und Dunkel.

## Entscheidung

- **Palette:** Violett (`primary`) und Eisblau (`secondary`) als einzige Akzente. Rot und Grün
  bleiben nur für Fehler- und Erfolgsmeldungen.
- **Echter Dunkelmodus:** fast schwarzer Grund (`#05060A`), Flächen kaum heller (`#0D0F17`).
  Der Hellmodus nutzt dieselbe Linie auf kühlem Weiß.
- **Aurora-Hintergrund:** drei weichgezeichnete Farbflächen wandern sehr langsam (38–54 s pro
  Runde). Darüber liegt ein feines Punktraster, sonst bleibt die Fläche leer.
- **Glas und Schein:** Leisten und Karten sind halbtransparent, der Haupt-Button hat einen Verlauf
  und farbigen Schein. Die Anmeldeseite bekommt Schimmer-Schriftzug und umlaufenden Lichtrand.
- **Bewegung:** nur mit CSS-Transform und Opacity, abgeschaltet bei `prefers-reduced-motion`.
- Das Logo behält die Melonenscheibe als Form, jetzt im Verlauf statt in Rot und Grün.

## Alternativen

- **Wassermelonen-Farben behalten:** wiedererkennbar, aber unruhig und kein echter Dunkelmodus.
- **Komplett flach ohne Bewegung:** ruhig, aber ohne den gewünschten Wow-Effekt.
- **Animationsbibliothek (z. B. Framer Motion):** mehr Möglichkeiten, aber zusätzliche
  Abhängigkeit. CSS-Keyframes über Emotion reichen.

## Folgen

- Alle Farben kommen weiter nur aus dem Theme. Feste Hex-Werte gibt es nur in `theme.ts` und
  in `MelonTheme` der iOS-Extension.
- `backdrop-filter` und weichgezeichnete Flächen kosten etwas GPU. Die Bewegung ist bewusst
  langsam und nutzt nur `transform`.
- Die iOS-AutoFill-Extension übernimmt die Farben in Swift. Prüfen lässt sie sich nur auf
  einem Mac mit Xcode.
