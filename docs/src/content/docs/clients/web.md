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
├── crypto/        Web Worker mit melon-crypto (WASM) + kleines RPC
├── vault/         Datenmodell (entry.ts) und Sync-Store (store.ts), rein und getestet
├── screens/       Anmelden, Tresor, Detail, Editor
├── components/    Generator, Passwortanzeige, Logo
├── theme.ts       MUI-Theme: Wassermelonen-Farben, Schriften, Formen, Hell/Dunkel
├── api.ts         HTTP-Client für die Server-API
├── session.ts     Anmelden, Registrieren, Sperren, Fehlermeldungen
├── clipboard.ts   Kopieren mit automatischem Leeren
└── useIdle.ts     Auto-Lock
```

## Krypto im Web Worker

Die gesamte Kryptografie läuft in einem **Web Worker**, der `melon-crypto` als WASM lädt
(`crates/melon-wasm` → `packages/melon-wasm`). Warum, steht in
[ADR 0007](/melonapp/entscheidungen/0007-schluessel-im-worker/).

- Master-Key, Wrap-Key und Vault-Key existieren **nur im Speicher des Workers** als
  WASM-Objekte. Die Oberfläche bekommt nie Schlüsselbytes zu sehen, sondern nur den
  Auth-Key (für den Server), Chiffretexte und entschlüsselte Einträge.
- Die Argon2id-Ableitung (64 MiB) blockiert die Oberfläche nicht. Sie dauert im Browser
  unter einer Sekunde.
- Nach dem Entsperren verwirft der Worker Master- und Wrap-Key sofort. Übrig bleibt nur der Vault-Key.
- `lock` gibt alle Schlüssel frei (`free()`, auf Rust-Seite per `zeroize` genullt).

Das RPC ist bewusst klein (`crypto/protocol.ts`): `derive`, `createVault`, `unlock`,
`encrypt`, `decryptMany`, `lock`, `generateSalt`, `generatePassword`.

## Datenmodell

Ein Eintrag im Modul `passwords` (siehe [Passwortmanager](/melonapp/konzept/passwortmanager/#datenformat-eines-eintrags)).
Zusätzlich führt jeder Eintrag einen **Passwort-Verlauf** (`history`, höchstens 10 Einträge,
ohne Doppelte und ohne das aktuelle Passwort). Wer ein Passwort ändert, kann so das alte
noch nachschlagen, etwa wenn die Änderung auf der Website nicht geklappt hat.

`parseEntry` liest Einträge tolerant: Unbekannte Felder werden ignoriert, fehlende bekommen
Standardwerte. Ältere und neuere Clients können so nebeneinander laufen.

## Sync-Store

`VaultStore` (`vault/store.ts`) hält alle entschlüsselten Einträge im Speicher und setzt
das [Sync-Protokoll](/melonapp/server/sync/) um:

- Beim Öffnen, alle 30 Sekunden und wenn das Fenster den Fokus bekommt, holt er Änderungen
  seit der letzten Revision. Mehrere gleichzeitige Syncs werden zu einem zusammengefasst.
- Einträge, die sich nicht entschlüsseln lassen, werden übersprungen und gezählt, statt den
  ganzen Sync abzubrechen. Die Oberfläche zeigt einen Hinweis.
- Die Item-ID erzeugt der Client (UUID v4 aus `crypto.getRandomValues`), damit sie vor dem
  Hochladen in die AAD eingehen kann.

### Konflikte

Antwortet der Server beim Speichern mit `409`, synchronisiert der Store und speichert erneut:

1. **Die eigene Änderung gewinnt.** Wer gerade auf „Speichern“ gedrückt hat, erwartet genau diesen Stand.
2. Das Passwort der anderen Seite landet im **Verlauf**, die Verläufe beider Seiten werden
   zusammengeführt. So geht kein Passwort verloren.
3. Wurde der Eintrag auf einem anderen Gerät gelöscht, wird er mit der Revision des
   Tombstones wiederbelebt.

Diese Regeln sind in `store.test.ts` gegen einen nachgebauten Server getestet.

## Schutzmaßnahmen

| Maßnahme | Warum |
|---|---|
| Strenge CSP (`script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self'`, `img-src 'self' data:`, `frame-ancestors 'none'`), gesetzt von Caddy | Selbst eingeschleuster Code könnte keine Daten an fremde Server schicken. `style-src` erlaubt `'unsafe-inline'` für MUI ([warum](/melonapp/entscheidungen/0008-mui/#folge-für-die-content-security-policy)). |
| Links in Einträgen nur mit `http:`/`https:` | verhindert `javascript:`-Links in gespeicherten URLs |
| Auto-Lock nach 5 Minuten ohne Eingabe | Schlüssel liegen nicht unbegrenzt im Speicher |
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
