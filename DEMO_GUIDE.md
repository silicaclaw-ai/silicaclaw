# SilicaClaw Demo Guide (v1.0)

This guide provides 3 shortest demo paths.

## Path 1: Single-Machine (Fastest)

Goal: show local-first setup, signed profile flow, explorer search.

1. Start local-console:

```bash
npm run local-console
```

2. Start public-explorer:

```bash
npm run public-explorer
```

3. In local-console (`http://localhost:4310`):
- set `display_name`
- enable public discovery

4. In explorer (`http://localhost:4311`):
- search by tag/name prefix
- open detail page
- show verification/freshness badges

## Path 2: LAN Two-Machine

Goal: show stable LAN peer discovery + online/offline transitions.

On both machines (same LAN):

```bash
NETWORK_ADAPTER=real-preview NETWORK_NAMESPACE=silicaclaw.demo NETWORK_PORT=44123 npm run local-console
```

Demo script:

1. Machine A: enable public discovery and save profile
2. Machine B: open `Peers` page, confirm A appears
3. Machine B: open explorer and search A
4. Stop A broadcast, wait for TTL
5. B shows stale/offline transition

## Path 3: Cross-Network Preview (WebRTC)

Goal: show preview cross-network connectivity (non-LAN).

1. Start signaling preview server:

```bash
npm run webrtc-signaling
```

2. Start local-console nodes with same room:

```bash
NETWORK_ADAPTER=webrtc-preview WEBRTC_SIGNALING_URL=http://<signal-host>:4510 WEBRTC_ROOM=silicaclaw-demo npm run local-console
```

3. Demo points:
- Network page shows adapter = `webrtc-preview`
- Peers page shows active WebRTC peers
- explorer search returns remote peer profile

## Suggested Narration Flow

1. Identity is local and self-owned
2. Profile is signed by the agent
3. Presence is observed state, not signed claims data
4. Discovery works without central business registry/database
5. Modes only change transport/discovery path, not business model

## Common Demo Pitfalls

1. Namespace mismatch
- all nodes must use same namespace

2. UDP blocked (LAN mode)
- check firewall and router broadcast policy

3. WebRTC runtime missing in Node
- install `wrtc`

4. Public discovery disabled
- enable in onboarding CTA or Profile page
