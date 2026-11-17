---
title: Pipelines
description: Die GitHub-Actions-Workflows und was sie tun.
sidebar:
  order: 3
---

| Workflow | Datei | Auslöser | Inhalt |
|---|---|---|---|
| CI | `ci.yml` | Push auf `main`, PR | ShellCheck für `deploy/bin/*` und `scripts/*.sh` (ohne SC2329, weil `ios-check-ipa.sh` seine Prüfungen über `check` aufruft), Backup-/Restore-Test, Test der Backup-Auswahl von `home-backup.ps1` (`pwsh`), Update-Test (bei PRs nur mit Änderungen in `deploy/`), `fmt`, `clippy -D warnings`, Rust-Tests mit PostgreSQL, Mindest-Rust-Version 1.87, Web-App und Erweiterung (WASM-Build, Tests, Build, Erweiterung als Artefakt `melonapp-extension`), **E2E**: kompletter Stack per Compose + Browser-Test der Web-App + Test der Erweiterung in Chromium + Prüfung, dass die Datenbank keinen Klartext enthält |
| Security | `security.yml` | Push, PR, täglich 05:17 UTC, manuell | cargo-deny (auch für die Apple-Abhängigkeiten), npm audit (alle Abhängigkeiten samt Build-Werkzeugen, ab „high“), trivy (baut beide Images), zizmor (Workflows), gitleaks, CodeQL (Rust bei PRs nur mit Rust-Änderungen), Fuzzing (nur täglich und manuell) ([Details](/melonapp/sicherheit/pruefungen/)) |
| Images | `docker.yml` | Push auf `main`, Tags `v*` | Images `melonapp-server` und `melonapp-web` bauen und nach GHCR pushen, mit SBOM und Provenance. Bei PRs baut der trivy-Job in Security beide Images. Bei einem Tag `v*` danach Job **Deploy**: Update des Servers per SSH ([Selbst hosten](/melonapp/betrieb/selbst-hosten/#updates-version-per-tag)) |
| Windows | `windows.yml` | Push auf `main`, PR, jeweils nur bei Änderungen an App, Crates oder Abhängigkeiten | Auf `windows-latest`: cargo-deny für Windows, Tests von `melon-crypto` und `melon-native`, `fmt`, `clippy -D warnings` und Tests der Desktop-App, unsignierter NSIS-Installer als Artefakt `windows-app-unsigned`. Kein Pflicht-Check, wie die Apple-Apps |
| Docs | `docs.yml` | Push auf `main` mit Änderungen in `docs/`, PR, manuell | Doku bauen und auf GitHub Pages veröffentlichen (nicht bei PRs) |

## Laufzeit

Die Pflicht-Checks im Ruleset müssen bei jedem PR grün werden, auch wenn ein Job nichts zu tun hat.
Ein Workflow-Filter (`paths:`) würde den Check gar nicht erst starten, und der PR bliebe hängen.
Deshalb überspringen die teuren Pflicht-Jobs nur einzelne **Schritte**:
`scripts/changed.sh <Regex>` vergleicht den Merge-Commit des PRs mit seinem ersten Elternteil
(Checkout mit `fetch-depth: 2`) und setzt `run=false`, wenn keine Datei passt.

| Schritt | läuft bei PRs nur bei Änderungen in |
|---|---|
| Update-Test (`ci.yml`, Job *Server scripts*) | `deploy/`, `scripts/changed.sh`, `ci.yml` |
| CodeQL für Rust (`security.yml`) | `crates/`, `fuzz/`, `apps/desktop/src-tauri/`, `Cargo.*`, `.github/codeql/`, `scripts/changed.sh`, `security.yml` |

Auf `main` und im täglichen Lauf läuft alles. Der Update-Test wartet nur 30 statt 60 Sekunden auf
`/health` (`MELON_HEALTH_TRIES=15`), weil er zwei Fehlerfälle durchspielt, die die Wartezeit
voll ausschöpfen.

`apple.yml` ist kein Pflicht-Check und nutzt deshalb einen `paths:`-Filter: Der macOS-Runner
startet nur bei Änderungen in `crates/`, `apps/`, `packages/`, `scripts/`, `Cargo.*`,
`package*.json`, `.nvmrc` oder am Workflow selbst. Reine Doku- oder Deploy-PRs warten also nicht
auf einen macOS-Runner.

`build-wasm.sh` lädt `wasm-bindgen` als fertiges Binary von den GitHub-Releases des Projekts,
statt es mehrere Minuten zu kompilieren (CI, Apple-Builds, Web-Image). Siehe
[Lokale Entwicklung](/melonapp/betrieb/lokale-entwicklung/).

## Image-Tags

| Tag | Wann |
|---|---|
| `latest` | jeder Push auf `main` |
| `sha-<commit>` | jeder Push |
| `1.2.3` | Git-Tag `v1.2.3` |

Images: `ghcr.io/melonigemelone/melonapp-server` und `ghcr.io/melonigemelone/melonapp-web`.

## Härtung der Workflows

- **Schreibrechte nur ohne fremden Code:** `packages: write` und `id-token: write` hat nur der
  Image-Job in `docker.yml`, und der läuft nie bei PRs. Ob ein PR-Stand als Image baut, prüft der
  trivy-Job, der nur `contents: read` hat.
- **Release ohne Build-Cache:** Bei Tags baut `docker.yml` ohne `cache-from`, und
  `apple-release.yml` nutzt keinen npm-Cache (`package-manager-cache: false`). Den
  GitHub-Actions-Cache kann jeder Job auf `main` beschreiben, etwa über eine kompromittierte
  Build-Abhängigkeit. Ein Release soll nur aus dem getaggten Code entstehen. Auf `main` bleibt der
  Cache an, weil diese Images nicht deployt werden.
- **Kein Token im Checkout:** Jeder `actions/checkout` setzt `persist-credentials: false`. Sonst
  läge das `GITHUB_TOKEN` in `.git/config`, lesbar für jeden späteren Schritt und in Artefakten.
  Kein Workflow pusht mit git; das Release-Upload nutzt `gh` mit eigenem Token.
- **zizmor** prüft bei jedem Push und PR alle Workflows und `dependabot.yml` (Job *Workflows* in
  `security.yml`). Neue Funde machen den Lauf rot.
- **Dependabot wartet 7 Tage**, bevor es eine neue Version vorschlägt (`cooldown`). Ein gekapertes
  Paket fällt meist in den ersten Tagen auf. Sicherheitsupdates kommen ohne Wartezeit.

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
- **Ruleset „main“** (Settings → Rules): Änderungen nur per PR, kein Force-Push, kein Löschen.
  Pflicht-Checks sind alle Jobs aus CI und Security, die bei jedem PR laufen (CI: Server scripts,
  Format/lint/test, Web app, End-to-end, Minimum Rust version; Security: beide cargo-deny-Jobs,
  npm audit, trivy, zizmor, gitleaks, CodeQL). Admins dürfen nur über einen PR ausweichen
  (Bypass-Modus *pull request*), nicht direkt pushen.
- **Ruleset „Release tags“:** Tags `v*` anlegen, verschieben und löschen darf nur ein Admin, weil
  ein Tag sofort deployt.
- **Actions-Policy** (Settings → Actions → General): *Require actions to be pinned to a full-length
  commit SHA*. Eine Action mit Tag statt SHA startet dann gar nicht erst.

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
