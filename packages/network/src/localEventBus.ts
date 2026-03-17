import { EventEmitter } from "events";
import { NetworkAdapter } from "./types";

type EventBusPayload = {
  topic: string;
  data: any;
};

const CHANNEL_NAME = "silicaclaw-local-event-bus";

function getNodeBus(): EventEmitter {
  const g = globalThis as typeof globalThis & {
    __silicaclaw_bus?: EventEmitter;
  };
  if (!g.__silicaclaw_bus) {
    g.__silicaclaw_bus = new EventEmitter();
  }
  return g.__silicaclaw_bus;
}

export class LocalEventBusAdapter implements NetworkAdapter {
  private started = false;
  private emitter = getNodeBus();

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

    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage({ topic, data } satisfies EventBusPayload);
      channel.close();
      return;
    }

    setImmediate(() => this.emitter.emit(topic, data));
  }

  subscribe(topic: string, handler: (data: any) => void): void {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<EventBusPayload>) => {
        if (event.data?.topic === topic) {
          handler(event.data.data);
        }
      };
      return;
    }

    this.emitter.on(topic, handler);
  }
}
