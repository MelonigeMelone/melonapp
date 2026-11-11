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
| Kein Recovery-Key | M2 |
| Keine Schlüsselrotation des Vault-Keys | nach M2 |
| Parser nicht gefuzzt | `cargo-fuzz` für `EncString::parse` und JSON-Eingaben |
| Kein externes Krypto-Review | vor dem Umzug der echten Passwörter |

## Schwachstelle gefunden?

Bitte nicht öffentlich als Issue melden, sondern über
**Security → Report a vulnerability** im GitHub-Repo.
