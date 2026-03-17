import { PublicProfile } from "./types";

export type CapabilityKey = "browser" | "computer" | "research" | "openclaw";

export type ProfileVisibility = {
  show_tags: boolean;
  show_last_seen: boolean;
  show_capabilities_summary: boolean;
};

export type PublicProfileSummary = {
  agent_id: string;
  display_name: string;
  bio: string;
  avatar_url?: string;
  public_enabled: boolean;
  updated_at: number;
  online: boolean;
  last_seen_at: number | null;
  tags: string[];
  network_mode: string;
  openclaw_bound: boolean;
  capabilities_summary: string[];
  profile_version: string;
  public_key_fingerprint: string | null;
  profile_updated_at: number;
  presence_seen_at: number | null;
  freshness_status: "live" | "recently_seen" | "stale";
  verified_profile: boolean;
  verified_presence_recent: boolean;
  verification_status: "verified" | "stale" | "unverified";
  signed_claims: {
    display_name: string;
    bio: string;
    avatar_url?: string;
    tags: string[];
    public_enabled: boolean;
    profile_version: string;
    profile_updated_at: number;
    public_key_fingerprint: string | null;
    verified_profile: boolean;
  };
  observed_state: {
    online: boolean;
    freshness_status: "live" | "recently_seen" | "stale";
    presence_seen_at: number | null;
    verified_presence_recent: boolean;
  };
  integration_metadata: {
    network_mode: string;
    openclaw_bound: boolean;
    verification_status: "verified" | "stale" | "unverified";
  };
  public_visibility: {
    visible_fields: string[];
    hidden_fields: string[];
  };
  visibility: ProfileVisibility;
};

const DEFAULT_VISIBILITY: ProfileVisibility = {
  show_tags: true,
  show_last_seen: true,
  show_capabilities_summary: true,
};

const CAPABILITY_KEYS: CapabilityKey[] = ["browser", "computer", "research", "openclaw"];

export function deriveCapabilitiesSummary(tags: string[]): string[] {
  const normalized = new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean));
  return CAPABILITY_KEYS.filter((key) => normalized.has(key));
}

export function buildPublicProfileSummary(args: {
  profile: PublicProfile;
  online: boolean;
  last_seen_at: number | null;
  network_mode?: string;
  openclaw_bound?: boolean;
  visibility?: Partial<ProfileVisibility>;
  profile_version?: string;
  public_key_fingerprint?: string | null;
  verified_profile?: boolean;
  now?: number;
  presence_ttl_ms?: number;
}): PublicProfileSummary {
  const visibility: ProfileVisibility = {
    show_tags:
      typeof args.visibility?.show_tags === "boolean"
        ? args.visibility.show_tags
        : DEFAULT_VISIBILITY.show_tags,
    show_last_seen:
      typeof args.visibility?.show_last_seen === "boolean"
        ? args.visibility.show_last_seen
        : DEFAULT_VISIBILITY.show_last_seen,
    show_capabilities_summary:
      typeof args.visibility?.show_capabilities_summary === "boolean"
        ? args.visibility.show_capabilities_summary
        : DEFAULT_VISIBILITY.show_capabilities_summary,
  };

  const tags = visibility.show_tags ? args.profile.tags : [];
  const capabilities = visibility.show_capabilities_summary ? deriveCapabilitiesSummary(args.profile.tags) : [];
  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  const ttl = Number.isFinite(args.presence_ttl_ms) ? Number(args.presence_ttl_ms) : 30_000;
  const age = args.last_seen_at ? Math.max(0, now - args.last_seen_at) : Number.POSITIVE_INFINITY;
  const freshness_status: "live" | "recently_seen" | "stale" =
    age <= ttl ? "live" : age <= ttl * 3 ? "recently_seen" : "stale";
  const verified_profile = Boolean(args.verified_profile);
  const verified_presence_recent = freshness_status !== "stale" && Boolean(args.last_seen_at);
  const verification_status: "verified" | "stale" | "unverified" = !verified_profile
    ? "unverified"
    : verified_presence_recent
      ? "verified"
      : "stale";
  const visible_fields = [
    "display_name",
    "bio",
    "public_enabled",
    "profile_updated_at",
    visibility.show_tags ? "tags" : "",
    visibility.show_last_seen ? "presence_seen_at" : "",
    visibility.show_capabilities_summary ? "capabilities_summary" : "",
  ].filter((field): field is string => Boolean(field));
  const hidden_fields = [
    visibility.show_tags ? "" : "tags",
    visibility.show_last_seen ? "" : "presence_seen_at",
    visibility.show_capabilities_summary ? "" : "capabilities_summary",
  ].filter((field): field is string => Boolean(field));

  return {
    agent_id: args.profile.agent_id,
    display_name: args.profile.display_name,
    bio: args.profile.bio,
    avatar_url: args.profile.avatar_url,
    public_enabled: args.profile.public_enabled,
    updated_at: args.profile.updated_at,
    online: args.online,
    last_seen_at: visibility.show_last_seen ? args.last_seen_at : null,
    tags,
    network_mode: args.network_mode ?? "unknown",
    openclaw_bound: Boolean(args.openclaw_bound),
    capabilities_summary: capabilities,
    profile_version: args.profile_version ?? "v1",
    public_key_fingerprint: args.public_key_fingerprint ?? null,
    profile_updated_at: args.profile.updated_at,
    presence_seen_at: visibility.show_last_seen ? args.last_seen_at : null,
    freshness_status,
    verified_profile,
    verified_presence_recent,
    verification_status,
    signed_claims: {
      display_name: args.profile.display_name,
      bio: args.profile.bio,
      avatar_url: args.profile.avatar_url,
      tags,
      public_enabled: args.profile.public_enabled,
      profile_version: args.profile_version ?? "v1",
      profile_updated_at: args.profile.updated_at,
      public_key_fingerprint: args.public_key_fingerprint ?? null,
      verified_profile,
    },
    observed_state: {
      online: args.online,
      freshness_status,
      presence_seen_at: visibility.show_last_seen ? args.last_seen_at : null,
      verified_presence_recent,
    },
    integration_metadata: {
      network_mode: args.network_mode ?? "unknown",
      openclaw_bound: Boolean(args.openclaw_bound),
      verification_status,
    },
    public_visibility: {
      visible_fields,
      hidden_fields,
    },
    visibility,
  };
}
