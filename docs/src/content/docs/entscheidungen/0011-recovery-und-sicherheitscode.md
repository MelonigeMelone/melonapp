---
title: "0011: Recovery-Key und Sicherheitscode"
description: Wie man ohne Master-Passwort wieder hineinkommt und wie man geteilte Schlüssel prüft.
sidebar:
  order: 11
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

1. Wer sein Master-Passwort vergisst, verlor bisher alles. Der Betreiber kann nicht helfen,
   weil er keinen Schlüssel hat.
2. Beim Teilen glaubt die App dem Server den öffentlichen Schlüssel der anderen Person. Ein
   kompromittierter Server könnte einen eigenen unterschieben.

## Entscheidung

### Recovery-Key

- 240 bit Zufall plus 16 bit Prüfsumme (SHA-256), angezeigt als Base32 in 13 Vierergruppen:
  `WO5M-TNGX-…-SL2A`. Die Prüfsumme erkennt Tippfehler, bevor etwas an den Server geht.
- Beim Eintippen sind Groß-/Kleinschreibung, Leerzeichen und Bindestriche egal. `0`, `1` und `8`
  werden als `O`, `I` und `B` gelesen, weil Base32 diese Ziffern nicht verwendet.
- Aus dem Recovery-Key entstehen per HKDF zwei Schlüssel: ein **Recovery-Auth-Key** (der Server
  speichert nur dessen Argon2id-Hash) und ein **Recovery-Wrap-Key**, der den Konto-Schlüssel ein
  zweites Mal verschlüsselt. Argon2 ist hier nicht nötig, weil der Recovery-Key schon 240 bit
  Zufall hat.
- Wiederherstellen in zwei Schritten: Mit E-Mail und Recovery-Auth-Key bekommt man eine
  15-Minuten-Sitzung mit Geltungsbereich `recovery` und den verschlüsselten Konto-Schlüssel. Mit
  dieser Sitzung lässt sich **nur** ein neues Master-Passwort setzen, nichts lesen. Danach sind
  alle Sitzungen beendet.
- Erstellen und Ersetzen verlangt das aktuelle Master-Passwort. Den Recovery-Key zeigt die App
  genau einmal.

### Master-Passwort ändern

Neues Salt, neue Ableitung, und **nur** der Konto-Schlüssel wird neu verschlüsselt. Tresore,
geteilte Schlüssel und der Recovery-Key bleiben gültig. Das aktuelle Passwort muss bestätigt
werden. Andere Geräte werden abgemeldet.

### Sicherheitscode

`SHA-256("melon/v2/fingerprint\0" ‖ öffentlicher Schlüssel)`, die ersten 30 Byte als sechs
fünfstellige Zahlen, z. B. `98978 96831 67276 98226 18060 22594`. Zahlen lassen sich gut am
Telefon vorlesen.

- Beim Hinzufügen eines bestehenden Kontos zeigt die App den Code und fragt, ob er mit dem der
  anderen Person übereinstimmt.
- Jedes Mitglied hat im Tresor-Dialog einen Code-Knopf. Den eigenen Code zeigt „Konto“.
- **Geprüfte Codes werden gemerkt** ([#42](https://github.com/MelonigeMelone/melonapp/issues/42)):
  „Code stimmt überein“ bzw. „Code stimmt, hinzufügen“ speichert pro Person den geprüften
  öffentlichen Schlüssel. Die Liste `{ counter, marks: { <userId>: { publicKey, at } } }` wird
  mit dem **Private-Data-Key** verschlüsselt (aus dem Konto-Schlüssel abgeleitet, nur die
  Person selbst hat ihn) und liegt als Feld `verified` im `encrypted_meta` des persönlichen
  Tresors. So ist sie auf allen eigenen Geräten da, und weder der Server noch jemand mit Zugriff
  auf einen anderen Tresor kann sie lesen oder fälschen. Im Tresor-Dialog steht „Code geprüft“.
- **Gebunden an den Schlüssel:** Liefert der Server später einen anderen öffentlichen Schlüssel
  für diese Person, zeigt die App „Code geändert“ und gibt ihr keinen Tresor-Schlüssel mehr
  (Freigabe nach Einladung, Hinzufügen, Schlüsselwechsel brechen mit `key_changed` ab), bis man
  den neuen Code geprüft hat. Ungeprüfte Personen verhalten sich wie bisher.
- **Im Zweifel nichts weitergeben:** Die Liste wird bei jedem Sync geladen, **bevor** Schlüssel
  verteilt werden. Als persönlich zählt nur ein Tresor, in dem man allein Besitzer ist, und nur
  wenn es genau einen solchen gibt. Fehlt die Liste, obwohl dieses Gerät schon eine gesehen hat,
  lässt sie sich nicht öffnen, oder ist ihr `counter` kleiner als der höchste auf diesem Gerät
  gesehene (zurückgespielt), verteilt die App gar keine Tresor-Schlüssel
  (`verifications_unavailable`). Den höchsten Zähler merkt sich jedes Gerät wie bei der
  [Rollback-Erkennung](/melonapp/clients/web/#rollback-erkennung).
- **Ändern nur mit frischem Stand:** Markieren lädt die Liste zuerst neu und bricht ab, wenn das
  nicht klappt. Der neue Zähler ist höher als alles, was dieses Gerät kennt. So bleibt kein Gerät
  hängen, weil ein anderes mit altem Stand geschrieben hat.
- **Server aus Backup wiederhergestellt:** Dann ist die Liste älter als auf den Geräten, und die
  App gibt nichts weiter. Im Bereichs-Dialog steht ein Hinweis mit „Stand übernehmen“. Nach
  Bestätigung gilt die Liste vom Server mit neuem Zähler. Da das auch ein zurückgedrehter Stand
  sein kann, entscheidet das die Person bewusst.
- **Die Erweiterung gibt keine Tresor-Schlüssel weiter.** Ihr Popup hat nach dem Entsperren nur
  die Bereichs-Schlüssel, nicht den Konto-Schlüssel, und lässt Freigaben und Schlüsselwechsel der
  Web-App oder den Apps.

## Alternativen

- **Sicherheitsfrage oder E-Mail-Link:** würden dem Server Zugriff geben und damit das
  Ende-zu-Ende-Prinzip brechen.
- **Recovery durch einen Admin:** braucht einen zentralen Schlüssel, den es bewusst nicht gibt.
- **Signierte Schlüssel-Verzeichnisse (Key Transparency):** gründlicher, aber für einen
  Familien-Server übertrieben.
- **Wortliste statt Base32:** leichter vorzulesen, braucht aber eine eingebettete Wortliste und
  mehr Platz auf dem Ausdruck.

## Folgen

- Gleichzeitiges Markieren auf zwei Geräten: Wer zuletzt speichert, gewinnt, eine Markierung kann
  dabei verloren gehen. Dann fehlt nur das „geprüft“.
- Ein **neues Gerät** kennt noch keinen Zähler. Unterschlägt der Server dort die Liste ganz, sieht
  es alle als ungeprüft. Das gleiche Restrisiko hat die Rollback-Erkennung, vollständig lösbar nur
  mit einem signierten Gesamtstand.
- Der Private-Data-Key hängt am Konto-Schlüssel, nicht am Schlüsselpaar. Master-Passwort ändern
  und Recovery behalten die Liste.

- Wer Recovery-Key **und** E-Mail hat, kann das Konto übernehmen. Deshalb gehört das Kit offline
  aufbewahrt, und die Wiederherstellung ist wie der Login gegen Durchprobieren gesperrt.
- Eingeladene Personen bekommen ihren Schlüssel automatisch, sobald ein Besitzer die App öffnet,
  ohne vorherigen Code-Vergleich. Den Code kann man danach im Tresor-Dialog prüfen. Weicht er ab,
  entfernt man die Person, und der Tresor-Schlüssel wird gewechselt.
