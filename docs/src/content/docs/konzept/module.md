---
title: Modul-System
description: Wie neue Funktionen in MelonApp dazukommen, ohne den Server anzufassen.
sidebar:
  order: 3
---

Der Server kennt keine Module, sondern nur **verschlüsselte Items**:

```text
item = { id, module, data, revision, deleted }
```

- `id`: UUID, die der Client erzeugt. So kann er sie schon vor dem Hochladen in die
  Verschlüsselung einbinden ([AAD](/melonapp/sicherheit/kryptografie/#zusatzdaten-aad)).
- `module`: Name des Moduls, z. B. `passwords`, `totp` oder `notes`. Erlaubt sind
  Kleinbuchstaben, Ziffern, `_` und `-`, maximal 32 Zeichen, beginnend mit einem Buchstaben.
- `data`: Chiffretext. Was darin steht, bestimmt allein das Modul.

Ein neues Modul ist damit reiner Client-Code: ein eigener Bildschirm und ein eigenes
JSON-Schema im verschlüsselten `data`. Sync, Konflikterkennung und Geräte laufen automatisch mit.

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
