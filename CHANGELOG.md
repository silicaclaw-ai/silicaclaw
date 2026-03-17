# Changelog

## v0.3.1 - 2026-03-17

### Stabilized

- Real preview adapter hardened for LAN demos:
  - message dedupe window/cache
  - self-message filtering
  - malformed envelope tolerance
  - max message size limit
  - namespace validation
  - safer transport start/stop error handling
- Peer health states:
  - `online` / `stale`
  - `first_seen_at` / `last_seen_at`
  - `messages_seen`
  - stale-to-remove lifecycle cleanup
- Diagnostics/observability:
  - real adapter diagnostics API (`components`, `limits`, `stats`, `peers`)
  - split API endpoints:
    - `GET /api/network/config`
    - `GET /api/network/stats`
  - local-console `Peers` panel
  - network page now shows transport/discovery/envelope/topic codec names
- release engineering assets:
  - `VERSION`
  - `RELEASE_NOTES.md`

## v0.3.0-preview - 2026-03-17

### Added

- `RealNetworkAdapterPreview` for lightweight real-network validation
- Transport abstraction (`NetworkTransport`)
- Peer discovery abstraction (`PeerDiscovery`)
- Message envelope abstraction (`NetworkMessageEnvelope` + codec)
- Topic codec abstraction (`TopicCodec`)
- UDP LAN broadcast transport preview (`UdpLanBroadcastTransport`)
- Heartbeat-based peer discovery preview (`HeartbeatPeerDiscovery`)
- local-console adapter selection support for `NETWORK_ADAPTER=real-preview`
- network summary now includes `peers_discovered`

### Kept

- `MockNetworkAdapter`
- `LocalEventBusAdapter`

### Not Added (by design)

- central registry or central API
- database migration
- login/user system
- chat/task/friend/payment/reputation features

## v0.2.0 - 2026-03-17

- first-start auto identity/profile init
- presence TTL + offline state
- cache/index cleanup and stable sorting
- unified API envelope
- local-console/public-explorer UI polish
