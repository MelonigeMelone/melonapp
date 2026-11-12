---
title: Apple-Sicherheitsprüfung
description: Prüfumfang, behobene Befunde und offene Abnahmen der nativen Clients.
---

Stand: 11. November 2026. Diese lokale Implementierungsprüfung ersetzt keine unabhängige
Abnahme. Der Claude-Code-Befehl `/security-review` ist in dieser Codex-Sitzung nicht als
Werkzeug verfügbar und wurde **nicht ausgeführt**. Der Review wurde beim Merge nachgeholt
([#29](https://github.com/MelonigeMelone/melonapp/issues/29)): keine ausnutzbaren Befunde, vier
kleinere Punkte und ein Bedienfehler, alle behoben (#61–#65, siehe unten).

## Geprüfte Grenzen und behobene Befunde

- Die native UI erhält keine Konto-, Bereichs-, Identitäts- oder Authentifizierungsschlüssel.
  Authentifizierungsnachweise sind zufällige Handles, die ausschließlich der native
  HTTP-Transport auflöst; Sperren verwirft sie.
- Die gemeinsam genutzte Web-UI zeigt entschlüsselte Einträge, Sitzungstokens und auf
  ausdrücklichen Wunsch den Recovery-Key an. Eine kompromittierte UI könnte weiterhin
  angezeigte Daten lesen oder native Entschlüsselungsaufträge stellen; die Isolation
  ist kein Schutz vor jeder Handlung einer kompromittierten Oberfläche.
- Native Sperren wirken unabhängig vom JS-Timer. Fokusverlust beziehungsweise iOS-
  Suspendieren löschen Schlüssel; Hintergrundzustand verhindert verspätetes Entsperren.
  Biometrische Wiederaufnahme prüft außerdem, dass der Server nicht gewechselt wurde.
- Tauri lädt ausschließlich die gemeinsame lokale Oberfläche mit begrenzter CSP.
  Serverwechsel erfordert, dass kein Tresor offen ist; eine abgebrochene Anmeldung samt
  Login-Nachweis wird dabei verworfen (#63, #65). API-URLs erlauben HTTPS und für lokale
  Entwicklung HTTP auf Loopback; Weiterleitungen sind abgeschaltet.
- Jedes Sperren, auch Fokusverlust, Suspendieren und der native Timer, meldet beim Server ab. Ausgenommen ist nur genau das Token, das im biometrischen Wiederaufnahmezustand steckt (#61).
- Caches verwenden authentifizierte Verschlüsselung mit Konto-/Server-/Formatkontext. Der
  biometrische Wiederaufnahmezustand hat einen eigenen Kontext und lässt sich nicht mit
  einer Cache-Datei vertauschen (#62). Deaktivieren löscht auch den AutoFill-Schlüssel (#64).
  Schreibvorgänge verwenden private temporäre Dateien und atomaren Ersatz. Schlüssel
  liegen nur in der Keychain mit `biometryCurrentSet` und gerätegebundener Zugriffsart.
- AutoFill lehnt HTTP, ähnliche Domains und automatisch passende Subdomains ab.
  Fehlende Biometrie, falsche Schlüssel, defekte Dateien und abgelaufene Passwort-
  Snapshots führen zur Ablehnung. Keine ungeschützte Fallback-Datei wird angelegt.
- Passkey-Signaturen binden RP-ID, Credential-ID und Challenge. Private Schlüssel
  verlassen Rust nur verschlüsselt. Swift meldet Ergebnisse nach Abbruch nicht mehr
  erfolgreich zurück und blockiert den UI-Thread nicht während der Biometrie.

Die ausführbaren Nachweise stehen in [Automatische Prüfungen](/melonapp/sicherheit/pruefungen/).

## Abhängigkeiten

Der zuerst gewählte P-256-0.13-Zweig zog ein von
[RUSTSEC-2026-0387](https://rustsec.org/advisories/RUSTSEC-2026-0387/) betroffenes
`crypto-bigint` ein. Die Implementierung verwendet deshalb P-256 0.14 und die gepatchte
Abhängigkeitslinie. Rust 1.87 ist die neue Mindestversion. Diese Schwachstelle wird
nicht unterdrückt.

Der **optionale Binding-Generator** von UniFFI verwendet über Askama `basic-toml`.
[RUSTSEC-2026-0374](https://rustsec.org/advisories/RUSTSEC-2026-0374/) meldet dessen
fehlende Wartung, keine konkrete Laufzeit-Schwachstelle. Auch die geprüfte neuere
UniFFI-Linie 0.32.2 enthält es. `deny.toml` enthält dafür eine einzelne begründete
Ausnahme: Der Parser liest lokale Build-Konfiguration; die Bibliothek ist nicht im
App-Laufzeitgraph. Bei jedem UniFFI-/Askama-Update ist die Ausnahme erneut zu prüfen
und nach Entfernung der Abhängigkeit zu löschen. Alle anderen Advisories bleiben aktiv.

Der vollständige Tauri-Graph enthält außerdem das ungewartete Linux-GTK-Buildwerkzeug
`proc-macro-error`. Die Apple-Target-Prüfungen schließen Linux-Abhängigkeiten regulär
aus; dafür gibt es keine Advisory-Ausnahme. Windows/Linux-Desktop-Builds sind hier
nicht abgenommen.

## Hardware-Abnahme

Stand: 12. November 2026. Signierte Builds mit Team `S7FTFS4QRH`, Bundle-IDs
`de.melonigemelone.app` / `.autofill`, App Group `group.de.melonigemelone.app`, Server
`https://app.melonigemelone.de`, Testkonto.

- **macOS** ([#24](https://github.com/MelonigeMelone/melonapp/issues/24), [#25](https://github.com/MelonigeMelone/melonapp/issues/25)): signierter Build mit Provisioning-Profil startet. Touch-ID-Erfolg und
  -Abbruch, Sperre bei Fokusverlust, `⌘⇧M` (holt nur nach vorn), falsches Passwort,
  Leeren der Zwischenablage und fünf Minuten Inaktivität bestanden.
- **iPhone 13, iOS 26.6.1** ([#26](https://github.com/MelonigeMelone/melonapp/issues/26)): Installation, Face ID aktivieren und entsperren,
  Hintergrundwechsel, Face-ID-Abbruch, erneutes Entsperren, falsches Passwort, fünf Minuten
  Inaktivität bestanden, nach Behebung des Fokusfehlers (Face-ID-Dialog sperrte die
  Sitzung vor der Wiederherstellung).
- **AutoFill in Safari** ([#27](https://github.com/MelonigeMelone/melonapp/issues/27)): exakter Host wird gefunden und ausgefüllt, andere Subdomain und
  ähnliche Domain liefern nichts, Face-ID-Abbruch lehnt ab. Vorher behoben: Absturz der
  Extension auf dem Gerät (dynamisch gelinkte `libmelon_ffi.dylib`) und Abmeldung durch
  einen Face-ID-Dialog beim Aktualisieren des AutoFill-Schlüssels.
- **Passkeys** ([#28](https://github.com/MelonigeMelone/melonapp/issues/28)): Registrierung und Anmeldung gegen webauthn.io, Abbruch,
  Hintergrundwechsel, erneute Anmeldung und Ablehnung bei anderem RP (webauthn.me)
  bestanden, nachdem BE/BS gesetzt wurden ([ADR 0016](/melonapp/entscheidungen/0016-ios-autofill-und-passkeys/)).
- **Design** ([#58](https://github.com/MelonigeMelone/melonapp/issues/58)): Extension hell/dunkel und App-Icon im Simulator geprüft;
  Kontrast des gefüllten Buttons im Dunkelmodus korrigiert.

## Offene Abnahmen

- Neue biometrische Registrierung auf dem Mac (Fingerabdruck hinzufügen → Touch ID muss
  scheitern, „Neu einrichten“ behebt es) ist noch nicht auf Hardware geprüft ([#25](https://github.com/MelonigeMelone/melonapp/issues/25)).
- Ablauf des 24-Stunden-AutoFill-Snapshots wurde auf dem Gerät nicht geprüft, nur im
  Swift-Test (`scripts/test-apple-swift.sh`).
- Passwort-Snapshots sind bewusst angelegte Offline-Kopien: Widerruf wirkt dort nicht
  sofort. Die 24-Stunden-Frist hängt von der Gerätezeit ab und ist kein kryptografischer
  Schutz vor Zurücksetzen der Systemzeit oder Wiedereinspielen alter gültiger Dateien.
- Passkey-Sync über den Tresor ([ADR 0022](/melonapp/entscheidungen/0022-passkeys-im-tresor/)) ist
  in Tests und im Simulator geprüft; Übernahme auf einem echten iPhone, Wiederherstellung auf einem
  zweiten Gerät stehen aus. Gelöschte Passkeys verschwinden aus den iOS-Vorschlägen erst beim
  nächsten entsperrten AutoFill-Vorgang.
- Notarisierung und TestFlight ([#30](https://github.com/MelonigeMelone/melonapp/issues/30)) sowie die Safari-Web-Erweiterung
  ([#31](https://github.com/MelonigeMelone/melonapp/issues/31)) stehen aus. Im Simulator zeigt die Extension keinen Face-ID-Dialog;
  biometrische Aussagen gelten nur für die Hardware-Abnahme oben.

## Statusanzeige der Biometrie-Einstellungen

Stand dieser Ergänzung: 12. November 2026. Die Ergänzung zu #80 prüft vorhandene Einrichtungsdaten nativ und kontogebunden, ohne
Keychain-Lesezugriff oder Entsperren. Manuell geprüfte Grenzen: kein Schlüssel-/Token-Export,
keine Verlängerung der Sperrfrist, Ablehnung eines zwischenzeitlichen Serverwechsels sowie gesperrter Sitzungen und keine Erfolgsanzeige
allein aufgrund eines abgeschlossenen UI-Aufrufs. Manipulierte oder kontextfremde
Snapshots werden nicht als eingerichtet angezeigt. Die Anzeige behauptet ausdrücklich
keine aktuelle Hardware-, Keychain- oder Server-Verfügbarkeit.

Die automatischen Angriffs- und UI-Tests stehen in `sicherheit/pruefungen.md`. Der
`/security-review` für diese Ergänzung (PR #83) fand keine Befunde.
