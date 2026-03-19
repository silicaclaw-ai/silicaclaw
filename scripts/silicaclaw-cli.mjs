#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const INVOCATION_CWD = process.cwd();

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

function displayVersion(raw) {
  const text = String(raw || "unknown").trim() || "unknown";
  return text.startsWith("v") ? text : `v${text}`;
}

function headline() {
  console.log(`${paint("SilicaClaw", COLOR.bold, COLOR.orange)} ${paint(displayVersion(readVersion()), COLOR.dim)}`);
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
    env: {
      ...process.env,
      SILICACLAW_WORKSPACE_DIR: process.env.SILICACLAW_WORKSPACE_DIR || INVOCATION_CWD,
    },
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
    env: {
      ...process.env,
      SILICACLAW_WORKSPACE_DIR: process.env.SILICACLAW_WORKSPACE_DIR || INVOCATION_CWD,
    },
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
    env: {
      ...process.env,
      SILICACLAW_WORKSPACE_DIR: process.env.SILICACLAW_WORKSPACE_DIR || INVOCATION_CWD,
    },
    ...extra,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function compactOutput(text, limit = 18) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length <= limit) return lines.join("\n");
  return lines.slice(-limit).join("\n");
}

function readVersion() {
  return readPackageVersion();
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

function userNpmCacheDir() {
  return resolve(homedir(), ".silicaclaw", "npm-cache");
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

function describeFileOwner(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const stat = statSync(filePath);
    return String(stat.uid);
  } catch {
    return null;
  }
}

function currentUid() {
  try {
    return typeof process.getuid === "function" ? String(process.getuid()) : null;
  } catch {
    return null;
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
  const npmCacheDir = userNpmCacheDir();
  const envBlock = [
    "#!/usr/bin/env bash",
    'export PATH="$HOME/.silicaclaw/bin:$PATH"',
    'export npm_config_cache="$HOME/.silicaclaw/npm-cache"',
    "",
  ].join("\n");
  const rcBlock = [
    "# >>> silicaclaw >>>",
    '[ -f "$HOME/.silicaclaw/env.sh" ] && . "$HOME/.silicaclaw/env.sh"',
    "# <<< silicaclaw <<<",
  ].join("\n");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(npmCacheDir, { recursive: true });
  writeFileSync(envFile, envBlock, { encoding: "utf8", mode: 0o755 });
  writeFileSync(
    shimPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'export npm_config_cache="${npm_config_cache:-$HOME/.silicaclaw/npm-cache}"',
      'exec npx -y @silicaclaw/cli@beta "$@"',
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 }
  );
  const rcFiles = shellInitTargets();
  const updatedFiles = [];
  const configuredFiles = [];
  const failedFiles = [];
  for (const filePath of rcFiles) {
    const result = ensureLineInFile(filePath, rcBlock);
    if (result.changed) {
      updatedFiles.push(filePath);
      configuredFiles.push(filePath);
    } else if (!result.error) {
      configuredFiles.push(filePath);
    }
    if (result.error) {
      failedFiles.push({ filePath, error: result.error });
    }
  }

  headline();
  console.log("");
  console.log(`${paint("Installed", COLOR.bold)} \`silicaclaw\` command`);
  kv("Command", "silicaclaw");
  console.log("");
  kv("Activate", `source "${envFile}"`);
  if (configuredFiles.length > 0) {
    kv("Startup", "configured");
  } else {
    kv("Startup", "manual setup required");
  }
  if (failedFiles.length > 0) {
    console.log("");
    console.log(paint("Shell files skipped", COLOR.bold, COLOR.yellow));
    const uid = currentUid();
    for (const item of failedFiles) {
      const owner = describeFileOwner(item.filePath);
      const reason =
        owner && uid && owner !== uid
          ? `${item.error} (owned by another user)`
          : item.error;
      kv(item.filePath, reason);
    }
    console.log("");
    kv("Manual", '[ -f "$HOME/.silicaclaw/env.sh" ] && . "$HOME/.silicaclaw/env.sh"');
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
  headline();
  console.log("");
  const upToDate = Boolean(beta) && current === beta;
  if (upToDate) {
    kv("Status", `up to date (${current})`);
  } else {
    kv("Status", `beta update available (${beta || "-"})`);
  }
  console.log("");
  kv("Start", "silicaclaw start");
  kv("Status", "silicaclaw status");
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
  syncCurrentPackageToAppDir(appDir);

  const localRunning = Boolean(status?.local_console?.running);
  const signalingRunning = Boolean(status?.signaling?.running);
  if (!localRunning && !signalingRunning) {
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
  console.log(paint("Refreshing services", COLOR.bold));
  runInherit("node", args, { cwd: process.cwd() });
}

function tryGlobalUpgrade(beta) {
  const writableGlobal = canWriteGlobalPrefix();
  if (!writableGlobal) return false;
  kv("Upgrade", `installing @silicaclaw/cli@${beta} globally`);
  const exactResult = runCapture("npm", ["i", "-g", `@silicaclaw/cli@${beta}`]);
  if ((exactResult.status ?? 1) === 0) {
    if (exactResult.stdout) process.stdout.write(exactResult.stdout);
    if (exactResult.stderr) process.stderr.write(exactResult.stderr);
    return true;
  }

  const detail = compactOutput(`${exactResult.stdout || ""}\n${exactResult.stderr || ""}`);
  if (detail.includes("ETARGET") || detail.includes("No matching version found")) {
    kv("Fallback", "registry metadata is still settling, retrying via @beta tag");
    const fallbackResult = runInherit("npm", ["i", "-g", "@silicaclaw/cli@beta"]);
    return (fallbackResult.status ?? 1) === 0;
  }

  if (detail) {
    console.log("");
    console.log(detail);
  }
  return false;
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
        kv("Update", `next run will use ${beta}`);
      } else if (tryGlobalUpgrade(beta)) {
        kv("Update", `installed ${beta}`);
      } else {
        kv("Update", `install ${beta} manually if needed`);
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

function doctor() {
  const steps = [
    { label: "Check", cmd: "npm", args: ["run", "-ws", "check"] },
    { label: "Build", cmd: "npm", args: ["run", "-ws", "build"] },
    { label: "Functional", cmd: "node", args: ["scripts/functional-check.mjs"] },
  ];

  headline();
  console.log("");

  for (const step of steps) {
    const result = runCapture(step.cmd, step.args, { cwd: ROOT_DIR });
    if ((result.status ?? 1) === 0) {
      kv(step.label, paint("ok", COLOR.green));
      continue;
    }

    kv(step.label, paint("failed", COLOR.yellow));
    const detail = compactOutput(`${result.stdout || ""}\n${result.stderr || ""}`);
    if (detail) {
      console.log("");
      console.log(detail);
    }
    process.exit(result.status ?? 1);
  }
}

function help() {
  headline();
  console.log("");
  section("Commands");
  kv("Install", "npx -y @silicaclaw/cli@beta install");
  kv("Start", "silicaclaw start");
  kv("Status", "silicaclaw status");
  kv("Stop", "silicaclaw stop");
  kv("Update", "silicaclaw update");
  kv("Onboard", "silicaclaw onboard");
  kv("Connect", "silicaclaw connect");
  kv("OpenClaw Demo", "silicaclaw openclaw-demo");
  kv("OpenClaw Bridge", "silicaclaw openclaw-bridge status");
  kv("OpenClaw Skill", "silicaclaw openclaw-skill-install");
  kv("Pack Skill", "silicaclaw openclaw-skill-pack");
  kv("Check Skill", "silicaclaw openclaw-skill-validate");
  kv("Logs", "silicaclaw logs local-console");
  kv("Doctor", "silicaclaw doctor");
  kv("Help", "silicaclaw help");
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
  case "install":
    installPersistentCommand();
    break;
  case "gateway":
    run("node", [resolve(ROOT_DIR, "scripts", "silicaclaw-gateway.mjs"), ...process.argv.slice(3)], {
      cwd: process.cwd(),
    });
    break;
  case "openclaw-demo":
    run("node", [resolve(ROOT_DIR, "scripts", "openclaw-runtime-demo.mjs"), ...process.argv.slice(3)], {
      cwd: process.cwd(),
    });
    break;
  case "openclaw-bridge":
    run("node", [resolve(ROOT_DIR, "scripts", "openclaw-bridge-client.mjs"), ...process.argv.slice(3)], {
      cwd: process.cwd(),
    });
    break;
  case "openclaw-skill-install":
    run("node", [resolve(ROOT_DIR, "scripts", "install-openclaw-skill.mjs"), ...process.argv.slice(3)], {
      cwd: process.cwd(),
    });
    break;
  case "openclaw-skill-pack":
    run("node", [resolve(ROOT_DIR, "scripts", "pack-openclaw-skill.mjs"), ...process.argv.slice(3)], {
      cwd: process.cwd(),
    });
    break;
  case "openclaw-skill-validate":
    run("node", [resolve(ROOT_DIR, "scripts", "validate-openclaw-skill.mjs"), ...process.argv.slice(3)], {
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
    doctor();
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
