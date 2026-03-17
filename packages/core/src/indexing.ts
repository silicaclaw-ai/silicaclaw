import { IndexRefRecord, PublicProfile } from "./types";

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function buildTagIndexKeys(tags: string[]): string[] {
  return tags
    .map(normalizeTag)
    .filter(Boolean)
    .map((tag) => `tag:${tag}`);
}

export function buildNamePrefixKeys(displayName: string): string[] {
  const normalized = displayName.trim().toLowerCase().replace(/\s+/g, " ");
  const collapsed = normalized.replace(/[^a-z0-9]+/g, "");
  const source = collapsed || normalized.replace(/\s+/g, "");
  const keys: string[] = [];
  for (let i = 1; i <= source.length; i += 1) {
    keys.push(`name:${source.slice(0, i)}`);
  }
  return keys;
}

export function buildIndexKeys(profile: PublicProfile): string[] {
  const keys = new Set<string>();
  for (const key of buildTagIndexKeys(profile.tags)) {
    keys.add(key);
  }
  for (const key of buildNamePrefixKeys(profile.display_name)) {
    keys.add(key);
  }
  return Array.from(keys);
}

export function buildIndexRecords(profile: PublicProfile): IndexRefRecord[] {
  return buildIndexKeys(profile).map((key) => ({
    type: "index",
    key,
    agent_id: profile.agent_id,
  }));
}
