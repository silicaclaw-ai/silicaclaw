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

export type PeerDiscoveryStats = {
  observe_calls: number;
  peers_added: number;
  peers_removed: number;
  peers_marked_stale: number;
  heartbeat_sent: number;
  heartbeat_send_errors: number;
  reconcile_runs: number;
  last_observed_at: number;
  last_heartbeat_at: number;
  last_reconcile_at: number;
  last_error_at: number;
};

export type PeerDiscoveryConfigSnapshot = {
  discovery: string;
  heartbeat_topic?: string;
  heartbeat_interval_ms?: number;
  stale_after_ms?: number;
  remove_after_ms?: number;
};

export interface PeerDiscovery {
  start(context: PeerDiscoveryContext): Promise<void>;
  stop(): Promise<void>;
  observeEnvelope(envelope: NetworkMessageEnvelope): void;
  listPeers(): PeerSnapshot[];
  getStats?(): PeerDiscoveryStats;
  getConfig?(): PeerDiscoveryConfigSnapshot;
}
