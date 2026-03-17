import { randomUUID } from "crypto";
import { NetworkAdapter } from "./types";
import { MessageEnvelopeCodec, NetworkMessageEnvelope } from "./abstractions/messageEnvelope";
import { TopicCodec } from "./abstractions/topicCodec";
import { NetworkTransport } from "./abstractions/transport";
import { PeerDiscovery, PeerSnapshot } from "./abstractions/peerDiscovery";
import { JsonMessageEnvelopeCodec } from "./codec/jsonMessageEnvelopeCodec";
import { JsonTopicCodec } from "./codec/jsonTopicCodec";
import { UdpLanBroadcastTransport } from "./transport/udpLanBroadcastTransport";
import { HeartbeatPeerDiscovery } from "./discovery/heartbeatPeerDiscovery";

type RealNetworkAdapterPreviewOptions = {
  peerId?: string;
  namespace?: string;
  transport?: NetworkTransport;
  envelopeCodec?: MessageEnvelopeCodec;
  topicCodec?: TopicCodec;
  peerDiscovery?: PeerDiscovery;
};

export class RealNetworkAdapterPreview implements NetworkAdapter {
  private started = false;
  private peerId: string;
  private namespace: string;
  private transport: NetworkTransport;
  private envelopeCodec: MessageEnvelopeCodec;
  private topicCodec: TopicCodec;
  private peerDiscovery: PeerDiscovery;

  private offTransportMessage: (() => void) | null = null;
  private handlers = new Map<string, Set<(data: any) => void>>();

  constructor(options: RealNetworkAdapterPreviewOptions = {}) {
    this.peerId = options.peerId ?? `peer-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.namespace = options.namespace ?? "silicaclaw.preview";
    this.transport = options.transport ?? new UdpLanBroadcastTransport();
    this.envelopeCodec = options.envelopeCodec ?? new JsonMessageEnvelopeCodec();
    this.topicCodec = options.topicCodec ?? new JsonTopicCodec();
    this.peerDiscovery = options.peerDiscovery ?? new HeartbeatPeerDiscovery();
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await this.transport.start();
    this.started = true;
    this.offTransportMessage = this.transport.onMessage((raw) => {
      this.onTransportMessage(raw);
    });

    try {
      await this.peerDiscovery.start({
        self_peer_id: this.peerId,
        publishControl: async (topic, payload) => {
          await this.publish(topic, payload);
        },
      });
    } catch (error) {
      this.started = false;
      if (this.offTransportMessage) {
        this.offTransportMessage();
        this.offTransportMessage = null;
      }
      await this.transport.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.peerDiscovery.stop();

    if (this.offTransportMessage) {
      this.offTransportMessage();
      this.offTransportMessage = null;
    }

    await this.transport.stop();
    this.started = false;
  }

  async publish(topic: string, data: any): Promise<void> {
    if (!this.started) {
      return;
    }

    const envelope: NetworkMessageEnvelope = {
      version: 1,
      message_id: randomUUID(),
      topic: this.topicKey(topic),
      source_peer_id: this.peerId,
      timestamp: Date.now(),
      payload: this.topicCodec.encode(topic, data),
    };

    const raw = this.envelopeCodec.encode(envelope);
    await this.transport.send(raw);
  }

  subscribe(topic: string, handler: (data: any) => void): void {
    const key = this.topicKey(topic);
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)?.add(handler);
  }

  listPeers(): PeerSnapshot[] {
    return this.peerDiscovery.listPeers();
  }

  private onTransportMessage(raw: Buffer): void {
    const decoded = this.envelopeCodec.decode(raw);
    if (!decoded) {
      return;
    }

    const { envelope } = decoded;
    if (typeof envelope.topic !== "string") {
      return;
    }

    this.peerDiscovery.observeEnvelope(envelope);

    if (envelope.source_peer_id === this.peerId) {
      return;
    }

    const topic = this.stripNamespace(envelope.topic);
    if (!topic) {
      return;
    }

    const handlers = this.handlers.get(envelope.topic);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const payload = this.topicCodec.decode(topic, envelope.payload);
    for (const handler of handlers) {
      handler(payload);
    }
  }

  private topicKey(topic: string): string {
    return `${this.namespace}:${topic}`;
  }

  private stripNamespace(topicKey: string): string | null {
    const prefix = `${this.namespace}:`;
    if (!topicKey.startsWith(prefix)) {
      return null;
    }
    return topicKey.slice(prefix.length);
  }
}
