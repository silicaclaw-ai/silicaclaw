import { resolve } from "path";
import { AgentIdentity, DirectoryState, PublicProfile, createEmptyDirectoryState } from "@silicaclaw/core";
import { JsonFileRepo } from "./jsonRepo";

export type LogEntry = {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
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
