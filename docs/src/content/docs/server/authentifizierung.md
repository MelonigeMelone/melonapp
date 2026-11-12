---
title: Authentifizierung
description: Registrierung, Login, Sitzungen und Schutz gegen Angriffe auf den Login.
sidebar:
  order: 2
---

## Ablauf

```text
Client                                   Server
  │ prelogin(email) ───────────────────►  │  KDF-Parameter + Salt
  │ ◄──────────────────────────────────── │
  │ Argon2id → Master-Key → Auth-Key      │
  │ login(email, auth_key) ────────────►  │  Argon2id-Verify gegen gespeicherten Hash
  │ ◄──── token, wrapped_account_key, encrypted_private_key
  │ Wrap-Key → Konto-Schlüssel → privater Schlüssel
  │ privater Schlüssel öffnet die Tresor-Schlüssel (GET /vaults)
```

## Registrierung

- Standardmäßig **aus** (`MELON_ALLOW_REGISTRATION=false`). Man schaltet sie nur zum
  Anlegen der eigenen Konten an, weil MelonApp kein öffentlicher Dienst ist.
- Alternativ mit **Einladungs-Token**: gilt 7 Tage, nur einmal und nur für die E-Mail, für die
  er erzeugt wurde. Damit klappt die Registrierung auch bei ausgeschalteter offener Registrierung.
- Der Server prüft das Format: E-Mail, KDF-Parameter mit denselben Grenzen wie der Client,
  Salt 16–64 Byte, Auth-Key genau 32 Byte, öffentlicher Schlüssel (X25519), verschlüsseltes
  Schlüsselmaterial als gültiges `EncString` bzw. `SealedKey`.
- In derselben Transaktion entstehen Konto, persönlicher Tresor und die Mitgliedschaft als
  Besitzer. Bei Einladung kommt die wartende Mitgliedschaft im geteilten Tresor dazu.
- Der Auth-Key wird **noch einmal** mit Argon2id gehasht (19 MiB, 2 Iterationen) und als
  PHC-String gespeichert. Diese leichteren Parameter reichen, weil der Auth-Key schon ein
  256-bit-Geheimnis ist. Der Hash schützt nur davor, dass jemand mit einer geklauten
  Datenbank sich direkt als Nutzer anmelden kann.
- E-Mails werden getrimmt und kleingeschrieben.

## prelogin

Für eine **unbekannte** E-Mail antwortet der Server mit den Standard-Parametern und einem
Fake-Salt: `HMAC-SHA256(MELON_SERVER_SECRET, "melon/prelogin-salt\0" ‖ email)[..16]`.
Dieses Salt ist für dieselbe E-Mail immer gleich. So lässt sich über `prelogin` nicht
herausfinden, welche Konten existieren. Ein zufälliges Salt würde sich bei jeder Abfrage
ändern und das Konto damit verraten.

## Login

- **Gleiche Laufzeit:** Auch bei unbekanntem Konto oder kaputtem Auth-Key läuft genau eine
  Argon2-Prüfung, dann gegen einen Dummy-Hash, der beim Start erzeugt wird. Sonst würde
  die Antwortzeit verraten, ob das Konto existiert.
- **Sperre pro Konto:** Nach 10 Fehlversuchen pro E-Mail innerhalb von 15 Minuten antwortet
  der Server mit `429`, auch bei richtigem Passwort. Nach erfolgreichem Login wird der Zähler
  gelöscht.
- **Sperre pro Adresse:** Nach 30 Fehlversuchen (Login und Recovery zusammen) von derselben
  IP-Adresse innerhalb von 15 Minuten antwortet der Server für **alle** Konten mit `429`. Das
  bremst Angriffe, die viele E-Mails durchprobieren. IPv6-Adressen zählen je /64-Netz, sonst
  könnte ein Angreifer einfach die Adresse wechseln. Ein erfolgreicher Login setzt diesen
  Zähler **nicht** zurück, sonst könnte ein Angreifer mit eigenem Konto ihn leeren.
- **Woher die Adresse kommt:** Mit `MELON_TRUST_PROXY=true` aus dem **letzten** Eintrag von
  `X-Forwarded-For`, also dem, den der eigene Reverse Proxy angehängt hat. Caddy ignoriert
  mitgeschickte Werte unbekannter Clients und setzt die echte Adresse. Ohne die Variable zählt
  die Adresse der TCP-Verbindung, und der Header wird ignoriert, weil ihn jeder setzen kann.
- Jeder Versuch wird **vor** der langsamen Argon2-Prüfung gezählt, in einem Schritt mit der
  Prüfung auf Sperre. Viele gleichzeitige Anfragen kommen so nicht an den Limits vorbei. Ein
  erfolgreicher Versuch gibt seinen Platz wieder frei.
- **Kehrseite:** Wer sich eine Adresse teilt (Büro, Familie, Mobilfunk-NAT), kann die anderen
  für 15 Minuten aussperren. Dasselbe gilt, wenn Docker die echten Adressen nicht durchreicht
  (rootless Docker oder IPv6 ohne IPv6 im Docker-Netz): Dann sehen alle Anfragen wie die
  Docker-Bridge aus. Im Zweifel in den Server-Logs prüfen, welche Adressen ankommen.
- Die Zähler liegen im Speicher (höchstens 10 000 Einträge, alte werden aufgeräumt). Ein
  Neustart setzt sie zurück.
- Argon2 läuft in `spawn_blocking`, damit es den Async-Server nicht blockiert.

## Master-Passwort ändern

Die App leitet aus dem aktuellen Passwort den Auth-Key ab (Bestätigung) und aus dem neuen
Passwort mit neuem Salt den neuen Auth- und Wrap-Key. Nur der Konto-Schlüssel wird neu
verschlüsselt. Alles darunter (privater Schlüssel, Tresor-Schlüssel, Recovery-Kopie) bleibt.
Andere Geräte werden abgemeldet.

## Wiederherstellen mit dem Recovery-Key

```text
Client                                         Server
  │ Recovery-Key → Recovery-Auth-Key, -Wrap-Key  │
  │ recover/start(email, recovery_auth_key) ───► │ Argon2id-Verify, Sperre bei Fehlversuchen
  │ ◄──── Recovery-Token (15 min), recovery_wrapped_account_key
  │ Konto-Schlüssel entschlüsseln, neues Passwort ableiten
  │ recover/complete(neue Zugangsdaten) ──────►  │ speichern, alle Sitzungen beenden
  │ normaler Login mit neuem Passwort            │
```

Die Recovery-Sitzung kann nichts lesen (Geltungsbereich `recovery`). Wer nur den Token abfängt,
kommt also nicht an Daten. Er könnte höchstens ein neues Passwort setzen, für das er den
Konto-Schlüssel nicht hat.

## Sitzungen

- Token: 32 Byte direkt aus dem Betriebssystem (`SysRng`), base64url-kodiert.
- In der Datenbank liegt nur `SHA-256(token)`. Ein Datenbank-Leak liefert also keine
  benutzbaren Tokens. SHA-256 statt Argon2 genügt, weil das Token 256 bit Zufall hat.
- Laufzeit: Standard 14 Tage (`MELON_SESSION_TTL_HOURS`, 1–8760).
- Abgelaufene Sitzungen werden beim Login des Nutzers und stündlich global gelöscht.
- Logout löscht die Sitzung sofort.
- **Geräte:** Unter „Konto → Geräte“ sieht man alle eigenen Sitzungen mit Gerätename, Anmeldedatum
  und letzter Aktivität und kann einzelne oder alle anderen abmelden. Ein abgemeldetes Gerät
  bekommt beim nächsten Sync `401` und sperrt sich mit „Deine Sitzung ist abgelaufen“.
- Der Gerätename kommt vom Client (`device.ts`: Browser und Betriebssystem, „Erweiterung in …“,
  „MelonApp für Mac/iPhone“). Er hilft beim Wiedererkennen, beweist aber nichts.
- Master-Passwort ändern und Wiederherstellen melden alle anderen Geräte ohnehin ab.
