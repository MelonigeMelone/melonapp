---
title: Passwortmanager
description: Das erste Modul – Use Cases und Integration in iOS, macOS und Browser.
sidebar:
  order: 2
---

## Use Cases

1. **iPhone, App-Login:** Beim Tippen ins Passwortfeld schlägt iOS MelonApp vor.
   Face ID, und das Feld ist ausgefüllt. Umgesetzt über eine Credential Provider
   Extension, Passkeys ab iOS 17.
2. **Browser am Mac/PC:** Die Erweiterung erkennt die Seite und füllt per Klick oder
   Tastenkürzel aus. Bei einer neuen Registrierung fragt sie „Speichern?“ und schlägt
   ein generiertes Passwort vor.
3. **Desktop-App:** Schnellsuche per globalem Hotkey. Beim Kopieren wird die
   Zwischenablage nach 30 s automatisch geleert.
4. **Umzug:** Import aus Apple Passwörter, 1Password (1PUX und CSV), Chrome/Edge/Brave, Firefox und
   Bitwarden ✅ ([Details](/melonapp/clients/web/#import)).
5. **Sicherheits-Check:** Doppelte und schwache Passwörter finden, optional mit
   Have-I-Been-Pwned-Abgleich über k-Anonymität. Dabei verlassen nur 5 Zeichen des
   SHA-1-Hashes das Gerät.
6. **Auto-Lock:** Sperre nach Inaktivität, Entsperren per Face ID, Touch ID oder Windows Hello.

## Apple Passwörter

Eine direkte Synchronisation mit dem iCloud-Schlüsselbund erlaubt Apple nicht. MelonApp
wird aber als **gleichwertiger AutoFill-Anbieter** in iOS und macOS eingetragen
(Einstellungen → Allgemein → AutoFill & Passwörter). Beide können parallel laufen.
Der Umzug geht per CSV-Import.

Für die AutoFill-Extension, TestFlight und das Signieren ist ein Apple-Developer-Account
(99 €/Jahr) nötig.

## Datenformat eines Eintrags

Ein Login-Eintrag. Das folgende JSON liegt **verschlüsselt** im Feld `data` (siehe
[Web-App → Datenmodell](/melonapp/clients/web/#datenmodell)):

```json
{
  "type": "login",
  "title": "GitHub",
  "fields": [
    { "id": "username", "label": "Benutzername", "kind": "text", "value": "melone" },
    { "id": "password", "label": "Passwort", "kind": "concealed", "value": "…" },
    { "id": "website", "label": "Website", "kind": "url", "value": "https://github.com" }
  ],
  "sections": [
    { "id": "…", "title": "", "fields": [{ "id": "…", "label": "Recovery-Code", "kind": "concealed", "value": "…" }] }
  ],
  "notes": "",
  "history": [],
  "seq": 3
}
```

Das Schema gehört dem Client. Neue Felder brauchen keine Server-Änderung.
