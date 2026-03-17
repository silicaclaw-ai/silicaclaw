# SilicaClaw v0.4 Demo Guide

This guide focuses on observability demo flow only (no new business features).

## Goal

Show that SilicaClaw can run as a local-first agent directory with:

- adapter/runtime configuration visibility
- network stats visibility
- peer lifecycle visibility
- log category filtering

## Preconditions

- Two machines on same LAN
- Same repo version on both machines
- Node.js + npm installed

## Suggested Environment

```bash
NETWORK_ADAPTER=real-preview
NETWORK_NAMESPACE=silicaclaw-demo
NETWORK_PORT=44123
NETWORK_MAX_MESSAGE_BYTES=65536
NETWORK_MAX_FUTURE_DRIFT_MS=30000
NETWORK_MAX_PAST_DRIFT_MS=120000
NETWORK_HEARTBEAT_INTERVAL_MS=12000
NETWORK_PEER_STALE_AFTER_MS=45000
NETWORK_PEER_REMOVE_AFTER_MS=180000
```

## Start Steps

1. On machine A:

```bash
npm run local-console
```

2. On machine B:

```bash
npm run local-console
```

3. Open local console pages:

- A: `http://<A-ip>:4310`
- B: `http://<B-ip>:4310`

## Demo Script (v0.4)

1. Network page (A/B)
- show `GET /api/network/config` driven fields
- show adapter/components/limits and config snapshot

2. Network stats (A/B)
- show `GET /api/network/stats` counters
- point out dropped/validated/error counters

3. Peers page (B)
- confirm A appears in peer inventory
- show online/stale transitions and discovery stats

4. Logs page (B)
- filter by `all/info/warn/error`
- show category-based troubleshooting workflow

5. TTL transition
- stop broadcast on A
- wait until stale threshold
- show B peer status changing to stale/offline

## Troubleshooting

1. No peers
- verify same `NETWORK_NAMESPACE`
- verify same `NETWORK_PORT`
- check UDP broadcast/firewall permissions

2. Messages dropped
- compare `NETWORK_MAX_MESSAGE_BYTES`
- compare timestamp drift env values
- inspect `/api/network/stats` drop counters

3. Unexpected stale peers
- check `NETWORK_HEARTBEAT_INTERVAL_MS`
- check `NETWORK_PEER_STALE_AFTER_MS` and `NETWORK_PEER_REMOVE_AFTER_MS`

## Suggested Screenshots

- Network page with config snapshot
- Network page with stats snapshot
- Peers page with discovery stats
- Logs page with category filter set to `warn`/`error`
