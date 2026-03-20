import nacl from "tweetnacl";
import { fromBase64, toBase64 } from "./crypto";
import { PrivateEncryptionKeyPair } from "./types";

export function createPrivateEncryptionKeyPair(now = Date.now()): PrivateEncryptionKeyPair {
  const pair = nacl.box.keyPair();
  return {
    public_key: toBase64(pair.publicKey),
    private_key: toBase64(pair.secretKey),
    created_at: now,
  };
}

export function encryptPrivatePayload(input: {
  plaintext: string;
  recipient_public_key: string;
  sender_keypair?: PrivateEncryptionKeyPair | null;
}): {
  ciphertext: string;
  nonce: string;
  sender_encryption_public_key: string;
} {
  const sender = input.sender_keypair || createPrivateEncryptionKeyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const message = Buffer.from(String(input.plaintext || ""), "utf8");
  const ciphertext = nacl.box(
    new Uint8Array(message),
    nonce,
    fromBase64(input.recipient_public_key),
    fromBase64(sender.private_key),
  );
  return {
    ciphertext: toBase64(ciphertext),
    nonce: toBase64(nonce),
    sender_encryption_public_key: sender.public_key,
  };
}

export function decryptPrivatePayload(input: {
  ciphertext: string;
  nonce: string;
  sender_encryption_public_key: string;
  recipient_private_key: string;
}): string | null {
  try {
    const opened = nacl.box.open(
      fromBase64(input.ciphertext),
      fromBase64(input.nonce),
      fromBase64(input.sender_encryption_public_key),
      fromBase64(input.recipient_private_key),
    );
    if (!opened) return null;
    return Buffer.from(opened).toString("utf8");
  } catch {
    return null;
  }
}
