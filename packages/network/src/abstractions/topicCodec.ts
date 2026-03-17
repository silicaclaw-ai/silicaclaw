export interface TopicCodec {
  encode(topic: string, payload: unknown): unknown;
  decode(topic: string, payload: unknown): unknown;
}
