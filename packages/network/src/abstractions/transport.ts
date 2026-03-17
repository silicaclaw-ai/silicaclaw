export type TransportMessageMeta = {
  remote_address: string;
  remote_port: number;
  transport: string;
};

export type TransportLifecycleState = "stopped" | "starting" | "running" | "stopping" | "error";

export type TransportStats = {
  starts: number;
  stops: number;
  start_errors: number;
  stop_errors: number;
  sent_messages: number;
  sent_bytes: number;
  send_errors: number;
  received_messages: number;
  received_bytes: number;
  receive_errors: number;
  last_sent_at: number;
  last_received_at: number;
  last_error_at: number;
};

export type TransportConfigSnapshot = {
  transport: string;
  state: TransportLifecycleState;
  bind_address?: string;
  broadcast_address?: string;
  port?: number;
};

export interface NetworkTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(data: Buffer): Promise<void>;
  onMessage(handler: (data: Buffer, meta: TransportMessageMeta) => void): () => void;
  getStats?(): TransportStats;
  getConfig?(): TransportConfigSnapshot;
}
