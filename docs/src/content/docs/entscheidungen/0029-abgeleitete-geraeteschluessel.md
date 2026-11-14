---
title: "0029: Abgeleitete Geräteschlüssel"
description: Schlüsselbund-Einträge für Face ID und die AutoFill-Extension enthalten nie den Kontoschlüssel, sondern eigene, per HKDF abgeleitete Schlüssel.
---

**Status:** angenommen · **Datum:** 2026-11-14

## Kontext

Für biometrisches Entsperren und für die iOS-AutoFill-Extension lag bisher der rohe
Kontoschlüssel im Schlüsselbund. Bei AutoFill sogar in der Zugriffsgruppe, die App und
Extension teilen. Die Extension braucht aber nur die Passwort-Kopie und die Passkeys. Mit dem
Kontoschlüssel und `encryptedPrivateKey` vom Server lässt sich die Identität öffnen und damit
jeder Bereichsschlüssel, auch geteilte Bereiche. Eine kompromittierte Extension (oder eine
andere App desselben Teams mit Zugriff auf die Gruppe) hätte nach einem Face-ID-Dialog das ganze
Konto gehabt. Außerdem konnte sie mit dem Schlüssel API-Cache-Dateien der App fälschen.
Gefunden im internen Pentest (Advisory GHSA-3r3v-72gf-mrp8).

## Entscheidung

`melon-crypto` leitet Geräteschlüssel ab:
HKDF-SHA256(Salt `melon/v2/device-key`, IKM Kontoschlüssel, Info Zweck ‖ `\0` ‖ Scope).

- **AutoFill:** Zweck `autofill`, Scope = SHA-256(Server ‖ `/` ‖ Benutzer-ID). Nur dieser
  Schlüssel liegt unter `de.melonapp.autofill.v1` in der geteilten Zugriffsgruppe. Damit sind
  Passwort-Kopie, `{scope}.synced.enc` und die Briefkasten-Dateien verschlüsselt. Die privaten
  Passkey-Schlüssel darin verpackt die App beim Veröffentlichen mit dem AutoFill-Schlüssel neu.
  Bei der Übernahme in den Tresor öffnet sie die App mit demselben Schlüssel.
- **Face ID:** Zweck `biometric`, Scope = Server ‖ `/biometric`. Der Schlüsselbund-Eintrag
  hält den abgeleiteten Schlüssel. Er verschlüsselt den Wiederaufnahmezustand
  (`melon/native/biometric/v2/…`), und erst darin steckt der Kontoschlüssel. Beim Entsperren
  prüft Rust, dass der Kontoschlüssel aus dem Zustand wieder genau den Schlüssel aus dem
  Schlüsselbund ergibt.

Die Swift-Seite bleibt unverändert: Sie bekommt 32 Byte aus dem Schlüsselbund und kennt keinen
Unterschied. Der Kontoschlüssel verlässt die App nicht mehr.

## Alternativen

- **Zufälliger AutoFill-Schlüssel, im Tresor gespeichert:** müsste synchronisiert und bei jedem
  Gerät verwaltet werden. Die Ableitung ergibt ihn nach jedem Entsperren ohne Zustand.
- **Kontoschlüssel behalten, nur Rechte enger:** löst das Problem nicht. Wer den Eintrag liest,
  hat weiterhin das ganze Konto.

## Folgen

- Ein kompromittierter AutoFill-Schlüssel verrät nur, was die Extension ohnehin sieht:
  Login-Einträge und Passkeys. Identität, Bereichsschlüssel und API-Cache bleiben zu.
- Briefkasten-Dateien und die alte `{scope}.passkeys.enc`, die vor dem Update noch mit dem
  Kontoschlüssel verschlüsselt wurden, übernimmt die App weiterhin. Dafür versucht sie nach dem
  AutoFill-Schlüssel auch den Kontoschlüssel. Das geht nur in der App, nie in der Extension.
- Die nächste Veröffentlichung ersetzt den alten Schlüsselbund-Eintrag. Das passiert nach dem
  ersten Entsperren automatisch, wenn AutoFill aktiv ist.
- Alte Face-ID-Einrichtungen (v1) gelten nicht mehr. Nach dem Update muss man Face ID oder
  Touch ID einmal mit dem Master-Passwort neu einrichten. Den alten Eintrag mit dem rohen
  Kontoschlüssel löscht die App schon vorher, sobald die Statusabfrage im Konto ihn als alte
  Einrichtung dieses Kontos erkennt.
