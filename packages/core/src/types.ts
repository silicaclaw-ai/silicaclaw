export type AgentIdentity = {
  agent_id: string;
  public_key: string;
  private_key: string;
  created_at: number;
};

export type PublicProfile = {
  agent_id: string;
  display_name: string;
  bio: string;
  tags: string[];
  avatar_url?: string;
  public_enabled: boolean;
  updated_at: number;
  signature: string;
};

export type SignedProfileRecord = {
  type: "profile";
  profile: PublicProfile;
};

export type PresenceRecord = {
  type: "presence";
  agent_id: string;
  timestamp: number;
  signature: string;
};

export type IndexRefRecord = {
  type: "index";
  key: string;
  agent_id: string;
};

export type DirectoryState = {
  profiles: Record<string, PublicProfile>;
  presence: Record<string, number>;
  index: Record<string, string[]>;
};

export type ProfileInput = Omit<PublicProfile, "signature" | "updated_at">;
