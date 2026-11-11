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
  │ ◄──────────────── token, wrapped_vault_key
  │ Wrap-Key entschlüsselt Vault-Key      │
```

## Registrierung

- Standardmäßig **aus** (`MELON_ALLOW_REGISTRATION=false`). Man schaltet sie nur zum
  Anlegen der eigenen Konten an, weil MelonApp kein öffentlicher Dienst ist.
- Der Server prüft das Format: E-Mail, KDF-Parameter mit denselben Grenzen wie der Client,
  Salt 16–64 Byte, Auth-Key genau 32 Byte, Vault-Key als gültiges `EncString`.
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
- **Sperre:** Nach 10 Fehlversuchen pro E-Mail innerhalb von 15 Minuten antwortet der
  Server mit `429`, auch bei richtigem Passwort. Die Zähler liegen im Speicher (höchstens
  10 000 Einträge, alte werden aufgeräumt). Nach erfolgreichem Login wird der Zähler gelöscht.
- Argon2 läuft in `spawn_blocking`, damit es den Async-Server nicht blockiert.

## Sitzungen

- Token: 32 Byte aus `OsRng`, base64url-kodiert.
- In der Datenbank liegt nur `SHA-256(token)`. Ein Datenbank-Leak liefert also keine
  benutzbaren Tokens. SHA-256 statt Argon2 genügt, weil das Token 256 bit Zufall hat.
- Laufzeit: Standard 14 Tage (`MELON_SESSION_TTL_HOURS`, 1–8760).
- Abgelaufene Sitzungen werden beim Login des Nutzers und stündlich global gelöscht.
- Logout löscht die Sitzung sofort.
