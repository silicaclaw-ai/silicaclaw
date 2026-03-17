import nacl from "tweetnacl";
import { hashPublicKey, toBase64 } from "./crypto";
import { AgentIdentity } from "./types";

export function createIdentity(now = Date.now()): AgentIdentity {
  const pair = nacl.sign.keyPair();
  const publicKey = toBase64(pair.publicKey);
  return {
    agent_id: hashPublicKey(pair.publicKey),
    public_key: publicKey,
    private_key: toBase64(pair.secretKey),
    created_at: now,
  };
}
