#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { accessSync, constants, cpSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");

function run(cmd, args, extra = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: process.env,
    ...extra,
  });
  if (result.error) {
    console.error(`[silicaclaw] failed to run ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

function runCapture(cmd, args, extra = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: process.env,
    ...extra,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function runInherit(cmd, args, extra = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: process.env,
    ...extra,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function readVersion() {
  const versionFile = resolve(ROOT_DIR, "VERSION");
  if (!existsSync(versionFile)) return "unknown";
  return readFileSync(versionFile, "utf8").trim() || "unknown";
}

function readPackageVersion() {
  const pkgFile = resolve(ROOT_DIR, "package.json");
  if (!existsSync(pkgFile)) return "unknown";
  try {
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    return String(pkg.version || "unknown");
  } catch {
    return "unknown";
  }
}

function isNpxRun() {
  return ROOT_DIR.includes("/.npm/_npx/");
}

function canWriteGlobalPrefix() {
  try {
    const prefixResult = runCapture("npm", ["prefix", "-g"]);
    if ((prefixResult.status ?? 1) !== 0) return false;
    const prefix = String(prefixResult.stdout || "").trim();
    if (!prefix) return false;
    const targetDir = resolve(prefix, "lib", "node_modules");
    accessSync(targetDir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function showUpdateGuide(current, latest, beta) {
  const npxRuntime = isNpxRun();
  console.log("SilicaClaw update check");
  console.log(`current: ${current}`);
  console.log(`latest : ${latest || "-"}`);
  console.log(`beta   : ${beta || "-"}`);
  console.log("");

  const upToDate = Boolean(beta) && current === beta;
  if (upToDate) {
    console.log("You are already on the latest beta.");
  } else {
    console.log("Update available.");
  }
  console.log("");
  console.log("Quick next commands:");
  console.log("1) Start internet gateway");
  console.log("   silicaclaw start --mode=global-preview");
  console.log("2) Check gateway status");
  console.log("   silicaclaw status");
  console.log("3) npx one-shot (no alias/global install)");
  console.log("   npx -y @silicaclaw/cli@beta start --mode=global-preview");
  console.log("");

  const writableGlobal = canWriteGlobalPrefix();
  if (!npxRuntime && writableGlobal) {
    console.log("Optional global install:");
    console.log("   npm i -g @silicaclaw/cli@beta");
    console.log("   silicaclaw version");
    console.log("");
  } else if (!npxRuntime) {
    console.log("Global install skipped: npm global directory is not writable (likely EACCES).");
    console.log("");
  }
  if (npxRuntime) {
    console.log("Detected npx runtime.");
    console.log("If `silicaclaw` is unavailable in this shell, use the npx one-shot command above.");
  }
}

function getGatewayStatus() {
  try {
    const result = runCapture("node", [resolve(ROOT_DIR, "scripts", "silicaclaw-gateway.mjs"), "status"], {
      cwd: process.cwd(),
    });
    if ((result.status ?? 1) !== 0) return null;
    const text = String(result.stdout || "").trim();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function isManagedAppDir(appDir) {
  if (!appDir || !existsSync(resolve(appDir, "package.json"))) return false;
  try {
    const pkg = JSON.parse(readFileSync(resolve(appDir, "package.json"), "utf8"));
    const name = String(pkg?.name || "");
    return name === "@silicaclaw/cli" || name === "silicaclaw";
  } catch {
    return false;
  }
}

function syncCurrentPackageToAppDir(appDir) {
  if (!appDir || resolve(appDir) === ROOT_DIR) return false;
  if (!isManagedAppDir(appDir)) return false;

  const entries = [
    "apps/local-console",
    "apps/public-explorer",
    "packages/core",
    "packages/network",
    "packages/storage",
    "scripts",
    "README.md",
    "INSTALL.md",
    "CHANGELOG.md",
    "ARCHITECTURE.md",
    "ROADMAP.md",
    "SOCIAL_MD_SPEC.md",
    "DEMO_GUIDE.md",
    "RELEASE_NOTES_v1.0.md",
    "social.md.example",
    "openclaw.social.md.example",
    "VERSION",
    "package.json",
    "package-lock.json",
  ];

  for (const rel of entries) {
    const src = resolve(ROOT_DIR, rel);
    if (!existsSync(src)) continue;
    const dst = resolve(appDir, rel);
    cpSync(src, dst, { recursive: true, force: true });
  }
  return true;
}

function restartGatewayIfRunning() {
  const status = getGatewayStatus();
  const appDir = status?.app_dir ? String(status.app_dir) : "";
  const synced = syncCurrentPackageToAppDir(appDir);
  if (synced) {
    console.log(`Synced runtime files to app_dir: ${appDir}`);
  }

  const localRunning = Boolean(status?.local_console?.running);
  const signalingRunning = Boolean(status?.signaling?.running);
  if (!localRunning && !signalingRunning) {
    console.log("Gateway not running: no restart needed.");
    return;
  }

  const mode = String(status?.mode || "local");
  const args = [resolve(ROOT_DIR, "scripts", "silicaclaw-gateway.mjs"), "restart", `--mode=${mode}`];
  if (mode === "global-preview" && status?.signaling?.url) {
    args.push(`--signaling-url=${status.signaling.url}`);
  }
  if (mode === "global-preview" && status?.signaling?.room) {
    args.push(`--room=${status.signaling.room}`);
  }

  console.log("Refreshing gateway services...");
  runInherit("node", args, { cwd: process.cwd() });
}

function tryGlobalUpgrade(beta) {
  const writableGlobal = canWriteGlobalPrefix();
  if (!writableGlobal) return false;
  console.log(`Installing @silicaclaw/cli@${beta} globally...`);
  const result = runInherit("npm", ["i", "-g", `@silicaclaw/cli@${beta}`]);
  return (result.status ?? 1) === 0;
}

function update() {
  const current = readPackageVersion();
  try {
    const result = runCapture("npm", ["view", "@silicaclaw/cli", "dist-tags", "--json"]);
    if ((result.status ?? 1) !== 0) {
      console.error("Failed to query npm dist-tags.");
      if (result.stderr) console.error(result.stderr.trim());
      process.exit(result.status ?? 1);
    }
    const text = String(result.stdout || "").trim();
    const tags = text ? JSON.parse(text) : {};
    const latest = tags.latest ? String(tags.latest) : "";
    const beta = tags.beta ? String(tags.beta) : "";
    showUpdateGuide(current, latest, beta);
    const hasNewBeta = Boolean(beta) && beta !== current;
    const npxRuntime = isNpxRun();

    if (hasNewBeta) {
      if (npxRuntime) {
        console.log(`New beta detected (${beta}). npx will use latest on next run.`);
      } else if (tryGlobalUpgrade(beta)) {
        console.log(`Global upgrade completed: ${beta}`);
      } else {
        console.log("Skipped global upgrade (no write permission or upgrade failed).");
      }
    }

    restartGatewayIfRunning();
    process.exit(0);
  } catch (error) {
    console.error(`Update check failed: ${error.message}`);
    console.log("Try manually:");
    console.log("npm view @silicaclaw/cli dist-tags --json");
    process.exit(1);
  }
}

function help() {
  console.log(`
SilicaClaw CLI

Usage:
  silicaclaw onboard
  silicaclaw connect
  silicaclaw update
  silicaclaw start [--mode=local|lan|global-preview]
  silicaclaw stop
  silicaclaw restart [--mode=local|lan|global-preview]
  silicaclaw status
  silicaclaw logs [local-console|signaling]
  silicaclaw gateway <start|stop|restart|status|logs>
  silicaclaw local-console
  silicaclaw explorer
  silicaclaw signaling
  silicaclaw doctor
  silicaclaw version
  silicaclaw help

Commands:
  onboard        Interactive step-by-step onboarding (recommended)
  connect        Cross-network connect wizard (global-preview first)
  update         Check latest npm version and show upgrade commands
  start          Start gateway-managed background services
  stop           Stop gateway-managed background services
  restart        Restart gateway-managed background services
  status         Show gateway-managed service status
  logs           Show gateway-managed service logs
  gateway        Manage background services (start/stop/restart/status/logs)
  local-console  Start local console (http://localhost:4310)
  explorer       Start public explorer (http://localhost:4311)
  signaling      Start WebRTC signaling preview server
  doctor         Run project checks (npm run health)
  version        Print SilicaClaw version
  help           Show this help
`.trim());
}

const cmd = String(process.argv[2] || "help").trim().toLowerCase();

switch (cmd) {
  case "onboard":
    run("bash", [resolve(ROOT_DIR, "scripts", "quickstart.sh")]);
    break;
  case "connect":
    run("bash", [resolve(ROOT_DIR, "scripts", "quickstart.sh")], {
      env: {
        ...process.env,
        QUICKSTART_DEFAULT_MODE: "3",
        QUICKSTART_CONNECT_MODE: "1",
      },
    });
    break;
  case "update":
    update();
    break;
  case "gateway":
    run("node", [resolve(ROOT_DIR, "scripts", "silicaclaw-gateway.mjs"), ...process.argv.slice(3)], {
      cwd: process.cwd(),
    });
    break;
  case "start":
  case "stop":
  case "restart":
  case "status":
  case "logs":
    run("node", [resolve(ROOT_DIR, "scripts", "silicaclaw-gateway.mjs"), cmd, ...process.argv.slice(3)], {
      cwd: process.cwd(),
    });
    break;
  case "local-console":
  case "console":
    run("npm", ["run", "local-console"]);
    break;
  case "explorer":
  case "public-explorer":
    run("npm", ["run", "public-explorer"]);
    break;
  case "signaling":
  case "webrtc-signaling":
    run("npm", ["run", "webrtc-signaling"]);
    break;
  case "doctor":
    run("npm", ["run", "health"]);
    break;
  case "version":
  case "-v":
  case "--version":
    console.log(readVersion());
    break;
  case "help":
  case "-h":
  case "--help":
  default:
    help();
    break;
}
