---
title: "0016: iOS AutoFill, UniFFI und lokale Passkeys"
description: Native Credential Provider Extension mit biometrischem Zugriff und gemeinsamem verschlüsseltem Cache.
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Die iOS-Credential-Provider-Schnittstelle benötigt Swift. Das vorhandene Item-Modell
kennt noch keine Passkeys. Eine zweite Verschlüsselungsimplementierung würde die
Schlüsselgrenze und Prüfungen unnötig vergrößern.

## Entscheidung

`melon-ffi` stellt `melon-crypto` über UniFFI bereit. Die Extension entschlüsselt den
Cache erst nach Keychain-Authentifizierung. Die App Group `group.de.melonapp.shared`
ist zugleich Keychain-Zugriffsgruppe; Apple unterstützt diese Verwendung ohne einen
zusätzlichen Team-Präfix für die Gruppe. Daten werden nicht über JavaScript geteilt.
Handgeschriebener Rust-Code bleibt ohne `unsafe`; UniFFI erzeugt die FFI-Grenze.

Die App veröffentlicht auf ausdrücklichen Knopfdruck einen verschlüsselten Snapshot
der Login-Einträge nach erfolgreichem Sync. Er gilt höchstens 24 Stunden. AutoFill
vergleicht HTTPS-Hosts exakt; Subdomains, ähnlich geschriebene Domains und HTTP werden
nicht automatisch akzeptiert. Stilles AutoFill ohne Benutzerinteraktion wird abgelehnt.

Passkeys verwenden ES256 mit RustCrypto `p256`. Private Schlüssel werden bereits vor
Verlassen von Rust mit dem Kontoschlüssel und an RP-ID sowie Credential-ID gebunden
verschlüsselt. Die Extension speichert diese Datensätze nochmals verschlüsselt in der
App Group. WebAuthn-Registrierung verwendet Attestation `none`, Null-AAGUID und einen
Signaturzähler von null. UP/UV werden nur im biometrisch authentifizierten Ablauf genutzt.
Die Credentials sind gerätegebunden und werden nicht als gesichert/synchronisiert markiert.

Passkeys bleiben in dieser Ausbaustufe lokal auf diesem Gerät. Server-Sync, Export,
Wiederherstellung und Verwaltungsoberfläche benötigen ein separates Datenmodell und
sind nicht Bestandteil der ersten Extension. Die Registrierung muss deshalb vor
Benutzung für wichtige Konten gegen echte Relying Parties geprüft werden.

## Alternativen

- AutoFill aus der WebView: erfüllt Apples Extension-Schnittstelle nicht.
- Klartext oder rohe Schlüssel in der App Group: widerspricht dem Sicherheitsmodell.
- Bestehende Login-Items für Passkeys zweckentfremden: keine klare Versionierung oder
  sichere Migration; deshalb zunächst getrennte lokale Dateien.

## Folgen

Signierung, App-Group-Provisioning und Aktivierung unter iOS müssen auf einem echten
Gerät geprüft werden. Simulator und native Tests prüfen Build, Schnittstelle,
Signaturen und Ablehnungsfälle, nicht die Vertrauensentscheidung des Betriebssystems.
Ein entzogenes Mitglied kann einen zuvor veröffentlichten Passwort-Snapshot bis zum
Ablauf verwenden; der Snapshot ist eine ausdrücklich angelegte Offline-Kopie.
