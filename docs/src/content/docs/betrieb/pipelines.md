---
title: Pipelines
description: Die GitHub-Actions-Workflows und was sie tun.
sidebar:
  order: 3
---

| Workflow | Datei | Auslöser | Inhalt |
|---|---|---|---|
| CI | `ci.yml` | Push auf `main`, PR | ShellCheck für `deploy/bin/*`, `fmt`, `clippy -D warnings`, Rust-Tests mit PostgreSQL, Mindest-Rust-Version 1.87, Web-App und Erweiterung (WASM-Build, Tests, Build, Erweiterung als Artefakt `melonapp-extension`), **E2E**: kompletter Stack per Compose + Browser-Test der Web-App + Test der Erweiterung in Chromium + Prüfung, dass die Datenbank keinen Klartext enthält |
| Security | `security.yml` | Push, PR, täglich 05:17 UTC, manuell | cargo-deny (auch für die Apple-Abhängigkeiten), npm audit (Produktionsabhängigkeiten, ab „high“), gitleaks, CodeQL, Fuzzing (nur täglich und manuell) ([Details](/melonapp/sicherheit/pruefungen/)) |
| Images | `docker.yml` | Push auf `main`, Tags `v*`, PR mit Code-Änderungen | Images `melonapp-server` und `melonapp-web` bauen und nach GHCR pushen (nicht bei PRs), mit SBOM und Provenance. Bei einem Tag `v*` danach Job **Deploy**: Update des Servers per SSH ([Selbst hosten](/melonapp/betrieb/selbst-hosten/#updates-version-per-tag)) |
| Docs | `docs.yml` | Push auf `main` mit Änderungen in `docs/`, PR, manuell | Doku bauen und auf GitHub Pages veröffentlichen (nicht bei PRs) |

## Image-Tags

| Tag | Wann |
|---|---|
| `latest` | jeder Push auf `main` |
| `sha-<commit>` | jeder Push |
| `1.2.3` | Git-Tag `v1.2.3` |

Images: `ghcr.io/melonigemelone/melonapp-server` und `ghcr.io/melonigemelone/melonapp-web`.

## Öffentliches oder privates Repo

Alle Actions sind auf einen **Commit-SHA** festgelegt, die Version steht als Kommentar dahinter
(`actions/checkout@3d3c42e… # v7.0.1`). Ein Tag wie `v7` kann nachträglich auf anderen Code
zeigen, ein SHA nicht. Dependabot erkennt den Kommentar und hebt SHA und Kommentar gemeinsam an.
Bei `dtolnay/rust-toolchain` steht die Rust-Version als Eingabe `toolchain`.

CodeQL und GitHub Pages sind für **öffentliche** Repos kostenlos. Bei einem privaten Repo
brauchen sie einen kostenpflichtigen Plan (Advanced Security bzw. Pro). Deshalb laufen der
CodeQL-Job und das Veröffentlichen der Doku nur, wenn das Repo öffentlich ist. Gebaut wird
die Doku trotzdem immer, damit kaputte Seiten auffallen.

Ein öffentliches Repo schadet der Sicherheit nicht. Das Modell hängt nicht an geheimem
Code, sondern an Schlüsseln, die nur auf den Geräten existieren. Secrets gehören nie ins
Repo, das prüft gitleaks.

## Einmalige Einrichtung im Repo

- **Pages:** Settings → Pages → Source: *GitHub Actions*.
- **Private Vulnerability Reporting:** Settings → Code security → aktivieren.
- **Branch-Schutz für `main`:** CI und Security als Pflicht-Checks.

## Apple-Apps

`apple.yml` baut auf `macos-15` die macOS-App, die unsignierte Safari-Extension und das
ARM64-iOS-Simulator-Bundle inklusive Credential Provider Extension. Vorher laufen Rust-Angriffstests,
Tauri-Lint/Tests sowie Swift-Tests gegen die tatsächlich erzeugten UniFFI-Bindings.
XcodeGen erzeugt das Projekt aus der versionierten `project.yml`. Die Artefakte sind
unsignierte Entwicklungsstände; Hardware-Biometrie, Provisioning und App-Store-
Distribution sind damit nicht bestätigt. Der Apple-Job läuft auch bei Pushes auf
`feat/apple-apps`, damit die Nachtarbeit ohne fertigen PR geprüft werden kann.

Der Apple-Job prüft mit `cargo-deny` auch den getrennten Tauri-Workspace für macOS
und iOS. Der vollständige plattformübergreifende Tauri-Graph enthält zusätzlich
eine ungewartete Linux-GTK-Build-Abhängigkeit (`proc-macro-error`); sie wird nicht
für die Apple-Targets gebaut. Für das reine UniFFI-Generatorwerkzeug besteht eine begründete Wartungsausnahme
([Apple-Review](/melonapp/sicherheit/apple-review/)); echte Schwachstellen werden nicht
unterdrückt. Der nächtliche Security-Workflow und Dependabot erfassen auch den
getrennten Tauri-Workspace.

## Apple-Releases

`apple-release.yml` erzeugt verteilbare Apple-Builds
([ADR 0024](/melonapp/entscheidungen/0024-apple-verteilung/)). Er startet bei einem Tag
`v*`, der zur Version in `apps/desktop/src-tauri/tauri.conf.json` passen muss, oder manuell
(Actions → Apple release → Run workflow) für einen TestFlight-Build ohne Release; dort
lässt sich mit `platform` auch nur macOS oder nur iOS bauen.

- **macOS:** Der Job baut mit Xcode 26 zuerst WASM und die Erweiterung, dann mit
  `scripts/build-safari-extension.sh` die signierte Safari-Extension
  ([ADR 0026](/melonapp/entscheidungen/0026-safari-erweiterung-nur-mac/)), die in die App eingebettet
  wird. `scripts/apple-keychain.sh` legt die Developer-ID-Identität in einen
  temporären Schlüsselbund. `scripts/build-macos-signed.sh --bundles app` signiert und bettet
  das Profil ein. `scripts/apple-notarize.sh` reicht die App bei Apple ein, fragt den Status
  minütlich ab und übersteht dabei Netzwerkabbrüche (bis zu vier Stunden; die erste
  Notarisierung eines neuen Teams dauerte über zwei Stunden), gibt bei Ablehnung Apples
  Protokoll aus und heftet das Ticket an. `scripts/macos-dmg.sh` baut daraus ein signiertes
  DMG mit Verknüpfung zu „Programme“, das ebenfalls notarisiert wird. Danach prüfen
  `stapler` und `spctl`, dass Gatekeeper App und DMG annimmt. Das DMG hängt am
  GitHub-Release des Tags und liegt bei manuellen Läufen als Artefakt vor. Tauris eigene
  Notarisierung wird nicht genutzt, weil sie beim ersten Netzwerkfehler abbricht.
- **iOS:** Der Job wählt das neueste installierte Xcode 26, weil App Store Connect das
  iOS-26-SDK verlangt und die Signatur sonst von der lokal geprüften abweicht.
  `scripts/ios-export-options.py` prüft die beiden App-Store-Profile (Team,
  App-ID, Ablaufdatum, keine Geräteliste, kein `get-task-allow`), installiert sie und
  schreibt die Export-Optionen. `scripts/ios-release-signing.rb` trägt danach nur im CI in
  `project.yml` für App und Extension manuelles Signieren mit Apple Distribution, Team,
  Profil und die Build-Nummer (`github.run_number`) ein; XcodeGen erzeugt daraus das
  Projekt. So signiert schon `tauri ios build --archive-only` beide Targets mit ihren
  Entitlements, und `xcodebuild -exportArchive` exportiert mit denselben Profilen. Der
  Archiv-Schritt bekommt bewusst keinen API-Schlüssel: Mit `APPLE_API_KEY` archiviert Tauri
  unsigniert und überlässt das Signieren dem Export, der dann nur die Standardrechte des
  Profils kennt (App Group und AutoFill fehlten). Der Job bricht ab, wenn das Archiv der
  Extension keine App Group trägt.
  Automatisches Signieren scheidet aus: Es bräuchte Cloud-Signing und damit einen
  Admin-API-Schlüssel, und im ersten Versuch fehlte der Extension danach die App Group.
  Vor dem Upload prüft `scripts/ios-check-ipa.sh` im IPA einzeln die Build-Nummern, den
  Privacy-Manifest beider Targets, die App Group der Extension und dass die Extension
  nur Systembibliotheken lädt. `altool` lädt nach TestFlight hoch; weil es bei abgelehnten
  Uploads mit 0 endet, prüft der Schritt zusätzlich auf „UPLOAD SUCCEEDED“.

Secrets im Environment `apple-release` (nur `main` und Tags `v*`):

| Secret | Inhalt | Läuft ab |
| --- | --- | --- |
| `APPLE_TEAM_ID` | Team-ID | – |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Developer ID Application als `.p12` (Base64) | Dezember 2027 |
| `MACOS_PROVISIONING_PROFILE` | Developer-ID-Profil für `de.melonigemelone.app` (Base64) | 2044, gilt nur mit gültigem Zertifikat |
| `IOS_CERTIFICATE`, `IOS_CERTIFICATE_PASSWORD` | Apple Distribution als `.p12` (Base64) | November 2027 |
| `IOS_PROVISIONING_PROFILE_APP`, `IOS_PROVISIONING_PROFILE_AUTOFILL` | App-Store-Profile „MelonApp App Store“ und „MelonApp AutoFill App Store“ (Base64) | siehe Profil, gilt nur mit gültigem Zertifikat |
| `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8` | App-Store-Connect-API-Schlüssel, Rolle App Manager | nie, widerrufbar |

Ein Zertifikat ersetzen: in Xcode oder im Developer-Portal neu erzeugen, aus dem
Schlüsselbund als `.p12` exportieren und mit `gh secret set NAME --env apple-release`
eintragen. Den API-Schlüssel bei Verdacht sofort in App Store Connect widerrufen.
