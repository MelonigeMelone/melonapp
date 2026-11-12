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

## Offene Abnahmen

- Echter Touch-ID-/Face-ID-Erfolg, Abbruch, neue biometrische Registrierung und gesperrtes
  Gerät: auf Hardware prüfen; Simulator und Rust-Tests beweisen dies nicht ([#25](https://github.com/MelonigeMelone/melonapp/issues/25), [#26](https://github.com/MelonigeMelone/melonapp/issues/26)).
- macOS benötigt für die Data-Protection-Keychain-Entitlements ein passendes
  Provisioning-Profil. Ein signiertes, aber unprovisioniertes Bundle kann vom System
  beendet werden, obwohl `codesign --verify` erfolgreich ist ([#24](https://github.com/MelonigeMelone/melonapp/issues/24)).
- iOS-Signierung wurde versucht und scheiterte an der gespeicherten Xcode-Anmeldung
  sowie fehlender App-Group-Berechtigung im vorhandenen Profil ([#23](https://github.com/MelonigeMelone/melonapp/issues/23)).
- AutoFill und Passkeys sind gebaut, aber nicht gegen Safari/eine echte Relying Party
  vollständig auf Hardware abgenommen ([#27](https://github.com/MelonigeMelone/melonapp/issues/27), [#28](https://github.com/MelonigeMelone/melonapp/issues/28)). Passkeys haben
  noch keinen Server-Sync, Export oder Wiederherstellungsablauf ([#32](https://github.com/MelonigeMelone/melonapp/issues/32)).
- Passwort-Snapshots sind bewusst angelegte Offline-Kopien: Widerruf wirkt dort nicht
  sofort. Die 24-Stunden-Frist hängt von der Gerätezeit ab und ist kein kryptografischer
  Schutz vor Zurücksetzen der Systemzeit oder Wiedereinspielen alter gültiger Dateien.
- Native Zwischenablage und globale Hotkey-Aktivierung benötigen noch interaktive
  Abnahme; die Umgebung erlaubt keine macOS-Accessibility-Automatisierung ([#25](https://github.com/MelonigeMelone/melonapp/issues/25)).
