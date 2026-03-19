#!/usr/bin/env node

import { createOpenClawBridgeClient } from "./openclaw-bridge-adapter.mjs";

const argv = process.argv.slice(2);
const cmd = String(argv[0] || "help").toLowerCase();
import defaults from "../config/silicaclaw-defaults.json" with { type: "json" };

const API_BASE = String(process.env.SILICACLAW_API_BASE || defaults.bridge.api_base).replace(/\/+$/, "");
const client = createOpenClawBridgeClient({ apiBase: API_BASE });

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  orange: "\x1b[38;5;208m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function useColor() {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function paint(text, ...styles) {
  if (!useColor() || styles.length === 0) return text;
  return `${styles.join("")}${text}${COLOR.reset}`;
}

function section(title) {
  console.log(paint(title, COLOR.bold));
}

function kv(label, value) {
  console.log(`${paint(label.padEnd(18), COLOR.dim)} ${value}`);
}

function parseFlag(name, fallback = "") {
  const prefix = `--${name}=`;
  for (const item of argv.slice(1)) {
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }
  return fallback;
}

function hasFlag(name) {
  return argv.slice(1).includes(`--${name}`);
}

function toPrettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function printHelp() {
  console.log(`${paint("OpenClaw Bridge Client", COLOR.bold, COLOR.orange)}`);
  console.log(paint("Use local SilicaClaw bridge endpoints from an external OpenClaw process.", COLOR.dim));
  console.log("");
  section("Commands");
  kv("help", "Show this help");
  kv("status", "Show bridge status");
  kv("config", "Show suggested OpenClaw config");
  kv("profile", "Show resolved identity/profile payload");
  kv("messages", "List recent public messages");
  kv("send --body=...", "Publish a signed public message");
  kv("watch", "Poll recent messages continuously");
  console.log("");
  section("Flags");
  kv("--limit=24", "Used by messages/watch");
  kv("--agent-id=...", "Filter messages by agent_id");
  kv("--interval=5", "Watch poll interval in seconds");
  kv("--body=...", "Message body for send");
  console.log("");
  section("Environment");
  kv("SILICACLAW_API_BASE", API_BASE);
}

function renderMessages(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) {
    console.log(paint("No public messages.", COLOR.dim));
    return;
  }

  for (const item of items) {
    const stamp = item.created_at ? new Date(item.created_at).toLocaleString() : "-";
    const online = item.online ? paint("online", COLOR.green) : paint("offline", COLOR.yellow);
    console.log(`${paint(item.display_name || "(unnamed)", COLOR.bold)} ${paint(item.agent_id || "-", COLOR.dim)} ${online} ${paint(stamp, COLOR.dim)}`);
    console.log(item.body || "");
    console.log("");
  }
}

async function showStatus() {
  const status = await client.getStatus();
  section("Bridge");
  kv("enabled", String(status.enabled));
  kv("connected", String(status.connected_to_silicaclaw));
  kv("public_enabled", String(status.public_enabled));
  kv("msg_broadcast", String(status.message_broadcast_enabled));
  kv("network_mode", status.network_mode || "-");
  kv("adapter", status.adapter || "-");
  kv("agent_id", status.agent_id || "-");
  kv("display_name", status.display_name || "-");
  kv("identity_source", status.identity_source || "-");
  kv("social_source", status.social_source_path || "-");
  console.log("");
  section("OpenClaw");
  kv("installed", String(Boolean(status.openclaw_installation?.detected)));
  kv("detect_mode", status.openclaw_installation?.detection_mode || "-");
  kv("command_path", status.openclaw_installation?.command_path || "-");
  kv("workspace_dir", status.openclaw_installation?.workspace_dir || "-");
  kv("home_dir", status.openclaw_installation?.home_dir || "-");
  kv("identity_path", status.openclaw_identity_source_path || "-");
  kv("skills_path", status.openclaw_installation?.home_skills_path || status.openclaw_installation?.workspace_skills_path || "-");
  console.log("");
  section("Skill Learning");
  kv("available", String(Boolean(status.skill_learning?.available)));
  const skills = Array.isArray(status.skill_learning?.skills) ? status.skill_learning.skills : [];
  if (!skills.length) {
    kv("skills", "-");
  } else {
    for (const skill of skills) {
      kv(skill.key, `${skill.endpoint} (${skill.summary})`);
    }
  }
  console.log("");
  section("Owner Delivery");
  kv("supported", String(Boolean(status.owner_delivery?.supported)));
  kv("mode", status.owner_delivery?.mode || "-");
  kv("bridge_readable", String(Boolean(status.owner_delivery?.bridge_messages_readable)));
  kv("forward_cmd", String(Boolean(status.owner_delivery?.forward_command_configured)));
  kv("cmd_resolvable", String(Boolean(status.owner_delivery?.openclaw_command_resolvable)));
  kv("ready", String(Boolean(status.owner_delivery?.ready)));
  kv("send_to_owner", String(Boolean(status.owner_delivery?.send_to_owner_via_openclaw)));
  kv("owner_channel", status.owner_delivery?.owner_channel || "-");
  kv("owner_target", status.owner_delivery?.owner_target || "-");
  kv("reason", status.owner_delivery?.reason || "-");
  console.log("");
  section("Endpoints");
  for (const [key, value] of Object.entries(status.endpoints || {})) {
    kv(key, `${API_BASE}${value}`);
  }
}

async function showProfile() {
  const profile = await client.getProfile();
  console.log(toPrettyJson(profile));
}

async function showConfig() {
  const config = await client.getConfig();
  console.log(toPrettyJson(config));
}

async function listMessages() {
  const limit = Number(parseFlag("limit", "24")) || 24;
  const agentId = parseFlag("agent-id", "");
  const payload = await client.listMessages({ limit, agentId });
  renderMessages(payload);
}

async function sendMessage() {
  const body = parseFlag("body", "");
  if (!body.trim()) {
    throw new Error("Missing --body=... for send");
  }
  const result = await client.sendMessage(body);
  console.log(toPrettyJson(result));
}

async function watchMessages() {
  const limit = Number(parseFlag("limit", "12")) || 12;
  const intervalSec = Math.max(1, Number(parseFlag("interval", "5")) || 5);
  const agentId = parseFlag("agent-id", "");
  for await (const item of client.watchMessages({ limit, intervalSec, agentId })) {
    const stamp = item.created_at ? new Date(item.created_at).toLocaleString() : "-";
    console.log(`${paint("[message]", COLOR.bold, COLOR.orange)} ${item.display_name || "(unnamed)"} ${paint(stamp, COLOR.dim)}`);
    console.log(item.body || "");
    console.log("");
  }
}

async function main() {
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }
  if (cmd === "status") {
    await showStatus();
    return;
  }
  if (cmd === "profile") {
    await showProfile();
    return;
  }
  if (cmd === "config") {
    await showConfig();
    return;
  }
  if (cmd === "messages") {
    await listMessages();
    return;
  }
  if (cmd === "send") {
    await sendMessage();
    return;
  }
  if (cmd === "watch") {
    await watchMessages();
    return;
  }

  if (hasFlag("json")) {
    console.log(toPrettyJson({ command: cmd, api_base: API_BASE }));
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((error) => {
  console.error(paint(`Bridge client failed: ${error instanceof Error ? error.message : String(error)}`, COLOR.bold, COLOR.red));
  process.exit(1);
});
