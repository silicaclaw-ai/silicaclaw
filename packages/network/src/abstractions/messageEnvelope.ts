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
