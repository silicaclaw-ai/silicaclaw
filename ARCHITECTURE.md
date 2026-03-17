# SilicaClaw Architecture (v0.3 Preview)

## Scope Guardrails

- No central registry
- No central business API
- No SQL database
- No login/user system
- No chat/task/friend/payment/reputation modules

## Network Layer Evolution

SilicaClaw keeps `NetworkAdapter` stable and adds a preview path toward real networking.

```text
apps/local-console
  -> NetworkAdapter (publish/subscribe)
      -> MockNetworkAdapter
      -> LocalEventBusAdapter
      -> RealNetworkAdapterPreview (NEW)
           -> Transport abstraction
           -> Message envelope abstraction
           -> Topic codec abstraction
           -> Peer discovery abstraction
```

## Abstractions

### 1) Transport abstraction

File: `packages/network/src/abstractions/transport.ts`

- `start()` / `stop()`
- `send(Buffer)`
- `onMessage((Buffer, meta) => void)`

Preview implementation:

- `UdpLanBroadcastTransport`
  - UDP broadcast on LAN (`255.255.255.255`)
  - `reuseAddr` for multi-process local testing

### 2) Message envelope abstraction

File: `packages/network/src/abstractions/messageEnvelope.ts`

Envelope shape:

- `version`
- `message_id`
- `topic`
- `source_peer_id`
- `timestamp`
- `payload`

Preview codec:

- `JsonMessageEnvelopeCodec`

### 3) Topic codec abstraction

File: `packages/network/src/abstractions/topicCodec.ts`

- `encode(topic, payload)`
- `decode(topic, payload)`

Preview codec:

- `JsonTopicCodec`

### 4) Peer discovery abstraction

File: `packages/network/src/abstractions/peerDiscovery.ts`

- `start(context)` / `stop()`
- `observeEnvelope(envelope)`
- `listPeers()`

Preview implementation:

- `HeartbeatPeerDiscovery`
  - emits `__discovery/heartbeat`
  - learns peers from inbound envelopes
  - evicts stale peers by TTL

## RealNetworkAdapterPreview Flow

```text
publish(topic, data)
  -> topicCodec.encode
  -> envelopeCodec.encode
  -> transport.send

transport.onMessage(raw)
  -> envelopeCodec.decode
  -> peerDiscovery.observeEnvelope
  -> namespace filter
  -> topicCodec.decode
  -> user handlers
```

## Future-Compatible Points

Current design intentionally separates concerns so we can swap implementations:

- Transport -> WebRTC data channel / libp2p transport
- Discovery -> DHT / mDNS / rendezvous peer strategy
- Envelope codec -> protobuf/cbor with signatures
- Topic codec -> per-topic schema validation and versioning

## Runtime Selection

`apps/local-console` adapter selection:

- `NETWORK_ADAPTER=mock`
- `NETWORK_ADAPTER=local-event-bus` (default)
- `NETWORK_ADAPTER=real-preview` (UDP LAN preview)

Optional env:

- `NETWORK_PORT` (default: `44123`)
- `NETWORK_NAMESPACE` (default: `silicaclaw.preview`)
