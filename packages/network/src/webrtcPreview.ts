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

type WebRTCPreviewOptions = {
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
  discoveryEventsLimit?: number;
};

type PeerStatus = "connecting" | "online" | "stale";

type WebRTCConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed"
  | "unknown";

type WebRTCDataChannelState = "connecting" | "open" | "closing" | "closed" | "unknown";

type PeerSession = {
  peer_id: string;
  status: PeerStatus;
  first_seen_at: number;
  last_seen_at: number;
  messages_seen: number;
  reconnect_attempts: number;
  last_reconnect_attempt_at: number;
  connection_state: WebRTCConnectionState;
  datachannel_state: WebRTCDataChannelState;
  connection: any | null;
  channel: any | null;
  remote_description_set: boolean;
  pending_ice: any[];
  seen_ice_keys: Set<string>;
  last_offer_sdp: string;
  last_answer_sdp: string;
};

type StateSummary<T extends string> = Record<T, number>;

type WebRTCDiagnostics = {
  adapter: "webrtc-preview";
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
  discovery_events: DiscoveryEvent[];
  connection_states_summary: StateSummary<WebRTCConnectionState>;
  datachannel_states_summary: StateSummary<WebRTCDataChannelState>;
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
    items: Array<{
      peer_id: string;
      status: PeerStatus;
      first_seen_at: number;
      last_seen_at: number;
      messages_seen: number;
      reconnect_attempts: number;
      connection_state: WebRTCConnectionState;
      datachannel_state: WebRTCDataChannelState;
    }>;
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

type DiscoveryEventType =
  | "peer_joined"
  | "peer_stale"
  | "peer_removed"
  | "signaling_connected"
  | "signaling_disconnected"
  | "reconnect_started"
  | "reconnect_succeeded"
  | "reconnect_failed"
  | "malformed_signal_dropped"
  | "duplicate_signal_dropped";

type DiscoveryEvent = {
  id: string;
  type: DiscoveryEventType;
  at: number;
  peer_id?: string;
  endpoint?: string;
  detail?: string;
};

function now(): number {
  return Date.now();
}

function toBuffer(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === "string") return Buffer.from(data, "utf8");
  return null;
}

function connectionStateOrUnknown(connection: any): WebRTCConnectionState {
  const value = String(connection?.connectionState ?? connection?.iceConnectionState ?? "unknown");
  if (
    value === "new" ||
    value === "connecting" ||
    value === "connected" ||
    value === "disconnected" ||
    value === "failed" ||
    value === "closed"
  ) {
    return value;
  }
  return "unknown";
}

function dataChannelStateOrUnknown(channel: any): WebRTCDataChannelState {
  const value = String(channel?.readyState ?? "unknown");
  if (value === "connecting" || value === "open" || value === "closing" || value === "closed") {
    return value;
  }
  return "unknown";
}

function iceKey(candidatePayload: any): string {
  return JSON.stringify({
    candidate: candidatePayload?.candidate ?? "",
    sdpMid: candidatePayload?.sdpMid ?? "",
    sdpMLineIndex: candidatePayload?.sdpMLineIndex ?? "",
  });
}

function dedupeArray(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export class WebRTCPreviewAdapter implements NetworkAdapter {
  private readonly peerId: string;
  private readonly namespace: string;
  private readonly signalingUrl: string;
  private readonly signalingEndpoints: string[];
  private readonly room: string;
  private readonly seedPeers: string[];
  private readonly bootstrapHints: string[];
  private readonly bootstrapSources: string[];
  private readonly maxMessageBytes: number;
  private readonly pollIntervalMs: number;
  private readonly maxFutureDriftMs: number;
  private readonly maxPastDriftMs: number;
  private readonly discoveryEventsLimit: number;

  private readonly envelopeCodec: MessageEnvelopeCodec;
  private readonly topicCodec: TopicCodec;
  private readonly handlers = new Map<string, Set<(data: any) => void>>();
  private readonly sessions = new Map<string, PeerSession>();

  private started = false;
  private poller: NodeJS.Timeout | null = null;
  private wrtc: any = null;
  private processedSignalIds = new Map<string, number>();
  private signalingConnectivity = new Map<string, boolean>();
  private signalingIndex = 0;
  private activeSignalingEndpoint = "";
  private discoveryEvents: DiscoveryEvent[] = [];
  private discoveryEventsTotal = 0;
  private lastDiscoveryEventAt = 0;

  private signalingMessagesSentTotal = 0;
  private signalingMessagesReceivedTotal = 0;
  private reconnectAttemptsTotal = 0;

  private stats: WebRTCDiagnostics["stats"] = {
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

  constructor(options: WebRTCPreviewOptions = {}) {
    this.peerId = options.peerId ?? `webrtc-${process.pid}-${Math.random().toString(36).slice(2, 9)}`;
    this.namespace = (options.namespace ?? "silicaclaw.preview").trim() || "silicaclaw.preview";
    const configuredSignalingUrls = dedupeArray([
      ...(options.signalingUrls ?? []),
      options.signalingUrl ?? "",
    ]).map((url) => url.replace(/\/+$/, ""));
    this.signalingEndpoints =
      configuredSignalingUrls.length > 0 ? configuredSignalingUrls : ["http://localhost:4510"];
    this.signalingUrl = this.signalingEndpoints[0];
    this.room = (options.room ?? "silicaclaw-room").trim() || "silicaclaw-room";
    this.seedPeers = dedupeArray(options.seedPeers ?? []);
    this.bootstrapHints = dedupeArray(options.bootstrapHints ?? []);
    this.bootstrapSources =
      dedupeArray(options.bootstrapSources ?? []).length > 0
        ? dedupeArray(options.bootstrapSources ?? [])
        : [
            configuredSignalingUrls.length > 0
              ? "config:signaling_urls"
              : options.signalingUrl
                ? "config:signaling_url"
                : "default:signaling_url",
            options.room ? "config:room" : "default:room",
            this.seedPeers.length > 0 ? "config:seed_peers" : "default:seed_peers",
            this.bootstrapHints.length > 0 ? "config:bootstrap_hints" : "default:bootstrap_hints",
          ];
    this.maxMessageBytes = options.maxMessageBytes ?? 64 * 1024;
    this.pollIntervalMs = options.pollIntervalMs ?? 1200;
    this.maxFutureDriftMs = options.maxFutureDriftMs ?? 30_000;
    this.maxPastDriftMs = options.maxPastDriftMs ?? 120_000;
    this.discoveryEventsLimit = Math.max(10, options.discoveryEventsLimit ?? 200);
    this.envelopeCodec = new JsonMessageEnvelopeCodec();
    this.topicCodec = new JsonTopicCodec();
  }

  async start(): Promise<void> {
    if (this.started) return;

    this.wrtc = this.resolveWebRTCImplementation();
    if (!this.wrtc) {
      this.stats.start_errors += 1;
      throw new Error(
        "WebRTC runtime unavailable: RTCPeerConnection not found. In Node.js install `wrtc` and restart."
      );
    }

    this.started = true;
    try {
      await this.postJson("/join", { room: this.room, peer_id: this.peerId });
      await this.syncPeersFromSignaling();
      for (const seedPeer of this.seedPeers) {
        if (!seedPeer || seedPeer === this.peerId) continue;
        const session = this.ensureSession(seedPeer);
        if (this.isInitiatorFor(seedPeer) && this.shouldAttemptConnect(session)) {
          await this.attemptReconnect(session, "seed_peer_hint");
        }
      }
      this.poller = setInterval(() => {
        this.pollOnce().catch(() => {
          this.stats.signaling_errors += 1;
        });
      }, this.pollIntervalMs);
    } catch (error) {
      this.stats.start_errors += 1;
      this.started = false;
      throw new Error(`WebRTC preview start failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }

    for (const session of this.sessions.values()) {
      this.closePeerSession(session);
      this.recordDiscoveryEvent("peer_removed", {
        peer_id: session.peer_id,
        detail: "adapter_stop",
      });
    }
    this.sessions.clear();

    try {
      await this.postJson("/leave", { room: this.room, peer_id: this.peerId });
    } catch {
      this.stats.stop_errors += 1;
    }
  }

  async publish(topic: string, data: any): Promise<void> {
    if (!this.started) return;
    if (typeof topic !== "string" || !topic.trim() || topic.includes(":")) return;

    this.stats.publish_attempted += 1;

    const envelope: NetworkMessageEnvelope = {
      version: 1,
      message_id: randomUUID(),
      topic: `${this.namespace}:${topic}`,
      source_peer_id: this.peerId,
      timestamp: now(),
      payload: this.topicCodec.encode(topic, data),
    };

    const raw = this.envelopeCodec.encode(envelope);
    if (raw.length > this.maxMessageBytes) {
      this.stats.dropped_oversized += 1;
      return;
    }

    let sent = 0;
    for (const session of this.sessions.values()) {
      if (!session.channel || session.channel.readyState !== "open") continue;
      try {
        session.channel.send(new Uint8Array(raw));
        sent += 1;
      } catch {
        this.stats.signaling_errors += 1;
      }
    }
    if (sent > 0) {
      this.stats.publish_sent += 1;
    }
  }

  subscribe(topic: string, handler: (data: any) => void): void {
    if (typeof topic !== "string" || !topic.trim() || topic.includes(":")) return;
    const key = `${this.namespace}:${topic}`;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)?.add(handler);
  }

  getDiagnostics(): WebRTCDiagnostics {
    const connectionStates: StateSummary<WebRTCConnectionState> = {
      new: 0,
      connecting: 0,
      connected: 0,
      disconnected: 0,
      failed: 0,
      closed: 0,
      unknown: 0,
    };
    const dataStates: StateSummary<WebRTCDataChannelState> = {
      connecting: 0,
      open: 0,
      closing: 0,
      closed: 0,
      unknown: 0,
    };

    const items = Array.from(this.sessions.values()).map((session) => {
      connectionStates[session.connection_state] += 1;
      dataStates[session.datachannel_state] += 1;
      return {
        peer_id: session.peer_id,
        status: session.status,
        first_seen_at: session.first_seen_at,
        last_seen_at: session.last_seen_at,
        messages_seen: session.messages_seen,
        reconnect_attempts: session.reconnect_attempts,
        connection_state: session.connection_state,
        datachannel_state: session.datachannel_state,
      };
    });

    const online = items.filter((item) => item.status === "online").length;
    const activePeers = items.filter((item) => item.datachannel_state === "open").length;

    return {
      adapter: "webrtc-preview",
      peer_id: this.peerId,
      namespace: this.namespace,
      room: this.room,
      signaling_url: this.activeSignalingEndpoint || this.signalingUrl,
      signaling_endpoints: [...this.signalingEndpoints],
      bootstrap_sources: [...this.bootstrapSources],
      seed_peers_count: this.seedPeers.length,
      bootstrap_hints_count: this.bootstrapHints.length,
      discovery_events_total: this.discoveryEventsTotal,
      last_discovery_event_at: this.lastDiscoveryEventAt,
      discovery_events: [...this.discoveryEvents],
      connection_states_summary: connectionStates,
      datachannel_states_summary: dataStates,
      signaling_messages_sent_total: this.signalingMessagesSentTotal,
      signaling_messages_received_total: this.signalingMessagesReceivedTotal,
      reconnect_attempts_total: this.reconnectAttemptsTotal,
      active_webrtc_peers: activePeers,
      components: {
        transport: "WebRTCDataChannelTransport",
        discovery: "SignalingRoomPolling",
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
        total: items.length,
        online,
        stale: Math.max(0, items.length - online),
        items,
      },
      stats: { ...this.stats },
    };
  }

  private resolveWebRTCImplementation(): any | null {
    const g = globalThis as any;
    if (typeof g.RTCPeerConnection === "function") {
      return {
        RTCPeerConnection: g.RTCPeerConnection,
        RTCSessionDescription: g.RTCSessionDescription,
        RTCIceCandidate: g.RTCIceCandidate,
      };
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const wrtc = require("wrtc");
      return {
        RTCPeerConnection: wrtc.RTCPeerConnection,
        RTCSessionDescription: wrtc.RTCSessionDescription,
        RTCIceCandidate: wrtc.RTCIceCandidate,
      };
    } catch {
      return null;
    }
  }

  private async pollOnce(): Promise<void> {
    if (!this.started) return;

    await this.syncPeersFromSignaling();

    const response = await this.getJson(
      `/poll?room=${encodeURIComponent(this.room)}&peer_id=${encodeURIComponent(this.peerId)}`
    );

    const messages = Array.isArray(response?.messages) ? response.messages : [];
    for (const message of messages) {
      await this.handleSignalMessage(message);
    }

    this.cleanupProcessedSignalIds();

    const staleThreshold = now() - this.maxPastDriftMs;
    for (const session of this.sessions.values()) {
      if (session.last_seen_at < staleThreshold && session.status !== "stale") {
        session.status = "stale";
        this.recordDiscoveryEvent("peer_stale", {
          peer_id: session.peer_id,
          detail: "presence_timeout",
        });
      }
    }
  }

  private async syncPeersFromSignaling(): Promise<void> {
    const response = await this.getJson(`/peers?room=${encodeURIComponent(this.room)}`);
    const peers = Array.isArray(response?.peers)
      ? response.peers.map((peer: unknown) => String(peer)).filter(Boolean)
      : [];
    const seen = new Set<string>();

    for (const peerId of peers) {
      if (peerId === this.peerId) continue;
      seen.add(peerId);
      const session = this.ensureSession(peerId);
      session.last_seen_at = now();
      if (this.isInitiatorFor(peerId) && this.shouldAttemptConnect(session)) {
        await this.attemptReconnect(session, "sync_peers");
      }
    }

    for (const [peerId, session] of this.sessions.entries()) {
      if (!seen.has(peerId) && now() - session.last_seen_at > this.maxPastDriftMs) {
        this.closePeerSession(session);
        this.sessions.delete(peerId);
        this.recordDiscoveryEvent("peer_removed", {
          peer_id: peerId,
          detail: "stale_session_cleanup",
        });
      }
    }
  }

  private ensureSession(peerId: string): PeerSession {
    const existing = this.sessions.get(peerId);
    if (existing) return existing;
    const session: PeerSession = {
      peer_id: peerId,
      status: "connecting",
      first_seen_at: now(),
      last_seen_at: now(),
      messages_seen: 0,
      reconnect_attempts: 0,
      last_reconnect_attempt_at: 0,
      connection_state: "new",
      datachannel_state: "unknown",
      connection: null,
      channel: null,
      remote_description_set: false,
      pending_ice: [],
      seen_ice_keys: new Set(),
      last_offer_sdp: "",
      last_answer_sdp: "",
    };
    this.sessions.set(peerId, session);
    this.recordDiscoveryEvent("peer_joined", { peer_id: peerId });
    return session;
  }

  private shouldAttemptConnect(session: PeerSession): boolean {
    if (!this.started) return false;
    const cs = session.connection_state;
    if (session.channel && session.channel.readyState === "open") return false;
    if (!session.connection) return true;
    if (cs === "failed" || cs === "disconnected" || cs === "closed") return true;
    return false;
  }

  private async attemptReconnect(session: PeerSession, _reason: string): Promise<void> {
    const nowTs = now();
    if (nowTs - session.last_reconnect_attempt_at < 2000) {
      return;
    }
    session.last_reconnect_attempt_at = nowTs;
    session.reconnect_attempts += 1;
    this.reconnectAttemptsTotal += 1;
    this.recordDiscoveryEvent("reconnect_started", {
      peer_id: session.peer_id,
      detail: _reason,
    });

    try {
      this.closePeerSession(session);
      session.connection = this.createPeerConnection(session);

      if (this.isInitiatorFor(session.peer_id)) {
        const channel = session.connection.createDataChannel("silicaclaw");
        this.bindDataChannel(session, channel);
        const offer = await session.connection.createOffer();
        await session.connection.setLocalDescription(offer);
        session.last_offer_sdp = String(offer?.sdp ?? "");
        await this.sendSignal(session.peer_id, "offer", offer);
      }
    } catch (error) {
      this.recordDiscoveryEvent("reconnect_failed", {
        peer_id: session.peer_id,
        detail: error instanceof Error ? error.message : "reconnect_failed",
      });
      throw error;
    }
  }

  private createPeerConnection(session: PeerSession): any {
    const pc = new this.wrtc.RTCPeerConnection();
    session.connection_state = connectionStateOrUnknown(pc);

    pc.onconnectionstatechange = () => {
      session.connection_state = connectionStateOrUnknown(pc);
      session.last_seen_at = now();
      if (session.connection_state === "connected") {
        session.status = "online";
        if (session.reconnect_attempts > 0) {
          this.recordDiscoveryEvent("reconnect_succeeded", {
            peer_id: session.peer_id,
            detail: "connection_state_connected",
          });
        }
      }
      if (
        (session.connection_state === "failed" ||
          session.connection_state === "disconnected" ||
          session.connection_state === "closed") &&
        this.isInitiatorFor(session.peer_id)
      ) {
        this.attemptReconnect(session, "connection_state_change").catch(() => {
          this.stats.signaling_errors += 1;
          this.recordDiscoveryEvent("reconnect_failed", {
            peer_id: session.peer_id,
            detail: "connection_state_change",
          });
        });
      }
    };

    pc.onicecandidate = (event: any) => {
      if (!event?.candidate) return;
      this.sendSignal(session.peer_id, "candidate", event.candidate).catch(() => {
        this.stats.signaling_errors += 1;
      });
    };

    pc.ondatachannel = (event: any) => {
      this.bindDataChannel(session, event.channel);
    };

    return pc;
  }

  private bindDataChannel(session: PeerSession, channel: any): void {
    session.channel = channel;
    session.datachannel_state = dataChannelStateOrUnknown(channel);
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      session.datachannel_state = "open";
      session.status = "online";
      session.last_seen_at = now();
      if (session.reconnect_attempts > 0) {
        this.recordDiscoveryEvent("reconnect_succeeded", {
          peer_id: session.peer_id,
          detail: "datachannel_open",
        });
      }
    };

    channel.onclose = () => {
      session.datachannel_state = "closed";
      session.status = "stale";
      this.recordDiscoveryEvent("peer_stale", {
        peer_id: session.peer_id,
        detail: "datachannel_closed",
      });
      if (this.isInitiatorFor(session.peer_id)) {
        this.attemptReconnect(session, "datachannel_closed").catch(() => {
          this.stats.signaling_errors += 1;
        });
      }
    };

    channel.onerror = () => {
      this.stats.signaling_errors += 1;
      session.status = "stale";
    };

    channel.onmessage = (event: any) => {
      const buffer = toBuffer(event?.data);
      if (!buffer) {
        this.stats.dropped_decode_failed += 1;
        return;
      }
      this.onDataMessage(session, buffer);
    };
  }

  private async handleSignalMessage(message: any): Promise<void> {
    if (!message || typeof message !== "object") {
      this.stats.invalid_signaling_payload_total += 1;
      this.recordDiscoveryEvent("malformed_signal_dropped", { detail: "not_object" });
      return;
    }

    const signalId = String(message.id ?? "");
    if (signalId) {
      const already = this.processedSignalIds.get(signalId);
      if (already) {
        this.recordDiscoveryEvent("duplicate_signal_dropped", { detail: "duplicate_signal_id" });
        return;
      }
      this.processedSignalIds.set(signalId, now());
    }

    const fromPeerId = String(message.from_peer_id ?? "");
    const type = String(message.type ?? "");
    const payload = message.payload;
    if (!fromPeerId || fromPeerId === this.peerId || !type) {
      this.stats.invalid_signaling_payload_total += 1;
      this.recordDiscoveryEvent("malformed_signal_dropped", { detail: "missing_required_fields" });
      return;
    }

    this.signalingMessagesReceivedTotal += 1;

    const session = this.ensureSession(fromPeerId);
    session.last_seen_at = now();

    if (!session.connection) {
      session.connection = this.createPeerConnection(session);
    }
    const pc = session.connection;

    try {
      if (type === "offer") {
        const sdp = String(payload?.sdp ?? "");
        if (!sdp) {
          this.stats.invalid_signaling_payload_total += 1;
          this.recordDiscoveryEvent("malformed_signal_dropped", {
            peer_id: fromPeerId,
            detail: "offer_missing_sdp",
          });
          return;
        }
        if (session.last_offer_sdp === sdp) {
          this.stats.duplicate_sdp_total += 1;
          this.recordDiscoveryEvent("duplicate_signal_dropped", {
            peer_id: fromPeerId,
            detail: "duplicate_offer_sdp",
          });
          return;
        }
        session.last_offer_sdp = sdp;

        await pc.setRemoteDescription(new this.wrtc.RTCSessionDescription(payload));
        session.remote_description_set = true;
        await this.flushBufferedIce(session);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        session.last_answer_sdp = String(answer?.sdp ?? "");
        await this.sendSignal(fromPeerId, "answer", answer);
        return;
      }

      if (type === "answer") {
        const sdp = String(payload?.sdp ?? "");
        if (!sdp) {
          this.stats.invalid_signaling_payload_total += 1;
          this.recordDiscoveryEvent("malformed_signal_dropped", {
            peer_id: fromPeerId,
            detail: "answer_missing_sdp",
          });
          return;
        }
        if (session.last_answer_sdp === sdp) {
          this.stats.duplicate_sdp_total += 1;
          this.recordDiscoveryEvent("duplicate_signal_dropped", {
            peer_id: fromPeerId,
            detail: "duplicate_answer_sdp",
          });
          return;
        }
        session.last_answer_sdp = sdp;

        await pc.setRemoteDescription(new this.wrtc.RTCSessionDescription(payload));
        session.remote_description_set = true;
        await this.flushBufferedIce(session);
        return;
      }

      if (type === "candidate") {
        const key = iceKey(payload);
        if (!key || key === "{}") {
          this.stats.invalid_signaling_payload_total += 1;
          this.recordDiscoveryEvent("malformed_signal_dropped", {
            peer_id: fromPeerId,
            detail: "candidate_missing_fields",
          });
          return;
        }
        if (session.seen_ice_keys.has(key)) {
          this.stats.duplicate_ice_total += 1;
          this.recordDiscoveryEvent("duplicate_signal_dropped", {
            peer_id: fromPeerId,
            detail: "duplicate_ice_candidate",
          });
          return;
        }
        session.seen_ice_keys.add(key);

        if (!session.remote_description_set) {
          session.pending_ice.push(payload);
          return;
        }
        await pc.addIceCandidate(new this.wrtc.RTCIceCandidate(payload));
        return;
      }

      this.stats.invalid_signaling_payload_total += 1;
      this.recordDiscoveryEvent("malformed_signal_dropped", {
        peer_id: fromPeerId,
        detail: `unsupported_signal_type:${type}`,
      });
    } catch {
      this.stats.signaling_errors += 1;
    }
  }

  private async flushBufferedIce(session: PeerSession): Promise<void> {
    if (!session.connection || !session.pending_ice.length) return;
    const pending = [...session.pending_ice];
    session.pending_ice = [];
    for (const candidate of pending) {
      try {
        await session.connection.addIceCandidate(new this.wrtc.RTCIceCandidate(candidate));
      } catch {
        this.stats.signaling_errors += 1;
      }
    }
  }

  private onDataMessage(session: PeerSession, raw: Buffer): void {
    this.stats.received_total += 1;
    session.last_seen_at = now();
    session.messages_seen += 1;

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

    if (envelope.source_peer_id === this.peerId) {
      this.stats.dropped_self += 1;
      return;
    }

    if (!envelope.topic.startsWith(`${this.namespace}:`)) {
      this.stats.dropped_namespace_mismatch += 1;
      return;
    }

    const handlers = this.handlers.get(envelope.topic);
    if (!handlers || handlers.size === 0) return;

    const logicalTopic = envelope.topic.slice(`${this.namespace}:`.length);

    try {
      const payload = this.topicCodec.decode(logicalTopic, envelope.payload);
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

  private cleanupProcessedSignalIds(): void {
    const threshold = now() - this.maxPastDriftMs;
    for (const [id, ts] of this.processedSignalIds.entries()) {
      if (ts < threshold) {
        this.processedSignalIds.delete(id);
      }
    }
  }

  private isInitiatorFor(peerId: string): boolean {
    return this.peerId < peerId;
  }

  private closePeerSession(session: PeerSession): void {
    try {
      session.channel?.close?.();
    } catch {
      this.stats.stop_errors += 1;
    }
    try {
      session.connection?.close?.();
    } catch {
      this.stats.stop_errors += 1;
    }
    session.channel = null;
    session.connection = null;
    session.datachannel_state = "closed";
    session.connection_state = "closed";
    session.remote_description_set = false;
    session.pending_ice = [];
    session.seen_ice_keys.clear();
  }

  private async sendSignal(toPeerId: string, type: "offer" | "answer" | "candidate", payload: unknown): Promise<void> {
    this.signalingMessagesSentTotal += 1;
    await this.postJson("/signal", {
      id: randomUUID(),
      room: this.room,
      from_peer_id: this.peerId,
      to_peer_id: toPeerId,
      type,
      payload,
    });
  }

  private async postJson(path: string, body: Record<string, unknown>): Promise<any> {
    return this.requestJson("POST", path, body);
  }

  private async getJson(path: string): Promise<any> {
    return this.requestJson("GET", path);
  }

  private async requestJson(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<any> {
    const errors: string[] = [];
    for (let offset = 0; offset < this.signalingEndpoints.length; offset += 1) {
      const idx = (this.signalingIndex + offset) % this.signalingEndpoints.length;
      const endpoint = this.signalingEndpoints[idx];
      try {
        const res = await fetch(`${endpoint}${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        this.signalingIndex = idx;
        this.activeSignalingEndpoint = endpoint;
        this.markSignalingConnected(endpoint);
        return res.json().catch(() => ({}));
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${endpoint}(${errMsg})`);
        this.markSignalingDisconnected(endpoint, errMsg);
      }
    }
    this.stats.signaling_errors += 1;
    throw new Error(`Signaling ${method} ${path} failed: ${errors.join("; ")}`);
  }

  private markSignalingConnected(endpoint: string): void {
    if (this.signalingConnectivity.get(endpoint)) {
      return;
    }
    this.signalingConnectivity.set(endpoint, true);
    this.recordDiscoveryEvent("signaling_connected", { endpoint });
  }

  private markSignalingDisconnected(endpoint: string, detail: string): void {
    if (this.signalingConnectivity.get(endpoint) === false) {
      return;
    }
    this.signalingConnectivity.set(endpoint, false);
    this.recordDiscoveryEvent("signaling_disconnected", { endpoint, detail });
  }

  private recordDiscoveryEvent(type: DiscoveryEventType, extra: Omit<DiscoveryEvent, "id" | "type" | "at"> = {}): void {
    const event: DiscoveryEvent = {
      id: randomUUID(),
      type,
      at: now(),
      ...extra,
    };
    this.discoveryEvents.push(event);
    if (this.discoveryEvents.length > this.discoveryEventsLimit) {
      this.discoveryEvents.splice(0, this.discoveryEvents.length - this.discoveryEventsLimit);
    }
    this.discoveryEventsTotal += 1;
    this.lastDiscoveryEventAt = event.at;
  }
}
