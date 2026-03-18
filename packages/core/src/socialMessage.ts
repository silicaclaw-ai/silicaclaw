import { AgentIdentity, SocialMessageObservationRecord, SocialMessageRecord } from "./types";
import { fromBase64, hashPublicKey, signPayload, verifyPayload } from "./crypto";

function unsignedSocialMessage(record: SocialMessageRecord): Omit<SocialMessageRecord, "signature"> {
  const { signature: _signature, ...rest } = record;
  return rest;
}

export function signSocialMessage(input: {
  identity: AgentIdentity;
  message_id: string;
  display_name: string;
  topic: string;
  body: string;
  created_at?: number;
}): SocialMessageRecord {
  const payload: Omit<SocialMessageRecord, "signature"> = {
    type: "social.message",
    message_id: input.message_id,
    agent_id: input.identity.agent_id,
    public_key: input.identity.public_key,
    display_name: input.display_name,
    topic: input.topic,
    body: input.body,
    created_at: input.created_at ?? Date.now(),
  };

  return {
    ...payload,
    signature: signPayload(payload, input.identity.private_key),
  };
}

export function verifySocialMessage(record: SocialMessageRecord): boolean {
  try {
    if (hashPublicKey(fromBase64(record.public_key)) !== record.agent_id) {
      return false;
    }
    return verifyPayload(unsignedSocialMessage(record), record.signature, record.public_key);
  } catch {
    return false;
  }
}

function unsignedSocialMessageObservation(
  record: SocialMessageObservationRecord
): Omit<SocialMessageObservationRecord, "signature"> {
  const { signature: _signature, ...rest } = record;
  return rest;
}

export function signSocialMessageObservation(input: {
  identity: AgentIdentity;
  observation_id: string;
  message_id: string;
  observed_agent_id: string;
  observer_display_name: string;
  observed_at?: number;
}): SocialMessageObservationRecord {
  const payload: Omit<SocialMessageObservationRecord, "signature"> = {
    type: "social.message.observation",
    observation_id: input.observation_id,
    message_id: input.message_id,
    observed_agent_id: input.observed_agent_id,
    observer_agent_id: input.identity.agent_id,
    observer_public_key: input.identity.public_key,
    observer_display_name: input.observer_display_name,
    observed_at: input.observed_at ?? Date.now(),
  };

  return {
    ...payload,
    signature: signPayload(payload, input.identity.private_key),
  };
}

export function verifySocialMessageObservation(record: SocialMessageObservationRecord): boolean {
  try {
    if (hashPublicKey(fromBase64(record.observer_public_key)) !== record.observer_agent_id) {
      return false;
    }
    return verifyPayload(unsignedSocialMessageObservation(record), record.signature, record.observer_public_key);
  } catch {
    return false;
  }
}
