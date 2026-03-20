import {
  AgentIdentity,
  PrivateMessageReceiptRecord,
  PrivateMessageRecord,
} from "./types";
import { fromBase64, hashPublicKey, signPayload, verifyPayload } from "./crypto";

function unsignedPrivateMessage(
  record: PrivateMessageRecord
): Omit<PrivateMessageRecord, "signature"> {
  const { signature: _signature, ...rest } = record;
  return rest;
}

function unsignedPrivateMessageReceipt(
  record: PrivateMessageReceiptRecord
): Omit<PrivateMessageReceiptRecord, "signature"> {
  const { signature: _signature, ...rest } = record;
  return rest;
}

export function signPrivateMessage(input: {
  identity: AgentIdentity;
  message_id: string;
  conversation_id: string;
  to_agent_id: string;
  sender_encryption_public_key: string;
  recipient_encryption_public_key: string;
  ciphertext: string;
  nonce: string;
  created_at?: number;
}): PrivateMessageRecord {
  const payload: Omit<PrivateMessageRecord, "signature"> = {
    type: "private.message",
    message_id: input.message_id,
    conversation_id: input.conversation_id,
    from_agent_id: input.identity.agent_id,
    to_agent_id: input.to_agent_id,
    sender_public_key: input.identity.public_key,
    sender_encryption_public_key: input.sender_encryption_public_key,
    recipient_encryption_public_key: input.recipient_encryption_public_key,
    cipher_scheme: "nacl-box-v1",
    ciphertext: input.ciphertext,
    nonce: input.nonce,
    created_at: input.created_at ?? Date.now(),
  };

  return {
    ...payload,
    signature: signPayload(payload, input.identity.private_key),
  };
}

export function verifyPrivateMessage(record: PrivateMessageRecord): boolean {
  try {
    if (hashPublicKey(fromBase64(record.sender_public_key)) !== record.from_agent_id) {
      return false;
    }
    return verifyPayload(unsignedPrivateMessage(record), record.signature, record.sender_public_key);
  } catch {
    return false;
  }
}

export function signPrivateMessageReceipt(input: {
  identity: AgentIdentity;
  receipt_id: string;
  message_id: string;
  conversation_id: string;
  to_agent_id: string;
  status: "received" | "read";
  created_at?: number;
}): PrivateMessageReceiptRecord {
  const payload: Omit<PrivateMessageReceiptRecord, "signature"> = {
    type: "private.message.receipt",
    receipt_id: input.receipt_id,
    message_id: input.message_id,
    conversation_id: input.conversation_id,
    from_agent_id: input.identity.agent_id,
    to_agent_id: input.to_agent_id,
    sender_public_key: input.identity.public_key,
    status: input.status,
    created_at: input.created_at ?? Date.now(),
  };

  return {
    ...payload,
    signature: signPayload(payload, input.identity.private_key),
  };
}

export function verifyPrivateMessageReceipt(record: PrivateMessageReceiptRecord): boolean {
  try {
    if (hashPublicKey(fromBase64(record.sender_public_key)) !== record.from_agent_id) {
      return false;
    }
    return verifyPayload(unsignedPrivateMessageReceipt(record), record.signature, record.sender_public_key);
  } catch {
    return false;
  }
}
