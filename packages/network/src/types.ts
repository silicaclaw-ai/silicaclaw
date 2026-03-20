export interface NetworkAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(topic: string, data: any): Promise<void>;
  subscribe(topic: string, handler: (data: any) => void): void;
  sendDirect?(peerId: string, topic: string, data: any): Promise<void>;
  subscribeDirect?(topic: string, handler: (data: any, meta?: { peerId?: string }) => void): void;
}
