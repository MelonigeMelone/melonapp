---
title: Kryptografie (melon-crypto)
description: Wie melon-crypto Schlüssel ableitet, verschlüsselt und Passwörter erzeugt – und warum.
sidebar:
  order: 2
---

`crates/melon-crypto` enthält die **gesamte** Kryptografie. Clients rufen nur diese
Crate auf: nativ in Tauri und iOS, als WASM im Browser und in der Erweiterung. So gibt es
genau eine Implementierung, die getestet werden muss.

Alle Bausteine stammen aus den Projekten RustCrypto und dalek. Eigene Kryptografie gibt
es nicht.

## Schlüsselableitung (`kdf.rs`)

### Argon2id

`derive_master_key(password, salt, params)` leitet aus dem Master-Passwort den 32-Byte-Master-Key ab.

| Parameter | Standard | Erlaubt | Warum |
|---|---|---|---|
| Speicher | 64 MiB | 19 MiB – 1 GiB | 19 MiB / 2 Iterationen ist die OWASP-Untergrenze |
| Iterationen | 3 | 2 – 32 | |
| Parallelität | 4 | 1 – 16 | |
| Salt | 16 Byte zufällig | 16 – 64 Byte | |

**Warum Ober- und Untergrenzen im Client?** Die Parameter liefert der Server
(`prelogin`). Ohne Untergrenze könnte ein bösartiger Server schwache Parameter schicken
und so ein Offline-Knacken erleichtern. Ohne Obergrenze könnte er das Gerät mit absurden
Werten lahmlegen. `KdfParams::minimum()` existiert nur für schnelle Tests.

### Unicode-Normalisierung

Das Passwort wird vor der Ableitung **NFKC-normalisiert**. Ein „ü“ kann als ein Zeichen
(U+00FC) oder als „u“ plus Trema (U+0308) eingegeben werden, je nach Betriebssystem und
Tastatur. Ohne Normalisierung ergäbe dasselbe Passwort auf Mac und Windows verschiedene
Schlüssel, und man käme nicht mehr in den Tresor.

### HKDF

Aus dem Master-Key entstehen per HKDF-SHA256 (Master-Key direkt als PRK) zwei unabhängige Schlüssel:

| Label | Schlüssel | Verwendung |
|---|---|---|
| `melon/v1/auth` | `AuthKey` | wird an den Server gesendet und dort nochmal gehasht |
| `melon/v1/wrap` | Wrap-Key | verschlüsselt den Vault-Key |

## Verschlüsselung (`cipher.rs`)

**XChaCha20-Poly1305** (AEAD) mit 256-bit-Schlüssel und **zufälligem 192-bit-Nonce** pro Vorgang.

Warum XChaCha statt AES-GCM? Der lange Nonce kann bedenkenlos zufällig gewählt werden.
Bei AES-GCM drohen bei vielen Geräten, die unabhängig verschlüsseln, Nonce-Kollisionen,
und die wären katastrophal. Außerdem ist XChaCha ohne Hardware-Beschleunigung schnell
und konstant in der Laufzeit, auch in WASM.

### Format `EncString`

```text
1.<base64url ohne Padding(nonce[24] ‖ ciphertext ‖ tag[16])>
```

- Das Präfix `1` ist die Formatversion. Ein neues Verfahren bekommt `2`, alte Daten
  bleiben lesbar.
- `Debug` gibt nur die Länge aus, nie den Inhalt.

### Zusatzdaten (AAD)

Jeder Chiffretext ist per AAD an seinen Kontext gebunden:

| Daten | AAD |
|---|---|
| Vault-Key | `melon/v1/vault-key` |
| Item | `melon/v1/item\0<modul>\0<item-id>` |

Damit kann der Server keine Chiffretexte zwischen Items oder Modulen vertauschen. Die
Entschlüsselung würde fehlschlagen. Deshalb vergibt der Client die Item-ID, und der Server
erlaubt keinen Modulwechsel eines bestehenden Items.

### Fehler

`CryptoError` ist absichtlich grob. `Decrypt` sagt nicht, ob der Schlüssel falsch, die
Daten manipuliert oder der Kontext falsch war. So verrät der Fehler einem Angreifer nichts.

## Speicherhygiene

`MasterKey`, `AuthKey` und `SymmetricKey` werden beim Verlassen des Gültigkeitsbereichs
genullt (`zeroize`) und implementieren kein `Debug`. Klartexte kommen als
`Zeroizing<Vec<u8>>` zurück.

## Passwort-Generator (`generator.rs`)

- Zufall direkt aus dem Betriebssystem (`OsRng`), gleichverteilt über `gen_range`.
- Jede aktivierte Zeichenklasse kommt mindestens einmal vor: Zuerst wird je Klasse ein
  Zeichen gezogen, der Rest aus allen Klassen, danach wird gemischt.
- Länge 8–256, Standard 20 mit allen Klassen (≈ 128 bit Entropie).
- Optional ohne verwechselbare Zeichen (`I l 1 O 0 o`).

## WASM

Für `wasm32-unknown-unknown` holt `getrandom` den Zufall über `crypto.getRandomValues`
(Feature `js`). Die CI baut die Crate bei jedem Push für WASM.
