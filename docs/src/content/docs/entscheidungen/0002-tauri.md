---
title: "0002: Tauri 2 + React für alle Clients"
description: Eine UI-Codebasis für Desktop, iOS und Android.
sidebar:
  order: 2
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Windows, macOS und iOS sollen von Anfang an unterstützt werden, Android später. Die App
soll schnell starten und den Rust-Kern direkt nutzen.

## Entscheidung

**Tauri 2** mit einer **React + TypeScript**-Oberfläche. Dieselbe React-App läuft als
Web-App (PWA). Für die iOS-AutoFill-Extension wird eine kleine native Swift-Extension
gebaut, die `melon-crypto` über UniFFI aufruft. Apple verlangt dafür native Extensions.

## Alternativen

- **Electron:** großer Speicherbedarf, kein Mobile.
- **React Native:** gut für Mobile, Desktop nur halb, keine gemeinsame Web-UI.
- **Flutter:** neue Sprache (Dart), Web-Version schwächer.
- **Nativ je Plattform:** drei- bis viermal so viel UI-Code.

## Folgen

- Kleine Installationsgröße, schneller Start, Rust direkt im Prozess.
- AutoFill (iOS) und Autofill Service (Android) bleiben nativer Code.
- Für iOS-Builds braucht es einen Mac oder einen GitHub-macOS-Runner und einen
  Apple-Developer-Account.
