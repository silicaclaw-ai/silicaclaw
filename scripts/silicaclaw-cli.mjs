#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  orange: "\x1b[38;5;208m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
};

function useColor() {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function paint(text, ...styles) {
  if (!useColor() || styles.length === 0) return text;
  return `${styles.join("")}${text}${COLOR.reset}`;
}

function headline() {
  console.log(`${paint("SilicaClaw", COLOR.bold, COLOR.orange)} ${paint(readVersion(), COLOR.dim)}`);
  console.log(paint("Public identity and discovery for OpenClaw agents.", COLOR.dim));
}

function kv(label, value) {
  console.log(`${paint(label.padEnd(14), COLOR.dim)} ${value}`);
}

function section(title) {
  console.log(paint(title, COLOR.bold));
}

function run(cmd, args, extra = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: process.env,
    ...extra,
  });
  if (result.error) {
    headline();
    console.log("");
    console.error(`${paint("Command failed", COLOR.bold, COLOR.yellow)} ${cmd}`);
    console.error(result.error.message);
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

function preferredShellRcFile() {
  const shell = String(process.env.SHELL || "");
  if (shell.endsWith("/zsh")) return resolve(homedir(), ".zshrc");
  if (shell.endsWith("/bash")) return resolve(homedir(), ".bashrc");
  if (process.env.ZSH_VERSION) return resolve(homedir(), ".zshrc");
  return resolve(homedir(), ".bashrc");
}

function userShimDir() {
  return resolve(homedir(), ".silicaclaw", "bin");
}

function userShimPath() {
  return resolve(userShimDir(), "silicaclaw");
}

function userEnvFile() {
  return resolve(homedir(), ".silicaclaw", "env.sh");
}

function ensureLineInFile(filePath, block) {
  try {
    const current = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    if (current.includes(block.trim())) {
      return { changed: false, error: null };
    }
    const next = `${current.replace(/\s*$/, "")}\n\n${block}\n`;
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, next, "utf8");
    return { changed: true, error: null };
  } catch (error) {
    return { changed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function shellInitTargets() {
  const home = homedir();
  const shell = String(process.env.SHELL || "");
  const targets = [];
  const add = (filePath) => {
    if (!targets.includes(filePath)) {
      targets.push(filePath);
    }
  };

  if (shell.endsWith("/zsh") || process.env.ZSH_VERSION || existsSync(resolve(home, ".zshrc"))) {
    add(resolve(home, ".zshrc"));
  }

  // Bash login shells on macOS often read .bash_profile instead of .bashrc.
  if (
    shell.endsWith("/bash") ||
    process.env.BASH_VERSION ||
    existsSync(resolve(home, ".bashrc")) ||
    existsSync(resolve(home, ".bash_profile"))
  ) {
    add(resolve(home, ".bashrc"));
    add(resolve(home, ".bash_profile"));
  }

  if (targets.length === 0) {
    add(preferredShellRcFile());
  }
  return targets;
}

function installPersistentCommand() {
  const binDir = userShimDir();
  const shimPath = userShimPath();
  const envFile = userEnvFile();
  const envBlock = [
    "#!/usr/bin/env bash",
    'export PATH="$HOME/.silicaclaw/bin:$PATH"',
    "",
  ].join("\n");
  const rcBlock = [
    "# >>> silicaclaw >>>",
    '[ -f "$HOME/.silicaclaw/env.sh" ] && . "$HOME/.silicaclaw/env.sh"',
    "# <<< silicaclaw <<<",
  ].join("\n");

  mkdirSync(binDir, { recursive: true });
  writeFileSync(envFile, envBlock, { encoding: "utf8", mode: 0o755 });
  writeFileSync(
    shimPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'exec npx -y @silicaclaw/cli@beta "$@"',
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 }
  );
  const rcFiles = shellInitTargets();
  const updatedFiles = [];
  const failedFiles = [];
  for (const filePath of rcFiles) {
    const result = ensureLineInFile(filePath, rcBlock);
    if (result.changed) {
      updatedFiles.push(filePath);
    }
    if (result.error) {
      failedFiles.push({ filePath, error: result.error });
    }
  }

  headline();
  console.log("");
  console.log(`${paint("Installed", COLOR.bold)} persistent command`);
  kv("Command", "silicaclaw");
  kv("Shim", shimPath);
  kv("Env", envFile);
  kv("Shell init", rcFiles.join(", "));
  console.log("");
  kv("Activate", `source "${envFile}"`);
  if (updatedFiles.length === 0) {
    kv("Startup", "shell files already configured");
  }
  if (failedFiles.length > 0) {
    console.log("");
    console.log(paint("Shell files not updated automatically", COLOR.bold, COLOR.yellow));
    for (const item of failedFiles) {
      kv(item.filePath, item.error);
    }
    console.log("");
    kv("Manual line", '[ -f "$HOME/.silicaclaw/env.sh" ] && . "$HOME/.silicaclaw/env.sh"');
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
  headline();
  console.log("");
  console.log(paint("Update check", COLOR.bold));
  kv("Current", current);
  kv("Latest", latest || "-");
  kv("Beta", beta || "-");
  console.log("");

  const upToDate = Boolean(beta) && current === beta;
  if (upToDate) {
    console.log(`${paint("Ready", COLOR.bold)} you're already on the latest beta.`);
  } else {
    console.log(`${paint("Update available", COLOR.bold, COLOR.yellow)} install the latest beta and refresh your services.`);
  }
  console.log("");
  console.log(paint("Next commands", COLOR.bold));
  kv("Start", "silicaclaw start --mode=global-preview");
  kv("Status", "silicaclaw status");
  kv("Install", "npx -y @silicaclaw/cli@beta install");
  kv("One-shot", "npx -y @silicaclaw/cli@beta start --mode=global-preview");
  console.log("");

  const writableGlobal = canWriteGlobalPrefix();
  if (!npxRuntime && writableGlobal) {
    console.log(paint("Optional global install", COLOR.bold));
    kv("Install", "npm i -g @silicaclaw/cli@beta");
    kv("Verify", "silicaclaw version");
    console.log("");
  } else if (!npxRuntime) {
    console.log(paint("Global install skipped", COLOR.bold, COLOR.yellow));
    console.log("npm global directory is not writable on this machine.");
    console.log("");
  }
  if (npxRuntime) {
    console.log(paint("Detected npx runtime", COLOR.bold));
    console.log("Run `npx -y @silicaclaw/cli@beta install` once to make `silicaclaw` available in new shells.");
  }
}

function getGatewayStatus() {
  try {
    const result = runCapture("node", [resolve(ROOT_DIR, "scripts", "silicaclaw-gateway.mjs"), "status", "--json"], {
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
    kv("Synced", appDir);
  }

  const localRunning = Boolean(status?.local_console?.running);
  const signalingRunning = Boolean(status?.signaling?.running);
  if (!localRunning && !signalingRunning) {
    kv("Runtime", "gateway not running; no refresh needed");
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

  console.log("");
  console.log(paint("Refreshing background services", COLOR.bold));
  runInherit("node", args, { cwd: process.cwd() });
}

function tryGlobalUpgrade(beta) {
  const writableGlobal = canWriteGlobalPrefix();
  if (!writableGlobal) return false;
  kv("Upgrade", `installing @silicaclaw/cli@${beta} globally`);
  const result = runInherit("npm", ["i", "-g", `@silicaclaw/cli@${beta}`]);
  return (result.status ?? 1) === 0;
}

function update() {
  const current = readPackageVersion();
  try {
    const result = runCapture("npm", ["view", "@silicaclaw/cli", "dist-tags", "--json"]);
    if ((result.status ?? 1) !== 0) {
      headline();
      console.log("");
      console.error(paint("Update check failed", COLOR.bold, COLOR.yellow));
      if (result.stderr) console.error(result.stderr.trim());
      console.log("");
      kv("Try", "npm view @silicaclaw/cli dist-tags --json");
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
        kv("Update", `new beta detected (${beta}); npx will use it on the next run`);
      } else if (tryGlobalUpgrade(beta)) {
        kv("Upgrade", `global install updated to ${beta}`);
      } else {
        kv("Upgrade", "skipped global install");
      }
    }

    restartGatewayIfRunning();
    process.exit(0);
  } catch (error) {
    headline();
    console.log("");
    console.error(paint("Update check failed", COLOR.bold, COLOR.yellow));
    console.error(error.message);
    console.log("");
    kv("Try", "npm view @silicaclaw/cli dist-tags --json");
    process.exit(1);
  }
}

function help() {
  headline();
  console.log("");
  section("Core commands");
  kv("Install", "npx -y @silicaclaw/cli@beta install");
  kv("Start", "silicaclaw start --mode=global-preview");
  kv("Status", "silicaclaw status");
  kv("Stop", "silicaclaw stop");
  kv("Update", "silicaclaw update");
  console.log("");
  section("Setup and network");
  kv("Onboard", "silicaclaw onboard");
  kv("Connect", "silicaclaw connect");
  kv("Gateway", "silicaclaw gateway <start|stop|restart|status|logs>");
  kv("Signaling", "silicaclaw signaling");
  console.log("");
  section("Local apps");
  kv("Console", "silicaclaw local-console");
  kv("Explorer", "silicaclaw explorer");
  kv("Doctor", "silicaclaw doctor");
  kv("Version", "silicaclaw version");
  kv("Help", "silicaclaw help");
}

const cmd = String(process.argv[2] || "help").trim().toLowerCase();

switch (cmd) {
  case "onboard":
    headline();
    console.log("");
    section("Opening onboarding");
    kv("Mode", "interactive setup");
    kv("Focus", "install command, profile, internet relay");
    console.log("");
    run("bash", [resolve(ROOT_DIR, "scripts", "quickstart.sh")]);
    break;
  case "connect":
    headline();
    console.log("");
    section("Opening connect wizard");
    kv("Mode", "global-preview first");
    kv("Relay", "https://relay.silicaclaw.com");
    console.log("");
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
  case "install":
    installPersistentCommand();
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
    headline();
    console.log("");
    section("Running health checks");
    console.log("");
    run("npm", ["run", "health"]);
    break;
  case "version":
  case "-v":
  case "--version":
    headline();
    break;
  case "help":
  case "-h":
  case "--help":
  default:
    help();
    break;
}
