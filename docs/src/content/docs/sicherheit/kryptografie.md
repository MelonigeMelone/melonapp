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
| `melon/v1/wrap` | Wrap-Key | verschlüsselt den Konto-Schlüssel |

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

Jeder Chiffretext ist per AAD an seinen Platz gebunden:

| Daten | Schlüssel | AAD |
|---|---|---|
| Konto-Schlüssel | Wrap-Key | `melon/v2/account-key` |
| privater Schlüssel | Konto-Schlüssel | `melon/v2/private-key` |
| Tresor-Name | Tresor-Schlüssel | `melon/v2/vault-meta\0<tresor>\0<version>` |
| Eintrag | Tresor-Schlüssel | `melon/v2/item\0<tresor>\0<eintrag>\0<version>` |

Damit kann der Server keine Chiffretexte zwischen Einträgen, Tresoren oder Schlüsselversionen
vertauschen, ohne dass die Entschlüsselung fehlschlägt. Die Trennung per `\0` verhindert, dass
`("v", "ab")` und `("va", "b")` dieselben Bytes ergeben. Deshalb vergibt der Client die IDs.

### Fehler

`CryptoError` ist absichtlich grob. `Decrypt` sagt nicht, ob der Schlüssel falsch, die
Daten manipuliert oder der Kontext falsch war. So verrät der Fehler einem Angreifer nichts.

## Teilen (`sharing.rs`)

### Schlüsselpaar

Jede Person hat ein **X25519-Schlüsselpaar** (`KeyPair`). Der private Schlüssel wird mit dem
Konto-Schlüssel verschlüsselt gespeichert, der öffentliche liegt im Klartext auf dem Server.

### Tresor-Schlüssel verteilen: HPKE

Tresor-Schlüssel werden mit **HPKE** (RFC 9180) für den öffentlichen Schlüssel jedes Mitglieds
verschlüsselt: Base-Modus, `DHKEM(X25519, HKDF-SHA256)`, `HKDF-SHA256`, `ChaCha20Poly1305`,
Crate `hpke` 0.15. HPKE ist der IETF-Standard für „verschlüssle für einen öffentlichen
Schlüssel“. Eine eigene Konstruktion aus X25519 + HKDF wäre selbst gebaute Kryptografie.

Der HPKE-`info`-Parameter bindet jede Kopie an ihren Zweck:

```text
melon/v2/vault-key\0<tresor-id>\0<nutzer-id>\0<schlüsselversion>
```

Eine Kopie für Bob lässt sich also weder einer anderen Person noch einem anderen Tresor oder
einer anderen Schlüsselversion unterschieben.

Format `SealedKey`: `h1.<base64url(encapped_key[32] ‖ ciphertext[32] ‖ tag[16])>`, genau 80 Byte.
Der Server prüft beim Speichern nur dieses Format.

### Zufall

Aller Zufall kommt direkt aus dem Betriebssystem: `rng::os_rng()` ist `SysRng` aus `rand` 0.10
(über `getrandom` 0.4), ohne Zwischen-Generator. HPKE bekommt dieselbe Quelle ausdrücklich
übergeben (`gen_keypair_with_rng`, `single_shot_seal_with_rng`). In WASM liefert `getrandom` den
Zufall über `crypto.getRandomValues` (Feature `wasm_js`, `getrandom_backend="wasm_js"` in
`.cargo/config.toml`).

### Updates der Krypto-Crates

Neue Hauptversionen von RustCrypto, `hpke` oder `rand` werden gemeinsam eingespielt
(Dependabot gruppiert sie). Bedingung ist, dass die **Kompatibilitätstests**
(`crates/melon-crypto/tests/compat.rs`) unverändert grün bleiben. Sie enthalten Daten, die mit
den vorherigen Versionen erzeugt wurden: abgeleitete Schlüssel aus einem Master-Passwort, einen
verpackten Konto-Schlüssel, Eintrag und Tresorname, ein Notfall-Kit, ein Schlüsselpaar mit
geteiltem Tresor-Schlüssel und eine Passkey-Signatur. Auf dem Server prüfen
`auth::tests::stored_auth_hashes_still_verify` und
`auth::tests::stored_session_tokens_and_fake_salts_stay_the_same` gespeicherte Hashes. Diese
Werte dürfen nie neu erzeugt werden, sonst würde ein Update bestehende Tresore unlesbar machen,
ohne dass ein Test es merkt.

## Recovery-Key und Sicherheitscode (`recovery.rs`)

| | Aufbau |
|---|---|
| Recovery-Key | 30 Byte Zufall + 2 Byte SHA-256-Prüfsumme, Base32 ohne Padding, 13 Vierergruppen |
| Recovery-Auth-Key | HKDF-SHA256(Salt `melon/v2/recovery`, Info `melon/v2/recovery-auth`) |
| Recovery-Wrap-Key | HKDF-SHA256(Salt `melon/v2/recovery`, Info `melon/v2/recovery-wrap`) |
| Konto-Schlüssel per Recovery | XChaCha20-Poly1305, AAD `melon/v2/account-key-recovery` |
| Sicherheitscode | SHA-256(`melon/v2/fingerprint\0` ‖ öffentlicher Schlüssel), Byte 0–29 als 6 × 5 Ziffern |

Die eigene AAD verhindert, dass die Recovery-Kopie des Konto-Schlüssels mit der
Passwort-Kopie verwechselt oder vertauscht wird. Begründung:
[ADR 0011](/melonapp/entscheidungen/0011-recovery-und-sicherheitscode/).

## Speicherhygiene

`MasterKey`, `AuthKey`, `SymmetricKey` und der private Schlüssel werden beim Verlassen des Gültigkeitsbereichs
genullt (`zeroize`) und implementieren kein `Debug`. Klartexte kommen als
`Zeroizing<Vec<u8>>` zurück.

## Passwort-Generator (`generator.rs`)

- Zufall direkt aus dem Betriebssystem (`os_rng()`), gleichverteilt über `random_range`.
- Jede aktivierte Zeichenklasse kommt mindestens einmal vor: Zuerst wird je Klasse ein
  Zeichen gezogen, der Rest aus allen Klassen, danach wird gemischt.
- Länge 8–256, Standard 20 mit allen Klassen (≈ 128 bit Entropie).
- Optional ohne verwechselbare Zeichen (`I l 1 O 0 o`).

## WASM

Für `wasm32-unknown-unknown` holt `getrandom` 0.4 den Zufall über `crypto.getRandomValues`
(Feature `wasm_js`). Die CI baut die Crate bei jedem Push für WASM.

## Native Passkeys

Die iOS-Extension nutzt `melon-crypto` über UniFFI. ES256-Signaturen werden mit dem
RustCrypto-Crate `p256` erzeugt. Private P-256-Schlüssel werden mit XChaCha20-Poly1305
unter dem Kontoschlüssel verschlüsselt; der authentifizierte Kontext enthält eine
Formatkennung, längenkodierte RP-ID und Credential-ID. Assertions signieren
`authenticatorData || clientDataHash`. Falsche RP-ID, Credential-ID, Schlüssel und
ungültige Hash-Länge werden abgelehnt. Details: [ADR 0016](/melonapp/entscheidungen/0016-ios-autofill-und-passkeys/).
