import { randomUUID } from "crypto";
import { NetworkAdapter } from "./types";
import {
  MessageEnvelopeCodec,
  NetworkMessageEnvelope,
  validateNetworkMessageEnvelope,
} from "./abstractions/messageEnvelope";
import { TopicCodec } from "./abstractions/topicCodec";
import { JsonMessageEnvelopeCodec } from "./codec/jsonMessageEnvelopeCodec";
import { JsonTopicCodec } from "./codec/jsonTopicCodec";

type RelayPreviewOptions = {
  peerId?: string;
  namespace?: string;
  signalingUrl?: string;
  signalingUrls?: string[];
  room?: string;
  seedPeers?: string[];
  bootstrapHints?: string[];
  bootstrapSources?: string[];
  maxMessageBytes?: number;
  pollIntervalMs?: number;
  maxFutureDriftMs?: number;
  maxPastDriftMs?: number;
};

type RelayPeer = {
  peer_id: string;
  status: "online";
  first_seen_at: number;
  last_seen_at: number;
  messages_seen: number;
  reconnect_attempts: number;
};

type RelayDiagnostics = {
  adapter: "relay-preview";
  peer_id: string;
  namespace: string;
  room: string;
  signaling_url: string;
  signaling_endpoints: string[];
  bootstrap_sources: string[];
  seed_peers_count: number;
  bootstrap_hints_count: number;
  discovery_events_total: number;
  last_discovery_event_at: number;
  discovery_events: Array<{
    id: string;
    type: string;
    at: number;
    peer_id?: string;
    endpoint?: string;
    detail?: string;
  }>;
  signaling_messages_sent_total: number;
  signaling_messages_received_total: number;
  reconnect_attempts_total: number;
  active_webrtc_peers: number;
  components: {
    transport: string;
    discovery: string;
    envelope_codec: string;
    topic_codec: string;
  };
  limits: {
    max_message_bytes: number;
    max_future_drift_ms: number;
    max_past_drift_ms: number;
  };
  config: {
    started: boolean;
    topic_handler_count: number;
    poll_interval_ms: number;
  };
  peers: {
    total: number;
    online: number;
    stale: number;
    items: RelayPeer[];
  };
  stats: {
    publish_attempted: number;
    publish_sent: number;
    received_total: number;
    delivered_total: number;
    dropped_malformed: number;
    dropped_oversized: number;
    dropped_namespace_mismatch: number;
    dropped_timestamp_future_drift: number;
    dropped_timestamp_past_drift: number;
    dropped_decode_failed: number;
    dropped_self: number;
    dropped_topic_decode_error: number;
    dropped_handler_error: number;
    signaling_errors: number;
    invalid_signaling_payload_total: number;
    duplicate_sdp_total: number;
    duplicate_ice_total: number;
    start_errors: number;
    stop_errors: number;
    received_validated: number;
  };
};

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export class RelayPreviewAdapter implements NetworkAdapter {
  private readonly peerId: string;
  private readonly namespace: string;
  private readonly signalingEndpoints: string[];
  private readonly room: string;
  private readonly seedPeers: string[];
  private readonly bootstrapHints: string[];
  private readonly bootstrapSources: string[];
  private readonly maxMessageBytes: number;
  private readonly pollIntervalMs: number;
  private readonly maxFutureDriftMs: number;
  private readonly maxPastDriftMs: number;
  private readonly envelopeCodec: MessageEnvelopeCodec;
  private readonly topicCodec: TopicCodec;

  private started = false;
  private poller: NodeJS.Timeout | null = null;
  private handlers = new Map<string, Set<(data: any) => void>>();
  private peers = new Map<string, RelayPeer>();
  private seenMessageIds = new Set<string>();
  private activeEndpoint = "";
  private discoveryEvents: RelayDiagnostics["discovery_events"] = [];
  private discoveryEventsTotal = 0;
  private lastDiscoveryEventAt = 0;
  private signalingMessagesSentTotal = 0;
  private signalingMessagesReceivedTotal = 0;
  private reconnectAttemptsTotal = 0;

  private stats: RelayDiagnostics["stats"] = {
    publish_attempted: 0,
    publish_sent: 0,
    received_total: 0,
    delivered_total: 0,
    dropped_malformed: 0,
    dropped_oversized: 0,
    dropped_namespace_mismatch: 0,
    dropped_timestamp_future_drift: 0,
    dropped_timestamp_past_drift: 0,
    dropped_decode_failed: 0,
    dropped_self: 0,
    dropped_topic_decode_error: 0,
    dropped_handler_error: 0,
    signaling_errors: 0,
    invalid_signaling_payload_total: 0,
    duplicate_sdp_total: 0,
    duplicate_ice_total: 0,
    start_errors: 0,
    stop_errors: 0,
    received_validated: 0,
  };

  constructor(options: RelayPreviewOptions = {}) {
    this.peerId = options.peerId ?? `peer-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.namespace = String(options.namespace || "silicaclaw.preview").trim() || "silicaclaw.preview";
    this.signalingEndpoints = dedupe(
      (options.signalingUrls && options.signalingUrls.length > 0
        ? options.signalingUrls
        : [options.signalingUrl || "http://localhost:4510"])
    );
    this.activeEndpoint = this.signalingEndpoints[0] || "http://localhost:4510";
    this.room = String(options.room || "silicaclaw-global-preview").trim() || "silicaclaw-global-preview";
    this.seedPeers = dedupe(options.seedPeers || []);
    this.bootstrapHints = dedupe(options.bootstrapHints || []);
    this.bootstrapSources = dedupe(options.bootstrapSources || []);
    this.maxMessageBytes = options.maxMessageBytes ?? 64 * 1024;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxFutureDriftMs = options.maxFutureDriftMs ?? 30_000;
    this.maxPastDriftMs = options.maxPastDriftMs ?? 120_000;
    this.envelopeCodec = new JsonMessageEnvelopeCodec();
    this.topicCodec = new JsonTopicCodec();
  }

  async start(): Promise<void> {
    if (this.started) return;
    try {
      await this.post("/join", { room: this.room, peer_id: this.peerId });
      this.started = true;
      await this.refreshPeers();
      await this.pollOnce();
      this.poller = setInterval(() => {
        this.pollOnce().catch(() => {});
      }, this.pollIntervalMs);
      this.recordDiscovery("signaling_connected", { endpoint: this.activeEndpoint });
    } catch (error) {
      this.stats.start_errors += 1;
      throw new Error(`Relay start failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
    try {
      await this.post("/leave", { room: this.room, peer_id: this.peerId });
    } catch {
      this.stats.stop_errors += 1;
    }
    this.started = false;
    this.recordDiscovery("signaling_disconnected", { endpoint: this.activeEndpoint });
  }

  async publish(topic: string, data: any): Promise<void> {
    if (!this.started) return;
    this.stats.publish_attempted += 1;
    const envelope: NetworkMessageEnvelope = {
      version: 1,
      message_id: randomUUID(),
      topic: `${this.namespace}:${topic}`,
      source_peer_id: this.peerId,
      timestamp: Date.now(),
      payload: this.topicCodec.encode(topic, data),
    };
    const raw = this.envelopeCodec.encode(envelope);
    if (raw.length > this.maxMessageBytes) {
      this.stats.dropped_oversized += 1;
      return;
    }
    await this.post("/relay/publish", { room: this.room, peer_id: this.peerId, envelope });
    this.stats.publish_sent += 1;
    this.signalingMessagesSentTotal += 1;
  }

  subscribe(topic: string, handler: (data: any) => void): void {
    const key = `${this.namespace}:${topic}`;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)?.add(handler);
  }

  getDiagnostics(): RelayDiagnostics {
    const peerItems = Array.from(this.peers.values()).sort((a, b) => b.last_seen_at - a.last_seen_at);
    return {
      adapter: "relay-preview",
      peer_id: this.peerId,
      namespace: this.namespace,
      room: this.room,
      signaling_url: this.activeEndpoint,
      signaling_endpoints: this.signalingEndpoints,
      bootstrap_sources: this.bootstrapSources,
      seed_peers_count: this.seedPeers.length,
      bootstrap_hints_count: this.bootstrapHints.length,
      discovery_events_total: this.discoveryEventsTotal,
      last_discovery_event_at: this.lastDiscoveryEventAt,
      discovery_events: this.discoveryEvents,
      signaling_messages_sent_total: this.signalingMessagesSentTotal,
      signaling_messages_received_total: this.signalingMessagesReceivedTotal,
      reconnect_attempts_total: this.reconnectAttemptsTotal,
      active_webrtc_peers: peerItems.length,
      components: {
        transport: "HttpRelayTransport",
        discovery: "RelayRoomPeerList",
        envelope_codec: this.envelopeCodec.constructor.name,
        topic_codec: this.topicCodec.constructor.name,
      },
      limits: {
        max_message_bytes: this.maxMessageBytes,
        max_future_drift_ms: this.maxFutureDriftMs,
        max_past_drift_ms: this.maxPastDriftMs,
      },
      config: {
        started: this.started,
        topic_handler_count: this.handlers.size,
        poll_interval_ms: this.pollIntervalMs,
      },
      peers: {
        total: peerItems.length,
        online: peerItems.length,
        stale: 0,
        items: peerItems,
      },
      stats: { ...this.stats },
    };
  }

  private async pollOnce(): Promise<void> {
    const payload = await this.get(`/relay/poll?room=${encodeURIComponent(this.room)}&peer_id=${encodeURIComponent(this.peerId)}`);
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    for (const message of messages) {
      this.signalingMessagesReceivedTotal += 1;
      this.onEnvelope(message?.envelope);
    }
    await this.refreshPeers();
  }

  private async refreshPeers(): Promise<void> {
    const payload = await this.get(`/peers?room=${encodeURIComponent(this.room)}`);
    const peerIds = Array.isArray(payload?.peers) ? payload.peers.map((value: unknown) => String(value || "").trim()).filter(Boolean) : [];
    const now = Date.now();
    const next = new Map<string, RelayPeer>();
    for (const peerId of peerIds) {
      if (peerId === this.peerId) continue;
      const existing = this.peers.get(peerId);
      if (!existing) {
        this.recordDiscovery("peer_joined", { peer_id: peerId });
      }
      next.set(peerId, {
        peer_id: peerId,
        status: "online",
        first_seen_at: existing?.first_seen_at ?? now,
        last_seen_at: now,
        messages_seen: existing?.messages_seen ?? 0,
        reconnect_attempts: existing?.reconnect_attempts ?? 0,
      });
    }
    for (const peerId of this.peers.keys()) {
      if (!next.has(peerId)) {
        this.recordDiscovery("peer_removed", { peer_id: peerId });
      }
    }
    this.peers = next;
  }

  private onEnvelope(envelope: unknown): void {
    this.stats.received_total += 1;
    const validated = validateNetworkMessageEnvelope(envelope, {
      max_future_drift_ms: this.maxFutureDriftMs,
      max_past_drift_ms: this.maxPastDriftMs,
    });
    if (!validated.ok || !validated.envelope) {
      if (validated.reason === "timestamp_future_drift") {
        this.stats.dropped_timestamp_future_drift += 1;
      } else if (validated.reason === "timestamp_past_drift") {
        this.stats.dropped_timestamp_past_drift += 1;
      } else {
        this.stats.dropped_malformed += 1;
      }
      return;
    }
    const message = validated.envelope;
    if (message.source_peer_id === this.peerId) {
      this.stats.dropped_self += 1;
      return;
    }
    if (!message.topic.startsWith(`${this.namespace}:`)) {
      this.stats.dropped_namespace_mismatch += 1;
      return;
    }
    if (this.seenMessageIds.has(message.message_id)) {
      return;
    }
    this.seenMessageIds.add(message.message_id);
    if (this.seenMessageIds.size > 10000) {
      const first = this.seenMessageIds.values().next().value;
      if (first) this.seenMessageIds.delete(first);
    }
    this.stats.received_validated += 1;

    const topicKey = message.topic;
    const topic = topicKey.slice(this.namespace.length + 1);
    const handlers = this.handlers.get(topicKey);
    if (!handlers || handlers.size === 0) return;

    const peer = this.peers.get(message.source_peer_id);
    if (peer) {
      peer.last_seen_at = Date.now();
      peer.messages_seen += 1;
    }

    let payload: unknown;
    try {
      payload = this.topicCodec.decode(topic, message.payload);
    } catch {
      this.stats.dropped_topic_decode_error += 1;
      return;
    }
    for (const handler of handlers) {
      try {
        handler(payload);
        this.stats.delivered_total += 1;
      } catch {
        this.stats.dropped_handler_error += 1;
      }
    }
  }

  private recordDiscovery(type: string, extra: { peer_id?: string; endpoint?: string; detail?: string } = {}): void {
    const event = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      at: Date.now(),
      ...extra,
    };
    this.discoveryEvents.unshift(event);
    this.discoveryEvents = this.discoveryEvents.slice(0, 200);
    this.discoveryEventsTotal += 1;
    this.lastDiscoveryEventAt = event.at;
  }

  private async get(path: string): Promise<any> {
    const endpoint = this.activeEndpoint.replace(/\/+$/, "");
    const response = await fetch(`${endpoint}${path}`);
    if (!response.ok) {
      this.stats.signaling_errors += 1;
      throw new Error(`Relay GET failed (${response.status})`);
    }
    return response.json();
  }

  private async post(path: string, body: any): Promise<any> {
    const endpoint = this.activeEndpoint.replace(/\/+$/, "");
    const response = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      this.stats.signaling_errors += 1;
      throw new Error(`Relay POST failed (${response.status})`);
    }
    return response.json();
  }
}
