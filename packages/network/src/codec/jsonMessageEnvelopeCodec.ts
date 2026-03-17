import { DecodedNetworkMessage, MessageEnvelopeCodec, NetworkMessageEnvelope } from "../abstractions/messageEnvelope";

export class JsonMessageEnvelopeCodec implements MessageEnvelopeCodec {
  encode(envelope: NetworkMessageEnvelope): Buffer {
    return Buffer.from(JSON.stringify(envelope), "utf8");
  }

  decode(raw: Buffer): DecodedNetworkMessage | null {
    try {
      const parsed = JSON.parse(raw.toString("utf8")) as NetworkMessageEnvelope;
      if (
        parsed?.version !== 1 ||
        typeof parsed?.message_id !== "string" ||
        typeof parsed?.topic !== "string" ||
        typeof parsed?.source_peer_id !== "string" ||
        typeof parsed?.timestamp !== "number"
      ) {
        return null;
      }
      return {
        envelope: parsed,
        raw,
      };
    } catch {
      return null;
    }
  }
}
