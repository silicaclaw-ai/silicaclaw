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
    console.error(`failed to stop ${name} (pid=${pid})`);
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
  console.log(`
SilicaClaw Gateway

Usage:
  silicaclaw gateway start [--mode=local|lan|global-preview] [--signaling-url=https://relay.silicaclaw.com] [--room=silicaclaw-global-preview]
  silicaclaw gateway stop
  silicaclaw gateway restart [--mode=...]
  silicaclaw gateway status
  silicaclaw gateway logs [local-console|signaling]

Notes:
  - Default app dir: current directory; fallback: ~/silicaclaw
  - State dir: .silicaclaw/gateway
  - global-preview is internet-first and expects a publicly reachable relay/signaling URL
  - global-preview + localhost signaling URL will auto-start signaling server for single-machine testing
`.trim());
}

function showStatus() {
  const localPid = readPid(CONSOLE_PID_FILE);
  const sigPid = readPid(SIGNALING_PID_FILE);
  const state = readState();
  const payload = {
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
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

function printConnectionSummary(status) {
  if (!status?.local_console?.running) return;
  console.log("");
  console.log("Gateway connection summary:");
  console.log(`- local-console: http://localhost:4310`);
  console.log(`- mode: ${status.mode}`);
  console.log(`- adapter: ${status.adapter}`);
  if (status.mode === "global-preview") {
    const signalingUrl = status?.signaling?.url || "https://relay.silicaclaw.com";
    const room = status?.signaling?.room || "silicaclaw-global-preview";
    console.log(`- signaling: ${signalingUrl} (room=${room})`);
  }
  console.log(`- local-console log: ${status?.local_console?.log_file || CONSOLE_LOG_FILE}`);
  console.log(`- status: silicaclaw gateway status`);
  console.log(`- logs:   silicaclaw gateway logs local-console`);
  console.log(`- stop:   silicaclaw gateway stop`);
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
  console.log("");
  console.log("Gateway stop summary:");
  if (!localListener) {
    console.log("- local-console port 4310: stopped");
  } else {
    console.log(`- local-console port 4310: still in use by pid=${localListener.pid}`);
    console.log(`  command: ${localListener.command}`);
    console.log("  this is likely another process not started by gateway");
    console.log(`  inspect: lsof -nP -iTCP:4310 -sTCP:LISTEN`);
    console.log(`  stop it: kill ${localListener.pid}`);
  }
  if (!signalingListener) {
    console.log("- signaling port 4510: stopped");
  } else {
    console.log(`- signaling port 4510: still in use by pid=${signalingListener.pid}`);
    console.log(`  command: ${signalingListener.command}`);
    console.log("  this is likely another process not started by gateway");
    console.log(`  inspect: lsof -nP -iTCP:4510 -sTCP:LISTEN`);
    console.log(`  stop it: kill ${signalingListener.pid}`);
  }
  console.log(`- check status: silicaclaw gateway status`);
}

function tailFile(file, lines = 80) {
  if (!existsSync(file)) {
    console.log(`log file not found: ${file}`);
    return;
  }
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
  console.log("gateway stopped");
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
  if (isRunning(currentLocalPid)) {
    console.log(`local-console already running (pid=${currentLocalPid})`);
  } else {
    removeFileIfExists(CONSOLE_PID_FILE);
    const env = {
      NETWORK_ADAPTER: adapter,
      NETWORK_MODE: mode,
      WEBRTC_SIGNALING_URL: signalingUrl,
      WEBRTC_ROOM: room,
    };
    const pid = spawnBackground("npm", ["run", "local-console"], env, CONSOLE_LOG_FILE, CONSOLE_PID_FILE);
    console.log(`local-console started (pid=${pid})`);
  }

  const { host, port } = parseUrlHostPort(signalingUrl);
  const shouldAutoStartSignaling =
    mode === "global-preview" &&
    !shouldDisableSignaling &&
    (host === "localhost" || host === "127.0.0.1");

  if (shouldAutoStartSignaling) {
    if (isRunning(currentSigPid)) {
      console.log(`signaling already running (pid=${currentSigPid})`);
    } else {
      removeFileIfExists(SIGNALING_PID_FILE);
      const pid = spawnBackground(
        "npm",
        ["run", "webrtc-signaling"],
        { PORT: String(port) },
        SIGNALING_LOG_FILE,
        SIGNALING_PID_FILE,
      );
      console.log(`signaling started (pid=${pid}, port=${port})`);
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
}

async function main() {
  if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp();
    return;
  }
  if (cmd === "status") {
    showStatus();
    return;
  }
  if (cmd === "start") {
    startAll();
    const status = showStatus();
    printConnectionSummary(status);
    return;
  }
  if (cmd === "stop") {
    await stopAll();
    showStatus();
    printStopSummary();
    return;
  }
  if (cmd === "restart") {
    await stopAll();
    startAll();
    const status = showStatus();
    printConnectionSummary(status);
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
  console.error(error?.message || String(error));
  process.exit(1);
});
