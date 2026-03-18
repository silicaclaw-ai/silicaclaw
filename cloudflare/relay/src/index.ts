export interface Env {
  ROOM_RELAY: DurableObjectNamespace;
}

type RoomState = {
  peers: Record<string, { last_seen_at: number }>;
  queues: Record<string, any[]>;
  relay_queues: Record<string, any[]>;
  signal_fingerprints: Record<string, number>;
};

const PEER_STALE_MS = 120_000;
const SIGNAL_DEDUPE_WINDOW_MS = 60_000;
const TOUCH_WRITE_INTERVAL_MS = 30_000;

function now(): number {
  return Date.now();
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function emptyState(): RoomState {
  return {
    peers: {},
    queues: {},
    relay_queues: {},
    signal_fingerprints: {},
  };
}

function roomName(raw: string | null | undefined): string {
  return String(raw || "").trim() || "silicaclaw-global-preview";
}

function signalFingerprint(roomId: string, body: Record<string, unknown>): string {
  const payload = JSON.stringify({
    room: roomId,
    from: body.from_peer_id,
    to: body.to_peer_id,
    type: body.type,
    payload: body.payload,
  });
  return `${roomId}:${payload}`;
}

function isValidSignalPayload(body: Record<string, unknown>): boolean {
  const from = String(body?.from_peer_id || "");
  const to = String(body?.to_peer_id || "");
  const type = String(body?.type || "");
  const payload = body?.payload;
  if (!from || !to || !type) return false;
  if (type !== "offer" && type !== "answer" && type !== "candidate") return false;
  if (payload === undefined || payload === null) return false;
  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return json({ ok: true });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, service: "silicaclaw-cloudflare-relay", durable_object: true });
    }

    const roomId = roomName(
      request.method === "GET" ? url.searchParams.get("room") : (await request.clone().json().catch(() => ({}))).room
    );
    const id = env.ROOM_RELAY.idFromName(roomId);
    const stub = env.ROOM_RELAY.get(id);
    return stub.fetch(request);
  },
};

export class RoomRelay {
  private storage: DurableObjectStorage;

  constructor(private readonly state: DurableObjectState) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return json({ ok: true });
    }

    const url = new URL(request.url);
    const state = await this.loadState();
    this.cleanup(state);

    if (request.method === "GET" && url.pathname === "/peers") {
      return json({
        ok: true,
        room: roomName(url.searchParams.get("room")),
        peer_count: Object.keys(state.peers).length,
        peers: Object.keys(state.peers),
        peer_details: Object.entries(state.peers).map(([peerId, peer]) => ({
          peer_id: peerId,
          last_seen_at: peer.last_seen_at,
          signal_queue_size: state.queues[peerId]?.length ?? 0,
          relay_queue_size: state.relay_queues[peerId]?.length ?? 0,
        })),
      });
    }

    if (request.method === "GET" && url.pathname === "/room") {
      return json({
        ok: true,
        room: roomName(url.searchParams.get("room")),
        peer_count: Object.keys(state.peers).length,
        peers: Object.entries(state.peers).map(([peerId, peer]) => ({
          peer_id: peerId,
          last_seen_at: peer.last_seen_at,
          signal_queue_size: state.queues[peerId]?.length ?? 0,
          relay_queue_size: state.relay_queues[peerId]?.length ?? 0,
        })),
      });
    }

    if (request.method === "GET" && url.pathname === "/poll") {
      const peerId = String(url.searchParams.get("peer_id") || "").trim();
      if (!peerId) return json({ ok: false, error: "missing_peer_id" }, { status: 400 });
      const touched = this.touchPeer(state, peerId);
      const messages = state.queues[peerId] || [];
      state.queues[peerId] = [];
      if (touched || messages.length > 0) {
        await this.persist(state);
      }
      return json({ ok: true, messages, peers: Object.keys(state.peers) });
    }

    if (request.method === "GET" && url.pathname === "/relay/poll") {
      const peerId = String(url.searchParams.get("peer_id") || "").trim();
      if (!peerId) return json({ ok: false, error: "missing_peer_id" }, { status: 400 });
      const touched = this.touchPeer(state, peerId);
      const messages = state.relay_queues[peerId] || [];
      state.relay_queues[peerId] = [];
      if (touched || messages.length > 0) {
        await this.persist(state);
      }
      return json({ ok: true, messages, peers: Object.keys(state.peers) });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const roomId = roomName(String(body.room || ""));

    if (request.method === "POST" && url.pathname === "/join") {
      const peerId = String(body.peer_id || "").trim();
      if (!peerId) return json({ ok: false, error: "missing_peer_id" }, { status: 400 });
      this.touchPeer(state, peerId);
      await this.persist(state);
      return json({ ok: true, peers: Object.keys(state.peers), room: roomId });
    }

    if (request.method === "POST" && url.pathname === "/leave") {
      const peerId = String(body.peer_id || "").trim();
      if (peerId) {
        delete state.peers[peerId];
        delete state.queues[peerId];
        delete state.relay_queues[peerId];
      }
      await this.persist(state);
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/signal") {
      if (!isValidSignalPayload(body)) {
        return json({ ok: false, error: "invalid_signal_payload" }, { status: 400 });
      }
      const fromPeerId = String(body.from_peer_id);
      const toPeerId = String(body.to_peer_id);
      this.touchPeer(state, fromPeerId);
      this.touchPeer(state, toPeerId);

      const fp = signalFingerprint(roomId, body);
      const existingTs = state.signal_fingerprints[fp];
      if (existingTs && now() - existingTs <= SIGNAL_DEDUPE_WINDOW_MS) {
        await this.persist(state);
        return json({ ok: true, duplicate: true });
      }
      state.signal_fingerprints[fp] = now();
      if (!state.queues[toPeerId]) state.queues[toPeerId] = [];
      state.queues[toPeerId].push({
        id: String(body.id || crypto.randomUUID()),
        room: roomId,
        from_peer_id: fromPeerId,
        to_peer_id: toPeerId,
        type: String(body.type),
        payload: body.payload,
        at: now(),
      });
      await this.persist(state);
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/relay/publish") {
      const peerId = String(body.peer_id || "").trim();
      const envelope = body.envelope;
      if (!peerId || typeof envelope !== "object" || envelope === null) {
        return json({ ok: false, error: "invalid_relay_payload" }, { status: 400 });
      }
      this.touchPeer(state, peerId);
      let delivered = 0;
      for (const targetPeerId of Object.keys(state.peers)) {
        if (targetPeerId === peerId) continue;
        if (!state.relay_queues[targetPeerId]) state.relay_queues[targetPeerId] = [];
        state.relay_queues[targetPeerId].push({
          id: String(body.id || crypto.randomUUID()),
          room: roomId,
          from_peer_id: peerId,
          envelope,
          at: now(),
        });
        delivered += 1;
      }
      await this.persist(state);
      return json({ ok: true, delivered_to: delivered });
    }

    return json({ ok: false, error: "not_found" }, { status: 404 });
  }

  private async loadState(): Promise<RoomState> {
    return (await this.storage.get<RoomState>("room-state")) || emptyState();
  }

  private async persist(state: RoomState): Promise<void> {
    await this.storage.put("room-state", state);
  }

  private touchPeer(state: RoomState, peerId: string): boolean {
    const ts = now();
    const previous = state.peers[peerId]?.last_seen_at ?? 0;
    const shouldWrite = !previous || ts - previous >= TOUCH_WRITE_INTERVAL_MS;
    state.peers[peerId] = { last_seen_at: shouldWrite ? ts : previous };
    if (!state.queues[peerId]) state.queues[peerId] = [];
    if (!state.relay_queues[peerId]) state.relay_queues[peerId] = [];
    return shouldWrite;
  }

  private cleanup(state: RoomState): void {
    const peerThreshold = now() - PEER_STALE_MS;
    for (const [peerId, peer] of Object.entries(state.peers)) {
      if (peer.last_seen_at < peerThreshold) {
        delete state.peers[peerId];
        delete state.queues[peerId];
        delete state.relay_queues[peerId];
      }
    }
    const dedupeThreshold = now() - SIGNAL_DEDUPE_WINDOW_MS;
    for (const [key, ts] of Object.entries(state.signal_fingerprints)) {
      if (ts < dedupeThreshold) {
        delete state.signal_fingerprints[key];
      }
    }
  }
}
