---
title: "0009: Tresor-Schlüssel und Schlüsselpaare"
description: Wie geteilte Tresore Ende-zu-Ende verschlüsselt bleiben.
sidebar:
  order: 9
---

**Status:** angenommen · **Datum:** 2026-11-11 · ersetzt das Ein-Schlüssel-Modell aus M1

## Kontext

Bisher hatte jedes Konto genau einen Vault-Key. Damit lässt sich nichts teilen, ohne den
gesamten Tresor preiszugeben. Gewünscht sind ein persönlicher Tresor und geteilte Tresore
mit Mitgliedern und Rollen, ohne dass der Server Inhalte lesen kann.

## Entscheidung

```text
Master-Passwort ─Argon2id─► Master-Key ─HKDF─┬─► Auth-Key ─► Server (Argon2id-Hash)
                                             └─► Wrap-Key ─► entschlüsselt Konto-Schlüssel
Konto-Schlüssel (zufällig) ─► entschlüsselt privaten X25519-Schlüssel
Öffentlicher Schlüssel ─HPKE─► Tresor-Schlüssel je Mitglied
Tresor-Schlüssel (zufällig, je Tresor) ─► Einträge und Tresor-Name
```

- **Konto-Schlüssel:** zufällig, mit dem Wrap-Key verschlüsselt. Er schützt nur den privaten
  Schlüssel. Passwortwechsel und Recovery-Key verschlüsseln nur ihn neu.
- **Schlüsselpaar je Person:** X25519. Der öffentliche Schlüssel liegt im Klartext auf dem
  Server, der private verschlüsselt.
- **Tresor-Schlüssel je Tresor:** zufällig, 256 bit. Für jedes Mitglied einzeln per **HPKE**
  (RFC 9180, `DHKEM(X25519, HKDF-SHA256)`, `HKDF-SHA256`, `ChaCha20Poly1305`, Base-Modus)
  verschlüsselt. Auch der persönliche Tresor funktioniert so, als Tresor mit einem Mitglied.
  Seit [ADR 0027](/melonapp/entscheidungen/0027-authentisierte-tresor-schluessel/) im Auth-Modus mit dem Schlüsselpaar des Absenders.
- **AAD** bindet jeden Chiffretext an seinen Platz:
  - Eintrag: `melon/v2/item\0<tresor-id>\0<eintrag-id>\0<schlüsselversion>`
  - Tresor-Name: `melon/v2/vault-meta\0<tresor-id>\0<schlüsselversion>`
  - Tresor-Schlüssel (HPKE-`info`): `melon/v2/vault-key\0<tresor-id>\0<nutzer-id>\0<schlüsselversion>`
- **Schlüsselversion:** Jeder Tresor zählt seine Schlüssel hoch. Beim Entfernen eines
  Mitglieds sendet ein Besitzer neuen Schlüssel, neu verschlüsselte Einträge und neue
  Schlüssel-Kopien in **einer** Anfrage. Der Server übernimmt sie atomar, aber nur, wenn
  wirklich alle Einträge und alle verbleibenden Mitglieder enthalten sind.
- Der Server nimmt Einträge nur mit der aktuellen Schlüsselversion an. Ein Gerät mit altem
  Schlüssel kann also nichts mehr schreiben, was andere nicht lesen könnten.

## Alternativen

- **Einen Schlüssel pro Konto, Einträge einzeln teilen:** jede geteilte Kopie müsste getrennt
  aktuell gehalten werden. Fehleranfällig.
- **Eigene ECIES-Konstruktion aus X25519 + HKDF + XChaCha:** würde funktionieren, wäre aber
  selbst gebaute Kryptografie. HPKE ist der Standard dafür.
- **Signaturen (Ed25519) auf öffentlichen Schlüsseln:** schützen gegen einen Server, der beim
  Einladen einen falschen Schlüssel unterschiebt. Kommen später als Fingerabdruck-Vergleich
  (siehe [Offene Punkte](/melonapp/sicherheit/offene-punkte/)).

## Folgen

- Teilen ohne Preisgabe gegenüber dem Server.
- Ein Mitglied ohne Konto kann erst einen Schlüssel bekommen, wenn es eines hat. Deshalb gibt
  es den Zwischenzustand „wartendes Mitglied“.
- Entfernen kostet einmal Neu-Verschlüsseln aller Einträge des Tresors. Bei Familien-Tresoren
  mit einigen hundert Einträgen ist das ein Sekundenbruchteil.
- **Vertrauen in öffentliche Schlüssel:** Ein kompromittierter Server könnte beim Hinzufügen
  einen eigenen öffentlichen Schlüssel ausliefern. Gegenmittel ist ein Fingerabdruck, den
  beide Personen vergleichen. Der ist geplant, aber noch nicht umgesetzt.
