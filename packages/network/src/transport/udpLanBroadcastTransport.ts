import dgram from "dgram";
import defaults from "../../../../config/silicaclaw-defaults.json";
import {
  NetworkTransport,
  TransportConfigSnapshot,
  TransportLifecycleState,
  TransportMessageMeta,
  TransportStats,
} from "../abstractions/transport";

type UdpLanBroadcastTransportOptions = {
  port?: number;
  bindAddress?: string;
  broadcastAddress?: string;
};

export class UdpLanBroadcastTransport implements NetworkTransport {
  private socket: dgram.Socket | null = null;
  private handlers = new Set<(data: Buffer, meta: TransportMessageMeta) => void>();
  private state: TransportLifecycleState = "stopped";
  private stats: TransportStats = {
    starts: 0,
    stops: 0,
    start_errors: 0,
    stop_errors: 0,
    sent_messages: 0,
    sent_bytes: 0,
    send_errors: 0,
    received_messages: 0,
    received_bytes: 0,
    receive_errors: 0,
    last_sent_at: 0,
    last_received_at: 0,
    last_error_at: 0,
  };

  private port: number;
  private bindAddress: string;
  private broadcastAddress: string;

  constructor(options: UdpLanBroadcastTransportOptions = {}) {
    this.port = options.port ?? defaults.ports.network_default;
    this.bindAddress = options.bindAddress ?? "0.0.0.0";
    this.broadcastAddress = options.broadcastAddress ?? "255.255.255.255";
  }

  async start(): Promise<void> {
    if (this.socket) {
      return;
    }
    this.state = "starting";

    this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket.on("error", () => {
      this.stats.receive_errors += 1;
      this.stats.last_error_at = Date.now();
      this.state = "error";
    });
    this.socket.on("message", (msg, rinfo) => {
      this.stats.received_messages += 1;
      this.stats.received_bytes += msg.length;
      this.stats.last_received_at = Date.now();
      const meta: TransportMessageMeta = {
        remote_address: rinfo.address,
        remote_port: rinfo.port,
        transport: "udp-lan-broadcast",
      };
      for (const handler of this.handlers) {
        try {
          handler(msg, meta);
        } catch {
          this.stats.receive_errors += 1;
          this.stats.last_error_at = Date.now();
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        this.state = "error";
        reject(new Error("Transport socket unavailable"));
        return;
      }

      this.socket.once("error", reject);
      this.socket.bind(this.port, this.bindAddress, () => {
        if (!this.socket) {
          this.state = "error";
          reject(new Error("Transport socket unavailable after bind"));
          return;
        }
        this.socket.setBroadcast(true);
        this.socket.off("error", reject);
        this.stats.starts += 1;
        this.state = "running";
        resolve();
      });
    }).catch((error) => {
      this.stats.start_errors += 1;
      this.stats.last_error_at = Date.now();
      this.state = "error";
      this.socket = null;
      throw error;
    });
  }

  async stop(): Promise<void> {
    if (!this.socket) {
      return;
    }
    this.state = "stopping";

    const socket = this.socket;
    this.socket = null;

    await new Promise<void>((resolve) => {
      socket.close(() => resolve());
    }).then(() => {
      this.stats.stops += 1;
      this.state = "stopped";
    }).catch((error) => {
      this.stats.stop_errors += 1;
      this.stats.last_error_at = Date.now();
      this.state = "error";
      throw error;
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
          this.stats.send_errors += 1;
          this.stats.last_error_at = Date.now();
          reject(error);
          return;
        }
        this.stats.sent_messages += 1;
        this.stats.sent_bytes += data.length;
        this.stats.last_sent_at = Date.now();
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

  getStats(): TransportStats {
    return { ...this.stats };
  }

  getConfig(): TransportConfigSnapshot {
    return {
      transport: "udp-lan-broadcast",
      state: this.state,
      bind_address: this.bindAddress,
      broadcast_address: this.broadcastAddress,
      port: this.port,
    };
  }
}
