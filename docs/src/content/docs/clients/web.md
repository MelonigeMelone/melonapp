---
title: Web-App
description: Aufbau der Web-App – Krypto im Web Worker, Sync, Konflikte, Schutzmaßnahmen und Design.
sidebar:
  order: 1
---

`apps/web` ist eine React-App (TypeScript, Vite) mit **MUI** als Komponentenbibliothek
([ADR 0008](/melonapp/entscheidungen/0008-mui/)). Sie läuft im Browser und wird später
in Tauri auch die Oberfläche für Desktop und iOS. Ausgeliefert wird sie von Caddy auf
derselben Domain wie die API, ohne CORS.

```text
apps/web/src
├── Shell.tsx      App-Rahmen: Navigation, Konto, Sperren, Sync, Bereiche-Dialoge
├── layout.ts      gemeinsame Maße und Zähl-Texte
├── modules/
│   ├── registry.ts    alle Module mit Name, Symbol, Pfad und Eintragstypen
│   └── passwords/     Passwortmanager: Liste, Eintrag, Editor
├── crypto/        Web Worker mit melon-crypto (WASM) + kleines RPC
├── vault/         Datenmodell (item.ts), Sync je Tresor (store.ts), alle Tresore (manager.ts)
├── screens/       Anmelden, Startbildschirm, Konto, Bereich-Dialog (Mitglieder, Einladungen)
├── components/    Generator, Passwortanzeige, Logo
├── theme.ts       MUI-Theme: Wassermelonen-Farben, Schriften, Formen, Hell/Dunkel
├── api.ts         HTTP-Client für die Server-API
├── session.ts     Anmelden, Registrieren, Sperren, Fehlermeldungen
├── clipboard.ts   Kopieren mit automatischem Leeren
├── prefs.ts       Geräte-Einstellungen (Auto-Lock-Zeit) im localStorage
└── useIdle.ts     Auto-Lock
```

## App-Rahmen und Module

Nach dem Anmelden zeigt `Shell` den **Startbildschirm** (`#/`) mit Modulen und Bereichen. Module
haben eigene Pfade, der Passwortmanager liegt unter `#/passwoerter`. Desktop: Tabs oben. Mobil:
Leiste unten.

Der Rahmen besitzt alles Modulübergreifende: Sync (ein `VaultsManager` für alle Module), Konto,
Notfall-Kit, Sperren und das Anlegen und Verwalten von Bereichen. Ein Modul bekommt den Zustand
als `ShellContext` und filtert die Einträge auf seine Typen. Begründung:
[ADR 0012](/melonapp/entscheidungen/0012-app-shell-und-bereiche/).

Im Code heißt ein Bereich weiterhin `vault` (`VaultsManager`, `VaultView`).

## Krypto im Web Worker

Die gesamte Kryptografie läuft in einem **Web Worker**, der `melon-crypto` als WASM lädt
(`crates/melon-wasm` → `packages/melon-wasm`). Warum, steht in
[ADR 0007](/melonapp/entscheidungen/0007-schluessel-im-worker/).

- Privater Schlüssel und alle Tresor-Schlüssel existieren **nur im Speicher des Workers**. Die
  Oberfläche sieht nie Schlüsselbytes, nur Auth-Key, öffentliche Schlüssel, Chiffretexte und
  entschlüsselte Einträge.
- Master-Key, Wrap-Key und Konto-Schlüssel werden direkt nach dem Entsperren freigegeben. Übrig
  bleiben der private Schlüssel und die geöffneten Tresor-Schlüssel (je Tresor die aktuelle Version).
- Beim Schlüsselwechsel erzeugt der Worker den neuen Tresor-Schlüssel, verschlüsselt alles neu
  und gibt den neuen Schlüssel sofort wieder frei. Nach dem nächsten Sync öffnet er ihn regulär
  über die eigene HPKE-Kopie.
- `lock` gibt alles frei (`free()`, auf Rust-Seite per `zeroize` genullt).

RPC (`crypto/protocol.ts`): `derive`, `createAccount`, `unlock`, `openVault`, `newVault`,
`hasVault`, `encryptMeta`, `decryptMeta`, `encryptItem`, `decryptItems`, `sealFor`, `rotate`,
`setupRecovery`, `changePassword`, `recoveryAuth`, `recoveryReset`, `fingerprint`, `lock`,
`generateSalt`, `generatePassword`. Für Passwortwechsel und Notfall-Kit entschlüsselt der Worker
den Konto-Schlüssel nur kurz und gibt ihn sofort wieder frei.

## Datenmodell

`vault/item.ts`. Ein Eintrag hat einen **Typ** und Felder
([Konzept](/melonapp/konzept/tresore/#eintragstypen-und-eigene-felder)):

```ts
{ type: 'login' | 'note' | 'card' | 'identity' | 'wifi',
  title, notes,
  fields:   [{ id, label, kind, value }],
  sections: [{ id, title, fields: [...] }],
  history:  [{ fieldId, label, value, changedAt }] }
```

- `fields` kommen aus der Vorlage des Typs (feste IDs wie `username`, `password`), `sections`
  enthalten eigene Felder.
- Feldarten: `text`, `concealed`, `totp`, `url`, `email`, `phone`, `date`, `multiline`. Unbekannte
  Arten werden als `text` gelesen. So zeigen ältere Apps neuere Einträge trotzdem an.
- `totp` enthält einen `otpauth://`-Link oder einen Base32-Schlüssel. Ältere verborgene Felder, die
  wie ein 2FA-Schlüssel aussehen (`otpauth://` oder Name wie „TOTP“/„2FA“ und Base32-Wert), zeigt die
  App ebenfalls als Code an (`isTotpField`).
- **Verlauf:** Ändert sich ein verborgenes Feld (`concealed`), egal ob Vorlage oder eigenes Feld,
  wandert der alte Wert in `history` (höchstens 20, ohne Doppelte und ohne aktuelle Werte).
- **Suche** durchsucht Titel und sichtbare Felder (Text, URL, E-Mail, Telefon), nie verborgene.
- Links entstehen nur für `http(s):`, `mailto:` und `tel:` (`safeHref`).

## Sync

- `VaultsManager` (`vault/manager.ts`) hält alle Tresore. `VaultStore` (`vault/store.ts`) hält die
  Einträge eines Tresors und setzt das [Sync-Protokoll](/melonapp/server/sync/) um.
- Sync beim Öffnen, alle 30 Sekunden und wenn das Fenster den Fokus bekommt.
- Einträge, die sich nicht entschlüsseln lassen, werden übersprungen und gezählt. Der Rest des
  Syncs läuft weiter.

### Besitzer-Aufgaben laufen automatisch

Bei jedem Sync erledigt die App eines Besitzers, was nur ein Besitzer kann:

1. **Wartende Mitglieder freischalten:** Tresor-Schlüssel für deren öffentlichen Schlüssel
   verschlüsseln und hinterlegen (`PUT …/members/{user}/key`).
2. **Schlüssel wechseln**, wenn jemand den Tresor verlassen hat (`rotation_needed`).

### Konflikte

Antwortet der Server beim Speichern mit `409 revision_mismatch`, synchronisiert der Store und
speichert erneut:

1. **Die eigene Änderung gewinnt.** Wer gerade gespeichert hat, erwartet genau diesen Stand.
2. Verborgene Werte der anderen Seite landen im **Verlauf**. So geht kein Passwort verloren.
3. Wurde der Eintrag anderswo gelöscht, wird er mit der Revision des Tombstones wiederbelebt.

Bei `409 key_rotated` gibt es keinen automatischen zweiten Versuch (siehe [Sync](/melonapp/server/sync/)).

## Import

Im Passwortmanager unter „Importieren“ (`modules/passwords/import/`). Unterstützt:

| Quelle | Format | Erkennung |
|---|---|---|
| Apple Passwörter / Safari | CSV | Spalten `Title, URL, Username, Password` |
| 1Password | **1PUX** (empfohlen) | ZIP mit `export.data` |
| 1Password | CSV | zusätzlich Spalte `Archived` |
| Chrome, Edge, Brave | CSV | `name, url, username, password` |
| Firefox | CSV | zusätzlich `httpRealm` |
| Bitwarden | CSV | `login_uri, login_username, login_password` |

- Die Datei wird **nur im Browser** gelesen (`File.text()` bzw. `arrayBuffer()`, ZIP mit `fflate`).
  Jeder Eintrag wird wie beim normalen Speichern im Worker verschlüsselt und einzeln hochgeladen.
- Der CSV-Parser beherrscht Anführungszeichen, verdoppelte Anführungszeichen, Kommas und
  Zeilenumbrüche in Feldern, BOM und Windows-Zeilenenden.
- **1PUX** wird vollständig übernommen: Logins (mehrere URLs), Kreditkarten, Identitäten, WLAN und
  sichere Notizen. Bekannte Felder landen in den Vorlagenfeldern, alles andere in eigenen Abschnitten
  mit passender Feldart. Dazu kommt der Passwort-Verlauf. Andere Kategorien (Bankkonto, Ausweis …)
  werden zu sicheren Notizen mit Abschnitten.
- **2FA-Schlüssel** (TOTP) kommen als Feld „Einmalcode“ (Art `totp`) in den Abschnitt
  „Einmalcode“ und zeigen sofort den aktuellen Code.
- Archivierte Einträge (1Password) und interne Firefox-Logins werden übersprungen.
- **Doppelte** (gleicher Typ, Titel, Benutzername und Website ohne `www.`) im Ziel-Bereich werden
  standardmäßig übersprungen.
- Danach erinnert die App daran, die Export-Datei zu löschen, weil sie unverschlüsselt ist.

## 2FA-Codes

Ein Login kann einen 2FA-Schlüssel haben (Begründung:
[ADR 0014](/melonapp/entscheidungen/0014-2fa-und-sicherheits-check/)).

- **Einrichten:** Im Editor „Einmalcode (2FA) hinzufügen“, dann den `otpauth://`-Link oder den
  geheimen Schlüssel einfügen oder „QR-Code aus Bild lesen“ mit einem Screenshot des QR-Codes. Das
  Bild wird nur im Browser ausgewertet (`jsqr`, wird erst bei Bedarf geladen). Darunter steht zur
  Kontrolle schon der aktuelle Code.
- **Anzeige:** großer Code mit Countdown-Ring und „Code kopieren“. Die letzten 5 Sekunden sind farbig
  markiert.
- **Berechnung:** `vault/totp.ts` nach RFC 6238 mit WebCrypto-HMAC. Unterstützt SHA-1, SHA-256 und
  SHA-512, 6 bis 8 Stellen und Perioden von 10 bis 300 Sekunden. Schlüssel ab 8 Base32-Zeichen.

## Sicherheits-Check

In der Seitenleiste des Passwortmanagers, mit der Zahl der Hinweise
(`modules/passwords/SecurityCheck.tsx`, `vault/audit.ts`, `vault/strength.ts`).

- **Mehrfach verwendet:** gleiche Passwörter über alle Bereiche, gruppiert.
- **Schwach:** Schätzung aus Länge, Zeichenarten, Wiederholungen und Tastaturfolgen, dazu eine Liste
  häufiger Passwörter (auch deutsche) samt Varianten wie `Passwort123!`. Unter 10 Zeichen gilt immer
  als schwach. Dieselbe Schätzung zeigt der Editor als Balken unter dem Passwort.
- **Datenlecks:** nur auf Knopfdruck „Jetzt abgleichen“. Die App sendet die ersten 5 Zeichen des
  SHA-1-Hashes an `api.pwnedpasswords.com` (mit `Add-Padding`, ohne Cookies und Referrer) und
  vergleicht den Rest lokal. Jedes Passwort wird nur einmal geprüft, höchstens 4 Anfragen gleichzeitig.
- Ein Klick auf einen Eintrag öffnet ihn.

## Konto

Der Kreis mit dem Anfangsbuchstaben oben rechts öffnet die Seite **Konto** (`#/konto`,
`screens/AccountScreen.tsx`). Fehlt das Notfall-Kit, trägt der Kreis einen roten Punkt.

Die Seite zeigt E-Mail und Server und darunter zwei Listen. Jede Zeile hat einen Status in
Klartext und genau eine Aktion:

| Zeile | Status | Aktion |
|---|---|---|
| Notfall-Kit | eingerichtet oder fehlt (dann zusätzlich ein Hinweis oben) | erstellen bzw. neu erstellen |
| Master-Passwort | | „Ändern“ öffnet einen eigenen Dialog |
| Gespeicherte Passwörter | Hinweise aus dem [Sicherheits-Check](#sicherheits-check) | öffnet den Check (`#/passwoerter/sicherheit`) |
| Sicherheitscode | | klappt den Code zum Vergleichen beim Teilen auf |
| Automatisch sperren | 1, 5, 15 oder 30 Minuten, Standard 5, gilt pro Gerät | Auswahl |
| Darstellung | System, hell oder dunkel, gilt pro Gerät | Umschalter |

- **Notfall-Kit** (`RecoveryKitDialog`): Nach Bestätigung des Master-Passworts erzeugt der Worker
  den Recovery-Key und zeigt ihn einmal an, mit „Als Datei speichern“ und „Kopieren“. „Fertig“ geht
  erst, wenn man bestätigt, ihn aufbewahrt zu haben.
- **Master-Passwort ändern:** sagt vorher, was passiert (andere Geräte werden abgemeldet,
  Notfall-Kit und Bereiche bleiben). Anzeigen-Knopf an jedem Feld, Stärke-Balken, Prüfung auf
  Übereinstimmung beim Tippen. Der Knopf ist erst aktiv, wenn alles passt (mindestens 12 Zeichen,
  anders als das alte). Danach eine kurze Bestätigung unten.

Solange kein Notfall-Kit existiert, zeigt auch der Startbildschirm einen Hinweis mit „Erstellen“.

Die Anmeldeseite hat „Master-Passwort vergessen?“: E-Mail, Recovery-Key, neues Passwort. Der
Recovery-Key wird im Worker geprüft (Prüfsumme). Tippfehler fallen also auf, bevor eine Anfrage
rausgeht.

Für das erneute Bestätigen des Passworts hält die Sitzung Salt, KDF-Parameter und den
verschlüsselten Konto-Schlüssel, nie das Passwort selbst.

## Schutzmaßnahmen

| Maßnahme | Warum |
|---|---|
| Strenge CSP (`script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self' https://api.pwnedpasswords.com`, `img-src 'self' data:`, `frame-ancestors 'none'`), gesetzt von Caddy | Selbst eingeschleuster Code könnte keine Daten an fremde Server schicken. Die einzige fremde Adresse ist der Datenleck-Abgleich ([ADR 0014](/melonapp/entscheidungen/0014-2fa-und-sicherheits-check/)). `style-src` erlaubt `'unsafe-inline'` für MUI ([warum](/melonapp/entscheidungen/0008-mui/#folge-für-die-content-security-policy)). |
| Links in Einträgen nur mit `http(s):`, `mailto:`, `tel:` | verhindert `javascript:`-Links in gespeicherten Feldern |
| Einladungs-Token im URL-Fragment (`/#/invite/…`) | landet nie in Server- oder Proxy-Logs |
| Auto-Lock nach 5 Minuten ohne Eingabe (einstellbar 1 bis 30 Minuten, nicht abschaltbar) | Schlüssel liegen nicht unbegrenzt im Speicher |
| Zwischenablage wird 30 s nach dem Kopieren geleert, wenn sie noch das Passwort enthält | Passwörter bleiben nicht im Clipboard-Verlauf |
| Kein Token, kein Schlüssel im `localStorage` | nach Neuladen ist der Tresor gesperrt. Gemerkt wird nur die E-Mail. |
| Schriften lokal gebündelt | keine Anfragen an Google Fonts oder andere Dritte |
| Passwortfelder mit `autocomplete="new-password"` | der Browser-Passwortmanager soll Tresor-Inhalte nicht übernehmen |

:::caution[HTTPS ist Pflicht]
Clipboard-API und Teile von WebCrypto gibt es nur in einem sicheren Kontext (HTTPS oder
`localhost`). Im Betrieb sorgt Caddy dafür.
:::

## Design

Alle Gestaltungsentscheidungen stecken im MUI-Theme (`theme.ts`). Komponenten bekommen
ihre Farben über Theme-Pfade wie `melon.digit` oder `primary.main`, nie über feste Hex-Werte.

| Entscheidung | Grund |
|---|---|
| Farben einer Wassermelone: Honigmelonen-Weiß `#F2F7F1`, Schalengrün `#2E6A43`, Fruchtrot `#E2365F` als einziger Akzent | kommt direkt aus dem Namen, statt einer beliebigen Standardpalette |
| *Atkinson Hyperlegible* für Text, *Atkinson Hyperlegible Mono* für Passwörter | Diese Schriften wurden für Lesbarkeit entworfen und unterscheiden `I l 1 O 0 o` klar. Passwörter abtippen ist der Kernfall. |
| *Bricolage Grotesque* für Überschriften | Charakter, ohne die Lesbarkeit zu stören |
| Passwortanzeige: groß, Ziffern blau, Sonderzeichen rot, Großbuchstaben fett | die eine auffällige Stelle. Man sieht sofort, welches Zeichen gemeint ist. |
| Dunkelmodus automatisch nach Systemeinstellung | `colorSchemes` + CSS-Variablen, ohne Aufflackern |
| Buttons als Pillen, Eingabefelder mit 10 px Radius, Dialoge mit 18 px | klare Hierarchie: Aktionen rund, Felder ruhig |
| Symbol-Buttons (Kopieren, Anzeigen, Sperren) mit Tooltip und `aria-label` | wenig Platz, trotzdem verständlich und per Screenreader bedienbar |
| Mobil: Liste und Detail als getrennte Ansichten | kleine Bildschirme |

## Gemeinsame native Oberfläche

Desktop und iOS verwenden diese Komponenten ebenfalls. Die optionale Plattform-
Schnittstelle ergänzt Serverwahl und biometrisches Entsperren ausschließlich im nativen
Einstieg. Web-Builds behalten den Worker und den bisherigen HTTP-Transport.
Fehlerobjekte werden nicht mehr pauschal in die Konsole geschrieben.
