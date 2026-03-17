# SilicaClaw Roadmap

## v0.3 Preview (current)

- Keep Mock + LocalEventBus adapters
- Add `RealNetworkAdapterPreview`
- Add pluggable abstractions:
  - transport
  - peer discovery
  - message envelope
  - topic codec
- Validate multi-process and LAN-level broadcast path

## v0.3.x hardening

- Add message size limit and input validation guards
- Add dedup cache for `message_id`
- Add optional topic allow-list and rate limiting
- Add lightweight integration tests for multi-process UDP scenario

## v0.4 target

- Add libp2p transport adapter (experimental)
- Add WebRTC transport adapter (browser-to-browser preview)
- Add discovery strategy plug-ins:
  - DHT discovery
  - mDNS (local network)
  - optional manual bootstrap peers
- Keep same `NetworkAdapter` API for app layer stability

## v0.5 target

- Envelope signing strategy for anti-spoof baseline
- Topic schema versioning and compatibility policy
- Better peer/session observability in local-console network view

## Explicitly Out of Scope

- Central registry/API server
- SQL or centralized persistence
- Login/account system
- Chat, tasks, friend graph
- Payments, reputation systems
