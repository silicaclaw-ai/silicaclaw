import { randomUUID } from "crypto";
import { NetworkAdapter } from "./types";
import {
  MessageEnvelopeCodec,
  NetworkMessageEnvelope,
  validateNetworkMessageEnvelope,
} from "./abstractions/messageEnvelope";
import { TopicCodec } from "./abstractions/topicCodec";
import { NetworkTransport } from "./abstractions/transport";
import { PeerDiscovery, PeerSnapshot } from "./abstractions/peerDiscovery";
import { JsonMessageEnvelopeCodec } from "./codec/jsonMessageEnvelopeCodec";
import { JsonTopicCodec } from "./codec/jsonTopicCodec";
import { UdpLanBroadcastTransport } from "./transport/udpLanBroadcastTransport";
import { HeartbeatPeerDiscovery } from "./discovery/heartbeatPeerDiscovery";
import defaults from "../../../config/silicaclaw-defaults.json";

type RealNetworkAdapterPreviewOptions = {
  peerId?: string;
  namespace?: string;
  transport?: NetworkTransport;
  envelopeCodec?: MessageEnvelopeCodec;
  topicCodec?: TopicCodec;
  peerDiscovery?: PeerDiscovery;
  maxMessageBytes?: number;
  dedupeWindowMs?: number;
  dedupeMaxEntries?: number;
  maxFutureDriftMs?: number;
  maxPastDriftMs?: number;
};

type NetworkDiagnostics = {
  adapter: string;
  peer_id: string;
  namespace: string;
  components: {
    transport: string;
    discovery: string;
    envelope_codec: string;
    topic_codec: string;
  };
  limits: {
    max_message_bytes: number;
    dedupe_window_ms: number;
    dedupe_max_entries: number;
    max_future_drift_ms: number;
    max_past_drift_ms: number;
  };
  config: {
    started: boolean;
    topic_handler_count: number;
    transport: ReturnType<NonNullable<NetworkTransport["getConfig"]>> | null;
    discovery: ReturnType<NonNullable<PeerDiscovery["getConfig"]>> | null;
  };
  peers: {
    total: number;
    online: number;
    stale: number;
    items: PeerSnapshot[];
  };
  stats: {
    publish_attempted: number;
    publish_sent: number;
    received_total: number;
    delivered_total: number;
    dropped_duplicate: number;
    dropped_self: number;
    dropped_malformed: number;
    dropped_oversized: number;
    dropped_namespace_mismatch: number;
    dropped_timestamp_future_drift: number;
    dropped_timestamp_past_drift: number;
    dropped_decode_failed: number;
    dropped_topic_decode_error: number;
    dropped_handler_error: number;
    send_errors: number;
    discovery_errors: number;
    start_errors: number;
    stop_errors: number;
    received_validated: number;
  };
  transport_stats: ReturnType<NonNullable<NetworkTransport["getStats"]>> | null;
  discovery_stats: ReturnType<NonNullable<PeerDiscovery["getStats"]>> | null;
};

export class RealNetworkAdapterPreview implements NetworkAdapter {
  private started = false;
  private peerId: string;
  private namespace: string;
  private transport: NetworkTransport;
  private envelopeCodec: MessageEnvelopeCodec;
  private topicCodec: TopicCodec;
  private peerDiscovery: PeerDiscovery;

  private maxMessageBytes: number;
  private dedupeWindowMs: number;
  private dedupeMaxEntries: number;
  private maxFutureDriftMs: number;
  private maxPastDriftMs: number;
  private seenMessageIds = new Map<string, number>();

  private offTransportMessage: (() => void) | null = null;
  private handlers = new Map<string, Set<(data: any) => void>>();

  private stats: NetworkDiagnostics["stats"] = {
    publish_attempted: 0,
    publish_sent: 0,
    received_total: 0,
    delivered_total: 0,
    dropped_duplicate: 0,
    dropped_self: 0,
    dropped_malformed: 0,
    dropped_oversized: 0,
    dropped_namespace_mismatch: 0,
    dropped_timestamp_future_drift: 0,
    dropped_timestamp_past_drift: 0,
    dropped_decode_failed: 0,
    dropped_topic_decode_error: 0,
    dropped_handler_error: 0,
    send_errors: 0,
    discovery_errors: 0,
    start_errors: 0,
    stop_errors: 0,
    received_validated: 0,
  };

  constructor(options: RealNetworkAdapterPreviewOptions = {}) {
    this.peerId = options.peerId ?? `peer-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.namespace = this.normalizeNamespace(options.namespace ?? defaults.network.default_namespace);
    this.transport = options.transport ?? new UdpLanBroadcastTransport();
    this.envelopeCodec = options.envelopeCodec ?? new JsonMessageEnvelopeCodec();
    this.topicCodec = options.topicCodec ?? new JsonTopicCodec();
    this.peerDiscovery = options.peerDiscovery ?? new HeartbeatPeerDiscovery();

    this.maxMessageBytes = options.maxMessageBytes ?? 64 * 1024;
    this.dedupeWindowMs = options.dedupeWindowMs ?? 90_000;
    this.dedupeMaxEntries = options.dedupeMaxEntries ?? 10_000;
    this.maxFutureDriftMs = options.maxFutureDriftMs ?? 30_000;
    this.maxPastDriftMs = options.maxPastDriftMs ?? 120_000;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    try {
      await this.transport.start();
    } catch (error) {
      this.stats.start_errors += 1;
      throw new Error(`Transport start failed: ${this.errorMessage(error)}`);
    }

    this.started = true;
    this.offTransportMessage = this.transport.onMessage((raw) => {
      this.onTransportMessage(raw);
    });

    try {
      await this.peerDiscovery.start({
        self_peer_id: this.peerId,
        publishControl: async (topic, payload) => {
          await this.publish(topic, payload);
        },
      });
    } catch (error) {
      this.stats.start_errors += 1;
      this.started = false;
      if (this.offTransportMessage) {
        this.offTransportMessage();
        this.offTransportMessage = null;
      }
      try {
        await this.transport.stop();
      } catch {
        this.stats.stop_errors += 1;
      }
      throw new Error(`Peer discovery start failed: ${this.errorMessage(error)}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    try {
      await this.peerDiscovery.stop();
    } catch {
      this.stats.discovery_errors += 1;
      this.stats.stop_errors += 1;
    }

    if (this.offTransportMessage) {
      this.offTransportMessage();
      this.offTransportMessage = null;
    }

    try {
      await this.transport.stop();
    } catch {
      this.stats.stop_errors += 1;
    }

    this.started = false;
  }

  async publish(topic: string, data: any): Promise<void> {
    if (!this.started) {
      return;
    }

    this.stats.publish_attempted += 1;

    if (!this.isValidTopic(topic)) {
      this.stats.dropped_malformed += 1;
      return;
    }

    const envelope: NetworkMessageEnvelope = {
      version: 1,
      message_id: randomUUID(),
      topic: this.topicKey(topic),
      source_peer_id: this.peerId,
      timestamp: Date.now(),
      payload: this.topicCodec.encode(topic, data),
    };

    const raw = this.envelopeCodec.encode(envelope);
    if (raw.length > this.maxMessageBytes) {
      this.stats.dropped_oversized += 1;
      return;
    }

    try {
      await this.transport.send(raw);
      this.stats.publish_sent += 1;
    } catch {
      this.stats.send_errors += 1;
      throw new Error("Transport send failed");
    }
  }

  subscribe(topic: string, handler: (data: any) => void): void {
    if (!this.isValidTopic(topic)) {
      return;
    }

    const key = this.topicKey(topic);
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)?.add(handler);
  }

  listPeers(): PeerSnapshot[] {
    return this.peerDiscovery.listPeers();
  }

  getDiagnostics(): NetworkDiagnostics {
    const peers = this.listPeers();
    const online = peers.filter((peer) => peer.status === "online").length;

    return {
      adapter: "real-preview",
      peer_id: this.peerId,
      namespace: this.namespace,
      components: {
        transport: this.transport.constructor.name,
        discovery: this.peerDiscovery.constructor.name,
        envelope_codec: this.envelopeCodec.constructor.name,
        topic_codec: this.topicCodec.constructor.name,
      },
      limits: {
        max_message_bytes: this.maxMessageBytes,
        dedupe_window_ms: this.dedupeWindowMs,
        dedupe_max_entries: this.dedupeMaxEntries,
        max_future_drift_ms: this.maxFutureDriftMs,
        max_past_drift_ms: this.maxPastDriftMs,
      },
      config: {
        started: this.started,
        topic_handler_count: this.handlers.size,
        transport: this.transport.getConfig?.() ?? null,
        discovery: this.peerDiscovery.getConfig?.() ?? null,
      },
      peers: {
        total: peers.length,
        online,
        stale: Math.max(0, peers.length - online),
        items: peers,
      },
      stats: { ...this.stats },
      transport_stats: this.transport.getStats?.() ?? null,
      discovery_stats: this.peerDiscovery.getStats?.() ?? null,
    };
  }

  private onTransportMessage(raw: Buffer): void {
    this.stats.received_total += 1;

    if (raw.length > this.maxMessageBytes) {
      this.stats.dropped_oversized += 1;
      return;
    }

    const decoded = this.envelopeCodec.decode(raw);
    if (!decoded) {
      this.stats.dropped_decode_failed += 1;
      this.stats.dropped_malformed += 1;
      return;
    }

    const validated = validateNetworkMessageEnvelope(decoded.envelope, {
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
    this.stats.received_validated += 1;

    const envelope = validated.envelope;

    if (!envelope.topic.startsWith(`${this.namespace}:`)) {
      this.stats.dropped_namespace_mismatch += 1;
      return;
    }

    if (this.isDuplicateMessage(envelope.message_id, envelope.timestamp)) {
      this.stats.dropped_duplicate += 1;
      return;
    }

    try {
      this.peerDiscovery.observeEnvelope(envelope);
    } catch {
      this.stats.discovery_errors += 1;
    }

    if (envelope.source_peer_id === this.peerId) {
      this.stats.dropped_self += 1;
      return;
    }

    const topic = this.stripNamespace(envelope.topic);
    if (!topic) {
      this.stats.dropped_namespace_mismatch += 1;
      return;
    }

    const handlers = this.handlers.get(envelope.topic);
    if (!handlers || handlers.size === 0) {
      return;
    }

    try {
      const payload = this.topicCodec.decode(topic, envelope.payload);
      for (const handler of handlers) {
        try {
          handler(payload);
          this.stats.delivered_total += 1;
        } catch {
          this.stats.dropped_handler_error += 1;
        }
      }
    } catch {
      this.stats.dropped_topic_decode_error += 1;
    }
  }

  private topicKey(topic: string): string {
    return `${this.namespace}:${topic}`;
  }

  private stripNamespace(topicKey: string): string | null {
    const prefix = `${this.namespace}:`;
    if (!topicKey.startsWith(prefix)) {
      return null;
    }
    return topicKey.slice(prefix.length);
  }

  private isDuplicateMessage(messageId: string, timestamp: number): boolean {
    const now = Date.now();
    this.cleanupSeenMessageIds(now);

    const existing = this.seenMessageIds.get(messageId);
    if (existing && now - existing <= this.dedupeWindowMs) {
      return true;
    }

    this.seenMessageIds.set(messageId, Number.isFinite(timestamp) ? timestamp : now);
    if (this.seenMessageIds.size > this.dedupeMaxEntries) {
      const oldestKey = this.seenMessageIds.keys().next().value;
      if (oldestKey) {
        this.seenMessageIds.delete(oldestKey);
      }
    }

    return false;
  }

  private cleanupSeenMessageIds(now: number): void {
    for (const [id, ts] of this.seenMessageIds.entries()) {
      if (now - ts > this.dedupeWindowMs) {
        this.seenMessageIds.delete(id);
      }
    }
  }

  private isValidTopic(topic: string): boolean {
    if (typeof topic !== "string") {
      return false;
    }
    const normalized = topic.trim();
    return normalized.length > 0 && !normalized.includes(":");
  }

  private normalizeNamespace(namespace: string): string {
    const normalized = namespace.trim();
    return normalized.length > 0 ? normalized : defaults.network.default_namespace;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
