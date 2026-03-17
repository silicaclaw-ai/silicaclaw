import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { resolve } from "path";
import {
  AgentIdentity,
  DirectoryState,
  IndexRefRecord,
  PresenceRecord,
  ProfileInput,
  PublicProfile,
  SignedProfileRecord,
  buildIndexRecords,
  cleanupExpiredPresence,
  createDefaultProfileInput,
  createEmptyDirectoryState,
  createIdentity,
  dedupeIndex,
  ingestIndexRecord,
  ingestPresenceRecord,
  ingestProfileRecord,
  isAgentOnline,
  searchDirectory,
  signPresence,
  signProfile,
  verifyPresence,
  verifyProfile,
} from "@silicaclaw/core";
import {
  LocalEventBusAdapter,
  MockNetworkAdapter,
  NetworkAdapter,
  RealNetworkAdapterPreview,
  UdpLanBroadcastTransport,
} from "@silicaclaw/network";
import { CacheRepo, IdentityRepo, LogRepo, ProfileRepo } from "@silicaclaw/storage";

const BROADCAST_INTERVAL_MS = 10_000;
const PRESENCE_TTL_MS = Number(process.env.PRESENCE_TTL_MS || 30_000);

type ApiErrorShape = {
  code: string;
  message: string;
  details?: unknown;
};

type InitState = {
  identity_auto_created: boolean;
  profile_auto_created: boolean;
  initialized_at: number;
};

type SearchResult = PublicProfile & {
  last_seen_at: number;
  online: boolean;
};

class LocalNodeService {
  private identityRepo = new IdentityRepo(process.cwd());
  private profileRepo = new ProfileRepo(process.cwd());
  private cacheRepo = new CacheRepo(process.cwd());
  private logRepo = new LogRepo(process.cwd());

  private identity: AgentIdentity | null = null;
  private profile: PublicProfile | null = null;
  private directory: DirectoryState = createEmptyDirectoryState();

  private receivedCount = 0;
  private broadcastCount = 0;
  private lastMessageAt = 0;
  private lastBroadcastAt = 0;
  private broadcaster: NodeJS.Timeout | null = null;
  private broadcastEnabled = true;

  private receivedByTopic: Record<string, number> = {};
  private publishedByTopic: Record<string, number> = {};

  private initState: InitState = {
    identity_auto_created: false,
    profile_auto_created: false,
    initialized_at: 0,
  };

  private network: NetworkAdapter;
  private adapterMode: "mock" | "local-event-bus" | "real-preview";
  private networkNamespace: string;
  private networkPort: number | null;

  constructor() {
    this.networkNamespace = process.env.NETWORK_NAMESPACE || "silicaclaw.preview";
    this.networkPort = Number(process.env.NETWORK_PORT || 44123);

    const mode = process.env.NETWORK_ADAPTER;
    if (mode === "mock") {
      this.network = new MockNetworkAdapter();
      this.adapterMode = "mock";
      this.networkPort = null;
      return;
    }
    if (mode === "real-preview") {
      this.network = new RealNetworkAdapterPreview({
        namespace: this.networkNamespace,
        transport: new UdpLanBroadcastTransport({
          port: this.networkPort,
        }),
      });
      this.adapterMode = "real-preview";
      return;
    }
    this.network = new LocalEventBusAdapter();
    this.adapterMode = "local-event-bus";
    this.networkPort = null;
  }

  async start(): Promise<void> {
    await this.hydrateFromDisk();

    await this.network.start();

    this.network.subscribe("profile", (data: SignedProfileRecord) => {
      this.onMessage("profile", data);
    });
    this.network.subscribe("presence", (data: PresenceRecord) => {
      this.onMessage("presence", data);
    });
    this.network.subscribe("index", (data: IndexRefRecord) => {
      this.onMessage("index", data);
    });

    this.startBroadcastLoop();
    await this.log("info", "Local node started");
  }

  async stop(): Promise<void> {
    if (this.broadcaster) {
      clearInterval(this.broadcaster);
      this.broadcaster = null;
    }
    await this.network.stop();
  }

  getOverview() {
    this.compactCacheInMemory();
    const profiles = Object.values(this.directory.profiles);
    const onlineCount = profiles.filter((profile) =>
      isAgentOnline(this.directory.presence[profile.agent_id], Date.now(), PRESENCE_TTL_MS)
    ).length;

    return {
      agent_id: this.identity?.agent_id ?? "",
      public_enabled: Boolean(this.profile?.public_enabled),
      broadcast_enabled: this.broadcastEnabled,
      last_broadcast_at: this.lastBroadcastAt,
      discovered_count: profiles.length,
      online_count: onlineCount,
      offline_count: Math.max(0, profiles.length - onlineCount),
      init_state: this.initState,
      presence_ttl_ms: PRESENCE_TTL_MS,
    };
  }

  getNetworkSummary() {
    const diagnostics = this.getRealAdapterDiagnostics();
    const peerCount = diagnostics?.peers.total ?? 0;

    return {
      status: "running",
      adapter: this.adapterMode,
      received_count: this.receivedCount,
      broadcast_count: this.broadcastCount,
      last_message_at: this.lastMessageAt,
      last_broadcast_at: this.lastBroadcastAt,
      received_by_topic: this.receivedByTopic,
      published_by_topic: this.publishedByTopic,
      peers_discovered: peerCount,
      namespace: diagnostics?.namespace ?? this.networkNamespace,
      port: this.networkPort,
      components: diagnostics?.components ?? {
        transport: "-",
        discovery: "-",
        envelope_codec: "-",
        topic_codec: "-",
      },
      real_preview_stats: diagnostics?.stats ?? null,
    };
  }

  getNetworkConfig() {
    const diagnostics = this.getRealAdapterDiagnostics();
    return {
      adapter: this.adapterMode,
      namespace: diagnostics?.namespace ?? this.networkNamespace,
      port: this.networkPort,
      components: diagnostics?.components ?? {
        transport: "-",
        discovery: "-",
        envelope_codec: "-",
        topic_codec: "-",
      },
      limits: diagnostics?.limits ?? null,
      demo_mode: this.adapterMode === "real-preview" ? "lan-preview" : "local-process",
    };
  }

  getNetworkStats() {
    const diagnostics = this.getRealAdapterDiagnostics();
    const peers = diagnostics?.peers.items ?? [];
    const online = peers.filter((peer) => peer.status === "online").length;

    return {
      adapter: this.adapterMode,
      message_counters: {
        received_total: this.receivedCount,
        broadcast_total: this.broadcastCount,
        last_message_at: this.lastMessageAt,
        last_broadcast_at: this.lastBroadcastAt,
        received_by_topic: this.receivedByTopic,
        published_by_topic: this.publishedByTopic,
      },
      peer_counters: {
        total: peers.length,
        online,
        stale: Math.max(0, peers.length - online),
      },
      adapter_stats: diagnostics?.stats ?? null,
    };
  }

  getPeersSummary() {
    const diagnostics = this.getRealAdapterDiagnostics();
    if (!diagnostics) {
      return {
        adapter: this.adapterMode,
        namespace: this.networkNamespace,
        total: 0,
        online: 0,
        stale: 0,
        items: [],
        stats: null,
      };
    }
    return {
      adapter: diagnostics.adapter,
      namespace: diagnostics.namespace,
      total: diagnostics.peers.total,
      online: diagnostics.peers.online,
      stale: diagnostics.peers.stale,
      items: diagnostics.peers.items,
      stats: diagnostics.stats,
      components: diagnostics.components,
      limits: diagnostics.limits,
    };
  }

  getDirectory(): DirectoryState {
    this.compactCacheInMemory();
    return this.directory;
  }

  search(keyword: string): SearchResult[] {
    this.compactCacheInMemory();
    return searchDirectory(this.directory, keyword, { presenceTTLms: PRESENCE_TTL_MS }).map((profile) => {
      const lastSeenAt = this.directory.presence[profile.agent_id] ?? 0;
      return {
        ...profile,
        last_seen_at: lastSeenAt,
        online: isAgentOnline(lastSeenAt, Date.now(), PRESENCE_TTL_MS),
      };
    });
  }

  getProfile(): PublicProfile | null {
    return this.profile;
  }

  getIdentity(): AgentIdentity | null {
    return this.identity;
  }

  async getLogs() {
    return this.logRepo.get();
  }

  async ensureIdentity(): Promise<AgentIdentity> {
    if (this.identity) {
      return this.identity;
    }
    const identity = createIdentity();
    this.identity = identity;
    await this.identityRepo.set(identity);
    this.initState.identity_auto_created = true;

    const seededProfile = signProfile(createDefaultProfileInput(identity.agent_id), identity);
    this.profile = seededProfile;
    await this.profileRepo.set(seededProfile);
    this.initState.profile_auto_created = true;

    await this.log("info", `Identity created automatically: ${identity.agent_id.slice(0, 12)}`);
    return identity;
  }

  async updateProfile(input: Partial<ProfileInput>): Promise<PublicProfile> {
    const identity = await this.ensureIdentity();
    const base = this.profile ?? signProfile(createDefaultProfileInput(identity.agent_id), identity);

    const next = signProfile(
      {
        agent_id: identity.agent_id,
        display_name: input.display_name ?? base.display_name,
        bio: input.bio ?? base.bio,
        tags: input.tags ?? base.tags,
        avatar_url: input.avatar_url ?? base.avatar_url,
        public_enabled: input.public_enabled ?? base.public_enabled,
      },
      identity
    );

    this.profile = next;
    this.directory = ingestProfileRecord(this.directory, { type: "profile", profile: next });
    await this.profileRepo.set(next);
    await this.persistCache();
    await this.log("info", `Profile updated (public=${next.public_enabled})`);

    if (next.public_enabled && this.broadcastEnabled) {
      await this.broadcastNow("profile_update");
    }

    return next;
  }

  async refreshCache() {
    const removed = this.compactCacheInMemory();
    await this.persistCache();
    await this.log("info", `Cache refreshed (expired presence removed=${removed})`);
    return {
      removed_presence: removed,
      profile_count: Object.keys(this.directory.profiles).length,
      index_key_count: Object.keys(this.directory.index).length,
    };
  }

  async setBroadcastEnabled(enabled: boolean) {
    this.broadcastEnabled = enabled;
    if (enabled) {
      this.startBroadcastLoop();
      await this.log("info", "Broadcast loop enabled");
      if (this.profile?.public_enabled) {
        await this.broadcastNow("manual_start");
      }
    } else {
      if (this.broadcaster) {
        clearInterval(this.broadcaster);
        this.broadcaster = null;
      }
      await this.log("warn", "Broadcast loop paused");
    }
    return { broadcast_enabled: this.broadcastEnabled };
  }

  async broadcastNow(reason = "manual"): Promise<{ sent: boolean; reason: string }> {
    if (!this.identity || !this.profile) {
      return { sent: false, reason: "missing_identity_or_profile" };
    }
    if (!this.profile.public_enabled) {
      return { sent: false, reason: "public_disabled" };
    }
    if (!this.broadcastEnabled) {
      return { sent: false, reason: "broadcast_paused" };
    }

    const profileRecord: SignedProfileRecord = {
      type: "profile",
      profile: this.profile,
    };
    const presenceRecord = signPresence(this.identity, Date.now());
    const indexRecords = buildIndexRecords(this.profile);

    await this.publish("profile", profileRecord);
    await this.publish("presence", presenceRecord);
    for (const record of indexRecords) {
      await this.publish("index", record);
    }

    this.lastBroadcastAt = Date.now();
    this.broadcastCount += 1;

    this.directory = ingestProfileRecord(this.directory, profileRecord);
    this.directory = ingestPresenceRecord(this.directory, presenceRecord);
    for (const record of indexRecords) {
      this.directory = ingestIndexRecord(this.directory, record);
    }
    this.compactCacheInMemory();
    await this.persistCache();

    await this.log("info", `Broadcast sent (${indexRecords.length} index refs, reason=${reason})`);
    return { sent: true, reason };
  }

  private async hydrateFromDisk(): Promise<void> {
    this.initState = {
      identity_auto_created: false,
      profile_auto_created: false,
      initialized_at: Date.now(),
    };

    this.identity = await this.identityRepo.get();
    if (!this.identity) {
      this.identity = createIdentity();
      this.initState.identity_auto_created = true;
      await this.identityRepo.set(this.identity);
      await this.log("info", "identity.json missing, auto-generated identity");
    }

    this.profile = await this.profileRepo.get();
    if (!this.profile || this.profile.agent_id !== this.identity.agent_id) {
      this.profile = signProfile(createDefaultProfileInput(this.identity.agent_id), this.identity);
      this.initState.profile_auto_created = true;
      await this.profileRepo.set(this.profile);
      await this.log("info", "profile.json missing/invalid, auto-generated default profile");
    }

    this.directory = dedupeIndex(await this.cacheRepo.get());
    this.directory = ingestProfileRecord(this.directory, { type: "profile", profile: this.profile });
    this.compactCacheInMemory();
    await this.persistCache();
  }

  private async onMessage(topic: "profile" | "presence" | "index", data: unknown): Promise<void> {
    this.receivedCount += 1;
    this.receivedByTopic[topic] = (this.receivedByTopic[topic] ?? 0) + 1;
    this.lastMessageAt = Date.now();

    if (topic === "profile") {
      const record = data as SignedProfileRecord;
      if (!record?.profile?.agent_id || !record?.profile?.signature) {
        return;
      }

      if (record.profile.agent_id === this.identity?.agent_id && this.identity) {
        if (!verifyProfile(record.profile, this.identity.public_key)) {
          await this.log("warn", "Rejected self profile with invalid signature");
          return;
        }
      }

      this.directory = ingestProfileRecord(this.directory, record);
      this.compactCacheInMemory();
      await this.persistCache();
      return;
    }

    if (topic === "presence") {
      const record = data as PresenceRecord;
      if (!record?.agent_id || !record?.signature || typeof record.timestamp !== "number") {
        return;
      }

      if (record.agent_id === this.identity?.agent_id && this.identity) {
        if (!verifyPresence(record, this.identity.public_key)) {
          await this.log("warn", "Rejected invalid self presence signature");
          return;
        }
      }

      this.directory = ingestPresenceRecord(this.directory, record);
      this.compactCacheInMemory();
      await this.persistCache();
      return;
    }

    const record = data as IndexRefRecord;
    if (!record?.key || !record?.agent_id) {
      return;
    }
    this.directory = ingestIndexRecord(this.directory, record);
    this.directory = dedupeIndex(this.directory);
    await this.persistCache();
  }

  private startBroadcastLoop(): void {
    if (this.broadcaster) {
      clearInterval(this.broadcaster);
    }

    if (!this.broadcastEnabled) {
      return;
    }

    this.broadcaster = setInterval(async () => {
      await this.broadcastNow("interval");
    }, BROADCAST_INTERVAL_MS);
  }

  private compactCacheInMemory(): number {
    const cleaned = cleanupExpiredPresence(this.directory, Date.now(), PRESENCE_TTL_MS);
    this.directory = dedupeIndex(cleaned.state);
    return cleaned.removed;
  }

  private async publish(topic: string, data: unknown): Promise<void> {
    await this.network.publish(topic, data);
    this.publishedByTopic[topic] = (this.publishedByTopic[topic] ?? 0) + 1;
  }

  private async persistCache(): Promise<void> {
    await this.cacheRepo.set(this.directory);
  }

  private async log(level: "info" | "warn" | "error", message: string): Promise<void> {
    await this.logRepo.append({
      level,
      message,
      timestamp: Date.now(),
    });
  }

  private getRealAdapterDiagnostics():
    | ReturnType<RealNetworkAdapterPreview["getDiagnostics"]>
    | null {
    if (typeof (this.network as RealNetworkAdapterPreview).getDiagnostics !== "function") {
      return null;
    }
    return (this.network as RealNetworkAdapterPreview).getDiagnostics();
  }
}

function sendOk<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  res.json({ ok: true, data, meta });
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  const error: ApiErrorShape = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  res.status(status).json({ ok: false, error });
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void> | void
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

async function main() {
  const app = express();
  const port = Number(process.env.PORT || 4310);

  const node = new LocalNodeService();
  await node.start();

  app.use(cors({ origin: true }));
  app.use(express.json());

  app.get("/api/identity", (_req, res) => {
    sendOk(res, node.getIdentity());
  });

  app.post(
    "/api/identity/create",
    asyncRoute(async (_req, res) => {
      const identity = await node.ensureIdentity();
      sendOk(res, identity, { message: "Identity is ready" });
    })
  );

  app.get("/api/profile", (_req, res) => {
    sendOk(res, node.getProfile());
  });

  app.put(
    "/api/profile",
    asyncRoute(async (req, res) => {
      const body = req.body as Partial<ProfileInput>;
      const tags = Array.isArray(body.tags)
        ? body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
        : undefined;

      const profile = await node.updateProfile({
        ...body,
        tags,
        display_name: body.display_name?.toString() ?? undefined,
        bio: body.bio?.toString() ?? undefined,
        avatar_url: body.avatar_url?.toString() ?? undefined,
        public_enabled: typeof body.public_enabled === "boolean" ? body.public_enabled : undefined,
      });

      sendOk(res, profile, { message: "Profile saved" });
    })
  );

  app.get("/api/overview", (_req, res) => {
    sendOk(res, node.getOverview());
  });

  app.get("/api/network", (_req, res) => {
    sendOk(res, node.getNetworkSummary());
  });

  app.get("/api/network/config", (_req, res) => {
    sendOk(res, node.getNetworkConfig());
  });

  app.get("/api/network/stats", (_req, res) => {
    sendOk(res, node.getNetworkStats());
  });

  app.get("/api/peers", (_req, res) => {
    sendOk(res, node.getPeersSummary());
  });

  app.post(
    "/api/broadcast/start",
    asyncRoute(async (_req, res) => {
      const summary = await node.setBroadcastEnabled(true);
      sendOk(res, summary, { message: "Broadcast started" });
    })
  );

  app.post(
    "/api/broadcast/stop",
    asyncRoute(async (_req, res) => {
      const summary = await node.setBroadcastEnabled(false);
      sendOk(res, summary, { message: "Broadcast stopped" });
    })
  );

  app.post(
    "/api/broadcast/now",
    asyncRoute(async (_req, res) => {
      const result = await node.broadcastNow("manual_button");
      sendOk(res, result, {
        message: result.sent ? "Broadcast published" : `Broadcast skipped: ${result.reason}`,
      });
    })
  );

  app.post(
    "/api/cache/refresh",
    asyncRoute(async (_req, res) => {
      const result = await node.refreshCache();
      sendOk(res, result, { message: "Cache refreshed" });
    })
  );

  app.get(
    "/api/logs",
    asyncRoute(async (_req, res) => {
      sendOk(res, await node.getLogs());
    })
  );

  app.get("/api/search", (req, res) => {
    const q = String(req.query.q ?? "");
    sendOk(res, node.search(q));
  });

  app.get("/api/agents/:agentId", (req, res) => {
    const state = node.getDirectory();
    const agentId = req.params.agentId;
    const profile = state.profiles[agentId];
    if (!profile) {
      sendError(res, 404, "AGENT_NOT_FOUND", "Agent not found", { agent_id: agentId });
      return;
    }

    const lastSeenAt = state.presence[agentId] ?? 0;
    sendOk(res, {
      profile,
      last_seen_at: lastSeenAt,
      online: isAgentOnline(lastSeenAt, Date.now(), PRESENCE_TTL_MS),
      presence_ttl_ms: PRESENCE_TTL_MS,
    });
  });

  app.get("/api/health", (_req, res) => {
    sendOk(res, { ok: true });
  });

  app.use(express.static(resolve(process.cwd(), "apps", "local-console", "public")));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    sendError(res, 500, "INTERNAL_ERROR", message);
  });

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`SilicaClaw local-console running: http://localhost:${port}`);
  });

  process.on("SIGINT", async () => {
    await node.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
