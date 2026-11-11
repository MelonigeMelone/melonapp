---
title: Sicherheitsmodell
description: Schlüsselhierarchie, Vertrauensgrenzen und was der Server weiß.
sidebar:
  order: 1
---

**Der Server ist nicht vertrauenswürdig.** Alles Geheime wird auf dem Gerät ver- und
entschlüsselt. Selbst wer Server und Datenbank vollständig übernimmt, bekommt nur
Chiffretext, Hashes und öffentliche Schlüssel.

## Schlüsselhierarchie

```text
Master-Passwort ─Argon2id(salt)─► Master-Key (nie gespeichert, nie gesendet)
   ├─HKDF "melon/v1/auth"─► Auth-Key ─► Server speichert nur Argon2id(Auth-Key)
   └─HKDF "melon/v1/wrap"─► Wrap-Key
                              └─► Konto-Schlüssel (zufällig) ◄─ Recovery-Key (zweite Kopie)
                                     └─► privater X25519-Schlüssel
                                            └─HPKE─► Tresor-Schlüssel (je Tresor, zufällig)
                                                        └─► Einträge und Tresor-Name
```

- Der **Auth-Key** beweist dem Server, dass man das Passwort kennt. Entschlüsseln kann man damit nichts.
- Der **Konto-Schlüssel** schützt nur den privaten Schlüssel. Passwortwechsel und Recovery-Key
  verschlüsseln nur ihn neu.
- Jeder **Tresor** hat einen eigenen Schlüssel. Jedes Mitglied bekommt eine eigene, per HPKE
  für seinen öffentlichen Schlüssel verschlüsselte Kopie. Teilen gibt also nur genau diesen
  Tresor preis.

Begründung: [ADR 0009](/melonapp/entscheidungen/0009-tresor-schluessel/). Technische Details:
[Kryptografie](/melonapp/sicherheit/kryptografie/).

## Vertrauensgrenzen

| Wer | Sieht |
|---|---|
| Gerät nach dem Entsperren | alle Tresore, in denen man Mitglied ist |
| Mitglied eines geteilten Tresors | alle Einträge dieses Tresors, Mitgliederliste mit E-Mails |
| Server / Datenbank | E-Mails, Mitgliedschaften und Rollen, öffentliche Schlüssel, Anzahl und Größe der Einträge, Zeitpunkte. Keine Inhalte, keine Tresor-Namen. |
| Netzwerk | nur TLS (Caddy, HSTS) |

### Was der Server bewusst weiß

Wer mit wem einen Tresor teilt und welche Rolle jemand hat. Ohne dieses Wissen könnte der
Server Rechte (Betrachter dürfen nicht schreiben) nicht durchsetzen. Inhalte, Titel, URLs,
Benutzernamen, Eintragstypen und Tresor-Namen sind verschlüsselt.

## Rechte

Der Server prüft bei jeder Anfrage Mitgliedschaft, Rolle und Schlüsselversion
([Rollen](/melonapp/konzept/tresore/#rollen)). Was er **nicht** verhindern kann: Ein Mitglied mit
Leserecht kann gelesene Inhalte weitergeben. Deshalb werden beim Entfernen der Schlüssel
gewechselt und die wichtigen Passwörter sollten geändert werden.

## Was ein Angreifer mit der Datenbank anfangen kann

Er muss ein Master-Passwort offline erraten. Jeder Versuch kostet eine volle
Argon2id-Ableitung mit 64 MiB. Ein starkes Master-Passwort (5–6 zufällige Wörter) ist damit
praktisch nicht zu knacken.

## Öffentliche Schlüssel prüfen: Sicherheitscode

Beim Hinzufügen holt die App den öffentlichen Schlüssel vom Server. Ein kompromittierter Server
könnte einen eigenen unterschieben und so den Tresor-Schlüssel abfangen. Dagegen hilft der
**Sicherheitscode**: Die App zeigt ihn vor dem Hinzufügen an, und die andere Person sieht ihren
eigenen unter „Konto“. Stimmen beide überein, ist es der richtige Schlüssel
([ADR 0011](/melonapp/entscheidungen/0011-recovery-und-sicherheitscode/)).

Eingeladene Personen werden automatisch freigeschaltet. Ihren Code prüft man danach im Tresor-Dialog.

## Wiederherstellung

Der **Recovery-Key** aus dem Notfall-Kit verschlüsselt den Konto-Schlüssel ein zweites Mal. Damit
setzt man ein neues Master-Passwort, ohne dass der Server je einen Schlüssel sieht. Ohne
Master-Passwort und ohne Recovery-Key kommt niemand an die Daten, auch der Betreiber nicht.

```text
Recovery-Key ─HKDF─┬─► Recovery-Auth-Key ─► Server (Argon2id-Hash)
                   └─► Recovery-Wrap-Key ─► Konto-Schlüssel (zweite Kopie)
```

Wer Recovery-Key **und** E-Mail kennt, kann das Konto übernehmen. Das Kit gehört deshalb offline
aufbewahrt, ausgedruckt oder abgeschrieben.
