---
title: "0015: Native Apple-Clients und Schlüsselisolation"
description: Gemeinsame React-UI, native Rust-Sitzungen und biometrisch geschützter Cache.
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Desktop und iOS sollen die vorhandene Oberfläche verwenden. Der Web Worker schützt
Web-Schlüssel gemäß ADR 0007; auf Apple-Geräten kann Rust dieselbe Grenze ohne WASM
bereitstellen. AutoFill benötigt einen nativen Swift-Einstieg.

## Entscheidung

`apps/desktop` baut die React-UI aus `apps/web`. `melon-native` verwaltet Schlüssel,
Verschlüsselung und Sperrzustand im Rust-Prozess. Tauri reicht nur explizit erlaubte
Operationen weiter; Import und Export roher Schlüssel sind dort ausgeschlossen.
Authentifizierungsschlüssel werden im gemeinsamen Login-Protokoll durch zufällige
Handles ersetzt. Nur der native HTTP-Transport löst diese vor dem Versand auf.
Sperren verwirft alle Handles.

Der Cache wird mit `melon-crypto` authentifiziert verschlüsselt. Die Bindung an Konto
und Format erfolgt über Additional Authenticated Data. Biometrisches Entsperren ist
optional und darf nur mit Keychain-Zugriffskontrolle für den aktuell registrierten
biometrischen Satz funktionieren; kein stiller ungeschützter Ersatz. Native Fristen
und Sperren bei Hintergrundwechsel ergänzen den UI-Timer.

Bundle-IDs: `de.melonigemelone.app`, `de.melonigemelone.app.autofill`; App Group:
`group.de.melonigemelone.app`. Eine App Group ersetzt keine Verschlüsselung.
UniFFI stellt Swift dieselbe native Logik bereit. Generierte FFI-Bindings sind eine
technische Grenze; handgeschriebener Rust-Code behält `unsafe_code = forbid`.

## Alternativen

- WASM übernehmen: einfacher, nutzt aber den nativen Kern und Keychain nicht direkt.
- Zweite Swift-Kryptografie: mehr Aufwand und unterschiedliche Sicherheitslogik.
- Schlüssel an React liefern: widerspricht der gewünschten Isolation.

## Folgen

Web und Extension behalten ihren Worker. Native Clients haben eine eigene Transport-
und Lebenszyklusgrenze, aber keine zweite UI oder Kryptografie. Simulator-Builds
ersetzen keine Prüfung von Touch ID, Face ID, Signierung und AutoFill auf Geräten.
