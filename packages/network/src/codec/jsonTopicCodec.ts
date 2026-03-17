import { TopicCodec } from "../abstractions/topicCodec";

export class JsonTopicCodec implements TopicCodec {
  encode(_topic: string, payload: unknown): unknown {
    return payload;
  }

  decode(_topic: string, payload: unknown): unknown {
    return payload;
  }
}
