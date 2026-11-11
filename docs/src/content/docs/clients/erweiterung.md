---
title: Browser-Erweiterung
description: Logins auf Websites ausfüllen und neue speichern – Installation, Aufbau und Schutzmaßnahmen.
sidebar:
  order: 2
---

`apps/extension`: eine Manifest-V3-Erweiterung für **Chrome, Edge, Brave, Opera / Opera GX** (alle
Chromium) und **Firefox**. Safari folgt mit der iPhone-App, weil es Xcode und einen Mac braucht.

## Installieren

Die fertigen Builds hängen an jedem CI-Lauf als Artefakt **`melonapp-extension`** (GitHub → Actions →
neuester Lauf von „CI“ → Artifacts). Darin liegen die Ordner `chromium/` und `firefox/`. Lokal baut sie
`npm run build -w extension` nach `apps/extension/build/`.

| Browser | Schritte |
|---|---|
| Chrome, Edge, Brave | `chrome://extensions` (bzw. `edge://`, `brave://`) → Entwicklermodus an → „Entpackte Erweiterung laden“ → Ordner `chromium` |
| **Opera GX**, Opera | `opera://extensions` → Entwicklermodus (oben rechts) an → „Entpackte Erweiterung laden“ → Ordner `chromium` |
| Firefox | `about:debugging#/runtime/this-firefox` → „Temporäres Add-on laden“ → `firefox/manifest.json`. Danach unter `about:addons` → MelonApp → Berechtigungen „Auf Daten aller Websites zugreifen“ erlauben. |

Temporäre Add-ons verschwinden in Firefox beim Neustart. Dauerhaft geht es erst über eine
signierte Version (Mozilla Add-ons), ebenso der Chrome Web Store. Beides ist für später geplant.

Beim ersten Öffnen trägst du die Server-Adresse ein (z. B. `app.melonigemelone.de`), dazu E-Mail und
Master-Passwort.

## Bedienung

- **Ausfüllen:** In ein Login-Feld klicken → kleines Melonen-Symbol rechts im Feld → Login wählen. Das
  Menü öffnet sich bündig unter dem Feld. Alternativ Symbol in der Browserleiste → „Ausfüllen“.
- **Wann das Symbol erscheint:** nur, wenn es für die Seite einen Login gibt, bei Registrierungsfeldern
  (für den Generator) oder ausgegraut, wenn MelonApp gesperrt ist. Es passt sich der Feldhöhe an und
  weicht eigenen Symbolen der Seite aus, etwa dem Auge zum Passwort-Anzeigen.
- **Anmeldung in zwei Schritten** (erst E-Mail-Seite, dann Passwort-Seite, wie bei Google oder
  Microsoft): Das Symbol erscheint schon im E-Mail-Feld und füllt nur die E-Mail. Auf der
  Passwort-Seite steht der gewählte Login oben („eben gewählt“). Beim Speichern übernimmt die Karte
  die E-Mail aus dem ersten Schritt. Gemerkt wird das pro Tab und Website für 5 Minuten, nur im
  Arbeitsspeicher. Such-, Newsletter- und Code-Felder werden nicht als E-Mail-Schritt erkannt.
- **Neue Logins:** Nach dem Anmelden oder Registrieren erscheint oben rechts auf der Seite eine Karte
  „Neuen Login speichern?“ bzw. „Passwort aktualisieren?“ mit **Speichern**, **Nicht jetzt** und
  **Nie für diese Seite**. Das klappt auch auf Seiten, die nicht neu laden (z. B. Web-Apps). Zusätzlich
  zeigt das Symbol in der Leiste eine rote **1**, im Popup lässt sich der Login ebenfalls speichern.
- **Gesperrt?** Dann sagt die Karte nur, dass man über das Symbol in der Leiste entsperren soll. Nach
  dem Master-Passwort fragt sie nie.
- **Generator:** In Registrierungs-Formularen bietet das Melonen-Symbol „Sicheres Passwort vorschlagen“
  an und füllt beide Passwortfelder.
- **Sperren:** Schloss-Symbol im Popup, automatisch nach 30 Minuten ohne Nutzung und beim Schließen
  des Browsers.

## Aufbau

```text
apps/extension/src
├── popup/          React + MUI, nutzt Krypto-Worker, Sync und Modelle der Web-App (@web/…)
├── background.ts   Vermittlung, Treffer-Suche, Badge, Auto-Lock (kein WASM)
├── content.ts      Formular-Erkennung, Symbol und Menü im Shadow DOM, Ausfüllen, Absenden erkennen,
│                   Speicher-Karte einblenden
├── save/           Speicher-Karte (eigene Erweiterungsseite, als iframe in der Website)
├── content/form.ts Erkennung von Benutzername/Passwort, sichtbare Felder, Ausfüllen
└── shared/         Nachrichten, URL-Abgleich, Passwort-Generator
```

Der Build erzeugt drei Teile: Popup (Vite), `background.js` und `content.js` (je ein IIFE-Bündel),
dazu `scripts/package.mjs` mit den Manifesten für Chromium und Firefox und PNG-Symbolen aus dem
Melonen-SVG.

### Entsperrter Zustand

Erweiterungs-Seiten und der Hintergrund-Prozess werden vom Browser nach kurzer Zeit beendet. Deshalb
legt das Popup nach dem Entsperren einen **Schnappschuss** in `chrome.storage.session` ab:
Sitzungs-Token, entschlüsselte Logins (Titel, Benutzername, Passwort, URLs), Bereiche und die
Bereichs-Schlüssel als Rohbytes. `storage.session` liegt nur im Arbeitsspeicher, verschwindet beim
Schließen des Browsers und ist für Content-Scripts und Websites nicht lesbar. Begründung und
Abwägung: [ADR 0013](/melonapp/entscheidungen/0013-browser-erweiterung/).

Beim nächsten Öffnen importiert das Popup die Bereichs-Schlüssel in den Worker und synchronisiert
mit demselben `VaultsManager` wie die Web-App. Speichern und Aktualisieren laufen also über den
normalen, getesteten Weg mit Verschlüsselung, Konflikterkennung und Verlauf.

## Schutzmaßnahmen

| Maßnahme | Wogegen |
|---|---|
| Ausfüllen **nur nach Klick**, nie automatisch beim Laden | unsichtbare Formulare, die beim Seitenaufruf Passwörter abgreifen |
| Nur echte Absende-Knöpfe lösen die Speicher-Karte aus, nicht z. B. „Passwort zeigen“ | Speicher-Karten mit halb eingegebenen Passwörtern |
| Nur sichtbare, aktivierte Felder werden erkannt und befüllt | versteckte Felder |
| Nur im Hauptframe, nicht in iframes | fremde, eingebettete Seiten |
| Der Hintergrund prüft die Adresse über `sender.tab.url` (vom Browser), nicht über Angaben der Seite | eine Seite, die sich als andere ausgibt |
| Treffer nur bei gleicher Domain oder Subdomain, nicht `github.com.evil.example` oder Eltern-Domains | Phishing-Domains |
| Kein Ausfüllen von `https`-Logins in `http`-Seiten (außer `localhost`) | abgehörte, unverschlüsselte Verbindungen |
| Auch das Popup bindet „Ausfüllen“ an die URLs des Logins, das Content-Script prüft sie | Tab hat zwischenzeitlich die Seite gewechselt |
| Symbol und Menü im Shadow DOM | Seiten-CSS und -Skripte, die das Menü umgestalten wollen |
| Nachrichten nur von der eigenen Erweiterung (`sender.id`) | andere Erweiterungen |
| CSP der Erweiterungsseiten: `script-src 'self' 'wasm-unsafe-eval'` | eingeschleuster Code im Popup |
| Speicher-Karte ist eine Erweiterungsseite im iframe, keine HTML-Einfügung in die Seite | Website liest oder verändert die Karte |
| Speicher-Karte fragt **nie** nach dem Master-Passwort | Websites, die eine täuschend echte Karte nachbauen, um das Master-Passwort abzugreifen |
| `use_dynamic_url` für die Karte (Chromium) | Websites erkennen nicht dauerhaft, dass MelonApp installiert ist |
| Karte nur auf derselben Domain wie der abgesendete Login und höchstens 5 Minuten lang | Karte taucht auf fremden Seiten auf |

## Tests

- `match.test.ts`: Domain-Abgleich inklusive Look-alike-Domains und http/https, Generator.
- `form.test.ts`: Formular-Erkennung inklusive E-Mail-Schritt bei zweistufigen Logins (ohne Such-,
  Newsletter- und Code-Felder), versteckte/deaktivierte Felder, Ausfüllen mit Events.
- **E2E** (`apps/extension/e2e/extension.e2e.mjs`, CI-Job `e2e`): echtes Chromium mit geladener
  Erweiterung gegen den kompletten Stack. Kein Ausfüllen ohne Klick, Ausfüllen auf passender
  Domain, nichts auf fremder Domain, zweistufiger Login und zweistufige Registrierung, Generator, Speichern über die Karte auf der Seite (danach in der
  Web-App sichtbar), Passwort-Aktualisierung, „Nie für diese Seite“ unterdrückt weitere Karten, Sperren
  beendet das Ausfüllen.
