---
title: Offene Punkte
description: Bekannte Lücken und was vor dem echten Einsatz noch passieren muss.
sidebar:
  order: 4
---

:::caution
Bis die Krypto extern geprüft ist, ist MelonApp ein Hobby-Projekt und kein geprüftes Produkt.
:::

| Punkt | Plan |
|---|---|
| GitHub Actions sind über Tags gepinnt, nicht über Commit-SHAs | vor dem echten Einsatz auf SHAs umstellen, Dependabot hält sie aktuell |
| Login-Limit nur pro Konto, im Speicher | IP-basiertes Limit über Caddy oder fail2ban. Ein Neustart setzt die Zähler zurück, das ist akzeptiert. |
| Kein Recovery-Key, Master-Passwort nicht änderbar | M4, als Nächstes |
| Öffentliche Schlüssel werden dem Server geglaubt | Fingerabdruck-Vergleich beim Hinzufügen (M4), siehe [Sicherheitsmodell](/melonapp/sicherheit/modell/#bekannte-grenze-öffentliche-schlüssel) |
| Mitgliederliste zeigt allen Mitgliedern die E-Mails | gewollt für Familie/Freunde |
| Kein Wechsel des eigenen Schlüsselpaars | nach M4 |
| Parser nicht gefuzzt | `cargo-fuzz` für `EncString::parse` und JSON-Eingaben |
| Kein externes Krypto-Review | vor dem Umzug der echten Passwörter |
| Entschlüsselte Einträge liegen im Haupt-Thread der Web-App | gewollt, siehe [ADR 0007](/melonapp/entscheidungen/0007-schluessel-im-worker/). Schutz durch CSP und Auto-Lock. |
| CSP erlaubt `style-src 'unsafe-inline'` (MUI/Emotion) | auf Pigment CSS umsteigen, sobald stabil ([ADR 0008](/melonapp/entscheidungen/0008-mui/)) |
| RustCrypto-Major-Updates (sha2 0.11, hkdf 0.13, hmac 0.13, chacha20poly1305 0.11) | gemeinsam als ein Update einspielen, Dependabot gruppiert sie |

## Schwachstelle gefunden?

Bitte nicht öffentlich als Issue melden, sondern über
**Security → Report a vulnerability** im GitHub-Repo.
