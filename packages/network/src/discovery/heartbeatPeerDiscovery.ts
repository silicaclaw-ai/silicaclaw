import {
  PeerDiscovery,
  PeerDiscoveryConfigSnapshot,
  PeerDiscoveryContext,
  PeerDiscoveryStats,
  PeerSnapshot,
} from "../abstractions/peerDiscovery";
import { NetworkMessageEnvelope } from "../abstractions/messageEnvelope";

type HeartbeatPeerDiscoveryOptions = {
  heartbeatIntervalMs?: number;
  staleAfterMs?: number;
  removeAfterMs?: number;
  topic?: string;
};

export class HeartbeatPeerDiscovery implements PeerDiscovery {
  private peers = new Map<string, PeerSnapshot>();
  private timer: NodeJS.Timeout | null = null;
  private context: PeerDiscoveryContext | null = null;

  private heartbeatIntervalMs: number;
  private staleAfterMs: number;
  private removeAfterMs: number;
  private topic: string;
  private stats: PeerDiscoveryStats = {
    observe_calls: 0,
    peers_added: 0,
    peers_removed: 0,
    peers_marked_stale: 0,
    heartbeat_sent: 0,
    heartbeat_send_errors: 0,
    reconcile_runs: 0,
    last_observed_at: 0,
    last_heartbeat_at: 0,
    last_reconcile_at: 0,
    last_error_at: 0,
  };

  constructor(options: HeartbeatPeerDiscoveryOptions = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 12_000;
    this.staleAfterMs = options.staleAfterMs ?? 45_000;
    this.removeAfterMs = options.removeAfterMs ?? 180_000;
    this.topic = options.topic ?? "__discovery/heartbeat";
  }

  async start(context: PeerDiscoveryContext): Promise<void> {
    this.context = context;
    this.reconcilePeerHealth();
    await this.sendHeartbeat();

    this.timer = setInterval(async () => {
      await this.sendHeartbeat();
      this.reconcilePeerHealth();
    }, this.heartbeatIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  observeEnvelope(envelope: NetworkMessageEnvelope): void {
    this.stats.observe_calls += 1;
    this.stats.last_observed_at = Date.now();

    if (!this.context) {
      return;
    }
    if (envelope.source_peer_id === this.context.self_peer_id) {
      return;
    }

    const now = Date.now();
    const existing = this.peers.get(envelope.source_peer_id);
    if (!existing) {
      this.stats.peers_added += 1;
    }

    this.peers.set(envelope.source_peer_id, {
      peer_id: envelope.source_peer_id,
      first_seen_at: existing?.first_seen_at ?? now,
      last_seen_at: now,
      status: "online",
      stale_since_at: undefined,
      messages_seen: (existing?.messages_seen ?? 0) + 1,
      meta:
        envelope.topic === this.topic && typeof envelope.payload === "object" && envelope.payload !== null
          ? (envelope.payload as Record<string, unknown>)
          : existing?.meta,
    });
  }

  listPeers(): PeerSnapshot[] {
    this.reconcilePeerHealth();
    return Array.from(this.peers.values()).sort((a, b) => {
      const score = (p: PeerSnapshot) => (p.status === "online" ? 1 : 0);
      const byStatus = score(b) - score(a);
      if (byStatus !== 0) {
        return byStatus;
      }
      return b.last_seen_at - a.last_seen_at;
    });
  }

  getStats(): PeerDiscoveryStats {
    return { ...this.stats };
  }

  getConfig(): PeerDiscoveryConfigSnapshot {
    return {
      discovery: "heartbeat-peer-discovery",
      heartbeat_topic: this.topic,
      heartbeat_interval_ms: this.heartbeatIntervalMs,
      stale_after_ms: this.staleAfterMs,
      remove_after_ms: this.removeAfterMs,
    };
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.context) {
      return;
    }
    try {
      await this.context.publishControl(this.topic, {
        kind: "heartbeat",
        at: Date.now(),
      });
      this.stats.heartbeat_sent += 1;
      this.stats.last_heartbeat_at = Date.now();
    } catch {
      this.stats.heartbeat_send_errors += 1;
      this.stats.last_error_at = Date.now();
    }
  }

  private reconcilePeerHealth(): void {
    const now = Date.now();
    this.stats.reconcile_runs += 1;
    this.stats.last_reconcile_at = now;
    for (const [peerId, peer] of this.peers.entries()) {
      const age = now - peer.last_seen_at;

      if (age > this.removeAfterMs) {
        this.peers.delete(peerId);
        this.stats.peers_removed += 1;
        continue;
      }

      if (age > this.staleAfterMs) {
        if (peer.status !== "stale") {
          this.stats.peers_marked_stale += 1;
        }
        this.peers.set(peerId, {
          ...peer,
          status: "stale",
          stale_since_at: peer.stale_since_at ?? now,
        });
        continue;
      }

      if (peer.status !== "online") {
        this.peers.set(peerId, {
          ...peer,
          status: "online",
          stale_since_at: undefined,
        });
      }
    }
  }
}
