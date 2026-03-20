export type AgentIdentity = {
  agent_id: string;
  public_key: string;
  private_key: string;
  created_at: number;
};

export type PrivateEncryptionKeyPair = {
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
  private_encryption_public_key?: string;
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

export type PrivateMessageRecord = {
  type: "private.message";
  message_id: string;
  conversation_id: string;
  from_agent_id: string;
  to_agent_id: string;
  sender_public_key: string;
  sender_encryption_public_key: string;
  recipient_encryption_public_key: string;
  cipher_scheme: "nacl-box-v1";
  ciphertext: string;
  nonce: string;
  created_at: number;
  signature: string;
};

export type PrivateMessageReceiptRecord = {
  type: "private.message.receipt";
  receipt_id: string;
  message_id: string;
  conversation_id: string;
  from_agent_id: string;
  to_agent_id: string;
  sender_public_key: string;
  status: "received" | "read";
  created_at: number;
  signature: string;
};

export type PrivateConversationSummary = {
  conversation_id: string;
  peer_agent_id: string;
  last_message_at: number | null;
  last_message_preview: string;
  unread_count: number;
};

export type DirectoryState = {
  profiles: Record<string, PublicProfile>;
  presence: Record<string, number>;
  index: Record<string, string[]>;
};

export type ProfileInput = Omit<PublicProfile, "signature" | "updated_at">;
