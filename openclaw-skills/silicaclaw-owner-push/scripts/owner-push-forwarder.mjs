#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const API_BASE = String(process.env.SILICACLAW_API_BASE || "http://localhost:4310").replace(/\/+$/, "");
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.OPENCLAW_FORWARDER_INTERVAL_MS || 5000) || 5000);
const LIMIT = Math.max(1, Number(process.env.OPENCLAW_FORWARDER_LIMIT || 30) || 30);
const OWNER_FORWARD_CMD = String(process.env.OPENCLAW_OWNER_FORWARD_CMD || "").trim();
const STATE_PATH = resolve(
  String(process.env.OPENCLAW_OWNER_FORWARD_STATE_PATH || resolve(homedir(), ".openclaw", "workspace", "state", "silicaclaw-owner-push.json"))
);
const ONCE = process.argv.includes("--once");
const VERBOSE = process.argv.includes("--verbose");

function parseListEnv(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

const TOPIC_FILTERS = parseListEnv("OPENCLAW_FORWARD_TOPICS");
const INCLUDE_TERMS = parseListEnv("OPENCLAW_FORWARD_INCLUDE");
const EXCLUDE_TERMS = parseListEnv("OPENCLAW_FORWARD_EXCLUDE");
const DEFAULT_SIGNAL_TERMS = [
  "approval",
  "approve",
  "blocked",
  "error",
  "failed",
  "failure",
  "complete",
  "completed",
  "deploy",
  "security",
  "credential",
  "fund",
  "payment",
  "risk",
  "urgent",
];

function request(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  }).then(async (res) => {
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error?.message || `Request failed (${res.status})`);
    }
    return json.data;
  });
}

function loadState() {
  if (!existsSync(STATE_PATH)) {
    return {
      seen_ids: [],
      pushed_at: {},
    };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {
      seen_ids: [],
      pushed_at: {},
    };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function trimState(state) {
  const recentIds = Array.isArray(state.seen_ids) ? state.seen_ids.slice(-500) : [];
  const pushedEntries = Object.entries(state.pushed_at || {}).slice(-500);
  state.seen_ids = recentIds;
  state.pushed_at = Object.fromEntries(pushedEntries);
}

function shouldWatchTopic(message) {
  if (!TOPIC_FILTERS.length) return true;
  return TOPIC_FILTERS.includes(String(message?.topic || "global").toLowerCase());
}

function scoreRoute(message) {
  const text = [
    String(message?.topic || ""),
    String(message?.display_name || ""),
    String(message?.body || ""),
  ].join(" ").toLowerCase();

  if (!text.trim()) return "ignore";
  if (EXCLUDE_TERMS.some((term) => text.includes(term))) return "ignore";

  if (INCLUDE_TERMS.length && INCLUDE_TERMS.some((term) => text.includes(term))) {
    return "push_summary";
  }

  if (DEFAULT_SIGNAL_TERMS.some((term) => text.includes(term))) {
    return "push_summary";
  }

  return "ignore";
}

function summarizeForOwner(message) {
  const source = `${message.display_name || "Unknown"} · ${message.topic || "global"}`;
  const body = String(message.body || "").trim();
  const priority = scoreRoute(message) === "push_summary"
    ? "Owner-relevant SilicaClaw broadcast"
    : "Routine";
  return [
    `Source: ${source}`,
    `Priority: ${priority}`,
    `What happened: ${body.slice(0, 240)}${body.length > 240 ? "..." : ""}`,
    "Action: Review whether owner follow-up or approval is needed.",
  ].join("\n");
}

function dispatchToOwner(route, summary, message) {
  if (!OWNER_FORWARD_CMD) {
    console.log("");
    console.log(`[${route}] ${message.message_id || "-"}`);
    console.log(summary);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(OWNER_FORWARD_CMD, {
      shell: true,
      stdio: ["pipe", "inherit", "inherit"],
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`owner dispatch failed (exit=${code ?? "unknown"})`));
    });
    child.stdin.write(JSON.stringify({
      route,
      summary,
      message: {
        message_id: message.message_id || "",
        display_name: message.display_name || "",
        topic: message.topic || "global",
        body: message.body || "",
        created_at: message.created_at || Date.now(),
      },
    }, null, 2));
    child.stdin.end();
  });
}

async function pollOnce(state) {
  const payload = await request(`/api/openclaw/bridge/messages?limit=${LIMIT}`);
  const items = Array.isArray(payload?.items) ? payload.items.slice().reverse() : [];

  for (const item of items) {
    const messageId = String(item?.message_id || "").trim();
    if (!messageId) continue;
    if (state.seen_ids.includes(messageId)) continue;

    state.seen_ids.push(messageId);

    if (!shouldWatchTopic(item)) {
      if (VERBOSE) console.log(`skip topic: ${messageId}`);
      continue;
    }

    const route = scoreRoute(item);
    if (route === "ignore") {
      if (VERBOSE) console.log(`ignore low-signal: ${messageId}`);
      continue;
    }

    const summary = summarizeForOwner(item);
    await dispatchToOwner(route, summary, item);
    state.pushed_at[messageId] = new Date().toISOString();
    if (VERBOSE) console.log(`pushed to owner: ${messageId}`);
  }

  trimState(state);
  saveState(state);
}

async function main() {
  const state = loadState();
  if (VERBOSE) {
    console.log(`SilicaClaw owner push watching ${API_BASE}`);
    console.log(`State file: ${STATE_PATH}`);
  }

  do {
    await pollOnce(state);
    if (ONCE) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  } while (true);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
