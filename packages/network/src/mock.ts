import { EventEmitter } from "events";
import { NetworkAdapter } from "./types";

const bus = new EventEmitter();

export class MockNetworkAdapter implements NetworkAdapter {
  private started = false;

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async publish(topic: string, data: any): Promise<void> {
    if (!this.started) {
      return;
    }
    setImmediate(() => bus.emit(topic, data));
  }

  subscribe(topic: string, handler: (data: any) => void): void {
    bus.on(topic, handler);
  }
}
