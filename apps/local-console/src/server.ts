import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { execFile, spawnSync } from "child_process";
import { resolve } from "path";
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { createHash } from "crypto";
import { homedir, hostname } from "os";
import { promisify } from "util";
import defaults from "../../../config/silicaclaw-defaults.json";
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
  rebuildIndexForProfile,
  loadSocialConfig,
  getSocialConfigSearchPaths,
  resolveIdentityWithSocial,
  resolveProfileInputWithSocial,
  searchDirectory,
  signSocialMessage,
  signSocialMessageObservation,
  signPresence,
  signProfile,
  SocialConfig,
  SocialMessageObservationRecord,
  SocialMessageRecord,
  SocialRuntimeConfig,
  generateSocialMdTemplate,
  verifySocialMessage,
  verifySocialMessageObservation,
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
import {
  CacheRepo,
  IdentityRepo,
  LogRepo,
  ProfileRepo,
  SocialMessageGovernanceConfig,
  SocialMessageGovernanceRepo,
  SocialMessageRepo,
  SocialMessageObservationRepo,
  SocialRuntimeRepo,
} from "@silicaclaw/storage";
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
const OPENCLAW_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_NETWORK_MODE = defaults.network.default_mode as "global-preview";
const DEFAULT_NETWORK_NAMESPACE = defaults.network.default_namespace;
const DEFAULT_NETWORK_PORT = defaults.ports.network_default;
const DEFAULT_GLOBAL_SIGNALING_URL = defaults.network.global_preview.relay_url;
const DEFAULT_GLOBAL_ROOM = defaults.network.global_preview.room;
const DEFAULT_BRIDGE_API_BASE = defaults.bridge.api_base;
const OPENCLAW_GATEWAY_PORT = defaults.ports.openclaw_gateway;
const OPENCLAW_GATEWAY_URL = `http://${OPENCLAW_GATEWAY_HOST}:${OPENCLAW_GATEWAY_PORT}/`;
const NETWORK_PEER_REMOVE_AFTER_MS = Number(process.env.NETWORK_PEER_REMOVE_AFTER_MS || 180_000);
const NETWORK_UDP_BIND_ADDRESS = process.env.NETWORK_UDP_BIND_ADDRESS || "0.0.0.0";
const NETWORK_UDP_BROADCAST_ADDRESS = process.env.NETWORK_UDP_BROADCAST_ADDRESS || "255.255.255.255";
const NETWORK_PEER_ID = process.env.NETWORK_PEER_ID;
const NETWORK_MODE = process.env.NETWORK_MODE || "";
const WEBRTC_SIGNALING_URL = process.env.WEBRTC_SIGNALING_URL || DEFAULT_GLOBAL_SIGNALING_URL;
const WEBRTC_SIGNALING_URLS = process.env.WEBRTC_SIGNALING_URLS || "";
const WEBRTC_ROOM = process.env.WEBRTC_ROOM || DEFAULT_GLOBAL_ROOM;
const WEBRTC_SEED_PEERS = process.env.WEBRTC_SEED_PEERS || "";
const WEBRTC_BOOTSTRAP_HINTS = process.env.WEBRTC_BOOTSTRAP_HINTS || "";
const PROFILE_VERSION = "v0.9";
const SOCIAL_MESSAGE_TOPIC = "social.message";
const SOCIAL_MESSAGE_OBSERVATION_TOPIC = "social.message.observation";
const DEFAULT_SOCIAL_MESSAGE_CHANNEL = "global";
const SOCIAL_MESSAGE_MAX_BODY_CHARS = Number(process.env.SOCIAL_MESSAGE_MAX_BODY_CHARS || 500);
const SOCIAL_MESSAGE_HISTORY_LIMIT = Number(process.env.SOCIAL_MESSAGE_HISTORY_LIMIT || 100);
const SOCIAL_MESSAGE_SEND_WINDOW_MS = Number(process.env.SOCIAL_MESSAGE_SEND_WINDOW_MS || 60_000);
const SOCIAL_MESSAGE_SEND_MAX_PER_WINDOW = Number(process.env.SOCIAL_MESSAGE_SEND_MAX_PER_WINDOW || 5);
const SOCIAL_MESSAGE_RECEIVE_WINDOW_MS = Number(process.env.SOCIAL_MESSAGE_RECEIVE_WINDOW_MS || 60_000);
const SOCIAL_MESSAGE_RECEIVE_MAX_PER_WINDOW = Number(process.env.SOCIAL_MESSAGE_RECEIVE_MAX_PER_WINDOW || 8);
const SOCIAL_MESSAGE_DUPLICATE_WINDOW_MS = Number(process.env.SOCIAL_MESSAGE_DUPLICATE_WINDOW_MS || 180_000);
const SOCIAL_MESSAGE_MAX_FUTURE_MS = Number(process.env.SOCIAL_MESSAGE_MAX_FUTURE_MS || 30_000);
const SOCIAL_MESSAGE_MAX_AGE_MS = Number(process.env.SOCIAL_MESSAGE_MAX_AGE_MS || 15 * 60_000);
const SOCIAL_MESSAGE_OBSERVATION_HISTORY_LIMIT = Number(process.env.SOCIAL_MESSAGE_OBSERVATION_HISTORY_LIMIT || 500);
const SOCIAL_MESSAGE_REPLAY_WINDOW_MS = Number(process.env.SOCIAL_MESSAGE_REPLAY_WINDOW_MS || 10 * 60_000);
const SOCIAL_MESSAGE_REPLAY_MAX_PER_BROADCAST = Number(process.env.SOCIAL_MESSAGE_REPLAY_MAX_PER_BROADCAST || 3);
const SOCIAL_MESSAGE_BLOCKED_AGENT_IDS = new Set(
  dedupeStrings(parseListEnv(process.env.SOCIAL_MESSAGE_BLOCKED_AGENT_IDS || ""))
);
const SOCIAL_MESSAGE_BLOCKED_TERMS = dedupeStrings(parseListEnv(process.env.SOCIAL_MESSAGE_BLOCKED_TERMS || ""))
  .map((term) => term.trim().toLowerCase())
  .filter(Boolean);
const execFileAsync = promisify(execFile);
const OPENCLAW_SKILL_NAME = "silicaclaw-broadcast";

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

function normalizeVersionText(value: unknown): string {
  const text = String(value || "").trim();
  return text.startsWith("v") ? text.slice(1) : text;
}

function tokenizeVersion(value: unknown): Array<number | string> {
  return normalizeVersionText(value)
    .split(/[^0-9A-Za-z]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => (/^\d+$/.test(token) ? Number(token) : token.toLowerCase()));
}

function compareVersionTokens(left: unknown, right: unknown): number {
  const leftTokens = tokenizeVersion(left);
  const rightTokens = tokenizeVersion(right);
  const maxLength = Math.max(leftTokens.length, rightTokens.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (leftToken === undefined && rightToken === undefined) return 0;
    if (leftToken === undefined) return -1;
    if (rightToken === undefined) return 1;
    if (typeof leftToken === "number" && typeof rightToken === "number") {
      if (leftToken !== rightToken) return leftToken > rightToken ? 1 : -1;
      continue;
    }
    const leftText = String(leftToken);
    const rightText = String(rightToken);
    if (leftText !== rightText) return leftText.localeCompare(rightText);
  }
  return 0;
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

function resolveProjectRoot(appRoot: string, cwd = process.cwd()): string {
  const envRoot = String(process.env.SILICACLAW_WORKSPACE_DIR || "").trim();
  if (envRoot) {
    return resolve(envRoot);
  }
  if (
    existsSync(resolve(appRoot, "apps", "local-console", "package.json")) &&
    existsSync(resolve(appRoot, "package.json"))
  ) {
    return appRoot;
  }
  if (!existsSync(resolve(cwd, "apps", "local-console", "package.json"))) {
    return resolve(cwd);
  }
  return appRoot;
}

function resolveStorageRoot(workspaceRoot: string, cwd = process.cwd()): string {
  const home = process.env.HOME || homedir();
  if (home) {
    return resolve(home, ".silicaclaw", "local-console");
  }
  const appRoot = resolve(workspaceRoot, "apps", "local-console");
  if (existsSync(resolve(appRoot, "package.json"))) {
    return appRoot;
  }
  return cwd;
}

function defaultOpenClawSourceDir(rootDir: string): string {
  if (existsSync(resolve(rootDir, "openclaw.mjs")) || existsSync(resolve(rootDir, "package.json"))) {
    return rootDir;
  }
  return resolve(rootDir, "..", "openclaw");
}

function resolveExecutableInPath(binName: string): string | null {
  const pathValue = String(process.env.PATH || "").trim();
  if (!pathValue) return null;
  const pathEntries = pathValue.split(":").map((item) => item.trim()).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = resolve(entry, binName);
    if (!existsSync(candidate)) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // ignore non-executable matches
    }
  }
  return null;
}

function existingPathOrNull(filePath: string): string | null {
  return existsSync(filePath) ? filePath : null;
}

function listDirectories(root: string) {
  if (!root || !existsSync(root)) return [];
  try {
    return readdirSync(root)
      .map((name) => {
        const fullPath = resolve(root, name);
        try {
          return statSync(fullPath).isDirectory() ? { name, path: fullPath } : null;
        } catch {
          return null;
        }
      })
      .filter((item): item is { name: string; path: string } => Boolean(item));
  } catch {
    return [];
  }
}

function readJsonFileSafe(filePath: string) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function summarizeSkillReadme(filePath: string) {
  if (!filePath || !existsSync(filePath)) return "";
  try {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("#"));
    return String(lines[0] || "").slice(0, 220);
  } catch {
    return "";
  }
}

function readDialogueCheatsheetPreview(filePath: string, limit = 6) {
  if (!filePath || !existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}

function readDialogueCheatsheetSections(filePath: string, maxSections = 3, maxItemsPerSection = 5) {
  if (!filePath || !existsSync(filePath)) return [];
  try {
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    const sections: Array<{ title: string; items: string[] }> = [];
    let current: { title: string; items: string[] } | null = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith("## ")) {
        if (current && current.items.length) sections.push(current);
        current = { title: line.slice(3).trim(), items: [] };
        continue;
      }
      if (line.startsWith("- ")) {
        if (!current) {
          current = { title: "Examples", items: [] };
        }
        if (current.items.length < maxItemsPerSection) {
          current.items.push(line.slice(2).trim());
        }
      }
    }
    if (current && current.items.length) sections.push(current);
    return sections.slice(0, maxSections);
  } catch {
    return [];
  }
}

function detectOpenClawInstallation(workspaceRoot: string) {
  const workspaceDir = resolve(workspaceRoot, ".openclaw");
  const homeDir = resolve(process.env.HOME || "", ".openclaw");
  const commandPath = resolveExecutableInPath("openclaw");

  const workspaceIdentityPath = existingPathOrNull(resolve(workspaceDir, "identity.json"));
  const workspaceProfilePath = existingPathOrNull(resolve(workspaceDir, "profile.json"));
  const workspaceSocialPath = existingPathOrNull(resolve(workspaceDir, "social.md"));
  const workspaceSkillsPath = existingPathOrNull(resolve(workspaceDir, "skills"));
  const homeIdentityPath = existingPathOrNull(resolve(homeDir, "identity.json"));
  const homeProfilePath = existingPathOrNull(resolve(homeDir, "profile.json"));
  const homeSocialPath = existingPathOrNull(resolve(homeDir, "social.md"));
  const homeSkillsPath = existingPathOrNull(resolve(homeDir, "skills"));

  const workspaceDetected = Boolean(
    existsSync(workspaceDir) ||
    workspaceIdentityPath ||
    workspaceProfilePath ||
    workspaceSocialPath ||
    workspaceSkillsPath
  );
  const homeDetected = Boolean(
    existsSync(homeDir) || homeIdentityPath || homeProfilePath || homeSocialPath || homeSkillsPath
  );

  return {
    detected: Boolean(commandPath || workspaceDetected || homeDetected),
    detection_mode: commandPath
      ? "command"
      : workspaceDetected
        ? "workspace"
        : homeDetected
          ? "home"
          : "not_found",
    command_path: commandPath,
    workspace_dir: workspaceDir,
    home_dir: homeDir,
    workspace_dir_exists: existsSync(workspaceDir),
    home_dir_exists: existsSync(homeDir),
    workspace_identity_path: workspaceIdentityPath,
    workspace_profile_path: workspaceProfilePath,
    workspace_social_path: workspaceSocialPath,
    workspace_skills_path: workspaceSkillsPath,
    home_identity_path: homeIdentityPath,
    home_profile_path: homeProfilePath,
    home_social_path: homeSocialPath,
    home_skills_path: homeSkillsPath,
  } as const;
}

function readOpenClawConfiguredGateway(workspaceRoot: string) {
  const configuredSourceDir = String(process.env.OPENCLAW_SOURCE_DIR || "").trim();
  const defaultSourceDir = defaultOpenClawSourceDir(workspaceRoot);
  const sourceDir = configuredSourceDir || defaultSourceDir;
  const homeDir = resolve(process.env.HOME || "", ".openclaw");
  const explicitConfigPath = String(process.env.OPENCLAW_CONFIG_PATH || "").trim();
  const explicitStateDir = String(process.env.OPENCLAW_STATE_DIR || "").trim();
  const candidates = dedupeStrings([
    explicitConfigPath,
    explicitStateDir ? resolve(explicitStateDir, "openclaw.json") : "",
    resolve(homeDir, "openclaw.json"),
    resolve(homeDir, "clawdbot.json"),
    resolve(sourceDir, ".openclaw", "openclaw.json"),
  ]);

  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    try {
      const raw = readFileSync(candidate, "utf8");
      const portMatch = raw.match(/["']?port["']?\s*:\s*(\d{2,5})/);
      const bindMatch = raw.match(/["']?bind["']?\s*:\s*["']([^"']+)["']/);
      const port = portMatch ? Number(portMatch[1]) : OPENCLAW_GATEWAY_PORT;
      if (!Number.isFinite(port) || port <= 0) continue;
      return {
        config_path: candidate,
        gateway_port: port,
        gateway_host: OPENCLAW_GATEWAY_HOST,
        gateway_bind: bindMatch?.[1] || null,
        gateway_url: `http://${OPENCLAW_GATEWAY_HOST}:${port}/`,
      } as const;
    } catch {
      continue;
    }
  }

  return {
    config_path: null,
    gateway_port: OPENCLAW_GATEWAY_PORT,
    gateway_host: OPENCLAW_GATEWAY_HOST,
    gateway_bind: null,
    gateway_url: OPENCLAW_GATEWAY_URL,
  } as const;
}

function detectOpenClawRuntime(workspaceRoot: string) {
  const configuredGateway = readOpenClawConfiguredGateway(workspaceRoot);
  const result = spawnSync("ps", ["-Ao", "pid=,ppid=,command="], {
    encoding: "utf8",
  });
  const stdout = String(result.stdout || "");
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const processes = lines
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      const command = match[3] || "";
      const lower = command.toLowerCase();
      const isOpenClaw =
        lower.includes(" openclaw ") ||
        lower.endsWith(" openclaw") ||
        lower.includes("/openclaw ") ||
        lower.includes("openclaw.mjs") ||
        lower.includes("openclaw gateway") ||
        lower.includes("openclaw agent") ||
        lower.includes("openclaw message");
      if (!isOpenClaw) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command,
      };
    })
    .filter((item): item is { pid: number; ppid: number; command: string } => Boolean(item));

  const openclawPids = new Set(processes.map((item) => item.pid));
  const gatewayProbe = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  const gatewayLines = String(gatewayProbe.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const gatewayListeners = gatewayLines
    .slice(1)
    .map((line) => {
      const parts = line.split(/\s+/);
      const pid = Number(parts[1] || 0);
      const command = parts[0] || "";
      const lowerCommand = command.toLowerCase();
      const endpoint = parts[8] || parts[parts.length - 1] || "";
      const portMatch = endpoint.match(/:(\d+)(?:\s*\(|$)/);
      if (!pid || !command || !portMatch) return null;
      const isOpenClawListener =
        openclawPids.has(pid) ||
        lowerCommand.includes("openclaw");
      if (!isOpenClawListener) return null;
      const port = Number(portMatch[1]);
      if (!Number.isFinite(port) || port <= 0) return null;
      return {
        pid,
        ppid: 0,
        port,
        command: `${command} listening on ${OPENCLAW_GATEWAY_HOST}:${port}`,
      };
    })
    .filter((item): item is { pid: number; ppid: number; port: number; command: string } => Boolean(item));
  const preferredListener =
    gatewayListeners.find((item) => item.port === configuredGateway.gateway_port) ||
    gatewayListeners[0] ||
    null;

  const combinedProcesses = new Map<number, { pid: number; ppid: number; command: string }>();
  for (const process of [...processes, ...gatewayListeners]) {
    if (!combinedProcesses.has(process.pid)) {
      combinedProcesses.set(process.pid, process);
      continue;
    }
    const current = combinedProcesses.get(process.pid);
    if (current && current.command.length < process.command.length) {
      combinedProcesses.set(process.pid, process);
    }
  }
  const allProcesses = Array.from(combinedProcesses.values());
  const gatewayReachable = gatewayListeners.length > 0;
  const detectionNotes = [];
  if (result.status !== 0) detectionNotes.push(String(result.stderr || "ps failed").trim());
  if (gatewayProbe.status !== 0 && gatewayLines.length === 0) {
    detectionNotes.push(String(gatewayProbe.stderr || "lsof failed").trim());
  }
  const gatewayPort = preferredListener?.port || configuredGateway.gateway_port;
  const gatewayUrl = `http://${OPENCLAW_GATEWAY_HOST}:${gatewayPort}/`;

  return {
    running: allProcesses.length > 0 || gatewayReachable,
    process_count: allProcesses.length,
    processes: allProcesses.slice(0, 10),
    detection_error: detectionNotes.filter(Boolean).join(" | ") || null,
    gateway_url: gatewayUrl,
    gateway_port: gatewayPort,
    gateway_reachable: gatewayReachable,
    configured_gateway_url: configuredGateway.gateway_url,
    configured_gateway_port: configuredGateway.gateway_port,
    configured_gateway_bind: configuredGateway.gateway_bind,
    configured_gateway_config_path: configuredGateway.config_path,
    detection_mode:
      processes.length > 0 && gatewayReachable
        ? "process+gateway"
        : gatewayReachable
          ? "gateway"
          : processes.length > 0
            ? "process"
            : "not_running",
  } as const;
}

function detectOpenClawSkillInstallation() {
  const homeDir = resolve(process.env.HOME || "", ".openclaw");
  const workspaceSkillRoot = resolve(homeDir, "workspace", "skills");
  const legacySkillRoot = resolve(homeDir, "skills");
  const workspaceSkillPath = resolve(workspaceSkillRoot, OPENCLAW_SKILL_NAME, "SKILL.md");
  const legacySkillPath = resolve(legacySkillRoot, OPENCLAW_SKILL_NAME, "SKILL.md");
  const workspaceInstalled = existsSync(workspaceSkillPath);
  const legacyInstalled = existsSync(legacySkillPath);

  return {
    installed: workspaceInstalled || legacyInstalled,
    install_mode: workspaceInstalled ? "workspace" : legacyInstalled ? "legacy" : "not_installed",
    workspace_skill_root: workspaceSkillRoot,
    legacy_skill_root: legacySkillRoot,
    workspace_skill_path: workspaceInstalled ? workspaceSkillPath : null,
    legacy_skill_path: legacyInstalled ? legacySkillPath : null,
  } as const;
}

function detectOwnerDeliveryStatus(params: {
  workspaceRoot: string;
  connectedToSilicaclaw: boolean;
  openclawRunning: boolean;
  skillInstalled: boolean;
}) {
  const forwardCommand = String(process.env.OPENCLAW_OWNER_FORWARD_CMD || "").trim();
  const ownerChannel = String(process.env.OPENCLAW_OWNER_CHANNEL || "").trim();
  const ownerTarget = String(process.env.OPENCLAW_OWNER_TARGET || "").trim();
  const ownerAccount = String(process.env.OPENCLAW_OWNER_ACCOUNT || "").trim();
  const explicitOpenClawBin = String(process.env.OPENCLAW_BIN || "").trim();
  const configuredSourceDir = String(process.env.OPENCLAW_SOURCE_DIR || "").trim();
  const defaultSourceDir = defaultOpenClawSourceDir(params.workspaceRoot);
  const openclawSourceDir = configuredSourceDir || defaultSourceDir;
  const openclawSourceEntry = existingPathOrNull(resolve(openclawSourceDir, "openclaw.mjs"));
  const openclawCommandResolvable = Boolean(explicitOpenClawBin || resolveExecutableInPath("openclaw") || openclawSourceEntry);
  const bridgeMessagesReadable = params.connectedToSilicaclaw && params.openclawRunning && params.skillInstalled;
  const forwardCommandConfigured = Boolean(forwardCommand);
  const ownerRouteConfigured = Boolean(ownerChannel && ownerTarget);
  const ready =
    bridgeMessagesReadable && forwardCommandConfigured && ownerRouteConfigured && openclawCommandResolvable;

  let reason = "";
  if (!params.connectedToSilicaclaw) {
    reason = "SilicaClaw social bridge is not connected yet, so there is no broadcast stream for OpenClaw to learn.";
  } else if (!params.openclawRunning) {
    reason = "OpenClaw is not running on this machine yet, so broadcast learning and owner forwarding are idle.";
  } else if (!params.skillInstalled) {
    reason = "OpenClaw is running, but the silicaclaw-broadcast skill is not installed yet.";
  } else if (!forwardCommandConfigured) {
    reason = "Broadcast learning is ready, but OPENCLAW_OWNER_FORWARD_CMD is not configured yet.";
  } else if (!ownerRouteConfigured) {
    reason = "The owner forward command exists, but OPENCLAW_OWNER_CHANNEL and OPENCLAW_OWNER_TARGET are still missing.";
  } else if (!openclawCommandResolvable) {
    reason = "Owner forwarding is configured, but no runnable OpenClaw CLI or source checkout was found.";
  } else {
    reason = "This machine can read SilicaClaw broadcasts and route owner summaries through OpenClaw.";
  }

  return {
    supported: bridgeMessagesReadable,
    mode: "public-broadcast-via-openclaw" as const,
    send_to_owner_via_openclaw: ready,
    bridge_messages_readable: bridgeMessagesReadable,
    forward_command_configured: forwardCommandConfigured,
    openclaw_command_resolvable: openclawCommandResolvable,
    ready,
    forward_command: forwardCommand || null,
    owner_channel: ownerChannel || null,
    owner_target: ownerTarget || null,
    owner_account: ownerAccount || null,
    openclaw_source_dir: openclawSourceEntry ? openclawSourceDir : null,
    reason,
  };
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

function migrateLegacyDataIfNeeded(appRoot: string, projectRoot: string, storageRoot: string): void {
  const targetDataDir = resolve(storageRoot, "data");
  const legacyDataDirs = [
    resolve(appRoot, "data"),
    resolve(appRoot, "apps", "local-console", "data"),
    resolve(projectRoot, "data"),
    resolve(projectRoot, "apps", "local-console", "data"),
    resolve(process.cwd(), "data"),
  ].filter((dir, index, list) => list.indexOf(dir) === index && dir !== targetDataDir);
  const files = [
    "identity.json",
    "profile.json",
    "cache.json",
    "logs.json",
    "social-messages.json",
    "social-message-observations.json",
  ];
  for (const file of files) {
    const dst = resolve(targetDataDir, file);
    if (hasMeaningfulJson(dst)) continue;
    for (const legacyDataDir of legacyDataDirs) {
      const src = resolve(legacyDataDir, file);
      if (!existsSync(src)) continue;
      if (!hasMeaningfulJson(src)) continue;
      mkdirSync(targetDataDir, { recursive: true });
      copyFileSync(src, dst);
      break;
    }
  }

  const targetDotDir = resolve(storageRoot, ".silicaclaw");
  const legacyDotDirs = [
    resolve(appRoot, ".silicaclaw"),
    resolve(appRoot, "apps", "local-console", ".silicaclaw"),
    resolve(projectRoot, ".silicaclaw"),
    resolve(projectRoot, "apps", "local-console", ".silicaclaw"),
    resolve(process.cwd(), ".silicaclaw"),
  ].filter((dir, index, list) => list.indexOf(dir) === index && dir !== targetDotDir);
  const dotFiles = ["social.runtime.json", "social.message-governance.json"];
  for (const file of dotFiles) {
    const dst = resolve(targetDotDir, file);
    if (hasMeaningfulJson(dst)) continue;
    for (const legacyDotDir of legacyDotDirs) {
      const src = resolve(legacyDotDir, file);
      if (!existsSync(src)) continue;
      if (!hasMeaningfulJson(src)) continue;
      mkdirSync(targetDotDir, { recursive: true });
      copyFileSync(src, dst);
      break;
    }
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

type SocialMessageView = SocialMessageRecord & {
  is_self: boolean;
  online: boolean;
  last_seen_at: number | null;
  observation_count: number;
  remote_observation_count: number;
  last_observed_at: number | null;
  delivery_status: "local-only" | "remote-observed";
};

type RuntimeMessageGovernance = SocialMessageGovernanceConfig;

type OpenClawBridgeStatus = {
  enabled: boolean;
  connected_to_silicaclaw: boolean;
  public_enabled: boolean;
  message_broadcast_enabled: boolean;
  network_mode: "local" | "lan" | "global-preview";
  adapter: string;
  agent_id: string;
  display_name: string;
  identity_source: "silicaclaw-existing" | "openclaw-existing" | "silicaclaw-generated";
  openclaw_identity_source_path: string | null;
  social_source_path: string | null;
  openclaw_installation: {
    detected: boolean;
    detection_mode: "command" | "workspace" | "home" | "not_found";
    command_path: string | null;
    workspace_dir: string;
    home_dir: string;
    workspace_dir_exists: boolean;
    home_dir_exists: boolean;
    workspace_identity_path: string | null;
    workspace_profile_path: string | null;
    workspace_social_path: string | null;
    workspace_skills_path: string | null;
    home_identity_path: string | null;
    home_profile_path: string | null;
    home_social_path: string | null;
    home_skills_path: string | null;
  };
  openclaw_runtime: {
    running: boolean;
    process_count: number;
    processes: Array<{
      pid: number;
      ppid: number;
      command: string;
    }>;
    detection_error: string | null;
    gateway_url: string;
    gateway_port: number;
    gateway_reachable: boolean;
    configured_gateway_url: string;
    configured_gateway_port: number;
    configured_gateway_bind: string | null;
    configured_gateway_config_path: string | null;
    detection_mode: "process" | "gateway" | "process+gateway" | "not_running";
  };
  skill_learning: {
    available: boolean;
    installed: boolean;
    install_mode: "workspace" | "legacy" | "not_installed";
    installed_skill_path: string | null;
    install_action: {
      supported: boolean;
      endpoint: string;
      recommended_command: string;
    };
    skills: Array<{
      key: "get_profile" | "list_messages" | "watch_messages" | "send_message";
      summary: string;
      endpoint: string;
    }>;
  };
  owner_delivery: {
    supported: boolean;
    mode: "public-broadcast-via-openclaw";
    send_to_owner_via_openclaw: boolean;
    bridge_messages_readable: boolean;
    forward_command_configured: boolean;
    openclaw_command_resolvable: boolean;
    ready: boolean;
    forward_command: string | null;
    owner_channel: string | null;
    owner_target: string | null;
    owner_account: string | null;
    openclaw_source_dir: string | null;
    reason: string;
  };
  endpoints: {
    status: string;
    profile: string;
    messages: string;
    send_message: string;
    install_skill: string;
  };
};

type OpenClawBridgeConfigView = {
  bridge_api_base: string;
  openclaw_detected: boolean;
  openclaw_running: boolean;
  openclaw_gateway_host: string;
  openclaw_gateway_port: number;
  openclaw_gateway_url: string;
  openclaw_gateway_config_path: string | null;
  openclaw_workspace_skill_dir: string;
  openclaw_legacy_skill_dir: string;
  silicaclaw_env_template_path: string;
  recommended_skill_name: string;
  recommended_install_command: string;
  recommended_owner_forward_env: {
    OPENCLAW_SOURCE_DIR: string;
    OPENCLAW_OWNER_CHANNEL: string;
    OPENCLAW_OWNER_TARGET: string;
    OPENCLAW_OWNER_ACCOUNT: string;
    OPENCLAW_OWNER_FORWARD_CMD: string;
  };
  owner_forward_command_example: string;
  notes: string[];
};

export class LocalNodeService {
  private workspaceRoot: string;
  private projectRoot: string;
  private storageRoot: string;
  private identityRepo: IdentityRepo;
  private profileRepo: ProfileRepo;
  private cacheRepo: CacheRepo;
  private logRepo: LogRepo;
  private socialMessageGovernanceRepo: SocialMessageGovernanceRepo;
  private socialMessageRepo: SocialMessageRepo;
  private socialMessageObservationRepo: SocialMessageObservationRepo;
  private socialRuntimeRepo: SocialRuntimeRepo;

  private identity: AgentIdentity | null = null;
  private profile: PublicProfile | null = null;
  private directory: DirectoryState = createEmptyDirectoryState();
  private socialMessages: SocialMessageRecord[] = [];
  private socialMessageObservations: SocialMessageObservationRecord[] = [];
  private messageGovernance: RuntimeMessageGovernance;

  private receivedCount = 0;
  private broadcastCount = 0;
  private lastMessageAt = 0;
  private lastBroadcastAt = 0;
  private lastBroadcastErrorAt = 0;
  private lastBroadcastError: string | null = null;
  private broadcastFailureCount = 0;
  private broadcaster: NodeJS.Timeout | null = null;
  private subscriptionsBound = false;
  private broadcastEnabled = true;

  private receivedByTopic: Record<string, number> = {};
  private publishedByTopic: Record<string, number> = {};
  private outboundMessageTimestamps: number[] = [];
  private inboundMessageTimestampsByAgent: Record<string, number[]> = {};

  private initState: InitState = {
    identity_auto_created: false,
    profile_auto_created: false,
    social_auto_created: false,
    initialized_at: 0,
  };

  private network: NetworkAdapter;
  private adapterMode: "mock" | "local-event-bus" | "real-preview" | "webrtc-preview" | "relay-preview";
  private networkMode: "local" | "lan" | "global-preview" = DEFAULT_NETWORK_MODE;
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
  private webrtcRoom = DEFAULT_GLOBAL_ROOM;
  private webrtcSeedPeers: string[] = [];
  private webrtcBootstrapHints: string[] = [];
  private webrtcBootstrapSources: string[] = [];
  private appVersion = "unknown";

  constructor(options?: { workspaceRoot?: string; projectRoot?: string; storageRoot?: string }) {
    this.workspaceRoot = options?.workspaceRoot || resolveWorkspaceRoot();
    this.projectRoot = options?.projectRoot || resolveProjectRoot(this.workspaceRoot);
    this.storageRoot = options?.storageRoot || resolveStorageRoot(this.workspaceRoot);
    this.appVersion = readWorkspaceVersion(this.workspaceRoot);
    migrateLegacyDataIfNeeded(this.workspaceRoot, this.projectRoot, this.storageRoot);

    this.identityRepo = new IdentityRepo(this.storageRoot);
    this.profileRepo = new ProfileRepo(this.storageRoot);
    this.cacheRepo = new CacheRepo(this.storageRoot);
    this.logRepo = new LogRepo(this.storageRoot);
    this.socialMessageGovernanceRepo = new SocialMessageGovernanceRepo(this.storageRoot);
    this.socialMessageRepo = new SocialMessageRepo(this.storageRoot);
    this.socialMessageObservationRepo = new SocialMessageObservationRepo(this.storageRoot);
    this.socialRuntimeRepo = new SocialRuntimeRepo(this.storageRoot);
    this.messageGovernance = this.defaultMessageGovernance();

    let loadedSocial = loadSocialConfig(this.projectRoot);
    if (!loadedSocial.meta.found) {
      ensureDefaultSocialMd(this.projectRoot, {
        display_name: this.getDefaultDisplayName(),
        bio: "Local AI agent connected to SilicaClaw",
        tags: ["openclaw", "local-first"],
        mode: DEFAULT_NETWORK_MODE,
        public_enabled: false,
      });
      loadedSocial = loadSocialConfig(this.projectRoot);
      this.initState.social_auto_created = true;
    }
    this.socialConfig = loadedSocial.config;
    this.socialSourcePath = loadedSocial.meta.source_path;
    this.socialFound = loadedSocial.meta.found;
    this.socialParseError = loadedSocial.meta.parse_error;
    this.socialRawFrontmatter = loadedSocial.raw_frontmatter;

    this.networkNamespace = this.socialConfig.network.namespace || process.env.NETWORK_NAMESPACE || DEFAULT_NETWORK_NAMESPACE;
    this.networkPort = Number(this.socialConfig.network.port || process.env.NETWORK_PORT || DEFAULT_NETWORK_PORT);
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
      try {
        await this.broadcastNow("adapter_start");
      } catch (error) {
        await this.log(
          "warn",
          `Initial broadcast failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
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
    const discovered = this.search("");
    const onlineCount = discovered.filter((profile) => profile.online).length;

    return {
      app_version: this.appVersion,
      agent_id: this.identity?.agent_id ?? "",
      public_enabled: Boolean(this.profile?.public_enabled),
      broadcast_enabled: this.broadcastEnabled,
      last_broadcast_at: this.lastBroadcastAt,
      last_broadcast_error_at: this.lastBroadcastErrorAt,
      last_broadcast_error: this.lastBroadcastError,
      broadcast_failure_count: this.broadcastFailureCount,
      discovered_count: discovered.length,
      online_count: onlineCount,
      offline_count: Math.max(0, discovered.length - onlineCount),
      init_state: this.initState,
      presence_ttl_ms: PRESENCE_TTL_MS,
      onboarding: this.getOnboardingSummary(),
      social: {
        found: this.socialFound,
        enabled: this.socialConfig.enabled,
        source_path: this.socialSourcePath,
        network_mode: this.networkMode,
        mode_explainer: this.getModeExplainer(),
      governance: {
        send_limit: { max: this.messageGovernance.send_limit_max, window_ms: this.messageGovernance.send_window_ms },
        receive_limit: { max: this.messageGovernance.receive_limit_max, window_ms: this.messageGovernance.receive_window_ms },
        duplicate_window_ms: this.messageGovernance.duplicate_window_ms,
        blocked_agent_count: this.messageGovernance.blocked_agent_ids.length,
        blocked_term_count: this.messageGovernance.blocked_terms.length,
      },
      },
    };
  }

  getNetworkSummary() {
    const network = this.getResolvedRealtimeNetworkSummary();
    const diagnostics = network.diagnostics;
    const relayCapable = this.adapterMode === "webrtc-preview" || this.adapterMode === "relay-preview";
    const peerCount = diagnostics?.peers.total ?? 0;

    return {
      status: "running",
      adapter: this.adapterMode,
      mode: this.networkMode,
      received_count: this.receivedCount,
      broadcast_count: this.broadcastCount,
      broadcast_failure_count: this.broadcastFailureCount,
      last_message_at: this.lastMessageAt,
      last_broadcast_at: this.lastBroadcastAt,
      last_broadcast_error_at: this.lastBroadcastErrorAt,
      last_broadcast_error: this.lastBroadcastError,
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
      webrtc_preview: relayCapable
        ? {
            signaling_url: network.signaling_url,
            signaling_endpoints: network.signaling_endpoints,
            room: network.room,
            bootstrap_sources: network.bootstrap_sources,
            seed_peers_count: network.seed_peers_count,
            discovery_events_total: diagnostics?.discovery_events_total ?? 0,
            last_discovery_event_at: diagnostics?.last_discovery_event_at ?? 0,
            active_webrtc_peers: diagnostics?.active_webrtc_peers ?? 0,
            reconnect_attempts_total: diagnostics?.reconnect_attempts_total ?? 0,
            last_join_at: diagnostics?.last_join_at ?? 0,
            last_poll_at: diagnostics?.last_poll_at ?? 0,
            last_publish_at: diagnostics?.last_publish_at ?? 0,
            last_peer_refresh_at: diagnostics?.last_peer_refresh_at ?? 0,
            last_error_at: diagnostics?.last_error_at ?? 0,
            last_error: diagnostics?.last_error ?? null,
          }
        : null,
    };
  }

  getNetworkConfig() {
    const network = this.getResolvedRealtimeNetworkSummary();
    const diagnostics = network.diagnostics;
    const relayCapable = this.adapterMode === "webrtc-preview" || this.adapterMode === "relay-preview";
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
      adapter_extra: relayCapable
        ? {
            signaling_url: network.signaling_url,
            signaling_endpoints: network.signaling_endpoints,
            room: network.room,
            bootstrap_sources: network.bootstrap_sources,
            seed_peers_count: network.seed_peers_count,
            discovery_events_total: diagnostics?.discovery_events_total ?? 0,
            last_discovery_event_at: diagnostics?.last_discovery_event_at ?? 0,
            connection_states_summary: diagnostics?.connection_states_summary ?? null,
            datachannel_states_summary: diagnostics?.datachannel_states_summary ?? null,
            last_join_at: diagnostics?.last_join_at ?? 0,
            last_poll_at: diagnostics?.last_poll_at ?? 0,
            last_publish_at: diagnostics?.last_publish_at ?? 0,
            last_peer_refresh_at: diagnostics?.last_peer_refresh_at ?? 0,
            last_error_at: diagnostics?.last_error_at ?? 0,
            last_error: diagnostics?.last_error ?? null,
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
      mode_explainer: this.getModeExplainer(),
    };
  }

  getNetworkStats() {
    const network = this.getResolvedRealtimeNetworkSummary();
    const diagnostics = network.diagnostics;
    const relayCapable = this.adapterMode === "webrtc-preview" || this.adapterMode === "relay-preview";
    const peers: Array<{ status?: string }> = diagnostics?.peers?.items ?? [];
    const online = peers.filter((peer: { status?: string }) => peer.status === "online").length;

    return {
      adapter: this.adapterMode,
      mode: this.networkMode,
      message_counters: {
        received_total: this.receivedCount,
        broadcast_total: this.broadcastCount,
        broadcast_failures_total: this.broadcastFailureCount,
        last_message_at: this.lastMessageAt,
        last_broadcast_at: this.lastBroadcastAt,
        last_broadcast_error_at: this.lastBroadcastErrorAt,
        last_broadcast_error: this.lastBroadcastError,
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
      adapter_diagnostics_summary: relayCapable || diagnostics
        ? {
            signaling_url: network.signaling_url,
            signaling_endpoints: network.signaling_endpoints,
            room: network.room,
            bootstrap_sources: network.bootstrap_sources,
            seed_peers_count: network.seed_peers_count,
            discovery_events_total: diagnostics?.discovery_events_total ?? 0,
            last_discovery_event_at: diagnostics?.last_discovery_event_at ?? 0,
            connection_states_summary: diagnostics?.connection_states_summary ?? null,
            datachannel_states_summary: diagnostics?.datachannel_states_summary ?? null,
            signaling_messages_sent_total: diagnostics?.signaling_messages_sent_total ?? null,
            signaling_messages_received_total: diagnostics?.signaling_messages_received_total ?? null,
            reconnect_attempts_total: diagnostics?.reconnect_attempts_total ?? null,
            active_webrtc_peers: diagnostics?.active_webrtc_peers ?? null,
            last_join_at: diagnostics?.last_join_at ?? 0,
            last_poll_at: diagnostics?.last_poll_at ?? 0,
            last_publish_at: diagnostics?.last_publish_at ?? 0,
            last_peer_refresh_at: diagnostics?.last_peer_refresh_at ?? 0,
            last_error_at: diagnostics?.last_error_at ?? 0,
            last_error: diagnostics?.last_error ?? null,
          }
        : null,
    };
  }

  getPeersSummary() {
    const network = this.getResolvedRealtimeNetworkSummary();
    const diagnostics = network.diagnostics;
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
        signaling_url: network.signaling_url,
        signaling_endpoints: network.signaling_endpoints,
        room: network.room,
        bootstrap_sources: network.bootstrap_sources,
        seed_peers_count: network.seed_peers_count,
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
      project_root: this.projectRoot,
      storage_root: this.storageRoot,
      data_dir: resolve(this.storageRoot, "data"),
      social_runtime_path: resolve(this.storageRoot, ".silicaclaw", "social.runtime.json"),
      local_console_public_dir: resolve(this.workspaceRoot, "apps", "local-console", "public"),
      social_lookup_paths: getSocialConfigSearchPaths(this.projectRoot),
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
    const before = {
      mode: this.networkMode,
      adapter: this.adapterMode,
      namespace: this.networkNamespace,
      port: this.networkPort,
    };
    if (mode !== "local" && mode !== "lan" && mode !== "global-preview") {
      throw new Error("invalid_network_mode");
    }
    this.socialConfig.network.mode = mode;
    this.socialConfig.network.adapter = this.adapterForMode(mode);
    this.applyResolvedNetworkConfig();

    const needsRestart =
      before.mode !== this.networkMode ||
      before.adapter !== this.socialConfig.network.adapter ||
      before.namespace !== this.networkNamespace ||
      (before.port ?? null) !== (this.networkPort ?? null);

    if (needsRestart) {
      await this.restartNetworkAdapter("set_network_mode_runtime");
    }

    this.socialNetworkRequiresRestart = false;
    await this.writeSocialRuntime();
    return {
      mode: this.networkMode,
      adapter: this.adapterMode,
      network_requires_restart: false,
      note: "Runtime mode updated and adapter restarted. Existing social.md is unchanged.",
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
    this.socialConfig.network.room = room || DEFAULT_GLOBAL_ROOM;
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

    const loaded = loadSocialConfig(this.projectRoot);
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

    if (this.socialNetworkRequiresRestart) {
      await this.restartNetworkAdapter("reload_social_config");
      this.socialNetworkRequiresRestart = false;
    }

    await this.writeSocialRuntime();

    return this.getSocialConfigView();
  }

  async generateDefaultSocialMd() {
    const result = ensureDefaultSocialMd(this.projectRoot, {
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
    const directMatches = searchDirectory(this.directory, keyword, { presenceTTLms: PRESENCE_TTL_MS }).map((profile) => {
      const lastSeenAt = this.directory.presence[profile.agent_id] ?? 0;
      return this.toPublicProfileSummary(profile, { last_seen_at: lastSeenAt });
    });
    return this.mergeMessageOnlyAgentSummaries(directMatches, keyword);
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

  getSocialMessages(limit = 50, options?: { agent_id?: string | null }): {
    total: number;
    items: SocialMessageView[];
    governance: {
      send_limit: { max: number; window_ms: number };
      receive_limit: { max: number; window_ms: number };
      duplicate_window_ms: number;
      blocked_agent_count: number;
      blocked_term_count: number;
    };
  } {
    const resolvedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    this.ensureLocalDirectoryBaseline();
    this.compactCacheInMemory();
    const agentId = String(options?.agent_id || "").trim();
    const filtered = agentId
      ? this.socialMessages.filter((message) => message.agent_id === agentId)
      : this.socialMessages;
    return {
      total: filtered.length,
      items: filtered.slice(0, resolvedLimit).map((message) => {
        const profile = this.directory.profiles[message.agent_id];
        const lastSeenAt = this.directory.presence[message.agent_id] ?? 0;
        const observations = this.socialMessageObservations.filter((item) => item.message_id === message.message_id);
        const remoteObservationCount = observations.filter((item) => item.observer_agent_id !== message.agent_id).length;
        const lastObservedAt = observations.length > 0 ? Math.max(...observations.map((item) => item.observed_at)) : 0;
        return {
          ...message,
          display_name: profile?.display_name || message.display_name || "Unnamed",
          is_self: message.agent_id === this.identity?.agent_id,
          online: isAgentOnline(lastSeenAt, Date.now(), PRESENCE_TTL_MS),
          last_seen_at: lastSeenAt || null,
          observation_count: observations.length,
          remote_observation_count: remoteObservationCount,
          last_observed_at: lastObservedAt || null,
          delivery_status: remoteObservationCount > 0 ? "remote-observed" : "local-only",
        };
      }),
      governance: {
        send_limit: { max: this.messageGovernance.send_limit_max, window_ms: this.messageGovernance.send_window_ms },
        receive_limit: { max: this.messageGovernance.receive_limit_max, window_ms: this.messageGovernance.receive_window_ms },
        duplicate_window_ms: this.messageGovernance.duplicate_window_ms,
        blocked_agent_count: this.messageGovernance.blocked_agent_ids.length,
        blocked_term_count: this.messageGovernance.blocked_terms.length,
      },
    };
  }

  getOpenClawBridgeStatus(): OpenClawBridgeStatus {
    const integration = this.getIntegrationStatus();
    const openclawInstallation = detectOpenClawInstallation(this.projectRoot);
    const openclawRuntime = detectOpenClawRuntime(this.projectRoot);
    const skillInstallation = detectOpenClawSkillInstallation();
    const ownerDelivery = detectOwnerDeliveryStatus({
      workspaceRoot: this.projectRoot,
      connectedToSilicaclaw: integration.connected_to_silicaclaw,
      openclawRunning: openclawRuntime.running,
      skillInstalled: skillInstallation.installed,
    });
    return {
      enabled: this.socialConfig.enabled,
      connected_to_silicaclaw: integration.connected_to_silicaclaw,
      public_enabled: integration.public_enabled,
      message_broadcast_enabled: this.socialConfig.discovery.allow_message_broadcast && this.broadcastEnabled,
      network_mode: this.networkMode,
      adapter: this.adapterMode,
      agent_id: this.identity?.agent_id ?? "",
      display_name: this.profile?.display_name ?? "",
      identity_source: this.resolvedIdentitySource,
      openclaw_identity_source_path: this.resolvedOpenClawIdentityPath,
      social_source_path: this.socialSourcePath,
      openclaw_installation: openclawInstallation,
      openclaw_runtime: openclawRuntime,
      skill_learning: {
        available: integration.connected_to_silicaclaw && openclawRuntime.running,
        installed: skillInstallation.installed,
        install_mode: skillInstallation.install_mode,
        installed_skill_path: skillInstallation.workspace_skill_path || skillInstallation.legacy_skill_path,
        install_action: {
          supported: true,
          endpoint: "/api/openclaw/bridge/skill-install",
          recommended_command: "silicaclaw openclaw-skill-install",
        },
        skills: [
          {
            key: "get_profile",
            summary: "Read SilicaClaw identity/profile so OpenClaw can align its runtime persona.",
            endpoint: "/api/openclaw/bridge/profile",
          },
          {
            key: "list_messages",
            summary: "Read recent public broadcast messages observed by this SilicaClaw node.",
            endpoint: "/api/openclaw/bridge/messages",
          },
          {
            key: "watch_messages",
            summary: "Poll the recent broadcast feed so OpenClaw can learn from new public messages.",
            endpoint: "/api/openclaw/bridge/messages",
          },
          {
            key: "send_message",
            summary: "Publish a signed public broadcast through SilicaClaw on behalf of OpenClaw.",
            endpoint: "/api/openclaw/bridge/message",
          },
        ],
      },
      owner_delivery: ownerDelivery,
      endpoints: {
        status: "/api/openclaw/bridge",
        profile: "/api/openclaw/bridge/profile",
        messages: "/api/openclaw/bridge/messages",
        send_message: "/api/openclaw/bridge/message",
        install_skill: "/api/openclaw/bridge/skill-install",
      },
    };
  }

  async installOpenClawSkill(skillName?: string) {
    const scriptPath = resolve(this.workspaceRoot, "scripts", "install-openclaw-skill.mjs");
    const args = [scriptPath];
    if (skillName) {
      args.push(`--skill=${skillName}`);
    }
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: this.workspaceRoot,
      env: { ...process.env, SILICACLAW_WORKSPACE_DIR: this.projectRoot },
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(String(stdout || "{}"));
    return {
      ...parsed,
      bridge: this.getOpenClawBridgeStatus(),
    };
  }

  getOpenClawBridgeProfile() {
    return {
      identity: this.getIdentity(),
      profile: this.getProfile(),
      public_profile_preview: this.getPublicProfilePreview(),
      integration: this.getIntegrationSummary(),
      bridge: this.getOpenClawBridgeStatus(),
    };
  }

  getOpenClawBridgeConfig(): OpenClawBridgeConfigView {
    const homeDir = resolve(process.env.HOME || "", ".openclaw");
    const workspaceSkillDir = resolve(homeDir, "workspace", "skills");
    const legacySkillDir = resolve(homeDir, "skills");
    const openclawSourceDir = defaultOpenClawSourceDir(this.projectRoot);
    const openclawRuntime = detectOpenClawRuntime(this.projectRoot);

    return {
      bridge_api_base: DEFAULT_BRIDGE_API_BASE,
      openclaw_detected: detectOpenClawInstallation(this.projectRoot).detected,
      openclaw_running: openclawRuntime.running,
      openclaw_gateway_host: OPENCLAW_GATEWAY_HOST,
      openclaw_gateway_port: openclawRuntime.configured_gateway_port,
      openclaw_gateway_url: openclawRuntime.configured_gateway_url,
      openclaw_gateway_config_path: openclawRuntime.configured_gateway_config_path,
      openclaw_workspace_skill_dir: workspaceSkillDir,
      openclaw_legacy_skill_dir: legacySkillDir,
      silicaclaw_env_template_path: resolve(this.workspaceRoot, "openclaw-owner-forward.env.example"),
      recommended_skill_name: "silicaclaw-bridge-setup",
      recommended_install_command: "silicaclaw openclaw-skill-install",
      recommended_owner_forward_env: {
        OPENCLAW_SOURCE_DIR: openclawSourceDir,
        OPENCLAW_OWNER_CHANNEL: "<channel>",
        OPENCLAW_OWNER_TARGET: "<target>",
        OPENCLAW_OWNER_ACCOUNT: "",
        OPENCLAW_OWNER_FORWARD_CMD: "node scripts/send-to-owner-via-openclaw.mjs",
      },
      owner_forward_command_example: [
        `OPENCLAW_SOURCE_DIR='${openclawSourceDir}'`,
        "OPENCLAW_OWNER_CHANNEL='<channel>'",
        "OPENCLAW_OWNER_TARGET='<target>'",
        "OPENCLAW_OWNER_FORWARD_CMD='node scripts/send-to-owner-via-openclaw.mjs'",
        "node scripts/owner-forwarder-demo.mjs",
      ].join(" "),
      notes: [
        "Install and maintain the skill from SilicaClaw; do not edit OpenClaw core source for this integration.",
        "Use silicaclaw-bridge-setup first when OpenClaw still needs local install, readiness checks, or troubleshooting guidance.",
        "OpenClaw learns broadcasts via the installed skill under ~/.openclaw/workspace/skills/.",
        "Runtime detection prefers the actual OpenClaw gateway listener port, then falls back to OpenClaw's own openclaw.json gateway.port.",
        "Owner delivery runs through OpenClaw's own message channel stack after the skill forwards a summary.",
        "Sensitive computer control still requires OpenClaw's own owner approval and node permission flow.",
      ],
    };
  }

  getSkillsView() {
    const bundledRoot = resolve(this.workspaceRoot, "openclaw-skills");
    const openclawHome = resolve(process.env.HOME || "", ".openclaw");
    const workspaceInstallRoot = resolve(openclawHome, "workspace", "skills");
    const legacyInstallRoot = resolve(openclawHome, "skills");
    const bridge = this.getOpenClawBridgeStatus();
    const bundledSkills = listDirectories(bundledRoot).map((dir) => {
      const manifestPath = resolve(dir.path, "manifest.json");
      const skillPath = resolve(dir.path, "SKILL.md");
      const versionPath = resolve(dir.path, "VERSION");
      const manifest = readJsonFileSafe(manifestPath);
      const references = (manifest?.references && typeof manifest.references === "object")
        ? manifest.references as Record<string, unknown>
        : null;
      const ownerDialogueCheatsheetPath = references?.owner_dialogue_cheatsheet_zh
        ? resolve(dir.path, String(references.owner_dialogue_cheatsheet_zh))
        : null;
      const name = String(manifest?.name || dir.name);
      const capabilities = Array.isArray(manifest?.capabilities)
        ? manifest.capabilities.map((item) => String(item))
        : [];
      const installedWorkspacePath = resolve(workspaceInstallRoot, name);
      const installedLegacyPath = resolve(legacyInstallRoot, name);
      const installedInWorkspace = existsSync(installedWorkspacePath);
      const installedInLegacy = existsSync(installedLegacyPath);
      return {
        key: name,
        name,
        display_name: String(manifest?.display_name || name),
        description: String(manifest?.description || summarizeSkillReadme(skillPath) || ""),
        version: existsSync(versionPath) ? readFileSync(versionPath, "utf8").trim() : String(manifest?.version || ""),
        source_path: dir.path,
        manifest_path: existsSync(manifestPath) ? manifestPath : null,
        skill_path: existsSync(skillPath) ? skillPath : null,
        capabilities,
        transport: manifest?.transport || null,
        owner_dialogue_cheatsheet_path: ownerDialogueCheatsheetPath && existsSync(ownerDialogueCheatsheetPath) ? ownerDialogueCheatsheetPath : null,
        owner_dialogue_examples_zh: ownerDialogueCheatsheetPath ? readDialogueCheatsheetPreview(ownerDialogueCheatsheetPath) : [],
        owner_dialogue_sections_zh: ownerDialogueCheatsheetPath ? readDialogueCheatsheetSections(ownerDialogueCheatsheetPath) : [],
        installed_in_openclaw: installedInWorkspace || installedInLegacy,
        install_mode: installedInWorkspace ? "workspace" : installedInLegacy ? "legacy" : "not_installed",
        installed_path: installedInWorkspace ? installedWorkspacePath : installedInLegacy ? installedLegacyPath : null,
      };
    });

    const installedSkills = [
      ...listDirectories(workspaceInstallRoot).map((dir) => ({ ...dir, install_mode: "workspace" as const })),
      ...listDirectories(legacyInstallRoot).map((dir) => ({ ...dir, install_mode: "legacy" as const })),
    ].map((dir) => {
      const manifestPath = resolve(dir.path, "manifest.json");
      const skillPath = resolve(dir.path, "SKILL.md");
      const versionPath = resolve(dir.path, "VERSION");
      const manifest = readJsonFileSafe(manifestPath);
      const references = (manifest?.references && typeof manifest.references === "object")
        ? manifest.references as Record<string, unknown>
        : null;
      const ownerDialogueCheatsheetPath = references?.owner_dialogue_cheatsheet_zh
        ? resolve(dir.path, String(references.owner_dialogue_cheatsheet_zh))
        : null;
      return {
        key: `${dir.install_mode}:${dir.name}`,
        name: String(manifest?.name || dir.name),
        display_name: String(manifest?.display_name || dir.name),
        description: String(manifest?.description || summarizeSkillReadme(skillPath) || ""),
        version: existsSync(versionPath) ? readFileSync(versionPath, "utf8").trim() : String(manifest?.version || ""),
        install_mode: dir.install_mode,
        installed_path: dir.path,
        manifest_path: existsSync(manifestPath) ? manifestPath : null,
        skill_path: existsSync(skillPath) ? skillPath : null,
        capabilities: Array.isArray(manifest?.capabilities) ? manifest.capabilities.map((item) => String(item)) : [],
        owner_dialogue_cheatsheet_path: ownerDialogueCheatsheetPath && existsSync(ownerDialogueCheatsheetPath) ? ownerDialogueCheatsheetPath : null,
        owner_dialogue_examples_zh: ownerDialogueCheatsheetPath ? readDialogueCheatsheetPreview(ownerDialogueCheatsheetPath) : [],
        owner_dialogue_sections_zh: ownerDialogueCheatsheetPath ? readDialogueCheatsheetSections(ownerDialogueCheatsheetPath) : [],
        bundled_source_path: bundledSkills.find((item) => item.name === String(manifest?.name || dir.name))?.source_path || null,
      };
    });

    const installedSkillVersions = new Map(installedSkills.map((item) => [item.name, item.version]));
    const bundledSkillsWithUpdateState = bundledSkills.map((skill) => {
      const installedVersion = installedSkillVersions.get(skill.name) || "";
      const updateAvailable = Boolean(
        skill.installed_in_openclaw &&
        installedVersion &&
        skill.version &&
        compareVersionTokens(installedVersion, skill.version) < 0
      );
      return {
        ...skill,
        installed_version: installedVersion || null,
        update_available: updateAvailable,
      };
    });
    const bundledSkillVersions = new Map(bundledSkillsWithUpdateState.map((item) => [item.name, item.version]));
    const installedSkillsWithUpdateState = installedSkills.map((skill) => {
      const bundledVersion = bundledSkillVersions.get(skill.name) || "";
      const updateAvailable = Boolean(
        bundledVersion &&
        skill.version &&
        compareVersionTokens(skill.version, bundledVersion) < 0
      );
      return {
        ...skill,
        bundled_version: bundledVersion || null,
        update_available: updateAvailable,
      };
    });

    return {
      openclaw: {
        detected: bridge.openclaw_installation.detected,
        running: bridge.openclaw_runtime.running,
        detection_mode: bridge.openclaw_runtime.detection_mode,
        gateway_url: bridge.openclaw_runtime.gateway_url,
        workspace_install_root: workspaceInstallRoot,
        legacy_install_root: legacyInstallRoot,
      },
      summary: {
        bundled_count: bundledSkillsWithUpdateState.length,
        installed_count: installedSkillsWithUpdateState.length,
        installed_bundled_count: bundledSkillsWithUpdateState.filter((item) => item.installed_in_openclaw).length,
        update_available_count: bundledSkillsWithUpdateState.filter((item) => item.update_available).length,
      },
      install_action: bridge.skill_learning.install_action,
      bundled_skills: bundledSkillsWithUpdateState,
      installed_skills: installedSkillsWithUpdateState,
    };
  }

  getRuntimeMessageGovernance() {
    return this.messageGovernance;
  }

  async getMessageGovernanceView() {
    const logs = await this.logRepo.get();
    const recentEvents = logs
      .filter((entry) => (
        entry.message.includes("Rejected social message") ||
        entry.message.includes("Social message blocked") ||
        entry.message.includes("Social message throttled")
      ))
      .slice(0, 20);

    return {
      policy: {
        send_limit: { max: this.messageGovernance.send_limit_max, window_ms: this.messageGovernance.send_window_ms },
        receive_limit: { max: this.messageGovernance.receive_limit_max, window_ms: this.messageGovernance.receive_window_ms },
        duplicate_window_ms: this.messageGovernance.duplicate_window_ms,
        blocked_agent_ids: Array.from(this.messageGovernance.blocked_agent_ids),
        blocked_terms: Array.from(this.messageGovernance.blocked_terms),
      },
      recent_events: recentEvents,
    };
  }

  async updateMessageGovernance(input: Partial<RuntimeMessageGovernance>) {
    const next: RuntimeMessageGovernance = {
      send_limit_max: Math.max(1, Math.min(100, Number(input.send_limit_max ?? this.messageGovernance.send_limit_max) || this.messageGovernance.send_limit_max)),
      send_window_ms: Math.max(5_000, Math.min(3_600_000, Number(input.send_window_ms ?? this.messageGovernance.send_window_ms) || this.messageGovernance.send_window_ms)),
      receive_limit_max: Math.max(1, Math.min(200, Number(input.receive_limit_max ?? this.messageGovernance.receive_limit_max) || this.messageGovernance.receive_limit_max)),
      receive_window_ms: Math.max(5_000, Math.min(3_600_000, Number(input.receive_window_ms ?? this.messageGovernance.receive_window_ms) || this.messageGovernance.receive_window_ms)),
      duplicate_window_ms: Math.max(5_000, Math.min(3_600_000, Number(input.duplicate_window_ms ?? this.messageGovernance.duplicate_window_ms) || this.messageGovernance.duplicate_window_ms)),
      blocked_agent_ids: dedupeStrings(Array.isArray(input.blocked_agent_ids) ? input.blocked_agent_ids.map((item) => String(item || "").trim()) : this.messageGovernance.blocked_agent_ids),
      blocked_terms: dedupeStrings(Array.isArray(input.blocked_terms) ? input.blocked_terms.map((item) => String(item || "").trim().toLowerCase()) : this.messageGovernance.blocked_terms),
    };
    this.messageGovernance = next;
    await this.socialMessageGovernanceRepo.set(next);
    await this.log("info", "Runtime message governance updated");
    return this.getMessageGovernanceView();
  }

  async sendSocialMessage(body: string, topic = DEFAULT_SOCIAL_MESSAGE_CHANNEL): Promise<{ sent: boolean; reason: string; message?: SocialMessageView; error?: string }> {
    if (!this.identity || !this.profile) {
      return { sent: false, reason: "missing_identity_or_profile" };
    }
    if (!this.profile.public_enabled) {
      return { sent: false, reason: "public_disabled" };
    }
    if (!this.broadcastEnabled) {
      return { sent: false, reason: "broadcast_paused" };
    }
    if (!this.socialConfig.discovery.allow_message_broadcast) {
      return { sent: false, reason: "message_broadcast_disabled" };
    }

    const normalizedBody = this.normalizeSocialMessageBody(body);
    const normalizedTopic = String(topic || DEFAULT_SOCIAL_MESSAGE_CHANNEL).trim() || DEFAULT_SOCIAL_MESSAGE_CHANNEL;
    if (!normalizedBody) {
      return { sent: false, reason: "empty_message" };
    }
    if (normalizedBody.length > SOCIAL_MESSAGE_MAX_BODY_CHARS) {
      return { sent: false, reason: "message_too_long" };
    }
    if (this.containsBlockedMessageTerm(normalizedBody)) {
      await this.log("warn", `Social message blocked: blocked_term (${this.identity.agent_id.slice(0, 10)})`);
      return { sent: false, reason: "blocked_term" };
    }
    if (this.isRateLimited(this.outboundMessageTimestamps, this.messageGovernance.send_window_ms, this.messageGovernance.send_limit_max)) {
      await this.log("warn", `Social message throttled: rate_limited (${this.identity.agent_id.slice(0, 10)})`);
      return { sent: false, reason: "rate_limited" };
    }
    if (this.hasRecentDuplicateMessage(this.identity.agent_id, normalizedBody, normalizedTopic)) {
      await this.log("warn", `Social message blocked: duplicate_recent_message (${this.identity.agent_id.slice(0, 10)})`);
      return { sent: false, reason: "duplicate_recent_message" };
    }

    const message = signSocialMessage({
      identity: this.identity,
      message_id: createHash("sha256")
        .update(`${this.identity.agent_id}:${normalizedTopic}:${Date.now()}:${normalizedBody}:${Math.random()}`, "utf8")
        .digest("hex"),
      display_name: this.profile.display_name,
      topic: normalizedTopic,
      body: normalizedBody,
      created_at: Date.now(),
    });

    this.recordTimestamp(this.outboundMessageTimestamps, this.messageGovernance.send_window_ms, message.created_at);
    this.ingestSocialMessage(message);
    try {
      await this.publish(SOCIAL_MESSAGE_TOPIC, message);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.lastBroadcastErrorAt = Date.now();
      this.lastBroadcastError = messageText;
      this.broadcastFailureCount += 1;
      await this.persistSocialMessages();
      await this.log("error", `Social message broadcast failed (${message.message_id.slice(0, 10)}): ${messageText}`);
      return {
        sent: false,
        reason: "publish_failed",
        error: messageText,
        message: this.getSocialMessages(1).items[0],
      };
    }
    await this.persistSocialMessages();
    await this.log("info", `Social message broadcast (${message.message_id.slice(0, 10)})`);

    return {
      sent: true,
      reason: "sent",
      message: this.getSocialMessages(1).items[0],
    };
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

  async broadcastNow(reason = "manual"): Promise<{ sent: boolean; reason: string; error?: string }> {
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
    const replayMessages = this.getReplayableSelfSocialMessages();

    try {
      await this.publish("profile", profileRecord);
      await this.publish("presence", presenceRecord);
      for (const record of indexRecords) {
        await this.publish("index", record);
      }
      for (const message of replayMessages) {
        await this.publish(SOCIAL_MESSAGE_TOPIC, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastBroadcastErrorAt = Date.now();
      this.lastBroadcastError = message;
      this.broadcastFailureCount += 1;
      await this.log("error", `Broadcast failed (reason=${reason}): ${message}`);
      return { sent: false, reason: "publish_failed", error: message };
    }

    this.lastBroadcastAt = Date.now();
    this.broadcastCount += 1;
    this.lastBroadcastError = null;
    this.lastBroadcastErrorAt = 0;

    this.directory = ingestProfileRecord(this.directory, profileRecord);
    this.directory = ingestPresenceRecord(this.directory, presenceRecord);
    for (const record of indexRecords) {
      this.directory = ingestIndexRecord(this.directory, record);
    }
    this.compactCacheInMemory();
    await this.persistCache();

    await this.log(
      "info",
      `Broadcast sent (${indexRecords.length} index refs, replayed_messages=${replayMessages.length}, reason=${reason})`
    );
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
      rootDir: this.projectRoot,
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
      rootDir: this.projectRoot,
    });
    this.profile = signProfile(profileInput, this.identity);
    if (!existingProfile || existingProfile.agent_id !== this.identity.agent_id) {
      this.initState.profile_auto_created = true;
      await this.log("info", "profile.json missing/invalid, initialized from social/default profile");
    }
    await this.profileRepo.set(this.profile);

    this.directory = createEmptyDirectoryState();
    this.messageGovernance = {
      ...this.defaultMessageGovernance(),
      ...(await this.socialMessageGovernanceRepo.get()),
    };
    this.socialMessages = this.normalizeSocialMessages(await this.socialMessageRepo.get());
    this.socialMessageObservations = this.normalizeSocialMessageObservations(await this.socialMessageObservationRepo.get());
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
      rootDir: this.projectRoot,
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

  private async onMessage(
    topic: "profile" | "presence" | "index" | "social.message" | "social.message.observation",
    data: unknown
  ): Promise<void> {
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

    if (topic === SOCIAL_MESSAGE_TOPIC) {
      const record = this.normalizeIncomingSocialMessage(data);
      if (!record) {
        return;
      }
      if (!verifySocialMessage(record)) {
        await this.log("warn", `Rejected social message with invalid signature (${record.message_id.slice(0, 10)})`);
        return;
      }
      if (this.hasSocialMessage(record.message_id)) {
        await this.publishObservationForMessage(record);
        return;
      }
      const governanceReason = this.getIncomingSocialMessageRejectionReason(record);
      if (governanceReason) {
        await this.log("warn", `Rejected social message (${record.message_id.slice(0, 10)}): ${governanceReason}`);
        return;
      }
      this.ingestSocialMessage(record);
      await this.persistSocialMessages();
      await this.publishObservationForMessage(record);
      return;
    }

    if (topic === SOCIAL_MESSAGE_OBSERVATION_TOPIC) {
      const record = this.normalizeIncomingSocialMessageObservation(data);
      if (!record) {
        return;
      }
      if (!verifySocialMessageObservation(record)) {
        await this.log("warn", `Rejected message observation with invalid signature (${record.observation_id.slice(0, 10)})`);
        return;
      }
      this.ingestSocialMessageObservation(record);
      await this.persistSocialMessageObservations();
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
      try {
        await this.broadcastNow("interval");
      } catch (error) {
        await this.log(
          "warn",
          `Scheduled broadcast failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
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
    this.network.subscribe(SOCIAL_MESSAGE_TOPIC, (data: SocialMessageRecord) => {
      this.onMessage(SOCIAL_MESSAGE_TOPIC, data);
    });
    this.network.subscribe(SOCIAL_MESSAGE_OBSERVATION_TOPIC, (data: SocialMessageObservationRecord) => {
      this.onMessage(SOCIAL_MESSAGE_OBSERVATION_TOPIC, data);
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
    this.subscriptionsBound = false;

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
    const persisted = createEmptyDirectoryState();
    if (this.profile) {
      const selfProfileRecord: SignedProfileRecord = {
        type: "profile",
        profile: this.profile,
      };
      this.directory = ingestProfileRecord(this.directory, selfProfileRecord);
      persisted.profiles[this.profile.agent_id] = this.profile;
      const selfLastSeenAt = this.directory.presence[this.profile.agent_id];
      if (typeof selfLastSeenAt === "number" && Number.isFinite(selfLastSeenAt)) {
        persisted.presence[this.profile.agent_id] = selfLastSeenAt;
      }
      const indexed = rebuildIndexForProfile(persisted, this.profile);
      persisted.index = indexed.index;
    }
    await this.cacheRepo.set(persisted);
  }

  private async persistSocialMessages(): Promise<void> {
    await this.socialMessageRepo.set(this.socialMessages);
  }

  private async persistSocialMessageObservations(): Promise<void> {
    await this.socialMessageObservationRepo.set(this.socialMessageObservations);
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

  private getResolvedRealtimeNetworkSummary() {
    const diagnostics = this.getAdapterDiagnostics();
    const relayCapable = this.adapterMode === "webrtc-preview" || this.adapterMode === "relay-preview";
    return {
      diagnostics,
      signaling_url: diagnostics?.signaling_url ?? (relayCapable ? this.webrtcSignalingUrls[0] ?? null : null),
      signaling_endpoints: diagnostics?.signaling_endpoints ?? (relayCapable ? this.webrtcSignalingUrls : []),
      room: diagnostics?.room ?? (relayCapable ? this.webrtcRoom : null),
      bootstrap_sources: diagnostics?.bootstrap_sources ?? (relayCapable ? this.webrtcBootstrapSources : []),
      seed_peers_count: diagnostics?.seed_peers_count ?? this.webrtcSeedPeers.length,
    };
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

  private mergeMessageOnlyAgentSummaries(
    summaries: PublicProfileSummary[],
    keyword: string
  ): PublicProfileSummary[] {
    const normalizedKeyword = String(keyword || "").trim().toLowerCase();
    const knownAgentIds = new Set(summaries.map((item) => item.agent_id));
    const messageOnly: PublicProfileSummary[] = [];

    for (const message of this.socialMessages) {
      if (!message?.agent_id || knownAgentIds.has(message.agent_id)) {
        continue;
      }

      const displayName = String(message.display_name || "Unnamed").trim() || "Unnamed";
      if (normalizedKeyword) {
        const haystacks = [
          displayName.toLowerCase(),
          message.agent_id.toLowerCase(),
          String(message.topic || "").toLowerCase(),
        ];
        if (!haystacks.some((value) => value.includes(normalizedKeyword))) {
          continue;
        }
      }

      knownAgentIds.add(message.agent_id);
      messageOnly.push(
        buildPublicProfileSummary({
          profile: {
            agent_id: message.agent_id,
            display_name: displayName,
            bio: "Seen from signed public message. Profile/presence not synced yet.",
            tags: ["message-only"],
            avatar_url: "",
            public_enabled: true,
            updated_at: message.created_at,
            signature: "",
          },
          online: false,
          last_seen_at: null,
          network_mode: "unknown",
          openclaw_bound: false,
          profile_version: PROFILE_VERSION,
          public_key_fingerprint: null,
          verified_profile: false,
          now: Date.now(),
          presence_ttl_ms: PRESENCE_TTL_MS,
        })
      );
    }

    return [...summaries, ...messageOnly].sort((a, b) => {
      if (a.online !== b.online) {
        return a.online ? -1 : 1;
      }
      if (a.updated_at !== b.updated_at) {
        return b.updated_at - a.updated_at;
      }
      const byName = a.display_name.localeCompare(b.display_name);
      if (byName !== 0) {
        return byName;
      }
      return a.agent_id.localeCompare(b.agent_id);
    });
  }

  private fingerprintPublicKey(publicKey: string): string {
    const digest = createHash("sha256").update(publicKey, "utf8").digest("hex");
    return `${digest.slice(0, 12)}:${digest.slice(-8)}`;
  }

  private getOnboardingSummary() {
    const summary = this.getIntegrationSummary();
    const publicEnabled = Boolean(this.profile?.public_enabled);
    const nextSteps: string[] = [];
    if (!String(this.profile?.display_name || "").trim()) {
      nextSteps.push("Update display name in Profile page");
    }
    if (!publicEnabled) {
      nextSteps.push("Enable Public Enabled in Profile");
    }
    if (!summary.running) {
      nextSteps.push("Start broadcast in Network");
    }
    if (!summary.discoverable) {
      nextSteps.push("Announce node once after the network is running");
    }
    if (nextSteps.length === 0) {
      nextSteps.push("Node is public and discoverable");
    }
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
      next_steps: nextSteps,
    };
  }

  private getDefaultDisplayName(): string {
    const host = hostname().trim().replace(/\s+/g, "-").slice(0, 24);
    return host ? `OpenClaw @ ${host}` : "OpenClaw Agent";
  }

  private getModeExplainer() {
    if (this.networkMode === "local") {
      return {
        mode: "local",
        short_label: "Local only",
        summary: "Only nodes inside the same local process bus are visible.",
      };
    }
    if (this.networkMode === "lan") {
      return {
        mode: "lan",
        short_label: "LAN broadcast",
        summary: "Uses UDP LAN broadcast. Peers usually need to be on the same local network.",
      };
    }
    return {
      mode: DEFAULT_NETWORK_MODE,
      short_label: "Relay preview",
      summary: "Uses the public relay preview room so public nodes can find each other across the internet.",
    };
  }

  private defaultMessageGovernance(): RuntimeMessageGovernance {
    return {
      send_limit_max: SOCIAL_MESSAGE_SEND_MAX_PER_WINDOW,
      send_window_ms: SOCIAL_MESSAGE_SEND_WINDOW_MS,
      receive_limit_max: SOCIAL_MESSAGE_RECEIVE_MAX_PER_WINDOW,
      receive_window_ms: SOCIAL_MESSAGE_RECEIVE_WINDOW_MS,
      duplicate_window_ms: SOCIAL_MESSAGE_DUPLICATE_WINDOW_MS,
      blocked_agent_ids: Array.from(SOCIAL_MESSAGE_BLOCKED_AGENT_IDS),
      blocked_terms: Array.from(SOCIAL_MESSAGE_BLOCKED_TERMS),
    };
  }

  private adapterForMode(mode: "local" | "lan" | "global-preview"): "local-event-bus" | "real-preview" | "webrtc-preview" | "relay-preview" {
    if (mode === "local") return "local-event-bus";
    if (mode === "lan") return "real-preview";
    return "relay-preview";
  }

  private applyResolvedNetworkConfig(): void {
    const modeEnv = String(NETWORK_MODE || "").trim();
    const resolvedMode =
      this.socialConfig.network.mode ||
      (modeEnv === "local" || modeEnv === "lan" || modeEnv === "global-preview"
        ? modeEnv
        : DEFAULT_NETWORK_MODE);

    this.networkMode = resolvedMode;
    this.networkNamespace = this.socialConfig.network.namespace || process.env.NETWORK_NAMESPACE || DEFAULT_NETWORK_NAMESPACE;
    this.networkPort = Number(this.socialConfig.network.port || process.env.NETWORK_PORT || DEFAULT_NETWORK_PORT);

    const builtInGlobalSignalingUrls = [DEFAULT_GLOBAL_SIGNALING_URL];
    const builtInGlobalRoom = DEFAULT_GLOBAL_ROOM;

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
      signalingUrls = [DEFAULT_GLOBAL_SIGNALING_URL];
      signalingSource = `default:${DEFAULT_GLOBAL_SIGNALING_URL}`;
    }

    const roomSocial = String(this.socialConfig.network.room || "").trim();
    const roomEnv = String(WEBRTC_ROOM || "").trim();
    const room =
      roomSocial ||
      roomEnv ||
      (this.networkMode === "global-preview" ? builtInGlobalRoom : "") ||
      DEFAULT_GLOBAL_ROOM;
    const roomSource = roomSocial
      ? "social.md:network.room"
      : roomEnv
          ? "env:WEBRTC_ROOM"
          : this.networkMode === "global-preview"
        ? "built-in-defaults:global-preview.room"
          : `default:${DEFAULT_GLOBAL_ROOM}`;

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

  private normalizeSocialMessageBody(body: string): string {
    return String(body || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
  }

  private normalizeWindowTimestamps(timestamps: number[], windowMs: number, now = Date.now()): number[] {
    return timestamps.filter((timestamp) => now - timestamp <= windowMs);
  }

  private recordTimestamp(timestamps: number[], windowMs: number, at = Date.now()): void {
    const cleaned = this.normalizeWindowTimestamps(timestamps, windowMs, at);
    cleaned.push(at);
    timestamps.splice(0, timestamps.length, ...cleaned);
  }

  private isRateLimited(timestamps: number[], windowMs: number, maxCount: number, now = Date.now()): boolean {
    const cleaned = this.normalizeWindowTimestamps(timestamps, windowMs, now);
    timestamps.splice(0, timestamps.length, ...cleaned);
    return cleaned.length >= maxCount;
  }

  private containsBlockedMessageTerm(body: string): boolean {
    const normalized = String(body || "").toLowerCase();
    return this.messageGovernance.blocked_terms.some((term) => normalized.includes(term));
  }

  private hasSocialMessage(messageId: string): boolean {
    return this.socialMessages.some((item) => item.message_id === messageId);
  }

  private getReplayableSelfSocialMessages(now = Date.now()): SocialMessageRecord[] {
    const maxCount = Math.max(0, SOCIAL_MESSAGE_REPLAY_MAX_PER_BROADCAST);
    if (!this.identity || maxCount === 0) {
      return [];
    }
    return this.socialMessages
      .filter((item) => (
        item.agent_id === this.identity?.agent_id &&
        now - item.created_at <= SOCIAL_MESSAGE_REPLAY_WINDOW_MS
      ))
      .sort((a, b) => a.created_at - b.created_at)
      .slice(-maxCount);
  }

  private hasRecentDuplicateMessage(agentId: string, body: string, topic: string, now = Date.now()): boolean {
    return this.socialMessages.some((item) => (
      item.agent_id === agentId &&
      item.topic === topic &&
      item.body === body &&
      now - item.created_at <= this.messageGovernance.duplicate_window_ms
    ));
  }

  private getIncomingSocialMessageRejectionReason(record: SocialMessageRecord): string | null {
    const now = Date.now();
    if (this.messageGovernance.blocked_agent_ids.includes(record.agent_id)) {
      return "blocked_agent";
    }
    if (this.containsBlockedMessageTerm(record.body)) {
      return "blocked_term";
    }
    if (record.created_at - now > SOCIAL_MESSAGE_MAX_FUTURE_MS) {
      return "message_from_future";
    }
    if (now - record.created_at > SOCIAL_MESSAGE_MAX_AGE_MS) {
      return "message_too_old";
    }
    const timestamps = this.inboundMessageTimestampsByAgent[record.agent_id] || [];
    this.inboundMessageTimestampsByAgent[record.agent_id] = timestamps;
    if (this.isRateLimited(timestamps, this.messageGovernance.receive_window_ms, this.messageGovernance.receive_limit_max, now)) {
      return "remote_rate_limited";
    }
    if (this.hasRecentDuplicateMessage(record.agent_id, record.body, record.topic, now)) {
      return "duplicate_recent_message";
    }
    this.recordTimestamp(timestamps, this.messageGovernance.receive_window_ms, now);
    return null;
  }

  private canPublishMessageObservation(): boolean {
    return Boolean(
      this.identity &&
      this.profile?.public_enabled &&
      this.broadcastEnabled &&
      this.socialConfig.discovery.allow_message_broadcast
    );
  }

  private async publishObservationForMessage(message: SocialMessageRecord): Promise<void> {
    if (!this.identity || !this.profile || !this.canPublishMessageObservation()) {
      return;
    }
    if (message.agent_id === this.identity.agent_id) {
      return;
    }
    const existing = this.socialMessageObservations.find((item) => (
      item.message_id === message.message_id && item.observer_agent_id === this.identity?.agent_id
    ));
    if (existing) {
      return;
    }
    const observation = signSocialMessageObservation({
      identity: this.identity,
      observation_id: createHash("sha256")
        .update(`${message.message_id}:${this.identity.agent_id}:${Date.now()}`, "utf8")
        .digest("hex"),
      message_id: message.message_id,
      observed_agent_id: message.agent_id,
      observer_display_name: this.profile.display_name,
      observed_at: Date.now(),
    });
    this.ingestSocialMessageObservation(observation);
    await this.publish(SOCIAL_MESSAGE_OBSERVATION_TOPIC, observation);
    await this.persistSocialMessageObservations();
  }

  private normalizeIncomingSocialMessage(value: unknown): SocialMessageRecord | null {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const record = value as Partial<SocialMessageRecord>;
    const body = this.normalizeSocialMessageBody(String(record.body || ""));
    const agentId = String(record.agent_id || "").trim();
    const displayName = String(record.display_name || "").trim();
    const topic = String(record.topic || DEFAULT_SOCIAL_MESSAGE_CHANNEL).trim() || DEFAULT_SOCIAL_MESSAGE_CHANNEL;
    const messageId = String(record.message_id || "").trim();
    const createdAt = Number(record.created_at || 0);
    if (
      record.type !== SOCIAL_MESSAGE_TOPIC ||
      !messageId ||
      !agentId ||
      typeof record.public_key !== "string" ||
      !String(record.public_key).trim() ||
      !body ||
      typeof record.signature !== "string" ||
      !String(record.signature).trim() ||
      !Number.isFinite(createdAt) ||
      body.length > SOCIAL_MESSAGE_MAX_BODY_CHARS
    ) {
      return null;
    }
    return {
      type: SOCIAL_MESSAGE_TOPIC,
      message_id: messageId,
      agent_id: agentId,
      public_key: String(record.public_key).trim(),
      display_name: displayName || "Unnamed",
      topic,
      body,
      created_at: createdAt,
      signature: String(record.signature).trim(),
    };
  }

  private normalizeSocialMessages(items: unknown): SocialMessageRecord[] {
    if (!Array.isArray(items)) {
      return [];
    }
    const deduped = new Set<string>();
    return items
      .map((item) => this.normalizeIncomingSocialMessage(item))
      .filter((item): item is SocialMessageRecord => Boolean(item))
      .sort((a, b) => b.created_at - a.created_at)
      .filter((item) => {
        if (deduped.has(item.message_id)) {
          return false;
        }
        deduped.add(item.message_id);
        return true;
      })
      .slice(0, SOCIAL_MESSAGE_HISTORY_LIMIT);
  }

  private normalizeIncomingSocialMessageObservation(value: unknown): SocialMessageObservationRecord | null {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const record = value as Partial<SocialMessageObservationRecord>;
    const observationId = String(record.observation_id || "").trim();
    const messageId = String(record.message_id || "").trim();
    const observedAgentId = String(record.observed_agent_id || "").trim();
    const observerAgentId = String(record.observer_agent_id || "").trim();
    const observerDisplayName = String(record.observer_display_name || "").trim();
    const observedAt = Number(record.observed_at || 0);
    if (
      record.type !== SOCIAL_MESSAGE_OBSERVATION_TOPIC ||
      !observationId ||
      !messageId ||
      !observedAgentId ||
      !observerAgentId ||
      typeof record.observer_public_key !== "string" ||
      !String(record.observer_public_key).trim() ||
      typeof record.signature !== "string" ||
      !String(record.signature).trim() ||
      !Number.isFinite(observedAt)
    ) {
      return null;
    }
    return {
      type: SOCIAL_MESSAGE_OBSERVATION_TOPIC,
      observation_id: observationId,
      message_id: messageId,
      observed_agent_id: observedAgentId,
      observer_agent_id: observerAgentId,
      observer_public_key: String(record.observer_public_key).trim(),
      observer_display_name: observerDisplayName || "Unnamed",
      observed_at: observedAt,
      signature: String(record.signature).trim(),
    };
  }

  private normalizeSocialMessageObservations(items: unknown): SocialMessageObservationRecord[] {
    if (!Array.isArray(items)) {
      return [];
    }
    const deduped = new Set<string>();
    return items
      .map((item) => this.normalizeIncomingSocialMessageObservation(item))
      .filter((item): item is SocialMessageObservationRecord => Boolean(item))
      .sort((a, b) => b.observed_at - a.observed_at)
      .filter((item) => {
        if (deduped.has(item.observation_id)) {
          return false;
        }
        deduped.add(item.observation_id);
        return true;
      })
      .slice(0, SOCIAL_MESSAGE_OBSERVATION_HISTORY_LIMIT);
  }

  private ingestSocialMessage(message: SocialMessageRecord): void {
    const existing = this.socialMessages.findIndex((item) => item.message_id === message.message_id);
    if (existing >= 0) {
      this.socialMessages[existing] = message;
    } else {
      this.socialMessages.unshift(message);
    }
    this.socialMessages = this.normalizeSocialMessages(this.socialMessages);
  }

  private ingestSocialMessageObservation(observation: SocialMessageObservationRecord): void {
    const existing = this.socialMessageObservations.findIndex((item) => item.observation_id === observation.observation_id);
    if (existing >= 0) {
      this.socialMessageObservations[existing] = observation;
    } else {
      this.socialMessageObservations.unshift(observation);
    }
    this.socialMessageObservations = this.normalizeSocialMessageObservations(this.socialMessageObservations);
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
  setText('agentsCountHint', data.agentsCountHintText || '0 nodes');
  setHtml('agentsWrap', data.agentsWrapHtml || '<div class="label">No discovered nodes yet.</div>');
})();
</script>`;
}

export async function main() {
  const app = express();
  const port = Number(process.env.PORT || defaults.ports.local_console);
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

  app.get("/api/skills", (_req, res) => {
    sendOk(res, node.getSkillsView());
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
    getMessageGovernanceView: () => node.getMessageGovernanceView(),
    updateMessageGovernance: (input) => node.updateMessageGovernance(input),
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
    "/api/messages/broadcast",
    asyncRoute(async (req, res) => {
      const body = String(req.body?.body || "");
      const topic = String(req.body?.topic || DEFAULT_SOCIAL_MESSAGE_CHANNEL);
      const result = await node.sendSocialMessage(body, topic);
      sendOk(res, result, {
        message: result.sent ? "Message broadcast published" : `Message broadcast skipped: ${result.reason}`,
      });
    })
  );

  app.get("/api/messages", (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const agentId = String(req.query.agent_id ?? "").trim();
    sendOk(res, node.getSocialMessages(limit, { agent_id: agentId || null }));
  });

  app.get("/api/openclaw/bridge", (_req, res) => {
    sendOk(res, node.getOpenClawBridgeStatus());
  });

  app.get("/api/openclaw/bridge/config", (_req, res) => {
    sendOk(res, node.getOpenClawBridgeConfig());
  });

  app.get("/api/openclaw/bridge/profile", (_req, res) => {
    sendOk(res, node.getOpenClawBridgeProfile());
  });

  app.get("/api/openclaw/bridge/messages", (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const agentId = String(req.query.agent_id ?? "").trim();
    sendOk(res, node.getSocialMessages(limit, { agent_id: agentId || null }));
  });

  app.post(
    "/api/openclaw/bridge/message",
    asyncRoute(async (req, res) => {
      const body = String(req.body?.body || "");
      const topic = String(req.body?.topic || DEFAULT_SOCIAL_MESSAGE_CHANNEL);
      const result = await node.sendSocialMessage(body, topic);
      sendOk(res, result, {
        message: result.sent ? "OpenClaw bridge message published" : `OpenClaw bridge message skipped: ${result.reason}`,
      });
    })
  );

  app.post(
    "/api/openclaw/bridge/skill-install",
    asyncRoute(async (req, res) => {
      try {
        const skillName = String(req.body?.skill_name || "").trim();
        const result = await node.installOpenClawSkill(skillName || undefined);
        sendOk(res, result, {
          message: "OpenClaw skill installed",
        });
      } catch (error) {
        sendError(
          res,
          500,
          "OPENCLAW_SKILL_INSTALL_FAILED",
          error instanceof Error ? error.message : "OpenClaw skill install failed"
        );
      }
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
      sendError(res, 404, "AGENT_NOT_FOUND", "Node not found", { agent_id: agentId });
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
        ? `<div class="label">No discovered nodes yet.</div>`
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
      agentsCountHintText: `${discovered.length} nodes discovered`,
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

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
