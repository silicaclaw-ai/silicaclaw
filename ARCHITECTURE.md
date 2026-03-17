# SilicaClaw Architecture (v0.3.1)

## Scope Guardrails

- No central registry
- No central business API
- No SQL database
- No login/user system
- No chat/task/friend/payment/reputation modules

## Layered Network Diagram

```text
+------------------------------------------------------------------+
| App Layer                                                        |
| local-console / public-explorer                                  |
+------------------------------+-----------------------------------+
                               |
                               v
+------------------------------------------------------------------+
| NetworkAdapter Contract                                           |
| start/stop/publish/subscribe                                     |
+------------------------------+-----------------------------------+
                               |
            +------------------+------------------+
            |                                     |
            v                                     v
+-------------------------+          +-----------------------------+
| Local Adapters          |          | Real Preview Adapter        |
| - MockNetworkAdapter    |          | - RealNetworkAdapterPreview |
| - LocalEventBusAdapter  |          +-------------+---------------+
+-------------------------+                        |
                                                   v
              +------------------- Pipeline ----------------------+
              | topic codec -> envelope codec -> transport send   |
              | transport recv -> decode -> namespace -> handlers |
              +-------------------+-------------------------------+
                                  |
      +---------------------------+-------------------------------+
      |                           |                               |
      v                           v                               v
+-------------+          +------------------+           +----------------+
| TopicCodec  |          | MessageEnvelope  |           | NetworkTransport|
| (JSON now)  |          | Codec (JSON now) |           | (UDP LAN now)  |
+-------------+          +------------------+           +----------------+
                                  |
                                  v
                          +---------------+
                          | PeerDiscovery |
                          | heartbeat now |
                          +---------------+
```

## Current Real Preview Features

- LAN UDP broadcast transport for multi-process / multi-machine demo
- Message dedupe by `message_id`
- Self-message filtering
- Namespace isolation
- Malformed message tolerance
- Max message size limits
- Peer online/stale lifecycle tracking
- Diagnostics for config/stats/peer inventory

## API Observability Endpoints

- `GET /api/network`
- `GET /api/network/config`
- `GET /api/network/stats`
- `GET /api/peers`

## Runtime Selection

`apps/local-console` adapter selection:

- `NETWORK_ADAPTER=mock`
- `NETWORK_ADAPTER=local-event-bus` (default)
- `NETWORK_ADAPTER=real-preview` (UDP LAN preview)

Common env:

- `NETWORK_PORT` (default: `44123`)
- `NETWORK_NAMESPACE` (default: `silicaclaw.preview`)

## Forward Compatibility

`NetworkAdapter` remains unchanged, enabling swap-in implementations for:

- libp2p transport stack
- WebRTC transport
- DHT-based discovery

without changing upper app/business logic.
