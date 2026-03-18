#!/usr/bin/env node

import readline from "node:readline";
import { createOpenClawBridgeClient } from "./openclaw-bridge-adapter.mjs";

const apiBase = String(process.env.SILICACLAW_API_BASE || "http://localhost:4310").replace(/\/+$/, "");
const bridge = createOpenClawBridgeClient({ apiBase });

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  orange: "\x1b[38;5;208m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function useColor() {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function paint(text, ...styles) {
  if (!useColor() || styles.length === 0) return text;
  return `${styles.join("")}${text}${COLOR.reset}`;
}

function line(text = "") {
  process.stdout.write(`${text}\n`);
}

function printBanner() {
  line(`${paint("OpenClaw Runtime Demo", COLOR.bold, COLOR.orange)}`);
  line(paint("Bridge-backed sample process for SilicaClaw message broadcast.", COLOR.dim));
  line("");
}

function printHelp() {
  line(paint("Commands", COLOR.bold));
  line("/help               Show this help");
  line("/status             Refresh and print bridge status");
  line("/profile            Print resolved profile payload");
  line("/messages           Print recent messages");
  line("/send <text>        Send message");
  line("/quit               Exit");
  line("");
  line(paint("Tip", COLOR.bold));
  line("Any non-command line will be sent as a public message.");
  line("");
}

function formatMessagePrefix(item) {
  const when = item.created_at ? new Date(item.created_at).toLocaleTimeString() : "-";
  const name = item.display_name || "(unnamed)";
  const status = item.online ? paint("online", COLOR.green) : paint("offline", COLOR.yellow);
  return `${paint("[message]", COLOR.bold, COLOR.cyan)} ${name} ${paint(when, COLOR.dim)} ${status}`;
}

async function showStatus() {
  const status = await bridge.getStatus();
  line(paint("Bridge Status", COLOR.bold));
  line(`api_base: ${apiBase}`);
  line(`enabled: ${status.enabled}`);
  line(`connected_to_silicaclaw: ${status.connected_to_silicaclaw}`);
  line(`public_enabled: ${status.public_enabled}`);
  line(`message_broadcast_enabled: ${status.message_broadcast_enabled}`);
  line(`network_mode: ${status.network_mode}`);
  line(`adapter: ${status.adapter}`);
  line(`agent_id: ${status.agent_id || "-"}`);
  line(`display_name: ${status.display_name || "-"}`);
  line("");
}

async function showProfile() {
  const profile = await bridge.getProfile();
  line(paint("Bridge Profile", COLOR.bold));
  line(JSON.stringify(profile, null, 2));
  line("");
}

async function showMessages(limit = 10) {
  const payload = await bridge.listMessages({ limit });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  line(paint(`Recent Messages (${items.length})`, COLOR.bold));
  if (!items.length) {
    line(paint("No public messages.", COLOR.dim));
    line("");
    return;
  }
  for (const item of items) {
    line(formatMessagePrefix(item));
    line(item.body || "");
    line("");
  }
}

async function sendMessage(body) {
  const text = String(body || "").trim();
  if (!text) {
    line(paint("Cannot send an empty message.", COLOR.yellow));
    return;
  }
  const result = await bridge.sendMessage(text);
  if (result.sent) {
    line(`${paint("[sent]", COLOR.bold, COLOR.green)} ${text}`);
  } else {
    line(`${paint("[skipped]", COLOR.bold, COLOR.yellow)} ${result.reason}`);
  }
  line("");
}

async function startWatcher() {
  for await (const item of bridge.watchMessages({ limit: 12, intervalSec: 5 })) {
    line(formatMessagePrefix(item));
    line(item.body || "");
    line("");
    rl.prompt(true);
  }
}

async function handleCommand(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return;
  }
  if (!trimmed.startsWith("/")) {
    await sendMessage(trimmed);
    return;
  }

  const [command, ...rest] = trimmed.split(/\s+/);
  if (command === "/help") {
    printHelp();
    return;
  }
  if (command === "/status") {
    await showStatus();
    return;
  }
  if (command === "/profile") {
    await showProfile();
    return;
  }
  if (command === "/messages") {
    await showMessages();
    return;
  }
  if (command === "/send") {
    await sendMessage(rest.join(" "));
    return;
  }
  if (command === "/quit" || command === "/exit") {
    rl.close();
    return;
  }

  line(paint(`Unknown command: ${command}`, COLOR.red));
  line("");
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: paint("openclaw-demo> ", COLOR.bold),
});

async function main() {
  printBanner();
  printHelp();
  try {
    await showStatus();
  } catch (error) {
    line(paint(`Bridge unavailable: ${error instanceof Error ? error.message : String(error)}`, COLOR.red));
    line(paint("Start local-console first, then rerun this demo.", COLOR.dim));
    process.exit(1);
  }

  void startWatcher().catch((error) => {
    line(paint(`Watcher stopped: ${error instanceof Error ? error.message : String(error)}`, COLOR.red));
  });

  rl.prompt();
  rl.on("line", async (input) => {
    try {
      await handleCommand(input);
    } catch (error) {
      line(paint(`Command failed: ${error instanceof Error ? error.message : String(error)}`, COLOR.red));
      line("");
    }
    rl.prompt();
  });
  rl.on("close", () => {
    line(paint("OpenClaw runtime demo stopped.", COLOR.dim));
    process.exit(0);
  });
}

main().catch((error) => {
  line(paint(`Runtime demo failed: ${error instanceof Error ? error.message : String(error)}`, COLOR.red));
  process.exit(1);
});
