import { signPayload, verifyPayload } from "./crypto";
import { AgentIdentity, ProfileInput, PublicProfile } from "./types";

function payloadWithoutSignature(profile: PublicProfile): Omit<PublicProfile, "signature"> {
  const { signature: _signature, ...payload } = profile;
  return payload;
}

export function signProfile(input: ProfileInput, identity: AgentIdentity): PublicProfile {
  const unsigned: Omit<PublicProfile, "signature"> = {
    agent_id: input.agent_id,
    display_name: input.display_name,
    bio: input.bio,
    tags: input.tags,
    avatar_url: input.avatar_url,
    public_enabled: input.public_enabled,
    updated_at: Date.now(),
  };
  const signature = signPayload(unsigned, identity.private_key);
  return {
    ...unsigned,
    signature,
  };
}

export function verifyProfile(profile: PublicProfile, publicKey: string): boolean {
  return verifyPayload(payloadWithoutSignature(profile), profile.signature, publicKey);
}

export function createDefaultProfileInput(agentId: string): ProfileInput {
  return {
    agent_id: agentId,
    display_name: "",
    bio: "",
    tags: [],
    avatar_url: "",
    public_enabled: false,
  };
}
