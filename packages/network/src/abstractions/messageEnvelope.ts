export type NetworkMessageEnvelope<TPayload = unknown> = {
  version: 1;
  message_id: string;
  topic: string;
  source_peer_id: string;
  timestamp: number;
  payload: TPayload;
};

export type DecodedNetworkMessage = {
  envelope: NetworkMessageEnvelope;
  raw: Buffer;
};

export interface MessageEnvelopeCodec {
  encode(envelope: NetworkMessageEnvelope): Buffer;
  decode(raw: Buffer): DecodedNetworkMessage | null;
}

export type EnvelopeValidationOptions = {
  now?: number;
  max_future_drift_ms: number;
  max_past_drift_ms: number;
};

export type EnvelopeValidationResult = {
  ok: boolean;
  reason?:
    | "not_object"
    | "invalid_version"
    | "invalid_message_id"
    | "invalid_topic"
    | "invalid_source_peer_id"
    | "invalid_timestamp"
    | "missing_payload"
    | "timestamp_future_drift"
    | "timestamp_past_drift";
  envelope?: NetworkMessageEnvelope;
  drift_ms?: number;
};

export function validateNetworkMessageEnvelope(
  value: unknown,
  options: EnvelopeValidationOptions
): EnvelopeValidationResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, reason: "not_object" };
  }

  const envelope = value as Partial<NetworkMessageEnvelope>;
  if (envelope.version !== 1) {
    return { ok: false, reason: "invalid_version" };
  }
  if (typeof envelope.message_id !== "string" || envelope.message_id.trim().length === 0) {
    return { ok: false, reason: "invalid_message_id" };
  }
  if (typeof envelope.topic !== "string" || envelope.topic.trim().length === 0) {
    return { ok: false, reason: "invalid_topic" };
  }
  if (typeof envelope.source_peer_id !== "string" || envelope.source_peer_id.trim().length === 0) {
    return { ok: false, reason: "invalid_source_peer_id" };
  }
  if (!Number.isFinite(envelope.timestamp)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (!("payload" in envelope)) {
    return { ok: false, reason: "missing_payload" };
  }

  const now = options.now ?? Date.now();
  const drift = Number(envelope.timestamp) - now;
  if (drift > options.max_future_drift_ms) {
    return { ok: false, reason: "timestamp_future_drift", drift_ms: drift };
  }
  if (drift < -options.max_past_drift_ms) {
    return { ok: false, reason: "timestamp_past_drift", drift_ms: drift };
  }

  return { ok: true, envelope: envelope as NetworkMessageEnvelope, drift_ms: drift };
}
