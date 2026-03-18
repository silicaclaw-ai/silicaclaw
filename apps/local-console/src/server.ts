import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { resolve } from "path";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { hostname } from "os";
import {
  AgentIdentity,
  DirectoryState,
  IndexRefRecord,
  PresenceRecord,
  ProfileInput,
  PublicProfile,
  PublicProfileSummary,
  SignedProfileRecord,
  buildPublicProfileSummary,
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
  getSocialConfigSearchPaths,
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
  RelayPreviewAdapter,
  UdpLanBroadcastTransport,
  WebRTCPreviewAdapter,
} from "@silicaclaw/network";
import { CacheRepo, IdentityRepo, LogRepo, ProfileRepo, SocialRuntimeRepo } from "@silicaclaw/storage";
import { registerSocialRoutes } from "./socialRoutes";

const BROADCAST_INTERVAL_MS = Number(process.env.BROADCAST_INTERVAL_MS || 20_000);
const PRESENCE_TTL_MS = Number(process.env.PRESENCE_TTL_MS || 90_000);
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
const NETWORK_MODE = process.env.NETWORK_MODE || "";
const WEBRTC_SIGNALING_URL = process.env.WEBRTC_SIGNALING_URL || "https://relay.silicaclaw.com";
const WEBRTC_SIGNALING_URLS = process.env.WEBRTC_SIGNALING_URLS || "";
const WEBRTC_ROOM = process.env.WEBRTC_ROOM || "silicaclaw-global-preview";
const WEBRTC_SEED_PEERS = process.env.WEBRTC_SEED_PEERS || "";
const WEBRTC_BOOTSTRAP_HINTS = process.env.WEBRTC_BOOTSTRAP_HINTS || "";
const PROFILE_VERSION = "v0.9";

function readWorkspaceVersion(workspaceRoot: string): string {
  const pkgFile = resolve(workspaceRoot, "package.json");
  if (existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { version?: string };
      if (pkg.version) return String(pkg.version);
    } catch {
      // ignore
    }
  }
  const versionFile = resolve(workspaceRoot, "VERSION");
  if (existsSync(versionFile)) {
    const raw = readFileSync(versionFile, "utf8").trim();
    if (raw) return raw;
  }
  return "unknown";
}

function resolveWorkspaceRoot(cwd = process.cwd()): string {
  if (existsSync(resolve(cwd, "apps", "local-console", "package.json"))) {
    return cwd;
  }
  const candidate = resolve(cwd, "..", "..");
  if (existsSync(resolve(candidate, "apps", "local-console", "package.json"))) {
    return candidate;
  }
  return cwd;
}

function resolveStorageRoot(workspaceRoot: string, cwd = process.cwd()): string {
  const appRoot = resolve(workspaceRoot, "apps", "local-console");
  if (existsSync(resolve(appRoot, "package.json"))) {
    return appRoot;
  }
  return cwd;
}

function hasMeaningfulJson(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return false;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null) return false;
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (typeof parsed === "object") return Object.keys(parsed as Record<string, unknown>).length > 0;
    return false;
  } catch {
    return false;
  }
}

function migrateLegacyDataIfNeeded(workspaceRoot: string, storageRoot: string): void {
  const legacyDataDir = resolve(workspaceRoot, "data");
  const targetDataDir = resolve(storageRoot, "data");
  if (legacyDataDir === targetDataDir) return;
  const files = ["identity.json", "profile.json", "cache.json", "logs.json"];
  for (const file of files) {
    const src = resolve(legacyDataDir, file);
    const dst = resolve(targetDataDir, file);
    if (!existsSync(src)) continue;
    if (hasMeaningfulJson(dst)) continue;
    if (!hasMeaningfulJson(src)) continue;
    mkdirSync(targetDataDir, { recursive: true });
    copyFileSync(src, dst);
  }
}

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
  social_auto_created: boolean;
  initialized_at: number;
};

type IntegrationStatusSummary = {
  configured: boolean;
  running: boolean;
  discoverable: boolean;
  network_mode: "local" | "lan" | "global-preview";
  public_enabled: boolean;
  agent_id: string;
  display_name: string;
  connected_to_silicaclaw: boolean;
  configured_reason: string;
  running_reason: string;
  discoverable_reason: string;
  status_line: string;
};

class LocalNodeService {
  private workspaceRoot: string;
  private storageRoot: string;
  private identityRepo: IdentityRepo;
  private profileRepo: ProfileRepo;
  private cacheRepo: CacheRepo;
  private logRepo: LogRepo;
  private socialRuntimeRepo: SocialRuntimeRepo;

  private identity: AgentIdentity | null = null;
  private profile: PublicProfile | null = null;
  private directory: DirectoryState = createEmptyDirectoryState();

  private receivedCount = 0;
  private broadcastCount = 0;
  private lastMessageAt = 0;
  private lastBroadcastAt = 0;
  private broadcaster: NodeJS.Timeout | null = null;
  private subscriptionsBound = false;
  private broadcastEnabled = true;

  private receivedByTopic: Record<string, number> = {};
  private publishedByTopic: Record<string, number> = {};

  private initState: InitState = {
    identity_auto_created: false,
    profile_auto_created: false,
    social_auto_created: false,
    initialized_at: 0,
  };

  private network: NetworkAdapter;
  private adapterMode: "mock" | "local-event-bus" | "real-preview" | "webrtc-preview" | "relay-preview";
  private networkMode: "local" | "lan" | "global-preview" = "lan";
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
  private webrtcRoom = "silicaclaw-global-preview";
  private webrtcSeedPeers: string[] = [];
  private webrtcBootstrapHints: string[] = [];
  private webrtcBootstrapSources: string[] = [];
  private appVersion = "unknown";

  constructor() {
    this.workspaceRoot = resolveWorkspaceRoot();
    this.storageRoot = resolveStorageRoot(this.workspaceRoot);
    this.appVersion = readWorkspaceVersion(this.workspaceRoot);
    migrateLegacyDataIfNeeded(this.workspaceRoot, this.storageRoot);

    this.identityRepo = new IdentityRepo(this.storageRoot);
    this.profileRepo = new ProfileRepo(this.storageRoot);
    this.cacheRepo = new CacheRepo(this.storageRoot);
    this.logRepo = new LogRepo(this.storageRoot);
    this.socialRuntimeRepo = new SocialRuntimeRepo(this.storageRoot);

    let loadedSocial = loadSocialConfig(this.workspaceRoot);
    if (!loadedSocial.meta.found) {
      ensureDefaultSocialMd(this.workspaceRoot, {
        display_name: this.getDefaultDisplayName(),
        bio: "Local AI agent connected to SilicaClaw",
        tags: ["openclaw", "local-first"],
        mode: "global-preview",
        public_enabled: false,
      });
      loadedSocial = loadSocialConfig(this.workspaceRoot);
      this.initState.social_auto_created = true;
    }
    this.socialConfig = loadedSocial.config;
    this.socialSourcePath = loadedSocial.meta.source_path;
    this.socialFound = loadedSocial.meta.found;
    this.socialParseError = loadedSocial.meta.parse_error;
    this.socialRawFrontmatter = loadedSocial.raw_frontmatter;

    this.networkNamespace = this.socialConfig.network.namespace || process.env.NETWORK_NAMESPACE || "silicaclaw.preview";
    this.networkPort = Number(this.socialConfig.network.port || process.env.NETWORK_PORT || 44123);
    this.applyResolvedNetworkConfig();
    const resolved = this.buildNetworkAdapter();
    this.network = resolved.adapter;
    this.adapterMode = resolved.mode;
    this.networkPort = resolved.port;
  }

  async start(): Promise<void> {
    await this.hydrateFromDisk();

    this.bindNetworkSubscriptions();
    await this.network.start();
    await this.log(
      "info",
      `Local node started (${this.adapterMode}, mode=${this.networkMode}, signaling=${this.webrtcSignalingUrls[0] || "-"}, room=${this.webrtcRoom})`
    );

    if (this.profile?.public_enabled && this.broadcastEnabled) {
      await this.broadcastNow("adapter_start");
    }

    this.startBroadcastLoop();
  }

  async stop(): Promise<void> {
    if (this.broadcaster) {
      clearInterval(this.broadcaster);
      this.broadcaster = null;
    }
    await this.network.stop();
  }

  private ensureLocalDirectoryBaseline(): void {
    if (this.profile) {
      this.directory = ingestProfileRecord(this.directory, { type: "profile", profile: this.profile });
    }
    if (this.identity && this.profile?.public_enabled && this.broadcastEnabled) {
      const currentSeenAt = this.directory.presence[this.identity.agent_id] ?? 0;
      const baselineSeenAt = Math.max(currentSeenAt, this.lastBroadcastAt || Date.now());
      this.directory = ingestPresenceRecord(this.directory, signPresence(this.identity, baselineSeenAt));
    }
  }

  getOverview() {
    this.ensureLocalDirectoryBaseline();
    this.compactCacheInMemory();
    const profiles = Object.values(this.directory.profiles);
    const onlineCount = profiles.filter((profile) =>
      isAgentOnline(this.directory.presence[profile.agent_id], Date.now(), PRESENCE_TTL_MS)
    ).length;

    return {
      app_version: this.appVersion,
      agent_id: this.identity?.agent_id ?? "",
      public_enabled: Boolean(this.profile?.public_enabled),
      broadcast_enabled: this.broadcastEnabled,
      last_broadcast_at: this.lastBroadcastAt,
      discovered_count: profiles.length,
      online_count: onlineCount,
      offline_count: Math.max(0, profiles.length - onlineCount),
      init_state: this.initState,
      presence_ttl_ms: PRESENCE_TTL_MS,
      onboarding: this.getOnboardingSummary(),
      social: {
        found: this.socialFound,
        enabled: this.socialConfig.enabled,
        source_path: this.socialSourcePath,
        network_mode: this.networkMode,
      },
    };
  }

  getNetworkSummary() {
    const diagnostics = this.getAdapterDiagnostics();
    const peerCount = diagnostics?.peers.total ?? 0;

    return {
      status: "running",
      adapter: this.adapterMode,
      mode: this.networkMode,
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
      webrtc_preview: diagnostics && (diagnostics.adapter === "webrtc-preview" || diagnostics.adapter === "relay-preview")
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
            last_join_at: diagnostics.last_join_at ?? 0,
            last_poll_at: diagnostics.last_poll_at ?? 0,
            last_publish_at: diagnostics.last_publish_at ?? 0,
            last_peer_refresh_at: diagnostics.last_peer_refresh_at ?? 0,
            last_error_at: diagnostics.last_error_at ?? 0,
            last_error: diagnostics.last_error ?? null,
          }
        : null,
    };
  }

  getNetworkConfig() {
    const diagnostics = this.getAdapterDiagnostics();
    return {
      adapter: this.adapterMode,
      mode: this.networkMode,
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
      adapter_extra: diagnostics && (diagnostics.adapter === "webrtc-preview" || diagnostics.adapter === "relay-preview")
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
            last_join_at: diagnostics.last_join_at ?? 0,
            last_poll_at: diagnostics.last_poll_at ?? 0,
            last_publish_at: diagnostics.last_publish_at ?? 0,
            last_peer_refresh_at: diagnostics.last_peer_refresh_at ?? 0,
            last_error_at: diagnostics.last_error_at ?? 0,
            last_error: diagnostics.last_error ?? null,
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
          : this.adapterMode === "webrtc-preview" || this.adapterMode === "relay-preview"
            ? "internet-preview"
            : "local-process",
    };
  }

  getNetworkStats() {
    const diagnostics = this.getAdapterDiagnostics();
    const peers: Array<{ status?: string }> = diagnostics?.peers?.items ?? [];
    const online = peers.filter((peer: { status?: string }) => peer.status === "online").length;

    return {
      adapter: this.adapterMode,
      mode: this.networkMode,
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
            last_join_at: diagnostics.last_join_at ?? 0,
            last_poll_at: diagnostics.last_poll_at ?? 0,
            last_publish_at: diagnostics.last_publish_at ?? 0,
            last_peer_refresh_at: diagnostics.last_peer_refresh_at ?? 0,
            last_error_at: diagnostics.last_error_at ?? 0,
            last_error: diagnostics.last_error ?? null,
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
        last_join_at: diagnostics.last_join_at ?? 0,
        last_poll_at: diagnostics.last_poll_at ?? 0,
        last_publish_at: diagnostics.last_publish_at ?? 0,
        last_peer_refresh_at: diagnostics.last_peer_refresh_at ?? 0,
        last_error_at: diagnostics.last_error_at ?? 0,
        last_error: diagnostics.last_error ?? null,
      },
    };
  }

  getDiscoveryEvents() {
    const diagnostics = this.getAdapterDiagnostics();
    return {
      adapter: this.adapterMode,
      mode: this.networkMode,
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
      init_state: this.initState,
    };
  }

  getRuntimePaths() {
    return {
      workspace_root: this.workspaceRoot,
      storage_root: this.storageRoot,
      data_dir: resolve(this.storageRoot, "data"),
      social_runtime_path: resolve(this.storageRoot, ".silicaclaw", "social.runtime.json"),
      local_console_public_dir: resolve(this.workspaceRoot, "apps", "local-console", "public"),
      social_lookup_paths: getSocialConfigSearchPaths(this.workspaceRoot),
      social_source_path: this.socialSourcePath,
    };
  }

  getIntegrationSummary() {
    const status = this.getIntegrationStatus();
    const runtimeGenerated = Boolean(this.socialRuntime && this.socialRuntime.last_loaded_at > 0);
    const identitySource = this.socialRuntime?.resolved_identity?.source ?? this.resolvedIdentitySource;

    return {
      connected: status.connected_to_silicaclaw,
      discoverable: status.discoverable,
      summary_line: status.status_line,
      social_md_found: this.socialFound,
      social_md_source_path: this.socialSourcePath,
      runtime_generated: runtimeGenerated,
      reused_openclaw_identity: identitySource === "openclaw-existing",
      openclaw_identity_source_path: this.resolvedOpenClawIdentityPath,
      current_public_enabled: status.public_enabled,
      current_network_mode: status.network_mode,
      current_adapter: this.adapterMode,
      current_namespace: this.networkNamespace,
      current_broadcast_status: this.broadcastEnabled ? "running" : "paused",
      configured_enabled: this.socialConfig.enabled,
      configured_public_enabled: this.socialConfig.public_enabled,
      configured_discoverable: this.socialConfig.discovery.discoverable,
      configured: status.configured,
      running: status.running,
      configured_reason: status.configured_reason,
      running_reason: status.running_reason,
      discoverable_reason: status.discoverable_reason,
      agent_id: status.agent_id,
      display_name: status.display_name,
    };
  }

  getIntegrationStatus(): IntegrationStatusSummary {
    const runtimeGenerated = Boolean(this.socialRuntime && this.socialRuntime.last_loaded_at > 0);
    const connected = this.socialFound && runtimeGenerated && !this.socialParseError;
    const configured = connected && this.socialConfig.enabled;
    const running = configured && this.broadcastEnabled;
    const publicEnabled = Boolean(this.profile?.public_enabled);
    const discoveryEnabled =
      this.socialConfig.discovery.discoverable &&
      this.socialConfig.discovery.allow_profile_broadcast &&
      this.socialConfig.discovery.allow_presence_broadcast;
    const discoverable = running && publicEnabled && discoveryEnabled;

    const configuredReason = configured
      ? "configured"
      : !this.socialFound
        ? "social.md not found"
        : this.socialParseError
          ? "social.md parse error"
          : !this.socialConfig.enabled
            ? "integration disabled"
            : "runtime not ready";

    const runningReason = running
      ? "running"
      : !configured
        ? "not configured"
        : !this.broadcastEnabled
          ? "broadcast paused"
          : "not running";

    const discoverableReason = discoverable
      ? "discoverable"
      : !running
        ? "not running"
        : !publicEnabled
          ? "Public discovery is disabled"
          : !this.socialConfig.discovery.discoverable
            ? "discovery disabled"
            : !this.socialConfig.discovery.allow_profile_broadcast
              ? "profile broadcast disabled"
              : !this.socialConfig.discovery.allow_presence_broadcast
                ? "presence broadcast disabled"
                : "not discoverable";

    return {
      configured,
      running,
      discoverable,
      network_mode: this.networkMode,
      public_enabled: publicEnabled,
      agent_id: this.identity?.agent_id ?? "",
      display_name: this.profile?.display_name ?? "",
      connected_to_silicaclaw: connected,
      configured_reason: configuredReason,
      running_reason: runningReason,
      discoverable_reason: discoverableReason,
      status_line: `${connected ? "Connected to SilicaClaw" : "Not connected to SilicaClaw"} · ${publicEnabled ? "Public discovery enabled" : "Public discovery disabled"} · Using ${this.networkMode}`,
    };
  }

  async setPublicDiscoveryRuntime(enabled: boolean) {
    const profile = await this.updateProfile({ public_enabled: enabled });
    this.socialConfig.public_enabled = enabled;
    await this.writeSocialRuntime();
    return {
      public_enabled: profile.public_enabled,
      note: "Runtime public discovery updated. Existing social.md is unchanged.",
    };
  }

  async setNetworkModeRuntime(mode: "local" | "lan" | "global-preview") {
    const currentMode = this.networkMode;
    if (mode !== "local" && mode !== "lan" && mode !== "global-preview") {
      throw new Error("invalid_network_mode");
    }
    this.socialConfig.network.mode = mode;
    this.socialConfig.network.adapter = this.adapterForMode(mode);
    this.applyResolvedNetworkConfig();
    this.socialNetworkRequiresRestart = currentMode !== mode || this.adapterMode !== this.socialConfig.network.adapter;
    await this.writeSocialRuntime();
    return {
      mode: this.networkMode,
      adapter: this.socialConfig.network.adapter,
      network_requires_restart: this.socialNetworkRequiresRestart,
      note: "Runtime mode updated. Existing social.md is unchanged.",
    };
  }

  async quickConnectGlobalPreview(options?: { signaling_url?: string; room?: string }) {
    const signalingUrl = String(options?.signaling_url || "").trim();
    const room = String(options?.room || "").trim();
    if (!signalingUrl) {
      throw new Error("missing_signaling_url");
    }

    this.socialConfig.network.mode = "global-preview";
    this.socialConfig.network.adapter = "relay-preview";
    this.socialConfig.network.signaling_url = signalingUrl;
    this.socialConfig.network.signaling_urls = [signalingUrl];
    this.socialConfig.network.room = room || "silicaclaw-global-preview";
    this.applyResolvedNetworkConfig();
    await this.restartNetworkAdapter("quick_connect_global_preview");
    this.socialNetworkRequiresRestart = false;
    await this.writeSocialRuntime();
    await this.log("info", `Quick connect enabled (relay-preview, room=${this.webrtcRoom})`);

    return {
      mode: this.networkMode,
      adapter: this.adapterMode,
      signaling_url: this.webrtcSignalingUrls[0] ?? null,
      room: this.webrtcRoom,
      network_requires_restart: false,
      note: "Cross-network preview enabled.",
    };
  }

  async reloadSocialConfig() {
    const before = {
      mode: this.networkMode,
      adapter: this.adapterMode,
      namespace: this.networkNamespace,
      port: this.networkPort,
    };

    const loaded = loadSocialConfig(this.workspaceRoot);
    this.socialConfig = loaded.config;
    this.socialSourcePath = loaded.meta.source_path;
    this.socialFound = loaded.meta.found;
    this.socialParseError = loaded.meta.parse_error;
    this.socialRawFrontmatter = loaded.raw_frontmatter;
    this.applyResolvedNetworkConfig();

    await this.applySocialConfigOnCurrentState();

    const after = {
      mode: this.networkMode,
      adapter: this.socialConfig.network.adapter,
      namespace: this.networkNamespace,
      port: this.networkPort,
    };
    this.socialNetworkRequiresRestart =
      before.mode !== after.mode ||
      before.adapter !== after.adapter ||
      before.namespace !== after.namespace ||
      (before.port ?? null) !== (after.port ?? null);

    await this.writeSocialRuntime();

    return this.getSocialConfigView();
  }

  async generateDefaultSocialMd() {
    const result = ensureDefaultSocialMd(this.workspaceRoot, {
      display_name: this.getDefaultDisplayName(),
      bio: "Local AI agent connected to SilicaClaw",
      tags: ["openclaw", "local-first"],
      mode: this.networkMode,
      public_enabled: Boolean(this.profile?.public_enabled),
    });
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
    this.ensureLocalDirectoryBaseline();
    this.compactCacheInMemory();
    return this.directory;
  }

  search(keyword: string): PublicProfileSummary[] {
    this.ensureLocalDirectoryBaseline();
    this.compactCacheInMemory();
    return searchDirectory(this.directory, keyword, { presenceTTLms: PRESENCE_TTL_MS }).map((profile) => {
      const lastSeenAt = this.directory.presence[profile.agent_id] ?? 0;
      return this.toPublicProfileSummary(profile, { last_seen_at: lastSeenAt });
    });
  }

  getPublicProfilePreview(): PublicProfileSummary | null {
    if (!this.profile) {
      return null;
    }
    const lastSeenAt = this.directory.presence[this.profile.agent_id] ?? 0;
    return this.toPublicProfileSummary(this.profile, { last_seen_at: lastSeenAt });
  }

  getAgentPublicSummary(agentId: string): PublicProfileSummary | null {
    const profile = this.directory.profiles[agentId];
    if (!profile) {
      return null;
    }
    const lastSeenAt = this.directory.presence[agentId] ?? 0;
    return this.toPublicProfileSummary(profile, { last_seen_at: lastSeenAt });
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

  async clearDiscoveredCache() {
    const selfAgentId = this.profile?.agent_id || this.identity?.agent_id || "";
    const profileEntries = Object.entries(this.directory.profiles);
    const removedProfiles = profileEntries.filter(([agentId]) => agentId !== selfAgentId).length;
    const removedPresence = Object.entries(this.directory.presence).filter(([agentId]) => agentId !== selfAgentId).length;
    const removedIndexRefs = Object.values(this.directory.index).reduce((acc, agentIds) => {
      const removed = agentIds.filter((agentId) => agentId !== selfAgentId).length;
      return acc + removed;
    }, 0);

    this.directory = createEmptyDirectoryState();
    if (this.profile) {
      this.directory = ingestProfileRecord(this.directory, {
        type: "profile",
        profile: this.profile,
      });
    }
    await this.persistCache();
    await this.log("warn", `Discovered cache cleared (profiles=${removedProfiles}, presence=${removedPresence}, index_refs=${removedIndexRefs})`);

    return {
      removed_profiles: removedProfiles,
      removed_presence: removedPresence,
      removed_index_refs: removedIndexRefs,
      kept_self_profile: Boolean(this.profile),
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
      social_auto_created: this.initState.social_auto_created,
      initialized_at: Date.now(),
    };
    if (this.initState.social_auto_created) {
      await this.log("info", "social.md missing, auto-generated minimal default template");
    }

    const existingIdentity = await this.identityRepo.get();
    const resolvedIdentity = resolveIdentityWithSocial({
      socialConfig: this.socialConfig,
      existingIdentity,
      generatedIdentity: createIdentity(),
      rootDir: this.workspaceRoot,
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
      rootDir: this.workspaceRoot,
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
      rootDir: this.workspaceRoot,
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
        mode: this.networkMode,
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

  private bindNetworkSubscriptions(): void {
    if (this.subscriptionsBound) {
      return;
    }
    this.network.subscribe("profile", (data: SignedProfileRecord) => {
      this.onMessage("profile", data);
    });
    this.network.subscribe("presence", (data: PresenceRecord) => {
      this.onMessage("presence", data);
    });
    this.network.subscribe("index", (data: IndexRefRecord) => {
      this.onMessage("index", data);
    });
    this.subscriptionsBound = true;
  }

  private buildNetworkAdapter(): {
    adapter: NetworkAdapter;
    mode: "mock" | "local-event-bus" | "real-preview" | "webrtc-preview" | "relay-preview";
    port: number | null;
  } {
    const mode = (process.env.NETWORK_ADAPTER as typeof this.adapterMode | undefined) || this.socialConfig.network.adapter;
    if (mode === "mock") {
      return {
        adapter: new MockNetworkAdapter(),
        mode: "mock",
        port: null,
      };
    }
    if (mode === "real-preview") {
      return {
        adapter: new RealNetworkAdapterPreview({
          peerId: NETWORK_PEER_ID,
          namespace: this.networkNamespace,
          transport: new UdpLanBroadcastTransport({
            port: this.networkPort ?? undefined,
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
        }),
        mode: "real-preview",
        port: this.networkPort,
      };
    }
    if (mode === "webrtc-preview") {
      return {
        adapter: new WebRTCPreviewAdapter({
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
        }),
        mode: "webrtc-preview",
        port: this.networkPort,
      };
    }
    if (mode === "relay-preview") {
      return {
        adapter: new RelayPreviewAdapter({
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
        }),
        mode: "relay-preview",
        port: this.networkPort,
      };
    }
    return {
      adapter: new LocalEventBusAdapter(),
      mode: "local-event-bus",
      port: null,
    };
  }

  private async restartNetworkAdapter(reason: string): Promise<void> {
    const previous = this.network;
    try {
      await previous.stop();
    } catch (error) {
      await this.log("warn", `Old adapter stop error during restart (${reason}): ${error instanceof Error ? error.message : String(error)}`);
    }

    const next = this.buildNetworkAdapter();
    this.network = next.adapter;
    this.adapterMode = next.mode;
    this.networkPort = next.port;

    await this.network.start();
    this.bindNetworkSubscriptions();
    this.startBroadcastLoop();

    if (this.broadcastEnabled && this.profile?.public_enabled) {
      await this.broadcastNow("adapter_restart");
    }
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

  private toPublicProfileSummary(
    profile: PublicProfile,
    options?: { last_seen_at?: number }
  ): PublicProfileSummary {
    const lastSeenAt = options?.last_seen_at ?? this.directory.presence[profile.agent_id] ?? 0;
    const online = isAgentOnline(lastSeenAt, Date.now(), PRESENCE_TTL_MS);
    const isSelf = profile.agent_id === this.identity?.agent_id;
    const visibility = isSelf
      ? {
          show_tags: this.socialConfig.visibility.show_tags,
          show_last_seen: this.socialConfig.visibility.show_last_seen,
          show_capabilities_summary: this.socialConfig.visibility.show_capabilities_summary,
        }
      : {
          show_tags: true,
          show_last_seen: true,
          show_capabilities_summary: true,
        };

    const selfPublicKey = isSelf ? this.identity?.public_key ?? null : null;
    const verifiedProfile = Boolean(
      isSelf &&
        selfPublicKey &&
        verifyProfile(profile, selfPublicKey)
    );

    return buildPublicProfileSummary({
      profile,
      online,
      last_seen_at: lastSeenAt || null,
      network_mode: isSelf ? this.networkMode : "unknown",
      openclaw_bound: isSelf
        ? this.resolvedIdentitySource === "openclaw-existing"
        : profile.tags.some((tag) => String(tag).trim().toLowerCase() === "openclaw"),
      visibility,
      profile_version: PROFILE_VERSION,
      public_key_fingerprint: selfPublicKey ? this.fingerprintPublicKey(selfPublicKey) : null,
      verified_profile: verifiedProfile,
      now: Date.now(),
      presence_ttl_ms: PRESENCE_TTL_MS,
    });
  }

  private fingerprintPublicKey(publicKey: string): string {
    const digest = createHash("sha256").update(publicKey, "utf8").digest("hex");
    return `${digest.slice(0, 12)}:${digest.slice(-8)}`;
  }

  private getOnboardingSummary() {
    const summary = this.getIntegrationSummary();
    const publicEnabled = Boolean(this.profile?.public_enabled);
    return {
      first_run: Boolean(
        this.initState.social_auto_created ||
        this.initState.identity_auto_created ||
        this.initState.profile_auto_created
      ),
      connected: summary.connected,
      discoverable: summary.discoverable,
      mode: this.networkMode,
      public_enabled: publicEnabled,
      can_enable_public_discovery: !publicEnabled,
      next_steps: [
        "Update display name in Profile page",
        "Export social.md from Social Config",
      ],
    };
  }

  private getDefaultDisplayName(): string {
    const host = hostname().trim().replace(/\s+/g, "-").slice(0, 24);
    return host ? `OpenClaw @ ${host}` : "OpenClaw Agent";
  }

  private adapterForMode(mode: "local" | "lan" | "global-preview"): "local-event-bus" | "real-preview" | "webrtc-preview" | "relay-preview" {
    if (mode === "local") return "local-event-bus";
    if (mode === "lan") return "real-preview";
    return "relay-preview";
  }

  private applyResolvedNetworkConfig(): void {
    const modeEnv = String(NETWORK_MODE || "").trim();
    const resolvedMode =
      modeEnv === "local" || modeEnv === "lan" || modeEnv === "global-preview"
        ? modeEnv
        : this.socialConfig.network.mode || "lan";

    this.networkMode = resolvedMode;
    this.networkNamespace = this.socialConfig.network.namespace || process.env.NETWORK_NAMESPACE || "silicaclaw.preview";
    this.networkPort = Number(this.socialConfig.network.port || process.env.NETWORK_PORT || 44123);

    const builtInGlobalSignalingUrls = ["https://relay.silicaclaw.com"];
    const builtInGlobalRoom = "silicaclaw-global-preview";

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
    } else if (this.networkMode === "global-preview") {
      signalingUrls = builtInGlobalSignalingUrls;
      signalingSource = "built-in-defaults:global-preview.signaling_urls";
    } else {
      signalingUrls = ["https://relay.silicaclaw.com"];
      signalingSource = "default:https://relay.silicaclaw.com";
    }

    const roomSocial = String(this.socialConfig.network.room || "").trim();
    const roomEnv = String(WEBRTC_ROOM || "").trim();
    const room =
      roomSocial ||
      roomEnv ||
      (this.networkMode === "global-preview" ? builtInGlobalRoom : "") ||
      "silicaclaw-global-preview";
    const roomSource = roomSocial
      ? "social.md:network.room"
      : roomEnv
          ? "env:WEBRTC_ROOM"
          : this.networkMode === "global-preview"
        ? "built-in-defaults:global-preview.room"
          : "default:silicaclaw-global-preview";

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

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shortId(id: string): string {
  if (!id) return "-";
  return `${id.slice(0, 10)}...${id.slice(-6)}`;
}

function ago(ts: number | null | undefined): string {
  if (!ts) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function renderBootstrapScript(payload: unknown): string {
  const encoded = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `
<script>
(() => {
  const data = ${encoded};
  if (!data) return;
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  const setHtml = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
  };
  if (data.integrationStatusText) {
    const bar = document.getElementById('integrationStatusBar');
    if (bar) {
      bar.textContent = data.integrationStatusText;
      if (data.integrationStatusClassName) bar.className = data.integrationStatusClassName;
    }
  }
  setText('socialStatusLine', data.socialStatusLineText || '');
  setText('socialStatusSubline', data.socialStatusSublineText || '');
  setText('brandVersion', data.brandVersionText || '-');
  setText('snapshot', data.snapshotText || '');
  setText('heroMode', data.heroModeText || '-');
  setText('heroAdapter', data.heroAdapterText || '-');
  setText('heroRelay', data.heroRelayText || '-');
  setText('heroRoom', data.heroRoomText || '-');
  setText('pillAdapter', data.pillAdapterText || 'adapter: -');
  const pillBroadcast = document.getElementById('pillBroadcast');
  if (pillBroadcast) {
    pillBroadcast.textContent = data.pillBroadcastText || 'broadcast: -';
    if (data.pillBroadcastClassName) pillBroadcast.className = data.pillBroadcastClassName;
  }
  setHtml('overviewCards', data.overviewCardsHtml || '');
  setText('agentsCountHint', data.agentsCountHintText || '0 agents');
  setHtml('agentsWrap', data.agentsWrapHtml || '<div class="label">No discovered agents yet.</div>');
})();
</script>`;
}

async function main() {
  const app = express();
  const port = Number(process.env.PORT || 4310);
  const staticDir = resolveLocalConsoleStaticDir();
  const staticIndexFile = resolve(staticDir, "index.html");

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

  app.get("/api/public-profile/preview", (_req, res) => {
    sendOk(res, node.getPublicProfilePreview());
  });

  app.get("/api/runtime/paths", (_req, res) => {
    sendOk(res, node.getRuntimePaths());
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

  app.get("/api/integration/status", (_req, res) => {
    sendOk(res, node.getIntegrationStatus());
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

  app.post(
    "/api/network/quick-connect-global-preview",
    asyncRoute(async (req, res) => {
      const body = (req.body ?? {}) as { signaling_url?: unknown; room?: unknown };
      const signalingUrl = String(body.signaling_url || "").trim();
      const room = String(body.room || "").trim();
      if (!signalingUrl) {
        sendError(res, 400, "invalid_request", "signaling_url is required");
        return;
      }
      const result = await node.quickConnectGlobalPreview({
        signaling_url: signalingUrl,
        room,
      });
      sendOk(res, result, { message: "Cross-network preview enabled" });
    })
  );

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
    setNetworkModeRuntime: (mode) => node.setNetworkModeRuntime(mode),
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
    "/api/public-discovery/enable",
    asyncRoute(async (_req, res) => {
      const result = await node.setPublicDiscoveryRuntime(true);
      sendOk(res, result, { message: "Public discovery enabled (runtime)" });
    })
  );

  app.post(
    "/api/public-discovery/disable",
    asyncRoute(async (_req, res) => {
      const result = await node.setPublicDiscoveryRuntime(false);
      sendOk(res, result, { message: "Public discovery disabled (runtime)" });
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

  app.post(
    "/api/cache/clear",
    asyncRoute(async (_req, res) => {
      const result = await node.clearDiscoveredCache();
      sendOk(res, result, { message: "Discovered cache cleared (self profile kept)" });
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
    const summary = node.getAgentPublicSummary(agentId);
    sendOk(res, {
      profile,
      summary,
      last_seen_at: summary?.last_seen_at ?? null,
      online: isAgentOnline(lastSeenAt, Date.now(), PRESENCE_TTL_MS),
      presence_ttl_ms: PRESENCE_TTL_MS,
    });
  });

  app.get("/api/health", (_req, res) => {
    sendOk(res, { ok: true });
  });

  app.get(["/", "/index.html"], (_req, res) => {
    const overview = node.getOverview();
    const discovered = node.search("");
    const network = node.getNetworkConfig();
    const integration = node.getIntegrationStatus();
    const overviewCardsHtml = [
      ["Discovered", overview.discovered_count],
      ["Online", overview.online_count],
      ["Offline", overview.offline_count],
      ["Presence TTL", `${Math.floor(overview.presence_ttl_ms / 1000)}s`],
    ]
      .map(
        ([k, v]) => `<div class="card"><div class="label">${escapeHtml(String(k))}</div><div class="value">${escapeHtml(String(v))}</div></div>`
      )
      .join("");
    const agentsWrapHtml =
      discovered.length === 0
        ? `<div class="label">No discovered agents yet.</div>`
        : `
            <table class="table">
              <thead><tr><th>Name</th><th>Agent ID</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                ${discovered
                  .map(
                    (agent) => `
                  <tr>
                    <td>${escapeHtml(agent.display_name || "Unnamed")}</td>
                    <td class="mono">${escapeHtml(shortId(agent.agent_id || ""))}</td>
                    <td class="${agent.online ? "online" : "offline"}">${agent.online ? "online" : "offline"}</td>
                    <td>${escapeHtml(ago(agent.updated_at))}</td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          `;
    const payload = {
      brandVersionText: overview.app_version ? `v${overview.app_version}` : "-",
      snapshotText: [
        `app_version: ${overview.app_version || "-"}`,
        `agent_id: ${overview.agent_id || "-"}`,
        `public_enabled: ${overview.public_enabled}`,
        `broadcast_enabled: ${overview.broadcast_enabled}`,
        `last_broadcast: ${ago(overview.last_broadcast_at)}`,
      ].join("\n"),
      heroModeText: overview.social?.network_mode || "-",
      heroAdapterText: network.adapter || "-",
      heroRelayText: network.adapter_extra?.signaling_url || "-",
      heroRoomText: network.adapter_extra?.room || "-",
      pillAdapterText: `adapter: ${network.adapter || "-"}`,
      pillBroadcastText: overview.broadcast_enabled ? "broadcast: running" : "broadcast: paused",
      pillBroadcastClassName: `pill ${overview.broadcast_enabled ? "ok" : "warn"}`,
      overviewCardsHtml,
      agentsCountHintText: `${discovered.length} agents discovered`,
      agentsWrapHtml,
      integrationStatusText: `Connected to SilicaClaw: ${integration.connected_to_silicaclaw ? "yes" : "no"} · Network mode: ${integration.network_mode || "-"} · Public discovery: ${integration.public_enabled ? "enabled" : "disabled"}`,
      integrationStatusClassName: `integration-strip ${integration.connected_to_silicaclaw && integration.public_enabled ? "ok" : "warn"}`,
      socialStatusLineText: integration.status_line || "",
      socialStatusSublineText: `Connected to SilicaClaw · ${integration.public_enabled ? "Public discovery enabled" : "Public discovery disabled"} · mode ${integration.network_mode || "-"}`,
    };
    let html = readFileSync(staticIndexFile, "utf8");
    html = html.replace("</body>", `${renderBootstrapScript(payload)}\n</body>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
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
