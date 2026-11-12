---
title: Offene Punkte
description: Bekannte Lücken und was vor dem echten Einsatz noch passieren muss.
sidebar:
  order: 4
---

:::note
Diese Seite beschreibt bekannte Grenzen. Was behoben werden soll, ist ein
[Issue mit Label `sicherheit`](https://github.com/MelonigeMelone/melonapp/issues?q=is%3Aopen+label%3Asicherheit)
([ADR 0017](/melonapp/entscheidungen/0017-issues-fuer-offene-arbeit/)).
:::

:::caution
Bis die Krypto extern geprüft ist, ist MelonApp ein Hobby-Projekt und kein geprüftes Produkt.
:::

| Punkt | Plan |
|---|---|
| Login-Limit nur pro Konto, im Speicher | IP-basiertes Limit über Caddy oder fail2ban. Ein Neustart setzt die Zähler zurück, das ist akzeptiert. → [#35](https://github.com/MelonigeMelone/melonapp/issues/35) |
| Eingeladene werden ohne vorherigen Code-Vergleich freigeschaltet | Code danach im Tresor-Dialog prüfen ([ADR 0011](/melonapp/entscheidungen/0011-recovery-und-sicherheitscode/)). Später optional: Freigabe erst nach Bestätigung. |
| Geprüfte Sicherheitscodes werden nicht gespeichert | später: „verifiziert“-Markierung pro Mitglied → [#42](https://github.com/MelonigeMelone/melonapp/issues/42) |
| Mitgliederliste zeigt allen Mitgliedern die E-Mails | gewollt für Familie/Freunde |
| Kein Wechsel des eigenen Schlüsselpaars | nach M4 → [#43](https://github.com/MelonigeMelone/melonapp/issues/43) |
| Parser nicht gefuzzt | `cargo-fuzz` für `EncString::parse` und JSON-Eingaben → [#36](https://github.com/MelonigeMelone/melonapp/issues/36) |
| Kein externes Krypto-Review | vor dem Umzug der echten Passwörter → [#37](https://github.com/MelonigeMelone/melonapp/issues/37) |
| Entschlüsselte Einträge liegen im Haupt-Thread der Web-App | gewollt, siehe [ADR 0007](/melonapp/entscheidungen/0007-schluessel-im-worker/). Schutz durch CSP und Auto-Lock. |
| CSP erlaubt `style-src 'unsafe-inline'` (MUI/Emotion) | auf Pigment CSS umsteigen, sobald stabil ([ADR 0008](/melonapp/entscheidungen/0008-mui/)) → [#41](https://github.com/MelonigeMelone/melonapp/issues/41) |
| Erweiterung hält Logins und Bereichs-Schlüssel in `storage.session` | bewusst, siehe [ADR 0013](/melonapp/entscheidungen/0013-browser-erweiterung/). Später für Chromium: Offscreen-Dokument. |
| Erweiterung leert die Zwischenablage nicht automatisch | Ausfüllen statt Kopieren nutzen |
| „Nie für diese Seite“ lässt sich noch nicht rückgängig machen | Einstellungsseite der Erweiterung, später → [#44](https://github.com/MelonigeMelone/melonapp/issues/44) |
| Erweiterung nicht in Chrome Web Store / Mozilla Add-ons | Veröffentlichen mit Signatur, später → [#45](https://github.com/MelonigeMelone/melonapp/issues/45) |
| 2FA-Schlüssel liegen im selben Tresor wie die Passwörter | bewusst, siehe [ADR 0014](/melonapp/entscheidungen/0014-2fa-und-sicherheits-check/). Wichtige Konten bei Bedarf mit separater Authenticator-App. |
| Datenleck-Abgleich nutzt einen fremden Dienst (Have I Been Pwned) | nur auf Knopfdruck, k-Anonymität. Später optional: eigene Kopie der Hash-Liste auf dem Server. |
| Ein kompromittierter Server kann Änderungen zurückhalten oder Einträge weglassen, und neue Geräte erkennen zurückgespielte Versionen nicht | Rückschritte bekannter Einträge erkennen die Apps bereits ([Rollback-Erkennung](/melonapp/clients/web/#rollback-erkennung)). Vollständig nur mit einem signierten Gesamtstand je Tresor lösbar. |
| Web-App wird vom eigenen Server ausgeliefert | ein übernommener Server könnte manipulierten Code ausliefern. Erweiterung und kommende Apps sind davon nicht betroffen. |
| Erweiterung in Firefox: kein `trackVisibility` | Firefox meldet nicht, ob ein Element verdeckt ist. Dort greifen nur die Stil-Prüfungen und `elementFromPoint`. Ein darübergelegtes Element mit `pointer-events: none` wird nicht erkannt (siehe [Erweiterung](/melonapp/clients/erweiterung/#schutzmaßnahmen)). |
| Images werden standardmäßig als `latest` gezogen | im Betrieb auf `sha-…`-Tags festlegen ([Selbst hosten](/melonapp/betrieb/selbst-hosten/#updates)) → [#39](https://github.com/MelonigeMelone/melonapp/issues/39) |

## Native Apple-Clients

Hardware-Biometrie, signierte App-Group-Zugriffe, Safari-AutoFill und gerätelokale
Passkeys benötigen noch eine unabhängige und interaktive Abnahme
([Label `apple`](https://github.com/MelonigeMelone/melonapp/issues?q=is%3Aopen+label%3Aapple)).
Details und die begründete UniFFI-Generator-Wartungsausnahme stehen im
[Apple-Review](/melonapp/sicherheit/apple-review/).

## Schwachstelle gefunden?

Bitte nicht öffentlich als Issue melden, sondern über
**Security → Report a vulnerability** im GitHub-Repo.
