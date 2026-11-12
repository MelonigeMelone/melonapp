---
title: Desktop und iOS
description: Native Apple-App mit gemeinsamer React-Oberfläche.
---

Die Apple-App unter `apps/desktop` verwendet die Oberfläche aus `apps/web`. Ihr eigener
Vite-Einstieg ersetzt nur den Krypto-Transport. Der native TypeScript-Build beginnt
bei diesem Einstieg und prüft die transitiv importierte gemeinsame UI; der ausschließlich
im Browser verwendete WASM-Worker gehört nicht zum nativen Build. `melon-native` hält Konto-, Identitäts-
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

Der Face-ID-Dialog macht die iOS-App kurz inaktiv (`sceneWillResignActive`), was wie jeder
Fokusverlust sperrt. Nach erfolgreicher Biometrie wartet das Entsperren deshalb bis zu zwei
Sekunden, bis die App wieder aktiv ist, und stellt die Sitzung erst dann unter derselben
Sperre wieder her. Bleibt die App inaktiv oder im Hintergrund, scheitert es mit
`background_locked`; einen Weg, im Hintergrund zu entsperren, gibt es weiterhin nicht.

Biometrisch geschützte Schlüsselbund-Einträge werden beim Neu-Einrichten und beim
Aktualisieren des AutoFill-Caches erst gelöscht und dann neu angelegt, nie per
`SecItemUpdate` überschrieben. Ein Update verlangt Face ID, und der Dialog würde die App
inaktiv machen und den offenen Tresor sperren.

Jedes Sperren meldet beim Server ab, auch die nativen (Fokusverlust, iOS-Suspendieren,
Rust-Timer). **Ausnahme:** Das Sitzungstoken ist genau das, das im biometrischen
Wiederaufnahmezustand steckt. Dafür speichert die App beim Aktivieren
`biometric.token` = SHA-256(`melon/biometric-token\0` ‖ Server ‖ `\0` ‖ Token). Ein später per
Passwort geholtes Token oder eines für einen anderen Server wird also abgemeldet. Das
biometrisch genutzte Token läuft nach der normalen Sitzungsdauer ab.

Schlägt das Entsperren fehl (falsches Passwort), verwirft die native Sitzung alles, auch den
schon abgeleiteten Login-Nachweis. Ein Serverwechsel wird nur abgelehnt, solange ein Tresor
offen ist. Eine begonnene, aber nicht abgeschlossene Anmeldung (z. B. falsche Server-Adresse)
wird beim Wechsel verworfen, ihr Login-Nachweis geht also nie an den neuen Server.

Erfolgreiche GET-Antworten werden zusätzlich mit dem Kontoschlüssel verschlüsselt unter
dem App-Datenverzeichnis gespeichert. Der authentifizierte Kontext enthält Server und
API-Pfad, Dateinamen sind SHA-256-Ableitungen dieses Kontextes. Temporäre Dateien haben
Modus 0600 und werden nach `sync_all` atomar umbenannt. Die erste Version verwendet
bewusst keine automatische Offline-Antwort: Mitgliedschaftsentzug und gelöschte
Einträge dürfen nicht unbemerkt durch veraltete Daten ersetzt werden.

## Touch ID und Face ID

Im Konto zeigt eine eigene Karte den gespeicherten Einrichtungsstatus für das aktuelle
Konto und diesen Server an. Beim Öffnen wird der Status nativ neu geprüft; die Anzeige
beruht weder auf einem früheren UI-Klick noch auf dem aktuellen Sitzungstoken. Aktivieren,
Neu-Einrichten und Deaktivieren zeigen einen Ladezustand sowie eine sichtbare Inline-
Bestätigung oder Fehlermeldung. Eine Erfolgsmeldung erscheint erst nach erneutem Lesen
des erwarteten Status; ein Lesefehler wird als „Status unbekannt“ mit Wiederholen-Aktion angezeigt.
Auch die iOS-AutoFill-Veröffentlichung meldet ihr Ergebnis direkt in dieser Karte.

„Einrichtung gespeichert“ bedeutet: Wiederaufnahme-Datei und Token-Marker sind vorhanden,
und die native, noch entsperrte Kontositzung kann die Datei im biometrischen Kontext
authentifizieren. Die Abfrage liest keine Schlüssel aus der Keychain, löst keine Biometrie
aus, gibt nur einen Wahrheitswert zurück und verlängert die Sperrfrist nicht. Sie bestätigt
weder aktuelle Keychain-Verfügbarkeit noch gültige Server-Sitzung oder biometrischen Erfolg;
diese Prüfungen bleiben Teil des tatsächlichen Entsperrens. Nach Änderungen an registrierten
Fingerabdrücken oder Face ID kann die Person „Neu einrichten“ verwenden.

Im Konto kann biometrisches Entsperren aktiviert oder deaktiviert werden. Der
Kontoschlüssel liegt ausschließlich in der Data Protection Keychain, mit
`biometryCurrentSet` und `WhenPasscodeSetThisDeviceOnly`, ohne iCloud-Synchronisation.
Der verschlüsselte Wiederaufnahmezustand enthält Identität und Sitzungsdaten. Er hat einen
eigenen Verschlüsselungskontext (`melon/native/biometric/v1/…`), getrennt vom API- und
AutoFill-Cache (`melon/native/cache/v1/…`). Eine zwischengespeicherte Server-Antwort lässt sich
so nie als Wiederaufnahmezustand ausgeben. Ein anderer Schlüssel, Server oder manipuliertes
Dokument wird abgelehnt.

„Biometrisches Entsperren deaktivieren“ löscht den Schlüsselbund-Eintrag und den
Wiederaufnahmezustand, auf iOS zusätzlich den AutoFill-Schlüssel (`de.melonapp.autofill.v1`),
die Passwort-Kopie in der App Group und `active.txt`. Gespeicherte Passkeys bleiben
verschlüsselt erhalten und sind nach erneutem Aktivieren wieder nutzbar.

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

Die Extension enthält iOS-17-Callbacks für Passkey-Registrierung und Assertions. Die
Authenticator-Daten melden BE und BS („gesichert“), weil iOS Passkeys von Drittanbietern sonst
ablehnt (siehe [ADR 0016](/melonapp/entscheidungen/0016-ios-autofill-und-passkeys/)).

Neue Passkeys landen zuerst als einzelne Datei im Briefkasten der App Group
(`{scope}.outbox.{id}.enc`). Nach jedem Entsperren übernimmt die App sie als Eintrag vom Typ
„Passkey“ in den persönlichen Bereich und löscht die Datei erst danach. Ist AutoFill für das
Konto schon aktiv, veröffentlicht die App gleich neu; dabei landen alle Passkeys aus dem
Tresor als `{scope}.synced.enc` bei der Extension. Ein neues iPhone bekommt so nach Anmelden,
Face ID einrichten und „Passwörter für iOS AutoFill aktualisieren“ alle Passkeys zurück
([ADR 0022](/melonapp/entscheidungen/0022-passkeys-im-tresor/)). Alte gerätelokale Passkeys
aus `{scope}.passkeys.enc` werden dabei einmalig mit übernommen. Bei jedem entsperrten Aufruf
ersetzt die Extension die Passkey-Vorschläge von iOS durch die aktuelle Liste.

Die Extension nutzt dieselben Farben wie die App (`MelonTheme` in
`CredentialProviderViewController.swift`): fast schwarzer bzw. kühl-weißer Hintergrund und
Violett als Akzent, je nach Systemmodus. Buttons sind Pillen, „Abbrechen“ ist zurückhaltend getönt.
Gefüllte Buttons tragen wie in der Web-App im Dunkelmodus dunkle Schrift (`#0A0818`, Kontrast 6,9 : 1),
weil Weiß auf dem hellen Violett nur 2,9 : 1 erreicht.

Für Änderungen an der Extension:

```sh
bash scripts/test-apple-swift.sh
bash scripts/build-apple-ffi.sh iphonesimulator
xcodegen generate --spec apps/desktop/src-tauri/gen/apple/project.yml
npm run tauri -w desktop -- ios build --target aarch64-sim --no-sign --ci
```

Die Extension bindet `melon-ffi` statisch ein (`$(MELON_FFI_DIR)/libmelon_ffi.a`). Mit
`-lmelon_ffi` wählte der Linker die ebenfalls gebaute `libmelon_ffi.dylib` mit absolutem Pfad
auf dem Build-Mac: im Simulator unauffällig, auf dem iPhone stürzte die Extension beim Start ab
(„Library not loaded“). Die Apple-CI prüft deshalb mit `otool -L`, dass die Extension nur
System-Bibliotheken lädt.

Nicht erneut `tauri ios init` ausführen, um eigene Extension-Einstellungen zu erhalten.
Die Quelle des Xcode-Projekts ist `project.yml`; generierte UniFFI-Bindings und Libraries
werden nicht eingecheckt. Nach einem frischen Checkout zunächst `build-apple-ffi.sh`
ausführen, bevor XcodeGen das Projekt neu erzeugt. Das Skript legt auch die leeren,
nicht versionierten Tauri-Verzeichnisse `Externals` und `assets` an; XcodeGen benötigt
sie bereits vor dem ersten Tauri-iOS-Build.

## Registrierte Apple-Identifier

Die registrierten Bundle-IDs sind `de.melonigemelone.app` und
`de.melonigemelone.app.autofill`; beide Targets verwenden die App Group
`group.de.melonigemelone.app`. App Groups und AutoFill Credential Provider müssen
für beide App-IDs aktiviert sein. Auch das Host-App-Entitlement enthält den
AutoFill Credential Provider, wie von Apple vorgeschrieben.

Der Wechsel von den ursprünglichen Entwicklungs-IDs erzeugt eine neue App-Identität:
vorhandene lokale Einstellungen, Keychain-Einträge und App-Group-Caches werden nicht
ungefragt übernommen. Biometrisches Entsperren und der AutoFill-Snapshot sind unter
der neuen Identität erneut einzurichten. Der interne Keychain-Service-Name für
AutoFill bleibt unverändert; die neue Zugriffsgruppe trennt die Daten trotzdem.
