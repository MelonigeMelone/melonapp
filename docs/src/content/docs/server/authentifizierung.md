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

Grenzen: Wer `prelogin` vor und nach einem Wechsel von `MELON_SERVER_SECRET` abfragt, sieht,
welche Salts gleich bleiben, also welche Konten es gibt. Ebenso fallen Konten auf, deren
Parameter von den Standardwerten abweichen oder deren Salt sich nach einem Passwortwechsel
ändert. Für eine private Instanz ist das akzeptiert. Das Secret deshalb nur wechseln, wenn es
bekannt geworden ist.

**Prüfung in der App:** Die Apps legen Konten nur mit den Standardwerten an (64 MiB, 3 Durchläufe).
Liefert `prelogin` weniger Speicher oder weniger Durchläufe, bricht die App ab, bevor sie den
Auth-Key ableitet oder sendet (`weak_kdf`). Ein übernommener Server kann so keinen billiger zu
ratenden Auth-Key erschleichen. Das Salt kommt weiter vom Server. Ein Server, der allen dasselbe
Salt gibt, bekommt Auth-Keys zum vollen Preis, kann aber mehrere Konten mit einer Rechnung prüfen.
Für eine Familien-Instanz ist das akzeptiert.

## Login

- **Gleiche Laufzeit:** Auch bei unbekanntem Konto oder kaputtem Auth-Key läuft genau eine
  Argon2-Prüfung, dann gegen einen Dummy-Hash, der beim Start erzeugt wird. Sonst würde
  die Antwortzeit verraten, ob das Konto existiert.
- **Sperre pro Konto und Adresse:** Nach 10 Fehlversuchen für eine E-Mail von derselben Adresse
  innerhalb von 15 Minuten antwortet der Server dieser Adresse mit `429`, auch bei richtigem
  Passwort. Andere Adressen kommen weiter an die Passwortprüfung. Ein Angreifer kann ein Konto
  also nicht von einer einzelnen Adresse aus für alle sperren.
- **Sperre pro Konto:** Nach 50 Fehlversuchen pro E-Mail innerhalb von 15 Minuten, egal von wo,
  antwortet der Server mit `429`. Das begrenzt verteiltes Raten. Ein erfolgreicher Login löscht
  beide Konto-Zähler.
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
  erfolgreicher Versuch gibt seinen Platz wieder frei. Zuerst zählt die Adresse. Ist sie
  gesperrt, legt der Server für die E-Mail gar keinen Zähler an.
- Login, Recovery und Passwortbestätigung haben getrennte Zähler (`login:`, `recover:`,
  `reauth:`). Eine E-Mail wie `recover:…` trifft also nicht den Recovery-Zähler eines anderen.
- **Kehrseite:** Wer sich eine Adresse teilt (Büro, Familie, Mobilfunk-NAT), kann die anderen
  für 15 Minuten aussperren. Dasselbe gilt, wenn Docker die echten Adressen nicht durchreicht
  (rootless Docker oder IPv6 ohne IPv6 im Docker-Netz): Dann sehen alle Anfragen wie die
  Docker-Bridge aus. Im Zweifel in den Server-Logs prüfen, welche Adressen ankommen.
- Die Zähler liegen im Speicher, höchstens 10 000 Einträge je Zähler. Abgelaufene fallen sofort
  heraus. Ist der Speicher trotzdem voll, verdrängt ein neuer Eintrag nur einen mit höchstens
  einem Versuch. Zähler, die schon mehr gezählt haben, bleiben, sonst könnte ein Angreifer mit
  vielen erfundenen E-Mails die Sperre seines Ziels löschen. Findet sich unter den ältesten 64
  Einträgen keiner, bekommt die neue Anfrage `429`. Kein Aufruf durchsucht die ganze Liste. Ein
  Neustart setzt alle Zähler zurück.
- Argon2 läuft in `spawn_blocking`, damit es den Async-Server nicht blockiert. Gleichzeitig
  laufen höchstens so viele Prüfungen wie Prozessorkerne (2 bis 16). Wer länger als 5 Sekunden auf
  einen Platz warten müsste, bekommt `429`. Das gilt für Login, Registrierung, Recovery und
  Passwortbestätigung und begrenzt Speicher und Rechenzeit, auch bei richtigen Passwörtern.

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

Die Recovery-Sitzung kann nichts lesen (Geltungsbereich `recovery`). `recover/complete` löscht sie in
einem Schritt, bevor die neuen Zugangsdaten gespeichert werden. Zwei gleichzeitige Anfragen
können sie also nicht beide nutzen. Wer nur den Token abfängt,
kommt also nicht an Daten. Er könnte höchstens ein neues Passwort setzen, für das er den
Konto-Schlüssel nicht hat.

## Sitzungen

- Token: 32 Byte direkt aus dem Betriebssystem (`SysRng`), base64url-kodiert.
- In der Datenbank liegt nur `SHA-256(token)`. Ein Datenbank-Leak liefert also keine
  benutzbaren Tokens. SHA-256 statt Argon2 genügt, weil das Token 256 bit Zufall hat.
- Laufzeit: Standard 14 Tage (`MELON_SESSION_TTL_HOURS`, 1–8760).
- Abgelaufene Sitzungen werden beim Login des Nutzers und stündlich global gelöscht.
- Ein Konto hat höchstens 20 normale Sitzungen. Ein neuer Login beendet die älteste darüber.
- Logout löscht die Sitzung sofort.
- **Geräte:** Unter „Konto → Geräte“ sieht man alle eigenen Sitzungen mit Gerätename, Anmeldedatum
  und letzter Aktivität und kann einzelne oder alle anderen abmelden. Ein abgemeldetes Gerät
  bekommt beim nächsten Sync `401` und sperrt sich mit „Deine Sitzung ist abgelaufen“.
- Der Gerätename kommt vom Client (`device.ts`: Browser und Betriebssystem, „Erweiterung in …“,
  „MelonApp für Mac/iPhone“). Er hilft beim Wiedererkennen, beweist aber nichts.
- Master-Passwort ändern und Wiederherstellen melden alle anderen Geräte ohnehin ab.
- **Abmelden ist kein Schlüsselwechsel.** Ein Gerät, das gerade entsperrt war, behält, was es
  schon entschlüsselt im Speicher hat, bis es gesperrt wird. Neue Daten bekommt es nicht mehr. Bei
  einem verlorenen oder gestohlenen Gerät deshalb zusätzlich das Master-Passwort ändern.
- Gerätenamen ohne Steuerzeichen, unsichtbare Zeichen und Schreibrichtungs-Steuerzeichen, damit
  ein Name nicht rückwärts dargestellt wie ein anderes Gerät aussieht.
