---
title: Sicherheitsmodell
description: Schlüsselhierarchie, Vertrauensgrenzen und was der Server weiß.
sidebar:
  order: 1
---

**Der Server ist nicht vertrauenswürdig.** Alles Geheime wird auf dem Gerät ver- und
entschlüsselt. Selbst wer Server und Datenbank vollständig übernimmt, bekommt nur
Chiffretext und Hashes.

## Schlüsselhierarchie

```text
Master-Passwort ──Argon2id(salt)──► Master-Key (nie gespeichert, nie gesendet)
   ├─HKDF "melon/v1/auth"──► Auth-Key ──► Server speichert nur Argon2id(Auth-Key)
   └─HKDF "melon/v1/wrap"──► Wrap-Key ──verschlüsselt──► Vault-Key (zufällig, 256 bit)
                                                           └─► verschlüsselt jedes Item
```

- Der **Auth-Key** beweist dem Server, dass man das Passwort kennt. Entschlüsseln kann
  man damit nichts. Weil beide Schlüssel per HKDF mit unterschiedlichen Labels abgeleitet
  werden, lässt sich aus dem Auth-Key nicht auf den Wrap-Key schließen.
- Der **Vault-Key** ist zufällig und unabhängig vom Passwort. Bei einem Passwortwechsel
  wird nur er neu umschlüsselt. Die Items bleiben, wie sie sind.

Technische Details: [Kryptografie](/melonapp/sicherheit/kryptografie/).

## Vertrauensgrenzen

| Wer | Sieht |
|---|---|
| Gerät nach dem Entsperren | alles |
| Server / Datenbank | E-Mail, KDF-Parameter, Salt, Hash des Auth-Keys, verschlüsselter Vault-Key, verschlüsselte Items |
| Netzwerk | nur TLS (Caddy, HSTS) |

### Was der Server bewusst weiß

E-Mail, Anzahl der Items pro Modul, Größe und Änderungszeitpunkte. Inhalte, Titel,
URLs und Benutzernamen sind verschlüsselt. Diese Metadaten zu verbergen, würde
Padding und ein einziges Sammel-Item erfordern. Das lohnt sich für den Anwendungsfall nicht.

## Was ein Angreifer mit der Datenbank anfangen kann

Er muss das Master-Passwort offline erraten. Jeder Versuch kostet eine volle
Argon2id-Ableitung mit 64 MiB. Ein starkes Master-Passwort (z. B. 5–6 zufällige Wörter)
ist damit praktisch nicht zu knacken. Ein schwaches bleibt schwach. Deshalb soll die App
beim Einrichten eine Passphrase vorschlagen.

## Wiederherstellung (M2)

- **Recovery-Key:** Beim Einrichten wird ein zufälliger Schlüssel als „Notfall-Kit“
  ausgegeben. Er verschlüsselt den Vault-Key ein zweites Mal.
- Ohne Master-Passwort und ohne Recovery-Key kommt **niemand** an die Daten, auch der
  Betreiber nicht. Das gehört zum Konzept.
