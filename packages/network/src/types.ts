export interface NetworkAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(topic: string, data: any): Promise<void>;
  subscribe(topic: string, handler: (data: any) => void): void;
}
