---
title: "0014: 2FA-Codes und Sicherheits-Check"
description: Warum 2FA-Schlüssel im Eintrag liegen und warum der Datenleck-Abgleich nur auf Knopfdruck passiert.
sidebar:
  order: 14
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

MelonApp soll eine Authenticator-App ersetzen und auf schwache, mehrfach verwendete und geleakte
Passwörter hinweisen. Beides berührt die Sicherheit: 2FA-Schlüssel sind ein zweiter Faktor, und ein
Datenleck-Abgleich braucht einen fremden Dienst. [ADR 0010](/melonapp/entscheidungen/0010-keine-logos/)
hat Verbindungen nach außen wegen der Privatsphäre bereits abgelehnt.

## Entscheidung

1. **2FA-Schlüssel sind ein Feld im Login** (Feldart `totp`), verschlüsselt wie jedes andere Feld.
   Die Codes rechnet der Client per WebCrypto (HMAC-SHA-1/256/512, RFC 6238). Kein Server-Code,
   keine neue API.
2. **Einrichten** per `otpauth://`-Link, Base32-Schlüssel oder Screenshot des QR-Codes. Das Bild wird
   nur im Browser gelesen (`jsqr`, erst bei Bedarf geladen) und nicht gespeichert.
3. **Stärke und Wiederverwendung** prüft die App lokal, ohne Netz.
4. **Datenleck-Abgleich nur auf Knopfdruck** über die Range-API von Have I Been Pwned
   (k-Anonymität): Gesendet werden nur die ersten 5 Zeichen des SHA-1-Hashes, mit `Add-Padding`,
   ohne Cookies und Referrer. Der Rest des Hashes wird lokal verglichen. Die CSP erlaubt dafür genau
   `https://api.pwnedpasswords.com`.

## Folgen

- Wer Master-Passwort und Gerät hat, hat beide Faktoren. Das ist bei 1Password und Bitwarden genauso.
  Wer das nicht will, lässt besonders wichtige 2FA-Schlüssel in einer separaten App.
- Der Dienst sieht beim Abgleich IP-Adresse und Zeitpunkt sowie Hash-Präfixe, die jeweils zu
  hunderten Passwörtern passen. Ohne Klick passiert keine Anfrage.
- Ein Angreifer mit eingeschleustem Code könnte über die erlaubte Adresse nichts exfiltrieren, was er
  selbst abrufen kann. Die Antwort des Dienstes ist für ihn nicht lesbar.
- Ist der Dienst einmal unerwünscht, fallen Knopf und CSP-Eintrag weg. Der Rest des Checks bleibt.
