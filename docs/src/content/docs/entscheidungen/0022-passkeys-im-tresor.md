---
title: "0022: Passkeys als verschlüsselte Tresor-Einträge"
description: Passkeys werden eigener Eintragstyp im Tresor, die iOS-Extension übergibt neue Passkeys über einen Briefkasten in der App Group.
---

**Status:** angenommen · **Datum:** 2026-11-12

## Kontext

Passkeys aus der iOS-AutoFill-Extension lagen bisher nur auf dem Gerät
([ADR 0016](/melonapp/entscheidungen/0016-ios-autofill-und-passkeys/)). Ging das iPhone oder
die App verloren, waren sie weg. Gleichzeitig verlangt iOS, dass die Authenticator-Daten
„gesichert“ (BE/BS) melden, und Relying Parties verlassen sich darauf. Gesucht war Sync,
Export und Wiederherstellung, ohne den Server mehr sehen zu lassen.

Die Extension hat keine Serververbindung und keine entsperrte Kontositzung. Sie kann einen
Passkey nur lokal erzeugen und muss ihn der App übergeben.

## Entscheidung

- **Eigener Eintragstyp `passkey`** im verschlüsselten Eintrag mit den Feldern RP-ID,
  Benutzername, Credential-ID, User-Handle (beide base64url) und privatem Schlüssel
  (32-Byte-P-256-Skalar, base64url, Feldart „Verborgen“). Der Server sieht wie bei allen
  Einträgen nur Chiffretext. Sync, Schlüsselwechsel, Teilen, Papierkorb, verschlüsselter
  Export und Kontowiederherstellung gelten damit automatisch.
- **Briefkasten statt gemeinsamer Datei:** Die Extension schreibt jeden neuen Passkey in eine
  eigene Datei `{scope}.outbox.{credential-id-hex}.enc` in der App Group, verschlüsselt mit dem
  Kontoschlüssel und an Scope und Credential-ID gebunden. Getrennte Dateien vermeiden verlorene
  Schreibvorgänge, wenn App und Extension gleichzeitig laufen.
- **Übernahme nach dem Entsperren:** Die App liest den Briefkasten (und die alte gerätelokale
  `{scope}.passkeys.enc`), legt fehlende Passkeys im persönlichen Bereich an und löscht eine
  Datei erst, wenn alle Passkeys darin gespeichert sind. Passkeys, die schon im Tresor oder im
  Papierkorb liegen, werden nicht erneut angelegt; Löschen im Tresor bleibt also wirksam.
- **Rückweg zur Extension:** Beim Veröffentlichen von AutoFill schreibt die App alle Passkeys
  aus dem Tresor (ohne Papierkorb) als `{scope}.synced.enc`. Jeder private Schlüssel wird
  dafür in Rust mit dem Kontoschlüssel neu verpackt (AAD mit RP-ID und Credential-ID) und die
  Liste zusätzlich als Cache verschlüsselt. Die Extension liest vereinte Liste aus synced,
  Briefkasten und Altdatei, ohne Doppelte.
- **Automatisch:** Nach jedem Entsperren auf iOS übernimmt die App den Briefkasten und
  veröffentlicht AutoFill neu, wenn es für dieses Konto schon aktiv ist.
- **CSV-Export lässt Passkeys weg.** Ein privater Schlüssel gehört nicht in eine Klartextdatei.
- **In der Oberfläche** ist der Typ nicht von Hand anlegbar, die Passkey-Felder sind nicht
  bearbeitbar und der private Schlüssel wird nicht angezeigt.

## Alternativen

- **Passkeys als eigene Server-Tabelle:** neue Endpunkte und Migration, und der Server sähe,
  wie viele Passkeys es gibt und wann sie entstehen.
- **Extension schreibt direkt in die Gerätedatei, App liest sie:** gleichzeitige Schreibzugriffe
  können einen gerade erzeugten Passkey verlieren.
- **Extension mit eigener Serververbindung:** bräuchte Sitzungstoken in der App Group und
  doppelte Sync-Logik in Swift.

## Folgen

- BS=1 ist jetzt sachlich richtig, sobald der Passkey einmal übernommen wurde. Zwischen
  Erzeugen und dem nächsten Entsperren der App liegt er nur im Briefkasten auf dem Gerät.
- Der private Schlüssel ist beim Übernehmen und Veröffentlichen kurz im JavaScript der App,
  wie Passwörter auch. Kryptografische Schlüssel (Konto-, Bereichsschlüssel) bleiben in Rust.
- Mitglieder eines geteilten Bereichs können dort abgelegte Passkeys verwenden, wie Passwörter.
  Neue Passkeys landen immer im persönlichen Bereich.
- Ältere Apps kennen den Typ nicht und zeigen ihn als Login mit verborgenem Schlüsselfeld.
  Speichern dort würde den Typ verlieren. Alle Apps zusammen aktualisieren.
- Gelöschte Passkeys bleiben bis zum nächsten Veröffentlichen auf dem iPhone nutzbar; die
  Vorschläge im iOS-Schlüsselbund (`ASCredentialIdentityStore`) werden noch nicht bereinigt.
- Passkeys nutzen kann weiterhin nur die iOS-Extension. Mac, Browser-Erweiterung und Web
  verwalten sie nur.
