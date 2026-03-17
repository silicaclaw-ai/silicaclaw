import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { resolve } from "path";
import { existsSync } from "fs";
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
  ensureDefaultSocialMd,
  ingestIndexRecord,
  ingestPresenceRecord,
  ingestProfileRecord,
  isAgentOnline,
  loadSocialConfig,
  resolveIdentityWithSocial,
  resolveProfileInputWithSocial,
  searchDirectory,
  signPresence,
  signProfile,
  SocialConfig,
  SocialRuntimeConfig,
  generateSocialMdTemplate,
  verifyPresence,
  verifyProfile,
} from "@silicaclaw/core";
import {
  HeartbeatPeerDiscovery,
  LocalEventBusAdapter,
  MockNetworkAdapter,
  NetworkAdapter,
  RealNetworkAdapterPreview,
  UdpLanBroadcastTransport,
  WebRTCPreviewAdapter,
} from "@silicaclaw/network";
import { CacheRepo, IdentityRepo, LogRepo, ProfileRepo, SocialRuntimeRepo } from "@silicaclaw/storage";
import { registerSocialRoutes } from "./socialRoutes";

const BROADCAST_INTERVAL_MS = 10_000;
const PRESENCE_TTL_MS = Number(process.env.PRESENCE_TTL_MS || 30_000);
const NETWORK_MAX_MESSAGE_BYTES = Number(process.env.NETWORK_MAX_MESSAGE_BYTES || 64 * 1024);
const NETWORK_DEDUPE_WINDOW_MS = Number(process.env.NETWORK_DEDUPE_WINDOW_MS || 90_000);
const NETWORK_DEDUPE_MAX_ENTRIES = Number(process.env.NETWORK_DEDUPE_MAX_ENTRIES || 10_000);
const NETWORK_MAX_FUTURE_DRIFT_MS = Number(process.env.NETWORK_MAX_FUTURE_DRIFT_MS || 30_000);
const NETWORK_MAX_PAST_DRIFT_MS = Number(process.env.NETWORK_MAX_PAST_DRIFT_MS || 120_000);
const NETWORK_HEARTBEAT_INTERVAL_MS = Number(process.env.NETWORK_HEARTBEAT_INTERVAL_MS || 12_000);
const NETWORK_PEER_STALE_AFTER_MS = Number(process.env.NETWORK_PEER_STALE_AFTER_MS || 45_000);
const NETWORK_PEER_REMOVE_AFTER_MS = Number(process.env.NETWORK_PEER_REMOVE_AFTER_MS || 180_000);
const NETWORK_UDP_BIND_ADDRESS = process.env.NETWORK_UDP_BIND_ADDRESS || "0.0.0.0";
const NETWORK_UDP_BROADCAST_ADDRESS = process.env.NETWORK_UDP_BROADCAST_ADDRESS || "255.255.255.255";
const NETWORK_PEER_ID = process.env.NETWORK_PEER_ID;
const WEBRTC_SIGNALING_URL = process.env.WEBRTC_SIGNALING_URL || "http://localhost:4510";
const WEBRTC_SIGNALING_URLS = process.env.WEBRTC_SIGNALING_URLS || "";
const WEBRTC_ROOM = process.env.WEBRTC_ROOM || "silicaclaw-room";
const WEBRTC_SEED_PEERS = process.env.WEBRTC_SEED_PEERS || "";
const WEBRTC_BOOTSTRAP_HINTS = process.env.WEBRTC_BOOTSTRAP_HINTS || "";

function parseListEnv(raw: string): string[] {
  return raw
    .split(/[,\n]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

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
  private socialRuntimeRepo = new SocialRuntimeRepo(process.cwd());

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
  private adapterMode: "mock" | "local-event-bus" | "real-preview" | "webrtc-preview";
  private networkNamespace: string;
  private networkPort: number | null;
  private socialConfig: SocialConfig;
  private socialSourcePath: string | null = null;
  private socialFound = false;
  private socialParseError: string | null = null;
  private socialRawFrontmatter: Record<string, unknown> | null = null;
  private socialRuntime: SocialRuntimeConfig | null = null;
  private socialNetworkRequiresRestart = false;
  private resolvedIdentitySource: "silicaclaw-existing" | "openclaw-existing" | "silicaclaw-generated" =
    "silicaclaw-existing";
  private resolvedOpenClawIdentityPath: string | null = null;
  private webrtcSignalingUrls: string[] = [];
  private webrtcRoom = "silicaclaw-room";
  private webrtcSeedPeers: string[] = [];
  private webrtcBootstrapHints: string[] = [];
  private webrtcBootstrapSources: string[] = [];

  constructor() {
    const loadedSocial = loadSocialConfig(process.cwd());
    this.socialConfig = loadedSocial.config;
    this.socialSourcePath = loadedSocial.meta.source_path;
    this.socialFound = loadedSocial.meta.found;
    this.socialParseError = loadedSocial.meta.parse_error;
    this.socialRawFrontmatter = loadedSocial.raw_frontmatter;

    this.networkNamespace = this.socialConfig.network.namespace || process.env.NETWORK_NAMESPACE || "silicaclaw.preview";
    this.networkPort = Number(this.socialConfig.network.port || process.env.NETWORK_PORT || 44123);
    this.applyResolvedNetworkConfig();

    const mode = this.socialConfig.network.adapter || process.env.NETWORK_ADAPTER;
    if (mode === "mock") {
      this.network = new MockNetworkAdapter();
      this.adapterMode = "mock";
      this.networkPort = null;
      return;
    }
    if (mode === "real-preview") {
      this.network = new RealNetworkAdapterPreview({
        peerId: NETWORK_PEER_ID,
        namespace: this.networkNamespace,
        transport: new UdpLanBroadcastTransport({
          port: this.networkPort,
          bindAddress: NETWORK_UDP_BIND_ADDRESS,
          broadcastAddress: NETWORK_UDP_BROADCAST_ADDRESS,
        }),
        peerDiscovery: new HeartbeatPeerDiscovery({
          heartbeatIntervalMs: NETWORK_HEARTBEAT_INTERVAL_MS,
          staleAfterMs: NETWORK_PEER_STALE_AFTER_MS,
          removeAfterMs: NETWORK_PEER_REMOVE_AFTER_MS,
        }),
        maxMessageBytes: NETWORK_MAX_MESSAGE_BYTES,
        dedupeWindowMs: NETWORK_DEDUPE_WINDOW_MS,
        dedupeMaxEntries: NETWORK_DEDUPE_MAX_ENTRIES,
        maxFutureDriftMs: NETWORK_MAX_FUTURE_DRIFT_MS,
        maxPastDriftMs: NETWORK_MAX_PAST_DRIFT_MS,
      });
      this.adapterMode = "real-preview";
      return;
    }
    if (mode === "webrtc-preview") {
      this.network = new WebRTCPreviewAdapter({
        peerId: NETWORK_PEER_ID,
        namespace: this.networkNamespace,
        signalingUrl: this.webrtcSignalingUrls[0] ?? WEBRTC_SIGNALING_URL,
        signalingUrls: this.webrtcSignalingUrls,
        room: this.webrtcRoom,
        seedPeers: this.webrtcSeedPeers,
        bootstrapHints: this.webrtcBootstrapHints,
        bootstrapSources: this.webrtcBootstrapSources,
        maxMessageBytes: NETWORK_MAX_MESSAGE_BYTES,
        maxFutureDriftMs: NETWORK_MAX_FUTURE_DRIFT_MS,
        maxPastDriftMs: NETWORK_MAX_PAST_DRIFT_MS,
      });
      this.adapterMode = "webrtc-preview";
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
      social: {
        found: this.socialFound,
        enabled: this.socialConfig.enabled,
        source_path: this.socialSourcePath,
      },
    };
  }

  getNetworkSummary() {
    const diagnostics = this.getAdapterDiagnostics();
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
      real_preview_transport_stats: diagnostics?.transport_stats ?? null,
      real_preview_discovery_stats: diagnostics?.discovery_stats ?? null,
      webrtc_preview: diagnostics && diagnostics.adapter === "webrtc-preview"
        ? {
            signaling_url: diagnostics.signaling_url ?? null,
            signaling_endpoints: diagnostics.signaling_endpoints ?? [],
            room: diagnostics.room ?? null,
            bootstrap_sources: diagnostics.bootstrap_sources ?? [],
            seed_peers_count: diagnostics.seed_peers_count ?? 0,
            discovery_events_total: diagnostics.discovery_events_total ?? 0,
            last_discovery_event_at: diagnostics.last_discovery_event_at ?? 0,
            active_webrtc_peers: diagnostics.active_webrtc_peers ?? 0,
            reconnect_attempts_total: diagnostics.reconnect_attempts_total ?? 0,
          }
        : null,
    };
  }

  getNetworkConfig() {
    const diagnostics = this.getAdapterDiagnostics();
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
      adapter_config: diagnostics?.config ?? null,
      adapter_extra: diagnostics && diagnostics.adapter === "webrtc-preview"
        ? {
            signaling_url: diagnostics.signaling_url ?? null,
            signaling_endpoints: diagnostics.signaling_endpoints ?? [],
            room: diagnostics.room ?? null,
            bootstrap_sources: diagnostics.bootstrap_sources ?? [],
            seed_peers_count: diagnostics.seed_peers_count ?? 0,
            discovery_events_total: diagnostics.discovery_events_total ?? 0,
            last_discovery_event_at: diagnostics.last_discovery_event_at ?? 0,
            connection_states_summary: diagnostics.connection_states_summary ?? null,
            datachannel_states_summary: diagnostics.datachannel_states_summary ?? null,
          }
        : null,
      env: {
        NETWORK_ADAPTER: this.adapterMode,
        NETWORK_NAMESPACE: this.networkNamespace,
        NETWORK_PORT: this.networkPort,
        NETWORK_MAX_MESSAGE_BYTES,
        NETWORK_DEDUPE_WINDOW_MS,
        NETWORK_DEDUPE_MAX_ENTRIES,
        NETWORK_MAX_FUTURE_DRIFT_MS,
        NETWORK_MAX_PAST_DRIFT_MS,
        NETWORK_HEARTBEAT_INTERVAL_MS,
        NETWORK_PEER_STALE_AFTER_MS,
        NETWORK_PEER_REMOVE_AFTER_MS,
        NETWORK_UDP_BIND_ADDRESS,
        NETWORK_UDP_BROADCAST_ADDRESS,
        NETWORK_PEER_ID: NETWORK_PEER_ID ?? null,
        WEBRTC_SIGNALING_URLS,
        WEBRTC_SIGNALING_URL,
        WEBRTC_ROOM,
        WEBRTC_SEED_PEERS,
        WEBRTC_BOOTSTRAP_HINTS,
      },
      demo_mode:
        this.adapterMode === "real-preview"
          ? "lan-preview"
          : this.adapterMode === "webrtc-preview"
            ? "webrtc-preview"
            : "local-process",
    };
  }

  getNetworkStats() {
    const diagnostics = this.getAdapterDiagnostics();
    const peers: Array<{ status?: string }> = diagnostics?.peers?.items ?? [];
    const online = peers.filter((peer: { status?: string }) => peer.status === "online").length;

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
      adapter_config: diagnostics?.config ?? null,
      adapter_stats: diagnostics?.stats ?? null,
      adapter_transport_stats: diagnostics?.transport_stats ?? null,
      adapter_discovery_stats: diagnostics?.discovery_stats ?? null,
      adapter_diagnostics_summary: diagnostics
        ? {
            signaling_url: diagnostics.signaling_url ?? null,
            signaling_endpoints: diagnostics.signaling_endpoints ?? [],
            room: diagnostics.room ?? null,
            bootstrap_sources: diagnostics.bootstrap_sources ?? [],
            seed_peers_count: diagnostics.seed_peers_count ?? 0,
            discovery_events_total: diagnostics.discovery_events_total ?? 0,
            last_discovery_event_at: diagnostics.last_discovery_event_at ?? 0,
            connection_states_summary: diagnostics.connection_states_summary ?? null,
            datachannel_states_summary: diagnostics.datachannel_states_summary ?? null,
            signaling_messages_sent_total: diagnostics.signaling_messages_sent_total ?? null,
            signaling_messages_received_total: diagnostics.signaling_messages_received_total ?? null,
            reconnect_attempts_total: diagnostics.reconnect_attempts_total ?? null,
            active_webrtc_peers: diagnostics.active_webrtc_peers ?? null,
          }
        : null,
    };
  }

  getPeersSummary() {
    const diagnostics = this.getAdapterDiagnostics();
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
      diagnostics_summary: {
        signaling_url: diagnostics.signaling_url ?? null,
        signaling_endpoints: diagnostics.signaling_endpoints ?? [],
        room: diagnostics.room ?? null,
        bootstrap_sources: diagnostics.bootstrap_sources ?? [],
        seed_peers_count: diagnostics.seed_peers_count ?? 0,
        discovery_events_total: diagnostics.discovery_events_total ?? 0,
        last_discovery_event_at: diagnostics.last_discovery_event_at ?? 0,
        connection_states_summary: diagnostics.connection_states_summary ?? null,
        datachannel_states_summary: diagnostics.datachannel_states_summary ?? null,
        active_webrtc_peers: diagnostics.active_webrtc_peers ?? null,
      },
    };
  }

  getDiscoveryEvents() {
    const diagnostics = this.getAdapterDiagnostics();
    return {
      adapter: this.adapterMode,
      namespace: diagnostics?.namespace ?? this.networkNamespace,
      total: diagnostics?.discovery_events_total ?? 0,
      last_event_at: diagnostics?.last_discovery_event_at ?? 0,
      items: Array.isArray(diagnostics?.discovery_events) ? diagnostics.discovery_events : [],
      bootstrap_sources: diagnostics?.bootstrap_sources ?? this.webrtcBootstrapSources,
      signaling_endpoints: diagnostics?.signaling_endpoints ?? this.webrtcSignalingUrls,
      seed_peers_count: diagnostics?.seed_peers_count ?? this.webrtcSeedPeers.length,
    };
  }

  getSocialConfigView() {
    return {
      found: this.socialFound,
      source_path: this.socialSourcePath,
      parse_error: this.socialParseError,
      network_requires_restart: this.socialNetworkRequiresRestart,
      social_config: this.socialConfig,
      raw_frontmatter: this.socialRawFrontmatter,
      runtime: this.socialRuntime,
    };
  }

  getIntegrationSummary() {
    const runtimeGenerated = Boolean(this.socialRuntime && this.socialRuntime.last_loaded_at > 0);
    const identitySource = this.socialRuntime?.resolved_identity?.source ?? this.resolvedIdentitySource;
    const connected = this.socialFound && runtimeGenerated;
    const running = this.socialConfig.enabled && this.broadcastEnabled;
    const discoverable =
      running &&
      Boolean(this.profile?.public_enabled) &&
      this.socialConfig.discovery.discoverable &&
      this.socialConfig.discovery.allow_profile_broadcast &&
      this.socialConfig.discovery.allow_presence_broadcast;

    return {
      connected,
      discoverable,
      social_md_found: this.socialFound,
      social_md_source_path: this.socialSourcePath,
      runtime_generated: runtimeGenerated,
      reused_openclaw_identity: identitySource === "openclaw-existing",
      openclaw_identity_source_path: this.resolvedOpenClawIdentityPath,
      current_public_enabled: Boolean(this.profile?.public_enabled),
      current_adapter: this.adapterMode,
      current_namespace: this.networkNamespace,
      current_broadcast_status: this.broadcastEnabled ? "running" : "paused",
      configured_enabled: this.socialConfig.enabled,
      configured_public_enabled: this.socialConfig.public_enabled,
      configured_discoverable: this.socialConfig.discovery.discoverable,
    };
  }

  async reloadSocialConfig() {
    const before = {
      adapter: this.adapterMode,
      namespace: this.networkNamespace,
      port: this.networkPort,
    };

    const loaded = loadSocialConfig(process.cwd());
    this.socialConfig = loaded.config;
    this.socialSourcePath = loaded.meta.source_path;
    this.socialFound = loaded.meta.found;
    this.socialParseError = loaded.meta.parse_error;
    this.socialRawFrontmatter = loaded.raw_frontmatter;
    this.applyResolvedNetworkConfig();

    await this.applySocialConfigOnCurrentState();

    const after = {
      adapter: this.socialConfig.network.adapter,
      namespace: this.networkNamespace,
      port: this.networkPort,
    };
    this.socialNetworkRequiresRestart =
      before.adapter !== after.adapter ||
      before.namespace !== after.namespace ||
      (before.port ?? null) !== (after.port ?? null);

    await this.writeSocialRuntime();

    return this.getSocialConfigView();
  }

  async generateDefaultSocialMd() {
    const result = ensureDefaultSocialMd(process.cwd());
    await this.reloadSocialConfig();
    return result;
  }

  exportSocialTemplate(): { filename: string; content: string } {
    return {
      filename: "social.md",
      content: generateSocialMdTemplate(this.socialRuntime),
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
    await this.writeSocialRuntime();

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
    await this.writeSocialRuntime();
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

    const existingIdentity = await this.identityRepo.get();
    const resolvedIdentity = resolveIdentityWithSocial({
      socialConfig: this.socialConfig,
      existingIdentity,
      generatedIdentity: createIdentity(),
      rootDir: process.cwd(),
    });
    this.identity = resolvedIdentity.identity;
    this.resolvedIdentitySource = resolvedIdentity.source;
    this.resolvedOpenClawIdentityPath = resolvedIdentity.openclaw_source_path;
    if (resolvedIdentity.source === "silicaclaw-generated") {
      this.initState.identity_auto_created = true;
      await this.log("info", "identity.json missing, auto-generated SilicaClaw identity");
    }
    if (resolvedIdentity.source === "openclaw-existing" && resolvedIdentity.openclaw_source_path) {
      await this.log("info", `Bound existing OpenClaw identity: ${resolvedIdentity.openclaw_source_path}`);
    }
    await this.identityRepo.set(this.identity);

    const existingProfile = await this.profileRepo.get();
    const profileInput = resolveProfileInputWithSocial({
      socialConfig: this.socialConfig,
      agentId: this.identity.agent_id,
      existingProfile: existingProfile && existingProfile.agent_id === this.identity.agent_id ? existingProfile : null,
      rootDir: process.cwd(),
    });
    this.profile = signProfile(profileInput, this.identity);
    if (!existingProfile || existingProfile.agent_id !== this.identity.agent_id) {
      this.initState.profile_auto_created = true;
      await this.log("info", "profile.json missing/invalid, initialized from social/default profile");
    }
    await this.profileRepo.set(this.profile);

    this.directory = dedupeIndex(await this.cacheRepo.get());
    this.directory = ingestProfileRecord(this.directory, { type: "profile", profile: this.profile });
    this.compactCacheInMemory();
    await this.persistCache();
    await this.applySocialConfigOnCurrentState();
    await this.writeSocialRuntime();
  }

  private async applySocialConfigOnCurrentState(): Promise<void> {
    if (!this.identity || !this.profile) {
      return;
    }

    const nextProfileInput = resolveProfileInputWithSocial({
      socialConfig: this.socialConfig,
      agentId: this.identity.agent_id,
      existingProfile: this.profile,
      rootDir: process.cwd(),
    });
    const nextProfile = signProfile(nextProfileInput, this.identity);
    this.profile = nextProfile;
    await this.profileRepo.set(nextProfile);

    this.directory = ingestProfileRecord(this.directory, { type: "profile", profile: nextProfile });
    this.compactCacheInMemory();
    await this.persistCache();

    if (!this.socialConfig.enabled) {
      await this.setBroadcastEnabled(false);
      return;
    }

    if (!this.broadcastEnabled) {
      await this.setBroadcastEnabled(true);
    }
  }

  private async writeSocialRuntime(): Promise<void> {
    const runtime: SocialRuntimeConfig = {
      enabled: this.socialConfig.enabled,
      public_enabled: this.socialConfig.public_enabled,
      source_path: this.socialSourcePath,
      last_loaded_at: Date.now(),
      social_found: this.socialFound,
      parse_error: this.socialParseError,
      resolved_identity: this.identity
        ? {
            agent_id: this.identity.agent_id,
            public_key: this.identity.public_key,
            created_at: this.identity.created_at,
            source: this.resolvedIdentitySource,
          }
        : null,
      resolved_profile: this.profile
        ? {
            display_name: this.profile.display_name,
            bio: this.profile.bio,
            avatar_url: this.profile.avatar_url,
            tags: this.profile.tags,
            public_enabled: this.profile.public_enabled,
          }
        : null,
      resolved_network: {
        adapter: this.adapterMode,
        namespace: this.networkNamespace,
        port: this.networkPort,
        signaling_url: this.webrtcSignalingUrls[0] ?? WEBRTC_SIGNALING_URL,
        signaling_urls: this.webrtcSignalingUrls,
        room: this.webrtcRoom,
        seed_peers: this.webrtcSeedPeers,
        bootstrap_hints: this.webrtcBootstrapHints,
        bootstrap_sources: this.webrtcBootstrapSources,
      },
      resolved_discovery: this.socialConfig.discovery,
      visibility: this.socialConfig.visibility,
      openclaw: this.socialConfig.openclaw,
    };
    this.socialRuntime = runtime;
    await this.socialRuntimeRepo.set(runtime);
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

  private getAdapterDiagnostics(): Record<string, any> | null {
    if (typeof (this.network as any).getDiagnostics !== "function") {
      return null;
    }
    return (this.network as any).getDiagnostics();
  }

  private applyResolvedNetworkConfig(): void {
    this.networkNamespace = this.socialConfig.network.namespace || process.env.NETWORK_NAMESPACE || "silicaclaw.preview";
    this.networkPort = Number(this.socialConfig.network.port || process.env.NETWORK_PORT || 44123);

    const signalingUrlsSocial = dedupeStrings(this.socialConfig.network.signaling_urls || []);
    const signalingUrlSocial = String(this.socialConfig.network.signaling_url || "").trim();
    const signalingUrlsEnv = dedupeStrings(parseListEnv(WEBRTC_SIGNALING_URLS));
    const signalingUrlEnvSingle = String(WEBRTC_SIGNALING_URL || "").trim();

    let signalingUrls: string[] = [];
    let signalingSource = "";
    if (signalingUrlsSocial.length > 0) {
      signalingUrls = signalingUrlsSocial;
      signalingSource = "social.md:network.signaling_urls";
    } else if (signalingUrlSocial) {
      signalingUrls = [signalingUrlSocial];
      signalingSource = "social.md:network.signaling_url";
    } else if (signalingUrlsEnv.length > 0) {
      signalingUrls = signalingUrlsEnv;
      signalingSource = "env:WEBRTC_SIGNALING_URLS";
    } else if (signalingUrlEnvSingle) {
      signalingUrls = [signalingUrlEnvSingle];
      signalingSource = "env:WEBRTC_SIGNALING_URL";
    } else {
      signalingUrls = ["http://localhost:4510"];
      signalingSource = "default:http://localhost:4510";
    }

    const roomSocial = String(this.socialConfig.network.room || "").trim();
    const roomEnv = String(WEBRTC_ROOM || "").trim();
    const room = roomSocial || roomEnv || "silicaclaw-room";
    const roomSource = roomSocial
      ? "social.md:network.room"
      : roomEnv
        ? "env:WEBRTC_ROOM"
        : "default:silicaclaw-room";

    const seedPeersSocial = dedupeStrings(this.socialConfig.network.seed_peers || []);
    const seedPeersEnv = dedupeStrings(parseListEnv(WEBRTC_SEED_PEERS));
    const seedPeers = seedPeersSocial.length > 0 ? seedPeersSocial : seedPeersEnv;
    const seedPeersSource =
      seedPeersSocial.length > 0
        ? "social.md:network.seed_peers"
        : seedPeersEnv.length > 0
          ? "env:WEBRTC_SEED_PEERS"
          : "default:none";

    const bootstrapHintsSocial = dedupeStrings(this.socialConfig.network.bootstrap_hints || []);
    const bootstrapHintsEnv = dedupeStrings(parseListEnv(WEBRTC_BOOTSTRAP_HINTS));
    const bootstrapHints = bootstrapHintsSocial.length > 0 ? bootstrapHintsSocial : bootstrapHintsEnv;
    const bootstrapHintsSource =
      bootstrapHintsSocial.length > 0
        ? "social.md:network.bootstrap_hints"
        : bootstrapHintsEnv.length > 0
          ? "env:WEBRTC_BOOTSTRAP_HINTS"
          : "default:none";

    this.webrtcSignalingUrls = signalingUrls;
    this.webrtcRoom = room;
    this.webrtcSeedPeers = seedPeers;
    this.webrtcBootstrapHints = bootstrapHints;
    this.webrtcBootstrapSources = [signalingSource, roomSource, seedPeersSource, bootstrapHintsSource];
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

function resolveLocalConsoleStaticDir(): string {
  const candidates = [
    resolve(process.cwd(), "public"),
    resolve(process.cwd(), "apps", "local-console", "public"),
    resolve(__dirname, "..", "public"),
    resolve(__dirname, "..", "..", "apps", "local-console", "public"),
  ];

  for (const dir of candidates) {
    if (existsSync(resolve(dir, "index.html"))) {
      return dir;
    }
  }

  return candidates[0];
}

async function main() {
  const app = express();
  const port = Number(process.env.PORT || 4310);
  const staticDir = resolveLocalConsoleStaticDir();

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

  app.get("/api/discovery/events", (_req, res) => {
    sendOk(res, node.getDiscoveryEvents());
  });

  registerSocialRoutes(app, {
    getSocialConfigView: () => node.getSocialConfigView(),
    getIntegrationSummary: () => node.getIntegrationSummary(),
    exportSocialTemplate: () => node.exportSocialTemplate(),
    reloadSocialConfig: () => node.reloadSocialConfig(),
    generateDefaultSocialMd: () => node.generateDefaultSocialMd(),
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

  app.use(express.static(staticDir));

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
