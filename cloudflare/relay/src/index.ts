export interface Env {
  ROOM_RELAY: DurableObjectNamespace;
}

type RoomState = {
  peers: Record<string, { last_seen_at: number }>;
  queues: Record<string, any[]>;
  relay_queues: Record<string, any[]>;
  direct_queue_sizes: Record<string, number>;
  recent_relay_messages: Array<{
    id: string;
    room: string;
    from_peer_id: string;
    envelope: unknown;
    at: number;
  }>;
  signal_fingerprints: Record<string, number>;
};

const PEER_STALE_MS = 120_000;
const SIGNAL_DEDUPE_WINDOW_MS = 60_000;
const TOUCH_WRITE_INTERVAL_MS = 30_000;
const RELAY_MESSAGE_BACKLOG_MAX_AGE_MS = 10 * 60_000;
const RELAY_MESSAGE_BACKLOG_MAX_ITEMS = 200;
const RELAY_QUEUE_MAX_ITEMS_PER_PEER = 500;

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
    direct_queue_sizes: {},
    recent_relay_messages: [],
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

function directQueueStorageKey(peerId: string): string {
  return `direct-queue:${peerId}`;
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
    await this.cleanup(state);

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
          direct_queue_size: state.direct_queue_sizes[peerId] ?? 0,
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
          direct_queue_size: state.direct_queue_sizes[peerId] ?? 0,
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
      const directMessages = await this.loadDirectQueue(peerId);
      state.relay_queues[peerId] = [];
      state.direct_queue_sizes[peerId] = 0;
      if (touched || messages.length > 0 || directMessages.length > 0) {
        await Promise.all([
          this.persist(state),
          this.clearDirectQueue(peerId),
        ]);
      }
      return json({ ok: true, messages, direct_messages: directMessages, peers: Object.keys(state.peers) });
    }

    if (request.method === "GET" && url.pathname === "/direct/poll") {
      const peerId = String(url.searchParams.get("peer_id") || "").trim();
      if (!peerId) return json({ ok: false, error: "missing_peer_id" }, { status: 400 });
      const touched = this.touchPeer(state, peerId);
      const messages = await this.loadDirectQueue(peerId);
      state.direct_queue_sizes[peerId] = 0;
      if (touched || messages.length > 0) {
        await Promise.all([
          this.persist(state),
          this.clearDirectQueue(peerId),
        ]);
      }
      return json({ ok: true, messages, peers: Object.keys(state.peers) });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const roomId = roomName(String(body.room || ""));

    if (request.method === "POST" && url.pathname === "/join") {
      const peerId = String(body.peer_id || "").trim();
      if (!peerId) return json({ ok: false, error: "missing_peer_id" }, { status: 400 });
      const knownPeer = Boolean(state.peers[peerId]);
      this.touchPeer(state, peerId);
      if (!knownPeer) {
        state.relay_queues[peerId] = this.buildRelayBacklogForPeer(state, peerId);
      }
      await this.persist(state);
      return json({ ok: true, peers: Object.keys(state.peers), room: roomId });
    }

    if (request.method === "POST" && url.pathname === "/leave") {
      const peerId = String(body.peer_id || "").trim();
      if (peerId) {
        delete state.peers[peerId];
        delete state.queues[peerId];
        delete state.relay_queues[peerId];
        delete state.direct_queue_sizes[peerId];
      }
      await Promise.all([
        this.persist(state),
        peerId ? this.clearDirectQueue(peerId) : Promise.resolve(),
      ]);
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
      const relayMessage = {
        id: String(body.id || crypto.randomUUID()),
        room: roomId,
        from_peer_id: peerId,
        envelope,
        at: now(),
      };
      let delivered = 0;
      for (const targetPeerId of Object.keys(state.peers)) {
        if (targetPeerId === peerId) continue;
        if (!state.relay_queues[targetPeerId]) state.relay_queues[targetPeerId] = [];
        state.relay_queues[targetPeerId].push(relayMessage);
        if (state.relay_queues[targetPeerId].length > RELAY_QUEUE_MAX_ITEMS_PER_PEER) {
          state.relay_queues[targetPeerId] = state.relay_queues[targetPeerId].slice(-RELAY_QUEUE_MAX_ITEMS_PER_PEER);
        }
        delivered += 1;
      }
      state.recent_relay_messages.push(relayMessage);
      this.trimRelayBacklog(state);
      await this.persist(state);
      return json({ ok: true, delivered_to: delivered });
    }

    if (request.method === "POST" && url.pathname === "/direct/send") {
      const fromPeerId = String(body.from_peer_id || "").trim();
      const toPeerId = String(body.to_peer_id || "").trim();
      const envelope = body.envelope;
      if (!fromPeerId || !toPeerId || typeof envelope !== "object" || envelope === null) {
        return json({ ok: false, error: "invalid_direct_payload" }, { status: 400 });
      }
      this.touchPeer(state, fromPeerId);
      this.touchPeer(state, toPeerId);
      const queue = await this.loadDirectQueue(toPeerId);
      queue.push({
        id: String(body.id || crypto.randomUUID()),
        room: roomId,
        from_peer_id: fromPeerId,
        to_peer_id: toPeerId,
        envelope,
        at: now(),
      });
      const trimmedQueue = this.trimDirectQueue(queue);
      state.direct_queue_sizes[toPeerId] = trimmedQueue.length;
      await Promise.all([
        this.persist(state),
        this.saveDirectQueue(toPeerId, trimmedQueue),
      ]);
      return json({ ok: true, delivered_to: 1 });
    }

    return json({ ok: false, error: "not_found" }, { status: 404 });
  }

  private async loadState(): Promise<RoomState> {
    const raw = await this.storage.get<Partial<RoomState>>("room-state");
    if (!raw) {
      return emptyState();
    }
    const directQueueSizes =
      raw.direct_queue_sizes && typeof raw.direct_queue_sizes === "object" ? raw.direct_queue_sizes : {};
    const legacyDirectQueues =
      raw.direct_queues && typeof raw.direct_queues === "object" ? raw.direct_queues : {};
    const hasLegacyDirectQueues = Object.keys(legacyDirectQueues).length > 0;
    if (hasLegacyDirectQueues) {
      for (const [peerId, queue] of Object.entries(legacyDirectQueues)) {
        const trimmedQueue = this.trimDirectQueue(Array.isArray(queue) ? queue : []);
        directQueueSizes[peerId] = trimmedQueue.length;
        await this.saveDirectQueue(peerId, trimmedQueue);
      }
      const migratedState: RoomState = {
        peers: raw.peers && typeof raw.peers === "object" ? raw.peers : {},
        queues: raw.queues && typeof raw.queues === "object" ? raw.queues : {},
        relay_queues: raw.relay_queues && typeof raw.relay_queues === "object" ? raw.relay_queues : {},
        direct_queue_sizes: directQueueSizes,
        recent_relay_messages: Array.isArray(raw.recent_relay_messages) ? raw.recent_relay_messages : [],
        signal_fingerprints:
          raw.signal_fingerprints && typeof raw.signal_fingerprints === "object" ? raw.signal_fingerprints : {},
      };
      await this.persist(migratedState);
      return migratedState;
    }
    return {
      peers: raw.peers && typeof raw.peers === "object" ? raw.peers : {},
      queues: raw.queues && typeof raw.queues === "object" ? raw.queues : {},
      relay_queues: raw.relay_queues && typeof raw.relay_queues === "object" ? raw.relay_queues : {},
      direct_queue_sizes: directQueueSizes,
      recent_relay_messages: Array.isArray(raw.recent_relay_messages) ? raw.recent_relay_messages : [],
      signal_fingerprints:
        raw.signal_fingerprints && typeof raw.signal_fingerprints === "object" ? raw.signal_fingerprints : {},
    };
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
    if (!Number.isFinite(state.direct_queue_sizes[peerId])) state.direct_queue_sizes[peerId] = 0;
    return shouldWrite;
  }

  private async cleanup(state: RoomState): Promise<void> {
    const peerThreshold = now() - PEER_STALE_MS;
    const relayQueueCutoff = now() - RELAY_MESSAGE_BACKLOG_MAX_AGE_MS;
    const directQueuePeersToDelete: string[] = [];
    const directQueuePeersToTrim: string[] = [];
    let changed = false;
    for (const [peerId, peer] of Object.entries(state.peers)) {
      if (peer.last_seen_at < peerThreshold) {
        delete state.peers[peerId];
        delete state.queues[peerId];
        delete state.relay_queues[peerId];
        delete state.direct_queue_sizes[peerId];
        directQueuePeersToDelete.push(peerId);
        changed = true;
        continue;
      }
      const relayQueue = Array.isArray(state.relay_queues[peerId]) ? state.relay_queues[peerId] : [];
      const trimmedRelayQueue = relayQueue
        .filter((message) => Number(message?.at || 0) >= relayQueueCutoff)
        .slice(-RELAY_QUEUE_MAX_ITEMS_PER_PEER);
      if (trimmedRelayQueue.length !== relayQueue.length) {
        changed = true;
      }
      state.relay_queues[peerId] = trimmedRelayQueue;
      directQueuePeersToTrim.push(peerId);
    }
    const dedupeThreshold = now() - SIGNAL_DEDUPE_WINDOW_MS;
    for (const [key, ts] of Object.entries(state.signal_fingerprints)) {
      if (ts < dedupeThreshold) {
        delete state.signal_fingerprints[key];
        changed = true;
      }
    }
    const previousBacklogLength = state.recent_relay_messages.length;
    this.trimRelayBacklog(state);
    if (state.recent_relay_messages.length !== previousBacklogLength) {
      changed = true;
    }
    for (const peerId of directQueuePeersToDelete) {
      await this.clearDirectQueue(peerId);
    }
    for (const peerId of directQueuePeersToTrim) {
      const queue = await this.loadDirectQueue(peerId);
      const trimmedQueue = this.trimDirectQueue(queue);
      state.direct_queue_sizes[peerId] = trimmedQueue.length;
      if (trimmedQueue.length !== queue.length) {
        changed = true;
      }
      await this.saveDirectQueue(peerId, trimmedQueue);
    }
    if (changed) {
      await this.persist(state);
    }
  }

  private buildRelayBacklogForPeer(state: RoomState, peerId: string) {
    return state.recent_relay_messages.filter((message) => message.from_peer_id !== peerId);
  }

  private trimRelayBacklog(state: RoomState): void {
    const cutoff = now() - RELAY_MESSAGE_BACKLOG_MAX_AGE_MS;
    state.recent_relay_messages = state.recent_relay_messages
      .filter((message) => message.at >= cutoff)
      .slice(-RELAY_MESSAGE_BACKLOG_MAX_ITEMS);
  }

  private trimDirectQueue(queue: any[]): any[] {
    const cutoff = now() - RELAY_MESSAGE_BACKLOG_MAX_AGE_MS;
    return queue
      .filter((message) => Number(message?.at || 0) >= cutoff)
      .slice(-RELAY_QUEUE_MAX_ITEMS_PER_PEER);
  }

  private async loadDirectQueue(peerId: string): Promise<any[]> {
    const raw = await this.storage.get<any[]>(directQueueStorageKey(peerId));
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw;
  }

  private async saveDirectQueue(peerId: string, queue: any[]): Promise<void> {
    if (!queue.length) {
      await this.clearDirectQueue(peerId);
      return;
    }
    await this.storage.put(directQueueStorageKey(peerId), queue);
  }

  private async clearDirectQueue(peerId: string): Promise<void> {
    await this.storage.delete(directQueueStorageKey(peerId));
  }
}
