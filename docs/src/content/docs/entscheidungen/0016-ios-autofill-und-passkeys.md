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
Cache erst nach Keychain-Authentifizierung. Die App Group `group.de.melonigemelone.app`
ist zugleich Keychain-Zugriffsgruppe; Apple unterstützt diese Verwendung ohne einen
zusätzlichen Team-Präfix für die Gruppe. Daten werden nicht über JavaScript geteilt.
Handgeschriebener Rust-Code bleibt ohne `unsafe`; UniFFI erzeugt die FFI-Grenze.

Die App veröffentlicht auf ausdrücklichen Knopfdruck einen verschlüsselten Snapshot
der Login-Einträge nach erfolgreichem Sync. Er gilt höchstens 24 Stunden. AutoFill
vergleicht HTTPS-Hosts exakt; Subdomains, ähnlich geschriebene Domains und HTTP werden
nicht automatisch akzeptiert. Stilles AutoFill ohne Benutzerinteraktion wird abgelehnt.

Passkeys verwenden ES256 mit RustCrypto `p256` 0.14. Die ältere 0.13-Linie zieht
ein von RUSTSEC-2026-0387 betroffenes `crypto-bigint` ein; deshalb verwenden wir die
gepatchte Abhängigkeitslinie und erhöhen die Workspace-Mindestversion auf Rust 1.87. Private Schlüssel werden bereits vor
Verlassen von Rust mit dem Kontoschlüssel und an RP-ID sowie Credential-ID gebunden
verschlüsselt. Die Extension speichert diese Datensätze nochmals verschlüsselt in der
App Group. WebAuthn-Registrierung verwendet Attestation `none`, Null-AAGUID und einen
Signaturzähler von null. UP/UV werden nur im biometrisch authentifizierten Ablauf genutzt.
Die Credentials sind gerätegebunden. Trotzdem setzen Authenticator-Daten bei Registrierung und
Anmeldung die Flags BE (backup eligible) und BS (backup state), also `0x5D` bzw. `0x1D`:
iOS lehnt Passkeys von Drittanbieter-Extensions sonst mit „AuthData is missing a required
flag“ ab, nur BE reicht nicht (im Simulator mit iOS 26.1 geprüft). Relying Parties halten
MelonApp-Passkeys dadurch für synchronisiert, obwohl sie es nicht sind. Ein Verlust des
Geräts oder der App-Daten verliert sie unwiderruflich.

Passkeys waren in der ersten Ausbaustufe nur lokal auf dem Gerät. Seit
[ADR 0022](/melonapp/entscheidungen/0022-passkeys-im-tresor/) übernimmt die App sie in den
verschlüsselten Tresor; damit gelten Sync, verschlüsselter Export und Wiederherstellung.

Weil BS gesetzt ist, kann eine Relying Party annehmen, ein MelonApp-Passkey sei
wiederherstellbar. Das stimmt, sobald die App den Passkey nach dem nächsten Entsperren in
den Tresor übernommen hat; bis dahin liegt er nur auf dem Gerät.

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
