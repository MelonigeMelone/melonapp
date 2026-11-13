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
| Ein Konto lässt sich mit Versuchen von mehreren Adressen 15 Minuten lang sperren | 50 Fehlversuche von mindestens fünf Adressen nötig. Bestehende Sitzungen laufen weiter. |
| Login-Limits liegen im Speicher | Ein Neustart setzt die Zähler pro Konto und pro Adresse zurück. Das ist akzeptiert. Wer mehr will, ergänzt fail2ban auf die `failed login`-Logzeilen. |
| Eingeladene werden ohne vorherigen Code-Vergleich freigeschaltet | Code danach im Tresor-Dialog prüfen ([ADR 0011](/melonapp/entscheidungen/0011-recovery-und-sicherheitscode/)). Nur wer wirklich eingeladen wurde ([ADR 0025](/melonapp/entscheidungen/0025-verschluesselte-mitgliederliste/)). Später optional: Freigabe erst nach Bestätigung. |
| Verschlüsselte Mitgliederliste wird für bestehende Tresore einmal vom Server übernommen | Übergang nach dem Update ([ADR 0025](/melonapp/entscheidungen/0025-verschluesselte-mitgliederliste/)). Neue Geräte erkennen eine zurückgespielte Liste nicht. |
| Erstes Vertrauen bei neuen geteilten Tresoren und neuen Geräten | Einen neuen Tresor kann ein Server mit erfundenem Mitglied vortäuschen; Sicherheitscode prüfen. Ein neues Gerät nimmt nach einem zurückgespielten Stand von vor dem Update noch einmal eine alte Kopie des persönlichen Tresors an und wechselt dann sofort den Schlüssel ([ADR 0027](/melonapp/entscheidungen/0027-authentisierte-tresor-schluessel/)). |
| Neuer Schlüssel von einem später hinzugekommenen, ungeprüften Mitglied wird nicht angenommen | Code des Mitglieds prüfen, dann klappt es ([ADR 0027](/melonapp/entscheidungen/0027-authentisierte-tresor-schluessel/)) |
| Ehemaliges Mitglied plus Server können einen neuen Tresor-Schlüssel unterschieben | nur bis das Gerät die neue Mitgliederliste gesehen hat ([ADR 0027](/melonapp/entscheidungen/0027-authentisierte-tresor-schluessel/)) |
| Mitgliederliste zeigt allen Mitgliedern die E-Mails | gewollt für Familie/Freunde |
| Kein Wechsel des eigenen Schlüsselpaars | nach M4 → [#43](https://github.com/MelonigeMelone/melonapp/issues/43) |
| Kein externes Krypto-Review | vor dem Umzug der echten Passwörter → [#37](https://github.com/MelonigeMelone/melonapp/issues/37) |
| Entschlüsselte Einträge liegen im Haupt-Thread der Web-App | gewollt, siehe [ADR 0007](/melonapp/entscheidungen/0007-schluessel-im-worker/). Schutz durch CSP und Auto-Lock. |
| Desktop-App: CSP erlaubt `style-src 'unsafe-inline'` | Tauris CSP ist fest, ein Nonce je Aufruf geht nicht. Die App lädt nur eingebauten Code. Mit Pigment CSS entfällt es ([ADR 0019](/melonapp/entscheidungen/0019-csp-nonce-fuer-styles/)). |
| Erweiterung hält Logins und Bereichs-Schlüssel in `storage.session` | bewusst, siehe [ADR 0013](/melonapp/entscheidungen/0013-browser-erweiterung/). Später für Chromium: Offscreen-Dokument. |
| Erweiterung: Eine Seite mit eingeschleustem Skript kann getippte Zeichen im Passwortfeld umordnen oder löschen, bevor die Speicher-Karte kommt | Nur aus Zeichen, die man selbst getippt hat, nur für Logins dieser Seite, ein Versuch pro Absenden. Beim Aktualisieren bleibt das alte Passwort im Verlauf. |
| Erweiterung leert die Zwischenablage nicht automatisch | Ausfüllen statt Kopieren nutzen |
| Erweiterung nicht in Chrome Web Store / Mozilla Add-ons | Veröffentlichen mit Signatur, später → [#45](https://github.com/MelonigeMelone/melonapp/issues/45) |
| 2FA-Schlüssel liegen im selben Tresor wie die Passwörter | bewusst, siehe [ADR 0014](/melonapp/entscheidungen/0014-2fa-und-sicherheits-check/). Wichtige Konten bei Bedarf mit separater Authenticator-App. |
| Datenleck-Abgleich nutzt einen fremden Dienst (Have I Been Pwned) | nur auf Knopfdruck, k-Anonymität. Später optional: eigene Kopie der Hash-Liste auf dem Server. |
| Ein kompromittierter Server kann Änderungen zurückhalten oder Einträge weglassen, und neue Geräte erkennen zurückgespielte Versionen nicht | Rückschritte bekannter Einträge erkennen die Apps bereits ([Rollback-Erkennung](/melonapp/clients/web/#rollback-erkennung)). Vollständig nur mit einem signierten Gesamtstand je Tresor lösbar. |
| Web-App wird vom eigenen Server ausgeliefert | ein übernommener Server könnte manipulierten Code ausliefern. Erweiterung und kommende Apps sind davon nicht betroffen. |
| Erweiterung in Firefox und Safari: kein `trackVisibility` | Firefox und Safari melden nicht, ob ein Element verdeckt ist. Dort greifen nur die Stil-Prüfungen und `elementFromPoint`. Ein darübergelegtes Element mit `pointer-events: none` wird nicht erkannt (siehe [Erweiterung](/melonapp/clients/erweiterung/#schutzmaßnahmen)). |

## Native Apple-Clients

Hardware-Biometrie, signierte App-Group-Zugriffe, Safari-AutoFill und Passkeys sind auf
einem iPhone abgenommen; der Passkey-Sync aus ADR 0023 und eine unabhängige Prüfung stehen noch aus
([Label `apple`](https://github.com/MelonigeMelone/melonapp/issues?q=is%3Aopen+label%3Aapple)).
Details und die begründete UniFFI-Generator-Wartungsausnahme stehen im
[Apple-Review](/melonapp/sicherheit/apple-review/).

## Schwachstelle gefunden?

Bitte nicht öffentlich als Issue melden, sondern über
**Security → Report a vulnerability** im GitHub-Repo.
