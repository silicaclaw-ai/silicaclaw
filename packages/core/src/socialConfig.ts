export type SocialIdentityConfig = {
  display_name: string;
  bio: string;
  avatar_url: string;
  tags: string[];
};

export type SocialNetworkAdapter = "mock" | "local-event-bus" | "real-preview" | "webrtc-preview" | "relay-preview";
export type SocialNetworkMode = "local" | "lan" | "global-preview";

export type SocialNetworkConfig = {
  mode: SocialNetworkMode;
  namespace: string;
  adapter: SocialNetworkAdapter;
  port: number;
  signaling_url: string;
  signaling_urls: string[];
  room: string;
  seed_peers: string[];
  bootstrap_hints: string[];
};

export type SocialDiscoveryConfig = {
  discoverable: boolean;
  allow_profile_broadcast: boolean;
  allow_presence_broadcast: boolean;
  allow_message_broadcast: boolean;
};

export type SocialVisibilityConfig = {
  show_display_name: boolean;
  show_bio: boolean;
  show_tags: boolean;
  show_agent_id: boolean;
  show_last_seen: boolean;
  show_capabilities_summary: boolean;
};

export type SocialOpenClawConfig = {
  bind_existing_identity: boolean;
  use_openclaw_profile_if_available: boolean;
};

export type SocialConfig = {
  enabled: boolean;
  public_enabled: boolean;
  identity: SocialIdentityConfig;
  network: SocialNetworkConfig;
  discovery: SocialDiscoveryConfig;
  visibility: SocialVisibilityConfig;
  openclaw: SocialOpenClawConfig;
};

export type SocialLoadMeta = {
  found: boolean;
  source_path: string | null;
  parse_error: string | null;
  loaded_at: number;
};

export type SocialRuntimeConfig = {
  enabled: boolean;
  public_enabled: boolean;
  source_path: string | null;
  last_loaded_at: number;
  social_found: boolean;
  parse_error: string | null;
  resolved_identity: {
    agent_id: string;
    public_key: string;
    created_at: number;
    source: "silicaclaw-existing" | "openclaw-existing" | "silicaclaw-generated";
  } | null;
  resolved_profile: {
    display_name: string;
    bio: string;
    avatar_url?: string;
    tags: string[];
    public_enabled: boolean;
  } | null;
  resolved_network: {
    mode: SocialNetworkMode;
    adapter: SocialNetworkAdapter;
    namespace: string;
    port: number | null;
    signaling_url: string;
    signaling_urls: string[];
    room: string;
    seed_peers: string[];
    bootstrap_hints: string[];
    bootstrap_sources: string[];
  };
  resolved_discovery: SocialDiscoveryConfig;
  visibility: SocialVisibilityConfig;
  openclaw: SocialOpenClawConfig;
};

const DEFAULT_SOCIAL_CONFIG: SocialConfig = {
  enabled: true,
  public_enabled: false,
  identity: {
    display_name: "",
    bio: "",
    avatar_url: "",
    tags: [],
  },
  network: {
    mode: "global-preview",
    namespace: "silicaclaw.preview",
    adapter: "relay-preview",
    port: 44123,
    signaling_url: "https://relay.silicaclaw.com",
    signaling_urls: [],
    room: "silicaclaw-global-preview",
    seed_peers: [],
    bootstrap_hints: [],
  },
  discovery: {
    discoverable: true,
    allow_profile_broadcast: true,
    allow_presence_broadcast: true,
    allow_message_broadcast: true,
  },
  visibility: {
    show_display_name: true,
    show_bio: true,
    show_tags: true,
    show_agent_id: true,
    show_last_seen: true,
    show_capabilities_summary: true,
  },
  openclaw: {
    bind_existing_identity: true,
    use_openclaw_profile_if_available: true,
  },
};

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "[]") return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((item) => item.trim())
      .map((item) =>
        (item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))
          ? item.slice(1, -1)
          : item
      )
      .filter(Boolean);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function countIndent(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") count += 1;
  return count;
}

function findNextSignificantLine(
  lines: string[],
  start: number
): { line: string; indent: number } | null {
  for (let i = start; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return { line: trimmed, indent: countIndent(raw) };
  }
  return null;
}

type StackItem = {
  indent: number;
  value: Record<string, unknown> | unknown[];
  kind: "object" | "array";
};

export function parseFrontmatterObject(frontmatter: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const lines = frontmatter.replace(/\r\n/g, "\n").split("\n");
  const stack: StackItem[] = [{ indent: -1, value: root, kind: "object" }];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = countIndent(raw);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1];

    if (trimmed.startsWith("- ")) {
      if (current.kind !== "array") {
        continue;
      }
      const itemRaw = trimmed.slice(2).trim();
      if (!itemRaw) {
        const child: Record<string, unknown> = {};
        (current.value as unknown[]).push(child);
        stack.push({ indent, value: child, kind: "object" });
        continue;
      }
      const keyValue = itemRaw.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (keyValue) {
        const child: Record<string, unknown> = {};
        const key = keyValue[1];
        const valueRaw = keyValue[2];
        child[key] = valueRaw ? parseScalar(valueRaw) : "";
        (current.value as unknown[]).push(child);
        continue;
      }
      (current.value as unknown[]).push(parseScalar(itemRaw));
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match || current.kind !== "object") {
      continue;
    }
    const key = match[1];
    const valueRaw = match[2];
    const obj = current.value as Record<string, unknown>;

    if (valueRaw) {
      obj[key] = parseScalar(valueRaw);
      continue;
    }

    const next = findNextSignificantLine(lines, i + 1);
    const nextIsArray = Boolean(next && next.indent > indent && next.line.startsWith("- "));
    if (nextIsArray) {
      const arr: unknown[] = [];
      obj[key] = arr;
      stack.push({ indent, value: arr, kind: "array" });
      continue;
    }
    const childObj: Record<string, unknown> = {};
    obj[key] = childObj;
    stack.push({ indent, value: childObj, kind: "object" });
  }

  return root;
}

export function extractFrontmatter(content: string): string | null {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) {
    return null;
  }
  return normalized.slice(4, end).trim();
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function asAdapter(value: unknown, fallback: SocialNetworkAdapter): SocialNetworkAdapter {
  if (
    value === "mock" ||
    value === "local-event-bus" ||
    value === "real-preview" ||
    value === "webrtc-preview" ||
    value === "relay-preview"
  ) {
    return value;
  }
  return fallback;
}

function asMode(value: unknown, fallback: SocialNetworkMode): SocialNetworkMode {
  if (value === "local" || value === "lan" || value === "global-preview") {
    return value;
  }
  return fallback;
}

function adapterForMode(mode: SocialNetworkMode): SocialNetworkAdapter {
  if (mode === "local") return "local-event-bus";
  if (mode === "lan") return "real-preview";
  return "relay-preview";
}

export function normalizeSocialConfig(input: unknown): SocialConfig {
  const root = asObject(input);
  const identity = asObject(root.identity);
  const network = asObject(root.network);
  const discovery = asObject(root.discovery);
  const visibility = asObject(root.visibility);
  const openclaw = asObject(root.openclaw);

  const signalingUrl = asString(network.signaling_url, DEFAULT_SOCIAL_CONFIG.network.signaling_url);
  const signalingUrls = asStringArray(
    network.signaling_urls,
    DEFAULT_SOCIAL_CONFIG.network.signaling_urls
  );
  const mode = asMode(network.mode, DEFAULT_SOCIAL_CONFIG.network.mode);

  return {
    enabled: asBool(root.enabled, DEFAULT_SOCIAL_CONFIG.enabled),
    public_enabled: asBool(root.public_enabled, DEFAULT_SOCIAL_CONFIG.public_enabled),
    identity: {
      display_name: asString(identity.display_name, DEFAULT_SOCIAL_CONFIG.identity.display_name),
      bio: asString(identity.bio, DEFAULT_SOCIAL_CONFIG.identity.bio),
      avatar_url: asString(identity.avatar_url, DEFAULT_SOCIAL_CONFIG.identity.avatar_url),
      tags: asStringArray(identity.tags, DEFAULT_SOCIAL_CONFIG.identity.tags),
    },
    network: {
      mode,
      namespace: asString(network.namespace, DEFAULT_SOCIAL_CONFIG.network.namespace),
      adapter: asAdapter(network.adapter, adapterForMode(mode)),
      port: asNumber(network.port, DEFAULT_SOCIAL_CONFIG.network.port),
      signaling_url: signalingUrl,
      signaling_urls: signalingUrls.length > 0 ? signalingUrls : signalingUrl ? [signalingUrl] : [],
      room: asString(network.room, DEFAULT_SOCIAL_CONFIG.network.room),
      seed_peers: asStringArray(network.seed_peers, DEFAULT_SOCIAL_CONFIG.network.seed_peers),
      bootstrap_hints: asStringArray(
        network.bootstrap_hints,
        DEFAULT_SOCIAL_CONFIG.network.bootstrap_hints
      ),
    },
    discovery: {
      discoverable: asBool(discovery.discoverable, DEFAULT_SOCIAL_CONFIG.discovery.discoverable),
      allow_profile_broadcast: asBool(
        discovery.allow_profile_broadcast,
        DEFAULT_SOCIAL_CONFIG.discovery.allow_profile_broadcast
      ),
      allow_presence_broadcast: asBool(
        discovery.allow_presence_broadcast,
        DEFAULT_SOCIAL_CONFIG.discovery.allow_presence_broadcast
      ),
      allow_message_broadcast: asBool(
        discovery.allow_message_broadcast,
        DEFAULT_SOCIAL_CONFIG.discovery.allow_message_broadcast
      ),
    },
    visibility: {
      show_display_name: asBool(
        visibility.show_display_name,
        DEFAULT_SOCIAL_CONFIG.visibility.show_display_name
      ),
      show_bio: asBool(visibility.show_bio, DEFAULT_SOCIAL_CONFIG.visibility.show_bio),
      show_tags: asBool(visibility.show_tags, DEFAULT_SOCIAL_CONFIG.visibility.show_tags),
      show_agent_id: asBool(visibility.show_agent_id, DEFAULT_SOCIAL_CONFIG.visibility.show_agent_id),
      show_last_seen: asBool(
        visibility.show_last_seen,
        DEFAULT_SOCIAL_CONFIG.visibility.show_last_seen
      ),
      show_capabilities_summary: asBool(
        visibility.show_capabilities_summary,
        DEFAULT_SOCIAL_CONFIG.visibility.show_capabilities_summary
      ),
    },
    openclaw: {
      bind_existing_identity: asBool(
        openclaw.bind_existing_identity,
        DEFAULT_SOCIAL_CONFIG.openclaw.bind_existing_identity
      ),
      use_openclaw_profile_if_available: asBool(
        openclaw.use_openclaw_profile_if_available,
        DEFAULT_SOCIAL_CONFIG.openclaw.use_openclaw_profile_if_available
      ),
    },
  };
}

export function getDefaultSocialConfig(): SocialConfig {
  return JSON.parse(JSON.stringify(DEFAULT_SOCIAL_CONFIG)) as SocialConfig;
}

export type DefaultSocialTemplateOptions = {
  display_name?: string;
  bio?: string;
  tags?: string[];
  mode?: SocialNetworkMode;
  public_enabled?: boolean;
};

export function generateDefaultSocialMdTemplate(options: DefaultSocialTemplateOptions = {}): string {
  const displayName = options.display_name?.trim() || "My OpenClaw Agent";
  const bio = options.bio?.trim() || "Local AI agent running on this machine";
  const tags = Array.isArray(options.tags) && options.tags.length > 0 ? options.tags : ["openclaw", "local-first"];
  const mode = options.mode ?? "global-preview";
  const publicEnabled = typeof options.public_enabled === "boolean" ? options.public_enabled : false;
  return `---
enabled: true
public_enabled: ${publicEnabled}

identity:
  display_name: ${JSON.stringify(displayName)}
  bio: ${JSON.stringify(bio)}
  tags:
${tags.map((tag) => `    - ${tag}`).join("\n")}

network:
  mode: ${JSON.stringify(mode)}

discovery:
  discoverable: true
  allow_profile_broadcast: true
  allow_presence_broadcast: true
  allow_message_broadcast: true

openclaw:
  bind_existing_identity: true
  use_openclaw_profile_if_available: true
---

# social.md

This file configures how OpenClaw integrates with SilicaClaw.
`;
}
