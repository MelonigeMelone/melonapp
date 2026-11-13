---
title: "0027: Authentisierte Tresor-Schlüssel"
description: Schlüssel-Kopien tragen ihren Absender, der persönliche Tresor nimmt nur eigene Kopien an, und jedes Konto merkt sich verschlüsselt, welcher Schlüssel zu welchem Tresor gehört.
---

**Status:** angenommen · **Datum:** 2026-11-13

## Kontext

Tresor-Schlüssel wurden mit HPKE im Base-Modus für das Mitglied verschlüsselt
([ADR 0009](/melonapp/entscheidungen/0009-tresor-schluessel/)). Der Base-Modus sagt nichts darüber,
wer die Kopie erzeugt hat. Jeder, der den öffentlichen Schlüssel kennt, also auch der Server,
konnte eine gültige Kopie mit einem eigenen Tresor-Schlüssel erzeugen. Die App übernahm sie beim
nächsten Entsperren ohne Warnung. Alles, was danach gespeichert wurde, konnte der Server lesen.
Das galt auch für den persönlichen Tresor und für die Desktop- und iPhone-App, nicht nur für die
Web-App. Der Sicherheitscode half nicht, weil der echte öffentliche Schlüssel benutzt wird.

## Entscheidung

**1. Kopien tragen ihren Absender.** Neue Kopien entstehen im HPKE-**Auth-Modus** mit dem
Schlüsselpaar dessen, der sie erzeugt (Format `h2`). Öffnen klappt nur mit dem öffentlichen
Schlüssel des Absenders. Die App probiert eine Liste erlaubter Absender durch und erfährt dabei,
von wem die Kopie stammt. Wer keinen privaten Schlüssel eines erlaubten Absenders hat, kann keine
Kopie fälschen. Alte Kopien (`h1`, Base-Modus) bleiben lesbar, gelten aber als „ohne Absender“.

**2. Der persönliche Tresor nimmt nur eigene Kopien an.** Erlaubter Absender ist nur das eigene
Schlüsselpaar, und zwar das aus dem Worker, nicht das vom Server gemeldete. Für den Übergang
öffnet die App eine alte `h1`-Kopie einmal und wechselt sofort den Schlüssel des persönlichen
Tresors: neuer Zufallsschlüssel, eigene `h2`-Kopie, alle Einträge neu verschlüsselt. Bis das
geklappt hat, schreibt sie mit dem alten Schlüssel nichts: keine Einträge, kein Meta, kein
Schlüsselbund. Scheitert der Wechsel, versucht sie es bei jedem Sync erneut. Danach merkt
sich das Gerät, dass der Wechsel passiert ist (`#personal-key` im
[Merkspeicher](/melonapp/clients/web/#rollback-erkennung)), und lehnt `h1` dort ab. Der Server
erlaubt dafür `POST /vaults/{id}/rotate` auch für persönliche Tresore, ohne Entfernen.

**3. Jedes Konto merkt sich die Schlüssel seiner geteilten Tresore.** Im persönlichen Tresor liegt
im Meta-Feld `keys` ein mit dem Konto-Schlüssel versiegelter Schlüsselbund
(`PrivateDataKey`, Zweck `vault-keys`, wie bei den geprüften Codes):
je Tresor `{ version, keyId, granters }`. `keyId` ist ein SHA-256 über Tresor-ID, Version und
Schlüssel. `granters` sind Mitglieder mit dem öffentlichen Schlüssel, den die App für sie
festhält:

- beim ersten Annehmen eines Tresors die Mitglieder aus der verschlüsselten Mitgliederliste
  ([ADR 0025](/melonapp/entscheidungen/0025-verschluesselte-mitgliederliste/)), bei Tresoren ohne
  Liste die Mitglieder mit Schlüssel, jeweils mit dem Schlüssel vom Server (erstes Vertrauen);
- der Absender jeder angenommenen `h2`-Kopie;
- später neu in der Liste auftauchende Mitglieder nur mit dem Schlüssel aus einem geprüften Code,
  nie mit dem vom Server gemeldeten. Die Liste muss dabei die Rollback-Prüfung bestehen. Ein Zähler mit Merkwert
(`#keys`) erkennt einen zurückgespielten oder fehlenden Schlüsselbund.

Beim Öffnen einer Kopie eines geteilten Tresors gilt:

| Lage | Annahme |
|---|---|
| Tresor unbekannt | von jedem Mitglied, auch `h1` (erstes Vertrauen wie bei Einladungen) |
| bekannte Version | nur genau der gemerkte Schlüssel (`keyId`) |
| neuere Version | nur `h2` von einem bekannten Mitglied mit gleichem Schlüssel, von sich selbst oder von jemandem mit geprüftem Code |
| ältere Version | nie (`vault_key_rolled_back`) |
| Schlüsselbund fehlt oder ist älter als gesehen | kein geteilter Tresor wird neu geöffnet (`vault_keys_unavailable`) |

Kopien, die die App selbst erzeugt (Freigabe, Hinzufügen, Schlüsselwechsel, neuer Tresor), sind
immer `h2` mit dem eigenen Schlüsselpaar. Beim Schlüsselwechsel verschlüsselt sie die eigene
Kopie für den eigenen Schlüssel aus dem Worker, nicht für den vom Server gemeldeten.

## Alternativen

- **Signatur statt Auth-Modus** (Ed25519 über die Kopie): bräuchte ein zweites Schlüsselpaar je
  Konto mit Verteilung und Sicherheitscode. Der Auth-Modus nutzt das vorhandene X25519-Paar und
  ist Teil desselben Standards (RFC 9180).
- **Persönlichen Tresor-Schlüssel aus dem Konto-Schlüssel ableiten:** gleiche Wirkung, aber ein
  Sonderweg neben der HPKE-Verteilung. Ein Schlüsselwechsel ginge dann nur mit neuem Konto-Schlüssel.
- **Nur den Schlüsselbund, ohne Auth-Modus:** schützt bekannte Versionen, aber nach einem
  Schlüsselwechsel könnte der Server weiter beliebige neue Schlüssel unterschieben.
- **`h1` sofort überall ablehnen:** würde alle bestehenden Tresore unlesbar machen, bis jemand
  sie neu verteilt.

## Folgen

- Ein übernommener Server kann weder den persönlichen Tresor noch einen bekannten geteilten
  Tresor auf einen eigenen Schlüssel umstellen.
- Erstes Vertrauen bleibt: Einen **neuen** geteilten Tresor oder eine Einladung kann ein Server mit
  einem erfundenen Mitglied vortäuschen. Dagegen hilft nur der Sicherheitscode.
- Ein **neues Gerät**, dem der Server einen Stand von vor dem Übergang zurückspielt, nimmt eine
  `h1`-Kopie des persönlichen Tresors noch einmal an. Weil es dann sofort einen neuen Schlüssel
  erzeugt, bleiben neue Einträge vertraulich. Eingeschleuste Einträge könnten aber auftauchen.
- Ein ehemaliges Mitglied, das noch in einer alten Liste steht, könnte zusammen mit dem Server
  einen neuen Schlüssel unterschieben, bis das Gerät die neue Mitgliederliste gesehen hat.
- Wechselt ein Mitglied den Schlüssel, das erst nach dem ersten Annehmen dazukam und dessen Code
  nicht geprüft ist, nimmt die App den neuen Schlüssel nicht an, bis man den Code prüft.
- Ältere App-Versionen können `h2`-Kopien nicht öffnen. Web-App, Erweiterung, Desktop- und
  iPhone-App müssen zusammen aktualisiert werden.
- Das Tresor-Meta darf jetzt 64 KiB groß sein (vorher 4 KiB), damit der Schlüsselbund Platz hat.
- Öffnen einer `h2`-Kopie kostet je Kandidat einen HPKE-Versuch. Bei Familien-Größen ist das
  nicht messbar.
