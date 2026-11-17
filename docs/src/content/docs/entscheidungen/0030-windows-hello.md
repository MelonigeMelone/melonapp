---
title: "0030: Windows Hello über einen Signaturschlüssel"
description: Die Windows-App entsperrt mit Windows Hello, indem ein Hello-Schlüssel eine feste Challenge signiert; aus der Signatur entsteht der Schlüssel für den biometrischen Gerätschlüssel.
---

**Status:** angenommen · **Datum:** 2026-11-17

## Kontext

Auf macOS und iOS liegt der biometrische Geräteschlüssel
([ADR 0029](/melonapp/entscheidungen/0029-abgeleitete-geraeteschluessel/)) im Schlüsselbund mit
`biometryCurrentSet`. Das System gibt ihn nur nach Touch ID oder Face ID heraus, und nur an die
App selbst. Windows hat keinen solchen Speicher: Die Anmeldeinformationsverwaltung und DPAPI geben
ihren Inhalt jedem Programm der angemeldeten Person, ohne Rückfrage.

Windows Hello bietet zwei Schnittstellen:

- `UserConsentVerifier` zeigt nur eine Abfrage und meldet „bestätigt“. Mit dem Ergebnis ist nichts
  verschlüsselt.
- `KeyCredentialManager` legt einen RSA-Schlüssel an, im TPM, wenn vorhanden. Jede Signatur damit
  verlangt Windows Hello (PIN, Gesicht oder Fingerabdruck). Der private Schlüssel lässt sich nicht
  auslesen.

## Entscheidung

Die Windows-App nutzt `KeyCredentialManager` (`hello.rs`):

1. **Einrichten:** Hello-Schlüssel `de.melonigemelone.app.biometric.v1` öffnen oder anlegen. Er
   signiert die Challenge SHA-256(`melon/windows-hello/challenge/v1\0` ‖ Scope ‖ `\0` ‖ Nonce),
   mit einer neuen zufälligen Nonce je Einrichtung.
2. Aus der Signatur wird ein Schlüssel: SHA-256(`melon/windows-hello/key/v1\0` ‖ Scope ‖ `\0` ‖
   Signatur). Er verschlüsselt den biometrischen Geräteschlüssel (XChaCha20-Poly1305, AAD
   `melon/windows-hello/v1/` ‖ Scope).
3. `biometric.hello` speichert nur Nonce und Chiffretext. Die Signatur wird nie gespeichert.
4. **Entsperren:** dieselbe Challenge erneut signieren lassen (Windows Hello fragt), Schlüssel
   ableiten, Geräteschlüssel entschlüsseln, dann wie auf dem Mac den Wiederaufnahmezustand öffnen.

Das funktioniert, weil Hello-Signaturen RSA PKCS#1 v1.5 sind und damit deterministisch: Dieselbe
Challenge ergibt mit demselben Schlüssel immer dieselbe Signatur. Bitwarden nutzt dasselbe Verfahren.

Deaktivieren löscht den Hello-Schlüssel, `biometric.hello`, `biometric.enc` und `biometric.token`.

## Folgen

- Wer nur die Dateien der App hat (Backup, gestohlene Festplatte, anderes Benutzerkonto), kann sie
  ohne den Hello-Schlüssel im TPM nicht öffnen.
- **Grenze:** Ein anderes Programm der angemeldeten Person kann denselben Hello-Schlüssel öffnen und
  eine Signatur anfordern. Windows zeigt dann die Hello-Abfrage. Bestätigt die Person sie im
  Glauben, es sei MelonApp, bekommt das Programm die Signatur und kann damit den Tresor öffnen. Auf
  dem Mac verhindert die Zugriffsliste des Schlüsselbunds das. Gegen Schadsoftware, die als dieselbe
  Person läuft und auch Tastatureingaben mitlesen kann, schützt unter Windows ohnehin wenig.
- Ohne Hello (kein PIN eingerichtet, Richtlinie) meldet `biometric_available` `false`, und die App
  zeigt keine Biometrie-Optionen.
- Entfernt die Person Windows Hello oder setzt die Hello-Schlüssel zurück, klappt das Entsperren
  nicht mehr. Dann mit dem Master-Passwort anmelden und neu einrichten.
- Würde Windows je auf ein zufälliges Signaturverfahren umstellen, schlüge jedes Entsperren fehl.
  Daten gehen dabei nicht verloren, nur die Abkürzung über Hello.

## Alternativen

- **`UserConsentVerifier` + DPAPI:** Jede Software der Person könnte den Schlüssel ohne Abfrage per
  DPAPI entschlüsseln. Die Hello-Abfrage wäre nur Oberfläche.
- **Schlüssel in der Anmeldeinformationsverwaltung:** dasselbe Problem, ohne jede Abfrage.
- **Kein Hello unter Windows:** sicher, aber unbequem. Das Master-Passwort bleibt ohnehin immer
  nutzbar.
