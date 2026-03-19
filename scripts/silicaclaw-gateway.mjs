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

function displayVersion(raw) {
  const text = String(raw || "unknown").trim() || "unknown";
  return text.startsWith("v") ? text : `v${text}`;
}

function headline() {
  const pkgPath = join(ROOT_DIR, "package.json");
  let version = "unknown";
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(String(readFileSync(pkgPath, "utf8")));
      version = String(pkg.version || "unknown");
    } catch {
      version = "unknown";
    }
  }
  console.log(`${paint("SilicaClaw", COLOR.bold, COLOR.orange)} ${paint(displayVersion(version), COLOR.dim)}`);
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

  if (isSilicaClawDir(ROOT_DIR)) {
    return resolve(ROOT_DIR);
  }

  const homeCandidate = join(homedir(), "silicaclaw");
  if (isSilicaClawDir(homeCandidate)) {
    return resolve(homeCandidate);
  }

  return ROOT_DIR;
}

function detectWorkspaceDir() {
  const envDir = process.env.SILICACLAW_WORKSPACE_DIR;
  if (envDir) return resolve(envDir);
  return resolve(process.cwd());
}

const APP_DIR = detectAppDir();
const WORKSPACE_DIR = detectWorkspaceDir();
const LOCAL_CONSOLE_DIR = join(APP_DIR, "apps", "local-console");
const STATE_DIR = join(homedir(), ".silicaclaw", "gateway");
const CONSOLE_PID_FILE = join(STATE_DIR, "local-console.pid");
const CONSOLE_LOG_FILE = join(STATE_DIR, "local-console.log");
const SIGNALING_PID_FILE = join(STATE_DIR, "signaling.pid");
const SIGNALING_LOG_FILE = join(STATE_DIR, "signaling.log");
const STATE_FILE = join(STATE_DIR, "state.json");
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const LOCAL_CONSOLE_LABEL = "ai.silicaclaw.local-console";
const SIGNALING_LABEL = "ai.silicaclaw.signaling";

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true });
}

function ensureLaunchAgentsDir() {
  mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
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

function isLaunchdPlatform() {
  return process.platform === "darwin" && !hasFlag("no-launchd");
}

function launchdDomain() {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return `gui/${uid}`;
}

function launchAgentPlistPath(label) {
  return join(LAUNCH_AGENTS_DIR, `${label}.plist`);
}

function plistEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildLaunchAgentPlist({ label, programArguments, workingDirectory, stdoutPath, stderrPath, environment }) {
  const argsXml = programArguments.map((arg) => `\n      <string>${plistEscape(arg)}</string>`).join("");
  const envEntries = Object.entries(environment || {}).filter(([, value]) => String(value || "").trim());
  const envXml = envEntries.length
    ? `\n    <key>EnvironmentVariables</key>\n    <dict>${envEntries
        .map(([key, value]) => `\n      <key>${plistEscape(key)}</key>\n      <string>${plistEscape(value)}</string>`)
        .join("")}\n    </dict>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n  <dict>\n    <key>Label</key>\n    <string>${plistEscape(label)}</string>\n    <key>RunAtLoad</key>\n    <true/>\n    <key>KeepAlive</key>\n    <true/>\n    <key>ThrottleInterval</key>\n    <integer>1</integer>\n    <key>ProgramArguments</key>\n    <array>${argsXml}\n    </array>\n    <key>WorkingDirectory</key>\n    <string>${plistEscape(workingDirectory)}</string>\n    <key>StandardOutPath</key>\n    <string>${plistEscape(stdoutPath)}</string>\n    <key>StandardErrorPath</key>\n    <string>${plistEscape(stderrPath)}</string>${envXml}\n  </dict>\n</plist>\n`;
}

function runLaunchctl(args) {
  return spawnSync("launchctl", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveCommandPath(command) {
  const result = spawnSync("which", [command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if ((result.status ?? 1) === 0) {
    const value = String(result.stdout || "").trim();
    if (value) return value;
  }
  return command;
}

function isLaunchAgentLoaded(label) {
  const result = runLaunchctl(["print", `${launchdDomain()}/${label}`]);
  return (result.status ?? 1) === 0;
}

function readLaunchAgentRuntime(label) {
  const result = runLaunchctl(["print", `${launchdDomain()}/${label}`]);
  if ((result.status ?? 1) !== 0) return { loaded: false, pid: null };
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  const pidMatch = text.match(/pid = (\d+)/);
  return {
    loaded: true,
    pid: pidMatch ? Number(pidMatch[1]) : null,
  };
}

function installLaunchAgent({ label, programArguments, workingDirectory, logFile, environment }) {
  ensureLaunchAgentsDir();
  ensureStateDir();
  const plistPath = launchAgentPlistPath(label);
  const plist = buildLaunchAgentPlist({
    label,
    programArguments,
    workingDirectory,
    stdoutPath: logFile,
    stderrPath: logFile,
    environment,
  });
  writeFileSync(plistPath, plist, "utf8");

  if (isLaunchAgentLoaded(label)) {
    runLaunchctl(["bootout", launchdDomain(), plistPath]);
  }

  const result = runLaunchctl(["bootstrap", launchdDomain(), plistPath]);
  if ((result.status ?? 1) !== 0) {
    const detail = String(result.stderr || result.stdout || "launchctl bootstrap failed").trim();
    throw new Error(detail);
  }
}

function stopLaunchAgent(label) {
  const plistPath = launchAgentPlistPath(label);
  if (!existsSync(plistPath) && !isLaunchAgentLoaded(label)) return;
  const result = runLaunchctl(["bootout", launchdDomain(), plistPath]);
  if ((result.status ?? 1) !== 0 && isLaunchAgentLoaded(label)) {
    const detail = String(result.stderr || result.stdout || "launchctl bootout failed").trim();
    throw new Error(detail);
  }
}

function uninstallLaunchAgent(label) {
  try {
    stopLaunchAgent(label);
  } catch {
    // ignore best-effort cleanup
  }
  removeFileIfExists(launchAgentPlistPath(label));
}

function spawnBackground(command, args, env, logFile, pidFile, cwd = APP_DIR) {
  const outFd = openSync(logFile, "a");
  const child = spawn(command, args, {
    cwd,
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
  section("Gateway");
  kv("Start", "silicaclaw gateway start");
  kv("Stop", "silicaclaw gateway stop");
  kv("Restart", "silicaclaw gateway restart");
  kv("Status", "silicaclaw gateway status");
  kv("Logs", "silicaclaw gateway logs local-console");
}

function launchdStatusPayload() {
  const state = readState();
  const localRuntime = readLaunchAgentRuntime(LOCAL_CONSOLE_LABEL);
  const signalingRuntime = readLaunchAgentRuntime(SIGNALING_LABEL);
  const localListener = listeningProcessOnPort(4310);
  const signalingListener = listeningProcessOnPort(4510);
  return {
    app_dir: APP_DIR,
    workspace_dir: WORKSPACE_DIR,
    mode: state?.mode || "unknown",
    adapter: state?.adapter || "unknown",
    service_manager: "launchd",
    local_console: {
      pid: Number(localListener?.pid || localRuntime.pid || 0) || null,
      running: Boolean(localListener) || Boolean(localRuntime.loaded && localRuntime.pid),
      loaded: localRuntime.loaded,
      label: LOCAL_CONSOLE_LABEL,
      log_file: CONSOLE_LOG_FILE,
    },
    signaling: {
      pid: Number(signalingListener?.pid || signalingRuntime.pid || 0) || null,
      running: Boolean(signalingListener) || Boolean(signalingRuntime.loaded && signalingRuntime.pid),
      loaded: signalingRuntime.loaded,
      label: SIGNALING_LABEL,
      log_file: SIGNALING_LOG_FILE,
      url: state?.signaling_url || null,
      room: state?.room || null,
    },
    updated_at: state?.updated_at || null,
  };
}

function buildStatusPayload() {
  if (isLaunchdPlatform()) {
    return launchdStatusPayload();
  }
  const localPid = readPid(CONSOLE_PID_FILE);
  const sigPid = readPid(SIGNALING_PID_FILE);
  const state = readState();
  const localListener = listeningProcessOnPort(4310);
  const signalingListener = listeningProcessOnPort(4510);
  return {
    app_dir: APP_DIR,
    workspace_dir: state?.workspace_dir || WORKSPACE_DIR,
    mode: state?.mode || "unknown",
    adapter: state?.adapter || "unknown",
    local_console: {
      pid: Number(localListener?.pid || localPid || 0) || null,
      running: Boolean(localListener),
      log_file: CONSOLE_LOG_FILE,
    },
    signaling: {
      pid: sigPid,
      running: Boolean(signalingListener),
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
  kv(
    "Status",
    payload.local_console.running
      ? `${paint("running", COLOR.green)} · ${payload.mode}`
      : `${paint("stopped", COLOR.dim)} · ${payload.mode}`
  );
  if (payload.mode === "global-preview") {
    kv("Relay", payload.signaling.url || "https://relay.silicaclaw.com");
    kv("Room", payload.signaling.room || "silicaclaw-global-preview");
  }
  if (payload.local_console.running) kv("Open", "http://localhost:4310");
  return payload;
}

function printConnectionSummary(status, verb = "Started") {
  if (!status?.local_console?.running) return;
  headline();
  console.log("");
  kv("Status", `${verb.toLowerCase()} · ${status.mode}`);
  kv("Console", `http://localhost:4310`);
  if (status.mode === "global-preview") {
    const signalingUrl = status?.signaling?.url || "https://relay.silicaclaw.com";
    const room = status?.signaling?.room || "silicaclaw-global-preview";
    kv("Relay", signalingUrl);
    kv("Room", room);
  }
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

function normalizePathForMatch(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isLocalConsoleCommand(command) {
  const text = normalizePathForMatch(command).toLowerCase();
  return (
    text.includes("@silicaclaw/local-console") ||
    text.includes("npm run --workspace @silicaclaw/local-console start") ||
    text.includes("/apps/local-console/") ||
    text.includes("dist/apps/local-console/src/server.js") ||
    text.includes("src/server.ts")
  );
}

function isSignalingCommand(command) {
  const text = normalizePathForMatch(command).toLowerCase();
  return text.includes("webrtc-signaling-server.mjs") || text.includes("npm run webrtc-signaling");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(port, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const listener = listeningProcessOnPort(port);
    if (listener) return listener;
    await sleep(200);
  }
  return null;
}

async function waitForCurrentAppListener(port, kind, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastListener = null;
  while (Date.now() - startedAt < timeoutMs) {
    const listener = listeningProcessOnPort(port);
    lastListener = listener;
    if (listener && isCurrentAppListener(listener, kind)) return listener;
    await sleep(200);
  }
  return lastListener;
}

async function waitForPortToClear(port, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const listener = listeningProcessOnPort(port);
    if (!listener) return true;
    await sleep(200);
  }
  return false;
}

function tailText(file, lines = 20) {
  if (!existsSync(file)) return "";
  const text = String(readFileSync(file, "utf8"));
  return text.split(/\r?\n/).slice(-lines).join("\n").trim();
}

function isOwnedListener(listener, kind) {
  if (!listener?.command) return false;
  const command = listener.command;
  if (kind === "local-console") {
    return isLocalConsoleCommand(command);
  }
  if (kind === "signaling") {
    return isSignalingCommand(command);
  }
  return false;
}

function isCurrentAppListener(listener, kind) {
  if (!listener?.command) return false;
  const command = listener.command;
  if (kind === "local-console") {
    return isLocalConsoleCommand(command);
  }
  if (kind === "signaling") {
    return isSignalingCommand(command);
  }
  return false;
}

async function stopOwnedListener(port, kind) {
  const listener = listeningProcessOnPort(port);
  if (!listener || !isOwnedListener(listener, kind)) return false;
  await stopPid(Number(listener.pid), kind);
  const remaining = listeningProcessOnPort(port);
  if (remaining && Number(remaining.pid) === Number(listener.pid) && isOwnedListener(remaining, kind)) {
    try {
      spawnSync("kill", ["-9", String(remaining.pid)], { stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      // ignore hard-kill fallback failures
    }
  }
  return true;
}

async function drainOwnedListener(port, kind, timeoutMs = 5000) {
  const startedAt = Date.now();
  let attempted = false;
  while (Date.now() - startedAt < timeoutMs) {
    const listener = listeningProcessOnPort(port);
    if (!listener) return { cleared: true, attempted };
    if (!isOwnedListener(listener, kind)) {
      return { cleared: false, attempted };
    }
    attempted = true;
    await stopOwnedListener(port, kind);
    const cleared = await waitForPortToClear(port, 1200);
    if (cleared) return { cleared: true, attempted };
  }
  const finalListener = listeningProcessOnPort(port);
  return { cleared: !finalListener, attempted };
}

function printStopSummary() {
  const localListener = listeningProcessOnPort(4310);
  const signalingListener = listeningProcessOnPort(4510);
  headline();
  console.log("");
  kv("Status", "stopped");
  if (!localListener) {
    kv("Console", paint("stopped", COLOR.green));
  } else {
    kv("Console", `${paint("still busy", COLOR.yellow)} (pid=${localListener.pid})`);
    if (isOwnedListener(localListener, "local-console")) {
      kv("Hint", "an older SilicaClaw local-console process is still holding port 4310");
    }
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
}

function tailFile(file, lines = 80) {
  if (!existsSync(file)) {
    headline();
    console.log("");
    kv("Logs", "not found");
    return;
  }
  headline();
  console.log("");
  kv("Logs", file);
  console.log("");
  const text = String(readFileSync(file, "utf8"));
  const out = text.split(/\r?\n/).slice(-lines).join("\n");
  console.log(out);
}

async function stopAll() {
  if (isLaunchdPlatform()) {
    stopLaunchAgent(LOCAL_CONSOLE_LABEL);
    stopLaunchAgent(SIGNALING_LABEL);
    await drainOwnedListener(4310, "local-console", 8000);
    await drainOwnedListener(4510, "signaling", 5000);
    removeFileIfExists(CONSOLE_PID_FILE);
    removeFileIfExists(SIGNALING_PID_FILE);
    writeState({
      ...(readState() || {}),
      updated_at: Date.now(),
    });
    return;
  }
  const localPid = readPid(CONSOLE_PID_FILE);
  const sigPid = readPid(SIGNALING_PID_FILE);
  await stopPid(localPid, "local-console");
  await stopPid(sigPid, "signaling");
  await drainOwnedListener(4310, "local-console", 5000);
  await drainOwnedListener(4510, "signaling", 5000);
  removeFileIfExists(CONSOLE_PID_FILE);
  removeFileIfExists(SIGNALING_PID_FILE);
  writeState({
    ...(readState() || {}),
    updated_at: Date.now(),
  });
}

async function startAll() {
  ensureStateDir();

  const mode = parseMode(parseFlag("mode", process.env.NETWORK_MODE || "global-preview"));
  const adapter = adapterForMode(mode);
  const signalingUrl = parseFlag("signaling-url", process.env.WEBRTC_SIGNALING_URL || "https://relay.silicaclaw.com");
  const room = parseFlag("room", process.env.WEBRTC_ROOM || "silicaclaw-global-preview");
  const shouldDisableSignaling = hasFlag("no-signaling");

  const { host, port } = parseUrlHostPort(signalingUrl);
  const shouldAutoStartSignaling =
    mode === "global-preview" &&
    !shouldDisableSignaling &&
    (host === "localhost" || host === "127.0.0.1");

  if (isLaunchdPlatform()) {
    const npmPath = resolveCommandPath("npm");
    const signalingEntry = resolve(APP_DIR, "scripts", "webrtc-signaling-server.mjs");
    await drainOwnedListener(4310, "local-console", 8000);
    await drainOwnedListener(4510, "signaling", 5000);
    const baseEnv = {
      NETWORK_ADAPTER: adapter,
      NETWORK_MODE: mode,
      WEBRTC_SIGNALING_URL: signalingUrl,
      WEBRTC_ROOM: room,
      SILICACLAW_WORKSPACE_DIR: WORKSPACE_DIR,
      PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: process.env.HOME || homedir(),
    };

    installLaunchAgent({
      label: LOCAL_CONSOLE_LABEL,
      programArguments: [npmPath, "run", "--workspace", "@silicaclaw/local-console", "start"],
      workingDirectory: APP_DIR,
      logFile: CONSOLE_LOG_FILE,
      environment: baseEnv,
    });

    if (shouldAutoStartSignaling) {
      installLaunchAgent({
        label: SIGNALING_LABEL,
        programArguments: [process.execPath, signalingEntry],
        workingDirectory: APP_DIR,
        logFile: SIGNALING_LOG_FILE,
        environment: {
          PATH: baseEnv.PATH,
          HOME: baseEnv.HOME,
          PORT: String(port),
        },
      });
    } else {
      uninstallLaunchAgent(SIGNALING_LABEL);
    }

    writeState({
      app_dir: APP_DIR,
      workspace_dir: WORKSPACE_DIR,
      mode,
      adapter,
      signaling_url: signalingUrl,
      room,
      updated_at: Date.now(),
    });
    return { localPid: null, signalingPid: null };
  }

  const currentLocalPid = readPid(CONSOLE_PID_FILE);
  const currentSigPid = readPid(SIGNALING_PID_FILE);
  const currentListener = listeningProcessOnPort(4310);
  if (currentListener && isOwnedListener(currentListener, "local-console") && !isRunning(currentLocalPid)) {
    writeFileSync(CONSOLE_PID_FILE, String(currentListener.pid));
  }

  let localPid = readPid(CONSOLE_PID_FILE);
  if (!isRunning(localPid)) {
    removeFileIfExists(CONSOLE_PID_FILE);
    await drainOwnedListener(4310, "local-console", 8000);
    const remainingLocalListener = listeningProcessOnPort(4310);
    if (remainingLocalListener) {
      throw new Error(`port 4310 is occupied by pid=${remainingLocalListener.pid}`);
    }
    const env = {
      NETWORK_ADAPTER: adapter,
      NETWORK_MODE: mode,
      WEBRTC_SIGNALING_URL: signalingUrl,
      WEBRTC_ROOM: room,
      SILICACLAW_WORKSPACE_DIR: WORKSPACE_DIR,
    };
    localPid = spawnBackground(
      process.execPath,
      ["dist/apps/local-console/src/server.js"],
      env,
      CONSOLE_LOG_FILE,
      CONSOLE_PID_FILE,
      LOCAL_CONSOLE_DIR,
    );
  }

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
    workspace_dir: WORKSPACE_DIR,
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
    await startAll();
    const listener = await waitForCurrentAppListener(4310, "local-console", 15000);
    if (!listener || !isCurrentAppListener(listener, "local-console")) {
      headline();
      console.log("");
      kv("Status", paint("failed to start", COLOR.red));
      if (listener) {
        kv("Conflict", `port 4310 is occupied by pid=${listener.pid}`);
        kv("Inspect", "lsof -nP -iTCP:4310 -sTCP:LISTEN");
      }
      const recent = tailText(CONSOLE_LOG_FILE, 18);
      if (recent) {
        console.log("");
        console.log(recent);
      }
      process.exitCode = 1;
      return;
    }
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
    await startAll();
    const listener = await waitForCurrentAppListener(4310, "local-console", 15000);
    if (!listener || !isCurrentAppListener(listener, "local-console")) {
      headline();
      console.log("");
      kv("Status", paint("failed to restart", COLOR.red));
      if (listener) {
        kv("Conflict", `port 4310 is occupied by pid=${listener.pid}`);
        kv("Inspect", "lsof -nP -iTCP:4310 -sTCP:LISTEN");
      }
      const recent = tailText(CONSOLE_LOG_FILE, 18);
      if (recent) {
        console.log("");
        console.log(recent);
      }
      process.exitCode = 1;
      return;
    }
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
