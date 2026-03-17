export type TransportMessageMeta = {
  remote_address: string;
  remote_port: number;
  transport: string;
};

export interface NetworkTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(data: Buffer): Promise<void>;
  onMessage(handler: (data: Buffer, meta: TransportMessageMeta) => void): () => void;
}
