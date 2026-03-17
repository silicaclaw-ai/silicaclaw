import { AgentIdentity } from "./types";
import { signPayload, verifyPayload } from "./crypto";
import { PresenceRecord } from "./types";

function unsignedPresence(record: PresenceRecord): Omit<PresenceRecord, "signature"> {
  const { signature: _signature, ...rest } = record;
  return rest;
}

export function signPresence(identity: AgentIdentity, timestamp = Date.now()): PresenceRecord {
  const payload = {
    type: "presence" as const,
    agent_id: identity.agent_id,
    timestamp,
  };
  return {
    ...payload,
    signature: signPayload(payload, identity.private_key),
  };
}

export function verifyPresence(record: PresenceRecord, publicKey: string): boolean {
  return verifyPayload(unsignedPresence(record), record.signature, publicKey);
}
