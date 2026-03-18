const DEFAULT_API_BASE = "http://localhost:4310";

function normalizeApiBase(value) {
  return String(value || DEFAULT_API_BASE).replace(/\/+$/, "");
}

async function bridgeRequest(apiBase, path, options = {}) {
  const res = await fetch(`${normalizeApiBase(apiBase)}${path}`, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.ok) {
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }
  return json.data;
}

export function createOpenClawBridgeClient(options = {}) {
  const apiBase = normalizeApiBase(options.apiBase || process.env.SILICACLAW_API_BASE || DEFAULT_API_BASE);

  return {
    apiBase,
    async getStatus() {
      return bridgeRequest(apiBase, "/api/openclaw/bridge");
    },
    async getProfile() {
      return bridgeRequest(apiBase, "/api/openclaw/bridge/profile");
    },
    async listMessages(input = {}) {
      const qs = new URLSearchParams();
      qs.set("limit", String(Number(input.limit || 24) || 24));
      if (input.agentId) {
        qs.set("agent_id", String(input.agentId).trim());
      }
      return bridgeRequest(apiBase, `/api/openclaw/bridge/messages?${qs.toString()}`);
    },
    async sendMessage(body) {
      return bridgeRequest(apiBase, "/api/openclaw/bridge/message", {
        method: "POST",
        body: JSON.stringify({ body: String(body || "") }),
      });
    },
    async *watchMessages(input = {}) {
      const intervalMs = Math.max(1000, Math.floor((Number(input.intervalSec || 5) || 5) * 1000));
      const limit = Number(input.limit || 12) || 12;
      const agentId = input.agentId ? String(input.agentId).trim() : "";
      const seen = new Set();

      while (true) {
        const payload = await this.listMessages({ limit, agentId });
        const items = Array.isArray(payload?.items) ? payload.items.slice().reverse() : [];
        for (const item of items) {
          if (!item?.message_id || seen.has(item.message_id)) {
            continue;
          }
          seen.add(item.message_id);
          yield item;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    },
  };
}

export async function getOpenClawBridgeStatus(options = {}) {
  return createOpenClawBridgeClient(options).getStatus();
}

export async function getOpenClawBridgeProfile(options = {}) {
  return createOpenClawBridgeClient(options).getProfile();
}

export async function listOpenClawBridgeMessages(options = {}) {
  return createOpenClawBridgeClient(options).listMessages(options);
}

export async function sendOpenClawBridgeMessage(body, options = {}) {
  return createOpenClawBridgeClient(options).sendMessage(body);
}
