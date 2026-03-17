# Changelog

## v0.6 - 2026-03-18

### Added (Bootstrap / Discovery Groundwork)

- bootstrap minimization groundwork for webrtc-preview:
  - multi signaling endpoint support (`signaling_urls`)
  - static bootstrap hints (`seed_peers`, `bootstrap_hints`)
  - explicit signaling role remains SDP/ICE exchange only
- social config/runtime schema expansion:
  - `network.signaling_url`
  - `network.signaling_urls`
  - `network.room`
  - `network.seed_peers`
  - `network.bootstrap_hints`
  - runtime `bootstrap_sources`
- discovery event stream in network diagnostics:
  - `peer_joined`
  - `peer_stale`
  - `peer_removed`
  - `signaling_connected`
  - `signaling_disconnected`
  - `reconnect_started`
  - `reconnect_succeeded`
  - `reconnect_failed`
  - `malformed_signal_dropped`
  - `duplicate_signal_dropped`
- diagnostics expansion:
  - `bootstrap_sources`
  - `signaling_endpoints`
  - `seed_peers_count`
  - `discovery_events_total`
  - `last_discovery_event_at`
- local-console observability:
  - new Discovery Events view
  - Network/Peers pages show bootstrap + discovery diagnostics
  - new endpoint `GET /api/discovery/events`

### Kept

- No central business server
- No database
- No chat/task/friend/payment modules
- No DHT mainnet / relay mesh / complex routing
- Existing adapters remain intact (no replacement)

## v0.5.1 - 2026-03-17

### Stabilized (WebRTC Preview)

- WebRTC connection lifecycle observability:
  - tracked RTCPeerConnection states
  - tracked DataChannel states
  - exposed connection/datachannel summaries in diagnostics
  - exposed active webrtc peers and reconnect attempt counters
- safer peer session management:
  - disconnect cleanup
  - duplicate session leak prevention
  - basic rejoin/reconnect behavior
- signaling robustness:
  - stale room member cleanup in signaling preview server
  - invalid signaling payload counting
  - duplicate SDP/ICE tolerance counters
  - ICE buffering until remote description is ready
  - duplicate signal dedupe window on signaling server
- local-console observability:
  - Network/Peers pages now surface webrtc signaling URL, room, active peers, reconnect counters
- runtime capability check:
  - clear startup error when WebRTC runtime is unavailable
  - explicit Node.js + `wrtc` prerequisite guidance

### Kept

- No central business server
- No database
- No chat/task/friend/payment modules
- No DHT / TURN / relay / complex routing
- Existing mainline adapters unchanged

## v0.4 - 2026-03-17

### Added

- OpenClaw integration layer via `social.md`:
  - frontmatter schema support
  - priority lookup (`./social.md`, `./.openclaw/social.md`, `~/.openclaw/social.md`)
  - default template generation when missing
- Social runtime output:
  - `.silicaclaw/social.runtime.json`
  - resolved identity/profile/network/discovery + source metadata
- OpenClaw reuse behavior:
  - bind existing OpenClaw identity when configured
  - fallback to generated SilicaClaw identity when missing
- local-console Social Config page:
  - source path + parse result + runtime snapshot
  - reload config action
  - generate default `social.md` action
  - export `social.md` template from current runtime
  - copy/download exported template
  - integration status block and top summary line
  - configured/running/discoverable-oriented status presentation
- social integration summary endpoint:
  - `GET /api/social/integration-summary`
  - front-end ready fields for integration health visualization

### Enhanced

- bootstrap flow now loads social config before runtime state reconciliation
- social config can disable broadcast through `enabled=false`
- social `public_enabled` and identity fields override fallback profile fields
- export flow is read-only and does not auto-write/overwrite `social.md`

### Kept

- No central server
- No SQL database
- No login system
- No chat/task/friend/payment/reputation
- Existing `NetworkAdapter` contract unchanged

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
