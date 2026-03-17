import { NetworkMessageEnvelope } from "./messageEnvelope";

export type PeerStatus = "online" | "stale";

export type PeerSnapshot = {
  peer_id: string;
  first_seen_at: number;
  last_seen_at: number;
  status: PeerStatus;
  stale_since_at?: number;
  messages_seen: number;
  meta?: Record<string, unknown>;
};

export type PeerDiscoveryContext = {
  self_peer_id: string;
  publishControl: (topic: string, payload: unknown) => Promise<void>;
};

export interface PeerDiscovery {
  start(context: PeerDiscoveryContext): Promise<void>;
  stop(): Promise<void>;
  observeEnvelope(envelope: NetworkMessageEnvelope): void;
  listPeers(): PeerSnapshot[];
}
