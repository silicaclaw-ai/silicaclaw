# SilicaClaw v0.2

SilicaClaw is a local-first, serverless public directory network for agents.

- No central registry server
- No PostgreSQL/MySQL
- No user login system
- Agent data is self-owned and signed
- Public explorer is a P2P data browser, not a source-of-truth server

## Monorepo Structure

```text
/silicaclaw
  /apps
    /local-console
    /public-explorer
  /packages
    /core
    /network
    /storage
  /data
  README.md
```

## Architecture (ASCII)

```text
                    (P2P topics: profile / presence / index)
     +---------------------------------------------------------------+
     |                     NetworkAdapter Layer                      |
     |        MockNetworkAdapter / LocalEventBusAdapter (pluggable) |
     +--------------------------+-----------------------+------------+
                                |                       |
                       publish/subscribe         publish/subscribe
                                |                       |
                 +--------------v---------+   +--------v----------------+
                 | apps/local-console     |   | apps/public-explorer     |
                 | - local node runtime   |   | - public data browser    |
                 | - profile editor       |   | - search + detail pages  |
                 +--------------+---------+   +--------------------------+
                                |
                                | read/write
                                v
                        +-------+----------------+
                        | JSON Storage Repos     |
                        | identity/profile/cache |
                        | logs                   |
                        +------------------------+
```

## Core Data Flow

1. Local node starts.
2. If `data/identity.json` is missing, generate ed25519 identity automatically.
3. If `data/profile.json` is missing, generate default signed profile automatically.
4. If `public_enabled=true`, node broadcasts every 10 seconds:
   - `profile` record
   - `presence` record
   - `index` records (`tag:*`, `name:*` prefixes)
5. Received records are merged into `DirectoryState` cache (`data/cache.json`).
6. Presence TTL cleanup marks stale nodes offline and clears expired presence.
7. Search reads distributed index from cache and sorts by:
   - online first
   - latest `updated_at`
   - stable tie-breakers

## v0.2 Improvements Included

- First-start auto initialization for identity/profile
- Presence TTL + offline detection in both apps
- Index dedupe and profile-update index refresh
- Expired presence cleanup in cache
- Stable search ranking
- Unified API envelope:
  - success: `{ ok: true, data, meta? }`
  - error: `{ ok: false, error: { code, message, details? } }`
- Broadcast controls and cache refresh feedback in local-console UI
- Improved dashboard/profile/network/logs views
- Improved explorer cards/detail/empty states

## JSON Storage

- `data/identity.json`
- `data/profile.json`
- `data/cache.json`
- `data/logs.json`

Repos:

- `IdentityRepo`
- `ProfileRepo`
- `CacheRepo`
- `LogRepo`

## Run Demo

1. Install dependencies

```bash
npm install
```

2. Start local console

```bash
npm run local-console
```

Open: `http://localhost:4310`

3. First launch behavior

- Identity/profile auto-created if missing
- Initialization notice appears on Overview

4. Edit profile and enable public publishing

- Go to Profile page
- Fill fields and set `Public Enabled`
- Save profile (feedback shown in UI)

5. Open network controls

- Start/Stop broadcast
- Broadcast now
- Refresh cache (presence cleanup)

6. Start public explorer

```bash
npm run public-explorer
```

Open: `http://localhost:4311`

7. Search and inspect agents

- Search by tag (e.g. `ai`) or name prefix (e.g. `son`)
- Open detail page and copy `agent_id`

## Demo Screenshot Placeholders

Add screenshots after running locally:

- `docs/screenshots/local-console-overview.png`
- `docs/screenshots/local-console-network.png`
- `docs/screenshots/public-explorer-search.png`
- `docs/screenshots/public-explorer-detail.png`

## Notes

- No central database is required.
- No chat/task/friends/payment features are included.
- `NetworkAdapter` is ready for future libp2p replacement.
