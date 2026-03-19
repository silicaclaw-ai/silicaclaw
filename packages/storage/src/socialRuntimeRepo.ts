import { resolve } from "path";
import { SocialRuntimeConfig } from "@silicaclaw/core";
import { JsonFileRepo } from "./jsonRepo";
import defaults from "../config/silicaclaw-defaults.json";

function emptyRuntime(): SocialRuntimeConfig {
  return {
    enabled: true,
    public_enabled: false,
    source_path: null,
    last_loaded_at: 0,
    social_found: false,
    parse_error: null,
    resolved_identity: null,
    resolved_profile: null,
    resolved_network: {
      mode: defaults.network.default_mode as SocialRuntimeConfig["resolved_network"]["mode"],
      adapter: "relay-preview",
      namespace: defaults.network.default_namespace,
      port: null,
      signaling_url: defaults.network.global_preview.relay_url,
      signaling_urls: [],
      room: defaults.network.global_preview.room,
      seed_peers: [],
      bootstrap_hints: [],
      bootstrap_sources: [],
    },
    resolved_discovery: {
      discoverable: true,
      allow_profile_broadcast: true,
      allow_presence_broadcast: true,
      allow_message_broadcast: true,
    },
    visibility: {
      show_display_name: true,
      show_bio: true,
      show_tags: true,
      show_agent_id: true,
      show_last_seen: true,
      show_capabilities_summary: true,
    },
    openclaw: {
      bind_existing_identity: true,
      use_openclaw_profile_if_available: true,
    },
  };
}

export class SocialRuntimeRepo extends JsonFileRepo<SocialRuntimeConfig> {
  constructor(rootDir = process.cwd()) {
    super(resolve(rootDir, ".silicaclaw", "social.runtime.json"), emptyRuntime);
  }
}
