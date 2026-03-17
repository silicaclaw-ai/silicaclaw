import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { AgentIdentity, ProfileInput, PublicProfile } from "./types";
import { fromBase64, hashPublicKey } from "./crypto";
import {
  SocialConfig,
  SocialLoadMeta,
  extractFrontmatter,
  generateDefaultSocialMdTemplate,
  normalizeSocialConfig,
  parseFrontmatterObject,
} from "./socialConfig";

export type SocialFileLookup = {
  found: boolean;
  source_path: string | null;
  content: string | null;
};

export type OpenClawIdentityLookup = {
  identity: AgentIdentity | null;
  source_path: string | null;
};

export type OpenClawProfileLookup = {
  profile: Partial<PublicProfile> | null;
  source_path: string | null;
};

export type LoadedSocialConfig = {
  config: SocialConfig;
  meta: SocialLoadMeta;
  raw_frontmatter: Record<string, unknown> | null;
};

export type ResolvedIdentityResult = {
  identity: AgentIdentity;
  source: "silicaclaw-existing" | "openclaw-existing" | "silicaclaw-generated";
  openclaw_source_path: string | null;
};

export function getSocialConfigSearchPaths(rootDir = process.cwd(), homeDir = homedir()): string[] {
  return [
    resolve(rootDir, "social.md"),
    resolve(rootDir, ".openclaw", "social.md"),
    resolve(homeDir, ".openclaw", "social.md"),
  ];
}

export function findSocialMd(rootDir = process.cwd()): SocialFileLookup {
  const candidates = getSocialConfigSearchPaths(rootDir);
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    return {
      found: true,
      source_path: path,
      content: readFileSync(path, "utf8"),
    };
  }
  return {
    found: false,
    source_path: null,
    content: null,
  };
}

export function loadSocialConfig(rootDir = process.cwd()): LoadedSocialConfig {
  const lookup = findSocialMd(rootDir);
  if (!lookup.found || !lookup.content || !lookup.source_path) {
    return {
      config: normalizeSocialConfig({}),
      meta: {
        found: false,
        source_path: null,
        parse_error: null,
        loaded_at: Date.now(),
      },
      raw_frontmatter: null,
    };
  }

  try {
    const frontmatter = extractFrontmatter(lookup.content);
    if (!frontmatter) {
      return {
        config: normalizeSocialConfig({}),
        meta: {
          found: true,
          source_path: lookup.source_path,
          parse_error: "frontmatter_not_found",
          loaded_at: Date.now(),
        },
        raw_frontmatter: null,
      };
    }
    const parsed = parseFrontmatterObject(frontmatter);
    return {
      config: normalizeSocialConfig(parsed),
      meta: {
        found: true,
        source_path: lookup.source_path,
        parse_error: null,
        loaded_at: Date.now(),
      },
      raw_frontmatter: parsed,
    };
  } catch (error) {
    return {
      config: normalizeSocialConfig({}),
      meta: {
        found: true,
        source_path: lookup.source_path,
        parse_error: error instanceof Error ? error.message : "social_parse_failed",
        loaded_at: Date.now(),
      },
      raw_frontmatter: null,
    };
  }
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function normalizeIdentity(input: unknown): AgentIdentity | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  const value = input as Record<string, unknown>;
  if (typeof value.public_key !== "string" || typeof value.private_key !== "string") {
    return null;
  }

  let agentId = typeof value.agent_id === "string" ? value.agent_id : "";
  if (!agentId) {
    try {
      agentId = hashPublicKey(fromBase64(value.public_key));
    } catch {
      return null;
    }
  }

  return {
    agent_id: agentId,
    public_key: value.public_key,
    private_key: value.private_key,
    created_at: Number.isFinite(value.created_at) ? Number(value.created_at) : Date.now(),
  };
}

export function findOpenClawIdentity(rootDir = process.cwd(), homeDir = homedir()): OpenClawIdentityLookup {
  const candidates = [
    resolve(rootDir, ".openclaw", "identity.json"),
    resolve(rootDir, "identity.json"),
    resolve(homeDir, ".openclaw", "identity.json"),
  ];

  for (const path of candidates) {
    const parsed = readJson(path);
    const identity = normalizeIdentity(parsed);
    if (identity) {
      return {
        identity,
        source_path: path,
      };
    }
  }
  return {
    identity: null,
    source_path: null,
  };
}

export function findOpenClawProfile(
  rootDir = process.cwd(),
  homeDir = homedir()
): OpenClawProfileLookup {
  const candidates = [
    resolve(rootDir, ".openclaw", "profile.json"),
    resolve(rootDir, "profile.json"),
    resolve(homeDir, ".openclaw", "profile.json"),
  ];
  for (const path of candidates) {
    const parsed = readJson(path);
    if (typeof parsed !== "object" || parsed === null) continue;
    const profile = parsed as Record<string, unknown>;
    return {
      source_path: path,
      profile: {
        display_name: typeof profile.display_name === "string" ? profile.display_name : "",
        bio: typeof profile.bio === "string" ? profile.bio : "",
        avatar_url: typeof profile.avatar_url === "string" ? profile.avatar_url : "",
        tags: Array.isArray(profile.tags)
          ? profile.tags.map((tag) => String(tag).trim()).filter(Boolean)
          : [],
      },
    };
  }
  return {
    profile: null,
    source_path: null,
  };
}

export function resolveIdentityWithSocial(args: {
  socialConfig: SocialConfig;
  existingIdentity: AgentIdentity | null;
  generatedIdentity: AgentIdentity;
  rootDir?: string;
}): ResolvedIdentityResult {
  const { socialConfig, existingIdentity, generatedIdentity } = args;
  if (socialConfig.openclaw.bind_existing_identity) {
    const openclaw = findOpenClawIdentity(args.rootDir ?? process.cwd());
    if (openclaw.identity) {
      return {
        identity: openclaw.identity,
        source: "openclaw-existing",
        openclaw_source_path: openclaw.source_path,
      };
    }
  }
  if (existingIdentity) {
    return {
      identity: existingIdentity,
      source: "silicaclaw-existing",
      openclaw_source_path: null,
    };
  }
  return {
    identity: generatedIdentity,
    source: "silicaclaw-generated",
    openclaw_source_path: null,
  };
}

export function resolveProfileInputWithSocial(args: {
  socialConfig: SocialConfig;
  agentId: string;
  existingProfile: PublicProfile | null;
  rootDir?: string;
}): ProfileInput {
  const { socialConfig, agentId, existingProfile } = args;
  const openclawProfile =
    socialConfig.openclaw.use_openclaw_profile_if_available
      ? findOpenClawProfile(args.rootDir ?? process.cwd()).profile
      : null;

  const baseDisplayName = existingProfile?.display_name || "";
  const baseBio = existingProfile?.bio || "";
  const baseAvatarUrl = existingProfile?.avatar_url || "";
  const baseTags = existingProfile?.tags || [];

  return {
    agent_id: agentId,
    display_name: socialConfig.identity.display_name || openclawProfile?.display_name || baseDisplayName,
    bio: socialConfig.identity.bio || openclawProfile?.bio || baseBio,
    avatar_url: socialConfig.identity.avatar_url || openclawProfile?.avatar_url || baseAvatarUrl,
    tags: socialConfig.identity.tags.length > 0 ? socialConfig.identity.tags : openclawProfile?.tags || baseTags,
    public_enabled: socialConfig.public_enabled,
  };
}

export function ensureDefaultSocialMd(rootDir = process.cwd()): { path: string; created: boolean } {
  const targetPath = resolve(rootDir, "social.md");
  if (existsSync(targetPath)) {
    return { path: targetPath, created: false };
  }
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(targetPath, generateDefaultSocialMdTemplate(), "utf8");
  return { path: targetPath, created: true };
}
