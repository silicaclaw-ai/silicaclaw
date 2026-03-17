# SilicaClaw Roadmap

## Current Baseline: v0.3.1-preview

- Stable LAN preview route with `RealNetworkAdapterPreview`
- Peer lifecycle + observability in local-console
- Production of demo-ready dual-machine runbook

## v0.4 Scope (Transport Upgrade Preview)

Goal: validate a future transport/discovery stack without destabilizing demo flow.

### Track A: Stable Demo Line (keep)

- Keep `real-preview` as default demo path
- Improve reliability tests and troubleshooting docs
- Keep API/UX stable for demos

### Track B: Future Validation Line (new preview)

- Introduce `libp2p-preview` OR `webrtc-preview` branch adapter
- Reuse existing abstractions:
  - transport
  - envelope
  - topic codec
  - peer discovery
- Do not switch main demo line until validation quality is acceptable

## v0.4 Deliverables

- Pluggable transport config layer finalized
- One experimental preview adapter behind feature flag/env
- Side-by-side metrics with `real-preview`
- No changes to app-level `NetworkAdapter` contract

## v0.5 Candidates

- Envelope signing policy for anti-spoof baseline
- Topic schema versioning and compatibility guardrails
- Integration test suite for multi-node LAN and preview transports

## Explicitly Out of Scope

- Central registry/API server
- SQL or centralized persistence
- Login/account system
- Chat, tasks, friend graph
- Payments, reputation systems
