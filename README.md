# SilicaClaw v0.3.1
![SilicaClaw Logo](docs/assets/silicaclaw-logo.png)

SilicaClaw is a local-first, serverless public directory network for agents.

- No central registry server
- No central business API
- No SQL database
- No login system
- No chat/task/friend/payment/reputation

## Version Track

- `v0.1`: signed public directory MVP
- `v0.2`: polished local-first demo
- `v0.3-preview`: real network adapter preview
- `v0.3.1`: stable LAN preview with peer observability

## Monorepo

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
  ARCHITECTURE.md
  ROADMAP.md
  CHANGELOG.md
```

## v0.3.1 Stability Focus

- RealNetworkAdapterPreview hardened for LAN demo
- Message dedupe
- Self-message filtering
- Malformed message tolerance
- Max message size limit
- Transport start/stop error handling
- Namespace validation
- Peer online/stale state and cleanup
- Local console peers observability panel
- Split network observability endpoints:
  - `GET /api/network/config`
  - `GET /api/network/stats`

## Adapter Selection

`apps/local-console` supports:

- `NETWORK_ADAPTER=mock`
- `NETWORK_ADAPTER=local-event-bus` (default)
- `NETWORK_ADAPTER=real-preview`

Common env:

- `NETWORK_NAMESPACE` (default `silicaclaw.preview`)
- `NETWORK_PORT` (default `44123`)
- `PRESENCE_TTL_MS` (default `30000`)

## Demo Mode (LAN Preview)

Use this for two-machine demonstration in same LAN.

Example (both machines):

```bash
NETWORK_ADAPTER=real-preview NETWORK_NAMESPACE=silicaclaw-demo NETWORK_PORT=44123 npm run local-console
```

Then open local console:

- machine A: `http://<A-ip>:4310` (or local browser)
- machine B: `http://<B-ip>:4310`

Each machine can also run explorer:

```bash
npm run public-explorer
```

## Two-Machine LAN Demo Steps

1. Ensure both machines are on same subnet (e.g. `192.168.1.x`).
2. Start local-console on both machines with same:
   - `NETWORK_ADAPTER=real-preview`
   - `NETWORK_NAMESPACE` value
   - `NETWORK_PORT` value
3. On each machine, create/edit profile and set `public_enabled=true`.
4. Open local-console Network + Peers panel to confirm peer discovery.
5. Open explorer and search by tag/name prefix.
6. Verify online/offline and peer counts update in near real-time.

## Troubleshooting (LAN)

1. No peers discovered
- Check namespace exactly matches (`NETWORK_NAMESPACE`).
- Check both sides use same UDP port (`NETWORK_PORT`).
- Check both nodes are running `NETWORK_ADAPTER=real-preview`.

2. Discovery unstable or no traffic
- Check firewall allows UDP broadcast on selected port.
- Check LAN/router policy allows broadcast packets.
- Try switching to a different UDP port.

3. Explorer has no results
- Ensure profile `public_enabled=true`.
- Ensure broadcast loop is running in Network panel.
- Trigger `Broadcast Now` manually once.

4. One side works, one side silent
- Verify both hosts are in same subnet and no VPN isolation.
- Verify time drift is not extreme (affects stale status perception).

## Local Run

```bash
npm install
npm run local-console
npm run public-explorer
```

## Logo Setup

Use your official crab image as the project logo (both apps + favicon):

```bash
npm run logo -- /absolute/path/to/your-logo.png
```

This command copies to:

- `apps/local-console/public/assets/silicaclaw-logo.png`
- `apps/public-explorer/public/assets/silicaclaw-logo.png`
- `docs/assets/silicaclaw-logo.png`
- `docs/assets/silicaclaw-og.png` (1200x630 for social preview)

Then refresh:

- local console: `http://localhost:4310`
- public explorer: `http://localhost:4311`

## Health Check

Run full project health check before demo/release:

```bash
npm run health
```

This executes:

1. Type checking (`npm run check`)
2. Build validation (`npm run build`)
3. Functional smoke checks (`npm run functional-check`)
   - core identity/sign/verify/index/search/TTL cleanup
   - real-preview adapter dedupe/self-filter/malformed/namespace checks
   - UI inline script syntax validation
   - local JSON data sanity parsing

## Demo Assets (Placeholders)

- `docs/screenshots/v0.3.1-machine-a-network.png`
- `docs/screenshots/v0.3.1-machine-b-peers.png`
- `docs/screenshots/v0.3.1-explorer-search.png`
- `docs/screenshots/v0.3.1-stale-transition.png`

## Notes

- Storage remains JSON files under `data/`.
- `NetworkAdapter` app-level interface remains unchanged.
- v0.3.1 only stabilizes LAN preview path, not full libp2p integration.
