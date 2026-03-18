import { resolve } from "path";
import { AgentIdentity, DirectoryState, PublicProfile, createEmptyDirectoryState } from "@silicaclaw/core";
import { JsonFileRepo } from "./jsonRepo";

export type LogEntry = {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
};

export type SocialMessageRecord = {
  type: "social.message";
  message_id: string;
  agent_id: string;
  public_key: string;
  display_name: string;
  topic: string;
  body: string;
  created_at: number;
  signature: string;
};

export type SocialMessageObservationRecord = {
  type: "social.message.observation";
  observation_id: string;
  message_id: string;
  observed_agent_id: string;
  observer_agent_id: string;
  observer_public_key: string;
  observer_display_name: string;
  observed_at: number;
  signature: string;
};

export type SocialMessageGovernanceConfig = {
  send_limit_max: number;
  send_window_ms: number;
  receive_limit_max: number;
  receive_window_ms: number;
  duplicate_window_ms: number;
  blocked_agent_ids: string[];
  blocked_terms: string[];
};

export class IdentityRepo extends JsonFileRepo<AgentIdentity | null> {
  constructor(rootDir = process.cwd()) {
    super(resolve(rootDir, "data", "identity.json"), () => null);
  }
}

export class ProfileRepo extends JsonFileRepo<PublicProfile | null> {
  constructor(rootDir = process.cwd()) {
    super(resolve(rootDir, "data", "profile.json"), () => null);
  }
}

export class CacheRepo extends JsonFileRepo<DirectoryState> {
  constructor(rootDir = process.cwd()) {
    super(resolve(rootDir, "data", "cache.json"), () => createEmptyDirectoryState());
  }
}

export class LogRepo extends JsonFileRepo<LogEntry[]> {
  constructor(rootDir = process.cwd()) {
    super(resolve(rootDir, "data", "logs.json"), () => []);
  }

  async append(entry: Omit<LogEntry, "id">): Promise<void> {
    const current = await this.get();
    const next = [
      {
        id: `${entry.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        ...entry,
      },
      ...current,
    ].slice(0, 50);
    await this.set(next);
  }
}

export class SocialMessageRepo extends JsonFileRepo<SocialMessageRecord[]> {
  constructor(rootDir = process.cwd()) {
    super(resolve(rootDir, "data", "social-messages.json"), () => []);
  }
}

export class SocialMessageObservationRepo extends JsonFileRepo<SocialMessageObservationRecord[]> {
  constructor(rootDir = process.cwd()) {
    super(resolve(rootDir, "data", "social-message-observations.json"), () => []);
  }
}

export class SocialMessageGovernanceRepo extends JsonFileRepo<SocialMessageGovernanceConfig> {
  constructor(rootDir = process.cwd()) {
    super(resolve(rootDir, ".silicaclaw", "social.message-governance.json"), () => ({
      send_limit_max: 5,
      send_window_ms: 60_000,
      receive_limit_max: 8,
      receive_window_ms: 60_000,
      duplicate_window_ms: 180_000,
      blocked_agent_ids: [],
      blocked_terms: [],
    }));
  }
}
