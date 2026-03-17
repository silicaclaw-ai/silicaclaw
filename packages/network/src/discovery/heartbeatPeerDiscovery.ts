import { PeerDiscovery, PeerDiscoveryContext, PeerSnapshot } from "../abstractions/peerDiscovery";
import { NetworkMessageEnvelope } from "../abstractions/messageEnvelope";

type HeartbeatPeerDiscoveryOptions = {
  heartbeatIntervalMs?: number;
  staleAfterMs?: number;
  topic?: string;
};

export class HeartbeatPeerDiscovery implements PeerDiscovery {
  private peers = new Map<string, PeerSnapshot>();
  private timer: NodeJS.Timeout | null = null;
  private context: PeerDiscoveryContext | null = null;

  private heartbeatIntervalMs: number;
  private staleAfterMs: number;
  private topic: string;

  constructor(options: HeartbeatPeerDiscoveryOptions = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 12_000;
    this.staleAfterMs = options.staleAfterMs ?? 45_000;
    this.topic = options.topic ?? "__discovery/heartbeat";
  }

  async start(context: PeerDiscoveryContext): Promise<void> {
    this.context = context;
    await this.sendHeartbeat();

    this.timer = setInterval(async () => {
      await this.sendHeartbeat();
      this.evictStalePeers();
    }, this.heartbeatIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  observeEnvelope(envelope: NetworkMessageEnvelope): void {
    if (!this.context) {
      return;
    }
    if (envelope.source_peer_id === this.context.self_peer_id) {
      return;
    }

    this.peers.set(envelope.source_peer_id, {
      peer_id: envelope.source_peer_id,
      last_seen_at: Date.now(),
      meta: envelope.topic === this.topic && typeof envelope.payload === "object" && envelope.payload !== null
        ? (envelope.payload as Record<string, unknown>)
        : undefined,
    });
  }

  listPeers(): PeerSnapshot[] {
    this.evictStalePeers();
    return Array.from(this.peers.values()).sort((a, b) => b.last_seen_at - a.last_seen_at);
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.context) {
      return;
    }

    await this.context.publishControl(this.topic, {
      kind: "heartbeat",
      at: Date.now(),
    });
  }

  private evictStalePeers(): void {
    const now = Date.now();
    for (const [peerId, peer] of this.peers.entries()) {
      if (now - peer.last_seen_at > this.staleAfterMs) {
        this.peers.delete(peerId);
      }
    }
  }
}
