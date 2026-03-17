import dgram from "dgram";
import { NetworkTransport, TransportMessageMeta } from "../abstractions/transport";

type UdpLanBroadcastTransportOptions = {
  port?: number;
  bindAddress?: string;
  broadcastAddress?: string;
};

export class UdpLanBroadcastTransport implements NetworkTransport {
  private socket: dgram.Socket | null = null;
  private handlers = new Set<(data: Buffer, meta: TransportMessageMeta) => void>();

  private port: number;
  private bindAddress: string;
  private broadcastAddress: string;

  constructor(options: UdpLanBroadcastTransportOptions = {}) {
    this.port = options.port ?? 44123;
    this.bindAddress = options.bindAddress ?? "0.0.0.0";
    this.broadcastAddress = options.broadcastAddress ?? "255.255.255.255";
  }

  async start(): Promise<void> {
    if (this.socket) {
      return;
    }

    this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket.on("message", (msg, rinfo) => {
      const meta: TransportMessageMeta = {
        remote_address: rinfo.address,
        remote_port: rinfo.port,
        transport: "udp-lan-broadcast",
      };
      for (const handler of this.handlers) {
        handler(msg, meta);
      }
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Transport socket unavailable"));
        return;
      }

      this.socket.once("error", reject);
      this.socket.bind(this.port, this.bindAddress, () => {
        if (!this.socket) {
          reject(new Error("Transport socket unavailable after bind"));
          return;
        }
        this.socket.setBroadcast(true);
        this.socket.off("error", reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;

    await new Promise<void>((resolve) => {
      socket.close(() => resolve());
    });
  }

  async send(data: Buffer): Promise<void> {
    if (!this.socket) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        resolve();
        return;
      }
      this.socket.send(data, this.port, this.broadcastAddress, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  onMessage(handler: (data: Buffer, meta: TransportMessageMeta) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
