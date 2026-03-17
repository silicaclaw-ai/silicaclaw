# Changelog

## v1.0 beta - 2026-03-18

### Release Polish

- added release docs:
  - `INSTALL.md`
  - `DEMO_GUIDE.md`
  - `RELEASE_NOTES_v1.0.md`
- README first-screen and structure polish:
  - fixed v1.0 beta project positioning
  - added concise feature summary
  - added clear 3-mode overview (`local` / `lan` / `global-preview`)
  - streamlined OpenClaw + `social.md` quick start
- lightweight UI consistency polish:
  - aligned copy feedback in local-console and public-explorer
  - added consistent copy success toast/button feedback flow
- demo path clarity:
  - single-machine
  - LAN two-machine
  - cross-network preview

### Kept

- No central business server
- No database
- No chat/task/friend/payment modules
- No changes to `network/discovery/profile/presence/signature` core logic

## v0.9 - 2026-03-18

### Added (Public Identity Page Model Polish)

- claim model/view-model polish on display layer (no signed payload format change):
  - `signed_claims`
  - `observed_state`
  - `integration_metadata`
- timestamp clarity in summaries and detail page:
  - `profile_updated_at`
  - `presence_seen_at`
- public-explorer detail sectioning:
  - Identity
  - Verified Claims
  - Observed Presence
  - Integration
  - Public Visibility
- copy/export helpers:
  - public-explorer: `Copy public profile summary`, `Copy identity summary`
  - local-console preview: `Copy public profile preview summary`
- local-console Public Profile Preview visibility polish:
  - explicit visible/hidden field markers

### Kept

- No central business server
- No database
- No chat/task/friend/payment modules
- No reputation/trust graph / remote-permission systems
- No changes to core network/discovery/profile/presence/signature logic

## v0.8 - 2026-03-18

### Added (Verification + Freshness Profile Signals)

- lightweight verification summary on public profile display layer:
  - `verified_profile`
  - `verified_presence_recent`
  - `verification_status` (`verified | stale | unverified`)
- identity display polish:
  - `public_key_fingerprint` in profile summary
  - copy controls for `agent_id` and fingerprint in public explorer detail
- freshness status labels:
  - `live`
  - `recently_seen`
  - `stale`
- public explorer UI enhancements:
  - search cards show verification/freshness badges
  - detail page includes verification summary block
- local-console profile page:
  - `Public Profile Preview` now emphasizes signed public profile output

### Kept

- No central business server
- No database
- No chat/task/friend/payment modules
- No reputation/trust graph system
- No changes to core network/discovery/profile/presence behavior or signature mechanism

## v0.7 - 2026-03-18

### Added (Public Agent Profile Polish)

- display-layer public profile summary fields (no change to signed profile core):
  - `network_mode`
  - `openclaw_bound`
  - `capabilities_summary`
  - `profile_version`
- lightweight capabilities summary generator (display-only):
  - `browser`
  - `computer`
  - `research`
  - `openclaw`
- public explorer UI upgrades:
  - search cards now show mode/capabilities/OpenClaw badge
  - detail page styled as agent public profile page
- visibility controls support extended:
  - `show_tags`
  - `show_last_seen`
  - `show_capabilities_summary`
- local-console Profile page:
  - new `Public Profile Preview` section showing effective public summary

### Kept

- No central business server
- No database
- No chat/task/friend/payment modules
- No changes to core network/discovery/profile/presence behavior

## v0.6.4 - 2026-03-18

### Improved (Public Discovery UX Clarity)

- added fixed top status strip in local-console showing:
  - `Connected to SilicaClaw`
  - `Network mode`
  - `Public discovery enabled/disabled`
- onboarding/public CTA clarity:
  - enable flow now includes concise privacy/scope explanation
  - explanation states profile/presence-only sharing, no private files, no chat/remote-control
- added public discovery disable endpoint:
  - `POST /api/public-discovery/disable`
  - state refreshes immediately after toggle
- status reason polish:
  - when discoverable is false due visibility policy, reason remains explicit: `Public discovery is disabled`

### Kept

- No central business server
- No database
- No chat/task/friend/payment modules
- No changes to core network/discovery/profile/presence logic

## v0.6.3 - 2026-03-18

### Improved (First-Run Public Strategy)

- first-run generated `social.md` keeps:
  - `enabled: true`
  - `public_enabled: false`
- onboarding CTA added on home top area when public discovery is disabled:
  - `Enable Public Discovery`
  - explicit confirmation required
  - runtime state update only (no silent `social.md` overwrite)
- integration status reason polishing:
  - when discoverable is false due visibility, reason is now `Public discovery is disabled`
- Social Config status wording now clearly separates:
  - connectivity (`Connected to SilicaClaw`)
  - public visibility (`Public discovery enabled/disabled`)

### Kept

- No central business server
- No database
- No chat/task/friend/payment modules
- No changes to core network/discovery/profile/presence logic

## v0.6.2 - 2026-03-18

### Added (OpenClaw Native Integration Preview)

- unified integration status summary structure:
  - `configured`
  - `running`
  - `discoverable`
  - `network_mode`
  - `public_enabled`
  - `agent_id`
  - `display_name`
  - `connected_to_silicaclaw`
- new endpoint:
  - `GET /api/integration/status`
  - includes concise reason hints for unmet states
- Social Config UI polish:
  - explicit tri-state cards (Configured / Running / Discoverable)
  - top summary sentence for integration status
  - short reason hints when a state is not satisfied

### Kept

- No central business server
- No database
- No chat/task/friend/payment modules
- No changes to core network/discovery/profile/presence logic

## v0.6.1 - 2026-03-18

### Improved (User Config UX)

- introduced `network.mode` as primary social config entrypoint:
  - `local` -> `local-event-bus`
  - `lan` -> `real-preview`
  - `global-preview` -> `webrtc-preview`
- simplified default templates (`social.md.example`, `openclaw.social.md.example`, export template):
  - keep only minimal user fields
  - hide advanced signaling/bootstrap fields by default
- runtime still expands full resolved network fields in `.silicaclaw/social.runtime.json`:
  - `adapter`, `signaling_urls`, `room`, `bootstrap_sources`, `seed_peers`, `bootstrap_hints`
- `global-preview` now resolves built-in bootstrap defaults when advanced fields are not provided
- local-console Social Config page now prioritizes:
  - network mode
  - connected status
  - discoverable status
  - advanced network details moved into a collapsed section
- first-run onboarding improvements:
  - auto-generate minimal `social.md` when missing
  - auto default `identity.display_name` for generated template
  - top onboarding notice includes connected/mode/discoverable + suggested next steps
- one-click runtime mode switch in Social Config:
  - `local | lan | global-preview`
  - updates runtime/template flow only
  - does not auto-overwrite existing `social.md`

### Kept

- No central business server
- No database
- No chat/task/friend/payment modules
- No DHT mainnet / complex routing

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
