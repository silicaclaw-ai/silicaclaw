#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");

const argv = process.argv.slice(2);
const cmd = String(argv[0] || "help").toLowerCase();

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

function headline() {
  const version = existsSync(join(ROOT_DIR, "VERSION")) ? String(readFileSync(join(ROOT_DIR, "VERSION"), "utf8")).trim() : "unknown";
  console.log(`${paint("SilicaClaw", COLOR.bold, COLOR.orange)} ${paint(version, COLOR.dim)}`);
  console.log(paint("Public identity and discovery for OpenClaw agents.", COLOR.dim));
}

function kv(label, value) {
  console.log(`${paint(label.padEnd(14), COLOR.dim)} ${value}`);
}

function section(title) {
  console.log(paint(title, COLOR.bold));
}

function readJson(file) {
  try {
    return JSON.parse(String(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function isSilicaClawDir(dir) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  const pkg = readJson(pkgPath);
  if (!pkg || typeof pkg !== "object") return false;
  const name = String(pkg.name || "");
  if (name === "@silicaclaw/cli" || name === "silicaclaw") return true;
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  return Boolean(scripts.gateway || scripts["local-console"] || scripts["public-explorer"]);
}

function parseFlag(name, fallback = "") {
  const prefix = `--${name}=`;
  for (const item of argv) {
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }
  return fallback;
}

function hasFlag(name) {
  return argv.includes(`--${name}`);
}

function detectAppDir() {
  const envDir = process.env.SILICACLAW_APP_DIR;
  if (envDir && isSilicaClawDir(envDir)) {
    return resolve(envDir);
  }

  const cwd = process.cwd();
  if (isSilicaClawDir(cwd)) {
    return resolve(cwd);
  }

  const homeCandidate = join(homedir(), "silicaclaw");
  if (isSilicaClawDir(homeCandidate)) {
    return resolve(homeCandidate);
  }

  return ROOT_DIR;
}

const APP_DIR = detectAppDir();
const STATE_DIR = join(APP_DIR, ".silicaclaw", "gateway");
const CONSOLE_PID_FILE = join(STATE_DIR, "local-console.pid");
const CONSOLE_LOG_FILE = join(STATE_DIR, "local-console.log");
const SIGNALING_PID_FILE = join(STATE_DIR, "signaling.pid");
const SIGNALING_LOG_FILE = join(STATE_DIR, "signaling.log");
const STATE_FILE = join(STATE_DIR, "state.json");

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true });
}

function readPid(file) {
  if (!existsSync(file)) return null;
  const text = String(readFileSync(file, "utf8")).trim();
  const pid = Number(text);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeFileIfExists(path) {
  if (existsSync(path)) rmSync(path, { force: true });
}

async function stopPid(pid, name) {
  if (!pid || !isRunning(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (!isRunning(pid)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (isRunning(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
  if (isRunning(pid)) {
    console.error(`${paint("Failed to stop", COLOR.bold, COLOR.red)} ${name} (pid=${pid})`);
  }
}

function parseMode(raw) {
  const mode = String(raw || "local").trim().toLowerCase();
  if (mode === "lan" || mode === "global-preview" || mode === "local") return mode;
  return "local";
}

function adapterForMode(mode) {
  if (mode === "lan") return "real-preview";
  if (mode === "global-preview") return "relay-preview";
  return "local-event-bus";
}

function parseUrlHostPort(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || "",
      port: Number(u.port || 4510),
    };
  } catch {
    return { host: "", port: 4510 };
  }
}

function spawnBackground(command, args, env, logFile, pidFile) {
  const outFd = openSync(logFile, "a");
  const child = spawn(command, args, {
    cwd: APP_DIR,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", outFd, outFd],
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  return child.pid;
}

function writeState(state) {
  ensureStateDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function readState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function printHelp() {
  headline();
  console.log("");
  section("Gateway commands");
  kv("Start", "silicaclaw gateway start --mode=global-preview");
  kv("Stop", "silicaclaw gateway stop");
  kv("Restart", "silicaclaw gateway restart --mode=global-preview");
  kv("Status", "silicaclaw gateway status");
  kv("Logs", "silicaclaw gateway logs local-console");
  console.log("");
  section("Notes");
  kv("App dir", "current directory, then ~/silicaclaw");
  kv("State dir", ".silicaclaw/gateway");
  kv("Default relay", "https://relay.silicaclaw.com");
  kv("Default room", "silicaclaw-global-preview");
}

function buildStatusPayload() {
  const localPid = readPid(CONSOLE_PID_FILE);
  const sigPid = readPid(SIGNALING_PID_FILE);
  const state = readState();
  return {
    app_dir: APP_DIR,
    mode: state?.mode || "unknown",
    adapter: state?.adapter || "unknown",
    local_console: {
      pid: localPid,
      running: isRunning(localPid),
      log_file: CONSOLE_LOG_FILE,
    },
    signaling: {
      pid: sigPid,
      running: isRunning(sigPid),
      log_file: SIGNALING_LOG_FILE,
      url: state?.signaling_url || null,
      room: state?.room || null,
    },
    updated_at: state?.updated_at || null,
  };
}

function showStatusJson() {
  console.log(JSON.stringify(buildStatusPayload(), null, 2));
}

function showStatusHuman() {
  const payload = buildStatusPayload();
  headline();
  console.log("");
  console.log(paint("Gateway status", COLOR.bold));
  kv("App dir", payload.app_dir);
  kv("Mode", payload.mode);
  kv("Adapter", payload.adapter);
  kv(
    "Console",
    payload.local_console.running
      ? `${paint("running", COLOR.green)} (pid=${payload.local_console.pid})`
      : paint("stopped", COLOR.dim)
  );
  if (payload.mode === "global-preview") {
    kv("Relay", payload.signaling.url || "https://relay.silicaclaw.com");
    kv("Room", payload.signaling.room || "silicaclaw-global-preview");
  }
  if (payload.signaling.running) {
    kv("Signaling", `${paint("running", COLOR.green)} (pid=${payload.signaling.pid})`);
  }
  console.log("");
  kv("Open", "http://localhost:4310");
  kv("Logs", "silicaclaw logs local-console");
  kv("Stop", "silicaclaw stop");
  return payload;
}

function printConnectionSummary(status, verb = "Started") {
  if (!status?.local_console?.running) return;
  headline();
  console.log("");
  console.log(`${paint(verb, COLOR.bold)} background services`);
  kv("Console", `http://localhost:4310`);
  kv("Console pid", String(status?.local_console?.pid || "-"));
  kv("Mode", status.mode);
  kv("Adapter", status.adapter);
  if (status.mode === "global-preview") {
    const signalingUrl = status?.signaling?.url || "https://relay.silicaclaw.com";
    const room = status?.signaling?.room || "silicaclaw-global-preview";
    kv("Relay", signalingUrl);
    kv("Room", room);
  }
  console.log("");
  kv("Status", "silicaclaw status");
  kv("Logs", "silicaclaw logs local-console");
  kv("Stop", "silicaclaw stop");
}

function listeningProcessOnPort(port) {
  try {
    const pidRes = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pid = String(pidRes.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (!pid) return null;

    const cmdRes = spawnSync("ps", ["-p", pid, "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const command = String(cmdRes.stdout || "").trim() || "unknown";
    return { pid, command };
  } catch {
    return null;
  }
}

function printStopSummary() {
  const localListener = listeningProcessOnPort(4310);
  const signalingListener = listeningProcessOnPort(4510);
  headline();
  console.log("");
  console.log(`${paint("Stopped", COLOR.bold)} background services`);
  if (!localListener) {
    kv("Console", paint("stopped", COLOR.green));
  } else {
    kv("Console", `${paint("still busy", COLOR.yellow)} (pid=${localListener.pid})`);
    kv("Inspect", "lsof -nP -iTCP:4310 -sTCP:LISTEN");
    kv("Stop pid", `kill ${localListener.pid}`);
  }
  if (!signalingListener) {
    kv("Relay port", paint("stopped", COLOR.green));
  } else {
    kv("Relay port", `${paint("still busy", COLOR.yellow)} (pid=${signalingListener.pid})`);
    kv("Inspect", "lsof -nP -iTCP:4510 -sTCP:LISTEN");
    kv("Stop pid", `kill ${signalingListener.pid}`);
  }
  console.log("");
  kv("Status", "silicaclaw status");
}

function tailFile(file, lines = 80) {
  if (!existsSync(file)) {
    headline();
    console.log("");
    console.log(`${paint("Log file not found", COLOR.bold, COLOR.yellow)}`);
    kv("Path", file);
    return;
  }
  headline();
  console.log("");
  section("Recent logs");
  kv("Path", file);
  console.log("");
  const text = String(readFileSync(file, "utf8"));
  const out = text.split(/\r?\n/).slice(-lines).join("\n");
  console.log(out);
}

async function stopAll() {
  const localPid = readPid(CONSOLE_PID_FILE);
  const sigPid = readPid(SIGNALING_PID_FILE);
  await stopPid(localPid, "local-console");
  await stopPid(sigPid, "signaling");
  removeFileIfExists(CONSOLE_PID_FILE);
  removeFileIfExists(SIGNALING_PID_FILE);
  writeState({
    ...(readState() || {}),
    updated_at: Date.now(),
  });
}

function startAll() {
  ensureStateDir();

  const mode = parseMode(parseFlag("mode", process.env.NETWORK_MODE || "global-preview"));
  const adapter = adapterForMode(mode);
  const signalingUrl = parseFlag("signaling-url", process.env.WEBRTC_SIGNALING_URL || "https://relay.silicaclaw.com");
  const room = parseFlag("room", process.env.WEBRTC_ROOM || "silicaclaw-global-preview");
  const shouldDisableSignaling = hasFlag("no-signaling");

  const currentLocalPid = readPid(CONSOLE_PID_FILE);
  const currentSigPid = readPid(SIGNALING_PID_FILE);
  let localPid = currentLocalPid;
  if (!isRunning(currentLocalPid)) {
    removeFileIfExists(CONSOLE_PID_FILE);
    const env = {
      NETWORK_ADAPTER: adapter,
      NETWORK_MODE: mode,
      WEBRTC_SIGNALING_URL: signalingUrl,
      WEBRTC_ROOM: room,
    };
    localPid = spawnBackground("npm", ["run", "local-console"], env, CONSOLE_LOG_FILE, CONSOLE_PID_FILE);
  }

  const { host, port } = parseUrlHostPort(signalingUrl);
  const shouldAutoStartSignaling =
    mode === "global-preview" &&
    !shouldDisableSignaling &&
    (host === "localhost" || host === "127.0.0.1");

  let signalingPid = currentSigPid;
  if (shouldAutoStartSignaling) {
    if (!isRunning(currentSigPid)) {
      removeFileIfExists(SIGNALING_PID_FILE);
      signalingPid = spawnBackground(
        "npm",
        ["run", "webrtc-signaling"],
        { PORT: String(port) },
        SIGNALING_LOG_FILE,
        SIGNALING_PID_FILE,
      );
    }
  }

  writeState({
    app_dir: APP_DIR,
    mode,
    adapter,
    signaling_url: signalingUrl,
    room,
    updated_at: Date.now(),
  });
  return { localPid, signalingPid: shouldAutoStartSignaling ? signalingPid : null };
}

async function main() {
  if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp();
    return;
  }
  if (cmd === "status") {
    if (hasFlag("json")) {
      showStatusJson();
    } else {
      showStatusHuman();
    }
    return;
  }
  if (cmd === "start") {
    startAll();
    const status = buildStatusPayload();
    printConnectionSummary(status, "Started");
    return;
  }
  if (cmd === "stop") {
    await stopAll();
    printStopSummary();
    return;
  }
  if (cmd === "restart") {
    await stopAll();
    startAll();
    const status = buildStatusPayload();
    printConnectionSummary(status, "Restarted");
    return;
  }
  if (cmd === "logs") {
    const target = String(argv[1] || "local-console");
    if (target === "signaling") {
      tailFile(SIGNALING_LOG_FILE);
      return;
    }
    tailFile(CONSOLE_LOG_FILE);
    return;
  }
  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  headline();
  console.log("");
  console.error(paint("Gateway command failed", COLOR.bold, COLOR.red));
  console.error(error?.message || String(error));
  process.exit(1);
});
