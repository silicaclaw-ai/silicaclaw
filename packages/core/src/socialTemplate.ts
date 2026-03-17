import { SocialRuntimeConfig } from "./socialConfig";

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function yamlString(input: string): string {
  return JSON.stringify(input ?? "");
}

function yamlStringList(values: string[], indent = "  "): string {
  if (!values.length) {
    return `${indent}[]`;
  }
  return values.map((value) => `${indent}- ${yamlString(value)}`).join("\n");
}

export function generateSocialMdTemplate(runtimeConfig: SocialRuntimeConfig | null | undefined): string {
  const enabled = asBool(runtimeConfig?.enabled, true);
  const publicEnabled = asBool(runtimeConfig?.public_enabled, false);
  const profile = runtimeConfig?.resolved_profile ?? null;
  const network = runtimeConfig?.resolved_network ?? null;
  const discovery = runtimeConfig?.resolved_discovery ?? null;
  const visibility = runtimeConfig?.visibility ?? null;
  const openclaw = runtimeConfig?.openclaw ?? null;

  const displayName = asString(profile?.display_name, "");
  const bio = asString(profile?.bio, "");
  const avatarUrl = asString(profile?.avatar_url, "");
  const tags = asStringArray(profile?.tags, ["openclaw", "local-first"]);

  const namespace = asString(network?.namespace, "silicaclaw.preview");
  const adapter =
    network?.adapter === "mock" ||
    network?.adapter === "local-event-bus" ||
    network?.adapter === "real-preview" ||
    network?.adapter === "webrtc-preview"
      ? network.adapter
      : "local-event-bus";
  const port = Number.isFinite(network?.port) ? Number(network?.port) : 44123;
  const signalingUrl = asString(network?.signaling_url, "http://localhost:4510");
  const signalingUrls = asStringArray(
    network?.signaling_urls,
    signalingUrl ? [signalingUrl] : ["http://localhost:4510"]
  );
  const room = asString(network?.room, "silicaclaw-room");
  const seedPeers = asStringArray(network?.seed_peers, []);
  const bootstrapHints = asStringArray(network?.bootstrap_hints, []);

  const discoverable = asBool(discovery?.discoverable, true);
  const allowProfileBroadcast = asBool(discovery?.allow_profile_broadcast, true);
  const allowPresenceBroadcast = asBool(discovery?.allow_presence_broadcast, true);

  const showDisplayName = asBool(visibility?.show_display_name, true);
  const showBio = asBool(visibility?.show_bio, true);
  const showTags = asBool(visibility?.show_tags, true);
  const showAgentId = asBool(visibility?.show_agent_id, true);
  const showLastSeen = asBool(visibility?.show_last_seen, true);

  const bindExistingIdentity = asBool(openclaw?.bind_existing_identity, true);
  const useOpenClawProfile = asBool(openclaw?.use_openclaw_profile_if_available, true);

  return `---
enabled: ${enabled}
public_enabled: ${publicEnabled}

identity:
  display_name: ${yamlString(displayName)}
  bio: ${yamlString(bio)}
  avatar_url: ${yamlString(avatarUrl)}
  tags:
${yamlStringList(tags.map((tag) => asString(tag, "")), "    ")}

network:
  namespace: ${yamlString(namespace)}
  adapter: ${yamlString(adapter)}
  port: ${port}
  signaling_url: ${yamlString(signalingUrl)}
  signaling_urls:
${yamlStringList(signalingUrls, "    ")}
  room: ${yamlString(room)}
  seed_peers:${seedPeers.length > 0 ? `\n${yamlStringList(seedPeers, "    ")}` : " []"}
  bootstrap_hints:${bootstrapHints.length > 0 ? `\n${yamlStringList(bootstrapHints, "    ")}` : " []"}

discovery:
  discoverable: ${discoverable}
  allow_profile_broadcast: ${allowProfileBroadcast}
  allow_presence_broadcast: ${allowPresenceBroadcast}

visibility:
  show_display_name: ${showDisplayName}
  show_bio: ${showBio}
  show_tags: ${showTags}
  show_agent_id: ${showAgentId}
  show_last_seen: ${showLastSeen}

openclaw:
  bind_existing_identity: ${bindExistingIdentity}
  use_openclaw_profile_if_available: ${useOpenClawProfile}
---

# Social

Generated from current SilicaClaw runtime state.

- Save as \`social.md\` in your OpenClaw workspace.
- This export does not auto-overwrite any existing file.
`;
}
