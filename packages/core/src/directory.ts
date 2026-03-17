import {
  DirectoryState,
  IndexRefRecord,
  PresenceRecord,
  PublicProfile,
  SignedProfileRecord,
} from "./types";
import { buildIndexKeys } from "./indexing";

export const DEFAULT_PRESENCE_TTL_MS = 30_000;

export function createEmptyDirectoryState(): DirectoryState {
  return {
    profiles: {},
    presence: {},
    index: {},
  };
}

export function ingestProfileRecord(state: DirectoryState, record: SignedProfileRecord): DirectoryState {
  const next: DirectoryState = {
    profiles: { ...state.profiles },
    presence: { ...state.presence },
    index: { ...state.index },
  };
  next.profiles[record.profile.agent_id] = record.profile;
  return rebuildIndexForProfile(next, record.profile);
}

export function ingestPresenceRecord(state: DirectoryState, record: PresenceRecord): DirectoryState {
  return {
    profiles: { ...state.profiles },
    presence: {
      ...state.presence,
      [record.agent_id]: record.timestamp,
    },
    index: { ...state.index },
  };
}

export function ingestIndexRecord(state: DirectoryState, record: IndexRefRecord): DirectoryState {
  const existing = new Set(state.index[record.key] ?? []);
  if (existing.has(record.agent_id)) {
    return state;
  }
  existing.add(record.agent_id);
  return {
    profiles: { ...state.profiles },
    presence: { ...state.presence },
    index: {
      ...state.index,
      [record.key]: Array.from(existing),
    },
  };
}

export function isAgentOnline(
  lastSeenAt: number | undefined,
  now = Date.now(),
  ttlMs = DEFAULT_PRESENCE_TTL_MS
): boolean {
  if (!lastSeenAt) {
    return false;
  }
  return now - lastSeenAt <= ttlMs;
}

export function cleanupExpiredPresence(
  state: DirectoryState,
  now = Date.now(),
  ttlMs = DEFAULT_PRESENCE_TTL_MS
): { state: DirectoryState; removed: number } {
  let removed = 0;
  const presence: Record<string, number> = {};

  for (const [agentId, timestamp] of Object.entries(state.presence)) {
    if (isAgentOnline(timestamp, now, ttlMs)) {
      presence[agentId] = timestamp;
    } else {
      removed += 1;
    }
  }

  if (removed === 0) {
    return { state, removed: 0 };
  }

  return {
    state: {
      profiles: { ...state.profiles },
      presence,
      index: { ...state.index },
    },
    removed,
  };
}

export function rebuildIndexForProfile(state: DirectoryState, profile: PublicProfile): DirectoryState {
  const keys = buildIndexKeys(profile);
  const nextIndex: Record<string, string[]> = {};

  for (const [key, ids] of Object.entries(state.index)) {
    const filtered = ids.filter((id) => id !== profile.agent_id);
    if (filtered.length > 0) {
      nextIndex[key] = Array.from(new Set(filtered));
    }
  }

  for (const key of keys) {
    const existing = new Set(nextIndex[key] ?? []);
    existing.add(profile.agent_id);
    nextIndex[key] = Array.from(existing);
  }

  return {
    profiles: { ...state.profiles },
    presence: { ...state.presence },
    index: nextIndex,
  };
}

export function dedupeIndex(state: DirectoryState): DirectoryState {
  const index: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(state.index)) {
    index[key] = Array.from(new Set(ids));
  }
  return {
    profiles: { ...state.profiles },
    presence: { ...state.presence },
    index,
  };
}

export function searchDirectory(
  state: DirectoryState,
  keyword: string,
  options?: { now?: number; presenceTTLms?: number }
): PublicProfile[] {
  const now = options?.now ?? Date.now();
  const presenceTTLms = options?.presenceTTLms ?? DEFAULT_PRESENCE_TTL_MS;
  const normalized = keyword.trim().toLowerCase();
  const baseList =
    normalized.length === 0
      ? Object.values(state.profiles)
      : Array.from(
          new Set<string>([
            ...(state.index[`tag:${normalized}`] ?? []),
            ...(state.index[`name:${normalized.replace(/[^a-z0-9]+/g, "")}`] ?? []),
          ])
        )
          .map((agentId) => state.profiles[agentId])
          .filter((profile): profile is PublicProfile => Boolean(profile));

  return baseList
    .slice()
    .sort((a, b) => {
      const aOnline = isAgentOnline(state.presence[a.agent_id], now, presenceTTLms) ? 1 : 0;
      const bOnline = isAgentOnline(state.presence[b.agent_id], now, presenceTTLms) ? 1 : 0;
      if (aOnline !== bOnline) {
        return bOnline - aOnline;
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
