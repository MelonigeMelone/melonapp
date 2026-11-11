---
title: "0004: Docker Compose auf einem VPS statt Kubernetes"
description: Wo und wie der Server betrieben wird.
sidebar:
  order: 4
---

**Status:** angenommen · **Datum:** 2026-11-11

## Kontext

Wenige Nutzer (eigene Person, Familie, Freunde). Wichtig sind geringe Kosten, wenig
Wartung und Datenhaltung in Deutschland bzw. der EU.

## Entscheidung

Ein kleiner **Hetzner-Cloud-VPS** mit **Docker Compose**: Caddy für TLS, `melon-server`
und PostgreSQL. Gebaut wird über GitHub Actions, Images liegen in der GitHub Container Registry.

## Alternativen

- **Kubernetes:** Für diese Größe nur zusätzliche Komplexität und Angriffsfläche.
- **Fly.io / Railway:** bequem, aber Daten außerhalb der eigenen Kontrolle und
  nutzungsabhängige Kosten.
- **Heim-Server:** möglich (gleiches Compose-File), aber abhängig von Heimnetz und Strom.

## Folgen

- Kosten ca. 4–6 € im Monat. Ein Update ist ein `docker compose pull && up -d`.
- Kein automatisches Failover. Für den Anwendungsfall akzeptabel, weil Clients offline weiterarbeiten.
- Ein Umzug auf Kubernetes bleibt möglich: Das Image ist zustandslos.
