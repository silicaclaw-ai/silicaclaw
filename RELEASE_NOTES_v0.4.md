# SilicaClaw v0.4 Release Notes

## Scope

v0.4 focuses on backend observability + frontend visibility polish, without introducing new business modules.

Not added:

- chat
- task delegation
- friend system
- payment
- centralized server
- SQL database

## Highlights

### 1. Network API visibility

- Added/expanded `GET /api/network/config`
- Added/expanded `GET /api/network/stats`

### 2. Envelope validation hardening

- unified envelope schema validation
- timestamp drift windows (future/past)
- malformed/decode/namespace/timestamp drop accounting

### 3. Transport abstraction upgrade

- optional `getConfig()` and `getStats()`
- lifecycle states and counters
- UDP transport now exports runtime config + message/error stats

### 4. Discovery abstraction upgrade

- optional `getConfig()` and `getStats()`
- heartbeat/reconcile/peer lifecycle counters
- stale and remove lifecycle accounting

### 5. Local Console observability upgrade

- Network page reads `/api/network/config` and `/api/network/stats`
- richer components/limits/config/stats snapshots
- Peers page shows discovery counters and richer peer inventory
- Logs page supports category filter (`all/info/warn/error`)

## New Environment Variables

- `NETWORK_PEER_ID`
- `NETWORK_UDP_BIND_ADDRESS`
- `NETWORK_UDP_BROADCAST_ADDRESS`
- `NETWORK_MAX_MESSAGE_BYTES`
- `NETWORK_DEDUPE_WINDOW_MS`
- `NETWORK_DEDUPE_MAX_ENTRIES`
- `NETWORK_MAX_FUTURE_DRIFT_MS`
- `NETWORK_MAX_PAST_DRIFT_MS`
- `NETWORK_HEARTBEAT_INTERVAL_MS`
- `NETWORK_PEER_STALE_AFTER_MS`
- `NETWORK_PEER_REMOVE_AFTER_MS`

## Compatibility

- `NetworkAdapter` interface remains unchanged
- existing adapters retained: `mock`, `local-event-bus`, `real-preview`

## Validation

- `npm run check` passes
