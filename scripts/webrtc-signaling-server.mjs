import http from 'http';
import { URL } from 'url';
import { randomUUID, createHash } from 'crypto';

const port = Number(process.env.PORT || process.env.WEBRTC_SIGNALING_PORT || 4510);
const PEER_STALE_MS = Number(process.env.WEBRTC_SIGNALING_PEER_STALE_MS || 120000);
const SIGNAL_DEDUPE_WINDOW_MS = Number(process.env.WEBRTC_SIGNALING_DEDUPE_WINDOW_MS || 60000);

/** @type {Map<string, {peers: Map<string, {last_seen_at:number}>, queues: Map<string, any[]>, relay_queues: Map<string, any[]>, signal_fingerprints: Map<string, number>}>} */
const rooms = new Map();

const counters = {
  join_total: 0,
  leave_total: 0,
  signal_total: 0,
  invalid_payload_total: 0,
  duplicate_signal_total: 0,
  stale_peers_cleaned_total: 0,
};

function getRoom(roomId) {
  const id = String(roomId || '').trim() || 'silicaclaw-room';
  if (!rooms.has(id)) {
    rooms.set(id, {
      peers: new Map(),
      queues: new Map(),
      relay_queues: new Map(),
      signal_fingerprints: new Map(),
    });
  }
  return rooms.get(id);
}

function now() {
  return Date.now();
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        raw = '';
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const threshold = now() - PEER_STALE_MS;
  for (const [peerId, peer] of room.peers.entries()) {
    if (peer.last_seen_at < threshold) {
      room.peers.delete(peerId);
      room.queues.delete(peerId);
      room.relay_queues.delete(peerId);
      counters.stale_peers_cleaned_total += 1;
    }
  }
  const dedupeThreshold = now() - SIGNAL_DEDUPE_WINDOW_MS;
  for (const [key, ts] of room.signal_fingerprints.entries()) {
    if (ts < dedupeThreshold) {
      room.signal_fingerprints.delete(key);
    }
  }
  if (room.peers.size === 0) {
    rooms.delete(roomId);
  }
}

function touchPeer(room, peerId) {
  if (!room.peers.has(peerId)) {
    room.peers.set(peerId, { last_seen_at: now() });
  } else {
    room.peers.get(peerId).last_seen_at = now();
  }
  if (!room.queues.has(peerId)) {
    room.queues.set(peerId, []);
  }
  if (!room.relay_queues.has(peerId)) {
    room.relay_queues.set(peerId, []);
  }
}

function isValidSignalPayload(body) {
  const from = String(body?.from_peer_id || '');
  const to = String(body?.to_peer_id || '');
  const type = String(body?.type || '');
  const payload = body?.payload;
  if (!from || !to || !type) return false;
  if (type !== 'offer' && type !== 'answer' && type !== 'candidate') return false;
  if (payload === undefined || payload === null) return false;
  return true;
}

function signalFingerprint(roomId, body) {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      room: roomId,
      from: body.from_peer_id,
      to: body.to_peer_id,
      type: body.type,
      payload: body.payload,
    }))
    .digest('hex');
  return `${roomId}:${digest}`;
}

setInterval(() => {
  for (const roomId of Array.from(rooms.keys())) {
    cleanupRoom(roomId);
  }
}, Math.max(5000, Math.floor(PEER_STALE_MS / 4))).unref();

const server = http.createServer(async (req, res) => {
  if (!req.url) return json(res, 400, { ok: false, error: 'missing_url' });
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  const url = new URL(req.url, `http://localhost:${port}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      rooms: rooms.size,
      counters,
      peer_stale_ms: PEER_STALE_MS,
      signal_dedupe_window_ms: SIGNAL_DEDUPE_WINDOW_MS,
    });
  }

  if (req.method === 'GET' && url.pathname === '/peers') {
    const roomId = String(url.searchParams.get('room') || 'silicaclaw-room');
    const room = getRoom(roomId);
    cleanupRoom(roomId);
    return json(res, 200, { ok: true, peers: Array.from(room.peers.keys()) });
  }

  if (req.method === 'GET' && url.pathname === '/poll') {
    const roomId = String(url.searchParams.get('room') || 'silicaclaw-room');
    const peerId = String(url.searchParams.get('peer_id') || '');
    if (!peerId) {
      counters.invalid_payload_total += 1;
      return json(res, 400, { ok: false, error: 'missing_peer_id' });
    }

    const room = getRoom(roomId);
    touchPeer(room, peerId);
    cleanupRoom(roomId);

    const queue = room.queues.get(peerId) || [];
    room.queues.set(peerId, []);
    return json(res, 200, { ok: true, messages: queue });
  }

  if (req.method === 'GET' && url.pathname === '/relay/poll') {
    const roomId = String(url.searchParams.get('room') || 'silicaclaw-room');
    const peerId = String(url.searchParams.get('peer_id') || '');
    if (!peerId) {
      counters.invalid_payload_total += 1;
      return json(res, 400, { ok: false, error: 'missing_peer_id' });
    }

    const room = getRoom(roomId);
    touchPeer(room, peerId);
    cleanupRoom(roomId);

    const queue = room.relay_queues.get(peerId) || [];
    room.relay_queues.set(peerId, []);
    return json(res, 200, { ok: true, messages: queue });
  }

  if (req.method === 'POST' && url.pathname === '/join') {
    const body = await parseBody(req);
    const roomId = String(body.room || 'silicaclaw-room');
    const peerId = String(body.peer_id || '');
    if (!peerId) {
      counters.invalid_payload_total += 1;
      return json(res, 400, { ok: false, error: 'missing_peer_id' });
    }

    const room = getRoom(roomId);
    touchPeer(room, peerId);
    counters.join_total += 1;

    return json(res, 200, { ok: true, peers: Array.from(room.peers.keys()) });
  }

  if (req.method === 'POST' && url.pathname === '/leave') {
    const body = await parseBody(req);
    const roomId = String(body.room || 'silicaclaw-room');
    const peerId = String(body.peer_id || '');
    const room = getRoom(roomId);

    if (peerId) {
      room.peers.delete(peerId);
      room.queues.delete(peerId);
      room.relay_queues.delete(peerId);
      counters.leave_total += 1;
    } else {
      counters.invalid_payload_total += 1;
    }

    cleanupRoom(roomId);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/signal') {
    const body = await parseBody(req);
    const roomId = String(body.room || 'silicaclaw-room');
    if (!isValidSignalPayload(body)) {
      counters.invalid_payload_total += 1;
      return json(res, 400, { ok: false, error: 'invalid_signal_payload' });
    }

    const room = getRoom(roomId);
    const fromPeerId = String(body.from_peer_id);
    const toPeerId = String(body.to_peer_id);

    touchPeer(room, fromPeerId);
    touchPeer(room, toPeerId);

    const fp = signalFingerprint(roomId, body);
    const existingTs = room.signal_fingerprints.get(fp);
    if (existingTs && now() - existingTs <= SIGNAL_DEDUPE_WINDOW_MS) {
      counters.duplicate_signal_total += 1;
      return json(res, 200, { ok: true, duplicate: true });
    }
    room.signal_fingerprints.set(fp, now());

    if (!room.queues.has(toPeerId)) room.queues.set(toPeerId, []);
    room.queues.get(toPeerId).push({
      id: String(body.id || randomUUID()),
      room: roomId,
      from_peer_id: fromPeerId,
      to_peer_id: toPeerId,
      type: String(body.type),
      payload: body.payload,
      at: now(),
    });

    counters.signal_total += 1;
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/relay/publish') {
    const body = await parseBody(req);
    const roomId = String(body.room || 'silicaclaw-room');
    const peerId = String(body.peer_id || '');
    const envelope = body.envelope;
    if (!peerId || typeof envelope !== 'object' || envelope === null) {
      counters.invalid_payload_total += 1;
      return json(res, 400, { ok: false, error: 'invalid_relay_payload' });
    }

    const room = getRoom(roomId);
    touchPeer(room, peerId);

    for (const targetPeerId of room.peers.keys()) {
      if (targetPeerId === peerId) continue;
      if (!room.relay_queues.has(targetPeerId)) room.relay_queues.set(targetPeerId, []);
      room.relay_queues.get(targetPeerId).push({
        id: String(body.id || randomUUID()),
        room: roomId,
        from_peer_id: peerId,
        envelope,
        at: now(),
      });
    }

    return json(res, 200, { ok: true, delivered_to: Math.max(0, room.peers.size - 1) });
  }

  return json(res, 404, { ok: false, error: 'not_found' });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`WebRTC signaling preview server running on http://localhost:${port}`);
});
