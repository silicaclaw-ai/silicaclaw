import { DecodedNetworkMessage, MessageEnvelopeCodec, NetworkMessageEnvelope } from "../abstractions/messageEnvelope";

export class JsonMessageEnvelopeCodec implements MessageEnvelopeCodec {
  encode(envelope: NetworkMessageEnvelope): Buffer {
    return Buffer.from(JSON.stringify(envelope), "utf8");
  }

  decode(raw: Buffer): DecodedNetworkMessage | null {
    try {
      const parsed = JSON.parse(raw.toString("utf8")) as unknown;
      if (typeof parsed !== "object" || parsed === null) {
        return null;
      }
      return {
        envelope: parsed as NetworkMessageEnvelope,
        raw,
      };
    } catch {
      return null;
    }
  }
}
