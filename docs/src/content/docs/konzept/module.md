---
title: Modul-System
description: Wie neue Funktionen in MelonApp dazukommen, ohne den Server anzufassen.
sidebar:
  order: 4
---

Der Server kennt keine Module, sondern nur **Tresore** und **verschlüsselte Einträge**:

```text
eintrag = { tresor_id, id, data, revision, deleted, key_version }
```

Welcher Art ein Eintrag ist (Login, Notiz, Kreditkarte, später 2FA-Code …), steht **im
verschlüsselten `data`** ([Eintragstypen](/melonapp/konzept/tresore/#eintragstypen-und-eigene-felder)).
Ein neues Modul ist damit reiner Client-Code: ein neuer Eintragstyp mit eigener Anzeige.
Sync, Teilen, Rollen und Konflikterkennung laufen automatisch mit.

:::caution[Warnzeichen]
Braucht ein neues Modul doch eine Server-Änderung, ist das ein Hinweis darauf, dass
Nutzerinhalte unverschlüsselt beim Server landen würden.
:::

## Modul-Ideen

| Modul | Nutzen |
|---|---|
| Passwörter + Passkeys | Start-Modul |
| 2FA-Codes (TOTP) | Authenticator-App ersetzen |
| Sichere Notizen | WLAN-Passwörter, Codes, Ausweisnummern |
| Dokumente | Verschlüsselte Ablage (Ausweis-Scans, Verträge), eigene Blob-API |
| Teilen | Einzelne Einträge oder Ordner mit der Familie (X25519-Schlüsselpaare) |
