---
title: "0019: CSP-Nonce für Styles statt 'unsafe-inline'"
description: Caddy erzeugt je Anfrage einen Nonce, Emotion versieht seine Style-Elemente damit. 'unsafe-inline' entfällt.
---

**Status:** angenommen · **Datum:** 2026-11-12 · ersetzt den CSP-Teil von [ADR 0008](/melonapp/entscheidungen/0008-mui/)

## Kontext

MUI nutzt Emotion, und Emotion schreibt CSS zur Laufzeit in `<style>`-Elemente. Deshalb
erlaubte die CSP der Web-App `style-src 'self' 'unsafe-inline'`
([ADR 0008](/melonapp/entscheidungen/0008-mui/#folge-für-die-content-security-policy)).
Damit kann eingeschleustes HTML beliebiges CSS mitbringen, etwa um Teile der Oberfläche zu
überdecken oder umzugestalten. ADR 0008 hatte Nonces verworfen, weil sie pro Anfrage erzeugtes
HTML brauchen und die Web-App statisch ist. Pigment CSS ist weiterhin nicht stabil.

## Entscheidung

Caddy erzeugt das „dynamische“ HTML selbst, ohne dass die App aufhört, statisch zu sein:

- Für `index.html` läuft Caddys `templates`-Modul (nur `text/html`). Es setzt
  `{{placeholder "http.request.uuid"}}` in `<meta name="csp-nonce">` ein.
- Derselbe Platzhalter `{http.request.uuid}` steht im CSP-Header:
  `style-src 'self' 'nonce-…'`. Er ist je Anfrage neu und zufällig (UUIDv4, 122 Bit).
- `main.tsx` liest den Nonce, entfernt das Meta-Tag und gibt den Wert an einen eigenen
  Emotion-Cache (`createCache({ key: 'css', nonce })`). Alle Style-Elemente von Emotion tragen
  damit den Nonce. Ohne gültigen Nonce (Entwicklungsserver, Desktop-App) bleibt er leer.
- `index.html` wird mit `Cache-Control: no-store` ausgeliefert. Sonst könnte der Browser eine
  gespeicherte Seite mit altem Nonce und einen neuen Header kombinieren, und die Styles fielen aus.
- Style-Attribute, die React per CSSOM setzt (`element.style`), sind von der CSP nicht betroffen.

## Alternativen

- **Pigment CSS:** weiterhin Version 0.0.x.
- **Hashes statt Nonce:** Emotion erzeugt je nach Zustand andere Regeln, Hashes ließen sich nicht
  vorab berechnen.
- **Server rendert `index.html`:** mehr Code im Rust-Server für etwas, das Caddy schon kann.

## Folgen

- Eingeschleustes `<style>` oder `style="…"` in Markup wird blockiert. Geprüft mit einem echten
  Browser gegen den kompletten Stack.
- `index.html` wird bei jedem Aufruf neu geladen (wenige hundert Byte). Die Assets bleiben ein
  Jahr im Cache.
- Die Desktop-App behält `'unsafe-inline'`: Ihre CSP ist fest in `tauri.conf.json`, ein Nonce je
  Aufruf geht dort nicht. Sie lädt aber nur eingebauten Code, kein HTML vom Server.
