---
title: "0007: Schlüssel leben im Web Worker"
description: Warum die Web-App ihre gesamte Kryptografie in einem Web Worker ausführt.
sidebar:
  order: 7
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Die Web-App muss Schlüssel ableiten (Argon2id, 64 MiB) und hunderte Einträge
ver- und entschlüsseln. Im Haupt-Thread würde die Ableitung die Oberfläche einfrieren,
und Schlüsselbytes lägen im selben JavaScript-Kontext wie React, alle Komponenten und
jede eingebundene Bibliothek.

## Entscheidung

`melon-crypto` läuft als WASM **in einem dedizierten Web Worker**. Schlüssel werden dort als
WASM-Objekte gehalten und verlassen den Worker nie. Der Haupt-Thread schickt nur Aufträge
(„entschlüssle diese Items“) und bekommt Ergebnisse zurück.

## Alternativen

- **Krypto im Haupt-Thread:** einfacher, aber die Oberfläche friert ein, und Schlüssel liegen
  im selben Kontext wie die Oberfläche.
- **WebCrypto statt WASM:** kein Argon2, keine XChaCha20. Es bräuchte eine zweite Implementierung.

## Folgen

- Eine Implementierung für alle Plattformen, auch im Browser.
- Alle Krypto-Aufrufe sind asynchron.
- Entschlüsselte *Einträge* liegen weiterhin im Haupt-Thread, weil sie angezeigt werden
  müssen. Geschützt ist das Schlüsselmaterial, nicht jeder angezeigte Klartext.
- In Tauri (Desktop/iOS) übernimmt seit [ADR 0015](/melonapp/entscheidungen/0015-native-apple-clients/)
  eine native Rust-Sitzung diese Grenze. Auch Authentifizierungsschlüssel bleiben dort
  nativ; die UI erhält dafür nur kurzlebige Handles.
