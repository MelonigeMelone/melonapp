---
title: Browser-Erweiterung
description: Logins auf Websites ausfüllen und neue speichern – Installation, Aufbau und Schutzmaßnahmen.
sidebar:
  order: 2
---

`apps/extension`: eine Manifest-V3-Erweiterung für **Chrome, Edge, Brave, Opera / Opera GX** (alle
Chromium), **Firefox** und **Safari auf dem Mac**. Auf dem iPhone übernimmt der AutoFill-Anbieter
das Ausfüllen in Safari ([ADR 0026](/melonapp/entscheidungen/0026-safari-erweiterung-nur-mac/)).

## Installieren

Die fertigen Builds hängen an jedem CI-Lauf als Artefakt **`melonapp-extension`** (GitHub → Actions →
neuester Lauf von „CI“ → Artifacts). Darin liegen die Ordner `chromium/`, `safari/` und `firefox/`. Lokal baut sie
`npm run build -w extension` nach `apps/extension/build/`.

| Browser | Schritte |
|---|---|
| Chrome, Edge, Brave | `chrome://extensions` (bzw. `edge://`, `brave://`) → Entwicklermodus an → „Entpackte Erweiterung laden“ → Ordner `chromium` |
| **Opera GX**, Opera | `opera://extensions` → Entwicklermodus (oben rechts) an → „Entpackte Erweiterung laden“ → Ordner `chromium` |
| Firefox | `about:debugging#/runtime/this-firefox` → „Temporäres Add-on laden“ → `firefox/manifest.json`. Danach unter `about:addons` → MelonApp → Berechtigungen „Auf Daten aller Websites zugreifen“ erlauben. |
| Safari (Mac) | In der Mac-App enthalten: MelonApp aus dem DMG installieren und einmal öffnen → Safari → Einstellungen → Erweiterungen → **MelonApp** anhaken → Websitezugriff „Auf allen Websites immer erlauben“ |

Zum Ausprobieren ohne App: Safari → Einstellungen → Erweitert → „Funktionen für Webentwickler
anzeigen“, dann unter Entwickler „Nicht signierte Erweiterungen erlauben“ und im Menü Entwickler →
„Temporäre Erweiterung hinzufügen …“ → Ordner `safari`.

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
  die E-Mail aus dem ersten Schritt. Gemerkt wird das pro Tab und genauer Adresse (Host) für 5 Minuten,
  nur im Arbeitsspeicher. Beide Schritte müssen also auf demselben Host liegen. Such-, Newsletter- und Code-Felder werden nicht als E-Mail-Schritt erkannt.
- **Neue Logins:** Nach dem Anmelden oder Registrieren erscheint oben rechts auf der Seite eine Karte
  „Neuen Login speichern?“ bzw. „Passwort aktualisieren?“ mit **Speichern**, **Nicht jetzt** und
  **Nie für diese Seite**. Das klappt auch auf Seiten, die nicht neu laden (z. B. Web-Apps). Zusätzlich
  zeigt das Symbol in der Leiste eine rote **1**, im Popup lässt sich der Login ebenfalls speichern.
  Offene Vorschläge merkt sich die Erweiterung pro Website, höchstens 10 Minuten lang und nur bis zum
  Sperren. Ein Vorschlag einer anderen Seite verdrängt sie nicht.
- **Ausgeschlossene Seiten:** „Nie für diese Seite“ merkt sich die Website (Host ohne `www.`) in
  `storage.local`, auch über Neustarts hinweg. Ausfüllen funktioniert dort weiter, nur die Karte
  kommt nicht mehr. Rückgängig machen: im Popup auf so einer Seite **Wieder fragen**, oder unter
  **Einstellungen** (Popup unten, bzw. Rechtsklick auf das Symbol → Optionen) die Liste aller
  ausgeschlossenen Seiten, jede mit **Wieder fragen**. Die Einstellungsseite geht auch gesperrt.
- **Gesperrt?** Dann sagt die Karte nur, dass man über das Symbol in der Leiste entsperren soll. Nach
  dem Master-Passwort fragt sie nie.
- **2FA-Codes:** In Feldern für Einmalcodes (`autocomplete="one-time-code"` oder Namen wie „otp“,
  „2fa“, „Bestätigungscode“) erscheint das Symbol, wenn ein Login der Seite einen 2FA-Schlüssel hat.
  Ein Klick füllt den aktuellen Code, auch in Seiten mit einem Kästchen pro Ziffer. Im Popup kopiert
  das Ziffern-Symbol neben einem Login den Code. Den Code rechnet der Hintergrund erst beim Klick aus,
  nur für die Adresse, die der Browser für den Tab meldet.
- **Generator:** In Registrierungs-Formularen bietet das Melonen-Symbol „Sicheres Passwort vorschlagen“
  an und füllt beide Passwortfelder.
- **Sperren:** Schloss-Symbol im Popup, automatisch nach 30 Minuten ohne Nutzung und beim Schließen
  des Browsers. Als Nutzung zählen nur eigene Aktionen: Popup öffnen, Login ausfüllen, Code holen,
  Login wählen. Dass eine Seite ein Passwortfeld fokussiert oder die Speicher-Karte lädt, verlängert
  die Zeit nicht.
- **Server-Adresse:** nur `https`. `http` geht nur für `localhost` und `127.0.0.1`.

## Aufbau

```text
apps/extension/src
├── popup/          React + MUI, nutzt Krypto-Worker, Sync und Modelle der Web-App (@web/…)
├── background.ts   Vermittlung, Treffer-Suche, Badge, Auto-Lock (kein WASM)
├── content.ts      Formular-Erkennung, Symbol und Menü im Shadow DOM, Ausfüllen, Absenden erkennen,
│                   Speicher-Karte einblenden
├── save/           Speicher-Karte (eigene Erweiterungsseite, als iframe in der Website)
├── options/        Einstellungsseite (ausgeschlossene Seiten)
├── content/form.ts Erkennung von Benutzername/Passwort, sichtbare Felder, Ausfüllen
└── shared/         Nachrichten, URL-Abgleich, Passwort-Generator, Liste ausgeschlossener Seiten
```

Der Build erzeugt drei Teile: Popup, Speicher-Karte und Einstellungsseite (Vite), `background.js` und `content.js` (je ein IIFE-Bündel),
dazu `scripts/package.mjs` mit den Manifesten für Chromium, Safari und Firefox und PNG-Symbolen aus
dem Melonen-SVG.

### Safari

`scripts/build-safari-extension.sh` erzeugt aus `apps/desktop/apple/Safari/project.yml` (XcodeGen)
die App-Extension `MelonSafari.appex`: ein leerer `SafariWebExtensionHandler` in Swift, die Dateien
aus `build/safari` als Ressourcen, nur die Sandbox-Berechtigung, Hardened Runtime. Mit
`APPLE_SIGNING_IDENTITY=-` entsteht ein unsignierter Build (CI), sonst signiert das Skript mit
Team und Identität. `scripts/build-macos-signed.sh` bettet die Extension über `MELON_SAFARI_APPEX`
unter `Contents/PlugIns/` ein; Tauri signiert danach nur die äußere App, die Signatur der
Extension bleibt erhalten. Safari findet die Extension, sobald die App einmal gestartet wurde.

### Entsperrter Zustand

Erweiterungs-Seiten und der Hintergrund-Prozess werden vom Browser nach kurzer Zeit beendet. Deshalb
legt das Popup nach dem Entsperren einen **Schnappschuss** in `chrome.storage.session` ab:
Sitzungs-Token, entschlüsselte Logins (Titel, Benutzername, Passwort, 2FA-Schlüssel, URLs), Bereiche und die
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
| Symbol und Menü liegen in einem **geschlossenen** Shadow DOM (`mode: 'closed'`). Die Seite kommt nicht an die Knöpfe heran, kann sie weder per `click()` oder `focus()` bedienen noch per CSS umgestalten. | Seiten-Skripte, die das Menü bedienen oder verstecken und das Passwort danach aus dem Feld lesen |
| Symbol und Menü reagieren nur auf **echte** Klicks (`isTrusted`) an der Stelle, an der das Menü wirklich liegt (`elementFromPoint`). Tastatur-Klicks zählen nur nach einem echten Enter/Leertaste auf genau diesem Knopf. | synthetische Klicks und Events |
| Ein Knopf ist erst klickbar, wenn der Browser ihn als **tatsächlich sichtbar** meldet (Intersection Observer mit `trackVisibility`: nicht verdeckt, nicht durchsichtig, nicht gefiltert). Menüeinträge erst, wenn sie 300 ms ununterbrochen sichtbar waren. | Clickjacking: Die Seite legt etwas über das Menü (auch mit `pointer-events: none`), macht es durchsichtig oder lockt mit Doppelklick-Fallen |
| Symbol und Menü in der Seite haben **keine** Animation, kein `transform`, keinen Weichzeichner (`backdrop-filter`) und keine Halbtransparenz. Sie nutzen die Aurora-Farben ([ADR 0018](/melonapp/entscheidungen/0018-aurora-design/)) als feste Flächen, hell oder dunkel nach `prefers-color-scheme`. | Sonst meldet `trackVisibility` sie als nicht sichtbar und die Klicks werden verworfen. Popup und Speicher-Karte nutzen das normale Theme der Web-App. |
| Zusätzlich: eigene Stile am Host mit `!important`, und Deckkraft, Sichtbarkeit, `filter`, `clip-path`, Maske und `mix-blend-mode` werden für den Knopf und alle Vorfahren bis `<html>` geprüft | Browser ohne `trackVisibility` (Firefox), siehe [offene Punkte](/melonapp/sicherheit/offene-punkte/) |
| Nur echte Absende-Knöpfe lösen die Speicher-Karte aus, nicht z. B. „Passwort zeigen“ | Speicher-Karten mit halb eingegebenen Passwörtern |
| Abgesendet wird nur gemeldet, was sich Schritt für Schritt aus echten Eingaben der Person ergibt oder was MelonApp eingefüllt hat. Jede Änderung im Feld muss genau zu einer echten Taste oder einem echten Einfügen an der aktuellen Cursorposition passen: ein Zeichen pro Taste, Rücktaste und Entf, eingefügter Text aus der Zwischenablage. Ändert sich der Wert anders, etwa per Skript, `execCommand` oder durch eine abgefangene Taste, zählt das Feld nicht mehr. Ereignisse von Skripten (`dispatchEvent`, `requestSubmit`, `click()`) lösen nichts aus. Vom Browser eingefüllte oder per Eingabemethode (IME) getippte Passwörter lösen deshalb keine Karte aus. Ein schon gespeichertes Passwort räumt einen offenen Vorschlag für die Seite weg. | Seiten, die per Skript Passwörter absenden oder unterschieben, um die Karte auszulösen, Vorschläge zu überschreiben oder zu testen, ob ein geratenes Passwort gespeichert ist |
| Nur sichtbare, aktivierte Felder werden erkannt und befüllt | versteckte Felder |
| Nur im Hauptframe, nicht in iframes | fremde, eingebettete Seiten |
| Der Hintergrund prüft die Adresse über `sender.tab.url` (vom Browser), nicht über Angaben der Seite | eine Seite, die sich als andere ausgibt |
| Treffer nur bei gleicher Domain oder Subdomain, nicht `github.com.evil.example` oder Eltern-Domains | Phishing-Domains |
| Kein Ausfüllen von `https`-Logins in `http`-Seiten (außer `localhost`) | abgehörte, unverschlüsselte Verbindungen |
| Auch das Popup bindet „Ausfüllen“ an die URLs des Logins, das Content-Script prüft sie | Tab hat zwischenzeitlich die Seite gewechselt |
| Nachrichten nur von der eigenen Erweiterung (`sender.id`) | andere Erweiterungen |
| CSP der Erweiterungsseiten: `script-src 'self' 'wasm-unsafe-eval'` | eingeschleuster Code im Popup |
| Speicher-Karte ist eine Erweiterungsseite im iframe, keine HTML-Einfügung in die Seite. Das iframe liegt im selben geschlossenen Shadow DOM wie Symbol und Menü. | Website liest oder verändert die Karte, liest ihre Adresse, sieht, ob sie erscheint, oder macht sie per CSS unsichtbar |
| Die Knöpfe der Karte reagieren erst, wenn sie 600 ms sichtbar war | Klicks, die eigentlich der Seite gelten sollten |
| Die Karte zeigt nur den Vorschlag für die Website des Tabs, in dem sie steckt. „Nie für diese Seite“ und „Verwerfen“ wirken nur auf diese Website. Der Hintergrund prüft das über `sender.tab.url`. | eine Seite, die die Karte selbst einbettet und Vorschläge anderer Seiten verwirft oder ausschließt |
| Speicher-Karte fragt **nie** nach dem Master-Passwort | Websites, die eine täuschend echte Karte nachbauen, um das Master-Passwort abzugreifen |
| `use_dynamic_url` für die Karte (Chromium) | Websites erkennen nicht dauerhaft, dass MelonApp installiert ist, falls sie die Adresse doch erfahren |
| Karte nur auf derselben Domain wie der abgesendete Login und höchstens 5 Minuten lang | Karte taucht auf fremden Seiten auf |

## Tests

- `match.test.ts`: Domain-Abgleich inklusive Look-alike-Domains und http/https, Generator.
- `form.test.ts`: Formular-Erkennung inklusive E-Mail-Schritt bei zweistufigen Logins (ohne Such-,
  Newsletter- und Code-Felder), 2FA-Felder (ohne PLZ, Gutschein und Passwortfelder), Ziffern-Kästchen,
  versteckte/deaktivierte Felder, Ausfüllen mit Events.
- **E2E** (`apps/extension/e2e/extension.e2e.mjs`, CI-Job `e2e`): echtes Chromium mit geladener
  Erweiterung gegen den kompletten Stack. Kein Ausfüllen ohne Klick, Ausfüllen auf passender
  Domain, 2FA-Code auf der Bestätigungsseite, Seiten-Skripte erreichen das Shadow DOM nicht,
  synthetische Klicks öffnen nichts, und durch ein darübergelegtes Element oder eine unsichtbar
  gemachte Seite wird nicht ausgefüllt (der echte Klick danach schon). Die Tests finden Symbol und
  Menü über den Accessibility-Baum (CDP) und klicken per Koordinaten. Nichts auf fremder Domain, zweistufiger Login und zweistufige Registrierung, Generator, Speichern über die Karte auf der Seite (danach in der
  Web-App sichtbar), Passwort-Aktualisierung, „Nie für diese Seite“ unterdrückt weitere Karten, die
  Einstellungsseite listet die Seite und „Wieder fragen“ bringt die Karte zurück, Sperren
  beendet das Ausfüllen. Per Skript abgesendete oder per `execCommand` eingefügte Passwörter lösen keine Karte aus, die Seite sieht das
  iframe der Karte nicht, und Fokus per Skript verlängert die Sperrzeit nicht.
- `pending.test.ts`: Vorschläge pro Website, alte und kaputte Einträge fallen heraus.
- `server.test.ts`: Server-Adresse nur mit `https`, `http` nur lokal.
