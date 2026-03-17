import { createHash } from "crypto";
import nacl from "tweetnacl";

export function toBase64(input: Uint8Array): string {
  return Buffer.from(input).toString("base64");
}

export function fromBase64(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "base64"));
}

export function hashPublicKey(publicKey: Uint8Array): string {
  return createHash("sha256").update(publicKey).digest("hex");
}

export function stableStringify(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input);
  }
  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, value]) => `${JSON.stringify(key)}:${stableStringify(value)}`)
    .join(",")}}`;
}

export function signPayload(payload: unknown, privateKeyBase64: string): string {
  const payloadString = stableStringify(payload);
  const signature = nacl.sign.detached(
    Buffer.from(payloadString),
    fromBase64(privateKeyBase64)
  );
  return toBase64(signature);
}

export function verifyPayload(
  payload: unknown,
  signatureBase64: string,
  publicKeyBase64: string
): boolean {
  try {
    const payloadString = stableStringify(payload);
    return nacl.sign.detached.verify(
      Buffer.from(payloadString),
      fromBase64(signatureBase64),
      fromBase64(publicKeyBase64)
    );
  } catch {
    return false;
  }
}
