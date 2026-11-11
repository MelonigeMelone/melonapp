---
title: Desktop und iOS
description: Native Apple-App mit gemeinsamer React-Oberfläche.
---

Die Apple-App unter `apps/desktop` verwendet die Oberfläche aus `apps/web`. Ihr eigener
Vite-Einstieg ersetzt nur den Krypto-Transport. `melon-native` hält Konto-, Identitäts-
und Bereichsschlüssel in Rust. Rohschlüssel-Import und -Export sind im UI-Protokoll
nicht erlaubt. Web und Browser-Erweiterung verwenden weiterhin WASM im Worker.

## Anmeldung und Server

Auf dem Anmeldebildschirm die HTTPS-Adresse des eigenen Servers eintragen, ohne Pfad.
HTTP ist ausschließlich für Loopback-Adressen erlaubt. Native HTTP-Anfragen folgen
keinen Weiterleitungen und sind auf 30 Sekunden sowie 32 MiB Antwortgröße begrenzt.
Die WebView kann keine beliebigen Netzverbindungen öffnen; ausgenommen ist der
bestehende, ausdrücklich gestartete Datenleck-Abgleich mit `api.pwnedpasswords.com`; der Rust-Transport bedient
das bestehende API-Protokoll. Angezeigte Einträge und Sitzungstokens liegen weiterhin in React. Authentifizierungs-
und Entschlüsselungsschlüssel bleiben in Rust; der Login verwendet undurchsichtige
Handles, die nur der native HTTP-Transport auflösen kann. Der ausdrücklich angezeigte
Recovery-Key bleibt als Notfall-Kit für die Person sichtbar.

## Sperren und Cache

Rust sperrt nach fünf Minuten ohne gemeldete Eingabe, zusätzlich zum vorhandenen
UI-Timer. Fokusverlust sperrt sofort. `⌘⇧M` bringt auf macOS das Fenster nach vorn,
entsperrt es aber nicht. Hintergrund-Sperren werden als Ereignis an React gemeldet.

Erfolgreiche GET-Antworten werden zusätzlich mit dem Kontoschlüssel verschlüsselt unter
dem App-Datenverzeichnis gespeichert. Der authentifizierte Kontext enthält Server und
API-Pfad, Dateinamen sind SHA-256-Ableitungen dieses Kontextes. Temporäre Dateien haben
Modus 0600 und werden nach `sync_all` atomar umbenannt. Die erste Version verwendet
bewusst keine automatische Offline-Antwort: Mitgliedschaftsentzug und gelöschte
Einträge dürfen nicht unbemerkt durch veraltete Daten ersetzt werden.

## Touch ID und Face ID

Im Konto kann biometrisches Entsperren aktiviert oder deaktiviert werden. Der
Kontoschlüssel liegt ausschließlich in der Data Protection Keychain, mit
`biometryCurrentSet` und `WhenPasscodeSetThisDeviceOnly`, ohne iCloud-Synchronisation.
Der verschlüsselte Wiederaufnahmezustand enthält Identität und Sitzungsdaten.
Ein anderer Schlüssel, Server oder manipuliertes Dokument wird abgelehnt.

Ein fehlendes Entitlement, abgebrochene Biometrie oder nicht verfügbare Hardware führt
zu einem Fehler; es gibt keinen ungeschützten Ersatzspeicher. Nach Änderung der
registrierten Biometrie muss die Funktion mit dem Master-Passwort erneut eingerichtet
werden. Abgelaufene oder serverseitig widerrufene Sitzungen erfordern eine neue Anmeldung.
Simulator-Builds beweisen keine erfolgreiche Hardware-Authentifizierung.

## Bauen

```sh
source "$HOME/.cargo/env"
nvm use 22
npm ci
npm run tauri -w desktop -- build
open apps/desktop/src-tauri/target/release/bundle/macos/MelonApp.app
npm run tauri -w desktop -- ios build --target aarch64-sim --no-sign --ci
```

Die Bundle-IDs und App-Group stehen in [ADR 0015](/melonapp/entscheidungen/0015-native-apple-clients/).
Die Oberfläche berücksichtigt Safe Areas und verwendet mindestens 16 px große
Eingabeschrift, damit iOS Eingaben nicht automatisch vergrößert.

## iOS AutoFill und Passkeys

Unter „Konto“ veröffentlicht „Passwörter für iOS AutoFill aktualisieren“ nach einem
Sync eine verschlüsselte Kopie der Login-Einträge in der App Group. Die Extension
verwendet ausschließlich exakt passende HTTPS-Hosts und verlangt biometrisches
Entsperren. Der Snapshot ist höchstens 24 Stunden gültig; Änderungen erfordern eine
neue Veröffentlichung. Aktiviere anschließend MelonApp unter iOS **Einstellungen →
Allgemein → Automatisch ausfüllen & Passwörter** (die Bezeichnung variiert je iOS-Version).

Die Extension enthält iOS-17-Callbacks für Passkey-Registrierung und Assertions. Diese
Passkeys bleiben gerätelokal: keine Synchronisation, kein Export, keine
Wiederherstellungszusage. Biometrie, App-Group-Provisioning und echte Safari-Passkey-
Abläufe sind vor Einsatz mit wichtigen Konten noch auf einem Gerät zu prüfen.

Für Änderungen an der Extension:

```sh
bash scripts/test-apple-swift.sh
bash scripts/build-apple-ffi.sh iphonesimulator
xcodegen generate --spec apps/desktop/src-tauri/gen/apple/project.yml
npm run tauri -w desktop -- ios build --target aarch64-sim --no-sign --ci
```

Nicht erneut `tauri ios init` ausführen, um eigene Extension-Einstellungen zu erhalten.
Die Quelle des Xcode-Projekts ist `project.yml`; generierte UniFFI-Bindings und Libraries
werden nicht eingecheckt. Nach einem frischen Checkout zunächst `build-apple-ffi.sh`
ausführen, bevor XcodeGen das Projekt neu erzeugt. Das Skript legt auch die leeren,
nicht versionierten Tauri-Verzeichnisse `Externals` und `assets` an; XcodeGen benötigt
sie bereits vor dem ersten Tauri-iOS-Build.
